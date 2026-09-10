import { getDb } from "../db/database.js";
import { classifyRisk, histogramBin, DEFAULT_HISTOGRAM_BINS, RiskBand } from "./riskClassifier.js";

/**
 * Read-only statistics over stored records + results.
 * All "risk" metrics use Pixalate results and are analytical categories.
 */

export interface DashboardKpis {
  totalRecords: number;
  totalResults: number;
  successfulChecks: number;
  failedChecks: number;
  remainingQuota: number | null;
  averageRisk: number | null;
  medianRisk: number | null;
  highestRisk: number | null;
  lowestRisk: number | null;
  highRiskRecords: number;
  veryHighRiskRecords: number;
  lowerRiskRecords: number;
  elevatedRiskRecords: number;
  uniqueIps: number;
  uniqueRidas: number;
  uniqueUserAgents: number;
  uniqueIpRidaCombos: number;
  totalRequests: number;
  repeatIpRate: number | null; // (requests - uniqueIPs) / requests
  repeatRidaRate: number | null;
  lastRun: string | null;
  pctLower: number | null;
  pctElevated: number | null;
  pctHigh: number | null;
  pctVeryHigh: number | null;
  distribution: Array<{ bin: string; from: number; to: number; count: number; pct: number }>;
}

export async function dashboardKpis(): Promise<DashboardKpis> {
  const db = getDb();
  const one = async <T>(sql: string, ...params: unknown[]): Promise<T> =>
    ((await db.prepare(sql).get(...params)) as unknown) as T;

  const totalRecords = (await one<{ n: number }>("SELECT COUNT(*) AS n FROM traffic_records")).n;
  const totalResults = (await one<{ n: number }>("SELECT COUNT(*) AS n FROM pixalate_results")).n;
  const successfulChecks = (await one<{ n: number }>("SELECT COUNT(*) AS n FROM pixalate_results WHERE status = 'success'")).n;
  const failedChecks = totalResults - successfulChecks;

  const riskRows = (await one<{ rows: string | null }>(
    `SELECT json_group_array(fraud_probability) AS rows FROM pixalate_results
     WHERE status = 'success' AND fraud_probability IS NOT NULL`
  )).rows;
  const values: number[] = riskRows ? (JSON.parse(riskRows) as number[]).filter((v): v is number => v !== null) : [];
  values.sort((a, b) => a - b);

  const avgRisk = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const medianRisk = values.length
    ? values.length % 2 === 0
      ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2
      : values[Math.floor(values.length / 2)]
    : null;
  const highestRisk = values.length ? values[values.length - 1] : null;
  const lowestRisk = values.length ? values[0] : null;

  const bandCounts: Record<RiskBand, number> = { lower: 0, elevated: 0, high: 0, very_high: 0 };
  for (const v of values) bandCounts[await classifyRisk(v)] += 1;
  const pct = (n: number) => (values.length ? (n / values.length) * 100 : null);

  const uniqueIps = (await one<{ n: number }>(
    "SELECT COUNT(DISTINCT ip) AS n FROM traffic_records WHERE ip IS NOT NULL AND ip != ''"
  )).n;
  const uniqueRidas = (await one<{ n: number }>(
    "SELECT COUNT(DISTINCT rida) AS n FROM traffic_records WHERE rida IS NOT NULL AND rida != ''"
  )).n;
  const uniqueUserAgents = (await one<{ n: number }>(
    "SELECT COUNT(DISTINCT user_agent) AS n FROM traffic_records WHERE user_agent IS NOT NULL AND user_agent != ''"
  )).n;
  const uniqueIpRidaCombos = (await one<{ n: number }>(
    "SELECT COUNT(DISTINCT ip || '|' || rida) AS n FROM traffic_records WHERE ip IS NOT NULL AND ip != '' AND rida IS NOT NULL AND rida != ''"
  )).n;
  const totalRequests = totalRecords;
  const repeatIpRate = uniqueIps > 0 ? (totalRequests - uniqueIps) / totalRequests : null;
  const repeatRidaRate = uniqueRidas > 0 ? (totalRequests - uniqueRidas) / totalRequests : null;

  // Histogram over the standard bins
  const binCounts = new Array(DEFAULT_HISTOGRAM_BINS.length).fill(0);
  for (const v of values) binCounts[histogramBin(v)] += 1;
  const distribution = DEFAULT_HISTOGRAM_BINS.map((bin, i) => ({
    bin: `${bin.from.toFixed(2)}–${bin.to.toFixed(2)}`,
    from: bin.from,
    to: bin.to,
    count: binCounts[i],
    pct: values.length ? (binCounts[i] / values.length) * 100 : 0,
  }));

  const lastRunRow = (await db
    .prepare("SELECT started_at FROM analysis_runs ORDER BY started_at DESC LIMIT 1")
    .get()) as { started_at: string | null } | undefined;
  const lastRun = lastRunRow?.started_at ?? null;

  return {
    totalRecords,
    totalResults,
    successfulChecks,
    failedChecks,
    remainingQuota: null, // filled by route with quota manager
    averageRisk: avgRisk,
    medianRisk: medianRisk,
    highestRisk,
    lowestRisk,
    highRiskRecords: bandCounts.high,
    veryHighRiskRecords: bandCounts.very_high,
    lowerRiskRecords: bandCounts.lower,
    elevatedRiskRecords: bandCounts.elevated,
    uniqueIps,
    uniqueRidas,
    uniqueUserAgents,
    uniqueIpRidaCombos,
    totalRequests,
    repeatIpRate,
    repeatRidaRate,
    lastRun,
    pctLower: pct(bandCounts.lower),
    pctElevated: pct(bandCounts.elevated),
    pctHigh: pct(bandCounts.high),
    pctVeryHigh: pct(bandCounts.very_high),
    distribution,
  };
}

