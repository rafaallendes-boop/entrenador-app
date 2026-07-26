# Spec — Conversaciones del chat: listar, retomar, buscar y rotar por día

**Fecha:** 2026-07-26
**Estado:** aprobado en brainstorming, listo para plan de implementación
**Migraciones:** ninguna (ni Dexie ni Supabase). Backup sin cambio de versión.

## 1. Por qué existe

El botón "Nuevo" del chat ya existe (`ChatCoach.tsx:357-369` y el ítem del menú
`:393-403`), y `newSession()` ya crea un `chatSessionId` nuevo
(`useChatStore.ts:309-315`). Los mensajes del hilo anterior quedan en Dexie, con
su `chatSessionId`, y **siguen sincronizando** a `chat_messages`.

Lo que no existe es la puerta de vuelta. Cada "Nuevo" deja la conversación
anterior inalcanzable: el dato está, pero no hay superficie que lo enumere. La
app viene creando conversaciones desde siempre y perdiéndolas de vista en el
mismo acto.

Este spec no crea el concepto de conversación — **ya existe en los datos**. Crea
la forma de verlas, retomarlas, buscarlas y borrarlas, más una regla de rotación
diaria que hace que el corte entre conversaciones sea natural en vez de manual.

## 2. Evidencia verificada

Todo lo de abajo fue confirmado en el código, no asumido.

| Hecho | Dónde |
|---|---|
| `chatMessages` indexa `chatSessionId` (desde Dexie v5) y `athleteId` (v13), **sin índice compuesto** | `db.ts:201` |
| `chatSessionId` es **opcional** en el tipo | `types/index.ts:809` |
| `athleteId` es opcional y las filas legacy pertenecen solo al self | `types/index.ts:805`, `activeScopeFilter.ts` |
| Los mensajes ya sincronizan con su `chatSessionId` | `syncService.ts:2953`, `:3535-3555` |
| Los mensajes ya entran al backup/export | `dataExport.ts:202`, `:413` |
| La sesión activa se guarda en localStorage, athlete-scoped por sufijo de key | `utils/chatSession.ts:10-22` |
| El borrado actual deriva ids in-scope y borra por ids, nunca por `chatSessionId` | `useChatStore.ts:317-350` |
| El borrado actual ya limpia propuestas vinculadas por `chatMessageId` | `useChatStore.ts:332-344` |
| `resetForAthleteSwitch()` hoy solo invalida el historial | `useChatStore.ts:352-357` |
| La adopción "local-only" adopta el hilo más reciente sin condición temporal | `useChatStore.ts:67-87` |
| `routeRecentMessages` se arma antes de resolver la ruta y alimenta el contexto del proveedor | `useChatStore.ts:96-99` |
| El guard de `isLoading` está después de resolver la ruta, y el early-return de `plan_builder_redirect` depende de eso | `useChatStore.ts:100-107` |

**Consecuencia de complejidad, explícita:** como no hay índice
`[athleteId+timestamp]`, cualquier recorrido que mantenga orden temporal escanea
**todos los mensajes de la cuenta**, no solo los del atleta activo. La derivación
es O(mensajes totales) en tiempo. Para el volumen actual escanear está bien; se
documenta y **no** se agrega migración Dexie en este incremento.

## 3. Qué se construye

### 3.1 `src/services/chat/conversationIndex.ts`

Única fuente de lectura del índice de conversaciones.

```ts
interface ConversationSummary {
  sessionId: string
  title: string
  lastMessageAt: number
  firstMessageAt: number
  messageCount: number
}

type ConversationSearchResult = ConversationSummary & {
  snippet: string
  matchCount: number
  matchedMessageId: string | null
}

listConversations(): Promise<ConversationSummary[]>
searchConversations(query: string): Promise<ConversationSearchResult[]>
```

Internamente:

