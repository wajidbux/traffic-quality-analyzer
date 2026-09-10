import { useEffect, useState } from "react";
import { api } from "../api";
import type { DistributionBin, HighRiskRow, RunSummary } from "../types";
import { Alert, Badge, Button, Card, DataTable, DistributionChart, EmptyState, FormRow, Page, RiskBadge } from "../components/ui";

const fmt = (v: number | null): string => (v === null || v === undefined ? "—" : v.toFixed(2));

export default function RiskAnalysis() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runId, setRunId] = useState<string>("");
  const [distribution, setDistribution] = useState<DistributionBin[]>([]);
  const [highRisk, setHighRisk] = useState<HighRiskRow[]>([]);
  const [minRisk, setMinRisk] = useState(0.5);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.runs().then((res) => {
      setRuns(res.runs);
      if (res.runs.length > 0) setRunId(res.runs[0].id);
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!runId) return;
    api.distribution(runId).then((res) => setDistribution(res.distribution)).catch(() => undefined);
    api.highRisk(runId, minRisk).then((res) => setHighRisk(res.rows)).catch(() => undefined);
  }, [runId, minRisk]);

  return (
    <Page
      title="Risk Analysis"
      subtitle="Fraud probability distribution, risk bands, and suspicious records"
      actions={
        <>
          <FormRow label="">
            <select value={runId} onChange={(e) => setRunId(e.target.value)} style={{ width: 260 }}>
              <option value="">— select run —</option>
              {runs.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.mode}</option>)}
            </select>
          </FormRow>
        </>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      {!runId && <EmptyState message="No analysis runs available. Run an analysis first." />}

      {runId && (
        <>
          <div className="grid grid-2">
            <Card title="Fraud probability distribution">
              <DistributionChart data={distribution} />
              <p className="muted" style={{ fontSize: 12 }}>
                Bins of Pixalate fraud probabilities. Each bar is a fraction of the analyzed sample — an analytical
                distribution, not a fraud determination.
              </p>
            </Card>

            <Card title="Risk bands (analytical categories)">
              <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
                {[
                  { label: "Lower risk", color: "#10b981", hint: "0.00–0.49 · do not automatically classify as fraud" },
                  { label: "Elevated risk", color: "#3b82f6", hint: "0.50–0.74 · requires review" },
                  { label: "High risk", color: "#f59e0b", hint: "0.75–0.89 · priority review" },
                  { label: "Very high risk", color: "#ef4444", hint: "0.90–1.00 · priority review" },
                ].map((band) => (
                  <div key={band.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className="dot" style={{ background: band.color, width: 12, height: 12 }} />
                    <div style={{ flex: 1 }}>
                      <strong style={{ fontSize: 13 }}>{band.label}</strong>
                      <div className="muted" style={{ fontSize: 11.5 }}>{band.hint}</div>
                    </div>
                  </div>
                ))}
              </div>
              <Alert tone="info">
                These bands are analytical categories for triage. A Pixalate probability is a risk assessment for the
                submitted signal combination — it does not definitively prove that a request is fraudulent.
              </Alert>
            </Card>
          </div>

          <Card title="High-risk traffic">
            <div style={{ marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[0.5, 0.75, 0.9].map((threshold) => (
                <Button key={threshold} variant={minRisk === threshold ? "primary" : "secondary"} onClick={() => setMinRisk(threshold)}>
                  Risk &gt; {threshold.toFixed(2)}
                </Button>
              ))}
              <span className="muted" style={{ alignSelf: "center", fontSize: 12 }}>
                {highRisk.length} record(s) above threshold
              </span>
            </div>
            <DataTable
              columns={[
                { key: "timestamp", header: "Timestamp", render: (r) => <span className="muted">{r.timestamp ? new Date(String(r.timestamp)).toLocaleString() : "—"}</span> },
                { key: "channel", header: "Channel" },
                { key: "ip", header: "IP" },
                { key: "rida", header: "RIDA/Device" },
                { key: "userAgent", header: "User-Agent", render: (r) => <span className="muted">{String(r.userAgent ?? "").slice(0, 45)}</span> },
                { key: "country", header: "Country" },
                { key: "probability", header: "Risk", align: "right", render: (r) => <span className="risk-score">{fmt(r.probability as number | null)}</span> },
                { key: "band", header: "Band", render: (r) => <RiskBadge band={String(r.band)} /> },
                { key: "signalsSubmitted", header: "Signals", render: (r) => <span className="mono">{(r.signalsSubmitted as string[]).join("+")}</span> },
                { key: "responseStatus", header: "HTTP", render: (r) => (r.responseStatus ? <Badge tone="gray">{String(r.responseStatus)}</Badge> : "—") },
              ]}
              rows={highRisk}
              empty="No records above this threshold."
            />
          </Card>
        </>
      )}
    </Page>
  );
}