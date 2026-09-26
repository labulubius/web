import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { File, Folder, Share2 } from "lucide-react";
import { publicFolder } from "../../lib/share-server";
import "../../share/share.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shared folder", robots: { index: false, follow: false } };

export default async function SharedFolderPage({ params }: PageProps<"/s/[id]">) {
  const host = (await headers()).get("host")?.split(":")[0];
  if (host !== "share.labulubius.com" && host !== "localhost" && host !== "127.0.0.1") notFound();
  const { id } = await params;
  let content;
  try { content = await publicFolder(id); } catch { notFound(); }
  if (!content) notFound();
  return <main className="share-public-view">
    <p className="share-eyebrow"><Share2 size={15} aria-hidden="true" /> PUBLIC SHARE</p>
    <h1><Folder size={27} aria-hidden="true" /> {content.folder.name}</h1>
    <p className="share-public-note">Anyone with this link can view this folder and its contents.</p>
    {!content.folders.length && !content.entries.length && <p className="share-empty">This folder is empty.</p>}
    <ul className="share-public-list">
      {content.folders.map((folder) => <li key={folder.id}><Folder size={18} aria-hidden="true" /><Link href={`/s/${folder.id}`}>{folder.name}</Link><span>Folder</span></li>)}
      {content.entries.map((file) => <li key={file.id}><File size={18} aria-hidden="true" /><a href={`/f/${file.id}`}>{file.name}</a><span>{(file.size / 1024).toFixed(1)} KB</span></li>)}
    </ul>
  </main>;
}
