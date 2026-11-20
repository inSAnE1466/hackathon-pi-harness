import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Workerd cannot read Vitest 5's host-filesystem module cache.
  test: { fsModuleCache: false, include: ["test/**/*.test.{ts,tsx}"] },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          BRANE_BASE_URL: "https://brane.test/api/v1",
          BRANE_API_KEY: "test-brane-key",
          TEAM_PASSWORD: "",
        },
      },
    }),
  ],
});
