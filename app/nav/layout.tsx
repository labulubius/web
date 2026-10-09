import type { Metadata } from "next";
import "./nav.css";

export const metadata: Metadata = {
  title: { absolute: "Navigator" },
  description: "A thoughtfully curated directory of useful websites.",
};

export default function NavLayout({ children }: LayoutProps<"/nav">) {
  return children;
}
