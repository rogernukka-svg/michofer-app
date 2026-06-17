create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'passenger' check (role in ('passenger','driver','admin')),
  gender text default 'female' check (gender in ('female','male','mujer','hombre')),
  email text,
  phone text,
  avatar_url text,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;

create table if not exists public.driver_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  full_name text,
  avatar_url text,
  phone text,
  email text,
  payout_alias text,
  gender text,
  women_mode boolean not null default false,
  is_online boolean not null default false,
  is_available boolean not null default false,
  lat double precision,
  lng double precision,
  car_brand text,
  car_model text,
  car_color text,
  plate text,
  vehicle_year integer,
  vehicle_requirements jsonb not null default '{}'::jsonb,
  documents jsonb not null default '{}'::jsonb,
  verification_status text not null default 'incomplete',
  reviewed_at timestamptz,
  rating numeric not null default 5,
  total_trips integer not null default 0,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.driver_profiles
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists payout_alias text,
  add column if not exists vehicle_year integer,
  add column if not exists vehicle_requirements jsonb not null default '{}'::jsonb,
  add column if not exists documents jsonb not null default '{}'::jsonb,
  add column if not exists verification_status text not null default 'incomplete',
  add column if not exists reviewed_at timestamptz;

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.profiles(id) on delete set null,
  driver_id uuid references public.profiles(id) on delete set null,
  destination_text text not null,
  pickup_lat double precision,
  pickup_lng double precision,
  driver_lat double precision,
  driver_lng double precision,
  price integer,
  payment_method text not null default 'cash',
  status text not null default 'pending' check (status in ('pending','accepted','arriving','in_progress','completed','cancelled')),
  women_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.driver_profiles enable row level security;
alter table public.trips enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "driver_profiles_select_online" on public.driver_profiles;
drop policy if exists "driver_profiles_insert_own" on public.driver_profiles;
drop policy if exists "driver_profiles_update_own" on public.driver_profiles;
drop policy if exists "driver_profiles_admin_review" on public.driver_profiles;
drop policy if exists "trips_select_mine" on public.trips;
drop policy if exists "trips_insert_client" on public.trips;
drop policy if exists "trips_update_mine" on public.trips;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

create policy "driver_profiles_select_online"
  on public.driver_profiles for select
  using (
    is_online = true
    or auth.uid() = user_id
    or exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

create policy "driver_profiles_insert_own"
  on public.driver_profiles for insert
  with check (auth.uid() = user_id);

create policy "driver_profiles_update_own"
  on public.driver_profiles for update
  using (auth.uid() = user_id);

create policy "driver_profiles_admin_review"
  on public.driver_profiles for update
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

create policy "trips_select_mine"
  on public.trips for select
  using (auth.uid() = client_id or auth.uid() = driver_id);

create policy "trips_insert_client"
  on public.trips for insert
  with check (auth.uid() = client_id);

create policy "trips_update_mine"
  on public.trips for update
  using (auth.uid() = client_id or auth.uid() = driver_id);

insert into storage.buckets (id, name, public)
values ('driver-documents', 'driver-documents', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "avatars_upload_own" on storage.objects;
drop policy if exists "avatars_read_public" on storage.objects;
drop policy if exists "avatars_update_own" on storage.objects;

create policy "avatars_upload_own"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "avatars_read_public"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars_update_own"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "driver_documents_upload_own" on storage.objects;
drop policy if exists "driver_documents_read_own" on storage.objects;
drop policy if exists "driver_documents_update_own" on storage.objects;
drop policy if exists "driver_documents_admin_read" on storage.objects;

create policy "driver_documents_upload_own"
  on storage.objects for insert
  with check (
    bucket_id = 'driver-documents'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "driver_documents_read_own"
  on storage.objects for select
  using (
    bucket_id = 'driver-documents'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "driver_documents_update_own"
  on storage.objects for update
  using (
    bucket_id = 'driver-documents'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "driver_documents_admin_read"
  on storage.objects for select
  using (
    bucket_id = 'driver-documents'
    and exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );
