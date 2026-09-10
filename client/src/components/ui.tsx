import { ReactNode, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ---- layout primitives -----------------------------------------------------

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`card ${className}`}>
      {title && <div className="card-title">{title}</div>}
      {children}
    </div>
  );
}

export function KpiCard({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: "green" | "yellow" | "red" | "blue" }) {
  return (
    <div className={`kpi-card${tone ? ` tone-${tone}` : ""}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: "green" | "yellow" | "red" | "blue" | "gray" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "completed" ? "green" : status === "running" ? "blue" : status === "failed" ? "red" : status === "cancelled" ? "gray" : "yellow";
  return <Badge tone={tone as "green"}>{status}</Badge>;
}

export function RiskBadge({ band }: { band: string }) {
  const tone = band === "very_high" ? "red" : band === "high" ? "yellow" : band === "elevated" ? "blue" : "green";
  const label =
    band === "very_high" ? "Very high" : band === "high" ? "High" : band === "elevated" ? "Elevated" : "Lower";
  return <Badge tone={tone as "green"}>{label}</Badge>;
}

export function ProgressBar({ processed, total }: { processed: number; total: number }) {
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  return (
    <div className="progress-wrap">
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-label">
        {processed} / {total} ({pct}%)
      </div>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <div className="empty-state">{message}</div>;
}

export function Alert({ tone, children }: { tone: "info" | "warn" | "error" | "success"; children: ReactNode }) {
  return <div className={`alert alert-${tone}`}>{children}</div>;
}

// ---- table -----------------------------------------------------------------

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  align?: "left" | "right";
}

export function DataTable<T extends object>({ columns, rows, empty }: { columns: Column<T>[]; rows: T[]; empty?: string }) {
  if (rows.length === 0) return <EmptyState message={empty ?? "No data."} />;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={c.align === "right" ? { textAlign: "right" } : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} style={c.align === "right" ? { textAlign: "right" } : undefined}>
                  {c.render ? c.render(row) : ((row as Record<string, unknown>)[c.key] as ReactNode)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- charts ----------------------------------------------------------------

const CHART_COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#ef4444", "#84cc16"];

export function DistributionChart({ data }: { data: Array<{ bin: string; count: number; pct: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
        <XAxis dataKey="bin" tick={{ fontSize: 11 }} interval={0} angle={-35} textAnchor="end" height={60} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v: number | string) => [v, "records"]} />
        <Bar dataKey="count" fill="#6366f1" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function BandPieChart({ data }: { data: Array<{ name: string; value: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={2}>
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(v: number | string) => [`${Number(v).toFixed(1)}%`, ""]} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function TemporalChart({ data }: { data: Array<{ bucket: string; requests: number; avgRisk: number | null; highRiskPct: number | null }> }) {
  const line = data.map((d) => ({ bucket: d.bucket.slice(5), requests: d.requests, avgRisk: d.avgRisk ?? 0 }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={line} margin={{ top: 8, right: 8, left: -20, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
        <XAxis dataKey="bucket" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
        <YAxis yAxisId="right" orientation="right" domain={[0, 1]} tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend />
        <Bar yAxisId="left" dataKey="requests" fill="#c7d2fe" name="Requests" />
        <Line yAxisId="right" dataKey="avgRisk" stroke="#ef4444" strokeWidth={2} dot={false} name="Avg risk" />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SimpleBars({ data, xKey, bars }: { data: Array<Record<string, unknown>>; xKey: string; bars: Array<{ key: string; name: string; color: string }> }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 40 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={70} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend />
        {bars.map((b) => (
          <Bar key={b.key} dataKey={b.key} name={b.name} fill={b.color} radius={[3, 3, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function GeoBarChart({ data }: { data: Array<{ country: string; requests: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="country" tick={{ fontSize: 11 }} width={70} />
        <Tooltip />
        <Bar dataKey="requests" fill="#10b981" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---- buttons ----------------------------------------------------------------

export function Button({ children, onClick, variant = "primary", disabled, type = "button" }: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button type={type} className={`btn btn-${variant}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function ConfirmButton({ label, confirmLabel = "Confirm", onConfirm, tone = "danger", disabled }: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  tone?: "primary" | "danger";
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <Button variant={tone} disabled={disabled} onClick={() => setArmed(true)}>
        {label}
      </Button>
    );
  }
  return (
    <span className="confirm-inline">
      <Button variant={tone} onClick={() => { setArmed(false); onConfirm(); }}>
        {confirmLabel}
      </Button>
      <Button variant="ghost" onClick={() => setArmed(false)}>
        Cancel
      </Button>
    </span>
  );
}

export function FormRow({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="form-row">
      <span className="form-label">{label}</span>
      {children}
      {hint && <span className="form-hint">{hint}</span>}
    </label>
  );
}