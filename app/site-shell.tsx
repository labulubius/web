"use client";

import {
  AppWindow,
  BatteryMedium,
  Compass,
  Home,
  Info,
  Maximize2,
  Minus,
  Monitor,
  Moon,
  Network,
  Search,
  Sun,
  Volume2,
  X,
} from "lucide-react";
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
  title,
}: {
  children: ReactNode;
  active: string;
  title: string;
}) {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    return (window.localStorage.getItem("site-theme-mode") as ThemeMode | null) ?? "system";
  });
  const [systemTheme, setSystemTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [clock, setClock] = useState<Date | null>(null);
  const theme = themeMode === "system" ? systemTheme : themeMode;

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = () => setSystemTheme(media.matches ? "dark" : "light");
    const tick = () => setClock(new Date());

    syncTheme();
    tick();
    media.addEventListener("change", syncTheme);
    const timer = window.setInterval(tick, 30_000);
    return () => {
      media.removeEventListener("change", syncTheme);
      window.clearInterval(timer);
    };
  }, []);

  function cycleThemeMode() {
    const next: ThemeMode = themeMode === "system" ? "light" : themeMode === "light" ? "dark" : "system";
    setThemeMode(next);
    window.localStorage.setItem("site-theme-mode", next);
  }

  const ThemeIcon = themeMode === "system" ? Monitor : themeMode === "light" ? Sun : Moon;

  return (
    <div className="plasma-desktop" data-theme={theme} suppressHydrationWarning>
      <main className="breeze-window">
        <header className="window-decoration">
          <div className="window-caption">
            <span className="app-icon"><Compass size={16} strokeWidth={2} /></span>
            <span>{title} — Labulubius</span>
          </div>
          <div className="window-buttons">
            <button type="button" aria-label="Minimize"><Minus size={14} /></button>
            <button type="button" aria-label="Maximize"><Maximize2 size={12} /></button>
            <button className="close-button" type="button" aria-label="Close"><X size={15} /></button>
          </div>
        </header>

        <div className="menu-bar" aria-label="Application menu">
          <span>File</span><span>Edit</span><span>View</span><span>Go</span><span>Help</span>
        </div>

        <div className="tool-bar">
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

      <aside className="plasma-panel" aria-label="Plasma desktop panel">
        <Link className="launcher-button" href="/" aria-label="Application launcher"><span>K</span></Link>
        <div className="panel-separator" />
        <nav className="panel-tasks" aria-label="Open applications">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link className={active === href ? "active" : ""} href={href} key={href} title={label} aria-label={label}>
              <Icon size={20} />
            </Link>
          ))}
        </nav>
        <div className="panel-spacer" />
        <div className="system-tray" aria-label="System tray">
          <Network size={16} /><Volume2 size={17} /><BatteryMedium size={18} />
        </div>
        <button className="panel-theme" onClick={cycleThemeMode} type="button" title={`Theme: ${themeMode}`} aria-label={`Color theme: ${themeMode}`}><ThemeIcon size={17} /></button>
        <time className="digital-clock" dateTime={clock?.toISOString()}>
          <strong>{clock?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) ?? "--:--"}</strong>
          <span>{clock?.toLocaleDateString([], { month: "short", day: "numeric" }) ?? "System"}</span>
        </time>
        <AppWindow className="show-desktop" size={17} aria-label="Show desktop" />
      </aside>
    </div>
  );
}
