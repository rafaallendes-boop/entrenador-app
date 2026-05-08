create table if not exists public.chat_messages (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_session_id text null,
  role text not null,
  content text not null,
  timestamp bigint not null,
  data jsonb not null default '{}'::jsonb
);

alter table public.chat_messages
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists chat_session_id text,
  add column if not exists role text,
  add column if not exists content text,
  add column if not exists timestamp bigint,
  add column if not exists data jsonb not null default '{}'::jsonb;

update public.chat_messages
  set role = 'coach'
  where role is null;

update public.chat_messages
  set content = ''
  where content is null;

update public.chat_messages
  set timestamp = 0
  where timestamp is null;

alter table public.chat_messages
  alter column role set not null,
  alter column content set not null,
  alter column timestamp set not null,
  alter column data set not null;

create index if not exists chat_messages_user_session_timestamp_idx
  on public.chat_messages (user_id, chat_session_id, timestamp);

create index if not exists chat_messages_user_timestamp_idx
  on public.chat_messages (user_id, timestamp);

alter table public.chat_messages enable row level security;

drop policy if exists "chat_messages_select_own" on public.chat_messages;
create policy "chat_messages_select_own"
  on public.chat_messages
  for select
  using (auth.uid() = user_id);

drop policy if exists "chat_messages_insert_own" on public.chat_messages;
create policy "chat_messages_insert_own"
  on public.chat_messages
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "chat_messages_update_own" on public.chat_messages;
create policy "chat_messages_update_own"
  on public.chat_messages
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "chat_messages_delete_own" on public.chat_messages;
create policy "chat_messages_delete_own"
  on public.chat_messages
  for delete
  using (auth.uid() = user_id);
