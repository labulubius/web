"use client";

import { type MouseEvent, type ReactNode, useEffect, useRef } from "react";

const focusable = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function AccessibleDialog({ children, labelledBy, onClose, busy = false, className = "" }: {
  children: ReactNode;
  labelledBy: string;
  onClose: () => void;
  busy?: boolean;
  className?: string;
}) {
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => { closeRef.current = onClose; busyRef.current = busy; }, [onClose, busy]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    const controls = () => element ? [...element.querySelectorAll<HTMLElement>(focusable)].filter((item) => item.offsetParent !== null) : [];
    const initialFocusFrame = window.requestAnimationFrame(() => {
      const preferred = element?.querySelector<HTMLElement>("[autofocus]");
      (preferred ?? controls()[0] ?? element)?.focus();
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busyRef.current) closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = controls();
      if (!items.length) { event.preventDefault(); element?.focus(); return; }
      const first = items[0]; const last = items.at(-1)!;
      const activeIndex = document.activeElement instanceof HTMLElement ? items.indexOf(document.activeElement) : -1;
      if (activeIndex < 0) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && activeIndex === 0) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && activeIndex === items.length - 1) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      window.cancelAnimationFrame(initialFocusFrame);
      document.removeEventListener("keydown", keydown);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  function backdrop(event: MouseEvent<HTMLDivElement>) {
    if (!busy && event.target === event.currentTarget) onClose();
  }

  return <div className="dialog-backdrop" role="presentation" onMouseDown={backdrop}>
    <section ref={dialog} className={`breeze-dialog${className ? ` ${className}` : ""}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1}>
      {children}
    </section>
  </div>;
}
