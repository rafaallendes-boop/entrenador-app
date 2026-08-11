# Smoke de producción — Proyectos A y B completos

Fecha objetivo: 2026-08-12

URL actual: `https://entrenadoralph.netlify.app/`

Commit mínimo esperado: `2b00e6e` (o un descendiente).

Spec: `docs/superpowers/specs/2026-08-10-squash-session-intent-and-event-window-design.md`

Plan: `docs/superpowers/plans/2026-08-10-squash-session-intent-and-event-window.md`

**Migraciones: ninguna.** Dexie sigue en v19 y no hay migración SQL asociada.
Si el deploy pide aplicar una migración, detener el smoke: no pertenece a A ni
a B0–B3.

## Alcance exacto

Este runbook valida:

- Proyecto A completo: catálogo, hidratador, exposición competitiva, Plan
  Builder, Crear semana, chat, formulario, plantillas y compatibilidad;
- Proyecto B0–B5: modelo de ventana, captura/presentación, firma del draft,
  macroplan, shell, cierre de ciclo, generación/repair/validator/fallback y
  contexto de Chat/Crear semana.

El propio runbook completa B6. Para limitar consumo, usa **un solo plan pagado
corto**, con un campeonato cercano que cruza dos semanas. Ese
mismo plan cubre Plan Builder de A y la generación multijornada de B. El flujo
completo usa tres solicitudes de Chat y dos de Crear semana; no repetir salvo
que exista un hallazgo reproducible.

La verificación de Whoop con `WHOOP_ZONES_ENABLED=true` no consume IA y está en
`docs/superpowers/smokes/2026-08-08-whoop-hr-zones-smoke.md`. Ejecutarla contra
el mismo bundle, sin mezclar sus requisitos SQL con A/B: **A/B no agrega
migraciones**.

## Reglas de corte

Detener y marcar **RECHAZADO** si ocurre cualquiera de estos casos:

- una intención técnica con el texto “control de longitud” termina como
  `control/solo`;
- una sesión nueva cruza drills principales `control/solo` con
  `technical/partner`;
- el sistema borra o reclasifica silenciosamente un drill incompatible elegido
  de forma explícita;
- una sesión nueva queda con `executionMode="either"`;
- una semana `race` agrega un partido extra además del evento;
- una semana `race` contiene más de dos apoyos, carga prohibida o un apoyo fuera
  de sus topes;
- el día clave contiene otra sesión además del ancla competitiva;
- un campeonato pasa a `transition` antes del día siguiente a su término;
- el shell omite una de las semanas calendario que toca el campeonato;
- mover inicio/término reutiliza el shell anterior;
- se guarda un término anterior al inicio o un día clave fuera de la ventana;
- datos de un atleta aparecen bajo otro atleta.

Un error de proveedor o saldo insuficiente no demuestra un bug funcional. En
ese caso guardar la evidencia, marcar los casos pagados como **NO EJECUTADOS** y
no aprobar el smoke completo hasta repetirlos.

## Preparación

- [ ] **P1.** Confirmar en Netlify que el deploy está **Published** y corresponde
  al commit anotado arriba o a un descendiente. Debe incluir `66be4be` y el
  commit del paquete B4+B5; no basta `9946e7f`.

- [ ] **P2.** Abrir la URL en una ventana incógnita, iniciar sesión y hacer hard
  refresh. Registrar el bundle servido:

```bash
curl -fsSL https://entrenadoralph.netlify.app/ \
  | grep -oE 'assets/index-[^" ]+\.js' \
  | head -n 1
```

- [ ] **P3.** Usar uno o, idealmente, dos atletas descartables: `SMOKE-A` para
  formulario/chat y `SMOKE-B` para rango y el único plan pagado. Crear un ciclo
  nuevo puede cerrar el ciclo anterior; no usar un atleta real con plan activo.

- [ ] **P4.** Desde Ajustes, exportar un respaldo antes de empezar. Anotar nombre
  y hora del archivo. No ejecutar una importación destructiva en una cuenta con
  datos reales.

- [ ] **P5.** Confirmar saldo para un plan corto, tres solicitudes de Chat y dos
  de Crear semana. Este documento no asume que el saldo histórico siga
  disponible.

- [ ] **P6.** Abrir DevTools → Network, activar **Preserve log**, y abrir también
  DevTools → Application → IndexedDB. No compartir capturas del `systemPrompt`:
  contiene contexto privado del atleta.

