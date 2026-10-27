import type { Metadata } from "next";
import { SiteShell } from "./site-shell";
import { TaskManager } from "./tasks/task-manager";
import "./tasks/tasks.css";

export const metadata: Metadata = { title: "Home", robots: { index: false, follow: false } };

export default function Home() {
  return <SiteShell active="/" title="Home" hasSidebar><TaskManager /></SiteShell>;
}
