#!/bin/bash
# ==============================================================================
# Local Development Setup Script
# ==============================================================================
# This script installs all required dependencies for local development.
# For production/VM deployment, use setup_infra.sh instead.
# ==============================================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

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
        # linux)
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
        # macos)
        #     if ! command -v brew &> /dev/null; then
        #         error "Homebrew is not installed. Please install it from https://brew.sh"
        #     fi
        #     brew install ffmpeg
        #     ;;
        # windows)
            # if command -v choco &> /dev/null; then
            #     choco install ffmpeg -y
            # elif command -v winget &> /dev/null; then
            #     winget install --id=Gyan.FFmpeg -e
            # else
            #     warn "Chocolatey/Winget not found. Please install FFmpeg manually."
            #     warn "Download from: https://ffmpeg.org/download.html"
            #     warn "Or install Chocolatey: https://chocolatey.org/install"
            # fi
            # ;;
        # *)
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
# Install Node.js Dependencies
# ==============================================================================
install_node_deps() {
    log "Installing Node.js dependencies..."
    
    if ! command -v node &> /dev/null; then
        error "Node.js is not installed. Please install Node.js 18+ first."
    fi
    
    NODE_VERSION=$(node -v)
    log "Node.js version: $NODE_VERSION"
    
    # Install server dependencies
    log "Installing server dependencies..."
    npm install
    
    # Install frontend dependencies (if running from project root)
    if [ -f "../package.json" ]; then
        log "Installing frontend dependencies..."
        cd ..
        if command -v pnpm &> /dev/null; then
            pnpm install
        else
            npm install
        fi
        cd server
    fi
}

# ==============================================================================
# Create Required Directories
# ==============================================================================
create_directories() {
    log "Creating required directories..."
    
    mkdir -p media/streams
    mkdir -p media/recordings
    
    log "Directories created:"
    log "  - media/streams   (HLS segments output)"
    log "  - media/recordings (Stream recordings)"
}

# ==============================================================================
# Setup Environment File
# ==============================================================================
setup_env() {
    log "Setting up environment..."
    
    if [ -f ".env" ]; then
        log ".env file already exists"
    else
        log "Creating .env file from template..."
        cat > .env << 'EOF'
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
MEDIA_ROOT=./media

# Node Environment
NODE_ENV=development
EOF
        log ".env file created. Please update FFMPEG_PATH if needed."
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
# Main Setup
# ==============================================================================
main() {
    echo ""
    echo "=============================================="
    echo "  Streaming Server - Local Development Setup"
    echo "=============================================="
    echo ""
    
    install_ffmpeg
    echo ""
    
    create_directories
    echo ""
    
    setup_env
    echo ""
    
    install_node_deps
    echo ""
    
    check_gpu
    echo ""
    
    echo "=============================================="
    echo "  Setup Complete!"
    echo "=============================================="
    echo ""
    log "Next steps:"
    log "  1. Update .env if needed (especially FFMPEG_PATH on Windows)"
    log "  2. Start the server: npm start"
    log "  3. Start the frontend: cd .. && npm run dev"
    echo ""
    log "Endpoints after starting:"
    log "  API Server:  http://localhost:3001"
    log "  RTMP Ingest: rtmp://localhost:1935/live/<key>"
    log "  HLS Output:  http://localhost:3001/streams/<key>_h264.m3u8"
    echo ""
}

main "$@"
