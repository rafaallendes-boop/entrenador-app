# RallyIQ — Trabajo pendiente

Actualizado: 2026-09-09. Línea base: `main` = `origin/main` = `411556a`.

**Qué es este documento.** Sólo lo que falta ejecutar. El registro histórico de
entregas cerradas —secciones §1 a §35, cortes ejecutivos anteriores, checklists
completados y porcentajes de avance— se retiró el 2026-09-06 y vive en git: la
última versión completa es la de `6a02d32`
(`git show 6a02d32:PROJECT_REVIEW_AND_ROADMAP.md`). `CLAUDE.md` conserva el
resumen de arquitectura, las reglas del proyecto y el índice de bloques
recientes.

Las referencias con forma «§28», «§34», «roadmap §19» que aparecen en
`CLAUDE.md`, en los specs y en los smokes apuntan a esa versión archivada, no a
las secciones de este documento.

**Regla de este documento.** Una entrada se borra cuando está implementada
**y** verificada donde corresponde. Escribir el código no la cierra; aplicar una
migración tampoco si no se verificó su efecto.

## Estado en una frase

El core no es el cuello de botella: motor de planificación, Coach Workspace,
Whoop, consentimiento, entitlements, cuotas, observabilidad y la RLS por
membresía están en producción y verificados. Lo que separa el producto de un piloto pagado es **legal**, y lo
que lo separa de una beta de 10–20 es **una auditoría de aislamiento con una
segunda cuenta**.

---

## P0 — bloquean el piloto acompañado (1–3 personas)

### 1. Cierre legal

Único P0 real del piloto. El plazo lo controla un tercero; el abogado ya fue
contactado (2026-08-29).

- Enviar las cuatro URLs: `/terms`, `/privacy`, `/health-disclaimer`,
  `/whoop-disclaimer`.
- Objetivo declarado: beta cerrada y acompañada en Chile, planificación y
  seguimiento deportivo con IA, datos de salud/Whoop, cobro manual, exclusión
  expresa de consejo médico.
- Pedir cierre de: responsabilidad, uso aceptable, privacidad, retención,
  cancelación/reembolso y reaceptación por cambio de versión.
- Decidir **retención de `user_consents` al borrar cuenta** y alinear el copy de
  Ajustes con lo que se decida. Default actual: conservar la evidencia.
- Publicar la política de cancelación/reembolso en `/coaches`.

**Done:** textos firmados, decisión de retención implementada, política de
reembolso publicada.

### 2. Operación del piloto

- Oferta cerrada: duración, precio fundador, soporte incluido, reembolso.
- Canal de soporte único.
- Protocolo de revisión semanal escrito.
- Primer cliente elegido y onboardeado 1:1; revisar su primer plan a mano antes
  de entregarlo.
- Registro semanal: activación, semana creada, sesiones completadas, errores,
  requests bloqueadas, costo, feedback.
- **Criterio de parada inmediato:** pérdida o no convergencia de datos, acceso
  cruzado, gasto sin control, copy médico inseguro.

---

## P0 — bloquea ampliar a 10–20 cuentas externas

### 3. Auditoría de seguridad transversal

Nunca se hizo una pasada registrada. No se construye nada nuevo: se recorre un
checklist con evidencia por ítem.

- Segundo usuario real intentando leer y escribir datos ajenos.
- Inventario de variables de producción; ninguna `VITE_*` con secreto.
- `grep` de secretos sobre `dist/`.
- Headers y CSP de `netlify.toml` verificados **sobre el deploy**, no sobre el
  archivo.
- Revisión de las funciones Netlify que aceptan input del cliente y de las que
  usan service role.
- Revisar el riesgo aceptado de `018`: inserta telemetría con el token del
  usuario, así que un cliente de confianza podría forjar filas.

**Done:** checklist completo con evidencia y cero hallazgos altos abiertos.

---

## Separación del rol de cuenta (Entrega 1b y siguientes)

### 4. ✅ Corte de policies aplicado (2026-09-06)

