# Whoop Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ⚠️ **DIFERIDO + coordinación Dexie (2026-06-22):** este plan está en pausa; se prioriza
> Athlete Scope Foundation (Coach Mode), que toma Dexie **v13**. Cuando se retome Whoop,
> el store `readinessDaily` debe implementarse como **v14** (todas las menciones de "v13"
> en este plan = "v14" al ejecutar).

**Goal:** Integrar Whoop como capa premium de contexto fisiológico (recovery, sueño, strain) para un piloto individual: tarjeta resumen en el dashboard, prefill editable del check-in diario y contexto pasivo para el coach — sin modificar planes automáticamente.

**Architecture:** Todo lo sensible (OAuth, tokens cifrados, fetch a Whoop, datos crudos) vive server-side en Netlify Functions con service-role de Supabase y RLS que niega acceso del cliente a las tablas de credenciales/raw. El cliente solo lee el resumen diario `readiness_daily` (RLS por `auth.uid()`), lo replica a Dexie y lo usa para la tarjeta, el prefill y el contexto del coach. Ingesta por cron UTC idempotente (últimos 7 días) + botón "Sincronizar ahora" con cooldown.

**Tech Stack:** TypeScript, Netlify Functions, Supabase (Postgres + RLS), Web Crypto (AES-256-GCM), Dexie v13, React, Vitest, Whoop API.

**Spec:** `docs/superpowers/specs/2026-06-21-whoop-integration-design.md`

## Global Constraints

- Piloto individual: todo scopeado a `user_id` (sin `athlete_id` todavía). Deuda de migración a `athlete_id` documentada, no se resuelve aquí.
- Secretos SOLO server-side. Ninguna credencial Whoop en `VITE_*`.
- `whoop_connections`, `whoop_oauth_states` y `biometric_readings` son **server-only estrictos**: RLS sin políticas para `authenticated`/`anon`. El cliente nunca los lee.
- `readiness_daily` es la única tabla Whoop legible por el cliente (RLS por `auth.uid()`).
- Cifrado de tokens: **AES-256-GCM**, clave `WHOOP_TOKEN_ENC_KEY` (base64, 32 bytes), IV (12 bytes) + auth tag por token, campo `key_version`.
- OAuth `state`: nonce crypto-random, single-use, expiración ~10 min, bindeado al `user_id`, en tabla separada `whoop_oauth_states`.
- Cron de sync en **UTC**; sync idempotente de **últimos 7 días** (no hay fuente de timezone del atleta).
- Sync manual con **cooldown server-side** (mínimo 5 min) + error amable con `retry_after`.
- Coach: **contexto pasivo**. El readiness entra al prompt y a alertas suaves; NUNCA modifica planes/sesiones.
- Gate legal (consentimiento biométrico + privacidad + borrado completo) cerrado antes de exponer la UI (Tasks 13-17) a usuarios reales.
- Verificación de cierre por tarea: `npm run lint && npm test && npm run build` verdes (más la migración SQL probada en staging para Task 1).
- Reusar helpers existentes de `netlify/functions/_shared/planGenerationShared.ts`: `resolveAuthContext`, `getBearerToken`, `json`, `getSupabaseUrl`, `withTimeout`.

**⚠️ Política de commits:** Igual que los planes previos del repo, el owner hace los commits. **NO ejecutar `git commit` ni `git add` dentro de las tasks.** Tratar los pasos "Commit" como no-op; dejar los cambios staged-pendientes para revisión consolidada del owner.

---

## File Structure

```
docs/legal/
  descargo-whoop.md                              [NEW: copy de consentimiento biométrico]

supabase/
  007_whoop_integration.sql                      [NEW: 4 tablas + RLS]

netlify/functions/
  whoop-oauth-start.ts                           [NEW: inicia OAuth, devuelve URL]
  whoop-oauth-callback.ts                        [NEW: callback de Whoop]
  whoop-status.ts                                [NEW: estado de conexión para UI]
  whoop-sync.ts                                  [NEW: sync manual + cron]
  _shared/
    tokenCrypto.ts                               [NEW: AES-256-GCM]
    whoopSupabase.ts                             [NEW: data-access service-role]
    whoopClient.ts                               [NEW: wrapper Whoop API + refresh]
    whoopNormalize.ts                            [NEW: Whoop -> tablas (puro)]
    whoopSync.ts                                 [NEW: runWhoopSync (puro)]
    whoopOAuth.ts                                [NEW: buildAuthorizeUrl + validateState (puro)]
    __tests__/
      tokenCrypto.test.ts                        [NEW]
      whoopClient.test.ts                        [NEW]
      whoopNormalize.test.ts                     [NEW]
      whoopSync.test.ts                          [NEW]
      whoopOAuth.test.ts                         [NEW]

src/types/
  index.ts                                       [MODIFY: +ReadinessDaily, +DayLog.prefillSource]

src/db/
  db.ts                                          [MODIFY: v13 store readinessDaily]

src/services/readiness/
  prefillDayLog.ts                               [NEW: reducer puro]
  readinessBands.ts                              [NEW: banda de color recovery]
  whoopApi.ts                                    [NEW: cliente de las functions]
  pullReadiness.ts                               [NEW: lee readiness_daily -> Dexie]
  __tests__/
    prefillDayLog.test.ts                        [NEW]
    readinessBands.test.ts                        [NEW]

src/components/readiness/
  ReadinessCard.tsx                              [NEW]
  __tests__/ReadinessCard.test.tsx               [NEW]

src/components/settings/
  WhoopConnection.tsx                            [NEW]

src/services/appMaintenance.ts                   [MODIFY: limpiar readinessDaily en wipe]
src/services/dataExport.ts                       [MODIFY: incluir readinessDaily en backup]
src/services/ai/promptBuilder.ts                 [MODIFY: línea de readiness en contexto]
src/services/actionAlerts.ts                     [MODIFY: alerta suave banda roja]
src/pages/DayDetail.tsx                          [MODIFY: prefill editable]
src/pages/Dashboard (o donde viva)               [MODIFY: montar ReadinessCard]
netlify.toml                                     [MODIFY: schedule de whoop-sync]
```

---

## Task 0: Track 0 — Setup Whoop App, env vars, verificación de API y copy legal

**Bloqueante. Sin código de runtime; el deliverable es documentación verificada + secrets configurados.** Los tasks de OAuth (5-7) y sync (8-11) no se cierran hasta que esto esté hecho.

**Files:**
- Create: `docs/legal/descargo-whoop.md`

- [ ] **Step 1: Verificar la API oficial de Whoop**

Abrir https://developer.whoop.com/ y confirmar (anotar en el PR/notas del task):
- Nombres exactos de scopes para recovery, sleep, cycles, profile.
- Endpoints REST de recovery, sleep y cycles, su paginación y formato de respuesta.
- Rate limits y comportamiento del refresh token (¿rota el refresh token al refrescar?).
- URL del endpoint de OAuth authorize y de token.

Si algún nombre difiere de lo asumido en el spec, ajustar las constantes correspondientes
en Tasks 5, 8 (son la única fuente de esos strings).

- [ ] **Step 2: Crear la Whoop Developer App**

En el dashboard de Whoop:
- Crear la app.
- Configurar los scopes confirmados en Step 1.
- Registrar dos redirect URIs (allowlist): dev (`http://localhost:8888/.netlify/functions/whoop-oauth-callback` o el puerto de `netlify dev`) y prod (`https://<dominio-prod>/.netlify/functions/whoop-oauth-callback`).
- Obtener `client_id` y `client_secret`.

- [ ] **Step 3: Generar la clave de cifrado**

Generar una clave base64 de 32 bytes (256-bit):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

- [ ] **Step 4: Configurar env vars server-side en Netlify (y `.env` local para `netlify dev`)**

```
WHOOP_CLIENT_ID=...
WHOOP_CLIENT_SECRET=...
WHOOP_REDIRECT_URI=https://<dominio>/.netlify/functions/whoop-oauth-callback
WHOOP_AUTHORIZE_URL=<de Step 1>
WHOOP_TOKEN_URL=<de Step 1>
WHOOP_API_BASE=<de Step 1>
WHOOP_TOKEN_ENC_KEY=<base64 de Step 3>
```

Confirmar que `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya existen (los usa el async plan builder); si no, agregarlos. **Verificar que NINGUNA empiece con `VITE_`.**

- [ ] **Step 5: Redactar el copy legal mínimo**

Create `docs/legal/descargo-whoop.md` con: qué datos biométricos se recogen (recovery, HRV, RHR, strain, sueño), para qué se usan (contexto del coach + prefill del check-in, nunca diagnóstico médico), dónde se guardan (cifrados, server-side), cómo desconectar y cómo borrar. Enlazar este texto desde `docs/legal/politica-de-privacidad.md` (agregar sección "Datos de wearables (Whoop)").

- [ ] **Step 6: Commit** (no-op por política de commits del repo)

---

## Task 1: Migración SQL — tablas Whoop + RLS

**Files:**
- Create: `supabase/007_whoop_integration.sql`

**Interfaces:**
- Produces: tablas `whoop_connections`, `whoop_oauth_states`, `biometric_readings`, `readiness_daily`. Solo `readiness_daily` tiene políticas RLS para el cliente.

- [ ] **Step 1: Escribir la migración**

Create `supabase/007_whoop_integration.sql`:

```sql
-- Whoop integration (piloto individual, scope por user_id).
-- whoop_connections, whoop_oauth_states y biometric_readings son SERVER-ONLY:
-- RLS habilitado SIN políticas para authenticated/anon => solo service-role accede.
-- readiness_daily es legible/escribible por el dueño (auth.uid()).

create table if not exists public.whoop_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  key_version smallint not null default 1,
  expires_at timestamptz not null,
  whoop_user_id text null,
  scopes text null,
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz null,
  last_manual_sync_at timestamptz null,
  last_sync_status text null check (last_sync_status in ('ok', 'error'))
);

create table if not exists public.whoop_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.biometric_readings (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null,
  metric text not null,
  value numeric null,
  recorded_at timestamptz not null,
  raw_id text null
);
create index if not exists biometric_readings_user_idx on public.biometric_readings (user_id, recorded_at);

create table if not exists public.readiness_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  date text not null,
  recovery_score numeric null,
  hrv_ms numeric null,
  rhr_bpm numeric null,
  strain numeric null,
  sleep_hours numeric null,
  sleep_performance numeric null,
  source text not null default 'whoop',
  updated_at bigint not null,
  primary key (user_id, date)
);

-- RLS: server-only tables (enabled, no client policies)
alter table public.whoop_connections enable row level security;
alter table public.whoop_oauth_states enable row level security;
alter table public.biometric_readings enable row level security;

-- RLS: readiness_daily readable/writable by owner
alter table public.readiness_daily enable row level security;
create policy readiness_daily_select on public.readiness_daily
  for select using (auth.uid() = user_id);
create policy readiness_daily_insert on public.readiness_daily
  for insert with check (auth.uid() = user_id);
