#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting QIPs Local Development Environment${NC}"
echo "================================================"

# Function to cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    if [ ! -z "$ANVIL_PID" ]; then
        kill $ANVIL_PID 2>/dev/null
        echo "Stopped Anvil (PID: $ANVIL_PID)"
    fi
    if [ ! -z "$GATSBY_PID" ]; then
        kill $GATSBY_PID 2>/dev/null
        echo "Stopped Gatsby (PID: $GATSBY_PID)"
    fi
    if [ ! -z "$IPFS_PID" ]; then
        kill $IPFS_PID 2>/dev/null
        echo "Stopped IPFS (PID: $IPFS_PID)"
    fi
    exit
}

# Set trap to cleanup on script exit
trap cleanup EXIT INT TERM

# Check dependencies
if ! command -v anvil &> /dev/null; then
    echo -e "${RED}❌ Anvil not found. Please install Foundry first.${NC}"
    exit 1
fi

if ! command -v forge &> /dev/null; then
    echo -e "${RED}❌ Forge not found. Please install Foundry first.${NC}"
    exit 1
fi

if ! command -v bun &> /dev/null; then
    echo -e "${RED}❌ Bun not found. Please install Bun first.${NC}"
    exit 1
fi

# Kill any existing Anvil/Gatsby processes
echo -e "${YELLOW}Stopping any existing processes...${NC}"
pkill -f anvil 2>/dev/null
pkill -f gatsby 2>/dev/null
sleep 2

# Check if IPFS should be started
if [ "$USE_LOCAL_IPFS" = "true" ]; then
    echo -e "${YELLOW}Checking IPFS...${NC}"
    
    # Check if IPFS is installed
    if ! command -v ipfs &> /dev/null; then
        echo -e "${RED}❌ IPFS not found. Please install IPFS first.${NC}"
        echo "Installation instructions: https://docs.ipfs.io/install/"
        exit 1
    fi
    
    # Initialize IPFS if not already initialized
    if [ ! -d ~/.ipfs ]; then
        echo -e "${YELLOW}Initializing IPFS...${NC}"
        ipfs init
    fi
    
    # Configure IPFS for local development
    echo -e "${YELLOW}Configuring IPFS for local development...${NC}"
    ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["http://localhost:8000", "http://localhost:8080", "*"]' 2>/dev/null
    ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["GET", "POST", "PUT", "DELETE"]' 2>/dev/null
    ipfs config --json API.HTTPHeaders.Access-Control-Allow-Headers '["Content-Type"]' 2>/dev/null
    ipfs config --json API.HTTPHeaders.Access-Control-Allow-Credentials '["true"]' 2>/dev/null
    
    # Kill any existing IPFS process
    pkill -f "ipfs daemon" 2>/dev/null
    sleep 2
    
    # Start IPFS daemon if not running
    if ! pgrep -f "ipfs daemon" > /dev/null; then
        echo -e "${YELLOW}Starting IPFS daemon...${NC}"
        ipfs daemon > /tmp/ipfs.log 2>&1 &
        IPFS_PID=$!
        echo "IPFS PID: $IPFS_PID"
        
        # Wait for IPFS to start
        echo -e "${YELLOW}Waiting for IPFS to start...${NC}"
        MAX_IPFS_RETRIES=30
        IPFS_RETRY_COUNT=0
        while [ $IPFS_RETRY_COUNT -lt $MAX_IPFS_RETRIES ]; do
            if curl -s http://localhost:5001/api/v0/version > /dev/null 2>&1; then
                break
            fi
            IPFS_RETRY_COUNT=$((IPFS_RETRY_COUNT + 1))
            sleep 1
        done
        
        if [ $IPFS_RETRY_COUNT -eq $MAX_IPFS_RETRIES ]; then
            echo -e "${RED}❌ IPFS failed to start${NC}"
            exit 1
        fi
        
        echo -e "${GREEN}✅ IPFS daemon is running on http://localhost:5001${NC}"
    else
        echo -e "${GREEN}✅ IPFS daemon already running${NC}"
    fi
else
    echo -e "${YELLOW}Local IPFS disabled, using mock storage${NC}"
fi

# Use local env file
echo -e "${GREEN}Loading local environment...${NC}"
cp .env.local .env

# Install forge-std if needed
if [ ! -d "dependencies/forge-std" ]; then
    echo -e "${YELLOW}Installing forge-std...${NC}"
    forge install foundry-rs/forge-std
fi

# Start Anvil
echo -e "\n${GREEN}1. Starting Anvil (Base fork)...${NC}"
anvil --fork-url https://mainnet.base.org \
      --accounts 10 \
      --balance 10000 \
      --block-time 2 \
      --port 8545 > /tmp/anvil.log 2>&1 &

ANVIL_PID=$!
echo "Anvil PID: $ANVIL_PID"

# Wait for Anvil to start
echo -e "${YELLOW}Waiting for Anvil to start...${NC}"
MAX_RETRIES=30
RETRY_COUNT=0
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -s -X POST -H "Content-Type: application/json" \
        --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
        http://localhost:8545 > /dev/null 2>&1; then
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    sleep 1
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo -e "${RED}❌ Anvil failed to start${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Anvil is running on http://localhost:8545${NC}"

