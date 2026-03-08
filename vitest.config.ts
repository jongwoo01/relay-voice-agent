import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    alias: {
      "@agent/shared-types": path.resolve(
        __dirname,
        "packages/shared-types/src/index.ts"
      ),
      "@agent/local-executor-protocol": path.resolve(
        __dirname,
        "packages/local-executor-protocol/src/index.ts"
      ),
      "@agent/brain-domain": path.resolve(
        __dirname,
        "packages/brain-domain/src/index.ts"
      ),
      "@agent/gemini-cli-runner": path.resolve(
        __dirname,
        "packages/gemini-cli-runner/src/index.ts"
      ),
      "@agent/agent-api": path.resolve(__dirname, "apps/agent-api/src/index.ts")
    }
  },
  test: {
    environment: "node",
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts"
    ]
  }
});
