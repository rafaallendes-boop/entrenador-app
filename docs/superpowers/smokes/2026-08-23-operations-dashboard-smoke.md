# Smoke de cierre — Dashboard operacional Entrega A (§Pre-Lanzamiento punto 10)

Fecha: 2026-08-24 (QA de cierre; commit `839f665 "Operations dashboard entrega A"`,
rama `main`)

**Naturaleza de este smoke: verificación de código, suite y cierre parcial de
rollout.** Después de la QA estática se verificó directamente el despliegue de
producción con la sesión del owner: `/ops` cargó datos agregados reales y el
bloque de cuotas mostró `0`, no "sin datos". También se comprobó en Netlify que
`OPERATIONS_ADMIN_USER_IDS` está configurada sólo para Production con el UUID
del owner, y se publicó el deploy de `839f665`.

Esta QA:

1. contrasta el código real contra el plan `docs/superpowers/plans/2026-08-23-operations-dashboard-entrega-a.md`,
   task por task;
2. corre la verificación automatizada completa (`lint`, `test`, `tsc -b`,
   `build`, `git diff --check`);
3. cierra un hueco de cobertura de test real y barato (ver más abajo);
4. registra los cinco pasos de rollout que sí fueron observados, sin consumir
   API de IA ni modificar datos de producción.

**Revalidación en producción (2026-08-25, 16:11 CL).** Con la sesión del owner,
`/ops` respondió y mostró en la ventana de 7 días 2 cuentas con uso de IA, 3
requests de coach, 33,3% de error y US$0,0036 de costo total; las últimas 24 h
mostraron ceros, y las métricas sin muestra se rotularon “sin mediciones”. Es
una lectura de agregados solamente: no se generaron planes, no se invocó IA ni
se modificaron datos.

Al cierre original quedaron abiertos el chequeo SQL de privilegio de
`authenticated` sobre el RPC y el 403 con una segunda cuenta real. Ambos se
cerraron el 2026-08-25: el primero por query directo y el segundo mediante el
método equivalente documentado en el rollout.

## Veredicto por task del plan

