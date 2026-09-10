-- Traffic Quality Analyzer — PostgreSQL schema
-- Mirrors server/src/db/schema.sql (SQLite) one-to-one; keep the two in sync.

CREATE TABLE IF NOT EXISTS channels (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS traffic_records (
  id            TEXT PRIMARY KEY,                -- uuid
  channel_id    BIGINT REFERENCES channels(id) ON DELETE SET NULL,
  timestamp     TEXT,                            -- ISO 8601, may be NULL
  ip            TEXT,
  rida          TEXT,                            -- Roku RIDA (UUID)
  device_id     TEXT,                            -- other device identifiers
  user_agent    TEXT,
  country       TEXT,
  region        TEXT,
  ad_request_id TEXT,
  source        TEXT NOT NULL DEFAULT 'csv',     -- csv | manual | api
  record_hash   TEXT,                            -- sha256 of normalized signals (dedupe)
  created_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX IF NOT EXISTS idx_records_channel ON traffic_records(channel_id);
CREATE INDEX IF NOT EXISTS idx_records_timestamp ON traffic_records(timestamp);
CREATE INDEX IF NOT EXISTS idx_records_hash ON traffic_records(record_hash);
CREATE INDEX IF NOT EXISTS idx_records_ip ON traffic_records(ip);
CREATE INDEX IF NOT EXISTS idx_records_rida ON traffic_records(rida);
CREATE INDEX IF NOT EXISTS idx_records_ua ON traffic_records(user_agent);
CREATE INDEX IF NOT EXISTS idx_records_country ON traffic_records(country);

CREATE TABLE IF NOT EXISTS analysis_runs (
  id                TEXT PRIMARY KEY,            -- uuid
  name              TEXT,
  status            TEXT NOT NULL DEFAULT 'pending', -- pending|running|completed|failed|cancelled
  channel_filter    TEXT,                        -- channel name or 'all'
  mode              TEXT NOT NULL,               -- ip|device|ua|ip_device|ip_device_ua|auto
  sample_strategy   TEXT NOT NULL,               -- JSON
  started_at        TEXT,
  ended_at          TEXT,
  progress_processed INTEGER NOT NULL DEFAULT 0,
  progress_total    INTEGER NOT NULL DEFAULT 0,
  num_input         INTEGER NOT NULL DEFAULT 0,
  num_processed     INTEGER NOT NULL DEFAULT 0,
  num_success       INTEGER NOT NULL DEFAULT 0,
  num_failed        INTEGER NOT NULL DEFAULT 0,
  api_calls_used    INTEGER NOT NULL DEFAULT 0,
  quota_before      INTEGER,
  quota_after       INTEGER,
  avg_risk          DOUBLE PRECISION,
  median_risk       DOUBLE PRECISION,
  pct_lower         DOUBLE PRECISION,
  pct_elevated      DOUBLE PRECISION,
  pct_high          DOUBLE PRECISION,
  pct_very_high     DOUBLE PRECISION,
  error             TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_status ON analysis_runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_started ON analysis_runs(started_at);

CREATE TABLE IF NOT EXISTS pixalate_results (
  id                 TEXT PRIMARY KEY,           -- uuid
  record_id          TEXT NOT NULL REFERENCES traffic_records(id) ON DELETE CASCADE,
  run_id             TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  analysis_mode      TEXT NOT NULL,              -- ip|device|ua|ip_device|ip_device_ua
  signals_submitted  TEXT NOT NULL,              -- JSON array, e.g. ["ip","rida"]
  fraud_probability  DOUBLE PRECISION,           -- 0.01-1.0 as returned (NULL on failure)
  raw_response       TEXT,                       -- verbatim API response JSON (audit)
  status             TEXT NOT NULL,              -- success|error
  http_status        INTEGER,
  error_code         TEXT,
  error_message      TEXT,
  latency_ms         INTEGER,
  created_at         TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX IF NOT EXISTS idx_results_record ON pixalate_results(record_id);
CREATE INDEX IF NOT EXISTS idx_results_run ON pixalate_results(run_id);
CREATE INDEX IF NOT EXISTS idx_results_probability ON pixalate_results(fraud_probability);

CREATE TABLE IF NOT EXISTS api_usage (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  called_at   TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  endpoint    TEXT NOT NULL,                     -- analysis | metadata | test
  http_status INTEGER,
  latency_ms  INTEGER,
  quota_before INTEGER,
  quota_after  INTEGER,
  success     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS api_errors (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at   TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  endpoint      TEXT,
  http_status   INTEGER,
  error_code    TEXT,
  error_message TEXT,
  record_id     TEXT,
  run_id        TEXT,
  request_id    TEXT
);

CREATE INDEX IF NOT EXISTS idx_errors_run ON api_errors(run_id);

-- Singleton state rows: quota_state, etc.
CREATE TABLE IF NOT EXISTS kv_store (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  details     TEXT,
  actor       TEXT DEFAULT 'local'
);

CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);