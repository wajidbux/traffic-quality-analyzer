# Traffic Quality Analyzer

A production-oriented, **offline/sampling** traffic-quality analyzer for a CTV/Roku AVOD business.
It imports samples of Roku ad-request traffic, submits selected signals to the **Pixalate Ad Fraud API**,
stores the returned fraud-probability results, and produces dashboards, analysis views, exports (CSV/XLSX),
and professional PDF reports — including an SSP-facing summary.

> **Default behavior — nothing is ever analyzed automatically.**
> The workflow is always: **IMPORT → SAMPLE → SHOW ESTIMATED API USAGE → USER CONFIRMS → ANALYZE → STORE → REPORT**.
> Every record analyzed generates exactly one Pixalate call, and the app blocks batches that would exceed the
> remaining quota unless you explicitly override.

---

## 1. Technology stack

| Layer | Technology |
|---|---|
| Backend API | Node.js 20+ · TypeScript · Express |
| Database | SQLite (`better-sqlite3`) or PostgreSQL (`pg`) behind one async adapter — same schema, same APIs, zero code changes |
| Pixalate client | Native `fetch` + typed error mapping + retry policy |
| Frontend | React 18 · Vite · react-router · Recharts |
| Reports | PDF via `pdfkit` · XLSX via `exceljs` · CSV |
| Tests | Vitest + Supertest (Pixalate responses mocked — no real API calls) |
| Logging | Pino with guaranteed API-key redaction |

## 2. Project structure

```
traffic-quality-analyzer/
├── server/                     # Backend API (Express, TypeScript)
│   ├── src/
│   │   ├── index.ts            # bootstrap (DB open, listen)
│   │   ├── app.ts              # Express app assembly + DI
│   │   ├── config.ts           # zod-validated env config (API key lives here)
│   │   ├── context.ts          # shared services (client injectable for tests)
│   │   ├── db/
│   │   │   ├── types.ts        # async Database/Statement interface
│   │   │   ├── sqlite.ts       # better-sqlite3 adapter
│   │   │   ├── postgres.ts     # pg adapter + SQLite→Postgres SQL translator
│   │   │   ├── database.ts     # async factory: sqlite: vs postgres://
│   │   │   ├── schema.sql      # SQLite DDL (local dev / tests)
│   │   │   └── schema.pg.sql   # PostgreSQL DDL (identical shape)
│   │   ├── pixalate/           # Pixalate Ad Fraud API client + response parser
│   │   ├── services/           # analyzer, quota manager, risk classifier,
│   │   │                       # sampling, importer, statistics, reports, audit
│   │   ├── routes/             # channels, records, runs, pixalate, stats,
│   │   │                       # reports, settings, audit, ingest
│   │   └── utils/              # validation, masking, rate limiter, logger,
│   │                               # asyncHandler
│   ├── tests/                  # Vitest unit + API + (optional) live PG integration
│   └── src/scripts/seedSample.ts
├── client/                     # React dashboard (Vite)
│   └── src/
│       ├── pages/              # Dashboard, Upload, Run Analysis, Results,
│       │                       # Channels, Risk Analysis, Pixalate API,
│       │                       # Reports, Settings
│       └── components/         # cards, tables, charts, badges
├── scripts/
│   ├── generate-sample-csv.mjs
│   └── mock-pixalate.mjs       # bundled mock Pixalate server for smoke tests
├── sample_roku_traffic.csv     # fake data only
├── .env.example
└── README.md
```

Architecture (the browser never talks to Pixalate):

```
Frontend (React)  →  Backend API (Express)  →  Traffic Analysis Service
                                                   ├─ Sampling Service
                                                   ├─ Quota Manager (metadata sync + local estimate)
                                                   ├─ Rate limiter / concurrency / retries
                                                   └─ Pixalate API Client  →  api.pixalate.com
                                                   └─ SQLite (records, results, runs, usage, errors, audit)
```

## 3. Pixalate Ad Fraud API — implemented behavior (verified against the live spec)

Source of truth: <https://developer.pixalate.com/fraud-api-docs> · **live OpenAPI spec v2.0.1**:
<https://api.pixalate.com/.well-known/api/v2/fraud/fraud.yml>

