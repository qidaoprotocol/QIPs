#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting QIPs Local Development Environment (Vite)${NC}"
echo "================================================"

# Function to cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    
    # Kill processes if they exist
    if [ ! -z "$ANVIL_PID" ]; then
        kill $ANVIL_PID 2>/dev/null
    fi
    if [ ! -z "$IPFS_PID" ]; then
        kill $IPFS_PID 2>/dev/null
    fi
    if [ ! -z "$VITE_PID" ]; then
        kill $VITE_PID 2>/dev/null
    fi
    
    # Kill any remaining processes
    pkill -f "anvil" 2>/dev/null
    pkill -f "ipfs daemon" 2>/dev/null
    pkill -f "vite" 2>/dev/null
    
    echo -e "${GREEN}✅ Cleanup complete${NC}"
    exit 0
}

# Set up trap to cleanup on script exit
trap cleanup EXIT INT TERM

# Check if --migrate flag is passed
MIGRATE_FLAG=false
if [[ "$1" == "--migrate" ]]; then
    MIGRATE_FLAG=true
fi

# Stop any existing processes
echo -e "${YELLOW}Stopping any existing processes...${NC}"
pkill -f "anvil" 2>/dev/null
pkill -f "ipfs daemon" 2>/dev/null
pkill -f "vite" 2>/dev/null

# Check if IPFS is installed
echo -e "${YELLOW}Checking IPFS (required for local development)...${NC}"
if ! command -v ipfs &> /dev/null; then
    echo -e "${RED}❌ IPFS is not installed!${NC}"
    echo "Please install IPFS first:"
    echo "  brew install ipfs"
    echo "  or visit: https://docs.ipfs.tech/install/"
    exit 1
fi

# Configure IPFS for local development
echo -e "${YELLOW}Configuring IPFS for local development...${NC}"
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["http://localhost:3000", "http://localhost:8000", "http://127.0.0.1:3000", "http://127.0.0.1:8000"]' 2>/dev/null
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["GET", "POST", "PUT", "DELETE"]' 2>/dev/null
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Headers '["Authorization", "Content-Type"]' 2>/dev/null
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Credentials '["true"]' 2>/dev/null

# Start IPFS daemon
echo -e "${YELLOW}Starting IPFS daemon...${NC}"
ipfs daemon > /tmp/ipfs.log 2>&1 &
IPFS_PID=$!
echo "IPFS PID: $IPFS_PID"

# Wait for IPFS to start
echo -e "${YELLOW}Waiting for IPFS to start...${NC}"
sleep 2
for i in {1..10}; do
    if curl -s http://localhost:5001/api/v0/version > /dev/null; then
        break
    fi
    echo -n "."
    sleep 1
done
echo

# Test IPFS
echo -e "${YELLOW}Testing IPFS functionality...${NC}"
TEST_CONTENT="Hello IPFS from QIPs local dev!"
TEST_CID=$(echo "$TEST_CONTENT" | ipfs add -q 2>/dev/null)
if [ -z "$TEST_CID" ]; then
    echo -e "${RED}❌ IPFS is not working properly${NC}"
    exit 1
fi

echo -e "${GREEN}✅ IPFS daemon is running and functional${NC}"
echo -e "${GREEN}   API: http://localhost:5001${NC}"
echo -e "${GREEN}   Gateway: http://localhost:8080${NC}"
echo -e "${GREEN}   Test CID: $TEST_CID${NC}"

# Load environment variables
echo -e "${GREEN}Loading local environment...${NC}"
export GATSBY_LOCAL_MODE=true
export GATSBY_USE_LOCAL_IPFS=true
export GATSBY_LOCAL_IPFS_API=http://localhost:5001
export GATSBY_LOCAL_IPFS_GATEWAY=http://localhost:8080
export GATSBY_BASE_RPC_URL=http://localhost:8545
export GATSBY_WALLETCONNECT_PROJECT_ID=dummy-project-id

# Start Anvil
echo -e "\n${GREEN}1. Starting Anvil (Base fork)...${NC}"
anvil --fork-url https://mainnet.base.org --chain-id 8453 --block-time 2 > /tmp/anvil.log 2>&1 &
ANVIL_PID=$!
echo "Anvil PID: $ANVIL_PID"

