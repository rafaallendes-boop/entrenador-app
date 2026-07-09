import { describe, expect, it } from 'vitest'

import { buildActionAlerts, buildReadinessAlert } from '../actionAlerts'

describe('buildReadinessAlert', () => {
  it('emits a soft check-in alert on red recovery', () => {
    const alert = buildReadinessAlert({
      id: 'whoop:ath_u1:2026-06-21',
      athleteId: 'ath_u1',
      date: '2026-06-21',
      recoveryScore: 28,
      source: 'whoop',
      updatedAt: 1,
    })

    expect(alert).toEqual({
      id: 'readiness-recovery-low-2026-06-21',
      severity: 'low',
      title: 'Recuperación baja hoy',
      body: 'Tu recovery de Whoop viene en zona baja (28%).',
      recommendation: 'Considera bajar la intensidad o priorizar técnica/recuperación.',
      ctaLabel: 'Ajustar el día',
      target: 'checkin',
    })
  })

  it('emits nothing for green or missing recovery', () => {
    expect(buildReadinessAlert({
      id: 'whoop:ath_u1:2026-06-21',
      athleteId: 'ath_u1',
      date: '2026-06-21',
      recoveryScore: 80,
      source: 'whoop',
      updatedAt: 1,
    })).toBeNull()
    expect(buildReadinessAlert(undefined)).toBeNull()
  })

  it('wires the readiness alert into buildActionAlerts', () => {
    const alerts = buildActionAlerts({
      sessions: [],
      today: '2026-06-21',
      readiness: {
        id: 'whoop:ath_u1:2026-06-21',
        athleteId: 'ath_u1',
        date: '2026-06-21',
        recoveryScore: 28,
        source: 'whoop',
        updatedAt: 1,
      },
    })

    expect(alerts.map((alert) => alert.id)).toContain('readiness-recovery-low-2026-06-21')
  })
})
