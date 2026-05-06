import { describe, expect, test } from "bun:test";
import {
  buildDashboardReconciliation,
  calculateIncomeMetrics,
  visibleDashboardHoldings,
  type DividendEntry,
  type Holding,
} from "../src/dashboard/data.js";

describe("dashboard income metrics", () => {
  test("separates trailing income, forward projection, and yield-on-cost semantics", () => {
    const dividends: DividendEntry[] = [
      { symbol: "O", payableDate: "2026-04-01", amount: 280, shares: 10, rate: 28, state: "paid" },
      { symbol: "O", payableDate: "2026-02-01", amount: 999, shares: 10, rate: 99.9, state: "paid" },
      { symbol: "O", payableDate: "2026-05-27", amount: 30, shares: 10, rate: 3, state: "announced" },
      { symbol: "O", payableDate: "2026-06-27", amount: 30, shares: 10, rate: 3, state: "projected" },
      { symbol: "O", payableDate: "2026-08-01", amount: 30, shares: 10, rate: 3, state: "projected" },
    ];

    const metrics = calculateIncomeMetrics(
      dividends,
      1_000,
      400,
      280,
      new Date("2026-04-27T12:00:00Z"),
      new Date("2026-07-27T12:00:00Z")
    );

    expect(metrics.trailing30dIncome).toBe(280);
    expect(metrics.annualizedTrailingIncome).toBe(3360);
    expect(metrics.daysOfFreedom).toBe(1);
    expect(metrics.annualYieldOnCost).toBe(336);
    expect(metrics.lifetimeDividendYieldOnCost).toBe(40);
    expect(metrics.forwardProjectedAnnualIncome).toBeCloseTo(240.66, 2);
  });
});

describe("dashboard visible holdings", () => {
  test("keeps crypto out of the holdings table and allocation data", () => {
    const holdings: Holding[] = [
      {
        symbol: "BTC",
        name: "Bitcoin",
        shares: 0.01,
        avgCost: 50_000,
        costBasis: 500,
        price: 70_000,
        value: 700,
        pnl: 200,
        pnlPct: 40,
        divsEarned: 0,
        heldSince: "2026-04-01",
        type: "Crypto",
        source: "crypto",
      },
      {
        symbol: "O",
        name: "Realty Income",
        shares: 10,
        avgCost: 50,
        costBasis: 500,
        price: 60,
        value: 600,
        pnl: 100,
        pnlPct: 20,
        divsEarned: 12,
        heldSince: "2026-01-01",
        type: "REIT",
        source: "stock",
      },
    ];

    expect(visibleDashboardHoldings(holdings).map(h => h.symbol)).toEqual(["O"]);
  });
});

describe("dashboard reconciliation", () => {
  test("separates hidden crypto value from visible stock holdings", () => {
    const reconciliation = buildDashboardReconciliation({
      stockGrossValue: 7_900,
      stockNetValue: 6_980,
      cryptoValue: 70,
      source: "robinhood_portfolio",
      stale: false,
    });

    expect(reconciliation.stockGrossValue).toBe(7_900);
    expect(reconciliation.stockNetValue).toBe(6_980);
    expect(reconciliation.cryptoValue).toBe(70);
    expect(reconciliation.netAdjustment).toBe(-850);
  });

  test("keeps reconciliation errors scoped to the hidden adjustment", () => {
    const reconciliation = buildDashboardReconciliation({
      stockGrossValue: 100,
      stockNetValue: 95,
      cryptoValue: 5,
      source: "previous_cache",
      stale: true,
      errors: { cryptoPrices: "stale quote" },
    });

    expect(reconciliation.stale).toBe(true);
    expect(reconciliation.errors).toEqual({ cryptoPrices: "stale quote" });
    expect(reconciliation.netAdjustment).toBe(0);
  });
});
