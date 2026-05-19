import { describe, expect, test } from "bun:test";
import { dividendStatesForMode, monthlyDividendBuckets } from "../frontend/dividends.js";
import type { DividendEntry } from "../frontend/types.js";

describe("frontend dividend income buckets", () => {
  test("realized mode includes paid and reinvested dividends by month", () => {
    const buckets = monthlyDividendBuckets(sampleDividends(), "realized");

    expect(buckets.map(bucket => [bucket.key, bucket.value])).toEqual([
      ["2026-04", 15],
      ["2026-05", 3],
    ]);
  });

  test("cash mode includes paid dividends only", () => {
    const buckets = monthlyDividendBuckets(sampleDividends(), "cash");

    expect(buckets.map(bucket => [bucket.key, bucket.value])).toEqual([
      ["2026-04", 10],
      ["2026-05", 3],
    ]);
  });

  test("exposes included states for each income mode", () => {
    expect([...dividendStatesForMode("realized")]).toEqual(["paid", "reinvested"]);
    expect([...dividendStatesForMode("cash")]).toEqual(["paid"]);
  });
});

function sampleDividends(): DividendEntry[] {
  return [
    { symbol: "O", payableDate: "2026-04-15", amount: 10, shares: 10, rate: 1, state: "paid" },
    { symbol: "SCHD", payableDate: "2026-04-30", amount: 5, shares: 10, rate: 0.5, state: "reinvested" },
    { symbol: "O", payableDate: "2026-05-15", amount: 3, shares: 10, rate: 0.3, state: "paid" },
    { symbol: "O", payableDate: "2026-05-20", amount: 8, shares: 10, rate: 0.8, state: "pending" },
    { symbol: "O", payableDate: "2026-06-20", amount: 9, shares: 10, rate: 0.9, state: "announced" },
  ];
}
