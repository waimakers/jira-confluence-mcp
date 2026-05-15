# jira-confluence-mcp

Local stdio MCP server for Atlassian Cloud — Jira REST API v3 + Confluence v2.
Runs as a Node process on your machine. No Cloudflare. No OAuth.
Auth = Basic (email + API token). **Secrets are never stored in this repo** —
they are passed in via the MCP client's `env` block.

## Why this exists

A focused, transparent reference implementation: ~1,200 lines of TypeScript,
zero hosting infrastructure, and **56 available tools** across both products.
For safety, the server now starts in read-only mode by default and requires
explicit opt-in for write, destructive, and local attachment file operations.

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

## Tool inventory (56 available, filtered by guardrails)

By default, only read-only tools are exposed. Write tools require
`JCMCP_READ_ONLY=false`. Attachment upload/download tools additionally require
`JCMCP_ENABLE_ATTACHMENTS=true`, and destructive tools require
`JCMCP_ENABLE_DESTRUCTIVE_TOOLS=true`.

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

`ATLASSIAN_BASE_URL` must be an `https://*.atlassian.net` URL by default. For
local tests against a mock endpoint, set `JCMCP_ALLOW_NON_ATLASSIAN_BASE_URL=true`.

## Safety guardrails

| Variable | Default | Effect |
|---|---:|---|
| `JCMCP_READ_ONLY` | `true` | Exposes only read-only tools unless set to `false`. |
| `JCMCP_ALLOWED_TOOLS` | unset | Comma-separated exact tool allowlist. Applies in addition to the other guardrails. |
| `JCMCP_ENABLE_ATTACHMENTS` | `false` | Enables attachment upload/download tools. Listing attachments is still read-only. |
| `JCMCP_ENABLE_DESTRUCTIVE_TOOLS` | `false` | Enables delete/remove tools. |
| `JCMCP_ALLOWED_JIRA_PROJECTS` | unset | Comma-separated Jira project keys. Blocks scoped Jira calls outside those projects when the project can be verified. |
| `JCMCP_ALLOWED_CONFLUENCE_SPACES` | unset | Comma-separated Confluence space ids/keys. Blocks scoped Confluence calls outside those spaces when the space can be verified. |
| `JCMCP_ALLOW_JIRA_CUSTOM_FIELDS` | `false` | Allows arbitrary `customFields` on Jira create/update tools. |
| `JCMCP_ALLOWED_JIRA_CUSTOM_FIELDS` | unset | Comma-separated allowlist of Jira custom field ids, for example `customfield_10001`. |
| `JCMCP_FILE_ROOT` | unset | Required for local attachment upload/download paths. Relative paths resolve inside this directory. |
| `JCMCP_MAX_FILE_BYTES` | `10485760` | Maximum attachment upload/download size in bytes. |
| `JCMCP_ALLOW_FILE_OVERWRITE` | `false` | Allows attachment downloads to overwrite existing files under `JCMCP_FILE_ROOT`. |

Example workshop-safe write allowlist:

```toml
[mcp_servers.jira-confluence.env]
ATLASSIAN_BASE_URL = "https://your-org.atlassian.net"
ATLASSIAN_EMAIL    = "workshop-bot@example.com"
ATLASSIAN_API_TOKEN = "ATATT3..."
JCMCP_READ_ONLY = "false"
JCMCP_ALLOWED_TOOLS = "jira_myself,jira_search_issues,jira_search_issues_count,jira_get_issue,jira_list_comments,jira_create_issue,jira_add_comment,confluence_search,confluence_get_page,confluence_get_page_children"
JCMCP_ALLOWED_JIRA_PROJECTS = "WORKSHOP"
JCMCP_ALLOWED_CONFLUENCE_SPACES = "ENG"
```

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
- `npm test` — local guardrail tests; no Atlassian credentials required.
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
- **File uploads/downloads** are hidden by default. When enabled, local paths
  must stay under `JCMCP_FILE_ROOT`, downloads do not overwrite existing files
  unless `JCMCP_ALLOW_FILE_OVERWRITE=true`, and files are capped by
  `JCMCP_MAX_FILE_BYTES`.
- **Confluence attachment downloads** only accept relative `/wiki/...` paths.
  Absolute URLs are rejected so the Atlassian auth header is not sent to
  attacker-controlled hosts.
- **Permission model**: all API actions are attributed to the Atlassian user
  whose token is configured. For multi-user attribution, use Atlassian's
  official Remote MCP Server (OAuth 2.1 / 3LO).
- **Rotate the API token** at https://id.atlassian.com/manage-profile/security/api-tokens
  if it leaks.

## License

MIT
