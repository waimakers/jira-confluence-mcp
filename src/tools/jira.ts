import type { AtlassianClient } from "../atlassian-client.js";

// Convert plain text → Atlassian Document Format (ADF) used by Jira v3 body fields.
function textToAdf(text: string) {
  const paragraphs = text.split(/\n\n+/).map((p) => ({
    type: "paragraph",
    content: p ? [{ type: "text", text: p }] : [],
  }));
  return { type: "doc", version: 1, content: paragraphs };
}

export type ToolHandler = (args: any) => Promise<unknown>;

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, any>; required?: string[] };
  handler: ToolHandler;
};

export function buildJiraTools(client: AtlassianClient): ToolDef[] {
  return [
    {
      name: "jira_myself",
      description: "Return the authenticated Atlassian account (sanity-check auth).",
      inputSchema: { type: "object", properties: {} },
      handler: async () => client.get("/rest/api/3/myself"),
    },
    {
      name: "jira_list_projects",
      description:
        "List Jira projects (paginated). Optional: query (search by name/key), maxResults (default 50).",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Filter projects by name or key" },
          maxResults: { type: "number", description: "Max results (default 50)" },
          startAt: { type: "number", description: "Pagination offset (default 0)" },
        },
      },
      handler: async (args) =>
        client.get("/rest/api/3/project/search", {
          query: args.query,
          maxResults: args.maxResults ?? 50,
          startAt: args.startAt ?? 0,
        }),
    },
    {
      name: "jira_search_issues",
      description:
        "Search issues by JQL. Examples: 'project = PMK AND status = Open', 'assignee = currentUser() ORDER BY updated DESC'. Returns id, key, summary, status, assignee, updated.",
      inputSchema: {
        type: "object",
        properties: {
          jql: { type: "string", description: "JQL query string" },
          fields: {
            type: "array",
            items: { type: "string" },
            description: "Fields to return (default: summary,status,assignee,updated,priority)",
          },
          maxResults: { type: "number", description: "Default 25, max 100" },
          startAt: { type: "number", description: "Pagination offset (default 0)" },
        },
        required: ["jql"],
      },
      handler: async (args) =>
        client.post("/rest/api/3/search", {
          jql: args.jql,
          fields: args.fields ?? ["summary", "status", "assignee", "updated", "priority"],
          maxResults: args.maxResults ?? 25,
          startAt: args.startAt ?? 0,
        }),
    },
    {
      name: "jira_get_issue",
      description: "Fetch a single issue by key (e.g. PMK-123) or numeric id.",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: { type: "string", description: "Issue key like PMK-123 or numeric id" },
          fields: { type: "array", items: { type: "string" }, description: "Fields to return" },
        },
        required: ["issueKey"],
      },
      handler: async (args) =>
        client.get(`/rest/api/3/issue/${encodeURIComponent(args.issueKey)}`, {
          fields: args.fields ? args.fields.join(",") : undefined,
        }),
    },
    {
      name: "jira_create_issue",
      description:
        "Create an issue. Required: projectKey, summary, issueTypeName (e.g. 'Task','Bug','Story'). Optional: descriptionText (plain text, converted to ADF), assigneeAccountId, labels, priorityName.",
      inputSchema: {
        type: "object",
        properties: {
          projectKey: { type: "string" },
          summary: { type: "string" },
          issueTypeName: { type: "string", description: "e.g. Task, Bug, Story, Epic" },
          descriptionText: { type: "string", description: "Plain text description (converted to ADF)" },
          assigneeAccountId: { type: "string" },
          labels: { type: "array", items: { type: "string" } },
          priorityName: { type: "string", description: "e.g. High, Medium, Low" },
        },
        required: ["projectKey", "summary", "issueTypeName"],
      },
      handler: async (args) => {
        const fields: Record<string, unknown> = {
          project: { key: args.projectKey },
          summary: args.summary,
          issuetype: { name: args.issueTypeName },
        };
        if (args.descriptionText) fields.description = textToAdf(args.descriptionText);
        if (args.assigneeAccountId) fields.assignee = { accountId: args.assigneeAccountId };
        if (args.labels) fields.labels = args.labels;
        if (args.priorityName) fields.priority = { name: args.priorityName };
        return client.post("/rest/api/3/issue", { fields });
      },
    },
    {
      name: "jira_update_issue",
      description:
        "Update fields on an existing issue. Pass any of: summary, descriptionText (plain text), assigneeAccountId, labels, priorityName. Only included fields are changed.",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: { type: "string" },
          summary: { type: "string" },
          descriptionText: { type: "string" },
          assigneeAccountId: { type: "string" },
          labels: { type: "array", items: { type: "string" } },
          priorityName: { type: "string" },
        },
        required: ["issueKey"],
      },
      handler: async (args) => {
        const fields: Record<string, unknown> = {};
        if (args.summary !== undefined) fields.summary = args.summary;
        if (args.descriptionText !== undefined) fields.description = textToAdf(args.descriptionText);
        if (args.assigneeAccountId !== undefined) fields.assignee = { accountId: args.assigneeAccountId };
        if (args.labels !== undefined) fields.labels = args.labels;
        if (args.priorityName !== undefined) fields.priority = { name: args.priorityName };
        await client.put(`/rest/api/3/issue/${encodeURIComponent(args.issueKey)}`, { fields });
        return { ok: true, issueKey: args.issueKey };
      },
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
      handler: async (args) =>
        client.post(`/rest/api/3/issue/${encodeURIComponent(args.issueKey)}/comment`, {
          body: textToAdf(args.text),
        }),
    },
    {
      name: "jira_get_transitions",
      description: "List the transitions available for an issue (use the id with jira_transition_issue).",
      inputSchema: {
        type: "object",
        properties: { issueKey: { type: "string" } },
        required: ["issueKey"],
      },
      handler: async (args) =>
        client.get(`/rest/api/3/issue/${encodeURIComponent(args.issueKey)}/transitions`),
    },
    {
      name: "jira_transition_issue",
      description: "Move an issue to a new status using a transition id (from jira_get_transitions).",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: { type: "string" },
          transitionId: { type: "string" },
          commentText: { type: "string", description: "Optional plain-text comment to add with the transition" },
        },
        required: ["issueKey", "transitionId"],
      },
      handler: async (args) => {
        const body: Record<string, unknown> = { transition: { id: args.transitionId } };
        if (args.commentText) {
          body.update = { comment: [{ add: { body: textToAdf(args.commentText) } }] };
        }
        await client.post(`/rest/api/3/issue/${encodeURIComponent(args.issueKey)}/transitions`, body);
        return { ok: true, issueKey: args.issueKey, transitionId: args.transitionId };
      },
    },
    {
      name: "jira_search_users",
      description: "Find Atlassian users by query (name, email). Returns accountId for use in assignee fields.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Name or email substring" },
          maxResults: { type: "number" },
        },
        required: ["query"],
      },
      handler: async (args) =>
        client.get("/rest/api/3/user/search", { query: args.query, maxResults: args.maxResults ?? 20 }),
    },
  ];
}
