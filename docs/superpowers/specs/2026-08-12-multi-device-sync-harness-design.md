# Harness de sync multi-dispositivo — diseño

Fecha: 2026-08-12
Estado: implementado y verificado; follow-up productivo de desempate cerrado.

## 1. Problema

El roadmap declara la convergencia multi-dispositivo como el mayor riesgo
técnico abierto para el piloto. La app ya tiene cola, LWW/delete-wins,
reintentos, diagnóstico y auto-sync en foco: no falta capacidad, falta
**evidencia**.

Los tests actuales de sync (`syncService.test.ts` y hermanos, ~3125 líneas)
mockean Supabase **y** Dexie. Verifican que `syncService` llama lo que debe,
pero por construcción no pueden demostrar que dos clientes terminan en el mismo
estado, porque nunca existen dos clientes ni un backend con estado.

## 2. Objetivo de esta entrega

Un harness determinista, sin credenciales ni costo, que ejercite el código real
de `syncService` sobre **dos estados locales divergentes** contra un backend con
estado compartido, y que afirme los criterios de salida del roadmap.

Alcance de la primera entrega: **sesiones y claves naturales de day/week**. Son
las entidades con conflicto real y las que ya rompieron en producción: el
`23505` reactivo de `008b` y `reconcileNaturalKeyConflict` hoy solo están
cubiertos con mocks.

## 3. No objetivos

Declarados para que un harness verde no se lea como "sync verificado":

- **RLS y semántica real de PostgREST.** El doble implementa un subconjunto.
- **Concurrencia de red real.** Ver §7: esto es concurrencia lógica.
- **Latencia, reintentos por timeout y particiones de red.**
- **Los `queue:op_failed` / `queue:op_expired` observados en el smoke del
  2026-08-11.** Requieren validación contra Supabase real; todavía no hay
  evidencia suficiente para atribuirlos a una capa.
- Entidades fuera de sesiones/day/week: plantillas, planes, chat, readiness y
  workouts quedan para entregas siguientes.

## 4. Arquitectura

Tres módulos en `src/testing/syncHarness/`. **Ninguno modifica código de
producción**: la restricción de partida es que `EntrenadorDB` fija su nombre en
el constructor y `syncService` importa el singleton `db`.

### 4.1 `fakePostgrest.ts`

Backend en memoria que implementa el subconjunto de PostgREST que `syncService`
usa realmente. La superficie se deriva leyendo el código, no adivinando.

Responsabilidades:

- almacenar filas por tabla;
- emular los únicos compuestos `[athlete_id+date]` (`day_logs`) y
  `[athlete_id+week_start_date]` (`week_summaries`), devolviendo un error con la
  forma real de un `23505` de PostgREST;
- respetar `onConflict`: un `upsert` por `id` **puede** chocar contra la clave
  natural, mientras que `upsert(..., { onConflict: 'athlete_id,date' })` debe
  resolver por esa clave. Tratar ambos igual haría desaparecer justamente el
  conflicto que queremos observar;
- soportar el update condicional (`lt('updated_at', …)`) y reportar cuántas
  filas afectó, que es la señal que consume el recheck de LWW.

**Fail-fast:** ante cualquier forma de consulta no implementada, lanza. Un doble
que responde `[]` a algo que no soporta haría pasar el test mientras el camino
real nunca corrió — peor que no tener harness.

**El doble tiene sus propios tests.** Un fake que miente sobre el `23505`
invalida todo lo construido encima.

### 4.2 `deviceHarness.ts`

`withDevice(name, fn)` restaura el estado completo del dispositivo, ejecuta el
turno y vuelve a snapshotearlo. El backend persiste entre turnos.

Un snapshot de dispositivo incluye **todo el estado que distingue a un cliente
de otro**, no solo Dexie:

| Estado | Por qué |
|---|---|
| Contenido de Dexie | Datos locales |
| `localStorage` | La cola de sync vive ahí (`syncService.ts:8`), junto con tombstones y marcadores de sync |
| `activeAthleteId` / `selfAthleteId` | Scope de lectura y estampado |
| Estado de auth y de sync | Token, `lastSuccessfulSyncAt`, flags en vuelo |
| `navigator.onLine` | Encolar vs. empujar |
| `useTrainingStore` | `requestedWeekStart` / `loadedWeekStart` y semana cargada |

Sin esto los dos dispositivos compartirían exactamente el estado que el harness
pretende aislar.

**Timers de reintento:** quedan fuera del harness. Cada turno los limpia y el
avance del tiempo es explícito; un reintento por temporizador convertiría los
casos en intermitentes. Documentado como no objetivo.

### 4.3 `syncExitCriteria.ts`

Los cinco criterios del roadmap como aserciones reutilizables:

- `assertConverged(a, b)` — ambos dispositivos ven el mismo conjunto de filas.
- `assertQueuesDrained()` — la cola termina vacía en ambos.
- `assertNoResurrection(ids)` — lo borrado no vuelve tras sincronizar el otro.
- `assertNoScopeLeak()` — cada fila conserva su `athleteId`, y las lecturas y
  el estado visible proyectan **sólo** el atleta activo. No afirma que Dexie
  carezca de filas de otros atletas: cachear varios atletas es legítimo y
  esperable en una cuenta de coach.
