import { ArrowRight, Compass, ExternalLink, Folder, Info, Star } from "lucide-react";
import Link from "next/link";
import { SiteShell } from "./site-shell";

export default function Home() {
  return (
    <SiteShell active="/" title="Home">
      <div className="welcome-layout">
        <aside className="places-sidebar">
          <h2>Places</h2>
          <nav>
            <Link className="selected" href="/"><Folder size={16} /> Home</Link>
            <Link href="/nav"><Compass size={16} /> Web Navigator</Link>
            <Link href="/about"><Info size={16} /> About</Link>
          </nav>
          <h2>Recently Used</h2>
          <nav><Link href="/nav"><Star size={16} /> Curated links</Link></nav>
        </aside>

        <section className="welcome-view">
          <div className="view-heading">
            <span className="breeze-logo"><span>K</span></span>
            <div>
              <p className="section-label">LABULUBIUS WORKSPACE</p>
              <h1>Welcome.</h1>
              <p>这里是一个用于整理网络资源、想法与开放技术的个人空间。</p>
            </div>
          </div>

          <div className="section-separator"><span>Get started</span></div>

          <div className="action-list">
            <Link href="/nav" className="action-row">
              <span className="action-icon"><Compass size={24} /></span>
              <span><strong>Open Web Navigator</strong><small>浏览精心整理的实用网站与开放资源</small></span>
              <ArrowRight size={18} />
            </Link>
            <Link href="/about" className="action-row">
              <span className="action-icon"><Info size={24} /></span>
              <span><strong>About this workspace</strong><small>了解这个网站、设计选择及其用途</small></span>
              <ArrowRight size={18} />
            </Link>
          </div>

          <div className="info-panel">
            <div><strong>Clean and focused</strong><p>遵循 KDE Breeze 的信息层级与交互方式，减少不必要的装饰。</p></div>
            <a href="https://kde.org/plasma-desktop/" target="_blank" rel="noreferrer">About KDE Plasma <ExternalLink size={13} /></a>
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
