#!/bin/bash

# ============================================
# QIP Registry Master Production Deployment Script
# ============================================
# This script orchestrates the complete production deployment process
# It performs pre-flight checks, deployment, verification, and post-deployment tasks

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Default configuration
KEYSTORE_ACCOUNT="mainnet-deployer"
NETWORK="base-mainnet"
DEPLOYMENT_DIR="deployments"
REQUIRED_BALANCE="0.01" # ETH
DRY_RUN=false
VERIFY_CONTRACT=false
COMPUTE_ONLY=false
SKIP_CONFIRMATION=false

# Parse command line arguments
for arg in "$@"; do
    case $arg in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --verify)
            VERIFY_CONTRACT=true
            shift
            ;;
        --compute-only)
            COMPUTE_ONLY=true
            shift
            ;;
        --account=*)
            KEYSTORE_ACCOUNT="${arg#*=}"
            shift
            ;;
        --skip-confirmation)
            SKIP_CONFIRMATION=true
            shift
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --dry-run             Simulate deployment without broadcasting"
            echo "  --verify              Verify contract on Basescan after deployment"
            echo "  --compute-only        Only compute the deployment address"
            echo "  --account=<name>      Keystore account name (default: mainnet-deployer)"
            echo "  --skip-confirmation   Skip deployment confirmation prompt"
            echo "  --help                Show this help message"
            echo ""
            echo "Examples:"
            echo "  # Setup keystore (one-time)"
            echo "  cast wallet import mainnet-deployer --interactive"
            echo ""
            echo "  # Compute deployment address"
            echo "  ./scripts/deploy-production.sh --compute-only"
            echo ""
            echo "  # Dry run deployment"
            echo "  ./scripts/deploy-production.sh --dry-run"
            echo ""
            echo "  # Deploy with specific account"
            echo "  ./scripts/deploy-production.sh --account=deployer"
            echo ""
            echo "  # Deploy and verify"
            echo "  ./scripts/deploy-production.sh --verify"
            exit 0
            ;;
    esac
done

# Timestamps
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
TODAY=$(date +%Y-%m-%d)

# Clear screen for better visibility (unless compute-only mode)
if [ "$COMPUTE_ONLY" = false ]; then
    clear
fi

echo -e "${BOLD}${CYAN}============================================${NC}"
echo -e "${BOLD}${CYAN}🚀 QIP Registry Production Deployment${NC}"
echo -e "${BOLD}${CYAN}============================================${NC}"
echo ""
echo -e "${BOLD}Network:${NC} Base Mainnet (Chain ID: 8453)"
echo -e "${BOLD}Account:${NC} $KEYSTORE_ACCOUNT"
echo -e "${BOLD}Date:${NC} $TODAY"
echo ""

# ============================================
# STEP 1: Pre-flight Checks
# ============================================
if [ "$COMPUTE_ONLY" = false ]; then
    echo -e "${BOLD}${BLUE}📋 Step 1: Pre-flight Checks${NC}"
    echo "----------------------------------------"
fi

# Check required tools
echo -e "${YELLOW}Checking required tools...${NC}"
TOOLS_OK=true

if ! command -v forge &> /dev/null; then
    echo -e "${RED}  ❌ Forge not found${NC}"
    TOOLS_OK=false
else
    echo -e "${GREEN}  ✅ Forge installed${NC}"
fi

if ! command -v cast &> /dev/null; then
    echo -e "${RED}  ❌ Cast not found${NC}"
    TOOLS_OK=false
else
    echo -e "${GREEN}  ✅ Cast installed${NC}"
fi

if ! command -v bun &> /dev/null; then
    echo -e "${RED}  ❌ Bun not found${NC}"
    TOOLS_OK=false
else
    echo -e "${GREEN}  ✅ Bun installed${NC}"
fi

if [ "$TOOLS_OK" = false ]; then
    echo -e "${RED}Please install missing tools before proceeding${NC}"
    exit 1
fi

