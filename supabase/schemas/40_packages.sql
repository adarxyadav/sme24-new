-- Packages (spec 0011, kind G: global reference data, no tenant owner). One row per assessment
-- package sold on the pricing page. Names, promises and included points stay in the message
-- catalogs under `marketing.packages.<key>.*`; only the price, the VAT rate, the display order
-- and the active flag live here, so the checkout and the pricing page can never disagree on a
-- number. `src/features/marketing/packages.ts` holds the same key, price and sort order, and
-- `tests/packages.test.ts` fails when the two drift (AC-14).
-- Seeded by a data migration, not by seed.sql, because production needs the rows too.

create table public.packages (
  -- Matches PACKAGE_KEYS in src/features/marketing/packages.ts.
  key text primary key check (key in ('compliance', 'sms', 'culture', 'retainer')),
  -- Net price in whole Rappen excluding VAT (CHF 2'000.00 is 200000). Null for the package sold
  -- by conversation; a null price can never enter checkout (AC-19).
  price_rappen bigint null check (price_rappen is null or price_rappen > 0),
  -- The Swiss MWST rate applied at purchase. Per row, so a future rate change is a data
  -- migration with a date rather than a redeploy.
  vat_rate numeric(5, 4) not null default 0.081 check (vat_rate >= 0 and vat_rate < 1),
  sort_order integer not null check (sort_order > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.packages is 'The assessment packages and their net prices in Rappen. Read by every signed in user, written by ops only; kept equal to PACKAGES in src/features/marketing/packages.ts by a Vitest test.';
comment on column public.packages.price_rappen is 'Net price excluding VAT in whole Rappen (1 CHF = 100 Rappen). Null means sold by conversation and not purchasable.';
comment on column public.packages.vat_rate is 'The MWST rate frozen onto an order at purchase; 0.081 since 2024.';
comment on column public.packages.is_active is 'An inactive package cannot start a new checkout; existing orders are unaffected.';

create index packages_sort_order_idx on public.packages (sort_order);

alter table public.packages enable row level security;

-- Reference data: every signed in user reads it, so the checkout can price a package.
create policy "packages: signed in users read"
  on public.packages
  for select
  to authenticated
  using (true);

create policy "packages: ops full access"
  on public.packages
  for all
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

-- Prices change through a migration or ops, never through a client. The declarative diff drops
-- column grants after a table level REVOKE, so a migration re adds nothing here: there is no
-- column grant to re add, the whole verb stays revoked (AGENTS.md).
revoke insert, update, delete on public.packages from anon, authenticated;

create trigger packages_set_updated_at
  before update on public.packages
  for each row execute function public.set_updated_at();

-- No audit trigger, deliberately. private.audit_row() writes audit_log.row_id from the row's
-- `id` column, which this table does not have: like public.kpi_definitions and
-- public.benchmark_assumptions, the other two global reference tables, the primary key is `key`.
-- Those two are unaudited for the same reason and this one follows them. Nothing is lost: a price
-- is frozen onto every order at purchase, so the money history lives on public.orders, and a
-- price change itself arrives through a migration that git already records.

-- TRUNCATE walks around RLS and fires no row trigger; Supabase's default privileges hand it to
-- all three app roles at creation, so every table revokes it explicitly.
revoke truncate on public.packages from anon, authenticated, service_role;
