-- Allow users to explicitly recheck posts after an inconclusive lookup.
create or replace function public.claim_reference_analysis(p_reference_id uuid, p_explicit boolean)
returns jsonb
language sql security invoker set search_path = ''
as $$
  update public.saved_references as saved
    set ai_status = 'processing', ai_claim_token = gen_random_uuid(),
        ai_claim_until = now() + interval '90 seconds'
    where owner_id = (select auth.uid()) and id = p_reference_id and post_id is not null
      and kind <> 'photo'
      and (ai_status = 'pending' or (p_explicit and (
        ai_status in ('unrequested', 'failed', 'unavailable', 'not_video') or (ai_status = 'processing' and ai_claim_until <= now())
      )))
    returning jsonb_build_object(
      'token', saved.ai_claim_token, 'platform', saved.platform, 'kind', saved.kind,
      'post_id', saved.post_id, 'url', saved.url, 'manual_folders', saved.manual_folders or exists (
        select from public.folder_references as membership
          where membership.owner_id = saved.owner_id and membership.reference_id = saved.id
      )
    );
$$;
