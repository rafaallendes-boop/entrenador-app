# Conversaciones del chat — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-26-chat-conversations-design.md`
**Fecha:** 2026-07-26

**Goal:** Poder ver, retomar, buscar y borrar conversaciones anteriores del chat, con rotación automática por día calendario, sin ninguna migración de datos.

**Architecture:** El índice de conversaciones se **deriva** de `chatMessages`, que ya guarda `chatSessionId` y ya sincroniza. Un módulo de servicio hace la derivación con un acumulador puro compartido entre el camino streaming (Dexie `each()`) y el camino en memoria (tests). El store gana un único camino de hidratación con propiedad de token, y la UI agrega un drawer lateral.

**Tech Stack:** React + TypeScript + Zustand + Dexie + Vitest + fake-indexeddb + date-fns + Tailwind + lucide-react.

## Global Constraints

- **Sin migraciones.** Ni Dexie (queda en **v18**), ni Supabase, ni bump de versión de backup. Si una tarea parece necesitar una, está mal entendida: parar y preguntar.
- **Nunca el literal `'default'`** fuera de `activeAthlete.ts`. Usar `ATHLETE_PROFILE_LOCAL_ID`, `getActiveAthleteId()` o `getSelfAthleteId()` (hay un guard test que falla si se viola).
- **Toda lectura de `chatMessages` fuera de sync/export pasa por el filtro de scope.** En este plan, siempre vía `isRowInActiveScope(message.athleteId)`. Las filas legacy sin `athleteId` pertenecen **solo al self**.
- **`chatSessionId` NO es frontera de seguridad.** Prohibido `orderBy('chatSessionId').uniqueKeys()` para agrupar: devuelve ids de todos los atletas.
- **Borrar siempre por ids derivados y scope-filtrados**, nunca por `chatSessionId`.
- **Días calendario, no milisegundos.** `isSameDay` de date-fns. Prohibido `now - last > 86400000`.
- **Entre el guard de `isLoading` y `set({ isLoading: true })` en `sendMessage()` no puede aparecer ningún `await`.** Prohibido `await get().newSession()` ahí.
- Copy de UI en **tuteo** y en español, consistente con el resto de la app.
- Antes de cerrar cada tarea: `npm run lint && npm test`. Al final del plan, además `npm run build`.
- Los commits de cada tarea los ejecuta quien implementa; **el owner es quien hace el commit final a `main`** si así lo pide (`CLAUDE.md`).

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/services/chat/dailyRotation.ts` **(crear)** | Una sola función pura: decidir si toca rotar de conversación. |
| `src/services/chat/conversationIndex.ts` **(crear)** | Tipos del índice, normalización, título, acumulador puro, y las dos lecturas Dexie (`listConversations`, `searchConversations`). |
| `src/services/chat/orphanProposalRepair.ts` **(crear en Task 7)** | Movimiento puro de la reparación de propuestas huérfanas fuera del store, para que sea mockeable desde los tests de concurrencia. |
| `src/store/useChatStore.ts` **(modificar)** | `loadSession()` con token, `openConversation`, `loadConversations`, `deleteConversation`, rotación en dos puntos, adopción endurecida. |
| `src/components/chat/ConversationDrawer.tsx` **(crear)** | Drawer lateral: lista agrupada por día, búsqueda con debounce y token, borrar con confirmación. |
| `src/pages/ChatCoach.tsx` **(modificar)** | Botón de hamburguesa, montaje lazy del drawer, y scroll al match. |

Tests nuevos: `src/services/chat/__tests__/dailyRotation.test.ts`, `.../conversationIndexPure.test.ts`, `.../conversationIndexDexie.test.ts`, `src/store/__tests__/chatConversations.test.ts`, `src/components/chat/__tests__/ConversationDrawer.test.tsx`.

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
import { describe, expect, it } from 'vitest'
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
```

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
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

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
- Consumes: `ChatMessage` de `src/types`.
- Produces:
  - `normalizeForMatch(value: string): string`
  - `deriveConversationTitle(input: { earliestUserContent: string | null; earliestSignificantUserContent: string | null; firstMessageAt: number }): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { deriveConversationTitle, normalizeForMatch } from '../conversationIndex'

const AT = new Date(2026, 6, 22, 10, 0).getTime()

describe('normalizeForMatch', () => {
  it('strips diacritics and lowercases', () => {
    expect(normalizeForMatch('Molestía en la RODÍLLA')).toBe('molestia en la rodilla')
  })

  it('preserves length so index math on the original stays valid', () => {
    const original = 'Café con leche'
    expect(normalizeForMatch(original)).toHaveLength(original.length)
  })
})

describe('deriveConversationTitle', () => {
  it('uses the significant message when there is one', () => {
    expect(deriveConversationTitle({
      earliestUserContent: 'Quiero ajustar la semana',
      earliestSignificantUserContent: 'Quiero ajustar la semana',
      firstMessageAt: AT,
    })).toBe('Quiero ajustar la semana')
  })

  it('strips a leading greeting and restores capitalisation', () => {
    expect(deriveConversationTitle({
      earliestUserContent: 'Hola, quiero ajustar la semana',
      earliestSignificantUserContent: 'Hola, quiero ajustar la semana',
      firstMessageAt: AT,
    })).toBe('Quiero ajustar la semana')
  })

  it('falls back to the raw message when every user message is a greeting', () => {
    expect(deriveConversationTitle({
      earliestUserContent: 'Hola',
      earliestSignificantUserContent: null,
      firstMessageAt: AT,
    })).toBe('Hola')
  })

  it('falls back to the date when there is no user message', () => {
    expect(deriveConversationTitle({
      earliestUserContent: null,
      earliestSignificantUserContent: null,
      firstMessageAt: AT,
    })).toBe('Conversación del 22 jul')
  })

  it('collapses inner whitespace and truncates at a word boundary', () => {
    const long = 'Necesito   que revisemos con calma toda la planificación de la próxima semana porque tengo torneo'
    const title = deriveConversationTitle({
      earliestUserContent: long,
      earliestSignificantUserContent: long,
      firstMessageAt: AT,
    })
    expect(title).toBe('Necesito que revisemos con calma toda la planificación de la próxima semana…')
  })

  it('hard-cuts a single word longer than the cap', () => {
    const url = `https://example.com/${'a'.repeat(120)}`
    const title = deriveConversationTitle({
      earliestUserContent: url,
      earliestSignificantUserContent: url,
      firstMessageAt: AT,
    })
    expect(title).toHaveLength(81)
  })
})
```

> Nota para quien implementa: la aserción del penúltimo test es débil a propósito
> —lo que importa es que trunque en límite de palabra y agregue `…`. Si te
> resulta confusa, reemplazala por `expect(title).toBe('Necesito que revisemos con calma toda la planificación de la próxima semana…')`
> una vez que veas la salida real, y dejá esa forma exacta.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/chat/__tests__/conversationIndexPure.test.ts`
Expected: FAIL — no se puede resolver `../conversationIndex`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

