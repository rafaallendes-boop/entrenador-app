# Whoop auto-sync al abrir la app — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que al entrar al Inicio la app sincronice Whoop sola cuando los datos no están frescos, sin que el usuario tenga que apretar "Sincronizar".

**Architecture:** Una política pura (`shouldAutoSyncWhoop`) decide si hace falta sincronizar a partir del status remoto; `useWhoopSync` gana un efecto opt-in que la consulta al montar y dispara un sync en modo silencioso; `Dashboard` solo pasa el flag. No se toca Supabase, Dexie ni ninguna Netlify function.

**Tech Stack:** React 19 + TypeScript + Vitest + @testing-library/react (jsdom).

**Spec:** `docs/superpowers/specs/2026-08-05-whoop-auto-sync-design.md`

## Global Constraints

- **Sin migraciones.** No tocar `supabase/`, `src/db/` ni `netlify/functions/`. Dexie queda en v19.
- **Los commits los hace el owner** (regla de `CLAUDE.md`). Ningún paso de este plan ejecuta `git commit` ni `git add`. Cada tarea termina en una verificación con salida a la vista.
- **Alcance total: 3 archivos de producción** — `src/services/readiness/whoopAutoSync.ts` (nuevo), `src/hooks/useWhoopSync.ts`, `src/pages/Dashboard.tsx`. Si aparece un cuarto, parar y consultar.
- **Umbral de frescura:** `WHOOP_AUTO_SYNC_STALE_AFTER_MS = 1_800_000` (30 min), parametrizable por `staleAfterMs`.
- **Copy exacto del cooldown:** `Whoop ya está al día. Puedes volver a sincronizar en 5 min.` — con tildes, "Puedes" en voseo, y el tiempo redondeado **hacia arriba**.
- **Copy exacto de consentimiento:** `Aceptá el descargo biométrico en Ajustes para reanudar la sincronización.` (ya existe, no cambiarlo).
- **Scope de atleta:** el auto-sync solo corre para el self. El guard es `canConnectWhoop`, que ya existe en `Dashboard.tsx:60`. No inventar uno nuevo.
- Comandos: tests `npx vitest run <ruta>`; regresión final `npm run lint && npm test && npm run build`.

---

### Task 1: Política pura de frescura

**Files:**
- Create: `src/services/readiness/whoopAutoSync.ts`
- Test: `src/services/readiness/__tests__/whoopAutoSync.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `shouldAutoSyncWhoop(input: WhoopAutoSyncInput): boolean` y `WHOOP_AUTO_SYNC_STALE_AFTER_MS: number`. `WhoopAutoSyncInput` es `{ connected: boolean; lastSyncAt: string | null | undefined; lastSyncStatus: 'ok' | 'error' | null | undefined; now: number; staleAfterMs?: number }`. Los tipos de `lastSyncAt` y `lastSyncStatus` calzan exactos con `WhoopStatus` (`src/services/readiness/whoopApi.ts:8-13`).

**Contexto para quien implementa.** La regla es: **devolver `false` solo cuando se puede *probar* que los datos están frescos.** Todo lo demás devuelve `true` (sincronizar). `lastSyncStatus` es imprescindible porque el servidor escribe `lastSyncAt` **también cuando el sync falla** (`netlify/functions/_shared/whoopSync.ts:139-142`), así que un timestamp reciente no implica que hayan llegado datos.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/readiness/__tests__/whoopAutoSync.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { shouldAutoSyncWhoop, WHOOP_AUTO_SYNC_STALE_AFTER_MS, type WhoopAutoSyncInput } from '../whoopAutoSync'

const NOW = Date.parse('2026-08-05T12:00:00.000Z')
const MIN = 60_000
const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe('shouldAutoSyncWhoop', () => {
  const cases: Array<[string, WhoopAutoSyncInput, boolean]> = [
    ['sin conexion no sincroniza', { connected: false, lastSyncAt: null, lastSyncStatus: null, now: NOW }, false],
    ['sin conexion no sincroniza ni con un sync fresco', { connected: false, lastSyncAt: ago(MIN), lastSyncStatus: 'ok', now: NOW }, false],
    ['nunca sincronizo', { connected: true, lastSyncAt: null, lastSyncStatus: null, now: NOW }, true],
    ['timestamp undefined', { connected: true, lastSyncAt: undefined, lastSyncStatus: 'ok', now: NOW }, true],
    ['timestamp no parseable', { connected: true, lastSyncAt: 'not-a-date', lastSyncStatus: 'ok', now: NOW }, true],
    ['timestamp en el futuro', { connected: true, lastSyncAt: new Date(NOW + 5 * MIN).toISOString(), lastSyncStatus: 'ok', now: NOW }, true],
    ['reciente pero con error', { connected: true, lastSyncAt: ago(2 * MIN), lastSyncStatus: 'error', now: NOW }, true],
    ['reciente sin status registrado', { connected: true, lastSyncAt: ago(2 * MIN), lastSyncStatus: null, now: NOW }, true],
    ['29 minutos y ok', { connected: true, lastSyncAt: ago(29 * MIN), lastSyncStatus: 'ok', now: NOW }, false],
    ['30 minutos exactos y ok', { connected: true, lastSyncAt: ago(30 * MIN), lastSyncStatus: 'ok', now: NOW }, true],
    ['31 minutos y ok', { connected: true, lastSyncAt: ago(31 * MIN), lastSyncStatus: 'ok', now: NOW }, true],
  ]

  it.each(cases)('%s', (_label, input, expected) => {
    expect(shouldAutoSyncWhoop(input)).toBe(expected)
  })

  it('respeta un staleAfterMs custom', () => {
    const base = { connected: true, lastSyncStatus: 'ok' as const, now: NOW }
    expect(shouldAutoSyncWhoop({ ...base, lastSyncAt: ago(4 * MIN), staleAfterMs: 5 * MIN })).toBe(false)
    expect(shouldAutoSyncWhoop({ ...base, lastSyncAt: ago(6 * MIN), staleAfterMs: 5 * MIN })).toBe(true)
  })

  it('usa 30 minutos como default', () => {
    expect(WHOOP_AUTO_SYNC_STALE_AFTER_MS).toBe(1_800_000)
  })
})
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `npx vitest run src/services/readiness/__tests__/whoopAutoSync.test.ts`
Expected: FAIL — no resuelve el import `../whoopAutoSync` (el archivo todavía no existe).

- [ ] **Step 3: Implementar la política**

Crear `src/services/readiness/whoopAutoSync.ts`:

```ts
/** Ventana por defecto tras la cual un sync de Whoop se considera viejo. */
export const WHOOP_AUTO_SYNC_STALE_AFTER_MS = 1_800_000 // 30 min

