-- Admin-only master list of stakeholders, so one person can be put on several projects at once.
-- Run once in Supabase > SQL Editor > New query > paste > Run. Safe to run again.
create table if not exists public.directory_people (
  id text primary key,
  name text not null,
  role text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.directory_people enable row level security;
drop policy if exists "directory admin only" on public.directory_people;
create policy "directory admin only" on public.directory_people for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
