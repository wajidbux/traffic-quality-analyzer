import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { DuplicateStats, GeoRow, HighRiskRow, RunSummary, SignalComparisonRow, TemporalRow } from "../types";
import { Alert, Button, Card, DataTable, EmptyState, GeoBarChart, KpiCard, Page, ProgressBar, RiskBadge, SimpleBars, StatusBadge, TemporalChart } from "../components/ui";

const fmt = (v: number | null, digits = 2): string => (v === null || v === undefined ? "—" : v.toFixed(digits));
const fmtPct = (v: number | null): string => (v === null || v === undefined ? "—" : `${v.toFixed(1)}%`);

export default function Results() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [run, setRun] = useState<RunSummary | null>(null);
  const [highRisk, setHighRisk] = useState<HighRiskRow[]>([]);
  const [comparison, setComparison] = useState<SignalComparisonRow[]>([]);
  const [temporal, setTemporal] = useState<TemporalRow[]>([]);
  const [geo, setGeo] = useState<GeoRow[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateStats | null>(null);
  const [minRisk, setMinRisk] = useState(0.5);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    api.runs().then((res) => setRuns(res.runs)).catch((e) => setError(e.message));
  }, [runId]);

  const loadDetail = (id: string) => {
    api.run(id).then((res) => {
      setRun(res.run);
      if (res.run.status === "running" || res.run.status === "pending") setPolling(true);
    }).catch((e) => setError(e.message));
    api.highRisk(id, minRisk).then((res) => setHighRisk(res.rows)).catch(() => undefined);
    api.signalComparison(id).then((res) => setComparison(res.rows)).catch(() => undefined);
    api.temporal(id).then((res) => setTemporal(res.rows)).catch(() => undefined);
    api.geo(id).then((res) => setGeo(res.rows)).catch(() => undefined);
    api.duplicates().then(setDuplicates).catch(() => undefined);
  };

  useEffect(() => {
    if (!runId) return;
    loadDetail(runId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Poll active run detail
  useEffect(() => {
    if (!polling || !runId) return;
    const timer = setInterval(async () => {
      try {
        const res = await api.run(runId);
        setRun(res.run);
        if (res.run.status !== "running" && res.run.status !== "pending") {
          clearInterval(timer);
          setPolling(false);
          api.highRisk(runId, minRisk).then((r) => setHighRisk(r.rows)).catch(() => undefined);
          api.signalComparison(runId).then((r) => setComparison(r.rows)).catch(() => undefined);
        }
      } catch {
        clearInterval(timer);
        setPolling(false);
      }
    }, 1500);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, runId]);

  const cancel = async () => {
    if (!run) return;
    await api.cancelRun(run.id);
    setPolling(false);
    api.run(run.id).then((res) => setRun(res.run)).catch(() => undefined);
  };

  const del = async (id: string) => {
    await api.deleteRun(id);
    setRun(null);
    navigate("/results");
    api.runs().then((res) => setRuns(res.runs)).catch(() => undefined);
  };

  // ---- list view ----
  if (!runId) {
    return (
      <Page title="Analysis Results" subtitle="Reopen historical analysis runs">
        {error && <Alert tone="error">{error}</Alert>}
        {runs.length === 0 ? (
          <EmptyState message="No analysis runs yet. Go to Run Analysis to start one." />
        ) : (
          <Card>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Run</th><th>Status</th><th>Mode</th><th>Channel</th><th>Input</th><th>Success</th><th>Failed</th>
                    <th>API calls</th><th>Avg risk</th><th>High %</th><th>VH %</th><th>Started</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td><Link className="link" to={`/results/${r.id}`}>{r.name}</Link></td>
                      <td><StatusBadge status={r.status} /></td>
                      <td className="mono">{r.mode}</td>
                      <td>{r.channelFilter ?? "All"}</td>
                      <td>{r.numInput}</td>
                      <td>{r.numSuccess}</td>
                      <td>{r.numFailed}</td>
                      <td>{r.apiCallsUsed}</td>
                      <td className="risk-score">{fmt(r.avgRisk)}</td>
                      <td>{fmtPct(r.pctHigh)}</td>
                      <td>{fmtPct(r.pctVeryHigh)}</td>
                      <td className="muted">{r.startedAt ? new Date(r.startedAt).toLocaleString() : "—"}</td>
                      <td><Link className="link" to={`/results/${r.id}`}>Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </Page>
    );
  }

  // ---- detail view ----
  if (!run) return <Page title="Analysis Results"><EmptyState message="Loading run…" /></Page>;

  return (
    <Page
      title={run.name}
      subtitle={`Run ID ${run.id} · started ${run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"}`}
      actions={
        <>
          <StatusBadge status={run.status} />
          {(run.status === "running" || run.status === "pending") && (
            <Button variant="secondary" onClick={cancel}>Cancel run</Button>
          )}
          <Button variant="danger" onClick={() => { if (confirm(`Delete run ${run.name} and all its results?`)) void del(run.id); }}>Delete</Button>
          <Button variant="secondary" onClick={() => api.reportCsv(run.id)}>CSV</Button>
          <Button variant="secondary" onClick={() => api.reportXlsx(run.id)}>Excel</Button>
          <Button variant="secondary" onClick={() => api.reportPdf(run.id)}>PDF Report</Button>
          <Button variant="secondary" onClick={() => api.reportSsp(run.id, run.channelFilter ?? undefined)}>SSP Report</Button>
        </>
      }
    >
      {(run.status === "running" || run.status === "pending") && (
        <Alert tone="info">
          <ProgressBar processed={run.progressProcessed} total={run.progressTotal} />
        </Alert>
      )}
      {run.status === "failed" && <Alert tone="error">{run.error}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid grid-kpis" style={{ marginBottom: 16 }}>
        <KpiCard label="Records processed" value={run.numProcessed} sub={`${run.numInput} in pool`} />
        <KpiCard label="Successful checks" value={run.numSuccess} tone="green" />
        <KpiCard label="Failed checks" value={run.numFailed} tone={run.numFailed > 0 ? "red" : "green"} />
        <KpiCard label="API calls used" value={run.apiCallsUsed} sub={`quota ${run.quotaBefore ?? "?"} → ${run.quotaAfter ?? "?"}`} />
        <KpiCard label="Average risk" value={fmt(run.avgRisk)} tone={run.avgRisk !== null && run.avgRisk >= 0.5 ? "yellow" : "green"} />
        <KpiCard label="Median risk" value={fmt(run.medianRisk)} />
        <KpiCard label="Lower risk" value={fmtPct(run.pctLower)} tone="green" />
        <KpiCard label="Elevated risk" value={fmtPct(run.pctElevated)} />
        <KpiCard label="High risk" value={fmtPct(run.pctHigh)} tone="yellow" />
        <KpiCard label="Very high risk" value={fmtPct(run.pctVeryHigh)} tone="red" />
      </div>

      <div className="grid grid-2">
        <Card title="High-risk records">
          <div style={{ marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[0.5, 0.75, 0.9].map((threshold) => (
              <Button key={threshold} variant={minRisk === threshold ? "primary" : "secondary"} onClick={() => {
                setMinRisk(threshold);
                api.highRisk(run.id, threshold).then((res) => setHighRisk(res.rows)).catch(() => undefined);
              }}>
                Risk &gt; {threshold.toFixed(2)}
              </Button>
            ))}
          </div>
          <DataTable
            columns={[
              { key: "timestamp", header: "Timestamp", render: (r) => <span className="muted">{r.timestamp ? new Date(String(r.timestamp)).toLocaleString() : "—"}</span> },
              { key: "channel", header: "Channel" },
              { key: "ip", header: "IP" },
              { key: "rida", header: "RIDA/Device" },
              { key: "country", header: "Country" },
              { key: "probability", header: "Risk", align: "right", render: (r) => <span className="risk-score">{fmt(r.probability as number | null)}</span> },
              { key: "band", header: "Band", render: (r) => <RiskBadge band={String(r.band)} /> },
              { key: "signalsSubmitted", header: "Signals", render: (r) => <span className="mono">{(r.signalsSubmitted as string[]).join("+")}</span> },
            ]}
            rows={highRisk}
            empty="No records above this threshold."
          />
        </Card>

        <Card title="Signal comparison (records with multiple signals)">
          <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            Compares Pixalate scores for IP / RIDA / UA / IP+RIDA / IP+RIDA+UA where multiple signals were analyzed for the same record.
          </div>
          <DataTable
            columns={[
              { key: "requestId", header: "Request ID" },
              { key: "channel", header: "Channel" },
              { key: "ipScore", header: "IP", align: "right", render: (r) => fmt(r.ipScore as number | null) },
              { key: "deviceScore", header: "RIDA", align: "right", render: (r) => fmt(r.deviceScore as number | null) },
              { key: "uaScore", header: "UA", align: "right", render: (r) => fmt(r.uaScore as number | null) },
              { key: "ipDeviceScore", header: "IP+RIDA", align: "right", render: (r) => fmt(r.ipDeviceScore as number | null) },
              { key: "ipDeviceUaScore", header: "Combined", align: "right", render: (r) => <span className="risk-score">{fmt(r.ipDeviceUaScore as number | null)}</span> },
            ]}
            rows={comparison.slice(0, 200)}
            empty="No records with multiple analyzed signals. Run modes that submit several signal combinations to populate this view."
          />
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Risk by hour">
          <TemporalChart data={temporal} />
        </Card>
        <Card title="Requests & avg risk by country">
          <GeoBarChart data={geo.map((g) => ({ country: g.country, requests: g.requests }))} />
        </Card>
      </div>

      <Card title="Geo analysis">
        <DataTable
          columns={[
            { key: "country", header: "Country" },
            { key: "requests", header: "Requests", align: "right" },
            { key: "avgRisk", header: "Avg risk", align: "right", render: (r) => fmt(r.avgRisk as number | null) },
            { key: "highRiskPct", header: "High-risk %", align: "right", render: (r) => fmtPct(r.highRiskPct as number | null) },
            { key: "veryHighRiskPct", header: "Very-high-risk %", align: "right", render: (r) => fmtPct(r.veryHighRiskPct as number | null) },
          ]}
          rows={geo}
          empty="No country data for this run."
        />
      </Card>

      <Card title="Duplicate / unique analysis">
        <div className="grid grid-2">
          <div className="grid grid-kpis" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
            <KpiCard label="Total requests" value={duplicates?.totalRequests ?? "—"} />
            <KpiCard label="Unique IPs" value={duplicates?.uniqueIps ?? "—"} />
            <KpiCard label="Unique RIDAs" value={duplicates?.uniqueRidas ?? "—"} />
            <KpiCard label="Unique IP+RIDA" value={duplicates?.uniqueIpRidaCombos ?? "—"} />
            <KpiCard label="Unique User-Agents" value={duplicates?.uniqueUserAgents ?? "—"} />
            <KpiCard label="IP repeat rate" value={duplicates?.repeatIpRate !== null && duplicates?.repeatIpRate !== undefined ? fmtPct(duplicates.repeatIpRate * 100) : "—"} />
            <KpiCard label="RIDA repeat rate" value={duplicates?.repeatRidaRate !== null && duplicates?.repeatRidaRate !== undefined ? fmtPct(duplicates.repeatRidaRate * 100) : "—"} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Repeated IPs or RIDAs are patterns for further analysis — they are not automatically classified as fraudulent.
            </div>
            <SimpleBars
              data={[
                ...(duplicates?.topRepeatedIps ?? []).map((d) => ({ label: `IP ${d.value}`, count: d.count })),
              ]}
              xKey="label"
              bars={[{ key: "count", name: "Occurrences", color: "#6366f1" }]}
            />
          </div>
        </div>
      </Card>
    </Page>
  );
}