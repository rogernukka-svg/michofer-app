-- Run this once in Supabase SQL Editor if requesting a ride fails with:
-- "insert or update on table trips violates foreign key constraint trips_driver_id_fkey"
--
-- The app reads approved drivers from public.driver_profiles and sends the
-- driver's auth/profile id in trips.driver_id. This makes the trips foreign key
-- match that app flow instead of an old public.drivers table.

alter table public.trips
  drop constraint if exists trips_driver_id_fkey;

alter table public.trips
  add constraint trips_driver_id_fkey
  foreign key (driver_id)
  references public.profiles(id)
  on delete set null;

notify pgrst, 'reload schema';
