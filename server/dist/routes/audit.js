import { Router } from "express";
import { listAudit } from "../services/auditLogger.js";
import { getDb } from "../db/database.js";
import { asyncHandler } from "../utils/asyncHandler.js";
export function auditRouter(_context) {
    const router = Router();
    router.get("/", asyncHandler(async (req, res) => {
        const limit = Math.min(Number(req.query.limit ?? 200), 1000);
        res.json({ entries: await listAudit(limit) });
    }));
    router.get("/errors", asyncHandler(async (req, res) => {
        const limit = Math.min(Number(req.query.limit ?? 100), 500);
        const rows = (await getDb()
            .prepare("SELECT * FROM api_errors ORDER BY occurred_at DESC, id DESC LIMIT ?")
            .all(limit));
        res.json({ errors: rows });
    }));
    return router;
}
//# sourceMappingURL=audit.js.map