# Asistente IA del Coach — Fase 1: triaje de roster

Fecha: 2026-08-29
Estado: **diseño aprobado, sin implementar**
Alcance: Coach Workspace (`/coach`), pestaña `asistente`

## 1. Problema

La pestaña "Asistente IA" es hoy un placeholder que promete *"proponer cambios
de sesión, semana o plan: tú revisas y confirmas antes de aplicarlos"*
(`CoachWorkspacePage.tsx:283`). Eso describe, casi palabra por palabra, lo que
ChatCoach, Week Creator y Plan Builder **ya hacen** para el atleta activo.

Lo que el Workspace v0 difirió es otra cosa, y quedó escrito como tal: *"señales
computadas cross-atleta (check-in gaps, readiness agregado, sesiones
vencidas)"*, porque exigía una capa de lectura multi-atleta que no existía.
`coachScopedReads` sigue leyendo **un atleta por vez**.

La fase 1 construye esa capa y responde una sola pregunta: **¿quién de mis
alumnos necesita atención esta semana?**

## 2. Alcance

**Entra:**

1. Triaje determinista del roster con cuatro señales y un estado de cobertura.
2. Un único punto de IA: redactar el cuerpo de un mensaje de seguimiento.
3. Reemplazo del copy del placeholder, que hoy promete la fase 2.

**No entra, declarado:** edición asistida por atleta (fase 2), aplicar cambios,
enviar mensajes, readiness en el roster, notificaciones y cálculo en background.

**Readiness queda fuera por un hecho, no por prioridad:** Whoop es self-only
—el prefill está gateado a `hoy + self` y `012` no auto-completa gestionados—,
así que `readinessDaily` está vacío justo para el roster que hay que triagear.

## 3. Arquitectura

Cálculo **bajo demanda desde Dexie** al abrir o refrescar la pestaña. Tres
piezas con responsabilidades separadas:

### 3.1 `coachScopedReads.ts` — lecturas por rango

Expone `getRosterTriageData` para el cargador: resuelve todo el roster con tres
escaneos de rango acotados, una revalidación `bulkGet`, búsquedas puntuales del
último `DayLog` por el índice compuesto y una sola agrupación en memoria. El
fallback histórico legacy sólo corre antes de completar el backfill local; una
vez marcado, las únicas legacy restantes son colisiones cuya fila scoped ya es
autoridad. La lectura:

- revalida en bloque que cada atleta siga activo y pertenezca al owner;
- aplica el predicado de scope de `getWeekSessionsForAthlete`:
  `row.athleteId === athleteId || (!isScopedAthleteId(row.athleteId) && isSelf)`.
  Filas legacy/unscoped pertenecen **sólo** al self; un gestionado nunca las ve;
- **deduplica después de agrupar** —`dayLogs` y `weekSummaries`, que tienen
  clave natural por fecha— con precedencia scoped sobre legacy;
- no cambian el atleta activo, ni lo leen.

Todo el acceso cross-atleta queda encapsulado acá. La lectura agregada recibe el
self resuelto una sola vez por el cargador y aplica exactamente el mismo
predicado de scope durante la agrupación.

#### El predicado solo no basta para `dayLogs` ni `weekSummaries`

Para el self pueden coexistir una fila scoped y una legacy con la **misma fecha
natural**. No es un estado corrupto: `athleteScopeMigration.ts` lo preserva a
propósito —al estampar una fila legacy que chocaría con una scoped, la deja
legacy y el sync posterior resuelve por LWW—. Las lecturas existentes ya lo
manejan: `getDayLogsForWeekCore` (`queries.ts:108`) indexa las scoped por
`date` en un `Map` y sólo entonces admite legacy como relleno.

Aplicar el predicado plano devolvería **las dos filas**, y el triaje contaría
dos veces el mismo día o leería la versión equivocada. Por eso la lectura
agregada deduplica `dayLogs` por `date` y `weekSummaries` por `weekStartDate`,
siempre con **scoped gana, legacy sólo como fallback**. `sessions` **no
deduplica**: no tiene clave natural por fecha.

Verificación obligatoria: tests de colisión con ambas filas presentes para la
misma fecha, comprobando cuál sobrevive.

### 3.2 `coachRosterTriage.ts` — cálculo puro

Recibe los datos ya leídos y devuelve las señales. **Sin Dexie, sin red, sin
reloj propio**: la fecha de referencia entra como parámetro. Testeable sin
`fake-indexeddb` y sin congelar reloj.

