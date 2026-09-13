# Whoop — zonas de FC: cierre del rollout (`019`) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar lo que el spec de zonas de FC dejó pendiente: la activación legal del paquete de dos publicaciones, la verificación con evidencia de los pasos del smoke que nunca se ejecutaron, y la reconciliación de tres documentos que hoy se contradicen sobre el estado del rollout.

**Architecture:** No hay código de producto nuevo. Todo el código de las Entregas 1–4 y las publicaciones legales registradas (Task 10 del plan original) están commiteados en `ce32d48` y `fc3305a` y cubiertos por tests. Lo que queda es (a) un cambio de una línea por documento en `consentDocuments.ts` que constituye el Deploy 2, (b) SQL de verificación reproducible en `supabase/queries/`, (c) smokes con evidencia registrada, y (d) documentación coherente.

**Tech Stack:** TypeScript, Vitest, Supabase SQL editor, Netlify (variables de entorno de Functions por deploy).

**Spec:** `docs/superpowers/specs/2026-08-07-whoop-hr-zones-design.md` (§3 gate legal y orden de rollout, §10 verificación, §11 decisiones abiertas). Plan original ejecutado: `docs/superpowers/plans/2026-08-08-whoop-hr-zones.md`. Smoke vivo: `docs/superpowers/smokes/2026-08-08-whoop-hr-zones-smoke.md`.

## Qué se verificó contra el código el 2026-09-12

| Pieza del spec | Estado | Evidencia |
|---|---|---|
| `019_whoop_workout_zones.sql` (7 columnas, 5 `CHECK`) | **Hecho y aplicado en prod** (owner, 2026-08-12) | `supabase/019_whoop_workout_zones.sql`; guard `netlify/functions/_shared/__tests__/whoopWorkoutZoneSchema.test.ts` |
| Tipos `WhoopZoneDurations` + campos opcionales | Hecho | `src/types/index.ts:564-589` |
| Normalizador compartido | Hecho | `src/services/readiness/whoopZoneDurations.ts` + test |
| Flag de ingestión, upsert que omite claves apagado | Hecho | `netlify/functions/_shared/whoopZonesFlag.ts`; tests en `whoopSupabase.test.ts:428-470` |
| Pull del cliente (`SELECT` con las 7 columnas) | Hecho | `src/services/readiness/pullWorkouts.ts:6-9` |
| Parser de import + round-trip de backup (5 variantes manipuladas) | Hecho | `src/services/__tests__/dataExportWhoopZones.test.ts` |
| `resolveHighZoneDurationMs`, `resolveHrCaptureState`, umbral 90 | Hecho | `src/services/readiness/workoutMetrics.ts:120-157` |
| Tarjeta de sesión (grilla, `Zona alta`, barra, desplegable) | Hecho | `WhoopWorkoutMetrics.tsx`, `HrZoneDistribution.tsx`, `whoopWorkoutMetricsZones.test.tsx` |
| Bloque del coach (`· N min zona alta`, `· cobertura ?`, guardia) | Hecho | `src/services/ai/whoopWorkoutContext.ts:87-107` + test |
| Agregador y tarjeta semanal | Hecho | `weeklyHrZones.ts`, `WeeklyHrZonesCard.tsx`, `WeeklyView.tsx:421` + tests |
| Publicaciones `privacy@2026-08-08` y `whoop_biometric@2026-08-08` **registradas, no vigentes** | Hecho | `consentDocuments.ts:44-90`; tripletas congeladas en `legalPublicationIntegrity.test.ts:33-37`; espejos en `docs/legal/` |
| **Deploy 2** (cambiar ambos `currentVersion`) | **NO hecho** | `currentVersion` sigue en `2026-07-13` / `2026-07-07`; el test de `consentDocuments.test.ts:38-45` lo fija así a propósito |
| Aprobación jurídica del paquete | **NO hecha** | Roadmap §1 |
| Smoke §1 (flag apagado), §2 (`CHECK` contra la base), §3 parcial, §4, §5, §6 | **NO hechos** | Casillas vacías en el smoke |
| §16 del roadmap: `403 consent_required` observado | **NO hecho** | Cubierto solo por tests |

### El hallazgo que cambia el orden del plan

El spec §3.5 fija: aprobación jurídica (3) → Deploy 2 (4) → reaceptación (5) → **recién entonces** `WHOOP_ZONES_ENABLED=true` (6). El smoke y el README registran que el owner confirmó el 2026-08-12 `019` aplicada **y el flag encendido**, mientras que `currentVersion` sigue apuntando a las publicaciones viejas. Si eso es cierto, producción lleva un mes ingiriendo zonas bajo un consentimiento que no las menciona: exactamente el estado que el flag existía para impedir (§3.3).

Además, tres documentos se contradicen:

- Roadmap §15: «Implementado y sin desplegar», con el orden completo por delante.
- Smoke y README: «`019` aplicada y flag activo».
- Smoke multi-dispositivo (`2026-08-12-multi-device-sync-smoke.md:28`): «confirmar que el flag está **apagado** en el primer deploy».

Por eso la Task 0 no es implementación: es establecer el estado real y decidir. El resto del plan depende de esa respuesta.

## Global Constraints

