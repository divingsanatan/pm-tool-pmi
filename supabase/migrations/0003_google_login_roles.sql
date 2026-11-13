-- Google login + sharing projects with roles.
-- Roles:  Admin (global, in app_admins)  |  pm, member, viewer (per project, in project_members)
-- Run this ONCE in Supabase > SQL Editor > New query > paste > Run. It can be run again safely.

-- 1) Admins. Everybody who already has an account today becomes an Admin (that is you).
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
insert into public.app_admins (user_id) select id from auth.users on conflict do nothing;

-- 2) Who belongs to which project, and the invitations waiting for a first sign-in
create table if not exists public.project_members (
  project_id text not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null default '',
  role text not null check (role in ('pm', 'member', 'viewer')),
  added_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_idx on public.project_members (user_id);

create table if not exists public.project_invites (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects (id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null check (role in ('pm', 'member', 'viewer')),
  invited_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (project_id, email)
);

-- 3) Helpers. security definer so the policies below do not call themselves.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_admins where user_id = (select auth.uid()))
$$;

create or replace function public.project_role(pid text) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.app_admins where user_id = (select auth.uid())) then 'admin'
    else (select role from public.project_members where project_id = pid and user_id = (select auth.uid()))
  end
$$;

-- Called by the app after every sign-in: turns invitations for this person's (verified) email into memberships.
create or replace function public.claim_invites() returns int
language plpgsql security definer set search_path = '' as $$
declare
  me text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  n int := 0;
begin
  if me = '' or (select auth.uid()) is null then return 0; end if;
  if (select email_confirmed_at from auth.users where id = (select auth.uid())) is null then return 0; end if;
  with moved as (
    delete from public.project_invites where email = me returning project_id, role
  )
  insert into public.project_members (project_id, user_id, email, role)
  select project_id, (select auth.uid()), me, role from moved
  on conflict (project_id, user_id) do update set role = excluded.role, email = excluded.email;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.project_role(text) from public, anon;
revoke execute on function public.claim_invites() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.project_role(text) to authenticated;
grant execute on function public.claim_invites() to authenticated;

-- 4) Row-level security
alter table public.app_admins enable row level security;
alter table public.project_members enable row level security;
alter table public.project_invites enable row level security;

drop policy if exists "see own admin row" on public.app_admins;
create policy "see own admin row" on public.app_admins for select to authenticated
  using (user_id = (select auth.uid()));

-- projects: Admin sees and creates everything; pm and member can edit; viewer only reads; only Admin deletes
drop policy if exists "own projects" on public.projects;
drop policy if exists "projects read" on public.projects;
drop policy if exists "projects create" on public.projects;
drop policy if exists "projects edit" on public.projects;
drop policy if exists "projects delete" on public.projects;
create policy "projects read" on public.projects for select to authenticated
  using (public.project_role(id) is not null or user_id = (select auth.uid()));
create policy "projects create" on public.projects for insert to authenticated
  with check (public.is_admin() and user_id = (select auth.uid()));
create policy "projects edit" on public.projects for update to authenticated
  using (public.project_role(id) in ('admin', 'pm', 'member'))
  with check (public.project_role(id) in ('admin', 'pm', 'member'));
create policy "projects delete" on public.projects for delete to authenticated
  using (public.is_admin());

-- members: Admin and the project's pm see everyone; others see only themselves.
-- Admin manages everyone; a pm manages only team members and viewers (never other pms).
drop policy if exists "members read" on public.project_members;
drop policy if exists "members change" on public.project_members;
drop policy if exists "members remove" on public.project_members;
create policy "members read" on public.project_members for select to authenticated
  using (user_id = (select auth.uid()) or public.project_role(project_id) in ('admin', 'pm'));
create policy "members change" on public.project_members for update to authenticated
  using (public.project_role(project_id) = 'admin' or (public.project_role(project_id) = 'pm' and role in ('member', 'viewer')))
  with check (public.project_role(project_id) = 'admin' or (public.project_role(project_id) = 'pm' and role in ('member', 'viewer')));
create policy "members remove" on public.project_members for delete to authenticated
  using (public.project_role(project_id) = 'admin' or (public.project_role(project_id) = 'pm' and role in ('member', 'viewer')));

drop policy if exists "invites read" on public.project_invites;
drop policy if exists "invites create" on public.project_invites;
drop policy if exists "invites remove" on public.project_invites;
create policy "invites read" on public.project_invites for select to authenticated
  using (public.project_role(project_id) in ('admin', 'pm'));
create policy "invites create" on public.project_invites for insert to authenticated
  with check (public.project_role(project_id) = 'admin' or (public.project_role(project_id) = 'pm' and role in ('member', 'viewer')));
create policy "invites remove" on public.project_invites for delete to authenticated
  using (public.project_role(project_id) = 'admin' or (public.project_role(project_id) = 'pm' and role in ('member', 'viewer')));
