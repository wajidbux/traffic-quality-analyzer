import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { openInMemoryDatabase, useDatabase } from "../src/db/database.js";
import { sampleRecords, estimateCalls } from "../src/services/samplingService.js";
import { seedRecords } from "./helpers.js";

describe("samplingService", () => {
  beforeEach(async () => {
    useDatabase(await openInMemoryDatabase());
  });
  afterEach(() => useDatabase(null));

  it("samples all", async () => {
    await seedRecords(50);
    const { ids, totalPool } = await sampleRecords({ type: "all" });
    expect(ids).toHaveLength(50);
    expect(totalPool).toBe(50);
  });

  it("samples a fixed random count", async () => {
    await seedRecords(100);
    const { ids } = await sampleRecords({ type: "random_n", n: 10 });
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
  });

  it("samples a percentage", async () => {
    await seedRecords(100);
    const { ids } = await sampleRecords({ type: "percentage", pct: 25 });
    expect(ids).toHaveLength(25);
  });

  it("samples per channel", async () => {
    await seedRecords(20); // all channel 1
    const { ids } = await sampleRecords({ type: "per_channel_n", n: 5 });
    expect(ids).toHaveLength(5);
  });

  it("samples unique IPs only (one record per IP)", async () => {
    await seedRecords(100); // 100 records but only 100 unique IPs (i % 240) — so all unique
    const { ids } = await sampleRecords({ type: "unique_ip" });
    expect(ids).toHaveLength(100);
  });

  it("respects channel filters", async () => {
    await seedRecords(10);
    const { ids, totalPool } = await sampleRecords({ type: "all" }, { channelId: 999 });
    expect(ids).toHaveLength(0);
    expect(totalPool).toBe(0);
  });

  it("estimates calls equal to selected records", async () => {
    await seedRecords(40);
    expect(await estimateCalls({ type: "random_n", n: 7 })).toBe(7);
  });

  it("caps random_n at pool size", async () => {
    await seedRecords(3);
    const { ids } = await sampleRecords({ type: "random_n", n: 100 });
    expect(ids).toHaveLength(3);
  });
});