alter table public.saved_references
  add column ai_status text not null default 'unrequested'
    check (ai_status in ('unrequested', 'pending', 'processing', 'ready', 'failed', 'unavailable', 'not_video')),
  add column ai_summary text check (char_length(btrim(ai_summary)) between 1 and 550),
  add column ai_steps text[] not null default '{}' check (cardinality(ai_steps) <= 3),
  add column ai_source text check (ai_source in ('metadata', 'video')),
  add column ai_claim_token uuid,
  add column ai_claim_until timestamptz,
  add column manual_folders boolean not null default false,
  add constraint saved_reference_ai_claim check (
    (ai_status = 'processing') = (ai_claim_token is not null and ai_claim_until is not null)
  ),
  add constraint saved_reference_ai_result check (
    (ai_status = 'ready') = (ai_summary is not null and ai_source is not null)
  );

-- Existing rows stay opt-in; new saves can claim once automatically.
alter table public.saved_references alter column ai_status set default 'pending';

create or replace function public.save_reference(
  p_platform text, p_post_id text, p_kind text, p_url text, p_folder_ids uuid[],
  p_share_id uuid default null
) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  account_id uuid := auth.uid();
  result_id uuid;
  share_manual_folders boolean := false;
  selected_folders boolean := coalesce(cardinality(p_folder_ids), 0) > 0;
begin
  if account_id is null then
    raise exception 'Sign-in required' using errcode = '42501';
  end if;

  if p_share_id is not null then
    select manual_folders into share_manual_folders from public.saved_references
      where owner_id = account_id and id = p_share_id and post_id is null and platform = p_platform
      for update;
    if not found then
      raise exception 'Share link could not be found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.saved_references as saved (owner_id, platform, post_id, kind, url, manual_folders)
  values (account_id, p_platform, p_post_id, p_kind, p_url, selected_folders or share_manual_folders)
  on conflict (owner_id, platform, identity_key) do update
    set manual_folders = saved.manual_folders or excluded.manual_folders
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

create or replace function public.set_reference_folders(p_reference_id uuid, p_folder_ids uuid[])
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  account_id uuid := auth.uid();
begin
  -- This update also serializes membership edits with finalizing analysis.
  update public.saved_references set manual_folders = true
    where owner_id = account_id and id = p_reference_id;
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

create function public.claim_reference_analysis(p_reference_id uuid, p_explicit boolean)
returns jsonb
language sql security invoker set search_path = ''
as $$
  update public.saved_references as saved
    set ai_status = 'processing', ai_claim_token = gen_random_uuid(),
        ai_claim_until = now() + interval '90 seconds'
    where owner_id = (select auth.uid()) and id = p_reference_id and post_id is not null
      and kind <> 'photo'
      and (ai_status = 'pending' or (p_explicit and (
        ai_status in ('unrequested', 'failed') or (ai_status = 'processing' and ai_claim_until <= now())
      )))
    returning jsonb_build_object(
      'token', saved.ai_claim_token, 'platform', saved.platform, 'kind', saved.kind,
      'post_id', saved.post_id, 'url', saved.url, 'manual_folders', saved.manual_folders or exists (
        select from public.folder_references as membership
          where membership.owner_id = saved.owner_id and membership.reference_id = saved.id
      )
    );
$$;

create function public.finish_reference_analysis(
  p_reference_id uuid, p_token uuid, p_status text, p_title text default null,
  p_summary text default null, p_steps text[] default '{}', p_source text default null,
  p_folder_id uuid default null, p_folder_name text default null
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  account_id uuid := auth.uid();
  folders_locked boolean;
  target_folder uuid;
begin
  if p_status is null or p_status not in ('ready', 'failed', 'unavailable', 'not_video') then
    raise exception 'Invalid analysis status' using errcode = '22023';
  end if;
  if p_status = 'ready' and (
    p_title is null or char_length(btrim(p_title)) not between 1 and 120 or
    p_summary is null or p_source is null or p_steps is null or cardinality(p_steps) > 3 or exists (
      select from unnest(p_steps) as step where step is null or char_length(btrim(step)) not between 1 and 200
    )
  ) then
    raise exception 'Invalid analysis result' using errcode = '22023';
  end if;

  update public.saved_references
    set ai_status = p_status, ai_claim_token = null, ai_claim_until = null,
        title = case when p_status = 'ready' then p_title else title end,
        ai_summary = case when p_status = 'ready' then p_summary end,
        ai_steps = case when p_status = 'ready' then p_steps else '{}'::text[] end,
        ai_source = case when p_status = 'ready' then p_source end
    where owner_id = account_id and id = p_reference_id and ai_status = 'processing'
      and ai_claim_token = p_token and ai_claim_until > now()
    returning manual_folders into folders_locked;
  if not found then
    return false;
  end if;

  if p_status = 'ready' and not folders_locked and not exists (
    select from public.folder_references where owner_id = account_id and reference_id = p_reference_id
  ) then
    if p_folder_id is not null then
      select id into target_folder from public.folders
        where owner_id = account_id and id = p_folder_id for key share;
    elsif char_length(btrim(p_folder_name)) between 1 and 60 then
      insert into public.folders as folder (owner_id, name) values (account_id, btrim(p_folder_name))
        on conflict (owner_id, lower(btrim(name))) do update set name = folder.name
        returning id into target_folder;
    end if;

    if target_folder is not null then
      insert into public.folder_references (owner_id, reference_id, folder_id)
        values (account_id, p_reference_id, target_folder) on conflict do nothing;
    end if;
  end if;
  return true;
end;
$$;

revoke execute on function public.claim_reference_analysis(uuid, boolean) from public, anon;
revoke execute on function public.finish_reference_analysis(uuid, uuid, text, text, text, text[], text, uuid, text) from public, anon;
grant execute on function public.claim_reference_analysis(uuid, boolean) to authenticated;
grant execute on function public.finish_reference_analysis(uuid, uuid, text, text, text, text[], text, uuid, text) to authenticated;
