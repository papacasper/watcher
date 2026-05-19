# Watcher Upgrade Plan — Friendly Single-User Self-Host

Updated: 2026-05-08

## Context

Today Watcher only runs for someone willing to clone the repo, install Bun, copy `.env.example`, fill in Robinhood + Alpaca API credentials, and `bun run server`. The goal of this upgrade is to make it usable for any Robinhood account holder — they should download a binary (or `bun install` the source), run it, open localhost in a browser, type their Robinhood username & password into a form, and have the dashboard work. No `.env`, no separate Alpaca account, no terminal editing.

Scope:
- **Single-user, easy self-host** — every user runs their own copy on their own machine. No accounts, no multi-tenant, creds stay local.
- **Drop Alpaca** — replace with a free, no-auth source for newly announced dividends.
- **Distribution** — keep `bun install` / `bun run server` working **and** ship `bun build --compile` binaries for macOS / Linux / Windows.

Out of scope: hosted/cloud version, multiple Robinhood accounts per process, OAuth alternatives to password login (Robinhood doesn't offer one).

---

## Phase 1 — File-backed config & first-run state

**Goal:** stop requiring a `.env`. Store user config at `~/.watcher/config.json` (chmod `0o600`), same dir as the existing data cache.

**New file:** `src/config-store.ts`
- `interface WatcherConfig { robinhood?: { username, password, mfaCode? }; dividendTargetDaily: number; dailyCost: number; server: { host, port, refreshMs, refreshTimeoutMs }; access: { user, password, allowUnauthRemote } }`
- `loadConfig(): WatcherConfig` — read `~/.watcher/config.json`, validate with a small manual schema check, fill defaults. If file missing, return defaults with `robinhood: undefined`.
- `saveConfig(partial: Partial<WatcherConfig>): WatcherConfig` — merge, write atomically (`writeFileSync` to `.tmp` then `renameSync`), chmod `0o600`. Returns merged value.
- Reuse `getCacheDir()` from `src/dashboard/cache.ts:4` for the directory — single source of truth.
- `isConfigured(): boolean` — true iff `robinhood.username && robinhood.password`.

**Modify:** `src/config.ts`
- Keep `loadServerConfig`, `loadRobinhoodCredentials`, `loadDailyCost`, `loadDividendTargetDaily`, `loadOptionalRobinhoodCredentials` as the public API.
- Each one delegates to `config-store` first, falls back to env vars (so an existing `.env` keeps working as override), then defaults. `deriveActionToken()` (already in `src/config.ts:111`) stays as-is — derived from the resolved password.
- Drop `loadAlpacaCredentials` (Phase 3 removes its sole caller).

**Migration on first start:** if `~/.watcher/config.json` doesn't exist but `RH_USERNAME` / `RH_PASSWORD` are present, write them into the config file once and continue. Print a one-line note. Existing users see no breakage.

---

## Phase 2 — Setup wizard + settings panel in the UI

**Goal:** browser-based credential entry, replacing the `.env` step.

**New endpoints in `bin/server.ts`:**
- `GET /api/setup` — returns `{ configured, needsApproval, approvalMessage }`. Public (no auth) so the wizard renders before a password is set.
- `POST /api/setup` — body `{ username, password, mfaCode?, dashboardPassword?, dividendTargetDaily?, dailyCost? }`. Writes config via `saveConfig`, then calls `auth.login(...)` and triggers `refresh()`. Streams milestone events through the existing `onAuthMilestone` plumbing (`src/dashboard/data.ts:50`). Allowed only while `isConfigured()` is false **or** the request comes from loopback. After success the new dashboard password (if any) gates further calls.
- `POST /api/settings` — authenticated + action-token gated. Same body shape, partial update. On Robinhood credential change, call `auth.logout()` (`src/robinhood/auth.ts:331`) so the next refresh re-authenticates.
- `POST /api/restart` already exists (`bin/server.ts:126`); reuse it for "apply server-config changes" (host/port).

**Re-load access config on save:** `ACCESS_CONFIG` is captured at module load in `bin/server.ts:21`. Wrap it in a `getAccessConfig()` accessor backed by a mutable holder updated by `/api/settings`. Routes call the accessor instead of the const. `assertSafeBind` still runs once at boot.

**Frontend:** `frontend/Setup.tsx` (new) and a settings drawer added to `frontend/App.tsx` / `frontend/panels.tsx`.
- `frontend/api.ts` gets `getSetup()`, `submitSetup(payload)`, `submitSettings(payload)`.
- `frontend/App.tsx` checks `getSetup()` on mount; if `!configured`, renders `<Setup />` instead of the dashboard. Setup component is a single form: Robinhood username, Robinhood password, optional MFA, optional "set a dashboard password" (recommended), optional daily target. Submit, poll `/api/status` for the existing `approval_needed` phase (already wired through `refreshState` in `src/server/refresh-state.ts`), show the "open Robinhood and approve" instruction when raised, then redirect to `/`.
- Settings drawer reuses the same form fields, prefilled (password fields blank, indicating "leave unchanged").

**Security notes:**
- `/api/setup` POST is unauthenticated only when `isConfigured()` is false. Once configured, it 403s — settings updates must go through the authenticated path.
- The same CSP / SRI / `X-Watcher-Action` posture from the audit fix carries over. The token meta tag (`bin/server.ts:172`) already exists.
- Passwords are never returned by GET endpoints; presence is conveyed as a boolean.

---

## Phase 3 — Replace Alpaca with a free dividend-announcement source

**Goal:** delete the Alpaca integration. The only place it's used is `getAnnouncedDividends` (`src/alpaca/dividends.ts:21`), called from `src/dashboard/data.ts:179`.

**New file:** `src/announcements/nasdaq.ts`
- Public API matches Alpaca's: `getAnnouncedDividends(symbols, since, until): Promise<AnnouncedDividend[]>`.
- Source: Nasdaq's public dividend calendar JSON at `https://api.nasdaq.com/api/calendar/dividends?date=YYYY-MM-DD` — one request per day in the window, parallelized with `Promise.all`, then filtered to the requested `symbols`. No auth header needed; a desktop User-Agent is required.
- Wrap in `fetchWithRetry` (already exists at `src/utils/http.ts`) with `retries: 1`. Failures bubble up but the caller already tolerates a rejected announcement fetch (`src/dashboard/data.ts:221`) — the dashboard simply falls back to Robinhood-pending dividends. **A Nasdaq outage degrades gracefully; it's not a hard dependency.**
- Cache results for 6h in-memory keyed by date so refresh cycles don't hammer the endpoint.

**Replace import:** `src/dashboard/data.ts:7` switches from `../alpaca/dividends.js` to `../announcements/nasdaq.js`. Same shape, same call site.

**Delete:** `src/alpaca/` directory, `loadAlpacaCredentials` in `src/config.ts:104`, the `ALPACA_API_KEY` / `ALPACA_API_SECRET` lines in `.env.example`, any docs mentions.

**Tests:** add `tests/nasdaq-dividends.test.ts` mocking `fetch` to verify date-range fan-out and symbol filtering. Existing dashboard tests continue using mocked announcements.

---

## Phase 4 — Compiled-binary distribution

**Goal:** `bun build --compile` produces a single executable per platform that bundles CSS, the React bundle, and server code.

**Asset embedding:** `bin/server.ts:135` and `:145` currently use `Bun.file("frontend/styles.css")` / `Bun.file("dist/bundle.js")`. The safer pattern for `--compile` is text imports:

```ts
import bundleJs from "../dist/bundle.js" with { type: "text" };
import stylesCss from "../frontend/styles.css" with { type: "text" };
```

Routes return `new Response(stylesCss, { headers: ... })`. Compile then snapshots both at build time.

**Build script changes** (`package.json`):
- `build:frontend` — already produces `dist/bundle.js`. Keep.
- `build:binary` — runs `build:frontend` first, then `bun build bin/server.ts --compile --minify --sourcemap --outfile dist/watcher`. Add `build:binary:linux`, `build:binary:mac`, `build:binary:windows` variants using `--target=bun-linux-x64` / `bun-darwin-arm64` / `bun-windows-x64`.
- `release` — runs all four, gzips the outputs into `dist/release/`.

**Runtime path concerns inside compiled binary:**
- `Bun.env.HOME` works in compiled mode → cache dir & config dir resolve correctly.
- Token cache (`src/robinhood/token-cache.ts`) writes to `~/.tokens/` — same.
- No code reads its own source files; nothing else to embed.

**Smoke test:** `scripts/smoke-binary.sh` builds `dist/watcher`, runs it with a temp `HOME`, curls `/api/setup`, kills it. Wired into `bun run verify` as an optional step (skipped on CI without compile time).

---

## Phase 5 — Documentation & release matrix

- **Rewrite `README.md`** for end users: "Download the binary for your OS → run it → open http://localhost:4242 → type your Robinhood credentials." A second section "Run from source" keeps the Bun install path. Remove all references to Alpaca and `.env` editing. Mention the in-app push approval and that creds live at `~/.watcher/config.json` (chmod 600) and never leave the machine.
- **Update `.env.example`** to a minimal optional file showing only host/port overrides. Mark every var as optional.
- **No GitHub release automation** in this plan — that's a separate piece of work. The release script just produces local artifacts.

---

## Files touched (summary)

**New:**
- `src/config-store.ts`
- `src/announcements/nasdaq.ts`
- `tests/nasdaq-dividends.test.ts`
- `frontend/Setup.tsx`
- `scripts/smoke-binary.sh`

**Modified:**
- `src/config.ts` — env vars become fallback, drop Alpaca loader
- `bin/server.ts` — `/api/setup`, `/api/settings`, mutable access config, text-import assets
- `src/dashboard/data.ts` — swap Alpaca import for Nasdaq
- `frontend/App.tsx` — setup gate + settings drawer hook
- `frontend/panels.tsx` — settings drawer panel
- `frontend/api.ts` — setup/settings clients
- `package.json` — build/compile scripts
- `README.md`, `.env.example`

**Deleted:**
- `src/alpaca/dividends.ts` (and the `src/alpaca/` directory if empty)

---

## Verification

```
bun run verify                      # build + typecheck + tests
bun run build:binary                # produces dist/watcher
HOME=$(mktemp -d) ./dist/watcher &
curl -s localhost:4242/api/setup    # → {"configured": false, ...}
```

Manual:
1. **Wizard happy path** — fresh `HOME`, browse to `http://localhost:4242/`, enter real Robinhood creds, observe push-approval prompt, approve in app, dashboard renders.
2. **Settings update** — change `dividendTargetDaily`, refresh, confirm `IncomeTab` numbers update.
3. **Robinhood-cred change** — re-enter password via settings, confirm `auth.logout()` triggers and the next refresh logs back in.
4. **Nasdaq outage** — block the endpoint with `/etc/hosts`, refresh: dashboard still loads with `announcedDividends` marked unavailable but stale-OK; no crash.
5. **Existing-`.env` migration** — populate `.env` with `RH_USERNAME`/`RH_PASSWORD`, no `~/.watcher/config.json`, run server: should print migration line, write the config file, and behave identically.
6. **Auth still gated** — with a `dashboardPassword` set, `curl localhost:4242/api/data` returns 401; with correct Basic Auth and a stale `X-Watcher-Action`, `/api/refresh` returns 403.
