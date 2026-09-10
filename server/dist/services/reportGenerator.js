import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { getDb, getSetting, getRiskBands } from "../db/database.js";
import { getRun, riskBandCounts } from "./analyzer.js";
import { runRiskDistribution, channelStats, temporalAnalysis, geoAnalysis, highRiskRecords, signalComparison, } from "./statistics.js";
import { maskIp, maskDeviceId, maskUserAgent } from "../utils/masking.js";
import { riskBandLabel, classifyRiskSync } from "./riskClassifier.js";
import { audit } from "./auditLogger.js";
export const METHODOLOGY_STATEMENT = "This report analyzes a sampled set of CTV/Roku traffic signals using Pixalate's Ad Fraud API. " +
    "The Pixalate probability represents a risk assessment for the submitted signal or signal combination " +
    "and should not be interpreted as definitive proof that an individual request is fraudulent.";
const LIMITATIONS = [
    "The analysis is based on a sampled subset of traffic, not the full request stream.",
    "Pixalate probabilities are risk assessments for the submitted signal or signal combination; they are analytical categories, not determinations of fraud.",
    "No third-party data was sent anywhere other than to the Pixalate Ad Fraud API for the purposes of this analysis.",
    "Geographic breakdowns use the country/region fields supplied with the traffic; no IP-based geolocation was performed.",
    "Results reflect the Pixalate database state at the time of the API calls and may change as Pixalate updates its threat intelligence.",
];
async function companyName() {
    return (await getSetting("company_name")) ?? "Naga Company";
}
async function maskingEnabled() {
    return (await getSetting("mask_sensitive")) !== "false";
}
function formatPct(value) {
    if (value === null || value === undefined)
        return "—";
    return `${value.toFixed(1)}%`;
}
function formatProb(value) {
    if (value === null || value === undefined)
        return "—";
    return value.toFixed(2);
}
export async function buildReportPayload(runId) {
    const run = await getRun(runId);
    if (!run)
        throw new Error(`Analysis run ${runId} not found`);
    const [distribution, bands, channels, temporal, geo, highRisk, comparison, riskBands] = await Promise.all([
        runRiskDistribution(runId),
        riskBandCounts(runId),
        channelStats(null),
        temporalAnalysis(runId, "hour", 72),
        geoAnalysis(runId, 15),
        highRiskRecords(runId, (await getRiskBands()).highFrom, 100),
        signalComparison(runId, 50),
        getRiskBands(),
    ]);
    const maxRow = (await getDb()
        .prepare("SELECT MAX(fraud_probability) AS m FROM pixalate_results WHERE run_id = ? AND status = 'success'")
        .get(runId));
    const minRow = (await getDb()
        .prepare("SELECT MIN(fraud_probability) AS m FROM pixalate_results WHERE run_id = ? AND status = 'success'")
        .get(runId));
    return {
        runId,
        run,
        distribution,
        bands,
        channels: channels.filter((c) => c.totalRecords > 0),
        temporal,
        geo,
        highRisk,
        comparison,
        highestRisk: maxRow.m,
        lowestRisk: minRow.m,
        companyName: await companyName(),
        analysisPeriod: run.startedAt,
        generatedAt: new Date().toISOString(),
        methodology: METHODOLOGY_STATEMENT,
        masking: await maskingEnabled(),
        riskBands,
    };
}
async function maskedValue(value, kind) {
    if (!value)
        return "—";
    if (!(await maskingEnabled()))
        return value;
    if (kind === "ip")
        return maskIp(value) ?? "—";
    if (kind === "device")
        return maskDeviceId(value) ?? "—";
    return maskUserAgent(value, 60) ?? "—";
}
// ---- PDF -------------------------------------------------------------------
function collectPdf(doc) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
        doc.end();
    });
}
export async function generatePdf(payload) {
    const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true });
    const drawHeader = () => {
        doc.fontSize(18).fillColor("#111827").text("CTV Traffic Quality Analysis Report", { align: "left" });
        doc.moveDown(0.2);
        doc.fontSize(11).fillColor("#374151").text(`${payload.companyName} — ${payload.run.channelFilter === "all" || !payload.run.channelFilter ? "All Channels" : payload.run.channelFilter}`);
        doc.moveDown(0.1);
        doc.fontSize(9).fillColor("#6B7280").text(`Analysis Run ID: ${payload.runId}  •  Run started: ${payload.run.startedAt}  •  Report generated: ${payload.generatedAt}`);
        doc.moveDown(0.5);
    };
    drawHeader();
    doc.fontSize(10).fillColor("#111827").text("Methodology");
    doc.moveDown(0.2);
    doc.fontSize(9).fillColor("#374151").text(payload.methodology);
    doc.moveDown(0.5);
    // Key statistics
    const run = payload.run;
    doc.fontSize(10).fillColor("#111827").text("Key Statistics");
    doc.moveDown(0.2);
    const stats = [
        ["Analysis mode", run.mode],
        ["Status", run.status],
        ["Input records (pool)", String(run.numInput)],
        ["Records processed", String(run.numProcessed)],
        ["Successful checks", String(run.numSuccess)],
        ["Failed checks", String(run.numFailed)],
        ["API calls used", String(run.apiCallsUsed)],
        ["Quota before", run.quotaBefore === null ? "—" : String(run.quotaBefore)],
        ["Quota after", run.quotaAfter === null ? "—" : String(run.quotaAfter)],
        ["Average risk", formatProb(run.avgRisk)],
        ["Median risk", formatProb(run.medianRisk)],
        ["Highest risk", formatProb(payload.highestRisk)],
        ["Lowest risk", formatProb(payload.lowestRisk)],
        ["Lower-risk traffic", formatPct(run.pctLower)],
        ["Elevated-risk traffic", formatPct(run.pctElevated)],
        ["High-risk traffic", formatPct(run.pctHigh)],
        ["Very-high-risk traffic", formatPct(run.pctVeryHigh)],
    ];
    table(doc, ["Metric", "Value"], stats);
    doc.moveDown(0.6);
    // Risk distribution
    doc.fontSize(10).fillColor("#111827").text("Risk Distribution (probability bins)");
    doc.moveDown(0.2);
    table(doc, ["Bin", "Count", "%"], payload.distribution.map((d) => [d.bin, String(d.count), d.pct.toFixed(1)]));
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor("#111827").text("Risk Bands");
    doc.moveDown(0.2);
    table(doc, ["Band", "Count", "%"], payload.bands.map((b) => [riskBandLabel(b.band), String(b.count), b.pct.toFixed(1)]));
    doc.moveDown(0.4);
    // Channel info
    if (payload.channels.length) {
        doc.fontSize(10).fillColor("#111827").text("Channel Information");
        doc.moveDown(0.2);
        table(doc, ["Channel", "Records", "Unique IPs", "Unique RIDAs", "Avg risk", "High-risk %", "Failures"], payload.channels.map((c) => [
            c.channelName,
            String(c.totalRecords),
            String(c.uniqueIps),
            String(c.uniqueRidas),
            formatProb(c.averageRisk),
            formatPct(c.highRiskPct),
            String(c.pixalateFailures),
        ]));
        doc.moveDown(0.4);
    }
    // High-risk findings
    doc.fontSize(10).fillColor("#111827").text("High-Risk Findings");
    doc.moveDown(0.2);
    if (payload.highRisk.length === 0) {
        doc.fontSize(9).fillColor("#374151").text("No records exceeded the high-risk threshold.");
    }
    else {
        const rows = await Promise.all(payload.highRisk.slice(0, 30).map(async (h) => [
            h.channel ?? "—",
            h.timestamp ? h.timestamp.slice(0, 19).replace("T", " ") : "—",
            await maskedValue(h.ip, "ip"),
            await maskedValue(h.rida, "device"),
            formatProb(h.probability),
            h.signalsSubmitted.join("+"),
        ]));
        table(doc, ["Channel", "Timestamp", "IP (masked)", "Device (masked)", "Probability", "Signals"], rows);
        if (payload.highRisk.length > 30) {
            doc.fontSize(9).fillColor("#6B7280").text(`… and ${payload.highRisk.length - 30} more high-risk records (see CSV/XLSX export).`);
        }
    }
    doc.moveDown(0.4);
    // API usage
    doc.fontSize(10).fillColor("#111827").text("API Usage");
    doc.moveDown(0.2);
    doc.fontSize(9).fillColor("#374151").text(`This analysis used ${run.apiCallsUsed} Pixalate Ad Fraud API call(s). Quota before: ${run.quotaBefore ?? "unknown"}, after: ${run.quotaAfter ?? "unknown"}. ` +
        "Every fraud-analysis call consumes one unit of the Pixalate quota.");
    doc.moveDown(0.4);
    // Limitations
    doc.fontSize(10).fillColor("#111827").text("Limitations");
    doc.moveDown(0.2);
    doc.fontSize(8.5).fillColor("#6B7280");
    LIMITATIONS.forEach((l) => doc.text(`• ${l}`, { indent: 10 }));
    doc.moveDown(0.3);
    doc.fontSize(8).fillColor("#9CA3AF").text("Risk bands used in this report are analytical categories for triage purposes. " +
        `Elevated ≥ ${payload.riskBands.elevatedFrom.toFixed(2)}, High ≥ ${payload.riskBands.highFrom.toFixed(2)}, Very high ≥ ${payload.riskBands.veryHighFrom.toFixed(2)}.`, { indent: 10 });
    return collectPdf(doc);
}
function table(doc, headers, rows, opts = {}) {
    const size = opts.fontSize ?? 8.5;
    const margin = 48;
    const pageWidth = 595.28;
    const colWidth = (pageWidth - margin * 2) / headers.length;
    const pad = 4;
    // Header
    doc.fontSize(size).fillColor("#6B7280");
    headers.forEach((h, i) => {
        doc.text(h, margin + i * colWidth, doc.y, { width: colWidth - pad, height: 14 });
    });
    doc.moveDown(0.3);
    doc.fillColor("#111827");
    for (const row of rows) {
        let maxHeight = 12;
        const cells = row.map((cell, i) => {
            const height = doc.heightOfString(cell, { width: colWidth - pad });
            maxHeight = Math.max(maxHeight, height);
            return { text: cell, height };
        });
        if (doc.y + maxHeight > 790) {
            doc.addPage();
            drawTableHeader(doc, headers, colWidth, pad, size);
        }
        const startY = doc.y;
        cells.forEach((cell, i) => {
            doc.text(cell.text, margin + i * colWidth, startY, { width: colWidth - pad, height: maxHeight });
        });
        doc.moveDown(maxHeight / 12 + 0.1);
    }
    doc.moveDown(0.3);
}
function drawTableHeader(doc, headers, colWidth, pad, size) {
    const margin = 48;
    doc.fontSize(size).fillColor("#6B7280");
    headers.forEach((h, i) => {
        doc.text(h, margin + i * colWidth, doc.y, { width: colWidth - pad, height: 14 });
    });
    doc.moveDown(0.3);
    doc.fillColor("#111827");
}
// ---- XLSX ------------------------------------------------------------------
export async function generateXlsx(payload) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = payload.companyName;
    workbook.created = new Date();
    const overview = workbook.addWorksheet("Overview");
    overview.columns = [
        { header: "Field", key: "field", width: 28 },
        { header: "Value", key: "value", width: 40 },
    ];
    const run = payload.run;
    overview.addRows([
        { field: "Report", value: "CTV Traffic Quality Analysis Report" },
        { field: "Company", value: payload.companyName },
        { field: "Channel", value: run.channelFilter ?? "All Channels" },
        { field: "Analysis Run ID", value: payload.runId },
        { field: "Run started", value: run.startedAt },
        { field: "Generated", value: payload.generatedAt },
        { field: "Analysis mode", value: run.mode },
        { field: "Status", value: run.status },
        { field: "Input records (pool)", value: run.numInput },
        { field: "Records processed", value: run.numProcessed },
        { field: "Successful checks", value: run.numSuccess },
        { field: "Failed checks", value: run.numFailed },
        { field: "API calls used", value: run.apiCallsUsed },
        { field: "Quota before", value: run.quotaBefore },
        { field: "Quota after", value: run.quotaAfter },
        { field: "Average risk", value: run.avgRisk },
        { field: "Median risk", value: run.medianRisk },
        { field: "Lower-risk traffic %", value: run.pctLower },
        { field: "Elevated-risk traffic %", value: run.pctElevated },
        { field: "High-risk traffic %", value: run.pctHigh },
        { field: "Very-high-risk traffic %", value: run.pctVeryHigh },
        { field: "Methodology", value: payload.methodology },
    ]);
    const dist = workbook.addWorksheet("Risk Distribution");
    dist.columns = [
        { header: "Probability bin", key: "bin", width: 20 },
        { header: "Count", key: "count", width: 12 },
        { header: "%", key: "pct", width: 12 },
    ];
    dist.addRows(payload.distribution.map((d) => ({ bin: d.bin, count: d.count, pct: d.pct })));
    const bands = workbook.addWorksheet("Risk Bands");
    bands.columns = [
        { header: "Band", key: "band", width: 24 },
        { header: "Count", key: "count", width: 12 },
        { header: "%", key: "pct", width: 12 },
    ];
    bands.addRows(payload.bands.map((b) => ({ band: riskBandLabel(b.band), count: b.count, pct: b.pct })));
    const records = workbook.addWorksheet("Analyzed Records");
    records.columns = [
        { header: "Timestamp", key: "timestamp", width: 22 },
        { header: "Channel", key: "channel", width: 16 },
        { header: "IP", key: "ip", width: 18 },
        { header: "RIDA/Device", key: "rida", width: 28 },
        { header: "User-Agent", key: "ua", width: 60 },
        { header: "Country", key: "country", width: 12 },
        { header: "Probability", key: "probability", width: 12 },
        { header: "Band", key: "band", width: 16 },
        { header: "Signals", key: "signals", width: 20 },
        { header: "Status", key: "status", width: 10 },
    ];
    const detail = await resultsDetailRows(payload.runId);
    records.addRows(detail);
    const highRisk = workbook.addWorksheet("High-Risk Records");
    highRisk.columns = [
        { header: "Timestamp", key: "timestamp", width: 22 },
        { header: "Channel", key: "channel", width: 16 },
        { header: "IP (masked)", key: "ip", width: 18 },
        { header: "RIDA/Device (masked)", key: "rida", width: 28 },
        { header: "Country", key: "country", width: 12 },
        { header: "Probability", key: "probability", width: 12 },
        { header: "Band", key: "band", width: 16 },
        { header: "Signals", key: "signals", width: 20 },
    ];
    highRisk.addRows(payload.highRisk.map((h) => ({
        timestamp: h.timestamp ?? "",
        channel: h.channel ?? "",
        ip: maskedValue(h.ip, "ip"),
        rida: maskedValue(h.rida, "device"),
        country: h.country ?? "",
        probability: h.probability,
        band: riskBandLabel(h.band),
        signals: h.signalsSubmitted.join("+"),
    })));
    const channelsSheet = workbook.addWorksheet("Channels");
    channelsSheet.columns = [
        { header: "Channel", key: "channel", width: 16 },
        { header: "Records", key: "records", width: 12 },
        { header: "Unique IPs", key: "ips", width: 12 },
        { header: "Unique RIDAs", key: "ridas", width: 12 },
        { header: "Avg risk", key: "avg", width: 12 },
        { header: "Median risk", key: "median", width: 12 },
        { header: "High-risk %", key: "high", width: 12 },
        { header: "Very-high-risk %", key: "vhigh", width: 16 },
        { header: "Failures", key: "failures", width: 12 },
    ];
    channelsSheet.addRows(payload.channels.map((c) => ({
        channel: c.channelName,
        records: c.totalRecords,
        ips: c.uniqueIps,
        ridas: c.uniqueRidas,
        avg: c.averageRisk,
        median: c.medianRisk,
        high: c.highRiskPct,
        vhigh: c.veryHighRiskPct,
        failures: c.pixalateFailures,
    })));
    const geoSheet = workbook.addWorksheet("Geo Analysis");
    geoSheet.columns = [
        { header: "Country", key: "country", width: 16 },
        { header: "Requests", key: "requests", width: 12 },
        { header: "Avg risk", key: "avg", width: 12 },
        { header: "High-risk %", key: "high", width: 12 },
        { header: "Very-high-risk %", key: "vhigh", width: 16 },
    ];
    geoSheet.addRows(payload.geo.map((g) => ({
        country: g.country,
        requests: g.requests,
        avg: g.avgRisk,
        high: g.highRiskPct,
        vhigh: g.veryHighRiskPct,
    })));
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
}
async function resultsDetailRows(runId) {
    const db = getDb();
    const rows = (await db
        .prepare(`SELECT pr.fraud_probability, pr.status, pr.signals_submitted, pr.analysis_mode,
              r.timestamp, r.ip, r.rida, r.device_id, r.user_agent, r.country, c.name AS channel
       FROM pixalate_results pr
       JOIN traffic_records r ON r.id = pr.record_id
       LEFT JOIN channels c ON c.id = r.channel_id
       WHERE pr.run_id = ? ORDER BY pr.fraud_probability DESC NULLS LAST, pr.id`)
        .all(runId));
    return rows.map((r) => ({
        timestamp: r.timestamp ?? "",
        channel: r.channel ?? "",
        ip: maskedValue(r.ip, "ip"),
        rida: maskedValue(r.rida ?? r.device_id, "device"),
        ua: maskedValue(r.user_agent, "ua"),
        country: r.country ?? "",
        probability: r.fraud_probability,
        band: r.fraud_probability === null ? "" : riskBandLabelForValue(r.fraud_probability),
        signals: JSON.parse(r.signals_submitted ?? "[]").join("+"),
        status: r.status,
    }));
}
function riskBandLabelForValue(probability) {
    return riskBandLabel(classifyRiskSync(probability));
}
// ---- CSV -------------------------------------------------------------------
export async function generateResultsCsv(runId) {
    const db = getDb();
    const rows = (await db
        .prepare(`SELECT r.ad_request_id, r.timestamp, c.name AS channel, r.ip, r.rida, r.device_id, r.user_agent,
              r.country, r.region, pr.analysis_mode, pr.signals_submitted, pr.fraud_probability,
              pr.status, pr.http_status, pr.error_message, pr.latency_ms, pr.created_at AS checked_at
       FROM pixalate_results pr
       JOIN traffic_records r ON r.id = pr.record_id
       LEFT JOIN channels c ON c.id = r.channel_id
       WHERE pr.run_id = ? ORDER BY pr.fraud_probability DESC NULLS LAST`)
        .all(runId));
    const header = [
        "ad_request_id",
        "timestamp",
        "channel",
        "ip",
        "rida",
        "device_id",
        "user_agent",
        "country",
        "region",
        "analysis_mode",
        "signals_submitted",
        "fraud_probability",
        "status",
        "http_status",
        "error_message",
        "latency_ms",
        "checked_at",
    ];
    const esc = (v) => {
        const s = v === null || v === undefined ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const masking = await maskingEnabled();
    const lines = [header.join(",")];
    for (const row of rows) {
        lines.push(header
            .map((h) => {
            let value = row[h];
            if (h === "ip" && masking)
                value = maskIp(String(value));
            if ((h === "rida" || h === "device_id") && masking)
                value = maskDeviceId(String(value));
            if (h === "user_agent" && masking)
                value = maskUserAgent(String(value), 120);
            return esc(value);
        })
            .join(","));
    }
    return lines.join("\n");
}
export async function buildSspPayload(runId, channelName) {
    const run = await getRun(runId);
    if (!run)
        throw new Error(`Analysis run ${runId} not found`);
    const geo = (await geoAnalysis(runId, 5)).map((g) => `${g.country} (${g.requests})`);
    const channels = (await channelStats(null)).filter((c) => c.totalRecords > 0);
    const channel = channelName ?? run.channelFilter ?? null;
    const primaryDevice = "Roku / CTV devices (per RIDA + user-agent signals)";
    return {
        runId,
        channel,
        sampleSize: run.numSuccess,
        period: run.startedAt,
        primaryDevice,
        primaryGeos: geo.length ? geo : ["Not supplied"],
        pctLower: run.pctLower,
        pctElevated: run.pctElevated,
        pctHigh: run.pctHigh,
        pctVeryHigh: run.pctVeryHigh,
        methodology: METHODOLOGY_STATEMENT,
        generatedAt: new Date().toISOString(),
    };
}
export async function generateSspPdf(payload) {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    doc.fontSize(20).fillColor("#111827").text((payload.channel ?? "CTV").toUpperCase(), { align: "left" });
    doc.moveDown(0.2);
    doc.fontSize(13).fillColor("#374151").text("CTV Traffic Quality Summary");
    doc.moveDown(0.4);
    doc.fontSize(9).fillColor("#6B7280").text(`Prepared for SSP / programmatic partners  •  ${payload.generatedAt.slice(0, 10)}`);
    doc.moveDown(0.6);
    doc.fontSize(10).fillColor("#111827").text("Analysis overview");
    doc.moveDown(0.2);
    doc.fontSize(9).fillColor("#374151");
    const overview = [
        ["Analysis period", payload.period],
        ["Sample size", `${payload.sampleSize} request(s) analyzed`],
        ["Traffic source", "Roku/CTV ad-request traffic (offline sample)"],
        ["Primary device", payload.primaryDevice],
        ["Primary GEOs", payload.primaryGeos.join(", ")],
    ];
    overview.forEach(([k, v]) => {
        doc.text(`${k}:  ${v}`);
        doc.moveDown(0.15);
    });
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor("#111827").text("Pixalate assessment (sampled traffic)");
    doc.moveDown(0.2);
    table(doc, ["Risk category", "% of sampled traffic"], [
        ["Lower-risk traffic", formatPct(payload.pctLower)],
        ["Elevated-risk traffic", formatPct(payload.pctElevated)],
        ["High-risk traffic", formatPct(payload.pctHigh)],
        ["Very-high-risk traffic", formatPct(payload.pctVeryHigh)],
    ]);
    doc.moveDown(0.6);
    doc.fontSize(10).fillColor("#111827").text("Methodology");
    doc.moveDown(0.2);
    doc.fontSize(9).fillColor("#374151").text(payload.methodology);
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor("#111827").text("Limitations");
    doc.moveDown(0.2);
    doc.fontSize(8.5).fillColor("#6B7280");
    LIMITATIONS.forEach((l) => doc.text(`• ${l}`, { indent: 10 }));
    doc.moveDown(0.3);
    doc.fontSize(8.5).fillColor("#374151").text("Risk categories are analytical bands defined for this analysis and are not determinations of fraud for any individual request.");
    return collectPdf(doc);
}
// ---- audit + export helpers -------------------------------------------------
export async function recordReportAudit(kind, runId) {
    await audit(kind === "full" ? "report.generate" : "report.ssp_generate", "analysis_runs", runId, { kind });
}
export async function exportAllCsv() {
    const db = getDb();
    const rows = (await db
        .prepare(`SELECT r.ad_request_id, r.timestamp, c.name AS channel, r.ip, r.rida, r.device_id, r.user_agent,
              r.country, r.region, r.source, pr.fraud_probability, pr.status, pr.analysis_mode, pr.created_at AS checked_at
       FROM traffic_records r
       LEFT JOIN channels c ON c.id = r.channel_id
       LEFT JOIN pixalate_results pr ON pr.record_id = r.id
       ORDER BY r.created_at DESC`)
        .all());
    const header = ["ad_request_id", "timestamp", "channel", "ip", "rida", "device_id", "user_agent", "country", "region", "source", "fraud_probability", "status", "analysis_mode", "checked_at"];
    const esc = (v) => {
        const s = v === null || v === undefined ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const masking = await maskingEnabled();
    const lines = [header.join(",")];
    for (const row of rows) {
        lines.push(header
            .map((h) => {
            let value = row[h];
            if (h === "ip" && masking)
                value = maskIp(String(value));
            if (h === "rida" && masking)
                value = maskDeviceId(String(value));
            if (h === "user_agent" && masking)
                value = maskUserAgent(String(value), 120);
            return esc(value);
        })
            .join(","));
    }
    return lines.join("\n");
}
//# sourceMappingURL=reportGenerator.js.map