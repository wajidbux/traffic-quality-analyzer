import fs from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
const { Pool, types } = pg;
// Postgres returns COUNT(*)/SUM() (int8) and numeric as strings by default.
// Force them to JS numbers so service code can do arithmetic directly.
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10))); // int8
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // numeric
/**
 * Translate SQL written for SQLite into PostgreSQL syntax. The codebase writes
 * all queries in SQLite dialect with `?` placeholders; this maps the handful
 * of constructs that differ:
 *
 *   `?`                → `$1, $2, ...` (quote-aware)
 *   INSERT OR IGNORE   → INSERT ... ON CONFLICT DO NOTHING
 *   datetime('now')    → to_char(now() AT TIME ZONE 'UTC', ...)  (same format as SQLite)
 *   strftime('fmt', x) → to_char(x::timestamp, 'pg-fmt')
 *   json_group_array   → json_agg
 *   ORDER BY RANDOM()  → ORDER BY random()
 */
export function translateToPostgres(sql) {
    let out = sql;
    out = out.replace(/strftime\(\s*'([^']*)'\s*,\s*((?:[^()]|\([^()]*\))*)\)/g, (_m, fmt, expr) => {
        const pgFmt = fmt
            .replace(/%Y/g, "YYYY")
            .replace(/%m/g, "MM")
            .replace(/%d/g, "DD")
            .replace(/%H/g, "HH24")
            .replace(/%M/g, "MI")
            .replace(/%S/g, "SS")
            .replace(/%j/g, "DDD");
        return `to_char(${expr.trim()}::timestamp, '${pgFmt}')`;
    });
    out = out.replace(/\bjson_group_array\(([^)]*)\)/g, "json_agg($1)");
    out = out.replace(/\bORDER\s+BY\s+RANDOM\(\)/gi, "ORDER BY random()");
    // INSERT OR IGNORE INTO t (cols) VALUES (...)  →  INSERT INTO t (cols) VALUES (...) ON CONFLICT DO NOTHING
    if (/\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(out)) {
        out = out.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, "INSERT INTO");
        out = `${out.trim().replace(/;\s*$/, "")} ON CONFLICT DO NOTHING`;
    }
    out = out.replace(/\bdatetime\(\s*'now'\s*\)/gi, "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')");
    out = convertPlaceholders(out);
    return out;
}
/** Replace `?` positional placeholders with `$1..$n`, skipping string literals. */
export function convertPlaceholders(sql) {
    let out = "";
    let n = 0;
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];
        if (inSingle) {
            out += ch;
            if (ch === "'") {
                if (sql[i + 1] === "'") {
                    out += "'"; // escaped '' inside a literal
                    i += 1;
                }
                else {
                    inSingle = false;
                }
            }
            continue;
        }
        if (inDouble) {
            out += ch;
            if (ch === '"')
                inDouble = false;
            continue;
        }
        if (ch === "'") {
            inSingle = true;
            out += ch;
            continue;
        }
        if (ch === '"') {
            inDouble = true;
            out += ch;
            continue;
        }
        if (ch === "?") {
            n += 1;
            out += `$${n}`;
            continue;
        }
        out += ch;
    }
    return out;
}
function statementsFor(queryable, sql) {
    const pgSql = translateToPostgres(sql);
    return {
        get: async (...params) => {
            const { rows } = await queryable.query(pgSql, params);
            return rows[0];
        },
        all: async (...params) => {
            const { rows } = await queryable.query(pgSql, params);
            return rows;
        },
        run: async (...params) => {
            // Append RETURNING * to INSERTs so `lastInsertRowid` can be populated.
            const isInsert = /^\s*INSERT\b/i.test(pgSql);
            const querySql = isInsert ? `${pgSql.trim().replace(/;+\s*$/, "")} RETURNING *` : pgSql;
            const { rows, rowCount } = await queryable.query(querySql, params);
            const row = rows[0];
            return {
                changes: rowCount ?? 0,
                lastInsertRowid: row !== undefined && typeof row.id !== "undefined" ? row.id : null,
            };
        },
    };
}
/**
 * PostgreSQL adapter backed by a connection pool. Transactions check out a
 * dedicated client and pass a client-scoped Database to the callback so all
 * statements in the transaction run on the same connection.
 */
export class PostgresDatabase {
    pool;
    constructor(connectionString) {
        this.pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
        // Surface connection errors instead of letting the pool emit unhandled events.
        this.pool.on("error", (err) => {
            console.error("[postgres] pool error:", err.message);
        });
    }
    async applySchema() {
        const schemaPath = fileURLToPath(new URL("./schema.pg.sql", import.meta.url));
        // Multi-statement DDL runs via the simple query protocol (no parameters).
        await this.pool.query(fs.readFileSync(schemaPath, "utf-8"));
    }
    prepare(sql) {
        return statementsFor(this.pool, sql);
    }
    async transaction(fn) {
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const tx = {
                prepare: (s) => statementsFor(client, s),
                transaction: () => {
                    throw new Error("Nested transactions are not supported.");
                },
                exec: async (s) => {
                    await client.query(s);
                },
                close: async () => {
                    // no-op: the pool owns the client
                },
            };
            const result = await fn(tx);
            await client.query("COMMIT");
            return result;
        }
        catch (err) {
            try {
                await client.query("ROLLBACK");
            }
            catch {
                // connection may already be closed/rolled back
            }
            throw err;
        }
        finally {
            client.release();
        }
    }
    async exec(sql) {
        await this.pool.query(sql);
    }
    async close() {
        await this.pool.end();
    }
}
//# sourceMappingURL=postgres.js.map