/**
 * Onmyō Toba SDK — Query Functions (read-only, no wallet needed)
 */

import axios from 'axios'
import { getNetwork, fromUSDTBase, fromINJBase } from './config.js'
import { parseMeta, parseDescription, filterByMeta } from './meta.js'

/** Encode a query object to base64 for CosmWasm REST queries */
function encodeQuery(query) {
  return Buffer.from(JSON.stringify(query)).toString('base64')
}

/** Parse a market response from the contract into a clean object */
function parseMarket(m) {
  const market = m.market || m
  const meta = parseMeta(market.description)
  return {
    id: market.id,
    question: market.question,
    description: parseDescription(market.description),
    category: market.category,
    bySpirit: market.by_spirit || false,
    creator: market.creator,
    yesAmount: fromUSDTBase(market.yes_amount || 0),
    noAmount: fromUSDTBase(market.no_amount || 0),
    totalVolume: fromUSDTBase((market.yes_amount || 0) + (market.no_amount || 0)),
    yesPrice: m.yes_price || 500000,
    noPrice: m.no_price || 500000,
    yesOdds: parseFloat(((m.yes_price || 500000) / 1_000_000).toFixed(4)),
    noOdds: parseFloat(((m.no_price || 500000) / 1_000_000).toFixed(4)),
    endTime: market.end_time,
    endsAt: new Date(market.end_time * 1000).toISOString(),
    endsInSeconds: Math.max(0, market.end_time - Math.floor(Date.now() / 1000)),
    resolved: market.resolved,
    outcome: market.outcome,
    proposedOutcome: market.proposed_outcome,
    proposedAt: market.proposed_at,
    proposedBy: market.proposed_by,
    resolutionSource: market.resolution_source,
    createdAt: market.created_at,
    feeRefunded: market.fee_refunded,
    meta,
    raw: market,
  }
}

/**
 * Query a CosmWasm contract via REST
 */
async function queryContract(restEndpoint, contractAddress, query) {
  const queryB64 = encodeQuery(query)
  const url = `${restEndpoint}/cosmwasm/wasm/v1/contract/${contractAddress}/smart/${queryB64}`
  const res = await axios.get(url, { timeout: 15000 })
  return res.data.data
}

// ── Market Queries ────────────────────────────────────────────────────────────

/**
 * Get all open (unresolved) markets, optionally filtered
 * @param {object} filters - { category?, type?, asset?, sport?, direction? }
 * @param {object} opts - { network?, limit?, startAfter? }
 */
export async function getOpenMarkets(filters = {}, opts = {}) {
  const { network = 'testnet', limit = 50, startAfter } = opts
  const cfg = getNetwork(network)

  const query = {
    markets: {
      resolved: false,
      limit,
      ...(filters.category && filters.category !== 'All' ? { category: filters.category } : {}),
      ...(startAfter ? { start_after: startAfter } : {}),
    }
  }

  const data = await queryContract(cfg.rest, cfg.contracts.marketManager, query)
  const markets = (data.markets || []).map(parseMarket)

  // Apply meta filters (type, asset, sport, etc.)
  const { category, ...metaFilters } = filters
  return filterByMeta(markets, metaFilters)
}

/**
 * Get all markets (open and resolved)
 * @param {object} opts - { network?, resolved?, limit?, category? }
 */
export async function getAllMarkets(opts = {}) {
  const { network = 'testnet', resolved, limit = 50, category } = opts
  const cfg = getNetwork(network)

  const query = {
    markets: {
      limit,
      ...(resolved !== undefined ? { resolved } : {}),
      ...(category && category !== 'All' ? { category } : {}),
    }
  }

  const data = await queryContract(cfg.rest, cfg.contracts.marketManager, query)
  return (data.markets || []).map(parseMarket)
}

/**
 * Get a single market by ID
 * @param {number} id - market ID
 * @param {object} opts - { network? }
 */
export async function getMarket(id, opts = {}) {
  const { network = 'testnet' } = opts
  const cfg = getNetwork(network)

  const data = await queryContract(cfg.rest, cfg.contracts.marketManager, { market: { id } })
  return parseMarket(data)
}

/**
 * Get current odds for a market
 * @param {number} id - market ID
 * @param {object} opts - { network? }
 * @returns {{ yes: number, no: number, yesPrice: number, noPrice: number, totalVolume: number }}
 */
export async function getMarketOdds(id, opts = {}) {
  const market = await getMarket(id, opts)
  return {
    yes: market.yesOdds,
    no: market.noOdds,
    yesPrice: market.yesPrice,
    noPrice: market.noPrice,
    totalVolume: market.totalVolume,
    endsInSeconds: market.endsInSeconds,
  }
}

/**
 * Get market stats (volume, yes%, liquidity)
 * @param {number} id - market ID
 * @param {object} opts - { network? }
 */
export async function getMarketStats(id, opts = {}) {
  const { network = 'testnet' } = opts
  const cfg = getNetwork(network)

  const data = await queryContract(cfg.rest, cfg.contracts.marketManager, { market_stats: { id } })
  return {
    totalVolume: fromUSDTBase(data.total_volume || 0),
    yesPct: data.yes_pct || 50,
    noPct: data.no_pct || 50,
    liquidity: fromUSDTBase(data.liquidity || 0),
  }
}

/**
 * Get parsed __meta__ for a market
 * @param {number} id - market ID
 * @param {object} opts - { network? }
 */
