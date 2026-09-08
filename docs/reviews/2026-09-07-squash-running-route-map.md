# E0 — Baseline reproducible y alcance por ruta

Fecha: 2026-09-07. Entrega E0 del plan
[`2026-09-07-squash-running-selection.md`](../superpowers/plans/2026-09-07-squash-running-selection.md).
Evidencia original: [audit](2026-09-07-squash-running-library-audit.md).

## Continuación E1

Este documento conserva las observaciones de E0. La [revisión de E1](2026-09-07-squash-running-e1.md) registra las correcciones, las nuevas pruebas de Week Creator/persistencia y los límites de las conclusiones. Los comandos npm siguientes apuntan ahora al artefacto E1; el baseline E0 original permanece congelado.

## Qué es esto

Un probe determinista que ejecuta selectores, compositor de squash, reparación
de semana y post-procesador de chat sobre casos dirigidos, y congela el
resultado normalizado.

```
npm run probe:selectors         # regenera el artefacto
npm run probe:selectors:check    # falla si el comportamiento cambió
```

- Artefacto: `fixtures/squash-running-selection/probe-output.json`
- Procedencia: `fixtures/squash-running-selection/probe-run.json`
- Casos: `scripts/probe-selectors/cases.mjs`

Sin proveedor de IA, sin Dexie, sin Supabase, sin reloj y sin red — el probe
instala un guard que hace fallar cualquier `fetch`. Costo US$0. Determinismo
acreditado dentro de cada corrida: construye la salida dos veces y compara
hashes antes de escribir.

**Es caracterización, no contrato.** El artefacto describe lo que hoy ocurre,
incluido lo que el audit considera defectuoso. Un hash acredita integridad, no
corrección: que no cambie sólo significa que el comportamiento no se movió.

## Mapa de rutas

| Ruta | Entrada ejercitada | Estado |
|---|---|---|
| Chat | `postProcessCoachActions` con `add_session` de squash y de running | **Ejercitada** hasta la acción post-procesada. No se siguió hasta la escritura en Dexie. |
| Plan Builder | `repairGeneratedWeek` sobre una semana de 4 sesiones, fases `base` y `build` | **Ejercitada**. No se siguió hasta `commitPlan` / `applyCreateWeek`. |
| Week Creator | — | **No ejercitada.** Comparte `repairGeneratedWeek`, así que hereda esos resultados, pero `WeekCreatorLocalHydrator` tiene su propio camino y no se probó. |

Dos precondiciones aparecieron al construir los fixtures y valen como resultado:

1. **Una semana de una sola sesión no sirve para probar nada.** Con
   `sessionsPerWeek: 1` y squash primario, el repair convierte la sesión que le
   llegue en squash para cubrir el mínimo del deporte principal y agrega el
   partido duro semanal. El primer intento de probar running en esa forma medía
   una sesión de squash. La semana base tiene cuatro sesiones por eso.
2. **La sesión bajo estudio se identifica por `date|timeBlock`.** El repair
   agrega sesiones; buscar por `sessionType` devuelve la agregada.

## Clasificación por hallazgo

| Hallazgo | Chat | Plan Builder | Veredicto |
|---|---|---|---|
| **S1** duración no gobierna | **reproducido** | **reparado después** | Vive en el chat |
| **S2** historial no filtra estado | n/a | n/a | **reproducido** en el selector |
| **S3** familias colapsadas | n/a | n/a | **reproducido** |
| **S5** partner | — | reproducido (redirección correcta) | Ver nota |
| **S6** fallback relaja fase | — | — | **no ejercitado** |
| **R1** parámetros muertos | n/a | n/a | **reproducido** |
| **R3** intensidad elegible | — | bloqueado por otra regla | **reproducido** como elegibilidad |
| **R4** rotación expulsa el rodaje fácil | — | — | **reproducido**, con matiz |
| **R5** identidad perdida | — | — | **reproducido** |
| **R6** materialización infiel | — | **reproducido sólo en fase `base`** | Ver nota |
| **R7** ritmos iguales | no aplica | **reproducido sólo en fase `base`** | Ver nota |
| **R8** duración incoherente | **reproducido** (borde 20 min) | **reproducido** (borde 20 min) | Es un borde, no un sesgo |

