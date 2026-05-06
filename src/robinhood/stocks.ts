/**
 * stocks.ts
 * Stock data fetching - mirrors robin_stocks.stocks
 */

import { auth } from "./auth.js";
import { inputsToSet, filterData } from "./helper.js";
import { fetchWithRetry } from "../utils/http.js";

const BASE_URL = "https://api.robinhood.com";

export interface StockQuote {
  symbol: string;
  lastTradePrice: string;
  lastExtendedHoursTradePrice: string;
  bidPrice: string;
  askPrice: string;
  bidSize: string;
  askSize: string;
  askId: string;
  bidId: string;
  lastPriceBidSize: string;
  lastPriceAskSize: string;
  lastPriceTimestamp: string;
  lastTradeTimestamp: string;
  tradingHalted: boolean;
  hasTraded: boolean;
  marketCap: string;
  description: string;
  name: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  closePrice: string;
  volume: string;
  snp500: boolean;
}

export interface StockHistoricals {
  opens: string[];
  highs: string[];
  lows: string[];
  closes: string[];
  volumes: string[];
  timestamps: string[];
}

export interface StockFinancial {
  symbol: string;
  marketCap: string;
  "P/E ratio": string;
  beta: string;
  divYield: string;
  earnings: string;
  EPS: string;
}

interface RawQuoteResult {
  symbol?: string;
  last_trade_price?: string | null;
}

export function quoteResultsToPriceMap(results: Array<RawQuoteResult | null | undefined>): Map<string, number> {
  const priceMap = new Map<string, number>();

  for (const quote of results) {
    if (!quote) continue;
    const symbol = quote.symbol?.trim().toUpperCase();
    if (!symbol) continue;

    const parsed = parseFloat(quote.last_trade_price ?? "0");
    priceMap.set(symbol, Number.isFinite(parsed) ? parsed : 0);
  }

  return priceMap;
}

export function quoteResultsForSymbols(
  symbols: string | string[],
  results: Array<RawQuoteResult | null | undefined>
): Map<string, number> {
  const symbolsList = inputsToSet(symbols);
  const responsePrices = quoteResultsToPriceMap(results);
  const priceMap = new Map<string, number>();

  for (const symbol of symbolsList) {
    priceMap.set(symbol, responsePrices.get(symbol) ?? 0);
  }

  return priceMap;
}

export async function getLatestPriceMap(
  symbols: string | string[]
): Promise<Map<string, number>> {
  const symbolsList = inputsToSet(symbols);
  if (symbolsList.length === 0) return new Map<string, number>();

  const resp = await fetchWithRetry(
    `${ BASE_URL }/quotes/?symbols=${ symbolsList.join(",") }`,
    { headers: auth.getHeaders() },
    { retries: 2, label: "Robinhood latest prices" }
  );

  if (!resp.ok) throw new Error(`Price fetch failed: ${ resp.status }`);

  const data = await resp.json() as {
    results: Array<RawQuoteResult | null>;
  };

  return quoteResultsForSymbols(symbolsList, data.results ?? []);
}

export async function getLatestPrice(
  symbols: string | string[]
): Promise<number | number[]> {
  const symbolsList = inputsToSet(symbols);
  const priceMap = await getLatestPriceMap(symbolsList);
  const prices = symbolsList.map(symbol => priceMap.get(symbol) ?? 0);

  return symbolsList.length === 1 ? (prices[0] ?? 0) : prices;
}

export async function getQuotes(symbols: string | string[]): Promise<StockQuote[]> {
  const symbolsList = inputsToSet(symbols);

  const resp = await fetchWithRetry(
    `${ BASE_URL }/quotes/?symbols=${ symbolsList.join(",") }`,
    { headers: auth.getHeaders() },
    { retries: 2, label: "Robinhood quotes" }
  );

  if (!resp.ok) throw new Error(`Quotes fetch failed: ${ resp.status }`);

  const data = await resp.json() as { results: StockQuote[] };
  return data.results ?? [];
}

export async function getQuoteBySymbol(symbol: string): Promise<StockQuote | null> {
  const quotes = await getQuotes(symbol);
  return quotes[0] ?? null;
}

export async function getStockHistoricals(
  symbols: string | string[],
  interval: "5minute" | "10minute" | "hour" | "day" | "week" = "day",
  span: "hour" | "day" | "week" | "month" | "year" | "5year" = "year",
  bounds: "regular" | "extended" | "all" = "regular"
): Promise<StockHistoricals> {
  const symbolsList = inputsToSet(symbols);

  const params = new URLSearchParams({
    symbols: symbolsList.join(","),
    interval,
    span,
    bounds
  });

  const resp = await fetchWithRetry(
    `${ BASE_URL }/quotes/historicals/?${ params }`,
    { headers: auth.getHeaders() },
    { retries: 2, label: "Robinhood historicals" }
  );

  if (!resp.ok) throw new Error(`Historicals fetch failed: ${ resp.status }`);

  const data = await resp.json() as {
    results: Array<{
      open_prices: string[];
      high_prices: string[];
      low_prices: string[];
      close_prices: string[];
      volumes: string[];
      timestamps: string[];
    }>;
  };

  const result = data.results?.[0];
  if (!result) return { opens: [], highs: [], lows: [], closes: [], volumes: [], timestamps: [] };

  return {
    opens: result.open_prices ?? [],
    highs: result.high_prices ?? [],
    lows: result.low_prices ?? [],
    closes: result.close_prices ?? [],
    volumes: result.volumes ?? [],
    timestamps: result.timestamps ?? []
  };
}

export async function getFundamentals(symbols: string | string[]): Promise<Record<string, StockFinancial>> {
  const symbolsList = inputsToSet(symbols);
  const result: Record<string, StockFinancial> = {};

  for (const symbol of symbolsList) {
    const resp = await fetchWithRetry(
      `${ BASE_URL }/fundamentals/${ symbol }/`,
      { headers: auth.getHeaders() },
      { retries: 1, label: `Robinhood fundamentals ${symbol}` }
    );

    if (resp.ok) {
      const data = await resp.json() as StockFinancial;
      result[symbol] = data;
    }
  }

  return result;
}

export async function getNews(symbol: string): Promise<unknown[]> {
  const resp = await fetchWithRetry(
    `${ BASE_URL }/midlands/news/${ symbol }/`,
    { headers: auth.getHeaders() },
    { retries: 2, label: `Robinhood news ${symbol}` }
  );

  if (!resp.ok) throw new Error(`News fetch failed: ${ resp.status }`);

  const data = await resp.json() as { results: unknown[] };
  return data.results ?? [];
}

export async function getRatings(symbol: string): Promise<unknown> {
  const resp = await fetchWithRetry(
    `${ BASE_URL }/midlands/ratings/${ symbol }/`,
    { headers: auth.getHeaders() },
    { retries: 2, label: `Robinhood ratings ${symbol}` }
  );

  if (!resp.ok) throw new Error(`Ratings fetch failed: ${ resp.status }`);

  return resp.json();
}

export default {
  getLatestPriceMap,
  getLatestPrice,
  getQuotes,
  getQuoteBySymbol,
  getStockHistoricals,
  getFundamentals,
  getNews,
  getRatings
};
