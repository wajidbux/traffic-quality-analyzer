import { useEffect, useState } from "react";
import { api } from "../api";
import type { RunSummary } from "../types";
import { Alert, Button, Card, EmptyState, FormRow, Page } from "../components/ui";

export default function Reports() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runId, setRunId] = useState("");
  const [channel, setChannel] = useState("");
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.runs().then((res) => {
      setRuns(res.runs);
      if (res.runs.length > 0) setRunId(res.runs[0].id);
    }).catch((e) => setError(e.message));
  }, []);

  const run = runs.find((r) => r.id === runId);
  const channels = [...new Set(runs.map((r) => r.channelFilter).filter(Boolean))] as string[];

  const report = (kind: "pdf" | "xlsx" | "csv" | "ssp") => {
    if (!runId) return;
    setInfo(null);
    if (kind === "pdf") api.reportPdf(runId);
    if (kind === "xlsx") api.reportXlsx(runId);
    if (kind === "csv") api.reportCsv(runId);
    if (kind === "ssp") api.reportSsp(runId, channel || undefined);
    setInfo(`${kind.toUpperCase()} report generated and downloading…`);
  };

  return (
    <Page title="Reports" subtitle="Professional traffic-quality reports and SSP-facing summaries">
      {error && <Alert tone="error">{error}</Alert>}
      {info && <Alert tone="success">{info}</Alert>}

      {runs.length === 0 ? (
        <EmptyState message="No analysis runs yet — reports are generated from completed runs." />
      ) : (
        <div className="grid grid-2">
          <Card title="1 · Select analysis run">
            <FormRow label="Run">
              <select value={runId} onChange={(e) => setRunId(e.target.value)}>
                {runs.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.status} · {r.mode}</option>)}
              </select>
            </FormRow>
            {run && (
              <div style={{ fontSize: 13, display: "grid", gap: 6 }}>
                <div><span className="muted">Sample size:</span> <strong>{run.numSuccess}</strong> analyzed, {run.numFailed} failed</div>
                <div><span className="muted">API calls:</span> {run.apiCallsUsed}</div>
                <div><span className="muted">Average risk:</span> {run.avgRisk?.toFixed(2) ?? "—"}</div>
                <div><span className="muted">Bands:</span> {run.pctLower?.toFixed(1)}% / {run.pctElevated?.toFixed(1)}% / {run.pctHigh?.toFixed(1)}% / {run.pctVeryHigh?.toFixed(1)}%</div>
              </div>
            )}
          </Card>

          <Card title="2 · Generate">
            <div style={{ display: "grid", gap: 10 }}>
              <Button onClick={() => report("pdf")}>Full report — PDF</Button>
              <Button variant="secondary" onClick={() => report("xlsx")}>Full report — Excel (XLSX)</Button>
              <Button variant="secondary" onClick={() => report("csv")}>Full results — CSV</Button>
            </div>
            <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
              <div className="form-label">SSP-facing report (channel filter)</div>
              <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="">Run filter (all channels)</option>
                {channels.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <div style={{ marginTop: 10 }}>
                <Button variant="secondary" onClick={() => report("ssp")}>SSP summary — PDF (no raw identifiers)</Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      <Card title="Methodology & limitations">
        <div style={{ fontSize: 13, display: "grid", gap: 8 }}>
          <p style={{ margin: 0 }}>
            <strong>Methodology:</strong> This report analyzes a sampled set of CTV/Roku traffic signals using Pixalate's Ad
            Fraud API. The Pixalate probability represents a risk assessment for the submitted signal or signal combination and
            should not be interpreted as definitive proof that an individual request is fraudulent.
          </p>
          <p style={{ margin: 0 }} className="muted">
            The SSP-facing report is a simplified summary designed for sharing with partners such as SSPs. It discloses no raw
            IP addresses, RIDA/device identifiers, or other sensitive identifiers. Reports are generated from the stored
            analysis results and reflect the Pixalate database state at the time the analysis ran.
          </p>
        </div>
      </Card>
    </Page>
  );
}