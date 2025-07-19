#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Parse command line arguments
MIGRATE_QIPS=false
for arg in "$@"; do
    case $arg in
        --migrate)
            MIGRATE_QIPS=true
            shift
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo "Options:"
            echo "  --migrate    Run migration script to populate QIPs 209-248 from existing files"
            echo "  --help       Show this help message"
            exit 0
            ;;
    esac
done

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

# Load environment variables from .env.local if it exists
if [ -f .env.local ]; then
    export $(grep -v '^#' .env.local | xargs)
fi

# Kill any existing Anvil/Gatsby processes
echo -e "${YELLOW}Stopping any existing processes...${NC}"
pkill -f anvil 2>/dev/null
pkill -f gatsby 2>/dev/null
sleep 2

# Check if IPFS should be started
if [ "$USE_LOCAL_IPFS" = "true" ]; then
    echo -e "${YELLOW}Checking IPFS (required for local development)...${NC}"
    
    # Check if IPFS is installed
    if ! command -v ipfs &> /dev/null; then
        echo -e "${RED}❌ IPFS not found. IPFS is required for local development.${NC}"
        echo ""
        echo "To install IPFS:"
        echo "  macOS: brew install ipfs"
        echo "  Other: https://docs.ipfs.tech/install/"
        echo ""
        echo "After installation, run: ./scripts/setup-ipfs.sh"
        exit 1
    fi
    
    # Initialize IPFS if not already initialized
    if [ ! -d ~/.ipfs ]; then
        echo -e "${YELLOW}Initializing IPFS...${NC}"
        ipfs init
        if [ $? -ne 0 ]; then
            echo -e "${RED}❌ Failed to initialize IPFS${NC}"
            exit 1
        fi
    fi
    
    # Configure IPFS for local development
    echo -e "${YELLOW}Configuring IPFS for local development...${NC}"
    ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["http://localhost:8000", "http://localhost:8080", "*"]' 2>/dev/null
    ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["GET", "POST", "PUT", "DELETE"]' 2>/dev/null
    ipfs config --json API.HTTPHeaders.Access-Control-Allow-Headers '["Content-Type", "Authorization"]' 2>/dev/null
    ipfs config --json API.HTTPHeaders.Access-Control-Allow-Credentials '["true"]' 2>/dev/null
    
    # Configure garbage collection and storage limits
    ipfs config --json Datastore.GCPeriod '"1h"' 2>/dev/null
    ipfs config --json Datastore.StorageMax '"10GB"' 2>/dev/null
    
    # Kill any existing IPFS process
    pkill -f "ipfs daemon" 2>/dev/null
    sleep 2
    
    # Start IPFS daemon if not running
    if ! pgrep -f "ipfs daemon" > /dev/null; then
        echo -e "${YELLOW}Starting IPFS daemon...${NC}"
        ipfs daemon > /tmp/ipfs.log 2>&1 &
        IPFS_PID=$!
        echo "IPFS PID: $IPFS_PID"
        
        # Wait for IPFS to start with timeout
        echo -e "${YELLOW}Waiting for IPFS to start...${NC}"
        MAX_IPFS_RETRIES=30
        IPFS_RETRY_COUNT=0
        IPFS_STARTED=false
        
        while [ $IPFS_RETRY_COUNT -lt $MAX_IPFS_RETRIES ]; do
            if curl -s -X POST http://localhost:5001/api/v0/version > /dev/null 2>&1; then
                IPFS_STARTED=true
                break
            fi
            IPFS_RETRY_COUNT=$((IPFS_RETRY_COUNT + 1))
            sleep 1
            echo -n "."
        done
        echo ""
        
        if [ "$IPFS_STARTED" = false ]; then
            echo -e "${RED}❌ IPFS failed to start. This is required for local development.${NC}"
            echo -e "${YELLOW}Please check /tmp/ipfs.log for errors:${NC}"
            echo "----------------------------------------"
            tail -n 20 /tmp/ipfs.log
            echo "----------------------------------------"
            echo ""
            echo "Common solutions:"
            echo "1. Kill existing IPFS processes: pkill -f ipfs"
            echo "2. Check if port 5001 is in use: lsof -i :5001"
            echo "3. Reinitialize IPFS: rm -rf ~/.ipfs && ipfs init"
            exit 1
        fi
    else
        echo -e "${GREEN}✅ IPFS daemon already running${NC}"
    fi
    
    # Verify IPFS is working by testing upload/download
    echo -e "${YELLOW}Testing IPFS functionality...${NC}"
    TEST_CONTENT="QIPs IPFS test - $(date)"
    TEST_CID=$(echo "$TEST_CONTENT" | ipfs add -q 2>/dev/null)
    
    if [ -z "$TEST_CID" ]; then
        echo -e "${RED}❌ IPFS upload test failed${NC}"
        echo "IPFS daemon is running but not functioning properly"
        exit 1
    fi
    
    # Test retrieval
    RETRIEVED_CONTENT=$(ipfs cat "$TEST_CID" 2>/dev/null)
    if [ "$RETRIEVED_CONTENT" != "$TEST_CONTENT" ]; then
        echo -e "${RED}❌ IPFS retrieval test failed${NC}"
        echo "Content uploaded but could not be retrieved"
        exit 1
    fi
    
    echo -e "${GREEN}✅ IPFS daemon is running and functional${NC}"
    echo -e "${GREEN}   API: http://localhost:5001${NC}"
    echo -e "${GREEN}   Gateway: http://localhost:8080${NC}"
    echo -e "${GREEN}   Test CID: $TEST_CID${NC}"
