import { useEffect, useState } from "react";
import { api } from "../api";
import type { AuditEntry } from "../types";
import { Alert, Badge, Button, Card, ConfirmButton, FormRow, Page } from "../components/ui";

const LABELS: Record<string, string> = {
  mask_sensitive: "Mask sensitive values (IPs, RIDAs) in UI & exports",
  dedupe_on_import: "Deduplicate identical records on import",
  requests_per_minute: "Pixalate requests per minute",
  max_concurrency: "Maximum concurrent requests",
  retry_delay_ms: "Retry delay (ms)",
  max_retries: "Maximum retries (temporary errors)",
  request_timeout_ms: "Request timeout (ms)",
  quota_warn_yellow: "Quota warning YELLOW below",
  quota_warn_red: "Quota warning RED below",
  risk_band_elevated_from: "Elevated-risk band from",
  risk_band_high_from: "High-risk band from",
  risk_band_very_high_from: "Very-high-risk band from",
  retention_days: "Data retention (days, 0 = keep forever)",
  company_name: "Company name (reports)",
};

export default function SettingsPage() {
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [purgeDays, setPurgeDays] = useState("90");

  useEffect(() => {
    api.settings().then((res) => {
      setApiKeyConfigured(res.apiKeyConfigured);
      setDraft(res.settings);
    }).catch((e) => setMessage({ tone: "error", text: e.message }));
    api.audit().then((res) => setAudit(res.entries)).catch(() => undefined);
  }, []);

  const save = async () => {
    setMessage(null);
    try {
      const res = await api.updateSettings(draft);
      if (res.rejected.length) {
        setMessage({ tone: "error", text: `Rejected invalid values: ${res.rejected.join(", ")}` });
      } else {
        setMessage({ tone: "success", text: "Settings saved." });
      }
      api.audit().then((r) => setAudit(r.entries)).catch(() => undefined);
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    }
  };

  const purge = async () => {
    setMessage(null);
    try {
      const res = await api.retentionPurge(Number(purgeDays));
      setMessage({ tone: "success", text: `Purged ${res.deletedRecords} records older than ${res.cutoff}.` });
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    }
  };

  const set = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <Page title="Settings" subtitle="Risk bands, quota thresholds, throttling, masking, retention and data management">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <div className="grid grid-2">
        <Card title="Risk bands (analytical categories)">
          <Alert tone="info">
            These thresholds define the analytical categories used across the dashboard and reports. They are triage bands —
            not determinations of fraud.
          </Alert>
          {["risk_band_elevated_from", "risk_band_high_from", "risk_band_very_high_from"].map((key) => (
            <FormRow key={key} label={LABELS[key]} hint="Probability 0–1">
              <input type="number" step="0.01" min={0} max={1} value={draft[key] ?? ""} onChange={(e) => set(key, e.target.value)} />
            </FormRow>
          ))}
          <FormRow label={LABELS.company_name}>
            <input type="text" value={draft.company_name ?? ""} onChange={(e) => set("company_name", e.target.value)} />
          </FormRow>
        </Card>

        <Card title="Quota warnings & Pixalate throttling">
          {["quota_warn_yellow", "quota_warn_red"].map((key) => (
            <FormRow key={key} label={LABELS[key]}>
              <input type="number" min={0} value={draft[key] ?? ""} onChange={(e) => set(key, e.target.value)} />
            </FormRow>
          ))}
          {["requests_per_minute", "max_concurrency", "retry_delay_ms", "max_retries", "request_timeout_ms"].map((key) => (
            <FormRow key={key} label={LABELS[key]}>
              <input type="number" min={0} value={draft[key] ?? ""} onChange={(e) => set(key, e.target.value)} />
            </FormRow>
          ))}
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Privacy & security">
          <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={draft.mask_sensitive !== "false"} onChange={(e) => set("mask_sensitive", e.target.checked ? "true" : "false")} />
              {LABELS.mask_sensitive}
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={draft.dedupe_on_import !== "false"} onChange={(e) => set("dedupe_on_import", e.target.checked ? "true" : "false")} />
              {LABELS.dedupe_on_import}
            </label>
          </div>
          <div style={{ fontSize: 13, display: "grid", gap: 6 }}>
            <div><span className="muted">API key configured:</span> <Badge tone={apiKeyConfigured ? "green" : "red"}>{apiKeyConfigured ? "YES (server-side only)" : "NO"}</Badge></div>
            <div className="muted" style={{ fontSize: 12 }}>
              IPs and device identifiers are treated as sensitive operational data. The API key never leaves the server and is
              never logged. In production, run behind HTTPS and protect the SQLite file (disk encryption / SQLCipher) and the
              environment variables.
            </div>
          </div>
        </Card>

        <Card title="Data retention & management">
          <FormRow label={LABELS.retention_days}>
            <input type="number" min={0} value={draft.retention_days ?? ""} onChange={(e) => set("retention_days", e.target.value)} />
          </FormRow>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="number" min={1} value={purgeDays} onChange={(e) => setPurgeDays(e.target.value)} style={{ width: 100 }} />
            <ConfirmButton label="Purge records older than days" confirmLabel="Confirm purge" onConfirm={purge} />
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button variant="secondary" onClick={() => api.exportAll()}>Export all data (CSV)</Button>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Deleting a run from the Analysis Results page removes the run and its stored results. Records are retained unless a
            retention purge is run.
          </div>
        </Card>
      </div>

      <Card title="Save changes">
        <Button onClick={save}>Save settings</Button>
      </Card>

      <Card title="Audit trail (last 50)">
        {audit.length === 0 ? (
          <div className="muted">No audit entries yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Time</th><th>Action</th><th>Entity</th><th>Details</th></tr>
              </thead>
              <tbody>
                {audit.slice(0, 50).map((e) => (
                  <tr key={e.id}>
                    <td className="muted">{new Date(e.occurred_at).toLocaleString()}</td>
                    <td className="mono">{e.action}</td>
                    <td>{e.entity_type}{e.entity_id ? ` #${e.entity_id.slice(0, 8)}` : ""}</td>
                    <td className="muted">{e.details ? String(e.details).slice(0, 80) : ""}</td>
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