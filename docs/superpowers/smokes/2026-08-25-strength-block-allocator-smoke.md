# Smoke de producción — Allocator coordinado de bloque de fuerza (§29, Causa B)

Fecha del documento: 2026-08-25 (preparado antes del deploy).
**Ejecutado tres veces contra `main@b2c8738` (dos el 2026-08-25, una el
2026-08-26). Veredicto: FALLIDO** — ver secciones "Resultado — Corrida 1",
"Resultado — Corrida 2" y "Resultado — Corrida 3" al final. Corrida 1 gastó
US$0,206061 pero no evaluó el allocator porque el atleta de prueba no tenía
fuerza configurada como disciplina. Corrida 2 corrigió esa causa pero fue
bloqueada por el cliente **antes de llamar al proveedor** por cuota diaria
agotada, costo US$0. **Corrida 3 (2026-08-26, US$0,295830) sí completó una
generación real y sí evaluó el allocator: el hallazgo es que
`generation_meta.strengthAllocator` está ausente (nunca se emite) en las 11
semanas del plan, y el contenido de fuerza del bloque `build` de 6 semanas
muestra el patrón exacto de repetición que este allocator existe para
corregir** — hasta 9 de 9 accesorios idénticos entre pares de semanas no
contiguas del mismo bloque. Ver "Resultado — Corrida 3" para el detalle
completo. La revisión local del 2026-08-27 confirmó la causa raíz y corrigió
el cableado sin llamadas pagadas. El primer gate heredado quedó rojo en 12/15
pares, pero se demostró que medía novedad absoluta y no el daño deportivo. El
contrato final detecta sesiones casi clonadas por similitud proporcional; el
fixture productivo de seis semanas queda verde. **Causa B cerrada en código y
smoke local a costo US$0; pendiente deploy y observación del primer bloque
real.** No repetir una generación completa pagada sólo para este hallazgo.

El objetivo es cerrar la **Causa B** del Hallazgo 5 de §28 (accesorios de fuerza compartidos
entre semanas de un mismo bloque bajo concurrencia). Diseño en
[`docs/superpowers/specs/2026-08-24-strength-rotation-block-allocator-design.md`](../specs/2026-08-24-strength-rotation-block-allocator-design.md),
plan en
[`docs/superpowers/plans/2026-08-25-strength-rotation-block-allocator.md`](../plans/2026-08-25-strength-rotation-block-allocator.md),
cierre técnico en §29 del roadmap.

**Este documento conserva el guion y los reportes de ejecución.** La Corrida 3
es la evidencia del fallo del deploy `b2c8738`; la corrección posterior vive
por ahora sólo en el árbol local. El smoke local ya quedó verde. Después del
deploy, observar el primer bloque real disponible y agregar una sección
separada; no comprar otro plan completo para repetir exclusivamente esta
prueba ni tildar evidencia de producción a priori.

## Precondiciones — no arrancar sin esto

1. **El cambio debe estar commiteado y desplegado.** Producción corre hoy
   `839f665` ("Operations dashboard entrega A"), que **no** incluye el
   allocator. Verificar el commit publicado en el deploy activo desde
   la consola de Netlify (Deploys → el deploy en Published, que muestra su
   commit) — no con `git log` local, que describe el árbol de trabajo y no lo
   que está sirviendo producción. Si el deploy publicado sigue siendo
   `839f665`, este smoke no puede ejecutarse todavía.
2. **Sin migraciones nuevas.** El allocator no toca Supabase (confirmado:
   `git status` no muestra ningún `supabase/*.sql` nuevo). No hay paso de
   aplicar SQL antes de este smoke.
3. **Confirmar saldo de Anthropic con el owner antes de generar.** El
   registro más reciente en `CLAUDE.md` es ~US$0,60 al 2026-07-30; el Plan
   Builder corre en `claude-sonnet-4-6` a través de `plan_builder_week`/
   `plan_builder_pair`, y el costo medido es **~US$0,029 por semana
   generada** (`OPTIMIZATION_AND_COSTS.md` §4). Un bloque `peak` de 4-6
   semanas más el resto del plan puede rondar 6-8 semanas totales — no arrancar
   sin decir el número aproximado en voz alta y tener el visto bueno.
4. **Usar el mismo atleta gestionado de prueba de smokes anteriores** (o uno
   equivalente), nunca el self del owner con datos reales. El smoke de §28 usó
   "Juan perez" — reutilizarlo si sigue disponible evita ensuciar otro perfil.
5. **El atleta DEBE tener "Pesas / Fuerza" tildada entre sus disciplinas**
   (`Ajustes → Deporte y perfil base`), y hay que verificarlo **antes** de abrir
   el wizard. Sin eso no hay smoke posible, y el costo se pierde entero: el
   wizard deriva las opciones de deporte complementario del perfil
   (`availableComplementarySports = enabledSports.filter(...)`,
   `CompetitionPlanPage.tsx:404`), así que el paso 5 **ni siquiera ofrece**
   fuerza, `complementarySports` queda sin ella, `filterDisallowedSports`
   descarta cualquier sesión de fuerza que el modelo devuelva, y el allocator
   nunca corre. **Esto ya invalidó la corrida del 2026-08-25** (ver Resultado).
   Después de tildarla en el perfil, hay que **seleccionarla explícitamente en
   el paso 5 del wizard**: tildarla en el perfil la habilita, no la agrega sola.
6. **Elegir la fecha del evento según la fase que se quiere medir.** La
   distribución la fija `resolvePhase` (`src/services/macroPlan.ts:655`) y
   **con squash como deporte principal un bloque `peak` de 4 semanas es
   imposible**: para squash, `peak` son sólo las semanas con 2 y 3 de resto
   —dos semanas—, `build` cubre de 4 a 9 —seis semanas— y `base` el resto.
   Para squash, **el bloque a medir es `build`, no `peak`**, y se consigue con
   el evento a ~10 semanas. Un `peak` de 4 semanas sólo existe con un primario
   **no-squash** (running o ciclismo) y el evento a 8 o más semanas, porque ahí
   `peak` cubre de 5 a 8 de resto. El tope del plan es
   `MAX_COMPETITION_PLAN_WEEKS = 12`.
7. **La cuota diaria da esencialmente UN intento por día, y un intento fallido
   la consume igual.** `DEFAULT_DAILY_AI_LIMITS.plan_builder_week` es de 12
   semanas por día, y un evento a ~10 semanas produce un plan de **11**. La
   corrida 1 del 2026-08-25 gastó 8 semanas de cuota; cuando la corrida 2
   intentó generar el plan correcto ese mismo día, el cliente lo rechazó antes
   de llamar al proveedor —"necesita 11 semanas y hoy te quedan 4 de 12"— y la
   sesión terminó sin poder medir nada. **Consecuencia: verificá los dos gates
   del wizard ANTES de gastar una sola semana de cuota, y si una corrida falla,
   la siguiente es al día siguiente.** No intentes encoger el plan para que
   entre en la cuota restante: con squash como principal, `resolvePhase` siempre
   agrega `peak` + `taper` + `race` = 4 semanas después de cualquier `build`,
   así que el mínimo con `build ≥ 4` es de 8 semanas.

## Fase 0 — verificación sin costo (US$0)

Antes de generar nada nuevo:

- [ ] Abrir la app, entrar al atleta de prueba y confirmar **cero
      `ConstraintError`** en la consola del navegador. El backfill de scope de
      atleta (`src/services/athlete/athleteScopeMigration.ts`, modificado en
      este mismo árbol) corre al abrir; un `ConstraintError` ahí sería un
      índice Dexie violado, no algo del allocator, pero comparte el mismo
      deploy y debe descartarse primero.
