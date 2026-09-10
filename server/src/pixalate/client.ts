import { config } from "../config.js";
import {
  PixalateApiError,
  PixalateClientLike,
  PixalateFraudRequest,
  PixalateFraudResponse,
  PixalateQuotaState,
} from "./types.js";
import { extractFraudProbability, extractQuotaState, looksLikeQuotaExhaustion } from "./responseParser.js";

/**
 * Pixalate Ad Fraud API client.
 *
 * Verified against the live OpenAPI spec (Ad Fraud API v2.0.1):
 *   GET {base}/api/v2/fraud?ip=&deviceId=&userAgent=  → FraudInfo (analysis; consumes quota)
 *   GET {base}/api/v2/fraud                           → Metadata schema (quota/status; no
 *                                                        analysis parameters sent)
 * Auth: header `x-api-key: <key>`
 *
 * Per the spec: "Not specifying an IP, Device, or Agent will return the metadata
 * for fraud, including the user's current quota." The 200 response is
 * `oneOf: FraudInfo | Metadata` — we decide by whether we sent any parameters.
 *
 * The API key is loaded from the environment only and is never logged,
 * serialized into responses, or exposed to the frontend.
 */

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
}

const RETRYABLE_KINDS = new Set(["rate_limited", "server_error", "timeout", "network"]);

export class PixalateClient implements PixalateClientLike {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fraudPath: string;
  private readonly defaultTimeoutMs: number;
  private readonly retryPolicy: RetryPolicy;
  /** Injectable fetch for tests. */
  private readonly fetchImpl: typeof fetch;

