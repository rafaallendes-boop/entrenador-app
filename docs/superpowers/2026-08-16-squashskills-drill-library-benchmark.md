# Benchmark: SquashSkills Training App vs. librería de squash de RallyIQ

Fecha: 2026-08-16
Alcance: revisión de `https://squashskills.com/squashskills-training-app` (y su
catálogo de video hermano en `tv.squashskills.com/catalog`) comparada contra
`src/services/training/drillLibrary.ts` (54 drills) y su motor de composición
(`squashSessionHydrator.ts`, `squashWeekPlanner.ts`, política A2.5 de exposición
semanal descrita en `PROJECT_REVIEW_AND_ROADMAP.md` §27).

No se modificó código en esta revisión — es un documento de hallazgos, no una
implementación.

## 1. Qué es SquashSkills Training App

Es una app móvil (iOS/Android) exclusiva para suscriptores de SquashSkills, en
una plataforma separada del sitio principal. La landing pública es
mayoritariamente marketing: no expone un catálogo navegable de drills sin
login/suscripción. Lo que sí se pudo leer:

**Features declaradas:** Squash Session Library, Fitness Session Library,
Session Categories, Guided Sessions, Session Timer, 6-Week Programs, Training
Calendar, integración con Apple Health/Google Fit/Fitbit/MyFitnessPal.

**Categorías de sesión visibles en el mockup de la app** (capturas de pantalla
de teléfono en el hero, leídas con zoom — la lectura de dos celdas quedó
incierta y se marca abajo):

- New
- *(celda borrosa, posiblemente "Beat Yourself" — auto-superación de marca
  personal; no se pudo confirmar con certeza)*
- Solo
- Pairs
- *(celda borrosa, posiblemente "Three" — drills de tres jugadores)*
- *(celda borrosa, posiblemente "Coach picks/sets")*
- Technical
- Tactical
- Using height
- Ghosting

**Ejemplo de sesión real visible:** "Simon Rösner's solo practice 1" —
sesión curada con varios drills: "Freestyle solo", "Back wall drives with
vo[lleys]", "Mid court volleys - sync[hro]...", "Mid court lob - open
fa[ce]...".

**Ejemplo de calendario de entrenamiento (Training tab):**
- "On-Court Repeat-Sprint Burn" — 12 exercises
- "Multi-Stage Endurance Ghost" — 16 exercises
- "Fitness: Pyramid Gym Challenge" — 5 exercises

Todo el contenido es **basado en video**: cada drill/sesión tiene un video
demostrativo grabado por un coach. Es la diferencia de producto más grande
frente a RallyIQ, que es texto + estructura ejecutable. No es un hallazgo
accionable ahora (fuera de alcance dado el estado pre-lanzamiento del
roadmap), solo contexto necesario para interpretar el resto.

## 2. Señal adicional: `tv.squashskills.com/catalog`

Al navegar desde la landing, terminé en el catálogo de video de SquashSkills
(mismo ecosistema de marca, producto hermano de coaching en video, no la
Training App en sí). Sin pagar, esto quedó visible como catálogo público de
títulos con descripción corta — no el contenido en sí. Sirve como segunda
fuente de qué categoriza SquashSkills como pilares de contenido, con más
detalle que los mockups pequeños de la landing:

- **Movimiento/ghosting**: varias playlists dedicadas (Alex Stait, Joel Makin,
  Hadrian Stiff, Ali Farag, Nick Matthew, Miles Jenkins, Jethro Binns).
- **Práctica en solitario**: al menos 4 guías distintas de distintos coaches/ex
  número 1 del mundo (Nick Matthew, David Palmer, Joey Barrington — 16 videos,
  Simon Rösner).
- **Drills de pareja y de tres jugadores**: "A Guide To Pairs Drills" y "8
  Three-Player Drills" (Shaun Moxham).
- **Voleas**: kills, variaciones, volea alta, volea drop, forehand/backhand
  volley series.
- **Esquinas de fondo**: 4 playlists dedicadas a salir de las esquinas
  traseras.
- **Lob/altura**: "The Art Of The Lob", "Mastering The High Ball" (Laura
  Massaro).