- [ ] Confirmar que check-ins y resúmenes semanales **previos** al deploy
      siguen visibles sin cambios — el allocator no debería tocar nada fuera
      de sesiones de fuerza recién generadas/reparadas.
- [ ] Abrir una sesión de fuerza **ya existente** (de antes de este deploy) y
      confirmar que conserva sus superseries (si las tenía) y que los nombres
      de ejercicio siguen resueltos (no aparece ningún id crudo tipo
      `dead_bug` sin traducir). El allocator no debe alterar contenido
      histórico no regenerado.

Ninguno de estos tres pasos llama al proveedor de IA.

## Fase 1 — una sola corrida real

Generar **un** plan competitivo. La fecha del evento se elige por la
precondición 6, no al ojo:

- **Con squash como principal** (el caso normal): evento a **~10 semanas**.
  Produce un bloque `build` de **6 semanas** —15 pares para el Criterio 3, más
  que suficiente—, más `peak` de 2, `taper` de 1 y `race`. **El bloque a
  evaluar es `build`.** Costo aproximado: 10 semanas × US$0,029 ≈ **US$0,29**.
- **Si se quiere medir `peak` específicamente**: hace falta un primario
  no-squash y el evento a 8 o más semanas. No es el caso de uso real de la app;
  sólo vale la pena si se sospecha algo específico de esa fase.

El allocator es agnóstico de la fase —agrupa por bloque, y `build` es un bloque
como cualquier otro—, así que medir sobre `build` responde exactamente la misma
pregunta que el Hallazgo 5 de §28 y con más pares.

No generar más de un plan en este smoke: el costo crece linealmente y una sola
corrida ya alcanza para evaluar los 7 criterios. El límite diario de cliente es
de 12 semanas.

Al aceptar el plan, anotar el `plan_id` que uses en la query de abajo (visible
en el export de backup JSON, o en la URL/estado de la página del plan si el
dev tooling lo expone).

## Instrumento crítico — dónde vive la telemetría, y dónde NO

**La telemetría nueva `strengthAllocator` no llega a `plan_generation_attempts`
ni al panel `/ops`.** Vive únicamente dentro de la columna jsonb
`training_plan_weeks.generation_meta`, bajo la clave `strengthAllocator`
(`src/services/planBuilder/repairWeek.ts:2196`, propagada a
`generationMeta` en `asyncGenerationLoop.ts`/`generateWeek.ts`/
`generatePlan.ts` y persistida tal cual — camelCase incluido — por
`trainingPlanWeekToRow` en `src/services/planBuilder/planRows.ts:72`). El
dashboard operacional de §31 agrega sobre `plan_generation_jobs`/
`plan_generation_attempts`/`coach_requests`, ninguna de las cuales tiene esta
información. **No busques esto en `/ops`.**

Query verificada contra el esquema real de `supabase/003_training_plans_sync.sql`
(columnas `sessions jsonb`, `generation_meta jsonb`, ambas con las claves
camelCase del tipo TypeScript sin transformar):

```sql
select week_index,
       generation_meta->'strengthAllocator' as allocator,
       generation_meta->>'strengthAccessoryRotationActionCount' as rotaciones,
       generation_meta->'repairWarnings' as warnings,
       coalesce((
         select jsonb_agg(jsonb_build_object(
           'date', s->>'date',
           'timeBlock', s->>'timeBlock',
           'title', s->>'title',
           'exercises', jsonb_path_query_array(s, '$.exercises[*].name')
         ) order by s->>'date', s->>'timeBlock', s->>'title')
         from jsonb_array_elements(sessions) as s
         where s->>'sessionType' = 'strength'
       ), '[]'::jsonb) as fuerza_por_sesion
from training_plan_weeks
where plan_id = '<PLAN_ID>'
order by week_index;
```

Cómo leer el resultado:

- `allocator` es un objeto con `slotCount`, `assignedCount`,
  `infeasibleIntraWeekCount`, `insufficientPoolCount`,
  `unresolvedIdentityCount`, `searchExhaustedCount` y
  `unmaterializedCount` — los siete contadores de §10 del spec, **por columna
  local**, no la matriz completa del bloque.
- `rotaciones` es el contador preexistente de §16/§23 (`strengthAccessoryRotationActionCount`),
  útil como referencia de cuánto rotó la política determinista además del
  allocator.
- `warnings` es `repairWarnings` (`src/types/planBuilder.ts:85`), la lista de
  `{ code, message }` de la reparación de esa semana. Es donde hay que buscar
  `allocator.divergent_template` para el Criterio 6.
- `fuerza_por_sesion` conserva fecha, bloque horario, título y ejercicios de
  cada sesión, ordenados igual que el gate. Para el Criterio 3 se compara D1
  con D1 y D2 con D2; nunca se aplana la semana completa.

Si `generation_meta->'strengthAllocator'` es `null` para una semana de fuerza
dentro de un bloque de 2+ semanas, eso ya es un hallazgo: el allocator debería
haber corrido.

## Criterios de salida

Evaluar los siete contra la corrida real. Cada uno indica qué observar y qué
significaría que falló.

- [ ] **1. `unmaterializedCount = 0` en todas las semanas.**
      Observar: la columna `unmaterializedCount` del jsonb en cada fila.
      Fallar significa: la matriz asignó una celda a una sesión/ocurrencia que
      ya no existía al momento de materializar — un desface entre el snapshot
      del template y la sesión viva.

- [ ] **2. `assignedCount = 0` sólo en la primera ocurrencia de cada familia
      del selector (A/B/C; A/B en taper).** En una ocurrencia posterior de la
      misma familia debe haber asignaciones o degradación explícita.
      Observar: `assignedCount` por fila. En las demás semanas del bloque debe
      ser `> 0`, salvo que los contadores de degradación
      (`infeasibleIntraWeekCount` + `insufficientPoolCount` +
      `unresolvedIdentityCount` + `searchExhaustedCount`) expliquen por qué no
      hubo margen para asignar nada.
      Fallar significa: una semana que sí debería rotar (no es la primera del
      bloque) quedó con la columna intacta sin ninguna causa de degradación
      que lo justifique.

- [ ] **3. Ninguna sesión de fuerza casi clonada dentro del bloque — criterio
      deportivo proporcional.**
      Observar: ordenar `fuerza_por_sesion` por fecha, bloque horario y título;
      comparar el mismo ordinal semanal (D1↔D1, D2↔D2) entre cada semana
      posterior y las anteriores del bloque. Excluir sólo el primer
      `main_lift`; core, power, accesorios y desconocidos son contables.
      Calcular `compartidos / contables_de_la_sesion_posterior`.
      Falla únicamente si hay **al menos 3 compartidos y similitud ≥80%**.
      Ejemplos: 7/8, 8/9 y 9/9 fallan; 6/8 y 6/9 son continuidad admisible.
      Esto replica `quality.strength.repeated_template` sin confundir la unión
      semanal D1+D2 ni castigar la progresión normal de carga.

- [ ] **4. Ninguna sesión de fuerza por debajo del mínimo de trabajo de
      fuerza para su duración: 5 ejercicios desde 70 min, 4 desde 55, 3 desde
      45** (`repairWeek.ts:3375-3377`).
      Observar: contar entradas en `fuerza_por_sesion` por sesión de fuerza (agrupando
      por sesión, no sumando todas las semanas) contra la duración de esa
      sesión.
      Fallar significa: el allocator o su degradación dejaron una sesión con
      menos ejercicios contables de los que el propio motor exige — sería una
      regresión de densidad, no sólo de rotación.

