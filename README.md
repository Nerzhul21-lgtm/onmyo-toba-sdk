# Onmyō Toba SDK

**Official SDK for building AI bots, trading agents, and Shikigami on Onmyō Toba prediction markets — Injective blockchain**

[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](https://opensource.org/licenses/MIT)
[![Network: Injective](https://img.shields.io/badge/Network-Injective-blue.svg)](https://injective.com)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-green.svg)](https://modelcontextprotocol.io)

---

## What is Onmyō Toba?

Onmyō Toba is a gamified prediction market on Injective blockchain. Users predict YES or NO on real-world events (crypto prices, sports, politics, weather, AI milestones) and earn USDT rewards. The platform features a prestige/rank system, Shikigami AI agents, clan mechanics, and weekly reward distributions.

- **Live testnet:** [onmyo-toba.vercel.app](https://onmyo-toba.vercel.app)
- **Chain:** Injective (injective-888 testnet / injective-1 mainnet)
- **Smart contracts:** CosmWasm

---

## Quick Start

```bash
# Clone the SDK
git clone https://github.com/Nerzhul21-lgtm/onmyo-toba-sdk
cd onmyo-toba-sdk

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# Edit .env with your mnemonic
```

```javascript
import { getOpenMarkets, bet, watchNewMarkets } from './index.js'

// Get all open BTC price markets
const markets = await getOpenMarkets({ type: 'price', asset: 'BTC' })
console.log(`Found ${markets.length} BTC markets`)

// Place a YES bet on market #1
const txHash = await bet(1, 'yes', 10, process.env.ONMYO_MNEMONIC)
console.log('TX:', txHash)

// Stream new markets in real-time
const stop = watchNewMarkets({ type: 'price', asset: 'BTC' }, async (market) => {
  console.log('New BTC market:', market.question)
  console.log('Current odds:', market.yesOdds, '/', market.noOdds)
})

// Later: stop.() to disconnect
```

---

## Market Metadata Standard

Every market has structured machine-readable metadata embedded in its description. This allows bots to filter and identify markets programmatically without parsing natural language.

**Format:** `description text\n__meta__:{"type":"price","asset":"BTC",...}`

**Market Types:**

| Type | Fields | Example |
|------|--------|---------|
| `price` | asset, direction, target, source | Will BTC be above $95,000? |
| `sports` | sport, team_a, team_b, event | Will Real Madrid win? |
| `weather` | city, metric, direction, target, unit | Will London rain > 10mm? |
| `politics` | region, subject, event | Will X win the election? |
| `ai` | subject, milestone | Will OpenAI release GPT-5? |
| `economics` | metric, direction, target, source | Will crypto market cap > $3T? |
| `general` | — | Anything else |

---

## API Reference

### Query Functions (no wallet required)

```javascript
// Get open markets with optional filters
getOpenMarkets({ category?, type?, asset?, sport?, direction? }, { network?, limit? })

// Get all markets (open + resolved)
getAllMarkets({ network?, resolved?, category?, limit? })

// Get single market by ID
getMarket(id, { network? })

// Get current odds (returns { yes, no, yesPrice, noPrice, totalVolume, endsInSeconds })
getMarketOdds(id, { network? })

// Get trading stats (volume, yes%, liquidity)
getMarketStats(id, { network? })

// Get parsed __meta__ object for a market
getMarketMeta(id, { network? })

// Get a position in a market
getPosition(marketId, address, { network? })

// Get all positions for a wallet
getUserPositions(address, { network?, limit? })

// Get user prestige, rank, win rate, streak
getUserStats(address, { network? })

// Get USDT + INJ balances
getWalletBalance(address, { network? })

// Get Spirit Vault USDT balance
getSpiritVaultBalance({ network? })

// Get contract configuration
getContractConfig({ network? })
```

### Execute Functions (wallet mnemonic required)

```javascript
// Place a YES or NO bet
bet(marketId, 'yes'|'no', amountUsdt, mnemonic, { network? })

// Claim winnings from resolved market
claimWinnings(marketId, mnemonic, { network? })

// Claim from multiple markets
batchClaimWinnings([marketId, ...], mnemonic, { network?, delayMs? })

// Create a new market (costs 5 USDT, refunded at $1,000 volume)
createMarket({ question, description, category, endTime, meta? }, mnemonic, { network? })

// Get wallet address from mnemonic
getAddressFromMnemonic(mnemonic)
```

### AuthZ — Delegated Execution

Allows a bot to trade on behalf of a user without Keplr popups per transaction.

```javascript
// User grants permission to bot (sign once with user mnemonic)
grantAuthZ(botAddress, { network?, expirationDays? }, granterMnemonic)

// User revokes permission
revokeAuthZ(botAddress, granterMnemonic, { network? })

// Bot places bet on behalf of user (bot signs, user's USDT used)
betAsGrantee(marketId, 'yes'|'no', amountUsdt, granterAddress, granteeMnemonic, { network? })

// Bot claims winnings on behalf of user
claimAsGrantee(marketId, granterAddress, granteeMnemonic, { network? })

// Check if grant exists
checkAuthZGrant(granterAddress, granteeAddress, { network? })
```

### Real-time Streaming (WebSocket)

```javascript
// Watch all contract events
watchAll(callback(eventType, data), { network? })
// eventType: 'new_market' | 'bet_placed' | 'market_resolved' | 'winnings_claimed'

// Watch only new markets matching filters
watchNewMarkets({ type?, asset?, sport?, category? }, callback(market), { network? })

// Watch odds changes for a specific market
watchMarket(marketId, callback(oddsUpdate), { network? })

// Watch for market resolutions
watchResolutions(callback(event), { network?, marketIds? })

// Get in-memory odds history (populated while streaming)
getOddsHistory(marketId, maxPoints?)

// Initialize odds history by sampling
initOddsHistory(marketId, { network?, samples?, intervalMs? })

// Stop all WebSocket connections
stopAllWatchers()
```

All watch functions return a `stop()` function to close the connection.

### Historical Data (Indexer API)

```javascript
// Get contract transaction history
getContractTransactions({ network?, limit?, from?, to? })

// Get all bets for a specific market
getMarketBetHistory(marketId, { network?, limit? })

// Get a user's full betting history
getUserBetHistory(address, { network?, limit? })

// Reconstruct odds timeline from bet history
getOddsTimeline(marketId, { network?, limit? })
```

### Metadata Utilities

```javascript
// Parse __meta__ from description
parseMeta(description) // → { type, asset, ... } or { type: 'general' }

// Get human-readable description (without meta block)
parseDescription(description)

// Build meta string to append
buildMeta({ type: 'price', asset: 'BTC', direction: 'above', target: 95000 })

// Build full description with meta embedded
buildDescription(description, metaObject)

// Filter markets array by meta fields
filterByMeta(markets, { type?, asset?, sport?, ... })
```

---

## Examples

### Basic Polling Bot

```bash
ONMYO_MNEMONIC="your mnemonic" node examples/basic-bot.js
```

Polls for markets every 5 minutes, applies a value-betting strategy, claims winnings.

### Real-time Streaming Bot

```bash
ONMYO_MNEMONIC="your mnemonic" node examples/streaming-bot.js
```

Reacts instantly when new price markets open. Perfect for BTC 5-minute markets.

### AuthZ Delegated Bot (Shikigami)

```bash
# Step 1: User grants permission (run once)
GRANTER_MNEMONIC="user mnemonic" GRANTEE_ADDRESS="inj1bot..." node examples/authz-bot.js --grant

# Step 2: Run the bot autonomously
BOT_MNEMONIC="bot mnemonic" GRANTER_ADDRESS="inj1user..." node examples/authz-bot.js
```

---

## MCP Server (AI Agent Integration)

The SDK includes an MCP (Model Context Protocol) server that allows AI agents and LLMs to interact with Onmyō Toba markets using natural language.

**Compatible with:** Claude Desktop, Cursor, LangChain, CrewAI, any MCP client

### Setup

```bash
# Start the MCP server
ONMYO_NETWORK=testnet ONMYO_MNEMONIC="your mnemonic" node mcp-server.js
```

**Add to Claude Desktop** (`%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "onmyo-toba": {
      "command": "node",
      "args": ["C:/path/to/onmyo-toba-sdk/mcp-server.js"],
      "env": {
        "ONMYO_NETWORK": "testnet",
        "ONMYO_MNEMONIC": "your mnemonic here"
      }
    }
  }
}
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `get_open_markets` | List all open markets with filters |
| `get_market` | Get market details by ID |
| `get_market_odds` | Get current YES/NO probabilities |
| `get_market_stats` | Get volume and liquidity data |
| `get_market_meta` | Get structured metadata |
| `get_position` | Get a wallet's position |
| `get_user_positions` | Get all positions for a wallet |
| `get_user_stats` | Get prestige, rank, win rate |
| `get_wallet_balance` | Get USDT and INJ balances |
| `get_spirit_vault_balance` | Get Spirit Vault USDT balance |
| `get_bot_address` | Get bot's wallet address |
| `bet` | Place a YES or NO bet |
| `claim_winnings` | Claim from resolved market |
| `batch_claim_winnings` | Claim from multiple markets |
| `check_authz` | Check AuthZ grant status |

### Example Claude Conversation

Once the MCP server is connected to Claude Desktop:

> "Show me all open BTC price markets"
> → Claude calls `get_open_markets` with `{ type: 'price', asset: 'BTC' }`

> "What are the odds on market 42?"
> → Claude calls `get_market_odds` with `{ id: 42 }`

> "Bet $10 YES on market 42"
> → Claude calls `bet` with `{ market_id: 42, side: 'yes', amount_usdt: 10 }`

---

## Network Configuration

| Setting | Testnet | Mainnet |
|---------|---------|---------|
| Chain ID | injective-888 | injective-1 |
| REST | testnet.sentry.lcd.injective.network | sentry.lcd.injective.network |
| WebSocket | wss://testnet.sentry.tm.injective.network:443/websocket | wss://sentry.tm.injective.network:443/websocket |
| Market Manager | inj1x5kyku4mnjxraqxd9mse97k4e4zgxd6zp45jxc | TBD (mainnet) |

---

## Porting Your Polymarket Bot

If you have an existing Polymarket bot, porting to Onmyō Toba is straightforward:

| Polymarket | Onmyō Toba SDK |
|------------|----------------|
| `GET /markets` | `getOpenMarkets()` |
| `GET /markets/{id}` | `getMarket(id)` |
| Market outcome prices | `getMarketOdds(id)` → `{ yes, no }` |
| Place order | `bet(marketId, 'yes'\|'no', amount, mnemonic)` |
| Get user orders | `getUserPositions(address)` |
| Settlement | `claimWinnings(marketId, mnemonic)` |

**Key difference:** Onmyō Toba uses USDT on Injective. No order book — you buy YES/NO shares directly. Prices reflect crowd probability (0.00 to 1.00).

---

## Shikigami — Registering Your Bot

Shikigami are on-chain registered trading strategies on Onmyō Toba. Your bot's track record is verified by the blockchain — every bet, every win, every loss is immutable and auditable.

Once the Shikigami registry contract is live:
1. Your bot's Injective address is registered as a Shikigami
2. All bets placed by that address are tracked on-chain
3. Win rate and profits are calculated automatically
4. Your Shikigami levels up as profits grow
5. Other users can see your performance and rent your strategy

*Rental marketplace coming in Phase 2.*

---

## License

MIT — free to use, modify, and distribute. See [LICENSE](LICENSE) for details.

---

*Built on Injective · Shadow House of Prophecy · 影の予言の家*
