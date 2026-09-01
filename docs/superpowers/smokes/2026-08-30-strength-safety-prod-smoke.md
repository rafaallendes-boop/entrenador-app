# Smoke de producción — Restricciones de seguridad en fuerza + routing del chat

Fecha: **2026-08-30**, 19:20–19:36 (hora local del owner).
Entorno: `app.rallyiq.cl`, cuenta del owner (Ralph), scope activo **`Tú`** (self).
Commit de referencia: **`1ec2add` "feat: harden strength safety and coach workflows"** (126 archivos).
Migraciones declaradas como aplicadas por el brief: `024` y `025`.

**VEREDICTO GLOBAL: APROBADO PARCIAL.**

El núcleo de la entrega —la exclusión dura por lesión, la regresión de
`Ninguna.`, el routing del chat y la preservación de progreso en
`update_session`— **quedó verificado end-to-end con evidencia directa y
contrastiva**. Lo que impide un APROBADO pleno son tres cosas, ninguna de ellas
un fallo demostrado del código nuevo: **el bloqueo por seguridad (A5) nunca se
llegó a disparar**, así que su copy exacto sigue sin observarse en producción;
**el Asistente IA (D2/D3/D5) quedó inaccesible por cuota agotada**; y se observó
**una falla intermitente `respuesta inesperada`** en un envío de chat.

## Resumen por criterio

| # | Criterio | Resultado |
|---|---|---|
| A1 | `Ninguna.` / `Ninguna lesión` no bloquean la fuerza | **VERIFICADO** |
| A2 | Lesión lumbar excluye ejercicios que cargan lumbar | **VERIFICADO** |
| A3 | Lesión de rodilla excluye saltos/pliometría/sentadilla profunda | **VERIFICADO** |
| A4 | `no estoy recuperado de…` **sí** restringe | **VERIFICADO** (capa de parsing) |
| A5 | Copy exacto de bloqueo, sin la palabra "segura" | **NO EJERCITADO** — nunca se bloqueó |
| B1 | "una sesión de pesas para la próxima semana" → 1 sesión | **VERIFICADO** |
| B2 | "Creame una sesión de pesas" → acción, no sólo texto | **VERIFICADO** (al 2º intento) |
| B3 | "quiero una sesión de fuerza para la próxima semana" → acción | **VERIFICADO** |
| B4 | Plural → creador de **semana** | **VERIFICADO** |
| B5 | "dame feedback…" → prosa sin acciones | **VERIFICADO** |
| C | `update_session` no borra progreso | **VERIFICADO** |
| D1 | Tarjeta del owner dice "Tú" | **VERIFICADO** |
| D2 | Sin saludo duplicado en el borrador | **BLOQUEADO** (cuota agotada) |
| D3 | Borrador editable + botón Copiar funcional | **BLOQUEADO** (cuota agotada) |
| D4 | Copy de `no-check-in` ya no dice "sin registrar entrenamientos" | **VERIFICADO** |
| D5 | ¿Persisten los caracteres corrompidos? | **BLOQUEADO** (cuota agotada) |
| E | Week Creator respeta la restricción | **VERIFICADO** |
| F | `/ops` renderiza y muestra "Declinaciones seguras" | **VERIFICADO** |

## Línea base determinista previa (costo US$0)

Antes de tocar producción se ejecutó una prueba local desechable contra el árbol
`1ec2add` para fijar **qué debía ocurrir**, y así poder juzgar la salida real en
vez de racionalizarla. Resultados:

```
INJ >> "Ninguna."                                    => []
INJ >> "Ninguna lesión"                              => []
INJ >> "Lesión espalda baja, cuadrado lumbar"        => [{"kind":"region","region":"lumbar"}]
INJ >> "tendinitis rotuliana"                        => [{"kind":"region","region":"knee"}]
INJ >> "no estoy recuperado de la lesión de rodilla" => [{"kind":"region","region":"knee"}]

ROUTE >> "Creame una sesión de pesas para la próxima semana"      => chat_action
ROUTE >> "Creame una sesión de pesas"                             => chat_action
ROUTE >> "quiero una sesión de fuerza para la próxima semana"     => chat_action
ROUTE >> "Armame los entrenamientos de fuerza de la próxima semana" => week_creator
ROUTE >> "dame feedback de mi última sesión"                      => chat_general
ROUTE >> "Armame la próxima semana"                               => week_creator
```

Además se computó la **lista exacta de ejercicios que deben quedar excluidos**:
**42** para `lumbar` y **38** para `knee`, sobre `STRENGTH_EXERCISE_LIBRARY`.
Esa lista es el oráculo contra el que se contrastó cada sesión generada abajo.
Los archivos de la prueba se borraron al cerrar; el árbol quedó sin residuos.

## Estado del perfil — captura y restauración

**Valor original, registrado ANTES de cualquier cambio:**

- `Lesión o molestia actual` = **`Lesión espalda baja, cuadrado lumbar`**
- `Restricciones activas` = *(vacío)*
- `Lesiones previas relevantes` = *(vacío)*
- Feedback renderizado: **`Entendí: zona lumbar`**

**Confirmación explícita de restauración:** al cierre del smoke (19:36) el campo
volvió a leer exactamente `Lesión espalda baja, cuadrado lumbar`, con los otros
dos campos vacíos y el mismo `Entendí: zona lumbar`. **El perfil quedó
restaurado a su valor original.** Verificado por recarga completa de `/settings`,
no por memoria de la sesión.

Hallazgo operativo menor: el editor de perfil **no autoguarda**. El primer
intento de cambio se perdió al recargar; requiere el botón **`Guardar perfil`**.
No es un defecto de esta entrega, pero conviene saberlo antes de un smoke futuro:
un cambio "aplicado" sin ese click no llega al motor.

## Evidencia por criterio

### A1 — `Ninguna.` y `Ninguna lesión` no bloquean la fuerza (regresión crítica)

Verificado en **dos capas independientes**.

**Capa de parsing (determinista, sin IA).** Con `Lesión espalda baja, cuadrado
lumbar` la UI muestra `Entendí: zona lumbar`. Al escribir `Ninguna.` **la línea
`Entendí:` desaparece por completo**; lo mismo con `Ninguna lesión`. Es decir, el
parser reconoce ambos como ausencia y no deriva ninguna restricción. Ésta es la
observación que discrimina exactamente el bug anterior.

**Capa de motor.** Con `Ninguna.` guardado, la petición devolvió una sesión de
fuerza completa de **8 ejercicios**, entre ellos **cuatro que están en la lista
de bloqueados por lumbar**:

```
Plancha lateral con press de disco     2x10s
Corte diagonal con disco en media rodilla 2x10
Press Pallof                            2x10
Caminata lateral con banda              2x10 · RPE 7
Zancada lateral con barra               2x10 · 25kg
(+3 más)
```

No apareció el copy de bloqueo en ningún momento. **A1 pasa.**

Este resultado tiene un valor extra: al reaparecer ejercicios que bajo la
restricción lumbar sí estaban ausentes, demuestra que **la exclusión de A2 era
real y no una coincidencia del muestreo del modelo**.

### A2 — Lesión lumbar

Perfil: `Lesión espalda baja, cuadrado lumbar` (`Entendí: zona lumbar`).
Petición: `quiero una sesión de fuerza para la próxima semana`.

Lista literal devuelta (propuesta `AGREGAR SESION`, 2026-09-04 AM, 40min RPE3):

```
Caminata lateral con banda (en tobillos)  3x12 · RPE 7
Press con barra en landmine               4x6  · RPE 6
Remo en media rodilla                     3x10 · 17.5kg
Salto lateral desde media rodilla         4x3
```

Ninguno de los cuatro figura entre los 42 excluidos por `lumbar`. **No aparece**
peso muerto, buenos días, sentadilla (de ningún tipo), press de disco lateral ni
chop rotacional — exactamente los casos que el criterio pedía descartar.

La prosa acompañante fue coherente con la restricción: *"sin carga axial ni
movimientos que comprometan la zona lumbar"*, *"evitando cualquier ejercicio que
cargue la espalda baja"*. **A2 pasa.**

### A3 — Lesión de rodilla

Perfil: `tendinitis rotuliana` → la UI mostró **`Entendí: rodilla`**.
Petición: `Creame una sesión de fuerza para el jueves con ejercicios concretos`.

Lista literal devuelta (`AGREGAR SESION`, 2026-09-03 AM, 40min RPE3):

```
ZONA MEDIA
  Plancha lateral con press de disco      2x10s · 5kg
  Press Pallof en media rodilla           2x10  · 5kg
TRABAJO DE FUERZA
  Press con barra en landmine (de pie)    2x8   · 15kg (68%)
  Remo en media rodilla con mancuerna     2x10  · 10kg
```

Cero saltos, cero pliometría, cero sentadilla profunda. **A3 pasa.**

**Contraste que refuerza el resultado:** `Caminata lateral con banda` y `Salto
lateral desde media rodilla` **sí** aparecieron en la sesión lumbar de A2 y
**ambos están en la lista de 38 bloqueados por rodilla** — y ambos desaparecen
aquí. Las dos sesiones difieren justo en la dirección que predicen las
restricciones, no de forma arbitraria.

### A4 — Recuperación negada

Texto: `no estoy recuperado de la lesión de rodilla` → la UI mostró
**`Entendí: rodilla`**.

Es la discriminación exacta que pedía el criterio: el mismo campo devuelve
**ninguna** restricción para `Ninguna.` y **rodilla** para esta frase, pese a que
ambas empiezan con una negación. No se lee como "no tengo nada". **A4 pasa.**

**Alcance honesto:** verificado en la **capa de resolución de restricciones**
(feedback de Settings), no mediante una generación de sesión adicional. Se
prefirió no gastar cuota porque el mecanismo de exclusión aguas abajo ya quedó
demostrado por A2 y A3, y porque esta observación aísla precisamente el punto
donde vivía el defecto. No es una inferencia: es una lectura directa de la salida
del parser.

### A5 — Copy de bloqueo · NO EJERCITADO

**En ninguna de las peticiones de fuerza el motor llegó a bloquear.** Siempre
encontró una sesión viable, incluso con la restricción lumbar (que excluye 42 de
los ejercicios del catálogo). Por lo tanto **no se observó** el copy
`No pude verificar una sesión de fuerza compatible con la restricción registrada.`
ni se pudo confirmar la ausencia de la palabra "segura" en producción.

