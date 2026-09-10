import crypto from "node:crypto";
import { Router } from "express";
import { AppContext } from "../context.js";
import { ingestRecords, IngestValidationError } from "../services/ingestion.js";
import { TokenBucket } from "../utils/rateLimiter.js";
import { logger } from "../utils/logger.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const SAMPLE_PAYLOAD = {
  records: [
    {
      timestamp: "2026-09-01T10:00:00Z",
      channel: "Movie Vault",
      ip: "198.51.100.7",
      rida: "11111111-1111-4111-8111-111111111111",
      user_agent: "Roku/DVP-10 (Roku Ultra)",
      country: "US",
      region: "CA",
      ad_request_id: "adreq-000001",
    },
  ],
};

/** Constant-time string comparison to avoid leaking the ingest key. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function ingestRouter(context: AppContext): Router {
  const router = Router();
  const bucket = new TokenBucket(context.ingestion.ratePerMinute);
  const { enabled, apiKey, maxBatch } = context.ingestion;

  router.get("/status", (_req, res) => {
    res.json({
      enabled,
      endpoint: "POST /api/ingest",
      auth: "x-ingest-key: <INGESTION_API_KEY>",
      maxBatch,
      ratePerMinute: context.ingestion.ratePerMinute,
      stagesOnly: true,
      note: "Ingested records are staged for analysis only. No Pixalate calls are made by this endpoint.",
      samplePayload: SAMPLE_PAYLOAD,
    });
  });

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      if (!enabled) {
      return res.status(503).json({
        error: "API ingestion is disabled. Set INGESTION_API_KEY on the server to enable it.",
      });
    }
    // Auth: x-ingest-key header or Authorization: Bearer <key>
    const headerKey = req.headers["x-ingest-key"];
    const bearer = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined;
    const provided = typeof headerKey === "string" ? headerKey : bearer;
    if (!provided || !safeEqual(provided, apiKey)) {
      logger.warn({ ip: req.ip }, "ingestion rejected: invalid or missing ingest key");
      return res.status(401).json({ error: "Invalid or missing ingest key." });
    }
    if (!bucket.tryAcquire()) {
      return res.status(429).json({ error: `Ingestion rate limit exceeded (${context.ingestion.ratePerMinute}/min).` });
    }

    const payload = req.body;
    let recordsCount: number;
    if (Array.isArray(payload)) {
      recordsCount = payload.length;
    } else if (payload && typeof payload === "object" && Array.isArray((payload as { records?: unknown[] }).records)) {
      recordsCount = (payload as { records: unknown[] }).records.length;
    } else {
      recordsCount = 1;
    }
    if (recordsCount === 0) {
      return res.status(400).json({ error: "No records in payload." });
    }
    if (recordsCount > maxBatch) {
      return res.status(413).json({ error: `Batch of ${recordsCount} exceeds the maximum of ${maxBatch} records per request.` });
    }

    try {
      const outcome = await ingestRecords(payload);
      res.status(201).json({
        ok: true,
        received: outcome.received,
        imported: outcome.result.imported,
        duplicates: outcome.result.duplicates,
        skippedNoSignals: outcome.result.skippedNoSignals,
        rejected: outcome.rejected,
        unknownChannels: outcome.result.unknownChannels,
      });
    } catch (err) {
      if (err instanceof IngestValidationError) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
    })
  );

  return router;
}