"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AgentFrame } from "./pi/agent-frame";

export function PersistentAgent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAgentRoute = pathname === "/pi";
  const [agentMounted, setAgentMounted] = useState(isAgentRoute);
  const shouldMountAgent = agentMounted || isAgentRoute;

  useEffect(() => {
    if (!isAgentRoute || agentMounted) return;
    const activation = window.setTimeout(() => setAgentMounted(true), 0);
    return () => window.clearTimeout(activation);
  }, [agentMounted, isAgentRoute]);

  return (
    <>
      {children}
      {shouldMountAgent && (
        <div hidden={!isAgentRoute}>
          <AgentFrame />
        </div>
      )}
    </>
  );
}
