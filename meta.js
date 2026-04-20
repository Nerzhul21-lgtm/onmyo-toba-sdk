/**
 * Onmyō Toba SDK — Market Metadata
 *
 * All markets embed structured machine-readable metadata at the end
 * of their description field using the __meta__: separator.
 *
 * Example description:
 *   "Resolves YES if BTC closes above $95,000 on CoinGecko.\n__meta__:{"type":"price","asset":"BTC","direction":"above","target":95000,"source":"CoinGecko"}"
 */

/** Parse __meta__ from a market description string */
export function parseMeta(description) {
  if (!description) return { type: 'general' }
  const parts = description.split('\n__meta__:')
  if (parts.length < 2) return { type: 'general' }
  try {
    return JSON.parse(parts[1].trim())
  } catch {
    return { type: 'general' }
  }
}

/** Extract the human-readable description (without meta block) */
export function parseDescription(description) {
  if (!description) return ''
  return description.split('\n__meta__:')[0].trim()
}

/**
 * Build a meta string to append to a description
 * @param {object} meta - structured metadata object
 * @returns {string} - formatted meta block to append
 */
export function buildMeta(meta) {
  return `\n__meta__:${JSON.stringify(meta)}`
}

/**
 * Build a full description with embedded meta
 * @param {string} description - human-readable description
 * @param {object} meta - structured metadata
 */
export function buildDescription(description, meta) {
  const base = parseDescription(description)
  return base + buildMeta(meta)
}

/**
 * Market type definitions and their required fields
 */
export const MARKET_TYPES = {
  price: {
    label: 'Price Market',
    fields: ['asset', 'direction', 'target', 'source'],
    description: 'Resolves based on asset price crossing a threshold',
  },
  sports: {
    label: 'Sports Market',
    fields: ['sport', 'team_a', 'team_b', 'event'],
    description: 'Resolves based on a sporting event outcome',
  },
  weather: {
    label: 'Weather Market',
    fields: ['city', 'metric', 'direction', 'target', 'unit'],
    description: 'Resolves based on weather measurements',
  },
  politics: {
    label: 'Politics Market',
    fields: ['region', 'subject', 'event'],
    description: 'Resolves based on political events',
  },
  ai: {
    label: 'AI / Tech Market',
    fields: ['subject', 'milestone'],
    description: 'Resolves based on AI or tech industry milestones',
  },
  economics: {
    label: 'Economics Market',
    fields: ['metric', 'direction', 'target', 'source'],
    description: 'Resolves based on economic indicators',
  },
  general: {
    label: 'General Market',
    fields: [],
    description: 'General prediction market',
  },
}

/**
 * Filter markets by meta fields
 * @param {Array} markets - array of market objects with parsed meta
 * @param {object} filters - { type?, asset?, sport?, direction?, ... }
 */
export function filterByMeta(markets, filters = {}) {
  if (!filters || Object.keys(filters).length === 0) return markets

  return markets.filter(market => {
    const meta = market.meta || parseMeta(market.description)
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null) continue
      if (key === 'type' && meta.type !== value) return false
      if (key === 'asset' && meta.asset?.toUpperCase() !== value.toUpperCase()) return false
      if (key === 'sport' && meta.sport?.toLowerCase() !== value.toLowerCase()) return false
      if (key === 'direction' && meta.direction !== value) return false
      if (key === 'minTarget' && meta.target < value) return false
      if (key === 'maxTarget' && meta.target > value) return false
    }
    return true
  })
}
