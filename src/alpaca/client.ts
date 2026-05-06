import { loadAlpacaCredentials } from "../config.js";
import { fetchWithRetry } from "../utils/http.js";

const BASE = "https://data.alpaca.markets/v2";

function headers(): Record<string, string> {
  const { key, secret } = loadAlpacaCredentials();
  return {
    "APCA-API-KEY-ID": key,
    "APCA-API-SECRET-KEY": secret,
    "Accept": "application/json",
  };
}

export async function alpacaGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(BASE + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetchWithRetry(url, { headers: headers() }, { retries: 2, label: `Alpaca ${path}` });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Alpaca ${res.status} ${path}: ${body}`);
  }
  return res.json() as Promise<T>;
}
