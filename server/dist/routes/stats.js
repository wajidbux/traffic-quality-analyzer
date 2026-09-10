import { Router } from "express";
import { getEffectiveRemaining } from "../services/quotaManager.js";
import { dashboardKpis, duplicateStats, geoAnalysis, highRiskRecords, runRiskDistribution, signalComparison, temporalAnalysis, } from "../services/statistics.js";
import { channelStats } from "../services/statistics.js";
import { riskBandsWithRanges } from "../services/riskClassifier.js";
import { getSetting } from "../db/database.js";
import { maskIp, maskDeviceId, maskUserAgent } from "../utils/masking.js";
import { asyncHandler } from "../utils/asyncHandler.js";
export function statsRouter(_context) {
    const router = Router();
    router.get("/dashboard", asyncHandler(async (_req, res) => {
        const kpis = await dashboardKpis();
        kpis.remainingQuota = await getEffectiveRemaining();
        res.json({ kpis, riskBands: await riskBandsWithRanges() });
    }));
    router.get("/channels", asyncHandler(async (req, res) => {
        const channelId = req.query.channelId ? Number(req.query.channelId) : null;
        res.json({ channels: await channelStats(channelId) });
    }));
    router.get("/distribution", asyncHandler(async (req, res) => {
        const runId = typeof req.query.runId === "string" ? req.query.runId : null;
        if (runId)
            return res.json({ distribution: await runRiskDistribution(runId) });
        const kpis = await dashboardKpis();
        res.json({ distribution: kpis.distribution });
    }));
    router.get("/temporal", asyncHandler(async (req, res) => {
        const runId = typeof req.query.runId === "string" ? req.query.runId : null;
        if (!runId)
            return res.status(400).json({ error: "runId is required for temporal analysis." });
        const granularity = req.query.granularity === "day" || req.query.granularity === "date" ? req.query.granularity : "hour";
        res.json({ rows: await temporalAnalysis(runId, granularity) });
    }));
    router.get("/geo", asyncHandler(async (req, res) => {
        const runId = typeof req.query.runId === "string" ? req.query.runId : null;
        if (!runId)
            return res.status(400).json({ error: "runId is required for geo analysis." });
        res.json({ rows: await geoAnalysis(runId) });
    }));
    router.get("/duplicates", asyncHandler(async (_req, res) => {
        const stats = await duplicateStats();
        const masking = (await getSetting("mask_sensitive")) !== "false";
        res.json({
            ...stats,
            topRepeatedIps: masking ? stats.topRepeatedIps.map((r) => ({ ...r, value: maskIp(r.value) })) : stats.topRepeatedIps,
            topRepeatedRidas: masking ? stats.topRepeatedRidas.map((r) => ({ ...r, value: maskDeviceId(r.value) })) : stats.topRepeatedRidas,
        });
    }));
    router.get("/signal-comparison", asyncHandler(async (req, res) => {
        const runId = typeof req.query.runId === "string" ? req.query.runId : null;
        if (!runId)
            return res.status(400).json({ error: "runId is required." });
        const limit = Number(req.query.limit ?? 500);
        res.json({ rows: await signalComparison(runId, limit) });
    }));
    router.get("/high-risk", asyncHandler(async (req, res) => {
        const runId = typeof req.query.runId === "string" ? req.query.runId : null;
        const minRisk = Number(req.query.minRisk ?? 0.5);
        const limit = Number(req.query.limit ?? 500);
        const rows = await highRiskRecords(runId, minRisk, limit);
        const masking = (await getSetting("mask_sensitive")) !== "false";
        res.json({
            rows: rows.map((r) => ({
                ...r,
                ip: masking ? maskIp(r.ip) : r.ip,
                rida: masking ? maskDeviceId(r.rida) : r.rida,
                userAgent: masking ? maskUserAgent(r.userAgent, 80) : r.userAgent,
            })),
        });
    }));
    return router;
}
//# sourceMappingURL=stats.js.map