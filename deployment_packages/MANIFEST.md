# Meridian Platform Cross-Platform Deployment Package Manifest

**Version:** 1.0  
**Date:** April 2026  
**Compatible Platforms:** Windows, Linux, macOS

## Package Contents

```
meridian-cross-platform-deployment/
├── README.md                        # Deployment instructions and documentation
├── setup.sh                         # Primary setup script for Linux/macOS
├── setup.bat                        # Setup script for Windows
├── meridian.env                     # Main configuration file
├── db_password.txt                  # Database password file (change before production)
├── docker-compose.yml              # Docker Compose configuration
├── scripts/                         # Utility scripts
│   ├── backup.sh                   # Backup database and configurations
│   ├── update.sh                   # Update to latest versions
│   ├── healthcheck.sh              # Health check for all services
│   └── docker-helper.sh            # Docker management helpers
└── config/                          # Configuration examples (empty)
```

## Deployment Requirements

### All Platforms
- Docker Engine 24.0+ with Docker Compose V2
- Internet connectivity for initial image downloads
- Minimum 8GB RAM (16GB+ recommended)
- 20GB+ free disk space

## Quick Start Guide

### Linux/macOS
```bash
chmod +x setup.sh
./setup.sh
```

### Windows
Double-click `setup.bat` or run from Command Prompt:
```cmd
setup.bat
```

Follow the on-screen instructions to complete deployment.

## Support
For issues with deployment, contact:
📧 Email: support@vantax.co.za  
🌐 Documentation: https://docs.meridian.vantax.co.za

© 2026 Vantax Technologies. All rights reserved.