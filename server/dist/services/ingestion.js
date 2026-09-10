import { importRecords, parseTimestamp } from "./importer.js";
import { audit } from "./auditLogger.js";
export class IngestValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "IngestValidationError";
    }
}
const ALIASES = {
    timestamp: ["timestamp", "time", "event_time", "eventTime", "ts"],
    channelName: ["channel", "channel_name", "channelName", "app", "app_name", "appName"],
    ip: ["ip", "ip_address", "ipAddress"],
    rida: ["rida", "device_rida", "rid"],
    device_id: ["device_id", "deviceId", "deviceid"],
    user_agent: ["user_agent", "userAgent", "useragent", "ua", "agent"],
    country: ["country", "country_code", "countryCode"],
    region: ["region", "region_code", "state", "province"],
    ad_request_id: ["ad_request_id", "adRequestId", "request_id", "requestId", "adid", "impression_id", "impressionId"],
};
function pick(record, field) {
    for (const alias of ALIASES[field]) {
        const value = record[alias];
        if (value === undefined || value === null)
            continue;
        if (typeof value === "object") {
            throw new IngestValidationError(`Field "${alias}" must be a scalar value (string or number).`);
        }
        const str = String(value).trim();
        if (str !== "")
            return str;
    }
    return null;
}
/** Normalize a raw JSON record into the importer's ParsedRecord shape. */
export function normalizeIngestRecord(raw, index) {
    const ip = pick(raw, "ip");
    const rida = pick(raw, "rida");
    const deviceId = pick(raw, "device_id");
    const ua = pick(raw, "user_agent");
    const timestamp = pick(raw, "timestamp");
    const channelName = pick(raw, "channelName");
    const country = pick(raw, "country");
    const region = pick(raw, "region");
    const adRequestId = pick(raw, "ad_request_id");
    return {
        timestamp: parseTimestamp(timestamp ?? undefined),
        channelName,
        ip,
        rida,
        device_id: deviceId,
        user_agent: ua,
        country,
        region,
        ad_request_id: adRequestId,
        row: index + 1,
    };
}
/**
 * Validate and stage an ingestion payload.
 * Returns per-record rejection reasons; well-formed records flow through the
 * same dedupe / no-signal handling as CSV imports.
 */
export async function ingestRecords(payload) {
    let rawRecords;
    if (Array.isArray(payload)) {
        rawRecords = payload;
    }
    else if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const record = payload;
        if (Array.isArray(record.records)) {
            rawRecords = record.records;
        }
        else {
            rawRecords = [record];
        }
    }
    else {
        throw new IngestValidationError("Payload must be a JSON object or an array of records.");
    }
    const parsed = [];
    const rejected = [];
    rawRecords.forEach((raw, i) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            rejected.push({ index: i, reason: "record must be a JSON object" });
            return;
        }
        try {
            parsed.push(normalizeIngestRecord(raw, i));
        }
        catch (err) {
            rejected.push({ index: i, reason: err instanceof Error ? err.message : String(err) });
        }
    });
    const result = await importRecords(parsed, "api");
    await audit("traffic.import", "traffic_records", null, {
        imported: result.imported,
        duplicates: result.duplicates,
        skippedNoSignals: result.skippedNoSignals,
        rejected: rejected.length,
        source: "api",
    });
    return { result, rejected, received: rawRecords.length };
}
//# sourceMappingURL=ingestion.js.map