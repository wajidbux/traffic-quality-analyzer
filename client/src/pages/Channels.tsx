import { useEffect, useState } from "react";
import { api } from "../api";
import type { Channel, ChannelStats } from "../types";
import { Alert, Button, Card, DataTable, EmptyState, FormRow, Page, SimpleBars } from "../components/ui";

const fmt = (v: number | null): string => (v === null || v === undefined ? "—" : v.toFixed(2));
const fmtPct = (v: number | null): string => (v === null || v === undefined ? "—" : `${v.toFixed(1)}%`);

export default function Channels() {
  const [stats, setStats] = useState<ChannelStats[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [compareA, setCompareA] = useState<string>("");
  const [compareB, setCompareB] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const load = () => {
    api.channelStats().then((res) => setStats(res.channels)).catch((e) => setError(e.message));
    api.channels().then((res) => setChannels(res.channels)).catch(() => undefined);
  };
  useEffect(load, []);

  const addChannel = async () => {
    if (!newName.trim()) return;
    try {
      await api.createChannel(newName.trim(), newDesc || undefined);
      setNewName("");
      setNewDesc("");
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const a = stats.find((s) => s.channelName === compareA);
  const b = stats.find((s) => s.channelName === compareB);

  const comparisonRows = a && b
    ? [
        ["Total records", String(a.totalRecords), String(b.totalRecords)],
        ["Unique IPs", String(a.uniqueIps), String(b.uniqueIps)],
        ["Unique RIDAs", String(a.uniqueRidas), String(b.uniqueRidas)],
        ["Average risk", fmt(a.averageRisk), fmt(b.averageRisk)],
        ["Median risk", fmt(a.medianRisk), fmt(b.medianRisk)],
        ["High-risk %", fmtPct(a.highRiskPct), fmtPct(b.highRiskPct)],
        ["Very-high-risk %", fmtPct(a.veryHighRiskPct), fmtPct(b.veryHighRiskPct)],
        ["Pixalate failures", String(a.pixalateFailures), String(b.pixalateFailures)],
      ]
    : [];

  return (
    <Page title="Channels" subtitle="Per-channel traffic quality and comparisons">
      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid grid-2">
        <Card title="Channel statistics">
          {stats.length === 0 ? (
            <EmptyState message="No channel data yet. Import traffic first." />
          ) : (
            <DataTable
              columns={[
                { key: "channelName", header: "Channel" },
                { key: "totalRecords", header: "Records", align: "right" },
                { key: "uniqueIps", header: "Unique IPs", align: "right" },
                { key: "uniqueRidas", header: "Unique RIDAs", align: "right" },
                { key: "averageRisk", header: "Avg risk", align: "right", render: (r) => fmt(r.averageRisk as number | null) },
                { key: "highRiskPct", header: "High %", align: "right", render: (r) => fmtPct(r.highRiskPct as number | null) },
                { key: "veryHighRiskPct", header: "VH %", align: "right", render: (r) => fmtPct(r.veryHighRiskPct as number | null) },
                { key: "pixalateFailures", header: "Failures", align: "right" },
                { key: "resultsAnalyzed", header: "Analyzed", align: "right" },
              ]}
              rows={stats}
            />
          )}
        </Card>

        <Card title="Channel comparison">
          <div className="grid grid-2" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <FormRow label="Channel A">
              <select value={compareA} onChange={(e) => setCompareA(e.target.value)}>
                <option value="">— select —</option>
                {stats.map((s) => <option key={s.channelId} value={s.channelName}>{s.channelName}</option>)}
              </select>
            </FormRow>
            <FormRow label="Channel B">
              <select value={compareB} onChange={(e) => setCompareB(e.target.value)}>
                <option value="">— select —</option>
                {stats.map((s) => <option key={s.channelId} value={s.channelName}>{s.channelName}</option>)}
              </select>
            </FormRow>
          </div>
          {a && b ? (
            <DataTable
              columns={[
                { key: "metric", header: "Metric" },
                { key: "a", header: compareA, align: "right" },
                { key: "b", header: compareB, align: "right" },
              ]}
              rows={comparisonRows.map(([metric, va, vb]) => ({ metric, a: va, b: vb }))}
            />
          ) : (
            <EmptyState message="Select two channels to compare." />
          )}
        </Card>
      </div>

      {a && (
        <Card title={`${a.channelName} — country distribution`}>
          <SimpleBars
            data={a.countryDistribution.map((c) => ({ country: c.country, count: c.count }))}
            xKey="country"
            bars={[{ key: "count", name: "Requests", color: "#10b981" }]}
          />
        </Card>
      )}        <Card title="Manage channels">
          <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 14 }}>
            Channel list is configurable — add channels for future analysis.
          </p>
        <div className="grid grid-2">
          <div className="grid grid-2" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <FormRow label="New channel name">
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Movie Vault" />
            </FormRow>
            <FormRow label="Description (optional)">
              <input type="text" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
            </FormRow>
          </div>
          <div style={{ alignSelf: "end" }}>
            <Button onClick={addChannel} disabled={!newName.trim()}>Add channel</Button>
          </div>
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {channels.map((c) => (
            <span key={c.id} className="badge badge-blue">{c.name} {c.is_active ? "" : "(inactive)"}</span>
          ))}
        </div>
      </Card>
    </Page>
  );
}