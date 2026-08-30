import { describe, expect, it } from 'vitest'
import { projectStructuralCoreSlot } from '../../planBuilder/strengthStructuralCore'
import { resolveInjectedCoreId } from '../strengthSessionStructure'
import type { StrengthConstraint } from '../../../types/strengthSafety'

const lumbar: StrengthConstraint[] = [{ kind: 'region', region: 'lumbar', sources: ['current_injuries'] }]

describe('core inyectado bajo restricciones', () => {
  it('omite el core si toda la rotación está contraindicada', () => {
    expect(resolveInjectedCoreId(0, undefined, lumbar)).toBeUndefined()
    expect(projectStructuralCoreSlot([], 0, undefined, lumbar)).toBeUndefined()
  })

  it('preserva la rotación anterior sin restricciones', () => {
    expect(resolveInjectedCoreId(0, undefined, [])).toBe('dead_bug')
  })
})
