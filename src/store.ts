import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { ApprovalRequest, AuditEntry } from "./types.js";

const DATA_DIR = new URL("../data/", import.meta.url).pathname;
const REQ_FILE = DATA_DIR + "approvals.json";
const AUDIT_FILE = DATA_DIR + "audit.json";

function load<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function save(file: string, value: unknown): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
}

export const store = {
  list(): ApprovalRequest[] {
    return load<ApprovalRequest[]>(REQ_FILE, []);
  },

  get(id: string): ApprovalRequest | undefined {
    return this.list().find((r) => r.id === id);
  },

  create(
    input: Omit<ApprovalRequest, "id" | "status" | "createdAt" | "approvers"> &
      Partial<Pick<ApprovalRequest, "status" | "approvers">>,
  ): ApprovalRequest {
    const req: ApprovalRequest = {
      approvers: [],
      status: "pending",
      ...input,
      id: randomUUID().slice(0, 8),
      createdAt: new Date().toISOString(),
    };
    const all = this.list();
    all.push(req);
    save(REQ_FILE, all);
    return req;
  },

  /** Mark a pending request as expired if its TTL has passed. Returns the fresh state. */
  expireIfNeeded(id: string): ApprovalRequest | undefined {
    const req = this.get(id);
    if (!req) return undefined;
    const open = req.status === "pending" || req.status === "info_requested";
    if (open && req.expiresAt && Date.parse(req.expiresAt) < Date.now()) {
      const updated = this.update(id, {
        status: "expired",
        resolvedAt: new Date().toISOString(),
        resolutionNote: "Expired: no decision within the policy TTL.",
      })!;
      this.audit({ requestId: id, event: "expired", actor: "aegis:policy" });
      return updated;
    }
    return req;
  },

  update(id: string, patch: Partial<ApprovalRequest>): ApprovalRequest | undefined {
    const all = this.list();
    const idx = all.findIndex((r) => r.id === id);
    if (idx === -1) return undefined;
    all[idx] = { ...all[idx], ...patch };
    save(REQ_FILE, all);
    return all[idx];
  },

  audit(entry: Omit<AuditEntry, "at">): void {
    const all = load<AuditEntry[]>(AUDIT_FILE, []);
    all.push({ at: new Date().toISOString(), ...entry });
    save(AUDIT_FILE, all);
  },

  auditLog(): AuditEntry[] {
    return load<AuditEntry[]>(AUDIT_FILE, []);
  },
};
