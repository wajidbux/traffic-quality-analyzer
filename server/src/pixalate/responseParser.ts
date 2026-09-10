/**
 * Pixalate response parsing.
 *
 * Verified against the live OpenAPI spec (Ad Fraud API v2.0.1,
 * https://api.pixalate.com/.well-known/api/v2/fraud/fraud.yml):
 *
 *   FraudInfo: { probability: number }   // 0.1–1.0; 0.0 indicates unknown
 *   Metadata:  {
 *     database: { lastUpdated: string },
 *     quota: {
 *       available: integer,   // quota remaining
 *       used: integer,
 *       expiry: string,       // refresh datetime (ISO)
 *       limit: integer,
 *       interval: integer,    // number of time units in the refresh window
 *       timeUnit: 'minute'|'hour'|'day'|'week'|'month',
 *     },
 *   }
 *
 * Parsing remains tolerant (candidate field names are also probed) and the
 * verbatim response body is always retained for the audit trail. If Pixalate
 * changes field names, fix them HERE, in one place.
 */

interface AnyRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstDefined(record: AnyRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Unwrap common wrappers like { data: {...} } or { result: {...} }. */
function unwrap(record: AnyRecord): AnyRecord {
  for (const key of ["data", "result", "response", "payload"]) {
    const v = record[key];
    if (isRecord(v)) return v;
  }
  return record;
}

const PROBABILITY_KEYS = [
  "probability", // documented FraudInfo field
  "fraud_probability",
  "fraudProbability",
  "risk_score",
  "riskScore",
  "score",
  "fraudScore",
  "fraud_score",
  "risk",
];

/**
 * Extract a fraud probability (0–1) from a response body.
 * Per the spec, 0.0 indicates UNKNOWN — we return null for it so records with
 * an unknown score are not silently treated as "lower risk". Returns null if
 * absent.
 */
export function extractFraudProbability(body: unknown): number | null {
  if (!isRecord(body)) return null;
  const record = unwrap(body);
  const raw = firstDefined(record, PROBABILITY_KEYS);
  if (raw === undefined) {
    // Some API shapes express it as a percentage (0–100).
    const pct = firstDefined(record, ["fraud_percentage", "fraudPercentage", "percentage"]);
    const p = toNumber(pct);
    if (p !== null) return clampProbability(p / 100);
    return null;
  }
  const p = toNumber(raw);
  if (p === null) return null;
  // Probability expressed as percentage (e.g. 92) vs fraction (0.92).
  const normalized = p > 1 ? clampProbability(p / 100) : clampProbability(p);
  // 0.0 = unknown per the spec.
  return normalized === 0 ? null : normalized;
}

function clampProbability(p: number): number {
  if (p < 0) return 0;
  if (p > 1) return 1;
  return p;
}

const QUOTA_LIMIT_KEYS = ["limit", "quota_limit", "quotaLimit", "daily_limit", "dailyLimit", "max_calls", "maxCalls", "total_quota", "totalQuota"];
const QUOTA_USED_KEYS = ["used", "quota_used", "quotaUsed", "calls_made", "callsMade", "usage"];
// `available` is the documented Metadata schema field for remaining quota.
const QUOTA_REMAINING_KEYS = ["available", "quota_remaining", "quotaRemaining", "remaining", "remaining_calls", "remainingCalls"];
const RENEWAL_KEYS = ["expiry", "renewal_date", "renewalDate", "renewal", "reset_date", "resetDate", "next_reset", "nextReset", "expires_at", "expiresAt", "expiration"];
const STATUS_KEYS = ["status", "message", "state", "api_status", "apiStatus"];

/** Extract quota state from the metadata response. */
export function extractQuotaState(body: unknown, httpStatus: number, latencyMs: number): {
  limit: number | null;
  used: number | null;
  remaining: number | null;
  renewal: string | null;
  apiStatus: string | null;
  interval: number | null;
  timeUnit: string | null;
  raw: unknown;
} {
  let record: AnyRecord = {};
  if (isRecord(body)) record = body;

  // Quota is nested per the spec: { database: {...}, quota: { available, used, expiry, limit, interval, timeUnit } }
  const quotaObj = isRecord(record["quota"])
    ? (record["quota"] as AnyRecord)
    : isRecord(record["data"]) && isRecord((record["data"] as AnyRecord)["quota"])
      ? ((record["data"] as AnyRecord)["quota"] as AnyRecord)
      : {};

  const limitRaw = firstDefined(record, QUOTA_LIMIT_KEYS) ?? firstDefined(quotaObj, QUOTA_LIMIT_KEYS);
  const usedRaw = firstDefined(record, QUOTA_USED_KEYS) ?? firstDefined(quotaObj, QUOTA_USED_KEYS);
  const remainingRaw = firstDefined(record, QUOTA_REMAINING_KEYS) ?? firstDefined(quotaObj, QUOTA_REMAINING_KEYS);
  const renewal = firstDefined(record, RENEWAL_KEYS) ?? firstDefined(quotaObj, RENEWAL_KEYS);
  const statusRaw = firstDefined(record, STATUS_KEYS) ?? firstDefined(quotaObj, STATUS_KEYS);
  const intervalRaw = firstDefined(quotaObj, ["interval"]) ?? firstDefined(record, ["interval"]);
  const timeUnitRaw = firstDefined(quotaObj, ["timeUnit", "time_unit"]) ?? firstDefined(record, ["timeUnit", "time_unit"]);

  // If only limit+used are present, derive remaining.
  const limit = toNumber(limitRaw);
  const used = toNumber(usedRaw);
  let remaining = toNumber(remainingRaw);
  if (remaining === null && limit !== null && used !== null) remaining = Math.max(0, limit - used);

  return {
    limit,
    used,
    remaining,
    renewal: typeof renewal === "string" ? renewal : renewal ? String(renewal) : null,
    apiStatus: typeof statusRaw === "string" ? statusRaw : statusRaw ? String(statusRaw) : null,
    interval: toNumber(intervalRaw),
    timeUnit: typeof timeUnitRaw === "string" ? timeUnitRaw : timeUnitRaw ? String(timeUnitRaw) : null,
    raw: body,
  };
}

/** Best-effort detection that a response body indicates quota exhaustion. */
export function looksLikeQuotaExhaustion(body: unknown): boolean {
  if (!isRecord(body)) return false;
  const text = JSON.stringify(body).toLowerCase();
  return (
    text.includes("quota") &&
    (text.includes("exhaust") || text.includes("exceed") || text.includes("limit reached") || text.includes("no more"))
  );
}