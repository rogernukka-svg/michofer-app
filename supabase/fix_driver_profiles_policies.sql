drop policy if exists "driver_profiles_select_online" on public.driver_profiles;
drop policy if exists "driver_profiles_insert_own" on public.driver_profiles;
drop policy if exists "driver_profiles_update_own" on public.driver_profiles;
drop policy if exists "driver_profiles_admin_review" on public.driver_profiles;

create policy "driver_profiles_select_online"
  on public.driver_profiles for select
  using (
    is_online = true
    or auth.uid() = user_id
  );

create policy "driver_profiles_insert_own"
  on public.driver_profiles for insert
  with check (auth.uid() = user_id);

create policy "driver_profiles_update_own"
  on public.driver_profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "driver_profiles_admin_review"
  on public.driver_profiles for update
  using (false);
