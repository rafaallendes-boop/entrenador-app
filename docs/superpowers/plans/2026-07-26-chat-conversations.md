# Conversaciones del chat — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Si esas skills no existen en tu entorno**, ejecutá igual tarea por tarea y en
> orden, sin adelantar tareas, corriendo los comandos de cada paso y parando al
> final de cada tarea para revisión. Eso es todo lo que las skills aportan acá.

**Spec:** `docs/superpowers/specs/2026-07-26-chat-conversations-design.md`
**Fecha:** 2026-07-26

**Goal:** Poder ver, retomar, buscar y borrar conversaciones anteriores del chat, con rotación automática por día calendario, sin ninguna migración de datos.

**Architecture:** El índice de conversaciones se **deriva** de `chatMessages`, que ya guarda `chatSessionId` y ya sincroniza. Un módulo de servicio hace la derivación con un acumulador puro compartido entre el camino streaming (Dexie `each()`) y el camino en memoria (tests). El store gana un único camino de hidratación con propiedad de token, y la UI agrega un drawer lateral.

**Tech Stack:** React + TypeScript + Zustand + Dexie + Vitest + fake-indexeddb + date-fns + Tailwind + lucide-react.

## Global Constraints

- **Sin migraciones.** Ni Dexie (queda en **v18**), ni Supabase, ni bump de versión de backup. Si una tarea parece necesitar una, está mal entendida: parar y preguntar.
- **`MessageRole` es `'user' | 'coach'`** (`src/types/index.ts:174`). **No existe `'assistant'`.** Cualquier mensaje de la IA en un test se escribe `role: 'coach'`.
- **Nunca el literal `'default'`** fuera de `activeAthlete.ts`. Usar `ATHLETE_PROFILE_LOCAL_ID`, `getActiveAthleteId()` o `getSelfAthleteId()` (hay un guard test que falla si se viola).
- **Toda lectura de `chatMessages` fuera de sync/export pasa por el filtro de scope**, vía `isRowInActiveScope(message.athleteId)`. Las filas legacy sin `athleteId` pertenecen **solo al self**.
- **`chatSessionId` NO es frontera de seguridad.** Prohibido `orderBy('chatSessionId').uniqueKeys()` para agrupar: devuelve ids de todos los atletas.
- **Borrar siempre por ids derivados y scope-filtrados**, nunca por `chatSessionId`.
- **Días calendario, no milisegundos.** `isSameDay` de date-fns. Prohibido `now - last > 86400000`.
- **Entre el guard de `isLoading` y `set({ isLoading: true })` en `sendMessage()` no puede aparecer ningún `await`.** Prohibido `await get().newSession()` ahí.
- Copy de UI en **tuteo** y en español, consistente con el resto de la app.
- **Ritmo de verificación:** durante el ciclo TDD se corren los comandos **dirigidos** de cada paso (rápidos). **Antes del paso de cierre de cada tarea** se corre `npm run lint && npm test` completo. `npm run build` se corre una sola vez, en la Task 13.
- **Commits: `CLAUDE.md:72` dice que los hace el owner.** Los bloques `git commit` de cada tarea son la **redacción sugerida**, no una autorización. Ejecutalos **solo si el owner autorizó explícitamente commits para este trabajo**; si no, dejá los cambios en el árbol y reportá el mensaje propuesto al cerrar la tarea.
- El árbol puede tener cambios ajenos a este plan (al escribirlo había tres archivos de Plan Cycle modificados). **No los incluyas en ningún `git add`**: usá siempre rutas explícitas, nunca `git add -A`.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/services/chat/dailyRotation.ts` **(crear)** | Una sola función pura: decidir si toca rotar de conversación. |
| `src/services/chat/conversationIndex.ts` **(crear)** | Tipos del índice, normalización, título, acumulador puro, y las dos lecturas Dexie (`listConversations`, `searchConversations`). |
| `src/services/chat/orphanProposalRepair.ts` **(crear en Task 7)** | Movimiento puro de la reparación de propuestas huérfanas fuera del store, para volverla mockeable. |
| `src/store/useChatStore.ts` **(modificar)** | `loadSession()` con token, `openConversation`, `loadConversations`, `deleteConversation`, rotación en dos puntos, adopción endurecida. |
| `src/components/chat/ConversationDrawer.tsx` **(crear)** | Drawer lateral: lista agrupada por día, búsqueda con debounce y token, borrado en dos toques. |
| `src/pages/ChatCoach.tsx` **(modificar)** | Botón de hamburguesa, montaje lazy del drawer, y scroll al match. |

Tests: `src/services/chat/__tests__/dailyRotation.test.ts`, `.../conversationIndexPure.test.ts`, `.../conversationIndexDexie.test.ts`, `src/store/__tests__/chatConversations.test.ts`, ampliación de `src/store/__tests__/useChatStore.test.ts`, `src/components/chat/__tests__/ConversationDrawer.test.tsx`, `src/pages/__tests__/chatCoachConversations.test.tsx`.

---

## Task 1: Rotación diaria (función pura)

**Files:**
- Create: `src/services/chat/dailyRotation.ts`
- Test: `src/services/chat/__tests__/dailyRotation.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `shouldRotateConversation(lastMessageAt: number | null, now: number): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shouldRotateConversation } from '../dailyRotation'

describe('shouldRotateConversation', () => {
  it('does not rotate an empty conversation', () => {
    expect(shouldRotateConversation(null, new Date(2026, 6, 26, 9, 0).getTime())).toBe(false)
  })

  it('does not rotate when the last message is from today', () => {
    const now = new Date(2026, 6, 26, 23, 59).getTime()
    const last = new Date(2026, 6, 26, 0, 1).getTime()
    expect(shouldRotateConversation(last, now)).toBe(false)
  })

  it('rotates when the last message is from a previous calendar day', () => {
    const now = new Date(2026, 6, 26, 0, 5).getTime()
    const last = new Date(2026, 6, 25, 23, 50).getTime()
    expect(shouldRotateConversation(last, now)).toBe(true)
  })

  it('rotates across midnight even when less than 24h elapsed', () => {
    const now = new Date(2026, 6, 26, 0, 10).getTime()
    const last = new Date(2026, 6, 25, 22, 0).getTime()
    expect(shouldRotateConversation(last, now)).toBe(true)
  })

  it('does not rotate within the same day even when more than 20h elapsed', () => {
    const now = new Date(2026, 6, 26, 23, 0).getTime()
    const last = new Date(2026, 6, 26, 1, 0).getTime()
    expect(shouldRotateConversation(last, now)).toBe(false)
  })
})

// Chile cambia de hora el primer domingo de septiembre: el 2026-09-06 el día
// local dura 23 horas. Una ventana fija de 24h se equivoca acá; isSameDay no.
describe('shouldRotateConversation across a real DST shift', () => {
  const originalTz = process.env.TZ

  beforeAll(() => { process.env.TZ = 'America/Santiago' })
  afterAll(() => {
    if (originalTz == null) delete process.env.TZ
    else process.env.TZ = originalTz
  })

  it('keeps a 23-hour DST day as a single day', () => {
    const morning = new Date(2026, 8, 6, 4, 0).getTime()
    const night = new Date(2026, 8, 6, 23, 0).getTime()
    expect(shouldRotateConversation(morning, night)).toBe(false)
  })

  it('rotates from the day before the shift into the shift day', () => {
    const before = new Date(2026, 8, 5, 22, 0).getTime()
    const after = new Date(2026, 8, 6, 3, 0).getTime()
    expect(shouldRotateConversation(before, after)).toBe(true)
  })
})
```

