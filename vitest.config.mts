import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    // React コンポーネントのテストに備えて DOM を用意する
    environment: "jsdom",
    // describe / it / expect を import なしで使えるようにする
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      // tsconfig の paths と同じ解決を vitest 側にも与える
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
