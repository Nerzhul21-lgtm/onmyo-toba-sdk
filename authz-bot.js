/**
 * Onmyō Toba SDK — AuthZ Delegated Bot Example
 *
 * Demonstrates how a Shikigami bot can trade on behalf of
 * a user without requiring a Keplr popup for each transaction.
 *
 * SETUP (one time, by the user):
 *   The user grants their Shikigami bot permission using grantAuthZ().
 *   This is signed once with their wallet. After that the bot runs autonomously.
 *
 * Usage:
 *   # Grant AuthZ (run once as the user)
 *   GRANTER_MNEMONIC="user mnemonic" GRANTEE_ADDRESS="inj1bot..." node examples/authz-bot.js --grant
 *
 *   # Run the bot (run continuously as the bot)
 *   BOT_MNEMONIC="bot mnemonic" GRANTER_ADDRESS="inj1user..." node examples/authz-bot.js
 */

import 'dotenv/config'
import {
  grantAuthZ,
  revokeAuthZ,
  betAsGrantee,
  claimAsGrantee,
  checkAuthZGrant,
  watchNewMarkets,
  watchResolutions,
  getMarketOdds,
  getWalletBalance,
  getAddressFromMnemonic,
  stopAllWatchers,
} from '../index.js'

const NETWORK = process.env.ONMYO_NETWORK || 'testnet'
const BOT_MNEMONIC = process.env.BOT_MNEMONIC || process.env.ONMYO_MNEMONIC
const GRANTER_MNEMONIC = process.env.GRANTER_MNEMONIC
const GRANTER_ADDRESS = process.env.GRANTER_ADDRESS
const MAX_BET_USDT = 10

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

// ── Grant AuthZ (run once by user) ───────────────────────────────────────────

async function setupGrant() {
  if (!GRANTER_MNEMONIC) {
    console.error('❌ GRANTER_MNEMONIC not set')
    process.exit(1)
  }
  if (!process.env.GRANTEE_ADDRESS) {
    console.error('❌ GRANTEE_ADDRESS not set (the bot wallet address to grant to)')
    process.exit(1)
  }

  log('Setting up AuthZ grant...')
  log(`Granting permission to: ${process.env.GRANTEE_ADDRESS}`)
  log('Expiration: 30 days')

  try {
    const txHash = await grantAuthZ(
      process.env.GRANTEE_ADDRESS,
      { network: NETWORK, expirationDays: 30 },
      GRANTER_MNEMONIC
    )
    log(`✅ AuthZ grant successful! TX: ${txHash}`)
    log(`The bot at ${process.env.GRANTEE_ADDRESS} can now trade on your behalf for 30 days.`)
    log(`To revoke: GRANTER_MNEMONIC="..." GRANTEE_ADDRESS="..." node examples/authz-bot.js --revoke`)
  } catch (e) {
    log(`❌ Grant failed: ${e.message}`)
  }
  process.exit(0)
}

// ── Revoke AuthZ ──────────────────────────────────────────────────────────────

async function revokeGrant() {
  if (!GRANTER_MNEMONIC || !process.env.GRANTEE_ADDRESS) {
    console.error('❌ GRANTER_MNEMONIC and GRANTEE_ADDRESS must be set')
    process.exit(1)
  }

  log(`Revoking AuthZ for: ${process.env.GRANTEE_ADDRESS}`)
  try {
    const txHash = await revokeAuthZ(process.env.GRANTEE_ADDRESS, GRANTER_MNEMONIC, { network: NETWORK })
    log(`✅ AuthZ revoked! TX: ${txHash}`)
  } catch (e) {
    log(`❌ Revoke failed: ${e.message}`)
  }
  process.exit(0)
}

// ── Run Bot ───────────────────────────────────────────────────────────────────

async function runBot() {
  if (!BOT_MNEMONIC) {
    console.error('❌ BOT_MNEMONIC not set')
    process.exit(1)
  }
  if (!GRANTER_ADDRESS) {
    console.error('❌ GRANTER_ADDRESS not set (the user wallet address this bot trades for)')
    process.exit(1)
  }

  const BOT_ADDRESS = getAddressFromMnemonic(BOT_MNEMONIC)

  log('🤖 Shikigami AuthZ Bot starting...')
  log(`Bot address: ${BOT_ADDRESS}`)
  log(`Trading for: ${GRANTER_ADDRESS}`)
  log(`Network: ${NETWORK}`)

  // Verify grant exists
  const grant = await checkAuthZGrant(GRANTER_ADDRESS, BOT_ADDRESS, { network: NETWORK })
  if (!grant.exists) {
    log(`❌ No AuthZ grant found. The user must run --grant first.`)
    process.exit(1)
  }
  log(`✅ AuthZ grant active, expires: ${grant.expiresAt}`)

  // Check bot's own INJ balance (needed for gas)
  const botBalance = await getWalletBalance(BOT_ADDRESS, { network: NETWORK })
  log(`💎 Bot INJ balance: ${botBalance.inj.toFixed(4)} INJ (for gas)`)

  if (botBalance.inj < 0.001) {
    log('⚠️  Bot needs INJ for gas. Send some INJ to bot address.')
  }

  const activeBets = new Map()

  // Watch for new markets and bet on behalf of granter
  watchNewMarkets({}, async (market) => {
    if (activeBets.has(market.id)) return

    const odds = await getMarketOdds(market.id, { network: NETWORK })

    // Simple strategy — customize this
    let decision = null
    if (odds.yes < 0.35 && market.endsInSeconds > 3600) decision = 'yes'
    if (odds.no < 0.35 && market.endsInSeconds > 3600) decision = 'no'
    if (!decision) return

    log(`🎯 Betting ${decision.toUpperCase()} on market #${market.id} for ${GRANTER_ADDRESS.slice(0, 12)}...`)

    try {
      const txHash = await betAsGrantee(
        market.id,
        decision,
        MAX_BET_USDT,
        GRANTER_ADDRESS,
        BOT_MNEMONIC,
        { network: NETWORK }
      )
      log(`✅ AuthZ bet placed! TX: ${txHash.slice(0, 16)}...`)
      activeBets.set(market.id, { side: decision })
    } catch (e) {
      log(`❌ AuthZ bet failed: ${e.message}`)
    }
  }, { network: NETWORK })

  // Auto-claim winnings on behalf of granter
  watchResolutions(async (event) => {
    if (!activeBets.has(event.marketId)) return
    const ourBet = activeBets.get(event.marketId)
    if (ourBet.side !== event.outcome) {
      log(`Market #${event.marketId} lost. Moving on.`)
      activeBets.delete(event.marketId)
      return
    }

    log(`🏆 Won market #${event.marketId}! Claiming for ${GRANTER_ADDRESS.slice(0, 12)}...`)
    setTimeout(async () => {
      try {
        const txHash = await claimAsGrantee(
          event.marketId,
          GRANTER_ADDRESS,
          BOT_MNEMONIC,
          { network: NETWORK }
        )
        log(`💰 Winnings claimed for user! TX: ${txHash.slice(0, 16)}...`)
      } catch (e) {
        log(`⚠️  Claim failed: ${e.message}`)
      }
      activeBets.delete(event.marketId)
    }, 10000)
  }, { network: NETWORK })

  process.on('SIGINT', () => {
    log('🛑 Shutting down...')
    stopAllWatchers()
    process.exit(0)
  })

  log('🝢 AuthZ bot running. Press Ctrl+C to stop.')
}

// ── Entry Point ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
if (args.includes('--grant')) {
  await setupGrant()
} else if (args.includes('--revoke')) {
  await revokeGrant()
} else {
  await runBot()
}
