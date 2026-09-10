import { openDatabase, closeDatabase } from "./db/database.js";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";

await openDatabase();
const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info(
    {
      port: config.PORT,
      env: config.APP_ENV,
      apiKeyConfigured: config.PIXALATE_API_KEY.length > 0,
      database: config.DATABASE_URL,
    },
    "Traffic Quality Analyzer API listening"
  );
  if (!config.PIXALATE_API_KEY) {
    logger.warn("PIXALATE_API_KEY is not set. The Pixalate API pages will show 'API Key Configured: NO'.");
  }
});

function shutdown(signal: string): void {
  logger.info({ signal }, "shutting down");
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
  // Force-exit if graceful shutdown hangs.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));