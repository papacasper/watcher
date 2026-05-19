import { runAdvisor, type AdvisorReport } from "../advisor/index.js";

// ── Ticker cache (15-minute TTL) ──────────────────────────────────────────────

const TICKER_TTL_MS = 15 * 60_000;
interface TickerCacheEntry { data: unknown; fetchedAt: number; }
const tickerCache = new Map<string, TickerCacheEntry>();

export function tickerCacheGet(key: string): unknown | null {
  const entry = tickerCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > TICKER_TTL_MS) { tickerCache.delete(key); return null; }
  return entry.data;
}

export function tickerCacheSet(key: string, data: unknown): void {
  tickerCache.set(key, { data, fetchedAt: Date.now() });
}

// ── Advisor cache (6-hour TTL, runs in background) ───────────────────────────

const ADVISOR_TTL_MS = 6 * 60 * 60_000;
let advisorCache: AdvisorReport | null = null;
let advisorFetchedAt = 0;
let advisorRunning = false;

export function advisorCacheStale(): boolean {
  return Date.now() - advisorFetchedAt > ADVISOR_TTL_MS;
}

export function getAdvisorCache(): AdvisorReport | null {
  return advisorCache;
}

export function isAdvisorRunning(): boolean {
  return advisorRunning;
}

export function resetAdvisorCache(): void {
  advisorFetchedAt = 0;
}

export function runAdvisorBackground(maxCandidates = 100): void {
  if (advisorRunning) return;
  advisorRunning = true;
  runAdvisor({ maxCandidates, concurrency: 5 })
    .then(report => {
      advisorCache = report;
      advisorFetchedAt = Date.now();
    })
    .catch(e => console.error("[advisor] background run failed:", e))
    .finally(() => { advisorRunning = false; });
}
