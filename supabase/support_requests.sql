create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references public.profiles(id) on delete set null,
  email text,
  message text not null,
  status text not null default 'open' check (status in ('open', 'in_review', 'resolved', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.support_requests enable row level security;

drop policy if exists "support_requests_insert_own_or_public" on public.support_requests;
create policy "support_requests_insert_own_or_public"
  on public.support_requests for insert
  with check (user_id is null or user_id = auth.uid());

drop policy if exists "support_requests_select_own" on public.support_requests;
create policy "support_requests_select_own"
  on public.support_requests for select
  using (user_id = auth.uid());

drop policy if exists "support_requests_admin_all" on public.support_requests;
create policy "support_requests_admin_all"
  on public.support_requests for all
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
      and profiles.role = 'admin'
    )
  );

grant insert on public.support_requests to anon, authenticated;
grant select on public.support_requests to authenticated;
grant update on public.support_requests to authenticated;
