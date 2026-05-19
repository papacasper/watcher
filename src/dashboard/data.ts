import { auth } from "../robinhood/auth.js";
import type { RobinhoodAuthEvent } from "../robinhood/auth.js";
import { getDividends, getOpenStockPositions } from "../robinhood/accounts.js";
import { getLatestPriceMap } from "../robinhood/stocks.js";
import { getCryptoPriceMap, getOpenCryptoHoldings } from "../robinhood/crypto.js";
import { paginationRequest } from "../robinhood/helper.js";
import { getAnnouncedDividends } from "../announcements/nasdaq.js";
import { getMarketCalendar } from "../market/feargreed.js";
import { loadDailyCost, loadDividendTargetDaily, loadRobinhoodCredentials } from "../config.js";
import type { DashboardData } from "./types.js";
import { calculateIncomeMetrics, calculateHoldingForwardIncome } from "./metrics.js";
import { computeGuardrails } from "./guardrails.js";
import {
  appendIssue,
  buildDividendList,
  buildPositionMaps,
  buildDashboardReconciliation,
  buildHoldings,
  enrichTypesFromStockAnalysis,
  computeAcquisitionDates,
  cryptoAccountValue,
  dataWithIssues,
  filterDividendsBySymbol,
  fetchInstrumentNames,
  fetchInstrumentTypes,
  markFresh,
  markStale,
  markUnavailable,
  portfolioEquityValue,
  previousHoldingMap,
  previousReconciliation,
  projectFutureDividends,
  visibleDashboardHoldings,
  type IssueBag,
  type RawRecord,
  type SourceStatusMap,
} from "./assembly.js";

export type {
  DashboardData,
  DashboardReconciliation,
  DividendEntry,
  GuardrailSeverity,
  Holding,
  MarketCalendarEvent,
  PortfolioGuardrail,
  SourceStatus,
} from "./types.js";

export type { IncomeMetrics } from "./metrics.js";
export { calculateIncomeMetrics, calculateHoldingForwardIncome } from "./metrics.js";
export { buildDashboardReconciliation, visibleDashboardHoldings } from "./assembly.js";

