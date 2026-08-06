# Smoke en dev — Conversaciones del chat

Fecha: 2026-07-26
Plan: el plan retirado (historial en git)
Spec: el spec retirado (historial en git)

**Migraciones: ninguna.** Dexie sigue en **v18**, no hay SQL nuevo y el backup no
sube de versión. Si durante el smoke aparece un prompt de upgrade de Dexie o un
error de schema, algo está mal: parar y reportar.

## Qué se está verificando y por qué

La suite cubre las reglas puras y los caminos del store con mocks. Lo que **solo**
se ve en dev con datos reales es la interacción entre tres cosas que los tests
aíslan por separado:

1. la **derivación** del índice sobre tus mensajes reales (títulos que se leen
   como algo, no como ruido);
2. la **continuidad** al retomar un hilo viejo (`rotationSuspended`) contra la
   rotación por día calendario, que corre en dos puntos distintos
   (`loadHistory` y `sendMessage`);
3. el **scope por atleta**, que en el drawer es la superficie más fácil de filtrar
   mal, porque el índice se deriva escaneando **todos** los mensajes de la cuenta.

**Regla de oro:** si en el drawer aparece una conversación que no es del atleta
activo, el smoke se corta ahí. Es la única falla de este incremento que es de
integridad y no de UX.

---

## Preparación

- [ ] **P1.** Levantar dev: `./start.sh` (o `npm run dev`) y entrar a `/chat`.

- [ ] **P2.** Confirmar que hay historial real. Si la cuenta está limpia, crear
  al menos tres conversaciones antes de empezar: mandá un mensaje, tocá **Nuevo**
  (menú `⋯`), repetí. Al menos una debe empezar con un saludo suelto (`Hola`) y
  otra con saludo + contenido (`Hola, quiero ajustar la semana`).

- [ ] **P3.** Dejar abierta la consola de DevTools. Para los casos de rotación se
  usa este helper, que **retrasa** los mensajes de un hilo a un día anterior
  escribiendo directo en IndexedDB (no hay `db` global expuesto):

```js
// Backdatea TODOS los mensajes del chat N días. Usar con cuidado: escribe Dexie.
async function backdateChat(days = 1) {
  const conn = await new Promise((res, rej) => {
    const r = indexedDB.open('EntrenadorDB')
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
  })
  const tx = conn.transaction('chatMessages', 'readwrite')
  const store = tx.objectStore('chatMessages')
  const all = await new Promise((res) => { const r = store.getAll(); r.onsuccess = () => res(r.result) })
  const shift = days * 24 * 60 * 60 * 1000
  for (const row of all) { row.timestamp -= shift; store.put(row) }
  await new Promise((res) => { tx.oncomplete = res })
  conn.close()
  console.log('backdated', all.length, 'mensajes')
}
```

> Después de correrlo hay que **recargar** la página para que el store relea.
> Es destructivo sobre las marcas de tiempo locales; el sync remoto puede volver
> a traer las originales. Si preferís no tocar tus datos reales, hacé este smoke
> en un perfil de navegador aparte.

---

## Caso 1 — El drawer lista y titula

- [ ] **1.1** Tocar el botón de hamburguesa a la izquierda del título "RallyIQ".
  Esperado: el drawer entra desde la izquierda, con foco en el buscador.

- [ ] **1.2** Verificar el agrupado: encabezados **Hoy** / **Ayer** / `d MMM`,
  en ese orden descendente. Cada fila muestra título, hora `HH:mm` y `N msj`.

- [ ] **1.3** La conversación actual tiene el nodo naranja lleno y la etiqueta
  **en curso**.

- [ ] **1.4** Títulos: la conversación que empezó con `Hola, quiero ajustar la
  semana` debe titularse **"Quiero ajustar la semana"** (saludo recortado,
  mayúscula restituida). La que fue solo `Hola` y después algo real debe titularse
  con el **segundo** mensaje.

- [ ] **1.5** `Esc` cierra el drawer. El scrim (fondo oscuro) también.

## Caso 2 — Retomar un hilo y continuidad

- [ ] **2.1** Abrir el drawer y tocar una conversación **anterior**. Esperado:
  el drawer se cierra, el chat muestra los mensajes de ese hilo y el scroll queda
  abajo.

- [ ] **2.2** Escribir un mensaje nuevo en ese hilo. Esperado: la respuesta se
  agrega **al mismo hilo**. No debe aparecer una conversación nueva en el drawer.
  Esto es `rotationSuspended`: retomar es una decisión explícita y gana sobre la
  rotación por día.

- [ ] **2.3** Reabrir el drawer: la conversación retomada ahora aparece bajo
  **Hoy**, con el contador de mensajes actualizado (frescura del índice).

