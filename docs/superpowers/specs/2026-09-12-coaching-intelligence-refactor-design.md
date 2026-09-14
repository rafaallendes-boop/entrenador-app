# Refactor de inteligencia del coaching — diseño

**Fecha:** 12 de septiembre de 2026. Revisión 2 del mismo día.
**Estado:** Fases A y B implementadas localmente (2026-09-12 / 2026-09-13), sin deploy. Decisiones deportivas de §9 cerradas con el owner el 2026-09-13.
**Fuentes:** [revisión del 8 de septiembre](../../reviews/2026-09-08-coaching-planning-refactor-review.md)
(hallazgos F01–F15) y [propuesta del 10 de septiembre](../../reviews/2026-09-10-onboarding-athlete-programming-proposal.md)
(onboarding y programación). Este documento fusiona ambas en un solo plan y
sustituye sus secciones de entregas.

## 1. Objetivo y alcance

Mejorar la inteligencia observable del chat general, del chat de acciones y
Week Creator, y del Plan Builder: que respondan con hechos, que entiendan
consulta frente a acción, que las señales del atleta lleguen a la composición
y que las tres rutas decidan con el mismo contexto.

**Entra:** motor y contexto. Correcciones de contenido demostradas por el probe
del 8 de septiembre, identidad del atleta en fronteras asíncronas, autoridades
compartidas para fuerza y señales de ejecución, separación entre contexto de
dominio y proyección para el prompt, corte temporal, claim del job remoto, y
la consolidación final en un snapshot único.

**No entra, con motivo (§11):** onboarding breve, dosis por serie, doble
reparación del Week Creator (F14), optimizaciones de velocidad (E6),
experimentos de modelo (E7), cycling y movilidad (F12).

**Restricciones del proyecto que aplican:** commits del owner; migraciones de
aplicación manual; sin dependencias pesadas; `promptBuilder.ts` se toca sólo
con el contexto completo revisado; las reglas de athlete scope y de fuerza de
`CLAUDE.md` se conservan íntegras; el normalizador de respuestas no admite
que el modelo emita identidad de contenido.

## 2. Estado verificado el 12 de septiembre

El probe `docs/reviews/fixtures/coaching-refactor-2026-09-08/probe.mjs` se
volvió a ejecutar sobre `9da765b` con árbol sucio, sin red. Resultado idéntico
al del 8 de septiembre salvo F04, ya corregido:

| Hallazgo | Estado hoy | Evidencia |
|---|---|---|
| F02 | Vigente | `buildWeekCreatorHydrationRepairContext` devuelve `RepairContext` sin `executionSignals`; `repairWeek.ts` evalúa `decideLoadDirective(context.executionSignals ?? {})`. |
| F03 | Vigente | Probe: `technical` y `control` a 15 min devuelven bloques `['shadows']`, sin warnings. |
| F04 | Corregido | Probe: Z2 devuelve `6:00–6:30` coherente con bloques. Se protege con test. |
| F05 | Vigente | Probe: `repeats_400` da 11 repeticiones con `intent:'progress'` y 9 con intent omitido. **Ambos son correctos para su intención**; el defecto es que el submit no conserva la intención ni la estructura. `RunningDetails` no persiste `intent`. |
| F06 | Vigente | Probe: sólo `session-0..5` sobreviven al recorte de `chat_action`. El mismo objeto recortado llega a `postProcessCoachActions`. |
| F07 | Vigente | Probe: las cinco frases reciben clases distintas en UI (`detectChatIntent`) y engine (`resolveChatRoute`). |
| F01 | Vigente | `ChatCoach.submitMessage` descarta sólo `whoopWorkoutBlock` al detectar cambio de scope; `generateCoachNote` no captura scope alrededor de la IA. |
| F09 | Vigente | `generate-plan-background.ts` no contiene claim, lease ni token de propietario. |
| F11 | Vigente | Tres constructores de `StrengthContext` con tres escalas de fatiga: chat fija 5, intermedio y `recentExercises: []`; Week Creator mapea fresh=2/loaded=6/overloaded=8 sin experiencia; Plan Builder mapea 2/5/7/9 y deriva experiencia de fitness y nivel competitivo. `strengthContext.ts` la deriva contando 1RM y la consumen `strengthPrompt.ts` y `progressionInsights.ts`. `profileAdapter.ts` fija `requireExtraRecovery` a partir de 35 años. |
| F15 | Vigente | `generateWeek.ts` abre y cierra `prompt_build`, `normalize` y `repair` sin ejecutar ese trabajo. |

**Cierre de Fase A (2026-09-12, local, sin deploy):** el probe se volvió a
correr sobre el árbol de las Tareas 1–10 y su salida quedó en
`docs/reviews/fixtures/coaching-refactor-2026-09-08/probe-after-phase-a.json`;
F03, F04, F05 y F07 quedan además fijados como regresión permanente en
`src/services/__tests__/coachingRefactorProbes.test.ts` y
`src/services/training/__tests__/sessionDoseFinalizerZ2.test.ts`.

**Cierre de Fase B (2026-09-13/14, local, sin deploy):** B1–B4 quedan
implementadas según §9 y la tabla I1–I16 del plan de Fase B
(`docs/superpowers/plans/2026-09-13-coaching-intelligence-phase-b.md`). La
vigencia de lo declarado por el atleta —7 días para la fatiga, 14 para el
retorno tras pausa— fue decidida por el owner el 2026-09-13
(`DECLARED_FATIGUE_VALID_DAYS` / `RETURNING_WINDOW_DAYS` en
`strengthAthleteContext.ts`). La paridad de las tres rutas (chat, Week
Creator, Plan Builder) queda integrada como regresión en
`src/services/__tests__/strengthContextParity.test.ts`, con la divergencia
I8 fijada de forma explícita: el Plan Builder sólo ve la última semana
**completamente vivida**, así que un dolor de la semana en curso es visible
para el chat/Week Creator y no para el Plan Builder hasta la semana
siguiente. F06 (recorte a seis sesiones sin ampliar el presupuesto) y F10
(hechos de la sesión consultada en el prompt de chat general) quedan
fijados como regresión permanente junto a F03/F05/F07 en
`coachingRefactorProbes.test.ts`. El probe pareado de Fase B —cinco
arquetipos × tres rutas— quedó en `probe-phase-b-before.json` y
`probe-phase-b-after.json`, con las 15 filas de "after" byte-idénticas por
arquetipo entre rutas. Como el resolver compartido siempre estampa
`available1RM` y `rpeAdjustment`, `shouldUseBlockTemplateSelection`
(`strengthSelector.ts`) pasa a activarse también en chat, en el prompt de
fuerza del chat general y en Week Creator: las tres rutas usan ahora
selección por plantilla de bloque, igual que el Plan Builder ya usaba. El
probe pareado (`probe-phase-b-before.json` / `probe-phase-b-after.json`)
muestra el efecto completo por arquetipo.

