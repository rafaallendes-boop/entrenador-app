# Smoke de producción — Coach Biblioteca + Planificación (deuda §11 / checklist K)

Fecha: 2026-08-14

URL: `https://entrenadoralph.netlify.app` (dominio detrás de `https://app.rallyiq.cl`;
se navegó directamente al dominio de Netlify por indicación del owner durante la
sesión, ya que `app.rallyiq.cl` resuelve con un salto extra que retrasaba la carga
de la extensión).

Cuenta autenticada: `rafa.allendes@gmail.com` (cuenta real de producción del
owner). Scope de trabajo: atleta gestionado **"Juan perez"**
(`ath_m_0eea9851-9b20-4af9-9a82-6c73fde5b9e6`), el mismo atleta de prueba usado en
los smokes de modalidad de squash (2026-08-11/12) y arquetipos (2026-08-13). La
sesión ya estaba autenticada y con Juan Perez activo al abrir la app (banner
"Entrenando a Juan perez" visible desde el primer screenshot); se verificó ese
banner antes de cada escritura y nunca se pulsó "Volver a ti". El self del owner
(~91 sesiones reales, Whoop conectado) **no fue tocado** en ningún momento.

**Contexto explícito de alcance:** la rama `qa/archetype-plans-findings`
(`915a933` + `a576a52`) está pusheada pero **no desplegada**. Todo lo observado
en este smoke corresponde al bundle ya vivo en producción — no se esperaba ni se buscó el
preview de impacto ampliado, el aviso post-commit en Semana, ni el ciclo de plan
con supersede.

**Costo API: cero.** No se generaron planes, no se usó el chat ni "Crear semana".
Todo lo probado fue Biblioteca/Planificación, que no llama al proveedor de IA.

## Qué se hizo

1. Se abrió Coach Workspace (`/coach`) y se confirmó el banner "Entrenando a Juan
   perez" y la tarjeta "Juan perez · Entrenando ahora" en Resumen.
2. **Biblioteca — crear desde cero:** se creó `SMOKE-LIB-Squash-Control` (squash,
   modalidad Control) agregando un drill vía el typeahead del catálogo (`boast` →
   resolvió "Boast y paralela en solitario — 50 ciclos", con la descripción
   canónica del drill autopoblada).
3. **Biblioteca — crear plantilla de fuerza con superserie manual:** se creó
   `SMOKE-LIB-Fuerza-Superset` con dos ejercicios (`Sentadilla goblet` + `Dead
   bug — control de tronco`, ambos `sets=3`) y se pulsó "AGRUPAR" para armar la
   superserie a mano (riel naranja + botón activo confirmados visualmente).
4. **Biblioteca — editar/renombrar:** se abrió "Editar" sobre la plantilla de
   fuerza, se confirmó que el grupo (riel + "AGRUPAR" activo) sobrevivió al
   round-trip de guardar/reabrir, se renombró el campo "Nombre de plantilla" a
   `SMOKE-LIB-Fuerza-Superset-Renamed` y se guardó.
5. **Biblioteca — supervivencia a hard refresh:** se navegó fuera y de vuelta a
   `/coach` (recarga completa de la SPA) y se confirmó que la lista de
   plantillas, incluido el rename, persistió en el almacenamiento local tras la
   recarga. Este paso no demuestra por sí solo convergencia remota por fila.
6. **Planificación — aplicar plantilla:** se aplicó `SMOKE-LIB-Squash-Control` al
   lunes 10/ago de la semana visible de Juan Perez, vía "Desde plantilla". El
   modal de materialización llegó prellenado con el drill y su descripción
   canónica; se guardó y la sesión apareció como "Planificada".
7. **Planificación — aplicar la misma plantilla dos veces el mismo día:** se
   aplicó `SMOKE-LIB-Fuerza-Superset` dos veces sobre el martes 11/ago. Ambas
   sesiones se crearon como entidades independientes, cada una mostrando en la
   vista Semana la etiqueta **"2 ejercicios · 1 superserie"** de forma
   independiente.
8. **Planificación — guardar sesión existente como plantilla:** desde el jueves
   13/ago (`Squash - Técnica Aplicada`, sesión preexistente del atleta) se usó
   "Guardar como plantilla", nombrándola `SMOKE-LIB-FromSession-Tecnica`; se
   verificó que apareció en Biblioteca.
