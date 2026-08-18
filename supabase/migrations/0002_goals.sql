-- Goals layer. Run in the SQL editor of the TodoFlow Supabase project.
--
-- Writer contract (mirrors World HQ's one-writer-per-field rule):
-- * things_tasks   — SYNC-OWNED. Written only by /world-sync (push.mjs) with the
--                    service key, replace-all on every run. The app reads it and
--                    never writes it. Worst case is stale, never wrong.
-- * goals          — APP-OWNED. Al's season goals; seeded from the One Page
--                    Plan scoreboards, edited in the app.
-- * goal_assignments — APP-OWNED. things_id -> goal_id. The link Things itself
--                    has no field for. Rows outlive the mirrored task on
--                    purpose: a task that drops out of the working set and
--                    comes back keeps its goal.

create table public.things_tasks (
  things_id text primary key,
  name text not null,
  priority text not null,
  project text,
  who text,
  due date,
  all_tags text not null default '',
  is_urgent boolean not null default false,
  synced_at timestamptz not null
);

alter table public.things_tasks enable row level security;

-- Read for any signed-in user; no client write policy at all, so only the
-- service key (which bypasses RLS) can touch it. TodoFlow is a one-person
-- deployment in practice, so "any signed-in user" == Al.
create policy "signed-in read" on public.things_tasks
  for select
  to authenticated
  using (true);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  -- Where this goal is written down. Pointer, not a copy — the plan stays canonical.
  source text,
  -- The 90-day judge date from the plan.
  judge_date date,
  colour text,
  position double precision not null default 0,
  archived_at_ms bigint,
  created_at_ms bigint not null,
  updated_at_ms bigint not null
);

alter table public.goals enable row level security;

create policy "own goals" on public.goals
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index goals_user_position on public.goals (user_id, position);

create table public.goal_assignments (
  things_id text not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal_id uuid not null references public.goals (id) on delete cascade,
  -- Order within the goal (sparse, midpoint insertion — same as tasks.position).
  position double precision not null default 0,
  updated_at_ms bigint not null,
  primary key (user_id, things_id)
);

alter table public.goal_assignments enable row level security;

create policy "own assignments" on public.goal_assignments
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index goal_assignments_goal on public.goal_assignments (user_id, goal_id, position);
