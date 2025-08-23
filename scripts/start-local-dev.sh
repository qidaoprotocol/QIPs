#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Clear any stale environment variables from previous runs
unset QIP_REGISTRY_ADDRESS
unset VITE_QIP_REGISTRY_ADDRESS
unset GATSBY_QIP_REGISTRY_ADDRESS
unset DEPLOYER_ADDRESS
unset PRIVATE_KEY

echo -e "${YELLOW}Cleared stale environment variables${NC}"

# Parse command line arguments
MIGRATE_QIPS=false
KEYSTORE_ACCOUNT=""
USE_KEYSTORE=false

echo -e "${BLUE}Parsing arguments: $@${NC}"

while [[ $# -gt 0 ]]; do
    echo -e "${YELLOW}Processing argument: $1${NC}"
    case $1 in
        --migrate)
            MIGRATE_QIPS=true
            echo -e "${GREEN}  → Migration enabled${NC}"
            shift
            ;;
        --keystore=*)
            KEYSTORE_ACCOUNT="${1#*=}"
            USE_KEYSTORE=true
            echo -e "${GREEN}  → Keystore account (=): $KEYSTORE_ACCOUNT${NC}"
            shift
            ;;
        --keystore)
            shift
            KEYSTORE_ACCOUNT="$1"
            USE_KEYSTORE=true
            echo -e "${GREEN}  → Keystore account: $KEYSTORE_ACCOUNT${NC}"
            shift
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo "Options:"
            echo "  --migrate                    Run migration script to populate QIPs 209-248 from existing files"
            echo "  --keystore <account>         Use keystore account for deployment (e.g., deployer, devwallet)"
            echo "  --keystore=<account>         Alternative syntax for keystore"
            echo "  --help                       Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 --migrate                        # Use default private key"
            echo "  $0 --keystore deployer --migrate    # Use keystore account (space)"
            echo "  $0 --keystore=deployer --migrate    # Use keystore account (equals)"
            echo ""
            echo "Available keystore accounts:"
            cast wallet list 2>/dev/null || echo "  (run 'cast wallet list' to see available accounts)"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

echo -e "${BLUE}🚀 Starting QIPs Local Development Environment (Vite)${NC}"
echo "================================================"

# Validate keystore account if specified and get the address
if [ "$USE_KEYSTORE" = true ]; then
    if ! cast wallet list 2>/dev/null | grep -q "$KEYSTORE_ACCOUNT"; then
        echo -e "${RED}❌ Error: Keystore account '$KEYSTORE_ACCOUNT' not found${NC}"
        echo "Available accounts:"
        cast wallet list 2>/dev/null || echo "No keystore accounts found. Create one with: cast wallet import <name> --interactive"
        exit 1
    fi
    
    # Get the address for the keystore account
    KEYSTORE_ADDRESS=$(cast wallet address --account $KEYSTORE_ACCOUNT 2>/dev/null)
    if [ -z "$KEYSTORE_ADDRESS" ]; then
        echo -e "${RED}❌ Error: Could not retrieve address for keystore account '$KEYSTORE_ACCOUNT'${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Using keystore account: $KEYSTORE_ACCOUNT${NC}"
    echo -e "${GREEN}   Address: $KEYSTORE_ADDRESS${NC}"
fi

# Set deployment method
if [ "$USE_KEYSTORE" = true ]; then
    DEPLOY_METHOD="keystore"
    echo -e "${BLUE}Using keystore for deterministic deployment${NC}"
else
    DEPLOY_METHOD="privatekey"
    echo -e "${BLUE}Using default Anvil account for deployment${NC}"
fi

# Function to cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    if [ ! -z "$ANVIL_PID" ]; then
        kill $ANVIL_PID 2>/dev/null
        echo "Stopped Anvil (PID: $ANVIL_PID)"
    fi
    if [ ! -z "$VITE_PID" ]; then
        kill $VITE_PID 2>/dev/null
        echo "Stopped Vite (PID: $VITE_PID)"
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

# Kill any existing Anvil/Vite processes
echo -e "${YELLOW}Stopping any existing processes...${NC}"
pkill -f anvil 2>/dev/null
pkill -f vite 2>/dev/null
sleep 2

# Default to using local IPFS for local development unless explicitly disabled
if [ -z "$USE_LOCAL_IPFS" ]; then
    USE_LOCAL_IPFS="true"
    echo -e "${BLUE}Defaulting to local IPFS for development${NC}"
