# Smoke de producción — 5 planes arquetipo (QA deportiva)

Fecha: 2026-08-13

URL: `https://app.rallyiq.cl` → `https://entrenadoralph.netlify.app/`

Cuenta autenticada: `rafa.allendes@gmail.com` (cuenta real de producción del owner).
Scope de trabajo: atleta gestionado **"Juan perez"** (`ath_m_0eea9851-9b20-4af9-9a82-6c73fde5b9e6`),
operado bajo el banner "Entrenando a Juan perez" en todo momento. El self del owner
(91 sesiones reales, Whoop conectado) **no fue tocado**.

Autorización: el owner confirmó explícitamente por chat que "Juan perez" es un
atleta gestionado real dentro de su cuenta de producción — de hecho resultó ser
el mismo atleta de prueba `SMOKE-A`/`SMOKE-B` usado en el smoke de modalidad de
squash del 2026-08-11/12 (confirmado por el título `Plan SMOKE B - Campeonato
multijornada` ya presente al iniciar esta sesión) — y autorizó explícitamente
escribir sobre él, incluyendo el gasto de crédito real de Anthropic.

**Veredicto general: APROBADO PARCIAL, con hallazgos técnicos que bloquean
recomendar el flujo de "varios planes de competencia seguidos sobre el mismo
atleta" como confiable hoy.** El contenido semana a semana que generó Plan
Builder es de buena calidad y respeta en general las reglas deportivas de la
sección E del roadmap; el problema real apareció en la capa de persistencia
del ciclo de plan / perfil de atleta, no en el motor de generación.

## Qué se hizo

1. Se verificó dos veces el banner "Entrenando a Juan perez" antes de escribir
   (al empezar la sesión y de nuevo al reanudar tras la corrección del
   coordinador). Nunca se pulsó "Volver a ti".
2. Se configuró el perfil del atleta (Ajustes → Perfil de atleta) con datos
   ficticios plausibles para cada arquetipo: edad, peso, disciplinas, 1RM de
   referencia, disponibilidad semanal y, para el arquetipo 4, una lesión de
   rodilla con restricciones activas.
3. Se generaron y aceptaron **4 planes de Plan Builder** (arquetipos 1-4) y
   se ejecutó **Crear semana** vía chat para el arquetipo 5.
4. Se exportaron **4 respaldos JSON completos de la app** (Ajustes → Respaldo
   JSON → Exportar) y **1 export de diagnóstico de Beta Quality**. No hubo una
   exportación individual inmediatamente después del arquetipo 3: los
   arquetipos 3 y 4 quedaron registrados juntos en el respaldo combinado
   exportado después de aceptar el arquetipo 4. Los cinco archivos raw quedaron
   temporalmente en
   `/private/tmp/claude-501/-Users-rafaallendes-Projects-entrenador-app/bb38fc24-5f7d-4da7-bb59-26a4b5180124/scratchpad/archetype-backups/`:
   - `arquetipo1-torneo4semanas-backup.json`
   - `arquetipo2-3dias-backup.json`
   - `arquetipo3-and-4-backup.json`
   - `beta-quality-after-arquetipo2-failure.json` (diagnóstico, no backup)
   - `final-all-archetypes-backup.json` (estado final, los cinco arquetipos)
   Al estar bajo `/private/tmp`, estos raws no son un entregable durable. El
   manifiesto y los extractos sanitizados que sustentan las conclusiones de
   este reporte se conservan en
   `docs/superpowers/smokes/evidence/2026-08-13-archetype-plans-prod-smoke-evidence.json`.
5. El contenido de cada plan se auditó leyendo `trainingPlanWeeks[].sessions`
   directamente del JSON exportado (no solo la UI), porque esa estructura es
   un snapshot embebido en el registro del plan y no depende de que todas sus
   sesiones puedan atribuirse a filas del calendario final. Eso hace que el
   análisis de contenido por arquetipo sea válido pese a la discordancia que se
   documenta en el Hallazgo 7.

## Presupuesto consumido

- El owner confirmó en vivo que la causa del primer fallo (arquetipo 2, 9
  semanas) fue el rate limit diario de `plan_builder_week` (12/día), con 5 ya
  consumidas por el arquetipo 1.
