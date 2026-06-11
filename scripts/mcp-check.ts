import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "src/mcp-server.ts"],
  cwd: process.cwd(),
  env: { ...process.env } as Record<string, string>,
});
const client = new Client({ name: "check", version: "0.0.1" });
await client.connect(transport);
const res = await client.callTool({ name: "check_approval", arguments: { request_id: "22bdd93d" } });
console.log((res.content as Array<{ text: string }>)[0].text);
await client.close();