// ---- channel analysis ------------------------------------------------------

export interface ChannelStats {
  channelId: number;
  channelName: string;
  isActive: boolean;
  totalRecords: number;
  uniqueIps: number;
  uniqueRidas: number;
  averageRisk: number | null;
  medianRisk: number | null;
  highRiskPct: number | null;
  veryHighRiskPct: number | null;
  lowerRiskPct: number | null;
  elevatedRiskPct: number | null;
  pixalateFailures: number;
  countryDistribution: Array<{ country: string; count: number }>;
  deviceAgentDistribution: Array<{ label: string; count: number }>;
  resultsAnalyzed: number;
}

export async function channelStats(channelId: number | null): Promise<ChannelStats[]> {
  const db = getDb();
  const channels = (await db.prepare("SELECT id, name, is_active FROM channels ORDER BY name").all()) as Array<{
    id: number;
    name: string;
    is_active: number;
  }>;

  const result: ChannelStats[] = [];
  for (const c of channels.filter((ch) => channelId === null || ch.id === channelId)) {
    const records = (await db.prepare("SELECT COUNT(*) AS n FROM traffic_records WHERE channel_id = ?").get(c.id)) as {
      n: number;
    };
    const uniqueIps = (await db
      .prepare("SELECT COUNT(DISTINCT ip) AS n FROM traffic_records WHERE channel_id = ? AND ip IS NOT NULL AND ip != ''")
      .get(c.id)) as { n: number };
    const uniqueRidas = (await db
      .prepare("SELECT COUNT(DISTINCT rida) AS n FROM traffic_records WHERE channel_id = ? AND rida IS NOT NULL AND rida != ''")
      .get(c.id)) as { n: number };

    const riskRows = (await db
      .prepare(
        `SELECT pr.fraud_probability FROM pixalate_results pr
         JOIN traffic_records r ON r.id = pr.record_id
         WHERE r.channel_id = ? AND pr.status = 'success' AND pr.fraud_probability IS NOT NULL`
      )
      .all(c.id)) as Array<{ fraud_probability: number }>;
    const values = riskRows.map((r) => r.fraud_probability).sort((a, b) => a - b);
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    const median = values.length
      ? values.length % 2 === 0
        ? (values[values.length / 2 - 1] + values[values.length / 2]) / 2
        : values[Math.floor(values.length / 2)]
      : null;
    const bands: Record<RiskBand, number> = { lower: 0, elevated: 0, high: 0, very_high: 0 };
    for (const v of values) bands[await classifyRisk(v)] += 1;
    const pctOf = (n: number) => (values.length ? (n / values.length) * 100 : null);

    const failures = (await db
      .prepare(
        `SELECT COUNT(*) AS n FROM pixalate_results pr
         JOIN traffic_records r ON r.id = pr.record_id
         WHERE r.channel_id = ? AND pr.status = 'error'`
      )
      .get(c.id)) as { n: number };

    const countryRows = (await db
      .prepare(
        `SELECT r.country AS country, COUNT(*) AS count FROM traffic_records r
         WHERE r.channel_id = ? AND r.country IS NOT NULL AND r.country != ''
         GROUP BY r.country ORDER BY count DESC LIMIT 10`
      )
      .all(c.id)) as Array<{ country: string; count: number }>;

    const deviceRows = (await db
      .prepare(
        `SELECT
           SUM(CASE WHEN r.rida IS NOT NULL AND r.rida != '' THEN 1 ELSE 0 END) AS with_rida,
           SUM(CASE WHEN r.user_agent IS NOT NULL AND r.user_agent != '' THEN 1 ELSE 0 END) AS with_ua,
           SUM(CASE WHEN r.ip IS NOT NULL AND r.ip != '' THEN 1 ELSE 0 END) AS with_ip
         FROM traffic_records r WHERE r.channel_id = ?`
      )
      .get(c.id)) as { with_rida: number; with_ua: number; with_ip: number };

    result.push({
      channelId: c.id,
      channelName: c.name,
      isActive: c.is_active === 1,
      totalRecords: records.n,
      uniqueIps: uniqueIps.n,
      uniqueRidas: uniqueRidas.n,
      averageRisk: avg,
      medianRisk: median,
      highRiskPct: pctOf(bands.high),
      veryHighRiskPct: pctOf(bands.very_high),
      lowerRiskPct: pctOf(bands.lower),
      elevatedRiskPct: pctOf(bands.elevated),
      pixalateFailures: failures.n,
      countryDistribution: countryRows,
      deviceAgentDistribution: [
        { label: "with RIDA", count: deviceRows.with_rida },
        { label: "with User-Agent", count: deviceRows.with_ua },
        { label: "with IP", count: deviceRows.with_ip },
      ],
      resultsAnalyzed: values.length,
    });
  }
  return result;
}

