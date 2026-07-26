# Plan Builder — Loadtest, calibración y activación de quality v2

Fecha: 2026-07-25
Estado: aprobado, sin implementar
Fase: cierre de la Fase 0 de medición (Plan 3)

Spec padre: `docs/superpowers/specs/2026-07-23-plan-builder-measurement-foundation.md`.
Este documento ejecuta §3.6 (loadtest), §5.3 (umbral) y §3.3 (activación de v2) de ese spec.
**§3.4 (instrumentación cross-week) queda explícitamente diferido a Fase 4:** no participa de
`countRepairsV2` ni del scoring, y su razón de ser es comparar estrategias de concurrencia.

---

## 1. Por qué esta fase existe

Plan 1 dejó la taxonomía de reparación y `countRepairsV2`. Plan 2 dejó la telemetría a nivel
corrida y `016` aplicada en producción. Falta lo que convierte esa instrumentación en una
decisión: una distribución de control medida, un umbral congelado contra ella, y la versión 2
del scoring efectivamente activa.

Hoy v2 está a medio activar de una forma que es fácil confundir con "listo":

- `PRODUCTIVE_QUALITY_VERSION = 1`.
- La penalización por reparación de v2 está cableada a `0` en `scoreWeek`/`scorePlan`.
- El warning `quality.generation.high_repair_count` está deshabilitado para v2.
- **Nada escribe `generationMeta.qualityVersion`**, así que `resolveQualityVersion` no puede
  inferir 2 por su cuenta y ningún caller pasa `context.qualityVersion`.

La consecuencia práctica de la última línea es el hallazgo que ordena esta fase: **cambiar la
constante a 2 no cambiaría ningún score**. Solo cambiaría la etiqueta de la telemetría, y la
telemetría mentiría sobre qué versión puntuó. Activar v2 requiere decidir y cablear cuándo una
semana queda marcada como v2, no solo mover una constante.

---

## 2. Evidencia verificada

Todo lo que sigue fue confirmado leyendo el código en `main` a la fecha del spec.

### 2.1 El scoring de v2 está desactivado, no calibrado

`qualityReview.ts:651` y `:670`: `repairPenalty = qualityVersion === 1 ? … : 0`. La v2 no
penaliza reparación en absoluto. Heredar los divisores de v1 (`/2` semana, `/8` plan) sobre
`countRepairsV2` no tendría sentido: v1 divide `repairedSessionCount` (suma de 30 sitios) y v2
suma `corrective + structural + moved + dropped`, otra magnitud.

### 2.2 El warning tiene su propio problema de magnitud

`qualityReview.ts:448`: `repairWarningEnabled = qualityVersion === 1`, y el umbral literal es
`repaired >= 8`. Pero `repaired` en v2 es `correctiveActionCount + structuralActionCount`
(`:425-428`), **no** `countRepairsV2` — no incluye `moved` ni `dropped`. Son dos métricas
distintas y necesitan dos calibraciones distintas.

### 2.3 `generationMeta.qualityVersion` no se escribe en ningún lado

El campo existe (`types/planBuilder.ts:70`). El único `qualityVersion:` del loop
(`asyncGenerationLoop.ts:1064`) alimenta la fila de **attempt**, no la semana.
`resolveQualityVersion` (`qualityReview.ts:727`) devuelve 2 solo si toda semana tiene
`repairTaxonomyVersion === 2` **y** `qualityVersion === 2`; sin escritor, esa segunda condición
nunca se cumple.

### 2.4 `variant_id` embebe la versión de calidad

`telemetryVersions.ts:56` construye `${modelToken}-q${qualityVersion}-${hash}`. El control se
corre **antes** del flip, así que su `variant_id` será `…-q1-…` y el de producción posterior
será `…-q2-…`. Un guard que exija igualdad de `variant_id` entre calibración y producción es
insatisfacible por construcción.

### 2.5 `loadtest-results/` está gitignoreado

`.gitignore:49`. Una constante de calibración que cite una ruta y un hash de ese directorio no
es verificable desde otro checkout.

### 2.6 El repo ya sabe cargar TypeScript desde un driver Node

`scripts/loadtest-week-creator.mjs:205` levanta un dev server de Vite en middleware mode y usa
`vite.ssrLoadModule('/src/…')`. No hace falta `tsx` ni un driver vitest para importar
`runAsyncPlanGeneration` desde `.mjs`.

