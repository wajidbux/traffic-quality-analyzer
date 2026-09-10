// Local mock of the Pixalate Ad Fraud API, mirroring the live OpenAPI spec
// (https://api.pixalate.com/.well-known/api/v2/fraud/fraud.yml, v2.0.1).
// Lets you exercise the full TQA flow (analysis → storage → reports) without a
// real key. DO NOT use this as a production endpoint.
//
//   GET /api/v2/fraud?ip=&deviceId=&userAgent=   → FraudInfo { probability }  (analysis)
//   GET /api/v2/fraud (no params)                → Metadata { database, quota } (quota check)
//
// Start it, then run the TQA server with:
//   PIXALATE_API_KEY=mock-key PIXALATE_BASE_URL=http://localhost:9090
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.MOCK_PORT ?? 9090);

function probabilityFor(query) {
  const key = query.get("ip") ?? query.get("deviceId") ?? query.get("userAgent") ?? "none";
  const hash = parseInt(crypto.createHash("sha1").update(key).digest("hex").slice(0, 8), 16);
  // Deterministic 0.05–0.95; hash-based so results are stable per signal.
  return Math.round((0.05 + (hash % 9000) / 10000) * 100) / 100;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.headers["x-api-key"] !== process.env.MOCK_API_KEY && process.env.MOCK_REQUIRE_KEY !== "false") {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid api key" }));
    return;
  }
  if (url.pathname === "/api/v2/fraud" && req.method === "GET") {
    // Metadata: no analysis parameters → Metadata schema (quota).
    if (!url.searchParams.has("ip") && !url.searchParams.has("deviceId") && !url.searchParams.has("userAgent")) {
      const body = {
        database: { lastUpdated: "2026-08-31" },
        quota: {
          available: 900,
          used: 100,
          expiry: "2026-10-01T00:00:00.000Z",
          limit: 1000,
          interval: 1,
          timeUnit: "month",
        },
      };
      console.log("[mock] metadata ->", JSON.stringify(body.quota));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }
    const body = { probability: probabilityFor(url.searchParams), ip: url.searchParams.get("ip") };
    console.log(`[mock] fraud check -> ${body.probability}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`Mock Pixalate Ad Fraud API listening on http://localhost:${PORT}`);
});