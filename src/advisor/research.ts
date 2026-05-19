import { fetchWithRetry } from "../utils/http.js"

const BASE = "https://stockanalysis.com"
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept": "application/json",
}

export interface ResearchSummary {
  symbol: string
  recentHeadlines: string[]        // last 5 news titles
  earningsDaysAway: number | null
  insiderBuyCount: number          // last 90 days
  insiderSellCount: number
  insiderNetSentiment: "bullish" | "bearish" | "neutral"
  recentUpgrades: number
  recentDowngrades: number
  analystConsensus: string | null
  priceTarget: number | null
  priceTargetUpsidePct: number | null
  sectorName: string | null
  flags: string[]
}

// ── SvelteKit devalue helpers ─────────────────────────────────────────────────

type SvelteVal = string | number | boolean | null | Record<string, number> | number[] | Record<string, number>[]
type SvelteData = SvelteVal[]

async function fetchSvelteNodes(url: string): Promise<SvelteData[] | null> {
  const res = await fetchWithRetry(url, { headers: HEADERS }, { retries: 1, timeoutMs: 12_000, label: url })
  if (!res.ok) return null
  try {
    const json = await res.json() as { nodes?: { type: string; data: SvelteData }[] }
    return json.nodes?.filter(n => n.type === "data" && Array.isArray(n.data)).map(n => n.data) ?? null
  } catch {
    return null
  }
}

function str(data: SvelteData, idx: number | undefined): string {
  if (idx === undefined) return ""
  const v = data[idx]
  return typeof v === "string" ? v : ""
}

function num(data: SvelteData, idx: number | undefined): number | null {
  if (idx === undefined) return null
  const v = data[idx]
  return typeof v === "number" ? v : null
}

function findNode(nodes: SvelteData[], key: string): SvelteData | null {
  return nodes.find(data => {
    const root = data[0]
    return typeof root === "object" && root !== null && !Array.isArray(root) && key in (root as Record<string, unknown>)
  }) ?? null
}

// ── Overview node — news, earnings date, analyst consensus, sector ─────────────

interface OverviewData {
  headlines: string[]
  earningsDaysAway: number | null
  analystConsensus: string | null
  priceTarget: number | null
  sectorName: string | null
  upgrades: number
  downgrades: number
}

async function fetchOverviewData(symbol: string): Promise<OverviewData> {
  const s = symbol.toLowerCase()
  const nodes = await fetchSvelteNodes(`${BASE}/stocks/${s}/__data.json?x-sveltekit-trailing-slash=1`)
  const empty: OverviewData = { headlines: [], earningsDaysAway: null, analystConsensus: null, priceTarget: null, sectorName: null, upgrades: 0, downgrades: 0 }
  if (!nodes) return empty

  // Main stock data node has: marketCap, news, earningsDate, analysts, target, ...
  const stockNode = findNode(nodes, "marketCap")
  if (!stockNode) return empty

  const root = stockNode[0] as Record<string, number>

  // Analyst consensus + price target (stored as strings like "Buy", "308.07 (+2.35%)")
  const analystConsensus = str(stockNode, root["analysts"]) || null
  const targetStr = str(stockNode, root["target"])
  const priceTarget = targetStr ? parseFloat(targetStr) : null

  // Earnings date
  const earningsDateStr = str(stockNode, root["earningsDate"])
  let earningsDaysAway: number | null = null
  if (earningsDateStr) {
    const d = new Date(earningsDateStr)
    if (!isNaN(d.getTime())) {
      const days = Math.round((d.getTime() - Date.now()) / 86_400_000)
      if (days >= 0 && days < 365) earningsDaysAway = days
    }
  }

  // News — root.news → { exp, data } → data is array of news item indices
  const newsWrapIdx = root["news"]
  const newsWrap = newsWrapIdx !== undefined ? stockNode[newsWrapIdx] as Record<string, number> : null
  const headlines: string[] = []
  if (newsWrap && typeof newsWrap === "object" && !Array.isArray(newsWrap)) {
    const newsDataIdx = newsWrap["data"]
    const newsItems = newsDataIdx !== undefined ? stockNode[newsDataIdx] : null
    if (Array.isArray(newsItems)) {
      for (const itemIdx of (newsItems as number[]).slice(0, 5)) {
        const item = stockNode[itemIdx] as Record<string, number> | undefined
        if (!item) continue
        // Each news item: { title, url, source, time, ... }
        const title = str(stockNode, item["title"] ?? item["t"])
        if (title) headlines.push(title)
      }
    }
  }

  // Sector from infoTable — infoTable is an array of row indices, each row has a label
  const infoNode = findNode(nodes, "info")
  let sectorName: string | null = null
  if (infoNode) {
    const infoRoot = infoNode[0] as Record<string, number>
    const infoIdx = infoRoot["info"]
    if (infoIdx !== undefined) {
      const info = infoNode[infoIdx] as Record<string, number>
      sectorName = str(infoNode, info["sector"] ?? info["sectorName"]) || null
    }
  }

  return { headlines, earningsDaysAway, analystConsensus, priceTarget, sectorName, upgrades: 0, downgrades: 0 }
}

