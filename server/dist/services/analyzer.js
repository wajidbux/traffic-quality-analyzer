import crypto from "node:crypto";
import { getDb, getSettingNumber } from "../db/database.js";
import { PixalateApiError } from "../pixalate/types.js";
import { validateSignals } from "../utils/validation.js";
import { TokenBucket, Semaphore } from "../utils/rateLimiter.js";
import { classifyRisk } from "./riskClassifier.js";
import { sampleRecords } from "./samplingService.js";
import { getEffectiveRemaining, recordAnalysisBatch, recordQuotaError, logUsage, } from "./quotaManager.js";
import { audit } from "./auditLogger.js";
import { logger } from "../utils/logger.js";
import { config } from "../config.js";
export const ANALYSIS_MODES = [
    "ip",
    "device",
    "ua",
    "ip_device",
    "ip_ua",
    "device_ua",
    "ip_device_ua",
    "auto",
];
const MODE_SIGNALS = {
    ip: ["ip"],
    device: ["device"],
    ua: ["ua"],
    ip_device: ["ip", "device"],
    ip_ua: ["ip", "ua"],
    device_ua: ["device", "ua"],
    ip_device_ua: ["ip", "device", "ua"],
};
const AUTO_PRIORITY = [
    ["ip", "device", "ua"],
    ["ip", "device"],
    ["ip", "ua"],
    ["device", "ua"],
    ["ip"],
    ["device"],
    ["ua"],
];
function resolveSignalsForMode(mode, valid) {
    const available = [];
    if (valid.ip)
        available.push("ip");
    if (valid.deviceId)
        available.push("device");
    if (valid.useragent)
        available.push("ua");
    if (mode === "auto") {
        for (const combo of AUTO_PRIORITY) {
            if (combo.every((s) => available.includes(s)))
                return combo;
        }
        return [];
    }
    const requested = MODE_SIGNALS[mode];
    const present = requested.filter((s) => available.includes(s));
    return present;
}
export async function previewAnalysis(strategy, filter, mode) {
    const { ids, totalPool } = await sampleRecords(strategy, filter);
    const currentQuota = await getEffectiveRemaining();
    const estimatedCalls = ids.length;
    const remainingAfter = currentQuota === null ? null : currentQuota - estimatedCalls;
    return {
        poolSize: totalPool,
        selectedRecords: ids.length,
        estimatedCalls,
        currentQuota,
        remainingAfter,
        insufficientQuota: currentQuota !== null && remainingAfter !== null && remainingAfter < 0,
        mode,
        strategy,
    };
}
export class QuotaGuardError extends Error {
    constructor(message) {
        super(message);
        this.name = "QuotaGuardError";
    }
}
const runningJobs = new Map();
export function cancelRun(runId) {
    const controller = runningJobs.get(runId);
    if (controller) {
        controller.abort();
        return true;
    }
    return false;
}
export async function getRun(runId) {
    const row = (await getDb().prepare("SELECT * FROM analysis_runs WHERE id = ?").get(runId));
    if (!row)
        return null;
    return mapRun(row);
}
export async function listRuns(limit = 50) {
    const rows = (await getDb()
        .prepare("SELECT * FROM analysis_runs ORDER BY started_at DESC, id DESC LIMIT ?")
        .all(limit));
    return rows.map(mapRun);
}
function mapRun(row) {
    const toNum = (v) => (typeof v === "number" && Number.isFinite(v) ? v : v === null ? null : Number(v));
    return {
        id: String(row.id),
        name: row.name ? String(row.name) : `Analysis ${String(row.id).slice(0, 8)}`,
        status: String(row.status),
        mode: String(row.mode),
        channelFilter: row.channel_filter === null ? null : String(row.channel_filter),
        startedAt: String(row.started_at),
        endedAt: row.ended_at === null ? null : String(row.ended_at),
        progressTotal: Number(row.progress_total),
        progressProcessed: Number(row.progress_processed),
        numInput: Number(row.num_input),
        numProcessed: Number(row.num_processed),
        numSuccess: Number(row.num_success),
        numFailed: Number(row.num_failed),
        apiCallsUsed: Number(row.api_calls_used),
        quotaBefore: toNum(row.quota_before),
        quotaAfter: toNum(row.quota_after),
        avgRisk: toNum(row.avg_risk),
        medianRisk: toNum(row.median_risk),
        pctLower: toNum(row.pct_lower),
        pctElevated: toNum(row.pct_elevated),
        pctHigh: toNum(row.pct_high),
        pctVeryHigh: toNum(row.pct_very_high),
        error: row.error === null ? null : String(row.error),
    };
}
/** Start (and run) an analysis. Enforces confirmation + quota guard. */
export async function startAnalysis(client, request) {
    if (!request.confirmed) {
        throw new QuotaGuardError("Analysis not started: confirmation is required. Preview first, then confirm.");
    }
    const preview = await previewAnalysis(request.strategy, request.filter ?? {}, request.mode);
    if (preview.selectedRecords === 0) {
        throw new QuotaGuardError("No records match the selected sample. Adjust the filters or sample strategy.");
    }
    const currentQuota = await getEffectiveRemaining();
    if (!request.ignoreQuota && preview.insufficientQuota) {
        throw new QuotaGuardError(`Analysis blocked: estimated ${preview.estimatedCalls} Pixalate calls but only ${currentQuota} remaining. ` +
            "Reduce the sample size or raise the quota before proceeding.");
    }
    const runId = crypto.randomUUID();
    const filter = request.filter ?? {};
    const channelFilterName = filter.channelName ?? null;
    const { ids } = await sampleRecords(request.strategy, filter);
    await getDb()
        .prepare(`INSERT INTO analysis_runs (id, name, status, channel_filter, mode, sample_strategy, started_at,
         progress_total, num_input, quota_before)
       VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?, ?)`)
        .run(runId, request.name ?? null, channelFilterName, request.mode, JSON.stringify(request.strategy), new Date().toISOString(), ids.length, preview.poolSize, currentQuota);
    await audit("run.create", "analysis_runs", runId, {
        mode: request.mode,
        strategy: request.strategy,
        selected: ids.length,
        pool: preview.poolSize,
    });
    const controller = new AbortController();
    runningJobs.set(runId, controller);
    const settings = {
        requestsPerMinute: await getSettingNumber("requests_per_minute", config.REQUESTS_PER_MINUTE),
        maxConcurrency: await getSettingNumber("max_concurrency", config.MAX_CONCURRENCY),
        timeoutMs: await getSettingNumber("request_timeout_ms", config.REQUEST_TIMEOUT_MS),
    };
    const bucket = new TokenBucket(settings.requestsPerMinute);
    const semaphore = new Semaphore(settings.maxConcurrency);
    let success = 0;
    let failed = 0;
    let callsUsed = 0;
    let stoppedEarly = false;
    try {
        const db = getDb();
        const insertResult = db.prepare(`INSERT INTO pixalate_results
         (id, record_id, run_id, analysis_mode, signals_submitted, fraud_probability, raw_response,
          status, http_status, error_code, error_message, latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const insertError = db.prepare(`INSERT INTO api_errors (occurred_at, endpoint, http_status, error_code, error_message, record_id, run_id)
       VALUES (datetime('now'), 'analysis', ?, ?, ?, ?, ?)`);
        const updateProgress = db.prepare("UPDATE analysis_runs SET progress_processed = ?, num_success = ?, num_failed = ?, api_calls_used = ? WHERE id = ?");
        const getRecord = db.prepare("SELECT * FROM traffic_records WHERE id = ?");
        let processed = 0;
        let waveSuccess = 0;
        let waveFailed = 0;
        let waveCalls = 0;
        let waveQuotaBefore = 0;
        const processOne = async (recordId) => {
            if (controller.signal.aborted)
                return;
            await bucket.acquire();
            if (controller.signal.aborted)
                return;
            await semaphore.run(async () => {
                // A fatal error (e.g. quota exhaustion) may have aborted the run while
                // this task was queued — do not make further API calls.
                if (controller.signal.aborted)
                    return;
                processed += 1;
                const record = (await getRecord.get(recordId));
                if (!record)
                    return;
                const { valid, dropped } = validateSignals({
                    ip: record.ip,
                    rida: record.rida,
                    device_id: record.device_id,
                    user_agent: record.user_agent,
                });
                const signals = resolveSignalsForMode(request.mode, valid);
                if (signals.length === 0) {
                    failed += 1;
                    await insertResult.run(crypto.randomUUID(), recordId, runId, request.mode, JSON.stringify([]), null, null, "error", 422, "no_signals", `No requested signals available for mode ${request.mode}${dropped.length ? ` (dropped: ${dropped.map((d) => d.signal).join(", ")})` : ""}`, null);
                    return;
                }
                const payload = {};
                if (signals.includes("ip") && valid.ip)
                    payload.ip = valid.ip;
                if (signals.includes("device") && valid.deviceId)
                    payload.deviceId = valid.deviceId;
                if (signals.includes("ua") && valid.useragent)
                    payload.useragent = valid.useragent;
                try {
                    const result = await client.checkFraud(payload, settings.timeoutMs);
                    success += 1;
                    waveSuccess += 1;
                    waveCalls += 1;
                    await insertResult.run(crypto.randomUUID(), recordId, runId, request.mode, JSON.stringify(signals), result.fraudProbability, JSON.stringify(result.raw), "success", result.httpStatus, null, null, result.latencyMs);
                }
                catch (err) {
                    failed += 1;
                    waveFailed += 1;
                    waveCalls += 1;
                    const error = err instanceof PixalateApiError ? err : new PixalateApiError("network", String(err?.message ?? err));
                    await recordQuotaError(error.message);
                    await insertResult.run(crypto.randomUUID(), recordId, runId, request.mode, JSON.stringify(signals), null, null, "error", error.httpStatus, error.kind, error.message.slice(0, 500), null);
                    await insertError.run(error.httpStatus, error.kind, error.message.slice(0, 500), recordId, runId);
                    // Quota exhaustion or auth failure: stop the whole run.
                    if (error.kind === "quota_exhausted" || error.kind === "unauthorized" || error.kind === "forbidden") {
                        stoppedEarly = true;
                        controller.abort();
                    }
                }
            });
        };
        // Process in waves to bound memory and keep progress visible.
        // Quota tracking is done once per wave (recordAnalysisBatch) instead of
        // once per call, so a 120-record run only touches kv_store a few times.
        const WAVE = 50;
        for (let i = 0; i < ids.length && !controller.signal.aborted; i += WAVE) {
            waveSuccess = 0;
            waveFailed = 0;
            waveCalls = 0;
            waveQuotaBefore = (await getEffectiveRemaining()) ?? 0;
            const wave = ids.slice(i, i + WAVE);
            await Promise.all(wave.map(processOne));
            callsUsed += waveCalls;
            await recordAnalysisBatch(waveCalls);
            await logUsage({
                endpoint: "analysis",
                httpStatus: waveFailed > 0 ? null : 200,
                latencyMs: null,
                quotaBefore: waveQuotaBefore,
                quotaAfter: await getEffectiveRemaining(),
                success: waveFailed === 0,
            });
            await updateProgress.run(processed, success, failed, callsUsed, runId);
            if (stoppedEarly)
                break;
        }
        const finalRow = (await getDb().prepare("SELECT * FROM analysis_runs WHERE id = ?").get(runId));
        const status = controller.signal.aborted && stoppedEarly ? "failed" : controller.signal.aborted ? "cancelled" : "completed";
        const aggregates = await computeAggregates(runId);
        const quotaAfter = await getEffectiveRemaining();
        await getDb()
            .prepare(`UPDATE analysis_runs SET status = ?, ended_at = ?, progress_processed = ?, num_processed = ?,
           num_success = ?, num_failed = ?, api_calls_used = ?, quota_after = ?,
           avg_risk = ?, median_risk = ?, pct_lower = ?, pct_elevated = ?, pct_high = ?, pct_very_high = ?,
           error = ? WHERE id = ?`)
            .run(status, new Date().toISOString(), processed, processed, success, failed, callsUsed, quotaAfter, aggregates.avgRisk, aggregates.medianRisk, aggregates.pctLower, aggregates.pctElevated, aggregates.pctHigh, aggregates.pctVeryHigh, stoppedEarly
            ? "Stopped early: Pixalate returned a fatal error (quota exhausted / auth failure)."
            : controller.signal.aborted
                ? "Cancelled by user."
                : null, runId);
        await audit(status === "completed" ? "run.complete" : status === "failed" ? "run.failed" : "run.create", "analysis_runs", runId, {
            success,
            failed,
            callsUsed,
            status,
        });
        const summary = (await getRun(runId));
        logger.info({ runId, status, success, failed, callsUsed }, "analysis run finished");
        return summary;
    }
    finally {
        runningJobs.delete(runId);
    }
}
export async function computeAggregates(runId) {
    const db = getDb();
    const rows = (await db
        .prepare("SELECT fraud_probability FROM pixalate_results WHERE run_id = ? AND status = 'success' AND fraud_probability IS NOT NULL")
        .all(runId));
    const values = rows
        .map((r) => r.fraud_probability)
        .filter((v) => typeof v === "number" && Number.isFinite(v))
        .sort((a, b) => a - b);
    if (values.length === 0) {
        return { avgRisk: null, medianRisk: null, pctLower: null, pctElevated: null, pctHigh: null, pctVeryHigh: null };
    }
    const sum = values.reduce((a, b) => a + b, 0);
    const mid = Math.floor(values.length / 2);
    const median = values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
    let lower = 0;
    let elevated = 0;
    let high = 0;
    let veryHigh = 0;
    for (const v of values) {
        const band = await classifyRisk(v);
        if (band === "lower")
            lower += 1;
        else if (band === "elevated")
            elevated += 1;
        else if (band === "high")
            high += 1;
        else
            veryHigh += 1;
    }
    const pct = (n) => (n / values.length) * 100;
    return {
        avgRisk: sum / values.length,
        medianRisk: median,
        pctLower: pct(lower),
        pctElevated: pct(elevated),
        pctHigh: pct(high),
        pctVeryHigh: pct(veryHigh),
    };
}
export async function riskBandCounts(runId) {
    const db = getDb();
    const rows = (await db
        .prepare("SELECT fraud_probability FROM pixalate_results WHERE run_id = ? AND status = 'success' AND fraud_probability IS NOT NULL")
        .all(runId));
    const counts = { lower: 0, elevated: 0, high: 0, very_high: 0 };
    for (const r of rows)
        counts[await classifyRisk(r.fraud_probability)] += 1;
    const total = rows.length || 1;
    return ["lower", "elevated", "high", "very_high"].map((band) => ({
        band,
        count: counts[band],
        pct: (counts[band] / total) * 100,
    }));
}
//# sourceMappingURL=analyzer.js.map