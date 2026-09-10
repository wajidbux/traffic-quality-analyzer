import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { openInMemoryDatabase, useDatabase } from "../src/db/database.js";
import { MockPixalateClient, seedRecords } from "./helpers.js";
import { startAnalysis } from "../src/services/analyzer.js";
import {
  buildReportPayload,
  buildSspPayload,
  generatePdf,
  generateResultsCsv,
  generateSspPdf,
  generateXlsx,
  exportAllCsv,
  METHODOLOGY_STATEMENT,
} from "../src/services/reportGenerator.js";

let runId = "";

beforeEach(async () => {
  useDatabase(await openInMemoryDatabase());
  await seedRecords(8);
  const client = new MockPixalateClient();
  client.nextProbability = 0.6;
  const run = await startAnalysis(client, { strategy: { type: "all" }, mode: "auto", confirmed: true });
  runId = run.id;
});

afterEach(() => {
  useDatabase(null);
});

describe("reportGenerator", () => {
  it("builds a report payload with methodology statement", async () => {
    const payload = await buildReportPayload(runId);
    expect(payload.run.id).toBe(runId);
    expect(payload.methodology).toContain("risk assessment");
    expect(payload.methodology).toContain("not be interpreted as definitive proof");
    expect(payload.distribution).toHaveLength(10);
    expect(payload.bands).toHaveLength(4);
    expect(payload.masking).toBe(true);
  });

  it("generates a valid PDF buffer", async () => {
    const payload = await buildReportPayload(runId);
    const buffer = await generatePdf(payload);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("generates an XLSX buffer with overview + records sheets", async () => {
    const payload = await buildReportPayload(runId);
    const buffer = await generateXlsx(payload);
    expect(buffer.length).toBeGreaterThan(1000);
    // ZIP magic bytes
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("generates a results CSV with header and masked values", async () => {
    const csv = await generateResultsCsv(runId);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("fraud_probability");
    expect(lines.length).toBe(9); // header + 8 records
    expect(csv).toContain("0.6");
  });

  it("generates an SSP report with no raw identifiers", async () => {
    const payload = await buildSspPayload(runId);
    expect(payload.sampleSize).toBe(8);
    expect(payload.pctHigh).not.toBeNull();
    const buffer = await generateSspPdf(payload);
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(payload.channel).toBeNull(); // no channel filter on this run
  });

  it("export-all CSV contains records and results", async () => {
    const csv = await exportAllCsv();
    expect(csv.split("\n")).toHaveLength(9);
  });

  it("masks identifiers in CSV when masking is enabled", async () => {
    const csv = await generateResultsCsv(runId);
    expect(csv).not.toMatch(/198\.51\.100\.\d+/);
    expect(csv).toMatch(/xxx/);
  });

  it("includes the mandatory limitations wording", async () => {
    const payload = await buildReportPayload(runId);
    expect(METHODOLOGY_STATEMENT.length).toBeGreaterThan(100);
    expect(payload.methodology).toBe(METHODOLOGY_STATEMENT);
  });
});