- [ ] **P7.** Confirmar que `EntrenadorDB` sigue en versión 19:

```js
(await indexedDB.databases()).find((entry) => entry.name === 'EntrenadorDB')
```

- [ ] **P8.** Guardar este helper de solo lectura en la consola. Se reutiliza en
  todo el smoke:

```js
async function smokeReadStore(storeName) {
  const connection = await new Promise((resolve, reject) => {
    const request = indexedDB.open('EntrenadorDB')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const rows = await new Promise((resolve, reject) => {
    const tx = connection.transaction(storeName, 'readonly')
    const request = tx.objectStore(storeName).getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  connection.close()
  return rows
}

async function smokeSquashSessions() {
  const sessions = await smokeReadStore('sessions')
  console.table(sessions
    .filter((session) => session.type === 'squash')
    .sort((a, b) => `${b.date}${b.timeBlock}`.localeCompare(`${a.date}${a.timeBlock}`))
    .map((session) => ({
      id: session.id,
      athleteId: session.athleteId,
      date: session.date,
      title: session.title,
      subtype: session.subtype,
      sessionKind: session.squashDetails?.sessionKind,
      sessionMode: session.squashDetails?.sessionMode,
      blockKinds: session.squashDetails?.blocks?.map((block) => block.kind).join(' + '),
      drills: session.squashDetails?.drills?.map((drill) => drill.name).join(' | '),
    })))
}
```

## Gate 0 — Verificación técnica antes del navegador

Ejecutar contra el mismo commit publicado:

```bash
npm test
npx tsc -b --pretty false
npm run lint
npm run build
git diff --check
```

- [ ] **0.1.** Todos los comandos terminan en verde.
- [ ] **0.2.** No aparece una migración nueva en el diff/deploy.
- [ ] **0.3.** La app abre sin error de upgrade, pantalla en blanco ni errores
  nuevos en consola.

## Caso A1 — Formulario manual y catálogo

Crear cuatro sesiones manuales de squash en días futuros distintos.

| Sesión | Modalidad elegida | Contenido principal esperado |
|---|---|---|
| `SMOKE control` | Control (solo) | pelota, `control/solo` |
| `SMOKE técnica — control de longitud` | Técnico (con partner) | cooperativo, `technical/partner` |
| `SMOKE sombras` | Sombras (sin pelota) | sin pelota, `shadows/solo` |
| `SMOKE partido` | Partido → Práctica | rival/marcador, `match/match` |

- [ ] **A1.1.** El formulario ofrece exactamente las cuatro modalidades; no
  ofrece `Mixto` como intención nueva.

- [ ] **A1.2.** Al elegir Partido aparecen los contextos **Práctica** y
  **Competencia**. Guardar primero Práctica, editar, cambiar a Competencia y
  comprobar que la tarjeta distingue ambos estados.

- [ ] **A1.3.** En **Agregar desde biblioteca**, la lista cambia al cambiar la
  modalidad. Un drill de control no aparece en Técnico y un drill cooperativo
  no aparece en Control.

- [ ] **A1.4.** En la sesión técnica buscar y agregar uno de estos drills
  personales; debe aparecer bajo Técnico:

  - `Juego condicionado: pasillo completo por lado`;
  - `Paralelas de fondo: cruce solo con volea`;
  - `Cruce de volea a dos paredes y respuesta paralela`;
  - `Cruce de volea a dos paredes con opción de drop`;
  - `Cruce de volea a dos paredes: adelante elige dirección`.

- [ ] **A1.5.** Escribir literalmente “control de longitud” en título u objetivo
  de la sesión Técnica. Guardar, reabrir y confirmar que sigue siendo Técnica.

- [ ] **A1.6.** Agregar manualmente un ejercicio personalizado sin referencia de
  catálogo. Debe guardarse bajo la modalidad elegida.

- [ ] **A1.7.** Provocar el caso incompatible de forma controlada: agregar un
  drill conocido, cambiar después la modalidad a otra incompatible y guardar.
  Debe aparecer una advertencia; el guardado sigue permitido y el drill no se
  borra ni se reclasifica.

- [ ] **A1.8.** Ejecutar `await smokeSquashSessions()`. Las cuatro filas nuevas
  conservan `sessionKind`, `subtype` y `sessionMode` coherentes. Ninguna escribe
  `executionMode="either"` ni una modalidad deducida desde el texto.

