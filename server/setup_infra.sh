#!/bin/bash
# ==============================================================================
# Streaming Server Infrastructure Setup Script (VM + CDN)
# ==============================================================================
# This script sets up a complete streaming origin server with:
# 1. Docker & Docker Compose
# 2. NVIDIA Drivers & Container Toolkit (if GPU detected)
# 3. Nginx + RTMP Module + FFmpeg (via Docker)
# 4. Automatic HLS/LL-HLS transcoding pipeline (8 renditions)
#    - Supports NVENC (GPU) and CPU Fallback
#    - Resolutions: 720p, 480p, 360p, 240p (H.264 & H.265)
# ==============================================================================
set -e # Exit on error
# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color
log() {
    echo -e "${GREEN}[INFO] $1${NC}"
}
warn() {
    echo -e "${YELLOW}[WARN] $1${NC}"
}
error() {
    echo -e "${RED}[ERROR] $1${NC}"
}
# Check if running as root
if [ "$EUID" -ne 0 ]; then
  error "Please run as root"
  exit 1
fi
# ==============================================================================
# 1. System Updates & Dependencies
# ==============================================================================
log "Updating system packages..."
apt-get update && apt-get upgrade -y
apt-get install -y curl git htop unzip build-essential s3fs pciutils
# ==============================================================================
# 2. Install Docker & Docker Compose
# ==============================================================================
if ! command -v docker &> /dev/null; then
    log "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
else
    log "Docker already installed."
fi
# ==============================================================================
# 3. Detect GPU & Install Drivers
# ==============================================================================
HAS_GPU=false
if lspci | grep -i nvidia > /dev/null; then
    log "NVIDIA GPU hardware detected."
    
    # Check if drivers are loaded and working
    if command -v nvidia-smi &> /dev/null && nvidia-smi &> /dev/null; then
        log "NVIDIA drivers are installed and loaded. GPU is ready."
        HAS_GPU=true
    else
        log "NVIDIA drivers not detected or not loaded."
        log "Installing NVIDIA drivers and container toolkit..."
        
        # Add NVIDIA package repositories
        curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg \
        && curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
        sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
        sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

        apt-get update
        apt-get install -y nvidia-driver-535 nvidia-container-toolkit

        # Configure Docker to use nvidia runtime
        nvidia-ctk runtime configure --runtime=docker
        systemctl restart docker
        
        log "----------------------------------------------------------------"
        warn "NVIDIA drivers installed. A SYSTEM REBOOT IS REQUIRED."
        warn "Please reboot the server and run this script again to enable GPU support."
        log "----------------------------------------------------------------"
        read -p "Reboot now? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            reboot
        fi
        exit 0
    fi
else
    warn "No NVIDIA GPU hardware detected. Switching to CPU-only mode."
fi
# ==============================================================================
# 4. Project Directory Setup
# ==============================================================================
PROJECT_DIR="/opt/streaming-server"
mkdir -p "$PROJECT_DIR/config"
mkdir -p "$PROJECT_DIR/hls"
mkdir -p "$PROJECT_DIR/recordings"
mkdir -p "$PROJECT_DIR/logs"
cd "$PROJECT_DIR"
# ==============================================================================
# 5. Create Dockerfile
# ==============================================================================
log "Generating Dockerfile..."
if [ "$HAS_GPU" = true ]; then
    # GPU Dockerfile
    cat <<EOF > Dockerfile
