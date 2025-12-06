#!/bin/bash
# ==============================================================================
# Streaming Server Complete Setup Script
# ==============================================================================
# This script configures a fresh Ubuntu/Debian VM for high-performance streaming.
#
# FEATURES:
# - Full System Update & Dependency Installation
# - Essential Tools (nano, htop, curl, git, etc.)
# - Docker & Docker Compose (Optional)
# - NVIDIA GPU Driver Auto-detection & Installation
# - Nginx with RTMP Module for Live Streaming
# - SSL Certificates via Let's Encrypt
# - Node.js 18 LTS Installation
# - Node Media Server Integration
# - Rclone for Cloud Storage Sync
#
# DOMAIN: livestream-test.duckdns.org
# EMAIL:  ayush05m@gmail.com
# ==============================================================================

set -e

# ==============================================================================
# COLORS & HELPERS
# ==============================================================================
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
header() { echo -e "\n${BLUE}=== $1 ===${NC}\n"; }

# ==============================================================================
# PRE-FLIGHT CHECKS
# ==============================================================================
[ "$EUID" -ne 0 ] && error "This script must be run as root (sudo)."

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    OS_VERSION=$VERSION_ID
else
    error "Cannot detect OS. This script supports Ubuntu/Debian only."
fi

log "Detected OS: $OS $OS_VERSION"

# ==============================================================================
# CONFIGURATION
# ==============================================================================
DOMAIN="livestream-test.duckdns.org"
EMAIL="ayush05m@gmail.com"
PROJECT_DIR="/opt/streaming-server"
INSTALL_DOCKER=false  # Set to true to enable Docker installation

# Ask user about Docker installation
read -p "Do you want to install Docker? (y/n, default: n): " -n 1 -r DOCKER_CHOICE
echo
if [[ $DOCKER_CHOICE =~ ^[Yy]$ ]]; then
    INSTALL_DOCKER=true
    log "Docker will be installed."
else
    log "Docker installation skipped."
fi

# ==============================================================================
# STEP 1: SYSTEM UPDATE & UPGRADE
# ==============================================================================
header "Step 1: System Update & Upgrade"

log "Updating package lists..."
apt-get update

log "Upgrading all packages..."
apt-get upgrade -y

log "Performing distribution upgrade..."
apt-get dist-upgrade -y

log "Removing unused packages..."
apt-get autoremove -y

# ==============================================================================
# STEP 2: ESSENTIAL TOOLS & LIBRARIES
# ==============================================================================
header "Step 2: Installing Essential Tools & Libraries"

log "Installing core utilities..."
apt-get install -y \
    nano \
    vim \
    htop \
    curl \
    wget \
    git \
    unzip \
    zip \
    tree \
    net-tools \
    pciutils \
    lsof \
    tmux \
    screen

log "Installing build essentials..."
apt-get install -y \
    build-essential \
    gcc \
    g++ \
    make \
    cmake \
    pkg-config \
    autoconf \
    automake \
    libtool

log "Installing SSL & Security tools..."
apt-get install -y \
    ca-certificates \
    gnupg \
    openssl \
    libssl-dev \
    certbot \
    python3-certbot-nginx

log "Installing network tools..."
apt-get install -y \
    iptables \
    ufw \
    fail2ban \
    dnsutils

log "Installing compression libraries..."
apt-get install -y \
    libbz2-dev \
    zlib1g-dev \
    libzstd-dev

log "Installing Python 3..."
apt-get install -y \
    python3 \
    python3-pip \
    python3-venv

# ==============================================================================
# STEP 3: NODE.JS 18 LTS INSTALLATION
# ==============================================================================
header "Step 3: Installing Node.js 18 LTS"

if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    log "Node.js is already installed: $NODE_VERSION"
else
    log "Installing Node.js 18.x LTS..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
    
    log "Installed Node.js version: $(node -v)"
    log "Installed npm version: $(npm -v)"
fi

# Install global npm packages
log "Installing useful npm global packages..."
npm install -g pm2 nodemon

# ==============================================================================
# STEP 4: FFMPEG INSTALLATION (WITH FULL CODECS)
# ==============================================================================
header "Step 4: Installing FFmpeg"

log "Installing FFmpeg with full codec support..."
apt-get install -y \
    ffmpeg \
    libavcodec-extra \
    libavformat-dev \
    libavutil-dev \
    libswscale-dev \
    libavfilter-dev

log "FFmpeg version: $(ffmpeg -version | head -n 1)"

# ==============================================================================
# STEP 5: NGINX WITH RTMP MODULE
# ==============================================================================
header "Step 5: Installing Nginx with RTMP Module"

