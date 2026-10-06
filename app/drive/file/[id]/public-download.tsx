"use client";

import { Download, File, X } from "lucide-react";
import { useState } from "react";
import { AccessibleDialog } from "../../../accessible-dialog";

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function PublicDownload({ name, size, downloadUrl }: { name: string; size: number; downloadUrl: string }) {
  const [open, setOpen] = useState(true);
  return <main className="drive-public-page">
    <section className="drive-public-card" aria-labelledby="public-file-name">
      <File size={42} aria-hidden="true" />
      <p className="drive-public-eyebrow">PUBLIC DRIVE FILE</p>
      <h1 id="public-file-name">{name}</h1>
      <p>{fileSize(size)} · Anyone with this link can download this file.</p>
      <button type="button" onClick={() => setOpen(true)}><Download size={17} aria-hidden="true" /> Download file</button>
    </section>
    {open && <AccessibleDialog labelledBy="drive-download-title" onClose={() => setOpen(false)} className="drive-download-dialog">
      <header><h2 id="drive-download-title">Download file</h2><button type="button" onClick={() => setOpen(false)} aria-label="Close download confirmation" title="Close"><X size={17} /></button></header>
      <div className="drive-download-body"><span className="drive-download-icon"><Download size={26} aria-hidden="true" /></span><div><strong>{name}</strong><p>{fileSize(size)}</p><p>Anyone with this link can download this file. The download will begin after you confirm.</p></div></div>
      <footer><button type="button" onClick={() => setOpen(false)}>Cancel</button><a className="drive-primary-action" href={downloadUrl}><Download size={16} aria-hidden="true" /> Download</a></footer>
    </AccessibleDialog>}
  </main>;
}
