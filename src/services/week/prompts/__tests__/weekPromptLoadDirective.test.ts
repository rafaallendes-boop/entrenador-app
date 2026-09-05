import { describe, expect, it } from 'vitest'
import { buildWeekBatchUserPrompt, buildWeekUserPrompt } from '../weekPrompt'
import { makeWeekBatchPromptInput, makeWeekPromptInput, makeRecentContext } from './fixtures'

describe('directiva de carga con ejecución real', () => {
  it('reduce cuando la última semana vivida trae energía autoreportada baja', () => {
    const prompt = buildWeekUserPrompt(makeWeekPromptInput({
      week: { weekIndex: 1, phase: 'build' },
      recentContext: makeRecentContext({
        livedPlanWeeks: [{
          weekStartDate: '2026-09-07', plannedSessions: 5, completedSessions: 5,
          adherencePct: 100, plannedMinutes: 300, completedMinutes: 300,
          avgManualActualRpe: 9, manualRpeSampleCount: 5, latestManualEnergyLevel: 3,
          sports: {}, painNotes: [], sessionHighlights: [],
        }],
      }),
    }))

    expect(prompt).toContain('REDUCIR CARGA REAL')
    expect(prompt).toContain('energía 3/10')
  })

  it('mantiene sin subir cuando el RPE real alto es la única señal (aislado de energía/dolor)', () => {
    const prompt = buildWeekUserPrompt(makeWeekPromptInput({
      week: { weekIndex: 1, phase: 'build' },
      recentContext: makeRecentContext({
        livedPlanWeeks: [{
          weekStartDate: '2026-09-07', plannedSessions: 5, completedSessions: 5,
          adherencePct: 100, plannedMinutes: 300, completedMinutes: 300,
          avgManualActualRpe: 9, manualRpeSampleCount: 5,
          sports: {}, painNotes: [], sessionHighlights: [],
        }],
      }),
    }))

    // Sin latestManualEnergyLevel/latestManualPainLevel, la regla de energía baja
    // (que evalúa antes que la de RPE en decideLoadDirective) no puede disparar
    // por accidente: esto sí ejercita la rama de RPE alto por sí sola.
    expect(prompt).toContain('MANTENER SIN SUBIR')
    expect(prompt).toContain('RPE real promedio')
  })

  describe('la directiva de fase gana sobre las señales de ejecución real', () => {
    // Señales que en fase entrenable (base/build/peak) producirían REDUCIR CARGA
    // REAL — ver el primer test de este archivo. Se reutilizan tal cual en
    // race/taper/transition para probar que la fase las ignora por completo,
    // no que las señales "pierden" por casualidad de umbral.
    //
    // Nota importante: las señales de ejecución real derivadas de
    // `livedPlanWeeks` sólo pueden FRENAR la directiva (`reduce`/`hold`), nunca
    // acelerarla (`progress`). `progress` en `decideLoadDirective` sólo sale de
    // `declaredFatigue === 'fresh'`, y `executionSignalsFromLivedWeeks` nunca
    // puebla `declaredFatigue` porque ese campo no existe en
    // `PlanBuilderRecentWeekContext`. Por eso no hay (ni puede haber) un caso
    // de "la fase taper gana sobre una señal real de progresar": ese veredicto
    // es irrepresentable con datos de `livedPlanWeeks`.
    const wouldReduceInBuild = {
      weekStartDate: '2026-09-07', plannedSessions: 5, completedSessions: 5,
      adherencePct: 100, plannedMinutes: 300, completedMinutes: 300,
      latestManualEnergyLevel: 3, manualRpeSampleCount: 0,
      sports: {}, painNotes: [], sessionHighlights: [],
    }

    it('en race, la directiva de fase gana aunque la señal real diría reducir', () => {
      const prompt = buildWeekUserPrompt(makeWeekPromptInput({
        week: { weekIndex: 5, phase: 'race' },
        recentContext: makeRecentContext({ livedPlanWeeks: [wouldReduceInBuild] }),
      }))

      expect(prompt).toContain('CONSERVAR energía: el evento manda.')
      expect(prompt).not.toContain('REDUCIR CARGA REAL')
      expect(prompt).not.toContain('MANTENER SIN SUBIR')
      expect(prompt).not.toContain('SUBIR CARGA')
    })

    it('en taper, la directiva de fase gana aunque la señal real diría reducir', () => {
      const prompt = buildWeekUserPrompt(makeWeekPromptInput({
        week: { weekIndex: 5, phase: 'taper' },
        recentContext: makeRecentContext({ livedPlanWeeks: [wouldReduceInBuild] }),
      }))

      expect(prompt).toContain('REDUCIR carga de verdad: baja el volumen 30-40%')
      expect(prompt).not.toContain('REDUCIR CARGA REAL')
      expect(prompt).not.toContain('MANTENER SIN SUBIR')
      expect(prompt).not.toContain('SUBIR CARGA')
    })

    it('en transition, la directiva de fase gana aunque la señal real diría reducir', () => {
      const prompt = buildWeekUserPrompt(makeWeekPromptInput({
        week: { weekIndex: 5, phase: 'transition' },
        recentContext: makeRecentContext({ livedPlanWeeks: [wouldReduceInBuild] }),
      }))

      expect(prompt).toContain('RECUPERAR: actividad suave y agradable')
      expect(prompt).not.toContain('REDUCIR CARGA REAL')
      expect(prompt).not.toContain('MANTENER SIN SUBIR')
      expect(prompt).not.toContain('SUBIR CARGA')
    })
  })

  it('sin livedPlanWeeks conserva exactamente la directiva anterior', () => {
    const withoutContext = buildWeekUserPrompt(makeWeekPromptInput({
      week: { weekIndex: 1, phase: 'build' },
      recentContext: undefined,
    }))
    expect(withoutContext).toContain('Directiva de carga:')
    expect(withoutContext).not.toContain('REDUCIR CARGA REAL')
  })

  it('una señal real de reducir anula una directiva planificada de subir', () => {
    const prompt = buildWeekUserPrompt(makeWeekPromptInput({
      week: { weekIndex: 2, phase: 'build', targetLoadBySport: { squash: 500 } },
      previousWeek: { weekIndex: 1, phase: 'build', targetLoadBySport: { squash: 300 } },
      recentContext: makeRecentContext({
        livedPlanWeeks: [{
          weekStartDate: '2026-09-07', plannedSessions: 5, completedSessions: 2,
          adherencePct: 40, plannedMinutes: 300, completedMinutes: 120,
          manualRpeSampleCount: 0,
          sports: {}, painNotes: [], sessionHighlights: [],
        }],
      }),
    }))

    expect(prompt).toContain('MANTENER SIN SUBIR')
    expect(prompt).toContain('adherencia real')
  })
})

it('las dos semanas del batch reciben su directiva real y el limitante del atleta', () => {
  const prompt = buildWeekBatchUserPrompt(makeWeekBatchPromptInput({
    profile: { performanceLimiter: 'recuperación entre puntos' },
    wizardConfig: { targetHardPrimaryMatches: 3 },
    recentContext: makeRecentContext({ livedPlanWeeks: [{
      weekStartDate: '2026-06-08', plannedSessions: 3, completedSessions: 3,
      plannedMinutes: 180, completedMinutes: 180, manualRpeSampleCount: 0,
      latestManualEnergyLevel: 3, sports: {}, painNotes: [], sessionHighlights: [],
    }] }),
  }))
  expect(prompt.split('Directiva de carga: REDUCIR CARGA REAL')).toHaveLength(3)
  expect(prompt).toContain('Limitante de rendimiento a trabajar: recuperación entre puntos')
  expect(prompt.split('Definición de listo')).toHaveLength(2)
  expect(prompt).not.toContain('Partidos duros objetivo')
})