fi

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
    ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["http://localhost:3000", "http://localhost:8080", "http://127.0.0.1:3000", "*"]' 2>/dev/null
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
    # Set flag that IPFS is available locally
    LOCAL_IPFS_AVAILABLE=true
    # Export VITE variables for local IPFS
    export VITE_USE_LOCAL_IPFS=true
    export VITE_LOCAL_IPFS_API="http://localhost:5001"
    export VITE_LOCAL_IPFS_GATEWAY="http://localhost:8080"
else
    echo -e "${YELLOW}📡 Using external IPFS provider (Mai API or Pinata)${NC}"
    echo "Local IPFS daemon will not be started"
    LOCAL_IPFS_AVAILABLE=false
fi

# Load environment variables
echo -e "${GREEN}Loading local environment...${NC}"
if [ -f .env.local ]; then
    # Export both VITE_ and GATSBY_ prefixes for compatibility
    while IFS='=' read -r key value; do
        # Skip comments and empty lines
        [[ $key =~ ^#.*$ ]] || [[ -z $key ]] && continue
        
        # Export original variable
        export "$key=$value"
        
        # If it's a GATSBY_ variable, also export as VITE_
        if [[ $key == GATSBY_* ]]; then
            VITE_KEY="VITE_${key#GATSBY_}"
            export "$VITE_KEY=$value"
        fi
    done < .env.local
fi

# Install forge-std if needed
if [ ! -d "dependencies/forge-std" ]; then
    echo -e "${YELLOW}Installing forge-std...${NC}"
    forge install foundry-rs/forge-std
fi

# Start Anvil
echo -e "\n${GREEN}1. Starting Anvil (Base fork)...${NC}"

# Standard Anvil command without impersonation
ANVIL_CMD="anvil --fork-url https://mainnet.base.org --accounts 10 --balance 10000 --block-time 2 --port 8545"

# Start Anvil
eval "$ANVIL_CMD > /tmp/anvil.log 2>&1 &"

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

if [ "$DEPLOY_METHOD" = "keystore" ]; then
    echo -e "${YELLOW}Deploying with keystore account: $KEYSTORE_ADDRESS${NC}"
    # Deploy using keystore account
    DEPLOY_OUTPUT=$(INITIAL_ADMIN=$KEYSTORE_ADDRESS forge script script/DeployWithStandardCreate2.s.sol:DeployWithStandardCreate2 \
        --rpc-url http://localhost:8545 \
        --account $KEYSTORE_ACCOUNT \
        --sender $KEYSTORE_ADDRESS \
        --broadcast \
        -vvv 2>&1)
else
    # For local Anvil, use the first test account's private key
    # This is the well-known Anvil test private key (account 0)
    echo -e "${YELLOW}Deploying with default Anvil account...${NC}"
    DEPLOY_OUTPUT=$(forge script script/DeployWithStandardCreate2.s.sol:DeployWithStandardCreate2 \
        --rpc-url http://localhost:8545 \
        --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
        --broadcast \
        --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
        -vvv 2>&1)
fi

# Save deployment output for debugging
echo "$DEPLOY_OUTPUT" > /tmp/deploy_output.log

# Show key parts of the deployment output
if echo "$DEPLOY_OUTPUT" | grep -q "Error\|error\|failed\|Failed"; then
    echo -e "${RED}❌ Deployment may have failed. Checking output...${NC}"
    echo "$DEPLOY_OUTPUT" | grep -E "Error|error|failed|Failed" | head -5
fi

# Extract the actual deployed address from the output
REGISTRY_ADDRESS=""

echo -e "${YELLOW}Looking for deployed contract address...${NC}"

# Debug: Show what patterns we're finding
echo "$DEPLOY_OUTPUT" | grep -i "deployed\|registry\|address" | head -5

# Try multiple patterns to extract the deployed address
if echo "$DEPLOY_OUTPUT" | grep -q "QIPRegistry deployed at:"; then
    REGISTRY_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep "QIPRegistry deployed at:" | awk '{print $4}')
    echo -e "${BLUE}Found: QIPRegistry deployed at: $REGISTRY_ADDRESS${NC}"
elif echo "$DEPLOY_OUTPUT" | grep -q "QIPRegistry already deployed at:"; then
    REGISTRY_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep "QIPRegistry already deployed at:" | awk '{print $5}')
    echo -e "${BLUE}Found: QIPRegistry already deployed at: $REGISTRY_ADDRESS${NC}"
