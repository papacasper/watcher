import React, { useState } from "react";
import type { DashboardData, Holding, MarketCalendarEvent, PortfolioGuardrail } from "./types.js";
import { Badge, Chart, META, Pill, SortArrow, TBAR } from "./components.js";
import type { DividendIncomeMode } from "./dividends.js";
import { monthlyDividendBuckets } from "./dividends.js";
import { fmt, fmtS } from "./format.js";
import { localPayableDate } from "./utils.js";

type HoldingEx = Holding & { ticker: string; type: string };

function currentPriceClass(holding: HoldingEx): string {
  if (holding.avgCost <= 0 || holding.price === holding.avgCost) return "";
  return holding.price > holding.avgCost ? "g" : "r";
}

export interface StatsStripProps {
  sum: DashboardData["summary"];
  trailing30d: number;
  projectedAnnual: number;
  trailingAnnual: number;
  yoc: number;
  lifetimeYoc: number;
  grossValue: number;
  freePct: number;
  upcomingPayout: number;
  upcoming: DashboardData["dividends"];
}

export function StatsStrip({ sum, trailing30d, projectedAnnual, trailingAnnual, yoc, lifetimeYoc, grossValue, freePct, upcomingPayout, upcoming }: StatsStripProps) {
  const totalRet    = sum.pnl + sum.divsEarned;
  const totalRetPct = sum.totalCost > 0 ? (totalRet / sum.totalCost) * 100 : 0;
  const netValue    = sum.netLiquidationValue ?? sum.totalValue;
  const recon       = sum.reconciliation;
  const netAdj      = recon?.netAdjustment ?? (netValue - grossValue);

  return (
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
          <span style={{ fontSize: 11, color: "var(--dim)" }}>positions {fmt(grossValue)} · net adjustment {fmt(netAdj)}</span>
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
        <div className="stat-sub">{sum.daysOfFreedom} target days covered</div>
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

    </div>
  );
}

const GUARDRAIL_ICON: Record<string, string> = {
  danger: "fa-solid fa-triangle-exclamation",
  warning: "fa-solid fa-circle-exclamation",
  info: "fa-solid fa-circle-info",
};

const GUARDRAIL_COLOR: Record<string, string> = {
  danger: "var(--red)",
  warning: "#f59e0b",
  info: "var(--muted)",
};

