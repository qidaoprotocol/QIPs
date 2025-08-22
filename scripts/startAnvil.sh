#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting QIP Registry Local Testing Environment${NC}"
echo "================================================"

# Check if anvil is installed
if ! command -v anvil &> /dev/null; then
    echo -e "${YELLOW}⚠️  Anvil not found. Please install Foundry first:${NC}"
    echo "curl -L https://foundry.paradigm.xyz | bash"
    echo "foundryup"
    exit 1
fi

# Check if forge is installed
if ! command -v forge &> /dev/null; then
    echo -e "${YELLOW}⚠️  Forge not found. Please install Foundry first.${NC}"
    exit 1
fi

# Check if .env file exists, if not create from example
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo -e "${YELLOW}Creating .env file from .env.example...${NC}"
        cp .env.example .env
        # Update .env with local values
        sed -i.bak 's|PRIVATE_KEY=.*|PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80|' .env
        sed -i.bak 's|BASE_RPC_URL=.*|BASE_RPC_URL=http://localhost:8545|' .env
        sed -i.bak 's|GATSBY_BASE_RPC_URL=.*|GATSBY_BASE_RPC_URL=http://localhost:8545|' .env
        rm .env.bak
    else
        echo -e "${YELLOW}⚠️  .env file not found. Creating minimal .env...${NC}"
        cat > .env << EOF
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
BASE_RPC_URL=http://localhost:8545
EOF
    fi
fi

# Source environment variables
source .env

# Check if forge-std is installed
if [ ! -d "dependencies/forge-std" ]; then
    echo -e "${YELLOW}Installing forge-std dependency...${NC}"
    forge install foundry-rs/forge-std
fi

# Start Anvil in the background
echo -e "\n${GREEN}1. Starting Anvil...${NC}"
anvil --fork-url https://mainnet.base.org \
      --accounts 10 \
      --balance 10000 \
      --block-time 2 \
      --port 8545 &

ANVIL_PID=$!
echo "Anvil PID: $ANVIL_PID"

# Wait for Anvil to start
echo -e "${YELLOW}Waiting for Anvil to start...${NC}"

# Wait for Anvil to be ready by checking if it responds to RPC calls
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
    echo -e "${YELLOW}❌ Anvil failed to start within 30 seconds${NC}"
    kill $ANVIL_PID 2>/dev/null
    exit 1
fi

# Check if Anvil is running
if ! kill -0 $ANVIL_PID 2>/dev/null; then
    echo -e "${YELLOW}❌ Anvil process died${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Anvil is running on http://localhost:8545${NC}"

# Deploy contracts
echo -e "\n${GREEN}2. Deploying QIP Registry contract...${NC}"
DEPLOY_OUTPUT=$(forge script script/LocalQIPTest.s.sol:LocalQIPTest --rpc-url http://localhost:8545 --broadcast -vvv 2>&1)

# Extract registry address from output
REGISTRY_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep -o "QIPRegistry deployed at: 0x[a-fA-F0-9]\{40\}" | grep -o "0x[a-fA-F0-9]\{40\}")

if [ -z "$REGISTRY_ADDRESS" ]; then
    echo -e "${YELLOW}❌ Failed to deploy contracts${NC}"
    echo "Deploy output:"
    echo "$DEPLOY_OUTPUT"
    kill $ANVIL_PID
    exit 1
fi

echo -e "${GREEN}✅ QIP Registry deployed at: $REGISTRY_ADDRESS${NC}"

# Update the TypeScript file with the correct address
echo -e "\n${GREEN}3. Updating TypeScript client with contract address...${NC}"
sed -i.bak "s/const REGISTRY_ADDRESS = '0x[a-fA-F0-9]*'/const REGISTRY_ADDRESS = '$REGISTRY_ADDRESS'/" src/localQIPTest.ts
rm src/localQIPTest.ts.bak

# Display test accounts
echo -e "\n${BLUE}📋 Test Accounts:${NC}"
echo "================================================"
echo "Governance: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (10000 ETH)"
echo "Editor:     0x70997970C51812dc3A010C7d01b50e0d17dc79C8 (10000 ETH)"
echo "Author1:    0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC (10000 ETH)"
echo "Author2:    0x90F79bf6EB2c4f870365E785982E1f101E93b906 (10000 ETH)"
echo "Author3:    0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65 (10000 ETH)"

echo -e "\n${BLUE}📊 Initial QIP State:${NC}"
echo "================================================"
echo "QIP-249: Dynamic Interest Rates (Draft → Implemented)"
echo "QIP-250: Multi-Collateral Support (Draft → ReviewPending)"
echo "QIP-251: Staking Rewards (Draft → Withdrawn)"
echo "QIP-100: Historical - Protocol Launch (Implemented)"
echo "QIP-150: Historical - Rejected Proposal (Rejected)"
echo "QIP-200: Historical - Superseded Update (Superseded)"

echo -e "\n${GREEN}✅ Setup Complete!${NC}"
echo "================================================"
echo -e "${YELLOW}To run the TypeScript test client:${NC}"
echo "  bun run src/localQIPTest.ts"
echo ""
echo -e "${YELLOW}To interact with the contract using cast:${NC}"
echo "  # Get next QIP number"
echo "  cast call $REGISTRY_ADDRESS \"nextQIPNumber()\" --rpc-url http://localhost:8545"
echo ""
echo "  # Get QIP details (e.g., QIP-249)"
echo "  cast call $REGISTRY_ADDRESS \"qips(uint256)\" 249 --rpc-url http://localhost:8545"
echo ""
echo -e "${YELLOW}To stop Anvil:${NC}"
echo "  kill $ANVIL_PID"
echo ""
echo -e "${BLUE}Anvil is running in the background (PID: $ANVIL_PID)${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop watching logs${NC}"
echo ""

# Keep script running and show Anvil logs
trap "kill $ANVIL_PID; exit" INT
wait $ANVIL_PID