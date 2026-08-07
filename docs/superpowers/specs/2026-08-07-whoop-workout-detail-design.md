# Whoop — detalle de entrenamiento visible y carga objetiva para el coach

Fecha: 2026-08-07
Estado: diseño aprobado, pendiente plan de implementación
Migraciones: **ninguna** (Supabase sin cambios, Dexie sigue en v19)

## 1. Problema

La app ya ingiere, persiste y sincroniza el detalle por entrenamiento de Whoop,
y no lo usa nadie.

`012_whoop_workouts.sql` guarda `strain`, `avg_hr`, `max_hr`, `distance_m`,
`duration_min`, `start_at` y `end_at` por workout, en Supabase y en Dexie
(`db.whoopWorkouts`), y `dataExport.ts` los incluye en el backup. El único campo
que algún consumidor lee es `durationMin`:

- `SessionCard.tsx:253` muestra el badge «Sincronizado desde Whoop» y nada más.
- `whoopCompletionNotes.ts:12` escribe `"fecha deporte N min"`.
- `readinessContext.ts:16` le da al coach **solo el agregado diario**: recovery,
  sueño y strain del día.

Resultado: si planificaste 60 min de squash y Whoop registró 62 min con strain
14.9 y FC media 156, ni vos ni el coach tienen forma de saberlo. El problema es
de **superficie**, no de ingesta.

Un segundo hueco, más chico: un entrenamiento que Whoop registró pero que el
matcher no enganchó con ninguna sesión planificada (saliste a correr sin
planificarlo, dos sesiones del mismo deporte el mismo día) hoy es completamente
invisible.

## 2. Alcance

Dos entregas, en orden. La Entrega 1 no depende de la 2 y puede desplegarse
sola.

- **Entrega 1 — que lo veas vos.** Detalle del entrenamiento dentro de la sesión
  completada, más una línea residual con lo que Whoop registró y ninguna sesión
  reclamó.
- **Entrega 2 — que lo use el coach.** Un bloque de carga objetiva calculado al
  vuelo en el contexto del chat.

### Fuera de alcance, declarado

- **Zonas de frecuencia cardíaca** (`zone_durations` de `/v2/activity/workout`).
  Es la métrica que más dice sobre *cómo* fue la sesión, y es una Entrega 3
  futura porque **requiere `019` + Dexie v20**. Se deja fuera a propósito
  mientras corre la verificación post-deploy de las tandas de motor: meter una
  migración en el medio de un smoke es exactamente lo que no se quiere.
- Kilojoules, desnivel acumulado, `percent_recorded`.
- **Ritmo nativo y parciales por kilómetro de Whoop: fuera, porque la API no
  los expone.** El ritmo **promedio derivado** —distancia total sobre duración
  exacta— sí está incluido (§3.1); es un cálculo nuestro, no un dato de Whoop.
- Mostrar el strain real en el check-in diario. Descartado por decisión del
  owner: el strain diario ya se ve en `ReadinessCard`, y `Esfuerzo` (`rpeActual`)
  sigue siendo un campo declarado por el atleta, separado de la carga objetiva.
  Esa separación es una decisión de producto vigente y no se toca.
- Modificar `buildWhoopCompletionNotes` / `session.completionNotes`. Es un campo
  que también escribe el usuario a mano; no se le meten datos de máquina.
- `WeeklyView` y `NextSessionCard`.
- Atletas gestionados. Los workouts de Whoop son self-only por diseño del
  matcher.
- Backfill. **No hace falta ninguno:** ambas entregas calculan al vuelo sobre
  filas que ya están en Dexie desde el sync, así que las sesiones viejas
  muestran el detalle sin migrar nada.

## 3. Entrega 1 — detalle en la sesión

### 3.1 Módulo puro: `src/services/readiness/workoutMetrics.ts`

```ts
export type WorkoutMetric =
  | { key: 'strain'; value: number }                          // 0-21
  | { key: 'duration'; value: number }                        // minutos
  | { key: 'hr'; value: { avg: number; max: number | null } } // bpm
  | { key: 'distance'; value: number }                        // metros
  | { key: 'pace'; value: number }                            // segundos por km

export type WorkoutScoreNotice = 'pending' | 'unscorable' | null

export function buildWorkoutMetrics(workout: WhoopWorkout): WorkoutMetric[]
export function resolveScoreNotice(workout: WhoopWorkout): WorkoutScoreNotice
```

**Los valores son crudos y semánticos.** Nada de strings formateados ni de
castellano: el formato vive en el componente. Un cambio de etiqueta no rompe el
test del módulo puro.

