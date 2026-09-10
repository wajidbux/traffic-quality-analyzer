import http from "node:http";

const API_KEY = process.env.MOCK_API_KEY ?? "mock-key";
const FRAUD_LIMIT = Number(process.env.MOCK_QUOTA_LIMIT ?? 900);
const FRAUD_USED  = Number(process.env.MOCK_QUOTA_USED  ?? 100);

let fraudRemaining = Math.max(0, FRAUD_LIMIT - FRAUD_USED);
let fraudCalls = 0;

// CTV Apps mock data
const CTV_APPS = {
  "B07SM3YB4H": {
    status: "OK",
    numFound: 1,
    docs: [{
      appId: "B07SM3YB4H",
      region: "GLOBAL",
      device: "roku",
      riskOverview: {
        risk: [{ region: "GLOBAL", pixalateRisk: "medium", pixalateRiskReasons: ["Significantly Elevated IVT Percentage"] }],
        ivt: 10.12,
        ivtRisk: "medium",
        ssaiRate: 0.55,
        transaparentSsaiRate: 0.01,
        descriptionBrandSafetyRisk: "low",
        contentBrandSafetyRisk: "low",
      },
      invalidTraffic: { ivt: 7.76, givt: 0.29, sivt: 7.47 },
      appOverview: { appTitle: "Example App", categories: ["Movies & TV"] },
      brandSafety: { descriptionBrandSafety: { adultContentRisk: "low", drugContentRisk: "medium", hateSpeechRisk: "low" } },
      rankings: { final: { grade: "C", score: "38" }, ivt: { grade: "B", score: "62" } },
    }],
  },
  "B00KDSGIPK": {
    status: "OK",
    numFound: 1,
    docs: [{
      appId: "B00KDSGIPK",
      region: "GLOBAL",
      device: "roku",
      riskOverview: {
        risk: [{ region: "GLOBAL", pixalateRisk: "low", pixalateRiskReasons: [] }],
        ivt: 2.1,
        ivtRisk: "low",
        ssaiRate: 0.1,
        transaparentSsaiRate: 0.0,
        descriptionBrandSafetyRisk: "low",
        contentBrandSafetyRisk: "low",
      },
      invalidTraffic: { ivt: 2.1, givt: 0.1, sivt: 2.0 },
      appOverview: { appTitle: "Movie Vault", categories: ["Movies & TV"] },
      brandSafety: { descriptionBrandSafety: { adultContentRisk: "low", drugContentRisk: "low", hateSpeechRisk: "low" } },
      rankings: { final: { grade: "A", score: "85" }, ivt: { grade: "A", score: "90" } },
    }],
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const auth = req.headers["x-api-key"];

  res.setHeader("Content-Type", "application/json");

  // ── Ad Fraud API ──────────────────────────────────────────────────────────
  if (url.pathname === "/api/v2/fraud" || url.pathname.startsWith("/api/v2/fraud/")) {
    if (auth !== API_KEY) { res.writeHead(401); res.end(JSON.stringify({ error: "invalid api key" })); return; }

    const ip   = url.searchParams.get("ip");
    const dev  = url.searchParams.get("deviceId");
    const ua   = url.searchParams.get("userAgent");

    if (!ip && !dev && !ua) {
      res.writeHead(200);
      res.end(JSON.stringify({
        database: { lastUpdated: "2026-08-31" },
        quota: { available: fraudRemaining, used: FRAUD_USED + fraudCalls, expiry: "2026-10-01T00:00:00.000Z", limit: FRAUD_LIMIT, interval: 1, timeUnit: "month" },
      }));
      return;
    }

    fraudCalls += 1;
    fraudRemaining = Math.max(0, fraudRemaining - 1);
    if (fraudRemaining < 0) { res.writeHead(429); res.end(JSON.stringify({ error: "quota exhausted" })); return; }

    const octet = ip ? parseInt(ip.split(".").pop() ?? "0", 10) : 0;
    const probability = Math.round(((octet % 100) / 100) * 100) / 100;
    res.writeHead(200);
    res.end(JSON.stringify({ probability, ip: ip ?? undefined, deviceId: dev ?? undefined, userAgent: ua ?? undefined }));
    return;
  }

  // ── CTV Apps API ──────────────────────────────────────────────────────────
  if (url.pathname === "/mrt/ctv" || url.pathname.startsWith("/mrt/ctv/")) {
    if (auth !== API_KEY) { res.writeHead(401); res.end(JSON.stringify({ error: "invalid api key" })); return; }

    // GET /mrt/ctv — quota/metadata (no params)
    if (url.pathname === "/mrt/ctv" && !url.pathname.startsWith("/mrt/ctv/")) {
      res.writeHead(200);
      res.end(JSON.stringify({
        database: { lastUpdated: "2026-08-31" },
        quota: { available: 480, used: 520, expiry: "2026-10-01T12:45:23.234Z", limit: 1000, interval: 1000, timeUnit: "month" },
      }));
      return;
    }

    // GET /mrt/ctv/{appId}
    const appId = url.pathname.replace("/mrt/ctv/", "");
    if (appId && CTV_APPS[appId]) {
      res.writeHead(200);
      res.end(JSON.stringify(CTV_APPS[appId]));
      return;
    }

    // Unknown app → 404
    res.writeHead(404);
    res.end(JSON.stringify({ error: "App not found", statusCode: 404 }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(9090, () => {
  console.log(JSON.stringify({ listening: 9090, mock_quota: { limit: FRAUD_LIMIT, used: FRAUD_USED, remaining: fraudRemaining }, mock_key: API_KEY }));
});