`034_athlete_id_not_null.sql` y `031_retire_legacy_policies.sql` están
**aplicadas en producción**, en ese orden, y verificadas contra los valores que
el runbook predecía antes de ejecutarlas:

| Chequeo | Esperado | Medido |
|---|---:|---:|
| `policies_totales` | 31 | **31** |
| `athletes_policies` | 5 | **5** |
| `legacy_restantes` (el bootstrap de INSERT) | 1 | **1** |
| `columnas_aun_nullable` | 0 | **0** |
| `filas_sin_scope` | 0 | **0** |
| `auth_deletable_athlete_ids` instalado | sí | **true** |

`athletes` quedó con `athletes_delete_membership/DELETE`,
`athletes_insert_bootstrap_owner/INSERT`, `athletes_select_membership/SELECT`,
`athletes_update_self/UPDATE` y `athletes_write_coach/UPDATE`. La membresía es
ahora la única autoridad de RLS, salvo el bootstrap de INSERT de `athletes`, que
se conserva a propósito porque la membresía se siembra desde ese mismo insert.

Antes iba el bundle con el guard de scope (`58e4e38`), desplegado y verificado:
sync en «Al día · Última: recién», cola vacía, cero errores de consola y cero
filas sin `athlete_id` tras dos sync. El cliente fue primero a propósito —sólo
dejó de emitir filas que el servidor iba a rechazar igual—.

Detalle del diseño y de las alternativas descartadas en
[`specs/2026-09-06-migration-031-cut-design.md`](docs/superpowers/specs/2026-09-06-migration-031-cut-design.md);
pasos, criterios y rollback en
[`smokes/2026-09-06-031-cut-runbook.md`](docs/superpowers/smokes/2026-09-06-031-cut-runbook.md).

**Queda vivo el rollback:** `032_restore_legacy_policies.sql` recrea las 48
policies con el texto exacto del dump del 2026-09-05. No revierte `034` a
propósito.

**Salvedad abierta.** En la primera carga tras el deploy del bundle apareció un
`upsertRow:non_retriable` que no se pudo atribuir: el objeto de consola ya no
era recuperable y no volvió a ocurrir ni en el sync manual, ni en una recarga
con captura instalada, ni después del corte. No dejó residuo (cola vacía,
estado «Al día»). Si reaparece, la captura de eventos `[sync]` en consola lo
nombra.

### 5. `COACH_AUTHZ_MODE=enforce` — después de la Entrega 2

Es una decisión **separada** de `031`, con el momento óptimo contrario. Requiere
un sujeto que hoy no existe: producción tiene 0 atletas reclamados y ninguna
cuenta coach, así que la sombra recibe entradas casi idénticas a la legacy.

Lo que falta, y todo depende del mismo hecho:

- Ventana de auditoría con tráfico real. Hoy tiene **2 requests**, ambas de una
  cuenta `athlete` sin membresías. Necesita días de uso normal.
- **R3 sin aislar**: el borrado de roster se rechaza por el guard anterior
  (actor sin membresía coach), no por el que R3 nombra. Aislarlo exige un atleta
  reclamado.
- Equivalencia *general* de predicados: el cero de hoy acredita los datos de
  hoy, no la equivalencia en abstracto.

**Evidencia que se debe registrar después del smoke de Entrega 2:** días de uso
real de chat/sesiones y una generación cuando el saldo lo permita; logs
`[coach-authz]` con `wouldDeny = 0` para peticiones legítimas del coach al
transferido y `wouldGrant = 0`; lectura/escritura desde la híbrida ya revocada
rechazadas por membresía. La revocación del transferido no sustituye el R3 del
atleta reclamado: ese caso conserva su precondición SP1b. El cambio a enforce
requiere su propio smoke de cinco casos de la spec.

### 6. Entrega 2 — cuenta coach y roster

Es lo que genera el sujeto del punto 5. Sin esto, 1b cortaría con una regla que
nunca se ejerció contra su caso.

**Estado medido en producción el 2026-09-09:**

