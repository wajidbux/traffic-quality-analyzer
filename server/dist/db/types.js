/**
 * Async database abstraction shared by the SQLite and PostgreSQL adapters.
 *
 * The interface mirrors the synchronous `prepare().get/all/run` shape used
 * throughout the codebase, but every statement method is async so both the
 * synchronous better-sqlite3 driver and the async `pg` driver can sit behind
 * it. Services call `await db.prepare(sql).get(...)` etc.
 */
export {};
//# sourceMappingURL=types.js.map