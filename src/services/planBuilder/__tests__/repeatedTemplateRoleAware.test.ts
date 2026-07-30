import { describe, expect, it } from 'vitest'
import { reviewPlanQuality } from '../qualityReview'
import { buildPlanForTest, buildWeekForTest } from './helpers/qualityTestFixtures'
import { buildSkeletonSessionForTest } from './helpers/repairTestFixtures'
import { STRENGTH_EXERCISE_LIBRARY } from '../../training/exerciseLibrary'

const plainLifts = STRENGTH_EXERCISE_LIBRARY
  .filter((exercise) => exercise.category !== 'core' && exercise.intensityType !== 'power')
  .map((exercise) => exercise.name)
const [MAIN_A, MAIN_B, ACC_1, ACC_2, ACC_3, ACC_4, ACC_5, ACC_6] = plainLifts

const SESSION_DATES: Record<number, string[]> = {
  0: ['2026-08-03', '2026-08-05'],
  1: ['2026-08-10', '2026-08-12'],
}

function strengthWeek(weekIndex: number, exerciseNames: string[][]) {
  return buildWeekForTest({
    weekIndex,
    phase: 'base',
    sessions: exerciseNames.map((names, index) =>
      buildSkeletonSessionForTest({
        date: SESSION_DATES[weekIndex]![index]!,
        sessionType: 'strength',
        exercises: names.map((name) => ({ name, sets: 3, reps: '8' })),
      }),
    ),
    generationMeta: { attempts: 1, repairTaxonomyVersion: 2 },
  })
}

function codesFor(weeks: ReturnType<typeof strengthWeek>[]): string[] {
  const plan = buildPlanForTest({
    totalWeeks: weeks.length,
    phases: [{ phase: 'base', startWeekIndex: 0, endWeekIndex: weeks.length - 1, blockFocus: '', intentBySport: {} }],
  })
  return reviewPlanQuality(plan, weeks, { qualityVersion: 2 }).weeks
    .flatMap((week) => week.issues.map((issue) => issue.code))
}

describe('quality.strength.repeated_template sensible a roles', () => {
  it('no marca cuando el único solape es el main lift de cada sesión', () => {
    const codes = codesFor([
      strengthWeek(0, [[MAIN_A!, ACC_1!, ACC_2!, ACC_3!]]),
      strengthWeek(1, [[MAIN_A!, ACC_4!, ACC_5!, ACC_6!]]),
    ])
    expect(codes).not.toContain('quality.strength.repeated_template')
  })

  it('marca con 3 accesorios compartidos aunque el main lift difiera', () => {
    const codes = codesFor([
      strengthWeek(0, [[MAIN_A!, ACC_1!, ACC_2!, ACC_3!]]),
      strengthWeek(1, [[MAIN_B!, ACC_1!, ACC_2!, ACC_3!]]),
    ])
    expect(codes).toContain('quality.strength.repeated_template')
  })

  it('cuenta un principal de la semana anterior que baja a accesorio en la posterior', () => {
    const codes = codesFor([
      strengthWeek(0, [[MAIN_A!, ACC_1!, ACC_2!, ACC_4!]]),
      strengthWeek(1, [[MAIN_B!, ACC_1!, ACC_2!, MAIN_A!]]),
    ])
    expect(codes).toContain('quality.strength.repeated_template')
  })

  it('cuenta una sola vez un ejercicio principal y accesorio en la misma semana', () => {
    const codes = codesFor([
      strengthWeek(0, [[MAIN_A!, ACC_1!, ACC_4!]]),
      strengthWeek(1, [[MAIN_A!, ACC_1!, ACC_5!], [MAIN_B!, MAIN_A!, ACC_6!]]),
    ])
    expect(codes).not.toContain('quality.strength.repeated_template')
  })
})
