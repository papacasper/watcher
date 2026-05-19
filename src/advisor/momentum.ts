import type { MomentumSignal } from "./types.js"

function average(closes: number[]): number | null {
  if (closes.length === 0) return null
  return closes.reduce((a, b) => a + b, 0) / closes.length
}

/**
 * Wilder RSI using last 15 closes (14 periods).
 * Requires at least 15 data points.
 */
function wilderRsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null

  const slice = closes.slice(-(period + 1))
  const gains: number[] = []
  const losses: number[] = []

  for (let i = 1; i < slice.length; i++) {
    const diff = (slice[i] ?? 0) - (slice[i - 1] ?? 0)
    gains.push(Math.max(diff, 0))
    losses.push(Math.max(-diff, 0))
  }

  let avgGain = gains.reduce((a, b) => a + b, 0) / period
  let avgLoss = losses.reduce((a, b) => a + b, 0) / period

  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

function pctChange(current: number, past: number | undefined): number | null {
  if (past === undefined || past === 0) return null
  return ((current - past) / Math.abs(past)) * 100
}

export function getMomentumSignal(
  symbol: string,
  priceHistory: [number, number][],
): MomentumSignal {
  // priceHistory: [timestamp_ms, close][] oldest→newest
  const closes = priceHistory.map(([, close]) => close)
  const price = closes.at(-1) ?? 0
  const len = closes.length

  const ma50 = len >= 50 ? average(closes.slice(-50)) : null
  const ma200 = len >= 200 ? average(closes.slice(-200)) : null

  const aboveMa50 = ma50 !== null ? price > ma50 : null
  const aboveMa200 = ma200 !== null ? price > ma200 : null
  const goldenCross = ma50 !== null && ma200 !== null ? ma50 > ma200 : null

  const rsi14 = wilderRsi(closes)

  const high52 = len >= 252 ? Math.max(...closes.slice(-252)) : Math.max(...closes)
  const low52 = len >= 252 ? Math.min(...closes.slice(-252)) : Math.min(...closes)

  const nearHigh52w = price >= high52 * 0.85
  const nearLow52w = price <= low52 * 1.15

  // Trading-day offsets: 1W=5, 1M=21, 3M=63
  const price1WAgo = len >= 5 ? closes[len - 6] : undefined
  const price1MAgo = len >= 21 ? closes[len - 22] : undefined
  const price3MAgo = len >= 63 ? closes[len - 64] : undefined

  return {
    symbol: symbol.toUpperCase(),
    price,
    ma50,
    ma200,
    aboveMa50,
    aboveMa200,
    goldenCross,
    rsi14,
    change1W: pctChange(price, price1WAgo),
    change1M: pctChange(price, price1MAgo),
    change3M: pctChange(price, price3MAgo),
    nearHigh52w,
    nearLow52w,
  }
}
