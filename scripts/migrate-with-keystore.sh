#!/bin/bash

# ============================================
# QIP Migration Script using Foundry Keystore
# ============================================
# Secure migration using cast commands and keystore authentication

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
QIP_DIR="contents/QIP"
DRY_RUN=false
SKIP_CONFIRMATION=false

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
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --dry-run             Show what would be migrated without executing"
            echo "  --account=<name>      Keystore account name (default: mainnet-deployer)"
            echo "  --skip-confirmation   Skip migration confirmation prompt"
            echo "  --help                Show this help message"
            echo ""
            echo "Prerequisites:"
            echo "  1. Deploy the registry: ./scripts/deploy-production.sh"
            echo "  2. Import keystore account: cast wallet import <name> --interactive"
            echo "  3. Set environment variables in .env.production:"
            echo "     - VITE_QIP_REGISTRY_ADDRESS"
            echo "     - VITE_BASE_RPC_URL"
            echo "     - PINATA_JWT"
            exit 0
            ;;
    esac
done

clear
echo -e "${BOLD}${CYAN}============================================${NC}"
echo -e "${BOLD}${CYAN}📦 QIP Migration with Keystore${NC}"
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
# Use custom gateway unless explicitly overridden
if [ -z "$VITE_PINATA_GATEWAY" ] && [ -z "$PINATA_GATEWAY" ]; then
    PINATA_GATEWAY="https://harlequin-reluctant-parrotfish-147.mypinata.cloud"
elif [ "$VITE_PINATA_GATEWAY" = "https://gateway.pinata.cloud" ]; then
    # Override the default public gateway with custom one
    echo -e "${YELLOW}  ℹ️  Overriding public gateway with custom gateway${NC}"
    PINATA_GATEWAY="https://harlequin-reluctant-parrotfish-147.mypinata.cloud"
else
    PINATA_GATEWAY="${VITE_PINATA_GATEWAY:-$PINATA_GATEWAY}"
fi
PINATA_GROUP_ID="${VITE_PINATA_GROUP_ID:-$PINATA_GROUP_ID}"

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
echo -e "${GREEN}  ✅ IPFS Gateway: $PINATA_GATEWAY${NC}"
if [ ! -z "$PINATA_GROUP_ID" ]; then
    echo -e "${GREEN}  ✅ Pinata Group ID: $PINATA_GROUP_ID${NC}"
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

# Function to parse QIP frontmatter
parse_qip_frontmatter() {
    local file=$1
    local field=$2
    
    # Extract frontmatter section
    sed -n '/^---$/,/^---$/p' "$file" | grep "^$field:" | cut -d':' -f2- | sed 's/^ *//;s/ *$//'
}

# Function to get QIP content without frontmatter
get_qip_content() {
    local file=$1
    # Get everything after the second ---
    awk '/^---$/{count++; if(count==2) {found=1; next}} found' "$file"
}

# Function to convert status string to enum
get_status_enum() {
    case "$1" in
        "Draft") echo "0" ;;
        "Review"|"Review Pending") echo "1" ;;
        "Vote"|"Vote Pending") echo "2" ;;
        "Approved") echo "3" ;;
        "Rejected") echo "4" ;;
        "Implemented") echo "5" ;;
        "Superseded") echo "6" ;;
        "Withdrawn") echo "7" ;;
        *) echo "0" ;;
    esac
}

