import type { ActionContract, FieldSpec } from '../core/outputContract'

type JsonSchemaNode = {
  type: FieldSpec['type']
  enum?: readonly string[]
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  items?: JsonSchemaNode
}

function renderFieldAsJsonSchema(field: FieldSpec): JsonSchemaNode {
  const schema: JsonSchemaNode = { type: field.type }

  if (field.enumValues) {
    schema.enum = field.enumValues
  }

  if (field.type === 'ARRAY' && field.items) {
    schema.items = renderFieldAsJsonSchema(field.items)
  }

  if (field.type === 'OBJECT' && field.fields) {
    schema.properties = Object.fromEntries(
      field.fields.map((child) => [child.name, renderFieldAsJsonSchema(child)]),
    )

    const required = field.fields
      .filter((child) => child.required)
      .map((child) => child.name)
    if (required.length > 0) {
      schema.required = required
    }
  }

  return schema
}

export function renderActionAsJsonSchema(action: ActionContract): Record<string, unknown> {
  const properties = Object.fromEntries(
    action.fields.map((field) => [field.name, renderFieldAsJsonSchema(field)]),
  )
  const required = action.fields
    .filter((field) => field.required)
    .map((field) => field.name)

  return {
    type: 'OBJECT',
    properties,
    required,
  }
}
