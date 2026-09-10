import fs from "node:fs";
import path from "node:path";
import { openDatabase, closeDatabase } from "../db/database.js";
import { parseCsv, importRecords } from "../services/importer.js";
import { logger } from "../utils/logger.js";
/** Loads sample_roku_traffic.csv (fake data only) into the database. */
await openDatabase();
// The sample CSV lives at the repository root; npm workspace scripts run with
// cwd = server/, so search upward from the current directory.
let samplePath = path.resolve(process.cwd(), "sample_roku_traffic.csv");
if (!fs.existsSync(samplePath)) {
    for (const candidate of [path.resolve(process.cwd(), "..", "sample_roku_traffic.csv"), path.resolve(process.cwd(), "..", "..", "sample_roku_traffic.csv")]) {
        if (fs.existsSync(candidate)) {
            samplePath = candidate;
            break;
        }
    }
}
if (!fs.existsSync(samplePath)) {
    logger.error({ samplePath }, "sample CSV not found. Run from the project root.");
    process.exit(1);
}
const content = fs.readFileSync(samplePath, "utf-8");
const parsed = parseCsv(content);
const result = await importRecords(parsed, "csv");
logger.info({ imported: result.imported, duplicates: result.duplicates, skipped: result.skippedNoSignals, unknownChannels: result.unknownChannels }, "sample data seeded");
await closeDatabase();
//# sourceMappingURL=seedSample.js.map