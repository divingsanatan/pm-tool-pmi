-- Already applied to the live project (work_item_attachments_bucket). Kept here as a record.
-- Files attached to work items (images, video, audio, PDF). Private bucket; every file lives under <project id>/<work item id>/...
-- so the first folder name decides who may see or change it, using the same roles as the project itself.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments', 'attachments', false, 26214400,
  array['image/jpeg','image/png','image/gif','image/webp','image/avif',
        'video/mp4','video/webm','video/quicktime',
        'audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/ogg','audio/webm',
        'application/pdf']
)
on conflict (id) do nothing;

drop policy if exists "attachments read" on storage.objects;
drop policy if exists "attachments add" on storage.objects;
drop policy if exists "attachments remove" on storage.objects;

create policy "attachments read" on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and (
      public.project_role((storage.foldername(name))[1]) is not null
      or exists (select 1 from public.projects p where p.id = (storage.foldername(name))[1] and p.user_id = (select auth.uid()))
    )
  );

create policy "attachments add" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (
      public.project_role((storage.foldername(name))[1]) in ('admin', 'pm', 'member')
      or exists (select 1 from public.projects p where p.id = (storage.foldername(name))[1] and p.user_id = (select auth.uid()))
    )
  );

create policy "attachments remove" on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (
      public.project_role((storage.foldername(name))[1]) in ('admin', 'pm', 'member')
      or exists (select 1 from public.projects p where p.id = (storage.foldername(name))[1] and p.user_id = (select auth.uid()))
    )
  );