export function GuardrailsCard({ guardrails }: { guardrails: PortfolioGuardrail[] }) {
  const [infoExpanded, setInfoExpanded] = useState(false);
  const hasHighSeverity = guardrails.some(g => g.severity === "danger" || g.severity === "warning");
  const infoItems = guardrails.filter(g => g.severity === "info");
  const primaryItems = guardrails.filter(g => g.severity !== "info");
  const showInfo = !hasHighSeverity || infoExpanded;

  return (
    <div className="card guardrails-card">
      <div className="card-head">
        <span className="card-title">Guardrails</span>
        {guardrails.length > 0 && (
          <span className="mono" style={{ fontSize: 12, color: guardrails.some(g => g.severity === "danger") ? "var(--red)" : guardrails.some(g => g.severity === "warning") ? "#f59e0b" : "var(--muted)" }}>
            {guardrails.length} issue{guardrails.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      {guardrails.length === 0 ? (
        <div className="card-body muted" style={{ fontSize: 12 }}>No guardrail issues detected from current data.</div>
      ) : (
        <div className="guardrails-list">
          {primaryItems.map(g => (
            <div key={g.id} className="guardrail-row">
              <i className={GUARDRAIL_ICON[g.severity]} style={{ color: GUARDRAIL_COLOR[g.severity], flexShrink: 0, marginTop: 2 }} />
              <div className="guardrail-body">
                <div className="guardrail-title">{g.title}</div>
                <div className="guardrail-detail">{g.detail}</div>
                {g.symbols && g.symbols.length > 0 && (
                  <div className="guardrail-symbols">
                    {g.symbols.map(s => <span key={s} className="mono guardrail-sym">{s}</span>)}
                  </div>
                )}
              </div>
            </div>
          ))}
          {infoItems.length > 0 && hasHighSeverity && (
            <button type="button" className="guardrail-info-toggle" onClick={() => setInfoExpanded(v => !v)}>
              {infoExpanded ? "Hide" : "Show"} {infoItems.length} info note{infoItems.length !== 1 ? "s" : ""}
            </button>
          )}
          {showInfo && infoItems.map(g => (
            <div key={g.id} className="guardrail-row">
              <i className={GUARDRAIL_ICON.info} style={{ color: GUARDRAIL_COLOR.info, flexShrink: 0, marginTop: 2 }} />
              <div className="guardrail-body">
                <div className="guardrail-title">{g.title}</div>
                <div className="guardrail-detail">{g.detail}</div>
                {g.symbols && g.symbols.length > 0 && (
                  <div className="guardrail-symbols">
                    {g.symbols.map(s => <span key={s} className="mono guardrail-sym">{s}</span>)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface OverviewTabProps {
  holds: HoldingEx[];
  divs: DashboardData["dividends"];
  alloc: Record<string, number>;
  allocationBase: number;
  upcoming: DashboardData["dividends"];
  upcomingPayout: number;
  grossValue: number;
  sum: DashboardData["summary"];
  guardrails: PortfolioGuardrail[];
  incomeMode: DividendIncomeMode;
  setIncomeMode: (m: DividendIncomeMode) => void;
  col: string;
  dir: number;
  sortBy: (c: string) => void;
}

export function OverviewTab({ holds, divs, alloc, allocationBase, upcoming, upcomingPayout, grossValue, sum, guardrails, incomeMode, setIncomeMode, col, dir, sortBy }: OverviewTabProps) {
  return (<>
    <GuardrailsCard guardrails={guardrails} />

    <div className="card payout-card">
      <div className="card-head">
        <span className="card-title">Upcoming · Next 30 days</span>
        <span className="mono g" style={{ fontSize: 13, fontWeight: 500 }}>{fmt(upcomingPayout)}</span>
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
        <div className="segmented-control" aria-label="Dividend income mode">
          <button type="button" className={incomeMode === "realized" ? "active" : ""} onClick={() => setIncomeMode("realized")}>Realized</button>
          <button type="button" className={incomeMode === "cash" ? "active" : ""} onClick={() => setIncomeMode("cash")}>Cash</button>
        </div>
      </div>
      <div className="chart-wrap" style={{ paddingLeft: 0, paddingRight: 0 }}><Chart dividends={divs} mode={incomeMode} /></div>
      <div className="chart-note">
        {incomeMode === "realized"
          ? "Realized income includes paid and reinvested dividends."
          : "Cash payouts include paid dividends only."}
      </div>
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
  </>);
}

export interface HoldingsTabProps {
  holds: HoldingEx[];
  grossValue: number;
  sum: DashboardData["summary"];
  col: string;
  dir: number;
  sortBy: (c: string) => void;
}

const H_COLS = [
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

export function HoldingsTab({ holds, grossValue, sum, col, dir, sortBy }: HoldingsTabProps) {
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">All Holdings</span>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{holds.length} positions</span>
          <a href="/api/export/holdings.csv" download className="export-btn"><i className="fa-solid fa-download" /> CSV</a>
        </div>
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
            {H_COLS.map(({ l, c, x }) => (
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
  );
}

const EVENT_ICON: Record<string, string> = {
  jobs:  "fa-solid fa-briefcase",
  cpi:   "fa-solid fa-receipt",
  fomc:  "fa-solid fa-landmark",
};

const EVENT_COLOR: Record<string, string> = {
  jobs:  "#60a5fa",
  cpi:   "#f59e0b",
  fomc:  "#a78bfa",
};

export function MarketEventsCard({ events }: { events: MarketCalendarEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="card-head">
        <span className="card-title">Upcoming Market Events</span>
        <span className="mono muted" style={{ fontSize: 12 }}>{events.length} events</span>
      </div>
      {events.map((ev, i) => (
        <div key={i} className="div-row">
          <span className="mono muted" style={{ fontSize: 11, width: 36, textAlign: "right", flexShrink: 0 }}>
            {new Date(ev.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
          <i
            className={EVENT_ICON[ev.type] ?? "fa-solid fa-calendar"}
            style={{ color: EVENT_COLOR[ev.type] ?? "var(--muted)", fontSize: 11, width: 14, textAlign: "center", flexShrink: 0 }}
          />
          <span style={{ flex: 1, fontSize: 13 }}>{ev.label}</span>
          <span className="mono muted" style={{ fontSize: 11 }}>+{ev.days_away}d</span>
        </div>
      ))}
    </div>
  );
}

export interface CalendarTabProps {
  calGroups: [string, DashboardData["dividends"]][];
  marketEvents: MarketCalendarEvent[];
}

export function CalendarTab({ calGroups, marketEvents }: CalendarTabProps) {
  return (<>
    <MarketEventsCard events={marketEvents} />
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
      <a href="/api/export/dividends.csv" download className="export-btn"><i className="fa-solid fa-download" /> Export CSV</a>
    </div>
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
  </>);
}

export interface IncomeTabProps {
  divs: DashboardData["dividends"];
  sum: DashboardData["summary"];
  incomeMode: DividendIncomeMode;
  setIncomeMode: (m: DividendIncomeMode) => void;
  trailing30d: number;
  projectedAnnual: number;
  trailingAnnual: number;
  projectedDaily: number;
  dividendTargetDaily: number;
  dividendTargetAnnual: number;
  dividendGoalProgressPct: number;
  dividendIncomeGapDaily: number;
  dividendIncomeGapAnnual: number;
  capitalRequiredAtCurrentYield: number | null;
  incomePositions: Holding[];
}

export function IncomeTab({
  divs, sum, incomeMode, setIncomeMode,
  trailing30d, projectedAnnual, trailingAnnual, projectedDaily,
  dividendTargetDaily, dividendTargetAnnual, dividendGoalProgressPct,
  dividendIncomeGapDaily, dividendIncomeGapAnnual, capitalRequiredAtCurrentYield,
  incomePositions,
}: IncomeTabProps) {
  const monthly = monthlyDividendBuckets(divs, incomeMode);

  return (<>
    <div className="card dividend-goal-card">
      <div className="card-head">
        <span className="card-title">Dividend Goal</span>
        <span className="mono muted">{dividendGoalProgressPct.toFixed(1)}%</span>
      </div>
      <div className="card-body dividend-goal-body">
        <div className="dividend-goal-main">
          <div>
            <div className="stat-lbl">Projected Daily Income</div>
            <div className="mono dividend-goal-value">{fmt(projectedDaily)}<span>/day</span></div>
          </div>
          <div className="mono dividend-goal-target">of {fmt(dividendTargetDaily)}/day</div>
        </div>
        <div className="bar-track dividend-goal-track">
          <div className="bar-fill" style={{ width: `${Math.min(dividendGoalProgressPct, 100)}%` }} />
        </div>
        <div className="dividend-goal-grid">
          <div>
            <div className="stat-lbl">Annual Income</div>
            <div className="mono">{fmt(projectedAnnual)} / {fmt(dividendTargetAnnual)}</div>
          </div>
          <div>
            <div className="stat-lbl">Daily Gap</div>
            <div className="mono">{fmt(dividendIncomeGapDaily)}/day</div>
          </div>
          <div>
            <div className="stat-lbl">Annual Gap</div>
            <div className="mono">{fmt(dividendIncomeGapAnnual)}</div>
          </div>
          <div>
            <div className="stat-lbl">Capital Needed</div>
            <div className="mono">{capitalRequiredAtCurrentYield != null ? fmt(capitalRequiredAtCurrentYield) : "—"}</div>
          </div>
        </div>
      </div>
    </div>

    <div className="card">
      <div className="card-head">
        <span className="card-title">Monthly Dividend Income</span>
        <div className="segmented-control" aria-label="Monthly dividend income mode">
          <button type="button" className={incomeMode === "realized" ? "active" : ""} onClick={() => setIncomeMode("realized")}>Realized</button>
          <button type="button" className={incomeMode === "cash" ? "active" : ""} onClick={() => setIncomeMode("cash")}>Cash</button>
        </div>
      </div>
      {monthly.length > 0
        ? <div className="chart-wrap" style={{ paddingLeft: 0, paddingRight: 0 }}><Chart dividends={divs} mode={incomeMode} /></div>
        : <div className="card-body muted">No income data yet</div>
      }
      <div className="chart-note">
        {incomeMode === "realized"
          ? "Realized income includes paid and reinvested dividends."
          : "Cash payouts include paid dividends only."}
      </div>
    </div>

    <div className="g2">
      <div className="income-metrics">
        {([
          ["Last 30d Income",      fmt(trailing30d)],
          ["Projected Annual",     fmt(projectedAnnual)],
          ["Trailing Run Rate",    fmt(trailingAnnual)],
          ["Total Divs Earned",    fmt(sum.divsEarned)],
          ["Daily Dividend Target", `${fmt(dividendTargetDaily)}/day · ${sum.daysOfFreedom} days covered`],
          ["Daily Cost of Living", `${fmt(sum.dailyCost)}/day`],
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
          {incomePositions.length > 0
            ? incomePositions.map(h => (
              <div key={h.symbol} className="income-position-row">
                <div className="income-position-head">
                  <span className="mono">{h.symbol}</span>
                  <span className="mono">{fmt(h.forwardAnnualIncome)} / yr</span>
                </div>
                <div className="income-position-sub">
                  <span>{fmt(h.forwardDailyIncome)}/day</span>
                  <span>{(h.forwardYieldOnValue ?? 0).toFixed(2)}% forward yield</span>
                </div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(h.forwardIncomePct ?? 0, 100)}%`, opacity: 0.8 }} /></div>
              </div>
            ))
            : <div className="muted">No forward dividend income projected yet</div>
          }
        </div>
      </div>
    </div>
  </>);
}