## Caso A2 — Plantillas, edición y compatibilidad

- [ ] **A2.1.** Desde una sesión técnica, pulsar **Guardar como plantilla** y
  nombrarla `SMOKE plantilla técnica`.

- [ ] **A2.2.** En otro día pulsar **Desde plantilla**, aplicarla y guardar. La
  sesión nueva conserva modalidad Técnica, drills, orden y referencias del
  catálogo.

- [ ] **A2.3.** Editar la plantilla en la Biblioteca, guardar y volver a
  aplicarla. La modalidad no cae al default ni cambia por el título/objetivo.

- [ ] **A2.4.** Exportar un respaldo y buscar en el JSON las sesiones y la
  plantilla `SMOKE`. Debe conservar `squashDetails.sessionKind`, bloques,
  `libraryRef` y el contexto del partido.

- [ ] **A2.5.** Si existe una sesión histórica `mixed`, abrirla y guardarla sin
  cambiar su contenido. Debe seguir legible/editable y no perder bloques. Si no
  existe una real, marcar **NO REPRODUCIBLE**; no fabricar datos en Dexie.

- [ ] **A2.6.** Solo en cuenta descartable: importar el respaldo en modo seguro,
  reabrir las sesiones y repetir `await smokeSquashSessions()`. No debe perderse
  la modalidad. En una cuenta real, dejar este paso **NO EJECUTADO POR SEGURIDAD**.

## Caso A3 — Chat: las cuatro intenciones estructuradas

Enviar **una sola solicitud** que pida las cuatro acciones en fechas libres:

> Agrega cuatro sesiones de squash en días futuros distintos: una de control en
> solitario de 45 minutos con paralelas y drops; una técnica con partner de 60
> minutos para control de longitud y decisiones en el pasillo; una de sombras
> sin pelota de 30 minutos RPE 5; y un partido de práctica al mejor de 5 juegos.

- [ ] **A3.1.** La respuesta contiene cuatro propuestas y el drawer de cada una
  muestra la modalidad esperada antes de aplicar.

- [ ] **A3.2.** La técnica con “control de longitud” queda `technical` y usa
  contenido `partner`; no se convierte a `control`.

- [ ] **A3.3.** Control usa contenido principal `control/solo`; Sombras no usa
  pelota; Partido queda `sessionMode=practice_match` y `sessionKind=match`.

- [ ] **A3.4.** Pedir después: “Reduce a 45 minutos la sesión técnica que
  acabamos de crear, sin cambiar su modalidad”. La propuesta `update_session`
  y la sesión aplicada conservan `technical`.

- [ ] **A3.5.** Repetir `await smokeSquashSessions()` y guardar una captura de
  las cinco acciones aplicadas. Revisar Network: respuestas 2xx, sin fallback o
  contradicción visible en warnings.

## Caso A4 — Crear semana

- [ ] **A4.1.** En el atleta `SMOKE-A`, configurar squash como deporte principal,
  partner disponible y una semana con días suficientes.

- [ ] **A4.2.** Ejecutar **Crear semana** con una instrucción que pida una sesión
  técnica con partner para “control de longitud”, una de control solo y una de
  sombras. Aplicar la propuesta.

- [ ] **A4.3.** Comprobar en las tarjetas y en IndexedDB que cada sesión conserva
  su modalidad. `focusKey`, título y objetivo no cambian la identidad.

- [ ] **A4.4.** La semana contiene una exposición competitiva si es ejecutable.
  Con `partnerAvailability=solo`, restricción médica o sobrecarga, no debe
  forzarla. No cambiar una restricción médica real solo para probar.

- [ ] **A4.5.** Ninguna sesión mezcla pelota `control` y `technical`. Los
  accesorios admitidos sí pueden existir: control+sombras,
  technical+sombras, technical+finisher corto de match cuando la fase lo
  permita, o match+activación breve de sombras. `sessionKind` sigue describiendo
  la modalidad principal.

## Caso A5 — Plan Builder y exposición competitiva A2.5

Este es el caso de mayor costo y se ejecuta **una sola vez**. Usar `SMOKE-B` y
el campeonato corto de B1. Elegir el inicio de plan más tardío permitido o la
opción equivalente que deje sólo 1–2 semanas, partner disponible, fatiga normal
y squash principal. Si el preview supera 3 semanas, volver atrás y acercar el
evento; no pagar un plan largo para este smoke.

