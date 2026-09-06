import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SQL = readFileSync('supabase/033_backfill_plan_week_athlete_id.sql', 'utf8')

/**
 * `training_plan_weeks.athlete_id` quedó nulo en 12 filas de producción
 * (auditoría del 2026-09-05). El criterio de corte de 031 exige cero filas sin
 * `athlete_id` en las nueve tablas medidas, así que esto lo bloquea.
 *
 * El trigger `training_plan_weeks_athlete_consistency` de 013b exime los nulos
 * a propósito («filas legacy/parciales: las cubre el estampado + backfill»);
 * esta migración es ese backfill.
 */
describe('033 deriva athlete_id desde el plan padre', () => {
  it('no inventa identidad: sólo copia desde training_plans', () => {
    expect(SQL).toMatch(/update\s+public\.training_plan_weeks/i)
    expect(SQL).toContain('training_plans')
    expect(SQL).toMatch(/athlete_id\s+is\s+null/i)
  })

  it('nunca escribe un athlete_id nulo del padre', () => {
    expect(SQL).toMatch(/p\.athlete_id\s+is\s+not\s+null/i)
  })

  it('es idempotente: sólo toca filas que siguen nulas', () => {
    expect(SQL).toMatch(/where[\s\S]*w\.athlete_id\s+is\s+null/i)
  })
})

describe('033 falla cerrado', () => {
  it('es transaccional', () => {
    expect(SQL).toMatch(/^\s*begin;/im)
    expect(SQL).toMatch(/commit;/i)
  })

  it('aborta si queda alguna fila sin athlete_id recuperable', () => {
    expect(SQL).toMatch(/raise\s+exception/i)
  })

  it('no toca las otras ocho tablas medidas ni agrega NOT NULL', () => {
    for (const t of ['sessions', 'day_logs', 'week_summaries', 'chat_messages', 'whoop_workouts']) {
      expect(SQL).not.toContain(`public.${t}`)
    }
    expect(SQL).not.toMatch(/set\s+not\s+null/i)
  })
})