# Function to upload to IPFS via Pinata
upload_to_ipfs() {
    local content="$1"
    local qip_num="$2"
    
    # Create JSON wrapper with content field (matching frontend's MaiAPIProvider format)
    # The frontend expects JSON with a "content" field containing the markdown
    local json_content=$(jq -n --arg content "$content" '{"content":$content,"type":"markdown"}')
    
    # Create temp file with the JSON
    local json_file=$(mktemp).json
    echo "$json_content" > "$json_file"
    
    # Build pinataOptions with group ID if available
    local pinata_options='{"cidVersion":1'
    if [ ! -z "$PINATA_GROUP_ID" ]; then
        pinata_options="${pinata_options},\"groupId\":\"$PINATA_GROUP_ID\""
    fi
    pinata_options="${pinata_options}}"
    
    # Upload to Pinata with verbose error handling
    local response=$(curl -s -X POST \
        -H "Authorization: Bearer $PINATA_JWT" \
        -F "file=@$json_file;type=application/json" \
        -F "pinataMetadata={\"name\":\"QIP-$qip_num.json\"}" \
        -F "pinataOptions=$pinata_options" \
        "https://api.pinata.cloud/pinning/pinFileToIPFS" 2>&1)
    
    # Debug: Show response if verbose mode
    if [ ! -z "$DEBUG" ]; then
        echo "Pinata response: $response" >&2
    fi
    
    # Clean up JSON file
    rm -f "$json_file"
    
    # Check for various error conditions
    if [ -z "$response" ]; then
        echo "  Error: Empty response from Pinata API" >&2
        echo "  Check your PINATA_JWT token is valid" >&2
        echo ""
        return 1
    fi
    
    if echo "$response" | grep -q '"error"'; then
        local error_msg=$(echo "$response" | grep -o '"error":"[^"]*' | cut -d'"' -f4)
        echo "  Pinata error: $error_msg" >&2
        echo ""
        return 1
    fi
    
    if echo "$response" | grep -q '"message"'; then
        local msg=$(echo "$response" | grep -o '"message":"[^"]*' | cut -d'"' -f4)
        echo "  Pinata message: $msg" >&2
        echo ""
        return 1
    fi
    
    # Extract CID
    local cid=$(echo "$response" | grep -o '"IpfsHash":"[^"]*' | cut -d'"' -f4)
    
    if [ -z "$cid" ]; then
        echo "  Failed to extract CID from response" >&2
        if [ -z "$DEBUG" ]; then
            echo "  Run with DEBUG=1 to see full response" >&2
        fi
        echo ""
        return 1
    fi
    
    echo "$cid"
}

# Get QIP files
QIP_FILES=$(ls $QIP_DIR/QIP-*.md 2>/dev/null | sort -V)
QIP_COUNT=$(echo "$QIP_FILES" | wc -l | tr -d ' ')

if [ "$QIP_COUNT" -eq 0 ] || [ -z "$QIP_FILES" ]; then
    echo -e "${YELLOW}No QIP files found to migrate${NC}"
    exit 0
fi

echo -e "\n${BOLD}${BLUE}Found $QIP_COUNT QIP files${NC}"

# Show range
FIRST_QIP=$(echo "$QIP_FILES" | head -1 | grep -oE 'QIP-([0-9]+)' | cut -d'-' -f2)
LAST_QIP=$(echo "$QIP_FILES" | tail -1 | grep -oE 'QIP-([0-9]+)' | cut -d'-' -f2)
echo -e "Range: QIP-${FIRST_QIP} to QIP-${LAST_QIP}"

if [ "$DRY_RUN" = true ]; then
    echo -e "\n${YELLOW}🔍 DRY RUN MODE${NC}"
    echo -e "\nWould migrate:"
    for file in $QIP_FILES; do
        QIP_NUM=$(basename "$file" | grep -oE '[0-9]+')
        TITLE=$(parse_qip_frontmatter "$file" "title")
        echo "  - QIP-$QIP_NUM: $TITLE"
    done
    exit 0
fi

# Confirmation
if [ "$SKIP_CONFIRMATION" = false ]; then
    echo -e "\n${BOLD}${YELLOW}⚠️  MIGRATION CONFIRMATION${NC}"
    echo "----------------------------------------"
    echo "This will:"
    echo "  1. Upload QIP content to IPFS"
    echo "  2. Create on-chain records"
    echo "  3. Consume gas (~0.001 ETH per QIP)"
    echo ""
    echo -e "${BOLD}Estimated total: ~$(echo "scale=3; $QIP_COUNT * 0.001" | bc) ETH${NC}"
    echo ""
    read -p "Type 'MIGRATE' to proceed: " CONFIRM
    
    if [ "$CONFIRM" != "MIGRATE" ]; then
        echo -e "${RED}Migration cancelled${NC}"
        exit 0
    fi