```ts
// Acumulador puro, compartido por el camino streaming y el camino de array.
accumulateConversation(map: Map<string, ConversationAccumulator>, message: ChatMessage): void

// Solo para tests y consumidores en memoria.
buildConversationSummaries(messages: ChatMessage[]): ConversationSummary[]

// Privado: única lectura de Dexie, compartida por listar y buscar.
visitScopedChatMessages(visit: (message: ChatMessage) => void): Promise<void>
```

`listConversations()` recorre con `each()` y acumula: memoria O(conversaciones).
`buildConversationSummaries()` existe para poder testear el agrupamiento sin base
de datos y **usa el mismo acumulador**, para que no haya dos derivaciones que
puedan divergir.

`visitScopedChatMessages()` es la única lectura de Dexie de este módulo, de modo
que la búsqueda no pueda divergir del scope del listado.

### 3.2 Scope: la regla dura

`chatSessionId` **no es una frontera de seguridad**. La forma obvia de agrupar
—`orderBy('chatSessionId').uniqueKeys()`— está **prohibida**: devuelve ids de
sesión de todos los atletas y el índice no sabe filtrar por atleta.

`visitScopedChatMessages()` recorre filas reales aplicando `isRowInActiveScope` y
agrupa después. Las filas legacy sin `athleteId` pertenecen **solo al self**: un
atleta gestionado nunca ve ni adopta sus conversaciones.

### 3.3 Invariantes del índice

- Mensajes **sin `chatSessionId` se ignoran**. No se inventa una sesión.
- Título derivado del **primer mensaje de usuario significativo**, con la cadena de
  fallback de §3.3.1.
- Espacios internos colapsados, truncado a **80 caracteres en límite de palabra**.
- Si la primera "palabra" supera 80 caracteres (una URL, por ejemplo), **corte
  duro a 80** aunque no haya límite de palabra.
- Sin ningún mensaje de usuario → fallback a la fecha del **primer** mensaje de la
  conversación (`firstMessageAt`), no del último: `"Conversación del 22 jul"`.
- Orden descendente por `lastMessageAt`, con **desempate estable por `sessionId`**.
- Correcto ante entrada desordenada. Ninguna precondición invisible sobre el
  orden de los mensajes.
- Las conversaciones vacías no existen en el índice, porque no tienen mensajes.
  No hace falta lógica de limpieza.

#### 3.3.1 Título: primer mensaje significativo

Derivación pura y determinista, sin llamadas al proveedor. Recorriendo los
mensajes de usuario en orden cronológico:

1. Se **ignoran los saludos aislados** (el mensaje entero es un saludo: "hola",
   "buenas", "buenos días", "qué tal", con o sin tildes y signos).
2. Si un mensaje **empieza** con un saludo pero queda texto significativo detrás,
   se le **quita el saludo**: `"Hola, quiero ajustar la semana…"` →
   `"Quiero ajustar la semana…"`, con la primera letra en mayúscula.
3. Si **todos** los mensajes de usuario son saludos aislados, se usa el primer
   mensaje de usuario **original** — sin recorte de saludo; el truncado a 80
   caracteres sigue aplicando igual. Mejor un título que diga "Hola" que una
   conversación sin nombre.
4. Si no hay ningún mensaje de usuario, fallback por fecha (§3.3).

La lista de saludos es explícita y acotada en el módulo, no una heurística
abierta: se prefiere un título crudo a un recorte equivocado.

### 3.4 Contrato de búsqueda

- Sobre el **contenido completo** de los mensajes, no solo el título.
- Insensible a mayúsculas **y a diacríticos** (`normalize('NFD')` + strip de
  marcas combinantes): "molestia" encuentra "molestía", "rodilla" encuentra
  "rodílla".
- **Un resultado por conversación**, con `snippet` del primer match,
  `matchedMessageId` de ese mismo mensaje y `matchCount` total de mensajes que
  matchean en esa conversación.
- Query vacía o solo espacios → mismos resultados que `listConversations()`, con
  `{ snippet: '', matchCount: 0, matchedMessageId: null }`. **No** se hacen
  opcionales esos campos: un tipo con huecos invita a estados ambiguos.
- Orden por **recencia**, sin modelo de relevancia. Un score inventado acá sería
  adivinar; la recencia es predecible.