# Check keystore account
echo -e "\n${YELLOW}Checking keystore account...${NC}"
if cast wallet list | grep -q "$KEYSTORE_ACCOUNT"; then
    echo -e "${GREEN}  ✅ Keystore account '$KEYSTORE_ACCOUNT' found${NC}"
    
    # Get deployer address (will prompt for password)
    if [ "$COMPUTE_ONLY" = false ]; then
        echo -e "${YELLOW}  🔐 Enter keystore password:${NC}"
    fi
    DEPLOYER_ADDRESS=$(cast wallet address --account $KEYSTORE_ACCOUNT 2>/dev/null)
    
    if [ -z "$DEPLOYER_ADDRESS" ]; then
        echo -e "${RED}  ❌ Failed to unlock keystore${NC}"
        exit 1
    fi
    echo -e "${GREEN}  ✅ Deployer address: $DEPLOYER_ADDRESS${NC}"
else
    echo -e "${RED}  ❌ Keystore account '$KEYSTORE_ACCOUNT' not found${NC}"
    echo ""
    echo "  Available accounts:"
    cast wallet list | sed 's/^/    /'
    echo ""
    echo "  To create an account, run:"
    echo "    bun run deploy:setup-keystore"
    exit 1
fi

# Check environment file
echo -e "\n${YELLOW}Checking environment configuration...${NC}"
if [ -f .env.production ]; then
    echo -e "${GREEN}  ✅ Production environment file found${NC}"
    source .env.production
else
    echo -e "${YELLOW}  ⚠️  No .env.production found, using .env${NC}"
    if [ -f .env ]; then
        source .env
    else
        echo -e "${RED}  ❌ No environment file found${NC}"
        echo "  Create .env.production from template:"
        echo "    cp .env.production.example .env.production"
        exit 1
    fi
fi

# Validate environment variables
echo -e "\n${YELLOW}Validating environment variables...${NC}"
ENV_OK=true

if [ -z "$BASE_RPC_URL" ]; then
    echo -e "${RED}  ❌ BASE_RPC_URL not set${NC}"
    ENV_OK=false
else
    echo -e "${GREEN}  ✅ BASE_RPC_URL: ${BASE_RPC_URL:0:30}...${NC}"
fi

# Check if Basescan API key is configured in Foundry
if forge config | grep -q "etherscan.base.key = \"\"" || ! forge config | grep -q "etherscan.base.key"; then
    echo -e "${YELLOW}  ⚠️  No Basescan API key found in ~/.foundry/foundry.toml${NC}"
    echo -e "${YELLOW}      Contract verification will be skipped${NC}"
    VERIFY_ON_BASESCAN=false
else
    echo -e "${GREEN}  ✅ Basescan API key configured in Foundry${NC}"
    VERIFY_ON_BASESCAN=true
fi

if [ "$ENV_OK" = false ]; then
    echo -e "${RED}Please configure missing environment variables${NC}"
    exit 1
fi

# Skip network and balance checks in compute-only mode
if [ "$COMPUTE_ONLY" = false ]; then
    # Check network connectivity
    echo -e "\n${YELLOW}Checking network connectivity...${NC}"
    CHAIN_ID=$(cast chain-id --rpc-url $BASE_RPC_URL 2>/dev/null)
    if [ "$CHAIN_ID" = "8453" ]; then
        echo -e "${GREEN}  ✅ Connected to Base Mainnet (Chain ID: 8453)${NC}"
    else
        echo -e "${RED}  ❌ Cannot connect to Base Mainnet${NC}"
        echo "  Received Chain ID: $CHAIN_ID"
        echo "  Check your RPC URL: $BASE_RPC_URL"
        exit 1
    fi

    # Check wallet balance
    echo -e "\n${YELLOW}Checking wallet balance...${NC}"
    BALANCE_WEI=$(cast balance $DEPLOYER_ADDRESS --rpc-url $BASE_RPC_URL 2>/dev/null || echo "0")
    BALANCE_ETH=$(echo "scale=6; $BALANCE_WEI / 1000000000000000000" | bc 2>/dev/null || echo "0")
    REQUIRED_WEI=$(echo "$REQUIRED_BALANCE * 1000000000000000000" | bc)

    echo -e "  Current balance: ${BOLD}$BALANCE_ETH ETH${NC}"
    echo -e "  Required balance: ${BOLD}$REQUIRED_BALANCE ETH${NC}"

    if (( $(echo "$BALANCE_WEI < $REQUIRED_WEI" | bc -l) )); then
        echo -e "${RED}  ❌ Insufficient balance${NC}"
        echo ""
        echo "  Please fund your deployer address:"
        echo "    $DEPLOYER_ADDRESS"
        echo "  On Base Mainnet with at least $REQUIRED_BALANCE ETH"
        exit 1
    else
        echo -e "${GREEN}  ✅ Sufficient balance for deployment${NC}"
    fi
