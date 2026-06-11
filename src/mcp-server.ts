import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebClient } from "@slack/web-api";
import { z } from "zod";
import { store } from "./store.js";
import { postApprovalRequest } from "./approvals.js";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
const DEFAULT_CHANNEL = process.env.AEGIS_DEFAULT_CHANNEL ?? "";

const server = new McpServer({ name: "aegis", version: "0.1.0" });

function text(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

server.registerTool(
  "request_approval",
  {
    title: "Request human approval",
    description:
      "Request human approval in Slack before executing a high-risk action. " +
      "Posts an approval card to the configured Slack channel where a human can approve, deny, " +
      "edit the arguments, or ask for more information. Returns the request id immediately; " +
      "use wait_for_approval or check_approval to learn the outcome. " +
      "ALWAYS call this before destructive, financial, or externally visible actions.",
    inputSchema: {
      agent: z.string().describe("Name of the requesting agent, e.g. 'ops-agent'"),
      action: z.string().describe("Machine-readable action name, e.g. 'issue_refund'"),
      args: z.record(z.string(), z.unknown()).describe("Arguments of the action as a JSON object"),
      risk: z.enum(["low", "medium", "high", "critical"]).describe("Risk level of the action"),
      reason: z.string().optional().describe("Why the agent wants to perform this action"),
    },
  },
  async ({ agent, action, args, risk, reason }) => {
    if (!DEFAULT_CHANNEL) {
      return text({ error: "AEGIS_DEFAULT_CHANNEL is not configured" });
    }
    const req = await postApprovalRequest(
      slack,
      { agent, action, args: args as Record<string, unknown>, risk, reason },
      DEFAULT_CHANNEL,
    );
    return text({
      request_id: req.id,
      status: req.status,
      auto_approved: req.autoApproved ?? false,
      approvals_required: req.approvalsRequired,
      expires_at: req.expiresAt,
      policy: req.policyReason,
    });
  },
);

server.registerTool(
  "check_approval",
  {
    title: "Check approval status",
    description:
      "Check the current status of an approval request. Returns status " +
      "(pending | approved | denied | info_requested | expired), resolver, and possibly edited arguments. " +
      "If approved with edited arguments, you MUST use the returned args instead of your original ones.",
    inputSchema: {
      request_id: z.string().describe("Id returned by request_approval"),
    },
  },
  async ({ request_id }) => {
    const req = store.expireIfNeeded(request_id);
    if (!req) return text({ error: `No approval request with id ${request_id}` });
    return text({
      request_id: req.id,
      status: req.status,
      args: req.args,
      resolved_by: req.resolvedBy,
      resolved_at: req.resolvedAt,
      note: req.resolutionNote,
    });
  },
);

server.registerTool(
  "wait_for_approval",
  {
    title: "Wait for approval decision",
    description:
      "Block until the approval request is resolved by a human, or until timeout_seconds elapses " +
      "(max 55). Returns the same payload as check_approval. If still pending after the timeout, " +
      "you may call this again to keep waiting.",
    inputSchema: {
      request_id: z.string().describe("Id returned by request_approval"),
      timeout_seconds: z.number().min(1).max(55).default(55).describe("How long to wait"),
    },
  },
  async ({ request_id, timeout_seconds }) => {
    const deadline = Date.now() + timeout_seconds * 1000;
    while (Date.now() < deadline) {
      const req = store.expireIfNeeded(request_id);
      if (!req) return text({ error: `No approval request with id ${request_id}` });
      if (req.status !== "pending" && req.status !== "info_requested") {
        return text({
          request_id: req.id,
          status: req.status,
          args: req.args,
          resolved_by: req.resolvedBy,
          resolved_at: req.resolvedAt,
          note: req.resolutionNote,
        });
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    const req = store.get(request_id)!;
    return text({ request_id: req.id, status: req.status, timed_out: true });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Aegis MCP server ready (stdio)");
