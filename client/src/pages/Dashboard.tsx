import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { DashboardKpis, RunSummary } from "../types";
import { Alert, Badge, Card, DistributionChart, EmptyState, KpiCard, Page, StatusBadge } from "../components/ui";

const fmt = (v: number | null, digits = 2): string => (v === null || v === undefined ? "—" : v.toFixed(digits));
const fmtPct = (v: number | null): string => (v === null || v === undefined ? "—" : `${v.toFixed(1)}%`);
const fmtInt = (v: number | null | undefined): string => (v === null || v === undefined ? "—" : v.toLocaleString());

export default function Dashboard() {
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .dashboard()
      .then((res) => setKpis(res.kpis))
      .catch((e) => setError(e.message));
    api
      .runs()
      .then((res) => setRuns(res.runs.slice(0, 8)))
      .catch(() => undefined);
  }, []);

  if (error) return <Page title="Dashboard"><Alert tone="error">{error}</Alert></Page>;
  if (!kpis) return <Page title="Dashboard"><EmptyState message="Loading dashboard…" /></Page>;

  const quotaTone = kpis.remainingQuota === null ? "gray" : kpis.remainingQuota <= 200 ? "red" : kpis.remainingQuota <= 800 ? "yellow" : "green";

  return (
    <Page
      title="Traffic Quality"
      subtitle="Pixalate Ad Fraud API analysis of sampled Roku/CTV traffic"
      actions={<Link className="btn btn-primary" to="/analyze">Run Analysis</Link>}
    >
      <div className="grid grid-kpis" style={{ marginBottom: 16 }}>
        <KpiCard label="Pixalate API Status" value={<Badge tone={quotaTone as "green"}>{kpis.remainingQuota === null ? "Unknown" : "Connected"}</Badge>} sub="Metadata endpoint" />
        <KpiCard label="Quota Remaining" value={fmtInt(kpis.remainingQuota)} tone={quotaTone as "green"} />
        <KpiCard label="Requests Tested" value={fmtInt(kpis.successfulChecks)} sub={`${fmtInt(kpis.failedChecks)} failed`} />
        <KpiCard label="Average Risk" value={fmt(kpis.averageRisk)} sub={`Median ${fmt(kpis.medianRisk)}`} tone={kpis.averageRisk !== null && kpis.averageRisk >= 0.5 ? "yellow" : "green"} />
        <KpiCard label="High Risk %" value={fmtPct(kpis.pctHigh)} sub={`${fmtInt(kpis.highRiskRecords)} records`} tone="yellow" />
        <KpiCard label="Very High Risk %" value={fmtPct(kpis.pctVeryHigh)} sub={`${fmtInt(kpis.veryHighRiskRecords)} records`} tone="red" />
      </div>

      <div className="grid grid-2">
        <Card title="Risk Distribution (probability bins)">
          <DistributionChart data={kpis.distribution} />
          <p className="muted" style={{ fontSize: 12 }}>
            Distribution of Pixalate fraud probabilities across analyzed records.
          </p>
        </Card>
        <Card title="Traffic Snapshot">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 20px", fontSize: 13 }}>
            {[
              ["Total records imported", fmtInt(kpis.totalRecords)],
              ["Total results stored", fmtInt(kpis.totalResults)],
              ["Unique IPs", fmtInt(kpis.uniqueIps)],
              ["Unique RIDAs", fmtInt(kpis.uniqueRidas)],
              ["Unique User-Agents", fmtInt(kpis.uniqueUserAgents)],
              ["Unique IP+RIDA combos", fmtInt(kpis.uniqueIpRidaCombos)],
              ["Highest risk", fmt(kpis.highestRisk)],
              ["Lowest risk", fmt(kpis.lowestRisk)],
              ["Lower-risk records", fmtInt(kpis.lowerRiskRecords)],
              ["Elevated-risk records", fmtInt(kpis.elevatedRiskRecords)],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #f3f4f6", paddingBottom: 6 }}>
                <span className="muted">{k}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Recent Analysis Runs">
        {runs.length === 0 ? (
          <EmptyState message="No analysis runs yet. Import traffic and run your first analysis." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Status</th>
                  <th>Mode</th>
                  <th>Processed</th>
                  <th>Success</th>
                  <th>Failed</th>
                  <th>API calls</th>
                  <th>Avg risk</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td><Link className="link" to={`/results/${r.id}`}>{r.name}</Link></td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="mono">{r.mode}</td>
                    <td>{r.numProcessed}</td>
                    <td>{r.numSuccess}</td>
                    <td>{r.numFailed}</td>
                    <td>{r.apiCallsUsed}</td>
                    <td className="risk-score">{fmt(r.avgRisk)}</td>
                    <td className="muted">{r.startedAt ? new Date(r.startedAt).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}