#### 3.4.1 Concurrencia de la búsqueda

Cada tecla podría lanzar un escaneo global; sin protección, un escaneo viejo puede
terminar después del nuevo y pisar sus resultados.

- **Query vacía no escanea Dexie**: usa `conversations` en memoria.
- Query no vacía con **debounce de ~250 ms**.
- **Token monotónico local del drawer**: los resultados de un token viejo se
  descartan en silencio.
- Al cerrar o desmontar el drawer, las respuestas pendientes **no** actualizan
  estado.

#### 3.4.2 Transiciones del índice

- Éxito → `conversationsStatus = 'ready'` y `conversationsDirty = false`.
- Error → `conversationsStatus = 'error'`, **se conserva la última lista válida**
  (no se vacía la vista) y `conversationsDirty` **queda en `true`**, para que el
  próximo intento reintente en serio.

### 3.5 Store (`useChatStore`)

Estado nuevo: `conversations: ConversationSummary[]`,
`conversationsStatus: 'idle' | 'loading' | 'ready' | 'error'`,
`conversationsDirty: boolean`, `rotationSuspended: boolean`.

Acciones nuevas: `loadConversations()`, `openConversation(sessionId)`,
`deleteConversation(sessionId)`.

**Un solo camino de hidratación.**
`loadSession(sessionId, { requestId, persistId, suspendRotation })` privado, usado
por `loadHistory()` y por `openConversation()`. Secuencia exacta:

1. **Recibir `requestId`. No incrementarlo** — el dueño del token es quien llama.
2. Abortar y liberar el request activo.
3. Leer los mensajes de ese id, **scope-filtrados**.
4. **Comprobar el token.** Si ya no está vigente, salir sin escribir nada.
5. Reparar propuestas huérfanas (`repairOrphanProposalMessages`).
6. **Comprobar el token otra vez.**
7. **Un único commit síncrono final**, sin `await` de por medio:
   - persistir el id con `setStoredChatSessionId()` **solo si `persistId`**;
   - cambiar `currentSessionId`;
   - instalar los mensajes ya reparados;
   - limpiar `streamingText`, `responsePhase`, `error`;
   - activar `rotationSuspended` **solo si `suspendRotation`** (apertura explícita).

Si la lectura o la reparación fallan, **no se persiste el id ni se cambia la
conversación visible**: la actual queda intacta.

**Propiedad del request: el token se adquiere primero.** Dos toques rápidos en el
drawer pueden resolverse fuera de orden y dejar ganando al primero. Por eso:

- `openConversation()` **adquiere el token al entrar, antes de validar**
  (`++latestHistoryLoadRequestId`).
- `loadSession()` **recibe** ese token; no crea uno propio.
- Después de **cada `await`** —validación, lectura, reparación de propuestas— se
  comprueba que el token siga vigente; si no, se aborta sin escribir estado.
- `setStoredChatSessionId()` y `rotationSuspended = true` se ejecutan
  **únicamente en el commit final** de una carga exitosa **y todavía vigente**.
  Nunca antes de la última comprobación del token.

**Dos precisiones que evitan romper comportamiento existente:**

- **La validación de existencia vive en `openConversation()`, no en
  `loadSession()`.** `loadHistory()` también pasa por acá y una sesión actual
  recién creada legítimamente **no tiene** mensajes; si `loadSession()` exigiera
  mensajes in-scope, el arranque normal fallaría. `openConversation(id)` valida
  primero que existan mensajes in-scope para ese id: si no, deja `error`, **no**
  suspende la rotación y no toca la sesión actual.
- **`persistId` es `false` en `loadHistory()`** y `true` en `openConversation()`.
  `setStoredChatSessionId()` borra el marcador local-only
  (`chatSession.ts:36-40`), y la adopción de `:67-87` depende de
  `isLocalOnlyChatSessionId()`. Persistir el id en el arranque normal apagaría ese
  marcador antes del chequeo y **desactivaría la adopción para siempre**. El id se
  persiste solo cuando de verdad se cambia de conversación: `openConversation()`,
  `newSession()` y la propia adopción.

