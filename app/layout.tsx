import type { Metadata } from "next";
import { Noto_Sans, Noto_Sans_Mono } from "next/font/google";
import "./globals.css";
import { SiteAuthProvider } from "./site-auth";

const notoSans = Noto_Sans({
  variable: "--font-noto-sans",
  subsets: ["latin"],
});

const notoMono = Noto_Sans_Mono({
  variable: "--font-noto-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Labulubius — Personal Workspace",
    template: "%s — Labulubius",
  },
  description: "A personal workspace for useful links, ideas, and open technologies.",
};

const themeInitScript = `
  (function () {
    try {
      var mode = localStorage.getItem("site-theme-mode");
      if (mode !== "light" && mode !== "dark" && mode !== "system") mode = "system";
      document.documentElement.dataset.theme = mode;
    } catch (_) {}
  })();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${notoSans.variable} ${notoMono.variable}`}
      data-theme="system"
      suppressHydrationWarning
    >
      <head><script dangerouslySetInnerHTML={{ __html: themeInitScript }} /></head>
      <body><SiteAuthProvider>{children}</SiteAuthProvider></body>
    </html>
  );
}
