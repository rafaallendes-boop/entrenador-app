/**
 * Etiquetas y descriptor de la variante experimental del Plan Builder
 * (spec §3.1). El owner bumpea PROMPT/SCHEMA version cuando cambia el prompt
 * del coach o el JSON schema de la semana.
 */

export const PLAN_BUILDER_PROMPT_VERSION = '2026-07-week-v1'
export const PLAN_BUILDER_SCHEMA_VERSION = '2026-07-week-v1'

export interface PlanBuilderVariantDescriptor {
  provider: string
  model: string | null
  effort: string | null
  thinkingMode: string | null
  temperature: number | null
  maxTokens: number | null
  promptVersion: string
  schemaVersion: string
  qualityVersion: 1 | 2
  concurrency: number
}

const KNOWN_MODEL_SHORT: Record<string, string> = {
  'claude-sonnet-4-6': 's46',
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** FNV-1a de 32 bits en base36, 8 chars. Sin dependencias, estable entre corridas. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36).padStart(8, '0').slice(0, 8)
}

/**
 * Dimensiones de la request, sin `qualityVersion`. Es la única fuente de la
 * canonicalización que comparten el variant id y el fingerprint.
 */
function requestDimensions(
  descriptor: PlanBuilderVariantDescriptor,
  qualityVersion?: 1 | 2,
): unknown[] {
  const dimensions: unknown[] = [
    descriptor.provider,
    descriptor.model,
    descriptor.effort,
    descriptor.thinkingMode,
    descriptor.temperature,
    descriptor.maxTokens,
    descriptor.promptVersion,
    descriptor.schemaVersion,
  ]
  if (qualityVersion !== undefined) dimensions.push(qualityVersion)
  dimensions.push(descriptor.concurrency)
  return dimensions
}

/**
 * Identidad de una ventana experimental sin depender de `created_at`
 * (spec §3.1). Prefijo legible + hash de TODAS las dimensiones: cambiar
 * cualquiera cambia el id salvo colisión de hash, altamente improbable a
 * este volumen.
 */
export function buildVariantId(descriptor: PlanBuilderVariantDescriptor): string {
  const modelToken = descriptor.model
    ? KNOWN_MODEL_SHORT[descriptor.model] ?? slugify(descriptor.model)
    : 'unknown'
  // qualityVersion se inserta antes de concurrency para preservar el orden
  // histórico que produjo el variant id del control versionado.
  const canonical = JSON.stringify(requestDimensions(descriptor, descriptor.qualityVersion))
  return `${modelToken}-q${descriptor.qualityVersion}-${fnv1a(canonical)}`
}

/**
 * Identidad de la request, deliberadamente sin `qualityVersion`. El control se
 * generó con q1 antes de activar q2; este fingerprint permite verificar que las
 * demás dimensiones siguen siendo idénticas a través del flip.
 */
export function buildRequestFingerprint(descriptor: PlanBuilderVariantDescriptor): string {
  return fnv1a(JSON.stringify(requestDimensions(descriptor)))
}
