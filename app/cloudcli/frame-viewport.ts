const frameProperties = [
  "--cloudcli-slot-top", "--cloudcli-slot-left", "--cloudcli-slot-width",
  "--cloudcli-slot-height", "--cloudcli-slot-visibility",
];

/** Fit the persistent frame to the route's content slot without moving or reloading it. */
export function attachCloudCLIViewport(viewport: HTMLElement): () => void {
  let frame: HTMLElement | null = null;
  let pending: number | null = null;

  function update() {
    pending = null;
    frame ??= document.querySelector<HTMLElement>(".cloudcli-page");
    if (!frame) return;
    discovery.disconnect();
    frame.id = "cloudcli-persistent-workspace";
    const bounds = viewport.getBoundingClientRect();
    const visible = bounds.width > 0 && bounds.height > 0;
    frame.style.setProperty("--cloudcli-slot-top", `${bounds.top}px`);
    frame.style.setProperty("--cloudcli-slot-left", `${bounds.left}px`);
    frame.style.setProperty("--cloudcli-slot-width", `${Math.max(0, bounds.width)}px`);
    frame.style.setProperty("--cloudcli-slot-height", `${Math.max(0, bounds.height)}px`);
    frame.style.setProperty("--cloudcli-slot-visibility", visible ? "visible" : "hidden");
    viewport.dataset.cloudcliReady = String(visible);
  }

  function schedule() {
    if (pending === null) pending = window.requestAnimationFrame(update);
  }

  const resize = new ResizeObserver(schedule);
  // On a client transition the root keep-alive frame can mount after this slot.
  const discovery = new MutationObserver(schedule);
  resize.observe(viewport);
  discovery.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", schedule, true);
  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", schedule);
  update();

  return () => {
    resize.disconnect();
    discovery.disconnect();
    if (pending !== null) window.cancelAnimationFrame(pending);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("scroll", schedule, true);
    window.visualViewport?.removeEventListener("resize", schedule);
    window.visualViewport?.removeEventListener("scroll", schedule);
    for (const property of frameProperties) frame?.style.removeProperty(property);
    delete viewport.dataset.cloudcliReady;
  };
}