- **Los commits los hace el owner.** No ejecutar `git commit` ni `git add`. Cada tarea termina en un checkpoint con lista exacta de archivos y mensaje sugerido.
- **Las migraciones remotas son de aplicación manual.** Escribir SQL no es aplicarlo; `019` ya está aplicada según el owner, y la Task 1 lo verifica en vez de asumirlo.
- **Cambiar `WHOOP_ZONES_ENABLED` exige un deploy nuevo.** Netlify captura las variables de Functions por deploy.
- **El flag es de ingestión, no de visibilidad.** Apagado no oculta ni borra zonas ya persistidas; el upsert omite las siete claves, nunca las escribe como `null`. Apagarlo para corregir el orden **no destruye datos**.
- **Las publicaciones existentes no se tocan.** Son inmutables por contrato del ledger; los sha256 congelados en `legalPublicationIntegrity.test.ts` lo garantizan. El Deploy 2 mueve solo `currentVersion`.
- **Consecuencia esperada del Deploy 2, no un fallo:** la sincronización de Whoop se detiene para quien no reacepte `whoop_biometric`, y el gate de entrada bloquea a toda cuenta hasta reaceptar `privacy`.
- **Preflight obligatorio:** `CONSENT_GATE_ENABLED=true` y `VITE_CONSENT_GATE=true`. Con una apagada, nada de lo anterior protege.
- **`estimated_cost_usd`, tokens y cuota no entran acá.** Ninguna tarea consume API de IA salvo el paso opcional de coach en Task 2 (un mensaje de chat).
- Copy en español, tuteo. No prometer diagnóstico ni prevención de lesiones.

---

## Estructura de archivos

**Se crean:**

| Archivo | Responsabilidad |
|---|---|
| `supabase/queries/2026-09-12-019-zones-checks.sql` | Verificación de `019` en prod: columnas, restricciones, rechazo de estados inválidos, conteos y auditoría por deporte |
| `supabase/queries/2026-09-12-consent-reacceptance-checks.sql` | Estado de `user_consents` antes y después del Deploy 2 |

**Se modifican:**

| Archivo | Cambio |
|---|---|
| `src/services/legal/consentDocuments.ts:44,75` | Deploy 2: `currentVersion` → `2026-08-08` en `privacy` y `whoop_biometric`; comentarios actualizados |
| `src/services/legal/__tests__/consentDocuments.test.ts:13-45` | Expectativas de versión vigente |
| `docs/superpowers/smokes/2026-08-08-whoop-hr-zones-smoke.md` | Casillas y evidencia de cada sección |
| `docs/superpowers/specs/2026-08-07-whoop-hr-zones-design.md:4` | Línea de estado |
| `PROJECT_REVIEW_AND_ROADMAP.md` §15, §16 | Reescritura según el estado real; borrado al cerrar |
| `README.md:618` | Línea de estado de Whoop |
| `CLAUDE.md` | Bloque reciente de zonas de FC al cerrar |

---

## Task 0 (owner): estado real del rollout y decisión sobre el orden invertido

No es implementación. Sin esta respuesta el plan no tiene orden.

**Files:** ninguno.

- [ ] **Step 1: Leer las tres variables en Netlify**

En Netlify → Site → Environment variables, anotar el valor **efectivo del último deploy de producción** de:

| Variable | Valor esperado por el spec hoy | Valor medido |
|---|---|---|
| `WHOOP_ZONES_ENABLED` | `false` (Deploy 2 no ocurrió) | |
| `CONSENT_GATE_ENABLED` | `true` | |
| `VITE_CONSENT_GATE` | `true` | |

- [ ] **Step 2: Medir cuántos entrenamientos ya tienen zonas**

En el SQL editor de Supabase:

```sql
select
  count(*)                                              as total_workouts,
  count(*) filter (where zone_zero_milli is not null)   as con_zonas,
  min(start_at) filter (where zone_zero_milli is not null) as primera_zona,
  max(start_at) filter (where zone_zero_milli is not null) as ultima_zona
from whoop_workouts;
```

Si `con_zonas > 0`, el flag estuvo encendido antes del Deploy 2 y esas filas se ingirieron bajo `whoop_biometric@2026-07-07`, que no menciona zonas ni cobertura.

- [ ] **Step 3: Decidir y registrar**

Dos opciones. La recomendada es la primera porque devuelve el rollout al orden del spec sin perder nada.

1. **Recomendada — apagar el flag hasta el Deploy 2.** Poner `WHOOP_ZONES_ENABLED=false`, hacer un deploy (basta un redeploy sin cambios) y verificar con la Step 2 repetida tras un sync manual que `con_zonas` **no baja**: apagado omite claves, no borra. Las filas ya ingeridas se conservan; qué hacer con ellas es una pregunta para el abogado dentro del paquete de la Task 3 (conservar bajo consentimiento retroactivo al reaceptar, o purgar con `update whoop_workouts set zone_zero_milli = null, … , percent_recorded = null where …`). La ventana de sync de 14 días las volverá a llenar sola después del Deploy 3, así que purgar no pierde nada útil.
2. **Mantener encendido.** Acepta a sabiendas un mes más de ingestión sin consentimiento explícito. Solo tiene sentido si el abogado ya lo avaló; hoy no hay evidencia de eso.

