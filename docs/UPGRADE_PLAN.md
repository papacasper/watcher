# Watcher Upgrade Plan

Updated: 2026-04-27

This document records the post-audit upgrade pass. The project now has the security boundary,
cache hardening, runtime resilience, financial metric cleanup, operations scripts, and current
docs that were recommended by the audit.

## Phase 1 - Correctness

Status: implemented.

- Quote results are mapped by symbol before portfolio valuation, preventing reordered or missing
  Robinhood quote responses from attaching prices to the wrong holding.
- Dashboard summary metrics now distinguish:
  - `trailing30dIncome`
  - `annualizedTrailingIncome`
  - `forwardProjectedAnnualIncome`
  - `annualYieldOnCost`
  - `lifetimeDividendYieldOnCost`
- Frontend labels use those explicit server-provided semantics.
- Tests cover reordered/missing quote results and the separated income metrics.

## Phase 2 - Security

Status: implemented.

- Dashboard cache directory is `0700`; cache file is `0600`.
- Local `.env` has been tightened to `0600`.
- Server responses include CSP, referrer policy, nosniff, permissions policy, and no-store API
  cache headers.
- Access-denied responses include basic hardening headers.
- Tests cover dashboard cache permissions.

## Phase 3 - Runtime Resilience

Status: implemented.

- `src/config.ts` validates env vars and gives clear errors for missing or malformed config.
- `src/utils/http.ts` provides timeout and retry behavior for upstream HTTP requests.
- Robinhood account/profile/quote helpers, pagination, Alpaca clients, Stooq DXY, and instrument
  name lookups use the shared HTTP wrapper.
- Dashboard refreshes record source-level errors and can keep serving stale usable cache data when
  non-critical sources fail.
- Tests cover config parsing and HTTP retry/error behavior.

## Phase 4 - Operations

Status: implemented.

- Added package scripts: `test`, `typecheck`, `verify`, and `audit:deps`.
- Moved TypeScript into `devDependencies`.
- Hardened `bin/start.sh` with `set -euo pipefail`, a lockfile, pidfile checks, and deterministic
  project-root resolution.
- Added `docs/watcher.service.example` for a systemd user-service deployment.

## Phase 5 - Documentation

Status: implemented.

- `docs/SUMMARY.md` now describes the extracted React frontend, current server, commands, cache
  locations, security defaults, and deployment notes.
- This plan now reflects the completed audit-driven upgrade pass rather than the older migration
  plan.

## Verification

Run before deploying changes:

```bash
bun run verify
bun run audit:deps
```

Current local checks pass for tests, typecheck, build, and dependency audit.

## Follow-up - Crypto Reconciliation

Status: implemented after the audit pass.

- Added Robinhood crypto holdings via `nummus.robinhood.com/holdings/`.
- Added crypto prices via Robinhood forex quote symbols such as `BTCUSD` and `ETHUSD`.
- Crypto value is used only for net account reconciliation so the dashboard headline can match
  Robinhood's account total.
- Crypto positions are not shown in dashboard holdings or allocation.
- Dividend income still comes only from stock dividend records.

## Follow-up - Reliability Hardening

Status: implemented after the second audit pass.

- Added a shared dashboard API type module used by both backend and frontend.
- Added explicit `summary.reconciliation` fields for stock gross value, Robinhood stock net value,
  hidden crypto value, and net adjustment.
- Dashboard refreshes now classify source status as fresh, stale, or unavailable, and use stale
  cache slices where practical.
- Robinhood auth requests use the shared timeout/retry wrapper, and dashboard refreshes have an
  overall timeout.
- Upstream numeric parsing now defaults malformed values and records source warnings instead of
  allowing `NaN` into totals.
- The systemd example now lets systemd own restarts directly; `bin/start.sh` remains the local
  supervisor.
- Frontend formatting, API helpers, components, shared types, and CSS have been split out of the
  main app/server files.
