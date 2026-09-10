import fs from "node:fs";
import { fileURLToPath } from "node:url";
import BetterSqlite3 from "better-sqlite3";
import { Database, Row, RunResult, Statement } from "./types.js";

/**
 * SQLite adapter. Wraps the synchronous better-sqlite3 driver behind the async
 * Database interface. A single connection is used; transactions are serialized
 * with a promise-chain mutex so concurrent transaction bodies cannot interleave
 * on the shared connection.
 */
export class SqliteDatabase implements Database {
  private raw: BetterSqlite3.Database;
  private txTail: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.raw = new BetterSqlite3(file);
    this.raw.pragma("journal_mode = WAL");
    this.raw.pragma("foreign_keys = ON");
    this.raw.pragma("busy_timeout = 5000");
  }

  /** Create an isolated in-memory database (tests). */
  static inMemory(): SqliteDatabase {
    const db = new SqliteDatabase(":memory:");
    db.raw.pragma("journal_mode = MEMORY");
    return db;
  }

  async applySchema(): Promise<void> {
    const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));
    this.raw.exec(fs.readFileSync(schemaPath, "utf-8"));
  }

  prepare(sql: string): Statement {
    const stmt = this.raw.prepare(sql);
    return {
      get: async (...params: unknown[]): Promise<Row | undefined> => stmt.get(...params) as Row | undefined,
      all: async (...params: unknown[]): Promise<Row[]> => stmt.all(...params) as Row[],
      run: async (...params: unknown[]): Promise<RunResult> => stmt.run(...params),
    };
  }

  async transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
    // Serialize transactions: better-sqlite3 has a single connection, so two
    // in-flight transaction bodies must not interleave on it.
    const prev = this.txTail;
    let release!: () => void;
    this.txTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      this.raw.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn(this);
        this.raw.exec("COMMIT");
        return result;
      } catch (err) {
        try {
          this.raw.exec("ROLLBACK");
        } catch {
          // connection may already be rolled back
        }
        throw err;
      }
    } finally {
      release();
    }
  }

  async exec(sql: string): Promise<void> {
    this.raw.exec(sql);
  }

  async close(): Promise<void> {
    this.raw.close();
  }
}