| Task | Qué pide el plan | Estado real | Nota |
|---|---|---|---|
| 1. Contrato compartido | `operationsMetricsContract.ts` con `OPERATIONS_METRIC_KEYS`, tipos y `isOperationsWindow` | **Hecho, y ampliado** | El contrato final tiene **7** claves, no 5: se agregaron `totalCostUsd`/`totalCostCoverage` (suma de costo síncrono + Plan Builder asíncrono, con su propia cobertura) y un guard adicional `isOperationsMetrics` que valida el sobre completo (`last24h`/`last7d`/`generatedAt`) antes de que la UI lo use. Ninguna de las dos cosas está en el plan ni documentada en el roadmap más allá de la mención indirecta de §31 ("separa costo de IA síncrona, Plan Builder asíncrono y total"). Ver Hallazgo 1. |
| 2. Migración `022` + guard de drift | RPC `security definer`, sólo agregados, tolerante a `ai_usage_daily` ausente | **Hecho, y ampliado** | Coincide en la forma central (agregados únicamente, `count(distinct user_id)`, `to_regclass` para `ai_usage_daily`, `revoke`/`grant` a `service_role` solamente). Diverge del SQL literal del plan en tres puntos, todos con test propio: (a) `firstWeekP*`/`completeP*` pasan a medir **end-to-end desde `enqueued_at`** en vez de los timings internos del worker — más fiel a lo que un usuario espera ver, columnas reales de `016`; (b) `error_code` se trunca a 40 caracteres; (c) se agregan tres índices `btree(created_at desc)` sobre `coach_requests`/`plan_generation_jobs`/`plan_generation_attempts`, documentados en el propio SQL y en roadmap §31, sin `CONCURRENTLY` a propósito para que la migración siga siendo un único script manual. Verifiqué que el guard de "sólo `service_role`" **no es vacuo**: mutar `to service_role;` → `to authenticated;` hace fallar 2 de 9 tests; revertido, vuelve a pasar 9/9. |
| 3. Autorización (`isOperationsAdmin`) | Server-only, fail-closed, sólo UUID | **Hecho, coincide con el plan** | Incluye las dos correcciones que el propio plan ya documenta como aplicadas durante la ejecución (fixture `UUID_B` para case-insensitivity real, filtro `UUID_PATTERN` reconocido como defensa inobservable). |
| 4. Lectura del RPC con service role | `readOperationsMetrics`, 8s timeout, valida forma | **Hecho, y ampliado** | Agrega `OperationsMetricsError.diagnostics` (`upstreamStatus`/`upstreamBody`, truncado a 2000 chars) para que el log del servidor tenga contexto real sin que ese contenido cruce nunca al cliente — verificado por test explícito de que la causa cruda no llega al body. |
| 5. Función Netlify `operations-dashboard` | 401/403/405/200/500, causa cruda nunca al cliente | **Hecho** | Un matiz respecto al plan: el catch de `resolveAuthContext` en el plan mapea `error.statusCode ?? 401`; la implementación real mapea `error.statusCode === 401 ? 401 : 500`. Es **más correcto** que el plan — un fallo de config (`SUPABASE_URL no configurada`) o un timeout de `auth.v1/user` no trae `statusCode`, y el código real de `resolveAuthContext` (`netlify/functions/_shared/planGenerationShared.ts:63-99`) sólo adjunta `statusCode: 401` a los rechazos genuinos de sesión — pero ese camino **no tenía test** hasta esta QA (ver "Test agregado" abajo). |
| 6. Servicio de cliente `fetchOperationsMetrics` | Bearer de sesión, traduce 401/403/500 | **Hecho, y corregido respecto al plan** | El plan importaba `getSupabase` de un módulo `src/services/supabase.ts` que **no existe** en este repo; la implementación real usa `supabase` desde `src/services/auth.ts`, que sí existe. Además valida el payload completo con `isOperationsMetrics` antes de devolverlo — el plan hacía un cast ciego (`as OperationsMetrics`) sin validar, lo cual habría dejado pasar una respuesta 200 con forma inesperada directo a la UI. Es una corrección real sobre un hueco del plan. |
| 7. Página `/ops` y ruta | Sin guard de cliente, sin entrada de navegación, estados de carga/403/error | **Hecho, y ampliado** | `ROUTES.OPS` registrada, `lazy()`, sin referencias fuera de `App.tsx`/`routes.ts` (confirmado por grep). Agrega botón "Reintentar" para errores transitorios (no estaba en el plan). Distingue explícitamente "sin mediciones" (percentil sin muestras en la ventana) de "sin datos" (bloque de cuota ausente porque la tabla no existe) — el plan usaba "sin datos" para ambos casos, lo cual habría sido ambiguo justo en el criterio que el roadmap declaró crítico (`sin datos` vs `0` vs número). |

**Resumen:** las 7 tasks están implementadas y verificadas por test. Ninguna
desviación encontrada compromete los invariantes duros del plan (agregados
únicamente, server-only, fail-closed, cobertura de costo, nomenclatura de
métricas, sin guard de cliente). Los 36 checkboxes de ejecución del plan se
marcaron como completados en esta revisión, para que el plan vuelva a reflejar
el estado real y no parezca trabajo pendiente.

## Invariantes duros del spec/plan — verificación explícita

- **El RPC devuelve sólo agregados:** confirmado por lectura del `.sql` — cada
  bloque usa `count`, `count(distinct user_id)`, `percentile_cont`, `sum`;
  ningún `select` proyecta `user_id` ni filas. El guard de test
  `nunca selecciona user_id crudo` pasa y no es vacuo (falla si se reintroduce
  un `select user_id`).
- **`OPERATIONS_ADMIN_USER_IDS` es server-only:** vive únicamente en
  `netlify/functions/_shared/operationsAdmins.ts`, leído de `process.env`.
  `grep -rn "OPERATIONS_ADMIN_USER_IDS" src/` no devuelve nada — no hay ninguna
  variable `VITE_*` equivalente ni referencia desde el bundle de cliente.
- **Fail-closed:** `isOperationsAdmin` con env ausente, vacía o sólo
  separadores devuelve `false` (3 tests dedicados); un `userId` que no matchea
  el patrón UUID (incluido un email) nunca autoriza, ni figurando literal en la
  lista.
- **`estimated_cost_usd = null` no es cero:** las tres cobranzas (`coach`,
  `planBuilder`, `totalCostUsd`) usan `coalesce(sum(estimated_cost_usd), 0)`
  para el total pero calculan `coverage.rowsWithCost`/`tokensWithCost` con
  `filter (where estimated_cost_usd is not null)` por separado — la cobertura
  nunca se infiere del total, así que un total en `0` con cobertura `0/N` es
  distinguible de un total real en `0`.