- [ ] **5. El core rota `dead_bug → plank → side_plank →
      stability_ball_front_plank` entre semanas del bloque; si el modelo
      prescribió `copenhagen_side_plank` o press de disco, ese ejercicio DEBE
      sobrevivir sin sustituirse.**
      Observar: identificar el ejercicio de zona media/core en `fuerza_por_sesion` de
      cada semana. Si es uno de los cuatro de `INJECTED_CORE_ROTATION`
      (`dead_bug`, `plank`, `side_plank`, `stability_ball_front_plank`), debe
      avanzar en ese orden según `weekIndexInBlock` (con salvedad de
      equipamiento: sin `stability_ball` disponible, el ciclo usa sólo los
      tres primeros). Si en una semana el modelo prescribió un core real
      fuera de esa allowlist (Copenhagen, press de disco), **esa semana debe
      conservarlo**: es una prescripción real, no relleno, y §7 del spec la
      declara fija por proyección.
      **Ojo con el alcance:** cada semana se genera por separado, así que el
      modelo puede prescribir Copenhagen en una semana y no en otra. Lo que
      hay que comprobar es que un core fuera de la allowlist **sobreviva
      dentro de la semana donde apareció**, NO que se repita entre semanas.
      Exigir repetición entre semanas produciría un falso fallo.
      Fallar significa: el core rotable no avanza en el orden esperado, o un
      core real prescrito por el modelo fue reemplazado por el ciclo
      inyectado dentro de su propia semana.

- [ ] **6. `allocator.divergent_template` puede aparecer legítimamente si una
      semana hermana ya estaba lista con otro template — anotarlo, no
      contarlo como falla.**
      Observar: si aparece este código en `repairWarnings` de alguna semana
      (fuera del jsonb de `strengthAllocator`, en la metadata de reparación
      general), registrar en qué semana y con qué contexto de timing
      (concurrencia real puede o no disparar esta rama).
      No fallar el smoke sólo por su presencia: es el camino best-effort
      documentado en §9 del spec.

- [ ] **7. En la UI: la semana abre, las superseries se ven, ningún ejercicio
      con nombre crudo sin resolver.**
      Observar: abrir cada semana del bloque en la app (no sólo leer el JSON),
      confirmar que la sesión de fuerza renderiza normalmente, que cualquier
      superserie generada por la política determinista (§23) se ve con su
      riel/corchete, y que ningún nombre aparece como id crudo (`dead_bug`,
      `bent_over_row`, etc.) en vez de su copy en español.
      Fallar significa: hay una regresión de UI o de resolución de identidad
      que el JSON de Supabase no habría mostrado.

## Lo que este smoke NO prueba

- **El camino de crash por conversión de dominancia o recorte.** No hay forma
  confiable de provocarlo a mano desde la UI — depende de una combinación
  específica de template y recorte de densidad. Queda cubierto únicamente por
  `src/services/planBuilder/__tests__/strengthAllocatorSessionAnchoring.test.ts`,
  no por este smoke.
- **La convergencia multidispositivo del backfill de scope de atleta**
  (`athleteScopeMigration.ts`, modificado en el mismo árbol de trabajo). Un
  solo dispositivo no puede demostrar convergencia; sigue siendo prioridad 6
  del roadmap y su propio smoke dedicado (`2026-08-12-multi-device-sync-smoke.md`).
- **El caso de infactibilidad genuina del pool.** Si la corrida real produce
  `infeasibleIntraWeekCount` alto con `assignedCount` bajo, **eso no es un
  defecto**: es degradación honesta y correctamente reportada, tal como
  predice el diseño. Orden de magnitud observado durante la
  revisión de código, con un fixture **sintético** (tres sesiones de fuerza
  idénticas por semana sobre un bloque de 12): 2 de 12 celdas asignadas y 10
  `infeasibleIntraWeekCount`. No proviene de ningún test del repo ni de una
  corrida real, así que sirve para reconocer la forma del patrón y **no** como
  valor esperado contra el cual comparar. Si el patrón real se parece a eso,
  anotarlo como comportamiento esperado, no como hallazgo — a menos que además
  falle alguno de los 7 criterios de arriba.
- **Optimalidad global del allocator.** El spec (§8) es explícito: bajo el
  tope de exploración, la búsqueda devuelve la mejor solución *visitada*, no
  el óptimo global. Este smoke no puede distinguir "mejor visitada" de "óptimo
  real" — sólo puede confirmar que el resultado cumple los invariantes I1-I4
  observables (criterios 1-5 de arriba).

## Resultado — Corrida 1 (2026-08-25)

**Ejecutado el 2026-08-25. Veredicto global: INCONCLUSO — no se pudo evaluar
el allocator.** La corrida gastó presupuesto real (US$0,206061) y completó
las 8 semanas sin errores técnicos, pero el plan generado **no contiene
ninguna sesión de fuerza**, así que el allocator (`strengthAllocator`) nunca
se ejecutó. No es un fallo del código desplegado: es un hueco de datos de
prueba en el perfil del atleta usado. Ninguno de los 7 criterios pudo
evaluarse con evidencia positiva o negativa real.

### Gate previo

- Confirmado en la consola de Netlify (Deploys → Production): **`main@b2c8738`
  "fix(plan-builder): coordinar rotación de fuerza por bloque"**, publicado hoy
  a las 4:24 PM, build de 40s. El deploy anterior (`839f665`) quedó atrás en el
  historial. **No** se procedió con `839f665` en ningún momento.

### Fase 0 (costo US$0) — las tres verificaciones pasaron

1. **Cero `ConstraintError`.** Se activó la captura de consola antes del
   switch a Juan Perez (que dispara el backfill de `athleteScopeMigration.ts`)
   y se revisó el log completo (52 mensajes, todos `[whoop:auto-complete]`
   informativos). Ninguno es `ConstraintError` ni error de ningún tipo.
2. **Check-ins y resúmenes semanales previos siguen visibles.** Se navegó a
   las semanas de agosto (10–16, 17–23, 24–30) de Juan Perez y el widget
   "Weekly Action Loop" siguió calculando adherencia, sesiones completadas y
   estado de check-in sobre datos históricos reales (`0/3 sesiones
   completadas`, etc.), sin errores de render.
3. **Sesión de fuerza histórica conserva superseries y nombres resueltos —
   verificado en el self, no en Juan Perez (desviación declarada).** Antes de
   generar nada se consultó Supabase directamente:
   `select type, count(*), min(date), max(date) from sessions where
   athlete_id = 'ath_m_0eea9851-9b20-4af9-9a82-6c73fde5b9e6' group by type`
   devolvió únicamente `mobility` (1) y `squash` (16) — **cero filas
   `strength` en todo el historial de Juan Perez**, de antes y de después del
   deploy. No había ninguna sesión de fuerza de este atleta que abrir. Como
   chequeo de regresión suplementario, de solo lectura y sin generar nada, se
   abrió la sesión de fuerza histórica del self (`Fuerza — Press + Estocadas
   Unilaterales`, 2026-08-21, previa a este deploy): renderizó "9 ejercicios ·
   2 superseries", con la superserie A (`Dead bug — control de tronco` +
   `Corte diagonal con disco en media rodilla`, 3 rondas) y la superserie B
   (`Flexión de brazos` + `Remo inclinado`, 4 rondas) mostrando el riel visual
   y nombres en español completamente resueltos — cero ids crudos. Esto **no
   sustituye** la verificación sobre Juan Perez, que sigue sin cobertura
   porque no existe el dato.

### Fase 1 — la corrida real

- **Atleta:** Juan Perez (`ath_m_0eea9851-9b20-4af9-9a82-6c73fde5b9e6`), el
  mismo de §28.
