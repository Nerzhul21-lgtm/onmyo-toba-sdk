/**
 * Onmyō Toba SDK — Historical Data
 *
 * Queries the Injective Indexer for historical transaction data
 * related to our prediction markets. Used to reconstruct odds history
 * and analyze market movements over time.
 */

import axios from 'axios'
import { getNetwork, fromUSDTBase } from './config.js'

/**
 * Get historical transactions for the market manager contract
 * using Injective's Indexer REST API
 *
 * @param {object} opts - { network?, limit?, from?, to? }
 * @returns {Promise<Array>} list of transaction summaries
 */
export async function getContractTransactions(opts = {}) {
  const { network = 'testnet', limit = 50, from, to } = opts
  const cfg = getNetwork(network)

  try {
    let url = `${cfg.indexer}/api/explorer/v1/contracts/${cfg.contracts.marketManager}/txs?limit=${limit}`
    if (from) url += `&from=${from}`
    if (to) url += `&to=${to}`

    const res = await axios.get(url, { timeout: 15000 })
    return res.data.data || res.data.txs || []
  } catch (e) {
    console.error(`[Onmyo SDK] History query failed: ${e.message}`)
    return []
  }
}

/**
 * Get historical bets for a specific market
 * Parses wasm events from transaction history
 *
 * @param {number} marketId
 * @param {object} opts - { network?, limit? }
 * @returns {Promise<Array<{trader, side, amount, timestamp, txHash}>>}
 */
export async function getMarketBetHistory(marketId, opts = {}) {
  const { network = 'testnet', limit = 100 } = opts
  const cfg = getNetwork(network)

  try {
    const url = `${cfg.indexer}/api/explorer/v1/contracts/${cfg.contracts.marketManager}/txs?limit=${limit}`
    const res = await axios.get(url, { timeout: 15000 })
    const txs = res.data.data || res.data.txs || []

    const bets = []

    for (const tx of txs) {
      try {
        // Look for buy_shares actions in the tx events
        const messages = tx.messages || []
        for (const msg of messages) {
          if (msg.type !== 'MsgExecuteContract') continue
          const value = msg.value || {}
          if (!value.msg?.buy_shares) continue
          if (value.msg.buy_shares.market_id !== marketId) continue

          const funds = value.funds || []
          const usdtFund = funds.find(f => f.denom === cfg.usdtDenom)

          bets.push({
            marketId,
            trader: value.sender,
            side: value.msg.buy_shares.outcome ? 'yes' : 'no',
            amount: usdtFund ? fromUSDTBase(usdtFund.amount) : 0,
            timestamp: tx.block_unix_timestamp || tx.timestamp,
            blockHeight: tx.block_number || tx.blockHeight,
            txHash: tx.hash,
          })
        }
      } catch {
        continue
      }
    }

    return bets.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
  } catch (e) {
    console.error(`[Onmyo SDK] Market bet history failed: ${e.message}`)
    return []
  }
}

/**
 * Get a user's full betting history across all markets
 *
 * @param {string} address - injective wallet address
 * @param {object} opts - { network?, limit? }
 * @returns {Promise<Array>}
 */
export async function getUserBetHistory(address, opts = {}) {
  const { network = 'testnet', limit = 100 } = opts
  const cfg = getNetwork(network)

  try {
    const url = `${cfg.indexer}/api/explorer/v1/accountTxs/${address}?limit=${limit}&type=MsgExecuteContract`
    const res = await axios.get(url, { timeout: 15000 })
    const txs = res.data.data || res.data.txs || []

    const bets = []

    for (const tx of txs) {
      try {
        const messages = tx.messages || []
        for (const msg of messages) {
          if (msg.type !== 'MsgExecuteContract') continue
          const value = msg.value || {}
          if (value.contract !== cfg.contracts.marketManager) continue
          if (!value.msg?.buy_shares) continue

          const funds = value.funds || []
          const usdtFund = funds.find(f => f.denom === cfg.usdtDenom)

          bets.push({
            marketId: value.msg.buy_shares.market_id,
            trader: address,
            side: value.msg.buy_shares.outcome ? 'yes' : 'no',
            amount: usdtFund ? fromUSDTBase(usdtFund.amount) : 0,
            timestamp: tx.block_unix_timestamp || tx.timestamp,
            blockHeight: tx.block_number,
            txHash: tx.hash,
          })
        }
      } catch {
        continue
      }
    }

    return bets
  } catch (e) {
    console.error(`[Onmyo SDK] User bet history failed: ${e.message}`)
    return []
  }
}

/**
 * Calculate odds timeline for a market from its bet history
 * Reconstructs how YES/NO odds changed over time
 *
 * @param {number} marketId
 * @param {object} opts - { network?, limit? }
 * @returns {Promise<Array<{timestamp, yes, no, volume}>>}
 */
export async function getOddsTimeline(marketId, opts = {}) {
  const bets = await getMarketBetHistory(marketId, opts)

  if (bets.length === 0) return []

  // Sort oldest first
  const sorted = [...bets].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))

  let yesAmount = 500_000  // start at 50/50 (Spirit Bot seeds equally)
  let noAmount = 500_000

  const timeline = [{ timestamp: sorted[0].timestamp, yes: 0.5, no: 0.5, volume: 1.0 }]

  for (const bet of sorted) {
    if (bet.side === 'yes') {
      yesAmount += toUSDTBase(bet.amount)
    } else {
      noAmount += toUSDTBase(bet.amount)
    }
    const total = yesAmount + noAmount
    timeline.push({
      timestamp: bet.timestamp,
      yes: parseFloat((yesAmount / total).toFixed(4)),
      no: parseFloat((noAmount / total).toFixed(4)),
      volume: fromUSDTBase(total),
    })
  }

  return timeline
}

function toUSDTBase(amount) {
  return Math.floor(amount * 1_000_000)
}
