import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "./renderer",
  plugins: [react()],
  base: "./",
  build: {
    assetsInlineLimit: 0,
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (
            id.includes("/@react-three/") ||
            id.includes("/react-use-measure/") ||
            id.includes("/suspend-react/") ||
            id.includes("/zustand/")
          ) {
            return "react-three-vendor";
          }

          if (id.includes("/three/")) {
            return "three-vendor";
          }

          if (id.includes("/motion/")) {
            return "motion-vendor";
          }

          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/")
          ) {
            return "react-vendor";
          }

          return "vendor";
        }
      }
    }
  }
});