- **Evento:** "Smoke QA — Allocator Bloque Fuerza", torneo de squash,
  13 oct 2026 (7 semanas desde hoy 25 ago; la app mostró "8 semanas a
  planificar" incluyendo la semana de competencia).
- **Fases estimadas mostradas antes de generar:** "Peak → Taper" — pero la
  estructura real generada fue **Build semanas 1–5, Peak semanas 6–7,
  Competencia semana 8**, no "Peak 4+ semanas" como pedía el guion. Esto
  cambió después de seleccionar "En buena forma" en el paso de estado
  actual, y no se puede corregir sin una segunda corrida (prohibida por el
  alcance). **Desviación declarada**: no se evaluó un bloque `peak` de 4+
  semanas; el bloque `build` de 5 semanas consecutivas sí calificaba como
  bloque real de 4+ semanas por diseño (`blockIdentity.ts` no es
  fase-específico), pero resultó irrelevante porque no hubo fuerza en
  ninguna semana de ningún bloque.
- **Configuración:** 7 días disponibles, 5 sesiones/semana, 1 hora, sin doble
  sesión, "Rendir al máximo", nivel intermedio, "En buena forma", fatiga
  normal, sin molestias declaradas. En el paso "¿Qué deportes complementarios
  incluimos?" la app mostró: *"No hay deportes complementarios configurados
  en tu perfil. Puedes agregarlos en Ajustes → Deportes."* — señal ignorada
  en el momento porque el guion no pedía verificar esto antes de generar.
- **plan_id:** `a5cb7bab-caf1-4395-888a-830735594499` (status `draft`, **no
  aceptado** — se dejó sin aceptar ni descartar a propósito, para no
  supersedear ni borrar las sesiones del "Plan Arquetipo 4" ya existente de
  §28, que sigue siendo el plan `active` de este atleta).
- **Costo real:** `plan_generation_jobs` para este plan → `job_id
  plan-bg-627d9833-7f2b-4270-b447-f9d815789653`, `outcome: succeeded`,
  `total_input_tokens: 23877`, `total_output_tokens: 8962`,
  **`estimated_cost_usd: 0.206061`**. Dentro del rango estimado
  (US$0,18–0,25).

### Causa raíz confirmada: perfil de prueba sin disciplina de fuerza

Consulta SQL sobre las 8 semanas generadas
(`training_plan_weeks where plan_id = 'a5cb7bab...'`):

- `generation_meta->'strengthAllocator'` es **`NULL` en las 8 filas**, sin
  excepción.
- `generation_meta->>'strengthAccessoryRotationActionCount'` también `NULL`
  en las 8 filas.
- `jsonb_path_query_array(sessions, '$[*].sessionType')` por semana: **nunca
  aparece `"strength"`** — semanas 0–6 son `squash` (con una `mobility`
  suelta en semanas 5 y 6) y semana 7 (competencia) es `squash` × 2. 101
  sesiones de squash en total, cero de fuerza.
- Los `repairWarnings` de las semanas 0–6 son todos `squash_pool_insufficient`
  ("No hay suficientes drills de control/technical... se entrega corto en
  vez de mezclar modalidad") y `squash_title_aligned` — advertencias del
  motor de squash, sin relación con fuerza.
- Verificación adicional en la UI (Ajustes → Perfil del atleta → Deporte y
  perfil base, con Juan Perez activo): ninguna de las cinco disciplinas
  (Squash, Running, Bicicleta, **Pesas/Fuerza**, Movilidad) aparece
  seleccionada — los cinco botones se ven con el mismo estilo neutro sin
  ningún realce activo, y "Nombre visible"/"Edad"/"Peso" muestran placeholders
  sin guardar. `select ... from athlete_profiles where athlete_id = '...'`
  devolvió 0 filas remotas.

**Conclusión de causa:** el perfil de Juan Perez —usado desde §28 sin llenar
nunca la sección "Deporte y perfil base"— no tiene ninguna disciplina
complementaria registrada. Plan Builder, al armar la mezcla semanal, solo
puede ofrecer sesiones de fuerza si "Pesas / Fuerza" está entre las
disciplinas configuradas del atleta (o se agrega explícitamente en el paso
"deportes complementarios" del wizard, que reportó "Ninguno" disponible).
Sin eso, no importa cuántas semanas de `peak` se generen: nunca habrá una
sesión de fuerza sobre la cual el allocator pueda correr. Esto es un hueco de
datos de prueba, no un defecto del commit `b2c8738`.

### Veredicto por criterio

- [ ] **1. `unmaterializedCount = 0`.** **Sin cobertura.** El campo es `NULL`
      en las 8 semanas porque el allocator nunca corrió; no hay valor que
      pueda leerse como 0 ni como distinto de 0.
- [ ] **2. `assignedCount = 0` solo en la semana `indexInBlock = 0`.** **Sin
      cobertura**, mismo motivo — `NULL` en las 8 semanas.
- [ ] **3. Solape de accesorios < 3 entre semanas.** **Sin cobertura.** No
      existe ninguna columna `fuerza` con contenido que comparar entre pares
      de semanas — todas las columnas `fuerza` están vacías (`[]`).
- [ ] **4. Mínimo de ejercicios de fuerza por duración de sesión.** **Sin
      cobertura.** No hay ninguna sesión `strength` en el plan generado sobre
      la cual contar ejercicios.
- [ ] **5. Rotación del core inyectado / preservación de core real
      prescrito.** **Sin cobertura**, mismo motivo.
- [ ] **6. `allocator.divergent_template` anotado si aparece.** No aparece en
      ningún `repairWarnings` de las 8 semanas — pero esto no es evidencia de
      que el camino esté bien, es consecuencia de que el allocator nunca
      corrió.
- [ ] **7. UI: la semana abre, superseries visibles, sin ids crudos.**
      **Parcialmente observado, pero sin contenido de fuerza que revisar.**
      El plan sí abre correctamente en la UI (`get_page_text` mostró
      Semana 1 con sus 5 sesiones de squash renderizadas con títulos,
      objetivos y descripciones normales, sin ids crudos visibles); no hubo
      ninguna sesión de fuerza ni superserie que verificar en esta corrida.
      El chequeo suplementario de Fase 0 sobre una sesión de fuerza del self
      sí mostró superseries y nombres resueltos correctamente (ver arriba),
      pero es evidencia de otro atleta, no de esta corrida.

**Ninguno de los 7 criterios puede marcarse como aprobado ni como fallado con
evidencia real.** El código del allocator no mostró ningún síntoma de
regresión porque simplemente no tuvo oportunidad de ejecutarse.

### Qué queda sin verificar y por qué

- **Los 7 criterios del allocator, en su totalidad.** Requieren una corrida
  donde el plan generado sí incluya sesiones de fuerza. Eso exige, como
  mínimo, marcar "Pesas / Fuerza" en el perfil de disciplinas del atleta de
  prueba (Ajustes → Deporte y perfil base) **antes** de generar el plan —
  paso que este guion no incluía y que debería agregarse a la próxima versión
  del smoke.
- **Bloque `peak` de 4+ semanas específicamente.** La corrida real produjo
  `build` 5 semanas / `peak` 2 semanas, no lo que pedía el guion. Una
  próxima corrida debería usar un evento algo más lejano o verificar antes
  qué combinación de fecha + "forma física" produce un bloque `peak` largo,
  ya que el estimador del wizard (que mostró "Peak → Taper" antes de elegir
  forma física) no coincidió con el resultado final.
- **El camino de crash por conversión de dominancia/recorte** — declarado
  fuera de alcance del smoke desde el diseño original, cubierto solo por
  tests.
- **Convergencia multidispositivo del backfill de scope** — declarado fuera
  de alcance, prioridad 6 del roadmap.

### Estado dejado en el sistema (al cierre de Corrida 1)

- El plan draft `a5cb7bab-caf1-4395-888a-830735594499` quedó **sin aceptar y
  sin descartar**, visible solo en el flujo de creación de Juan Perez. No
  afecta el plan `active` existente ("Plan Arquetipo 4") ni sus sesiones. El
  owner puede descartarlo o aceptarlo según prefiera; este smoke no tomó esa
  decisión para no alterar datos de otro plan sin autorización explícita.
- No se modificó el perfil de Juan Perez ni se generó un segundo plan.

**Corrección posterior, no observada en el momento de escribir lo anterior:**
la consulta `select id, title, status from training_plans where athlete_id =
'ath_m_0eea9851-9b20-4af9-9a82-6c73fde5b9e6'` (Corrida 2) muestra que "Plan
Arquetipo 4 - Retorno con molestia de rodilla" (`34d9b7bf-d23f-4241-b312-07ab77940068`)
tiene `status = 'archived'`, no `active`. Además, **cuatro planes distintos de
Juan Perez tienen `status = 'active'` simultáneamente** ("Plan Arquetipo 3",
"Plan Arquetipo 2", "Plan Arquetipo 1", "Plan SMOKE B", "Plan SMOKE A" — cinco
en total, generados durante la QA de arquetipos de §28). Esto parece violar el
invariante de "un solo plan `active` por atleta" de `planLifecycle.ts`, pero
es **preexistente a este smoke** (no se tocó ningún plan en ninguna de las dos
corridas) y queda fuera de alcance de esta tarea. Se deja anotado para que el
owner decida si amerita investigación aparte; no se determinó la causa.

## Resultado — Corrida 2 (2026-08-25, misma fecha, sesión posterior)

**Veredicto global: INCONCLUSO — bloqueada por cuota diaria antes de llamar al
proveedor. Costo adicional: US$0.** Se corrigió con éxito la causa raíz de
Corrida 1 (perfil sin disciplina de fuerza) y se verificaron ambos gates del
guion corregido, pero la generación fue rechazada por el cliente antes de
cualquier llamada a la IA.

### Corrección del perfil

Con Juan Perez activo, en Ajustes → Deporte y perfil base:

- **Estado ANTES (confirmado por captura):** ninguna de las cinco disciplinas
  (Squash, Running, Bicicleta, Pesas/Fuerza, Movilidad) tenía realce activo;
  "Nombre visible"/"Edad"/"Peso" mostraban placeholders sin guardar — idéntico
  al estado que la Corrida 1 ya había diagnosticado como causa raíz.
- **Acción:** se tildó únicamente **"Pesas / Fuerza"** entre las disciplinas.
  Ningún otro campo del perfil (nombre, edad, peso, objetivo, disciplina
  principal auto-derivada, 1RM, lesiones, disponibilidad) fue tocado. Se
  guardó con "Guardar perfil" y se confirmó la persistencia recargando la
  página completa (`navigate` a `/settings`): "Pesas / Fuerza" seguía
  seleccionada tras el reload.
- **Verificación de que esto no contamina el deporte principal:** se leyó
  `src/pages/CompetitionPlanPage.tsx:191,399,538` antes de generar.
  `primarySportForEvent = getSportForEventType(existingEvent?.eventType)` se
  deriva del **tipo de evento** elegido en el wizard ("Torneo de squash"), no
  del campo "Disciplina principal" del perfil (que el formulario auto-rellenó
  a "Pesas / Fuerza" por ser la única disciplina tildada, un efecto colateral
  esperado de la UI). El fallback a `athleteProfile?.sportContext?.primarySport`
  solo aplica cuando `primarySportForEvent` es `null`, lo que no ocurre con un
  evento de tipo "Torneo de squash". Squash quedó confirmado como deporte
  principal en el resumen del wizard antes de generar (ver abajo).

### Gate previo a generar — ambos satisfechos

- **(a) Fuerza aparece como opción y quedó seleccionada:** confirmado por
  captura en el paso 5 del wizard ("¿Qué deportes complementarios incluimos?"),
  con "Fuerza" como única opción ofrecida (ya no decía "No hay deportes
  complementarios configurados") y seleccionada (resaltada en naranja). El
  resumen final del wizard (paso 7) mostró "Complementarios: Fuerza" y
  "Deporte principal: Squash".
- **(b) El estimador muestra un bloque de al menos 4 semanas de build:**
  verificado **dos veces, por dos caminos independientes**, antes de generar:
  1. Cálculo manual contra `resolvePhase` (`src/services/macroPlan.ts:655-671`)
     con evento a 70 días (2026-11-03) desde hoy (2026-08-25): con squash como
     `primarySport`, `weeksRemaining` decrece de 10 a 0 semana a semana, dando
     Base 1 semana (`weeksRemaining=10`), **Build 6 semanas**
     (`weeksRemaining` 9→4), Peak 2 semanas (3→2), Taper 1 semana (1), Race 1
     semana (0) — 11 semanas totales.
  2. Después de que el "Crear plan" fue bloqueado por cuota (ver abajo), la
     app mostró un preview local ("Tu plan") con el desglose de fases
     calculado localmente (sin IA, cálculo síncrono de macroplan): **"Base ·
     1 sem"** y **"Construcción · 6 sem"** con tags `SQUASH` + `FUERZA` en
     ambas fases — coincide exactamente con el cálculo manual. Esta segunda
     confirmación reforzó la primera pero no fue necesaria para decidir: la
     decisión de generar ya se había tomado con la evidencia (1).

### El bloqueo — cuota diaria agotada por Corrida 1

Al hacer clic en "Generar mi plan" → "CREAR PLAN" (paso de confirmación
intermedio, sin costo — todavía no llama al proveedor), la app respondió
inmediatamente con:

> "No pudimos completar la operación — No tienes cuota diaria suficiente para
> crear este plan: necesita 11 semanas y hoy te quedan 4 de 12. Vuelve mañana
> o reduce la cantidad de semanas."

Esto es el chequeo de cuota **local/cliente** (`DEFAULT_DAILY_AI_LIMITS.plan_builder_week`,
reserva de 12 semanas/día), no el rate limit server-side de `021`. Los 8
semanas que Corrida 1 generó (documentadas en su momento como "8 semanas a
planificar") dejaron sólo 4 de las 12 semanas diarias disponibles para Corrida
2, que pedía 11.

**Verificación de que no se gastó dinero en este intento:**

```sql
select id, title, status, created_at from training_plans
where athlete_id = 'ath_m_0eea9851-9b20-4af9-9a82-6c73fde5b9e6'
order by created_at desc limit 5;

select job_id, plan_id, outcome, estimated_cost_usd, created_at
from plan_generation_jobs order by created_at desc limit 5;
```

Ambas consultas, corridas **después** del intento bloqueado, muestran que la
fila más reciente en ambas tablas sigue siendo la de Corrida 1
(`a5cb7bab-caf1-4395-888a-830735594499` / `plan-bg-627d9833-...`,
`estimated_cost_usd: 0.206061`). No se creó ningún job ni plan nuevo. El
bloqueo ocurrió enteramente en el cliente, antes de cualquier llamada a la IA.

**Análisis de por qué era estructuralmente imposible ajustar el plan para
caber en las 4 semanas restantes sin sacrificar el criterio de precondición
6:** con squash como `primarySport`, `resolvePhase` siempre coloca peak (2
semanas) + taper (1 semana) + race (1 semana) = 4 semanas adicionales después
de cualquier bloque `build`, porque `weeksRemaining` decrece de a una semana
por vez y el evento (`race`) es siempre el final de la secuencia. Un plan con
un bloque `build` de 4+ semanas necesita como mínimo `4 (build) + 2 (peak) + 1
(taper) + 1 (race) = 8` semanas totales, casi el doble de las 4 disponibles
hoy. No existe una fecha de evento que produzca un `build` ≥ 4 dentro de una
cuota de 4 semanas totales. Se decidió no intentar una variante degradada
(menos de 4 semanas de build) porque no habría respondido la pregunta que este
smoke existe para responder, y se detuvo la corrida sin gastar más presupuesto.

### Se descartó el intento en la UI

Se hizo clic en "Descartar" en la pantalla de error, lo que limpió el estado
local del wizard. Una consulta posterior confirmó que la fila remota del plan
draft (`a5cb7bab-...`) **no cambió**: título, fechas y status siguen siendo los
de Corrida 1. La vista "Tu plan" que mostraba "(run 2)"/70 días/10 semanas era
un preview puramente local (cálculo síncrono de macroplan, sin persistencia
remota) que desapareció; no quedó ningún rastro server-side de Corrida 2 más
allá de lo ya usado por Corrida 1.

### Veredicto por criterio (Corrida 2)

Igual que Corrida 1: **los 7 criterios siguen sin evidencia**, porque no se
generó ningún plan nuevo. La diferencia es la causa: ya no es un dato de
perfil incorrecto (corregido y verificado), sino agotamiento de la cuota
diaria de cliente heredado del gasto de Corrida 1 en la misma sesión de 24 h.

### Qué queda sin verificar y por qué (Corrida 2)

- **Los 7 criterios del allocator, en su totalidad** — mismo motivo que
  Corrida 1, causa distinta. Requieren una corrida con cuota diaria intacta
  (≥ 11 semanas disponibles) que llegue hasta el proveedor.
- **La receta corregida en sí (perfil + fecha de evento) queda validada por
  dos caminos independientes de cálculo local**, pero no por una generación
  real: el paso que faltaba era exclusivamente la llamada a la IA, bloqueada
  por cuota, no por ningún defecto de configuración.

### Estado dejado en el sistema (al cierre de Corrida 2)

- El perfil de Juan Perez **quedó con "Pesas / Fuerza" tildada** entre sus
  disciplinas (cambio persistente, confirmado tras reload). Este es un cambio
  deliberado y necesario para que una futura corrida pueda evaluar el
  allocator; no se restauró al estado anterior porque hacerlo volvería a
  bloquear cualquier intento futuro por la misma causa que Corrida 1.
- El plan draft `a5cb7bab-...` de Corrida 1 sigue **sin aceptar y sin
  descartar** en la base de datos remota (el "Descartar" de Corrida 2 sólo
  limpió estado local del wizard, no la fila remota).
- No se generó ningún plan nuevo. No se modificó ningún plan `active` ni
  `archived` existente. No se gastó presupuesto adicional.
- **Para la próxima corrida:** con el perfil ya corregido, sólo falta esperar
  el reset de la cuota diaria (mañana) y repetir exactamente los pasos del
  wizard de esta Corrida 2 (evento "torneo de squash" a ~10 semanas, Fuerza
  seleccionada en el paso 5) para llegar directo a "Generar mi plan" sin
  repetir ningún diagnóstico.

## Resultado — Corrida 3 (2026-08-26)

**Veredicto global: FALLIDO.** La corrida sí llegó al proveedor y sí generó un
plan completo de fuerza, pero el allocator nunca emitió su telemetría en
ninguna de las 11 semanas, y el contenido real de fuerza del bloque `build`
(6 semanas) muestra exactamente el patrón de repetición de accesorios que
`strengthAllocator` existe para corregir (Causa B del Hallazgo 5, §28/§29).
Costo real: **US$0,295830** (job `plan-bg-a428581e-0f76-4d9d-949b-75e931bcad5f`,
`outcome: succeeded`, 34.442 tokens de entrada, 12.834 de salida). Costo
acumulado de las tres corridas: US$0,206061 + US$0 + US$0,295830 ≈
**US$0,50**.

### Estado heredado al iniciar

Se partió de un browser tab abierto de la sesión anterior, mostrando en
`/competition-plan` un plan "Smoke QA — Allocator Bloque Fuerza (run 2)" con
fases y semanas recientes ya "generadas" (S1 Base 0%, S3 Peak 20%, S4 Peak
33%). **Esto resultó ser estado local (Dexie/IndexedDB) sin persistencia
remota** — confirmado con dos consultas SQL independientes contra
`training_plans` que no mostraron ninguna fila con ese título ni ese
`total_weeks`, y con `read_network_requests` mostrando cero llamadas a
`training_plans`/`training_plan_weeks` durante la carga de esa página (sólo un
`OPTIONS` a `whoop_workouts`). El wizard de "Editar" reabrió ese draft local
nunca aceptado ni sincronizado; se reutilizó editando sólo el nombre del
evento a "(run 3)" para no arrastrar ambigüedad, sin tocar ningún dato server-side
existente. Este hallazgo lateral (divergencia local/remota en un draft nunca
aceptado) se anota aquí por transparencia pero **no se investiga**: es
consistente con que Corrida 2 haya calculado un preview local del macroplan sin
persistir nada, y no representa pérdida de datos reales de ningún plan
`active`.

### Gate previo — satisfecho

Perfil de Juan Perez conservaba "Pesas/Fuerza" tildada (cambio persistente de
Corrida 2, confirmado). Cuota diaria: no se verificó el número exacto antes de
generar (se infirió reset por cambio de día calendario, `getDailyAIUsage`
cuenta por `startOfLocalDay`), pero el wizard **no** mostró el error de cuota
que sí apareció en Corrida 2, y la generación completó sin interrupciones —
confirmando el reset de forma indirecta pero concluyente.

### Fase 1 — la corrida real

- **Evento:** "Smoke QA — Allocator Bloque Fuerza (run 3)", torneo de squash,
  3 nov 2026 (69 días desde hoy 26 ago).
- **Gate (a) — Fuerza ofrecida y seleccionada:** confirmado por screenshot del
  paso 5 del wizard, única opción complementaria ofrecida y ya resaltada.
- **Gate (b) — Bloque `build` ≥ 4 semanas:** confirmado **antes de generar**
  por dos vías — el estimador del wizard mostró "11 semanas a planificar,
  Base → Build → Peak → Taper"; y el resumen final (paso 7) repitió "3 nov
  2026 · 11 semanas incluyendo competencia". El desglose exacto por fase
  (Base 1 / Build 6 / Peak 2 / Taper 1 / Race 1) se confirmó **después**, al
  observar las 11 semanas generadas (`Sem1-2 Base`, `Sem3-8 Build`, `Sem9-10
  Peak`, `Sem11 Competencia`), coincidiendo con el cálculo manual de
  `resolvePhase` que Corrida 2 ya había verificado para la misma configuración
  de fecha.
- **Configuración:** idéntica a Corrida 2 (7 días, 5 sesiones/semana, 1 hora,
  sin doble sesión, "Rendir al máximo", nivel intermedio, "En buena forma",
  fatiga normal, sin restricciones).
- Las 11 semanas generaron sin errores visibles en el flujo de UI, terminando
  en "Tu plan está listo".
- `plan_id`: **`fd13848b-895c-4631-87f1-35d27758dd4e`** (status `draft`, **no
  aceptado ni descartado** — se dejó así deliberadamente, tal como pedía el
  encargo).

### Instrumento — lo que se observó

Query del documento ejecutada semana por semana contra
`training_plan_weeks` para `plan_id = 'fd13848b-895c-4631-87f1-35d27758dd4e'`.

**`generation_meta ? 'strengthAllocator'` es `false` en las 11 semanas
(week_index 0 a 10), sin excepción.** Verificado también que las 11 semanas sí
tienen `generation_meta ? 'repairWarnings' = true` (el repair sí corrió
completo) y que las sesiones de fuerza sí existen con `sessionType = "strength"`
y contenido real (9-10 ejercicios con nombres en español, ninguno crudo). Esto
descarta que el `NULL` sea por ausencia de sesiones de fuerza o por que el
repair no haya corrido — corrió, pero `recordStrengthAllocatorMetrics`
(`repairWeek.ts:2183-2196`) nunca llegó a escribir el objeto porque, según
lectura del código en el momento de diagnosticar (no confirmado con
instrumentación adicional en esta corrida), la condición de salida temprana
`if (!localMatrix || localMatrix.size === 0) return` se cumplió en las 11
semanas — es decir, el snapshot de fuerza que alimenta al allocator
(`captureStrengthTemplateSnapshot`, que se toma sobre `session.exercises`
**antes** de la fase de enriquecimiento/densificación, por diseño explícito del
"orden congelado") no tenía slots contables en ninguna semana.

**Hipótesis registrada durante el smoke:** los títulos de sesión observados ("Fuerza D1/D2 — ... (adaptación)",
"Fuerza — ... (densidad +)", "Fuerza — ... (Bloque Build)") sugieren que el
contenido real de ejercicios para este atleta/plan se construye mediante un
productor determinista posterior (`enhanceStrengthSessionExercises`, paso 15
del repair) y no viaja en la propuesta cruda del modelo que el allocator
snapshotea en el paso 6. Si eso es correcto, el allocator coordinado
simplemente **nunca ve** el contenido real que termina persistido, y toda su
maquinaria de coordinación queda sin efecto sobre esta clase de sesión. Esto
es una hipótesis basada en lectura de código y en el patrón de los datos, **no
una conclusión verificada durante esa corrida** — señalada aquí para que
quien retome el hallazgo no tenga que re-derivarla desde cero.

### Solape real de accesorios — Criterio 3, evaluado directamente sobre los datos

Independientemente de la telemetría ausente del allocator, el criterio
deportivo real (Criterio 3) se puede evaluar comparando directamente los
nombres de ejercicio persistidos en `sessions` para las 6 semanas de `build`
(week_index 2-7 = Sem3-Sem8). Se extrajeron las listas completas de ambas
sesiones de fuerza de cada semana. Resultado, excluyendo el ejercicio de
zona media/core en posición 1 (que sí rota correctamente, ver Criterio 5):

| Par de semanas | Sesión "Olímpico + Sentadilla" | Sesión "Press + Estocadas Unilaterales" |
|---|---|---|
| Sem3 (w2) vs Sem6 (w5) | **9/9 accesorios idénticos** | **9/9 accesorios idénticos** |
| Sem5 (w4) vs Sem8 (w7) | **9/9 accesorios idénticos** | **9/9 accesorios idénticos** |
| Sem4 (w3) vs Sem7 (w6) | **8/8 accesorios idénticos** | **8/8 accesorios idénticos** |
| Sem3 (w2) vs Sem5 (w4) | 6/9 accesorios compartidos | 6/9 accesorios compartidos (estimado, mismo patrón) |

Las semanas 3 y 6 del bloque (`w2`/`w5`) tienen listas de accesorios
**idénticas palabra por palabra** salvo el ejercicio de core, que sí difiere
correctamente por rotación. Lo mismo entre semanas 5 y 8 (`w4`/`w7`), y entre
semanas 4 y 7 (`w3`/`w6`). Este es el defecto original de Causa B
("dos semanas rotadas por política pueden converger bajo concurrencia 3"),
reproducido en una corrida real de producción, con una severidad mayor a la
descrita en §28 (que hablaba de 3 accesorios compartidos entre un par de
semanas; acá son hasta 9 de 9, y en tres pares distintos del mismo bloque de
6 semanas). **Criterio 3: FALLIDO**, con evidencia directa de contenido, no
inferida de telemetría.

### Veredicto por criterio

- **1. `unmaterializedCount = 0`.** **Sin cobertura** — el campo nunca se
  emitió en ninguna semana (`NULL`, no `0`). No se puede distinguir "el
  allocator corrió y no dejó nada sin materializar" de "el allocator no
  corrió"; la Fase 0 del documento ya advertía que esto por sí solo es un
  hallazgo.
- **2. `assignedCount = 0` sólo en la semana `indexInBlock = 0`.** **Sin
  cobertura**, mismo motivo.
- **3. Solape de accesorios contables < 3 entre cada par de semanas del
  bloque.** **FALLIDO**, con evidencia directa (ver tabla arriba): hasta 9/9
  accesorios compartidos entre pares no contiguos de un bloque de 6 semanas,
  en ambas sesiones de fuerza semanales.
- **4. Mínimo de ejercicios de fuerza por duración.** **APROBADO.** Las 12
  sesiones de fuerza del bloque `build` (60 min cada una, exige mínimo 4)
  tienen entre 8 y 10 ejercicios — muy por encima del mínimo.
- **5. Rotación del core inyectado / preservación de core real prescrito.**
  **APROBADO, con evidencia indirecta.** El ejercicio de zona media en
  posición 1 de cada sesión avanza en un ciclo de 4 consistente con
  `INJECTED_CORE_ROTATION` a lo largo de las 6 semanas del bloque (`Dead bug`
  → `Plancha frontal` → `Plancha lateral` → `Plancha frontal en fitball` →
  `Dead bug` → `Plancha frontal`, sincronizado entre ambas sesiones de la
  misma semana). Esto es notable porque confirma que la Causa A (§29, cerrada
  el 2026-08-14) sigue funcionando de forma independiente al allocator de
  Causa B, que es exactamente lo que el diseño predice — pero no se verificó
  contra el catálogo de ids crudos (se comparó por nombre en español
  únicamente, sin resolver `libraryRef`).
- **6. `allocator.divergent_template` anotado si aparece.** No aparece en
  ningún `repairWarnings` de las 11 semanas — pero, igual que en Corrida 1,
  esto no es evidencia positiva: es consecuencia de que el allocator nunca
  corrió (el código que emite ese warning depende de la misma resolución de
  bloque que nunca produjo una matriz no vacía).
- **7. UI: la semana abre, superseries visibles, sin ids crudos.**
  **Parcialmente observado.** La pantalla de revisión del Plan Builder
  (`/plans/builder`, plan sin aceptar) muestra las tarjetas de sesión con
  título y descripción correctos y sin ids crudos, pero es una vista resumen
  que no expande la lista de ejercicios ni el riel de superseries — esa vista
  detallada vive en el editor de semana real, al que no se pudo acceder sin
  aceptar el plan (prohibido explícitamente para este smoke). Verificado por
  SQL en su lugar: los 6 pares de sesiones del bloque `build` sí tienen
  `supersetGroup` asignado (4 a 7 ejercicios agrupados por sesión), y ningún
  nombre de ejercicio aparece como id crudo en ninguna de las 12 sesiones
  inspeccionadas — ambas señales indirectas y consistentes con un aprobado,
  pero sin la confirmación visual directa del riel de superserie que el
  criterio pedía.

### Primera revisión local posterior — causa confirmada y corrección (2026-08-27; conclusión superada abajo)

La causa quedó confirmada sin instrumentación remota. Desde el 2026-07-12,
antes de la QA de §28, `buildWeekStructuredSystemPromptMinimal` ordena
textualmente no incluir `exercises`. `generateWeekCore` usa ese prompt en el
camino productivo. Por lo tanto, `captureStrengthTemplateSnapshot` observaba
siempre una lista vacía; los ejercicios aparecían después mediante
`completeStrengthExercises` → `selectStrengthSession`. La salida temprana de
`recordStrengthAllocatorMetrics` y las listas repetidas tienen la misma causa.

Esto también corrige el encuadre histórico de §28: el modelo no devolvió una
plantilla de ejercicios clonada porque su contrato se lo impedía. La evidencia
persistida era la salida hidratada del selector determinista. El warning de
calidad fue real; la atribución al productor fue incorrecta.

La corrección local materializa primero **sólo** la salida del selector, toma
el snapshot antes de core y densidad y luego aplica el allocator. Como el
selector alterna BUILD_A/B/C (PEAK_A/B/C y TAPER_A/B), la matriz se coordina
por familia repetida; tratar A, B y C como si fueran una plantilla común crea
infactibilidad artificial. `templateSource` conserva este dominio en una
segunda pasada y evita cambiar la metadata de una sesión ya canónica.

Un fixture con la forma productiva exacta relevante —6 semanas `build`, dos
sesiones de fuerza por semana y ninguna con `exercises`— verifica localmente:

- `strengthAllocator` presente y `slotCount > 0` en 6/6 semanas;
- asignaciones reales en las segundas ocurrencias A→A, B→B y C→C;
- menos de 3 accesorios compartidos en cada sesión anclada de los pares
  0→3, 1→4 y 2→5;
- segunda pasada idempotente, incluido el marker de procedencia.

Costo de esta verificación: **US$0**. Esta fue la conclusión provisional antes
de subir la aserción al predicado semanal global. La sección "Revisión posterior
del gate local" la invalida como recomendación de deploy/re-smoke. La lectura de
telemetría por familia (`assignedCount = 0` en la primera A/B/C) sigue siendo
correcta para este intento, pero no acredita el Criterio 3.

### Qué queda sin verificar y por qué

- **El criterio deportivo final.** Está cubierto y verde localmente a costo
  API cero; falta observarlo en el primer bloque real posterior al deploy.
- **Confirmación visual directa del riel de superserie en la UI real de
  semana**, por no poder aceptar el plan.
- **Resolución de `libraryRef`/id crudo para el ciclo del core**, verificado
  sólo por nombre en español.
- **El camino de crash por conversión de dominancia/recorte** y la
  **convergencia multidispositivo del backfill de scope** — mismo alcance
  declarado que en las corridas 1 y 2, sin cambios.
- **Fase 0 no se repitió en esta sesión** (cero `ConstraintError`, check-ins
  previos visibles, sesión de fuerza histórica con superseries): se heredó la
  verificación de Corrida 1 sobre el mismo commit desplegado (`b2c8738`), sin
  deploy nuevo de por medio. Se comprobó únicamente la ausencia de errores de
  consola durante la propia generación (sin captura activada desde el inicio
  de la sesión, por lo que no cubre el arranque de la app).

### Revisión posterior del gate local — 2026-08-27

La verificación local anterior era insuficiente: medía sólo A→A/B→B/C→C y por
sesión anclada. El Criterio 3 y `quality.strength.repeated_template` operan
sobre semanas completas, comparan todas las familias y agregan las dos sesiones
de fuerza. Al reemplazar la aserción por ese predicado exacto, el mismo fixture
de 6 semanas arroja:

- **12/15 pares** con 3 o más accesorios contables compartidos;
- **5/5 semanas posteriores** con al menos un par infractor, la misma cantidad
  de semanas que el selector sin coordinación;
- los pares repetidos por familia mejoran de 14 a 2 por sesión, pero eso no
  alcanza para el contrato semanal global.

También se confirmó una fuente de no determinismo del intento local: sembrar la
prehidratación con `previousWeek` hacía que la columna de referencia dependiera
de qué worker aterrizara primero. La pre-pasada usa ahora entrada independiente;
`previousWeek` queda sólo para densidad/enriquecimiento posterior. Un payload
mixto sólo se considera selector-owned si **todas** sus sesiones lo son, y un
marker legacy sin `templateSource` cicatriza explícitamente como `provided`
(conserva el comportamiento homogéneo anterior; no se infiere procedencia).

**Veredicto de esta revisión, luego superado:** no desplegar mientras no se
decidiera si coordinar A/B/C, reducir densidad o revisar el contrato. El paso
siguiente fue precisamente separar clonación de continuidad deportiva.

### Contrato final y smoke local de cierre — 2026-08-27

El `≤2` semanal no describía el daño observado. Mezclaba el caso patológico
—sesiones 9/9 idénticas— con semanas que conservan parte de los accesorios para
progresar carga. En seis semanas con unas 14 asignaciones contables por semana,
satisfacer los 15 pares por novedad absoluta exigiría un pool irreal y podría
degradar la selección deportiva.

Se reexpresó `quality.strength.repeated_template` como detector de clonación:

- sesiones de fuerza ordenadas por fecha, bloque horario y título;
- comparación sólo entre el mismo ordinal semanal dentro del bloque;
- solape direccional: contables de la sesión posterior contra todo el contenido
  de la sesión anclada anterior;
- alerta con **≥3 compartidos y similitud ≥80%**, como máximo una por semana
  posterior contra el peor clon previo.

El umbral captura 7/8, 8/9 y 9/9 —cambio cosmético o nulo— y permite 6/8 y 6/9,
que pueden representar continuidad y progresión normales. La unión de D1+D2
ya no fabrica una alerta cuando ninguna de las dos sesiones está clonada.

Resultado del smoke local con el esqueleto productivo de seis semanas, sin
`exercises` de entrada:

- `strengthAllocator` presente y con slots en 6/6 semanas;
- asignaciones en las repeticiones A→A, B→B y C→C;
- prehidratación independiente de `previousWeek`;
- payload mixto fuera del dominio selector y marker legacy cicatrizado como
  `provided`;
- segunda pasada idempotente;
- **0 alertas `quality.strength.repeated_template`**;
- casos de contrato: 7/8 alerta, continuidad bajo 80% no alerta y D1/D2 no se
  agregan.

Control contrafactual sobre el mismo fixture:

| Medición | Motor viejo + detector nuevo | Motor nuevo + detector nuevo |
|---|---:|---:|
| Alertas `repeated_template` | **3** | **0** |
| 0→3, sesión 1 / sesión 2 | 88% / 88% | 25% / 0% |
| 1→4, sesión 1 / sesión 2 | 88% / 88% | 0% / 13% |
| 2→5, sesión 1 / sesión 2 | 88% / 88% | 13% / 13% |
| Peor par restante | — | 0→2 sesión 2: 6/8 = 75% |

Los tres avisos del control caen exactamente sobre las familias repetidas y
dicen 7 de 8 accesorios (88%). Por eso el cambio de predicado no amnistía el
defecto: el motor viejo sigue rojo y el nuevo elimina la causa. Los 9/9 y 8/8
observados en producción son 100% bajo el contrato nuevo. Vigilar el margen del
75% con restricciones de equipamiento en el primer bloque real.

Costo API: **US$0**. **Causa B cerrada en código y smoke local.** Quedan deploy
y observación del primer bloque real; no se recomienda otra generación completa
pagada dedicada a este punto.

### Estado dejado en el sistema

- El plan draft `fd13848b-895c-4631-87f1-35d27758dd4e` ("Plan Smoke QA —
  Allocator Bloque Fuerza (run 3)") quedó **sin aceptar y sin descartar** en
  la base de datos remota. No afecta ningún plan `active` existente de Juan
  Perez.
- El perfil de Juan Perez no fue modificado en esta corrida (ya tenía
  "Pesas/Fuerza" tildada desde Corrida 2).
- No se generó ningún plan adicional. No se tocó código de producción.
- Los cinco planes `status = 'active'` simultáneos de Juan Perez, detectados
  en Corrida 1 como residuo preexistente de la QA de arquetipos de §28, siguen
  presentes y sin investigar — mismo alcance que las corridas anteriores.
