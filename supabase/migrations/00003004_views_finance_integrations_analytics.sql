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
