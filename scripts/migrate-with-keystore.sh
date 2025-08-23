#!/bin/bash

# ============================================
# QIP Batch Migration Script using Foundry FFI
# ============================================
# Fast batch migration using Foundry's FFI capabilities with keystore authentication

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Configuration defaults
KEYSTORE_ACCOUNT="mainnet-deployer"
DRY_RUN=false
SKIP_CONFIRMATION=false
VERBOSE=false

# Parse command line arguments
for arg in "$@"; do
    case $arg in
        --dry-run)
            DRY_RUN=true
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
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --dry-run             Simulate migration without executing"
            echo "  --account=<name>      Keystore account name (default: mainnet-deployer)"
            echo "  --skip-confirmation   Skip migration confirmation prompt"
            echo "  --verbose, -v         Show detailed Foundry output"
            echo "  --help                Show this help message"
            echo ""
            echo "Prerequisites:"
            echo "  1. Deploy the registry: ./scripts/deploy-production.sh"
            echo "  2. Import keystore account: cast wallet import <name> --interactive"
            echo "  3. Set environment variables in .env.production:"
            echo "     - VITE_QIP_REGISTRY_ADDRESS"
            echo "     - VITE_BASE_RPC_URL or BASE_RPC_URL"
            echo "     - PINATA_JWT (required for IPFS uploads)"
            echo ""
            echo "This script uses Foundry's FFI for fast batch migration."
            exit 0
            ;;
    esac
done

clear
echo -e "${BOLD}${CYAN}============================================${NC}"
echo -e "${BOLD}${CYAN}📦 QIP Batch Migration with Foundry FFI${NC}"
echo -e "${BOLD}${CYAN}============================================${NC}"
echo ""

# Load environment
if [ -f .env.production ]; then
    echo -e "${GREEN}✅ Loading .env.production${NC}"
    source .env.production
else
    echo -e "${YELLOW}⚠️  No .env.production found, using .env${NC}"
    if [ -f .env ]; then
        source .env
    else
        echo -e "${RED}❌ No environment file found${NC}"
        exit 1
    fi
fi

# Set variables with fallbacks
REGISTRY="${VITE_QIP_REGISTRY_ADDRESS:-$QIP_REGISTRY_ADDRESS}"
RPC_URL="${VITE_BASE_RPC_URL:-${BASE_RPC_URL:-https://mainnet.base.org}}"

# Validate configuration
echo -e "${YELLOW}Validating configuration...${NC}"

if [ -z "$REGISTRY" ]; then
    echo -e "${RED}❌ QIP_REGISTRY_ADDRESS not set${NC}"
    echo "   Run deployment first: ./scripts/deploy-production.sh"
    exit 1
fi

if [ -z "$PINATA_JWT" ]; then
    echo -e "${RED}❌ PINATA_JWT not set${NC}"
    echo "   Required for IPFS uploads"
    exit 1
fi

echo -e "${GREEN}  ✅ Registry: $REGISTRY${NC}"
echo -e "${GREEN}  ✅ RPC URL: ${RPC_URL:0:30}...${NC}"
if [ ! -z "$PINATA_JWT" ]; then
    echo -e "${GREEN}  ✅ Pinata JWT: ${PINATA_JWT:0:20}...${NC}"
fi

# Check keystore account
echo -e "\n${YELLOW}Checking keystore account...${NC}"
if ! cast wallet list | grep -q "$KEYSTORE_ACCOUNT"; then
    echo -e "${RED}❌ Keystore account '$KEYSTORE_ACCOUNT' not found${NC}"
    echo ""
    echo "Available accounts:"
    cast wallet list | sed 's/^/    /'
    echo ""
    echo "To import an account:"
    echo "  cast wallet import $KEYSTORE_ACCOUNT --interactive"
    exit 1
fi

echo -e "${GREEN}✅ Using keystore account: $KEYSTORE_ACCOUNT${NC}"
echo -e "${YELLOW}🔐 Enter keystore password:${NC}"
ADMIN_ADDRESS=$(cast wallet address --account $KEYSTORE_ACCOUNT 2>/dev/null)

if [ -z "$ADMIN_ADDRESS" ]; then
    echo -e "${RED}❌ Failed to unlock keystore${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Admin address: $ADMIN_ADDRESS${NC}"

# Verify admin role
echo -e "\n${YELLOW}Verifying admin access...${NC}"
ADMIN_ROLE="0x0000000000000000000000000000000000000000000000000000000000000000"
HAS_ROLE=$(cast call $REGISTRY \
    "hasRole(bytes32,address)(bool)" \
    $ADMIN_ROLE $ADMIN_ADDRESS \
    --rpc-url $RPC_URL 2>/dev/null || echo "false")

if [ "$HAS_ROLE" != "true" ]; then
    echo -e "${RED}❌ Account does not have admin role${NC}"
    echo "   Only the contract admin can migrate QIPs"
    exit 1
fi
echo -e "${GREEN}✅ Admin role confirmed${NC}"

# Check if Foundry and FFI are available
echo -e "\n${YELLOW}Checking Foundry tools...${NC}"
if ! command -v forge &> /dev/null; then
    echo -e "${RED}❌ Forge not found${NC}"
    echo "   Please install Foundry: https://getfoundry.sh"
    exit 1
