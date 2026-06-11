import type { WebClient } from "@slack/web-api";
import { store } from "./store.js";
import { approvalCard } from "./blocks.js";
import { loadPolicy, evaluate } from "./policy.js";
import { searchContext } from "./context.js";
import { summarizeAction } from "./summarize.js";
import type { ApprovalRequest, RiskLevel } from "./types.js";

export interface ApprovalInput {
  agent: string;
  action: string;
  args: Record<string, unknown>;
  risk: RiskLevel;
  reason?: string;
}

/**
 * Create an approval request, run it through the policy engine, post its card
 * to Slack, and persist where it lives. May resolve immediately (auto-approve).
 */
export async function postApprovalRequest(
  client: WebClient,
  input: ApprovalInput,
  channel: string,
): Promise<ApprovalRequest> {
  const policy = loadPolicy();
  const verdict = evaluate(policy, { risk: input.risk, args: input.args });

  // Best-effort enrichment: plain-language summary + related Slack context.
  const contextQuery = [
    input.action.replace(/_/g, " "),
    ...Object.values(input.args).filter((v): v is string => typeof v === "string"),
  ].join(" ");
  const [summary, related] = await Promise.all([
    summarizeAction(input).catch(() => undefined),
    searchContext(client, contextQuery).catch((e) => {
      console.error("[rts] search failed:", (e as Error).message);
      return [];
    }),
  ]);

  let req: ApprovalRequest;
  if (verdict.decision === "auto_approve") {
    req = store.create({
      ...input,
      channel,
      summary,
      related,
      status: "approved",
      approvalsRequired: 0,
      autoApproved: true,
      policyReason: verdict.reason,
    });
    store.update(req.id, {
      resolvedAt: new Date().toISOString(),
      resolvedBy: "aegis:policy",
      resolutionNote: `Auto-approved by policy (${verdict.reason}).`,
    });
  } else {
    req = store.create({
      ...input,
      channel,
      summary,
      related,
      approvalsRequired: verdict.approvalsRequired,
      policyReason: verdict.reason,
      expiresAt: new Date(Date.now() + policy.ttlSeconds * 1000).toISOString(),
    });
  }

  const fresh = store.get(req.id)!;
  const res = await client.chat.postMessage({
    channel,
    text: `Approval request #${fresh.id}: ${fresh.action} (${fresh.risk}) — ${fresh.status}`,
    blocks: approvalCard(fresh),
  });
  const updated = store.update(req.id, { ts: res.ts as string })!;

  store.audit({ requestId: req.id, event: "requested", actor: input.agent, detail: input.action });
  if (updated.autoApproved) {
    store.audit({ requestId: req.id, event: "auto_approved", actor: "aegis:policy", detail: verdict.reason });
  }
  return updated;
}
