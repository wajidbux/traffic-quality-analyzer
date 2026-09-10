import { getDb } from "../db/database.js";

export type AuditAction =
  | "traffic.import"
  | "traffic.manual_add"
  | "traffic.delete"
  | "run.create"
  | "run.complete"
  | "run.failed"
  | "run.delete"
  | "quota.check"
  | "quota.updated"
  | "pixalate.test"
  | "ctv.quota.check"
  | "ctv.test"
  | "report.generate"
  | "report.ssp_generate"
  | "settings.update"
  | "channel.create"
  | "channel.update"
  | "channel.deactivate"
  | "data.export"
  | "data.retention_purge";

/**
 * Append an audit entry. Never rejects: auditing must not take down a request,
 * so callers may fire-and-forget (`void audit(...)`) or await it.
 */
export async function audit(
  action: AuditAction,
  entityType: string | null,
  entityId: string | null,
  details: unknown = null,
  actor = "local"
): Promise<void> {
  try {
    await getDb()
      .prepare("INSERT INTO audit_log (action, entity_type, entity_id, details, actor) VALUES (?, ?, ?, ?, ?)")
      .run(action, entityType, entityId, details === null ? null : JSON.stringify(details), actor);
  } catch {
    // Auditing must never take down a request.
  }
}

export async function listAudit(limit = 200): Promise<Array<Record<string, unknown>>> {
  return (await getDb().prepare("SELECT * FROM audit_log ORDER BY occurred_at DESC, id DESC LIMIT ?").all(limit)) as Array<
    Record<string, unknown>
  >;
}