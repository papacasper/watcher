# Watcher Summary

Updated: 2026-04-27

Watcher is a self-hosted Bun + Elysia portfolio dashboard for Robinhood stock holdings,
dividend income, spending data, and lightweight market alerts. The headline net account value
can include Robinhood account-level adjustments, while visible holdings stay focused on stocks.

## Architecture

| Path | Purpose |
|------|---------|
| `bin/server.ts` | Elysia dashboard server, API routes, security headers, refresh/restart controls |
| `frontend/` | React single-page dashboard source |
| `src/dashboard/data.ts` | Robinhood/Alpaca data assembly, source fallbacks, dividend projections, summary metrics |
| `src/dashboard/types.ts` | Shared dashboard API contract used by server and frontend |
| `src/dashboard/cache.ts` | Local dashboard cache at `~/.watcher/data.json` with restrictive permissions |
| `src/robinhood/` | Robinhood auth, account, profile, stock, and pagination helpers |
| `src/robinhood/crypto.ts` | Robinhood crypto value helper used for net account reconciliation |
| `src/alpaca/` | Alpaca quote, bar, historical, and dividend announcement clients |
| `src/config.ts` | Environment parsing and validation |
| `src/utils/http.ts` | Shared fetch timeout/retry wrapper |
| `bin/start.sh` | Local supervisor loop with lockfile and pidfile protection |
| `docs/watcher.service.example` | Example user-level systemd service |

## Dashboard

- Overview, Holdings, Calendar, Income, and Spending tabs.
- Stock holdings in the portfolio and allocation views, tagged by asset type.
- Portfolio value, total return, trailing 30-day dividend income, days of freedom, annualized
  trailing yield on cost, forward projected annual income, and lifetime dividend return on cost.
- `summary.reconciliation` explicitly separates stock gross value, Robinhood stock net value,
  hidden crypto value, and the net adjustment used to match Robinhood's headline total.
- Dividend history and upcoming dividend sections include paid, reinvested, pending, announced,
  and projected entries.
- Refresh and restart are POST-only state-changing actions requiring `X-Watcher-Action: 1`.
- Source-level refresh errors are surfaced without discarding stale usable cache data.

## Security Defaults

- Default bind host is `127.0.0.1`.
- Non-loopback binds require `DASHBOARD_PASSWORD` unless `ALLOW_UNAUTH_REMOTE=true` is explicitly
  set.
- Dashboard Basic auth protects `/`, `/bundle.js`, and `/api/*` when configured.
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
bun run audit:deps  # dependency vulnerability audit
bun run server      # run dashboard server with .env
bun run watch       # run DXY/ticker alert monitor
bun run audit       # one-off income audit report
bun run dashboard   # terminal dashboard report
```

## Deployment Notes

Use `bin/start.sh` for a simple local supervisor, or install a systemd user service based on
`docs/watcher.service.example`. Do not run `bin/start.sh` inside the systemd service because both
layers would try to own restarts. For Tailscale/LAN access, set `HOST` to the Tailscale IP and set
`DASHBOARD_PASSWORD`.
