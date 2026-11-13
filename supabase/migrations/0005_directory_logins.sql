-- Link directory stakeholders to sign-in accounts, and invite them from the directory.
-- Run once in Supabase > SQL Editor > New query > paste > Run. Safe to run again.

alter table public.directory_people add column if not exists email text not null default '';

-- Admin only: every account that exists, so the directory can show who has actually signed in
create or replace function public.list_accounts()
returns table (user_id uuid, email text, last_sign_in_at timestamptz, is_admin boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return query
    select u.id, lower(u.email)::text, u.last_sign_in_at,
           exists (select 1 from public.app_admins a where a.user_id = u.id)
    from auth.users u where u.email is not null;
end $$;

-- Gives an email a role on a project: a member straight away if that person already has an account, otherwise an invitation.
-- Admin may give any role; a Project Manager only Team member or Viewer.
create or replace function public.grant_access(pid text, mail text, r text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me text := public.project_role(pid);
  m text := lower(trim(mail));
  uid uuid;
begin
  if r not in ('pm', 'member', 'viewer') then raise exception 'bad role'; end if;
  if not (me = 'admin' or (me = 'pm' and r in ('member', 'viewer'))) then raise exception 'not allowed'; end if;
  if me = 'pm' and exists (select 1 from public.project_members where project_id = pid and lower(email) = m and role = 'pm') then
    raise exception 'not allowed';
  end if;
  select id into uid from auth.users where lower(email) = m and email_confirmed_at is not null limit 1;
  if uid is not null then
    insert into public.project_members (project_id, user_id, email, role) values (pid, uid, m, r)
    on conflict (project_id, user_id) do update set role = excluded.role, email = excluded.email;
    delete from public.project_invites where project_id = pid and email = m;
    return 'member';
  end if;
  insert into public.project_invites (project_id, email, role) values (pid, m, r)
  on conflict (project_id, email) do update set role = excluded.role;
  return 'invited';
end $$;

revoke execute on function public.list_accounts() from public, anon;
revoke execute on function public.grant_access(text, text, text) from public, anon;
grant execute on function public.list_accounts() to authenticated;
grant execute on function public.grant_access(text, text, text) to authenticated;
