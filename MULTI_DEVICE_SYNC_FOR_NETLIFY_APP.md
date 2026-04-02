# Multi-Device Sync — Entrenador App

> **Estado: COMPLETO Y EN PRODUCCIÓN (2026-04-02)**
> Supabase + Google OAuth activos. Verificado en producción Netlify.

> Documento de arquitectura, decisión técnica e implementación de sincronización multi-dispositivo.

---

## 1. Estado Actual

### Frontend
- **Hosting:** Netlify (producción activa)
- **Framework:** React 19 + TypeScript + Vite
- **Estado:** Zustand (5 stores)
- **Persistencia local:** Dexie/IndexedDB (6 tablas, esquema v7)
- **AI Backend:** Netlify Function `coach.ts` (proxy a Gemini/OpenAI/Claude)
- **PWA:** Service Worker + Web Notifications

### Datos almacenados localmente (Dexie IndexedDB)

| Tabla Dexie | Contenido | Campo de conflicto |
|---|---|---|
| `sessions` | Sesiones de entrenamiento (squash, running, fuerza, etc.) | `updatedAt` |
| `dayLogs` | Logs diarios (sueño, energía, dolor, RPE, peso) | `updatedAt` |
| `weekSummaries` | Resúmenes semanales (adherencia, nota del coach) | `updatedAt` |
| `chatMessages` | Historial de chat con el coach AI | `timestamp` |
| `coachProposals` | Propuestas de acción del coach (aceptar/rechazar) | `resolvedAt ?? createdAt` |
| `athleteProfiles` | Perfil del atleta / memoria del coach | `updatedAt` |

### Problema
Cada dispositivo tiene su propia copia aislada de IndexedDB. No hay sincronización entre dispositivos. Abrir la app en un segundo celular/computador muestra datos vacíos.

---

## 2. Opciones Evaluadas

### Opción A: Supabase ✅ ELEGIDA
- **DB:** PostgreSQL con JSONB para campos variables
- **Auth:** Google OAuth nativo (2 líneas de config)
- **Seguridad:** Row Level Security (RLS) declarativo en SQL
- **Free tier:** 500MB DB, 2GB bandwidth, 50K usuarios activos/mes
- **Datos estimados para 6 usuarios:** < 5MB (free tier indefinido)
- **Integración con Netlify:** Variables de entorno Vite, sin cambios al Function `coach.ts`

### Opción B: Firebase Firestore
- **DB:** NoSQL (documentos/colecciones)
- **Auth:** Firebase Auth con Google
- **Free tier:** 1GB storage, **50K reads/día** (limitante para sync frecuente)
- **Problema:** El modelo relacional (sessions → weekSummaries por join) es incómodo en NoSQL. Los límites de lectura del free tier son restrictivos.
- **Descartado:** Límite de reads diarios + esquema NoSQL no encaja bien con los datos relacionales.

### Opción C: Netlify Functions + PlanetScale/Neon
- Requiere escribir una capa API REST completa (3-4 nuevas Netlify Functions para CRUD)
- Sin auth nativo → habría que integrar un proveedor de auth por separado
- Significativamente más complejo de implementar y mantener
- **Descartado:** Complejidad desproporcionada para el caso de uso.

---

## 3. Decisión Tomada: Supabase

**Justificación:**

1. **Costo $0:** Todos los usuarios generan < 5MB de datos. El free tier da 500MB. La app puede crecer 100x antes de necesitar pagar.

2. **Google OAuth sin fricción:** `supabase.auth.signInWithOAuth({ provider: 'google' })` es la implementación completa en el frontend. No hay SDK adicional de auth.

3. **PostgreSQL encaja perfectamente:** Las `weekSummaries` se calculan a partir de `sessions + dayLogs`. En PostgreSQL se puede hacer con un JOIN. En Firestore habría que denormalizar o hacer agregaciones costosas en el cliente.

4. **RLS = seguridad simple:** `USING (auth.uid() = user_id)` en cada tabla garantiza que ningún usuario vea datos de otro. La `anon key` puede ser pública (embebida en el bundle de Vite) porque RLS filtra server-side.

