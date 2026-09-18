export type Category = {
  id: string;
  name: string;
  sort_order: number;
};

export type Site = {
  id: string;
  category_id: string;
  name: string;
  description: string;
  url: string;
  icon_url: string | null;
  sort_order: number;
  is_published: boolean;
};
