#!/bin/bash

# ============================================
# API MODE - Use External Services (Production-like)
# ============================================
# This script starts the development server using external APIs
# instead of local services. This mirrors production configuration.

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🌐 Starting API Mode Development Environment${NC}"
echo "================================================"
echo "This mode uses external services:"
echo "- Mai API for IPFS storage"
echo "- Mai API for QCI data fetching (24x faster)"
echo "- Production Base RPCs for blockchain"
echo ""

# ============================================
# ENVIRONMENT CONFIGURATION
# ============================================

# Force API mode configuration
export VITE_USE_MAI_API=true
export VITE_LOCAL_MODE=false
export VITE_USE_LOCAL_IPFS=false

# API endpoints (use staging by default, can override with production)
# Support LOCAL_API flag for testing against localhost
if [ "$LOCAL_API" = "true" ]; then
    export VITE_MAI_API_URL=${VITE_MAI_API_URL:-"http://localhost:3000"}
    export VITE_IPFS_API_URL=${VITE_IPFS_API_URL:-"http://localhost:3000/v2/ipfs-upload"}
    echo -e "${YELLOW}📍 Using LOCAL Mai API at localhost:3000${NC}"
else
    export VITE_MAI_API_URL=${VITE_MAI_API_URL:-"https://staging-api.mai.finance"}
    export VITE_IPFS_API_URL=${VITE_IPFS_API_URL:-"https://staging-api.mai.finance/v2/ipfs-upload"}
fi

# Registry address (production Base network)
export VITE_QCI_REGISTRY_ADDRESS=${VITE_QCI_REGISTRY_ADDRESS:-"0xd476a2916b5BACfbB243F40CD59c4B6a7598BDF0"}

# WalletConnect (required for wallet connections)
export VITE_WALLETCONNECT_PROJECT_ID=${VITE_WALLETCONNECT_PROJECT_ID:-"07aaa3b8014f862823c152b9a472f26f"}

# Snapshot space
export VITE_SNAPSHOT_SPACE=${VITE_SNAPSHOT_SPACE:-"qidao.eth"}

if [ "$TEST_MODE" = "true" ]; then
    export VITE_SNAPSHOT_TEST_MODE=true
    export VITE_SNAPSHOT_TEST_SPACE=${VITE_SNAPSHOT_TEST_SPACE:-"testdevtest.eth"}
    echo -e "${YELLOW}📝 Snapshot TEST MODE enabled - will submit to testdevtest.eth space${NC}"
else
    export VITE_SNAPSHOT_TEST_MODE=false
fi

# Clear local-only variables to prevent conflicts
unset VITE_LOCAL_IPFS_API
unset VITE_LOCAL_IPFS_GATEWAY
unset VITE_USE_LOCAL_FILES
unset VITE_BASE_RPC_URL  # Let it use the production RPC endpoints with load balancing

# Display configuration
echo -e "${GREEN}Environment variables set for API mode:${NC}"
echo "  VITE_USE_MAI_API=true"
echo "  VITE_LOCAL_MODE=false"
echo "  VITE_USE_LOCAL_IPFS=false"
echo "  VITE_MAI_API_URL=$VITE_MAI_API_URL"
echo "  VITE_IPFS_API_URL=$VITE_IPFS_API_URL"
echo "  VITE_QCI_REGISTRY_ADDRESS=$VITE_QCI_REGISTRY_ADDRESS"
if [ "$TEST_MODE" = "true" ]; then
    echo "  VITE_SNAPSHOT_TEST_MODE=true"
    echo "  VITE_SNAPSHOT_TEST_SPACE=$VITE_SNAPSHOT_TEST_SPACE"
fi
echo ""

# ============================================
# API HEALTH CHECK
# ============================================

echo -e "${YELLOW}Checking Mai API availability...${NC}"
if curl -s -f -o /dev/null "$VITE_MAI_API_URL/health" 2>/dev/null || curl -s -f -o /dev/null "$VITE_MAI_API_URL" 2>/dev/null; then
    echo -e "${GREEN}✅ Mai API is accessible${NC}"
else
    echo -e "${YELLOW}⚠️  Warning: Mai API may not be accessible at $VITE_MAI_API_URL${NC}"
    echo "   The app will attempt to use it anyway."
    echo "   If you need local development, use: bun run dev:local"
fi

# ============================================
# START DEVELOPMENT SERVER
# ============================================

echo ""
echo -e "${GREEN}Starting Vite development server in API mode...${NC}"
echo "================================================"
echo ""
echo -e "${YELLOW}💡 Tips:${NC}"
echo "- This mode connects to the production Base network"
echo "- QCI data is fetched from Mai API (much faster)"
echo "- IPFS uploads go through Mai API"
echo "- No local services are required"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop the server${NC}"
echo ""

# Start Vite
exec bun run dev