elif echo "$DEPLOY_OUTPUT" | grep -q "Registry deployed at:"; then
    REGISTRY_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep "Registry deployed at:" | awk '{print $4}')
    echo -e "${BLUE}Found: Registry deployed at: $REGISTRY_ADDRESS${NC}"
fi

# If we still don't have an address, check if deployment actually happened
if [ -z "$REGISTRY_ADDRESS" ]; then
    echo -e "${YELLOW}No deployment message found. Checking for transaction receipts...${NC}"
    
    # Look for contract creation in broadcast logs
    if echo "$DEPLOY_OUTPUT" | grep -q "Contract Address:"; then
        REGISTRY_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep "Contract Address:" | head -1 | awk '{print $3}')
        echo -e "${BLUE}Found in transaction: Contract Address: $REGISTRY_ADDRESS${NC}"
    elif echo "$DEPLOY_OUTPUT" | grep -q "Deployed to:"; then
        REGISTRY_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep "Deployed to:" | head -1 | awk '{print $3}')
        echo -e "${BLUE}Found: Deployed to: $REGISTRY_ADDRESS${NC}"
    else
        # Last resort: find any address in output
        REGISTRY_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep -oE '0x[a-fA-F0-9]{40}' | tail -1)
        if [ ! -z "$REGISTRY_ADDRESS" ]; then
            echo -e "${YELLOW}Using last address found in output: $REGISTRY_ADDRESS${NC}"
        fi
    fi
fi

if [ -z "$REGISTRY_ADDRESS" ]; then
    echo -e "${RED}❌ Could not extract registry address from deployment output${NC}"
    echo -e "${YELLOW}Check /tmp/deploy_output.log for full deployment output${NC}"
    exit 1
fi

