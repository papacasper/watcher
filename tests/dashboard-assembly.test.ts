import { afterEach, describe, expect, mock, setSystemTime, test } from "bun:test";

mock.module("../src/robinhood/auth.js", () => ({
  auth: {
    login: mock(async () => ({
      accessToken: "token",
      tokenType: "Bearer",
      refreshToken: "refresh",
      expiresIn: 3600,
      scope: "internal",
    })),
    getHeaders: () => ({ Authorization: "Bearer token" }),
  },
}));

mock.module("../src/robinhood/accounts.js", () => ({
  getOpenStockPositions: mock(async () => [
    {
      instrument_id: "instrument-o",
      instrument: "https://api.robinhood.com/instruments/instrument-o/",
      symbol: "O",
      quantity: "10.0000",
      average_buy_price: "50.00",
    },
    {
      instrument_id: "instrument-schd",
      instrument: "https://api.robinhood.com/instruments/instrument-schd/",
      symbol: "SCHD",
      quantity: "20.0000",
      average_buy_price: "70.00",
    },
  ]),
  getDividends: mock(async () => [
    {
      instrument: "https://api.robinhood.com/instruments/instrument-o/",
      payable_date: "2026-04-20",
      amount: "3.00",
      position: "10.0000",
      rate: "0.3000",
      state: "paid",
    },
    {
      instrument: "https://api.robinhood.com/instruments/instrument-o/",
      payable_date: "2026-05-20",
      amount: "3.00",
      position: "10.0000",
      rate: "0.3000",
      state: "pending",
    },
    {
      instrument: "https://api.robinhood.com/instruments/instrument-schd/",
      payable_date: "2026-04-10",
      amount: "10.00",
      position: "20.0000",
      rate: "0.5000",
      state: "reinvested",
    },
    {
      instrument: "https://api.robinhood.com/instruments/instrument-o/",
      payable_date: "2026-04-22",
      amount: "99.00",
      position: "10.0000",
      rate: "9.9000",
      state: "canceled",
    },
  ]),
  getSpendingAccountBalance: mock(async () => ({
    portfolio_cash: "100.00",
    cash_available_for_withdrawal: "80.00",
    buying_power: "150.00",
  })),
  getCardTransactions: mock(async () => [
    {
      record_date: "2026-05-01",
      amount: { amount: "25.00" },
      direction: "debit",
      transaction_type: "settled",
    },
  ]),
}));

mock.module("../src/robinhood/helper.js", () => ({
  paginationRequest: mock(async (url: string) => {
    if (url.includes("/orders/")) return [];
    if (url.includes("/portfolios/")) {
      return [{ is_primary_account: true, equity: "2300.00" }];
    }
    return [];
  }),
}));

mock.module("../src/robinhood/stocks.js", () => ({
  getLatestPriceMap: mock(async () => new Map([
    ["O", 60],
    ["SCHD", 80],
  ])),
}));

mock.module("../src/robinhood/crypto.js", () => ({
  getOpenCryptoHoldings: mock(async () => [
    { symbol: "BTC", name: "Bitcoin", quantity: 0.1, costBasis: 5_000, heldSince: "2026-03-01" },
  ]),
  getCryptoPriceMap: mock(async () => new Map([["BTC", 70_000]])),
}));

mock.module("../src/utils/http.js", () => ({
  fetchWithRetry: mock(async (input: string | URL) => {
    const url = input.toString();
    if (url.includes("api.nasdaq.com")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            calendar: {
              rows: [
                { symbol: "O", payment_Date: "2026-06-20", dividend_Rate: "0.31", ex_Date: "2026-06-10" },
                { symbol: "SCHD", payment_Date: "2026-06-25", dividend_Rate: "0.75", ex_Date: "2026-06-15" },
              ],
            },
          },
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        simple_name: url.includes("instrument-schd") ? "Schwab US Dividend Equity ETF" : "Realty Income",
      }),
    };
  }),
}));

const { fetchDashboardData } = await import("../src/dashboard/data.js");

afterEach(() => {
  setSystemTime();
  delete Bun.env.RH_USERNAME;
  delete Bun.env.RH_PASSWORD;
  delete Bun.env.DAILY_COST;
  delete Bun.env.DIVIDEND_TARGET_DAILY;
});

describe("dashboard data assembly", () => {
  test("builds the dividend-goal dashboard while keeping crypto and spending contextual", async () => {
    setSystemTime(new Date("2026-05-06T12:00:00Z"));
    Bun.env.RH_USERNAME = "user";
    Bun.env.RH_PASSWORD = "pass";
    Bun.env.DAILY_COST = "125";
    Bun.env.DIVIDEND_TARGET_DAILY = "280";

    const data = await fetchDashboardData();

    expect(data.holdings.map(h => h.symbol)).toEqual(["SCHD", "O"]);
    expect(data.holdings.some(h => h.symbol === "BTC" || h.source === "crypto")).toBe(false);
    expect(data.dividends.map(d => d.state)).toContain("paid");
    expect(data.dividends.map(d => d.state)).toContain("pending");
    expect(data.dividends.map(d => d.state)).toContain("announced");
    expect(data.dividends.map(d => d.state)).toContain("projected");

    const o = data.holdings.find(h => h.symbol === "O");
    const schd = data.holdings.find(h => h.symbol === "SCHD");
    expect(o?.name).toBe("Realty Income");
    expect(o?.forwardAnnualIncome).toBeGreaterThan(0);
    expect(schd?.forwardAnnualIncome).toBeGreaterThan(0);

    expect(data.summary.grossHoldingsValue).toBe(2_200);
    expect(data.summary.reconciliation.stockGrossValue).toBe(2_200);
    expect(data.summary.reconciliation.stockNetValue).toBe(2_300);
    expect(data.summary.reconciliation.cryptoValue).toBe(7_000);
    expect(data.summary.netLiquidationValue).toBe(9_300);
    expect(data.summary.dividendTargetDaily).toBe(280);
    expect(data.summary.dividendTargetAnnual).toBe(102_200);
    expect(data.summary.forwardProjectedAnnualIncome).toBeGreaterThan(0);
    expect(data.summary.forwardProjectedDailyIncome).toBeCloseTo(data.summary.forwardProjectedAnnualIncome / 365, 6);
    expect(data.summary.dividendGoalProgressPct).toBeGreaterThan(0);
    expect(data.summary.dividendIncomeGapAnnual).toBeGreaterThan(0);

    expect(data.summary.dailyCost).toBe(125);

  });
});