> Si el runner corre en UTC, `process.env.TZ` en `beforeAll` sí afecta a `Date` en
> Node (relee `TZ` en cada operación). Si en tu entorno no lo hiciera, el test
> falla de forma visible en vez de dar un falso verde — reportalo, no lo borres.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/chat/__tests__/dailyRotation.test.ts`
Expected: FAIL — no se puede resolver el módulo `../dailyRotation`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { isSameDay } from 'date-fns'

/**
 * Días CALENDARIO en la zona local del dispositivo, no una ventana de
 * milisegundos: una ventana de 24h se rompe al cruzar DST y trata
 * "ayer 23:50" como si fuera hoy. Precedente del proyecto: hardening de
 * fechas y semanas del 2026-07-19.
 */
export function shouldRotateConversation(lastMessageAt: number | null, now: number): boolean {
  if (lastMessageAt == null) return false
  return !isSameDay(new Date(lastMessageAt), new Date(now))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/chat/__tests__/dailyRotation.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Close the task**

Run: `npm run lint && npm test`
Expected: verdes.

Mensaje sugerido (ver la regla de commits en Global Constraints):

```bash
git add src/services/chat/dailyRotation.ts src/services/chat/__tests__/dailyRotation.test.ts
git commit -m "feat(chat): add calendar-day conversation rotation rule"
```

---

## Task 2: Normalización y título significativo

**Files:**
- Create: `src/services/chat/conversationIndex.ts`
- Test: `src/services/chat/__tests__/conversationIndexPure.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `normalizeForMatch(value: string): string`
  - `isIsolatedGreeting(content: string): boolean`
  - `stripGreetingPrefix(content: string): string | null`
  - `deriveConversationTitle(input: { earliestUserContent: string | null; earliestSignificantUserContent: string | null; firstMessageAt: number }): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { deriveConversationTitle, isIsolatedGreeting, normalizeForMatch } from '../conversationIndex'

const AT = new Date(2026, 6, 22, 10, 0).getTime()

function title(content: string, significant: string | null = content): string {
  return deriveConversationTitle({
    earliestUserContent: content,
    earliestSignificantUserContent: significant,
    firstMessageAt: AT,
  })
}

describe('normalizeForMatch', () => {
  it('strips diacritics and lowercases', () => {
    expect(normalizeForMatch('Molestía en la RODÍLLA')).toBe('molestia en la rodilla')
  })

  it('preserves length so index math on the original stays valid', () => {
    const original = 'Café con leche'
    expect(normalizeForMatch(original)).toHaveLength(original.length)
  })
})

describe('isIsolatedGreeting', () => {
  it('detects a bare greeting with punctuation', () => {
    expect(isIsolatedGreeting('¡Hola!')).toBe(true)
    expect(isIsolatedGreeting('buenos días')).toBe(true)
  })

  it('does not treat a greeting plus content as isolated', () => {
    expect(isIsolatedGreeting('Hola, quiero ajustar la semana')).toBe(false)
  })
})

describe('deriveConversationTitle', () => {
  it('uses the significant message when there is one', () => {
    expect(title('Quiero ajustar la semana')).toBe('Quiero ajustar la semana')
  })

  it('strips a leading greeting and restores capitalisation', () => {
    expect(title('Hola, quiero ajustar la semana')).toBe('Quiero ajustar la semana')
  })

  it('strips the LONGEST matching greeting, not the first one', () => {
    // "buenas" también matchea: si gana el corto, queda "Tardes, ...".
    expect(title('Buenas tardes, necesito mover el jueves'))
      .toBe('Necesito mover el jueves')
  })

  it('strips "holaa" rather than leaving a dangling letter', () => {
    expect(title('Holaa, cambiemos la carga')).toBe('Cambiemos la carga')
  })

  it('does not strip a greeting that is only a prefix of a real word', () => {
    // "Holanda" empieza con "hola" pero no es un saludo.
    expect(title('Holanda me queda lejos')).toBe('Holanda me queda lejos')
  })

  it('falls back to the raw message when every user message is a greeting', () => {
    expect(title('Hola', null)).toBe('Hola')
  })

  it('falls back to the date when there is no user message', () => {
    expect(deriveConversationTitle({
      earliestUserContent: null, earliestSignificantUserContent: null, firstMessageAt: AT,
    })).toBe('Conversación del 22 jul')
  })

  it('collapses inner whitespace and truncates at a word boundary', () => {
    const long = 'Necesito   que revisemos con calma toda la planificación de la próxima semana porque tengo torneo'
    expect(title(long))
      .toBe('Necesito que revisemos con calma toda la planificación de la próxima semana…')
  })

  it('hard-cuts a single word longer than the cap', () => {
    const url = `https://example.com/${'a'.repeat(120)}`
    expect(title(url)).toHaveLength(80)
    expect(title(url).endsWith('…')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/chat/__tests__/conversationIndexPure.test.ts`
Expected: FAIL — no se puede resolver `../conversationIndex`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

const TITLE_MAX = 80

/**
 * Lista acotada y explícita: se prefiere un título crudo a un recorte
 * equivocado. Se ordena por longitud DESCENDENTE para que "buenas tardes" gane
 * sobre "buenas" y "holaa" sobre "hola".
 */
const GREETINGS = [
  'buenas tardes', 'buenas noches', 'buenos dias', 'buen dia',
  'holaaa', 'holaa', 'que tal', 'buenas', 'hola', 'hey',
].sort((a, b) => b.length - a.length)

/** Un saludo solo se recorta si termina en frontera: puntuación, espacio o fin. */
const BOUNDARY = /^[\s,.;:!?¡¿-]/u

export function normalizeForMatch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function stripEdgePunctuation(value: string): string {
  return value.replace(/^[\s,.;:!?¡¿-]+|[\s,.;:!?¡¿-]+$/gu, '')
}

/** El mensaje ENTERO es un saludo. */
export function isIsolatedGreeting(content: string): boolean {
  const normalized = stripEdgePunctuation(collapseWhitespace(normalizeForMatch(content)))
  return GREETINGS.includes(normalized)
}

/** Quita un saludo inicial si queda texto detrás. Devuelve null si no aplica. */
export function stripGreetingPrefix(content: string): string | null {
  const collapsed = collapseWhitespace(content)
  const normalized = normalizeForMatch(collapsed)
  // Sin longitudes equivalentes no hacemos aritmética de índices: mejor no recortar.
  if (normalized.length !== collapsed.length) return null

  for (const greeting of GREETINGS) {
    if (!normalized.startsWith(greeting)) continue
    const tail = collapsed.slice(greeting.length)
    // "Holanda" empieza con "hola" pero no hay frontera: no es un saludo.
    if (tail.length > 0 && !BOUNDARY.test(tail)) continue
    const rest = stripEdgePunctuation(tail)
    if (rest.length === 0) return null
    return rest.charAt(0).toUpperCase() + rest.slice(1)
  }
  return null
}

function truncateTitle(value: string): string {
  const collapsed = collapseWhitespace(value)
  if (collapsed.length <= TITLE_MAX) return collapsed
  // La elipsis forma parte del límite total.
  const window = collapsed.slice(0, TITLE_MAX - 1)
  const lastSpace = window.lastIndexOf(' ')
  // Palabra única más larga que el tope (una URL): corte duro.
  if (lastSpace <= 0) return `${window}…`
  return `${stripEdgePunctuation(window.slice(0, lastSpace))}…`
}

export function deriveConversationTitle(input: {
  earliestUserContent: string | null
  earliestSignificantUserContent: string | null
  firstMessageAt: number
}): string {
  const significant = input.earliestSignificantUserContent
  if (significant) return truncateTitle(stripGreetingPrefix(significant) ?? significant)
  if (input.earliestUserContent) return truncateTitle(input.earliestUserContent)
  return `Conversación del ${format(new Date(input.firstMessageAt), 'd MMM', { locale: es })}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/chat/__tests__/conversationIndexPure.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Close the task**

Run: `npm run lint && npm test`

```bash
git add src/services/chat/conversationIndex.ts src/services/chat/__tests__/conversationIndexPure.test.ts
git commit -m "feat(chat): derive conversation titles from the first significant message"
```

---

## Task 3: Acumulador puro y resumen de conversaciones

**Files:**
- Modify: `src/services/chat/conversationIndex.ts`
- Test: `src/services/chat/__tests__/conversationIndexPure.test.ts` (agregar bloque)

**Interfaces:**
- Consumes: `deriveConversationTitle`, `isIsolatedGreeting` de Task 2.
- Produces:
  - `interface ConversationSummary { sessionId: string; title: string; lastMessageAt: number; firstMessageAt: number; messageCount: number }`
  - `interface ConversationAccumulator`
  - `accumulateConversation(map: Map<string, ConversationAccumulator>, message: ChatMessage): void`
  - `finalizeConversations(map: Map<string, ConversationAccumulator>): ConversationSummary[]`
  - `buildConversationSummaries(messages: ChatMessage[]): ConversationSummary[]`

- [ ] **Step 1: Write the failing test**

```ts
import { buildConversationSummaries } from '../conversationIndex'
import type { ChatMessage } from '../../../types'

function msg(over: Partial<ChatMessage> & { id: string; timestamp: number }): ChatMessage {
  return { role: 'user', content: 'texto', chatSessionId: 's1', ...over } as ChatMessage
}

describe('buildConversationSummaries', () => {
  it('ignores messages without chatSessionId instead of inventing a session', () => {
    const result = buildConversationSummaries([
      msg({ id: 'a', timestamp: 1, chatSessionId: undefined }),
      msg({ id: 'b', timestamp: 2, chatSessionId: 's1' }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].sessionId).toBe('s1')
    expect(result[0].messageCount).toBe(1)
  })

  it('is correct with unordered input', () => {
    const result = buildConversationSummaries([
      msg({ id: 'b', timestamp: 300, content: 'segundo' }),
      msg({ id: 'a', timestamp: 100, content: 'Quiero ajustar la semana' }),
    ])
    expect(result[0].firstMessageAt).toBe(100)
    expect(result[0].lastMessageAt).toBe(300)
    expect(result[0].title).toBe('Quiero ajustar la semana')
  })

  it('titles from the earliest significant user message', () => {
    const result = buildConversationSummaries([
      msg({ id: 'a', timestamp: 100, content: 'Hola' }),
      msg({ id: 'b', timestamp: 200, content: 'Me duele el hombro' }),
    ])
    expect(result[0].title).toBe('Me duele el hombro')
  })

  it('ignores coach messages for the title but counts them', () => {
    const result = buildConversationSummaries([
      msg({ id: 'a', timestamp: 100, role: 'coach', content: 'Hola, soy tu coach' }),
      msg({ id: 'b', timestamp: 200, role: 'user', content: 'Necesito descansar' }),
    ])
    expect(result[0].title).toBe('Necesito descansar')
    expect(result[0].messageCount).toBe(2)
  })

  it('sorts by lastMessageAt desc with a stable sessionId tiebreak', () => {
    const result = buildConversationSummaries([
      msg({ id: 'a', timestamp: 500, chatSessionId: 'sB' }),
      msg({ id: 'b', timestamp: 500, chatSessionId: 'sA' }),
      msg({ id: 'c', timestamp: 900, chatSessionId: 'sC' }),
    ])
    expect(result.map(r => r.sessionId)).toEqual(['sC', 'sA', 'sB'])
  })

  it('skips whitespace-only user messages when picking the title', () => {
    const result = buildConversationSummaries([
      msg({ id: 'a', timestamp: 100, content: '   ' }),
      msg({ id: 'b', timestamp: 200, content: 'Cambiemos el jueves' }),
    ])
    expect(result[0].title).toBe('Cambiemos el jueves')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/chat/__tests__/conversationIndexPure.test.ts`
Expected: FAIL — `buildConversationSummaries` no está exportada.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { ChatMessage } from '../../types'

export interface ConversationSummary {
  sessionId: string
  title: string
  lastMessageAt: number
  firstMessageAt: number
  messageCount: number
}

export interface ConversationAccumulator {
  sessionId: string
  firstMessageAt: number
  lastMessageAt: number
  messageCount: number
  earliestUser: { content: string; timestamp: number } | null
  earliestSignificantUser: { content: string; timestamp: number } | null
}

/**
 * O(1) por mensaje y O(1) de memoria por conversación. Compartido por el camino
 * streaming (`each()`) y el camino en memoria, para que no existan dos
 * derivaciones que puedan divergir. No asume orden de entrada.
 */
export function accumulateConversation(
  map: Map<string, ConversationAccumulator>,
  message: ChatMessage,
): void {
  const sessionId = message.chatSessionId
  if (!sessionId) return // sin sesión no se inventa una

  let entry = map.get(sessionId)
  if (!entry) {
    entry = {
      sessionId,
      firstMessageAt: message.timestamp,
      lastMessageAt: message.timestamp,
      messageCount: 0,
      earliestUser: null,
      earliestSignificantUser: null,
    }
    map.set(sessionId, entry)
  }

  entry.messageCount += 1
  if (message.timestamp < entry.firstMessageAt) entry.firstMessageAt = message.timestamp
  if (message.timestamp > entry.lastMessageAt) entry.lastMessageAt = message.timestamp

  if (message.role !== 'user') return
  const content = message.content?.trim() ?? ''
  if (content.length === 0) return

  if (!entry.earliestUser || message.timestamp < entry.earliestUser.timestamp) {
    entry.earliestUser = { content, timestamp: message.timestamp }
  }
  if (isIsolatedGreeting(content)) return
  if (!entry.earliestSignificantUser || message.timestamp < entry.earliestSignificantUser.timestamp) {
    entry.earliestSignificantUser = { content, timestamp: message.timestamp }
  }
}

export function finalizeConversations(
  map: Map<string, ConversationAccumulator>,
): ConversationSummary[] {
  return [...map.values()]
    .map((entry) => ({
      sessionId: entry.sessionId,
      title: deriveConversationTitle({
        earliestUserContent: entry.earliestUser?.content ?? null,
        earliestSignificantUserContent: entry.earliestSignificantUser?.content ?? null,
        firstMessageAt: entry.firstMessageAt,
      }),
      lastMessageAt: entry.lastMessageAt,
      firstMessageAt: entry.firstMessageAt,
      messageCount: entry.messageCount,
    }))
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt || a.sessionId.localeCompare(b.sessionId))
}