FROM nvidia/cuda:12.2.0-base-ubuntu22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y nginx libnginx-mod-rtmp ffmpeg curl && rm -rf /var/lib/apt/lists/*
RUN ln -sf /dev/stdout /var/log/nginx/access.log && ln -sf /dev/stderr /var/log/nginx/error.log
EXPOSE 1935 8080
CMD ["nginx", "-g", "daemon off;"]
EOF
else
    # CPU Dockerfile (Standard Ubuntu)
    cat <<EOF > Dockerfile
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y nginx libnginx-mod-rtmp ffmpeg curl && rm -rf /var/lib/apt/lists/*
RUN ln -sf /dev/stdout /var/log/nginx/access.log && ln -sf /dev/stderr /var/log/nginx/error.log
EXPOSE 1935 8080
CMD ["nginx", "-g", "daemon off;"]
EOF
fi
# ==============================================================================
# 6. Generate Nginx Configuration (Dynamic)
# ==============================================================================
log "Generating nginx.conf..."
# Define FFmpeg command based on GPU availability
if [ "$HAS_GPU" = true ]; then
    log "Configuring FFmpeg for NVENC (Hardware Acceleration)..."
    FFMPEG_CMD='exec_push ffmpeg -i rtmp://localhost/live/$name -async 1 -vsync -1 \
              -c:v h264_nvenc -c:a aac -b:v 2500k -minrate 2500k -maxrate 2500k -bufsize 5000k -vf "scale=1280:720" -preset p4 -tune ll -f flv rtmp://localhost/hls/$name_720p264 \
              -c:v h264_nvenc -c:a aac -b:v 1000k -minrate 1000k -maxrate 1000k -bufsize 2000k -vf "scale=854:480" -preset p4 -tune ll -f flv rtmp://localhost/hls/$name_480p264 \
              -c:v h264_nvenc -c:a aac -b:v 800k -minrate 800k -maxrate 800k -bufsize 1600k -vf "scale=640:360" -preset p4 -tune ll -f flv rtmp://localhost/hls/$name_360p264 \
              -c:v h264_nvenc -c:a aac -b:v 600k -minrate 600k -maxrate 600k -bufsize 1200k -vf "scale=426:240" -preset p4 -tune ll -f flv rtmp://localhost/hls/$name_240p264 \
              -c:v hevc_nvenc -c:a aac -b:v 1800k -minrate 1800k -maxrate 1800k -bufsize 3600k -vf "scale=1280:720" -preset p4 -tune ll -tag:v hvc1 -f flv rtmp://localhost/hls/$name_720p265 \
              -c:v hevc_nvenc -c:a aac -b:v 800k -minrate 800k -maxrate 800k -bufsize 1600k -vf "scale=854:480" -preset p4 -tune ll -tag:v hvc1 -f flv rtmp://localhost/hls/$name_480p265 \
              -c:v hevc_nvenc -c:a aac -b:v 600k -minrate 600k -maxrate 600k -bufsize 1200k -vf "scale=640:360" -preset p4 -tune ll -tag:v hvc1 -f flv rtmp://localhost/hls/$name_360p265 \
              -c:v hevc_nvenc -c:a aac -b:v 400k -minrate 400k -maxrate 400k -bufsize 800k -vf "scale=426:240" -preset p4 -tune ll -tag:v hvc1 -f flv rtmp://localhost/hls/$name_240p265;'
else
    log "Configuring FFmpeg for libx264/libx265 (CPU Software Encoding)..."
    FFMPEG_CMD='exec_push ffmpeg -i rtmp://localhost/live/$name -async 1 -vsync -1 \
              -c:v libx264 -c:a aac -b:v 2500k -minrate 2500k -maxrate 2500k -bufsize 5000k -vf "scale=1280:720" -preset veryfast -tune zerolatency -f flv rtmp://localhost/hls/$name_720p264 \
              -c:v libx264 -c:a aac -b:v 1000k -minrate 1000k -maxrate 1000k -bufsize 2000k -vf "scale=854:480" -preset veryfast -tune zerolatency -f flv rtmp://localhost/hls/$name_480p264 \
              -c:v libx264 -c:a aac -b:v 800k -minrate 800k -maxrate 800k -bufsize 1600k -vf "scale=640:360" -preset veryfast -tune zerolatency -f flv rtmp://localhost/hls/$name_360p264 \
              -c:v libx264 -c:a aac -b:v 600k -minrate 600k -maxrate 600k -bufsize 1200k -vf "scale=426:240" -preset veryfast -tune zerolatency -f flv rtmp://localhost/hls/$name_240p264 \
              -c:v libx265 -c:a aac -b:v 1800k -minrate 1800k -maxrate 1800k -bufsize 3600k -vf "scale=1280:720" -preset fast -tag:v hvc1 -f flv rtmp://localhost/hls/$name_720p265 \
              -c:v libx265 -c:a aac -b:v 800k -minrate 800k -maxrate 800k -bufsize 1600k -vf "scale=854:480" -preset fast -tag:v hvc1 -f flv rtmp://localhost/hls/$name_480p265 \
              -c:v libx265 -c:a aac -b:v 600k -minrate 600k -maxrate 600k -bufsize 1200k -vf "scale=640:360" -preset fast -tag:v hvc1 -f flv rtmp://localhost/hls/$name_360p265 \
              -c:v libx265 -c:a aac -b:v 400k -minrate 400k -maxrate 400k -bufsize 800k -vf "scale=426:240" -preset fast -tag:v hvc1 -f flv rtmp://localhost/hls/$name_240p265;'
fi
cat <<EOF > config/nginx.conf
worker_processes auto;
rtmp_auto_push on;
events {
    worker_connections 1024;
}
rtmp {
    server {
        listen 1935;
        chunk_size 4096;
        application live {
            live on;
            record off;
            # Transcoding Pipeline
            # 8 Variants: H.264 & H.265 @ 720p, 480p, 360p, 240p
            $FFMPEG_CMD
        }
        application hls {
            live on;
            hls on;
            hls_fragment_naming system;
            hls_fragment 2s;
            hls_playlist_length 10s;
            hls_path /opt/hls;
            hls_nested on;
            
            record all;
            record_path /opt/recordings;
            record_unique on;
            record_suffix _%d%m%Y_%H%M%S.flv;
        }
    }
}
http {
    include       mime.types;
    default_type  application/octet-stream;
    sendfile        on;
    keepalive_timeout  65;
    server {
        listen 8080;
        add_header 'Access-Control-Allow-Origin' '*' always;
        add_header 'Access-Control-Expose-Headers' 'Content-Length,Content-Range';
        add_header 'Access-Control-Allow-Headers' 'Range';
        location /hls {
            types {
                application/vnd.apple.mpegurl m3u8;
                video/mp2t ts;
            }
            root /opt;
            add_header Cache-Control no-cache;
        }
        location /stat {
            rtmp_stat all;
            rtmp_stat_stylesheet stat.xsl;
        }
    }
}
EOF
# ==============================================================================
# 7. Create Docker Compose File
# ==============================================================================
log "Generating docker-compose.yml..."
if [ "$HAS_GPU" = true ]; then
    # GPU Compose
    cat <<EOF > docker-compose.yml
version: '3.8'
services:
  streaming-server:
    build: .
    container_name: streaming-origin
    restart: always
    network_mode: host
    volumes:
      - ./config/nginx.conf:/etc/nginx/nginx.conf
      - ./hls:/opt/hls
      - ./recordings:/opt/recordings
      - /dev/shm:/dev/shm
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
EOF
else
    # CPU Compose
    cat <<EOF > docker-compose.yml
version: '3.8'
services:
  streaming-server:
    build: .
    container_name: streaming-origin
    restart: always
    network_mode: host
    volumes:
      - ./config/nginx.conf:/etc/nginx/nginx.conf
      - ./hls:/opt/hls
      - ./recordings:/opt/recordings
      - /dev/shm:/dev/shm
EOF
fi
# ==============================================================================
# 8. Build and Start Services
# ==============================================================================
log "Building and starting Docker container..."
docker-compose up -d --build
# ==============================================================================
# 9. Configure Automatic Uploads (Rclone)
# ==============================================================================
log "Configuring Automatic Uploads..."
# Install Rclone
if ! command -v rclone &> /dev/null; then
    curl https://rclone.org/install.sh | sudo bash
fi
# Create Sync Script
cat <<EOF > $PROJECT_DIR/sync_recordings.sh
#!/bin/bash
# Syncs recordings to cloud bucket
# Usage: ./sync_recordings.sh
RECORDING_DIR="/opt/streaming-server/recordings"
REMOTE_NAME="my-bucket" # User must configure this
REMOTE_PATH="recordings"
# Check if rclone is configured
if rclone listremotes | grep -q "\$REMOTE_NAME"; then
    # Move files older than 1 minute (finished recordings) to cloud
    # We use 'move' to upload and delete local copy to save space
    rclone move "\$RECORDING_DIR" "\$REMOTE_NAME:\$REMOTE_PATH" --min-age 1m --include "*.flv" --log-file /var/log/rclone_sync.log
else
    echo "Rclone remote '\$REMOTE_NAME' not found. Please run 'rclone config' to set it up."
fi
EOF
chmod +x $PROJECT_DIR/sync_recordings.sh
# Add Cron Job (Run every 5 minutes)
(crontab -l 2>/dev/null; echo "*/5 * * * * $PROJECT_DIR/sync_recordings.sh >> /var/log/cron_sync.log 2>&1") | crontab -
log "Setup Complete!"
log "----------------------------------------------------------------"
log "IMPORTANT: You must configure the bucket connection manually:"
log "1. Run: rclone config"
log "2. Create a new remote named 'my-bucket' (S3/GCS/Azure)"
log "----------------------------------------------------------------"
log "RTMP Ingest: rtmp://<YOUR-IP>:1935/live/<stream-key>"
log "HLS Output: http://<YOUR-IP>:8080/hls/<stream-key>_720p264/index.m3u8"
if [ "$HAS_GPU" = true ]; then
    log "Mode: GPU Accelerated (NVENC)"
    log "Monitor GPU usage with: nvidia-smi"
else
    log "Mode: CPU Software Encoding"
    log "Monitor CPU usage with: htop"
fi
log "Monitor Logs with: docker logs -f streaming-origin"