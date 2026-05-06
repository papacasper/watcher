import { useState, useMemo, useEffect, useRef } from "react";
import type { DashboardData, Holding } from "./types.js";
import type { ApiStatus } from "./api.js";
import { apiPost, getDashboardData, getStatus } from "./api.js";
import { Badge, Chart, META, Pill, SortArrow, TBAR } from "./components.js";
import { fmt, fmtS } from "./format.js";
import { refreshBannerClass, refreshBannerText, refreshHeaderText } from "./refresh-status.js";

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

function localPayableDate(date: string, hour = 12, minute = 0, second = 0, ms = 0): Date {
  const parts = date.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return new Date(year, month - 1, day, hour, minute, second, ms);
}

function currentPriceClass(holding: HoldingEx): string {
  if (holding.avgCost <= 0 || holding.price === holding.avgCost) return "";
  return holding.price > holding.avgCost ? "g" : "r";
}

export default function App() {
  const [data, setData]               = useState<DashboardData | null>(null);
  const [tab, setTab]                 = useState("overview");
  const [col, setCol]                 = useState("value");
  const [dir, setDir]                 = useState(-1);
  const [busy, setBusy]               = useState(false);
  const [restarting, setRestarting]   = useState(false);
  const [loadError, setLoadError]     = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [apiStatus, setApiStatus]     = useState<ApiStatus | null>(null);
  const [theme, setTheme]             = useState<Theme>(() => initialTheme());
  const [menuOpen, setMenuOpen]       = useState(false);
  const menuRef                       = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;

    getDashboardData()
      .then(d => { if (active) setData(d as DashboardData); })
      .catch(e => {
        if (active) setLoadError(e instanceof Error ? e.message : String(e));
      });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const loadStatus = async () => {
      try {
        const status = await getStatus();
        if (active) setApiStatus(status);
      } catch { /* status is best-effort outside manual refresh */ }
    };
    loadStatus();
    const interval = setInterval(loadStatus, 15_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
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

  async function doRefresh() {
    if (apiStatus?.refreshing || busy) return;
    setBusy(true);
    setRefreshError(null);
    const refreshResp = await apiPost("/api/refresh");
    if (!refreshResp.ok) {
      setRefreshError(`Refresh request failed: ${refreshResp.status}`);
      setBusy(false);
      return;
    }
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const s = await getStatus();
        setApiStatus(s);
        if (!s.refreshing) {
          if (s.error) { setRefreshError(s.error); setBusy(false); return; }
          const d = await getDashboardData();
          setData(d);
          setBusy(false);
          return;
        }
      } catch { /* retry */ }
    }
    setRefreshError("Refresh timed out");
    setBusy(false);
  }

  async function doRestart() {
    setRestarting(true);
    await apiPost("/api/restart").catch(() => {});
    const poll = setInterval(async () => {
      try { await getDashboardData(); clearInterval(poll); window.location.reload(); } catch { /* retry */ }
    }, 1500);
  }

  function toggleTheme() {
    setTheme(value => value === "dark" ? "light" : "dark");
  }

  function sortBy(c: string) { if (col === c) setDir(d => -d); else { setCol(c); setDir(-1); } }

  const raw   = (data?.holdings ?? []).filter(h => h.source !== "crypto" && h.type !== "Crypto");
  const divs  = data?.dividends ?? [];
  const sum   = data?.summary   ?? {
    totalCost: 0, totalValue: 0, grossHoldingsValue: 0, netLiquidationValue: 0,
    cashBalance: 0, pnl: 0, pnlPct: 0, divsEarned: 0,
    last30dIncome: 0, trailing30dIncome: 0, annualizedTrailingIncome: 0,
    forwardProjectedAnnualIncome: 0, annualYieldOnCost: 0,
    lifetimeDividendYieldOnCost: 0, dailyCost: 0, daysOfFreedom: 0,
    reconciliation: {
      stockGrossValue: 0,
      stockNetValue: 0,
      cryptoValue: 0,
      netAdjustment: 0,
      source: "stock_positions",
      stale: false,
    },
  };
  const spend = data?.spending  ?? null;

  const holds = useMemo<HoldingEx[]>(() => [...raw.map(h => ({
    ...h, ticker: h.symbol,
    type: (META[h.symbol] ?? {}).type ?? h.type ?? "Stock",
  }))].sort((a, b) => {
    const av = a[col as keyof HoldingEx] ?? "";
    const bv = b[col as keyof HoldingEx] ?? "";
    return dir * (av < bv ? -1 : av > bv ? 1 : 0);
  }), [raw, col, dir]);

  const alloc = useMemo(() => {
    const a: Record<string, number> = {};
    for (const h of holds) { const t = h.type; a[t] = (a[t] ?? 0) + h.value; }
    return a;
  }, [holds]);

  const monthly = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of divs) {
      if (!["paid", "reinvested"].includes(d.state)) continue;
      const k = d.payableDate.slice(0, 7);
      m[k] = (m[k] ?? 0) + d.amount;
    }
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({ label: new Date(k + "-02").toLocaleDateString("en-US", { month: "short", year: "2-digit" }), v }));
  }, [divs]);

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

  if (!data) return <div className="loading">{loadError ? `Unable to load dashboard: ${loadError}` : "Loading…"}</div>;

  const totalRet    = sum.pnl + sum.divsEarned;
  const totalRetPct = sum.totalCost > 0 ? (totalRet / sum.totalCost) * 100 : 0;
  const visibleHoldingsValue = holds.reduce((total, holding) => total + holding.value, 0);
  const reconciliation = sum.reconciliation ?? {
    stockGrossValue: sum.grossHoldingsValue ?? visibleHoldingsValue,
    stockNetValue: sum.netLiquidationValue ?? sum.totalValue,
    cryptoValue: 0,
    netAdjustment: (sum.netLiquidationValue ?? sum.totalValue) - (sum.grossHoldingsValue ?? visibleHoldingsValue),
    source: "stock_positions" as const,
    stale: false,
  };
  const netValue     = sum.netLiquidationValue ?? sum.totalValue;
  const grossValue   = reconciliation.stockGrossValue || visibleHoldingsValue || sum.grossHoldingsValue || sum.totalValue;
  const allocationBase = grossValue > 0 ? grossValue : 1;
  const netAdjustment = reconciliation.netAdjustment ?? netValue - grossValue;
  const trailing30d = sum.trailing30dIncome ?? sum.last30dIncome;
  const yoc         = sum.annualYieldOnCost ?? 0;
  const lifetimeYoc = sum.lifetimeDividendYieldOnCost ?? 0;
  const trailingAnnual = sum.annualizedTrailingIncome ?? trailing30d * 12;
  const projectedAnnual = sum.forwardProjectedAnnualIncome ?? trailingAnnual;
  const freePct     = sum.dailyCost > 0 ? Math.min((trailing30d / (sum.dailyCost * 30)) * 100, 100) : 0;
  const upcomingPayout = upcoming.reduce((s, d) => s + d.amount, 0);
  const sourceErrorEntries = Object.entries(data.sourceErrors ?? {});
  const sourceWarningEntries = Object.entries(data.sourceWarnings ?? {});
  const effectiveStatus: ApiStatus = apiStatus ?? {
    refreshing: false,
    error: null,
    fetchedAt: data.fetchedAt ?? null,
    refreshPhase: "idle",
    refreshMessage: null,
    lastRefreshStartedAt: null,
    lastRefreshFinishedAt: null,
  };
  const headerStatusText = refreshHeaderText(effectiveStatus);
  const bannerText = refreshBannerText(effectiveStatus);
  const bannerClass = refreshBannerClass(effectiveStatus);
  const refreshInProgress = busy || effectiveStatus.refreshing;

  const hCols = [
    { l: "Ticker",  c: "ticker",     x: "" },
    { l: "Name",    c: "name",       x: "hm" },
    { l: "Type",    c: "type",       x: "hm" },
    { l: "Shares",  c: "shares",     x: "hm" },
    { l: "Avg Purchase", c: "avgCost", x: "hm" },
    { l: "Current", c: "price",      x: "hm" },
    { l: "Value",   c: "value",      x: "" },
    { l: "P&L",     c: "pnl",        x: "hm" },
    { l: "Return",  c: "pnlPct",     x: "" },
    { l: "Divs",    c: "divsEarned", x: "" },
    { l: "Since",   c: "heldSince",  x: "hm" },
  ];

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
              {["Overview", "Holdings", "Calendar", "Income", "Spending"].map(t => (
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
            <button className="g-header-btn" onClick={doRefresh} disabled={refreshInProgress} type="button" aria-label="Refresh dashboard">
              <i className={refreshInProgress ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-rotate-right"}></i>
              <span className="g-header-btn__label">{refreshInProgress ? "Refreshing" : "Refresh"}</span>
            </button>
            <button className="g-header-btn" onClick={toggleTheme} type="button" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
              <i className={theme === "dark" ? "fa-solid fa-sun" : "fa-solid fa-moon"}></i>
              <span className="g-header-btn__label">{theme === "dark" ? "Light" : "Dark"}</span>
            </button>
            <button className="g-header-btn danger" onClick={doRestart} disabled={restarting} type="button" aria-label="Restart server">
              <i className="fa-solid fa-power-off"></i>
              <span className="g-header-btn__label">Restart</span>
            </button>
          </div>
        </header>
      </nav>

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

        {/* Stats strip */}
        <div className="stats">
          <div className="stat hero-card">
            <div className="stat-lbl">Total Portfolio Value</div>
            <div className="hero-num">{fmt(netValue)}</div>
            <div className="hero-ret">
              <span style={{ color: totalRet >= 0 ? "var(--green)" : "var(--red)", fontWeight: 500 }}>
                {totalRet >= 0 ? "+" : ""}{totalRetPct.toFixed(2)}%
              </span>
              <span style={{ color: totalRet >= 0 ? "var(--green)" : "var(--red)" }}>
                {totalRet >= 0 ? "+" : ""}{fmt(totalRet)}
              </span>
              <span style={{ fontSize: 11, color: "var(--dim)" }}>total return incl. dividends</span>
              <span style={{ fontSize: 11, color: "var(--dim)" }}>positions {fmt(grossValue)} · net adjustment {fmt(netAdjustment)}</span>
            </div>
          </div>

          <div className="stat stat-mobile-primary">
            <div className="stat-lbl">Upcoming Payout</div>
            <div className="stat-val g">{fmt(upcomingPayout)}</div>
            <div className="stat-sub">{upcoming.length} confirmed payouts</div>
          </div>

          <div className="stat stat-mobile-secondary">
            <div className="stat-lbl">Last 30d Income</div>
            <div className="stat-val">{fmt(trailing30d)}</div>
            <div className="stat-sub">{sum.daysOfFreedom} days of freedom</div>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${freePct.toFixed(1)}%` }} /></div>
          </div>

          <div className="stat stat-desktop-detail">
            <div className="stat-lbl">Yield on Cost</div>
            <div className="stat-val">{yoc.toFixed(2)}<span style={{ fontSize: 14, color: "var(--muted)", fontFamily: "var(--sans)" }}>%</span></div>
            <div className="stat-sub">annualized trailing income</div>
          </div>

          <div className="stat stat-mobile-primary">
            <div className="stat-lbl">Projected Annual</div>
            <div className="stat-val">{fmt(projectedAnnual)}</div>
            <div className="stat-sub">{fmt(trailingAnnual)} trailing run rate</div>
          </div>

          <div className="stat stat-mobile-primary">
            <div className="stat-lbl">Total Divs Earned</div>
            <div className="stat-val g">{fmt(sum.divsEarned)}</div>
            <div className="stat-sub">{lifetimeYoc.toFixed(2)}% lifetime on cost</div>
          </div>

          {spend && (
            <div className="stat stat-mobile-primary">
              <div className="stat-lbl">Portfolio Cash</div>
              <div className="stat-val">{fmt(spend.uninvestedCash)}</div>
              <div className="stat-sub r">{fmt(spend.spent30d)} spent last 30d</div>
            </div>
          )}
        </div>

        {/* Overview */}
        {tab === "overview" && (<>
          <div className="card payout-card">
            <div className="card-head">
              <span className="card-title">Upcoming · Next 30 days</span>
              <span className="mono g" style={{ fontSize: 13, fontWeight: 500 }}>
                {fmt(upcomingPayout)}
              </span>
            </div>
            {upcoming.length === 0
              ? <div className="card-body muted" style={{ fontSize: 12 }}>No dividends in the next 30 days</div>
              : upcoming.map(d => (
                <div key={d.symbol + d.payableDate} className="div-row">
                  <span className="mono muted" style={{ fontSize: 11, width: 36, textAlign: "right", flexShrink: 0 }}>
                    {localPayableDate(d.payableDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                  <span className="div-dot" style={{ background: d.state === "announced" ? "var(--green)" : "#93c5fd" }} />
                  <span className="mono" style={{ fontWeight: 500, flex: 1 }}>{d.symbol}</span>
                  <Badge type={(META[d.symbol] ?? {}).type ?? "Stock"} />
                  <span className="mono g" style={{ fontWeight: 500 }}>{fmt(d.amount)}</span>
                  <Pill state={d.state} />
                </div>
              ))
            }
          </div>

          <div className="card">
            <div className="card-head">
              <span className="card-title">Dividend Income History</span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>paid + reinvested · by month</span>
            </div>
            <div className="chart-wrap" style={{ height: 190 }}><Chart dividends={divs} /></div>
          </div>

          <div className="g2">
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-head"><span className="card-title">Portfolio Allocation</span></div>
              <div className="card-body">
                {Object.entries(alloc).map(([type, val]) => (
                  <div key={type} className="alloc-row">
                    <div style={{ width: 52, flexShrink: 0 }}><Badge type={type} /></div>
                    <div className="alloc-track">
                      <div className="alloc-fill" style={{ width: `${((val / allocationBase) * 100).toFixed(1)}%`, background: TBAR[type] ?? "#6366f1" }} />
                    </div>
                    <div style={{ width: 80, textAlign: "right", flexShrink: 0 }}>
                      <span className="mono" style={{ fontSize: 12 }}>{fmt(val)}</span>
                      <div style={{ fontSize: 10, color: "var(--dim)" }}>{((val / allocationBase) * 100).toFixed(1)}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>

          <div className="card">
            <div className="card-head">
              <span className="card-title">Holdings</span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{holds.length} positions · {fmt(grossValue)}</span>
            </div>
            <div className="mobile-holdings">
              {holds.slice(0, 6).map(h => (
                <div key={`${h.source ?? "stock"}-${h.ticker}-mobile-overview`} className="holding-card">
                  <div className="holding-top">
                    <div>
                      <div className="holding-symbol mono">{h.ticker}</div>
                      <div className="holding-name">{h.name}</div>
                    </div>
                    <div className="holding-value mono">{fmt(h.value)}</div>
                  </div>
                  <div className="holding-metrics">
                    <span><b>Return</b><em className={h.pnlPct >= 0 ? "g" : "r"}>{h.pnlPct >= 0 ? "+" : ""}{h.pnlPct.toFixed(2)}%</em></span>
                    <span><b>Shares</b><em>{h.shares.toFixed(4)}</em></span>
                    <span><b>Divs</b><em className="g">{fmt(h.divsEarned)}</em></span>
                  </div>
                </div>
              ))}
            </div>
            <div className="tscroll desktop-table">
              <table>
                <thead><tr>
                  {[
                    { l: "Ticker", c: "ticker", x: "" },
                    { l: "Name",   c: "name",   x: "hm" },
                    { l: "Type",   c: "type",   x: "hm" },
                    { l: "Shares", c: "shares", x: "hm" },
                    { l: "Avg Purchase", c: "avgCost", x: "hm" },
                    { l: "Current", c: "price",  x: "hm" },
                    { l: "Value",  c: "value",  x: "" },
                    { l: "Return", c: "pnlPct", x: "" },
                    { l: "Divs Earned", c: "divsEarned", x: "" },
                    { l: "Since",  c: "heldSince", x: "hm" },
                  ].map(({ l, c, x }) => (
                    <th key={c} className={x} onClick={() => sortBy(c)}>
                      {l}<SortArrow active={col === c} dir={dir} />
                    </th>
                  ))}
                </tr></thead>
                <tbody>
                  {holds.map(h => (
                    <tr key={`${h.source ?? "stock"}-${h.ticker}`}>
                      <td><span className="mono" style={{ fontWeight: 500 }}>{h.ticker}</span></td>
                      <td className="hm muted name-cell" title={h.name}>{h.name}</td>
                      <td className="hm"><Badge type={h.type} /></td>
                      <td className="hm mono">{h.shares.toFixed(4)}</td>
                      <td className="hm mono muted">${h.avgCost.toFixed(2)}</td>
                      <td className={`hm mono ${currentPriceClass(h)}`} style={{ fontWeight: 500 }}>${h.price.toFixed(2)}</td>
                      <td className="mono" style={{ fontWeight: 500 }}>{fmt(h.value)}</td>
                      <td className={`mono ${h.pnlPct >= 0 ? "g" : "r"}`}>{h.pnlPct >= 0 ? "+" : ""}{h.pnlPct.toFixed(2)}%</td>
                      <td className="mono g">{fmt(h.divsEarned)}</td>
                      <td className="hm muted">{h.heldSince}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr>
                  <td style={{ fontWeight: 500, fontSize: 12, color: "var(--muted)" }}>TOTAL ({holds.length})</td>
                  <td className="hm" /><td className="hm" /><td className="hm" /><td className="hm" /><td className="hm" />
                  <td className="mono" style={{ fontWeight: 600 }}>{fmt(grossValue)}</td>
                  <td className={`mono ${sum.pnlPct >= 0 ? "g" : "r"}`} style={{ fontWeight: 500 }}>
                    {sum.pnlPct >= 0 ? "+" : ""}{sum.pnlPct.toFixed(2)}%
                  </td>
                  <td className="mono g" style={{ fontWeight: 600 }}>{fmt(sum.divsEarned)}</td>
                  <td className="hm" />
                </tr></tfoot>
              </table>
            </div>
          </div>
        </>)}

        {/* Holdings tab */}
        {tab === "holdings" && (
          <div className="card">
            <div className="card-head">
              <span className="card-title">All Holdings</span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{holds.length} positions</span>
            </div>
            <div className="mobile-holdings">
              {holds.map(h => (
                <div key={`${h.source ?? "stock"}-${h.ticker}-mobile`} className="holding-card">
                  <div className="holding-top">
                    <div>
                      <div className="holding-symbol mono">{h.ticker}</div>
                      <div className="holding-name">{h.name}</div>
                    </div>
                    <div className="holding-value mono">{fmt(h.value)}</div>
                  </div>
                  <div className="holding-metrics">
                    <span><b>Return</b><em className={h.pnlPct >= 0 ? "g" : "r"}>{h.pnlPct >= 0 ? "+" : ""}{h.pnlPct.toFixed(2)}%</em></span>
                    <span><b>P&L</b><em className={h.pnl >= 0 ? "g" : "r"}>{h.pnl >= 0 ? "+" : ""}{fmt(h.pnl)}</em></span>
                    <span><b>Shares</b><em>{h.shares.toFixed(4)}</em></span>
                    <span><b>Current</b><em className={currentPriceClass(h)}>${h.price.toFixed(2)}</em></span>
                    <span><b>Divs</b><em className="g">{fmt(h.divsEarned)}</em></span>
                    <span><b>Since</b><em>{h.heldSince || "n/a"}</em></span>
                  </div>
                </div>
              ))}
            </div>
            <div className="tscroll desktop-table">
              <table>
                <thead><tr>
                  {hCols.map(({ l, c, x }) => (
                    <th key={c} className={x} onClick={() => sortBy(c)}>
                      {l}<SortArrow active={col === c} dir={dir} />
                    </th>
                  ))}
                </tr></thead>
                <tbody>
                  {holds.map(h => (
                    <tr key={`${h.source ?? "stock"}-${h.ticker}`}>
                      <td><span className="mono" style={{ fontWeight: 500 }}>{h.ticker}</span></td>
                      <td className="hm muted name-cell" title={h.name}>{h.name}</td>
                      <td className="hm"><Badge type={h.type} /></td>
                      <td className="hm mono">{h.shares.toFixed(4)}</td>
                      <td className="hm mono muted">${h.avgCost.toFixed(2)}</td>
                      <td className={`hm mono ${currentPriceClass(h)}`} style={{ fontWeight: 500 }}>${h.price.toFixed(2)}</td>
                      <td className="mono" style={{ fontWeight: 500 }}>{fmt(h.value)}</td>
                      <td className={`hm mono ${h.pnl >= 0 ? "g" : "r"}`}>{h.pnl >= 0 ? "+" : ""}{fmt(h.pnl)}</td>
                      <td className={`mono ${h.pnlPct >= 0 ? "g" : "r"}`}>{h.pnlPct >= 0 ? "+" : ""}{h.pnlPct.toFixed(2)}%</td>
                      <td className="mono g">{fmt(h.divsEarned)}</td>
                      <td className="hm muted">{h.heldSince}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr>
                  <td style={{ fontWeight: 500, fontSize: 12, color: "var(--muted)" }}>TOTAL ({holds.length})</td>
                  <td className="hm" /><td className="hm" /><td className="hm" /><td className="hm" /><td className="hm" />
                  <td className="mono" style={{ fontWeight: 600 }}>{fmt(grossValue)}</td>
                  <td className={`hm mono ${sum.pnl >= 0 ? "g" : "r"}`} style={{ fontWeight: 500 }}>
                    {sum.pnl >= 0 ? "+" : ""}{fmt(sum.pnl)}
                  </td>
                  <td className={`mono ${sum.pnlPct >= 0 ? "g" : "r"}`} style={{ fontWeight: 500 }}>
                    {sum.pnlPct >= 0 ? "+" : ""}{sum.pnlPct.toFixed(2)}%
                  </td>
                  <td className="mono g" style={{ fontWeight: 600 }}>{fmt(sum.divsEarned)}</td>
                  <td className="hm" />
                </tr></tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Calendar tab */}
        {tab === "calendar" && (
          <div className="g2" style={{ alignItems: "start" }}>
            {calGroups.map(([month, ds]) => (
              <div key={month} className="card" style={{ marginBottom: 0 }}>
                <div className="card-head">
                  <span className="card-title">{month}</span>
                  <span className="mono g" style={{ fontWeight: 500, fontSize: 13 }}>{fmt(ds.reduce((s, d) => s + d.amount, 0))}</span>
                </div>
                {ds.map(d => (
                  <div key={d.symbol + d.payableDate} className="div-row calendar-row">
                    <span className="mono muted" style={{ fontSize: 11, width: 24, textAlign: "right", flexShrink: 0 }}>
                      {localPayableDate(d.payableDate).getDate()}
                    </span>
                    <span className="div-dot" style={{ background: "var(--green)", opacity: 0.7 }} />
                    <div className="calendar-main">
                      <span className="mono" style={{ fontWeight: 500 }}>{d.symbol}</span>
                      <div className="calendar-mobile-meta">
                        <Badge type={(META[d.symbol] ?? {}).type ?? "Stock"} />
                        <Pill state={d.state} />
                      </div>
                    </div>
                    <Badge type={(META[d.symbol] ?? {}).type ?? "Stock"} />
                    <span className="mono calendar-amount" style={{ fontWeight: 500 }}>{fmt(d.amount)}</span>
                    <Pill state={d.state} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Income tab */}
        {tab === "income" && (<>
          <div className="card">
            <div className="card-head"><span className="card-title">Monthly Dividend Income</span></div>
            {monthly.length > 0
              ? <div className="inc-bars">
                  {monthly.map(({ label, v }) => {
                    const pct = v / Math.max(...monthly.map(d => d.v));
                    return (
                      <div key={label} className="inc-col">
                        <span style={{ fontSize: 9, color: "var(--muted)", fontFamily: "var(--mono)" }}>{fmtS(v)}</span>
                        <div className="inc-bar" style={{ height: `${pct * 100}px` }} />
                        <span style={{ fontSize: 9, color: "var(--muted)" }}>{label}</span>
                      </div>
                    );
                  })}
                </div>
              : <div className="card-body muted">No income data yet</div>
            }
          </div>

          <div className="g2">
            <div className="income-metrics">
              {([
                ["Last 30d Income",      fmt(trailing30d)],
                ["Projected Annual",     fmt(projectedAnnual)],
                ["Trailing Run Rate",    fmt(trailingAnnual)],
                ["Total Divs Earned",    fmt(sum.divsEarned)],
                ["Daily Cost of Living", `${fmt(sum.dailyCost)}/day · ${sum.daysOfFreedom} days covered`],
              ] as [string, string][]).map(([lbl, val]) => (
                <div key={lbl} className="card income-metric-card">
                  <div className="card-body income-metric-body">
                    <div className="stat-lbl">{lbl}</div>
                    <div className="mono income-metric-value">{val}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-head"><span className="card-title">Dividends by Position</span></div>
              <div className="card-body income-position-list">
                {[...raw].sort((a, b) => b.divsEarned - a.divsEarned).filter(h => h.divsEarned > 0).map(h => (
                  <div key={h.symbol} className="income-position-row">
                    <div className="income-position-head">
                      <span className="mono">{h.symbol}</span>
                      <span className="mono">{fmt(h.divsEarned)}</span>
                    </div>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${(h.divsEarned / sum.divsEarned) * 100}%`, opacity: 0.8 }} /></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>)}

        {/* Spending tab */}
        {tab === "spending" && (<>
          {!spend
            ? <div className="card"><div className="card-body muted">Spending account data unavailable.</div></div>
            : (<>
              <div className="stats spending-stats">
                {([
                  ["Portfolio Cash",           fmt(spend.uninvestedCash),   null],
                  ["Available for Withdrawal", fmt(spend.withdrawableCash), null],
                  ["30d Card Spending",        fmt(spend.spent30d),         "r"],
                ] as [string, string, string | null][]).map(([lbl, val, cls]) => (
                  <div key={lbl} className="stat">
                    <div className="stat-lbl">{lbl}</div>
                    <div className={`stat-val ${cls ?? ""}`}>{val}</div>
                  </div>
                ))}
              </div>

              <div className="card">
                <div className="card-head">
                  <span className="card-title">Card Transactions</span>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{spend.transactions.length} settled</span>
                </div>
                <div className="mobile-transactions">
                  {spend.transactions.map((t, i) => (
                    <div key={i} className="transaction-card">
                      <div>
                        <div className="transaction-date mono">{t.date}</div>
                        <div className="transaction-meta">{t.direction} · {t.state}</div>
                      </div>
                      <div className={`transaction-amount mono ${t.direction === "debit" ? "r" : "g"}`}>
                        {t.direction === "debit" ? "-" : "+"}{fmt(t.amount)}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="tscroll desktop-table">
                  <table>
                    <thead><tr>
                      <th>Date</th><th>Amount</th><th>Direction</th><th>State</th>
                    </tr></thead>
                    <tbody>
                      {spend.transactions.map((t, i) => (
                        <tr key={i}>
                          <td className="mono muted">{t.date}</td>
                          <td className={`mono ${t.direction === "debit" ? "r" : "g"}`}>
                            {t.direction === "debit" ? "-" : "+"}{fmt(t.amount)}
                          </td>
                          <td className="muted">{t.direction}</td>
                          <td className="muted">{t.state}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>)
          }
        </>)}

      </main>
    </div>
  );
}
