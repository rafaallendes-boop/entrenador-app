# Smoke de producción — `quality_version = 2` y `plan_generation_jobs`

Fecha objetivo: primer deploy después de `003ed9d`.
Migración: `016` **ya aplicada** en producción el 2026-07-25. No hay migración pendiente.

> **Ejecutado el 2026-07-26 — aprobado con alcance parcial.** Ver
> [Resultado](#resultado) al final: Caso 1 verificado en producción; Casos 2 y 3
> quedaron no reproducibles porque la superficie que piden es dev-only, y se
> apoyan en cobertura unitaria + el monitoreo M4.

## Qué se está verificando y por qué

Este deploy no es solo telemetría: activa la penalización de reparación de v2, que
puede bajar scores visibles al atleta. Y estrena una regla nueva —la versión
efectiva por corrida— cuyo error característico es silencioso: filas coherentes
por dentro pero que mienten sobre con qué versión se puntuó.

Por eso el smoke no se conforma con "salió una fila": cruza `variant_id`,
`quality_version` del job, de los attempts y de las semanas locales, en tres
formas de corrida distintas.

**Regla de oro:** cualquier caso donde `variant_id` diga `-q2-` y `quality_version`
diga `1` (o al revés) es un fallo que corta el smoke. Es exactamente la
divergencia que esta fase existía para cerrar.

---

## Preparación

- [ ] **P1.** Confirmar que el árbol está limpio y que `main` local tiene los 9 commits.

```bash
git status --short && git log --oneline origin/main..main | wc -l
```
Esperado: sin salida en el primero, `9` en el segundo.

- [ ] **P2.** Push y deploy.

```bash
git push origin main
```
Netlify despliega solo. Esperar a que el deploy quede *Published* antes de seguir.

- [ ] **P3.** Confirmar bundle nuevo en el navegador: hard refresh (Cmd+Shift+R) en la app de producción.

- [ ] **P4.** Dejar abiertos dos contextos:
  - el **SQL editor de Supabase** (producción);
  - la **consola de DevTools** en la app, para inspeccionar Dexie.

- [ ] **P5.** Anotar la hora UTC de inicio. Todas las consultas filtran por
  `created_at > '<hora de inicio>'` para no mezclar corridas viejas.

---

## Consultas base

Guardar estas dos; se reusan en los tres casos.

**Q-JOB** — el job de la última corrida:

```sql
select job_id, plan_id, variant_id, quality_version, outcome,
       week_count_requested, week_count_succeeded, week_count_failed,
       first_week_ready_ms, plan_complete_ms, terminal_ms,
       total_input_tokens, total_output_tokens, estimated_cost_usd,
       previous_week_context_source, created_at
from public.plan_generation_jobs
order by created_at desc
limit 5;
```

**Q-ATTEMPTS** — los attempts de ese job:

```sql
select week_index, attempt, outcome, variant_id, quality_version,
       repair_taxonomy_version, corrective_action_count, structural_action_count,
       moved_session_count, dropped_session_count,
       quality_score, quality_grade
from public.plan_generation_attempts
where job_id = '<JOB_ID>'
order by week_index, attempt;
```

**Q-DEXIE** — las semanas locales del plan (consola de DevTools):

```js
await new Promise((resolve) => {
  const open = indexedDB.open('EntrenadorDB')
  open.onsuccess = () => {
    const tx = open.result.transaction('trainingPlanWeeks', 'readonly')
    const req = tx.objectStore('trainingPlanWeeks').getAll()
    req.onsuccess = () => resolve(console.table(
      req.result
        .filter((w) => w.planId === '<PLAN_ID>')
        .sort((a, b) => a.weekIndex - b.weekIndex)
        .map((w) => ({
          weekIndex: w.weekIndex,
          status: w.status,
          taxonomy: w.generationMeta?.repairTaxonomyVersion,
          quality: w.generationMeta?.qualityVersion,
          corrective: w.generationMeta?.correctiveActionCount,
          structural: w.generationMeta?.structuralActionCount,
        })),
    ))
  }
})
```

---

## Caso 1 — Plan nuevo (debe ser `q2`)

Es el camino feliz y el que cubre a la mayoría de los usuarios.

- [ ] **1.1** Crear un plan nuevo desde la app, con sesión iniciada (así el
  generador usa el worker remoto: `canUseRemoteGeneration()` exige `supabase` +
  usuario autenticado).
- [ ] **1.2** Esperar a que la generación termine. Anotar el `plan_id`.
- [ ] **1.3** Correr **Q-JOB**. Verificar:

| Campo | Esperado |
|---|---|
| `quality_version` | `2` |
| `variant_id` | contiene `-q2-` |
| `outcome` | `succeeded` |
| `week_count_succeeded` | igual a `week_count_requested` |
| `terminal_ms` | > 0 y coherente con lo que tardó |
| `plan_complete_ms` | **no nulo** |
| `estimated_cost_usd` | no nulo |

- [ ] **1.4** Correr **Q-ATTEMPTS** con ese `job_id`. Verificar:
  - hay al menos una fila por semana (agrupables por `job_id`);
  - todas traen `quality_version = 2` y el **mismo** `variant_id` que el job;
  - `repair_taxonomy_version = 2` en todas.

- [ ] **1.5** Correr **Q-DEXIE**. Todas las semanas listas deben tener
  `taxonomy: 2` y `quality: 2`.

- [ ] **1.6** Abrir la revisión de calidad del plan en la UI y anotar el
  **grade**. No es criterio de fallo: es la línea base para el punto de
  monitoreo de abajo.

**Corta el smoke si:** `quality_version` es 1, el `variant_id` no coincide entre
job y attempts, o alguna semana lista quedó sin `quality: 2`.

---

## Caso 2 — Regeneración parcial de un plan legacy (debe ser `q1`)

El caso que más código nuevo ejercita: `resolveEffectiveRunQualityVersion` tiene
que detectar la semana legacy fuera de targets y bajar toda la corrida a v1.

- [ ] **2.1** Elegir un plan **anterior a este deploy** (sus semanas no tienen
  `quality`). Confirmarlo con **Q-DEXIE**: `quality` debe venir `undefined`.
- [ ] **2.2** Regenerar **una sola semana** de ese plan ("Mejorar semana" /
  "Ajustar semana"), con sesión iniciada.
- [ ] **2.3** Correr **Q-JOB**. Verificar:

| Campo | Esperado |
|---|---|
| `quality_version` | `1` |
| `variant_id` | contiene `-q1-` |
| `week_count_requested` | `1` |

- [ ] **2.4** Correr **Q-ATTEMPTS**: `quality_version = 1` y el mismo
  `variant_id` que el job.
- [ ] **2.5** Correr **Q-DEXIE**: la semana regenerada debe quedar con
  `quality: 1`, y las semanas legacy sin tocar siguen en `undefined`.

**Corta el smoke si:** sale `q2`. Significaría que la corrida adoptó v2 con
semanas legacy sin medir, que es el escenario de score falsamente bueno.

---

## Caso 3 — Regeneración sobre un plan que ya es `q2` (debe seguir `q2`)

Cierra el trinquete que se corrigió en `e542c62`: una regeneración no debe
degradar a v1 un plan que ya era v2.

- [ ] **3.1** Usar el plan del Caso 1 (todas sus semanas con `quality: 2`).
- [ ] **3.2** Regenerar una semana, con sesión iniciada.
- [ ] **3.3** Correr **Q-JOB**: `quality_version = 2` y `variant_id` con `-q2-`.
- [ ] **3.4** Correr **Q-DEXIE**: todas las semanas siguen en `quality: 2`,
  incluida la recién regenerada.

**Corta el smoke si:** la corrida sale `q1`. Sería el trinquete q2 → q1 vivo.

---

## Caso 4 — Fila de fallo previo al loop (opcional, solo si es fácil provocarlo)

Verifica `emitUnstartedJobTelemetry`. **No bloquea el smoke** si no se puede
provocar sin ensuciar producción.

- [ ] **4.1** Provocar un fallo del worker antes del loop (por ejemplo, cortando
  la red del cliente justo después de encolar).
- [ ] **4.2** Correr **Q-JOB**. Debe existir una fila con `outcome = 'failed'`,
  `week_count_succeeded = 0`, `first_week_ready_ms` nulo y `terminal_ms` presente.

**Interpretación:** si no aparece fila, la corrida se perdió de la medición —
que es justo lo que ese emisor viene a evitar. Anotarlo aunque no corte el smoke.

---

## Verificación cruzada final

- [ ] **V1.** Ningún job con `variant_id` `-q2-` y `quality_version = 1`, ni al revés:

```sql
select job_id, variant_id, quality_version
from public.plan_generation_jobs
where (variant_id like '%-q2-%' and quality_version is distinct from 2)
   or (variant_id like '%-q1-%' and quality_version is distinct from 1);
```
Esperado: **0 filas**. Cualquier fila acá es un fallo bloqueante.
(`is distinct from` y no `<>`: con `<>`, un `quality_version` nulo no matchea y
la divergencia pasaría inadvertida.)

- [ ] **V2.** Ningún attempt en desacuerdo con su job:

```sql
select a.job_id, a.week_index, a.attempt,
       a.variant_id as attempt_variant, j.variant_id as job_variant,
       a.quality_version as attempt_quality, j.quality_version as job_quality
from public.plan_generation_attempts a
join public.plan_generation_jobs j using (job_id)
where a.variant_id is distinct from j.variant_id
   or a.quality_version is distinct from j.quality_version;
```
Esperado: **0 filas**.

- [ ] **V3.** Los attempts de las corridas del smoke son agrupables por `job_id`
  y sus contadores de taxonomía no vienen todos nulos:

```sql
select job_id, count(*) as attempts,
       count(repair_taxonomy_version) as con_taxonomia,
       sum(corrective_action_count) as corrective,
       sum(structural_action_count) as structural
from public.plan_generation_attempts
where created_at > '<hora de inicio>'
group by job_id;
```
Esperado: `con_taxonomia = attempts` en todas las filas.

---

## Si algo falla

El rollback **no requiere tocar la base**: `016` es aditiva y las filas
existentes son válidas para ambas versiones.

- **Rollback de producto** (scores vuelven a v1): revertir
  `PRODUCTIVE_QUALITY_VERSION` a `1` en `src/services/planBuilder/qualityReview.ts`
  y desplegar. Las corridas nuevas vuelven a `q1`; las filas `q2` ya escritas
  quedan y siguen siendo legibles — por eso se separan por `quality_version` al
  analizar.
- **No borrar filas** de `plan_generation_jobs` ni de `plan_generation_attempts`:
  una corrida fallida es dato, y el retention job ya las limpia por edad.

---

## Después del smoke: qué monitorear

- [ ] **M1.** Tasa de `needs_review`, **separada por `quality_version`**. La
  penalización nueva la sube por diseño; comparar antes y después sin separar
  por versión leería el cambio de escala como una caída de calidad.
- [ ] **M2.** `estimated_cost_usd` acumulado por semana. Es estimado, no
  facturación: contrastar contra la factura real antes de sacar conclusiones.
- [ ] **M3.** Frecuencia de `quality.generation.high_repair_count`. En el control
  disparaba en el 7% de las semanas. Muy por encima sugiere que producción repara
  más que el control; muy por debajo, que el umbral quedó alto para el tráfico real.
  **No recalibrar por eso** (§5.3): anotarlo y decidir con una corrida comparativa.
- [ ] **M4.** Proporción de corridas `q1` sobre el total. Debería caer con el
  tiempo a medida que los planes legacy se regeneran. Si se queda alta, hay una
  ruta que no está estampando.

## Resultado

Ejecutado el **2026-07-26**.

- [x] Smoke **aprobado con alcance parcial**, detallado abajo.
- [x] `CLAUDE.md` y `PROJECT_REVIEW_AND_ROADMAP.md` actualizados: los pendientes
  operativos de la Fase 0 de medición pasan a cerrados.

### Caso 1 — aprobado

`job_id = plan-bg-9c7c0f58-03d0-4a85-99b3-63a5f3bcb98e`, plan
`3578d0cf-f1f4-44a0-b707-a882ab74ea9c`.

| Campo | Valor |
|---|---|
| `variant_id` | `s46-q2-00ftsagu` |
| `quality_version` | `2` |
| `outcome` | `succeeded` |
| semanas | 4 pedidas / 4 exitosas / 0 fallidas |
| `first_week_ready_ms` | 24 216 |
| `plan_complete_ms` | 43 947 |
| `terminal_ms` | 44 449 |
| tokens | 13 056 in / 5 064 out |
| `estimated_cost_usd` | 0.115128 (≈ **$0.029 por semana generada**) |

Los 4 attempts traen `repair_taxonomy_version = 2` y coinciden en `variant_id` y
`quality_version` con el job. Grade del punto 1.6: **no anotado**.

### Casos 2 y 3 — no reproducibles en producción

**No se ejecutaron, y no por olvido: la superficie que piden no existe en el
build de producción.** El botón "Mejorar semana" / "Ajustar semana"
(`PlanBuilderV2Page.tsx:1218`) está detrás de `showPlanQualityDebug`, que es
`isDevToolsEnabled()`, y esa función corta en seco antes de mirar cualquier env
var:

```ts
// src/services/devTools.ts:6-11
if (import.meta.env.PROD === true) return false
```

Los otros caminos de regeneración parcial que sí viven en producción
("Ajustar semanas marcadas" y la recuperación del consumidor) solo aparecen
cuando la revisión de calidad marcó semanas, condición que no se puede provocar
a voluntad; y "Crear plan de nuevo" regenera el plan completo, así que no
ejercita el camino de targets parciales que es lo que había que probar.

**Cobertura sustitutiva.** La regla de versión efectiva está cubierta por tests
unitarios en los dos escenarios exactos:

- `effectiveRunQualityVersion.test.ts` — *"falls back to v1 when a legacy week
  stays outside the targets"* y *"is v2 when every non-target week is already v2"*.
- `generationJobRunnerQualityVersion.test.ts` — *"stays on v1 when a legacy week
  survives outside the targets"*.

Lo que los tests **no** cubren es que la fila remota refleje esa decisión. Ese
eslabón queda vigilado por **M4** (proporción de corridas `q1` sobre el total):
si no baja con el tiempo, hay una ruta que no está estampando.

**Cómo ejecutarlos si alguna vez hace falta.** Correr el mismo código con
`import.meta.env.PROD === false` contra la Supabase de producción:

```bash
netlify dev   # no `npm run dev`
```

Tiene que ser `netlify dev`: la app encola contra
`/.netlify/functions/enqueue-plan-generation`
(`triggerBackgroundGeneration.ts:11`) y el server de Vite solo no sirve esas
funciones — sin ellas el generador cae al runner local, que no escribe
`plan_generation_jobs`. Requiere env de producción y sesión real. El Caso 2
además necesita un plan legacy todavía presente en Dexie (semanas sin
`generationMeta.qualityVersion`), cosa que un plan nuevo puede haber reemplazado.

### Correcciones a este checklist

Detectadas al ejecutarlo; aplican a cualquier repetición futura.

- **Ventana de V1/V3.** La `<hora de inicio>` tiene que ser posterior al deploy,
  no solo a la migración. `variant_id`, `quality_version` y
  `repair_taxonomy_version` son columnas que `016` agregó a
  `plan_generation_attempts`, y el bundle anterior no las enviaba: las corridas
  previas aparecen con `con_taxonomia = 0` y sin fila en `plan_generation_jobs`.
  En esta corrida se colaron tres jobs del 2026-07-24 por ese motivo. Es ruido de
  ventana, no un fallo de estampado.
- **V1 tiene un hueco con nulos.** `quality_version <> 2` no matchea cuando el
  valor es `NULL`, así que un job con `variant_id` q2 y versión nula pasaría como
  0 filas. Usar `is distinct from` en las dos ramas.