### 3.3 Cargador

Resuelve el self canónico una vez, lee y agrupa los datos del roster, e itera el
resultado para ejecutar el cálculo puro. Un atleta archivado durante la lectura
se omite como una carrera normal; sólo una inconsistencia real del cálculo queda
contabilizada como fallo parcial:

```ts
interface RosterTriage {
  computedAt: number
  selfAthleteId: string
  athletes: AthleteTriage[]
  durationMs: number
  athleteCount: number
  failedAthleteCount: number
}
```

`durationMs` y `athleteCount` existen para medir cuándo el enfoque deja de ser
trivial (§11). La UI muestra un error explícito si falla toda la lectura o si
`failedAthleteCount > 0`; nunca presenta el timestamp anterior como fresco sin
avisar.

## 4. Señales

Los cuatro umbrales son valores **v1** y viven en un solo lugar, para ajustarse
sin tocar lógica. Toda aritmética de días usa `differenceInCalendarDays` sobre
días calendario locales, por el endurecimiento DST del proyecto.

| Señal | Predicado | Ventana |
|---|---|---|
| `pain` | algún `DayLog.painLevel >= 4` | hoy y los 6 días calendario anteriores |
| `overdue-sessions` | sesiones con `status === 'planned'` y fecha `< hoy` | `[hoy − 14 días, hoy)` |
| `no-check-in` | `differenceInCalendarDays(hoy, referenceDate) >= 3` | — |
| `low-adherence` | `hasPreviousProgramming` **y** `adherencePct != null` **y** `adherencePct < 60` (ver §4.2) | **semana completa anterior**, con los mismos límites semanales que ya usa la app |

**Semántica de `pain.days`**, que es el conteo que viaja al proveedor: la
**cantidad de fechas calendario distintas con `painLevel >= 4` dentro de la
ventana, contadas después de deduplicar** scoped/legacy. No son días
consecutivos ni el número de registros — dos filas del mismo día cuentan una
vez, y tres días salteados cuentan tres. Queda fijado por test.

Con:

```ts
referenceDate = latestDayLog?.date ?? toCalendarDate(athlete.createdAt)
```

`Athlete.createdAt` es epoch y `DayLog.date` es `YYYY-MM-DD`: la referencia se
normaliza a fecha calendario local **antes** de comparar, o aparece un
off-by-one de medianoche.

**`latestDayLog` no sale de una ventana.** La ventana de dolor son siete días y
no alcanza para conocer la última fecha histórica: un alumno que no registra
hace cinco semanas quedaría sin `latestDayLog` y caería a `createdAt`, que da un
número distinto del real. Se obtiene con una lectura propia del **último**
`DayLog` del atleta —una sola fila, recorriendo el índice `[athleteId+date]` en
orden inverso—, sin traer historial. Esa lectura pasa por la misma
deduplicación scoped/legacy que el resto.

Con eso, las lecturas por atleta son cuatro y cada una tiene su rango
declarado: dolor (7 días), sesiones (14 días), resumen de la semana anterior
completa, y último check-in (una fila, sin rango).

### 4.1 Decisiones que no son obvias

- **`overdue-sessions` se rotula "sin resolver", nunca "no entrenó".** Una
  sesión `planned` vencida no distingue "no entrenó" de "no registró"; para un
  coach son problemas distintos y el dato no permite elegir.
- **La adherencia se lee, no se recalcula.** `WeekSummary.adherencePct` ya
  existe persistido.
- **La adherencia nunca mira la semana en curso.** Un miércoles siempre se ve
  mal; usar la semana viva convertiría la señal en ruido garantizado.
- **`pain` no depende de `painNotes`.** El texto libre se muestra al coach pero
  no participa del predicado.

### 4.2 Cobertura: `insufficient-data`

Es un **estado de cobertura ortogonal**, no un sustituto de las señales, y su
predicado es mecánico y ejecutable, nunca una decisión de presentación:

```ts
hasPreviousProgramming =
  (previousWeekSummary?.plannedSessions ?? 0) > 0

insufficientData =
  sessionsInWindow.length === 0 && !hasPreviousProgramming

lowAdherence =
  hasPreviousProgramming
  && previousWeekSummary?.adherencePct != null
  && previousWeekSummary.adherencePct < 60
```

