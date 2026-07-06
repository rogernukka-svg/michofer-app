-- MiChofer performance and logic fixes.
-- Run this after supabase/michofer_mobility_foundation.sql.
-- Do not rerun old schema.sql, driver_live_state_rpcs.sql, or unify_live_flow.sql after this file.

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'women_mode_status'
  ) then
    raise exception 'Run supabase/michofer_mobility_foundation.sql before this file (profiles.women_mode_status is missing).';
  end if;
end $$;

create index if not exists trips_driver_id_idx on public.trips (driver_id);
create index if not exists trips_client_id_idx on public.trips (client_id);
create index if not exists trips_status_idx on public.trips (status);
create index if not exists trips_driver_status_idx on public.trips (driver_id, status);
create index if not exists trips_client_status_idx on public.trips (client_id, status);
create index if not exists trips_created_at_idx on public.trips (created_at desc);
create index if not exists trips_is_test_idx on public.trips (is_test) where is_test = true;

create index if not exists driver_profiles_online_available_idx
  on public.driver_profiles (is_online, is_available, verified, verification_status);
create index if not exists driver_profiles_updated_at_idx on public.driver_profiles (updated_at desc);
create index if not exists driver_profiles_women_status_idx on public.driver_profiles (women_driver_status);

create index if not exists messages_trip_id_idx on public.messages (trip_id);
create index if not exists messages_created_at_idx on public.messages (created_at);

create index if not exists profiles_women_mode_status_idx on public.profiles (women_mode_status);
create index if not exists profiles_role_idx on public.profiles (role);

create index if not exists category_approval_requests_status_idx
  on public.category_approval_requests (status);

create index if not exists safety_verification_events_user_id_idx
  on public.safety_verification_events (user_id);
create index if not exists safety_verification_events_created_at_idx
  on public.safety_verification_events (created_at desc);

create index if not exists ride_preferences_user_id_idx on public.ride_preferences (user_id);

drop policy if exists "driver_profiles_admin_review" on public.driver_profiles;

do $$
begin
  if to_regclass('public.account_deletion_requests') is not null then
    execute 'drop policy if exists "account_deletion_admin_select" on public.account_deletion_requests';
    execute 'create policy "account_deletion_admin_select" on public.account_deletion_requests for select using (public.is_admin_user())';
    execute 'drop policy if exists "account_deletion_admin_update" on public.account_deletion_requests';
    execute 'create policy "account_deletion_admin_update" on public.account_deletion_requests for update using (public.is_admin_user()) with check (public.is_admin_user())';
  end if;
end $$;

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

comment on function public.get_own_driver_trips() is
  'Single source of truth. Do not rerun driver_live_state_rpcs.sql, unify_live_flow.sql, or schema.sql after this file.';

comment on function public.get_available_drivers() is
  'Current version is defined in michofer_mobility_foundation.sql and filters by verified, verification_status, and categories.';

comment on function public.request_trip(uuid, text, double precision, double precision, double precision, double precision, double precision, double precision, numeric, integer, text, boolean, text) is
  'Current version includes ride_category. Older 12-argument versions are obsolete.';

analyze public.trips;
analyze public.driver_profiles;
analyze public.messages;
analyze public.profiles;
analyze public.category_approval_requests;
analyze public.safety_verification_events;
analyze public.ride_preferences;

notify pgrst, 'reload schema';
