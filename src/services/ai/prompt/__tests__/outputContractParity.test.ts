import { describe, expect, it } from 'vitest'

import {
  ACTION_CONTRACTS,
  type ActionContract,
  type FieldSpec,
} from '../core/outputContract'
import { renderActionAsProse } from '../renderers/proseSchema'

/**
 * Parity tests between the structural contract (`ACTION_CONTRACTS`) and the
 * prose schema emitted into prompts. Catches drift like:
 *  - a new required field added to `fields[]` but not documented in prose
 *  - an enum value declared in `fields[]` but not mentioned in prose
 *
 * Reverse direction (prose mentions something not in `fields[]`) is intentionally
 * not asserted — prose is allowed to be richer (e.g. mentioning warmup/cooldown
 * which are app-generated and not part of the schema, or describing
 * sessionType="recovery"/"nutrition" which the structural enum narrows for
 * Gemini structured output). Document any such divergence in this file.
 */

function getSessionContract(action: ActionContract): readonly FieldSpec[] | undefined {
  const sessions = action.fields.find((f) => f.name === 'sessions')
  if (!sessions || sessions.type !== 'ARRAY') return undefined
  const item = sessions.items
  if (!item || item.type !== 'OBJECT') return undefined
  return item.fields
}

function collectRequiredFieldNames(fields: readonly FieldSpec[]): string[] {
  const names = new Set<string>()
  const walk = (specs: readonly FieldSpec[]) => {
    for (const spec of specs) {
      if (spec.required) names.add(spec.name)
      if (spec.type === 'OBJECT' && spec.fields) walk(spec.fields)
      if (spec.type === 'ARRAY' && spec.items?.type === 'OBJECT' && spec.items.fields) {
        walk(spec.items.fields)
      }
    }
  }
  walk(fields)
  return [...names]
}

function collectEnumValues(fields: readonly FieldSpec[]): string[] {
  const values = new Set<string>()
  const walk = (specs: readonly FieldSpec[]) => {
    for (const spec of specs) {
      if (spec.enumValues) {
        for (const v of spec.enumValues) values.add(v)
      }
      if (spec.type === 'OBJECT' && spec.fields) walk(spec.fields)
      if (spec.type === 'ARRAY' && spec.items?.type === 'OBJECT' && spec.items.fields) {
        walk(spec.items.fields)
      }
    }
  }
  walk(fields)
  return [...values]
}

describe('Output contract ↔ prose parity (create_week)', () => {
  const action = ACTION_CONTRACTS.create_week
  const sessionFields = getSessionContract(action)

  it('exposes a session contract under sessions[].items.fields', () => {
    expect(sessionFields, 'create_week.sessions[].items must declare fields').toBeDefined()
    expect(sessionFields!.length).toBeGreaterThan(0)
  })

  describe('full density', () => {
    const prose = renderActionAsProse(action, 'full')

    it('mentions every required session field by name', () => {
      const required = collectRequiredFieldNames(sessionFields ?? [])
      const missing = required.filter((name) => !prose.includes(name))
      expect(
        missing,
        `prose.full must mention required field(s): ${missing.join(', ')}`,
      ).toEqual([])
    })

    it('mentions every enum value declared in the session contract', () => {
      const enums = collectEnumValues(sessionFields ?? [])
      const missing = enums.filter((value) => !prose.includes(value))
      expect(
        missing,
        `prose.full must mention enum value(s): ${missing.join(', ')}`,
      ).toEqual([])
    })
  })

  describe('minimal density', () => {
    const prose = renderActionAsProse(action, 'minimal')

    /**
     * Minimal prose explicitly tells the model to omit sport-specific details
     * (squashDetails, exercises, cyclingDetails, mobilityDetails). Only base
     * session fields are asserted here.
     */
    const baseRequired = ['date', 'timeBlock', 'sessionType', 'title', 'durationMin', 'objective']

    it('mentions every base session field by name', () => {
      const missing = baseRequired.filter((name) => !prose.includes(name))
      expect(
        missing,
        `prose.minimal must mention base field(s): ${missing.join(', ')}`,
      ).toEqual([])
    })

    it('mentions every enum value of base session fields', () => {
      const baseSet = new Set(baseRequired)
      const baseFields = (sessionFields ?? []).filter((f) => baseSet.has(f.name))
      const enums = collectEnumValues(baseFields)
      const missing = enums.filter((value) => !prose.includes(value))
      expect(
        missing,
        `prose.minimal must mention enum value(s): ${missing.join(', ')}`,
      ).toEqual([])
    })

    it('explicitly instructs the model to omit sport-specific details', () => {
      expect(prose).toContain('NO incluyas squashDetails')
    })
  })
})