La versión anterior de este predicado tenía un agujero real con datos legacy:
un `WeekSummary` con `plannedSessions === 0` y `adherencePct === 0` daba
`insufficientData === false` **y** `low-adherence === true` a la vez, o sea
reportaba adherencia baja de una programación que nunca existió.

`hasPreviousProgramming` es ahora la condición común: sin programación previa no
hay cobertura suficiente **ni** adherencia que juzgar. Las dos derivan del mismo
hecho en vez de calcularse por separado y contradecirse.

`dayLogs` no participa del predicado a propósito: su ausencia ya la cubre
`no-check-in`, y contarla dos veces haría que todo alumno nuevo apareciera con
dos estados que dicen lo mismo.

Puede coexistir con señales. Un alumno nuevo empieza como `insufficient-data`;
al cumplir tres días suma `no-check-in` y **conserva ambos**. Si hubiera `pain`
u otra señal, se muestra siempre y conserva su prioridad.

Existe porque un alumno sin ningún dato produce cero señales y se vería sano.
Es el mismo error que §26 corrigió cuando la ausencia de macroplan fingía un
`ok` verde: **"al día" y "sin datos" no son el mismo estado.**

## 5. Prioridad y presentación

Orden: `pain` → `overdue-sessions` → `no-check-in` → `low-adherence`. `pain`
encabeza siempre porque es la única señal con consecuencia de seguridad y no
sólo de adherencia.

Cada alumno muestra **todas** sus señales. Cada tarjeta trae **[Ver semana]**
—navegación existente, sin IA— y **[Redactar mensaje]**, el único punto que
llama al proveedor.

Tres grupos, no dos, por la misma razón de §4.2:

1. **Con señales** — listados y ordenados por prioridad.
2. **Sin datos suficientes** — visibles, no colapsados. Un alumno cuyo único
   estado es `insufficient-data` no pertenece a "al día": el panel no sabe cómo
   está, y colapsarlo lo afirmaría.
3. **Al día** — colapsados.

**[Redactar mensaje] aparece sólo cuando hay al menos una señal.** Sin señal no
hay nada que preguntar, y un borrador sobre `insufficient-data` sería el modelo
inventando un motivo.

## 6. La llamada de IA

### 6.1 Clase nueva `coach_assistant_message`: superficie real

La primera versión de este spec decía "cinco lugares" y estaba **mal**. La
clase atraviesa el cliente, el proxy y el esquema remoto, con tres uniones
duplicadas y un CHECK en Postgres:

| Lugar | Estado hoy | Si falta |
|---|---|---|
| `AIRequestClass` (`types/index.ts:7`) | unión del cliente | No compila |
| `AI_REQUEST_POLICIES` | ya `Record<AIRequestClass, …>` | No compila |
| `REQUEST_CLASS_MIN_TIER` | ya `Record<AIRequestClass, Tier>` | No compila |
| `QUOTA_BUCKETS` (`quotaBuckets.ts:17`) | **lista, no mapa exhaustivo** | `bucketForClass` devuelve `null`: ruta de gasto sin techo |
| `RequestClass` (`coach.ts:50`) | **unión duplicada en el proxy** | El proxy rechaza la clase |
| Mapas de timeout, tokens, prompt, validación y razonamiento en `coach.ts` | por clase | Comportamiento indefinido |
| `CoachRequestClass` (`coachRequestTelemetry.ts:9`) | **segunda unión duplicada** | La request no queda registrada |
| CHECK de `coach_requests.request_class` (`018_coach_requests.sql:14`) | **siete literales** | El insert viola el constraint y, como la escritura es best-effort sin `await`, **cada request del asistente pierde su telemetría en silencio** |
| `resolvePrimaryProvider` (`coach.ts:607`) | cascada de env con `'gemini'` literal | Cae a Gemini sin decidirlo |
| `AITechnicalSurface` (`types/index.ts:33`) | unión | Sin superficie propia para el panel |

Algunos de estos fallan al compilar; otros fallan en runtime o en silencio. El
spec no fija un número exacto de cada tipo: la lista de arriba puede quedar
incompleta y esa es precisamente la razón de que el guard exista.

La clase tiene **cuatro representaciones** en total: la canónica
`AIRequestClass` del cliente y tres duplicadas —proxy (`coach.ts:50`),
telemetría (`coachRequestTelemetry.ts:9`) y middleware de desarrollo
(`dev/coachProxyMiddleware.ts:5`)—.