export async function getMarketMeta(id, opts = {}) {
  const market = await getMarket(id, opts)
  return market.meta
}

// ── Position Queries ──────────────────────────────────────────────────────────

/**
 * Get a specific position
 * @param {number} marketId
 * @param {string} address - injective wallet address
 * @param {object} opts - { network? }
 */
export async function getPosition(marketId, address, opts = {}) {
  const { network = 'testnet' } = opts
  const cfg = getNetwork(network)

  const data = await queryContract(cfg.rest, cfg.contracts.marketManager, {
    position: { market_id: marketId, trader: address }
  })

  if (!data.position) return null

  const pos = data.position
  const claimable = fromUSDTBase(data.claimable || 0)
  return {
    marketId: pos.market_id,
    trader: pos.trader,
    yesShares: fromUSDTBase(pos.yes_shares || 0),
    noShares: fromUSDTBase(pos.no_shares || 0),
    side: pos.yes_shares > pos.no_shares ? 'yes' : 'no',
    claimed: pos.claimed,
    claimable,
  }
}

/**
 * Get all positions for a wallet
 * @param {string} address - injective wallet address
 * @param {object} opts - { network?, limit? }
 */
export async function getUserPositions(address, opts = {}) {
  const { network = 'testnet', limit = 50 } = opts
  const cfg = getNetwork(network)

  const data = await queryContract(cfg.rest, cfg.contracts.marketManager, {
    user_positions: { trader: address, limit }
  })

  return (data.positions || []).map(pos => ({
    marketId: pos.market_id,
    trader: pos.trader,
    yesShares: fromUSDTBase(pos.yes_shares || 0),
    noShares: fromUSDTBase(pos.no_shares || 0),
    side: pos.yes_shares > pos.no_shares ? 'yes' : 'no',
    claimed: pos.claimed,
  }))
}

// ── User Stats ────────────────────────────────────────────────────────────────

const RANK_NAMES = ["In'yōsei", 'Jujutsushi', 'Shikigami-tsukai', 'Onmyōji', 'Dai-Onmyōji', 'Kimon-shi', 'Rei-ō']

/**
 * Get user stats (prestige, rank, predictions)
 * @param {string} address - injective wallet address
 * @param {object} opts - { network? }
 */
export async function getUserStats(address, opts = {}) {
  const { network = 'testnet' } = opts
  const cfg = getNetwork(network)

  const data = await queryContract(cfg.rest, cfg.contracts.userProgression, {
    user_stats: { address }
  })

  const stats = data.stats || {}
  return {
    address,
    prestige: parseInt(stats.prestige || 0),
    weeklyPrestige: parseInt(stats.weekly_prestige || 0),
    rank: stats.rank || 0,
    rankName: RANK_NAMES[stats.rank || 0] || "In'yōsei",
    lifetimeVolume: fromUSDTBase(stats.lifetime_volume || 0),
    totalPredictions: parseInt(stats.total_predictions || 0),
    correctPredictions: parseInt(stats.correct_predictions || 0),
    winRate: stats.total_predictions > 0
      ? parseFloat((stats.correct_predictions / stats.total_predictions * 100).toFixed(1))
      : 0,
    dailyStreak: parseInt(stats.daily_streak || 0),
    referrals: parseInt(stats.referrals || 0),
    talismanClaimed: stats.talisman_claimed || false,
    joinedAt: stats.joined_at ? new Date(stats.joined_at * 1000).toISOString() : null,
  }
}

// ── Wallet Balance ────────────────────────────────────────────────────────────

/**
 * Get wallet USDT and INJ balances
 * @param {string} address - injective wallet address
 * @param {object} opts - { network? }
 */
export async function getWalletBalance(address, opts = {}) {
  const { network = 'testnet' } = opts
  const cfg = getNetwork(network)

  const url = `${cfg.rest}/cosmos/bank/v1beta1/balances/${address}`
  const res = await axios.get(url, { timeout: 10000 })
  const balances = res.data.balances || []

  const usdtEntry = balances.find(b => b.denom === cfg.usdtDenom)
  const injEntry = balances.find(b => b.denom === 'inj')

  return {
    usdt: fromUSDTBase(usdtEntry?.amount || 0),
    usdtRaw: usdtEntry?.amount || '0',
    inj: fromINJBase(injEntry?.amount || 0),
    injRaw: injEntry?.amount || '0',
    address,
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

/**
 * Get market manager contract config
 * @param {object} opts - { network? }
 */
export async function getContractConfig(opts = {}) {
  const { network = 'testnet' } = opts
  const cfg = getNetwork(network)

  const data = await queryContract(cfg.rest, cfg.contracts.marketManager, { config: {} })
  return {
    owner: data.owner,
    spiritBot: data.spirit_bot,
    usdtDenom: data.usdt_denom,
    creationFee: fromUSDTBase(data.creation_fee || 5_000_000),
    tradeFeeBps: data.trade_fee_bps,
    marketCount: data.market_count,
    disputeWindowSecs: data.dispute_window_secs,
  }
}

// ── Spirit Vault ──────────────────────────────────────────────────────────────

/**
 * Get Spirit Vault USDT balance
 * @param {object} opts - { network? }
 */
export async function getSpiritVaultBalance(opts = {}) {
  const { network = 'testnet' } = opts
  const cfg = getNetwork(network)
  const balance = await getWalletBalance(cfg.spiritVault, opts)
  return balance.usdt
}
