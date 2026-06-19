create or replace function public.get_own_profile()
returns public.profiles
language sql
security definer
set search_path = public
stable
as $$
  select profiles.*
  from public.profiles
  where profiles.id = auth.uid()
  limit 1
$$;

revoke all on function public.get_own_profile() from public;
grant execute on function public.get_own_profile() to authenticated;