Reglas de emisión, en orden. Toda métrica es fail-closed: **si el dato no está,
la métrica no se emite** — nunca un guion ni un cero de relleno.

| Métrica | Condición de emisión | Valor crudo |
|---|---|---|
| `strain` | `strain != null` | el número tal cual |
| `duration` | siempre | `durationMin` |
| `hr` | `avgHr != null` | `{ avg, max: maxHr ?? null }` |
| `distance` | `distanceM != null` | metros |
| `pace` | las cuatro condiciones de abajo, juntas | segundos por km (fraccional) |

`pace` se emite **solo si se cumplen las cuatro**:

1. `startAt` y `endAt` parsean a instantes finitos
2. La duración exacta `endAt - startAt` es **> 0**
3. `distanceM >= 300`
4. `sportName` normalizado ∈ `PACE_ELIGIBLE_SPORTS`

```ts
const PACE_ELIGIBLE_SPORTS = ['running'] as const
```

**El ritmo se calcula con la duración exacta `endAt - startAt`, nunca con
`durationMin`.** `durationMin` ya viene redondeado a minuto entero desde
`normalizeWorkouts` (`Math.round((endMs - startMs) / 60_000)`), y ese redondeo
sobre una corrida de 31 minutos mueve el ritmo hasta ~1 s/km. El valor crudo es
fraccional; **redondear a segundo entero es responsabilidad del componente**, al
presentar.

Whitelist explícita por nombre, misma forma que la allowlist de pliométricos y
la de drills competitivos de squash. Queda **solo `running`**: es el único
deporte de la whitelist que la app soporta y que el matcher puede asociar.
Ciclismo fuera porque min/km en bici no lo mira nadie. Walking fuera porque no
es un deporte soportado; agregarlo después es un elemento del array.

**Por qué las cuatro condiciones y no solo la whitelist:**

- El piso de **300 m** no es cosmético. `distance_meter` puede traer un residuo
  de GPS en una sesión indoor; dividir por eso produce un ritmo absurdo con
  aspecto de dato real. Bajo el piso se omite **solo el ritmo** — la distancia,
  si existe, se muestra igual, porque es un dato válido y ocultarlo sería menos
  honesto que mostrarlo.
- La guarda de duración exacta positiva evita la división por cero.
  `normalizeWorkouts` ya descarta `endMs <= startMs` del lado del servidor, pero
  `buildWorkoutMetrics` recibe una fila de Dexie que pudo entrar por
  import/backup, así que la valida por su cuenta en vez de confiar en un
  invariante de otro módulo.

### 3.2 Estados de puntuación

`normalizeWorkouts` descarta los workouts sin `scoreState`, así que en Dexie
siempre es uno de los tres. Y cuando no es `SCORED`, el normalizador **nunca
leyó `score`**, por lo que `strain`, `avgHr`, `maxHr` y `distanceM` quedan
ausentes por construcción y solo queda la duración.

En el modelo local esas métricas son `undefined`, no `null`: `pullWorkouts`
las pasa por `optionalNumber`, que convierte el nulo remoto en propiedad
opcional (`pullWorkouts.ts:23-25`). Las guardas de §3.1 usan `!= null`, que
cubre ambos, pero el tipo local es `number | undefined`.

`resolveScoreNotice` devuelve:

| `scoreState` | Retorno | Texto en UI |
|---|---|---|
| `PENDING_SCORE` | `'pending'` | «Whoop todavía no puntuó este entrenamiento» |
| `UNSCORABLE` | `'unscorable'` | «Whoop no pudo puntuar este entrenamiento» |
| `SCORED` | `null` | nada; se dibuja lo que haya |

**Los dos estados no significan lo mismo y no se colapsan.** `PENDING_SCORE` es
transitorio y `UNSCORABLE` es terminal: decirle «todavía» a algo que nunca va a
llegar le miente al usuario que vuelve a mirar mañana.

Con `SCORED` y métricas faltantes **no se dice nada**. No se infiere
procesamiento a partir de una ausencia.

### 3.3 Componente: `src/components/session/WhoopWorkoutMetrics.tsx`

Renderiza la fila de chips a partir de `WorkoutMetric[]`, y el aviso de
`WorkoutScoreNotice` cuando corresponde. Es el único lugar donde viven el
castellano y los formatos:

| `key` | Formato |
|---|---|
| `strain` | `11.2` (un decimal) |
| `duration` | `48 min` |
| `hr` | `148 / 172 bpm`, o `148 bpm` si `max` es `null` |
| `distance` | `8,12 km` (dos decimales, coma decimal) |
| `pace` | `5:56 /km` — **acá se redondea** el valor fraccional a segundo entero |

