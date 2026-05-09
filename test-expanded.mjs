// Exercise several new tools against the live API to confirm they work.
import { spawn } from "node:child_process";

const child = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "pipe"] });

let buf = "";
const responses = [];
child.stdout.on("data", (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) {
      try { responses.push(JSON.parse(line)); } catch { /* ignore */ }
    }
  }
});
child.stderr.on("data", (d) => process.stderr.write(`[mcp] ${d}`));

const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");

send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
send({ jsonrpc: "2.0", method: "notifications/initialized" });

const calls = [
  { id: 10, name: "jira_list_link_types", args: {} },
  { id: 11, name: "jira_list_priorities", args: {} },
  { id: 12, name: "jira_list_boards", args: { maxResults: 5 } },
  { id: 13, name: "jira_search_issues", args: { jql: "project = PMK ORDER BY updated DESC", maxResults: 3 } },
  { id: 15, name: "jira_search_issues_count", args: { jql: "project = PMK" } },
  { id: 14, name: "confluence_list_spaces", args: { limit: 5 } },
];
for (const c of calls) send({ jsonrpc: "2.0", id: c.id, method: "tools/call", params: { name: c.name, arguments: c.args } });

await new Promise((r) => setTimeout(r, 6000));

for (const c of calls) {
  const r = responses.find((x) => x.id === c.id);
  const text = r?.result?.content?.[0]?.text;
  const isError = r?.result?.isError;
  if (!text) { console.log(`✗ ${c.name}: no response`); continue; }
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (isError) { console.log(`✗ ${c.name}: ${text.slice(0, 200)}`); continue; }

  // Compact summary per tool
  if (c.name === "jira_list_link_types") {
    const types = (parsed.issueLinkTypes ?? []).map((t) => t.name).join(", ");
    console.log(`✓ jira_list_link_types          → ${types}`);
  } else if (c.name === "jira_list_priorities") {
    const names = (Array.isArray(parsed) ? parsed : []).map((p) => p.name).join(", ");
    console.log(`✓ jira_list_priorities          → ${names}`);
  } else if (c.name === "jira_list_boards") {
    const boards = (parsed.values ?? []).map((b) => `${b.id}:${b.name}(${b.type})`).join(", ");
    console.log(`✓ jira_list_boards              → total=${parsed.total ?? "?"} ${boards || "(none)"}`);
  } else if (c.name === "jira_search_issues") {
    const issues = (parsed.issues ?? []).map((i) => `${i.key}: ${i.fields?.summary ?? "?"}`.slice(0, 70));
    console.log(`✓ jira_search_issues            → returned=${issues.length} isLast=${parsed.isLast ?? "?"}`);
    for (const i of issues) console.log(`     ${i}`);
  } else if (c.name === "jira_search_issues_count") {
    console.log(`✓ jira_search_issues_count      → count=${parsed.count ?? parsed}`);
  } else if (c.name === "confluence_list_spaces") {
    const sp = (parsed.results ?? []).map((s) => `${s.key}:${s.name}`).join(", ");
    console.log(`✓ confluence_list_spaces        → ${sp}`);
  }
}

child.kill();
process.exit(0);