Registrar la decisión, con fecha, en «Notas de la ejecución» del smoke `2026-08-08-whoop-hr-zones-smoke.md`, y el valor efectivo del flag en la sección «Antes de empezar» (hoy dice `true`).

- [ ] **Step 4: Si alguna flag de consentimiento está apagada, encenderla antes de seguir**

`CONSENT_GATE_ENABLED` gobierna `whoopCron.ts:58` y `whoop-sync.ts:66`; `VITE_CONSENT_GATE` gobierna el gate de UI. Ambas `true` y redeploy. Sin esto, el Deploy 2 no detiene nada y la Task 4 no se puede verificar.

---

## Task 1: SQL de verificación de `019` y auditoría por deporte

Convierte los pasos §2 y §6 del smoke —que nunca se corrieron— en un archivo reproducible, con el mismo patrón que `supabase/queries/2026-09-08-035-036-applied-checks.sql`.

**Files:**
- Create: `supabase/queries/2026-09-12-019-zones-checks.sql`
- Modify: `docs/superpowers/smokes/2026-08-08-whoop-hr-zones-smoke.md` (secciones 2 y 6)

**Interfaces:**
- Consumes: las cinco restricciones nombradas en `019` (`whoop_workouts_zones_all_or_none`, `whoop_workouts_zones_non_negative`, `whoop_workouts_zones_positive_total`, `whoop_workouts_percent_recorded_range`, `whoop_workouts_score_data_requires_scored`) y las columnas de `WHOOP_WORKOUT_ZONE_COLUMNS`.
- Produces: resultados numéricos que se pegan en el smoke.

- [ ] **Step 1: Escribir el archivo**

```sql
-- 2026-09-12 — verificación de 019_whoop_workout_zones en producción.
-- Correr en el SQL editor de Supabase como owner. Ninguna sentencia persiste:
-- el bloque de rechazo corre dentro de una transacción que termina en ROLLBACK.

-- A. Columnas: deben ser exactamente 7.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'whoop_workouts'
  and column_name in (
    'zone_zero_milli', 'zone_one_milli', 'zone_two_milli', 'zone_three_milli',
    'zone_four_milli', 'zone_five_milli', 'percent_recorded'
  )
order by column_name;

-- B. Restricciones: deben ser exactamente 5, todas validadas (convalidated = true).
select conname, convalidated
from pg_constraint
where conrelid = 'public.whoop_workouts'::regclass
  and conname in (
    'whoop_workouts_zones_all_or_none',
    'whoop_workouts_zones_non_negative',
    'whoop_workouts_zones_positive_total',
    'whoop_workouts_percent_recorded_range',
    'whoop_workouts_score_data_requires_scored'
  )
order by conname;

-- C. Rechazo de estados inválidos. Cada sub-bloque intenta un UPDATE que DEBE
-- fallar y captura la excepción; imprime OK si falló por el CHECK esperado y
-- FALLO si el UPDATE pasó o falló por otro motivo. Usa una fila SCORED real y
-- una PENDING_SCORE real si existen; si falta alguna, lo dice.
begin;

do $$
declare
  scored_id   text;
  pending_id  text;
  probe record;
begin
  select workout_id into scored_id
  from public.whoop_workouts where score_state = 'SCORED' limit 1;
  select workout_id into pending_id
  from public.whoop_workouts where score_state <> 'SCORED' limit 1;

  if scored_id is null then
    raise notice 'SIN FILA SCORED: los checks 1-4 no se pueden ejercitar';
  else
    -- 1. all_or_none: cinco zonas y una null
    begin
      update public.whoop_workouts
         set zone_zero_milli = 1, zone_one_milli = 1, zone_two_milli = 1,
             zone_three_milli = 1, zone_four_milli = 1, zone_five_milli = null
       where workout_id = scored_id;
      raise notice 'FALLO all_or_none: el UPDATE pasó';
    exception when check_violation then
      raise notice 'OK all_or_none: %', sqlerrm;
    end;

    -- 2. non_negative
    begin
      update public.whoop_workouts
         set zone_zero_milli = -1, zone_one_milli = 1, zone_two_milli = 1,
             zone_three_milli = 1, zone_four_milli = 1, zone_five_milli = 1
       where workout_id = scored_id;
      raise notice 'FALLO non_negative: el UPDATE pasó';
    exception when check_violation then
      raise notice 'OK non_negative: %', sqlerrm;
    end;

    -- 3. positive_total: seis ceros
    begin
      update public.whoop_workouts
         set zone_zero_milli = 0, zone_one_milli = 0, zone_two_milli = 0,
             zone_three_milli = 0, zone_four_milli = 0, zone_five_milli = 0
       where workout_id = scored_id;
      raise notice 'FALLO positive_total: el UPDATE pasó';
    exception when check_violation then
      raise notice 'OK positive_total: %', sqlerrm;
    end;

    -- 4. percent_recorded_range
    begin
      update public.whoop_workouts
         set percent_recorded = 100.1
       where workout_id = scored_id;
      raise notice 'FALLO percent_recorded_range: el UPDATE pasó';
    exception when check_violation then
      raise notice 'OK percent_recorded_range: %', sqlerrm;
    end;
  end if;

  if pending_id is null then
    raise notice 'SIN FILA NO-SCORED: el check 5 no se puede ejercitar contra datos reales';
  else
    -- 5. score_data_requires_scored: zonas válidas sobre PENDING_SCORE/UNSCORABLE
    begin
      update public.whoop_workouts
         set zone_zero_milli = 1, zone_one_milli = 1, zone_two_milli = 1,
             zone_three_milli = 1, zone_four_milli = 1, zone_five_milli = 1,
             percent_recorded = 95
       where workout_id = pending_id;
      raise notice 'FALLO score_data_requires_scored: el UPDATE pasó';
    exception when check_violation then
      raise notice 'OK score_data_requires_scored: %', sqlerrm;
    end;
  end if;
end $$;

rollback;

-- D. Conteo actual (correr antes y después de un sync manual para el smoke §1:
--    con el flag apagado, con_zonas NO cambia).
select
  count(*)                                            as total,
  count(*) filter (where zone_zero_milli is not null) as con_zonas
from public.whoop_workouts;

-- E. Auditoría por deporte (spec §11, decisión abierta 2). Tiene sentido
--    después de al menos una semana con el flag encendido.
select sport_name,
       count(*) filter (where zone_zero_milli is null)     as sin_zonas,
       count(*) filter (where zone_zero_milli is not null) as con_zonas,
       count(*)                                            as total,
       round(avg(percent_recorded)::numeric, 1)            as cobertura_media,
       count(*) filter (where percent_recorded < 90)       as cobertura_baja
from public.whoop_workouts
where score_state = 'SCORED'
group by sport_name
order by total desc;
```

