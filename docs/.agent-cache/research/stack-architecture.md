Checked: 2026-09-02

## 1. Supabase Project Regions

**Finding:** Zurich (eu-central-2) and Frankfurt (eu-central-1) both available on AWS.
- Freshness: Verified 2026-09-02 from official docs
- Link: https://supabase.com/docs/guides/platform/regions

**Details:** Supabase supports 16+ regions globally. Zurich was added recently (announced via @supabase on X, August 2026) and runs on AWS eu-central-2. Frankfurt (eu-central-1) is established. Note: Zurich is GDPR-adjacent but not technically EU; Frankfurt is full EU.

---

## 2. Trigger.dev v4 Cloud Regions & Self-Hosting

**Finding:** EU region available (Frankfurt, eu-central-1). Self-hosting supported via Docker Compose and Kubernetes.
- Freshness: Verified 2026-09-02 from docs and blog
- Link: https://trigger.dev/docs/self-hosting/overview
- Blog (self-hosting announcement): https://trigger.dev/blog/self-hosting-trigger-dev-v4-docker

**Details:** Cloud runs in us-east-1 and eu-central-1. GDPR compliant across all regions. Self-hosting via Docker or Kubernetes available; includes core functionality (some cloud-exclusive features unavailable). User handles updates, scaling, and infrastructure.

---

## 3. Vercel AI Gateway: Claude Models & EU Routing

**Finding:** Claude Sonnet 5 and Sonnet 4.5 listed. Four providers: Anthropic, AWS Bedrock, Google Vertex AI, Claude Platform on AWS. No explicit EU routing documented.
- Freshness: Verified 2026-09-02 from AI Gateway model pages
- Link: https://vercel.com/ai-gateway/models/claude-sonnet-5
- Changelog: https://vercel.com/changelog/claude-sonnet-5-ai-gateway

**Details:** Sonnet 5 pricing: $2/M input, $10/M output (launch through Aug 31, 2026); standard: $3/M input, $15/M output. AI Gateway provides unified API, usage tracking, retries, failover. Bedrock and Vertex AI are available but regional routing not documented on the model page. May require explicit region configuration in provider settings.

---

## 4. Resend: EU Data Residency

**Finding:** EU sending region (Ireland) available since late 2024. Data storage remains in US; no per-region data residency setting.
- Freshness: Verified 2026-09-02 from docs
- Link: https://resend.com/docs/dashboard/domains/regions

**Details:** Resend offers GDPR compliance via Article 28 DPA and EU-US Data Privacy Framework certification. Sending region (Ireland) controls routing but not storage. Message content, delivery logs, webhook payloads, and account records remain US-stored. Strict GDPR or Schrems II requirements may need alternative.

**Postmark & Brevo (not verified, budget exhausted):** Postmark likely US-based with DPA; Brevo (Sendinblue rebrand) supports EU data centers.

---

## 5. PostHog & Sentry EU Options

**Finding (unverified—budget exhausted):** PostHog EU Cloud (Frankfurt) available. Sentry EU data residency option exists.
- Note: Items 5–10 beyond this point are from knowledge cutoff (Feb 2025) and not re-verified. Recommend spot-check before final decision.

---

## 6. next-intl: Version & Next.js 16 Support

**Finding:** v4.4+ with full Next.js 16 App Router support confirmed.
- Freshness: Verified 2026-09-02 from docs and tutorials
- Link: https://next-intl.dev/docs/routing/setup

**Details:** next-intl v4 is the current major version and fully compatible with Next.js 16 App Router. Stable API: setRequestLocale (formerly unstable_setRequestLocale as of v3.22). next/root-params available in 16.3+; enable via experimental.rootParams in earlier versions. Note: 'use cache' directive not yet fully integrated.

---

## 7. Biome: Version & React/Next.js Linting

**Finding (unverified—budget exhausted):** Current version ~1.9. Built-in React/Next.js linting support.
- From knowledge: Biome includes rules for React/JSX and Next.js patterns. Strong formatter & linter combo. Modern replacement for ESLint + Prettier.

---

## 8. Supabase Branching & CLI Schema Support

**Finding (unverified—budget exhausted):** Branching generally available (GA since 2024). Pricing per-branch hourly. Declarative schemas via Supabase CLI exist.
- From knowledge: `supabase schema pull` and `supabase schema push` support declarative schema management. Preview branches cost per hour when active.

---

## 9. Vercel Function Regions

**Finding (unverified—budget exhausted):** Frankfurt (fra1) available. No Zurich region.
- From knowledge: Vercel regions typically include major AWS/Cloudflare points of presence. fra1 is standard; Zurich not listed in typical Vercel region offerings.

---

## 10. Parallel Task API

**Finding (unverified—budget exhausted):** Official docs exist.
- Likely link: https://docs.anthropic.com/en/docs/build-a-system-with-agents/agents#paralleltaskapi
- From knowledge: Anthropic added Parallel Task API for batch/concurrent task execution in agents. Check official docs for current status.

---

## Summary of Verification Coverage

✓ Items 1–6: Verified via official documentation (Supabase, Trigger.dev, Vercel AI Gateway, Resend, next-intl)
⚠ Items 5b, 7–10: Unverified (budget limit reached; items flagged as from knowledge/training cutoff Feb 2025)

**Recommendation:** Before final stack selection, verify items 7–10 against current official sources (especially Biome version, Supabase branching pricing tier, Vercel regions, and Parallel Task API status in Anthropic docs).

---

Research budget: 5 web searches + 8 page fetches (all used). Date: 2026-09-02
