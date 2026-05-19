import { fetchWithRetry } from "../utils/http.js"
import type { ScreenerCandidate } from "./types.js"

const BASE = "https://stockanalysis.com"

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept": "application/json",
}

type SvelteVal = string | number | boolean | null | Record<string, number> | number[]
type SvelteData = SvelteVal[]

function n(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const parsed = typeof v === "number" ? v : parseFloat(String(v))
  return Number.isFinite(parsed) ? parsed : null
}

function strVal(data: SvelteData, idx: number | undefined): string {
  if (idx === undefined) return ""
  const v = data[idx]
  return typeof v === "string" ? v : ""
}

function numVal(data: SvelteData, idx: number | undefined): number | null {
  if (idx === undefined) return null
  return n(data[idx])
}

// The screener __data.json returns rows where each row is an index into the data array.
// Each row object has keys: s, n, marketCap, price, change, industry, volume, peRatio, ...
// Additional fields (forwardPE, pbRatio, etc.) may not be present in default screener view
// but we extract what's available and fill the rest via per-stock detail fetches.
function mapSvelteRow(data: SvelteData, rowIdx: number): ScreenerCandidate | null {
  const row = data[rowIdx] as Record<string, number> | undefined
  if (!row || typeof row !== "object" || Array.isArray(row)) return null

  const symbol = strVal(data, row["s"])
  const name = strVal(data, row["n"])
  const price = numVal(data, row["price"] ?? row["lastClose"])

  if (!symbol || price === null) return null

  return {
    symbol: symbol.toUpperCase(),
    name: name || symbol,
    marketCap: numVal(data, row["marketCap"]) ?? 0,
    peRatio: numVal(data, row["peRatio"]),
    forwardPE: numVal(data, row["forwardPE"]),
    pbRatio: numVal(data, row["pbRatio"]),
    psRatio: numVal(data, row["ps"] ?? row["psRatio"]),
    evEbitda: numVal(data, row["evEbitda"]),
    epsGrowthYoy: numVal(data, row["epsGrowth"] ?? row["epsGrowthYoy"]),
    revenueGrowthYoy: numVal(data, row["revenueGrowth"] ?? row["revenueGrowthYoy"]),
    netMargin: numVal(data, row["netMargin"]),
    returnOnEquity: numVal(data, row["roe"] ?? row["returnOnEquity"]),
    debtToEquity: numVal(data, row["debtToEquity"]),
    currentRatio: numVal(data, row["currentRatio"]),
    dividendYield: numVal(data, row["dividendYield"]),
    price,
    change1W: numVal(data, row["change1W"]),
    change1M: numVal(data, row["change1M"]),
    change3M: numVal(data, row["change3M"]),
    analystBuys: numVal(data, row["analystBuyCount"] ?? row["analystBuys"]),
    analystHolds: numVal(data, row["analystHoldCount"] ?? row["analystHolds"]),
    analystSells: numVal(data, row["analystSellCount"] ?? row["analystSells"]),
    analystTarget: numVal(data, row["analystTarget"]),
  }
}

export async function fetchScreenerCandidates(): Promise<ScreenerCandidate[]> {
  const url = `${BASE}/stocks/screener/__data.json?x-sveltekit-trailing-slash=1`
  const res = await fetchWithRetry(url, { headers: HEADERS }, { retries: 2, timeoutMs: 20_000, label: "screener" })
  if (!res.ok) return []

  let json: { nodes?: { type: string; data: SvelteData }[] }
  try {
    json = await res.json()
  } catch {
    return []
  }

  const nodes = json.nodes?.filter(n => n.type === "data" && Array.isArray(n.data)) ?? []

  // Find node with count + data keys
  const screenerNode = nodes.find(n => {
    const root = n.data[0]
    return typeof root === "object" && root !== null && !Array.isArray(root) && "count" in (root as object) && "data" in (root as object)
  })
  if (!screenerNode) return []

  const data = screenerNode.data
  const root = data[0] as Record<string, number>
  const dataIdx = root["data"]
  if (dataIdx === undefined) return []

  const rowIndices = data[dataIdx]
  if (!Array.isArray(rowIndices)) return []

  const candidates: ScreenerCandidate[] = []
  for (const rowIdx of rowIndices as number[]) {
    const candidate = mapSvelteRow(data, rowIdx)
    if (candidate) candidates.push(candidate)
  }

  // Sort by market cap descending (API returns sorted but let's be explicit)
  candidates.sort((a, b) => b.marketCap - a.marketCap)

  return candidates
}
