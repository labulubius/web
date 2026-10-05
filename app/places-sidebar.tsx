"use client";

import { Bot, Compass, HardDrive, Home, Info, MessagesSquare, Newspaper, Star, StickyNote } from "lucide-react";
import Link from "next/link";

export function PlacesSidebar({ active }: { active: string }) {
  return (
    <aside className="places-sidebar" id="page-sidebar">
      <h2>Places</h2>
      <nav>
        <Link className={active === "/" ? "selected" : ""} href="/">
          <Home size={16} /> Home
        </Link>
        <Link className={active === "/nav" ? "selected" : ""} href="/nav">
          <Compass size={16} /> Navigator
        </Link>
        <Link href="/news"><Newspaper size={16} /> News</Link>
        <Link href="/forums"><MessagesSquare size={16} /> Forums</Link>
        <Link href="/drive"><HardDrive size={16} /> Drive</Link>
        <Link href="/note"><StickyNote size={16} /> Note</Link>
        <Link href="/agent"><Bot size={16} /> Agent</Link>
        <Link className={active === "/about" ? "selected" : ""} href="/about">
          <Info size={16} /> About
        </Link>
      </nav>
      <h2>Recently Used</h2>
      <nav>
        <Link href="/nav"><Star size={16} /> Curated links</Link>
      </nav>
    </aside>
  );
}
