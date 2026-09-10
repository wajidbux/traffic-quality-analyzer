import { Router } from "express";
import { AppContext } from "../context.js";
import {
  buildReportPayload,
  buildSspPayload,
  exportAllCsv,
  generatePdf,
  generateResultsCsv,
  generateSspPdf,
  generateXlsx,
  recordReportAudit,
} from "../services/reportGenerator.js";
import { getRun } from "../services/analyzer.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export function reportsRouter(_context: AppContext): Router {
  const router = Router();

  async function requireRun(runId: string): Promise<{ ok: boolean; status?: number; error?: string }> {
    if (!(await getRun(runId))) return { ok: false, status: 404, error: "Analysis run not found." };
    return { ok: true };
  }

  router.get(
    "/:runId/pdf",
    asyncHandler(async (req, res) => {
      const check = await requireRun(req.params.runId);
      if (!check.ok) return res.status(check.status!).json({ error: check.error });
      try {
        const payload = await buildReportPayload(req.params.runId);
        const buffer = await generatePdf(payload);
        await recordReportAudit("full", req.params.runId);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="traffic-quality-report-${req.params.runId.slice(0, 8)}.pdf"`);
        res.send(buffer);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    })
  );

  router.get(
    "/:runId/xlsx",
    asyncHandler(async (req, res) => {
      const check = await requireRun(req.params.runId);
      if (!check.ok) return res.status(check.status!).json({ error: check.error });
      try {
        const payload = await buildReportPayload(req.params.runId);
        const buffer = await generateXlsx(payload);
        await recordReportAudit("full", req.params.runId);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="traffic-quality-report-${req.params.runId.slice(0, 8)}.xlsx"`);
        res.send(buffer);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    })
  );

  router.get(
    "/:runId/csv",
    asyncHandler(async (req, res) => {
      const check = await requireRun(req.params.runId);
      if (!check.ok) return res.status(check.status!).json({ error: check.error });
      const csv = await generateResultsCsv(req.params.runId);
      await recordReportAudit("full", req.params.runId);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="traffic-quality-results-${req.params.runId.slice(0, 8)}.csv"`);
      res.send(csv);
    })
  );

  /** SSP-facing summary (PDF) — no raw identifiers. */
  router.get(
    "/:runId/ssp",
    asyncHandler(async (req, res) => {
      const check = await requireRun(req.params.runId);
      if (!check.ok) return res.status(check.status!).json({ error: check.error });
      const channel = typeof req.query.channel === "string" ? req.query.channel : null;
      try {
        const payload = await buildSspPayload(req.params.runId, channel);
        const buffer = await generateSspPdf(payload);
        await recordReportAudit("ssp", req.params.runId);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="ssp-traffic-quality-summary-${req.params.runId.slice(0, 8)}.pdf"`);
        res.send(buffer);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    })
  );

  /** Export all stored records + results as CSV. */
  router.get(
    "/export-all",
    asyncHandler(async (_req, res) => {
      const csv = await exportAllCsv();
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="traffic-quality-export-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(csv);
    })
  );

  return router;
}