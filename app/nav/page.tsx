import { SiteShell } from "../site-shell";
import { NavDirectory } from "./nav-directory";

export default function NavPage() {
  return (
    <SiteShell active="/nav" title="Web Navigator">
      <NavDirectory />
    </SiteShell>
  );
}
