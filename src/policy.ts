import { existsSync, readFileSync } from "node:fs";
import type { RiskLevel } from "./types.js";

export interface PolicyConfig {
  /** Auto-approve without a human when risk and amount are both low. */
  autoApprove: { enabled: boolean; maxAmountUsd: number; risks: RiskLevel[] };
  /** Require N approvals for critical or expensive actions. */
  multiApprove: { minAmountUsd: number; risks: RiskLevel[]; approvalsRequired: number };
  /** Pending requests expire after this many seconds. */
  ttlSeconds: number;
}

export const DEFAULT_POLICY: PolicyConfig = {
  autoApprove: { enabled: true, maxAmountUsd: 100, risks: ["low"] },
  multiApprove: { minAmountUsd: 5000, risks: ["critical"], approvalsRequired: 2 },
  ttlSeconds: 15 * 60,
};

export function loadPolicy(): PolicyConfig {
  const file = process.env.AEGIS_POLICY_FILE ?? new URL("../aegis.policy.json", import.meta.url).pathname;
  let policy = DEFAULT_POLICY;
  if (existsSync(file)) {
    policy = { ...DEFAULT_POLICY, ...JSON.parse(readFileSync(file, "utf8")) };
  }
  if (process.env.AEGIS_TTL_SECONDS) {
    policy = { ...policy, ttlSeconds: Number(process.env.AEGIS_TTL_SECONDS) };
  }
  return policy;
}

/** Best-effort extraction of a USD amount from action arguments. */
export function amountOf(args: Record<string, unknown>): number | undefined {
  for (const key of ["amount_usd", "amountUsd", "amount", "total_usd", "total"]) {
    const v = args[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

export type PolicyDecision =
  | { decision: "auto_approve"; reason: string }
  | { decision: "human"; approvalsRequired: number; reason: string };

export function evaluate(
  policy: PolicyConfig,
  input: { risk: RiskLevel; args: Record<string, unknown> },
): PolicyDecision {
  const amount = amountOf(input.args);

  const multi = policy.multiApprove;
  if (multi.risks.includes(input.risk) || (amount !== undefined && amount >= multi.minAmountUsd)) {
    return {
      decision: "human",
      approvalsRequired: multi.approvalsRequired,
      reason: multi.risks.includes(input.risk)
        ? `risk=${input.risk} requires ${multi.approvalsRequired} approvals`
        : `amount $${amount} >= $${multi.minAmountUsd} requires ${multi.approvalsRequired} approvals`,
    };
  }

  const auto = policy.autoApprove;
  if (
    auto.enabled &&
    auto.risks.includes(input.risk) &&
    amount !== undefined &&
    amount <= auto.maxAmountUsd
  ) {
    return {
      decision: "auto_approve",
      reason: `risk=${input.risk} and amount $${amount} <= $${auto.maxAmountUsd}`,
    };
  }

  return { decision: "human", approvalsRequired: 1, reason: "default: one human approval" };
}
