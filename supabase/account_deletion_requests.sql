-- MiChofer: solicitudes de eliminacion de cuenta.
-- Ejecutar manualmente en Supabase SQL Editor despues de revisar con el responsable legal/tecnico.

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  email text not null,
  reason text null,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  resolved_at timestamptz null,
  notes text null,
  admin_notes text null,
  constraint account_deletion_requests_status_check
    check (status in ('pending', 'in_review', 'resolved', 'rejected'))
);

alter table public.account_deletion_requests enable row level security;

drop policy if exists "Users can request their own account deletion" on public.account_deletion_requests;
create policy "Users can request their own account deletion"
on public.account_deletion_requests
for insert
to authenticated
with check (
  auth.uid() = user_id
  and lower(email) = lower(coalesce(auth.jwt() ->> 'email', email))
);

drop policy if exists "Anonymous users can request account deletion by email" on public.account_deletion_requests;
create policy "Anonymous users can request account deletion by email"
on public.account_deletion_requests
for insert
to anon
with check (
  user_id is null
  and email is not null
  and length(trim(email)) >= 5
);

-- Admin review:
-- If your project has an admin role claim or an admins table, add select/update policies here.
-- Example idea only:
-- create policy "Admins can manage deletion requests"
-- on public.account_deletion_requests
-- for all
-- to authenticated
-- using (public.is_admin(auth.uid()))
-- with check (public.is_admin(auth.uid()));
