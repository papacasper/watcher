#!/usr/bin/env bun
import { Chalk } from "chalk";
import Table from "cli-table3";
import { fetchDashboardData } from "../src/dashboard/data.js";

const chalk = new Chalk({ level: 3 });
const data = await fetchDashboardData();
const { holdings, dividends, summary } = data;

// Only historical dividends for the CLI table (exclude projected/announced)
const historicDivsBySymbol = new Map<string, typeof dividends>();
for (const h of holdings) historicDivsBySymbol.set(h.symbol, []);
for (const d of dividends) {
  if (!["paid", "pending", "reinvested"].includes(d.state)) continue;
  historicDivsBySymbol.get(d.symbol)?.push(d);
}

const w = process.stdout.columns || 100;
const rule = (c: string) => chalk.dim(c.repeat(w));
const header = (t: string) => chalk.bold.cyan(`  ${t}`);
const col = (label: string, value: string) => `  ${chalk.dim(label.padEnd(26))}${value}`;

console.clear();
console.log();
console.log(chalk.bold.white("  PORTFOLIO DASHBOARD") + chalk.dim(`  —  ${new Date().toLocaleString()}`));
console.log(rule("─"));
console.log();
console.log(header("TABLE OF CONTENTS"));
console.log(chalk.dim("  1. Holdings") + "   2. Dividends (since acquisition)   3. Summary");
console.log();
console.log(rule("─"));

// ── 1. Holdings ───────────────────────────────────────────────────────────────
console.log();
console.log(header("1. HOLDINGS"));
console.log();

const holdingsTable = new Table({
  head: ["Symbol", "Shares", "Avg Cost", "Spent", "Price", "Value", "P&L", "P&L %", "Divs Earned"].map(h => chalk.bold(h)),
  colWidths: [9, 9, 10, 11, 10, 11, 11, 9, 13],
  style: { head: [], border: ["dim"] },
});

for (const h of holdings) {
  const pnlColor = h.pnl >= 0 ? chalk.green : chalk.red;
  holdingsTable.push([
    chalk.bold.yellow(h.symbol),
    h.shares.toFixed(4),
    `$${h.avgCost > 0 ? h.avgCost.toFixed(2) : "—"}`,
    chalk.white(`$${h.costBasis.toFixed(2)}`),
    `$${h.price.toFixed(2)}`,
    `$${h.value.toFixed(2)}`,
    pnlColor(`${h.pnl >= 0 ? "+" : ""}$${h.pnl.toFixed(2)}`),
    pnlColor(`${h.pnlPct >= 0 ? "+" : ""}${h.pnlPct.toFixed(2)}%`),
    chalk.green(`$${h.divsEarned.toFixed(2)}`),
  ]);
}

console.log(holdingsTable.toString());
console.log();
console.log(rule("─"));

// ── 2. Dividends ──────────────────────────────────────────────────────────────
console.log();
console.log(header("2. DIVIDENDS  (since acquisition of current shares)"));
console.log();

const divTable = new Table({
  head: ["Symbol", "Date", "Amount", "Shares", "Rate", "State"].map(h => chalk.bold(h)),
  colWidths: [9, 13, 10, 9, 10, 11],
  style: { head: [], border: ["dim"] },
});

for (const h of holdings) {
  const divs = historicDivsBySymbol.get(h.symbol) ?? [];
  if (divs.length === 0) {
    divTable.push([chalk.bold.yellow(h.symbol), chalk.dim("no dividends"), "", "", "", ""]);
    continue;
  }
  for (let i = 0; i < divs.length; i++) {
    const d = divs[i]!;
    const stateColor = d.state === "paid" ? chalk.green : d.state === "pending" ? chalk.yellow : chalk.dim;
    divTable.push([
      i === 0 ? chalk.bold.yellow(h.symbol) : "",
      d.payableDate,
      chalk.green(`$${d.amount.toFixed(2)}`),
      d.shares.toFixed(4),
      `$${d.rate.toFixed(4)}`,
      stateColor(d.state),
    ]);
  }
}

console.log(divTable.toString());
console.log();
console.log(rule("─"));

console.log(rule("─"));

// ── 4. Summary ────────────────────────────────────────────────────────────────
console.log();
console.log(header("4. SUMMARY"));
console.log();

const pnlColor = summary.pnl >= 0 ? chalk.green : chalk.red;
console.log(col("Total Invested:", chalk.white(`$${summary.totalCost.toFixed(2)}`)));
console.log(col("Portfolio Value:", chalk.white(`$${summary.totalValue.toFixed(2)}`)));
console.log(col("Unrealized P&L:", pnlColor(`${summary.pnl >= 0 ? "+" : ""}$${summary.pnl.toFixed(2)}  (${summary.pnlPct >= 0 ? "+" : ""}${summary.pnlPct.toFixed(2)}%)`)));
console.log(col("Dividends Earned:", chalk.green(`$${summary.divsEarned.toFixed(2)}`)));
console.log(col("Last 30d Income:", chalk.green(`$${summary.last30dIncome.toFixed(2)}`)));
console.log(col("Daily Dividend Target:", chalk.dim(`$${summary.dividendTargetDaily.toFixed(2)}`)));
console.log(col("Daily Cost of Living:", chalk.dim(`$${summary.dailyCost.toFixed(2)}`)));
console.log();
console.log(`  ${chalk.bold.white("DAYS OF FREEDOM:")}  ${chalk.bold.cyan(String(summary.daysOfFreedom))} days`);
console.log();
console.log(rule("─"));
console.log();
