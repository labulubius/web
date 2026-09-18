-- Labulubius Navigator schema and access policies.
-- Run this file once in the Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.navigator_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.navigator_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 1 and 60),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.navigator_sites (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.navigator_categories(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 100),
  url text not null check (url ~ '^https?://'),
  description text not null default '' check (char_length(description) <= 300),
  icon_url text check (icon_url is null or icon_url = '' or icon_url ~ '^https?://'),
  sort_order integer not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists navigator_sites_category_order_idx
  on public.navigator_sites(category_id, sort_order, name);

create or replace function public.navigator_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.navigator_admins
    where user_id = (select auth.uid())
  );
$$;

create or replace function public.navigator_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists navigator_categories_updated_at on public.navigator_categories;
create trigger navigator_categories_updated_at
before update on public.navigator_categories
for each row execute function public.navigator_set_updated_at();

drop trigger if exists navigator_sites_updated_at on public.navigator_sites;
create trigger navigator_sites_updated_at
before update on public.navigator_sites
for each row execute function public.navigator_set_updated_at();

alter table public.navigator_admins enable row level security;
alter table public.navigator_categories enable row level security;
alter table public.navigator_sites enable row level security;

revoke all on table public.navigator_admins from anon, authenticated;
revoke all on table public.navigator_categories from anon, authenticated;
revoke all on table public.navigator_sites from anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select on table public.navigator_categories to anon, authenticated;
grant select on table public.navigator_sites to anon, authenticated;
grant insert, update, delete on table public.navigator_categories to authenticated;
grant insert, update, delete on table public.navigator_sites to authenticated;
revoke all on function public.navigator_is_admin() from public;
revoke all on function public.navigator_set_updated_at() from public;
grant execute on function public.navigator_is_admin() to anon, authenticated;

-- Public visitors can read groups and published sites.
drop policy if exists "navigator categories are public" on public.navigator_categories;
create policy "navigator categories are public"
on public.navigator_categories for select
to anon, authenticated
using (true);

drop policy if exists "published navigator sites are public" on public.navigator_sites;
create policy "published navigator sites are public"
on public.navigator_sites for select
to anon, authenticated
using (is_published or public.navigator_is_admin());

-- Every write is checked against the private administrator allowlist.
drop policy if exists "navigator admins manage categories" on public.navigator_categories;
create policy "navigator admins manage categories"
on public.navigator_categories for all
to authenticated
using (public.navigator_is_admin())
with check (public.navigator_is_admin());

drop policy if exists "navigator admins manage sites" on public.navigator_sites;
create policy "navigator admins manage sites"
on public.navigator_sites for all
to authenticated
using (public.navigator_is_admin())
with check (public.navigator_is_admin());
