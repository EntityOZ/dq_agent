# Vantax — SAP Data Quality Agent

Vantax analyses SAP data quality across 29 modules and 254 predefined validation checks. It runs entirely inside the customer's own environment — on-premises or in their cloud VPC. SAP data, findings, and reports never leave the customer boundary.

## Prerequisites

- Docker >= 24.0
- Docker Compose >= 2.20
- curl
- git

## Quickstart

1. Clone the repository:
   ```bash
   git clone <repo-url> && cd vantax
   ```

2. Copy the environment file and fill in your values:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` with your configuration (database password, MinIO password, licence key, etc.)

4. Run the install script:
   ```bash
   ./scripts/install.sh
   ```

5. Access the dashboard at http://localhost:3000
