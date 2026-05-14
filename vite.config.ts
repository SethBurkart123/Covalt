import type { Plugin } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const md4wWasmPath = new URL(
  "./node_modules/md4w/js/md4w-fast.wasm",
  import.meta.url,
).pathname;

function md4wWasmAlias(): Plugin {
  return {
    name: "md4w-wasm-alias",
    enforce: "pre",
    resolveId(source) {
      if (source === "md4w-wasm" || source === "md4w-wasm?url") {
        return `${md4wWasmPath}?url`;
      }
      return null;
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [
    md4wWasmAlias(),
    tanstackRouter({
      target: "react",
      routesDirectory: "app/routes",
      generatedRouteTree: "app/routeTree.gen.ts",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  server: {
    port,
    strictPort: false,
    host: "localhost",
  },
  build: {
    outDir: "out",
    emptyOutDir: true,
    sourcemap: false,
  },
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@nodes": new URL("./nodes", import.meta.url).pathname,
    },
  },
});