5. **Sin tocar `coach.ts`:** El Netlify Function de AI es un proxy puro, no maneja datos de usuario. No requiere service-role key ni ningún cambio.

6. **Local-first preservado:** El flujo de escritura no cambia — Dexie sigue siendo la fuente de verdad. Supabase es el destino de sync en background.

---

## 4. Arquitectura Final

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (Netlify)                    │
│                                                         │
│  React Components                                       │
│      ↓                                                  │
│  Zustand Stores (useTrainingStore, useChatStore, etc.)  │
│      ↓                           ↓                      │
│  Dexie IndexedDB          syncService.ts                │
│  (fuente de verdad)     (push/pull/offline queue)       │
│      ↓                           ↓                      │
│  Local reads            Supabase REST API               │
│  (siempre rápido)       (background sync)               │
│                                  ↓                      │
│                    useAuthStore (Google OAuth)           │
└─────────────────────────────────────────────────────────┘
                             ↕
┌─────────────────────────────────────────────────────────┐
│                     SUPABASE (Free)                     │
│                                                         │
│  Auth (Google OAuth) + PostgreSQL + RLS                 │
│                                                         │
│  sessions | day_logs | week_summaries |                 │
│  chat_messages | coach_proposals | athlete_profiles     │
└─────────────────────────────────────────────────────────┘
```

### Principios
- **Local-first:** Todas las lecturas van a Dexie. La UI nunca espera a Supabase.
- **Push fire-and-forget:** Cada write a Dexie dispara un push a Supabase en background. No bloquea la UI.
- **Pull on load:** Al abrir la app (con auth), se hace un pull de todos los datos remotos y se mergean a Dexie.
- **Offline queue:** Si hay error o no hay conexión, la operación se encola en `localStorage` y se reintenta al recuperar conexión.

---

## 5. Modelo de Datos (SQL Supabase)

```sql
-- =============================================
-- SESSIONS
-- =============================================
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  time_block   TEXT NOT NULL,
  type         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'planned',
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL,
  data         JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX sessions_user_date ON sessions(user_id, date);

