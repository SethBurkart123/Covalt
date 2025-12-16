# MCP Server Configuration Guide

The application loads MCP server configurations from `db/mcp_servers.json`. This file contains a JSON object with server IDs as keys and their configuration as values.

## File Location
`db/mcp_servers.json` (relative to project root)

## Configuration Structure

```json
{
  "mcpServers": {
    "server-id": {
      // Configuration properties
    }
  }
}
```

## Server Types

There are 3 supported transport types, determined by the presence of specific keys:

### 1. Stdio (Command Line)
Used for local MCP servers running as subprocesses (e.g., via `npx` or `uvx`).

**Required Keys:** `command`
**Optional Keys:** `args`, `env`, `cwd`

```json
"github": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": {
    "GITHUB_TOKEN": "your-token-here"
  }
}
```

### 2. SSE (Server-Sent Events)
Used for remote MCP servers using SSE transport.

**Required Keys:** `url`, `transport: "sse"`
**Optional Keys:** `headers`

```json
"remote-sse": {
  "url": "https://api.example.com/mcp/sse",
  "transport": "sse",
  "headers": {
    "Authorization": "Bearer token"
  }
}
```

### 3. Streamable HTTP
Used for remote MCP servers using standard HTTP streaming (default if `transport` is missing).

**Required Keys:** `url`
**Optional Keys:** `transport: "streamable-http"` (default)

```json
"remote-http": {
  "url": "https://api.example.com/mcp",
  "transport": "streamable-http"
}
```

## Common Options (All Types)

These options apply to all server types:

| Option | Type | Description |
|--------|------|-------------|
| `requiresConfirmation` | boolean | Default: `true`. Whether tools from this server require user approval before execution. |
| `toolOverrides` | object | specific configuration overrides for individual tools. |

### Tool Overrides

You can customize behavior for specific tools within a server:

```json
"toolOverrides": {
  "tool_name": {
    "renderer": "markdown",       // Optional: "markdown" to render output as markdown
    "editable_args": ["arg1"],    // Optional: List of arguments user can edit in UI
    "requires_confirmation": false // Optional: Override server-level confirmation setting
  }
}
```

## Full Example

```json
{
  "mcpServers": {
    "perplexity": {
      "command": "npx",
      "args": ["-y", "perplexity-mcp"],
      "env": {
        "PERPLEXITY_API_KEY": "..."
      },
      "requiresConfirmation": true
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/files"],
      "toolOverrides": {
        "read_file": {
          "renderer": "markdown",
          "requires_confirmation": false
        }
      }
    }
  }
}
```
