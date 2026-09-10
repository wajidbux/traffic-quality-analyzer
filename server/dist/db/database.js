import { config, ensureDatabaseDir, resolveDatabasePath } from "../config.js";
import { SqliteDatabase } from "./sqlite.js";
import { PostgresDatabase } from "./postgres.js";
let db = null;
const DEFAULT_CHANNELS = ["Movie Vault", "Hikari TV", "Lullaby Lane", "Sneak Peek"];
export const DEFAULT_SETTINGS = {
    mask_sensitive: config.MASK_SENSITIVE ? "true" : "false",
    requests_per_minute: String(config.REQUESTS_PER_MINUTE),
    max_concurrency: String(config.MAX_CONCURRENCY),
    retry_delay_ms: String(config.RETRY_DELAY_MS),
    max_retries: String(config.MAX_RETRIES),
    request_timeout_ms: String(config.REQUEST_TIMEOUT_MS),
    quota_warn_yellow: String(config.QUOTA_WARN_YELLOW),
    quota_warn_red: String(config.QUOTA_WARN_RED),
    risk_band_elevated_from: String(config.RISK_BAND_ELEVATED_FROM),
    risk_band_high_from: String(config.RISK_BAND_HIGH_FROM),
    risk_band_very_high_from: String(config.RISK_BAND_VERY_HIGH_FROM),
    retention_days: String(config.RETENTION_DAYS),
    dedupe_on_import: "true",
};
export function isPostgresUrl(databaseUrl) {
    return /^postgres(ql)?:\/\//i.test(databaseUrl);
}
async function seedDefaults(database) {
    await database.transaction(async (tx) => {
        const insertChannel = tx.prepare("INSERT OR IGNORE INTO channels (name, description) VALUES (?, ?)");
        for (const name of DEFAULT_CHANNELS) {
            await insertChannel.run(name, null);
        }
        const setSetting = tx.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
            await setSetting.run(key, value);
        }
    });
}
/**
 * Open the configured database. `DATABASE_URL` selects the driver:
 *   - `sqlite:./data/tqa.sqlite` (default)  → SQLite via better-sqlite3
 *   - `postgres://user:pass@host:5432/db`   → PostgreSQL via node-postgres
 */
export async function openDatabase(databaseUrl = config.DATABASE_URL) {
    if (db)
        return db;
    let database;
    if (isPostgresUrl(databaseUrl)) {
        database = new PostgresDatabase(databaseUrl);
    }
    else {
        const file = resolveDatabasePath(databaseUrl);
        if (!file.startsWith(":memory:")) {
            ensureDatabaseDir(config);
        }
        database = new SqliteDatabase(file);
    }
    if (database instanceof SqliteDatabase) {
        await database.applySchema();
    }
    else if (database instanceof PostgresDatabase) {
        await database.applySchema();
    }
    await seedDefaults(database);
    db = database;
    return database;
}
export function getDb() {
    if (!db) {
        throw new Error("Database is not open. Call `await openDatabase()` before using the database.");
    }
    return db;
}
export async function closeDatabase() {
    if (db) {
        await db.close();
        db = null;
    }
}
/** Swap the active database (tests). Pass null to detach it. */
export function useDatabase(database) {
    db = database;
    return database;
}
/** Open an isolated in-memory database for tests. */
export async function openInMemoryDatabase() {
    const database = new SqliteDatabase(":memory:");
    await database.applySchema();
    await seedDefaults(database);
    return database;
}
// ---- settings helpers ------------------------------------------------------
export async function getSetting(key) {
    const row = (await getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key));
    return row ? row.value : null;
}
export async function getSettingNumber(key, fallback) {
    const value = await getSetting(key);
    const n = value === null ? NaN : Number(value);
    return Number.isFinite(n) ? n : fallback;
}
export async function setSetting(key, value) {
    await getDb()
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(key, value);
}
export async function getAllSettings() {
    const rows = (await getDb().prepare("SELECT key, value FROM settings").all());
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
export async function getRiskBands() {
    return {
        elevatedFrom: await getSettingNumber("risk_band_elevated_from", config.RISK_BAND_ELEVATED_FROM),
        highFrom: await getSettingNumber("risk_band_high_from", config.RISK_BAND_HIGH_FROM),
        veryHighFrom: await getSettingNumber("risk_band_very_high_from", config.RISK_BAND_VERY_HIGH_FROM),
    };
}
// ---- kv store (quota state etc.) -------------------------------------------
export async function kvGet(key) {
    const row = (await getDb().prepare("SELECT value FROM kv_store WHERE key = ?").get(key));
    if (!row)
        return null;
    try {
        return JSON.parse(row.value);
    }
    catch {
        return null;
    }
}
export async function kvSet(key, value) {
    await getDb()
        .prepare("INSERT INTO kv_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(key, JSON.stringify(value));
}
//# sourceMappingURL=database.js.map