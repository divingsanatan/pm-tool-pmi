-- Lets Project Managers pick stakeholders from the directory when adding people to their project.
-- Run once in Supabase > SQL Editor > New query > paste > Run. Safe to run again.

-- A Project Manager can READ the directory (names, roles, emails). Only Admins can edit or delete entries.
drop policy if exists "directory pm read" on public.directory_people;
create policy "directory pm read" on public.directory_people for select to authenticated
  using (exists (select 1 from public.project_members m where m.user_id = (select auth.uid()) and m.role = 'pm'));

-- Admin or Project Manager: add a brand-new person to the directory
create or replace function public.directory_create(did text, nm text, rl text, mail text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_admin() or exists (select 1 from public.project_members where user_id = (select auth.uid()) and role = 'pm')) then
    raise exception 'not allowed';
  end if;
  if trim(coalesce(nm, '')) = '' then raise exception 'name needed'; end if;
  insert into public.directory_people (id, name, role, email) values (did, trim(nm), trim(coalesce(rl, '')), lower(trim(coalesce(mail, ''))));
end $$;

-- Admin or Project Manager: add an email to a placeholder. An email that is already set is never overwritten.
create or replace function public.set_directory_email(did text, mail text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_admin() or exists (select 1 from public.project_members where user_id = (select auth.uid()) and role = 'pm')) then
    raise exception 'not allowed';
  end if;
  update public.directory_people set email = lower(trim(mail)) where id = did and email = '';
  if not found then raise exception 'this person already has an email'; end if;
end $$;

revoke execute on function public.directory_create(text, text, text, text) from public, anon;
revoke execute on function public.set_directory_email(text, text) from public, anon;
grant execute on function public.directory_create(text, text, text, text) to authenticated;
grant execute on function public.set_directory_email(text, text) to authenticated;
