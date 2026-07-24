import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { PlanGenerationJobTelemetry } from '../../../../src/services/planBuilder/asyncGenerationLoop'
import { planGenerationJobToRow } from '../planGenerationJobTelemetry'

function readMigration(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return readFileSync(join(here, '..', '..', '..', '..', 'supabase', '016_plan_generation_jobs.sql'), 'utf8')
}

const JOB: PlanGenerationJobTelemetry = {
  jobId: 'j', athleteId: 'a', planId: 'p', enqueuedAt: 1, workerStartedAt: 2,
  weekCountRequested: 1, weekCountSucceeded: 1, weekCountFailed: 0, workerConcurrency: 3,
  firstWeekReadyMs: 1, firstWeekReadyE2eMs: 1, planCompleteMs: 1, terminalMs: 1,
  previousWeekContextSource: 'none', totalInputTokens: 0, totalOutputTokens: 0,
  totalCacheReadTokens: 0, totalCacheCreationTokens: 0, estimatedCostUsd: 0, outcome: 'succeeded',
  variant: {
    provider: 'claude', model: 'claude-sonnet-4-6', effort: 'omitted', thinkingMode: 'omitted',
    temperature: 0.25, maxTokens: 5000, promptVersion: 'v', schemaVersion: 'v',
    qualityVersion: 1, concurrency: 3, variantId: 'v',
  },
  createdAt: 3,
}

describe('plan_generation_jobs schema drift guard', () => {
  it('the CREATE columns and the row mapper keys are the same set', () => {
    const sql = readMigration()
    const createBlock = sql.slice(
      sql.indexOf('create table if not exists public.plan_generation_jobs'),
      sql.indexOf('create index'),
    )
    const sqlColumns = new Set(
      // Column identifiers can contain digits (e.g. first_week_ready_e2e_ms),
      // so the tokenizer class includes 0-9 — otherwise it truncates at the digit.
      [...createBlock.matchAll(/^\s{2}([a-z0-9_]+)\s/gm)]
        .map((m) => m[1])
        .filter((name) => !['create', 'primary', 'constraint', 'check', 'references'].includes(name)),
    )
    const rowColumns = new Set(Object.keys(planGenerationJobToRow(JOB, 'user-1')))
    // Ambos sentidos: sin columnas SQL huérfanas ni claves de mapper sin columna.
    expect([...rowColumns].filter((c) => !sqlColumns.has(c))).toEqual([])
    expect([...sqlColumns].filter((c) => !rowColumns.has(c))).toEqual([])
  })

  it('declares the derived column and comments it', () => {
    const sql = readMigration()
    expect(sql).toContain('first_week_discoverable_estimated_ms')
    expect(sql).toMatch(/comment on column public\.plan_generation_jobs\.first_week_discoverable_estimated_ms/)
  })

  it('the ALTER adds every new attempt column the mapper writes', () => {
    const sql = readMigration()
    const newAttemptColumns = [
      'variant_id', 'effort', 'thinking_mode', 'prompt_version', 'schema_version', 'quality_version',
      'repair_taxonomy_version', 'corrective_action_count', 'structural_action_count', 'hydration_action_count',
      'moved_session_count', 'filtered_sport_count',
      'hydrated_sessions_affected', 'corrected_sessions_affected', 'structurally_repaired_sessions_affected',
    ]
    for (const column of newAttemptColumns) {
      expect(sql, `attempt column ${column}`).toContain(`add column if not exists ${column}`)
    }
  })
})
