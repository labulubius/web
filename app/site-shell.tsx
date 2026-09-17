"use client";

import { Compass, Home, Info, Monitor, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";
type ThemeMode = Theme | "system";

const navigation = [
  { href: "/", label: "Home", icon: Home },
  { href: "/nav", label: "Navigator", icon: Compass },
  { href: "/about", label: "About", icon: Info },
];

export function SiteShell({ children, active }: { children: ReactNode; active: string }) {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    return (window.localStorage.getItem("site-theme-mode") as ThemeMode | null) ?? "system";
  });
  const [systemTheme, setSystemTheme] = useState<Theme>("light");
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

  return (
    <div className="site-shell" data-theme={theme} suppressHydrationWarning>
      <header className="site-panel">
        <Link className="site-brand" href="/">
          <span className="site-brand-mark"><Compass size={19} strokeWidth={2.2} /></span>
          <span><strong>Labulubius</strong><small>Personal Workspace</small></span>
        </Link>

        <nav className="site-nav" aria-label="Main navigation">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link className={active === href ? "active" : ""} href={href} key={href}>
              <Icon size={14} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <button
          className="site-theme-button"
          onClick={cycleThemeMode}
          type="button"
          aria-label={`Color theme: ${themeMode}. Click to change.`}
          title={`Theme: ${themeMode}`}
        >
          {themeMode === "system" ? <Monitor size={17} /> : themeMode === "light" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </header>

      {children}

      <footer className="site-footer">
        <span>© {new Date().getFullYear()} Labulubius</span>
        <span>Powered by curiosity and open source.</span>
      </footer>
    </div>
  );
}
