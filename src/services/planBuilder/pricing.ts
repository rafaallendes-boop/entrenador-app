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
  /**
   * Tier de servicio al que aplica la fila. `undefined` es el tier estándar.
   *
   * No es un adorno: `OPENAI_SERVICE_TIER_WEEK_CREATOR=priority` está definido en
   * producción, y ese tier cuesta ~1,75× el estándar para el mismo `model`. Sin
   * esta clave, las dos corridas serían indistinguibles en la tabla y el costo de
   * `week_creator` quedaría subestimado en ~75%.
   */
  serviceTier?: string
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

  // --- Verificados contra las páginas oficiales el 2026-08-09 ---
  //
  // `effectiveFrom` es la fecha de VERIFICACIÓN, no la de vigencia real del
  // precio, que no consta. Como el costo se calcula al escribir la fila, esto
  // solo afecta hacia adelante: las filas que `018` ya guardó con `null` siguen
  // en `null`, y eso es correcto —`null` nunca significa cero—.

  /**
   * Chat general y de acción, resumen semanal e import. Es la ruta de MAYOR
   * volumen del producto y hasta ahora no tenía precio, así que el 100% de sus
   * filas en `coach_requests` guardaba `estimated_cost_usd = null`.
   *
   * Gemini no cobra por escribir caché —cobra almacenamiento por hora, que no es
   * por token—, y `coach.ts` no usa caché explícito, así que la escritura va en 0.
   */
  {
    model: 'gemini-2.5-flash',
    effectiveFrom: '2026-08-09',
    effectiveTo: null,
    inputUsdPerMTok: 0.3,
    outputUsdPerMTok: 2.5,
    cacheReadUsdPerMTok: 0.03,
    cacheWriteUsdPerMTok: 0,
  },

  /**
   * `week_creator`. Las dos filas conviven a propósito: producción corre el tier
   * `priority`, pero apagar la env var debe seguir dando un costo correcto en vez
   * de caer a `null`.
   */
  {
    model: 'gpt-4.1-mini',
    effectiveFrom: '2026-08-09',
    effectiveTo: null,
    inputUsdPerMTok: 0.4,
    outputUsdPerMTok: 1.6,
    cacheReadUsdPerMTok: 0.1,
    cacheWriteUsdPerMTok: 0,
  },
  {
    model: 'gpt-4.1-mini',
    serviceTier: 'priority',
    effectiveFrom: '2026-08-09',
    effectiveTo: null,
    inputUsdPerMTok: 0.7,
    outputUsdPerMTok: 2.8,
    cacheReadUsdPerMTok: 0.175,
    cacheWriteUsdPerMTok: 0,
  },

  /** Fallback de las clases OpenAI sin modelo propio. Hoy ninguna clase lo usa. */
  {
    model: 'gpt-5-mini',
    effectiveFrom: '2026-08-09',
    effectiveTo: null,
    inputUsdPerMTok: 0.25,
    outputUsdPerMTok: 2,
    cacheReadUsdPerMTok: 0.025,
    cacheWriteUsdPerMTok: 0,
  },
]

/**
 * El tier tiene que coincidir EXACTAMENTE, incluido el caso `undefined`.
 *
 * Un match laxo —caer al estándar cuando el tier pedido no está en la tabla—
 * devolvería un número plausible y equivocado. Es preferible `null`, que el
 * contrato ya define como «precio no disponible» y que toda agregación excluye,
 * antes que un costo que nadie va a poder auditar después.
 */
function findPrice(model: string, at: number, serviceTier?: string): ModelPrice | null {
  for (const price of MODEL_PRICES) {
    if (price.model !== model) continue
    if (price.serviceTier !== serviceTier) continue
    const fromMs = Date.parse(`${price.effectiveFrom}T00:00:00Z`)
    const toMs = price.effectiveTo ? Date.parse(`${price.effectiveTo}T23:59:59.999Z`) : Number.POSITIVE_INFINITY
    if (at >= fromMs && at <= toMs) return price
  }
  return null
}

export function estimateCostUsd(input: {
  model: string
  at: number
  serviceTier?: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}): number | null {
  const price = findPrice(input.model, input.at, input.serviceTier)
  if (!price) return null
  return (
    (input.inputTokens / MTOK) * price.inputUsdPerMTok +
    (input.outputTokens / MTOK) * price.outputUsdPerMTok +
    (input.cacheReadTokens / MTOK) * price.cacheReadUsdPerMTok +
    (input.cacheCreationTokens / MTOK) * price.cacheWriteUsdPerMTok
  )
}
