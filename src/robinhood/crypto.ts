import { paginationRequest } from "./helper.js";
import { auth } from "./auth.js";
import { fetchWithRetry } from "../utils/http.js";

const NUMMUS_URL = "https://nummus.robinhood.com";
const MARKETDATA_URL = "https://api.robinhood.com/marketdata";

type RawRecord = Record<string, unknown>;

interface RawCryptoCurrency {
  code?: string;
  display_code?: string;
  name?: string;
}

interface RawCryptoCostBase {
  direct_cost_basis?: string;
  direct_reward_cost_basis?: string;
  direct_transfer_cost_basis?: string;
  intraday_cost_basis?: string;
  marked_cost_basis?: string;
}

interface RawCryptoTaxLot {
  clearing_book_cost_basis?: string;
  intraday_cost_basis?: string;
}

export interface RawCryptoHolding {
  created_at?: string;
  currency?: RawCryptoCurrency;
  quantity?: string;
  cost_bases?: RawCryptoCostBase[];
  tax_lot_cost_bases?: RawCryptoTaxLot[];
}

export interface CryptoHolding {
  symbol: string;
  name: string;
  quantity: number;
  costBasis: number;
  heldSince: string;
}

interface RawCryptoQuote {
  symbol?: string;
  mark_price?: string | null;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function asNumber(value: unknown): number {
  const parsed = parseFloat(asString(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function costBasisFromHolding(holding: RawCryptoHolding): number {
  const direct = (holding.cost_bases ?? []).reduce((sum, base) =>
    sum +
    asNumber(base.direct_cost_basis) +
    asNumber(base.direct_reward_cost_basis) +
    asNumber(base.direct_transfer_cost_basis) +
    asNumber(base.intraday_cost_basis) +
    asNumber(base.marked_cost_basis), 0);
  if (direct > 0) return direct;

  return (holding.tax_lot_cost_bases ?? []).reduce((sum, lot) =>
    sum + asNumber(lot.clearing_book_cost_basis) + asNumber(lot.intraday_cost_basis), 0);
}

export function normalizeCryptoHolding(raw: RawCryptoHolding): CryptoHolding | null {
  const symbol = (raw.currency?.display_code ?? raw.currency?.code ?? "").trim().toUpperCase();
  const quantity = asNumber(raw.quantity);

  if (!symbol || quantity <= 0) return null;

  return {
    symbol,
    name: raw.currency?.name?.trim() || symbol,
    quantity,
    costBasis: costBasisFromHolding(raw),
    heldSince: raw.created_at?.slice(0, 10) ?? "",
  };
}

export function cryptoQuoteResultsForSymbols(
  symbols: string[],
  results: Array<RawCryptoQuote | null | undefined>
): Map<string, number> {
  const responsePrices = new Map<string, number>();

  for (const quote of results) {
    if (!quote?.symbol) continue;
    const code = quote.symbol.replace(/USD$/i, "").toUpperCase();
    const parsed = asNumber(quote.mark_price);
    responsePrices.set(code, parsed);
  }

  return new Map(symbols.map(symbol => [symbol, responsePrices.get(symbol) ?? 0]));
}

export async function getOpenCryptoHoldings(): Promise<CryptoHolding[]> {
  const raw = await paginationRequest<RawRecord[]>(`${NUMMUS_URL}/holdings/`);
  return raw
    .map(item => normalizeCryptoHolding(item as RawCryptoHolding))
    .filter((holding): holding is CryptoHolding => holding !== null);
}

export async function getCryptoPriceMap(symbols: string[]): Promise<Map<string, number>> {
  const normalized = symbols.map(symbol => symbol.trim().toUpperCase()).filter(Boolean);
  if (normalized.length === 0) return new Map<string, number>();

  const quoteSymbols = normalized.map(symbol => `${symbol}USD`).join(",");
  const url = `${MARKETDATA_URL}/forex/quotes/?symbols=${quoteSymbols}`;
  const response = await fetchWithRetry(url, { headers: auth.getHeaders() }, {
    retries: 2,
    label: "Robinhood crypto quotes",
  });

  if (!response.ok) throw new Error(`Crypto quote fetch failed: ${response.status}`);

  const data = await response.json() as { results?: Array<RawCryptoQuote | null> };
  return cryptoQuoteResultsForSymbols(normalized, data.results ?? []);
}