/** Solo para tests y consumidores en memoria. Usa el MISMO acumulador. */
export function buildConversationSummaries(messages: ChatMessage[]): ConversationSummary[] {
  const map = new Map<string, ConversationAccumulator>()
  for (const message of messages) accumulateConversation(map, message)
  return finalizeConversations(map)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/chat/__tests__/conversationIndexPure.test.ts`
Expected: PASS, 20 tests (Tasks 2 y 3).

- [ ] **Step 5: Close the task**

Run: `npm run lint && npm test`

```bash
git add src/services/chat/conversationIndex.ts src/services/chat/__tests__/conversationIndexPure.test.ts
git commit -m "feat(chat): add the shared conversation accumulator"
```

---

## Task 4: Lectura Dexie scope-filtrada (`listConversations`)

**Files:**
- Modify: `src/services/chat/conversationIndex.ts`
- Test: `src/services/chat/__tests__/conversationIndexDexie.test.ts`

**Interfaces:**
- Consumes: `accumulateConversation`, `finalizeConversations` de Task 3.
- Produces: `listConversations(): Promise<ConversationSummary[]>`; privado `visitScopedChatMessages(visit)`.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../db/db'
import { setActiveAthleteId, setSelfAthleteId } from '../../athlete/activeAthlete'
import { listConversations } from '../conversationIndex'
import type { ChatMessage } from '../../../types'

function msg(over: Partial<ChatMessage> & { id: string; timestamp: number }): ChatMessage {
  return { role: 'user', content: 'texto', chatSessionId: 's1', ...over } as ChatMessage
}

describe('listConversations', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')
  })

  it('groups the active athlete messages into conversations', async () => {
    await db.chatMessages.bulkAdd([
      msg({ id: 'a', timestamp: 100, athleteId: 'ath_self', chatSessionId: 's1', content: 'Quiero ajustar la semana' }),
      msg({ id: 'b', timestamp: 200, athleteId: 'ath_self', chatSessionId: 's1', role: 'coach', content: 'Dale' }),
      msg({ id: 'c', timestamp: 300, athleteId: 'ath_self', chatSessionId: 's2', content: 'Me duele el hombro' }),
    ])
    const result = await listConversations()
    expect(result.map(r => r.sessionId)).toEqual(['s2', 's1'])
    expect(result[1].messageCount).toBe(2)
  })

  it('never leaks another athlete conversations', async () => {
    await db.chatMessages.bulkAdd([
      msg({ id: 'a', timestamp: 100, athleteId: 'ath_self', chatSessionId: 'mine' }),
      msg({ id: 'b', timestamp: 200, athleteId: 'ath_other', chatSessionId: 'theirs' }),
    ])
    setActiveAthleteId('ath_other')
    expect((await listConversations()).map(r => r.sessionId)).toEqual(['theirs'])
  })

  it('gives legacy rows without athleteId to the self only', async () => {
    await db.chatMessages.bulkAdd([
      msg({ id: 'legacy', timestamp: 100, athleteId: undefined, chatSessionId: 'legacy-thread' }),
    ])

    setActiveAthleteId('ath_self')
    expect((await listConversations()).map(r => r.sessionId)).toEqual(['legacy-thread'])

    setActiveAthleteId('ath_managed')
    expect(await listConversations()).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/chat/__tests__/conversationIndexDexie.test.ts`
Expected: FAIL — `listConversations` no está exportada.

- [ ] **Step 3: Write minimal implementation**

```ts
import { db } from '../../db/db'
import { isRowInActiveScope } from '../athlete/activeScopeFilter'

/**
 * ÚNICA lectura de Dexie de este módulo, compartida por listar y buscar, para
 * que la búsqueda no pueda divergir del scope del listado.
 *
 * Complejidad real: no existe índice `[athleteId+timestamp]` (`db.ts:201`), así
 * que mantener orden temporal obliga a recorrer TODOS los mensajes de la cuenta,
 * no solo los del atleta activo. Es O(mensajes totales) en tiempo y O(1) de
 * memoria por conversación gracias a `each()`. Para el volumen actual alcanza; si
 * deja de alcanzar, se mide antes de agregar un índice.
 *
 * PROHIBIDO agrupar con `orderBy('chatSessionId').uniqueKeys()`: devolvería ids
 * de sesión de todos los atletas y `chatSessionId` no es frontera de seguridad.
 */
async function visitScopedChatMessages(visit: (message: ChatMessage) => void): Promise<void> {
  await db.chatMessages.orderBy('timestamp').each((message) => {
    if (!isRowInActiveScope(message.athleteId)) return
    visit(message)
  })
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const map = new Map<string, ConversationAccumulator>()
  await visitScopedChatMessages((message) => accumulateConversation(map, message))
  return finalizeConversations(map)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/chat/__tests__/conversationIndexDexie.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Close the task**

Run: `npm run lint && npm test`

```bash
git add src/services/chat/conversationIndex.ts src/services/chat/__tests__/conversationIndexDexie.test.ts
git commit -m "feat(chat): list conversations from scope-filtered messages"
```

---

## Task 5: Búsqueda por contenido (`searchConversations`)

**Files:**
- Modify: `src/services/chat/conversationIndex.ts`
- Test: `src/services/chat/__tests__/conversationIndexDexie.test.ts` (agregar bloque)

**Interfaces:**
- Consumes: `visitScopedChatMessages`, `listConversations`, `normalizeForMatch`.
- Produces: `type ConversationSearchResult = ConversationSummary & { snippet: string; matchCount: number; matchedMessageId: string | null }`; `searchConversations(query: string): Promise<ConversationSearchResult[]>`.

- [ ] **Step 1: Write the failing test**

```ts
import { searchConversations } from '../conversationIndex'

describe('searchConversations', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')
    await db.chatMessages.bulkAdd([
      msg({ id: 'a', timestamp: 100, athleteId: 'ath_self', chatSessionId: 's1', content: 'Me duele el hombro derecho' }),
      msg({ id: 'b', timestamp: 200, athleteId: 'ath_self', chatSessionId: 's1', role: 'coach', content: 'Cuidemos ese hombro' }),
      msg({ id: 'c', timestamp: 300, athleteId: 'ath_self', chatSessionId: 's2', content: 'Quiero correr más' }),
    ])
  })

  it('matches content ignoring case and diacritics', async () => {
    const result = await searchConversations('HOMBRÓ')
    expect(result).toHaveLength(1)
    expect(result[0].sessionId).toBe('s1')
  })

  it('counts every matching message but points at the earliest one', async () => {
    const result = await searchConversations('hombro')
    expect(result[0].matchCount).toBe(2)
    expect(result[0].matchedMessageId).toBe('a')
    expect(result[0].snippet).toContain('hombro')
  })

  it('returns the full list with neutral match fields for an empty query', async () => {
    const result = await searchConversations('   ')
    expect(result.map(r => r.sessionId)).toEqual(['s2', 's1'])
    expect(result.every(r => r.snippet === '' && r.matchCount === 0 && r.matchedMessageId === null)).toBe(true)
  })

  it('uses the same scope as the listing', async () => {
    setActiveAthleteId('ath_managed')
    expect(await searchConversations('hombro')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/chat/__tests__/conversationIndexDexie.test.ts`
Expected: FAIL — `searchConversations` no está exportada.

- [ ] **Step 3: Write minimal implementation**

```ts
export type ConversationSearchResult = ConversationSummary & {
  snippet: string
  matchCount: number
  matchedMessageId: string | null
}

const SNIPPET_RADIUS = 40

function buildSnippet(content: string, matchIndex: number, needleLength: number): string {
  const start = Math.max(0, matchIndex - SNIPPET_RADIUS)
  const end = Math.min(content.length, matchIndex + needleLength + SNIPPET_RADIUS)
  const core = content.slice(start, end).replace(/\s+/gu, ' ').trim()
  return `${start > 0 ? '…' : ''}${core}${end < content.length ? '…' : ''}`
}

interface MatchEntry {
  matchCount: number
  earliestTimestamp: number
  matchedMessageId: string
  snippet: string
}

export async function searchConversations(query: string): Promise<ConversationSearchResult[]> {
  const needle = normalizeForMatch(query.trim())
  if (needle.length === 0) {
    const summaries = await listConversations()
    return summaries.map((summary) => ({
      ...summary, snippet: '', matchCount: 0, matchedMessageId: null,
    }))
  }

  const map = new Map<string, ConversationAccumulator>()
  const matches = new Map<string, MatchEntry>()

  await visitScopedChatMessages((message) => {
    accumulateConversation(map, message)
    const sessionId = message.chatSessionId
    if (!sessionId) return
    const content = message.content ?? ''
    const normalized = normalizeForMatch(content)
    const index = normalized.indexOf(needle)
    if (index < 0) return

    const existing = matches.get(sessionId)
    const nextCount = (existing?.matchCount ?? 0) + 1
    // Sin longitudes equivalentes no se mapea el índice a la original.
    const safeIndex = normalized.length === content.length ? index : 0

    if (!existing || message.timestamp < existing.earliestTimestamp) {
      matches.set(sessionId, {
        matchCount: nextCount,
        earliestTimestamp: message.timestamp,
        matchedMessageId: message.id,
        snippet: buildSnippet(content, safeIndex, needle.length),
      })
      return
    }
    existing.matchCount = nextCount
  })

  return finalizeConversations(map)
    .filter((summary) => matches.has(summary.sessionId))
    .map((summary) => {
      const match = matches.get(summary.sessionId)!
      return {
        ...summary,
        snippet: match.snippet,
        matchCount: match.matchCount,
        matchedMessageId: match.matchedMessageId,
      }
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/chat/__tests__/conversationIndexDexie.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Close the task**

Run: `npm run lint && npm test`

```bash
git add src/services/chat/conversationIndex.ts src/services/chat/__tests__/conversationIndexDexie.test.ts
git commit -m "feat(chat): search conversations by content"
```

---

## Task 6: `loadSession()` con propiedad de token y `persistId`

**Files:**
- Modify: `src/store/useChatStore.ts:47-92`
- Test: `src/store/__tests__/chatConversations.test.ts` (crear)

**Interfaces:**
- Consumes: `shouldRotateConversation` de Task 1.
- Produces: privado `loadSession(sessionId, { requestId, persistId, suspendRotation }): Promise<boolean>`; estado `rotationSuspended: boolean`.

**Contexto obligatorio:** leer `src/store/__tests__/useChatStore.test.ts:1-60`. Ese archivo mockea `../../db/db` con `vi.hoisted`; este test copia ese patrón. **El mock debe incluir `db.transaction`**, porque la reparación de propuestas la usa (`useChatStore.ts:497`) y todavía no está extraída.

- [ ] **Step 1: Write the failing test**

El primer test fija que la tarea arranque roja incluso si cambia algún detalle de
la adopción existente: Zustand acepta claves extra en runtime sin que Vitest haga
typecheck, así que hay que afirmar explícitamente el reset de
`rotationSuspended`. Los tests temporal y de fila huérfana también fallan contra
el comportamiento actual y fijan las otras dos regresiones.

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../types'

const mocks = vi.hoisted(() => ({
  chatMessages: [] as ChatMessage[],
  storedSessionId: null as string | null,
  localOnly: false,
  setStoredCalls: [] as string[],
}))

vi.mock('../../db/db', () => ({
  db: {
    // La reparación de propuestas corre dentro de una transacción.
    transaction: vi.fn(async (_mode: string, ..._args: unknown[]) => {
      const work = _args[_args.length - 1] as () => Promise<unknown>
      return work()
    }),
    chatMessages: {
      where: () => ({ equals: (id: string) => ({
        toArray: async () => mocks.chatMessages.filter(m => m.chatSessionId === id),
        sortBy: async () => mocks.chatMessages
          .filter(m => m.chatSessionId === id)
          .sort((a, b) => a.timestamp - b.timestamp),
      }) }),
      orderBy: () => ({
        toArray: async () => [...mocks.chatMessages].sort((a, b) => a.timestamp - b.timestamp),
        reverse: () => ({
          filter: (predicate: (m: ChatMessage) => boolean) => ({
            first: async () => [...mocks.chatMessages]
              .sort((a, b) => b.timestamp - a.timestamp)
              .find(predicate),
          }),
        }),
      }),
      add: vi.fn(async (m: ChatMessage) => { mocks.chatMessages.push(m) }),
      put: vi.fn(async () => {}),
      bulkDelete: vi.fn(async () => {}),
    },
    coachProposals: {
      where: () => ({ anyOf: () => ({ toArray: async () => [] }) }),
      orderBy: () => ({ toArray: async () => [] }),
      put: vi.fn(async () => {}),
      bulkDelete: vi.fn(async () => {}),
    },
  },
}))

vi.mock('../../utils/chatSession', () => ({
  getOrCreateChatSessionId: () => mocks.storedSessionId ?? 'fresh-session',
  getStoredChatSessionId: () => mocks.storedSessionId,
  setStoredChatSessionId: (id: string) => {
    mocks.setStoredCalls.push(id)
    mocks.storedSessionId = id
    mocks.localOnly = false
  },
  isLocalOnlyChatSessionId: () => mocks.localOnly,
  clearStoredChatSessionId: () => { mocks.storedSessionId = null },
}))

const { useChatStore } = await import('../useChatStore')

describe('loadHistory', () => {
  beforeEach(() => {
    mocks.chatMessages.length = 0
    mocks.setStoredCalls.length = 0
    mocks.storedSessionId = 'current-session'
    mocks.localOnly = true
    useChatStore.setState({ messages: [], currentSessionId: 'current-session' })
  })

  it('resets rotationSuspended so a fresh entry re-applies the day rule', async () => {
    useChatStore.setState({ rotationSuspended: true })
    await useChatStore.getState().loadHistory()
    expect(useChatStore.getState().rotationSuspended).toBe(false)
  })

  it('keeps the local-only marker alive so adoption still works', async () => {
    await useChatStore.getState().loadHistory()
    expect(mocks.setStoredCalls).toEqual([])
  })

  it('adopts a same-day thread when the current session is empty and local-only', async () => {
    mocks.chatMessages.push({
      id: 'a', role: 'user', content: 'hola', timestamp: Date.now(), chatSessionId: 'older-thread',
    } as ChatMessage)

    await useChatStore.getState().loadHistory()

    expect(useChatStore.getState().currentSessionId).toBe('older-thread')
    expect(mocks.setStoredCalls).toEqual(['older-thread'])
  })

  it('does not adopt a thread from a previous day', async () => {
    mocks.chatMessages.push({
      id: 'a', role: 'user', content: 'ayer', chatSessionId: 'older-thread',
      timestamp: Date.now() - 40 * 60 * 60 * 1000,
    } as ChatMessage)

    await useChatStore.getState().loadHistory()

    expect(useChatStore.getState().currentSessionId).toBe('current-session')
    expect(mocks.setStoredCalls).toEqual([])
  })

  it('adopts a valid earlier thread even when the newest row has no session', async () => {
    const now = Date.now()
    mocks.chatMessages.push(
      { id: 'valid', role: 'user', content: 'con sesión', timestamp: now - 1000, chatSessionId: 'older-thread' } as ChatMessage,
      { id: 'orphan', role: 'user', content: 'sin sesión', timestamp: now, chatSessionId: undefined } as ChatMessage,
    )

    await useChatStore.getState().loadHistory()

    expect(useChatStore.getState().currentSessionId).toBe('older-thread')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/__tests__/chatConversations.test.ts`
Expected: FAIL en al menos tres tests — `rotationSuspended` queda en `true` (el estado no existe y nada lo resetea), no se filtra por día en la adopción, y el huérfano sin sesión bloquea la adopción.

- [ ] **Step 3: Write minimal implementation**

Agregar `rotationSuspended: false` al estado inicial y reemplazar `loadHistory`:

```ts
  loadHistory: async () => {
    const requestId = ++latestHistoryLoadRequestId
    // Entrar al chat de cero siempre vuelve a aplicar la regla del día: el store
    // es un singleton de módulo y sobrevive al remount de ChatCoach.
    set({ rotationSuspended: false })

    const resolvedSessionId = getOrCreateChatSessionId()
    if (resolvedSessionId !== get().currentSessionId) {
      if (requestId !== latestHistoryLoadRequestId) return
      set({ currentSessionId: resolvedSessionId, messages: [] })
    }

    // persistId: false — setStoredChatSessionId() borra el marcador local-only
    // (chatSession.ts:36-40) y la adopción de abajo depende de él.
    const loaded = await loadSession(resolvedSessionId, {
      requestId, persistId: false, suspendRotation: false,
    })
    if (!loaded) return

    if (get().messages.length === 0 && isLocalOnlyChatSessionId(resolvedSessionId)) {
      // Mensaje in-scope más reciente CON chatSessionId: una fila huérfana sin
      // sesión no debe bloquear un hilo válido anterior.
      const latest = await db.chatMessages
        .orderBy('timestamp')
        .reverse()
        .filter((message) => isRowInActiveScope(message.athleteId) && Boolean(message.chatSessionId))
        .first()
      if (requestId !== latestHistoryLoadRequestId) return
      // Solo se adopta un hilo del MISMO día; si es de ayer, manda la rotación.
      if (latest?.chatSessionId && !shouldRotateConversation(latest.timestamp, Date.now())) {
        await loadSession(latest.chatSessionId, {
          requestId, persistId: true, suspendRotation: false,
        })
        return
      }
    }

    const messages = get().messages
    const lastAt = messages.length > 0 ? messages[messages.length - 1].timestamp : null
    if (shouldRotateConversation(lastAt, Date.now())) startFreshSessionSync()
  },
```

y el helper compartido, fuera del `create()`:

```ts
async function loadSession(
  sessionId: string,
  options: { requestId: number; persistId: boolean; suspendRotation: boolean },
): Promise<boolean> {
  const { requestId, persistId, suspendRotation } = options
  // `useChatStore` se evalúa recién al llamar: `loadSession` es una declaración
  // hoisted y solo se invoca después de que el store existe.
  const set = useChatStore.setState

  activeChatAbortController?.abort()
  activeChatAbortController = null

  const rows = filterRowsToActiveScope(
    await db.chatMessages.where('chatSessionId').equals(sessionId).sortBy('timestamp'),
  )
  if (requestId !== latestHistoryLoadRequestId) return false

  const repaired = await repairOrphanProposalMessages(sessionId, rows)
  if (requestId !== latestHistoryLoadRequestId) return false

  // Commit único y SÍNCRONO: sin await de acá al final.
  if (persistId) setStoredChatSessionId(sessionId)
  set({
    currentSessionId: sessionId,
    messages: repaired,
    streamingText: '',
    responsePhase: 'idle',
    error: null,
    ...(suspendRotation ? { rotationSuspended: true } : {}),
  })
  return true
}
```

`startFreshSessionSync()` se define en la Task 10; hasta entonces, dejá la
rotación de `loadHistory` comentada con un `TODO(Task 10)` **y un test skipped**
que la cubra, o implementá la Task 10 antes de esta línea. No la dejes a medias sin marca.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/__tests__/chatConversations.test.ts src/store/__tests__/useChatStore.test.ts`
Expected: PASS los nuevos y los existentes sin modificar.

- [ ] **Step 5: Close the task**

Run: `npm run lint && npm test`

```bash
git add src/store/useChatStore.ts src/store/__tests__/chatConversations.test.ts
git commit -m "refactor(chat): single hydration path with request ownership"
```

---

## Task 7: Extraer la reparación y `openConversation()`

**Files:**
- Create: `src/services/chat/orphanProposalRepair.ts`
- Modify: `src/store/useChatStore.ts`
- Test: `src/store/__tests__/chatConversations.test.ts` (agregar bloque)

**Interfaces:**
- Consumes: `loadSession` de Task 6.
- Produces: `repairOrphanProposalMessages(chatSessionId: string, messages: ChatMessage[]): Promise<ChatMessage[]>` desde el módulo nuevo; `openConversation(sessionId: string): Promise<void>` en el store.

- [ ] **Step 1: Mover la reparación (cambio puro)**

Mover a `src/services/chat/orphanProposalRepair.ts`: `repairOrphanProposalMessages`, `repairOrphanProposalMessagesUnlocked`, el `Map` `orphanProposalRepairLocks` y `buildProposalRecoveredMessage`.

**No mover `buildCoachErrorMessage`**: se usa en `sendMessage` (`useChatStore.ts:281`) y no pertenece a la reparación.

Exportar `repairOrphanProposalMessages`, importarla en el store y borrar las definiciones movidas.

- [ ] **Step 2: Verificar que el movimiento no cambió nada**

Run: `npm run lint && npm test`
Expected: la suite queda **exactamente** como antes del movimiento. Si algún test cambia de resultado, el movimiento no fue puro: revertir y revisar.

```bash
git add src/services/chat/orphanProposalRepair.ts src/store/useChatStore.ts
git commit -m "refactor(chat): extract orphan proposal repair into its own module"
```

- [ ] **Step 3: Write the failing test for `openConversation`**

Agregar al `vi.hoisted` de `chatConversations.test.ts` el campo `repairGates: [] as Promise<void>[]`, y este mock:

```ts
vi.mock('../../services/chat/orphanProposalRepair', () => ({
  repairOrphanProposalMessages: vi.fn(async (_sessionId: string, messages: ChatMessage[]) => {
    const gate = mocks.repairGates.shift()
    if (gate) await gate
    return messages
  }),
}))
```

```ts
describe('openConversation', () => {
  beforeEach(() => {
    mocks.chatMessages.length = 0
    mocks.setStoredCalls.length = 0
    mocks.repairGates = []
    mocks.storedSessionId = 'current-session'
    mocks.localOnly = false
    mocks.chatMessages.push({
      id: 'old', role: 'user', content: 'Me duele el hombro',
      timestamp: 1000, chatSessionId: 'old-thread',
    } as ChatMessage)
    useChatStore.setState({
      messages: [], currentSessionId: 'current-session', rotationSuspended: false, error: null,
    })
  })

  it('opens an existing conversation and suspends rotation', async () => {
    await useChatStore.getState().openConversation('old-thread')
    const state = useChatStore.getState()
    expect(state.currentSessionId).toBe('old-thread')
    expect(state.messages.map(m => m.id)).toEqual(['old'])
    expect(state.rotationSuspended).toBe(true)
    expect(mocks.setStoredCalls).toEqual(['old-thread'])
  })

  it('refuses an unknown id without touching the current conversation', async () => {
    await useChatStore.getState().openConversation('does-not-exist')
    const state = useChatStore.getState()
    expect(state.currentSessionId).toBe('current-session')
    expect(state.rotationSuspended).toBe(false)
    expect(state.error).toBeTruthy()
    expect(mocks.setStoredCalls).toEqual([])
  })

  it('lets the last of two chained opens win', async () => {
    mocks.chatMessages.push({
      id: 'other', role: 'user', content: 'Quiero correr',
      timestamp: 2000, chatSessionId: 'other-thread',
    } as ChatMessage)

    const first = useChatStore.getState().openConversation('old-thread')
    const second = useChatStore.getState().openConversation('other-thread')
    await Promise.all([first, second])

    expect(useChatStore.getState().currentSessionId).toBe('other-thread')
    expect(mocks.setStoredCalls).toEqual(['other-thread'])
  })

  it('does not commit when the first open stalls inside proposal repair', async () => {
    mocks.chatMessages.push({
      id: 'other', role: 'user', content: 'Quiero correr',
      timestamp: 2000, chatSessionId: 'other-thread',
    } as ChatMessage)

    // El PRIMER open queda bloqueado dentro de la reparación; el segundo pasa
    // libre y commitea antes.
    let releaseFirst: () => void = () => {}
    mocks.repairGates = [new Promise<void>((resolve) => { releaseFirst = resolve })]

    const first = useChatStore.getState().openConversation('old-thread')
    const second = useChatStore.getState().openConversation('other-thread')
    await second

    expect(useChatStore.getState().currentSessionId).toBe('other-thread')

    // Al liberarse tarde, el primero debe fallar el chequeo del paso 6 y no
    // escribir NADA: ni id persistido, ni mensajes, ni rotación suspendida.
    releaseFirst()
    await first

    expect(useChatStore.getState().currentSessionId).toBe('other-thread')
    expect(useChatStore.getState().messages.map(m => m.id)).toEqual(['other'])
    expect(mocks.setStoredCalls).toEqual(['other-thread'])
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/store/__tests__/chatConversations.test.ts`
Expected: FAIL — `openConversation is not a function`.

- [ ] **Step 5: Write minimal implementation**

```ts
  openConversation: async (sessionId: string) => {
    // El token se adquiere ANTES de validar: dos toques rápidos en el drawer
    // pueden resolverse fuera de orden y dejar ganando al primero.
    const requestId = ++latestHistoryLoadRequestId

    const rows = filterRowsToActiveScope(
      await db.chatMessages.where('chatSessionId').equals(sessionId).toArray(),
    )
    if (requestId !== latestHistoryLoadRequestId) return
    if (rows.length === 0) {
      set({ error: 'No encontramos esa conversación.' })
      return
    }

    await loadSession(sessionId, { requestId, persistId: true, suspendRotation: true })
  },
```

- [ ] **Step 6: Close the task**

Run: `npm run lint && npm test`

```bash
git add src/store/useChatStore.ts src/store/__tests__/chatConversations.test.ts
git commit -m "feat(chat): open a previous conversation without losing the race"
```

---

## Task 8: `loadConversations()`, estado del índice y reset por atleta

**Files:**
- Modify: `src/store/useChatStore.ts` (estado, `resetForAthleteSwitch` en `:352-357`)
- Test: `src/store/__tests__/chatConversations.test.ts` (agregar bloque)

**Interfaces:**
- Consumes: `listConversations` de Task 4.
- Produces: estado `conversations`, `conversationsStatus`, `conversationsDirty`; acción `loadConversations(): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Agregar `conversations: [] as ConversationSummary[]` y `listDeferrals: [] as ((v: ConversationSummary[]) => void)[]` al `vi.hoisted`, y:

```ts
vi.mock('../../services/chat/conversationIndex', () => ({
  listConversations: vi.fn(() => {
    if (mocks.listDeferrals.length > 0) {
      return new Promise<ConversationSummary[]>((resolve) => {
        mocks.listDeferrals.push(resolve)
      })
    }
    return Promise.resolve(mocks.conversations)
  }),
  searchConversations: vi.fn(async () => []),
}))
```

> Para los tests deterministas usá dos helpers: por defecto `listConversations`
> resuelve ya; si el test empuja un sentinel en `mocks.listDeferrals` antes de
> llamar, la promesa queda diferida y el test la resuelve a mano.

```ts
describe('loadConversations', () => {
  beforeEach(() => {
    mocks.listDeferrals = []
    mocks.conversations = [{
      sessionId: 's1', title: 'Hombro', lastMessageAt: 200, firstMessageAt: 100, messageCount: 3,
    }]
    useChatStore.setState({ conversations: [], conversationsStatus: 'idle', conversationsDirty: true })
  })

  it('loads the index and marks it clean', async () => {
    await useChatStore.getState().loadConversations()
    const state = useChatStore.getState()
    expect(state.conversations.map(c => c.sessionId)).toEqual(['s1'])
    expect(state.conversationsStatus).toBe('ready')
    expect(state.conversationsDirty).toBe(false)
  })

  it('keeps the last valid list and stays dirty on error', async () => {
    await useChatStore.getState().loadConversations()
    const { listConversations } = await import('../../services/chat/conversationIndex')
    vi.mocked(listConversations).mockRejectedValueOnce(new Error('dexie down'))

    await useChatStore.getState().loadConversations()

    const state = useChatStore.getState()
    expect(state.conversationsStatus).toBe('error')
    expect(state.conversations.map(c => c.sessionId)).toEqual(['s1'])
    expect(state.conversationsDirty).toBe(true)
  })

  it('clears the index on athlete switch', () => {
    useChatStore.setState({
      conversations: mocks.conversations, conversationsStatus: 'ready', rotationSuspended: true,
    })
    useChatStore.getState().resetForAthleteSwitch()
    const state = useChatStore.getState()
    expect(state.conversations).toEqual([])
    expect(state.conversationsStatus).toBe('idle')
    expect(state.rotationSuspended).toBe(false)
  })

  it('discards a load that resolves after an athlete switch', async () => {
    // Deja la carga en vuelo...
    mocks.listDeferrals.push(() => {})
    const pending = useChatStore.getState().loadConversations()
    const resolveLate = mocks.listDeferrals[mocks.listDeferrals.length - 1]

    // ...cambia de atleta mientras corre...
    useChatStore.getState().resetForAthleteSwitch()

    // ...y la respuesta vieja llega tarde con datos del atleta anterior.
    resolveLate([{
      sessionId: 'stale', title: 'De otro atleta',
      lastMessageAt: 1, firstMessageAt: 1, messageCount: 1,
    }])
    await pending

    const state = useChatStore.getState()
    expect(state.conversations).toEqual([])
    expect(state.conversationsStatus).toBe('idle')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/__tests__/chatConversations.test.ts`
Expected: FAIL — `loadConversations is not a function`.

- [ ] **Step 3: Write minimal implementation**

Token propio, independiente del historial:

```ts
let latestConversationsLoadRequestId = 0
```

```ts
  loadConversations: async () => {
    const requestId = ++latestConversationsLoadRequestId
    set({ conversationsStatus: 'loading' })
    try {
      const conversations = await listConversations()
      if (requestId !== latestConversationsLoadRequestId) return
      set({ conversations, conversationsStatus: 'ready', conversationsDirty: false })
    } catch {
      if (requestId !== latestConversationsLoadRequestId) return
      // Se conserva la última lista válida y queda sucio para reintentar en serio.
      set({ conversationsStatus: 'error', conversationsDirty: true })
    }
  },
```

```ts
  resetForAthleteSwitch: () => {
    activeChatAbortController?.abort()
    activeChatAbortController = null
    latestHistoryLoadRequestId += 1
    latestConversationsLoadRequestId += 1
    set({
      messages: [], isLoading: false, streamingText: '', responsePhase: 'idle', error: null,
      conversations: [], conversationsStatus: 'idle', conversationsDirty: true,
      rotationSuspended: false,
    })
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/__tests__/chatConversations.test.ts`
Expected: PASS, 4 tests del bloque.

- [ ] **Step 5: Close the task**

Run: `npm run lint && npm test`

```bash
git add src/store/useChatStore.ts src/store/__tests__/chatConversations.test.ts
git commit -m "feat(chat): load the conversation index with its own request token"
```

---

## Task 9: `deleteConversation()` generalizado

**Files:**
- Modify: `src/store/useChatStore.ts:317-350`
- Test: `src/store/__tests__/chatConversations.test.ts` (agregar bloque)

**Interfaces:**
- Consumes: `newSession`, `loadConversations`.
- Produces: `deleteConversation(sessionId: string): Promise<void>`; `deleteCurrentSession()` como wrapper.

- [ ] **Step 1: Write the failing test**

El mock de `bulkDelete` tiene que **registrar los ids**, para que una implementación que no borre nada no pase. Cambiar el mock de `db.chatMessages.bulkDelete` a:

```ts
      bulkDelete: vi.fn(async (ids: string[]) => {
        mocks.deletedMessageIds.push(...ids)
        for (const id of ids) {
          const index = mocks.chatMessages.findIndex(m => m.id === id)
          if (index >= 0) mocks.chatMessages.splice(index, 1)
        }
      }),
```

y agregar `deletedMessageIds: [] as string[]` al `vi.hoisted`.

```ts
describe('deleteConversation', () => {
  beforeEach(() => {
    mocks.chatMessages.length = 0
    mocks.deletedMessageIds.length = 0
    mocks.listDeferrals = []
    mocks.conversations = []
    mocks.chatMessages.push(
      { id: 'cur', role: 'user', content: 'hoy', timestamp: 900, chatSessionId: 'current-session' } as ChatMessage,
      { id: 'old', role: 'user', content: 'ayer', timestamp: 100, chatSessionId: 'old-thread' } as ChatMessage,
    )
    useChatStore.setState({ currentSessionId: 'current-session', messages: [] })
  })

  it('deletes only the targeted conversation and leaves the current one alone', async () => {
    await useChatStore.getState().deleteConversation('old-thread')

    expect(mocks.deletedMessageIds).toEqual(['old'])
    expect(mocks.chatMessages.map(m => m.id)).toEqual(['cur'])
    expect(useChatStore.getState().currentSessionId).toBe('current-session')
  })

  it('starts a new session only when the current conversation is deleted', async () => {
    await useChatStore.getState().deleteConversation('current-session')

    expect(mocks.deletedMessageIds).toEqual(['cur'])
    expect(useChatStore.getState().currentSessionId).not.toBe('current-session')
  })

  it('refreshes the index after deleting', async () => {
    const { listConversations } = await import('../../services/chat/conversationIndex')
    vi.mocked(listConversations).mockClear()

    await useChatStore.getState().deleteConversation('old-thread')

    expect(listConversations).toHaveBeenCalled()
    // Tras una recarga exitosa el índice queda limpio, no sucio.
    expect(useChatStore.getState().conversationsDirty).toBe(false)
  })

  it('does not start a new session if the user switched conversation mid-delete', async () => {
    const deleting = useChatStore.getState().deleteConversation('current-session')
    // El usuario abrió otra conversación mientras se borraba.
    useChatStore.setState({ currentSessionId: 'old-thread' })
    await deleting

    expect(useChatStore.getState().currentSessionId).toBe('old-thread')
  })

  it('deleteCurrentSession delegates to deleteConversation', async () => {
    const spy = vi.spyOn(useChatStore.getState(), 'deleteConversation')
    await useChatStore.getState().deleteCurrentSession()
    expect(spy).toHaveBeenCalledWith('current-session')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/__tests__/chatConversations.test.ts`
Expected: FAIL — `deleteConversation is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
  deleteConversation: async (sessionId: string) => {
    if (sessionId === get().currentSessionId) {
      activeChatAbortController?.abort()
      activeChatAbortController = null
    }

    // Borrar SOLO mensajes del scope activo: un thread puede contener filas de
    // otro atleta (import, estado viejo, colisión de session id). Se derivan los
    // ids desde la lista filtrada y se borra por ids, nunca por chatSessionId.
    const sessionMessages = filterRowsToActiveScope(
      await db.chatMessages.where('chatSessionId').equals(sessionId).toArray(),
    )
    const messageIds = sessionMessages.map((message) => message.id)

    const linkedProposals = messageIds.length > 0
      ? await db.coachProposals.where('chatMessageId').anyOf(messageIds).toArray()
      : []
    const proposalIds = linkedProposals.map(p => p.id)
    if (proposalIds.length > 0) {
      await db.coachProposals.bulkDelete(proposalIds)
      await syncService.deleteCoachProposals(proposalIds)
      await useCoachActionsStore.getState().loadProposals()
    }

    await db.chatMessages.bulkDelete(messageIds)
    await syncService.deleteChatMessages(messageIds)

    // Se re-chequea DESPUÉS de los await: si el usuario abrió otra conversación
    // mientras se borraba, no hay que pisarla con una sesión nueva.
    if (get().currentSessionId === sessionId) {
      await get().newSession()
    }
    await get().loadConversations()
  },

  deleteCurrentSession: async () => {
    await get().deleteConversation(get().currentSessionId)
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/__tests__/chatConversations.test.ts src/store/__tests__/useChatStore.test.ts`
Expected: PASS, incluidos los tests de borrado existentes.

- [ ] **Step 5: Close the task**

Run: `npm run lint && npm test`

```bash
git add src/store/useChatStore.ts src/store/__tests__/chatConversations.test.ts
git commit -m "feat(chat): generalise deletion to any conversation"
```

---

## Task 10: Rotación en los dos puntos de integración

**Files:**
- Modify: `src/store/useChatStore.ts` (`newSession` en `:309`, arranque de `sendMessage` en `:94-107`)
- Test: `src/store/__tests__/useChatStore.test.ts` (agregar bloque)

**Interfaces:**
- Consumes: `shouldRotateConversation` de Task 1.
- Produces: privado `startFreshSessionSync(): string` (**síncrono**); `newSession()` pasa a delegar y conserva su firma.

**Por qué los tests van en `useChatStore.test.ts`:** ese archivo ya mockea routing, proveedor, DB y propuestas (`mocks.send`, `mocks.sendAction`, `mocks.routeKind`), que es lo que hace falta para ejercitar `sendMessage` de punta a punta. Duplicar todo ese andamiaje en `chatConversations.test.ts` sería peor.

- [ ] **Step 1: Write the failing test**

```ts
describe('daily rotation on send', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.routeKind = 'chat_general'
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rotates before building the provider history when the thread is from yesterday', async () => {
    vi.setSystemTime(new Date(2026, 6, 26, 8, 0))
    useChatStore.setState({
      isLoading: false,
      rotationSuspended: false,
      currentSessionId: 'yesterday-session',
      messages: [{
        id: 'old', role: 'user', content: 'lo de ayer',
        timestamp: new Date(2026, 6, 25, 20, 0).getTime(),
        chatSessionId: 'yesterday-session',
      } as ChatMessage],
    })

    await useChatStore.getState().sendMessage('hoy quiero entrenar')

    const state = useChatStore.getState()
    expect(state.currentSessionId).not.toBe('yesterday-session')
    expect(state.messages.some(m => m.id === 'old')).toBe(false)
  })

  it('does not rotate when the user explicitly opened an old conversation', async () => {
    vi.setSystemTime(new Date(2026, 6, 26, 8, 0))
    useChatStore.setState({
      isLoading: false,
      rotationSuspended: true,
      currentSessionId: 'yesterday-session',
      messages: [{
        id: 'old', role: 'user', content: 'lo de ayer',
        timestamp: new Date(2026, 6, 25, 20, 0).getTime(),
        chatSessionId: 'yesterday-session',
      } as ChatMessage],
    })

    await useChatStore.getState().sendMessage('sigo con esto')

    expect(useChatStore.getState().currentSessionId).toBe('yesterday-session')
  })

  it('does not rotate while a request is in flight', async () => {
    vi.setSystemTime(new Date(2026, 6, 26, 8, 0))
    useChatStore.setState({
      isLoading: true,
      rotationSuspended: false,
      currentSessionId: 'yesterday-session',
      messages: [{
        id: 'old', role: 'user', content: 'x',
        timestamp: new Date(2026, 6, 25, 20, 0).getTime(),
        chatSessionId: 'yesterday-session',
      } as ChatMessage],
    })

    await useChatStore.getState().sendMessage('nuevo')

    expect(useChatStore.getState().currentSessionId).toBe('yesterday-session')
  })

  it('produces one rotation and one provider request for two sends in the same tick', async () => {
    vi.setSystemTime(new Date(2026, 6, 26, 8, 0))
    mocks.send.mockClear()
    useChatStore.setState({
      isLoading: false,
      rotationSuspended: false,
      currentSessionId: 'yesterday-session',
      messages: [{
        id: 'old', role: 'user', content: 'lo de ayer',
        timestamp: new Date(2026, 6, 25, 20, 0).getTime(),
        chatSessionId: 'yesterday-session',
      } as ChatMessage],
    })

    // Sin await entre las dos: si la rotación cediera el turno antes del lock de
    // isLoading, las dos rotarían y las dos mandarían request.
    const first = useChatStore.getState().sendMessage('uno')
    const second = useChatStore.getState().sendMessage('dos')
    await Promise.all([first, second])

    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
})
```

> Si en este archivo el proveedor para `chat_general` no es `mocks.send` sino
> otro spy, ajustá el nombre — la aserción que importa es **una sola llamada al
> proveedor**.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/__tests__/useChatStore.test.ts`
Expected: FAIL — hoy `sendMessage` no rota: el primer test encuentra `old` en el hilo nuevo.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * Cambio de sesión SÍNCRONO. `newSession()` es async, y hacer
 * `await get().newSession()` dentro de sendMessage cedería el turno ANTES del
 * lock de isLoading, abriendo una ventana para dos envíos o dos rotaciones
 * simultáneas. Entre el guard de isLoading y set({ isLoading: true }) no puede
 * existir ningún await.
 */
function startFreshSessionSync(): string {
  activeChatAbortController?.abort()
  activeChatAbortController = null
  const newId = uuid()
  setStoredChatSessionId(newId)
  useChatStore.setState({
    currentSessionId: newId,
    messages: [],
    isLoading: false,
    streamingText: '',
    responsePhase: 'idle',
    error: null,
    rotationSuspended: false,
    conversationsDirty: true,
  })
  return newId
}
```

```ts
  newSession: async () => {
    startFreshSessionSync()
  },
```

**Primera línea** de `sendMessage`, antes de `routeRecentMessages`:

```ts
  sendMessage: async (content, context) => {
    // Rotación diaria: PRIMERO de todo. Hay DOS derivaciones de historial
    // —routeRecentMessages (ruteo/contexto) y recentMessages (proveedor)— y las
    // dos salen de get().messages, así que rotar acá cubre ambas. Rotar después
    // mandaría el hilo de ayer al proveedor con un sessionId nuevo.
    if (!get().isLoading && !get().rotationSuspended) {
      const current = get().messages
      const lastAt = current.length > 0 ? current[current.length - 1].timestamp : null
      if (shouldRotateConversation(lastAt, Date.now())) startFreshSessionSync()
    }
    const requestStartedAt = Date.now()
    // ...resto sin cambios
```

Y descomentar la rotación de `loadHistory` dejada en la Task 6, quitando el `TODO`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/__tests__/useChatStore.test.ts src/store/__tests__/chatConversations.test.ts`
Expected: PASS. Si un test existente rompe por la rotación, revisá que use un `timestamp` de hoy; **no** debilites la rotación para que pase.

- [ ] **Step 5: Close the task**

Run: `npm run lint && npm test`

```bash
git add src/store/useChatStore.ts src/store/__tests__/useChatStore.test.ts
git commit -m "feat(chat): rotate conversations by calendar day"
```

---

## Task 11: `ConversationDrawer`

**Files:**
- Create: `src/components/chat/ConversationDrawer.tsx`
- Test: `src/components/chat/__tests__/ConversationDrawer.test.tsx`

**Interfaces:**
- Consumes: `ConversationSummary`, `ConversationSearchResult`, `searchConversations`; store: `conversations`, `conversationsStatus`, `conversationsDirty`, `currentSessionId`, `loadConversations`, `deleteConversation`.
- Produces: `ConversationDrawer` con props `{ isOpen: boolean; onClose: () => void; onSelect: (sessionId: string, matchedMessageId: string | null) => void }`.

- [ ] **Step 1: Write the failing test**

**Todo lo que el factory de `vi.mock` toque debe venir de `vi.hoisted`**: los factories se hoistean por encima de los `const` del módulo.

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ConversationSearchResult, ConversationSummary } from '../../../services/chat/conversationIndex'
import ConversationDrawer from '../ConversationDrawer'

const h = vi.hoisted(() => ({
  conversations: [] as ConversationSummary[],
  searchDeferrals: [] as ((value: ConversationSearchResult[]) => void)[],
  loadConversations: vi.fn(),
  deleteConversation: vi.fn(),
  status: 'ready' as 'idle' | 'loading' | 'ready' | 'error',
}))

vi.mock('../../../services/chat/conversationIndex', () => ({
  searchConversations: vi.fn(() => new Promise<ConversationSearchResult[]>((resolve) => {
    h.searchDeferrals.push(resolve)
  })),
  listConversations: vi.fn(async () => h.conversations),
}))

vi.mock('../../../store/useChatStore', () => ({
  useChatStore: (selector: (s: unknown) => unknown) => selector({
    conversations: h.conversations,
    conversationsStatus: h.status,
    conversationsDirty: false,
    currentSessionId: 's1',
    loadConversations: h.loadConversations,
    deleteConversation: h.deleteConversation,
  }),
}))

const NOW = new Date(2026, 6, 26, 12, 0).getTime()

beforeEach(() => {
  h.searchDeferrals.length = 0
  h.status = 'ready'
  h.conversations = [
    { sessionId: 's1', title: 'Molestia en el hombro', lastMessageAt: NOW, firstMessageAt: NOW - 1000, messageCount: 8 },
    { sessionId: 's2', title: 'Semana de torneo', lastMessageAt: NOW - 86_400_000, firstMessageAt: NOW - 90_000_000, messageCount: 12 },
  ]
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ConversationDrawer', () => {
  it('lists conversations grouped by day', async () => {
    render(<ConversationDrawer isOpen onClose={() => {}} onSelect={() => {}} />)
    expect(await screen.findByText('Molestia en el hombro')).toBeTruthy()
    expect(screen.getByText('Semana de torneo')).toBeTruthy()
    expect(screen.getByText('Hoy')).toBeTruthy()
    expect(screen.getByText('Ayer')).toBeTruthy()
  })

  it('calls onSelect with the session id when a conversation is tapped', async () => {
    const onSelect = vi.fn()
    render(<ConversationDrawer isOpen onClose={() => {}} onSelect={onSelect} />)
    await userEvent.click(await screen.findByText('Semana de torneo'))
    expect(onSelect).toHaveBeenCalledWith('s2', null)
  })

  it('renders nothing when closed', () => {
    const { container } = render(<ConversationDrawer isOpen={false} onClose={() => {}} onSelect={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('discards a stale search result that resolves late', async () => {
    vi.useFakeTimers()
    render(<ConversationDrawer isOpen onClose={() => {}} onSelect={() => {}} />)
    const input = screen.getByPlaceholderText(/buscar/i)

    // fireEvent y no userEvent: con timers falsos userEvent necesitaría
    // setup({ advanceTimers }), y acá solo hace falta disparar el change.
    fireEvent.change(input, { target: { value: 'hom' } })
    await vi.advanceTimersByTimeAsync(300)
    fireEvent.change(input, { target: { value: 'hombro' } })
    await vi.advanceTimersByTimeAsync(300)

    expect(h.searchDeferrals).toHaveLength(2)

    const fresh: ConversationSearchResult[] = [{
      ...h.conversations[0], title: 'Resultado nuevo', snippet: 'bro', matchCount: 1, matchedMessageId: 'm2',
    }]
    const stale: ConversationSearchResult[] = [{
      ...h.conversations[1], title: 'Resultado viejo', snippet: 'hom', matchCount: 1, matchedMessageId: 'm1',
    }]

    // La SEGUNDA resuelve primero; la primera llega tarde con datos viejos.
    h.searchDeferrals[1](fresh)
    await vi.advanceTimersByTimeAsync(0)
    h.searchDeferrals[0](stale)
    await vi.advanceTimersByTimeAsync(0)

    expect(screen.getByText('Resultado nuevo')).toBeTruthy()
    expect(screen.queryByText('Resultado viejo')).toBeNull()
  })

  it('does not keep results when the drawer closes with a search in flight', async () => {
    vi.useFakeTimers()
    const { rerender } = render(<ConversationDrawer isOpen onClose={() => {}} onSelect={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText(/buscar/i), { target: { value: 'hombro' } })
    await vi.advanceTimersByTimeAsync(300)

    rerender(<ConversationDrawer isOpen={false} onClose={() => {}} onSelect={() => {}} />)

    h.searchDeferrals[0]?.([{
      ...h.conversations[0], title: 'Tarde', snippet: 'x', matchCount: 1, matchedMessageId: 'm1',
    }])
    await vi.advanceTimersByTimeAsync(0)

    rerender(<ConversationDrawer isOpen onClose={() => {}} onSelect={() => {}} />)
    expect(screen.queryByText('Tarde')).toBeNull()
  })

  it('shows the last valid list plus a retry when the index errored', async () => {
    h.status = 'error'
    render(<ConversationDrawer isOpen onClose={() => {}} onSelect={() => {}} />)
    expect(screen.getByText('Molestia en el hombro')).toBeTruthy()
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/chat/__tests__/ConversationDrawer.test.tsx`
Expected: FAIL — no existe `../ConversationDrawer`.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { format, isSameDay, isYesterday } from 'date-fns'
import { es } from 'date-fns/locale'
import { Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  searchConversations,
  type ConversationSearchResult,
  type ConversationSummary,
} from '../../services/chat/conversationIndex'
import { useChatStore } from '../../store/useChatStore'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSelect: (sessionId: string, matchedMessageId: string | null) => void
}

function dayLabel(timestamp: number, now: number): string {
  const date = new Date(timestamp)
  if (isSameDay(date, new Date(now))) return 'Hoy'
  if (isYesterday(date)) return 'Ayer'
  return format(date, 'd MMM', { locale: es })
}

export default function ConversationDrawer({ isOpen, onClose, onSelect }: Props) {
  const conversations = useChatStore((s) => s.conversations)
  const conversationsStatus = useChatStore((s) => s.conversationsStatus)
  const conversationsDirty = useChatStore((s) => s.conversationsDirty)
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const loadConversations = useChatStore((s) => s.loadConversations)
  const deleteConversation = useChatStore((s) => s.deleteConversation)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ConversationSearchResult[] | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const searchToken = useRef(0)

  // Recarga solo si hace falta: abrir y cerrar sin escribir nada no dispara dos
  // escaneos.
  useEffect(() => {
    if (!isOpen) return
    if (conversationsStatus === 'ready' && !conversationsDirty) return
    void loadConversations()
  }, [isOpen, conversationsStatus, conversationsDirty, loadConversations])

  useEffect(() => {
    if (!isOpen) {
      setResults(null)
      setPendingDelete(null)
      setQuery('')
      return
    }
    const trimmed = query.trim()
    if (trimmed.length === 0) {
      setResults(null) // usa `conversations` del store: sin escaneo de Dexie
      return
    }
    const token = ++searchToken.current
    let cancelled = false
    const timer = setTimeout(() => {
      searchConversations(trimmed)
        .then((found) => {
          if (cancelled || token !== searchToken.current) return
          setResults(found)
        })
        .catch(() => {
          if (cancelled || token !== searchToken.current) return
          setResults([]) // un fallo de Dexie no debe dejar un rechazo sin manejar
        })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, isOpen])

  const rows: (ConversationSummary | ConversationSearchResult)[] = results ?? conversations
  const now = Date.now()
  const grouped = useMemo(() => {
    const groups: { label: string; items: typeof rows }[] = []
    for (const row of rows) {
      const label = dayLabel(row.lastMessageAt, now)
      const last = groups[groups.length - 1]
      if (last && last.label === label) last.items.push(row)
      else groups.push({ label, items: [row] })
    }
    return groups
  }, [rows, now])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        aria-label="Cerrar conversaciones"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <aside className="relative flex h-full w-[86%] max-w-sm flex-col border-r border-surface-soft/70 bg-surface-panel">
        <div className="flex items-center gap-2 border-b border-surface-soft/70 px-3 py-3">
          <Search size={14} className="flex-shrink-0 text-ink-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar en tus conversaciones"
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-ink-faint">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {conversationsStatus === 'loading' && rows.length === 0 && (
            <p className="px-2 py-3 text-xs text-ink-faint">Cargando tus conversaciones…</p>
          )}

          {conversationsStatus === 'error' && (
            <div className="mb-2 rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2">
              <p className="text-xs text-red-300">No pudimos actualizar la lista.</p>
              <button
                type="button"
                onClick={() => { void loadConversations() }}
                className="mt-1 text-xs font-semibold text-brand-light"
              >
                Reintentar
              </button>
            </div>
          )}

          {rows.length === 0 && conversationsStatus !== 'loading' && (
            <p className="px-2 py-3 text-xs text-ink-faint">
              {query.trim().length > 0
                ? 'No encontramos nada con esa búsqueda.'
                : 'Todavía no tenés conversaciones guardadas.'}
            </p>
          )}

          {grouped.map((group) => (
            <div key={group.label} className="mb-3">
              <p className="px-2 pb-1 font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
                {group.label}
              </p>
              {group.items.map((row) => {
                const isCurrent = row.sessionId === currentSessionId
                const matchedMessageId = 'matchedMessageId' in row ? row.matchedMessageId : null
                const snippet = 'snippet' in row ? row.snippet : ''
                return (
                  <div
                    key={row.sessionId}
                    className={`mb-1 flex items-start gap-2 rounded-lg px-2 py-2 ${isCurrent ? 'bg-brand/10' : 'hover:bg-surface-raised'}`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(row.sessionId, matchedMessageId)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-sm text-ink">{row.title}</p>
                      {snippet && <p className="mt-0.5 truncate text-[11px] text-ink-muted">{snippet}</p>}
                      <p className="mt-0.5 text-[10px] text-ink-faint">
                        {format(new Date(row.lastMessageAt), 'HH:mm')} · {row.messageCount} mensajes
                      </p>
                    </button>
                    <button
                      type="button"
                      aria-label={pendingDelete === row.sessionId ? 'Confirmar borrado' : 'Borrar conversación'}
                      onClick={() => {
                        if (pendingDelete !== row.sessionId) {
                          setPendingDelete(row.sessionId)
                          return
                        }
                        setPendingDelete(null)
                        void deleteConversation(row.sessionId)
                      }}
                      className={`flex-shrink-0 p-1 ${pendingDelete === row.sessionId ? 'text-red-400' : 'text-ink-faint'}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </aside>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/chat/__tests__/ConversationDrawer.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Close the task**

Run: `npm run lint && npm test`

```bash
git add src/components/chat/ConversationDrawer.tsx src/components/chat/__tests__/ConversationDrawer.test.tsx
git commit -m "feat(chat): add the conversation drawer"
```

---

## Task 12: Cablear el drawer y el scroll al match

**Files:**
- Modify: `src/pages/ChatCoach.tsx` (imports `:26-27`, header `:345-419`, efecto de scroll `:154-156`, map de mensajes `~:489`, montaje `~:596`)
- Test: `src/pages/__tests__/chatCoachConversations.test.tsx` (crear)

**Interfaces:**
- Consumes: `ConversationDrawer` de Task 11; `openConversation` del store.
- Produces: nada para tareas posteriores.

- [ ] **Step 1: Write the failing test**

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChatMessage } from '../../types'

const h = vi.hoisted(() => ({
  openConversation: vi.fn(),
  messages: [] as ChatMessage[],
  loadProposals: vi.fn(),
  loadMemory: vi.fn(),
  loadWeek: vi.fn(),
}))

// El drawer se reemplaza por un doble: esta tarea prueba el cableado de
// ChatCoach, no el drawer (ya cubierto en Task 11).
vi.mock('../../components/chat/ConversationDrawer', () => ({
  default: ({ isOpen, onSelect }: {
    isOpen: boolean
    onSelect: (sessionId: string, matchedMessageId: string | null) => void
  }) => isOpen
    ? <button type="button" onClick={() => onSelect('s2', 'msg-2')}>abrir resultado</button>
    : null,
}))

vi.mock('../../store/useChatStore', () => ({
  useChatStore: () => ({
    messages: h.messages,
    isLoading: false,
    streamingText: '',
    responsePhase: 'idle',
    error: null,
    loadHistory: vi.fn(),
    sendMessage: vi.fn(),
    newSession: vi.fn(),
    deleteCurrentSession: vi.fn(),
    openConversation: h.openConversation,
  }),
}))

vi.mock('../../store/useCoachActionsStore', () => ({
  useCoachActionsStore: () => ({
    proposals: [],
    loadProposals: h.loadProposals,
    acceptProposal: vi.fn(),
    rejectProposal: vi.fn(),
  }),
}))

vi.mock('../../store/useCoachMemoryStore', () => ({
  useCoachMemoryStore: () => ({
    coachMemory: '',
    athleteProfile: null,
    loadMemory: h.loadMemory,
  }),
}))

vi.mock('../../store/useTrainingStore', () => ({
  useTrainingStore: () => ({
    sessions: [],
    currentWeekSummary: null,
    dayLogs: {},
    loadWeek: h.loadWeek,
  }),
}))

vi.mock('../../store/useAuthStore', () => ({
  useAuthStore: (selector: (state: { activeAthleteId: null }) => unknown) =>
    selector({ activeAthleteId: null }),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ key: 'test', pathname: '/chat', state: null }),
}))

const scrollSpy = vi.fn()

beforeEach(() => {
  scrollSpy.mockClear()
  h.openConversation.mockClear()
  // jsdom no implementa scrollIntoView.
  Element.prototype.scrollIntoView = scrollSpy
  h.messages = [
    { id: 'current-msg', role: 'user', content: 'actual', timestamp: 1, chatSessionId: 's1' } as ChatMessage,
  ]
})

describe('ChatCoach conversation wiring', () => {
  it('opens the drawer from the header button', async () => {
    const { default: ChatCoach } = await import('../ChatCoach')
    render(<ChatCoach />)
    await userEvent.click(screen.getByRole('button', { name: /conversaciones/i }))
    expect(screen.getByText('abrir resultado')).toBeTruthy()
  })

  it('scrolls to the matched message instead of the bottom', async () => {
    const { default: ChatCoach } = await import('../ChatCoach')
    const view = render(<ChatCoach />)

    await userEvent.click(screen.getByRole('button', { name: /conversaciones/i }))
    await userEvent.click(screen.getByText('abrir resultado'))

    expect(h.openConversation).toHaveBeenCalledWith('s2')
    expect(document.querySelector('[data-message-id="msg-2"]')).toBeNull()

    // La apertura async termina después: el target debe seguir pendiente aunque
    // el nodo no existiera en el primer efecto.
    h.messages = [
      { id: 'msg-1', role: 'user', content: 'uno', timestamp: 1, chatSessionId: 's2' } as ChatMessage,
      { id: 'msg-2', role: 'user', content: 'dos', timestamp: 2, chatSessionId: 's2' } as ChatMessage,
    ]
    view.rerender(<ChatCoach />)

    const target = document.querySelector('[data-message-id="msg-2"]')
    expect(target).toBeTruthy()
    // El ÚLTIMO scroll debe haber sido sobre el mensaje del match, no sobre el
    // ancla del final.
    const lastCall = scrollSpy.mock.contexts[scrollSpy.mock.calls.length - 1]
    expect(lastCall).toBe(target)
    expect(scrollSpy).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'center' })
  })
})
```

> Si tu versión de Vitest no expone `mock.contexts`, capturá el receptor con
> `Element.prototype.scrollIntoView = function (opts) { scrollSpy(this, opts) }`
> y afirmá sobre el primer argumento. La aserción que importa es **quién** recibió
> el último scroll.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/__tests__/chatCoachConversations.test.tsx`
Expected: FAIL — no existe el botón "Conversaciones".

- [ ] **Step 3: Write minimal implementation**

1. Import lazy junto a los otros (`ChatCoach.tsx:26-27`):

```tsx
const ConversationDrawer = lazy(() => import('../components/chat/ConversationDrawer'))
```

2. Estado nuevo:

```tsx
const [drawerOpen, setDrawerOpen] = useState(false)
const [scrollTargetId, setScrollTargetId] = useState<string | null>(null)
const pendingScrollTargetRef = useRef<string | null>(null)
```

3. Botón a la izquierda del título, dentro del `div` de `:347` (agregar `Menu` al import de `lucide-react`):

```tsx
<button
  type="button"
  onClick={() => setDrawerOpen(true)}
  aria-label="Conversaciones"
  title="Ver tus conversaciones"
  className="flex-shrink-0 p-1 text-ink-faint transition-colors hover:text-ink-muted"
>
  <Menu size={18} />
</button>
```

4. Montaje junto al `ProposalDrawer` (`~:596`), tomando `openConversation` del store en el destructuring de `:96`:

```tsx
<Suspense fallback={null}>
  <ConversationDrawer
    isOpen={drawerOpen}
    onClose={() => setDrawerOpen(false)}
    onSelect={(sessionId, matchedMessageId) => {
      void openConversation(sessionId)
      pendingScrollTargetRef.current = matchedMessageId
      setScrollTargetId(matchedMessageId)
      setDrawerOpen(false)
    }}
  />
</Suspense>
```

5. `data-message-id` en el contenedor de cada burbuja, en el map de `~:489`:

```tsx
<div key={message.id} data-message-id={message.id} /* ...resto igual */>
```

6. **Los dos efectos de scroll.** El target se instala de forma síncrona pero
   `openConversation()` es async: cuando el efecto corre por primera vez todavía
   están los mensajes viejos y el nodo **no existe**. Por eso el target se limpia
   **solo si lo encontró**, y el efecto depende del array `messages` (no de su
   longitud, que puede no cambiar entre conversaciones). El ref evita que limpiar
   el estado del target vuelva a disparar inmediatamente el scroll al final:

```tsx
  useEffect(() => {
    if (pendingScrollTargetRef.current) return   // el scroll al match manda
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, isLoading])

  useEffect(() => {
    if (!scrollTargetId) return
    const node = document.querySelector(`[data-message-id="${scrollTargetId}"]`)
    if (!node) return   // la conversación nueva todavía no llegó: NO limpiar
    node.scrollIntoView({ behavior: 'smooth', block: 'center' })
    pendingScrollTargetRef.current = null
    setScrollTargetId(null)
  }, [scrollTargetId, messages])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/__tests__/chatCoachConversations.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Close the task**

Run: `npm run lint && npm test`

```bash
git add src/pages/ChatCoach.tsx src/pages/__tests__/chatCoachConversations.test.tsx
git commit -m "feat(chat): wire the conversation drawer and scroll to search matches"
```

---

## Task 13: Cierre — verificación completa y documentación

**Files:**
- Modify: `PROJECT_REVIEW_AND_ROADMAP.md` (entrada 1 del backlog), `CLAUDE.md` (bloques recientes)

- [ ] **Step 1: Verificación completa**

Run: `npm run lint && npm test && npm run build`
Expected: los tres verdes. `npm run build` corre `tsc -b`, así que acá aparecen los errores de tipo que Vitest no ve.

- [ ] **Step 2: Actualizar el backlog**

En `PROJECT_REVIEW_AND_ROADMAP.md`, marcar la entrada 1 como implementada con fecha, dejando explícito que no hubo migraciones, y mover el foco a la entrada 2 (Plan Builder velocidad).

- [ ] **Step 3: Agregar el bloque a `CLAUDE.md`**

Una entrada en "Bloques recientes relevantes" con: índice derivado sin migraciones, rotación por día calendario, drawer con búsqueda y scroll al match, y la nota de complejidad (escaneo global por falta de índice `[athleteId+timestamp]`).

- [ ] **Step 4: Cierre**

```bash
git add PROJECT_REVIEW_AND_ROADMAP.md CLAUDE.md
git commit -m "docs: record the chat conversations increment"
```

---

## Cobertura del spec

| Sección del spec | Tarea |
|---|---|
| §3.1 tipos y acumulador | 2, 3 |
| §3.2 scope duro | 4 |
| §3.3 invariantes | 3 |
| §3.3.1 título significativo | 2 |
| §3.4 contrato de búsqueda | 5 |
| §3.4.1 concurrencia de búsqueda | 11 |
| §3.4.2 transiciones del índice | 8 |
| §3.5 `loadSession` + token + `persistId` | 6, 7 |
| §3.6 borrado generalizado | 9 |
| §3.7 regla de rotación (pura, incl. DST) | 1 |
| §3.7 rotación en dos puntos + adopción | 6, 10 |
| §3.8 continuidad explícita (`rotationSuspended`) | 6, 7, 10 |
| §3.9 drawer y frescura | 11, 12 |
| §4 criterios de salida | 13 |
| §7 testing | todas |
