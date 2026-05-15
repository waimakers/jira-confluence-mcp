import assert from "node:assert/strict";

import { AtlassianClient, loadConfig } from "./dist/atlassian-client.js";
import {
  assertToolCallAllowed,
  filterTools,
  loadGuardrailsConfig,
  validateToolArguments,
} from "./dist/guardrails.js";
import { buildConfluenceTools } from "./dist/tools/confluence.js";
import { buildJiraTools } from "./dist/tools/jira.js";

const noopClient = {
  get: async () => ({}),
  post: async () => ({}),
  put: async () => ({}),
  delete: async () => ({}),
  uploadFile: async () => ({}),
  downloadBinary: async (pathOrUrl) => ({ pathOrUrl }),
};

const allTools = [...buildJiraTools(noopClient), ...buildConfluenceTools(noopClient)];
const byName = new Map(allTools.map((tool) => [tool.name, tool]));

{
  const cfg = loadGuardrailsConfig({});
  const { tools } = filterTools(allTools, cfg);
  const names = new Set(tools.map((tool) => tool.name));
  assert.equal(cfg.mode, "readonly");
  assert.equal(names.has("jira_get_issue"), true);
  assert.equal(names.has("confluence_get_page"), true);
  assert.equal(names.has("jira_create_issue"), false);
  assert.equal(names.has("jira_delete_issue"), false);
  assert.equal(names.has("jira_download_attachment"), false);
}

{
  const cfg = loadGuardrailsConfig({ JCMCP_MODE: "workshop" });
  const { tools } = filterTools(allTools, cfg);
  const names = new Set(tools.map((tool) => tool.name));
  assert.equal(names.has("jira_get_issue"), true);
  assert.equal(names.has("jira_create_issue"), true);
  assert.equal(names.has("jira_add_comment"), true);
  assert.equal(names.has("jira_update_issue"), false);
  assert.equal(names.has("jira_delete_issue"), false);
  assert.equal(names.has("confluence_update_page"), false);
}

{
  const cfg = loadGuardrailsConfig({ JCMCP_MODE: "full" });
  const { tools } = filterTools(allTools, cfg);
  assert.equal(tools.length, 56);
}

{
  const cfg = loadGuardrailsConfig({
    JCMCP_MODE: "full",
    JCMCP_TOOLS: "jira_create_issue,jira_delete_issue,jira_download_attachment",
  });
  const { tools } = filterTools(allTools, cfg);
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["jira_create_issue", "jira_delete_issue", "jira_download_attachment"],
  );
}

{
  assert.throws(
    () => validateToolArguments(byName.get("jira_search_issues"), { jql: "project = ABC", maxResults: 999 }),
    /maxResults/,
  );
  assert.throws(
    () => validateToolArguments(byName.get("jira_get_issue"), { issueKey: "ABC-1", surprise: true }),
    /Unexpected argument/,
  );
  assert.throws(
    () => validateToolArguments(byName.get("jira_move_issues_to_sprint"), {
      sprintId: 1,
      issueKeys: Array.from({ length: 51 }, (_, index) => `ABC-${index + 1}`),
    }),
    /1 to 50/,
  );
}

{
  const workshopCfg = loadGuardrailsConfig({ JCMCP_MODE: "workshop" });
  assert.doesNotThrow(() =>
    assertToolCallAllowed(byName.get("jira_create_issue"), { projectKey: "ABC", summary: "x", issueTypeName: "Task" }, workshopCfg),
  );
  assert.throws(
    () =>
      assertToolCallAllowed(
        byName.get("jira_create_issue"),
        { projectKey: "ABC", summary: "x", issueTypeName: "Task", customFields: { customfield_10001: "x" } },
        workshopCfg,
      ),
    /JCMCP_MODE=full/,
  );
  assert.doesNotThrow(() =>
    assertToolCallAllowed(
      byName.get("jira_create_issue"),
      { projectKey: "ABC", summary: "x", issueTypeName: "Task", customFields: { customfield_10001: "x" } },
      loadGuardrailsConfig({ JCMCP_MODE: "full" }),
    ),
  );
}

{
  const client = new AtlassianClient({
    baseUrl: "https://example.atlassian.net",
    email: "user@example.com",
    apiToken: "token",
  });
  await assert.rejects(() => client.downloadBinary("https://evil.example/collect"), /non-Atlassian URL/);
  await assert.rejects(
    () => client.uploadFile("/rest/api/3/issue/ABC-1/attachments", "package.json"),
    /Attachment file access is disabled/,
  );
}

{
  const client = new AtlassianClient(
    {
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "token",
    },
    { fileRoot: "/tmp/jira-confluence-mcp-test-root" },
  );
  await assert.rejects(
    () => client.uploadFile("/rest/api/3/issue/ABC-1/attachments", "../package.json"),
    /outside JCMCP_FILE_ROOT/,
  );
}

{
  assert.throws(
    () =>
      loadConfig({
        ATLASSIAN_BASE_URL: "https://example.test",
        ATLASSIAN_EMAIL: "user@example.com",
        ATLASSIAN_API_TOKEN: "token",
      }),
    /atlassian\.net/,
  );
  assert.equal(
    loadConfig({
      ATLASSIAN_BASE_URL: "https://example.atlassian.net/wiki",
      ATLASSIAN_EMAIL: "user@example.com",
      ATLASSIAN_API_TOKEN: "token",
    }).baseUrl,
    "https://example.atlassian.net",
  );
}

{
  const confluenceClient = {
    ...noopClient,
    downloadBinary: async (pathOrUrl) => ({ pathOrUrl }),
  };
  const tool = buildConfluenceTools(confluenceClient).find((candidate) => candidate.name === "confluence_download_attachment");
  await assert.rejects(
    () => tool.handler({ downloadPath: "https://evil.example/attachment" }),
    /relative Confluence path/,
  );
  await assert.rejects(
    () => tool.handler({ downloadPath: "/download/attachments/1/file.txt" }),
    /must start with \/wiki\//,
  );
  assert.deepEqual(await tool.handler({ downloadPath: "/wiki/download/attachments/1/file.txt" }), {
    pathOrUrl: "/wiki/download/attachments/1/file.txt",
  });
}

console.log("guardrail tests passed");
