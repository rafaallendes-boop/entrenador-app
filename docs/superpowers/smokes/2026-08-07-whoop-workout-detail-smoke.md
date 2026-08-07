# Smoke autenticado — Whoop auto-sync y detalle de entrenamientos

Fecha objetivo: 2026-08-07  
Spec: `docs/superpowers/specs/2026-08-07-whoop-workout-detail-design.md`  
Plan: `docs/superpowers/plans/2026-08-07-whoop-workout-detail.md`

**Migraciones: ninguna para este smoke.** La entrega de detalle usa los workouts
que ya existen en Dexie v19 y Supabase por `012`. Si aparece un upgrade de Dexie
o una migración SQL nueva, parar: no pertenece a este cambio.

El smoke se puede correr primero en dev contra el working tree. La pasada de
producción va después de commit, push y deploy. Requiere la cuenta self con Whoop
conectado y el scope `read:workout`; no se inicia un OAuth nuevo.

## Qué valida

La suite ya cubre fórmula de ritmo, score states, ventana de siete días, tope de
ocho líneas, asociaciones y scope. Lo que falta observar con datos reales es la
costura entre cuatro superficies:

1. el auto-sync trae o reutiliza workouts frescos;
2. `DayDetail` une el workout con la sesión correcta y lista los no asociados;
3. el prompt del coach recibe el bloque real, sin encabezados vacíos;
4. cambiar a un atleta gestionado no expone ningún workout del self.

**Regla de corte:** si aparece cualquier dato Whoop del self bajo un atleta
gestionado, detener el smoke. Es una falla de aislamiento, no de presentación.

## Preparación

- [ ] **P1.** Levantar la app y entrar con la cuenta owner:

```bash
npm run dev
```

Para probar la llamada real del coach en local, usar `netlify dev` con
`VITE_AI_PROVIDER=proxy`.

- [ ] **P2.** Confirmar en Ajustes que Whoop está conectado y que no pide
  reconexión para `read:workout`.

- [ ] **P3.** Abrir DevTools → Network y activar **Preserve log**. No compartir
  capturas del `systemPrompt`: contiene contexto privado del atleta.

- [ ] **P4.** Identificar los datos disponibles en DevTools → Application →
  IndexedDB → `EntrenadorDB` → `whoopWorkouts`. Alternativamente, correr este
  helper de solo lectura en la consola:

```js
async function readIndexedDbStore(storeName) {
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

const workouts = await readIndexedDbStore('whoopWorkouts')
const sessions = await readIndexedDbStore('sessions')
console.table(workouts.map(({ workoutId, athleteId, date, sportName, durationMin, strain, avgHr, maxHr, distanceM, scoreState }) => ({
  workoutId, athleteId, date, sportName, durationMin, strain, avgHr, maxHr, distanceM, scoreState,
})))
console.table(sessions.filter((session) => session.autoCompletion?.source === 'whoop_workout').map((session) => ({
  id: session.id,
  date: session.date,
  title: session.title,
  workoutId: session.autoCompletion.workoutId,
})))
```

- [ ] **P5.** Elegir dentro de los últimos siete días, si existen: (a) un workout
  `SCORED` asociado a una sesión; (b) uno no asociado; y (c) un `running` de al
  menos 300 m. Si alguno no existe en los datos reales, marcar ese paso como
  **no reproducible**; no editar Dexie para fabricar el caso.

- [ ] **P6.** Tener al menos un atleta gestionado para el Caso 5. Si no existe,
  el caso queda no reproducible; no hace falta crear uno solo para este smoke.

## Caso 1 — Frescura y auto-sync

- [ ] **1.1.** Entrar a Inicio como self. Si el último sync está stale, la
  tarjeta pasa por “Sincronizando” sola y no muestra un aviso textual durante el
  proceso.

- [ ] **1.2.** En Network debe verse `whoop-status` y, solo si estaba stale o el
  último estado era error, un `whoop-sync`.

