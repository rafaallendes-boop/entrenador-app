# AI Integration Plan

Generado: 2026-03-30
Limpiado: 2026-04-02

## 1. Arquitectura

```text
useChatStore.sendMessage()
  -> CoachEngine.send(userMessage, context)
  -> promptBuilder.buildCoachSystemPrompt(context)
  -> getActiveProvider()
  -> provider.call(systemPrompt, userMessage)
  -> responseNormalizer.normalizeResponse(raw)
  -> useChatStore guarda ChatMessage
  -> si hay actions -> useCoachActionsStore.addProposal()
```

## 2. Providers soportados

- `mock`
- `claude`
- `openai`
- `gemini`
- `proxy` para produccion

## 3. Activacion local

Claude:

```env
VITE_AI_PROVIDER=claude
VITE_CLAUDE_API_KEY=YOUR_ANTHROPIC_API_KEY
```

OpenAI:

```env
VITE_AI_PROVIDER=openai
VITE_OPENAI_API_KEY=YOUR_OPENAI_API_KEY
```

Gemini:

```env
VITE_AI_PROVIDER=gemini
VITE_GEMINI_API_KEY=YOUR_GEMINI_API_KEY
```

Produccion segura:

```env
VITE_AI_PROVIDER=proxy
```

## 4. Flujo sin acciones

```text
Usuario pregunta
  -> provider responde texto
  -> normalizeResponse no encuentra <actions>
  -> ChatMessage se guarda y se muestra en UI
```

## 5. Flujo con acciones

```text
Usuario pide cambio real
  -> provider responde texto + bloque <actions>
  -> normalizeResponse extrae y valida actions
  -> useCoachActionsStore crea proposal
  -> ChatBubble muestra "Ver propuesta"
  -> usuario acepta
  -> executor aplica cambios en training store
```

## 6. Tipos principales

- `AIProvider`
- `AIRequest`
- `AIRawResponse`
- `CoachNormalizedResponse`
- `CoachAction`
- `AIProviderError`

## 7. Decisiones tecnicas

- Se usa `<actions>...</actions>` porque es facil de distinguir del texto conversacional.
- Los IDs cortos en prompt reducen tokens.
- `mock` es el default para que la app funcione sin keys.
- En produccion conviene usar `proxy` para no exponer secretos.

## 8. Estado

Implementado:

- `types.ts`
- `promptBuilder.ts`
- `responseNormalizer.ts`
- `CoachEngine.ts`
- providers
- integracion con `useChatStore`
- proposals en UI

## 9. Siguientes pasos historicos

Muchos de estos puntos ya se cerraron despues:

- planner con acciones reales
- streaming
- multi-sesion de chat
- proxy de produccion

Pendientes de mas largo plazo:

- versionado/migraciones de backup
- mejor manejo de contexto largo
- optimizacion de PDF
- sync multi-dispositivo

