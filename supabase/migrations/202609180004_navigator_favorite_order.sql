-- Keep a dedicated order for favorites so sorting them does not alter category order.

alter table public.navigator_sites
  add column if not exists favorite_sort_order integer;

with ranked_favorites as (
  select
    sites.id,
    row_number() over (
      order by categories.sort_order, sites.sort_order, sites.name
    ) - 1 as favorite_sort_order
  from public.navigator_sites as sites
  join public.navigator_categories as categories on categories.id = sites.category_id
  where sites.is_favorite
)
update public.navigator_sites as sites
set favorite_sort_order = ranked_favorites.favorite_sort_order
from ranked_favorites
where sites.id = ranked_favorites.id
  and sites.favorite_sort_order is null;

create index if not exists navigator_sites_favorite_order_idx
  on public.navigator_sites(favorite_sort_order)
  where is_favorite;
