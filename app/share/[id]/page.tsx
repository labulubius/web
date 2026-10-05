import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, File, Folder, Share2 } from "lucide-react";
import { publicDriveFolder, resolvePublicDriveTarget } from "../../lib/drive-shares";
import "../share.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Public share", robots: { index: false, follow: false } };

function sharedPath(id: string, parts: string[]) {
  return parts.length ? `/share/${id}?path=${encodeURIComponent(parts.join("/"))}` : `/share/${id}`;
}
function downloadPath(id: string, parts: string[]) {
  const query = parts.length ? `?path=${encodeURIComponent(parts.join("/"))}` : "";
  return `/api/share/${id}${query}`;
}

export default async function SharedPage({ params, searchParams }: PageProps<"/share/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const relative = typeof query.path === "string" ? query.path : "";
  const resolved = await resolvePublicDriveTarget(id, relative);
  if (!resolved) notFound();

  if (resolved.stat.isFile()) return <main className="share-public-view">
    <p className="share-eyebrow"><Share2 size={15} aria-hidden="true" /> PUBLIC SHARE</p>
    <h1><File size={27} aria-hidden="true" /> {resolved.relative.at(-1) ?? resolved.share.name}</h1>
    <p className="share-public-note">Anyone with this link can download this file.</p>
    <a className="share-download" href={downloadPath(id, resolved.relative)}><Download size={17} aria-hidden="true" /> Download file</a>
  </main>;

  const content = await publicDriveFolder(id, relative);
  if (!content) notFound();
  return <main className="share-public-view">
    <p className="share-eyebrow"><Share2 size={15} aria-hidden="true" /> PUBLIC SHARE</p>
    <h1><Folder size={27} aria-hidden="true" /> {content.relative.at(-1) ?? content.share.name}</h1>
    <p className="share-public-note">Anyone with this link can browse this shared folder and download its files.</p>
    {content.relative.length > 0 && <nav className="share-public-breadcrumbs" aria-label="Shared folder path">
      <Link href={`/share/${id}`}>{content.share.name}</Link>
      {content.relative.map((part, index) => <span key={`${part}:${index}`}> / <Link href={sharedPath(id, content.relative.slice(0, index + 1))}>{part}</Link></span>)}
    </nav>}
    {!content.entries.length ? <p className="share-empty">This folder is empty.</p> : <ul className="share-public-list">
      {content.entries.map((entry) => {
        const entryParts = [...content.relative, entry.name];
        return <li key={entry.name}>{entry.type === "folder" ? <Folder size={18} aria-hidden="true" /> : <File size={18} aria-hidden="true" />}
          {entry.type === "folder" ? <Link href={sharedPath(id, entryParts)}>{entry.name}</Link> : <a href={downloadPath(id, entryParts)}>{entry.name}</a>}
          <span>{entry.type === "folder" ? "Folder" : `${(entry.size / 1024).toFixed(1)} KB`}</span>
        </li>;
      })}
    </ul>}
  </main>;
}
