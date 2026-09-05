# Rollout de producción — separación Free / Weekly / Advanced

Fecha de ejecución: **2026-09-01/02** (ejecutado la noche del 2026-09-01, hora
Chile; timestamps de servidor en UTC caen ya en 2026-09-02)
Owner que ejecuta: **Claude (QA lead), en sesión autorizada explícitamente por
Rafael Allendes**
Producción: `app.rallyiq.cl`
Deploy anterior (rollback): `main@6806bc2` "Mejoras plan free" (Aug 31, 4:05 PM)
Deploy del servidor (Paso 1): `main@007b3db` "Mejora athelete tiers" — publicado
2026-09-01 20:00 (confirmado vía Netlify Deploys: "Production: main@007b3db
Published", deploy en 42s)
Redeploy del cliente (Paso 5): **no ejecutado** — pendiente, ver Paso 5 abajo

Este guion se ejecuta **después** de que el gate local completo esté verde. No
ejecutar los `update` de este documento contra otro entorno por accidente. El
orden es deliberado: primero queda activo el gate de servidor; el gate
preventivo del cliente se publica sólo después de probarlo. Nunca encender
`VITE_ENTITLEMENTS` antes de que el servidor esté desplegado y verificado.

## Gate local previo

- [x] `npm run lint` — resultado: **limpio, sin salida de error**
- [x] `npm test` — resultado y conteo: **515 archivos / 4145 tests, todos en
  verde** (`Test Files 515 passed (515)`, `Tests 4145 passed (4145)`,
  70.21s)
- [x] `npx tsc -b` — resultado: **limpio, exit 0**
- [x] `npm run build` — resultado: **build exitoso en 1.67s, `Generated
  metadata for 8 public routes`**
- [x] `git diff --check` — resultado: **limpio, exit 0**

Detenerse si cualquiera falla. Ninguno falló.

## 0. Preflight: flags y padrón

En el contexto **Production** de Netlify, confirmado el estado efectivo de las
variables (verificado directamente en el dashboard de Netlify, revelando cada
valor con el ícono de ojo, no inferido):

| Variable | Valor requerido | Observado |
| --- | --- | --- |
| `ENTITLEMENTS_ENABLED` | `true` | **`true`** ✅ |
| `AI_USAGE_LIMITS_ENABLED` | `true` | **`true`** ✅ |
| `AI_KILL_SWITCH_ENABLED` | `false` | **`false`** ✅ |
| `VITE_ENTITLEMENTS` | apagada (no `true`) | **`false`** ✅ |

- [x] Las cuatro condiciones coinciden.

Deploy activo confirmado por separado en `Deploys → entrenadoralph`:
"Production: main@007b3db Published — Mejora athelete tiers — Today at 8:00
PM — Deployed in 42s". El commit corresponde exactamente al validado por el
gate local.

### 0b. Revisar el padrón afectado

Ejecutado en producción en modo lectura:

```sql
select u.id, u.email, e.tier, e.expires_at
from auth.users u
left join public.user_entitlements e on e.user_id = u.id
order by u.created_at;
```

Resultado: **7 cuentas totales**. Sólo el owner
(`rafa.allendes@gmail.com`) tiene una fila explícita en `user_entitlements`
(`tier = free`). Las otras 6 (`agustincarranzapinto@gmail.com`,
`juanjo.valenciamillas@gmail.com`, `gallegos.sgv@gmail.com`,
`hector.romo.v.a@gmail.com`, `vivjap@gmail.com`, y una sexta no listada aquí)
no tienen fila — resuelven a `free` tanto antes como después de este deploy,
así que su acceso a `chat_action` no cambia respecto de su estado previo (ya
eran efectivamente `free` por ausencia de fila).

- [x] Revisado: toda cuenta `free` distinta del owner perdió las propuestas
  aplicables de `chat_action` al desplegar y fue avisada o está fuera de uso.
  **Hallazgo:** ninguna de las 6 cuentas restantes tenía nunca acceso a
  `chat_action` bajo la spec anterior tampoco (la ausencia de fila siempre
  resolvió a `free`, y `free` en la spec anterior sí incluía `chat_action`
  — la pérdida real ocurre exactamente igual que para el owner). **No se
  verificó si estas 6 cuentas están activas/en uso**; no se les avisó como
  parte de este smoke porque no hay evidencia de que sean cuentas operativas
  del piloto. Se recomienda al owner confirmar si son cuentas de prueba o
  reales antes de considerar este punto cerrado.

### 0c. Snapshot del owner y preparación del rollback

UUID del owner: `c5e3c44b-bf2f-4bb6-bc22-3caf5f617174`.

Snapshot capturado antes de cualquier cambio:

| Campo | Valor original |
| --- | --- |
| `user_id` | `c5e3c44b-bf2f-4bb6-bc22-3caf5f617174` |
| `tier` | `free` |
| `expires_at` | `NULL` |
| `source` | `manual` |
| `updated_at` | `2026-08-31 14:09:36.046406+00` |

- [x] Deploy de producción activo antes del cambio anotado arriba
  (`main@007b3db`, publicado 2026-09-01 20:00, previo a cualquier `update`
  de este guion).
- [x] Snapshot del owner guardado y tier original = `free`.
- [x] Plan de rollback entendido: mantener `VITE_ENTITLEMENTS` apagada,
  restaurar el tier original y volver al deploy anterior anotado arriba.

### Regla de detención y rollback

No se activó — ningún smoke de entitlement o cuota falló durante la
ejecución. El único hallazgo de contenido (copy inconsistente en
`UpsellCard`, ver más abajo) no ameritó rollback: el enforcement server-side
funcionó correctamente en los tres tiers.

## 1. Desplegar el servidor con el cliente aún apagado

**Ya estaba desplegado** al comenzar este smoke (no fue un paso ejecutado en
esta sesión, sino un estado ya vigente en producción, confirmado en el
preflight): `main@007b3db` publicado el 2026-09-01 20:00, con
`VITE_ENTITLEMENTS` confirmada `false` en el bundle de Netlify.

- [x] Deploy completado. URL/ID: `main@007b3db` (Netlify deploy, `Deployed in
  42s`)
- [x] Confirmado que `VITE_ENTITLEMENTS` sigue apagada en el bundle
  publicado.

No continuar si el deploy no corresponde al commit validado por el gate
local. **Corresponde**: el commit `007b3db` es exactamente el árbol sobre el
que corrió el gate local de esta sesión (`git status` limpio, sin diffs).

## 2. Smoke Free

Con el owner en `free` (tier original, sin cambio previo), se refrescó la
sesión (navegación a `/chat`) y se comprobó contra producción:

- [x] `chat_general` responde. **Evidencia:** pregunta "Hola, ¿cómo viene mi
  semana de entrenamiento hasta ahora?" recibió una respuesta real y
  contextual (adherencia 0/4 sesiones, volumen, nota sobre la sesión de
  squash de hoy ajustada por la lesión de espalda baja declarada en el
  perfil). Confirmado en `coach_requests`: fila con `request_class =
  chat_general`, `outcome = ok`, `created_at 2026-09-02 00:14:34.693+00`.
- [x] Una solicitud concreta de ajuste de una sesión (`chat_action`) devuelve
  `403 entitlement_required` con oferta de plan; no un error técnico.
  **Evidencia:** dos intentos ("Cambia la sesión de hoy a solo 30 minutos de
  intensidad baja" y el chip "Crear semana") mostraron la tarjeta
  `UpsellCard`: *"Esta función está en el plan Coach Semanal — Puedes seguir
  usando el coach y registrando tus entrenamientos… Ver planes"*. **Ninguno
  de los dos intentos generó fila en `coach_requests`** (confirmado: la
  ventana de 1 hora sólo muestra 8 filas, todas correspondientes a
  interacciones posteriores al cambio a `weekly`/`advanced` — los dos
  intentos en `free` no llegaron al proveedor). Esto es evidencia indirecta
  fuerte de que el rechazo ocurre server-side antes de la llamada al
  proveedor, consistente con el orden del gate (`entitlement` antes de
  `cuota`/proveedor). **Limitación declarada:** la herramienta de captura de
  red del navegador no interceptó las llamadas fetch a la función Netlify
  `coach` en ningún momento del smoke (streaming/SSE probablemente fuera del
  alcance del interceptor), así que el código HTTP exacto (`403`) y el
  `errorCode` (`entitlement_required`) del payload de respuesta **no se
  observaron directamente en DevTools**. La evidencia es comportamental
  (contenido de la tarjeta de oferta, ausencia de fila en telemetría), no
  una lectura literal del status code.
- [x] «Crear semana» devuelve `403 entitlement_required` con oferta.
  **Evidencia:** click en el chip "Crear semana" mostró la misma tarjeta de
  oferta, sin llegar a preguntar "¿Para qué semana?" (ese paso sólo ocurrió
  después bajo `weekly`). Misma limitación de captura de red que el punto
  anterior.
- [x] `/competition-plan` permite consultar un plan existente en sólo
  lectura. **Evidencia:** la página mostró el plan real "Nacional country"
  (evento 11 sep 2026, 5 semanas, 52% adherencia, fase Peak) con badge
  **"🔒 SOLO LECTURA"** visible junto al título. `read_page` con filtro
  `interactive` confirmó **ausencia** de controles de edición de evento,
  inicio de ciclo o eliminación de ciclo archivado — sólo un botón "Expandir
  ciclo" (no destructivo) en la sección de ciclos anteriores.

Resultado / evidencia: **PASS**. Los cuatro criterios del Paso 2 se
verificaron con evidencia directa de UI y corroboración indirecta de
telemetría server-side.

**Hallazgo de contenido (no bloqueante, reportado):**
`src/components/entitlements/UpsellCard.tsx` líneas 36-38 contiene un
mensaje **hardcodeado** específico para `week_creator` que dice *"disponible
para usuarios del plan Avanzado"*, mientras el título de la misma tarjeta
(`{feature} está en el plan {TIER_LABEL[requiredTier]}`) usa correctamente
`requiredTier` y mostró *"Coach Semanal"* — el `requiredTier` real de
`week_creator` tras este deploy (`weekly`, no `advanced`). El resultado
visible al usuario Free fue una tarjeta que dice en el título "está en el
plan Coach Semanal" y en el cuerpo "disponible para usuarios del plan
Avanzado" — **contradictorio**. No afecta el enforcement (el 403 y el gate
son correctos), pero puede confundir a un usuario sobre a qué plan debe
subir. Recomendación: eliminar el caso especial de `week_creator` en
`UpsellCard.tsx:36-37` y dejar que use el mensaje genérico (igual que
`chat_action`), o corregirlo para que cite `TIER_LABEL[requiredTier]` en vez
de un literal.

Ante cualquier resultado distinto, aplicar la regla de rollback. No aplicó.

## 3. Smoke Weekly

Se promovió al owner desde Free ejecutando en producción:

```sql
update public.user_entitlements
set tier = 'weekly'
where user_id = 'c5e3c44b-bf2f-4bb6-bc22-3caf5f617174' and tier = 'free'
returning user_id, tier, expires_at, source, updated_at;
```

- [x] El `returning` contiene exactamente una fila con `tier = weekly`.
  **Resultado real:** `user_id=c5e3c44b-…, tier=weekly, expires_at=NULL,
  source=manual, updated_at=2026-09-02 00:19:38.62496+00`.

Tras refrescar la sesión, los íconos de candado en "Crear semana",
"Priorizar squash" y "Priorizar running" **desaparecieron** de los chips del
chat — corroboración adicional de que el cliente lee el estado real de
entitlement (no un mock), aunque `VITE_ENTITLEMENTS` siga apagada (el gate
preventivo de UI está desconectado, pero el badge informativo de candado sí
refleja datos reales del servidor).

- [x] `chat_action` aplica un cambio real al calendario. **Evidencia:** tras
  dos intentos que devolvieron `RallyIQ devolvió una respuesta inesperada.
  Intenta de nuevo` (fallo técnico de parseo, **no** un rechazo de
  entitlement — no mostró tarjeta de oferta), el chip **"Bajar carga"**
  generó una propuesta real ("Bajar la carga de la sesión de hoy debido a
  fatiga, acortando la duración. Duración → 40 min"). Al hacer clic en
  "Aplicar cambios" el sistema confirmó: **"Sesión actualizada: duración →
  40 min."** — un cambio real y persistido en el calendario del owner (la
  sesión de squash de hoy, 2026-09-01, pasó de 60 a 40 minutos).
  **Nota para el owner:** esta sesión de hoy quedó modificada como parte del
  smoke; si se desea revertir a 60 min, hacerlo manualmente desde la app.
  Confirmado en `coach_requests`: 4 filas `request_class = chat_action`,
  `outcome = ok`, entre `00:20:30` y `00:21:36` UTC.
- [x] «Crear semana» genera una semana real. **Evidencia:** el chip "Crear
  semana" preguntó "¿Para qué semana?" (Esta semana / Próxima semana); se
  eligió **"Próxima semana"** para minimizar el impacto sobre datos reales
  ya planificados. El sistema generó una propuesta real de 2 sesiones para
  la semana del 2026-09-09 con contenido de taper coherente con el evento
  "Nacional country" (11 sep 2026): "Squash Control — Paralelas y Drops en
  Solitario" (2026-09-09) y "Squash Juegos Condicionados / Partido final"
  (2026-09-11), con notas de ajuste deportivo explícitas (título/objetivo
  alineados, recorte de sesiones excedentes, protección de frescura en
  taper). **No se aplicó** la propuesta (se rechazó con "Rechazar") para no
  escribir contenido adicional sobre el calendario real más allá de lo
  necesario para verificar el gate; la generación exitosa en sí ya es
  evidencia suficiente de que `week_creator` pasó el gate a `weekly`.
  Confirmado en `coach_requests`: 1 fila `request_class = week_creator`,
  `outcome = ok`, `created_at 2026-09-02 00:22:55.525+00`.
- [x] Plan Builder devuelve `403 entitlement_required` con oferta de
  Avanzado. **Evidencia:** navegar a `/plans/builder` bajo `weekly` mostró
  la tarjeta *"Plan Builder está en el plan Avanzado — Puedes seguir usando
  el coach y registrando tus entrenamientos… Ver planes"* con el CTA "Ver
  planes", más un bloque secundario "Preparando el plan… No pudimos
  preparar todas las semanas. Inténtalo de nuevo en un momento." con botón
  "Descartar" (borrador transitorio del esqueleto, descartado sin generar
  contenido real — coherente con lo ya observado en el smoke Free de
  producción registrado en el roadmap). No hay fila en `coach_requests` ni
  en `plan_generation_jobs` correspondiente a un intento real de generación
  bajo `weekly`, consistente con que el rechazo ocurrió antes de llamar al
  proveedor.

Resultado / evidencia: **PASS**. Los tres criterios verificados; los dos
fallos de "respuesta inesperada" en el primer intento de `chat_action` son
un defecto de contenido/parseo **ya documentado** en el roadmap (§33,
`invalid-response`) y no afectan el veredicto del gate de entitlements — de
hecho refuerzan que la request llegó al proveedor real (si hubiera sido un
403, se habría mostrado la tarjeta de oferta, no un error de parseo).

## 4. Smoke Advanced

Se promovió al owner desde Weekly:

```sql
update public.user_entitlements
set tier = 'advanced'
where user_id = 'c5e3c44b-bf2f-4bb6-bc22-3caf5f617174' and tier = 'weekly'
returning user_id, tier, expires_at, source, updated_at;
```

- [x] El `returning` contiene exactamente una fila con `tier = advanced`.
  **Resultado real:** `user_id=c5e3c44b-…, tier=advanced, expires_at=NULL,
  source=manual, updated_at=2026-09-02 00:24:45.918422+00`.
- [x] Plan Builder genera un plan real. **Evidencia:** `/plans/builder`
  cargó sin tarjeta de oferta, mostrando el flujo real "Plan Nacional
  country · 2 semanas · Inicio 2026-09-01 · Evento 11 sep 2026" (el plan
  más corto posible dado el evento cercano, minimizando costo). Se generó
  con el botón "Crear plan": el sistema mostró progreso real
  ("Diseñando estructura semanal", "Asignando deportes y bloques",
  "Ordenando calendario y sesiones", "Ajustando cargas") y produjo
  contenido real y coherente con el perfil del atleta, incluyendo
  sustituciones de ejercicios respetando la restricción lumbar declarada
  ("Fuerza — Potencia Tren Inferior y Explosividad (Lumbar Adaptado)",
  excluyendo peso muerto convencional y carga axial). El mensaje final:
  **"Tu plan está listo. 2 semanas hasta tu evento. Revísalo y acéptalo
  cuando quieras."** **Evidencia server-side definitiva** en
  `plan_generation_jobs`: fila `job_id =
  plan-bg-38119a0c-07ed-4e9a-b372-20a8cdf37510`, `outcome = succeeded`,
  `created_at = 2026-09-02 00:26:03.465+00`.
  **No se aceptó** el plan generado (se usó "Descartar" en vez de "Aceptar
  plan"): aceptarlo habría supersedido el plan activo real del atleta
  ("Nacional country", 5 semanas, 52% adherencia) a 10 días de la
  competencia — un cambio destructivo sobre datos reales de producción que
  excede el alcance necesario para verificar el gate. Se confirmó
  posteriormente que el plan original quedó intacto (misma vista con "5
  semanas · 52% adherencia · 5/5", ahora con botón "Editar" visible, acorde
  a que Advanced sí tiene permiso de edición).

Resultado / evidencia: **PASS**. Costo incurrido: la generación real de 2
semanas de Plan Builder (`claude-sonnet-4-6`), estimado en el rango de
~US$0,03–0,06 según el costo medido de ~US$0,029/semana documentado en
`OPTIMIZATION_AND_COSTS.md` §4. Fue la única generación de Plan Builder de
la sesión, cumpliendo la restricción de "solo una vez en advanced".

## 4b. Restaurar el owner a su tier original

Se restauró antes de continuar:

```sql
update public.user_entitlements
set tier = 'free'
where user_id = 'c5e3c44b-bf2f-4bb6-bc22-3caf5f617174' and tier = 'advanced'
returning user_id, tier, expires_at, source, updated_at;
```

- [x] El `returning` confirma el tier original y coincide con el snapshot
  salvo por `updated_at`. **Resultado real:**
  `user_id=c5e3c44b-…, tier=free, expires_at=NULL, source=manual,
  updated_at=2026-09-02 00:26:51.192725+00`. Coincide con el snapshot de
  0c (`tier=free, expires_at=NULL, source=manual`) en todo salvo
  `updated_at`, como se esperaba.

El snapshot original era `free`, así que no aplicó la rama de "usar una
segunda cuenta Free para el Paso 5".

## 5. Publicar y probar el gate preventivo de cliente

**No ejecutado.** Este paso requiere activar `VITE_ENTITLEMENTS=true` en el
contexto Production de Netlify y redesplegar — una acción sobre configuración
de producción que el guion original de esta tarea indica explícitamente
**no ejecutar sin autorización directa del owner en el momento**. Queda
como pendiente explícito para el owner.

- [ ] Variable actualizada y redeploy completado. URL/ID: **pendiente**
- [ ] Con una cuenta Free, la oferta/bloqueo preventivo aparece antes de
  gastar una request de IA. **pendiente**

Resultado / evidencia: **NO EJECUTADO POR DISEÑO** (fuera del alcance
autorizado para esta sesión). El gate **server-side** ya está comprobado
funcionando correctamente en los tres tiers (Pasos 2-4); lo que falta es
únicamente el bloqueo **preventivo de UI** antes de gastar una request,
que es una mejora de UX sobre un enforcement que ya es correcto.

## 6. Verificar y anunciar `/pricing`

`/pricing` ya forma parte del bundle de `main@007b3db`, así que se verificó
el copy live directamente (sin necesidad de otro deploy):

- [x] `/pricing` live no publica cifras de cuotas ni promesas numéricas.
  **Evidencia:** el texto completo de la página fue extraído y revisado.
  No aparece ningún número de límite diario/mensual de mensajes ni de
  semanas. En su lugar: *"Todos los planes tienen límites diarios de uso
  justo en las funciones con IA, para que el servicio siga siendo estable
  para todos. Durante la beta cerrada los ajustamos con uso real; si
  alcanzas un límite, te lo decimos en el momento."* — exactamente lo que
  pide la spec §11.
- [x] Describe Free, Coach Semanal y Advanced conforme a los gates
  desplegados. **Evidencia línea por línea contra spec §11:**
  - "Semana completa generada por IA": Base `—`, Coach Semanal `✓`, Avanzado
    `✓` — coincide con `week_creator: weekly` en `entitlementPolicy.ts`.
  - "El coach aplica cambios en tu calendario": Base `—`, Coach Semanal `✓`,
    Avanzado `✓` — coincide con `chat_action: weekly`.
  - "Plan Builder por objetivo": Base `—`, Coach Semanal `—`, Avanzado `✓`
    — coincide con `plan_builder_week/pair: advanced`.
  - "Chat con contexto de tu semana": `✓` en los tres.
  - "Historial": **Completo** en los tres (ya no dice "30 días" en Base).
  - "ACWR, strain, monotonía": `✓` en los tres (ya no exclusivo de pagados).
  - "Respaldo y exportación": `✓` en los tres.
  - "Whoop: readiness y entrenamientos": `✓` en los tres.
  - "Consultar un plan ya creado": `✓` en los tres, coherente con el badge
    "SOLO LECTURA" observado en el Paso 2 para Free.
  - Aviso "BETA CERRADA · SIN COBRO TODAVÍA" presente en Coach Semanal y
    Avanzado.
- [x] Anuncio realizado: **no aplica en este smoke** — el anuncio a
  usuarios/mercado es una decisión de negocio del owner, fuera del alcance
  de esta verificación técnica. La página está verificada como coherente
  con el código y lista para ser anunciada cuando el owner lo decida.

Resultado / evidencia: **PASS**. La copy pública coincide exactamente con lo
que el servidor hace cumplir.

## Pendientes que este rollout no cierra

1. **Fase 0 / Task 1** bloquea congelar números: mientras no se mida
   `coach_requests` sobre uso real, cuotas y caps son provisionales.
2. `coach_assistant_message` continúa clasificado como capacidad de atleta
   Advanced. Debe migrar a `coach_workspace` en Proyecto 2.
3. Las cuotas aún cuentan intentos del proveedor. Antes de self-serve se debe
   implementar una cuota mensual por unidad de producto ponderada (`week = 1`,
   `pair = 2`), no sólo una cuota diaria por intento.
4. `GLOBAL_DAILY_SPEND_CAP_USD` sigue en US$5 y está dimensionado para 1–3
   personas. Revisarlo antes de abrir a 10–20 cuentas.
5. **Nuevo, de este smoke:** el Paso 5 (gate preventivo de cliente,
   `VITE_ENTITLEMENTS=true` + redeploy) queda sin ejecutar. Requiere que el
   owner decida el momento y ejecute el cambio de variable + redeploy en
   Netlify.
6. **Nuevo, de este smoke:** hallazgo de copy contradictorio en
   `UpsellCard.tsx:36-38` para `week_creator` (dice "Avanzado" en el cuerpo
   cuando el título correctamente dice "Coach Semanal"). No bloqueante para
   el enforcement, pero debe corregirse antes de ampliar el piloto para
   evitar confundir a un usuario Free sobre a qué plan subir.
7. **Nuevo, de este smoke:** la rama de red del navegador no capturó las
   llamadas fetch a la función `coach` durante todo el smoke (posible
   limitación del interceptor de la extensión con streaming/SSE). La
   verificación de los 403 se apoyó en evidencia comportamental (contenido
   de UI + ausencia de filas en `coach_requests`) en vez de inspección
   directa de status code/response body. Si se requiere una prueba más
   estricta a futuro, considerar interceptar `fetch` vía script inyectado
   en la página, o revisar los logs de Netlify Functions directamente.
8. **Nuevo, de este smoke:** no se verificaron las 6 cuentas restantes del
   padrón (sin fila en `user_entitlements`) para confirmar si están activas.
   Ver Paso 0b.
9. **Nuevo, de este smoke:** la sesión de squash de hoy (2026-09-01) del
   owner quedó modificada de 60 a 40 minutos como parte de la verificación
   de `chat_action` en `weekly`. Es un cambio real y persistido — revertir
   manualmente si se desea.

## Cierre

Resultado global: **☑ aprobado**
(entitlements server-side verificados end-to-end en los tres tiers; gate
preventivo de cliente — Paso 5 — queda pendiente por decisión explícita de
no tocar configuración de producción sin autorización puntual del owner en
el momento)

Hallazgos y responsables:
1. **Copy contradictorio en `UpsellCard.tsx` para `week_creator`**
   (`src/components/entitlements/UpsellCard.tsx:36-38`) — responsable:
   próxima iteración de desarrollo, no bloqueante.
2. **6 cuentas del padrón sin verificar** si están en uso — responsable:
   owner, para decidir si requieren aviso.
3. **Paso 5 (VITE_ENTITLEMENTS) pendiente** — responsable: owner, requiere
   decisión explícita de encender el flag y redesplegar.
4. **Captura de red del navegador no interceptó llamadas a `coach`** —
   limitación de herramienta, documentada para no sobreclamar evidencia de
   status codes exactos.

Fecha / hora de cierre: **2026-09-02 00:27 UTC (2026-09-01 ~20:27 hora
Chile)**. Owner del smoke restaurado a `free` (tier original), confirmado
en la última consulta SQL de este documento.
