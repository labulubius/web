import type { Category, Site } from "./sites";

/**
 * Sites shown for the selected category ("favorites" or a category ID) and search query.
 * Favorites follow their own order, then category order; categories follow site order, then name.
 */
export function visibleSites(sites: Site[], categories: Category[], categoryId: string, query: string) {
  const keyword = query.trim().toLowerCase();
  const categoryOrder = new Map(categories.map((category, index) => [category.id, index]));
  return sites
    .filter((site) => {
      const inCategory = categoryId === "favorites" ? site.is_favorite : site.category_id === categoryId;
      const category = categories.find((item) => item.id === site.category_id)?.name ?? "";
      const searchable = `${site.name} ${site.description} ${site.url} ${category}`.toLowerCase();
      return inCategory && (!keyword || searchable.includes(keyword));
    })
    .sort((a, b) => {
      if (categoryId === "favorites") {
        const favoriteDifference = (a.favorite_sort_order ?? a.sort_order) - (b.favorite_sort_order ?? b.sort_order);
        if (favoriteDifference !== 0) return favoriteDifference;
        const categoryDifference = (categoryOrder.get(a.category_id) ?? Number.MAX_SAFE_INTEGER) - (categoryOrder.get(b.category_id) ?? Number.MAX_SAFE_INTEGER);
        if (categoryDifference !== 0) return categoryDifference;
      }
      return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
    });
}
