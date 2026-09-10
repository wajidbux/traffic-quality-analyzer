import { Router } from "express";
import { AppContext } from "../context.js";
import {
  addManualRecord,
  countRecords,
  deleteAllRecords,
  guessColumnMap,
  importRecords,
  listRecords,
  parseCsv,
} from "../services/importer.js";
import { getSetting, setSetting } from "../db/database.js";
import { maskRecord } from "../utils/masking.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export function recordsRouter(_context: AppContext): Router {
  const router = Router();

  const mask = async (rows: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> => {
    const enabled = (await getSetting("mask_sensitive")) !== "false";
    if (!enabled) return rows;
    return rows.map((r) => maskRecord(r));
  };

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const limit = Number(req.query.limit ?? 100);
      const offset = Number(req.query.offset ?? 0);
      const channelId = req.query.channelId ? Number(req.query.channelId) : null;
      const q = typeof req.query.q === "string" ? req.query.q : null;
      const rows = await listRecords({ limit, offset, channelId, q });
      res.json({ records: await mask(rows), total: await countRecords() });
    })
  );

  /** Probes a CSV's header row and returns a suggested column map. */
  router.post(
    "/guess-columns",
    asyncHandler(async (req, res) => {
      const { content } = req.body ?? {};
      if (typeof content !== "string" || !content.trim()) {
        return res.status(400).json({ error: "No CSV content provided." });
      }
      try {
        const headerLine = content.split(/\r?\n/, 1)[0];
        const headers = headerLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
        const map = guessColumnMap(headers);
        res.json({ headers, map });
      } catch {
        res.status(400).json({ error: "Could not parse the CSV header row." });
      }
    })
  );

  router.post(
    "/import",
    asyncHandler(async (req, res) => {
      const { content, filename, column_map, dedupe } = req.body ?? {};
      if (typeof content !== "string" || !content.trim()) {
        return res.status(400).json({ error: "No CSV content provided. Send { content, column_map }." });
      }
      if (filename && !/\.(csv|txt)$/i.test(filename)) {
        return res.status(400).json({ error: "Only .csv files are supported." });
      }
      let map = column_map;
      if (!map || typeof map !== "object") {
        try {
          const headerLine = content.split(/\r?\n/, 1)[0];
          const headers = headerLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
          map = guessColumnMap(headers);
        } catch {
          return res.status(400).json({ error: "Could not determine CSV columns." });
        }
      }
      let parsed;
      try {
        parsed = parseCsv(content, map as never);
      } catch (err) {
        return res.status(400).json({ error: `CSV parse error: ${(err as Error).message}` });
      }
      if (parsed.length === 0) {
        return res.status(400).json({ error: "CSV contained no data rows." });
      }
      const previous = await getSetting("dedupe_on_import");
      if (dedupe !== undefined) {
        await setSetting("dedupe_on_import", dedupe ? "true" : "false");
      }
      try {
        const result = await importRecords(parsed, "csv");
        if (previous !== null) await setSetting("dedupe_on_import", previous);
        res.status(201).json({ ...result, columnMapUsed: map, records: await mask(result.records) });
      } catch (err) {
        res.status(500).json({ error: `Import failed: ${(err as Error).message}` });
      }
    })
  );

  router.post(
    "/manual",
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      const hasAnySignal = Boolean(body.ip || body.rida || body.device_id || body.user_agent);
      if (!hasAnySignal) {
        return res.status(400).json({ error: "At least one signal is required (IP, RIDA/device ID, or User-Agent)." });
      }
      try {
        const id = await addManualRecord({
          channelId: body.channel_id ? Number(body.channel_id) : null,
          timestamp: body.timestamp ?? null,
          ip: body.ip ?? null,
          rida: body.rida ?? null,
          device_id: body.device_id ?? null,
          user_agent: body.user_agent ?? null,
          country: body.country ?? null,
          region: body.region ?? null,
          ad_request_id: body.ad_request_id ?? null,
        });
        res.status(201).json({ id });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    })
  );

  router.delete(
    "/",
    asyncHandler(async (_req, res) => {
      const result = await deleteAllRecords();
      res.json(result);
    })
  );

  return router;
}