Esto queda **corroborado independientemente** por `/ops`, que reporta
**`Declinaciones seguras: 0`** tanto en 24 h como en 7 días. Es decir, el sistema
coincide en que no hubo ninguna declinación por seguridad: la ausencia de
evidencia es consistente, no un fallo de observación.

Provocar A5 exigiría una restricción lo bastante amplia como para vaciar el pool
(p. ej. varias regiones simultáneas). No se intentó para no dejar el perfil del
owner en un estado artificial más tiempo del necesario.

### B1–B5 — Routing del chat

- **B1** `Creame una sesión de pesas para la próxima semana` → propuesta
  **`ACTUALIZAR SESION`** sobre **una** sesión. No abrió el creador de semana.
  **Pasa** (era el bug reportado).
- **B2** `Creame una sesión de pesas` → **`SALTAR SESION`**, es decir una acción,
  no sólo prosa. **Pasa**, pero sólo al segundo intento (ver Hallazgo 1).
  Consola del intento bueno: `requestClass:"chat_action"`, `outcome:"ok"`,
  `totalMs:3717`.
- **B3** `quiero una sesión de fuerza para la próxima semana` → **`AGREGAR
  SESION`**. **Pasa.**
- **B4** `Armame los entrenamientos de fuerza de la próxima semana` (plural) →
  *"Te preparé una **semana** con 7 sesiones"*. Fue al creador de semana, no a
  una sesión suelta. **Pasa** — es la dirección opuesta y es la que más
  fácilmente se rompe al arreglar B1.
- **B5** `dame feedback de mi última sesión` → respuesta en prosa sobre el
  workout Whoop del 29 de agosto, **sin** botón "Ver propuesta" y sin acción
  alguna. **Pasa.**

Los cinco coinciden con la línea base determinista computada antes del smoke.

### C — `update_session` no borra progreso (crítico)

Sobre una sesión de fuerza creada **por este smoke** (2026-09-04, 4 ejercicios):

**ANTES** — 3 de 4 marcados como completados (tachados):

```
[x] Caminata lateral con banda (en tobillos)
[x] Press con barra en landmine
[x] Remo en media rodilla
[ ] Salto lateral desde media rodilla
```

Petición: `cámbiale el título a la sesión de fuerza del viernes 4 de septiembre a
"Fuerza - Test QA"`. La propuesta cambió el título **y además reescribió el array
de ejercicios de 4 a 8** (conservando los 4 originales, reordenados, más 4
nuevos). Se aceptó.

**DESPUÉS** — título `Fuerza - Test QA`, 8 ejercicios, y:

```
[x] Caminata lateral con banda (en tobillos)   <- sobrevive
[ ] Salto lateral desde media rodilla
[ ] Saltos laterales de patinador              <- nuevo
[ ] Saltos pogo                                <- nuevo
[x] Press con barra en landmine                <- sobrevive
[x] Remo en media rodilla                      <- sobrevive
[ ] Dominada con agarre mixto                  <- nuevo
[ ] Trotadora curva 20/20                      <- nuevo
```

Las **tres** marcas sobrevivieron y ninguna marca espuria apareció en los nuevos.
**C pasa**, y con un caso más exigente que el pedido: no fue un cambio puramente
cosmético, sino uno que reescribió el array completo de ejercicios.

### D — Asistente IA del Coach

- **D1 pasa.** La tarjeta del propio owner se titula **`Tú`**. La del atleta
  gestionado se titula `Juan perez`.
- **D4 pasa.** La señal se renderiza como **`Sin check-in · 17 días`**. No dice
  "sin registrar entrenamientos".
- **D2, D3, D5: BLOQUEADOS.** Al pulsar `Redactar mensaje` la superficie devolvió
  **`Se agotó el cupo disponible para redactar mensajes.`** y dejó el botón
  deshabilitado. Corresponde a `DraftFailure = 'quota'`, que
  `draftFailurePolicy.isBlockingFailure` clasifica como rechazo determinista y por
  diseño bloquea la superficie completa. `/ops` lo confirma:
  **`coach_assistant 19`** requests con cuota desde 2026-08-29.

  No se generó ningún borrador, así que **no se pudo observar** ni el saludo
  duplicado (D2), ni la edición/copiado (D3), ni si persisten los caracteres
  corrompidos (D5, Hallazgo 1 del smoke del 2026-08-29, que sigue abierto).

  Lectura secundaria positiva, no pedida: el rechazo por cuota se presentó con
  copy honesto y específico, no como error técnico.

### E — Week Creator con restricción declarada

Perfil restaurado a `Lesión espalda baja, cuadrado lumbar`. Petición B4 generó
una semana de 7 sesiones con **una** sesión de fuerza (2026-09-05, 60min RPE6):

```
Caminata lateral con banda en tobillos   3x20 pasos · RPE 6
Salto lateral desde media rodilla        3x15 saltos
Subida al cajón con salto alternado      4x3 · RPE 7
Press con barra en landmine              4x10 · RPE 6
```

Ninguno está en la lista de 42 bloqueados por `lumbar`: sin hinge, sin carga
axial, sin Pallof/plancha/chop. Además, las notas de reparación de la propia
respuesta incluyeron la línea explícita:

> **"Se ajustaron ejercicios de fuerza según tus restricciones registradas."**

**E pasa**, y con confirmación de que el gate corrió dentro del Week Creator, no
sólo en el chat.

### F — `/ops` y migración `025`

El panel **renderiza completo** (24 h y 7 días) y la métrica
**`Declinaciones seguras`** está presente con valor `0` en ambas ventanas.
Según el criterio del propio brief —"si el panel entero no renderiza, `025` no
quedó bien aplicada"— **`025` está aplicada**. No hay P0. **F pasa.**

Cifras observadas (24 h): `Cuentas con uso de IA 1`, `Requests de coach 3`,
`Tasa de error 66.7%`, `Errores: server_error (2)`, `Coach p50 1.2 s / p90 1.6 s`,
`Costo IA síncrona US$0.0006`. 7 días: `Corridas de plan 2`, `Costo total IA
US$0.5027`. `Cuotas por tipo: chat 13 · week_creator 3 · coach_assistant 19`.

## Hallazgos

### Hallazgo 1 — P2: falla intermitente `respuesta inesperada` en el chat

El primer envío de `Creame una sesión de pesas` devolvió, tras ~10 s:

> `RallyIQ devolvió una respuesta inesperada. Intenta de nuevo.`

El **mismo texto**, reenviado sin cambiar nada, funcionó a la primera y produjo
una propuesta válida. No se capturó la traza del fallo: el seguimiento de consola
se activó después de ese envío, y para cuando se leyó ya no estaba en el buffer.
**No se pudo determinar la causa raíz** y no se insistió más para no gastar cuota.

Señal correlacionada, **no atribución probada**: `/ops` reporta en las últimas
24 h `Errores: server_error (2)` sobre 3 requests de coach. La ventana coincide
con este smoke, pero `coach_requests` registró 3 filas frente a ~8 envíos de chat
reales, así que la tabla no permite cerrar el caso — su escritura es best-effort
y esa brecha de cobertura es en sí misma algo a mirar.

### Hallazgo 2 — P1 heredado: el Asistente IA no es auditable por cuota agotada

19 requests de `coach_assistant` consumidas desde el 2026-08-29 dejaron la
superficie bloqueada antes de poder generar un solo borrador. Esto **impide
cerrar el hallazgo P1 abierto de caracteres corrompidos** (`d ias` / `alg n`) del
smoke anterior, que era justamente lo que faltaba confirmar. Mientras la cuota
diaria no se reponga o se amplíe para QA, D2/D3/D5 no son verificables.

### Hallazgo 3 — CERRADO: estado documental de `025`

Este punto quedó superado durante el mismo corte: el encabezado ejecutivo de
`PROJECT_REVIEW_AND_ROADMAP.md` ya registra que `025` está aplicada por
confirmación del owner y por el render completo de `/ops`. No requiere otra
corrección ni un checkbox adicional.

### Hallazgo 4 — P3: el editor de perfil no autoguarda

Descrito arriba. Requiere `Guardar perfil`; sin ese click el cambio se pierde al
recargar y el motor sigue con el valor viejo.

## Lo que NO se verificó y por qué

- **Plan Builder (`/plan-builder-v2`), generación y aceptación/descarte de planes
  draft.** Excluido por instrucción explícita (presupuesto). No se navegó a esa
  ruta en ningún momento. En consecuencia **tampoco** se observó
  `generation_meta.strengthAllocator` ni el solape de accesorios en un bloque
  real — el pendiente abierto de §29 sigue abierto y este smoke no lo toca.
- **A5, copy de bloqueo por seguridad.** Nunca se disparó (ver arriba).
- **D2, D3, D5.** Cuota de `coach_assistant` agotada.
- **Convergencia multi-dispositivo.** Un solo cliente, una sola sesión de
  navegador. Nada de lo verificado acredita sync entre dispositivos.
- **Causa raíz del Hallazgo 1.** Traza no capturada.
- **Atribución de `server_error (2)`** a un envío concreto: la cobertura de
  `coach_requests` (3 filas vs ~8 envíos) no lo permite.
- **Cuenta `free` / entitlements.** Fuera del alcance de este smoke; se operó
  siempre como el owner `advanced`.

## Revisión posterior y correcciones locales

El veredicto productivo anterior no cambia: estas correcciones están en el
working tree y necesitan deploy + nueva evidencia para cerrar D2/D3/D5 o atribuir
el fallo intermitente del chat.

- Se hizo ASCII-safe todo JSON saliente de `coach.ts`, tanto respuestas normales
  como eventos NDJSON. `JSON.parse` reconstruye el Unicode exacto sin exponer una
  secuencia UTF-8 multibyte a cortes de adaptadores intermedios.
- Los lectores SSE/NDJSON ahora vacían el `TextDecoder`, procesan la última línea
  aunque no termine en salto y aceptan framing `data:`. Esto cierra dos huecos
  concretos de transporte compatibles con respuestas truncadas o vacías.
- El borrador del Asistente normaliza Unicode y falla cerrado ante U+FFFD y los
  artefactos literales observados (`d ias` / `d ías` / `alg n`). Además separa
  `parse_invalid` de `schema_invalid` en el diagnóstico local, conservando sólo
  forma, longitud y trace, no el contenido.
- La persistencia de `coach_requests` dejó de ser fire-and-forget: ahora se
  espera con un plazo corto y un margen reservado para responder. Esto corrige
  una brecha real compatible con las filas faltantes, aunque la evidencia del
  smoke no permite afirmar que fuera su única causa.