### 3.4 `SessionCard`

Gana una prop opcional `whoopWorkout?: WhoopWorkout`. **Sigue siendo puro**: no
consulta Dexie. Renderiza `WhoopWorkoutMetrics` bajo el badge existente solo
cuando `session.autoCompletion?.source === 'whoop_workout'` **y** le pasaron el
workout.

El enganche sesión→workout es directo y durable: `session.autoCompletion.workoutId`.

### 3.5 Loader: `src/services/readiness/localWhoopWorkouts.ts`

```ts
export async function getLocalWhoopWorkoutsInRange(
  athleteId: string,
  startDate: string,
  endDate: string,
): Promise<WhoopWorkout[]>
```

Sigue el patrón de `getLocalReadinessForDate`. El índice de Dexie es
`id, date, athleteId, updatedAt, &workoutId` — **no hay compuesto
`[athleteId+date]`**, así que consulta por rango de `date` y filtra `athleteId`
en memoria. El volumen es de decenas de filas; no justifica migrar el índice.

`WhoopWorkout.athleteId` es obligatorio en el tipo: no hay filas legacy sin
scope, así que el filtro es igualdad exacta y no aplica la política de adopción
legacy-self-only.

### 3.6 Cableado y línea residual

**La única superficie de esta entrega es `DayDetail`.** Carga los workouts del
día y pasa la prop a cada `SessionCard`.

`Dashboard` **no entra**, y no por decisión de alcance sino porque **no
renderiza `SessionCard`**: usa `NextSessionCard` (`Dashboard.tsx:38,454`), que
ya está fuera de alcance por §2. `WeeklyView` sí la renderiza, pero queda fuera:
sus tarjetas son resúmenes compactos y cinco chips por sesión las rompen.

En `DayDetail`, una sección discreta con los workouts del día que ninguna sesión
reclamó, **una línea por workout** — por ejemplo *«Whoop registró además:
corrida 42 min · 8,1 km»*. Si no hay ninguno, la sección no se dibuja.

**Predicado:** el conjunto de `workoutId` referenciados por
`session.autoCompletion` de las sesiones de ese día. Todo workout del día que no
esté en ese conjunto es no asociado.

Se usa el lado de la sesión y **no** `workout.autoComplete.status`, porque el
propio tipo declara (`types/index.ts:493-494`) que ese campo es estado local y
que la fuente durable es la sesión. Si algún día divergen, gana la sesión.

## 4. Entrega 2 — bloque de contexto del coach

### 4.1 Módulo puro: `src/services/ai/whoopWorkoutContext.ts`

```ts
export function formatWhoopWorkoutBlock(
  workouts: WhoopWorkout[],
  sessions: Session[],
  today: string,          // "YYYY-MM-DD", inyectado
): string | null
```

`today` se inyecta. Nada de `Date.now()` adentro, igual que el resto de la suite
con reloj determinista.

**Reutiliza `buildWorkoutMetrics` de §3.1** para strain, FC, distancia y ritmo.
No se reimplementa la whitelist ni la fórmula del ritmo: dos copias divergirían
en la primera corrección, y el escenario concreto es que alguien agregue
`walking` a la whitelist de la UI y el coach siga sin verlo. `whoopWorkoutContext`
solo formatea a texto de prompt lo que el módulo puro ya resolvió.

### 4.2 Ventana

**Desde `today - 6 días` hasta `today`, ambos inclusive: 7 días calendario.**

La comparación se hace sobre el campo `date` de `WhoopWorkout` — string
`YYYY-MM-DD`— **no sobre los timestamps `startAt`/`endAt`**. `date` ya fue
resuelto en `normalizeWhoop` aplicando el `timezone_offset` que reporta Whoop,
así que es el día calendario local del entrenamiento.

Comparar strings de día elimina la ambigüedad de huso horario de raíz: no hay
«inicio local» ni «final local» que definir, porque nunca se construye un
instante. El límite inferior se calcula con `differenceInCalendarDays` /
`subDays` sobre días calendario, consistente con el hardening de fechas de
2026-07-19.

### 4.3 Filtros y tope

- Solo `scoreState === 'SCORED'`.
- Tope de **8 líneas detalladas**, conservando las más recientes.
- Si sobran workouts, se agrega **una línea compacta de desborde** en vez de
  truncar en silencio:

  ```
  +2 entrenamientos anteriores no detallados (95 min en total)
  ```

  El costo sigue acotado y el coach sabe que la ventana está incompleta. Truncar
  callado es peor que no mostrar: el modelo concluiría que esos días no
  entrenaste.