// ---- risk distribution -----------------------------------------------------

export async function runRiskDistribution(runId: string): Promise<Array<{ bin: string; count: number; pct: number }>> {
  const db = getDb();
  const rows = (await db
    .prepare(
      "SELECT fraud_probability FROM pixalate_results WHERE run_id = ? AND status = 'success' AND fraud_probability IS NOT NULL"
    )
    .all(runId)) as Array<{ fraud_probability: number }>;
  const counts = new Array(DEFAULT_HISTOGRAM_BINS.length).fill(0);
  for (const r of rows) counts[histogramBin(r.fraud_probability)] += 1;
  const total = rows.length || 1;
  return DEFAULT_HISTOGRAM_BINS.map((bin, i) => ({
    bin: `${bin.from.toFixed(2)}–${bin.to.toFixed(2)}`,
    count: counts[i],
    pct: (counts[i] / total) * 100,
  }));
}

// ---- temporal analysis -----------------------------------------------------

export interface TemporalRow {
  bucket: string;
  requests: number;
  avgRisk: number | null;
  highRiskPct: number | null;
}

export async function temporalAnalysis(
  runId: string,
  granularity: "hour" | "day" | "date" = "hour",
  limit = 168
): Promise<TemporalRow[]> {
  const db = getDb();
  const expr =
    granularity === "hour"
      ? "strftime('%Y-%m-%d %H:00', substr(r.timestamp,1,19))"
      : granularity === "day"
        ? "strftime('%Y-%m-%d %H', substr(r.timestamp,1,19))"
        : "substr(r.timestamp,1,10)";

  const rows = (await db
    .prepare(
      `SELECT ${expr} AS bucket,
              COUNT(*) AS requests,
              AVG(pr.fraud_probability) AS avg_risk,
              SUM(CASE WHEN pr.fraud_probability >= 0.75 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS high_risk_pct
       FROM pixalate_results pr
       JOIN traffic_records r ON r.id = pr.record_id
       WHERE pr.run_id = ? AND pr.status = 'success' AND r.timestamp IS NOT NULL AND r.timestamp != ''
       GROUP BY bucket ORDER BY bucket ASC LIMIT ?`
    )
    .all(runId, limit)) as Array<{
    bucket: string;
    requests: number;
    avg_risk: number | null;
    high_risk_pct: number | null;
  }>;
  return rows.map((r) => ({
    bucket: r.bucket,
    requests: r.requests,
    avgRisk: r.avg_risk,
    highRiskPct: r.high_risk_pct,
  }));
}

// ---- geo analysis ----------------------------------------------------------

export interface GeoRow {
  country: string;
  requests: number;
  avgRisk: number | null;
  highRiskPct: number | null;
  veryHighRiskPct: number | null;
}

