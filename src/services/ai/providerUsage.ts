export interface NormalizedProviderUsage {
  promptTokens?: number
  completionTokens?: number
  reasoningTokens?: number
  cacheReadInputTokens?: number
}

function nonCachedInput(total: number | undefined, cached: number | undefined): number | undefined {
  if (total == null) return undefined
  return Math.max(0, total - (cached ?? 0))
}

export function mapGeminiUsage(metadata: {
  promptTokenCount?: number
  candidatesTokenCount?: number
  thoughtsTokenCount?: number
  cachedContentTokenCount?: number
} | undefined): NormalizedProviderUsage {
  return {
    promptTokens: nonCachedInput(metadata?.promptTokenCount, metadata?.cachedContentTokenCount),
    completionTokens: metadata?.candidatesTokenCount == null && metadata?.thoughtsTokenCount == null
      ? undefined
      : (metadata?.candidatesTokenCount ?? 0) + (metadata?.thoughtsTokenCount ?? 0),
    ...(metadata?.thoughtsTokenCount == null ? {} : { reasoningTokens: metadata.thoughtsTokenCount }),
    cacheReadInputTokens: metadata?.cachedContentTokenCount,
  }
}

export function mapOpenAIUsage(usage: {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
} | undefined): NormalizedProviderUsage {
  const cached = usage?.prompt_tokens_details?.cached_tokens
  return {
    promptTokens: nonCachedInput(usage?.prompt_tokens, cached),
    completionTokens: usage?.completion_tokens,
    ...(usage?.completion_tokens_details?.reasoning_tokens == null
      ? {}
      : { reasoningTokens: usage.completion_tokens_details.reasoning_tokens }),
    cacheReadInputTokens: cached,
  }
}
