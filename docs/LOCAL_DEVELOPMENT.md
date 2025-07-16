# Local Development Guide

This guide explains how to run the QIPs platform locally with a blockchain environment for testing.

## Quick Start

```bash
# Start everything with one command
bun run dev:local
```

This will:
1. Start Anvil (local Ethereum node forked from Base)
2. Deploy the QIP Registry smart contract
3. Set up test data (QIP-249, QIP-250, QIP-251)
4. Start the Gatsby development server
5. Open http://localhost:8000 in your browser

## Manual Setup

If you prefer to run components separately:

```bash
# Terminal 1: Start Anvil
bun run dev:anvil

# Terminal 2: Deploy contracts (after Anvil is running)
bun run dev:deploy-only

# Terminal 3: Start Gatsby
bun run develop

# Optional: Run test client
bun run dev:test-client
```

## Test Accounts

The following accounts are available with 10,000 ETH each:

| Role | Address | Private Key |
|------|---------|-------------|
| Governance | 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 | 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 |
| Editor | 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 | 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d |
| Author1 | 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC | 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a |
| Author2 | 0x90F79bf6EB2c4f870365E785982E1f101E93b906 | 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6 |

## Connecting Your Wallet

1. Open your wallet (MetaMask, Rainbow, etc.)
2. Add a custom network:
   - Network Name: Local Base Fork
   - RPC URL: http://localhost:8545
   - Chain ID: 8453
   - Currency Symbol: ETH
3. Import one of the test accounts using its private key

## Testing Features

### Create a New QIP
1. Connect your wallet with a test account
2. Go to http://localhost:8000/create-proposal
3. Fill in the proposal details
4. Submit (gas is free on local network)

### View Existing QIPs
- QIP-249: Dynamic Interest Rates (Draft)
- QIP-250: Multi-Collateral Support (Draft)
- QIP-251: Staking Rewards (Draft)

### Test Permissions
- Only Editor account can change QIP status
- Only Authors can update their own QIPs
- Anyone can create new QIPs

## Environment Variables

The local environment uses `.env.local` with:
- `GATSBY_LOCAL_MODE=true` - Shows local mode banner
- `GATSBY_USE_LOCAL_FILES=false` - Uses only blockchain data
- `GATSBY_BASE_RPC_URL=http://localhost:8545` - Local RPC endpoint

## Troubleshooting

### Port Already in Use
```bash
# Kill existing processes
pkill -f anvil
pkill -f gatsby
```

### Contract Not Deployed
```bash
# Manually deploy
forge script script/DeployOnly.s.sol:DeployOnly --rpc-url http://localhost:8545 --broadcast
```

### Gatsby Not Loading Data
1. Check `.env` has correct contract address
2. Clear Gatsby cache: `bun run clean`
3. Restart: `bun run dev:local`

## Advanced Usage

### Custom Test Data
Edit `script/LocalQIPTest.s.sol` to modify initial QIPs.

### Different Fork
Edit `scripts/start-local-dev.sh` to fork a different network.

### Reset Everything
Just restart `bun run dev:local` - all data is ephemeral.