const TITLE_MAX = 80

/** Lista acotada y explícita: se prefiere un título crudo a un recorte equivocado. */
const GREETINGS = [
  'hola', 'holaa', 'holaaa', 'buenas', 'buenos dias', 'buen dia',
  'buenas tardes', 'buenas noches', 'que tal', 'hey', 'buenass',
]

/**
 * NFD + strip de marcas combinantes + minúsculas. Para los caracteres que usa
 * el español esto PRESERVA la longitud, lo que permite mapear índices de la
 * cadena normalizada a la original. Los consumidores igual verifican la
 * longitud antes de hacer aritmética de índices (ver `sliceOriginal`).
 */
export function normalizeForMatch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[\s,.;:!?¡¿]+$/u, '')
}

/** El mensaje ENTERO es un saludo. */
export function isIsolatedGreeting(content: string): boolean {
  const normalized = stripTrailingPunctuation(collapseWhitespace(normalizeForMatch(content)))
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
    const rest = collapsed.slice(greeting.length).replace(/^[\s,.;:!¡]+/u, '')
    if (rest.length === 0) return null
    return rest.charAt(0).toUpperCase() + rest.slice(1)
  }
  return null
}

function truncateTitle(value: string): string {
  const collapsed = collapseWhitespace(value)
  if (collapsed.length <= TITLE_MAX) return collapsed
  const window = collapsed.slice(0, TITLE_MAX)
  const lastSpace = window.lastIndexOf(' ')
  // Palabra única más larga que el tope (una URL): corte duro.
  if (lastSpace <= 0) return `${window}…`
  return `${stripTrailingPunctuation(window.slice(0, lastSpace))}…`
}