- [ ] **2.4** Recargar la página (F5). Esperado: seguís en el hilo retomado si el
  último mensaje es de hoy.

## Caso 3 — Rotación por día calendario

- [ ] **3.1** Con el chat cargado, correr `await backdateChat(1)` en consola y
  **recargar**.

- [ ] **3.2** Esperado: el chat abre **vacío**, en un hilo nuevo. Nada se perdió.

- [ ] **3.3** Abrir el drawer: todas las conversaciones viejas están ahí, bajo
  **Ayer** (o la fecha correspondiente).

- [ ] **3.4** El caso inverso: retomar un hilo de ayer (Caso 2) y mandar un
  mensaje. **No** debe rotar. Este es el punto de rotación de `sendMessage`, que
  es distinto al de `loadHistory` y se saltea cuando la continuidad es explícita.

## Caso 4 — Búsqueda

- [ ] **4.1** Buscar una palabra que exista en un mensaje viejo, **sin tildes y en
  mayúscula** (ej. `HOMBRO` para "hombro", `MOLESTIA` para "molestía").
  Esperado: aparece la conversación, con un snippet debajo del título y el término
  resaltado.

- [ ] **4.2** El contador de mensajes de la fila sigue siendo el de la
  conversación completa, no el de coincidencias.

- [ ] **4.3** Tocar el resultado. Esperado: se abre la conversación **y el chat
  hace scroll hasta el mensaje que coincidió**, centrado — no al final.

- [ ] **4.4** Buscar algo inexistente (`xyzqk`). Esperado: "Nada coincide con
  «xyzqk». Probá con otra palabra." — no una lista vacía sin explicación.

- [ ] **4.5** Borrar el texto del buscador. Esperado: vuelve la lista completa.

- [ ] **4.6** Escribir rápido y borrar (probar el debounce de 250 ms): la lista no
  debe "parpadear" con resultados de una query anterior.

## Caso 5 — Borrado en dos toques

- [ ] **5.1** Hover (o tocar, en mobile) sobre una fila que **no** sea la actual:
  aparece el ícono de basurero.

- [ ] **5.2** Primer toque: el botón cambia a **Confirmar**. Tocar en otra parte
  no borra nada.

- [ ] **5.3** Tocar **Confirmar**. Esperado: la fila desaparece de inmediato y no
  vuelve al reabrir el drawer.

- [ ] **5.4** Borrar la conversación **actual** desde el drawer. Esperado: el chat
  queda vacío en un hilo nuevo y la lista se recarga sin la fila borrada.

- [ ] **5.5** Recargar la página. Esperado: las conversaciones borradas siguen
  borradas (se borraron en Dexie y se encolaron para sync, no solo en memoria).

## Caso 6 — Scope por atleta (el que corta el smoke)

> Requiere `VITE_COACH_ACCOUNTS` con tu cuenta y al menos un atleta gestionado.
> Si no tenés uno, creá uno desde `/coach` → Alumnos.

- [ ] **6.1** Como **self**, anotar cuántas conversaciones lista el drawer y los
  títulos de las primeras dos.

- [ ] **6.2** Cambiar al atleta **gestionado** desde el switcher. Entrar a `/chat`
  y abrir el drawer. Esperado: **ninguna** de las conversaciones del self aparece.
  Si el gestionado no tiene historial, la lista está vacía con el copy de empty
  state.

- [ ] **6.3** Escribirle un mensaje como gestionado y verificar que aparece en su
  drawer.

- [ ] **6.4** Volver al self. Esperado: tus conversaciones vuelven completas y la
  del gestionado **no** aparece.

- [ ] **6.5** Repetir 6.2 usando el **buscador** con una palabra que solo exista en
  las conversaciones del self. Esperado: cero resultados. (La búsqueda comparte el
  mismo filtro de scope que el listado; este paso confirma que no divergieron.)

## Caso 7 — Estados degradados (opcional pero barato)

- [ ] **7.1** Con el drawer abierto y una lista cargada, cortar la red desde
  DevTools no debería afectar nada: el índice es 100% local.

- [ ] **7.2** Con muchas conversaciones, medir a ojo la apertura del drawer. La
  derivación escanea **todos** los mensajes de la cuenta (no hay índice
  `[athleteId+timestamp]` en Dexie v18). Si la apertura se siente lenta, anotar el
  número de mensajes: ese es el dato que justificaría medir y migrar. No optimizar
  antes de tener ese número.

---

## Resultado

_(completar al ejecutar)_

- Fecha/hora:
- Casos aprobados:
- Casos fallidos / observaciones:
- Volumen de mensajes en la cuenta (para el punto 7.2):
