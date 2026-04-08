#!/usr/bin/env bash
# =========================================================
# Meridian Platform Port Detection and Configuration
# 
# Dynamically finds available ports and configures deployment
# =========================================================

set -euo pipefail

# Default ports
DEFAULT_API_PORT=8000
DEFAULT_FRONTEND_PORT=3000

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
error() { echo -e "${RED}✗${NC} $*"; }

# Function to check if a port is available
is_port_available() {
    local port=$1
    
    # Cross-platform port check
    if command -v nc &>/dev/null; then
        # netcat available
        if nc -z localhost "$port" 2>/dev/null; then
            return 1  # Port in use
        else
            return 0  # Port available
        fi
    elif command -v ss &>/dev/null; then
        # ss available (Linux)
        if ss -tuln | grep -q ":$port "; then
            return 1  # Port in use
        else
            return 0  # Port available
        fi
    elif command -v lsof &>/dev/null; then
        # lsof available (macOS/Unix)
        if lsof -i :"$port" -sTCP:LISTEN >/dev/null 2>&1; then
            return 1  # Port in use
        else
            return 0  # Port available
        fi
    else
        # Fallback: try to bind to port briefly
        if command -v python3 &>/dev/null; then
            if python3 -c "import socket; s=socket.socket(); s.bind(('localhost', $port)); s.close()" 2>/dev/null; then
                return 0  # Port available
            else
                return 1  # Port in use
            fi
        else
            # Conservative approach - assume port might be in use
            return 1
        fi
    fi
}

# Function to find next available port
find_next_available_port() {
    local start_port=$1
    local port=$start_port
    
    while [ $port -lt $((start_port + 100)) ]; do
        if is_port_available "$port"; then
            echo "$port"
            return 0
        fi
        port=$((port + 1))
    done
    
    # If we can't find an available port in the range, return original
    echo "$start_port"
    return 1
}

# Function to check if Docker ports are correctly mapped
check_docker_port_mapping() {
    local service_name=$1
    local internal_port=$2
    local external_port=$3
    
    # Check if the service exposes the port correctly
    if docker-compose ps "$service_name" >/dev/null 2>&1; then
        if docker port "$(docker-compose ps -q "$service_name" 2>/dev/null)" "$internal_port" 2>/dev/null | grep -q ":$external_port"; then
            return 0
        else
            return 1
        fi
    fi
    
    return 0  # If service isn't running, assume it's okay
}

# Main port configuration
configure_ports() {
    echo "🔍 Checking port availability..."
    
    # Check API port (8000)
    if is_port_available "$DEFAULT_API_PORT"; then
        API_PORT=$DEFAULT_API_PORT
        info "API port $DEFAULT_API_PORT is available"
    else
        warn "API port $DEFAULT_API_PORT is in use"
        echo "   Searching for alternative API port..."
        API_PORT=$(find_next_available_port $((DEFAULT_API_PORT + 1)))
        if [ "$API_PORT" != "$DEFAULT_API_PORT" ]; then
            info "Using alternative API port: $API_PORT"
        else
            error "Could not find available API port near $DEFAULT_API_PORT"
        fi
    fi
    
    # Check Frontend port (3000)
    if is_port_available "$DEFAULT_FRONTEND_PORT"; then
        FRONTEND_PORT=$DEFAULT_FRONTEND_PORT
        info "Frontend port $DEFAULT_FRONTEND_PORT is available"
    else
        warn "Frontend port $DEFAULT_FRONTEND_PORT is in use"
        echo "   Searching for alternative frontend port..."
        FRONTEND_PORT=$(find_next_available_port $((DEFAULT_FRONTEND_PORT + 1)))
        if [ "$FRONTEND_PORT" != "$DEFAULT_FRONTEND_PORT" ]; then
            info "Using alternative frontend port: $FRONTEND_PORT"
        else
            error "Could not find available frontend port near $DEFAULT_FRONTEND_PORT"
        fi
    fi
    
    # Export for use in other scripts
    export MERIDIAN_API_PORT=$API_PORT
    export MERIDIAN_FRONTEND_PORT=$FRONTEND_PORT
    
    echo ""
    echo "📋 Port Configuration:"
    echo "   API Port:      $API_PORT"
    echo "   Frontend Port: $FRONTEND_PORT"
    echo ""
    
    # Update .env file with port configuration
    if [ -f "meridian.env" ]; then
        # Backup original file
        cp meridian.env meridian.env.bak 2>/dev/null || true
        
        # Update port configuration comments in .env
        if ! grep -q "# Port Configuration" meridian.env; then
            echo "" >> meridian.env
            echo "# Port Configuration" >> meridian.env
            echo "# API will be accessible on host port $API_PORT" >> meridian.env
            echo "# Frontend will be accessible on host port $FRONTEND_PORT" >> meridian.env
        fi
    fi
    
    return 0
}