9. **Biblioteca — borrado suave (tombstone):** se eliminó `SMOKE-LIB-Squash-Control`
   desde Biblioteca (modal de confirmación in-app, no nativo del navegador) y se
   confirmó que no reapareció tras un hard refresh completo de la SPA.
10. **Planificación — editar sesión y recálculo del resumen semanal:** se editó
    la sesión del lunes (`SMOKE-LIB-Squash-Control`, aún viva en el calendario en
    ese momento) cambiando la duración de 60 a 45 min. En la vista `/week` para
    Juan Perez (atleta activo), el día mostró **"1h" transitoriamente** hasta un
    hard refresh, tras el cual mostró **"45min"** correctamente — ver Hallazgo 1.
    El panel "Resumen semanal" (Weekly Action Loop) reflejó el conteo total de
    sesiones de la semana ("Llevas 0/6 sesiones completadas") incluyendo las
    sesiones agregadas por este smoke, confirmando que el resumen se recalcula.
11. **Superseries — caso negativo (paso 1 de §23, sustituto):** no se encontró en
    el calendario visible de Juan Perez ninguna sesión de fuerza genuinamente
    anterior a la entrega de superseries sin agrupar (ver Hallazgo 2 sobre
    sesiones "huérfanas"). Como sustituto se creó una sesión de fuerza temporal
    (`SMOKE-LIB-Fuerza-SinGrupo-TEMP`) con dos ejercicios sin pulsar "AGRUPAR"; en
    la vista Semana se confirmó que mostró **"2 ejercicios"** sin la etiqueta
    "superserie", confirmando que el agrupamiento es aditivo/opt-in y no se
    infiere retroactivamente. Se borró inmediatamente después de verificar (modal
    de confirmación in-app).
12. **Catálogo/picker — resolución por alias:** se probó el picker de fuerza con
    el nombre viejo `Sentadilla en zancada` (renombrado en §20 a `Zancada
    estática`) y resolvió correctamente a "Zancada estática · Fuerza · Tren
    inferior". Se cerró el modal sin guardar (prueba de solo lectura del
    typeahead).
13. **Selector de atleta:** se observó el combobox "Atleta" en Planificación (ya
    en "Juan perez"); **no se interactuó con él para cambiar al self**, para no
    arriesgar tocar los datos reales del owner. La invariancia del atleta activo
    se verificó de otra forma: el banner "Entrenando a Juan perez" nunca cambió
    durante ninguna de las operaciones anteriores, incluida la edición y
    aplicación de plantillas.
14. **Limpieza:** se borraron las tres sesiones creadas en el calendario de Juan
    Perez (`SMOKE-LIB-Fuerza-Superset` ×2 en martes y la sesión de squash del
    lunes, borrada durante esta limpieza) y las dos plantillas nuevas de
    Biblioteca (`SMOKE-LIB-Fuerza-Superset-Renamed`,
    `SMOKE-LIB-FromSession-Tecnica`). Al cierre, Biblioteca solo contiene
    `SMOKE Técnica partner`, una plantilla **preexistente de un smoke anterior**
    que no fue creada ni tocada en esta sesión — se dejó intacta porque no era
    mía y no interfirió con ninguna prueba.

## Qué se intentó y no se pudo hacer

- **Round-trip export→borrar local→import (paso 4 de §23):** se exportó el
  backup JSON exitosamente (`entrenador-backup-2026-08-14T23-31-02-805Z.json`,
  confirmado por el mensaje de la UI). **No se pudo inspeccionar el contenido del
  archivo**: tanto `Bash` (incluso con `dangerouslyDisableSandbox`) como el
  `Read` tool devolvieron `Operation not permitted` / `EPERM` al intentar leer
  cualquier archivo bajo `~/Downloads/` en esta máquina — es una restricción de
  permisos de macOS (TCC) del entorno, no de la app. **No se ejecutó el borrado
  de datos locales** ("Restablecer cuenta" en Ajustes es una acción a nivel de
  **toda la cuenta**, no por atleta: habría purgado también las ~91 sesiones
  reales y la conexión Whoop del self, algo explícitamente prohibido por las
  reglas de esta tarea). Este paso queda **sin verificar**, declarado
  explícitamente, y no se intentó ningún sucedáneo destructivo.
