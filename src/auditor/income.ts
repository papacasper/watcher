/**
 * income.ts
 * Days of Freedom Income Auditor
 * Uses robin_stocks-patterned Robinhood TS API
 */

import { RobinhoodAuth } from "../robinhood/auth.js";
import { getLatestPriceMap } from "../robinhood/stocks.js";
import { fetchAuditSnapshot } from "./snapshot.js";
import { loadDailyCost, loadOptionalRobinhoodCredentials } from "../config.js";

export interface DividendRecord {
  symbol: string;
  amount: number;
  date: string;
  reinvested: boolean;
  rate?: string;
  position?: string;
}

export interface PortfolioHolding {
  symbol: string;
  shares: number;
  costBasis: number;
  currentPrice?: number;
  annualDividend?: number;
}

export interface IncomeSummary {
  totalDividends: number;
  yieldOnCost: number;
  daysOfFreedom: number;
  monthlyAvg: number;
  annualDividend: number;
  records: DividendRecord[];
  holdings: PortfolioHolding[];
}

export class DaysOfFreedomAuditor {
  private auth: RobinhoodAuth;
  private dailyCost: number;

  constructor(auth?: RobinhoodAuth) {
    this.auth = auth ?? new RobinhoodAuth();
    this.dailyCost = loadDailyCost();
  }

  calculateDaysOfFreedom(monthlyDividends: number): number {
    return Math.floor(monthlyDividends / this.dailyCost);
  }

  async fetchDividends(): Promise<DividendRecord[]> {
    await this.ensureAuthenticated();
    return (await fetchAuditSnapshot()).dividends;
  }

  async fetchHoldings(): Promise<PortfolioHolding[]> {
    await this.ensureAuthenticated();
    return (await fetchAuditSnapshot()).holdings;
  }

  calculateYieldOnCost(holding: PortfolioHolding): number {
    if (holding.costBasis === 0) return 0;
    return (holding.annualDividend ?? 0) / holding.costBasis;
  }

  async generateReport(): Promise<IncomeSummary> {
    await this.ensureAuthenticated();
    const { dividends, holdings: snapshotHoldings } = await fetchAuditSnapshot();
    const holdings: PortfolioHolding[] = snapshotHoldings.map(h => ({ ...h }));

    // Get current prices for all holding symbols
    const symbols = holdings.map(h => h.symbol);
    const priceMap = symbols.length > 0
      ? await getLatestPriceMap(symbols)
      : new Map<string, number>();

    // Enrich holdings with current prices
    for (const h of holdings) {
      h.currentPrice = priceMap.get(h.symbol) ?? 0;
    }

    const last30Days = dividends.filter(d => {
      const diff = Date.now() - new Date(d.date).getTime();
      return diff >= 0 && diff <= 30 * 24 * 60 * 60 * 1000;
    });

    // Calculate totals
    let totalCostBasis = 0;
    let totalAnnualDividend = 0;
    const last30BySymbol = new Map<string, number>();
    for (const d of last30Days) {
      const current = last30BySymbol.get(d.symbol) ?? 0;
      last30BySymbol.set(d.symbol, current + d.amount);
    }

    for (const h of holdings) {
      totalCostBasis += h.costBasis;
      const divEstimate = last30BySymbol.get(h.symbol) ?? 0;
      totalAnnualDividend += divEstimate * 12;
    }

    const monthlyAvg = last30Days.reduce((sum, r) => sum + r.amount, 0);

    const yieldOnCost = totalCostBasis > 0 ? (totalAnnualDividend / totalCostBasis) : 0;
    const daysOfFreedom = this.calculateDaysOfFreedom(monthlyAvg);

    return {
      totalDividends: dividends.reduce((sum, d) => sum + d.amount, 0),
      yieldOnCost: yieldOnCost * 100,
      daysOfFreedom,
      monthlyAvg,
      annualDividend: totalAnnualDividend,
      records: dividends.slice(0, 30),
      holdings
    };
  }

  private async ensureAuthenticated(): Promise<void> {
    if (this.auth.isLoggedIn()) return;

    const credentials = loadOptionalRobinhoodCredentials();
    if (!credentials) return;

    await this.auth.login(credentials);
  }
}

export default DaysOfFreedomAuditor;
