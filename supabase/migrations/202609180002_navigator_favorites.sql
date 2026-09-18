-- Add a public favorite marker to navigator websites.
-- Existing RLS policies continue to allow only navigator administrators to change it.

alter table public.navigator_sites
  add column if not exists is_favorite boolean not null default false;
