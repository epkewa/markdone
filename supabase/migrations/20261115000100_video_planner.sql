alter table public.saved_references
  add column playbook_search tsvector generated always as (
    case when ai_playbook is not null then
      setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') ||
      setweight(to_tsvector('english'::regconfig, coalesce(ai_summary, '') || ' ' ||
        coalesce(ai_playbook ->> 'observation', '')), 'B') ||
      setweight(jsonb_to_tsvector('english'::regconfig, ai_playbook - 'observation', '["string"]'::jsonb), 'C')
    end
  ) stored;

create index saved_references_playbook_search on public.saved_references
  using gin (playbook_search) where ai_playbook is not null;

create function public.search_video_playbooks(p_terms text[])
returns table(id uuid, title text, platform text, kind text, ai_summary text, ai_playbook jsonb)
language sql stable security invoker set search_path = ''
as $$
  with terms as (
    select plainto_tsquery('english'::regconfig, left(term, 80)) as q
      from unnest(p_terms) with ordinality as input(term, position)
      where position <= 12
  ),
  search as (
    select string_agg(q::text, ' | ')::tsquery as q from terms where numnode(q) > 0
  )
  select r.id, r.title, r.platform, r.kind, r.ai_summary, r.ai_playbook
    from public.saved_references r cross join search
    where r.owner_id = (select auth.uid()) and r.ai_playbook is not null
      and r.playbook_search @@ search.q
    order by ts_rank(r.playbook_search, search.q) desc, r.created_at desc, r.id desc
    limit 12;
$$;

create table public.video_plan_chats (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  last_turn integer not null default 0 check (last_turn >= 0),
  updated_at timestamptz not null default now(),
  unique (owner_id, id)
);

create index video_plan_chats_recent on public.video_plan_chats (owner_id, updated_at desc, id desc);

create table public.video_plan_turns (
  owner_id uuid not null default auth.uid(),
  chat_id uuid not null,
  turn_number integer not null check (turn_number > 0),
  request_id uuid not null,
  prompt text not null check (char_length(btrim(prompt)) between 1 and 2000),
  reply jsonb not null check (jsonb_typeof(reply) = 'object'),
  primary key (owner_id, chat_id, turn_number),
  unique (owner_id, request_id),
  foreign key (owner_id, chat_id) references public.video_plan_chats (owner_id, id) on delete cascade
);

alter table public.video_plan_chats enable row level security;
alter table public.video_plan_turns enable row level security;

create policy "Own video planning chats" on public.video_plan_chats for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Read own video planning turns" on public.video_plan_turns for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Add own video planning turns" on public.video_plan_turns for insert to authenticated
  with check ((select auth.uid()) = owner_id);

revoke all on public.video_plan_chats, public.video_plan_turns from public, anon, authenticated;
grant select, insert, update, delete on public.video_plan_chats to authenticated;
grant select, insert on public.video_plan_turns to authenticated;

-- Generation happens before this short transaction. A retried request returns
-- its saved turn; different requests compete only on the chat's turn number.
create function public.append_video_plan_turn(
  p_chat_id uuid, p_expected_turn integer, p_request_id uuid, p_prompt text, p_reply jsonb
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  account_id uuid := auth.uid();
  chat public.video_plan_chats;
  prior public.video_plan_turns;
begin
  if account_id is null then
    raise exception 'Sign-in required' using errcode = '42501';
  end if;
  if p_request_id is null or p_expected_turn is null or p_expected_turn < 0 then
    raise exception 'Invalid planner request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(account_id::text || p_request_id::text, 0));
  select * into prior from public.video_plan_turns
    where owner_id = account_id and request_id = p_request_id;
  if found then
    if (p_chat_id is not null and prior.chat_id <> p_chat_id)
      or prior.turn_number - 1 <> p_expected_turn or prior.prompt is distinct from p_prompt then
      return jsonb_build_object('status', 'conflict');
    end if;
    return jsonb_build_object('status', 'saved', 'chatId', prior.chat_id, 'turn', prior.turn_number);
  end if;

  if p_chat_id is null then
    if p_expected_turn <> 0 then
      return jsonb_build_object('status', 'conflict');
    end if;
    insert into public.video_plan_chats (owner_id, title, last_turn)
      values (account_id, left(btrim(regexp_replace(p_prompt, '[[:space:]]+', ' ', 'g')), 80), 1)
      returning * into chat;
  else
    update public.video_plan_chats
      set last_turn = last_turn + 1, updated_at = now()
      where owner_id = account_id and id = p_chat_id and last_turn = p_expected_turn
      returning * into chat;
    if not found then
      return jsonb_build_object('status', 'conflict');
    end if;
  end if;

  insert into public.video_plan_turns (owner_id, chat_id, turn_number, request_id, prompt, reply)
    values (account_id, chat.id, chat.last_turn, p_request_id, p_prompt, p_reply);
  return jsonb_build_object('status', 'saved', 'chatId', chat.id, 'turn', chat.last_turn);
end;
$$;

revoke execute on function public.search_video_playbooks(text[]) from public, anon;
revoke execute on function public.append_video_plan_turn(uuid, integer, uuid, text, jsonb) from public, anon;
grant execute on function public.search_video_playbooks(text[]) to authenticated;
grant execute on function public.append_video_plan_turn(uuid, integer, uuid, text, jsonb) to authenticated;
