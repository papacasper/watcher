import { describe, expect, test } from "bun:test";
import {
  buildDashboardReconciliation,
  calculateHoldingForwardIncome,
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
      150,
      1_200,
      140,
      new Date("2026-04-27T12:00:00Z"),
      new Date("2026-07-27T12:00:00Z")
    );

    expect(metrics.trailing30dIncome).toBe(280);
    expect(metrics.annualizedTrailingIncome).toBe(3360);
    expect(metrics.daysOfFreedom).toBe(2);
    expect(metrics.annualYieldOnCost).toBe(336);
    expect(metrics.lifetimeDividendYieldOnCost).toBe(40);
    expect(metrics.forwardProjectedAnnualIncome).toBeCloseTo(240.66, 2);
  });

  test("calculates dividend goal progress, gaps, and capital required below target", () => {
    const dividends: DividendEntry[] = [
      { symbol: "O", payableDate: "2026-05-27", amount: 8_400, shares: 100, rate: 84, state: "announced" },
      { symbol: "O", payableDate: "2026-06-27", amount: 8_400, shares: 100, rate: 84, state: "projected" },
      { symbol: "O", payableDate: "2026-07-27", amount: 8_400, shares: 100, rate: 84, state: "projected" },
    ];

    const metrics = calculateIncomeMetrics(
      dividends,
      1_000_000,
      0,
      150,
      1_000_000,
      280,
      new Date("2026-04-27T12:00:00Z"),
      new Date("2026-07-27T12:00:00Z")
    );

    expect(metrics.dividendTargetAnnual).toBe(102_200);
    expect(metrics.forwardProjectedDailyIncome).toBeCloseTo(metrics.forwardProjectedAnnualIncome / 365, 6);
    expect(metrics.forwardProjectedAnnualIncome).toBeCloseTo(101_076.92, 2);
    expect(metrics.dividendGoalProgressPct).toBeCloseTo(98.9, 2);
    expect(metrics.dividendIncomeGapAnnual).toBeCloseTo(1_123.08, 2);
    expect(metrics.dividendIncomeGapDaily).toBeCloseTo(3.08, 2);
    expect(metrics.capitalRequiredAtCurrentYield).toBeCloseTo(11_111.11, 2);
  });

  test("zeros dividend goal gaps and required capital when target is met", () => {
    const metrics = calculateIncomeMetrics(
      [{ symbol: "O", payableDate: "2026-05-27", amount: 28_000, shares: 100, rate: 280, state: "announced" }],
      1_000_000,
      0,
      150,
      1_000_000,
      280,
      new Date("2026-04-27T12:00:00Z"),
      new Date("2026-05-27T12:00:00Z")
    );

    expect(metrics.dividendGoalProgressPct).toBe(100);
    expect(metrics.dividendIncomeGapDaily).toBe(0);
    expect(metrics.dividendIncomeGapAnnual).toBe(0);
    expect(metrics.capitalRequiredAtCurrentYield).toBe(0);
  });

  test("returns null capital required when forward yield is unavailable", () => {
    const metrics = calculateIncomeMetrics(
      [],
      1_000,
      0,
      150,
      1_000,
      280,
      new Date("2026-04-27T12:00:00Z"),
      new Date("2026-07-27T12:00:00Z")
    );

    expect(metrics.forwardProjectedAnnualIncome).toBe(0);
    expect(metrics.capitalRequiredAtCurrentYield).toBeNull();
  });
});

describe("dashboard holding forward income", () => {
  test("allocates forward income from announced and projected dividends", () => {
    const holdings: Holding[] = [
      stockHolding("O", 1_000, 1_100),
      stockHolding("SCHD", 2_000, 2_200),
      stockHolding("VTI", 3_000, 3_300),
    ];
    const dividends: DividendEntry[] = [
      { symbol: "O", payableDate: "2026-05-27", amount: 30, shares: 10, rate: 3, state: "announced" },
      { symbol: "O", payableDate: "2026-06-27", amount: 30, shares: 10, rate: 3, state: "projected" },
      { symbol: "SCHD", payableDate: "2026-06-15", amount: 120, shares: 20, rate: 6, state: "announced" },
      { symbol: "VTI", payableDate: "2026-06-15", amount: 999, shares: 30, rate: 33.3, state: "paid" },
    ];

    const enriched = calculateHoldingForwardIncome(
      holdings,
      dividends,
      new Date("2026-04-27T12:00:00Z"),
      new Date("2026-07-27T12:00:00Z")
    );
    const sorted = [...enriched].sort((a, b) => b.forwardAnnualIncome - a.forwardAnnualIncome);

    expect(sorted.map(h => h.symbol)).toEqual(["SCHD", "O", "VTI"]);
    expect(sorted[0]!.forwardAnnualIncome).toBeCloseTo(481.32, 2);
    expect(sorted[1]!.forwardAnnualIncome).toBeCloseTo(240.66, 2);
    expect(sorted[2]!.forwardAnnualIncome).toBe(0);
    expect(sorted[0]!.forwardDailyIncome).toBeCloseTo(sorted[0]!.forwardAnnualIncome / 365, 6);
    expect(sorted[0]!.forwardYieldOnCost).toBeCloseTo(24.07, 2);
    expect(sorted[0]!.forwardYieldOnValue).toBeCloseTo(21.88, 2);
    expect(sorted[0]!.forwardIncomePct).toBeCloseTo(66.67, 2);
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
        forwardAnnualIncome: 0,
        forwardDailyIncome: 0,
        forwardYieldOnCost: 0,
        forwardYieldOnValue: 0,
        forwardIncomePct: 0,
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
        forwardAnnualIncome: 0,
        forwardDailyIncome: 0,
        forwardYieldOnCost: 0,
        forwardYieldOnValue: 0,
        forwardIncomePct: 0,
        heldSince: "2026-01-01",
        type: "REIT",
        source: "stock",
      },
    ];

    expect(visibleDashboardHoldings(holdings).map(h => h.symbol)).toEqual(["O"]);
  });
});

function stockHolding(symbol: string, costBasis: number, value: number): Holding {
  return {
    symbol,
    name: symbol,
    shares: 10,
    avgCost: costBasis / 10,
    costBasis,
    price: value / 10,
    value,
    pnl: value - costBasis,
    pnlPct: costBasis > 0 ? ((value - costBasis) / costBasis) * 100 : 0,
    divsEarned: 0,
    forwardAnnualIncome: 0,
    forwardDailyIncome: 0,
    forwardYieldOnCost: 0,
    forwardYieldOnValue: 0,
    forwardIncomePct: 0,
    heldSince: "2026-01-01",
    type: "Stock",
    source: "stock",
  };
}

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
