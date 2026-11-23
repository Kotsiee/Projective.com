-- Views: finance reconciliation + integrations connections + analytics drift
-- (from 20260723094000, 20260724101000, 20260724110000)

-- Each wallet's cached balance against its ledger, and its pots (FINANCE_AUDIT L7): `earmarked_cents`
-- is what its active pots earmark, never more than `balance_cents`; `pot_drift_cents` is its pots'
-- balances minus their finance.pot_movements (Σ in − Σ out), 0 while every pot change went through a
-- door. Read by finance.fn_reconcile_wallets; service role only.
CREATE OR REPLACE VIEW finance.v_wallet_reconciliation AS
SELECT
    w.id AS wallet_id,
    w.owner_type,
    w.owner_id,
    w.currency,
    w.balance_cents,
    COALESCE(SUM(CASE t.direction WHEN 'credit' THEN t.amount_cents ELSE -t.amount_cents END), 0) AS ledger_sum_cents,
    w.balance_cents - COALESCE(SUM(CASE t.direction WHEN 'credit' THEN t.amount_cents ELSE -t.amount_cents END), 0) AS drift_cents,
    (SELECT COALESCE(SUM(p.balance_cents), 0) FROM finance.wallet_pots p
      WHERE p.wallet_id = w.id AND p.active) AS earmarked_cents,
    (SELECT COALESCE(SUM(p.balance_cents), 0) FROM finance.wallet_pots p WHERE p.wallet_id = w.id)
      - (SELECT COALESCE(SUM(CASE m.direction WHEN 'in' THEN m.amount_cents ELSE -m.amount_cents END), 0)
           FROM finance.pot_movements m WHERE m.wallet_id = w.id) AS pot_drift_cents
FROM finance.wallets w
LEFT JOIN finance.transactions t ON t.wallet_id = w.id
GROUP BY w.id, w.owner_type, w.owner_id, w.currency, w.balance_cents;