- **Ninguna métrica se llama "usuarios activos":** verificado por grep sobre
  `OperationsPage.tsx` (no aparece la cadena) y por test explícito
  (`nunca rotula una métrica como usuarios activos`, incluyendo
  `screen.queryByText(/usuarios activos/i)).toBeNull()`).
- **La página `/ops` no tiene guard propio de cliente:** `OperationsPage.tsx`
  no importa ningún control de acceso local; el 403 llega como estado del
  fetch y se renderiza como mensaje, no como redirect. Confirmado por lectura
  del componente.
- **Guard de drift entre contrato y migración:** `operationsMetricsMigrationGuard.test.ts`
  recorre `OPERATIONS_METRIC_KEYS` y exige que cada clave aparezca literal en
  el `.sql`; un código nuevo en el contrato sin su contraparte en el RPC (o
  viceversa) rompe en CI. Extendido más allá del plan original con
  aserciones sobre las columnas de tokens correctas por tabla (`prompt_tokens`/
  `completion_tokens` en `coach_requests` vs `total_input_tokens`/
  `total_output_tokens` en `plan_generation_jobs`) y sobre las métricas E2E.

## Test agregado durante esta QA

**Hueco real encontrado:** `operationsDashboard.test.ts` sólo probaba el
rechazo de auth con `statusCode: 401` explícito (sesión ausente/expirada). El
código de producción (`operations-dashboard.ts`) también tiene una rama
distinta para cuando `resolveAuthContext` rechaza **sin** `statusCode` — que
ocurre de verdad si `SUPABASE_URL`/`SUPABASE_ANON_KEY` faltan en el entorno o
si el fetch a `auth.v1/user` hace timeout (`planGenerationShared.ts:63-73`,
ninguno de los dos adjunta `statusCode`). Esa rama debe devolver `500` con un
mensaje genérico, no `401`, y no debe filtrar el mensaje crudo del error. No
había ningún test que lo ejerciera; el comportamiento correcto ya estaba en el
código, sólo no estaba verificado.

Agregado en `netlify/functions/__tests__/operationsDashboard.test.ts`:

```ts
it('un fallo de auth sin statusCode 401 (config o timeout) devuelve 500, no 401, y no filtra la causa cruda', async () => {
  mocks.resolveAuthContext.mockRejectedValue(new Error('SUPABASE_URL no configurada.'))
  const response = await invoke()
  expect(response.statusCode).toBe(500)
  expect(response.body).not.toContain('SUPABASE_URL no configurada')
  expect(mocks.readOperationsMetrics).not.toHaveBeenCalled()
})
```

Corrido de forma aislada: **PASS** contra el código actual (sin cambios de
producción) — confirma que el comportamiento ya era correcto, ahora con
evidencia. `netlify/functions/__tests__/operationsDashboard.test.ts` pasó de
8 a 9 tests.

## Huecos de cobertura NO cerrados (con motivo)

- **Percentiles sobre muestra vacía** (`percentile_cont(...) within group`
  devolviendo `NULL` cuando no hay filas en la ventana): es comportamiento
  nativo de Postgres, documentado y no reproducible desde el guard de texto ni
  desde un test de Vitest sin una base Postgres real corriendo. El contrato
  (`latencyP50: number | null`, etc.) y la UI (`formatMs` → "sin mediciones")
  ya asumen `null` como caso válido, así que el tipo está protegido; lo que no
  se verificó es que Postgres realmente lo emita así en esta instancia
  concreta de producción.
- **Cobertura de costo parcial con datos reales mixtos** (algunas filas con
  `estimated_cost_usd` y otras `null` en la misma ventana): la aritmética SQL
  se leyó y es correcta (`filter (where estimated_cost_usd is not null)`
  aplicado de forma independiente al total), pero no hay manera de ejercitarla
  sin una base Postgres poblada — es el mismo límite que el punto anterior.
- **Comportamiento real de `ai_usage_daily` ausente vs. con filas** en un
  Postgres real: el `to_regclass` se leyó y su lógica es correcta, pero
  "ausente" y "con cero filas en la ventana pero tabla presente" sólo se
  distinguen de verdad corriendo contra la base real. El plan ya declara que
  hoy `021` está aplicada en producción, así que el camino "tabla ausente" no
  debería ejecutarse en absoluto ahí — eso lo confirma sólo el owner mirando
  el panel real (ver Rollout, punto 7).