- Se ajustó el alcance de los arquetipos 2-4 para caber en el remanente diario:
  arquetipo 2 de 9 semanas bajó a 4, arquetipo 3 a 2 semanas, arquetipo 4 a 1
  semana. Esto está declarado explícitamente en cada sección de abajo — **no
  son arquetipos "limpios" de la duración que pide el roadmap**, son versiones
  acotadas por presupuesto del mismo escenario.
- Semanas de `plan_builder_week` generadas con éxito: 5 (arq. 1) + 4 (arq. 2,
  tras un primer intento de 9 semanas fallido con 0 semanas completadas,
  ver Hallazgo 3) + 2 (arq. 3) + 1 (arq. 4) = **12/12 del cupo diario**.
  El intento fallido de 9 semanas no restó cupo (`dailyUsage` se mantuvo en 5
  después de fallar dos veces).
  Costo estimado: 12 semanas × ~US$0,029 ≈ **US$0,35**.
- El arquetipo 5 (Crear semana) corrió por `week_creator`, con presupuesto
  diario separado (8/día) y no consumido por los arquetipos 1-4.
- No se corrió el loadtest ni ninguna medición pagada fuera de estas 12
  semanas de Plan Builder y las llamadas de chat/week_creator del arquetipo 5.

## Arquetipo 1 — Torneo interclubes en 4 semanas

Perfil: 27 años, 76 kg, squash + fuerza, objetivo "Competir mejor", nivel
intermedio, 1RM (banca 85 / sentadilla 115 / peso muerto 150 / press hombro 55
/ dominadas 10), disponibilidad L·Ma·J·S (4 sesiones), forma física normal,
fatiga normal. Evento: torneo squash a 4 semanas (10 sep 2026).

- **5/5 semanas generadas** (Build×2, Peak×2, Race×1). La duración media de IA
  por request/semana fue ~16,9 s; el plan completó en **38,184 s de wall-clock**
  y acumuló **84,504 s de duración de IA**, cifras compatibles con la
  concurrencia configurada de 3 requests. `quality_version 2`, score 88
  ("good"), 1 warning
  `quality.strength.repeated_template` (semanas 3 y 4 del bloque peak
  comparten 4 accesorios de fuerza — ver Hallazgo 5).
- **1RM usado correctamente**: verificado numéricamente contra el perfil
  guardado. Ej. sentadilla trasera 82,5 kg / 72% ≈ 115 kg × 0,72 = 82,8;
  press vertical 40 kg / 72% ≈ 55 kg × 0,72 = 39,6. Los ejercicios sin 1RM
  directo (peso muerto rumano, sentadilla frontal, press banca agarre
  cerrado) muestran factores de `loadReference` deportivamente razonables
  (≈0,8-0,9 del lift base), consistente con §18 del roadmap.
- **Superseries generadas automáticamente por la política determinista**:
  2 grupos en la semana de build (dead bug + chop de zona media; press
  vertical + remo) y 1 grupo en peak (press banca agarre cerrado + remo
  inclinado), todos con `sets` coincidente entre miembros. Confirma que
  §23 (superseries) está activo en producción, no solo en tests.
- **Modalidad de squash nunca se cruzó**: cada sesión mostró exactamente un
  `sessionKind` (`technical`/`control`/`match`) y sus drills coincidían con
  la modalidad declarada (`executionMode: solo` en control,
  `partner` en técnico, `match` en partido).
- **Match play**: las 5 sesiones de partido en build/peak/race dicen
  "mejor de 5 juegos" — coherente con A2.5 (build/peak normal → mejor de 5).
  No se observó ningún arquetipo con fase `base` en este smoke (ver
  Hallazgo 4), así que "mejor de 3 en base" queda **sin verificar**.
- **Taper/race protegido**: la semana de race trajo solo 3 sesiones
  (shadows 15 min, control 20 min, partido del evento 60 min) — sin fuerza
  ni accesorios de más.
- **Running/ciclismo**: no aparecieron (no se seleccionaron como
  complementarios) — correcto.
- Backup exportado y verificado: `arquetipo1-torneo4semanas-backup.json`.

## Arquetipo 2 — 3 días disponibles, torneo lejano

