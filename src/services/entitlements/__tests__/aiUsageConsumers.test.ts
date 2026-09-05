import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AI_USAGE_DAILY_CONSUMERS } from '../aiUsageConsumers'

/** Cuerpo de una función SQL: desde su `create ... function public.<name>(` hasta el `$$;` que la cierra. */
function sqlFunctionBody(sql: string, name: string): string {
  const start = sql.indexOf(`function public.${name}(`)
  if (start < 0) return ''
  const open = sql.indexOf('as $$', start)
  const close = sql.indexOf('$$;', open)
  return open < 0 || close < 0 ? '' : sql.slice(open, close)
}

/** Cuerpo de una función TS exportada: hasta el siguiente `export` de nivel superior. */
function tsFunctionBody(source: string, name: string): string {
  const start = source.search(new RegExp(`export (?:async )?function ${name}\\b`))
  if (start < 0) return ''
  const next = source.indexOf('\nexport ', start + 1)
  return next < 0 ? source.slice(start) : source.slice(start, next)
}

function consumerBody(consumer: { name: string; file: string }): string {
  const source = readFileSync(consumer.file, 'utf8')
  return consumer.file.endsWith('.sql')
    ? sqlFunctionBody(source, consumer.name)
    : tsFunctionBody(source, consumer.name)
}

describe('consumidores de ai_usage_daily', () => {
  it('están los seis declarados', () => {
    expect(AI_USAGE_DAILY_CONSUMERS.map((c) => c.name).sort()).toEqual([
      'checkUsagePreflight',
      'increment_ai_usage_cost',
      'increment_ai_usage_if_under_limit',
      'read_ai_usage_spend',
      'read_operations_metrics',
      'reserve_ai_usage',
    ])
  })

  it('cada consumidor distingue el eje EN SU PROPIO CUERPO', () => {
    // Un `source.includes(...)` sobre el archivo entero es vacuo: los cinco
    // consumidores de SQL comparten `029`, así que una sola mención los da por
    // buenos a todos. Se recorta el bloque de cada uno.
    for (const consumer of AI_USAGE_DAILY_CONSUMERS) {
      const body = consumerBody(consumer)
      expect(
        body.length,
        `${consumer.name}: no se encontró su bloque en ${consumer.file}`,
      ).toBeGreaterThan(0)
      expect(
        body.includes('subject_athlete_id'),
        `${consumer.name} (${consumer.file}) no distingue el eje en su cuerpo`,
      ).toBe(true)
    }
  })

  it('checkUsagePreflight distingue la fila global de la fila por sujeto', () => {
    const consumer = AI_USAGE_DAILY_CONSUMERS.find((c) => c.name === 'checkUsagePreflight')
    expect(consumer).toBeDefined()
    const body = consumerBody(consumer!)
    expect(body.length).toBeGreaterThan(0)
    expect(body.includes('subject_athlete_id')).toBe(true)
  })

  it('el recorte no es vacuo: una función sin el eje falla', () => {
    // Sin este caso, un `sqlFunctionBody` que devolviera el archivo entero
    // reintroduciría el guard vacuo sin que nadie lo note.
    const fake = [
      'create or replace function public.impostor(p uuid)',
      'returns void language sql as $$',
      '  select 1 from public.ai_usage_daily where user_id = p;',
      '$$;',
    ].join('\n')
    expect(sqlFunctionBody(fake, 'impostor')).not.toContain('subject_athlete_id')
  })

  it('las DOS rutas de reserva cortan con límite nulo, no sólo con < 1', () => {
    // `null < 1` es null, no true: sin este guard un límite ausente concede la
    // primera request del día en vez de cero.
    const sql = readFileSync('supabase/029_ai_usage_daily_subject.sql', 'utf8')
    for (const name of ['reserve_ai_usage', 'increment_ai_usage_if_under_limit']) {
      expect(
        sqlFunctionBody(sql, name),
        `${name} no corta con p_limit nulo`,
      ).toMatch(/p_limit\s+is\s+null\s+or\s+p_limit\s*<\s*1/i)
    }
  })

  it('las funciones plpgsql redefinidas declaran variable_conflict', () => {
    // Misma clase de defecto que 024: `usage_date` y `request_count` son
    // columna y parámetro OUT a la vez.
    const sql = readFileSync('supabase/029_ai_usage_daily_subject.sql', 'utf8')
    const plpgsqlBlocks = sql.split('language plpgsql').length - 1
    const guards = sql.split('#variable_conflict use_column').length - 1
    expect(guards).toBeGreaterThanOrEqual(plpgsqlBlocks)
  })

  it('029 redefine el incrementador legacy: la PK vieja ya no existe', () => {
    const sql = readFileSync('supabase/029_ai_usage_daily_subject.sql', 'utf8')
    expect(sql).toContain('increment_ai_usage_if_under_limit')
  })

  it('la métrica se copia de 025, que trae safetyBlocked', () => {
    const sql = readFileSync('supabase/029_ai_usage_daily_subject.sql', 'utf8')
    expect(sql).toContain('safetyBlocked')
  })

  it('un solo commit al final: nada queda a medio migrar', () => {
    const sql = readFileSync('supabase/029_ai_usage_daily_subject.sql', 'utf8')
    expect(sql.match(/^commit;/gim)?.length ?? 0).toBe(1)
  })

  it('el rechazo de cuota viaja como 45001 con el scope en detail', () => {
    const body = sqlFunctionBody(
      readFileSync('supabase/029_ai_usage_daily_subject.sql', 'utf8'),
      'reserve_ai_usage',
    )
    expect(body).toContain("errcode = '45001'")
    expect(body).toContain("detail = 'account'")
    expect(body).toContain("detail = 'subject'")
  })

  it('costo, spend cap y métricas leen SÓLO la fila global', () => {
    const sql = readFileSync('supabase/029_ai_usage_daily_subject.sql', 'utf8')
    for (const name of ['increment_ai_usage_cost', 'read_ai_usage_spend', 'read_operations_metrics']) {
      expect(sqlFunctionBody(sql, name), `${name} no filtra la fila global`).toMatch(
        /subject_athlete_id\s*=\s*''/,
      )
    }
  })
})
