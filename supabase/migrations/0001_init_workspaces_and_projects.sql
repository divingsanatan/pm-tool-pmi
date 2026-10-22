-- Already applied to Supabase project jgebvyphxkvgtrcwhlup (pm-tool-pmi) as "init_workspaces_and_projects".
-- Kept here as a record. One row per project (whole project as JSONB); row-level security per user.

create table public.workspaces (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  nav jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.projects (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  position int not null default 0,
  name text not null default '',
  data jsonb not null,
  rev int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_user_id_idx on public.projects (user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger workspaces_set_updated_at before update on public.workspaces
  for each row execute function public.set_updated_at();
create trigger projects_set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

alter table public.workspaces enable row level security;
alter table public.projects enable row level security;

create policy "own workspace" on public.workspaces
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own projects" on public.projects
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
