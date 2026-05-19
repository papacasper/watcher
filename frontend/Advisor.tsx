import React, { useState, useEffect, useRef, useCallback } from "react";
import { apiPost, apiGet } from "./api.js";
function fmtPrice(n: number): string {
  return n >= 1000 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${n.toFixed(2)}`;
}

export interface AdvisorScoreBreakdown {
  category: "valuation" | "growth" | "quality" | "momentum" | "analyst";
  score: number;
  weight: number;
  signals: string[];
}

export interface AdvisorResult {
  symbol: string;
  name: string;
  price: number;
  totalScore: number;
  recommendation: "Strong Buy" | "Buy" | "Watch" | "Avoid";
  breakdown: AdvisorScoreBreakdown[];
  topReasons: string[];
  risks: string[];
  fetchedAt: string;
}

interface AdvisorResponse {
  status?: string;
  message?: string;
  generatedAt?: string;
  candidates?: number;
  stale?: boolean;
  running?: boolean;
  results?: AdvisorResult[];
}

const REC_COLORS: Record<AdvisorResult["recommendation"], string> = {
  "Strong Buy": "var(--green)",
  "Buy": "color-mix(in srgb, var(--green) 70%, var(--olive))",
  "Watch": "var(--olive)",
  "Avoid": "var(--red)",
};

const CATEGORY_LABELS: Record<AdvisorScoreBreakdown["category"], string> = {
  valuation: "Valuation",
  growth: "Growth",
  quality: "Quality",
  momentum: "Momentum",
  analyst: "Analyst",
};

function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const color = pct >= 70 ? "var(--green)" : pct >= 40 ? "var(--olive)" : "var(--red)";
  return (
    <div className="adv-score-bar-wrap">
      <div className="adv-score-bar" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function ResultCard({ result, expanded, onToggle }: { result: AdvisorResult; expanded: boolean; onToggle: () => void }) {
  const recColor = REC_COLORS[result.recommendation];
  return (
    <div className="adv-card">
      <button className="adv-card-header" onClick={onToggle} type="button">
        <div className="adv-card-left">
          <span className="adv-symbol">{result.symbol}</span>
          <span className="adv-name">{result.name}</span>
        </div>
        <div className="adv-card-right">
          <span className="adv-price">{fmtPrice(result.price)}</span>
          <span className="adv-score">{Math.round(result.totalScore)}</span>
          <span className="adv-rec" style={{ color: recColor }}>{result.recommendation}</span>
          <i className={`fa-solid fa-chevron-${expanded ? "up" : "down"} adv-chevron`} />
        </div>
      </button>

      {expanded && (
        <div className="adv-card-body">
          <div className="adv-breakdown">
            {result.breakdown.map(b => (
              <div key={b.category} className="adv-breakdown-row">
                <span className="adv-breakdown-cat">{CATEGORY_LABELS[b.category]}</span>
                <ScoreBar score={b.score} />
                <span className="adv-breakdown-score">{Math.round(b.score)}</span>
                {b.signals.length > 0 && (
                  <div className="adv-signals">
                    {b.signals.map((s, i) => <span key={i} className="adv-signal">{s}</span>)}
                  </div>
                )}
              </div>
            ))}
          </div>

          {result.topReasons.length > 0 && (
            <div className="adv-detail-section">
              <div className="adv-detail-title">
                <i className="fa-solid fa-circle-check" style={{ color: "var(--green)" }} /> Top reasons
              </div>
              <ul className="adv-list">
                {result.topReasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}

          {result.risks.length > 0 && (
            <div className="adv-detail-section">
              <div className="adv-detail-title">
                <i className="fa-solid fa-triangle-exclamation" style={{ color: "var(--red)" }} /> Risks
              </div>
              <ul className="adv-list adv-list--risk">
                {result.risks.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AdvisorTab() {
  const [data, setData] = useState<AdvisorResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await apiGet("/api/advisor");
      const body = await res.json() as AdvisorResponse;
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`);
      setData(body);
      if (body.running || body.status === "running") {
        // still building — start/keep polling
        if (pollRef.current) {
          elapsedRef.current = 0;
          setElapsed(0);
        } else {
          elapsedRef.current = 0;
          setElapsed(0);
          pollRef.current = setInterval(async () => {
            elapsedRef.current += 5;
            setElapsed(elapsedRef.current);
            try {
              const r2 = await apiGet("/api/advisor");
              const b2 = await r2.json() as AdvisorResponse;
              setData(b2);
              if (!b2.running && b2.status !== "running") stopPoll();
            } catch { /* keep trying */ }
          }, 5_000);
        }
      } else {
        stopPoll();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [stopPoll]);

  useEffect(() => {
    load();
    return stopPoll;
  }, [load, stopPoll]);

  async function triggerRefresh() {
    setRefreshing(true);
    try {
      await apiPost("/api/advisor/refresh");
      await load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRefreshing(false);
    }
  }

  const running = data?.running || data?.status === "running";
  const results = data?.results ?? [];

  return (
    <div className="adv-page">
      <div className="adv-toolbar">
        <div className="adv-toolbar-info">
          {data?.generatedAt && (
            <span className="adv-generated">
              <i className="fa-regular fa-clock" /> Generated {new Date(data.generatedAt).toLocaleString()}
              {data.stale && <span className="adv-stale"> · stale</span>}
            </span>
          )}
          {data?.candidates !== undefined && (
            <span className="adv-candidates">{data.candidates} candidates screened</span>
          )}
        </div>
        <button
          className="adv-refresh-btn"
          onClick={triggerRefresh}
          disabled={refreshing || running}
          type="button"
        >
          <i className={refreshing || running ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-rotate-right"} />
          {refreshing || running ? "Building…" : "Refresh"}
        </button>
      </div>

      {loading && (
        <div className="adv-loading">
          <i className="fa-solid fa-spinner fa-spin" /> Loading advisor…
        </div>
      )}

      {!loading && running && (
        <div className="adv-building">
          <i className="fa-solid fa-spinner fa-spin" />
          <div>
            <strong>Advisor is building recommendations</strong>
            <div className="adv-building-sub">
              Screening ~100 dividend candidates · {elapsed > 0 ? `${elapsed}s elapsed` : "starting…"}
            </div>
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="adv-error">
          <i className="fa-solid fa-circle-exclamation" /> {error}
        </div>
      )}

      {!loading && !running && results.length > 0 && (
        <div className="adv-results">
          {results.map(r => (
            <ResultCard
              key={r.symbol}
              result={r}
              expanded={expanded === r.symbol}
              onToggle={() => setExpanded(prev => prev === r.symbol ? null : r.symbol)}
            />
          ))}
        </div>
      )}

      {!loading && !running && !error && results.length === 0 && (
        <div className="adv-empty">
          <i className="fa-solid fa-magnifying-glass" />
          <div>No results yet. Hit <strong>Refresh</strong> to run the advisor.</div>
        </div>
      )}
    </div>
  );
}