**Hace falta una migración `023`** que amplíe el CHECK de
`coach_requests.request_class` a ocho clases. Es de aplicación manual, como
todas las del proyecto: escribir el `.sql` no es aplicarlo, y debe aplicarse
**antes** del primer deploy que emita la clase nueva.

El spec **no** propone unificar esas representaciones: es un refactor
transversal que excede esta entrega.

#### El guard tiene que ser ejecutable en runtime

Una unión de TypeScript no existe en runtime y **no se puede recorrer**. El
guard necesita una enumeración exhaustiva declarada como dato:

```ts
const ALL_AI_REQUEST_CLASSES = {
  chat_general: true,
  chat_action: true,
  weekly_summary: true,
  week_creator: true,
  plan_builder_week: true,
  plan_builder_pair: true,
  import_extract: true,
  coach_assistant_message: true,
} satisfies Record<AIRequestClass, true>
```

`satisfies` obliga a que esté completa al compilar; `Object.keys(...)` la hace
iterable al testear. Sobre esa lista, el guard comprueba para cada clase:
entrada en `AI_REQUEST_POLICIES`, en `REQUEST_CLASS_MIN_TIER`, bucket no nulo
en `bucketForClass`, default de proveedor declarado, y presencia en los
validadores o listas exportadas de las tres representaciones duplicadas del
servidor.

**El guard también cubre el CHECK de la migración.** Hoy
`coachRequestSchema.test.ts:68` se llama *"restringe request_class a las 7
clases"* y lee sólo `018`: hay que actualizarlo para que lea el CHECK vigente
—el de `023`— y lo contraste contra la misma enumeración, en vez de repetir
literales a mano.

### 6.2 Parámetros operativos

Cada valor por clase que la implementación tendría que inventar, decidido acá.
La lista se amplió dos veces durante la revisión del spec, así que se declara
como lo que es —los parámetros **conocidos**, no una garantía de completitud—:
el guard de §10 es lo que convierte un hueco futuro en un fallo de CI.

| Parámetro | Valor | Razón |
|---|---|---|
| `maxTokens` | 260 | Deja margen para 600 caracteres más el envoltorio JSON; el tope de caracteres produce el error específico antes que un truncamiento por tokens |
| `temperature` | 0.5 | Lenguaje natural, no estructura. Entre `chat_general` (0.55) y `weekly_summary` (0.25) |
| `timeoutMs` | 15 000 | Igual que `chat_general` |
| `allowFallback` | **false** | Es accesorio y **cada intento consume cuota sin reembolso**; un fallback duplicaría el consumo de una función no crítica |
| Proveedor default | `gemini` explícito por clase | Tarea corta de lenguaje natural, la más barata del mapa. Declarado, no heredado del literal de la cascada |
| Bucket de cuota | propio, `coach_assistant`, `{ advanced: 20 }` | No comparte contador con el chat: mezclarlos haría que triagear consuma la conversación con el coach |
| Retry | **ninguno automático** | Sin reembolso de cuota, un retry automático duplica el costo de un fallo. El coach puede pulsar de nuevo, y eso consume una unidad más |
| Streaming | no, respuesta única | La salida es corta y se valida entera antes de mostrarse |
| Superficie de telemetría | `AITechnicalSurface` nuevo, `coach_assistant` | — |
| `SYSTEM_PROMPT_MAX_CHARS` (`coach.ts:210`) | **8 000** | El prompt es fijo y corto; el tope más bajo hoy es 18 000. Un cap ceñido es guardarraíl, y `coach.ts:416` rechaza por encima |
| Thinking budget de Gemini | **0**, en los **dos** lugares: `GeminiProvider.ts:13` (cliente) y `getGeminiThinkingBudget` (`coach.ts:880`, proxy) | Redactar dos frases no requiere razonamiento. Mismo valor que `chat_general` |
| Reasoning effort de OpenAI | `none`, con caída a `minimal` si el modelo no lo admite (`openAIReasoning.ts:42`) | Sólo aplica si un env sobrescribe el proveedor. Mismo valor que `chat_general` |

Los tres son `switch` o `Record` exhaustivos sobre la unión, así que agregar la
clase **rompe la compilación** si no se decide su valor. Que fallen al compilar
no quita que haya que elegir el número: por eso están acá y no se dejan al
criterio de quien implemente.

**`requestClass` y `surface` se pasan siempre explícitos.** `CoachEngine.extractRaw`
hace `requestClass ?? 'import_extract'` y `surface ?? 'import'`
(`CoachEngine.ts:82,87`): reusarlo sin ambos atribuiría la cuota y la telemetría
del asistente a la importación de PDF.

