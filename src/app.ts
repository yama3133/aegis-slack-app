import "dotenv/config";
import bolt from "@slack/bolt";
import { store } from "./store.js";
import { approvalCard, editModal } from "./blocks.js";
import { postApprovalRequest } from "./approvals.js";
import { loadPolicy } from "./policy.js";
import { cacheActionToken } from "./context.js";
import type { ApprovalRequest } from "./types.js";

const { App, LogLevel } = bolt;

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.INFO,
});

async function refreshCard(req: ApprovalRequest): Promise<void> {
  if (!req.channel || !req.ts) return;
  await app.client.chat.update({
    channel: req.channel,
    ts: req.ts,
    text: `Approval request #${req.id}: ${req.status}`,
    blocks: approvalCard(req),
  });
}

// --- /aegis command -------------------------------------------------------

app.command("/aegis", async ({ ack, respond, command }) => {
  await ack();
  const [sub] = command.text.trim().split(/\s+/);

  if (sub === "demo") {
    await postApprovalRequest(
      app.client,
      {
        agent: "ops-agent",
        action: "issue_refund",
        args: { customer: "ACME Corp", amount_usd: 1200, order: "ORD-4413" },
        risk: "high",
        reason: "Customer reported duplicate charge on order ORD-4413.",
      },
      command.channel_id,
    );
    await respond({ response_type: "ephemeral", text: "Demo approval request posted." });
    return;
  }

  if (sub === "pending") {
    const pending = store.list().filter((r) => r.status === "pending");
    await respond({
      response_type: "ephemeral",
      text: pending.length
        ? `Pending requests: ${pending.map((r) => `#${r.id} ${r.action}`).join(", ")}`
        : "No pending requests.",
    });
    return;
  }

  if (sub === "policy") {
    const policy = loadPolicy();
    await respond({
      response_type: "ephemeral",
      text: "Current policy:\n```" + JSON.stringify(policy, null, 2) + "```",
    });
    return;
  }

  if (sub === "audit") {
    const tail = store.auditLog().slice(-10);
    await respond({
      response_type: "ephemeral",
      text: tail.length
        ? "```" + tail.map((e) => `${e.at} ${e.event} #${e.requestId} by ${e.actor}${e.detail ? ` — ${e.detail}` : ""}`).join("\n") + "```"
        : "Audit log is empty.",
    });
    return;
  }

  await respond({
    response_type: "ephemeral",
    text: "Usage: `/aegis demo` | `/aegis pending` | `/aegis policy` | `/aegis audit`",
  });
});

// --- Button handlers ------------------------------------------------------

app.action("aegis_approve", async ({ ack, body, action, respond }) => {
  await ack();
  const id = (action as { value: string }).value;
  const userId = body.user.id;
  let req = store.expireIfNeeded(id);
  if (!req) return;
  if (req.status !== "pending") {
    await refreshCard(req);
    return;
  }
  if (req.approvers.includes(userId)) {
    await respond({
      response_type: "ephemeral",
      replace_original: false,
      text: `You already approved #${id}. ${req.approvalsRequired - req.approvers.length} more approval(s) needed from someone else.`,
    });
    return;
  }

  const approvers = [...req.approvers, userId];
  if (approvers.length >= req.approvalsRequired) {
    req = store.update(id, {
      approvers,
      status: "approved",
      resolvedAt: new Date().toISOString(),
      resolvedBy: userId,
    })!;
    store.audit({ requestId: id, event: "approved", actor: userId, detail: `${approvers.length}/${req.approvalsRequired}` });
  } else {
    req = store.update(id, { approvers })!;
    store.audit({
      requestId: id,
      event: "approval_progress",
      actor: userId,
      detail: `${approvers.length}/${req.approvalsRequired}`,
    });
  }
  await refreshCard(req);
});