-- Every FX conversion whose ledger legs, or whose funded escrows, do not add up (Decision #435): one row
-- per problem, empty while every conversion was written through its doors. A purchase debits its source
-- `principal_minor` (`fx_conversion`) and `spread_minor` (`fx_spread`) and credits its target `to_minor`
-- (`fx_conversion`), every leg naming it, and the escrows it stamped never cost more than it charged. An
-- escrow's unwinds are credited to their target, naming the escrow, exactly as recorded. Read by
-- finance.fn_reconcile_wallets; service role only.
CREATE OR REPLACE VIEW finance.v_fx_conversion_reconciliation AS
WITH purchase_legs AS (
    SELECT c.id AS conversion_id, c.kind, c.principal_minor, c.spread_minor, c.to_minor, c.from_minor,
           COALESCE(SUM(t.amount_cents) FILTER (WHERE t.wallet_id = c.from_wallet_id AND t.direction = 'debit'
                                                  AND t.reason = 'fx_conversion'), 0)::bigint AS principal_ledger,
           COALESCE(SUM(t.amount_cents) FILTER (WHERE t.wallet_id = c.from_wallet_id AND t.direction = 'debit'
                                                  AND t.reason = 'fx_spread'), 0)::bigint AS spread_ledger,
           COALESCE(SUM(t.amount_cents) FILTER (WHERE t.wallet_id = c.to_wallet_id AND t.direction = 'credit'
                                                  AND t.reason = 'fx_conversion'), 0)::bigint AS credit_ledger
      FROM finance.fx_conversions c
      LEFT JOIN finance.transactions t ON t.ref_table = 'fx_conversions' AND t.ref_id = c.id
     WHERE c.kind = 'purchase'
     GROUP BY c.id, c.kind, c.principal_minor, c.spread_minor, c.to_minor, c.from_minor
), purchase_escrows AS (
    SELECT e.fx_conversion_id AS conversion_id, SUM(e.fx_source_minor)::bigint AS shares
      FROM finance.escrows e
     WHERE e.fx_conversion_id IS NOT NULL
     GROUP BY e.fx_conversion_id
), unwind_credits AS (
    SELECT u.ref_id AS escrow_id, u.to_wallet_id, SUM(u.to_minor)::bigint AS to_minor,
           COALESCE((SELECT SUM(t.amount_cents) FROM finance.transactions t
                      WHERE t.wallet_id = u.to_wallet_id AND t.direction = 'credit' AND t.ref_table = 'escrows'
                        AND t.ref_id = u.ref_id AND t.fx_rate IS NOT NULL), 0)::bigint AS credit_ledger
      FROM finance.fx_conversions u
     WHERE u.kind = 'unwind'
     GROUP BY u.ref_id, u.to_wallet_id
)
SELECT l.conversion_id, l.kind, NULL::uuid AS escrow_id, 'principal' AS problem,
       l.principal_minor AS expected_minor, l.principal_ledger AS ledger_minor
  FROM purchase_legs l WHERE l.principal_ledger <> l.principal_minor
UNION ALL
SELECT l.conversion_id, l.kind, NULL::uuid, 'spread', l.spread_minor, l.spread_ledger
  FROM purchase_legs l WHERE l.spread_ledger <> l.spread_minor
UNION ALL
SELECT l.conversion_id, l.kind, NULL::uuid, 'credit', l.to_minor, l.credit_ledger
  FROM purchase_legs l WHERE l.credit_ledger <> l.to_minor
UNION ALL
SELECT l.conversion_id, l.kind, NULL::uuid, 'escrow_shares', l.from_minor, pe.shares
  FROM purchase_legs l JOIN purchase_escrows pe ON pe.conversion_id = l.conversion_id
 WHERE pe.shares > l.from_minor
UNION ALL
SELECT NULL::uuid, 'unwind', uc.escrow_id, 'unwind_credit', uc.to_minor, uc.credit_ledger
  FROM unwind_credits uc WHERE uc.credit_ledger <> uc.to_minor;

-- What the platform owes in each escrow currency against what it took in each payer currency, for
-- escrow a conversion funded that is still held, reserved or disputed (Decision #435): the treasury's
-- open FX exposure, an ops read and never a money path. Service role only.
CREATE OR REPLACE VIEW finance.v_fx_exposure AS
SELECT e.fx_base AS paid_currency,
       e.currency AS owed_currency,
       pg_catalog.count(*) AS escrows,
       SUM(e.fx_source_minor)::bigint AS paid_minor,
       SUM(e.amount_cents)::bigint AS owed_minor,
       MIN(e.fx_as_of) AS oldest_rate_as_of
  FROM finance.escrows e
 WHERE e.fx_conversion_id IS NOT NULL AND e.status IN ('held', 'reserved', 'disputed')
 GROUP BY e.fx_base, e.currency;

-- Every wallet whose cached balance differs from the SUM of its signed ledger rows or from its newest
-- row's balance_after_cents, or whose pots drift from their movements or earmark more than it holds
-- (FINANCE_AUDIT L7). Empty while every movement went through finance.fn_wallet_credit / fn_wallet_debit
-- and every pot change through its door. One read for the two that need it: the nightly
-- finance.fn_reconcile_wallets (which logs each row) and the operator's finance.get_ledger_health (which
-- shows the drift still open). Service role only.
CREATE OR REPLACE VIEW finance.v_wallet_drift AS
SELECT r.wallet_id, r.owner_type, r.owner_id, r.currency, r.balance_cents, r.ledger_sum_cents,
       r.drift_cents, r.earmarked_cents, r.pot_drift_cents,
       latest.balance_after_cents AS latest_balance_after_cents
  FROM finance.v_wallet_reconciliation r
  LEFT JOIN LATERAL (
        SELECT t.balance_after_cents
          FROM finance.transactions t
         WHERE t.wallet_id = r.wallet_id
         ORDER BY t.created_at DESC, t.id DESC
         LIMIT 1
  ) latest ON true
 WHERE r.drift_cents <> 0
    OR r.balance_cents <> COALESCE(latest.balance_after_cents, 0)
    OR r.pot_drift_cents <> 0
    OR r.earmarked_cents > r.balance_cents;

-- The conservation identity, per currency (Decision #337, ruling M2 (A); FBP DB16). Every unit of money
-- the platform holds came in from outside and has not gone back out:
--
--     Σ external in − Σ external out  =  Σ held + Σ fees retained − Σ platform losses
--
-- `imbalance_minor` is the right side minus the left: 0 while every movement went through a door; above
-- 0 the platform accounts for money nobody paid in (a credit with no cash, FCA CO20; a payee paid past
-- its escrow, N4; a simulated row, #423 (A)); below 0 money left the books unexplained. The external
-- terms are read from the EVENT tables, never from the ledger rows they wrote, so a ledger credit with no
-- cash behind it cannot balance itself. In one statement, so a movement committing mid-read is seen
-- whole or not at all.
--   in      settled card payments (`amount_received_cents`, `settled_unapplied` included, #200) ·
--           on-account receivables (an `invoiced` order's credit, in the currency it was credited in:
--           its conversion's `from_minor`, or its own total) · the target side of every FX conversion
--           (#435: a purchase's `to_minor`, an unwind's payer-currency `to_minor`)
--   out     payouts sent or in flight, net of reversals (not `failed` / `cancelled`, which returned the
--           debit) · card refunds (`refunded_cents`) · lost chargebacks, whole (the bank takes the
--           disputed amount) · paid invoices' `amount_due_cents` (the on-account receivable settled) ·
--           the source side of every FX conversion (`principal_minor`)
--   held    wallet balances (pots are earmarks inside them, DB5) · every escrow not yet released or
--           refunded (`held`, `reserved` #430, `disputed`, the unused `funded` default) at its
--           `amount_cents` · pending releases not yet matured, net of chargeback recoveries
--   fees    released escrows' `platform_fee_cents` · orders' `platform_fee_minor` (the product lines'
--           commission) · FX spreads (`spread_minor`, in the source currency)
--   losses  lost chargebacks' `unrecovered_cents` · card refunds' `refund_unrecovered_cents` · the
--           platform-funded share of a promo code (order lines' `promo_discount_minor` where
--           `promo_funded_by = 'platform'`, Decision #485 (a)): the seller is credited the line before it
-- A new money flow adds its terms here in the same change (FBP §1). Read by finance.fn_check_conservation
-- and finance.get_ledger_health; service role only.
CREATE OR REPLACE VIEW finance.v_conservation_identity AS
WITH terms (currency, term, minor) AS (
    SELECT p.currency::text, 'in_cash', p.amount_received_cents
      FROM finance.inbound_payments p
     WHERE p.transaction_id IS NOT NULL
    UNION ALL
    SELECT COALESCE(c.from_currency::text, o.currency), 'in_on_account', COALESCE(c.from_minor, o.total_minor)
      FROM finance.orders o
      LEFT JOIN finance.fx_conversions c ON c.id = o.fx_conversion_id
     WHERE o.status = 'invoiced'
    UNION ALL
    SELECT c.to_currency::text, 'in_fx', c.to_minor FROM finance.fx_conversions c
    UNION ALL
    SELECT po.currency::text, 'out_payouts', po.amount_cents - po.reversed_cents
      FROM finance.payouts po
     WHERE po.status NOT IN ('failed', 'cancelled')
    UNION ALL
    SELECT p.currency::text, 'out_card_refunds', p.refunded_cents
      FROM finance.inbound_payments p
     WHERE p.refunded_cents > 0
    UNION ALL
    SELECT cb.currency::text, 'out_chargebacks', cb.amount_cents
      FROM finance.chargebacks cb
     WHERE cb.status = 'lost'
    UNION ALL
    SELECT i.currency, 'out_invoices', i.amount_due_cents
      FROM finance.invoices i
     WHERE i.status = 'paid' AND i.amount_due_cents > 0
    UNION ALL
    SELECT c.from_currency::text, 'out_fx', c.principal_minor FROM finance.fx_conversions c
    UNION ALL
    SELECT w.currency, 'held_wallets', w.balance_cents FROM finance.wallets w
    UNION ALL
    SELECT e.currency, 'held_escrows', e.amount_cents
      FROM finance.escrows e
     WHERE e.status NOT IN ('released', 'refunded')
    UNION ALL
    SELECT pr.currency::text, 'held_pending', pr.amount_cents - pr.recovered_cents
      FROM finance.pending_releases pr
     WHERE pr.state <> 'available'
    UNION ALL
    -- The tax checkout collected (Decision #490), held for the platform to remit; a line refunded or
    -- cancelled gave its tax back to the buyer with it.
    SELECT o.currency, 'tax_payable', o.tax_minor - COALESCE((
            SELECT pg_catalog.sum(l.tax_minor) FROM finance.order_lines l
             WHERE l.order_id = o.id AND l.status IN ('refunded', 'cancelled')), 0)
      FROM finance.orders o
     WHERE o.tax_minor > 0
    UNION ALL
    SELECT e.currency, 'fees_escrows', e.platform_fee_cents
      FROM finance.escrows e
     WHERE e.status = 'released' AND e.platform_fee_cents > 0
    UNION ALL
    -- A digital product line refunded in full gives its fee back (FBP DB21): it no longer counts.
    SELECT o.currency, 'fees_orders', o.platform_fee_minor - COALESCE((
            SELECT pg_catalog.sum(l.platform_fee_minor) FROM finance.order_lines l
             WHERE l.order_id = o.id AND l.item_type = 'digital_product'
               AND l.status IN ('refunded', 'cancelled')), 0)
      FROM finance.orders o
     WHERE o.platform_fee_minor > 0
    UNION ALL
    SELECT c.from_currency::text, 'fees_fx', c.spread_minor
      FROM finance.fx_conversions c
     WHERE c.spread_minor > 0
    UNION ALL
    SELECT cb.currency::text, 'losses_chargebacks', cb.unrecovered_cents
      FROM finance.chargebacks cb
     WHERE cb.status = 'lost' AND cb.unrecovered_cents > 0
    UNION ALL
    SELECT p.currency::text, 'losses_card_refunds', p.refund_unrecovered_cents
      FROM finance.inbound_payments p
     WHERE p.refund_unrecovered_cents > 0
    UNION ALL
    SELECT ol.currency, 'losses_promos', ol.promo_discount_minor
      FROM finance.order_lines ol
     WHERE ol.promo_funded_by = 'platform'
       AND NOT (ol.item_type = 'digital_product' AND ol.status IN ('refunded', 'cancelled'))
), per_currency AS (
    SELECT pg_catalog.upper(pg_catalog.btrim(t.currency)) AS currency,
           COALESCE(SUM(t.minor) FILTER (WHERE t.term = 'in_cash'), 0)::bigint AS in_cash_minor,
           COALESCE(SUM(t.minor) FILTER (WHERE t.term = 'in_on_account'), 0)::bigint AS in_on_account_minor,
           COALESCE(SUM(t.minor) FILTER (WHERE t.term = 'in_fx'), 0)::bigint AS in_fx_minor,
           COALESCE(SUM(t.minor) FILTER (WHERE t.term = 'out_payouts'), 0)::bigint AS out_payouts_minor,
           COALESCE(SUM(t.minor) FILTER (WHERE t.term = 'out_card_refunds'), 0)::bigint AS out_card_refunds_minor,
           COALESCE(SUM(t.minor) FILTER (WHERE t.term = 'out_chargebacks'), 0)::bigint AS out_chargebacks_minor,
           COALESCE(SUM(t.minor) FILTER (WHERE t.term = 'out_invoices'), 0)::bigint AS out_invoices_minor,
           COALESCE(SUM(t.minor) FILTER (WHERE t.term = 'out_fx'), 0)::bigint AS out_fx_minor,
           COALESCE(SUM(t.minor) FILTER (WHERE t.term = 'held_wallets'), 0)::bigint AS held_wallets_minor,
           COALESCE(SUM(t.minor) FILTER (WHERE t.term = 'held_escrows'), 0)::bigint AS held_escrows_minor,
           COALESCE(SUM(t.minor) FILTER (WHERE t.term = 'held_pending'), 0)::bigint AS held_pending_minor,
           COALESCE(SUM(t.minor) FILTER (WHERE t.term = 'tax_payable'), 0)::bigint AS tax_payable_minor,
           COALESCE(SUM(t.minor) FILTER (WHERE t.term = 'fees_escrows'), 0)::bigint AS fees_escrows_minor,
           COALESCE(SUM(t.minor) FILTER (WHERE t.term = 'fees_orders'), 0)::bigint AS fees_orders_minor,
           COALESCE(SUM(t.minor) FILTER (WHERE t.term = 'fees_fx'), 0)::bigint AS fees_fx_minor,
           COALESCE(SUM(t.minor) FILTER (WHERE t.term = 'losses_chargebacks'), 0)::bigint AS losses_chargebacks_minor,
           COALESCE(SUM(t.minor) FILTER (WHERE t.term = 'losses_card_refunds'), 0)::bigint AS losses_card_refunds_minor,
           COALESCE(SUM(t.minor) FILTER (WHERE t.term = 'losses_promos'), 0)::bigint AS losses_promos_minor
      FROM terms t
     GROUP BY 1
)
SELECT c.*,
       (c.in_cash_minor + c.in_on_account_minor + c.in_fx_minor)
         - (c.out_payouts_minor + c.out_card_refunds_minor + c.out_chargebacks_minor + c.out_invoices_minor
            + c.out_fx_minor) AS external_minor,
       (c.held_wallets_minor + c.held_escrows_minor + c.held_pending_minor + c.tax_payable_minor)
         + (c.fees_escrows_minor + c.fees_orders_minor + c.fees_fx_minor)
         - (c.losses_chargebacks_minor + c.losses_card_refunds_minor + c.losses_promos_minor) AS accounted_minor,
       ((c.held_wallets_minor + c.held_escrows_minor + c.held_pending_minor + c.tax_payable_minor)
         + (c.fees_escrows_minor + c.fees_orders_minor + c.fees_fx_minor)
         - (c.losses_chargebacks_minor + c.losses_card_refunds_minor + c.losses_promos_minor))
       - ((c.in_cash_minor + c.in_on_account_minor + c.in_fx_minor)
         - (c.out_payouts_minor + c.out_card_refunds_minor + c.out_chargebacks_minor + c.out_invoices_minor
            + c.out_fx_minor)) AS imbalance_minor
  FROM per_currency c;

-- Ops (Decision #200): every settled card payment without the ledger credit it is — no
-- transaction_id, or one that is not this payment's credit of what arrived into its wallet. Empty
-- while finance.settle_card_payment and the inbound_payments CHECKs hold; service role only.
-- Plus every payment Stripe settled in an amount / currency that does not match it
-- (`settlement_mismatch`), or for a business that was archived by the time it settled
-- (`business_archived`, Decision #248 (k)): money that arrived and that settle_card_payment
-- acknowledged for a human to reconcile rather than credit — `problem` is the claim's reconciliation
-- marker. Read from the completed event claim, so the row stays listed while the payment is unsettled —
-- `requires_payment`, `processing`, or `failed` (not final: a success after a declined attempt is held
-- with the row still reading `failed`) — until a human settles or closes it.
CREATE OR REPLACE VIEW finance.v_ops_unledgered_payments AS
SELECT
    p.id AS payment_id,
    p.status,
    p.purpose,
    p.wallet_id,
    p.created_by,
    p.provider_ref,
    p.amount_cents,
    p.amount_received_cents,
    p.currency,
    p.transaction_id,
    p.unapplied_reason,
    p.succeeded_at,
    CASE WHEN t.id IS NULL THEN 'no_ledger_row' ELSE 'ledger_row_mismatch' END AS problem,
    NULL::text AS stripe_event_id,
    NULL::bigint AS reported_amount_cents,
    NULL::text AS reported_currency
FROM finance.inbound_payments p
LEFT JOIN finance.transactions t ON t.id = p.transaction_id
WHERE p.status IN ('succeeded', 'settled_unapplied')
  AND (
        t.id IS NULL
     OR t.wallet_id <> p.wallet_id
     OR t.direction <> 'credit'
     OR t.amount_cents IS DISTINCT FROM p.amount_received_cents
     OR t.ref_table IS DISTINCT FROM 'inbound_payments'
     OR t.ref_id IS DISTINCT FROM p.id
  )
UNION ALL
SELECT
    p.id AS payment_id,
    p.status,
    p.purpose,
    p.wallet_id,
    p.created_by,
    p.provider_ref,
    p.amount_cents,
    p.amount_received_cents,
    p.currency,
    p.transaction_id,
    p.unapplied_reason,
    p.succeeded_at,
    k.response ->> 'reconciliation' AS problem,
    substr(k.key, 8) AS stripe_event_id,
    (k.response ->> 'amount_received_cents')::bigint AS reported_amount_cents,
    k.response ->> 'currency_received' AS reported_currency
FROM finance.idempotency_keys k
JOIN finance.inbound_payments p ON p.id::text = k.response ->> 'payment_id'
WHERE k.scope = 'stripe.webhook'
  AND k.status = 'succeeded'
  AND k.response ->> 'reconciliation' IN ('settlement_mismatch', 'business_archived')
  AND p.status IN ('requires_payment', 'processing', 'failed');

-- The ONLY connection shape a client sees: a definer view (runs as owner, reads the un-policied
-- base table) filtered to the caller. It cannot project a token — the token vault
-- (integrations.connection_secrets) is a separate table this view never joins.
CREATE OR REPLACE VIEW
    integrations.v_my_connections AS
SELECT
    c.id,
    c.user_id,
    c.provider_slug,
    p.label AS provider_label,
    p.category AS provider_category,
    p.capabilities AS provider_capabilities,
    c.status,
    c.granted_kinds,
    c.granted_scopes,
    c.sync_direction,
    c.external_account_id,
    c.external_account_label,
    -- Non-secret mount config (S3 endpoint/bucket/prefix, Drive root). Safe to project precisely
    -- because credentials live in connection_secrets, which this view cannot reach.
    c.config,
    c.token_expires_at,
    c.last_synced_at,
    c.last_error,
    c.error_count,
    c.connected_at,
    c.revoked_at,
    c.created_at,
    c.updated_at
FROM
    integrations.user_connections c
    JOIN integrations.providers p ON p.slug = c.provider_slug
WHERE
    c.user_id = auth.uid ();

-- The public plugin marketplace listing: each PUBLISHED plugin joined to its latest published
-- version (replaces a stored latest_version_id back-pointer, which would be a circular FK). A
-- DEFINER view (like v_my_connections) with an explicit published-only filter, so it is safe to
-- expose to anon without granting the base tables — a publisher sees their own drafts via the base
-- table (their RLS grant), not this public catalogue.
CREATE OR REPLACE VIEW
    integrations.v_plugin_catalog
    WITH (security_invoker = false) AS
SELECT
    p.id,
    p.slug,
    p.name,
    p.tagline,
    p.description,
    p.developer_name,
    p.category,
    p.runtime,
    p.icon_url,
    p.homepage_url,
    p.repo_url,
    p.status,
    p.is_verified,
    p.install_count,
    v.id AS latest_version_id,
    v.semver AS latest_semver,
    v.requested_scopes AS latest_requested_scopes,
    v.published_at AS latest_published_at
FROM
    integrations.plugins p
    LEFT JOIN LATERAL (
        SELECT pv.*
        FROM integrations.plugin_versions pv
        WHERE pv.plugin_id = p.id
          AND pv.status = 'published'::integrations.plugin_version_status
        ORDER BY pv.published_at DESC NULLS LAST
        LIMIT 1
    ) v ON true
WHERE
    p.status = 'published'::integrations.plugin_status;

CREATE OR REPLACE VIEW analytics.v_unregistered_events AS
SELECT e.name, e.domain, count(*) AS occurrences, max(e.occurred_at) AS last_seen
FROM analytics.events e
LEFT JOIN analytics.event_catalogue c ON c.name = e.name
WHERE c.name IS NULL
GROUP BY e.name, e.domain;


-- --- search.platform_stats: the landing hero's proof points ---
--
-- The public landing page states what the marketplace has DONE — how many people are ready to hire,
-- how much work has been signed off, how much money has reached sellers. Those facts live in tables a
-- visitor may not read (`finance.payouts` is not even usable by `anon`), so this definer view answers
-- them as AGGREGATES only: four numbers and a currency, one row, nothing a visitor could use to find
-- or identify a single person, project or payout.
--
-- It replaces three figures the landing page used to hardcode ("$4.2M", "3,800+", "19k"), which were
-- claims about a marketplace that did not exist. A small real number is the honest one.
--
-- `paid_out_minor` sums payouts that actually settled, in the platform's base currency. A payout in
-- another currency is left out rather than converted at an arbitrary rate; the figure is labelled
-- with its currency so it is never read as a total of everything.
--
-- Placed in `search` because that schema is exposed to PostgREST and granted to `anon` for exactly
-- this kind of public, read-only projection.
CREATE OR REPLACE VIEW search.platform_stats AS
SELECT
    (SELECT COUNT(*)::int FROM org.profiles_index
      WHERE listed AND entity_type IN ('freelancer', 'team')) AS helpers,
    (SELECT COUNT(*)::int FROM projects.stage_assignments
      WHERE status = 'completed') AS stages_delivered,
    (SELECT COUNT(*)::int FROM projects.projects
      WHERE status IN ('active'::project_status, 'completed'::project_status)) AS projects_live,
    (SELECT COALESCE(SUM(amount_cents), 0)::bigint FROM finance.payouts
      WHERE status = 'paid'::finance.payout_status AND currency = 'USD') AS paid_out_minor,
    'USD'::text AS paid_out_currency;