### 2.7 La secuencia real del poller

`pollPlanGeneration.ts:190-200`: consulta primero y **después** duerme `DEFAULT_INTERVAL_MS`
(4s, `:25`, privado al módulo). El lag de descubrimiento va de ~0 a 4s más la latencia de
lectura.

---

## 3. Qué se construye

Dos entregas, con una corrida pagada del owner entre medio.

### Entrega 1 — Driver de loadtest y reporte de distribuciones

#### 3.1 Forma del driver

Sigue el par que ya existe para Week Creator:

- `scripts/loadtest-plan-builder.mjs` — driver pagado standalone. Carga
  `runAsyncPlanGeneration` y `callAnthropicForWeek` vía `vite.ssrLoadModule`.
- `scripts/loadtest-plan-builder.test.js` — tests rápidos y **sin llamadas reales** de la
  lógica pura exportada por el `.mjs`: manifest de escenarios, percentiles, sanitización,
  forma del artefacto y criterio de salida.
- `npm run loadtest:plan-builder` ejecuta **solo** el `.mjs`.
- El `.mjs` exige `LOADTEST_PLAN_BUILDER=1` y `CLAUDE_API_KEY`; sin ambas, sale con error
  antes de gastar un token.

El driver **no** puede ser un `.test.ts`: vitest lo descubriría en `npm test` aunque se
autoskipee, y heredaría el `testTimeout` global de 10s, incompatible con una corrida de varios
minutos.

#### 3.2 Aislamiento

Writer en memoria que implementa `AsyncPlanGenerationWriter` completo
(`getPlan`/`putPlan`/`putWeek`/`putAttempt`/`putJob`), guardando en RAM con marca de tiempo por
escritura. Sin Dexie y sin Supabase: **las corridas de loadtest no escriben en
`plan_generation_jobs` de producción**, que es la tabla contra la que después se miran los
datos reales.

#### 3.3 Matriz experimental congelada

12 planes, 2 por escenario, **ejecutados secuencialmente**. La concurrencia interna de semanas
queda en el valor productivo: paralelizar planes convertiría capacidad y rate limits en otra
variable.

| Escenario | Semanas por plan | Planes |
|---|---|---|
| squash build | 4 | 2 |
| squash taper / médico | 3 | 2 |
| running | 4 | 2 |
| ciclismo | 3 | 2 |
| dobles | 4 | 2 |
| semana parcial | 3 | 2 |

Eso da `attemptedPlans = 12` y `targetWeeks = 42`. **Intento y muestra aceptada no son lo
mismo**: un plan que falla o queda parcial no entra a la calibración.

- **Cohorte de calibración** = planes completos y sus semanas puntuables (con contadores de
  taxonomía reales; ni pending ni error).
- **Criterio de aceptación**, las cinco condiciones juntas:
  - `attemptedPlans === manifest.length === 12`;
  - `observedTargetWeeks === targetWeeks === 42`;
  - `completePlans >= 10`;
  - `scorableWeeks ∈ [30, 50]`;
  - **al menos un plan completo por escenario**, con los escenarios derivados del
    manifest embebido y no de las filas observadas.

Las dos primeras existen para que una interrupción no pueda aprobar un control que jamás
ejecutó los doce casos del manifest (6 escenarios × 2 planes): diez planes exitosos seguidos de
un corte pasarían el umbral de calidad sin haber cubierto la matriz. La quinta cierra el hueco
complementario: intentar los doce casos y perder los dos planes de un mismo escenario dejaba
10 completos y 34-36 semanas puntuables —todo dentro de rango— con un escenario entero sin
representar, que es justamente lo que la matriz de seis viene a evitar. Tolerar fallos del
proveedor no es lo mismo que tolerar una muestra sesgada, ni por casos nunca intentados ni por
escenarios que se perdieron enteros.

- Percentiles, caveat y registro de procedencia usan el **n real** de la corrida. Ningún 12 ni
  42 hardcodeado en el reporte, el artefacto ni la constante de calibración.

Los planes fallidos no se descartan: siguen en el artefacto y en las distribuciones de latencia
de "todos los intentos" (§3.4), porque un fallo es dato de latencia aunque no sea dato de
calidad.

