import React, { useState, useEffect, useCallback, useRef, useId } from "react";
import { addWatchlistTicker, apiGet, getWatchlist, removeWatchlistTicker } from "./api.js";
import { fmt } from "./format.js";
import type { Holding, TickerOverview, TickerDividendEntry, TickerDividends, PricePoint, TickerPriceHistory, ResearchData } from "./types.js";

interface GoalContext {
  currentForwardAnnual: number;
  dividendTargetAnnual: number;
  currentValue: number;
}

interface CompareEntry {
  overview: TickerOverview;
  dividends: TickerDividends | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function dividendConsistency(history: TickerDividendEntry[], frequency: string) {
  if (history.length < 3) return { label: "Insufficient history", color: "var(--muted)", detail: "" };
  const periodsPerYear = frequency === "Monthly" ? 12 : frequency === "Semi-Monthly" ? 24 : 4;
  const amounts = history.map(h => h.amount);
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  let cuts = 0;
  for (let i = 0; i < amounts.length - periodsPerYear; i++) {
    if (amounts[i]! < amounts[i + periodsPerYear]! * 0.95) cuts++;
  }
  const allSame = max - min < 0.0001;
  if (cuts === 0 && allSame) return { label: "Very consistent", color: "var(--green)", detail: `$${min.toFixed(4)}/share every payment` };
  if (cuts === 0) return { label: "Growing", color: "var(--green)", detail: `Range $${min.toFixed(4)}–$${max.toFixed(4)}, no cuts` };
  if (cuts <= 1) return { label: "Minor variation", color: "var(--olive)", detail: `${cuts} year-over-year cut` };
  return { label: "Variable", color: "var(--red)", detail: `${cuts} year-over-year cuts` };
}

function dividendCAGR(history: TickerDividendEntry[], frequency: string, years: number): number | null {
  if (history.length < 4) return null;
  const periodsPerYear = frequency === "Monthly" ? 12 : frequency === "Semi-Monthly" ? 24 : 4;
  const needed = periodsPerYear * years;
  if (history.length < needed + periodsPerYear) return null;
  const recent = history.slice(0, periodsPerYear).reduce((s, h) => s + h.amount, 0);
  const base = history.slice(needed, needed + periodsPerYear).reduce((s, h) => s + h.amount, 0);
  if (base <= 0) return null;
  return Math.pow(recent / base, 1 / years) - 1;
}

function computeMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  return prices.slice(prices.length - period).reduce((s, v) => s + v, 0) / period;
}

function computeRSI(prices: number[], period = 14): number | null {
  if (prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const d = prices[i]! - prices[i - 1]!;
    if (d > 0) gains += d; else losses -= d;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - 100 / (1 + rs);
}

function goalImpact(overview: TickerOverview, dividends: TickerDividends, shares: number, goal: GoalContext) {
  const annualPerShare = parseFloat(dividends.annual.replace(/[$,]/g, "")) || 0;
  const addedAnnualIncome = shares * annualPerShare;
  const addedValue = shares * overview.price;
  const newForwardAnnual = goal.currentForwardAnnual + addedAnnualIncome;
  const newPortfolioValue = goal.currentValue + addedValue;
  const newBlendedYield = newPortfolioValue > 0 ? newForwardAnnual / newPortfolioValue : 0;
  const incomeGap = Math.max(goal.dividendTargetAnnual - newForwardAnnual, 0);
  const newCapitalNeeded = newBlendedYield > 0 ? incomeGap / newBlendedYield : null;
  return { addedAnnualIncome, addedValue, newCapitalNeeded, newForwardAnnual };
}

function projectPayments(dividends: TickerDividends): Array<{ date: string; amount: number }> {
  if (!dividends.exDiv || dividends.history.length === 0) return [];
  const freq = dividends.frequency;
  const monthsPerPeriod = freq === "Monthly" ? 1 : freq === "Semi-Monthly" ? 0.5 : freq === "Quarterly" ? 3 : freq === "Semi-Annual" ? 6 : freq === "Annual" ? 12 : 3;
  const recentAmount = dividends.history[0]?.amount ?? 0;
  if (recentAmount <= 0) return [];

  const base = new Date(dividends.exDiv);
  if (isNaN(base.getTime())) return [];
  const result: Array<{ date: string; amount: number }> = [];
  const now = new Date();
  const cutoff = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  const maxPeriods = Math.ceil(12 / monthsPerPeriod) + 2;

  for (let i = 0; i < maxPeriods; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + Math.round(i * monthsPerPeriod * 30.44));
    if (d < now) continue;
    if (d > cutoff) break;
    result.push({ date: d.toISOString().slice(0, 10), amount: recentAmount });
  }
  return result;
}

