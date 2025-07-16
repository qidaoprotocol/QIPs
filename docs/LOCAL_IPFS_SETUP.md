# Local IPFS Setup Guide

This guide explains how to set up and use a local IPFS node for QIPs development.

## Overview

The QIPs platform supports two IPFS storage modes:
- **Production**: Uses Pinata as a pinning service
- **Local Development**: Uses a local IPFS daemon with fallback to in-memory storage

## Installation

### macOS (Homebrew)
```bash
brew install ipfs
```

### Linux/macOS (Official Installer)
Visit [https://docs.ipfs.tech/install/](https://docs.ipfs.tech/install/) for platform-specific instructions.

### Using Go
```bash
go install github.com/ipfs/kubo/cmd/ipfs@latest
```

## Initial Setup

1. **Initialize IPFS** (first time only):
   ```bash
   ipfs init
   ```

2. **Configure CORS** for browser access:
   ```bash
   ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["http://localhost:8000", "http://localhost:8545", "*"]'
   ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["PUT", "POST", "GET"]'
   ipfs config --json API.HTTPHeaders.Access-Control-Allow-Headers '["Authorization"]'
   ipfs config --json API.HTTPHeaders.Access-Control-Expose-Headers '["Location"]'
   ipfs config --json API.HTTPHeaders.Access-Control-Allow-Credentials '["true"]'
   ```

## Running IPFS

### Automatic (Recommended)
The `start-local-dev.sh` script automatically starts IPFS when `GATSBY_USE_LOCAL_IPFS=true`:

```bash
# IPFS will start automatically
bun run start:local
```

### Manual
Start the IPFS daemon manually:

```bash
# Foreground
ipfs daemon

# Background
ipfs daemon &
```

## Configuration

### Environment Variables

Set these in `.env` or `.env.local`:

```bash
# Enable local IPFS mode
GATSBY_USE_LOCAL_IPFS=true

# IPFS API endpoint (default: http://localhost:5001)
GATSBY_LOCAL_IPFS_API=http://localhost:5001

# IPFS Gateway endpoint (default: http://localhost:8080)
GATSBY_LOCAL_IPFS_GATEWAY=http://localhost:8080
```

### Switching Between Modes

**Local IPFS Mode**:
```bash
GATSBY_USE_LOCAL_IPFS=true
```

**Pinata Mode** (production):
```bash
GATSBY_USE_LOCAL_IPFS=false
GATSBY_PINATA_JWT=your_pinata_jwt_token
GATSBY_PINATA_GATEWAY=https://gateway.pinata.cloud
```

## How It Works

1. **With IPFS Running**: 
   - Proposals are stored in your local IPFS node
   - Content is accessible via the local gateway
   - Data persists between sessions

2. **Without IPFS (Fallback)**:
   - Falls back to in-memory storage
   - Returns mock CIDs for development
   - Data is lost on page refresh
   - Console warnings indicate fallback mode

## Verifying Your Setup

Run the check script:
```bash
./scripts/check-ipfs.sh
```

Expected output:
```
✅ IPFS is installed
✅ IPFS is initialized
✅ IPFS daemon is running
✅ IPFS API is accessible at http://localhost:5001
✅ IPFS Gateway is accessible at http://localhost:8080
```

## Testing IPFS Storage

1. Start the development environment:
   ```bash
   bun run start:local
   ```

2. Navigate to http://localhost:8000/create-proposal

3. Create a test proposal

4. Check the console for storage confirmation:
   - Success: "Uploaded to IPFS with CID: Qm..."
   - Fallback: "IPFS daemon not running, using in-memory storage"

5. Verify content retrieval:
   ```bash
   # Replace with your actual CID
   curl http://localhost:8080/ipfs/QmXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```

## Troubleshooting

### IPFS Daemon Won't Start
- Check if another process is using port 5001: `lsof -i :5001`
- Kill existing IPFS processes: `pkill -f ipfs`
- Reinitialize if corrupted: `rm -rf ~/.ipfs && ipfs init`

### CORS Errors
- Ensure CORS is configured (see Initial Setup)
- Restart IPFS daemon after configuration changes

### Connection Refused
- Verify IPFS is running: `ps aux | grep ipfs`
- Check API availability: `curl http://localhost:5001/api/v0/version`
- Ensure firewall isn't blocking ports 5001 and 8080

### Content Not Found
- In local mode, content is only available while your IPFS node is running
- For persistence across team members, use Pinata in production

## Best Practices

1. **Development**: Use local IPFS for faster iteration
2. **Testing**: Test with both local IPFS and Pinata modes
3. **Production**: Always use Pinata for reliable persistence
4. **CI/CD**: Configure GitHub Actions with Pinata credentials

## Additional Resources

- [IPFS Documentation](https://docs.ipfs.tech/)
- [IPFS HTTP API Reference](https://docs.ipfs.tech/reference/http/api/)
- [Pinata Documentation](https://docs.pinata.cloud/)