**B no garantiza:** paridad de contexto en cycling ni movilidad (fuera de
alcance, ver §11/C1); el horizonte local del Plan Builder, que sigue
limitado a la última semana vivida (Fase C); revalidación de las
restricciones de seguridad al momento de aceptar un plan (Fase D); ni la
vigencia de lo declarado en el **texto** del prompt ni en las ramas de
instrucciones del generador del Plan Builder — el selector local de fuerza
(B1/I7) ya aplica vigencia, pero el generador de prompt del Plan Builder
todavía no, residual documentado en I11
(`src/services/planBuilder/__tests__/phaseBPromptFatigueResidual.test.ts`).

Hechos del código que condicionan el diseño:

- `ExecutionSignals` y `decideLoadDirective` ya existen en
  `loadDirectivePolicy.ts` como autoridad compartida; `loaded` resuelve `hold`
  y `overloaded` resuelve `reduce`.
- `strengthSelector.ts` decide con umbrales fijos de fatiga: `>= 7` activa
  filtros y `deload`; `>= 8` endurece más; `<= 4` y `<= 5` habilitan
  `progress` en base y build. Cualquier tabla de mapeo cambia decisiones.
- `ChatContext` ya es el contexto de dominio de facto.
- El store del chat no tiene estado de intención pendiente; la confirmación
  corta se resuelve con una regex sobre los últimos ocho mensajes.
- `responseNormalizer.ts` sólo parsea el bloque `<actions>`; no existe
  ninguna oferta estructurada del coach.
- `CoachSessionModal` pasa el borrador de una plantilla como `initialValues`
  al crear; `initialValues` no distingue alta de edición.

## 3. Principios

1. **Comportamiento antes que estructura.** Cada entrega define primero el
   resultado esperado (tabla, corpus o fixture) y después alinea el código.
   Unificar dos rutas que se equivocan igual no cierra un hallazgo.
2. **Autoridad única por regla.** Fatiga, experiencia, señales de ejecución,
   ruta del mensaje y corte temporal tienen un solo módulo que decide. Los
   consumidores adaptan sus entradas; no reimplementan.
3. **El prompt es una proyección.** El contexto de dominio es completo e
   inmutable durante la operación; el presupuesto de tokens recorta la
   proyección, nunca el universo de validación ni el alcance del pedido.
4. **Identidad y tiempo explícitos.** Toda operación captura atleta, epoch,
   conversación, `requestId` y fecha de conocimiento antes del primer `await`,
   y los comprueba antes de escribir.
5. **Aceptar revalida.** Lo congelado sirve para generar; al aplicar se
   comprueban las condiciones actuales. Nunca se sustituye contenido en
   silencio después de haberlo mostrado.
6. **Garantía observable por fase.** Cada fase termina con algo que el usuario
   puede comprobar, además de mejor código. Las garantías de A no se atribuyen
   a B ni al revés.
7. **Los cambios de política deportiva se deciden aparte.** Qué entrenamiento
   recibe alguien no se decide dentro de un refactor de código (§9).
8. **Lo estructurado no se infiere de prosa.** Ofertas, aclaraciones e
   identidades viajan en el bloque estructurado que ya parsea el
   normalizador, o no existen.

## 4. Fase A — correcciones acotadas e identidad

Entregas separables. Cada una parte de un caso rojo y termina con evidencia
del recorrido real, no sólo del selector aislado. Sin migraciones remotas ni
cambios de esquema Dexie.

### A1. Señales de ejecución llegan al hidratador (F02)

- Extraer de `WeekCreatorPromptBuilder.buildLoadDirective` la construcción de
  `ExecutionSignals` a `buildWeekCreatorExecutionSignals(config, sessions, logs)`,
  conservando la exclusión de prefill Whoop.
- `buildWeekCreatorHydrationRepairContext` recibe y propaga `executionSignals`.
- **Caso rojo:** dolor 8/10 en el último day log → hoy `no_signal` en el
  contexto de reparación; debe ser `reduce`. Caso dirigido: build, partner,
  meta de tres partidos duros → la meta se retira en la composición igual que
  en el prompt.
- **Evidencia de recorrido:** el test entra por `hydrateWeekCreatorSkeleton` y
  afirma sobre la propuesta lista para `applyCreateWeek`.
- **Garantía A1:** una señal de reducción sobrevive desde el day log hasta la
  propuesta aplicable del Week Creator.

### A2. El objetivo principal se dosifica antes que el accesorio (F03)

- `doseSquashSession` deja de cortar con `slice(0, count)` sobre la lista
  plana. Reserva por bloque: primero los drills del bloque cuyo `kind`
  coincide con `sessionKind`; después los accesorios sólo si queda al menos un
  drill viable (180 s). Si no cabe, se retira con advertencia.
- El resultado exitoso gana `warnings: string[]`. El ciclo trabajo/pausa se
  resuelve por `kind` de bloque, no por la modalidad global.
- **Casos:** `technical` y `control` a 15 min con `withShadowsAccessory`
  conservan el bloque principal y advierten el accesorio retirado; a 45 min
  entran ambos; todas las modalidades en su duración mínima.
- **Evidencia de recorrido:** la sesión pasa por `repairGeneratedWeek` y por
  el serializador de plantillas; el bloque principal sobrevive en ambos.
- **Garantía A2:** ninguna sesión de squash pierde su estímulo principal por
  falta de tiempo sin decirlo.

### A3. Creación, edición y recalculado de una receta de running (F05)

`SessionForm` recibe `origin: 'new' | 'template' | 'existing'`; `initialValues`
deja de ser la señal.

**Regla que prevalece sobre toda la tabla:** una sesión `completed` o
`adjusted` **nunca se rematerializa**, por ninguna operación. Cambiar su
duración o elegir otra plantilla no reescribe la estructura: el formulario
rechaza esos cambios sobre una sesión ejecutada y explica por qué; sólo admite
metadatos y la corrección manual de lo realizado, que es una operación
separada. Deshabilitar el botón de recalcular no basta por sí solo.

Cada operación tiene un contrato propio:

