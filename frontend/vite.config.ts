import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        official: resolve(__dirname, "official.html"),
        docs: resolve(__dirname, "docs.html"),
        download: resolve(__dirname, "download.html"),
        downloadSuccess: resolve(__dirname, "download-success.html"),
        sponsor: resolve(__dirname, "sponsor.html")
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        ws: true
      },
      "/ws": {
        target: "ws://127.0.0.1:8000",
        ws: true
      },
      "/healthz": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true
      }
    }
  }
});
