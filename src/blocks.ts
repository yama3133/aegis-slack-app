import type { KnownBlock } from "@slack/types";
import type { ApprovalRequest, RiskLevel } from "./types.js";

const RISK_LABEL: Record<RiskLevel, string> = {
  low: "🟢 Low",
  medium: "🟡 Medium",
  high: "🟠 High",
  critical: "🔴 Critical",
};

const STATUS_LABEL: Record<string, string> = {
  approved: "✅ Approved",
  denied: "❌ Denied",
  info_requested: "❓ More info requested",
  expired: "⏰ Expired",
};

export function approvalCard(req: ApprovalRequest): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `🛡️ Approval Request #${req.id}`, emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Agent:*\n${req.agent}` },
        { type: "mrkdwn", text: `*Risk:*\n${RISK_LABEL[req.risk]}` },
        { type: "mrkdwn", text: `*Action:*\n\`${req.action}\`` },
        { type: "mrkdwn", text: `*Requested:*\n<!date^${Math.floor(Date.parse(req.createdAt) / 1000)}^{date_short_pretty} {time}|${req.createdAt}>` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Arguments:*\n```" + JSON.stringify(req.args, null, 2) + "```",
      },
    },
  ];

  if (req.summary) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `📋 *In plain language:* ${req.summary}` },
    });
  }

  if (req.reason) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `💬 Agent's reasoning: ${req.reason}` }],
    });
  }

  if (req.related && req.related.length) {
    const lines = req.related
      .map((r) => {
        const label = `${r.author ? r.author + ": " : ""}${r.content}`;
        return r.permalink ? `• <${r.permalink}|${label.replace(/[<>|]/g, " ")}>` : `• ${label}`;
      })
      .join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `🔎 *Related context in Slack:*\n${lines}` },
    });
  }

  const policyBits: string[] = [];
  if (req.policyReason) policyBits.push(`⚖️ Policy: ${req.policyReason}`);
  if (req.status === "pending" && req.approvalsRequired > 1) {
    const who = req.approvers.map((u) => `<@${u}>`).join(", ");
    policyBits.push(`✍️ Approvals: ${req.approvers.length}/${req.approvalsRequired}${who ? ` (${who})` : ""}`);
  }
  if (req.status === "pending" && req.expiresAt) {
    policyBits.push(
      `⏳ Expires <!date^${Math.floor(Date.parse(req.expiresAt) / 1000)}^{time}|${req.expiresAt}>`,
    );
  }
  if (policyBits.length) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: policyBits.join("   •   ") }],
    });
  }

  if (req.status === "pending") {
    blocks.push({
      type: "actions",
      block_id: `aegis_actions_${req.id}`,
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "✅ Approve", emoji: true },
          action_id: "aegis_approve",
          value: req.id,
        },
        {
          type: "button",
          style: "danger",
          text: { type: "plain_text", text: "❌ Deny", emoji: true },
          action_id: "aegis_deny",
          value: req.id,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "✏️ Edit & Approve", emoji: true },
          action_id: "aegis_edit",
          value: req.id,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "❓ Request Info", emoji: true },
          action_id: "aegis_info",
          value: req.id,
        },
      ],
    });
  } else {
    const who = req.autoApproved
      ? " 🤖 by policy"
      : req.resolvedBy
        ? ` by <@${req.resolvedBy}>`
        : "";
    const note = req.resolutionNote ? `\n>${req.resolutionNote}` : "";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${STATUS_LABEL[req.status] ?? req.status}${who}${note}`,
      },
    });
  }

  return blocks;
}

export function editModal(req: ApprovalRequest): import("@slack/types").ModalView {
  return {
    type: "modal",
    callback_id: "aegis_edit_modal",
    private_metadata: req.id,
    title: { type: "plain_text", text: `Edit #${req.id}` },
    submit: { type: "plain_text", text: "Approve edited" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "args_block",
        label: { type: "plain_text", text: "Arguments (JSON)" },
        element: {
          type: "plain_text_input",
          action_id: "args_input",
          multiline: true,
          initial_value: JSON.stringify(req.args, null, 2),
        },
      },
    ],
  };
}
