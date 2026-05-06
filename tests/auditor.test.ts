import { describe, expect, test } from "bun:test";
import { DaysOfFreedomAuditor } from "../src/auditor/income.js";
import { normalizeAuditSnapshot } from "../src/auditor/snapshot.js";

describe("auditor snapshot normalization", () => {
  test("maps dividend instrument ids through current positions instead of using url tail as ticker", async () => {
    const snapshot = await normalizeAuditSnapshot(
      [
        {
          instrument_id: "instrument-uuid-o",
          instrument: "https://api.robinhood.com/instruments/instrument-uuid-o/",
          symbol: "O",
          quantity: "40.0000",
          average_buy_price: "58.50",
        },
      ],
      [
        {
          instrument: "https://api.robinhood.com/instruments/instrument-uuid-o/",
          amount: "10.82",
          paid_at: "2026-04-01",
          state: "paid",
          drip_enabled: false,
        },
        {
          instrument: "https://api.robinhood.com/instruments/instrument-uuid-o/",
          amount: "99.99",
          paid_at: "2026-04-02",
          state: "canceled",
          drip_enabled: false,
        },
      ]
    );

    expect(snapshot.holdings).toEqual([
      { symbol: "O", shares: 40, costBasis: 2340 },
    ]);
    expect(snapshot.dividends).toEqual([
      {
        symbol: "O",
        amount: 10.82,
        date: "2026-04-01",
        reinvested: false,
        rate: undefined,
        position: undefined,
      },
    ]);
  });
});

describe("days of freedom", () => {
  test("uses trailing 30-day income directly instead of multiplying by 30", () => {
    Bun.env.DAILY_COST = "280";
    const auditor = new DaysOfFreedomAuditor();
    expect(auditor.calculateDaysOfFreedom(279)).toBe(0);
    expect(auditor.calculateDaysOfFreedom(280)).toBe(1);
    expect(auditor.calculateDaysOfFreedom(560)).toBe(2);
  });
});