Se congelan en un manifest versionado: orden de escenarios, fechas de inicio, fecha de
referencia de la semana parcial, número de semanas, perfil, restricciones y wizard config. El
artefacto embebe el manifest y el git SHA.

**Caveat obligatorio en el artefacto y en el reporte:** con n del orden de 10–12 planes, p95 y
p99 de plan son prácticamente el máximo observado. Sirve como baseline inicial conservadora, no
como p95 estable. Comparar variantes exige repetir exactamente el mismo manifest. El caveat se
emite con el n real, no con un número fijo.

Costo estimado: 42 semanas × (8k in / 1,5k out) ≈ **US$1,95**; techo ≈ **US$3,90** si todas las
semanas gastaran dos intentos.

#### 3.4 Métricas de latencia

El poller en memoria consulta el writer imitando la secuencia real (consulta inmediata, luego
`sleep`), y **arranca antes o simultáneamente** con `runAsyncPlanGeneration`. El intervalo no se
duplica: `DEFAULT_INTERVAL_MS` se extrae a un módulo puro
(`PLAN_GENERATION_POLL_INTERVAL_MS`) consumido por el cliente y por el driver.

Se guardan tres valores, no uno, **los tres medidos desde el mismo `workerStartedAt`**:

- `first_week_ready_ms` — desde worker start hasta la escritura de la primera semana lista.
- `first_week_detected_ms` — desde worker start hasta que el poller la descubre.
- `first_week_detection_lag_ms` = detected − ready, o `null` si nunca hubo semana lista.

Eso separa generación de la cuantización que introduce el polling. `first_week_visible_ms`
sigue reservado para una medición con UI real.

**Percentiles por plan (§3.6 del spec padre).** El plan es la unidad experimental, así que el
artefacto, la salida por consola y los criterios de salida incluyen p50 y p95 de cuatro
métricas: `first_week_ready_ms`, `first_week_detected_ms`, `plan_complete_ms` y `terminal_ms`.

Se reportan en **dos cohortes separadas**, nunca mezcladas:

- **Todos los intentos** (n = `attemptedPlans`) — incluye fallidos y parciales.
- **Planes completos** (n = `completePlans`) — la cohorte de calibración.

Los `null` (por ejemplo `plan_complete_ms` de una corrida que no completó) se excluyen del
cálculo y su cantidad se reporta junto al percentil; no se tratan como cero. El desglose por
semana es secundario y se emite aparte.

**Método de percentil congelado: nearest-rank** (`ceil(p × n)` sobre la muestra ordenada, sin
interpolación). Queda fijado en el spec porque comparar variantes con métodos distintos
produciría diferencias que no existen.

#### 3.5 Artefacto

`loadtest-results/plan-builder-<ISO>.json`. Contiene el descriptor de variante **completo**
(no solo `variant_id`) y los modelos realmente devueltos por los attempts: el alias solicitado
y el modelo observado pueden divergir.

Lleva `artifactSchemaVersion` en la raíz: el reporte y la constante de calibración lo leen, y
cambiar la forma sin versionarla rompería silenciosamente comparaciones entre corridas.

Por plan, como mínimo:

- escenario y número de semanas;
- outcome y conteos succeeded / failed;
- los cuatro timings de job (`first_week_ready_ms`, `first_week_ready_e2e_ms`,
  `plan_complete_ms`, `terminal_ms`) más `first_week_detected_ms` y el detection lag;
- tokens, costo estimado, retries y uso de fallback;
- quality version, score, grade y códigos de issues;
- contadores de taxonomía;
- modelos observados;
- tamaños de entrada y salida.

Y un `weeks[]` **con allowlist explícita** por semana, porque las distribuciones de §3.6 son
observaciones por semana y no se pueden derivar de los agregados por plan:

- `weekIndex`, escenario y estado final;
- `countRepairsV2` y los contadores que lo componen;
- `correctiveActionCount` y `structuralActionCount` por separado (el warning usa solo esos dos);
- `repairTaxonomyVersion`, `qualityVersion`, score y grade;
- intentos y `errorClass` si terminó en error;
- si la semana es puntuable (entra o no a la cohorte de calibración).

**Sin prompts ni respuestas.** Solo tamaños, duraciones, tokens, booleanos y códigos. La
allowlist es explícita, no una exclusión por lista negra: un campo nuevo del dominio no debe
poder filtrarse al artefacto por olvido.

