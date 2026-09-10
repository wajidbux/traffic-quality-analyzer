import { describe, expect, it } from "vitest";
import { convertPlaceholders, translateToPostgres, PostgresDatabase } from "../src/db/postgres.js";
import { getDb, useDatabase, Db } from "../src/db/database.js";

describe("convertPlaceholders", () => {
  it("replaces ? with $n in order", () => {
    expect(convertPlaceholders("SELECT * FROM t WHERE a = ? AND b = ?")).toBe("SELECT * FROM t WHERE a = $1 AND b = $2");
  });

  it("ignores ? inside string literals", () => {
    expect(convertPlaceholders("SELECT '?' AS q, x = ? FROM t")).toBe("SELECT '?' AS q, x = $1 FROM t");
  });

  it("handles escaped quotes in literals", () => {
    expect(convertPlaceholders("SELECT 'it''s ? fine', y = ? FROM t")).toBe("SELECT 'it''s ? fine', y = $1 FROM t");
  });

  it("handles LIMIT ? OFFSET ?", () => {
    expect(convertPlaceholders("... LIMIT ? OFFSET ?")).toBe("... LIMIT $1 OFFSET $2");
  });
});

describe("translateToPostgres", () => {
  it("translates INSERT OR IGNORE to ON CONFLICT DO NOTHING", () => {
    expect(translateToPostgres("INSERT OR IGNORE INTO channels (name, description) VALUES (?, ?)")).toBe(
      "INSERT INTO channels (name, description) VALUES ($1, $2) ON CONFLICT DO NOTHING"
    );
  });

  it("translates datetime('now') to a UTC timestamp expression", () => {
    expect(translateToPostgres("INSERT INTO api_errors (occurred_at) VALUES (datetime('now'))")).toContain(
      "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')"
    );
  });

  it("translates ORDER BY RANDOM() to random()", () => {
    expect(translateToPostgres("SELECT r.id FROM traffic_records r ORDER BY RANDOM() LIMIT ?")).toBe(
      "SELECT r.id FROM traffic_records r ORDER BY random() LIMIT $1"
    );
  });

  it("translates strftime to to_char with mapped format", () => {
    expect(translateToPostgres("SELECT strftime('%Y-%m-%d %H:00', substr(r.timestamp,1,19)) AS bucket FROM t")).toBe(
      "SELECT to_char(substr(r.timestamp,1,19)::timestamp, 'YYYY-MM-DD HH24:00') AS bucket FROM t"
    );
  });

  it("translates json_group_array to json_agg", () => {
    expect(translateToPostgres("SELECT json_group_array(fraud_probability) AS rows FROM pixalate_results")).toBe(
      "SELECT json_agg(fraud_probability) AS rows FROM pixalate_results"
    );
  });

  it("keeps ON CONFLICT(key) DO UPDATE syntax as-is", () => {
    expect(translateToPostgres("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")).toBe(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );
  });
});

/**
 * Live PostgreSQL integration test. Runs only when TEST_DATABASE_URL is set,
 * e.g.:
 *
 *   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/tqa_test npm test
 *
 * The test database must exist; its tables are dropped and recreated here.
 * Real Pixalate calls are never made — this exercises the schema, the SQL
 * translator, and the driver end to end.
 */
const TEST_URL = process.env.TEST_DATABASE_URL ?? "";

describe.skipIf(!TEST_URL)("PostgreSQL integration (TEST_DATABASE_URL)", () => {
  let pg: PostgresDatabase;

  it("applies the schema and supports the core CRUD + sampling queries", async () => {
    pg = new PostgresDatabase(TEST_URL);
    // Start from a clean slate.
    const drop = [
      "audit_log", "api_errors", "api_usage", "pixalate_results", "analysis_runs",
      "traffic_records", "channels", "kv_store", "settings",
    ]
      .map((t) => `DROP TABLE IF EXISTS ${t} CASCADE`)
      .join(";\n");
    await pg.exec(drop);
    await pg.applySchema();

    useDatabase(pg);
    const db: Db = getDb();

    // Channels seeded by the adapter schema init path? No — seed via the same
    // INSERT OR IGNORE statements the SQLite path uses.
    await db
      .prepare("INSERT OR IGNORE INTO channels (name, description) VALUES (?, ?)")
      .run("Movie Vault", null);
    await db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run("mask_sensitive", "true");

    const channel = (await db.prepare("SELECT id, name FROM channels WHERE name = ?").get("Movie Vault")) as {
      id: number;
      name: string;
    };
    expect(channel.name).toBe("Movie Vault");

    // Insert a record (RETURNING * path).
    const inserted = await db
      .prepare(
        `INSERT INTO traffic_records (id, channel_id, timestamp, ip, rida, user_agent, country, source, record_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?)`
      )
      .run("rec-1", channel.id, "2026-09-01T10:00:00Z", "198.51.100.7", "11111111-1111-4111-8111-111111111111", "Roku/DVP-10", "US", "hash1");
    expect(inserted.changes).toBe(1);

    // COUNT(*) comes back as a JS number (int8 parser).
    const count = (await db.prepare("SELECT COUNT(*) AS n FROM traffic_records").get()) as { n: number };
    expect(count.n).toBe(1);

    // Sampling query with placeholders + random() translation.
    const ids = (await db
      .prepare("SELECT r.id FROM traffic_records r ORDER BY random() LIMIT ?")
      .all(5)) as Array<{ id: string }>;
    expect(ids).toHaveLength(1);

    // transaction() runs on a dedicated client and commits.
    await db.transaction(async (tx) => {
      await tx
        .prepare(
          `INSERT INTO traffic_records (id, channel_id, ip, source, record_hash)
           VALUES (?, ?, ?, 'api', ?)`
        )
        .run("rec-2", channel.id, "203.0.113.9", "hash2");
    });
    const count2 = (await db.prepare("SELECT COUNT(*) AS n FROM traffic_records").get()) as { n: number };
    expect(count2.n).toBe(2);
  }, 60_000);

  it("rolls back a failed transaction", async () => {
    pg = new PostgresDatabase(TEST_URL);
    useDatabase(pg);
    const db: Db = getDb();
    await expect(
      db.transaction(async (tx) => {
        await tx.prepare("INSERT INTO kv_store (key, value) VALUES (?, ?)").run("rollback-test", "x");
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    const row = await db.prepare("SELECT value FROM kv_store WHERE key = ?").get("rollback-test");
    expect(row).toBeUndefined();
  }, 60_000);

  it("closes the pool", async () => {
    await pg.close();
    useDatabase(null);
  }, 60_000);
});