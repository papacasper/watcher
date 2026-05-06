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

export interface CardTxEntry {
  date: string;
  amount: number;
  direction: "debit" | "credit";
  state: string;
}

export interface SpendingData {
  uninvestedCash: number;
  withdrawableCash: number;
  buyingPower: number;
  spent30d: number;
  transactions: CardTxEntry[];
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
  annualYieldOnCost: number;
  lifetimeDividendYieldOnCost: number;
  dailyCost: number;
  daysOfFreedom: number;
  reconciliation: DashboardReconciliation;
}

export interface DashboardData {
  fetchedAt: string;
  holdings: Holding[];
  dividends: DividendEntry[];
  spending: SpendingData | null;
  sourceErrors?: Record<string, string>;
  sourceWarnings?: Record<string, string>;
  sourceStatus?: Record<string, SourceStatus>;
  summary: DashboardSummary;
}