function fmtVol(v: number): string {
  if (!v) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

function rsiColor(rsi: number): string {
  if (rsi >= 70) return "var(--red)";
  if (rsi <= 30) return "var(--green)";
  return "var(--txt)";
}

function rsiLabel(rsi: number): string {
  if (rsi >= 70) return "Overbought";
  if (rsi >= 55) return "Bullish";
  if (rsi <= 30) return "Oversold";
  if (rsi <= 45) return "Bearish";
  return "Neutral";
}

const NOTES_KEY = "watcher-research-notes";
function loadNotes(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(NOTES_KEY) ?? "{}") as Record<string, string>; } catch { return {}; }
}
function saveNotes(notes: Record<string, string>) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

// ── Sub-components ───────────────────────────────────────────────────────────

function PriceSparkline({ points, price, low52, high52 }: { points: PricePoint[]; price: number; low52: number; high52: number }) {
  if (points.length < 5) {
    // Fallback: 52-week range bar
    const pct = high52 > low52 ? ((price - low52) / (high52 - low52)) * 100 : 50;
    return (
      <div className="sparkline-range-wrap">
        <div className="sparkline-range-labels">
          <span>{fmt(low52)}</span>
          <span className="sparkline-range-label-mid">52-week range</span>
          <span>{fmt(high52)}</span>
        </div>
        <div className="sparkline-range-track">
          <div className="sparkline-range-fill" style={{ width: `${pct.toFixed(1)}%` }} />
          <div className="sparkline-range-dot" style={{ left: `${pct.toFixed(1)}%` }} />
        </div>
      </div>
    );
  }

  const W = 600, H = 72;
  const closes = points.map(p => p.close);
  const mn = Math.min(...closes), mx = Math.max(...closes);
  const range = mx - mn || 1;
  const pad = range * 0.06;
  const lo = mn - pad, hi = mx + pad + pad;
  const toY = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const toX = (i: number) => (i / (closes.length - 1)) * W;

  const line = closes.map((c, i) => `${toX(i).toFixed(1)},${toY(c).toFixed(1)}`).join(" ");
  const area = `0,${H} ` + closes.map((c, i) => `${toX(i).toFixed(1)},${toY(c).toFixed(1)}`).join(" ") + ` ${W},${H}`;

  const ma50 = computeMA(closes, 50);
  const ma200 = computeMA(closes, 200);

  const maLine = (ma: number | null, period: number): string => {
    if (!ma) return "";
    const pts: string[] = [];
    for (let i = period - 1; i < closes.length; i++) {
      const m = closes.slice(i - period + 1, i + 1).reduce((s, v) => s + v, 0) / period;
      pts.push(`${toX(i).toFixed(1)},${toY(m).toFixed(1)}`);
    }
    return pts.join(" ");
  };

  const isUp = closes[closes.length - 1]! >= closes[0]!;

  return (
    <div className="sparkline-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="sparkline-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isUp ? "var(--green)" : "var(--red)"} stopOpacity="0.18" />
            <stop offset="100%" stopColor={isUp ? "var(--green)" : "var(--red)"} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#spark-grad)" />
        <polyline points={line} fill="none" stroke={isUp ? "var(--green)" : "var(--red)"} strokeWidth="1.5" strokeLinejoin="round" />
        {ma50 && maLine(ma50, 50) && (
          <polyline points={maLine(ma50, 50)} fill="none" stroke="var(--olive)" strokeWidth="1" strokeDasharray="3,2" />
        )}
        {ma200 && maLine(ma200, 200) && (
          <polyline points={maLine(ma200, 200)} fill="none" stroke="var(--muted)" strokeWidth="1" strokeDasharray="5,3" />
        )}
      </svg>
      <div className="sparkline-legend">
        <span style={{ color: isUp ? "var(--green)" : "var(--red)" }}>● Price</span>
        {ma50 && <span style={{ color: "var(--olive)" }}>- - MA50</span>}
        {ma200 && <span style={{ color: "var(--muted)" }}>— MA200</span>}
      </div>
    </div>
  );
}

function SectionBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="research-section">
      <div className="research-section-title">{title}</div>
      {children}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ResearchTabProps {
  goal: GoalContext;
  holds: (Holding & { ticker: string; type: string })[];
  grossValue: number;
  forwardAnnualIncome: number;
}

