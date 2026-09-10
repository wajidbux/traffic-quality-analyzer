import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { openInMemoryDatabase, useDatabase } from "../src/db/database.js";
import { previewAnalysis, startAnalysis, QuotaGuardError, getRun, computeAggregates } from "../src/services/analyzer.js";
import { MockPixalateClient, seedRecords } from "./helpers.js";
import { kvSet, getDb } from "../src/db/database.js";
import { getEffectiveRemaining } from "../src/services/quotaManager.js";
import { PixalateApiError } from "../src/pixalate/types.js";

describe("analyzer", () => {
  beforeEach(async () => {
    useDatabase(await openInMemoryDatabase());
  });
  afterEach(() => useDatabase(null));

  it("previews selected records and quota impact", async () => {
    await seedRecords(50);
    const preview = await previewAnalysis({ type: "random_n", n: 10 }, {}, "auto");
    expect(preview.selectedRecords).toBe(10);
    expect(preview.estimatedCalls).toBe(10);
  });

  it("flags insufficient quota in preview", async () => {
    await seedRecords(50);
    await kvSet("quota_state", { localRemaining: 5, localLimit: 1000 });
    const preview = await previewAnalysis({ type: "all" }, {}, "auto");
    expect(preview.insufficientQuota).toBe(true);
    expect(preview.remainingAfter).toBe(-45);
  });

  it("requires confirmation before running", async () => {
    await seedRecords(10);
    const client = new MockPixalateClient();
    await expect(
      startAnalysis(client, { strategy: { type: "all" }, mode: "auto", confirmed: false })
    ).rejects.toBeInstanceOf(QuotaGuardError);
    expect(client.calls).toHaveLength(0);
  });

  it("blocks when quota is insufficient unless ignored", async () => {
    await seedRecords(10);
    await kvSet("quota_state", { localRemaining: 3, localLimit: 1000 });
    const client = new MockPixalateClient();
    await expect(
      startAnalysis(client, { strategy: { type: "all" }, mode: "auto", confirmed: true })
    ).rejects.toBeInstanceOf(QuotaGuardError);
    expect(client.calls).toHaveLength(0);
  });

  it("runs a full analysis and stores results", async () => {
    await seedRecords(12);
    const client = new MockPixalateClient();
    client.nextProbability = 0.6;

    const run = await startAnalysis(client, { strategy: { type: "all" }, mode: "auto", confirmed: true });

    expect(run.status).toBe("completed");
    expect(run.numSuccess).toBe(12);
    expect(run.numFailed).toBe(0);
    expect(run.apiCallsUsed).toBe(12);
    expect(client.calls).toHaveLength(12);
    // AUTO mode with all signals present → ip_device_ua
    expect(client.calls[0].request.ip).toBeTruthy();
    expect(client.calls[0].request.deviceId).toBeTruthy();
    expect(client.calls[0].request.useragent).toBeTruthy();

    const stored = (await getDb().prepare("SELECT COUNT(*) AS n FROM pixalate_results WHERE run_id = ?").get(run.id)) as {
      n: number;
    };
    expect(stored.n).toBe(12);
    const successRows = (await getDb()
      .prepare("SELECT COUNT(*) AS n FROM pixalate_results WHERE run_id = ? AND status = 'success'")
      .get(run.id)) as { n: number };
    expect(successRows.n).toBe(12);
    expect(run.avgRisk).toBeCloseTo(0.6, 5);
  });

  it("respects a chosen mode (IP only)", async () => {
    await seedRecords(8);
    const client = new MockPixalateClient();
    await startAnalysis(client, { strategy: { type: "all" }, mode: "ip", confirmed: true });
    for (const call of client.calls) {
      expect(call.request.ip).toBeTruthy();
      expect(call.request.deviceId).toBeUndefined();
      expect(call.request.useragent).toBeUndefined();
    }
  });

  it("submits only available signals when mode requests more", async () => {
    await seedRecords(5, { withRida: false, withUa: false });
    const client = new MockPixalateClient();
    await startAnalysis(client, { strategy: { type: "all" }, mode: "ip_device_ua", confirmed: true });
    expect(client.calls).toHaveLength(5);
    expect(client.calls[0].request.ip).toBeTruthy();
    expect(client.calls[0].request.deviceId).toBeUndefined();
  });

  it("records failures with error details and keeps the run consistent", async () => {
    await seedRecords(6);
    const client = new MockPixalateClient();
    client.nextError = new PixalateApiError("rate_limited", "too fast", { httpStatus: 429, retryable: true });
    const run = await startAnalysis(client, { strategy: { type: "all" }, mode: "auto", confirmed: true });
    expect(run.numFailed).toBe(6);
    expect(run.numSuccess).toBe(0);
    const errors = (await getDb().prepare("SELECT COUNT(*) AS n FROM api_errors WHERE run_id = ?").get(run.id)) as { n: number };
    expect(errors.n).toBe(6);
    // api_usage rows recorded (one per wave; 6 records fit in a single wave)
    const usage = (await getDb().prepare("SELECT COUNT(*) AS n FROM api_usage WHERE endpoint = 'analysis'").get()) as { n: number };
    expect(usage.n).toBe(1);
  });

  it("stops early on quota exhaustion", async () => {
    await seedRecords(10);
    const client = new MockPixalateClient();
    let callCount = 0;
    client.checkFraud = async () => {
      callCount += 1;
      if (callCount >= 3) {
        throw new PixalateApiError("quota_exhausted", "quota exhausted", { httpStatus: 429 });
      }
      return { fraudProbability: 0.1, raw: {}, httpStatus: 200, latencyMs: 1 };
    };
    const run = await startAnalysis(client, { strategy: { type: "all" }, mode: "auto", confirmed: true });
    expect(run.status).toBe("failed");
    expect(run.numSuccess).toBe(2);
    // The 3rd call exhausts quota; up to maxConcurrency in-flight requests
    // (already dispatched) also fail before the abort takes effect.
    expect(run.numFailed).toBeGreaterThanOrEqual(1);
    expect(callCount).toBeGreaterThanOrEqual(3);
    // With async DB calls between semaphore acquire and API call, a few more
    // requests may be dispatched before the abort propagates.
    expect(callCount).toBeLessThanOrEqual(7);
    expect(run.error).toContain("quota");
    // The remaining records were never dispatched.
    expect(callCount).toBeLessThan(10);
  });

  it("decrements the local quota estimate per successful call", async () => {
    await seedRecords(4);
    await kvSet("quota_state", { localRemaining: 100, localLimit: 1000 });
    const client = new MockPixalateClient();
    await startAnalysis(client, { strategy: { type: "all" }, mode: "auto", confirmed: true });
    expect(await getEffectiveRemaining()).toBe(96);
  });

  it("computes aggregates including median and band percentages", async () => {
    await seedRecords(10);
    const client = new MockPixalateClient();
    const probabilities = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    let i = 0;
    client.checkFraud = async () => ({
      fraudProbability: probabilities[i++],
      raw: {},
      httpStatus: 200,
      latencyMs: 1,
    });
    const run = await startAnalysis(client, { strategy: { type: "all" }, mode: "auto", confirmed: true });
    expect(run.avgRisk).toBeCloseTo(0.55, 5);
    expect(run.medianRisk).toBeCloseTo(0.55, 5);
    expect(run.pctLower).toBeCloseTo(40, 5);
    expect(run.pctElevated).toBeCloseTo(30, 5);
    expect(run.pctHigh).toBeCloseTo(10, 5);
    expect(run.pctVeryHigh).toBeCloseTo(20, 5);
    const aggregates = await computeAggregates(run.id);
    expect(aggregates.medianRisk).toBeCloseTo(0.55, 5);
  });

  it("rejects runs with no matching records", async () => {
    const client = new MockPixalateClient();
    await expect(
      startAnalysis(client, { strategy: { type: "all" }, mode: "auto", confirmed: true })
    ).rejects.toBeInstanceOf(QuotaGuardError);
  });

  it("exposes the run via getRun with progress fields", async () => {
    await seedRecords(3);
    const client = new MockPixalateClient();
    const run = await startAnalysis(client, { strategy: { type: "all" }, mode: "auto", confirmed: true });
    const fetched = await getRun(run.id);
    expect(fetched?.id).toBe(run.id);
    expect(fetched?.status).toBe("completed");
    expect(fetched?.progressTotal).toBe(3);
  });
});