#!/bin/bash

# Upload test QIP content to local IPFS
# This script creates and uploads test QIP content for LocalQIPTest.s.sol

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Uploading test QIP content to IPFS...${NC}"

# Check if IPFS is running
if ! curl -s http://localhost:5001/api/v0/version > /dev/null; then
    echo -e "${RED}❌ IPFS daemon is not running. Please start it with 'ipfs daemon'${NC}"
    exit 1
fi

# Create test QIP content
echo -e "${YELLOW}Creating test QIP content...${NC}"

# QIP-100: Historical Protocol Launch
cat > /tmp/qip-100.md << 'EOF'
---
qip: 100
title: Historical Protocol Launch
network: Polygon
status: Implemented
author: Core Team
implementor: Core Team
implementation-date: 2022-01-08
proposal: snapshot.org/#/qidao.eth/proposal/0x100
created: 2022-01-01
---

# Historical: Protocol Launch

This QIP represents the historical launch of the QiDAO protocol on Polygon.

## Summary

The QiDAO protocol was successfully launched on Polygon network, providing users with:
- Decentralized stablecoin minting
- Collateralized debt positions
- Governance token distribution

## Implementation

The protocol was deployed with the following initial parameters:
- Minimum collateral ratio: 150%
- Stability fee: 0.5%
- Liquidation penalty: 10%

This marks the beginning of the QiDAO ecosystem.
EOF

# QIP-150: Historical Rejected Proposal
cat > /tmp/qip-150.md << 'EOF'
---
qip: 150
title: Historical Rejected Proposal
network: Ethereum
status: Rejected
author: Community Member
implementor: None
implementation-date: None
proposal: snapshot.org/#/qidao.eth/proposal/0x150
created: 2022-04-27
---

# Historical: Rejected Proposal

This proposal was rejected by the community vote.

## Summary

This proposal suggested implementing a 50% reduction in stability fees across all vaults.

## Rationale

The proposer argued that lower fees would increase adoption.

## Outcome

The community voted against this proposal due to concerns about:
- Protocol sustainability
- Impact on MAI peg stability
- Insufficient data to support the change

Vote results: 30% For, 70% Against
EOF

# QIP-200: Historical Superseded Update
cat > /tmp/qip-200.md << 'EOF'
---
qip: 200
title: Historical Superseded Protocol Update
network: Base
status: Superseded
author: Protocol Team
implementor: Core Team
implementation-date: 2022-11-15
proposal: snapshot.org/#/qidao.eth/proposal/0x200
created: 2022-11-01
---

# Historical: Superseded Protocol Update

This QIP was superseded by a later proposal with improved parameters.

## Summary

This proposal implemented initial risk parameters for Base deployment.

## Original Parameters

- Collateral ratio: 130%
- Stability fee: 1%
- Debt ceiling: 1M MAI

## Supersession

This QIP was superseded by QIP-225 which adjusted parameters based on market conditions.
EOF

# Upload to IPFS
echo -e "${YELLOW}Uploading QIP-100 to IPFS...${NC}"
QIP_100_CID=$(curl -s -X POST -F file=@/tmp/qip-100.md "http://localhost:5001/api/v0/add?pin=true" | jq -r '.Hash')
echo -e "${GREEN}✅ QIP-100 uploaded: ipfs://${QIP_100_CID}${NC}"

echo -e "${YELLOW}Uploading QIP-150 to IPFS...${NC}"
QIP_150_CID=$(curl -s -X POST -F file=@/tmp/qip-150.md "http://localhost:5001/api/v0/add?pin=true" | jq -r '.Hash')
echo -e "${GREEN}✅ QIP-150 uploaded: ipfs://${QIP_150_CID}${NC}"

echo -e "${YELLOW}Uploading QIP-200 to IPFS...${NC}"
QIP_200_CID=$(curl -s -X POST -F file=@/tmp/qip-200.md "http://localhost:5001/api/v0/add?pin=true" | jq -r '.Hash')
echo -e "${GREEN}✅ QIP-200 uploaded: ipfs://${QIP_200_CID}${NC}"

# Create test QIPs for 249-251
cat > /tmp/qip-249.md << 'EOF'
---
qip: 249
title: Implement Dynamic Interest Rates
network: Polygon
status: Draft
author: Test Author 1
implementor: None
implementation-date: None
proposal: None
created: 2024-01-15
---