| Item | Value (verified in the spec) |
|---|---|
| Server | `https://fraud-api.pixalate.com/api/v2` |
| Analysis endpoint | `GET /fraud?ip=&deviceId=&userAgent=` → `FraudInfo` schema |
| Metadata/quota | **`GET /fraud` with NO parameters** → `Metadata` schema. Spec: *"Not specifying an IP, Device, or Agent will return the metadata for fraud, including the user's current quota."* No analysis parameters are sent, so the quota check does not consume a fraud-analysis call |
| Authentication | Header `x-api-key: <API KEY>` — server-side only, never logged |
| Request parameters | `ip` (IPv4/IPv6), `deviceId` (RIDA/device UUID — ADID, IDFA, IDFV, WAID, MSAI, GAID, MD5, SHA1 all accepted), `userAgent` — zero or more; multiple params are combined into one risk assessment |
| Response (FraudInfo) | `probability` — risk score **0.1–1.0**; **0.0 indicates unknown** (treated as no-score, not "lower risk") |
| Response (Metadata) | `database.lastUpdated` + `quota.{ available, used, expiry, limit, interval, timeUnit }` — `available` is the remaining quota |
| Quota | Every fraud-analysis call consumes one unit; the no-param metadata call returns quota state |

**Response parsing is centralized** in `server/src/pixalate/responseParser.ts`. It parses the documented
fields first (`probability`, `quota.available/used/expiry/limit/interval/timeUnit`) and still tolerates
legacy/candidate aliases. The **raw response body is always stored** in the database for the audit trail.
If Pixalate changes the schema, adjust this one file.

**Error handling** (`server/src/pixalate/client.ts`):

| HTTP / condition | Type | Retried? |
|---|---|---|
| 401 | `unauthorized` (spec: *Invalid API Key*) | never |
| 403 | `quota_exhausted` (spec: *Rate plan expired or quota has been exhausted*) | never — **run stops** |
| 400 | `bad_request` (spec: *Invalid parameters*) | never |
| 404 | `not_found` (defensive; not documented) | never |
| 429 (rate limit) | `rate_limited` (defensive; not documented) | exponential backoff (honors `Retry-After`) |
| 5xx | `server_error` (spec: *Server Error*) | exponential backoff |
| timeout / network | `timeout` / `network` | exponential backoff |

Every failed request is stored in `api_errors` (timestamp, HTTP status, error message, record/run IDs).
Every call is logged in `api_usage` (endpoint, status, latency, quota before/after). **The API key is
redacted from all logs** (see `server/src/utils/logger.ts`). The analyzer also keeps a **local quota
esimate** (decremented per successful call, synced from `quota.available` on each metadata check), so the
quota guard works even if the metadata response is temporarily unavailable.

## 4. Setup

Requirements: Node.js ≥ 20 (tested on 22), npm.

```bash
# 1. Install everything (workspaces: server + client)
npm install

# 2. Configure environment
cp .env.example .env
#    → edit .env, set PIXALATE_API_KEY=<your key>
#    The server loads .env automatically (see step 4 note) — or export the vars.

# 3. (Optional) Load the sample data
npm run seed:sample          # imports sample_roku_traffic.csv (fake data)

# 4. Run in development (backend on :3001, frontend on :5173)
npm run dev

# Production build + run
npm run build
npm start
```

**Commands**

| Command | Purpose |
|---|---|
| `npm install` | Install all workspaces |
| `npm run dev` | Backend + frontend dev servers |
| `npm run build` | Compile server + build client bundle |
| `npm start` | Run the built server (serves API only; serve `client/dist` with any static host) |
| `npm run typecheck` | Typecheck both workspaces |
| `npm test` | Run server test suite (Vitest) |
| `npm run seed:sample` | Import `sample_roku_traffic.csv` into the DB |

### Database

- SQLite file lives at `data/tqa.sqlite` (configurable via `DATABASE_URL`, created automatically on first run).
- Schema: `channels → traffic_records → pixalate_results`, plus `analysis_runs`, `api_usage`, `api_errors`,
  `settings`, `kv_store`, `audit_log` — see `server/src/db/schema.sql`.
- The `server/src/db/postgres.ts` adapter implements the same async `Database` interface for PostgreSQL
via `node-postgres`, with a SQLite→Postgres SQL translator so the existing SQL (written in SQLite
dialect, `?` placeholders) runs unchanged: `INSERT OR IGNORE` → `INSERT ... ON CONFLICT DO NOTHING`,
`datetime('now')` → UTC `to_char(...)`, `ORDER BY RANDOM()` → `random()`, `strftime(...)` → `to_char(...)`,
`json_group_array(...)` → `json_agg(...)`, `?` → `$n`. Set `DATABASE_URL=postgres://user:password@host:5432/db`
and the app starts using Postgres with no code changes.