### 6.3 Tier: `advanced`

El Workspace es el producto de coach; `weekly` es el tier de "ayúdame con mi
semana" individual. Hoy el Workspace está gateado por allowlist
`VITE_COACH_ACCOUNTS`, no por tier, así que el gate es redundante — pero debe
existir desde el día uno, porque cuando la allowlist se retire tiene que estar
puesto.

### 6.4 Contrato del payload

El proveedor recibe **sólo señales, conteos y periodos relativos**. Nunca
nombres, ids, fechas absolutas, notas libres, contenido de plan ni registros
completos.

#### DTO de entrada, claves exactas

Sin esto el test de allowlist no tiene contra qué comparar:

```ts
interface AssistantMessageInput {
  signals: Array<
    | { kind: 'pain'; days: number }
    | { kind: 'overdue-sessions'; count: number; oldestDaysAgo: number }
    | { kind: 'no-check-in'; days: number }
    | { kind: 'low-adherence'; adherencePct: number }
  >
}
```

Las claves permitidas son exactamente `signals`, `kind`, `days`, `count`,
`oldestDaysAgo` y `adherencePct`. **Periodos relativos, no fechas**: un
calendario de fechas absolutas reidentifica sin aportar nada a la redacción.

El objeto se construye **campo por campo, sin spreads de objetos de dominio**:
un spread arrastra cualquier campo que el tipo gane después, y ese es el modo
de falla que esta allowlist existe para impedir. Mismo precedente que el
normalizador de respuestas, que no deja al modelo emitir `supersetGroup` ni
`libraryRef`.

El modelo redacta **sólo el cuerpo**; el saludo con el nombre lo agrega la
aplicación localmente. Así el payload no lleva **identificadores directos ni
texto libre**.

Deliberadamente no se afirma que el payload "no lleva PII": una señal
estructurada de salud —`pain` durante N días— puede tener una clasificación
legal propia aunque no identifique a nadie por sí sola. Esa calificación es de
la revisión jurídica, no del diseño técnico.

#### Schema de salida, y la ampliación de API que exige

```ts
const ASSISTANT_MESSAGE_SCHEMA = {
  type: 'object',
  properties: { body: { type: 'string' } },
  required: ['body'],
  additionalProperties: false,
} as const
```

Con `responseMimeType: 'application/json'`. El cuerpo se valida además contra un
tope de **600 caracteres**; el schema no puede expresarlo de forma fiable entre
proveedores, así que el límite se comprueba en la aplicación.

**`CoachEngine.extractRaw` no sirve tal cual.** `AIRequest` declara
`responseMimeType` y `responseSchema` (`services/ai/types.ts:38-39`), pero las
opciones de `extractRaw` no los incluyen ni los reenvían
(`CoachEngine.ts:71-81`). La entrega tiene que **ampliar esa API** —o exponer un
método propio para esta clase— que acepte ambos y los propague al proveedor.
Sin ese cambio no hay salida estructurada, sólo texto libre con una instrucción
en el prompt, que es justo lo que §7.1 dice que no basta.

### 6.5 Prohibiciones del prompt

El borrador **no da diagnóstico, tratamiento ni cambios de carga**. Dice
*"vi que no registraste estos días, ¿cómo vas?"*, nunca *"deberías bajar la
carga"*. Ante `pain`, sólo puede formular una **pregunta de seguimiento**.

Es la misma línea del descargo de salud ya publicado.

### 6.6 Invocación y envío

- La IA se invoca **únicamente** al pulsar "Redactar mensaje". Sin precarga.
- **La app no envía nada.** No tiene canal de mensajería, y mandar en nombre del
  usuario sería una acción hacia afuera. El borrador aparece en un bloque
  copiable.

## 7. Degradación

Dos comportamientos distintos, porque las causas lo son:

| Causa | Conducta |
|---|---|
| Cuota agotada, kill switch, entitlement insuficiente | **Deshabilita** el botón y muestra el motivo. Reintentar no puede funcionar |
| Timeout, error de red, error transitorio del proveedor | Muestra el motivo y **permite reintentar**. El botón sigue vivo |
| Token vencido, configuración o gate no disponible | Muestra indisponibilidad y **permite reintentar**. No bloquea toda la clase |