fi

# Compile contracts
echo -e "\n${YELLOW}Compiling contracts...${NC}"
forge build --silent
if [ $? -eq 0 ]; then
    echo -e "${GREEN}  ✅ Contracts compiled successfully${NC}"
else
    echo -e "${RED}  ❌ Contract compilation failed${NC}"
    exit 1
fi

# ============================================
# STEP 2: Compute Deployment Address
# ============================================
echo ""
echo -e "${BOLD}${BLUE}📊 Step 2: Computing Deployment Address${NC}"
echo "----------------------------------------"

REGISTRY_ADDRESS=$(INITIAL_ADMIN=$DEPLOYER_ADDRESS forge script script/DeployWithStandardCreate2.s.sol:DeployWithStandardCreate2 \
    --sig "getExpectedAddressFor(address)" $DEPLOYER_ADDRESS \
    2>/dev/null | grep "address" | awk '{print $3}')

if [ -z "$REGISTRY_ADDRESS" ]; then
    echo -e "${RED}  ❌ Failed to compute deployment address${NC}"
    exit 1
fi

echo -e "${GREEN}  Registry will deploy to: ${BOLD}$REGISTRY_ADDRESS${NC}"

# If compute-only mode, exit here
if [ "$COMPUTE_ONLY" = true ]; then
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${GREEN}Address computation complete!${NC}"
    echo -e "${BLUE}============================================${NC}"
    exit 0
fi

# Check if already deployed
CODE_SIZE=$(cast codesize $REGISTRY_ADDRESS --rpc-url $BASE_RPC_URL 2>/dev/null || echo "0")
if [ "$CODE_SIZE" != "0" ] && [ "$CODE_SIZE" != "0x0" ]; then
    echo -e "${YELLOW}  ⚠️  Contract already deployed at this address${NC}"
    
    # Verify ownership
    ADMIN_ROLE="0x0000000000000000000000000000000000000000000000000000000000000000"
    HAS_ROLE=$(cast call $REGISTRY_ADDRESS "hasRole(bytes32,address)(bool)" $ADMIN_ROLE $DEPLOYER_ADDRESS --rpc-url $BASE_RPC_URL 2>/dev/null || echo "false")
    
    if [ "$HAS_ROLE" = "true" ]; then
        echo -e "${GREEN}  ✅ You have admin access to this contract${NC}"
        echo ""
        echo "  Contract is already deployed. Exiting."
        echo "  View on Basescan: https://basescan.org/address/$REGISTRY_ADDRESS"
        exit 0
    else
        echo -e "${RED}  ❌ You don't have admin access to this contract${NC}"
        echo "  This address is occupied by another contract."
        exit 1
    fi
fi

# ============================================
# STEP 3: Deployment Summary
# ============================================
echo ""
echo -e "${BOLD}${BLUE}📝 Step 3: Deployment Summary${NC}"
echo "----------------------------------------"
echo -e "${BOLD}Network:${NC}         Base Mainnet (8453)"
echo -e "${BOLD}Deployer:${NC}        $DEPLOYER_ADDRESS"
echo -e "${BOLD}Registry:${NC}        $REGISTRY_ADDRESS"
echo -e "${BOLD}Admin:${NC}           $DEPLOYER_ADDRESS"
echo -e "${BOLD}Starting QIP:${NC}    209"
echo -e "${BOLD}Salt:${NC}            QIPRegistry.v1.base"
echo -e "${BOLD}CREATE2:${NC}         0x4e59b44847b379578588920cA78FbF26c0B4956C"
echo ""

# ============================================
# STEP 4: Final Confirmation
# ============================================
if [ "$DRY_RUN" = false ] && [ "$SKIP_CONFIRMATION" = false ]; then
    echo -e "${BOLD}${YELLOW}⚠️  PRODUCTION DEPLOYMENT WARNING${NC}"
    echo "----------------------------------------"
    echo "You are about to deploy to Base Mainnet."
    echo "This action will consume real ETH and is irreversible."
    echo ""
    echo -e "${BOLD}Estimated gas cost: ~0.005 ETH${NC}"
    echo ""
    read -p "Type 'DEPLOY' to proceed or anything else to cancel: " CONFIRM

    if [ "$CONFIRM" != "DEPLOY" ]; then
        echo -e "${RED}Deployment cancelled${NC}"
        exit 0
    fi
