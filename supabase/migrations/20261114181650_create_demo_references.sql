create table public.demo_references (
  id uuid primary key default gen_random_uuid(),
  url text not null unique check (char_length(btrim(url)) between 1 and 2048),
  title text check (char_length(btrim(title)) between 1 and 300),
  folders text[] not null default '{}'
    check (folders <@ array['motion', 'visual']::text[]),
  sort_order integer not null default 0
);

alter table public.demo_references enable row level security;

revoke all on public.demo_references from public, anon, authenticated;
grant select on public.demo_references to anon, authenticated;
create policy "Read public demo references" on public.demo_references
  for select to anon, authenticated using (true);