- **Verificación de ids de grupo independientes vía JSON crudo:** por la misma
  limitación de acceso a archivos, no se pudo diferenciar por id los dos grupos
  de superserie de las dos aplicaciones de `SMOKE-LIB-Fuerza-Superset` sobre el
  martes. La evidencia de independencia es **solo de UI**: ambas sesiones son
  entidades de calendario separadas, cada una renderiza su propia etiqueta
  "1 superserie", y el editor mostró el riel de agrupación acotado a cada
  sesión por separado. Es evidencia razonable pero no equivalente a diffear
  `supersetGroup` por id.
- **Pasos (5) y (6) de §23 (petición de chat con/sin superseries):** no se
  ejecutaron, tal como indicaba la tarea — cuestan API y quedan fuera de
  alcance de este smoke.

## Hallazgos

### Hallazgo 1 — Duración de sesión editada muestra valor transitorio incorrecto hasta refresh

Al editar la duración de una sesión de 60 a 45 min desde Planificación (coach) y
navegar inmediatamente a `/week` (vista del atleta activo), el día mostró
**"1h"** (el valor viejo) en vez de "45min". Un hard refresh completo de la SPA
corrigió el valor a "45min". No se investigó la causa raíz (posible caché en
memoria del store de la semana no invalidada tras una escritura desde la
superficie de coach hacia la superficie de atleta activo, dos rutas distintas
que comparten datos). **No bloqueante** para este smoke: el dato persistido es
correcto (confirmado tras refresh), solo la UI en caliente mantuvo el valor
obsoleto hasta recargar. Reportado para triage, no reproducido una segunda
vez de forma aislada para confirmar consistencia.

**Seguimiento de código posterior al smoke:** la causa quedó confirmada en la
rama de trabajo: las escrituras de Planificación actualizaban Dexie y el resumen,
pero no reconciliaban el store en memoria que consume `/week`; al coincidir ya
`requestedWeekStart`, la vista no disparaba otra carga. La corrección local
reconcilia create/update/delete solo cuando el atleta escrito es el atleta activo
y queda pendiente de deploy y verificación post-deploy.

### Hallazgo 2 — Sesión listada en Ajustes ausente del calendario visible (recurrencia del Hallazgo 7 del smoke de arquetipos)

El panel "Entrenamientos de RallyIQ" en Ajustes (para Juan Perez) lista una
sesión `Fuerza — Olímpico + Sentadilla (Día 1)` fechada 2026-08-14 (viernes,
"hoy" durante la sesión). Tanto la vista `/week` como la vista Planificación del
coach muestran ese mismo viernes como **"Día libre / Sin sesiones
planificadas"** para Juan Perez. Esto es coherente con el Hallazgo 7 documentado
en `docs/superpowers/smokes/2026-08-13-archetype-plans-prod-smoke.md` (planes
múltiples con sesiones parcialmente no trazables al calendario visible). No se
investigó más a fondo — está fuera de alcance de un smoke de Biblioteca/
Planificación y ya está señalado como pendiente de triage en el reporte
anterior. Desplegar `915a933` evita nuevas acumulaciones y agrega procedencia,
pero no puede reclamar ni borrar esta fila legacy porque carece de `planId`; si
se quiere que el calendario de Juan Perez vuelva a ser representativo, esta
sesión preexistente requiere limpieza manual y deliberada.

## Qué se verificó (evidencia directa)

- Biblioteca: crear desde cero (squash, con typeahead de catálogo) — **verificado**.
- Biblioteca: crear con superserie manual vía "AGRUPAR" (fuerza) — **verificado**.
- Biblioteca: editar y renombrar, con el grupo de superserie sobreviviendo el
  round-trip de guardar/reabrir — **verificado**.
- Biblioteca: supervivencia de la lista completa (incluido rename) tras hard
  refresh — **verificado**.
- Biblioteca: borrado suave con tombstone (no reaparece tras hard refresh) —
  **verificado**.
- Biblioteca: guardar sesión existente como plantilla desde Planificación —
  **verificado**.
- Planificación: aplicar plantilla a un día/atleta, materialización correcta
  como `Planificada` con contenido y descripción canónica del drill —
  **verificado**.
- Planificación: aplicar la misma plantilla de superserie dos veces el mismo
  día, con las dos sesiones mostrando independientemente "1 superserie" —
  **verificado por UI**; **no verificado por diff de ids crudos** (ver arriba).