| | |
|---|---:|
| Cuentas en `auth.users` | 7 |
| Filas en `user_entitlements` | **1** |
| Roles distintos | `athlete` |
| Cuentas con rol `coach` | **0** |
| Atletas | 8 (7 con `linked_account_id`) |
| Atletas por owner | 1,1,1,1,1,1,**2** |
| Membresías | 8 — **`coach`=1, `self`=7** |
| Invitaciones | 0 |

Dos cosas que no estaban registradas: **ya existe una membresía `coach`** sobre
el gestionado de la cuenta híbrida —lo que falta no es la membresía, es la
*cuenta* con rol coach—, y **6 de 7 cuentas no tienen fila de entitlements**, así
que su rol nunca se escribió (resuelven a `free` por ausencia, que es correcto).

El servidor ya está listo: `030` trae `create_self_athlete`,
`admin_create_managed_athlete` —exige que el owner sea cuenta coach— y
`admin_delete_athlete`, más el trigger «una cuenta coach no puede tener self».
**Lo que falta es cliente.**

#### ✅ Paso 1 — el gate de UI lee `account_role` (2026-09-09)

`isCoachAccount` pasa a ser `rol === 'coach' || email en la allowlist`. El rol es
el criterio definitivo; `VITE_COACH_ACCOUNTS` queda como **puente** porque la
cuenta del owner es híbrida a propósito (rol `athlete` con self y gestionados,
Task 8 de 1a) y exigir rol coach hoy la dejaría fuera de su propio workspace.
La allowlist habilita **UI**: los permisos reales siguen en la RLS por membresía
y en `resolveCapability`.

Dos asimetrías que el cableado obligó a resolver, ambas del mismo tipo —
*habilitar* y *revocar* no usan el mismo criterio ante la falta de evidencia:

- `enforceCoachScopeGuard` **difiere** mientras el rol es `unknown` en vez de
  revocar. Aplicar el fail-closed de `isCoachAccount` habría destruido en cada
  arranque la selección de un coach real fuera de la allowlist.
- `CoachWorkspacePage` no redirige a Home hasta que los entitlements hidratan,
  por la misma razón. Los componentes leen el rol del **store**, no del holder:
  el holder no es reactivo y la UI no volvería a renderizar al confirmarse la
  identidad.

#### Implementación local de Entrega 2 — 2026-09-12

El cliente ya resuelve roster, selección, hidratación y accesos scoped por
membresía. Dexie v21 conserva un marcador por cuenta junto al snapshot: una
revocación total no reactiva el fallback por owner. El alta offline conserva
su membresía provisional únicamente hasta confirmar el INSERT remoto. Las escrituras scoped
revalidan membresía y estado dentro de la transacción. Un coach confirmado no
crea ni adopta self y puede dejar la selección en `none` al archivar/eliminar.

Sync comparte el UPDATE de atletas ajenos entre push y replay offline; los
pushes hijos no reinsertan al transferido. Los tres DELETE usan la misma
operación por ID y distinguen fila visible no borrable de fila ya ausente o
inaccesible. `037_coach_account_provisioning.sql` está escrita con pruebas
SQL ejecutables de provisión, transferencia, atomicidad, grants y RLS.

**Pendiente operativo, sin declarar producción validada:**

1. Desplegar el cliente y aplicar manualmente `037`.
2. Provisionar una cuenta coach nueva antes de su primer login y ejecutar el
   [runbook de Entrega 2](docs/superpowers/smokes/2026-09-12-coach-entrega-2-runbook.md),
   incluida la prueba de borrado de un transferido desechable.
3. Transferir la membresía del gestionado real conservando owner/linked y
   verificar persistencia, reingreso y revocación en la cuenta híbrida.
4. Retirar `VITE_COACH_ACCOUNTS` **sólo** con smoke APROBADO y sin gestionados
   pendientes en la cuenta híbrida. Task 9 del
   [plan corregido](docs/superpowers/plans/2026-09-12-coach-role-separation-entrega-2.md).
5. Acumular evidencia de auditoría de la cuenta coach y decidir `enforce` por
   separado (§5). No se cambió ese modo.

