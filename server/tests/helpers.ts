import { afterEach, beforeEach } from "vitest";
import { openInMemoryDatabase, useDatabase, Db } from "../src/db/database.js";
import { PixalateClientLike, PixalateFraudRequest, PixalateFraudResponse, PixalateQuotaState } from "../src/pixalate/types.js";
import { addManualRecord } from "../src/services/importer.js";

export function setupTestDb(): void {
  beforeEach(async () => {
    const db = await openInMemoryDatabase();
    useDatabase(db);
  });
  afterEach(() => {
    useDatabase(null);
  });
}

export type FetchHandler = (url: string, init: RequestInit) => Promise<Response>;

/** A controllable mock client for analyzer/quota tests. */
export class MockPixalateClient implements PixalateClientLike {
  public calls: Array<{ request: PixalateFraudRequest; url: string }> = [];
  public nextProbability: number | null = 0.35;
  public nextError: Error | null = null;
  public latencyMs = 5;

  async checkFraud(request: PixalateFraudRequest): Promise<PixalateFraudResponse> {
    this.calls.push({ request, url: "" });
    if (this.nextError) throw this.nextError;
    return {
      fraudProbability: this.nextProbability,
      raw: { fraud_probability: this.nextProbability },
      httpStatus: 200,
      latencyMs: this.latencyMs,
    };
  }

  async getMetadata(): Promise<PixalateQuotaState> {
    return {
      limit: 1000,
      used: 100,
      remaining: 900,
      renewal: "2026-10-01T00:00:00.000Z",
      apiStatus: "ok",
      interval: 1,
      timeUnit: "month",
      raw: {
        database: { lastUpdated: "2026-08-31" },
        quota: { available: 900, used: 100, expiry: "2026-10-01T00:00:00.000Z", limit: 1000, interval: 1, timeUnit: "month" },
      },
      httpStatus: 200,
      latencyMs: this.latencyMs,
    };
  }
}

/** Seed N records with known signals. */
export async function seedRecords(
  n: number,
  opts: { withRida?: boolean; withUa?: boolean; channelId?: number | null } = {}
): Promise<void> {
  const { withRida = true, withUa = true, channelId = 1 } = opts;
  for (let i = 0; i < n; i++) {
    await addManualRecord({
      channelId,
      timestamp: `2026-09-0${(i % 7) + 1}T10:${String(i % 60).padStart(2, "0")}:00Z`,
      ip: `198.51.100.${(i % 240) + 1}`,
      rida: withRida ? `11111111-1111-4111-8111-${String(i).padStart(12, "0")}` : null,
      device_id: null,
      user_agent: withUa ? `Roku/DVP-${9 + (i % 4)} (Roku Ultra; 4K; ${i % 2 === 0 ? "US" : "UK"})` : null,
      country: i % 3 === 0 ? "GB" : "US",
      region: i % 2 === 0 ? "CA" : "NY",
      ad_request_id: `req-${i}`,
    });
  }
}

export function makeMockFetch(handler: FetchHandler): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init ?? {});
  }) as unknown as typeof fetch;
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}