Perfil: mismo atleta, disponibilidad reducida a L·Mi·V (3 sesiones), objetivo
"Terminar bien / Llegar", nivel novicio, forma física "Bajo de forma",
fatiga "Descansado". Evento original pedido: ~9 semanas (8 oct); **reducido a
4 semanas (3 sep) por el límite diario** — ver "Presupuesto consumido".

- **Primer intento (9 semanas) falló dos veces** con "No pudimos completar la
  operación" — causa confirmada por el owner: rate limit diario. Ver
  Hallazgo 3.
- **4/4 semanas generadas** tras acotar la fecha. Fases: Peak×3, Competencia×1
  — **sin fase Base pese a "Bajo de forma"** (ver Hallazgo 4).
- Squash-only (sin fuerza, correcto: no se seleccionó complementario).
- Modalidad sin cruces: control con drills `solo`, técnico con `partner`,
  match con `match`.
- Match play "mejor de 5" en las 3 semanas peak — coherente con A2.5, aunque
  discutible dado un atleta "bajo de forma" jugando partidos completos desde
  la semana 1 (ver Hallazgo 4).
- Última semana (race): 1 apoyo técnico de 25 min + el evento — dentro de los
  topes de B4.2.
- Backup exportado: `arquetipo2-3dias-backup.json`.

## Arquetipo 3 — 5-6 días con doble sesión ocasional

Perfil: disponibilidad L-S (6 días), doble sesión habilitada en Ma y V,
objetivo "Ganar / Competir por el resultado", nivel avanzado, forma "En buena
forma", fatiga normal. Evento reducido a **2 semanas** (20 ago) por
presupuesto.

- **2/2 semanas generadas.** Fases: Taper→Competencia (evento muy cercano, sin
  Base/Build — esperable con solo 2 semanas).
- **Doble sesión confirmada funcionando**: el 2026-08-14 (viernes, día marcado
  para doble) trajo AM Squash Match Play (40 min) + PM Movilidad (25 min). El
  2026-08-18 (martes de la semana siguiente, también configurado para doble)
  repitió el patrón con
  toque de control + movilidad el mismo día.
- **Diferencia de criterio detectada**: la semana de race trajo **4 sesiones
  previas al evento** además del ancla (shadows 20 min, toque control 20 min +
  movilidad 20 min el mismo día, toque técnico con partner 25 min). B4.2 del
  smoke anterior documentaba "máx. 2 apoyos" para toda la semana, pero el
  contrato implementado limita a 2 únicamente los apoyos que caen **dentro de
  la ventana del evento**; fuera de ella rigen las reglas de taper. Ver
  Hallazgo 6.
- Contenido verificado en `arquetipo3-and-4-backup.json`, respaldo combinado
  exportado después de aceptar el arquetipo 4; no hubo un export inmediato al
  terminar el arquetipo 3.

## Arquetipo 4 — Retorno con molestia de rodilla