No se convierte ni se elimina la cuenta híbrida. Los perfiles de navegador
permanecen separados durante el piloto por los tombstones cross-usuario.

#### Entrega posterior — alta administrativa definitiva

Mover el alta managed desde el insert del cliente a un endpoint administrativo
con autorización propia que invoque `admin_create_managed_athlete`; luego
retirar `athletes_insert_bootstrap_owner`, adaptando también los re-upserts de
padres propios que hoy requieren INSERT. La entrega actual conserva ese camino.

#### Entrega posterior — vistas deportivas bajo `/coach/*`

Mover Dashboard, semana, día, chat y Plan Builder del gestionado al árbol coach,
con navegación interna consciente del prefijo y pruebas de enlaces directos y
retorno al Workspace. `/coach` tiene shell propio; por ahora las vistas
deportivas siguen dentro de AppShell con contexto del gestionado.

---

## Motor de entrenamiento — observación pendiente

Nada de esto justifica comprar una generación completa sólo para verificarlo.
Aprovechar la próxima corrida real. Confirmar saldo de API con el owner antes de
cualquier corrida pagada.

### 7. Efecto deportivo de la precisión de Plan Builder (`36f5570`)

Desplegado y sin observar: la única generación real posterior fue de 2 semanas
(taper + competencia), demasiado corta. Falta ver recalibración, meta de
partidos duros y M2/M3 sobre un bloque de fuerza en una generación larga.

### 8. Diversidad de fuerza en el primer bloque real

Causa A verificada en producción; Causa B cerrada en código y smoke local. Falta
observar en un bloque real: `strengthAllocator` presente en las semanas y
ausencia de sesiones ≥80% similares por ordinal. Vigilar el margen de cinco
puntos del detector proporcional, sobre todo con equipamiento restringido.

### 9. Riesgo residual del borrador corrupto

Un borrador local con `athlete_id` inválido produce un 500 cuyo copy invita a
reintentar, y reintentar no puede funcionar. La causa del incidente del
2026-09-05 quedó sin nombre porque el reset de caché destruyó la evidencia.
Detalle en el Paso 7 del
[runbook](docs/superpowers/smokes/2026-09-02-coach-role-1a-rollout.md).

### 10. Verificación manual de superseries

**Round-trip de backup cerrado el 2026-09-08.** El backup real de DEV (98
sesiones, 3,2 MB) se exportó y se pasó por `parseAppDataExport`: **5 sesiones
con `supersetGroup` y 11 con `libraryRef` sobreviven íntegras**. Evidencia en
[`2026-09-08-dev-smoke.md`](docs/superpowers/smokes/2026-09-08-dev-smoke.md).

Quedan las dos peticiones de chat (con y sin superseries), que consumen API.

---

## Asistente IA del Coach — condicional

### 11. Auditar el contenido

**Mantenerlo fuera del recorrido del alumno, o revisar cada mensaje a mano,
hasta cerrar esto.** Dos defectos siguen abiertos y dos corridas consecutivas no
pudieron tocarlos: la cuota local `coach_assistant_message` estaba agotada
(20/20) antes de empezar, con cero llamadas de red.

- Caracteres corrompidos en varios borradores.
- Tasa alta de `invalid-response`, que consume cuota.

Necesita una ventana de cuota nueva y cuatro borradores. El hardening de
transporte y la traza de etapas por `trackStage` ya están desplegados, así que
la próxima ocurrencia debería traer la etapa `provider_call` con su error: eso
discrimina entre los tres orígenes de `parse_error`.

---

## Entitlements, cuota y gasto — verificación posdeploy

Código y migraciones aplicadas; falta el smoke que cierra el rollout.

### 12. Gates de tier

- Confirmar que una cuenta Free **no crea borrador ni llama a IA** al entrar a
  Plan Builder.
- Probar los endpoints `enqueue-plan-generation` y `generate-plan-background`
  con Free (la segunda acepta llamadas directas y acuña su propio `jobId`).
- Confirmar que las preguntas de asesoría cuentan sólo contra `chat_general`.
- Recién entonces encender `VITE_ENTITLEMENTS`. **Nunca el cliente antes que el
  servidor.**