Ninguno de estos tres es cerrable con más JavaScript: requieren una base
Postgres real para ejercitarse, que es exactamente la razón por la que el
plan documenta las migraciones como "de aplicación manual" y por la que el
punto 7 del rollout existe como paso explícito.

## Resultado de la verificación automatizada

Corrido en `/Users/rafaallendes/Projects/entrenador-app`, rama `main`, sobre el
árbol de trabajo (que además del test agregado por esta QA tiene cambios
preexistentes y **no relacionados** en `src/services/syncService.ts` /
`src/services/__tests__/syncService.test.ts` — ver nota abajo).

```
$ npm run lint
> eslint .
(sin salida — 0 errores, 0 warnings)

$ npx tsc -b
(sin salida — 0 errores)

$ npm test
 Test Files  458 passed (458)
      Tests  3746 passed (3746)
   Duration  109.36s

$ npm run build
✓ built in 1.66s
Generated metadata for 8 public routes (origin: https://app.rallyiq.cl)
(dist/assets/OperationsPage-BHZj62GH.js  7.39 kB │ gzip: 2.42 kB — chunk lazy propio, no infla el bundle principal)

$ git diff --check
(sin salida — exit 0)
```

Antes del test agregado, la suite ya estaba en 458 archivos / 3745 tests en
verde; con el test nuevo queda en 3746. Los 67 tests específicos de este
módulo (`src/services/operations/`, `netlify/functions/__tests__/operations*`,
`src/pages/__tests__/OperationsPage.test.tsx`) corren en 1.77s de forma
aislada y pasan 100%.

**Nota sobre el árbol de trabajo:** siguen cambios locales no commiteados de la
reparación de sync multidispositivo (`src/services/syncService.ts` y su test),
fuera del alcance de Entrega A. La prueba adicional de auth de
`operationsDashboard.test.ts` también mejora la cobertura de la Entrega A,
pero no formó parte de `839f665`; se incorpora en el commit de cierre de este
smoke. Ninguno de esos cambios modifica el dashboard desplegado; sí participaron
en la verificación del árbol actual.

## Hallazgos

### Hallazgo 1 — Deviaciones del plan no documentadas task por task (resuelto)

