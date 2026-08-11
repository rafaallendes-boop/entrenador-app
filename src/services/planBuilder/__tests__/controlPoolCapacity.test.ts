import { describe, expect, it } from 'vitest'

import type { CoachSessionProposal } from '../../../types'
import {
  SQUASH_DRILL_LIBRARY,
  findSquashDrillByName,
  resolveDrillExecutionMode,
  resolveSquashDrillKey,
  resolveSquashDrillKind,
} from '../../training/drillLibrary'
import { selectSquashDrills } from '../../training/drillSelector'
import { repairGeneratedWeek } from '../repairWeek'
import { buildRepairContextForTest, buildSkeletonSessionForTest } from './helpers/repairTestFixtures'

/**
 * A1.5 — capacidad del pool de control.
 *
 * Separar control (solitario) de técnico (con partner) reduce el pool de
 * control a los drills que de verdad se hacen sin rival. Si ese pool queda
 * corto, el motor no falla de forma visible: rellena repitiendo, o mezcla
 * modalidades dentro de una sesión, o agota los recambios y tumba la semana con
 * `quality.squash.signature_uniqueness_unresolved` —que por política no puede
 * degradar al fallback local—.
 *
 * Antes de ampliar el catálogo, dos sesiones de squash en una semana base ya
 * producían un duplicado forzado: había 5 drills de control para 6 slots.
 */

type Phase = 'base' | 'build' | 'peak' | 'taper'

const PHASES: Phase[] = ['base', 'build', 'peak', 'taper']

/** Mínimos acordados en el plan: 9 en build/peak, 6 seguros en taper. */
const MINIMUM_ELIGIBLE: Record<Phase, number> = {
  base: 9,
  build: 9,
  peak: 9,
  taper: 6,
}

function eligibleControlDrills(phase: Phase) {
  return SQUASH_DRILL_LIBRARY.filter((drill) =>
    resolveSquashDrillKind(drill) === 'control'
    && (drill.phaseAppropriate ?? []).includes(phase))
}

describe('capacidad del pool de control', () => {
  it.each(PHASES)('%s tiene suficientes drills de control elegibles', (phase) => {
    expect(eligibleControlDrills(phase).length).toBeGreaterThanOrEqual(MINIMUM_ELIGIBLE[phase])
  })

  it('todo drill de control se puede ejecutar sin partner', () => {
    const requiringPartner = SQUASH_DRILL_LIBRARY
      .filter((drill) => resolveSquashDrillKind(drill) === 'control')
      .filter((drill) => resolveDrillExecutionMode(drill) !== 'solo')

    expect(requiringPartner.map((drill) => drill.id)).toEqual([])
  })

  it('ninguna definición del catálogo declara either', () => {
    const ambiguous = SQUASH_DRILL_LIBRARY
      .filter((drill) => (drill.executionMode as string) === 'either')

    expect(ambiguous.map((drill) => drill.id)).toEqual([])
  })
})

/**
 * Identidad de drill al comparar "recientes".
 *
 * `recentDrills` llega con nombres (`extractRecentSquashDrills` lee sesiones) y
 * el selector comparaba contra ids. Para los 54 drills la clave del nombre
 * difiere de la del id, así que "evitar reciente" no excluía nada: el drill que
 * la sesión ya tenía volvía como candidato, `completeSquashDrillSet` lo
 * deduplicaba, y la semana quedaba por debajo del mínimo hasta que una segunda
 * reparación la completaba por azar de ranking.
 */
describe('clave canónica de drill', () => {
  const CANONICAL = 'Drives paralelos profundos'
  const ALIAS = 'Tiros paralelos profundos'
  const ID = 'drive_parallel_depth'

  it('nombre, alias e id resuelven a la misma clave', () => {
    expect(resolveSquashDrillKey(CANONICAL)).toBe(ID)
    expect(resolveSquashDrillKey(ALIAS)).toBe(ID)
    expect(resolveSquashDrillKey(ID)).toBe(ID)
  })

  it('los tres funcionan igual como drill reciente', () => {
    const pick = (recent: string) => selectSquashDrills({
      fatigueLevel: 4,
      phase: 'build',
      recentDrills: [recent],
      goal: 'sostener largo',
      competitionSoon: false,
      desiredKind: 'technical',
    }).drills.map((drill) => resolveSquashDrillKey(drill.name))

    for (const reference of [CANONICAL, ALIAS, ID]) {
      expect(pick(reference)).not.toContain(ID)
    }
  })

  it('un nombre desconocido cae a su clave normalizada sin romper la comparación', () => {
    expect(resolveSquashDrillKey('Ejercicio inventado del club'))
      .toBe(resolveSquashDrillKey('ejercicio  inventado  del club'))
  })
})

describe('capacidad bajo generación real de semanas', () => {
  function squashSkeleton(date: string): CoachSessionProposal {
    return buildSkeletonSessionForTest({
      date,
      timeBlock: 'AM',
      sessionType: 'squash',
      subtype: 'control',
      title: 'Squash — Volumen de repetición',
      objective: 'Series largas de repetición en solitario.',
      durationMin: 60,
      rpe: 5,
    })
  }

  function contextForWeek(weekIndex: number, phase: Phase) {
    const context = buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 2, phase })
    context.plan = {
      ...context.plan,
      totalWeeks: 12,
      phases: [{ phase, startWeekIndex: 0, endWeekIndex: 11, blockFocus: '', intentBySport: {} }],
    }
    context.week = { ...context.week, weekIndex, phase }
    context.planWeekDescriptors = Array.from({ length: 12 }, (_, index) => ({ weekIndex: index, phase }))
    return context
  }

  function controlModes(session: CoachSessionProposal): string[] {
    return (session.squashDetails?.drills ?? []).map((drill) => {
      const definition = findSquashDrillByName(drill.name)
      return definition ? resolveDrillExecutionMode(definition) : 'unknown'
    })
  }

  it.each([4, 8, 12])('un plan de %i semanas no agota el pool ni mezcla modalidad', (totalWeeks) => {
    for (let weekIndex = 0; weekIndex < totalWeeks; weekIndex++) {
      const result = repairGeneratedWeek(
        [squashSkeleton('2026-08-03'), squashSkeleton('2026-08-05')],
        contextForWeek(weekIndex, 'build'),
      )

      expect(result.failure).toBeUndefined()

      const squash = result.sessions.filter((session) => session.sessionType === 'squash')
      const names = squash.flatMap((session) => (session.squashDetails?.drills ?? []).map((d) => d.name))

      // Sin duplicados dentro de la misma semana: es el síntoma directo de un
      // pool insuficiente, porque el rotador conserva el original cuando no
      // encuentra recambio.
      expect(new Set(names).size).toBe(names.length)

      // Una sesión de control jamás incorpora un drill que exija partner.
      for (const session of squash) {
        expect(controlModes(session)).not.toContain('partner')
      }
    }
  })
})
