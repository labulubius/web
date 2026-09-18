import { Compass, Folder, Info, Star } from "lucide-react";
import Link from "next/link";

export function PlacesSidebar({ active }: { active: string }) {
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
