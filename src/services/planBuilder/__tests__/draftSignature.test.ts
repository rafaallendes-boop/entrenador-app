import { describe, expect, it } from 'vitest'

import type { PlanWizardConfig } from '../../../types'
import { buildDraftSignature } from '../draftSignature'

function wizardConfig(overrides: Partial<PlanWizardConfig> = {}): PlanWizardConfig {
  return {
    goalEventId: 'evt-1',
    trainingDays: ['monday', 'wednesday'],
    sessionsPerWeek: 3,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    complementarySports: [],
    currentFitnessLevel: 'normal',
    currentFatigue: 'fresh',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

const event = { date: '2026-09-07', endDate: '2026-09-13', keyDate: '2026-09-10' }

describe('buildDraftSignature', () => {
  it('ignora timestamps para reutilizar un draft con la misma configuración', () => {
    expect(buildDraftSignature({
      goalEventId: 'evt-1', wizardConfig: wizardConfig(), event,
    })).toBe(buildDraftSignature({
      goalEventId: 'evt-1',
      wizardConfig: wizardConfig({ updatedAt: '2026-08-11T00:00:00.000Z' }),
      event,
    }))
  })

  it('cambia cuando se mueve el inicio del evento', () => {
    // Antes la firma sólo miraba id y wizardConfig, así que mover la fecha
    // reutilizaba un shell construido con el calendario anterior.
    expect(buildDraftSignature({ goalEventId: 'evt-1', wizardConfig: wizardConfig(), event }))
      .not.toBe(buildDraftSignature({
        goalEventId: 'evt-1',
        wizardConfig: wizardConfig(),
        event: { ...event, date: '2026-09-08' },
      }))
  })

  it('cambia cuando se mueve el término del evento', () => {
    expect(buildDraftSignature({ goalEventId: 'evt-1', wizardConfig: wizardConfig(), event }))
      .not.toBe(buildDraftSignature({
        goalEventId: 'evt-1',
        wizardConfig: wizardConfig(),
        event: { ...event, endDate: '2026-09-20' },
      }))
  })

  it('cambia cuando se mueve el día clave', () => {
    expect(buildDraftSignature({ goalEventId: 'evt-1', wizardConfig: wizardConfig(), event }))
      .not.toBe(buildDraftSignature({
        goalEventId: 'evt-1',
        wizardConfig: wizardConfig(),
        event: { ...event, keyDate: '2026-09-11' },
      }))
  })

  it('un evento de un día y otro con término igual al inicio firman igual', () => {
    // El resolver normaliza ambos a la misma ventana; firmar distinto obligaría
    // a regenerar el plan sin que nada del calendario haya cambiado.
    expect(buildDraftSignature({
      goalEventId: 'evt-1', wizardConfig: wizardConfig(), event: { date: '2026-09-07' },
    })).toBe(buildDraftSignature({
      goalEventId: 'evt-1',
      wizardConfig: wizardConfig(),
      event: { date: '2026-09-07', endDate: '2026-09-07' },
    }))
  })
})
