import { auth } from "../robinhood/auth.js";
import { fetchWithRetry } from "../utils/http.js";
import { getTickerOverview } from "../ticker/stockanalysis.js";

const TYPE_CACHE_TTL_MS = 15 * 60_000;
const typeCache = new Map<string, { type: string; fetchedAt: number }>();

function typeCacheGet(symbol: string): string | null {
  const entry = typeCache.get(symbol);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > TYPE_CACHE_TTL_MS) { typeCache.delete(symbol); return null; }
  return entry.type;
}

function typeCacheSet(symbol: string, type: string): void {
  typeCache.set(symbol, { type, fetchedAt: Date.now() });
}
import type { AnnouncedDividend } from "../announcements/nasdaq.js";
import type {
  DashboardData,
  DashboardReconciliation,
  DividendEntry,
  Holding,
  SourceStatus,
} from "./types.js";
import type { CryptoHolding } from "../robinhood/crypto.js";

export type RawRecord = Record<string, unknown>;
export type IssueBag = Record<string, string>;
export type SourceStatusMap = Record<string, SourceStatus>;

const SOURCE_OK = "fresh" as const;
const SOURCE_STALE = "stale" as const;
const SOURCE_UNAVAILABLE = "unavailable" as const;

export function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

export function appendIssue(issues: IssueBag, key: string, message: string): void {
  const existing = issues[key];
  issues[key] = existing ? `${existing}; ${message}` : message;
}

export function parseFiniteWithWarning(
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

function parseFinite(value: unknown, fallback = 0): number {
  const parsed = parseFloat(asString(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function dateOnly(value: unknown): string {
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

export function markFresh(sourceStatus: SourceStatusMap, source: string): void {
  markStatus(sourceStatus, source, SOURCE_OK);
}

export function markStale(sourceStatus: SourceStatusMap, source: string, message: string, previous?: DashboardData | null): void {
  markStatus(sourceStatus, source, SOURCE_STALE, message, previous?.fetchedAt);
}

export function markUnavailable(sourceStatus: SourceStatusMap, source: string, message: string): void {
  markStatus(sourceStatus, source, SOURCE_UNAVAILABLE, message);
}

export function previousHoldingMap(previous?: DashboardData | null): Map<string, Holding> {
  return new Map((previous?.holdings ?? []).map(holding => [holding.symbol, holding]));
}

export function previousReconciliation(previous?: DashboardData | null): DashboardReconciliation | null {
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

export function dataWithIssues(
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

export interface PositionMaps {
  instrToSymbol: Map<string, string>;
  currentQty: Map<string, number>;
  costBasisMap: Map<string, number>;
  instrumentUrls: Map<string, string>;
}

export function buildPositionMaps(positions: RawRecord[], sourceWarnings: IssueBag): PositionMaps {
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

export function computeAcquisitionDates(
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

export function filterDividendsBySymbol(
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

export async function fetchInstrumentNames(
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

export async function fetchInstrumentTypes(
  instrumentUrls: Map<string, string>
): Promise<Map<string, string>> {
  const fetches = [...instrumentUrls.entries()].map(async ([symbol, url]) => {
    try {
      const res = await fetchWithRetry(url, { headers: auth.getHeaders() }, { label: `Robinhood instrument type ${symbol}` });
      if (!res.ok) return [symbol, ""] as [string, string];
      const d = await res.json() as RawRecord;
      const rhType = asString(d.type ?? d.instrument_type ?? "").toLowerCase();
      const fullName = asString(d.simple_name) || asString(d.name) || "";
      return [symbol, rhType || fullName] as [string, string];
    } catch {
      return [symbol, ""] as [string, string];
    }
  });
  const raw = new Map(await Promise.all(fetches));
  const result = new Map<string, string>();
  for (const [symbol, hint] of raw) {
    result.set(symbol, inferHoldingType(hint));
  }
  return result;
}

export function buildHoldings(
  symbols: string[],
  currentQty: Map<string, number>,
  costBasisMap: Map<string, number>,
  priceMap: Map<string, number>,
  nameMap: Map<string, string>,
  typeMap: Map<string, string>,
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
      forwardAnnualIncome: 0,
      forwardDailyIncome: 0,
      forwardYieldOnCost: 0,
      forwardYieldOnValue: 0,
      forwardIncomePct: 0,
      type: typeMap.get(symbol) ?? inferHoldingType(nameMap.get(symbol) ?? ""), source: "stock" as const,
    };
  });

  return { holdings, totalCost, totalValue, totalDivs };
}

export function cryptoAccountValue(
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

function inferHoldingType(name: string): string {
  if (/\b(REIT|real\s*estate\s*invest|realty|property\s*trust)\b/i.test(name)) return "REIT";
  if (/\b(ETF|E\.T\.F|exchange.traded\s*fund|index\s*fund|fund|trust|ETP)\b/i.test(name)) return "ETF";
  return "Stock";
}

export async function enrichTypesFromStockAnalysis(
  symbols: string[],
  typeMap: Map<string, string>
): Promise<void> {
  const ambiguous = symbols.filter(s => (typeMap.get(s) ?? "Stock") === "Stock");
  if (ambiguous.length === 0) return;

  // Apply cached results immediately; only fetch what's missing or stale
  const toFetch = ambiguous.filter(s => {
    const cached = typeCacheGet(s);
    if (cached !== null) { typeMap.set(s, cached); return false; }
    return true;
  });

  if (toFetch.length === 0) return;

  const results = await Promise.allSettled(toFetch.map(s => getTickerOverview(s)));
  for (let i = 0; i < toFetch.length; i++) {
    const r = results[i];
    if (r?.status !== "fulfilled" || !r.value) continue;
    const ov = r.value;
    if (ov.type === "etf") {
      typeMap.set(toFetch[i]!, "ETF");
      typeCacheSet(toFetch[i]!, "ETF");
    } else if (ov.type === "stock") {
      const inferred = inferHoldingType(ov.description);
      if (inferred !== "Stock") { typeMap.set(toFetch[i]!, inferred); typeCacheSet(toFetch[i]!, inferred); }
      else typeCacheSet(toFetch[i]!, "Stock");
    }
  }
}

function parseMoney(value: unknown): number | null {
  const parsed = parseFloat(typeof value === "string" ? value : String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function portfolioEquityValue(portfolios: RawRecord[]): number | null {
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

export function buildDividendList(
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

export function projectFutureDividends(
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
