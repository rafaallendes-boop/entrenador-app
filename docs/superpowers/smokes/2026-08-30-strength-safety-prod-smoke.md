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