  constructor(opts: {
    apiKey?: string;
    baseUrl?: string;
    fraudPath?: string;
    timeoutMs?: number;
    retryPolicy?: Partial<RetryPolicy>;
    fetchImpl?: typeof fetch;
  } = {}) {
    this.apiKey = opts.apiKey ?? config.PIXALATE_API_KEY;
    this.baseUrl = (opts.baseUrl ?? config.PIXALATE_BASE_URL).replace(/\/+$/, "");
    this.fraudPath = opts.fraudPath ?? config.PIXALATE_FRAUD_PATH;
    this.defaultTimeoutMs = opts.timeoutMs ?? config.REQUEST_TIMEOUT_MS;
    this.retryPolicy = {
      maxRetries: opts.retryPolicy?.maxRetries ?? config.MAX_RETRIES,
      baseDelayMs: opts.retryPolicy?.baseDelayMs ?? config.RETRY_DELAY_MS,
    };
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /** Analysis call — GET /api/v2/fraud. Consumes one unit of quota. */
  async checkFraud(request: PixalateFraudRequest, timeoutMs?: number): Promise<PixalateFraudResponse> {
    this.assertConfigured();
    const params = new URLSearchParams();
    if (request.ip) params.set("ip", request.ip);
    if (request.deviceId) params.set("deviceId", request.deviceId);
    if (request.useragent) params.set("userAgent", request.useragent);
    const query = params.toString();
    if (!query) {
      throw new PixalateApiError("bad_request", "At least one of ip / deviceId / userAgent is required.");
    }
    const url = `${this.baseUrl}${this.fraudPath}?${query}`;
    const started = Date.now();
    const response = await this.requestWithRetry(url, timeoutMs);
    const latencyMs = Date.now() - started;
    const body = await this.parseBody(response);

    if (!response.ok) {
      throw this.mapError(response, body, url);
    }
    return {
      fraudProbability: extractFraudProbability(body),
      raw: body,
      httpStatus: response.status,
      latencyMs,
    };
  }

  /**
   * Metadata / quota call — GET {base}/api/v2/fraud with NO parameters.
   * Per the spec this returns the Metadata schema (database state + quota)
   * instead of a fraud probability. No analysis parameters are sent, so the
   * quota-check request does not consume a fraud-analysis call.
   */
  async getMetadata(timeoutMs?: number): Promise<PixalateQuotaState> {
    this.assertConfigured();
    const url = `${this.baseUrl}${this.fraudPath}`;
    const started = Date.now();
    const response = await this.requestWithRetry(url, timeoutMs);
    const latencyMs = Date.now() - started;
    const body = await this.parseBody(response);

    if (!response.ok) {
      throw this.mapError(response, body, url);
    }
    const parsed = extractQuotaState(body, response.status, latencyMs);
    return {
      limit: parsed.limit,
      used: parsed.used,
      remaining: parsed.remaining,
      renewal: parsed.renewal,
      apiStatus: parsed.apiStatus,
      interval: parsed.interval,
      timeUnit: parsed.timeUnit,
      raw: body,
      httpStatus: response.status,
      latencyMs,
    };
  }

  private assertConfigured(): void {
    if (!this.isConfigured) {
      throw new PixalateApiError(
        "unauthorized",
        "PIXALATE_API_KEY is not configured on the server. Set it in the environment and restart."
      );
    }
  }

  private async requestWithRetry(url: string, timeoutMs?: number): Promise<Response> {
    const timeout = timeoutMs ?? this.defaultTimeoutMs;
    let attempt = 0;
    for (;;) {
      try {
        const response = await this.fetchImpl(url, {
          method: "GET",
          headers: {
            "x-api-key": this.apiKey,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(timeout),
        });
        if (response.ok) return response;

        const body = await this.parseBody(response);
        const error = this.mapError(response, body, url);

        // Never retry auth, bad requests, or quota exhaustion.
        if (!error.retryable) throw error;
        if (attempt >= this.retryPolicy.maxRetries) throw error;

        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        const delay = retryAfter ?? this.backoffDelay(attempt);
        await sleep(delay);
        attempt += 1;
      } catch (err) {
        if (err instanceof PixalateApiError) {
          if (err.retryable && attempt < this.retryPolicy.maxRetries) {
            await sleep(this.backoffDelay(attempt));
            attempt += 1;
            continue;
          }
          throw err;
        }
        // Network-level failure (DNS, ECONNRESET, abort/timeout).
        const kind = (err as Error)?.name === "TimeoutError" || (err as Error)?.name === "AbortError"
          ? "timeout"
          : "network";
        if (attempt < this.retryPolicy.maxRetries) {
          await sleep(this.backoffDelay(attempt));
          attempt += 1;
          continue;
        }
        throw new PixalateApiError(
          kind,
          `Pixalate request failed (${kind}): ${(err as Error)?.message ?? "unknown error"}`,
          { retryable: true }
        );
      }
    }
  }

  private backoffDelay(attempt: number): number {
    const exponential = this.retryPolicy.baseDelayMs * 2 ** attempt;
    // Cap at 30s to avoid pathological waits.
    return Math.min(exponential, 30_000) + Math.floor(Math.random() * 250);
  }

  private mapError(response: Response, body: unknown, url: string): PixalateApiError {
    const status = response.status;
    const text = JSON.stringify(body ?? "");
    const quotaExhausted = looksLikeQuotaExhaustion(body);

    if (status === 401) {
      return new PixalateApiError("unauthorized", "Pixalate: 401 Unauthorized — check PIXALATE_API_KEY.", {
        httpStatus: status,
        body: text,
      });
    }
    if (status === 403) {
      // Spec: "Forbidden - Rate plan expired or quota has been exhausted."
      return new PixalateApiError(
        "quota_exhausted",
        "Pixalate: 403 Forbidden — rate plan expired or quota has been exhausted.",
        { httpStatus: status, body: text }
      );
    }
    if (status === 429) {
      if (quotaExhausted) {
        return new PixalateApiError("quota_exhausted", "Pixalate: API quota exhausted (429).", {
          httpStatus: status,
          body: text,
        });
      }
      return new PixalateApiError("rate_limited", "Pixalate: 429 Too Many Requests — rate limited.", {
        httpStatus: status,
        retryable: true,
        body: text,
      });
    }
    if (status === 400) {
      return new PixalateApiError(
        "bad_request",
        `Pixalate: 400 Bad Request — invalid or missing parameters. ${summarize(body)}`,
        { httpStatus: status, body: text }
      );
    }
    if (status === 404) {
      return new PixalateApiError("not_found", `Pixalate: 404 Not Found for ${url} — check PIXALATE_FRAUD_PATH.`, {
        httpStatus: status,
        body: text,
      });
    }
    if (status >= 500) {
      return new PixalateApiError("server_error", `Pixalate: ${status} server error.`, {
        httpStatus: status,
        retryable: true,
        body: text,
      });
    }
    return new PixalateApiError("invalid_response", `Pixalate: unexpected HTTP ${status}`, {
      httpStatus: status,
      body: text,
    });
  }

  private async parseBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return { rawText: text.slice(0, 500) };
    }
  }
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  return null;
}

function summarize(body: unknown): string {
  if (!body) return "";
  const text = JSON.stringify(body);
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}