- [ ] **Step 2: Correrlo en producción**

Pegar el archivo completo en el SQL editor. Las secciones C imprimen `NOTICE`s en la pestaña de mensajes; copiar las cinco líneas `OK …`.

Expected: A devuelve 7 filas (`bigint` × 6 nullable, `numeric` × 1); B devuelve 5 filas con `convalidated = true`; C imprime cinco `OK`; D y E devuelven números.

Si alguna línea de C dice `FALLO`, la restricción no está aplicada o no protege lo que dice: **parar y reportar**, porque contradice la confirmación del 2026-08-12.

- [ ] **Step 3: Registrar en el smoke**

En `docs/superpowers/smokes/2026-08-08-whoop-hr-zones-smoke.md`, sección «2. Las cinco `CHECK` rechazan lo que deben»: marcar cada casilla y pegar debajo la línea `OK` correspondiente, con fecha. En la sección 6, reemplazar `(pendiente de la consulta de auditoría)` por el resultado de E **solo si ya pasó una semana con el flag encendido**; si no, anotar «pendiente hasta la Task 5».

- [ ] **Step 4: Checkpoint**

Archivos: `supabase/queries/2026-09-12-019-zones-checks.sql`, `docs/superpowers/smokes/2026-08-08-whoop-hr-zones-smoke.md`.
Mensaje sugerido: `docs(whoop): verify 019 constraints against production`.

---

## Task 2: Smoke de UI, coach y atleta gestionado (independiente del gate legal)

Los pasos §3, §4 y §5 del smoke leen zonas **ya persistidas**; el flag es de ingestión, así que se pueden verificar aunque la Task 0 lo haya apagado, siempre que la Step 2 de la Task 0 haya dado `con_zonas > 0`. Si dio `0`, esta tarea se pospone hasta después del Deploy 3 (Task 5).

**Files:**
- Modify: `docs/superpowers/smokes/2026-08-08-whoop-hr-zones-smoke.md` (secciones 3, 4, 5)

- [ ] **Step 1: Elegir el material**

En Supabase:

```sql
select workout_id, athlete_id, start_at::date as fecha, sport_name,
       percent_recorded, zone_four_milli + zone_five_milli as alta_ms
from whoop_workouts
where zone_zero_milli is not null
order by start_at desc
limit 10;
```

Anotar: un workout con zonas y `percent_recorded >= 100` (caso `full`), uno con `< 90` si existe (caso `low`), y uno **sin** zonas (`zone_zero_milli is null`, `score_state = 'SCORED'`) para la paridad.

- [ ] **Step 2: Tarjeta de sesión**

En `/day/:fecha` de cada workout, con la sesión auto-completada visible:

| Caso | Qué mirar | Esperado |
|---|---|---|
| Con zonas | Métrica `Zona alta` | Minutos = `round(alta_ms / 60000)` de la consulta |
| Con zonas | Botón `Distribución por zona` | Abre y cierra; en DevTools el `<button>` tiene `aria-expanded="true"/"false"` acorde |
| Con zonas | Seis filas del desplegable | Orden Z5 → Z0, formato `m:ss` |
| `full` | Cobertura | Ningún texto de cobertura, ni fuera ni dentro |
| `low` (si existe) | Cobertura | Aviso ámbar **bajo la barra**, con el porcentaje truncado a un decimal y coma (`89,9%`) |
| Sin zonas | Paridad | Métricas de la Entrega 2 (duración, strain, FC, distancia), sin `Zona alta`, sin barra, sin botón |

Si no hay ningún workout `low` real, marcar la casilla como «no observado en prod; cubierto por `whoopWorkoutMetricsZones.test.tsx`» — no inventar el caso.

