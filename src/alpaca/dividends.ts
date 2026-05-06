import { loadAlpacaCredentials } from "../config.js";
import { fetchWithRetry } from "../utils/http.js";

const BASE = "https://paper-api.alpaca.markets/v2";

function headers(): Record<string, string> {
  const { key, secret } = loadAlpacaCredentials();
  return {
    "APCA-API-KEY-ID": key,
    "APCA-API-SECRET-KEY": secret,
  };
}

export interface AnnouncedDividend {
  symbol: string;
  payableDate: string;
  cash: number;   // per-share rate
  exDate: string;
}

export async function getAnnouncedDividends(
  symbols: string[],
  since: string,
  until: string,
): Promise<AnnouncedDividend[]> {
  const results: AnnouncedDividend[] = [];

  await Promise.all(symbols.map(async (symbol) => {
    const url = new URL(`${BASE}/corporate_actions/announcements`);
    url.searchParams.set("ca_types", "Dividend");
    url.searchParams.set("since", since);
    url.searchParams.set("until", until);
    url.searchParams.set("symbol", symbol);

    const res = await fetchWithRetry(url, { headers: headers() }, { retries: 1, label: `Alpaca dividends ${symbol}` });
    if (!res.ok) return;
    const data = await res.json() as any[];
    for (const d of data) {
      if (d.ca_sub_type !== "cash" || !d.payable_date) continue;
      results.push({
        symbol,
        payableDate: d.payable_date,
        cash: parseFloat(d.cash),
        exDate: d.ex_date,
      });
    }
  }));

  return results;
}
