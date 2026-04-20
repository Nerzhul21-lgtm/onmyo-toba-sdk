/**
 * Onmyō Toba SDK — AuthZ (Delegated Execution)
 *
 * AuthZ allows a user (granter) to delegate permission to a bot wallet (grantee)
 * to execute transactions on their behalf — no Keplr popup per transaction.
 *
 * Flow:
 *   1. User calls grantAuthZ() once from their wallet → signs with Keplr
 *   2. Bot calls betAsGrantee() using its own mnemonic, on behalf of user
 *   3. User calls revokeAuthZ() to cancel permission at any time
 */

import {
  PrivateKey,
  MsgBroadcasterWithPk,
  MsgGrant,
  MsgRevoke,
  MsgExec,
  MsgExecuteContractCompat,
} from '@injectivelabs/sdk-ts'
import { Network } from '@injectivelabs/networks'
import { getNetwork, toUSDTBase } from './config.js'

const WASM_EXECUTE_MSG_TYPE = '/cosmwasm.wasm.v1.MsgExecuteContract'
const AUTHZ_GENERIC_TYPE = '/cosmos.authz.v1beta1.GenericAuthorization'

function getNetworkEnum(network) {
  return network === 'mainnet' ? Network.MainnetSentry : Network.TestnetSentry
}

function createBroadcaster(mnemonic, network = 'testnet') {
  const privateKey = PrivateKey.fromMnemonic(mnemonic)
  return {
    broadcaster: new MsgBroadcasterWithPk({
      privateKey: '0x' + privateKey.toPrivateKeyHex(),
      network: getNetworkEnum(network),
    }),
    address: privateKey.toBech32(),
  }
}

/**
 * Grant a bot wallet permission to execute contract messages on your behalf
 *
 * This is called ONCE by the user/granter. After this, the bot can place bets
 * without any wallet popup for each transaction.
 *
 * @param {string} botAddress - the injective address of the bot wallet (grantee)
 * @param {object} opts - { network?, expirationDays? (default: 30) }
 * @param {string} granterMnemonic - the user's mnemonic (or use Keplr signing separately)
 * @returns {Promise<string>} transaction hash
 */
export async function grantAuthZ(botAddress, opts = {}, granterMnemonic) {
  const { network = 'testnet', expirationDays = 30 } = opts
  const { broadcaster, address: granterAddress } = createBroadcaster(granterMnemonic, network)

  const expirationTime = new Date()
  expirationTime.setDate(expirationTime.getDate() + expirationDays)

  const msg = MsgGrant.fromJSON({
    grantee: botAddress,
    granter: granterAddress,
    authorization: {
      '@type': AUTHZ_GENERIC_TYPE,
      msg: WASM_EXECUTE_MSG_TYPE,
    },
    expiration: expirationTime,
  })

  const result = await broadcaster.broadcast({ msgs: msg })
  if (result.code !== 0) throw new Error(`Grant failed: ${result.rawLog}`)
  return result.txHash
}

/**
 * Revoke a bot wallet's AuthZ permission
 *
 * @param {string} botAddress - the bot wallet address to revoke
 * @param {string} granterMnemonic - the user's mnemonic
 * @param {object} opts - { network? }
 * @returns {Promise<string>} transaction hash
 */
export async function revokeAuthZ(botAddress, granterMnemonic, opts = {}) {
  const { network = 'testnet' } = opts
  const { broadcaster, address: granterAddress } = createBroadcaster(granterMnemonic, network)

  const msg = MsgRevoke.fromJSON({
    grantee: botAddress,
    granter: granterAddress,
    msgTypeUrl: WASM_EXECUTE_MSG_TYPE,
  })

  const result = await broadcaster.broadcast({ msgs: msg })
  if (result.code !== 0) throw new Error(`Revoke failed: ${result.rawLog}`)
  return result.txHash
}

