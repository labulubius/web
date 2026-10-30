-- Make Navigator reads owner-only. The existing authenticated administrator
-- management policies continue to authorize all owner reads and writes.

drop policy if exists "published navigator categories are public" on public.navigator_categories;
drop policy if exists "published navigator sites are public" on public.navigator_sites;
