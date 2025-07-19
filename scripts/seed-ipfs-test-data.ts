#!/usr/bin/env bun

import { IPFSService, LocalIPFSProvider } from '../src/services/ipfsService';
import { QIPContent } from '../src/services/qipClient';

const testQIPs: QIPContent[] = [
  {
    qip: 249,
    title: 'Implement Dynamic Interest Rates',
    network: 'Polygon',
    status: 'Draft',
    author: 'AUTHOR1',
    implementor: 'None',
    'implementation-date': 'None',
    proposal: 'None',
    created: '2025-01-15',
    content: `## Summary

This proposal implements dynamic interest rates for QiDAO vaults to improve capital efficiency and maintain MAI peg stability.

## Motivation

Current fixed interest rates don't respond to market conditions, leading to:
- Suboptimal capital allocation
- Difficulty maintaining peg during volatile periods
- Reduced protocol revenue during high demand

## Specification

### Dynamic Rate Formula

The interest rate will be calculated using:
\`\`\`
rate = base_rate + (utilization_rate * slope_1) + max(0, (utilization_rate - kink) * slope_2)
\`\`\`

Where:
- \`base_rate\`: Minimum interest rate (2% APR)
- \`slope_1\`: Rate increase below kink point (5% APR per 100% utilization)
- \`slope_2\`: Rate increase above kink point (50% APR per 100% utilization)
- \`kink\`: Optimal utilization point (80%)

### Implementation Timeline

1. **Phase 1** (Week 1-2): Deploy rate calculation contracts
2. **Phase 2** (Week 3-4): Integrate with existing vaults
3. **Phase 3** (Week 5-6): Monitor and adjust parameters

## Security Considerations

- Rate changes will be limited to 1% per day maximum
- Emergency pause mechanism for extreme market conditions
- Multi-sig approval required for parameter changes`
  },
  {
    qip: 250,
    title: 'Add Support for New Collateral Types',
    network: 'Base',
    status: 'ReviewPending',
    author: 'AUTHOR2',
    implementor: 'None',
    'implementation-date': 'None',
    proposal: 'None',
    created: '2025-01-15',
    content: `## Summary

This proposal adds support for multiple new collateral types to expand user options and increase protocol TVL.

## Motivation

Current collateral options are limited, preventing many users from participating in the QiDAO ecosystem. Adding new collateral types will:
- Increase total value locked (TVL)
- Attract new user segments
- Improve protocol resilience through diversification

## Proposed Collateral Types

### 1. Liquid Staking Tokens
- **cbETH** (Coinbase Wrapped Staked ETH)
- **rETH** (Rocket Pool ETH)
- **stETH** (Lido Staked ETH)

### 2. Yield-Bearing Assets
- **aUSDC** (Aave USDC)
- **cDAI** (Compound DAI)

### 3. LP Tokens
- **USDC/ETH Uniswap V3**
- **MAI/USDC Curve**

## Risk Assessment

Each collateral type has been evaluated for:
- Liquidity depth
- Price feed reliability
- Smart contract risk
- Regulatory considerations

## Implementation Plan

1. Deploy new vault contracts for each collateral type
2. Integrate Chainlink price feeds
3. Set initial collateralization ratios
4. Conduct security audit
5. Launch with conservative parameters`
  },
  {
    qip: 251,
    title: 'Governance Token Staking Rewards',
    network: 'Ethereum',
    status: 'Withdrawn',
    author: 'AUTHOR3',
    implementor: 'None',
    'implementation-date': 'None',
    proposal: 'None',
    created: '2025-01-15',
    content: `## Summary

This proposal implements a staking rewards system for QI governance token holders to incentivize long-term holding and active participation.

## Motivation

Current governance participation is low due to lack of direct incentives. A staking rewards system would:
- Increase governance participation
- Reduce circulating supply
- Align long-term incentives

## Proposed Mechanism

### Staking Contract
- Users lock QI tokens for minimum 30 days
- Rewards distributed weekly in QI tokens
- Early withdrawal penalty of 10%

### Reward Distribution
- 5% of protocol revenue allocated to staking rewards
- Additional QI token emissions of 100,000 QI per month
- Rewards proportional to staked amount and duration

### Governance Benefits
- Staked tokens maintain full voting power
- Bonus voting weight for longer lock periods
- Exclusive access to governance proposals

## Implementation Timeline

1. **Month 1**: Deploy staking contracts
2. **Month 2**: Security audit and testing
3. **Month 3**: Launch with initial rewards

## Risks and Mitigations

- **Smart contract risk**: Comprehensive audit required
- **Token price impact**: Gradual rollout to minimize volatility
- **Governance centralization**: Maximum stake limits per address

---

**Note**: This proposal has been withdrawn due to regulatory concerns and will be reconsidered in the future.`
  },
  {
    qip: 100,
    title: 'Historical: Protocol Launch',
    network: 'Polygon',
    status: 'Implemented',
    author: 'Core Team',
    implementor: 'Core Team',
    'implementation-date': '2022-01-01',
    proposal: 'snapshot.org/#/qidao.eth/proposal/0x100',
    created: '2022-01-01',
    content: `## Summary

Initial launch of the QiDAO protocol on Polygon network with basic vault functionality.

## Features Implemented

- Basic collateral vaults for MATIC, ETH, and WBTC
- MAI stablecoin minting and burning
- Liquidation mechanism
- Basic governance structure

## Launch Parameters

- Minimum collateralization ratio: 150%
- Liquidation penalty: 10%
- Stability fee: 0.5% APR
- Initial debt ceiling: 1M MAI per vault type

This proposal marked the beginning of the QiDAO ecosystem.`
  },
  {
    qip: 150,
    title: 'Historical: Rejected Proposal',
    network: 'Ethereum',
    status: 'Rejected',
    author: 'Community Member',
    implementor: 'None',
    'implementation-date': 'None',
    proposal: 'snapshot.org/#/qidao.eth/proposal/0x150',
    created: '2022-04-27',
    content: `## Summary

This proposal suggested implementing a controversial fee structure that was ultimately rejected by the community.

## Proposed Changes

- Increase stability fees to 5% APR
- Add withdrawal fees of 0.5%
- Implement time-locked withdrawals

## Community Feedback

The proposal received significant pushback due to:
- High fee structure compared to competitors
- Potential negative impact on user experience
- Lack of clear benefit justification

## Vote Results

- **For**: 15%
- **Against**: 85%
- **Abstain**: 0%

This proposal demonstrates the importance of community consensus in governance decisions.`
  }
];