export interface WhoopAutoSyncInput {
  connected: boolean
  lastSyncAt: string | null | undefined
  lastSyncStatus: 'ok' | 'error' | null | undefined
  now: number
  staleAfterMs?: number
}

/**
 * Decide si conviene disparar un sync automatico de Whoop al abrir la app.
 *
 * La regla es asimetrica a proposito: devuelve `false` solo cuando puede
 * *probar* que los datos estan frescos. Cualquier incertidumbre sincroniza.
 *
 * `lastSyncStatus` no es opcional para esa prueba: el servidor escribe
 * `lastSyncAt` tambien en el camino de error (whoopSync.ts:139-142), asi que un
 * timestamp reciente con status 'error' significa que el intento fallo y no que
 * haya datos frescos.
 */
export function shouldAutoSyncWhoop(input: WhoopAutoSyncInput): boolean {
  if (!input.connected) return false
  if (input.lastSyncStatus !== 'ok') return true
  if (input.lastSyncAt == null) return true

  const lastSyncMs = new Date(input.lastSyncAt).getTime()
  if (!Number.isFinite(lastSyncMs)) return true

  const elapsed = input.now - lastSyncMs
  if (elapsed < 0) return true

  return elapsed >= (input.staleAfterMs ?? WHOOP_AUTO_SYNC_STALE_AFTER_MS)
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `npx vitest run src/services/readiness/__tests__/whoopAutoSync.test.ts`
Expected: PASS — 13 tests (11 de la tabla + 2 sueltos).

---

### Task 2: Endurecer `useWhoopSync` (mountedRef, guard de vuelo, ref del callback)

**Files:**
- Modify: `src/hooks/useWhoopSync.ts:49-58` (refs y efecto de montaje), `:78-124` (`syncNow`)
- Test: `src/hooks/__tests__/useWhoopSync.test.ts` (extiende los 7 tests existentes)

**Interfaces:**
- Consumes: nada de Task 1.
- Produces: `syncNow` con identidad **estable** (deps `[refreshStatus, userId]`), que devuelve `null` sin disparar nada si ya hay un sync en vuelo. Task 5 depende de esa estabilidad.

**Contexto para quien implementa.** Son tres arreglos en el mismo archivo, todos prerrequisito del auto-sync:

1. **`mountedRef` nunca se rearma.** Hoy es `useEffect(() => () => { mountedRef.current = false }, [])` (línea 58). Bajo StrictMode (React 19, activo en `src/main.tsx:11`) el ciclo montar→desmontar→montar lo deja en `false` **para siempre**, y el hook no vuelve a escribir estado nunca. Está verificado: hoy, en StrictMode, un sync exitoso deja `message` en `null`. No se nota porque nada dispara solo; con auto-sync sí.
2. **No hay guard de concurrencia.** Dos `syncNow` solapados hacen dos `POST`.
3. **`syncNow` depende de `onReadinessPulled`** (línea 124). Un consumidor que pase un callback sin memoizar cambia la identidad de `syncNow` en cada render; en Task 5 eso sería un `GET whoop-status` por render, o sea un bucle de requests. El `Dashboard` actual sí memoiza, pero un efecto que se auto-dispara no debe depender de la disciplina del llamador.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final del `describe('useWhoopSync', ...)` de `src/hooks/__tests__/useWhoopSync.test.ts`. **El archivo sigue siendo `.ts`**: `wrapper: StrictMode` pasa la referencia al componente, no JSX, así que no hace falta renombrar nada. Agregar `import { StrictMode } from 'react'` arriba, junto a los demás imports.

```tsx
  it('sigue escribiendo estado despues del doble montaje de StrictMode', async () => {
    const { result } = renderHook(() => useWhoopSync(), { wrapper: StrictMode })

    await act(async () => {
      await result.current.syncNow()
    })

    expect(result.current.message).toBe('Whoop sincronizado.')
  })

  it('corre un solo sync cuando dos llamadas se solapan', async () => {
    let resolveSync: (value: { ok: boolean }) => void = () => {}
    mocks.syncWhoopNow
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSync = resolve as (value: { ok: boolean }) => void
      }))
      .mockResolvedValue({ ok: true })
    const { result } = renderHook(() => useWhoopSync())

    let second: unknown
    await act(async () => {
      const first = result.current.syncNow()
      const secondCall = result.current.syncNow()
      resolveSync({ ok: true })
      const responses = await Promise.all([first, secondCall])
      second = responses[1]
    })

    expect(second).toBeNull()
    expect(mocks.syncWhoopNow).toHaveBeenCalledOnce()
  })

  it('vuelve a permitir sync despues de que uno falla', async () => {
    mocks.syncWhoopNow.mockRejectedValueOnce(new Error('network down'))
    const { result } = renderHook(() => useWhoopSync())

    await act(async () => { await result.current.syncNow() })
    mocks.syncWhoopNow.mockResolvedValue({ ok: true })
    await act(async () => { await result.current.syncNow() })

    expect(mocks.syncWhoopNow).toHaveBeenCalledTimes(2)
  })

  it('mantiene syncNow estable cuando cambia la identidad de onReadinessPulled', () => {
    const { result, rerender } = renderHook(
      ({ cb }: { cb: () => void }) => useWhoopSync({ onReadinessPulled: cb }),
      { initialProps: { cb: () => {} } },
    )
    const first = result.current.syncNow

    rerender({ cb: () => {} })

    expect(result.current.syncNow).toBe(first)
  })

  it('llama al onReadinessPulled mas reciente, no al de la primera render', async () => {
    const stale = vi.fn()
    const fresh = vi.fn()
    const { result, rerender } = renderHook(
      ({ cb }: { cb: () => void }) => useWhoopSync({ onReadinessPulled: cb }),
      { initialProps: { cb: stale } },
    )

    rerender({ cb: fresh })
    await act(async () => { await result.current.syncNow() })

    expect(fresh).toHaveBeenCalledOnce()
    expect(stale).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run src/hooks/__tests__/useWhoopSync.test.ts`
Expected: FAIL en **3 de los 5** nuevos:
- StrictMode: `expected null to be 'Whoop sincronizado.'` (bug confirmado corriéndolo).
- solapadas: `expected "syncWhoopNow" to be called once, but got 2 times`.
- estabilidad: `expected [Function] to be [Function]` (identidades distintas).

Los otros dos **pasan ya**, y eso es intencional: son redes que protegen la refactorización, no defectos actuales.
- "vuelve a permitir sync después de que uno falla" impide que el guard nuevo deje el hook trabado.
- "llama al onReadinessPulled más reciente" pasa hoy porque `syncNow` se recrea en cada cambio de identidad del callback y captura `fresh`. Al sacar esa dependencia en el Step 4, el ref pasa a ser lo único que mantiene la propiedad; el test la fija antes de que eso ocurra.

- [ ] **Step 3: Rearmar `mountedRef` y agregar los refs**

En `src/hooks/useWhoopSync.ts`, reemplazar el bloque de refs y el efecto de montaje (líneas 56-58):

```ts
  const mountedRef = useRef(true)
  const syncInFlightRef = useRef(false)
  const onReadinessPulledRef = useRef(onReadinessPulled)

  useEffect(() => {
    onReadinessPulledRef.current = onReadinessPulled
  })

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
```

El efecto que actualiza `onReadinessPulledRef` va **sin array de dependencias** (corre después de cada render) y **antes** del efecto de montaje, para que el ref ya esté al día cuando corra cualquier efecto posterior.

- [ ] **Step 4: Aplicar el guard de vuelo y soltar la dependencia del callback**

En el mismo archivo, dentro de `syncNow`:

Al inicio del callback, **antes** de `setSyncing(true)`:

```ts
    if (syncInFlightRef.current) return null
    syncInFlightRef.current = true
```

Reemplazar la llamada de la línea 109 para que use el ref:

```ts
      const result = await syncWhoopAndRefreshLocalData(onReadinessPulledRef.current)
```

Reemplazar el bloque `finally` (líneas 121-123) — el ref se resetea **incondicionalmente**, a diferencia de `setSyncing`, que sigue guardado por `mountedRef`:

```ts
    } finally {
      syncInFlightRef.current = false
      if (mountedRef.current) setSyncing(false)
    }
```

Y cambiar las dependencias de `syncNow` (línea 124) de `[onReadinessPulled, refreshStatus, userId]` a:

```ts
  }, [refreshStatus, userId])
```

- [ ] **Step 5: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/hooks/__tests__/useWhoopSync.test.ts`
Expected: PASS — los 7 originales más los 5 nuevos, 12 en total.

- [ ] **Step 6: Verificar que no se rompió ningún consumidor**

Run: `npx vitest run src/components/settings/__tests__/WhoopConnection.test.tsx && npx tsc --noEmit`
Expected: PASS y typecheck limpio. `WhoopConnection` es el otro consumidor de `useWhoopSync`.

---

### Task 3: Modo silencioso en `syncNow`

**Files:**
- Modify: `src/hooks/useWhoopSync.ts:14-33` (extraer la constante del mensaje de consentimiento), `:78-124` (`syncNow`)
- Test: `src/hooks/__tests__/useWhoopSync.test.ts`

**Interfaces:**
- Consumes: el `syncNow` estable de Task 2.
- Produces: `syncNow(options?: { silent?: boolean }): Promise<WhoopSyncResponse | null>`. Con `silent: true` no escribe ni limpia `message`, **salvo** el mensaje de `consent_required`. Task 5 llama `syncNow({ silent: true })`.

**Contexto para quien implementa.** El sync automático no debe poner carteles: el usuario abre la app y los datos aparecen. Pero `syncing` **sí** se setea igual, porque el spinner del botón es cierto (hay un request en vuelo), y `apiAvailable` también, porque es un hecho.

La única excepción es `consent_required`: es la única condición no transitoria de la lista —aparece cuando sube la versión del descargo biométrico y persiste hasta que se acepte en Ajustes—, así que con silencio total el auto-sync quedaría mudo indefinidamente. Se muestra por sus **dos** caminos: la detección local vía `getMissingConsents` y la respuesta remota con `code: 'consent_required'`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al mismo `describe`:

```tsx
  it('no escribe mensaje en un sync silencioso exitoso', async () => {
    const { result } = renderHook(() => useWhoopSync())

    await act(async () => { await result.current.syncNow({ silent: true }) })

    expect(result.current.message).toBeNull()
    expect(mocks.syncWhoopNow).toHaveBeenCalledOnce()
  })

  it('no escribe mensaje en un sync silencioso que cae en cooldown', async () => {
    mocks.syncWhoopNow.mockResolvedValue({ ok: false, reason: 'cooldown', retryAfterMs: 120_000 })
    const { result } = renderHook(() => useWhoopSync())

    await act(async () => { await result.current.syncNow({ silent: true }) })

    expect(result.current.message).toBeNull()
  })

  it('no escribe mensaje en un sync silencioso con error generico del servidor', async () => {
    mocks.syncWhoopNow.mockResolvedValue({ ok: false, reason: 'error' })
    const { result } = renderHook(() => useWhoopSync())

    await act(async () => { await result.current.syncNow({ silent: true }) })

    expect(result.current.message).toBeNull()
  })

  it('no escribe mensaje cuando un sync silencioso tira una excepcion', async () => {
    mocks.syncWhoopNow.mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() => useWhoopSync())

    await act(async () => { await result.current.syncNow({ silent: true }) })

    expect(result.current.message).toBeNull()
  })

  it('no borra un mensaje previo al arrancar un sync silencioso', async () => {
    const { result } = renderHook(() => useWhoopSync())

    await act(async () => { await result.current.syncNow() })
    expect(result.current.message).toBe('Whoop sincronizado.')

    let resolveSync: (value: { ok: boolean }) => void = () => {}
    mocks.syncWhoopNow.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSync = resolve as (value: { ok: boolean }) => void
    }))

    let pending: Promise<unknown> = Promise.resolve()
    await act(async () => {
      pending = result.current.syncNow({ silent: true })
      await Promise.resolve()
    })
    expect(result.current.message).toBe('Whoop sincronizado.')

    await act(async () => {
      resolveSync({ ok: true })
      await pending
    })
    expect(result.current.message).toBe('Whoop sincronizado.')
  })

  it('muestra consent_required detectado localmente aun en modo silencioso', async () => {
    mocks.consentEnabled = true
    mocks.getMissingConsents.mockResolvedValue(['whoop_biometric'])
    const { result } = renderHook(() => useWhoopSync())

    await act(async () => { await result.current.syncNow({ silent: true }) })

    expect(mocks.syncWhoopNow).not.toHaveBeenCalled()
    expect(result.current.message).toBe(
      'Aceptá el descargo biométrico en Ajustes para reanudar la sincronización.',
    )
  })

  it('muestra consent_required devuelto por el servidor aun en modo silencioso', async () => {
    mocks.syncWhoopNow.mockResolvedValue({
      ok: false, reason: 'error', code: 'consent_required',
    })
    const { result } = renderHook(() => useWhoopSync())

    await act(async () => { await result.current.syncNow({ silent: true }) })

    expect(result.current.message).toBe(
      'Aceptá el descargo biométrico en Ajustes para reanudar la sincronización.',
    )
  })

  it('mantiene el spinner tambien en modo silencioso', async () => {
    let resolveSync: (value: { ok: boolean }) => void = () => {}
    mocks.syncWhoopNow.mockImplementation(() => new Promise((resolve) => {
      resolveSync = resolve as (value: { ok: boolean }) => void
    }))
    const { result } = renderHook(() => useWhoopSync())

    let pending: Promise<unknown> = Promise.resolve()
    await act(async () => {
      pending = result.current.syncNow({ silent: true }) as Promise<unknown>
      await Promise.resolve()
    })
    expect(result.current.syncing).toBe(true)

    await act(async () => {
      resolveSync({ ok: true })
      await pending
    })
    expect(result.current.syncing).toBe(false)
  })
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run src/hooks/__tests__/useWhoopSync.test.ts`
Expected: FAIL **por comportamiento, no por tipos** — `vitest` no typecheckea, así que el argumento `{ silent: true }` simplemente se ignora y `syncNow` corre en modo normal. Los cuatro tests de silencio reciben el mensaje en vez de `null`; el de "no borra un mensaje previo" lo ve en `null` tras el `setMessage(null)` inicial. Los dos de `consent_required` y el del spinner **pasan ya**, porque hoy esos comportamientos son iguales en ambos modos.

- [ ] **Step 3: Extraer la constante del mensaje de consentimiento**

En `src/hooks/useWhoopSync.ts`, arriba de `messageForSyncResult`, agregar:

```ts
const CONSENT_REQUIRED_MESSAGE =
  'Aceptá el descargo biométrico en Ajustes para reanudar la sincronización.'