### 13. Cuota y kill switch

- Forzar un `429 quota_exceeded` desde otro contexto y confirmar
  `errorCode`/`detail`.
- Confirmar que el costo se acumula en la fila `(user_id, usage_date, bucket_id)`.
- Probar `AI_KILL_SWITCH_ENABLED=true` en un ambiente de prueba y volver a
  apagarlo. Recordar que Netlify exige redeploy para que un cambio de variable
  surta efecto.
- Registrar un runbook breve de incidente y cambio de flags.

---

## Sync y datos

### 14. Convergencia multi-dispositivo

Es el mayor riesgo técnico abierto. Requiere dos clientes autenticados reales.

- **Cascade de borrado de atleta**: el cambio destructivo de mayor alcance sin
  verificar. A borra un gestionado, B debe purgar su scope sin resucitarlo y sin
  tocar el self.
- Convergencia de Biblioteca y Planificación (el smoke aprobado fue de un solo
  dispositivo).
- Rama de **insert** `?on_conflict=athlete_id` de `athlete_profiles`: no se
  re-ejercitó porque ambas filas ya existen; sigue cubierta sólo por tests.

Cada divergencia reproducible se convierte primero en un caso rojo y después en
el cambio mínimo. No agregar otra capa de sync.

---

## Whoop — zonas de frecuencia cardíaca

### 15. Rollout de `019`

Implementado y sin desplegar. Orden fijo, legalmente sensible:

1. Aplicar `019_whoop_workout_zones.sql` **antes** del primer deploy (el cliente
   pide las columnas por nombre; pedir una inexistente devuelve 400 en cada pull).
2. Deploy 1 con `WHOOP_ZONES_ENABLED=false`.
3. Aprobación jurídica del paquete de dos publicaciones (`privacy@2026-08-08`,
   `whoop_biometric@2026-08-08`), hoy registradas y **no vigentes**.
4. Deploy 2 cambiando ambos `currentVersion` → detiene la sincronización de
   Whoop para quien no reacepte.
5. Reaceptación.
6. Deploy 3 encendiendo la ingestión.

Smoke escrito en
[`2026-08-08-whoop-hr-zones-smoke.md`](docs/superpowers/smokes/2026-08-08-whoop-hr-zones-smoke.md).

### 16. Verificación manual del `403 consent_required`

La rama server-side de Whoop está cubierta por tests pero nunca se observó
directamente. Incluirla en el próximo smoke de Whoop.

---

## Observabilidad y costo

### 17. Reporter de errores de frontend

**`035` y `036` están aplicadas en producción** — verificado el 2026-09-08 con
[`2026-09-08-035-036-applied-checks.sql`](supabase/queries/2026-09-08-035-036-applied-checks.sql):
tabla, RLS activa, policy única `client_error_events_select_own`, 4 índices, las
tres funciones `security definer` con EXECUTE sólo para `service_role`, SELECT de
`authenticated` acotado a las 14 columnas y `anon` sin ninguna. Cero filas: la
ingesta sigue apagada, que es el estado previsto. Evidencia y la trampa de los
grants por columna en
[`2026-09-08-035-036-applied-evidence.md`](docs/superpowers/smokes/2026-09-08-035-036-applied-evidence.md).

Lo pendiente es **la activación, no la migración**. La
[definición revisada de Entrega B](docs/superpowers/specs/2026-09-06-client-error-reporting-design.md)
registra las decisiones confirmadas: identidad de cuenta con RLS de lectura,
escritura sólo por endpoint, frames normalizados sin mensaje, severidad derivada,
30 días de retención, triage de `unknown` en v1 y sourcemaps privados por release.
Incluye política inicial de revisión manual y secuencia B1–B5 con criterios de
aceptación. Los seis hallazgos de revisión están incorporados en la definición.
Los manifiestos actual e históricos se
empaquetan con la función; sin manifiesto disponible se conservan categorías sin
frames. El archivo privado de mapas permite resolver esos frames en triage.
Siguiente paso: B1, contrato y normalizadores. B2 incluye SQL de verificación RLS
y runner manual de concurrencia sobre un proyecto de pruebas por provisionar.
`/ops` mostrará filas vencidas sin depender del reporte del cron. La activación depende
de revisión jurídica y verificación del archivo privado de builds.

