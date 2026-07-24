/**
 * Precios por modelo, **fechados** (spec §5.4). Sin fecha, el costo de Fase 3
 * quedaría mal al expirar un precio introductorio.
 *
 * IMPORTANTE (owner): verificar estos valores contra la página oficial de
 * precios de Anthropic (o la skill `claude-api`) antes de confiar en
 * `estimated_cost_usd`. USD por 1.000.000 de tokens.
 */

export interface ModelPrice {
  model: string
  effectiveFrom: string
  effectiveTo: string | null
  inputUsdPerMTok: number
  outputUsdPerMTok: number
  cacheReadUsdPerMTok: number
  cacheWriteUsdPerMTok: number
}

const MTOK = 1_000_000

export const MODEL_PRICES: ModelPrice[] = [
  {
    model: 'claude-sonnet-4-6',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    inputUsdPerMTok: 3,
    outputUsdPerMTok: 15,
    cacheReadUsdPerMTok: 0.3,
    cacheWriteUsdPerMTok: 3.75,
  },
]

function findPrice(model: string, at: number): ModelPrice | null {
  for (const price of MODEL_PRICES) {
    if (price.model !== model) continue
    const fromMs = Date.parse(`${price.effectiveFrom}T00:00:00Z`)
    const toMs = price.effectiveTo ? Date.parse(`${price.effectiveTo}T23:59:59.999Z`) : Number.POSITIVE_INFINITY
    if (at >= fromMs && at <= toMs) return price
  }
  return null
}

export function estimateCostUsd(input: {
  model: string
  at: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}): number | null {
  const price = findPrice(input.model, input.at)
  if (!price) return null
  return (
    (input.inputTokens / MTOK) * price.inputUsdPerMTok +
    (input.outputTokens / MTOK) * price.outputUsdPerMTok +
    (input.cacheReadTokens / MTOK) * price.cacheReadUsdPerMTok +
    (input.cacheCreationTokens / MTOK) * price.cacheWriteUsdPerMTok
  )
}
