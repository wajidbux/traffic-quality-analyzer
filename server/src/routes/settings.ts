import { Router } from "express";
import { AppContext } from "../context.js";
import { getAllSettings, getDb, getSettingNumber, setSetting } from "../db/database.js";
import { audit } from "../services/auditLogger.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const EDITABLE_KEYS = new Set([
  "mask_sensitive",
  "requests_per_minute",
  "max_concurrency",
  "retry_delay_ms",
  "max_retries",
  "request_timeout_ms",
  "quota_warn_yellow",
  "quota_warn_red",
  "risk_band_elevated_from",
  "risk_band_high_from",
  "risk_band_very_high_from",
  "retention_days",
  "dedupe_on_import",
  "company_name",
]);

export function settingsRouter(context: AppContext): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const settings = await getAllSettings();
      res.json({
        settings,
        editableKeys: [...EDITABLE_KEYS],
        apiKeyConfigured: context.apiKeyConfigured,
      });
    })
  );

  router.patch(
    "/",
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      const applied: Record<string, string> = {};
      const rejected: string[] = [];
      for (const [key, value] of Object.entries(body)) {
        if (!EDITABLE_KEYS.has(key)) {
          rejected.push(key);
          continue;
        }
        const str = String(value);
        // Light numeric validation for numeric settings
        if (key.startsWith("risk_band_")) {
          const n = Number(str);
          if (!Number.isFinite(n) || n < 0 || n > 1) {
            rejected.push(key);
            continue;
          }
        } else if (["requests_per_minute", "max_concurrency", "retry_delay_ms", "max_retries", "request_timeout_ms", "quota_warn_yellow", "quota_warn_red", "retention_days"].includes(key)) {
          const n = Number(str);
          if (!Number.isInteger(n) || n < 0) {
            rejected.push(key);
            continue;
          }
        }
        await setSetting(key, str);
        applied[key] = str;
      }
      if (Object.keys(applied).length) {
        await audit("settings.update", "settings", null, { applied: Object.keys(applied) });
      }
      res.json({ applied, rejected, settings: await getAllSettings() });
    })
  );

  /** Retention purge: delete records older than retention_days (0 = disabled). */
  router.post(
    "/retention/purge",
    asyncHandler(async (req, res) => {
      const days = req.body?.days !== undefined ? Number(req.body.days) : await getSettingNumber("retention_days", 0);
      if (!Number.isInteger(days) || days < 1) {
        return res.status(400).json({ error: "retention_days must be a positive integer." });
      }
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const runIds = (await getDb()
        .prepare(
          `SELECT DISTINCT r.id FROM analysis_runs r
           WHERE r.started_at < ? AND NOT EXISTS (SELECT 1 FROM traffic_records t WHERE t.timestamp >= ?)`
        )
        .all(cutoff, cutoff)) as Array<{ id: string }>;
      const oldRecords = (await getDb().prepare("SELECT id FROM traffic_records WHERE timestamp < ?").all(cutoff)) as Array<{
        id: string;
      }>;
      const ids = oldRecords.map((r) => r.id);
      if (ids.length > 0) {
        // Bulk-delete via parameter list; for very large sets this should be
        // chunked, but the expected scale (thousands of records) is fine here.
        const placeholders = ids.map(() => "?").join(",");
        await getDb()
          .prepare(`DELETE FROM traffic_records WHERE id IN (${placeholders})`)
          .run(...ids);
      }
      await audit("data.retention_purge", "traffic_records", null, { cutoff, deletedRecords: ids.length, runs: runIds.length });
      res.json({ deletedRecords: ids.length, cutoff });
    })
  );

  return router;
}