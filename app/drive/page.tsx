import type { Metadata } from "next";
import { SiteShell } from "../site-shell";
import { DriveManager } from "./drive-manager";

export const metadata: Metadata = { title: { absolute: "Drive" } };

export default function DrivePage() {
  return <SiteShell active="/drive" title="Drive" hasSidebar><DriveManager /></SiteShell>;
}
