import type { DividendEntry } from "./types.js";

export type DividendIncomeMode = "realized" | "cash";

export interface MonthlyDividendBucket {
  key: string;
  label: string;
  value: number;
}

export function dividendStatesForMode(mode: DividendIncomeMode): Set<string> {
  return mode === "cash" ? new Set(["paid"]) : new Set(["paid", "reinvested"]);
}

export function monthlyDividendBuckets(
  dividends: Pick<DividendEntry, "payableDate" | "amount" | "state">[],
  mode: DividendIncomeMode
): MonthlyDividendBucket[] {
  const includedStates = dividendStatesForMode(mode);
  const byMonth: Record<string, number> = {};

  for (const dividend of dividends) {
    if (!includedStates.has(dividend.state)) continue;
    const key = dividend.payableDate.slice(0, 7);
    byMonth[key] = (byMonth[key] ?? 0) + dividend.amount;
  }

  return Object.entries(byMonth)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => ({
      key,
      label: new Date(`${key}-02`).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      value,
    }));
}
