#!/bin/bash
# ==============================================================================
# Start Streaming Server (Background Process)
# ==============================================================================

PROJECT_DIR="/opt/streaming-server"

# Ensure we are in the correct directory if it exists on this system
if [ -d "$PROJECT_DIR" ]; then
    cd "$PROJECT_DIR"
fi

# Check for Docker Compose
if ! command -v docker &> /dev/null; then
    echo "Error: Docker not found. Please run setup_infra.sh first."
    exit 1
fi

echo "==========================================="
echo " Starting Streaming Server Stack..."
echo "==========================================="

# Stop existing containers if running (to ensure clean restart)
echo "Stopping any existing instances..."
docker compose down --remove-orphans 2>/dev/null || docker-compose down --remove-orphans 2>/dev/null

# Clean up Dangling resources (Optional, good for fresh start)
# docker system prune -f 

# Start in Background (-d)
echo "Building and Starting containers..."
# Try 'docker compose' (v2) first, then 'docker-compose' (v1)
if docker compose version &>/dev/null; then
    docker compose up -d --build
else
    docker-compose up -d --build
fi

echo ""
echo "==========================================="
echo " Server IS LIVE (Background)"
echo "==========================================="
echo " Playback config: Nginx with CDN caching"
echo " Monitoring: 'docker compose logs -f'"
echo "==========================================="
