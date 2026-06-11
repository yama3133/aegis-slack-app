export type RiskLevel = "low" | "medium" | "high" | "critical";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "info_requested"
  | "expired";

export interface ApprovalRequest {
  id: string;
  agent: string;
  action: string;
  args: Record<string, unknown>;
  risk: RiskLevel;
  reason?: string;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNote?: string;
  /** Slack message that hosts the approval card */
  channel?: string;
  ts?: string;
  /** Policy engine fields */
  approvalsRequired: number;
  approvers: string[];
  expiresAt?: string;
  autoApproved?: boolean;
  policyReason?: string;
  /** Context enrichment (best-effort) */
  summary?: string;
  related?: RelatedMessage[];
}

export interface RelatedMessage {
  content: string;
  permalink?: string;
  author?: string;
}

export interface AuditEntry {
  at: string;
  requestId: string;
  event: string;
  actor: string;
  detail?: string;
}