| Operación | Cómo se identifica | `intervalStructure` / `templateRef` | Campos `actual*` |
|---|---|---|---|
| Alta manual | `origin: 'new'` | Se materializa con la intención elegida (`hold` si no se elige) y se guarda procedencia. | No aplica. |
| Alta desde plantilla | `origin: 'template'` | Se materializa al slot y duración elegidos, conservando la intención de la plantilla. | No aplica. |
| Edición de metadatos: título, notas, ubicación, objetivo, RPE previsto, fecha, franja | `origin: 'existing'` y sólo esos campos cambiaron | Se copian byte a byte desde la sesión. | Intactos. |
| Edición de prescripción por duración o plantilla | `origin: 'existing'` con `durationMin` o `templateRef.id` cambiados, o receta elegida en el picker | Se rematerializa con la intención guardada; el diff se muestra antes de guardar. | Intactos. |
| Edición manual de ritmos o tipo de running | `origin: 'existing'` con `targetPace*`, `targetHr*` o `runningType` cambiados | **No** se rematerializa. Se guardan como instrucción explícita del usuario y el finalizador valida compatibilidad con los bloques (contrato de F04). Si son incompatibles, el formulario lo dice y no guarda. | Intactos. |
| Recalcular dosis (botón explícito) | Acción del usuario | Se rematerializa con el perfil vigente. El diff declara qué cambió: duración, ritmos de referencia del perfil, versión de la receta, versión del materializador. Procedencia nueva. | Intactos. |
| Corrección de lo ejecutado | `status` `completed` o `adjusted`, edición de `actual*` | No se toca la estructura; el botón de recalcular está deshabilitado. | Editables de forma explícita, con marca de corrección manual y fecha. |

- **Procedencia.** `RunningDetails.materialization?: { intent, recipeVersion, materializerVersion, profileRevision?, at }`.
  Viaja en `sessions.data` (jsonb) sin migración; entra al allowlist de
  `sessionTemplateSerializer` y al backup. Registros antiguos sin este campo
  se muestran como "versión original desconocida" en el diff. Eso describe el
  origen, no decide el recalculado: **una receta sin intención guardada se
  recalcula con `hold`**, y el diff lo declara como "intención asumida:
  mantener". Ese fallback es explícito y se prueba.
- Conservar la intención no garantiza la misma dosis si cambiaron perfil,
  receta o materializador: por eso la estructura persistida manda en
  metadatos y el diff es obligatorio al recalcular.
- **Caso rojo:** `repeats_400`, 60 min, 11 repeticiones con `intent:
  'progress'`; editar el título deja 9. Debe quedar idéntico. No se exige que
  `progress` y `hold` den lo mismo: son intenciones distintas.
- **Evidencia de recorrido:** formulario con `origin: 'existing'`, cambio de
  título, submit, y la fila persistida en Dexie con `intervalStructure`
  deep-equal a la original. Segundo test: cambio de duración produce diff y
  nueva estructura con la misma intención.
- **Garantía A3:** editar texto no cambia el entrenamiento ni el historial;
  recalcular es explícito y explica sus diferencias.

### A4. Interpretación esperada primero, router único después (F07)

**Corpus antes que código.** `chatRoutingCorpus.ts` lista frases canónicas
con contexto, ruta esperada y motivo. Se acuerda con el owner antes de tocar
el router. Corpus base aprobado:

| Frase | Ruta esperada | Motivo |
|---|---|---|
| ¿Cómo estuvo mi sesión del lunes? | `chat_general` | Consulta sobre historial. La recuperación de hechos llega en B4. |
| Dame feedback de mi sesión del lunes | `chat_general` | Consulta. `dame` no es verbo de creación con objeto definido. |
| Créame una sesión de pesas | `chat_action` | Creación con objeto indefinido. |
| ¿Cómo me prepararías para tres semanas de vacaciones? | `chat_general` | Asesoría; un horizonte temporal no es una petición de plan. |
| Genera un plan completo hasta el torneo | `plan_builder_redirect` | Verbo de creación más plan completo. |

Casos de intención pendiente y clarificación:

| Contexto y respuesta | Resultado esperado |
|---|---|
| «Muévela al viernes» sin referente en la conversación ni intención pendiente | Clarificación: se pide la sesión. En B4, si `resolveMessageTargets` resuelve el referente de forma inequívoca, `chat_action`. |
| «Muévela al viernes» con intención pendiente de tipo `move_session` que **ya identifica** la sesión | `chat_action` con la operación completada. Una intención de otro tipo o sin referente no habilita la acción. |
| «¿Qué sesión quieres mover?» → «sí» | Sigue faltando la sesión; se vuelve a pedir con los candidatos. |
| «¿Qué sesión quieres mover?» → «la del lunes» | Se resuelve el dato y se continúa **sólo si** es inequívoco; con dos sesiones el lunes, se pide la franja. |
| Oferta vigente → «no, sólo explícame» | Conversación; la oferta pasa a `cancelled`. |
| Oferta ya consumida → otro «sí» | No se vuelve a generar; se responde que ya está en curso o hecha. |
| Oferta de crear semana → «dale» | `week_creator` conservando `targetWeekStart` y configuración de la oferta. |

**Router único.** `detectChatIntent` pierde sus regex y pasa a ser una
proyección de `resolveChatRoute`. La página del chat resuelve la ruta con los
mismos insumos que el store. UI, store y engine se prueban **contra el
corpus**, no entre sí. El corpus incluye además las frases que ya fijan los
tests de `chatRouting`, con su ruta actual revisada una a una; cada cambio de
expectativa se justifica en el corpus.

**Intención pendiente tipada.** Nuevo estado en el store del chat:

```ts
type PendingIntent = {
  id: string
  kind: 'generation_offer' | 'clarification'
  athleteId: string
  conversationId: string
  createdAt: number
  expiresAt: number
  status: 'open' | 'consumed' | 'cancelled'
  route: 'week_creator' | 'plan_builder_redirect' | 'chat_action'
  operation:
    | { type: 'create_week'; targetWeekStart: string; config?: Partial<WeekCreatorEffectiveConfig> }
    | { type: 'move_session' | 'update_session' | 'delete_session' | 'add_session'; known: Record<string, unknown>; missing: string[] }
}
```

Reglas de vida:

- **Origen.** La produce el modelo dentro del bloque `<actions>` como
  entradas tipadas nuevas, `offer_generation` y `ask_clarification`. El bloque
  es sólo el **transporte**: `responseNormalizer` las extrae a un campo propio,
  `conversationEvents`, y **no** las deja en `actions`. En consecuencia no
  cuentan como acciones de entrenamiento, no entran a
  `postProcessCoachActions`, no crean `CoachProposal` ni tarjetas, y una
  respuesta que sólo traiga eventos no dispara el reintento por "faltan
  acciones". Ese recorrido completo queda cubierto por tests, incluidas las
  ofertas emitidas desde `chat_general`, que es donde más aparecerán. No se
  infiere de prosa.
