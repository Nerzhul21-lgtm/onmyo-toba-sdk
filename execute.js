/**
 * Onmyō Toba SDK — Execute Functions (requires wallet mnemonic)
 */

import {
  PrivateKey,
  MsgExecuteContractCompat,
  MsgBroadcasterWithPk,
} from '@injectivelabs/sdk-ts'
import { Network } from '@injectivelabs/networks'
import { getNetwork, toUSDTBase } from './config.js'
import { buildDescription } from './meta.js'

/** Get Injective Network enum from string */
function getNetworkEnum(network) {
  return network === 'mainnet' ? Network.MainnetSentry : Network.TestnetSentry
}

/** Create a broadcaster from a mnemonic */
function createBroadcaster(mnemonic, network = 'testnet') {
  const privateKey = PrivateKey.fromMnemonic(mnemonic)
  const privateKeyHex = privateKey.toPrivateKeyHex()
  return {
    broadcaster: new MsgBroadcasterWithPk({
      privateKey: '0x' + privateKeyHex,
      network: getNetworkEnum(network),
    }),
    address: privateKey.toBech32(),
  }
}

/** Execute a contract message and return the tx hash */
async function executeContract(mnemonic, contractAddress, msg, funds = [], network = 'testnet') {
  const { broadcaster, address } = createBroadcaster(mnemonic, network)
  const cfg = getNetwork(network)

  const message = MsgExecuteContractCompat.fromJSON({
    contractAddress,
    sender: address,
    msg,
    funds: funds.length > 0 ? funds : [],
  })

  const result = await broadcaster.broadcast({ msgs: message })

  if (result.code !== 0) {
    throw new Error(`Transaction failed: ${result.rawLog || JSON.stringify(result)}`)
  }

  return result.txHash
}

// ── Market Execution ──────────────────────────────────────────────────────────

/**
 * Place a YES or NO bet on a market
 * @param {number} marketId - market to bet on
 * @param {'yes'|'no'} side - which side to bet
 * @param {number} amountUsdt - amount in USDT (e.g. 10 = $10)
 * @param {string} mnemonic - wallet mnemonic phrase
 * @param {object} opts - { network? }
 * @returns {Promise<string>} transaction hash
 */
export async function bet(marketId, side, amountUsdt, mnemonic, opts = {}) {
  const { network = 'testnet' } = opts
  const cfg = getNetwork(network)

  if (!['yes', 'no'].includes(side)) throw new Error("side must be 'yes' or 'no'")
  if (amountUsdt <= 0) throw new Error('amountUsdt must be greater than 0')

  const outcome = side === 'yes'
  const amount = toUSDTBase(amountUsdt)

  return executeContract(
    mnemonic,
    cfg.contracts.marketManager,
    { buy_shares: { market_id: marketId, outcome } },
    [{ denom: cfg.usdtDenom, amount: amount.toString() }],
    network
  )
}

/**
 * Claim winnings from a resolved market
 * @param {number} marketId - market to claim from
 * @param {string} mnemonic - wallet mnemonic phrase
 * @param {object} opts - { network? }
 * @returns {Promise<string>} transaction hash
 */
export async function claimWinnings(marketId, mnemonic, opts = {}) {
  const { network = 'testnet' } = opts
  const cfg = getNetwork(network)

  return executeContract(
    mnemonic,
    cfg.contracts.marketManager,
    { claim_winnings: { market_id: marketId } },
    [],
    network
  )
}

/**
 * Create a new prediction market (costs 5 USDT)
 * @param {object} marketData - { question, description, category, endTime, meta? }
 * @param {string} mnemonic - wallet mnemonic phrase
 * @param {object} opts - { network? }
 * @returns {Promise<string>} transaction hash
 */
export async function createMarket(marketData, mnemonic, opts = {}) {
  const { network = 'testnet' } = opts
  const cfg = getNetwork(network)

  const { question, description = '', category, endTime, meta } = marketData

  if (!question) throw new Error('question is required')
  if (!category) throw new Error('category is required')
  if (!endTime || endTime <= Date.now() / 1000) throw new Error('endTime must be in the future (unix seconds)')

  // Embed meta if provided
  const finalDescription = meta
    ? buildDescription(description, meta)
    : description

  const creationFee = toUSDTBase(5)

  return executeContract(
    mnemonic,
    cfg.contracts.marketManager,
    {
      create_market: {
        question,
        description: finalDescription,
        category,
        end_time: endTime,
      }
    },
    [{ denom: cfg.usdtDenom, amount: creationFee.toString() }],
    network
  )
}

/**
 * Batch claim all available winnings across multiple markets
 * @param {number[]} marketIds - array of market IDs to claim
 * @param {string} mnemonic - wallet mnemonic phrase
 * @param {object} opts - { network?, delayMs? }
 * @returns {Promise<Array<{marketId, txHash?, error?}>>}
 */
export async function batchClaimWinnings(marketIds, mnemonic, opts = {}) {
  const { network = 'testnet', delayMs = 2000 } = opts
  const results = []

  for (const marketId of marketIds) {
    try {
      const txHash = await claimWinnings(marketId, mnemonic, { network })
      results.push({ marketId, txHash })
      if (delayMs > 0 && marketId !== marketIds[marketIds.length - 1]) {
        await new Promise(r => setTimeout(r, delayMs))
      }
    } catch (error) {
      results.push({ marketId, error: error.message })
    }
  }

  return results
}

/**
 * Get the wallet address for a given mnemonic
 * @param {string} mnemonic
 * @returns {string} injective address
 */
export function getAddressFromMnemonic(mnemonic) {
  const privateKey = PrivateKey.fromMnemonic(mnemonic)
  return privateKey.toBech32()
}