// ── Forecast node — upgrades/downgrades, rating changes ───────────────────────

interface ForecastData {
  upgrades: number
  downgrades: number
}

async function fetchForecastData(symbol: string): Promise<ForecastData> {
  const s = symbol.toLowerCase()
  const nodes = await fetchSvelteNodes(`${BASE}/stocks/${s}/forecast/__data.json?x-sveltekit-trailing-slash=1`)
  if (!nodes) return { upgrades: 0, downgrades: 0 }

  // Node with: estimates, recommendations, ratings, targets, meta
  const forecastNode = findNode(nodes, "recommendations")
  if (!forecastNode) return { upgrades: 0, downgrades: 0 }

  const root = forecastNode[0] as Record<string, number>
  const ratingsIdx = root["ratings"]
  if (ratingsIdx === undefined) return { upgrades: 0, downgrades: 0 }

  // ratings is array of rating-period indices
  const ratingPeriods = forecastNode[ratingsIdx]
  if (!Array.isArray(ratingPeriods) || ratingPeriods.length === 0) return { upgrades: 0, downgrades: 0 }

  // Most recent period (first element)
  const latestPeriodIdx: number | undefined = (ratingPeriods as number[])[0]
  if (latestPeriodIdx === undefined) return { upgrades: 0, downgrades: 0 }
  const latestPeriod = forecastNode[latestPeriodIdx] as Record<string, number> | undefined
  if (!latestPeriod) return { upgrades: 0, downgrades: 0 }

  // Each period has buy/hold/sell counts
  const buys = num(forecastNode, latestPeriod["buy"] !== undefined ? latestPeriod["buy"] : latestPeriod["strongBuy"]) ?? 0
  const sells = num(forecastNode, latestPeriod["sell"] !== undefined ? latestPeriod["sell"] : latestPeriod["strongSell"]) ?? 0

  // Compute upgrades/downgrades by comparing latest vs prior period if available
  let upgrades = 0
  let downgrades = 0
  if (ratingPeriods.length >= 2) {
    const priorIdx: number | undefined = (ratingPeriods as number[])[1]
    const prior = priorIdx !== undefined ? forecastNode[priorIdx] as Record<string, number> | undefined : undefined
    if (prior) {
      const priorBuys = num(forecastNode, prior["buy"] !== undefined ? prior["buy"] : prior["strongBuy"]) ?? 0
      const priorSells = num(forecastNode, prior["sell"] !== undefined ? prior["sell"] : prior["strongSell"]) ?? 0
      upgrades = Math.max(0, buys - priorBuys)
      downgrades = Math.max(0, sells - priorSells)
    }
  }

  return { upgrades, downgrades }
}

// ── Insider activity — from /actions/__data.json filtered to this symbol ──────

interface InsiderData {
  buys: number
  sells: number
}

async function fetchInsiderData(symbol: string): Promise<InsiderData> {
  // Insider trading is embedded in the main overview __data.json under 'changes'
  const s = symbol.toLowerCase()
  const nodes = await fetchSvelteNodes(`${BASE}/stocks/${s}/__data.json?x-sveltekit-trailing-slash=1`)
  if (!nodes) return { buys: 0, sells: 0 }

  const stockNode = findNode(nodes, "marketCap")
  if (!stockNode) return { buys: 0, sells: 0 }

  const root = stockNode[0] as Record<string, number>
  const changesIdx = root["changes"]
  if (changesIdx === undefined) return { buys: 0, sells: 0 }

  const changes = stockNode[changesIdx]
  if (!Array.isArray(changes)) return { buys: 0, sells: 0 }

  const cutoff = Date.now() - 90 * 86_400_000
  let buys = 0
  let sells = 0

  for (const idx of changes as number[]) {
    const tx = stockNode[idx] as Record<string, number> | undefined
    if (!tx) continue
    const dateStr = str(stockNode, tx["date"] ?? tx["filed"] ?? tx["dt"])
    if (dateStr && new Date(dateStr).getTime() < cutoff) continue
    const type = str(stockNode, tx["type"] ?? tx["transactionType"]).toLowerCase()
    if (type === "buy" || type === "purchase" || type === "p") buys++
    else if (type === "sell" || type === "sale" || type === "s") sells++
  }

  return { buys, sells }
}

