export type {
  DashboardData,
  DashboardReconciliation,
  DashboardSummary,
  DividendEntry,
  GuardrailSeverity,
  Holding,
  MarketCalendarEvent,
  PortfolioGuardrail,
  SourceState,
  SourceStatus,
} from "../src/dashboard/types.js";

export interface TickerOverview {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  price: number;
  change: number;
  changePct: number;
  high52: number;
  low52: number;
  volume: number;
  avgVolume: number;
  marketCap: string;
  dividend: string;
  dividendYield: string;
  exDividendDate: string;
  beta: string;
  peRatio: string;
  forwardPE: string;
  pbRatio: string;
  paysRatio: string;
  payoutRatio: string;
  nextEarnings: string;
  eps: string;
  analysts: string;
  analystTarget: string;
  description: string;
}

export interface TickerDividendEntry {
  exDate: string;
  payDate: string;
  amount: number;
}

export interface TickerDividends {
  symbol: string;
  yield: string;
  annual: string;
  frequency: string;
  exDiv: string;
  history: TickerDividendEntry[];
}

export interface PricePoint {
  date: string;
  close: number;
  volume: number;
}

export interface TickerPriceHistory {
  symbol: string;
  points: PricePoint[];
}

export interface ResearchData {
  symbol: string;
  recentHeadlines: string[];
  earningsDaysAway: number | null;
  insiderBuyCount: number;
  insiderSellCount: number;
  insiderNetSentiment: "bullish" | "bearish" | "neutral";
  recentUpgrades: number;
  recentDowngrades: number;
  analystConsensus: string | null;
  priceTarget: number | null;
  priceTargetUpsidePct: number | null;
  sectorName: string | null;
  flags: string[];
}
