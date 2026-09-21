-- Promote the navigator-specific administrator allowlist to a site-wide role.
-- Existing administrator accounts and navigator permissions are preserved.

do $$
begin
  if to_regclass('public.site_admins') is null then
    alter table public.navigator_admins rename to site_admins;
  end if;
end
$$;

create or replace function public.site_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.site_admins
    where user_id = (select auth.uid())
  );
$$;

alter table public.site_admins enable row level security;
revoke all on table public.site_admins from anon, authenticated;
revoke all on function public.site_is_admin() from public;
grant execute on function public.site_is_admin() to anon, authenticated;

-- Navigator is the first site feature managed by the global administrator role.
drop policy if exists "published navigator categories are public" on public.navigator_categories;
create policy "published navigator categories are public"
on public.navigator_categories for select
to anon, authenticated
using (is_published or public.site_is_admin());

drop policy if exists "published navigator sites are public" on public.navigator_sites;
create policy "published navigator sites are public"
on public.navigator_sites for select
to anon, authenticated
using (
  public.site_is_admin()
  or (
    is_published
    and exists (
      select 1
      from public.navigator_categories
      where navigator_categories.id = navigator_sites.category_id
        and navigator_categories.is_published
    )
  )
);

drop policy if exists "navigator admins manage categories" on public.navigator_categories;
create policy "site admins manage navigator categories"
on public.navigator_categories for all
to authenticated
using (public.site_is_admin())
with check (public.site_is_admin());

drop policy if exists "navigator admins manage sites" on public.navigator_sites;
create policy "site admins manage navigator sites"
on public.navigator_sites for all
to authenticated
using (public.site_is_admin())
with check (public.site_is_admin());

-- Keep the old RPC temporarily compatible with already-open browser tabs.
create or replace function public.navigator_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.site_is_admin();
$$;