# Verify the contract exists at the extracted address
CODE=$(cast code $REGISTRY_ADDRESS --rpc-url http://localhost:8545 2>/dev/null || echo "0x")
if [ "$CODE" = "0x" ] || [ -z "$CODE" ]; then
    echo -e "${RED}❌ No contract found at extracted address $REGISTRY_ADDRESS${NC}"
    echo -e "${YELLOW}Deployment may have failed.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ QIP Registry deployed at: $REGISTRY_ADDRESS${NC}"

# Export the address for other scripts
export QIP_REGISTRY_ADDRESS=$REGISTRY_ADDRESS
export VITE_QIP_REGISTRY_ADDRESS=$REGISTRY_ADDRESS
export VITE_BASE_RPC_URL="http://localhost:8545"
export GATSBY_QIP_REGISTRY_ADDRESS=$REGISTRY_ADDRESS
export GATSBY_BASE_RPC_URL="http://localhost:8545"

# Debug: Verify the exported address
echo -e "${BLUE}DEBUG: Exported QIP_REGISTRY_ADDRESS=$QIP_REGISTRY_ADDRESS${NC}"
echo -e "${BLUE}DEBUG: Verifying contract at address...${NC}"
CONTRACT_CODE=$(cast code $QIP_REGISTRY_ADDRESS --rpc-url http://localhost:8545 2>/dev/null | head -c 50)
echo -e "${BLUE}DEBUG: Contract code preview: $CONTRACT_CODE...${NC}"

# Verify deployer has admin role
if [ "$DEPLOY_METHOD" = "keystore" ]; then
    DEPLOYER_ADDRESS=$KEYSTORE_ADDRESS
else
    DEPLOYER_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
fi

echo -e "${BLUE}DEBUG: Checking admin role for deployer: $DEPLOYER_ADDRESS${NC}"
ADMIN_ROLE=$(cast call $REGISTRY_ADDRESS "DEFAULT_ADMIN_ROLE()(bytes32)" --rpc-url http://localhost:8545 2>/dev/null)
HAS_ADMIN=$(cast call $REGISTRY_ADDRESS "hasRole(bytes32,address)(bool)" $ADMIN_ROLE $DEPLOYER_ADDRESS --rpc-url http://localhost:8545 2>/dev/null)
echo -e "${BLUE}DEBUG: Deployer has admin role: $HAS_ADMIN${NC}"

# No role granting needed - the deployer is already the admin with keystore method

# Run initial data setup
echo -e "\n${GREEN}3. Setting up initial test data...${NC}"
echo -e "${BLUE}DEBUG: Using registry address for test data: $REGISTRY_ADDRESS${NC}"

if [ "$DEPLOY_METHOD" = "keystore" ]; then
    QIP_REGISTRY_ADDRESS=$REGISTRY_ADDRESS DEPLOYER_ADDRESS=$KEYSTORE_ADDRESS \
        forge script script/LocalQIPTest.s.sol:LocalQIPTest \
        --rpc-url http://localhost:8545 \
        --account $KEYSTORE_ACCOUNT \
        --sender $KEYSTORE_ADDRESS \
        --broadcast --slow > /tmp/setup.log 2>&1
else
    QIP_REGISTRY_ADDRESS=$REGISTRY_ADDRESS PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" \
        forge script script/LocalQIPTest.s.sol:LocalQIPTest \
        --rpc-url http://localhost:8545 \
        --broadcast --slow > /tmp/setup.log 2>&1
fi

if grep -q "Error" /tmp/setup.log; then
    echo -e "${YELLOW}⚠️  Some test data setup had errors (this is normal)${NC}"
else
    echo -e "${GREEN}✅ Test data setup complete${NC}"
fi

# Run migration if requested
if [ "$MIGRATE_QIPS" = true ]; then
    echo -e "\n${GREEN}3.5. Running Batch QIP Migration (209-248)...${NC}"
    echo -e "${YELLOW}Using optimized Foundry batch migration for better performance${NC}"
    
    # Export required environment variables
    export QIP_REGISTRY_ADDRESS=$REGISTRY_ADDRESS
    export VITE_QIP_REGISTRY_ADDRESS=$REGISTRY_ADDRESS
    export VITE_BASE_RPC_URL="http://localhost:8545"
    export GATSBY_QIP_REGISTRY_ADDRESS=$REGISTRY_ADDRESS
    export BASE_RPC_URL="http://localhost:8545"
    export GATSBY_BASE_RPC_URL="http://localhost:8545"
    
    # Configure IPFS based on what's available
    # Use the flag we set earlier when checking/starting IPFS
    if [ "$LOCAL_IPFS_AVAILABLE" = true ]; then
        # Local IPFS is running, use it
        export USE_LOCAL_IPFS=true
        export VITE_USE_LOCAL_IPFS=true
        export VITE_LOCAL_IPFS_API="http://localhost:5001"
        export VITE_LOCAL_IPFS_GATEWAY="http://localhost:8080"
        export GATSBY_LOCAL_IPFS_API="http://localhost:5001"
        export GATSBY_LOCAL_IPFS_GATEWAY="http://localhost:8080"
        echo -e "${YELLOW}Using local IPFS daemon for migration${NC}"
    else
        # No local IPFS, need to use Pinata
        if [ -z "$PINATA_JWT" ]; then
            echo -e "${RED}❌ PINATA_JWT not set. Required for remote IPFS uploads.${NC}"
            echo "Please either:"
            echo "  1. Set USE_LOCAL_IPFS=true in .env.local to start local IPFS"
            echo "  2. Set PINATA_JWT in your .env.local file for Pinata uploads"
            exit 1
        fi
        export USE_LOCAL_IPFS=false
        echo -e "${YELLOW}Using Pinata for IPFS uploads${NC}"
    fi
    
    # Set deployment credentials based on method
    if [ "$DEPLOY_METHOD" = "keystore" ]; then
        # With keystore, we're already authenticated
        echo -e "${YELLOW}Using keystore account for migration: $KEYSTORE_ADDRESS${NC}"
        # Ensure no PRIVATE_KEY pollution from previous runs or sections
        unset PRIVATE_KEY
        echo -e "${BLUE}DEBUG: Unset PRIVATE_KEY to prevent conflicts${NC}"
    else
        # Use the default Anvil account private key
        echo -e "${YELLOW}Using default Anvil account for migration${NC}"
        # Don't export globally - we'll pass it inline to prevent pollution
        # export PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    fi
    
    # Use Foundry script for best performance
    echo -e "${YELLOW}Using Foundry batch migration script...${NC}"
    
    # Debug: Show what address we're passing to migration
    echo -e "${BLUE}DEBUG: Passing QIP_REGISTRY_ADDRESS=$REGISTRY_ADDRESS to migration script${NC}"
    
    # Run the Foundry migration script with FFI for file reading
    # Pass environment variable explicitly
    if [ "$DEPLOY_METHOD" = "keystore" ]; then
        echo -e "${BLUE}DEBUG: Passing DEPLOYER_ADDRESS=$KEYSTORE_ADDRESS to migration${NC}"
        QIP_REGISTRY_ADDRESS=$REGISTRY_ADDRESS DEPLOYER_ADDRESS=$KEYSTORE_ADDRESS \
            forge script script/MigrateBatchWithFFI.s.sol \
            --rpc-url http://localhost:8545 \
            --broadcast \
            --account $KEYSTORE_ACCOUNT \
            --sender $KEYSTORE_ADDRESS \
            --ffi \
            -vvv
    else
        echo -e "${BLUE}DEBUG: Using inline PRIVATE_KEY for migration${NC}"
        QIP_REGISTRY_ADDRESS=$REGISTRY_ADDRESS PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" \
            forge script script/MigrateBatchWithFFI.s.sol \
            --rpc-url http://localhost:8545 \
            --broadcast \
            --ffi \
            -vvv
    fi
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ QIP migration complete${NC}"
        
        # Show migration summary
        echo -e "\n${BLUE}📊 Migration Summary:${NC}"
        cast call $REGISTRY_ADDRESS "nextQIPNumber()(uint256)" --rpc-url http://localhost:8545 | xargs -I {} echo "Next QIP Number: {}"
        
        # Try to get count of migrated QIPs
        MIGRATED_COUNT=$(cast call $REGISTRY_ADDRESS "nextQIPNumber()(uint256)" --rpc-url http://localhost:8545 2>/dev/null || echo "0")
        if [ "$MIGRATED_COUNT" -gt "208" ]; then
            ACTUAL_MIGRATED=$((MIGRATED_COUNT - 208))
            echo "QIPs migrated: ~$ACTUAL_MIGRATED"
        fi
    else
        echo -e "${YELLOW}⚠️  QIP migration had some errors (check logs above)${NC}"
        echo "You can retry migration by running:"
        echo "  forge script script/MigrateBatchWithFFI.s.sol --rpc-url http://localhost:8545 --broadcast --ffi"
    fi
fi

# Start Vite in development mode
echo -e "\n${GREEN}4. Starting Vite development server...${NC}"
# Export registry address and RPC URL for Vite
export VITE_QIP_REGISTRY_ADDRESS=$REGISTRY_ADDRESS
export VITE_BASE_RPC_URL="http://localhost:8545"
# Export IPFS settings for Vite if local IPFS is available
if [ "$LOCAL_IPFS_AVAILABLE" = true ]; then
    export VITE_USE_LOCAL_IPFS=true
    export VITE_LOCAL_IPFS_API="http://localhost:5001"
    export VITE_LOCAL_IPFS_GATEWAY="http://localhost:8080"
fi
bun run dev &
VITE_PID=$!
echo "Vite PID: $VITE_PID"

# Wait for Vite to start
echo -e "${YELLOW}Waiting for Vite to start...${NC}"
MAX_VITE_RETRIES=30
VITE_RETRY_COUNT=0
while [ $VITE_RETRY_COUNT -lt $MAX_VITE_RETRIES ]; do
    if curl -s http://localhost:3000 > /dev/null 2>&1; then
        break
    fi
    VITE_RETRY_COUNT=$((VITE_RETRY_COUNT + 1))
    sleep 2
    echo -n "."
done
echo ""

if [ $VITE_RETRY_COUNT -eq $MAX_VITE_RETRIES ]; then
    echo -e "${RED}❌ Vite failed to start${NC}"
    exit 1
fi

# Display information
echo -e "\n${GREEN}✅ Local Development Environment Ready!${NC}"
echo "================================================"
echo -e "${BLUE}📋 Services Running:${NC}"
echo "- Anvil (Blockchain): http://localhost:8545"
echo "- Vite (Frontend): http://localhost:3000"
if [ "$USE_LOCAL_IPFS" = "true" ]; then
    echo "- IPFS API: http://localhost:5001"
    echo "- IPFS Gateway: http://localhost:8080"
fi
echo ""
echo -e "${BLUE}📊 Contract Information:${NC}"
echo "- QIP Registry: $REGISTRY_ADDRESS"
echo "- Chain ID: 8453 (Base Fork)"
if [ "$DEPLOY_METHOD" = "keystore" ]; then
    echo "- Deployed by: $KEYSTORE_ADDRESS (keystore: $KEYSTORE_ACCOUNT)"
    echo "- Admin: $KEYSTORE_ADDRESS"
else
    echo "- Deployed by: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (Anvil account 0)"
    echo "- Admin: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
fi
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
echo "- Visit http://localhost:3000/create-proposal to create new QIPs"
echo "- All changes are local and will be reset on restart"
if [ "$MIGRATE_QIPS" = false ]; then
    echo "- Run with --migrate flag to populate QIPs 209-248 from existing files"
fi
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"

# Keep script running and show logs
tail -f /tmp/anvil.log