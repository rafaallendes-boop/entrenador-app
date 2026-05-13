import type { ActionContract, FieldSpec } from '../core/outputContract'

/**
 * Runtime validator derived from an `ActionContract`. Covers what the contract
 * structurally encodes: required field presence, enum membership, basic type
 * checks, and required non-empty arrays. Does NOT cover:
 *  - String format (ISO date, regex) — not modeled in FieldSpec
 *  - Conditional/discriminator rules (e.g. "if sessionType=squash → squashDetails required")
 *  - Numeric ranges (rpe between 1-10, durationMin >= 5)
 *  - Business rules (allowed days/sports, counts, catalog membership)
 *
 * Those remain the responsibility of the caller's imperative validation.
 */

export interface ContractValidationResult {
  ok: boolean
  error?: string
  path?: string
}

export interface ContractValidationOptions {
  /**
   * Field names where recursion stops. The field's top-level type is still
   * checked (e.g. "is it an object?" or "is it an array?") but its children
   * are not recursively validated:
   *   - OBJECT field → inner `fields` are not validated
   *   - ARRAY field → items inside the array are not validated
   *
   * Useful when nested structures carry conditional rules or union types
   * that the imperative caller wants to own (e.g. sport-specific details
   * whose required-ness depends on a sibling discriminator, or strength
   * exercises where `reps` accepts both number and string).
   */
  skipDeep?: readonly string[]
}

const OK: ContractValidationResult = { ok: true }

export function validateAgainstContract(
  value: unknown,
  contract: ActionContract,
  options: ContractValidationOptions = {},
): ContractValidationResult {
  if (typeof value !== 'object' || value === null) {
    return fail(contract.kind, 'se esperaba un objeto')
  }
  return validateObject(value as Record<string, unknown>, contract.fields, contract.kind, options)
}

function validateObject(
  obj: Record<string, unknown>,
  fields: readonly FieldSpec[],
  path: string,
  options: ContractValidationOptions,
): ContractValidationResult {
  for (const field of fields) {
    const childPath = `${path}.${field.name}`
    const result = validateField(obj[field.name], field, childPath, options)
    if (!result.ok) return result
  }
  return OK
}

function validateField(
  value: unknown,
  field: FieldSpec,
  path: string,
  options: ContractValidationOptions,
): ContractValidationResult {
  if (value === undefined || value === null) {
    if (field.required) return fail(path, 'campo obligatorio ausente')
    return OK
  }

  switch (field.type) {
    case 'STRING': {
      if (typeof value !== 'string') return fail(path, 'se esperaba string')
      if (field.required && value.length === 0) {
        return fail(path, 'string obligatorio vacío')
      }
      if (field.enumValues && !field.enumValues.includes(value)) {
        return fail(path, `valor "${value}" fuera del enum ${JSON.stringify(field.enumValues)}`)
      }
      return OK
    }
    case 'INTEGER':
    case 'NUMBER': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fail(path, 'se esperaba número')
      }
      if (field.type === 'INTEGER' && !Number.isInteger(value)) {
        return fail(path, 'se esperaba entero')
      }
      return OK
    }
    case 'OBJECT': {
      if (typeof value !== 'object' || Array.isArray(value)) {
        return fail(path, 'se esperaba objeto')
      }
      if (options.skipDeep?.includes(field.name)) return OK
      return validateObject(value as Record<string, unknown>, field.fields ?? [], path, options)
    }
    case 'ARRAY': {
      if (!Array.isArray(value)) return fail(path, 'se esperaba array')
      if (field.required && value.length === 0) {
        return fail(path, 'array obligatorio no puede estar vacío')
      }
      if (options.skipDeep?.includes(field.name)) return OK
      if (field.items) {
        for (let i = 0; i < value.length; i++) {
          const itemResult = validateField(value[i], field.items, `${path}[${i}]`, options)
          if (!itemResult.ok) return itemResult
        }
      }
      return OK
    }
  }
}

function fail(path: string, message: string): ContractValidationResult {
  return { ok: false, error: `${path}: ${message}`, path }
}
