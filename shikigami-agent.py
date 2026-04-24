"""
Onmyō Toba — Shikigami Agent (LangChain Multi-LLM Template)
============================================================

This script runs your Shikigami AI trading agent on Onmyō Toba prediction markets.
It connects the Onmyō Toba MCP server to your chosen LLM and trades autonomously.

SUPPORTED LLMs:
  - Claude (Anthropic)   — set LLM_PROVIDER=claude
  - GPT-4 (OpenAI)       — set LLM_PROVIDER=openai
  - Gemini (Google)      — set LLM_PROVIDER=gemini
  - Local (Ollama)       — set LLM_PROVIDER=ollama

SETUP:
  1. Install dependencies:
       pip install langchain langchain-mcp-adapters langchain-anthropic langchain-openai langchain-google-genai python-dotenv

  2. Copy .env.example to .env and fill in your values

  3. Run:
       python shikigami-agent.py

The agent will:
  - Check your wallet balance
  - Scan open markets matching your Shikigami's categories
  - Evaluate YES/NO odds and market metadata
  - Place bets based on your risk style
  - Claim winnings from resolved markets
  - Sleep and repeat every TRADE_INTERVAL_MINUTES
"""

import asyncio
import os
import json
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# ── Configuration ─────────────────────────────────────────────────────────────

