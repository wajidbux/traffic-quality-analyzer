import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { openInMemoryDatabase, useDatabase } from "../src/db/database.js";
import { addManualRecord, importRecords, parseCsv, guessColumnMap, countRecords } from "../src/services/importer.js";

const SAMPLE_CSV = `timestamp,channel,ip,rida,user_agent,country,region,ad_request_id
2026-09-01T10:00:00Z,Movie Vault,198.51.100.1,11111111-1111-4111-8111-111111111111,Roku/DVP-10 (Roku Ultra),US,CA,req-0001
2026-09-01T10:01:00Z,Hikari TV,198.51.100.2,,Roku/DVP-10 (Roku Streaming Stick),GB,LDN,req-0002
2026-09-01T10:02:00Z,Lullaby Lane,198.51.100.3,22222222-2222-4222-8222-222222222222,,US,NY,req-0003
2026-09-01T10:03:00Z,UnknownChannel,198.51.100.4,,,,US,CA,req-0004
2026-09-01T10:04:00Z,Movie Vault,,,,,,req-0005`;

describe("importer", () => {
  beforeEach(async () => {
    useDatabase(await openInMemoryDatabase());
  });
  afterEach(() => useDatabase(null));

  it("parses CSV rows into normalized records", () => {
    const parsed = parseCsv(SAMPLE_CSV);
    expect(parsed).toHaveLength(5);
    expect(parsed[0].ip).toBe("198.51.100.1");
    expect(parsed[0].rida).toBe("11111111-1111-4111-8111-111111111111");
    expect(parsed[0].timestamp).toContain("2026-09-01");
    expect(parsed[4].ip).toBeNull();
  });

  it("guesses column maps from header names", () => {
    const map = guessColumnMap(["Timestamp", "Channel", "IP Address", "RIDA", "User Agent", "Country", "Region", "Ad Request ID"]);
    expect(map.timestamp).toBe("Timestamp");
    expect(map.ip).toBe("IP Address");
    expect(map.user_agent).toBe("User Agent");
    expect(map.ad_request_id).toBe("Ad Request ID");
  });

  it("imports records and links channels by name", async () => {
    const parsed = parseCsv(SAMPLE_CSV);
    const result = await importRecords(parsed, "csv");
    expect(result.imported).toBe(4); // last row has no signals → skipped
    expect(result.skippedNoSignals).toBe(1);
    expect(result.unknownChannels).toEqual(["UnknownChannel"]);
    expect(await countRecords()).toBe(4);
  });

  it("dedupes identical records on import", async () => {
    const parsed = parseCsv(SAMPLE_CSV.slice(0, SAMPLE_CSV.indexOf("\n2026-09-01T10:01")) + "\n2026-09-01T10:00:00Z,Movie Vault,198.51.100.1,11111111-1111-4111-8111-111111111111,Roku/DVP-10 (Roku Ultra),US,CA,req-0001");
    expect(parsed).toHaveLength(2);
    const result = await importRecords(parsed, "csv");
    expect(result.imported).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(await countRecords()).toBe(1);
  });

  it("supports custom column mapping", () => {
    const customCsv = "time,app,ip_address,rid,ua\n2026-01-01T00:00:00Z,Movie Vault,203.0.113.9,33333333-3333-4333-8333-333333333333,Roku/DVP-11";
    const parsed = parseCsv(customCsv, {
      timestamp: "time",
      channel: "app",
      ip: "ip_address",
      rida: "rid",
      user_agent: "ua",
    });
    expect(parsed[0].channelName).toBe("Movie Vault");
    expect(parsed[0].ip).toBe("203.0.113.9");
    expect(parsed[0].user_agent).toBe("Roku/DVP-11");
  });

  it("inserts manual records", async () => {
    const id = await addManualRecord({ channelId: 1, ip: "198.51.100.9", rida: "44444444-4444-4444-8444-444444444444" });
    expect(id).toBeTruthy();
    expect(await countRecords()).toBe(1);
  });
});