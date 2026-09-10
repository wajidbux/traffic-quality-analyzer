import pino from "pino";
import { config } from "../config.js";

/**
 * Structured logger. The Pixalate API key is redacted at the serializer level:
 * any object key containing "x-api-key" / "apikey" / "api_key" is replaced
 * before it can reach output. Callers should still avoid logging the key.
 */
/** Non-secret keys that merely mention the word "api key" (e.g. status flags). */
const SAFE_KEYS = new Set(["apiKeyConfigured", "api_key_configured"]);

function redactSensitive(value: unknown, key?: string): unknown {
  if (key && !SAFE_KEYS.has(key) && /x-api-key|x-ingest-key|apikey|api_key|authorization|ingest[_-]?key/i.test(key)) {
    return "[REDACTED]";
  }
  // Let pino's built-in error serializer handle Error instances.
  if (value instanceof Error) return value;
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactSensitive(v, k);
    }
    return out;
  }
  return value;
}

export const logger = pino({
  level: config.LOG_LEVEL === "silent" ? "silent" : config.LOG_LEVEL,
  base: { env: config.APP_ENV },
  serializers: {
    err: pino.stdSerializers.err,
    req: (req: unknown) => redactSensitive(req),
    res: (res: unknown) => redactSensitive(res),
  },
  hooks: {
    // Belt-and-braces: redact any stray sensitive key before serialization.
    logMethod(args, method) {
      args[0] = redactSensitive(args[0]);
      return (method as (obj: unknown, ...rest: unknown[]) => void).apply(this, args as [unknown, ...unknown[]]);
    },
  },
});

export function logError(context: string, err: unknown): void {
  if (err instanceof Error) {
    logger.error({ err, context }, err.message);
  } else {
    logger.error({ context, err: String(err) }, "Non-Error thrown");
  }
}