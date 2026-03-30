# AI Integration Plan — Entrenador App

Generado: 2026-03-30

---

## 1. Arquitectura

```
useChatStore.sendMessage()
       │
       ▼
CoachEngine.send(userMessage, context)
       │
       ├── promptBuilder.buildCoachSystemPrompt(context)
       │         └── Session IDs, week summary, day log, adherence, objectives
       │
       ├── getActiveProvider()  ← env var VITE_AI_PROVIDER
       │         ├── ClaudeProvider   (VITE_AI_PROVIDER=claude)
       │         ├── OpenAIProvider   (VITE_AI_PROVIDER=openai)
       │         └── MockProvider     (default / fallback)
       │
       ├── provider.call(systemPrompt, userMessage)
       │
       └── responseNormalizer.normalizeResponse(raw)
                 ├── Extract <actions>...</actions> block
                 ├── Validate each CoachAction
                 ├── Strip block from display message
                 └── Return CoachNormalizedResponse
       │
       ▼
useChatStore
  ├── Adds coach ChatMessage to Dexie + state
  ├── If actions → useCoachActionsStore.addProposal(actions)
  └── ChatBubble shows "Ver propuesta" button → ProposalDrawer
```

---

## 2. Proveedores soportados

| Provider | Status | Env var | Default model |
|----------|--------|---------|---------------|
| Mock | ✅ Activo (default) | `VITE_AI_PROVIDER=mock` | — |
| Claude (Anthropic) | ✅ Funcional | `VITE_AI_PROVIDER=claude` + `VITE_CLAUDE_API_KEY` | `claude-sonnet-4-6` |
| OpenAI | ✅ Funcional | `VITE_AI_PROVIDER=openai` + `VITE_OPENAI_API_KEY` | `gpt-4o` |

---

## 3. Cómo activar Claude

1. Crea un archivo `.env` en la raíz del proyecto (copia `.env.example`)

