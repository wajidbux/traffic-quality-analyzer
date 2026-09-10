import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Channel, PreviewResponse, RunSummary, SampleStrategy } from "../types";
import { Alert, Button, Card, FormRow, Page, ProgressBar, StatusBadge } from "../components/ui";

const MODES = [
  { value: "auto", label: "AUTO — strongest available combination" },
  { value: "ip", label: "IP only" },
  { value: "device", label: "Device / RIDA only" },
  { value: "ua", label: "User-Agent only" },
  { value: "ip_device", label: "IP + Device / RIDA" },
  { value: "ip_ua", label: "IP + User-Agent" },
  { value: "device_ua", label: "Device / RIDA + User-Agent" },
  { value: "ip_device_ua", label: "IP + Device / RIDA + User-Agent" },
];

const STRATEGIES: Array<{ value: SampleStrategy["type"]; label: string; needsNumber: boolean; numberLabel?: string }> = [
  { value: "all", label: "All matching records", needsNumber: false },
  { value: "random_n", label: "Random sample (fixed number)", needsNumber: true, numberLabel: "Number of records" },
  { value: "percentage", label: "Random sample (percentage)", needsNumber: true, numberLabel: "Percentage (%)" },
  { value: "per_channel_n", label: "Per-channel sample (N per channel)", needsNumber: true, numberLabel: "N per channel" },
  { value: "per_country_n", label: "Per-country sample (N per country)", needsNumber: true, numberLabel: "N per country" },
  { value: "per_hour_n", label: "Per-hour sample (N per hour)", needsNumber: true, numberLabel: "N per hour" },
  { value: "unique_ip", label: "Unique IPs (one record per IP)", needsNumber: false },
  { value: "unique_rida", label: "Unique RIDAs (one record per RIDA)", needsNumber: false },
  { value: "unique_ip_rida", label: "Unique IP+RIDA combinations", needsNumber: false },
];

