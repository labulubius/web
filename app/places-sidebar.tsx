"use client";

import { Compass, HardDrive, Home, Info, MessagesSquare, Newspaper, Share2, Star, StickyNote } from "lucide-react";
import { useSiteAuth } from "./site-auth";
import Link from "next/link";

export function PlacesSidebar({ active }: { active: string }) {
  const { isAdmin } = useSiteAuth();
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
        {isAdmin && <Link href="/drive"><HardDrive size={16} /> Drive</Link>}
        {isAdmin && <Link href="/share"><Share2 size={16} /> Share</Link>}
        <Link href="/note"><StickyNote size={16} /> Note</Link>
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
