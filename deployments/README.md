# Deployment Records

This directory contains historical deployment records for the QIP Registry.

## Structure

- `base-mainnet-YYYYMMDD-HHMMSS.json` - Production deployments to Base mainnet
- `base-sepolia-YYYYMMDD-HHMMSS.json` - Testnet deployments  
- `latest.json` - Symlink to the most recent deployment

## Record Format

Each deployment record contains:
- Network information (chain ID, RPC URL)
- Deployment timestamp
- Contract addresses
- Deployer and admin addresses
- Transaction hashes
- Deployment status

## Usage

View the latest deployment:
```bash
cat deployments/latest.json | jq
```

Find all mainnet deployments:
```bash
ls deployments/base-mainnet-*.json
```

Get current registry address:
```bash
cat deployments/latest.json | jq -r '.contracts.QIPRegistry.address'
```