export default function RunAnalysis() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState<number | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [country, setCountry] = useState("");
  const [mode, setMode] = useState("auto");
  const [strategyType, setStrategyType] = useState<SampleStrategy["type"]>("random_n");
  const [strategyN, setStrategyN] = useState(100);
  const [runName, setRunName] = useState("");

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [activeRun, setActiveRun] = useState<RunSummary | null>(null);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    api.channels().then((res) => setChannels(res.channels)).catch(() => undefined);
  }, []);

  const buildStrategy = (): SampleStrategy => {
    switch (strategyType) {
      case "all": return { type: "all" };
      case "random_n": return { type: "random_n", n: strategyN };
      case "percentage": return { type: "percentage", pct: strategyN };
      case "per_channel_n": return { type: "per_channel_n", n: strategyN };
      case "per_country_n": return { type: "per_country_n", n: strategyN };
      case "per_hour_n": return { type: "per_hour_n", n: strategyN };
      case "unique_ip": return { type: "unique_ip" };
      case "unique_rida": return { type: "unique_rida" };
      case "unique_ip_rida": return { type: "unique_ip_rida" };
    }
  };

  const buildFilter = () => ({
    channelId: channelId ?? undefined,
    from: from || undefined,
    to: to || undefined,
    country: country || undefined,
  });

  const doPreview = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const p = await api.preview(buildStrategy(), mode, buildFilter());
      setPreview(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doRun = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.startRun(buildStrategy(), mode, true, buildFilter(), runName || undefined);
      setActiveRun(res.run);
      setPolling(true);
      setPreview(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Poll the active run until it finishes.
  useEffect(() => {
    if (!polling || !activeRun) return;
    const timer = setInterval(async () => {
      try {
        const res = await api.run(activeRun.id);
        setActiveRun(res.run);
        if (res.run.status !== "running" && res.run.status !== "pending") {
          clearInterval(timer);
          setPolling(false);
        }
      } catch {
        clearInterval(timer);
        setPolling(false);
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [polling, activeRun]);

  const strategy = STRATEGIES.find((s) => s.value === strategyType)!;
  const quotaTone = preview?.insufficientQuota
    ? "error"
    : preview && preview.remainingAfter !== null && preview.remainingAfter < 200
      ? "warn"
      : "info";

  return (
    <Page
      title="Run Analysis"
      subtitle="IMPORT → SAMPLE → ESTIMATE → CONFIRM → ANALYZE. Pixalate calls are only made after you confirm."
    >
      {error && <Alert tone="error">{error}</Alert>}
      {info && <Alert tone="info">{info}</Alert>}

      {activeRun && (
        <Card title={`Active run: ${activeRun.name}`}>
          <StatusBadge status={activeRun.status} />
          {activeRun.status === "running" || activeRun.status === "pending" ? (
            <ProgressBar processed={activeRun.progressProcessed} total={activeRun.progressTotal} />
          ) : null}
          {activeRun.status === "failed" && <Alert tone="error">{activeRun.error}</Alert>}
          {activeRun.status === "completed" && (
            <Alert tone="success">
              Run completed: {activeRun.numSuccess} successful, {activeRun.numFailed} failed, {activeRun.apiCallsUsed} API calls.
              <div style={{ marginTop: 8 }}>
                <Link className="btn btn-primary" to={`/results/${activeRun.id}`}>Open results</Link>
              </div>
            </Alert>
          )}
        </Card>
      )}

      <div className="grid grid-2">
        <Card title="1 · Filters">
          <FormRow label="Channel">
            <select value={channelId ?? ""} onChange={(e) => setChannelId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">All Channels</option>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </FormRow>
          <div className="grid grid-2" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <FormRow label="From">
              <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
            </FormRow>
            <FormRow label="To">
              <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
            </FormRow>
          </div>
          <FormRow label="Country">
            <input type="text" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="US" />
          </FormRow>
        </Card>

        <Card title="2 · Sample strategy (quota is limited — sample deliberately)">
          <FormRow label="Strategy">
            <select value={strategyType} onChange={(e) => setStrategyType(e.target.value as SampleStrategy["type"])}>
              {STRATEGIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </FormRow>
          {strategy.needsNumber && (
            <FormRow label={strategy.numberLabel ?? "Value"}>
              <input type="number" min={1} value={strategyN} onChange={(e) => setStrategyN(Number(e.target.value))} />
            </FormRow>
          )}
          <FormRow label="Analysis mode" hint="Which signals to submit to Pixalate. AUTO picks the strongest combination available per record.">
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </FormRow>
          <FormRow label="Run name (optional)">
            <input type="text" value={runName} onChange={(e) => setRunName(e.target.value)} placeholder="e.g. Movie Vault — Sept sample" />
          </FormRow>
          <Button onClick={doPreview} disabled={busy}>Preview & estimate API usage</Button>
        </Card>
      </div>

      {preview && (
        <Card title="3 · Confirm before analyzing">
          {quotaTone === "error" && (
            <Alert tone="error">
              Insufficient quota: the batch needs {preview.estimatedCalls} calls but only {preview.currentQuota ?? "?"} remain.
              Reduce the sample size or check the Pixalate API page. The run will not start.
            </Alert>
          )}
          <div className="grid grid-kpis" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", marginBottom: 14 }}>
            <div className="kpi-card"><div className="kpi-label">Records selected</div><div className="kpi-value">{preview.selectedRecords.toLocaleString()}</div></div>
            <div className="kpi-card"><div className="kpi-label">Estimated API calls</div><div className="kpi-value">{preview.estimatedCalls.toLocaleString()}</div></div>
            <div className="kpi-card"><div className="kpi-label">Current quota</div><div className="kpi-value">{preview.currentQuota ?? "—"}</div></div>
            <div className={`kpi-card${quotaTone === "error" ? " tone-red" : quotaTone === "warn" ? " tone-yellow" : ""}`}>
              <div className="kpi-label">Remaining after analysis</div>
              <div className="kpi-value">{preview.remainingAfter ?? "—"}</div>
            </div>
          </div>
          <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Pool size (records matching filters): <strong>{preview.poolSize.toLocaleString()}</strong>. Every selected record
            generates exactly one Pixalate Ad Fraud API call. Confirming starts the batch now; it can be cancelled from the
            results page.
          </div>
          <Button onClick={doRun} disabled={busy || preview.insufficientQuota} variant={preview.insufficientQuota ? "secondary" : "primary"}>
            {busy ? "Starting…" : `Confirm & analyze ${preview.estimatedCalls.toLocaleString()} records`}
          </Button>
        </Card>
      )}
    </Page>
  );
}