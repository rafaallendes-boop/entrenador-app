# Whoop — sincronización automática al abrir la app

Fecha: 2026-08-05
Estado: diseño aprobado, sin implementar
Migraciones: **ninguna** (no toca Supabase, Dexie ni Netlify functions)

## 1. Problema

Al entrar a la app hay que apretar "Sincronizar" en el Inicio para que lleguen
los datos frescos de Whoop. No es un bug: es el comportamiento actual, y está
documentado en el propio código.

Estado verificado hoy:

- `Dashboard.tsx:107-133` monta un efecto que hace `pullReadiness()` —que baja
  de Supabase a Dexie, **no** consulta a Whoop— y `refreshWhoopStatus()`. El
  comentario de `Dashboard.tsx:116-117` lo dice explícito: «On mount we only
  pull whatever the server cron already synced into readiness_daily; a fresh
  Whoop fetch stays behind the manual button».
- El botón llama `syncNow()` → `POST whoop-sync` con `trigger: 'manual'`, que
  tiene un cooldown server-side de 5 min (`MANUAL_COOLDOWN_MS = 300_000`,
  `whoopSync.ts:10`) apoyado en `last_manual_sync_at`.
- El cron corre **una vez al día**, `schedule('0 9 * * *')`
  (`whoop-cron.ts:6`) — 09:00 UTC, ~05/06 AM en Chile.

Consecuencia: entre el cron de la madrugada y el próximo día, lo único que trae
datos nuevos es el botón. Si entrás a media mañana, el recovery, el sueño y el
strain del día pueden estar viejos o incompletos hasta que sincronices a mano.

## 2. Decisiones de producto

Tomadas explícitamente durante el brainstorming:

1. **Disparador: solo al abrir la app.** Nada de `visibilitychange` ni de
   intervalos de fondo. Whoop actualiza recovery una vez al día; el valor
   marginal de un polling continuo es bajo frente a su costo en requests.
2. **Criterio: frescura de 30 minutos.** El cliente mira `lastSyncAt` y
   `lastSyncStatus` del endpoint de status y solo dispara si no puede probar que
   los datos están frescos. Recargar la página varias veces seguidas no genera
   `POST` de sync mientras el estado sea fresco; cada montaje sí hace su
   `GET whoop-status`, igual que hoy.
3. **Feedback: spinner sí, mensajes no.** El botón muestra "Sincronizando" —es
   cierto, hay un request en vuelo— pero el sync automático no escribe ningún
   texto en pantalla.
4. **Colisión con el botón manual: se resuelve por copy**, no por servidor. El
   auto-sync usa el mismo camino `manual`, así que después de correr **con
   éxito** deja el botón en cooldown 5 min; el mensaje de cooldown pasa a decir
   la verdad ("ya está al día") en vez de leerse como error.

## 3. Arquitectura

Tres piezas, una responsabilidad cada una.

### 3.1 Política pura — `src/services/readiness/whoopAutoSync.ts` (nuevo)

```ts
export const WHOOP_AUTO_SYNC_STALE_AFTER_MS = 1_800_000 // 30 min

export function shouldAutoSyncWhoop(input: {
  connected: boolean
  lastSyncAt: string | null | undefined
  lastSyncStatus: 'ok' | 'error' | null | undefined
  now: number
  staleAfterMs?: number
}): boolean
```

Sin React y sin red, igual que `canAutoPersistWhoopPrefill`
(`dayLogPrefillSave.ts:78`), que ya es exactamente este patrón dentro de la
misma feature.

Contrato, en orden:

1. Si `connected === false` → **`false`**. No hay nada que sincronizar.
2. Estando conectado, devuelve **`false` solo cuando puede probar frescura**:

   ```
   lastSyncStatus === 'ok'
   && timestamp parsea
   && no está en el futuro
   && now - lastSyncAt < staleAfterMs
   ```

3. Cualquier otro caso → **`true`**.

