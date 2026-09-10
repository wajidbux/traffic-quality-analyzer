import { Router } from "express";
import { getQuotaSnapshot, getQuotaWarnings, listUsage, quotaLevel, refreshQuota, recordQuotaError, getEffectiveRemaining, } from "../services/quotaManager.js";
import { PixalateApiError } from "../pixalate/types.js";
import { audit } from "../services/auditLogger.js";
import { logger } from "../utils/logger.js";
import { asyncHandler } from "../utils/asyncHandler.js";
export function pixalateRouter(context) {
    const router = Router();
    /** API + quota status. Never includes the API key itself. */
    router.get("/status", asyncHandler(async (_req, res) => {
        const snapshot = await getQuotaSnapshot();
        const remaining = await getEffectiveRemaining();
        res.json({
            apiKeyConfigured: context.apiKeyConfigured,
            connected: snapshot.apiStatus !== null || snapshot.lastCheckedAt !== null,
            quota: {
                ...snapshot,
                remaining: remaining,
                level: await quotaLevel(remaining),
                warnings: await getQuotaWarnings(),
            },
        });
    }));
    /** Quota check — uses the metadata endpoint, does NOT consume analysis quota. */
    router.post("/quota", asyncHandler(async (_req, res) => {
        if (!context.apiKeyConfigured) {
            return res.status(503).json({
                error: "PIXALATE_API_KEY is not configured on the server. Add it to the environment and restart.",
                apiKeyConfigured: false,
            });
        }
        try {
            const snapshot = await refreshQuota(context.client);
            await audit("quota.check", "pixalate", null, { remaining: await getEffectiveRemaining() });
            res.json({
                ok: true,
                quota: { ...snapshot, remaining: await getEffectiveRemaining(), level: await quotaLevel(await getEffectiveRemaining()) },
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await recordQuotaError(message);
            const status = err instanceof PixalateApiError && err.httpStatus ? err.httpStatus : 502;
            logger.warn({ err }, "quota check failed");
            res.status(status).json({ error: message, apiKeyConfigured: true });
        }
    }));
    /** Test connection — uses the safest documented request (metadata, no analysis quota). */
    router.post("/test", asyncHandler(async (_req, res) => {
        if (!context.apiKeyConfigured) {
            return res.status(503).json({
                error: "PIXALATE_API_KEY is not configured on the server. Add it to the environment and restart.",
                apiKeyConfigured: false,
            });
        }
        try {
            const started = Date.now();
            const snapshot = await refreshQuota(context.client);
            await audit("pixalate.test", "pixalate", null, { latencyMs: Date.now() - started });
            res.json({
                ok: true,
                message: "Connection successful. Metadata/quota retrieved.",
                quota: { ...snapshot, remaining: await getEffectiveRemaining(), level: await quotaLevel(await getEffectiveRemaining()) },
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await recordQuotaError(message);
            const status = err instanceof PixalateApiError && err.httpStatus ? err.httpStatus : 502;
            logger.warn({ err }, "connection test failed");
            res.status(status).json({ error: message, apiKeyConfigured: true });
        }
    }));
    /** Recent usage log (metadata/test + analysis calls). */
    router.get("/usage", asyncHandler(async (req, res) => {
        res.json({ usage: await listUsage(Number(req.query.limit ?? 100)) });
    }));
    return router;
}
//# sourceMappingURL=pixalate.js.map