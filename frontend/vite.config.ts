import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@reactflow/core": path.resolve(__dirname, "./node_modules/@reactflow/core/dist/esm/index.js"),
    },
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    host: true,
    proxy: {
      "/api": {
        target: "http://localhost:8001",
        changeOrigin: true,
      },
    },
    // Otimizações para reduzir uso de memória em sistemas com RAM limitada
    watch: {
      // Ignora node_modules e arquivos gerados para reduzir watchers
      ignored: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
    },
    hmr: {
      // Reduz overhead do HMR
      overlay: false,
    },
  },
  // Reduz cache em memória
  cacheDir: "node_modules/.vite",
  optimizeDeps: {
    // Limita pre-bundling para economizar memória
    include: ["react", "react-dom", "react-router-dom"],
  },
  build: {
    // Reduz paralelismo durante build
    rollupOptions: {
      maxParallelFileOps: 2,
    },
  },
});
