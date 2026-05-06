# Watcher

Watcher is a self-hosted Bun + Elysia portfolio dashboard for Robinhood holdings,
dividend income, spending data, lightweight market alerts, and account-value
reconciliation. The web UI is a React single-page app served by the Bun server.

The dashboard can include Robinhood account-level adjustments and hidden crypto
value in the headline net account value while keeping the visible holdings table
focused on stock positions.

## Features

- Portfolio overview with gross holdings value, net liquidation value, cash,
  profit/loss, total return, and allocation.
- Dividend calendar with paid, reinvested, pending, announced, and projected
  entries.
- Income metrics for trailing 30-day income, annualized trailing income,
  forward projected annual income, yield on cost, and days of freedom.
- Spending summary from Robinhood spending account data when available.
- Robinhood crypto reconciliation without showing crypto positions in the
  holdings table.
- Source status reporting for fresh, stale, and unavailable upstream data.
- Stale cache fallback when non-critical sources fail.
- Basic auth, conservative security headers, and hardened local cache
  permissions.

## Requirements

- Bun
- Robinhood credentials
- Alpaca API credentials

Copy the example environment file and fill in your local values:

```bash
cp .env.example .env
chmod 600 .env
```

Important settings:

- `RH_USERNAME` and `RH_PASSWORD`: Robinhood login.
- `ALPACA_API_KEY` and `ALPACA_API_SECRET`: Alpaca market data credentials.
- `DAILY_COST`: daily spending baseline used for income metrics.
- `HOST` and `PORT`: dashboard bind address.
- `DASHBOARD_PASSWORD`: required when binding to a non-loopback address unless
  `ALLOW_UNAUTH_REMOTE=true` is explicitly set.

## Commands

```bash
bun install
bun run build
bun run test
bun run typecheck
bun run verify
bun run audit:deps
bun run server
bun run dashboard
bun run audit
bun run watch
```

## Deployment

An example systemd user service is available at
`docs/watcher.service.example`. It lets systemd run the Bun server directly and
own restart behavior.

For Tailscale or LAN access, bind `HOST` to the Tailscale/LAN IP and set
`DASHBOARD_PASSWORD`.

## Security Notes

- Do not commit `.env`.
- The server defaults to `127.0.0.1`.
- Non-loopback binds require authentication by default.
- Dashboard and Robinhood token caches are written with restrictive
  permissions.
- State-changing dashboard actions require POST plus the watcher action header.

## Documentation

- `docs/SUMMARY.md`: current architecture and operating notes.
- `docs/UPGRADE_PLAN.md`: completed audit and hardening history.
- `docs/watcher.service.example`: systemd user service template.
