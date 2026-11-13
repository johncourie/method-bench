/// <reference types="vitest/config" />
import { defineConfig } from "vite";

// base "./" so the built site works from any GitHub Pages sub-path.
export default defineConfig({
  base: "./",
  clearScreen: false,
  server: { port: 5183, strictPort: true },
  preview: { port: 5184, strictPort: true },
  test: { include: ["tests/**/*.test.ts"] },
});
