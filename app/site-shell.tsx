"use client";

import { Compass, Home, Info, Menu, Monitor, Moon, Search, Sun } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";
type ThemeMode = Theme | "system";

const navigation = [
  { href: "/", label: "Home", icon: Home },
  { href: "/nav", label: "Navigator", icon: Compass },
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    return (window.localStorage.getItem("site-theme-mode") as ThemeMode | null) ?? "system";
  });
  const [systemTheme, setSystemTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const theme = themeMode === "system" ? systemTheme : themeMode;

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = () => setSystemTheme(media.matches ? "dark" : "light");
    syncTheme();
    media.addEventListener("change", syncTheme);
    return () => media.removeEventListener("change", syncTheme);
  }, []);

  function cycleThemeMode() {
    const next: ThemeMode = themeMode === "system" ? "light" : themeMode === "light" ? "dark" : "system";
    setThemeMode(next);
    window.localStorage.setItem("site-theme-mode", next);
  }

  const ThemeIcon = themeMode === "system" ? Monitor : themeMode === "light" ? Sun : Moon;

  return (
    <div
      className="plasma-desktop"
      data-theme={theme}
      data-sidebar-collapsed={sidebarCollapsed}
      suppressHydrationWarning
    >
      <main className="breeze-window">
        <div className="tool-bar">
          <button
            className="sidebar-toggle"
            type="button"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            aria-controls="page-sidebar"
            aria-expanded={!sidebarCollapsed}
            aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          >
            <Menu size={20} />
            <span>Sidebar</span>
          </button>
          <nav aria-label="Main navigation">
            {navigation.map(({ href, label, icon: Icon }) => (
              <Link className={active === href ? "active" : ""} href={href} key={href} aria-current={active === href ? "page" : undefined}>
                <Icon size={18} /><span>{label}</span>
              </Link>
            ))}
          </nav>
          <div className="toolbar-spacer" />
          {active === "/nav" && <span className="toolbar-context"><Search size={15} /> Directory</span>}
          <button className="theme-control" onClick={cycleThemeMode} type="button" title={`Theme: ${themeMode}`} aria-label={`Color theme: ${themeMode}. Click to change.`}>
            <ThemeIcon size={17} /><span>{themeMode === "system" ? "System theme" : `${themeMode} theme`}</span>
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
