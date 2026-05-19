import { fetchWithRetry } from "../utils/http.js"
import type { FinancialHealth } from "./types.js"

const BASE = "https://stockanalysis.com"

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept": "application/json",
}

type SvelteData = (string | number | boolean | null | Record<string, number> | number[])[]

async function fetchSvelteData(url: string): Promise<SvelteData[] | null> {
  const res = await fetchWithRetry(url, { headers: HEADERS }, { retries: 1, label: url })
  if (!res.ok) return null
  const json = await res.json() as { nodes?: { type: string; data: SvelteData }[] }
  return json.nodes?.filter(n => n.type === "data" && Array.isArray(n.data)).map(n => n.data) ?? null
}

function findDataNode(nodes: SvelteData[], key: string): SvelteData | null {
  return nodes.find(data => {
    const root = data[0]
    return typeof root === "object" && root !== null && key in (root as Record<string, unknown>)
  }) ?? null
}

/**
 * The financials __data.json node has shape:
 *   data[0] = { columns: <idx>, rows: <idx>, ... }  (root map)
 *   data[columns_idx] = [colIdx1, colIdx2, ...]      (array of string indices)
 *   data[colIdx]      = "TTM" | "2023" | ...         (column header strings)
 *   data[rows_idx]    = [rowIdx1, rowIdx2, ...]       (array of row-object indices)
 *   data[rowIdx]      = { label: <idx>, values: <idx>, ... }
 *   data[values_idx]  = [valIdx1, valIdx2, ...]       (one per column)
 *   data[valIdx]      = number | null | string
 */
interface ParsedFinancials {
  headers: string[]   // column headers, most-recent first (may include "TTM")
  rows: Map<string, (number | null)[]>  // label -> values aligned to headers
}

function parseFinancialsNode(data: SvelteData): ParsedFinancials | null {
  const root = data[0] as Record<string, number>
  if (!("columns" in root) || !("rows" in root)) return null

  const columnIndices = data[root.columns] as number[]
  if (!Array.isArray(columnIndices)) return null

  const headers: string[] = columnIndices.map(ci => {
    const v = data[ci]
    return typeof v === "string" ? v : String(v ?? "")
  })

  const rowIndices = data[root.rows] as number[]
  if (!Array.isArray(rowIndices)) return null

  const rows = new Map<string, (number | null)[]>()

  for (const ri of rowIndices) {
    const rowObj = data[ri] as Record<string, number>
    if (typeof rowObj !== "object" || rowObj === null) continue

    const labelIdx: number | undefined = rowObj["label"]
    if (labelIdx === undefined) continue
    const label = typeof data[labelIdx] === "string" ? data[labelIdx] as string : null
    if (!label) continue

    const valuesIdx: number | undefined = rowObj["values"]
    if (valuesIdx === undefined) continue
    const valueIndices = data[valuesIdx] as number[]
    if (!Array.isArray(valueIndices)) continue

    const values: (number | null)[] = valueIndices.map(vi => {
      const v = data[vi]
      if (typeof v === "number") return v
      if (typeof v === "string") {
        const parsed = parseFloat(v.replace(/[^0-9.-]/g, ""))
        return Number.isFinite(parsed) ? parsed : null
      }
      return null
    })

    rows.set(label, values)
  }

  return { headers, rows }
}

function cagr(current: number, past: number, years: number): number | null {
  if (years <= 0 || past <= 0 || current <= 0) return null
  return (Math.pow(current / past, 1 / years) - 1) * 100
}

function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

function firstN(values: (number | null)[], n: number, skipTTM: boolean, headers: string[]): (number | null)[] {
  const out: (number | null)[] = []
  for (let i = 0; i < headers.length && out.length < n; i++) {
    if (skipTTM && headers[i] === "TTM") continue
    out.push(values[i] ?? null)
  }
  return out
}

export interface StockRatios {
  peForward: number | null;
  pbRatio: number | null;
  psRatio: number | null;
  evEbitda: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  analystTarget: number | null;
  priceTargetUpside: number | null;
}