```

Y dentro de `messageForSyncResult`, reemplazar el literal de la línea 17 por la constante:

```ts
  if (result.code === 'consent_required') return CONSENT_REQUIRED_MESSAGE
```

Dentro de `syncNow` hay **una sola** ocurrencia más de ese literal, en la rama de consentimiento faltante confirmado (línea 97); reemplazarla también por `CONSENT_REQUIRED_MESSAGE`. Los literales de las líneas 89 y 103 son otro mensaje (`No pudimos verificar tu consentimiento biométrico...`) y **no** se tocan.

- [ ] **Step 4: Implementar el modo silencioso**

Agregar el tipo de opciones, junto a `UseWhoopSyncOptions`:

```ts
export interface SyncNowOptions {
  /** Un sync de fondo no escribe carteles; solo `consent_required` se muestra igual. */
  silent?: boolean
}
```

Cambiar la firma de `syncNow` y agregar el publicador de mensajes al inicio del callback, después del guard de vuelo:

```ts
  const syncNow = useCallback(async (
    options: SyncNowOptions = {},
  ): Promise<WhoopSyncResponse | null> => {
    if (syncInFlightRef.current) return null
    syncInFlightRef.current = true

    const silent = options.silent === true
    const showMessage = (text: string, force = false) => {
      if (!mountedRef.current) return
      if (silent && !force) return
      setMessage(text)
    }

    setSyncing(true)
    if (!silent) setMessage(null)
```

Reemplazar cada `if (mountedRef.current) setMessage(...)` del cuerpo por `showMessage(...)`:

- Falla de hidratación de consentimiento (línea ~89) y su `catch` (línea ~103) → `showMessage('No pudimos verificar tu consentimiento biométrico. Revisá tu conexión.')` (transitorio: **sin** `force`).
- Consentimiento faltante confirmado (línea ~97) → `showMessage(CONSENT_REQUIRED_MESSAGE, true)`.
- Resultado del sync (línea 111) → se fuerza solo si el servidor devolvió el código:

```ts
      showMessage(messageForSyncResult(result), result.code === 'consent_required')
```

- `catch` general (líneas 116-119) → mantener `setApiAvailable(false)` bajo `mountedRef` y pasar el texto por `showMessage('No se pudo sincronizar Whoop.')`:

```ts
    } catch (error) {
      console.error('[whoop] sync failed', error)
      if (mountedRef.current) setApiAvailable(false)
      showMessage('No se pudo sincronizar Whoop.')
      return null
```

- [ ] **Step 5: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/hooks/__tests__/useWhoopSync.test.ts`
Expected: PASS — 20 tests (12 de Task 2 + 8 nuevos).

---

### Task 4: Copy honesto del cooldown

**Files:**
- Modify: `src/hooks/useWhoopSync.ts:19-22` (rama `cooldown` de `messageForSyncResult`)
- Test: `src/hooks/__tests__/useWhoopSync.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: nada nuevo hacia otras tareas; cambia el texto que ya devuelve `messageForSyncResult`.

**Contexto para quien implementa.** Hoy el cooldown dice `Espera 287s para volver a sincronizar.`, que se lee como error. Después de Task 5 va a aparecer seguido, porque el auto-sync deja el botón en cooldown 5 min.

Decir "ya está al día" es **exacto**, no una cortesía: el cooldown se apoya en `last_manual_sync_at`, y en el camino de error `runWhoopSync` escribe `lastSyncAt` **sin** tocar `lastManualSyncAt` (`whoopSync.ts:139-142`). Estar en cooldown implica un sync manual **exitoso** hace menos de 5 minutos.

El redondeo va **hacia arriba** para no invitar a reintentar antes de que venza el cooldown: 287 s son "5 min", no "4 min".

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al mismo `describe`:

```tsx
  it.each([
    [300_000, 'Whoop ya está al día. Puedes volver a sincronizar en 5 min.'],
    [287_000, 'Whoop ya está al día. Puedes volver a sincronizar en 5 min.'],
    [60_000, 'Whoop ya está al día. Puedes volver a sincronizar en 1 min.'],
    [59_000, 'Whoop ya está al día. Puedes volver a sincronizar en 59s.'],
    [1_000, 'Whoop ya está al día. Puedes volver a sincronizar en 1s.'],
  ])('formatea el cooldown de %ims redondeando hacia arriba', async (retryAfterMs, expected) => {
    mocks.syncWhoopNow.mockResolvedValue({ ok: false, reason: 'cooldown', retryAfterMs })
    const { result } = renderHook(() => useWhoopSync())

    await act(async () => { await result.current.syncNow() })

    expect(result.current.message).toBe(expected)
  })
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run src/hooks/__tests__/useWhoopSync.test.ts -t 'formatea el cooldown'`
Expected: FAIL — recibe `Espera 300s para volver a sincronizar.` y variantes.

- [ ] **Step 3: Implementar el formateo**

En `src/hooks/useWhoopSync.ts`, agregar arriba de `messageForSyncResult`:

```ts
/** Redondea hacia arriba: mostrar menos tiempo del real invita a reintentar antes de tiempo. */
function formatRetryDelay(retryAfterMs: number | undefined): string {
  const seconds = Math.max(1, Math.ceil((retryAfterMs ?? 0) / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.ceil(seconds / 60)} min`
}
```

Y reemplazar la rama `cooldown` (líneas 19-22) por:

```ts
  if (result.reason === 'cooldown') {
    return `Whoop ya está al día. Puedes volver a sincronizar en ${formatRetryDelay(result.retryAfterMs)}.`
  }
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/hooks/__tests__/useWhoopSync.test.ts`
Expected: PASS — 25 tests (20 de Task 3 + 5 que expande el `it.each`).

---

### Task 5: Efecto `autoSync` en el hook

**Files:**
- Modify: `src/hooks/useWhoopSync.ts:10-12` (`UseWhoopSyncOptions`), y agregar el efecto después de la definición de `syncNow`
- Test: `src/hooks/__tests__/useWhoopSync.test.ts`

**Interfaces:**
- Consumes: `shouldAutoSyncWhoop` de Task 1; `syncNow({ silent: true })` de Task 3; la identidad estable de `syncNow` de Task 2.
- Produces: `useWhoopSync({ autoSync })`. Task 6 pasa `autoSync: canConnectWhoop`.

**Contexto para quien implementa.** Tres reglas que no son negociables:

1. **La decisión usa el valor que retorna `await refreshStatus()`**, nunca el `status` de React, que en ese punto todavía puede ser el del render anterior.
2. **`refreshStatus()` que devuelve `null` corta ahí.** No hay un `connected` confiable y un segundo request no aporta señal; el caso ya queda registrado por `apiAvailable: false` y el `console.warn` que `refreshStatus` ya hace.
3. **Las dependencias son `[autoSync, refreshStatus, syncNow]`, las tres estables**, así que el efecto corre exactamente una vez por activación. `autoSync` por sí solo captura todas las transiciones de scope que importan, porque es `canConnectWhoop`: self→gestionado lo baja a `false`, gestionado→self lo sube a `true`, y entre dos gestionados se queda en `false`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al mismo `describe`. Nota: el `beforeEach` existente ya deja `getWhoopStatus` devolviendo `{ connected: true, lastSyncAt: null, lastSyncStatus: null, scopes: [] }`, que la política considera **stale**.

```tsx
  // El efecto encadena refreshStatus -> shouldAutoSyncWhoop -> syncNow, o sea
  // varias vueltas de microtasks. Un flush por macrotask las drena todas.
  const flushEffects = () => act(async () => {
    await new Promise((resolve) => { setTimeout(resolve, 0) })
  })

  const freshStatus = {
    connected: true,
    lastSyncAt: new Date(Date.now() - 60_000).toISOString(),
    lastSyncStatus: 'ok' as const,
    scopes: [],
  }

  it('sincroniza en silencio al montar cuando el estado esta viejo', async () => {
    const { result } = renderHook(() => useWhoopSync({ autoSync: true }))
    await flushEffects()

    // Dos: el preflight del efecto y el refresh que syncNow hace al terminar.
    expect(mocks.getWhoopStatus).toHaveBeenCalledTimes(2)
    expect(mocks.syncWhoopNow).toHaveBeenCalledOnce()
    expect(result.current.message).toBeNull()
  })

  it('no sincroniza al montar cuando el estado esta fresco, pero si lo refresca', async () => {
    mocks.getWhoopStatus.mockResolvedValue(freshStatus)

    renderHook(() => useWhoopSync({ autoSync: true }))
    await flushEffects()

    expect(mocks.getWhoopStatus).toHaveBeenCalledOnce()
    expect(mocks.syncWhoopNow).not.toHaveBeenCalled()
  })

  it('vuelve a sincronizar cuando el ultimo sync es reciente pero fallo', async () => {
    mocks.getWhoopStatus.mockResolvedValue({ ...freshStatus, lastSyncStatus: 'error' })

    renderHook(() => useWhoopSync({ autoSync: true }))
    await flushEffects()

    expect(mocks.syncWhoopNow).toHaveBeenCalledOnce()
  })

  it('no hace nada cuando autoSync esta apagado', async () => {
    renderHook(() => useWhoopSync({ autoSync: false }))
    await flushEffects()

    expect(mocks.getWhoopStatus).not.toHaveBeenCalled()
    expect(mocks.syncWhoopNow).not.toHaveBeenCalled()
  })

  it('no intenta sincronizar cuando el status falla', async () => {
    mocks.getWhoopStatus.mockRejectedValue(new Error('offline'))

    renderHook(() => useWhoopSync({ autoSync: true }))
    await flushEffects()

    expect(mocks.syncWhoopNow).not.toHaveBeenCalled()
  })

  it('cancela el sync si autoSync se apaga mientras el status esta en vuelo', async () => {
    let resolveStatus: (value: unknown) => void = () => {}
    mocks.getWhoopStatus.mockImplementation(() => new Promise((resolve) => { resolveStatus = resolve }))

    const { rerender } = renderHook(
      ({ autoSync }: { autoSync: boolean }) => useWhoopSync({ autoSync }),
      { initialProps: { autoSync: true } },
    )

    rerender({ autoSync: false })
    resolveStatus({ connected: true, lastSyncAt: null, lastSyncStatus: null, scopes: [] })
    await flushEffects()

    expect(mocks.syncWhoopNow).not.toHaveBeenCalled()
  })

  it('no dispara un request por render con un onReadinessPulled sin memoizar', async () => {
    // Status fresco a proposito: sin sync de por medio, cualquier GET extra solo
    // puede venir de que el efecto se re-ejecuto, que es lo que se esta midiendo.
    mocks.getWhoopStatus.mockResolvedValue(freshStatus)

    const { rerender } = renderHook(
      () => useWhoopSync({ autoSync: true, onReadinessPulled: () => {} }),
    )
    await flushEffects()

    rerender()
    rerender()
    rerender()
    await flushEffects()

    expect(mocks.getWhoopStatus).toHaveBeenCalledOnce()
  })
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run src/hooks/__tests__/useWhoopSync.test.ts -t 'autoSync|al montar|status en vuelo|sin memoizar'`
Expected: FAIL **por comportamiento, no por tipos** — `vitest` no typecheckea, así que la opción `autoSync` se ignora en silencio y el efecto no existe: `getWhoopStatus` nunca se llama sola. Los tres tests que esperan que **no** pase nada (`autoSync` apagado, status fallido, cancelación) **pasan ya** de forma trivial.

- [ ] **Step 3: Implementar el efecto**

En `src/hooks/useWhoopSync.ts`, agregar el import:

```ts
import { shouldAutoSyncWhoop } from '../services/readiness/whoopAutoSync'
```

Extender las opciones:

```ts
export interface UseWhoopSyncOptions {
  onReadinessPulled?: () => Promise<void> | void
  /** Dispara un sync silencioso al montar si el estado remoto no esta fresco. */
  autoSync?: boolean
}
```

Leer el flag junto a `onReadinessPulled` (línea ~50):

```ts
  const autoSync = options.autoSync === true
```

Y agregar el efecto **después** de la definición de `syncNow`, para que `syncNow` ya esté declarado:

```ts
  useEffect(() => {
    if (!autoSync) return
    let cancelled = false

    void (async () => {
      const nextStatus = await refreshStatus()
      if (cancelled || nextStatus === null) return

      const stale = shouldAutoSyncWhoop({
        connected: nextStatus.connected,
        lastSyncAt: nextStatus.lastSyncAt,
        lastSyncStatus: nextStatus.lastSyncStatus,
        now: Date.now(),
      })
      if (!stale || cancelled) return

      await syncNow({ silent: true })
    })()

    return () => { cancelled = true }
  }, [autoSync, refreshStatus, syncNow])
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/hooks/__tests__/useWhoopSync.test.ts`
Expected: PASS — 32 tests (25 de Task 4 + 7 nuevos).

---

### Task 6: Cableado en `Dashboard` y regresión completa

**Files:**
- Modify: `src/pages/Dashboard.tsx:79-85` (destructuring del hook), `:107-133` (efecto de readiness)

**Interfaces:**
- Consumes: `useWhoopSync({ autoSync })` de Task 5.
- Produces: nada.

**Contexto para quien implementa.** El hook ahora se encarga del `GET whoop-status`, así que el Dashboard deja de pedirlo por su cuenta. En el caso fresco el conteo de requests es **idéntico** al de hoy; en el caso stale se suman el `POST whoop-sync` y el `refreshStatus()` que `syncNow` ya hacía. `canConnectWhoop` (línea 60) ya es el guard self-only: **no inventar uno nuevo**.

- [ ] **Step 1: Pasar el flag y soltar `refreshStatus`**

En `src/pages/Dashboard.tsx`, reemplazar el bloque de las líneas 79-85 por:

```tsx
  const {
    message: whoopSyncMessage,
    status: whoopStatus,
    syncing: whoopSyncing,
    syncNow: syncWhoopNow,
  } = useWhoopSync({ onReadinessPulled: loadLocalReadiness, autoSync: canConnectWhoop })
```

- [ ] **Step 2: Limpiar el efecto de readiness**

Reemplazar el efecto de las líneas 107-133 por:

```tsx
  useEffect(() => {
    let cancelled = false

    async function loadWhoopReadiness() {
      if (!activeAthleteId) {
        if (!cancelled) setReadiness(undefined)
        return
      }

      // Baja lo que ya este en readiness_daily. El fetch fresco contra Whoop lo
      // dispara el auto-sync del hook cuando el estado remoto no esta fresco.
      await pullReadiness().catch(() => undefined)
      const nextReadiness = await getLocalReadinessForDate(activeAthleteId, today)

      if (cancelled) return
      setReadiness(nextReadiness)
    }

    void loadWhoopReadiness()

    return () => {
      cancelled = true
    }
  }, [activeAthleteId, today])
```

Desaparecen la guarda `if (!canConnectWhoop) return`, la llamada a `refreshWhoopStatus()` y esas dos dependencias. El comentario viejo ("a fresh Whoop fetch stays behind the manual button") ya no describe el comportamiento y por eso se reescribe.

- [ ] **Step 3: Verificar tipos y lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS sin errores. En particular, ninguna variable sin usar: `refreshWhoopStatus` ya no se desestructura.

- [ ] **Step 4: Regresión completa**

Run: `npm run lint && npm test && npm run build`
Expected: PASS. La suite parte de 2900 tests en 372 archivos; deben quedar **2938 en 373 archivos** — 38 nuevos: 13 en `whoopAutoSync.test.ts` (único archivo nuevo) y 25 sumados a `useWhoopSync.test.ts`, que ya existía. Si el número no cuadra, contar cuáles faltan antes de seguir.

- [ ] **Step 5: Smoke manual en dev**

Run: `npm run dev`, entrar con la cuenta del owner (que tiene Whoop conectado) y verificar:

1. Al cargar el Inicio, el botón de la tarjeta de Readiness pasa por "Sincronizando" solo y los datos se actualizan **sin apretar nada**.
2. No aparece ningún cartel de texto bajo la tarjeta durante ese sync.
3. Apretar "Sincronizar" enseguida muestra `Whoop ya está al día. Puedes volver a sincronizar en 5 min.`
4. Recargar la página dentro de los 30 min **no** dispara un segundo sync (verificable en la pestaña Network: hay `whoop-status`, no hay `whoop-sync`).
5. Cambiar a un atleta gestionado desde el switcher y volver al Inicio: **no** dispara sync.

Anotar el resultado; si algo de esto no se cumple, parar y reportar antes de dar la tarea por cerrada.

**Resultado de ejecución (2026-08-05):** typecheck, lint, **2938/2938 tests**
en 373 archivos y build pasaron. El smoke autenticado quedó pendiente: el
navegador local abrió la landing sin sesión y no había otra sesión de RallyIQ
disponible para reutilizar. No se inició OAuth ni se solicitaron credenciales.

---

## Notas de cierre

- **Commits: los hace el owner**, confirmado para esta entrega. Ningún paso ejecuta `git add` ni `git commit`; el trabajo se entrega con el árbol verificado y el owner revisa el diff. Al terminar son 5 archivos tocados: 3 de producción, 1 de test nuevo (`whoopAutoSync.test.ts`) y 1 de test extendido (`useWhoopSync.test.ts`). Ningún renombre.
- **Documentación:** si el bloque se da por cerrado, corresponde una entrada en `CLAUDE.md` y en `PROJECT_REVIEW_AND_ROADMAP.md` describiendo el auto-sync, la política de frescura con `lastSyncStatus` y la consecuencia aceptada de reintentar tras error. Es trabajo del owner decidir cuándo.
- **Fuera de alcance, declarado en el spec §8:** sync por `visibilitychange` o por intervalo, cambiar la frecuencia del cron (sigue en 1×/día a las 09:00 UTC), cooldown separado server-side con migración `019`, auto-sync para atletas gestionados y auto-sync desde Ajustes.
