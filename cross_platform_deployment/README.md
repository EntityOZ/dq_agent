# Meridian Platform Cross-Platform Deployment Package

This deployment package allows you to install and run the Meridian Platform on Windows, Linux, or macOS systems using Docker containers.

## Overview

Meridian is an enterprise SAP Data Quality and Master Data Management platform that runs entirely on your own infrastructure. It includes:

- **Dashboard** - Web interface for data quality analysis and governance
- **API Backend** - Core processing engine and SAP connectivity
- **Analytics Engine** - Background workers for data analysis
- **Local AI** - On-premise language model for insights (Ollama)
- **Supporting Services** - Database, cache, and file storage

## System Requirements

### All Platforms
- Docker Engine 24.0+ with Docker Compose V2
- Minimum 8GB RAM (16GB+ recommended)
- At least 20GB free disk space
- Internet connectivity for initial image download

### Hardware Recommendations
- CPU: 4+ cores
- RAM: 16GB minimum for local AI (32GB recommended)
- Storage: 50GB+ SSD storage

## Dynamic Port Configuration

The deployment automatically detects if ports 8000 (API) and 3000 (Frontend) are in use and will automatically select alternative available ports:

- **API Port:** 8000 (automatically incremented if in use)
- **Frontend Port:** 3000 (automatically incremented if in use)

Port configurations are displayed during setup and stored in environment variables for Docker Compose to use.

## Deployment

### Automated Setup (Recommended)
Run the appropriate setup script for your platform:

**Linux/macOS:**
```bash
chmod +x setup.sh
./setup.sh
```

**Windows:**
Double-click `setup.bat` or run from Command Prompt:
```cmd
setup.bat
```

### Manual Deployment Instructions

1. **Review Configuration**
   Edit `meridian.env` to customize your deployment:
   ```bash
   nano meridian.env  # or use your preferred editor
   ```

2. **Set Secure Passwords**
   Update critical passwords in:
   - `db_password.txt` (database password)
   - `meridian.env` (MinIO, JWT secrets)

3. **Authenticate with GitHub Registry**
   ```bash
   docker login ghcr.io
   # Use your personal access token with read:packages scope
   ```

4. **Pull Images**
   ```bash
   docker compose pull
   ```

5. **Start Services**
   ```bash
   docker compose up -d
   ```

6. **Initialize Database (First Run Only)**
   ```bash
   docker compose exec api alembic upgrade head
   ```

7. **Create Admin User**
   ```bash
   docker compose exec api python scripts/manage_users.py create \
     --email admin@company.com \
     --name "Admin User" \
     --password "SecurePassword123!" \
     --role admin
   ```

## Accessing Meridian

Once deployment is complete, the platform will be available at the configured ports:

- **Web Dashboard:** http://localhost:[PORT] (default: 3000, or next available)
- **API Documentation:** http://localhost:[PORT]/docs (default: 8000, or next available)
- **Health Check:** http://localhost:[PORT]/health (default: 8000, or next available)

The specific ports will be displayed during setup. To find the current ports:

```bash
# Check API port
echo "API Port: ${MERIDIAN_API_PORT:-8000}"

# Check Frontend port
echo "Frontend Port: ${MERIDIAN_FRONTEND_PORT:-3000}"
```

Default credentials (change after first login): _Use the admin account you created_

## Platform-Specific Notes

### Linux
- Install Docker: `curl -fsSL https://get.docker.com | sh`
- Add user to docker group: `sudo usermod -aG docker $USER`
- Log out and back in for group changes to take effect

### Windows
- Requires Docker Desktop with WSL 2 backend (recommended)
- Enable Windows Subsystem for Linux feature
- Windows Firewall may require rule adjustments for ports 3000 and 8000

### macOS
- Install Docker Desktop for Mac (Intel or Apple Silicon)
- Usually works out-of-the-box with no special configuration
- On Apple Silicon, Rosetta 2 may be helpful for some images

## Troubleshooting

### Common Issues

**Images won't pull**
```
Error response from daemon: unauthorized: GitHub registry authentication required
```
Solution: Run `docker login ghcr.io` and provide a personal access token.

**Database connection failures**
```
Cannot connect to database
```
Solution: Check passwords in `meridian.env` and `db_password.txt`

**Containers fail health checks**
```
container failed to start: unhealthy
```
Solutions:
- Check available system resources (RAM, disk space)
- View logs: `docker compose logs [servicename]`
- Give services time to initialize (can take several minutes)

**Port conflicts**
```
Error response from daemon: Ports are not available
```
Solutions:
- The automatic port detection should handle most cases
- Manually set ports using environment variables:
  ```bash
  export MERIDIAN_API_PORT=8001
  export MERIDIAN_FRONTEND_PORT=3001
  docker compose up -d
  ```

### Useful Commands

**Check service status:**
```bash
docker compose ps
```

**View service logs:**
```bash
docker compose logs -f  # all services
docker compose logs -f api  # specific service
```

**Stop services:**
```bash
docker compose down
```

**Restart specific service:**
```bash
docker compose restart api
```

**Update to newer version:**
```bash
docker compose pull
docker compose up -d
docker compose exec api alembic upgrade head
```

## Updating Meridian

To update to a newer version of Meridian:

1. Pull the latest images:
```bash
docker compose pull
```

2. Stop and recreate containers:
```bash
docker compose down
docker compose up -d
```

3. Apply any database migrations:
```bash
docker compose exec api alembic upgrade head
```

## Backups

Regular backups are essential for production deployments.

**Database backup:**
```bash
docker compose exec db pg_dump -U meridian meridian > backup-$(date +%Y%m%d).sql
```

**Configuration backup:**
```bash
cp meridian.env meridian.env.backup
cp db_password.txt db_password.txt.backup
```

## Security Best Practices

1. **Change all default passwords** in `meridian.env` and `db_password.txt`
2. **Use strong, unique secrets** for JWT_SECRET and CREDENTIAL_MASTER_KEY
3. **Enable HTTPS** with a reverse proxy in production
4. **Restrict network access** to ports 3000 and 8000
5. **Keep Docker and Meridian updated** to latest versions
6. **Regular backups** of data and configurations

## Support

For assistance with deployment, contact Vantax Support:

📧 Email: support@vantax.co.za  
🌐 Docs: https://docs.meridian.vantax.co.za  
📞 Emergency: Call your account manager  

---

**© 2026 Vantax Technologies. All rights reserved.**

Licensed software. Unauthorized distribution is prohibited.