import { describe, expect, it } from 'vitest'
import type { CoachSessionProposal, SquashDrill } from '../../../types'
import { findSquashDrillByName, resolveDrillExecutionMode, resolveSquashDrillKind, SQUASH_DRILL_LIBRARY } from '../../training/drillLibrary'
import { repairGeneratedWeek } from '../repairWeek'
import { summarizeTaxonomy } from '../repairTaxonomy'
import { buildRepairContextForTest, buildSkeletonSessionForTest } from './helpers/repairTestFixtures'

const TECHNICAL_A = 'Tiros paralelos profundos'
const TECHNICAL_B = 'Tiros cruzados profundos'
const TECHNICAL_C = 'Cambio de paralelo a cruzado'
const TECHNICAL_DRILLS = [TECHNICAL_A, TECHNICAL_B, TECHNICAL_C]

function squashSession(
  date: string,
  drills: SquashDrill[],
  overrides: Partial<CoachSessionProposal> = {},
): CoachSessionProposal {
  return buildSkeletonSessionForTest({
    date,
    timeBlock: 'AM',
    sessionType: 'squash',
    title: 'Squash técnico',
    objective: 'Construir largo y control con ejecución limpia.',
    durationMin: 60,
    rpe: 6,
    squashDetails: {
      trainingFocus: 'technical',
      sessionMode: 'drill_session',
      sessionKind: 'technical',
      drills,
    },
    ...overrides,
  })
}

function contextFor(weekIndex = 0) {
  const context = buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 2 })
  // Esta suite aísla normalización/rotación. A2.5 se cubre en su suite propia;
  // sin evento squash activo no debe convertir una de estas sesiones en match.
  context.profile.goalEvents = []
  context.plan.goalEventId = ''
  context.plan = {
    ...context.plan,
    totalWeeks: 2,
    phases: [{ phase: 'base', startWeekIndex: 0, endWeekIndex: 1, blockFocus: '', intentBySport: {} }],
  }
  context.week = {
    ...context.week,
    weekIndex,
    weekStartDate: weekIndex === 0 ? '2026-08-03' : '2026-08-10',
    phase: 'base',
  }
  context.planWeekDescriptors = [
    { weekIndex: 0, phase: 'base' },
    { weekIndex: 1, phase: 'base' },
  ]
  return context
}

function signature(session: CoachSessionProposal): string {
  return (session.squashDetails?.drills ?? [])
    .map((drill) => findSquashDrillByName(drill.name)?.id ?? drill.name)
    .sort((left, right) => left.localeCompare(right))
    .join('|')
}

function squashSessions(result: ReturnType<typeof repairGeneratedWeek>): CoachSessionProposal[] {
  return result.sessions.filter((session) => session.sessionType === 'squash')
}

