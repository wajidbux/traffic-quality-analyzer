import { getDb, getSettingNumber, kvGet, kvSet } from "../db/database.js";
import { PixalateClientLike } from "../pixalate/types.js";
import { audit } from "./auditLogger.js";
import { logger } from "../utils/logger.js";
import { config } from "../config.js";

/**
 * Tracks Pixalate quota.
 *
 * Pixalate's metadata endpoint (the `/fraud` call with no parameters) returns
 * quota/status WITHOUT consuming an analysis call. We sync from it whenever
 * possible and maintain a local estimate of remaining calls in between:
 * every successful fraud-analysis call decrements the local count, so the
 * dashboard is accurate even when the metadata endpoint is unreachable or its
 * response shape changes.
 */

export interface QuotaSnapshot {
  limit: number | null;
  used: number | null;
  remaining: number | null;
  renewal: string | null;
  apiStatus: string | null;
  interval: number | null;
  timeUnit: string | null;
  lastCheckedAt: string | null;
  lastSuccessfulRequest: string | null;
  lastError: string | null;
  // Local-only bookkeeping
  localRemaining: number | null;
  localLimit: number | null;
}

const QUOTA_KEY = "quota_state";

/**
 * Atomically read the current snapshot and write the merged result inside a
 * single transaction, so concurrent callers (e.g. parallel analysis waves)
 * don't lose decrements.
 */
