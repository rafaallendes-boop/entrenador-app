import { describe, expect, it } from 'vitest'
import type { ChatContext, Session } from '../../../types'
import { buildWeekCreatorPrompt } from '../WeekCreatorPromptBuilder'
import type { WeekCreatorEffectiveConfig } from '../WeekCreatorConfig'

/**
 * Tarea 11 — migración de `buildLoadDirective` de Week Creator al policy
 * compartido `loadDirectivePolicy.ts`.
 *
 * Estos tests empezaron como oráculo (Step 1 del brief): se escribieron y se
 * verificaron en VERDE contra el `buildLoadDirective` propio de Week Creator,
 * ANTES de sustituir su cuerpo por `decideLoadDirective`/`renderLoadDirective`.
 * Los seis caminos originales pasaron tal cual contra el código viejo.
 *
 * Tras la migración (Step 2), cinco de los seis caminos cambian de texto
 * porque el policy compartido usa su propio copy congelado (ver
 * `loadDirectivePolicy.ts`, que NO se modifica en esta tarea porque también
 * lo consume Plan Builder). Las aserciones de abajo reflejan la salida
 * DESPUÉS de la migración; el texto ANTES de cada camino que cambió queda
 * documentado en el comentario de su test y en el reporte de la tarea
 * (`task-11-report.md`), tal como exige el Ruling 5 del controlador.
 *
 * `buildLoadDirective` no está exportado, así que se ejercita a través de la
 * API pública `buildWeekCreatorPrompt`, leyendo la línea
 * "Directiva de carga: ..." del `userPrompt` resultante.
 */

function makeConfig(overrides: Partial<WeekCreatorEffectiveConfig> = {}): WeekCreatorEffectiveConfig {
  return {
    trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    doubleSessionDays: [],
    sessionsPerWeek: 4,
    maxSessionsPerWeek: 5,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    allowedSports: ['squash', 'strength'],
    primarySport: 'squash',
    competitiveLevel: 'competitive',
    trainingPriority: 'performance',
    currentFitnessLevel: 'fit',
    currentFatigue: 'normal',
    fromWizard: true,
    configSource: 'wizard',
    ...overrides,
  }
}

function makeHistoricalSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'hist-1',
    date: '2026-06-10',
    timeBlock: 'morning',
    status: 'completed',
    title: 'Sesión de squash',
    durationMin: 60,
    type: 'squash',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Session
}

function extractLoadDirective(userPrompt: string): string {
  const match = userPrompt.match(/^Directiva de carga: (.*)$/m)
  if (!match) throw new Error('No se encontró la línea "Directiva de carga:" en el prompt')
  return match[1]
}

function buildDirective(
  contextOverrides: Partial<ChatContext> = {},
  configOverrides: Partial<WeekCreatorEffectiveConfig> = {},
): string {
  const context: ChatContext = {
    recentSessions: [],
    plannedSessions: [],
    historicalSessions: [],
    weekDayLogs: [],
    ...contextOverrides,
  }

  const result = buildWeekCreatorPrompt(context, {
    userMessage: 'Créame la semana',
    targetWeekStart: '2026-06-15',
    config: makeConfig(configOverrides),
    strictFormatting: true,
    structuredOutput: true,
  })

  return extractLoadDirective(result.userPrompt)
}

