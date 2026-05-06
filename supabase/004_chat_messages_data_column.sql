alter table public.chat_messages
  add column if not exists data jsonb not null default '{}'::jsonb;
