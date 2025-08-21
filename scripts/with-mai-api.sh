#!/bin/bash

# Helper script to run development with Mai API instead of local IPFS

# Colors for output
YELLOW='\033[1;33m'
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting QIPs with Mai API Integration${NC}"
echo "=========================================="

# Check if mai-api is running
echo -e "${YELLOW}Checking Mai API endpoint...${NC}"
if curl -s -f http://localhost:3001/v2/ipfs-upload -X POST \
  -H "Content-Type: application/json" \
  -d '{}' > /dev/null 2>&1 || [ $? -eq 22 ]; then
  echo -e "${GREEN}✅ Mai API is responding on port 3001${NC}"
else
  echo -e "${RED}❌ Mai API is not running!${NC}"
  echo ""
  echo "Please start it first:"
  echo "  cd ../mai-api"
  echo "  yarn start-dev"
  echo ""
  echo "Make sure PINATA_JWT is configured in mai-api/.env"
  exit 1
fi

# Run the local dev script without requiring IPFS
echo -e "${GREEN}Starting local development environment...${NC}"
USE_LOCAL_IPFS=false exec ./scripts/start-local-dev.sh "$@"