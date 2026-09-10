import type {
  AuditEntry,
  Channel,
  ChannelStats,
  DashboardKpis,
  DistributionBin,
  DuplicateStats,
  GeoRow,
  HighRiskRow,
  ImportResult,
  PreviewResponse,
  QuotaStatus,
  RecordRow,
  RunSummary,
  SampleStrategy,
  SignalComparisonRow,
  TemporalRow,
  UsageEntry,
} from "./types";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: options.body ? { "Content-Type": "application/json", ...(options.headers ?? {}) } : options.headers,
    ...options,
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body
    }
    throw new Error(message);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }
  return (await response.text()) as unknown as T;
}

function download(path: string, filename: string): void {
  const a = document.createElement("a");
  a.href = `/api${path}`;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const api = {
  // Channels
  channels: () => request<{ channels: Channel[] }>("/channels"),
  channelStats: () => request<{ channels: ChannelStats[] }>("/stats/channels"),
  createChannel: (name: string, description?: string) =>
    request<{ id: number }>("/channels", { method: "POST", body: JSON.stringify({ name, description }) }),
  updateChannel: (id: number, patch: Record<string, unknown>) =>
    request(`/channels/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  // Records
  records: () => request<{ records: RecordRow[]; total: number }>("/records?limit=500"),
  guessColumns: (content: string) =>
    request<{ headers: string[]; map: Record<string, string> }>("/records/guess-columns", {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  importCsv: (content: string, columnMap: Record<string, string> | null, filename: string) =>
    request<ImportResult>("/records/import", {
      method: "POST",
      body: JSON.stringify({ content, column_map: columnMap, filename }),
    }),
  addManual: (payload: Record<string, unknown>) =>
    request<{ id: string }>("/records/manual", { method: "POST", body: JSON.stringify(payload) }),

  // Runs
  runs: () => request<{ runs: RunSummary[] }>("/runs"),
  run: (id: string) => request<{ run: RunSummary }>(`/runs/${id}`),
  preview: (strategy: SampleStrategy, mode: string, filter?: Record<string, unknown>) =>
    request<PreviewResponse>("/runs/preview", {
      method: "POST",
      body: JSON.stringify({ strategy, mode, filter: filter ?? {} }),
    }),
  startRun: (strategy: SampleStrategy, mode: string, confirmed: boolean, filter?: Record<string, unknown>, name?: string) =>
    request<{ run: RunSummary }>("/runs", {
      method: "POST",
      body: JSON.stringify({ strategy, mode, filter: filter ?? {}, confirmed, name }),
    }),
  cancelRun: (id: string) => request<{ ok: boolean }>(`/runs/${id}/cancel`, { method: "POST" }),
  deleteRun: (id: string) => request<{ ok: boolean }>(`/runs/${id}`, { method: "DELETE" }),

  // Pixalate
  pixalateStatus: () => request<QuotaStatus>("/pixalate/status"),
  checkQuota: () => request<{ ok: boolean; quota: QuotaStatus["quota"] }>("/pixalate/quota", { method: "POST" }),
  testConnection: () => request<{ ok: boolean; message: string }>("/pixalate/test", { method: "POST" }),
  pixalateUsage: () => request<{ usage: UsageEntry[] }>("/pixalate/usage?limit=100"),

  // Stats
  dashboard: () => request<{ kpis: DashboardKpis; riskBands: Array<{ band: string; label: string; from: number; to: number }> }>("/stats/dashboard"),
  distribution: (runId?: string) =>
    request<{ distribution: DistributionBin[] }>(runId ? `/stats/distribution?runId=${runId}` : "/stats/distribution"),
  temporal: (runId: string, granularity = "hour") =>
    request<{ rows: TemporalRow[] }>(`/stats/temporal?runId=${runId}&granularity=${granularity}`),
  geo: (runId: string) => request<{ rows: GeoRow[] }>(`/stats/geo?runId=${runId}`),
  duplicates: () => request<DuplicateStats>("/stats/duplicates"),
  signalComparison: (runId: string) => request<{ rows: SignalComparisonRow[] }>(`/stats/signal-comparison?runId=${runId}`),
  highRisk: (runId: string | null, minRisk: number) =>
    request<{ rows: HighRiskRow[] }>(`/stats/high-risk?runId=${runId ?? ""}&minRisk=${minRisk}`),

  // Reports
  reportPdf: (runId: string) => download(`/reports/${runId}/pdf`, `traffic-quality-report-${runId.slice(0, 8)}.pdf`),
  reportXlsx: (runId: string) => download(`/reports/${runId}/xlsx`, `traffic-quality-report-${runId.slice(0, 8)}.xlsx`),
  reportCsv: (runId: string) => download(`/reports/${runId}/csv`, `traffic-quality-results-${runId.slice(0, 8)}.csv`),
  reportSsp: (runId: string, channel?: string) =>
    download(`/reports/${runId}/ssp${channel ? `?channel=${encodeURIComponent(channel)}` : ""}`, `ssp-summary-${runId.slice(0, 8)}.pdf`),
  exportAll: () => download("/reports/export-all", `traffic-quality-export-${new Date().toISOString().slice(0, 10)}.csv`),

  // Webhook / API ingestion
  ingestStatus: () =>
    request<{
      enabled: boolean;
      endpoint: string;
      auth: string;
      maxBatch: number;
      ratePerMinute: number;
      stagesOnly: boolean;
      note: string;
    }>("/ingest/status"),

  // Settings + audit
  settings: () => request<{ settings: Record<string, string>; apiKeyConfigured: boolean }>("/settings"),
  updateSettings: (patch: Record<string, string>) =>
    request<{ applied: Record<string, string>; rejected: string[]; settings: Record<string, string> }>("/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  retentionPurge: (days: number) =>
    request<{ deletedRecords: number; cutoff: string }>("/settings/retention/purge", {
      method: "POST",
      body: JSON.stringify({ days }),
    }),
  audit: () => request<{ entries: AuditEntry[] }>("/audit?limit=200"),
  apiErrors: () => request<{ errors: Array<Record<string, unknown>> }>("/audit/errors?limit=100"),
};