import type { DashboardReconciliation, Holding, DividendEntry, PortfolioGuardrail, SourceStatus } from "./types.js";

const ALLOCATION_TOLERANCE = 0.02;
const INCOME_SHARE_TOLERANCE = 0.05;
const NET_RECON_THRESHOLD = 0.10;
const MAX_POSITION_PCT = 0.25;
const MAX_TYPE_PCT = 0.70;
const MAX_INCOME_SHARE_PCT = 0.30;
const HIGH_YIELD_PCT = 12;
const MEANINGFUL_INCOME_PCT = 0.05;

const LEVERAGED_PATTERN = /\b(2x|3x|ultra|2×|3×|daily\s+bull|daily\s+bear|leveraged)\b/i;
const INVERSE_PATTERN = /\b(inverse|short\s+|bear\s+|ultrashort|-1x|-2x|-3x)\b/i;
const COVERED_CALL_PATTERN = /\b(covered.?call|buy.?write)\b/i;
const SINGLE_STOCK_PATTERN = /\b(single.?stock|leveraged\s+[A-Z]{1,5}\s+(bull|bear))\b/i;

function push(results: PortfolioGuardrail[], g: PortfolioGuardrail) {
  results.push(g);
}

export function computeGuardrails(
  holdings: Holding[],
  dividends: DividendEntry[],
  reconciliation: DashboardReconciliation,
  sourceStatus: Record<string, SourceStatus> | undefined,
  grossStockValue: number,
  forwardProjectedAnnualIncome: number,
): PortfolioGuardrail[] {
  const results: PortfolioGuardrail[] = [];

  checkMissingPriceOrCost(results, holdings);
  checkAllocationTotalMismatch(results, holdings, grossStockValue);
  checkIncomeShareMismatch(results, holdings, forwardProjectedAnnualIncome);
  checkNetReconciliationLarge(results, reconciliation);
  checkStaleSources(results, sourceStatus);
  checkPositionConcentration(results, holdings, grossStockValue);
  checkTypeConcentration(results, holdings, grossStockValue);
  checkIncomeConcentration(results, holdings, forwardProjectedAnnualIncome);
  checkHighForwardYield(results, holdings);
  checkNegativeReturnHighIncome(results, holdings, forwardProjectedAnnualIncome);
  checkRiskyProducts(results, holdings);

  results.sort((a, b) => {
    const order = { danger: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });

  return results;
}

function checkMissingPriceOrCost(results: PortfolioGuardrail[], holdings: Holding[]) {
  const bad = holdings.filter(h => h.source !== "crypto" && (h.price <= 0 || h.value <= 0 || h.shares <= 0 || h.costBasis <= 0 || h.avgCost <= 0));
  if (bad.length === 0) return;
  push(results, {
    id: "missing-price-or-cost",
    severity: "danger",
    title: "Holdings with missing or zero data",
    detail: `${bad.length} holding(s) have zero or invalid price, value, shares, or cost basis. Dashboard totals may be understated.`,
    symbols: bad.map(h => h.symbol),
  });
}

function checkAllocationTotalMismatch(results: PortfolioGuardrail[], holdings: Holding[], grossStockValue: number) {
  if (grossStockValue <= 0) return;
  const sumValues = holdings.filter(h => h.source !== "crypto").reduce((s, h) => s + h.value, 0);
  const diff = Math.abs(sumValues - grossStockValue) / grossStockValue;
  if (diff <= ALLOCATION_TOLERANCE) return;
  push(results, {
    id: "allocation-total-mismatch",
    severity: "danger",
    title: "Allocation totals do not reconcile",
    detail: `Visible holding values sum to ${pct(diff)} difference from reported gross stock value. Dashboard numbers may be inconsistent.`,
    metric: diff * 100,
    threshold: ALLOCATION_TOLERANCE * 100,
  });
}

function checkIncomeShareMismatch(results: PortfolioGuardrail[], holdings: Holding[], forwardProjectedAnnualIncome: number) {
  if (forwardProjectedAnnualIncome <= 0) return;
  const sumPct = holdings.reduce((s, h) => s + (h.forwardIncomePct ?? 0), 0);
  const diff = Math.abs(sumPct - 100);
  if (diff <= INCOME_SHARE_TOLERANCE * 100) return;
  push(results, {
    id: "income-share-mismatch",
    severity: "danger",
    title: "Income share percentages do not sum to 100%",
    detail: `Per-position forward income shares sum to ${sumPct.toFixed(1)}%, expected ~100%. Projected income breakdown may be unreliable.`,
    metric: sumPct,
  });
}

function checkNetReconciliationLarge(results: PortfolioGuardrail[], reconciliation: DashboardReconciliation) {
  const { stockGrossValue, stockNetValue } = reconciliation;
  if (stockGrossValue <= 0) return;
  const diff = Math.abs(stockNetValue - stockGrossValue) / stockGrossValue;
  if (diff <= NET_RECON_THRESHOLD) return;
  push(results, {
    id: "net-reconciliation-large",
    severity: "warning",
    title: "Net liquidation differs significantly from stock gross value",
    detail: `Net liquidation is ${pct(diff)} different from visible stock gross value, beyond the typical crypto/cash adjustment range.`,
    metric: diff * 100,
    threshold: NET_RECON_THRESHOLD * 100,
  });
}

function checkStaleSources(results: PortfolioGuardrail[], sourceStatus: Record<string, SourceStatus> | undefined) {
  if (!sourceStatus) return;
  const incomeRelated = ["dividends", "announcedDividends"];
  const stale = incomeRelated.filter(k => sourceStatus[k]?.state === "stale");
  if (stale.length === 0) return;
  push(results, {
    id: "stale-income-source",
    severity: "warning",
    title: "Dividend data is being served from a previous refresh",
    detail: `Income sources are stale: ${stale.join(", ")}. Projected income figures reflect an earlier fetch and may not include recent announcements.`,
  });
}

function checkPositionConcentration(results: PortfolioGuardrail[], holdings: Holding[], grossStockValue: number) {
  if (grossStockValue <= 0) return;
  const stockHoldings = holdings.filter(h => h.source !== "crypto");
  for (const h of stockHoldings) {
    const share = h.value / grossStockValue;
    if (share < MAX_POSITION_PCT) continue;
    push(results, {
      id: `position-concentration-${h.symbol}`,
      severity: "warning",
      title: `${h.symbol} is a large share of the portfolio`,
      detail: `${h.symbol} represents ${pct(share)} of gross stock value. Single-position concentration above ${pct(MAX_POSITION_PCT)}.`,
      metric: share * 100,
      threshold: MAX_POSITION_PCT * 100,
      symbols: [h.symbol],
    });
  }
}

function checkTypeConcentration(results: PortfolioGuardrail[], holdings: Holding[], grossStockValue: number) {
  if (grossStockValue <= 0) return;
  const byType: Record<string, number> = {};
  for (const h of holdings.filter(h => h.source !== "crypto")) {
    const t = h.type ?? "Stock";
    byType[t] = (byType[t] ?? 0) + h.value;
  }
  for (const [type, val] of Object.entries(byType)) {
    const share = val / grossStockValue;
    if (share < MAX_TYPE_PCT) continue;
    push(results, {
      id: `type-concentration-${type.toLowerCase()}`,
      severity: "warning",
      title: `${type} holdings are a large share of the portfolio`,
      detail: `${type} positions represent ${pct(share)} of gross stock value. Asset type concentration above ${pct(MAX_TYPE_PCT)}.`,
      metric: share * 100,
      threshold: MAX_TYPE_PCT * 100,
    });
  }
}

function checkIncomeConcentration(results: PortfolioGuardrail[], holdings: Holding[], forwardProjectedAnnualIncome: number) {
  if (forwardProjectedAnnualIncome <= 0) return;
  for (const h of holdings) {
    const share = (h.forwardAnnualIncome ?? 0) / forwardProjectedAnnualIncome;
    if (share < MAX_INCOME_SHARE_PCT) continue;
    push(results, {
      id: `income-concentration-${h.symbol}`,
      severity: "warning",
      title: `${h.symbol} contributes a large share of projected income`,
      detail: `${h.symbol} contributes ${pct(share)} of projected annual dividend income. Income concentration above ${pct(MAX_INCOME_SHARE_PCT)}.`,
      metric: share * 100,
      threshold: MAX_INCOME_SHARE_PCT * 100,
      symbols: [h.symbol],
    });
  }
}

function checkHighForwardYield(results: PortfolioGuardrail[], holdings: Holding[]) {
  for (const h of holdings) {
    const yov = h.forwardYieldOnValue ?? 0;
    if (yov < HIGH_YIELD_PCT) continue;
    push(results, {
      id: `high-forward-yield-${h.symbol}`,
      severity: "info",
      title: `${h.symbol} has an unusually high forward yield`,
      detail: `${h.symbol} forward yield on current value is ${yov.toFixed(1)}%, above the ${HIGH_YIELD_PCT}% threshold. High yields can reflect elevated risk or special distribution structures.`,
      metric: yov,
      threshold: HIGH_YIELD_PCT,
      symbols: [h.symbol],
    });
  }
}

function checkNegativeReturnHighIncome(results: PortfolioGuardrail[], holdings: Holding[], forwardProjectedAnnualIncome: number) {
  if (forwardProjectedAnnualIncome <= 0) return;
  for (const h of holdings) {
    if (h.pnlPct >= 0) continue;
    const incomeShare = (h.forwardAnnualIncome ?? 0) / forwardProjectedAnnualIncome;
    if (incomeShare < MEANINGFUL_INCOME_PCT) continue;
    push(results, {
      id: `negative-return-high-income-${h.symbol}`,
      severity: "info",
      title: `${h.symbol} has a negative return and contributes meaningful income`,
      detail: `${h.symbol} is down ${Math.abs(h.pnlPct).toFixed(1)}% on cost but contributes ${pct(incomeShare)} of projected income. This pattern can indicate yield-chasing risk.`,
      metric: h.pnlPct,
      symbols: [h.symbol],
    });
  }
}

function checkRiskyProducts(results: PortfolioGuardrail[], holdings: Holding[]) {
  for (const h of holdings.filter(h => h.source !== "crypto")) {
    const sym = h.symbol;
    const name = h.name ?? "";
    const hasCoveredCall = COVERED_CALL_PATTERN.test(name);

    if (LEVERAGED_PATTERN.test(name)) {
      pushProductFlag(results, "leveraged-fund", sym, "may use leverage");
    }
    if (INVERSE_PATTERN.test(name)) {
      pushProductFlag(results, "inverse-fund", sym, "may use inverse exposure");
    }
    if (hasCoveredCall) {
      pushProductFlag(results, "covered-call-income-fund", sym, "may use a covered-call income structure");
    }
    if (SINGLE_STOCK_PATTERN.test(name)) {
      pushProductFlag(results, "single-stock-fund", sym, "may provide single-stock fund exposure");
    }
    if (hasCoveredCall) {
      pushProductFlag(results, "options-income-risk", sym, "may use options-linked distribution income");
    }
  }
}

function pushProductFlag(results: PortfolioGuardrail[], id: string, symbol: string, phrase: string) {
  push(results, {
    id: `${id}-${symbol}`,
    severity: "info",
    title: `${symbol} may use a complex product structure`,
    detail: `${symbol} ${phrase}. Watcher is flagging the product structure, not recommending a trade.`,
    symbols: [symbol],
  });
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}
