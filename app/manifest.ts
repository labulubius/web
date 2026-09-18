import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Labulubius — Personal Workspace",
    short_name: "Labulubius",
    description: "A personal workspace for useful links, ideas, and open technologies.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#eff0f1",
    theme_color: "#3daee9",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
