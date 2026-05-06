import { describe, expect, test } from "bun:test";
import { quoteResultsForSymbols } from "../src/robinhood/stocks.js";

describe("stock quote price mapping", () => {
  test("maps reordered quote results back to requested symbols", () => {
    const prices = quoteResultsForSymbols(["AAPL", "MSFT", "O"], [
      { symbol: "MSFT", last_trade_price: "420.50" },
      { symbol: "O", last_trade_price: "57.25" },
      { symbol: "AAPL", last_trade_price: "190.00" },
    ]);

    expect([...prices.entries()]).toEqual([
      ["AAPL", 190],
      ["MSFT", 420.5],
      ["O", 57.25],
    ]);
  });

  test("uses zero for missing or malformed quote results", () => {
    const prices = quoteResultsForSymbols(["AAPL", "MSFT", "O"], [
      { symbol: "MSFT", last_trade_price: "not-a-number" },
      null,
      { symbol: "AAPL", last_trade_price: "190.00" },
    ]);

    expect(prices.get("AAPL")).toBe(190);
    expect(prices.get("MSFT")).toBe(0);
    expect(prices.get("O")).toBe(0);
  });
});
