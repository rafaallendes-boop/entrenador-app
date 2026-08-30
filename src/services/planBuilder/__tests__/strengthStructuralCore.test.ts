import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { projectStructuralCoreSlot } from '../strengthStructuralCore'

const TEMPLATE = [
  { name: 'Sentadilla trasera', group: 'legs' },
  { name: 'Peso muerto rumano', group: 'legs' },
  { name: 'Dead bug — control de tronco', group: 'core' },
  { name: 'Lanzamiento rotacional con balón medicinal', group: 'core' },
]

describe('projectStructuralCoreSlot', () => {
  it('elige el primer foundation core del snapshot y lo rota por la allowlist de §29', () => {
    expect(projectStructuralCoreSlot(TEMPLATE, 0, undefined, [])).toEqual({ slotIndex: 2, coreId: 'dead_bug' })
    expect(projectStructuralCoreSlot(TEMPLATE, 1, undefined, [])).toEqual({ slotIndex: 2, coreId: 'plank' })
    expect(projectStructuralCoreSlot(TEMPLATE, 2, undefined, [])).toEqual({ slotIndex: 2, coreId: 'side_plank' })
  })

  it('devuelve un slot virtual cuando el snapshot no trae foundation core', () => {
    const sinCore = [
      { name: 'Sentadilla trasera', group: 'legs' },
      { name: 'Lanzamiento rotacional con balón medicinal', group: 'core' },
    ]
    expect(projectStructuralCoreSlot(sinCore, 1, undefined, [])).toEqual({ slotIndex: null, coreId: 'plank' })
  })

  it('no depende de la asignación: la misma entrada da la misma proyección', () => {
    const a = projectStructuralCoreSlot(TEMPLATE, 3, undefined, [])
    const b = projectStructuralCoreSlot(TEMPLATE, 3, undefined, [])
    expect(a).toEqual(b)
  })

  it('respeta el equipamiento: sin fitball el ciclo usa sólo los tres universales', () => {
    expect(projectStructuralCoreSlot(TEMPLATE, 3, ['barbell'], [])?.coreId).toBe('dead_bug')
    expect(projectStructuralCoreSlot(TEMPLATE, 3, undefined, [])?.coreId).toBe('stability_ball_front_plank')
  })

  it('conserva un core prescrito de estabilidad que no pertenece a la allowlist inyectada', () => {
    const withCopenhagen = [
      { name: 'Sentadilla trasera', group: 'legs' },
      { name: 'Plancha Copenhagen', group: 'core' },
    ]

    expect(projectStructuralCoreSlot(withCopenhagen, 2, undefined, [])).toEqual({
      slotIndex: 1,
      coreId: 'copenhagen_side_plank',
    })
  })
})

describe('guard: una sola autoridad, sin copias', () => {
  const SOURCE = readFileSync(
    resolve(process.cwd(), 'src/services/planBuilder/strengthStructuralCore.ts'),
    'utf8',
  )

  it('la proyección importa el predicado de strengthSessionStructure, no una copia', () => {
    expect(SOURCE).not.toMatch(/anti_extension/)
    expect(SOURCE).not.toMatch(/lateral_stability/)
    expect(SOURCE).toMatch(
      /import \{[^}]*isFoundationCore[^}]*\} from '\.\.\/training\/strengthSessionStructure'/,
    )
  })

  it('la allowlist del core no está copiada: se reexporta la de strengthSessionStructure', () => {
    expect(SOURCE).not.toMatch(/'side_plank'/)
    expect(SOURCE).not.toMatch(/'stability_ball_front_plank'/)
    expect(SOURCE).toMatch(
      /export \{ INJECTED_CORE_ROTATION \} from '\.\.\/training\/strengthSessionStructure'/,
    )
  })
})
