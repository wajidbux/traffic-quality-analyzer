import express, { NextFunction, Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, AppContext } from "./context.js";
import { logger } from "./utils/logger.js";
import { channelsRouter } from "./routes/channels.js";
import { recordsRouter } from "./routes/records.js";
import { runsRouter } from "./routes/runs.js";
import { pixalateRouter } from "./routes/pixalate.js";
import { statsRouter } from "./routes/stats.js";
import { reportsRouter } from "./routes/reports.js";
import { settingsRouter } from "./routes/settings.js";
import { auditRouter } from "./routes/audit.js";
import { ingestRouter } from "./routes/ingest.js";
import { ctvRouter } from "./routes/ctv.js";

export function createApp(contextOverride?: Partial<AppContext>): express.Express {
  const app = express();
  const context = createContext(contextOverride ?? {});
  app.locals.context = context;

  app.disable("x-powered-by");
  app.use(express.json({ limit: "25mb" }));

  // Request logging (sensitive headers redacted by the logger's serializers).
  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      if (req.path.startsWith("/api/")) {
        logger.info(
          { method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started },
          "request"
        );
      }
    });
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "traffic-quality-analyzer", time: new Date().toISOString() });
  });

  app.use("/api/channels", channelsRouter(context));
  app.use("/api/records", recordsRouter(context));
  app.use("/api/runs", runsRouter(context));
  app.use("/api/pixalate", pixalateRouter(context));
  app.use("/api/pixalate/ctv", ctvRouter(context));
  app.use("/api/stats", statsRouter(context));
  app.use("/api/reports", reportsRouter(context));
  app.use("/api/settings", settingsRouter(context));
  app.use("/api/audit", auditRouter(context));
  app.use("/api/ingest", ingestRouter(context));

  // 404 for unknown API routes
  // Serve the built frontend (client/dist/).
  // Resolve paths relative to this module (server/src/app.ts):
  //   app.ts → src/ → server/ → project root → client/dist/
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(__dirname, "..", "..");
  const clientDist = path.resolve(projectRoot, "client", "dist");
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    // SPA fallback: serve index.html for any non-API route.
    app.get("/*", (_req, res) =>
      res.sendFile(path.resolve(clientDist, "index.html"))
    );
  }

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Central error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, "unhandled error");
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

export type { AppContext };