- **Saque y resto de saque**: 4 títulos dedicados (Lee Drew ×2, Hadrian Stiff,
  Shaun Moxham).
- **Presión/apertura de cancha**: 6+ Ways To Apply/Absorb Pressure, Make The
  Court Bigger (Gilly Lane), Shot Partnerships (David Campion).
- **Mentalidad bajo presión**: "Heroes and Victims" (Hadrian Stiff).
- **Estructura de warm-up**: "How To Structure Your Warm Up" (Gary Nisbet).
- **Masters**: "A Tactical Blueprint For Masters Squash" (Jesse Engelbrecht) —
  relevante porque el usuario de RallyIQ es squash competitivo masters.
- **Doubles hardball**: fuera de alcance (RallyIQ es singles).

## 3. Cómo está estructurada nuestra librería, en resumen

`SQUASH_DRILL_LIBRARY` tiene **54 drills**, cada uno con identidad explícita
y sin ambigüedad de modalidad (ver comentarios del propio archivo — esto ya
fue corregido en el pasado, ver roadmap §27):

- `sessionKind: 'technical' | 'control' | 'shadows' | 'match'` — autoridad
  única de a qué bloque de sesión pertenece.
- `executionMode: 'solo' | 'partner' | 'match'` — autoridad única de qué
  necesita para ejecutarse (`either` no existe como valor válido).
- `category: 'technical' | 'tactical' | 'physical' | 'match'` — coincide casi
  1:1 con las categorías "Technical"/"Tactical" que muestra el mockup de
  SquashSkills.
- `phaseAppropriate`, `intent`, `progressionLevel`, `constraints`,
  `aliases` — metadata que SquashSkills no expone públicamente (o no la tiene,
  al ser contenido curado a mano por humanos en vez de generado).

El motor (`squashSessionHydrator.ts` + política A2.5) compone sesiones sin
cruzar modalidad, respeta fase (base/build/peak/taper/race), y calibra cuánta
exposición a partido real corresponde por semana según fatiga y proximidad al
evento — una sofisticación de periodización que SquashSkills, al ser una
librería de sesiones pre-grabadas y categorías planas sin evento objetivo
declarado, no tiene. Esto es una fortaleza nuestra, no un hueco — se anota
para dar contexto al resto del documento y evitar que los hallazgos de abajo
se lean como "estamos atrás".

## 4. Hallazgos

### P1 — Hueco de contenido real: saque y resto de saque

**0 de 54 drills** entrenan el saque o el resto de saque como habilidad. La
única aparición de "saque" en el catálogo es `cuadro de saque` (service box)
como **zona objetivo** dentro de drills de drive/control — nunca como técnica
de sacar o restar.

SquashSkills, en cambio, dedica contenido explícito y repetido: "5 Ways To
Improve Your Serve", "5 Ways To Improve Your Return Of Serve", "8 Steps To
Improve Your Backhand Return Of Serve", "Squash Fundamentals - The Serve".

El saque pesa menos en squash que en tenis (no hay tie-break de saque, el
rally decide igual), pero sí es un hueco genuino: hoy ningún atleta gestionado
puede recibir una sesión con foco explícito en variar el saque (alto/bajo,
lento/rápido, hacia el cuerpo) o en el patrón de resto agresivo vs.
conservador. Es barato de cerrar: 2-4 drills nuevos bastarían, con
`sessionKind: 'control'` (solo, con pared) o `'technical'` (con partner).

**Sugerencia concreta** (no implementada, requiere brainstorming/spec propio si
se decide avanzar): agregar algo como `solo_serve_targets` (variación de
alturas/profundidad de saque contra la pared) y `return_of_serve_depth`
(resto con partner, foco en devolver profundo antes de atacar).

### P2 — Pool de ghosting/conditioning (`shadows`/`physical`) es angosto frente a lo que SquashSkills muestra

Solo 6 drills cubren movimiento sin pelota o acondicionamiento específico:
`ghosting_4_corners`, `ghosting_6_points`, `split_step_t_recovery`,
`rsa_short_bursts`, `continuous_squash_movement_base`,
`extensive_aerobic_movement_intervals`.

