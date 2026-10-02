"use client";

import type { ReactNode } from "react";

export function OwnerAccess({
  icon,
  title,
  description,
  status,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  status?: string;
  action?: ReactNode;
}) {
  return (
    <section className="owner-access">
      <span className="owner-access-icon" aria-hidden="true">{icon}</span>
      <p className="section-label">PERSONAL WORKSPACE / OWNER ONLY</p>
      <h1>{title}</h1>
      <p>{description}</p>
      {status && <p className="owner-access-status" role="alert">{status}</p>}
      {action && <div className="owner-access-actions">{action}</div>}
    </section>
  );
}
