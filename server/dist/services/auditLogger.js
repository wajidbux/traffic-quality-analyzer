import { getDb } from "../db/database.js";
/**
 * Append an audit entry. Never rejects: auditing must not take down a request,
 * so callers may fire-and-forget (`void audit(...)`) or await it.
 */
export async function audit(action, entityType, entityId, details = null, actor = "local") {
    try {
        await getDb()
            .prepare("INSERT INTO audit_log (action, entity_type, entity_id, details, actor) VALUES (?, ?, ?, ?, ?)")
            .run(action, entityType, entityId, details === null ? null : JSON.stringify(details), actor);
    }
    catch {
        // Auditing must never take down a request.
    }
}
export async function listAudit(limit = 200) {
    return (await getDb().prepare("SELECT * FROM audit_log ORDER BY occurred_at DESC, id DESC LIMIT ?").all(limit));
}
//# sourceMappingURL=auditLogger.js.map