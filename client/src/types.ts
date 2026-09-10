export interface Channel {
  id: number;
  name: string;
  description: string | null;
  is_active: number;
  created_at: string;
}

export interface RunSummary {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  mode: string;
  channelFilter: string | null;
  startedAt: string;
  endedAt: string | null;
  progressTotal: number;
  progressProcessed: number;
  numInput: number;
  numProcessed: number;
  numSuccess: number;
  numFailed: number;
  apiCallsUsed: number;
  quotaBefore: number | null;
  quotaAfter: number | null;
  avgRisk: number | null;
  medianRisk: number | null;
  pctLower: number | null;
  pctElevated: number | null;
  pctHigh: number | null;
  pctVeryHigh: number | null;
  error: string | null;
}

export interface DistributionBin {
  bin: string;
  count: number;
  pct: number;
}

export interface RiskBandCount {
  band: "lower" | "elevated" | "high" | "very_high";
  count: number;
  pct: number;
}

export interface DashboardKpis {
  totalRecords: number;
  totalResults: number;
  successfulChecks: number;
  failedChecks: number;
  remainingQuota: number | null;
  averageRisk: number | null;
  medianRisk: number | null;
  highestRisk: number | null;
  lowestRisk: number | null;
  highRiskRecords: number;
  veryHighRiskRecords: number;
  lowerRiskRecords: number;
  elevatedRiskRecords: number;
  uniqueIps: number;
  uniqueRidas: number;
  uniqueUserAgents: number;
  uniqueIpRidaCombos: number;
  totalRequests: number;
  repeatIpRate: number | null;
  repeatRidaRate: number | null;
  lastRun: string | null;
  pctLower: number | null;
  pctElevated: number | null;
  pctHigh: number | null;
  pctVeryHigh: number | null;
  distribution: DistributionBin[];
}

export interface QuotaStatus {
  apiKeyConfigured: boolean;
  connected: boolean;
  quota: {
    limit: number | null;
    used: number | null;
    remaining: number | null;
    renewal: string | null;
    apiStatus: string | null;
    interval: number | null;
    timeUnit: string | null;
    lastCheckedAt: string | null;
    lastSuccessfulRequest: string | null;
    lastError: string | null;
    level: "green" | "yellow" | "red" | "unknown";
    warnings: { yellow: number; red: number };
  };
}

export interface ChannelStats {
  channelId: number;
  channelName: string;
  isActive: boolean;
  totalRecords: number;
  uniqueIps: number;
  uniqueRidas: number;
  averageRisk: number | null;
  medianRisk: number | null;
  highRiskPct: number | null;
  veryHighRiskPct: number | null;
  lowerRiskPct: number | null;
  elevatedRiskPct: number | null;
  pixalateFailures: number;
  countryDistribution: Array<{ country: string; count: number }>;
  deviceAgentDistribution: Array<{ label: string; count: number }>;
  resultsAnalyzed: number;
}

export interface HighRiskRow {
  recordId: string;
  requestId: string | null;
  timestamp: string | null;
  channel: string | null;
  ip: string | null;
  rida: string | null;
  userAgent: string | null;
  country: string | null;
  probability: number | null;
  band: string;
  signalsSubmitted: string[];
  responseStatus: number | null;
}

export interface SignalComparisonRow {
  requestId: string;
  recordId: string;
  channel: string | null;
  timestamp: string | null;
  ipScore: number | null;
  deviceScore: number | null;
  uaScore: number | null;
  ipDeviceScore: number | null;
  ipDeviceUaScore: number | null;
  bestScore: number | null;
  signalsAvailable: number;
}

export interface PreviewResponse {
  poolSize: number;
  selectedRecords: number;
  estimatedCalls: number;
  currentQuota: number | null;
  remainingAfter: number | null;
  insufficientQuota: boolean;
  mode: string;
}

export type SampleStrategy =
  | { type: "all" }
  | { type: "random_n"; n: number }
  | { type: "percentage"; pct: number }
  | { type: "per_channel_n"; n: number }
  | { type: "per_country_n"; n: number }
  | { type: "per_hour_n"; n: number }
  | { type: "unique_ip" }
  | { type: "unique_rida" }
  | { type: "unique_ip_rida" };

export interface RecordRow {
  id: string;
  channel_id: number | null;
  channel_name: string | null;
  timestamp: string | null;
  ip: string | null;
  rida: string | null;
  device_id: string | null;
  user_agent: string | null;
  country: string | null;
  region: string | null;
  ad_request_id: string | null;
  source: string;
  created_at: string;
}

export interface ImportResult {
  imported: number;
  duplicates: number;
  skippedNoSignals: number;
  unknownChannels: string[];
  columnMapUsed: Record<string, string>;
  records: RecordRow[];
}

export interface TemporalRow {
  bucket: string;
  requests: number;
  avgRisk: number | null;
  highRiskPct: number | null;
}

export interface GeoRow {
  country: string;
  requests: number;
  avgRisk: number | null;
  highRiskPct: number | null;
  veryHighRiskPct: number | null;
}

export interface DuplicateStats {
  totalRequests: number;
  uniqueIps: number;
  uniqueRidas: number;
  uniqueIpRidaCombos: number;
  uniqueUserAgents: number;
  repeatIpRate: number | null;
  repeatRidaRate: number | null;
  topRepeatedIps: Array<{ value: string; count: number }>;
  topRepeatedRidas: Array<{ value: string; count: number }>;
}

export interface AuditEntry {
  id: number;
  occurred_at: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: string | null;
  actor: string;
}

export interface UsageEntry {
  id: number;
  called_at: string;
  endpoint: string;
  http_status: number | null;
  latency_ms: number | null;
  quota_before: number | null;
  quota_after: number | null;
  success: number;
}