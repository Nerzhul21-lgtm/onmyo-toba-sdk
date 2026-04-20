/**
 * Onmyō Toba SDK — Real-time WebSocket Streaming
 *
 * Subscribes to Injective's CometBFT WebSocket to receive
 * instant notifications when markets are created or odds change.
 *
 * Uses: wss://testnet.sentry.tm.injective.network:443/websocket
 */

import WebSocket from 'ws'
import { getNetwork } from './config.js'
import { parseMeta, parseDescription, filterByMeta } from './meta.js'
import { getMarket, getOpenMarkets } from './query.js'

// Track active subscriptions
const activeConnections = new Map()
const oddsHistory = new Map() // marketId -> [{timestamp, yes, no}]
const MAX_HISTORY_POINTS = 100

/**
 * Internal: parse a wasm event from a WebSocket tx event
 */
function parseWasmEvent(txResult) {
  try {
    const events = txResult?.result?.events || []
    const wasmEvents = events.filter(e => e.type === 'wasm')
    const attrs = {}

    for (const event of wasmEvents) {
      for (const attr of (event.attributes || [])) {
        const key = Buffer.from(attr.key, 'base64').toString()
        const value = Buffer.from(attr.value, 'base64').toString()
        attrs[key] = value
      }
    }

    return attrs
  } catch {
    return {}
  }
}

/**
 * Watch ALL market manager transactions in real-time
 * Fires callback on any bet or market creation
 *
 * @param {function} callback - called with (eventType, data)
 *   eventType: 'new_market' | 'bet_placed' | 'market_resolved' | 'winnings_claimed'
 * @param {object} opts - { network? }
 * @returns {function} stop - call to close the WebSocket
 */
export function watchAll(callback, opts = {}) {
  const { network = 'testnet' } = opts
  const cfg = getNetwork(network)

  const ws = new WebSocket(cfg.ws)
  const connectionId = Date.now().toString()

  ws.on('open', () => {
    console.log(`[Onmyo SDK] WebSocket connected (${network})`)

    // Subscribe to all wasm transactions on our market manager
    const subscription = {
      jsonrpc: '2.0',
      method: 'subscribe',
      id: 1,
      params: {
        query: `tm.event='Tx' AND wasm._contract_address='${cfg.contracts.marketManager}'`
      }
    }
    ws.send(JSON.stringify(subscription))
  })

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString())
      if (!msg.result?.events) return

      const attrs = parseWasmEvent(msg.result)
      const action = attrs['action']

      if (!action) return

      if (action === 'create_spirit_market' || action === 'create_market') {
        // New market created — fetch full details
        const marketId = parseInt(attrs['market_id'] || '0')
        if (marketId > 0) {
          try {
            const market = await getMarket(marketId, { network })
            callback('new_market', market)

            // Initialize odds history
            oddsHistory.set(marketId, [{
              timestamp: Date.now(),
              yes: market.yesOdds,
              no: market.noOdds,
            }])
          } catch (e) {
            callback('new_market', { id: marketId, action, raw: attrs })
          }
        }
      } else if (action === 'buy_shares') {
        // Bet placed — odds have changed
        const marketId = parseInt(attrs['market_id'] || '0')
        if (marketId > 0) {
          try {
            const market = await getMarket(marketId, { network })
            callback('bet_placed', {
              marketId,
              trader: attrs['trader'] || attrs['sender'],
              outcome: attrs['outcome'] === 'true' ? 'yes' : 'no',
              amount: attrs['amount'],
              newYesOdds: market.yesOdds,
              newNoOdds: market.noOdds,
              totalVolume: market.totalVolume,
              market,
            })

            // Update odds history
            const history = oddsHistory.get(marketId) || []
            history.push({ timestamp: Date.now(), yes: market.yesOdds, no: market.noOdds })
            if (history.length > MAX_HISTORY_POINTS) history.shift()
            oddsHistory.set(marketId, history)
          } catch (e) {
            callback('bet_placed', { marketId, raw: attrs })
          }
        }
      } else if (action === 'finalize_resolution' || action === 'resolve_market') {
        const marketId = parseInt(attrs['market_id'] || '0')
        const outcome = attrs['outcome'] === 'true' ? 'yes' : 'no'
        callback('market_resolved', { marketId, outcome, raw: attrs })
      } else if (action === 'claim_winnings') {
        const marketId = parseInt(attrs['market_id'] || '0')
        callback('winnings_claimed', {
          marketId,
          trader: attrs['trader'] || attrs['sender'],
          winnings: attrs['winnings'],
          raw: attrs,
        })
      }
    } catch (e) {
      // Ignore parse errors
    }
  })

  ws.on('error', (err) => {
    console.error(`[Onmyo SDK] WebSocket error: ${err.message}`)
  })

  ws.on('close', () => {
    console.log('[Onmyo SDK] WebSocket connection closed')
    activeConnections.delete(connectionId)
  })

  activeConnections.set(connectionId, ws)

  // Return stop function
  return () => {
    ws.close()
    activeConnections.delete(connectionId)
  }
}

