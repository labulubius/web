import { ArrowRight, Compass, ExternalLink, Info } from "lucide-react";
import Link from "next/link";
import { PlacesSidebar } from "./places-sidebar";
import { SiteShell } from "./site-shell";

export default function Home() {
  return (
    <SiteShell active="/" title="Home">
      <div className="welcome-layout">
        <PlacesSidebar active="/" />

        <section className="welcome-view">
          <div className="view-heading">
            <span className="breeze-logo"><span>K</span></span>
            <div>
              <p className="section-label">LABULUBIUS WORKSPACE</p>
              <h1>Welcome.</h1>
              <p>A personal space for organizing online resources, ideas, and open technologies.</p>
            </div>
          </div>

          <div className="section-separator"><span>Get started</span></div>

          <div className="action-list">
            <Link href="/nav" className="action-row">
              <span className="action-icon"><Compass size={24} /></span>
              <span><strong>Open Web Navigator</strong><small>Browse a curated collection of useful websites and open resources</small></span>
              <ArrowRight size={18} />
            </Link>
            <Link href="/about" className="action-row">
              <span className="action-icon"><Info size={24} /></span>
              <span><strong>About this workspace</strong><small>Learn about this website, its design choices, and its purpose</small></span>
              <ArrowRight size={18} />
            </Link>
          </div>

          <div className="info-panel">
            <div><strong>Clean and focused</strong><p>Built around KDE Breeze’s information hierarchy and interactions, without unnecessary decoration.</p></div>
            <a href="https://kde.org/plasma-desktop/" target="_blank" rel="noreferrer">About KDE Plasma <ExternalLink size={13} /></a>
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
