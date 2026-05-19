import React, { useState, useMemo, useEffect, useRef, useCallback, Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import type { DashboardData, Holding } from "./types.js";
import type { ApiStatus, SetupState } from "./api.js";
import { apiPost, getDashboardData, getSetup, getStatus, submitSettings } from "./api.js";
import { META } from "./components.js";
import type { DividendIncomeMode } from "./dividends.js";
import { refreshBannerClass, refreshBannerText, refreshHeaderText } from "./refresh-status.js";
import { localPayableDate } from "./utils.js";
import { Setup } from "./Setup.js";
import {
  CalendarTab, HoldingsTab, IncomeTab, OverviewTab, StatsStrip,
} from "./panels.js";
import { ResearchTab } from "./Research.js";
import { AdvisorTab } from "./Advisor.js";

type HoldingEx = Holding & { ticker: string; type: string };
type Theme = "light" | "dark";
const UPCOMING_PAYOUT_STATES = new Set(["pending", "announced"]);
const THEME_STORAGE_KEY = "watcher-theme";

function initialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  override componentDidCatch(_error: Error, info: ErrorInfo) {
    console.error("[watcher] Uncaught render error:", info.componentStack);
  }
  override render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "2rem", fontFamily: "monospace", color: "#c0392b" }}>
          <strong>Something went wrong.</strong>
          <pre style={{ marginTop: "1rem", whiteSpace: "pre-wrap" }}>{this.state.error.message}</pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: "1rem" }}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [data, setData]               = useState<DashboardData | null>(null);
  const [tab, setTab]                 = useState("overview");
  const [col, setCol]                 = useState("value");
  const [dir, setDir]                 = useState(-1);
  const [busy, setBusy]               = useState(false);
  const [restarting, setRestarting]   = useState(false);
  const [restartConfirm, setRestartConfirm] = useState(false);
  const restartConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [loadError, setLoadError]     = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [apiStatus, setApiStatus]     = useState<ApiStatus | null>(null);
  const [theme, setTheme]             = useState<Theme>(() => initialTheme());
  const [menuOpen, setMenuOpen]       = useState(false);
  const [incomeMode, setIncomeMode]   = useState<DividendIncomeMode>("realized");
  const [setup, setSetup]             = useState<SetupState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [offline, setOffline]         = useState(false);
  const statusFailCount               = useRef(0);
  const menuRef                       = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    getSetup()
      .then(async s => {
        if (!active) return;
        setSetup(s);
        if (!s.configured) return;
        const d = await getDashboardData();
        if (active) setData(d as DashboardData);
      })
      .catch(e => { if (active) setLoadError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const loadStatus = async () => {
      if (setup && !setup.configured) return;
      try {
        const status = await getStatus();
        if (!active) return;
        setApiStatus(status);
        statusFailCount.current = 0;
        setOffline(false);
      } catch {
        if (!active) return;
        statusFailCount.current += 1;
        if (statusFailCount.current >= 3) setOffline(true);
      }
    };
    loadStatus();
    const interval = setInterval(loadStatus, 15_000);
    return () => { active = false; clearInterval(interval); };
  }, [setup]);

  useEffect(() => {
    return () => { if (restartPollTimer.current) clearInterval(restartPollTimer.current); };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    function closeMenu(e: PointerEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, []);

  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  async function doRefresh() {
    if (apiStatus?.refreshing || busy) return;
    setBusy(true);
    setRefreshError(null);
    const refreshResp = await apiPost("/api/refresh");
    if (!refreshResp.ok) {
      if (mountedRef.current) { setRefreshError(`Refresh request failed: ${refreshResp.status}`); setBusy(false); }
      return;
    }
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (!mountedRef.current) return;
      try {
        const s = await getStatus();
        if (!mountedRef.current) return;
        setApiStatus(s);
        if (!s.refreshing) {
          if (s.error) { setRefreshError(s.error); setBusy(false); return; }
          const d = await getDashboardData();
          if (mountedRef.current) { setData(d); setBusy(false); }
          return;
        }
      } catch { /* retry */ }
    }
    if (mountedRef.current) { setRefreshError("Refresh timed out"); setBusy(false); }
  }

  const handleRestartClick = useCallback(() => {
    if (!restartConfirm) {
      setRestartConfirm(true);
      restartConfirmTimer.current = setTimeout(() => setRestartConfirm(false), 3000);
      return;
    }
    if (restartConfirmTimer.current) clearTimeout(restartConfirmTimer.current);
    setRestartConfirm(false);
    doRestart();
  }, [restartConfirm]);

  async function doRestart() {
    setRestarting(true);
    await apiPost("/api/restart").catch(() => {});
    if (restartPollTimer.current) clearInterval(restartPollTimer.current);
    restartPollTimer.current = setInterval(async () => {
      try {
        await getDashboardData();
        if (restartPollTimer.current) clearInterval(restartPollTimer.current);
        window.location.reload();
      } catch { /* retry */ }
    }, 1500);
  }

  async function reloadAfterSetup() {
    window.location.reload();
  }

  function sortBy(c: string) { if (col === c) setDir(d => -d); else { setCol(c); setDir(-1); } }

  const raw   = (data?.holdings ?? []).filter(h => h.source !== "crypto" && h.type !== "Crypto");
  const divs  = data?.dividends ?? [];
  const sum   = data?.summary   ?? {
    totalCost: 0, totalValue: 0, grossHoldingsValue: 0, netLiquidationValue: 0,
    cashBalance: 0, pnl: 0, pnlPct: 0, divsEarned: 0,
    last30dIncome: 0, trailing30dIncome: 0, annualizedTrailingIncome: 0,
    forwardProjectedAnnualIncome: 0,
    dividendTargetDaily: 280,
    dividendTargetAnnual: 102_200,
    forwardProjectedDailyIncome: 0,
    dividendGoalProgressPct: 0,
    dividendIncomeGapDaily: 280,
    dividendIncomeGapAnnual: 102_200,
    capitalRequiredAtCurrentYield: null,
    annualYieldOnCost: 0,
    lifetimeDividendYieldOnCost: 0, dailyCost: 0, daysOfFreedom: 0,
    reconciliation: { stockGrossValue: 0, stockNetValue: 0, cryptoValue: 0, netAdjustment: 0, source: "stock_positions", stale: false },
  };
  const holds = useMemo<HoldingEx[]>(() => [...raw.map(h => ({
    ...h, ticker: h.symbol,
    type: (META[h.symbol] ?? {}).type ?? h.type ?? "Stock",
  }))].sort((a, b) => {
    const av = a[col as keyof HoldingEx] ?? 0;
    const bv = b[col as keyof HoldingEx] ?? 0;
    return dir * (av < bv ? -1 : av > bv ? 1 : 0);
  }), [raw, col, dir]);

  const alloc = useMemo(() => {
    const a: Record<string, number> = {};
    for (const h of holds) { const t = h.type; a[t] = (a[t] ?? 0) + h.value; }
    return a;
  }, [holds]);

  const upcoming = useMemo(() => {
    const now = Date.now(), end = now + 30 * 864e5;
    return [...divs]
      .filter(d => {
        if (!UPCOMING_PAYOUT_STATES.has(d.state)) return false;
        const start = localPayableDate(d.payableDate, 0, 0, 0, 0).getTime();
        const finish = localPayableDate(d.payableDate, 23, 59, 59, 999).getTime();
        return finish >= now && start <= end;
      })
      .sort((a, b) => a.payableDate.localeCompare(b.payableDate));
  }, [divs]);

  const calGroups = useMemo(() => {
    const g: Record<string, typeof divs> = {};
    for (const d of [...divs].sort((a, b) => b.payableDate.localeCompare(a.payableDate))) {
      const lbl = localPayableDate(d.payableDate).toLocaleDateString("en-US", { month: "long", year: "numeric" });
      if (!g[lbl]) g[lbl] = [];
      g[lbl]!.push(d);
    }
    return Object.entries(g);
  }, [divs]);

  if (!setup && !loadError) return <div className="loading">Loading…</div>;
  if (setup && !setup.configured) return <Setup setup={setup} onComplete={reloadAfterSetup} />;
  if (!data) return <div className="loading">{loadError ? `Unable to load dashboard: ${loadError}` : "Loading…"}</div>;

  const visibleHoldingsValue = holds.reduce((total, holding) => total + holding.value, 0);
  const reconciliation = sum.reconciliation ?? {
    stockGrossValue: sum.grossHoldingsValue ?? visibleHoldingsValue,
    stockNetValue: sum.netLiquidationValue ?? sum.totalValue,
    cryptoValue: 0,
    netAdjustment: (sum.netLiquidationValue ?? sum.totalValue) - (sum.grossHoldingsValue ?? visibleHoldingsValue),
    source: "stock_positions" as const,
    stale: false,
  };
  const grossValue   = reconciliation.stockGrossValue || visibleHoldingsValue || sum.grossHoldingsValue || sum.totalValue;
  const allocationBase = grossValue > 0 ? grossValue : 1;
  const trailing30d = sum.trailing30dIncome ?? sum.last30dIncome;
  const yoc         = sum.annualYieldOnCost ?? 0;
  const lifetimeYoc = sum.lifetimeDividendYieldOnCost ?? 0;
  const trailingAnnual = sum.annualizedTrailingIncome ?? trailing30d * 12;
  const projectedAnnual = sum.forwardProjectedAnnualIncome ?? trailingAnnual;
  const projectedDaily = sum.forwardProjectedDailyIncome ?? projectedAnnual / 365;
  const dividendTargetDaily = sum.dividendTargetDaily ?? 280;
  const dividendTargetAnnual = sum.dividendTargetAnnual ?? dividendTargetDaily * 365;
  const dividendGoalProgressPct = sum.dividendGoalProgressPct ?? (dividendTargetAnnual > 0 ? Math.min((projectedAnnual / dividendTargetAnnual) * 100, 100) : 100);
  const dividendIncomeGapDaily = sum.dividendIncomeGapDaily ?? Math.max(dividendTargetDaily - projectedDaily, 0);
  const dividendIncomeGapAnnual = sum.dividendIncomeGapAnnual ?? Math.max(dividendTargetAnnual - projectedAnnual, 0);
  const capitalRequiredAtCurrentYield = sum.capitalRequiredAtCurrentYield ?? null;
  const incomePositions = [...raw].sort((a, b) => (b.forwardAnnualIncome ?? 0) - (a.forwardAnnualIncome ?? 0)).filter(h => (h.forwardAnnualIncome ?? 0) > 0);
  const freePct = dividendTargetDaily > 0 ? Math.min((trailing30d / (dividendTargetDaily * 30)) * 100, 100) : 0;
  const upcomingPayout = upcoming.reduce((s, d) => s + d.amount, 0);
  const sourceErrorEntries = Object.entries(data.sourceErrors ?? {});
  const sourceWarningEntries = Object.entries(data.sourceWarnings ?? {});
  const effectiveStatus: ApiStatus = apiStatus ?? {
    refreshing: false, error: null, fetchedAt: data.fetchedAt ?? null,
    refreshPhase: "idle", refreshMessage: null,
    lastRefreshStartedAt: null, lastRefreshFinishedAt: null,
  };
  const headerStatusText = refreshHeaderText(effectiveStatus);
  const bannerText = refreshBannerText(effectiveStatus);
  const bannerClass = refreshBannerClass(effectiveStatus);
  const refreshInProgress = busy || effectiveStatus.refreshing;
  const fetchedAtMs = data.fetchedAt ? new Date(data.fetchedAt).getTime() : null;
  const dataAgeHours = fetchedAtMs ? (Date.now() - fetchedAtMs) / 3_600_000 : null;
  const isStale = dataAgeHours !== null && dataAgeHours > 24;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column" }}>

      <nav className="g-header-wrap">
        <header className="g-header">
          <div className={`g-menu-wrap ${menuOpen ? "is-open" : ""}`} ref={menuRef}>
            <button className="g-header-btn" aria-label="Open menu" aria-expanded={menuOpen} type="button" onClick={() => setMenuOpen(open => !open)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="17" x2="21" y2="17"/></svg>
              <span className="g-header-btn__label">Menu</span>
            </button>
            <div className="g-menu-panel" aria-label="Main menu">
              {["Overview", "Holdings", "Calendar", "Income", "Research", "Advisor"].map(t => (
                <button key={t} className={tab === t.toLowerCase() ? "active" : ""}
                  onClick={() => { setTab(t.toLowerCase()); setMenuOpen(false); }}>{t}</button>
              ))}
            </div>
          </div>
          <div className="g-logo" aria-label="Watcher">
            <span className="g-logo__name">Watcher</span>
            <span className="g-logo__meta">{headerStatusText}</span>
          </div>
          <div className="g-header-actions">
            <button className="g-header-btn" onClick={() => setTheme(v => v === "dark" ? "light" : "dark")} type="button" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
              <i className={theme === "dark" ? "fa-solid fa-sun" : "fa-solid fa-moon"}></i>
              <span className="g-header-btn__label">{theme === "dark" ? "Light" : "Dark"}</span>
            </button>
            <button className="g-header-btn btn-settings" onClick={() => setSettingsOpen(true)} type="button" aria-label="Open settings">
              <i className="fa-solid fa-gear"></i>
              <span className="g-header-btn__label">Settings</span>
            </button>
          </div>
        </header>
      </nav>

      {offline && <div className="banner-offline"><i className="fa-solid fa-wifi" style={{ opacity: .5 }}></i>Dashboard unreachable — retrying…</div>}
      {isStale && !offline && <div className="banner-stale"><i className="fa-solid fa-triangle-exclamation"></i>Data is {Math.floor(dataAgeHours!)}h old — last refresh may have failed</div>}
      {restarting && <div style={{ background: "#f59e0b", color: "#fff", textAlign: "center", padding: "10px 16px", fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><i className="fa-solid fa-spinner fa-spin"></i>Server restarting…</div>}
      {bannerText && <div className={`refresh-banner ${bannerClass}`}><i className="fa-solid fa-circle-info"></i>{bannerText}</div>}
      {refreshError && <div style={{ background: "#ef4444", color: "#fff", textAlign: "center", padding: "10px 16px", fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><i className="fa-solid fa-circle-exclamation"></i>Refresh failed: {refreshError}</div>}
      {sourceErrorEntries.length > 0 && <div style={{ background: "#7c3aed", color: "#fff", textAlign: "center", padding: "9px 16px", fontSize: 12, fontWeight: 500 }}>
        Some sources are stale or unavailable: {sourceErrorEntries.map(([source]) => source).join(", ")}
      </div>}
      {sourceWarningEntries.length > 0 && <div style={{ background: "#475569", color: "#fff", textAlign: "center", padding: "9px 16px", fontSize: 12, fontWeight: 500 }}>
        Some source rows were normalized: {sourceWarningEntries.map(([source]) => source).join(", ")}
      </div>}

      <main className="page">
        <StatsStrip
          sum={sum} trailing30d={trailing30d}
          projectedAnnual={projectedAnnual} trailingAnnual={trailingAnnual}
          yoc={yoc} lifetimeYoc={lifetimeYoc} grossValue={grossValue}
          freePct={freePct} upcomingPayout={upcomingPayout} upcoming={upcoming}
        />

        {tab === "overview" && (
          <OverviewTab
            holds={holds} divs={divs} alloc={alloc} allocationBase={allocationBase}
            upcoming={upcoming} upcomingPayout={upcomingPayout} grossValue={grossValue}
            sum={sum} guardrails={data.guardrails ?? []}
            incomeMode={incomeMode} setIncomeMode={setIncomeMode}
            col={col} dir={dir} sortBy={sortBy}
          />
        )}

        {tab === "holdings" && (
          <HoldingsTab holds={holds} grossValue={grossValue} sum={sum} col={col} dir={dir} sortBy={sortBy} />
        )}

        {tab === "calendar" && <CalendarTab calGroups={calGroups} marketEvents={data.marketCalendar ?? []} />}

        {tab === "income" && (
          <IncomeTab
            divs={divs} sum={sum} incomeMode={incomeMode} setIncomeMode={setIncomeMode}
            trailing30d={trailing30d} projectedAnnual={projectedAnnual} trailingAnnual={trailingAnnual}
            projectedDaily={projectedDaily} dividendTargetDaily={dividendTargetDaily}
            dividendTargetAnnual={dividendTargetAnnual} dividendGoalProgressPct={dividendGoalProgressPct}
            dividendIncomeGapDaily={dividendIncomeGapDaily} dividendIncomeGapAnnual={dividendIncomeGapAnnual}
            capitalRequiredAtCurrentYield={capitalRequiredAtCurrentYield} incomePositions={incomePositions}
          />
        )}

        {tab === "research" && (
          <ResearchTab
            goal={{
              currentForwardAnnual: data.summary?.forwardProjectedAnnualIncome ?? 0,
              dividendTargetAnnual: data.summary?.dividendTargetAnnual ?? 0,
              currentValue: data.summary?.grossHoldingsValue ?? 0,
            }}
            holds={holds}
            grossValue={grossValue}
            forwardAnnualIncome={projectedAnnual}
          />
        )}

        {tab === "advisor" && <AdvisorTab />}

      </main>
      <nav className="mobile-tab-bar" aria-label="Tab navigation">
        {(["overview", "holdings", "calendar", "income", "research", "advisor"] as const).map(t => {
          const icons: Record<string, string> = {
            overview: "fa-solid fa-chart-pie",
            holdings: "fa-solid fa-briefcase",
            calendar: "fa-solid fa-calendar-days",
            income: "fa-solid fa-coins",
            research: "fa-solid fa-magnifying-glass-chart",
            advisor: "fa-solid fa-wand-magic-sparkles",
          };
          const labels: Record<string, string> = {
            overview: "Overview", holdings: "Holdings", calendar: "Calendar",
            income: "Income", research: "Research", advisor: "Advisor",
          };
          return (
            <button key={t} className={`mobile-tab-btn${tab === t ? " active" : ""}`}
              onClick={() => setTab(t)} type="button" aria-label={labels[t]}>
              <i className={icons[t]}></i>
              {labels[t]}
            </button>
          );
        })}
      </nav>

      {settingsOpen && setup && (
        <SettingsDrawer
          setup={setup}
          onClose={() => setSettingsOpen(false)}
          onRefresh={doRefresh}
          refreshInProgress={refreshInProgress}
          refreshError={refreshError}
          onRestartClick={handleRestartClick}
          restartConfirm={restartConfirm}
          restarting={restarting}
          onSaved={async requiresRestart => {
            const s = await getSetup();
            setSetup(s);
            setSettingsOpen(false);
            if (requiresRestart) await doRestart();
            else {
              const d = await getDashboardData().catch(() => null);
              if (d) setData(d);
            }
          }}
        />
      )}
    </div>
  );
}

function SettingsDrawer({ setup, onClose, onSaved, onRefresh, refreshInProgress, refreshError, onRestartClick, restartConfirm, restarting }: {
  setup: SetupState;
  onClose: () => void;
  onSaved: (requiresRestart: boolean) => void | Promise<void>;
  onRefresh: () => void;
  refreshInProgress: boolean;
  refreshError: string | null;
  onRestartClick: () => void;
  restartConfirm: boolean;
  restarting: boolean;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [dashboardPassword, setDashboardPassword] = useState("");
  const [dividendTargetDaily, setDividendTargetDaily] = useState(String(setup.dividendTargetDaily));
  const [dailyCost, setDailyCost] = useState(String(setup.dailyCost));
  const [host, setHost] = useState(setup.server.host);
  const [port, setPort] = useState(String(setup.server.port));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsedTarget = parseFloat(dividendTargetDaily);
    const parsedCost = parseFloat(dailyCost);
    const parsedPort = parseInt(port, 10);
    if (!isFinite(parsedTarget) || parsedTarget < 0) { setError("Daily dividend target must be a valid number"); return; }
    if (!isFinite(parsedCost) || parsedCost < 0) { setError("Daily cost must be a valid number"); return; }
    if (!isFinite(parsedPort) || parsedPort < 1 || parsedPort > 65535) { setError("Port must be a number between 1 and 65535"); return; }
    setSaving(true);
    setError(null);
    try {
      const result = await submitSettings({
        ...(username.trim() ? { username: username.trim() } : {}),
        ...(password ? { password } : {}),
        ...(mfaCode.trim() ? { mfaCode: mfaCode.trim() } : {}),
        ...(dashboardPassword ? { dashboardPassword } : {}),
        dividendTargetDaily: parsedTarget,
        dailyCost: parsedCost,
        host,
        port: parsedPort,
      });
      await onSaved(result.requiresRestart);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="settings-drawer" onSubmit={save}>
        <div className="settings-head">
          <span>Settings</span>
          <button type="button" onClick={onClose} aria-label="Close settings"><i className="fa-solid fa-xmark" /></button>
        </div>
        <label><span>Robinhood username</span><input value={username} onChange={e => setUsername(e.target.value)} placeholder="Leave unchanged" /></label>
        <label><span>Robinhood password</span><input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Leave unchanged" /></label>
        <label><span>MFA code</span><input value={mfaCode} onChange={e => setMfaCode(e.target.value)} placeholder="Leave blank unless needed" /></label>
        <label><span>Dashboard password</span><input value={dashboardPassword} onChange={e => setDashboardPassword(e.target.value)} type="password" placeholder={setup.hasDashboardPassword ? "Leave unchanged" : "Not set"} /></label>
        <div className="setup-grid">
          <label><span>Daily dividend target</span><input value={dividendTargetDaily} onChange={e => setDividendTargetDaily(e.target.value)} type="number" min="0" step="0.01" inputMode="decimal" /></label>
          <label><span>Daily cost</span><input value={dailyCost} onChange={e => setDailyCost(e.target.value)} type="number" min="0" step="0.01" inputMode="decimal" /></label>
        </div>
        <div className="setup-grid">
          <label><span>Host</span><input value={host} onChange={e => setHost(e.target.value)} /></label>
          <label><span>Port</span><input value={port} onChange={e => setPort(e.target.value)} type="number" min="1" step="1" inputMode="numeric" /></label>
        </div>
        {error && <div className="setup-error"><i className="fa-solid fa-circle-exclamation" />{error}</div>}
        <button className="setup-submit" disabled={saving} type="submit">
          <i className={saving ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-check"} />
          {saving ? "Saving" : "Save"}
        </button>

        <div className="settings-actions-divider" />

        <div className="settings-danger-actions">
          <button className="settings-action-btn" type="button" onClick={onRefresh} disabled={refreshInProgress}>
            <i className={refreshInProgress ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-rotate-right"} />
            {refreshInProgress ? "Refreshing…" : "Refresh data"}
          </button>
          {refreshError && <div className="setup-error" style={{ marginTop: 0 }}><i className="fa-solid fa-circle-exclamation" />{refreshError}</div>}
          <button className={`settings-action-btn danger${restartConfirm ? " confirm-active" : ""}`} type="button" onClick={onRestartClick} disabled={restarting}>
            <i className={restarting ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-power-off"} />
            {restartConfirm ? "Sure? Click again" : restarting ? "Restarting…" : "Restart server"}
          </button>
        </div>
      </form>
    </div>
  );
}