describe('normalización única de squash', () => {
  it('semana 0 sin duplicados conserva los drills y no mide política', () => {
    const source = squashSession('2026-08-03', [{ name: TECHNICAL_A, durationMin: 15 }])
    const result = repairGeneratedWeek([source], contextFor(0))
    expect(result.failure).toBeUndefined()
    expect(squashSessions(result)[0]?.squashDetails?.drills[0]?.name).toBe(TECHNICAL_A)
    expect(result.meta.squashDrillRotationActionCount).toBeUndefined()
  })

  it('semana 0 corrige firmas duplicadas sin contar política', () => {
    const result = repairGeneratedWeek([
      squashSession('2026-08-03', [{ name: TECHNICAL_A, durationMin: 15 }]),
      squashSession('2026-08-05', [{ name: TECHNICAL_A, durationMin: 15 }]),
    ], contextFor(0))
    expect(result.failure).toBeUndefined()
    expect(new Set(squashSessions(result).map(signature)).size).toBe(2)
    expect(summarizeTaxonomy(result.meta.taxonomy).correctiveActionCount).toBeGreaterThan(0)
    expect(result.meta.squashDrillRotationActionCount).toBeUndefined()
  })

  it('usa una coordenada de tres componentes para separar slots equivalentes', () => {
    const result = repairGeneratedWeek([
      squashSession('2026-08-10', [
        { name: TECHNICAL_A, durationMin: 10 },
        { name: TECHNICAL_B, durationMin: 10 },
      ]),
      squashSession('2026-08-12', [
        { name: TECHNICAL_A, durationMin: 10 },
        { name: TECHNICAL_B, durationMin: 10 },
      ]),
    ], contextFor(1))
    const drills = squashSessions(result).flatMap((session) => session.squashDetails?.drills ?? [])
    expect(new Set(drills.map((drill) => drill.name)).size).toBe(drills.length)
  })

  it('no introduce un nombre ya reservado en el resultado final de política', () => {
    const result = repairGeneratedWeek([
      squashSession('2026-08-10', [{ name: TECHNICAL_A, durationMin: 12 }]),
      squashSession('2026-08-12', [{ name: TECHNICAL_B, durationMin: 12 }]),
    ], contextFor(1))
    const drills = squashSessions(result).flatMap((session) => session.squashDetails?.drills ?? [])
    expect(new Set(drills.map((drill) => drill.name)).size).toBe(drills.length)
  })

  it('conserva el kind estructural bajo política estricta', () => {
    const source = squashSession('2026-08-10', TECHNICAL_DRILLS.map((name) => ({ name, durationMin: 12 })))
    const beforeKinds = source.squashDetails!.drills.map((drill) =>
      resolveSquashDrillKind(findSquashDrillByName(drill.name)!),
    ).sort()
    const result = repairGeneratedWeek([source], contextFor(1))
    const afterKinds = squashSessions(result)[0]!.squashDetails!.drills.map((drill) =>
      resolveSquashDrillKind(findSquashDrillByName(drill.name)!),
    ).sort()
    // Antes la hidratación completaba con un drill de control, y este test lo
    // daba por bueno. Con la modalidad como dato estructural una sesión técnica
    // se completa sólo con técnicos: no hay contaminación que tolerar.
    expect(afterKinds.every((kind) => kind === 'technical')).toBe(true)
    expect(afterKinds.length).toBeGreaterThanOrEqual(beforeKinds.length)
  })

  it('reemplaza la guía anterior por la explicación canónica del drill nuevo', () => {
    const source = squashSession('2026-08-10', TECHNICAL_DRILLS.map((name) => ({
      name,
      durationMin: 17,
      notes: 'nota que pertenece al drill anterior',
      executionMode: 'partner',
    })))
    const result = repairGeneratedWeek([source], contextFor(1))
    const drills = squashSessions(result)[0]?.squashDetails?.drills ?? []
    // El hidratador anterior puede redistribuir duración para cerrar la sesión,
    // pero ningún detalle del drill viejo puede sobrevivir al reemplazo.
    expect(drills.every((drill) => Boolean(drill.notes?.trim()))).toBe(true)
    const replacements = drills.filter((drill) => drill.notes?.split('\nDosis por tiempo: ')[0] !== 'nota que pertenece al drill anterior')
    expect(replacements.length).toBeGreaterThan(0)
    expect(replacements.every((drill) =>
      drill.notes?.split('\nDosis por tiempo: ')[0] === findSquashDrillByName(drill.name)?.description,
    )).toBe(true)
    expect(replacements.every((drill) =>
      drill.executionMode === resolveDrillExecutionMode(findSquashDrillByName(drill.name)!),
    )).toBe(true)
  })

  it('completa guía faltante incluso cuando el drill ya era válido', () => {
    const source = squashSession('2026-08-03', [{ name: TECHNICAL_A, durationMin: 15 }])
    const result = repairGeneratedWeek([source], contextFor(0))
    const drill = squashSessions(result)[0]?.squashDetails?.drills[0]

    expect(drill?.notes?.split('\nDosis por tiempo: ')[0]).toBe(findSquashDrillByName(drill!.name)?.description)
    expect(drill?.notes).toContain('Dosis por tiempo:')
    expect(drill?.executionMode).toBe(resolveDrillExecutionMode(findSquashDrillByName(drill!.name)!))
  })

  it('reconstruye blocks a partir de los drills finales', () => {
    const result = repairGeneratedWeek([
      squashSession('2026-08-10', [{ name: TECHNICAL_A, durationMin: 10 }]),
    ], contextFor(1))
    const details = squashSessions(result)[0]?.squashDetails
    expect(details?.blocks.flatMap((block) => block.drills).map((drill) => drill.name).sort())
      .toEqual(details?.drills.map((drill) => drill.name).sort())
  })

  it('cuenta omisión y conserva el original cuando el pool no existe', () => {
    const context = contextFor(1)
    context.previousWeek = {
      ...context.week,
      id: 'previous-ready',
      weekIndex: 0,
      status: 'draft',
      sessions: [squashSession('2026-08-03', SQUASH_DRILL_LIBRARY.map((drill) => ({ name: drill.name, durationMin: 1 })))],
    }
    const result = repairGeneratedWeek([squashSession('2026-08-10', [{ name: TECHNICAL_A, durationMin: 10 }])], context)
    expect(squashSessions(result)[0]?.squashDetails?.drills.some((drill) => drill.name === TECHNICAL_A)).toBe(true)
    expect(result.meta.squashDrillRotationOmittedCount).toBeGreaterThan(0)
  })

  it('conserva dos matches standalone manteniendo exposición competitiva', () => {
    const match = (date: string) => squashSession(date, [{ name: 'Partido de entrenamiento al mejor de 5 juegos', durationMin: 30 }], {
      subtype: 'competitive',
      title: 'Match competitivo de squash',
      objective: 'Competir con marcador real y presión de cierre.',
      squashDetails: {
        trainingFocus: 'conditioned_games',
        sessionMode: 'competition_match',
        sessionKind: 'match',
        drills: [{ name: 'Partido de entrenamiento al mejor de 5 juegos', durationMin: 30 }],
      },
    })
    const result = repairGeneratedWeek([match('2026-08-03'), match('2026-08-05')], contextFor(0))
    expect(result.failure).toBeUndefined()
    expect(squashSessions(result).some((session) => session.squashDetails?.sessionMode === 'competition_match')).toBe(true)
  })

  it('valida la exposición competitiva sobre la semana final', () => {
    const result = repairGeneratedWeek([
      squashSession('2026-08-03', [{ name: 'Partido de entrenamiento al mejor de 5 juegos', durationMin: 30 }], {
        subtype: 'competitive', title: 'Match competitivo', objective: 'Competir con marcador real.',
      }),
      squashSession('2026-08-05', [{ name: 'Partido de entrenamiento al mejor de 5 juegos', durationMin: 30 }], {
        subtype: 'competitive', title: 'Match competitivo', objective: 'Competir con marcador real.',
      }),
    ], contextFor(0))
    expect(result.failure).toBeUndefined()
    expect(squashSessions(result).some((session) => session.squashDetails?.sessionMode === 'competition_match')).toBe(true)
  })

  it('falla cerrado si no existe una asignación segura para una firma duplicada', () => {
    const context = contextFor(0)
    context.previousWeek = {
      ...context.week,
      id: 'previous-ready',
      weekIndex: 1,
      status: 'draft',
      sessions: [squashSession('2026-08-10', SQUASH_DRILL_LIBRARY.map((drill) => ({ name: drill.name, durationMin: 1 })))],
    }
    const duplicateDrills = TECHNICAL_DRILLS.map((name) => ({ name, durationMin: 10 }))
    const result = repairGeneratedWeek([
      squashSession('2026-08-03', duplicateDrills),
      squashSession('2026-08-05', duplicateDrills),
    ], context)
    expect(result.sessions).toEqual([])
    expect(result.failure?.errorClass).toBe('quality.squash.signature_uniqueness_unresolved')
    expect(result.meta.squashDrillRotationOmittedCount).toBeUndefined()
  })

  it('es idempotente en una segunda ejecución de política', () => {
    const context = contextFor(1)
    const first = repairGeneratedWeek([
      squashSession('2026-08-10', [{ name: TECHNICAL_A, durationMin: 10 }]),
    ], context)
    const second = repairGeneratedWeek(first.sessions, context)
    expect(second.sessions).toEqual(first.sessions)
    expect(second.meta.squashDrillRotationActionCount).toBe(0)
  })

  it('no infla countRepairsV2 cuando solo aplica política', () => {
    const baseline = repairGeneratedWeek([
      squashSession('2026-08-03', [{ name: TECHNICAL_A, durationMin: 10 }]),
    ], contextFor(0))
    const result = repairGeneratedWeek([
      squashSession('2026-08-10', [{ name: TECHNICAL_A, durationMin: 10 }]),
    ], contextFor(1))
    expect(summarizeTaxonomy(result.meta.taxonomy)).toEqual(summarizeTaxonomy(baseline.meta.taxonomy))
  })
})