| Entrada | Resultado | Razón |
|---|---|---|
| `connected: false` | `false` | Excepción explícita de la regla general |
| `lastSyncAt: null` / `undefined` | `true` | Nunca sincronizó |
| Timestamp no parseable (`NaN`) | `true` | Dato corrupto; fail-open |
| `lastSyncAt` en el futuro | `true` | Reloj desfasado; fail-closed dejaría al usuario sin datos indefinidamente |
| 2 min + `lastSyncStatus: 'error'` | `true` | El intento falló: el timestamp es reciente pero **no hay datos frescos** |
| 2 min + `lastSyncStatus: null` | `true` | Sin resultado registrado, no se puede afirmar frescura |
| 29 min + `'ok'` | `false` | Fresco |
| 30 min exactos + `'ok'` | `true` | El límite es `>=` |
| 31 min + `'ok'` | `true` | Viejo |

**`lastSyncStatus` es imprescindible, no una comodidad.** `runWhoopSync` escribe
`lastSyncAt` también en el camino de error (`whoopSync.ts:139-142`), así que
`{ lastSyncAt: hace 2 min, lastSyncStatus: 'error' }` es un estado alcanzable
—token muerto, red caída, rate limit de Whoop— en el que mirar solo el timestamp
declararía "fresco" un sync que nunca trajo nada. Y el cooldown de 5 min no
tapa ese caso: `lastManualSyncAt` solo se escribe tras un sync **exitoso**
(mismo bloque de código), justamente el hecho en el que se apoya el copy de §5.

El fail-open prioriza traer datos ante la incertidumbre. Tras un sync exitoso,
el cooldown de 5 min limita los intentos adicionales; tras un error no aplica,
con la consecuencia descrita debajo. Si la política se equivocara al revés, el
usuario se queda sin datos y no se entera.

**Consecuencia aceptada.** Como un error no bloquea el reintento, abrir la app
repetidamente con una conexión rota dispara un `POST whoop-sync` por apertura.
Está acotado por el disparador —solo al abrir, decisión 2.1— y cada intento
falla rápido del lado del servidor. El caso incómodo es `rate_limited`, donde
reintentar es precisamente lo contrario de lo que conviene, pero
`last_sync_status` colapsa `rate_limited` y `error` en un mismo `'error'`
(`whoopSync.ts:139-147`) y distinguirlos exigiría tocar el esquema, que está
fuera de alcance. Si en uso real aparece, la respuesta es un backoff explícito
—escrito como backoff, no disfrazado de frescura—, no ensanchar esta regla.

`staleAfterMs` es parámetro para poder fijar el límite por test sin depender de
la constante.

### 3.2 Efecto opt-in en `useWhoopSync`

Firma nueva: `useWhoopSync({ autoSync }: { autoSync?: boolean })`.

El efecto, cuando `autoSync === true`:

1. `const status = await refreshStatus()`.
2. Si `status === null` → **corta**. Un status fallido no da un `connected`
   confiable y un segundo request no aporta señal; el caso ya queda registrado
   por `apiAvailable: false` y el `console.warn` que `refreshStatus` ya hace
   (`useWhoopSync.ts:69`).
3. Si fue cancelado (ver abajo) → corta.
4. Evalúa `shouldAutoSyncWhoop` con `connected`, `lastSyncAt` y `lastSyncStatus`
   del status recién traído más `now: Date.now()`; si devuelve `false`, corta.
5. `await syncNow({ silent: true })`.

**La decisión usa el valor retornado por `await refreshStatus()`, nunca el
`status` de React**, que en ese punto todavía puede ser el del render anterior.

**Cancelación.** El efecto lleva un flag local de cancelación que se activa en
su cleanup. Si `autoSync` pasa a `false` —o cambia el atleta activo— mientras el
status está en vuelo, el sync no se dispara. Esto evita sincronizar después de
un cambio de scope.

**Dependencias del efecto: `[autoSync, refreshStatus, syncNow]`, las tres con
identidad estable**, de modo que corre exactamente una vez por activación.
`refreshStatus` ya es `useCallback([])`. Para que `syncNow` también lo sea,
`onReadinessPulled` pasa a leerse desde un `useRef` actualizado en cada render y
sale de las dependencias de `syncNow`.

Ese último cambio no es cosmético: hoy `syncNow` depende de `onReadinessPulled`
(`useWhoopSync.ts:124`), así que un consumidor que pasara un callback sin
memoizar cambiaría la identidad de `syncNow` en cada render y el efecto
dispararía un `GET whoop-status` por render — un bucle de requests. El
`Dashboard` actual sí memoiza (`loadLocalReadiness` es `useCallback` sobre
`[activeAthleteId, today]`, `Dashboard.tsx:72-78`), pero un efecto que se
auto-dispara no debe depender de la disciplina del llamador.

