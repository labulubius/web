"use client";

import { Compass, Folder, HardDrive, Info, Star } from "lucide-react";
import { useSiteAuth } from "./site-auth";
import Link from "next/link";

export function PlacesSidebar({ active }: { active: string }) {
  const { isAdmin } = useSiteAuth();
  return (
    <aside className="places-sidebar" id="page-sidebar">
      <h2>Places</h2>
      <nav>
        <Link className={active === "/" ? "selected" : ""} href="/">
          <Folder size={16} /> Home
        </Link>
        <Link className={active === "/nav" ? "selected" : ""} href="/nav">
          <Compass size={16} /> Web Navigator
        </Link>
        {isAdmin && <Link className={active === "/drive" ? "selected" : ""} href="/drive">
          <HardDrive size={16} /> Private Drive
        </Link>}
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
