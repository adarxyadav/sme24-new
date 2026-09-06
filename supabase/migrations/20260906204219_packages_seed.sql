-- Packages seed (spec 0011, AC-14). The three fixed price packages plus the one sold by
-- conversation, promoted from PACKAGES in src/features/marketing/packages.ts so the pricing page
-- and the checkout read the same numbers. `tests/packages.test.ts` fails when the two drift.
--
-- Prices are whole Rappen excluding VAT: CHF 2'000.00 is 200000. `retainer` has no price, which
-- is what makes it unpurchasable (AC-19).
--
-- A data migration, not seed.sql, because production needs these rows. Every statement is an
-- upsert, so a rerun changes no row count, and a later price change is a new migration with its
-- own date rather than an edit of this one.

insert into public.packages (key, price_rappen, vat_rate, sort_order, is_active)
values
  ('culture', 200000, 0.081, 1, true),
  ('sms', 500000, 0.081, 2, true),
  ('compliance', 1000000, 0.081, 3, true),
  ('retainer', null, 0.081, 4, true)
on conflict (key) do update set
  price_rappen = excluded.price_rappen,
  vat_rate = excluded.vat_rate,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;
