import type { ToolDef } from "./tools/types.js";

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

const ATTACHMENT_FILE_TOOL_NAMES = new Set([
  "jira_upload_attachment",
  "jira_download_attachment",
  "confluence_upload_attachment",
  "confluence_download_attachment",
]);

const DESTRUCTIVE_TOOL_NAMES = new Set([
  "jira_delete_issue",
  "jira_delete_comment",
  "jira_delete_attachment",
  "jira_delete_issue_link",
  "jira_remove_watcher",
  "confluence_delete_page",
]);

const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;

export type GuardrailsConfig = {
  readOnly: boolean;
  allowedTools?: Set<string>;
  enableAttachments: boolean;
  enableDestructiveTools: boolean;
  allowedJiraProjects?: Set<string>;
  allowedConfluenceSpaces?: Set<string>;
  allowCustomFields: boolean;
  allowedJiraCustomFields?: Set<string>;
  fileRoot?: string;
  maxFileBytes: number;
  allowOverwrite: boolean;
};

export type FilteredTools = {
  tools: ToolDef[];
  hidden: Array<{ name: string; reason: string }>;
};

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === "") return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Invalid boolean env value: ${value}`);
}

function parseCsvSet(value: string | undefined, transform = (v: string) => v): Set<string> | undefined {
  if (!value) return undefined;
  const items = value
    .split(",")
    .map((item) => transform(item.trim()))
    .filter(Boolean);
  return items.length ? new Set(items) : undefined;
}

function parsePositiveInt(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value.trim() === "") return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer env value, got: ${value}`);
  }
  return parsed;
}

export function loadGuardrailsConfig(env: NodeJS.ProcessEnv = process.env): GuardrailsConfig {
  return {
    readOnly: parseBool(env.JCMCP_READ_ONLY, true),
    allowedTools: parseCsvSet(env.JCMCP_ALLOWED_TOOLS),
    enableAttachments: parseBool(env.JCMCP_ENABLE_ATTACHMENTS, false),
    enableDestructiveTools: parseBool(env.JCMCP_ENABLE_DESTRUCTIVE_TOOLS, false),
    allowedJiraProjects: parseCsvSet(env.JCMCP_ALLOWED_JIRA_PROJECTS, (v) => v.toUpperCase()),
    allowedConfluenceSpaces: parseCsvSet(env.JCMCP_ALLOWED_CONFLUENCE_SPACES),
    allowCustomFields: parseBool(env.JCMCP_ALLOW_JIRA_CUSTOM_FIELDS, false),
    allowedJiraCustomFields: parseCsvSet(env.JCMCP_ALLOWED_JIRA_CUSTOM_FIELDS),
    fileRoot: env.JCMCP_FILE_ROOT,
    maxFileBytes: parsePositiveInt(env.JCMCP_MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES),
    allowOverwrite: parseBool(env.JCMCP_ALLOW_FILE_OVERWRITE, false),
  };
}