Cada reintento manual **puede** consumir una unidad de cuota: el gate reserva
inmediatamente antes de llamar al proveedor y no hay reembolso, pero un fallo
de red anterior a ese punto no llega a reservar. La UI advierte que reintentar
puede consumir cupo, sin prometer que siempre lo haga ni que nunca lo haga.

Ningún fallo de IA invalida, borra ni bloquea el triaje determinista: las
señales no dependen del proveedor. **La IA es accesorio, no columna vertebral.**

Los borradores se guardan por `athleteId`, no por `computedAt`. Recalcular o
cambiar de pestaña no elimina una respuesta ya pagada, y una respuesta en vuelo
se publica aunque el snapshot determinista se haya renovado mientras esperaba.

### 7.1 Salida validada, no sólo prompt

Las prohibiciones de §6.5 no son exigibles por instrucción. El modelo devuelve
una estructura —`{ "body": string }`— y la aplicación **valida antes de
mostrar**: forma correcta, cuerpo no vacío y dentro de un tope de longitud.

Ante una respuesta inválida: **se descarta entera**, se muestra que no se pudo
generar un borrador y no se renderiza ningún fragmento sin validar. No hay
reintento automático.

Límite honesto y declarado: la validación comprueba **forma**, no contenido
clínico. Una lista negra de términos sería frágil —cambia una palabra y pasa— y
daría una falsa sensación de garantía.

Tampoco se afirma que el modelo no pueda prescribir: con sólo saber que hay
dolor durante N días, un modelo puede producir consejo genérico perfectamente
inapropiado. Lo que la minimización del payload consigue es **reducir la
especificidad** de lo que pueda decir —no ve plan, historial ni notas—, no
garantizar el contenido. El prompt reduce el riesgo, el payload lo acota, y
ninguno de los dos lo elimina; por eso el borrador siempre pasa por el coach
antes de llegar al alumno.

## 8. Honestidad de estado

El panel muestra `Calculado <fecha/hora>` y el estado de sincronización
disponible, con un botón de recálculo explícito. **No se presenta como tiempo
real.**

Límite declarado: en un dispositivo recién sincronizado el triaje refleja lo
que Dexie alcanzó a traer. Es la misma propiedad que ya tiene Planificación, no
una regresión — pero el panel lo dice en vez de fingir frescura.

## 9. Bordes

- **El self entra al triaje, sin botón de redactar.** Redactarse un mensaje a
  uno mismo no tiene sentido.
- **Sólo roster activo.** Los archivados no aparecen.
- **Alumno sin plan:** sin sesiones planificadas no hay `overdue-sessions`, y
  sin `WeekSummary` no hay `low-adherence`. Resultado correcto:
  `insufficient-data`, no "al día".
- **Cambio de cuenta durante el cálculo:** se captura `ownerAccountId` al
  empezar y se descarta el **resultado** si cambió. Precedente: el bloque Whoop
  del chat (§24), donde un guard demasiado amplio llegó a descartar un mensaje
  entero.
- **Recálculos fuera de orden:** cada cálculo lleva un número de generación y
  sólo el más reciente puede publicar su resultado. Precedente:
  `requestedWeekStart` vs `loadedWeekStart` de §26.
- **El atleta activo queda intacto**: el triaje no lo lee, no lo escribe y no lo
  cambia.

## 10. Verificación

- **Módulo puro, tests de tabla** con `today` como parámetro. Bordes exactos:
  día 2 vs 3, día 14 vs 15, `painLevel` 3 vs 4, adherencia 59 vs 60.
- **Adherencia:** que use exclusivamente la semana completa anterior. Semana en
  curso y `WeekSummary` ausente **no** producen `low-adherence`.
- **Cobertura:** `insufficient-data` con predicado mecánico; alumno nuevo que a
  los tres días suma `no-check-in` y conserva ambos.
- **Scope:** los cuatro accesos nuevos no devuelven filas de otro atleta, y las
  legacy llegan sólo al self. Espeja los tests que `coachScopedReads` ya tiene.
- **Último check-in:** con registros fuera de toda ventana —por ejemplo hace
  cinco semanas— `no-check-in` reporta la antigüedad real, no la derivada de
  `createdAt`.
- **Contrato del payload:** se comprueban las **claves exactas del JSON**
  enviado — sin nombre, sin id, sin `painNotes`, sin contenido de plan. Es el
  test que hace exigible la decisión de privacidad en vez de dejarla como
  comentario.
