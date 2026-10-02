"use client";

import { ArrowRight, HardDrive } from "lucide-react";
import Link from "next/link";

export function DriveShortcut() {
  return (
    <Link href="/drive" className="action-row">
      <span className="action-icon"><HardDrive size={24} /></span>
      <span><strong>Open Private Drive</strong><small>Manage your private files and folders · Administrator only</small></span>
      <ArrowRight size={18} />
    </Link>
  );
}
