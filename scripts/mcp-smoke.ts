import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "src/mcp-server.ts"],
  cwd: new URL("..", import.meta.url).pathname,
  env: { ...process.env } as Record<string, string>,
});

const client = new Client({ name: "aegis-smoke", version: "0.0.1" });
await client.connect(transport);

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

const res = await client.callTool({
  name: "request_approval",
  arguments: {
    agent: "smoke-agent",
    action: "drop_production_table",
    args: { table: "orders", database: "prod-main" },
    risk: "critical",
    reason: "Smoke test of the Aegis MCP server.",
  },
});
const payload = JSON.parse((res.content as Array<{ type: string; text: string }>)[0].text);
console.log("request_approval ->", payload);

const wait = await client.callTool({
  name: "wait_for_approval",
  arguments: { request_id: payload.request_id, timeout_seconds: 40 },
});
console.log("wait_for_approval ->", (wait.content as Array<{ type: string; text: string }>)[0].text);

await client.close();
