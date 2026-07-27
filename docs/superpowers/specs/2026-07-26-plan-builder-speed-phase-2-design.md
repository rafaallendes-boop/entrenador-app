# Spec — Plan Builder velocidad, Fase 2: baseline controlado en Sonnet 4.6

**Fecha:** 2026-07-26
**Estado:** propuesto, pendiente de aprobación
**Origen:** `docs/superpowers/2026-07-23-plan-builder-latency-handoff.md`, Parte 3, Fase 2
**Habilitado por:** Fase 0 de medición (`016`, `quality_version = 2`, loadtest con control congelado)

**Alcance:** hacer configurables `effort` y `thinking` en el Plan Builder, medir
`medium` y `low` contra un control contemporáneo, y decidir con una regla
declarada antes de mirar los datos.

**Fuera de alcance, explícito:** Sonnet 5 (Fase 3), concurrencia y arquitectura
de generación (Fase 4), prompt caching, bajar el cap de 5.000, y los bugs de
producto de la Fase 1.

---

## 1. Por qué esta fase existe

El Plan Builder **no manda `output_config.effort`**, y Sonnet 4.6 lo toma como
`high` por defecto. Anthropic documenta ese default como trampa de migración
precisamente por su costo en latencia y tokens. Es la palanca más barata de
probar y la única que no toca prompt, schema, modelo ni orquestación.

La Fase 0 dejó todo lo necesario para medirlo: telemetría por corrida
(`plan_generation_jobs`), `quality_version = 2` productiva, y un loadtest que
corre `runAsyncPlanGeneration` contra el proveedor real sobre un manifest
sintético congelado. Para una ventana experimental completa la telemetría estimó
**US$0,92** a partir del uso observado —no facturación—, en lugar de días de
generación deliberada contra el rate limit del owner.

## 2. Evidencia verificada

Todo lo de esta sección está confirmado contra el código en el árbol al
2026-07-26.

### 2.1 Configuración productiva actual

| Parámetro | Valor | Fuente |
|---|---|---|
| Modelo | `claude-sonnet-4-6` | `planBuilderRunConfig.ts` |
| `temperature` | `0.25` (incondicional) | `buildClaudeBody()`, `DEFAULT_TEMPERATURE` |
| `max_tokens` | `5000` | `DEFAULT_MAX_TOKENS` |
| `output_config.effort` | **no se envía** → `high` | `buildClaudeBody()` |
| `thinking` | **no se envía** → apagado en 4.6 | `buildClaudeBody()` |
| Concurrencia | 3 | `DEFAULT_CONCURRENCY` |

`resolveEffectivePlanBuilderConfig` devuelve hoy `effort: 'omitted'` y
`thinkingMode: 'omitted'` con un comentario que anticipa exactamente este
cambio: *"cambiarlos aquí (y en el caller) mantiene la telemetría fiel sin tocar
dos lugares"*.

### 2.2 El control histórico no sirve como comparator de score

`docs/superpowers/calibrations/plan-builder-v2-control-2026-07-25.json` se
generó con **`quality_version = 1`** (`variant_id s46-q1-01bxcrr9`), lo dice su
README y lo fija `QUALITY_V2_CONTROL.controlGenerationVariantId`. El flip a v2
ocurrió después.

`repairPenalty` cambia de divisor entre v1 y v2 dentro de `scoreWeek()` y
`scorePlan()` (`qualityReview.ts`), así que **`planScore` de ese artefacto y
`planScore` de una corrida q2 no viven en la misma escala**, y el artefacto
sanitizado no conserva contenido suficiente para recalcular el score
retrospectivamente.

El control histórico conserva su rol de **procedencia de calibración** y pierde
el de comparator experimental.

### 2.3 Cambiar `effort` no invalida la calibración congelada

Riesgo descartado explícitamente: el guard de procedencia recomputa el
fingerprint **desde el artefacto histórico**
(`qualityCalibrationV2.test.ts`, caso "matches the control descriptor"), no desde la configuración viva. Mover
`effort` en producción cambia el `variant_id` y el `requestFingerprint` de las
corridas nuevas, y no toca la constante congelada.

### 2.4 Método estadístico ya congelado

`percentile()` es **nearest-rank** (`ceil(p·n)`, sin interpolar), congelado en el
spec de la Fase 0 porque comparar variantes con métodos distintos produce
diferencias que no existen. Esta fase no lo cambia; sí **describe honestamente
qué significa cada percentil al n que le toca** (§3.6).