### S1 — vive en el chat, no en Plan Builder

Pedir por chat una sesión de squash técnica declarando 30 minutos produce una
sesión que **dice** 30 minutos y **contiene** 52 minutos de drills.

| Pedido | Contenido | Δ |
|---:|---:|---:|
| 30 min | 52 min | +22 |
| 45 min | 52 min | +7 |
| 60 min | 52 min | −8 |

El compositor entrega los mismos tres drills en los tres casos. En la ruta Plan
Builder el mismo pedido sale cuadrado (Δ = 0 a 30 y 45 min; −5 a 60 min), así
que **S1 no llega al calendario por esa ruta**.

### S5 — la redirección funciona; el dato sigue sin productor

Con `partnerAvailability: 'solo'` en el wizard, un partido se redirige a control
con drills en solitario, y sin el campo se entrega el partido. La mecánica está
bien. Lo que sigue faltando es quién escribe el campo: `CompetitionPlanPage.tsx`
arma el `PlanWizardConfig` sin él, así que en producción el valor es siempre
`undefined` → `either`. El probe ejercita el comportamiento pasando el valor a
mano, igual que el único test que lo cubre.

### S6 — declarado en el código, no reproducido acá

`selectSquashDrills` cae a un pool sin filtro de fase cuando la selección
devuelve menos de tres drills. Ninguno de los seis casos —incluidos `base` con
fatiga 9 y `taper` con fatiga 8— produjo una sola violación de fase o de
ejecución sobre la salida. El camino existe; **estos casos no lo alcanzan**.
Baja su prioridad dentro de E2a hasta encontrar la entrada que sí lo dispara.

### R1 — la evidencia más limpia del paquete

Doce variantes de entrada, una sola salida:

```
sessionDurationMin = 15 | 20 | 30 | 45 | 60   → Easy aerobic longer block (55-70 min)
experienceLevel = beginner | intermediate | advanced → Easy aerobic longer block
weeklyRunCount = 2 | 6                        → Easy aerobic longer block
primarySport = squash | ausente               → Easy aerobic longer block
```

Pedir 15 minutos devuelve una plantilla de 55 a 70. Ninguno de los cuatro
parámetros cambia nada.

### R3 y R4 — reproducidos, y una hipótesis previa que no se sostiene

Elegibles en `sport_support` por encima de moderate: `tempo_continuo`,
`cruise_intervals`, `threshold_blocks` (moderate-high) y `short_hill_sprints`
(**high**).

La rotación expulsa el rodaje fácil: con dos sesiones fáciles completadas en el
historial, `avoidRecentFamilies` saca `easy_aerobic` del pool y la intención
pasa a `rotate`. **El atleta de apoyo nunca puede repetir el estímulo que
necesita.**

Ahora la corrección: durante la revisión se planteó que esa expulsión podía
empujar hacia mayor intensidad, hasta sprints en cuesta. **No se reproduce.** En
los seis casos probados —incluida fatiga 2, la más permisiva— la salida fue
`Recovery jog` o `Speed support session`, ambas de intensidad `low`: el scoring
de `sport_support` penaliza `high` con −6 y premia `low` con +3, y eso alcanza.
El defecto de R4 es real, pero su consecuencia es **monotonía**, no riesgo de
carga. R3 queda como elegibilidad sin materializar: defensa en profundidad.

De paso apareció una asimetría interna: el filtro duro de recencia lee
`recentSessions` (claves de familia) y la progresión lee `historicalSessions`
(sesiones). Son dos fuentes distintas de «reciente». Poblar sólo una da medio
comportamiento: con `recentSessions` sola la intención quedó en `hold`; con
`historicalSessions` pasó a `rotate`.

### R6 y R7 — sólo alcanzables en fase `base`

