import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5180,
    allowedHosts: true,
    proxy: {
      "/favorites": "http://localhost:3010",
      "/image": "http://localhost:3010",
    },
  },
});
