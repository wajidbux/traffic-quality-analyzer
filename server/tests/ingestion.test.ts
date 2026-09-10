import { describe, expect, it, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { openInMemoryDatabase, useDatabase, getDb } from "../src/db/database.js";
import { createApp } from "../src/app.js";
import { MockPixalateClient } from "./helpers.js";
import { AppContext } from "../src/context.js";

const INGEST_KEY = "ingest-key-123";

function makeApp(overrides: Partial<AppContext["ingestion"]> = {}) {
  const context: AppContext = {
    client: new MockPixalateClient(),
    apiKeyConfigured: true,
    ingestion: {
      enabled: true,
      apiKey: INGEST_KEY,
      maxBatch: 100,
      ratePerMinute: 1000,
      ...overrides,
    },
  };
  return createApp(context);
}

const SAMPLE = {
  records: [
    {
      timestamp: "2026-09-01T10:00:00Z",
      channel: "Movie Vault",
      ip: "198.51.100.7",
      rida: "11111111-1111-4111-8111-111111111111",
      user_agent: "Roku/DVP-10 (Roku Ultra)",
      country: "US",
      region: "CA",
      ad_request_id: "adreq-000001",
    },
    {
      timestamp: "2026-09-01T10:01:00Z",
      channel: "Hikari TV",
      ip: "203.0.113.9",
      device_id: "ABCDEF0123456789ABCDEF0123456789",
      user_agent: "Roku/DVP-9.4 (Roku Streaming Stick)",
      country: "GB",
      region: "LDN",
      ad_request_id: "adreq-000002",
    },
  ],
};

beforeEach(async () => {
  useDatabase(await openInMemoryDatabase());
});
afterEach(() => useDatabase(null));

describe("POST /api/ingest", () => {
  it("rejects requests without a valid ingest key", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/ingest").send(SAMPLE);
    expect(res.status).toBe(401);
    const bad = await request(app).post("/api/ingest").set("x-ingest-key", "wrong").send(SAMPLE);
    expect(bad.status).toBe(401);
    const bearer = await request(app).post("/api/ingest").set("Authorization", `Bearer ${INGEST_KEY}`).send(SAMPLE);
    expect(bearer.status).toBe(201);
  });

  it("returns 503 when ingestion is disabled", async () => {
    const app = makeApp({ enabled: false });
    const res = await request(app)
      .post("/api/ingest")
      .set("x-ingest-key", INGEST_KEY)
      .send(SAMPLE);
    expect(res.status).toBe(503);
  });

  it("ingests a batch of records and links channels", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/ingest").set("x-ingest-key", INGEST_KEY).send(SAMPLE);
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(2);
    expect(res.body.duplicates).toBe(0);
    expect(res.body.rejected).toHaveLength(0);

    const rows = (await getDb().prepare("SELECT source, channel_id, ip FROM traffic_records ORDER BY ip").all()) as Array<{
      source: string;
      channel_id: number;
      ip: string;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === "api")).toBe(true);
    expect(rows.map((r) => r.channel_id).sort()).toEqual([1, 2]); // Movie Vault, Hikari TV
  });

  it("accepts a single object (not wrapped in records)", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/ingest")
      .set("x-ingest-key", INGEST_KEY)
      .send({ timestamp: "2026-09-02T00:00:00Z", channel: "Sneak Peek", ip: "198.51.100.42" });
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(1);
  });

  it("normalizes camelCase / aliased field names", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/ingest")
      .set("x-ingest-key", INGEST_KEY)
      .send({
        records: [
          {
            eventTime: "2026-09-03T00:00:00Z",
            appName: "Lullaby Lane",
            ipAddress: "198.51.100.77",
            deviceId: "11111111-1111-4111-8111-111111111111",
            userAgent: "Roku/DVP-11 (Roku Express)",
            countryCode: "US",
            requestId: "req-alias-1",
          },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(1);
    const row = (await getDb().prepare("SELECT ip, ad_request_id, channel_id FROM traffic_records").get()) as {
      ip: string;
      ad_request_id: string;
      channel_id: number;
    };
    expect(row.ip).toBe("198.51.100.77");
    expect(row.ad_request_id).toBe("req-alias-1");
    expect(row.channel_id).toBe(3); // Lullaby Lane
  });

  it("dedupes identical records across requests", async () => {
    const app = makeApp();
    await request(app).post("/api/ingest").set("x-ingest-key", INGEST_KEY).send(SAMPLE);
    const res = await request(app).post("/api/ingest").set("x-ingest-key", INGEST_KEY).send(SAMPLE);
    expect(res.body.imported).toBe(0);
    expect(res.body.duplicates).toBe(2);
    const count = (await getDb().prepare("SELECT COUNT(*) AS n FROM traffic_records").get()) as { n: number };
    expect(count.n).toBe(2);
  });

  it("reports rejected records with reasons instead of failing the batch", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/ingest")
      .set("x-ingest-key", INGEST_KEY)
      .send({
        records: [
          { ip: "198.51.100.1" },
          "not-an-object",
          { ip: ["bad", "value"] },
          { ip: "198.51.100.2", rida: "11111111-1111-4111-8111-111111111111" },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(2);
    expect(res.body.rejected).toHaveLength(2);
    expect(res.body.rejected[0].reason).toContain("JSON object");
    expect(res.body.rejected[1].reason).toContain("scalar");
  });

  it("rejects payloads over the batch limit", async () => {
    const app = makeApp({ maxBatch: 2 });
    const res = await request(app)
      .post("/api/ingest")
      .set("x-ingest-key", INGEST_KEY)
      .send({ records: [{ ip: "198.51.100.1" }, { ip: "198.51.100.2" }, { ip: "198.51.100.3" }] });
    expect(res.status).toBe(413);
    const count = (await getDb().prepare("SELECT COUNT(*) AS n FROM traffic_records").get()) as { n: number };
    expect(count.n).toBe(0);
  });

  it("rejects empty payloads", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/ingest").set("x-ingest-key", INGEST_KEY).send({ records: [] });
    expect(res.status).toBe(400);
  });

  it("rate limits ingestion requests", async () => {
    const app = makeApp({ ratePerMinute: 2 });
    const first = await request(app).post("/api/ingest").set("x-ingest-key", INGEST_KEY).send({ ip: "198.51.100.1" });
    expect(first.status).toBe(201);
    const second = await request(app).post("/api/ingest").set("x-ingest-key", INGEST_KEY).send({ ip: "198.51.100.2" });
    expect(second.status).toBe(201);
    const third = await request(app).post("/api/ingest").set("x-ingest-key", INGEST_KEY).send({ ip: "198.51.100.3" });
    expect(third.status).toBe(429);
  });

  it("stages records without making any Pixalate calls", async () => {
    const client = new MockPixalateClient();
    const context: AppContext = {
      client,
      apiKeyConfigured: true,
      ingestion: { enabled: true, apiKey: INGEST_KEY, maxBatch: 100, ratePerMinute: 1000 },
    };
    const app = createApp(context);
    await request(app).post("/api/ingest").set("x-ingest-key", INGEST_KEY).send(SAMPLE);
    expect(client.calls).toHaveLength(0);
  });

  it("exposes an ingestion status endpoint without secrets", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/ingest/status");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.maxBatch).toBe(100);
    expect(JSON.stringify(res.body)).not.toContain(INGEST_KEY);
  });
});