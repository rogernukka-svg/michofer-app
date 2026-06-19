-- MiChofer mobility foundation.
-- Run this in Supabase SQL Editor after the base schema.
-- It is idempotent and adapts the product brief to this Vite app's driver_profiles table.

alter table public.profiles
  add column if not exists gender_identity text,
  add column if not exists gender_visibility text not null default 'private',
  add column if not exists women_mode_requested boolean not null default false,
  add column if not exists women_mode_status text not null default 'not_requested',
  add column if not exists women_mode_verified boolean not null default false,
  add column if not exists women_mode_verified_at timestamptz,
  add column if not exists women_mode_verified_by uuid references auth.users(id),
  add column if not exists preferred_language text not null default 'es',
  add column if not exists student_mode_requested boolean not null default false,
  add column if not exists university_name text,
  add column if not exists campus_zone text,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text;

alter table public.driver_profiles
  add column if not exists driver_type text not null default 'auto',
  add column if not exists vehicle_category text not null default 'auto_standard',
  add column if not exists available_categories text[] not null default array['auto_standard']::text[],
  add column if not exists requested_categories text[] not null default '{}'::text[],
  add column if not exists approved_categories text[] not null default '{}'::text[],
  add column if not exists women_driver_requested boolean not null default false,
  add column if not exists women_driver_verified boolean not null default false,
  add column if not exists women_driver_status text not null default 'not_requested',
  add column if not exists women_driver_verified_at timestamptz,
  add column if not exists women_driver_verified_by uuid references auth.users(id),
  add column if not exists premium_status text not null default 'not_requested',
  add column if not exists premium_verified_at timestamptz,
  add column if not exists premium_verified_by uuid references auth.users(id),
  add column if not exists vehicle_make text,
  add column if not exists vehicle_model text,
  add column if not exists vehicle_color text,
  add column if not exists vehicle_plate text,
  add column if not exists vehicle_doors integer,
  add column if not exists has_ac boolean,
  add column if not exists moto_brand text,
  add column if not exists moto_model text,
  add column if not exists moto_year integer,
  add column if not exists moto_plate text,
  add column if not exists has_extra_helmet boolean not null default false,
  add column if not exists has_reflective_vest boolean not null default false,
  add column if not exists accepts_campus_rides boolean not null default false,
  add column if not exists accepts_scheduled_rides boolean not null default true;

alter table public.trips
  add column if not exists ride_category text not null default 'auto_standard',
  add column if not exists safety_mode text not null default 'standard';

