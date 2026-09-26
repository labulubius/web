"use client";

import type { ReactNode } from "react";
import { useSiteAuth } from "../site-auth";

// Forum data is public, but only administrators may interact with the content.
export function ForumsInteraction({ children, className, as: Tag = "section" }: {
  children: ReactNode;
  className: string;
  as?: "section" | "div";
}) {
  const { isAdmin } = useSiteAuth();
  return <Tag className={className} inert={!isAdmin}>{children}</Tag>;
}
