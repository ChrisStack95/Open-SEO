import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Explicit opt-in integration suite; the normal unit-test config excludes it.
export default defineConfig({
  root: fileURLToPath(new URL("../", import.meta.url)),
  resolve: {
    alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  },
  test: {
    include: ["tests/tracked-backlinks.pg-integration.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    clearMocks: true,
  },
});
