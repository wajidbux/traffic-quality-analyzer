import { describe, expect, it, vi } from "vitest";
import { PixalateClient } from "../src/pixalate/client.js";
import { PixalateApiError } from "../src/pixalate/types.js";
import { extractFraudProbability, extractQuotaState, looksLikeQuotaExhaustion } from "../src/pixalate/responseParser.js";
import { jsonResponse, makeMockFetch } from "./helpers.js";

const KEY = "test-key-123";

function makeClient(handler: (url: string, init: RequestInit) => Promise<Response>, retries = 1) {
  return new PixalateClient({
    apiKey: KEY,
    baseUrl: "https://fraud-api.pixalate.com",
    timeoutMs: 2000,
    retryPolicy: { maxRetries: retries, baseDelayMs: 1 },
    fetchImpl: makeMockFetch(handler),
  });
}

describe("PixalateClient", () => {
  it("sends x-api-key header and the documented query params (ip, deviceId, userAgent)", async () => {
    let seenHeaders: HeadersInit | undefined;
    let seenUrl = "";
    const client = makeClient(async (url, init) => {
      seenUrl = url;
      seenHeaders = init.headers;
      return jsonResponse({ probability: 0.5 });
    });

    const result = await client.checkFraud({ ip: "198.51.100.7", deviceId: "11111111-1111-4111-8111-111111111111", useragent: "Roku/DVP-10" });
    expect(seenUrl).toBe("https://fraud-api.pixalate.com/api/v2/fraud?ip=198.51.100.7&deviceId=11111111-1111-4111-8111-111111111111&userAgent=Roku%2FDVP-10");
    expect((seenHeaders as Record<string, string>)["x-api-key"]).toBe(KEY);
    expect(result.fraudProbability).toBe(0.5);
    expect(result.httpStatus).toBe(200);
  });

  it("rejects requests with no signals", async () => {
    const client = makeClient(async () => jsonResponse({}));
    await expect(client.checkFraud({})).rejects.toMatchObject({ kind: "bad_request" });
  });

  it("parses percentage-style probability (92 → 0.92)", async () => {
    const client = makeClient(async () => jsonResponse({ fraudProbability: 92 }));
    const result = await client.checkFraud({ ip: "1.2.3.4" });
    expect(result.fraudProbability).toBeCloseTo(0.92, 5);
  });

  it("treats probability 0.0 as unknown (null) per the spec", async () => {
    const client = makeClient(async () => jsonResponse({ probability: 0 }));
    const result = await client.checkFraud({ ip: "1.2.3.4" });
    expect(result.fraudProbability).toBeNull();
  });

  it("maps 401 to unauthorized without retrying", async () => {
    const spy = vi.fn(async () => jsonResponse({ message: "bad key" }, 401));
    const client = makeClient(spy, 5);
    await expect(client.checkFraud({ ip: "1.2.3.4" })).rejects.toMatchObject({ kind: "unauthorized", httpStatus: 401 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("maps 403 to quota exhaustion (spec: rate plan expired or quota exhausted) without retrying", async () => {
    const spy = vi.fn(async () => jsonResponse({ message: "nope" }, 403));
    const client = makeClient(spy, 5);
    await expect(client.checkFraud({ ip: "1.2.3.4" })).rejects.toMatchObject({ kind: "quota_exhausted" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("detects quota exhaustion on a 429 body mentioning quota", async () => {
    const spy = vi.fn(async () => jsonResponse({ message: "quota exhausted for this month" }, 429));
    const client = makeClient(spy, 5);
    await expect(client.checkFraud({ ip: "1.2.3.4" })).rejects.toMatchObject({ kind: "quota_exhausted" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("retries 429 rate limits with backoff and honors Retry-After", async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: "slow down" }, 429, { "retry-after": "0" }))
      .mockResolvedValueOnce(jsonResponse({ fraud_probability: 0.2 }));
    const client = makeClient(spy, 3);
    const result = await client.checkFraud({ ip: "1.2.3.4" });
    expect(result.fraudProbability).toBe(0.2);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("retries 5xx errors up to maxRetries then fails", async () => {
    const spy = vi.fn(async () => jsonResponse({}, 500));
    const client = makeClient(spy, 2);
    await expect(client.checkFraud({ ip: "1.2.3.4" })).rejects.toMatchObject({ kind: "server_error" });
    expect(spy).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("treats aborted requests (timeout) as timeout errors", async () => {
    const client = makeClient(async () => {
      throw new DOMException("The operation was aborted", "TimeoutError");
    }, 1);
    await expect(client.checkFraud({ ip: "1.2.3.4" })).rejects.toMatchObject({ kind: "timeout" });
  });

  it("treats network failures as network errors", async () => {
    const client = makeClient(async () => {
      throw new TypeError("fetch failed");
    }, 1);
    await expect(client.checkFraud({ ip: "1.2.3.4" })).rejects.toMatchObject({ kind: "network" });
  });

  it("throws when the API key is not configured", async () => {
    const client = new PixalateClient({ apiKey: "", fetchImpl: makeMockFetch(async () => jsonResponse({})) });
    await expect(client.checkFraud({ ip: "1.2.3.4" })).rejects.toMatchObject({ kind: "unauthorized" });
  });

  it("metadata call sends NO parameters and parses the Metadata schema", async () => {
    let seenUrl = "";
    const client = makeClient(async (url) => {
      seenUrl = url;
      return jsonResponse({
        database: { lastUpdated: "2026-08-31" },
        quota: {
          available: 480,
          used: 520,
          expiry: "2026-10-01T00:00:00.000Z",
          limit: 1000,
          interval: 1,
          timeUnit: "month",
        },
      });
    });
    const meta = await client.getMetadata();
    expect(seenUrl).toBe("https://fraud-api.pixalate.com/api/v2/fraud"); // no query string
    expect(meta.limit).toBe(1000);
    expect(meta.used).toBe(520);
    expect(meta.remaining).toBe(480); // from quota.available
    expect(meta.renewal).toBe("2026-10-01T00:00:00.000Z"); // from quota.expiry
    expect(meta.interval).toBe(1);
    expect(meta.timeUnit).toBe("month");
  });

  it("never exposes the api key in error messages", async () => {
    const client = makeClient(async () => jsonResponse({ message: "denied" }, 401), 0);
    try {
      await client.checkFraud({ ip: "1.2.3.4" });
      expect.unreachable();
    } catch (err) {
      const e = err as PixalateApiError;
      expect(e.message).not.toContain(KEY);
    }
  });
});

describe("responseParser", () => {
  it("extracts probability from the documented field and common aliases", () => {
    expect(extractFraudProbability({ probability: 0.8 })).toBe(0.8); // documented FraudInfo field
    expect(extractFraudProbability({ fraud_probability: 0.8 })).toBe(0.8);
    expect(extractFraudProbability({ fraudProbability: 0.8 })).toBe(0.8);
    expect(extractFraudProbability({ risk_score: 0.8 })).toBe(0.8);
    expect(extractFraudProbability({ data: { probability: 0.8 } })).toBe(0.8);
    expect(extractFraudProbability({ result: { score: 80 } })).toBe(0.8);
    expect(extractFraudProbability({ foo: 1 })).toBeNull();
    expect(extractFraudProbability({ fraud_percentage: 75 })).toBe(0.75);
  });

  it("treats 0.0 as unknown (null) per the spec", () => {
    expect(extractFraudProbability({ probability: 0 })).toBeNull();
    expect(extractFraudProbability({ probability: 0.1 })).toBe(0.1);
  });

  it("parses the documented Metadata schema (database + quota.available/expiry/interval/timeUnit)", () => {
    const parsed = extractQuotaState(
      {
        database: { lastUpdated: "2026-08-31" },
        quota: {
          available: 480,
          used: 520,
          expiry: "2026-10-01T00:00:00.000Z",
          limit: 1000,
          interval: 1,
          timeUnit: "month",
        },
      },
      200,
      10
    );
    expect(parsed.limit).toBe(1000);
    expect(parsed.used).toBe(520);
    expect(parsed.remaining).toBe(480);
    expect(parsed.renewal).toBe("2026-10-01T00:00:00.000Z");
    expect(parsed.interval).toBe(1);
    expect(parsed.timeUnit).toBe("month");
    expect(parsed.raw).toMatchObject({ database: { lastUpdated: "2026-08-31" } });
  });

  it("extracts quota from legacy flat shapes and derives remaining", () => {
    const parsed = extractQuotaState({ quota: { limit: 500, used: 100 } }, 200, 10);
    expect(parsed.limit).toBe(500);
    expect(parsed.remaining).toBe(400);
    expect(parsed.raw).toEqual({ quota: { limit: 500, used: 100 } });
  });

  it("detects quota exhaustion wording", () => {
    expect(looksLikeQuotaExhaustion({ message: "your quota has been exceeded" })).toBe(true);
    expect(looksLikeQuotaExhaustion({ message: "bad request" })).toBe(false);
  });
});