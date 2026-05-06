import { getLatestQuotes } from "../alpaca/quotes.js";

export interface TickerQuote {
  symbol: string;
  price: number;
}

export class TickerWatcher {
  private symbols: string[];

  constructor(symbols: string[]) {
    this.symbols = symbols;
  }

  async getAllQuotes(): Promise<TickerQuote[]> {
    const quotes = await getLatestQuotes(this.symbols);
    return quotes.map(q => ({ symbol: q.symbol, price: q.askPrice }));
  }
}