`loadConversations()` lleva **su propio token** de request, independiente del
token del historial.

`resetForAthleteSwitch()` pasa a vaciar `conversations`, resetear
`conversationsStatus` a `'idle'`, invalidar la carga pendiente de conversaciones
y bajar `rotationSuspended`.

### 3.6 Borrado

`deleteCurrentSession()` se convierte en
`deleteConversation(get().currentSessionId)`. Se **generaliza** el borrado actual;
no se reescribe.

Dentro de `deleteConversation(id)`:

- Se mantiene la derivación de ids in-scope y el borrado **por ids**, nunca por
  `chatSessionId`. Esa es la propiedad importante.
- Se mantiene la limpieza de propuestas vinculadas por `chatMessageId`.
- Se aborta el request activo **solo si** `id === currentSessionId`.
- Se crea sesión nueva **solo si** se borró la actual.
- Borrar una conversación histórica desde el drawer **no toca** la conversación
  actual.
- Al terminar, se recarga el índice.

### 3.7 Rotación diaria

```ts
shouldRotateConversation(lastMessageAt: number | null, now: number): boolean
```

- Días **calendario** en la zona horaria local del dispositivo (`isSameDay` de
  date-fns), **no** una ventana de milisegundos. El proyecto ya se comió este bug
  en ventanas de Plan Builder e insights de fatiga y lo corrigió el 2026-07-19;
  una ventana de 24 h se rompe al cruzar DST y trata "ayer 23:50" como hoy.
- `shouldRotateConversation(null, now) === false`: una conversación vacía no
  necesita ser reemplazada.

**Dos puntos de integración, no uno:**

1. **En `loadHistory()`**, al entrar al chat.
2. **Al principio de `sendMessage()`**, antes de construir `routeRecentMessages`
   (`:96`), antes de `resolveChatRoute` y antes de optimizar el contexto. Si se
   hiciera después, la conversación nueva recibiría el historial de ayer aunque
   tuviera otro `sessionId` — el hilo viejo viajaría al proveedor. La app puede
   quedar abierta cruzando medianoche, así que el chequeo del mount no alcanza.
   La rotación se **omite si `isLoading` es `true`**, para no abortar un request
   en vuelo; ese caso rota en el envío siguiente.

**Hay dos derivaciones de historial, no una.** `routeRecentMessages` (`:96`)
alimenta el ruteo y el contexto de fallback, y `recentMessages` (`:138`) alimenta
al proveedor. Las dos salen de `get().messages`, así que rotar arriba de todo
cubre ambas. Quien toque esto después no debe "arreglar" solo una.

**Prohibido `await get().newSession()` dentro de `sendMessage()`.** `newSession()`
está declarado `async`: ese `await` cede el turno **antes** de que se adquiera el
lock, y abre una ventana para dos envíos o dos rotaciones simultáneas. La rotación
durante el envío usa un **helper privado síncrono** de cambio de sesión. Entre el
guard de `isLoading` (`:107`) y el `set({ isLoading: true })` (`:122`) hoy no hay
ningún `await`, y esa propiedad debe conservarse.

**El guard de `isLoading` (`:107`) no se mueve.** El early-return de
`plan_builder_redirect` depende de haber resuelto la ruta primero.

**Adopción local-only.** El camino de `:67-87` hoy adopta el hilo más reciente sin
condición temporal. Pasa a adoptarlo **solo si su último mensaje es del mismo
día**; si es de ayer, conserva la sesión nueva vacía.

La adopción busca el mensaje in-scope más reciente **con `chatSessionId` no
vacío**. Hoy toma el más reciente y recién ahí mira `latest?.chatSessionId`
(`:75`), así que una fila huérfana sin sesión bloquea la adopción de un hilo
válido anterior. Como `chatSessionId` es opcional en el tipo, ese caso es
alcanzable.

### 3.8 Continuidad explícita de conversaciones antiguas