fi
echo -e "${GREEN}  ✅ Forge installed${NC}"

# Quick check for QIP files
QIP_COUNT=$(ls contents/QIP/QIP-*.md 2>/dev/null | wc -l | tr -d ' ')
if [ "$QIP_COUNT" -eq 0 ]; then
    echo -e "${YELLOW}No QIP files found to migrate${NC}"
    exit 0
fi

echo -e "\n${BOLD}${BLUE}Found $QIP_COUNT QIP files${NC}"

# Show range
FIRST_QIP=$(ls contents/QIP/QIP-*.md 2>/dev/null | head -1 | grep -oE 'QIP-([0-9]+)' | cut -d'-' -f2)
LAST_QIP=$(ls contents/QIP/QIP-*.md 2>/dev/null | tail -1 | grep -oE 'QIP-([0-9]+)' | cut -d'-' -f2)
echo -e "Range: QIP-${FIRST_QIP} to QIP-${LAST_QIP}"

# Dry run mode
if [ "$DRY_RUN" = true ]; then
    echo -e "\n${YELLOW}🔍 DRY RUN MODE${NC}"
    echo -e "\nWould migrate $QIP_COUNT QIP files using Foundry FFI batch migration"
    echo "This would:"
    echo "  • Read QIP files using FFI"
    echo "  • Upload to IPFS with JSON wrapper"
    echo "  • Batch migrate to blockchain (5 QIPs per transaction)"
    exit 0
fi

# Confirmation
if [ "$SKIP_CONFIRMATION" = false ]; then
    echo -e "\n${BOLD}${YELLOW}⚠️  BATCH MIGRATION CONFIRMATION${NC}"
    echo "----------------------------------------"
    echo "This will:"
    echo "  1. Use Foundry FFI to read QIP files"
    echo "  2. Upload content to IPFS (JSON-wrapped)"
    echo "  3. Batch migrate to blockchain (5 QIPs per tx)"
    echo "  4. Consume gas (~0.005 ETH per batch)"
    echo ""
    BATCH_COUNT=$(( (QIP_COUNT + 4) / 5 ))
    echo -e "${BOLD}Estimated: $BATCH_COUNT batches, ~$(echo "scale=3; $BATCH_COUNT * 0.005" | bc) ETH total${NC}"
    echo ""
    read -p "Type 'MIGRATE' to proceed: " CONFIRM
    
    if [ "$CONFIRM" != "MIGRATE" ]; then
        echo -e "${RED}Migration cancelled${NC}"
        exit 0
    fi
fi

# Execute Foundry FFI Batch Migration
echo -e "\n${BOLD}${BLUE}Starting Batch Migration...${NC}"
echo "============================================"
echo -e "${YELLOW}Using Foundry script with FFI for optimal performance${NC}"
echo ""

# Set up verbosity
VERBOSITY=""
if [ "$VERBOSE" = true ]; then
    VERBOSITY="-vvv"
else
    VERBOSITY="-vv"
fi

# Run the Foundry migration script
echo -e "${YELLOW}🔐 You will be prompted for keystore password${NC}"
echo ""

QIP_REGISTRY_ADDRESS="$REGISTRY" \
DEPLOYER_ADDRESS="$ADMIN_ADDRESS" \
PINATA_JWT="$PINATA_JWT" \
forge script script/MigrateBatchWithFFI.s.sol \
    --rpc-url "$RPC_URL" \
    --account "$KEYSTORE_ACCOUNT" \
    --sender "$ADMIN_ADDRESS" \
    --broadcast \
    --ffi \
    $VERBOSITY

MIGRATION_RESULT=$?

# Check migration result
if [ $MIGRATION_RESULT -eq 0 ]; then
    echo -e "\n${BOLD}${GREEN}============================================${NC}"
    echo -e "${BOLD}${GREEN}🎉 Migration Successful!${NC}"
    echo -e "${BOLD}${GREEN}============================================${NC}"
    echo ""
    echo -e "${BOLD}Next Steps:${NC}"
    echo "  1. Verify on Basescan:"
    echo "     https://basescan.org/address/$REGISTRY"
    echo ""
    echo "  2. Check migration status:"
    echo "     cast call $REGISTRY \"nextQIPNumber()(uint256)\" --rpc-url $RPC_URL"
    echo ""
    echo "  3. Consider disabling migration mode:"
    echo "     cast send $REGISTRY \"setMigrationMode(bool)\" false \\"
    echo "       --account $KEYSTORE_ACCOUNT --rpc-url $RPC_URL"
    echo ""
    echo "  4. Sync nextQIPNumber if needed:"
    echo "     cast send $REGISTRY \"syncNextQIPNumber()\" \\"
    echo "       --account $KEYSTORE_ACCOUNT --rpc-url $RPC_URL"
else
    echo -e "\n${RED}❌ Migration failed${NC}"
    echo "Check the error output above for details."
    echo ""
    echo "Common issues:"
    echo "  • Insufficient gas or ETH balance"
    echo "  • PINATA_JWT not valid"
    echo "  • Network connectivity issues"
    echo "  • Contract permissions"
    echo ""
    echo "You can retry the migration by running this script again."
    echo "Already migrated QIPs will be automatically skipped."
    exit 1
fi

echo ""
echo -e "${BOLD}${GREEN}Completed at $(date)${NC}"