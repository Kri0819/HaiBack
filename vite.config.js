import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: false, // using public/manifest.json directly
      workbox: {
        // Let workbox auto-discover build output instead of a manual
        // glob pattern — manual patterns break the build if no files
        // match (e.g. public/icons/ being empty).
        globDirectory: "dist",
        globPatterns: ["**/*.{js,css,html,ico,svg,woff2}"],
      },
    }),
  ],
});