- **Unicidad.** Una sola intención `open` por conversación. Una nueva reemplaza
  a la anterior, que pasa a `cancelled`.
- **Consumo.** Una confirmación corta resuelve a `route` sólo si la intención
  está `open`, pertenece al atleta y conversación actuales, no venció, y para
  `chat_action` no tiene `missing`. Al consumirse pasa a `consumed`.
- **Cancelación.** Mensaje negativo o fuera de tema, cambio de atleta,
  vencimiento (propuesta: 10 minutos), o inicio de una operación distinta.
- **Clarificación.** La respuesta del usuario se resuelve con
  `resolveMessageTargets` (en A sólo por fecha y franja; completo en B4) y
  rellena `known`. Si sigue ambigua, se vuelve a preguntar con candidatos.
- **Las propuestas no se aplican por texto.** Una `CoachProposal` pendiente se
  acepta únicamente desde su tarjeta, como hoy. Confirmar una oferta nunca
  aplica una propuesta ni al revés; `PendingIntent` no admite `proposal_apply`.

Efecto colateral aceptado: el gate de entitlement de la UI empieza a
aplicarse a las mismas frases que el servidor trata como acción.

**Garantía A4:** una consulta no termina en mutación ni en redirección; una
confirmación corta sólo confirma una operación concreta, vigente, del mismo
atleta y con sus datos completos.

### A5. Identidad del atleta en cada frontera asíncrona (F01)

- `captureRequestScope()` devuelve `{ athleteId, epoch, conversationId, requestId }`
  antes del primer `await` de `submitMessage`. Viaja al store, al engine
  (`targetAthleteId` sale de ahí, no del holder global en el momento de la
  llamada) y al postprocesador.
- Antes de persistir el mensaje del coach y la propuesta se comprueba
  `epoch` **e** identidad (mismo patrón que `pullWorkouts.ts`). Si cambió, se
  conserva el borrador para el atleta original y no se escribe en el nuevo.
- La hidratación inicial `null → self` se trata aparte: no es un switch y no
  descarta el envío.
- `generateCoachNote` captura el scope antes de las lecturas y lo pasa
  explícito a `upsertWeekSummaryCore`, que ya acepta scope; se comprueba antes
  de escribir.
- **Tests:** dos atletas con perfiles y sesiones distintas; cambio A→B en cada
  frontera (tras lecturas, tras la respuesta del proveedor, antes de
  persistir); se verifica payload al proveedor, filas Dexie y UI.
- **Garantía A5:** contexto, petición, propuesta y escritura pertenecen al
  mismo atleta.

### A6. Medición mínima honesta (parte de F15)

- `generateWeek.ts`: las etapas `prompt_build`, `normalize` y `repair` que no
  envuelven trabajo se retiran o se mueven a sus fronteras reales.
- `coachRecovery.ts`: `retryUsed` y conteo de intentos reflejan los reintentos
  por timeout transitorio.
- `ChatContextMetadata` registra `route` y `contextVersion`.
- **Garantía A6:** la telemetría existente deja de describir trabajo que no
  ocurrió. No es E6; no se promete velocidad.

### A7. Guard de F04 y probe como regresión

- Test en `sessionDoseFinalizer`: convertir tempo a Z2 produce objetivos de
  tarjeta iguales a los ritmos de los bloques.
- Los casos del probe pasan a `coachingRefactorProbes.test.ts` con
  expectativas **corregidas**: para F05 la expectativa no es "11 igual a 9"
  sino que la edición de título conserva la estructura. El script y sus
  salidas se conservan como evidencia histórica.

### Criterio de salida de A

- `npm run lint && npm test && npm run build` y `git diff --check` verdes.
- Casos rojos de A1–A5 en verde por su evidencia de recorrido: propuesta
  aplicable con la meta retirada (A1), bloque principal tras reparación y
  serialización (A2), fila Dexie con estructura idéntica tras editar el título
  (A3), corpus completo satisfecho por UI, store y engine (A4), tests de
  cambio de atleta en las tres fronteras (A5).
- Fixture de casos pareados antes/después para revisión del owner.
- **A no garantiza:** recuperación de hechos históricos, resolución completa
  de anáforas, paridad de contexto entre rutas. Eso es B.

## 5. Fase B — resolvers compartidos

### B1. `resolveStrengthAthleteContext`

Entrada: captura de fuentes (§B2), configuración del wizard o del Week Creator
si existe, y `referenceSlot`. Salida: fatiga en una sola escala, experiencia
con procedencia, recuperación extra, 1RM disponibles, ajuste de RPE,
equipamiento resuelto y `recentExercises` derivados **sólo** del historial de
progresión.

Los tres constructores actuales (`actionPostProcessor`, `WeekCreatorEngine`,
`repairWeek`) pasan a llamarlo; `strengthPrompt.ts` y `progressionInsights.ts`
también.

Las **reglas** de experiencia, retorno, edad, fatiga y datos desconocidos no
se definen acá: son decisiones deportivas de §9 y se confirman antes de
empezar B1. B1 implementa lo que §9 decida y elimina las inferencias que §9
retire.

### B2. Captura de fuentes por operación y contextos por slot

Una operación (una petición de chat, una semana del Week Creator, un job del
Plan Builder) hace **una** captura inmutable y deriva de ella tantos contextos
como slots necesite.
La captura copia en profundidad el perfil, las sesiones y los day logs y
congela recursivamente esa copia privada. Ninguna mutación posterior de los
registros originales ni de sus objetos anidados altera la operación; no se
congelan objetos propiedad del store.

```ts
type SourceCapture = {
  athleteId: string
  epoch: number
  requestId: string
  knowledgeCutoff: string       // instante ISO de la captura; nada leído después entra
  profile: AthleteProfile        // con profileRevision
  sessions: Session[]            // todas las del rango relevante, tal como estaban
  dayLogs: DayLog[]
  plan?: TrainingPlan
  planDescriptors?: PlanWeekDescriptor[]
}

type ReferenceSlot = { date: string; timeBlock: 'AM' | 'PM' }   // orden total: fecha, luego AM < PM

function deriveSlotContext(capture: SourceCapture, slot: ReferenceSlot, window: ExposureWindow): SlotContext
```

`SlotContext` contiene dos conjuntos con criterios distintos:

- **Historial de progresión:** sesiones `completed` o `adjusted` cuyo slot es
  estrictamente anterior a `slot`. Alimenta progresión, `recentExercises` y
  señales de ejecución. Las `skipped` y `cancelled` no cuentan para progresión
  pero sí para adherencia en las señales.