log "Installing Nginx dependencies..."
apt-get install -y \
    libpcre3 \
    libpcre3-dev \
    zlib1g-dev

# Check if nginx-extras is available (includes RTMP on Ubuntu)
if apt-cache show libnginx-mod-rtmp &> /dev/null; then
    log "Installing Nginx with RTMP module from package..."
    apt-get install -y nginx libnginx-mod-rtmp
else
    log "Installing Nginx..."
    apt-get install -y nginx
    
    # Build RTMP module from source
    log "Building Nginx RTMP module from source..."
    
    NGINX_VERSION=$(nginx -v 2>&1 | grep -oP '\d+\.\d+\.\d+')
    TEMP_DIR=$(mktemp -d)
    cd "$TEMP_DIR"
    
    # Download nginx source
    wget "http://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz"
    tar -xzf "nginx-${NGINX_VERSION}.tar.gz"
    
    # Download RTMP module
    git clone https://github.com/arut/nginx-rtmp-module.git
    
    # Get current nginx configure arguments
    NGINX_ARGS=$(nginx -V 2>&1 | grep "configure arguments:" | sed 's/configure arguments://')
    
    cd "nginx-${NGINX_VERSION}"
    ./configure $NGINX_ARGS --add-dynamic-module=../nginx-rtmp-module
    make modules
    
    # Install module
    cp objs/ngx_rtmp_module.so /usr/lib/nginx/modules/
    
    cd /
    rm -rf "$TEMP_DIR"
fi

# Enable Nginx
systemctl enable nginx

# ==============================================================================
# STEP 6: CONFIGURE NGINX FOR STREAMING
# ==============================================================================
header "Step 6: Configuring Nginx for RTMP Streaming"

log "Creating streaming directories..."
mkdir -p /opt/media/streams
mkdir -p /opt/media/recordings
mkdir -p /var/log/nginx

# Set proper permissions
chown -R www-data:www-data /opt/media
chmod -R 755 /opt/media

log "Creating Nginx RTMP configuration..."
cat > /etc/nginx/nginx.conf << 'NGINX_CONF'
user www-data;
worker_processes auto;
pid /run/nginx.pid;
error_log /var/log/nginx/error.log;

