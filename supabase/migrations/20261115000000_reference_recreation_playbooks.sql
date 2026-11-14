alter table public.saved_references
  add column ai_version smallint not null default 0 check (ai_version >= 0),
  add column ai_playbook jsonb,
  drop constraint saved_reference_ai_result,
  add constraint saved_reference_ai_result check (
    (ai_summary is null) = (ai_source is null)
    and (ai_status = 'processing' or (ai_status = 'ready') = (ai_summary is not null))
  ),
  add constraint saved_reference_ai_playbook check (
    ai_playbook is null or (
      ai_source is not distinct from 'video' and ai_version >= 1 and jsonb_typeof(ai_playbook) = 'object'
    )
  );

-- Keep the earlier RPC signatures available during an app rollout.
create function public.claim_reference_analysis(p_reference_id uuid, p_explicit boolean, p_refresh_legacy boolean)
returns jsonb
language sql security invoker set search_path = ''
as $$
  update public.saved_references as saved
    set ai_status = 'processing', ai_claim_token = gen_random_uuid(),
        ai_claim_until = now() + interval '90 seconds'
    where owner_id = (select auth.uid()) and id = p_reference_id and post_id is not null
      and kind <> 'photo'
      and (ai_status = 'pending' or (p_explicit and (
        ai_status in ('unrequested', 'failed', 'unavailable', 'not_video')
        or (ai_status = 'processing' and ai_claim_until <= now())
        or (p_refresh_legacy and ai_status = 'ready' and ai_version = 0)
      )))
    returning jsonb_build_object(
      'token', saved.ai_claim_token, 'platform', saved.platform, 'kind', saved.kind,
      'post_id', saved.post_id, 'url', saved.url, 'has_previous', saved.ai_summary is not null,
      'manual_folders', saved.manual_folders or exists (
        select from public.folder_references as membership
          where membership.owner_id = saved.owner_id and membership.reference_id = saved.id
      )
    );
$$;

create function public.finish_reference_analysis(
  p_reference_id uuid, p_token uuid, p_status text, p_playbook jsonb,
  p_title text default null, p_summary text default null, p_source text default null,
  p_folder_id uuid default null, p_folder_name text default null
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
begin
  if p_status in ('failed', 'unavailable', 'not_video') then
    update public.saved_references
      set ai_status = 'ready', ai_claim_token = null, ai_claim_until = null
      where owner_id = (select auth.uid()) and id = p_reference_id
        and ai_status = 'processing' and ai_claim_token = p_token and ai_claim_until > now()
        and ai_summary is not null;
    if found then
      return true;
    end if;
  end if;

  -- The existing finish function validates the claim and holds the row lock
  -- through the playbook update in this transaction.
  if not public.finish_reference_analysis(
    p_reference_id, p_token, p_status, p_title, p_summary, '{}'::text[], p_source, p_folder_id, p_folder_name
  ) then
    return false;
  end if;

  if p_status = 'ready' then
    update public.saved_references set ai_version = 1, ai_playbook = p_playbook
      where owner_id = (select auth.uid()) and id = p_reference_id;
  end if;
  return true;
end;
$$;

revoke execute on function public.claim_reference_analysis(uuid, boolean, boolean) from public, anon;
revoke execute on function public.finish_reference_analysis(uuid, uuid, text, jsonb, text, text, text, uuid, text) from public, anon;
grant execute on function public.claim_reference_analysis(uuid, boolean, boolean) to authenticated;
grant execute on function public.finish_reference_analysis(uuid, uuid, text, jsonb, text, text, text, uuid, text) to authenticated;