create policy readiness_daily_update on public.readiness_daily
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy readiness_daily_delete on public.readiness_daily
  for delete using (auth.uid() = user_id);
```

- [ ] **Step 2: Aplicar en un proyecto Supabase de staging**

Correr la migración en staging (no en prod del owner). Verificar manualmente:
- Como usuario autenticado, `select * from readiness_daily` solo devuelve filas propias.
- Como usuario autenticado, `select * from whoop_connections` devuelve **0 filas / error de permiso** (sin política).

Anotar el resultado del smoke en las notas del task.

- [ ] **Step 3: Commit** (no-op)

---

## Task 2: `tokenCrypto.ts` — cifrado AES-256-GCM

**Files:**
- Create: `netlify/functions/_shared/tokenCrypto.ts`
- Test: `netlify/functions/_shared/__tests__/tokenCrypto.test.ts`

**Interfaces:**
- Produces:
  - `encryptToken(plaintext: string, keyB64?: string): string` — devuelve `"<ivB64>.<tagB64>.<cipherB64>"`.
  - `decryptToken(encoded: string, keyB64?: string): string`.
  - `CURRENT_KEY_VERSION: number` (= 1).
  - `decryptTokenForVersion(encoded: string, keyVersion: number): string`.

- [ ] **Step 1: Write the failing test**

Create `netlify/functions/_shared/__tests__/tokenCrypto.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { encryptToken, decryptToken, CURRENT_KEY_VERSION } from '../tokenCrypto'
import { randomBytes } from 'node:crypto'

const KEY = randomBytes(32).toString('base64')

