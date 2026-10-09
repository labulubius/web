import type { Metadata } from "next";
import { SiteShell } from "../site-shell";
import { FeedsReader } from "./feeds-reader";

export const metadata: Metadata = { title: { absolute: "Feeds" } };

export default function FeedsPage() {
  return <SiteShell active="/feeds" title="Feeds" hasSidebar><FeedsReader /></SiteShell>;
}
