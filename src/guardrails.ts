import type { ToolDef } from "./tools/types.js";

type GuardrailsMode = "readonly" | "workshop" | "full";

const READ_ONLY_TOOL_NAMES = new Set([
  "jira_myself",
  "jira_list_projects",
  "jira_list_issue_types",
  "jira_list_priorities",
  "jira_list_statuses",
  "jira_search_users",
  "jira_search_issues",
  "jira_search_issues_count",
  "jira_get_issue",
  "jira_get_transitions",
  "jira_list_comments",
  "jira_list_attachments",
  "jira_list_link_types",
  "jira_list_worklogs",
  "jira_list_watchers",
  "jira_list_versions",
  "jira_list_boards",
  "jira_get_board_backlog",
  "jira_list_sprints",
  "jira_get_sprint_issues",
  "confluence_list_spaces",
  "confluence_get_space",
  "confluence_list_space_pages",
  "confluence_search",
  "confluence_get_page",
  "confluence_get_page_children",
  "confluence_get_page_ancestors",
  "confluence_list_page_versions",
  "confluence_list_footer_comments",
  "confluence_list_inline_comments",
  "confluence_get_page_labels",
  "confluence_list_page_attachments",
]);

const WORKSHOP_TOOL_NAMES = new Set([
  ...READ_ONLY_TOOL_NAMES,
  "jira_create_issue",
  "jira_add_comment",
]);

export type GuardrailsConfig = {
  mode: GuardrailsMode;
  allowedTools?: Set<string>;
  fileRoot?: string;
};

export type FilteredTools = {
  tools: ToolDef[];
  hidden: Array<{ name: string; reason: string }>;
};

function parseMode(value: string | undefined): GuardrailsMode {
  if (value === undefined || value.trim() === "") return "readonly";
  const normalized = value.trim().toLowerCase();
  if (normalized === "readonly" || normalized === "workshop" || normalized === "full") return normalized;
  throw new Error(`Invalid JCMCP_MODE: ${value}. Expected readonly, workshop, or full.`);
}

function parseCsvSet(value: string | undefined): Set<string> | undefined {
  if (!value) return undefined;
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? new Set(items) : undefined;
}

export function loadGuardrailsConfig(env: NodeJS.ProcessEnv = process.env): GuardrailsConfig {
  return {
    mode: parseMode(env.JCMCP_MODE),
    allowedTools: parseCsvSet(env.JCMCP_TOOLS),
    fileRoot: env.JCMCP_FILE_ROOT,
  };
}

function hiddenReason(tool: ToolDef, cfg: GuardrailsConfig): string | undefined {
  if (cfg.allowedTools && !cfg.allowedTools.has(tool.name)) {
    return "not in JCMCP_TOOLS";
  }
  if (cfg.mode === "readonly" && !READ_ONLY_TOOL_NAMES.has(tool.name)) {
    return "hidden by readonly mode";
  }
  if (cfg.mode === "workshop" && !WORKSHOP_TOOL_NAMES.has(tool.name)) {
    return "hidden by workshop mode";
  }
  return undefined;
}

export function filterTools(tools: ToolDef[], cfg: GuardrailsConfig): FilteredTools {
  const visible: ToolDef[] = [];
  const hidden: Array<{ name: string; reason: string }> = [];

  for (const tool of tools) {
    const reason = hiddenReason(tool, cfg);
    if (reason) {
      hidden.push({ name: tool.name, reason });
    } else {
      visible.push(tool);
    }
  }

  return { tools: visible, hidden };
}

function assertInteger(value: unknown, name: string, min: number, max?: number): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || (max !== undefined && value > max)) {
    const range = max === undefined ? `>= ${min}` : `between ${min} and ${max}`;
    throw new Error(`Invalid ${name}: expected an integer ${range}`);
  }
}

function assertJsonSchemaType(value: unknown, schema: any, key: string): void {
  if (value === undefined) return;

  switch (schema.type) {
    case "string":
      if (typeof value !== "string") throw new Error(`Invalid ${key}: expected string`);
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid ${key}: expected number`);
      break;
    case "boolean":
      if (typeof value !== "boolean") throw new Error(`Invalid ${key}: expected boolean`);
      break;
    case "array":
      if (!Array.isArray(value)) throw new Error(`Invalid ${key}: expected array`);
      if (schema.items) {
        value.forEach((item, index) => assertJsonSchemaType(item, schema.items, `${key}[${index}]`));
      }
      break;
    case "object":
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`Invalid ${key}: expected object`);
      }
      break;
    default:
      break;
  }
}

export function validateToolArguments(tool: ToolDef, rawArgs: unknown): Record<string, any> {
  const args = rawArgs ?? {};
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new Error(`Invalid arguments for ${tool.name}: expected object`);
  }

  const input = args as Record<string, any>;
  const properties = tool.inputSchema.properties ?? {};
  const allowedKeys = new Set(Object.keys(properties));

  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unexpected argument "${key}" for ${tool.name}`);
    }
  }

  for (const key of tool.inputSchema.required ?? []) {
    if (input[key] === undefined || input[key] === null || input[key] === "") {
      throw new Error(`Missing required argument "${key}" for ${tool.name}`);
    }
  }

  for (const [key, schema] of Object.entries(properties)) {
    assertJsonSchemaType(input[key], schema, key);
  }

  if (input.maxResults !== undefined) assertInteger(input.maxResults, "maxResults", 1, 100);
  if (input.limit !== undefined) assertInteger(input.limit, "limit", 1, 250);
  if (input.startAt !== undefined) assertInteger(input.startAt, "startAt", 0);
  if (input.boardId !== undefined) assertInteger(input.boardId, "boardId", 1);
  if (input.sprintId !== undefined) assertInteger(input.sprintId, "sprintId", 1);
  if (input.projectId !== undefined) assertInteger(input.projectId, "projectId", 1);
  if (input.versionNumber !== undefined) assertInteger(input.versionNumber, "versionNumber", 1);

  if (input.issueKeys !== undefined) {
    if (!Array.isArray(input.issueKeys) || input.issueKeys.length < 1 || input.issueKeys.length > 50) {
      throw new Error("Invalid issueKeys: expected 1 to 50 issue keys");
    }
  }

  return input;
}

export function assertToolCallAllowed(tool: ToolDef, args: Record<string, any>, cfg: GuardrailsConfig): void {
  const reason = hiddenReason(tool, cfg);
  if (reason) throw new Error(`Tool ${tool.name} is not available: ${reason}`);

  if (args.customFields && cfg.mode !== "full") {
    throw new Error("customFields are only available in JCMCP_MODE=full");
  }
}
