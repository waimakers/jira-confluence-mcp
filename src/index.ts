#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { AtlassianClient, AtlassianError, loadConfig } from "./atlassian-client.js";
import {
  assertToolCallAllowed,
  filterTools,
  loadGuardrailsConfig,
  validateToolArguments,
} from "./guardrails.js";
import { buildConfluenceTools } from "./tools/confluence.js";
import { buildJiraTools } from "./tools/jira.js";
import type { ToolDef } from "./tools/types.js";

async function main() {
  const cfg = loadConfig();
  const guardrails = loadGuardrailsConfig();
  const client = new AtlassianClient(cfg, {
    fileRoot: guardrails.fileRoot,
    maxFileBytes: guardrails.maxFileBytes,
    allowOverwrite: guardrails.allowOverwrite,
  });

  const allTools: ToolDef[] = [...buildJiraTools(client), ...buildConfluenceTools(client)];
  const { tools, hidden } = filterTools(allTools, guardrails);
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  const server = new Server(
    { name: "jira-confluence-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = toolMap.get(req.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
      };
    }
    try {
      const args = validateToolArguments(tool, req.params.arguments ?? {});
      assertToolCallAllowed(tool, args, guardrails);
      const result = await tool.handler(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message =
        err instanceof AtlassianError
          ? `${err.message}\n${JSON.stringify(err.body, null, 2)}`
          : err instanceof Error
            ? err.message
            : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: message }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Logs go to stderr so they don't pollute stdio JSON-RPC.
  console.error(
    `jira-confluence-mcp ready. ${tools.length} tools loaded (${hidden.length} hidden). ` +
      `baseUrl=${cfg.baseUrl} readOnly=${guardrails.readOnly} ` +
      `attachments=${guardrails.enableAttachments} destructive=${guardrails.enableDestructiveTools}`,
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
