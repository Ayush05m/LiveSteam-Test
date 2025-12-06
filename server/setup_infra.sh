#!/bin/bash
# ==============================================================================
# Streaming Server Complete Setup Script
# ==============================================================================
# This script configures a fresh Ubuntu/Debian VM for high-performance streaming.
# FEATURES:
# - Full System Update & Dependency Installation
# - Docker & Docker Compose Setup
# - NVIDIA GPU Driver Auto-detection & Installation
# - Nginx Configuration with CDN Optimization (Correct Caching Headers)
# - Node Media Server Infrastructure Generation
# - Automatic Recording Sync (Rclone)
# ==============================================================================

set -e

# Support Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Check Root
[ "$EUID" -ne 0 ] && error "This script must be run as root (sudo)."

# ==============================================================================
# 1. System Updates & Core Dependencies
# ==============================================================================
log "Updating system packages..."
apt-get update && apt-get upgrade -y

log "Installing core dependencies (including nano)..."
# Installed: curl, git, htop (monitor), unzip, pciutils (lspci), nano (request), build-essential (compile), net-tools (netstat)
apt-get install -y \
    curl \
    git \
    htop \
    unzip \
    pciutils \
    nano \
    build-essential \
    net-tools \
    ca-certificates \
    certbot \
    python3-certbot-nginx

# ==============================================================================
# CONFIGURATION
# ==============================================================================
DOMAIN="livestream-test.duckdns.org"
EMAIL="ayush05m@gmail.com" # Change this if needed

# ==============================================================================
# 2. Install Docker & Docker Compose
# ==============================================================================
if ! command -v docker &> /dev/null; then
    log "Installing Docker Engine..."
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
else
    log "Docker is already installed."
fi

# Enable Docker service
systemctl enable docker
systemctl start docker

# ==============================================================================
# 2b. Obtain SSL Certificate (Let's Encrypt)
# ==============================================================================
log "Checking SSL Certificates for $DOMAIN..."

# Stop any process binding port 80 (like existing nginx) to allow standalone certbot
if docker ps | grep -q 'streaming-nginx'; then
    log "Stopping existing Nginx container to free port 80..."
    docker stop streaming-nginx || true
fi

if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    log "Obtaining new SSL certificate..."
    certbot certonly --standalone -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --expand
else
    log "SSL Certificate already exists. Attempting renewal..."
    certbot renew
fi

# ==============================================================================
# 3. GPU Detection & Driver Installation
# ==============================================================================
HAS_GPU=false

if lspci | grep -i nvidia > /dev/null; then
    log "NVIDIA Hardware Detected."
    
    if command -v nvidia-smi &> /dev/null; then
        log "NVIDIA drivers appear to be installed."
        HAS_GPU=true
    else
        log "Installing NVIDIA Drivers & Container Toolkit..."
        
        # Add NVIDIA Container Toolkit Repo
        curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg \
        && curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
          sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
          tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
          
        apt-get update
        
        # Install Drivers (Common version 535) and Toolkit
        apt-get install -y nvidia-driver-535 nvidia-container-toolkit
        
        # Configure Docker to use NVIDIA runtime
        nvidia-ctk runtime configure --runtime=docker
        systemctl restart docker
        
        warn "NVIDIA drivers installed. A REBOOT is required."
        read -p "Reboot system now? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            reboot
            exit 0
        fi
        HAS_GPU=true
    fi
else
    warn "No NVIDIA GPU detected. System will be configured for CPU encoding."
fi

# ==============================================================================
# 4. Project Directory Structure
# ==============================================================================
PROJECT_DIR="/opt/streaming-server"
# Save the directory where the script is running from
SCRIPT_SRC_DIR=$(pwd)

log "Setting up project directory: $PROJECT_DIR"
mkdir -p "$PROJECT_DIR"/{config,media/streams,media/recordings,logs}

# ==============================================================================
# 4b. Copy Application Code
# ==============================================================================
log "Copying application files from $SCRIPT_SRC_DIR..."

# List of files to copy
FILES_TO_COPY=("index.js" "config.js" "transcoder.js" "vod_encoder.js" "package.json" ".env" "start_server.sh")

for file in "${FILES_TO_COPY[@]}"; do
    if [ -f "$SCRIPT_SRC_DIR/$file" ]; then
        cp "$SCRIPT_SRC_DIR/$file" "$PROJECT_DIR/"
        log "Copied: $file"
    else
        warn "File not found (skipped): $file"
    fi
done

# Navigate to project dir
cd "$PROJECT_DIR"

