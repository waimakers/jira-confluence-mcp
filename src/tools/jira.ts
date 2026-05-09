import type { AtlassianClient } from "../atlassian-client.js";
import type { ToolDef } from "./types.js";

// Plain text → ADF (Atlassian Document Format) used by Jira v3 body fields.
function textToAdf(text: string) {
  const paragraphs = text.split(/\n\n+/).map((p) => ({
    type: "paragraph",
    content: p ? [{ type: "text", text: p }] : [],
  }));
  return { type: "doc", version: 1, content: paragraphs };
}

const enc = encodeURIComponent;

export function buildJiraTools(client: AtlassianClient): ToolDef[] {
  return [
    // ─── meta / discovery ─────────────────────────────────────────────
    {
      name: "jira_myself",
      description: "Return the authenticated Atlassian account (sanity-check auth).",
      inputSchema: { type: "object", properties: {} },
      handler: async () => client.get("/rest/api/3/myself"),
    },
    {
      name: "jira_list_projects",
      description: "List Jira projects (paginated). Optional: query (search), maxResults, startAt.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Filter projects by name or key" },
          maxResults: { type: "number", description: "Max results (default 50)" },
          startAt: { type: "number", description: "Pagination offset (default 0)" },
        },
      },
      handler: async (a) =>
        client.get("/rest/api/3/project/search", {
          query: a.query, maxResults: a.maxResults ?? 50, startAt: a.startAt ?? 0,
        }),
    },
    {
      name: "jira_list_issue_types",
      description: "List issue types available for a project (use issueTypeName when creating issues).",
      inputSchema: {
        type: "object",
        properties: { projectKeyOrId: { type: "string" } },
        required: ["projectKeyOrId"],
      },
      handler: async (a) =>
        client.get("/rest/api/3/issuetype/project", { projectId: a.projectKeyOrId }),
    },
    {
      name: "jira_list_priorities",
      description: "List all available priorities in the Jira instance.",
      inputSchema: { type: "object", properties: {} },
      handler: async () => client.get("/rest/api/3/priority"),
    },
    {
      name: "jira_list_statuses",
      description: "List all statuses available across the instance, or for one project if projectKeyOrId is set.",
      inputSchema: {
        type: "object",
        properties: { projectKeyOrId: { type: "string" } },
      },
      handler: async (a) =>
        a.projectKeyOrId
          ? client.get(`/rest/api/3/project/${enc(a.projectKeyOrId)}/statuses`)
          : client.get("/rest/api/3/status"),
    },
    {
      name: "jira_search_users",
      description: "Find Atlassian users by query (name, email). Returns accountId for assignee/watcher fields.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Name or email substring" },
          maxResults: { type: "number" },
        },
        required: ["query"],
      },
      handler: async (a) =>
        client.get("/rest/api/3/user/search", { query: a.query, maxResults: a.maxResults ?? 20 }),
    },

    // ─── issues: read ─────────────────────────────────────────────────
    {
      name: "jira_search_issues",
      description:
        "Search issues by JQL using the modern /search/jql endpoint (cursor-paginated). Examples: 'project = PMK AND status = Open', 'assignee = currentUser() ORDER BY updated DESC'. Pass nextPageToken from a previous response for pagination. Use jira_search_issues_count for the total.",
      inputSchema: {
        type: "object",
        properties: {
          jql: { type: "string", description: "JQL query string" },
          fields: {
            type: "array", items: { type: "string" },
            description: "Fields to return (default summary,status,assignee,updated,priority). Use ['*all'] for everything.",
          },
          expand: { type: "string", description: "Comma-separated expand options (e.g. 'changelog,renderedFields')" },
          maxResults: { type: "number", description: "Default 50, max 100" },
          nextPageToken: { type: "string", description: "Cursor from a previous response for pagination" },
        },
        required: ["jql"],
      },
      handler: async (a) =>
        client.post("/rest/api/3/search/jql", {
          jql: a.jql,
          fields: a.fields ?? ["summary", "status", "assignee", "updated", "priority"],
          expand: a.expand,
          maxResults: a.maxResults ?? 50,
          nextPageToken: a.nextPageToken,
        }),
    },
    {
      name: "jira_search_issues_count",
      description: "Get the approximate total count of issues matching a JQL query (separate endpoint since /search/jql no longer returns 'total').",
      inputSchema: {
        type: "object",
        properties: { jql: { type: "string" } },
        required: ["jql"],
      },
      handler: async (a) =>
        client.post("/rest/api/3/search/approximate-count", { jql: a.jql }),
    },
    {
      name: "jira_get_issue",
      description: "Fetch a single issue by key or numeric id. Use expand='changelog,renderedFields,names' for richer context.",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: { type: "string", description: "Issue key like PMK-123 or numeric id" },
          fields: { type: "array", items: { type: "string" } },
          expand: { type: "string" },
        },
        required: ["issueKey"],
      },
      handler: async (a) =>
        client.get(`/rest/api/3/issue/${enc(a.issueKey)}`, {
          fields: a.fields ? a.fields.join(",") : undefined,
          expand: a.expand,
        }),
    },

    // ─── issues: write ────────────────────────────────────────────────
    {
      name: "jira_create_issue",
      description:
        "Create an issue. Required: projectKey, summary, issueTypeName. Optional: descriptionText (plain text → ADF), assigneeAccountId, labels, priorityName, parentKey (for sub-tasks/epic children), customFields (object).",
      inputSchema: {
        type: "object",
        properties: {
          projectKey: { type: "string" },
          summary: { type: "string" },
          issueTypeName: { type: "string", description: "e.g. Task, Bug, Story, Epic, Sub-task" },
          descriptionText: { type: "string" },
          assigneeAccountId: { type: "string" },
          labels: { type: "array", items: { type: "string" } },
          priorityName: { type: "string" },
          parentKey: { type: "string", description: "For sub-tasks (parent issue) or epic children (epic key)" },
          customFields: {
            type: "object",
            description: "Raw extra fields, merged into 'fields'. Example: { customfield_10001: 'value' }",
          },
        },
        required: ["projectKey", "summary", "issueTypeName"],
      },
      handler: async (a) => {
        const fields: Record<string, unknown> = {
          project: { key: a.projectKey },
          summary: a.summary,
          issuetype: { name: a.issueTypeName },
          ...(a.customFields ?? {}),
        };
        if (a.descriptionText) fields.description = textToAdf(a.descriptionText);
        if (a.assigneeAccountId) fields.assignee = { accountId: a.assigneeAccountId };
        if (a.labels) fields.labels = a.labels;
        if (a.priorityName) fields.priority = { name: a.priorityName };
        if (a.parentKey) fields.parent = { key: a.parentKey };
        return client.post("/rest/api/3/issue", { fields });
      },
    },
    {
      name: "jira_update_issue",
      description:
        "Update an issue. Pass any of: summary, descriptionText, assigneeAccountId, labels, priorityName, customFields (object). Only included fields are changed.",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: { type: "string" },
          summary: { type: "string" },
          descriptionText: { type: "string" },
          assigneeAccountId: { type: "string" },
          labels: { type: "array", items: { type: "string" } },
          priorityName: { type: "string" },
          customFields: { type: "object" },
        },
        required: ["issueKey"],
      },
      handler: async (a) => {
        const fields: Record<string, unknown> = { ...(a.customFields ?? {}) };
        if (a.summary !== undefined) fields.summary = a.summary;
        if (a.descriptionText !== undefined) fields.description = textToAdf(a.descriptionText);
        if (a.assigneeAccountId !== undefined) fields.assignee = { accountId: a.assigneeAccountId };
        if (a.labels !== undefined) fields.labels = a.labels;
        if (a.priorityName !== undefined) fields.priority = { name: a.priorityName };
        await client.put(`/rest/api/3/issue/${enc(a.issueKey)}`, { fields });
        return { ok: true, issueKey: a.issueKey };
      },
    },
    {
      name: "jira_delete_issue",
      description: "Delete an issue (and optionally its sub-tasks). DESTRUCTIVE.",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: { type: "string" },
          deleteSubtasks: { type: "boolean", description: "Default false" },
        },
        required: ["issueKey"],
      },
      handler: async (a) => {
        await client.delete(`/rest/api/3/issue/${enc(a.issueKey)}`, {
          deleteSubtasks: a.deleteSubtasks ?? false,
        });
        return { ok: true, deleted: a.issueKey };
      },
    },

    // ─── transitions ──────────────────────────────────────────────────
    {
      name: "jira_get_transitions",
      description: "List available status transitions for an issue (use the id with jira_transition_issue).",
      inputSchema: {
        type: "object",
        properties: { issueKey: { type: "string" } },
        required: ["issueKey"],
      },
      handler: async (a) => client.get(`/rest/api/3/issue/${enc(a.issueKey)}/transitions`),
    },
    {
      name: "jira_transition_issue",
      description: "Move an issue to a new status using a transition id (from jira_get_transitions). Optional commentText.",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: { type: "string" },
          transitionId: { type: "string" },
          commentText: { type: "string" },
        },
        required: ["issueKey", "transitionId"],
      },
      handler: async (a) => {
        const body: Record<string, unknown> = { transition: { id: a.transitionId } };
        if (a.commentText) body.update = { comment: [{ add: { body: textToAdf(a.commentText) } }] };
        await client.post(`/rest/api/3/issue/${enc(a.issueKey)}/transitions`, body);
        return { ok: true, issueKey: a.issueKey, transitionId: a.transitionId };
      },
    },

    // ─── comments ─────────────────────────────────────────────────────
    {
      name: "jira_list_comments",
      description: "List comments on an issue (paginated).",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: { type: "string" },
          maxResults: { type: "number" },
          startAt: { type: "number" },
          orderBy: { type: "string", description: "e.g. 'created', '-created' (most recent first)" },
        },
        required: ["issueKey"],
      },
      handler: async (a) =>
        client.get(`/rest/api/3/issue/${enc(a.issueKey)}/comment`, {
          maxResults: a.maxResults ?? 50, startAt: a.startAt ?? 0, orderBy: a.orderBy,
        }),
    },
    {
      name: "jira_add_comment",
      description: "Add a plain-text comment to an issue (converted to ADF).",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: { type: "string" },
          text: { type: "string" },
        },
        required: ["issueKey", "text"],
      },
      handler: async (a) =>
        client.post(`/rest/api/3/issue/${enc(a.issueKey)}/comment`, { body: textToAdf(a.text) }),
    },
    {
      name: "jira_update_comment",
      description: "Edit an existing comment (replaces full body with plain text).",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: { type: "string" },
          commentId: { type: "string" },
          text: { type: "string" },
        },
        required: ["issueKey", "commentId", "text"],
      },
      handler: async (a) =>
        client.put(`/rest/api/3/issue/${enc(a.issueKey)}/comment/${enc(a.commentId)}`, {
          body: textToAdf(a.text),
        }),
    },
    {
      name: "jira_delete_comment",
      description: "Delete a comment from an issue. DESTRUCTIVE.",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: { type: "string" },
          commentId: { type: "string" },
        },
        required: ["issueKey", "commentId"],
      },
      handler: async (a) => {
        await client.delete(`/rest/api/3/issue/${enc(a.issueKey)}/comment/${enc(a.commentId)}`);
        return { ok: true, deleted: a.commentId };
      },
    },

    // ─── attachments ──────────────────────────────────────────────────
    {
      name: "jira_list_attachments",
      description: "List attachments on an issue (returns id, filename, size, contentUrl).",
      inputSchema: {
        type: "object",
        properties: { issueKey: { type: "string" } },
        required: ["issueKey"],
      },
      handler: async (a) => {
        const issue = (await client.get(`/rest/api/3/issue/${enc(a.issueKey)}`, {
          fields: "attachment",
        })) as { fields?: { attachment?: unknown[] } };
        return issue.fields?.attachment ?? [];
      },
    },
    {
      name: "jira_upload_attachment",
      description:
        "Upload a local file as an attachment to an issue. Reads from filePath on the local machine.",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: { type: "string" },
          filePath: { type: "string", description: "Absolute or relative path to local file" },
          filename: { type: "string", description: "Optional override of the filename shown in Jira" },
        },
        required: ["issueKey", "filePath"],
      },
      handler: async (a) =>
        client.uploadFile(`/rest/api/3/issue/${enc(a.issueKey)}/attachments`, a.filePath, {
          filename: a.filename,
        }),
    },
    {
      name: "jira_download_attachment",
      description:
        "Download an attachment by id. If outputPath is set, saves to disk and returns metadata. Otherwise returns base64 (use only for small files).",
      inputSchema: {
        type: "object",
        properties: {
          attachmentId: { type: "string" },
          outputPath: { type: "string", description: "Local path to save the file (recommended)" },
        },
        required: ["attachmentId"],
      },
      handler: async (a) =>
        client.downloadBinary(`/rest/api/3/attachment/content/${enc(a.attachmentId)}`, {
          outputPath: a.outputPath,
        }),
    },
    {
      name: "jira_delete_attachment",
      description: "Delete an attachment by id. DESTRUCTIVE.",
      inputSchema: {
        type: "object",
        properties: { attachmentId: { type: "string" } },
        required: ["attachmentId"],
      },
      handler: async (a) => {
        await client.delete(`/rest/api/3/attachment/${enc(a.attachmentId)}`);
        return { ok: true, deleted: a.attachmentId };
      },
    },

    // ─── issue links ──────────────────────────────────────────────────
    {
      name: "jira_list_link_types",
      description: "List all issue-link types (e.g. 'Blocks', 'Relates', 'Duplicates'). Use the name when creating links.",
      inputSchema: { type: "object", properties: {} },
      handler: async () => client.get("/rest/api/3/issueLinkType"),
    },
    {
      name: "jira_link_issues",
      description:
        "Create a link between two issues. linkType is the name from jira_list_link_types (e.g. 'Blocks'). Direction matters: inwardKey is the source, outwardKey is the target.",
      inputSchema: {
        type: "object",
        properties: {
          inwardKey: { type: "string", description: "Source issue (the one that 'X's the other)" },
          outwardKey: { type: "string", description: "Target issue (the one being 'X'd by the source)" },
          linkType: { type: "string", description: "Link type name (e.g. 'Blocks', 'Relates')" },
          commentText: { type: "string", description: "Optional plain-text comment about the link" },
        },
        required: ["inwardKey", "outwardKey", "linkType"],
      },
      handler: async (a) => {
        const body: Record<string, unknown> = {
          type: { name: a.linkType },
          inwardIssue: { key: a.inwardKey },
          outwardIssue: { key: a.outwardKey },
        };
        if (a.commentText) body.comment = { body: textToAdf(a.commentText) };
        await client.post("/rest/api/3/issueLink", body);
        return { ok: true, inward: a.inwardKey, outward: a.outwardKey, type: a.linkType };
      },
    },
    {
      name: "jira_delete_issue_link",
      description: "Delete an issue link by id (link ids are returned in get_issue's 'issuelinks' field). DESTRUCTIVE.",
      inputSchema: {
        type: "object",
        properties: { linkId: { type: "string" } },
        required: ["linkId"],
      },
      handler: async (a) => {
        await client.delete(`/rest/api/3/issueLink/${enc(a.linkId)}`);
        return { ok: true, deleted: a.linkId };
      },
    },

    // ─── work logs ────────────────────────────────────────────────────
    {
      name: "jira_list_worklogs",
      description: "List work logs on an issue.",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: { type: "string" },
          maxResults: { type: "number" },
          startAt: { type: "number" },
        },
        required: ["issueKey"],
      },
      handler: async (a) =>
        client.get(`/rest/api/3/issue/${enc(a.issueKey)}/worklog`, {
          maxResults: a.maxResults ?? 100, startAt: a.startAt ?? 0,
        }),
    },
    {
      name: "jira_add_worklog",
      description:
        "Log work on an issue. timeSpent uses Jira format (e.g. '2h 30m', '1d', '15m'). Optional commentText, started (ISO8601).",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: { type: "string" },
          timeSpent: { type: "string", description: "e.g. '2h 30m', '1d 4h', '15m'" },
          commentText: { type: "string" },
          started: { type: "string", description: "ISO8601 start time (default: now)" },
        },
        required: ["issueKey", "timeSpent"],
      },
      handler: async (a) => {
        const body: Record<string, unknown> = { timeSpent: a.timeSpent };
        if (a.commentText) body.comment = textToAdf(a.commentText);
        if (a.started) body.started = a.started;
        return client.post(`/rest/api/3/issue/${enc(a.issueKey)}/worklog`, body);
      },
    },

    // ─── watchers ─────────────────────────────────────────────────────
    {
      name: "jira_list_watchers",
      description: "List watchers on an issue.",
      inputSchema: {
        type: "object",
        properties: { issueKey: { type: "string" } },
        required: ["issueKey"],
      },
      handler: async (a) => client.get(`/rest/api/3/issue/${enc(a.issueKey)}/watchers`),
    },
    {
      name: "jira_add_watcher",
      description: "Add a user (by accountId) as a watcher on an issue.",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: { type: "string" },
          accountId: { type: "string" },
        },
        required: ["issueKey", "accountId"],
      },
      handler: async (a) => {
        await client.post(`/rest/api/3/issue/${enc(a.issueKey)}/watchers`, a.accountId);
        return { ok: true };
      },
    },
    {
      name: "jira_remove_watcher",
      description: "Remove a user (by accountId) from an issue's watcher list.",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: { type: "string" },
          accountId: { type: "string" },
        },
        required: ["issueKey", "accountId"],
      },
      handler: async (a) => {
        await client.delete(`/rest/api/3/issue/${enc(a.issueKey)}/watchers`, { accountId: a.accountId });
        return { ok: true };
      },
    },

    // ─── versions (release / fix-versions) ────────────────────────────
    {
      name: "jira_list_versions",
      description: "List versions in a project (used as fix-versions / affects-versions).",
      inputSchema: {
        type: "object",
        properties: { projectKeyOrId: { type: "string" } },
        required: ["projectKeyOrId"],
      },
      handler: async (a) =>
        client.get(`/rest/api/3/project/${enc(a.projectKeyOrId)}/versions`),
    },
    {
      name: "jira_create_version",
      description: "Create a new project version. Required: projectId (numeric), name. Optional: description, releaseDate (YYYY-MM-DD), released.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "number" },
          name: { type: "string" },
          description: { type: "string" },
          releaseDate: { type: "string" },
          released: { type: "boolean" },
        },
        required: ["projectId", "name"],
      },
      handler: async (a) =>
        client.post("/rest/api/3/version", {
          projectId: a.projectId, name: a.name,
          description: a.description, releaseDate: a.releaseDate, released: a.released,
        }),
    },

    // ─── agile (boards + sprints) ─────────────────────────────────────
    {
      name: "jira_list_boards",
      description: "List Scrum/Kanban boards. Optional projectKeyOrId to filter.",
      inputSchema: {
        type: "object",
        properties: {
          projectKeyOrId: { type: "string" },
          type: { type: "string", description: "'scrum' or 'kanban'" },
          maxResults: { type: "number" },
          startAt: { type: "number" },
        },
      },
      handler: async (a) =>
        client.get("/rest/agile/1.0/board", {
          projectKeyOrId: a.projectKeyOrId, type: a.type,
          maxResults: a.maxResults ?? 50, startAt: a.startAt ?? 0,
        }),
    },
    {
      name: "jira_get_board_backlog",
      description: "Get issues on a board's backlog (Scrum boards).",
      inputSchema: {
        type: "object",
        properties: {
          boardId: { type: "number" },
          jql: { type: "string", description: "Optional JQL filter" },
          maxResults: { type: "number" },
          startAt: { type: "number" },
        },
        required: ["boardId"],
      },
      handler: async (a) =>
        client.get(`/rest/agile/1.0/board/${a.boardId}/backlog`, {
          jql: a.jql, maxResults: a.maxResults ?? 50, startAt: a.startAt ?? 0,
        }),
    },
    {
      name: "jira_list_sprints",
      description: "List sprints on a board (Scrum boards). Optional state: 'active', 'future', 'closed'.",
      inputSchema: {
        type: "object",
        properties: {
          boardId: { type: "number" },
          state: { type: "string" },
          maxResults: { type: "number" },
          startAt: { type: "number" },
        },
        required: ["boardId"],
      },
      handler: async (a) =>
        client.get(`/rest/agile/1.0/board/${a.boardId}/sprint`, {
          state: a.state, maxResults: a.maxResults ?? 50, startAt: a.startAt ?? 0,
        }),
    },
    {
      name: "jira_get_sprint_issues",
      description: "List issues currently in a sprint.",
      inputSchema: {
        type: "object",
        properties: {
          sprintId: { type: "number" },
          jql: { type: "string" },
          maxResults: { type: "number" },
          startAt: { type: "number" },
        },
        required: ["sprintId"],
      },
      handler: async (a) =>
        client.get(`/rest/agile/1.0/sprint/${a.sprintId}/issue`, {
          jql: a.jql, maxResults: a.maxResults ?? 50, startAt: a.startAt ?? 0,
        }),
    },
    {
      name: "jira_move_issues_to_sprint",
      description: "Move one or more issues to a sprint (or to the backlog if sprintId is null).",
      inputSchema: {
        type: "object",
        properties: {
          sprintId: { type: "number", description: "Target sprint id" },
          issueKeys: { type: "array", items: { type: "string" }, description: "Up to 50 keys" },
        },
        required: ["sprintId", "issueKeys"],
      },
      handler: async (a) => {
        await client.post(`/rest/agile/1.0/sprint/${a.sprintId}/issue`, { issues: a.issueKeys });
        return { ok: true, moved: a.issueKeys.length, sprintId: a.sprintId };
      },
    },
  ];
}