El artefacto se escribe **aunque la corrida falle a mitad**. Al final el proceso sale con
código distinto de cero si no se cumplen las cinco condiciones de aceptación de §3.3 —manifest
completo intentado, semanas objetivo observadas, `completePlans >= 10`,
`scorableWeeks ∈ [30, 50]` y cobertura por escenario—, pero conserva toda la evidencia parcial.

#### 3.6 Reporte de distribuciones

`npm run loadtest:plan-builder -- --report <ruta-al-artefacto>`, implementado en el mismo
`.mjs` como camino puro: no llama al proveedor, no exige `CLAUDE_API_KEY` ni
`LOADTEST_PLAN_BUILDER=1`, y sus funciones quedan cubiertas por el `.test.js`.

Imprime dos bloques.

**Bloque de latencia** — p50/p95 por plan de las cuatro métricas de §3.4, en las dos cohortes
(todos los intentos / planes completos), con el conteo de `null` excluidos y el desglose
semanal como secundario.

**Bloque de reparación** — tres distribuciones separadas, cada una con n, p50, p90, p99, máximo
e histograma, y desglose por escenario:

1. `countRepairsV2` **por semana puntuable** → calibra la penalización semanal.
2. Suma de `countRepairsV2` **por plan completo** → calibra la penalización de plan.
3. `correctiveActionCount + structuralActionCount` **por semana puntuable** → calibra el
   warning, que usa solo esas dos dimensiones y no `moved` ni `dropped`.

El comando **describe, no propone**. No emite un divisor calculado: §5.3 prohíbe recalibrar por
variante, y una derivación automática invita exactamente a eso.

### Entrega 2 — Calibración congelada y activación de v2

Ocurre después de que el owner corra el control y elija los números mirando el reporte.

#### 3.7 El artefacto aceptado se versiona

Los resultados pagados crudos siguen ignorados. Al aceptar un control, se copia una versión
sanitizada a `docs/superpowers/calibrations/plan-builder-v2-control-<fecha>.json`, con **todas**
las observaciones de la corrida —los 12 planes intentados y las 42 semanas objetivo, marcando
cuáles entran a la cohorte de calibración— sin prompts ni respuestas. Ese archivo versionado es
el que la constante referencia, junto con su SHA-256.

#### 3.8 `qualityCalibrationV2.ts`

Módulo nuevo que congela **tres** contratos, no dos:

| Contrato | Consumidor |
|---|---|
| Penalización semanal: divisor y tope | `scoreWeek` v2 |
| Penalización de plan: divisor y tope | `scorePlan` v2 |
| `highRepairWarningThreshold`: umbral semanal | `getGenerationReliabilityIssues` v2 |

Junto al registro de procedencia:

```ts
{
  calibratedQualityVersion: 2,
  controlGenerationVariantId: '…-q1-…',
  controlRequestFingerprint: '…', // provider, modelo, effort, thinking, temperature,
                                  // maxTokens, promptVersion, schemaVersion, concurrency
  artifactPath: 'docs/superpowers/calibrations/…',
  artifactSha256: '…',
  artifactSchemaVersion: 1,
  completePlans: <n real>,
  scorableWeeks: <n real>,
  gitSha: '…',
  gitDirty: false,
}
```

`controlRequestFingerprint` cubre **todas** las dimensiones del descriptor —incluido
`provider`— salvo `qualityVersion`: el control se genera con `q1` y producción pasa a `q2`, así
que el fingerprint es lo único que puede seguir representando "el mismo control" a través del
flip.

`completePlans` y `scorableWeeks` son los valores reales de la corrida aceptada, no la meta de
la matriz.

#### 3.9 Guard contra recalibrar por variante

Una constante sola no impide recalibrar. El guard se ancla **al artefacto de control
versionado**, no a la configuración productiva del momento: comparar contra producción rompería
legítimamente en cuanto se pruebe otra variante, que es justamente el escenario para el que
existe el umbral congelado.

El test falla si:

- `PRODUCTIVE_QUALITY_VERSION === 2` y el registro de calibración está vacío;
- `artifactPath` no existe, o su SHA-256 no coincide exactamente;
- `controlGenerationVariantId` no se reconstruye desde el descriptor del artefacto;
- el fingerprint del registro no coincide con el del artefacto en todas las dimensiones salvo
  `qualityVersion`, incluido `provider`;