- Si no queda ninguna línea, devuelve `null` y **el bloque no se emite**: no
  queda un encabezado vacío ocupando tokens en cada request.

### 4.4 Formato

```
Carga objetiva registrada por Whoop (ultimos 7 dias):
+2 entrenamientos anteriores no detallados (95 min en total)
- 04-08 running 48 min · strain 11.2 · FC 148/172 · 8,1 km · 5:56/km → sesion planificada: Running Z2 60 min
- 05-08 squash 62 min · strain 14.9 · FC 156/181 → sesion planificada: Squash tecnica 60 min
- 06-08 running 31 min · strain 8.4 · 5,2 km → sin sesion asociada
Strain es carga fisiologica medida (0-21), no el esfuerzo declarado por el atleta.
```

Las líneas detalladas van en **orden cronológico ascendente**, y la línea de
desborde va **antes de todas ellas**: los workouts que resume son los más
viejos, así que ponerla al final contradiría el orden y dejaría la palabra
«anteriores» apuntando hacia arriba en una lista que crece hacia abajo.

La línea de desborde solo aparece cuando hay desborde.

Cada línea separa tres cosas distinguibles: la **carga objetiva** medida, la
**sesión planificada asociada** (si la hay) y la marca explícita de **no
asociado**.

Tres notas sobre el formato:

- **No repite el strain diario.** `formatReadinessLine` sigue emitiendo el del
  día; este bloque emite el del entrenamiento. Son granularidades distintas y
  ninguna duplica a la otra.
- **La línea de guardia final no es decorativa.** El prompt ya recibe `Esfuerzo`
  1-10 desde el day log. Sin esa aclaración el modelo tiene dos números de
  «esfuerzo» en escalas distintas y va a promediarlos o contradecirlos. Cuesta
  una línea y evita el fallo más probable.
- **«sin sesión asociada» es información, no ruido.** Es lo que le permite al
  coach notar que corriste algo que no estaba planificado.

### 4.5 Costo de tokens

≈ **280 tokens por request de chat** (8 líneas × ~30 + encabezado + guardia), y
solo cuando hay entrenamientos. Es real y se asume a conciencia: es exactamente
la razón del tope de 8 líneas y de la ventana de 7 días.

### 4.6 Cableado

**El bloque NO puede construirse con las sesiones que ya están en el contexto
del chat.** `ChatCoach.tsx:113` toma `sessions` de `useTrainingStore`, que
contiene la **semana cargada**. Un lunes, el store tiene la semana nueva y no
las sesiones de los seis días anteriores: los workouts del domingo aparecerían
marcados como «sin sesión asociada» siendo falso, y el coach concluiría que
entrenaste fuera de plan. Es el peor modo de falla posible para este bloque,
porque el dato erróneo se lee como una señal deportiva legítima.

Por eso el cálculo hace **su propia consulta de las dos colecciones** sobre la
misma ventana `today - 6 … today`:

- workouts vía `getLocalWhoopWorkoutsInRange` (§3.5);
- sesiones vía `getSessionsForDateRange` (`db/queries.ts:88`), **no** vía el
  store.

**Transporte:** `ChatContext` (`types/index.ts:847`) gana un campo
`whoopWorkoutBlock?: string`.

El reparto de responsabilidades es deliberado:

| Módulo | Rol |
|---|---|
| `ChatCoach` | Consulta las dos colecciones y **calcula el string** |
| `contextOptimizer` | Lo **conserva** por el spread `...context` ya existente (`contextOptimizer.ts:30`) — cero cambios |
| `promptBuilder` | Solo lo **emite** |

Viaja como string ya armado y no como datos crudos por una razón concreta: el
optimizador recorta sesiones y day logs para acotar tokens, y si el bloque se
calculara aguas abajo se construiría sobre la colección **ya recortada**,
reintroduciendo por otra vía el mismo bug del lunes.

**El cambio en `promptBuilder.ts` es una línea condicional** junto a
`readinessLine` (`promptBuilder.ts:1604`). El archivo está marcado como delicado
en el CLAUDE.md; este cambio no toca ninguna regla de coaching.

**Cuidado con el retorno temprano.** `buildTodaySection` retorna en
`promptBuilder.ts:1611-1614` cuando no hay `dayLog`, y esa rama emite
`readinessLine` explícitamente. El bloque de workouts tiene que emitirse en
**las dos** ramas, o desaparece justo el día que todavía no hiciste el check-in
— que es exactamente cuando el coach más necesita saber qué registró Whoop.

### 4.7 Scope self-only

Sale gratis de la consulta: los workouts se estampan con el `athleteId` del
self, así que un atleta gestionado consulta por su propio `athleteId` y no
encuentra nada.

