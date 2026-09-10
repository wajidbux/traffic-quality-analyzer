import { describe, expect, it, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { openInMemoryDatabase, useDatabase, getDb, setSetting } from "../src/db/database.js";
import { createApp } from "../src/app.js";
import { MockPixalateClient, seedRecords } from "./helpers.js";
import { kvSet } from "../src/db/database.js";
import { startAnalysis } from "../src/services/analyzer.js";

let client: MockPixalateClient;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  useDatabase(await openInMemoryDatabase());
  client = new MockPixalateClient();
  app = createApp({ client, apiKeyConfigured: true });
});

afterEach(() => {
  useDatabase(null);
});

describe("API: channels", () => {
  it("lists seeded channels", async () => {
    const res = await request(app).get("/api/channels");
    expect(res.status).toBe(200);
    const names = res.body.channels.map((c: { name: string }) => c.name);
    expect(names).toContain("Movie Vault");
    expect(names).toContain("Hikari TV");
    expect(names).toContain("Lullaby Lane");
    expect(names).toContain("Sneak Peek");
  });

  it("creates a channel and rejects duplicates", async () => {
    const res = await request(app).post("/api/channels").send({ name: "Test Channel" });
    expect(res.status).toBe(201);
    const dup = await request(app).post("/api/channels").send({ name: "Test Channel" });
    expect(dup.status).toBe(409);
  });
});