### 18. Costo real del chat

`MODEL_PRICES` ya tiene los modelos y tiers correctos, así que las filas nuevas
traen `estimated_cost_usd`. Falta correr la agregación sobre una ventana real
—una semana de uso alcanza— y reportar cobertura en **dos** dimensiones, filas y
tokens, excluyendo los nulls. Las filas del 5 al 9 de agosto quedan en `null`
para siempre: el costo se resuelve al escribir.

`estimated_cost_usd = null` **nunca** significa cero.

### 19. Funnel por SQL

Cuatro de los seis pasos ya dejan fila sincronizada (`athletes`,
`training_plans`, `sessions`). Faltan de verdad registro → onboarding y la
conversión. **No instalar una herramienta de analytics para 20 usuarios.**

---

## Huecos de UI encontrados en el smoke del 2026-09-08

Los tres son alcanzables por un atleta y ninguno estaba registrado. No los
descubrió un test: los descubrió abrir la app. Detalle y evidencia en
[`2026-09-08-dev-smoke.md`](docs/superpowers/smokes/2026-09-08-dev-smoke.md).

### 25. El atleta no puede editar una sesión

`AddSessionModal` no recibe `initialValues`: el único editor con precarga es
`CoachSessionModal`, dentro del Coach Workspace, y `CoachWorkspacePage.tsx:208`
redirige a `/` si la cuenta no es coach. Una sesión creada a mano se puede
cambiar de estado, no de contenido.

Consecuencia para la verificación: el guard de dosis en edición
—«bajar a 12 min debe rechazar»— **no se puede smokear con una cuenta de
atleta**. Queda cubierto sólo por tests, y su prueba manual depende de la
Entrega 2 (§6), igual que §5.

### 26. El atleta no puede borrar una sesión propia

`WeeklyView.tsx:355` pasa `onDelete` **sólo** cuando `session.source === 'coach'`.
Una sesión creada desde el formulario manual no tiene forma de borrarse desde la
UI; `DayDetail` no ofrece ninguna. Se descubrió al limpiar los datos de prueba
del smoke, y es la razón por la que esa limpieza quedó a medias.

### 27. Un borrado local no basta: el sync repone

Borrar filas directamente en IndexedDB no deja tombstone, así que `runFullSync`
las restaura desde Supabase en la siguiente pasada. Es el contrato correcto
—§«la ausencia remota nunca es señal de borrado»— pero conviene tenerlo escrito:
**el entorno de desarrollo escribe en la Supabase de producción**, así que un
dato de prueba creado en `localhost` es un dato de producción.

Implicación operativa para el piloto (§2): antes de invitar a alguien hace falta
decidir si dev y prod comparten proyecto Supabase. Hoy lo comparten.

---

## Superficie pública y apps

### 20. Landing

- Screenshots reales del producto en `/coaches` (hoy placeholders). Tomarlos
  **después** del piloto, con datos de alguien que no sea el owner.
- Confirmar que Google procesó el sitemap.
- Pasada responsive a 360/768/1280.
- Si el punto 12 no cierra antes de invitar, etiquetar los tiers pagados como
  «beta cerrada — sin cobro todavía» y que el CTA lo diga.

### 21. OAuth de Google a producción

Bloqueante sólo para la app pública y para cuentas externas self-service; **no**
para el piloto operado desde la cuenta coach. Vive fuera del repo: pasar la
consent screen de `Testing` a `In production`, declarar dominios y redirect URIs
de web y esquema nativo, confirmar que los scopes son sólo `email`/`profile`.

**Done:** una cuenta que nunca estuvo en Test Users completa registro y login en
`app.rallyiq.cl` y en el build iOS, sin pantalla de advertencia.

### 22. iOS TestFlight

