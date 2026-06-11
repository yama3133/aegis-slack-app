/**
 * Demo: an autonomous Bedrock-powered agent that must obtain human approval
 * through the Aegis MCP server before executing high-risk actions.
 *
 * Flow: Bedrock (Claude Sonnet 4.6) <-tool use-> MCP client -> Aegis MCP server
 *       -> Slack approval card -> human decision -> agent proceeds or aborts.
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type Tool,
  type ToolResultBlock,
} from "@aws-sdk/client-bedrock-runtime";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const MODEL_ID = process.env.AEGIS_DEMO_MODEL ?? "us.anthropic.claude-sonnet-4-6";
const REGION = process.env.AEGIS_DEMO_REGION ?? "us-east-1";
const MAX_TURNS = 15;

const TASK =
  process.argv.slice(2).join(" ") ||
  "Issue a refund of 1200 USD to ACME Corp for order ORD-4413. The customer reported a duplicate charge.";

const SYSTEM_PROMPT = `You are ops-agent, an autonomous operations agent.

Safety policy (non-negotiable):
- Before ANY high-risk action (refunds, deletions, external messages, anything financial or destructive), you MUST call request_approval with a clear action name, the exact arguments, a risk level, and your reasoning.
- After requesting approval, call wait_for_approval until you get a terminal status. If it times out while still pending, call wait_for_approval again.
- If approved with edited arguments, you MUST use the returned arguments instead of your original ones.
- If denied, do NOT perform the action. Acknowledge the denial and stop.
- If the request expires (status "expired"), treat it as a denial: do NOT perform the action.
- request_approval may return status "approved" immediately when policy auto-approves low-risk actions; in that case proceed without waiting.
- You do not have real payment systems connected; once approved, simulate the execution and report the outcome clearly.

Keep your visible commentary brief and factual.`;

// --- MCP client setup -------------------------------------------------------

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "src/mcp-server.ts"],
  cwd: new URL("..", import.meta.url).pathname,
  env: { ...process.env } as Record<string, string>,
});
const mcp = new Client({ name: "ops-agent", version: "0.1.0" });
await mcp.connect(transport);

const mcpTools = await mcp.listTools();
const tools: Tool[] = mcpTools.tools.map((t) => ({
  toolSpec: {
    name: t.name,
    description: t.description,
    inputSchema: { json: t.inputSchema as Record<string, unknown> },
  },
}));
console.log(`[mcp] connected. tools: ${mcpTools.tools.map((t) => t.name).join(", ")}`);

// --- Agent loop -------------------------------------------------------------

const bedrock = new BedrockRuntimeClient({ region: REGION });
const messages: Message[] = [{ role: "user", content: [{ text: TASK }] }];

console.log(`\n[task] ${TASK}\n`);

for (let turn = 0; turn < MAX_TURNS; turn++) {
  const res = await bedrock.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: SYSTEM_PROMPT }],
      messages,
      toolConfig: { tools },
      inferenceConfig: { maxTokens: 2048 },
    }),
  );

  const output = res.output?.message;
  if (!output) throw new Error("empty model output");
  messages.push(output);

  for (const block of output.content ?? []) {
    if (block.text) console.log(`[agent] ${block.text}`);
  }

  if (res.stopReason !== "tool_use") {
    console.log(`\n[done] stopReason=${res.stopReason}`);
    break;
  }

  const toolResults: ToolResultBlock[] = [];
  for (const block of output.content ?? []) {
    if (!block.toolUse) continue;
    const { name, input, toolUseId } = block.toolUse;
    console.log(`[tool->] ${name} ${JSON.stringify(input)}`);
    const result = await mcp.callTool({
      name: name!,
      arguments: input as Record<string, unknown>,
    });
    const text = (result.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    console.log(`[<-tool] ${text}`);
    toolResults.push({
      toolUseId: toolUseId!,
      content: [{ text }],
    });
  }
  messages.push({
    role: "user",
    content: toolResults.map((tr) => ({ toolResult: tr })),
  });
}

await mcp.close();