`normalizeSquashSupportAerobicLoad` fuerza `runningType: 'z2'` y recorta la
duración (40 min, 25 en taper) para toda sesión de running cuando el deporte
principal es squash y la fase es `build`, `peak` o `taper`. En esas fases un
tempo declarado **no llega** al materializador: sale como Z2 de un bloque.

En fase `base`, donde sí llega:

- **R7 reproducido, y en los tres bloques.** Un tempo de 45 min produce
  calentamiento, trabajo y enfriamiento **con el mismo `targetPace`**
  (`4:40-5:00 /km`). El calentamiento lleva ritmo de umbral. En series, los tres
  bloques comparten `4:15-4:30 /km`.
- **R6 reproducido.** `intervals` de 40 y de 60 min producen ambos
  `repetitions: 5, distanceKm: 0.8` sin duración: el total de la sesión **no es
  computable** (`verdict: unknown`). La plantilla que el selector eligió no se
  materializa.

### R8 — es un borde, no un sesgo

El desajuste de duración aparece a 20 minutos y en las dos rutas: tempo de 20
min → 25 min de bloques (+5); Z2 de 20 min por chat → 25 min (+5). A 30, 45 y 60
el total cuadra. La aritmética del mínimo (`max(15, …)` con calentamiento y
cierre fijos) es la causa, tal como decía el audit.

## Hallazgos nuevos, no presentes en el audit

**N1. La nota del bloque contradice el bloque.** En fase `base`, el bloque
etiquetado «Tempo umbral controlado» trae como nota *«55-70 min a ritmo Z2 fácil
constante. Sin acelerar al final.»*, y lo mismo en «Series principales». Es la
`typicalStructure` de la plantilla que el selector eligió por su cuenta
(`easy_longer`, un rodaje suave) inyectada como nota del bloque equivocado. Es
consecuencia directa de R1 + R6 y es visible para el usuario: la sesión dice
tempo, el texto dice rodaje fácil.

**N2. Hay tres productores independientes de estructura de running.**
`buildRunningIntervalStructure` (Plan Builder),
`buildRunningZone2IntervalStructure` (chat) y la `typicalStructure` textual de la
biblioteca. Los tres inventan bloques por su cuenta. La «función pura única» de
E1 tiene que reemplazar a los tres, no sólo al primero.

**N3. El repair puede agregar sesiones que el probe no pidió.** Cubrir el mínimo
del deporte principal agrega un partido duro. Es correcto como producto, pero
cualquier medición de dosis tiene que separar lo enviado de lo agregado o mide
otra sesión.

## Qué cambia esto en las entregas siguientes

- **E1 se reordena.** La parte de squash es urgente y vive en el chat. La parte
  de running rinde sobre todo en fase `base`, chat y Week Creator: en build,
  peak y taper el ablandamiento a Z2 ya tapa el defecto para el usuario típico
  de la app. La corrección de ritmos (R7) sigue siendo prioritaria porque es
  visible y potencialmente engañosa.
- **La extensión de tipos de E1 queda confirmada por medición**, no por lectura:
  un bloque de series real produce hoy un total no computable.
- **E2a pierde un ítem y gana precisión.** S6 no se reprodujo. S2 y S3 sí, con
  entradas exactas: `planned`, `skipped` y una sesión con fecha futura producen
  la misma recomendación que `completed`; tres drills de una familia en una sola
  sesión disparan `rotate` como si fueran tres sesiones.
- **N1 y N2 entran a E1** como parte del mismo trabajo.

## Límites declarados

- No se siguió ninguna ruta hasta la persistencia local: el probe llega a la
  acción post-procesada y a la semana reparada, no a Dexie ni a la aceptación.
- **Week Creator no se ejercitó.** Es el hueco más grande de E0.
- La fase `peak` y la ventana de campeonato no se probaron en la ruta de repair.
- El artefacto se generó con el árbol de trabajo sucio; `probe-run.json` lista
  los archivos modificados. No acredita `main` limpio.
- Los casos son dirigidos: cubren los hallazgos del audit, no el espacio de
  entradas.