export async function geoAnalysis(runId: string, limit = 20): Promise<GeoRow[]> {
  const db = getDb();
  const rows = (await db
    .prepare(
      `SELECT r.country AS country,
              COUNT(*) AS requests,
              AVG(pr.fraud_probability) AS avg_risk,
              SUM(CASE WHEN pr.fraud_probability >= 0.75 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS high_risk_pct,
              SUM(CASE WHEN pr.fraud_probability >= 0.9 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS very_high_risk_pct
       FROM pixalate_results pr
       JOIN traffic_records r ON r.id = pr.record_id
       WHERE pr.run_id = ? AND pr.status = 'success' AND r.country IS NOT NULL AND r.country != ''
       GROUP BY r.country ORDER BY requests DESC LIMIT ?`
    )
    .all(runId, limit)) as Array<{
    country: string;
    requests: number;
    avg_risk: number | null;
    high_risk_pct: number | null;
    very_high_risk_pct: number | null;
  }>;
  return rows.map((r) => ({
    country: r.country,
    requests: r.requests,
    avgRisk: r.avg_risk,
    highRiskPct: r.high_risk_pct,
    veryHighRiskPct: r.very_high_risk_pct,
  }));
}

// ---- duplicates / unique analysis ------------------------------------------

export interface DuplicateStats {
  totalRequests: number;
  uniqueIps: number;
  uniqueRidas: number;
  uniqueIpRidaCombos: number;
  uniqueUserAgents: number;
  repeatIpRate: number | null;
  repeatRidaRate: number | null;
  topRepeatedIps: Array<{ value: string; count: number }>;
  topRepeatedRidas: Array<{ value: string; count: number }>;
}

export async function duplicateStats(limit = 10): Promise<DuplicateStats> {
  const db = getDb();
  const total = ((await db.prepare("SELECT COUNT(*) AS n FROM traffic_records").get()) as { n: number }).n;
  const uniqueIps = ((await db
    .prepare("SELECT COUNT(DISTINCT ip) AS n FROM traffic_records WHERE ip IS NOT NULL AND ip != ''")
    .get()) as { n: number }).n;
  const uniqueRidas = ((await db
    .prepare("SELECT COUNT(DISTINCT rida) AS n FROM traffic_records WHERE rida IS NOT NULL AND rida != ''")
    .get()) as { n: number }).n;
  const uniqueIpRidaCombos = ((await db
    .prepare(
      "SELECT COUNT(DISTINCT ip || '|' || rida) AS n FROM traffic_records WHERE ip IS NOT NULL AND ip != '' AND rida IS NOT NULL AND rida != ''"
    )
    .get()) as { n: number }).n;
  const uniqueUserAgents = ((await db
    .prepare("SELECT COUNT(DISTINCT user_agent) AS n FROM traffic_records WHERE user_agent IS NOT NULL AND user_agent != ''")
    .get()) as { n: number }).n;

  const topRepeatedIps = (await db
    .prepare(
      `SELECT ip AS value, COUNT(*) AS count FROM traffic_records
       WHERE ip IS NOT NULL AND ip != '' GROUP BY ip HAVING COUNT(*) > 1 ORDER BY count DESC LIMIT ?`
    )
    .all(limit)) as Array<{ value: string; count: number }>;
  const topRepeatedRidas = (await db
    .prepare(
      `SELECT rida AS value, COUNT(*) AS count FROM traffic_records
       WHERE rida IS NOT NULL AND rida != '' GROUP BY rida HAVING COUNT(*) > 1 ORDER BY count DESC LIMIT ?`
    )
    .all(limit)) as Array<{ value: string; count: number }>;

  return {
    totalRequests: total,
    uniqueIps,
    uniqueRidas,
    uniqueIpRidaCombos,
    uniqueUserAgents,
    repeatIpRate: uniqueIps > 0 ? (total - uniqueIps) / total : null,
    repeatRidaRate: uniqueRidas > 0 ? (total - uniqueRidas) / total : null,
    topRepeatedIps,
    topRepeatedRidas,
  };
}

// ---- signal comparison -----------------------------------------------------

export interface SignalComparisonRow {
  requestId: string;
  recordId: string;
  channel: string | null;
  timestamp: string | null;
  ipScore: number | null;
  deviceScore: number | null;
  uaScore: number | null;
  ipDeviceScore: number | null;
  ipDeviceUaScore: number | null;
  bestScore: number | null;
  signalsAvailable: number;
}

/**
 * For records analyzed under multiple modes, compare the risk returned for
 * each signal combination. Primarily useful after an "auto" or multi-mode run.
 */