-- =============================================
-- DAY LOGS
-- =============================================
CREATE TABLE day_logs (
  id         TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date       DATE NOT NULL,
  updated_at BIGINT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX day_logs_user_date ON day_logs(user_id, date);

-- =============================================
-- WEEK SUMMARIES
-- =============================================
CREATE TABLE week_summaries (
  id              TEXT PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  updated_at      BIGINT NOT NULL,
  data            JSONB NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX week_summaries_user_week ON week_summaries(user_id, week_start_date);

-- =============================================
-- CHAT MESSAGES
-- =============================================
CREATE TABLE chat_messages (
  id              TEXT PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_session_id TEXT,
  role            TEXT NOT NULL,
  timestamp       BIGINT NOT NULL,
  data            JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX chat_messages_user_session ON chat_messages(user_id, chat_session_id);

-- =============================================
-- COACH PROPOSALS
-- =============================================
CREATE TABLE coach_proposals (
  id         TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX coach_proposals_user_status ON coach_proposals(user_id, status);

-- =============================================
-- ATHLETE PROFILES
-- =============================================
CREATE TABLE athlete_profiles (
  id           TEXT PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  coach_memory TEXT,
  updated_at   BIGINT NOT NULL
);
CREATE UNIQUE INDEX athlete_profiles_user ON athlete_profiles(user_id);

-- =============================================
-- ROW LEVEL SECURITY (aplicar a todas las tablas)
-- =============================================
ALTER TABLE sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE day_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE week_summaries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_proposals  ENABLE ROW LEVEL SECURITY;
ALTER TABLE athlete_profiles ENABLE ROW LEVEL SECURITY;

-- Template (repetir para cada tabla):
CREATE POLICY "sessions: read own"   ON sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "sessions: insert own" ON sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sessions: update own" ON sessions FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sessions: delete own" ON sessions FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "day_logs: read own"   ON day_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "day_logs: insert own" ON day_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "day_logs: update own" ON day_logs FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "day_logs: delete own" ON day_logs FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "week_summaries: read own"   ON week_summaries FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "week_summaries: insert own" ON week_summaries FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "week_summaries: update own" ON week_summaries FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "week_summaries: delete own" ON week_summaries FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "chat_messages: read own"   ON chat_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "chat_messages: insert own" ON chat_messages FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "chat_messages: update own" ON chat_messages FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "chat_messages: delete own" ON chat_messages FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "coach_proposals: read own"   ON coach_proposals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "coach_proposals: insert own" ON coach_proposals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "coach_proposals: update own" ON coach_proposals FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "coach_proposals: delete own" ON coach_proposals FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "athlete_profiles: read own"   ON athlete_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "athlete_profiles: insert own" ON athlete_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "athlete_profiles: update own" ON athlete_profiles FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "athlete_profiles: delete own" ON athlete_profiles FOR DELETE USING (auth.uid() = user_id);
```

### Estrategia de columnas JSONB
Los campos opcionales/variables (ej: `exercises[]`, `runningDetails`, `rpe`, `opponent`, etc. en sessions) van en la columna `data JSONB`. Los campos que se quieren indexar o consultar (`date`, `status`, `type`, `user_id`, `updated_at`) son columnas SQL de primera clase.

**Ventaja:** El schema SQL permanece estable cuando se agregan nuevos campos al modelo TypeScript. No hay migraciones para campos opcionales.

---

## 6. Flujo de Sincronización

### Push (write → cloud)

```
Usuario hace acción (crear/editar/borrar sesión, guardar log, etc.)
    ↓
Zustand Store: escribe en Dexie (fuente de verdad)
    ↓ (fire-and-forget, no bloquea)
syncService.push*(entity)
    ↓
¿navigator.onLine?
    NO → encolar en offline queue (localStorage) → fin
    SÍ → supabase.from(table).upsert(row)
            ↓
        ¿error? → encolar → fin
        ¿ok?    → actualizar syncStatus: 'idle'
```

### Pull (app load → sync desde cloud)

```
App carga + usuario autenticado
    ↓
syncService.pullAll(userId)
    ↓
1. drainQueue() — intenta reenviar ops pendientes primero
    ↓
2. Para cada tabla: supabase.from(table).select('*').eq('user_id', userId)
    ↓
3. Para cada fila remota:
   - Buscar fila local en Dexie por id
   - Si remote.updatedAt > local.updatedAt → db.table.put(remote) [tomar remoto]
   - Si local.updatedAt > remote.updatedAt → syncService.push*(local) [subir local]
   - Si no existe local → db.table.put(remote) [crear local]
    ↓
4. Recargar stores afectados (useTrainingStore.loadWeek, etc.)
```

### Conflictos: Last-Write-Wins

| Tabla | Campo de conflicto |
|---|---|
| sessions, dayLogs, weekSummaries, athleteProfiles | `updatedAt` (ms Unix) |
| chatMessages | `timestamp` (append-only — sin conflicto real) |
| coachProposals | `resolvedAt ?? createdAt` (derivado en syncService) |

**Razonamiento:** Para uso personal con 1 usuario en múltiples dispositivos, last-write-wins es suficiente. El conflicto más común es "edité en el celular mientras no había internet, ahora sincronizo con el escritorio" — el dispositivo con el cambio más reciente gana.

### Offline Queue

```typescript
interface OfflineOp {
  table: 'sessions' | 'day_logs' | 'week_summaries' | 'chat_messages' | 'coach_proposals' | 'athlete_profiles'
  action: 'upsert' | 'delete'
  payload: Record<string, unknown>
  enqueuedAt: number
}
// Guardado en localStorage key: 'entrenador_sync_queue_v1'
// Drenado al recuperar conexión (window 'online' event) y al inicio de cada pullAll
```

---

## 7. Autenticación (Google OAuth via Supabase)

### Setup (una sola vez)

1. **Google Cloud Console:** Crear credenciales OAuth 2.0. Agregar URIs de redirección:
   - `https://[tu-proyecto].supabase.co/auth/v1/callback`
   - `http://localhost:8888/auth/v1/callback` (para `netlify dev`)

2. **Supabase Dashboard → Authentication → Providers → Google:** Pegar Client ID y Client Secret.

3. **Netlify Dashboard → Environment variables:** Agregar:
   - `VITE_SUPABASE_URL` = `https://[tu-proyecto].supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = la anon key pública del proyecto

### Flujo en la app

```
Usuario abre app por primera vez
    ↓
AuthGate detecta user === null (no logueado)
    ↓
LoginScreen: botón "Iniciar sesión con Google"
    ↓
supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
    ↓
Navegador → Google OAuth consent screen
    ↓
Google → redirige a app con código de autorización en URL
    ↓
Supabase JS SDK intercepta automáticamente en onAuthStateChange
    ↓
Session almacenada en localStorage (access token + refresh token)
    ↓
useAuthStore recibe el evento → user = User object
    ↓
AuthGate renderiza la app completa
    ↓
App.tsx useEffect: syncService.pullAll(user.id) → carga datos remotos
```

### Manejo de sesión

- El SDK de Supabase renueva el access token automáticamente antes de que expire.
- En `useAuthStore`: `supabase.auth.onAuthStateChange((event, session) => { set({ user: session?.user ?? null }) })`
- El `userId` es `user.id` (UUID de Supabase, siempre el mismo para el mismo Google account).
- Sign out: `supabase.auth.signOut()` → limpia tokens → `onAuthStateChange` dispara con `user: null`.

---

## 8. Plan de Implementación

### Fase 1 — Supabase + Google Auth

**Infraestructura (hacer primero, no requiere código):**
- [ ] Crear proyecto Supabase (supabase.com, free tier)
- [ ] Habilitar proveedor Google en Authentication → Providers
- [ ] Crear credenciales OAuth en Google Cloud Console
- [ ] Agregar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en Netlify Dashboard
- [ ] Agregar las mismas variables en `.env.local` para desarrollo

**Código:**
- [ ] `npm install @supabase/supabase-js`
- [ ] Crear `src/services/auth.ts` — cliente Supabase singleton
- [ ] Crear `src/store/useAuthStore.ts` — estado de auth + signIn/signOut
- [ ] Crear `src/components/auth/AuthGate.tsx` — renderiza LoginScreen o la app
- [ ] Crear `src/components/auth/LoginScreen.tsx` — pantalla de login con Google
- [ ] Modificar `src/App.tsx` — envolver con AuthGate, disparar pullAll en auth

**Verificación Fase 1:**
- Iniciar sesión con Google en `localhost:8888` (netlify dev)
- Verificar que `useAuthStore` tiene el objeto `User`
- Cerrar sesión y verificar que muestra LoginScreen

---

### Fase 2 — Sync de Sesiones (tabla más crítica)

**Infraestructura:**
- [ ] Ejecutar SQL de `sessions` + 4 políticas RLS en Supabase SQL Editor

**Código:**
- [ ] Crear `src/services/syncService.ts` con:
  - `pushSession(session)` / `deleteSession(id)`
  - `pullSessions(userId)`
  - Infraestructura del offline queue
  - `drainQueue()`
- [ ] Modificar `src/store/useTrainingStore.ts` — 4 hook points

**Verificación Fase 2:**
- Agregar sesión en Dispositivo A → ver row en Supabase Dashboard
- Abrir en Dispositivo B (o borrar IndexedDB) → sesión aparece tras pullAll

---

### Fase 3 — Sync de Todas las Tablas

**Infraestructura:**
- [ ] Ejecutar SQL de las 5 tablas restantes + RLS en Supabase

**Código:**
- [ ] Extender `syncService.ts` con push/pull para las 5 tablas restantes
- [ ] Implementar `pullAll(userId)` completo
- [ ] Implementar `migrateLocalDataToCloud(userId)` — migración one-time usando `exportAppData()` existente
- [ ] Modificar `useChatStore.ts` — 2 hook points
- [ ] Modificar `useCoachActionsStore.ts` — 3 hook points
- [ ] Modificar `useCoachMemoryStore.ts` — 1 hook point
- [ ] Modificar `src/db/queries.ts` — 1 hook point en `upsertWeekSummary`
- [ ] Modificar `SettingsPage.tsx` — botón de Sign Out

**Verificación Fase 3:**
- Day log guardado en Dispositivo A → aparece en Dispositivo B
- Chat history sincronizado entre dispositivos
- Perfil del atleta sincronizado

---

### Fase 4 — Offline Hardening + UX

**Código:**
- [ ] Refinar `pullAll` con resolución de conflictos bidireccional (push local si local es más nuevo)
- [ ] `window.addEventListener('online', () => void syncService.drainQueue())`
- [ ] Indicador visual de sync status en AppShell/BottomNav
- [ ] Test offline → crear sesión → reconectar → verificar queue

---

## 9. Riesgos y Limitaciones

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| **Límites Supabase free tier** | Baja (5MB vs 500MB disponibles) | Monitorear en dashboard; free tier es suficiente para 50+ usuarios |
| **Conflicto last-write-wins pierde dato** | Muy baja (uso personal) | Agregar real-time subscriptions en Fase 5 futura |
| **Google OAuth redirect en Safari iOS** | Media | Probar en Safari; Supabase usa `redirectTo` estándar que funciona |
| **Primera carga lenta en red lenta** | Baja | `pullAll` es background; la app es usable inmediatamente desde Dexie local |
| **Datos previos perdidos al hacer login por primera vez** | Media sin migración | `migrateLocalDataToCloud` resuelve esto (Fase 3) |
| **Schema JSONB difícil de consultar** | Baja (no hay consultas complejas desde el frontend) | Los campos clave son columnas SQL; `data` es solo transporte |

### Limitaciones actuales del diseño

- **Sin real-time:** Los cambios en otro dispositivo se ven al reabrir la app (no en vivo). Suficiente para el caso de uso actual.
- **Sin historial de versiones:** Si borras una sesión en Dispositivo A mientras B está offline, y B la edita y sincroniza, la sesión puede "revivir" en A. Es un edge case muy raro con un solo usuario.
- **Sin auth secundaria:** Solo Google OAuth. No hay email/password. Adecuado para uso personal.

---

## 10. Roadmap Futuro

| Mejora | Cuándo considerar |
|---|---|
| **Real-time subscriptions** (`supabase.channel()`) | Si se agregan múltiples usuarios simultáneos editando |
| **Historial de versiones / soft delete** | Si se requiere deshacer cambios de otro dispositivo |
| **Invitar testers con acceso compartido de solo lectura** | Supabase RLS permite políticas de "coach puede ver datos del atleta" |
| **Backup automático diario** | Supabase tiene pg_dump automático en plan Pro ($25/mes) |
| **Push notifications cross-device** | Web Push API + Supabase Functions para notificaciones cuando el coach propone un plan |
| **Migrar a Supabase Realtime para chat** | Si se quiere que el coach AI responda mientras el app está en background |

---

## Archivos Modificados / Creados

### Nuevos archivos
- `src/services/auth.ts` — Supabase client singleton
- `src/services/syncService.ts` — capa completa de sync (push/pull/queue para 6 tablas)
- `src/store/useAuthStore.ts` — estado de autenticación
- `src/components/auth/AuthGate.tsx` — render condicional
- `src/components/auth/LoginScreen.tsx` — pantalla de login

### Archivos modificados (cambios mínimos)
- `src/App.tsx` — AuthGate + pullAll on auth (~10 líneas)
- `src/store/useTrainingStore.ts` — 4 push calls después de writes Dexie
- `src/store/useChatStore.ts` — 2 push calls
- `src/store/useCoachActionsStore.ts` — 3 push calls
- `src/store/useCoachMemoryStore.ts` — 1 push call
- `src/db/queries.ts` — 1 push call en `upsertWeekSummary`
- `src/pages/SettingsPage.tsx` — botón Sign Out + sync status

### Infraestructura (no código)
- Supabase: 6 tablas SQL + 24 políticas RLS
- Netlify: 2 variables de entorno
- Google Cloud Console: credenciales OAuth
