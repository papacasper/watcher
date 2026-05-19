import type {
  ScreenerCandidate,
  FinancialHealth,
  MomentumSignal,
  AdvisorResult,
  ScoreBreakdown,
  ScoreCategory,
} from "./types.js"

function clamp(v: number, min = 0, max = 100): number {
  return Math.min(Math.max(v, min), max)
}

interface Signal {
  label: string
  points: number
}

function scoreValuation(c: ScreenerCandidate): { score: number; signals: Signal[] } {
  const signals: Signal[] = []
  let pts = 0

  if (c.peRatio !== null) {
    if (c.peRatio >= 10 && c.peRatio <= 20) { pts += 30; signals.push({ label: `PE ${c.peRatio.toFixed(1)} in attractive 10–20 range`, points: 30 }) }
    else if (c.peRatio > 20 && c.peRatio <= 30) { pts += 20; signals.push({ label: `PE ${c.peRatio.toFixed(1)} reasonable at 20–30`, points: 20 }) }
    else if (c.peRatio > 30) { pts += 5; signals.push({ label: `PE ${c.peRatio.toFixed(1)} elevated above 30`, points: 5 }) }
    else if (c.peRatio < 10 && c.peRatio > 0) { pts += 15; signals.push({ label: `PE ${c.peRatio.toFixed(1)} very low (possible value)`, points: 15 }) }
  }

  if (c.forwardPE !== null && c.peRatio !== null && c.forwardPE > 0 && c.forwardPE < c.peRatio) {
    pts += 20
    signals.push({ label: `Forward PE ${c.forwardPE.toFixed(1)} below trailing — earnings growing`, points: 20 })
  }

  if (c.pbRatio !== null && c.pbRatio > 0) {
    if (c.pbRatio < 1) { pts += 30; signals.push({ label: `P/B ${c.pbRatio.toFixed(2)} below book value`, points: 30 }) }
    else if (c.pbRatio < 3) { pts += 20; signals.push({ label: `P/B ${c.pbRatio.toFixed(2)} below 3x`, points: 20 }) }
  }

  if (c.evEbitda !== null && c.evEbitda > 0) {
    if (c.evEbitda < 10) { pts += 30; signals.push({ label: `EV/EBITDA ${c.evEbitda.toFixed(1)} very attractive <10x`, points: 30 }) }
    else if (c.evEbitda < 15) { pts += 20; signals.push({ label: `EV/EBITDA ${c.evEbitda.toFixed(1)} reasonable <15x`, points: 20 }) }
  }

  if (c.psRatio !== null && c.psRatio > 0 && c.psRatio < 3) {
    pts += 10
    signals.push({ label: `P/S ${c.psRatio.toFixed(2)} below 3x`, points: 10 })
  }

  return { score: clamp(pts), signals }
}

function scoreGrowth(c: ScreenerCandidate, h: FinancialHealth): { score: number; signals: Signal[] } {
  const signals: Signal[] = []
  let pts = 0

  if (c.revenueGrowthYoy !== null) {
    if (c.revenueGrowthYoy > 20) { pts += 40; signals.push({ label: `Revenue growth ${c.revenueGrowthYoy.toFixed(1)}% YoY (strong)`, points: 40 }) }
    else if (c.revenueGrowthYoy > 10) { pts += 25; signals.push({ label: `Revenue growth ${c.revenueGrowthYoy.toFixed(1)}% YoY (solid)`, points: 25 }) }
    else if (c.revenueGrowthYoy > 5) { pts += 15; signals.push({ label: `Revenue growth ${c.revenueGrowthYoy.toFixed(1)}% YoY (moderate)`, points: 15 }) }
  }

  if (c.epsGrowthYoy !== null) {
    if (c.epsGrowthYoy > 20) { pts += 40; signals.push({ label: `EPS growth ${c.epsGrowthYoy.toFixed(1)}% YoY (strong)`, points: 40 }) }
    else if (c.epsGrowthYoy > 10) { pts += 25; signals.push({ label: `EPS growth ${c.epsGrowthYoy.toFixed(1)}% YoY (solid)`, points: 25 }) }
  }

  if (h.revenueGrowth3yr !== null && h.revenueGrowth3yr > 15) {
    pts += 20
    signals.push({ label: `3yr revenue CAGR ${h.revenueGrowth3yr.toFixed(1)}% sustained growth`, points: 20 })
  }

  if (h.freeCashFlowGrowth !== null && h.freeCashFlowGrowth > 0) {
    pts += 15
    signals.push({ label: `FCF growing ${h.freeCashFlowGrowth.toFixed(1)}% YoY`, points: 15 })
  }

  return { score: clamp(pts), signals }
}

