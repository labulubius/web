export type NewsFeed = { id: string; title: string; category: string };
export type NewsArticle = { id: string; feedId: string; title: string; url: string; source: string; published: number; summary: string };