- `completePlans` / `scorableWeeks` declarados difieren de los del artefacto;
- `gitDirty !== false`. Un SHA por sí solo no identifica el código que produjo la muestra si la
  corrida se hizo sobre un árbol con cambios locales.

Mover el umbral obliga a tocar el registro, que es visible en el diff.

#### 3.10 Cómo v2 se vuelve efectivo

El flip de `PRODUCTIVE_QUALITY_VERSION` no basta (§2.3), y el camino no es solo declarativo: hoy
el review de attempt llama `reviewPlanQuality` **sin** `qualityVersion`
(`asyncGenerationLoop.ts:952`), así que inferiría v1 en toda corrida —las semanas target aún no
generadas nunca tienen taxonomía— mientras el job se etiquetaría `q2`. Se fija lo siguiente.

**`resolveEffectiveRunQualityVersion(weeks, targetWeekIndexes, productiveVersion)`**, ejecutada
**una sola vez y antes** de construir el descriptor de variante y el `variant_id`, para que la
etiqueta y el scoring no puedan divergir:

**Targets efectivos.** `targetWeekIndexes` ausente **no** significa "ninguna semana" ni "todas":
el loop lista todas pero omite las ya listas (`asyncGenerationLoop.ts:739` y `:888`). La regla
espeja ese skip, o una semana legacy lista quedaría "fuera de targets" vacío y activaría v2 por
verdad vacua:

```ts
effectiveTargets = targetWeekIndexes?.length
  ? targetWeekIndexes
  : weeks.filter((week) => !isReadyWeek(week)).map((week) => week.weekIndex)
```

Con eso:

- Si `productiveVersion === 1` → la corrida es v1.
- Si `productiveVersion === 2` → la corrida es v2 **si y solo si** toda semana **fuera** de
  `effectiveTargets` ya tiene `repairTaxonomyVersion === 2` y `qualityVersion === 2`. Las
  semanas de `effectiveTargets` las promueve esta corrida.
- Si queda alguna semana histórica legacy fuera de los targets efectivos → la corrida es v1.
  Interpretar contadores ausentes como cero produciría un score falsamente bueno para semanas
  que nunca fueron medidas con la taxonomía nueva.

**Semana puntuable y precondición de taxonomía.** `resolveQualityVersion` hoy exige taxonomía
v2 en *todas* las semanas cuando se pide v2 explícitamente. Se acota a las **semanas
puntuables**, definidas como las que llevan contenido generado **y no están pendientes de ser
reemplazadas por esta corrida**. Dos exclusiones, no una:

- Shells `pending`/`generating`: no tienen metadata de reparación que interpretar.
- **Semanas target todavía no procesadas por esta corrida.** En una regeneración completa
  explícita de un plan legacy, esas semanas conservan contenido viejo y por estado *parecen*
  listas; incluirlas haría fallar la precondición contra su propia taxonomía legacy justo en la
  corrida que viene a reemplazarlas.

Contrato congelado: el contexto del review recibe `pendingTargetWeekIndexes` —los targets aún no
escritos por esta corrida— y la precondición los ignora. Su score sigue calculándose como hoy;
lo único que cambia es que no pueden vetar la versión de la corrida. Sin estas dos exclusiones,
pasar `qualityVersion: 2` durante la corrida lanzaría.

**Escritura de la marca.** El loop escribe `generationMeta.qualityVersion` con la versión
efectiva de la corrida al persistir cada semana generada, en el mismo sitio donde ya escribe
`repairTaxonomyVersion`.

**Consumo.** Los reviews de attempt, el fallback y la revisión final del plan reciben la versión
efectiva de la corrida de forma explícita, no por inferencia sobre un estado parcial.

**Telemetría.** El descriptor del job y de los attempts reporta la versión efectiva de esa
corrida, no la constante global.

**Tests obligatorios:** plan nuevo con generación concurrente; regeneración completa explícita
de un plan legacy; regeneración parcial mixta (queda legacy fuera de targets → v1); y
regeneración parcial cuyas semanas no-target ya son v2 (→ v2).

---

## 4. Criterios de salida