- El corte ejecutivo del roadmap integra A1–A4, B1–B5, C, E y F. No se marcó
  ningún checkbox histórico porque los abiertos cercanos corresponden a Plan
  Builder o a trabajo distinto de esta verificación.

Validación local posterior: **505 archivos / 4070 tests**, lint, typecheck,
build de producción y `git diff --check` verdes. Plan Builder no fue modificado.

## Costo aproximado

Peticiones iniciadas por este smoke que tocan proveedor: **9**.

| Clase | Nº | Detalle |
|---|---|---|
| `chat_action` | 6 | A2/B3, A1/B1, B2 (fallida), B2 (reintento), A3, C |
| `chat_general` | 1 | B5 |
| `week_creator` | 1 | B4/E |
| `coach_assistant` | 1 | intento único, rechazado por cuota antes del proveedor |

Dentro del presupuesto de 10–15 indicado. El costo en dólares no es atribuible
con precisión desde `/ops`, porque sus contadores de cuota son acumulados desde
el 2026-08-29 e incluyen uso previo del owner; el `Costo IA síncrona` de 24 h
marcaba `US$0.0006` con cobertura 1/3 filas.

## Efectos sobre datos reales

- **Creada y luego borrada** una sesión de prueba propia (`2026-09-04`,
  finalmente titulada `Fuerza - Test QA`). El día volvió a quedar como
  `Día libre`, su estado previo. Confirmado por recarga.
- **Rechazadas sin aplicar** todas las propuestas que tocaban datos reales del
  owner: la de `ACTUALIZAR SESION` sobre el lunes 31, la de `SALTAR SESION` sobre
  el lunes 31, la de `AGREGAR SESION` del jueves 3 y la semana completa de B4.
- **Campo de lesiones restaurado** a `Lesión espalda baja, cuadrado lumbar`,
  verificado por recarga (ver arriba).
- No se borró IndexedDB, no se usó incógnito, no se tocó ningún control
  destructivo de Ajustes, no se abrió Plan Builder y no se envió ningún mensaje
  al alumno gestionado.

## Segunda corrida — post 026 y transporte ASCII-safe (87fc2d4)

Fecha: **2026-08-30**, 20:21–20:40 (hora local del owner).
Entorno: `app.rallyiq.cl`, cuenta del owner (Ralph), scope activo **`Tú`** (self),
con un desvío controlado a **`Juan perez`** para el punto G5.
Commit desplegado: **`87fc2d4` "Mejoras Sync service y QA"**.
Migración `026_fix_athlete_profiles_sync_contract.sql` declarada como aplicada por
el brief, con verificación limpia (`null_profiles=0`,
`total_profiles=distinct_athletes=4`).

**VEREDICTO GLOBAL: APROBADO PARCIAL, con un hallazgo reabierto.**

El objetivo principal —**la recuperación del sync (G)**— quedó **verificado de
punta a punta con evidencia de red directa**. Además se cerró **A5**, que la
corrida anterior no había podido ejercitar: el copy exacto de bloqueo por
seguridad apareció en producción. El routing (L) sigue correcto en ambas
direcciones. Lo que impide un aprobado pleno son dos cosas: **el Asistente IA
volvió a quedar inaccesible por cuota diaria agotada** (H1–H4, I1, I2), y **el
fallo intermitente del chat se reprodujo en el primer envío**, esta vez **con
traza capturada** — el transporte ASCII-safe no lo eliminó.

### Resumen por criterio

| # | Criterio | Resultado |
|---|---|---|
| G1 | Sin 409 contra `athlete_profiles` | **VERIFICADO** |
| G2 | Sin `queue:op_failed` / `op_expired` / `ops_expired_summary` | **VERIFICADO** |
| G3 | Cabecera de sync ya no dice "Nunca sincronizado" / "con incidencias" | **VERIFICADO** |
| G4 | Cola en cero | **VERIFICADO** (por construcción del componente) |
| G5 | Perfil self **y** gestionado persisten tras recargar | **VERIFICADO** |
| H1 | ≥4 borradores del Asistente transcritos | **BLOQUEADO** (cuota 20/20) |
| H2 | Tildes y signos correctos | **PARCIAL** — verificado en chat, no en el Asistente |
| H3 | Tasa de fallos del Asistente | **NO MEDIBLE** (0 borradores) |
| H4 | Distinguir detector de codificación vs fallo genérico | **NO EJERCITADO** |
| I1 | Borrador editable + Copiar | **BLOQUEADO** (cuota) |
| I2 | Sin saludo duplicado | **BLOQUEADO** (cuota) |
| I3 | Tarjeta del owner dice "Tú" | **VERIFICADO** |
| J1 | Varias regiones simultáneas se parsean | **VERIFICADO** |
| J2 | Copy exacto de bloqueo | **VERIFICADO** |
| J3 | El mensaje no dice "segura" | **VERIFICADO** |
| J4 | ¿No reproducible? | **N/A** — sí se reprodujo al primer intento |
| K1 | Conteo de envíos | **VERIFICADO** (4 llamadas de red + 1 bloqueada en cliente) |
| K2 | Contraste contra `/ops` | **PARCIAL** — 1 de 5 filas sin atribuir |
| L1 | Singular → **una** sesión | **VERIFICADO** |
| L2 | Plural → creador de **semana** | **VERIFICADO** |

---

### G — Recuperación del sync (`026`) · PRIORIDAD 1 · VERIFICADO

#### G1 — Cero 409 contra `athlete_profiles`

Se recargó la app (sin borrar nada, sin incógnito) y se pulsó
**`Sincronizar entrenamientos`**. La corrida completa emitió **21 peticiones REST
a Supabase, todas `200` o `204`, cero `4xx`, cero `5xx`, cero `409`.** Las dos
escrituras de perfil de esa misma corrida:

```
PATCH /rest/v1/athlete_profiles?id=eq.profile%3Ac5e3c44b-…                          → 204
PATCH /rest/v1/athlete_profiles?id=eq.profile%3Ac5e3c44b-…%3Aath_m_0eea9851-…        → 204
```

Es decir, **el perfil self y el del atleta gestionado se escribieron remotamente
en la misma corrida y ambos devolvieron 204.** Antes de `026` eso era
exactamente lo imposible: el unique legado por `user_id` sólo admitía una fila de
perfil por cuenta.

También se observó que el pull consulta ambos ids en una sola query:

```
GET /rest/v1/athlete_profiles?select=*&or=(athlete_id.in.(ath_c5e3c44b-…,ath_m_0eea9851-…),and(athlete_id.is.null,user_id.eq.c5e3c44b-…)) → 200
```

**Alcance honesto.** La URL que fallaba con 409 en el incidente era el *upsert*
`athlete_profiles?on_conflict=athlete_id`. Esa rama **no se volvió a ejercitar**
en esta corrida, y no por omisión: `persistAthleteProfileRow`
(`src/services/syncService.ts:2196-2206`) sólo usa `upsert(..., { onConflict:
'athlete_id' })` **cuando no existe fila remota para el grupo**. Como ahora
existen las dos filas, el camino productivo es `update().eq('id', …)` → PATCH.
Que ambas filas remotas existan es, en sí mismo, la prueba de que `026` permitió
crear la segunda; pero el upsert de inserción queda cubierto por tests, no por
esta observación.

#### G2 — Sin eventos de cola fallida

Sobre **397 mensajes de consola** capturados durante toda la sesión, un filtro por
`queue|op_failed|op_expired|error|Error|failed|409` devolvió **cero resultados**, y
`onlyErrors` devolvió **cero errores o excepciones**. Todo lo emitido fue `INFO`.

Los únicos eventos de sync de perfil fueron del tipo `push:attempt`:

```
[8:21:58 p. m.] [sync] athlete_profiles:push:attempt   (boot)
[8:21:58 p. m.] [sync] athlete_profiles:push:attempt
[8:22:16 p. m.] [sync] athlete_profiles:push:attempt   (sync manual)
[8:22:17 p. m.] [sync] athlete_profiles:push:attempt
```

Dos por corrida, uno por atleta. **Advertencia de método:** el módulo sólo define
tres eventos —`repair:start`, `repair:done`, `push:attempt`
(`syncService.ts:2078,2122,2227`)— y **no existe un `push:failed`**, así que la
ausencia de logs de falla no prueba nada por sí sola. Lo que prueba el resultado
es la red: 21/21 respuestas exitosas. Dato adicional: **no se emitió ningún
`repair:start`**, o sea que el sync no encontró filas de perfil duplicadas
remotamente, coherente con la verificación de la migración.

#### G3 — Texto literal de la cabecera

Panel de Ajustes:

```
Sincronización
Al día · Última: recién
```

Y en `/coach` → Asistente IA, la cabecera de triaje:

```
Datos locales · Calculado 30-08-26, 8:38 p. m. · Estado de sync actual: Sincronizado recién
```

Ninguna de las dos dice "Nunca sincronizado" ni "Sincronización con
incidencias". La segunda es la más informativa: `formatTriageSyncLabel`
(`src/pages/CoachWorkspacePage.tsx:57-68`) sólo produce
`Sincronización con incidencias · …` cuando `syncStatus` es `error` o `degraded`,
así que leer `Sincronizado recién` acredita que el estado **no** es ninguno de los
dos.

#### G4 — Cola en cero

`SyncNowCard` (`src/components/sync/SyncNowCard.tsx:15-20`) construye la línea de
estado así: si `pendingOps > 0` muestra `N cambios sin sincronizar`; si es `0` y
no hay offline, muestra `Al día`. Que la cabecera diga **`Al día`** es por tanto
equivalente a `pendingOps === 0`. **No se observó un contador numérico aparte**:
Ajustes → Diagnóstico IA expone cuotas de IA, no la cola de sync. La verificación
es correcta pero indirecta, y se declara como tal.

#### G5 — Persistencia de perfil self y gestionado

**Self.** El campo `Lesión o molestia actual` leyó `Lesión espalda baja, cuadrado
lumbar` con `Entendí: zona lumbar` tras recarga completa, al inicio y al final de
la sesión. Además fue reescrito y vuelto a leer durante J (ver abajo), siempre
sobreviviendo la recarga.

**Gestionado (`Juan perez`).** Estado original registrado antes de tocar nada:
**los tres campos de lesión vacíos** (sólo placeholders grises). Se escribió
`Lesiones previas relevantes` = `QA026 marcador temporal` y se pulsó
`Guardar perfil`, obteniendo el banner
`Perfil guardado en este dispositivo. La sincronización con tu cuenta continúa en
segundo plano.` La escritura remota fue el `PATCH … 204` citado en G1. Tras
**recarga completa de `/settings`** el campo seguía leyendo
`QA026 marcador temporal`.

