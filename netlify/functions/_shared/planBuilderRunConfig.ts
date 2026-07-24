import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  normalizePlanBuilderConcurrency,
} from '../../../src/services/planBuilder/asyncGenerationLoop'
import { PRODUCTIVE_QUALITY_VERSION } from '../../../src/services/planBuilder/qualityReview'
import {
  PLAN_BUILDER_PROMPT_VERSION,
  PLAN_BUILDER_SCHEMA_VERSION,
  type PlanBuilderVariantDescriptor,
} from '../../../src/services/planBuilder/telemetryVersions'

const DEFAULT_PLAN_BUILDER_MODEL = 'claude-sonnet-4-6'

export function resolvePlanBuilderModel(env: NodeJS.ProcessEnv): string {
  return env['CLAUDE_MODEL_PLAN_BUILDER_WEEK'] ?? env['CLAUDE_MODEL'] ?? DEFAULT_PLAN_BUILDER_MODEL
}

function resolveRawConcurrency(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env['PLAN_BUILDER_WEEK_CONCURRENCY']
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

/**
 * Única fuente de la config efectiva enviada a Anthropic. `effort`/`thinkingMode`
 * son `'omitted'` porque hoy la request no los incluye; cambiarlos aquí (y en el
 * caller) mantiene la telemetría fiel sin tocar dos lugares.
 */
export function resolveEffectivePlanBuilderConfig(env: NodeJS.ProcessEnv): PlanBuilderVariantDescriptor {
  return {
    provider: 'claude',
    model: resolvePlanBuilderModel(env),
    effort: 'omitted',
    thinkingMode: 'omitted',
    temperature: DEFAULT_TEMPERATURE,
    maxTokens: DEFAULT_MAX_TOKENS,
    promptVersion: PLAN_BUILDER_PROMPT_VERSION,
    schemaVersion: PLAN_BUILDER_SCHEMA_VERSION,
    qualityVersion: PRODUCTIVE_QUALITY_VERSION,
    concurrency: normalizePlanBuilderConcurrency(resolveRawConcurrency(env)),
  }
}
