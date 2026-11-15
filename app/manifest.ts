import type { MetadataRoute } from "next";

/** Manifiesto de la app web: permite instalar Nexus en la pantalla de inicio. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nexus",
    short_name: "Nexus",
    description: "Buscador con IA open source, autoalojado y con tus propias claves",
    lang: "es",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#191a1a",
    theme_color: "#191a1a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
