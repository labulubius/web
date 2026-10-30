-- Navigator is owner-only, so per-record guest visibility flags are obsolete.

alter table public.navigator_categories
  drop column if exists is_published;

alter table public.navigator_sites
  drop column if exists is_published;
