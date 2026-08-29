import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { ALL_AI_REQUEST_CLASSES } from '../../../../src/services/ai/aiRequestClasses'

vi.mock('@netlify/functions', () => ({
  stream: <T>(handler: T) => handler,
}))

const CLASSES = Object.keys(ALL_AI_REQUEST_CLASSES)
const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf8')

function extractTypeUnion(source: string, typeName: string): string {
  const match = source.match(new RegExp(`(?:export )?type ${typeName} =([\\s\\S]*?)(?:\\n(?:export )?(?:type|interface|const|function|class) )`))
  if (!match?.[1]) throw new Error(`No se encontró la unión ${typeName}`)
  return match[1]
}

function extractConstObject(source: string, constName: string): string {
  const match = source.match(new RegExp(`const ${constName}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!match?.[1]) throw new Error(`No se encontró el objeto ${constName}`)
  return match[1]
}

function extractFunction(source: string, functionName: string): string {
  const match = source.match(new RegExp(`function ${functionName}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`))
  if (!match?.[1]) throw new Error(`No se encontró la función ${functionName}`)
  return match[1]
}

describe('la clase del asistente está en las representaciones runtime y SQL', () => {
  it.each([
    ['proxy', '../../coach.ts', 'RequestClass'],
    ['telemetría', '../coachRequestTelemetry.ts', 'CoachRequestClass'],
    ['middleware de desarrollo', '../../../../dev/coachProxyMiddleware.ts', 'RequestClass'],
  ])('%s enumera las 8 clases', (_name, rel, typeName) => {
    const source = extractTypeUnion(read(rel), typeName)
    for (const requestClass of CLASSES) {
      expect(source, requestClass).toContain(`'${requestClass}'`)
    }
  })

  it('mantiene el CHECK SQL sincronizado con la enumeración canónica', () => {
    const sql = read('../../../../supabase/023_coach_assistant_request_class.sql')
    const check = sql.match(/check\s*\(\s*request_class\s+in\s*\(([\s\S]*?)\)\s*\)/i)
    expect(check?.[1]).toBeDefined()
    const sqlClasses = [...(check?.[1] ?? '').matchAll(/'([^']+)'/g)]
      .map((match) => match[1])
      .sort()

    expect(sqlClasses).toEqual([...CLASSES].sort())
  })

  it('descubre el CHECK por catálogo y verifica que quede una sola autoridad', () => {
    const sql = read('../../../../supabase/023_coach_assistant_request_class.sql')
    expect(sql).toMatch(/from pg_constraint[\s\S]*?unnest\(c\.conkey\)/i)
    expect(sql).toContain("a.attname = 'request_class'")
    expect(sql).toMatch(/matching_count\s*<>\s*1/i)
    expect(sql).not.toMatch(/drop constraint if exists coach_requests_request_class_check/i)
  })

  it('el proxy declara los parámetros operativos y proveedor por clase', () => {
    const source = read('../../coach.ts')
    expect(extractConstObject(source, 'REQUEST_TIMEOUTS')).toMatch(/coach_assistant_message:\s*15000/)
    expect(extractConstObject(source, 'REQUEST_MAX_TOKENS')).toMatch(/coach_assistant_message:\s*260/)
    expect(extractConstObject(source, 'SYSTEM_PROMPT_MAX_CHARS')).toMatch(/coach_assistant_message:\s*8000/)
    expect(extractConstObject(source, 'CLASS_DEFAULT_PROVIDER')).toMatch(/coach_assistant_message:\s*'gemini'/)
    expect(extractFunction(source, 'getGeminiThinkingBudget'))
      .toMatch(/case 'coach_assistant_message':[\s\S]*?return 0/)
  })

  it('el validador runtime del proxy admite las 8 clases', () => {
    const validator = extractFunction(read('../../coach.ts'), 'isKnownRequestClass')
    for (const requestClass of CLASSES) {
      expect(validator, requestClass).toContain(`'${requestClass}'`)
    }
  })

  it('el asistente no usa retry técnico', async () => {
    const { CLASS_DEFAULT_PROVIDER, shouldUseTechnicalRetryForTest } = await import('../../coach')
    expect(Object.keys(CLASS_DEFAULT_PROVIDER).sort()).toEqual([...CLASSES].sort())
    expect(CLASS_DEFAULT_PROVIDER.coach_assistant_message).toBe('gemini')
    expect(shouldUseTechnicalRetryForTest('coach_assistant_message')).toBe(false)
    expect(shouldUseTechnicalRetryForTest('chat_general')).toBe(true)
  })
})
