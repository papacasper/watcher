/**
 * index.ts
 * Robinhood API - mirrors robin_stocks top-level exports
 * Read-only access only - no order placement
 */

import { auth } from "./auth.js";
export { RobinhoodAuth, auth } from "./auth.js";

export {
  loadAccountProfile,
  loadPortfolioProfile,
  getDividends,
  getTotalDividends,
  getOpenStockPositions,
  getAllPositions,
  getAccountInfo,
  getPortfolioSummary
} from "./accounts.js";

export {
  loadBasicProfile,
  loadUserProfile,
  loadInvestmentProfile,
  loadSecurityProfile,
  buildUserProfile
} from "./profiles.js";

export {
  getLatestPrice,
  getLatestPriceMap,
  getQuotes,
  getQuoteBySymbol,
  getStockHistoricals,
  getFundamentals,
  getNews,
  getRatings
} from "./stocks.js";

export {
  getOpenCryptoHoldings,
  getCryptoPriceMap
} from "./crypto.js";

import * as accounts from "./accounts.js";
import * as profiles from "./profiles.js";
import * as stocks from "./stocks.js";
import * as crypto from "./crypto.js";

// Named export for the module as a whole (mirrors robin_stocks.robinhood)
export const robinhood = {
  account: accounts,
  profiles,
  stocks,
  crypto
};

export default {
  auth,
  account: accounts,
  profiles,
  stocks,
  crypto
};
