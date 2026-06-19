create or replace function public.upsert_own_profile(
  p_full_name text default null,
  p_role text default 'passenger',
  p_avatar_url text default null,
  p_email text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.profiles (
    id,
    email,
    full_name,
    role,
    avatar_url,
    updated_at
  )
  values (
    auth.uid(),
    nullif(trim(coalesce(p_email, '')), ''),
    nullif(trim(coalesce(p_full_name, '')), ''),
    coalesce(nullif(trim(coalesce(p_role, '')), ''), 'passenger'),
    nullif(p_avatar_url, ''),
    now()
  )
  on conflict (id) do update
  set
    email = coalesce(excluded.email, public.profiles.email),
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    role = coalesce(excluded.role, public.profiles.role),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    updated_at = now()
  returning * into saved_profile;

  return saved_profile;
end;
$$;

revoke all on function public.upsert_own_profile(text, text, text, text) from public;
grant execute on function public.upsert_own_profile(text, text, text, text) to authenticated;