- **Exposición relevante:** todas las sesiones, ejecutadas o planificadas,
  dentro de `window` (la semana del slot y los vecinos duros de las semanas
  contiguas), **excluyendo la sesión objetivo por identidad**, no por slot.
  Otra sesión en la misma franja cuenta. Una planificada anterior al slot
  cuenta para carga semanal aunque no para progresión.
- **Day logs:** por fecha ≤ `slot.date`; el del mismo día cuenta.
- **Registros legacy sin `timeBlock`:** se tratan como `AM` de su fecha y se
  marcan `legacySlot: true`; la partición los incluye y lo declara. No se
  descartan ni se inventa una franja distinta.
- **Multisemana:** un job del Plan Builder hace una captura y deriva un
  `SlotContext` por semana o por sesión objetivo, todos con el mismo
  `knowledgeCutoff`. Las semanas generadas dentro del mismo job **no entran a
  la exposición por haber terminado antes**: eso reintroduciría F13. Entran
  sólo por dependencia determinista declarada (la semana N depende de la N−1
  validada) o mediante reservas fijadas antes de lanzar las tareas
  concurrentes. Qué consumidores necesitan lo primero y cuáles bastan con lo
  segundo lo decide C6; este contrato queda registrado desde B2. Nunca entran
  al historial de progresión.

Todo resolver de B consume `SlotContext`, nunca `sessions` crudas. C completa
la adopción en cycling, movilidad y contadores.

### B3. Señales de ejecución únicas

`buildExecutionSignals(slotContext, declaredFatigue)` generaliza la extracción
de A1 y reemplaza `executionSignalsFromLivedWeeks` en el Plan Builder. El chat
de acción, que hoy no las construye, las consume. Cada señal conserva fuente,
fecha y tamaño de muestra; la exclusión de prefill Whoop es responsabilidad
del constructor, no del llamador.

### B4. Dominio y prompt separados; objetivos del mensaje (F06, F10)

- `optimizeChatContext` devuelve un tipo nuevo `PromptContext`. `ChatContext`
  completo llega al postprocesador, al resolver de objetivos y a la
  validación.
- **`resolveMessageTargets(message, context, pendingIntent, recentMessages)`**
  identifica fechas, sesiones nombradas y referencias conversacionales
  ("muévela", "esa sesión", "la del jueves") usando el mensaje actual, los
  turnos recientes y la intención pendiente. Devuelve objetivos resueltos con
  confianza o una necesidad de clarificación cuando hay más de un candidato
  plausible.
- **Objetivos y cardinalidad (plan B, I13):** id, título, fecha, deporte y
  franja se combinan. Se aceptan fechas ISO, DD/MM y DD/MM/YYYY; DD/MM usa el
  año local de la operación. Las fechas imposibles se aclaran y el destino
  de un movimiento no filtra la sesión origen. Singular exige una sesión;
  plural con cantidad exige esa cantidad y, si supera 12, pide acotar sin
  selección parcial. Sólo plural sin cantidad o cardinalidad no especificada
  procesa los primeros 12 y avisa cuáles quedaron fuera. Toda aclaración
  conserva cardinalidad: sólo singular con fecha válida abre intención
  pendiente; plural pregunta localmente sin IA ni intención. El chat general
  conserva las candidatas como referencias de lectura sin interrumpirse.
- **Presupuesto (I15):** el detalle conserva los valores actuales de límites
  de sesiones y caracteres estimados, con prioridad objetivos → vecinos →
  resto. Si una sesión no cabe, incluso la primera, se omite y se continúa.
  El índice compacto de hasta 12 objetivos va aparte y marca los que no
  tienen detalle. Esto no promete un límite exacto de tokens ni del texto
  serializado. La validación y ejecución siempre usan el dominio completo.
  Las sesiones del exceso siguen identificadas y sus acciones se descartan;
  la metadata no sustituye el aviso visible.
- Chat general: cuando el mensaje referencia sesiones pasadas, el prompt
  incluye título, feedback, RPE real y resultado de las sesiones resueltas,
  reutilizando el render que ya existe para acciones y resumen. La memoria
  libre se conserva; las restricciones estructuradas del perfil se fijan fuera
  del truncado de texto. Ausencia de sesiones se determina antes del recorte
  (incluyendo objetivos excedentes), nunca por falta de detalle. El RPE real
  se muestra incluso si no existe RPE planificado.
- **Garantía B4:** una acción sobre una sesión fuera de las primeras seis se
  resuelve sin ampliar el historial enviado al modelo; "¿cómo me fue ayer?"
  responde con los hechos de ayer; "mueve estas ocho sesiones" mueve ocho o
  dice cuáles no; una anáfora sin referente pide aclaración en vez de
  adivinar.

### Criterio de salida de B

Misma captura, declaración y slot completo producen los mismos campos de
atleta en chat, finalizador e hidratador del Week Creator. La extracción y
resolución de fuerza se cachean por captura y slot; incluyen la sesión AM al
resolver PM del mismo día. La directiva semanal del Week Creator conserva
su ancla `planningStartDate` AM y no sustituye esa resolución por sesión.
Plan Builder conserva la ventana de la última semana vivida (I8), única
divergencia de ventana admitida, con test explícito desde Dexie. La paridad
se exige cuando las ventanas aportan los mismos datos.

La fatiga declarada vence a los 7 días y el retorno a los 14, evaluados por
fecha del slot desde `wizard.updatedAt` local; sin fecha válida no están
vigentes. Chat/Week Creator usan la declaración capturada del perfil y
Plan Builder la del plan. Las fuentes deben representar la misma declaración
para exigir paridad (plan B I6/I7).

Casos rojos F06/F10 en verde, fixture pareado y gate de seis semanas sin
alertas. **B no garantiza** paridad en cycling/movilidad, horizonte correcto
en la ruta local del Plan Builder ni vigencia de la declaración en el texto
y las ramas de instrucciones del generador de Plan Builder: eso queda en C.
El residual del generador debe quedar caracterizado por tests locales en B.

## 6. Fase C — paridad, horizonte y durabilidad

- **C1.** Adopción completa de `SlotContext` en selectores de fuerza, cycling
  y movilidad; contadores de exposición separados por ejercicio, sesión y
  volumen.
- **C2 (F08).** `generationJobRunner` separa `targetWeekIndexes` de los
  descriptores completos e inmutables del plan; local, remota, regeneración
  parcial y fallback comparten horizonte. Test: regenerar sólo la semana 2 de
  un bloque de cuatro produce `blockWeekIndices:[0,1,2,3]`.