LLM_PROVIDER        = os.getenv("LLM_PROVIDER", "claude")          # claude | openai | gemini | ollama
ANTHROPIC_API_KEY   = os.getenv("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY      = os.getenv("OPENAI_API_KEY", "")
GOOGLE_API_KEY      = os.getenv("GOOGLE_API_KEY", "")
OLLAMA_MODEL        = os.getenv("OLLAMA_MODEL", "llama3")           # model name for ollama
OLLAMA_BASE_URL     = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

ONMYO_NETWORK       = os.getenv("ONMYO_NETWORK", "testnet")        # testnet | mainnet
ONMYO_MNEMONIC      = os.getenv("ONMYO_MNEMONIC", "")              # your bot wallet mnemonic
SHIKIGAMI_OWNER     = os.getenv("SHIKIGAMI_OWNER", "")             # your Keplr wallet address

RISK_STYLE          = os.getenv("RISK_STYLE", "balanced")          # conservative | balanced | aggressive
CATEGORIES          = os.getenv("CATEGORIES", "Crypto,Sports").split(",")
MAX_BET_USDT        = float(os.getenv("MAX_BET_USDT", "10"))       # max bet per market in USDT
MIN_WALLET_RESERVE  = float(os.getenv("MIN_WALLET_RESERVE", "20")) # never bet below this balance
TRADE_INTERVAL_MIN  = int(os.getenv("TRADE_INTERVAL_MINUTES", "60"))
MCP_SERVER_PATH     = os.getenv("MCP_SERVER_PATH", "./mcp-server.js")

# ── Risk profiles ─────────────────────────────────────────────────────────────

RISK_PROFILES = {
    "conservative": {
        "min_odds_edge": 0.15,   # only bet if our side has 65%+ odds
        "max_bet_pct": 0.05,     # max 5% of balance per bet
        "description": "Only high-confidence markets. Smaller bets. Steady compounding.",
    },
    "balanced": {
        "min_odds_edge": 0.08,   # bet if our side has 58%+ odds
        "max_bet_pct": 0.10,     # max 10% of balance per bet
        "description": "Mix of safe and moderate plays. Standard sizing.",
    },
    "aggressive": {
        "min_odds_edge": 0.03,   # bet on anything with slight edge
        "max_bet_pct": 0.20,     # max 20% of balance per bet
        "description": "High conviction plays. Larger sizing. Higher variance.",
    },
}

profile = RISK_PROFILES.get(RISK_STYLE, RISK_PROFILES["balanced"])

# ── System prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = f"""You are a Shikigami — an autonomous AI prediction market trading agent 
operating on Onmyō Toba, a decentralized prediction market platform on Injective blockchain.

Your owner's Shikigami profile:
- Owner address: {SHIKIGAMI_OWNER}
- Risk style: {RISK_STYLE}
- Focus categories: {', '.join(CATEGORIES)}
- Strategy: {profile['description']}
- Max bet per market: ${MAX_BET_USDT} USDT
- Min wallet reserve (never go below): ${MIN_WALLET_RESERVE} USDT

Your trading rules:
1. ALWAYS check wallet balance first. If below ${MIN_WALLET_RESERVE} USDT, stop trading and report low balance.
2. Scan open markets filtered by your categories: {', '.join(CATEGORIES)}
3. For each market, check odds and metadata. Only bet if the edge is >= {profile['min_odds_edge']*100:.0f}%.
4. Bet size = min(MAX_BET, balance * {profile['max_bet_pct']*100:.0f}%) rounded to 2 decimal places.
5. Prefer markets with higher volume (more liquidity = fairer pricing).
6. For price markets: use market metadata to check if current price trend supports YES or NO.
7. ALWAYS claim winnings from resolved markets before placing new bets.
8. Log every action with market ID, side, amount, and reasoning.
9. Never bet more than once per market unless your position was already claimed.
10. If unsure, skip the market. Capital preservation > aggressive returns.

After each trading session, provide a summary:
- Markets scanned
- Bets placed (market ID, side, amount, reasoning)
- Winnings claimed
- Current wallet balance
- Next scheduled run
"""

# ── LLM setup ─────────────────────────────────────────────────────────────────

def get_llm():
    if LLM_PROVIDER == "claude":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model="claude-sonnet-4-20250514",
            api_key=ANTHROPIC_API_KEY,
            max_tokens=4096,
        )
    elif LLM_PROVIDER == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model="gpt-4o",
            api_key=OPENAI_API_KEY,
            max_tokens=4096,
        )
    elif LLM_PROVIDER == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            model="gemini-2.0-flash",
            google_api_key=GOOGLE_API_KEY,
            max_tokens=4096,
        )
    elif LLM_PROVIDER == "ollama":
        from langchain_community.chat_models import ChatOllama
        return ChatOllama(
            model=OLLAMA_MODEL,
            base_url=OLLAMA_BASE_URL,
        )
    else:
        raise ValueError(f"Unknown LLM_PROVIDER: {LLM_PROVIDER}. Choose: claude, openai, gemini, ollama")

# ── Agent ─────────────────────────────────────────────────────────────────────

async def run_trading_session():
    from langchain_mcp_adapters.client import MultiServerMCPClient
    from langchain.agents import create_react_agent, AgentExecutor
    from langchain.prompts import ChatPromptTemplate

    print(f"\n{'='*60}")
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Shikigami awakens...")
    print(f"Network: {ONMYO_NETWORK} | LLM: {LLM_PROVIDER} | Risk: {RISK_STYLE}")
    print(f"Categories: {', '.join(CATEGORIES)}")
    print(f"{'='*60}\n")

    if not ONMYO_MNEMONIC:
        print("ERROR: ONMYO_MNEMONIC not set in .env — cannot trade")
        return

    if not SHIKIGAMI_OWNER:
        print("ERROR: SHIKIGAMI_OWNER not set in .env — set your Keplr wallet address")
        return

    async with MultiServerMCPClient({
        "onmyo-toba": {
            "command": "node",
            "args": [MCP_SERVER_PATH],
            "transport": "stdio",
            "env": {
                "ONMYO_NETWORK": ONMYO_NETWORK,
                "ONMYO_MNEMONIC": ONMYO_MNEMONIC,
            }
        }
    }) as client:
        tools = await client.get_tools()
        llm = get_llm()

        # Build the trading prompt
        trading_prompt = f"""
Execute a trading session for my Shikigami on Onmyō Toba.

Steps:
1. Get my wallet balance using get_wallet_balance for address {SHIKIGAMI_OWNER}
2. Get my Shikigami profile using get_shikigami for owner {SHIKIGAMI_OWNER}
3. Get my current positions using get_user_positions for {SHIKIGAMI_OWNER}
4. Claim any winnings from resolved markets
5. Scan open markets filtered by categories: {', '.join(CATEGORIES)}
6. For each promising market, get odds and metadata
7. Place bets following the risk rules in your system prompt
8. Report a trading session summary

Today's date/time: {datetime.now().strftime('%Y-%m-%d %H:%M UTC')}
"""

        prompt = ChatPromptTemplate.from_messages([
            ("system", SYSTEM_PROMPT),
            ("human", "{input}"),
            ("placeholder", "{agent_scratchpad}"),
        ])

        agent = create_react_agent(llm, tools, prompt)
        executor = AgentExecutor(
            agent=agent,
            tools=tools,
            verbose=True,
            max_iterations=30,
            handle_parsing_errors=True,
        )

        result = await executor.ainvoke({"input": trading_prompt})
        print(f"\n{'='*60}")
        print("SESSION COMPLETE")
        print(f"{'='*60}")
        print(result.get("output", "No output"))

# ── Main loop ─────────────────────────────────────────────────────────────────

async def main():
    print(f"""
╔══════════════════════════════════════════════╗
║        ONMYŌ TOBA — SHIKIGAMI AGENT          ║
║    Autonomous Prediction Market Trader       ║
╚══════════════════════════════════════════════╝

LLM Provider  : {LLM_PROVIDER.upper()}
Network       : {ONMYO_NETWORK}
Risk Style    : {RISK_STYLE}
Categories    : {', '.join(CATEGORIES)}
Max Bet       : ${MAX_BET_USDT} USDT
Interval      : Every {TRADE_INTERVAL_MIN} minutes
""")

    while True:
        try:
            await run_trading_session()
        except KeyboardInterrupt:
            print("\n[Shikigami returns to slumber]")
            break
        except Exception as e:
            print(f"\nSession error: {e}")
            print("Retrying next interval...")

        print(f"\nSleeping {TRADE_INTERVAL_MIN} minutes until next session...")
        await asyncio.sleep(TRADE_INTERVAL_MIN * 60)

if __name__ == "__main__":
    asyncio.run(main())
