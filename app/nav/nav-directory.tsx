"use client";

import { ArrowUpRight, Compass, LayoutGrid, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { sites, type Site } from "./sites";

function SiteCard({ site }: { site: Site }) {
  return (
    <a className="site-card" href={site.url} rel="noreferrer" target="_blank">
      <span className="site-logo" style={{ background: site.accent }}>{site.initials}</span>
      <span className="site-card-copy">
        <strong>{site.name}</strong>
        <small>{site.description}</small>
        <em>{site.category}</em>
      </span>
      <ArrowUpRight size={16} aria-hidden="true" />
    </a>
  );
}

export function NavDirectory() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const categories = useMemo(() => ["All", ...Array.from(new Set(sites.map((site) => site.category)))], []);
  const filteredSites = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return sites.filter((site) => {
      const inCategory = category === "All" || site.category === category;
      const searchable = `${site.name} ${site.description} ${site.category}`.toLowerCase();
      return inCategory && (!keyword || searchable.includes(keyword));
    });
  }, [category, query]);

  return (
    <div className="directory-view">
      <aside className="directory-sidebar" id="page-sidebar">
        <h2>Categories</h2>
        <nav aria-label="Website categories">
          {categories.map((item) => (
            <button className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)} type="button">
              <LayoutGrid size={16} />
              <span>{item}</span>
              <small>{item === "All" ? sites.length : sites.filter((site) => site.category === item).length}</small>
            </button>
          ))}
        </nav>
      </aside>

      <section className="directory-content">
        <header className="directory-header">
          <div><h1>{category === "All" ? "Web Navigator" : category}</h1><p>{filteredSites.length} items</p></div>
          <label className="breeze-search">
            <Search size={16} aria-hidden="true" />
            <input aria-label="Search websites" onChange={(event) => setQuery(event.target.value)} placeholder="Search…" type="search" value={query} />
            {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button>}
          </label>
        </header>

        {filteredSites.length > 0 ? (
          <div className="site-grid">
            {filteredSites.map((site) => <SiteCard key={site.url} site={site} />)}
          </div>
        ) : (
          <div className="empty-state">
            <Compass size={48} strokeWidth={1.2} />
            <h2>No items found</h2>
            <p>Try a different search term or category.</p>
            <button type="button" onClick={() => { setQuery(""); setCategory("All"); }}>Show all items</button>
          </div>
        )}
      </section>
    </div>
  );
}
