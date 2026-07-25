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

Total: **12 planes / 42 semanas**, dentro del objetivo de ≥10 planes y 30–50 semanas.

Se congelan en un manifest versionado: orden de escenarios, fechas de inicio, fecha de
referencia de la semana parcial, número de semanas, perfil, restricciones y wizard config. El
artefacto embebe el manifest y el git SHA.

**Caveat obligatorio en el artefacto y en el reporte:** con n=12 planes, p95 y p99 de plan son
prácticamente el máximo observado. Sirve como baseline inicial conservadora, no como p95
estable. Comparar variantes exige repetir exactamente el mismo manifest.

Costo estimado: 42 semanas × (8k in / 1,5k out) ≈ **US$1,95**; techo ≈ **US$3,90** si todas las
semanas gastaran dos intentos.

#### 3.4 Métricas de latencia

El poller en memoria consulta el writer imitando la secuencia real (consulta inmediata, luego
`sleep`), y **arranca antes o simultáneamente** con `runAsyncPlanGeneration`. El intervalo no se
duplica: `DEFAULT_INTERVAL_MS` se extrae a un módulo puro
(`PLAN_GENERATION_POLL_INTERVAL_MS`) consumido por el cliente y por el driver.

Se guardan tres valores, no uno:

- `first_week_ready_ms` — desde worker start hasta la escritura de la primera semana lista.
- `first_week_detected_ms` — cuándo el poller la descubre.
- `first_week_detection_lag_ms` = detected − ready.

Eso separa generación de la cuantización que introduce el polling. `first_week_visible_ms`
sigue reservado para una medición con UI real.

#### 3.5 Artefacto

`loadtest-results/plan-builder-<ISO>.json`. Contiene el descriptor de variante **completo**
(no solo `variant_id`) y los modelos realmente devueltos por los attempts: el alias solicitado
y el modelo observado pueden divergir.

Por plan, como mínimo:

- escenario y número de semanas;
- outcome y conteos succeeded / failed;
- los cuatro timings de job más el detection lag;
- tokens, costo estimado, retries y uso de fallback;
- quality version, score, grade y códigos de issues;
- contadores de taxonomía;
- modelos observados;
- tamaños de entrada y salida.

**Sin prompts ni respuestas.** Solo tamaños, duraciones, tokens, booleanos y códigos.

El artefacto se escribe **aunque la corrida falle a mitad**. Al final el proceso sale con
código distinto de cero si no alcanza ≥10 planes completos o 30–50 semanas, pero conserva toda
la evidencia parcial.

#### 3.6 Reporte de distribuciones

`npm run loadtest:plan-builder -- --report <ruta-al-artefacto>`, implementado en el mismo
`.mjs` como camino puro: no llama al proveedor, no exige `CLAUDE_API_KEY` ni
`LOADTEST_PLAN_BUILDER=1`, y sus funciones quedan cubiertas por el `.test.js`.

Imprime tres distribuciones separadas — n, p50, p90, p99, máximo e histograma, con desglose por
escenario:

1. `countRepairsV2` **por semana** (n=42) → calibra la penalización semanal.
2. Suma de `countRepairsV2` **por plan** (n=12) → calibra la penalización de plan.
3. `correctiveActionCount + structuralActionCount` **por semana** (n=42) → calibra el warning.

El comando **describe, no propone**. No emite un divisor calculado: §5.3 prohíbe recalibrar por
variante, y una derivación automática invita exactamente a eso.

### Entrega 2 — Calibración congelada y activación de v2

Ocurre después de que el owner corra el control y elija los números mirando el reporte.

#### 3.7 El artefacto aceptado se versiona

Los resultados pagados crudos siguen ignorados. Al aceptar un control, se copia una versión
sanitizada a `docs/superpowers/calibrations/plan-builder-v2-control-<fecha>.json`, con las 12
observaciones de plan y 42 de semana, sin prompts ni respuestas. Ese archivo versionado es el
que la constante referencia, junto con su SHA-256.

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
  controlRequestFingerprint: '…', // modelo, effort, thinking, temperature, maxTokens,
                                  // promptVersion, schemaVersion, concurrency
  artifactPath: 'docs/superpowers/calibrations/…',
  artifactSha256: '…',
  completePlans: 12,
  weeks: 42,
}
```

`controlRequestFingerprint` excluye deliberadamente `qualityVersion`: el control se genera con
`q1` y producción pasa a `q2`, así que el fingerprint es lo único que puede seguir
representando "el mismo control" a través del flip.

#### 3.9 Guard contra recalibrar por variante

Una constante sola no impide recalibrar. Dos guardas:

- Un test falla si `PRODUCTIVE_QUALITY_VERSION === 2` mientras el registro de calibración está
  vacío.
- El guard compara el **request fingerprint**, no el `variant_id`: exige que el fingerprint
  siga representando el control congelado. Exigir igualdad de `variant_id` sería insatisfacible
  (§2.4).

Mover el umbral obliga a tocar el registro, que es visible en el diff.

#### 3.10 Cómo v2 se vuelve efectivo

El flip de `PRODUCTIVE_QUALITY_VERSION` no basta (§2.3). Se fija:

- **Cuándo se marca la semana.** El loop escribe `generationMeta.qualityVersion` con la versión
  efectiva de la corrida al persistir cada semana generada, en el mismo sitio donde ya escribe
  `repairTaxonomyVersion`.
- **Plan nuevo o regeneración completa:** todas las semanas del run quedan marcadas v2 desde el
  inicio y todo el gate (attempts, fallback y revisión final del plan) usa v2.
- **Regeneración parcial de un plan con semanas históricas:** la corrida permanece
  efectivamente en v1. Interpretar contadores legacy ausentes como cero produciría un score
  falsamente bueno para semanas que nunca fueron medidas con la taxonomía nueva.
- **Reviews de attempts con semanas todavía pending:** usan la versión efectiva de la corrida,
  no la inferencia sobre el estado parcial del plan.
- **El descriptor del job y de los attempts reporta la versión efectiva de esa corrida**, no la
  constante global. Si no, un plan mixto se etiquetaría `q2` mientras se puntuó con v1.

---

## 4. Criterios de salida

- [ ] `npm test` no ejecuta ninguna llamada real y no gana archivos omitidos por el loadtest.
- [ ] `npm run loadtest:plan-builder` sin `LOADTEST_PLAN_BUILDER=1` falla antes de gastar tokens.
- [ ] El driver produce artefacto con manifest, git SHA, descriptor completo y modelos observados.
- [ ] El artefacto se escribe aunque la corrida falle; el exit code refleja si se alcanzó la muestra.
- [ ] El reporte imprime las **tres** distribuciones separadas con su caveat de n.
- [ ] Control corrido por el owner y artefacto sanitizado versionado en `docs/superpowers/calibrations/`.
- [ ] `qualityCalibrationV2.ts` congela los tres contratos con registro de procedencia completo.
- [ ] El guard falla si v2 está activa sin registro, o si el fingerprint del control no coincide.
- [ ] `generationMeta.qualityVersion` se escribe en el loop y un plan nuevo puntúa con v2 de punta a punta.
- [ ] Un plan mixto con semanas históricas sigue puntuando v1, y su job lo reporta así.
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
  corre con la config productiva actual (`effort: 'omitted'`); calibrar contra una config que
  producción no usa invalidaría el umbral.
- Prompt caching.
- Recalcular o migrar las filas históricas en `quality_version = 1`.
- Reporte de latencia desde el cliente (telemetría UX separada, no la tabla de jobs).