describe('tokenCrypto', () => {
  beforeEach(() => {
    process.env.WHOOP_TOKEN_ENC_KEY = KEY
  })

  it('round-trips a token', () => {
    const secret = 'whoop_access_token_abc123'
    const enc = encryptToken(secret)
    expect(enc).not.toContain(secret)
    expect(decryptToken(enc)).toBe(secret)
  })

  it('produces a unique IV per call (ciphertext differs)', () => {
    const a = encryptToken('same')
    const b = encryptToken('same')
    expect(a).not.toBe(b)
    expect(decryptToken(a)).toBe('same')
    expect(decryptToken(b)).toBe('same')
  })

  it('fails to decrypt a tampered ciphertext', () => {
    const enc = encryptToken('tamper-me')
    const [iv, tag, cipher] = enc.split('.')
    const broken = [iv, tag, Buffer.from('00' + cipher, 'base64').toString('base64')].join('.')
    expect(() => decryptToken(broken)).toThrow()
  })

  it('exposes a current key version', () => {
    expect(CURRENT_KEY_VERSION).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/_shared/__tests__/tokenCrypto.test.ts`
Expected: FAIL — module `../tokenCrypto` not found.

- [ ] **Step 3: Implement `tokenCrypto.ts`**

Create `netlify/functions/_shared/tokenCrypto.ts`:

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export const CURRENT_KEY_VERSION = 1

const IV_BYTES = 12

function resolveKey(keyB64?: string): Buffer {
  const raw = keyB64 ?? process.env.WHOOP_TOKEN_ENC_KEY
  if (!raw) throw new Error('WHOOP_TOKEN_ENC_KEY is not configured')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('WHOOP_TOKEN_ENC_KEY must be 32 bytes (base64)')
  return key
}

export function encryptToken(plaintext: string, keyB64?: string): string {
  const key = resolveKey(keyB64)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.')
}

export function decryptToken(encoded: string, keyB64?: string): string {
  const key = resolveKey(keyB64)
  const [ivB64, tagB64, cipherB64] = encoded.split('.')
  if (!ivB64 || !tagB64 || !cipherB64) throw new Error('Malformed encrypted token')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(cipherB64, 'base64')), decipher.final()]).toString('utf8')
}

// Rotation hook: today only version 1 exists. Future versions resolve a
// different key by version before decrypting.
export function decryptTokenForVersion(encoded: string, keyVersion: number): string {
  if (keyVersion !== CURRENT_KEY_VERSION) {
    throw new Error(`Unsupported key_version ${keyVersion}`)
  }
  return decryptToken(encoded)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run netlify/functions/_shared/__tests__/tokenCrypto.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit** (no-op)

---

## Task 3: Dexie v13 + tipos `ReadinessDaily` y `DayLog.prefillSource`

**Files:**
- Modify: `src/types/index.ts` (DayLog ~342; nuevo tipo cerca)
- Modify: `src/db/db.ts:170-184`
- Test: `src/db/__tests__/readinessDailyStore.test.ts` (Create)

**Interfaces:**
- Produces:
  - `interface ReadinessDaily { id: string; date: string; recoveryScore?: number; hrvMs?: number; rhrBpm?: number; strain?: number; sleepHours?: number; sleepPerformance?: number; source: string; updatedAt: number }`
  - `DayLog.prefillSource?: Partial<Record<'sleepHours' | 'sleepQuality' | 'energyLevel', 'whoop'>>`
  - `db.readinessDaily` table.

- [ ] **Step 1: Write the failing test**

Create `src/db/__tests__/readinessDailyStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db'

describe('readinessDaily store (v13)', () => {
  beforeEach(async () => {
    await db.readinessDaily.clear()
  })

  it('stores and reads a readiness row by date', async () => {
    await db.readinessDaily.put({
      id: 'whoop:2026-06-21',
      date: '2026-06-21',
      recoveryScore: 28,
      sleepHours: 5.2,
      sleepPerformance: 61,
      strain: 14.1,
      source: 'whoop',
      updatedAt: Date.now(),
    })
    const row = await db.readinessDaily.where('date').equals('2026-06-21').first()
    expect(row?.recoveryScore).toBe(28)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/__tests__/readinessDailyStore.test.ts`
Expected: FAIL — `db.readinessDaily` is undefined.

- [ ] **Step 3: Add the type to `src/types/index.ts`**

Add near `DayLog` (the `export interface DayLog` block):

```typescript
export interface ReadinessDaily {
  id: string               // synthetic, e.g. "whoop:YYYY-MM-DD"
  date: string             // ISO "YYYY-MM-DD"
  recoveryScore?: number   // 0-100
  hrvMs?: number
  rhrBpm?: number
  strain?: number
  sleepHours?: number
  sleepPerformance?: number // 0-100
  source: string           // 'whoop'
  updatedAt: number        // epoch ms
}
```

And extend `DayLog` by adding this field inside the existing interface:

```typescript
  // Which check-in fields were prefilled from Whoop (cleared when edited by hand).
  prefillSource?: Partial<Record<'sleepHours' | 'sleepQuality' | 'energyLevel', 'whoop'>>
```

- [ ] **Step 4: Add the Dexie v13 migration in `src/db/db.ts`**

After the `this.version(12).stores({...})` block (around line 184, before the closing of the constructor), add:

```typescript
    this.version(13).stores({
      readinessDaily: 'id, &date, updatedAt',
    })
```

And declare the table property alongside the other `Dexie.Table` declarations at the top of the class (follow the existing style, e.g. near `dayLogs!: Table<DayLog, string>`):

```typescript
  readinessDaily!: Table<ReadinessDaily, string>
```

Add `ReadinessDaily` to the type import from `../types` at the top of `db.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/db/__tests__/readinessDailyStore.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full lint/build to confirm no type breakage**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 7: Commit** (no-op)

---

## Task 4: `whoopSupabase.ts` — data-access service-role (puro vía cliente inyectable)

**Files:**
- Create: `netlify/functions/_shared/whoopSupabase.ts`
- Test: `netlify/functions/_shared/__tests__/whoopSupabase.test.ts`

**Interfaces:**
- Consumes: `encryptToken`/`decryptTokenForVersion` (Task 2), `CURRENT_KEY_VERSION`.
- Produces (all take an injected supabase-like client as first arg for testability):
  - `type WhoopDb` minimal client interface.
  - `insertOAuthState(db, { state, userId, expiresAt })`
  - `consumeOAuthState(db, state): Promise<{ userId: string } | null>` (single-use: deletes after read; null if missing/expired)
  - `upsertConnection(db, conn: StoredConnection)`
  - `getConnection(db, userId): Promise<StoredConnection | null>` (decrypts tokens)
  - `setSyncResult(db, userId, { lastSyncAt, lastManualSyncAt?, status })`
  - `deleteAllWhoopData(db, userId)` (connection + states + readings + readiness)
  - `upsertReadiness(db, userId, rows: ReadinessRow[])`
  - `interface StoredConnection { userId; accessToken; refreshToken; keyVersion; expiresAt; whoopUserId?; scopes?; lastManualSyncAt? }`
  - `interface ReadinessRow { date; recoveryScore?; hrvMs?; rhrBpm?; strain?; sleepHours?; sleepPerformance? }`

- [ ] **Step 1: Write the failing test**

Create `netlify/functions/_shared/__tests__/whoopSupabase.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { consumeOAuthState, upsertConnection, getConnection } from '../whoopSupabase'

process.env.WHOOP_TOKEN_ENC_KEY = randomBytes(32).toString('base64')

// Minimal in-memory fake of the subset of supabase-js we use.
function makeFakeDb(initial: Record<string, any[]> = {}) {
  const tables: Record<string, any[]> = { whoop_oauth_states: [], whoop_connections: [], ...initial }
  return {
    tables,
    from(table: string) {
      const rows = tables[table]
      const api: any = {
        _filters: [] as Array<(r: any) => boolean>,
        select() { return api },
        eq(col: string, val: any) { api._filters.push((r: any) => r[col] === val); return api },
        async maybeSingle() { return { data: rows.find(r => api._filters.every(f => f(r))) ?? null, error: null } },
        async upsert(row: any) {
          const idx = rows.findIndex(r => r.user_id === row.user_id && (r.date === undefined || r.date === row.date))
          if (idx >= 0) rows[idx] = { ...rows[idx], ...row }
          else rows.push(row)
          return { error: null }
        },
        async insert(row: any) { rows.push(row); return { error: null } },
        delete() { return api },
        async then() { /* not used */ },
      }
      // delete().eq() chain resolves by removing matching rows
      api.delete = () => ({
        eq(col: string, val: any) {
          tables[table] = rows.filter(r => r[col] !== val)
          return { error: null }
        },
      })
      return api
    },
  }
}

describe('whoopSupabase', () => {
  it('upserts and reads back a connection, decrypting tokens', async () => {
    const db = makeFakeDb()
    await upsertConnection(db as any, {
      userId: 'u1', accessToken: 'acc', refreshToken: 'ref',
      keyVersion: 1, expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    })
    const conn = await getConnection(db as any, 'u1')
    expect(conn?.accessToken).toBe('acc')
    expect(conn?.refreshToken).toBe('ref')
    // stored ciphertext must not equal plaintext
    expect(db.tables.whoop_connections[0].access_token).not.toBe('acc')
  })

  it('consumeOAuthState returns userId once then deletes', async () => {
    const db = makeFakeDb({ whoop_oauth_states: [
      { state: 's1', user_id: 'u1', expires_at: new Date(Date.now() + 60_000).toISOString() },
    ] })
    const first = await consumeOAuthState(db as any, 's1')
    expect(first?.userId).toBe('u1')
    const second = await consumeOAuthState(db as any, 's1')
    expect(second).toBeNull()
  })

  it('consumeOAuthState returns null for expired state', async () => {
    const db = makeFakeDb({ whoop_oauth_states: [
      { state: 's2', user_id: 'u1', expires_at: new Date(Date.now() - 1000).toISOString() },
    ] })
    expect(await consumeOAuthState(db as any, 's2')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopSupabase.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `whoopSupabase.ts`**

Create `netlify/functions/_shared/whoopSupabase.ts`:

```typescript
import { encryptToken, decryptTokenForVersion, CURRENT_KEY_VERSION } from './tokenCrypto'

// Minimal structural type of the supabase-js client subset we use.
export interface WhoopDb {
  from(table: string): any
}

export interface StoredConnection {
  userId: string
  accessToken: string
  refreshToken: string
  keyVersion: number
  expiresAt: string
  whoopUserId?: string | null
  scopes?: string | null
  lastManualSyncAt?: string | null
}

export interface ReadinessRow {
  date: string
  recoveryScore?: number | null
  hrvMs?: number | null
  rhrBpm?: number | null
  strain?: number | null
  sleepHours?: number | null
  sleepPerformance?: number | null
}

export async function insertOAuthState(
  db: WhoopDb,
  input: { state: string; userId: string; expiresAt: string },
): Promise<void> {
  const { error } = await db.from('whoop_oauth_states').insert({
    state: input.state,
    user_id: input.userId,
    expires_at: input.expiresAt,
  })
  if (error) throw new Error(`insertOAuthState: ${error.message}`)
}

export async function consumeOAuthState(db: WhoopDb, state: string): Promise<{ userId: string } | null> {
  const { data } = await db.from('whoop_oauth_states').select().eq('state', state).maybeSingle()
  if (!data) return null
  // single-use: always delete what we found
  await db.from('whoop_oauth_states').delete().eq('state', state)
  if (new Date(data.expires_at).getTime() < Date.now()) return null
  return { userId: data.user_id }
}

export async function upsertConnection(db: WhoopDb, conn: StoredConnection): Promise<void> {
  const { error } = await db.from('whoop_connections').upsert({
    user_id: conn.userId,
    access_token: encryptToken(conn.accessToken),
    refresh_token: encryptToken(conn.refreshToken),
    key_version: CURRENT_KEY_VERSION,
    expires_at: conn.expiresAt,
    whoop_user_id: conn.whoopUserId ?? null,
    scopes: conn.scopes ?? null,
  })
  if (error) throw new Error(`upsertConnection: ${error.message}`)
}

export async function getConnection(db: WhoopDb, userId: string): Promise<StoredConnection | null> {
  const { data } = await db.from('whoop_connections').select().eq('user_id', userId).maybeSingle()
  if (!data) return null
  return {
    userId: data.user_id,
    accessToken: decryptTokenForVersion(data.access_token, data.key_version),
    refreshToken: decryptTokenForVersion(data.refresh_token, data.key_version),
    keyVersion: data.key_version,
    expiresAt: data.expires_at,
    whoopUserId: data.whoop_user_id,
    scopes: data.scopes,
    lastManualSyncAt: data.last_manual_sync_at,
  }
}

export async function setSyncResult(
  db: WhoopDb,
  userId: string,
  input: { lastSyncAt: string; lastManualSyncAt?: string; status: 'ok' | 'error' },
): Promise<void> {
  const patch: Record<string, unknown> = {
    user_id: userId,
    last_sync_at: input.lastSyncAt,
    last_sync_status: input.status,
  }
  if (input.lastManualSyncAt) patch.last_manual_sync_at = input.lastManualSyncAt
  const { error } = await db.from('whoop_connections').upsert(patch)
  if (error) throw new Error(`setSyncResult: ${error.message}`)
}

export async function upsertReadiness(db: WhoopDb, userId: string, rows: ReadinessRow[]): Promise<void> {
  for (const r of rows) {
    const { error } = await db.from('readiness_daily').upsert({
      user_id: userId,
      date: r.date,
      recovery_score: r.recoveryScore ?? null,
      hrv_ms: r.hrvMs ?? null,
      rhr_bpm: r.rhrBpm ?? null,
      strain: r.strain ?? null,
      sleep_hours: r.sleepHours ?? null,
      sleep_performance: r.sleepPerformance ?? null,
      source: 'whoop',
      updated_at: Date.now(),
    })
    if (error) throw new Error(`upsertReadiness: ${error.message}`)
  }
}

export async function deleteAllWhoopData(db: WhoopDb, userId: string): Promise<void> {
  for (const table of ['whoop_oauth_states', 'biometric_readings', 'readiness_daily', 'whoop_connections']) {
    const { error } = await db.from(table).delete().eq('user_id', userId)
    if (error) throw new Error(`deleteAllWhoopData ${table}: ${error.message}`)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopSupabase.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit** (no-op)

---

## Task 5: OAuth helpers puros + `whoop-oauth-start.ts`

**Files:**
- Create: `netlify/functions/_shared/whoopOAuth.ts`
- Create: `netlify/functions/whoop-oauth-start.ts`
- Test: `netlify/functions/_shared/__tests__/whoopOAuth.test.ts`

**Interfaces:**
- Produces:
  - `generateOAuthState(): string` (crypto-random)
  - `buildAuthorizeUrl(input: { authorizeUrl; clientId; redirectUri; scopes: string[]; state }): string`
  - `OAUTH_STATE_TTL_MS = 600_000`
- Consumes: `resolveAuthContext` (shared), `insertOAuthState` (Task 4), `getServiceRoleDb` (defined here).

- [ ] **Step 1: Write the failing test**

Create `netlify/functions/_shared/__tests__/whoopOAuth.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildAuthorizeUrl, generateOAuthState } from '../whoopOAuth'

describe('whoopOAuth', () => {
  it('builds an authorize URL with required params', () => {
    const url = new URL(buildAuthorizeUrl({
      authorizeUrl: 'https://api.whoop.com/oauth/oauth2/auth',
      clientId: 'cid',
      redirectUri: 'https://app/cb',
      scopes: ['read:recovery', 'read:sleep'],
      state: 'st1',
    }))
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app/cb')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('st1')
    expect(url.searchParams.get('scope')).toBe('read:recovery read:sleep')
  })

  it('generates a non-empty unique state', () => {
    const a = generateOAuthState()
    const b = generateOAuthState()
    expect(a).toHaveLength(64) // 32 bytes hex
    expect(a).not.toBe(b)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopOAuth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `whoopOAuth.ts`**

Create `netlify/functions/_shared/whoopOAuth.ts`:

```typescript
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { WhoopDb } from './whoopSupabase'

export const OAUTH_STATE_TTL_MS = 600_000 // 10 min

export function generateOAuthState(): string {
  return randomBytes(32).toString('hex')
}

export function buildAuthorizeUrl(input: {
  authorizeUrl: string
  clientId: string
  redirectUri: string
  scopes: string[]
  state: string
}): string {
  const url = new URL(input.authorizeUrl)
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', input.scopes.join(' '))
  url.searchParams.set('state', input.state)
  return url.toString()
}

// Service-role client for server-only tables (RLS denies the anon/auth client).
export function getServiceRoleDb(): WhoopDb {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE service-role env not configured')
  return createClient(url, key, { auth: { persistSession: false } }) as unknown as WhoopDb
}

export const WHOOP_SCOPES = ['read:recovery', 'read:sleep', 'read:cycles', 'read:profile']
```

> Note: confirm `WHOOP_SCOPES` strings against Task 0 Step 1 before relying on them.

- [ ] **Step 4: Implement `whoop-oauth-start.ts`**

Create `netlify/functions/whoop-oauth-start.ts`:

```typescript
import type { Handler } from '@netlify/functions'
import { json, resolveAuthContext } from './_shared/planGenerationShared'
import { insertOAuthState } from './_shared/whoopSupabase'
import {
  buildAuthorizeUrl, generateOAuthState, getServiceRoleDb,
  OAUTH_STATE_TTL_MS, WHOOP_SCOPES,
} from './_shared/whoopOAuth'

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })
  let auth
  try {
    auth = await resolveAuthContext(event)
  } catch (e) {
    return json((e as { statusCode?: number }).statusCode ?? 401, { error: 'Sesión requerida.' })
  }

  const clientId = process.env.WHOOP_CLIENT_ID
  const redirectUri = process.env.WHOOP_REDIRECT_URI
  const authorizeUrl = process.env.WHOOP_AUTHORIZE_URL
  if (!clientId || !redirectUri || !authorizeUrl) {
    return json(500, { error: 'Whoop no está configurado.' })
  }

  const state = generateOAuthState()
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString()
  try {
    await insertOAuthState(getServiceRoleDb(), { state, userId: auth.userId, expiresAt })
  } catch {
    return json(500, { error: 'No se pudo iniciar la conexión con Whoop.' })
  }

  const url = buildAuthorizeUrl({ authorizeUrl, clientId, redirectUri, scopes: WHOOP_SCOPES, state })
  return json(200, { url })
}
```

- [ ] **Step 5: Run tests + build**

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopOAuth.test.ts && npm run build`
Expected: PASS + build OK.

- [ ] **Step 6: Commit** (no-op)

---

## Task 6: `whoopClient.ts` — wrapper Whoop API + refresh

**Files:**
- Create: `netlify/functions/_shared/whoopClient.ts`
- Test: `netlify/functions/_shared/__tests__/whoopClient.test.ts`

**Interfaces:**
- Produces:
  - `interface WhoopTokens { accessToken; refreshToken; expiresAt: string }`
  - `exchangeCode(input: { code; fetchImpl? }): Promise<WhoopTokens & { whoopUserId?: string; scopes?: string }>`
  - `ensureFreshToken(conn, deps): Promise<{ accessToken: string; refreshed?: WhoopTokens }>` — refreshes if `expiresAt` is past/near; returns possibly-rotated tokens.
  - `fetchWhoopData(accessToken, { fetchImpl?; days }): Promise<WhoopRaw>` — pulls recovery/sleep/cycles for last N days.
  - `interface WhoopRaw { recovery: unknown[]; sleep: unknown[]; cycles: unknown[] }`
- Consumes: env `WHOOP_TOKEN_URL`, `WHOOP_API_BASE`, `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`.

- [ ] **Step 1: Write the failing test**

Create `netlify/functions/_shared/__tests__/whoopClient.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { ensureFreshToken } from '../whoopClient'

beforeEach(() => {
  process.env.WHOOP_TOKEN_URL = 'https://api.whoop.com/oauth/oauth2/token'
  process.env.WHOOP_CLIENT_ID = 'cid'
  process.env.WHOOP_CLIENT_SECRET = 'sec'
})

describe('ensureFreshToken', () => {
  it('returns existing token when not expired', async () => {
    const fetchImpl = async () => { throw new Error('should not refresh') }
    const res = await ensureFreshToken(
      { accessToken: 'acc', refreshToken: 'ref', expiresAt: new Date(Date.now() + 3600_000).toISOString() },
      { fetchImpl: fetchImpl as any },
    )
    expect(res.accessToken).toBe('acc')
    expect(res.refreshed).toBeUndefined()
  })

  it('refreshes when expired and returns rotated tokens', async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ access_token: 'newacc', refresh_token: 'newref', expires_in: 3600 }),
    })
    const res = await ensureFreshToken(
      { accessToken: 'old', refreshToken: 'ref', expiresAt: new Date(Date.now() - 1000).toISOString() },
      { fetchImpl: fetchImpl as any },
    )
    expect(res.accessToken).toBe('newacc')
    expect(res.refreshed?.refreshToken).toBe('newref')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopClient.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `whoopClient.ts`**

Create `netlify/functions/_shared/whoopClient.ts`. Adjust endpoint paths/paginación to what Task 0 Step 1 confirmed.

```typescript
type FetchImpl = typeof fetch

const REFRESH_SKEW_MS = 60_000 // refresh 1 min before expiry

export interface WhoopTokens {
  accessToken: string
  refreshToken: string
  expiresAt: string
}

export interface WhoopRaw {
  recovery: unknown[]
  sleep: unknown[]
  cycles: unknown[]
}

function tokenEndpoint(): string {
  const url = process.env.WHOOP_TOKEN_URL
  if (!url) throw new Error('WHOOP_TOKEN_URL not configured')
  return url
}

async function requestTokens(body: Record<string, string>, fetchImpl: FetchImpl): Promise<WhoopTokens & { whoopUserId?: string; scopes?: string }> {
  const res = await fetchImpl(tokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  } as any)
  if (!(res as Response).ok) throw new Error(`Whoop token request failed: ${(res as Response).status}`)
  const data = await (res as Response).json() as {
    access_token: string; refresh_token: string; expires_in: number; scope?: string
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    scopes: data.scope,
  }
}

export async function exchangeCode(input: { code: string; fetchImpl?: FetchImpl }) {
  const fetchImpl = input.fetchImpl ?? fetch
  return requestTokens({
    grant_type: 'authorization_code',
    code: input.code,
    client_id: process.env.WHOOP_CLIENT_ID ?? '',
    client_secret: process.env.WHOOP_CLIENT_SECRET ?? '',
    redirect_uri: process.env.WHOOP_REDIRECT_URI ?? '',
  }, fetchImpl)
}

export async function ensureFreshToken(
  conn: WhoopTokens,
  deps: { fetchImpl?: FetchImpl } = {},
): Promise<{ accessToken: string; refreshed?: WhoopTokens }> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const expiresMs = new Date(conn.expiresAt).getTime()
  if (expiresMs - REFRESH_SKEW_MS > Date.now()) {
    return { accessToken: conn.accessToken }
  }
  const refreshed = await requestTokens({
    grant_type: 'refresh_token',
    refresh_token: conn.refreshToken,
    client_id: process.env.WHOOP_CLIENT_ID ?? '',
    client_secret: process.env.WHOOP_CLIENT_SECRET ?? '',
  }, fetchImpl)
  return { accessToken: refreshed.accessToken, refreshed }
}

async function getJson(url: string, accessToken: string, fetchImpl: FetchImpl): Promise<unknown[]> {
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } } as any)
  if (!(res as Response).ok) {
    if ((res as Response).status === 429) throw Object.assign(new Error('Whoop rate limited'), { rateLimited: true })
    throw new Error(`Whoop API ${url} -> ${(res as Response).status}`)
  }
  const data = await (res as Response).json() as { records?: unknown[] }
  return data.records ?? []
}

export async function fetchWhoopData(
  accessToken: string,
  opts: { fetchImpl?: FetchImpl; days?: number } = {},
): Promise<WhoopRaw> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const base = process.env.WHOOP_API_BASE
  if (!base) throw new Error('WHOOP_API_BASE not configured')
  const days = opts.days ?? 7
  const start = new Date(Date.now() - days * 86_400_000).toISOString()
  const q = `?start=${encodeURIComponent(start)}&limit=25`
  const [recovery, sleep, cycles] = await Promise.all([
    getJson(`${base}/v1/recovery${q}`, accessToken, fetchImpl),
    getJson(`${base}/v1/activity/sleep${q}`, accessToken, fetchImpl),
    getJson(`${base}/v1/cycle${q}`, accessToken, fetchImpl),
  ])
  return { recovery, sleep, cycles }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopClient.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit** (no-op)

---

## Task 7: `whoopNormalize.ts` — Whoop raw → readiness/biometric (puro)

**Files:**
- Create: `netlify/functions/_shared/whoopNormalize.ts`
- Test: `netlify/functions/_shared/__tests__/whoopNormalize.test.ts`

**Interfaces:**
- Consumes: `WhoopRaw` (Task 6), `ReadinessRow` (Task 4).
- Produces:
  - `normalizeWhoop(raw: WhoopRaw): { readiness: ReadinessRow[]; readings: BiometricReadingInput[] }`
  - `interface BiometricReadingInput { source: 'whoop'; metric: string; value: number | null; recordedAt: string; rawId: string | null }`

> The exact field paths below (`record.score.recovery_score`, etc.) must be reconciled with the real Whoop response shape captured in Task 0 Step 1. Update the accessors if they differ; the test fixtures define the contract this task implements.

- [ ] **Step 1: Write the failing test**

Create `netlify/functions/_shared/__tests__/whoopNormalize.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { normalizeWhoop } from '../whoopNormalize'

describe('normalizeWhoop', () => {
  it('maps recovery, sleep and cycle into per-day readiness', () => {
    const raw = {
      recovery: [{ id: 'r1', created_at: '2026-06-21T06:00:00Z', score: { recovery_score: 28, hrv_rmssd_milli: 41, resting_heart_rate: 52 } }],
      sleep: [{ id: 's1', start: '2026-06-21T00:00:00Z', score: { stage_summary: { total_in_bed_time_milli: 18720000 }, sleep_performance_percentage: 61 } }],
      cycles: [{ id: 'c1', start: '2026-06-21T04:00:00Z', score: { strain: 14.1 } }],
    }
    const { readiness } = normalizeWhoop(raw as any)
    const day = readiness.find(r => r.date === '2026-06-21')
    expect(day?.recoveryScore).toBe(28)
    expect(day?.hrvMs).toBe(41)
    expect(day?.rhrBpm).toBe(52)
    expect(day?.strain).toBe(14.1)
    expect(day?.sleepPerformance).toBe(61)
    expect(day?.sleepHours).toBeCloseTo(5.2, 1)
  })

  it('handles days with missing metrics (nullable)', () => {
    const raw = { recovery: [], sleep: [{ id: 's2', start: '2026-06-20T00:00:00Z', score: { stage_summary: { total_in_bed_time_milli: 25200000 }, sleep_performance_percentage: 80 } }], cycles: [] }
    const { readiness } = normalizeWhoop(raw as any)
    const day = readiness.find(r => r.date === '2026-06-20')
    expect(day?.recoveryScore ?? null).toBeNull()
    expect(day?.sleepHours).toBeCloseTo(7, 1)
  })

  it('produces raw biometric readings with rawId for dedupe', () => {
    const raw = { recovery: [{ id: 'r1', created_at: '2026-06-21T06:00:00Z', score: { recovery_score: 28 } }], sleep: [], cycles: [] }
    const { readings } = normalizeWhoop(raw as any)
    expect(readings.some(r => r.metric === 'recovery' && r.rawId === 'r1' && r.value === 28)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopNormalize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `whoopNormalize.ts`**

Create `netlify/functions/_shared/whoopNormalize.ts`:

```typescript
import type { WhoopRaw } from './whoopClient'
import type { ReadinessRow } from './whoopSupabase'

export interface BiometricReadingInput {
  source: 'whoop'
  metric: string
  value: number | null
  recordedAt: string
  rawId: string | null
}

function dayOf(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function normalizeWhoop(raw: WhoopRaw): { readiness: ReadinessRow[]; readings: BiometricReadingInput[] } {
  const byDay = new Map<string, ReadinessRow>()
  const readings: BiometricReadingInput[] = []
  const get = (date: string): ReadinessRow => {
    let r = byDay.get(date)
    if (!r) { r = { date }; byDay.set(date, r) }
    return r
  }

  for (const rec of raw.recovery as any[]) {
    const date = dayOf(rec.created_at ?? rec.updated_at)
    const score = rec.score ?? {}
    const r = get(date)
    r.recoveryScore = num(score.recovery_score)
    r.hrvMs = num(score.hrv_rmssd_milli)
    r.rhrBpm = num(score.resting_heart_rate)
    readings.push({ source: 'whoop', metric: 'recovery', value: num(score.recovery_score), recordedAt: rec.created_at ?? date, rawId: rec.id ?? null })
    if (score.hrv_rmssd_milli != null) readings.push({ source: 'whoop', metric: 'hrv', value: num(score.hrv_rmssd_milli), recordedAt: rec.created_at ?? date, rawId: rec.id ?? null })
    if (score.resting_heart_rate != null) readings.push({ source: 'whoop', metric: 'rhr', value: num(score.resting_heart_rate), recordedAt: rec.created_at ?? date, rawId: rec.id ?? null })
  }

  for (const s of raw.sleep as any[]) {
    const date = dayOf(s.start ?? s.created_at)
    const score = s.score ?? {}
    const inBedMilli = score.stage_summary?.total_in_bed_time_milli
    const r = get(date)
    r.sleepHours = num(inBedMilli) != null ? Math.round((inBedMilli / 3_600_000) * 10) / 10 : null
    r.sleepPerformance = num(score.sleep_performance_percentage)
    if (r.sleepHours != null) readings.push({ source: 'whoop', metric: 'sleep_hours', value: r.sleepHours, recordedAt: s.start ?? date, rawId: s.id ?? null })
    if (r.sleepPerformance != null) readings.push({ source: 'whoop', metric: 'sleep_performance', value: r.sleepPerformance, recordedAt: s.start ?? date, rawId: s.id ?? null })
  }

  for (const c of raw.cycles as any[]) {
    const date = dayOf(c.start ?? c.created_at)
    const score = c.score ?? {}
    const r = get(date)
    r.strain = num(score.strain)
    if (r.strain != null) readings.push({ source: 'whoop', metric: 'strain', value: r.strain, recordedAt: c.start ?? date, rawId: c.id ?? null })
  }

  return { readiness: [...byDay.values()], readings }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopNormalize.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit** (no-op)

---

## Task 8: `whoopSync.ts` — orquestación pura + throttle

**Files:**
- Create: `netlify/functions/_shared/whoopSync.ts`
- Test: `netlify/functions/_shared/__tests__/whoopSync.test.ts`

**Interfaces:**
- Consumes: `StoredConnection`, `getConnection`, `upsertConnection`, `setSyncResult`, `upsertReadiness` (Task 4); `ensureFreshToken`, `fetchWhoopData` (Task 6); `normalizeWhoop` (Task 7).
- Produces:
  - `MANUAL_COOLDOWN_MS = 300_000`
  - `runWhoopSync(deps, input): Promise<WhoopSyncResult>`
  - `interface WhoopSyncResult { ok: boolean; reason?: 'no_connection' | 'cooldown' | 'rate_limited' | 'error'; retryAfterMs?: number; days?: number }`
  - deps inject `db`, `fetchImpl`, `now`.

- [ ] **Step 1: Write the failing test**

Create `netlify/functions/_shared/__tests__/whoopSync.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { runWhoopSync, MANUAL_COOLDOWN_MS } from '../whoopSync'

const baseConn = {
  userId: 'u1', accessToken: 'acc', refreshToken: 'ref', keyVersion: 1,
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
}

function deps(over: Partial<any> = {}) {
  return {
    db: {} as any,
    getConnection: vi.fn(async () => baseConn),
    upsertConnection: vi.fn(async () => {}),
    setSyncResult: vi.fn(async () => {}),
    upsertReadiness: vi.fn(async () => {}),
    ensureFreshToken: vi.fn(async () => ({ accessToken: 'acc' })),
    fetchWhoopData: vi.fn(async () => ({ recovery: [], sleep: [], cycles: [] })),
    normalizeWhoop: vi.fn(() => ({ readiness: [{ date: '2026-06-21', recoveryScore: 28 }], readings: [] })),
    now: () => Date.now(),
    ...over,
  }
}

describe('runWhoopSync', () => {
  it('returns no_connection when none exists', async () => {
    const d = deps({ getConnection: vi.fn(async () => null) })
    const res = await runWhoopSync(d, { userId: 'u1', trigger: 'manual' })
    expect(res).toEqual({ ok: false, reason: 'no_connection' })
  })

  it('enforces manual cooldown', async () => {
    const recent = new Date(Date.now() - 60_000).toISOString()
    const d = deps({ getConnection: vi.fn(async () => ({ ...baseConn, lastManualSyncAt: recent })) })
    const res = await runWhoopSync(d, { userId: 'u1', trigger: 'manual' })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('cooldown')
    expect(res.retryAfterMs).toBeGreaterThan(0)
  })

  it('ignores cooldown for cron trigger', async () => {
    const recent = new Date(Date.now() - 60_000).toISOString()
    const d = deps({ getConnection: vi.fn(async () => ({ ...baseConn, lastManualSyncAt: recent })) })
    const res = await runWhoopSync(d, { userId: 'u1', trigger: 'cron' })
    expect(res.ok).toBe(true)
    expect(d.upsertReadiness).toHaveBeenCalled()
  })

  it('persists rotated tokens when refreshed', async () => {
    const d = deps({ ensureFreshToken: vi.fn(async () => ({ accessToken: 'newacc', refreshed: { accessToken: 'newacc', refreshToken: 'newref', expiresAt: new Date().toISOString() } })) })
    await runWhoopSync(d, { userId: 'u1', trigger: 'manual' })
    expect(d.upsertConnection).toHaveBeenCalled()
  })

  it('maps rate-limit errors to a friendly result', async () => {
    const d = deps({ fetchWhoopData: vi.fn(async () => { throw Object.assign(new Error('429'), { rateLimited: true }) }) })
    const res = await runWhoopSync(d, { userId: 'u1', trigger: 'manual' })
    expect(res.reason).toBe('rate_limited')
  })

  it('exports a 5-minute cooldown', () => {
    expect(MANUAL_COOLDOWN_MS).toBe(300_000)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopSync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `whoopSync.ts`**

Create `netlify/functions/_shared/whoopSync.ts`:

```typescript
import type { StoredConnection, ReadinessRow, WhoopDb } from './whoopSupabase'
import type { WhoopRaw, WhoopTokens } from './whoopClient'

export const MANUAL_COOLDOWN_MS = 300_000 // 5 min

export interface WhoopSyncResult {
  ok: boolean
  reason?: 'no_connection' | 'cooldown' | 'rate_limited' | 'error'
  retryAfterMs?: number
  days?: number
}

export interface WhoopSyncDeps {
  db: WhoopDb
  getConnection: (db: WhoopDb, userId: string) => Promise<StoredConnection | null>
  upsertConnection: (db: WhoopDb, conn: StoredConnection) => Promise<void>
  setSyncResult: (db: WhoopDb, userId: string, input: { lastSyncAt: string; lastManualSyncAt?: string; status: 'ok' | 'error' }) => Promise<void>
  upsertReadiness: (db: WhoopDb, userId: string, rows: ReadinessRow[]) => Promise<void>
  ensureFreshToken: (conn: WhoopTokens, deps?: { fetchImpl?: typeof fetch }) => Promise<{ accessToken: string; refreshed?: WhoopTokens }>
  fetchWhoopData: (accessToken: string, opts?: { fetchImpl?: typeof fetch; days?: number }) => Promise<WhoopRaw>
  normalizeWhoop: (raw: WhoopRaw) => { readiness: ReadinessRow[]; readings: unknown[] }
  fetchImpl?: typeof fetch
  now?: () => number
}

export async function runWhoopSync(
  deps: WhoopSyncDeps,
  input: { userId: string; trigger: 'manual' | 'cron'; days?: number },
): Promise<WhoopSyncResult> {
  const now = deps.now ?? (() => Date.now())
  const conn = await deps.getConnection(deps.db, input.userId)
  if (!conn) return { ok: false, reason: 'no_connection' }

  if (input.trigger === 'manual' && conn.lastManualSyncAt) {
    const elapsed = now() - new Date(conn.lastManualSyncAt).getTime()
    if (elapsed < MANUAL_COOLDOWN_MS) {
      return { ok: false, reason: 'cooldown', retryAfterMs: MANUAL_COOLDOWN_MS - elapsed }
    }
  }

  try {
    const { accessToken, refreshed } = await deps.ensureFreshToken(conn, { fetchImpl: deps.fetchImpl })
    if (refreshed) {
      await deps.upsertConnection(deps.db, { ...conn, ...refreshed })
    }
    const days = input.days ?? 7
    const raw = await deps.fetchWhoopData(accessToken, { fetchImpl: deps.fetchImpl, days })
    const { readiness } = deps.normalizeWhoop(raw)
    await deps.upsertReadiness(deps.db, input.userId, readiness)
    const nowIso = new Date(now()).toISOString()
    await deps.setSyncResult(deps.db, input.userId, {
      lastSyncAt: nowIso,
      lastManualSyncAt: input.trigger === 'manual' ? nowIso : undefined,
      status: 'ok',
    })
    return { ok: true, days }
  } catch (e) {
    await deps.setSyncResult(deps.db, input.userId, { lastSyncAt: new Date(now()).toISOString(), status: 'error' }).catch(() => {})
    if ((e as { rateLimited?: boolean }).rateLimited) return { ok: false, reason: 'rate_limited' }
    return { ok: false, reason: 'error' }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopSync.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit** (no-op)

---

## Task 9: `whoop-oauth-callback.ts` + `whoop-status.ts` + `whoop-sync.ts` handlers

**Files:**
- Create: `netlify/functions/whoop-oauth-callback.ts`
- Create: `netlify/functions/whoop-status.ts`
- Create: `netlify/functions/whoop-sync.ts`

**Interfaces:**
- Consumes everything from Tasks 4-8 plus shared helpers. These are thin glue handlers (pure logic already tested upstream).

- [ ] **Step 1: Implement `whoop-oauth-callback.ts`**

Create `netlify/functions/whoop-oauth-callback.ts`:

```typescript
import type { Handler } from '@netlify/functions'
import { consumeOAuthState, upsertConnection } from './_shared/whoopSupabase'
import { getServiceRoleDb } from './_shared/whoopOAuth'
import { exchangeCode } from './_shared/whoopClient'
import { CURRENT_KEY_VERSION } from './_shared/tokenCrypto'

function redirect(location: string) {
  return { statusCode: 302, headers: { Location: location }, body: '' }
}

export const handler: Handler = async (event) => {
  const code = event.queryStringParameters?.code
  const state = event.queryStringParameters?.state
  const settingsOk = '/ajustes?whoop=connected'
  const settingsErr = '/ajustes?whoop=error'
  if (!code || !state) return redirect(settingsErr)

  const db = getServiceRoleDb()
  const consumed = await consumeOAuthState(db, state).catch(() => null)
  if (!consumed) return redirect(settingsErr)

  try {
    const tokens = await exchangeCode({ code })
    await upsertConnection(db, {
      userId: consumed.userId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      keyVersion: CURRENT_KEY_VERSION,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes ?? null,
    })
    return redirect(settingsOk)
  } catch {
    return redirect(settingsErr)
  }
}
```

> Confirm the actual settings route path (`/ajustes`) against the app's router; adjust both redirect targets to a path on the allowlist.

- [ ] **Step 2: Implement `whoop-status.ts`**

Create `netlify/functions/whoop-status.ts`:

```typescript
import type { Handler } from '@netlify/functions'
import { json, resolveAuthContext } from './_shared/planGenerationShared'
import { getServiceRoleDb } from './_shared/whoopOAuth'

export const handler: Handler = async (event) => {
  let auth
  try {
    auth = await resolveAuthContext(event)
  } catch (e) {
    return json((e as { statusCode?: number }).statusCode ?? 401, { error: 'Sesión requerida.' })
  }
  const db = getServiceRoleDb()
  const { data } = await db.from('whoop_connections').select().eq('user_id', auth.userId).maybeSingle()
  return json(200, {
    connected: Boolean(data),
    lastSyncAt: data?.last_sync_at ?? null,
    lastSyncStatus: data?.last_sync_status ?? null,
    scopes: data?.scopes ? String(data.scopes).split(' ') : [],
  })
}
```

- [ ] **Step 3: Implement `whoop-sync.ts` (manual POST + cron + DELETE for disconnect)**

Create `netlify/functions/whoop-sync.ts`:

```typescript
import type { Handler } from '@netlify/functions'
import { json, resolveAuthContext } from './_shared/planGenerationShared'
import { getServiceRoleDb } from './_shared/whoopOAuth'
import {
  getConnection, upsertConnection, setSyncResult, upsertReadiness, deleteAllWhoopData,
} from './_shared/whoopSupabase'
import { ensureFreshToken, fetchWhoopData } from './_shared/whoopClient'
import { normalizeWhoop } from './_shared/whoopNormalize'
import { runWhoopSync } from './_shared/whoopSync'

const baseDeps = (db: ReturnType<typeof getServiceRoleDb>) => ({
  db, getConnection, upsertConnection, setSyncResult, upsertReadiness,
  ensureFreshToken, fetchWhoopData, normalizeWhoop,
})

// Netlify scheduled functions invoke with no auth context; iterate connections.
async function runCron() {
  const db = getServiceRoleDb()
  const { data } = await db.from('whoop_connections').select()
  const rows = (data ?? []) as Array<{ user_id: string }>
  for (const row of rows) {
    await runWhoopSync(baseDeps(db), { userId: row.user_id, trigger: 'cron' }).catch(() => {})
  }
  // sweep expired oauth states opportunistically
  await db.from('whoop_oauth_states').delete().eq('expired', true).catch?.(() => {})
  return { statusCode: 200, body: 'ok' }
}

export const handler: Handler = async (event) => {
  // Cron invocation (Netlify sets this header / no body).
  if (event.headers?.['x-nf-event'] === 'schedule' || event.httpMethod === 'GET') {
    return runCron() as any
  }

  let auth
  try {
    auth = await resolveAuthContext(event)
  } catch (e) {
    return json((e as { statusCode?: number }).statusCode ?? 401, { error: 'Sesión requerida.' })
  }
  const db = getServiceRoleDb()

  if (event.httpMethod === 'DELETE') {
    await deleteAllWhoopData(db, auth.userId)
    return json(200, { ok: true })
  }

  const res = await runWhoopSync(baseDeps(db), { userId: auth.userId, trigger: 'manual' })
  if (res.ok) return json(200, res)
  const status = res.reason === 'cooldown' || res.reason === 'rate_limited' ? 429 : 400
  return json(status, res)
}
```

> The cron-vs-manual detection and expired-state sweep use placeholders that depend on Netlify's scheduled-invocation shape and a SQL predicate; in Task 10 the schedule wiring confirms how the cron arrives. If `x-nf-event` is not how Netlify signals it, switch to a dedicated scheduled function file. The expired-sweep can be a no-op here and handled by a SQL `delete ... where expires_at < now()` via an RPC if preferred.

- [ ] **Step 4: Build to confirm types compile**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Manual smoke (with `netlify dev` + staging Supabase, after Task 0)**

Connect Whoop via the start→callback flow; confirm a `whoop_connections` row exists and `whoop-status` returns `connected: true`. POST `whoop-sync` and confirm `readiness_daily` rows appear. Hit it again immediately → `429 cooldown`.

- [ ] **Step 6: Commit** (no-op)

---

## Task 10: Cron schedule en `netlify.toml`

**Files:**
- Modify: `netlify.toml`

- [ ] **Step 1: Add the schedule**

Add to `netlify.toml`:

```toml
[functions."whoop-sync"]
  schedule = "0 9 * * *"
```

(9:00 UTC daily. The handler already iterates all connections and syncs the last 7 days idempotently, so the exact hour and timezone don't affect completeness.)

- [ ] **Step 2: Verify the cron path locally**

Run: `npx netlify functions:invoke whoop-sync --querystring "" ` (or trigger via `netlify dev`'s scheduled invocation). Confirm it runs `runCron` without auth and updates `last_sync_at` for connected users. If Netlify's scheduled invocation does not match the `x-nf-event`/GET detection in Task 9 Step 3, split into a separate scheduled handler file that imports `runWhoopSync` and wire it here instead. Adjust and re-run `npm run build`.

- [ ] **Step 3: Commit** (no-op)

---

## Task 11: Cliente — `whoopApi.ts`, `pullReadiness.ts`, `readinessBands.ts`

**Files:**
- Create: `src/services/readiness/whoopApi.ts`
- Create: `src/services/readiness/pullReadiness.ts`
- Create: `src/services/readiness/readinessBands.ts`
- Test: `src/services/readiness/__tests__/readinessBands.test.ts`

**Interfaces:**
- Produces:
  - `whoopApi`: `startWhoopConnect(): Promise<string>` (returns authorize URL), `getWhoopStatus(): Promise<WhoopStatus>`, `syncWhoopNow(): Promise<WhoopSyncResponse>`, `disconnectWhoop(): Promise<void>`.
  - `interface WhoopStatus { connected: boolean; lastSyncAt: string | null; lastSyncStatus: 'ok' | 'error' | null; scopes: string[] }`
  - `pullReadiness(): Promise<void>` — reads `readiness_daily` via supabase client, upserts into `db.readinessDaily`.
  - `recoveryBand(score?: number | null): 'red' | 'yellow' | 'green' | 'none'`.
- Consumes: existing supabase client accessor (`getSupabase()` from `src/services/sync/syncSupabase.ts`), `db.readinessDaily`.

- [ ] **Step 1: Write the failing test (bands)**

Create `src/services/readiness/__tests__/readinessBands.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { recoveryBand } from '../readinessBands'

describe('recoveryBand', () => {
  it('classifies recovery into Whoop color bands', () => {
    expect(recoveryBand(20)).toBe('red')
    expect(recoveryBand(33)).toBe('red')
    expect(recoveryBand(34)).toBe('yellow')
    expect(recoveryBand(66)).toBe('yellow')
    expect(recoveryBand(67)).toBe('green')
    expect(recoveryBand(null)).toBe('none')
    expect(recoveryBand(undefined)).toBe('none')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/readiness/__tests__/readinessBands.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `readinessBands.ts`**

Create `src/services/readiness/readinessBands.ts`:

```typescript
export function recoveryBand(score?: number | null): 'red' | 'yellow' | 'green' | 'none' {
  if (score == null || !Number.isFinite(score)) return 'none'
  if (score <= 33) return 'red'
  if (score <= 66) return 'yellow'
  return 'green'
}
```

- [ ] **Step 4: Implement `whoopApi.ts`**

Create `src/services/readiness/whoopApi.ts`. Use the same auth-token pattern as `triggerBackgroundGeneration.ts` (Bearer from `supabase.auth.getSession()`).

```typescript
import { getSupabase } from '../sync/syncSupabase'

export interface WhoopStatus {
  connected: boolean
  lastSyncAt: string | null
  lastSyncStatus: 'ok' | 'error' | null
  scopes: string[]
}

export interface WhoopSyncResponse {
  ok: boolean
  reason?: 'no_connection' | 'cooldown' | 'rate_limited' | 'error'
  retryAfterMs?: number
}

async function authHeader(): Promise<Record<string, string>> {
  const supabase = getSupabase()
  if (!supabase) throw new Error('Sesión no disponible.')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sesión no disponible.')
  return { Authorization: `Bearer ${token}` }
}

export async function startWhoopConnect(): Promise<string> {
  const res = await fetch('/.netlify/functions/whoop-oauth-start', {
    method: 'POST', headers: await authHeader(),
  })
  if (!res.ok) throw new Error('No se pudo iniciar la conexión con Whoop.')
  const data = await res.json() as { url: string }
  return data.url
}

export async function getWhoopStatus(): Promise<WhoopStatus> {
  const res = await fetch('/.netlify/functions/whoop-status', { headers: await authHeader() })
  if (!res.ok) return { connected: false, lastSyncAt: null, lastSyncStatus: null, scopes: [] }
  return res.json() as Promise<WhoopStatus>
}

export async function syncWhoopNow(): Promise<WhoopSyncResponse> {
  const res = await fetch('/.netlify/functions/whoop-sync', { method: 'POST', headers: await authHeader() })
  return res.json() as Promise<WhoopSyncResponse>
}

export async function disconnectWhoop(): Promise<void> {
  const res = await fetch('/.netlify/functions/whoop-sync', { method: 'DELETE', headers: await authHeader() })
  if (!res.ok) throw new Error('No se pudo desconectar Whoop.')
}
```

- [ ] **Step 5: Implement `pullReadiness.ts`**

Create `src/services/readiness/pullReadiness.ts`:

```typescript
import { getSupabase } from '../sync/syncSupabase'
import { db } from '../../db/db'
import type { ReadinessDaily } from '../../types'

export async function pullReadiness(): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('readiness_daily')
    .select('date,recovery_score,hrv_ms,rhr_bpm,strain,sleep_hours,sleep_performance,source,updated_at')
    .gte('date', since)
  if (error || !data) return
  const rows: ReadinessDaily[] = data.map((r: any) => ({
    id: `whoop:${r.date}`,
    date: r.date,
    recoveryScore: r.recovery_score ?? undefined,
    hrvMs: r.hrv_ms ?? undefined,
    rhrBpm: r.rhr_bpm ?? undefined,
    strain: r.strain ?? undefined,
    sleepHours: r.sleep_hours ?? undefined,
    sleepPerformance: r.sleep_performance ?? undefined,
    source: r.source ?? 'whoop',
    updatedAt: r.updated_at ?? Date.now(),
  }))
  await db.readinessDaily.bulkPut(rows)
}
```

- [ ] **Step 6: Run tests + lint + build**

Run: `npx vitest run src/services/readiness/__tests__/readinessBands.test.ts && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit** (no-op)

---

## Task 12: `prefillDayLog.ts` — reducer puro de prefill

**Files:**
- Create: `src/services/readiness/prefillDayLog.ts`
- Test: `src/services/readiness/__tests__/prefillDayLog.test.ts`

**Interfaces:**
- Consumes: `ReadinessDaily`, `DayLog` (types).
- Produces: `prefillDayLog(existing: Partial<DayLog>, readiness: ReadinessDaily | undefined): { patch: Partial<DayLog>; prefillSource: DayLog['prefillSource'] }`.
  - "Vacío" = `undefined` o `null`. `0` y `''` cuentan como valor presente y NO se sobreescriben.
  - Escalados: `sleepQuality (1-5) = clamp(round(sleep_performance/20), 1, 5)`; `energyLevel (1-10) = clamp(round(recovery_score/10), 1, 10)`.

- [ ] **Step 1: Write the failing test**

Create `src/services/readiness/__tests__/prefillDayLog.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { prefillDayLog } from '../prefillDayLog'

const readiness = {
  id: 'whoop:2026-06-21', date: '2026-06-21',
  recoveryScore: 28, sleepHours: 5.2, sleepPerformance: 61, strain: 14.1,
  source: 'whoop', updatedAt: 1,
}

describe('prefillDayLog', () => {
  it('fills empty fields and records source', () => {
    const { patch, prefillSource } = prefillDayLog({}, readiness)
    expect(patch.sleepHours).toBe(5.2)
    expect(patch.sleepQuality).toBe(3)     // round(61/20)=3
    expect(patch.energyLevel).toBe(3)      // round(28/10)=3
    expect(prefillSource).toEqual({ sleepHours: 'whoop', sleepQuality: 'whoop', energyLevel: 'whoop' })
  })

  it('does not overwrite a manually-set value (including 0)', () => {
    const { patch, prefillSource } = prefillDayLog({ sleepHours: 7, energyLevel: 0 }, readiness)
    expect(patch.sleepHours).toBeUndefined()
    expect(patch.energyLevel).toBeUndefined()
    expect(patch.sleepQuality).toBe(3)
    expect(prefillSource).toEqual({ sleepQuality: 'whoop' })
  })

  it('returns empty patch when no readiness', () => {
    const { patch, prefillSource } = prefillDayLog({}, undefined)
    expect(patch).toEqual({})
    expect(prefillSource).toEqual({})
  })

  it('never touches painLevel/notes', () => {
    const { patch } = prefillDayLog({}, readiness)
    expect('painLevel' in patch).toBe(false)
    expect('painNotes' in patch).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/readiness/__tests__/prefillDayLog.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `prefillDayLog.ts`**

Create `src/services/readiness/prefillDayLog.ts`:

```typescript
import type { DayLog, ReadinessDaily } from '../../types'

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

export function prefillDayLog(
  existing: Partial<DayLog>,
  readiness: ReadinessDaily | undefined,
): { patch: Partial<DayLog>; prefillSource: NonNullable<DayLog['prefillSource']> } {
  const patch: Partial<DayLog> = {}
  const prefillSource: NonNullable<DayLog['prefillSource']> = {}
  if (!readiness) return { patch, prefillSource }

  if (isEmpty(existing.sleepHours) && readiness.sleepHours != null) {
    patch.sleepHours = readiness.sleepHours
    prefillSource.sleepHours = 'whoop'
  }
  if (isEmpty(existing.sleepQuality) && readiness.sleepPerformance != null) {
    patch.sleepQuality = clamp(Math.round(readiness.sleepPerformance / 20), 1, 5)
    prefillSource.sleepQuality = 'whoop'
  }
  if (isEmpty(existing.energyLevel) && readiness.recoveryScore != null) {
    patch.energyLevel = clamp(Math.round(readiness.recoveryScore / 10), 1, 10)
    prefillSource.energyLevel = 'whoop'
  }
  return { patch, prefillSource }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/readiness/__tests__/prefillDayLog.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit** (no-op)

---

## Task 13: `ReadinessCard.tsx` + montaje en Dashboard

**Files:**
- Create: `src/components/readiness/ReadinessCard.tsx`
- Test: `src/components/readiness/__tests__/ReadinessCard.test.tsx`
- Modify: la página de dashboard (montar la tarjeta). Identificar el contenedor real con `grep -rn "ROUTES.HOME\|Dashboard" src/App.tsx src/pages` y montar la tarjeta arriba del feed del día.

**Interfaces:**
- Consumes: `ReadinessDaily`, `recoveryBand` (Task 11).
- Produces: `ReadinessCard({ readiness, connected }: { readiness?: ReadinessDaily; connected: boolean })`.

- [ ] **Step 1: Write the failing test**

Create `src/components/readiness/__tests__/ReadinessCard.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReadinessCard } from '../ReadinessCard'

const readiness = {
  id: 'whoop:2026-06-21', date: '2026-06-21',
  recoveryScore: 28, sleepHours: 5.2, sleepPerformance: 61, strain: 14.1,
  source: 'whoop', updatedAt: 1,
}

describe('ReadinessCard', () => {
  it('renders recovery, sleep and strain when present', () => {
    const html = renderToStaticMarkup(<ReadinessCard readiness={readiness} connected />)
    expect(html).toContain('28')
    expect(html).toContain('5.2')
    expect(html).toContain('14.1')
  })

  it('shows a connect CTA when not connected', () => {
    const html = renderToStaticMarkup(<ReadinessCard connected={false} />)
    expect(html.toLowerCase()).toContain('whoop')
    expect(html.toLowerCase()).toContain('conect')
  })

  it('shows a no-data state when connected but no readiness today', () => {
    const html = renderToStaticMarkup(<ReadinessCard connected />)
    expect(html.toLowerCase()).toContain('sin datos')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/readiness/__tests__/ReadinessCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ReadinessCard.tsx`**

Create `src/components/readiness/ReadinessCard.tsx`. Match the dark, large-number aesthetic of the approved mockup; reuse existing card/utility classes from a sibling card (e.g. `WeekSummaryCard.tsx`).

```tsx
import type { ReadinessDaily } from '../../types'
import { recoveryBand } from '../../services/readiness/readinessBands'

const BAND_COLOR: Record<string, string> = {
  red: 'text-red-400',
  yellow: 'text-amber-400',
  green: 'text-emerald-400',
  none: 'text-ink-muted',
}

export function ReadinessCard({ readiness, connected }: { readiness?: ReadinessDaily; connected: boolean }) {
  if (!connected) {
    return (
      <div className="rounded-2xl bg-surface p-5">
        <p className="text-sm text-ink-muted">Conecta Whoop para ver tu recuperación, sueño y strain del día.</p>
        <a href="/ajustes?whoop=connect" className="mt-3 inline-block text-sm font-semibold text-brand">Conectar Whoop</a>
      </div>
    )
  }
  if (!readiness) {
    return (
      <div className="rounded-2xl bg-surface p-5">
        <p className="text-xs uppercase tracking-wide text-ink-faint">Readiness</p>
        <p className="mt-2 text-sm text-ink-muted">Sin datos de Whoop hoy todavía.</p>
      </div>
    )
  }
  const band = recoveryBand(readiness.recoveryScore)
  return (
    <div className="rounded-2xl bg-surface p-5">
      <p className="text-xs uppercase tracking-wide text-ink-faint">Readiness · Whoop</p>
      <div className="mt-3 grid grid-cols-3 gap-4">
        <div>
          <p className={`text-3xl font-bold ${BAND_COLOR[band]}`}>
            {readiness.recoveryScore != null ? `${Math.round(readiness.recoveryScore)}%` : '—'}
          </p>
          <p className="text-[11px] uppercase tracking-wide text-ink-faint">Recovery</p>
        </div>
        <div>
          <p className="text-3xl font-bold text-ink">
            {readiness.sleepHours != null ? `${readiness.sleepHours}h` : '—'}
          </p>
          <p className="text-[11px] uppercase tracking-wide text-ink-faint">
            Sueño {readiness.sleepPerformance != null ? `· ${Math.round(readiness.sleepPerformance)}%` : ''}
          </p>
        </div>
        <div>
          <p className="text-3xl font-bold text-ink">
            {readiness.strain != null ? readiness.strain.toFixed(1) : '—'}
          </p>
          <p className="text-[11px] uppercase tracking-wide text-ink-faint">Strain</p>
        </div>
      </div>
    </div>
  )
}
```

> Adjust class names (`bg-surface`, `text-ink`, `text-brand`, etc.) to the project's real Tailwind tokens — copy them from an existing card component.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/readiness/__tests__/ReadinessCard.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Mount the card in the dashboard**

In the dashboard page, load today's readiness + status and render `<ReadinessCard>`. Example wiring (adapt to the real page):

```tsx
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { ReadinessCard } from '../components/readiness/ReadinessCard'
import { getWhoopStatus, pullReadiness } from '../services/readiness/whoopApi' // status
import { useEffect, useState } from 'react'
// ...
const today = new Date().toISOString().slice(0, 10)
const readiness = useLiveQuery(() => db.readinessDaily.where('date').equals(today).first(), [today])
const [connected, setConnected] = useState(false)
useEffect(() => { getWhoopStatus().then(s => setConnected(s.connected)).catch(() => {}); pullReadiness().catch(() => {}) }, [])
// render: <ReadinessCard readiness={readiness} connected={connected} />
```

(Import `pullReadiness` from `../services/readiness/pullReadiness`.)

- [ ] **Step 6: Run lint + build**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit** (no-op)

---

## Task 14: `WhoopConnection.tsx` en Settings

**Files:**
- Create: `src/components/settings/WhoopConnection.tsx`
- Modify: `src/pages/SettingsPage.tsx` (montar la sección)

**Interfaces:**
- Consumes: `whoopApi` (Task 11).
- Produces: `WhoopConnection()` component (self-contained, manages its own state).

- [ ] **Step 1: Implement `WhoopConnection.tsx`**

Create `src/components/settings/WhoopConnection.tsx`:

```tsx
import { useEffect, useState } from 'react'
import {
  getWhoopStatus, startWhoopConnect, syncWhoopNow, disconnectWhoop,
  type WhoopStatus,
} from '../../services/readiness/whoopApi'
import { pullReadiness } from '../../services/readiness/pullReadiness'

export function WhoopConnection() {
  const [status, setStatus] = useState<WhoopStatus | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = () => getWhoopStatus().then(setStatus).catch(() => setStatus(null))
  useEffect(() => { refresh() }, [])

  const onConnect = async () => {
    try { window.location.href = await startWhoopConnect() }
    catch { setMsg('No se pudo iniciar la conexión.') }
  }
  const onSync = async () => {
    setBusy(true); setMsg(null)
    try {
      const res = await syncWhoopNow()
      if (res.ok) { await pullReadiness(); setMsg('Sincronizado.') }
      else if (res.reason === 'cooldown') setMsg(`Espera ${Math.ceil((res.retryAfterMs ?? 0) / 1000)}s para volver a sincronizar.`)
      else if (res.reason === 'rate_limited') setMsg('Whoop limitó las consultas. Reintenta más tarde.')
      else setMsg('No se pudo sincronizar.')
      await refresh()
    } finally { setBusy(false) }
  }
  const onDisconnect = async () => {
    if (!confirm('¿Desconectar Whoop y borrar tus datos de Whoop?')) return
    setBusy(true)
    try { await disconnectWhoop(); await pullReadiness(); setMsg('Whoop desconectado.'); await refresh() }
    finally { setBusy(false) }
  }

  return (
    <section className="rounded-2xl bg-surface p-5">
      <h3 className="text-sm font-semibold">Whoop</h3>
      {status?.connected ? (
        <>
          <p className="mt-1 text-xs text-ink-muted">
            Conectado{status.lastSyncAt ? ` · última sync ${new Date(status.lastSyncAt).toLocaleString()}` : ''}
            {status.lastSyncStatus === 'error' ? ' · último intento falló' : ''}
          </p>
          <div className="mt-3 flex gap-2">
            <button disabled={busy} onClick={onSync} className="text-sm font-semibold text-brand">Sincronizar ahora</button>
            <button disabled={busy} onClick={onDisconnect} className="text-sm text-red-400">Desconectar</button>
          </div>
        </>
      ) : (
        <button onClick={onConnect} className="mt-2 text-sm font-semibold text-brand">Conectar Whoop</button>
      )}
      {msg && <p className="mt-2 text-xs text-ink-muted">{msg}</p>}
    </section>
  )
}
```

- [ ] **Step 2: Mount in SettingsPage**

Import and render `<WhoopConnection />` in `src/pages/SettingsPage.tsx` near other integration/profile sections (e.g. before the Beta Quality section ~line 700).

- [ ] **Step 3: Run lint + build**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit** (no-op)

---

## Task 15: Prefill editable en el check-in (`DayDetail.tsx`)

**Files:**
- Modify: `src/pages/DayDetail.tsx`

**Interfaces:**
- Consumes: `prefillDayLog` (Task 12), `db.readinessDaily`.

- [ ] **Step 1: Load today's readiness and compute prefill**

In `DayDetail.tsx`, fetch the readiness row for the page's date and compute prefill for fields the user hasn't set. Initialize the local input state with the prefilled value when empty, and show a subtle "desde Whoop" hint. Example (adapt to the existing state in the file — it already has `sleepHours` state at line 65):

```tsx
import { useLiveQuery } from 'dexie-react-hooks'
import { prefillDayLog } from '../services/readiness/prefillDayLog'
// date is the page's ISO date
const readiness = useLiveQuery(() => db.readinessDaily.where('date').equals(date).first(), [date])
const { patch, prefillSource } = prefillDayLog(dayLog ?? {}, readiness)

// when initializing the sleepHours input, prefer existing, else prefilled:
const [sleepHours, setSleepHours] = useState(
  (dayLog?.sleepHours ?? patch.sleepHours)?.toString() ?? ''
)
```

- [ ] **Step 2: Persist `prefillSource` and clear it on manual edit**

When saving the dayLog, merge `prefillSource` for fields that were prefilled and remain unchanged. When the user edits a prefilled field by hand, remove that field's entry from `prefillSource` before saving. Show the hint only for fields still marked in `prefillSource`:

```tsx
// in the save handler, build the persisted prefillSource:
const persistedSource = { ...prefillSource }
if (sleepHoursEditedByUser) delete persistedSource.sleepHours
// ...same for sleepQuality / energyLevel
await db.dayLogs.put({ ...nextDayLog, prefillSource: Object.keys(persistedSource).length ? persistedSource : undefined })
```

Add a small label next to each prefilled field, e.g. `{prefillSource.sleepHours && <span className="text-[10px] text-ink-faint">desde Whoop</span>}`.

- [ ] **Step 3: Run lint + build + existing DayDetail-adjacent tests**

Run: `npm run lint && npm run build`
Expected: PASS. (No new unit test required here — the prefill logic is covered by Task 12; this is wiring.)

- [ ] **Step 4: Commit** (no-op)

---

## Task 16: Contexto pasivo del coach + alerta suave

**Files:**
- Modify: `src/services/ai/promptBuilder.ts` (cerca de `:879`, donde se usa `context.dayLog`)
- Modify: `src/services/actionAlerts.ts`
- Test: `src/services/ai/__tests__/readinessPromptContext.test.ts` (Create)
- Test: `src/services/__tests__/readinessAlert.test.ts` (Create)

**Interfaces:**
- Produces: una función pura `formatReadinessLine(readiness?: ReadinessDaily): string | null` exportada desde `promptBuilder.ts` (o un helper nuevo `src/services/ai/readinessContext.ts` para mantener `promptBuilder.ts` enfocado — preferir el helper).
- Consumes: `ReadinessDaily`.

> Regla del proyecto: no tocar `promptBuilder.ts` por estética. Aquí el cambio es funcional y mínimo: inyectar una línea de contexto. Mantener el formateo en un helper separado y solo llamar al helper desde `promptBuilder.ts`.

- [ ] **Step 1: Write the failing test (prompt line)**

Create `src/services/ai/__tests__/readinessPromptContext.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { formatReadinessLine } from '../readinessContext'

describe('formatReadinessLine', () => {
  it('summarizes recovery/sleep/strain', () => {
    const line = formatReadinessLine({
      id: 'whoop:2026-06-21', date: '2026-06-21', recoveryScore: 28, sleepHours: 5.2,
      sleepPerformance: 61, strain: 14.1, source: 'whoop', updatedAt: 1,
    })
    expect(line).toContain('28%')
    expect(line).toContain('5.2')
    expect(line).toContain('14.1')
    expect(line?.toLowerCase()).toContain('bajo') // red band note
  })

  it('returns null when no readiness', () => {
    expect(formatReadinessLine(undefined)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/ai/__tests__/readinessPromptContext.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `readinessContext.ts`**

Create `src/services/ai/readinessContext.ts`:

```typescript
import type { ReadinessDaily } from '../../types'
import { recoveryBand } from '../readiness/readinessBands'

export function formatReadinessLine(readiness?: ReadinessDaily): string | null {
  if (!readiness) return null
  const parts: string[] = []
  if (readiness.recoveryScore != null) {
    const band = recoveryBand(readiness.recoveryScore)
    const label = band === 'red' ? ' (bajo)' : band === 'green' ? ' (alto)' : ''
    parts.push(`recovery ${Math.round(readiness.recoveryScore)}%${label}`)
  }
  if (readiness.sleepHours != null) parts.push(`sueño ${readiness.sleepHours}h`)
  if (readiness.strain != null) parts.push(`strain ${readiness.strain.toFixed(1)}`)
  if (parts.length === 0) return null
  return `Readiness Whoop: ${parts.join(', ')}.`
}
```

- [ ] **Step 4: Inject into the prompt**

In `promptBuilder.ts`, where `context.dayLog` is used for the day section (~line 879), import `formatReadinessLine` and append its output (if non-null) to the same daily-context block. The context assembly must pass `readiness` through; if the prompt context object lacks it, add an optional `readiness?: ReadinessDaily` to the context type and populate it from `db.readinessDaily` at the call site that builds the context (search `grep -rn "dayLog:" src/services/ai/contextOptimizer.ts`).

- [ ] **Step 5: Write the failing test (alert)**

Create `src/services/__tests__/readinessAlert.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildReadinessAlert } from '../actionAlerts'

describe('buildReadinessAlert', () => {
  it('emits a soft alert on red recovery', () => {
    const alert = buildReadinessAlert({ id: 'whoop:x', date: 'x', recoveryScore: 28, source: 'whoop', updatedAt: 1 })
    expect(alert).not.toBeNull()
    expect(alert?.severity).toBe('info')
    expect(alert?.message.toLowerCase()).toContain('intensidad')
  })

  it('emits nothing for green/none recovery', () => {
    expect(buildReadinessAlert({ id: 'a', date: 'x', recoveryScore: 80, source: 'whoop', updatedAt: 1 })).toBeNull()
    expect(buildReadinessAlert(undefined)).toBeNull()
  })
})
```

- [ ] **Step 6: Run alert test to verify it fails**

Run: `npx vitest run src/services/__tests__/readinessAlert.test.ts`
Expected: FAIL — `buildReadinessAlert` not exported.

- [ ] **Step 7: Implement `buildReadinessAlert` in `actionAlerts.ts`**

Add to `src/services/actionAlerts.ts` (match the existing alert object shape used in that file; the snippet below assumes `{ id, severity, message }` — adapt field names to the real type):

```typescript
import type { ReadinessDaily } from '../types'
import { recoveryBand } from './readiness/readinessBands'

export function buildReadinessAlert(readiness?: ReadinessDaily) {
  if (!readiness || recoveryBand(readiness.recoveryScore) !== 'red') return null
  return {
    id: `readiness-${readiness.date}`,
    severity: 'info' as const,
    message: 'Tu recuperación viene baja hoy. Considera bajar la intensidad o priorizar técnica/recuperación.',
  }
}
```

Wire `buildReadinessAlert` into wherever alerts are aggregated for display (search `grep -rn "severity" src/services/actionAlerts.ts` to find the collector), pushing the alert when non-null. It must NOT modify any session or plan — display only.

- [ ] **Step 8: Run tests + lint + build**

Run: `npx vitest run src/services/ai/__tests__/readinessPromptContext.test.ts src/services/__tests__/readinessAlert.test.ts && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 9: Commit** (no-op)

---

## Task 17: Borrado completo + consentimiento + export/backup (gate legal)

**Files:**
- Modify: `src/services/appMaintenance.ts` (limpiar `readinessDaily` en wipe local)
- Modify: `src/services/syncService.ts:469` (agregar `readiness_daily` a tablas syncables + wipe remoto)
- Modify: `src/services/dataExport.ts` (incluir `readinessDaily` en backup)
- Modify: onboarding/consent surface (consentimiento biométrico antes de conectar)
- Test: `src/services/__tests__/whoopDataLifecycle.test.ts` (Create)

**Interfaces:**
- Consumes: `db.readinessDaily`, `disconnectWhoop` (Task 11).

- [ ] **Step 1: Write the failing test**

Create `src/services/__tests__/whoopDataLifecycle.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../db/db'
import { clearAllLocalAppData } from '../appMaintenance'

describe('whoop data lifecycle', () => {
  beforeEach(async () => {
    await db.readinessDaily.clear()
    await db.readinessDaily.put({ id: 'whoop:2026-06-21', date: '2026-06-21', source: 'whoop', updatedAt: 1 })
  })

  it('clearAllLocalAppData removes readinessDaily', async () => {
    await clearAllLocalAppData()
    expect(await db.readinessDaily.count()).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/whoopDataLifecycle.test.ts`
Expected: FAIL — `readinessDaily` still present after wipe.

- [ ] **Step 3: Add `readinessDaily` to local wipe**

In `src/services/appMaintenance.ts` `clearAllLocalAppData`, add `db.readinessDaily.clear()` alongside the other table clears.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/__tests__/whoopDataLifecycle.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `readiness_daily` to sync wipe + backup**

- In `src/services/syncService.ts` (the table list at ~`:469` used for pull/`pending_remote_wipe`), add `'readiness_daily'` so the account-wipe convergence includes it (follow the exact pattern used for `'day_logs'`). Note: routine pull of readiness already happens via `pullReadiness` (Task 11); here the goal is only that account-level wipe converges and doesn't rehydrate.
- In `src/services/dataExport.ts`, add `readinessDaily` to the backup `tables` shape, the `Promise.all` reads, the counts, and the restore path — mirror exactly how `dayLogs` is handled (lines ~92, ~120, ~165, ~183, ~275, ~293).

- [ ] **Step 6: Add biometric consent before connect**

In the onboarding/consent surface (same place the Terms/health-disclaimer consent is recorded for `client-readiness`), add a checkbox/acceptance for biometric data (Whoop) that must be accepted before `startWhoopConnect` is callable. Record version + date like the other consents. If the consent infra from `client-readiness-legal` isn't merged yet, gate the "Conectar Whoop" button behind a simple inline consent confirmation in `WhoopConnection.tsx` and leave a `// TODO: replace with onboarding consent once client-readiness lands` — note this dependency in the PR description.

- [ ] **Step 7: Run full suite + lint + build**

Run: `npm test && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 8: Commit** (no-op)

---

## Self-Review Notes

- **Spec coverage:** Track 0 → Task 0; SQL/RLS → Task 1; Dexie v13 + types → Task 3; tokenCrypto → Task 2; data-access + oauth states → Task 4; OAuth start/state → Task 5; whoopClient/refresh → Task 6; normalize → Task 7; sync core + throttle → Task 8; callback/status/sync handlers + disconnect → Task 9; cron → Task 10; client api/pull/bands → Task 11; prefill reducer → Task 12; ReadinessCard → Task 13; Settings connection → Task 14; DayDetail prefill → Task 15; coach passive context + soft alert → Task 16; deletion lifecycle + consent + export → Task 17. All spec sections mapped.
- **Verification reminders:** endpoint/scopes/field-paths in Tasks 5/6/7/9 are flagged to reconcile against Whoop's real API (Task 0 Step 1) — the tests define the contract each module implements.
- **Server-only invariant:** the client never reads `whoop_connections`/`biometric_readings`; status comes only via `whoop-status` (Task 9). Confirmed across tasks.
- **Coach safety:** Task 16 is display/context only — no plan/session mutation.