elif [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}Running in DRY RUN mode - no transaction will be broadcast${NC}"
fi

# ============================================
# STEP 5: Execute Deployment
# ============================================
echo ""
echo -e "${BOLD}${BLUE}🚀 Step 4: Executing Deployment${NC}"
echo "----------------------------------------"

# Create deployment directory
mkdir -p $DEPLOYMENT_DIR

# Create deployment record
DEPLOYMENT_RECORD="$DEPLOYMENT_DIR/$NETWORK-$TIMESTAMP.json"
cat > $DEPLOYMENT_RECORD <<EOF
{
  "network": "$NETWORK",
  "chainId": 8453,
  "timestamp": "$TIMESTAMP",
  "deploymentDate": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "deployer": "$DEPLOYER_ADDRESS",
  "contracts": {
    "QIPRegistry": {
      "address": "$REGISTRY_ADDRESS",
      "admin": "$DEPLOYER_ADDRESS",
      "startingQIP": 209,
      "status": "pending"
    }
  },
  "environment": {
    "rpcUrl": "$BASE_RPC_URL",
    "create2Deployer": "0x4e59b44847b379578588920cA78FbF26c0B4956C",
    "salt": "QIPRegistry.v1.base"
  }
}
EOF

echo -e "${YELLOW}Deploying QIP Registry...${NC}"
if [ "$DRY_RUN" = false ]; then
    echo -e "${YELLOW}(You will be prompted for keystore password again)${NC}"
fi
echo ""

# Build deployment command
DEPLOY_CMD="INITIAL_ADMIN=$DEPLOYER_ADDRESS forge script script/DeployWithStandardCreate2.s.sol:DeployWithStandardCreate2 \
    --rpc-url $BASE_RPC_URL \
    --account $KEYSTORE_ACCOUNT"

if [ "$DRY_RUN" = false ]; then
    DEPLOY_CMD="$DEPLOY_CMD --broadcast"
fi

DEPLOY_CMD="$DEPLOY_CMD --slow -vvv"

# Execute deployment
DEPLOYMENT_OUTPUT=$(eval $DEPLOY_CMD 2>&1)

# Check deployment result
if echo "$DEPLOYMENT_OUTPUT" | grep -q "ONCHAIN EXECUTION COMPLETE"; then
    echo -e "${GREEN}  ✅ Deployment transaction broadcast successfully${NC}"
    
    # Update deployment record
    sed -i.bak 's/"status": "pending"/"status": "deployed"/' $DEPLOYMENT_RECORD
    
    # Extract transaction hash if available
    TX_HASH=$(echo "$DEPLOYMENT_OUTPUT" | grep -o "0x[a-fA-F0-9]\{64\}" | head -1)
    if [ -n "$TX_HASH" ]; then
        echo -e "${GREEN}  ✅ Transaction hash: $TX_HASH${NC}"
        echo "  View on Basescan: https://basescan.org/tx/$TX_HASH"
    fi
else
    echo -e "${RED}  ❌ Deployment failed${NC}"
    sed -i.bak 's/"status": "pending"/"status": "failed"/' $DEPLOYMENT_RECORD
    echo ""
    echo "Error output:"
    echo "$DEPLOYMENT_OUTPUT" | tail -20
    exit 1
fi

# ============================================
# STEP 6: Verify Deployment
# ============================================
echo ""
echo -e "${BOLD}${BLUE}✅ Step 5: Verifying Deployment${NC}"
echo "----------------------------------------"

# Wait for transaction to be mined
echo -e "${YELLOW}Waiting for transaction to be mined...${NC}"
sleep 15

# Check contract deployment
CODE_SIZE=$(cast codesize $REGISTRY_ADDRESS --rpc-url $BASE_RPC_URL 2>/dev/null || echo "0")
if [ "$CODE_SIZE" != "0" ] && [ "$CODE_SIZE" != "0x0" ]; then
    echo -e "${GREEN}  ✅ Contract deployed successfully${NC}"
else
    echo -e "${RED}  ❌ Contract not found at expected address${NC}"
    exit 1
fi