export async function getStockRatios(symbol: string): Promise<StockRatios> {
  const s = symbol.toLowerCase()
  const url = `${BASE}/stocks/${s}/financials/ratios/__data.json?x-sveltekit-trailing-slash=1`
  const empty: StockRatios = {
    peForward: null, pbRatio: null, psRatio: null, evEbitda: null,
    debtToEquity: null, currentRatio: null, returnOnEquity: null,
    returnOnAssets: null, analystTarget: null, priceTargetUpside: null,
  }
  const nodes = await fetchSvelteData(url)
  if (!nodes) return empty

  // find node with financialData key
  const node = nodes.find(data => {
    const root = data[0]
    return typeof root === "object" && root !== null && "financialData" in (root as object)
  })
  if (!node) return empty

  const data = node
  const root = data[0] as Record<string, number>
  const fdIdx = root["financialData"]
  if (fdIdx === undefined) return empty
  const fd = data[fdIdx] as Record<string, number> | null
  if (!fd || typeof fd !== "object") return empty

  function pick(key: string): number | null {
    const idx = fd![key]
    if (idx === undefined) return null
    const val = data[idx]
    if (typeof val === "number" && Number.isFinite(val)) return val
    if (Array.isArray(val) && val.length > 0) {
      const first = data[val[0] as number]
      return typeof first === "number" && Number.isFinite(first) ? first : null
    }
    return null
  }

  return {
    peForward: pick("peForward"),
    pbRatio: pick("pb"),
    psRatio: pick("ps"),
    evEbitda: pick("evebitda"),
    debtToEquity: pick("debtequity"),
    currentRatio: pick("currentratio"),
    returnOnEquity: (() => { const v = pick("roe"); return v !== null ? v * 100 : null })(),
    returnOnAssets: (() => { const v = pick("roa"); return v !== null ? v * 100 : null })(),
    analystTarget: null,    // not on ratios page; skip
    priceTargetUpside: null,
  }
}