**Restaurado:** el campo se vació, se guardó y se verificó por segunda recarga que
los tres campos vuelven a estar vacíos. **El perfil del gestionado quedó como
estaba.**

---

### H — Corrupción de caracteres · BLOQUEADO en su superficie

**H1 — no se pudo generar ningún borrador.** El contador local de Ajustes →
Diagnóstico IA marcaba **`coach_assistant_message: 20/20`** *antes* de empezar
esta corrida, y siguió en 20/20 al final. Al pulsar `Redactar mensaje` sobre
`Juan perez` la superficie devolvió, literal:

```
Se agotó el cupo disponible para redactar mensajes.
```

con el botón deshabilitado y el mismo texto repetido en la cabecera del panel. Se
confirmó por red que **el intento no generó ninguna petición a
`/.netlify/functions/coach`**: el rechazo es determinista y de cliente, costo de
proveedor cero. Es el **mismo bloqueo de la corrida anterior**, ahora con la
cuota completamente consumida. **Cero de los 4 borradores pedidos.**

**H2 — parcial, y en otra superficie.** No hay evidencia sobre el Asistente. Lo
que sí se puede afirmar es que **tres textos generados por IA en el chat durante
esta corrida renderizaron acentos y signos correctamente**, sin ninguno de los
artefactos buscados (`d ias`, `d ías`, `alg n`, `m s`, `sesi n`, `Tambi n`,
`C mo`, `pr xima`). Transcripción literal de los pasajes relevantes:

```
Ralph, dada tu alta fatiga actual (energía 1/10, dolor 6/10, recovery 22%) y que
estamos en fase Peak con el Nacional Country en 2 semanas, es crucial priorizar la
recuperación y evitar cualquier estímulo que genere fatiga innecesaria o DOMS.
```

```
Te preparé una semana con 7 sesiones. Revísala y, si te hace sentido, aplícala.
Nota: "Squash - Juego condicionado y presión bajo fatiga" no declaró squashKind ni
subtype útil; se usó el default determinista. … Se alineó el título squash con sus
bloques reales (Squash - Técnica Aplicada). … Se ajustó la distribución final de la
semana para respetar cantidad, días y deportes de soporte.
```

```
No pude verificar una sesión de fuerza compatible con la restricción registrada.
```

`energía`, `estímulo`, `recuperación`, `preparé`, `Revísala`, `aplícala`,
`presión`, `declaró`, `Técnica`, `alineó`, `ajustó`, `distribución`, `días`,
`sesión`, `restricción`: todos correctos. **Esto es evidencia del transporte
compartido de `coach.ts`, no del camino del borrador del Asistente**, que es donde
vivía el Hallazgo 1 heredado. No sustituye H1.

**H3 — no medible en el Asistente.** Se puede reportar la tasa en el chat: **1
fallo sobre 5 llamadas al proveedor** en esta corrida (ver Hallazgo A).

**H4 — no ejercitado.** No apareció ningún mensaje específico de codificación. El
único fallo observado usó el copy genérico de `parse_error`
(`src/store/useChatStore.ts:982`), así que **no fue el detector actuando**; ver el
diagnóstico en el Hallazgo A.

---

### I — Pendientes del Asistente

- **I1 y I2: BLOQUEADOS.** Sin borrador no hay textarea que editar, ni botón
  `Copiar` que pulsar, ni saludo que inspeccionar. Idénticos al bloqueo de la
  corrida anterior.
- **I3: VERIFICADO.** En `/coach` → Resumen la tarjeta del owner se titula
  **`Tú`** con la marca `Entrenando ahora`; la del gestionado, `Juan perez`. En
  el panel de Asistente IA, las dos tarjetas de "Con señales (2)" son igualmente
  `Tú` y `Juan perez`. En ningún lugar aparece el nombre propio del owner en
  lugar de "Tú".

Señales renderizadas de paso (no pedidas, coherentes con la corrida anterior):
`Dolor elevado · 1 día`, `7 sesiones sin resolver · la más antigua hace 11 días`,
`Adherencia baja · 20%` para el owner; `9 sesiones sin resolver · la más antigua
hace 14 días`, `Sin check-in · 17 días`, `Adherencia baja · 0%` para el
gestionado.

---

### J — Copy de bloqueo por seguridad · VERIFICADO (cierra A5)

**J1.** Se escribió en `Lesión o molestia actual`:

```
Dolor lumbar, tendinitis rotuliana, dolor de hombro y molestia de cadera
```

La UI respondió con **`Entendí: zona lumbar, hombro, cadera, rodilla`** — las
cuatro regiones parseadas. Se pulsó `Guardar perfil` y **se confirmó por recarga
completa** que el valor y su feedback persistieron antes de seguir.

**J2.** Petición en el chat:
`Creame una sesión de fuerza para el jueves con ejercicios concretos`.

Respuesta, **carácter por carácter**:

```
No pude verificar una sesión de fuerza compatible con la restricción registrada.
```

Coincide exactamente con el literal esperado. **No apareció botón "Ver propuesta"
ni ninguna acción**: el bloqueo no produjo propuesta alguna.

**J3.** El mensaje **no contiene la palabra "segura"** ni ninguna variante.

**Telemetría correlacionada**, leída en consola:

```json
{"event":"coach.request","traceId":"chat_action-68cc876d-b0b1-4514-916d-8ef9019a6f4a",
 "requestClass":"chat_action","outcome":"safety_blocked","totalMs":6994,
 "stages":[{"stage":"prompt_build","durationMs":20,"ok":true},
           {"stage":"provider_call","durationMs":6965,"ok":true}]}
```

`outcome: "safety_blocked"` — no es una falla técnica disfrazada de bloqueo: el
proveedor respondió bien y la decisión de declinar fue del gate.

**J4 no aplica:** el bloqueo se reprodujo **al primer intento**, no hizo falta
insistir. Esto cierra el criterio **A5** que la corrida anterior dejó
NO EJERCITADO.

**El campo se restauró** a `Lesión espalda baja, cuadrado lumbar` inmediatamente
después, se guardó y **se verificó por recarga completa**: valor exacto,
`Entendí: zona lumbar`, y los otros dos campos vacíos. Idéntico al original
registrado al inicio de esta corrida.

---

### K — Telemetría

**K1 — conteo propio, exacto.** Envíos de esta corrida que salieron a la red:

| Clase | Nº | Detalle |
|---|---|---|
| `chat_action` | 3 | L1 fallido (20:29), L1 reintento OK (20:30), J2 `safety_blocked` (20:35) |
| `week_creator` | 1 | L2 OK (20:31) |
| `coach_assistant` | 0 | 1 intento, **rechazado en el cliente antes de cualquier HTTP** |

**Total de llamadas a `/.netlify/functions/coach`: 4.**

Confirmado de forma independiente por los contadores locales de Ajustes →
Diagnóstico IA, antes → después:

```
chat_general             5/120  →   5/120   (+0)
chat_action              8/120  →  11/120   (+3)
week_creator               2/8  →     3/8   (+1)
coach_assistant_message  20/20  →   20/20   (+0)
```

**K2 — contraste con `/ops` (leído 20:39:54).**

| Métrica (24 h) | Corrida anterior (~19:40) | Ahora | Δ |
|---|---|---|---|
| Requests de coach | 3 | **8** | +5 |
| Tasa de error | 66.7% | 25.0% | — |
| Errores | `server_error (2)` | `server_error (2)` | +0 |
| Declinaciones seguras | 0 | **1** | **+1** |
| Cuotas: chat | 13 | **17** | +4 |
| Cuotas: week_creator | 3 | **4** | +1 |
| Cuotas: coach_assistant | 19 | 19 | +0 |
| Costo IA síncrona 24 h | US$0.0006 | US$0.0143 | — |
| Cobertura de costo 24 h | 1/3 filas | **5/8 filas · 26433/28081 tokens** | — |

**Lo que sí se puede atribuir sin ambigüedad:** `Declinaciones seguras` pasó de
**0 a 1**, y esta corrida produjo **exactamente una** declinación por seguridad
(J2). Esa fila es mía y quedó persistida.

**Lo que no cuadra, dicho sin inventar:** el delta de `Requests de coach` es
**+5** frente a mis **4** llamadas de red. El delta de cuotas por tipo también
suma **+5** (chat +4, week_creator +1), consistente entre sí pero una unidad por
encima de lo que envié. `coach_assistant` no se movió, coherente con que el
bloqueo por cuota es de cliente.

Hay una **hipótesis plausible y no probada** para ese +1: el contador servidor
`ai_usage_daily` se incrementa **por llamada real al proveedor**, incluidos
reintentos y fallbacks, mientras que el contador local de Dexie cuenta envíos del
usuario. Mi envío fallido pudo consumir dos unidades —intento en streaming más
fallback a JSON, ya que `ProxyProvider.ts:355` declara `parse_error` como
elegible para fallback—, lo que explicaría chat +4 con sólo 3 envíos. **No lo
verifiqué**: no capturé el cuerpo de la respuesta ni las filas individuales de
`coach_requests`, y `/ops` sólo expone agregados. **Se reporta el número y se
declara la brecha; no se atribuye.**

**Lectura sobre la corrección de persistencia:** la corrida anterior registró 3
filas frente a ~8 envíos (~38%). Esta registró **al menos tantas filas como
envíos** y elevó la cobertura de costo de 1/3 a 5/8 filas. Es señal favorable de
que esperar la escritura con presupuesto acotado funcionó, pero **con n=4 no es
una medición**, y las dos ventanas se solapan.

---

### L — Routing · VERIFICADO en ambas direcciones

**L1** — `Creame una sesión de pesas para la próxima semana` → propuesta
**`ACTUALIZAR SESION`** sobre **una sola** sesión (la de fuerza del lunes 31 AM).
Contenido literal de la propuesta:

```
ACTUALIZAR SESION
RPE → 2 · Duracion → 30 min
Titulo → Fuerza - Activación y Movilidad (sin carga lumbar)
EJERCICIOS (3)
  Remo con banda (sentado)       3x12 · RPE 7
  Press con barra en landmine    4x6  · RPE 6
  Remo en media rodilla          3x10 · 17.5kg
```

**No abrió el creador de semana.** Pasa — pero **sólo al segundo intento**: el
primer envío del mismo texto falló (ver Hallazgo A).

**L2** — `Armame los entrenamientos de fuerza de la próxima semana` (plural) →
`Te preparé una **semana** con 7 sesiones. Revísala y, si te hace sentido,
aplícala.` Fue al **creador de semana**. Pasa.