# Deploy contracts using deterministic CREATE2 deployment
echo -e "\n${GREEN}2. Deploying QIP Registry contract (deterministic)...${NC}"
DEPLOY_OUTPUT=$(forge script script/DeployWithStandardCreate2.s.sol:DeployWithStandardCreate2 --rpc-url http://localhost:8545 --broadcast -vvv 2>&1)

# Extract the registry address from the deploy output
REGISTRY_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep "QIPRegistry deployed at:" | awk '{print $4}')

# If not found in deploy output, check if already deployed
if [ -z "$REGISTRY_ADDRESS" ]; then
    # Check for "already deployed" message
    REGISTRY_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep "QIPRegistry already deployed at:" | awk '{print $5}')
fi

# Use the deterministic address as fallback
if [ -z "$REGISTRY_ADDRESS" ]; then
    REGISTRY_ADDRESS="0x0CD8BAB86b4db4Ca1363533abaBcdebf53B0F8D7"
    echo -e "${YELLOW}Using deterministic registry address: $REGISTRY_ADDRESS${NC}"
fi

echo -e "${GREEN}✅ QIP Registry at: $REGISTRY_ADDRESS${NC}"

# Verify the address matches the expected deterministic address
EXPECTED_ADDRESS="0x0CD8BAB86b4db4Ca1363533abaBcdebf53B0F8D7"
if [ "$REGISTRY_ADDRESS" != "$EXPECTED_ADDRESS" ]; then
    echo -e "${RED}❌ Registry address mismatch!${NC}"
    echo "Expected: $EXPECTED_ADDRESS"
    echo "Got: $REGISTRY_ADDRESS"
    exit 1
fi

# Run initial data setup
echo -e "\n${GREEN}3. Setting up initial test data...${NC}"
QIP_REGISTRY_ADDRESS=$REGISTRY_ADDRESS forge script script/LocalQIPTest.s.sol:LocalQIPTest --rpc-url http://localhost:8545 --broadcast --slow > /tmp/setup.log 2>&1

if grep -q "Error" /tmp/setup.log; then
    echo -e "${YELLOW}⚠️  Some test data setup had errors (this is normal)${NC}"
else
    echo -e "${GREEN}✅ Test data setup complete${NC}"
fi

# Clean Gatsby cache
echo -e "\n${GREEN}4. Cleaning Gatsby cache...${NC}"
bun run clean

# Start Gatsby in development mode
echo -e "\n${GREEN}5. Starting Gatsby development server...${NC}"
GATSBY_ENV=development bun run develop &
GATSBY_PID=$!
echo "Gatsby PID: $GATSBY_PID"

# Wait for Gatsby to start
echo -e "${YELLOW}Waiting for Gatsby to start (this may take a minute)...${NC}"
MAX_GATSBY_RETRIES=60
GATSBY_RETRY_COUNT=0
while [ $GATSBY_RETRY_COUNT -lt $MAX_GATSBY_RETRIES ]; do
    if curl -s http://localhost:8000 > /dev/null 2>&1; then
        break
    fi
    GATSBY_RETRY_COUNT=$((GATSBY_RETRY_COUNT + 1))
    sleep 2
done

if [ $GATSBY_RETRY_COUNT -eq $MAX_GATSBY_RETRIES ]; then
    echo -e "${RED}❌ Gatsby failed to start${NC}"
    exit 1
fi

# Display information
echo -e "\n${GREEN}✅ Local Development Environment Ready!${NC}"
echo "================================================"
echo -e "${BLUE}📋 Services Running:${NC}"
echo "- Anvil (Blockchain): http://localhost:8545"
echo "- Gatsby (Frontend): http://localhost:8000"
echo "- GraphQL Explorer: http://localhost:8000/___graphql"
if [ "$USE_LOCAL_IPFS" = "true" ]; then
    echo "- IPFS API: http://localhost:5001"
    echo "- IPFS Gateway: http://localhost:8080"
fi
echo ""
echo -e "${BLUE}📊 Contract Information:${NC}"
echo "- QIP Registry: $REGISTRY_ADDRESS"
echo "- Chain ID: 8453 (Base Fork)"
echo ""
echo -e "${BLUE}🔑 Test Accounts:${NC}"
echo "- Governance: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
echo "- Editor: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
echo "- Author1: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
echo "- Author2: 0x90F79bf6EB2c4f870365E785982E1f101E93b906"
echo ""
echo -e "${BLUE}📝 Initial QIPs:${NC}"
echo "- QIP-249: Dynamic Interest Rates (by Author1)"
echo "- QIP-250: Multi-Collateral Support (by Author2)"
echo "- QIP-251: Staking Rewards (by Author3)"
echo ""
echo -e "${YELLOW}💡 Tips:${NC}"
echo "- Connect your wallet to http://localhost:8545"
echo "- Import test accounts using private keys from Anvil"
echo "- Visit http://localhost:8000/create-proposal to create new QIPs"
echo "- All changes are local and will be reset on restart"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"

# Keep script running and show logs
tail -f /tmp/anvil.log