do $$
begin
  alter table public.profiles
    add constraint profiles_gender_identity_check
    check (gender_identity is null or gender_identity in ('woman', 'man', 'non_binary', 'prefer_not_to_say'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.profiles
    add constraint profiles_women_mode_status_check
    check (women_mode_status in ('not_requested', 'requested', 'verified', 'rejected'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.driver_profiles
    add constraint driver_profiles_driver_type_check
    check (driver_type in ('auto', 'moto', 'auto_and_moto'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.driver_profiles
    add constraint driver_profiles_vehicle_category_check
    check (vehicle_category in ('auto_standard', 'moto', 'comfort', 'premium', 'black', 'deportivo', 'campus'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.driver_profiles
    add constraint driver_profiles_women_driver_status_check
    check (women_driver_status in ('not_requested', 'requested', 'verified', 'rejected'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.driver_profiles
    add constraint driver_profiles_premium_status_check
    check (premium_status in ('not_requested', 'requested', 'approved', 'rejected'));
exception
  when duplicate_object then null;
end $$;

create table if not exists public.ride_categories (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  description text,
  type text not null check (type in ('auto', 'moto', 'premium', 'women', 'campus')),
  min_vehicle_year integer,
  requires_ac boolean not null default false,
  requires_manual_approval boolean not null default false,
  requires_women_driver boolean not null default false,
  requires_women_passenger boolean not null default false,
  base_multiplier numeric not null default 1.0,
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.ride_categories (
  code,
  name,
  description,
  type,
  min_vehicle_year,
  requires_ac,
  requires_manual_approval,
  requires_women_driver,
  requires_women_passenger,
  base_multiplier,
  sort_order
)
values
  ('auto_standard', 'MiChofer Auto', 'Viaje estandar con chofer verificado.', 'auto', null, false, false, false, false, 1.00, 10),
  ('moto', 'MiChofer Moto', 'Rapido para trayectos cortos, con casco extra obligatorio.', 'moto', null, false, true, false, false, 0.72, 20),
  ('comfort', 'MiChofer Comfort', 'Auto comodo con aire acondicionado.', 'auto', 2014, true, true, false, false, 1.18, 30),
  ('ella', 'MiChofer Ella', 'Pasajeras verificadas con conductoras verificadas por MiChofer.', 'women', null, false, true, true, true, 1.12, 40),
  ('premium', 'MiChofer Premium', 'Autos seleccionados para aeropuerto, eventos y noche.', 'premium', 2018, true, true, false, false, 1.45, 50),
  ('black', 'MiChofer Black', 'Autos ejecutivos aprobados manualmente.', 'premium', 2018, true, true, false, false, 1.75, 60),
  ('deportivo', 'MiChofer Deportivo', 'Categoria curada para experiencias, eventos y marketing.', 'premium', 2016, true, true, false, false, 2.10, 70),
  ('campus', 'MiChofer Campus', 'Rutas para universidad, residencia, hospital y guardia.', 'campus', null, false, true, false, false, 0.95, 80)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  type = excluded.type,
  min_vehicle_year = excluded.min_vehicle_year,
  requires_ac = excluded.requires_ac,
  requires_manual_approval = excluded.requires_manual_approval,
  requires_women_driver = excluded.requires_women_driver,
  requires_women_passenger = excluded.requires_women_passenger,
  base_multiplier = excluded.base_multiplier,
  active = true,
  sort_order = excluded.sort_order,
  updated_at = now();

create table if not exists public.category_approval_requests (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.driver_profiles(user_id) on delete cascade,
  category_code text not null references public.ride_categories(code),
  status text not null default 'requested' check (status in ('requested', 'in_review', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists category_approval_requests_worker_category_idx
  on public.category_approval_requests(worker_id, category_code);

create table if not exists public.safety_verification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references auth.users(id),
  event_type text not null,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ride_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  preferred_category text references public.ride_categories(code),
  women_only boolean not null default false,
  campus_mode boolean not null default false,
  premium_mode boolean not null default false,
  language_preference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ride_categories enable row level security;
alter table public.category_approval_requests enable row level security;
alter table public.safety_verification_events enable row level security;
alter table public.ride_preferences enable row level security;

create or replace function public.is_admin_user()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
$$;

revoke all on function public.is_admin_user() from public;
grant execute on function public.is_admin_user() to authenticated;

drop policy if exists "ride_categories_public_select" on public.ride_categories;
create policy "ride_categories_public_select"
  on public.ride_categories for select
  using (active = true or public.is_admin_user());

drop policy if exists "category_requests_select_own_or_admin" on public.category_approval_requests;
create policy "category_requests_select_own_or_admin"
  on public.category_approval_requests for select
  using (worker_id = auth.uid() or public.is_admin_user());

drop policy if exists "category_requests_insert_own" on public.category_approval_requests;
create policy "category_requests_insert_own"
  on public.category_approval_requests for insert
  with check (worker_id = auth.uid());

drop policy if exists "category_requests_admin_update" on public.category_approval_requests;
create policy "category_requests_admin_update"
  on public.category_approval_requests for update
  using (public.is_admin_user())
  with check (public.is_admin_user());

drop policy if exists "safety_events_select_own_or_admin" on public.safety_verification_events;
create policy "safety_events_select_own_or_admin"
  on public.safety_verification_events for select
  using (user_id = auth.uid() or actor_id = auth.uid() or public.is_admin_user());

drop policy if exists "safety_events_insert_own_or_admin" on public.safety_verification_events;
create policy "safety_events_insert_own_or_admin"
  on public.safety_verification_events for insert
  with check (user_id = auth.uid() or actor_id = auth.uid() or public.is_admin_user());

drop policy if exists "ride_preferences_select_own" on public.ride_preferences;
create policy "ride_preferences_select_own"
  on public.ride_preferences for select
  using (user_id = auth.uid() or public.is_admin_user());

drop policy if exists "ride_preferences_write_own" on public.ride_preferences;
create policy "ride_preferences_write_own"
  on public.ride_preferences for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "profiles_admin_select" on public.profiles;
create policy "profiles_admin_select"
  on public.profiles for select
  using (public.is_admin_user());

drop policy if exists "profiles_admin_update_safety" on public.profiles;
create policy "profiles_admin_update_safety"
  on public.profiles for update
  using (public.is_admin_user())
  with check (public.is_admin_user());

drop policy if exists "driver_profiles_admin_select" on public.driver_profiles;
create policy "driver_profiles_admin_select"
  on public.driver_profiles for select
  using (public.is_admin_user());

drop policy if exists "driver_profiles_admin_update" on public.driver_profiles;
create policy "driver_profiles_admin_update"
  on public.driver_profiles for update
  using (public.is_admin_user())
  with check (public.is_admin_user());

drop policy if exists "driver_documents_admin_read" on storage.objects;
create policy "driver_documents_admin_read"
  on storage.objects for select
  using (
    bucket_id = 'driver-documents'
    and public.is_admin_user()
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
    requested_categories,
    available_categories,
    updated_at
  )
  values (
    auth.uid(),
    nullif(trim(coalesce(p_full_name, '')), ''),
    nullif(p_avatar_url, ''),
    nullif(trim(coalesce(p_email, '')), ''),
    'submitted',
    false,
    false,
    false,
    array['auto_standard']::text[],
    array['auto_standard']::text[],
    now()
  )
  on conflict (user_id) do update
  set
    full_name = coalesce(excluded.full_name, public.driver_profiles.full_name),
    avatar_url = coalesce(excluded.avatar_url, public.driver_profiles.avatar_url),
    email = coalesce(excluded.email, public.driver_profiles.email),
    verification_status = case
      when public.driver_profiles.verification_status = 'approved' then 'approved'
      else 'submitted'
    end,
    verified = case
      when public.driver_profiles.verification_status = 'approved' then public.driver_profiles.verified
      else false
    end,
    is_online = case
      when public.driver_profiles.verification_status = 'approved' then public.driver_profiles.is_online
      else false
    end,
    is_available = case
      when public.driver_profiles.verification_status = 'approved' then public.driver_profiles.is_available
      else false
    end,
    requested_categories = case
      when 'auto_standard' = any(public.driver_profiles.requested_categories) then public.driver_profiles.requested_categories
      else public.driver_profiles.requested_categories || array['auto_standard']::text[]
    end,
    available_categories = case
      when 'auto_standard' = any(public.driver_profiles.available_categories) then public.driver_profiles.available_categories
      else public.driver_profiles.available_categories || array['auto_standard']::text[]
    end,
    updated_at = now()
  returning * into saved_driver;

  return saved_driver;
end;
$$;

revoke all on function public.upsert_own_driver_profile(text, text, text) from public;
grant execute on function public.upsert_own_driver_profile(text, text, text) to authenticated;

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

  select *
  into saved_driver
  from public.driver_profiles
  where user_id = auth.uid()
  limit 1;

  if saved_driver.user_id is null then
    saved_driver := public.upsert_own_driver_profile(null, null, null);
  end if;

  if coalesce(p_is_online, false) = true
     and (saved_driver.verified is distinct from true or saved_driver.verification_status is distinct from 'approved') then
    raise exception 'Tu perfil de chofer esta pendiente de aprobacion';
  end if;

  update public.driver_profiles
  set
    is_online = coalesce(p_is_online, false),
    is_available = case
      when coalesce(p_is_online, false) = true then coalesce(p_is_available, false)
      else false
    end,
    lat = coalesce(p_lat, public.driver_profiles.lat),
    lng = coalesce(p_lng, public.driver_profiles.lng),
    updated_at = now()
  where user_id = auth.uid()
  returning * into saved_driver;

  return saved_driver;
end;
$$;

revoke all on function public.update_own_driver_status(boolean, boolean, double precision, double precision) from public;
grant execute on function public.update_own_driver_status(boolean, boolean, double precision, double precision) to authenticated;

create or replace function public.request_women_mode(p_gender_identity text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_profile public.profiles;
  normalized_gender text := coalesce(nullif(trim(p_gender_identity), ''), 'prefer_not_to_say');
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if normalized_gender not in ('woman', 'man', 'non_binary', 'prefer_not_to_say') then
    raise exception 'gender_identity invalid';
  end if;

  update public.profiles
  set
    gender_identity = normalized_gender,
    gender_visibility = 'private',
    women_mode_requested = normalized_gender = 'woman',
    women_mode_status = case
      when women_mode_status = 'verified' then 'verified'
      when normalized_gender = 'woman' then 'requested'
      else 'not_requested'
    end,
    women_mode_verified = case
      when women_mode_status = 'verified' then true
      else false
    end,
    updated_at = now()
  where id = auth.uid()
  returning * into saved_profile;

  if saved_profile.id is null then
    raise exception 'profile required';
  end if;

  insert into public.safety_verification_events (user_id, actor_id, event_type, message, metadata)
  values (
    auth.uid(),
    auth.uid(),
    'women_mode_requested',
    'Solicitud de MiChofer Ella creada por la usuaria.',
    jsonb_build_object('gender_identity', normalized_gender)
  );

  return saved_profile;
end;
$$;

revoke all on function public.request_women_mode(text) from public;
grant execute on function public.request_women_mode(text) to authenticated;

create or replace function public.admin_review_women_mode(
  p_user_id uuid,
  p_decision text,
  p_reason text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_profile public.profiles;
  approved boolean := lower(coalesce(p_decision, '')) in ('approved', 'approve', 'verified');
begin
  if not public.is_admin_user() then
    raise exception 'admin only';
  end if;

  update public.profiles
  set
    women_mode_status = case when approved then 'verified' else 'rejected' end,
    women_mode_verified = approved,
    women_mode_verified_at = case when approved then now() else null end,
    women_mode_verified_by = case when approved then auth.uid() else null end,
    updated_at = now()
  where id = p_user_id
  returning * into saved_profile;

  if saved_profile.id is null then
    raise exception 'profile not found';
  end if;

  insert into public.safety_verification_events (user_id, actor_id, event_type, message, metadata)
  values (
    p_user_id,
    auth.uid(),
    case when approved then 'women_mode_approved' else 'women_mode_rejected' end,
    coalesce(p_reason, case when approved then 'MiChofer Ella aprobado.' else 'MiChofer Ella rechazado.' end),
    '{}'::jsonb
  );

  return saved_profile;
end;
$$;

revoke all on function public.admin_review_women_mode(uuid, text, text) from public;
grant execute on function public.admin_review_women_mode(uuid, text, text) to authenticated;

create or replace function public.request_driver_category(p_category_code text)
returns public.category_approval_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text := lower(trim(coalesce(p_category_code, '')));
  saved_request public.category_approval_requests;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not exists (select 1 from public.ride_categories where code = normalized_code and active = true) then
    raise exception 'category invalid';
  end if;

  perform public.upsert_own_driver_profile(null, null, null);

  update public.driver_profiles
  set
    requested_categories = (
      select array(
        select distinct item
        from unnest(public.driver_profiles.requested_categories || array[normalized_code]::text[]) as item
      )
    ),
    women_driver_requested = case when normalized_code = 'ella' then true else women_driver_requested end,
    women_driver_status = case
      when normalized_code = 'ella' and women_driver_status <> 'verified' then 'requested'
      else women_driver_status
    end,
    premium_status = case
      when normalized_code in ('premium', 'black', 'deportivo') and premium_status <> 'approved' then 'requested'
      else premium_status
    end,
    updated_at = now()
  where user_id = auth.uid();

  insert into public.category_approval_requests (worker_id, category_code, status, metadata, updated_at)
  values (auth.uid(), normalized_code, 'requested', '{}'::jsonb, now())
  on conflict (worker_id, category_code) do update
  set
    status = case
      when public.category_approval_requests.status = 'approved' then 'approved'
      else 'requested'
    end,
    rejection_reason = null,
    updated_at = now()
  returning * into saved_request;

  insert into public.safety_verification_events (user_id, actor_id, event_type, message, metadata)
  values (
    auth.uid(),
    auth.uid(),
    'driver_category_requested',
    'Chofer solicito categoria ' || normalized_code || '.',
    jsonb_build_object('category_code', normalized_code)
  );

  return saved_request;
end;
$$;

revoke all on function public.request_driver_category(text) from public;
grant execute on function public.request_driver_category(text) to authenticated;

create or replace function public.admin_review_driver_category(
  p_worker_id uuid,
  p_category_code text,
  p_decision text,
  p_reason text default null
)
returns public.category_approval_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text := lower(trim(coalesce(p_category_code, '')));
  approved boolean := lower(coalesce(p_decision, '')) in ('approved', 'approve');
  saved_request public.category_approval_requests;
begin
  if not public.is_admin_user() then
    raise exception 'admin only';
  end if;

  update public.category_approval_requests
  set
    status = case when approved then 'approved' else 'rejected' end,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    rejection_reason = case when approved then null else p_reason end,
    updated_at = now()
  where worker_id = p_worker_id
    and category_code = normalized_code
  returning * into saved_request;

  if saved_request.id is null then
    insert into public.category_approval_requests (
      worker_id,
      category_code,
      status,
      reviewed_by,
      reviewed_at,
      rejection_reason,
      updated_at
    )
    values (
      p_worker_id,
      normalized_code,
      case when approved then 'approved' else 'rejected' end,
      auth.uid(),
      now(),
      case when approved then null else p_reason end,
      now()
    )
    returning * into saved_request;
  end if;

  if approved then
    update public.driver_profiles
    set
      approved_categories = (
        select array(
          select distinct item
          from unnest(public.driver_profiles.approved_categories || array[normalized_code]::text[]) as item
        )
      ),
      available_categories = (
        select array(
          select distinct item
          from unnest(public.driver_profiles.available_categories || array[normalized_code]::text[]) as item
        )
      ),
      women_driver_verified = case when normalized_code = 'ella' then true else women_driver_verified end,
      women_driver_status = case when normalized_code = 'ella' then 'verified' else women_driver_status end,
      women_driver_verified_at = case when normalized_code = 'ella' then now() else women_driver_verified_at end,
      women_driver_verified_by = case when normalized_code = 'ella' then auth.uid() else women_driver_verified_by end,
      premium_status = case when normalized_code in ('premium', 'black', 'deportivo') then 'approved' else premium_status end,
      premium_verified_at = case when normalized_code in ('premium', 'black', 'deportivo') then now() else premium_verified_at end,
      premium_verified_by = case when normalized_code in ('premium', 'black', 'deportivo') then auth.uid() else premium_verified_by end,
      updated_at = now()
    where user_id = p_worker_id;
  else
    update public.driver_profiles
    set
      women_driver_status = case when normalized_code = 'ella' then 'rejected' else women_driver_status end,
      premium_status = case when normalized_code in ('premium', 'black', 'deportivo') then 'rejected' else premium_status end,
      updated_at = now()
    where user_id = p_worker_id;
  end if;

  insert into public.safety_verification_events (user_id, actor_id, event_type, message, metadata)
  values (
    p_worker_id,
    auth.uid(),
    case when approved then 'driver_category_approved' else 'driver_category_rejected' end,
    coalesce(p_reason, 'Revision de categoria ' || normalized_code || '.'),
    jsonb_build_object('category_code', normalized_code)
  );

  return saved_request;
end;
$$;

revoke all on function public.admin_review_driver_category(uuid, text, text, text) from public;
grant execute on function public.admin_review_driver_category(uuid, text, text, text) to authenticated;

create or replace function public.can_request_ride_category(
  p_user_id uuid,
  p_category_code text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case
    when coalesce(nullif(trim(p_category_code), ''), 'auto_standard') in ('auto_standard', 'auto', 'comfort', 'premium', 'black', 'deportivo', 'moto', 'campus', 'ella') then
      case
        when coalesce(nullif(trim(p_category_code), ''), 'auto_standard') = 'ella' then exists (
          select 1 from public.profiles
          where id = p_user_id
            and women_mode_verified = true
            and women_mode_status = 'verified'
        )
        else true
      end
    else false
  end
$$;

revoke all on function public.can_request_ride_category(uuid, text) from public;
grant execute on function public.can_request_ride_category(uuid, text) to authenticated;

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
  updated_at timestamptz,
  driver_type text,
  vehicle_category text,
  approved_categories text[],
  available_categories text[],
  women_driver_verified boolean,
  women_driver_status text,
  accepts_campus_rides boolean
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
    driver_profiles.updated_at,
    driver_profiles.driver_type,
    driver_profiles.vehicle_category,
    driver_profiles.approved_categories,
    driver_profiles.available_categories,
    driver_profiles.women_driver_verified,
    driver_profiles.women_driver_status,
    driver_profiles.accepts_campus_rides
  from public.driver_profiles
  where driver_profiles.is_online = true
    and driver_profiles.is_available = true
    and driver_profiles.verified = true
    and driver_profiles.verification_status = 'approved'
    and driver_profiles.lat is not null
    and driver_profiles.lng is not null
  order by driver_profiles.updated_at desc
  limit 50
$$;

revoke all on function public.get_available_drivers() from public;
grant execute on function public.get_available_drivers() to anon, authenticated;

create or replace function public.match_drivers_for_ride(
  p_lat double precision,
  p_lng double precision,
  p_category_code text default 'auto_standard',
  p_women_only boolean default false
)
returns setof public.driver_profiles
language sql
security definer
set search_path = public
stable
as $$
  select driver_profiles.*
  from public.driver_profiles
  where driver_profiles.is_online = true
    and driver_profiles.is_available = true
    and driver_profiles.verified = true
    and driver_profiles.verification_status = 'approved'
    and driver_profiles.lat is not null
    and driver_profiles.lng is not null
    and (
      coalesce(p_category_code, 'auto_standard') in ('auto_standard', 'auto')
      or coalesce(p_category_code, 'auto_standard') = any(driver_profiles.approved_categories)
      or coalesce(p_category_code, 'auto_standard') = any(driver_profiles.available_categories)
    )
    and (
      coalesce(p_women_only, false) = false
      or (
        driver_profiles.women_driver_verified = true
        and driver_profiles.women_driver_status = 'verified'
        and exists (
          select 1
          from public.profiles
          where profiles.id = auth.uid()
            and profiles.women_mode_verified = true
            and profiles.women_mode_status = 'verified'
        )
      )
    )
  order by
    ((driver_profiles.lat - coalesce(p_lat, driver_profiles.lat)) * (driver_profiles.lat - coalesce(p_lat, driver_profiles.lat)))
    + ((driver_profiles.lng - coalesce(p_lng, driver_profiles.lng)) * (driver_profiles.lng - coalesce(p_lng, driver_profiles.lng))) asc,
    driver_profiles.rating desc,
    driver_profiles.updated_at desc
  limit 50
$$;

revoke all on function public.match_drivers_for_ride(double precision, double precision, text, boolean) from public;
grant execute on function public.match_drivers_for_ride(double precision, double precision, text, boolean) to authenticated;

drop function if exists public.request_trip(uuid, text, double precision, double precision, double precision, double precision, double precision, double precision, numeric, integer, text, boolean);

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
  p_women_mode boolean default false,
  p_ride_category text default 'auto_standard'
)
returns public.trips
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_trip public.trips;
  normalized_category text := lower(trim(coalesce(p_ride_category, 'auto_standard')));
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

  if coalesce(p_women_mode, false) = true then
    normalized_category := 'ella';
  end if;

  if normalized_category in ('auto', '') then
    normalized_category := 'auto_standard';
  end if;

  if not exists (
    select 1
    from public.ride_categories
    where code = normalized_category
      and active = true
  ) then
    raise exception 'Categoria de viaje invalida';
  end if;

  if not exists (
    select 1
    from public.driver_profiles
    where driver_profiles.user_id = p_driver_id
      and driver_profiles.is_online = true
      and driver_profiles.is_available = true
      and driver_profiles.verified = true
      and driver_profiles.verification_status = 'approved'
  ) then
    raise exception 'El chofer ya no esta disponible o aun no fue aprobado';
  end if;

  if coalesce(p_women_mode, false) = true then
    if not exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.women_mode_verified = true
        and profiles.women_mode_status = 'verified'
    ) then
      raise exception 'MiChofer Ella requiere verificacion de pasajera';
    end if;

    if not exists (
      select 1
      from public.driver_profiles
      where driver_profiles.user_id = p_driver_id
        and driver_profiles.women_driver_verified = true
        and driver_profiles.women_driver_status = 'verified'
    ) then
      raise exception 'Esta conductora aun no esta verificada para MiChofer Ella';
    end if;
  end if;

  if normalized_category not in ('auto_standard', 'ella') then
    if not exists (
      select 1
      from public.driver_profiles
      where driver_profiles.user_id = p_driver_id
        and (
          normalized_category = any(driver_profiles.approved_categories)
          or normalized_category = any(driver_profiles.available_categories)
        )
    ) then
      raise exception 'El chofer no esta aprobado para esta categoria';
    end if;
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
    ride_category,
    safety_mode,
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
    case when normalized_category = 'moto' then 'moto' else 'car' end,
    p_price,
    coalesce(nullif(trim(coalesce(p_payment_method, '')), ''), 'cash'),
    'pending',
    coalesce(p_women_mode, false),
    normalized_category,
    case when normalized_category = 'ella' then 'women_verified' else 'standard' end,
    now(),
    now()
  )
  returning * into saved_trip;

  return saved_trip;
end;
$$;

revoke all on function public.request_trip(uuid, text, double precision, double precision, double precision, double precision, double precision, double precision, numeric, integer, text, boolean, text) from public;
grant execute on function public.request_trip(uuid, text, double precision, double precision, double precision, double precision, double precision, double precision, numeric, integer, text, boolean, text) to authenticated;
