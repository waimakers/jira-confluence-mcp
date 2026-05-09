// Spawn the MCP server, send initialize + tools/list + tools/call over stdio.
// Env vars must be set in the parent process (no .env file).
// Run with:
//   ATLASSIAN_BASE_URL=... ATLASSIAN_EMAIL=... ATLASSIAN_API_TOKEN=... node test-stdio.mjs
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
      try {
        responses.push(JSON.parse(line));
      } catch {
        console.error("non-json line:", line);
      }
    }
  }
});
child.stderr.on("data", (d) => process.stderr.write(`[mcp] ${d}`));

const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } },
});
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "jira_myself", arguments: {} } });

await new Promise((r) => setTimeout(r, 4000));

const initResp = responses.find((r) => r.id === 1);
const listResp = responses.find((r) => r.id === 2);
const callResp = responses.find((r) => r.id === 3);

console.log("\n─── initialize ───");
console.log("server:", initResp?.result?.serverInfo);
console.log("\n─── tools/list ───");
const tools = listResp?.result?.tools ?? [];
console.log(`tool count: ${tools.length}`);
for (const t of tools) console.log(`  • ${t.name.padEnd(28)} ${t.description.slice(0, 70)}${t.description.length > 70 ? "…" : ""}`);
console.log("\n─── tools/call jira_myself ───");
const text = callResp?.result?.content?.[0]?.text ?? JSON.stringify(callResp);
const parsed = (() => { try { return JSON.parse(text); } catch { return text; } })();
if (parsed && typeof parsed === "object") {
  console.log("displayName:", parsed.displayName);
  console.log("emailAddress:", parsed.emailAddress);
  console.log("accountId:", parsed.accountId);
} else {
  console.log(text);
}

child.kill();
process.exit(0);
