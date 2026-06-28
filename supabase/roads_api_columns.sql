-- ============================================================
-- MiChofer Roads API Columns
-- Agrega columnas necesarias para snap-to-road en trips
-- y driver_profiles
-- ============================================================

-- Trips: roads-snapped driver position
alter table if exists public.trips
  add column if not exists driver_road_lat double precision,
  add column if not exists driver_road_lng double precision,
  add column if not exists driver_road_place_id text,
  add column if not exists driver_road_snapped_at timestamptz;

-- Driver profiles: heading/speed/accuracy (if not exist)
alter table if exists public.driver_profiles
  add column if not exists heading double precision,
  add column if not exists speed double precision,
  add column if not exists accuracy double precision;