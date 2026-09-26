import type { Metadata } from "next";
import { SiteShell } from "../site-shell";
import { NoteEditor } from "./note-editor";
import "./note.css";

export const metadata: Metadata = { title: "Private Note — Labulubius", robots: { index: false, follow: false } };

export default function NotePage() {
  return <SiteShell active="/note" title="Private Note"><NoteEditor /></SiteShell>;
}
