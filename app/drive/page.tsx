import { SiteShell } from "../site-shell";
import { DriveManager } from "./drive-manager";

export default function DrivePage() {
  return <SiteShell active="/drive" title="Drive" hasSidebar><DriveManager /></SiteShell>;
}
