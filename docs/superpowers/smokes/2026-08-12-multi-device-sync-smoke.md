# Smoke — sync multi-dispositivo

Fecha objetivo: primer deploy después de `dcb69cc`.
Estado: **pendiente de ejecución.**

## Por qué existe

El harness (`src/testing/syncHarness/`) demuestra **concurrencia lógica**: dos
estados divergentes que se alternan contra un backend con estado. Por
construcción no puede demostrar tres cosas, y son exactamente las que este smoke
cubre:

1. **Simultaneidad real** — dos clientes con operaciones en vuelo a la vez.
2. **RLS de Supabase** — el doble no evalúa políticas; concede todo.
3. **Latencia y pérdida reales** — reintentos, timeouts, reconexión.

Si el smoke falla, el fallo se convierte primero en un caso rojo del harness y
recién después se corrige. Ese es el circuito que justifica haber construido el
harness.

## Prerrequisitos, en este orden

Cada punto bloquea al siguiente. **No saltarse el orden.**

- [ ] **Aplicar `supabase/019_whoop_workout_zones.sql` a mano, ANTES del deploy.**
      `pullWorkouts.ts:9` pide las siete columnas de zona **sin gate de flag**:
      con la migración sin aplicar, cada pull de workouts devuelve 400.
- [ ] Confirmar que `WHOOP_ZONES_ENABLED` está **apagado** en el primer deploy.
- [ ] Desplegar el bundle y confirmar por hash que no es el anterior.
- [ ] Dos dispositivos con la **misma cuenta**: preferible uno móvil y uno
      desktop, para que la latencia difiera de verdad. Dos pestañas del mismo
      navegador **no sirven**: comparten IndexedDB y `localStorage`.

## Convención

- **D1** = dispositivo 1, **D2** = dispositivo 2.
- «converge» = ambos muestran lo mismo tras refrescar, sin recargar la app a
  mano.
- Anotar cada resultado como OK / FALLA / NO OBSERVADO. **«No observado» no es
  OK**: significa que las condiciones no se dieron y el caso sigue abierto.

---

## Caso 1 — Edición concurrente de la misma sesión

Es el caso que motivó el desempate remoto de `dcb69cc`.

1. En D1 y D2, abrir la **misma** sesión de la misma semana.
2. Poner ambos en avión / sin red.
3. Editar el título en los dos, distinto: `desde D1` y `desde D2`.
4. Reconectar **D1 primero**, esperar a que sincronice.
5. Reconectar D2.
6. Refrescar la semana en ambos.

- [ ] Ambos terminan con **el mismo** título.
- [ ] Ninguno queda con una versión que el otro nunca vio.
- [ ] Ninguno muestra la sesión duplicada.

**Qué mirar si falla:** si cada uno conserva el suyo indefinidamente, el
desempate no está en el bundle desplegado. Si alternan en cada refresco, hay un
bucle de push mutuo — más grave que el defecto original.

## Caso 2 — Empate real de timestamp

El harness lo fuerza con timestamps idénticos; en producción hay que provocarlo.

1. Ambos offline.
2. Editar la misma sesión en los dos **lo más simultáneamente posible**.
3. Reconectar los dos a la vez.

- [ ] Convergen.
- [ ] Anotar cuál ganó y si coincidió con el último en llegar al backend.

Si los timestamps no empatan —lo más probable—, marcar **NO OBSERVADO**. El
empate está cubierto por el harness; este paso busca una confirmación
oportunista, no es un bloqueante.

## Caso 3 — Check-in del mismo día (clave natural)

Ejercita el único compuesto de `008b` y `reconcileNaturalKeyConflict`.

1. Ambos offline, mismo día.
2. Completar el check-in diario en los dos, con valores distintos de sueño y
   esfuerzo.
3. Reconectar D1, luego D2.

- [ ] Queda **un solo** check-in para ese día, no dos.
- [ ] Ambos dispositivos muestran el mismo.
- [ ] No aparece error visible al usuario.

Repetir con el **resumen semanal** (`week_summaries`), que tiene su propio
compuesto sobre `[athlete_id+week_start_date]`.

## Caso 4 — Borrado que no resucita

1. D1 y D2 muestran la misma sesión.
2. D1 **offline**: borrarla.
3. D2 **online**: editarla (título distinto).
4. Reconectar D1.
5. Esperar y refrescar ambos.

- [ ] La sesión **no vuelve** en ninguno de los dos.
- [ ] Si vuelve, anotar en cuál y si el otro la sigue viendo borrada — esa
      asimetría es el dato que importa.

Este es el caso con más probabilidad de fallar: `delete-wins` compite con una
edición más nueva, y el harness lo cubre sólo en el orden inverso.

## Caso 5 — Semana visible durante la hidratación

Cierra la frontera que dejó preparada PR #11.

1. D2 crea una sesión en la semana **próxima** y sincroniza.
2. En D1, pararse en la semana **actual**, cerrar la app del todo.
3. Abrir D1 con red lenta (throttling del devtool en desktop, o red móvil).
4. **Mirar la transición**, no sólo el resultado.

- [ ] En ningún momento se ven sesiones de dos semanas mezcladas.
- [ ] El encabezado de la semana nunca muestra un rango que no corresponde a lo
      listado abajo.
- [ ] La carga y adherencia del resumen nunca pertenecen a otra semana.

Grabar la pantalla si es posible: el defecto dura menos de un segundo y es
difícil de describir después.

## Caso 6 — Cambio de atleta sin fuga de scope

Sólo aplica con al menos un atleta gestionado.

1. D1 como self, D2 con un gestionado activo.
2. Crear una sesión en cada uno.
3. Sincronizar ambos y cambiar de atleta en D1.

- [ ] La semana del gestionado no muestra sesiones del self, ni al revés.
- [ ] Al volver al self, la vista no conserva restos del gestionado.
- [ ] Ninguna sesión cambió de atleta.

## Caso 7 — La cola termina vacía

Al cerrar el smoke, en **ambos** dispositivos:

- [ ] El indicador de sync no queda en error ni en «pendiente».
- [ ] Ajustes → diagnóstico de sync no reporta operaciones encoladas.
- [ ] No hay `sync:failure`, `queue:op_failed` ni `queue:op_expired` nuevos.

Estos tres eventos venían señalados desde el smoke anterior y **nunca se
validaron contra Supabase real**. Es la ocasión para cerrarlos o confirmarlos
como reales.

---

## Al cerrar

Anotar por cada caso: OK / FALLA / NO OBSERVADO, y para cada FALLA el mínimo
reproducible. Cada FALLA reproducible se escribe primero como caso rojo en
`src/testing/syncHarness/`, y sólo después se corrige la implementación.

Si algún caso resulta **no reproducible** en el harness porque depende de
simultaneidad real, decirlo explícitamente en vez de aproximarlo: es la
limitación conocida del instrumento, no un hueco de cobertura que se pueda
tapar con otro test.
