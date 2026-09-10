import crypto from "node:crypto";
import { parse } from "csv-parse/sync";
import { getDb, getSetting } from "../db/database.js";
import { audit } from "./auditLogger.js";
import { logger } from "../utils/logger.js";

/**
 * Traffic import: CSV (with configurable column mapping) and manual entries.
 * Imports never call Pixalate — they only stage records for later analysis.
 */

export interface ImportColumnMap {
  timestamp?: string;
  channel?: string;
  ip?: string;
  rida?: string;
  device_id?: string;
  user_agent?: string;
  country?: string;
  region?: string;
  ad_request_id?: string;
}

export const DEFAULT_COLUMN_MAP: Required<ImportColumnMap> = {
  timestamp: "timestamp",
  channel: "channel",
  ip: "ip",
  rida: "rida",
  device_id: "device_id",
  user_agent: "user_agent",
  country: "country",
  region: "region",
  ad_request_id: "ad_request_id",
};

/** Guess a column map from header names (case/space-insensitive). */
export function guessColumnMap(headers: string[]): ImportColumnMap {
  const normalize = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const byNormalized = new Map(headers.map((h) => [normalize(h), h]));
  const map: ImportColumnMap = {};
  const candidates: Array<[keyof ImportColumnMap, string[]]> = [
    ["timestamp", ["timestamp", "time", "date", "datetime", "ts", "event_time"]],
    ["channel", ["channel", "app", "app_name", "channel_name"]],
    ["ip", ["ip", "ip_address", "ipaddr", "ipv4", "ipv6"]],
    ["rida", ["rida", "roku_rida", "device_rida", "rid"]],
    ["device_id", ["device_id", "deviceid", "device", "dev_id", "idfa", "aaid", "tifa"]],
    ["user_agent", ["user_agent", "useragent", "ua", "agent"]],
    ["country", ["country", "country_code", "geo_country"]],
    ["region", ["region", "state", "province", "region_code"]],
    ["ad_request_id", ["ad_request_id", "request_id", "adid", "bid_request_id", "impression_id"]],
  ];
  for (const [field, aliases] of candidates) {
    for (const alias of aliases) {
      const header = byNormalized.get(alias);
      if (header !== undefined) {
        map[field] = header;
        break;
      }
    }
  }
  return map;
}

export function parseTimestamp(value: string | undefined): string | null {
  if (!value || value.trim() === "") return null;
  const v = value.trim();
  // Accept ISO-ish and common formats; normalize to ISO 8601 UTC when possible.
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return v; // keep original if unparseable
}

function recordHash(fields: {
  ip?: string | null;
  rida?: string | null;
  device_id?: string | null;
  user_agent?: string | null;
  ad_request_id?: string | null;
}): string {
  const canonical = [fields.ip, fields.rida, fields.device_id, fields.user_agent, fields.ad_request_id]
    .map((v) => (v ? v.trim().toLowerCase() : ""))
    .join("|");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export interface ParsedRecord {
  timestamp: string | null;
  channelName: string | null;
  ip: string | null;
  rida: string | null;
  device_id: string | null;
  user_agent: string | null;
  country: string | null;
  region: string | null;
  ad_request_id: string | null;
  row: number;
}

/** Parse CSV text into normalized records (no DB writes). */
export function parseCsv(content: string, map: ImportColumnMap = DEFAULT_COLUMN_MAP): ParsedRecord[] {
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
  }) as Array<Record<string, string>>;

  const get = (row: Record<string, string>, field?: string): string | null => {
    if (!field) return null;
    const value = row[field];
    return value === undefined || value === null || String(value).trim() === "" ? null : String(value).trim();
  };

  return records.map((row, i) => {
    const ip = get(row, map.ip);
    const rida = get(row, map.rida);
    const deviceId = get(row, map.device_id);
    const ua = get(row, map.user_agent);
    const adRequestId = get(row, map.ad_request_id);
    const channelName = get(row, map.channel);
    return {
      timestamp: parseTimestamp(get(row, map.timestamp) ?? undefined),
      channelName,
      ip,
      rida,
      device_id: deviceId,
      user_agent: ua,
      country: get(row, map.country),
      region: get(row, map.region),
      ad_request_id: adRequestId,
      row: i + 2, // header = row 1
    };
  });
}

async function findChannelId(name: string | null): Promise<number | null> {
  if (!name) return null;
  const row = (await getDb().prepare("SELECT id FROM channels WHERE name = ? OR lower(name) = lower(?)").get(name, name)) as
    | { id: number }
    | undefined;
  return row ? row.id : null;
}

export interface ImportResult {
  imported: number;
  duplicates: number;
  skippedNoSignals: number;
  unknownChannels: string[];
  records: Array<Record<string, unknown>>;
}