El calendario de SquashSkills muestra sesiones de ghosting con **16
"exercises"** en una sola sesión ("Multi-Stage Endurance Ghost") — sugiere
progresión interna por etapas dentro de un mismo drill, algo que nuestros dos
drills de ghosting no tienen (son single-stage: 4 esquinas o 6 puntos, sin
variantes de intensidad creciente).

Esto se relaciona directamente con un hallazgo ya abierto y documentado en el
roadmap (§29, "Causa B" de `quality.strength.repeated_template`): pools
angostos son la causa raíz de que la rotación determinista converja bajo
concurrencia. El mismo patrón aplicaría acá si se generan muchas semanas de
`build`/`peak` en paralelo — 6 candidatos es menos margen que los pools de
fuerza (rotación 7, push 10, pull 13) que el roadmap ya identificó como
insuficientes en un caso similar.

**No es urgente para el piloto**, pero es la señal más reutilizable de esta
revisión: si se prioriza ampliar algún pool de squash antes que el de fuerza,
este es el candidato con menos densidad relativa.

### P3 — "Using height" (uso del lob) no es un eje de primer nivel en nuestro catálogo

Tenemos cobertura funcional (`defensive_high_lob_recovery`,
`attacking_lob_change_of_pace`, foco `lob` en varios `tags`), pero
SquashSkills lo trata como categoría/pilar táctico propio, mientras que en
nuestro catálogo es solo un `focus` tag entre otros, sin agrupación visible
para el coach en el picker (`coachExerciseCatalog.ts`). Es un tema de
nomenclatura/agrupación en UI, no de contenido faltante — bajo impacto.

### P3 — Sin modalidad de tres jugadores

SquashSkills tiene contenido dedicado a drills de 3 jugadores ("8
Three-Player Drills"). `SquashDrillExecutionMode` solo admite
`solo | partner | match`. Dado que RallyIQ está diseñado para
atleta-individual con coach 1:1 (no clases grupales), esto es **fuera de
alcance por diseño**, no un hallazgo a corregir — se anota para que quede
explícitamente descartado y no resurja como pregunta suelta.

### Contraste a favor de RallyIQ (para no leer esto en una sola dirección)

- **Periodización real ligada a un evento objetivo** (fase, taper, exposición
  competitiva calibrada por A2.5) — SquashSkills ofrece categorías planas de
  sesiones pre-grabadas sin conexión a un calendario de competencia del
  usuario.
- **Generación personalizada** por fatiga, restricción médica, disponibilidad
  de partner y equipamiento — SquashSkills depende de que el usuario elija
  manualmente la sesión correcta desde una librería fija.
- **Identidad de drill sin ambigüedad** (`sessionKind`/`executionMode`
  explícitos, sin ningún `either` residual) es más estricto que lo que se
  puede inferir de categorías de UI tipo tags ("Solo", "Pairs", "Technical")
  que probablemente se solapan libremente del lado de SquashSkills.

## 5. Qué NO se pudo verificar

- El contenido real de cada video/drill de SquashSkills está detrás de
  paywall — esta revisión es sobre metadata pública (nombres, categorías,
  descripciones cortas), no sobre la ejecución/instrucciones detalladas de
  cada drill.
- No se intentó ni se debe intentar sortear el paywall (`SUBSCRIBE TO UNLOCK
  ALL VIDEOS` era visible en el catálogo de video).
- Dos celdas de categorías del mockup de la Training App quedaron ilegibles
  incluso con zoom (ver §1); no se afirma su contenido con certeza.

## 6. Recomendación

De los tres hallazgos, el único con relación costo/beneficio claro para
priorizar ahora es **P1 (saque/resto)**: es barato, cierra un hueco real y
verificable, y no depende de resolver primero la Causa B de rotación (§29 del
roadmap). P2 (pool de ghosting) conviene atarlo a cuando se retome esa Causa B
de raíz, en vez de tratarlo como proyecto aparte. P3 son notas, no tareas.

Ninguno de los tres es bloqueante para las prioridades actuales del
Pre-Lanzamiento (entitlements, OAuth, rate limits) — quedan como backlog de
contenido deportivo, para retomar cuando el roadmap vuelva a esa área.
