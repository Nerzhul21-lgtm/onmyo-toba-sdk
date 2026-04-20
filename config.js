/**
 * Onmyō Toba SDK — Network Configuration
 * Supports testnet (injective-888) and mainnet (injective-1)
 */

export const NETWORKS = {
  testnet: {
    chainId: 'injective-888',
    rest: 'https://testnet.sentry.lcd.injective.network',
    rpc: 'https://testnet.sentry.tm.injective.network:443',
    grpc: 'https://testnet.sentry.chain.grpc-web.injective.network:443',
    ws: 'wss://testnet.sentry.tm.injective.network:443/websocket',
    indexer: 'https://testnet.sentry.exchange.grpc-web.injective.network',
    explorer: 'https://testnet.explorer.injective.network',
    usdtDenom: 'peggy0x87aB3B4C8661e07D6372361211B96ed4Dc36B1B5',
    contracts: {
      marketManager: 'inj1x5kyku4mnjxraqxd9mse97k4e4zgxd6zp45jxc',
      userProgression: 'inj1phxphum7s6ldxe5awns4mm9pve6qp88qn04jpw',
      feeDistribution: 'inj16hvv0etk3ctv204zu44fay0p2hd0nw327zvxps',
      talismanNft: 'inj16tku4f256kzw3sdhna8ergqauceg5munm2tprl',
      clanManager: 'inj139y23m55lpqf20rje4xav3wqplf4cr3tn3lfv0',
    },
    spiritVault: 'inj198e7sg3974hujnhac78jwfs0sj0m3f2s9htp6x',
  },
  mainnet: {
    chainId: 'injective-1',
    rest: 'https://sentry.lcd.injective.network',
    rpc: 'https://sentry.tm.injective.network:443',
    grpc: 'https://sentry.chain.grpc-web.injective.network:443',
    ws: 'wss://sentry.tm.injective.network:443/websocket',
    indexer: 'https://sentry.exchange.grpc-web.injective.network',
    explorer: 'https://explorer.injective.network',
    usdtDenom: 'peggy0xdAC17F958D2ee523a2206206994597C13D831ec7',
    contracts: {
      // TODO: Set after mainnet deployment
      marketManager: '',
      userProgression: '',
      feeDistribution: '',
      talismanNft: '',
      clanManager: '',
    },
    spiritVault: '',
  },
}

/**
 * Get network config
 * @param {'testnet'|'mainnet'} network
 */
export function getNetwork(network = 'testnet') {
  const config = NETWORKS[network]
  if (!config) throw new Error(`Unknown network: ${network}. Use 'testnet' or 'mainnet'`)
  return config
}

/** Convert USDT display amount to base units (6 decimals) */
export function toUSDTBase(amount) {
  return Math.floor(amount * 1_000_000)
}

/** Convert USDT base units to display amount */
export function fromUSDTBase(amount) {
  return parseInt(amount) / 1_000_000
}

/** Convert INJ base units to display amount (18 decimals) */
export function fromINJBase(amount) {
  return parseInt(amount) / 1e18
}
