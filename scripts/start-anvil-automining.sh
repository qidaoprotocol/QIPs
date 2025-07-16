#!/bin/bash

# Start Anvil with auto-mining enabled
echo "Starting Anvil with auto-mining enabled..."

# Kill any existing Anvil process
pkill -f anvil || true

# Start Anvil with:
# - Auto-mining enabled (default)
# - Block time of 2 seconds
# - Fork from Base mainnet
# - Deterministic addresses
anvil \
  --fork-url https://mainnet.base.org \
  --chain-id 8453 \
  --block-time 2 \
  --accounts 10 \
  --balance 10000 \
  --mnemonic "test test test test test test test test test test test junk" \
  --port 8545 \
  --host 0.0.0.0

echo "Anvil started with auto-mining enabled on port 8545"