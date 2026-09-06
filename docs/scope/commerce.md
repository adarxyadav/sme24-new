# Commerce & ops · SME24

Part of the [SME24 scope](index.md). The paid half of the loop, and the ops team's view of it. Booking works as pay first, then your team schedules the on site date by email and records it in the admin. No calendar logic in Release 1.

## Slice 3: Book and pay

### 11. Package checkout with Swiss VAT · needs a decision
From the opportunity dashboard the client picks one of the three fixed price packages (Compliance, Safety Management System, Safety Culture assessments), pays online with Swiss VAT (MWST) applied, and gets an order plus receipt. The order state model, VAT handling, and how payment confirmation reaches the database reliably are the decisions.
**Done when:** a client can buy each of the three packages in CHF with MWST shown on the invoice and receipt; a confirmed payment creates an order the client sees in the dashboard even if they close the browser; a failed or abandoned payment leaves no half order.
Carried over from earlier specs: the four packages and prices already live in `src/features/marketing/packages.ts` and the pricing page's three fixed price buttons wait for checkout (spec 0009); promote that catalog into the `packages` table with a test that keeps the two equal.
- [ ] Design it (spec): `/architect package checkout with Swiss VAT`

### 12. Ops admin: orders, companies & scheduling · needs a decision
Your team's first screen. Ops sees companies, research runs, orders and payments, records the agreed on site date and the assigned assessor on an order, and the client dashboard reflects that status. The admin shell built here hosts every later ops feature.
**Done when:** ops can list and open companies and orders, set an assessment date and assessor, and the client sees "scheduled for" with the date; ops only routes are invisible to clients and experts.
Carried over from earlier specs: `/admin/emails` and `/admin/enquiries` already exist in the same shape and may fold into the shell (specs 0006 and 0009); a read only view of `benchmarks` and `benchmark_assumptions` with the provisional flags plus a per company snapshot list with a recompute action (spec 0008); TOTP enrollment with an `aal2` check in the proxy for `/admin` and an inactivity cutoff for ops sessions (spec 0005), noting that the `[auth.mfa]` block in `supabase/config.toml` is pushed on every deploy, so the switch lives there.
- [ ] Design it (spec): `/architect ops admin`

## Slice 8: Thicken the accounts

### 24. Ops metrics dashboard · Beta
Signups, research runs, benchmarks viewed, checkouts started and paid, revenue, active assessments and programs, in the admin area. Reads the same funnel events feature 15 records.
**Done when:** the admin shows those counts for a chosen period with week over week change, and the numbers reconcile with the orders and events tables.
- [ ] Build it: `/develop ops metrics dashboard`
