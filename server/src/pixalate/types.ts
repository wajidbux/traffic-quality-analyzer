/**
 * Pixalate API types.
 *
 * Sources of truth (verified live):
 *  - Ad Fraud API v2.0.1: https://api.pixalate.com/.well-known/api/v2/fraud/fraud.yml
 *    server: https://fraud-api.pixalate.com/api/v2
 *  - CTV Apps API:       https://api.pixalate.com/.well-known/api/v2/ctv/ctv.yml
 *    server: https://api.pixalate.com (base path /mrt/ctv)
 *
 * Both APIs use the same PIXALATE_API_KEY (x-api-key header) but different
 * base URLs / paths. They are wired as separate clients so each can be
 * configured, tested, and toggled independently.
 */

export type PixalateSignal = "ip" | "device" | "ua";

export interface PixalateFraudRequest {
  ip?: string;
  deviceId?: string;
  useragent?: string;
}

export interface PixalateFraudResponse {
  /** Parsed probability 0.01–1.0. Null when the API returned no score. */
  fraudProbability: number | null;
  /** Verbatim JSON body from Pixalate, for the audit trail. */
  raw: unknown;
  httpStatus: number;
  latencyMs: number;
}

export interface PixalateQuotaState {
  limit: number | null;
  used: number | null;
  remaining: number | null;
  renewal: string | null;
  apiStatus: string | null;
  /** Number of time units in the quota refresh window (Metadata schema). */
  interval: number | null;
  /** Refresh time unit: minute | hour | day | week | month (Metadata schema). */
  timeUnit: string | null;
  /** Verbatim JSON body from Pixalate. */
  raw: unknown;
  httpStatus: number;
  latencyMs: number;
}

export interface PixalateClientLike {
  checkFraud(request: PixalateFraudRequest, timeoutMs?: number): Promise<PixalateFraudResponse>;
  getMetadata(timeoutMs?: number): Promise<PixalateQuotaState>;
}

export type PixalateErrorKind =
  | "unauthorized" // 401
  | "forbidden" // 403
  | "bad_request" // 400
  | "not_found" // 404
  | "rate_limited" // 429
  | "quota_exhausted" // 429/403 indicating quota is used up
  | "server_error" // 5xx
  | "timeout"
  | "network"
  | "invalid_response";

export class PixalateApiError extends Error {
  kind: PixalateErrorKind;
  httpStatus: number | null;
  retryable: boolean;
  body: string | null;

  constructor(kind: PixalateErrorKind, message: string, opts: { httpStatus?: number | null; retryable?: boolean; body?: string | null } = {}) {
    super(message);
    this.name = "PixalateApiError";
    this.kind = kind;
    this.httpStatus = opts.httpStatus ?? null;
    this.retryable = opts.retryable ?? false;
    this.body = opts.body ?? null;
  }
}

// CTV Apps API types

/** CTV Apps metadata/quota response (GET /mrt/ctv with no body). */
export interface PixalateCtvQuotaState {
  /** Last date the CTV apps database was updated (e.g. "2022-04-30"). */
  databaseLastUpdated: string | null;
  limit: number | null;
  used: number | null;
  remaining: number | null;
  renewal: string | null;
  apiStatus: string | null;
  raw: unknown;
  httpStatus: number;
  latencyMs: number;
}

/** A single CTV app result from GET /mrt/ctv/{appId}. */
export interface PixalateCtvAppDoc {
  appId: string;
  region: string;
  device: string;
  riskOverview: {
    risk: Array<{ region: string; pixalateRisk: string; pixalateRiskReasons: string[] }>;
    ivt: number | null;
    ivtRisk: string | null;
    ssaiRate: number | null;
    transaparentSsaiRate: number | null;
    descriptionBrandSafetyRisk: string | null;
    contentBrandSafetyRisk: string | null;
  } | null;
  invalidTraffic: {
    ivt: number | null;
    givt: number | null;
    sivt: number | null;
  } | null;
  appOverview: {
    appTitle: string | null;
    categories: string[] | null;
  } | null;
  brandSafety: {
    descriptionBrandSafety: {
      adultContentRisk: string | null;
      drugContentRisk: string | null;
      hateSpeechRisk: string | null;
    } | null;
  } | null;
  rankings: {
    final: { grade: string | null; score: string | null } | null;
    ivt: { grade: string | null; score: string | null } | null;
  } | null;
}

export interface PixalateCtvAppResponse {
  status: string | null;
  numFound: number | null;
  docs: PixalateCtvAppDoc[];
  raw: unknown;
  httpStatus: number;
  latencyMs: number;
}

/**
 * Shared helper type for record-shaped objects.
 */
export interface AnyRecord {
  [key: string]: unknown;
}

/** Client interface for the CTV Apps API. */
export interface PixalateCtvClientLike {
  /** GET /mrt/ctv — metadata + quota (no analysis quota consumed). */
  getQuota(timeoutMs?: number): Promise<PixalateCtvQuotaState>;
  /** GET /mrt/ctv/{appId} — risk + reputation for a CTV app. */
  getApp(appId: string, opts?: { region?: string; device?: string; widgets?: string[]; includeSpoofing?: boolean }, timeoutMs?: number): Promise<PixalateCtvAppResponse>;
  get isConfigured(): boolean;
}