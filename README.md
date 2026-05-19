# Watcher

Watcher is a self-hosted Robinhood dividend-goal dashboard. It runs on your
machine, stores credentials locally, and shows how close the portfolio is to a
daily dividend income target.

## Download And Run

Download the binary for your OS, run it, then open:

```text
http://localhost:4242
```

The first screen asks for your Robinhood username and password, an optional MFA
code, an optional dashboard password, and dividend goal settings. If Robinhood
requires push approval, Watcher shows that state while you approve the sign-in
in the Robinhood app.

Credentials are stored only on the machine running Watcher at
`~/.watcher/config.json` with `0600` file permissions. Robinhood session tokens
are stored under `~/.tokens` by default.

## Run From Source

```bash
bun install
bun run server
```

Then open `http://localhost:4242` and complete setup in the browser.

An `.env` file is no longer required. You can still copy `.env.example` for
optional host, port, refresh, cache, or legacy credential overrides.

## Features

- Forward projected annual and daily dividend income.
- Daily dividend target progress, income gap, and required capital estimate.
- Portfolio value, allocation, total return, cash adjustment, and reconciliation.
- Dividend calendar with paid, reinvested, pending, announced, and projected
  entries.
- Robinhood spending context when available.
- Crypto value reconciliation without treating crypto as dividend holdings.
- Deterministic portfolio guardrails for data integrity, concentration, high
  yield, and complex product flags.
- Source freshness reporting and stale-cache fallback for non-critical sources.

## Commands

```bash
bun run build              # bundle frontend to dist/bundle.js
bun run test               # run Bun tests
bun run typecheck          # TypeScript check
bun run verify             # build + typecheck + tests
bun run verify:binary      # compile binary and smoke-test /api/setup
bun run build:binary       # compile local dist/watcher binary
bun run release            # build local release artifacts
bun run server             # run dashboard server
bun run dashboard          # terminal dividend dashboard report
```

## Deployment

An example systemd user service is available at
`docs/watcher.service.example`.

For Tailscale or LAN access, bind `HOST` to the Tailscale/LAN IP and set a
dashboard password in setup or `.env`. Non-loopback binds without a password are
rejected unless `ALLOW_UNAUTH_REMOTE=true` is explicitly set.

## Security Notes

- Watcher is single-user software; run one copy per Robinhood account.
- Robinhood credentials stay local in `~/.watcher/config.json`.
- Dashboard and token caches are written with restrictive permissions.
- State-changing dashboard actions require POST plus the watcher action header.
- Watcher surfaces deterministic guardrails, but it does not recommend trades or
  manage money.