# ==============================================================================
# 5. Generate Nginx Config (SSL + CDN Optimized)
# ==============================================================================
log "Generating Nginx Configuration..."
cat > config/nginx.conf << EOF
worker_processes auto;
events { worker_connections 1024; }

http {
    include mime.types;
    default_type application/octet-stream;
    
    # Performance Optimizations
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;

    # Redirect HTTP to HTTPS
    server {
        listen 80;
        server_name $DOMAIN;
        return 301 https://\$host\$request_uri;
    }

    # HTTPS Server
    server {
        listen 443 ssl http2;
        server_name $DOMAIN;

        # SSL Certificates
        ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
        
        # SSL Optimization
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers on;

        # ----------------------------------------------------------------------
        # HLS STREAMING CONFIGURATION
        # ----------------------------------------------------------------------
        
        # 1. Playlists (.m3u8) - NEVER CACHE
        location ~ ^/streams/(.+\.m3u8)$ {
            alias /opt/media/streams/\$1;
            types {
                application/vnd.apple.mpegurl m3u8;
            }
            add_header Cache-Control "no-cache, no-store, must-revalidate" always;
            add_header Access-Control-Allow-Origin *;
        }

        # 2. Segments (.ts) - CACHE FOREVER (1 Year)
        location ~ ^/streams/(.+\.ts)$ {
            alias /opt/media/streams/\$1;
            types {
                video/mp2t ts;
            }
            add_header Cache-Control "public, max-age=31536000, immutable";
            add_header Access-Control-Allow-Origin *;
        }

        # ----------------------------------------------------------------------
        # API PROXY
        # ----------------------------------------------------------------------
        location / {
            proxy_pass http://app:3001;
            proxy_http_version 1.1;
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto https;
        }
    }
}
EOF

# ==============================================================================
# 6. Generate Dockerfile
# ==============================================================================
log "Generating Application Dockerfile..."

# Base image Logic WITH NODEJS for GPU build too
if [ "$HAS_GPU" = true ]; then
    BASE_IMAGE="nvidia/cuda:12.2.0-base-ubuntu22.04"
    GPU_FLAG="true"
else
    BASE_IMAGE="node:18-bullseye-slim"
    GPU_FLAG="false"
fi

cat > Dockerfile << EOF
FROM ${BASE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive
ENV ENABLE_GPU=${GPU_FLAG}

WORKDIR /app

# Install dependencies (FFmpeg + Node if needed)
RUN apt-get update && apt-get install -y ffmpeg curl \\
    && rm -rf /var/lib/apt/lists/*

# If using CUDA base, install Node.js manually
RUN if [ "${GPU_FLAG}" = "true" ]; then \\
      curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \\
      && apt-get install -y nodejs; \\
    fi

# Create media directories
RUN mkdir -p /opt/media/streams /opt/media/recordings

ENV MEDIA_ROOT=/opt/media
ENV FFMPEG_PATH=/usr/bin/ffmpeg

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 1935 3001

CMD ["node", "index.js"]
EOF

# ==============================================================================
# 7. Generate Docker Compose
# ==============================================================================
log "Generating docker-compose.yml..."

if [ "$HAS_GPU" = true ]; then
cat > docker-compose.yml << EOF
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
      - "443:443"
    volumes:
      - ./config/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./media:/opt/media:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    depends_on:
      - app
EOF
else
cat > docker-compose.yml << EOF
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
      - "443:443"
    volumes:
      - ./config/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./media:/opt/media:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    depends_on:
      - app
EOF
fi

# ==============================================================================
# 8. Rclone Setup (Optional)
# ==============================================================================
if ! command -v rclone &> /dev/null; then
    log "Installing Rclone..."
    curl https://rclone.org/install.sh | bash
fi

# ==============================================================================
# 9. Start Script Generation
# ==============================================================================
log "Generating background start script..."

cat > start_server.sh << 'EOF'
#!/bin/bash
# Starts the streaming server stack in background
cd /opt/streaming-server
echo "Starting Streaming Server (Docker)..."
docker compose up -d --build
echo "Server is running in background!"
echo "Status: docker compose ps"
EOF

chmod +x start_server.sh

# ==============================================================================
# 10. Finishing Up
# ==============================================================================
log ""
log "=========================================================="
log " SETUP COMPLETE! SSL ENABLED for $DOMAIN"
log "=========================================================="
log " Installation Directory: $PROJECT_DIR"
log ""
log " ACTION REQUIRED:"
log " 1. Start the server:"
log "    ./start_server.sh"
log ""
log " 2. Check logs:"
log "    docker compose logs -f"
log "=========================================================="

