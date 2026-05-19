import { describe, expect, test } from "bun:test";
import { computeGuardrails } from "../src/dashboard/guardrails.js";
import type { DashboardReconciliation, Holding } from "../src/dashboard/types.js";

const baseRecon: DashboardReconciliation = {
  stockGrossValue: 10_000,
  stockNetValue: 10_000,
  cryptoValue: 0,
  netAdjustment: 0,
  source: "stock_positions",
  stale: false,
};

function makeHolding(overrides: Partial<Holding>): Holding {
  return {
    symbol: "TEST",
    name: "Test Corp",
    shares: 10,
    avgCost: 50,
    costBasis: 500,
    price: 50,
    value: 500,
    pnl: 0,
    pnlPct: 0,
    divsEarned: 0,
    forwardAnnualIncome: 0,
    forwardDailyIncome: 0,
    forwardYieldOnCost: 0,
    forwardYieldOnValue: 0,
    forwardIncomePct: 0,
    heldSince: "2024-01-01",
    source: "stock",
    ...overrides,
  };
}

describe("math integrity guardrails", () => {
  test("malformed holding with zero price produces danger guardrail", () => {
    const h = makeHolding({ price: 0, value: 0 });
    const results = computeGuardrails([h], [], baseRecon, undefined, 500, 0);
    const ids = results.map(g => g.id);
    expect(ids).toContain("missing-price-or-cost");
    const g = results.find(g => g.id === "missing-price-or-cost")!;
    expect(g.severity).toBe("danger");
  });

  test("missing cost basis produces danger guardrail", () => {
    const h = makeHolding({ avgCost: 0, costBasis: 0 });
    const results = computeGuardrails([h], [], baseRecon, undefined, 500, 0);
    const g = results.find(g => g.id === "missing-price-or-cost");
    expect(g).toBeDefined();
    expect(g!.symbols).toContain("TEST");
  });

  test("normal fixture data produces no math-integrity guardrails", () => {
    const h = makeHolding({ value: 10_000, forwardIncomePct: 100 });
    const results = computeGuardrails([h], [], baseRecon, undefined, 10_000, 0);
    const mathIds = ["missing-price-or-cost", "allocation-total-mismatch", "income-share-mismatch", "net-reconciliation-large"];
    for (const id of mathIds) {
      expect(results.find(g => g.id === id)).toBeUndefined();
    }
  });

  test("allocation total mismatch produces danger guardrail", () => {
    const h = makeHolding({ value: 5_000 });
    const results = computeGuardrails([h], [], baseRecon, undefined, 10_000, 0);
    const g = results.find(g => g.id === "allocation-total-mismatch");
    expect(g).toBeDefined();
    expect(g!.severity).toBe("danger");
  });

  test("stale dividend source produces warning without failing", () => {
    const h = makeHolding({ value: 10_000, forwardIncomePct: 100 });
    const sourceStatus = {
      dividends: { state: "stale" as const, message: "fetch failed", staleFrom: "2026-05-01T00:00:00Z" },
    };
    const results = computeGuardrails([h], [], baseRecon, sourceStatus, 10_000, 0);
    const g = results.find(g => g.id === "stale-income-source");
    expect(g).toBeDefined();
    expect(g!.severity).toBe("warning");
    expect(results.some(g => g.severity === "danger")).toBe(false);
  });
});

describe("concentration guardrails", () => {
  test("single position above 25% of gross value produces warning", () => {
    const h = makeHolding({ symbol: "BIGCO", value: 3_000 });
    const results = computeGuardrails([h], [], baseRecon, undefined, 10_000, 0);
    const g = results.find(g => g.id === "position-concentration-BIGCO");
    expect(g).toBeDefined();
    expect(g!.severity).toBe("warning");
    expect(g!.metric).toBeCloseTo(30, 0);
  });

  test("single position below 25% of gross value does not produce concentration warning", () => {
    const h = makeHolding({ symbol: "SMALL", value: 2_000 });
    const results = computeGuardrails([h], [], baseRecon, undefined, 10_000, 0);
    expect(results.find(g => g.id === "position-concentration-SMALL")).toBeUndefined();
  });

  test("income concentration above 30% produces warning", () => {
    const h = makeHolding({ symbol: "DIVY", forwardAnnualIncome: 400, forwardIncomePct: 40 });
    const results = computeGuardrails([h], [], baseRecon, undefined, 10_000, 1_000);
    const g = results.find(g => g.id === "income-concentration-DIVY");
    expect(g).toBeDefined();
    expect(g!.severity).toBe("warning");
  });
});

describe("risky product guardrails", () => {
  test("leveraged ETF name triggers risky-product flag", () => {
    const h = makeHolding({ symbol: "TQQQ", name: "ProShares UltraPro QQQ 3x" });
    const results = computeGuardrails([h], [], baseRecon, undefined, 10_000, 0);
    const g = results.find(g => g.id === "leveraged-fund-TQQQ");
    expect(g).toBeDefined();
    expect(g!.severity).toBe("info");
    expect(g!.detail).not.toMatch(/\b(buy|sell|rebalance|hedge|recommended action)\b/i);
  });

  test("covered-call name triggers risky-product flag", () => {
    const h = makeHolding({ symbol: "FAKE", name: "Covered Call Income ETF" });
    const results = computeGuardrails([h], [], baseRecon, undefined, 10_000, 0);
    expect(results.find(g => g.id === "covered-call-income-fund-FAKE")).toBeDefined();
    expect(results.find(g => g.id === "options-income-risk-FAKE")).toBeDefined();
  });

  test("leveraged name triggers leveraged-fund guardrail", () => {
    const h = makeHolding({ symbol: "FAKE2", name: "Direxion Daily Bull 2X Shares Leveraged" });
    const results = computeGuardrails([h], [], baseRecon, undefined, 10_000, 0);
    expect(results.find(g => g.id === "leveraged-fund-FAKE2")).toBeDefined();
  });

  test("plain stock produces no risky-product guardrail", () => {
    const h = makeHolding({ symbol: "O", name: "Realty Income Corp" });
    const results = computeGuardrails([h], [], baseRecon, undefined, 10_000, 0);
    expect(results.find(g => g.id.endsWith("-O"))).toBeUndefined();
  });
});

describe("guardrail text is neutral", () => {
  test("no guardrail text contains directive language", () => {
    const holdings = [
      makeHolding({ symbol: "BIGCO", value: 4_000, forwardAnnualIncome: 600, forwardIncomePct: 60, forwardYieldOnValue: 15, pnlPct: -10 }),
      makeHolding({ symbol: "TSLL", name: "Direxion Daily TSLA Bull 2X Shares", value: 1_000, forwardAnnualIncome: 0, forwardIncomePct: 0 }),
    ];
    const recon = { ...baseRecon, stockGrossValue: 10_000, stockNetValue: 10_000 };
    const results = computeGuardrails(holdings, [], recon, undefined, 10_000, 1_000);
    const directive = /\b(buy|sell|rebalance|hedge|reduce|increase|add|remove|short|options strategy)\b/i;
    for (const g of results) {
      expect(g.title).not.toMatch(directive);
      expect(g.detail).not.toMatch(directive);
    }
  });
});
