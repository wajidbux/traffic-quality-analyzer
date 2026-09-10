import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
fs.mkdirSync(path.join(serverRoot, "dist", "db"), { recursive: true });
fs.copyFileSync(path.join(serverRoot, "src", "db", "schema.sql"), path.join(serverRoot, "dist", "db", "schema.sql"));
fs.copyFileSync(path.join(serverRoot, "src", "db", "schema.pg.sql"), path.join(serverRoot, "dist", "db", "schema.pg.sql"));
console.log("copied schema.sql -> dist/db/schema.sql");
console.log("copied schema.pg.sql -> dist/db/schema.pg.sql");