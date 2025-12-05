#!/bin/bash
# ==============================================================================
# Streaming Server Infrastructure Setup (VM + CDN)
# ==============================================================================
# Features:
# - Docker + Docker Compose
# - NVIDIA GPU Support (auto-detect)
# - Multi-rendition HLS (H.264 + H.265)
# - Automatic Recording Upload to Cloud Bucket
# ==============================================================================
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

[ "$EUID" -ne 0 ] && error "Please run as root"

# ==============================================================================
# 1. System Updates
# ==============================================================================
log "Updating system..."
apt-get update && apt-get upgrade -y
apt-get install -y curl git htop unzip pciutils

# ==============================================================================
# 2. Install Docker
# ==============================================================================
if ! command -v docker &> /dev/null; then
    log "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
fi

# ==============================================================================
# 3. GPU Detection & Driver Installation
# ==============================================================================
HAS_GPU=false

if lspci | grep -i nvidia > /dev/null; then
    log "NVIDIA GPU hardware detected."
    
    if command -v nvidia-smi &> /dev/null && nvidia-smi &> /dev/null; then
        log "NVIDIA drivers are ready."
        HAS_GPU=true
    else
        log "Installing NVIDIA drivers..."
        
        curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
          gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
        
        curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
          sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
          tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

        apt-get update
        apt-get install -y nvidia-driver-535 nvidia-container-toolkit
        nvidia-ctk runtime configure --runtime=docker
        systemctl restart docker
        
        warn "NVIDIA drivers installed. Please REBOOT and run this script again."
        read -p "Reboot now? (y/n) " -n 1 -r
        echo
        [[ $REPLY =~ ^[Yy]$ ]] && reboot
        exit 0
    fi
else
    warn "No NVIDIA GPU detected. Using CPU encoding."
fi

# ==============================================================================
# 4. Project Setup
# ==============================================================================
PROJECT_DIR="/opt/streaming-server"
mkdir -p "$PROJECT_DIR"/{config,media/streams,media/recordings,logs}
cd "$PROJECT_DIR"

# ==============================================================================
# 5. Create Dockerfile
# ==============================================================================
log "Creating Dockerfile..."

if [ "$HAS_GPU" = true ]; then
cat > Dockerfile << 'EOF'
FROM nvidia/cuda:12.2.0-base-ubuntu22.04
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl ffmpeg build-essential python3 \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

ENV ENABLE_GPU=true
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV MEDIA_ROOT=/opt/media

EXPOSE 1935 3001
CMD ["node", "index.js"]
EOF
else
cat > Dockerfile << 'EOF'
FROM node:18-bullseye-slim

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

ENV ENABLE_GPU=false
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV MEDIA_ROOT=/opt/media

EXPOSE 1935 3001
CMD ["node", "index.js"]
EOF
fi

# ==============================================================================
# 6. Create Nginx Config
# ==============================================================================
log "Creating Nginx config..."

cat > config/nginx.conf << 'NGINX'
worker_processes auto;
events { worker_connections 1024; }

http {
    include mime.types;
    default_type application/octet-stream;
    sendfile on;
    keepalive_timeout 65;

    server {
        listen 80;

        # HLS Files
        location /streams {
            alias /opt/media/streams;
            types {
                application/vnd.apple.mpegurl m3u8;
                video/mp2t ts;
            }
            add_header Cache-Control no-cache;
            add_header Access-Control-Allow-Origin *;
        }

        # API Proxy
        location / {
            proxy_pass http://app:3001;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }
    }
}
NGINX

# ==============================================================================
# 7. Create Docker Compose
# ==============================================================================
log "Creating docker-compose.yml..."

if [ "$HAS_GPU" = true ]; then
cat > docker-compose.yml << 'EOF'
version: '3.8'
services:
  app:
    build: .
    container_name: streaming-app
    restart: always
    ports:
      - "1935:1935"
      - "3001:3001"
    volumes:
      - ./media:/opt/media
    environment:
      - ENABLE_GPU=true
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]

  nginx:
    image: nginx:alpine
    container_name: streaming-nginx
    restart: always
    ports:
      - "80:80"
    volumes:
      - ./config/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./media:/opt/media:ro
    depends_on:
      - app
EOF
else
cat > docker-compose.yml << 'EOF'
version: '3.8'
services:
  app:
    build: .
    container_name: streaming-app
    restart: always
    ports:
      - "1935:1935"
      - "3001:3001"
    volumes:
      - ./media:/opt/media
    environment:
      - ENABLE_GPU=false

  nginx:
    image: nginx:alpine
    container_name: streaming-nginx
    restart: always
    ports:
      - "80:80"
    volumes:
      - ./config/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./media:/opt/media:ro
    depends_on:
      - app
EOF
fi

# ==============================================================================
# 8. Install Rclone & Create Sync Script
# ==============================================================================
log "Setting up rclone..."

if ! command -v rclone &> /dev/null; then
    curl https://rclone.org/install.sh | bash
fi

cat > sync_recordings.sh << 'SYNC'
#!/bin/bash
# Uploads recordings to cloud bucket

RECORDING_DIR="/opt/streaming-server/media/recordings"
REMOTE="my-bucket"  # Configure with: rclone config

if rclone listremotes | grep -q "$REMOTE"; then
    rclone move "$RECORDING_DIR" "$REMOTE:recordings" \
        --min-age 2m \
        --include "*.flv" \
        --log-file /var/log/rclone.log
else
    echo "Rclone remote '$REMOTE' not configured. Run: rclone config"
fi
SYNC

chmod +x sync_recordings.sh

# Add cron job (every 5 minutes)
(crontab -l 2>/dev/null | grep -v sync_recordings; echo "*/5 * * * * $PROJECT_DIR/sync_recordings.sh") | crontab -

# ==============================================================================
# 9. Build & Start
# ==============================================================================
log "Building and starting services..."
log "NOTE: You must copy your server code (index.js, config.js, transcoder.js, package.json) to $PROJECT_DIR first!"

echo ""
log "=========================================="
log " NEXT STEPS:"
log "=========================================="
log " 1. Copy your server code to: $PROJECT_DIR"
log " 2. Run: cd $PROJECT_DIR && docker-compose up -d --build"
log " 3. Configure rclone: rclone config (create remote named 'my-bucket')"
log ""
log " ENDPOINTS:"
log "   RTMP Ingest: rtmp://<IP>:1935/live/<stream-key>"
log "   HLS Playback: http://<IP>/streams/<stream-key>_h264.m3u8"
log "   API: http://<IP>:3001/api/streams"
log ""
if [ "$HAS_GPU" = true ]; then
    log " Mode: GPU (NVENC)"
else
    log " Mode: CPU (libx264)"
fi
log "=========================================="