Las tres distribuciones de reparación del reporte (`repairBlock()` en `report.mjs`):

| Distribución | Unidad | n |
|---|---|---:|
| `weekCountRepairsV2` | semana puntuable | 42 |
| `weekWarningInput` (corrective+structural) | semana puntuable | 42 |
| `planCountRepairsV2` | plan completo | **12** |

---

## 3. Diseño

### 3.1 Punto de cambio y la invariante que protege

Dos archivos:

- `netlify/functions/_shared/planBuilderRunConfig.ts` — resuelve la config
  efectiva desde el entorno.
- `netlify/functions/_shared/anthropicCaller.ts` — `buildClaudeBody()` la envía.

**Invariante dura, heredada de la Fase 0:** una `variant_id` que dice
`effort=medium` implica que la request mandó `medium`. El descriptor de
telemetría y el body de la request salen de **la misma resolución**, y un test
lo fija. Es la única defensa contra una ventana experimental que mide una cosa y
reporta otra — el modo de falla que ya mordió con `serviceTier` en week_creator.

Se descarta hilar la variante como parámetro explícito por
`runAsyncPlanGeneration`: duplicaría la resolución y reabriría esa divergencia.

### 3.2 Resolución de entorno — tres estados

Dos variables, `PLAN_BUILDER_EFFORT` y `PLAN_BUILDER_THINKING`, con la misma
semántica:

| Estado | Comportamiento | Descriptor |
|---|---|---|
| Ausente | No se envía el parámetro | `'omitted'` |
| Presente y válido para el modelo | Se envía | El valor |
| Presente e **inválido o incompatible con el modelo** | **Error de configuración antes del primer request pagado** | — |

El tercer estado es deliberado y reemplaza un diseño anterior de "inválido →
`omitted`". Ese fallback mantenía descriptor y body coherentes, pero **no era
fail-closed**: un typo en `medium` convertía silenciosamente una corrida pagada
en otro control `high`, y el artefacto lo reportaría como tal sin que nadie
notara que la variante nunca se probó.

Allowlist por modelo:

| Modelo | `effort` | `thinking` |
|---|---|---|
| `claude-sonnet-4-6` | `low`, `medium`, `high`, `max` | `disabled` |

Sonnet 4.6 **no** acepta `xhigh` (llegó con Opus 4.7). Rechazarlo localmente
evita que un 400 del proveedor mate una corrida a mitad de camino.

**`adaptive` queda fuera de alcance y se rechaza como error local.** No es una
restricción de la API sino de **este camino**: el caller manda
`temperature: 0.25` incondicionalmente y la interacción entre thinking activo y
sampling no-default **no está resuelta** para Sonnet 4.6 en esta base de código.
Habilitarlo requeriría resolver temperatura primero y verificar el resto del
contrato estructurado (`tool_choice` forzado, cap de `max_tokens` como techo de
thinking + respuesta). La campaña solo necesita `disabled`, así que la
combinación no verificada no entra a un camino pagado. Cuando se resuelva —
probablemente junto con la Fase 3, que ya debe omitir temperatura— la allowlist
gana una fila.

> **Advertencia sobre la Fase 3.** Esta tabla **no** vuelve la migración a
> Sonnet 5 "un renglón más". El caller manda `temperature: 0.25`
> incondicionalmente y Sonnet 5 rechaza sampling no-default con 400, así que esa
> fase tendrá que omitir temperatura además de resolver `thinking` y `effort`.
> Queda anotado como deuda conocida, no como beneficio de este diseño.

El `variant_id` no cambia de formato: `effort` y `thinking_mode` ya son columnas
propias en `plan_generation_jobs` y `plan_generation_attempts`, así que son
legibles sin parsear el slug.

### 3.3 `thinking` explícito y por qué no contamina la atribución

La campaña cambia dos dimensiones a la vez —`effort` y la declaración de
`thinking`— lo cual normalmente rompe la atribución causal. Es seguro acá, y se
declara como supuesto verificado en vez de asumirse en silencio:

**En Sonnet 4.6, omitir `thinking` significa apagado.** Enviar
`{type: 'disabled'}` explícito es un no-op conductual: cambia el `variant_id`
sin cambiar el comportamiento. Elimina la trampa de migración de cara a la
Fase 3 y vuelve el descriptor honesto (`thinkingMode: 'disabled'` en lugar de
`'omitted'`).

