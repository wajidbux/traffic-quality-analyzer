import { Router } from "express";
import { getQuotaWarnings, quotaLevel, recordQuotaError, } from "../services/quotaManager.js";
import { PixalateApiError } from "../pixalate/types.js";
import { audit } from "../services/auditLogger.js";
import { logger } from "../utils/logger.js";
import { asyncHandler } from "../utils/asyncHandler.js";
export function ctvRouter(context) {
    const router = Router();
    /** CTV Apps API + quota status. Never includes the API key. */
    router.get("/status", asyncHandler(async (_req, res) => {
        // Try to fetch live CTV quota if the key is configured.
        let ctvQuota = null;
        let ctvConnected = false;
        if (context.apiKeyConfigured) {
            try {
                ctvQuota = await context.ctvClient.getQuota();
                ctvConnected = ctvQuota.apiStatus !== null || ctvQuota.databaseLastUpdated !== null;
            }
            catch (err) {
                logger.warn({ err }, "CTV Apps API status check failed");
                ctvConnected = false;
                ctvQuota = null;
            }
        }
        res.json({
            apiKeyConfigured: context.apiKeyConfigured,
            ctv: {
                connected: ctvConnected,
                quota: ctvQuota,
                warnings: ctvQuota ? await getQuotaWarnings() : [],
            },
        });
    }));
    /** Quota check — uses GET /mrt/ctv (metadata), does NOT consume analysis quota. */
    router.post("/quota", asyncHandler(async (_req, res) => {
        if (!context.apiKeyConfigured) {
            return res.status(503).json({
                error: "PIXALATE_API_KEY is not configured on the server. Add it to the environment and restart.",
                apiKeyConfigured: false,
            });
        }
        try {
            const snapshot = await context.ctvClient.getQuota();
            await audit("ctv.quota.check", "pixalate-ctv", null, { remaining: snapshot.remaining });
            res.json({
                ok: true,
                quota: {
                    ...snapshot,
                    level: await quotaLevel(snapshot.remaining ?? 0),
                    warnings: await getQuotaWarnings(),
                },
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await recordQuotaError(message);
            const status = err instanceof PixalateApiError && err.httpStatus ? err.httpStatus : 502;
            logger.warn({ err }, "CTV quota check failed");
            res.status(status).json({ error: message, apiKeyConfigured: true });
        }
    }));
    /** Test connection — safest documented request (GET /mrt/ctv metadata). */
    router.post("/test", asyncHandler(async (_req, res) => {
        if (!context.apiKeyConfigured) {
            return res.status(503).json({
                error: "PIXALATE_API_KEY is not configured on the server. Add it to the environment and restart.",
                apiKeyConfigured: false,
            });
        }
        try {
            const started = Date.now();
            const snapshot = await context.ctvClient.getQuota();
            await audit("ctv.test", "pixalate-ctv", null, { latencyMs: Date.now() - started });
            res.json({
                ok: true,
                message: "CTV Apps API connection successful. Metadata/quota retrieved.",
                quota: {
                    ...snapshot,
                    level: await quotaLevel(snapshot.remaining ?? 0),
                    warnings: await getQuotaWarnings(),
                },
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await recordQuotaError(message);
            const status = err instanceof PixalateApiError && err.httpStatus ? err.httpStatus : 502;
            logger.warn({ err }, "CTV connection test failed");
            res.status(status).json({ error: message, apiKeyConfigured: true });
        }
    }));
    /** Look up a single CTV app by appId. */
    router.get("/app/:appId", asyncHandler(async (req, res) => {
        if (!context.apiKeyConfigured) {
            return res.status(503).json({
                error: "PIXALATE_API_KEY is not configured on the server.",
                apiKeyConfigured: false,
            });
        }
        const appId = req.params.appId;
        const region = req.query.region ? String(req.query.region) : undefined;
        const device = req.query.device ? String(req.query.device) : undefined;
        const includeSpoofing = req.query.includeSpoofing === "true";
        try {
            const result = await context.ctvClient.getApp(appId, { region, device, includeSpoofing });
            res.json({ app: result, apiKeyConfigured: true });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const status = err instanceof PixalateApiError && err.httpStatus ? err.httpStatus : 502;
            res.status(status).json({ error: message, apiKeyConfigured: true });
        }
    }));
    return router;
}
//# sourceMappingURL=ctv.js.map