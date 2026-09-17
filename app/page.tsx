import { ArrowRight, Compass, Info, Layers3, Terminal } from "lucide-react";
import Link from "next/link";
import { SiteShell } from "./site-shell";

export default function Home() {
  return (
    <SiteShell active="/">
      <main className="site-main home-main">
        <section className="home-hero">
          <div className="site-eyebrow"><span className="live-dot" /> PERSONAL WORKSPACE · ONLINE</div>
          <h1>A quieter corner<br />of <em>the web.</em></h1>
          <p>
            欢迎来到 Labulubius。这里收集值得反复访问的网站、正在进行的想法，
            以及关于技术与互联网的零散记录。
          </p>
          <div className="hero-actions">
            <Link className="primary-action" href="/nav">打开网页导航 <ArrowRight size={16} /></Link>
            <Link className="secondary-action" href="/about">关于这里</Link>
          </div>
        </section>

        <section className="workspace-window" aria-label="Quick access">
          <div className="workspace-titlebar">
            <span><Layers3 size={15} /> Workspace</span>
            <div className="workspace-controls" aria-hidden="true"><i /><i /><i /></div>
          </div>
          <div className="workspace-content">
            <div className="workspace-intro">
              <span className="workspace-icon"><Terminal size={23} /></span>
              <div><small>WELCOME BACK</small><h2>Where would you like to go?</h2></div>
            </div>
            <div className="quick-grid">
              <Link href="/nav" className="quick-card">
                <span className="quick-card-icon blue"><Compass size={21} /></span>
                <div><h3>Web Navigator</h3><p>精心整理的实用网站与开放资源。</p></div>
                <ArrowRight size={16} />
              </Link>
              <Link href="/about" className="quick-card">
                <span className="quick-card-icon violet"><Info size={21} /></span>
                <div><h3>About</h3><p>了解这个网站及其设计理念。</p></div>
                <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}
