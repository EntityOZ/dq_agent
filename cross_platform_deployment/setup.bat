@echo off
REM =========================================================
REM Meridian Platform Setup Assistant for Windows
REM =========================================================

title Meridian Platform Setup

color 0A

echo.
echo ===============================================================================
echo                    MERIDIAN PLATFORM SETUP ASSISTANT                        
echo           SAP Data Quality & Master Data Management Platform                
echo                                                                              
echo                   Compatible with Windows Systems                           
echo              (c) 2026 Vantax Technologies. All rights reserved.              
echo ===============================================================================
echo.

REM Check if running as administrator
net session >nul 2>&1
if %errorLevel% NEQ 0 (
    echo Warning: Some operations may require administrator privileges.
    echo You may need to 'Run as Administrator' for full functionality.
    echo.
)

REM Check if Docker is installed
docker --version >nul 2>&1
if %errorLevel% NEQ 0 (
    echo Error: Docker is not installed or not in PATH.
    echo.
    echo Please install Docker Desktop for Windows:
    echo https://www.docker.com/products/docker-desktop/
    echo.
    echo After installation, make sure Docker is running and try again.
    echo.
    pause
    exit /b 1
)

REM Check Docker version
for /f "delims=" %%i in ('docker --version') do set DOCKER_VERSION=%%i
echo Found: %DOCKER_VERSION%

REM Check if Docker Compose is available
docker compose version >nul 2>&1
if %errorLevel% NEQ 0 (
    echo Error: Docker Compose is not available.
    echo Please upgrade to Docker Desktop with Compose V2 support.
    echo.
    pause
    exit /b 1
)

REM Display Docker Compose version
for /f "delims=" %%i in ('docker compose version') do set COMPOSE_VERSION=%%i
echo Found: %COMPOSE_VERSION%
echo.

echo Setup preparation successful!
echo.

echo Next steps:
echo 1. Review and modify meridian.env configuration file
echo 2. Update passwords in db_password.txt
echo 3. Run: docker login ghcr.io
echo 4. Run: docker compose pull
echo 5. Run: docker compose up -d
echo.

echo For detailed instructions, please refer to the instructions in setup.sh or
echo the documentation at https://docs.meridian.vantax.co.za
echo.

pause