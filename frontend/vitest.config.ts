import { defineConfig, mergeConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default mergeConfig(
  defineConfig({
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  }),
  defineConfig({
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
    },
  })
);