# Verify admin role
echo -e "${YELLOW}Verifying admin access...${NC}"
ADMIN_ROLE="0x0000000000000000000000000000000000000000000000000000000000000000"
HAS_ROLE=$(cast call $REGISTRY_ADDRESS "hasRole(bytes32,address)(bool)" $ADMIN_ROLE $DEPLOYER_ADDRESS --rpc-url $BASE_RPC_URL 2>/dev/null || echo "false")

if [ "$HAS_ROLE" = "true" ]; then
    echo -e "${GREEN}  ✅ Admin role confirmed${NC}"
else
    echo -e "${RED}  ❌ Admin role not set correctly${NC}"
fi

# ============================================
# STEP 7: Contract Verification
# ============================================
if [ "$VERIFY_ON_BASESCAN" = true ] && [ "$VERIFY_CONTRACT" = true ]; then
    echo ""
    echo -e "${BOLD}${BLUE}🔍 Step 6: Verifying on Basescan${NC}"
    echo "----------------------------------------"
    
    echo -e "${YELLOW}Submitting contract for verification...${NC}"
    
    forge verify-contract \
        --chain-id 8453 \
        --compiler-version v0.8.30 \
        --constructor-args $(cast abi-encode "constructor(uint256,address)" 209 $DEPLOYER_ADDRESS) \
        --watch \
        $REGISTRY_ADDRESS \
        contracts/QIPRegistry.sol:QIPRegistry
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}  ✅ Contract verified on Basescan${NC}"
    else
        echo -e "${YELLOW}  ⚠️  Verification failed (can retry manually)${NC}"
    fi
fi

# ============================================
# STEP 8: Update Configuration
# ============================================
echo ""
echo -e "${BOLD}${BLUE}📝 Step 7: Updating Configuration${NC}"
echo "----------------------------------------"

# Update .env.production
if [ -f .env.production ]; then
    echo -e "${YELLOW}Updating .env.production...${NC}"
    sed -i.bak "s|^VITE_QIP_REGISTRY_ADDRESS=.*|VITE_QIP_REGISTRY_ADDRESS=$REGISTRY_ADDRESS|" .env.production
    echo -e "${GREEN}  ✅ Environment file updated${NC}"
fi

# Create latest deployment symlink
ln -sf "$DEPLOYMENT_RECORD" "$DEPLOYMENT_DIR/latest.json"
echo -e "${GREEN}  ✅ Deployment record saved${NC}"

# ============================================
# STEP 9: Post-Deployment Instructions
# ============================================
echo ""
echo -e "${BOLD}${GREEN}🎉 DEPLOYMENT SUCCESSFUL!${NC}"
echo "============================================"
echo ""
echo -e "${BOLD}Contract Details:${NC}"
echo "  Registry: $REGISTRY_ADDRESS"
echo "  Admin: $DEPLOYER_ADDRESS"
echo "  Network: Base Mainnet (8453)"
echo ""
echo -e "${BOLD}View on Basescan:${NC}"
echo "  https://basescan.org/address/$REGISTRY_ADDRESS"
echo ""
echo -e "${BOLD}Next Steps:${NC}"
echo ""
echo "1. Update GitHub Secrets:"
echo "   ${CYAN}gh secret set QIP_REGISTRY_ADDRESS --body \"$REGISTRY_ADDRESS\"${NC}"
echo "   ${CYAN}gh secret set BASE_RPC_URL --body \"$BASE_RPC_URL\"${NC}"
echo ""
echo "2. Migrate existing QIPs (if needed):"
echo "   ${CYAN}export VITE_QIP_REGISTRY_ADDRESS=$REGISTRY_ADDRESS${NC}"
echo "   ${CYAN}bun run migrate:qips${NC}"
echo ""
echo "3. Deploy frontend:"
echo "   ${CYAN}git add -A && git commit -m \"Deploy registry to $REGISTRY_ADDRESS\"${NC}"
echo "   ${CYAN}git push origin main${NC}"
echo ""
echo "4. Transfer admin to multi-sig (recommended):"
echo "   ${CYAN}cast send $REGISTRY_ADDRESS \"grantRole(bytes32,address)\" 0x00..00 <MULTISIG_ADDRESS> --account $KEYSTORE_ACCOUNT${NC}"
echo ""
echo -e "${BOLD}Deployment Record:${NC}"
echo "  $DEPLOYMENT_RECORD"
echo ""
echo "============================================"
echo -e "${BOLD}${GREEN}Deployment completed at $(date)${NC}"
echo "============================================"