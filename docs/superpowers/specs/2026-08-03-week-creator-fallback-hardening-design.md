# Week Creator — endurecimiento del fallback determinista

Fecha: 2026-08-03
Estado: **implementado y verificado** (355 archivos / 2750 tests, typecheck,
lint, build y `git diff --check` verdes)
Alcance: un archivo (`src/services/weekCreator/WeekCreatorEngine.ts`) + un test.
Sin migraciones Dexie ni Supabase. Sin cambios de contrato ni de copy visible.

## 1. Problema

`buildDeterministicWeekCreatorResponse` se invoca en `WeekCreatorEngine.ts:582`,
**fuera** del `try/catch` del loop de reintentos (que abre en 258 y cierra en
503). Construye las sesiones de fuerza vía `fallbackStrengthExercise` →
`getStrengthExerciseIdentityById`, que **lanza deliberadamente** si el `id` no
existe en el catálogo (`exerciseLibrary.ts:1373`).

Si ese throw ocurriera, pasan tres cosas, ninguna deseada:

1. **Se pierde la semana degradada.** El fallback existe precisamente para que
   una falla del proveedor no deje al atleta sin nada. Un throw convierte el
   último recurso en una falla total.
2. **El usuario ve un string interno.** `useChatStore` sí atrapa
   (`useChatStore.ts:426`), pero `formatError` termina en
   `if (e instanceof Error) return e.message` (`useChatStore.ts:921`), así que
   el mensaje del coach en el chat sería literalmente
   `Ejercicio de fuerza inexistente: xyz`.
3. **Queda telemetría colgada.** `startRequest` ya se disparó en la línea 570.
   Si el build lanza, no corre ni `completeRequest` ni `failRequest`, y
   `fallbackTracker` nunca hace flush: `useAIDebugStore` conserva un request en
   vuelo indefinidamente.

### 1.1 Probabilidad real, dicha con honestidad

Baja, y este trabajo **no la baja más**. Dos tests independientes rompen en CI
antes de que un `id` faltante llegue a producción:

- `strengthCatalogIdPermanence.test.ts` congela los 77 ids del catálogo en una
  lista append-only.
- `strengthCopyProducerIdentity.test.ts:90` maneja `sendWeekCreate` hasta el
  fallback y verifica que **cada** ejercicio resuelva por `libraryRef` a una
  definición viva, con una config de 6 días elegida a propósito para ejercitar
  las dos variantes y cubrir las 14 filas literales.

Lo que cambia esta entrega es **qué pasa si ocurre igual**: hoy, degradación
fea; después, degradación instrumentada. Es defensa en profundidad, no el
cierre de un agujero abierto. El roadmap ya lo decía con precisión: «es CI lo
que lo previene, no el runtime».

## 2. Observación de diseño que ordena la solución

El camino «el fallback no sirvió» **ya está construido**, en la rama de
validación fallida (`WeekCreatorEngine.ts:604-618`):

```
failRequest({ errorCode: 'fallback_invalid', outcome: 'schema_invalid', … })
fallbackTracker.flush('invalid_schema', …)
throw new Error(`${failureMessage} Código de soporte: ${…}.`)
```

El throw del `id` inexistente no crea una situación nueva: **saltea una salida
que ya existe y está bien instrumentada.** La solución correcta no es «hacer
que no lance», es «que lance por el camino que ya existe».

## 3. Solución

Enfoque elegido: **extraer el cierre de falla del fallback a un helper local y
usarlo en las dos ramas** (la de validación existente y la nueva de build).

Descartados:

- *`try/catch` solo alrededor del build, con handler duplicado.* Deja dos copias
  de las ~13 líneas de telemetría, libres de divergir. Duplicar el bloque es una
  versión más chica del defecto original.
- *`try/catch` sobre build + validate juntos.* Pierde la distinción entre las dos
  causas y taparía una excepción inesperada del validador bajo un código que
  afirma «build failed».
- *Hacer que `getStrengthExerciseIdentityById` no lance.* Debilita la invariante
  fail-fast que hace útil al helper en CI, y toca los cuatro productores para
  resolver un problema de uno.

### 3.1 Límite exacto del `try`

**El `try` envuelve únicamente la llamada a
`buildDeterministicWeekCreatorResponse` (líneas 582-590).** La validación
(`validateWeekCreatorResponse`, 592-603) y su rama de fallo quedan
**deliberadamente fuera**, para que `fallback_invalid` conserve su significado
actual: «la semana se construyó pero no pasó validación». Meter la validación
dentro del mismo `try` colapsaría dos causas distintas.

`fallbackStage.end({ ok: true })` (línea 591) queda dentro del `try`, después de
la llamada: si el build lanza, la etapa no debe cerrarse como exitosa. El
`catch` cierra la etapa con `ok: false` antes de delegar en el helper.

### 3.2 Helper

```
failFallback({ errorCode, provider, model, extraWarnings }): never
```

No lleva parámetro de trace id: por la decisión de §3.5, **ambas** ramas
registran la fila bajo `fallbackTraceId` y **ambas** exponen ese mismo id como
código de soporte. `failureTraceId` viaja en los warnings para correlación
interna.

Responsabilidades, en orden:

1. `useAIDebugStore.getState().failRequest(fallbackTraceId, …)` — siempre bajo
   `fallbackTraceId`, en ambas ramas — con
   `outcome: 'schema_invalid'`, `fallbackUsed: true`,
   `durationMs: Date.now() - fallbackStartedAt`,
   `retryUsed: providerAttempts > 1`, `stageTimings: fallbackTracker.timings()`
   y `warnings: [buildWeekCreatorFallbackWarning(…), ...extraWarnings]`.
