-- Deleting a navigator category also deletes all websites assigned to it.

alter table public.navigator_sites
  drop constraint if exists navigator_sites_category_id_fkey;

alter table public.navigator_sites
  add constraint navigator_sites_category_id_fkey
  foreign key (category_id)
  references public.navigator_categories(id)
  on delete cascade;
