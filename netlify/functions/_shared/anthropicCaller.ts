import type { AIRawResponse, AIRequest } from '../../../src/services/ai/types'

const CLAUDE_STRUCTURED_TOOL_NAME = 'emit_structured_result'
const DEFAULT_MODEL = 'claude-sonnet-4-6'
const DEFAULT_TIMEOUT_MS = 120_000

function isMaxTokenStopReason(stopReason: string | undefined): boolean {
  if (!stopReason) return false
  const normalized = stopReason.toLowerCase()
  return normalized === 'max_tokens' ||
    normalized === 'max_output_tokens' ||
    normalized.includes('max_token')
}

function normalizeJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJsonSchema)
  if (!value || typeof value !== 'object') return value

  const input = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(input)) {
    output[key] = key === 'type' && typeof child === 'string'
      ? child.toLowerCase()
      : normalizeJsonSchema(child)
  }
  return output
}

function buildClaudeBody(request: AIRequest, model: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: request.maxTokens ?? 3500,
    temperature: request.temperature ?? 0.25,
    system: request.systemPrompt,
    messages: [
      ...(request.conversation ?? []).map((message) => ({ role: message.role, content: message.content })),
      { role: 'user', content: request.userMessage },
    ],
  }

  if (request.responseSchema) {
    body.tools = [{
      name: CLAUDE_STRUCTURED_TOOL_NAME,
      description: 'Devuelve el resultado estructurado solicitado siguiendo el schema exacto.',
      input_schema: normalizeJsonSchema(request.responseSchema),
    }]
    body.tool_choice = { type: 'tool', name: CLAUDE_STRUCTURED_TOOL_NAME }
  }

  return body
}

function extractClaudeText(content: Array<{ type?: string; text?: string; input?: unknown }> | undefined): string | undefined {
  const toolBlock = content?.find((item) => item.type === 'tool_use')
  if (toolBlock && toolBlock.input !== undefined) {
    return JSON.stringify(toolBlock.input)
  }
  return content?.find((item) => item.type === 'text')?.text
}

async function fetchJsonOrThrow(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => ({}))
  if (response.ok) return body

  const errorField = (body as { error?: { message?: string } | string }).error
  const message = typeof errorField === 'string'
    ? errorField
    : errorField?.message ?? `Anthropic error ${response.status}`
  throw new Error(message)
}

export async function callAnthropicForWeek(request: AIRequest, options?: {
  apiKey?: string
  model?: string
  timeoutMs?: number
}): Promise<AIRawResponse> {
  const apiKey = options?.apiKey ?? process.env['CLAUDE_API_KEY']
  if (!apiKey) throw new Error('CLAUDE_API_KEY no configurada.')

  const model = options?.model ?? process.env['CLAUDE_MODEL_PLAN_BUILDER_WEEK'] ?? process.env['CLAUDE_MODEL'] ?? DEFAULT_MODEL
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: controller.signal,
      body: JSON.stringify(buildClaudeBody(request, model)),
    })
    const data = await fetchJsonOrThrow(response) as {
      content?: Array<{ type?: string; text?: string; input?: unknown }>
      model?: string
      stop_reason?: string
    }
    const contentTypes = data.content?.map((b) => b.type) ?? []
    const toolBlock = data.content?.find((b) => b.type === 'tool_use')
    const sessionsVal = toolBlock ? (toolBlock.input as Record<string, unknown> | null)?.sessions : undefined
    console.log(`[anthropicCaller] stop_reason=${data.stop_reason} blocks=${JSON.stringify(contentTypes)} hasTool=${Boolean(toolBlock)} sessionsType=${Array.isArray(sessionsVal) ? 'array' : typeof sessionsVal} sessionsLen=${Array.isArray(sessionsVal) ? sessionsVal.length : 'n/a'}`)
    const text = extractClaudeText(data.content)
    if (!text) throw new Error('Claude devolvió una respuesta vacía.')
    const truncated = isMaxTokenStopReason(data.stop_reason)

    return {
      text,
      provider: 'claude',
      model: data.model ?? model,
      finishReason: data.stop_reason,
      truncated,
      errorClass: truncated ? 'truncated' : undefined,
      durationMs: Date.now() - startedAt,
      traceId: request.traceId,
      requestClass: request.requestClass,
      retryUsed: false,
      fallbackUsed: false,
    }
  } finally {
    clearTimeout(timeout)
  }
}
