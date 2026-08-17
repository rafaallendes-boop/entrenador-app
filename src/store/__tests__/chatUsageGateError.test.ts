import { describe, expect, it } from 'vitest'
import { formatError } from '../useChatStore'
import { KillSwitchActiveError, QuotaExceededError, SpendCapExceededError } from '../../services/entitlements/usageGateError'

describe('formatError — usage gate', () => {
  it('quota_exceeded muestra copy de cupo diario, no texto crudo del servidor', () => {
    const message = formatError(new QuotaExceededError({ bucketId: 'chat', limit: 15, remaining: 0 }))
    expect(message).not.toContain('quota_exceeded')
    expect(message.length).toBeGreaterThan(0)
  })

  it('spend_cap_exceeded muestra copy de presupuesto del servicio', () => {
    const message = formatError(new SpendCapExceededError({ scope: 'global', capUsd: 5 }))
    expect(message).not.toContain('spend_cap_exceeded')
  })

  it('kill_switch_active muestra copy de pausa operativa', () => {
    const message = formatError(new KillSwitchActiveError())
    expect(message).not.toContain('kill_switch_active')
  })
})
