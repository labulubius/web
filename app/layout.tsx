import type { Metadata } from "next";
import { Noto_Sans, Noto_Sans_Mono } from "next/font/google";
import "./globals.css";

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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className={`${notoSans.variable} ${notoMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
