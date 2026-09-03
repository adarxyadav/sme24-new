import { z } from "zod";

/**
 * Environment access for the three execution contexts (spec 0001).
 *
 * Each schema is parsed lazily on first access, so a missing variable fails in the context that
 * needs it, with a clear message, and never crashes a context that does not.
 *
 * "deployed" means a Vercel Preview or Production build/runtime (VERCEL_ENV is set) or a
 * Trigger.dev deployment (NODE_ENV is production). Observability keys are required there and
 * optional locally, so `pnpm dev` works before Sentry and PostHog projects exist.
 */

const deployedOnVercel = Boolean(process.env.VERCEL_ENV);
const deployedTask = process.env.NODE_ENV === "production";

const nonEmpty = z.string().trim().min(1, "must not be empty");
const optionalString = z
  .string()
  .trim()
  .transform((value) => (value === "" ? undefined : value))
  .optional();

function requiredWhen(condition: boolean) {
  return condition ? nonEmpty : optionalString;
}

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: nonEmpty,
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_SENTRY_DSN: requiredWhen(deployedOnVercel),
  NEXT_PUBLIC_POSTHOG_KEY: requiredWhen(deployedOnVercel),
  NEXT_PUBLIC_POSTHOG_HOST: z.url().default("https://eu.i.posthog.com"),
});

const serverSchema = clientSchema.extend({
  SUPABASE_SECRET_KEY: nonEmpty,
  TRIGGER_SECRET_KEY: requiredWhen(deployedOnVercel),
  AI_GATEWAY_API_KEY: requiredWhen(deployedOnVercel),
  SENTRY_DSN: requiredWhen(deployedOnVercel),
  PARALLEL_API_KEY: optionalString,
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: optionalString,
});

const taskSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: nonEmpty,
  NEXT_PUBLIC_APP_URL: z.url(),
  AI_GATEWAY_API_KEY: requiredWhen(deployedTask),
  SENTRY_DSN: requiredWhen(deployedTask),
  NEXT_PUBLIC_POSTHOG_KEY: requiredWhen(deployedTask),
  NEXT_PUBLIC_POSTHOG_HOST: z.url().default("https://eu.i.posthog.com"),
  PARALLEL_API_KEY: optionalString,
  RESEND_API_KEY: optionalString,
  EMAIL_FROM: optionalString,
});

export type ClientEnv = z.infer<typeof clientSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;
export type TaskEnv = z.infer<typeof taskSchema>;

export class EnvError extends Error {
  constructor(context: string, issues: z.ZodError["issues"]) {
    const lines = issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`);
    super(
      `Invalid ${context} environment. Fix these variables (see .env.example):\n${lines.join("\n")}`,
    );
    this.name = "EnvError";
  }
}

function parse<T extends z.ZodTypeAny>(context: string, schema: T, raw: unknown): z.infer<T> {
  const result = schema.safeParse(raw);
  if (!result.success) throw new EnvError(context, result.error.issues);
  return result.data;
}

let clientCache: ClientEnv | undefined;
let serverCache: ServerEnv | undefined;
let taskCache: TaskEnv | undefined;

/** Browser safe variables. NEXT_PUBLIC_ keys are listed literally so Next.js can inline them. */
export function clientEnv(): ClientEnv {
  clientCache ??= parse("browser", clientSchema, {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST || undefined,
  });
  return clientCache;
}

/** Server components, server actions, route handlers and the request proxy. */
export function serverEnv(): ServerEnv {
  serverCache ??= parse("server", serverSchema, {
    ...process.env,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST || undefined,
  });
  return serverCache;
}

/** Trigger.dev tasks. */
export function taskEnv(): TaskEnv {
  taskCache ??= parse("task", taskSchema, {
    ...process.env,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST || undefined,
  });
  return taskCache;
}

/** Test helper: forget parsed values so a test can change process.env. */
export function resetEnvCache() {
  clientCache = undefined;
  serverCache = undefined;
  taskCache = undefined;
}