Orden operativo: antes de pulsar **Crear plan**, saltar a B1 y completar
B1.1–B1.7 y las mutaciones de firma B2.4–B2.5. Volver aquí para pagar una sola
generación; después completar A6 y el resto de B2–B5 con ese mismo plan.

- [ ] **A5.1.** Antes de **Crear plan**, el resumen muestra el rango multijornada,
  día clave y sólo 1–2 semanas.

- [ ] **A5.2.** Generar el plan, esperar estado completo y no aceptar semanas con
  error. Registrar `plan_id`, `job_id`, costo y cantidad de intentos.

- [ ] **A5.3.** Revisar visualmente todas las semanas del plan corto. En sesiones
  squash se cumplen las mismas modalidades que en A1–A4. La matriz completa de
  fases Base/Build/Peak/Taper queda cubierta por Gate 0, no por más gasto.

- [ ] **A5.4.** En las fases que existan en este plan:

  - Base, si aparece: mejor de 3;
  - Build/Peak normal, si aparece: mejor de 5;
  - Build/Peak con carga `loaded`, sólo si aparece naturalmente: mejor de 3;
  - Taper: solo si queda a tres o más días del evento;
  - Race: el evento cubre la exposición; no aparece un match adicional.

- [ ] **A5.5.** No aparecen errores
  `quality.squash.signature_uniqueness_unresolved`. Un pool corto reutiliza la
  misma modalidad antes de cruzar control con técnico.

- [ ] **A5.6.** Inspeccionar el plan de solo lectura:

```js
const smokePlans = await smokeReadStore('trainingPlans')
const smokePlan = smokePlans.sort((a, b) => b.updatedAt - a.updatedAt)[0]
const smokeWeeks = (await smokeReadStore('trainingPlanWeeks'))
  .filter((week) => week.planId === smokePlan.id)
  .sort((a, b) => a.weekIndex - b.weekIndex)

console.table(smokeWeeks.map((week) => ({
  week: week.weekIndex + 1,
  phase: week.phase,
  status: week.status,
  fallback: week.generationMeta?.fallbackUsed,
  source: week.generationMeta?.generationSource,
  errorClass: week.generationMeta?.errorClass,
  warnings: week.generationMeta?.repairWarnings?.map((warning) => warning.code).join(' | '),
  squashKinds: week.sessions
    .filter((session) => session.sessionType === 'squash')
    .map((session) => session.squashDetails?.sessionKind)
    .join(' | '),
})))
```

- [ ] **A5.7.** No hay fallback por contrato de forma sistemática, conflictos
  repetidos ni pool insuficiente. Una incidencia aislada se documenta; una tasa
  repetida en varias semanas bloquea rollout de los bordes A3–A5.

## Caso A6 — Paridad cruzada

Completar con evidencia de A1–A5:

| Modalidad | Formulario | Plantilla | Chat | Crear semana | Plan Builder |
|---|---|---|---|---|---|
| Control | [ ] | [ ] | [ ] | [ ] | [ ] |
| Técnico | [ ] | [ ] | [ ] | [ ] | [ ] |
| Sombras | [ ] | [ ] | [ ] | [ ] | [ ] |
| Partido | [ ] | [ ] | [ ] | [ ] | [ ] |

- [ ] **A6.1.** La misma intención termina con el mismo `sessionKind` en todas
  las superficies.
- [ ] **A6.2.** Los datos quedan aislados por `athleteId` al cambiar entre self y
  un atleta gestionado.
- [ ] **A6.3.** No se creó una modalidad nueva `mixed`; `mixed` solo sobrevive en
  históricos existentes.

## Caso B1 — Captura, validación y presentación de ventana

Usar `SMOKE-B`. Como ejemplo vigente para la ejecución del 12 de agosto:

- inicio: miércoles `2026-08-12`;
- término: martes `2026-08-18`;
- día clave: lunes `2026-08-17`.

Si esas fechas ya pasaron al repetir el smoke, usar una ventana que empiece hoy,
termine el martes posterior al próximo lunes y tenga ese lunes como día clave.
Así se cubren dos semanas y el estado `active` sin esperar ni cambiar el reloj.

- [ ] **B1.1.** En el wizard pulsar **El evento dura varios días**. Aparecen
  Inicio, Término y Día clave con el texto de ayuda correcto.