`autoSync` por sí solo captura todas las transiciones que importan, porque es
`canConnectWhoop`: self→gestionado lo baja a `false`, gestionado→self lo sube a
`true`, y entre dos gestionados se queda en `false`. No hace falta depender del
`athleteId`.

**Guard de vuelo.** Un `useRef<boolean>` en el hook: si ya hay un sync corriendo,
`syncNow` devuelve `null` sin disparar nada. Cubre el doble montaje de
StrictMode en dev y, de paso, el doble click en el botón. Se resetea
**incondicionalmente en `finally`**.

**Corrección de `mountedRef` (bug preexistente).** Hoy es
`useEffect(() => () => { mountedRef.current = false }, [])`
(`useWhoopSync.ts:58`): el efecto nunca lo pone en `true`, así que en StrictMode
el ciclo montar→desmontar→montar lo deja en `false` de forma permanente y el
hook deja de escribir estado para siempre. Hoy no se nota porque nada dispara
solo; con auto-sync sí se notaría. El efecto pasa a rearmarlo:
`useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])`.

### 3.3 Cableado en `Dashboard.tsx`

- Pasa `autoSync: canConnectWhoop` al hook.
- **Saca** su propia llamada a `refreshWhoopStatus()` del efecto de readiness,
  que ahora la hace el hook. Concretamente elimina las dos líneas finales de
  `loadWhoopReadiness` (`Dashboard.tsx:123-125`: el `if (!canConnectWhoop) return`
  y el `await refreshWhoopStatus()`, que juntos quedan muertos), saca
  `canConnectWhoop` y `refreshWhoopStatus` de las dependencias de ese efecto
  (`Dashboard.tsx:133`) y deja de desestructurar `refreshStatus` del hook
  (`Dashboard.tsx:81`) si no queda ningún otro consumidor.

`canConnectWhoop` ya es
`activeAthleteId != null && selfAthleteId != null && activeAthleteId === selfAthleteId`
(`Dashboard.tsx:60`), así que **con un atleta gestionado activo no se
auto-sincroniza nada**, igual que hoy. No se inventa un guard de scope nuevo.

Conteo de requests en el caso fresco: idéntico a hoy (un `GET whoop-status`).
En el caso stale se suman el `POST whoop-sync` y el `refreshStatus()` posterior
que `syncNow` ya hace hoy (`useWhoopSync.ts:112`) — ambos necesarios para dejar
el estado actualizado.

El efecto de readiness del Dashboard queda por lo demás intacto: `pullReadiness`
y `getLocalReadinessForDate` no se tocan, y el refresco de la tarjeta tras un
sync exitoso sigue llegando por `onReadinessPulled` → `loadLocalReadiness`.

## 4. Modo silencioso

`syncNow(options?: { silent?: boolean })`. Con `silent: true`:

- **`syncing`**: se setea igual que en el modo normal. El botón muestra su
  spinner, que es honesto: hay un request en vuelo.
- **`message`**: no se escribe en ningún camino —éxito, cooldown, error del
  servidor, excepción de red— y **tampoco se limpia al arrancar**. Hoy `syncNow`
  hace `setMessage(null)` al inicio (`useWhoopSync.ts:80`); un sync de fondo no
  debe borrar un mensaje que el usuario todavía no leyó. Los errores siguen
  yendo a consola.
- **`apiAvailable`**: se sigue seteando, porque es un hecho. No cambia nada
  visible: el Dashboard no lo consume; el único consumidor es `WhoopConnection`
  en Ajustes, que no auto-sincroniza.

### Única excepción: `consent_required`

Ese mensaje **sí se muestra aun con `silent: true`**, por los dos caminos que lo
producen: la detección local vía `getMissingConsents` y la respuesta remota con
`code: 'consent_required'`.

Razón: es la única condición de la lista que no es transitoria. Aparece cuando
sube la versión del descargo biométrico y persiste hasta que se acepte en
Ajustes. Con silencio total, el auto-sync quedaría mudo indefinidamente y el
usuario solo se enteraría apretando el botón a mano.

## 5. Copy del cooldown

Actual (`useWhoopSync.ts:19-22`):

> Espera 287s para volver a sincronizar.

Nuevo:

> Whoop ya está al día. Podés volver a sincronizar en 5 min.

