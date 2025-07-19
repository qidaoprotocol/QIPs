#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Checking IPFS installation...${NC}"

# Check if IPFS is installed
if command -v ipfs &> /dev/null; then
    echo -e "${GREEN}✅ IPFS is installed${NC}"
    ipfs version
else
    echo -e "${RED}❌ IPFS is not installed${NC}"
    echo ""
    echo "To install IPFS, you can:"
    echo ""
    echo "1. Using Homebrew (macOS):"
    echo "   brew install ipfs"
    echo ""
    echo "2. Using the official installer:"
    echo "   Visit https://docs.ipfs.tech/install/"
    echo ""
    echo "3. Using Go (if you have Go installed):"
    echo "   go install github.com/ipfs/kubo/cmd/ipfs@latest"
    exit 1
fi

# Check if IPFS is initialized
if [ -d "$HOME/.ipfs" ]; then
    echo -e "${GREEN}✅ IPFS is initialized${NC}"
else
    echo -e "${YELLOW}⚠️  IPFS is not initialized${NC}"
    echo "Run: ipfs init"
fi

# Check if IPFS daemon is running
if pgrep -x "ipfs" > /dev/null; then
    echo -e "${GREEN}✅ IPFS daemon is running${NC}"
    
    # Check if API is accessible
    if curl -s -X POST http://localhost:5001/api/v0/version > /dev/null 2>&1; then
        echo -e "${GREEN}✅ IPFS API is accessible at http://localhost:5001${NC}"
    else
        echo -e "${RED}❌ IPFS API is not accessible${NC}"
    fi
    
    # Check if Gateway is accessible
    if curl -s http://localhost:8080/ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG > /dev/null 2>&1; then
        echo -e "${GREEN}✅ IPFS Gateway is accessible at http://localhost:8080${NC}"
    else
        echo -e "${YELLOW}⚠️  IPFS Gateway is not accessible${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  IPFS daemon is not running${NC}"
    echo "To start IPFS daemon:"
    echo "   ipfs daemon"
    echo ""
    echo "Or to run in background:"
    echo "   ipfs daemon &"
fi

echo ""
echo -e "${YELLOW}IPFS Configuration for CORS (required for browser access):${NC}"
echo "Run these commands to configure IPFS for local development:"
echo ""
echo "ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '[\"http://localhost:3000\", \"http://localhost:8545\", \"*\"]'"
echo "ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '[\"PUT\", \"POST\", \"GET\"]'"
echo "ipfs config --json API.HTTPHeaders.Access-Control-Allow-Headers '[\"Authorization\"]'"
echo "ipfs config --json API.HTTPHeaders.Access-Control-Expose-Headers '[\"Location\"]'"
echo "ipfs config --json API.HTTPHeaders.Access-Control-Allow-Credentials '[\"true\"]'"