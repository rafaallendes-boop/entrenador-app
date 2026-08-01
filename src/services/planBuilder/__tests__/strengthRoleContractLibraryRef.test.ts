import { describe, expect, it } from 'vitest'

import { resolveSessionStrengthRoles } from '../strengthRoleContract'

describe('roles de fuerza resueltos por libraryRef', () => {
  it('un nombre que no resuelve deja de ser unknown si trae ref', () => {
    const roles = resolveSessionStrengthRoles([
      {
        name: 'Nombre libre irreconocible',
        libraryRef: { source: 'strength_exercise', id: 'back_squat' },
      },
    ])

    expect(roles[0]).not.toBe('unknown')
  })

  it('sin ref y sin nombre resoluble sigue siendo unknown', () => {
    expect(resolveSessionStrengthRoles([{ name: 'Nombre libre irreconocible' }])[0]).toBe('unknown')
  })
})