El contrato final (`totalCostUsd`/`totalCostCoverage`, `isOperationsMetrics`),
el cálculo E2E de latencias del Plan Builder, la truncación de `error_code` y
los tres índices nuevos son todos cambios reales y bien fundamentados respecto
al plan escrito — cada uno tiene su propio test y, en el caso de los índices,
está descrito en roadmap §31. Pero **el plan en sí no tiene ninguna nota de
"Corrección aplicada durante la ejecución" para estos cuatro cambios**, a
diferencia de Task 1, 2 y 3, que sí documentan sus correcciones inline. Esto
hace que alguien que audite sólo el plan (sin leer el código) subestime el
alcance real de lo implementado. No bloqueante porque el roadmap §31 sí cubre
la intención general ("separa costo de IA síncrona, Plan Builder asíncrono y
total"), pero la trazabilidad task-por-task del plan quedó incompleta.

**Corrección aplicada:** se agregó al inicio del plan una nota de ejecución que
enumera las cuatro desviaciones y referencia este smoke. Así el plan conserva
su intención original, pero también deja una pista auditable de lo que se
entregó realmente.

### Hallazgo 2 — Checkboxes del plan sin marcar (resuelto)

Las 36 casillas de ejecución `- [ ]` del plan seguían sin tildar pese a que las 7 tasks
están implementadas, testeadas y commiteadas. No afecta la corrección del código;
sólo dificulta auditar el plan como fuente de verdad de "qué falta" — alguien
que abra el archivo sin más contexto podría asumir que nada se hizo.

**Corrección aplicada:** las 36 casillas quedan tildadas. Ninguno de los dos
hallazgos bloquea el rollout ni el cierre de la Entrega A.

## Rollout — evidencia observada y controles aún pendientes

El §12 del spec y el bloque "Rollout" del plan piden 7 pasos. Se verificaron
directamente los pasos visibles desde Netlify y `/ops`; el control SQL de
privilegios fue ejecutado por el owner en producción el 2026-08-25. Marco
explícitamente cada uno:

| # | Paso | Estado |
|---|---|---|
| 1 | Aplicar `supabase/022_operations_metrics.sql` en producción | **VERIFICADO POR EFECTO EN PRODUCCIÓN.** `/ops` obtuvo métricas reales a través de `read_operations_metrics`; sin el RPC instalado la función no podría responder ese payload. |
| 2 | Confirmar `select has_function_privilege('authenticated', 'public.read_operations_metrics(timestamptz)', 'execute')` → `false` | **VERIFICADO (2026-08-25).** El owner ejecutó el query en el SQL editor de producción y obtuvo `false`. Confirma que `authenticated` no puede ejecutar el RPC aplicado; sólo `service_role` conserva ese permiso. |
| 3 | Setear `OPERATIONS_ADMIN_USER_IDS` en Netlify con el UUID del owner (no el email) | **VERIFICADO.** Se observó el UUID del owner como valor de la variable en el contexto Production; no se usó email ni una variable `VITE_*`. |
| 4 | Desplegar | **VERIFICADO.** Se publicó el deploy de `839f665`; Netlify construyó las 11 funciones y quedó live. |
| 5 | Abrir `/ops` con la cuenta del owner y verificar datos reales | **VERIFICADO.** El panel cargó datos reales de la ventana de 7 días (cuentas con uso de IA, requests de coach, tasa de error, percentiles, costos, tokens y código de error agregado), no sólo el estado vacío. |
| 6 | Abrir `/ops` con una segunda cuenta y verificar 403 ("Esta vista no está disponible para tu cuenta") | **VERIFICADO POR MÉTODO EQUIVALENTE (2026-08-25).** No existe una segunda cuenta real: el owner es hoy el único usuario. Se verificó el mismo predicado quitando su UUID de `OPERATIONS_ADMIN_USER_IDS`, redesplegando, comprobando que su propia cuenta recibe el 403, y reponiendo el valor. Ejercita exactamente la rama `isOperationsAdmin(userId) === false` — lo que **no** cubre es que dos UUID distintos se distingan entre sí, que es lo que una segunda cuenta habría demostrado. |
| 7 | Confirmar que el bloque de cuotas **no** dice "sin datos" (debe mostrar números o ceros, porque `021` ya está aplicada) | **VERIFICADO.** Mostró `0`, no "sin datos"; confirma que el RPC de producción ve `ai_usage_daily` y distingue correctamente tabla presente sin uso de tabla ausente. |

**Los siete pasos quedan cerrados** (seis por evidencia directa y el paso 6
por método equivalente el 2026-08-25). El query de privilegios, que era el
último control abierto, devolvió `false` en la base de producción.

### Hallazgo operativo — la allowlist no es intercambiable en caliente

Al cerrar el paso 6 apareció algo que ningún paso del plan preveía: **cambiar
`OPERATIONS_ADMIN_USER_IDS` no surte efecto hasta un redeploy.** El código no
cachea —`isOperationsAdmin` (`netlify/functions/_shared/operationsAdmins.ts:20`)
lee `env['OPERATIONS_ADMIN_USER_IDS']` en cada invocación—, así que la
retención es de Netlify, que fija las variables al publicar y no las propaga a
un deploy ya publicado.

Consecuencia para respuesta a incidentes: **revocar el acceso al panel no es
inmediato.** Borrar o editar la variable no basta; hay que redesplegar para
que el cambio llegue a las funciones vivas. Si alguna vez hace falta cortar
acceso con urgencia, el camino rápido es redesplegar, no editar la variable y
esperar.

## Resultado

- Código de la Entrega A: **7/7 tasks implementadas y verificadas por test**,
  con desviaciones documentadas arriba, todas hacia más cobertura/precisión que
  el plan original, ninguna hacia menos.
- Verificación automatizada de la QA original: **lint, test (458 archivos /
  3746 tests), `tsc -b`, build y `git diff --check` — todo verde**.
  Revalidación posterior de esta revisión: **458 archivos / 3747 tests**
  pasaron. El test nuevo de auth se incluye en el commit de cierre; el dashboard
  desplegado ya era correcto, pero ese test evita una regresión futura.
- Guard de "sólo `service_role`" verificado como no-vacuo por mutación
  controlada y revertida.
- **Veredicto: APROBADO Y DESPLEGADO — smoke de rollout 7/7 cerrado.** Código,
  configuración, privilegios del RPC y flujo del owner están verificados; el
  panel devuelve datos reales y el bloque de cuotas ve `ai_usage_daily`.
  El 403 se ejercitó mediante el método equivalente documentado arriba; sólo
  una futura segunda cuenta permitiría comprobar además la distinción entre
  dos UUID reales.
