/**
 * Async database abstraction shared by the SQLite and PostgreSQL adapters.
 *
 * The interface mirrors the synchronous `prepare().get/all/run` shape used
 * throughout the codebase, but every statement method is async so both the
 * synchronous better-sqlite3 driver and the async `pg` driver can sit behind
 * it. Services call `await db.prepare(sql).get(...)` etc.
 */

export type Row = Record<string, unknown>;

export interface RunResult {
  /** Number of rows affected (INSERT/UPDATE/DELETE). */
  changes: number;
  /** Last inserted row id (SQLite) or the `id` column of the inserted row (Postgres). */
  lastInsertRowid: number | bigint | null;
}

export interface Statement {
  get(...params: unknown[]): Promise<Row | undefined>;
  all(...params: unknown[]): Promise<Row[]>;
  run(...params: unknown[]): Promise<RunResult>;
}

export interface Database {
  prepare(sql: string): Statement;
  /**
   * Run `fn` inside a transaction. `fn` receives a transaction-scoped
   * Database whose statements are part of the transaction.
   */
  transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T>;
  /** Execute one or more SQL statements (schema DDL etc.). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}