2. `fallbackTracker.flush('invalid_schema', { generationId, attempt: providerAttempts + 1 })`.
3. `throw new Error(...)` con el mensaje al usuario (§3.4).

La rama de validación existente pasa a llamarlo con
`errorCode: 'fallback_invalid'` y sin warnings extra — su comportamiento
observable no cambia. La rama nueva lo llama con
`errorCode: 'fallback_build_failed'`.

`provider`/`model` en el `failRequest`: la rama de validación los toma de
`fallback`, que en la rama de build **no existe** (la excepción impidió
construirlo). En la rama nueva se usa `lastFailure?.provider` y
`lastFailure?.model`, que es la información disponible y verdadera.

### 3.3 Códigos de error

| Situación | `errorCode` |
|---|---|
| La semana se construyó pero no validó (existente) | `fallback_invalid` |
| La construcción lanzó (nueva) | `fallback_build_failed` |

`errorCode` es `string` abierto (`src/types/index.ts:88`), así que el código
nuevo no toca ningún tipo ni unión cerrada.

### 3.4 Qué ve el usuario y qué ve el operador

**Al usuario** llega únicamente
`` `${failureMessage} Código de soporte: ${traceId}.` `` — español, ya
construido por `buildWeekCreatorUserFailureMessage`. La causa cruda
(`Ejercicio de fuerza inexistente: xyz`) **nunca** entra al mensaje.

**Al operador**, la causa cruda llega por dos vías:

- `console.warn('[WeekCreatorEngine] fallback build failed', { traceId, cause })`
  en el `catch`, antes de delegar en el helper.
- El arreglo `warnings` del `failRequest`, vía `extraWarnings`, para que quede
  en la fila de telemetría y no solo en la consola.

### 3.5 Trace id del código de soporte — resuelto

Había una **inconsistencia preexistente** en la rama de validación: registraba
la telemetría bajo `fallbackTraceId` pero lanzaba el mensaje con
`failureTraceId`, el trace del fallo del *proveedor*. El código de soporte que
recibía el usuario no apuntaba a la fila que registraba su error.

**Decisión del owner (2026-08-03): se corrige también la rama existente.** El
código de soporte visible debe apuntar siempre a la fila que registra el fallo
final, así que las dos ramas usan `fallbackTraceId`.

`failureTraceId` no se pierde: se conserva para correlación interna como
warning `Provider failure trace: <id>` en la fila de telemetría, presente en
ambas ramas. Así se puede saltar del fallo final al intento del proveedor que
lo originó sin exponer dos códigos al usuario.

Esto es un cambio de comportamiento observable en la rama de validación,
aprobado explícitamente y fuera del default conservador que este diseño
proponía en su primera versión.

## 4. Qué explícitamente no cambia

- `getStrengthExerciseIdentityById` sigue lanzando. La invariante fail-fast se
  conserva intacta: es lo que la hace útil como gate de CI.
- Los otros tres productores deterministas (`makeCoreExercise` y las tres filas
  de footwork en `strengthSessionStructure.ts`) no se tocan. Corren dentro del
  `try/catch` de sus propios loops, donde el throw sí se contabiliza como
  intento fallido.
- Ningún contrato, tipo, migración, prompt ni copy visible nuevo. El mensaje al
  usuario reutiliza el existente.

## 5. Testing (TDD — el test se escribe primero y debe fallar)

Un test nuevo que fuerza el throw haciendo que un `id` del fallback no resuelva
en el catálogo, y verifica cuatro cosas:

1. **El error que llega al caller expone solo `failureMessage` +
   `fallbackTraceId`.** Assert positivo sobre el formato esperado y assert
   **negativo** explícito de que el mensaje **no** contiene la causa cruda
   (`Ejercicio de fuerza inexistente`).
2. **`console.warn` recibe la causa cruda**, con el trace id.
3. **La telemetría contiene la causa cruda y el código nuevo.**
   `useAIDebugStore` registra `errorCode: 'fallback_build_failed'`, sus
   `warnings` incluyen la causa, y **no queda ningún request en vuelo** — que es
   el defecto de la línea 570.
4. **Regresión del camino feliz.** El fallback sano sigue devolviendo una semana
   degradada con `fallbackUsed: true` y no registra `fallback_build_failed`.

Y un bloque **espejo** que fuerza `fallback_invalid` —rechazando la validación
solo de la semana ya construida, identificada por su
`model: 'local-week-fallback'`— y verifica que esa rama cumple el mismo
contrato: código de soporte igual al `traceId` de su fila de telemetría, trace
del proveedor presente en los warnings para correlación, y ningún request en
vuelo.

Verificación de cierre: `npm run lint && npm test && npm run build`.

## 6. Referencias

- `src/services/weekCreator/WeekCreatorEngine.ts:556-645` — bloque del fallback.
- `src/services/weekCreator/WeekCreatorEngine.ts:1349-1360` —
  `fallbackStrengthExercise`.
- `src/services/training/exerciseLibrary.ts:1369-1379` —
  `getStrengthExerciseIdentityById` y su throw deliberado.
- `src/store/useChatStore.ts:426`, `:900-922` — captura y `formatError`.
- `src/services/training/__tests__/strengthCopyProducerIdentity.test.ts:90` —
  cobertura existente del fallback.
- `PROJECT_REVIEW_AND_ROADMAP.md` §20 — «Riesgo latente documentado».
