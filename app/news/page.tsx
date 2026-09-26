import type { Metadata } from "next";
import { SiteShell } from "../site-shell";
import { NewsReader } from "./news-reader";

export const metadata: Metadata = { title: "News" };

export default function NewsPage() {
  return <SiteShell active="/news" title="News"><NewsReader /></SiteShell>;
}
