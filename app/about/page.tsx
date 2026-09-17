import { CircleCheck, Code2, Coffee, Heart } from "lucide-react";
import { SiteShell } from "../site-shell";

export default function AboutPage() {
  return (
    <SiteShell active="/about">
      <main className="site-main about-main">
        <section className="page-heading">
          <div className="site-eyebrow">ABOUT · LABULUBIUS</div>
          <h1>关于这个<br /><em>小小空间。</em></h1>
          <p>一个简洁、开放，并且认真对待每个细节的个人网站。</p>
        </section>

        <section className="about-window">
          <div className="workspace-titlebar">
            <span><Heart size={15} /> About</span>
            <div className="workspace-controls" aria-hidden="true"><i /><i /><i /></div>
          </div>
          <div className="about-content">
            <div className="about-copy">
              <span className="about-avatar">L</span>
              <div>
                <span className="about-status"><CircleCheck size={13} /> Website online</span>
                <h2>Hello, this is Labulubius.</h2>
                <p>
                  这里是一个个人数字空间，用来整理有用的网络资源、记录想法，
                  也用来尝试更舒适、更专注的网页体验。
                </p>
                <p>
                  整个网站采用统一的 Fedora KDE Plasma / Breeze 风格，支持系统深浅色自动切换，
                  并尽量保持快速、清晰与易用。
                </p>
              </div>
            </div>
            <div className="about-notes">
              <div><Code2 size={18} /><span><strong>Built for the web</strong><small>Next.js · React · TypeScript</small></span></div>
              <div><Coffee size={18} /><span><strong>Made with care</strong><small>Simple, calm and useful</small></span></div>
            </div>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}
