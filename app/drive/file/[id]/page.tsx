import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteShell } from "../../../site-shell";
import { resolvePublicDriveFile } from "../../../lib/drive-shares";
import { PublicDownload } from "./public-download";
import "../../drive.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Download file", referrer: "no-referrer", robots: { index: false, follow: false, nocache: true } };

export default async function PublicDriveFilePage({ params }: PageProps<"/drive/file/[id]">) {
  const { id } = await params;
  const resolved = await resolvePublicDriveFile(id);
  if (!resolved) notFound();
  return <SiteShell active="/drive" title="Download file">
    <PublicDownload name={resolved.share.name} size={resolved.stat.size} downloadUrl={`/drive/file/${encodeURIComponent(id)}/download`} />
  </SiteShell>;
}