- **Colisión scoped/legacy:** para el self, con ambas filas presentes en la
  misma fecha, sobrevive la scoped y el día se cuenta **una vez**. Cubre
  `dayLogs` y `weekSummaries` por separado.
- **Exhaustividad de clase:** un guard que recorra
  `Object.keys(ALL_AI_REQUEST_CLASSES)` y exija para cada miembro entrada en
  `AI_REQUEST_POLICIES`, `REQUEST_CLASS_MIN_TIER`, `QUOTA_BUCKETS`
  (`bucketForClass` no devuelve `null`), default de proveedor, prompt máximo,
  thinking budget y reasoning effort; presencia en las **cuatro
  representaciones** de la clase —la canónica del cliente más las tres
  duplicadas en proxy, telemetría y middleware de desarrollo—; y presencia en el
  CHECK de `023`. Es el test que impide que la próxima clase repita este
  hallazgo.
- **Tier concreto, no sólo presente:** el guard comprueba que exista entrada en
  `REQUEST_CLASS_MIN_TIER` para toda clase; hace falta además una aserción
  específica de que `coach_assistant_message` resuelve exactamente a
  `advanced`. Existir y ser correcta no son lo mismo.
- **Parámetros sin respaldo del compilador:** `allowFallback === false` y retry
  técnico deshabilitado. `shouldUseTechnicalRetry` (`coach.ts:630`) es una
  cadena de `||`, no un `switch` exhaustivo: la clase nueva da `false`, que es
  el valor deseado, pero **por defecto y no por decisión**. Nada rompe si
  alguien lo cambia, así que lo fija el test.
- **Atribución de clase y superficie:** la llamada del asistente registra
  `coach_assistant_message` / `coach_assistant`, nunca los defaults
  `import_extract` / `import` de `extractRaw`.
- **Salida validada:** una respuesta con forma incorrecta, cuerpo vacío o sobre
  el tope se descarta entera y no renderiza fragmentos.
- **Degradación por causa:** cuota, kill switch y entitlement deshabilitan el
  botón; timeout y error transitorio lo dejan reintentable. Los cinco casos
  renderizan el triaje.
- **Bordes:** self sin botón, archivados excluidos, cambio de cuenta,
  recálculos fuera de orden y atleta activo intacto.
- **Agrupación:** un alumno cuyo único estado es `insufficient-data` no queda en
  el grupo colapsado de "al día", y no ofrece botón de redactar.

## 11. Medición y evolución

Cada cálculo **incluye** `durationMs` y `athleteCount` en el `RosterTriage` que
devuelve. Esta entrega **no persiste** esas métricas ni agrega telemetría
remota: se muestran en el panel sólo bajo `isDevToolsEnabled()`, que ya existe
y está apagado en builds PROD. Si más adelante hace falta observarlas en
producción, es trabajo aparte y con su propia decisión. El enfoque en cliente se
reconsidera —y recién ahí se evalúa una RPC agregada estilo
`read_operations_metrics` de §31, con su migración— si se cumple **alguno**:

1. el roster supera ~20 atletas;
2. el cálculo afecta perceptiblemente la interfaz;
3. aparece un requisito real de frescura multi-dispositivo sin hidratación
   previa.

**No hace falta una migración para la RPC agregada.** Construir una RPC para
cinco alumnos es la sobrearquitectura que §Pre-Lanzamiento existe para evitar;
el punto 15 bloquea la cola global por la misma razón.

Esto **no** significa que la fase 1 sea libre de migraciones: §6.1 exige una
`023` para ampliar el CHECK de `coach_requests.request_class`. Son cosas
distintas y la versión anterior de este spec las confundía en una sola frase.

## 12. Dependencias de rollout

La fase 1 introduce una clase de IA, así que **no despliega hasta que
entitlements y límites de uso estén encendidos** (§Pre-Lanzamiento, puntos 2,
3 y 4), y la migración `023` de §6.1 debe estar **aplicada antes** del primer
deploy que emita la clase nueva — si no, la telemetría de cada request del
asistente se pierde sin ruido. Fue una decisión explícita del owner: se prefirió una fase 1 completa
antes que una puramente determinista que pudiera desplegarse de inmediato.

## 13. Para la revisión legal

`painNotes` queda **expresamente prohibido** en el payload al proveedor, junto
con nombres e ids. Conviene que la revisión lo vea escrito así: es un hecho
cerrado del diseño y no una zona gris a resolver después.
