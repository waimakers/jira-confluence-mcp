# jira-confluence-mcp

Local stdio MCP server for Atlassian Cloud — Jira REST API v3 + Confluence v2.
Runs as a Node process on your machine. No Cloudflare. No OAuth.
Auth = Basic (email + API token). **Secrets are never stored in this repo** —
they are passed in via the MCP client's `env` block.

## Why this exists

A minimal, transparent reference implementation: ~600 lines of TypeScript,
zero hosting infrastructure, focused tool surface (15 tools across both
products) instead of the 600+ ops the full Atlassian OpenAPI specs expose.

## Setup

```bash
git clone https://github.com/waimakers/jira-confluence-mcp.git
cd jira-confluence-mcp
npm install
npm run build
```

## Generate an API token

1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click "Create API token", give it a label, copy the token.
3. The same token works for both Jira and Confluence on the same Atlassian account.

## Tools (15)

**Jira (10):** `jira_myself`, `jira_list_projects`, `jira_search_issues` (JQL),
`jira_get_issue`, `jira_create_issue`, `jira_update_issue`, `jira_add_comment`,
`jira_get_transitions`, `jira_transition_issue`, `jira_search_users`.

**Confluence (5):** `confluence_list_spaces`, `confluence_search` (CQL),
`confluence_get_page`, `confluence_create_page`, `confluence_update_page`.

## Required env vars

The server reads these three values from `process.env`. Pass them via your
MCP client config — never commit them to a `.env` file.

| Variable | Example |
|---|---|
| `ATLASSIAN_BASE_URL` | `https://your-org.atlassian.net` |
| `ATLASSIAN_EMAIL` | your Atlassian login email |
| `ATLASSIAN_API_TOKEN` | token from id.atlassian.com (starts with `ATATT3...`) |

## Register with Claude Code

Add to your Claude Code MCP config (`~/.claude.json` on Windows: `C:\Users\<you>\.claude.json`):

```json
{
  "mcpServers": {
    "jira-confluence": {
      "command": "node",
      "args": ["/absolute/path/to/jira-confluence-mcp/dist/index.js"],
      "env": {
        "ATLASSIAN_BASE_URL": "https://your-org.atlassian.net",
        "ATLASSIAN_EMAIL": "you@example.com",
        "ATLASSIAN_API_TOKEN": "ATATT3..."
      }
    }
  }
}
```

After editing, restart Claude Code so it re-spawns the MCP process.

## Register with Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.jira-confluence]
command = "node"
args = ['/absolute/path/to/jira-confluence-mcp/dist/index.js']
enabled = true

[mcp_servers.jira-confluence.env]
ATLASSIAN_BASE_URL = "https://your-org.atlassian.net"
ATLASSIAN_EMAIL    = "you@example.com"
ATLASSIAN_API_TOKEN = "ATATT3..."
```

## Local testing (without an MCP client)

Pass env vars inline on the command line — never write a `.env` file:

```bash
# PowerShell
$env:ATLASSIAN_BASE_URL="https://your-org.atlassian.net"; `
$env:ATLASSIAN_EMAIL="you@example.com"; `
$env:ATLASSIAN_API_TOKEN="ATATT3..."; `
node dist/smoke.js

# Git Bash / Linux / macOS
ATLASSIAN_BASE_URL=https://your-org.atlassian.net \
ATLASSIAN_EMAIL=you@example.com \
ATLASSIAN_API_TOKEN=ATATT3... \
  node dist/smoke.js
```

Two helpers exist:
- `dist/smoke.js` — direct API calls (auth check + list projects + list spaces).
- `test-stdio.mjs` — spawns the MCP server and exercises the JSON-RPC interface.

## Notes

- Jira v3 body fields use ADF (Atlassian Document Format). The `descriptionText`
  and `commentText` arguments take plain text and are converted to ADF for you.
- Confluence v2 page bodies use the "storage" format (HTML-like). Pass HTML strings.
- All API actions are attributed to the Atlassian user whose token is configured.
  For multi-user attribution, you would need Atlassian OAuth 2.0 (3LO) — out of
  scope for this experimental MCP.
- Rotate the API token at https://id.atlassian.com/manage-profile/security/api-tokens
  if it leaks.

## License

MIT