export async function getFinancialHealth(symbol: string): Promise<FinancialHealth> {
  const s = symbol.toLowerCase()
  const qs = "?x-sveltekit-trailing-slash=1"

  const [incomeNodes, cashNodes] = await Promise.all([
    fetchSvelteData(`${BASE}/stocks/${s}/financials/__data.json${qs}`),
    fetchSvelteData(`${BASE}/stocks/${s}/financials/cash-flow-statement/__data.json${qs}`),
  ])

  const empty: FinancialHealth = {
    symbol: symbol.toUpperCase(),
    freeCashFlow: null,
    freeCashFlowGrowth: null,
    revenueGrowth3yr: null,
    epsGrowth3yr: null,
    grossMargin: null,
    operatingMargin: null,
    netMargin: null,
    returnOnEquity: null,
    returnOnAssets: null,
    debtToEquity: null,
    currentRatio: null,
    interestCoverage: null,
  }

  // Parse income statement
  let revenue: (number | null)[] = []
  let netIncome: (number | null)[] = []
  let eps: (number | null)[] = []
  let grossProfit: (number | null)[] = []
  let operatingIncome: (number | null)[] = []
  let incomeHeaders: string[] = []

  if (incomeNodes) {
    const incomeNode = findDataNode(incomeNodes, "columns") ?? findDataNode(incomeNodes, "rows")
    if (incomeNode) {
      const parsed = parseFinancialsNode(incomeNode)
      if (parsed) {
        incomeHeaders = parsed.headers
        const rev = parsed.rows.get("Revenue") ?? parsed.rows.get("Total Revenue")
        const ni = parsed.rows.get("Net Income") ?? parsed.rows.get("Net Income (Common)")
        const epsRow = parsed.rows.get("EPS (Diluted)") ?? parsed.rows.get("EPS")
        const gp = parsed.rows.get("Gross Profit")
        const oi = parsed.rows.get("Operating Income")

        if (rev) revenue = firstN(rev, 4, false, incomeHeaders)
        if (ni) netIncome = firstN(ni, 4, false, incomeHeaders)
        if (epsRow) eps = firstN(epsRow, 4, false, incomeHeaders)
        if (gp) grossProfit = firstN(gp, 4, false, incomeHeaders)
        if (oi) operatingIncome = firstN(oi, 4, false, incomeHeaders)
      }
    }
  }

  // Parse cash flow statement
  let operatingCF: (number | null)[] = []
  let capex: (number | null)[] = []
  let cfHeaders: string[] = []

  if (cashNodes) {
    const cfNode = findDataNode(cashNodes, "columns") ?? findDataNode(cashNodes, "rows")
    if (cfNode) {
      const parsed = parseFinancialsNode(cfNode)
      if (parsed) {
        cfHeaders = parsed.headers
        const ocf = parsed.rows.get("Operating Cash Flow") ?? parsed.rows.get("Cash from Operations")
        const cx = parsed.rows.get("Capital Expenditures") ?? parsed.rows.get("Capex")
        const fcfDirect = parsed.rows.get("Free Cash Flow")

        if (fcfDirect) {
          operatingCF = firstN(fcfDirect, 4, false, cfHeaders).map(v => v)
          // treat as FCF directly, capex stays empty
          capex = firstN(fcfDirect, 4, false, cfHeaders).map(() => 0)
        } else {
          if (ocf) operatingCF = firstN(ocf, 4, false, cfHeaders)
          if (cx) capex = firstN(cx, 4, false, cfHeaders)
        }
      }
    }
  }

  // Compute FCF = OCF - |capex| (capex is often reported negative already)
  const fcfSeries: (number | null)[] = operatingCF.map((ocf, i) => {
    if (ocf === null) return null
    const cx = capex[i] ?? 0
    // If capex already accounts for sign (negative), add it; else subtract
    return ocf + (cx <= 0 ? cx : -cx)
  })

  const fcfCurrent = fcfSeries[0] ?? null
  const fcfPrev = fcfSeries[1] ?? null

  // Margins use most-recent year (index 0, skip TTM by checking headers)
  // Revenue and net income in millions (SA reports in millions)
  const latestRev = revenue[0] ?? null
  const latestNI = netIncome[0] ?? null
  const latestGP = grossProfit[0] ?? null
  const latestOI = operatingIncome[0] ?? null

  const grossMargin = (latestGP !== null && latestRev !== null && latestRev !== 0)
    ? (latestGP / latestRev) * 100
    : null

  const operatingMargin = (latestOI !== null && latestRev !== null && latestRev !== 0)
    ? (latestOI / latestRev) * 100
    : null

  const netMargin = (latestNI !== null && latestRev !== null && latestRev !== 0)
    ? (latestNI / latestRev) * 100
    : null

  // 3yr CAGR: index 0 is most recent, index 3 is 3 years ago
  const revenueGrowth3yr = (revenue.length >= 4 && revenue[0] !== null && revenue[3] !== null)
    ? cagr(revenue[0]!, revenue[3]!, 3)
    : null

  const epsGrowth3yr = (eps.length >= 4 && eps[0] !== null && eps[3] !== null)
    ? (() => {
        const e0 = eps[0] as number
        const e3 = eps[3] as number
        const c = cagr(Math.abs(e0), Math.abs(e3), 3)
        return c === null ? null : c * (e3 < 0 ? -1 : 1)
      })()
    : null

  return {
    symbol: symbol.toUpperCase(),
    freeCashFlow: fcfCurrent,
    freeCashFlowGrowth: pctChange(fcfCurrent, fcfPrev),
    revenueGrowth3yr,
    epsGrowth3yr,
    grossMargin,
    operatingMargin,
    netMargin,
    // ROE / ROA / D/E / CR / IC — not in income/CF statements; leave null (screener has them)
    returnOnEquity: null,
    returnOnAssets: null,
    debtToEquity: null,
    currentRatio: null,
    interestCoverage: null,
  }
}
