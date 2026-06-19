create or replace function public.upsert_own_driver_profile(
  p_full_name text default null,
  p_avatar_url text default null,
  p_email text default null
)
returns public.driver_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_driver public.driver_profiles;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.driver_profiles (
    user_id,
    full_name,
    avatar_url,
    email,
    verification_status,
    verified,
    is_online,
    is_available,
    updated_at
  )
  values (
    auth.uid(),
    nullif(trim(coalesce(p_full_name, '')), ''),
    nullif(p_avatar_url, ''),
    nullif(trim(coalesce(p_email, '')), ''),
    'approved',
    true,
    false,
    false,
    now()
  )
  on conflict (user_id) do update
  set
    full_name = coalesce(excluded.full_name, public.driver_profiles.full_name),
    avatar_url = coalesce(excluded.avatar_url, public.driver_profiles.avatar_url),
    email = coalesce(excluded.email, public.driver_profiles.email),
    verification_status = 'approved',
    verified = true,
    updated_at = now()
  returning * into saved_driver;

  return saved_driver;
end;
$$;

revoke all on function public.upsert_own_driver_profile(text, text, text) from public;
grant execute on function public.upsert_own_driver_profile(text, text, text) to authenticated;
