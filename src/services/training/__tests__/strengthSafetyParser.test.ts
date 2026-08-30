import { describe, expect, it } from 'vitest'
import { formatStrengthConstraintFeedback, mergeStrengthConstraints, resolveStrengthSafetyConstraints } from '../strengthSafetyConstraints'

const resolve = (overrides: Partial<Parameters<typeof resolveStrengthSafetyConstraints>[0]>) =>
  resolveStrengthSafetyConstraints({ userMessages: [], ...overrides })
const keys = (constraints: ReturnType<typeof resolveStrengthSafetyConstraints>) => constraints.map((constraint) =>
  constraint.kind === 'region' ? `region:${constraint.region}` : constraint.kind === 'load_pattern' ? `pattern:${constraint.pattern}` : `unresolved:${constraint.reason}`,
)

describe('parser de restricciones de fuerza', () => {
  it('distingue ausencia médica de prohibición mecánica', () => {
    expect(keys(resolve({ restrictions: 'sin carga axial' }))).toEqual(['pattern:axial_load'])
    expect(keys(resolve({ restrictions: 'evita impacto' }))).toEqual(['pattern:impact'])
    expect(keys(resolve({ currentInjuries: 'sin dolor lumbar' }))).toEqual([])
  })

  it('resuelve regiones coordinadas, incluso si el campo aporta el marcador', () => {
    expect(keys(resolve({ userMessages: ['dolor de rodilla y tobillo'] }))).toEqual(['region:knee', 'region:ankle'])
    expect(keys(resolve({ currentInjuries: 'cuadrado lumbar' }))).toEqual(['region:lumbar'])
  })

  it('bloquea texto médico sin región y da feedback auditable', () => {
    const constraints = resolve({ userMessages: ['me operaron hace dos semanas'] })
    expect(keys(constraints)).toEqual(['unresolved:medical_marker_without_supported_constraint'])
    expect(formatStrengthConstraintFeedback(constraints)).toBe('Detecté una restricción, pero no pude identificar la zona')
  })

  it('deduplica conservando la procedencia', () => {
    const left = resolve({ currentInjuries: 'dolor lumbar' })
    const right = resolve({ userMessages: ['me duele la espalda baja'] })
    expect(mergeStrengthConstraints(left, right)).toEqual([{ kind: 'region', region: 'lumbar', sources: ['current_injuries', 'user_message'] }])
  })
})