fi

# Migration counters
MIGRATED=0
SKIPPED=0
FAILED=0

echo -e "\n${BOLD}${BLUE}Starting Migration...${NC}"
echo "============================================"

# Process each QIP
for file in $QIP_FILES; do
    QIP_NUM=$(basename "$file" | grep -oE '[0-9]+')
    TITLE=$(parse_qip_frontmatter "$file" "title")
    
    echo -e "\n${CYAN}Processing QIP-$QIP_NUM: $TITLE${NC}"
    
    # Initialize update flag
    NEEDS_UPDATE=false
    
    # Check if already migrated
    # First check if QIP exists on-chain
    EXISTING=$(cast call $REGISTRY \
        "qips(uint256)(uint256)" \
        $QIP_NUM \
        --rpc-url $RPC_URL 2>/dev/null || echo "0")
    
    # If the QIP number is non-zero, it exists on-chain
    if [ "$EXISTING" != "0" ] && [ "$EXISTING" != "0x0000000000000000000000000000000000000000000000000000000000000000" ]; then
        echo -e "${YELLOW}  📋 Found on-chain, verifying IPFS content...${NC}"
        
        # Get the full QIP data from the contract
        QIP_DATA=$(cast call $REGISTRY \
            "qips(uint256)(uint256,address,string,string,bytes32,string,uint256,uint256,uint8,string,uint256,string,uint256)" \
            $QIP_NUM \
            --rpc-url $RPC_URL 2>/dev/null || echo "")
        
        # Get the IPFS URL from line 6 and status from line 9
        IPFS_URL_RAW=$(echo "$QIP_DATA" | sed -n '6p' || echo "")
        CURRENT_STATUS=$(echo "$QIP_DATA" | sed -n '9p' || echo "0")
        
        # Decode the string (remove quotes if present)
        IPFS_URL=$(echo "$IPFS_URL_RAW" | sed 's/^"//;s/"$//')
        
        if [ ! -z "$IPFS_URL" ]; then
            # Extract CID from ipfs:// URL
            CID=$(echo "$IPFS_URL" | sed 's|^ipfs://||')
            
            if [ ! -z "$CID" ]; then
                # Try custom Pinata gateway first (most reliable)
                GATEWAY_URL="${PINATA_GATEWAY}/ipfs/$CID"
                FALLBACK_GATEWAY="https://ipfs.io/ipfs/$CID"
                
                # Try to fetch first 500 bytes with 5 second timeout
                # Your custom Pinata gateway should work without Cloudflare issues
                echo -e "${YELLOW}    Testing gateway: ${GATEWAY_URL:0:50}...${NC}"
                
                # Use curl with proper output capture
                TEMP_RESPONSE=$(mktemp)
                CURL_OUTPUT=$(curl -s -S -w "\nHTTP_CODE:%{http_code}" --max-time 5 --range 0-499 -o "$TEMP_RESPONSE" "$GATEWAY_URL" 2>&1)
                CURL_EXIT=$?
                
                # Extract HTTP code from curl output
                IPFS_HTTP_CODE=$(echo "$CURL_OUTPUT" | grep "HTTP_CODE:" | cut -d':' -f2)
                IPFS_CONTENT=$(cat "$TEMP_RESPONSE" 2>/dev/null)
                rm -f "$TEMP_RESPONSE"
                
                # Show what happened
                if [ "$CURL_EXIT" -ne 0 ]; then
                    echo -e "${RED}    Curl failed with exit code $CURL_EXIT${NC}"
                    if [[ "$CURL_OUTPUT" =~ "timed out" ]]; then
                        echo -e "${RED}    Timeout after 5 seconds${NC}"
                        IPFS_HTTP_CODE="000"
                    else
                        echo -e "${RED}    Curl error: $CURL_OUTPUT${NC}"
                    fi
                elif [ -z "$IPFS_HTTP_CODE" ]; then
                    echo -e "${RED}    Failed to get HTTP status code${NC}"
                    IPFS_HTTP_CODE="000"
                else
                    echo -e "${CYAN}    HTTP Status: $IPFS_HTTP_CODE${NC}"
                fi
                
                # Show content preview if we got something
                if [ ! -z "$IPFS_CONTENT" ] && [ "$IPFS_HTTP_CODE" = "200" -o "$IPFS_HTTP_CODE" = "206" ]; then
                    PREVIEW=$(echo "$IPFS_CONTENT" | head -1 | cut -c1-60)
                    echo -e "${CYAN}    Content preview: $PREVIEW${NC}"
                fi
                
                # If custom gateway fails, try ipfs.io as fallback
                if [ -z "$IPFS_CONTENT" ] || [[ "$IPFS_CONTENT" =~ "<!DOCTYPE" ]] || [ "$IPFS_HTTP_CODE" != "200" ] && [ "$IPFS_HTTP_CODE" != "206" ]; then
                    if [ "$IPFS_HTTP_CODE" = "000" ]; then
                        echo -e "${YELLOW}    Custom gateway timeout, trying fallback...${NC}"
                    elif [ "$IPFS_HTTP_CODE" != "200" ] && [ "$IPFS_HTTP_CODE" != "206" ] && [ "$IPFS_HTTP_CODE" != "000" ]; then
                        echo -e "${YELLOW}    Custom gateway returned HTTP $IPFS_HTTP_CODE, trying fallback...${NC}"
                    fi
                    
                    echo -e "${YELLOW}    Trying fallback: ${FALLBACK_GATEWAY:0:40}...${NC}"
                    TEMP_RESPONSE=$(mktemp)
                    CURL_OUTPUT=$(curl -s -S -w "\nHTTP_CODE:%{http_code}" --max-time 5 --range 0-499 -o "$TEMP_RESPONSE" "$FALLBACK_GATEWAY" 2>&1)
                    CURL_EXIT=$?
                    
                    IPFS_HTTP_CODE=$(echo "$CURL_OUTPUT" | grep "HTTP_CODE:" | cut -d':' -f2)
                    IPFS_CONTENT=$(cat "$TEMP_RESPONSE" 2>/dev/null)
                    rm -f "$TEMP_RESPONSE"
                    
                    if [ "$CURL_EXIT" -ne 0 ]; then
                        echo -e "${RED}    Fallback curl failed: $CURL_OUTPUT${NC}"
                        IPFS_HTTP_CODE="000"
                    elif [ ! -z "$IPFS_HTTP_CODE" ]; then
                        echo -e "${CYAN}    Fallback HTTP Status: $IPFS_HTTP_CODE${NC}"
                    fi
                fi
                
                if [ ! -z "$IPFS_CONTENT" ] && [[ ! "$IPFS_CONTENT" =~ "<!DOCTYPE" ]]; then
                    # Check if content is JSON-wrapped (new format) or raw markdown (old format)
                    if echo "$IPFS_CONTENT" | jq -e '.content' >/dev/null 2>&1; then
                        # It's JSON-wrapped, this is the correct format
                        echo -e "${GREEN}  ✅ IPFS verified: JSON-wrapped content${NC}"
                        echo -e "${YELLOW}  ⏭️  Already migrated with correct format, skipping${NC}"
                        ((SKIPPED++))
                        continue
                    elif [[ "$IPFS_CONTENT" =~ ^--- ]]; then
                        # It's raw markdown with frontmatter (old format), needs update
                        echo -e "${YELLOW}  ⚠️  IPFS has old format (raw markdown), needs JSON wrapping${NC}"
                        echo -e "${YELLOW}  🔧 Will update to JSON format using updateQIP${NC}"
                        NEEDS_UPDATE=true
                    else
                        # Unknown format
                        echo -e "${RED}  ⚠️  IPFS has unknown format${NC}"
                        echo -e "${YELLOW}  🔧 Will re-upload with correct format${NC}"
                        NEEDS_UPDATE=true
                    fi
                else
                    # Provide specific error details
                    if [ "$IPFS_HTTP_CODE" = "000" ]; then
                        echo -e "${RED}  ⚠️  IPFS timeout - no response within 5 seconds${NC}"
                    elif [ "$IPFS_HTTP_CODE" = "404" ]; then
                        echo -e "${RED}  ⚠️  IPFS content not found (404) - CID may not be pinned${NC}"
                    elif [ "$IPFS_HTTP_CODE" = "504" ] || [ "$IPFS_HTTP_CODE" = "502" ]; then
                        echo -e "${RED}  ⚠️  Gateway error ($IPFS_HTTP_CODE) - IPFS node may be down${NC}"
                    elif [[ "$IPFS_CONTENT" =~ "<!DOCTYPE" ]]; then
                        echo -e "${RED}  ⚠️  Gateway returned HTML instead of content (likely Cloudflare)${NC}"
                    elif [ -z "$IPFS_CONTENT" ]; then
                        echo -e "${RED}  ⚠️  Empty response from IPFS (HTTP $IPFS_HTTP_CODE)${NC}"
                    else
                        echo -e "${RED}  ⚠️  IPFS content not accessible (HTTP $IPFS_HTTP_CODE)${NC}"
                    fi
                    echo -e "${YELLOW}  🔧 Will update IPFS URL using updateQIP${NC}"
                    NEEDS_UPDATE=true
                fi
            else
                echo -e "${RED}  ⚠️  No CID found in IPFS URL${NC}"
                echo -e "${YELLOW}  🔧 Will update IPFS URL using updateQIP${NC}"
                NEEDS_UPDATE=true
            fi
        else
            echo -e "${RED}  ⚠️  No IPFS URL found in contract${NC}"
            echo -e "${YELLOW}  🔧 Will update IPFS URL using updateQIP${NC}"
            NEEDS_UPDATE=true
        fi
        
        # If IPFS needs fixing, upload new version and update
        if [ "$NEEDS_UPDATE" = true ]; then
            # Continue to re-upload and update the QIP
            echo -e "${YELLOW}  📤 Re-uploading to IPFS with JSON wrapper format...${NC}"
        fi
    fi
    
    # Parse frontmatter
    AUTHOR=$(parse_qip_frontmatter "$file" "author")
    NETWORK=$(parse_qip_frontmatter "$file" "network")
    STATUS=$(parse_qip_frontmatter "$file" "status")
    IMPLEMENTOR=$(parse_qip_frontmatter "$file" "implementor")
    IMPL_DATE=$(parse_qip_frontmatter "$file" "implementation-date")
    PROPOSAL=$(parse_qip_frontmatter "$file" "proposal")
    CREATED=$(parse_qip_frontmatter "$file" "created")
    
    # Get content
    CONTENT=$(get_qip_content "$file")
    
    # Build full document
    FULL_CONTENT="---
