-- The first credit pack of the contact directory (spec 0018, AC-6): 50 credits at CHF 1.99 net
-- each, CHF 99.50 net, the default MWST rate. A data migration rather than seed.sql because
-- production needs the row; an upsert so a rerun changes nothing. CREDIT_PACKS in
-- src/features/directory/catalogue.ts holds the same key, credits and price, and
-- tests/features/directory/credit-pack-seed.test.ts reads this file by name to keep them equal.

insert into public.packages (key, kind, credits, price_rappen, vat_rate, sort_order, is_active)
values
  ('directory_50', 'directory_credits', 50, 9950, 0.081, 10, true)
on conflict (key) do update set
  kind = excluded.kind,
  credits = excluded.credits,
  price_rappen = excluded.price_rappen,
  vat_rate = excluded.vat_rate,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;
