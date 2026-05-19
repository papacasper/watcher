import type { DividendEntry, Holding } from "./types.js";

const DAY_MS = 86400_000;
const HISTORICAL_INCOME_STATES = new Set(["paid", "pending", "reinvested"]);
const FORWARD_INCOME_STATES = new Set(["pending", "announced", "projected"]);

export interface IncomeMetrics {
  trailing30dIncome: number;
  annualizedTrailingIncome: number;
  forwardProjectedAnnualIncome: number;
  dividendTargetDaily: number;
  dividendTargetAnnual: number;
  forwardProjectedDailyIncome: number;
  dividendGoalProgressPct: number;
  dividendIncomeGapDaily: number;
  dividendIncomeGapAnnual: number;
  capitalRequiredAtCurrentYield: number | null;
  annualYieldOnCost: number;
  lifetimeDividendYieldOnCost: number;
  daysOfFreedom: number;
}

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateMs(date: string): number {
  return new Date(`${date}T12:00:00Z`).getTime();
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function daysBetween(startDate: string, endDate: string): number {
  return Math.max(1, Math.round((dateMs(endDate) - dateMs(startDate)) / DAY_MS));
}

export function calculateIncomeMetrics(
  dividendList: DividendEntry[],
  totalCost: number,
  totalDivs: number,
  dailyCost: number,
  currentValue = 0,
  dividendTargetDaily = 280,
  now = new Date(),
  forwardHorizon = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate())
): IncomeMetrics {
  const todayStr = dateKey(now);
  const trailingStartStr = dateKey(addDays(now, -30));
  const horizonStr = dateKey(forwardHorizon);

  const trailing30dIncome = dividendList
    .filter(d =>
      HISTORICAL_INCOME_STATES.has(d.state) &&
      d.payableDate >= trailingStartStr &&
      d.payableDate <= todayStr
    )
    .reduce((s, d) => s + d.amount, 0);

  const forwardIncome = dividendList
    .filter(d =>
      FORWARD_INCOME_STATES.has(d.state) &&
      d.payableDate > todayStr &&
      d.payableDate <= horizonStr
    )
    .reduce((s, d) => s + d.amount, 0);

  const horizonDays = daysBetween(todayStr, horizonStr);
  const annualizedTrailingIncome = trailing30dIncome * 12;
  const forwardProjectedAnnualIncome = forwardIncome > 0 ? forwardIncome * (365 / horizonDays) : 0;
  const dividendTargetAnnual = dividendTargetDaily * 365;
  const forwardProjectedDailyIncome = forwardProjectedAnnualIncome / 365;
  const dividendIncomeGapAnnual = Math.max(dividendTargetAnnual - forwardProjectedAnnualIncome, 0);
  const dividendIncomeGapDaily = dividendIncomeGapAnnual / 365;
  const dividendGoalProgressPct = dividendTargetAnnual > 0
    ? Math.min((forwardProjectedAnnualIncome / dividendTargetAnnual) * 100, 100)
    : 100;
  const portfolioForwardYield = currentValue > 0 ? forwardProjectedAnnualIncome / currentValue : 0;
  const capitalRequiredAtCurrentYield = dividendIncomeGapAnnual <= 0
    ? 0
    : (portfolioForwardYield > 0 ? dividendIncomeGapAnnual / portfolioForwardYield : null);

  return {
    trailing30dIncome,
    annualizedTrailingIncome,
    forwardProjectedAnnualIncome,
    dividendTargetDaily,
    dividendTargetAnnual,
    forwardProjectedDailyIncome,
    dividendGoalProgressPct,
    dividendIncomeGapDaily,
    dividendIncomeGapAnnual,
    capitalRequiredAtCurrentYield,
    annualYieldOnCost: totalCost > 0 ? (annualizedTrailingIncome / totalCost) * 100 : 0,
    lifetimeDividendYieldOnCost: totalCost > 0 ? (totalDivs / totalCost) * 100 : 0,
    daysOfFreedom: dividendTargetDaily > 0 ? Math.floor(trailing30dIncome / dividendTargetDaily) : 0,
  };
}

export function calculateHoldingForwardIncome(
  holdings: Holding[],
  dividendList: DividendEntry[],
  now = new Date(),
  forwardHorizon = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate())
): Holding[] {
  const todayStr = dateKey(now);
  const horizonStr = dateKey(forwardHorizon);
  const horizonDays = daysBetween(todayStr, horizonStr);
  const forwardIncomeBySymbol = new Map<string, number>();

  for (const d of dividendList) {
    if (!FORWARD_INCOME_STATES.has(d.state) || d.payableDate <= todayStr || d.payableDate > horizonStr) continue;
    forwardIncomeBySymbol.set(d.symbol, (forwardIncomeBySymbol.get(d.symbol) ?? 0) + d.amount);
  }

  const forwardAnnualBySymbol = new Map(
    [...forwardIncomeBySymbol.entries()].map(([symbol, amount]) => [symbol, amount * (365 / horizonDays)] as [string, number])
  );
  const totalForwardAnnualIncome = [...forwardAnnualBySymbol.values()].reduce((sum, amount) => sum + amount, 0);

  return holdings.map(holding => {
    const forwardAnnualIncome = forwardAnnualBySymbol.get(holding.symbol) ?? 0;
    return {
      ...holding,
      forwardAnnualIncome,
      forwardDailyIncome: forwardAnnualIncome / 365,
      forwardYieldOnCost: holding.costBasis > 0 ? (forwardAnnualIncome / holding.costBasis) * 100 : 0,
      forwardYieldOnValue: holding.value > 0 ? (forwardAnnualIncome / holding.value) * 100 : 0,
      forwardIncomePct: totalForwardAnnualIncome > 0 ? (forwardAnnualIncome / totalForwardAnnualIncome) * 100 : 0,
    };
  });
}