qip: $QIP_NUM
title: $TITLE
network: $NETWORK
status: $STATUS
author: $AUTHOR
implementor: $IMPLEMENTOR
implementation-date: $IMPL_DATE
proposal: $PROPOSAL
created: $CREATED
---

$CONTENT"
    
    # Upload to IPFS
    echo -e "${YELLOW}  📤 Uploading to IPFS...${NC}"
    CID=$(upload_to_ipfs "$FULL_CONTENT" "$QIP_NUM")
    
    if [ -z "$CID" ]; then
        echo -e "${RED}  ❌ Failed to upload to IPFS${NC}"
        ((FAILED++))
        continue
    fi
    
    echo -e "${GREEN}  ✅ IPFS CID: $CID${NC}"
    
    # Prepare data for contract call
    IPFS_URL="ipfs://$CID"
    CONTENT_HASH=$(echo -n "$FULL_CONTENT" | sha256sum | cut -d' ' -f1)
    CONTENT_HASH="0x$CONTENT_HASH"
    
    # Convert author to address (use placeholder if not an address)
    if [[ "$AUTHOR" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
        AUTHOR_ADDRESS="$AUTHOR"
    else
        AUTHOR_ADDRESS="0x0000000000000000000000000000000000000001"
    fi
    
    # Convert dates to timestamps
    CREATED_TS=$(date -j -f "%Y-%m-%d" "$CREATED" "+%s" 2>/dev/null || echo "0")
    if [ "$IMPL_DATE" != "None" ] && [ ! -z "$IMPL_DATE" ]; then
        IMPL_TS=$(date -j -f "%Y-%m-%d" "$IMPL_DATE" "+%s" 2>/dev/null || echo "0")
    else
        IMPL_TS="0"
    fi
    
    # Get status enum
    STATUS_ENUM=$(get_status_enum "$STATUS")
    
    # Choose between migrateQIP or updateQIP based on whether QIP exists
    echo -e "${YELLOW}  🔗 Submitting to blockchain...${NC}"
    echo -e "${YELLOW}  (You may be prompted for keystore password)${NC}"
    
    if [ "$NEEDS_UPDATE" = true ]; then
        # Use updateQIP to fix IPFS URL for existing QIP
        echo -e "${YELLOW}  Using updateQIP to fix IPFS URL...${NC}"
        
        # Save the current status (already fetched above)
        echo -e "${CYAN}  Current status code: $CURRENT_STATUS${NC}"
        
        # If status is beyond ReviewPending (1), temporarily change to Draft (0)
        STATUS_CHANGED=false
        if [ "$CURRENT_STATUS" -gt "1" ] 2>/dev/null || [ "$CURRENT_STATUS" = "2" ] || [ "$CURRENT_STATUS" = "3" ] || [ "$CURRENT_STATUS" = "4" ] || [ "$CURRENT_STATUS" = "5" ] || [ "$CURRENT_STATUS" = "6" ] || [ "$CURRENT_STATUS" = "7" ]; then
            echo -e "${YELLOW}  🔓 Temporarily changing status to Draft to allow update...${NC}"
            STATUS_OUTPUT=$(cast send $REGISTRY \
                "updateStatus(uint256,uint8)" \
                $QIP_NUM 0 \
                --account $KEYSTORE_ACCOUNT \
                --rpc-url $RPC_URL \
                --json 2>&1)
            
            if echo "$STATUS_OUTPUT" | grep -q '"transactionHash"'; then
                echo -e "${GREEN}  ✅ Status temporarily changed to Draft${NC}"
                STATUS_CHANGED=true
                sleep 1  # Give the chain a moment
            else
                echo -e "${RED}  ❌ Failed to change status${NC}"
                echo -e "${RED}  Error: $STATUS_OUTPUT${NC}"
            fi
        fi
        
        # Now update the QIP
        UPDATE_OUTPUT=$(cast send $REGISTRY \
            "updateQIP(uint256,string,bytes32,string,string)" \
            $QIP_NUM \
            "$TITLE" \
            "$CONTENT_HASH" \
            "$IPFS_URL" \
            "Fixed IPFS URL format to JSON during migration" \
            --account $KEYSTORE_ACCOUNT \
            --rpc-url $RPC_URL \
            --json 2>&1)
        
        TX_HASH=$(echo "$UPDATE_OUTPUT" | grep -o '"transactionHash":"[^"]*' | cut -d'"' -f4 || echo "")
        
        if [ ! -z "$TX_HASH" ]; then
            echo -e "${GREEN}  ✅ Transaction: $TX_HASH${NC}"
            echo -e "${GREEN}  ✅ QIP-$QIP_NUM IPFS URL updated successfully${NC}"
            
            # Restore original status if we changed it
            if [ "$STATUS_CHANGED" = true ]; then
                echo -e "${YELLOW}  🔒 Restoring original status ($CURRENT_STATUS)...${NC}"
                RESTORE_OUTPUT=$(cast send $REGISTRY \
                    "updateStatus(uint256,uint8)" \
                    $QIP_NUM $CURRENT_STATUS \
                    --account $KEYSTORE_ACCOUNT \
                    --rpc-url $RPC_URL \
                    --json 2>&1)
                
                if echo "$RESTORE_OUTPUT" | grep -q '"transactionHash"'; then
                    echo -e "${GREEN}  ✅ Status restored successfully${NC}"
                else
                    echo -e "${RED}  ⚠️  Failed to restore status - QIP left in Draft!${NC}"
                    echo -e "${RED}  Manual fix needed: cast send $REGISTRY \"updateStatus(uint256,uint8)\" $QIP_NUM $CURRENT_STATUS${NC}"
                fi
            fi
            
            ((MIGRATED++))
        else
            echo -e "${RED}  ❌ Failed to update QIP-$QIP_NUM${NC}"
            # Show the actual error
            ERROR_MSG=$(echo "$UPDATE_OUTPUT" | grep -E "error|Error|revert|require" | head -3)
            if [ ! -z "$ERROR_MSG" ]; then
                echo -e "${RED}  Error details: $ERROR_MSG${NC}"
            else
                echo -e "${RED}  Full output: $UPDATE_OUTPUT${NC}"
            fi
            
            # Try to restore status if we changed it
            if [ "$STATUS_CHANGED" = true ]; then
                echo -e "${YELLOW}  🔒 Attempting to restore original status...${NC}"
                cast send $REGISTRY \
                    "updateStatus(uint256,uint8)" \
                    $QIP_NUM $CURRENT_STATUS \
                    --account $KEYSTORE_ACCOUNT \
                    --rpc-url $RPC_URL >/dev/null 2>&1
            fi
            
            ((FAILED++))
        fi
    else
        # Use migrateQIP for new QIPs
        MIGRATE_OUTPUT=$(cast send $REGISTRY \
            "migrateQIP(uint256,address,string,string,bytes32,string,uint256,uint8,string,uint256,string)" \
            $QIP_NUM \
            "$AUTHOR_ADDRESS" \
            "$TITLE" \
            "$NETWORK" \
            "$CONTENT_HASH" \
            "$IPFS_URL" \
            $CREATED_TS \
            $STATUS_ENUM \
            "$IMPLEMENTOR" \
            $IMPL_TS \
            "$PROPOSAL" \
            --account $KEYSTORE_ACCOUNT \
            --rpc-url $RPC_URL \
            --json 2>&1)
        
        TX_HASH=$(echo "$MIGRATE_OUTPUT" | grep -o '"transactionHash":"[^"]*' | cut -d'"' -f4 || echo "")
        
        if [ ! -z "$TX_HASH" ]; then
            echo -e "${GREEN}  ✅ Transaction: $TX_HASH${NC}"
            echo -e "${GREEN}  ✅ QIP-$QIP_NUM migrated successfully${NC}"
            ((MIGRATED++))
        else
            echo -e "${RED}  ❌ Failed to migrate QIP-$QIP_NUM${NC}"
            # Show the actual error
            ERROR_MSG=$(echo "$MIGRATE_OUTPUT" | grep -E "error|Error|revert|require" | head -3)
            if [ ! -z "$ERROR_MSG" ]; then
                echo -e "${RED}  Error details: $ERROR_MSG${NC}"
            else
                echo -e "${RED}  Full output: $MIGRATE_OUTPUT${NC}"
            fi
            ((FAILED++))
        fi
    fi
    
    # Rate limiting
    sleep 2
done

# Summary
echo -e "\n${BOLD}${GREEN}============================================${NC}"
echo -e "${BOLD}${GREEN}📊 Migration Complete!${NC}"
echo -e "${BOLD}${GREEN}============================================${NC}"
echo ""
echo -e "  ${GREEN}✅ Migrated: $MIGRATED${NC}"
echo -e "  ${YELLOW}⏭️  Skipped: $SKIPPED${NC}"
echo -e "  ${RED}❌ Failed: $FAILED${NC}"

if [ "$MIGRATED" -gt 0 ]; then
    echo -e "\n${BOLD}Next Steps:${NC}"
    echo "  1. Verify on Basescan:"
    echo "     https://basescan.org/address/$REGISTRY"
    echo "  2. Sync nextQIPNumber if needed:"
    echo "     cast send $REGISTRY \"syncNextQIPNumber()\" --account $KEYSTORE_ACCOUNT"
    echo "  3. Consider disabling migration mode:"
    echo "     cast send $REGISTRY \"setMigrationMode(bool)\" false --account $KEYSTORE_ACCOUNT"
fi

echo ""
echo -e "${BOLD}${GREEN}Completed at $(date)${NC}"