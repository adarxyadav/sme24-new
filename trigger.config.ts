import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";
import { esbuildPlugin } from "@trigger.dev/build/extensions";
import { defineConfig } from "@trigger.dev/sdk";

// Source maps for task errors are uploaded on deploy only when the Sentry build variables are set.
const sentryUpload = process.env.SENTRY_AUTH_TOKEN
  ? [
      esbuildPlugin(
        sentryEsbuildPlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: process.env.SENTRY_AUTH_TOKEN,
        }),
        { placement: "last", target: "deploy" },
      ),
    ]
  : [];

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_fqmmullopmjdfqkqdrca",
  runtime: "node-22",
  logLevel: "info",
  maxDuration: 300,
  dirs: ["./src/trigger"],
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 10_000,
      factor: 2,
      randomize: true,
    },
  },
  build: {
    extensions: sentryUpload,
  },
});