# Load RTMP module if available
include /etc/nginx/modules-enabled/*.conf;

events {
    worker_connections 2048;
    multi_accept on;
    use epoll;
}

# ==============================
# RTMP CONFIGURATION
# ==============================
rtmp {
    server {
        listen 1935;
        chunk_size 4096;
        
        # Ping for connection health
        ping 30s;
        ping_timeout 15s;
        
        # Main live application
        application live {
            live on;
            
            # Allow publishing from anywhere (secure with firewall/auth if needed)
            allow publish all;
            allow play all;
            
            # Record streams (optional - comment out if Node Media Server handles this)
            # record all;
            # record_path /opt/media/recordings;
            # record_suffix -%Y%m%d-%H%M%S.flv;
            
            # HLS output (optional - comment out if Node Media Server handles transcoding)
            # hls on;
            # hls_path /opt/media/streams;
            # hls_fragment 2s;
            # hls_playlist_length 10s;
            # hls_cleanup on;
            
            # Push to Node Media Server for transcoding
            # Uncomment below if you want nginx to receive RTMP and forward
            # push rtmp://localhost:1936/live;
        }
        
        # Direct HLS application (if using nginx for HLS instead of Node)
        application hls {
            live on;
            hls on;
            hls_path /opt/media/streams;
            hls_fragment 2s;
            hls_playlist_length 10s;
            hls_cleanup on;
            
            # Optional: create multiple quality versions
            # hls_variant _low bandwidth=288000;
            # hls_variant _mid bandwidth=448000;
            # hls_variant _high bandwidth=1152000;
        }
    }
}

# ==============================
# HTTP CONFIGURATION
# ==============================
http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    
    # Logging
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';
    access_log /var/log/nginx/access.log main;
    
    # Performance
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    
    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript 
               application/xml application/rss+xml application/atom+xml image/svg+xml;
    
    # SSL Session Settings
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;
    
    # Redirect HTTP to HTTPS
    server {
        listen 80;
        listen [::]:80;
        server_name livestream-test.duckdns.org;
        
        # Let's Encrypt challenge
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
        
        location / {
            return 301 https://$host$request_uri;
        }
    }
    
    # HTTPS Server
    server {
        listen 443 ssl http2;
        listen [::]:443 ssl http2;
        server_name livestream-test.duckdns.org;
        
        # SSL Certificates (will be created by certbot)
        ssl_certificate /etc/letsencrypt/live/livestream-test.duckdns.org/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/livestream-test.duckdns.org/privkey.pem;
        
        # Strong SSL settings
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
        ssl_prefer_server_ciphers off;
        
        # Security headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        
        # ==============================
        # HLS STREAMING ENDPOINTS
        # ==============================
        
        # Playlists (.m3u8) - NEVER CACHE
        location ~ ^/streams/(.+\.m3u8)$ {
            alias /opt/media/streams/$1;
            types {
                application/vnd.apple.mpegurl m3u8;
            }
            add_header Cache-Control "no-cache, no-store, must-revalidate" always;
            add_header Access-Control-Allow-Origin * always;
            add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
            add_header Access-Control-Allow-Headers "Range, Origin, Accept" always;
        }
        
        # Segments (.ts) - CACHE FOREVER
        location ~ ^/streams/(.+\.ts)$ {
            alias /opt/media/streams/$1;
            types {
                video/mp2t ts;
            }
            add_header Cache-Control "public, max-age=31536000, immutable";
            add_header Access-Control-Allow-Origin * always;
        }
        
        # RTMP statistics (optional)
        location /stat {
            rtmp_stat all;
            rtmp_stat_stylesheet stat.xsl;
        }
        
        location /stat.xsl {
            root /usr/share/nginx/html;
        }
        
        # ==============================
        # API PROXY (Node Media Server)
        # ==============================
        location / {
            proxy_pass http://127.0.0.1:3001;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
            
            # WebSocket support
            proxy_read_timeout 86400;
        }
        
        # Health check endpoint
        location /health {
            access_log off;
            return 200 "OK\n";
            add_header Content-Type text/plain;
        }
    }
}
NGINX_CONF

# Create certbot webroot
mkdir -p /var/www/certbot

# Test nginx config (without SSL for now)
log "Testing Nginx configuration..."

# Create a temporary config without SSL for initial setup
cat > /etc/nginx/nginx-initial.conf << 'NGINX_INITIAL'
user www-data;
worker_processes auto;
pid /run/nginx.pid;
error_log /var/log/nginx/error.log;

include /etc/nginx/modules-enabled/*.conf;

events {
    worker_connections 2048;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    
    server {
        listen 80;
        server_name livestream-test.duckdns.org;
        
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
        
        location / {
            return 200 "Server is setting up...\n";
            add_header Content-Type text/plain;
        }
    }
}
NGINX_INITIAL

cp /etc/nginx/nginx.conf /etc/nginx/nginx-ssl.conf
cp /etc/nginx/nginx-initial.conf /etc/nginx/nginx.conf

systemctl restart nginx

# ==============================================================================
# STEP 7: SSL CERTIFICATE (LET'S ENCRYPT)
# ==============================================================================
header "Step 7: Obtaining SSL Certificate"

log "Checking SSL certificates for $DOMAIN..."

if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    log "SSL certificate already exists. Attempting renewal..."
    certbot renew --quiet
else
    log "Obtaining new SSL certificate..."
    certbot certonly \
        --webroot \
        --webroot-path=/var/www/certbot \
        -d "$DOMAIN" \
        --non-interactive \
        --agree-tos \
        -m "$EMAIL" \
        --expand
fi

# Restore full nginx config with SSL
log "Enabling HTTPS configuration..."
cp /etc/nginx/nginx-ssl.conf /etc/nginx/nginx.conf
systemctl restart nginx

# Setup auto-renewal
log "Setting up certificate auto-renewal..."
cat > /etc/cron.d/certbot-renewal << 'CRON_RENEWAL'
0 0,12 * * * root certbot renew --quiet --deploy-hook "systemctl reload nginx"
CRON_RENEWAL

# ==============================================================================
# STEP 8: DOCKER INSTALLATION (OPTIONAL)
# ==============================================================================
if [ "$INSTALL_DOCKER" = true ]; then
    header "Step 8: Installing Docker & Docker Compose"
    
    if command -v docker &> /dev/null; then
        log "Docker is already installed: $(docker --version)"
    else
        log "Installing Docker Engine..."
        
        # Add Docker's official GPG key
        install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        chmod a+r /etc/apt/keyrings/docker.gpg
        
        # Add repository
        echo \
          "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
          $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
        
        # Install Docker
        apt-get update
        apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
        
        # Enable Docker service
        systemctl enable docker
        systemctl start docker
        
        log "Docker installed: $(docker --version)"
    fi
else
    header "Step 8: Docker Installation Skipped"
    log "Docker installation was skipped. Run with INSTALL_DOCKER=true if needed."
fi

# ==============================================================================
# STEP 9: GPU DETECTION & DRIVER INSTALLATION
# ==============================================================================
header "Step 9: GPU Detection & Configuration"

HAS_GPU=false

if lspci | grep -i nvidia > /dev/null 2>&1; then
    log "NVIDIA hardware detected!"
    
    if command -v nvidia-smi &> /dev/null; then
        log "NVIDIA drivers are installed."
        nvidia-smi
        HAS_GPU=true
    else
        warn "NVIDIA GPU found but drivers not installed."
        
        read -p "Install NVIDIA drivers? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            log "Installing NVIDIA drivers..."
            
            # Install drivers
            apt-get install -y nvidia-driver-535 nvidia-utils-535
            
            # Install NVIDIA Container Toolkit (if Docker is installed)
            if command -v docker &> /dev/null; then
                log "Installing NVIDIA Container Toolkit..."
                curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
                curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
                    sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
                    tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
                
                apt-get update
                apt-get install -y nvidia-container-toolkit
                nvidia-ctk runtime configure --runtime=docker
                systemctl restart docker
            fi
            
            warn "NVIDIA drivers installed. A REBOOT is required!"
            echo "After reboot, verify with: nvidia-smi"
            HAS_GPU=true
        fi
    fi
else
    log "No NVIDIA GPU detected. System configured for CPU encoding."
fi

# ==============================================================================
# STEP 10: PROJECT SETUP
# ==============================================================================
header "Step 10: Setting Up Project Directory"

SCRIPT_SRC_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

log "Creating project structure at $PROJECT_DIR..."
mkdir -p "$PROJECT_DIR"/{config,media/streams,media/recordings,logs}

log "Copying application files from $SCRIPT_SRC_DIR..."
FILES_TO_COPY=("index.js" "config.js" "transcoder.js" "vod_encoder.js" "package.json" "package-lock.json" ".env")

for file in "${FILES_TO_COPY[@]}"; do
    if [ -f "$SCRIPT_SRC_DIR/$file" ]; then
        cp "$SCRIPT_SRC_DIR/$file" "$PROJECT_DIR/"
        log "Copied: $file"
    else
        warn "File not found (skipped): $file"
    fi
done

# Create symbolic link for media directories
ln -sfn /opt/media "$PROJECT_DIR/media"

# Set permissions
chown -R www-data:www-data "$PROJECT_DIR"
chmod -R 755 "$PROJECT_DIR"

# ==============================================================================
# STEP 11: INSTALL NODE DEPENDENCIES
# ==============================================================================
header "Step 11: Installing Node.js Dependencies"

cd "$PROJECT_DIR"
if [ -f "package.json" ]; then
    log "Installing npm dependencies..."
    npm install --production
else
    warn "No package.json found. Skipping npm install."
fi

# ==============================================================================
# STEP 12: RCLONE INSTALLATION (CLOUD SYNC)
# ==============================================================================
header "Step 12: Installing Rclone for Cloud Storage"

if ! command -v rclone &> /dev/null; then
    log "Installing Rclone..."
    curl https://rclone.org/install.sh | bash
else
    log "Rclone is already installed: $(rclone version | head -n 1)"
fi

log "Configure Rclone with: rclone config"

# ==============================================================================
# STEP 13: FIREWALL CONFIGURATION
# ==============================================================================
header "Step 13: Configuring Firewall"

log "Setting up UFW firewall rules..."

ufw --force reset
ufw default deny incoming
ufw default allow outgoing

# SSH (important!)
ufw allow 22/tcp comment 'SSH'

# HTTP/HTTPS
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'

# RTMP
ufw allow 1935/tcp comment 'RTMP Streaming'

# Node Media Server API (optional - internal use)
# ufw allow 3001/tcp comment 'Node API'

# Enable firewall
ufw --force enable

log "Firewall configured. Open ports: 22, 80, 443, 1935"

# ==============================================================================
# STEP 14: CREATE SYSTEMD SERVICE
# ==============================================================================
header "Step 14: Creating Systemd Service"

log "Creating streaming server systemd service..."
cat > /etc/systemd/system/streaming-server.service << 'SYSTEMD_SERVICE'
[Unit]
Description=Node Media Streaming Server
After=network.target nginx.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/streaming-server
ExecStart=/usr/bin/node index.js
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=streaming-server
Environment=NODE_ENV=production
Environment=PORT=3001

[Install]
WantedBy=multi-user.target
SYSTEMD_SERVICE

systemctl daemon-reload
systemctl enable streaming-server

log "Service created. Control with: systemctl start/stop/status streaming-server"

# ==============================================================================
# STEP 15: CREATE HELPER SCRIPTS
# ==============================================================================
header "Step 15: Creating Helper Scripts"

# Start script
cat > "$PROJECT_DIR/start.sh" << 'START_SCRIPT'
#!/bin/bash
echo "Starting Streaming Server..."
sudo systemctl start streaming-server
sudo systemctl start nginx
echo "Server started!"
echo ""
echo "Check status with:"
echo "  sudo systemctl status streaming-server"
echo "  sudo systemctl status nginx"
START_SCRIPT
chmod +x "$PROJECT_DIR/start.sh"

# Stop script
cat > "$PROJECT_DIR/stop.sh" << 'STOP_SCRIPT'
#!/bin/bash
echo "Stopping Streaming Server..."
sudo systemctl stop streaming-server
echo "Server stopped!"
STOP_SCRIPT
chmod +x "$PROJECT_DIR/stop.sh"

# Logs script
cat > "$PROJECT_DIR/logs.sh" << 'LOGS_SCRIPT'
#!/bin/bash
echo "=== Streaming Server Logs ==="
sudo journalctl -u streaming-server -f
LOGS_SCRIPT
chmod +x "$PROJECT_DIR/logs.sh"

# Status script
cat > "$PROJECT_DIR/status.sh" << 'STATUS_SCRIPT'
#!/bin/bash
echo "=== System Status ==="
echo ""
echo "-- Streaming Server --"
sudo systemctl status streaming-server --no-pager
echo ""
echo "-- Nginx --"
sudo systemctl status nginx --no-pager
echo ""
echo "-- Port Usage --"
sudo netstat -tlnp | grep -E ':(80|443|1935|3001)'
echo ""
echo "-- GPU Status --"
if command -v nvidia-smi &> /dev/null; then
    nvidia-smi
else
    echo "No NVIDIA GPU detected"
fi
STATUS_SCRIPT
chmod +x "$PROJECT_DIR/status.sh"

# ==============================================================================
# SETUP COMPLETE
# ==============================================================================
header "SETUP COMPLETE!"

echo ""
echo -e "${GREEN}==========================================================${NC}"
echo -e "${GREEN}   STREAMING SERVER SETUP COMPLETE!${NC}"
echo -e "${GREEN}==========================================================${NC}"
echo ""
echo -e "  ${BLUE}Domain:${NC}     https://$DOMAIN"
echo -e "  ${BLUE}RTMP URL:${NC}   rtmp://$DOMAIN/live/<stream-key>"
echo -e "  ${BLUE}HLS URL:${NC}    https://$DOMAIN/streams/<key>_h264.m3u8"
echo ""
echo -e "  ${BLUE}Installation:${NC}"
echo -e "    - Project Dir:    $PROJECT_DIR"
echo -e "    - Media Dir:      /opt/media"
echo -e "    - Nginx Config:   /etc/nginx/nginx.conf"
echo ""
echo -e "  ${BLUE}Services:${NC}"
echo -e "    - Node Server:    systemctl [start|stop|status] streaming-server"
echo -e "    - Nginx:          systemctl [start|stop|status] nginx"
echo ""
echo -e "  ${BLUE}Helper Scripts:${NC} (in $PROJECT_DIR)"
echo -e "    - ./start.sh     Start all services"
echo -e "    - ./stop.sh      Stop streaming server"
echo -e "    - ./logs.sh      View live logs"
echo -e "    - ./status.sh    Check system status"
echo ""
echo -e "  ${BLUE}GPU Status:${NC}    $([ "$HAS_GPU" = true ] && echo 'ENABLED' || echo 'CPU ONLY')"
echo -e "  ${BLUE}Docker:${NC}        $([ "$INSTALL_DOCKER" = true ] && echo 'INSTALLED' || echo 'NOT INSTALLED')"
echo ""
echo -e "  ${YELLOW}NEXT STEPS:${NC}"
echo -e "    1. Configure your .env file in $PROJECT_DIR"
echo -e "    2. Start the server: cd $PROJECT_DIR && ./start.sh"
echo -e "    3. Test RTMP: rtmp://$DOMAIN/live/test-stream"
echo ""
if [ "$HAS_GPU" = true ] && ! command -v nvidia-smi &> /dev/null; then
    echo -e "  ${RED}⚠ REBOOT REQUIRED for NVIDIA drivers!${NC}"
    echo ""
fi
echo -e "${GREEN}==========================================================${NC}"
