-- TodoFlow initial schema. Run in the SQL editor of the dedicated TodoFlow
-- Supabase project (or via `supabase db push`).
--
-- Design notes:
-- * Multi-user from day one: user_id + RLS on every table.
-- * All *_ms columns are client-stamped epoch milliseconds — the client's
--   LWW conflict clock, NOT server time.
-- * deleted_at_ms is a soft-delete tombstone so offline deletes can't be
--   resurrected by a stale device.
-- * parent_id has NO foreign key on purpose: batched upserts may deliver
--   children before parents.

create table public.tasks (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  title text not null default '',
  notes text not null default '',
  estimate_minutes int not null,
  extra_minutes int not null default 0,
  scheduled_start_minutes int,
  status text not null check (status in ('queued', 'active', 'done')),
  kind text not null check (kind in ('task', 'break')),
  parent_id uuid,
  in_sprint boolean not null default false,
  position double precision not null default 0,
  created_at_ms bigint not null,
  updated_at_ms bigint not null,
  deleted_at_ms bigint
);

alter table public.tasks enable row level security;

create policy "own rows" on public.tasks
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index tasks_user_date on public.tasks (user_id, date);
create index tasks_user_updated on public.tasks (user_id, updated_at_ms);

alter publication supabase_realtime add table public.tasks;

create table public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  latest_finish_minutes int not null,
  scheduled_start_minutes int,
  -- Pomodoro rhythm. Defaults match the client's so a row written by an older
  -- build still reads back sensibly.
  default_task_minutes int not null default 25,
  default_break_minutes int not null default 5,
  auto_break boolean not null default true,
  updated_at_ms bigint not null
);

alter table public.user_settings enable row level security;

create policy "own settings" on public.user_settings
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
