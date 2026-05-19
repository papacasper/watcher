export interface Holding {
  symbol: string;
  name: string;
  shares: number;
  avgCost: number;
  costBasis: number;
  price: number;
  value: number;
  pnl: number;
  pnlPct: number;
  divsEarned: number;
  forwardAnnualIncome: number;
  forwardDailyIncome: number;
  forwardYieldOnCost: number;
  forwardYieldOnValue: number;
  forwardIncomePct: number;
  heldSince: string;
  type?: string;
  source?: "stock" | "crypto";
}

export interface DividendEntry {
  symbol: string;
  payableDate: string;
  amount: number;
  shares: number;
  rate: number;
  state: string;
}


export type SourceState = "fresh" | "stale" | "unavailable";

export interface SourceStatus {
  state: SourceState;
  message?: string;
  staleFrom?: string;
}

export interface DashboardReconciliation {
  stockGrossValue: number;
  stockNetValue: number;
  cryptoValue: number;
  netAdjustment: number;
  source: "robinhood_portfolio" | "stock_positions" | "previous_cache";
  stale: boolean;
  errors?: Record<string, string>;
}

export interface DashboardSummary {
  totalCost: number;
  totalValue: number;
  grossHoldingsValue: number;
  netLiquidationValue: number;
  cashBalance: number;
  pnl: number;
  pnlPct: number;
  divsEarned: number;
  last30dIncome: number;
  trailing30dIncome: number;
  annualizedTrailingIncome: number;
  forwardProjectedAnnualIncome: number;
  dividendTargetDaily: number;
  dividendTargetAnnual: number;
  forwardProjectedDailyIncome: number;
  dividendGoalProgressPct: number;
  dividendIncomeGapDaily: number;
  dividendIncomeGapAnnual: number;
  capitalRequiredAtCurrentYield: number | null;
  annualYieldOnCost: number;
  lifetimeDividendYieldOnCost: number;
  dailyCost: number;
  daysOfFreedom: number;
  reconciliation: DashboardReconciliation;
}

export type GuardrailSeverity = "info" | "warning" | "danger";

export interface PortfolioGuardrail {
  id: string;
  severity: GuardrailSeverity;
  title: string;
  detail: string;
  metric?: number;
  threshold?: number;
  symbols?: string[];
}

export interface MarketCalendarEvent {
  date: string;
  label: string;
  type: string;
  days_away: number;
}

export interface DashboardData {
  fetchedAt: string;
  holdings: Holding[];
  dividends: DividendEntry[];
  marketCalendar: MarketCalendarEvent[];
  sourceErrors?: Record<string, string>;
  sourceWarnings?: Record<string, string>;
  sourceStatus?: Record<string, SourceStatus>;
  summary: DashboardSummary;
  guardrails: PortfolioGuardrail[];
}
