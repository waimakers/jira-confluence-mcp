# jira-confluence-mcp

Local stdio MCP server for Atlassian Cloud — Jira REST API v3 + Confluence v2.
Runs as a Node process on your machine. No Cloudflare. No OAuth.
Auth = Basic (email + API token). **Secrets are never stored in this repo** —
they are passed in via the MCP client's `env` block.

## Why this exists

A focused, transparent reference implementation: ~1,200 lines of TypeScript,
zero hosting infrastructure, **56 tools** covering full read/write across both
products including files, links, comments, sprints, worklogs, attachments,
labels, page hierarchy, and version history.

If you need a production-grade option with per-user OAuth, use Atlassian's
[official Remote MCP Server](https://github.com/atlassian/atlassian-mcp-server).
This repo exists to be readable, forkable, and customizable.

## Setup

```bash
git clone https://github.com/waimakers/jira-confluence-mcp.git
cd jira-confluence-mcp
npm install
npm run build
```

## Generate an API token

1. Visit https://id.atlassian.com/manage-profile/security/api-tokens
2. Create token, copy it. The same token works for both Jira and Confluence.

## Tool inventory (56)

### Jira — meta / discovery (6)
`jira_myself`, `jira_list_projects`, `jira_list_issue_types`, `jira_list_priorities`, `jira_list_statuses`, `jira_search_users`

### Jira — issues (5)
`jira_search_issues` (JQL, cursor-paginated), `jira_search_issues_count`, `jira_get_issue`, `jira_create_issue`, `jira_update_issue`, `jira_delete_issue`

### Jira — transitions (2)
`jira_get_transitions`, `jira_transition_issue`

### Jira — comments (4)
`jira_list_comments`, `jira_add_comment`, `jira_update_comment`, `jira_delete_comment`

### Jira — attachments (4)
`jira_list_attachments`, `jira_upload_attachment` (from local file path), `jira_download_attachment` (to local file path or base64), `jira_delete_attachment`

### Jira — links (3)
`jira_list_link_types`, `jira_link_issues`, `jira_delete_issue_link`

### Jira — work logs (2)
`jira_list_worklogs`, `jira_add_worklog`

### Jira — watchers (3)
`jira_list_watchers`, `jira_add_watcher`, `jira_remove_watcher`

### Jira — versions (2)
`jira_list_versions`, `jira_create_version`

### Jira — agile / boards / sprints (5)
`jira_list_boards`, `jira_get_board_backlog`, `jira_list_sprints`, `jira_get_sprint_issues`, `jira_move_issues_to_sprint`

### Confluence — spaces (3)
`confluence_list_spaces`, `confluence_get_space`, `confluence_list_space_pages`

### Confluence — search (1)
`confluence_search` (CQL)

### Confluence — pages: read (4)
`confluence_get_page`, `confluence_get_page_children`, `confluence_get_page_ancestors`, `confluence_list_page_versions`

### Confluence — pages: write (3)
`confluence_create_page`, `confluence_update_page`, `confluence_delete_page`

### Confluence — comments (3)
`confluence_list_footer_comments`, `confluence_list_inline_comments`, `confluence_add_footer_comment`

### Confluence — labels (2)
`confluence_get_page_labels`, `confluence_add_page_labels`

### Confluence — attachments (3)
`confluence_list_page_attachments`, `confluence_upload_attachment` (from local file path), `confluence_download_attachment` (to local file path or base64)

## Required env vars

The server reads these three values from `process.env`. Pass them via your
MCP client config — never commit them to a `.env` file.

| Variable | Example |
|---|---|
| `ATLASSIAN_BASE_URL` | `https://your-org.atlassian.net` |
| `ATLASSIAN_EMAIL` | your Atlassian login email |
| `ATLASSIAN_API_TOKEN` | token from id.atlassian.com (starts with `ATATT3...`) |

## Register with Claude Code

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

Restart Claude Code after editing.

## Register with Codex CLI (`~/.codex/config.toml`)

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

Test helpers in the repo:
- `dist/smoke.js` — direct API check (auth + projects + spaces).
- `test-stdio.mjs` — JSON-RPC `tools/list` + one `tools/call`.
- `test-expanded.mjs` — exercises 6 representative tools end-to-end.

## Notes & gotchas

- **JQL bounded queries**: Atlassian's modern `/search/jql` endpoint rejects
  unbounded JQL (e.g. `ORDER BY updated DESC` alone). Always include a project
  or other filter. The endpoint also uses cursor pagination via `nextPageToken`,
  not `startAt`.
- **Search totals**: the new endpoint no longer returns `total`. Call
  `jira_search_issues_count` for the (approximate) count.
- **ADF**: Jira v3 body fields use Atlassian Document Format. The
  `descriptionText` / `commentText` arguments take plain text and are converted
  to ADF for you.
- **Confluence body format**: pages use Confluence "storage" format (HTML-like).
- **File uploads** read from a local file path on the machine running the MCP
  process; **downloads** write to a local file path (or return base64 for small
  files).
- **Permission model**: all API actions are attributed to the Atlassian user
  whose token is configured. For multi-user attribution, use Atlassian's
  official Remote MCP Server (OAuth 2.1 / 3LO).
- **Rotate the API token** at https://id.atlassian.com/manage-profile/security/api-tokens
  if it leaks.

## License

MIT
