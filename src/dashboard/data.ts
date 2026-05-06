import { auth } from "../robinhood/auth.js";
import type { RobinhoodAuthEvent } from "../robinhood/auth.js";
import { getDividends, getOpenStockPositions, getSpendingAccountBalance, getCardTransactions } from "../robinhood/accounts.js";
import { getLatestPriceMap } from "../robinhood/stocks.js";
import { getCryptoPriceMap, getOpenCryptoHoldings, type CryptoHolding } from "../robinhood/crypto.js";
import { paginationRequest } from "../robinhood/helper.js";
import { getAnnouncedDividends, type AnnouncedDividend } from "../alpaca/dividends.js";
import { loadDailyCost, loadRobinhoodCredentials } from "../config.js";
import { fetchWithRetry } from "../utils/http.js";
import type {
  CardTxEntry,
  DashboardData,
  DashboardReconciliation,
  DividendEntry,
  Holding,
  SourceStatus,
  SpendingData,
} from "./types.js";

export type {
  CardTxEntry,
  DashboardData,
  DashboardReconciliation,
  DividendEntry,
  Holding,
  SourceStatus,
  SpendingData,
} from "./types.js";

const DAY_MS = 86400_000;
const HISTORICAL_INCOME_STATES = new Set(["paid", "pending", "reinvested"]);
const FORWARD_INCOME_STATES = new Set(["pending", "announced", "projected"]);
const SOURCE_OK = "fresh" as const;
const SOURCE_STALE = "stale" as const;
const SOURCE_UNAVAILABLE = "unavailable" as const;

type RawRecord = Record<string, unknown>;
type IssueBag = Record<string, string>;
type SourceStatusMap = Record<string, SourceStatus>;

export interface IncomeMetrics {
  trailing30dIncome: number;
  annualizedTrailingIncome: number;
  forwardProjectedAnnualIncome: number;
  annualYieldOnCost: number;
  lifetimeDividendYieldOnCost: number;
  daysOfFreedom: number;
}