- [ ] **Step 3: Resumen semanal**

En `/week`:

- Semana con workouts con zonas: tarjeta `Carga medida por Whoop` con titular `N min registrados en zona alta`, subtítulo con conteo y minutos, siete columnas, leyenda Z0–Z5.
- Navegar a una semana sin workouts con zonas: la tarjeta **no se monta**.
- Ir y volver rápido entre dos semanas (flechas): el titular nunca muestra el valor de la otra semana. Repetir cinco veces.

- [ ] **Step 4: Bloque del coach (un mensaje de chat, consume una request `chat_general`)**

1. Abrir el chat y mandar «¿Cómo viene mi carga esta semana?».
2. Ajustes → Beta Quality → exportar trazas. Buscar `Carga objetiva registrada por Whoop`.
3. Verificar:
   - cada línea con zonas trae `· N min zona alta` **entre** `strain` y `FC`;
   - un workout sin zonas produce la línea de la Entrega 2, sin `zona alta` ni `cobertura`;
   - la guardia dice que las zonas son distribución medida y que no debe proponer objetivos por zona;
   - la respuesta del coach **no** propone objetivos por zona.

- [ ] **Step 5: Atleta gestionado**

1. Cambiar al atleta gestionado desde el switcher.
2. `/week`: la tarjeta semanal no se monta.
3. `/day/:fecha` de cualquier día: ninguna sesión muestra zonas ni métricas Whoop.
4. Confirmar que es ausencia de datos, no filtrado:

```sql
select count(*) from whoop_workouts where athlete_id = '<athlete_id del gestionado>';
```

Expected: `0`.

- [ ] **Step 6: Registrar y checkpoint**

Marcar las casillas de las secciones 3, 4 y 5 del smoke con fecha y, donde aplique, el `workout_id` usado.
Archivo: `docs/superpowers/smokes/2026-08-08-whoop-hr-zones-smoke.md`.
Mensaje sugerido: `docs(whoop): record HR zones UI and coach smoke`.

---

## Task 3 (owner, externo): aprobación jurídica del paquete de dos publicaciones

Es el único bloqueante duro para encender el flag de forma legítima (spec §11.3). Se integra al cierre legal del roadmap §1, que ya está en curso desde el 2026-08-29.

**Files:** ninguno en el repo hasta que el abogado responda.

- [ ] **Step 1: Enviar el paquete**

Adjuntar al abogado, además de las cuatro URLs ya enviadas:

- `src/services/legal/publications/privacy.2026-08-08.ts` (o su espejo `docs/legal/politica-de-privacidad.md`);
- `src/services/legal/publications/whoop_biometric.2026-08-08.ts` (espejo `docs/legal/descargo-whoop.md`);
- un `diff` legible contra las versiones vigentes: `git diff --no-index src/services/legal/publications/privacy.2026-07-13.ts src/services/legal/publications/privacy.2026-08-08.ts` y lo mismo para `whoop_biometric`.

Pedir explícitamente:

1. Conformidad con los tres puntos del spec §3.2: entrenamientos con distribución por zona y porcentaje registrado; réplica local en el dispositivo; uso como contexto del coach de IA.
2. Qué hacer con las filas ingeridas antes del Deploy 2 (resultado de la Task 0, Step 2): conservar, o purgar y dejar que la ventana de 14 días las regenere bajo el consentimiento nuevo.
3. Decisión de retención de `user_consents` al borrar cuenta (ya pedida en roadmap §1).

- [ ] **Step 2: Si el abogado pide cambios de texto**

**No** editar `privacy.2026-08-08.ts` ni `whoop_biometric.2026-08-08.ts`: son publicaciones inmutables, con sha256 congelado en `legalPublicationIntegrity.test.ts:33-37`. Crear una versión nueva con fecha del día (`privacy.<YYYY-MM-DD>.ts`), registrarla en `consentDocuments.ts` **sin** cambiar `currentVersion`, agregar su tripleta al test de integridad (el test imprime el sha esperado al fallar), actualizar el espejo Markdown, y volver a enviar. Las publicaciones del 2026-08-08 quedan en el ledger como registradas y nunca vigentes.

**Done:** conformidad escrita del abogado sobre las dos publicaciones que se van a activar, y respuesta sobre las filas previas.

---

## Task 4: Deploy 2 — activar las publicaciones y verificar la reaceptación

Depende de la Task 3. Es un cambio de dos líneas que detiene la sincronización de Whoop para quien no reacepte. Cierra también el §16 del roadmap (`403 consent_required` observado).

**Files:**
- Modify: `src/services/legal/__tests__/consentDocuments.test.ts:13-45`
- Modify: `src/services/legal/consentDocuments.ts:44,51-53,75,82-84`
- Create: `supabase/queries/2026-09-12-consent-reacceptance-checks.sql`
- Modify: `docs/superpowers/smokes/2026-08-08-whoop-hr-zones-smoke.md` (sección nueva «7. Deploy 2 y reaceptación»)

**Interfaces:**
- Consumes: `getCurrentVersion(id)` de `consentDocuments.ts`; lo leen `ConsentGate.tsx:78,91,153,169`, `WhoopConnection.tsx:94-123`, `useWhoopSync.ts:121-128` y, en el servidor, `consentEnforcement.ts:8` vía `whoop-sync.ts:66` y `whoopCron.ts:58`.
- Produces: `getCurrentVersion('privacy') === '2026-08-08'`, `getCurrentVersion('whoop_biometric') === '2026-08-08'`.