Si esta premisa resultara falsa, la campaña entera pierde atribución. Por eso el
control **C** de §3.4 también corre con `thinking: disabled` explícito: dentro de
la campaña, `thinking` es constante y `effort` es la única variable.

### 3.4 Campaña de medición

Tres corridas, **todas sobre el mismo commit limpio**, mismo manifest congelado
(6 escenarios × 2 planes / 42 semanas), `quality_version = 2`:

| Corrida | Quality | `effort` | `thinking` | Rol |
|---|---:|---|---|---|
| **C** | q2 | `high` explícito | `disabled` | Control contemporáneo |
| **A** | q2 | `medium` | `disabled` | Variante |
| **B** | q2 | `low` | `disabled` | Variante |

`high` explícito es conductualmente idéntico al default productivo (omitir
`effort`), así que **C reproduce producción dejando una sola dimensión variable
frente a A y B**.

Todo lo demás queda fijo y se verifica en el artefacto: modelo, prompt version,
schema version, temperatura, `max_tokens`, concurrencia, manifest y SHA de git.

Costo esperado ≈**US$2,8** (3 × los US$0,92 que la telemetría estimó para el
control); techo US$3,7 si bajar `effort` no reduce el consumo.

Los tres artefactos, sus SHA-256 y el reporte con el veredicto se versionan en
**`docs/superpowers/experiments/plan-builder-speed-phase-2/`** — **no** en
`calibrations/`, cuya regla de admisión es explícita: ahí solo entran artefactos
que respaldan una **constante de calibración**. C/A/B respaldan una decisión
experimental y no calibran ninguna constante.

### 3.5 Comparación pareada (`--compare`)

`--report` hoy lee un artefacto. Se agrega `--compare <control> <variante>`,
igualmente **puro y sin credenciales**.

Empareja **por `caseId`** y reporta ratios y deltas plan a plan. Nunca compara
agregados entre sí: el propio reporte ya razona este punto para
`firstWeekDetectionLagMs` (comentario de cabecera de `report.mjs`), donde restar medianas daba el
máximo de la distribución y no su centro. Esta fase aplica el mismo principio a
toda la campaña.

Campos del reporte, todos ya allowlisteados en `toPlanRow`:

- Latencia: `firstWeekReadyMs`, `firstWeekReadyE2eMs`, `planCompleteMs`.
- Calidad: `planScore`, `planGrade`, `issueCodes`, las tres distribuciones de
  reparación.
- Costo y consumo: `estimatedCostUsd`, `totalInputTokens`, `totalOutputTokens`.
- Integridad de la corrida: `retryCount`, `fallbackUsed`, `observedModels`,
  `outcome`, `errorClass`.

Salida agregada **y** por escenario: la consistencia entre escenarios es
evidencia descriptiva que se reporta **en ausencia** de una estimación de ruido,
no un sustituto de ella (§3.6).

### 3.6 Regla de decisión — congelada antes de medir

Se declara acá, antes de la primera corrida. Un criterio elegido después de ver
los datos no es un criterio.

Una variante se acepta si **todo** se cumple:

**Integridad**
- Mismo manifest, commit limpio, `quality_version = 2`, y modelo, prompt,
  schema, temperatura, `max_tokens` y concurrencia idénticos al control. Solo
  varía `effort`.

**Completitud**
- 12/12 planes completos, 42/42 semanas objetivo, cero fallos de harness, cero
  fallbacks, y **`observedModels` de cada plan igual exactamente al modelo
  declarado** (un swap silencioso de modelo invalidaría la comparación entera).

> **Dos gates distintos, deliberadamente.** `evaluateAcceptance()` responde
> *"¿el artefacto es estructuralmente utilizable?"* y es más laxo a propósito:
> admite `MIN_COMPLETE_PLANS = 10`, `scorableWeeks` en `[30, 50]`, y **no evalúa
> `fallbackUsed`** aunque lo registre. Era el criterio correcto para la
> calibración original.
>
> Esta fase agrega `evaluatePhase2Variant()`, que responde *"¿esta corrida es
> elegible como evidencia de Fase 2?"* con el gate estricto de arriba. Una
> corrida puede estar **aceptada** y **no ser elegible**; el reporte debe decir
> cuál de las dos cosas falló. Sin esta separación, "corrida aceptada" tendría
> dos significados silenciosos.

