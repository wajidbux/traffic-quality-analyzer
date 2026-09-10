import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Channel, ImportResult, RecordRow } from "../types";
import { Alert, Badge, Button, Card, DataTable, EmptyState, FormRow, Page } from "../components/ui";

export default function Upload() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [tab, setTab] = useState<"csv" | "manual">("csv");
  const [ingest, setIngest] = useState<{
    enabled: boolean;
    endpoint: string;
    auth: string;
    maxBatch: number;
    ratePerMinute: number;
    stagesOnly: boolean;
    note: string;
  } | null>(null);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [manual, setManual] = useState<Record<string, string>>({});

  useEffect(() => {
    api.channels().then((res) => setChannels(res.channels)).catch(() => undefined);
    api.ingestStatus().then(setIngest).catch(() => undefined);
  }, []);

  const onFile = async (file: File) => {
    setError(null);
    setResult(null);
    setFilename(file.name);
    const text = await file.text();
    setContent(text);
    try {
      const guess = await api.guessColumns(text);
      setHeaders(guess.headers);
      setColumnMap(guess.map);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void onFile(file);
  };

  const doImport = async () => {
    if (!content) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.importCsv(content, columnMap, filename ?? "traffic.csv");
      setResult(res);
      setRecords(res.records);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addManual = async () => {
    setError(null);
    try {
      await api.addManual({
        channel_id: manual.channel_id ? Number(manual.channel_id) : null,
        timestamp: manual.timestamp || null,
        ip: manual.ip || null,
        rida: manual.rida || null,
        device_id: manual.device_id || null,
        user_agent: manual.user_agent || null,
        country: manual.country || null,
        region: manual.region || null,
        ad_request_id: manual.ad_request_id || null,
      });
      setManual({});
      setError(null);
      api.records().then((r) => setRecords(r.records)).catch(() => undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const setField = (key: string, value: string) => setManual((m) => ({ ...m, [key]: value }));

  return (
    <Page
      title="Traffic Upload"
      subtitle="Import a sample of Roku/CTV ad-request traffic. Imports only stage records — nothing is sent to Pixalate here."
    >
      {error && <Alert tone="error">{error}</Alert>}
      {result && (
        <Alert tone="success">
          Imported <strong>{result.imported}</strong> record(s). Duplicates skipped: {result.duplicates}. Rows without signals
          skipped: {result.skippedNoSignals}.
          {result.unknownChannels.length > 0 && ` Unknown channels (left unlinked): ${result.unknownChannels.join(", ")}`}
        </Alert>
      )}

      <div className="tabs">
        <button className={`tab${tab === "csv" ? " active" : ""}`} onClick={() => setTab("csv")}>CSV Upload</button>
        <button className={`tab${tab === "manual" ? " active" : ""}`} onClick={() => setTab("manual")}>Manual Entry</button>
      </div>

      {tab === "csv" && (
        <>
          <div
            className={`dropzone${drag ? " drag" : ""}`}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={handleDrop}
          >
            <div className="dropzone-title">Drop a CSV file here or click to browse</div>
            <div className="dropzone-sub">
              Expected columns: timestamp, channel, ip, rida, device_id, user_agent, country, region, ad_request_id.
              Column names are mappable below. See sample_roku_traffic.csv for an example.
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.txt"
              style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
            />
          </div>

          {content && (
            <>
              <Card title={`Column mapping — ${filename}`}>
                <div className="grid grid-2">
                  {(["timestamp", "channel", "ip", "rida", "device_id", "user_agent", "country", "region", "ad_request_id"] as const).map((field) => (
                    <FormRow key={field} label={field}>
                      <select
                        value={columnMap[field] ?? ""}
                        onChange={(e) => setColumnMap((m) => ({ ...m, [field]: e.target.value }))}
                      >
                        <option value="">(not mapped)</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </FormRow>
                  ))}
                </div>
                <Button onClick={doImport} disabled={busy}>
                  {busy ? "Importing…" : `Import ${filename ?? "CSV"}`}
                </Button>
              </Card>

              {records.length > 0 && (
                <Card title={`Imported records (${records.length} shown)`}>
                  <DataTable
                    columns={[
                      { key: "timestamp", header: "Timestamp" },
                      { key: "channel_name", header: "Channel" },
                      { key: "ip", header: "IP" },
                      { key: "rida", header: "RIDA" },
                      { key: "user_agent", header: "User-Agent", render: (r) => <span className="muted">{String(r.user_agent ?? "").slice(0, 50)}</span> },
                      { key: "country", header: "Country" },
                      { key: "ad_request_id", header: "Ad Request ID" },
                    ]}
                    rows={records}
                  />
                </Card>
              )}
            </>
          )}
        </>
      )}

      {tab === "manual" && (
        <Card title="Manual Traffic Entry">
          <div className="grid grid-2">
            <FormRow label="Channel">
              <select value={manual.channel_id ?? ""} onChange={(e) => setField("channel_id", e.target.value)}>
                <option value="">— select —</option>
                {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </FormRow>
            <FormRow label="Timestamp">
              <input type="datetime-local" value={manual.timestamp ?? ""} onChange={(e) => setField("timestamp", e.target.value)} />
            </FormRow>
            <FormRow label="IP address">
              <input type="text" value={manual.ip ?? ""} onChange={(e) => setField("ip", e.target.value)} placeholder="198.51.100.7" />
            </FormRow>
            <FormRow label="RIDA / Device ID">
              <input type="text" value={manual.rida ?? ""} onChange={(e) => setField("rida", e.target.value)} placeholder="11111111-1111-4111-8111-111111111111" />
            </FormRow>
            <FormRow label="Device ID (alternative)">
              <input type="text" value={manual.device_id ?? ""} onChange={(e) => setField("device_id", e.target.value)} />
            </FormRow>
            <FormRow label="User-Agent">
              <input type="text" value={manual.user_agent ?? ""} onChange={(e) => setField("user_agent", e.target.value)} placeholder="Roku/DVP-10 (Roku Ultra)" />
            </FormRow>
            <FormRow label="Country">
              <input type="text" value={manual.country ?? ""} onChange={(e) => setField("country", e.target.value)} placeholder="US" />
            </FormRow>
            <FormRow label="Region">
              <input type="text" value={manual.region ?? ""} onChange={(e) => setField("region", e.target.value)} placeholder="CA" />
            </FormRow>
            <FormRow label="Ad Request ID">
              <input type="text" value={manual.ad_request_id ?? ""} onChange={(e) => setField("ad_request_id", e.target.value)} />
            </FormRow>
          </div>
          <Button onClick={addManual}>Add Record</Button>
        </Card>
      )}

      {records.length > 0 && tab === "manual" && (
        <Card title="Stored Records">
          <DataTable
            columns={[
              { key: "timestamp", header: "Timestamp" },
              { key: "channel_name", header: "Channel" },
              { key: "ip", header: "IP" },
              { key: "rida", header: "RIDA" },
              { key: "country", header: "Country" },
              { key: "source", header: "Source" },
            ]}
            rows={records.slice(0, 100)}
          />
        </Card>
      )}

      {!content && tab === "csv" && records.length === 0 && (
        <Card>
          <EmptyState message="No records loaded yet. Upload a CSV or switch to Manual Entry." />
        </Card>
      )}

      <Card title="Webhook / API ingestion (for ad server / SSP integration)">
        {ingest === null ? (
          <div className="muted">Loading ingestion status…</div>
        ) : (
          <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
            <div>
              <span className="muted">Status: </span>
              {ingest.enabled ? (
                <Badge tone="green">Enabled</Badge>
              ) : (
                <Badge tone="red">Disabled</Badge>
              )}{" "}
              {!ingest.enabled && (
                <span className="muted">Set INGESTION_API_KEY on the server to enable the endpoint.</span>
              )}
            </div>
            <div>
              <span className="muted">Endpoint:</span> <code className="mono">POST {ingest.endpoint}</code>{" "}
              <span className="muted">· max {ingest.maxBatch} records/request · {ingest.ratePerMinute}/min</span>
            </div>
            <div>
              <span className="muted">Auth:</span> <code className="mono">{ingest.auth}</code> — server-side only, never displayed here
            </div>
            <div className="muted" style={{ fontSize: 12 }}>{ingest.note}</div>
            <div>
              <span className="muted" style={{ display: "block", marginBottom: 4 }}>Example (stages records only — no Pixalate calls):</span>
              <pre className="mono" style={{ background: "#f9fafb", border: "1px solid var(--border)", borderRadius: 8, padding: 10, fontSize: 11.5, overflowX: "auto" }}>{`curl -X POST http://localhost:3001/api/ingest \\
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
  }'`}</pre>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              After ingestion, go to <strong>Run Analysis</strong> — the new records appear in the sample pool and follow the
              usual confirm-before-analyze flow.
            </div>
          </div>
        )}
      </Card>
    </Page>
  );
}