function scoreQuality(c: ScreenerCandidate, h: FinancialHealth): { score: number; signals: Signal[] } {
  const signals: Signal[] = []
  let pts = 0

  const margin = c.netMargin ?? h.netMargin
  if (margin !== null) {
    if (margin > 20) { pts += 30; signals.push({ label: `Net margin ${margin.toFixed(1)}% excellent`, points: 30 }) }
    else if (margin > 10) { pts += 20; signals.push({ label: `Net margin ${margin.toFixed(1)}% healthy`, points: 20 }) }
    else if (margin > 5) { pts += 10; signals.push({ label: `Net margin ${margin.toFixed(1)}% acceptable`, points: 10 }) }
  }

  const roe = c.returnOnEquity
  if (roe !== null) {
    if (roe > 20) { pts += 30; signals.push({ label: `ROE ${roe.toFixed(1)}% exceptional`, points: 30 }) }
    else if (roe > 15) { pts += 20; signals.push({ label: `ROE ${roe.toFixed(1)}% strong`, points: 20 }) }
  }

  const de = c.debtToEquity
  if (de !== null) {
    if (de < 0.5) { pts += 20; signals.push({ label: `Debt/equity ${de.toFixed(2)} very low`, points: 20 }) }
    else if (de < 1) { pts += 10; signals.push({ label: `Debt/equity ${de.toFixed(2)} manageable`, points: 10 }) }
  }

  const cr = c.currentRatio
  if (cr !== null) {
    if (cr > 2) { pts += 20; signals.push({ label: `Current ratio ${cr.toFixed(2)} — strong liquidity`, points: 20 }) }
    else if (cr > 1.5) { pts += 10; signals.push({ label: `Current ratio ${cr.toFixed(2)} adequate`, points: 10 }) }
  }

  if (h.freeCashFlow !== null && h.freeCashFlow > 0) {
    pts += 15
    signals.push({ label: `Positive FCF $${(h.freeCashFlow / 1000).toFixed(1)}B`, points: 15 })
  }

  return { score: clamp(pts), signals }
}

function scoreMomentum(m: MomentumSignal): { score: number; signals: Signal[] } {
  const signals: Signal[] = []
  let pts = 0

  if (m.goldenCross === true) { pts += 30; signals.push({ label: "Golden cross (MA50 > MA200)", points: 30 }) }

  if (m.aboveMa50 === true && m.aboveMa200 === true) { pts += 20; signals.push({ label: "Price above both MA50 and MA200", points: 20 }) }

  if (m.rsi14 !== null) {
    if (m.rsi14 >= 40 && m.rsi14 <= 60) { pts += 20; signals.push({ label: `RSI ${m.rsi14.toFixed(0)} neutral-healthy zone`, points: 20 }) }
    else if (m.rsi14 > 60 && m.rsi14 <= 70) { pts += 10; signals.push({ label: `RSI ${m.rsi14.toFixed(0)} bullish momentum`, points: 10 }) }
    else if (m.rsi14 < 40) { pts -= 10; signals.push({ label: `RSI ${m.rsi14.toFixed(0)} oversold territory`, points: -10 }) }
  }

  if (m.change1M !== null && m.change3M !== null && m.change1M > 0 && m.change3M > 0) {
    pts += 20
    signals.push({ label: `Up ${m.change1M.toFixed(1)}% 1M / ${m.change3M.toFixed(1)}% 3M`, points: 20 })
  }

  return { score: clamp(pts), signals }
}

