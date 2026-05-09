import type { AtlassianClient } from "../atlassian-client.js";
import type { ToolDef } from "./jira.js";

export function buildConfluenceTools(client: AtlassianClient): ToolDef[] {
  return [
    {
      name: "confluence_list_spaces",
      description: "List Confluence spaces (v2). Optional limit (default 25).",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Default 25, max 250" },
          cursor: { type: "string", description: "Pagination cursor from previous response" },
        },
      },
      handler: async (args) =>
        client.get("/wiki/api/v2/spaces", { limit: args.limit ?? 25, cursor: args.cursor }),
    },
    {
      name: "confluence_search",
      description:
        "Search Confluence content with CQL (Confluence Query Language). Examples: 'type=page AND space=DOCS', 'text ~ \"onboarding\" AND lastModified > now(\"-7d\")'. Uses the v1 search endpoint (still preferred for CQL).",
      inputSchema: {
        type: "object",
        properties: {
          cql: { type: "string", description: "CQL query" },
          limit: { type: "number", description: "Default 25" },
          start: { type: "number", description: "Pagination offset" },
        },
        required: ["cql"],
      },
      handler: async (args) =>
        client.get("/wiki/rest/api/search", {
          cql: args.cql,
          limit: args.limit ?? 25,
          start: args.start ?? 0,
        }),
    },
    {
      name: "confluence_get_page",
      description: "Fetch a Confluence page by id (v2). Set bodyFormat='storage' (default) or 'atlas_doc_format' or 'view'.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          bodyFormat: {
            type: "string",
            description: "storage | atlas_doc_format | view (default storage)",
          },
        },
        required: ["pageId"],
      },
      handler: async (args) =>
        client.get(`/wiki/api/v2/pages/${encodeURIComponent(args.pageId)}`, {
          "body-format": args.bodyFormat ?? "storage",
        }),
    },
    {
      name: "confluence_create_page",
      description:
        "Create a Confluence page. Required: spaceId, title, bodyStorage (HTML/Confluence storage format). Optional: parentId.",
      inputSchema: {
        type: "object",
        properties: {
          spaceId: { type: "string", description: "Numeric space id (from confluence_list_spaces)" },
          title: { type: "string" },
          bodyStorage: {
            type: "string",
            description:
              "Page body in Confluence 'storage' format (HTML-like). Plain text works too — wrap in <p>...</p> for paragraphs.",
          },
          parentId: { type: "string", description: "Optional parent page id" },
        },
        required: ["spaceId", "title", "bodyStorage"],
      },
      handler: async (args) =>
        client.post("/wiki/api/v2/pages", {
          spaceId: args.spaceId,
          status: "current",
          title: args.title,
          parentId: args.parentId,
          body: { representation: "storage", value: args.bodyStorage },
        }),
    },
    {
      name: "confluence_update_page",
      description:
        "Update a Confluence page. You must pass the current version number (use confluence_get_page first to get it).",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          title: { type: "string" },
          bodyStorage: { type: "string", description: "New body (storage format)" },
          versionNumber: {
            type: "number",
            description: "New version number = current version + 1",
          },
        },
        required: ["pageId", "title", "bodyStorage", "versionNumber"],
      },
      handler: async (args) =>
        client.put(`/wiki/api/v2/pages/${encodeURIComponent(args.pageId)}`, {
          id: args.pageId,
          status: "current",
          title: args.title,
          body: { representation: "storage", value: args.bodyStorage },
          version: { number: args.versionNumber },
        }),
    },
  ];
}
