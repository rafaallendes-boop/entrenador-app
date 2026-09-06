import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const CUT = readFileSync('supabase/031_retire_legacy_policies.sql', 'utf8')
const ROLLBACK = readFileSync('supabase/032_restore_legacy_policies.sql', 'utf8')
const NOT_NULL = readFileSync('supabase/034_athlete_id_not_null.sql', 'utf8')

const dropped = (sql: string): string[] =>
  [...sql.matchAll(/^drop policy if exists "?([a-z0-9_: ]+?)"? on public\.(\w+);$/gim)]
    .map((m) => `${m[2]}.${m[1]}`)

const created = (sql: string): string[] =>
  [...sql.matchAll(/^create policy "?([a-z0-9_: ]+?)"? on public\.(\w+)$/gim)]
    .map((m) => `${m[2]}.${m[1]}`)

/**
 * El dump de producción del 2026-09-05 tiene 78 policies sobre las 13 tablas del
 * alcance: 49 legacy, 28 v2 y `athlete_memberships_select_own`. El corte retira
 * 48, no 49 — ver specs/2026-09-06-migration-031-cut-design.md.
 */
describe('031 retira 48 legacy y conserva el bootstrap de athletes', () => {
  it('retira exactamente 48 policies legacy', () => {
    // `athletes_delete_membership` se dropea sólo por idempotencia antes de crearla.
    const legacy = dropped(CUT).filter((p) => p !== 'athletes.athletes_delete_membership')
    expect(legacy).toHaveLength(48)
    expect(new Set(legacy).size).toBe(48)
  })

  it('NO retira athletes_insert: la membresía se siembra desde ese propio insert', () => {
    expect(CUT).not.toMatch(/drop\s+policy\s+if\s+exists\s+"?athletes_insert"?\s+on/i)
    expect(CUT).toMatch(/alter policy athletes_insert on public\.athletes rename to athletes_insert_bootstrap_owner/i)
  })

  it('sí retira athletes_delete y lo reemplaza por una policy de membresía', () => {
    expect(dropped(CUT)).toContain('athletes.athletes_delete')
    expect(CUT).toMatch(/create policy athletes_delete_membership on public\.athletes/i)
    expect(CUT).toMatch(/for delete using \(id in \(select public\.auth_deletable_athlete_ids\(\)\)\)/i)
  })

  it('el helper del delete es security definer y excluye self y reclamados', () => {
    const fn = CUT.slice(CUT.indexOf('function public.auth_deletable_athlete_ids'))
    expect(fn).toMatch(/security\s+definer/i)
    expect(fn).toMatch(/role\s*=\s*'coach'/)
    expect(fn).toMatch(/not exists[\s\S]*role\s*=\s*'self'/)
    expect(fn).toMatch(/linked_account_id is null or a\.linked_account_id = a\.owner_account_id/i)
  })

  it('no concede el helper a anon', () => {
    expect(CUT).toMatch(/revoke all on function public\.auth_deletable_athlete_ids\(\) from public, anon/i)
    expect(CUT).toMatch(/grant execute on function public\.auth_deletable_athlete_ids\(\) to authenticated/i)
  })

  it('es fail-closed: aborta sin las 29 policies v2 o con filas sin athlete_id', () => {
    expect(CUT).toMatch(/esperadas constant int := 29/)
    expect(CUT).toMatch(/raise exception[\s\S]*policies v2 instaladas/i)
    expect(CUT).toMatch(/athlete_id is null[\s\S]*raise exception/i)
    expect(CUT).toMatch(/to_regprocedure\('public\.' \|\| f \|\| '\(\)'\) is null/)
  })

  it('corre en una transacción y verifica el estado final', () => {
    expect(CUT.trimStart()).toMatch(/^--/)
    expect(CUT).toMatch(/\bbegin;/)
    expect(CUT).toMatch(/\bcommit;/)
    expect(CUT).toMatch(/quedan % policies legacy y se esperaba exactamente 1/)
  })

  it('el reclamo directo se rechaza sólo para filas nuevas', () => {
    // 030 tuvo que eximir el re-upsert del self por la misma razón: los triggers
    // BEFORE INSERT corren antes de resolver el conflicto.
    expect(CUT).toMatch(/not exists \(select 1 from public\.athletes a where a\.id = new\.id\)/i)
    expect(CUT).toMatch(/claiming an athlete requires the SP1b invite RPCs/)
  })
})

describe('032 revierte 031 con el texto del dump', () => {
  it('recrea exactamente las 48 policies que 031 retira', () => {
    const legacy = dropped(CUT).filter((p) => p !== 'athletes.athletes_delete_membership')
    expect(created(ROLLBACK).sort()).toEqual(legacy.sort())
  })

  it('deshace el rename y retira la policy y el helper nuevos', () => {
    expect(ROLLBACK).toMatch(/rename to athletes_insert/i)
    expect(ROLLBACK).toMatch(/drop policy if exists athletes_delete_membership/i)
    expect(ROLLBACK).toMatch(/drop function if exists public\.auth_deletable_athlete_ids/i)
  })

  it('restaura el cuerpo del trigger sin la rama de reclamo', () => {
    const fn = ROLLBACK.slice(ROLLBACK.indexOf('function public.enforce_athlete_role_invariants'))
    expect(fn).not.toMatch(/claiming an athlete/)
    expect(fn).toMatch(/a coach account cannot own a self athlete/)
  })

  it('NO revierte 034: quitar el not null sólo reabre filas sin scope', () => {
    // Lo menciona en un comentario como salida manual; no debe ejecutarlo.
    const ejecutable = ROLLBACK.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    expect(ejecutable).not.toMatch(/alter column athlete_id drop not null/i)
  })
})

describe('034 impone athlete_id not null como precondición del corte', () => {
  it('cubre las ocho tablas que faltaban, no athlete_profiles', () => {
    const tablas = [...NOT_NULL.matchAll(/alter table public\.(\w+)\s+alter column athlete_id set not null/gi)]
      .map((m) => m[1])
    expect(tablas.sort()).toEqual([
      'chat_messages', 'coach_proposals', 'day_logs', 'sessions',
      'training_plan_weeks', 'training_plans', 'week_summaries', 'whoop_workouts',
    ])
    // `athlete_profiles` ya quedó not null en 026.
    expect(tablas).not.toContain('athlete_profiles')
  })

  it('aborta antes de imponer el constraint si queda una fila sin scope', () => {
    const guard = NOT_NULL.slice(0, NOT_NULL.indexOf('alter table public.sessions'))
    expect(guard).toMatch(/raise exception[\s\S]*filas sin athlete_id/i)
  })

  it('verifica el estado final sobre las nueve tablas', () => {
    const check = NOT_NULL.slice(NOT_NULL.indexOf('Verificación del estado final'))
    expect(check).toContain('athlete_profiles')
    expect(check).toMatch(/is_nullable = 'YES'/)
  })
})
