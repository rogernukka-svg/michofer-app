create or replace function public.cancel_own_trip_v2(p_trip_id uuid)
returns public.trips
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_trip public.trips;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.trips
  set
    status = 'cancelled',
    updated_at = now()
  where id = p_trip_id
    and client_id = auth.uid()
    and status in ('pending', 'accepted', 'arriving', 'in_progress')
  returning * into saved_trip;

  if saved_trip.id is null then
    raise exception 'trip not found or cannot be cancelled';
  end if;

  update public.driver_profiles
  set
    is_available = true,
    updated_at = now()
  where user_id = saved_trip.driver_id
    and not exists (
      select 1
      from public.trips active_trip
      where active_trip.driver_id = saved_trip.driver_id
        and active_trip.id <> saved_trip.id
        and active_trip.status in ('pending', 'accepted', 'arriving', 'in_progress')
    );

  return saved_trip;
end;
$$;

revoke all on function public.cancel_own_trip_v2(uuid) from public;
grant execute on function public.cancel_own_trip_v2(uuid) to authenticated;