# Function to update docker-compose.yml with dynamic ports
update_docker_compose_ports() {
    local compose_file="${1:-docker-compose.yml}"
    
    if [ ! -f "$compose_file" ]; then
        error "Docker Compose file not found: $compose_file"
        return 1
    fi
    
    echo "🔧 Updating Docker Compose with selected ports..."
    
    # Create a temporary copy of the compose file
    TEMP_COMPOSE="${compose_file}.tmp"
    cp "$compose_file" "$TEMP_COMPOSE"
    
    # Update API ports using sed
    if [ "$DEFAULT_API_PORT" != "$MERIDIAN_API_PORT" ]; then
        sed -i.bak "s/${DEFAULT_API_PORT}:${DEFAULT_API_PORT}/${MERIDIAN_API_PORT}:${DEFAULT_API_PORT}/g" "$TEMP_COMPOSE"
        info "Updated API port mapping: $DEFAULT_API_PORT → $MERIDIAN_API_PORT"
    else
        info "API port unchanged: $DEFAULT_API_PORT"
    fi
    
    # Update Frontend ports
    if [ "$DEFAULT_FRONTEND_PORT" != "$MERIDIAN_FRONTEND_PORT" ]; then
        sed -i.bak "s/${DEFAULT_FRONTEND_PORT}:${DEFAULT_FRONTEND_PORT}/${MERIDIAN_FRONTEND_PORT}:${DEFAULT_FRONTEND_PORT}/g" "$TEMP_COMPOSE"
        info "Updated frontend port mapping: $DEFAULT_FRONTEND_PORT → $MERIDIAN_FRONTEND_PORT"
    else
        info "Frontend port unchanged: $DEFAULT_FRONTEND_PORT"
    fi
    
    # Replace the original file
    mv "$TEMP_COMPOSE" "$compose_file"
    
    # Clean up backup if it exists
    rm -f "${compose_file}.bak" "${TEMP_COMPOSE}.bak"
    
    return 0
}

