import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5180,
    proxy: {
      "/favorites": "http://localhost:3010",
      "/image": "http://localhost:3010",
    },
  },
});
