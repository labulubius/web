"use client";

import {
  ArrowUpRight,
  Compass,
  LayoutGrid,
  Moon,
  Search,
  Sparkles,
  Sun,
} from "lucide-react";
import { useMemo, useState } from "react";
import { sites, type Site } from "./sites";

type Theme = "light" | "dark";

function SiteCard({ site }: { site: Site }) {
  return (
    <a className="site-card" href={site.url} rel="noreferrer" target="_blank">
      <div className="site-card-top">
        <span className="site-logo" style={{ background: site.accent }}>
          {site.initials}
        </span>
        <ArrowUpRight aria-hidden="true" size={17} strokeWidth={1.8} />
      </div>
      <div>
        <h3>{site.name}</h3>
        <p>{site.description}</p>
      </div>
      <span className="site-category">{site.category}</span>
    </a>
  );
}

export function NavDirectory() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "light";
    const saved = window.localStorage.getItem("nav-theme") as Theme | null;
    return saved ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  });

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(sites.map((site) => site.category)))],
    [],
  );

  const filteredSites = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return sites.filter((site) => {
      const inCategory = category === "All" || site.category === category;
      const searchable = `${site.name} ${site.description} ${site.category}`.toLowerCase();
      return inCategory && (!keyword || searchable.includes(keyword));
    });
  }, [category, query]);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    window.localStorage.setItem("nav-theme", next);
  }

  return (
    <div className="nav-shell" data-theme={theme} suppressHydrationWarning>
      <header className="nav-header">
        <a className="brand" href="/nav" aria-label="Labulubius Nav home">
          <span className="brand-mark"><Compass size={20} strokeWidth={2.2} /></span>
          <span>Labulubius</span>
          <span className="brand-product">Nav</span>
        </a>

        <div className="header-actions">
          <span className="site-count">{sites.length} sites</span>
          <button className="icon-button" onClick={toggleTheme} type="button" aria-label="Toggle color theme">
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
          </button>
        </div>
      </header>

      <main className="nav-main">
        <section className="hero">
          <div className="eyebrow"><Sparkles size={14} /> CURATED FOR THE CURIOUS</div>
          <h1>The web, <em>worth exploring.</em></h1>
          <p>A quiet corner for useful tools, thoughtful products, and places worth coming back to.</p>

          <label className="search-box">
            <Search aria-hidden="true" size={20} strokeWidth={1.8} />
            <input
              aria-label="Search websites"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the collection..."
              type="search"
              value={query}
            />
            <kbd>⌘ K</kbd>
          </label>
        </section>

        <div className="directory-layout">
          <aside className="category-panel">
            <div className="panel-label">Browse</div>
            <nav aria-label="Website categories">
              {categories.map((item) => (
                <button
                  className={category === item ? "category-button active" : "category-button"}
                  key={item}
                  onClick={() => setCategory(item)}
                  type="button"
                >
                  <span><LayoutGrid size={16} /> {item}</span>
                  <span>{item === "All" ? sites.length : sites.filter((site) => site.category === item).length}</span>
                </button>
              ))}
            </nav>
          </aside>

          <section className="collection" aria-live="polite">
            <div className="collection-heading">
              <div>
                <span className="section-kicker">Directory</span>
                <h2>{category === "All" ? "All websites" : category}</h2>
              </div>
              <span>{filteredSites.length} results</span>
            </div>

            {filteredSites.length > 0 ? (
              <div className="site-grid">
                {filteredSites.map((site) => <SiteCard key={site.url} site={site} />)}
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-orbit" aria-hidden="true">
                  <span className="orbit-dot" />
                  <Compass size={29} strokeWidth={1.5} />
                </div>
                <h3>{query ? "Nothing found" : "The collection starts here"}</h3>
                <p>
                  {query
                    ? "Try a different search term or category."
                    : "No websites have been added yet. This space is ready for the first discovery."}
                </p>
              </div>
            )}
          </section>
        </div>
      </main>

      <footer className="nav-footer">
        <span>© {new Date().getFullYear()} Labulubius</span>
        <span>Collected with care, one link at a time.</span>
      </footer>
    </div>
  );
}
