import { useEffect, useState } from "react";
import { api } from "../api";
import type { QuotaStatus, UsageEntry } from "../types";
import { Alert, Badge, Button, Card, EmptyState, KpiCard, Page } from "../components/ui";

function refreshInterval(quota: QuotaStatus["quota"]): string {
  if (quota.interval === null || !quota.timeUnit) return "";
  const plural = quota.interval === 1 ? quota.timeUnit : `${quota.timeUnit}s`;
  return `Refreshes every ${quota.interval} ${plural}`;
}

export default function PixalateApi() {
  const [status, setStatus] = useState<QuotaStatus | null>(null);
  const [usage, setUsage] = useState<UsageEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  const refresh = () => {
    api
      .pixalateStatus()
      .then((s) => setStatus(s))
      .catch((e) => setMessage({ tone: "error", text: e.message }));
    api
      .pixalateUsage()
      .then((u) => setUsage(u.usage))
      .catch(() => undefined);
  };

  useEffect(refresh, []);

  const act = async (kind: "quota" | "test") => {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === "quota") {
        await api.checkQuota();
        setMessage({ tone: "success", text: "Quota retrieved from the Pixalate metadata endpoint. No analysis quota was consumed." });
      } else {
        const res = await api.testConnection();
        setMessage({ tone: "success", text: res.message });
      }
      refresh();
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  if (!status) return <Page title="Pixalate API"><EmptyState message="Loading Pixalate status…" /></Page>;

  const quota = status.quota;
  const pctUsed = quota.limit && quota.used !== null ? Math.min(100, (quota.used / quota.limit) * 100) : null;
  const quotaPct = quota.limit && quota.remaining !== null ? (quota.remaining / quota.limit) * 100 : 0;
  const fillColor = quota.level === "red" ? "var(--red)" : quota.level === "yellow" ? "var(--yellow)" : "var(--green)";

  return (
    <Page
      title="Pixalate API"
      subtitle="Configuration, connection status and quota for the Ad Fraud API"
      actions={
        <>
          <Button variant="secondary" onClick={() => act("quota")} disabled={busy !== null}>
            {busy === "quota" ? "Checking…" : "Check Quota"}
          </Button>
          <Button variant="secondary" onClick={() => act("test")} disabled={busy !== null}>
            {busy === "test" ? "Testing…" : "Test Connection"}
          </Button>
        </>
      }
    >
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      {!status.apiKeyConfigured && (
        <Alert tone="warn">
          PIXALATE_API_KEY is not configured on the server. Set it in the environment (see .env.example) and restart the
          backend. The key is never stored in the browser or logs.
        </Alert>
      )}

      <div className="grid grid-kpis" style={{ marginBottom: 16 }}>
        <KpiCard label="API Connected" value={<Badge tone={status.connected ? "green" : "gray"}>{status.connected ? "Connected" : "Not checked"}</Badge>} />
        <KpiCard label="API Key Configured" value={<Badge tone={status.apiKeyConfigured ? "green" : "red"}>{status.apiKeyConfigured ? "YES" : "NO"}</Badge>} sub="Never displayed" />
        <KpiCard label="Quota Limit" value={quota.limit ?? "—"} />
        <KpiCard label="Quota Used" value={quota.used ?? "—"} sub={pctUsed !== null ? `${pctUsed.toFixed(1)}% of limit` : undefined} />
        <KpiCard label="Quota Remaining" value={quota.remaining ?? "—"} tone={quota.level === "green" ? "green" : quota.level === "yellow" ? "yellow" : "red"} />
        <KpiCard label="Renewal" value={quota.renewal ? new Date(quota.renewal).toLocaleString() : "—"} sub={refreshInterval(quota)} />
      </div>

      <div className="grid grid-2">
        <Card title="Quota Usage">
          <div className="quota-bar">
            <div className="quota-fill" style={{ width: `${quotaPct}%`, background: fillColor }} />
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            {quota.remaining !== null ? `${quota.remaining} of ${quota.limit ?? "?"} requests remaining` : "Remaining unknown — run a quota check."}
          </div>
          <div style={{ marginTop: 12, fontSize: 13, display: "grid", gap: 6 }}>
            <div><span className="muted">Level:</span> <Badge tone={quota.level === "green" ? "green" : quota.level === "yellow" ? "yellow" : quota.level === "red" ? "red" : "gray"}>{quota.level}</Badge></div>
            <div><span className="muted">Warning thresholds:</span> yellow &lt; {quota.warnings.yellow}, red &lt; {quota.warnings.red}</div>
            <div><span className="muted">Last quota check:</span> {quota.lastCheckedAt ? new Date(quota.lastCheckedAt).toLocaleString() : "never"}</div>
            <div><span className="muted">Last successful request:</span> {quota.lastSuccessfulRequest ? new Date(quota.lastSuccessfulRequest).toLocaleString() : "never"}</div>
            <div><span className="muted">Last error:</span> {quota.lastError ?? "none"}</div>
          </div>
        </Card>

        <Card title="API Usage Log">
          {usage.length === 0 ? (
            <EmptyState message="No API calls logged yet." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Endpoint</th>
                    <th>Status</th>
                    <th>Latency</th>
                    <th>Quota before → after</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.slice(0, 25).map((u) => (
                    <tr key={u.id}>
                      <td className="muted">{new Date(u.called_at).toLocaleString()}</td>
                      <td>{u.endpoint}</td>
                      <td><Badge tone={u.success ? "green" : "red"}>{u.http_status ?? "—"}</Badge></td>
                      <td>{u.latency_ms !== null ? `${u.latency_ms}ms` : "—"}</td>
                      <td className="mono">{u.quota_before ?? "?"} → {u.quota_after ?? "?"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card title="Endpoint & Authentication Reference (verified against the live OpenAPI spec v2.0.1)">
        <div style={{ fontSize: 13, display: "grid", gap: 8 }}>
          <div><span className="muted">Server:</span> <code className="mono">https://fraud-api.pixalate.com/api/v2</code></div>
          <div><span className="muted">Analysis:</span> <code className="mono">GET /fraud?ip=&amp;deviceId=&amp;userAgent=</code> → <code className="mono">FraudInfo &#123; probability &#125;</code></div>
          <div><span className="muted">Metadata/quota:</span> <code className="mono">GET /fraud</code> (no parameters) → <code className="mono">Metadata &#123; database, quota &#125;</code> — no analysis quota consumed</div>
          <div><span className="muted">Authentication:</span> <code className="mono">x-api-key: &lt;key&gt;</code> header — server-side only</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Response probability is a risk score 0.1–1.0 (0.0 = unknown). Every analysis call consumes one unit of quota.
            Quota fields: available / used / expiry / limit / interval / timeUnit. Spec:
            api.pixalate.com/.well-known/api/v2/fraud/fraud.yml
          </div>
        </div>
      </Card>
    </Page>
  );
}