async function saveSnapshot(snapshot: Partial<QuotaSnapshot>): Promise<void> {
  await getDb().transaction(async (tx) => {
    const row = (await tx.prepare("SELECT value FROM kv_store WHERE key = ?").get(QUOTA_KEY)) as
      | { value: string }
      | undefined;
    const current: Partial<QuotaSnapshot> = row ? (JSON.parse(row.value) as Partial<QuotaSnapshot>) ?? {} : {};
    await tx
      .prepare("INSERT INTO kv_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(QUOTA_KEY, JSON.stringify({ ...current, ...snapshot }));
  });
}

export async function getQuotaSnapshot(): Promise<QuotaSnapshot> {
  const state = (await kvGet<Partial<QuotaSnapshot>>(QUOTA_KEY)) ?? {};
  return {
    limit: state.limit ?? null,
    used: state.used ?? null,
    remaining: state.remaining ?? null,
    renewal: state.renewal ?? null,
    apiStatus: state.apiStatus ?? null,
    interval: state.interval ?? null,
    timeUnit: state.timeUnit ?? null,
    lastCheckedAt: state.lastCheckedAt ?? null,
    lastSuccessfulRequest: state.lastSuccessfulRequest ?? null,
    lastError: state.lastError ?? null,
    localRemaining: state.localRemaining ?? null,
    localLimit: state.localLimit ?? null,
  };
}

/** Sync quota from the Pixalate metadata endpoint. Returns updated snapshot. */
export async function refreshQuota(client: PixalateClientLike): Promise<QuotaSnapshot> {
  const meta = await client.getMetadata();
  const snapshot: Partial<QuotaSnapshot> = {
    limit: meta.limit,
    used: meta.used,
    remaining: meta.remaining,
    renewal: meta.renewal,
    apiStatus: meta.apiStatus,
    interval: meta.interval,
    timeUnit: meta.timeUnit,
    lastCheckedAt: new Date().toISOString(),
    lastSuccessfulRequest: new Date().toISOString(),
    localLimit: meta.limit,
    localRemaining: meta.remaining,
  };
  await saveSnapshot(snapshot);
  await audit("quota.check", "pixalate", null, { limit: meta.limit, used: meta.used, remaining: meta.remaining });
  return getQuotaSnapshot();
}

/** Record a successful analysis call (decrements the local estimate).
 * The read + write happen in one transaction so concurrent callers don't
 * lose decrements. */
export async function recordAnalysisCall(consumedQuota: boolean): Promise<void> {
  await getDb().transaction(async (tx) => {
    const row = (await tx.prepare("SELECT value FROM kv_store WHERE key = ?").get(QUOTA_KEY)) as
      | { value: string }
      | undefined;
    const state: Partial<QuotaSnapshot> = row ? (JSON.parse(row.value) as Partial<QuotaSnapshot>) ?? {} : {};
    const next: Partial<QuotaSnapshot> = { lastSuccessfulRequest: new Date().toISOString() };
    if (consumedQuota) {
      if (state.localRemaining !== null && typeof state.localRemaining === "number") next.localRemaining = Math.max(0, state.localRemaining - 1);
      if (state.localLimit !== null && typeof state.used === "number") next.used = state.used + 1;
    }
    await tx
      .prepare("INSERT INTO kv_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(QUOTA_KEY, JSON.stringify({ ...state, ...next }));
  });
}

/**
 * Batch-decrement the quota once for a wave of analysis calls.
 * Uses a single transaction instead of one-per-call, so a 120-record run
 * only touches kv_store once per wave instead of 120 times. This avoids the
 * SQLite write-lock serialization that can stall the response.
 */
export async function recordAnalysisBatch(consumedCount: number): Promise<void> {
  await getDb().transaction(async (tx) => {
    const row = (await tx.prepare("SELECT value FROM kv_store WHERE key = ?").get(QUOTA_KEY)) as
      | { value: string }
      | undefined;
    const state: Partial<QuotaSnapshot> = row ? (JSON.parse(row.value) as Partial<QuotaSnapshot>) ?? {} : {};
    const next: Partial<QuotaSnapshot> = { lastSuccessfulRequest: new Date().toISOString() };
    if (consumedCount > 0) {
      if (state.localRemaining !== null && typeof state.localRemaining === "number") {
        next.localRemaining = Math.max(0, state.localRemaining - consumedCount);
      }
      if (state.localLimit !== null && typeof state.used === "number") {
        next.used = Math.max(0, (state.used || 0) + consumedCount);
      }
    }
    await tx
      .prepare("INSERT INTO kv_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(QUOTA_KEY, JSON.stringify({ ...state, ...next }));
  });
}

export async function recordQuotaError(message: string): Promise<void> {
  await saveSnapshot({ lastError: message });
}

/** Reset local estimates when a metadata sync returns fresh numbers. */
export async function applyMetadata(limit: number | null, remaining: number | null): Promise<void> {
  await saveSnapshot({ localLimit: limit, localRemaining: remaining });
}

export async function getEffectiveRemaining(): Promise<number | null> {
  const snapshot = await getQuotaSnapshot();
  return snapshot.localRemaining ?? snapshot.remaining;
}

export type QuotaLevel = "green" | "yellow" | "red" | "unknown";

export async function quotaLevel(remaining: number | null): Promise<QuotaLevel> {
  if (remaining === null) return "unknown";
  const yellow = await getSettingNumber("quota_warn_yellow", config.QUOTA_WARN_YELLOW);
  const red = await getSettingNumber("quota_warn_red", config.QUOTA_WARN_RED);
  if (remaining <= red) return "red";
  if (remaining <= yellow) return "yellow";
  return "green";
}

export async function getQuotaWarnings(): Promise<{ yellow: number; red: number }> {
  return {
    yellow: await getSettingNumber("quota_warn_yellow", config.QUOTA_WARN_YELLOW),
    red: await getSettingNumber("quota_warn_red", config.QUOTA_WARN_RED),
  };
}

export async function logUsage(entry: {
  endpoint: "analysis" | "metadata" | "test";
  httpStatus: number | null;
  latencyMs: number | null;
  quotaBefore: number | null;
  quotaAfter: number | null;
  success: boolean;
}): Promise<void> {
  try {
    await getDb()
      .prepare(
        `INSERT INTO api_usage (endpoint, http_status, latency_ms, quota_before, quota_after, success)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(entry.endpoint, entry.httpStatus, entry.latencyMs, entry.quotaBefore, entry.quotaAfter, entry.success ? 1 : 0);
  } catch (err) {
    logger.warn({ err }, "failed to log api usage");
  }
}

export async function listUsage(limit = 100): Promise<Array<Record<string, unknown>>> {
  return (await getDb().prepare("SELECT * FROM api_usage ORDER BY id DESC LIMIT ?").all(limit)) as Array<
    Record<string, unknown>
  >;
}