- **C3.** Inventario confirmado como filtro en todas las rutas; equipamiento
  desconocido distinto de no disponible; sin gimnasio completo implícito.
- **C4.** `ScheduleProfile` gana disponibilidad estructurada opcional por
  franja (minutos, recursos, partner) editable en el perfil; Week Creator y
  Plan Builder la consumen antes que el texto libre. Sin UI nueva de
  onboarding.

### C5 (F09). Propiedad exclusiva del job remoto

Migración `037` sobre `plan_generation_jobs`: `run_token uuid`,
`run_seq integer`, `lease_until timestamptz`. Funciones `security definer`:

| Función | Contrato |
|---|---|
| `claim_plan_generation_job(job_id)` | Reclama si `status = 'queued'`, o si `status = 'running'` y `lease_until < now()`. Incrementa `run_seq`, emite `run_token`, fija `lease_until = now() + lease`. Devuelve token o nada. Un job `cancelled` o terminal no se reclama. |
| `renew_plan_generation_lease(job_id, run_token)` | Extiende `lease_until` sólo si el token es el vigente, `status = 'running'` **y `lease_until >= now()`**. Un lease vencido no se renueva: corresponde recuperación y nueva propiedad vía `claim`. Devuelve falso si no. |
| `write_plan_generation_checkpoint(job_id, run_token, payload)` | En una transacción: comprueba token vigente, estado no cancelado y lease no vencido; escribe el checkpoint en su tabla; renueva el lease. |
| `finalize_plan_generation_job(job_id, run_token, outcome, payload)` | Misma comprobación; escribe estado terminal y publica semanas/plan. **Toda escritura de estado final o de plan pasa por acá**, no sólo los checkpoints. |
| `cancel_plan_generation_job(job_id)` | Marca cancelado e invalida el token. |

Vida del lease:

- **Duración:** el doble del intento de proveedor más largo con margen
  (propuesta: 120 s; el intento síncrono corta a 24 s y el reintento por
  truncamiento a ~60 s).
- **Renovación durante trabajo:** el worker renueva en un temporizador propio
  (propuesta: cada 30 s) mientras dure una llamada al proveedor, además de en
  cada checkpoint. Una renovación rechazada aborta la llamada en curso y
  termina sin escribir.
- **Recuperación:** la dispara el cliente al hacer polling de un job `running`
  con `lease_until` vencido (reenvía el enqueue, que intenta el claim), y un
  cron ligero de Netlify hace lo mismo para jobs sin cliente activo.
- **Garantía:** una reentrega con propietario vigente no duplica generación
  ni escrituras; una recuperación tras caída **puede repetir trabajo externo**
  (llamadas ya pagadas), pero el worker anterior no puede publicar nada.
- **Tests:** entrega duplicada con lease vigente; caída tras escribir el padre
  y antes de las semanas; expiración de lease y reclamo por otro worker;
  escritura tardía del worker anterior en checkpoint y en finalización;
  cancelación durante una llamada al proveedor. `enqueue` conserva
  idempotencia; `commitPlan` conserva sus barreras.

### C6 (F13). Decisión con dato

Primero un probe que enumere los consumidores de `previousWeek` con contenido
generado en el loop concurrente. Regla propuesta: en concurrencia
`previousWeek` es siempre el shell y la continuidad de squash y running se
resuelve por reservas deterministas de bloque, como ya hace la plantilla de
fuerza. Si el probe muestra un consumidor que no puede vivir sin contenido,
esa semana espera a su predecesora validada. Se decide dentro de C con el
resultado del probe; test con las mismas respuestas fijas en órdenes de
resolución distintos.

**Criterio de salida de C:** paridad en las disciplinas cubiertas; horizonte
idéntico local/remoto; los cinco tests de C5 en verde; `037` aplicada y
verificada en producción.

## 7. Fase D — snapshot único con garantía concreta

`PlanningContextSnapshot` agrupa la `SourceCapture` de B2, las versiones
(`catalogVersion`, `policyVersion`, `resolverVersion`) y los resultados de B1
y B3 por slot.

- Se construye **una vez** por operación y todas las etapas reciben el mismo
  objeto; un `contextHash` (sobre captura y versiones) se estampa en la
  propuesta, en `contextMeta` y en la telemetría del attempt. Sirve para
  trazabilidad: demuestra qué contexto vio cada etapa.
- **La garantía real está en la aceptación.** Aplicar una propuesta usa el
  snapshot capturado para saber qué se propuso, y comprueba las condiciones
  actuales —agenda, restricciones, revisión de perfil, sesiones del rango—
  antes de escribir. Si cambiaron, se muestra el cambio necesario o se pide
  regenerar. Nunca se sustituye contenido en silencio.
- Los tests de paridad de B y C **se mantienen** después de introducirlo: un
  tipo único no impide que un campo se calcule con otro criterio.

**Criterio de salida de D:** las tres rutas reciben el snapshot; el hash es
idéntico en todas las etapas de una operación; la aceptación con perfil
cambiado entre generación y commit muestra el cambio en vez de aplicar.

## 8. Cierre y verificación

### Por fase

Casos rojos → verdes, suite completa, lint, build, `git diff --check`, y un
fixture de 6–8 casos pareados antes/después generados localmente con
respuestas de proveedor grabadas (US$0), para revisión ciega del owner como
entrenador.

### Al cierre de D

Una corrida real de Plan Builder más las dos peticiones de chat de §10 del
roadmap (con y sin superseries), **con saldo de API confirmado por el owner
antes**. Último dato: ~US$0,60; una generación de 4 semanas cuesta ~US$0,12.

### Invariantes de no regresión (bloquean cualquier fase)

Comportamientos que ya existen y ninguna fase puede romper: athlete scope
(filas legacy sólo del self, estampado, `athlete_id` en toda escritura
remota), restricciones de seguridad de fuerza fail-closed, normalizador de
superseries como única autoridad de forma, `planLifecycle` como única
autoridad del ciclo, orden congelado del repair de fuerza, identidad por
`libraryRef`, aceptación explícita de propuestas.

### Invariantes de cierre (bloquean la fase que las tiene asignada)