For `user:password@host/db` auth in `DATABASE_URL=postgres://...` connection strings, the `
`pg` driver parses the URI and the app asserts only the connection string; connect-only principals (SCRAM
over TLS) are the production norm. Local dev typically uses a `pg_hba.conf` entry such as
`host all all 127.0.0.1/32 md5`.

The app applies the schema automatically (see `server/src/db/schema.pg.sql`) on first connection. For CI the
`server/src/scripts/copy-assets.mjs` build step copies the schema files into `dist/db/`.

### Configuring the API key

1. Get a key from your Pixalate account (developer.pixalate.com).
2. Set `PIXALATE_API_KEY` in `.env` (or the process environment). The server reads `.env` from the project root.
3. Restart the backend. The **Pixalate API** page shows `API Key Configured: YES` (the key itself is never displayed).
4. Click **Test Connection** — this uses the metadata endpoint and does not consume analysis quota.

> The server scripts load `.env` automatically via Node's `--env-file-if-exists` flag (Node ≥ 22.9) —
> `npm run dev` and `npm start` pick up `.env` from the project root. You can also export the variables
> directly in your shell instead.

## 5. Importing Roku traffic

1. Go to **Traffic Upload**.
2. Drop a CSV (or paste the columns). Expected columns: `timestamp, channel, ip, rida, device_id, user_agent,
   country, region, ad_request_id` — **column names are auto-detected and mappable** for your export format.
3. Rows without any signal (no IP, no RIDA/device ID, no UA) are skipped; duplicates are deduped (configurable).
4. Imports only **stage** records — nothing is sent to Pixalate at this step.
5. Or use **Manual Entry** to add records by hand.

`sample_roku_traffic.csv` contains 120 fake rows (RFC 5737 IPs, fake UUIDs) for testing.

## 6. Running an analysis

1. **Run Analysis** → choose filters (channel, date range, country), a **sample strategy**
   (all / random N / percentage / per-channel / per-country / per-hour / unique IP / unique RIDA / unique IP+RIDA),
   and an **analysis mode** (IP only, RIDA only, UA only, IP+RIDA, IP+RIDA+UA, or AUTO = strongest available
   combination per record).
2. **Preview** → the app shows *records selected*, *estimated API calls*, *current quota* and
   *remaining after analysis*. **If the batch would exceed quota it is blocked.**
3. **Confirm** → the batch runs server-side with rate limiting (default 30 req/min, 5 concurrent, retries with
   backoff for 429/5xx; never retried for 401/403/400/quota-exhaustion). You can watch progress live and cancel.
4. Every result (probability, signals submitted, raw response, status, latency) is stored in `pixalate_results`
   under an **analysis run** with a unique ID.

## 7. Interpretation — risk bands

Pixalate's response is a **probability (risk score)** for the submitted signal or signal combination.
The app stores the score exactly as returned and labels it clearly:

| Band | Default range | Meaning |
|---|---|---|
| Lower risk | 0.00–0.49 | Do not automatically classify as fraud |
| Elevated risk | 0.50–0.74 | Review |
| High risk | 0.75–0.89 | Priority review |
| Very high risk | 0.90–1.00 | Priority review |

The default thresholds mirror the blocking guidance in Pixalate's own spec (Ad Fraud API v2.0.1):

> - Probability equal to 1.0, for filtering out only the worst offender for blocking (deterministic).
> - Probability ≥ 0.90 … fraudulent beyond a reasonable doubt.
> - Probability between 0.75 (inclusive) and 0.90 (exclusive) … clear and convincing evidence.
> - Probability between 0.5 (inclusive) and 0.75 (exclusive) … more likely than not.
> - Pixalate does not recommend blocking any probabilities less than 0.5.

These are **analytical categories**, not determinations of fraud. The dashboard/report wording follows
Pixalate's documentation and never claims e.g. *"X% of traffic is fraudulent"* or *"Pixalate verified all
traffic as legitimate."* The methodology statement is:

> *"This report analyzes a sampled set of CTV/Roku traffic signals using Pixalate's Ad Fraud API. The Pixalate
> probability represents a risk assessment for the submitted signal or signal combination and should not be
> interpreted as definitive proof that an individual request is fraudulent."*

## 8. Reports

From **Reports** (or the run detail page):

- **PDF** — full "CTV Traffic Quality Analysis Report": methodology, key statistics, risk distribution,
  risk bands, channel info, high-risk findings (masked), API usage, limitations.
- **XLSX** — Overview, Risk Distribution, Risk Bands, Analyzed Records, High-Risk Records, Channels, Geo sheets.
- **CSV** — full per-record results.
- **SSP-facing PDF** — simplified summary for partners (e.g., Algorix): channel, period, sample size, primary
  device, primary GEOs, band percentages, methodology + limitations. **No raw IPs, RIDAs or other identifiers.**

Sensitive values are masked by default (Settings → *Mask sensitive values*); masking can be turned off by an
administrator. Masking is display/export-level — stored data retains full fidelity for analysis.

## 9. Preventing accidental excessive API usage

1. **Offline-first**: no live scanning; analysis only ever runs on explicitly selected samples.
2. **Preview + confirm gate**: estimated calls vs. quota are shown before anything runs; the batch is
   **blocked** if it would exceed remaining quota.
3. **Smart sampling**: random N / percentage / per-channel / per-country / per-hour / unique-IP / unique-RIDA
   strategies so you spend limited quota deliberately.
4. **Throttling**: token-bucket rate limit (default 30/min) + concurrency cap (5) + bounded retries.
5. **Quota tracking**: metadata sync + local estimate; warnings at configurable thresholds (default yellow
   ≤ 800, red ≤ 200 remaining).
6. **Run stops** on quota exhaustion / auth failure mid-batch, and the remaining work is not executed.
7. **Audit trail**: every quota check, run, error, and export is recorded in `audit_log` / `api_usage` /
   `api_errors`.

## 10. Security notes

- The Pixalate API key exists **only on the server** (`PIXALATE_API_KEY` env var) and is redacted from logs.
- IPs and device identifiers are treated as sensitive operational data: masked in the UI/exports by default,
  never disclosed in SSP reports, and never sent anywhere except to Pixalate (no other third parties).
- Run behind HTTPS in production; protect the SQLite file (SQLCipher/disk encryption) and environment.
- Data retention is configurable (Settings) with a manual purge; deleting an analysis run deletes its results.
- Role-based access control is **not** included in v1 (single-user tool); the backend is designed so an auth
  middleware can be added in `app.ts` without touching the services.

## 11. Webhook / API ingestion (ad server / SSP feed)

Ad servers and SSPs can push traffic records directly into the analyzer via a JSON endpoint — no CSV needed.
The endpoint **stages records only** and never triggers Pixalate analysis; analysis always follows the
manual confirm flow.

### Enable it

```bash
# .env
INGESTION_API_KEY=<generate-a-long-random-string>
INGESTION_MAX_BATCH=1000        # max records per request
INGESTION_RATE_PER_MINUTE=120   # max requests per minute
```

This is a **separate key from the Pixalate key** — never reuse `PIXALATE_API_KEY`. The key is server-side
only (compared with a constant-time check), never logged, and never shown in the UI.

### Endpoint

```
POST /api/ingest
GET  /api/ingest/status   # enabled? max batch? sample payload? (no secrets)
```

Auth: `x-ingest-key: <INGESTION_API_KEY>` (or `Authorization: Bearer <key>`).

```bash
curl -X POST http://localhost:3001/api/ingest \\
  -H "Content-Type: application/json" \\
  -H "x-ingest-key: <your-ingestion-key>" \\
  -d '{
    "records": [
      {
        "timestamp": "2026-09-01T10:00:00Z",
        "channel": "Movie Vault",
        "ip": "198.51.100.7",
        "rida": "11111111-1111-4111-8111-111111111111",
        "user_agent": "Roku/DVP-10 (Roku Ultra)",
        "country": "US",
        "region": "CA",
        "ad_request_id": "adreq-000001"
      }
    ]
  }'
