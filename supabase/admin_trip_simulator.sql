alter table if exists public.trips
  add column if not exists is_test boolean not null default false,
  add column if not exists created_by_admin uuid null references public.profiles(id) on delete set null,
  add column if not exists driver_heading double precision,
  add column if not exists driver_speed double precision,
  add column if not exists driver_accuracy double precision,
  add column if not exists ride_category text default 'all';

alter table if exists public.driver_profiles
  add column if not exists heading double precision,
  add column if not exists speed double precision,
  add column if not exists accuracy double precision;

create or replace function public.is_admin_user(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = p_user_id
      and role = 'admin'
  );
$$;

create or replace function public.admin_create_test_trip(
  p_client_id uuid,
  p_driver_id uuid,
  p_pickup_lat double precision,
  p_pickup_lng double precision,
  p_destination_lat double precision,
  p_destination_lng double precision,
  p_destination_text text default 'Viaje test admin',
  p_route_km numeric default null,
  p_price integer default 25000
)
returns public.trips
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_trip public.trips;
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception 'not authorized';
  end if;

  insert into public.trips (
    client_id,
    driver_id,
    status,
    pickup_lat,
    pickup_lng,
    destination_lat,
    destination_lng,
    destination_text,
    driver_lat,
    driver_lng,
    driver_heading,
    driver_speed,
    driver_accuracy,
    route_km,
    price,
    payment_method,
    ride_category,
    is_test,
    created_by_admin,
    updated_at
  )
  values (
    p_client_id,
    p_driver_id,
    'pending',
    p_pickup_lat,
    p_pickup_lng,
    p_destination_lat,
    p_destination_lng,
    coalesce(nullif(trim(p_destination_text), ''), 'Viaje test admin'),
    p_pickup_lat,
    p_pickup_lng,
    0,
    0,
    10,
    p_route_km,
    p_price,
    'cash',
    'all',
    true,
    auth.uid(),
    now()
  )
  returning * into saved_trip;

  return saved_trip;
end;
$$;

create or replace function public.admin_update_test_trip_location(
  p_trip_id uuid,
  p_driver_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_heading double precision default null,
  p_speed double precision default 0,
  p_accuracy double precision default 10,
  p_status text default null
)
returns public.trips
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_trip public.trips;
  safe_status text;
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception 'not authorized';
  end if;

  if p_status in ('pending', 'accepted', 'arriving', 'in_progress', 'completed', 'cancelled') then
    safe_status := p_status;
  end if;

  update public.trips
  set
    driver_lat = p_lat,
    driver_lng = p_lng,
    driver_heading = p_heading,
    driver_speed = p_speed,
    driver_accuracy = p_accuracy,
    status = coalesce(safe_status, status),
    updated_at = now()
  where id = p_trip_id
    and is_test = true
  returning * into saved_trip;

  if saved_trip.id is null then
    raise exception 'test trip not found';
  end if;

  return saved_trip;
end;
$$;

create or replace function public.admin_update_test_trip_status(
  p_trip_id uuid,
  p_status text
)
returns public.trips
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_trip public.trips;
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception 'not authorized';
  end if;

  if p_status not in ('pending', 'accepted', 'arriving', 'in_progress', 'completed', 'cancelled') then
    raise exception 'invalid status';
  end if;

  update public.trips
  set status = p_status,
      updated_at = now()
  where id = p_trip_id
    and is_test = true
  returning * into saved_trip;

  if saved_trip.id is null then
    raise exception 'test trip not found';
  end if;

  return saved_trip;
end;
$$;

grant execute on function public.is_admin_user(uuid) to authenticated;
grant execute on function public.admin_create_test_trip(uuid, uuid, double precision, double precision, double precision, double precision, text, numeric, integer) to authenticated;
grant execute on function public.admin_update_test_trip_location(uuid, uuid, double precision, double precision, double precision, double precision, double precision, text) to authenticated;
grant execute on function public.admin_update_test_trip_status(uuid, text) to authenticated;
