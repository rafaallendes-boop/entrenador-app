import { describe, expect, it } from 'vitest'
import { resolveStrengthSafetyConstraints } from '../strengthSafetyConstraints'

// Decisión del owner (2026-09-14): si el perfil ya tiene una zona identificada,
// un mensaje que menciona una lesión SIN zona se lee como referencia a esa
// misma lesión, no como una restricción nueva sin resolver. Casos reales de
// producción: ambos bloqueaban toda la fuerza pese a tener `region:lumbar`.
const LESION_ESPALDA = 'Créame una semana completa de entrenamiento para la próxima semana considerando mi lesión de espalda'
const KINE_SIN_PERMISO = 'Hazme una semana sin squash, considerando que el kine aún no me da permiso'

const keys = (input: Parameters<typeof resolveStrengthSafetyConstraints>[0]) =>
  resolveStrengthSafetyConstraints(input).map((constraint) =>
    constraint.kind === 'region' ? `region:${constraint.region}`
      : constraint.kind === 'load_pattern' ? `pattern:${constraint.pattern}`
        : `unresolved:${constraint.reason}`)

describe('mensaje que referencia la lesión ya registrada', () => {
  it.each([LESION_ESPALDA, KINE_SIN_PERMISO])('con zona en current_injuries no agrega restricción sin resolver: %s', (message) => {
    expect(keys({ currentInjuries: 'Lesión lumbar', userMessages: [message] })).toEqual(['region:lumbar'])
  })

  it.each([
    ['restrictions', { restrictions: 'evitar carga en la rodilla' }, 'region:knee'],
    ['injury_notes', { injuryNotes: 'tendinitis de hombro' }, 'region:shoulder'],
  ] as const)('también cuando la zona viene de %s', (_source, profile, region) => {
    expect(keys({ ...profile, userMessages: [LESION_ESPALDA] })).toEqual([region])
  })

  it('sin zona en el perfil sigue bloqueando', () => {
    expect(keys({ userMessages: [LESION_ESPALDA] })).toEqual(['unresolved:medical_marker_without_supported_constraint'])
  })

  it('un patrón de carga sin zona no cuenta como zona identificada', () => {
    expect(keys({ restrictions: 'evitar impacto', userMessages: [LESION_ESPALDA] })).toEqual([
      'pattern:impact',
      'unresolved:medical_marker_without_supported_constraint',
    ])
  })

  it('una zona nueva del mensaje se suma a la del perfil', () => {
    expect(keys({ currentInjuries: 'Lesión lumbar', userMessages: ['me duele la rodilla'] })).toEqual(['region:lumbar', 'region:knee'])
  })

  it('una restricción sin zona del propio perfil no se absorbe', () => {
    expect(keys({ currentInjuries: 'Lesión lumbar', injuryNotes: 'me operaron hace poco', userMessages: [] })).toEqual([
      'region:lumbar',
      'unresolved:medical_marker_without_supported_constraint',
    ])
  })

  it('return_to_play sin detalle no se absorbe', () => {
    expect(keys({ currentInjuries: 'Lesión lumbar', trainingPriority: 'return_to_play' })).toEqual([
      'region:lumbar',
      'unresolved:structured_priority_without_detail',
    ])
  })
})
