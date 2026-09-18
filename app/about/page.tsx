import { CheckCircle2, Code2, Coffee, Globe2, Heart, Palette } from "lucide-react";
import { PlacesSidebar } from "../places-sidebar";
import { SiteShell } from "../site-shell";

export default function AboutPage() {
  return (
    <SiteShell active="/about" title="About">
      <div className="about-layout">
        <PlacesSidebar active="/about" />
        <div className="about-view">
        <header className="about-header">
          <span className="about-logo">L</span>
          <div>
            <h1>Labulubius</h1>
            <p>Personal Workspace</p>
            <span><CheckCircle2 size={14} /> Website online</span>
          </div>
        </header>

        <div className="about-tabs" role="tablist" aria-label="About sections">
          <button className="active" type="button" role="tab" aria-selected="true">About</button>
          <button type="button" role="tab" aria-selected="false">Details</button>
        </div>

        <div className="about-body">
          <section>
            <h2>About this space</h2>
            <p>This is a personal digital space for organizing useful online resources, recording ideas, and exploring a more comfortable, focused web experience.</p>
            <p>The interface uses the official KDE Breeze and Breeze Dark color systems, emphasizing clarity, stability, and consistency rather than excessive decoration.</p>
          </section>

          <section>
            <h2>Principles</h2>
            <div className="property-grid">
              <div><Palette size={19} /><span><strong>Breeze native</strong><small>Official light and dark palette</small></span></div>
              <div><Globe2 size={19} /><span><strong>Open web</strong><small>Useful resources, carefully collected</small></span></div>
              <div><Code2 size={19} /><span><strong>Modern stack</strong><small>Next.js · React · TypeScript</small></span></div>
              <div><Coffee size={19} /><span><strong>Made with care</strong><small>Simple, calm and useful</small></span></div>
            </div>
          </section>

          <div className="credits"><Heart size={15} /> Built with curiosity and open source.</div>
        </div>
        </div>
      </div>
    </SiteShell>
  );
}
