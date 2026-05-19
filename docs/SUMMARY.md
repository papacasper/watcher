# Watcher Summary

Updated: 2026-05-06

Watcher is a self-hosted Bun + Elysia dividend-goal dashboard for Robinhood
stock holdings and dividend income. The dashboard centers forward projected
dividend income against the configured daily target; spending and crypto remain
secondary context only.

## Architecture

| Path | Purpose |
|------|---------|
| `bin/server.ts` | Elysia dashboard server, API routes, security headers, refresh/restart controls |
| `bin/dashboard.ts` | Terminal dividend dashboard report using the same data assembly path |
| `frontend/` | React single-page dashboard source |
| `src/dashboard/data.ts` | Robinhood/Nasdaq data assembly, source fallbacks, dividend projections, goal metrics |
| `src/dashboard/types.ts` | Shared dashboard API contract used by server and frontend |
| `src/dashboard/cache.ts` | Local dashboard cache at `~/.watcher/data.json` with restrictive permissions |
| `src/robinhood/` | Robinhood auth, account, spending, crypto reconciliation, stock, and pagination helpers |
| `src/announcements/` | Public dividend announcement clients |
| `src/config.ts` | Environment/config parsing and validation |
| `src/config-store.ts` | Local file-backed setup and settings store |
| `src/utils/http.ts` | Shared fetch timeout/retry wrapper |
| `bin/start.sh` | Local supervisor loop with lockfile and pidfile protection |
| `docs/watcher.service.example` | Example user-level systemd service |

## Dashboard

- Overview, Holdings, Calendar, Income, and Spending tabs.
- Stock holdings in the portfolio and allocation views, tagged by asset type.
- Forward projected annual income, forward projected daily income, dividend goal
  progress, daily/annual income gaps, and capital required at current forward
  yield.
- Per-position forward annual income, daily income, yield on cost, yield on
  value, and forward income share.
- Historical metrics for trailing 30-day dividend income, annualized trailing
  income, lifetime dividend return on cost, and target days covered.
- `summary.reconciliation` explicitly separates stock gross value, Robinhood
  stock net value, hidden crypto value, and the net adjustment used to match
  Robinhood's headline total.
- Dividend history and upcoming dividend sections include paid, reinvested,
  pending, announced, and projected entries.
- Spending data is cost-of-living context; it does not change dividend-goal
  math.
- Crypto value is reconciliation-only; crypto positions are excluded from
  holdings, allocation, and dividend income.
- Setup can be completed in the browser and saved to `~/.watcher/config.json`.
- Refresh, restart, and settings updates are POST-only state-changing actions requiring
  `X-Watcher-Action: 1`.
- Source-level refresh errors are surfaced without discarding stale usable cache
  data.

## Security Defaults

- Default bind host is `127.0.0.1`.
- Non-loopback binds require `DASHBOARD_PASSWORD` unless
  `ALLOW_UNAUTH_REMOTE=true` is explicitly set.
- Dashboard Basic auth protects `/`, `/bundle.js`, and `/api/*` when configured,
  except the first-run setup endpoints.
- HTML/API responses include conservative browser security headers.
- Robinhood token cache uses `0700` directory and `0600` file permissions.
- Dashboard data cache uses `0700` directory and `0600` file permissions.
- Local `.env` should be owner-only: `chmod 600 .env`.

## Commands

```bash
bun run build       # bundle frontend to dist/bundle.js
bun run test        # run Bun tests
bun run typecheck   # TypeScript check
bun run verify      # build + typecheck + tests
bun run build:binary # compile a local executable
bun run audit:deps  # dependency vulnerability audit
bun run server      # run dashboard server with .env
bun run dashboard   # terminal dividend dashboard report
```

## Cache And Freshness

The dashboard cache defaults to `~/.watcher/data.json`; Robinhood tokens default
to `~/.tokens`. `WATCHER_CACHE_DIR` and `RH_TOKEN_DIR` can override those
locations.

Positions and stock prices are critical. If either fails without a usable cache,
refresh fails. Dividends, orders, portfolio summary, spending, crypto
reconciliation, instrument names, and announced dividends are surfaced as fresh,
stale, or unavailable so the dashboard can keep showing usable context.

## Deployment Notes

Use `bin/start.sh` for a simple local supervisor, or install a systemd user
service based on `docs/watcher.service.example`. Do not run `bin/start.sh`
inside the systemd service because both layers would try to own restarts. For
Tailscale/LAN access, set `HOST` to the Tailscale IP and set
`DASHBOARD_PASSWORD`.
