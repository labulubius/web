export type Site = {
  name: string;
  description: string;
  url: string;
  category: string;
  initials: string;
  accent: string;
  featured?: boolean;
};

// Site entries are intentionally added only when requested.
export const sites: Site[] = [];
