import { config } from "../config.js";
import {
  PixalateApiError,
  PixalateCtvAppDoc,
  PixalateCtvAppResponse,
  PixalateCtvClientLike,
  PixalateCtvQuotaState,
  AnyRecord,
} from "./types.js";

// Re-export AnyRecord for consumers that need it.
export type { AnyRecord };

/**
 * Pixalate CTV Apps API client.
 *
 * Verified against the live CTV Apps API spec:
 *   GET  /mrt/ctv                         → Metadata + quota (no analysis quota consumed)
 *   GET  /mrt/ctv/{appId}                 → Risk + reputation for a CTV app
 *   POST /mrt/ctv (CSV batch)             → Enterprise-only async report URL
 * Auth: header `x-api-key: <key>`
 *
 * The same PIXALATE_API_KEY is used as the Ad Fraud API, but against a
 * different server/path. This is a separate client so each API can be
 * configured, tested, and toggled independently.
 *
 * NOTE: The POST batch endpoint requires an Enterprise subscription. It is
 * NOT implemented in this version — only GET quota and GET app lookup are
 * wired. Add it later if the account is upgraded.
 */

export class PixalateCtvClient implements PixalateCtvClientLike {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly ctvPath: string;
  private readonly defaultTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: {
    apiKey?: string;
    baseUrl?: string;
    ctvPath?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  } = {}) {
    this.apiKey = opts.apiKey ?? config.PIXALATE_API_KEY;
    // CTV Apps API lives at api.pixalate.com (not fraud-api.pixalate.com).
    this.baseUrl = (opts.baseUrl ?? config.PIXALATE_CTV_BASE_URL).replace(/\/+$/, "");
    this.ctvPath = opts.ctvPath ?? config.PIXALATE_CTV_PATH;
    this.defaultTimeoutMs = opts.timeoutMs ?? config.REQUEST_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /** GET /mrt/ctv — metadata + quota (no analysis quota consumed). */
  async getQuota(timeoutMs?: number): Promise<PixalateCtvQuotaState> {
    this.assertConfigured();
    const url = `${this.baseUrl}${this.ctvPath}`;
    const started = Date.now();
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        "x-api-key": this.apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs ?? this.defaultTimeoutMs),
    });
    const latencyMs = Date.now() - started;
    const body = await this.parseBody(response);

    if (!response.ok) {
      throw this.mapError(response, body, url);
    }
    const parsed = body;
    return {
      databaseLastUpdated: this.extractDatabaseLastUpdated(parsed),
      limit: this.extractNumber(body, ["limit", "quotaLimit", "quota_limit", "max_calls", "maxCalls"]),
      used: this.extractNumber(body, ["used", "quotaUsed", "quota_used", "calls_made", "callsMade", "usage"]),
      remaining: this.extractNumber(body, ["available", "quotaRemaining", "quota_remaining", "remaining", "remaining_calls", "remainingCalls"]),
      renewal: this.extractString(body, ["expiry", "renewal_date", "renewalDate", "renewal", "reset_date", "resetDate", "expires_at", "expiresAt"]),
      apiStatus: this.extractString(body, ["status", "message", "state", "api_status", "apiStatus"]),
      raw: body,
      httpStatus: response.status,
      latencyMs,
    };
  }

  /** GET /mrt/ctv/{appId} — risk + reputation for a CTV app. */
  async getApp(
    appId: string,
    opts: { region?: string; device?: string; widgets?: string[]; includeSpoofing?: boolean } = {},
    timeoutMs?: number,
  ): Promise<PixalateCtvAppResponse> {
    this.assertConfigured();
    const url = new URL(`${this.baseUrl}${this.ctvPath}/${encodeURIComponent(appId)}`);
    if (opts.region) url.searchParams.set("region", opts.region);
    if (opts.device) url.searchParams.set("device", opts.device);
    if (opts.widgets && opts.widgets.length > 0) url.searchParams.set("widget", opts.widgets.join(","));
    if (opts.includeSpoofing === true) url.searchParams.set("includeSpoofing", "true");

    const started = Date.now();
    const response = await this.fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        "x-api-key": this.apiKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs ?? this.defaultTimeoutMs),
    });
    const latencyMs = Date.now() - started;
    const body = await this.parseBody(response);

    if (!response.ok) {
      throw this.mapError(response, body, url.toString());
    }
    return {
      status: this.extractString(body, ["status"]),
      numFound: this.extractNumber(body, ["numFound", "numfound", "count"]),
      docs: this.extractDocs(body),
      raw: body,
      httpStatus: response.status,
      latencyMs,
    };
  }

  private assertConfigured(): void {
    if (!this.isConfigured) {
      throw new PixalateApiError(
        "unauthorized",
        "PIXALATE_API_KEY is not configured on the server. Set it in the environment and restart.",
      );
    }
  }

  // ── Parsing helpers (tolerant, mirrors responseParser.ts style) ──────────

  private async parseBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return { rawText: text.slice(0, 500) };
    }
  }

  private extractNumber(record: unknown, keys: string[]): number | null {
    if (!this.isRecord(record)) return null;
    for (const key of keys) {
      const v = record[key];
      if (v === undefined || v === null) continue;
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v.trim() !== "") {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  }

  private extractString(record: unknown, keys: string[]): string | null {
    if (!this.isRecord(record)) return null;
    for (const key of keys) {
      const v = record[key];
      if (v === undefined || v === null) continue;
      if (typeof v === "string") return v;
      return String(v);
    }
    return null;
  }

  private extractDatabaseLastUpdated(record: unknown): string | null {
    if (!this.isRecord(record)) return null;
    // Per spec: { database: { lastUpdated: "2022-04-30" } }
    const db = record["database"];
    if (this.isRecord(db) && typeof db.lastUpdated === "string") return db.lastUpdated;
    // Fallback: top-level lastUpdated
    if (typeof record["lastUpdated"] === "string") return record["lastUpdated"];
    return null;
  }

  private extractDocs(record: unknown): PixalateCtvAppDoc[] {
    if (!this.isRecord(record)) return [];
    const docs = record["docs"];
    if (!Array.isArray(docs)) return [];
    return docs.map((d) => this.parseDoc(d));
  }

  private parseDoc(raw: unknown): PixalateCtvAppDoc {
    if (!this.isRecord(raw)) return { appId: "", region: "", device: "", riskOverview: null, invalidTraffic: null, appOverview: null, brandSafety: null, rankings: null };
    const r = raw as AnyRecord;
    return {
      appId: this.extractString(raw, ["appId", "appid"]) ?? "",
      region: this.extractString(raw, ["region"]) ?? "",
      device: this.extractString(raw, ["device"]) ?? "",
      riskOverview: this.isRecord(r["riskOverview"]) ? {
        risk: (this.isRecord(r["riskOverview"]) ? (r["riskOverview"] as AnyRecord)["risk"] : undefined) as Array<{ region: string; pixalateRisk: string; pixalateRiskReasons: string[] }> ?? [],
        ivt: this.extractNumber(r["riskOverview"], ["ivt"]),
        ivtRisk: this.extractString(r["riskOverview"], ["ivtRisk", "ivtrisk"]),
        ssaiRate: this.extractNumber(r["riskOverview"], ["ssaiRate", "ssai_rate", "ssaiRate"]),
        transaparentSsaiRate: this.extractNumber(r["riskOverview"], ["transaparentSsaiRate", "transparentSsaiRate", "transaparentssaiRate"]),
        descriptionBrandSafetyRisk: this.extractString(r["riskOverview"], ["descriptionBrandSafetyRisk", "descriptionBrandSafetyrisk"]),
        contentBrandSafetyRisk: this.extractString(r["riskOverview"], ["contentBrandSafetyRisk", "contentBrandSafetyrisk"]),
      } : null,
      invalidTraffic: this.isRecord(r["invalidTraffic"]) ? {
        ivt: this.extractNumber(r["invalidTraffic"], ["ivt"]),
        givt: this.extractNumber(r["invalidTraffic"], ["givt", "gift"]),
        sivt: this.extractNumber(r["invalidTraffic"], ["sivt"]),
      } : null,
      appOverview: this.isRecord(r["appOverview"]) ? {
        appTitle: this.extractString(r["appOverview"], ["appTitle", "apptitle"]),
        categories: (function() { const a = r["appOverview"] as AnyRecord; return Array.isArray(a.categories) ? a.categories.map(String) : null; })(),
      } : null,
      brandSafety: this.isRecord(r["brandSafety"]) ? {
        descriptionBrandSafety: this.isRecord((r["brandSafety"] as AnyRecord)["descriptionBrandSafety"]) ? {
          adultContentRisk: this.extractString((r["brandSafety"] as AnyRecord)["descriptionBrandSafety"], ["adultContentRisk", "adultContentrisk", "adultRisk"]),
          drugContentRisk: this.extractString((r["brandSafety"] as AnyRecord)["descriptionBrandSafety"], ["drugContentRisk", "drugContentrisk"]),
          hateSpeechRisk: this.extractString((r["brandSafety"] as AnyRecord)["descriptionBrandSafety"], ["hateSpeechRisk", "hateSpeechrisk"]),
        } : null,
      } : null,
      rankings: this.isRecord(r["rankings"]) ? {
        final: this.isRecord((r["rankings"] as AnyRecord)["final"]) ? {
          grade: this.extractString((r["rankings"] as AnyRecord)["final"], ["grade"]),
          score: this.extractString((r["rankings"] as AnyRecord)["final"], ["score"]),
        } : null,
        ivt: this.isRecord((r["rankings"] as AnyRecord)["ivt"]) ? {
          grade: this.extractString((r["rankings"] as AnyRecord)["ivt"], ["grade"]),
          score: this.extractString((r["rankings"] as AnyRecord)["ivt"], ["score"]),
        } : null,
      } : null,
    };
  }

  private mapError(response: Response, body: unknown, url: string): PixalateApiError {
    const status = response.status;
    const text = JSON.stringify(body ?? "");

    if (status === 401) {
      return new PixalateApiError("unauthorized", "Pixalate CTV: 401 Unauthorized — check PIXALATE_API_KEY.", {
        httpStatus: status,
        body: text,
      });
    }
    if (status === 403) {
      return new PixalateApiError(
        "quota_exhausted",
        "Pixalate CTV: 403 Forbidden — quota exhausted, subscription expired or needs upgrade.",
        { httpStatus: status, body: text },
      );
    }
    if (status === 400) {
      return new PixalateApiError(
        "bad_request",
        `Pixalate CTV: 400 Bad Request — invalid parameters. ${this.summarize(body)}`,
        { httpStatus: status, body: text },
      );
    }
    if (status === 404) {
      return new PixalateApiError(
        "not_found",
        `Pixalate CTV: 404 Not Found for ${url} — check appId or PIXALATE_CTV_PATH.`,
        { httpStatus: status, body: text },
      );
    }
    if (status >= 500) {
      return new PixalateApiError(
        "server_error",
        `Pixalate CTV: ${status} server error.`,
        { httpStatus: status, retryable: true, body: text },
      );
    }
    return new PixalateApiError(
      "invalid_response",
      `Pixalate CTV: unexpected HTTP ${status}`,
      { httpStatus: status, body: text },
    );
  }

  private isRecord(value: unknown): value is AnyRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private summarize(body: unknown): string {
    if (!body) return "";
    const text = JSON.stringify(body);
    return text.length > 300 ? `${text.slice(0, 300)}…` : text;
  }
}
