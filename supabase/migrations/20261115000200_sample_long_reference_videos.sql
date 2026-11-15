alter table public.saved_references
  add column ai_video_window jsonb check (jsonb_typeof(ai_video_window) = 'object');

create function public.claim_reference_analysis(
  p_reference_id uuid, p_explicit boolean, p_refresh_legacy boolean, p_analyze_moment boolean
) returns jsonb
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
        or (ai_status = 'ready' and (
          (p_refresh_legacy and ai_version = 0)
          or (platform = 'youtube' and (p_analyze_moment or (p_refresh_legacy and ai_version < 2)))
        ))
      )))
    returning jsonb_build_object(
      'token', saved.ai_claim_token, 'platform', saved.platform, 'kind', saved.kind,
      'post_id', saved.post_id, 'url', saved.url, 'has_previous', saved.ai_summary is not null,
      'has_playbook', saved.ai_playbook is not null,
      'manual_folders', saved.manual_folders or exists (
        select from public.folder_references as membership
          where membership.owner_id = saved.owner_id and membership.reference_id = saved.id
      )
    );
$$;

create function public.finish_reference_analysis(
  p_reference_id uuid, p_token uuid, p_status text, p_playbook jsonb, p_video_window jsonb,
  p_title text default null, p_summary text default null, p_source text default null,
  p_folder_id uuid default null, p_folder_name text default null
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
begin
  if not public.finish_reference_analysis(
    p_reference_id, p_token, p_status, p_playbook, p_title, p_summary, p_source, p_folder_id, p_folder_name
  ) then
    return false;
  end if;

  if p_status = 'ready' then
    update public.saved_references set ai_version = 2, ai_video_window = p_video_window
      where owner_id = (select auth.uid()) and id = p_reference_id;
  end if;
  return true;
end;
$$;

revoke execute on function public.claim_reference_analysis(uuid, boolean, boolean, boolean) from public, anon;
revoke execute on function public.finish_reference_analysis(uuid, uuid, text, jsonb, jsonb, text, text, text, uuid, text) from public, anon;
grant execute on function public.claim_reference_analysis(uuid, boolean, boolean, boolean) to authenticated;
grant execute on function public.finish_reference_analysis(uuid, uuid, text, jsonb, jsonb, text, text, text, uuid, text) to authenticated;