export function ResearchTab({ goal, holds, grossValue, forwardAnnualIncome }: ResearchTabProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<{ symbol: string; name: string; type: string }[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestIdx, setSuggestIdx] = useState(-1);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const [shares, setShares] = useState("10");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<TickerOverview | null>(null);
  const [dividends, setDividends] = useState<TickerDividends | null>(null);
  const [history, setHistory] = useState<TickerPriceHistory | null>(null);
  const [research, setResearch] = useState<ResearchData | null>(null);
  const [compareList, setCompareList] = useState<CompareEntry[]>([]);
  const [notesMap, setNotesMap] = useState<Record<string, string>>(() => loadNotes());
  const [showFullHistory, setShowFullHistory] = useState(false);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [watchBusy, setWatchBusy] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);

  useEffect(() => {
    getWatchlist().then(setWatchlist).catch(() => {});
  }, []);

  async function toggleWatch(sym: string) {
    if (watchBusy) return;
    setWatchBusy(true);
    setWatchError(null);
    try {
      if (watchlist.includes(sym)) {
        const next = await removeWatchlistTicker(sym);
        setWatchlist(next);
      } else {
        const next = await addWatchlistTicker(sym);
        setWatchlist(next);
      }
    } catch (err) {
      setWatchError(err instanceof Error ? err.message : "Failed to update watchlist");
    } finally {
      setWatchBusy(false);
    }
  }

  async function removeFromWatchlistChip(sym: string) {
    if (watchBusy) return;
    setWatchBusy(true);
    setWatchError(null);
    try {
      const next = await removeWatchlistTicker(sym);
      setWatchlist(next);
    } catch { /* chip remove failures are non-critical, no error shown */ } finally {
      setWatchBusy(false);
    }
  }

  const currentSymbol = overview?.symbol ?? "";
  const note = notesMap[currentSymbol] ?? "";

  const updateNote = useCallback((sym: string, val: string) => {
    setNotesMap(prev => {
      const next = { ...prev, [sym]: val };
      saveNotes(next);
      return next;
    });
  }, []);

  function handleQueryChange(val: string) {
    setQuery(val);
    setSuggestIdx(-1);
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (!val.trim()) { setSuggestions([]); setSuggestOpen(false); return; }
    suggestTimer.current = setTimeout(async () => {
      try {
        const res = await apiGet(`/api/search?q=${encodeURIComponent(val.trim())}`);
        if (!res.ok) return;
        const json = await res.json() as { results: { symbol: string; name: string; type: string }[] };
        setSuggestions(json.results ?? []);
        setSuggestOpen((json.results ?? []).length > 0);
      } catch { /* ignore */ }
    }, 220);
  }

  useEffect(() => {
    return () => { if (suggestTimer.current) clearTimeout(suggestTimer.current); };
  }, []);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setSuggestOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  async function searchSymbol(sym: string) {
    setSuggestOpen(false);
    setSuggestions([]);
    setQuery(sym);
    setLoading(true);
    setError(null);
    setOverview(null);
    setDividends(null);
    setHistory(null);
    setResearch(null);
    setShowFullHistory(false);
    try {
      const [ovRes, divRes, histRes, resRes] = await Promise.all([
        apiGet(`/api/ticker/${sym}`),
        apiGet(`/api/ticker/${sym}/dividends`),
        apiGet(`/api/ticker/${sym}/history`),
        apiGet(`/api/ticker/${sym}/research`),
      ]);
      if (!ovRes.ok) throw new Error(`No data found for ${sym}`);
      const [ov, div, hist, res] = await Promise.all([
        ovRes.json(),
        divRes.ok ? divRes.json() : null,
        histRes.ok ? histRes.json() : null,
        resRes.ok ? resRes.json() : null,
      ]);
      setOverview(ov as TickerOverview);
      setDividends(div as TickerDividends | null);
      setHistory(hist as TickerPriceHistory | null);
      setResearch(res as ResearchData | null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const val = query.trim();
    if (!val) return;
    // If it looks like a ticker (≤6 chars, no spaces), use directly
    if (/^[A-Z0-9.]{1,6}$/i.test(val)) {
      await searchSymbol(val.toUpperCase());
    } else if (suggestions.length > 0) {
      await searchSymbol(suggestions[suggestIdx >= 0 ? suggestIdx : 0]!.symbol);
    } else {
      // Try to resolve via search
      try {
        const res = await apiGet(`/api/search?q=${encodeURIComponent(val)}`);
        const json = res.ok ? await res.json() as { results: { symbol: string }[] } : { results: [] };
        if (json.results.length > 0) {
          await searchSymbol(json.results[0]!.symbol);
        } else {
          await searchSymbol(val.toUpperCase());
        }
      } catch {
        await searchSymbol(val.toUpperCase());
      }
    }
  }

  function addToCompare() {
    if (!overview) return;
    if (compareList.find(c => c.overview.symbol === overview.symbol)) return;
    setCompareList(prev => [...prev.slice(-2), { overview, dividends }]);
  }

  function removeFromCompare(sym: string) {
    setCompareList(prev => prev.filter(c => c.overview.symbol !== sym));
  }

  const sharesNum = parseInt(shares, 10) || 0;
  const impact = overview && dividends && sharesNum > 0 ? goalImpact(overview, dividends, sharesNum, goal) : null;
  const consistency = dividends ? dividendConsistency(dividends.history, dividends.frequency) : null;
  const changePos = (overview?.changePct ?? 0) >= 0;

  const closes = history?.points.map(p => p.close) ?? [];
  const ma50 = computeMA(closes, 50);
  const ma200 = computeMA(closes, 200);
  const rsi = computeRSI(closes);

  const cagr1 = dividends ? dividendCAGR(dividends.history, dividends.frequency, 1) : null;
  const cagr3 = dividends ? dividendCAGR(dividends.history, dividends.frequency, 3) : null;
  const cagr5 = dividends ? dividendCAGR(dividends.history, dividends.frequency, 5) : null;

  const projectedPayments = dividends ? projectPayments(dividends) : [];

  // Portfolio fit
  const existingHolding = holds.find(h => h.symbol === currentSymbol);
  const positionValue = overview ? sharesNum * overview.price : 0;
  const newGrossValue = grossValue + positionValue;
  const positionPct = newGrossValue > 0 ? (positionValue / newGrossValue) * 100 : 0;
  const annualPerShare = dividends ? parseFloat(dividends.annual.replace(/[$,]/g, "")) || 0 : 0;
  const addedIncome = sharesNum * annualPerShare;
  const newTotalIncome = forwardAnnualIncome + addedIncome;
  const incomePct = newTotalIncome > 0 ? (addedIncome / newTotalIncome) * 100 : 0;

  const fitFlags: Array<{ label: string; color: string }> = [];
  if (positionPct > 25) fitFlags.push({ label: `Position would be ${positionPct.toFixed(1)}% of portfolio (>25% threshold)`, color: "var(--red)" });
  else if (positionPct > 15) fitFlags.push({ label: `Position would be ${positionPct.toFixed(1)}% of portfolio`, color: "var(--olive)" });
  if (incomePct > 30) fitFlags.push({ label: `Would supply ${incomePct.toFixed(1)}% of income (>30% threshold)`, color: "var(--red)" });
  else if (incomePct > 20) fitFlags.push({ label: `Would supply ${incomePct.toFixed(1)}% of income`, color: "var(--olive)" });
  const dividendYieldNum = overview ? parseFloat(String(dividends?.yield ?? overview.dividendYield).replace(/%/g, "")) : 0;
  if (dividendYieldNum > 12) fitFlags.push({ label: `High yield (${dividendYieldNum.toFixed(1)}%) — sustainability risk`, color: "var(--red)" });
  if (fitFlags.length === 0 && overview) fitFlags.push({ label: "No concentration flags at this position size", color: "var(--green)" });

  const historyRows = dividends ? (showFullHistory ? dividends.history : dividends.history.slice(0, 12)) : [];

  const isWatched = watchlist.includes(currentSymbol);

  return (
    <div className="research-page">
      {/* Watchlist chips */}
      {watchlist.length > 0 && (
        <div className="watchlist-chips">
          <span className="watchlist-chips-label"><i className="fa-solid fa-eye" /> Watchlist</span>
          {watchlist.map(sym => (
            <div key={sym} className={`watchlist-chip${sym === currentSymbol ? " is-active" : ""}`}>
              <button
                className="watchlist-chip-ticker"
                type="button"
                onClick={() => searchSymbol(sym)}
              >{sym}</button>
              <button
                className="watchlist-chip-remove"
                type="button"
                aria-label={`Remove ${sym} from watchlist`}
                onClick={() => removeFromWatchlistChip(sym)}
              >×</button>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <form className="research-search" onSubmit={search}>
        <div className="research-search-wrap" ref={searchWrapRef}>
          <input
            className="research-input"
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            onKeyDown={e => {
              if (!suggestOpen || suggestions.length === 0) return;
              if (e.key === "ArrowDown") { e.preventDefault(); setSuggestIdx(i => Math.min(i + 1, suggestions.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSuggestIdx(i => Math.max(i - 1, 0)); }
              else if (e.key === "Escape") { setSuggestOpen(false); }
              else if (e.key === "Enter" && suggestIdx >= 0) { e.preventDefault(); void searchSymbol(suggestions[suggestIdx]!.symbol); }
            }}
            onFocus={() => suggestions.length > 0 && setSuggestOpen(true)}
            placeholder="Ticker or company name — e.g. AGNC or Apple"
            autoComplete="off"
          />
          {suggestOpen && suggestions.length > 0 && (
            <div className="research-suggest">
              {suggestions.map((s, i) => (
                <div
                  key={s.symbol}
                  className={`research-suggest-item${i === suggestIdx ? " is-active" : ""}`}
                  onPointerDown={e => { e.preventDefault(); void searchSymbol(s.symbol); }}
                >
                  <span className="research-suggest-symbol">{s.symbol}</span>
                  <span className="research-suggest-name">{s.name}</span>
                  <span className="research-suggest-type">{s.type}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="research-btn" type="submit" disabled={loading}>
          {loading ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-magnifying-glass" />}
          {loading ? "Looking up…" : "Look up"}
        </button>
      </form>

      {error && <div className="research-error"><i className="fa-solid fa-circle-exclamation" /> {error}</div>}

      {/* Compare panel — shown when ≥2 entries */}
      {compareList.length >= 1 && (
        <SectionBox title={`Compare (${compareList.length})`}>
          <div className="compare-table-wrap">
            <table className="compare-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  {compareList.map(c => (
                    <th key={c.overview.symbol}>
                      <span>{c.overview.symbol}</span>
                      <button className="compare-remove" onClick={() => removeFromCompare(c.overview.symbol)} title="Remove">×</button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Price", (e: CompareEntry) => fmt(e.overview.price)],
                    ["Yield", (e: CompareEntry) => e.dividends?.yield || e.overview.dividendYield || "—"],
                    ["Annual div", (e: CompareEntry) => e.dividends?.annual || "—"],
                    ["Frequency", (e: CompareEntry) => e.dividends?.frequency || "—"],
                    ["Market Cap", (e: CompareEntry) => e.overview.marketCap || "—"],
                    ["Beta", (e: CompareEntry) => e.overview.beta || "—"],
                    ["P/E", (e: CompareEntry) => e.overview.peRatio || "—"],
                    ["Fwd P/E", (e: CompareEntry) => e.overview.forwardPE || "—"],
                    ["Payout Ratio", (e: CompareEntry) => e.overview.payoutRatio || "—"],
                    ["52w Low", (e: CompareEntry) => fmt(e.overview.low52)],
                    ["52w High", (e: CompareEntry) => fmt(e.overview.high52)],
                  ] as Array<[string, (e: CompareEntry) => string]>
                ).map(([label, fn]) => (
                  <tr key={label}>
                    <td className="compare-label">{label}</td>
                    {compareList.map(c => <td key={c.overview.symbol} className="mono">{fn(c)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionBox>
      )}

      {overview && (
        <div className="research-results">

          {/* Header */}
          <div className="research-header">
            <div>
              <div className="research-symbol">{overview.symbol}</div>
              <div className="research-name">{overview.name}</div>
              <div className="research-meta">{overview.exchange} · {overview.type.toUpperCase()}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
              <div className="research-price-block">
                <div className="research-price">{fmt(overview.price)}</div>
                <div className="research-change" style={{ color: changePos ? "var(--green)" : "var(--red)" }}>
                  {changePos ? "+" : ""}{fmt(overview.change)} ({changePos ? "+" : ""}{overview.changePct.toFixed(2)}%)
                </div>
                <div className="research-range">52w {fmt(overview.low52)} – {fmt(overview.high52)}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button
                    className={`research-watch-btn${isWatched ? " is-watching" : ""}`}
                    onClick={() => toggleWatch(currentSymbol)}
                    disabled={watchBusy}
                    type="button"
                  >
                    <i className={watchBusy ? "fa-solid fa-spinner fa-spin" : isWatched ? "fa-solid fa-eye" : "fa-regular fa-eye"} />
                    {watchBusy ? "Saving…" : isWatched ? "Watching" : "Watch"}
                  </button>
                  <button className="research-compare-btn" onClick={addToCompare} disabled={!!compareList.find(c => c.overview.symbol === overview.symbol)}>
                    <i className="fa-solid fa-table-columns" />
                    {compareList.find(c => c.overview.symbol === overview.symbol) ? "In compare" : "Add to compare"}
                  </button>
                </div>
                {watchError && (
                  <div className="research-watch-error">
                    <i className="fa-solid fa-circle-exclamation" /> {watchError}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Sparkline */}
          <SectionBox title="Price chart (1 year)">
            <div style={{ padding: "16px 18px 10px" }}>
              <PriceSparkline
                points={history?.points ?? []}
                price={overview.price}
                low52={overview.low52}
                high52={overview.high52}
              />
            </div>
          </SectionBox>

          {/* Key stats */}
          <div className="research-stats">
            {([
              ["Dividend", overview.dividend || "—"],
              ["Yield", dividends?.yield || overview.dividendYield || "—"],
              ["Frequency", dividends?.frequency || "—"],
              ["Ex-Date", dividends?.exDiv || overview.exDividendDate || "—"],
              ["Market Cap", overview.marketCap || "—"],
              ["Beta", overview.beta || "—"],
              ["P/E", overview.peRatio || "—"],
              ...(overview.forwardPE ? [["Fwd P/E", overview.forwardPE]] : []),
              ...(overview.pbRatio ? [["P/B", overview.pbRatio]] : []),
              ...(overview.payoutRatio ? [["Payout", overview.payoutRatio]] : []),
              ...(overview.eps ? [["EPS", overview.eps]] : []),
              ...(overview.nextEarnings ? [["Next Earnings", overview.nextEarnings]] : []),
              ...(overview.analysts && overview.analysts !== "n/a" ? [["Analysts", overview.analysts], ["Target", overview.analystTarget]] : []),
            ] as [string, string][]).map(([label, value]) => (
              <div className="research-stat" key={label}>
                <div className="research-stat-lbl">{label}</div>
                <div className="research-stat-val">{value}</div>
              </div>
            ))}
          </div>

          {/* Technicals */}
          {(ma50 || ma200 || rsi !== null || overview.volume > 0) && (
            <SectionBox title="Technicals">
              <div className="research-technicals">
                {overview.volume > 0 && (
                  <div className="research-tech-item">
                    <div className="research-tech-lbl">Volume</div>
                    <div className="research-tech-val">{fmtVol(overview.volume)}</div>
                    {overview.avgVolume > 0 && (
                      <div className="research-tech-sub">avg {fmtVol(overview.avgVolume)}</div>
                    )}
                  </div>
                )}
                {ma50 !== null && (
                  <div className="research-tech-item">
                    <div className="research-tech-lbl">MA50</div>
                    <div className="research-tech-val mono">{fmt(ma50)}</div>
                    <div className="research-tech-sub" style={{ color: overview.price >= ma50 ? "var(--green)" : "var(--red)" }}>
                      {overview.price >= ma50 ? "↑ above" : "↓ below"}
                    </div>
                  </div>
                )}
                {ma200 !== null && (
                  <div className="research-tech-item">
                    <div className="research-tech-lbl">MA200</div>
                    <div className="research-tech-val mono">{fmt(ma200)}</div>
                    <div className="research-tech-sub" style={{ color: overview.price >= ma200 ? "var(--green)" : "var(--red)" }}>
                      {overview.price >= ma200 ? "↑ above" : "↓ below"}
                    </div>
                  </div>
                )}
                {rsi !== null && (
                  <div className="research-tech-item">
                    <div className="research-tech-lbl">RSI (14)</div>
                    <div className="research-tech-val mono" style={{ color: rsiColor(rsi) }}>{rsi.toFixed(1)}</div>
                    <div className="research-tech-sub" style={{ color: rsiColor(rsi) }}>{rsiLabel(rsi)}</div>
                  </div>
                )}
                {ma50 && ma200 && (
                  <div className="research-tech-item">
                    <div className="research-tech-lbl">Golden/Death</div>
                    <div className="research-tech-val" style={{ color: ma50 > ma200 ? "var(--green)" : "var(--red)" }}>
                      {ma50 > ma200 ? "Golden cross" : "Death cross"}
                    </div>
                    <div className="research-tech-sub">MA50 vs MA200</div>
                  </div>
                )}
              </div>
            </SectionBox>
          )}

          {/* Analyst Intelligence */}
          {research && (
            <SectionBox title="Analyst intelligence">
              <div className="ai-grid">
                {/* Consensus + Target */}
                {research.analystConsensus && (
                  <div className="ai-card ai-card--consensus">
                    <div className="ai-card-lbl">Consensus</div>
                    <div className={`ai-consensus-badge ai-consensus-badge--${research.analystConsensus.toLowerCase().replace(/\s+/g, "-")}`}>
                      {research.analystConsensus}
                    </div>
                    {research.priceTarget !== null && (
                      <div className="ai-target-row">
                        <span className="ai-target-price mono">${research.priceTarget.toFixed(2)}</span>
                        {research.priceTargetUpsidePct !== null && (
                          <span className={`ai-upside ${research.priceTargetUpsidePct >= 0 ? "ai-upside--pos" : "ai-upside--neg"}`}>
                            {research.priceTargetUpsidePct >= 0 ? "↑" : "↓"} {Math.abs(research.priceTargetUpsidePct).toFixed(1)}% upside
                          </span>
                        )}
                      </div>
                    )}
                    {research.priceTarget !== null && research.priceTargetUpsidePct !== null && (
                      <div className="ai-upside-bar-track">
                        <div
                          className={`ai-upside-bar-fill ${research.priceTargetUpsidePct >= 0 ? "ai-upside-bar-fill--pos" : "ai-upside-bar-fill--neg"}`}
                          style={{ width: `${Math.min(Math.abs(research.priceTargetUpsidePct), 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Earnings */}
                {research.earningsDaysAway !== null && (
                  <div className="ai-card">
                    <div className="ai-card-lbl">Earnings</div>
                    <div className={`ai-earnings-pill ${research.earningsDaysAway <= 3 ? "ai-earnings-pill--urgent" : research.earningsDaysAway <= 14 ? "ai-earnings-pill--soon" : "ai-earnings-pill--ok"}`}>
                      <i className="fa-regular fa-calendar" />
                      {research.earningsDaysAway === 0 ? "Today" : `${research.earningsDaysAway}d away`}
                    </div>
                    {research.earningsDaysAway <= 3 && (
                      <div className="ai-subtext">High volatility risk</div>
                    )}
                  </div>
                )}

                {/* Insider */}
                <div className="ai-card">
                  <div className="ai-card-lbl">Insiders (90d)</div>
                  <div className={`ai-insider-badge ai-insider-badge--${research.insiderNetSentiment}`}>
                    {research.insiderNetSentiment === "bullish" ? "↑ Buying" : research.insiderNetSentiment === "bearish" ? "↓ Selling" : "Neutral"}
                  </div>
                  <div className="ai-insider-counts">
                    <span className="ai-insider-buy">{research.insiderBuyCount} buy{research.insiderBuyCount !== 1 ? "s" : ""}</span>
                    <span className="ai-muted">/</span>
                    <span className="ai-insider-sell">{research.insiderSellCount} sell{research.insiderSellCount !== 1 ? "s" : ""}</span>
                  </div>
                </div>

                {/* Analyst changes */}
                {(research.recentUpgrades > 0 || research.recentDowngrades > 0) && (
                  <div className="ai-card">
                    <div className="ai-card-lbl">Rating changes</div>
                    {research.recentUpgrades > 0 && (
                      <div className="ai-rating-change ai-rating-change--up">
                        <i className="fa-solid fa-arrow-up" /> {research.recentUpgrades} upgrade{research.recentUpgrades !== 1 ? "s" : ""}
                      </div>
                    )}
                    {research.recentDowngrades > 0 && (
                      <div className="ai-rating-change ai-rating-change--down">
                        <i className="fa-solid fa-arrow-down" /> {research.recentDowngrades} downgrade{research.recentDowngrades !== 1 ? "s" : ""}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Flags */}
              {research.flags.length > 0 && (
                <div className="ai-flags">
                  {research.flags.map((f, i) => (
                    <div key={i} className="ai-flag">{f}</div>
                  ))}
                </div>
              )}

              {/* Headlines */}
              {research.recentHeadlines.length > 0 && (
                <div className="ai-headlines">
                  <div className="ai-headlines-label">Recent news</div>
                  {research.recentHeadlines.map((h, i) => (
                    <div key={i} className="ai-headline">
                      <span className="ai-headline-dot">·</span>
                      <span>{h}</span>
                    </div>
                  ))}
                </div>
              )}
            </SectionBox>
          )}

          {/* Dividend depth */}
          {dividends && consistency && (
            <SectionBox title="Dividend analysis">
              <div className="research-div-analysis">
                {/* Consistency */}
                <div className="research-div-row">
                  <span className="research-div-label">Consistency</span>
                  <span className="research-consistency-badge" style={{ color: consistency.color }}>
                    <i className="fa-solid fa-circle" style={{ fontSize: 7 }} /> {consistency.label}
                  </span>
                  {consistency.detail && <span className="research-muted research-div-detail">{consistency.detail}</span>}
                </div>
                {/* CAGR */}
                <div className="research-div-row">
                  <span className="research-div-label">Growth rate</span>
                  <div className="research-cagr-chips">
                    {cagr1 !== null && <span className="research-cagr-chip" style={{ color: cagr1 >= 0 ? "var(--green)" : "var(--red)" }}>1yr {cagr1 >= 0 ? "+" : ""}{(cagr1 * 100).toFixed(1)}%</span>}
                    {cagr3 !== null && <span className="research-cagr-chip" style={{ color: cagr3 >= 0 ? "var(--green)" : "var(--red)" }}>3yr {cagr3 >= 0 ? "+" : ""}{(cagr3 * 100).toFixed(1)}%</span>}
                    {cagr5 !== null && <span className="research-cagr-chip" style={{ color: cagr5 >= 0 ? "var(--green)" : "var(--red)" }}>5yr {cagr5 >= 0 ? "+" : ""}{(cagr5 * 100).toFixed(1)}%</span>}
                    {cagr1 === null && cagr3 === null && cagr5 === null && <span className="research-muted">Insufficient history</span>}
                  </div>
                </div>
                {/* Payout ratio */}
                {overview?.payoutRatio && (
                  <div className="research-div-row">
                    <span className="research-div-label">Payout ratio</span>
                    <span className="mono">{overview.payoutRatio}</span>
                  </div>
                )}
                {/* Record count */}
                <div className="research-div-row">
                  <span className="research-div-label">History</span>
                  <span className="research-muted">{dividends.history.length} payments on record</span>
                </div>
              </div>

              {/* Payment history table */}
              <div className="research-history">
                {historyRows.map((h, i) => (
                  <div className="research-history-row" key={i}>
                    <span>{h.exDate}</span>
                    <span className="mono">${h.amount.toFixed(4)}</span>
                    <span className="research-muted">pay {h.payDate}</span>
                  </div>
                ))}
              </div>
              {dividends.history.length > 12 && (
                <button className="research-show-more" onClick={() => setShowFullHistory(v => !v)}>
                  {showFullHistory ? "Show less" : `Show all ${dividends.history.length} payments`}
                </button>
              )}
            </SectionBox>
          )}

          {/* Projected payment calendar */}
          {projectedPayments.length > 0 && (
            <SectionBox title="Projected payments (next 12 months)">
              <div className="research-calendar-grid">
                {projectedPayments.map((p, i) => {
                  const d = new Date(p.date + "T12:00:00");
                  const mo = d.toLocaleDateString("en-US", { month: "short" });
                  const yr = d.getFullYear();
                  return (
                    <div className="research-cal-item" key={i}>
                      <div className="research-cal-date">{mo} {yr}</div>
                      <div className="research-cal-amount">${p.amount.toFixed(4)}</div>
                      <div className="research-cal-income" style={{ color: "var(--green)" }}>
                        {sharesNum > 0 ? `+${fmt(p.amount * sharesNum)}` : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
              {sharesNum > 0 && projectedPayments.length > 0 && (
                <div className="research-cal-total">
                  Total projected: <span style={{ color: "var(--green)" }}>{fmt(projectedPayments.reduce((s, p) => s + p.amount * sharesNum, 0))}</span>
                  {" "}for {sharesNum} shares
                </div>
              )}
            </SectionBox>
          )}

          {/* Goal impact */}
          <SectionBox title="Goal impact">
            <div className="research-impact-inputs">
              <label>
                <span>Shares to model</span>
                <input type="number" min="1" value={shares} onChange={e => setShares(e.target.value)} className="research-shares-input" />
              </label>
            </div>
            {impact && (
              <div className="research-impact-grid">
                <div className="research-impact-item">
                  <div className="research-impact-lbl">Cost</div>
                  <div className="research-impact-val">{fmt(impact.addedValue)}</div>
                </div>
                <div className="research-impact-item">
                  <div className="research-impact-lbl">Added income/yr</div>
                  <div className="research-impact-val" style={{ color: "var(--green)" }}>+{fmt(impact.addedAnnualIncome)}</div>
                </div>
                <div className="research-impact-item">
                  <div className="research-impact-lbl">Added income/mo</div>
                  <div className="research-impact-val" style={{ color: "var(--green)" }}>+{fmt(impact.addedAnnualIncome / 12)}</div>
                </div>
                <div className="research-impact-item">
                  <div className="research-impact-lbl">New forward income/yr</div>
                  <div className="research-impact-val">{fmt(impact.newForwardAnnual)}</div>
                </div>
                <div className="research-impact-item">
                  <div className="research-impact-lbl">New capital needed</div>
                  <div className="research-impact-val">{impact.newCapitalNeeded !== null ? fmt(impact.newCapitalNeeded) : "—"}</div>
                </div>
                <div className="research-impact-item">
                  <div className="research-impact-lbl">Δ capital needed</div>
                  <div className="research-impact-val" style={{ color: "var(--green)" }}>
                    {impact.newCapitalNeeded !== null && goal.currentForwardAnnual > 0 && goal.currentValue > 0
                      ? `−${fmt(goal.dividendTargetAnnual / (goal.currentForwardAnnual / goal.currentValue) - impact.newCapitalNeeded)}`
                      : "—"}
                  </div>
                </div>
              </div>
            )}
          </SectionBox>

          {/* Portfolio fit */}
          <SectionBox title="Portfolio fit">
            <div className="research-fit-body">
              {existingHolding && (
                <div className="research-fit-existing">
                  <i className="fa-solid fa-circle-check" style={{ color: "var(--olive)" }} />
                  Already held — {existingHolding.shares} shares @ avg {fmt(existingHolding.avgCost)}, current value {fmt(existingHolding.value)}
                </div>
              )}
              <div className="research-fit-metrics">
                {overview && sharesNum > 0 && (
                  <>
                    <div className="research-fit-item">
                      <div className="research-fit-lbl">Position size</div>
                      <div className="research-fit-val mono">{positionPct.toFixed(1)}%</div>
                      <div className="research-fit-bar"><div className="research-fit-bar-fill" style={{ width: `${Math.min(positionPct, 100)}%`, background: positionPct > 25 ? "var(--red)" : positionPct > 15 ? "var(--olive)" : "var(--green)" }} /></div>
                    </div>
                    <div className="research-fit-item">
                      <div className="research-fit-lbl">Income share</div>
                      <div className="research-fit-val mono">{incomePct.toFixed(1)}%</div>
                      <div className="research-fit-bar"><div className="research-fit-bar-fill" style={{ width: `${Math.min(incomePct, 100)}%`, background: incomePct > 30 ? "var(--red)" : incomePct > 20 ? "var(--olive)" : "var(--green)" }} /></div>
                    </div>
                  </>
                )}
              </div>
              <div className="research-fit-flags">
                {fitFlags.map((f, i) => (
                  <div key={i} className="research-fit-flag" style={{ color: f.color }}>
                    <i className="fa-solid fa-circle" style={{ fontSize: 6 }} /> {f.label}
                  </div>
                ))}
              </div>
            </div>
          </SectionBox>

          {/* Notes */}
          <SectionBox title={`Notes — ${currentSymbol}`}>
            <div className="research-notes-body">
              <textarea
                ref={notesRef}
                className="research-notes-input"
                value={note}
                onChange={e => updateNote(currentSymbol, e.target.value)}
                placeholder={`Jot down anything about ${currentSymbol}…`}
                rows={4}
              />
              <div className="research-notes-hint">Saved locally in your browser</div>
            </div>
          </SectionBox>

          {/* Description */}
          {overview.description && (
            <SectionBox title="About">
              <div className="research-description">{overview.description}</div>
            </SectionBox>
          )}

        </div>
      )}
    </div>
  );
}