- Planificación: edición de sesión y recálculo del resumen semanal (conteo
  total de sesiones) — **verificado**, con la salvedad del Hallazgo 1 sobre
  latencia de refresco de un valor específico.
- Catálogo/picker: typeahead resuelve drills de squash y ejercicios de fuerza,
  y un nombre viejo renombrado (`Sentadilla en zancada` → `Zancada estática`)
  sigue resolviendo por alias — **verificado**.
- Superseries §23 paso (1) — sesión vieja sin grupos se ve igual que antes:
  **no verificado directamente** (no se encontró una sesión genuinamente
  anterior a la entrega); se verificó en cambio el **caso negativo equivalente**
  (sesión nueva de dos ejercicios sin agrupar no muestra el badge) como
  evidencia indirecta razonable.
- Superseries §23 paso (2) — crear superserie a mano, guardar y recargar:
  **verificado** (pasos 3-5 de "Qué se hizo").
- Superseries §23 paso (3) — plantilla aplicada dos veces con grupos
  independientes: **verificado por UI**, no por id crudo.
- Superseries §23 paso (4) — export→borrar local→import: **no verificado**,
  declarado explícitamente por las razones de arriba (permiso de archivos +
  riesgo de borrado a nivel de cuenta completa).
- Superseries §23 pasos (5)-(6) — chat con/sin superseries: **fuera de
  alcance**, no ejecutados por costo de API, según lo indicado.
- Invariancia del atleta activo durante lecturas/escrituras de Planificación:
  **verificado** — el banner "Entrenando a Juan perez" no cambió en ningún
  momento de la sesión.

## Consola y red

- Único mensaje de consola observado en toda la sesión: `[sync] sync:failure`
  al cargar la app por primera vez (antes de cualquier acción de este smoke).
  Es el mismo patrón de error recurrente ya documentado como Hallazgo 2 en el
  smoke de arquetipos del 2026-08-13 (`sync:failure` / `queue:op_failed` /
  `queue:op_expired`); no se investigó la causa raíz por estar fuera de alcance.
  No se observaron nuevos errores de consola durante las operaciones de
  Biblioteca/Planificación en sí (creación, edición, aplicación de plantillas,
  borrado).
- No se leyeron requests de red específicos de Netlify Functions/Supabase en
  detalle (no era el foco de este smoke, que no involucra el proveedor de IA);
  no se observó ningún indicador visual de fallo de sync tras las escrituras
  (los datos persistieron localmente en cada verificación con hard refresh).
  La convergencia remota queda pendiente del smoke multi-dispositivo.
- No se disparó ningún `alert`/`confirm` nativo del navegador. Los dos diálogos
  de confirmación de borrado ("Eliminar plantilla", "Eliminar sesión de
  RallyIQ") son modales in-app de React, no nativos, y fueron identificados como
  tales antes de interactuar con ellos.

## Resultado

- Entorno: `https://entrenadoralph.netlify.app` (detrás de `app.rallyiq.cl`),
  cuenta `rafa.allendes@gmail.com`, atleta gestionado Juan Perez.
- Estado final del atleta: calendario de Juan Perez sin residuos de este smoke
  (todas las sesiones creadas fueron borradas); Biblioteca con una sola
  plantilla, `SMOKE Técnica partner`, preexistente de un smoke anterior y no
  tocada en esta sesión.
- Costo API: **cero** — no se generaron planes ni se usó el chat.
- Hallazgos: 2, no bloqueantes, documentados arriba con evidencia reproducible.
- **Veredicto: APROBADO, con huecos de cobertura declarados.** El flujo
  central de Biblioteca (CRUD, tombstone, persistencia local tras recarga) y
  Planificación (aplicar plantilla, materialización, edición, recálculo de
  resumen, catálogo con alias) funciona correctamente end-to-end con sesión real, cerrando la
  deuda de verificación autenticada en un dispositivo del proyecto (roadmap
  §11, checklist K). La convergencia remota sigue pendiente de una prueba
  multi-dispositivo. El round-trip de backup completo (§23 paso 4) queda **sin
  verificar** por una restricción de permisos de archivos del entorno de ejecución, no por un fallo
  de la app — se recomienda repetir ese paso puntual desde un entorno con acceso
  de archivos a `~/Downloads` o verificarlo manualmente. La independencia de
  ids de grupo entre aplicaciones repetidas de plantilla quedó verificada por UI
  pero no por inspección de datos crudos.
