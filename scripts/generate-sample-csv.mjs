// Generates sample_roku_traffic.csv with FAKE data only.
// Uses documentation IP ranges (RFC 5737), fake UUIDs, and plausible Roku UAs.
import fs from "node:fs";
import crypto from "node:crypto";

function uuid(seed) {
  const hex = crypto.createHash("sha1").update(`rida-${seed}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const channels = ["Movie Vault", "Hikari TV", "Lullaby Lane", "Sneak Peek"];
const uaPool = [
  "Roku/DVP-10.5.0 (Roku Ultra; 4K; A1B2C3D4E5F6)",
  "Roku/DVP-9.4.0 (Roku Streaming Stick+; 4K; 1234ABCD5678)",
  "Roku/DVP-11.0.0 (Roku Express; HD; FEDCBA987654)",
  "Roku/DVP-10.0.0 (Roku Premiere; 4K; AABBCCDDEEFF)",
  "Roku/DVP-9.2.0 (Roku Streaming Stick; HD; 112233445566)",
];
const countries = ["US", "US", "US", "GB", "US", "GB", "CA"];
const regions = { US: ["CA", "NY", "TX", "FL", "WA"], GB: ["LDN", "MAN", "BIR"], CA: ["ON", "BC"] };
const days = ["2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31"];

const rows = [];
for (let i = 1; i <= 120; i++) {
  const channel = channels[i % channels.length];
  const day = days[i % days.length];
  const hour = String(8 + (i % 12)).padStart(2, "0");
  const minute = String(i % 60).padStart(2, "0");
  const country = countries[i % countries.length];
  const regionPool = regions[country];
  const region = regionPool[i % regionPool.length];
  // ~8% of rows carry an RIDA (some devices) — real CTV samples have partial signal coverage.
  const hasRida = i % 13 !== 0;
  const hasUa = i % 9 !== 0;
  const ip = `198.51.100.${(i % 250) + 1}`;
  rows.push([
    `${day}T${hour}:${minute}:00Z`,
    channel,
    ip,
    hasRida ? uuid(i) : "",
    hasUa ? uaPool[i % uaPool.length] : "",
    country,
    region,
    `adreq-${String(i).padStart(6, "0")}`,
  ].join(","));
}

const header = "timestamp,channel,ip,rida,user_agent,country,region,ad_request_id";
fs.writeFileSync("sample_roku_traffic.csv", `${header}\n${rows.join("\n")}\n`);
console.log(`Wrote sample_roku_traffic.csv with ${rows.length} fake rows.`);