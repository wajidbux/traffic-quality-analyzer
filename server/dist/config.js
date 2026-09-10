import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { z } from "zod";
/**
 * Central application configuration, loaded from environment variables.
 * The Pixalate API key is loaded here and NEVER exposed to the frontend
 * or written to logs.
 */
const envSchema = z.object({
    APP_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),
    PORT: z.coerce.number().int().positive().default(3001),
    // Pixalate
    PIXALATE_API_KEY: z.string().optional().default(""),
    // Ad Fraud API base URL.
    // Default: https://fraud-api.pixalate.com (Pixalate's dedicated Ad Fraud host).
    // If your key is provisioned on api.pixalate.com instead, set this to
    // https://api.pixalate.com — but note the Ad Fraud path (/api/v2/fraud) must
    // be registered on that host or you will get 403 MissingAuthenticationToken.
    PIXALATE_BASE_URL: z.string().url().default("https://fraud-api.pixalate.com"),
    // Path of the fraud analysis endpoint.
    // CTV Apps API base URL (GET /mrt/ctv, GET /mrt/ctv/{appId}).
    // The CTV Apps API lives at api.pixalate.com (different from the
    // fraud-api.pixalate.com used by the Ad Fraud API).
    PIXALATE_CTV_BASE_URL: z.string().url().default("https://api.pixalate.com"),
    // CTV Apps API path (GET /mrt/ctv, GET /mrt/ctv/{appId}).
    PIXALATE_CTV_PATH: z.string().default("/mrt/ctv").transform((v) => {
        const gitPrefix = process.platform === "win32" ? "C:/Program Files/Git" : null;
        if (gitPrefix && v.startsWith(gitPrefix)) {
            return v.slice(gitPrefix.length) || "/mrt/ctv";
        }
        return v;
    }),
    // NOTE: on some Windows + git-bash setups, Node's `--env-file` loader can
    // miscompile a value starting with `/` (e.g. `/api/v2/fraud`) by resolving it
    // relative to the git-bash prefix (`C:/Program Files/Git`). We sanitize here.
    PIXALATE_FRAUD_PATH: z.string().default("/api/v2/fraud").transform((v) => {
        // Strip a leading git-bash path prefix if Node's env-file loader injected one.
        const gitPrefix = process.platform === "win32" ? "C:/Program Files/Git" : null;
        if (gitPrefix && v.startsWith(gitPrefix)) {
            return v.slice(gitPrefix.length) || "/api/v2/fraud";
        }
        return v;
    }),
    // Database. Defaults to a local SQLite file. To use PostgreSQL, point
    // DATABASE_URL at a postgres:// (or postgresql://) connection string, e.g.
    //   postgres://user:pass@localhost:5432/traffic_quality
    // The schema is applied automatically on startup for both drivers.
    DATABASE_URL: z.string().default("sqlite:./data/tqa.sqlite"),
    DATABASE_DIR: z.string().default("./data"),
    // Webhook / API ingestion (ad server or SSP pushes traffic records in).
    // Empty key = ingestion disabled. This is a SEPARATE key from the Pixalate
    // key — never reuse PIXALATE_API_KEY for ingestion.
    INGESTION_API_KEY: z.string().optional().default(""),
    INGESTION_MAX_BATCH: z.coerce.number().int().min(1).max(100_000).default(1000),
    INGESTION_RATE_PER_MINUTE: z.coerce.number().int().min(1).default(120),
    // Analysis engine defaults (all overridable per-run / via Settings page)
    REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).default(30),
    MAX_CONCURRENCY: z.coerce.number().int().min(1).default(5),
    RETRY_DELAY_MS: z.coerce.number().int().min(0).default(1000),
    MAX_RETRIES: z.coerce.number().int().min(0).default(2),
    REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).default(10000),
    // Quota warnings (requests remaining)
    QUOTA_WARN_YELLOW: z.coerce.number().int().min(0).default(800),
    QUOTA_WARN_RED: z.coerce.number().int().min(0).default(200),
    // Risk bands: [from, to] probabilities. Analytical categories only.
    RISK_BAND_ELEVATED_FROM: z.coerce.number().min(0).max(1).default(0.5),
    RISK_BAND_HIGH_FROM: z.coerce.number().min(0).max(1).default(0.75),
    RISK_BAND_VERY_HIGH_FROM: z.coerce.number().min(0).max(1).default(0.9),
    // Mask sensitive values (IPs, RIDAs) in API responses by default
    MASK_SENSITIVE: z
        .enum(["true", "false"])
        .default("true")
        .transform((v) => v === "true"),
    // Data retention in days (0 = keep forever)
    RETENTION_DAYS: z.coerce.number().int().min(0).default(0),
});
function loadConfig(env = process.env) {
    return envSchema.parse(env);
}
/**
 * Resolve a DATABASE_URL to an absolute file path.
 *
 * Relative `sqlite:` paths are resolved against the PROJECT ROOT — determined
 * from `import.meta.url` of this module (ESM). For `server/dist/config.js` this
 * is two levels up (`server/dist` → `server` → project root).
 *
 * This ensures the server, seed script, and tests all resolve to the same DB
 * file regardless of the CWD they are launched from.
 */
export function resolveDatabasePath(databaseUrl) {
    if (databaseUrl.startsWith("sqlite:")) {
        const p = databaseUrl.slice("sqlite:".length);
        if (p.startsWith("./") || p.startsWith("../")) {
            //Resolve relative to the PROJECT ROOT (three levels above server/dist/config.js:
            // config.js → dist/ → server/ → project root).
            const thisFile = fileURLToPath(import.meta.url);
            const projectRoot = path.resolve(thisFile, "..", "..", "..");
            return path.resolve(projectRoot, p);
        }
        return p;
    }
    if (databaseUrl.startsWith("file:")) {
        return databaseUrl.slice("file:".length);
    }
    throw new Error(`Unsupported DATABASE_URL "${databaseUrl}". Use sqlite:./path/to.db or postgres://user:pass@host:5432/dbname.`);
}
export function ensureDatabaseDir(config) {
    const projectRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");
    const dir = path.resolve(projectRoot, config.DATABASE_DIR);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    return dir;
}
export const config = loadConfig();
//# sourceMappingURL=config.js.map