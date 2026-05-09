// Quick smoke test: verifies auth + lists projects + lists spaces.
// Run with: node dist/smoke.js  (after `npm run build`)
import { AtlassianClient, loadConfig } from "./atlassian-client.js";

async function main() {
  const cfg = loadConfig();
  const client = new AtlassianClient(cfg);

  console.log(`→ baseUrl: ${cfg.baseUrl}`);
  console.log(`→ email:   ${cfg.email}`);
  console.log(`→ token:   ${cfg.apiToken.slice(0, 6)}...${cfg.apiToken.slice(-4)} (${cfg.apiToken.length} chars)`);
  console.log("");

  // 1. Auth sanity check
  console.log("[1/3] GET /rest/api/3/myself ...");
  const me = (await client.get("/rest/api/3/myself")) as { displayName?: string; emailAddress?: string; accountId?: string };
  console.log(`     ✓ ${me.displayName} <${me.emailAddress}>  accountId=${me.accountId}`);
  console.log("");

  // 2. List Jira projects
  console.log("[2/3] GET /rest/api/3/project/search?maxResults=10 ...");
  const projects = (await client.get("/rest/api/3/project/search", { maxResults: 10 })) as {
    total?: number;
    values?: Array<{ key: string; name: string }>;
  };
  console.log(`     ✓ ${projects.total ?? projects.values?.length ?? 0} projects total. First few:`);
  for (const p of (projects.values ?? []).slice(0, 10)) {
    console.log(`        - ${p.key.padEnd(10)} ${p.name}`);
  }
  console.log("");

  // 3. List Confluence spaces
  console.log("[3/3] GET /wiki/api/v2/spaces?limit=10 ...");
  try {
    const spaces = (await client.get("/wiki/api/v2/spaces", { limit: 10 })) as {
      results?: Array<{ id: string; key: string; name: string }>;
    };
    console.log(`     ✓ ${spaces.results?.length ?? 0} Confluence spaces returned. First few:`);
    for (const s of (spaces.results ?? []).slice(0, 10)) {
      console.log(`        - ${s.key.padEnd(10)} ${s.name}  (id=${s.id})`);
    }
  } catch (err) {
    console.log(`     ⚠ Confluence call failed (your token may not have Confluence access): ${(err as Error).message}`);
  }

  console.log("");
  console.log("✓ Smoke test complete.");
}

main().catch((err) => {
  console.error("");
  console.error("✗ Smoke test FAILED:");
  console.error(err);
  process.exit(1);
});