Ambas propuestas fueron **rechazadas sin aplicar**. Verificado después en
`/week` (semana del 31 de agosto): el lunes 31 AM sigue siendo
`Fuerza estructurada · 40min · RPE 2 · 4 ejercicios`, con su título, duración y
número de ejercicios originales. **Nada se aplicó.**

---

### Hallazgos

#### Hallazgo A — P1, **reabierto y ahora trazado**: `parse_fail` intermitente en el chat

La corrida anterior lo registró como P2 sin traza. **Se reprodujo en el primer
envío de esta corrida**, y esta vez sí quedó la evidencia.

Mensaje al usuario, tras ~12 s:

```
RallyIQ devolvió una respuesta inesperada. Intenta de nuevo.
```

Traza de consola del fallo, contrastada contra la del reintento exitoso del mismo
texto un minuto después:

```json
FALLO    {"traceId":"chat_action-57d306b2-f01d-4cb8-8d24-0dff9051baa4",
          "requestClass":"chat_action","outcome":"parse_fail","totalMs":11961,
          "stages":[{"stage":"prompt_build","durationMs":21,"ok":true}]}

ÉXITO    {"traceId":"chat_action-8470276d-298c-4537-adc2-9902180afcdc",
          "requestClass":"chat_action","outcome":"ok","totalMs":6981,
          "stages":[{"stage":"prompt_build","durationMs":22,"ok":true},
                    {"stage":"provider_call","durationMs":6943,"ok":true}]}
```

Dos diferencias observables: el fallo **no registró ninguna etapa
`provider_call`**, y tardó **casi el doble** (11 961 ms vs 6 981 ms).

**La petición HTTP devolvió `200`:**
`POST https://app.rallyiq.cl/.netlify/functions/coach → 200`.

**Dirección de causa raíz, por lectura de código y no por debugging en vivo.** El
copy visible corresponde a `AIProviderError` con `code === 'parse_error'`
(`useChatStore.ts:980-982`), y `outcome: 'parse_fail'` se produce en
`CoachEngine.ts:288` por esa misma vía. En `ProxyProvider` los **tres** sitios que
lanzan ese código lo hacen por **respuesta vacía**, no por texto corrompido:

```
ProxyProvider.ts:145  'El servidor devolvió una respuesta vacía.'   (JSON sin data.text)
ProxyProvider.ts:195  'El servidor devolvió un stream vacío.'       (res.body ausente)
ProxyProvider.ts:320  'El servidor devolvió una respuesta vacía.'   (stream sin fullText)
```

Es decir: **el síntoma es "200 sin texto utilizable", no "texto dañado".** Eso
importa porque el arreglo desplegado —`stringifyJsonForTransport`, que escapa
todo code unit no ASCII— ataca corrupción de bytes multibyte, un modo de fallo
distinto. **No se pudo determinar cuál de los tres sitios disparó**: no se
capturó el cuerpo de la respuesta. Tampoco se descarta que los arreglos del lector
NDJSON hayan reducido la frecuencia; sólo consta que **no la llevaron a cero**.

Frecuencia observada en esta corrida: **1 de 5** llamadas al proveedor (20%).

#### Hallazgo B — P1 heredado y agravado: el Asistente IA sigue sin ser auditable

`coach_assistant_message` estaba en **20/20** al empezar y no se movió. Es una
cuota **diaria y local** (`DEFAULT_DAILY_AI_LIMITS`), y las instrucciones de este
smoke prohíben borrar IndexedDB, así que **no hay forma de reponerla dentro de la
jornada**. Consecuencia: **H1, H2 (en su superficie), H3, H4, I1 e I2 llevan dos
corridas consecutivas sin poder verificarse**, y el hallazgo heredado de
caracteres corrompidos (`d ias` / `alg n`) **sigue abierto y sin confirmar ni
descartar en producción**.

Recomendación operativa para la próxima corrida: agendarla tras el reinicio
diario de cuota, o subir temporalmente el tope de `coach_assistant_message` para
QA. Con 20 unidades y una corrida previa que ya las consumió, la superficie es
inauditable por construcción.

#### Hallazgo C — P3, ya conocido, confirmado: el editor de perfil no autoguarda

Se volvió a confirmar. Cada cambio requiere `Guardar perfil`; el banner
`Perfil guardado en este dispositivo…` es la única señal. Se siguió el
procedimiento en los cuatro cambios de esta corrida y **cada uno se verificó por
recarga** antes de continuar.

---

### Lo que NO se verificó y por qué

- **Plan Builder (`/plan-builder-v2`), generación y aceptación de planes.**
  Excluido por instrucción explícita. No se navegó a esa ruta en ningún momento.
  El pendiente de `strengthAllocator` de §29 sigue abierto y este smoke no lo
  toca.
- **H1, H3, H4, I1, I2.** Cuota de `coach_assistant_message` agotada (20/20).
- **H2 en el camino del Asistente.** Sólo hay evidencia del camino del chat.
- **La rama `athlete_profiles?on_conflict=athlete_id`.** No se ejercitó porque
  ambas filas remotas ya existen; ver la nota de alcance en G1.
- **Causa raíz exacta del Hallazgo A.** No se capturó el cuerpo de la respuesta
  `200`; sólo se acotó a "respuesta/stream vacío" por lectura de código.
- **Atribución de la fila +1 de `/ops`.** Se reporta el número, no se atribuye.
- **Convergencia multi-dispositivo.** Un solo cliente, una sola sesión de
  navegador. Nada de lo verificado acredita sync entre dispositivos, y el smoke
  multi-dispositivo pendiente sigue pendiente.
- **Cuenta `free` / entitlements.** Se operó siempre como el owner.

### Costo en requests

| Clase | Nº | Resultado |
|---|---|---|
| `chat_action` | 3 | 1 `parse_fail`, 1 `ok`, 1 `safety_blocked` |
| `week_creator` | 1 | `ok` |
| `coach_assistant` | 0 | 1 intento rechazado en cliente, sin red |

**Total con impacto de proveedor: 4 llamadas de red** (el servidor contabilizó 5
unidades de cuota; ver K2). Muy por debajo del presupuesto de 12–15.

### Efectos sobre datos reales

- **Campo de lesiones del self: RESTAURADO** a `Lesión espalda baja, cuadrado
  lumbar`, con `Entendí: zona lumbar` y los otros dos campos vacíos. Verificado
  por recarga completa de `/settings`, no por memoria de la sesión.
- **Perfil del atleta gestionado (`Juan perez`): RESTAURADO.** Los tres campos de
  lesión vuelven a estar vacíos, como estaban antes. Verificado por recarga.
- **Rechazadas sin aplicar** las dos propuestas generadas: `ACTUALIZAR SESION`
  sobre el lunes 31 y la semana completa de 7 sesiones. Confirmado en `/week`:
  el lunes 31 AM conserva `Fuerza estructurada · 40min · RPE 2 · 4 ejercicios`.
- **No se creó ni borró ninguna sesión.** No se envió ningún mensaje al alumno
  gestionado. No se tocó ningún control destructivo de Ajustes. No se abrió Plan
  Builder. No se borró IndexedDB. No se usó incógnito.
- El scope activo quedó de vuelta en **`Tú`**.

## Tercera corrida — Plan Builder (87fc2d4)

Fecha: **2026-08-31**, 09:05–09:30 (hora local del owner).
Entorno: `app.rallyiq.cl`, cuenta del owner (Ralph), scope activo **`Juan perez`**
(atleta gestionado) durante toda la generación, restaurado a **`Tú`** al cierre.
Commit desplegado: **`87fc2d4` "Mejoras Sync service y QA"** (coincide con `HEAD`
local; el trabajo sin commitear del árbol —incluido
`src/services/training/strengthSafetyCopy.ts`— **no** está desplegado).

**VEREDICTO GLOBAL: PARCIAL.**

La corrida se ejecutó y produjo un plan real de 10 semanas con el bloque `build`
completo (6 semanas), que era la condición necesaria para poder medir el
allocator. Se cerraron **O3** y buena parte de **O1/O2** vía `/ops`, y apareció
un hallazgo de seguridad **observable desde el navegador** (Hallazgo D). Pero
**M1, M2, M3 y el detalle de O1/O2 no son observables desde Chrome** —ver
§"Por qué M1/M2/M3 no se cerraron"— así que quedan delegados a las consultas SQL
de la sección final. Además la generación terminó **`partial`**: la semana 10
falló.

### Corrección de método aplicada antes de gastar

El brief original pedía un plan de ~4 semanas. Se detuvo la ejecución y se
verificó contra el código que **esa configuración no puede medir el allocator**:
`selectStrengthBlockTemplate` rota con `weekIndexInBlock % 3`
(`src/services/training/strengthBlocks/index.ts:33`), `indexInBlock = weekIndex −
phase.startWeekIndex` (`src/services/planBuilder/blockIdentity.ts:63`) y las
fases squash son `wr ≤ 1 taper, ≤ 3 peak, ≤ 9 build`
(`src/services/macroPlan.ts:662-664`). Un plan de 4–7 semanas nunca produce dos
semanas del **mismo** subtemplate; el mínimo es un bloque de 4 semanas. El owner
aprobó conservar el evento existente (10 semanas, bloque build de 6) y añadir la
restricción de hombro. Coste aprobado ~US$0,30.

### Resumen por criterio

| # | Criterio | Resultado |
|---|---|---|
| M1 | `generation_meta.strengthAllocator` presente | **NO OBSERVABLE desde el navegador** → SQL |
| M2 | Solape < 3 contables entre pares del mismo bloque/ordinal | **NO OBSERVABLE desde el navegador** → SQL |
| M3 | Sin `quality.strength.repeated_template` | **NO OBSERVABLE desde el navegador** → SQL |
| N1 | Ningún ejercicio carga el hombro | **NO CONCLUYENTE a nivel de ejercicio; FALLA a nivel de copy** (Hallazgo D) |
| N2 | Bloqueo por seguridad honesto si ocurre | **NO EJERCITADO** — cero declinaciones en esta corrida |
| O1 | Fila de `plan_generation_jobs` | **PARCIAL** — agregados vía `/ops`; `variant_id`/`quality_version` → SQL |
| O2 | Attempts con `repair_taxonomy_version = 2` | **PARCIAL** — 10 intentos vía `/ops`; taxonomía → SQL |
| O3 | Gates pasados + delta de cuota | **VERIFICADO** |
| O4 | Traza de la semana fallida | **NO CAPTURADA** (ver Hallazgo C) |