# Port selection wizard for interactive setup
port_selection_wizard() {
    echo "🔧 Port Selection Wizard"
    echo ""
    
    # Check API port
    echo "API Service Port (default: $DEFAULT_API_PORT)"
    read -p "Enter preferred API port [$DEFAULT_API_PORT]: " USER_API_PORT
    USER_API_PORT=${USER_API_PORT:-$DEFAULT_API_PORT}
    
    # Validate API port
    if ! [[ "$USER_API_PORT" =~ ^[0-9]+$ ]] || [ "$USER_API_PORT" -lt 1024 ] || [ "$USER_API_PORT" -gt 65535 ]; then
        warn "Invalid port number. Using default: $DEFAULT_API_PORT"
        USER_API_PORT=$DEFAULT_API_PORT
    fi
    
    # Check if user-selected port is available
    if [ "$USER_API_PORT" != "$DEFAULT_API_PORT" ]; then
        if is_port_available "$USER_API_PORT"; then
            info "Port $USER_API_PORT is available"
            API_PORT=$USER_API_PORT
        else
            warn "Port $USER_API_PORT is in use"
            FREE_API_PORT=$(find_next_available_port "$USER_API_PORT")
            if [ "$FREE_API_PORT" != "$USER_API_PORT" ]; then
                echo "   Suggesting alternative: $FREE_API_PORT"
                read -p "Use port $FREE_API_PORT instead? (Y/n): " USE_FREE
                USE_FREE=${USE_FREE:-Y}
                if [[ "$USE_FREE" =~ ^[Yy]$ ]]; then
                    API_PORT=$FREE_API_PORT
                else
                    API_PORT=$USER_API_PORT  # Use anyway, user's choice
                fi
            else
                API_PORT=$USER_API_PORT  # Use anyway
            fi
        fi
    else
        if is_port_available "$API_PORT"; then
            info "Using default API port: $API_PORT"
        else
            FREE_API_PORT=$(find_next_available_port "$API_PORT")
            warn "Default API port $API_PORT is in use"
            warn "Using alternative API port: $FREE_API_PORT"
            API_PORT=$FREE_API_PORT
        fi
    fi
    
    # Check Frontend port
    echo ""
    echo "Frontend Service Port (default: $DEFAULT_FRONTEND_PORT)"
    read -p "Enter preferred frontend port [$DEFAULT_FRONTEND_PORT]: " USER_FRONTEND_PORT
    USER_FRONTEND_PORT=${USER_FRONTEND_PORT:-$DEFAULT_FRONTEND_PORT}
    
    # Validate Frontend port
    if ! [[ "$USER_FRONTEND_PORT" =~ ^[0-9]+$ ]] || [ "$USER_FRONTEND_PORT" -lt 1024 ] || [ "$USER_FRONTEND_PORT" -gt 65535 ]; then
        warn "Invalid port number. Using default: $DEFAULT_FRONTEND_PORT"
        USER_FRONTEND_PORT=$DEFAULT_FRONTEND_PORT
    fi
    
    # Check if user-selected port is available
    if [ "$USER_FRONTEND_PORT" != "$DEFAULT_FRONTEND_PORT" ]; then
        if is_port_available "$USER_FRONTEND_PORT"; then
            info "Port $USER_FRONTEND_PORT is available"
            FRONTEND_PORT=$USER_FRONTEND_PORT
        else
            warn "Port $USER_FRONTEND_PORT is in use"
            FREE_FRONTEND_PORT=$(find_next_available_port "$USER_FRONTEND_PORT")
            if [ "$FREE_FRONTEND_PORT" != "$USER_FRONTEND_PORT" ]; then
                echo "   Suggesting alternative: $FREE_FRONTEND_PORT"
                read -p "Use port $FREE_FRONTEND_PORT instead? (Y/n): " USE_FREE_F
                USE_FREE_F=${USE_FREE_F:-Y}
                if [[ "$USE_FREE_F" =~ ^[Yy]$ ]]; then
                    FRONTEND_PORT=$FREE_FRONTEND_PORT
                else
                    FRONTEND_PORT=$USER_FRONTEND_PORT  # Use anyway, user's choice
                fi
            else
                FRONTEND_PORT=$USER_FRONTEND_PORT  # Use anyway
            fi
        fi
    else
        if is_port_available "$FRONTEND_PORT"; then
            info "Using default frontend port: $FRONTEND_PORT"
        else
            FREE_FRONTEND_PORT=$(find_next_available_port "$FRONTEND_PORT")
            warn "Default frontend port $FRONTEND_PORT is in use"
            warn "Using alternative frontend port: $FREE_FRONTEND_PORT"
            FRONTEND_PORT=$FREE_FRONTEND_PORT
        fi
    fi
    
    # Export final selections
    export MERIDIAN_API_PORT=$API_PORT
    export MERIDIAN_FRONTEND_PORT=$FRONTEND_PORT
    
    echo ""
    echo "✅ Final Port Configuration:"
    echo "   API Port:      $MERIDIAN_API_PORT"
    echo "   Frontend Port: $MERIDIAN_FRONTEND_PORT"
    echo ""
    
    return 0
}

# Parse command line arguments
ACTION="${1:-auto}"

case "$ACTION" in
    "wizard")
        port_selection_wizard
        update_docker_compose_ports
        ;;
    "auto")
        configure_ports
        if [ "$DEFAULT_API_PORT" != "$MERIDIAN_API_PORT" ] || [ "$DEFAULT_FRONTEND_PORT" != "$MERIDIAN_FRONTEND_PORT" ]; then
            update_docker_compose_ports
        fi
        ;;
    *)
        echo "Usage: $0 [auto|wizard]"
        echo "  auto    - Automatically detect and configure available ports"
        echo "  wizard  - Interactive port selection wizard"
        echo ""
        echo "Environment Variables:"
        echo "  MERIDIAN_API_PORT      - Override default API port (8000)"
        echo "  MERIDIAN_FRONTEND_PORT - Override default frontend port (3000)"
        exit 1
        ;;
esac

echo "🔧 Port configuration complete!"