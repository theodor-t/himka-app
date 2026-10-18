export default function manifest() {
  return {
    name: "ANGEL DETAILING",
    short_name: "ANGEL DETAILING",
    description:
      "Система учета и управления Angel Detailing: записи клиентов, финансы и склад.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0c",
    theme_color: "#0a0a0c",
    icons: [
      {
        src: "/angel-app-icon-192.webp",
        sizes: "192x192",
        type: "image/webp",
        purpose: "any maskable",
      },
      {
        src: "/angel-app-icon.webp",
        sizes: "512x512",
        type: "image/webp",
        purpose: "any maskable",
      },
    ],
  };
}