export async function signalComparison(runId: string, limit = 500): Promise<SignalComparisonRow[]> {
  const db = getDb();
  const rows = (await db
    .prepare(
      `SELECT pr.record_id, pr.analysis_mode, pr.fraud_probability,
              r.ad_request_id AS request_id, r.timestamp AS timestamp, c.name AS channel
       FROM pixalate_results pr
       JOIN traffic_records r ON r.id = pr.record_id
       LEFT JOIN channels c ON c.id = r.channel_id
       WHERE pr.run_id = ? AND pr.status = 'success'`
    )
    .all(runId)) as Array<{
    record_id: string;
    analysis_mode: string;
    fraud_probability: number | null;
    request_id: string | null;
    timestamp: string | null;
    channel: string | null;
  }>;

  const byRecord = new Map<string, SignalComparisonRow>();
  for (const row of rows) {
    let entry = byRecord.get(row.record_id);
    if (!entry) {
      entry = {
        requestId: row.request_id ?? row.record_id,
        recordId: row.record_id,
        channel: row.channel,
        timestamp: row.timestamp,
        ipScore: null,
        deviceScore: null,
        uaScore: null,
        ipDeviceScore: null,
        ipDeviceUaScore: null,
        bestScore: null,
        signalsAvailable: 0,
      };
      byRecord.set(row.record_id, entry);
    }
    const score = row.fraud_probability;
    switch (row.analysis_mode) {
      case "ip":
        entry.ipScore = score;
        break;
      case "device":
        entry.deviceScore = score;
        break;
      case "ua":
        entry.uaScore = score;
        break;
      case "ip_device":
        entry.ipDeviceScore = score;
        break;
      case "ip_device_ua":
        entry.ipDeviceUaScore = score;
        break;
      default:
        break;
    }
  }

  const result = [...byRecord.values()];
  for (const r of result) {
    const scores = [r.ipScore, r.deviceScore, r.uaScore, r.ipDeviceScore, r.ipDeviceUaScore].filter(
      (v): v is number => v !== null
    );
    r.signalsAvailable = scores.length;
    r.bestScore = scores.length ? Math.max(...scores) : null;
  }
  return result
    .filter((r) => r.signalsAvailable > 1)
    .sort((a, b) => (b.bestScore ?? 0) - (a.bestScore ?? 0))
    .slice(0, limit);
}

// ---- high-risk records -----------------------------------------------------

export interface HighRiskRow {
  recordId: string;
  requestId: string | null;
  timestamp: string | null;
  channel: string | null;
  ip: string | null;
  rida: string | null;
  userAgent: string | null;
  country: string | null;
  probability: number | null;
  band: RiskBand;
  signalsSubmitted: string[];
  responseStatus: number | null;
}

export async function highRiskRecords(runId: string | null, minRisk: number, limit = 500): Promise<HighRiskRow[]> {
  const db = getDb();
  const runClause = runId ? "AND pr.run_id = ?" : "";
  const params: unknown[] = [minRisk];
  if (runId) params.push(runId);
  params.push(limit);

  const rows = (await db
    .prepare(
      `SELECT pr.record_id, pr.fraud_probability, pr.signals_submitted, pr.http_status,
              r.ad_request_id, r.timestamp, r.ip, r.rida, r.user_agent, r.country, c.name AS channel
       FROM pixalate_results pr
       JOIN traffic_records r ON r.id = pr.record_id
       LEFT JOIN channels c ON c.id = r.channel_id
       WHERE pr.status = 'success' AND pr.fraud_probability >= ? ${runClause}
       ORDER BY pr.fraud_probability DESC LIMIT ?`
    )
    .all(...params)) as Array<{
    record_id: string;
    fraud_probability: number;
    signals_submitted: string;
    http_status: number | null;
    ad_request_id: string | null;
    timestamp: string | null;
    ip: string | null;
    rida: string | null;
    user_agent: string | null;
    country: string | null;
    channel: string | null;
  }>;

  return Promise.all(
    rows.map(async (r) => ({
      recordId: r.record_id,
      requestId: r.ad_request_id,
      timestamp: r.timestamp,
      channel: r.channel,
      ip: r.ip,
      rida: r.rida,
      userAgent: r.user_agent,
      country: r.country,
      probability: r.fraud_probability,
      band: await classifyRisk(r.fraud_probability),
      signalsSubmitted: JSON.parse(r.signals_submitted ?? "[]") as string[],
      responseStatus: r.http_status,
    }))
  );
}