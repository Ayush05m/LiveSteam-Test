#!/bin/bash
# ==============================================================================
# Streaming Server Setup Script
# ==============================================================================
# This script installs all required dependencies including:
# - FFmpeg (for transcoding)
# - Nginx (for serving HLS streams)
# - Node.js dependencies
# ==============================================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MEDIA_DIR="$SCRIPT_DIR/media"

# Detect OS
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "linux"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ -n "$WINDIR" ]]; then
        echo "windows"
    else
        echo "unknown"
    fi
}

OS=$(detect_os)
log "Detected OS: $OS"

# ==============================================================================
# Install FFmpeg
# ==============================================================================
install_ffmpeg() {
    log "Checking FFmpeg installation..."
    
    if command -v ffmpeg &> /dev/null; then
        FFMPEG_VERSION=$(ffmpeg -version | head -n1)
        log "FFmpeg is already installed: $FFMPEG_VERSION"
        return 0
    fi
    
    log "Installing FFmpeg..."
    
    case $OS in
        linux)
            if command -v apt-get &> /dev/null; then
                sudo apt-get update
                sudo apt-get install -y ffmpeg
            elif command -v yum &> /dev/null; then
                sudo yum install -y epel-release
                sudo yum install -y ffmpeg ffmpeg-devel
            elif command -v dnf &> /dev/null; then
                sudo dnf install -y ffmpeg
            elif command -v pacman &> /dev/null; then
                sudo pacman -S --noconfirm ffmpeg
            else
                error "Could not detect package manager. Please install FFmpeg manually."
            fi
            ;;
        macos)
            if ! command -v brew &> /dev/null; then
                error "Homebrew is not installed. Please install it from https://brew.sh"
            fi
            brew install ffmpeg
            ;;
        windows)
            if command -v choco &> /dev/null; then
                choco install ffmpeg -y
            elif command -v winget &> /dev/null; then
                winget install --id=Gyan.FFmpeg -e
            else
                warn "Chocolatey/Winget not found. Please install FFmpeg manually."
                warn "Download from: https://ffmpeg.org/download.html"
            fi
            ;;
        *)
            error "Unsupported OS. Please install FFmpeg manually."
            ;;
    esac
    
    # Verify installation
    if command -v ffmpeg &> /dev/null; then
        log "FFmpeg installed successfully!"
        ffmpeg -version | head -n1
    else
        warn "FFmpeg may require a terminal restart to be available."
    fi
}

# ==============================================================================
# Install Nginx
# ==============================================================================
install_nginx() {
    log "Checking Nginx installation..."
    
    if command -v nginx &> /dev/null; then
        NGINX_VERSION=$(nginx -v 2>&1)
        log "Nginx is already installed: $NGINX_VERSION"
    else
        log "Installing Nginx..."
        
        case $OS in
            linux)
                if command -v apt-get &> /dev/null; then
                    sudo apt-get update
                    sudo apt-get install -y nginx
                elif command -v yum &> /dev/null; then
                    sudo yum install -y nginx
                elif command -v dnf &> /dev/null; then
                    sudo dnf install -y nginx
                elif command -v pacman &> /dev/null; then
                    sudo pacman -S --noconfirm nginx
                else
                    error "Could not detect package manager. Please install Nginx manually."
                fi
                ;;
            macos)
                if ! command -v brew &> /dev/null; then
                    error "Homebrew is not installed. Please install it from https://brew.sh"
                fi
                brew install nginx
                ;;
            windows)
                warn "Nginx installation on Windows requires manual setup."
                warn "Download from: https://nginx.org/en/download.html"
                return 0
                ;;
            *)
                error "Unsupported OS. Please install Nginx manually."
                ;;
        esac
        
        log "Nginx installed successfully!"
    fi
}

# ==============================================================================
# Configure Nginx
# ==============================================================================
configure_nginx() {
    log "Configuring Nginx for streaming..."
    
    if [[ "$OS" != "linux" ]]; then
        warn "Nginx configuration is only automated for Linux. Please configure manually."
        return 0
    fi
    
    # Create nginx config for streaming
    NGINX_CONFIG="/etc/nginx/sites-available/streaming"
    
    sudo tee $NGINX_CONFIG > /dev/null << EOF
# Streaming Server Nginx Configuration
server {
    listen 80;
    server_name _;

    # HLS Stream Files
    location /streams {
        alias $MEDIA_DIR/streams;
        
        # MIME types for HLS
        types {
            application/vnd.apple.mpegurl m3u8;
            video/mp2t ts;
        }
        
        # Disable caching for live streams
        add_header Cache-Control no-cache;
        add_header Access-Control-Allow-Origin *;
        add_header Access-Control-Allow-Methods 'GET, OPTIONS';
        add_header Access-Control-Allow-Headers 'Origin, Content-Type, Accept';
    }

    # API and Socket.IO Proxy
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # WebSocket timeout
        proxy_read_timeout 86400;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://127.0.0.1:3001/health;
    }
}
EOF

    # Enable the site
    if [ -d "/etc/nginx/sites-enabled" ]; then
        sudo ln -sf $NGINX_CONFIG /etc/nginx/sites-enabled/streaming
        # Disable default site if exists
        sudo rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
    fi
    
    # Test nginx configuration
    if sudo nginx -t; then
        log "Nginx configuration is valid!"
        
        # Restart nginx
        sudo systemctl restart nginx
        sudo systemctl enable nginx
        log "Nginx restarted and enabled on boot."
    else
        error "Nginx configuration test failed. Please check the config."
    fi
}