# Wait for Anvil to start
echo -e "${YELLOW}Waiting for Anvil to start...${NC}"
sleep 3
for i in {1..10}; do
    if curl -s http://localhost:8545 > /dev/null; then
        break
    fi
    sleep 1
done

# Check if Anvil is running
if ! curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' http://localhost:8545 > /dev/null; then
    echo -e "${RED}❌ Anvil failed to start${NC}"
    echo "Check /tmp/anvil.log for details"
    exit 1
fi

echo -e "${GREEN}✅ Anvil is running on http://localhost:8545${NC}"

# Deploy contracts
echo -e "\n${GREEN}2. Deploying QIP Registry contract (deterministic)...${NC}"
cd "$(dirname "$0")/.."

# Deploy using standard CREATE2 deployment
DEPLOY_OUTPUT=$(forge script script/DeployWithStandardCreate2.s.sol:DeployWithStandardCreate2 --rpc-url http://localhost:8545 --broadcast --slow 2>&1)
REGISTRY_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep -o "Registry deployed at: 0x[a-fA-F0-9]\{40\}" | cut -d' ' -f4)

if [ -z "$REGISTRY_ADDRESS" ]; then
    echo -e "${RED}❌ Failed to deploy contracts${NC}"
    echo "$DEPLOY_OUTPUT"
    exit 1
fi

export GATSBY_QIP_REGISTRY_ADDRESS=$REGISTRY_ADDRESS
echo -e "${GREEN}✅ QIP Registry at: $REGISTRY_ADDRESS${NC}"

# Setup initial test data
echo -e "\n${GREEN}3. Setting up initial test data...${NC}"
QIP_REGISTRY_ADDRESS=$REGISTRY_ADDRESS forge script script/LocalQIPTest.s.sol:LocalQIPTest --rpc-url http://localhost:8545 --broadcast --slow > /tmp/setup.log 2>&1

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Test data setup complete${NC}"
else
    echo -e "${RED}❌ Test data setup failed${NC}"
    cat /tmp/setup.log
fi

# Run migration if flag is set
if [ "$MIGRATE_FLAG" = true ]; then
    echo -e "\n${GREEN}3.5. Running QIP migration (209-248)...${NC}"
    echo -e "${YELLOW}This will migrate existing QIP files with their original numbers${NC}"
    
    # Run the migration script
    bun run scripts/migrate-with-original-numbers-dev.ts
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ QIP migration complete${NC}"
    else
        echo -e "${RED}❌ QIP migration failed${NC}"
    fi
fi

# Start Vite dev server
echo -e "\n${GREEN}4. Starting Vite development server...${NC}"
bun run dev > /tmp/vite.log 2>&1 &
VITE_PID=$!
echo "Vite PID: $VITE_PID"

# Wait for Vite to start
echo -e "${YELLOW}Waiting for Vite to start (this may take a minute)...${NC}"
sleep 5
for i in {1..30}; do
    if curl -s http://localhost:3000 > /dev/null; then
        break
    fi
    echo -n "."
    sleep 2
done
echo

# Final status
echo -e "\n${GREEN}✅ Local Development Environment Ready!${NC}"
echo "================================================"
echo -e "${BLUE}📋 Services Running:${NC}"
echo "- Anvil (Blockchain): http://localhost:8545"
echo "- Vite (Frontend): http://localhost:3000"
echo "- IPFS API: http://localhost:5001"
echo "- IPFS Gateway: http://localhost:8080"
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
if [ "$MIGRATE_FLAG" = true ]; then
    echo "- QIP-209 to QIP-248: Migrated from existing files"
fi
echo "- QIP-249: Dynamic Interest Rates (by Author1)"
echo "- QIP-250: Multi-Collateral Support (by Author2)"
echo "- QIP-251: Staking Rewards (by Author3)"
echo ""
echo -e "${YELLOW}💡 Tips:${NC}"
echo "- Connect your wallet to http://localhost:8545"
echo "- Import test accounts using private keys from Anvil"
echo "- Visit http://localhost:3000/create-proposal to create new QIPs"
echo "- All changes are local and will be reset on restart"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"

# Keep script running and show logs
tail -f /tmp/anvil.log /tmp/vite.log