export interface ScreenerCandidate {
  symbol: string
  name: string
  marketCap: number
  peRatio: number | null
  forwardPE: number | null
  pbRatio: number | null
  psRatio: number | null
  evEbitda: number | null
  epsGrowthYoy: number | null
  revenueGrowthYoy: number | null
  netMargin: number | null
  returnOnEquity: number | null
  debtToEquity: number | null
  currentRatio: number | null
  dividendYield: number | null
  price: number
  change1W: number | null
  change1M: number | null
  change3M: number | null
  analystBuys: number | null
  analystHolds: number | null
  analystSells: number | null
  analystTarget: number | null
}

export interface FinancialHealth {
  symbol: string
  freeCashFlow: number | null
  freeCashFlowGrowth: number | null
  revenueGrowth3yr: number | null
  epsGrowth3yr: number | null
  grossMargin: number | null
  operatingMargin: number | null
  netMargin: number | null
  returnOnEquity: number | null
  returnOnAssets: number | null
  debtToEquity: number | null
  currentRatio: number | null
  interestCoverage: number | null
}

export interface MomentumSignal {
  symbol: string
  price: number
  ma50: number | null
  ma200: number | null
  aboveMa50: boolean | null
  aboveMa200: boolean | null
  goldenCross: boolean | null
  rsi14: number | null
  change1W: number | null
  change1M: number | null
  change3M: number | null
  nearHigh52w: boolean | null
  nearLow52w: boolean | null
}

export interface AnalystSignal {
  symbol: string
  consensus: "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell" | "N/A"
  buyCount: number
  holdCount: number
  sellCount: number
  priceTarget: number | null
  currentPrice: number
  upsidePct: number | null
}

export type ScoreCategory = "valuation" | "growth" | "quality" | "momentum" | "analyst"

export interface ScoreBreakdown {
  category: ScoreCategory
  score: number
  weight: number
  signals: string[]
}

export interface AdvisorResult {
  symbol: string
  name: string
  price: number
  totalScore: number
  recommendation: "Strong Buy" | "Buy" | "Watch" | "Avoid"
  breakdown: ScoreBreakdown[]
  topReasons: string[]
  risks: string[]
  research: import("./research.js").ResearchSummary | null
  fetchedAt: string
}

export interface AdvisorReport {
  generatedAt: string
  candidates: number
  results: AdvisorResult[]
}