**Primera semana** (métrica: `firstWeekReadyMs`; ratio pareado = variante/control por `caseId`)
- Mediana de los 12 ratios pareados **≤ 0,80**.
- **≥10 de 12** casos con ratio **< 1**.
- Mejora en **≥5 de 6** escenarios, donde *"escenario mejora"* significa que el
  **promedio de sus dos ratios pareados es < 1**. No se usa p50 nearest-rank
  con n=2: elegiría simplemente el menor de los dos ratios y declararía mejora
  con un solo caso favorable.

**Plan completo**
- Mediana de los 12 ratios pareados de `planCompleteMs` **≤ 1,10** (no empeora
  más de 10%).

**Calidad**
- Mediana de Δscore pareado **≥ −2**.
- Mínimo de Δscore pareado **≥ −5**. Es una protección deliberadamente **más
  fuerte** que un p10 —no equivalente— elegida para impedir una regresión severa
  aislada que la mediana escondería.

**Reparaciones** — pareadas, igual que el resto. No se restan percentiles de dos
distribuciones distintas: se empareja primero y se resume la distribución de
**diferencias**.

- Semanales (`weekCountRepairsV2`, `weekWarningInput`): emparejar por
  **`(caseId, weekIndex)`**, calcular Δ = variante − control por semana (n=42), y
  exigir **p50 Δ ≤ 0** y **p90 Δ ≤ 0**.
- Por plan (`planCountRepairsV2`): emparejar por **`caseId`**, calcular Δ del
  total por plan (n=12), y exigir **p50 Δ ≤ 0** y **segundo peor Δ ≤ 0**. Con
  nearest-rank y n=12 el p90 *es* el segundo peor; se nombra por lo que mide.

**Desempate**
- Si A y B pasan, gana la de menor primera-semana pareada; costo total como
  segundo criterio.

**Sobre el ruido.** Con un solo C **no hay estimación de varianza
corrida-a-corrida**, y esta fase no la produce. Los criterios de consistencia
(10/12 casos, 5/6 escenarios) **aportan evidencia descriptiva en ausencia de esa
estimación**: no la reemplazan ni la aproximan. El spec y el reporte no afirman
que ningún efecto supere el ruido. La dispersión entre escenarios mide que
`dobles`, `running` y `semana_parcial` son cargas distintas, no ruido de
medición. Cuantificar el ruido requeriría repetir C, y está fuera de alcance.

**Resultado nulo.** Si ninguna variante pasa, la fase cierra con *"`high` se
queda"*. Es un resultado válido y se documenta como tal: la fase existía para
decidir con datos, no para justificar un cambio.

### 3.7 Rollout

El default del código sigue siendo `omitted`: sin env var, producción no cambia.

Runbook, en orden:

1. Poner `PLAN_BUILDER_EFFORT` (y `PLAN_BUILDER_THINKING`) en Netlify.
2. **Desplegar.** Netlify congela los valores de las variables de entorno en cada
   deploy; un cambio de variable no aplica hasta el deploy siguiente. **No hay
   rollback sin deploy** — el rollback es quitar la variable y volver a desplegar.
3. Verificar una corrida real: el `variant_id` y las columnas `effort` /
   `thinking_mode` del job deben coincidir con lo configurado.
4. Seguir la distribución de `plan_score` de los primeros planes productivos. La
   telemetría de job ya los hace atribuibles por variante.

## 4. Testing

Sin migraciones: ni Dexie, ni Supabase, ni bump de backup.

- **Resolución de entorno:** ausente → `omitted`; válido → aplicado; inválido →
  error; incompatible con el modelo (`xhigh` en 4.6) → error;
  **`thinking=adaptive` → error** mientras siga fuera de alcance.
- **Acuerdo descriptor ↔ body:** para cada valor válido, lo que informa
  `resolveEffectivePlanBuilderConfig` es lo que `buildClaudeBody()` envía. Es el
  test que impide que una `variant_id` mienta.
- **Forma del body:** `output_config.effort` y `thinking` presentes solo cuando
  corresponde; el resto del body sin cambios.
- **`--compare`:** emparejado por `caseId` (planes) y `(caseId, weekIndex)`
  (semanas); artefactos con conjuntos de `caseId` distintos se rechazan en vez de
  compararse parcialmente; una semana sin contraparte se rechaza en vez de
  aparearse contra la vecina; pureza (sin red, sin credenciales).
