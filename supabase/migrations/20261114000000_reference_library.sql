create table public.folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (owner_id, id)
);

create unique index folders_owner_name on public.folders (owner_id, lower(btrim(name)));

create table public.saved_references (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  platform text not null check (platform in ('youtube', 'instagram', 'tiktok', 'x')),
  post_id text,
  kind text not null check (kind in ('video', 'shorts', 'p', 'reel', 'tv', 'photo', 'post', 'share')),
  url text not null check (char_length(url) between 1 and 2048),
  title text check (char_length(title) <= 300),
  created_at timestamptz not null default now(),
  identity_key text generated always as (coalesce(post_id, url)) stored,
  unique (owner_id, id),
  unique (owner_id, platform, identity_key),
  check ((post_id is null) = (kind = 'share'))
);

create index saved_references_newest on public.saved_references (owner_id, created_at desc, id desc);

create table public.folder_references (
  owner_id uuid not null default auth.uid(),
  reference_id uuid not null,
  folder_id uuid not null,
  primary key (owner_id, reference_id, folder_id),
  foreign key (owner_id, reference_id) references public.saved_references (owner_id, id) on delete cascade,
  foreign key (owner_id, folder_id) references public.folders (owner_id, id) on delete cascade
);

create index folder_references_by_folder on public.folder_references (owner_id, folder_id);

alter table public.folders enable row level security;
alter table public.saved_references enable row level security;
alter table public.folder_references enable row level security;

create policy "Own folders" on public.folders for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Own references" on public.saved_references for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Own memberships" on public.folder_references for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

revoke all on public.folders, public.saved_references, public.folder_references from public, anon, authenticated;
grant select, insert, update, delete on public.folders, public.saved_references, public.folder_references to authenticated, service_role;

create function public.save_reference(
  p_platform text, p_post_id text, p_kind text, p_url text, p_folder_ids uuid[],
  p_share_id uuid default null
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  account_id uuid := auth.uid();
  result_id uuid;
begin
  if account_id is null then
    raise exception 'Sign-in required' using errcode = '42501';
  end if;

  if p_share_id is not null then
    perform 1 from public.saved_references
      where owner_id = account_id and id = p_share_id and post_id is null and platform = p_platform
      for update;
    if not found then
      raise exception 'Share link could not be found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.saved_references as saved (owner_id, platform, post_id, kind, url)
  values (account_id, p_platform, p_post_id, p_kind, p_url)
  on conflict (owner_id, platform, identity_key) do update
    set url = saved.url
  returning id into result_id;

  insert into public.folder_references (owner_id, reference_id, folder_id)
    select account_id, result_id, folder_id from unnest(p_folder_ids) as folder_id
    on conflict do nothing;

  if p_share_id is not null and p_share_id <> result_id then
    insert into public.folder_references (owner_id, reference_id, folder_id)
      select account_id, result_id, folder_id from public.folder_references
      where owner_id = account_id and reference_id = p_share_id
      on conflict do nothing;
    delete from public.saved_references where owner_id = account_id and id = p_share_id;
  end if;

  return result_id;
end;
$$;

create function public.set_reference_folders(p_reference_id uuid, p_folder_ids uuid[])
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  account_id uuid := auth.uid();
begin
  perform 1 from public.saved_references
    where owner_id = account_id and id = p_reference_id for update;
  if not found then
    raise exception 'Reference could not be found' using errcode = 'P0002';
  end if;

  delete from public.folder_references
    where owner_id = account_id and reference_id = p_reference_id
      and not (folder_id = any(p_folder_ids));

  insert into public.folder_references (owner_id, reference_id, folder_id)
    select account_id, p_reference_id, folder_id from unnest(p_folder_ids) as folder_id
    on conflict do nothing;
end;
$$;

revoke execute on function public.save_reference(text, text, text, text, uuid[], uuid) from public, anon;
revoke execute on function public.set_reference_folders(uuid, uuid[]) from public, anon;
grant execute on function public.save_reference(text, text, text, text, uuid[], uuid) to authenticated;
grant execute on function public.set_reference_folders(uuid, uuid[]) to authenticated;
