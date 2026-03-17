# SpiceSentry MCP Server

A **Model Context Protocol** server that exposes SpiceSentry spice-inventory operations as AI-callable tools, backed by **MongoDB Atlas Data API** (Stitch).

## Tools

| Tool | Description |
|---|---|
| `add-entry` | Add a new spice purchase (shop, type, qty, price) |
| `get-entries` | Query entries with optional shop/type filters |
| `get-stats` | Aggregated stats (avg price, total qty) per spice for a shop |
| `dispatch-load` | Mark the current load for a shop as dispatched |
| `list-shops` | List available shops and spice types |

## Resources

| URI | Description |
|---|---|
| `spicesentry://catalogue` | Static JSON of all shops & spices |

## Configuration

The server is configured in `.vscode/mcp.json` and is automatically discovered by VS Code / GitHub Copilot.

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `STITCH_API_KEY` | ✅ | — | MongoDB Atlas Data API key |
| `ATLAS_BASE_URL` | — | `https://data.mongodb-api.com/app/data-api/endpoint/data/v1` | Atlas Data API base URL |
| `ATLAS_CLUSTER` | — | `Cluster0` | Atlas cluster name |
| `ATLAS_DATABASE` | — | `spicesentry` | Database name |

## Quick Start

```bash
cd mcp-server
npm install
```

The server uses **stdio** transport – VS Code launches it automatically when Copilot needs it.

### Manual test

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}' | node index.js
```

## Atlas Setup

1. Go to [MongoDB Atlas](https://cloud.mongodb.com/) and create a cluster (or use an existing one).
2. Enable the **Data API** under *App Services → Data API*.
3. Create an API key and paste it as `STITCH_API_KEY` in `.vscode/mcp.json`.
4. Create a database called `spicesentry` with collections `entries` and `dispatches`.