function hiddenReason(tool: ToolDef, cfg: GuardrailsConfig): string | undefined {
  if (cfg.allowedTools && !cfg.allowedTools.has(tool.name)) {
    return "not in JCMCP_ALLOWED_TOOLS";
  }
  if (cfg.readOnly && !READ_ONLY_TOOL_NAMES.has(tool.name)) {
    return "hidden by read-only mode";
  }
  if (!cfg.enableAttachments && ATTACHMENT_FILE_TOOL_NAMES.has(tool.name)) {
    return "attachment file tools disabled";
  }
  if (!cfg.enableDestructiveTools && DESTRUCTIVE_TOOL_NAMES.has(tool.name)) {
    return "destructive tools disabled";
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

function issueProjectKey(value: string): string | undefined {
  const match = /^([A-Z][A-Z0-9_]+)-\d+$/i.exec(value.trim());
  return match?.[1]?.toUpperCase();
}

function assertJiraProjectAllowed(projectKey: string | undefined, cfg: GuardrailsConfig, context: string): void {
  if (!cfg.allowedJiraProjects || cfg.allowedJiraProjects.size === 0) return;
  if (!projectKey) {
    throw new Error(`${context} cannot be verified against JCMCP_ALLOWED_JIRA_PROJECTS`);
  }
  if (!cfg.allowedJiraProjects.has(projectKey.toUpperCase())) {
    throw new Error(`${context} is outside JCMCP_ALLOWED_JIRA_PROJECTS`);
  }
}

function projectsFromJql(jql: string): string[] {
  const projects = new Set<string>();
  for (const match of jql.matchAll(/\bproject\s*=\s*"?([A-Z][A-Z0-9_]*)"?/gi)) {
    projects.add(match[1].toUpperCase());
  }
  for (const match of jql.matchAll(/\bproject\s+in\s*\(([^)]*)\)/gi)) {
    for (const raw of match[1].split(",")) {
      const project = raw.trim().replace(/^["']|["']$/g, "");
      if (/^[A-Z][A-Z0-9_]*$/i.test(project)) projects.add(project.toUpperCase());
    }
  }
  return [...projects];
}

function assertJqlAllowed(jql: string, cfg: GuardrailsConfig): void {
  if (!cfg.allowedJiraProjects || cfg.allowedJiraProjects.size === 0) return;
  const projects = projectsFromJql(jql);
  if (projects.length === 0) {
    throw new Error("JQL must include an explicit project filter when JCMCP_ALLOWED_JIRA_PROJECTS is set");
  }
  for (const project of projects) {
    assertJiraProjectAllowed(project, cfg, `JQL project ${project}`);
  }
}

function assertCustomFieldsAllowed(customFields: Record<string, unknown>, cfg: GuardrailsConfig): void {
  const keys = Object.keys(customFields);
  if (keys.length === 0) return;

  if (cfg.allowedJiraCustomFields) {
    for (const key of keys) {
      if (!cfg.allowedJiraCustomFields.has(key)) {
        throw new Error(`customFields.${key} is outside JCMCP_ALLOWED_JIRA_CUSTOM_FIELDS`);
      }
    }
    return;
  }

  if (!cfg.allowCustomFields) {
    throw new Error("customFields are disabled. Set JCMCP_ALLOW_JIRA_CUSTOM_FIELDS=true or JCMCP_ALLOWED_JIRA_CUSTOM_FIELDS.");
  }
}

function assertConfluenceSpaceAllowed(space: string | undefined, cfg: GuardrailsConfig, context: string): void {
  if (!cfg.allowedConfluenceSpaces || cfg.allowedConfluenceSpaces.size === 0) return;
  if (!space) {
    throw new Error(`${context} cannot be verified against JCMCP_ALLOWED_CONFLUENCE_SPACES`);
  }
  if (!cfg.allowedConfluenceSpaces.has(space)) {
    throw new Error(`${context} is outside JCMCP_ALLOWED_CONFLUENCE_SPACES`);
  }
}

function spacesFromCql(cql: string): string[] {
  const spaces = new Set<string>();
  for (const match of cql.matchAll(/\bspace\s*=\s*"?([A-Z0-9_-]+)"?/gi)) {
    spaces.add(match[1]);
  }
  for (const match of cql.matchAll(/\bspace\s+in\s*\(([^)]*)\)/gi)) {
    for (const raw of match[1].split(",")) {
      const space = raw.trim().replace(/^["']|["']$/g, "");
      if (/^[A-Z0-9_-]+$/i.test(space)) spaces.add(space);
    }
  }
  return [...spaces];
}

export function assertToolCallAllowed(tool: ToolDef, args: Record<string, any>, cfg: GuardrailsConfig): void {
  const reason = hiddenReason(tool, cfg);
  if (reason) throw new Error(`Tool ${tool.name} is not available: ${reason}`);

  if (tool.name.startsWith("jira_")) {
    if (args.projectKey) assertJiraProjectAllowed(args.projectKey, cfg, `projectKey ${args.projectKey}`);
    if (args.projectId !== undefined && !args.projectKey) {
      assertJiraProjectAllowed(undefined, cfg, `projectId ${args.projectId}`);
    }
    if (args.projectKeyOrId) {
      const value = String(args.projectKeyOrId);
      assertJiraProjectAllowed(/^\d+$/.test(value) ? undefined : value, cfg, `projectKeyOrId ${value}`);
    }
    for (const key of ["issueKey", "parentKey", "inwardKey", "outwardKey"]) {
      if (args[key]) assertJiraProjectAllowed(issueProjectKey(String(args[key])), cfg, `${key} ${args[key]}`);
    }
    if (args.issueKeys) {
      for (const issueKey of args.issueKeys) {
        assertJiraProjectAllowed(issueProjectKey(String(issueKey)), cfg, `issueKey ${issueKey}`);
      }
    }
    if (args.jql) assertJqlAllowed(args.jql, cfg);
    if (args.customFields) assertCustomFieldsAllowed(args.customFields, cfg);
  }

  if (tool.name.startsWith("confluence_")) {
    if (args.spaceId) assertConfluenceSpaceAllowed(String(args.spaceId), cfg, `spaceId ${args.spaceId}`);
    if (args.cql) {
      const spaces = spacesFromCql(args.cql);
      if (cfg.allowedConfluenceSpaces && spaces.length === 0) {
        throw new Error("CQL must include an explicit space filter when JCMCP_ALLOWED_CONFLUENCE_SPACES is set");
      }
      for (const space of spaces) assertConfluenceSpaceAllowed(space, cfg, `CQL space ${space}`);
    }
  }
}
