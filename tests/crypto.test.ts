import { describe, expect, test } from "bun:test";
import { cryptoQuoteResultsForSymbols, normalizeCryptoHolding } from "../src/robinhood/crypto.js";

describe("crypto holdings", () => {
  test("normalizes non-zero Robinhood crypto holdings", () => {
    const holding = normalizeCryptoHolding({
      created_at: "2026-04-01T10:00:00Z",
      currency: { code: "BTC", display_code: "BTC", name: "Bitcoin" },
      quantity: "0.010000000000000000",
      cost_bases: [
        {
          direct_cost_basis: "500.00",
          direct_reward_cost_basis: "2.50",
          direct_transfer_cost_basis: "0",
          intraday_cost_basis: "0",
          marked_cost_basis: "0",
        },
      ],
    });

    expect(holding).toEqual({
      symbol: "BTC",
      name: "Bitcoin",
      quantity: 0.01,
      costBasis: 502.5,
      heldSince: "2026-04-01",
    });
  });

  test("ignores zero crypto holdings", () => {
    expect(normalizeCryptoHolding({
      currency: { code: "ETH", name: "Ethereum" },
      quantity: "0.000000000000000000",
    })).toBeNull();
  });

  test("maps crypto forex quote results by asset symbol", () => {
    const prices = cryptoQuoteResultsForSymbols(["BTC", "ETH", "SOL"], [
      { symbol: "ETHUSD", mark_price: "2300.50" },
      { symbol: "BTCUSD", mark_price: "77500.00" },
    ]);

    expect([...prices.entries()]).toEqual([
      ["BTC", 77500],
      ["ETH", 2300.5],
      ["SOL", 0],
    ]);
  });
});
