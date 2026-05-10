create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'passenger' check (role in ('passenger','driver','admin')),
  gender text not null default 'female' check (gender in ('female','male')),
  phone text,
  avatar_url text,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rides (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid references public.profiles(id) on delete set null,
  driver_id uuid references public.profiles(id) on delete set null,
  driver_name text,
  driver_gender text,
  destination text not null,
  pickup_lat double precision,
  pickup_lng double precision,
  dropoff_lat double precision,
  dropoff_lng double precision,
  price integer,
  status text not null default 'requested' check (status in ('requested','accepted','arriving','in_progress','completed','cancelled')),
  women_only boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.rides enable row level security;

create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

create policy "rides_select_mine" on public.rides for select using (auth.uid() = passenger_id or auth.uid() = driver_id);
create policy "rides_insert_passenger" on public.rides for insert with check (auth.uid() = passenger_id);
create policy "rides_update_mine" on public.rides for update using (auth.uid() = passenger_id or auth.uid() = driver_id);