Si abrís una conversación vieja y escribís, **la continúas**. Una selección
explícita gana sobre la regla del día; si no, el drawer se comportaría como un
historial de solo lectura y el salto de conversación al enviar sería sorpresivo.

Implementado con `rotationSuspended`:

- `openConversation()` lo pone en `true` **solo después** de validar y cargar con
  éxito una conversación in-scope. Un id inexistente o fuera de scope **no**
  suspende la rotación.
- Lo bajan: `loadHistory()` al arrancar, `newSession()`,
  `resetForAthleteSwitch()` y el borrado que crea sesión nueva.

El reset en `loadHistory()` es necesario porque el store de Zustand es un
**singleton de módulo** y sobrevive al remount de `ChatCoach`: sin ese reset, el
flag quedaría colgado y una vuelta al chat al día siguiente seguiría escribiendo
en la conversación vieja. Con él: entrar al chat de cero siempre aplica la regla
del día; una elección explícita la suspende hasta que salgas y vuelvas.

### 3.9 UI — `ConversationDrawer`

`src/components/chat/ConversationDrawer.tsx`, cargado con `lazy()` como
`ProposalDrawer`, más un botón de hamburguesa en el header de `ChatCoach`.

- Drawer lateral izquierdo sobre el chat; el chat queda detrás y se vuelve
  tocando afuera.
- Campo de búsqueda arriba.
- Lista agrupada por día (`HOY`, `AYER`, fecha), con título, hora y cantidad de
  mensajes.
- La conversación actual queda marcada.
- Borrar desde la lista, con confirmación.
- Estados vacío / cargando / error explícitos.
- Abrir un resultado de búsqueda pasa el `matchedMessageId` como target de scroll;
  el efecto de scroll al final (`ChatCoach.tsx:154-156`) debe ceder ante un target
  presente, y el target se limpia después de aplicarse.

**Frescura del índice.** La regla es explícita para que `conversationsDirty` no
quede como estado muerto:

- Al abrir el drawer se recarga **si** `conversationsStatus !== 'ready'` **o**
  `conversationsDirty` es `true`; si no, se reusa lo que ya está en memoria. Abrir
  y cerrar el drawer dos veces sin escribir nada no dispara dos escaneos.
- `conversationsDirty = true` al persistir un mensaje y al borrar.
- Después de borrar se recarga de inmediato, porque la lista está visible.

## 4. Criterios de salida

- [ ] Las conversaciones anteriores del owner —incluidas las creadas antes de este
      incremento y las venidas de otro dispositivo— aparecen en la lista sin
      ninguna migración.
- [ ] Un atleta gestionado no ve ni adopta conversaciones del self, ni las filas
      legacy sin `athleteId`.
- [ ] Abrir una conversación y escribir la continúa; salir y volver al chat al día
      siguiente arranca una nueva.
- [ ] Borrar una conversación histórica no altera la actual.
- [ ] La búsqueda encuentra por contenido sin tildes ni distinción de caso.
- [ ] `npm run lint && npm test && npm run build` verdes.

## 5. Decisiones

**5.1 Derivar en vez de materializar.** Se descartó una tabla `chatSessions`
porque introduciría una segunda fuente de verdad sobre algo que ya tiene una
sola, con migración Dexie, reconstrucción tras import/sync y riesgo de
divergencia. La única razón fuerte para tenerla —títulos editables— fue
descartada por el owner. Si el drawer se siente lento, se mide y **entonces** se
materializa; no antes.

**5.2 Con `matchedMessageId` y scroll al match.** La primera versión de este spec
lo dejaba fuera por YAGNI, apostando a que caer al final de la conversación sería
tolerable. Es incorrecto: `ChatCoach.tsx:155` hace `scrollIntoView` al final en
cada cambio de `messages.length`, así que el aterrizaje incómodo está
**garantizado**, no es una hipótesis. Mostrar un snippet y después obligar a
buscarlo a mano es una búsqueda a medias, y conservar el id durante un escaneo que
ya recorre todos los mensajes cuesta prácticamente nada.

Al abrir un resultado, el scroll al mensaje objetivo **gana** sobre el scroll al
final, y el target se limpia después de usarse. **No** se implementa navegación
entre múltiples matches todavía: `matchCount` informa, no navega.

**5.3 Recencia y no relevancia.** Sin corpus ni criterio de éxito, un score de
relevancia sería adivinar.

**5.4 Sin migración Dexie pese al escaneo global.** Se documenta la complejidad
real y se espera evidencia antes de agregar un índice compuesto.

## 6. Fuera de alcance

- Renombrar, fijar o archivar conversaciones (descartado por el owner).
- Tabla `chatSessions`, migración Supabase, bump de backup.
- Navegación entre múltiples matches dentro de una conversación (`matchCount`
  informa, no navega).
- Conversaciones en el Coach Workspace (el Asistente IA sigue siendo placeholder).
- Latencia de respuesta del chat: es el punto 6 del backlog y va **después** de
  tener medición, no antes.

## 7. Testing

**Puro, sin Dexie:**

- `accumulateConversation` / `buildConversationSummaries`: entrada desordenada,
  mensajes sin `chatSessionId`, conversación sin mensaje de usuario, título largo
  con y sin límite de palabra, palabra única de más de 80 caracteres, desempate
  por `sessionId`.
- Título significativo (§3.3.1): saludo aislado ignorado, saludo inicial recortado
  con mayúscula restaurada, todos-saludos cayendo al mensaje original, y sin
  mensajes de usuario cayendo a la fecha.
- Búsqueda: insensibilidad a caso y diacríticos, `matchCount` con varios mensajes,
  `matchedMessageId` apuntando al **primer** match, y query vacía devolviendo
  `{ snippet: '', matchCount: 0, matchedMessageId: null }`.
- `shouldRotateConversation` con reloj determinista: mismo día, día anterior,
  `null`, cruce de medianoche y cruce de DST.

**Dexie con fake-indexeddb** (patrón del proyecto: `db.close(); await
db.delete(); await db.open()` por test):

- Scope: atleta gestionado activo + filas legacy sin `athleteId` → no aparecen ni
  se adoptan.
- Borrado histórico dejando intacta la conversación actual.
- Borrado con propuestas vinculadas.
- Búsqueda usando el mismo scope que el listado.

**Store:**

- Switch de atleta a mitad de un `loadConversations()` en vuelo.
- `rotationSuspended`: se activa solo tras una carga exitosa; no se activa con id
  inexistente o fuera de scope; se resetea en `loadHistory()`.
- Rotación al principio de `sendMessage()`: verificar que la request no lleva
  `recentMessages` del día anterior.
- **Regresión de la adopción local-only:** `loadHistory()` sobre una sesión
  local-only vacía todavía adopta el hilo del mismo día. Este test existe para
  fijar que `loadSession()` no persiste el id en el arranque y no apaga el
  marcador local-only.
- `openConversation()` con un id inexistente o de otro atleta: no cambia la
  conversación actual, no suspende la rotación, y deja `error`.
- **Dos `openConversation()` encadenados:** gana el último. El token del primero
  queda obsoleto y no persiste id, no suspende rotación ni escribe `messages`.
- **Variante: el primero se detiene dentro de la reparación de propuestas.** Al
  resolverse tarde debe fallar el chequeo del paso 6 y, aun así, no persistir el
  id ni sobrescribir estado. Cubre el hueco entre los dos `await` de la secuencia,
  que es el único punto donde un commit parcial sería posible.
- **Sin `await` antes del lock:** test que fija que rotar dentro de `sendMessage()`
  no cede el turno antes del `set({ isLoading: true })` — dos envíos disparados en
  el mismo tick no producen dos rotaciones ni dos requests.
- Adopción con la fila más reciente **sin** `chatSessionId`: se adopta igual el
  hilo válido anterior del mismo día.
- Búsqueda: resultado obsoleto que llega tarde no pisa el vigente; cerrar el
  drawer con una búsqueda en vuelo no escribe estado.