### Estado del perfil — captura y restauración

**Valor original, verificado por inspección directa ANTES de tocar nada** (no
asumido desde el brief):

- `Lesión o molestia actual` = *(vacío)*
- `Restricciones activas` = *(vacío)*
- `Lesiones previas relevantes` = *(vacío)*
- Sin línea `Entendí:`; la sección `Lesiones y restricciones` sin punto naranja.

Se escribió `Dolor de hombro derecho` y la UI respondió **`Entendí: hombro`**
(transcrito por zoom, acento correcto, **una sola región**, como pedía el
diseño del experimento). Se pulsó `Guardar perfil` —el editor no autoguarda— y
se confirmó por **recarga completa** antes de generar.

**Restauración confirmada:** al cierre los tres campos vuelven a estar vacíos,
sin línea `Entendí:` y sin punto naranja, **verificado por recarga completa de
`/settings`**, no por memoria de sesión.

### Perfil del atleta gestionado (contexto de la generación)

`Resumen deportivo: Fuerza`. Disciplinas: sólo `Pesas / Fuerza`; disciplina
principal `Pesas / Fuerza`. Sin edad, peso ni nombre visible. **Días disponibles:
ninguno seleccionado.** Pese a eso el motor generó 4–5 sesiones por semana, así
que la disponibilidad vacía **no** bloquea la generación (contradice la lectura
inicial de la Corrida 1 del 2026-08-25). El macroplan resuelve `squash` como
deporte primario vía `getPlanGoalEventSport` (el evento objetivo manda sobre la
disciplina del perfil), lo que explica las fases squash pese al perfil de fuerza.

### Forma del plan generado

`Plan Smoke QA — Allocator Bloque Fuerza (run 3)` · 10 semanas · Inicio
2026-08-31 · Evento 3 nov 2026.

| Semana | Fase | idx en bloque | Sesiones | Sesiones de fuerza |
|---|---|---|---|---|
| Sem 1 | Base | 0 | 5 | 2 |
| Sem 2 | Build | 0 | 5 | 2 |
| Sem 3 | Build | 1 | 5 | 2 |
| Sem 4 | Build | 2 | 5 | 2 |
| Sem 5 | Build | 3 | 4 | **1** |
| Sem 6 | Build | 4 | 5 | 2 |
| Sem 7 | Build | 5 | 5 | 2 |
| Sem 8 | Peak | 0 | 5 | 2 |
| Sem 9 | Peak | 1 | 4 | 1 |
| Sem 10 | Competencia | — | **0 — falló** | — |

Bloque `build` = Sem 2–7. Pares que comparten subtemplate por construcción:
**(0,3) = Sem 2↔Sem 5**, **(1,4) = Sem 3↔Sem 6**, **(2,5) = Sem 4↔Sem 7**.

### Inventario literal de sesiones de fuerza (títulos y copy)

Esto es **todo** lo que el Plan Builder expone en producción: título,
descripción, deporte, fecha, bloque horario y duración. **La lista de ejercicios
no se renderiza en ninguna parte** (ver §"Por qué M1/M2/M3 no se cerraron").

```
Sem 1 · Base (2026-08-31)
  2026-08-31 AM 60min  Fuerza Base 1 — Olímpico + Sentadilla
  2026-09-03 AM 60min  Fuerza Base 2 — Press + Estocadas Unilaterales
      "Trabajo de empuje horizontal/vertical (press banca y press militar) y
       estocadas unilaterales para estabilidad de cadera y rodilla."

Sem 2 · Build (2026-09-07)  [idx 0]
  2026-09-07 AM 60min  Fuerza — Olímpico + Sentadilla
  2026-09-11 AM 60min  Fuerza — Press + Estocadas Unilaterales
      "Press de banca y press militar con carga progresiva. Estocadas búlgaras
       unilaterales... RPE 8 acorde a fase Build."

Sem 3 · Build (2026-09-14)  [idx 1]
  2026-09-15 AM 60min  Fuerza Día 1 — Olímpico + Sentadilla
  2026-09-18 AM 60min  Fuerza Día 2 — Press + Estocadas Unilaterales
      "Press de banca o press militar como eje de tren superior..."

Sem 4 · Build (2026-09-21)  [idx 2]
  2026-09-22 AM 60min  Fuerza Día 1 — Olímpico + Sentadilla (progresión densidad)
  2026-09-25 AM 60min  Fuerza Día 2 — Press + Estocadas Unilaterales (carga puntual)
      "Press de banca / press militar con incremento puntual de carga..."

Sem 5 · Build (2026-09-28)  [idx 3]   <-- sólo UNA sesión de fuerza
  2026-10-02 AM 60min  Fuerza — Press + Estocadas unilaterales
      "...press de banca inclinado y press militar para tren superior, seguido de
       estocadas búlgaras... Añadir saltos de caja ligeros al final."

Sem 6 · Build (2026-10-05)  [idx 4]
  2026-10-05 AM 60min  Fuerza — Olímpico + Sentadilla
  2026-10-08 AM 60min  Fuerza — Press + Estocadas Unilaterales
      "Desarrollar fuerza de tren superior con press de banca y press militar..."

Sem 7 · Build (2026-10-12)  [idx 5]
  2026-10-12 AM 60min  Fuerza — Peso Muerto / Hinge + Cadena Posterior
  2026-10-15 AM 60min  Fuerza — Olímpico + Sentadilla (Progresión de Densidad)

Sem 8 · Peak (2026-10-19)
  2026-10-19 AM 60min  Fuerza Peak — Olímpico + Sentadilla
  2026-10-23 AM 60min  Fuerza Peak — Press + Estocadas Unilaterales
      "Press de banca y press militar con carga puntual alta."

Sem 9 · Peak (2026-10-26)
  2026-10-26 AM 60min  Fuerza — Olímpico + Sentadilla (Peak)

Sem 10 · Competencia (2026-11-02)
  (ninguna — "No pudimos preparar esta semana.")
```

### M2 — lo único que se puede decir sin SQL

A **nivel de título** (proxy débil, porque el título lo redacta el modelo y la
identidad real del template vive en `generation_meta`), la alineación por ordinal
semanal de los tres pares queda así:

| Par | Ordinal 1 | Ordinal 2 | Alineado |
|---|---|---|---|
| Sem 2 ↔ Sem 5 | `Olímpico + Sentadilla` vs `Press + Estocadas` | Sem 5 no tiene 2ª | **No** |
| Sem 3 ↔ Sem 6 | `Olímpico + Sentadilla` vs `Olímpico + Sentadilla` | `Press + Estocadas` vs `Press + Estocadas` | **Sí** |
| Sem 4 ↔ Sem 7 | `Olímpico + Sentadilla` vs `Peso Muerto / Hinge` | `Press + Estocadas` vs `Olímpico + Sentadilla` | **No** |

Es decir: **sólo el par Sem 3 ↔ Sem 6 queda limpio para evaluar M2 por ordinal**.
El par (0,3) se rompe porque Sem 5 perdió una de sus dos sesiones de fuerza, y el
par (2,5) porque Sem 7 introduce una tercera familia (`Peso Muerto / Hinge`) y
desplaza el ordinal. **Esto no es un veredicto sobre el allocator** —el solape
real se mide sobre `exercises`, no sobre títulos— pero sí acota dónde mirar
primero en el SQL.

Observación adicional, descriptiva: cuatro de las seis semanas de `build`
(Sem 2, 3, 4, 6) presentan **exactamente el mismo par de títulos de fuerza**
(`Olímpico + Sentadilla` + `Press + Estocadas Unilaterales`). Es consistente con
lo que el detector proporcional de §29 está diseñado a tolerar (continuidad con
progresión) siempre que el contenido contable rote; sólo el SQL puede
distinguirlo de una repetición real.

### N1/N2 — restricción de hombro

**No se puede afirmar ni negar que los ejercicios respeten la restricción**: la
lista de ejercicios no es visible en producción. Lo que **sí** quedó observado, y
es un defecto de cara al usuario, está en el Hallazgo D.

**N2 no se ejercitó:** en ninguna de las 9 semanas apareció un bloqueo por
seguridad ni un aviso de degradación. `/ops` lo corrobora: `Declinaciones
seguras` marca **1** tanto en 24 h como en 7 días, y esa única declinación es la
de la corrida anterior (J2, 2026-08-30 20:35). **Esta corrida produjo cero
declinaciones.**

### O1/O2 — telemetría observable en `/ops` (leído 2026-08-31 09:28:55)

Ventana de 24 h, que contiene exactamente esta corrida de plan:

```
Corridas de plan                     1
Outcomes de corridas                 partial 1
Intentos de plan                     10
Outcomes de intentos                 succeeded 10
Costo Plan Builder asíncrono         US$0.2645
Costo total IA                       US$0.2788
1ª semana p50 / p90 / p95            29.6 s / 29.6 s / 29.6 s
Plan completo p50 / p90 / p95        94.8 s / 94.8 s / 94.8 s
Cobertura (plan completo)            1/1 filas · 43034/43034 tokens
Cobertura (intentos)                 6/7 filas · 69467/71115 tokens
Cuotas por tipo                      chat 17 · week_creator 4 · coach_assistant 19 · plan_builder_week 10
```

**Costo real de esta corrida: US$0.2645** para 10 semanas ⇒ **US$0.0265 por
semana**, coherente con el ~US$0,029 histórico de `OPTIMIZATION_AND_COSTS.md` §4.

`variant_id`, `quality_version` y `repair_taxonomy_version` **no** los expone
`/ops` (sólo agregados) → SQL.

### O3 — gates y cuota · VERIFICADO

La corrida atravesó el gate de entitlement y de cuota en el enqueue:

```
POST https://app.rallyiq.cl/.netlify/functions/enqueue-plan-generation → 200
```

Contadores locales de Ajustes → Diagnóstico IA, antes → después:

```
chat_general             0/120  →   0/120   (+0)
chat_action              0/120  →   0/120   (+0)
import_extract            0/10  →    0/10   (+0)
weekly_summary            0/10  →    0/10   (+0)
week_creator               0/8  →     0/8   (+0)
plan_builder_week         0/12  →   10/12   (+10)
plan_builder_pair          0/6  →     0/6   (+0)
coach_assistant_message   0/20  →    0/20   (+0)
```

**Delta = +10 unidades de `plan_builder_week`**, una por semana intentada
(9 exitosas + la fallida), sin reintentos. Coincide exactamente con el
`plan_builder_week 10` que reporta `/ops` del lado servidor. Quedan **2 unidades**
de cupo; **no se reintentó** la semana 10 por esa razón.

