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
 * Escalones válidos por modelo. Sonnet 4.6 NO acepta `xhigh`: rechazarlo acá
 * evita que una configuración incompatible mate una corrida pagada a mitad de
 * camino.
 */
const MODEL_EFFORT_ALLOWLIST: Record<string, readonly string[]> = {
  'claude-sonnet-4-6': ['low', 'medium', 'high', 'max'],
}

/**
 * `adaptive` queda deliberadamente fuera: `buildClaudeBody` manda
 * `temperature: 0.25` incondicionalmente y la interacción entre thinking activo
 * y sampling no-default no está resuelta en esta base de código. Habilitarlo es
 * trabajo de otra fase, no un valor más en la lista.
 */
const MODEL_THINKING_ALLOWLIST: Record<string, readonly string[]> = {
  'claude-sonnet-4-6': ['disabled'],
}

export interface PlanBuilderRequestDirectives {
  /** `null` significa: no incluir `output_config.effort` en el body. */
  effort: string | null
  /** `null` significa: no incluir `thinking` en el body. */
  thinking: string | null
}

function resolveDirective(
  env: NodeJS.ProcessEnv,
  key: string,
  model: string,
  allowlist: Record<string, readonly string[]>,
): string | null {
  const raw = env[key]
  // Vacío se trata como ausente, igual que en `resolveRawConcurrency`: una
  // variable seteada en blanco es mucho más plausiblemente "sin configurar"
  // que un typo.
  if (typeof raw !== 'string' || raw.trim().length === 0) return null

  const value = raw.trim()
  const allowed = allowlist[model] ?? []
  if (!allowed.includes(value)) {
    throw new Error(
      `${key}="${value}" no es válido para ${model}. `
      + `Valores aceptados: ${allowed.length > 0 ? allowed.join(', ') : '(ninguno para este modelo)'}.`,
    )
  }
  return value
}

/**
 * Única fuente de lo que el body envía. `resolveEffectivePlanBuilderConfig`
 * deriva su descriptor de acá, de modo que un `variant_id` no pueda decir
 * `effort=medium` sobre una request que mandó otra cosa.
 */
export function resolvePlanBuilderRequestDirectives(
  env: NodeJS.ProcessEnv,
  model: string = resolvePlanBuilderModel(env),
): PlanBuilderRequestDirectives {
  return {
    effort: resolveDirective(env, 'PLAN_BUILDER_EFFORT', model, MODEL_EFFORT_ALLOWLIST),
    thinking: resolveDirective(env, 'PLAN_BUILDER_THINKING', model, MODEL_THINKING_ALLOWLIST),
  }
}

/**
 * Única fuente de la config efectiva enviada a Anthropic. Las directivas del
 * request y el descriptor salen del mismo resolver para mantener la telemetría
 * fiel a lo que efectivamente se envía.
 */
export function resolveEffectivePlanBuilderConfig(
  env: NodeJS.ProcessEnv,
  qualityVersion: 1 | 2 = PRODUCTIVE_QUALITY_VERSION,
): PlanBuilderVariantDescriptor {
  const model = resolvePlanBuilderModel(env)
  const directives = resolvePlanBuilderRequestDirectives(env, model)
  return {
    provider: 'claude',
    model,
    effort: directives.effort ?? 'omitted',
    thinkingMode: directives.thinking ?? 'omitted',
    temperature: DEFAULT_TEMPERATURE,
    maxTokens: DEFAULT_MAX_TOKENS,
    promptVersion: PLAN_BUILDER_PROMPT_VERSION,
    schemaVersion: PLAN_BUILDER_SCHEMA_VERSION,
    qualityVersion,
    concurrency: normalizePlanBuilderConcurrency(resolveRawConcurrency(env)),
  }
}
