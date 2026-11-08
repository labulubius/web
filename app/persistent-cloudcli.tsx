"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CloudCLIFrame } from "./cloudcli/cloudcli-frame";

export function PersistentCloudCLI({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isCloudCLIRoute = pathname === "/cloudcli";
  const [cloudcliMounted, setCloudcliMounted] = useState(isCloudCLIRoute);
  const shouldMountCloudCLI = cloudcliMounted || isCloudCLIRoute;

  useEffect(() => {
    if (!isCloudCLIRoute || cloudcliMounted) return;
    const activation = window.setTimeout(() => setCloudcliMounted(true), 0);
    return () => window.clearTimeout(activation);
  }, [cloudcliMounted, isCloudCLIRoute]);

  return (
    <>
      {children}
      {shouldMountCloudCLI && (
        <div hidden={!isCloudCLIRoute}>
          <CloudCLIFrame />
        </div>
      )}
    </>
  );
}
