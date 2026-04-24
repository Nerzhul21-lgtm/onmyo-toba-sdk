#!/usr/bin/env node
/**
 * Onmyō Toba MCP Server
 *
 * Exposes all SDK functions as MCP tools so that AI agents
 * (Claude Desktop, Cursor, LangChain, CrewAI, GPT-4, Gemini, Ollama)
 * can interact with Onmyō Toba prediction markets using natural language.
 *
 * Usage:
 *   node mcp-server.js
 *
 * Add to Claude Desktop config (~/.config/Claude/claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "onmyo-toba": {
 *         "command": "node",
 *         "args": ["/path/to/onmyo-toba-sdk/mcp-server.js"],
 *         "env": {
 *           "ONMYO_NETWORK": "testnet",
 *           "ONMYO_MNEMONIC": "your twelve or twenty four word mnemonic here"
 *         }
 *       }
 *     }
 *   }
 *
 * For LangChain / other LLMs use shikigami-agent.py template instead.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import {
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

import { bet, claimWinnings, createMarket, batchClaimWinnings, getAddressFromMnemonic, executeContract } from './execute.js'
import { grantAuthZ, revokeAuthZ, checkAuthZGrant } from './authz.js'
import { parseMeta } from './meta.js'

const NETWORK = process.env.ONMYO_NETWORK || 'testnet'
const MNEMONIC = process.env.ONMYO_MNEMONIC || ''

// Shikigami registry contract address
const SHIKIGAMI_REGISTRY = NETWORK === 'mainnet'
  ? ''  // fill in when mainnet deploys
  : 'inj12kvlyuut5wja82w4qrwvsgm8qhqx924cfqj7xz'

// ── Tool Definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  // ── Read tools ──────────────────────────────────────────────────────────────
  {
    name: 'get_open_markets',
    description: 'Get all open (unresolved) prediction markets on Onmyō Toba. Can filter by category, market type, asset, sport, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter by category: Crypto, Sports, Politics, AI, Economics, Weather' },
        type: { type: 'string', description: 'Filter by market type: price, sports, weather, politics, ai, economics, general' },
        asset: { type: 'string', description: 'Filter by asset (for price markets): BTC, ETH, INJ, SOL, etc.' },
        sport: { type: 'string', description: 'Filter by sport (for sports markets): NBA, Football, F1, MMA' },
        limit: { type: 'number', description: 'Max markets to return (default 50)' },
      },
    },
  },
  {
    name: 'get_market',
    description: 'Get detailed information about a specific prediction market by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Market ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_market_odds',
    description: 'Get current YES/NO odds (probabilities) for a market. Returns values between 0 and 1.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Market ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_market_stats',
    description: 'Get trading statistics for a market: total volume, liquidity, YES/NO percentages',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Market ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_market_meta',
    description: 'Get machine-readable structured metadata for a market (type, asset, target price, sport, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Market ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_position',
    description: 'Get a wallet\'s position in a specific market',
    inputSchema: {
      type: 'object',
      properties: {
        market_id: { type: 'number', description: 'Market ID' },
        address: { type: 'string', description: 'Injective wallet address (inj1...)' },
      },
      required: ['market_id', 'address'],
    },
  },
  {
    name: 'get_user_positions',
    description: 'Get all open positions for a wallet across all markets',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Injective wallet address (inj1...)' },
      },
      required: ['address'],
    },
  },
  {
    name: 'get_user_stats',
    description: 'Get a user\'s stats: prestige, rank, win rate, prediction count, daily streak',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Injective wallet address (inj1...)' },
      },
      required: ['address'],
    },
  },
  {
    name: 'get_wallet_balance',
    description: 'Get USDT and INJ balance of a wallet',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Injective wallet address (inj1...)' },
      },
      required: ['address'],
    },
  },
  {
    name: 'get_spirit_vault_balance',
    description: 'Get the current USDT balance in the Onmyō Toba Spirit Vault',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_bot_address',
    description: 'Get the Injective address derived from the configured bot mnemonic',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Shikigami tools ──────────────────────────────────────────────────────────
  {
    name: 'get_shikigami',
    description: 'Get the Shikigami profile for a wallet — level, name, profit, risk style, categories, bot wallet',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Injective wallet address that owns the Shikigami (inj1...)' },
      },
      required: ['owner'],
    },
  },
  {
    name: 'get_shikigami_next_level',
    description: 'Get how much profit is needed for the Shikigami to level up to the next tier',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Injective wallet address that owns the Shikigami' },
      },
      required: ['owner'],
    },
  },
  {
    name: 'get_shikigami_leaderboard',
    description: 'Get the weekly Shikigami leaderboard — top performing strategy bots by weekly profit',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of entries to return (default 20)' },
      },
    },
  },
  {
    name: 'update_bot_wallet',
    description: 'Register or update the bot wallet address on your Shikigami profile. This links your trading bot wallet to your on-chain Shikigami identity. Requires ONMYO_MNEMONIC (owner wallet).',
    inputSchema: {
      type: 'object',
      properties: {
        bot_wallet: {
          type: 'string',
          description: 'The Injective address of your trading bot wallet (inj1...). Pass null to remove.',
        },
      },
    },
  },
  {
    name: 'update_shikigami_strategy',
    description: 'Update your Shikigami\'s public strategy description, categories, or risk style shown on the marketplace. Requires ONMYO_MNEMONIC.',
    inputSchema: {
      type: 'object',
      properties: {
        strategy_description: { type: 'string', description: 'Short description of your trading strategy (max 120 chars)' },
        risk_style: { type: 'string', enum: ['conservative', 'balanced', 'aggressive'], description: 'Risk style' },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Market categories to focus on: Crypto, Sports, Politics, AI, Economics, Weather',
        },
        is_active: { type: 'boolean', description: 'Whether your Shikigami is currently active and trading' },
      },
    },
  },

  // ── Write tools (require ONMYO_MNEMONIC) ────────────────────────────────────
  {
    name: 'bet',
    description: 'Place a YES or NO bet on a prediction market. Requires ONMYO_MNEMONIC to be set.',
    inputSchema: {
      type: 'object',
      properties: {
        market_id: { type: 'number', description: 'Market ID to bet on' },
        side: { type: 'string', enum: ['yes', 'no'], description: 'Which side to bet on' },
        amount_usdt: { type: 'number', description: 'Amount to bet in USDT (e.g. 10 = $10)' },
      },
      required: ['market_id', 'side', 'amount_usdt'],
    },
  },
  {
    name: 'claim_winnings',
    description: 'Claim winnings from a resolved market. Requires ONMYO_MNEMONIC.',
    inputSchema: {
      type: 'object',
      properties: {
        market_id: { type: 'number', description: 'Market ID to claim from' },
      },
      required: ['market_id'],
    },
  },
  {
    name: 'batch_claim_winnings',
    description: 'Claim winnings from multiple resolved markets at once. Requires ONMYO_MNEMONIC.',
    inputSchema: {
      type: 'object',
      properties: {
        market_ids: {
          type: 'array',
          items: { type: 'number' },
          description: 'List of market IDs to claim from',
        },
      },
      required: ['market_ids'],
    },
  },

  // ── AuthZ tools ──────────────────────────────────────────────────────────────
  {
    name: 'check_authz',
    description: 'Check if an AuthZ grant exists allowing a bot to trade on behalf of a user',
    inputSchema: {
      type: 'object',
      properties: {
        granter_address: { type: 'string', description: 'The user\'s wallet address' },
        grantee_address: { type: 'string', description: 'The bot\'s wallet address' },
      },
      required: ['granter_address', 'grantee_address'],
    },
  },
]

// ── MCP Server ────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'onmyo-toba', version: '1.1.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  const opts = { network: NETWORK }

  try {
    let result

    switch (name) {
      // ── Read ──────────────────────────────────────────────────────────────
      case 'get_open_markets': {
        const { category, type, asset, sport, limit, direction } = args || {}
        const filters = {}
        if (category) filters.category = category
        if (type) filters.type = type
        if (asset) filters.asset = asset
        if (sport) filters.sport = sport
        if (direction) filters.direction = direction
        const markets = await getOpenMarkets(filters, { ...opts, limit: limit || 50 })
        result = {
          count: markets.length,
          markets: markets.map(m => ({
            id: m.id,
            question: m.question,
            category: m.category,
            yesOdds: m.yesOdds,
            noOdds: m.noOdds,
            totalVolume: m.totalVolume,
            endsAt: m.endsAt,
            endsInSeconds: m.endsInSeconds,
            bySpirit: m.bySpirit,
            meta: m.meta,
          }))
        }
        break
      }

      case 'get_market': {
        result = await getMarket(args.id, opts)
        break
      }

      case 'get_market_odds': {
        result = await getMarketOdds(args.id, opts)
        break
      }

      case 'get_market_stats': {
        result = await getMarketStats(args.id, opts)
        break
      }

      case 'get_market_meta': {
        result = await getMarketMeta(args.id, opts)
        break
      }

      case 'get_position': {
        result = await getPosition(args.market_id, args.address, opts)
        break
      }

      case 'get_user_positions': {
        result = await getUserPositions(args.address, opts)
        break
      }

      case 'get_user_stats': {
        result = await getUserStats(args.address, opts)
        break
      }

      case 'get_wallet_balance': {
        result = await getWalletBalance(args.address, opts)
        break
      }

      case 'get_spirit_vault_balance': {
        const balance = await getSpiritVaultBalance(opts)
        result = { spiritVaultBalance: balance, unit: 'USDT' }
        break
      }

      case 'get_bot_address': {
        if (!MNEMONIC) throw new Error('ONMYO_MNEMONIC not set')
        result = { address: getAddressFromMnemonic(MNEMONIC) }
        break
      }

      // ── Shikigami ──────────────────────────────────────────────────────────
      case 'get_shikigami': {
        const REST = NETWORK === 'mainnet'
          ? 'https://sentry.lcd.injective.network'
          : 'https://testnet.sentry.lcd.injective.network'
        const res = await fetch(`${REST}/cosmwasm/wasm/v1/contract/${SHIKIGAMI_REGISTRY}/smart/${Buffer.from(JSON.stringify({ get_shikigami: { owner: args.owner } })).toString('base64')}`)
        const data = await res.json()
        result = data.data || data
        break
      }

      case 'get_shikigami_next_level': {
        const REST = NETWORK === 'mainnet'
          ? 'https://sentry.lcd.injective.network'
          : 'https://testnet.sentry.lcd.injective.network'
        const res = await fetch(`${REST}/cosmwasm/wasm/v1/contract/${SHIKIGAMI_REGISTRY}/smart/${Buffer.from(JSON.stringify({ next_level_threshold: { owner: args.owner } })).toString('base64')}`)
        const data = await res.json()
        result = data.data || data
        break
      }

      case 'get_shikigami_leaderboard': {
        const REST = NETWORK === 'mainnet'
          ? 'https://sentry.lcd.injective.network'
          : 'https://testnet.sentry.lcd.injective.network'
        const res = await fetch(`${REST}/cosmwasm/wasm/v1/contract/${SHIKIGAMI_REGISTRY}/smart/${Buffer.from(JSON.stringify({ weekly_leaderboard: { limit: args.limit || 20 } })).toString('base64')}`)
        const data = await res.json()
        result = data.data || data
        break
      }

      case 'update_bot_wallet': {
        if (!MNEMONIC) throw new Error('ONMYO_MNEMONIC not configured. This must be your OWNER wallet mnemonic, not the bot wallet.')
        const txHash = await executeContract(
          SHIKIGAMI_REGISTRY,
          { update_bot_wallet: { bot_wallet: args.bot_wallet || null } },
          MNEMONIC,
          opts
        )
        result = { success: true, txHash, bot_wallet: args.bot_wallet || null }
        break
      }

      case 'update_shikigami_strategy': {
        if (!MNEMONIC) throw new Error('ONMYO_MNEMONIC not configured.')
        const msg = { update_strategy: {} }
        if (args.strategy_description !== undefined) msg.update_strategy.strategy_description = args.strategy_description
        if (args.risk_style !== undefined) msg.update_strategy.risk_style = args.risk_style
        if (args.categories !== undefined) msg.update_strategy.categories = args.categories
        if (args.is_active !== undefined) msg.update_strategy.is_active = args.is_active
        const txHash = await executeContract(SHIKIGAMI_REGISTRY, msg, MNEMONIC, opts)
        result = { success: true, txHash }
        break
      }

      // ── Write ──────────────────────────────────────────────────────────────
      case 'bet': {
        if (!MNEMONIC) throw new Error('ONMYO_MNEMONIC not configured. Set it in the MCP server env.')
        const txHash = await bet(args.market_id, args.side, args.amount_usdt, MNEMONIC, opts)
        result = { success: true, txHash, marketId: args.market_id, side: args.side, amountUsdt: args.amount_usdt }
        break
      }

      case 'claim_winnings': {
        if (!MNEMONIC) throw new Error('ONMYO_MNEMONIC not configured.')
        const txHash = await claimWinnings(args.market_id, MNEMONIC, opts)
        result = { success: true, txHash, marketId: args.market_id }
        break
      }

      case 'batch_claim_winnings': {
        if (!MNEMONIC) throw new Error('ONMYO_MNEMONIC not configured.')
        result = await batchClaimWinnings(args.market_ids, MNEMONIC, opts)
        break
      }

      // ── AuthZ ──────────────────────────────────────────────────────────────
      case 'check_authz': {
        result = await checkAuthZGrant(args.granter_address, args.grantee_address, opts)
        break
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    }
  }
})

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
console.error(`[Onmyo MCP] Server running on ${NETWORK} | Shikigami registry: ${SHIKIGAMI_REGISTRY}`)