function scoreAnalyst(c: ScreenerCandidate, research?: import("./research.js").ResearchSummary | null): { score: number; signals: Signal[] } {
  const signals: Signal[] = []
  let pts = 0

  // Prefer research consensus (fetched from overview page) over screener counts
  const consensus = research?.analystConsensus ?? (() => {
    const total = (c.analystBuys ?? 0) + (c.analystHolds ?? 0) + (c.analystSells ?? 0)
    const buys = c.analystBuys ?? 0
    const sells = c.analystSells ?? 0
    if (total === 0) return "N/A"
    const buyRatio = buys / total
    const sellRatio = sells / total
    if (buyRatio >= 0.7) return "Strong Buy"
    if (buyRatio >= 0.5) return "Buy"
    if (sellRatio >= 0.5) return "Sell"
    return "Hold"
  })()

  if (consensus?.toLowerCase().includes("strong buy")) { pts += 80; signals.push({ label: `Analyst consensus: ${consensus}`, points: 80 }) }
  else if (consensus?.toLowerCase().includes("buy")) { pts += 60; signals.push({ label: `Analyst consensus: ${consensus}`, points: 60 }) }
  else if (consensus?.toLowerCase().includes("hold")) { pts += 30; signals.push({ label: `Analyst consensus: Hold`, points: 30 }) }
  else if (consensus?.toLowerCase().includes("sell")) { pts += 10; signals.push({ label: `Analyst consensus: Sell`, points: 10 }) }

  const upsidePct = research?.priceTargetUpsidePct ?? (c.analystTarget !== null && c.price > 0
    ? ((c.analystTarget - c.price) / c.price) * 100
    : null)
  if (upsidePct !== null && upsidePct > 20) {
    pts += 20
    signals.push({ label: `Analyst target implies ${upsidePct.toFixed(1)}% upside`, points: 20 })
  }

  return { score: clamp(pts), signals }
}

export function scoreCandidate(
  candidate: ScreenerCandidate,
  health: FinancialHealth,
  momentum: MomentumSignal,
  research?: import("./research.js").ResearchSummary | null,
): AdvisorResult {
  const categories: { category: ScoreCategory; weight: number; result: { score: number; signals: Signal[] } }[] = [
    { category: "valuation", weight: 25, result: scoreValuation(candidate) },
    { category: "growth", weight: 25, result: scoreGrowth(candidate, health) },
    { category: "quality", weight: 25, result: scoreQuality(candidate, health) },
    { category: "momentum", weight: 15, result: scoreMomentum(momentum) },
    { category: "analyst", weight: 10, result: scoreAnalyst(candidate, research) },
  ]

  const totalWeight = categories.reduce((a, c) => a + c.weight, 0)
  const totalScore = categories.reduce((a, c) => a + (c.result.score * c.weight) / totalWeight, 0)

  const breakdown: ScoreBreakdown[] = categories.map(c => ({
    category: c.category,
    score: c.result.score,
    weight: c.weight,
    signals: c.result.signals.map(s => s.label),
  }))

  // Top 3 reasons: pick highest-point signals across all categories
  const allSignals = categories.flatMap(c => c.result.signals).sort((a, b) => b.points - a.points)
  const topReasons = allSignals.slice(0, 3).map(s => s.label)

  // Risks
  const risks: string[] = []
  if (candidate.debtToEquity !== null && candidate.debtToEquity > 1.5)
    risks.push(`High debt/equity ratio (${candidate.debtToEquity.toFixed(2)})`)
  if (candidate.peRatio !== null && candidate.peRatio > 40)
    risks.push(`Elevated PE ratio (${candidate.peRatio.toFixed(1)}x) — priced for perfection`)
  if (momentum.rsi14 !== null && momentum.rsi14 > 75)
    risks.push(`RSI ${momentum.rsi14.toFixed(0)} — overbought, pullback risk`)
  if (momentum.change3M !== null && momentum.change3M < -20)
    risks.push(`Down ${Math.abs(momentum.change3M).toFixed(1)}% over 3 months — negative trend`)
  if (health.freeCashFlow !== null && health.freeCashFlow < 0)
    risks.push(`Negative free cash flow ($${(health.freeCashFlow / 1000).toFixed(1)}B)`)

  let recommendation: AdvisorResult["recommendation"]
  if (totalScore >= 72) recommendation = "Strong Buy"
  else if (totalScore >= 58) recommendation = "Buy"
  else if (totalScore >= 42) recommendation = "Watch"
  else recommendation = "Avoid"

  return {
    symbol: candidate.symbol,
    name: candidate.name,
    price: candidate.price,
    totalScore: Math.round(totalScore * 10) / 10,
    recommendation,
    breakdown,
    topReasons,
    risks: risks.slice(0, 2),
    research: null,
    fetchedAt: new Date().toISOString(),
  }
}