**"Ya está al día" es exacto, no una cortesía.** El cooldown se apoya en
`last_manual_sync_at`, y en el camino de error `runWhoopSync` escribe `lastSyncAt`
**sin** tocar `lastManualSyncAt` (`whoopSync.ts:139-142`). Por lo tanto estar en
cooldown implica que hubo un sync manual **exitoso** hace menos de 5 minutos.

Formato, con redondeo hacia arriba para no invitar a reintentar antes de que
venza el cooldown:

```
seconds = max(1, ceil(retryAfterMs / 1000))
seconds < 60  →  `${seconds}s`
seconds >= 60 →  `${ceil(seconds / 60)} min`
```

Casos: 300 s → "5 min"; 287 s → "5 min"; 60 s → "1 min"; 59 s → "59s".

El cambio vive en `messageForSyncResult`, que es compartido, así que también
mejora el mensaje del botón de Ajustes (`WhoopConnection`).

## 6. Verificación

### `src/services/readiness/__tests__/whoopAutoSync.test.ts` (nuevo)

Tabla sobre la política pura, un caso por fila del cuadro de §3.1 —incluidas
las dos de `lastSyncStatus` no-`'ok'` con timestamp reciente—, más el límite
exacto de 30 min y un `staleAfterMs` custom. Sin DOM y sin red.

### `src/hooks/__tests__/useWhoopSync.test.ts` (extiende los 7 tests actuales)

- `silent: true` no escribe `message` en éxito, cooldown, error del servidor ni
  excepción de red.
- `silent: true` **sí** escribe el mensaje de `consent_required`, por detección
  local y por respuesta remota.
- `silent: true` no borra un `message` preexistente al arrancar.
- Dos `syncNow` concurrentes producen un solo `syncWhoopNow`.
- Copy nuevo del cooldown, incluyendo un caso que fije el redondeo hacia arriba
  (287 s → "5 min").
- Auto-sync con `autoSync: true` y status stale: dispara un sync silencioso.
- Auto-sync con status fresco (`'ok'` y reciente): **no** dispara sync pero
  **sí** refresca el estado.
- Auto-sync con `lastSyncAt` reciente pero `lastSyncStatus: 'error'`: **sí**
  dispara sync silencioso. Es el caso que motivó agregar el campo.
- `autoSync: false`: no hace ninguna de las dos cosas.
- `refreshStatus()` que devuelve `null`: no intenta sync.
- Cancelación: si `autoSync` pasa a `false` mientras el status está en vuelo, el
  sync no se dispara.
- Estabilidad: con `autoSync: true` y un `onReadinessPulled` **sin memoizar**,
  varios renders producen un solo `getWhoopStatus`. Fija que el efecto no puede
  degenerar en un bucle de requests.

### Regresión

`npm run lint && npm test && npm run build`.

## 7. Alcance

**Archivos de producción (3):**

- `src/services/readiness/whoopAutoSync.ts` — nuevo.
- `src/hooks/useWhoopSync.ts` — opción `autoSync`, opción `silent`, guard de
  vuelo, fix de `mountedRef`, copy del cooldown.
- `src/pages/Dashboard.tsx` — pasa `autoSync`, saca su `refreshWhoopStatus()`.

**Archivos de test (2):** el nuevo de la política y el existente del hook.

El alcance se mantiene en tres archivos pese a la señal nueva: `WhoopStatus` ya
expone `lastSyncStatus` (`whoopApi.ts:11`) y `whoop-status` ya lo devuelve
(`whoop-status.ts:43`). No hace falta tocar el cliente HTTP ni la function.

## 8. Fuera de alcance (declarado)

- Sync al volver al foco (`visibilitychange`) y sync por intervalo — descartados
  en la decisión 2.1.
- Cambiar la frecuencia del cron, que sigue en 1×/día a las 09:00 UTC.
- Cooldown separado server-side con un `trigger: 'auto'` propio, y la migración
  `019` que exigiría. Evitado a propósito: esta entrega **no toca Supabase,
  Dexie ni ninguna Netlify function**.
- Auto-sync para atletas gestionados.
- Auto-sync desde Ajustes (`WhoopConnection`).
- Cambios a `pullReadiness`, `pullWorkouts` o `autoCompleteFromWorkouts`, que ya
  corren dentro de `syncWhoopAndRefreshLocalData` y no se tocan.
