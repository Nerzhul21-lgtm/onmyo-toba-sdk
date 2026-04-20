/**
 * Onmyō Toba SDK
 * Official SDK for building AI bots and agents on Onmyō Toba prediction markets
 *
 * @example
 * import { getOpenMarkets, bet, watchNewMarkets } from 'onmyo-toba-sdk'
 *
 * // Get all BTC price markets
 * const markets = await getOpenMarkets({ type: 'price', asset: 'BTC' })
 *
 * // Place a bet
 * const txHash = await bet(marketId, 'yes', 10, process.env.MNEMONIC)
 *
 * // Stream new markets in real-time
 * const stop = watchNewMarkets({ type: 'price', asset: 'BTC' }, (market) => {
 *   console.log('New BTC market:', market.question)
 * })
 */

// ── Config ────────────────────────────────────────────────────────────────────
export { getNetwork, toUSDTBase, fromUSDTBase, fromINJBase, NETWORKS } from './config.js'

// ── Meta ──────────────────────────────────────────────────────────────────────
export { parseMeta, parseDescription, buildMeta, buildDescription, filterByMeta, MARKET_TYPES } from './meta.js'

// ── Query (read-only) ─────────────────────────────────────────────────────────
export {
  getOpenMarkets,
  getAllMarkets,
  getMarket,
  getMarketOdds,
  getMarketStats,
  getMarketMeta,
  getPosition,
  getUserPositions,
  getUserStats,
  getWalletBalance,
  getContractConfig,
  getSpiritVaultBalance,
} from './query.js'

// ── Execute (requires mnemonic) ───────────────────────────────────────────────
export {
  bet,
  claimWinnings,
  createMarket,
  batchClaimWinnings,
  getAddressFromMnemonic,
} from './execute.js'

// ── AuthZ (delegated execution) ───────────────────────────────────────────────
export {
  grantAuthZ,
  revokeAuthZ,
  betAsGrantee,
  claimAsGrantee,
  checkAuthZGrant,
} from './authz.js'

// ── Streaming (real-time WebSocket) ───────────────────────────────────────────
export {
  watchAll,
  watchNewMarkets,
  watchMarket,
  watchResolutions,
  getOddsHistory,
  initOddsHistory,
  stopAllWatchers,
} from './stream.js'

// ── History (Indexer API) ─────────────────────────────────────────────────────
export {
  getContractTransactions,
  getMarketBetHistory,
  getUserBetHistory,
  getOddsTimeline,
} from './history.js'