- [ ] `npm test` no ejecuta ninguna llamada real y no gana archivos omitidos por el loadtest.
- [ ] `npm run loadtest:plan-builder` sin `LOADTEST_PLAN_BUILDER=1` falla antes de gastar tokens.
- [ ] El driver produce artefacto con `artifactSchemaVersion`, manifest, git SHA, `gitDirty`, descriptor completo, modelos observados y `weeks[]` allowlisted.
- [ ] El artefacto se escribe aunque la corrida falle; el exit code refleja las cinco condiciones de aceptación (manifest completo intentado, semanas objetivo observadas, `completePlans >= 10`, `scorableWeeks ∈ [30,50]`, al menos un plan completo por escenario).
- [ ] Una corrida interrumpida tras 10 planes exitosos **no** aprueba: no intentó los doce casos del manifest.
- [ ] El reporte imprime p50/p95 por plan de las cuatro métricas, en las dos cohortes y con el conteo de `null` excluidos.
- [ ] El reporte imprime las **tres** distribuciones de reparación con su caveat, todas con el n real.
- [ ] Ningún n hardcodeado: reporte, artefacto y registro usan los conteos reales de la corrida.
- [ ] Control corrido por el owner y artefacto sanitizado versionado en `docs/superpowers/calibrations/`.
- [ ] `qualityCalibrationV2.ts` congela los tres contratos con registro de procedencia completo.
- [ ] El guard falla ante registro vacío, SHA-256 distinto, fingerprint distinto (incluido `provider`), conteos distintos o `gitDirty !== false`.
- [ ] `resolveEffectiveRunQualityVersion` corre antes de construir el descriptor, y descriptor y scoring no pueden divergir.
- [ ] `generationMeta.qualityVersion` se escribe en el loop y un plan nuevo puntúa con v2 de punta a punta, attempts incluidos.
- [ ] Un plan mixto con semanas históricas sigue puntuando v1, y su job lo reporta así.
- [ ] Una regeneración parcial cuyas semanas no-target ya son v2 puntúa v2.
- [ ] Tests de borde: `threshold−1` / `threshold`, divisor, saturación del tope, y v1 intacto.
- [ ] Contrato de semana solo-hidratada sigue en `countRepairsV2 == 0` y cero penalización.
- [ ] `npm run lint && npm test && npm run build` en verde.

---

## 5. Decisiones

**5.1 Driver `.mjs`, no `.test.ts`.** Un `.test.ts` sería descubierto por `npm test` aunque se
autoskipee, y heredaría el timeout global de 10s. El par `.mjs` + `.test.js` mantiene la suite
sin llamadas reales y prueba solo lógica pura.

**5.2 Unidad experimental = plan.** p50/p95 por plan; el desglose por semana es secundario.

**5.3 Planes secuenciales, concurrencia interna productiva.** Paralelizar planes mediría
capacidad y rate limits en vez de la generación.

**5.4 El reporte describe, no propone.** El número lo elige una persona mirando la
distribución. Automatizar la derivación invita a recalibrar por variante, lo que normalizaría
una degradación real.

**5.5 El control se calibra una sola vez.** No se recalibra por variante. Comparar variantes
exige repetir el mismo manifest congelado.

**5.6 Conservadurismo en planes mixtos.** Ante la duda, v1: un score inflado por contadores
ausentes es peor que un score viejo bien entendido.

---

## 6. Fuera de alcance

- §3.4 instrumentación cross-week → Fase 4.
- Cualquier cambio de `effort`, `thinking`, modelo, `temperature` o concurrencia. El control
  corre con la config productiva actual; calibrar contra una config que producción no usa
  invalidaría el umbral.

  **Reconciliación con el spec padre.** §4 y §5.3 del spec de measurement foundation hablan del
  "control Sonnet 4.6 `high`". La request real no manda `effort`, y `resolveEffectivePlanBuilderConfig`
  lo registra como `'omitted'`. Aunque el default del proveedor equivalga a `high`, **lo que se
  registra es `'omitted'`**: el descriptor debe describir la request que se envió, no una
  inferencia sobre el comportamiento del proveedor. Si algún día se manda `effort` explícito,
  eso es una variante nueva y exige una corrida comparativa propia con el mismo manifest
  congelado, **sin recalibrar el umbral** (§5.5).
- Prompt caching.
- Recalcular o migrar las filas históricas en `quality_version = 1`.
- Reporte de latencia desde el cliente (telemetría UX separada, no la tabla de jobs).