- [ ] **B1.2.** El resumen muestra el rango completo y el día clave, no solo el
  inicio.

- [ ] **B1.3.** Acortar el término hasta dejar el día clave fuera. El día clave
  se limpia y no queda un valor inválido oculto.

- [ ] **B1.4.** Mover el inicio después del término. Término y día clave se
  limpian; no se guarda un rango invertido.

- [ ] **B1.5.** Volver a ingresar el rango válido y luego pulsar **Es de un
  día**. Término y día clave desaparecen y el evento vuelve a la semántica
  legacy de un día.

- [ ] **B1.6.** Restaurar el rango 12→18 con clave 17. Completar el wizard hasta la
  vista previa, **sin pulsar Crear plan**.

- [ ] **B1.7.** El launch deck y el resumen muestran el rango y `Día clave`, sin
  fecha stale. Dashboard e historial se verifican en B3/B-compatibilidad cuando
  exista un plan activo o archivado que haga visible esa superficie.

## Caso B2 — Shell, firma del draft y semanas `race`

- [ ] **B2.1.** El preview anuncia exactamente el mismo número de semanas que el
  shell creado. La ventana cruza dos semanas calendario: ambas deben
  existir en el shell.

- [ ] **B2.2.** El plan termina el martes 8, no el sábado 5. La última semana no
  queda fuera por haber empezado después de la fecha inicial del evento.

- [ ] **B2.3.** Toda semana calendario que intersecta el rango está marcada
  `race`, incluida la semana del inicio aunque el sábado esté a más de cero días
  desde su lunes.

- [ ] **B2.4.** Volver al wizard y mover solo el término a `2026-08-25`. El
  resumen, la cantidad de semanas, `plan.endDate` y el shell deben cambiar. No
  debe reaparecer el shell anterior por autoload.

- [ ] **B2.5.** Volver a `2026-08-18`. El shell visible debe corresponder otra
  vez a esa ventana, sin datos del término 25. Si término es exactamente igual
  a inicio, debe firmar igual que no declarar término y no regenerar por una
  diferencia redundante.

- [ ] **B2.6.** Inspeccionar el último plan:

```js
const bPlans = (await smokeReadStore('trainingPlans'))
  .sort((a, b) => b.updatedAt - a.updatedAt)
const bPlan = bPlans[0]
const bWeeks = (await smokeReadStore('trainingPlanWeeks'))
  .filter((week) => week.planId === bPlan.id)
  .sort((a, b) => a.weekIndex - b.weekIndex)

console.log({
  id: bPlan.id,
  startDate: bPlan.startDate,
  endDate: bPlan.endDate,
  totalWeeks: bPlan.totalWeeks,
  goalEventDate: bPlan.macroSnapshot?.goalEventDate,
  goalEventEndDate: bPlan.macroSnapshot?.goalEventEndDate,
  goalEventKeyDate: bPlan.macroSnapshot?.goalEventKeyDate,
})
console.table(bWeeks.map((week) => ({
  week: week.weekIndex + 1,
  weekStartDate: week.weekStartDate,
  phase: week.phase,
  status: week.status,
})))
```

- [ ] **B2.7.** Las tres fechas están denormalizadas en `macroSnapshot`; el
  shell termina en el término inclusivo y no hay una implementación distinta
  entre preview y shell.

## Caso B3 — Countdown, dashboard y ciclo

Estos estados dependen de la fecha real. No cambiar el reloj del equipo ni
editar Dexie para simularlos en producción.

- [ ] **B3.1. Antes del inicio.** El countdown del macroplan es positivo y su
  fase se resuelve con ese countdown. Independientemente de eso, la semana del
  shell que intersecta el evento ya está marcada `race` completa.

- [ ] **B3.2. Durante la ventana.** Si hoy cae entre inicio y término inclusive,
  el dashboard muestra **En curso**, `weeksRemaining=0` y `currentPhase=race`
  durante todos los días, no solo el primero.

- [ ] **B3.3. Después del término.** El primer día posterior al término el
  countdown pasa a negativo y el ciclo ofrece/entra en `transition`. Nunca lo
  hace el segundo día del campeonato.

- [ ] **B3.4. Plan creado después del evento.** Si existe un fixture real cuyo
  evento terminó antes de hoy, incluso antes dentro de la misma semana, el shell
  empieza en `transition`. Si no existe, marcar **NO REPRODUCIBLE EN TIEMPO
  REAL**; el Gate 0 cubre el caso determinista.