- [ ] **Step 1: Cambiar el test para que exija las versiones nuevas**

En `src/services/legal/__tests__/consentDocuments.test.ts` reemplazar el primer `it` y el cuarto:

```ts
  it('declara las rutas y versiones vigentes de los cuatro documentos', () => {
    expect(
      CONSENT_DOCUMENTS.map(({ id, route, currentVersion }) => ({ id, route, currentVersion })),
    ).toEqual([
      { id: 'terms', route: '/terms', currentVersion: '2026-07-13' },
      { id: 'privacy', route: '/privacy', currentVersion: '2026-08-08' },
      { id: 'health', route: '/health-disclaimer', currentVersion: '2026-06-20' },
      { id: 'whoop_biometric', route: '/whoop-disclaimer', currentVersion: '2026-08-08' },
    ])
  })
```

```ts
  it('las publicaciones de zonas de FC son las vigentes y las anteriores siguen en el ledger', () => {
    // Deploy 2 del rollout de zonas (spec §3.5), ejecutado tras la aprobación
    // jurídica. Las versiones anteriores no se borran: el ledger es inmutable y
    // una fila de `user_consents` con la versión vieja tiene que seguir
    // resolviendo su publicación.
    expect(getCurrentVersion('privacy')).toBe('2026-08-08')
    expect(getCurrentVersion('whoop_biometric')).toBe('2026-08-08')
    expect(getPublication('privacy', '2026-07-13')).toBeDefined()
    expect(getPublication('whoop_biometric', '2026-07-07')).toBeDefined()
  })
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/legal/__tests__/consentDocuments.test.ts`
Expected: FAIL en los dos `it` modificados, con `2026-07-13` / `2026-07-07` como valor recibido.

- [ ] **Step 3: Mover `currentVersion` en los dos documentos**

En `src/services/legal/consentDocuments.ts`:

```ts
  {
    id: 'privacy',
    route: '/privacy',
    currentVersion: '2026-08-08',
    publications: [
      {
        version: '2026-07-13',
        sha256: 'd226efd919744ef32e46b17d74e1a35d651135919cef30316adb6162b77e560d',
        content: PRIVACY_2026_07_13,
      },
      // Vigente desde el Deploy 2 del rollout de zonas de FC (aprobación
      // jurídica registrada en docs/superpowers/smokes/2026-08-08-whoop-hr-zones-smoke.md).
      {
        version: '2026-08-08',
        sha256: '6541521b7b1d73bc3955aa3b592d4c2413ca2ab64eef679df9df535fb8bbb4aa',
        content: PRIVACY_2026_08_08,
      },
    ],
  },
```

```ts
  {
    id: 'whoop_biometric',
    route: '/whoop-disclaimer',
    currentVersion: '2026-08-08',
    publications: [
      {
        version: '2026-07-07',
        sha256: '4dc98910c0d7df3ae7ed17a8df010856e8ed68c13bc3ddfe94549e5be3f7af98',
        content: WHOOP_2026_07_07,
      },
      // Vigente desde el Deploy 2, como un solo paquete con `privacy@2026-08-08`.
      // Quien no reacepte deja de sincronizar Whoop: es el fail-closed funcionando.
      {
        version: '2026-08-08',
        sha256: '29d1264f14f340d56a6fff4f7c5e8f7d02852b40c439572c506103c500ed1d3c',
        content: WHOOP_2026_08_08,
      },
    ],
  },
```

- [ ] **Step 4: Correr los tests de legal y la suite completa**

Run: `npx vitest run src/services/legal src/components/legal`
Expected: PASS. `legalPublicationIntegrity.test.ts` no cambia: los sha256 son de las publicaciones, no de `currentVersion`.

Run: `npm run lint && npm test && npm run build`
Expected: verde. Si algún test fuera de `legal/` fija `2026-07-13` como versión vigente de `privacy` (buscar con `grep -rn "getCurrentVersion\|currentVersion" src --include='*.test.ts*'`), ajustarlo en el mismo cambio.

- [ ] **Step 5: Comprobar en dev que las rutas públicas muestran el texto nuevo**

`npm run dev`, abrir `/privacy` y `/whoop-disclaimer`. `LegalDocumentRenderer.tsx:39` renderiza `getPublication(id, document.currentVersion)`, así que ambas páginas deben mencionar «distribución del tiempo entre las seis zonas de frecuencia cardíaca» y el porcentaje registrado. La fecha «actualizado» debe decir 2026-08-08.

- [ ] **Step 6: Escribir el SQL de reaceptación**

`supabase/queries/2026-09-12-consent-reacceptance-checks.sql`:

```sql
-- 2026-09-12 — estado de consentimientos alrededor del Deploy 2 de zonas de FC.
-- Correr ANTES del deploy (línea base) y DESPUÉS de reaceptar.

-- A. Última versión aceptada por usuario y documento.
select user_id, document, max(version) as ultima_version, max(accepted_at) as cuando
from public.user_consents
where document in ('privacy', 'whoop_biometric')
group by user_id, document
order by user_id, document;

-- B. Cuentas con Whoop conectado que aún NO aceptaron whoop_biometric@2026-08-08.
--    Después de la reaceptación del owner debe quedar vacío para su cuenta.
select c.user_id
from public.whoop_connections c
where not exists (
  select 1 from public.user_consents u
  where u.user_id = c.user_id
    and u.document = 'whoop_biometric'
    and u.version = '2026-08-08'
);
```

`whoop_connections` y las columnas `user_id`/`document`/`version`/`accepted_at` de `user_consents` están verificadas contra `whoopSupabase.ts` y `017`.

- [ ] **Step 7: Checkpoint previo al deploy**

Archivos: `src/services/legal/consentDocuments.ts`, `src/services/legal/__tests__/consentDocuments.test.ts`, `supabase/queries/2026-09-12-consent-reacceptance-checks.sql`.
Mensaje sugerido: `feat(legal): activate privacy and whoop_biometric 2026-08-08 publications`.

El owner commitea y pushea; `main` se despliega solo. `WHOOP_ZONES_ENABLED` **sigue en `false`** en este deploy.

- [ ] **Step 8: Verificar la reaceptación en producción (con evidencia)**

Antes de tocar la app, correr la sección A del SQL y guardar la salida como línea base.

1. **Gate de entrada.** Hard refresh en `app.rallyiq.cl`. El `ConsentGate` bloquea con `privacy` pendiente; cerrar sesión, exportar y borrar datos siguen accesibles desde el bloqueo. **No aceptar todavía.**
2. **`403 consent_required` del servidor (cierra roadmap §16).** El cliente corta antes de llamar (`useWhoopSync.ts:121-131`), así que hay que llamar al endpoint directo. En la consola del navegador, con la sesión abierta:

```js
// El cliente de Supabase no está expuesto en window: el token se lee del
// storage donde supabase-js lo persiste (clave `sb-<ref>-auth-token`).
const key = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k))
const token = JSON.parse(localStorage.getItem(key)).access_token
const r = await fetch('/.netlify/functions/whoop-sync', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
})
console.log(r.status, await r.json())
```

Expected: `403` y cuerpo con `code: 'consent_required'`.

3. **Cron.** En Netlify → Functions → `whoop-cron` → logs de la próxima ejecución: la cuenta del owner aparece salteada por consentimiento (la rama `continue` de `whoopCron.ts:58`), sin error.
4. **Reaceptar `privacy`** desde el gate. La app carga.
5. **Ajustes → Whoop.** `WhoopConnection.tsx:94-123` detecta `whoop_biometric` pendiente y ofrece reaceptar; el botón de sincronizar no llama al servidor antes de eso. Reaceptar.
6. **Sync manual.** Ahora responde «Al día»; repetir el `fetch` del punto 2: `200`.
7. Correr la sección A del SQL: dos filas nuevas para el owner (`privacy@2026-08-08`, `whoop_biometric@2026-08-08`) con `accepted_at` de hoy. Sección B vacía para el owner.
8. **Incógnito.** Reingresar: no vuelve a pedir reaceptación (hidrata desde Supabase).

- [ ] **Step 9: Registrar**

Agregar al smoke la sección «7. Deploy 2 y reaceptación» con las ocho casillas anteriores marcadas, el `status` del `fetch` en ambos momentos y las filas de la sección A antes/después. En `PROJECT_REVIEW_AND_ROADMAP.md`, borrar el §16 (queda verificado) y actualizar el §15 con los pasos 1–5 hechos.

Mensaje sugerido: `docs(whoop): record Deploy 2 reacceptance and 403 consent_required evidence`.

---

## Task 5: Deploy 3 — encender la ingestión y auditar

Depende de la Task 4. Si la Task 0 dejó el flag encendido (opción 2), esta tarea se reduce a los Steps 3–5.

**Files:**
- Modify: `docs/superpowers/smokes/2026-08-08-whoop-hr-zones-smoke.md` (secciones 1 y 6)

- [ ] **Step 1: Smoke §1 con el flag todavía apagado**

Correr la sección D de `supabase/queries/2026-09-12-019-zones-checks.sql`, anotar `con_zonas`. Forzar un sync manual desde Ajustes. Repetir D: `con_zonas` **no cambia**. Confirmar además que el workout más reciente tiene las siete columnas en `null` y el resto poblado:

```sql
select workout_id, start_at, score_state, strain, zone_zero_milli, percent_recorded
from whoop_workouts order by start_at desc limit 3;
```

Marcar las tres casillas de la sección 1 del smoke.

- [ ] **Step 2: Encender el flag**

Netlify → `WHOOP_ZONES_ENABLED=true` → redeploy. Confirmar en el log del deploy que la variable está presente.

- [ ] **Step 3: Primer sync con zonas**

Sync manual. Correr D: `con_zonas` sube. Comprobar un workout `SCORED` reciente:

```sql
select workout_id, sport_name, score_state,
       zone_zero_milli, zone_one_milli, zone_two_milli,
       zone_three_milli, zone_four_milli, zone_five_milli, percent_recorded
from whoop_workouts
where score_state = 'SCORED' and zone_zero_milli is not null
order by start_at desc limit 3;
```