Cuenta Apple Developer, app en App Store Connect, íconos y splash finales,
privacy nutrition labels —Whoop implica declarar datos de salud—, build firmado.
Depende del punto 21.

---

## Escala — bloqueado por medición, a propósito

### 23. Load test de usuarios concurrentes

Ningún loadtest actual mide concurrencia entre usuarios: los planes corren
secuencialmente y el writer es en memoria. Hace falta un harness distinto: N
sesiones autenticadas simultáneas contra el deploy real, midiendo tasa de error
y p50/p90 por endpoint. Mock provider para transporte/Supabase en las cuatro
cargas, más **una sola** corrida chica con IA real.

### 24. Cola global para generaciones pesadas

**No construir todavía.** Se cierra de una de dos formas: el load test de 25/50
muestra fallas atribuibles a concurrencia entre usuarios y recién ahí se
especifica, o se cierra por escrito como innecesaria con el dato que lo
respalda.

---

## Lo que deliberadamente no se hace ahora

- Gateway de pago: cobrar por transferencia y conciliar a mano. Entitlements sin
  gateway funciona; gateway sin entitlements no sirve.
- Herramienta de analytics de terceros para 20 usuarios.
- Android: duplica la superficie de QA sin enseñar nada nuevo hasta que el
  funnel web esté validado.
- SP1b completo: el piloto se opera desde la cuenta coach.
- Más variantes de velocidad de Plan Builder bajo la regla actual. El
  control-contra-control demostró que dos controles idénticos dan `RECHAZADA`:
  lo que falla es la regla. Recalibrar barras contra el ruido medido y calcular
  potencia **antes** de gastar otra corrida.
- Ampliar el Asistente IA con semanas plantilla o edición rica de drills antes
  de estabilizar sus respuestas.

---

## Restricciones de alcance vigentes

- No abrir beta pública ni activar pagos automáticos.
- No vender Whoop como diagnóstico, prevención de lesiones o ajuste automático.
- No usar strain ni workouts de Whoop para autollenar `Session.actualRpe`.
- No auto-completar sesiones de atletas gestionados desde Whoop.
- No prometer prevención de lesiones ni mejoras porcentuales.
- No vender «IA ilimitada» como valor central.
- No invitar a 10 o más personas antes del primer piloto acompañado.
- No exponer datos biométricos sin consentimiento y borrado completo.

---

## Orden recomendado

| # | Trabajo | Por qué acá |
|---|---|---|
| 1 | Legal (§1) | El plazo lo controla un tercero: arranca el día 1 y corre en paralelo con todo |
| 2 | ~~Aplicación de `034` → `031`~~ — **hecho el 2026-09-06** (§4) | Se hizo mientras el corte era un no-op demostrable |
| 3 | Verificación posdeploy de tiers y cuota (§12, §13) | Barato, y condiciona cualquier ampliación |
| 4 | Piloto de 1–3 personas (§2) | Con legal cerrado; el resto se aprende con un cliente real |
| 5 | Observación del motor en la primera corrida larga real (§7, §8) | Sin comprar una generación sólo para esto |
| 6 | Auditoría de seguridad (§3) | Sobre la superficie final, antes de cuentas externas |
| 7 | Convergencia multi-dispositivo (§14) | Mayor riesgo técnico abierto; necesita dos dispositivos |
| 8 | Entrega 2, después `enforce` (§6, §5) | La Entrega 2 genera el sujeto que vuelve informativa la auditoría de rol |
| 9 | Observabilidad y funnel (§17, §18, §19) | Sin esto la beta no enseña |
| 10 | Beta de 10–20, OAuth, iOS, load test (§20–§23) | Post-piloto, si el funnel lo justifica |

Los huecos de UI del smoke (§25, §26) entran donde toque por costo: §26 —el
atleta no puede borrar lo que creó— es de una línea y bloquea la higiene de
cualquier prueba futura, así que conviene antes del piloto. §27 —dev y prod
comparten proyecto Supabase— es una decisión de infraestructura que hay que
tomar **antes** de invitar al primer cliente.
