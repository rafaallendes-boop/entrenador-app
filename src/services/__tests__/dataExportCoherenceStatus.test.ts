import { describe, expect, it } from 'vitest'

import { parseAppDataExport } from '../dataExport'

function backupFixture(macroWeekCoherence: unknown) {
  return {
    app: 'Entrenador',
    version: 3,
    exportedAt: '2026-08-10T12:00:00.000Z',
    exportedFromAppVersion: 'test',
    tables: {
      sessions: [],
      dayLogs: [],
      weekSummaries: [],
      chatMessages: [],
      athleteProfiles: [],
      coachProposals: [
        {
          id: 'proposal-1',
          message: 'Semana propuesta',
          actions: [],
          status: 'pending',
          createdAt: 1,
          planSummary: {
            allowedSports: ['squash'],
            excludedSports: [],
            sessionsBySport: { squash: 3 },
            estimatedLoadBySport: { squash: 900 },
            intentsBySport: { squash: 'progress' },
            weeklyIntent: 'progress',
            weeklyGoalSummary: 'Sostener calidad',
            validationStatus: 'ok',
            validationIssues: [],
            ...(macroWeekCoherence === undefined ? {} : { macroWeekCoherence }),
          },
        },
      ],
    },
  }
}

function parseProposal(macroWeekCoherence: unknown) {
  const parsed = parseAppDataExport(backupFixture(macroWeekCoherence))
  return parsed.tables.coachProposals?.[0]?.planSummary
}

describe('compatibilidad de coherenceStatus en import', () => {
  it('un backup viejo sin macroWeekCoherence importa como not_applicable, no como ok', () => {
    // Un export anterior no permite afirmar coherencia: no consta si había macroplan.
    expect(parseProposal(undefined)?.macroWeekCoherence.coherenceStatus).toBe('not_applicable')
  })

  it('conserva los estados que sí venían en backups previos', () => {
    for (const status of ['ok', 'warning'] as const) {
      const summary = parseProposal({
        currentPhase: 'peak',
        blockGoal: 'Afinar calidad',
        weeklyRule: 'Priorizar calidad especifica.',
        targetDistributionBySport: { squash: 'primary' },
        actualDistributionBySport: { squash: 3 },
        expectedSessionsBySport: { squash: '3-4 sesiones' },
        coherenceStatus: status,
        coherenceIssues: [],
      })

      expect(summary?.macroWeekCoherence.coherenceStatus).toBe(status)
    }
  })

  it('acepta el estado nuevo en un round-trip de export/import', () => {
    const summary = parseProposal({
      currentPhase: 'base',
      blockGoal: 'Construir base general.',
      weeklyRule: 'Construir base amplia.',
      targetDistributionBySport: {},
      actualDistributionBySport: {},
      expectedSessionsBySport: {},
      coherenceStatus: 'not_applicable',
      coherenceIssues: [],
    })

    expect(summary?.macroWeekCoherence.coherenceStatus).toBe('not_applicable')
  })

  it('sigue rechazando un estado desconocido', () => {
    expect(() => parseProposal({
      currentPhase: 'base',
      blockGoal: 'x',
      weeklyRule: 'x',
      targetDistributionBySport: {},
      actualDistributionBySport: {},
      expectedSessionsBySport: {},
      coherenceStatus: 'quizas',
      coherenceIssues: [],
      // Anclado al path exacto: si el fixture se rompiera, el throw vendría de la
      // validación del sobre y el test pasaría sin ejercitar el enum.
    })).toThrow(/coherenceStatus/)
  })
})
