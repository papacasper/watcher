/**
 * Robinhood smoke test — run with:
 *   RH_USERNAME=you@email.com RH_PASSWORD=secret bun bin/smoke-rh.ts
 *   RH_MFA=123456 bun bin/smoke-rh.ts   (if 2FA is enabled)
 */

import { auth } from "../src/robinhood/auth.js";
import { loadBasicProfile } from "../src/robinhood/profiles.js";
import { loadAccountProfile, getOpenStockPositions, getDividends } from "../src/robinhood/accounts.js";
import { getQuotes, getLatestPrice } from "../src/robinhood/stocks.js";
import { loadOptionalRobinhoodCredentials } from "../src/config.js";

const credentials = loadOptionalRobinhoodCredentials();

if (!credentials) {
  console.error("Set RH_USERNAME and RH_PASSWORD before running.");
  process.exit(1);
}

function ok(label: string, val: unknown) {
  console.log(`  ✓  ${label}:`, JSON.stringify(val, null, 2).slice(0, 300));
}

function fail(label: string, err: unknown) {
  console.error(`  ✗  ${label}:`, err instanceof Error ? err.message : err);
}

async function run() {
  console.log("\n── Login ──────────────────────────────────────");
  const token = await auth.login(credentials!).catch(async e => { throw e; });
  ok("access_token (truncated)", token.accessToken.slice(0, 20) + "…");
  ok("scope", token.scope);

  console.log("\n── Basic profile ──────────────────────────────");
  try { ok("basic_info", await loadBasicProfile()); }
  catch (e) { fail("basic_info", e); }

  console.log("\n── Account profile ────────────────────────────");
  try { ok("accounts", await loadAccountProfile()); }
  catch (e) { fail("accounts", e); }

  console.log("\n── Open positions ─────────────────────────────");
  try { ok("positions", await getOpenStockPositions()); }
  catch (e) { fail("positions", e); }

  console.log("\n── Dividends ──────────────────────────────────");
  try { ok("dividends", await getDividends()); }
  catch (e) { fail("dividends", e); }

  console.log("\n── Quotes (AAPL, MSFT) ────────────────────────");
  try { ok("quotes", await getQuotes(["AAPL", "MSFT"])); }
  catch (e) { fail("quotes", e); }

  console.log("\n── Latest price (AAPL) ────────────────────────");
  try { ok("price", await getLatestPrice("AAPL")); }
  catch (e) { fail("price", e); }

  console.log("\n── Done ────────────────────────────────────────\n");
}

run().catch(e => {
  console.error("Fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
