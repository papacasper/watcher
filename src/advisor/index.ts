import { fetchWithRetry } from "../utils/http.js"
import { fetchScreenerCandidates } from "./screener.js"
import { getFinancialHealth, getStockRatios } from "./financials.js"
import type { StockRatios } from "./financials.js"
import { getMomentumSignal } from "./momentum.js"
import { scoreCandidate } from "./score.js"
import { getResearch } from "./research.js"
import type { AdvisorReport, AdvisorResult } from "./types.js"

export type { AdvisorReport, AdvisorResult } from "./types.js"

const BASE = "https://stockanalysis.com"

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept": "application/json",
}

interface Semaphore {
  count: number
  max: number
}

async function withSemaphore<T>(sem: Semaphore, fn: () => Promise<T>): Promise<T> {
  while (sem.count >= sem.max) await new Promise(r => setTimeout(r, 50))
  sem.count++
  try { return await fn() } finally { sem.count-- }
}

async function fetchPriceHistory(symbol: string): Promise<[number, number][] | null> {
  const s = symbol.toLowerCase()
  for (const kind of ["s", "e"] as const) {
    const url = `${BASE}/api/symbol/${kind}/${s}/history?type=chart`
    const res = await fetchWithRetry(url, { headers: HEADERS }, { retries: 1, label: url })
    if (!res.ok) continue
    const json = await res.json() as { status: string | number; data: [number, number][] }
    if ((json.status !== "success" && json.status !== 200) || !Array.isArray(json.data) || json.data.length < 5) continue
    return json.data
  }
  return null
}

function mergeRatios(candidate: import("./types.js").ScreenerCandidate, ratios: StockRatios): import("./types.js").ScreenerCandidate {
  return {
    ...candidate,
    forwardPE: candidate.forwardPE ?? ratios.peForward,
    pbRatio: candidate.pbRatio ?? ratios.pbRatio,
    psRatio: candidate.psRatio ?? ratios.psRatio,
    evEbitda: candidate.evEbitda ?? ratios.evEbitda,
    debtToEquity: candidate.debtToEquity ?? ratios.debtToEquity,
    currentRatio: candidate.currentRatio ?? ratios.currentRatio,
    returnOnEquity: candidate.returnOnEquity ?? ratios.returnOnEquity,
  }
}

export async function runAdvisor(options?: {
  maxCandidates?: number
  minMarketCap?: number
  concurrency?: number
}): Promise<AdvisorReport> {
  const maxCandidates = options?.maxCandidates ?? 100
  const minMarketCap = options?.minMarketCap ?? 1_000_000_000
  const concurrency = options?.concurrency ?? 5

  console.error(`[advisor] Fetching screener...`)
  const screener = await fetchScreenerCandidates()

  const filtered = screener
    .filter(c => c.marketCap >= minMarketCap)
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, maxCandidates)

  console.error(`[advisor] Analyzing ${filtered.length} candidates (concurrency=${concurrency})...`)

  const sem: Semaphore = { count: 0, max: concurrency }
  const results: AdvisorResult[] = []

  await Promise.all(filtered.map((candidate, i) =>
    withSemaphore(sem, async () => {
      try {
        const [priceHistory, health, ratios, research] = await Promise.all([
          fetchPriceHistory(candidate.symbol),
          getFinancialHealth(candidate.symbol),
          getStockRatios(candidate.symbol),
          getResearch(candidate.symbol, candidate.price).catch(() => null),
        ])

        const enriched = mergeRatios(candidate, ratios)
        const history: [number, number][] = priceHistory ?? []
        const momentum = getMomentumSignal(candidate.symbol, history)
        const result = scoreCandidate(enriched, health, momentum, research)
        result.research = research
        results.push(result)

        if ((i + 1) % 10 === 0) {
          console.error(`[advisor] ${i + 1}/${filtered.length} processed`)
        }
      } catch (err) {
        console.error(`[advisor] Failed ${candidate.symbol}:`, err)
      }
    })
  ))

  results.sort((a, b) => b.totalScore - a.totalScore)

  return {
    generatedAt: new Date().toISOString(),
    candidates: filtered.length,
    results,
  }
}
