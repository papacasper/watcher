import { runAdvisor } from "../src/advisor/index.js"
import type { AdvisorResult, ScoreBreakdown } from "../src/advisor/types.js"

function parseArgs(): { top: number; maxCandidates: number; minMarketCap: number; concurrency: number } {
  const args = process.argv.slice(2)
  let top = 10
  let maxCandidates = 100
  let minMarketCap = 1_000_000_000
  let concurrency = 5

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--top" && args[i + 1] !== undefined) top = parseInt(args[++i]!, 10)
    if (args[i] === "--max" && args[i + 1] !== undefined) maxCandidates = parseInt(args[++i]!, 10)
    if (args[i] === "--min-cap" && args[i + 1] !== undefined) minMarketCap = parseFloat(args[++i]!)
    if (args[i] === "--concurrency" && args[i + 1] !== undefined) concurrency = parseInt(args[++i]!, 10)
  }

  return { top, maxCandidates, minMarketCap, concurrency }
}

function pad(s: string | number, width: number, right = false): string {
  const str = String(s)
  const padding = " ".repeat(Math.max(0, width - str.length))
  return right ? padding + str : str + padding
}

function formatPrice(p: number): string {
  return `$${p.toFixed(2)}`
}

function recColor(rec: string): string {
  if (rec === "Strong Buy") return "\x1b[32m" // green
  if (rec === "Buy") return "\x1b[36m"         // cyan
  if (rec === "Watch") return "\x1b[33m"       // yellow
  return "\x1b[31m"                            // red
}

const RESET = "\x1b[0m"
const BOLD = "\x1b[1m"
const DIM = "\x1b[2m"

function printTable(results: AdvisorResult[], top: number): void {
  const rows = results.slice(0, top)

  console.log()
  console.log(BOLD + pad("RANK", 5) + pad("SYMBOL", 8) + pad("PRICE", 10) + pad("SCORE", 7) + pad("REC", 14) + "TOP REASON" + RESET)
  console.log(DIM + "─".repeat(90) + RESET)

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r) continue
    const rank = pad(i + 1, 4, true)
    const sym = pad(r.symbol, 7)
    const price = pad(formatPrice(r.price), 10, true)
    const score = pad(r.totalScore.toFixed(1), 6, true)
    const rec = recColor(r.recommendation) + pad(r.recommendation, 13) + RESET
    const reason = r.topReasons[0] ?? "—"
    console.log(` ${rank}  ${sym} ${price} ${score}  ${rec} ${reason}`)
  }
}

function printBreakdown(result: AdvisorResult, rank: number): void {
  console.log()
  console.log(BOLD + `--- #${rank} ${result.symbol} (${result.name}) ---` + RESET)
  console.log(`Price: ${formatPrice(result.price)}  Score: ${result.totalScore}  Recommendation: ${recColor(result.recommendation)}${result.recommendation}${RESET}`)
  console.log()

  for (const b of result.breakdown as ScoreBreakdown[]) {
    const bar = "█".repeat(Math.round(b.score / 5)).padEnd(20)
    console.log(BOLD + `  ${b.category.toUpperCase()} (weight ${b.weight}) — ${b.score}/100` + RESET)
    console.log(DIM + `  [${bar}]` + RESET)
    for (const sig of b.signals) {
      console.log(`    • ${sig}`)
    }
  }

  if (result.topReasons.length > 0) {
    console.log()
    console.log(BOLD + "  Top Reasons:" + RESET)
    result.topReasons.forEach(r => console.log(`    + ${r}`))
  }

  if (result.risks.length > 0) {
    console.log()
    console.log(BOLD + "  Risks:" + RESET)
    result.risks.forEach(r => console.log(`    ! ${r}`))
  }

  const res = result.research
  if (res) {
    console.log()
    console.log(BOLD + "  Research:" + RESET)
    if (res.sectorName) console.log(`    Sector: ${res.sectorName}`)
    if (res.analystConsensus) {
      const target = res.priceTarget ? ` — target $${res.priceTarget.toFixed(2)}` : ""
      const upside = res.priceTargetUpsidePct !== null ? ` (${res.priceTargetUpsidePct.toFixed(1)}% upside)` : ""
      console.log(`    Analyst consensus: ${res.analystConsensus}${target}${upside}`)
    }
    if (res.earningsDaysAway !== null) console.log(`    Next earnings: ${res.earningsDaysAway} days away`)
    if (res.insiderBuyCount > 0 || res.insiderSellCount > 0) {
      console.log(`    Insider activity (90d): ${res.insiderBuyCount} buys, ${res.insiderSellCount} sells — ${res.insiderNetSentiment}`)
    }
    if (res.recentUpgrades > 0 || res.recentDowngrades > 0) {
      console.log(`    Recent analyst actions: ${res.recentUpgrades} upgrades, ${res.recentDowngrades} downgrades`)
    }
    if (res.flags.length > 0) {
      console.log()
      console.log(BOLD + "  Flags:" + RESET)
      res.flags.forEach(f => console.log(`    ${f}`))
    }
    if (res.recentHeadlines.length > 0) {
      console.log()
      console.log(BOLD + "  Recent news:" + RESET)
      res.recentHeadlines.forEach(h => console.log(`    • ${h}`))
    }
  }
}

async function main(): Promise<void> {
  const { top, maxCandidates, minMarketCap, concurrency } = parseArgs()

  console.log(BOLD + `Stock Advisor — analyzing top ${maxCandidates} large-caps...` + RESET)

  const report = await runAdvisor({ maxCandidates, minMarketCap, concurrency })

  console.log()
  console.log(DIM + `Generated: ${report.generatedAt}  |  Candidates analyzed: ${report.candidates}  |  Results: ${report.results.length}` + RESET)

  printTable(report.results, top)

  console.log()
  console.log(BOLD + `\nDetailed breakdown (top ${Math.min(3, top)}):` + RESET)
  for (let i = 0; i < Math.min(3, top, report.results.length); i++) {
    const res = report.results[i]
    if (res) printBreakdown(res, i + 1)
  }

  console.log()
}

main().catch(err => {
  console.error("Fatal:", err)
  process.exit(1)
})
