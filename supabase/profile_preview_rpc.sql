create or replace function public.get_profile_preview_by_email(lookup_email text)
returns table (
  full_name text,
  role text,
  avatar_url text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    profiles.full_name,
    profiles.role,
    profiles.avatar_url
  from public.profiles
  where lower(coalesce(profiles.email, '')) = lower(trim(coalesce(lookup_email, '')))
  limit 1
$$;

revoke all on function public.get_profile_preview_by_email(text) from public;
grant execute on function public.get_profile_preview_by_email(text) to anon, authenticated;
