/**
 * Onmyō Toba SDK — Real-time Streaming Bot Example
 *
 * Reacts instantly when new markets open or odds change.
 * Perfect for: short-duration markets (5-60 minute BTC price markets),
 * momentum strategies, arbitrage on odds discrepancies.
 *
 * Usage:
 *   ONMYO_MNEMONIC="your mnemonic" node examples/streaming-bot.js
 */

import 'dotenv/config'
import {
  watchNewMarkets,
  watchMarket,
  watchResolutions,
  getMarketOdds,
  getWalletBalance,
  getUserPositions,
  claimWinnings,
  bet,
  getAddressFromMnemonic,
  stopAllWatchers,
} from '../index.js'

const MNEMONIC = process.env.ONMYO_MNEMONIC
const NETWORK = process.env.ONMYO_NETWORK || 'testnet'
const MAX_BET_USDT = 10
const MIN_CONFIDENCE = 0.65 // Only bet when we're at least 65% confident

if (!MNEMONIC) {
  console.error('❌ ONMYO_MNEMONIC not set in .env')
  process.exit(1)
}

const BOT_ADDRESS = getAddressFromMnemonic(MNEMONIC)
const activeBets = new Map() // marketId -> { side, amount }

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

/**
 * Your price prediction strategy.
 * Replace this with your actual BTC/price analysis logic.
 *
 * @param {object} market - full market object with .meta
 * @param {object} odds - { yes, no, totalVolume }
 * @returns {'yes'|'no'|null}
 */
function priceStrategy(market, odds) {
  const meta = market.meta

  // Only handle price markets
  if (meta.type !== 'price') return null

  // Skip if market expires in less than 10 minutes
  if (market.endsInSeconds < 600) return null

  // Skip if we already have a bet
  if (activeBets.has(market.id)) return null

  // Skip low liquidity markets
  if (odds.totalVolume < 20) return null

  // === YOUR STRATEGY LOGIC HERE ===
  // Example: Contrarian — bet against the crowd when odds are lopsided
  if (odds.yes > 0.80) return 'no'   // Crowd is overconfident on YES
  if (odds.no > 0.80) return 'yes'   // Crowd is overconfident on NO

  // Example: For BTC specifically — add your price analysis
  if (meta.asset === 'BTC') {
    // Add your BTC-specific signal here
    // e.g., check moving averages, RSI, etc.
    // Return 'yes', 'no', or null
  }

  return null
}

async function placeBet(market, side, amount) {
  if (activeBets.has(market.id)) return

  try {
    const balance = await getWalletBalance(BOT_ADDRESS, { network: NETWORK })
    if (balance.usdt < amount + 1) {
      log(`⚠️  Insufficient balance ($${balance.usdt.toFixed(2)} USDT). Skipping.`)
      return
    }

    log(`🎯 Betting ${side.toUpperCase()} $${amount} on market #${market.id}`)
    log(`   "${market.question.slice(0, 70)}..."`)

    const txHash = await bet(market.id, side, amount, MNEMONIC, { network: NETWORK })
    log(`   ✅ TX: ${txHash.slice(0, 20)}...`)

    activeBets.set(market.id, { side, amount, txHash })

    // Start watching this market's odds in real-time
    watchMarket(market.id, (update) => {
      log(`   📊 Market #${market.id} odds: YES ${(update.yesOdds * 100).toFixed(1)}% | NO ${(update.noOdds * 100).toFixed(1)}% | Vol $${update.totalVolume.toFixed(2)}`)
    }, { network: NETWORK })
  } catch (e) {
    log(`   ❌ Bet failed: ${e.message}`)
  }
}

// ── Watch for new markets ─────────────────────────────────────────────────────

log('👁️  Watching for new Crypto/Price markets...')

const stopNewMarkets = watchNewMarkets(
  { type: 'price' }, // Only price markets
  async (market) => {
    log(`🆕 New market #${market.id}: "${market.question}"`)
    log(`   Asset: ${market.meta.asset} | Target: $${market.meta.target} | Direction: ${market.meta.direction}`)
    log(`   Initial odds: YES ${(market.yesOdds * 100).toFixed(1)}% | NO ${(market.noOdds * 100).toFixed(1)}%`)

    const odds = await getMarketOdds(market.id, { network: NETWORK })
    const decision = priceStrategy(market, odds)

    if (decision) {
      await placeBet(market, decision, MAX_BET_USDT)
    } else {
      log(`   ⏭️  Skipping — no clear signal`)
    }
  },
  { network: NETWORK }
)

// ── Watch for resolutions to claim winnings ───────────────────────────────────

const stopResolutions = watchResolutions(
  async (event) => {
    const { marketId, outcome } = event

    if (!activeBets.has(marketId)) return

    const ourBet = activeBets.get(marketId)
    const won = ourBet.side === outcome

    log(`🏁 Market #${marketId} resolved: ${outcome.toUpperCase()}`)
    log(`   Our bet: ${ourBet.side.toUpperCase()} | Result: ${won ? '✅ WON' : '❌ LOST'}`)

    if (won) {
      // Wait for finalization before claiming
      setTimeout(async () => {
        try {
          const txHash = await claimWinnings(marketId, MNEMONIC, { network: NETWORK })
          log(`   💰 Winnings claimed! TX: ${txHash.slice(0, 16)}...`)
        } catch (e) {
          log(`   ⚠️  Claim failed (may need more time): ${e.message}`)
        }
      }, 10000) // 10 second delay after resolution
    }

    activeBets.delete(marketId)
  },
  { network: NETWORK }
)

// ── Graceful shutdown ─────────────────────────────────────────────────────────

process.on('SIGINT', () => {
  log('🛑 Shutting down...')
  stopNewMarkets()
  stopResolutions()
  stopAllWatchers()
  process.exit(0)
})

log('🝢 Streaming bot active. Press Ctrl+C to stop.')
log(`Network: ${NETWORK} | Bot: ${BOT_ADDRESS}`)
