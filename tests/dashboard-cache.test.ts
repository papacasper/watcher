import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getCachePath, loadDataCache, saveDataCache } from "../src/dashboard/cache.js";
import type { DashboardData } from "../src/dashboard/data.js";

let cacheDir: string | null = null;

function useTempCacheDir(): string {
  cacheDir = mkdtempSync(join(tmpdir(), "watcher-dashboard-cache-"));
  Bun.env.WATCHER_CACHE_DIR = cacheDir;
  return cacheDir;
}

function sampleData(): DashboardData {
  return {
    fetchedAt: "2026-04-27T12:00:00.000Z",
    holdings: [],
    dividends: [],
    spending: null,
    summary: {
      totalCost: 0,
      totalValue: 0,
      grossHoldingsValue: 0,
      netLiquidationValue: 0,
      cashBalance: 0,
      pnl: 0,
      pnlPct: 0,
      divsEarned: 0,
      last30dIncome: 0,
      trailing30dIncome: 0,
      annualizedTrailingIncome: 0,
      forwardProjectedAnnualIncome: 0,
      annualYieldOnCost: 0,
      lifetimeDividendYieldOnCost: 0,
      dailyCost: 150,
      daysOfFreedom: 0,
      reconciliation: {
        stockGrossValue: 0,
        stockNetValue: 0,
        cryptoValue: 0,
        netAdjustment: 0,
        source: "stock_positions",
        stale: false,
      },
    },
  };
}

afterEach(() => {
  delete Bun.env.WATCHER_CACHE_DIR;
  if (cacheDir) rmSync(cacheDir, { recursive: true, force: true });
  cacheDir = null;
});

describe("dashboard cache permissions", () => {
  test("saveDataCache writes cache dir as 0700 and data as 0600", () => {
    const dir = useTempCacheDir();

    saveDataCache(sampleData());

    expect((statSync(dir).mode & 0o777).toString(8)).toBe("700");
    expect((statSync(getCachePath()).mode & 0o777).toString(8)).toBe("600");
  });

  test("loadDataCache tightens existing permissive cache dir and data file", () => {
    const dir = useTempCacheDir();
    const path = getCachePath();

    writeFileSync(path, JSON.stringify(sampleData()), { mode: 0o644 });
    chmodSync(dir, 0o755);

    expect(loadDataCache()?.fetchedAt).toBe("2026-04-27T12:00:00.000Z");
    expect((statSync(dir).mode & 0o777).toString(8)).toBe("700");
    expect((statSync(path).mode & 0o777).toString(8)).toBe("600");
  });
});