# Implement Dynamic Interest Rates

## Summary

This proposal introduces a dynamic interest rate model that adjusts based on utilization rates.

## Motivation

Current fixed interest rates don't respond to market conditions, leading to inefficient capital allocation.

## Specification

The new model will:
1. Base rate: 0.5%
2. Utilization multiplier: 0-80% utilization = +0-4% additional
3. High utilization penalty: 80-100% = +4-20% additional

## Benefits

- Better capital efficiency
- Market-responsive rates
- Improved protocol sustainability
EOF

cat > /tmp/qip-250.md << 'EOF'
---
qip: 250
title: Add Support for New Collateral Types
network: Base
status: Draft
author: Test Author 2
implementor: None
implementation-date: None
proposal: None
created: 2024-01-16
---

# Add Support for New Collateral Types

## Summary

Enable additional collateral types on Base network including wstETH, rETH, and cbETH.

## Rationale

Expanding collateral options will:
- Increase protocol TVL
- Provide more options for users
- Diversify risk

## Implementation

Each new collateral type will have:
- Individual risk parameters
- Oracle price feeds
- Liquidation mechanisms
EOF

cat > /tmp/qip-251.md << 'EOF'
---
qip: 251
title: Governance Token Staking Rewards
network: Ethereum
status: Draft
author: Test Author 3
implementor: None
implementation-date: None
proposal: None
created: 2024-01-17
---

# Governance Token Staking Rewards

## Summary

Implement a staking rewards program for QI token holders.

## Details

- 30-day minimum lock period
- Rewards from protocol fees
- Voting power multiplier for stakers

## Expected Outcomes

- Increased governance participation
- Token value accrual
- Long-term alignment of stakeholders
EOF

# Upload test QIPs
echo -e "${YELLOW}Uploading QIP-249 to IPFS...${NC}"
QIP_249_CID=$(curl -s -X POST -F file=@/tmp/qip-249.md "http://localhost:5001/api/v0/add?pin=true" | jq -r '.Hash')
echo -e "${GREEN}✅ QIP-249 uploaded: ipfs://${QIP_249_CID}${NC}"

echo -e "${YELLOW}Uploading QIP-250 to IPFS...${NC}"
QIP_250_CID=$(curl -s -X POST -F file=@/tmp/qip-250.md "http://localhost:5001/api/v0/add?pin=true" | jq -r '.Hash')
echo -e "${GREEN}✅ QIP-250 uploaded: ipfs://${QIP_250_CID}${NC}"

echo -e "${YELLOW}Uploading QIP-251 to IPFS...${NC}"
QIP_251_CID=$(curl -s -X POST -F file=@/tmp/qip-251.md "http://localhost:5001/api/v0/add?pin=true" | jq -r '.Hash')
echo -e "${GREEN}✅ QIP-251 uploaded: ipfs://${QIP_251_CID}${NC}"

# Output the CIDs for use in LocalQIPTest.s.sol
echo -e "\n${GREEN}=== Test QIP IPFS CIDs ===${NC}"
echo "QIP-100: ipfs://${QIP_100_CID}"
echo "QIP-150: ipfs://${QIP_150_CID}"
echo "QIP-200: ipfs://${QIP_200_CID}"
echo "QIP-249: ipfs://${QIP_249_CID}"
echo "QIP-250: ipfs://${QIP_250_CID}"
echo "QIP-251: ipfs://${QIP_251_CID}"

# Save CIDs to a file for the Solidity script
cat > /tmp/test-qip-cids.txt << EOF
QIP_100_CID=${QIP_100_CID}
QIP_150_CID=${QIP_150_CID}
QIP_200_CID=${QIP_200_CID}
QIP_249_CID=${QIP_249_CID}
QIP_250_CID=${QIP_250_CID}
QIP_251_CID=${QIP_251_CID}
EOF

echo -e "\n${GREEN}CIDs saved to /tmp/test-qip-cids.txt${NC}"

# Clean up temporary files
rm -f /tmp/qip-*.md

echo -e "\n${GREEN}✅ Test QIP content uploaded successfully!${NC}"