/**
 * Watch for new markets matching specific filters
 * Perfect for bots that only care about certain types (e.g. BTC price markets)
 *
 * @param {object} filters - { type?, asset?, category?, sport?, ... }
 * @param {function} callback - called with (market) when matching market is created
 * @param {object} opts - { network? }
 * @returns {function} stop
 */
export function watchNewMarkets(filters = {}, callback, opts = {}) {
  return watchAll((eventType, data) => {
    if (eventType !== 'new_market') return

    const [filtered] = filterByMeta([data], filters)
    if (filtered) callback(filtered)
  }, opts)
}

/**
 * Watch a specific market for odds changes
 *
 * @param {number} marketId - market to watch
 * @param {function} callback - called with odds update
 * @param {object} opts - { network? }
 * @returns {function} stop
 */
export function watchMarket(marketId, callback, opts = {}) {
  return watchAll((eventType, data) => {
    if (eventType !== 'bet_placed') return
    if (data.marketId !== marketId) return
    callback({
      marketId,
      yesOdds: data.newYesOdds,
      noOdds: data.newNoOdds,
      totalVolume: data.totalVolume,
      lastBetBy: data.trader,
      lastBetSide: data.outcome,
    })
  }, opts)
}

/**
 * Watch for market resolutions
 *
 * @param {function} callback - called with { marketId, outcome }
 * @param {object} opts - { network?, marketIds? } - filter to specific markets
 * @returns {function} stop
 */
export function watchResolutions(callback, opts = {}) {
  const { marketIds } = opts
  return watchAll((eventType, data) => {
    if (eventType !== 'market_resolved') return
    if (marketIds && !marketIds.includes(data.marketId)) return
    callback(data)
  }, opts)
}

// ── Odds History ──────────────────────────────────────────────────────────────

/**
 * Get in-memory odds history for a market (populated by WebSocket stream)
 * @param {number} marketId
 * @param {number} maxPoints - limit history points returned
 * @returns {Array<{timestamp, yes, no}>}
 */
export function getOddsHistory(marketId, maxPoints = MAX_HISTORY_POINTS) {
  const history = oddsHistory.get(marketId) || []
  return history.slice(-maxPoints)
}

/**
 * Pre-load odds history from on-chain data by sampling recent bets
 * Queries the market repeatedly to build a snapshot history
 *
 * @param {number} marketId
 * @param {object} opts - { network?, samples?, intervalMs? }
 */
export async function initOddsHistory(marketId, opts = {}) {
  const { network = 'testnet', samples = 10, intervalMs = 5000 } = opts

  console.log(`[Onmyo SDK] Initializing odds history for market #${marketId}...`)
  const history = []

  for (let i = 0; i < samples; i++) {
    try {
      const market = await getMarket(marketId, { network })
      history.push({ timestamp: Date.now(), yes: market.yesOdds, no: market.noOdds })
      if (i < samples - 1) await new Promise(r => setTimeout(r, intervalMs))
    } catch (e) {
      break
    }
  }

  oddsHistory.set(marketId, history)
  return history
}

/**
 * Stop all active WebSocket connections
 */
export function stopAllWatchers() {
  for (const [id, ws] of activeConnections) {
    ws.close()
    activeConnections.delete(id)
  }
  console.log('[Onmyo SDK] All WebSocket connections closed')
}
