import "dotenv/config";
import { WebClient } from "@slack/web-api";
import { postApprovalRequest, type ApprovalInput } from "../src/approvals.js";

const channel = process.argv[2];
const scenario = process.argv[3] ?? "refund-large";
if (!channel) {
  console.error("usage: tsx scripts/post-demo.ts <channel-id> [refund-small|refund-large|drop-table]");
  process.exit(1);
}

const SCENARIOS: Record<string, ApprovalInput> = {
  "refund-small": {
    agent: "ops-agent",
    action: "issue_refund",
    args: { customer: "Beta LLC", amount_usd: 45, order: "ORD-9921" },
    risk: "low",
    reason: "Small goodwill refund for late delivery.",
  },
  "refund-large": {
    agent: "ops-agent",
    action: "issue_refund",
    args: { customer: "ACME Corp", amount_usd: 1200, order: "ORD-4413" },
    risk: "high",
    reason: "Customer reported duplicate charge on order ORD-4413.",
  },
  "refund-edit": {
    agent: "ops-agent",
    action: "issue_refund",
    args: { customer: "Globex Inc", amount_usd: 1200, order: "ORD-7782" },
    risk: "high",
    reason: "Possible duplicate charge flagged on ORD-7782; amount to be verified.",
  },
  "drop-table": {
    agent: "infra-agent",
    action: "drop_production_table",
    args: { table: "orders", database: "prod-main" },
    risk: "critical",
    reason: "Cleanup of deprecated table requested in migration plan.",
  },
};

const input = SCENARIOS[scenario];
if (!input) {
  console.error(`unknown scenario: ${scenario}`);
  process.exit(1);
}

const client = new WebClient(process.env.SLACK_BOT_TOKEN);
const req = await postApprovalRequest(client, input, channel);
console.log(
  `posted #${req.id} (${scenario}) status=${req.status} approvalsRequired=${req.approvalsRequired} expiresAt=${req.expiresAt ?? "-"}`,
);