### Por qué M1/M2/M3 no se cerraron

No es una omisión del smoke: **no hay superficie en producción que exponga esos
datos.**

1. **La lista de ejercicios no se renderiza en el Plan Builder.**
   `grep -n "exercises" src/pages/PlanBuilderV2Page.tsx` → **cero coincidencias**.
   Confirmado empíricamente: el volcado de texto de las 9 semanas sólo entrega
   título, descripción, deporte, fecha y duración.
2. **El panel de calidad está apagado en producción.** `showPlanQualityDebug =
   isDevToolsEnabled()` (`PlanBuilderV2Page.tsx:704`) y `isDevToolsEnabled()`
   hace `if (import.meta.env.PROD === true) return false`
   (`src/services/devTools.ts:6-11`). Por eso `quality.strength.repeated_template`
   (M3) no puede verse.
3. **El backup local no incluye `strengthAllocator`.** El allowlist de
   `optionalWeekGenerationMeta` (`src/services/dataExport.ts:1916-1941`) enumera
   20 campos y **ninguno** es `strengthAllocator`.
4. **Los cuerpos de respuesta de red no son accesibles** con las herramientas de
   Chrome disponibles (sólo URL, método y status), así que el `generation_meta`
   que viaja en el pull de `training_plan_weeks` tampoco es legible.
5. El allocator corre server-side en `generate-plan-background`, así que no deja
   nada en la consola del navegador.

La única vía es SQL sobre Supabase — la misma que usó la corrida del 2026-08-26
para detectar que `strengthAllocator` estaba ausente. Las consultas están abajo.

### Hallazgos

#### Hallazgo D — P1: el copy de las sesiones de fuerza prescribe press militar con restricción de hombro declarada

Con `Dolor de hombro derecho` guardado y parseado (`Entendí: hombro`), **6 de las
14 sesiones de fuerza generadas describen explícitamente empuje por encima de la
cabeza y/o press de banca**: Sem 1, Sem 2, Sem 3, Sem 4, Sem 5, Sem 6 y Sem 8
(literales transcritos arriba). Ejemplos textuales:

```
"Press de banca y press militar con carga progresiva."                 (Sem 2)
"Press de banca o press militar como eje de tren superior..."          (Sem 3)
"...press de banca inclinado y press militar para tren superior..."    (Sem 5)
"Press de banca y press militar con carga puntual alta."               (Sem 8)
```

El press militar es empuje vertical con carga sobre el hombro; el press de banca
carga el hombro en la posición inferior. **Es el movimiento que la restricción
declarada debía excluir.**

**Alcance honesto y por qué no es todavía un veredicto sobre el gate:** estas
descripciones las redacta el modelo, mientras que la lista real de ejercicios la
materializa el selector determinista aguas abajo. Son dos capas distintas. Caben
dos escenarios y **no se pueden distinguir sin el SQL**:

- **(a)** el gate de seguridad sí excluyó los ejercicios y el defecto es sólo de
  copy — grave igual, porque **el atleta lee la descripción**, y aquí la
  descripción le indica hacer press militar con el hombro lesionado;
- **(b)** el gate no se aplicó y los ejercicios también cargan el hombro, en cuyo
  caso el bloque N falla de lleno.

La consulta N de la sección SQL resuelve cuál de los dos es.

Dato correlacionado que **no** decide el caso pero es coherente con (a): `/ops`
no registró ninguna declinación por seguridad en esta corrida, y `safetyDegraded`
no es observable desde el navegador.

#### Hallazgo E — P2: la semana 10 falló y la telemetría de intentos no lo refleja

La generación cerró como **`partial`**: `Semana 10 · Competencia` quedó vacía con
el mensaje `No pudimos preparar esta semana.` y el panel lateral
`Necesitamos un ajuste más — No pudimos dejar tu plan 100% listo.`

La inconsistencia: `/ops` reporta `Intentos de plan 10` con
**`Outcomes de intentos: succeeded 10`**. Es decir, **los 10 intentos figuran como
exitosos mientras el plan quedó `partial` con una semana sin materializar**. O el
intento de la semana 10 no se persistió, o falló después del intento (validación
o materialización) sin generar una fila de intento fallida. No se pudo determinar
cuál desde el navegador.

No se reintentó: quedaban 2 unidades de cupo y el brief prohibía comprar otra
corrida. La consulta O2 incluye `week_index` para que el owner vea si existe fila
para la semana 9 (0-based) y con qué outcome.

#### Hallazgo F — P2: `POST /rest/v1/week_summaries → 400` bajo scope de atleta gestionado

Al cargar la app inmediatamente después de cambiar el scope a `Juan perez` se
capturó:

```
POST https://<SUPABASE_PROJECT>.supabase.co/rest/v1/week_summaries → 400
[ERROR] [sync] sync:failure
```

> El host del proyecto va redactado a propósito. El escaneo de secretos de
> Netlify trata el valor de `SUPABASE_URL` como secreto y **falla el build**
> si lo encuentra en un archivo del repo, aunque el mismo valor viaje público
> en el bundle vía `VITE_SUPABASE_URL`. Al pegar trazas de red en un smoke,
> conservar la ruta y el status; nunca el host.

Un `Sincronizar entrenamientos` manual posterior terminó bien y la cabecera
volvió a `Al día · Última: recién`, y no se reprodujo en un segundo intento. **No
se pudo capturar el cuerpo del 400** (las herramientas no exponen cuerpos de
respuesta).

Es relevante porque **la segunda corrida de este mismo documento verificó G1/G2
("cero 4xx", "cero `sync:failure`") únicamente bajo scope `self`**. Bajo scope de
atleta gestionado aparece un 4xx en el arranque. No invalida G1/G2, pero acota su
alcance: la evidencia de sync limpio no cubre el scope gestionado.

#### Observación (no es hallazgo): `training_plans?athlete_id=eq.default`

Se observó `GET /rest/v1/training_plans?...&athlete_id=eq.default&...` **estando
el scope en `Tú`**. Se deja registrado por su cercanía con la regla dura del
proyecto sobre el literal `'default'`, pero **no se reporta como violación**:
`ATHLETE_PROFILE_LOCAL_ID` vale `'default'` y la política documentada dice que
las filas legacy/unscoped pertenecen **sólo al self**, así que consultar
`default` bajo scope self es consistente con el diseño. Se menciona para que
quede trazado, no para que se actúe.

### Lo que NO se verificó y por qué

- **M1, M2, M3** y el detalle de **O1/O2**: sin superficie en producción (ver
  §"Por qué M1/M2/M3 no se cerraron"). Delegados al SQL de abajo. **Las filas ya
  existen**: el plan quedó como borrador sin aceptar ni descartar, así que las
  consultas se pueden correr en cualquier momento sin gastar API.
- **N1 a nivel de ejercicio**: misma razón. El Hallazgo D acota el problema pero
  no lo cierra.
- **N2**: no se disparó ningún bloqueo por seguridad.
- **O4**: no se capturó la traza de la semana 10. El seguimiento de consola se
  activó antes de generar pero el buffer no retuvo eventos del worker —que corre
  server-side—, y el fix que registra la etapa `provider_call` en fallos **no está
  desplegado** en `87fc2d4`, tal como anticipaba el brief.
- **Convergencia multi-dispositivo**: un solo cliente, una sola sesión.
- **Cuenta `free` / entitlements**: se operó siempre como el owner `advanced`.

### Efectos sobre datos reales

- **Plan generado dejado como BORRADOR.** No se pulsó `Aceptar` en ningún
  momento, así que **no se disparó el ciclo de plan** y no se borró ninguna
  sesión planificada de `Juan perez`. Tampoco se pulsó `DESCARTAR` ni
  `INTENTAR DE NUEVO` — el borrador se conserva **a propósito**, porque es el
  sujeto de las consultas SQL de abajo.
- **Perfil de `Juan perez`: RESTAURADO.** Los tres campos de lesión vuelven a
  estar vacíos, verificado por recarga completa de `/settings`.
- **Evento objetivo sin tocar**: se conservó `Smoke QA — Allocator Bloque Fuerza
  (run 3)` · 3 nov 2026, exactamente como estaba.
- **Scope devuelto a `Tú`**, verificado: `/plans/builder` vuelve a mostrar el plan
  propio del owner (`Plan Nacional country`, 2 semanas, evento 11 sep 2026).
- No se borró IndexedDB, no se usó incógnito, no se tocó ningún control
  destructivo de Ajustes, no se envió ningún mensaje al alumno gestionado y no se
  disparó ningún diálogo nativo.

### Costo

| Concepto | Valor |
|---|---|
| Llamadas de enqueue | 1 (`enqueue-plan-generation → 200`) |
| Semanas intentadas | 10 (9 OK, 1 fallida) |
| Cuota consumida | `plan_builder_week` +10 de 12 |
| **`estimated_cost_usd` de la corrida** | **US$0.2645** |
| Costo por semana | US$0.0265 |

Dentro de los ~US$0,30 aprobados por el owner.

## Consultas SQL para cerrar M1, M2, M3, N1, O1 y O2

Correr en el SQL editor de Supabase (producción). **No requieren buscar ids a
mano**: todas se anclan en la corrida de plan del 2026-08-31, que es la única del
día (`/ops` reporta `Corridas de plan 1` en 24 h). Correr la Consulta 0 primero
para confirmar que resuelve el plan esperado.

### Consulta 0 — anclar la corrida (verificación previa)

```sql
select j.job_id,
       j.plan_id,
       j.athlete_id,
       j.outcome,
       j.week_count_requested,
       j.week_count_succeeded,
       j.week_count_failed,
       j.quality_version,
       j.variant_id,
       j.first_week_ready_ms,
       j.plan_complete_ms,
       j.terminal_ms,
       j.estimated_cost_usd,
       j.created_at
from plan_generation_jobs j
where j.created_at >= timestamptz '2026-08-31 00:00:00-04'
order by j.created_at desc;
```

Esperado: **una** fila, `outcome = 'partial'`, `week_count_requested = 10`,
`week_count_succeeded = 9`, `week_count_failed = 1`,
`estimated_cost_usd ≈ 0.2645`. Eso responde **O1** completo
(`quality_version` debe ser `2`).

### Consulta M1 — ¿existe `strengthAllocator` en las semanas con fuerza?