export interface FetchDashboardOptions {
  previous?: DashboardData | null;
  onAuthMilestone?: (event: RobinhoodAuthEvent) => void;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function appendIssue(issues: IssueBag, key: string, message: string): void {
  const existing = issues[key];
  issues[key] = existing ? `${existing}; ${message}` : message;
}

function parseFinite(value: unknown, fallback = 0): number {
  const parsed = parseFloat(asString(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFiniteWithWarning(
  value: unknown,
  fallback: number,
  warnings: IssueBag,
  key: string,
  label: string
): number {
  const raw = asString(value);
  if (!raw) return fallback;
  const parsed = parseFloat(raw);
  if (Number.isFinite(parsed)) return parsed;
  appendIssue(warnings, key, `${label} was malformed`);
  return fallback;
}

function dateOnly(value: unknown): string {
  return asString(value).slice(0, 10);
}

function markStatus(
  sourceStatus: SourceStatusMap,
  source: string,
  state: SourceStatus["state"],
  message?: string,
  staleFrom?: string
): void {
  sourceStatus[source] = { state, ...(message ? { message } : {}), ...(staleFrom ? { staleFrom } : {}) };
}

function markFresh(sourceStatus: SourceStatusMap, source: string): void {
  markStatus(sourceStatus, source, SOURCE_OK);
}

function markStale(sourceStatus: SourceStatusMap, source: string, message: string, previous?: DashboardData | null): void {
  markStatus(sourceStatus, source, SOURCE_STALE, message, previous?.fetchedAt);
}

function markUnavailable(sourceStatus: SourceStatusMap, source: string, message: string): void {
  markStatus(sourceStatus, source, SOURCE_UNAVAILABLE, message);
}

function previousHoldingMap(previous?: DashboardData | null): Map<string, Holding> {
  return new Map((previous?.holdings ?? []).map(holding => [holding.symbol, holding]));
}

function previousReconciliation(previous?: DashboardData | null): DashboardReconciliation | null {
  const existing = previous?.summary.reconciliation;
  if (existing) return existing;
  if (!previous) return null;

  const stockGrossValue = previous.summary.grossHoldingsValue ?? previous.holdings.reduce((sum, holding) => sum + holding.value, 0);
  const totalValue = previous.summary.netLiquidationValue ?? previous.summary.totalValue;
  return {
    stockGrossValue,
    stockNetValue: totalValue,
    cryptoValue: 0,
    netAdjustment: totalValue - stockGrossValue,
    source: "previous_cache",
    stale: true,
  };
}

function dataWithIssues(
  data: DashboardData,
  sourceErrors: IssueBag,
  sourceWarnings: IssueBag,
  sourceStatus: SourceStatusMap
): DashboardData {
  const reconciliation = data.summary.reconciliation ?? previousReconciliation(data) ?? buildDashboardReconciliation({
    stockGrossValue: data.summary.grossHoldingsValue,
    stockNetValue: data.summary.netLiquidationValue ?? data.summary.totalValue,
    cryptoValue: 0,
    source: "previous_cache",
    stale: true,
  });

  return {
    ...data,
    summary: { ...data.summary, reconciliation },
    sourceErrors: Object.keys(sourceErrors).length > 0 ? sourceErrors : undefined,
    sourceWarnings: Object.keys(sourceWarnings).length > 0 ? sourceWarnings : undefined,
    sourceStatus: Object.keys(sourceStatus).length > 0 ? sourceStatus : undefined,
  };
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateMs(date: string): number {
  return new Date(`${date}T12:00:00Z`).getTime();
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function daysBetween(startDate: string, endDate: string): number {
  return Math.max(1, Math.round((dateMs(endDate) - dateMs(startDate)) / DAY_MS));
}

export function calculateIncomeMetrics(
  dividendList: DividendEntry[],
  totalCost: number,
  totalDivs: number,
  dailyCost: number,
  now = new Date(),
  forwardHorizon = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate())
): IncomeMetrics {
  const todayStr = dateKey(now);
  const trailingStartStr = dateKey(addDays(now, -30));
  const horizonStr = dateKey(forwardHorizon);

  const trailing30dIncome = dividendList
    .filter(d =>
      HISTORICAL_INCOME_STATES.has(d.state) &&
      d.payableDate >= trailingStartStr &&
      d.payableDate <= todayStr
    )
    .reduce((s, d) => s + d.amount, 0);

  const forwardIncome = dividendList
    .filter(d =>
      FORWARD_INCOME_STATES.has(d.state) &&
      d.payableDate > todayStr &&
      d.payableDate <= horizonStr
    )
    .reduce((s, d) => s + d.amount, 0);

  const horizonDays = daysBetween(todayStr, horizonStr);
  const annualizedTrailingIncome = trailing30dIncome * 12;
  const forwardProjectedAnnualIncome = forwardIncome > 0 ? forwardIncome * (365 / horizonDays) : 0;

  return {
    trailing30dIncome,
    annualizedTrailingIncome,
    forwardProjectedAnnualIncome,
    annualYieldOnCost: totalCost > 0 ? (annualizedTrailingIncome / totalCost) * 100 : 0,
    lifetimeDividendYieldOnCost: totalCost > 0 ? (totalDivs / totalCost) * 100 : 0,
    daysOfFreedom: dailyCost > 0 ? Math.floor(trailing30dIncome / dailyCost) : 0,
  };
}

interface PositionMaps {
  instrToSymbol: Map<string, string>;
  currentQty: Map<string, number>;
  costBasisMap: Map<string, number>;
  instrumentUrls: Map<string, string>;
}

function buildPositionMaps(positions: RawRecord[], sourceWarnings: IssueBag): PositionMaps {
  const instrToSymbol = new Map<string, string>();
  const currentQty = new Map<string, number>();
  const costBasisMap = new Map<string, number>();
  const instrumentUrls = new Map<string, string>();

  for (const p of positions) {
    const symbol = asString(p.symbol).trim().toUpperCase();
    const instrumentId = asString(p.instrument_id).trim();
    if (!instrumentId || !symbol) continue;

    const qty = parseFiniteWithWarning(p.quantity, 0, sourceWarnings, "positions", `${symbol} quantity`);
    const avgPrice = parseFiniteWithWarning(p.average_buy_price, 0, sourceWarnings, "positions", `${symbol} average buy price`);
    if (qty <= 0) continue;

    instrToSymbol.set(instrumentId, symbol);
    currentQty.set(symbol, qty);
    costBasisMap.set(symbol, avgPrice * qty);

    const instrumentUrl = asString(p.instrument);
    if (instrumentUrl) instrumentUrls.set(symbol, instrumentUrl);
  }

  return { instrToSymbol, currentQty, costBasisMap, instrumentUrls };
}

function computeAcquisitionDates(
  symbols: string[],
  currentQty: Map<string, number>,
  instrToSymbol: Map<string, string>,
  orders: RawRecord[],
  sourceWarnings: IssueBag,
  previousHeldSince = new Map<string, string>()
): Map<string, string> {
  const filledOrders = orders
    .filter(o => asString(o.state) === "filled" && instrToSymbol.has(asString(o.instrument_id)))
    .sort((a, b) => new Date(asString(b.last_transaction_at)).getTime() - new Date(asString(a.last_transaction_at)).getTime());

  const acquisitionDate = new Map<string, string>();
  for (const symbol of symbols) {
    const symOrders = filledOrders.filter(o => instrToSymbol.get(asString(o.instrument_id)) === symbol);
    let need = currentQty.get(symbol)!;
    let oldest = previousHeldSince.get(symbol) ?? "";
    for (const o of symOrders) {
      const qty = parseFiniteWithWarning(o.cumulative_quantity, 0, sourceWarnings, "orders", `${symbol} order quantity`);
      if (asString(o.side) === "sell") { need += qty; continue; }
      need -= qty;
      oldest = asString(o.last_transaction_at);
      if (need <= 0.0001) break;
    }
    acquisitionDate.set(symbol, oldest);
  }
  return acquisitionDate;
}

function filterDividendsBySymbol(
  dividends: RawRecord[],
  symbols: string[],
  instrToSymbol: Map<string, string>,
  acquisitionDate: Map<string, string>
): Map<string, RawRecord[]> {
  const divsBySymbol = new Map<string, RawRecord[]>();
  for (const symbol of symbols) divsBySymbol.set(symbol, []);

  for (const d of dividends) {
    const instrId = asString(d.instrument).split("/").filter(Boolean).pop();
    const symbol = instrToSymbol.get(instrId ?? "");
    if (!symbol) continue;
    const acq = acquisitionDate.get(symbol)?.slice(0, 10) ?? "";
    const payableDate = dateOnly(d.payable_date);
    if (acq && payableDate < acq) continue;
    if (!["paid", "pending", "reinvested"].includes(asString(d.state))) continue;
    divsBySymbol.get(symbol)!.push(d);
  }
  return divsBySymbol;
}

async function fetchInstrumentNames(
  instrumentUrls: Map<string, string>
): Promise<Map<string, string>> {
  const fetches = [...instrumentUrls.entries()].map(async ([symbol, url]) => {
    try {
      const res = await fetchWithRetry(url, { headers: auth.getHeaders() }, { label: `Robinhood instrument ${symbol}` });
      if (!res.ok) return [symbol, symbol] as [string, string];
      const d = await res.json() as RawRecord;
      return [symbol, asString(d.simple_name) || asString(d.name) || symbol] as [string, string];
    } catch {
      return [symbol, symbol] as [string, string];
    }
  });
  return new Map(await Promise.all(fetches));
}

function buildHoldings(
  symbols: string[],
  currentQty: Map<string, number>,
  costBasisMap: Map<string, number>,
  priceMap: Map<string, number>,
  nameMap: Map<string, string>,
  divsBySymbol: Map<string, RawRecord[]>,
  acquisitionDate: Map<string, string>,
  sourceWarnings: IssueBag,
  fallbackDivsEarned = new Map<string, number>()
): { holdings: Holding[]; totalCost: number; totalValue: number; totalDivs: number } {
  let totalCost = 0, totalValue = 0, totalDivs = 0;

  const holdings = symbols.map(symbol => {
    const qty = currentQty.get(symbol)!;
    const cost = costBasisMap.get(symbol)!;
    const price = priceMap.get(symbol)!;
    const value = qty * price;
    const pnl = value - cost;
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
    const rawDivs = divsBySymbol.get(symbol) ?? [];
    const earned = rawDivs.length > 0
      ? rawDivs.reduce((s, d) => s + parseFiniteWithWarning(d.amount, 0, sourceWarnings, "dividends", `${symbol} dividend amount`), 0)
      : (fallbackDivsEarned.get(symbol) ?? 0);
    const heldSince = acquisitionDate.get(symbol)?.slice(0, 10) ?? "";

    totalCost += cost;
    totalValue += value;
    totalDivs += earned;

    return {
      symbol, name: nameMap.get(symbol) ?? symbol,
      shares: qty, avgCost: cost > 0 ? cost / qty : 0, costBasis: cost,
      price, value, pnl, pnlPct, divsEarned: earned, heldSince,
      type: "Stock", source: "stock" as const,
    };
  });

  return { holdings, totalCost, totalValue, totalDivs };
}

function cryptoAccountValue(
  cryptoPositions: CryptoHolding[],
  priceMap: Map<string, number>
): number {
  return cryptoPositions.reduce((sum, position) =>
    sum + position.quantity * (priceMap.get(position.symbol) ?? 0), 0);
}

export function visibleDashboardHoldings(holdings: Holding[]): Holding[] {
  return holdings
    .filter(h => h.source !== "crypto" && h.type !== "Crypto")
    .sort((a, b) => b.value - a.value);
}

function parseMoney(value: unknown): number | null {
  const parsed = parseFloat(typeof value === "string" ? value : String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function portfolioEquityValue(portfolios: RawRecord[]): number | null {
  const portfolio = portfolios.find(p => p.is_primary_account) ?? portfolios[0];
  if (!portfolio) return null;

  for (const field of [
    "extended_hours_portfolio_equity",
    "extended_hours_equity",
    "equity",
    "last_core_portfolio_equity",
  ]) {
    const parsed = parseMoney(portfolio[field]);
    if (parsed !== null) return parsed;
  }

  return null;
}

function buildDividendList(
  symbols: string[],
  divsBySymbol: Map<string, RawRecord[]>,
  sourceWarnings: IssueBag
): DividendEntry[] {
  return [...divsBySymbol.entries()]
    .flatMap(([symbol, divs]) =>
      divs.map(d => ({
        symbol,
        payableDate: dateOnly(d.payable_date),
        amount: parseFiniteWithWarning(d.amount, 0, sourceWarnings, "dividends", `${symbol} dividend amount`),
        shares: parseFiniteWithWarning(d.position, 0, sourceWarnings, "dividends", `${symbol} dividend position`),
        rate: parseFiniteWithWarning(d.rate, 0, sourceWarnings, "dividends", `${symbol} dividend rate`),
        state: asString(d.state),
      }))
    )
    .filter(d => d.payableDate && Number.isFinite(d.amount) && Number.isFinite(d.shares) && Number.isFinite(d.rate))
    .sort((a, b) => b.payableDate.localeCompare(a.payableDate));
}

function projectFutureDividends(
  symbols: string[],
  dividendList: DividendEntry[],
  currentQty: Map<string, number>,
  announced: AnnouncedDividend[]
): void {
  const today = new Date();
  const horizon = new Date(today.getFullYear(), today.getMonth() + 3, today.getDate());
  const announcedKeys = new Set(announced.map(a => `${a.symbol}|${a.payableDate}`));

  for (const a of announced) {
    const shares = currentQty.get(a.symbol) ?? 0;
    dividendList.push({ symbol: a.symbol, payableDate: a.payableDate, amount: a.cash * shares, shares, rate: a.cash, state: "announced" });
  }

  for (const symbol of symbols) {
    const history = dividendList
      .filter(d => d.symbol === symbol && d.state !== "projected" && d.state !== "announced")
      .sort((a, b) => a.payableDate.localeCompare(b.payableDate));

    if (history.length === 0) continue;

    const gaps: number[] = [];
    for (let i = 1; i < history.length; i++) {
      const diff = new Date(history[i]!.payableDate).getTime() - new Date(history[i - 1]!.payableDate).getTime();
      gaps.push(diff / 86400_000);
    }
    const medianGap = gaps.length > 0
      ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 30
      : 30;
    const intervalDays = medianGap < 60 ? 30 : 91;

    const last = history[history.length - 1]!;
    const projShares = currentQty.get(symbol) ?? last.shares;
    let nextDate = new Date(last.payableDate);

    while (true) {
      nextDate = new Date(nextDate.getTime() + intervalDays * 86400_000);
      if (nextDate > horizon) break;
      if (nextDate <= today) continue;
      const key = `${symbol}|${nextDate.toISOString().slice(0, 10)}`;
      if (announcedKeys.has(key)) continue;
      dividendList.push({ symbol, payableDate: nextDate.toISOString().slice(0, 10), amount: last.rate * projShares, shares: projShares, rate: last.rate, state: "projected" });
    }
  }
}

function buildSpendingData(spendingBalance: RawRecord | null, cardTxns: RawRecord[], sourceWarnings: IssueBag): SpendingData | null {
  if (!spendingBalance) return null;

  const cutoff30d = Date.now() - 30 * 86400_000;
  const txns: CardTxEntry[] = cardTxns.map(t => {
    const amount = t.amount as RawRecord | string | number | undefined;
    const rawAmount = typeof amount === "object" && amount !== null ? amount.amount : amount;
    const direction: CardTxEntry["direction"] = asString(t.direction) === "credit" ? "credit" : "debit";
    if (asString(t.direction) && !["credit", "debit"].includes(asString(t.direction))) {
      appendIssue(sourceWarnings, "cardTransactions", "card transaction direction was malformed");
    }

    return {
      date: dateOnly(t.record_date ?? t.initiated_at),
      amount: parseFiniteWithWarning(rawAmount, 0, sourceWarnings, "cardTransactions", "card transaction amount"),
      direction,
      state: asString(t.transaction_type) || asString(t.state),
    };
  }).filter(t => t.date && Number.isFinite(t.amount)).sort((a, b) => b.date.localeCompare(a.date));

  const spent30d = txns
    .filter(t => t.direction === "debit" && new Date(t.date).getTime() >= cutoff30d)
    .reduce((s, t) => s + t.amount, 0);

  return {
    uninvestedCash: parseFiniteWithWarning(spendingBalance.portfolio_cash, 0, sourceWarnings, "spendingBalance", "portfolio cash"),
    withdrawableCash: parseFiniteWithWarning(spendingBalance.cash_available_for_withdrawal, 0, sourceWarnings, "spendingBalance", "withdrawable cash"),
    buyingPower: parseFiniteWithWarning(spendingBalance.buying_power, 0, sourceWarnings, "spendingBalance", "buying power"),
    spent30d,
    transactions: txns,
  };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function buildDashboardReconciliation(input: {
  stockGrossValue: number;
  stockNetValue: number;
  cryptoValue: number;
  source: DashboardReconciliation["source"];
  stale: boolean;
  errors?: Record<string, string>;
}): DashboardReconciliation {
  const stockGrossValue = Number.isFinite(input.stockGrossValue) ? input.stockGrossValue : 0;
  const stockNetValue = Number.isFinite(input.stockNetValue) ? input.stockNetValue : stockGrossValue;
  const cryptoValue = Number.isFinite(input.cryptoValue) ? input.cryptoValue : 0;
  const errors = input.errors && Object.keys(input.errors).length > 0 ? input.errors : undefined;

  return {
    stockGrossValue,
    stockNetValue,
    cryptoValue,
    netAdjustment: stockNetValue + cryptoValue - stockGrossValue,
    source: input.source,
    stale: input.stale,
    ...(errors ? { errors } : {}),
  };
}

export async function fetchDashboardData(options: FetchDashboardOptions = {}): Promise<DashboardData> {
  const robinhood = loadRobinhoodCredentials();
  const dailyCost = loadDailyCost();
  const sourceErrors: Record<string, string> = {};
  const sourceWarnings: Record<string, string> = {};
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
    spendingBalanceResult,
    cardTxnsResult,
  ] = await Promise.allSettled([
    getOpenStockPositions() as Promise<RawRecord[]>,
    getDividends() as unknown as Promise<RawRecord[]>,
    paginationRequest<RawRecord[]>("https://api.robinhood.com/orders/"),
    paginationRequest<RawRecord[]>("https://api.robinhood.com/portfolios/"),
    getOpenCryptoHoldings(),
    getSpendingAccountBalance() as Promise<RawRecord | null>,
    getCardTransactions("settled") as unknown as Promise<RawRecord[]>,
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

  const spendingBalance = spendingBalanceResult.status === "fulfilled" ? spendingBalanceResult.value : null;
  if (spendingBalanceResult.status === "fulfilled") {
    markFresh(sourceStatus, "spendingBalance");
  } else {
    sourceErrors.spendingBalance = errorMessage(spendingBalanceResult.reason);
    markUnavailable(sourceStatus, "spendingBalance", sourceErrors.spendingBalance);
  }

  const cardTxns = cardTxnsResult.status === "fulfilled" ? cardTxnsResult.value : [];
  if (cardTxnsResult.status === "fulfilled") {
    markFresh(sourceStatus, "cardTransactions");
  } else {
    sourceErrors.cardTransactions = errorMessage(cardTxnsResult.reason);
    markUnavailable(sourceStatus, "cardTransactions", sourceErrors.cardTransactions);
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

  const [priceResult, nameResult, announcedResult] = await Promise.allSettled([
    getLatestPriceMap(symbols),
    fetchInstrumentNames(instrumentUrls),
    getAnnouncedDividends(symbols, todayStr, horizStr),
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
  const stockTotals = buildHoldings(
    symbols, currentQty, costBasisMap, priceMap, nameMap, divsBySymbol, acquisitionDate, sourceWarnings, dividendsFresh ? undefined : fallbackDivsEarned
  );
  const cryptoValue = cryptoValueStale
    ? (previousRec?.cryptoValue ?? 0)
    : cryptoAccountValue(cryptoPositions, cryptoPriceMap);
  const holdings = visibleDashboardHoldings(stockTotals.holdings);
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

  const income = calculateIncomeMetrics(dividendList, totalCost, totalDivs, dailyCost, today, horizon);

  const pnl = grossHoldingsValue - totalCost;
  const pnlPct = totalCost > 0 ? (pnl / totalCost) * 100 : 0;

  return {
    fetchedAt: new Date().toISOString(),
    holdings,
    dividends: dividendList,
    spending: buildSpendingData(spendingBalance, cardTxns, sourceWarnings),
    sourceErrors: Object.keys(sourceErrors).length > 0 ? sourceErrors : undefined,
    sourceWarnings: Object.keys(sourceWarnings).length > 0 ? sourceWarnings : undefined,
    sourceStatus: Object.keys(sourceStatus).length > 0 ? sourceStatus : undefined,
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
      annualYieldOnCost: income.annualYieldOnCost,
      lifetimeDividendYieldOnCost: income.lifetimeDividendYieldOnCost,
      dailyCost,
      daysOfFreedom: income.daysOfFreedom,
      reconciliation,
    },
  };
}