export function deriveConversationTitle(input: {
  earliestUserContent: string | null
  earliestSignificantUserContent: string | null
  firstMessageAt: number
}): string {
  const significant = input.earliestSignificantUserContent
  if (significant) {
    return truncateTitle(stripGreetingPrefix(significant) ?? significant)
  }
  if (input.earliestUserContent) return truncateTitle(input.earliestUserContent)
  return `Conversación del ${format(new Date(input.firstMessageAt), "d MMM", { locale: es })}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/chat/__tests__/conversationIndexPure.test.ts`
Expected: PASS. Si el test de truncado falla por la aserción débil, fijar la cadena exacta que devuelve y dejarla escrita.

- [ ] **Step 5: Commit**

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
- Consumes: `deriveConversationTitle` de Task 2.
- Produces:
  - `interface ConversationSummary { sessionId: string; title: string; lastMessageAt: number; firstMessageAt: number; messageCount: number }`
  - `interface ConversationAccumulator`
  - `accumulateConversation(map: Map<string, ConversationAccumulator>, message: ChatMessage): void`
  - `finalizeConversations(map: Map<string, ConversationAccumulator>): ConversationSummary[]`
  - `buildConversationSummaries(messages: ChatMessage[]): ConversationSummary[]`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
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

  it('titles from the earliest significant user message, not the earliest message', () => {
    const result = buildConversationSummaries([
      msg({ id: 'a', timestamp: 100, content: 'Hola' }),
      msg({ id: 'b', timestamp: 200, content: 'Me duele el hombro' }),
    ])
    expect(result[0].title).toBe('Me duele el hombro')
  })

  it('ignores assistant messages for the title', () => {
    const result = buildConversationSummaries([
      msg({ id: 'a', timestamp: 100, role: 'assistant', content: 'Hola, soy tu coach' }),
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

  it('skips user messages that are only whitespace when picking the title', () => {
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

Agregar a `conversationIndex.ts`:

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
 * Acumulador O(1) por mensaje y O(1) en memoria por conversación. Compartido
 * por el camino streaming (`each()`) y el camino en memoria, para que no existan
 * dos derivaciones que puedan divergir. No asume orden de entrada.
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

export function finalizeConversations(map: Map<string, ConversationAccumulator>): ConversationSummary[] {
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
    .sort((a, b) =>
      b.lastMessageAt - a.lastMessageAt || a.sessionId.localeCompare(b.sessionId))
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
Expected: PASS, todos los tests de los Tasks 2 y 3.

- [ ] **Step 5: Commit**

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
- Produces: `listConversations(): Promise<ConversationSummary[]>` y el privado `visitScopedChatMessages(visit: (m: ChatMessage) => void): Promise<void>`.

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
      msg({ id: 'b', timestamp: 200, athleteId: 'ath_self', chatSessionId: 's1', role: 'assistant', content: 'Dale' }),
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
    const result = await listConversations()
    expect(result.map(r => r.sessionId)).toEqual(['theirs'])
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

Agregar a `conversationIndex.ts`:

```ts
import { db } from '../../db/db'
import { isRowInActiveScope } from '../athlete/activeScopeFilter'

/**
 * ÚNICA lectura de Dexie de este módulo, compartida por listar y buscar, para
 * que la búsqueda no pueda divergir del scope del listado.
 *
 * Complejidad real: no existe índice `[athleteId+timestamp]` (`db.ts:201`), así
 * que mantener orden temporal obliga a recorrer TODOS los mensajes de la cuenta,
 * no solo los del atleta activo. Es O(mensajes totales) en tiempo y O(1) en
 * memoria por conversación gracias a `each()`. Para el volumen actual alcanza;
 * si deja de alcanzar, se mide antes de agregar un índice.
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

- [ ] **Step 5: Commit**

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
- Produces: `type ConversationSearchResult = ConversationSummary & { snippet: string; matchCount: number; matchedMessageId: string | null }` y `searchConversations(query: string): Promise<ConversationSearchResult[]>`.

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
      msg({ id: 'b', timestamp: 200, athleteId: 'ath_self', chatSessionId: 's1', role: 'assistant', content: 'Cuidemos ese hombro' }),
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

Run: `npx vitest run src/services/chat/__tests__/conversationIndexDexie.test.ts && npm run lint`
Expected: PASS, 7 tests en el archivo; lint sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/services/chat/conversationIndex.ts src/services/chat/__tests__/conversationIndexDexie.test.ts
git commit -m "feat(chat): search conversations by content"
```

---

## Task 6: `loadSession()` con propiedad de token y `persistId`

**Files:**
- Modify: `src/store/useChatStore.ts:47-92` (reemplaza el cuerpo de `loadHistory`)
- Test: `src/store/__tests__/chatConversations.test.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: privado `loadSession(sessionId: string, options: { requestId: number; persistId: boolean; suspendRotation: boolean }): Promise<boolean>`; estado nuevo `rotationSuspended: boolean`.

**Contexto obligatorio antes de empezar:** leer `src/store/__tests__/useChatStore.test.ts:1-60`. Ese archivo mockea `../../db/db` con `vi.hoisted`; **este test nuevo copia ese patrón de mock**, no usa Dexie real.

- [ ] **Step 1: Write the failing test**

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
    chatMessages: {
      where: () => ({ equals: (id: string) => ({
        toArray: async () => mocks.chatMessages.filter(m => m.chatSessionId === id),
        sortBy: async () => mocks.chatMessages
          .filter(m => m.chatSessionId === id)
          .sort((a, b) => a.timestamp - b.timestamp),
      }) }),
      orderBy: () => ({
        reverse: () => ({
          filter: (predicate: (m: ChatMessage) => boolean) => ({
            first: async () => [...mocks.chatMessages]
              .sort((a, b) => b.timestamp - a.timestamp)
              .find(predicate),
          }),
        }),
      }),
      add: vi.fn(async (m: ChatMessage) => { mocks.chatMessages.push(m) }),
      bulkDelete: vi.fn(async () => {}),
    },
    coachProposals: {
      where: () => ({ anyOf: () => ({ toArray: async () => [] }) }),
      orderBy: () => ({ toArray: async () => [] }),
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

describe('loadHistory does not persist the session id', () => {
  beforeEach(() => {
    mocks.chatMessages.length = 0
    mocks.setStoredCalls.length = 0
    mocks.storedSessionId = 'current-session'
    mocks.localOnly = true
    useChatStore.setState({ messages: [], currentSessionId: 'current-session', rotationSuspended: false })
  })

  it('keeps the local-only marker alive so adoption still works', async () => {
    await useChatStore.getState().loadHistory()
    expect(mocks.setStoredCalls).toEqual([])
  })

  it('adopts a same-day thread when the current session is empty and local-only', async () => {
    const today = Date.now()
    mocks.chatMessages.push({
      id: 'a', role: 'user', content: 'hola', timestamp: today, chatSessionId: 'older-thread',
    } as ChatMessage)

    await useChatStore.getState().loadHistory()

    expect(useChatStore.getState().currentSessionId).toBe('older-thread')
    expect(mocks.setStoredCalls).toEqual(['older-thread'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/__tests__/chatConversations.test.ts`
Expected: FAIL — hoy `loadHistory` no llama `setStoredChatSessionId` en el arranque, pero el estado `rotationSuspended` no existe y `setState` con esa clave hace fallar el tipo. Confirmar que falla por eso antes de seguir.

- [ ] **Step 3: Write minimal implementation**

En `useChatStore.ts`, agregar `rotationSuspended: false` al estado inicial y reemplazar `loadHistory` por:

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
  },
```

y agregar, fuera del `create()`, el helper compartido:

```ts
async function loadSession(
  sessionId: string,
  options: { requestId: number; persistId: boolean; suspendRotation: boolean },
): Promise<boolean> {
  const { requestId, persistId, suspendRotation } = options
  const set = useChatStore.setState
  // `useChatStore` se evalúa recién al llamar esta función, así que la
  // referencia adelantada es segura: `loadSession` es una declaración hoisted y
  // solo se invoca después de que el store existe.

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

> `chatStoreApi` es la referencia al store creada con
> `export const useChatStore = create<ChatState>(...)`; usar
> `useChatStore.setState` / `useChatStore.getState` dentro del helper.

Y en el bloque de adopción local-only, condicionar por día y exigir sesión no vacía:

```ts
    if (get().messages.length === 0 && isLocalOnlyChatSessionId(resolvedSessionId)) {
      // Se busca el mensaje in-scope más reciente CON chatSessionId: una fila
      // huérfana sin sesión no debe bloquear un hilo válido anterior.
      const latest = await db.chatMessages
        .orderBy('timestamp')
        .reverse()
        .filter((message) => isRowInActiveScope(message.athleteId) && Boolean(message.chatSessionId))
        .first()
      if (requestId !== latestHistoryLoadRequestId) return
      // Solo se adopta un hilo del MISMO día; si es de ayer, la rotación manda.
      if (latest?.chatSessionId && !shouldRotateConversation(latest.timestamp, Date.now())) {
        await loadSession(latest.chatSessionId, {
          requestId, persistId: true, suspendRotation: false,
        })
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/__tests__/chatConversations.test.ts src/store/__tests__/useChatStore.test.ts`
Expected: PASS los nuevos **y** los existentes de `useChatStore.test.ts` sin cambios.

- [ ] **Step 5: Commit**

```bash
git add src/store/useChatStore.ts src/store/__tests__/chatConversations.test.ts
git commit -m "refactor(chat): single hydration path with request ownership"
```

---

## Task 7: `openConversation()` con validación y token

**Files:**
- Modify: `src/store/useChatStore.ts`
- Test: `src/store/__tests__/chatConversations.test.ts` (agregar bloque)

**Interfaces:**
- Consumes: `loadSession` de Task 6.
- Produces: `openConversation(sessionId: string): Promise<void>` en el store.

- [ ] **Step 1: Write the failing test**

```ts
describe('openConversation', () => {
  beforeEach(() => {
    mocks.chatMessages.length = 0
    mocks.setStoredCalls.length = 0
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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/__tests__/chatConversations.test.ts`
Expected: FAIL — `openConversation is not a function`.

- [ ] **Step 3: Write minimal implementation**

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/__tests__/chatConversations.test.ts`
Expected: PASS.

- [ ] **Step 5: Extraer la reparación de propuestas a su propio módulo**

Para poder bloquear la reparación desde un test hace falta que sea mockeable. Hoy
`repairOrphanProposalMessages` es una función de módulo **no exportada**
(`useChatStore.ts:478`). Moverla es un cambio puro, sin cambio de comportamiento:

1. Crear `src/services/chat/orphanProposalRepair.ts` y mover ahí
   `repairOrphanProposalMessages`, `repairOrphanProposalMessagesUnlocked`,
   `orphanProposalRepairLocks`, `buildProposalRecoveredMessage` y
   `buildCoachErrorMessage` si comparte helpers.
2. Exportar `repairOrphanProposalMessages(chatSessionId, messages)`.
3. Importarla en `useChatStore.ts` y borrar las definiciones movidas.
4. Correr `npm test` y confirmar que la suite queda igual que antes del movimiento.

```bash
git add src/services/chat/orphanProposalRepair.ts src/store/useChatStore.ts
git commit -m "refactor(chat): extract orphan proposal repair into its own module"
```

- [ ] **Step 6: Write the stalled-repair race test**

```ts
vi.mock('../../services/chat/orphanProposalRepair', () => ({
  repairOrphanProposalMessages: vi.fn(async (_sessionId: string, messages: ChatMessage[]) => {
    const gate = mocks.repairGates.shift()
    if (gate) await gate
    return messages
  }),
}))

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
```

Agregar `repairGates: [] as Promise<void>[]` al objeto `mocks` de `vi.hoisted`, y
`mocks.repairGates = []` en el `beforeEach`.

- [ ] **Step 7: Run tests and commit**

Run: `npx vitest run src/store/__tests__/chatConversations.test.ts && npm run lint`
Expected: PASS, incluido el test de reparación bloqueada.

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
- Produces: estado `conversations: ConversationSummary[]`, `conversationsStatus: 'idle' | 'loading' | 'ready' | 'error'`, `conversationsDirty: boolean`; acción `loadConversations(): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
vi.mock('../../services/chat/conversationIndex', () => ({
  listConversations: vi.fn(async () => mocks.conversations),
  searchConversations: vi.fn(async () => mocks.conversations.map(c => ({
    ...c, snippet: '', matchCount: 0, matchedMessageId: null,
  }))),
}))

describe('loadConversations', () => {
  beforeEach(() => {
    mocks.conversations = [{
      sessionId: 's1', title: 'Hombro', lastMessageAt: 200, firstMessageAt: 100, messageCount: 3,
    }]
    useChatStore.setState({
      conversations: [], conversationsStatus: 'idle', conversationsDirty: true,
    })
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

    useChatStore.setState({ conversationsDirty: true })
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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/__tests__/chatConversations.test.ts`
Expected: FAIL — `loadConversations is not a function`.

- [ ] **Step 3: Write minimal implementation**

Agregar al módulo un token propio, independiente del historial:

```ts
let latestConversationsLoadRequestId = 0
```

y al store:

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

y extender `resetForAthleteSwitch`:

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
Expected: PASS.

- [ ] **Step 5: Commit**

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
- Consumes: `newSession` existente.
- Produces: `deleteConversation(sessionId: string): Promise<void>`; `deleteCurrentSession()` pasa a ser wrapper.

- [ ] **Step 1: Write the failing test**

```ts
describe('deleteConversation', () => {
  beforeEach(() => {
    mocks.chatMessages.length = 0
    mocks.chatMessages.push(
      { id: 'cur', role: 'user', content: 'hoy', timestamp: 900, chatSessionId: 'current-session' } as ChatMessage,
      { id: 'old', role: 'user', content: 'ayer', timestamp: 100, chatSessionId: 'old-thread' } as ChatMessage,
    )
    useChatStore.setState({ currentSessionId: 'current-session', messages: [], conversationsDirty: false })
  })

  it('deletes a historical conversation without touching the current one', async () => {
    await useChatStore.getState().deleteConversation('old-thread')
    expect(useChatStore.getState().currentSessionId).toBe('current-session')
    expect(useChatStore.getState().conversationsDirty).toBe(true)
  })

  it('starts a new session only when the current conversation is deleted', async () => {
    await useChatStore.getState().deleteConversation('current-session')
    expect(useChatStore.getState().currentSessionId).not.toBe('current-session')
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

Renombrar el cuerpo existente y parametrizarlo. **Se conserva la derivación de ids in-scope y el borrado por ids** — esa es la propiedad importante, no el borrado por `chatSessionId`:

```ts
  deleteConversation: async (sessionId: string) => {
    const isCurrent = sessionId === get().currentSessionId
    if (isCurrent) {
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

    set({ conversationsDirty: true })
    if (isCurrent) await get().newSession()
    await get().loadConversations()
  },

  deleteCurrentSession: async () => {
    await get().deleteConversation(get().currentSessionId)
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/__tests__/chatConversations.test.ts src/store/__tests__/useChatStore.test.ts`
Expected: PASS, incluidos los tests existentes de borrado.

- [ ] **Step 5: Commit**

```bash
git add src/store/useChatStore.ts src/store/__tests__/chatConversations.test.ts
git commit -m "feat(chat): generalise deletion to any conversation"
```

---

## Task 10: Rotación en los dos puntos de integración

**Files:**
- Modify: `src/store/useChatStore.ts` (`newSession` en `:309`, arranque de `sendMessage` en `:94-107`)
- Test: `src/store/__tests__/chatConversations.test.ts` (agregar bloque)

**Interfaces:**
- Consumes: `shouldRotateConversation` de Task 1.
- Produces: privado `startFreshSessionSync(): string` (**síncrono**); `newSession()` pasa a ser wrapper y conserva su firma `Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
describe('daily rotation on send', () => {
  beforeEach(() => {
    mocks.chatMessages.length = 0
    mocks.setStoredCalls.length = 0
    useChatStore.setState({
      currentSessionId: 'yesterday-session', rotationSuspended: false, isLoading: false,
    })
  })

  it('rotates before building the provider history when the thread is from yesterday', async () => {
    const yesterday = new Date(2026, 6, 25, 20, 0).getTime()
    vi.setSystemTime(new Date(2026, 6, 26, 8, 0))
    useChatStore.setState({
      messages: [{
        id: 'old', role: 'user', content: 'lo de ayer', timestamp: yesterday,
        chatSessionId: 'yesterday-session',
      } as ChatMessage],
    })

    await useChatStore.getState().sendMessage('hoy quiero entrenar')

    const state = useChatStore.getState()
    expect(state.currentSessionId).not.toBe('yesterday-session')
    // El mensaje de ayer NO puede estar en el hilo nuevo.
    expect(state.messages.some(m => m.id === 'old')).toBe(false)
  })

  it('does not rotate when the user explicitly opened an old conversation', async () => {
    const yesterday = new Date(2026, 6, 25, 20, 0).getTime()
    vi.setSystemTime(new Date(2026, 6, 26, 8, 0))
    useChatStore.setState({
      rotationSuspended: true,
      messages: [{
        id: 'old', role: 'user', content: 'lo de ayer', timestamp: yesterday,
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
      messages: [{
        id: 'old', role: 'user', content: 'x', timestamp: new Date(2026, 6, 25).getTime(),
        chatSessionId: 'yesterday-session',
      } as ChatMessage],
    })

    await useChatStore.getState().sendMessage('nuevo')

    expect(useChatStore.getState().currentSessionId).toBe('yesterday-session')
  })

  it('produces one rotation and one request for two sends in the same tick', async () => {
    const yesterday = new Date(2026, 6, 25, 20, 0).getTime()
    vi.setSystemTime(new Date(2026, 6, 26, 8, 0))
    useChatStore.setState({
      isLoading: false,
      currentSessionId: 'yesterday-session',
      messages: [{
        id: 'old', role: 'user', content: 'lo de ayer', timestamp: yesterday,
        chatSessionId: 'yesterday-session',
      } as ChatMessage],
    })

    // Sin await entre los dos: si la rotación cediera el turno antes del lock de
    // isLoading, las dos llamadas rotarían y las dos mandarían request.
    const first = useChatStore.getState().sendMessage('uno')
    const second = useChatStore.getState().sendMessage('dos')
    await Promise.all([first, second])

    // Una sola sesión nueva: dos rotaciones dejarían dos ids distintos y un
    // solo id persistido en la última.
    expect(mocks.setStoredCalls).toHaveLength(1)
    // Y un solo request al proveedor.
    expect(mocks.send.mock.calls.length + mocks.sendAction.mock.calls.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/__tests__/chatConversations.test.ts`
Expected: FAIL — hoy `sendMessage` no rota; el primer test encuentra el mensaje de ayer en el hilo.

- [ ] **Step 3: Write minimal implementation**

Extraer el cambio de sesión **síncrono** y usarlo en los dos lados:

```ts
/**
 * Cambio de sesión SÍNCRONO. `newSession()` es async, y hacer
 * `await get().newSession()` dentro de sendMessage cedería el turno ANTES del
 * lock de isLoading, abriendo una ventana para dos envíos o dos rotaciones
 * simultáneas. Entre el guard de isLoading y el set({ isLoading: true }) no
 * puede existir ningún await.
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

`newSession` pasa a delegar:

```ts
  newSession: async () => {
    startFreshSessionSync()
  },
```

Y **la primera línea** de `sendMessage`, antes de `routeRecentMessages`:

```ts
  sendMessage: async (content, context) => {
    // Rotación diaria: PRIMERO de todo. Hay DOS derivaciones de historial
    // —routeRecentMessages (ruteo/contexto) y recentMessages (proveedor)— y las
    // dos salen de get().messages, así que rotar acá cubre ambas. Rotar después
    // mandaría el hilo de ayer al proveedor con un sessionId nuevo.
    if (!get().isLoading && !get().rotationSuspended) {
      const messages = get().messages
      const lastAt = messages.length > 0 ? messages[messages.length - 1].timestamp : null
      if (shouldRotateConversation(lastAt, Date.now())) startFreshSessionSync()
    }
    const requestStartedAt = Date.now()
    const routeRecentMessages = get().messages.map(m => ({ role: m.role, content: m.content }))
    // ...resto sin cambios
```

Y en `loadHistory`, después de hidratar, aplicar la misma regla:

```ts
    const messages = get().messages
    const lastAt = messages.length > 0 ? messages[messages.length - 1].timestamp : null
    if (shouldRotateConversation(lastAt, Date.now())) startFreshSessionSync()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/__tests__/chatConversations.test.ts src/store/__tests__/useChatStore.test.ts && npm run lint`
Expected: PASS. Si algún test existente de `useChatStore.test.ts` rompe por la rotación, revisar que use un `timestamp` de hoy; **no** debilitar la rotación para que pasen.

- [ ] **Step 5: Commit**

```bash
git add src/store/useChatStore.ts src/store/__tests__/chatConversations.test.ts
git commit -m "feat(chat): rotate conversations by calendar day"
```

---

## Task 11: `ConversationDrawer`

**Files:**
- Create: `src/components/chat/ConversationDrawer.tsx`
- Test: `src/components/chat/__tests__/ConversationDrawer.test.tsx`

**Interfaces:**
- Consumes: `ConversationSummary`, `ConversationSearchResult`, `searchConversations`; store: `conversations`, `conversationsStatus`, `loadConversations`, `openConversation`, `deleteConversation`, `currentSessionId`.
- Produces: `ConversationDrawer` con props
  `{ isOpen: boolean; onClose: () => void; onSelect: (sessionId: string, matchedMessageId: string | null) => void }`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConversationDrawer from '../ConversationDrawer'

const conversations = [
  { sessionId: 's1', title: 'Molestia en el hombro', lastMessageAt: Date.now(), firstMessageAt: Date.now() - 1000, messageCount: 8 },
  { sessionId: 's2', title: 'Semana de torneo', lastMessageAt: Date.now() - 86_400_000, firstMessageAt: Date.now() - 90_000_000, messageCount: 12 },
]

vi.mock('../../../store/useChatStore', () => ({
  useChatStore: (selector: (s: unknown) => unknown) => selector({
    conversations,
    conversationsStatus: 'ready',
    conversationsDirty: false,
    currentSessionId: 's1',
    loadConversations: vi.fn(),
    openConversation: vi.fn(),
    deleteConversation: vi.fn(),
  }),
}))

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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/chat/__tests__/ConversationDrawer.test.tsx`
Expected: FAIL — no existe `../ConversationDrawer`.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { isSameDay, isYesterday, format } from 'date-fns'
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

  // Recarga solo si hace falta: abrir y cerrar sin escribir nada no dispara
  // dos escaneos.
  useEffect(() => {
    if (!isOpen) return
    if (conversationsStatus === 'ready' && !conversationsDirty) return
    void loadConversations()
  }, [isOpen, conversationsStatus, conversationsDirty, loadConversations])

  useEffect(() => {
    if (!isOpen) {
      setResults(null)
      setPendingDelete(null)
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
      void searchConversations(trimmed).then((found) => {
        if (cancelled || token !== searchToken.current) return
        setResults(found)
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

Requisitos que el código de arriba ya cumple y que **no** deben perderse en un
refactor posterior: query vacía sin escaneo de Dexie, debounce de 250 ms, token
monotónico, `cancelled` para no escribir estado tras cerrar, recarga condicional
por `dirty`, agrupación por día, marca de la conversación actual, borrado en dos
toques y estados `loading` / `error` / vacío explícitos.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/chat/__tests__/ConversationDrawer.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the stale-search tests**

Agregar al tope del archivo de test:

```tsx
const searchDeferrals: ((value: ConversationSearchResult[]) => void)[] = []

vi.mock('../../../services/chat/conversationIndex', () => ({
  searchConversations: vi.fn(() => new Promise<ConversationSearchResult[]>((resolve) => {
    searchDeferrals.push(resolve)
  })),
  listConversations: vi.fn(async () => []),
}))
```

y los dos tests:

```tsx
it('discards a stale search result that resolves late', async () => {
  vi.useFakeTimers()
  render(<ConversationDrawer isOpen onClose={() => {}} onSelect={() => {}} />)

  await userEvent.type(screen.getByPlaceholderText(/buscar/i), 'hom')
  await vi.advanceTimersByTimeAsync(300)
  await userEvent.type(screen.getByPlaceholderText(/buscar/i), 'bro')
  await vi.advanceTimersByTimeAsync(300)

  expect(searchDeferrals).toHaveLength(2)

  // La SEGUNDA resuelve primero, la primera llega tarde con datos viejos.
  const fresh: ConversationSearchResult[] = [{
    ...conversations[0], title: 'Resultado nuevo', snippet: 'bro', matchCount: 1, matchedMessageId: 'm2',
  }]
  const stale: ConversationSearchResult[] = [{
    ...conversations[1], title: 'Resultado viejo', snippet: 'hom', matchCount: 1, matchedMessageId: 'm1',
  }]

  searchDeferrals[1](fresh)
  await vi.advanceTimersByTimeAsync(0)
  searchDeferrals[0](stale)
  await vi.advanceTimersByTimeAsync(0)

  expect(screen.getByText('Resultado nuevo')).toBeTruthy()
  expect(screen.queryByText('Resultado viejo')).toBeNull()
  vi.useRealTimers()
})

it('does not write state when the drawer closes with a search in flight', async () => {
  vi.useFakeTimers()
  const { rerender } = render(<ConversationDrawer isOpen onClose={() => {}} onSelect={() => {}} />)
  await userEvent.type(screen.getByPlaceholderText(/buscar/i), 'hombro')
  await vi.advanceTimersByTimeAsync(300)

  rerender(<ConversationDrawer isOpen={false} onClose={() => {}} onSelect={() => {}} />)

  // Resolver después de cerrar no debe tirar warning de update en desmontado ni
  // dejar resultados pegados al reabrir.
  searchDeferrals[0]?.([{
    ...conversations[0], title: 'Tarde', snippet: 'x', matchCount: 1, matchedMessageId: 'm1',
  }])
  await vi.advanceTimersByTimeAsync(0)

  rerender(<ConversationDrawer isOpen onClose={() => {}} onSelect={() => {}} />)
  expect(screen.queryByText('Tarde')).toBeNull()
  vi.useRealTimers()
})
```

Lo esencial de estos dos tests: que `searchDeferrals[1]` resuelva **antes** que
`searchDeferrals[0]` y que el DOM muestre el resultado del token más nuevo; y que
resolver con el drawer cerrado no deje resultados pegados al reabrir.

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run src/components/chat/__tests__/ConversationDrawer.test.tsx && npm run lint`

```bash
git add src/components/chat/ConversationDrawer.tsx src/components/chat/__tests__/ConversationDrawer.test.tsx
git commit -m "feat(chat): add the conversation drawer"
```

---

## Task 12: Cablear el drawer y el scroll al match en `ChatCoach`

**Files:**
- Modify: `src/pages/ChatCoach.tsx` (header en `:345-419`, efecto de scroll en `:154-156`)
- Test: `src/pages/__tests__/chatCoachConversations.test.tsx` (crear)

**Interfaces:**
- Consumes: `ConversationDrawer` de Task 11; `openConversation` del store.
- Produces: nada para tareas posteriores.

- [ ] **Step 1: Write the failing test**

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// El scroll se observa sobre el prototipo: jsdom no implementa scrollIntoView.
const scrollSpy = vi.fn()

beforeEach(() => {
  scrollSpy.mockClear()
  Element.prototype.scrollIntoView = scrollSpy
})

it('opens the drawer from the header button', async () => {
  render(<ChatCoach />)
  await userEvent.click(screen.getByRole('button', { name: /conversaciones/i }))
  expect(await screen.findByPlaceholderText(/buscar/i)).toBeTruthy()
})

it('scrolls to the matched message instead of the bottom', async () => {
  render(<ChatCoach />)

  // El drawer llama onSelect con el id del match; se simula seleccionando la
  // conversación mockeada cuyo matchedMessageId es 'msg-2'.
  await userEvent.click(screen.getByRole('button', { name: /conversaciones/i }))
  await userEvent.click(await screen.findByText('Molestia en el hombro'))

  const target = document.querySelector('[data-message-id="msg-2"]')
  expect(target).toBeTruthy()
  // El último scroll debe haber ocurrido sobre el mensaje del match, centrado,
  // y no sobre el ancla del final.
  expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
})
```

> El segundo test depende de que el store y el drawer estén mockeados en este
> archivo para devolver una conversación con `matchedMessageId: 'msg-2'` y
> mensajes que incluyan `msg-2`. Copiá el patrón de mock de
> `src/components/chat/__tests__/ConversationDrawer.test.tsx` (Task 11).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/__tests__/chatCoachConversations.test.tsx`
Expected: FAIL — no existe el botón de conversaciones.

- [ ] **Step 3: Write minimal implementation**

1. Importar el drawer con `lazy()` junto a los otros (`ChatCoach.tsx:26-27`):

```tsx
const ConversationDrawer = lazy(() => import('../components/chat/ConversationDrawer'))
```

2. Estado nuevo:

```tsx
const [drawerOpen, setDrawerOpen] = useState(false)
const [scrollTargetId, setScrollTargetId] = useState<string | null>(null)
```

3. Botón de hamburguesa **a la izquierda del título**, dentro del `div` de
   `ChatCoach.tsx:347`:

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

   (agregar `Menu` al import de `lucide-react`).

4. Montaje del drawer, al lado del `ProposalDrawer` de `:596`:

```tsx
<Suspense fallback={null}>
  <ConversationDrawer
    isOpen={drawerOpen}
    onClose={() => setDrawerOpen(false)}
    onSelect={(sessionId, matchedMessageId) => {
      void openConversation(sessionId)
      setScrollTargetId(matchedMessageId)
      setDrawerOpen(false)
    }}
  />
</Suspense>
```

   y traer `openConversation` del store en el destructuring de `:96`.

5. **El target gana sobre el scroll al final.** Modificar el efecto de `:154-156`:

```tsx
  useEffect(() => {
    if (scrollTargetId) return   // el scroll al match manda
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, isLoading, scrollTargetId])

  useEffect(() => {
    if (!scrollTargetId) return
    const node = document.querySelector(`[data-message-id="${scrollTargetId}"]`)
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setScrollTargetId(null)   // se limpia después de usarse
  }, [scrollTargetId, messages.length])
```

6. Agregar `data-message-id={message.id}` al contenedor de cada burbuja en el map de mensajes (cerca de `:489`).

- [ ] **Step 4: Run the full suite**

Run: `npm run lint && npm test && npm run build`
Expected: lint sin errores; suite verde; build sin errores de tipos.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ChatCoach.tsx src/pages/__tests__/chatCoachConversations.test.tsx
git commit -m "feat(chat): wire the conversation drawer and scroll to search matches"
```

---

## Task 13: Cierre — documentación de estado

**Files:**
- Modify: `PROJECT_REVIEW_AND_ROADMAP.md` (entrada 1 del backlog), `CLAUDE.md` (bloques recientes)

- [ ] **Step 1: Actualizar el backlog**

Marcar la entrada 1 como implementada, con la fecha y el hecho de que no hubo migraciones. Mover el foco del backlog a la entrada 2 (Plan Builder velocidad).

- [ ] **Step 2: Agregar el bloque a `CLAUDE.md`**

Una entrada en "Bloques recientes relevantes" con: índice derivado sin migraciones, rotación por día calendario, drawer con búsqueda y scroll al match, y la nota de complejidad (escaneo global por falta de índice `[athleteId+timestamp]`).

- [ ] **Step 3: Verificación final**

Run: `npm run lint && npm test && npm run build`
Expected: los tres verdes.

- [ ] **Step 4: Commit**

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
| §3.7 regla de rotación (función pura) | 1 |
| §3.7 rotación en dos puntos + adopción | 6, 10 |
| §3.8 continuidad explícita (`rotationSuspended`) | 7, 10 |
| §3.9 drawer y frescura | 11, 12 |
| §4 criterios de salida | 12 (suite completa), 13 |
| §7 testing | todas |