- `assertVisibleWeekStable(device, weekStart)` — durante un merge, la semana
  visible nunca combina datos de semanas distintas.

  **Se observa por transiciones, no por estado final.** Un snapshot al cierre no
  demuestra nada sobre "durante el merge": el estado puede haber pasado por una
  proyección inconsistente y haberse corregido después. La aserción se suscribe
  a `useTrainingStore` durante el flujo de refresh y falla si **alguna**
  transición combina `requestedWeekStart`, `loadedWeekStart`, sesiones o resumen
  de semanas distintas.

  Esa frontera vive en el bootstrap autenticado de `App.tsx:254-265`
  —`resolveWeekStartToRefresh` + `pullSessionsForDateRange` acotado— y **no**
  dentro de `runFullSync`. El caso debe ejercitar ese flujo, no sólo el sync
  completo.

### 4.4 Casos fijados de `sessions`

**Caso LWW con llegada fuera de orden.** Misma `id`, ediciones divergentes en A
y B. A tiene el `updatedAt` mayor, pero B —la más antigua— llega última al
backend. Tras un número **máximo explícito de rondas** de sync, los tres —A, B y
backend— conservan la versión de A. El tope de rondas es parte del caso: sin él,
un harness que nunca converge se vería como un test colgado en vez de un fallo.

**Caso de empate de timestamps.** La primera entrega lo caracterizó como defecto:
dos contenidos distintos con el mismo `updatedAt` no entraban en ninguna rama
del merge y quedaban divergentes indefinidamente. Esa caracterización se puso
roja al aplicar el cambio productivo aprobado por separado y luego se invirtió a
convergencia.

La regla actual usa el backend como autoridad estable ante igualdad. La última
versión aceptada remotamente gana tanto en `runFullSync` como en los dos pulls
acotados de sesiones. El caso fija quién ganó en A, B y backend tras un máximo
explícito de rondas; ya no acepta la divergencia como resultado esperado.

## 5. Traza observable

Converger no demuestra que se ejercitó el camino que nos importa: dos clientes
pueden coincidir sin que jamás ocurriera un conflicto.

El doble expone una traza de operaciones, y los casos afirman sobre ella:

- que ocurrió el `23505`;
- que hubo un `select` por clave natural;
- que hubo un update condicional y, si correspondía, su recheck.

Un caso que converge **sin** esas marcas es un caso que no probó
`reconcileNaturalKeyConflict`, y debe fallar.

## 6. Flujo de un caso

```
backend = createFakePostgrest()

withDevice('A'): crear check-in del 12/08 → push
withDevice('B'): crear check-in del 12/08 → push        ← 23505
withDevice('B'): pull
withDevice('A'): pull

assertTrace({ conflicts: 1, naturalKeySelects: 1 })
assertConverged('A', 'B')
assertQueuesDrained()
assertNoScopeLeak()
```

## 7. Concurrencia lógica, no concurrencia real

Al alternar un único Dexie no puede haber operaciones de A y B **en vuelo a la
vez**. Lo que el harness reproduce es **concurrencia lógica desde snapshots
divergentes**: dos clientes que editaron a partir del mismo estado base y llegan
al backend en un orden controlado.

Eso cubre la clase de bug que importa aquí —resolución de conflictos, orden de
merge, resurrección— y no cubre carreras de verdad simultáneas. La concurrencia
de red real queda para la entrega contra Supabase.

Distinguir esto no es una formalidad: describir el harness como "concurrencia
real" invitaría a cerrar el riesgo de sync antes de tiempo.

## 8. Criterios de aceptación

- El doble falla ruidosamente ante una consulta no soportada, y hay un test que
  lo demuestra.
- Un caso de clave natural produce `23505`, lo reconcilia y converge, con traza
  afirmada.
- Un borrado en un dispositivo no resucita al sincronizar el otro.
- Ninguna fila cruza de `athleteId` en ningún caso.
- La semana visible no muestra datos de otra semana durante un merge.
- Cero cambios de comportamiento en producción. Si snapshotear algún estado
  exigiera exponer un accessor nuevo desde un módulo de producción, se detiene y
  se acuerda antes de agregarlo: la premisa "sin tocar producción" no puede
  erosionarse en silencio dentro de la implementación.
- Suite completa, `tsc -b`, lint y build verdes.

## 9. Riesgo principal

La fidelidad del doble.

**Cómo se acota la superficie:** por grafo de llamadas, no barriendo las 4870
líneas de `syncService`. Los puntos de entrada son `pushSession`, `pushDayLog`,
`pushWeekSummary`, `deleteSession`, `pullSessionsForDateRange` y `runFullSync`,
más sus dependencias transitivas.

Con una salvedad medida: `runFullSync` lanza en paralelo los merges de **todas**
las tablas (`syncService.ts:3247-3252`), así que el doble necesita soportar la
**gramática genérica** para cualquier tabla —select, upsert, delete— aunque sólo
requiera **semántica profunda** (únicos compuestos, `onConflict`, update
condicional) para `sessions`, `day_logs` y `week_summaries`.

Mitigación: tests propios del doble y fail-fast ante lo no implementado. Si el
doble diverge del backend real, el harness da falsa confianza — por eso §3
declara explícitamente lo que no prueba.
