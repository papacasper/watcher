import { fetchWithRetry } from "../utils/http.js";

export interface WhaleSignal {
  dxy: number;
}

export class WhaleMonitor {
  async check(): Promise<WhaleSignal> {
    const res = await fetchWithRetry(
      "https://stooq.com/q/l/?s=dxy.f&f=sd2t2ohlcv&e=csv",
      {},
      { retries: 2, timeoutMs: 10_000, label: "Stooq DXY" }
    );
    if (!res.ok) throw new Error(`stooq request failed: ${res.status}`);
    const text = await res.text();
    const parts = text.trim().split("\n")[1]?.split(",");
    const dxy = parts ? parseFloat(parts[6]!) : NaN;
    if (isNaN(dxy)) throw new Error(`Bad stooq response: ${text.slice(0, 80)}`);
    return { dxy };
  }
}