| Invariante | Fase |
|---|---|
| Atleta de contexto, petición, propuesta y escritura coinciden | A |
| Consulta no termina en mutación ni redirección; confirmación sólo confirma algo concreto y vigente | A |
| Modalidad principal de squash sobrevive a dosificación, reparación y serialización | A |
| Editar metadatos no cambia entrenamiento ni historial | A |
| Señal de reducción sobrevive hasta la propuesta aplicable | A |
| La sesión objetivo y sus restricciones no desaparecen al recortar el prompt; el alcance del pedido no se recorta en silencio | B |
| Consulta histórica responde con hechos | B |
| Mismo atleta y captura producen el mismo contexto de fuerza en las tres rutas | B |
| Ningún dato posterior al slot alimenta progresión | B (contrato) / C (adopción completa) |
| Misma entrada y respuestas fijas producen decisiones equivalentes al permutar el orden de llegada | C |
| Cada job tiene un propietario autorizado; cancelación y reemplazo son terminales para el anterior | C |
| Aceptación revalida contra el estado actual y muestra cambios en vez de aplicar | D |

## 9. Decisiones deportivas pendientes de confirmación

Estas reglas cambian qué entrenamiento recibe alguien. Se confirman con el
owner **antes de B1**; hasta entonces el código actual no se toca en estos
puntos. Para cada una va la regla actual, la propuesta y la alternativa.

| # | Tema | Hoy | Propuesta | Alternativa |
|---|---|---|---|---|
| D1 | Fuente de experiencia en fuerza | Conteo de 1RM (perfil), fitness + nivel competitivo (Plan Builder), `intermediate` fijo (chat) | Campo declarado `strengthProfile.experienceLevel`. Se **eliminan** las tres inferencias. | Conservar la inferencia por 1RM como fallback etiquetado `inferred` durante una fase, con fecha de retiro. |
| D2 | Experiencia desconocida | No existe el estado; siempre se infiere algo | Estado `unknown` explícito. Elegibilidad intermedia **menos** ejercicios marcados con un flag nuevo `requiresTechnique` en el catálogo de fuerza (olímpicos, saltos de profundidad, cargas complejas). El flag no existe hoy: es metadata append-only sobre los 108 ejercicios, auditada por id como se hizo con `safety`. Dosis intermedia. | `unknown` → elegibilidad y dosis de principiante hasta declarar. Más seguro, más pobre para un atleta formado que no llenó el campo. |
| D3 | Retorno tras pausa | `returning`/`low` → `beginner` en Plan Builder | `returning` **no** es falta de experiencia técnica. Se separa en tres variables: experiencia (D1), estado de retorno (`returning` → volumen e intensidad reducidos por N semanas, técnica intacta) y recuperación (D4). `low` sigue siendo señal de condición, no de experiencia. | Mantener `returning → beginner` como aproximación conservadora. |
| D4 | Recuperación extra | `ageYears >= 35` (Plan Builder); `overloaded` (Week Creator); nunca (chat) | Sale sólo de señales agudas: fatiga declarada `overloaded`, dolor ≥ 6, energía ≤ 4 (umbrales actuales de `loadDirectivePolicy`). Es la misma regla en las tres rutas. | Conservar además un umbral de edad configurable, por defecto apagado. |
| D5 | Papel de la edad | Excluye trabajo atlético vía D4 | `ageYears` sólo modula: descanso entre series de potencia, tope de contactos pliométricos, `rpeAdjustment`. Nunca excluye por sí sola. | No usar la edad en ningún cálculo hasta tener evidencia individual. |
| D6 | Significado de la fatiga declarada | Tres tablas: 2/5/7/9 (Plan Builder y chat squash), 2/4/6/8 (Week Creator), 5 fijo (chat fuerza). El selector decide con umbrales `>= 7`, `>= 8`, `<= 4`, `<= 5`. `decideLoadDirective` da `hold` a `loaded` y `reduce` a `overloaded`. | **No es una elección numérica.** Primero se fija qué significa cada nivel para selección, volumen y progresión, reconciliado con `decideLoadDirective`. Propuesta de significado: `fresh` **habilita** progresión cuando las demás políticas lo permiten; `normal` la habilita en base y build; `loaded` mantiene (sin progresión, sin `deload` forzado, filtra sólo alto costo de fatiga); `overloaded` reduce (`deload`, filtros de intensidad). Ningún nivel de fatiga anula por sí solo taper, competición cercana, restricciones de seguridad ni ACWR en riesgo. Precedencia explícita, de mayor a menor: seguridad y restricciones → fase y competición → señales de ejecución (`decideLoadDirective`) → fatiga declarada. Recién después se elige el mapeo que **preserve esos significados frente a los umbrales del selector**; con los umbrales actuales, sólo `loaded = 7` conserva los filtros y `loaded` como `hold` exige revisar la rama que hoy devuelve `deload` a `>= 7`. Esa reconciliación es parte de la decisión. | Conservar 2/5/7/9 tal cual (Plan Builder gana) y alinear Week Creator y chat a ella, aceptando que `loaded` siga siendo `deload` en el selector y `hold` en la directiva. Más rápido, deja la contradicción documentada. |

Cuando el owner decida, la fila pasa a "decidido" con fecha y B1 la
implementa. Los fixtures de fuerza que cambien por estas decisiones se revisan
uno a uno; ese cambio es el efecto esperado, no una regresión.

### Decisiones del owner — 13 de septiembre de 2026

La tabla anterior se conserva como registro de las opciones. Lo que B1
implementa es esto:

| # | Estado | Qué implementa B1 |
|---|---|---|
| D1 | **Decidido: alternativa.** | El campo declarado `strengthProfile.experienceLevel` gana cuando existe. Sin campo declarado se conserva la inferencia por 1RM como fallback con procedencia `inferred`. **Sin fecha de retiro**: el retiro queda diferido (§11). Supuesto de implementación: el resolver aplica **una sola** inferencia, la de 1RM, igual en las tres rutas; la de fitness + nivel competitivo (Plan Builder) y el `intermediate` fijo (chat) se retiran, porque conservarlas rompe la invariante de B «mismo atleta y captura, mismo contexto en las tres rutas». |
| D2 | **Decidido: propuesta.** | Estado `unknown` explícito cuando no hay experiencia declarada ni inferible por 1RM. Elegibilidad intermedia menos los ejercicios con `requiresTechnique`; dosis intermedia. El flag es metadata append-only auditada por id. La lista inicial es la del spec (olímpicos, saltos de profundidad, cargas complejas); el owner prevé afinarla con criterio más técnico a medida que avance, siempre como cambio auditado por id. |
| D3 | **Decidido: propuesta, 2 semanas.** | `returning` deja de mapear a `beginner`: técnica y elegibilidad intactas, volumen e intensidad reducidos durante **2 semanas** (owner, 2026-09-13). En Plan Builder cuentan las dos primeras semanas del plan; en Week Creator, la semana configurada con `returning`. Magnitud: no se inventan números nuevos; se reutilizan las palancas existentes de reducción —directiva `hold` (sin progresión), `rpeAdjustment -1` y densidad −1—, sin los filtros de intensidad que D6 reserva a `overloaded`. `low` es señal de condición, no de experiencia. |
| D4 | **Decidido: propuesta más el disparador de edad actual.** | La recuperación extra sale de señales agudas —`overloaded`, dolor ≥ 6, energía ≤ 4— **o** de `ageYears >= 35`, con la misma regla en las tres rutas (aclarado con el owner el 2026-09-13, ver D5). Efecto esperado: Week Creator y chat, que hoy no aplican la edad, dejan de dar trabajo atlético a mayores de 35 y bajan la densidad igual que Plan Builder. Los fixtures que cambien por eso se revisan uno a uno. |
| D5 | **Diferido; se conserva la regla vigente.** | No se agregan las modulaciones por edad propuestas (descanso de potencia, tope pliométrico, `rpeAdjustment`). Se conserva `ageYears >= 35 → requireExtraRecovery`, que excluye todo trabajo atlético (`athleticTraining.ts`), penaliza ejercicios de alto costo de fatiga y olímpicos y baja la densidad en uno (`strengthSelector.ts`). Pasa de regla exclusiva de Plan Builder a regla del resolver, compartida por las tres rutas. |
| D6 | **Decidido: propuesta.** | Significados: `fresh` habilita progresión; `normal` la habilita en base y build; `loaded` mantiene (sin progresión, sin `deload` forzado, filtra sólo alto costo de fatiga); `overloaded` reduce. Precedencia: seguridad y restricciones → fase y competición → señales de ejecución → fatiga declarada. B1 elige el mapeo numérico que preserve esos significados frente a los umbrales del selector y revisa la rama que hoy devuelve `deload` a `>= 7`. |

## 10. Pendientes explícitos para cerrar durante A

Detalles de B, C y D que no bloquean A y se cierran antes de que empiece la
fase que los usa:

| Pendiente | Fase que lo usa | Qué falta decidir |
|---|---|---|
| Tamaño de `ExposureWindow` (semana del slot más vecinos duros: ¿1 o 2 semanas contiguas?) | B2 | Confirmar con los consumidores actuales de exposición de squash y fuerza. |
| Umbral de objetivos por lote en B4 (propuesta 12) y formato del aviso al usuario | B4 | Probar con el pedido real más largo del historial de chat. |
| Duración del lease y frecuencia de renovación (propuesta 120 s / 30 s) | C5 | Medir el intento más largo real en `plan_generation_attempts`. |
| Quién dispara la recuperación sin cliente activo (cron de Netlify) | C5 | Confirmar costo y frecuencia. |
| Regla de C6 tras el probe de consumidores de `previousWeek` | C6 | Depende del probe. |
| Fórmula del `contextHash` (qué versiones entran) | D | Debe cambiar cuando cambie cualquier política o catálogo. |
| Las seis decisiones de §9 | B1 | Decididas el 2026-09-13. |

## 11. Diferido con motivo

| Tema | Motivo | Se reabre cuando |
|---|---|---|
| F14 doble reparación / E6 velocidad | Sin instrumentación estable (A6 es lo mínimo) no se puede aceptar una mejora; el control-contra-control del 2026-08-09 ya mostró que la regla actual rechaza controles idénticos. | Después de D, con recalibración de barras y cálculo de potencia. |
| E7 experimentos de modelo | Sin baseline de contexto corregido, compara ruido. | Después de D y de una ventana de uso real. |
| F12 cycling y movilidad | Sin demanda en el piloto squash-first. | Si un cliente del piloto los usa. |
| Vigencia en instrucciones del generador Plan Builder (B I11) | `src/services/week/prompts/weekPrompt.ts` conserva fatiga del wizard en texto y condiciones que eligen instrucciones, aunque la selección local de fuerza ya aplica vigencia. B caracteriza el efecto con escenarios vigente/vencido, sin equipararlo a un cambio cosmético. | Fase C, al alinear instrucciones con la declaración vigente por slot. |
| Onboarding breve | Es UI y captura; consume B pero no lo condiciona. | Plan propio después de B. |
| Retiro de la inferencia de experiencia por 1RM (D1) | El owner la mantiene temporalmente. | Cuando haya dato de cuántos atletas declaran `experienceLevel`, o con el onboarding breve. |
| Modulación por edad (D5) | Sin evidencia individual; el owner la difiere. | Con evidencia de uso real de atletas masters. |
| Dosis por serie | Cambio de modelo de `Exercise`, Dexie, serializadores, backup y sync. | Plan propio después de B; requiere E2 del documento del 10 de septiembre. |

## 12. Migración y compatibilidad

- Campos nuevos opcionales y en `jsonb` donde sea posible
  (`RunningDetails.materialization`, `experienceLevel`, disponibilidad por
  franja). Sólo `037` es migración remota; se escribe, se aplica manualmente
  y se verifica antes de darla por hecha.
- Las acciones nuevas `offer_generation` y `ask_clarification` entran al
  allowlist del normalizador; ninguna transporta identidad de contenido.
- Cada resolver entra por adaptadores de las interfaces actuales, una ruta
  por vez, con comparación en sombra local (sin segunda llamada de IA).
- Sesiones históricas no se rematerializan ni reciben resultados inventados.
- Activación por ruta con reversión independiente; una reversión de
  orquestación no puede desactivar postcondiciones de restricciones ni
  permitir escrituras de un worker obsoleto.
- Antes de retirar una implementación anterior: cobertura del adaptador,
  aceptación, serializadores, export/import y sync.

## 13. Riesgos

- `repairWeek.ts` (4.848 líneas) y `actionPostProcessor.ts` (2.121) son los
  puntos de mayor riesgo de regresión. Mitigación: A no los reestructura; B
  sólo reemplaza los constructores de contexto por llamadas al resolver.
- Los cambios de §9 mueven fixtures de fuerza. Mitigación: decisión previa y
  revisión fila a fila.
- El corpus de A4 puede revelar que el engine hoy enruta mal frases que los
  tests fijan. Mitigación: cada cambio de expectativa se justifica en el
  corpus, no se acepta por alinear.
- El modelo puede no emitir `offer_generation` de forma fiable. Mitigación:
  sin oferta estructurada no hay intención pendiente y la confirmación corta
  es conversación; el fallo es hacia lo seguro.
- `037` toca la cola remota en producción. Mitigación: runbook con rollback,
  aplicación fuera de una generación en curso.

## 14. Siguiente paso

Revisión de este documento por el owner. Con su aprobación, plan de
implementación de la Fase A con el skill de planes. Las decisiones de §9 y
los pendientes de §10 se cierran durante A.