describe("API: records", () => {
  it("imports CSV content with column mapping", async () => {
    const csv = "timestamp,channel,ip,rida,user_agent,country,region,ad_request_id\n2026-09-01T10:00:00Z,Movie Vault,198.51.100.1,11111111-1111-4111-8111-111111111111,Roku/DVP-10,US,CA,req-1";
    const res = await request(app).post("/api/records/import").send({ content: csv, filename: "traffic.csv" });
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(1);
  });

  it("guesses columns for an uploaded CSV", async () => {
    const res = await request(app).post("/api/records/guess-columns").send({
      content: "Timestamp,Channel,IP Address,RIDA,User Agent\n2026-01-01T00:00:00Z,Movie Vault,1.2.3.4,abc,ua",
    });
    expect(res.status).toBe(200);
    expect(res.body.map.ip).toBe("IP Address");
  });

  it("lists records with masking applied by default", async () => {
    await seedRecords(3);
    const res = await request(app).get("/api/records");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.records[0].ip).toContain("xxx");
  });

  it("lists unmasked records when masking is disabled", async () => {
    await setSetting("mask_sensitive", "false");
    await seedRecords(3);
    const res = await request(app).get("/api/records");
    expect(res.body.records[0].ip).toMatch(/^198\.51\.100\./);
  });

  it("adds a manual record", async () => {
    const res = await request(app).post("/api/records/manual").send({
      channel_id: 1,
      ip: "203.0.113.5",
      user_agent: "Roku/DVP-10 (Roku Ultra)",
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
  });

  it("rejects manual records with no signals", async () => {
    const res = await request(app).post("/api/records/manual").send({ channel_id: 1 });
    expect(res.status).toBe(400);
  });
});

describe("API: runs", () => {
  it("preview + confirmed run lifecycle", async () => {
    await seedRecords(10);
    const preview = await request(app).post("/api/runs/preview").send({ strategy: { type: "all" }, mode: "auto" });
    expect(preview.status).toBe(200);
    expect(preview.body.selectedRecords).toBe(10);

    // Without confirmation → 409
    const unconfirmed = await request(app).post("/api/runs").send({ strategy: { type: "all" }, mode: "auto", confirmed: false });
    expect(unconfirmed.status).toBe(409);

    // Confirmed → runs against mock client
    const res = await request(app).post("/api/runs").send({ strategy: { type: "all" }, mode: "auto", confirmed: true });
    expect(res.status).toBe(201);
    expect(res.body.run.status).toBe("completed");
    expect(res.body.run.numSuccess).toBe(10);

    const list = await request(app).get("/api/runs");
    expect(list.body.runs).toHaveLength(1);
  });

  it("blocks confirmed runs when quota is insufficient", async () => {
    await seedRecords(10);
    await kvSet("quota_state", { localRemaining: 2, localLimit: 100 });
    const res = await request(app).post("/api/runs").send({ strategy: { type: "all" }, mode: "auto", confirmed: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("quota");
  });

  it("rejects invalid strategies and modes", async () => {
    const badStrategy = await request(app).post("/api/runs/preview").send({ strategy: { type: "random_n", n: -5 }, mode: "auto" });
    expect(badStrategy.status).toBe(400);
    const badMode = await request(app).post("/api/runs/preview").send({ strategy: { type: "all" }, mode: "nope" });
    expect(badMode.status).toBe(400);
  });

  it("deletes a run and its results", async () => {
    await seedRecords(5);
    const run = await startAnalysis(client, { strategy: { type: "all" }, mode: "auto", confirmed: true });
    const del = await request(app).delete(`/api/runs/${run.id}`);
    expect(del.status).toBe(200);
    const fetched = await request(app).get(`/api/runs/${run.id}`);
    expect(fetched.status).toBe(404);
  });
});

describe("API: pixalate", () => {
  it("reports status without exposing the api key", async () => {
    const res = await request(app).get("/api/pixalate/status");
    expect(res.status).toBe(200);
    expect(res.body.apiKeyConfigured).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("test-key");
    expect(JSON.stringify(res.body)).not.toMatch(/x-api-key/i);
  });

  it("checks quota via metadata endpoint", async () => {
    const res = await request(app).post("/api/pixalate/quota");
    expect(res.status).toBe(200);
    expect(res.body.quota.remaining).toBe(900);
  });

  it("tests connection", async () => {
    const res = await request(app).post("/api/pixalate/test");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns 503 when the API key is not configured", async () => {
    app = createApp({ client, apiKeyConfigured: false });
    const res = await request(app).post("/api/pixalate/quota");
    expect(res.status).toBe(503);
  });
});

describe("API: stats", () => {
  it("returns dashboard KPIs", async () => {
    await seedRecords(20);
    await startAnalysis(client, { strategy: { type: "all" }, mode: "auto", confirmed: true });
    const res = await request(app).get("/api/stats/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.kpis.totalRecords).toBe(20);
    expect(res.body.kpis.successfulChecks).toBe(20);
    expect(res.body.kpis.uniqueIps).toBe(20);
    expect(res.body.kpis.pctLower).not.toBeNull();
  });

  it("returns channel stats", async () => {
    await seedRecords(6);
    const res = await request(app).get("/api/stats/channels");
    expect(res.status).toBe(200);
    const mv = res.body.channels.find((c: { channelName: string }) => c.channelName === "Movie Vault");
    expect(mv.totalRecords).toBe(6);
  });

  it("returns duplicates with masked repeated values", async () => {
    // Create duplicate IPs by seeding records that reuse IPs
    await seedRecords(5, { withRida: false, withUa: false });
    const res = await request(app).get("/api/stats/duplicates");
    expect(res.status).toBe(200);
    expect(res.body.uniqueIps).toBeLessThanOrEqual(5);
    expect(res.body.repeatIpRate).not.toBeNull();
  });

  it("returns high-risk records with risk filters", async () => {
    await seedRecords(10);
    let i = 0;
    client.checkFraud = async () => ({ fraudProbability: [0.2, 0.8][i++ % 2], raw: {}, httpStatus: 200, latencyMs: 1 });
    const run = await startAnalysis(client, { strategy: { type: "all" }, mode: "auto", confirmed: true });
    const res = await request(app).get(`/api/stats/high-risk?runId=${run.id}&minRisk=0.75`);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(5);
    expect(res.body.rows[0].band).toBe("high");
  });
});

describe("API: settings + audit", () => {
  it("updates settings and rejects unknown keys", async () => {
    const res = await request(app).patch("/api/settings").send({ mask_sensitive: "false", nonexistent: "x" });
    expect(res.status).toBe(200);
    expect(res.body.applied.mask_sensitive).toBe("false");
    expect(res.body.rejected).toContain("nonexistent");
  });

  it("records audit entries", async () => {
    await seedRecords(2);
    await startAnalysis(client, { strategy: { type: "all" }, mode: "auto", confirmed: true });
    const res = await request(app).get("/api/audit");
    expect(res.status).toBe(200);
    const actions = res.body.entries.map((e: { action: string }) => e.action);
    expect(actions).toContain("run.create");
    expect(actions).toContain("traffic.manual_add");
  });
});