import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { coachRequestToRow, type CoachRequestTelemetry } from '../coachRequestTelemetry'

function readMigration(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return readFileSync(
    join(here, '..', '..', '..', '..', 'supabase', '018_coach_requests.sql'),
    'utf8',
  )
}

const TELEMETRY: CoachRequestTelemetry = {
  traceId: 't',
  userId: '11111111-1111-4111-8111-111111111111',
  requestClass: 'chat_general',
  streamed: true,
  outcome: 'ok',
  authDurationMs: 1,
  serverDurationMs: 2,
  createdAt: 3,
}

describe('coach_requests schema drift guard', () => {
  it('las columnas del CREATE y las claves del mapper son el mismo conjunto', () => {
    const sql = readMigration()
    const createBlock = sql.slice(
      sql.indexOf('create table if not exists public.coach_requests'),
      sql.indexOf('create index'),
    )
    const sqlColumns = new Set(
      [...createBlock.matchAll(/^\s{2}([a-z0-9_]+)\s/gm)]
        .map((match) => match[1])
        // `id` lo genera PostgreSQL; el mapper describe solo las columnas que
        // el insert escribe. La excepción queda fijada explícitamente abajo.
        .filter((name) => name !== 'id')
        .filter((name) => ![
          'create',
          'primary',
          'constraint',
          'check',
          'references',
        ].includes(name)),
    )
    const rowColumns = new Set(Object.keys(coachRequestToRow(TELEMETRY)))

    expect([...rowColumns].filter((column) => !sqlColumns.has(column))).toEqual([])
    expect([...sqlColumns].filter((column) => !rowColumns.has(column))).toEqual([])
  })

  it('declara RLS con select e insert propios y sin update ni delete para clientes', () => {
    const sql = readMigration()
    expect(sql).toContain('alter table public.coach_requests enable row level security')
    expect(sql).toMatch(
      /create policy coach_requests_select_own[\s\S]*?for select[\s\S]*?using \(auth\.uid\(\) = user_id\)/,
    )
    expect(sql).toMatch(
      /create policy coach_requests_insert_own[\s\S]*?for insert[\s\S]*?with check \(auth\.uid\(\) = user_id\)/,
    )
    expect(sql).not.toMatch(/for update/i)
    expect(sql).not.toMatch(/for delete/i)
  })

  it('restringe outcome a los 2 valores vigentes', () => {
    const sql = readMigration()
    expect(sql).toMatch(/outcome text not null check \(outcome in \('ok', 'error'\)\)/)
  })

  it('user_id es not null con FK a auth.users y cascade', () => {
    const sql = readMigration()
    expect(sql).toMatch(
      /user_id uuid not null references auth\.users\(id\) on delete cascade/,
    )
  })

  it('usa una PK generada y permite repetir trace_id entre requests', () => {
    const sql = readMigration()
    expect(sql).toMatch(/id bigint generated always as identity primary key/)
    expect(sql).toMatch(/trace_id text not null/)
    expect(sql).not.toMatch(/trace_id text[^,\n]*primary key/)
    expect(sql).toMatch(/coach_requests_trace_created_idx[\s\S]*?\(trace_id, created_at desc\)/)
  })
})
