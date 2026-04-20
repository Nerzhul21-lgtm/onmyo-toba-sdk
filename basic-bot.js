/**
 * Onmyō Toba SDK — Basic Polling Bot Example
 *
 * A simple bot that polls for open markets every 5 minutes,
 * applies a strategy, and places bets. No real-time streaming.
 *
 * Good for: markets lasting hours/days, simple strategies
 *
 * Usage:
 *   ONMYO_MNEMONIC="your mnemonic" node examples/basic-bot.js
 */

import 'dotenv/config'
import {
  getOpenMarkets,
  getMarketOdds,
  getWalletBalance,
  getUserPositions,
  bet,
  claimWinnings,
  getAddressFromMnemonic,
} from '../index.js'

const MNEMONIC = process.env.ONMYO_MNEMONIC
const NETWORK = process.env.ONMYO_NETWORK || 'testnet'
const POLL_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const MAX_BET_USDT = 10
const MIN_USDT_BALANCE = 20

if (!MNEMONIC) {
  console.error('❌ ONMYO_MNEMONIC not set in .env')
  process.exit(1)
}

const BOT_ADDRESS = getAddressFromMnemonic(MNEMONIC)

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

/**
 * Your strategy logic goes here.
 * Return 'yes', 'no', or null (skip this market)
 *
 * This example: bet YES when probability is below 40% (value bet)
 */
function applyStrategy(market, odds) {
  // Skip markets with very low volume (less than $50)
  if (market.totalVolume < 50) return null

  // Skip markets expiring in less than 1 hour
  if (market.endsInSeconds < 3600) return null

  // Value bet: YES is underpriced (crowd thinks it's unlikely but we disagree)
  if (odds.yes < 0.40 && odds.yes > 0.15) return 'yes'

  // Value bet: NO is underpriced
  if (odds.no < 0.40 && odds.no > 0.15) return 'no'

  return null
}

async function claimAllWinnings(positions) {
  const claimable = positions.filter(p => p.claimed === false)
  if (claimable.length === 0) return

  log(`💰 Found ${claimable.length} positions to check for winnings...`)

  for (const pos of claimable) {
    try {
      const txHash = await claimWinnings(pos.marketId, MNEMONIC, { network: NETWORK })
      log(`  ✅ Claimed market #${pos.marketId} | TX: ${txHash.slice(0, 16)}...`)
      await new Promise(r => setTimeout(r, 3000))
    } catch (e) {
      // Market likely not resolved yet
    }
  }
}

async function runCycle() {
  log('══════════════════════════════════════════════')
  log('CYCLE START')

  // Check balance
  const balance = await getWalletBalance(BOT_ADDRESS, { network: NETWORK })
  log(`💵 Balance: $${balance.usdt.toFixed(2)} USDT | ${balance.inj.toFixed(4)} INJ`)

  if (balance.usdt < MIN_USDT_BALANCE) {
    log(`⚠️  Balance below minimum ($${MIN_USDT_BALANCE}). Skipping bets.`)
    return
  }

  // Try to claim any winnings first
  const positions = await getUserPositions(BOT_ADDRESS, { network: NETWORK })
  await claimAllWinnings(positions)

  // Get existing position market IDs to avoid doubling up
  const existingMarketIds = new Set(positions.map(p => p.marketId))

  // Get open markets — customize filters for your strategy
  const markets = await getOpenMarkets(
    { category: 'Crypto' }, // Change this to your preferred category
    { network: NETWORK, limit: 20 }
  )

  log(`📊 Found ${markets.length} open markets`)

  let betsPlaced = 0

  for (const market of markets) {
    // Skip if we already have a position
    if (existingMarketIds.has(market.id)) continue

    const odds = await getMarketOdds(market.id, { network: NETWORK })
    const decision = applyStrategy(market, odds)

    if (!decision) continue

    log(`🎯 Market #${market.id}: "${market.question.slice(0, 60)}..."`)
    log(`   YES: ${(odds.yes * 100).toFixed(1)}% | NO: ${(odds.no * 100).toFixed(1)}% | Volume: $${odds.totalVolume.toFixed(2)}`)
    log(`   Decision: ${decision.toUpperCase()} @ $${MAX_BET_USDT}`)

    try {
      const txHash = await bet(market.id, decision, MAX_BET_USDT, MNEMONIC, { network: NETWORK })
      log(`   ✅ Bet placed! TX: ${txHash.slice(0, 16)}...`)
      betsPlaced++
      await new Promise(r => setTimeout(r, 3000))
    } catch (e) {
      log(`   ❌ Bet failed: ${e.message}`)
    }
  }

  log(`📈 Bets placed this cycle: ${betsPlaced}`)
  log('CYCLE COMPLETE')
  log('══════════════════════════════════════════════')
}

// ── Main ──────────────────────────────────────────────────────────────────────

log('🝢 Onmyō Toba Basic Bot starting...')
log(`Network: ${NETWORK}`)
log(`Bot address: ${BOT_ADDRESS}`)
log(`Poll interval: ${POLL_INTERVAL_MS / 60000} minutes`)

await runCycle()

setInterval(async () => {
  try {
    await runCycle()
  } catch (e) {
    log(`❌ Cycle error: ${e.message}`)
  }
}, POLL_INTERVAL_MS)
