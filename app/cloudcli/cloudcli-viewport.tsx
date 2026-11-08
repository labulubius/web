"use client";

import { useLayoutEffect, useRef } from "react";
import { attachCloudCLIViewport } from "./frame-viewport";

export function CloudCLIViewport() {
  const viewport = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!viewport.current) return;
    return attachCloudCLIViewport(viewport.current);
  }, []);

  return (
    <div
      ref={viewport}
      className="cloudcli-viewport"
      role="group"
      aria-label="CloudCLI content"
      aria-owns="cloudcli-persistent-workspace"
    >
      <p className="cloudcli-placeholder" role="status">Preparing CloudCLI workspace…</p>
    </div>
  );
}
