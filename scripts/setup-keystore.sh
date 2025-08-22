#!/bin/bash

# ============================================
# Foundry Keystore Setup Script
# ============================================
# This script helps set up secure key management using Foundry's keystore

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}🔐 Foundry Keystore Setup${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""
echo "This script will help you securely store your deployment keys"
echo "using Foundry's encrypted keystore instead of plaintext .env files."
echo ""

# Check if cast is installed
if ! command -v cast &> /dev/null; then
    echo -e "${RED}❌ Error: Foundry not installed${NC}"
    echo "Install Foundry first: https://getfoundry.sh/"
    exit 1
fi

# Show current keystore status
echo -e "${BLUE}📋 Current Keystore Accounts:${NC}"
ACCOUNTS=$(cast wallet list 2>/dev/null)
if [ -z "$ACCOUNTS" ]; then
    echo "  No accounts found in keystore"
else
    echo "$ACCOUNTS"
fi
echo ""

# Menu
echo -e "${YELLOW}What would you like to do?${NC}"
echo "1. Import existing private key"
echo "2. Create new deployment account"
echo "3. Import from mnemonic/seed phrase"
echo "4. Show account details"
echo "5. Remove an account"
echo "6. Exit"
echo ""
read -p "Select option (1-6): " OPTION

case $OPTION in
    1)
        echo ""
        echo -e "${BLUE}Import Existing Private Key${NC}"
        echo "--------------------------------"
        read -p "Enter account name (e.g., 'mainnet-deployer'): " ACCOUNT_NAME
        
        if [ -z "$ACCOUNT_NAME" ]; then
            echo -e "${RED}❌ Account name cannot be empty${NC}"
            exit 1
        fi
        
        echo ""
        echo -e "${YELLOW}Enter your private key (will be hidden):${NC}"
        echo "Note: Include or exclude '0x' prefix, both work"
        read -s PRIVATE_KEY
        echo ""
        
        echo -e "${YELLOW}Enter password for keystore encryption:${NC}"
        read -s PASSWORD
        echo ""
        echo -e "${YELLOW}Confirm password:${NC}"
        read -s PASSWORD_CONFIRM
        echo ""
        
        if [ "$PASSWORD" != "$PASSWORD_CONFIRM" ]; then
            echo -e "${RED}❌ Passwords do not match${NC}"
            exit 1
        fi
        
        # Import the key
        echo "$PRIVATE_KEY" | cast wallet import "$ACCOUNT_NAME" --private-key - --password "$PASSWORD"
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Account '$ACCOUNT_NAME' imported successfully!${NC}"
            
            # Get the address
            ADDRESS=$(cast wallet address --account "$ACCOUNT_NAME" --password "$PASSWORD" 2>/dev/null)
            echo "Address: $ADDRESS"
            echo ""
            echo -e "${BLUE}To use this account for deployment:${NC}"
            echo "  bun run deploy:production -- --keystore --account=$ACCOUNT_NAME"
        else
            echo -e "${RED}❌ Failed to import account${NC}"
            exit 1
        fi
        ;;
        
    2)
        echo ""
        echo -e "${BLUE}Create New Deployment Account${NC}"
        echo "--------------------------------"
        read -p "Enter account name (e.g., 'mainnet-deployer'): " ACCOUNT_NAME
        
        if [ -z "$ACCOUNT_NAME" ]; then
            echo -e "${RED}❌ Account name cannot be empty${NC}"
            exit 1
        fi
        
        echo -e "${YELLOW}Enter password for keystore encryption:${NC}"
        read -s PASSWORD
        echo ""
        echo -e "${YELLOW}Confirm password:${NC}"
        read -s PASSWORD_CONFIRM
        echo ""
        
        if [ "$PASSWORD" != "$PASSWORD_CONFIRM" ]; then
            echo -e "${RED}❌ Passwords do not match${NC}"
            exit 1
        fi
        
        # Generate new key and import it
        echo -e "${YELLOW}Generating new keypair...${NC}"
        NEW_KEY=$(cast wallet new --json | jq -r '.privateKey')
        
        echo "$NEW_KEY" | cast wallet import "$ACCOUNT_NAME" --private-key - --password "$PASSWORD"
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ New account '$ACCOUNT_NAME' created successfully!${NC}"
            
            # Get the address
            ADDRESS=$(cast wallet address --account "$ACCOUNT_NAME" --password "$PASSWORD" 2>/dev/null)
            echo "Address: $ADDRESS"
            echo ""
            echo -e "${RED}⚠️  IMPORTANT: Back up your keystore file!${NC}"
            echo "Location: ~/.foundry/keystores/"
            echo ""
            echo -e "${BLUE}To use this account for deployment:${NC}"
            echo "  bun run deploy:production -- --keystore --account=$ACCOUNT_NAME"
        else
            echo -e "${RED}❌ Failed to create account${NC}"
            exit 1
        fi
        ;;
        
    3)
        echo ""
        echo -e "${BLUE}Import from Mnemonic/Seed Phrase${NC}"
        echo "--------------------------------"
        read -p "Enter account name (e.g., 'mainnet-deployer'): " ACCOUNT_NAME
        
        if [ -z "$ACCOUNT_NAME" ]; then
            echo -e "${RED}❌ Account name cannot be empty${NC}"
            exit 1
        fi
        
        echo -e "${YELLOW}Enter your mnemonic phrase (will be hidden):${NC}"
        read -s MNEMONIC
        echo ""
        
        read -p "Enter derivation index (default 0): " INDEX
        INDEX=${INDEX:-0}
        
        echo -e "${YELLOW}Enter password for keystore encryption:${NC}"
        read -s PASSWORD
        echo ""
        echo -e "${YELLOW}Confirm password:${NC}"
        read -s PASSWORD_CONFIRM
        echo ""
        
        if [ "$PASSWORD" != "$PASSWORD_CONFIRM" ]; then
            echo -e "${RED}❌ Passwords do not match${NC}"
            exit 1
        fi
        
        # Derive private key from mnemonic
        PRIVATE_KEY=$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index "$INDEX" 2>/dev/null)
        
        if [ -z "$PRIVATE_KEY" ]; then
            echo -e "${RED}❌ Failed to derive private key from mnemonic${NC}"
            exit 1
        fi
        
        # Import the derived key
        echo "$PRIVATE_KEY" | cast wallet import "$ACCOUNT_NAME" --private-key - --password "$PASSWORD"
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Account '$ACCOUNT_NAME' imported from mnemonic successfully!${NC}"
            
            # Get the address
            ADDRESS=$(cast wallet address --account "$ACCOUNT_NAME" --password "$PASSWORD" 2>/dev/null)
            echo "Address: $ADDRESS"
            echo "Derivation Path: m/44'/60'/0'/0/$INDEX"
            echo ""
            echo -e "${BLUE}To use this account for deployment:${NC}"
            echo "  bun run deploy:production -- --keystore --account=$ACCOUNT_NAME"
        else
            echo -e "${RED}❌ Failed to import account${NC}"
            exit 1
        fi
        ;;
        
    4)
        echo ""
        echo -e "${BLUE}Show Account Details${NC}"
        echo "--------------------------------"
        read -p "Enter account name: " ACCOUNT_NAME
        
        if [ -z "$ACCOUNT_NAME" ]; then
            echo -e "${RED}❌ Account name cannot be empty${NC}"
            exit 1
        fi
        
        # Get address without password
        ADDRESS=$(cast wallet address --account "$ACCOUNT_NAME" 2>/dev/null)
        
        if [ -z "$ADDRESS" ]; then
            echo -e "${RED}❌ Account '$ACCOUNT_NAME' not found${NC}"
            exit 1
        fi
        
        echo ""
        echo "Account: $ACCOUNT_NAME"
        echo "Address: $ADDRESS"
        echo "Keystore Path: ~/.foundry/keystores/"
        
        # Check balance if network is available
        if [ -n "$BASE_RPC_URL" ]; then
            echo ""
            echo -e "${YELLOW}Checking balance...${NC}"
            BALANCE=$(cast balance "$ADDRESS" --rpc-url "$BASE_RPC_URL" 2>/dev/null)
            if [ -n "$BALANCE" ]; then
                BALANCE_ETH=$(echo "scale=6; $BALANCE / 1000000000000000000" | bc 2>/dev/null || echo "Error")
                echo "Balance: $BALANCE_ETH ETH"
            fi
        fi
        ;;
        
    5)
        echo ""
        echo -e "${BLUE}Remove Account${NC}"
        echo "--------------------------------"
        echo -e "${RED}⚠️  Warning: This will delete the keystore file!${NC}"
        echo "Make sure you have a backup of the private key."
        echo ""
        read -p "Enter account name to remove: " ACCOUNT_NAME
        
        if [ -z "$ACCOUNT_NAME" ]; then
            echo -e "${RED}❌ Account name cannot be empty${NC}"
            exit 1
        fi
        
        echo -e "${YELLOW}Are you sure you want to remove '$ACCOUNT_NAME'? (yes/no):${NC}"
        read CONFIRM
        
        if [ "$CONFIRM" = "yes" ]; then
            cast wallet remove "$ACCOUNT_NAME"
            if [ $? -eq 0 ]; then
                echo -e "${GREEN}✅ Account '$ACCOUNT_NAME' removed${NC}"
            else
                echo -e "${RED}❌ Failed to remove account${NC}"
            fi
        else
            echo "Removal cancelled"
        fi
        ;;
        
    6)
        echo "Exiting..."
        exit 0
        ;;
        
    *)
        echo -e "${RED}Invalid option${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${GREEN}Keystore operation complete!${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""
echo "Security Tips:"
echo "• Never share your keystore password"
echo "• Back up your keystore files from ~/.foundry/keystores/"
echo "• Use different accounts for different networks"
echo "• Consider using a hardware wallet for mainnet"
echo ""
echo "Next Steps:"
echo "1. Fund your deployment address with ETH"
echo "2. Run deployment: bun run deploy:production -- --keystore --account=<name>"
echo "3. Verify contract: bun run deploy:production:verify -- --keystore --account=<name>"