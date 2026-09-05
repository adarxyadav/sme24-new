# 0006. Transactional email and ops alerts: rationale

_The decision record behind [index.md](index.md). `/develop` reads the index only; this file is for people and for a later `/architect` update._

## Context

> ⚠️ Premise note: no sending domain exists yet (feature 6 deferred it for lack of DNS access to `sme24.ch`), so nothing hosted can deliver to a real client until those records exist. The design must stay honest without a domain: local sends go to Mailpit, staging sends are limited to an allowlist, and the domain steps are a checklist, not a build task. A second boundary worth stating: the auth emails (confirmation, code, reset, invite) already leave through Supabase's SMTP path from spec 0005 and are out of scope here.

SME24's client journey is a chain of moments where a person is not in the app: the account is ready, the benchmark finished, the payment landed, the expert was assigned, the report is out. Each moment needs an email in the recipient's language, and the ops team needs to hear about the events that require a human (a sign up, a failed research run, a payment, an enquiry). Slice 1 has only one real event today, the first confirmed sign in that creates the organization, but Slices 2 to 8 add at least seven more emails and three more alerts. Whatever is built now is the rail every later feature rides.

Spec 0001 already fixed the provider (Resend) and the runtime (every send inside a Trigger.dev task, templates as React Email components), spec 0002 reserved the `notifications` table for the email tasks to write, and spec 0004 built the standalone translator and the stored per user language for exactly this purpose. The open questions were the shape of the rail: how a caller asks for an email, what is recorded, how ops see failures, how alerts reach the team, and how the build stays testable on a laptop and safe on staging.

The forces: a two person team that must operate this at any hour, so few moving parts and boring tools; the revised Swiss FADP, so every copy of an address or a name is a decision; a Tracer Bullet approach, so the first slice must run a real message end to end; e2e tests that already read Mailpit for the auth flows; Trigger.dev retries and run logs already in place; and no domain, so staging must not send to strangers.

Not deciding would leave each later feature to invent its own send path and its own log, and would leave failed emails invisible, which the scope's done condition rules out.

## Options considered

### Option 1: Send inline from server actions with the Resend SDK, no tables

Each action that needs an email calls the Resend SDK directly with a rendered template; ops look at the Resend dashboard.

**Pros**:
- Smallest build: no tables, no tasks, no ops page.
- One code path, one vendor screen.

**Cons**:
- No retry, no run id, no record when Resend is slow or down; a sign in would wait on the send or lose it.
- Contradicts spec 0001, which routes every send through Trigger.dev for exactly that reason.
- Failed sends are visible only in a vendor dashboard, not in the product, and local development has no inbox.

### Option 2: Outbox table plus one generic task, two transports, webhook status, Slack incoming webhook (chosen)

A caller triggers `send-email` with a template key and typed data. The task writes an `email_deliveries` row and a `notifications` row, renders the React Email template in the recipient's language, and sends through the Resend SDK when a key exists or through SMTP to Mailpit locally. Resend's webhook feeds delivered, bounced and complained back into the row. Ops read the rows on `/admin/emails` and retry failures. A separate `ops-alert` task posts Block Kit messages to a Slack incoming webhook from a typed registry of alert kinds.

**Pros**:
- Every send is durable, retried, idempotent and visible in the product; a retry rerenders from stored data.
- Adding an email or an alert later is one file, not a design.
- Real emails in Mailpit locally, next to the auth emails the tests already read.
- The allowlist makes staging safe before a domain exists.
- Slack through a webhook is a single POST with no app install.

**Cons**:
- Two transports to keep honest; the hosted path is proven only on staging.
- A new table with personal data, so retention and erasure are now this feature's problem.
- Two more secrets and one more vendor (Slack) per environment.

### Option 3: A notification platform (Knock, Courier or Novu) for email, Slack and the in app feed

A hosted notification service owns templates, channels, preferences and the delivery log; the app sends events, the platform fans out to Resend, Slack and an in app feed component.

**Pros**:
- Delivery log, preferences, digests and the in app feed come built in.
- One event API for every channel.

