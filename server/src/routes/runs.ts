import { Router } from "express";
import { AppContext } from "../context.js";
import {
  ANALYSIS_MODES,
  AnalysisMode,
  QuotaGuardError,
  cancelRun,
  getRun,
  listRuns,
  previewAnalysis,
  startAnalysis,
} from "../services/analyzer.js";
import { sampleStrategySchema, SampleFilter } from "../services/samplingService.js";
import { getDb } from "../db/database.js";
import { audit } from "../services/auditLogger.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export function runsRouter(context: AppContext): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      res.json({ runs: await listRuns(limit) });
    })
  );

  router.get("/modes", (_req, res) => {
    res.json({ modes: ANALYSIS_MODES });
  });

  /** IMPORT → SAMPLE → ESTIMATE: preview selected records + quota impact. */
  router.post(
    "/preview",
    asyncHandler(async (req, res) => {
      const { strategy, filter, mode } = req.body ?? {};
      const parsedStrategy = sampleStrategySchema.safeParse(strategy);
      if (!parsedStrategy.success) {
        return res.status(400).json({ error: `Invalid sample strategy: ${parsedStrategy.error.message}` });
      }
      const parsedMode = parseMode(mode);
      if (!parsedMode) return res.status(400).json({ error: `Invalid analysis mode. Use one of: ${ANALYSIS_MODES.join(", ")}` });
      const preview = await previewAnalysis(parsedStrategy.data, sanitizeFilter(filter), parsedMode);
      res.json(preview);
    })
  );

  /** ANALYZE: starts a run. Requires confirmed: true and passes the quota guard. */
  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const { strategy, filter, mode, name, confirmed, ignoreQuota } = req.body ?? {};
      const parsedStrategy = sampleStrategySchema.safeParse(strategy);
      if (!parsedStrategy.success) {
        return res.status(400).json({ error: `Invalid sample strategy: ${parsedStrategy.error.message}` });
      }
      const parsedMode = parseMode(mode);
      if (!parsedMode) return res.status(400).json({ error: `Invalid analysis mode. Use one of: ${ANALYSIS_MODES.join(", ")}` });
      if (confirmed !== true) {
        return res.status(409).json({
          error:
            "Analysis not started: confirmation is required. Preview the batch first, then send confirmed: true to run it.",
        });
      }
      try {
        const run = await startAnalysis(context.client, {
          name: typeof name === "string" ? name : undefined,
          strategy: parsedStrategy.data,
          filter: sanitizeFilter(filter),
          mode: parsedMode,
          confirmed: true,
          ignoreQuota: ignoreQuota === true,
        });
        res.status(201).json({ run });
      } catch (err) {
        if (err instanceof QuotaGuardError) {
          return res.status(409).json({ error: err.message });
        }
        throw err;
      }
    })
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const run = await getRun(req.params.id);
      if (!run) return res.status(404).json({ error: "Analysis run not found." });
      res.json({ run });
    })
  );

  router.post(
    "/:id/cancel",
    asyncHandler(async (req, res) => {
      const run = await getRun(req.params.id);
      if (!run) return res.status(404).json({ error: "Analysis run not found." });
      if (run.status !== "running" && run.status !== "pending") {
        return res.status(409).json({ error: `Run is already ${run.status}.` });
      }
      const cancelled = cancelRun(req.params.id);
      res.json({ ok: cancelled });
    })
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      const run = await getRun(id);
      if (!run) return res.status(404).json({ error: "Analysis run not found." });
      cancelRun(id);
      await getDb().prepare("DELETE FROM pixalate_results WHERE run_id = ?").run(id);
      await getDb().prepare("DELETE FROM analysis_runs WHERE id = ?").run(id);
      await audit("run.delete", "analysis_runs", id, { name: run.name });
      res.json({ ok: true });
    })
  );

  return router;
}

function parseMode(mode: unknown): AnalysisMode | null {
  return typeof mode === "string" && (ANALYSIS_MODES as string[]).includes(mode) ? (mode as AnalysisMode) : null;
}

function sanitizeFilter(filter: unknown): SampleFilter {
  if (!filter || typeof filter !== "object") return {};
  const f = filter as Record<string, unknown>;
  return {
    channelId: typeof f.channelId === "number" ? f.channelId : undefined,
    channelName: typeof f.channelName === "string" ? f.channelName : undefined,
    from: typeof f.from === "string" ? f.from : undefined,
    to: typeof f.to === "string" ? f.to : undefined,
    country: typeof f.country === "string" ? f.country : undefined,
  };
}