import "server-only";

import type { NewsArticle, NewsCategory, NewsFeed } from "./news-server-types";
import { freshRssReaderBackend } from "./news-freshrss-backend";

export type NewsArticlePage = { articles: NewsArticle[]; continuation: string | null };

export interface NewsReaderBackend {
  readonly kind: "freshrss" | "miniflux";
  categories(): Promise<NewsCategory[]>;
  feeds(): Promise<NewsFeed[]>;
  articles(selected: string[], cursor: string | null, feeds: NewsFeed[]): Promise<NewsArticlePage>;
  createCategory(name: string): Promise<void>;
  renameCategory(category: NewsCategory, name: string): Promise<void>;
  deleteCategory(category: NewsCategory): Promise<void>;
  subscribe(url: string, category?: NewsCategory, title?: string): Promise<void>;
  editFeed(feed: NewsFeed, title?: string, category?: NewsCategory): Promise<void>;
  unsubscribe(feed: NewsFeed): Promise<void>;
}

export function newsReaderBackend(): NewsReaderBackend {
  const configured = process.env.NEWS_READER_BACKEND || "freshrss";
  if (configured === "freshrss") return freshRssReaderBackend;
  throw new Error(`Unsupported news reader backend: ${configured}`);
}
