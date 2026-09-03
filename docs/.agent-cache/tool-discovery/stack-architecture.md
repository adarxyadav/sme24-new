# Tool Discovery: SME24 Tech Stack
**Checked: 2026-09-02**

## Installed Skills (Do Not Recommend)
These jsmastery-pro/skills are already installed; never offer these:
- architect, audit, check, debug, develop, document, scope, sync, test

## Skill Candidates by Technology

### Next.js / React
- **supabase/agent-skills** — Supabase integration for Next.js SSR patterns, Auth, Edge Functions, Realtime, Storage; covers supabase-js and @supabase/ssr client libraries
- **vercel-labs/agent-skills** — Vercel React and deployment skills (start here for React apps)
- **Lombiq/Tailwind-Agent-Skills** — Tailwind CSS v4 documentation skill with local snapshots

### Supabase
- **supabase/agent-skills** — Database, Auth, Edge Functions, Realtime, Storage, Vectors, Cron, Queues with procedural patterns

### Playwright / E2E Testing
- **lackeyjb/playwright-skill** — General-purpose Playwright automation for coding agents
- **testdino-hq/playwright-skill** — Production-tested Playwright skills (70+ patterns): auth flows, visual testing, CI setup, test scaling

### Biome / TypeScript Linting
- **yonatangross/orchestkit** (biome-linting) — Biome 2.0+ linting and formatting configuration, TypeScript/JavaScript code quality, rule management
- **paulrberg/agent-skills** (biome-js) — Biome linting setup and configuration

### Vercel Deploy
- **vercel-labs/agent-skills** — Includes Vercel deployment integration

## MCP Server Candidates

### Email & Communication
- **Resend** — Official resend-mcp (remote hosted MCP at https://resend.com/docs/mcp-server); send emails, manage contacts, React Email templates; npm install `resend-mcp`

### Data & Analytics
- **PostHog** — Official PostHog MCP (https://mcp.posthog.com/mcp); hosted endpoint for feature flags, HogQL queries, stack traces, CDP; free tier available

### Database
- **Supabase** — Official Supabase MCP; schema exploration, SQL validation, read-only database access to PostgreSQL

### Error Tracking
- **Sentry** — Official Sentry MCP; error reports, stacktraces, debugging information from Sentry.io

### Payments
- **Stripe** — Official Stripe MCP vendor server; payment operations and queries

### Browser Automation
- **Vercel agent-browser** — CLI-based browser automation (via `npx @vercel/agent-browser`); lighter context than Playwright MCP; good for navigation and verification tasks

## Technologies with No Credible Hits
- **Trigger.dev v4** — No dedicated agent skill found; may use queue integration patterns
- **Vercel AI SDK v6** — No dedicated skill found; covered under vercel-labs/agent-skills
- **Parallel Task API** — No dedicated skill found
- **next-intl** — No dedicated skill found
- **Stripe checkout/tax** — Stripe MCP available but no specific checkout/tax skill
- **React Hook Form** — No dedicated skill found
- **Zod** — No dedicated skill found
- **axe-core / accessibility** — No dedicated skill found
- **Vitest** — No dedicated skill found

## Notes
- Vercel's agent-browser uses 82% less context than Playwright MCP for simple tasks
- Supabase agent-skills have the most comprehensive coverage for this stack
- PostHog MCP is free and hosted; straightforward integration
- Resend provides first-party MCP with React Email template support
- Biome skills available but multiple candidates; yonatangross/orchestkit appears most active
