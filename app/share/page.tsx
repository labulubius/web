import { SiteShell } from "../site-shell";
import { ShareManager } from "./share-manager";

export default function SharePage() {
  return <SiteShell active="/share" title="Public Share"><ShareManager /></SiteShell>;
}