export interface FetchDashboardOptions {
  previous?: DashboardData | null;
  onAuthMilestone?: (event: RobinhoodAuthEvent) => void;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function fetchDashboardData(options: FetchDashboardOptions = {}): Promise<DashboardData> {
  const robinhood = loadRobinhoodCredentials();
  const dailyCost = loadDailyCost();
  const dividendTargetDaily = loadDividendTargetDaily();
  const sourceErrors: IssueBag = {};
  const sourceWarnings: IssueBag = {};
  const sourceStatus: SourceStatusMap = {};
  const previous = options.previous ?? null;
  const previousHoldings = previousHoldingMap(previous);
  const previousRec = previousReconciliation(previous);

  await auth.login(robinhood, { onMilestone: options.onAuthMilestone });

  const [
    positionsResult,
    dividendsResult,
    ordersResult,
    portfoliosResult,
    cryptoPositionsResult,
  ] = await Promise.allSettled([
    getOpenStockPositions() as Promise<RawRecord[]>,
    getDividends() as unknown as Promise<RawRecord[]>,
    paginationRequest<RawRecord[]>("https://api.robinhood.com/orders/"),
    paginationRequest<RawRecord[]>("https://api.robinhood.com/portfolios/"),
    getOpenCryptoHoldings(),
  ]);

  if (positionsResult.status === "rejected") {
    const message = errorMessage(positionsResult.reason);
    sourceErrors.positions = message;
    if (previous) {
      markStale(sourceStatus, "positions", message, previous);
      return dataWithIssues(
        { ...previous, fetchedAt: new Date().toISOString() },
        sourceErrors,
        sourceWarnings,
        sourceStatus
      );
    }
    markUnavailable(sourceStatus, "positions", message);
    throw new Error(`Positions fetch failed and no previous cache is available: ${message}`);
  }
  markFresh(sourceStatus, "positions");

  const positions = positionsResult.value;
  const dividendsFresh = dividendsResult.status === "fulfilled";
  const ordersFresh = ordersResult.status === "fulfilled";
  const portfoliosFresh = portfoliosResult.status === "fulfilled";
  const cryptoHoldingsFresh = cryptoPositionsResult.status === "fulfilled";

  const dividends = dividendsFresh ? dividendsResult.value : [];
  if (dividendsFresh) {
    markFresh(sourceStatus, "dividends");
  } else {
    sourceErrors.dividends = errorMessage(dividendsResult.reason);
    if (previous?.dividends.length) markStale(sourceStatus, "dividends", sourceErrors.dividends, previous);
    else markUnavailable(sourceStatus, "dividends", sourceErrors.dividends);
  }

  const orders = ordersFresh ? ordersResult.value : [];
  if (ordersFresh) {
    markFresh(sourceStatus, "orders");
  } else {
    sourceErrors.orders = errorMessage(ordersResult.reason);
    if (previous?.holdings.length) markStale(sourceStatus, "orders", sourceErrors.orders, previous);
    else markUnavailable(sourceStatus, "orders", sourceErrors.orders);
  }

  const portfolios = portfoliosFresh ? portfoliosResult.value : [];
  if (portfoliosFresh) {
    markFresh(sourceStatus, "portfolioSummary");
  } else {
    sourceErrors.portfolioSummary = errorMessage(portfoliosResult.reason);
    if (previousRec) markStale(sourceStatus, "portfolioSummary", sourceErrors.portfolioSummary, previous);
    else markUnavailable(sourceStatus, "portfolioSummary", sourceErrors.portfolioSummary);
  }

  const cryptoPositions = cryptoHoldingsFresh ? cryptoPositionsResult.value : [];
  if (cryptoHoldingsFresh) {
    markFresh(sourceStatus, "cryptoHoldings");
  } else {
    sourceErrors.cryptoHoldings = errorMessage(cryptoPositionsResult.reason);
    if (previousRec) markStale(sourceStatus, "cryptoHoldings", sourceErrors.cryptoHoldings, previous);
    else markUnavailable(sourceStatus, "cryptoHoldings", sourceErrors.cryptoHoldings);
  }

  const { instrToSymbol, currentQty, costBasisMap, instrumentUrls } = buildPositionMaps(positions, sourceWarnings);
  const symbols = [...currentQty.keys()];
  const previousHeldSince = new Map([...previousHoldings.entries()].map(([symbol, holding]) => [symbol, holding.heldSince] as [string, string]));
  const acquisitionDate = computeAcquisitionDates(symbols, currentQty, instrToSymbol, orders, sourceWarnings, ordersFresh ? undefined : previousHeldSince);
  const divsBySymbol = filterDividendsBySymbol(dividends, symbols, instrToSymbol, acquisitionDate);

  const today = new Date();
  const horizon = new Date(today.getFullYear(), today.getMonth() + 3, today.getDate());
  const todayStr = today.toISOString().slice(0, 10);
  const horizStr = horizon.toISOString().slice(0, 10);

  const [priceResult, nameResult, typeResult, announcedResult, calendarResult] = await Promise.allSettled([
    getLatestPriceMap(symbols),
    fetchInstrumentNames(instrumentUrls),
    fetchInstrumentTypes(instrumentUrls),
    getAnnouncedDividends(symbols, todayStr, horizStr),
    getMarketCalendar(),
  ]);
  const cryptoSymbols = cryptoPositions.map(position => position.symbol);
  const cryptoPriceResult = cryptoSymbols.length > 0
    ? await getCryptoPriceMap(cryptoSymbols).then(
      value => ({ status: "fulfilled" as const, value }),
      reason => ({ status: "rejected" as const, reason })
    )
    : { status: "fulfilled" as const, value: new Map<string, number>() };

  let priceMap: Map<string, number>;
  if (priceResult.status === "fulfilled") {
    priceMap = priceResult.value;
    markFresh(sourceStatus, "prices");
  } else {
    sourceErrors.prices = errorMessage(priceResult.reason);
    const previousPrices = new Map((previous?.holdings ?? []).map(h => [h.symbol, h.price]));
    if (previousPrices.size === 0) {
      markUnavailable(sourceStatus, "prices", sourceErrors.prices);
      throw new Error(`Price fetch failed and no previous cache is available: ${sourceErrors.prices}`);
    }
    priceMap = new Map(symbols.map(symbol => [symbol, previousPrices.get(symbol) ?? 0]));
    markStale(sourceStatus, "prices", sourceErrors.prices, previous);
  }

  for (const symbol of symbols) {
    if ((priceMap.get(symbol) ?? 0) <= 0) {
      appendIssue(sourceWarnings, "prices", `${symbol} price is missing or zero`);
    }
  }

  const nameMap = nameResult.status === "fulfilled"
    ? nameResult.value
    : new Map(symbols.map(symbol => [symbol, previousHoldings.get(symbol)?.name ?? symbol] as [string, string]));
  if (nameResult.status === "fulfilled") {
    markFresh(sourceStatus, "instrumentNames");
  } else {
    sourceErrors.instrumentNames = errorMessage(nameResult.reason);
    if (previous?.holdings.length) markStale(sourceStatus, "instrumentNames", sourceErrors.instrumentNames, previous);
    else markUnavailable(sourceStatus, "instrumentNames", sourceErrors.instrumentNames);
  }

  const announced = announcedResult.status === "fulfilled" ? announcedResult.value : [];
  const marketCalendar = calendarResult.status === "fulfilled" ? calendarResult.value : [];
  if (announcedResult.status === "fulfilled") {
    markFresh(sourceStatus, "announcedDividends");
  } else {
    sourceErrors.announcedDividends = errorMessage(announcedResult.reason);
    if (previous?.dividends.length) markStale(sourceStatus, "announcedDividends", sourceErrors.announcedDividends, previous);
    else markUnavailable(sourceStatus, "announcedDividends", sourceErrors.announcedDividends);
  }

  let cryptoPriceMap: Map<string, number>;
  let cryptoValueStale = !cryptoHoldingsFresh;
  if (cryptoPriceResult.status === "fulfilled") {
    cryptoPriceMap = cryptoPriceResult.value;
    if (cryptoHoldingsFresh) markFresh(sourceStatus, "cryptoPrices");
  } else {
    sourceErrors.cryptoPrices = errorMessage(cryptoPriceResult.reason);
    cryptoPriceMap = new Map(cryptoSymbols.map(symbol => [symbol, 0]));
    cryptoValueStale = true;
    if (previousRec) markStale(sourceStatus, "cryptoPrices", sourceErrors.cryptoPrices, previous);
    else markUnavailable(sourceStatus, "cryptoPrices", sourceErrors.cryptoPrices);
  }

  const fallbackDivsEarned = new Map([...previousHoldings.entries()].map(([symbol, holding]) => [symbol, holding.divsEarned] as [string, number]));
  const typeMap = typeResult.status === "fulfilled" ? typeResult.value : new Map<string, string>();
  await enrichTypesFromStockAnalysis(symbols, typeMap);
  const stockTotals = buildHoldings(
    symbols, currentQty, costBasisMap, priceMap, nameMap, typeMap, divsBySymbol, acquisitionDate, sourceWarnings, dividendsFresh ? undefined : fallbackDivsEarned
  );
  const cryptoValue = cryptoValueStale
    ? (previousRec?.cryptoValue ?? 0)
    : cryptoAccountValue(cryptoPositions, cryptoPriceMap);
  let holdings = visibleDashboardHoldings(stockTotals.holdings);
  const totalCost = stockTotals.totalCost;
  const grossHoldingsValue = stockTotals.totalValue;
  const portfolioEquity = portfolioEquityValue(portfolios);
  const previousStockAdjustment = previousRec ? previousRec.stockNetValue - previousRec.stockGrossValue : 0;
  const stockNetValue = portfolioEquity ?? (previousRec && !portfoliosFresh
    ? stockTotals.totalValue + previousStockAdjustment
    : stockTotals.totalValue);
  if (portfoliosFresh && portfolioEquity === null) {
    appendIssue(sourceWarnings, "portfolioSummary", "portfolio equity was unavailable; using stock gross value");
  }
  const reconciliationErrors: Record<string, string> = {};
  for (const key of ["portfolioSummary", "cryptoHoldings", "cryptoPrices"]) {
    if (sourceErrors[key]) reconciliationErrors[key] = sourceErrors[key]!;
  }
  const reconciliation = buildDashboardReconciliation({
    stockGrossValue: grossHoldingsValue,
    stockNetValue,
    cryptoValue,
    source: portfolioEquity !== null ? "robinhood_portfolio" : (previousRec && !portfoliosFresh ? "previous_cache" : "stock_positions"),
    stale: !portfoliosFresh || cryptoValueStale,
    errors: reconciliationErrors,
  });
  const totalValue = reconciliation.stockNetValue + reconciliation.cryptoValue;
  const cashBalance = reconciliation.netAdjustment;
  const totalDivs = stockTotals.totalDivs;

  const dividendList = dividendsFresh
    ? buildDividendList(symbols, divsBySymbol, sourceWarnings)
    : (previous?.dividends ?? []).filter(d => symbols.includes(d.symbol));
  if (dividendsFresh) {
    projectFutureDividends(symbols, dividendList, currentQty, announced);
  } else if (previous?.dividends.length) {
    const futureFallback = previous.dividends
      .filter(d => symbols.includes(d.symbol) && ["announced", "projected"].includes(d.state) && d.payableDate >= todayStr);
    const existing = new Set(dividendList.map(d => `${d.symbol}|${d.payableDate}|${d.state}`));
    for (const d of futureFallback) {
      const key = `${d.symbol}|${d.payableDate}|${d.state}`;
      if (!existing.has(key)) dividendList.push(d);
    }
  }
  dividendList.sort((a, b) => b.payableDate.localeCompare(a.payableDate));

  holdings = calculateHoldingForwardIncome(holdings, dividendList, today, horizon);

  const income = calculateIncomeMetrics(dividendList, totalCost, totalDivs, dailyCost, grossHoldingsValue, dividendTargetDaily, today, horizon);

  const pnl = grossHoldingsValue - totalCost;
  const pnlPct = totalCost > 0 ? (pnl / totalCost) * 100 : 0;

  const guardrails = computeGuardrails(
    holdings,
    dividendList,
    reconciliation,
    Object.keys(sourceStatus).length > 0 ? sourceStatus : undefined,
    grossHoldingsValue,
    income.forwardProjectedAnnualIncome,
  );

  return {
    fetchedAt: new Date().toISOString(),
    holdings,
    dividends: dividendList,
    marketCalendar,
    sourceErrors: Object.keys(sourceErrors).length > 0 ? sourceErrors : undefined,
    sourceWarnings: Object.keys(sourceWarnings).length > 0 ? sourceWarnings : undefined,
    sourceStatus: Object.keys(sourceStatus).length > 0 ? sourceStatus : undefined,
    guardrails,
    summary: {
      totalCost, totalValue, pnl, pnlPct,
      grossHoldingsValue,
      netLiquidationValue: totalValue,
      cashBalance,
      divsEarned: totalDivs,
      last30dIncome: income.trailing30dIncome,
      trailing30dIncome: income.trailing30dIncome,
      annualizedTrailingIncome: income.annualizedTrailingIncome,
      forwardProjectedAnnualIncome: income.forwardProjectedAnnualIncome,
      dividendTargetDaily: income.dividendTargetDaily,
      dividendTargetAnnual: income.dividendTargetAnnual,
      forwardProjectedDailyIncome: income.forwardProjectedDailyIncome,
      dividendGoalProgressPct: income.dividendGoalProgressPct,
      dividendIncomeGapDaily: income.dividendIncomeGapDaily,
      dividendIncomeGapAnnual: income.dividendIncomeGapAnnual,
      capitalRequiredAtCurrentYield: income.capitalRequiredAtCurrentYield,
      annualYieldOnCost: income.annualYieldOnCost,
      lifetimeDividendYieldOnCost: income.lifetimeDividendYieldOnCost,
      dailyCost,
      daysOfFreedom: income.daysOfFreedom,
      reconciliation,
    },
  };
}