async function seedTestData() {
  console.log('🌱 Seeding test QIPs to local IPFS...');
  console.log('=====================================');
  
  // Check if IPFS is available
  try {
    const response = await fetch('http://localhost:5001/api/v0/version', { method: 'POST' });
    if (!response.ok) {
      throw new Error('IPFS API not available');
    }
    console.log('✅ IPFS daemon is running');
  } catch (error) {
    console.error('❌ IPFS daemon is not running. Please start it with: ipfs daemon');
    process.exit(1);
  }

  const ipfsService = new IPFSService(new LocalIPFSProvider());
  const results: Array<{ qip: number; cid: string; ipfsUrl: string; status: string }> = [];
  
  for (const qip of testQIPs) {
    try {
      console.log(`📝 Uploading QIP-${qip.qip}: ${qip.title}`);
      const { cid, ipfsUrl } = await ipfsService.uploadQIP(qip);
      
      results.push({
        qip: qip.qip,
        cid,
        ipfsUrl,
        status: qip.status
      });
      
      console.log(`   ✅ CID: ${cid}`);
      console.log(`   🔗 IPFS URL: ${ipfsUrl}`);
      
      // Verify the upload by fetching it back
      const retrieved = await ipfsService.fetchQIP(cid);
      const { frontmatter } = ipfsService.parseQIPMarkdown(retrieved);
      
      if (frontmatter.qip != qip.qip) {
        console.log(`   ⚠️  Warning: QIP number mismatch in retrieved content`);
      } else {
        console.log(`   ✅ Verified: Content retrieved successfully`);
      }
      
    } catch (error) {
      console.error(`   ❌ Failed to upload QIP-${qip.qip}:`, error);
      results.push({
        qip: qip.qip,
        cid: 'FAILED',
        ipfsUrl: 'FAILED',
        status: qip.status
      });
    }
    
    console.log(''); // Empty line for readability
  }
  
  // Summary
  console.log('📊 Seeding Summary');
  console.log('==================');
  console.log(`Total QIPs: ${testQIPs.length}`);
  console.log(`Successful: ${results.filter(r => r.cid !== 'FAILED').length}`);
  console.log(`Failed: ${results.filter(r => r.cid === 'FAILED').length}`);
  console.log('');
  
  // Output contract deployment data
  console.log('🔧 Contract Deployment Data');
  console.log('============================');
  console.log('Use this data when deploying/updating the QIP Registry contract:');
  console.log('');
  
  for (const result of results) {
    if (result.cid !== 'FAILED') {
      console.log(`QIP ${result.qip}:`);
      console.log(`  ipfsUrl: "${result.ipfsUrl}"`);
      console.log(`  status: "${result.status}"`);
      console.log('');
    }
  }
  
  // Gateway URLs for testing
  console.log('🌐 Gateway URLs for Testing');
  console.log('============================');
  for (const result of results) {
    if (result.cid !== 'FAILED') {
      console.log(`QIP-${result.qip}: http://localhost:8080/ipfs/${result.cid}`);
    }
  }
  
  console.log('');
  console.log('✅ Seeding complete! You can now use these QIPs in local development.');
  console.log('💡 Tip: These QIPs will persist as long as your IPFS daemon is running.');
}

// Run the seeder
seedTestData().catch((error) => {
  console.error('❌ Seeding failed:', error);
  process.exit(1);
});