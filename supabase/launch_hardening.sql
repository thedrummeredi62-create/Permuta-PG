-- Permuta PG production hardening — review in Supabase SQL Editor before running.
begin;
alter table public.profiles add column if not exists business_verified boolean not null default false;
alter table public.profiles add column if not exists business_category text;
alter table public.profiles add column if not exists business_description text;
alter table public.profiles add column if not exists business_website text;
alter table public.offers add column if not exists business_credit boolean not null default false;
alter table public.offers add column if not exists credit_valid_until date;
alter table public.offers add column if not exists credit_terms text;
create index if not exists offers_market_scope_status_created_idx on public.offers(market_scope,status,created_at desc);
create index if not exists offers_user_id_idx on public.offers(user_id);
create unique index if not exists profiles_cnpj_unique on public.profiles(cnpj) where cnpj is not null;
alter table public.offers enable row level security;
drop policy if exists "business offers require cnpj" on public.offers;
create policy "business offers require cnpj" on public.offers as restrictive for insert to authenticated
with check (
  market_scope <> 'empresarial'
  or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.cnpj is not null and length(regexp_replace(p.cnpj,'\\D','','g'))=14)
);
drop policy if exists "business offer updates require cnpj" on public.offers;
create policy "business offer updates require cnpj" on public.offers as restrictive for update to authenticated
using (user_id=(select auth.uid()))
with check (
 user_id=(select auth.uid()) and
 (market_scope <> 'empresarial' or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.cnpj is not null and length(regexp_replace(p.cnpj,'\\D','','g'))=14))
);
commit;
-- IMPORTANT: empresa cadastrada = CNPJ válido informado; empresa verificada = business_verified=true, set only by admin/backoffice.
