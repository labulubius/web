import type { Metadata } from "next";
import { SiteShell } from "../site-shell";
import { CloudCLIViewport } from "./cloudcli-viewport";
import "./cloudcli-shell.css";

export const metadata: Metadata = {
  title: { absolute: "CloudCLI" },
  description: "CloudCLI running on the Mac mini, embedded in the main workspace.",
  robots: { index: false, follow: false },
};

export default function CloudCLIPage() {
  return (
    <SiteShell active="/cloudcli" title="CloudCLI">
      <CloudCLIViewport />
    </SiteShell>
  );
}
