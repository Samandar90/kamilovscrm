import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    // The public TV screen (/tv) loads the main entry chunk too, and hall TVs run Chromium >= 87. Vite 7's default
    // target (chrome107) may emit syntax those engines cannot parse (class static blocks, `#field in obj`).
    target: ["es2020", "chrome87", "edge88", "firefox78", "safari14"],
  },
});