- [ ] **B3.5. Un día.** Un evento sin término conserva el comportamiento legacy:
  fecha única en UI/snapshot, semana del evento `race` y `transition` solo
  después de esa fecha.

## Caso B4 — Generación, repair, validator y fallback dentro de la ventana

Ejecutar después de generar el único plan pagado de A5. No provocar fallos del
proveedor para forzar fallback: el fallback determinista está cubierto en Gate
0. Si ocurre de forma natural, la misma auditoría debe quedar verde.

- [ ] **B4.1.** Las dos semanas que intersectan la ventana son `race`. Entre
  ambas existe exactamente una sesión squash match/competitive en el día clave;
  no aparece otra competencia ni match-play de entrenamiento.

- [ ] **B4.2.** Cada semana `race` tiene como máximo dos apoyos además del ancla:

  - activación `shadows/control`: 10–20 min, RPE 2–4;
  - toque `technical`: 20–30 min, RPE 3–4 y requiere partner;
  - movilidad/recovery: 15–30 min, RPE 1–3.

- [ ] **B4.3.** No hay fuerza, running, cycling ni nutrition en las semanas
  `race`; no hay una segunda sesión en el día clave.

- [ ] **B4.4.** Ejecutar este helper de solo lectura. Todas las columnas de
  problema deben ser `0` y `anchorCount` debe ser `1` global:

```js
function smokeIsCompetition(session) {
  const details = session.squashDetails
  return session.sessionType === 'squash' && (
    session.squashKind === 'match'
    || session.subtype === 'match'
    || session.subtype === 'competitive'
    || details?.sessionKind === 'match'
    || details?.sessionMode === 'practice_match'
    || details?.sessionMode === 'competition_match'
    || details?.blocks?.some((block) => block.kind === 'match')
  )
}

function smokeSupportRule(session) {
  if (session.sessionType === 'mobility' || session.sessionType === 'recovery') {
    return { kind: 'recovery', min: 15, max: 30, minRpe: 1, maxRpe: 3 }
  }
  if (session.sessionType !== 'squash' || smokeIsCompetition(session)) return null
  const kinds = new Set(session.squashDetails?.blocks?.map((block) => block.kind) ?? [])
  const kind = session.squashDetails?.sessionKind ?? session.squashKind
  if (kind === 'technical' || kinds.has('technical')) {
    return { kind: 'technical', min: 20, max: 30, minRpe: 3, maxRpe: 4 }
  }
  if (
    kind === 'control' || kind === 'shadows'
    || kinds.has('control') || kinds.has('shadows')
    || session.subtype === 'light' || session.subtype === 'control'
  ) {
    return { kind: 'activation', min: 10, max: 20, minRpe: 2, maxRpe: 4 }
  }
  return null
}

const bRaceWeeks = bWeeks.filter((week) => week.phase === 'race')
const bAnchorDate = bPlan.macroSnapshot?.goalEventKeyDate
  ?? bPlan.macroSnapshot?.goalEventDate
const bAllRaceSessions = bRaceWeeks.flatMap((week) => week.sessions)

console.log({
  anchorDate: bAnchorDate,
  anchorCount: bAllRaceSessions.filter((session) =>
    session.date === bAnchorDate && smokeIsCompetition(session)).length,
})

console.table(bRaceWeeks.map((week) => {
  const anchors = week.sessions.filter((session) =>
    session.date === bAnchorDate && smokeIsCompetition(session))
  const supports = week.sessions.filter((session) => !anchors.includes(session))
  return {
    week: week.weekIndex + 1,
    sessions: week.sessions.length,
    anchors: anchors.length,
    supports: supports.length,
    extraMatches: supports.filter(smokeIsCompetition).length,
    incompatible: supports.filter((session) => !smokeSupportRule(session)).length,
    outOfCaps: supports.filter((session) => {
      const rule = smokeSupportRule(session)
      const rpe = session.rpe ?? rule?.maxRpe
      return rule && (
        session.durationMin < rule.min || session.durationMin > rule.max
        || rpe < rule.minRpe || rpe > rule.maxRpe
      )
    }).length,
    anchorExtras: week.sessions.filter((session) =>
      session.date === bAnchorDate && !anchors.includes(session)).length,
  }
}))
```