/**
 * Insert parsed records into traffic_records. Skips rows with no usable
 * signals (ip/rida/device_id/user_agent all empty). Dedupe by record_hash when
 * the dedupe_on_import setting is enabled.
 */
export async function importRecords(
  parsed: ParsedRecord[],
  source: "csv" | "manual" | "api" = "csv"
): Promise<ImportResult> {
  const db = getDb();
  const dedupe = (await getSetting("dedupe_on_import")) !== "false";
  const unknownChannels = new Set<string>();
  let duplicates = 0;
  let skippedNoSignals = 0;

  await db.transaction(async (tx) => {
    const insert = tx.prepare(
      `INSERT INTO traffic_records (id, channel_id, timestamp, ip, rida, device_id, user_agent, country, region, ad_request_id, source, record_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const exists = tx.prepare("SELECT 1 FROM traffic_records WHERE record_hash = ? LIMIT 1");
    for (const row of parsed) {
      const hasSignals = Boolean(row.ip || row.rida || row.device_id || row.user_agent);
      if (!hasSignals) {
        skippedNoSignals += 1;
        continue;
      }
      const hash = recordHash({
        ip: row.ip,
        rida: row.rida,
        device_id: row.device_id,
        user_agent: row.user_agent,
        ad_request_id: row.ad_request_id,
      });
      if (dedupe && hash && (await exists.get(hash))) {
        duplicates += 1;
        continue;
      }
      const channelId = await findChannelId(row.channelName);
      if (row.channelName && channelId === null) unknownChannels.add(row.channelName);
      await insert.run(
        crypto.randomUUID(),
        channelId,
        row.timestamp,
        row.ip,
        row.rida,
        row.device_id,
        row.user_agent,
        row.country,
        row.region,
        row.ad_request_id,
        source,
        hash
      );
    }
  });

  const imported = parsed.length - duplicates - skippedNoSignals;
  const records = await listRecords({ limit: 500 });
  await audit("traffic.import", "traffic_records", null, { imported, duplicates, skippedNoSignals, source });

  return { imported, duplicates, skippedNoSignals, unknownChannels: [...unknownChannels], records };
}

/** Insert a single manually entered record. */
export async function addManualRecord(input: {
  channelId?: number | null;
  timestamp?: string | null;
  ip?: string | null;
  rida?: string | null;
  device_id?: string | null;
  user_agent?: string | null;
  country?: string | null;
  region?: string | null;
  ad_request_id?: string | null;
}): Promise<string> {
  const db = getDb();
  const id = crypto.randomUUID();
  const hash = recordHash({
    ip: input.ip,
    rida: input.rida,
    device_id: input.device_id,
    user_agent: input.user_agent,
    ad_request_id: input.ad_request_id,
  });
  await db
    .prepare(
      `INSERT INTO traffic_records (id, channel_id, timestamp, ip, rida, device_id, user_agent, country, region, ad_request_id, source, record_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`
    )
    .run(
      id,
      input.channelId ?? null,
      input.timestamp ? new Date(input.timestamp).toISOString() : null,
      input.ip || null,
      input.rida || null,
      input.device_id || null,
      input.user_agent || null,
      input.country || null,
      input.region || null,
      input.ad_request_id || null,
      hash
    );
  await audit("traffic.manual_add", "traffic_records", id, { channelId: input.channelId ?? null });
  return id;
}

export interface RecordQuery {
  limit?: number;
  offset?: number;
  channelId?: number | null;
  q?: string | null;
}

export async function listRecords(query: RecordQuery = {}): Promise<Array<Record<string, unknown>>> {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.channelId) {
    clauses.push("r.channel_id = ?");
    params.push(query.channelId);
  }
  if (query.q) {
    clauses.push("(r.ip LIKE ? OR r.rida LIKE ? OR r.device_id LIKE ? OR r.user_agent LIKE ? OR r.ad_request_id LIKE ?)");
    const like = `%${query.q}%`;
    params.push(like, like, like, like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(query.limit ?? 100, 1000);
  const offset = query.offset ?? 0;
  return (await db
    .prepare(
      `SELECT r.*, c.name AS channel_name FROM traffic_records r
       LEFT JOIN channels c ON c.id = r.channel_id
       ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)) as Array<Record<string, unknown>>;
}

export async function countRecords(): Promise<number> {
  const row = (await getDb().prepare("SELECT COUNT(*) AS n FROM traffic_records").get()) as { n: number };
  return row.n;
}

export async function deleteAllRecords(): Promise<{ deleted: number }> {
  const db = getDb();
  const deleted = await countRecords();
  await db.prepare("DELETE FROM pixalate_results").run();
  await db.prepare("DELETE FROM traffic_records").run();
  await audit("traffic.delete", "traffic_records", null, { deleted });
  logger.info({ deleted }, "all traffic records deleted");
  return { deleted };
}