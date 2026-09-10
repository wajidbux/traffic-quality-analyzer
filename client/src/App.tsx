import { Routes, Route, NavLink, useLocation } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Upload from "./pages/Upload";
import RunAnalysis from "./pages/RunAnalysis";
import Results from "./pages/Results";
import Channels from "./pages/Channels";
import RiskAnalysis from "./pages/RiskAnalysis";
import PixalateApi from "./pages/PixalateApi";
import Reports from "./pages/Reports";
import SettingsPage from "./pages/SettingsPage";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/upload", label: "Traffic Upload" },
  { to: "/analyze", label: "Run Analysis" },
  { to: "/results", label: "Analysis Results" },
  { to: "/channels", label: "Channels" },
  { to: "/risk", label: "Risk Analysis" },
  { to: "/pixalate", label: "Pixalate API" },
  { to: "/reports", label: "Reports" },
  { to: "/settings", label: "Settings" },
];

export default function App() {
  const location = useLocation();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">TQ</div>
          <div>
            <div className="brand-name">Traffic Quality</div>
            <div className="brand-sub">Analyzer</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="dot dot-green" /> Pixalate Ad Fraud API
          <div className="sidebar-note">Offline sampling mode</div>
        </div>
      </aside>
      <main className="content">
        <Routes location={location}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/analyze" element={<RunAnalysis />} />
          <Route path="/results" element={<Results />} />
          <Route path="/results/:runId" element={<Results />} />
          <Route path="/channels" element={<Channels />} />
          <Route path="/risk" element={<RiskAnalysis />} />
          <Route path="/pixalate" element={<PixalateApi />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}