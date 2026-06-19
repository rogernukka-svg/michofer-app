alter table public.trips
  add column if not exists destination_lat double precision,
  add column if not exists destination_lng double precision,
  add column if not exists route_km numeric,
  add column if not exists vehicle_type text not null default 'car';

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.messages enable row level security;

alter table public.driver_profiles replica identity full;
alter table public.trips replica identity full;
alter table public.messages replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'driver_profiles'
  ) then
    alter publication supabase_realtime add table public.driver_profiles;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trips'
  ) then
    alter publication supabase_realtime add table public.trips;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

drop policy if exists "messages_select_trip_participants" on public.messages;
drop policy if exists "messages_insert_trip_participants" on public.messages;

create policy "messages_select_trip_participants"
  on public.messages for select
  using (
    exists (
      select 1
      from public.trips
      where trips.id = messages.trip_id
        and (trips.client_id = auth.uid() or trips.driver_id = auth.uid())
    )
  );

create policy "messages_insert_trip_participants"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1
      from public.trips
      where trips.id = messages.trip_id
        and (trips.client_id = auth.uid() or trips.driver_id = auth.uid())
    )
  );

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

create or replace function public.get_trip_contact_profile(p_trip_id uuid)
returns table (
  id uuid,
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
    profiles.id,
    profiles.full_name,
    profiles.role,
    profiles.avatar_url
  from public.trips
  join public.profiles
    on profiles.id = case
      when trips.client_id = auth.uid() then trips.driver_id
      when trips.driver_id = auth.uid() then trips.client_id
      else null
    end
  where trips.id = p_trip_id
    and (trips.client_id = auth.uid() or trips.driver_id = auth.uid())
  limit 1
$$;

revoke all on function public.get_trip_contact_profile(uuid) from public;
grant execute on function public.get_trip_contact_profile(uuid) to authenticated;

create or replace function public.get_own_driver_profile()
returns public.driver_profiles
language sql
security definer
set search_path = public
stable
as $$
  select driver_profiles.*
  from public.driver_profiles
  where driver_profiles.user_id = auth.uid()
  limit 1
$$;

revoke all on function public.get_own_driver_profile() from public;
grant execute on function public.get_own_driver_profile() to authenticated;

create or replace function public.update_own_driver_status(
  p_is_online boolean,
  p_is_available boolean,
  p_lat double precision default null,
  p_lng double precision default null
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
    lat,
    lng,
    updated_at
  )
  select
    profiles.id,
    coalesce(profiles.full_name, 'Chofer MiChofer'),
    profiles.avatar_url,
    profiles.email,
    'approved',
    true,
    p_is_online,
    p_is_available,
    p_lat,
    p_lng,
    now()
  from public.profiles
  where profiles.id = auth.uid()
  on conflict (user_id) do update
  set
    verification_status = 'approved',
    verified = true,
    is_online = excluded.is_online,
    is_available = excluded.is_available,
    lat = coalesce(excluded.lat, public.driver_profiles.lat),
    lng = coalesce(excluded.lng, public.driver_profiles.lng),
    updated_at = now()
  returning * into saved_driver;

  return saved_driver;
end;
$$;

revoke all on function public.update_own_driver_status(boolean, boolean, double precision, double precision) from public;
grant execute on function public.update_own_driver_status(boolean, boolean, double precision, double precision) to authenticated;

create or replace function public.get_available_drivers()
returns table (
  id uuid,
  user_id uuid,
  full_name text,
  avatar_url text,
  gender text,
  women_mode boolean,
  is_online boolean,
  is_available boolean,
  lat double precision,
  lng double precision,
  car_brand text,
  car_model text,
  car_color text,
  plate text,
  rating numeric,
  total_trips integer,
  verified boolean,
  verification_status text,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    driver_profiles.id,
    driver_profiles.user_id,
    driver_profiles.full_name,
    driver_profiles.avatar_url,
    driver_profiles.gender,
    driver_profiles.women_mode,
    driver_profiles.is_online,
    driver_profiles.is_available,
    driver_profiles.lat,
    driver_profiles.lng,
    driver_profiles.car_brand,
    driver_profiles.car_model,
    driver_profiles.car_color,
    driver_profiles.plate,
    driver_profiles.rating,
    driver_profiles.total_trips,
    driver_profiles.verified,
    driver_profiles.verification_status,
    driver_profiles.updated_at
  from public.driver_profiles
  where driver_profiles.is_online = true
    and driver_profiles.is_available = true
    and driver_profiles.lat is not null
    and driver_profiles.lng is not null
  order by driver_profiles.updated_at desc
  limit 50
$$;

revoke all on function public.get_available_drivers() from public;
grant execute on function public.get_available_drivers() to anon, authenticated;

create or replace function public.request_trip(
  p_driver_id uuid,
  p_destination_text text,
  p_destination_lat double precision default null,
  p_destination_lng double precision default null,
  p_pickup_lat double precision default null,
  p_pickup_lng double precision default null,
  p_driver_lat double precision default null,
  p_driver_lng double precision default null,
  p_route_km numeric default null,
  p_price integer default null,
  p_payment_method text default 'cash',
  p_women_mode boolean default false
)
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

  if p_driver_id is null then
    raise exception 'driver_id required';
  end if;

  if nullif(trim(coalesce(p_destination_text, '')), '') is null then
    raise exception 'destination required';
  end if;

  if not exists (
    select 1
    from public.driver_profiles
    where driver_profiles.user_id = p_driver_id
      and driver_profiles.is_online = true
      and driver_profiles.is_available = true
  ) then
    raise exception 'El chofer ya no esta disponible';
  end if;

  update public.trips
  set status = 'cancelled', updated_at = now()
  where client_id = auth.uid()
    and status = 'pending';

  insert into public.trips (
    client_id,
    driver_id,
    destination_text,
    destination_lat,
    destination_lng,
    pickup_lat,
    pickup_lng,
    driver_lat,
    driver_lng,
    route_km,
    vehicle_type,
    price,
    payment_method,
    status,
    women_mode,
    created_at,
    updated_at
  )
  values (
    auth.uid(),
    p_driver_id,
    trim(p_destination_text),
    p_destination_lat,
    p_destination_lng,
    p_pickup_lat,
    p_pickup_lng,
    p_driver_lat,
    p_driver_lng,
    p_route_km,
    'car',
    p_price,
    coalesce(nullif(trim(coalesce(p_payment_method, '')), ''), 'cash'),
    'pending',
    coalesce(p_women_mode, false),
    now(),
    now()
  )
  returning * into saved_trip;

  return saved_trip;
end;
$$;

revoke all on function public.request_trip(uuid, text, double precision, double precision, double precision, double precision, double precision, double precision, numeric, integer, text, boolean) from public;
grant execute on function public.request_trip(uuid, text, double precision, double precision, double precision, double precision, double precision, double precision, numeric, integer, text, boolean) to authenticated;

create or replace function public.get_own_driver_trips()
returns setof public.trips
language sql
security definer
set search_path = public
stable
as $$
  select trips.*
  from public.trips
  where trips.driver_id = auth.uid()
    and trips.status in ('pending', 'accepted', 'arriving', 'in_progress')
  order by trips.created_at desc
$$;

revoke all on function public.get_own_driver_trips() from public;
grant execute on function public.get_own_driver_trips() to authenticated;

update public.driver_profiles
set
  verification_status = 'approved',
  verified = true,
  updated_at = now()
where verified is distinct from true
   or verification_status is distinct from 'approved';