- [ ] **1.3.** Recargar dentro de los siguientes 30 minutos. Debe aparecer
  `whoop-status`, pero no un segundo `whoop-sync`.

- [ ] **1.4.** Pulsar “Sincronizar” durante el cooldown. El mensaje debe indicar
  que Whoop está al día y cuánto falta para volver a sincronizar.

## Caso 2 — Sesión asociada y métricas reales

- [ ] **2.1.** Abrir el día del workout asociado elegido en P5.

- [ ] **2.2.** La sesión completada por Whoop conserva el badge y muestra un
  bloque de métricas. Duración aparece siempre; strain, FC y distancia aparecen
  únicamente cuando la fila real los trae.

- [ ] **2.3.** Si el caso es `running` con `distanceM >= 300`, aparece ritmo. En
  squash, cycling, walking o una distancia menor a 300 m no debe aparecer.

- [ ] **2.4.** Los valores son legibles: minutos enteros, FC en bpm, distancia
  con coma decimal y ritmo `m:ss /km`. No deben aparecer decimales crudos de
  duración.

- [ ] **2.5.** Una sesión completada manualmente no muestra métricas Whoop aunque
  esté en el mismo día.

- [ ] **2.6.** Si existe un workout `PENDING_SCORE`, el aviso dice que Whoop
  todavía no lo puntuó. Si existe uno `UNSCORABLE`, dice que no pudo puntuarlo y
  no usa “todavía”. Si no existen, marcar no reproducible.

## Caso 3 — Workouts no asociados

- [ ] **3.1.** En el día con un workout no reclamado aparece la tarjeta
  **“Whoop registró además”**, con una línea por workout.

- [ ] **3.2.** Un workout reclamado por `session.autoCompletion.workoutId` no se
  repite en esa tarjeta, aunque su estado local de matching diga `no_session`.

- [ ] **3.3.** En un día sin workouts no asociados la tarjeta desaparece por
  completo; no queda encabezado vacío.

## Caso 4 — Bloque del coach

- [ ] **4.1.** Como self, entrar a Chat y enviar:

> Resume la carga objetiva que Whoop registró en los últimos 7 días y separa lo
> planificado de lo que no tuvo sesión asociada.

- [ ] **4.2.** En Network abrir el `POST /.netlify/functions/coach`, pestaña
  Payload, y buscar dentro de `systemPrompt`:
  `Carga objetiva registrada por Whoop (ultimos 7 dias)`.

- [ ] **4.3.** Verificar en ese bloque:
  - solo workouts `SCORED` de hoy a `today - 6`;
  - máximo ocho líneas detalladas;
  - los asociados terminan en `sesion planificada: ...`;
  - los restantes terminan en `sin sesion asociada`;
  - la última línea distingue strain 0–21 del esfuerzo declarado 1–10.

- [ ] **4.4.** Si hay más de ocho workouts, el resumen de los más antiguos va
  antes de las líneas detalladas y no hay truncado silencioso.

- [ ] **4.5.** La respuesta del coach debe reconocer la carga real y no presentar
  strain como RPE declarado. El payload es la evidencia primaria; la redacción
  exacta del modelo puede variar.

## Caso 5 — Scope por atleta

- [ ] **5.1.** Cambiar a un atleta gestionado y abrir el mismo día del Caso 2.
  No debe aparecer el bloque de métricas del workout self ni la tarjeta residual.

- [ ] **5.2.** Enviar la misma pregunta del Caso 4 como gestionado y revisar el
  payload. El `systemPrompt` no contiene el encabezado Whoop ni fechas, deportes
  o métricas del self.

- [ ] **5.3.** Volver al self: el detalle reaparece completo. No debe verse por un
  instante el contenido del gestionado ni viceversa.

## Resultado

_(completar al ejecutar)_

- Entorno y commit:
- Fecha/hora:
- Workouts reales disponibles:
- Casos aprobados:
- Casos no reproducibles:
- Casos fallidos / observaciones:
- Veredicto: **APROBADO / APROBADO PARCIAL / RECHAZADO**