/**
 * A0 — regresión congelada: la modalidad no se infiere de la prosa.
 *
 * Reproduce la sesión real del plan "Nacional country" (2026-08-19). El
 * proveedor sólo emite el esqueleto (título, objetivo, subtype); los drills los
 * elige `repairWeek`. Al buscar la subcadena "control" dentro de "control de
 * longitud", una sesión de puntos condicionados —que se juega con partner—
 * quedaba hidratada como volumen de repetición en solitario.
 */
describe('A0 — la modalidad de squash no se infiere del texto visible', () => {
  function skeletonSquashSession(
    overrides: Partial<CoachSessionProposal> = {},
  ): CoachSessionProposal {
    return buildSkeletonSessionForTest({
      date: '2026-08-03',
      timeBlock: 'PM',
      sessionType: 'squash',
      subtype: 'training',
      title: 'Squash — Puntos Condicionados: Solo zona cruzada',
      objective:
        'Juego de puntos condicionados donde solo puntúan los golpes que aterrizan '
        + 'en la zona cruzada del fondo. Estimula decisión táctica bajo presión de '
        + 'marcador y control de longitud.',
      durationMin: 60,
      rpe: 8,
      ...overrides,
    })
  }

  function executionModes(session: CoachSessionProposal): string[] {
    return (session.squashDetails?.drills ?? []).map((drill) => {
      const definition = findSquashDrillByName(drill.name)
      return definition ? resolveDrillExecutionMode(definition) : 'unknown'
    })
  }

  it('una sesión de puntos condicionados no se convierte en control solo por decir "control de longitud"', () => {
    const result = repairGeneratedWeek([skeletonSquashSession()], contextFor(0))
    const session = squashSessions(result)[0]

    expect(result.failure).toBeUndefined()
    expect(session?.squashDetails?.sessionKind).toBe('technical')
    expect(executionModes(session!)).not.toContain('solo')
    expect(executionModes(session!).length).toBeGreaterThan(0)
  })

  it('la palabra "precisión" en el objetivo tampoco decide la modalidad', () => {
    const result = repairGeneratedWeek([
      skeletonSquashSession({
        title: 'Squash — Rotación de paralelas con partner',
        objective: 'Paralelas de fondo rotando, buscando precisión y profundidad sostenida.',
      }),
    ], contextFor(0))
    const session = squashSessions(result)[0]

    expect(session?.squashDetails?.sessionKind).toBe('technical')
    expect(executionModes(session!)).not.toContain('solo')
  })

  it('sin señal estructural el default es technical y no depende del título', () => {
    const neutral = repairGeneratedWeek([
      skeletonSquashSession({ title: 'Squash', objective: 'Sesión de squash.' }),
    ], contextFor(0))
    const controlWord = repairGeneratedWeek([
      skeletonSquashSession({ title: 'Squash', objective: 'Sesión de squash con control.' }),
    ], contextFor(0))

    expect(squashSessions(neutral)[0]?.squashDetails?.sessionKind)
      .toBe(squashSessions(controlWord)[0]?.squashDetails?.sessionKind)
  })

  it('detalles contradictorios se reconstruyen desde squashKind y quedan registrados', () => {
    // Propuesta bien formada —pasa `hasValidSquashDetails`— pero cuyo contenido
    // contradice la modalidad declarada. Sin la detección de conflicto, esta
    // sesión evitaba la reconstrucción por completo y conservaba trabajo en
    // solitario bajo una intención de partner.
    const source = buildSkeletonSessionForTest({
      date: '2026-08-03',
      timeBlock: 'AM',
      sessionType: 'squash',
      squashKind: 'technical',
      title: 'Squash — Rotación con partner',
      objective: 'Paralelas de fondo rotando.',
      durationMin: 60,
      rpe: 6,
      squashDetails: {
        trainingFocus: 'technical',
        sessionMode: 'drill_session',
        sessionKind: 'control',
        drills: [
          { name: 'Drives desde media cancha — 100', durationMin: 20 },
          { name: 'Voleas en solitario', durationMin: 20 },
        ],
      },
    })

    const result = repairGeneratedWeek([source], contextFor(0))
    const session = squashSessions(result)[0]

    expect(session?.squashDetails?.sessionKind).toBe('technical')
    expect(executionModes(session!).every((mode) => mode === 'partner')).toBe(true)
    expect(result.meta.squashKindConflictCount).toBe(1)
    expect(result.meta.warnings.some((warning) => warning.code === 'squash_kind_conflict')).toBe(true)
  })

  it('distingue el fallback por subtype heredado del fallback por default', () => {
    const legacy = repairGeneratedWeek([
      skeletonSquashSession({ subtype: 'control', title: 'Squash', objective: 'Volumen.' }),
    ], contextFor(0))
    const noSignal = repairGeneratedWeek([
      skeletonSquashSession({ subtype: 'training', title: 'Squash', objective: 'Sesión.' }),
    ], contextFor(0))

    expect(legacy.meta.squashKindFallbackLegacySubtypeCount).toBe(1)
    expect(legacy.meta.squashKindFallbackDefaultCount).toBeUndefined()
    expect(noSignal.meta.squashKindFallbackDefaultCount).toBe(1)
    expect(noSignal.meta.squashKindFallbackLegacySubtypeCount).toBeUndefined()
  })

  it('una sesión que declara squashKind no cuenta como fallback', () => {
    const result = repairGeneratedWeek([
      skeletonSquashSession({ squashKind: 'technical' }),
    ], contextFor(0))

    expect(result.meta.squashKindFallbackLegacySubtypeCount).toBeUndefined()
    expect(result.meta.squashKindFallbackDefaultCount).toBeUndefined()
    expect(result.meta.warnings.some((warning) => warning.code === 'squash_kind_fallback')).toBe(false)
  })

  it('subtype=control sí es señal estructural legítima y sigue produciendo control solo', () => {
    const result = repairGeneratedWeek([
      skeletonSquashSession({
        subtype: 'control',
        title: 'Squash — Volumen de repetición',
        objective: 'Series largas de repetición en solitario.',
      }),
    ], contextFor(0))
    const session = squashSessions(result)[0]

    expect(session?.squashDetails?.sessionKind).toBe('control')
    expect(executionModes(session!).every((mode) => mode === 'solo')).toBe(true)
  })
})
