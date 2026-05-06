import { alpacaGet } from "./client.js";
import type { Bar } from "./quotes.js";

export type Timeframe = "1Min" | "5Min" | "15Min" | "30Min" | "1Hour" | "4Hour" | "1Day" | "1Week" | "1Month";

export interface HistoricalBarsParams {
  symbols: string[];
  timeframe?: Timeframe;
  /** ISO 8601 date or datetime, e.g. "2024-01-01" */
  start?: string;
  end?: string;
  limit?: number;
}

interface RawBar {
  o: number; h: number; l: number; c: number;
  v: number; t: string; vw: number; n: number;
}

interface BarsResponse {
  bars: Record<string, RawBar[]>;
  next_page_token?: string;
}

function mapBar(symbol: string, b: RawBar): Bar {
  return {
    symbol,
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
    timestamp: b.t,
    vwap: b.vw,
    tradeCount: b.n,
  };
}

/**
 * Historical OHLCV bars for one or more symbols.
 * Paginates automatically until all results are fetched or `limit` is reached.
 */
export async function getHistoricalBars(opts: HistoricalBarsParams): Promise<Record<string, Bar[]>> {
  const {
    symbols,
    timeframe = "1Day",
    start,
    end,
    limit,
  } = opts;

  const params: Record<string, string> = {
    symbols: symbols.join(","),
    timeframe,
    feed: "iex",
    adjustment: "all", // split + dividend adjusted
  };
  if (start) params.start = start;
  if (end) params.end = end;
  if (limit) params.limit = String(limit);

  const result: Record<string, Bar[]> = {};
  for (const s of symbols) result[s] = [];

  let pageToken: string | undefined;

  do {
    if (pageToken) params.page_token = pageToken;
    const data = await alpacaGet<BarsResponse>("/stocks/bars", params);

    for (const [sym, bars] of Object.entries(data.bars)) {
      if (!result[sym]) result[sym] = [];
      result[sym].push(...bars.map(b => mapBar(sym, b)));
    }

    pageToken = data.next_page_token ?? undefined;
  } while (pageToken);

  return result;
}
