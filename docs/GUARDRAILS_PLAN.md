# Watcher Guardrails Plan

Updated: 2026-05-09

## Context

Watcher is a dividend-goal dashboard, not a financial adviser. The WSJ article
about using ChatGPT to manage a stock portfolio highlighted failure modes that
Watcher should explicitly avoid:

- plausible advice can still contain arithmetic or allocation mistakes;
- AI systems can drift from risk education into market timing;
- warnings weaken when the user keeps pushing for a risky trade;
- high-confidence language can obscure missing fiduciary accountability.

The goal of this plan is to add deterministic portfolio guardrails that surface
risk and math issues without telling the user what to buy or sell.

Out of scope:

- AI-generated trade recommendations;
- automated rebalancing;
- options, hedging, or leveraged ETF strategy suggestions;
- fiduciary language or anything that implies Watcher is managing money.

## Phase 1 - Guardrail Data Model

**Goal:** add a typed guardrail result to the dashboard API.

New or modified files:

- `src/dashboard/guardrails.ts`
- `src/dashboard/types.ts`
- `src/dashboard/data.ts`
- `tests/dashboard-guardrails.test.ts`

Proposed types:

```ts
export type GuardrailSeverity = "info" | "warning" | "danger";

export interface PortfolioGuardrail {
  id: string;
  severity: GuardrailSeverity;
  title: string;
  detail: string;
  metric?: number;
  threshold?: number;
  symbols?: string[];
}
```

Add `guardrails: PortfolioGuardrail[]` to `DashboardData`.

Implementation notes:

- Keep guardrails deterministic and based only on data Watcher already has.
- Generate guardrails after holdings, income projections, allocation, and
  reconciliation are complete.
- Never include buy/sell language in guardrail text.
- Prefer stable IDs so frontend tests and future dismissals can key on them.

## Phase 2 - Math And Data Integrity Checks

**Goal:** catch the exact class of mistakes the article warned about before any
risk interpretation appears.

Checks:

- `allocation-total-mismatch`: holding values by type do not reconcile to gross
  stock value within a small tolerance.
- `income-share-mismatch`: per-position forward income shares do not sum to
  approximately 100% when projected income is positive.
- `net-reconciliation-large`: Robinhood net liquidation value differs from
  visible stock gross value by more than the documented crypto/cash adjustment.
- `stale-income-source`: dividend or announcement sources are stale while
  projected income is still shown.
- `missing-price-or-cost`: a visible holding has zero or invalid price, value,
  shares, or cost basis.

Severity guidance:

- `danger`: math is inconsistent enough that dashboard numbers may be wrong.
- `warning`: data is usable but should be treated cautiously.
- `info`: context-only note where no action is implied.

Tests:

- malformed holding values produce a danger guardrail;
- normal fixture data produces no math-integrity guardrails;
- stale dividend source produces a warning without failing dashboard assembly.

## Phase 3 - Concentration And Income Quality Checks

**Goal:** identify portfolio structure risks without implying a target
allocation.

Checks:

- `position-concentration`: a single visible stock/ETF is above a configurable
  share of gross stock value. Initial default: `25%`.
- `type-concentration`: one asset type is above a configurable share of gross
  stock value. Initial default: `70%`.
- `income-concentration`: one holding contributes too much projected annual
  dividend income. Initial default: `30%`.
- `high-forward-yield`: a holding has unusually high forward yield on value.
  Initial default: `12%`.
- `negative-return-high-income`: a holding has a negative unrealized return but
  contributes meaningful forward income, which can signal yield-chasing risk.

Configuration:

- Add optional environment/config values only after the default behavior is
  proven useful.
- Suggested future names:
  - `GUARDRAIL_MAX_POSITION_PCT`
  - `GUARDRAIL_MAX_TYPE_PCT`
  - `GUARDRAIL_MAX_INCOME_SHARE_PCT`
  - `GUARDRAIL_HIGH_YIELD_PCT`

Copy rules:

- Use neutral text such as "contributes 34% of projected income."
- Avoid directive text such as "reduce," "sell," "buy," or "hedge."

## Phase 4 - Risky Product Flags

**Goal:** warn when a holding type is commonly misunderstood or can behave
badly in a long-term dividend portfolio.

Checks:

- `leveraged-fund`: symbol or name suggests a leveraged ETF/ETN.
- `inverse-fund`: symbol or name suggests inverse exposure.
- `covered-call-income-fund`: symbol or metadata marks a covered-call income
  ETF.
- `single-stock-fund`: symbol or name suggests single-stock ETF exposure.
- `options-income-risk`: metadata marks options-driven distribution income.

Implementation notes:

- Start with a small metadata map in `frontend/components.tsx` or move metadata
  to a shared backend file if the backend needs it.
- Prefer explicit symbol metadata over fragile name matching.
- If name matching is used, keep it conservative and covered by tests.

Suggested display text:

> This holding may use leverage, inverse exposure, or options-linked income.
> Watcher is flagging the product structure, not recommending a trade.

## Phase 5 - Dashboard UI

**Goal:** make guardrails visible but not alarmist.

Frontend files:

- `frontend/App.tsx`
- `frontend/panels.tsx`
- `frontend/types.ts`
- `frontend/styles.css`

UI placement:

- Add a `Guardrails` card near the top of the Overview tab, after the stats
  strip and before allocation.
- Show highest severity first.
- Collapse `info` items when warnings or dangers exist.
- Empty state: "No guardrail issues detected from current data."

Visual language:

- `danger`: math/data integrity issue.
- `warning`: risk or concentration issue.
- `info`: context note.

Do not add:

- AI chat;
- trade buttons;
- target allocation sliders;
- "recommended action" copy.

## Phase 6 - Optional AI Summary Boundary

**Goal:** if an AI summary is ever added later, constrain it to explain
existing deterministic guardrails.

Rules:

- The model receives only already-computed guardrails and dashboard summary
  values.
- The model must not create new trade recommendations.
- The model output is labeled as an explanation, not advice.
- The raw deterministic guardrails remain visible even if the AI summary fails.
- The system prompt must forbid market timing, options strategies, leverage
  suggestions, and buy/sell language.

This phase should not start until Phases 1-5 are complete and useful without
AI.

## Verification

Run:

```bash
bun run typecheck
bun run test
bun run build
```

Manual checks:

1. Normal portfolio data renders no severe guardrails.
2. A fixture with one holding above 25% of stock value renders a concentration
   warning.
3. A fixture with one holding above 30% of projected income renders an income
   concentration warning.
4. A fixture with allocation totals that do not reconcile renders a danger
   guardrail.
5. Stale dividend source data renders a warning but the dashboard still loads.
6. Guardrail text contains no buy, sell, rebalance, hedge, options strategy, or
   market-timing recommendation.

## Implementation Order

1. Add shared guardrail types and tests.
2. Implement math/data integrity checks.
3. Add concentration and income quality checks.
4. Add frontend rendering.
5. Add risky product metadata and flags.
6. Revisit configuration after using the defaults with real portfolio data.

