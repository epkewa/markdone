alter table public.saved_references
  drop constraint saved_references_platform_check,
  drop constraint saved_references_kind_check,
  add constraint saved_references_platform_check
    check (platform in ('youtube', 'instagram', 'tiktok', 'x', 'pinterest')),
  add constraint saved_references_kind_check
    check (kind in ('video', 'shorts', 'p', 'reel', 'tv', 'photo', 'post', 'share', 'pin'));
