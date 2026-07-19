/**
 * Audit script for the prompt builder. Run with:
 *   npm run audit:prompt
 *
 * It is a vitest test file (only because vitest already handles the TS runtime
 * and the project's module resolution). It does not assert behavior — it
 * prints a token-cost table per requestClass and per prompt block so you can
 * decide what to trim.
 *
 * Heuristic: 1 token ≈ 4 chars. Comparing blocks within the same row is
 * directionally correct even if absolute numbers are imprecise.
 */
import { beforeAll, describe, expect, it } from 'vitest'

import type { AthleteProfile, ChatContext } from '../src/types'

const REQUEST_CLASSES = [
  'chat_general',
  'chat_action',
  'week_creator',
  'plan_builder_week',
  'weekly_summary',
] as const

const TOKEN_BASELINES: Record<typeof REQUEST_CLASSES[number], { target: number; tolerancePct: number }> = {
  chat_general: { target: 562, tolerancePct: 10 },
  chat_action: { target: 3988, tolerancePct: 10 },
  // Phase 1: structured JSON instructions replaced the duplicated legacy
  // <actions> contract. Keep the compact prompt stable around this new baseline.
  week_creator: { target: 2260, tolerancePct: 10 },
  plan_builder_week: { target: 3988, tolerancePct: 10 },
  weekly_summary: { target: 485, tolerancePct: 15 },
}

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function countSection(prompt: string, marker: string): number {
  const start = prompt.indexOf(marker)
  if (start === -1) return 0
  const next = prompt.slice(start + marker.length).search(/\n[A-ZÁÉÍÓÚÑ ]{6,}\n/)
  const end = next === -1 ? prompt.length : start + marker.length + next
  return approxTokens(prompt.slice(start, end))
}

function installLocalStorageMock() {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
      clear: () => {
        store.clear()
      },
    },
  })
}

function buildFixtureContext(): ChatContext {
  const athleteProfile: AthleteProfile = {
    id: 'athlete-fixture',
    updatedAt: Date.now(),
    primarySport: 'squash',
    secondarySports: ['running', 'strength', 'mobility'],
    sportContext: {
      enabledSports: ['squash', 'running', 'strength', 'mobility'],
      primarySport: 'squash',
      secondarySports: ['running', 'strength', 'mobility'],
      trainingPriority: 'performance',
    },
    goalEvents: [],
  }

  return {
    recentSessions: [],
    plannedSessions: [],
    historicalSessions: [],
    athleteProfile,
    recentMessages: [],
    intent: 'chat_general',
  }
}

describe('prompt token audit', () => {
  let buildCoachSystemPrompt: typeof import('../src/services/ai/promptBuilder').buildCoachSystemPrompt
  let buildWeekCreatorPrompt: typeof import('../src/services/weekCreator/WeekCreatorPromptBuilder').buildWeekCreatorPrompt
  let resolveWeekCreatorConfig: typeof import('../src/services/weekCreator/WeekCreatorConfig').resolveWeekCreatorConfig
  let weekCreatorResponseSchema: Record<string, unknown>

  beforeAll(async () => {
    installLocalStorageMock()
    ;({ buildCoachSystemPrompt } = await import('../src/services/ai/promptBuilder'))
    ;({ buildWeekCreatorPrompt } = await import('../src/services/weekCreator/WeekCreatorPromptBuilder'))
    ;({ resolveWeekCreatorConfig } = await import('../src/services/weekCreator/WeekCreatorConfig'))
    ;({ WEEK_CREATOR_RESPONSE_SCHEMA: weekCreatorResponseSchema } = await import('../src/services/weekCreator/weekCreatorResponseSchema'))
  }, 120000)

  it('prints token cost per request class', () => {
    const ctx = buildFixtureContext()
    const rows: Array<Record<string, number | string>> = []

    for (const requestClass of REQUEST_CLASSES) {
      if (requestClass === 'week_creator') {
        const weekContext: ChatContext = {
          ...ctx,
          athleteProfile: ctx.athleteProfile ? {
            ...ctx.athleteProfile,
            scheduleProfile: {
              availableDays: ['lun', 'mar', 'mié', 'jue', 'vie'],
              sessionsPerWeek: 4,
              constraints: 'martes solo AM',
            },
          } : ctx.athleteProfile,
        }
        const config = resolveWeekCreatorConfig(weekContext.athleteProfile)
        const prompt = buildWeekCreatorPrompt(weekContext, {
          userMessage: 'Créame una semana priorizando squash',
          targetWeekStart: '2026-07-20',
          config,
          strictFormatting: true,
          structuredOutput: true,
          weekObjectives: ['Mantener continuidad de squash', 'Sostener fuerza sin interferencia'],
        })
        const responseSchemaChars = JSON.stringify(weekCreatorResponseSchema).length
        const totalChars = prompt.systemPrompt.length + prompt.userPrompt.length + responseSchemaChars
        rows.push({
          requestClass,
          totalChars,
          approxTokens: approxTokens(prompt.systemPrompt + prompt.userPrompt + JSON.stringify(weekCreatorResponseSchema)),
          systemPrompt: prompt.systemPrompt.length,
          userPrompt: prompt.userPrompt.length,
          responseSchema: responseSchemaChars,
          athleteProfile: countSection(prompt.userPrompt, '## PERFIL DEL ATLETA'),
          macroPlan: countSection(prompt.userPrompt, '## OBJETIVO COMPETITIVO'),
          currentWeek: countSection(prompt.userPrompt, '## SEMANA ACTUAL'),
          nutrition: 0,
          recentHistory: countSection(prompt.userPrompt, '## PROGRESIÓN Y DIRECTIVA DE CARGA'),
          rules: countSection(prompt.userPrompt, '## REGLAS POR NIVEL DEL ATLETA'),
        })
        continue
      }
      const prompt = buildCoachSystemPrompt(ctx, { requestClass })
      rows.push({
        requestClass,
        totalChars: prompt.length,
        approxTokens: approxTokens(prompt),
        systemPrompt: prompt.length,
        userPrompt: 0,
        responseSchema: 0,
        athleteProfile: countSection(prompt, 'PERFIL DEL ATLETA'),
        macroPlan: countSection(prompt, 'MACRO PLAN'),
        currentWeek: countSection(prompt, 'SEMANA ACTUAL'),
        nutrition: countSection(prompt, 'NUTRICIÓN'),
        recentHistory: countSection(prompt, 'HISTORIAL RECIENTE'),
        rules: countSection(prompt, 'REGLAS'),
      })
    }

    console.log('\n=== Prompt token audit (1 token ≈ 4 chars) ===')
    console.table(rows)
    console.log('Use this table to identify large blocks to trim per requestClass.\n')

    for (const row of rows) {
      const requestClass = row.requestClass as typeof REQUEST_CLASSES[number]
      const baseline = TOKEN_BASELINES[requestClass]
      const approxTokenCount = row.approxTokens as number
      const lowerBound = Math.floor(baseline.target * (1 - baseline.tolerancePct / 100))
      const upperBound = Math.ceil(baseline.target * (1 + baseline.tolerancePct / 100))

      expect(
        approxTokenCount,
        `${requestClass} prompt drifted outside ${baseline.tolerancePct}% of baseline ${baseline.target}`,
      ).toBeGreaterThanOrEqual(lowerBound)
      expect(
        approxTokenCount,
        `${requestClass} prompt drifted outside ${baseline.tolerancePct}% of baseline ${baseline.target}`,
      ).toBeLessThanOrEqual(upperBound)
    }
  })
})
