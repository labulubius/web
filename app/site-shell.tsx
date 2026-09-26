"use client";

import { Compass, HardDrive, Home, Info, Menu, MessagesSquare, Monitor, Moon, Newspaper, Share2, StickyNote, Sun } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { AccountControl, useSiteAuth } from "./site-auth";

type ThemeMode = "light" | "dark" | "system";

const subscribeToHydration = () => () => {};

function readSidebarCollapsed(page: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(`site-sidebar-collapsed:${page}`) === "true";
  } catch {
    return false;
  }
}

const navigation = [
  { href: "/", label: "Home", icon: Home },
  { href: "/nav", label: "Navigator", icon: Compass },
  { href: "/news", label: "News", icon: Newspaper, adminOnly: true },
  { href: "/forums", label: "Forums", icon: MessagesSquare },
  { href: "/drive", label: "Drive", icon: HardDrive, adminOnly: true },
  { href: "/share", label: "Share", icon: Share2, adminOnly: true },
  { href: "/note", label: "Note", icon: StickyNote, adminOnly: true },
  { href: "/about", label: "About", icon: Info },
];

export function SiteShell({
  children,
  active,
}: {
  children: ReactNode;
  active: string;
  title: string;
}) {
  const { isAdmin } = useSiteAuth();
  const [sidebarPreference, setSidebarPreference] = useState(() => ({
    page: active,
    collapsed: readSidebarCollapsed(active),
  }));
  const sidebarCollapsed = sidebarPreference.page === active
    ? sidebarPreference.collapsed
    : readSidebarCollapsed(active);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    const storedMode = window.localStorage.getItem("site-theme-mode");
    return storedMode === "light" || storedMode === "dark" ? storedMode : "system";
  });
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const displayedThemeMode = hydrated ? themeMode : "system";
  const displayedSidebarCollapsed = hydrated ? sidebarCollapsed : false;

  function toggleSidebar() {
    const collapsed = !sidebarCollapsed;
    setSidebarPreference({ page: active, collapsed });
    try {
      window.localStorage.setItem(`site-sidebar-collapsed:${active}`, String(collapsed));
    } catch {
      // The button still works when browser storage is unavailable.
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  function cycleThemeMode() {
    const next: ThemeMode = themeMode === "system" ? "light" : themeMode === "light" ? "dark" : "system";
    setThemeMode(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("site-theme-mode", next);
  }

  const ThemeIcon = displayedThemeMode === "system" ? Monitor : displayedThemeMode === "light" ? Sun : Moon;

  return (
    <div
      className="plasma-desktop"
      data-sidebar-collapsed={displayedSidebarCollapsed}
    >
      <main className="breeze-window">
        <div className="tool-bar">
          <button
            className="sidebar-toggle"
            type="button"
            onClick={toggleSidebar}
            aria-controls="page-sidebar"
            aria-expanded={!displayedSidebarCollapsed}
            aria-label={displayedSidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            title={displayedSidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          >
            <Menu size={20} />
            <span>Sidebar</span>
          </button>
          <nav aria-label="Main navigation">
            {navigation.filter((item) => !item.adminOnly || isAdmin).map(({ href, label, icon: Icon }) => (
              <Link key={href} className={active === href ? "active" : ""} href={`https://labulubius.com${href}`} aria-current={active === href ? "page" : undefined} title={label}>
                <Icon size={18} /><span>{label}</span>
              </Link>
            ))}
          </nav>
          <div className="toolbar-spacer" />
          <div className="toolbar-account-slot"><AccountControl /></div>
          <button className="theme-control" onClick={cycleThemeMode} type="button" title={`Theme: ${displayedThemeMode}`} aria-label={`Color theme: ${displayedThemeMode}. Click to change.`}>
            <ThemeIcon size={17} /><span>{displayedThemeMode === "system" ? "System theme" : `${displayedThemeMode} theme`}</span>
          </button>
        </div>

        <div className="application-view">{children}</div>
        <footer className="status-bar">
          <span><span className="status-indicator" /> Ready</span>
          <span>Labulubius Workspace</span>
        </footer>
      </main>
    </div>
  );
}