```sql
with job as (
  select plan_id
  from plan_generation_jobs
  where created_at >= timestamptz '2026-08-31 00:00:00-04'
  order by created_at desc
  limit 1
)
select w.week_index,
       w.phase,
       w.week_start_date,
       (select count(*)
          from jsonb_array_elements(w.sessions) s
         where s->>'sessionType' = 'strength')                as strength_sessions,
       (w.generation_meta ? 'strengthAllocator')        as has_allocator,
       w.generation_meta -> 'strengthAllocator'         as allocator
from training_plan_weeks w
join job on job.plan_id = w.plan_id
where w.deleted_at is null
order by w.week_index;
```

**M1 pasa** si `has_allocator = true` en **todas** las filas con
`strength_sessions > 0`. En la corrida del 2026-08-26 esto salía `false` en las
11 semanas: ése era el defecto.

### Consulta M2 — solape real de ejercicios por par del bloque build

Compara por **ordinal semanal** dentro del bloque `build` (semanas 1–6
0-based = Sem 2–7 de la UI), tal como define el contrato de §29.

```sql
with job as (
  select plan_id
  from plan_generation_jobs
  where created_at >= timestamptz '2026-08-31 00:00:00-04'
  order by created_at desc
  limit 1
),
strength as (
  select w.week_index,
         w.phase,
         s->>'date'                                        as session_date,
         s->>'timeBlock'                                   as time_block,
         s->>'title'                                       as title,
         row_number() over (partition by w.week_index
                            order by s->>'date', s->>'timeBlock') as ordinal,
         array(select e->>'name'
                 from jsonb_array_elements(coalesce(s->'exercises', '[]'::jsonb)) e
                order by 1)                                as exercise_names
  from training_plan_weeks w
  join job on job.plan_id = w.plan_id,
       lateral jsonb_array_elements(w.sessions) s
  where w.deleted_at is null
    and s->>'sessionType' = 'strength'
    and w.phase = 'build'
)
select a.week_index      as week_a,
       b.week_index      as week_b,
       a.ordinal,
       a.title           as title_a,
       b.title           as title_b,
       a.exercise_names  as exercises_a,
       b.exercise_names  as exercises_b,
       cardinality(array(select unnest(a.exercise_names)
                         intersect
                         select unnest(b.exercise_names)))          as shared,
       array(select unnest(a.exercise_names)
             intersect
             select unnest(b.exercise_names))                       as shared_names,
       round(100.0 * cardinality(array(select unnest(b.exercise_names)
                                       intersect
                                       select unnest(a.exercise_names)))
             / nullif(cardinality(b.exercise_names), 0), 1)         as similarity_pct_b_into_a
from strength a
join strength b
  on b.ordinal = a.ordinal
 and b.week_index = a.week_index + 3      -- pares 0-3, 1-4, 2-5 del bloque
order by a.week_index, a.ordinal;
```

**M2 pasa** si en cada fila `shared < 3` **o** `similarity_pct_b_into_a < 80`.
El contrato de §29 alerta con **≥3 compartidos Y ≥80% de similitud direccional**.
Por lo observado en la UI, el par con ordinales alineados es
`week_a = 2, week_b = 5` (Sem 3 ↔ Sem 6); los otros dos pueden devolver menos
filas por el desalineo descrito arriba.

### Consulta M3 — warnings de calidad del plan

```sql
with job as (
  select plan_id
  from plan_generation_jobs
  where created_at >= timestamptz '2026-08-31 00:00:00-04'
  order by created_at desc
  limit 1
)
select (i->>'weekIndex')::int as week_index,
       i->>'code'             as code,
       i->>'severity'         as severity,
       i->>'message'          as message
from training_plans p
join job on job.plan_id = p.id,
     lateral jsonb_array_elements(
       coalesce(p.generation_summary->'qualityReview'->'issues', '[]'::jsonb)
     ) i
where i->>'code' like 'quality.strength%'
order by week_index;
```

**M3 pasa** si **no** aparece ninguna fila con
`code = 'quality.strength.repeated_template'`. Estos warnings son de calidad
del plan completo; `training_plan_weeks.validation_issues` sólo contiene la
validación individual de cada semana y no sirve para este control.

### Consulta N — ¿algún ejercicio carga el hombro? (cierra el Hallazgo D)

```sql
with job as (
  select plan_id
  from plan_generation_jobs
  where created_at >= timestamptz '2026-08-31 00:00:00-04'
  order by created_at desc
  limit 1
)
select w.week_index,
       s->>'date'   as session_date,
       s->>'title'  as title,
       e->>'name'   as exercise_name,
       e->'libraryRef'->>'id' as library_id,
       (w.generation_meta ->> 'safetyDegraded')     as safety_degraded,
       (w.generation_meta -> 'strengthSafetyBlocked') as safety_blocked
from training_plan_weeks w
join job on job.plan_id = w.plan_id,
     lateral jsonb_array_elements(w.sessions) s,
     lateral jsonb_array_elements(coalesce(s->'exercises', '[]'::jsonb)) e
where w.deleted_at is null
  and s->>'sessionType' = 'strength'
order by w.week_index, s->>'date', e->>'name';
```

**N1 pasa** si ninguna fila corresponde a empuje que cargue el hombro. Buscar
explícitamente: `press militar`, `press vertical`, `press de banca`,
`push press`, `Z press`, `press con landmine`, `dominada`, `fondo`,
`elevación`, `remo alto`, y sus `library_id` equivalentes
(`overhead_press`, `bench_press`, `push_press`, `landmine_press`, `pull_up`,
`chin_up`, `dip`, `upright_row`, `lateral_raise`).

- Si **no aparecen** → el gate funcionó y el Hallazgo D es **sólo de copy** (P1
  de producto: el texto que lee el atleta contradice la restricción).
- Si **aparecen** → el gate de seguridad **no se aplicó dentro de Plan Builder** y
  el bloque N falla (P0).

### Consulta O2 — intentos y taxonomía de reparación

```sql
with job as (
  select job_id, plan_id
  from plan_generation_jobs
  where created_at >= timestamptz '2026-08-31 00:00:00-04'
  order by created_at desc
  limit 1
)
select a.week_index,
       a.attempt,
       a.outcome,
       a.repair_taxonomy_version,
       a.quality_version,
       a.variant_id,
       a.model,
       a.input_tokens,
       a.output_tokens,
       a.error_class,
       a.created_at
from plan_generation_attempts a
join job on job.job_id = a.job_id
order by a.week_index, a.attempt;
```

**O2 pasa** si todas las filas traen `repair_taxonomy_version = 2` y su
`variant_id`/`quality_version` coinciden con los de la Consulta 0.
Además, **para el Hallazgo E**: revisar si existe fila para `week_index = 9`
(la semana 10 de la UI) y con qué `outcome`/`error_class`; `/ops` decía
`succeeded 10`, lo que no cuadra con una semana sin materializar.

## Cierre SQL y smoke Free — 2026-08-31

Las consultas se ejecutaron en el proyecto de producción, en modo lectura. La
consulta O2 original quedó corregida arriba: el esquema persistido usa
`input_tokens`/`output_tokens`; no tiene `prompt_tokens`, `completion_tokens` ni
`estimated_cost_usd` por intento.

| Control | Resultado | Evidencia / conclusión |
|---|---|---|
| O1 | **Falla esperada** | Una corrida `partial`: 10 solicitadas, 9 materializadas y 1 fallida. |
| M1 | **Pasa** | Todas las semanas con fuerza persisten `strengthAllocator`; no hubo identidad sin resolver, pool insuficiente, búsqueda agotada ni slots sin materializar. |
| M2 | **Falla** | Cuatro comparaciones quedan bajo el umbral, pero `week_a=3`, `week_b=6`, ordinal 2 repite 9 ejercicios (100%). La corrección queda en código y requiere una nueva generación para verificarse. |
| M3 | **Falla detectada correctamente** | `generation_summary.qualityReview.issues` contiene cuatro `quality.strength.repeated_template`; la consulta anterior miraba erróneamente `validation_issues` por semana. |
| N1 | **Pasa a nivel de ejercicio** | 142 ejercicios de fuerza; la búsqueda de movimientos/IDs que cargan hombro no devolvió filas. El Hallazgo D queda reclasificado como defecto P1 de copy, no como bypass del gate. |
| O2 | **Falla de fidelidad** | Las 10 filas —incluida `week_index=9`— dicen `succeeded`, con taxonomía y calidad v2, variante consistente y `error_class` nulo. Confirma Hallazgo E: el intento fue contabilizado antes de fallar la materialización. |

### Acciones derivadas

- El writer asíncrono ahora difiere la persistencia de `succeeded` hasta que la
  semana y el plan pasan sus checkpoints. Si ese tramo falla, registra
  `post_generation_failed` en lugar de éxito. Requiere aplicar la migración
  `027_plan_generation_attempt_post_generation_failure.sql` al desplegar.
  Diferir la escritura obligó a cubrir el rechazo del gate de uso, que es el
  único camino terminal que retorna antes del checkpoint: allí los intentos ya
  respondidos se vacían con **su outcome real**, no como
  `post_generation_failed` — el corte es del gate, no posterior a materializar
  la semana.
- M2 no es un falso positivo: la repetición completa ocurrió bajo la
  restricción de hombro. El allocator trataba las dos sesiones de fuerza como
  una única bolsa semanal, concentrando las sustituciones en una y dejando la
  otra clonada. Ahora I1 se calcula por ordinal de sesión y conserva I2 para
  toda la semana; hay una regresión que exige repartir las alternativas. El
  siguiente smoke de Plan Builder debe repetir este caso sobre una generación
  nueva.
- En el smoke de cuenta Free, el backend bloqueó Plan Builder y mostró la oferta
  de Avanzado. El borrador vacío transitorio se descartó inmediatamente, sin
  aceptar ni modificar el plan existente.
- La pregunta de asesoría "¿Qué debería priorizar hoy antes de mis sesiones?"
  se encaminó erróneamente como `chat_action` por contener `hoy` y `sesiones`.
  La respuesta de asesoría llegó desde el proveedor pero la UI la descartó por
  no traer una acción. Se añadió una regresión y se la enruta como
  `chat_general`. El desvío exige además **ausencia de verbo de mutación**:
  `conviene` y `mejor` también aparecen en peticiones de acción, y sin ese
  guard "¿cuál sesión debería sacar del lunes?" dejaba de producir propuesta.
  El guard se compone desde `ADJUSTMENT_VERB_PATTERN` y
  `SESSION_CREATION_VERB_PATTERN` —una sola autoridad de vocabulario— más las
  conjugaciones de primera y segunda persona, que ninguna de las dos cubre
  porque allí el usuario habla en imperativo.
