#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔧 Setting up IPFS for QIPs Development${NC}"
echo "=============================================="

# Check if IPFS is installed
if ! command -v ipfs &> /dev/null; then
    echo -e "${RED}❌ IPFS is not installed${NC}"
    echo ""
    echo "Please install IPFS first:"
    echo ""
    echo -e "${YELLOW}macOS (Homebrew):${NC}"
    echo "  brew install ipfs"
    echo ""
    echo -e "${YELLOW}Other platforms:${NC}"
    echo "  Visit https://docs.ipfs.tech/install/"
    echo ""
    echo -e "${YELLOW}Using Go (if you have Go installed):${NC}"
    echo "  go install github.com/ipfs/kubo/cmd/ipfs@latest"
    exit 1
fi

echo -e "${GREEN}✅ IPFS is installed${NC}"
ipfs version

# Initialize IPFS if needed
if [ ! -d "$HOME/.ipfs" ]; then
    echo -e "${YELLOW}Initializing IPFS...${NC}"
    ipfs init
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Failed to initialize IPFS${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ IPFS initialized${NC}"
else
    echo -e "${GREEN}✅ IPFS already initialized${NC}"
fi

# Configure IPFS for local development
echo -e "${YELLOW}Configuring IPFS for QIPs development...${NC}"

# CORS configuration for browser access
echo -e "${BLUE}Setting up CORS headers...${NC}"
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["http://localhost:8000", "http://localhost:8080", "*"]'
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["GET", "POST", "PUT", "DELETE"]'
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Headers '["Content-Type", "Authorization"]'
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Credentials '["true"]'
ipfs config --json API.HTTPHeaders.Access-Control-Expose-Headers '["Location"]'

# Storage and performance configuration
echo -e "${BLUE}Configuring storage and performance...${NC}"
ipfs config --json Datastore.GCPeriod '"1h"'
ipfs config --json Datastore.StorageMax '"10GB"'
ipfs config --json Datastore.StorageGCWatermark '90'
ipfs config --json Datastore.BloomFilterSize '1048576'

# Network configuration for local development
echo -e "${BLUE}Configuring network settings...${NC}"
ipfs config --json Swarm.ConnMgr.LowWater '50'
ipfs config --json Swarm.ConnMgr.HighWater '200'
ipfs config --json Swarm.ConnMgr.GracePeriod '"30s"'

# Gateway configuration
echo -e "${BLUE}Configuring gateway...${NC}"
ipfs config --json Gateway.HTTPHeaders.Access-Control-Allow-Origin '["*"]'
ipfs config --json Gateway.HTTPHeaders.Access-Control-Allow-Methods '["GET"]'
ipfs config --json Gateway.HTTPHeaders.Access-Control-Allow-Headers '["X-Requested-With", "Range", "User-Agent"]'

# Disable some features that aren't needed for local development
echo -e "${BLUE}Optimizing for local development...${NC}"
ipfs config --json Experimental.FilestoreEnabled 'false'
ipfs config --json Experimental.UrlstoreEnabled 'false'
ipfs config --json Experimental.P2pHttpProxy 'false'

# Set reasonable resource limits
ipfs config --json Swarm.ResourceMgr.Enabled 'true'

echo -e "${GREEN}✅ IPFS configured for QIPs development${NC}"

# Test the configuration
echo -e "${YELLOW}Testing IPFS configuration...${NC}"

# Start daemon temporarily if not running
DAEMON_WAS_RUNNING=false
if pgrep -f "ipfs daemon" > /dev/null; then
    DAEMON_WAS_RUNNING=true
    echo -e "${GREEN}IPFS daemon is already running${NC}"
else
    echo -e "${YELLOW}Starting IPFS daemon for testing...${NC}"
    ipfs daemon > /tmp/ipfs-setup-test.log 2>&1 &
    DAEMON_PID=$!
    
    # Wait for daemon to start
    MAX_RETRIES=30
    RETRY_COUNT=0
    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        if curl -s -X POST http://localhost:5001/api/v0/version > /dev/null 2>&1; then
            break
        fi
        RETRY_COUNT=$((RETRY_COUNT + 1))
        sleep 1
    done
    
    if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
        echo -e "${RED}❌ Failed to start IPFS daemon for testing${NC}"
        kill $DAEMON_PID 2>/dev/null
        exit 1
    fi
fi

# Test basic functionality
echo -e "${YELLOW}Testing IPFS functionality...${NC}"
TEST_CONTENT="QIPs IPFS setup test - $(date)"
TEST_CID=$(echo "$TEST_CONTENT" | ipfs add -q 2>/dev/null)

if [ -z "$TEST_CID" ]; then
    echo -e "${RED}❌ IPFS upload test failed${NC}"
    if [ "$DAEMON_WAS_RUNNING" = false ]; then
        kill $DAEMON_PID 2>/dev/null
    fi
    exit 1
fi

# Test retrieval
RETRIEVED_CONTENT=$(ipfs cat "$TEST_CID" 2>/dev/null)
if [ "$RETRIEVED_CONTENT" != "$TEST_CONTENT" ]; then
    echo -e "${RED}❌ IPFS retrieval test failed${NC}"
    if [ "$DAEMON_WAS_RUNNING" = false ]; then
        kill $DAEMON_PID 2>/dev/null
    fi
    exit 1
fi

# Test gateway access
GATEWAY_RESPONSE=$(curl -s "http://localhost:8080/ipfs/$TEST_CID" 2>/dev/null)
if [ "$GATEWAY_RESPONSE" != "$TEST_CONTENT" ]; then
    echo -e "${YELLOW}⚠️  Gateway test failed, but API works${NC}"
    echo "This might be normal if the gateway takes time to start"
else
    echo -e "${GREEN}✅ Gateway test passed${NC}"
fi

# Clean up test daemon if we started it
if [ "$DAEMON_WAS_RUNNING" = false ]; then
    echo -e "${YELLOW}Stopping test daemon...${NC}"
    kill $DAEMON_PID 2>/dev/null
    sleep 2
fi

echo -e "${GREEN}✅ IPFS setup complete!${NC}"
echo ""
echo -e "${BLUE}📋 Configuration Summary:${NC}"
echo "- API endpoint: http://localhost:5001"
echo "- Gateway endpoint: http://localhost:8080"
echo "- Storage limit: 10GB"
echo "- Garbage collection: Every hour"
echo "- CORS enabled for local development"
echo ""
echo -e "${BLUE}🚀 Next Steps:${NC}"
echo "1. Start IPFS daemon: ipfs daemon"
echo "2. Run local development: ./scripts/start-local-dev.sh"
echo "3. Or check IPFS status: ./scripts/check-ipfs.sh"
echo ""
echo -e "${YELLOW}💡 Tips:${NC}"
echo "- The daemon needs to be running for QIPs development"
echo "- Use 'ipfs daemon &' to run in background"
echo "- Check logs with: tail -f ~/.ipfs/logs/*"
echo "- Reset config with: ipfs config replace ~/.ipfs/config"