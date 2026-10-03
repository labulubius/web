import type { Metadata } from "next";
import { SiteShell } from "./site-shell";
import { TaskPlanner } from "./tasks/task-planner";
import "./tasks/tasks.css";

export const metadata: Metadata = {
  title: "Home",
  robots: { index: false, follow: false },
};

export default function Home() {
  return <SiteShell active="/" title="Home" hasSidebar><TaskPlanner /></SiteShell>;
}