**No se agrega un guard extra en producción.** Un guard daría a entender que
existe un camino por el cual podrían filtrarse, y no lo hay. El invariante se
blinda con test (§5).

## 5. Testing

**`workoutMetrics.test.ts`**
- Ritmo correcto en segundos por km, calculado sobre `endAt - startAt`.
- **Un workout cuyo `durationMin` redondeado difiere de la duración exacta da un
  ritmo distinto del que daría `durationMin`** — fija que la base es la correcta.
- Distancia emitida sin ritmo bajo 300 m.
- Sin ritmo con `endAt <= startAt`, y sin ritmo con timestamps no parseables.
- Sin ritmo para `cycling`, `walking` y `squash` aun con distancia y duración
  válidas.
- `hr` con y sin `maxHr`.
- Ausencias parciales: cada métrica faltante no se emite.
- Los tres `scoreState` → `'pending'` / `'unscorable'` / `null`.
- `SCORED` con métricas faltantes → sin aviso.

**`whoopWorkoutContext.test.ts`**
- Tope de 8 líneas detalladas conservando las más recientes.
- Con 10 workouts: aparece la línea de desborde con el conteo y los minutos
  correctos. Con 8 o menos: **no** aparece.
- Ventana inclusiva en ambos extremos: un workout de `today - 6` entra, uno de
  `today - 7` no, uno de `today` entra.
- `null` sin datos, y `null` con datos todos fuera de ventana.
- Marcado de no asociados.
- Filtro de `PENDING_SCORE` / `UNSCORABLE`.

**`localWhoopWorkouts.test.ts`**
- **Atleta gestionado → `[]`.** Con workouts del self presentes en Dexie en el
  rango consultado, la consulta por el `athleteId` de un gestionado devuelve
  vacío. Este es el test que blinda el invariante de §4.7 sin agregar código de
  producción — **y va en el loader, no en el módulo puro**:
  `formatWhoopWorkoutBlock` recibe la lista ya consultada y no puede conocer el
  scope, así que ahí el caso degeneraría en «lista vacía → `null`», que ya está
  cubierto y no prueba nada sobre scoping.
- Rango inclusivo en ambos extremos.

**`SessionCard.test.tsx`**
- Render con workout y sin workout.
- Una sesión completada a mano (sin `autoCompletion`) no muestra nada.

**`DayDetail`**
- La sección de no asociados aparece, con una línea por workout, y no se dibuja
  cuando todos están asociados.
- Usa el predicado del lado de la sesión, no `workout.autoComplete.status`.

**`promptBuilder`**
- Bloque presente y ausente.
- Sin encabezado vacío cuando no hay líneas.
- **Bloque presente con `dayLog` ausente.** Cubre el retorno temprano de
  `buildTodaySection` (`promptBuilder.ts:1611-1614`): sin este test, el bloque
  desaparecería justo los días sin check-in y ningún otro test lo notaría.
- `contextOptimizer` preserva `whoopWorkoutBlock` — fija que el spread lo cubre
  y que nadie lo pierda al agregar recortes nuevos.

## 6. Decisiones registradas

| Decisión | Elegido | Por qué |
|---|---|---|
| Orden de entregas | UI primero, coach después | El dato ya está local: la UI es render puro y despliega sin coordinación |
| Superficie | Detalle en la sesión + residual en el día | El caso normal se lee donde corresponde; el raro no desaparece |
| Métricas | Strain, duración, FC, distancia (de la API) + ritmo (derivado) | Cero migraciones: todo sale de campos que Dexie ya tiene |
| Zonas de FC | Entrega 3 futura | Exige `019` + Dexie v20; no durante el smoke en curso |
| Strain en check-in | No | `Esfuerzo` es del atleta y no debe mezclarse con carga objetiva |
| Vía al coach | Bloque al vuelo, no `completionNotes` | No persiste, aplica retroactivo, reversible sin residuo |
| Ritmo | Whitelist solo `running` | Una regla abierta se vuelve sola el bug de «ritmo en squash indoor»; walking no es deporte soportado |
| Base del ritmo | `endAt - startAt` exacto | `durationMin` viene redondeado y mueve el ritmo hasta ~1 s/km |
| Desborde del tope | Línea compacta, no truncado silencioso | Truncar callado le hace concluir al modelo que esos días no entrenaste |
| Sesiones del bloque | Consulta propia, no el store | El store trae la semana cargada: un lunes marcaría el domingo como no asociado |
| Ventana | Comparación de strings `date` | Elimina el huso horario de raíz: nunca se construye un instante |
