import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

export default defineConfig(baseConfig, {
  testMatch: "manual-backlinks.spec.ts",
  use: {
    ...baseConfig.use,
    viewport: { width: 1600, height: 1000 },
    video:
      process.env.PLAYWRIGHT_VIDEO === "off" ? "off" : baseConfig.use?.video,
    ...(executablePath && {
      channel: undefined,
      launchOptions: { executablePath },
    }),
  },
});
