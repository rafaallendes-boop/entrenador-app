# Multi-Device Sync for Entrenador App

Estado: activo en produccion  
Ultima revision: 2026-04-02

## Resumen

La app ya tiene sync multi-dispositivo con:

- Supabase como backend de datos
- Google OAuth via Supabase Auth
- Dexie como cache local y fuente de lectura para la UI
- push/pull en background
- cola offline en `localStorage`

El objetivo del diseno sigue siendo `local-first`: la UI lee desde IndexedDB y Supabase actua como capa de sincronizacion y backup.

## Estado actual implementado

Frontend:

- React + TypeScript + Vite
- Zustand para estado
- Dexie/IndexedDB para persistencia local
- `AuthGate` + `LoginScreen` para login
- `syncService.ts` para push, pull y cola offline

Backend:

- Supabase PostgreSQL
- Google OAuth
- RLS por `user_id`

Tablas sincronizadas:

- `sessions`
- `day_logs`
- `week_summaries`
- `chat_messages`
- `coach_proposals`
- `athlete_profiles`

## Flujo real

### Lectura

- La UI siempre lee desde Dexie.
- Al iniciar sesion se prepara el contexto local del usuario.
- Luego se ejecuta `pullAll(userId)` y se recargan los stores visibles.

### Escritura

- Cada write local dispara un push fire-and-forget a Supabase.
- Si no hay red o Supabase falla, la operacion se encola.
- La cola se drena al volver online y antes de cada `pullAll`.

### Cambio de usuario

- El sync ahora detecta cambio de cuenta en el mismo navegador.
- Si cambia el usuario, se limpia el estado local sincronizable antes del pull.
- La migracion inicial queda marcada por usuario, no globalmente.

### Borrados

- Los deletes remotos ya se reconcilian hacia Dexie.
- La reconciliacion destructiva solo se aplica si la cola offline pudo drenarse.
- El borrado de una conversacion del chat ahora tambien replica sus mensajes al backend.

## Archivos clave

- `src/services/auth.ts`
- `src/store/useAuthStore.ts`
- `src/components/auth/AuthGate.tsx`
- `src/components/auth/LoginScreen.tsx`
- `src/services/syncService.ts`
- `src/App.tsx`

## Variables de entorno

Produccion y desarrollo necesitan:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Agregar las mismas variables en:

- Netlify environment variables
- `.env`
- `.env.production`

## Modelo de datos esperado en Supabase

Todas las tablas usan:

- `id` como clave primaria del registro local
- `user_id` para aislamiento por usuario
- columnas SQL para campos de filtro
- `data JSONB` cuando el modelo tiene campos variables

Tablas:

```sql
create table sessions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  time_block text not null,
  type text not null,
  status text not null default 'planned',
  created_at bigint not null,
  updated_at bigint not null,
  data jsonb not null default '{}'
);

create table day_logs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  updated_at bigint not null,
  data jsonb not null default '{}'
);

create table week_summaries (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start_date date not null,
  updated_at bigint not null,
  data jsonb not null default '{}'
);

create table chat_messages (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_session_id text,
  role text not null,
  content text not null,
  timestamp bigint not null,
  data jsonb not null default '{}'
);

create table coach_proposals (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  created_at bigint not null,
  updated_at bigint not null,
  data jsonb not null default '{}'
);

create table athlete_profiles (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  coach_memory text,
  updated_at bigint not null
);
```

## RLS

Cada tabla debe tener:

- `SELECT` solo del propio usuario
- `INSERT` con `user_id = auth.uid()`
- `UPDATE` solo del propio usuario
- `DELETE` solo del propio usuario

Patron:

```sql
alter table sessions enable row level security;

create policy "sessions read own"
on sessions for select
using (auth.uid() = user_id);

create policy "sessions insert own"
on sessions for insert
with check (auth.uid() = user_id);

create policy "sessions update own"
on sessions for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "sessions delete own"
on sessions for delete
using (auth.uid() = user_id);
```

Repetir el mismo esquema para las otras tablas.

## Limitaciones conocidas

- No hay realtime todavia. Los cambios se reflejan al abrir la app o al ejecutar un nuevo pull.
- No hay soft delete ni historial de versiones.
- `coach_proposals` siguen siendo una entidad separada del historial de chat.
- El sync depende de que la estructura RLS en Supabase siga alineada con el codigo.

## Siguiente paso recomendado

Si el sync base ya esta estable, los siguientes frentes con mas valor son:

1. indicador visible de sync fuera de Settings
2. politica explicita para proposals al borrar conversaciones
3. realtime opcional si de verdad habra uso simultaneo en dos dispositivos abiertos