- **`evaluatePhase2Variant()` es independiente de `evaluateAcceptance()`:** un
  artefacto con 10/12 planes o con `fallbackUsed` pasa la aceptación estructural
  y **falla** la elegibilidad de Fase 2, con razones distinguibles en la salida.
- **Gate de modelo:** un plan cuyo `observedModels` difiera del modelo declarado
  invalida la corrida.
- **Regla de decisión:** implementada como función pura y testeada con casos
  sintéticos en cada frontera (ratio 0,80 exacto, 9/12 vs 10/12, escenario con
  un solo caso favorable, Δscore mínimo −5 exacto, Δ de reparaciones = 0 exacto).

## 5. Prerrequisitos operativos

1. **El árbol debe estar limpio.** `mergeGitState` vuelve la suciedad monotónica
   y `evaluateAcceptance` rechaza una corrida sucia. Al escribir este spec el
   árbol tiene cambios sin commitear (conversaciones del chat y tres documentos),
   así que la campaña arranca **después de que el owner commitee**. Los commits
   son del owner por regla del proyecto.
2. **Doble guard de la corrida pagada:** `LOADTEST_PLAN_BUILDER=1` +
   `CLAUDE_API_KEY`. `--report` y `--compare` no requieren ninguno.
3. Las tres corridas deben correr sobre el **mismo** SHA limpio; un cambio de
   commit a mitad de campaña invalida la comparación.
4. **No versionar ningún artefacto hasta que termine la campaña.** Las tres
   salidas se quedan en `loadtest-results/` —gitignored (`.gitignore:49`)—
   mientras dure. Copiar C a `docs/superpowers/experiments/` antes de correr A y
   B ensuciaría el árbol, y como `mergeGitState` vuelve la suciedad
   **monotónica**, A y B quedarían rechazadas sin forma de revertirlo salvo
   volver a correrlas. Recién con las tres terminadas se versionan juntas, con
   sus SHA-256 y el veredicto.

## 6. Riesgos y deuda conocida

| Riesgo | Mitigación |
|---|---|
| Sin repetición de C no hay estimación de ruido | La regla exige consistencia (10/12, 5/6) como evidencia descriptiva, y el spec no afirma significancia estadística |
| `thinking: adaptive` no verificado en este camino | Fuera de alcance y rechazado localmente; requiere resolver `temperature` antes de habilitarse (§3.2) |
| "Corrida aceptada" con dos significados | `evaluateAcceptance()` (estructural, 10/12 y sin veto de fallbacks) y `evaluatePhase2Variant()` (elegibilidad estricta) quedan separadas y con razones distinguibles |
| `thinking: disabled` explícito cambia dos dimensiones | Documentado como no-op conductual verificado en 4.6; C lo mantiene constante dentro de la campaña |
| Un typo en la env var quema una corrida pagada | Estado inválido → error de configuración antes del primer request |
| Fase 3 hereda `temperature: 0.25` incondicional | Anotado en §3.2; Sonnet 5 la rechaza y habrá que omitirla |
| Costo por semana del loadtest (US$0,022) ≠ producción (US$0,029) | Brecha no explicada; documentada en `OPTIMIZATION_AND_COSTS.md` §4 con la instrucción de no mezclar las dos cifras |

## 7. Criterios de salida

- [ ] `effort` y `thinking` configurables, con las tres reglas de validación y la
      allowlist por modelo (`adaptive` rechazado).
- [ ] Test de acuerdo descriptor ↔ body en verde.
- [ ] `--compare` implementado, puro y testeado, con emparejamiento por `caseId` y
      `(caseId, weekIndex)`.
- [ ] `evaluatePhase2Variant()` implementada aparte de `evaluateAcceptance()`, con
      razones distinguibles.
- [ ] Regla de decisión implementada como función pura y testeada en sus fronteras.
- [ ] Corridas C, A y B ejecutadas sobre el mismo commit limpio, aceptadas y
      elegibles, con sus artefactos y SHA-256 versionados en
      `docs/superpowers/experiments/plan-builder-speed-phase-2/`.
- [ ] Decisión aplicada mecánicamente sobre la salida de `--compare` y registrada
      —incluido un eventual "`high` se queda"—.
- [ ] Si hay ganadora: env var en Netlify, deploy, y `variant_id` verificado en
      una corrida real de producción.
