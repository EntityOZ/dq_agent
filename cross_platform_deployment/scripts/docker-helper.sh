#!/usr/bin/env bash
# =========================================================
# Meridian Platform Docker Helper
# 
# Useful Docker commands for managing the platform
# =========================================================

set -euo pipefail

ACTION="${1:-help}"

case "$ACTION" in
    "logs")
        SERVICE="${2:-}"
        if [ -n "$SERVICE" ]; then
            docker compose logs -f "$SERVICE"
        else
            docker compose logs -f
        fi
        ;;
    "status")
        docker compose ps
        ;;
    "stop")
        docker compose down
        echo "⏹️  All services stopped"
        ;;
    "start")
        docker compose up -d
        echo "▶️  All services started"
        ;;
    "restart")
        SERVICE="${2:-}"
        if [ -n "$SERVICE" ]; then
            docker compose restart "$SERVICE"
            echo "🔄 $SERVICE restarted"
        else
            docker compose restart
            echo "🔄 All services restarted"
        fi
        ;;
    "shell")
        SERVICE="${2:-api}"
        docker compose exec "$SERVICE" bash
        ;;
    "stats")
        docker stats
        ;;
    "clean")
        echo "🧹 This will remove ALL containers, images, and volumes. Are you sure? (y/N)"
        read -r CONFIRM
        if [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
            docker compose down -v
            docker system prune -af
            echo "🗑️  Docker environment cleaned"
        else
            echo "🚫 Cleanup cancelled"
        fi
        ;;
    "volumes")
        echo "📦 Meridian Volumes:"
        docker volume ls | grep meridian
        ;;
    "images")
        echo "🖼️  Meridian Images:"
        docker images | grep meridian
        ;;
    "help"|*)
        echo "🔧 Meridian Docker Helper"
        echo ""
        echo "Usage: ./scripts/docker-helper.sh [action] [service]"
        echo ""
        echo "Actions:"
        echo "  logs [service]     - Follow logs (all or specific service)"
        echo "  status             - Show service status"
        echo "  start              - Start all services"
        echo "  stop               - Stop all services"
        echo "  restart [service]  - Restart services"
        echo "  shell [service]    - Open shell in service container (default: api)"
        echo "  stats              - Show resource usage"
        echo "  volumes            - List volumes"
        echo "  images             - List images"
        echo "  clean              - Clean all Docker data (⚠️  Destructive!)"
        echo "  help               - Show this help"
        echo ""
        echo "Examples:"
        echo "  ./scripts/docker-helper.sh logs api"
        echo "  ./scripts/docker-helper.sh restart frontend"
        echo "  ./scripts/docker-helper.sh shell db"
        ;;
esac