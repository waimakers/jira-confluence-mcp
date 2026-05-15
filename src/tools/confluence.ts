import type { AtlassianClient } from "../atlassian-client.js";
import type { ToolDef } from "./types.js";

const enc = encodeURIComponent;

function assertConfluenceDownloadPath(downloadPath: string) {
  if (/^https?:\/\//i.test(downloadPath)) {
    throw new Error("downloadPath must be a relative Confluence path, not an absolute URL");
  }
  if (!downloadPath.startsWith("/wiki/")) {
    throw new Error("downloadPath must start with /wiki/");
  }
  return downloadPath;
}

export function buildConfluenceTools(client: AtlassianClient): ToolDef[] {
  return [
    // ─── spaces ───────────────────────────────────────────────────────
    {
      name: "confluence_list_spaces",
      description: "List Confluence spaces (v2). Paginated.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Default 25, max 250" },
          cursor: { type: "string", description: "Pagination cursor from previous response" },
        },
      },
      handler: async (a) => client.get("/wiki/api/v2/spaces", { limit: a.limit ?? 25, cursor: a.cursor }),
    },
    {
      name: "confluence_get_space",
      description: "Fetch one space by id (v2).",
      inputSchema: {
        type: "object",
        properties: { spaceId: { type: "string" } },
        required: ["spaceId"],
      },
      handler: async (a) => client.get(`/wiki/api/v2/spaces/${enc(a.spaceId)}`),
    },
    {
      name: "confluence_list_space_pages",
      description: "List pages in a space (v2). Useful for full-space export/sync.",
      inputSchema: {
        type: "object",
        properties: {
          spaceId: { type: "string" },
          limit: { type: "number" },
          cursor: { type: "string" },
          status: { type: "string", description: "current | archived | draft (default current)" },
        },
        required: ["spaceId"],
      },
      handler: async (a) =>
        client.get(`/wiki/api/v2/spaces/${enc(a.spaceId)}/pages`, {
          limit: a.limit ?? 25, cursor: a.cursor, status: a.status ?? "current",
        }),
    },

    // ─── search ───────────────────────────────────────────────────────
    {
      name: "confluence_search",
      description:
        "Search Confluence with CQL (Confluence Query Language). Examples: 'type=page AND space=DOCS', 'text ~ \"onboarding\" AND lastModified > now(\"-7d\")'.",
      inputSchema: {
        type: "object",
        properties: {
          cql: { type: "string", description: "CQL query" },
          limit: { type: "number", description: "Default 25" },
          start: { type: "number", description: "Pagination offset" },
        },
        required: ["cql"],
      },
      handler: async (a) =>
        client.get("/wiki/rest/api/search", { cql: a.cql, limit: a.limit ?? 25, start: a.start ?? 0 }),
    },

    // ─── pages: read ──────────────────────────────────────────────────
    {
      name: "confluence_get_page",
      description: "Fetch a Confluence page by id (v2). bodyFormat: 'storage' (default), 'atlas_doc_format', or 'view'.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          bodyFormat: { type: "string" },
        },
        required: ["pageId"],
      },
      handler: async (a) =>
        client.get(`/wiki/api/v2/pages/${enc(a.pageId)}`, { "body-format": a.bodyFormat ?? "storage" }),
    },
    {
      name: "confluence_get_page_children",
      description: "List direct child pages of a page (one level deep). Use repeatedly to walk the tree.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          limit: { type: "number" },
          cursor: { type: "string" },
        },
        required: ["pageId"],
      },
      handler: async (a) =>
        client.get(`/wiki/api/v2/pages/${enc(a.pageId)}/children`, {
          limit: a.limit ?? 25, cursor: a.cursor,
        }),
    },
    {
      name: "confluence_get_page_ancestors",
      description: "Get the ancestor chain of a page (root → parent). Useful for breadcrumbs.",
      inputSchema: {
        type: "object",
        properties: { pageId: { type: "string" } },
        required: ["pageId"],
      },
      handler: async (a) =>
        client.get(`/wiki/api/v2/pages/${enc(a.pageId)}/ancestors`),
    },
    {
      name: "confluence_list_page_versions",
      description: "List historical versions of a page.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          limit: { type: "number" },
          cursor: { type: "string" },
        },
        required: ["pageId"],
      },
      handler: async (a) =>
        client.get(`/wiki/api/v2/pages/${enc(a.pageId)}/versions`, {
          limit: a.limit ?? 25, cursor: a.cursor,
        }),
    },

    // ─── pages: write ─────────────────────────────────────────────────
    {
      name: "confluence_create_page",
      description:
        "Create a Confluence page. Body uses Confluence 'storage' format (HTML-like). Wrap plain text in <p>...</p>.",
      inputSchema: {
        type: "object",
        properties: {
          spaceId: { type: "string" },
          title: { type: "string" },
          bodyStorage: { type: "string", description: "Body in storage format" },
          parentId: { type: "string", description: "Optional parent page id" },
        },
        required: ["spaceId", "title", "bodyStorage"],
      },
      handler: async (a) =>
        client.post("/wiki/api/v2/pages", {
          spaceId: a.spaceId, status: "current", title: a.title, parentId: a.parentId,
          body: { representation: "storage", value: a.bodyStorage },
        }),
    },
    {
      name: "confluence_update_page",
      description:
        "Update a Confluence page. versionNumber MUST be the current version + 1. Use confluence_get_page first to read it.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          title: { type: "string" },
          bodyStorage: { type: "string" },
          versionNumber: { type: "number", description: "Current version + 1" },
        },
        required: ["pageId", "title", "bodyStorage", "versionNumber"],
      },
      handler: async (a) =>
        client.put(`/wiki/api/v2/pages/${enc(a.pageId)}`, {
          id: a.pageId, status: "current", title: a.title,
          body: { representation: "storage", value: a.bodyStorage },
          version: { number: a.versionNumber },
        }),
    },
    {
      name: "confluence_delete_page",
      description: "Delete a page. By default moves to trash (recoverable). DESTRUCTIVE.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          purge: { type: "boolean", description: "True = permanently delete from trash. Default false." },
        },
        required: ["pageId"],
      },
      handler: async (a) => {
        await client.delete(`/wiki/api/v2/pages/${enc(a.pageId)}`, { purge: a.purge ?? false });
        return { ok: true, deleted: a.pageId, purged: a.purge ?? false };
      },
    },

    // ─── comments ─────────────────────────────────────────────────────
    {
      name: "confluence_list_footer_comments",
      description: "List footer comments on a page (the regular bottom-of-page comments).",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          limit: { type: "number" },
          cursor: { type: "string" },
        },
        required: ["pageId"],
      },
      handler: async (a) =>
        client.get(`/wiki/api/v2/pages/${enc(a.pageId)}/footer-comments`, {
          limit: a.limit ?? 25, cursor: a.cursor, "body-format": "storage",
        }),
    },
    {
      name: "confluence_list_inline_comments",
      description: "List inline (highlighted-text) comments on a page.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          limit: { type: "number" },
          cursor: { type: "string" },
        },
        required: ["pageId"],
      },
      handler: async (a) =>
        client.get(`/wiki/api/v2/pages/${enc(a.pageId)}/inline-comments`, {
          limit: a.limit ?? 25, cursor: a.cursor, "body-format": "storage",
        }),
    },
    {
      name: "confluence_add_footer_comment",
      description: "Add a footer comment to a page. bodyStorage uses Confluence storage format.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          bodyStorage: { type: "string" },
        },
        required: ["pageId", "bodyStorage"],
      },
      handler: async (a) =>
        client.post("/wiki/api/v2/footer-comments", {
          pageId: a.pageId,
          body: { representation: "storage", value: a.bodyStorage },
        }),
    },

    // ─── labels ───────────────────────────────────────────────────────
    {
      name: "confluence_get_page_labels",
      description: "List labels on a page.",
      inputSchema: {
        type: "object",
        properties: { pageId: { type: "string" } },
        required: ["pageId"],
      },
      handler: async (a) => client.get(`/wiki/api/v2/pages/${enc(a.pageId)}/labels`),
    },
    {
      name: "confluence_add_page_labels",
      description: "Add labels to a page (uses v1 endpoint — v2 doesn't expose label-write yet).",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          labels: { type: "array", items: { type: "string" } },
        },
        required: ["pageId", "labels"],
      },
      handler: async (a) =>
        client.post(
          `/wiki/rest/api/content/${enc(a.pageId)}/label`,
          a.labels.map((name: string) => ({ prefix: "global", name })),
        ),
    },

    // ─── attachments ──────────────────────────────────────────────────
    {
      name: "confluence_list_page_attachments",
      description: "List attachments on a page (v2).",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          limit: { type: "number" },
          cursor: { type: "string" },
        },
        required: ["pageId"],
      },
      handler: async (a) =>
        client.get(`/wiki/api/v2/pages/${enc(a.pageId)}/attachments`, {
          limit: a.limit ?? 25, cursor: a.cursor,
        }),
    },
    {
      name: "confluence_upload_attachment",
      description:
        "Upload a local file as an attachment to a Confluence page. Uses v1 multipart endpoint (v2 doesn't support upload yet).",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          filePath: { type: "string", description: "Absolute or relative path to local file" },
          filename: { type: "string" },
          comment: { type: "string", description: "Optional comment shown in attachment history" },
        },
        required: ["pageId", "filePath"],
      },
      handler: async (a) =>
        client.uploadFile(
          `/wiki/rest/api/content/${enc(a.pageId)}/child/attachment`,
          a.filePath,
          { filename: a.filename, comment: a.comment, minorEdit: true },
        ),
    },
    {
      name: "confluence_download_attachment",
      description:
        "Download an attachment by its content/download URL (returned as `_links.download` in attachment metadata). Saves to outputPath if provided.",
      inputSchema: {
        type: "object",
        properties: {
          downloadPath: {
            type: "string",
            description: "The relative download path from the attachment metadata (e.g. '/wiki/download/attachments/...')",
          },
          outputPath: { type: "string", description: "Local file path to save (recommended)" },
        },
        required: ["downloadPath"],
      },
      handler: async (a) =>
        client.downloadBinary(assertConfluenceDownloadPath(a.downloadPath), { outputPath: a.outputPath }),
    },
  ];
}
