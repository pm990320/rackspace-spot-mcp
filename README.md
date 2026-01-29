# Rackspace Spot MCP Server

[![npm version](https://badge.fury.io/js/rackspace-spot-mcp.svg)](https://www.npmjs.com/package/rackspace-spot-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Model Context Protocol (MCP) server for [Rackspace Spot](https://spot.rackspace.com) - a managed Kubernetes platform with auction-based pricing.

## Features

This MCP server provides tools for managing your Rackspace Spot infrastructure:

- **Regions & Server Classes**: List available regions and machine types
- **Organizations**: List organizations and their namespaces
- **Cloudspaces**: Create, list, get, and delete Kubernetes clusters
- **Spot Node Pools**: Manage auction-based worker nodes with bid pricing
- **On-Demand Node Pools**: Manage fixed-price worker nodes
- **Kubeconfig**: Generate kubeconfig files for kubectl access
- **Pricing**: Get current market prices and historical pricing data
- **Read-Only Mode**: Optionally hide create/delete operations for safety

## Prerequisites

- Node.js 18+
- A Rackspace Spot account
- A refresh token from the Rackspace Spot console

## Installation

### Using npx (recommended)

No installation required - run directly with npx:

```bash
npx rackspace-spot-mcp
```

### Global Installation

```bash
npm install -g rackspace-spot-mcp
rackspace-spot-mcp
```

### From Source

```bash
# Clone the repository
git clone https://github.com/pm990320/rackspace-spot-mcp.git
cd rackspace-spot-mcp

# Install dependencies
npm install

# Build the project
npm run build

# Run the server
RACKSPACE_SPOT_REFRESH_TOKEN=your-token node dist/index.js
```

When using a local build with Claude Desktop or Claude Code, point to the built `dist/index.js`:

```json
{
  "mcpServers": {
    "rackspace-spot": {
      "command": "node",
      "args": ["/path/to/rackspace-spot-mcp/dist/index.js"],
      "env": {
        "RACKSPACE_SPOT_REFRESH_TOKEN": "your-refresh-token-here"
      }
    }
  }
}
```

## Getting Your Refresh Token

1. Log in to the [Rackspace Spot Console](https://spot.rackspace.com)
2. Navigate to **API Access > Terraform** in the sidebar
3. Click **Get New Token** to generate a refresh token
4. Copy the token for use with this MCP server

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RACKSPACE_SPOT_REFRESH_TOKEN` | Yes | Your Rackspace Spot API refresh token |
| `RACKSPACE_SPOT_READ_ONLY` | No | Set to `true` or `1` to hide create/delete operations |

### Read-Only Mode

For safety, you can run the server in read-only mode which hides all create and delete tools:

```bash
RACKSPACE_SPOT_READ_ONLY=true npx rackspace-spot-mcp
```

This is recommended for exploratory use or when you want to prevent accidental modifications.

## Usage with Claude Desktop

Add the server to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "rackspace-spot": {
      "command": "npx",
      "args": ["-y", "rackspace-spot-mcp"],
      "env": {
        "RACKSPACE_SPOT_REFRESH_TOKEN": "your-refresh-token-here"
      }
    }
  }
}
```

### Read-Only Configuration

```json
{
  "mcpServers": {
    "rackspace-spot": {
      "command": "npx",
      "args": ["-y", "rackspace-spot-mcp"],
      "env": {
        "RACKSPACE_SPOT_REFRESH_TOKEN": "your-refresh-token-here",
        "RACKSPACE_SPOT_READ_ONLY": "true"
      }
    }
  }
}
```

## Usage with Claude Code

Add to your `~/.claude.json` (global) or project's `.claude.json`:

```json
{
  "mcpServers": {
    "rackspace-spot": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "rackspace-spot-mcp"],
      "env": {
        "RACKSPACE_SPOT_REFRESH_TOKEN": "your-refresh-token-here",
        "RACKSPACE_SPOT_READ_ONLY": "true"
      }
    }
  }
}
```

## Available Tools

### Infrastructure Discovery

| Tool | Description |
|------|-------------|
| `list_regions` | List all available Rackspace Spot regions |
| `get_region` | Get details about a specific region |
| `list_server_classes` | List available machine types with specs |
| `get_server_class` | Get details about a specific server class |
| `list_organizations` | List organizations and their namespaces |

### Cloudspace Management

| Tool | Description |
|------|-------------|
| `list_cloudspaces` | List all Kubernetes clusters in a namespace |
| `get_cloudspace` | Get details about a specific cluster |
| `create_cloudspace` | Create a new Kubernetes cluster |
| `delete_cloudspace` | Delete a cluster (irreversible) |

### Spot Node Pools (Auction Pricing)

| Tool | Description |
|------|-------------|
| `list_spot_node_pools` | List spot node pools in a cloudspace |
| `get_spot_node_pool` | Get details about a spot node pool |
| `create_spot_node_pool` | Create a spot node pool with bid price |
| `delete_spot_node_pool` | Delete a spot node pool |

### On-Demand Node Pools (Fixed Pricing)

| Tool | Description |
|------|-------------|
| `list_ondemand_node_pools` | List on-demand node pools |
| `get_ondemand_node_pool` | Get details about an on-demand pool |
| `create_ondemand_node_pool` | Create an on-demand node pool |
| `delete_ondemand_node_pool` | Delete an on-demand node pool |

### Utilities

| Tool | Description |
|------|-------------|
| `get_kubeconfig` | Generate kubeconfig for kubectl access |
| `get_market_pricing` | Get current market prices and capacity |
| `get_price_history` | Get historical pricing for a server class |
| `get_percentile_pricing` | Get price distribution data |

## Example Interactions

### Create a new cloudspace

```
"Create a new Kubernetes cluster called 'my-app' in the us-central-dfw-1 region"
```

### Add spot nodes with bidding

```
"Add a spot node pool with 3 medium-sized servers, bidding $0.05 per hour"
```

### Check pricing before bidding

```
"What are the current market prices for m3.medium servers in DFW?"
```

### Get cluster access

```
"Generate a kubeconfig for my production cloudspace"
```

## Development

```bash
# Watch mode for development
npm run dev

# Run type checking
npm run typecheck

# Run unit tests
npm test

# Run integration tests (requires RACKSPACE_SPOT_REFRESH_TOKEN)
RACKSPACE_SPOT_REFRESH_TOKEN=your-token npm run test:integration

# Regenerate API types from OpenAPI spec
npm run generate-client
```

### Testing

The project includes comprehensive tests:

- **Unit Tests**: Test the SpotClient methods with mocked responses
- **Integration Tests**: Test the full MCP server including tool discovery and read-only mode
- **Live API Tests**: Optionally test against the real Rackspace Spot API (requires token)

## Architecture

This MCP server uses a hybrid approach:

1. **Generated Types**: TypeScript types are auto-generated from the official Rackspace Spot OpenAPI 3.0 specification using `openapi-typescript`
2. **Type-Safe Client**: The `openapi-fetch` library provides a type-safe HTTP client
3. **MCP Server**: Built with `@modelcontextprotocol/sdk` for LLM integration

## License

MIT

## Disclaimer

This is a third-party, community-maintained MCP server and is not officially published or supported by Rackspace Technology.