# ==============================================================================
# Install Node.js Dependencies
# ==============================================================================
install_node_deps() {
    log "Installing Node.js dependencies..."
    
    if ! command -v node &> /dev/null; then
        warn "Node.js is not installed. Attempting to install..."
        
        if [[ "$OS" == "linux" ]] && command -v apt-get &> /dev/null; then
            curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
            sudo apt-get install -y nodejs
        else
            error "Node.js is not installed. Please install Node.js 18+ first."
        fi
    fi
    
    NODE_VERSION=$(node -v)
    log "Node.js version: $NODE_VERSION"
    
    # Install server dependencies
    log "Installing server dependencies..."
    cd "$SCRIPT_DIR"
    npm install
    
    # Install frontend dependencies (if running from project root)
    if [ -f "$SCRIPT_DIR/../package.json" ]; then
        log "Installing frontend dependencies..."
        cd "$SCRIPT_DIR/.."
        if command -v pnpm &> /dev/null; then
            pnpm install
        else
            npm install
        fi
        cd "$SCRIPT_DIR"
    fi
}

# ==============================================================================
# Create Required Directories
# ==============================================================================
create_directories() {
    log "Creating required directories..."
    
    mkdir -p "$MEDIA_DIR/streams"
    mkdir -p "$MEDIA_DIR/recordings"
    
    # Set permissions for nginx to read
    chmod -R 755 "$MEDIA_DIR"
    
    log "Directories created:"
    log "  - $MEDIA_DIR/streams   (HLS segments output)"
    log "  - $MEDIA_DIR/recordings (Stream recordings)"
}

# ==============================================================================
# Setup Environment File
# ==============================================================================
setup_env() {
    log "Setting up environment..."
    
    if [ -f "$SCRIPT_DIR/.env" ]; then
        log ".env file already exists"
    else
        log "Creating .env file from template..."
        cat > "$SCRIPT_DIR/.env" << EOF
# =============================================================================
# Server Environment Configuration
# =============================================================================

# FFmpeg Configuration (update path if needed)
FFMPEG_PATH=ffmpeg

# Server Port
PORT=3001

# RTMP Port
RTMP_PORT=1935

# GPU Encoding (set to 'true' if NVIDIA GPU is available)
ENABLE_GPU=false

# Media Root Directory
MEDIA_ROOT=$MEDIA_DIR

# Node Environment
NODE_ENV=production
EOF
        log ".env file created."
    fi
}

# ==============================================================================
# Check GPU Support
# ==============================================================================
check_gpu() {
    log "Checking GPU support..."
    
    if command -v nvidia-smi &> /dev/null; then
        if nvidia-smi &> /dev/null; then
            log "NVIDIA GPU detected!"
            nvidia-smi --query-gpu=name,driver_version --format=csv,noheader
            warn "To enable GPU encoding, set ENABLE_GPU=true in .env"
        else
            warn "NVIDIA driver not working properly."
        fi
    else
        log "No NVIDIA GPU detected. Using CPU encoding."
    fi
}

# ==============================================================================
# Setup PM2 (Process Manager)
# ==============================================================================
setup_pm2() {
    log "Setting up PM2 process manager..."
    
    if ! command -v pm2 &> /dev/null; then
        log "Installing PM2..."
        sudo npm install -g pm2
    fi
    
    log "PM2 installed. You can start the server with: pm2 start index.js --name streaming-server"
}

# ==============================================================================
# Main Setup
# ==============================================================================
main() {
    echo ""
    echo "=============================================="
    echo "  Streaming Server - Full Setup"
    echo "=============================================="
    echo ""
    
    install_ffmpeg
    echo ""
    
    install_nginx
    echo ""
    
    create_directories
    echo ""
    
    configure_nginx
    echo ""
    
    setup_env
    echo ""
    
    install_node_deps
    echo ""
    
    setup_pm2
    echo ""
    
    check_gpu
    echo ""
    
    echo "=============================================="
    echo "  Setup Complete!"
    echo "=============================================="
    echo ""
    log "What was installed:"
    log "  ✓ FFmpeg     - Video transcoding"
    log "  ✓ Nginx      - Web server & reverse proxy"
    log "  ✓ Node.js    - Application server"
    log "  ✓ PM2        - Process manager"
    echo ""
    log "Next steps:"
    log "  1. Start the server: pm2 start index.js --name streaming-server"
    log "  2. Save PM2 config:  pm2 save && pm2 startup"
    echo ""
    log "Endpoints:"
    log "  Web/API:     http://<your-ip>/"
    log "  HLS Streams: http://<your-ip>/streams/<key>_h264.m3u8"
    log "  RTMP Ingest: rtmp://<your-ip>:1935/live/<key>"
    echo ""
}

main "$@"