// ── Flag generator ────────────────────────────────────────────────────────────

function buildFlags(data: {
  earningsDaysAway: number | null
  insiderBuys: number
  insiderSells: number
  upgrades: number
  downgrades: number
  priceTargetUpsidePct: number | null
  headlines: string[]
}): string[] {
  const flags: string[] = []

  if (data.earningsDaysAway !== null) {
    if (data.earningsDaysAway <= 3) flags.push(`⚠️  Earnings in ${data.earningsDaysAway} day${data.earningsDaysAway === 1 ? "" : "s"} — high volatility risk`)
    else if (data.earningsDaysAway <= 14) flags.push(`📅 Earnings in ${data.earningsDaysAway} days`)
  }
  if (data.insiderBuys > 0 && data.insiderBuys > data.insiderSells) {
    flags.push(`🟢 ${data.insiderBuys} insider buy${data.insiderBuys > 1 ? "s" : ""} in last 90 days`)
  }
  if (data.insiderSells > 2 && data.insiderSells > data.insiderBuys * 2) {
    flags.push(`🔴 Heavy insider selling (${data.insiderSells} sells vs ${data.insiderBuys} buys)`)
  }
  if (data.upgrades > 0 && data.upgrades > data.downgrades) {
    flags.push(`📈 Net analyst upgrades this period (+${data.upgrades})`)
  }
  if (data.downgrades > 0 && data.downgrades > data.upgrades) {
    flags.push(`📉 Net analyst downgrades this period (-${data.downgrades})`)
  }
  if (data.priceTargetUpsidePct !== null && data.priceTargetUpsidePct > 25) {
    flags.push(`🎯 ${data.priceTargetUpsidePct.toFixed(0)}% upside to analyst consensus price target`)
  }

  const headlineText = data.headlines.join(" ").toLowerCase()
  if (/\b(beat|beats|topped|exceeded)\b/.test(headlineText)) flags.push("✅ Recent earnings beat in news")
  if (/\b(miss|missed|below.expectations)\b/.test(headlineText)) flags.push("⚠️  Recent earnings miss in news")
  if (/\b(buyback|repurchase|share.repurchase)\b/.test(headlineText)) flags.push("💰 Share buyback mentioned in news")
  if (/\b(dividend increase|raised.dividend|dividend.hike)\b/.test(headlineText)) flags.push("💵 Dividend increase in news")
  if (/\b(fda approval|approved by|clearance)\b/.test(headlineText)) flags.push("🏥 Regulatory approval in news")
  if (/\b(lawsuit|sued|sec.investigation|fraud|probe)\b/.test(headlineText)) flags.push("⚠️  Legal/regulatory risk in news")
  if (/\b(layoff|layoffs|restructur|job cuts)\b/.test(headlineText)) flags.push("⚠️  Layoffs or restructuring in news")

  return flags
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function getResearch(symbol: string, currentPrice: number): Promise<ResearchSummary> {
  const [overview, forecast, insider] = await Promise.all([
    fetchOverviewData(symbol).catch(() => ({ headlines: [], earningsDaysAway: null, analystConsensus: null, priceTarget: null, sectorName: null, upgrades: 0, downgrades: 0 })),
    fetchForecastData(symbol).catch(() => ({ upgrades: 0, downgrades: 0 })),
    fetchInsiderData(symbol).catch(() => ({ buys: 0, sells: 0 })),
  ])

  const priceTargetUpsidePct = overview.priceTarget && currentPrice > 0
    ? ((overview.priceTarget - currentPrice) / currentPrice) * 100
    : null

  const insiderNetSentiment: ResearchSummary["insiderNetSentiment"] =
    insider.buys > insider.sells * 1.5 ? "bullish"
    : insider.sells > insider.buys * 1.5 ? "bearish"
    : "neutral"

  const flags = buildFlags({
    earningsDaysAway: overview.earningsDaysAway,
    insiderBuys: insider.buys,
    insiderSells: insider.sells,
    upgrades: forecast.upgrades,
    downgrades: forecast.downgrades,
    priceTargetUpsidePct,
    headlines: overview.headlines,
  })

  return {
    symbol,
    recentHeadlines: overview.headlines,
    earningsDaysAway: overview.earningsDaysAway,
    insiderBuyCount: insider.buys,
    insiderSellCount: insider.sells,
    insiderNetSentiment,
    recentUpgrades: forecast.upgrades,
    recentDowngrades: forecast.downgrades,
    analystConsensus: overview.analystConsensus,
    priceTarget: overview.priceTarget,
    priceTargetUpsidePct,
    sectorName: overview.sectorName,
    flags,
  }
}