**Cons**:
- Another vendor holding names, addresses and message content, another data processing agreement, and most of them are US hosted with no EU option on the free tier.
- Templates leave the repo (no React Email, no next-intl catalog, no parity checks), so the localization foundation from spec 0004 stops applying to emails.
- Overkill for two languages, a handful of templates and one team channel; the price and the lock in arrive long before the volume.

### Option 4: Database webhooks or Supabase Queues driving Supabase Edge Functions

An insert on `organizations` fires `pg_net` to a Trigger.dev endpoint or an Edge Function that sends the email; alerts the same way.

**Pros**:
- Fully decoupled from the app code; a row insert is the event.
- No trigger call inside the sign in path.

**Cons**:
- The secret and the payload logic live in the database; local runs need `pg_net` reaching a tunnel.
- Spec 0001 keeps the Node runtime only and leaves Edge Functions out; a second runtime is a second deploy pipeline.
- A raw row is a poor event: the template data would be reassembled in SQL or in the function, and idempotency keys would have to be derived there too.

## Rationale

Option 2 follows the lines earlier specs already drew (Trigger.dev for sends, React Email on the standalone translator, a reserved `notifications` table) and turns them into a rail that later features reuse without thought. The outbox row before the send is what makes the scope's done condition ("failed sends are visible to ops") true in the product rather than in a vendor dashboard, and the same row is what a retry and a preview rerender from. Two transports cost a second code path, but the alternative is a Resend key on every laptop and real network in every test, which the e2e suite already avoids for the auth emails by reading Mailpit; reusing that inbox is cheaper than any new test infrastructure.

The finer calls follow the same forces. One generic task over one task per template because the render, send and log steps would otherwise be copied seven times. App code triggers the task at the event site because the caller already holds the typed data and the idempotency key, and a swallowed trigger failure keeps the sign in path safe. The Resend SDK rather than SMTP everywhere because the webhook needs the message id and the SDK gives idempotency keys and tags. A route handler updates the row directly because a one row update needs no second hop. Slack through `fetch` because the whole integration is one POST. The allowlist because staging shares test data with real looking addresses and a skipped row is safer than a bounced one. Ninety day retention and no rendered HTML copy because the rows hold personal data and a rerender covers the ops use case. English alerts because the channel is internal and a translator call on the alert rail buys nothing. The notification row written with the delivery, not after the send, because the in app feed should not depend on whether an email left. No alert table and no audit trigger on a log table because the log would be logging itself.

Option 1 would have been faster this week and slower every week after; Option 3 trades the localization foundation and an EU data story for features the product does not need yet; Option 4 moves the hard parts into the database where they are hardest to test.

## Discovery notes

Agent Skills and MCP servers were searched after the stack walk (engineer consent given). Installed: `nodemailer` (`aidotnet/moyucode`) and `email-testing` (`petrkindlmann/qa-skills`). Declined after a look: `vercel-labs/slack-agent-skill` (its skill is about building Slack bots on Vercel's agent framework, not incoming webhooks; installed and removed the same minute). Not found: `vm0-ai/vm0-skills@slack-webhook` (the repository lists no such skill). Chosen but not connected: the Resend MCP server (`resend/resend-mcp`) and the Slack MCP server (`slackapi/slack-skills-plugin`); connecting is a user side settings step.

## Cross check

An independent read only pass on a different model (Opus) reviewed the draft on 2026-09-05 and found 17 decision gaps and 8 soundness notes. All were applied to `index.md` on the engineer's pick, except two that were verified wrong or overruled: the claim that only the `svix` package can verify the webhook (the `resend` SDK ships `webhooks.verify`, a minimum version is noted instead), and the suggestion to defer the `notifications` writes to feature 23 (spec 0002 reserved them for the email tasks and the engineer chose to write them now; a `notify` flag on the registry keeps ops test sends out of the feed). The blocking fixes: `ensureOrganization` now returns the organization id and a `created` flag so the idempotency keys have a source; the Trigger.dev key is created with global scope and a TTL and a retry passes none; the task payload is a discriminated union; `attempts` counts task attempts across runs; the `sent` write never overwrites a webhook state.