/**
 * Place a bet on behalf of a granter using AuthZ
 *
 * The bot signs with its own mnemonic but the transaction is executed
 * from the granter's account (their USDT is used, their prestige accrues).
 *
 * @param {number} marketId - market to bet on
 * @param {'yes'|'no'} side - which side to bet
 * @param {number} amountUsdt - amount in USDT
 * @param {string} granterAddress - the user's injective address
 * @param {string} granteeMnemonic - the bot's mnemonic (grantee signs)
 * @param {object} opts - { network? }
 * @returns {Promise<string>} transaction hash
 */
export async function betAsGrantee(marketId, side, amountUsdt, granterAddress, granteeMnemonic, opts = {}) {
  const { network = 'testnet' } = opts
  const cfg = getNetwork(network)
  const { broadcaster, address: granteeAddress } = createBroadcaster(granteeMnemonic, network)

  if (!['yes', 'no'].includes(side)) throw new Error("side must be 'yes' or 'no'")

  const outcome = side === 'yes'
  const amount = toUSDTBase(amountUsdt)

  // Build the inner contract execution message (from granter's perspective)
  const innerMsg = MsgExecuteContractCompat.fromJSON({
    contractAddress: cfg.contracts.marketManager,
    sender: granterAddress,
    msg: { buy_shares: { market_id: marketId, outcome } },
    funds: [{ denom: cfg.usdtDenom, amount: amount.toString() }],
  })

  // Wrap in MsgExec (grantee executes on behalf of granter)
  const execMsg = MsgExec.fromJSON({
    grantee: granteeAddress,
    msgs: [innerMsg],
  })

  const result = await broadcaster.broadcast({ msgs: execMsg })
  if (result.code !== 0) throw new Error(`AuthZ bet failed: ${result.rawLog}`)
  return result.txHash
}

/**
 * Claim winnings on behalf of a granter using AuthZ
 *
 * @param {number} marketId - market to claim from
 * @param {string} granterAddress - the user's injective address
 * @param {string} granteeMnemonic - the bot's mnemonic
 * @param {object} opts - { network? }
 * @returns {Promise<string>} transaction hash
 */
export async function claimAsGrantee(marketId, granterAddress, granteeMnemonic, opts = {}) {
  const { network = 'testnet' } = opts
  const cfg = getNetwork(network)
  const { broadcaster, address: granteeAddress } = createBroadcaster(granteeMnemonic, network)

  const innerMsg = MsgExecuteContractCompat.fromJSON({
    contractAddress: cfg.contracts.marketManager,
    sender: granterAddress,
    msg: { claim_winnings: { market_id: marketId } },
    funds: [],
  })

  const execMsg = MsgExec.fromJSON({
    grantee: granteeAddress,
    msgs: [innerMsg],
  })

  const result = await broadcaster.broadcast({ msgs: execMsg })
  if (result.code !== 0) throw new Error(`AuthZ claim failed: ${result.rawLog}`)
  return result.txHash
}

/**
 * Check if an AuthZ grant exists between granter and grantee
 * @param {string} granterAddress
 * @param {string} granteeAddress
 * @param {object} opts - { network? }
 * @returns {Promise<{exists: boolean, expiration?: string}>}
 */
export async function checkAuthZGrant(granterAddress, granteeAddress, opts = {}) {
  const { network = 'testnet' } = opts
  const cfg = getNetwork(network)

  try {
    const axios = (await import('axios')).default
    const url = `${cfg.rest}/cosmos/authz/v1beta1/grants?granter=${granterAddress}&grantee=${granteeAddress}&msg_type_url=${encodeURIComponent(WASM_EXECUTE_MSG_TYPE)}`
    const res = await axios.get(url, { timeout: 10000 })
    const grants = res.data.grants || []

    if (grants.length === 0) return { exists: false }

    const grant = grants[0]
    return {
      exists: true,
      expiration: grant.expiration,
      expiresAt: grant.expiration ? new Date(grant.expiration).toISOString() : 'never',
    }
  } catch {
    return { exists: false }
  }
}