app.action("aegis_deny", async ({ ack, body, action }) => {
  await ack();
  const id = (action as { value: string }).value;
  const userId = body.user.id;
  const req = store.update(id, {
    status: "denied",
    resolvedAt: new Date().toISOString(),
    resolvedBy: userId,
  });
  if (!req) return;
  store.audit({ requestId: id, event: "denied", actor: userId });
  await refreshCard(req);
});

app.action("aegis_edit", async ({ ack, body, action, client }) => {
  await ack();
  const id = (action as { value: string }).value;
  const req = store.get(id);
  if (!req || req.status !== "pending") return;
  await client.views.open({
    trigger_id: (body as { trigger_id: string }).trigger_id,
    view: editModal(req),
  });
});

app.view("aegis_edit_modal", async ({ ack, body, view }) => {
  const id = view.private_metadata;
  const raw = view.state.values.args_block.args_input.value ?? "{}";
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await ack({
      response_action: "errors",
      errors: { args_block: "Invalid JSON — please fix and resubmit." },
    });
    return;
  }
  await ack();
  const userId = body.user.id;
  const req = store.update(id, {
    args: parsed,
    status: "approved",
    resolvedAt: new Date().toISOString(),
    resolvedBy: userId,
    resolutionNote: "Arguments edited before approval.",
  });
  if (!req) return;
  store.audit({ requestId: id, event: "edited_and_approved", actor: userId, detail: raw });
  await refreshCard(req);
});

app.action("aegis_info", async ({ ack, body, action, client }) => {
  await ack();
  const id = (action as { value: string }).value;
  const userId = body.user.id;
  const req = store.update(id, { status: "info_requested" });
  if (!req) return;
  store.audit({ requestId: id, event: "info_requested", actor: userId });
  await refreshCard(req);
  if (req.channel && req.ts) {
    await client.chat.postMessage({
      channel: req.channel,
      thread_ts: req.ts,
      text: `<@${userId}> requested more information from *${req.agent}* about request #${req.id}. The agent will reply in this thread.`,
    });
  }
});

// --- Misc -----------------------------------------------------------------

function extractActionToken(event: unknown): string | undefined {
  const e = event as { action_token?: string; assistant_thread?: { action_token?: string } };
  return e.action_token ?? e.assistant_thread?.action_token;
}

app.event("app_mention", async ({ event, say }) => {
  const actionToken = extractActionToken(event);
  if (actionToken) cacheActionToken(actionToken);
  await say({
    thread_ts: event.ts,
    text: "Aegis here — the human-approval control plane for AI agents. Try `/aegis demo`.",
  });
});

// Channel messages carry the action_token needed by the Real-time Search API
// (delivered as assistant_thread.action_token on AI-enabled workspaces).
app.event("message", async ({ event }) => {
  if (process.env.AEGIS_DEBUG_EVENTS) {
    console.error("[event:message]", JSON.stringify(event).slice(0, 600));
  }
  const actionToken = extractActionToken(event);
  if (actionToken) cacheActionToken(actionToken);
});

// --- TTL sweep: expire overdue requests and refresh their cards ------------

setInterval(async () => {
  const overdue = store
    .list()
    .filter(
      (r) =>
        (r.status === "pending" || r.status === "info_requested") &&
        r.expiresAt &&
        Date.parse(r.expiresAt) < Date.now(),
    );
  for (const r of overdue) {
    const updated = store.expireIfNeeded(r.id);
    if (updated && updated.status === "expired") {
      try {
        await refreshCard(updated);
      } catch (e) {
        console.error(`failed to refresh expired card #${r.id}`, e);
      }
    }
  }
}, 10_000);

await app.start();
if (process.env.AEGIS_DEFAULT_CHANNEL) {
  try {
    await app.client.conversations.join({ channel: process.env.AEGIS_DEFAULT_CHANNEL });
  } catch (e) {
    console.error("conversations.join failed:", (e as Error).message);
  }
}
console.log("⚡ Aegis (Socket Mode) is running");