- [ ] **B4.5.** Revisar `generationMeta`: sin loops, repair repetitivo ni error
  final. Si `fallbackUsed=true`, B4.1–B4.4 deben cumplirse igual y se registra
  como evidencia; un fallback aislado no invalida por sí solo el contrato.

## Caso B5 — Crear semana, chat y resúmenes con ventana completa

- [ ] **B5.1. Crear semana.** Pedir una semana para la semana que contiene el
  día clave. Antes de aplicar, la propuesta tiene máximo dos sesiones totales:
  una única ancla el día clave y como máximo un apoyo compatible. No recrea una
  competencia en la otra semana `race`.

- [ ] **B5.2. Costo/retry.** En Beta Quality o la traza de Network, la solicitud
  anterior termina en un intento salvo un error real del proveedor. No hay un
  retry causado por pedir 5 sesiones y validar 2 después del repair.

- [ ] **B5.3. Semana parcial.** Si el día clave ya pasó cuando se repita el
  smoke, Crear semana no vuelve a insertarlo. Si todavía no pasó, marcar este
  borde **NO REPRODUCIBLE EN TIEMPO REAL**; Gate 0 lo cubre.

- [ ] **B5.4. Chat.** Enviar una sola pregunta: `¿En qué fase estoy y cómo debo
  manejar la carga durante mi campeonato actual?` La respuesta reconoce el
  rango completo y el campeonato en curso; no lo llama post-evento porque el
  inicio ya haya pasado.

- [ ] **B5.5. Resumen.** La propuesta/resumen semanal prioriza descarga o
  mantenimiento durante toda la ventana. No recomienda progresar fuerza,
  running o cycling como si el evento hubiera terminado.

- [ ] **B5.6. Evento heredado.** Si existe un evento viejo de otro deporte y el
  deporte principal actual es squash, Crear semana lo etiqueta como heredado y
  no crea un partido de squash en su fecha. Si no existe un fixture real, marcar
  **NO REPRODUCIBLE**; Gate 0 cubre el caso determinista.

## Caso B-compatibilidad — Backup y round trip de ventana

- [ ] **BC.1.** Exportar un respaldo después de B1–B5. Buscar el evento
  `SMOKE-B`: conserva `date`, `endDate` y `keyDate`.

- [ ] **BC.2.** El macro snapshot del plan conserva `goalEventDate`,
  `goalEventEndDate` y `goalEventKeyDate`.

- [ ] **BC.3.** Un respaldo anterior sin `endDate` sigue previsualizando y se
  interpreta como evento de un día. Si no hay respaldo legacy disponible,
  marcar **NO REPRODUCIBLE** y no editar uno real a mano.

- [ ] **BC.4.** Solo en cuenta descartable: importar el respaldo nuevo, recargar
  y confirmar el rango en resumen, builder, dashboard e historial. No ejecutar
  import destructivo sobre datos reales.

## Verificación final y limpieza

- [ ] **V1.** Revisar Network y consola: no hay 4xx/5xx inesperados, excepciones
  ni loops de regeneración/autoload.
- [ ] **V2.** Cambiar entre `SMOKE-A`, `SMOKE-B` y self; no hay fuga de sesiones,
  eventos, planes ni plantillas athlete-scoped.
- [ ] **V3.** Eliminar únicamente sesiones/plantillas `SMOKE` si son
  descartables. No borrar el respaldo ni el plan hasta guardar la evidencia.
- [ ] **V4.** Confirmar que sólo se pagó un plan corto, tres solicitudes de Chat
  y dos de Crear semana, salvo retry real documentado.
- [ ] **V5.** Si A y B están verdes, aprobar ambos rollouts. Si falla una regla
  B4/B5, no aprobar generación multijornada aunque captura y shell funcionen.

## Resultado

_(completar al ejecutar)_

- Entorno y commit publicado:
- Bundle:
- Fecha/hora y zona horaria:
- Atletas de prueba:
- Respaldo previo:
- Solicitudes IA / costo:
- Casos A aprobados:
- Casos B0–B5 aprobados:
- Casos no reproducibles:
- Casos no ejecutados por seguridad/saldo:
- Hallazgos con pasos y evidencia:
- Veredicto A: **APROBADO / APROBADO PARCIAL / RECHAZADO**
- Veredicto B: **APROBADO / APROBADO PARCIAL / RECHAZADO**
- Veredicto Whoop zones (runbook separado): **APROBADO / PARCIAL / NO EJECUTADO**
