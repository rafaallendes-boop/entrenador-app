import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { classifySyncError } from '../syncUtils'

const SERVICE = readFileSync('src/services/syncService.ts', 'utf8')

/**
 * Precondición de `031`: cuando la membresía sea la única autoridad de RLS,
 * toda policy v2 predica `athlete_id in (…)`, que es FALSE con null. Una fila
 * scoped sin `athlete_id` deja de ser alcanzable para siempre.
 *
 * Hasta el corte esas filas entran por la policy legacy `auth.uid() = user_id`,
 * así que el defecto es silencioso. Estos tests fijan que el cliente deje de
 * producirlas.
 */
describe('withAthleteId es total', () => {
  it('cae al self athlete antes de rendirse', () => {
    const fn = SERVICE.slice(
      SERVICE.indexOf('function withAthleteId('),
      SERVICE.indexOf('const ATHLETE_SCOPED_WRITE_TABLES'),
    )
    expect(fn).toMatch(/entityAthleteId \?\? getActiveAthleteId\(\) \?\? getSelfAthleteId\(\)/)
  })

  it('cubre las ocho tablas scoped y excluye athletes, cuyo scope es su propio id', () => {
    const set = SERVICE.slice(
      SERVICE.indexOf('const ATHLETE_SCOPED_WRITE_TABLES'),
      SERVICE.indexOf('function assertAthleteScopedPayload'),
    )
    for (const table of [
      'sessions', 'day_logs', 'week_summaries', 'chat_messages',
      'coach_proposals', 'athlete_profiles', 'training_plans', 'training_plan_weeks',
    ]) {
      expect(set).toContain(`'${table}'`)
    }
    expect(set).not.toMatch(/'athletes'/)
    expect(set).not.toMatch(/'whoop_workouts'/)
  })

  it('el guard corre dentro del try de upsertRow, para que lo clasifique el catch', () => {
    const upsert = SERVICE.slice(SERVICE.indexOf('const upsertStartedAt = Date.now()'))
    const guard = upsert.indexOf('assertAthleteScopedPayload(table, payload)')
    const network = upsert.indexOf('ensureRemoteAthlete(')
    expect(guard).toBeGreaterThan(-1)
    // Antes de cualquier llamada de red: no se gasta una request en una fila
    // que igual sería irrecuperable.
    expect(guard).toBeLessThan(network)
  })

  it('la cola repara la operación vieja en vez de descartarla', () => {
    const drain = SERVICE.slice(SERVICE.indexOf("} else if (op.action === 'upsert') {"))
    expect(drain).toMatch(/const upsertPayload = withAthleteId\(op\.payload\)/)
    expect(drain).toMatch(/assertAthleteScopedPayload\(op\.table, upsertPayload\)/)
    // El payload reparado es el que viaja, no el original.
    expect(drain.slice(0, drain.indexOf("session_completion"))).not.toMatch(/upsert\(op\.payload as never\)/)
  })

  it('los planes se estampan igual que sus semanas', () => {
    expect(SERVICE).toMatch(/upsertRow\(\s*'training_plans',\s*withAthleteId\(/)
  })
})

describe('una fila sin scope se rechaza sin gastar reintentos', () => {
  const error = new Error('missing athlete scope on sessions: refusing to write an unscoped row')

  it('se clasifica como validation_error no reintentable', () => {
    const info = classifySyncError(error, 'sessions')
    expect(info.category).toBe('validation_error')
    expect(info.retriable).toBe(false)
    expect(info.autoRepairable).toBe(false)
  })

  it('el mensaje al usuario no expone el detalle técnico', () => {
    const info = classifySyncError(error, 'sessions')
    expect(info.userMessage).not.toContain('athlete_id')
    expect(info.userMessage).not.toContain('missing athlete scope')
    expect(info.technicalMessage).toContain('Missing athlete scope on sessions')
  })

  it('no se confunde con el caso de atleta gestionado ausente', () => {
    const managed = classifySyncError(
      new Error('managed athlete ath_x not found locally; deferring child push'),
      'sessions',
    )
    expect(managed.technicalMessage).toContain('Missing managed athlete')
  })
})
