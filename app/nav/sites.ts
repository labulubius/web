export type Site = {
  name: string;
  description: string;
  url: string;
  category: string;
  initials: string;
  accent: string;
  featured?: boolean;
};

export const sites: Site[] = [];