else
    echo -e "${RED}❌ Local IPFS is disabled but required for development${NC}"
    echo "Please set USE_LOCAL_IPFS=true in your environment"
    echo "Or use: GATSBY_USE_LOCAL_IPFS=true in .env.local"
    exit 1
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
    REGISTRY_ADDRESS="0xf5D5CdccEe171F02293337b7F3eda4D45B85B233"
    echo -e "${YELLOW}Using deterministic registry address: $REGISTRY_ADDRESS${NC}"
fi

echo -e "${GREEN}✅ QIP Registry at: $REGISTRY_ADDRESS${NC}"

# Verify the address matches the expected deterministic address
EXPECTED_ADDRESS="0xf5D5CdccEe171F02293337b7F3eda4D45B85B233"
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

# Run migration if requested
if [ "$MIGRATE_QIPS" = true ]; then
    echo -e "\n${GREEN}3.5. Running QIP migration (209-248)...${NC}"
    echo -e "${YELLOW}This will migrate existing QIP files with their original numbers${NC}"
    
    # Export required environment variables for the migration script
    export GATSBY_QIP_REGISTRY_ADDRESS=$REGISTRY_ADDRESS
    export GATSBY_BASE_RPC_URL="http://localhost:8545"
    export GATSBY_LOCAL_IPFS_API="http://localhost:5001"
    export GATSBY_LOCAL_IPFS_GATEWAY="http://localhost:8080"
    # Use the governance/deployer account private key (has editor permissions by default)
    export PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    
    # Run the migration script
    bun run scripts/migrate-with-original-numbers-dev.ts
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ QIP migration complete${NC}"
    else
        echo -e "${YELLOW}⚠️  QIP migration had some errors (check logs above)${NC}"
    fi
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
if [ "$MIGRATE_QIPS" = true ]; then
    echo "- QIP-209 to QIP-248: Migrated from existing files"
fi
echo "- QIP-249: Dynamic Interest Rates (by Author1)"
echo "- QIP-250: Multi-Collateral Support (by Author2)"
echo "- QIP-251: Staking Rewards (by Author3)"
echo ""
echo -e "${YELLOW}💡 Tips:${NC}"
echo "- Connect your wallet to http://localhost:8545"
echo "- Import test accounts using private keys from Anvil"
echo "- Visit http://localhost:8000/create-proposal to create new QIPs"
echo "- All changes are local and will be reset on restart"
if [ "$MIGRATE_QIPS" = false ]; then
    echo "- Run with --migrate flag to populate QIPs 209-248 from existing files"
fi
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"

# Keep script running and show logs
tail -f /tmp/anvil.log