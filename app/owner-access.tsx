"use client";

import type { ReactNode } from "react";
import { useSiteAuth } from "./site-auth";

export function OwnerAccess({
  icon,
  title,
  label = "PERSONAL WORKSPACE / OWNER ONLY",
  description,
  status,
  action,
}: {
  icon: ReactNode;
  title: string;
  label?: string;
  description: string;
  status?: string;
  action?: ReactNode;
}) {
  return (
    <section className="owner-access">
      <span className="owner-access-icon" aria-hidden="true">{icon}</span>
      <p className="section-label">{label}</p>
      <h1>{title}</h1>
      <p>{description}</p>
      {status && <p className="owner-access-status" role="alert">{status}</p>}
      {action && <div className="owner-access-actions">{action}</div>}
    </section>
  );
}

/**
 * The one access gate for owner-only pages. Its children mount once the owner is verified
 * and unmount only when the signed-in account changes or signs out; same-account rechecks
 * (such as Supabase re-announcing the session when the tab becomes visible) leave them
 * mounted, so open dialogs and unsaved form input survive.
 */
export function OwnerGate({
  icon,
  title,
  label,
  children,
}: {
  icon: ReactNode;
  title: string;
  label?: string;
  children: ReactNode;
}) {
  const { isAdmin, loading, authError, retryAuth } = useSiteAuth();
  if (loading) return <OwnerAccess icon={icon} title={title} label={label} description="Checking your account…" />;
  if (authError) {
    return <OwnerAccess
      icon={icon}
      title={title}
      label={label}
      description={`${title} is temporarily unavailable.`}
      status={authError}
      action={<button className="account-control" type="button" onClick={retryAuth}>Retry</button>}
    />;
  }
  if (!isAdmin) return <OwnerAccess icon={icon} title={title} label={label} description="Sign in to continue." />;
  return children;
}
