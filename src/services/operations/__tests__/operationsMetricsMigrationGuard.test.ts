import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OPERATIONS_METRIC_KEYS } from '../operationsMetricsContract'

const SQL = readFileSync(
  resolve(process.cwd(), 'supabase/022_operations_metrics.sql'),
  'utf8',
)

describe('022_operations_metrics.sql', () => {
  it('emite cada clave del contrato', () => {
    for (const key of OPERATIONS_METRIC_KEYS) {
      expect(SQL).toContain(`'${key}'`)
    }
  })

  it('el RPC es security definer con search_path fijo', () => {
    expect(SQL).toContain('security definer')
    expect(SQL).toContain('set search_path = public')
  })

  it('revoca a public/anon/authenticated y concede solo a service_role', () => {
    expect(SQL).toMatch(/revoke all on function public\.read_operations_metrics\(timestamptz\)\s*\n?\s*from public, anon, authenticated;/)
    expect(SQL).toMatch(/grant execute on function public\.read_operations_metrics\(timestamptz\)\s*\n?\s*to service_role;/)
  })

  it('ningun grant alcanza a authenticated', () => {
    const grants = SQL.match(/grant [^;]+;/g) ?? []
    expect(grants.some((line) => /\bauthenticated\b/.test(line))).toBe(false)
  })

  it('tolera ai_usage_daily ausente con to_regclass', () => {
    expect(SQL).toContain("to_regclass('public.ai_usage_daily')")
  })

  it('nunca selecciona user_id crudo: solo count(distinct user_id)', () => {
    const selectsRawUserId = /select\s+user_id/i.test(SQL)
    expect(selectsRawUserId).toBe(false)
    expect(SQL).toContain('count(distinct user_id)')
  })

  it('usa las columnas de tokens propias de cada tabla de telemetria', () => {
    const coachStart = SQL.indexOf("'requests', count(*)")
    const coachBlock = SQL.slice(coachStart, SQL.indexOf('into v_coach'))
    expect(coachBlock).toContain('prompt_tokens')
    expect(coachBlock).toContain('completion_tokens')
    expect(coachBlock).not.toMatch(/coalesce\(total_input_tokens/)

    const planStart = SQL.indexOf("'runs', count(*)")
    const planBlock = SQL.slice(planStart, SQL.indexOf('into v_plan'))
    expect(planBlock).toContain('total_input_tokens')
    expect(planBlock).toContain('total_output_tokens')
    expect(planBlock).not.toMatch(/coalesce\(prompt_tokens/)
  })

  it('mide primera semana end-to-end y normaliza campos operacionales expuestos', () => {
    expect(SQL).toMatch(/order by first_week_ready_e2e_ms/)
    expect(SQL).not.toMatch(/order by first_week_ready_ms/)
    expect(SQL).toContain("to_char($1::date, 'YYYY-MM-DD')")
    expect(SQL).toContain("left(coalesce(error_code, 'sin_codigo'), 40)")
    expect(SQL).toContain("'totalCostUsd'")
    expect(SQL).toContain("'totalCostCoverage'")
    expect(SQL).toMatch(/order by \(\s*plan_complete_ms \+ extract\(epoch from \(worker_started_at - enqueued_at\)\) \* 1000/)
  })

  it('crea índices por created_at para las tres fuentes agregadas', () => {
    expect(SQL).toContain('coach_requests_created_idx')
    expect(SQL).toContain('plan_generation_jobs_created_idx')
    expect(SQL).toContain('plan_generation_attempts_created_idx')
  })
})