Perfil: lesión activa cargada en Ajustes ("Dolor rotuliano en rodilla derecha
... evitar saltos, sentadilla profunda y partido competitivo"), forma física
"Volviendo de descanso o lesión", fatiga "Cargado", disponibilidad L·Mi·V.
Evento reducido a **1 semana** (16 ago) por presupuesto — el mínimo que el
wizard permite generar.

- **1/1 semana generada.** La semana entera contiene **una sola sesión**: el
  evento real del domingo ("Squash - Competencia Objetivo", 60 min), sin
  ningún entrenamiento previo pese a tener 3 días configurados disponibles
  antes del evento.
- **Lectura positiva (cumple A2.5):** no se agregó ningún partido de práctica
  adicional pese a que la semana cae en fase `race` — el veto de restricción
  médica sobre exposición competitiva extra se respetó.
- **Lectura ambigua, reportada sin veredicto:** que la única sesión de toda
  la semana sea el evento forzoso, sin ninguna activación ni sesión ligera en
  los 3 días previos configurados, es defendible como "proteger la rodilla
  antes de un evento inevitable" pero también podría ser una supresión
  excesiva del contenido de apoyo. No hay una regla explícita del roadmap que
  esto viole — se deja para revisión de un entrenador humano usando el
  checklist adjunto.
- Contenido verificado en el respaldo combinado
  `arquetipo3-and-4-backup.json`, exportado después de aceptar este arquetipo.

## Arquetipo 5 — Semana con poco sueño y match cercano (Crear semana)

No es un plan de Plan Builder — es el escenario de **Crear semana** vía chat,
sin costo de `plan_builder_week`.

1. Check-in del día cargado manualmente: Energía 3/10, Dolor/molestia 3/10,
   Calidad de sueño 1/5, con nota "Dormí muy poco esta semana, tengo un
   partido importante el domingo".
2. Primer intento de chat ("Créame una semana...") **falló** con "Para
   proponer una semana necesito conocer tus deportes y disponibilidad
   horaria" — pese a que el perfil ya se había guardado exitosamente para el
   arquetipo 1. Esto es la manifestación en el chat del Hallazgo 1 (reseteo
   de perfil).
3. Se volvió a rellenar el perfil (disciplina Squash, disponibilidad
   L·Ma·J·S) y se reintentó **una vez**: la propuesta se generó
   correctamente.
4. **Resultado correcto**: la propuesta agregó 2 sesiones ligeras (técnica
   60 min jueves, control 60 min sábado) en días permitidos, con nota
   explícita: *"Planificación semanal ajustada a fatiga baja y días
   permitidos, con sesiones squash recreativas y carga reducida."* La sesión
   de partido del domingo (proveniente del arquetipo 4) **no fue tocada ni
   duplicada** — se verificó abriendo el día domingo después de aplicar el
   cambio.
- Observación menor: pese a decir "carga reducida", ambas sesiones
  propuestas quedaron en RPE 6 / 60 min (la duración máxima del perfil), no
  claramente reducidas frente a una sesión normal. No se considera un fallo
  duro, pero vale la pena una revisión de copy/calibración.
- Backup exportado: `final-all-archetypes-backup.json`.

## Hallazgos técnicos (no arreglados — reportados para triage)

### Hallazgo 1 — El perfil estructurado del atleta no persiste de forma confiable

Después de aceptar el plan del arquetipo 1, y de nuevo después del arquetipo
4, la sección "Deporte y perfil base" de Ajustes apareció completamente en
blanco (nombre, edad, peso y disciplinas volvieron a placeholder), pese al
mensaje "Perfil guardado. RallyIQ usará estos cambios en la próxima
respuesta." mostrado momentos antes. Esto llegó a bloquear el chat
("necesito conocer tus deportes y disponibilidad") en el arquetipo 5. Se
reprodujo dos veces de forma independiente en esta sesión. Correlaciona
temporalmente con los errores de consola `sync:failure` /
`queue:op_expired` / `queue:op_failed` observados repetidamente (ver
Hallazgo 2) — hipótesis razonable, no confirmada, es que el guardado local
del perfil queda condicionado a una sincronización que está fallando.

### Hallazgo 2 — Errores de sync recurrentes durante toda la sesión

`[sync] sync:failure`, `[sync] queue:op_failed`, `[sync] queue:op_expired` y
`[sync] queue:ops_expired_summary` aparecieron en la consola en múltiples
puntos de la sesión (después de crear planes, después del check-in, en
recargas). No se profundizó la causa raíz — está fuera del alcance de un
smoke de QA deportiva y merece su propia investigación con
`systematic-debugging`.

### Hallazgo 3 — Un plan que excede el rate limit diario falla sin mensaje claro de causa

Pedir 9 semanas cuando solo quedan 7 de cupo diario no dio ningún aviso
explícito de "te quedan N semanas hoy" — el error mostrado fue genérico
("No pudimos completar la operación. Inténtalo de nuevo en un momento.") y
se repitió idéntico en el reintento. Solo se identificó la causa real porque
el owner la conocía de antemano. Un usuario real no tendría forma de saberlo
por el mensaje de UI. El diagnóstico Beta Quality confirmó `dailyUsage: 5`
sobre un límite de 12 y sí contenía trazas async exitosas anteriores, pero no
incluyó una entrada atribuible a este rechazo de 9 semanas; por tanto tampoco
ofrecía desde ese export una causa explícita para el intento fallido.

### Hallazgo 4 — Ningún arquetipo probado alcanzó fase Base pese a solicitarla

Los arquetipos 1-4 pidieron explícitamente "Bajo de forma" (arq. 2) o
"Volviendo de descanso o lesión" (arq. 4), y aun así el plan más corto
saltó directo a Peak/Competencia sin ningún bloque de base. Esto es
consistente con que los eventos quedaron muy cerca por el recorte de
presupuesto (ver "Presupuesto consumido") — un plan de 1-4 semanas
razonablemente no tiene espacio para una fase Base completa. **Este smoke no
aporta evidencia productiva para esas variantes**, pero no justifica por sí
solo otra corrida pagada: la política y su materialización ya tienen cobertura
determinista para mejor de 3 en Base y para fatiga `loaded` en
`squashWeeklyExposurePolicy.test.ts` y `squashWeeklyExposureRepair.test.ts`.
Repetir en producción queda reservado para un gate de rollout específico, no
como requisito para corregir los hallazgos de persistencia de este informe.

### Hallazgo 5 — Repetición de accesorios de fuerza entre semanas de peak (arquetipo 1)

El propio `qualityReview` del plan marcó
`quality.strength.repeated_template`: "Semanas 3 y 4 del bloque peak
comparten 4 accesorios de fuerza." Verificado manualmente contra el JSON: de
8-9 ejercicios por sesión, 5 se repiten exactos entre semana 3 y semana 4
(dead bug, lanzamiento rotacional, peso muerto rumano, sentadilla trasera,
press vertical). El sistema de calidad lo detecta y lo reporta como warning,
pero **no lo evita** — corresponde exactamente al criterio del roadmap
"Confirmar que fuerza no repita plantillas clonadas semana a semana", que
**no se puede marcar como cumplido**.

### Hallazgo 6 — Criterio de smoke desalineado con la ventana de evento (arquetipo 3)

La semana de competencia del arquetipo 3 trajo 4 sesiones previas además del
ancla (shadows, control+movilidad el mismo día por la doble sesión, y técnico
con partner). La inspección posterior del código y sus tests deterministas
confirmó que ninguna cae dentro de la ventana del evento: el máximo de 2 se
aplica a los días de esa ventana, no a toda la semana `race`; los días previos
siguen las reglas de taper. Por tanto, este resultado **no demuestra una
regresión de código**. Sí revela una decisión de producto/deportiva pendiente:
mantener el contrato actual o agregar un techo adicional para la carga total de
la semana. Hasta resolverla, B4.2 del smoke de 2026-08-11 no debe usarse para
bloquear una semana por contar también sesiones previas a la ventana.

### Hallazgo 7 — Seis planes activos y calendario parcialmente discordante

Al final de la sesión, después de generar los arquetipos mediante "Editar"
sobre el plan existente, el atleta tenía **6 `trainingPlans` con
`status: 'active'` simultáneo**
(2 planes `SMOKE A`/`SMOKE B` heredados del smoke de squash del 2026-08-11/12,
más los 4 arquetipos de esta sesión). Verificado en el backup final:

```
1a2c8ce9  Plan SMOKE B - Campeonato multijornada         active
34d9b7bf  Plan Arquetipo 4 - Retorno con molestia rodilla  active
b83b8806  Plan Arquetipo 1 - Torneo interclubes 4 semanas  active
c32f1d1b  Plan Arquetipo 3 - 5-6 dias con doble sesion     active
e51b62af  Plan SMOKE A - Torneo corto                      active
f7423c89  Plan Arquetipo 2 - 3 dias disponibles             active
```

Consecuencia observada: el Home y la Semana visible mostraron
intermitentemente **"Sin plan de competencia"** pese a que `/competition-plan`
sí mostraba un plan activo con fase y semana correctas — dos superficies de
la misma app en desacuerdo sobre si existe un macroplan. La comparación del
calendario final (`sessions`, la tabla que alimenta `/week`) contra los
snapshots embebidos conservó coincidencias exactas por fecha+título para
**4/17 sesiones del arquetipo 1** y **5/9 sesiones del arquetipo 2**. Por
tanto, el síntoma es de **pérdida o sobrescritura parcial**, no de desaparición
total.

La evidencia disponible no permite identificar el mecanismo ni atribuir esas
filas a un plan de forma concluyente: `sessions` no conserva `planId` y las
sesiones de `trainingPlanWeeks[].sessions` usadas como snapshot tienen
`id: null`. La comparación fecha+título mide correspondencia, pero no prueba
procedencia ni que aceptar planes posteriores haya eliminado o reemplazado
sesiones anteriores. El contenido semana a semana analizado en este reporte
sigue siendo válido porque proviene del snapshot embebido; lo confirmado es
que **el estado final del calendario solo coincide parcialmente con sus
registros de plan y no es trazable por plan**. No se investigó si la
discordancia es específica de la ruta "Editar sobre un plan ya aceptado", del
cierre de ciclo (`closePlanCycle`) o de otro proceso.

## Qué no se pudo verificar y por qué

- **"Mejor de 3 en base" (A2.5):** ningún arquetipo generado en este smoke
  llegó a fase Base (ver Hallazgo 4).
- **"Mejor de 3 en build/peak con carga `loaded`":** ningún arquetipo usó
  fatiga "Cargado"/"Muy cargado" combinada con fase build/peak normal (el
  arquetipo 4 con fatiga "Cargado" cayó directo en `race` de 1 sola sesión).
- **Los 6 pasos de verificación manual de superseries del roadmap §23**
  (crear una a mano, guardar/recargar, aplicar plantilla dos veces,
  export→import round-trip, pedir con/sin superseries por chat) **no se
  ejecutaron como protocolo dedicado**. Sí se observó de forma indirecta que
  Plan Builder genera superseries automáticamente en producción (arquetipo
  1), lo cual confirma que el mecanismo está vivo, pero no cubre los bordes
  manuales (edición, plantillas, backup round-trip, negación explícita por
  chat).
- **Verificación post-deploy de `squashKind` v2 / A2.5 con datos "limpios":**
  la mezcla de 6 planes activos y la correspondencia parcial no trazable de
  las sesiones (Hallazgo 7) hace que el estado final del calendario del atleta
  **no sea representativo** de un uso real de un solo plan. La lectura de
  contenido por plan (vía `trainingPlanWeeks`) es confiable; la lectura del
  calendario visible al final de la sesión no lo es.
- **Costo real vs. estimado:** no se exportó `coach_requests`/Supabase para
  contrastar contra el estimado de US$0,35; se reporta el estimado basado en
  semanas generadas × precio documentado en `OPTIMIZATION_AND_COSTS.md`.

## Consola y red

- Errores de consola recurrentes: ver Hallazgo 2 (`sync:failure`,
  `queue:op_failed`, `queue:op_expired`, `queue:ops_expired_summary`).
- No se observaron errores 4xx/5xx directos en las llamadas de red
  capturadas (el tooling de red del navegador solo pudo capturar llamadas
  `OPTIONS` a Supabase para `whoop_workouts`, sin visibilidad de las
  llamadas a las Netlify Functions del coach/plan builder).
- No se disparó ningún `alert`/`confirm` nativo del navegador.

## Resultado

- Entorno: `https://entrenadoralph.netlify.app/` (dominio detrás de
  `app.rallyiq.cl`), cuenta `rafa.allendes@gmail.com`, atleta gestionado
  Juan Perez.
- Arquetipos generados y revisados: **5/5** (4 vía Plan Builder + 1 vía Crear
  semana), todos con contenido inspeccionado semana a semana desde el backup
  exportado.
- Evidencia raw temporal: **4 backups de la app + 1 export de diagnóstico** en
  el scratchpad bajo `/private/tmp` (ver arriba). La evidencia durable es el
  manifiesto con extractos sanitizados guardado en
  `docs/superpowers/smokes/evidence/2026-08-13-archetype-plans-prod-smoke-evidence.json`.
- Costo estimado: ~US$0,35 en `plan_builder_week` (12/12 semanas del cupo
  diario), más costo menor de `chat_action`/`week_creator` para el
  arquetipo 5.
- Hallazgos: 7, documentados arriba con evidencia reproducible.
- **Veredicto: APROBADO PARCIAL.** El motor de generación semana a semana
  (squash modality, 1RM, superseries, taper) se comporta correctamente en la
  mayoría de los casos probados. La capa de persistencia de perfil y de
  ciclo de plan (Hallazgos 1, 2 y 7) necesita triage antes de recomendar el
  flujo de "generar varios arquetipos/planes seguidos" como confiable para
  el piloto — un usuario real normalmente generaría **un solo** plan de
  competencia activo por vez, así que el Hallazgo 7 podría no manifestarse
  en el uso real esperado, pero el Hallazgo 1 (reseteo de perfil) si podría,
  y bloquearía el chat sin explicación clara al usuario.