describe('buildLoadDirective de Week Creator (post-migración al policy compartido)', () => {
  it('no confunde RPE planificado con esfuerzo autoreportado', () => {
    const directive = buildDirective({ historicalSessions: [
      makeHistoricalSession({ id: 'h1', rpe: 9, actualRpe: undefined }),
      makeHistoricalSession({ id: 'h2', rpe: 9, actualRpe: undefined }),
      makeHistoricalSession({ id: 'h3', rpe: 9, actualRpe: undefined }),
    ] }, { currentFatigue: 'normal' })
    expect(directive).toContain('MANTENER PROGRESIÓN NORMAL')
  })

  it('camino 1: fatiga declarada overloaded → REDUCIR CARGA REAL por fatiga acumulada', () => {
    // ANTES: 'REDUCIR CARGA — atleta llega con fatiga acumulada. Baja volumen e
    // intensidad. RPE máximo 6-7.'
    const directive = buildDirective(
      { historicalSessions: [makeHistoricalSession()], weekDayLogs: [] },
      { currentFatigue: 'overloaded' },
    )
    expect(directive).toBe(
      'REDUCIR CARGA REAL — el atleta declara fatiga acumulada alta. Baja volumen e intensidad, deja las sesiones duras en RPE 6-7 y evita impactos agresivos.',
    )
  })

  it('camino 2: day log con energía baja → REDUCIR CARGA REAL con el valor exacto', () => {
    // ANTES: 'REDUCIR CARGA — último day log indica energía baja o dolor
    // elevado. Baja volumen, evita impactos agresivos y deja las sesiones
    // duras en RPE máximo 6-7.' (no mencionaba el valor concreto)
    const directive = buildDirective(
      {
        historicalSessions: [makeHistoricalSession()],
        weekDayLogs: [{ id: 'd1', date: '2026-06-14', energyLevel: 3, updatedAt: 1 }],
      },
      { currentFatigue: 'normal' },
    )
    expect(directive).toBe(
      'REDUCIR CARGA REAL — el último registro marca energía 3/10. Baja volumen e intensidad, deja las sesiones duras en RPE 6-7 y evita impactos agresivos.',
    )
  })

  it('camino 2b: day log con dolor alto → REDUCIR CARGA REAL, chequeo de dolor precede al de energía', () => {
    // ANTES: mismo texto genérico que el camino 2 ('… energía baja o dolor
    // elevado …'), sin distinguir cuál señal disparó la reducción.
    // `loadDirectivePolicy` evalúa dolor antes que energía (orden congelado
    // en el módulo compartido), pero acá sólo hay señal de dolor así que el
    // resultado observable es el mismo camino que si sólo hubiera dolor.
    const directive = buildDirective(
      {
        historicalSessions: [makeHistoricalSession()],
        weekDayLogs: [{ id: 'd2', date: '2026-06-14', painLevel: 7, updatedAt: 1 }],
      },
      { currentFatigue: 'normal' },
    )
    expect(directive).toBe(
      'REDUCIR CARGA REAL — el último registro marca dolor 7/10. Baja volumen e intensidad, deja las sesiones duras en RPE 6-7 y evita impactos agresivos.',
    )
  })

  it('camino 3: fatiga declarada loaded → MANTENER SIN SUBIR (texto acortado)', () => {
    // ANTES: 'MANTENER SIN SUBIR — atleta llega con carga acumulada. Conserva
    // los estímulos de calidad, recorta volumen accesorio y no agregues
    // intensidad extra esta semana.' (con "esta semana" al final)
    const directive = buildDirective(
      { historicalSessions: [makeHistoricalSession()], weekDayLogs: [] },
      { currentFatigue: 'loaded' },
    )
    expect(directive).toBe(
      'MANTENER SIN SUBIR — el atleta declara carga acumulada. Conserva los estímulos de calidad, recorta volumen accesorio y no agregues intensidad extra.',
    )
  })

  it('camino 4: fatiga declarada fresh → SUBIR CARGA con razón reformulada', () => {
    // ANTES: 'SUBIR CARGA — atleta está fresco. Puedes incrementar volumen o
    // intensidad un escalón, no ambos a la vez.'
    const directive = buildDirective(
      { historicalSessions: [makeHistoricalSession()], weekDayLogs: [] },
      { currentFatigue: 'fresh' },
    )
    expect(directive).toBe(
      'SUBIR CARGA — el atleta llega fresco. Puedes incrementar volumen o intensidad un escalón, no ambos a la vez.',
    )
  })

  it('camino 5: sin historial previo → INICIAR CON CARGA CONSERVADORA (sin cambios; el policy no cubre arranque)', () => {
    const directive = buildDirective(
      { historicalSessions: [], weekDayLogs: [] },
      { currentFatigue: 'normal' },
    )
    expect(directive).toBe('INICIAR CON CARGA CONSERVADORA — sin historial previo. RPE 6-7.')
  })

  it('camino 6: RPE promedio ≥8 con ≥3 muestras → ahora es verdict "hold" con el dato exacto', () => {
    // ANTES: 'MANTENER O BAJAR LIGERAMENTE — viene de semana de alta carga.
    // Conserva calidad, baja un punto de RPE o reduce volumen accesorio.'
    // DESPUÉS: mismo verdict (mantener, no subir) pero colapsado en el mismo
    // texto "MANTENER SIN SUBIR" que usa `loaded` y adherencia baja, con el
    // RPE/muestra exactos en la razón en vez de "no bajar ligeramente".
    const directive = buildDirective(
      {
        historicalSessions: [
          makeHistoricalSession({ id: 'h1', date: '2026-06-12', actualRpe: 8 }),
          makeHistoricalSession({ id: 'h2', date: '2026-06-13', actualRpe: 8 }),
          makeHistoricalSession({ id: 'h3', date: '2026-06-14', actualRpe: 9 }),
        ],
        weekDayLogs: [],
      },
      { currentFatigue: 'normal' },
    )
    expect(directive).toBe(
      'MANTENER SIN SUBIR — el RPE real promedio fue 8.3/10 en 3 sesiones. Conserva los estímulos de calidad, recorta volumen accesorio y no agregues intensidad extra.',
    )
  })

  it('camino de respaldo (no listado entre los seis, sin cambios): sin señales de alerta → MANTENER PROGRESIÓN NORMAL', () => {
    const directive = buildDirective(
      { historicalSessions: [makeHistoricalSession({ actualRpe: 5 })], weekDayLogs: [] },
      { currentFatigue: 'normal' },
    )
    expect(directive).toBe('MANTENER PROGRESIÓN NORMAL — fatiga normal, sin señales de alerta.')
  })

  it('corrige un gap real: energía baja prellenada por Whoop YA NO dispara REDUCIR CARGA', () => {
    // ANTES: el código de Week Creator no excluía `energyLevel` prellenado por
    // Whoop antes de evaluarlo, así que este mismo caso devolvía 'REDUCIR
    // CARGA — último day log indica energía baja o dolor elevado. Baja
    // volumen, evita impactos agresivos y deja las sesiones duras en RPE
    // máximo 6-7.' — un strain alto convertido a "energía baja" por Whoop
    // podía bajar la carga sin que el atleta lo hubiera declarado.
    // DESPUÉS: `loadDirectivePolicy` exige señales autoreportadas; el llamador
    // excluye el prefill Whoop (mismo criterio que ya usa `formatDayLogLine`
    // para `rpeActual`), así que sin otra señal cae al camino de respaldo.
    const directive = buildDirective(
      {
        historicalSessions: [makeHistoricalSession()],
        weekDayLogs: [
          { id: 'd3', date: '2026-06-14', energyLevel: 3, prefillSource: { energyLevel: 'whoop' }, updatedAt: 1 },
        ],
      },
      { currentFatigue: 'normal' },
    )
    expect(directive).toBe('MANTENER PROGRESIÓN NORMAL — fatiga normal, sin señales de alerta.')
  })

  it('cambio de VEREDICTO (no sólo de copy): fresh + RPE real alto con muestra suficiente → MANTENER SIN SUBIR', () => {
    // ANTES de la migración, `buildLoadDirective` evaluaba `currentFatigue === 'fresh'` (camino 4)
    // ANTES que el chequeo de RPE alto (camino 6): con `fresh` declarado, el chequeo de fatiga
    // devolvía inmediatamente 'SUBIR CARGA — atleta está fresco...' sin llegar nunca a mirar el
    // historial de RPE, aunque el atleta viniera de 3 sesiones a RPE 8-9.
    //
    // `loadDirectivePolicy.ts` (Tarea 4, contrato congelado, off-limits en esta tarea) ordena las
    // reglas al revés a propósito: "seguridad primero... y sólo al final la señal que permite
    // subir" — el RPE real alto (evidencia de sobrecarga ya vivida) se evalúa ANTES que `fresh`
    // (una declaración que, si el cuerpo ya está sobrecargado según RPE real, queda desactualizada).
    // Es el único combo de señales de los seis caminos originales cuyo ORDEN relativo cambió entre
    // el código viejo y el policy compartido, y por lo tanto el único que cambia de VEREDICTO
    // (progress → hold), no sólo de copy. Es intencional y el resultado nuevo es el más
    // conservador: no se revierte.
    const directive = buildDirective(
      {
        historicalSessions: [
          makeHistoricalSession({ id: 'h1', date: '2026-06-12', actualRpe: 8 }),
          makeHistoricalSession({ id: 'h2', date: '2026-06-13', actualRpe: 8 }),
          makeHistoricalSession({ id: 'h3', date: '2026-06-14', actualRpe: 9 }),
        ],
        weekDayLogs: [],
      },
      { currentFatigue: 'fresh' },
    )
    expect(directive).toBe(
      'MANTENER SIN SUBIR — el RPE real promedio fue 8.3/10 en 3 sesiones. Conserva los estímulos de calidad, recorta volumen accesorio y no agregues intensidad extra.',
    )
    expect(directive).not.toContain('SUBIR CARGA')
  })
})
