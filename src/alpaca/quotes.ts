import { alpacaGet } from "./client.js";

export interface Quote {
  symbol: string;
  askPrice: number;
  askSize: number;
  bidPrice: number;
  bidSize: number;
  timestamp: string;
}

export interface Bar {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: string;
  vwap: number;
  tradeCount: number;
}

interface RawQuote {
  ap: number; as: number;
  bp: number; bs: number;
  t: string;
}

interface RawBar {
  o: number; h: number; l: number; c: number;
  v: number; t: string; vw: number; n: number;
}

function mapQuote(symbol: string, q: RawQuote): Quote {
  return {
    symbol,
    askPrice: q.ap,
    askSize: q.as,
    bidPrice: q.bp,
    bidSize: q.bs,
    timestamp: q.t,
  };
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

/** Latest NBBO quote for one or more symbols (15-min delayed on free tier). */
export async function getLatestQuotes(symbols: string[]): Promise<Quote[]> {
  const data = await alpacaGet<{ quotes: Record<string, RawQuote> }>(
    "/stocks/quotes/latest",
    { symbols: symbols.join(","), feed: "iex" }
  );
  return symbols.flatMap(s => (data.quotes[s] ? [mapQuote(s, data.quotes[s])] : []));
}

/** Latest 1-min bar for one or more symbols. */
export async function getLatestBars(symbols: string[]): Promise<Bar[]> {
  const data = await alpacaGet<{ bars: Record<string, RawBar> }>(
    "/stocks/bars/latest",
    { symbols: symbols.join(","), feed: "iex" }
  );
  return symbols.flatMap(s => (data.bars[s] ? [mapBar(s, data.bars[s])] : []));
}
