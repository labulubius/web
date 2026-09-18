-- Allow administrators to hide an entire navigator category from guests.

alter table public.navigator_categories
  add column if not exists is_published boolean not null default true;

-- Guests only see visible categories. Administrators can still manage hidden ones.
drop policy if exists "navigator categories are public" on public.navigator_categories;
create policy "published navigator categories are public"
on public.navigator_categories for select
to anon, authenticated
using (is_published or public.navigator_is_admin());

-- Hiding a category also hides all of its websites, including favorites.
drop policy if exists "published navigator sites are public" on public.navigator_sites;
create policy "published navigator sites are public"
on public.navigator_sites for select
to anon, authenticated
using (
  public.navigator_is_admin()
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
