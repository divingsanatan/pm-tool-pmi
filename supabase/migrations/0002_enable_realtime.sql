-- Live sync across devices: announce row changes on both tables (row-level security still decides who receives them).
alter publication supabase_realtime add table public.projects, public.workspaces;
