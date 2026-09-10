import { getDb } from "../db/database.js";
import { z } from "zod";

/**
 * Smart sampling: choose a subset of records to analyze so the limited
 * Pixalate quota is spent deliberately.
 */

export const sampleStrategySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all") }),
  z.object({ type: z.literal("random_n"), n: z.number().int().positive() }),
  z.object({ type: z.literal("percentage"), pct: z.number().min(0.001).max(100) }),
  z.object({ type: z.literal("per_channel_n"), n: z.number().int().positive() }),
  z.object({ type: z.literal("per_country_n"), n: z.number().int().positive() }),
  z.object({ type: z.literal("per_hour_n"), n: z.number().int().positive() }),
  z.object({ type: z.literal("unique_ip") }),
  z.object({ type: z.literal("unique_rida") }),
  z.object({ type: z.literal("unique_ip_rida") }),
]);

export type SampleStrategy = z.infer<typeof sampleStrategySchema>;

export interface SampleFilter {
  channelId?: number | null;
  channelName?: string | null;
  from?: string | null;
  to?: string | null;
  country?: string | null;
  minSignals?: number | null;
}

function buildWhere(filter: SampleFilter, params: unknown[]): string {
  const clauses: string[] = [];
  if (filter.channelId !== undefined && filter.channelId !== null) {
    clauses.push("r.channel_id = ?");
    params.push(filter.channelId);
  } else if (filter.channelName) {
    clauses.push("c.name = ?");
    params.push(filter.channelName);
  }
  if (filter.from) {
    clauses.push("r.timestamp >= ?");
    params.push(filter.from);
  }
  if (filter.to) {
    clauses.push("r.timestamp <= ?");
    params.push(filter.to);
  }
  if (filter.country) {
    clauses.push("r.country = ?");
    params.push(filter.country);
  }
  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}

/**
 * Select record IDs according to the strategy. The filter narrows the pool
 * first. Returns { ids, totalPool }.
 */
export async function sampleRecords(
  strategy: SampleStrategy,
  filter: SampleFilter = {}
): Promise<{ ids: string[]; totalPool: number }> {
  const db = getDb();
  const baseFrom = "FROM traffic_records r LEFT JOIN channels c ON c.id = r.channel_id";
  const params: unknown[] = [];
  const where = buildWhere(filter, params);

  const countPool = async (): Promise<number> => {
    const row = (await db.prepare(`SELECT COUNT(*) AS n ${baseFrom} ${where}`).get(...params)) as { n: number };
    return row.n;
  };

  const pickRandom = async (limit: number | null, orderBy: string): Promise<string[]> => {
    const sql = `SELECT r.id ${baseFrom} ${where} ${orderBy} ${limit !== null ? "LIMIT ?" : ""}`;
    const rows = limit !== null
      ? ((await db.prepare(sql).all(...params, limit)) as Array<{ id: string }>)
      : ((await db.prepare(sql).all(...params)) as Array<{ id: string }>);
    return rows.map((r) => r.id);
  };

  // Joins an extra SQL condition onto the base WHERE (handles the empty-where case).
  const andClause = (extra: string): string => (where.length ? ` AND ${extra}` : ` WHERE ${extra}`);

  switch (strategy.type) {
    case "all":
      return { ids: await pickRandom(null, ""), totalPool: await countPool() };

    case "random_n": {
      const total = await countPool();
      const n = Math.min(strategy.n, total);
      return { ids: await pickRandom(n, "ORDER BY RANDOM()"), totalPool: total };
    }

    case "percentage": {
      const total = await countPool();
      const n = Math.min(Math.max(1, Math.round((total * strategy.pct) / 100)), total);
      return { ids: await pickRandom(n, "ORDER BY RANDOM()"), totalPool: total };
    }

    case "per_channel_n": {
      const channels = (await db.prepare("SELECT id, name FROM channels WHERE is_active = 1").all()) as Array<{
        id: number;
        name: string;
      }>;
      const ids: string[] = [];
      for (const ch of channels) {
        const rows = (await db
          .prepare(`SELECT r.id ${baseFrom} ${where}${andClause("c.id = ?")} ORDER BY RANDOM() LIMIT ?`)
          .all(...params, ch.id, strategy.n)) as Array<{ id: string }>;
        ids.push(...rows.map((r) => r.id));
      }
      return { ids, totalPool: await countPool() };
    }

    case "per_country_n": {
      const countries = (await db
        .prepare(`SELECT DISTINCT country FROM traffic_records WHERE country IS NOT NULL AND country != ''`)
        .all()) as Array<{ country: string }>;
      const ids: string[] = [];
      for (const c of countries) {
        const rows = (await db
          .prepare(`SELECT r.id ${baseFrom} ${where}${andClause("r.country = ?")} ORDER BY RANDOM() LIMIT ?`)
          .all(...params, c.country, strategy.n)) as Array<{ id: string }>;
        ids.push(...rows.map((r) => r.id));
      }
      return { ids, totalPool: await countPool() };
    }

    case "per_hour_n": {
      const hours = (await db
        .prepare(`SELECT substr(timestamp, 12, 2) AS h FROM traffic_records WHERE timestamp IS NOT NULL GROUP BY h`)
        .all()) as Array<{ h: string }>;
      const ids: string[] = [];
      for (const h of hours) {
        const rows = (await db
          .prepare(`SELECT r.id ${baseFrom} ${where}${andClause("substr(r.timestamp, 12, 2) = ?")} ORDER BY RANDOM() LIMIT ?`)
          .all(...params, h.h, strategy.n)) as Array<{ id: string }>;
        ids.push(...rows.map((r) => r.id));
      }
      return { ids, totalPool: await countPool() };
    }

    case "unique_ip": {
      const rows = (await db
        .prepare(
          `SELECT r.id, r.ip ${baseFrom} ${where}${andClause("r.ip IS NOT NULL AND r.ip != ''")}
           GROUP BY r.ip ORDER BY RANDOM()`
        )
        .all(...params)) as Array<{ id: string; ip: string }>;
      return { ids: rows.map((r) => r.id), totalPool: await countPool() };
    }

    case "unique_rida": {
      const rows = (await db
        .prepare(
          `SELECT r.id, r.rida ${baseFrom} ${where}${andClause("r.rida IS NOT NULL AND r.rida != ''")}
           GROUP BY r.rida ORDER BY RANDOM()`
        )
        .all(...params)) as Array<{ id: string; rida: string }>;
      return { ids: rows.map((r) => r.id), totalPool: await countPool() };
    }

    case "unique_ip_rida": {
      const rows = (await db
        .prepare(
          `SELECT r.id ${baseFrom} ${where}${andClause("r.ip IS NOT NULL AND r.ip != '' AND r.rida IS NOT NULL AND r.rida != ''")}
           GROUP BY r.ip, r.rida ORDER BY RANDOM()`
        )
        .all(...params)) as Array<{ id: string }>;
      return { ids: rows.map((r) => r.id), totalPool: await countPool() };
    }
  }
}

/** Estimate how many Pixalate calls a strategy will produce (== sampled ids). */
export async function estimateCalls(strategy: SampleStrategy, filter: SampleFilter = {}): Promise<number> {
  return (await sampleRecords(strategy, filter)).ids.length;
}