```

A single record object is also accepted (no `records` wrapper). Field aliases are normalized automatically
(`ip_address`, `deviceId`, `userAgent`, `eventTime`, `request_id`, `appName`, `country_code`, …).

Response: `201` with `{ imported, duplicates, skippedNoSignals, rejected: [{index, reason}], unknownChannels }`.
Errors: `401` bad key · `429` rate limited · `413` batch too large · `400` empty/malformed · `503` disabled.

## 12. Tests

```bash
npm test
```

Covers: API auth header + param construction, quota retrieval, IP/RIDA/UA/combined lookups, invalid input,
missing parameters, rate limiting, 429 handling, quota exhaustion, timeout/network errors, retry policy,
DB persistence, risk classification, CSV import/dedupe/column mapping, sampling strategies, analysis-run
lifecycle (confirm gate, quota guard, early-stop), XLSX/PDF/CSV/SSP report generation, masking, and the
REST API end-to-end. **Pixalate is fully mocked — no real API calls in tests.**## 13. Roadmap / extensibility

The Pixalate integration sits behind an interface (`PixalateClientLike`) so the API surface can evolve
independently. The database layer now sits behind the same pattern (`Database` interface + adapters).

- ~~Webhook/API ingestion~~ ✅ shipped (see §11)
- ~~Postgres driver behind the same schema~~ ✅ shipped (`DATABASE_URL=postgres://…`)
- Live/automated daily sampling and scheduled reports
- Pixalate CTV Enrichment, Domains, Mobile APIs
- OpenRTB / VAST / Google Ad Manager analysis
- Authentication/RBAC middleware
