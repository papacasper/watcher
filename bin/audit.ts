#!/usr/bin/env bun
/**
 * audit.ts
 * One-off dividend income snapshot
 * Usage: bun bin/audit.ts
 */

import { Chalk } from "chalk";
import { RobinhoodAuth } from "../src/robinhood/auth.js";
import { getLatestPriceMap } from "../src/robinhood/stocks.js";
import { fetchAuditSnapshot, type AuditDividend, type AuditHolding } from "../src/auditor/snapshot.js";
import { loadDailyCost, loadOptionalRobinhoodCredentials } from "../src/config.js";

const chalk = new Chalk({ level: 2 });
const auth = new RobinhoodAuth();

const DAILY_COST = loadDailyCost();
const DEMO_MODE = Bun.env.AUDIT_DEMO === "true" || Bun.env.DEMO === "true";

console.log(chalk.bold.cyan("\n═══ WHALE WATCHER AUDIT REPORT ═══\n"));

async function run() {
  if (DEMO_MODE) {
    console.log(chalk.yellow("[!] AUDIT_DEMO=true. Running with mock data.\n"));
    await displayDemoReport();
    return;
  }

  if (!auth.isLoggedIn()) {
    const credentials = loadOptionalRobinhoodCredentials();

    if (!credentials) {
      console.error(chalk.red("[!] Set RH_USERNAME/RH_PASSWORD for live audit, or set AUDIT_DEMO=true for mock data."));
      process.exit(1);
    }

    await auth.login(credentials);
  }

  const { holdings: portfolio, dividends } = await fetchAuditSnapshot();

  // Get current quotes for portfolio
  const symbols = portfolio.map(p => p.symbol);
  const prices = symbols.length > 0 ? await getLatestPriceMap(symbols) : new Map<string, number>();
  const priceMap = Object.fromEntries(prices);

  await displayReport(portfolio, dividends, priceMap);
}

async function displayReport(
  portfolio: AuditHolding[],
  dividends: AuditDividend[],
  prices: Record<string, number>
) {
  // Sort portfolio by cost basis descending
  portfolio.sort((a, b) => b.costBasis - a.costBasis);

  console.log(chalk.bold.yellow("PORTFOLIO STATUS\n"));

  const Table = (await import("cli-table3")).default;
  const table = new Table({
    head: ["Ticker", "Shares", "Cost Basis", "Current", "Ann. Div", "YoC %"],
    colWidths: [8, 8, 12, 10, 10, 8]
  });

  const last30Days = dividends.filter(d => {
    const diff = Date.now() - new Date(d.date).getTime();
    return diff >= 0 && diff <= 30 * 24 * 60 * 60 * 1000;
  });

  let totalCostBasis = 0;
  let totalAnnualDividend = 0;
  const annualBySymbol = new Map<string, number>();
  for (const d of last30Days) {
    const current = annualBySymbol.get(d.symbol) ?? 0;
    annualBySymbol.set(d.symbol, current + d.amount * 12);
  }

  for (const holding of portfolio) {
    const currentPrice = prices[holding.symbol] ?? 0;
    const currentValue = holding.shares * currentPrice;
    const annualDiv = annualBySymbol.get(holding.symbol) ?? 0;
    const yoc = holding.costBasis > 0 ? (annualDiv / holding.costBasis) * 100 : 0;

    totalCostBasis += holding.costBasis;
    totalAnnualDividend += annualDiv;

    const rowColor = yoc >= 5 ? chalk.green : yoc >= 3 ? chalk.yellow : chalk.red;
    table.push([
      holding.symbol,
      holding.shares.toFixed(2),
      `$${holding.costBasis.toFixed(2)}`,
      `$${currentValue.toFixed(2)}`,
      `$${annualDiv.toFixed(2)}`,
      rowColor(`${yoc.toFixed(2)}%`)
    ]);
  }

  console.log(table.toString());

  const monthlyAvg = last30Days.reduce((sum, r) => sum + r.amount, 0);
  const daysOfFreedom = Math.floor(monthlyAvg / DAILY_COST);

  console.log(chalk.bold.cyan("\nINCOME METRICS\n"));
  console.log(`  Total Cost Basis:     ${chalk.white(`$${totalCostBasis.toFixed(2)}`)}`);
  console.log(`  Annual Dividend:      ${chalk.green(`$${totalAnnualDividend.toFixed(2)}`)}`);
  console.log(`  Portfolio YoC:        ${chalk.green(`${(totalCostBasis > 0 ? (totalAnnualDividend / totalCostBasis) * 100 : 0).toFixed(2)}%`)}`);
  console.log(`  Monthly Avg Dividends:${chalk.white(`$${monthlyAvg.toFixed(2)}`)}`);
  console.log(chalk.bold.yellow(`\n  DAYS OF FREEDOM:       ${chalk.bold.white(`${daysOfFreedom} days`)}`));
  console.log(`  (Based on $${DAILY_COST}/day cost of living)\n`);
}

async function displayDemoReport() {
  const mockPortfolio = [
    { symbol: "JEPI", shares: 50, costBasis: 2500 },
    { symbol: "JEPQ", shares: 45, costBasis: 2250 },
    { symbol: "O", shares: 20, costBasis: 1600 },
    { symbol: "STRC", shares: 100, costBasis: 1200 },
    { symbol: "STRK", shares: 15, costBasis: 1050 }
  ];

  const mockDividends = generateMockDividends();
  const mockPrices: Record<string, number> = {
    JEPI: 52.50, JEPQ: 51.75, O: 89.30, STRC: 12.45, STRK: 78.90
  };

  await displayReport(mockPortfolio, mockDividends, mockPrices);
}

function generateMockDividends() {
  const now = new Date();
  const records: AuditDividend[] = [];
  const tickers = [
    { symbol: "JEPI", baseAmount: 52.50 },
    { symbol: "JEPQ", baseAmount: 48.75 },
    { symbol: "O", baseAmount: 66.00 },
    { symbol: "STRC", baseAmount: 12.00 },
    { symbol: "STRK", baseAmount: 7.50 }
  ];

  for (let i = 0; i < 12; i++) {
    const date = new Date(now);
    date.setMonth(date.getMonth() - i);

    for (const t of tickers) {
      records.push({
        symbol: t.symbol,
        amount: t.baseAmount + (Math.random() * 5 - 2.5),
        date: date.toISOString(),
        reinvested: false,
      });
    }
  }

  return records.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

await run();
process.exit(0);
