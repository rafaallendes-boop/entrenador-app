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

## Caso 8 — Cascade de borrado de atleta gestionado

Agregado el 2026-08-24. **Es el cambio destructivo de mayor alcance sin
verificar del proyecto** (§28 del roadmap) y por construcción no se puede probar
con un solo dispositivo: la lógica que se ejercita sólo corre cuando un
dispositivo pulea un roster del que otro ya borró una identidad.

Sólo aplica si tenés al menos un atleta gestionado descartable. **Creá uno
nuevo para esto** — el caso termina con ese atleta y todos sus datos
permanentemente borrados en ambos dispositivos, que es el punto.

### Precondición que hay que respetar, o el caso no prueba nada

D2 sólo interpreta la ausencia remota como borrado si **ya reconoció esa
identidad antes**: `pullAthletes` compara contra el registro durable
`entrenador_remote_athlete_ack_v1:<userId>` en `localStorage`
(`syncService.ts:3286`). Un id que D2 nunca vio en un pull previo se **conserva**
y la fila remota se repara — que es exactamente la corrección de §28 y el
comportamiento correcto.

Por eso el orden importa:

1. En D1, crear el atleta gestionado `Borrar QA`.
2. En D1, crear al menos una sesión y un check-in **dentro del scope de ese
   atleta**, y sincronizar.
3. **En D2, sincronizar y confirmar que el atleta aparece en el roster.** Este
   paso es el que escribe el reconocimiento. Sin él, el resto del caso mide otra
   cosa.

### Ejecución

4. En D1: Coach → Alumnos → archivar `Borrar QA` y después borrarlo
   definitivamente, escribiendo el nombre para confirmar.
5. Dejar que D1 termine de sincronizar.
6. En D2, forzar un sync (o abrir la app) y esperar.

### Qué tiene que pasar en D2

- [ ] El atleta **desaparece** del roster sin intervención manual.
- [ ] Sus sesiones, check-ins y resumen semanal desaparecen con él — el purgado
      es transaccional sobre todas las tablas athlete-scoped, así que no puede
      quedar mitad.
- [ ] Un refresco posterior **no lo resucita**. El tombstone es durable y
      sobrevive a propósito al borrado exitoso.
- [ ] El chat del atleta borrado no queda accesible ni retoma su hilo.

### Qué NO tiene que pasar — y es lo que más importa

- [ ] **El self queda intacto.** Ninguna sesión, check-in, resumen ni plan del
      atleta propio desaparece ni cambia de dueño. El filtro excluye
      explícitamente el self (`athlete.id !== selfAthleteId`), así que cualquier
      pérdida acá es un defecto grave y hay que parar el smoke.
- [ ] **No aparece `queue:op_failed` en ninguno de los dos dispositivos.** Ese
      evento es la firma exacta del defecto que §28 corrigió: D2 empujando para
      siempre contra un `athlete_id` que ya no existe, porque `007` define
      `athlete_profiles_athlete_fk … on delete cascade not valid` y `NOT VALID`
      **sí** valida inserts nuevos.
- [ ] Otros atletas gestionados, si los hay, no se tocan.

### Si falla

Anotar **cuál** de los dos dispositivos quedó inconsistente y en qué dirección,
porque el diagnóstico es distinto:

- **El atleta vuelve en D2 tras refrescar** → la barrera de tombstone no está
  reteniendo; mirar si `pullAthletes:remote_delete_applied` llegó a emitirse.
- **El atleta desaparece pero sus datos quedan huérfanos** → el purgado
  transaccional falló a mitad, que es el escenario peor.
- **D2 nunca lo borra** → lo más probable es que la precondición del paso 3 no
  se cumplió y D2 nunca reconoció la identidad. **No es una falla**: es el
  fail-safe funcionando. Rehacer el caso respetando el orden antes de reportarlo.
- **El sync de D2 queda en error y reintenta** → esperado si el pull falla:
  desde §28 la falla de `pullAthletes` **aborta el sync completo** de forma
  reintentable, a propósito. Anotarlo, pero no confundirlo con corrupción.

**Este caso no es reproducible en el harness** (`src/testing/syncHarness/`): el
doble de PostgREST no evalúa el `on delete cascade` de `007` ni las políticas
RLS, que son justamente los dos mecanismos bajo prueba. Si falla, la
reproducción mínima hay que buscarla contra Supabase real, no convertirla en un
caso rojo del harness como pide la regla general de este documento.

---

---

## Al cerrar

Anotar por cada caso: OK / FALLA / NO OBSERVADO, y para cada FALLA el mínimo
reproducible. Cada FALLA reproducible se escribe primero como caso rojo en
`src/testing/syncHarness/`, y sólo después se corrige la implementación.

Si algún caso resulta **no reproducible** en el harness porque depende de
simultaneidad real, decirlo explícitamente en vez de aproximarlo: es la
limitación conocida del instrumento, no un hueco de cobertura que se pueda
tapar con otro test.