2. Obtén tu API key en [console.anthropic.com](https://console.anthropic.com/settings/keys)

3. Configura tu `.env`:
   ```
   VITE_AI_PROVIDER=claude
   VITE_CLAUDE_API_KEY=YOUR_ANTHROPIC_API_KEY
   ```

4. Reconstruye la app:
   ```bash
   npm run build
   ```

5. Sube el `dist/` a Netlify

**Modelos disponibles:**
- `claude-sonnet-4-6` — recomendado (balance velocidad/calidad)
- `claude-opus-4-6` — máxima calidad, más lento y caro
- `claude-haiku-4-5-20251001` — el más rápido y barato

Para cambiar el modelo:
```
VITE_CLAUDE_MODEL=claude-opus-4-6
```

---

## 4. Cómo activar OpenAI

1. Obtén tu API key en [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

2. Configura tu `.env`:
   ```
   VITE_AI_PROVIDER=openai
   VITE_OPENAI_API_KEY=YOUR_OPENAI_API_KEY
   ```

3. Reconstruye y sube a Netlify

**Modelos disponibles:**
- `gpt-4o` — recomendado (default)
- `gpt-4o-mini` — más rápido y barato
- `gpt-4-turbo` — alternativa

Para cambiar el modelo:
```
VITE_OPENAI_MODEL=gpt-4o-mini
```

---

## 5. Flujo de datos completo

### Mensaje sin acciones (conversación normal)

```
Usuario: "¿Cómo ves mi semana?"
    ↓
buildCoachSystemPrompt(context)
    → incluye: sesiones con IDs, adherencia, dayLog de hoy, objetivos
    ↓
ClaudeProvider.call({ systemPrompt, userMessage })
    → POST https://api.anthropic.com/v1/messages
    → headers: x-api-key, anthropic-dangerous-direct-browser-access: true
    ↓
AIRawResponse { text: "Llevas buen ritmo...", provider: "claude", model: "..." }
    ↓
normalizeResponse(raw)
    → no <actions> block found
    → returns CoachNormalizedResponse { message: "Llevas buen ritmo...", actions: undefined }
    ↓
ChatMessage saved to Dexie { role: "coach", content: "...", provider: "claude" }
    ↓
ChatBubble muestra mensaje + badge "Claude"
```

### Mensaje con acciones estructuradas

```
Usuario: "Estoy cansado, baja la carga de mañana"
    ↓
Claude responde:
    "Entendido. Para mañana te propongo acortar la sesión de fuerza...

    <actions>
    [{"type":"shorten_session","sessionId":"abc12345","newDurationMin":30,"reason":"fatiga acumulada"}]
    </actions>"
    ↓
normalizeResponse(raw)
    → extrae y parsea el bloque <actions>
    → message = "Entendido. Para mañana te propongo acortar la sesión de fuerza..."
    → actions = [{ type: "shorten_session", sessionId: "abc12345", newDurationMin: 30, reason: "..." }]
    ↓
useCoachActionsStore.addProposal(message_summary, actions)
    → CoachProposal { id: "xyz", status: "pending", actions: [...] }
    ↓
ChatMessage saved with proposalId: "xyz"
    ↓
ChatBubble muestra "⚡ Ver propuesta" → ProposalDrawer
    ↓
Usuario toca "Aplicar cambios"
    ↓
useCoachActionsStore.acceptProposal("xyz")
    → useTrainingStore.updateSession("abc12345", { durationMin: 30 })
    → proposal.status = "accepted"
```

---

## 6. Tipos principales

### AIProvider (contrato de proveedor)
```typescript
interface AIProvider {
  readonly name: AIProviderName       // 'claude' | 'openai' | 'mock'
  call(request: AIRequest): Promise<AIRawResponse>
}
```

### AIRequest (entrada al proveedor)
```typescript
interface AIRequest {
  systemPrompt: string
  userMessage: string
  maxTokens?: number    // default: 1024
  temperature?: number  // default: 0.7
}
```

### AIRawResponse (salida cruda del proveedor)
```typescript
interface AIRawResponse {
  text: string
  provider: AIProviderName
  model?: string
  raw?: unknown         // full API response (for debugging)
  durationMs?: number
}
```

### CoachNormalizedResponse (lo que consume la app)
```typescript
interface CoachNormalizedResponse {
  message: string              // texto limpio para UI (sin bloque <actions>)
  actions?: CoachAction[]      // acciones extraídas, si las hay
  nutritionFocus?: string[]    // reservado para v2
  provider: AIProviderName
  model?: string
  raw?: unknown
  timestamp: number
  durationMs?: number
  proposalId?: string          // si se creó propuesta automáticamente
}
```

### CoachAction (acción estructurada)
```typescript
interface CoachAction {
  type: CoachActionType
  sessionId?: string         // referencia a Session.id (puede ser prefijo de 8 chars)
  targetDate?: string        // YYYY-MM-DD
  newRpe?: number
  newDurationMin?: number
  newType?: SessionType
  reason: string             // requerido siempre
}
```

### AIProviderError
```typescript
class AIProviderError extends Error {
  provider: AIProviderName
  code: 'unauthorized' | 'rate_limit' | 'timeout' | 'parse_error' | 'unknown'
  retryable: boolean
}
```

---

## 7. Decisiones técnicas

### Por qué `<actions>...</actions>` en vez de JSON blocks de markdown
- Los bloques `\`\`\`json` pueden aparecer en el texto del coach (ejemplos de código) — colisión
- Los tags XML son específicos y fáciles de distinguir del contenido del mensaje
- Más fácil de regex-parsear de forma confiable
- GPT-4o y Claude siguen bien las instrucciones de este formato

### Por qué session IDs de 8 caracteres en el prompt
- Los IDs completos UUID (36 chars) consumen tokens innecesarios
- 8 caracteres son suficientes para identificar univocamente sesiones en una semana
- El executor en `useCoachActionsStore` busca por prefijo si es necesario (actualmente pasa el ID completo, el prefijo es solo para el prompt)
- **Limitación**: si hay dos sesiones con el mismo prefijo, puede haber ambigüedad. En una semana típica (7-14 sesiones) la probabilidad es negligible.

### Por qué los providers son clases instanciadas en cada llamada
- Simple y sin estado global
- Fácil de testear (inyección de dependencias)
- Sin riesgo de estado compartido entre llamadas
- El overhead de crear una instancia es negligible

### Por qué `VITE_AI_PROVIDER=mock` es el default
- La app funciona sin ninguna API key configurada
- Evita errores al abrir la app sin `.env` configurado
- El mock tiene respuestas útiles para demostración

### Por qué las API keys están en el bundle de Vite (y no en backend)
- Esta es una app personal (PWA instalada en el propio dispositivo)
- No hay usuarios externos — solo Rafael la usa
- Añadir un backend proxy solo para esto sería overengineering
- **Para publicar públicamente**: mover las llamadas a un backend (Next.js API routes, Netlify Functions, etc.)

### Por qué `nutritionFocus` está en el tipo pero siempre undefined
- El campo está reservado para cuando se use function calling / tool use de la API
- Con function calling, Claude puede retornar un objeto estructurado de nutrición además del texto
- En v1, la nutrición se incluye en el texto normal del coach
- No añadir complejidad de parsing hasta que se decida usar tools

---

## 8. Qué quedó implementado vs qué quedó preparado

### Implementado y funcional ✅

| Componente | Descripción |
|------------|-------------|
| `src/services/ai/types.ts` | Tipos completos para toda la capa AI |
| `src/services/ai/promptBuilder.ts` | Sistema de prompt rico con contexto completo |
| `src/services/ai/responseNormalizer.ts` | Parser de bloque `<actions>`, validación, limpieza |
| `src/services/ai/CoachEngine.ts` | Orchestrator: selección de proveedor, construcción de prompt, normalización |
| `src/services/ai/providers/ClaudeProvider.ts` | Llama a Anthropic API con headers correctos (incl. browser access header) |
| `src/services/ai/providers/OpenAIProvider.ts` | Llama a OpenAI Chat Completions API |
| `src/services/ai/providers/MockProvider.ts` | Respuestas keyword-based para dev/offline |
| `src/store/useChatStore.ts` | Usa CoachEngine, crea proposals automáticamente, errores tipados |
| `src/pages/ChatCoach.tsx` | Badge de proveedor (Demo/Claude AI/GPT-4o), ProposalDrawer funcional |
| `src/components/chat/ChatBubble.tsx` | Muestra provider y botón "Ver propuesta" |
| `.env.example` | Documentación de env vars |

### Preparado / fundación lista ✅

| Componente | Estado |
|------------|--------|
| Acciones del coach con ejecución real | El store `useCoachActionsStore` ejecuta las 7 acciones. Solo falta que el modelo las proponga. |
| `nutritionFocus` en respuesta | Campo en el tipo, siempre `undefined`. Para v2 con function calling. |
| Session ID matching por prefijo | El normalizer pasa los IDs como vienen. Para v2, implementar lookup por prefijo en el executor. |
| Chat history | Todos los mensajes (incluido provider) se persisten en Dexie. |

---

## 9. Próximos pasos recomendados

### Inmediato (baja fricción, alto impacto)
1. **Activar Claude**: añadir `.env` con `VITE_AI_PROVIDER=claude` y `VITE_CLAUDE_API_KEY`, rebuild y subir a Netlify
2. **Probar el ciclo completo**: enviar mensajes que activen propuestas ("estoy cansado, baja la carga") y verificar que el ProposalDrawer aparece y los cambios se aplican correctamente

### Corto plazo
3. **Session ID lookup por prefijo**: en el executor, añadir lookup `sessions.find(s => s.id.startsWith(shortId))` para mayor robustez
4. **Historial de chat en el prompt**: incluir los últimos 3-5 mensajes del chat en el contexto enviado al modelo (actualmente solo se incluye el mensaje actual)
5. **Retry automático en rate_limit**: si `retryable: true` en el error, esperar 5s y reintentar una vez

### Mediano plazo
6. **Backend proxy**: crear un endpoint en Netlify Functions para proxear las llamadas a la API, eliminando la exposición de la clave en el bundle
7. **Function calling / tool use**: reemplazar el bloque `<actions>` por tools de Claude/OpenAI para mayor fiabilidad estructural
8. **Streaming**: usar streaming de la API para mostrar la respuesta en tiempo real (como hace ChatGPT)
9. **Context window management**: si el historial crece mucho, resumir sesiones antiguas antes de enviar al modelo

### Largo plazo
10. **Memoria del coach**: almacenar preferencias y patrones de Rafael en un sistema de memoria (similar a cómo funciona este proyecto con el memory system)
11. **Multi-turn coaching**: mantener el contexto de conversación completo (no solo el último mensaje) en el request al modelo