Expected: seis enteros no negativos con suma positiva y `percent_recorded` entre 0 y 100.

Si la Task 2 se pospuso por `con_zonas = 0`, ejecutarla ahora.

- [ ] **Step 4: Si el abogado pidió purgar las filas previas al Deploy 2**

Solo si la Task 3 lo decidió así. Purgar únicamente las filas anteriores a la fecha del Deploy 2 y fuera de la ventana de sync que las regenera:

```sql
update whoop_workouts
   set zone_zero_milli = null, zone_one_milli = null, zone_two_milli = null,
       zone_three_milli = null, zone_four_milli = null, zone_five_milli = null,
       percent_recorded = null
 where zone_zero_milli is not null
   and start_at < '<fecha del Deploy 2>'::timestamptz - interval '16 days';
```

Las filas dentro de los ~16 días previos las reescribe el próximo sync bajo el consentimiento nuevo; no hace falta tocarlas. Las purgadas quedan sin zonas de forma permanente y todas las superficies lo toleran (spec §8).

- [ ] **Step 5: Auditoría por deporte, una semana después**

Correr la sección E del SQL de la Task 1. Pegar el resultado en la sección 6 del smoke y responder la decisión abierta 2 del spec §11 en una frase: si squash recibe distribución o si el valor se concentra en running. Si `cobertura_baja` es alto en squash, anotarlo junto a la decisión abierta 1 (el umbral de 90 es provisional).

Mensaje sugerido: `docs(whoop): record Deploy 3 ingestion and sport coverage audit`.

---

## Task 6: Cierre documental

Depende de las Tasks 1–5. Deja los cuatro documentos diciendo lo mismo.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-07-whoop-hr-zones-design.md:4`
- Modify: `PROJECT_REVIEW_AND_ROADMAP.md` (sección «Whoop — zonas de frecuencia cardíaca»)
- Modify: `README.md:618`
- Modify: `CLAUDE.md` (bloques recientes)
- Modify: `docs/superpowers/smokes/2026-08-08-whoop-hr-zones-smoke.md:3-8`

- [ ] **Step 1: Estado del spec**

Línea 4 de `docs/superpowers/specs/2026-08-07-whoop-hr-zones-design.md`:

```
Estado: implementado y desplegado; rollout legal cerrado el <fecha del Deploy 3> (ver plan 2026-09-12-whoop-hr-zones-rollout-closure.md)
```

- [ ] **Step 2: Roadmap**

Borrar los §15 y §16 completos, y la fila «Whoop — zonas de frecuencia cardíaca» deja de existir. Si la auditoría por deporte dejó una decisión pendiente (umbral de 90), agregar una entrada de una línea bajo «Motor de entrenamiento — observación pendiente»:

```
### N. Umbral de cobertura Whoop
El 90% del aviso de cobertura es provisional (spec §11.1). Con el resultado de la auditoría por deporte del <fecha> (<n> de <total> entrenamientos de squash bajo 90), decidir si se mantiene, sube o baja. Solo visual: no altera agregados.
```

- [ ] **Step 3: README**

Línea 618:

```
- Whoop readiness/workouts y las zonas de FC están operativos en producción: `019` aplicada, publicaciones `privacy@2026-08-08` y `whoop_biometric@2026-08-08` vigentes desde el <fecha del Deploy 2>, `WHOOP_ZONES_ENABLED=true` desde el <fecha del Deploy 3>.
```

- [ ] **Step 4: CLAUDE.md**

Agregar al inicio de «Bloques recientes relevantes»:

```
- **Whoop — zonas de FC, rollout cerrado** (<fecha>, `019` aplicada): las siete columnas y las cinco `CHECK` están verificadas contra producción; las publicaciones `privacy@2026-08-08` y `whoop_biometric@2026-08-08` son las vigentes y la reaceptación quedó observada, incluido el `403 consent_required` del servidor; `WHOOP_ZONES_ENABLED=true` desde el <fecha>. El flag es de ingestión, no de visibilidad: apagarlo omite claves, nunca borra. Auditoría por deporte en el smoke `2026-08-08-whoop-hr-zones-smoke.md` §6. Queda abierto solo el umbral visual de cobertura (90%, provisional).
```

- [ ] **Step 5: Encabezado del smoke**

Reemplazar las líneas 3–8 por el estado final: fecha de cada deploy, decisión de la Task 0 y resultado de la auditoría.

- [ ] **Step 6: Verificación y checkpoint**

Run: `git diff --check`
Expected: sin salida.

Archivos: los cinco de arriba.
Mensaje sugerido: `docs(whoop): close HR zones rollout`.

---

## Fuera de alcance, declarado

Del spec §2, sin cambios: `kilojoule` y desnivel; objetivos de zona en sesiones planificadas; comparación persistida entre semanas; backfill histórico; ingerir zonas para atletas gestionados. No se agrega guard self-only a las superficies de la Entrega 2 (spec §2.1). No se toca ninguna de las tres constantes `WHOOP_WORKOUT_WINDOW_DAYS`.

Tampoco entra acá la decisión de retención de `user_consents` al borrar cuenta: se pide en la Task 3 porque viaja en el mismo paquete al abogado, pero su implementación pertenece al roadmap §1.
