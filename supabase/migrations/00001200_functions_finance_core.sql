-- ============================================================================
-- 00001200 functions finance core
-- Consolidated verbatim from: 0009_finance_tables.sql, 0305_stage_funding_payout.sql, 0309_business_finance_overview.sql, 0310_ticket_automation_engine.sql
-- ============================================================================

-- Ledger primitives: credit / debit an EXISTING wallet and append its ledger row (the balance CHECK
-- enforces sufficient funds). A missing wallet raises PW404 instead of returning: a credit with nowhere
-- to land must fail its caller, never vanish (Decision #186). A caller that may be the first to pay an
-- owner runs finance.fn_ensure_wallet before crediting. The `_fx` forms also stamp the row's FX snapshot
-- (`fx_base`, `fx_rate`, `fx_as_of`), which only a conversion writes (Decision #435); the plain forms
-- stamp none.
CREATE OR REPLACE FUNCTION finance.fn_wallet_credit_fx(
    p_owner_id uuid, p_owner_type text, p_currency text, p_amount bigint,
    p_reason text, p_ref_table text, p_ref_id uuid,
    p_fx_base text, p_fx_rate numeric, p_fx_as_of timestamptz
) RETURNS void AS $$
DECLARE
    v_wallet uuid;
    v_balance bigint;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN RETURN; END IF;
    SELECT id INTO v_wallet FROM finance.wallets
    WHERE owner_type = p_owner_type AND owner_id = p_owner_id AND currency = p_currency;
    IF v_wallet IS NULL THEN
        RAISE EXCEPTION 'wallet: % has no % wallet in % to credit', p_owner_id, p_owner_type, p_currency
            USING ERRCODE = 'PW404';
    END IF;

    UPDATE finance.wallets SET balance_cents = balance_cents + p_amount
    WHERE id = v_wallet RETURNING balance_cents INTO v_balance;

    IF p_fx_rate IS NULL THEN
        INSERT INTO finance.transactions (wallet_id, direction, amount_cents, currency, reason, ref_table, ref_id, balance_after_cents)
        VALUES (v_wallet, 'credit', p_amount, p_currency, p_reason, p_ref_table, p_ref_id, v_balance);
    ELSE
        INSERT INTO finance.transactions (wallet_id, direction, amount_cents, currency, reason, ref_table, ref_id, balance_after_cents,
                                          fx_base, fx_rate, fx_as_of)
        VALUES (v_wallet, 'credit', p_amount, p_currency, p_reason, p_ref_table, p_ref_id, v_balance,
                p_fx_base, p_fx_rate, p_fx_as_of);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance;

CREATE OR REPLACE FUNCTION finance.fn_wallet_credit(
    p_owner_id uuid, p_owner_type text, p_currency text, p_amount bigint,
    p_reason text, p_ref_table text, p_ref_id uuid
) RETURNS void AS $$
BEGIN
    PERFORM finance.fn_wallet_credit_fx(p_owner_id, p_owner_type, p_currency, p_amount, p_reason, p_ref_table, p_ref_id,
        NULL, NULL, NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance;

-- The one place a wallet's pots are enforced (finance.wallet_pots, Decision #337, ruling M6). Every
-- debit reason is in exactly one of two lists, and a reason in neither raises, so a new writer has to
-- choose. A VOLUNTARY spend (an escrow hold, a checkout or invoice payment, a transfer or distribution
-- out, a payout) may not reach earmarked money: it is refused PF402 `earmarked` when the balance
-- covers it but the balance minus the active pots does not. An INVOLUNTARY recovery (a lost
-- chargeback, a card refund) takes what the wallet holds and then shrinks its pots newest first, each
-- with a finance.pot_movements row, so the pots never earmark more than the wallet holds.
CREATE OR REPLACE FUNCTION finance.fn_wallet_debit_fx(
    p_owner_id uuid, p_owner_type text, p_currency text, p_amount bigint,
    p_reason text, p_ref_table text, p_ref_id uuid,
    p_fx_base text, p_fx_rate numeric, p_fx_as_of timestamptz
) RETURNS void AS $$
DECLARE
    v_voluntary CONSTANT text[] := ARRAY[
        'escrow_hold', 'order_payment', 'invoice_payment', 'transfer_out', 'team_distribution', 'payout',
        'fx_conversion', 'fx_spread'
    ];
    v_involuntary CONSTANT text[] := ARRAY['chargeback', 'refund'];
    v_wallet finance.wallets;
    v_balance bigint;
    v_earmarked bigint;
    v_tx uuid;
    v_excess bigint;
    v_take bigint;
    r finance.wallet_pots;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN RETURN; END IF;
    IF p_reason IS NULL OR NOT (p_reason = ANY (v_voluntary) OR p_reason = ANY (v_involuntary)) THEN
        RAISE EXCEPTION 'wallet: % is not a debit reason finance.fn_wallet_debit knows; add it to its voluntary or involuntary list',
            COALESCE(p_reason, 'nothing') USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_wallet FROM finance.wallets
    WHERE owner_type = p_owner_type AND owner_id = p_owner_id AND currency = p_currency
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'wallet: % has no % wallet in % to debit', p_owner_id, p_owner_type, p_currency
            USING ERRCODE = 'PW404';
    END IF;

    SELECT COALESCE(pg_catalog.sum(p.balance_cents), 0)::bigint INTO v_earmarked
      FROM finance.wallet_pots p WHERE p.wallet_id = v_wallet.id AND p.active;
    IF p_reason = ANY (v_voluntary) AND v_wallet.balance_cents >= p_amount
       AND v_wallet.balance_cents - v_earmarked < p_amount THEN
        RAISE EXCEPTION 'earmarked: % % of this wallet is set aside in pots, so % % is available. Move money out of a pot to spend it',
            finance.fn_minor_units_text(v_earmarked, v_wallet.currency), v_wallet.currency,
            finance.fn_minor_units_text(GREATEST(v_wallet.balance_cents - v_earmarked, 0), v_wallet.currency), v_wallet.currency
            USING ERRCODE = 'PF402',
                  DETAIL = pg_catalog.jsonb_build_object(
                      'wallet_id', v_wallet.id,
                      'amount_minor', p_amount,
                      'earmarked_minor', v_earmarked,
                      'available_minor', GREATEST(v_wallet.balance_cents - v_earmarked, 0)
                  )::text;
    END IF;

    UPDATE finance.wallets SET balance_cents = balance_cents - p_amount
    WHERE id = v_wallet.id RETURNING balance_cents INTO v_balance;

    IF p_fx_rate IS NULL THEN
        INSERT INTO finance.transactions (wallet_id, direction, amount_cents, currency, reason, ref_table, ref_id, balance_after_cents)
        VALUES (v_wallet.id, 'debit', p_amount, p_currency, p_reason, p_ref_table, p_ref_id, v_balance)
        RETURNING id INTO v_tx;
    ELSE
        INSERT INTO finance.transactions (wallet_id, direction, amount_cents, currency, reason, ref_table, ref_id, balance_after_cents,
                                          fx_base, fx_rate, fx_as_of)
        VALUES (v_wallet.id, 'debit', p_amount, p_currency, p_reason, p_ref_table, p_ref_id, v_balance,
                p_fx_base, p_fx_rate, p_fx_as_of)
        RETURNING id INTO v_tx;
    END IF;

    v_excess := v_earmarked - v_balance;
    IF v_excess > 0 THEN
        FOR r IN
            SELECT * FROM finance.wallet_pots p
             WHERE p.wallet_id = v_wallet.id AND p.active AND p.balance_cents > 0
             ORDER BY p.created_at DESC, p.id DESC
               FOR UPDATE
        LOOP
            EXIT WHEN v_excess <= 0;
            v_take := LEAST(v_excess, r.balance_cents);
            UPDATE finance.wallet_pots SET balance_cents = balance_cents - v_take WHERE id = r.id;
            INSERT INTO finance.pot_movements (
                pot_id, wallet_id, direction, amount_cents, currency, reason, ref_table, ref_id,
                balance_after_cents, actor_user_id
            ) VALUES (
                r.id, v_wallet.id, 'out', v_take, r.currency, 'recovery', 'transactions', v_tx,
                r.balance_cents - v_take, auth.uid ()
            );
            v_excess := v_excess - v_take;
        END LOOP;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance;

CREATE OR REPLACE FUNCTION finance.fn_wallet_debit(
    p_owner_id uuid, p_owner_type text, p_currency text, p_amount bigint,
    p_reason text, p_ref_table text, p_ref_id uuid
) RETURNS void AS $$
BEGIN
    PERFORM finance.fn_wallet_debit_fx(p_owner_id, p_owner_type, p_currency, p_amount, p_reason, p_ref_table, p_ref_id,
        NULL, NULL, NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance;

-- The reasons earned money is credited under: every finance.pending_releases row carries one, and only
-- these are earmarked into pots as they mature. fn_wallet_credit_pending (00001240) refuses any other,
-- so a new earning path has to be added here. With fn_wallet_debit's two lists above, it classifies
-- the ledger's reason vocabulary, the finance.transactions.reason CHECK (00000017), and names nothing
-- outside it (supabase/probes/currency_integrity.sql). Here, beside the primitives, because SQL
-- functions in this file and later ones read it when they are created (fn_seller_tax_report). Internal.
CREATE OR REPLACE FUNCTION finance.fn_is_income_reason(p_reason text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT COALESCE(p_reason IN (
        'escrow_release', 'team_split', 'team_finder_fee', 'fair_exit_release', 'product_sale',
        'escrow_release_vault_retention', 'fair_exit_release_vault_retention'
    ), false);
$$;

-- What a wallet may spend: its balance minus what its active pots earmark (finance.wallet_pots,
-- Decision #337, ruling M6). NULL for a wallet that does not exist. Here, beside the debit that enforces
-- it, because SQL functions in later files read it when they are created (the payout-schedule claim's
-- fn_payout_schedule_available, 00001240). Internal.
CREATE OR REPLACE FUNCTION finance.fn_available_cents(p_wallet uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT w.balance_cents - COALESCE((
               SELECT pg_catalog.sum(p.balance_cents) FROM finance.wallet_pots p
                WHERE p.wallet_id = w.id AND p.active
           ), 0)::bigint
      FROM finance.wallets w
     WHERE w.id = p_wallet;
$$;

-- A person's own wallet type. People hold `freelancer` wallets when they sell and `user` wallets when
-- they only buy; the money functions must credit the one the person actually has. An existing wallet
-- decides (a freelancer wallet wins over a user wallet); with none, a freelancer profile makes it
-- `freelancer`, anything else `user`.
CREATE OR REPLACE FUNCTION finance.fn_person_wallet_type(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        (SELECT w.owner_type FROM finance.wallets w
          WHERE w.owner_id = p_user AND w.owner_type IN ('freelancer', 'user')
          ORDER BY (w.owner_type = 'freelancer') DESC LIMIT 1),
        CASE WHEN EXISTS (SELECT 1 FROM org.freelancer_profiles f WHERE f.user_id = p_user) THEN 'freelancer' ELSE 'user' END
    );
$$;

-- Make sure an owner holds a wallet in a currency, creating it if not. Run it before the first credit to
-- an owner who may never have held one: fn_wallet_credit refuses a wallet that does not exist (PW404).
CREATE OR REPLACE FUNCTION finance.fn_ensure_wallet(p_owner_type text, p_owner_id uuid, p_currency text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
BEGIN
    INSERT INTO finance.wallets (owner_type, owner_id, currency)
    VALUES (p_owner_type, p_owner_id, upper(p_currency))
    ON CONFLICT (owner_type, owner_id, currency) DO NOTHING;
    SELECT w.id INTO v_id FROM finance.wallets w
     WHERE w.owner_type = p_owner_type AND w.owner_id = p_owner_id AND w.currency = upper(p_currency);
    RETURN v_id;
END;
$$;

-- A per-currency platform param in one currency's minor units (Decision #337, ruling M5 (e)): the
-- `security.platform_params` value is an object keyed by ISO code with an optional "default" for any
-- currency it does not list, shaped like min_withdrawal_minor (on_account_limit_cents,
-- vault_approval_threshold_cents). A bare number, the flat shape these params had before, reads as
-- {"default": n}: a database that still holds one keeps its approval threshold rather than silently
-- losing it. NULL when neither the currency nor a default is set: each caller decides what unset
-- means and never substitutes a flat figure of its own. Internal.
CREATE OR REPLACE FUNCTION finance.fn_param_minor(p_key text, p_currency text)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(pp.value ->> pg_catalog.upper(pg_catalog.btrim(COALESCE(p_currency, ''))),
                    pp.value ->> 'default',
                    CASE WHEN pg_catalog.jsonb_typeof(pp.value) = 'number' THEN pp.value #>> '{}' END)::bigint
      FROM security.platform_params pp
     WHERE pp.key = p_key;
$$;

-- #region FX conversion arithmetic and FX-funded escrow (Decision #435)
-- The minor-unit exponent of a currency (ISO 4217): 0, 3, or 2 for every other code. One list, mirrored
-- by packages/types/finance CURRENCY_EXPONENT. Here, beside the primitives, because the conversion
-- arithmetic below reads it when it is created.
CREATE OR REPLACE FUNCTION finance.fn_currency_exponent(p_currency text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN pg_catalog.upper(pg_catalog.btrim(COALESCE(p_currency, ''))) = ANY (ARRAY[
            'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND',
            'VUV', 'XAF', 'XOF', 'XPF']) THEN 0
        WHEN pg_catalog.upper(pg_catalog.btrim(COALESCE(p_currency, ''))) = ANY (ARRAY[
            'BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']) THEN 3
        ELSE 2
    END;
$$;

-- The price of `p_to_minor` of `p_to_currency` in `p_from_currency`, from the two platform-base rates
-- (amount_quote = amount_base × rate): the mid-market principal, truncated, and the margin of
-- `p_spread_bp` on it, truncated (Decision #187), so every rounding favours the payer. Exact integer
-- arithmetic on the rates' ten decimal places; `quoteConversionMinor` (packages/types/finance/fx.ts) is
-- its parity-pinned mirror.
CREATE OR REPLACE FUNCTION finance.fn_fx_quote_minor(
    p_to_minor bigint,
    p_from_currency text,
    p_to_currency text,
    p_from_rate numeric,
    p_to_rate numeric,
    p_spread_bp integer,
    OUT principal_minor bigint,
    OUT spread_minor bigint,
    OUT from_minor bigint
)
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT p.principal, s.spread, p.principal + s.spread
      FROM (SELECT pg_catalog.div(
                p_to_minor::numeric
                    * pg_catalog.round(p_from_rate * 10000000000)
                    * pg_catalog.power(10::numeric, finance.fn_currency_exponent(p_from_currency)),
                pg_catalog.round(p_to_rate * 10000000000)
                    * pg_catalog.power(10::numeric, finance.fn_currency_exponent(p_to_currency))
            )::bigint AS principal) p
     CROSS JOIN LATERAL (
            SELECT pg_catalog.div(p.principal::numeric * GREATEST(COALESCE(p_spread_bp, 0), 0), 10000)::bigint AS spread
     ) s;
$$;

-- A pinned refund (Decision #435 (D)): `p_refund_minor` of an escrow of `p_escrow_minor` that cost the
-- payer `p_source_minor` of their own currency returns its pro-rata share of that cost, rounded up in
-- the payer's favour and never above what was paid; a whole refund returns exactly what was paid.
CREATE OR REPLACE FUNCTION finance.fn_fx_refund_minor(p_refund_minor bigint, p_escrow_minor bigint, p_source_minor bigint)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN COALESCE(p_refund_minor, 0) <= 0 OR COALESCE(p_escrow_minor, 0) <= 0 OR COALESCE(p_source_minor, 0) <= 0 THEN 0
        WHEN p_refund_minor >= p_escrow_minor THEN p_source_minor
        ELSE LEAST(p_source_minor, pg_catalog.div(
                 p_refund_minor::numeric * p_source_minor + p_escrow_minor - 1, p_escrow_minor::numeric)::bigint)
    END;
$$;

-- Stamp the escrows a purchase conversion funded with its snapshot and each one's exact cost in the
-- payer's currency: the conversion's charge shared across them and whatever else it paid for, by largest
-- remainder, so the shares sum to exactly what was charged. An escrow already stamped, or in another
-- currency, is left alone. Returns how many were stamped. Internal.
CREATE OR REPLACE FUNCTION finance.fn_stamp_escrow_fx(p_conversion_id uuid, p_escrow_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c finance.fx_conversions;
    v_count integer;
BEGIN
    SELECT * INTO c FROM finance.fx_conversions x WHERE x.id = p_conversion_id AND x.kind = 'purchase';
    IF NOT FOUND OR p_escrow_ids IS NULL OR pg_catalog.cardinality(p_escrow_ids) = 0 THEN
        RETURN 0;
    END IF;
    WITH funded AS (
        SELECT e.id, e.amount_cents::numeric AS amount
          FROM finance.escrows e
         WHERE e.id = ANY (p_escrow_ids) AND e.currency = c.to_currency AND e.fx_conversion_id IS NULL
    ), parts AS (
        SELECT f.id, f.amount FROM funded f
        UNION ALL
        SELECT NULL::uuid, GREATEST(c.to_minor - COALESCE((SELECT pg_catalog.sum(f.amount) FROM funded f), 0), 0)
    ), shares AS (
        SELECT p.id,
               pg_catalog.div(c.from_minor::numeric * p.amount, c.to_minor::numeric) AS share,
               pg_catalog.mod(c.from_minor::numeric * p.amount, c.to_minor::numeric) AS remainder
          FROM parts p
    ), ranked AS (
        SELECT s.id, s.share,
               pg_catalog.row_number() OVER (ORDER BY s.remainder DESC, s.id NULLS LAST) AS place,
               c.from_minor - pg_catalog.sum(s.share) OVER () AS shortfall
          FROM shares s
    )
    UPDATE finance.escrows e
       SET fx_conversion_id = c.id,
           fx_source_minor = (r.share + CASE WHEN r.place <= r.shortfall THEN 1 ELSE 0 END)::bigint,
           fx_base = c.rate_base,
           fx_rate = c.mid_rate,
           fx_as_of = c.rate_as_of
      FROM ranked r
     WHERE e.id = r.id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- Return part or all of an escrow to its payer: every refund door calls this (Decision #435 (D)). An
-- escrow held from a balance in its own currency is credited back in it, as it always was. One that a
-- conversion funded goes back to the payer's own currency, into the wallet the conversion drew on, at
-- its pinned figure (finance.fn_fx_refund_minor of what it cost), recorded as an `unwind` conversion;
-- nothing passes through the payer's wallet in the escrow's currency. The credit carries `p_reason` and
-- names the escrow either way. The order line the escrow was bought on records the refund first, in
-- the escrow's currency (finance.fn_record_order_line_refund, FBP DB19). Returns what was credited, in
-- the currency it was credited in. Internal.
CREATE OR REPLACE FUNCTION finance.fn_refund_escrow_to_payer(p_escrow_id uuid, p_amount bigint, p_reason text)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r finance.escrows;
    c finance.fx_conversions;
    w finance.wallets;
    v_payer uuid;
    v_type text;
    v_back bigint;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN 0;
    END IF;
    SELECT * INTO r FROM finance.escrows e WHERE e.id = p_escrow_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'escrow: % does not exist', p_escrow_id USING ERRCODE = 'P0002';
    END IF;
    v_payer := COALESCE(r.payer_business_id, r.payer_user_id);
    PERFORM finance.fn_record_order_line_refund(r.id, p_amount);

    IF r.fx_conversion_id IS NULL THEN
        v_type := finance.fn_escrow_payer_wallet_type(r.payer_business_id, r.payer_user_id);
        PERFORM finance.fn_ensure_wallet(v_type, v_payer, r.currency);
        PERFORM finance.fn_wallet_credit(v_payer, v_type, r.currency, p_amount, p_reason, 'escrows', r.id);
        RETURN p_amount;
    END IF;

    SELECT * INTO c FROM finance.fx_conversions x WHERE x.id = r.fx_conversion_id;
    SELECT * INTO w FROM finance.wallets x WHERE x.id = c.from_wallet_id;
    IF w.owner_id IS DISTINCT FROM v_payer THEN
        RAISE EXCEPTION 'escrow: % was funded from a wallet that is not its payer''s', r.id USING ERRCODE = 'PL409';
    END IF;
    v_back := finance.fn_fx_refund_minor(p_amount, r.amount_cents, r.fx_source_minor);
    IF v_back <= 0 THEN
        RETURN 0;
    END IF;
    INSERT INTO finance.fx_conversions (
        kind, parent_id, owner_type, owner_id, from_wallet_id, to_wallet_id, from_currency, to_currency,
        from_minor, principal_minor, to_minor, rate_base, mid_rate, rate_as_of, ref_table, ref_id
    ) VALUES (
        'unwind', c.id, w.owner_type, w.owner_id, NULL, w.id, r.currency, w.currency,
        p_amount, p_amount, v_back, c.rate_base, c.mid_rate, c.rate_as_of, 'escrows', r.id
    );
    PERFORM finance.fn_wallet_credit_fx(w.owner_id, w.owner_type, w.currency, v_back, p_reason, 'escrows', r.id,
        c.rate_base, c.mid_rate, c.rate_as_of);
    RETURN v_back;
END;
$$;
-- #endregion

-- #region The daily FX feed (Decision #337, ruling M5 (f); Decision #471; FBP DB17)
-- Two things write finance.fx_rates: the seed floor (00005050, provider `seed`, dated 2026-08-01) and
-- finance.record_fx_rates. A feed is recorded whole or not at all: since Decision #435 these rates
-- price conversions inside purchases, so a partial or wrong feed would mis-price a charge, not only a
-- display. A refused or failed feed leaves one `finance.fx` error row in ops.log_entries, which the
-- `finance.%` alert rules send (00005065), and records nothing, so the last rates stand and age into
-- the stale mark (`fx_rate_max_age_hours`; FxService's STALE_AFTER_MS is the same 24 hours). A replay
-- records nothing new (uq_fx_rate_observation). FxService.refreshRates calls it from the
-- `finance-fx-daily` job (`POST /api/finance/cron/fx`).

-- The currencies a feed must quote: every quote the seed floor holds against the platform base, which
-- are the 12 display currencies (DISPLAY_CURRENCIES in @projective/types/finance;
-- fx-feed.contract.test.ts pins that the two agree). Internal.
CREATE OR REPLACE FUNCTION finance.fn_fx_feed_currencies()
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(pg_catalog.array_agg(DISTINCT r.quote::text ORDER BY r.quote::text), '{}'::text[])
      FROM finance.fx_rates r
     WHERE r.provider = 'seed'
       AND r.base = COALESCE((SELECT pp.value #>> '{}' FROM security.platform_params pp
                               WHERE pp.key = 'base_currency'), 'GBP');
$$;

-- Record one feed observation (service role). `p_rates` maps each currency of
-- finance.fn_fx_feed_currencies() to its rate against the platform base as a JSON STRING, a plain
-- decimal of at most ten integer and ten fractional digits (the column's numeric(20, 10), so what is
-- stored is exactly what the provider quoted), greater than zero, and exactly 1 for the base itself.
-- Refused, writing nothing but the ops row, with the reason as `refused`: `provider_invalid` (not a
-- slug, or `seed`), `feed_unavailable` (no rates), `as_of_missing`, `as_of_in_future`, `rates_invalid`
-- (not an object), `currencies_unknown` (no seed floor to measure against), `currency_missing`,
-- `currency_unexpected` and `rate_invalid`, each naming its currencies; and whatever snake_case code
-- `p_failure` names, a refusal the caller found first (a failed fetch, a wrong base), which wins over
-- every check here. Otherwise every rate is inserted at `p_as_of` ON CONFLICT DO NOTHING, and a
-- `metric` row is written. Returns `{recorded, quotes, provider, as_of, replay}`.
CREATE OR REPLACE FUNCTION finance.record_fx_rates(
    p_provider text,
    p_as_of timestamptz,
    p_rates jsonb,
    p_failure text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_base text := COALESCE((SELECT pp.value #>> '{}' FROM security.platform_params pp
                              WHERE pp.key = 'base_currency'), 'GBP');
    v_provider text := pg_catalog.btrim(COALESCE(p_provider, ''));
    v_slug boolean := pg_catalog.btrim(COALESCE(p_provider, '')) ~ '^[a-z0-9][a-z0-9_.-]{0,59}$';
    v_label text;
    v_expected text[] := finance.fn_fx_feed_currencies();
    v_given text[] := '{}'::text[];
    v_named text[] := '{}'::text[];
    v_reason text;
    v_recorded integer := 0;
BEGIN
    v_label := CASE WHEN v_slug THEN v_provider ELSE 'unknown' END;

    IF NOT v_slug OR v_provider = 'seed' THEN
        v_reason := 'provider_invalid';
    ELSIF p_rates IS NULL THEN
        v_reason := 'feed_unavailable';
    ELSIF p_as_of IS NULL THEN
        v_reason := 'as_of_missing';
    ELSIF p_as_of > pg_catalog.now() THEN
        v_reason := 'as_of_in_future';
    ELSIF pg_catalog.jsonb_typeof(p_rates) IS DISTINCT FROM 'object' THEN
        v_reason := 'rates_invalid';
    ELSIF pg_catalog.cardinality(v_expected) = 0 THEN
        v_reason := 'currencies_unknown';
    ELSE
        v_given := ARRAY(SELECT k FROM pg_catalog.jsonb_object_keys(p_rates) AS k ORDER BY k);
        v_named := ARRAY(SELECT e FROM pg_catalog.unnest(v_expected) AS e
                          WHERE NOT (e = ANY (v_given)) ORDER BY e);
        IF pg_catalog.cardinality(v_named) > 0 THEN
            v_reason := 'currency_missing';
        ELSE
            v_named := ARRAY(SELECT g FROM pg_catalog.unnest(v_given) AS g
                              WHERE NOT (g = ANY (v_expected)) ORDER BY g);
            IF pg_catalog.cardinality(v_named) > 0 THEN
                v_reason := 'currency_unexpected';
            ELSE
                -- The cast sits behind the pattern inside a CASE, so a value that is not a decimal is
                -- named here rather than raising (which would roll back the ops row).
                v_named := ARRAY(
                    SELECT e FROM pg_catalog.unnest(v_expected) AS e
                     WHERE NOT COALESCE(
                         pg_catalog.jsonb_typeof(p_rates -> e) = 'string'
                         AND CASE WHEN (p_rates ->> e) ~ '^[0-9]{1,10}(\.[0-9]{1,10})?$'
                                  THEN (p_rates ->> e)::numeric > 0
                                       AND (e <> v_base OR (p_rates ->> e)::numeric = 1)
                                  ELSE false END,
                         false)
                     ORDER BY e);
                IF pg_catalog.cardinality(v_named) > 0 THEN
                    v_reason := 'rate_invalid';
                END IF;
            END IF;
        END IF;
    END IF;
    -- A refusal the caller already found wins, even over a feed that would pass here; what was found
    -- above still names the currencies.
    IF p_failure IS NOT NULL THEN
        v_reason := CASE WHEN p_failure ~ '^[a-z][a-z0-9_]{0,47}$' THEN p_failure ELSE 'feed_unavailable' END;
    END IF;

    IF v_reason IS NOT NULL THEN
        INSERT INTO ops.log_entries (client_id, level, message, occurred_at, source, scope, data)
        VALUES (
            pg_catalog.format('fx:%s:%s', v_label, v_reason),
            'error',
            pg_catalog.format(
                'The FX feed from %s was refused (%s%s): nothing was recorded, so the last rates stand and age toward stale',
                v_label, v_reason,
                CASE WHEN pg_catalog.cardinality(v_named) > 0
                     THEN ': ' || pg_catalog.array_to_string(v_named, ', ') ELSE '' END),
            pg_catalog.now(), 'server', 'finance.fx',
            pg_catalog.jsonb_build_object(
                'provider', v_label, 'reason', v_reason, 'currencies', pg_catalog.to_jsonb(v_named),
                'as_of', p_as_of, 'quotes', pg_catalog.cardinality(v_expected))
        );
        RETURN pg_catalog.jsonb_build_object(
            'recorded', 0, 'refused', v_reason, 'currencies', pg_catalog.to_jsonb(v_named),
            'provider', v_label, 'as_of', p_as_of);
    END IF;

    INSERT INTO finance.fx_rates (base, quote, rate, as_of, provider)
    SELECT v_base, e, (p_rates ->> e)::numeric(20, 10), p_as_of, v_provider
      FROM pg_catalog.unnest(v_expected) AS e
    ON CONFLICT (base, quote, as_of) DO NOTHING;
    GET DIAGNOSTICS v_recorded = ROW_COUNT;

    INSERT INTO ops.log_entries (client_id, level, message, occurred_at, source, scope, data)
    VALUES (
        pg_catalog.format('fx:%s:recorded', v_label),
        'metric',
        pg_catalog.format('The FX feed from %s recorded %s of %s rates as of %s', v_label, v_recorded,
            pg_catalog.cardinality(v_expected), p_as_of),
        pg_catalog.now(), 'server', 'finance.fx',
        pg_catalog.jsonb_build_object(
            'provider', v_label, 'recorded', v_recorded, 'quotes', pg_catalog.cardinality(v_expected),
            'as_of', p_as_of)
    );
    RETURN pg_catalog.jsonb_build_object(
        'recorded', v_recorded, 'quotes', pg_catalog.cardinality(v_expected), 'provider', v_provider,
        'as_of', p_as_of, 'replay', v_recorded = 0);
END;
$$;

COMMENT ON FUNCTION finance.record_fx_rates(text, timestamptz, jsonb, text) IS
'Records one daily FX feed observation whole (every finance.fn_fx_feed_currencies() rate against the
platform base, at p_as_of) or refuses it whole, leaving a finance.fx error row and recording nothing
(Decision #337, ruling M5 (f); Decision #471; FBP DB17). A replay records nothing new. Service role only.';
-- #endregion

-- The team payout plan (finance-model §5) — ONE implementation read by the release
-- (fn_split_team_payout) and the console's preview (preview_team_split), so what a team is shown it
-- will receive is what it does receive. Integer arithmetic, floored at every cut:
--   benevolent_dictator → everything to the vault;
--   finders_fee         → the finder's fixed cut first, then as co_op on the remainder;
--   co_op               → the vault's `vault_bp` cut, then each ACTIVE member's `percent_bp` of the
--                         rest; whatever does not divide (and any stake left unallocated) is dust
--                         that goes to the vault.
-- No active rule is a co_op rule with no vault cut.
CREATE OR REPLACE FUNCTION finance.fn_team_split_plan(p_team_id uuid, p_payout bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rule record;
    v_rest bigint;
    v_finder bigint := 0;
    v_vault bigint := 0;
    v_pool bigint;
    v_paid bigint := 0;
    v_members jsonb := '[]'::jsonb;
    m record;
    v_share bigint;
BEGIN
    IF p_payout IS NULL OR p_payout <= 0 THEN
        RETURN jsonb_build_object('payout_minor', 0, 'rule_type', NULL, 'vault_bp', 0, 'finder_user_id', NULL,
            'finder_minor', 0, 'vault_minor', 0, 'members', '[]'::jsonb, 'dust_minor', 0, 'vault_total_minor', 0);
    END IF;
    SELECT r.rule_type::text AS rule_type, r.vault_bp, r.finder_user_id, COALESCE(r.finder_bp, 0) AS finder_bp
      INTO v_rule
      FROM finance.split_rules r WHERE r.team_id = p_team_id AND r.active;

    v_rest := p_payout;
    IF v_rule.rule_type = 'benevolent_dictator' THEN
        RETURN jsonb_build_object('payout_minor', p_payout, 'rule_type', v_rule.rule_type, 'vault_bp', 10000,
            'finder_user_id', NULL, 'finder_minor', 0, 'vault_minor', p_payout, 'members', '[]'::jsonb,
            'dust_minor', 0, 'vault_total_minor', p_payout);
    END IF;
    IF v_rule.rule_type = 'finders_fee' AND v_rule.finder_user_id IS NOT NULL THEN
        v_finder := (p_payout * v_rule.finder_bp) / 10000;
        v_rest := p_payout - v_finder;
    END IF;
    v_vault := (v_rest * COALESCE(v_rule.vault_bp, 0)) / 10000;
    v_pool := v_rest - v_vault;

    FOR m IN
        SELECT ca.member_user_id, ca.percent_bp
          FROM finance.contribution_agreements ca
          JOIN org.team_members tm ON tm.team_id = ca.team_id AND tm.user_id = ca.member_user_id AND tm.status = 'active'
         WHERE ca.team_id = p_team_id AND ca.percent_bp > 0
         ORDER BY ca.percent_bp DESC, ca.member_user_id
    LOOP
        v_share := (v_pool * m.percent_bp) / 10000;
        v_paid := v_paid + v_share;
        v_members := v_members || jsonb_build_object('member_user_id', m.member_user_id, 'percent_bp', m.percent_bp, 'amount_minor', v_share);
    END LOOP;

    RETURN jsonb_build_object(
        'payout_minor', p_payout,
        'rule_type', COALESCE(v_rule.rule_type, 'co_op'),
        'vault_bp', COALESCE(v_rule.vault_bp, 0),
        'finder_user_id', CASE WHEN v_finder > 0 THEN v_rule.finder_user_id END,
        'finder_minor', v_finder,
        'vault_minor', v_vault,
        'members', v_members,
        'dust_minor', v_pool - v_paid,
        'vault_total_minor', v_vault + (v_pool - v_paid)
    );
END;
$$;

-- Pay a team's released escrow out by its plan. Every share is a real credit to a real wallet (a
-- missing one is created), a `payout_splits` row is written only beside its credit, and the vault is
-- credited with its cut plus the dust — so the payout is conserved to the minor unit. Rewritten
-- 2026-09-28 (signed off by the product owner): the previous body credited `user` wallets that
-- freelancers do not hold, so every share vanished silently, and it ignored the vault cut entirely.
CREATE OR REPLACE FUNCTION finance.fn_split_team_payout(
    p_escrow_id uuid, p_team_id uuid, p_payout bigint, p_currency text, p_reason text DEFAULT 'escrow_release'
) RETURNS void AS $$
DECLARE
    v_plan jsonb;
    m jsonb;
    v_user uuid;
    v_amount bigint;
    v_type text;
    v_vault bigint;
BEGIN
    IF p_payout IS NULL OR p_payout <= 0 THEN
        RETURN;
    END IF;
    v_plan := finance.fn_team_split_plan(p_team_id, p_payout);

    FOR m IN SELECT * FROM jsonb_array_elements(v_plan->'members') LOOP
        v_user := (m->>'member_user_id')::uuid;
        v_amount := (m->>'amount_minor')::bigint;
        CONTINUE WHEN v_amount <= 0;
        v_type := finance.fn_person_wallet_type(v_user);
        PERFORM finance.fn_ensure_wallet(v_type, v_user, p_currency);
        INSERT INTO finance.payout_splits (escrow_id, member_user_id, amount_cents, currency)
        VALUES (p_escrow_id, v_user, v_amount, p_currency);
        PERFORM finance.fn_wallet_credit_pending(v_user, v_type, p_currency, v_amount, 'team_split', 'escrows', p_escrow_id);
    END LOOP;

    IF (v_plan->>'finder_minor')::bigint > 0 THEN
        v_user := (v_plan->>'finder_user_id')::uuid;
        v_type := finance.fn_person_wallet_type(v_user);
        PERFORM finance.fn_ensure_wallet(v_type, v_user, p_currency);
        INSERT INTO finance.payout_splits (escrow_id, member_user_id, amount_cents, currency)
        VALUES (p_escrow_id, v_user, (v_plan->>'finder_minor')::bigint, p_currency);
        PERFORM finance.fn_wallet_credit_pending(v_user, v_type, p_currency, (v_plan->>'finder_minor')::bigint, 'team_finder_fee', 'escrows', p_escrow_id);
    END IF;

    v_vault := (v_plan->>'vault_total_minor')::bigint;
    IF v_vault > 0 THEN
        PERFORM finance.fn_ensure_wallet('team', p_team_id, p_currency);
        PERFORM finance.fn_wallet_credit_pending(p_team_id, 'team', p_currency, v_vault, p_reason || '_vault_retention', 'escrows', p_escrow_id);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance;

-- Enforce a member's spending envelope on a wallet, and count the spend against it — atomically. The
-- row is locked, the period rolled when it has lapsed (weekly/monthly; `total` never resets), the
-- per-transaction ceiling and the remaining cap checked, and the spend added, in one statement's
-- worth of locking so two concurrent spends cannot both fit under one cap. A NULL cap is "no ceiling"
-- (the row may still carry a per-transaction ceiling); no row at all is no envelope. Rewritten
-- 2026-09-28 (signed off by the product owner): the previous body read then wrote without a lock,
-- ignored `per_transaction_cents` and `period_interval`, and so counted a lifetime total as the month.
CREATE OR REPLACE FUNCTION finance.fn_check_spending_limit(
    p_wallet_id uuid, p_member uuid, p_amount bigint
) RETURNS boolean AS $$
DECLARE
    v_row finance.spending_limits;
    v_spent bigint;
    v_resets timestamptz;
BEGIN
    IF p_member IS NULL OR p_wallet_id IS NULL THEN RETURN true; END IF;
    SELECT * INTO v_row FROM finance.spending_limits
     WHERE wallet_id = p_wallet_id AND member_user_id = p_member
     FOR UPDATE;
    IF NOT FOUND THEN RETURN true; END IF;

    v_spent := v_row.spent_cents;
    v_resets := v_row.resets_at;
    IF v_row.period_interval <> 'total' AND (v_resets IS NULL OR v_resets <= now()) THEN
        IF v_resets IS NOT NULL THEN
            v_spent := 0;
        END IF;
        v_resets := CASE v_row.period_interval
            WHEN 'weekly' THEN date_trunc('week', now()) + interval '1 week'
            ELSE date_trunc('month', now()) + interval '1 month'
        END;
    END IF;

    IF v_row.per_transaction_cents IS NOT NULL AND p_amount > v_row.per_transaction_cents THEN
        UPDATE finance.spending_limits SET spent_cents = v_spent, resets_at = v_resets WHERE id = v_row.id;
        RETURN false;
    END IF;
    IF v_row.cap_cents IS NOT NULL AND v_spent + p_amount > v_row.cap_cents THEN
        UPDATE finance.spending_limits SET spent_cents = v_spent, resets_at = v_resets WHERE id = v_row.id;
        RETURN false;
    END IF;

    UPDATE finance.spending_limits SET spent_cents = v_spent + p_amount, resets_at = v_resets WHERE id = v_row.id;
    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance;

-- A team's split must always describe the whole payout: the active stakes sum to exactly 100%, or
-- (a team nobody has agreed a split for yet) to nothing. Deferred to the end of the transaction so a
-- rebalance may move basis points between rows one statement at a time.
CREATE OR REPLACE FUNCTION finance.fn_assert_team_split_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_total bigint;
BEGIN
    SELECT COALESCE(sum(ca.percent_bp), 0) INTO v_total
      FROM finance.contribution_agreements ca WHERE ca.team_id = NEW.team_id;
    IF v_total NOT IN (0, 10000) THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
            MESSAGE = 'stakes: a team''s split must total 100% (it totals ' || trim_scale(round(v_total / 100.0, 2))::text || '%)';
    END IF;
    RETURN NULL;
END;
$$;

-- A new team or business wallet is governed from birth: project the entity's members onto it.
CREATE OR REPLACE FUNCTION finance.fn_sync_vault_on_wallet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.owner_type IN ('team', 'business') THEN
        PERFORM org.fn_sync_vault_permissions(NEW.owner_type, NEW.owner_id, NULL);
    END IF;
    RETURN NULL;
END;
$$;

-- The wallet an escrow's PAYER funds it from, and is refunded to: the paying business's wallet, or —
-- for an individual client (no business profile) — that person's own wallet. ONE implementation read
-- by the hold, every refund and the fair-exit split, so money can only ever return to the kind of
-- wallet it came from. Exactly one payer column is set (ck_escrows_one_payer).
CREATE OR REPLACE FUNCTION finance.fn_escrow_payer_wallet_type(p_payer_business_id uuid, p_payer_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_payer_business_id IS NOT NULL THEN 'business'
        ELSE finance.fn_person_wallet_type(p_payer_user_id)
    END;
$$;

-- Who a ticket's escrow pays — the one rule the hold and the claim-time bind (Decision #197) share. Nobody
-- until somebody holds the ticket (Decision #466): an escrow nobody claimed earned nothing, so it is held
-- prepaid, with its refund clock (#428), whatever seat the stage has. That is one rule for every kind of
-- project: a bought service and a brief whose stage hired a team bind at the claim, exactly as a solo
-- seat, a One-Off (#457 (c)) and an unhired brief do. Once someone holds it: an accepted team seat on
-- the ticket's stage, so the payout splits across the team at release (fn_split_team_payout keys off
-- payee_type = 'team'), else the ticket's assignee.
CREATE OR REPLACE FUNCTION finance.fn_ticket_payee(
    p_stage_id uuid,
    p_assignee_id uuid,
    OUT payee_type assignment_type,
    OUT payee_id uuid
)
AS $$
DECLARE
    v_team uuid;
BEGIN
    IF p_assignee_id IS NULL THEN
        RETURN;
    END IF;
    SELECT sa.team_id INTO v_team
      FROM projects.stage_assignments sa
     WHERE sa.project_stage_id = p_stage_id
       AND sa.assignee_type = 'team'
       AND sa.status = 'accepted'
       AND sa.team_id IS NOT NULL
     LIMIT 1;
    IF v_team IS NOT NULL THEN
        payee_type := 'team'::assignment_type;
        payee_id := v_team;
    ELSE
        payee_type := 'freelancer'::assignment_type;
        payee_id := p_assignee_id;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, projects;

-- How long an unclaimed PREPAID escrow on this project's tickets stays held before it is refunded
-- (Decision #428): a productised service (`source_blueprint_id` set) 120h, a client project 168h, both
-- tunable in security.platform_params. Never below one hour.
CREATE OR REPLACE FUNCTION finance.fn_prepaid_escrow_ttl_hours(p_project_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT GREATEST(1, COALESCE(
        (SELECT (pp.value #>> '{}')::integer
           FROM security.platform_params pp
          WHERE pp.key = CASE WHEN p.source_blueprint_id IS NOT NULL
                              THEN 'prepaid_service_ttl_hours' ELSE 'prepaid_project_ttl_hours' END),
        CASE WHEN p.source_blueprint_id IS NOT NULL THEN 120 ELSE 168 END))
      FROM projects.projects p
     WHERE p.id = p_project_id;
$$;

-- Lock trigger -> hold funds in escrow (no hold, no work — Decision #165, PRODUCT_MANAGEMENT §3.6).
-- A hold that cannot be made is REFUSED, never skipped: SQLSTATE PF402, a "Needs funding — …" message,
-- and DETAIL = {state: 'needs_funding', reason, amount_minor, currency} for the caller to read. Reasons:
-- `no_price` · `no_wallet` (no payer wallet in the project's currency) · `insufficient_funds` ·
-- `spending_limit` · `needs_approval` · `kyb_required` (the business spend gate refused it). A missing
-- stage is not a funding problem and raises check_violation; a missing payee is a PREPAID hold
-- (Decision #197), whose payee the claim binds (fn_bind_ticket_escrow). A business payer's hold goes
-- through finance.fn_assert_business_spend (ref `tickets`): when a door (fund_stage, fund_ticket, the
-- basket) already gated this spend for its funder in this transaction, the gate's cover passes it
-- without counting again; otherwise the hold is AUTOMATIC (a claim, the Chain Reaction, the auto-fund
-- drain) and the project owner is the spender, as before. A gate refusal here is a PF402 needs-funding
-- refusal like any other, with the gate's DETAIL merged in, so every caller that turns PF402 into Needs
-- funding (and the auto-fund queue that files the approval) still does. Already held -> NULL, the one early return (#165(A)),
-- also when a concurrent hold commits first (uq_escrows_ticket_base_held, #189: nothing is debited). The
-- payer is the project's client business or, when the project has none, its owner as an INDIVIDUAL
-- client (PRODUCT_SPEC §Escrow, Wallets & Finance #5). The wallet and balance are checked before the
-- escrow row is written, so a missing or short wallet is a PF402 refusal rather than fn_wallet_debit's
-- PW404 or a negative balance after an escrow row nobody paid for. On success the payee and the client
-- are told (`escrow.funded`). A stage the client prepaid (Decision #430) is held from its reservation
-- instead (fn_activate_ticket_reservation): nothing is debited twice and nothing can be refused.
CREATE OR REPLACE FUNCTION finance.fn_hold_ticket_escrow(p_ticket_id uuid)
RETURNS uuid AS $$
DECLARE
    v record;
    v_amount bigint;
    v_escrow_id uuid;
    v_payee_type assignment_type;
    v_payee_id uuid;
    v_payer_type text;
    v_payer_id uuid;
    v_payer_user uuid;
    v_currency text;
    v_wallet uuid;
    v_balance bigint;
    v_reason text;
    v_gate_msg text;
    v_gate_raw text;
    v_gate_detail jsonb := '{}'::jsonb;
    v_href text;
    v_constraint text;
    v_ttl_hours integer;
BEGIN
    SELECT
        t.current_stage_id AS stage_id,
        t.current_assignee_id AS payee_id,
        projects.fn_ticket_stage_price(t.required_stages, t.unit_price_cents, ps) AS amount,
        p.client_business_id AS payer,
        -- The client person spends (Decision #427): never a seller-owned service's seller.
        COALESCE(p.client_user_id, p.owner_user_id) AS spender,
        p.currency AS currency,
        p.id AS project_id,
        p.slug AS project_slug,
        t.slug AS ticket_slug,
        t.title AS ticket_title
    INTO v
    FROM projects.tickets t
    JOIN projects.projects p ON p.id = t.project_id
    LEFT JOIN projects.project_stages ps ON ps.id = t.current_stage_id
    WHERE t.id = p_ticket_id;

    v_amount := v.amount;

    SELECT tp.payee_type, tp.payee_id INTO v_payee_type, v_payee_id
      FROM finance.fn_ticket_payee(v.stage_id, v.payee_id) tp;

    IF EXISTS (SELECT 1 FROM finance.escrows
                WHERE ticket_id = p_ticket_id AND status = 'held' AND revision_id IS NULL) THEN
        RETURN NULL;
    END IF;

    v_escrow_id := finance.fn_activate_ticket_reservation(p_ticket_id);
    IF v_escrow_id IS NOT NULL THEN
        RETURN v_escrow_id;
    END IF;

    IF v.stage_id IS NULL THEN
        RAISE EXCEPTION 'An escrow is held for a ticket on a stage; this ticket has no stage.'
            USING ERRCODE = 'check_violation';
    END IF;

    v_payer_id := COALESCE(v.payer, v.spender);
    v_payer_user := CASE WHEN v.payer IS NULL THEN v.spender END;
    v_payer_type := finance.fn_escrow_payer_wallet_type(v.payer, v_payer_user);
    v_currency := upper(COALESCE(v.currency, 'USD'));

    IF v_amount IS NULL OR v_amount <= 0 THEN
        v_reason := 'no_price';
    ELSE
        SELECT w.id, w.balance_cents INTO v_wallet, v_balance
          FROM finance.wallets w
         WHERE w.owner_type = v_payer_type AND w.owner_id = v_payer_id AND w.currency = v_currency;
        IF v_wallet IS NULL THEN
            v_reason := 'no_wallet';
        ELSIF v_balance < v_amount THEN
            v_reason := 'insufficient_funds';
        ELSIF v_payer_type = 'business' THEN
            -- An automatic hold's spender is the project owner who commits the business's money: auth.uid()
            -- here is the freelancer whose claim triggered it, who never has an envelope on the payer's
            -- wallet. A door that gated this spend for its funder has covered it already.
            BEGIN
                PERFORM finance.fn_assert_business_spend(v_wallet, v.spender, v_amount, 'tickets', p_ticket_id);
            EXCEPTION WHEN SQLSTATE 'PA403' OR SQLSTATE 'PK403' THEN
                GET STACKED DIAGNOSTICS v_gate_msg = MESSAGE_TEXT, v_gate_raw = PG_EXCEPTION_DETAIL;
                v_gate_detail := COALESCE(NULLIF(v_gate_raw, '')::jsonb, '{}'::jsonb);
                v_reason := CASE split_part(v_gate_msg, ':', 1)
                    WHEN 'kyb_required' THEN 'kyb_required'
                    WHEN 'needs_approval' THEN 'needs_approval'
                    ELSE 'spending_limit'
                END;
            END;
        END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'PF402',
            MESSAGE = 'Needs funding — ' || CASE v_reason
                WHEN 'no_price' THEN 'this ticket has no price to hold in escrow yet.'
                WHEN 'no_wallet' THEN 'the client has no wallet in ' || v_currency || ' to hold this ticket''s escrow from.'
                WHEN 'insufficient_funds' THEN 'the client''s wallet doesn''t hold enough for this ticket''s escrow.'
                WHEN 'kyb_required' THEN 'the business must complete verification (KYB) before its wallet can hold escrow.'
                WHEN 'needs_approval' THEN 'this ticket''s escrow is at or above the business''s approval threshold and needs an approver.'
                ELSE 'this would exceed the project owner''s spending limit on the business wallet.'
            END,
            DETAIL = (v_gate_detail || jsonb_build_object(
                'state', 'needs_funding', 'reason', v_reason,
                'amount_minor', v_amount, 'currency', v_currency
            ))::text;
    END IF;

    -- A prepaid hold is on the ticket's current stage by construction, so its refund clock starts now
    -- (Decision #428); a bound hold has none. The Chain Reaction's hold into the next stage takes the
    -- same rule, so a later stage's clock starts only when the ticket arrives there.
    IF v_payee_id IS NULL THEN
        v_ttl_hours := finance.fn_prepaid_escrow_ttl_hours(v.project_id);
    END IF;

    BEGIN
        INSERT INTO finance.escrows (
            project_stage_id, ticket_id, payer_business_id, payer_user_id,
            payee_type, payee_id, amount_cents, currency, status, expires_at
        )
        VALUES (
            v.stage_id, p_ticket_id, v.payer, v_payer_user,
            v_payee_type, v_payee_id, v_amount, v_currency, 'held',
            CASE WHEN v_ttl_hours IS NOT NULL THEN now() + make_interval(hours => v_ttl_hours) END
        )
        RETURNING id INTO v_escrow_id;
    EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint IS DISTINCT FROM 'uq_escrows_ticket_base_held' THEN
            RAISE;
        END IF;
        RETURN NULL;
    END;

    PERFORM finance.fn_wallet_debit(v_payer_id, v_payer_type, v_currency, v_amount, 'escrow_hold', 'escrows', v_escrow_id);

    UPDATE projects.tickets SET payment_status = 'escrow_funded'::payment_status WHERE id = p_ticket_id;

    -- "Funded, you can start" to the payee; the client hears it too unless they made the hold themselves.
    v_href := '/projects/' || v.project_slug || '/board?tkv=' || v.ticket_slug;
    IF v.payee_id IS NOT NULL THEN
        PERFORM comms.fn_notify(
            v.payee_id, 'escrow.funded', 'Funded — you can start',
            format('Escrow is held for "%s". Work can begin.', v.ticket_title),
            'projects.tickets', p_ticket_id,
            jsonb_build_object('escrow_id', v_escrow_id, 'amount_minor', v_amount, 'currency', v_currency),
            auth.uid(), 'project', v.project_id, NULL, v_href
        );
    END IF;
    IF v.spender IS DISTINCT FROM auth.uid() THEN
        PERFORM comms.fn_notify(
            v.spender, 'escrow.funded', 'Escrow held',
            format('Escrow for "%s" is held from your wallet. %s', v.ticket_title,
                CASE WHEN v_payee_id IS NULL
                     THEN format('It is paid to whoever claims it, and comes back to your wallet if nobody does within %s.',
                                 CASE WHEN v_ttl_hours % 24 = 0 THEN (v_ttl_hours / 24) || ' days'
                                      ELSE v_ttl_hours || ' hours' END)
                     ELSE 'Work can begin.' END),
            'projects.tickets', p_ticket_id,
            jsonb_build_object('escrow_id', v_escrow_id, 'amount_minor', v_amount, 'currency', v_currency),
            auth.uid(), 'project', v.project_id, NULL, v_href
        );
    END IF;
    RETURN v_escrow_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance, projects, org, comms, auth;

-- Bind a PREPAID ticket escrow (Decision #197) to the payee a claim or an assignment just gave its
-- ticket (finance.fn_ticket_payee). projects.fn_ticket_escrow_sync calls it before it would hold: an
-- unbound held escrow needs no debit, only a payee, and the work gate then finds it held. Returns the
-- bound escrow, or NULL when there was nothing to bind (the hold runs instead). The new payee is told
-- they can start, as a hold tells them. Binding stops the prepaid refund clock (Decision #428): from
-- here an unstarted claim is the claim TTL's (`claim_ttl_minutes`).
CREATE OR REPLACE FUNCTION finance.fn_bind_ticket_escrow(p_ticket_id uuid)
RETURNS uuid AS $$
DECLARE
    v record;
    v_payee_type assignment_type;
    v_payee_id uuid;
    v_escrow_id uuid;
    v_amount bigint;
    v_currency text;
BEGIN
    SELECT t.current_stage_id AS stage_id, t.current_assignee_id AS assignee, t.title, t.slug AS ticket_slug,
           p.id AS project_id, p.slug AS project_slug
      INTO v
      FROM projects.tickets t
      JOIN projects.projects p ON p.id = t.project_id
     WHERE t.id = p_ticket_id;

    SELECT tp.payee_type, tp.payee_id INTO v_payee_type, v_payee_id
      FROM finance.fn_ticket_payee(v.stage_id, v.assignee) tp;
    IF v_payee_id IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE finance.escrows e
       SET payee_type = v_payee_type, payee_id = v_payee_id, expires_at = NULL
     WHERE e.ticket_id = p_ticket_id AND e.status = 'held' AND e.revision_id IS NULL AND e.payee_id IS NULL
    RETURNING e.id, e.amount_cents, e.currency INTO v_escrow_id, v_amount, v_currency;
    IF v_escrow_id IS NULL THEN
        RETURN NULL;
    END IF;

    IF v.assignee IS NOT NULL THEN
        PERFORM comms.fn_notify(
            v.assignee, 'escrow.funded', 'Funded — you can start',
            format('Escrow is held for "%s". Work can begin.', v.title),
            'projects.tickets', p_ticket_id,
            jsonb_build_object('escrow_id', v_escrow_id, 'amount_minor', v_amount, 'currency', v_currency),
            auth.uid(), 'project', v.project_id, NULL,
            '/projects/' || v.project_slug || '/board?tkv=' || v.ticket_slug
        );
    END IF;
    RETURN v_escrow_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance, projects, org, comms, auth;

-- #region Decision #430 — prepaid later stages: a `reserved` escrow per stage, held on arrival
-- A ticket arriving in a stage it was prepaid for: that stage's reservation becomes its held escrow with
-- no second debit (the payer paid when it was reserved), under the hold's own payee rule
-- (fn_ticket_payee): bound when someone holds the ticket (to the stage's team seat, if it has one),
-- else prepaid with the refund clock starting now (Decision #428). Returns the escrow, or NULL when
-- the ticket has no stage, already holds its base escrow (#189), or holds no reservation for that
-- stage. Called by fn_hold_ticket_escrow before it would debit and by projects.fn_ticket_prepay_sync
-- when the ticket's stage changes, so every way into a stage (the Chain Reaction, a move, a funding
-- placement, a claim) holds what was prepaid there. Internal.
CREATE OR REPLACE FUNCTION finance.fn_activate_ticket_reservation(p_ticket_id uuid)
RETURNS uuid AS $$
DECLARE
    v record;
    v_payee_type assignment_type;
    v_payee_id uuid;
    v_ttl_hours integer;
    v_escrow_id uuid;
    v_amount bigint;
    v_currency text;
    v_constraint text;
BEGIN
    SELECT t.current_stage_id AS stage_id, t.current_assignee_id AS assignee, t.title, t.slug AS ticket_slug,
           p.id AS project_id, p.slug AS project_slug,
           COALESCE(p.client_user_id, p.owner_user_id) AS client_person
      INTO v
      FROM projects.tickets t
      JOIN projects.projects p ON p.id = t.project_id
     WHERE t.id = p_ticket_id;
    IF v.stage_id IS NULL THEN
        RETURN NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM finance.escrows e
                WHERE e.ticket_id = p_ticket_id AND e.status = 'held' AND e.revision_id IS NULL) THEN
        RETURN NULL;
    END IF;

    SELECT tp.payee_type, tp.payee_id INTO v_payee_type, v_payee_id
      FROM finance.fn_ticket_payee(v.stage_id, v.assignee) tp;
    IF v_payee_id IS NULL THEN
        v_ttl_hours := finance.fn_prepaid_escrow_ttl_hours(v.project_id);
    END IF;

    BEGIN
        UPDATE finance.escrows e
           SET status = 'held', payee_type = v_payee_type, payee_id = v_payee_id,
               expires_at = CASE WHEN v_ttl_hours IS NOT NULL
                                 THEN now() + make_interval(hours => v_ttl_hours) END
         WHERE e.ticket_id = p_ticket_id AND e.project_stage_id = v.stage_id AND e.status = 'reserved'
        RETURNING e.id, e.amount_cents, e.currency INTO v_escrow_id, v_amount, v_currency;
    EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint IS DISTINCT FROM 'uq_escrows_ticket_base_held' THEN
            RAISE;
        END IF;
        RETURN NULL;
    END;
    IF v_escrow_id IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE projects.tickets SET payment_status = 'escrow_funded'::payment_status WHERE id = p_ticket_id;
    INSERT INTO projects.ticket_history (ticket_id, actor_id, action_type, new_stage_id, changes)
    VALUES (p_ticket_id, COALESCE(auth.uid(), v.client_person), 'prepaid_stage_held', v.stage_id,
            jsonb_build_object('escrow_id', v_escrow_id, 'amount_minor', v_amount, 'currency', v_currency,
                               'prepaid', v_payee_id IS NULL));

    IF v.assignee IS NOT NULL THEN
        PERFORM comms.fn_notify(
            v.assignee, 'escrow.funded', 'Funded — you can start',
            format('Escrow is held for "%s". Work can begin.', v.title),
            'projects.tickets', p_ticket_id,
            jsonb_build_object('escrow_id', v_escrow_id, 'amount_minor', v_amount, 'currency', v_currency),
            auth.uid(), 'project', v.project_id, NULL,
            '/projects/' || v.project_slug || '/board?tkv=' || v.ticket_slug
        );
    END IF;
    RETURN v_escrow_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance, projects, org, comms, auth;

-- Prepay ONE later stage of a ticket: the payer's wallet is debited now (`escrow_hold`) into a
-- `reserved` escrow on that stage — unbound, with no refund clock — which fn_activate_ticket_reservation
-- holds when the ticket reaches the stage and fn_refund_ticket_reservations returns if it never does. The
-- stage must be one the ticket can be funded in now (projects.fn_ticket_stage_fundable) and not the stage
-- it is funded in, which is held, never reserved. The payer, the wallet and the PF402 refusals are
-- fn_hold_ticket_escrow's, so a door reads one vocabulary; the business spend gate is NOT asked here,
-- because the one door that reserves (projects.fund_ticket) has gated the payer's whole selection once.
-- Already reserved -> NULL (uq_escrows_ticket_stage_reserved). Internal.
CREATE OR REPLACE FUNCTION finance.fn_reserve_ticket_stage_escrow(p_ticket_id uuid, p_stage_id uuid)
RETURNS uuid AS $$
DECLARE
    v record;
    v_refusal text;
    v_amount bigint;
    v_payer_type text;
    v_payer_id uuid;
    v_payer_user uuid;
    v_currency text;
    v_wallet uuid;
    v_balance bigint;
    v_reason text;
    v_escrow_id uuid;
    v_constraint text;
BEGIN
    SELECT t.required_stages, t.unit_price_cents,
           p.client_business_id AS payer, COALESCE(p.client_user_id, p.owner_user_id) AS spender,
           p.currency AS currency
      INTO v
      FROM projects.tickets t
      JOIN projects.projects p ON p.id = t.project_id
     WHERE t.id = p_ticket_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ticket not found.' USING ERRCODE = 'no_data_found';
    END IF;
    IF p_stage_id IS NOT DISTINCT FROM projects.fn_ticket_funding_stage(p_ticket_id) THEN
        RAISE EXCEPTION 'The stage a ticket is funded in is held, never reserved.' USING ERRCODE = 'check_violation';
    END IF;

    v_refusal := projects.fn_ticket_stage_fundable(p_ticket_id, p_stage_id);
    IF v_refusal = 'prepaid' THEN
        RETURN NULL;
    ELSIF v_refusal = 'unpriced' THEN
        v_reason := 'no_price';
    ELSIF v_refusal IS NOT NULL THEN
        RAISE EXCEPTION 'This stage can''t be prepaid on this ticket (%).', v_refusal USING ERRCODE = 'check_violation';
    END IF;

    SELECT projects.fn_ticket_stage_price(v.required_stages, v.unit_price_cents, ps) INTO v_amount
      FROM projects.project_stages ps WHERE ps.id = p_stage_id;

    v_payer_id := COALESCE(v.payer, v.spender);
    v_payer_user := CASE WHEN v.payer IS NULL THEN v.spender END;
    v_payer_type := finance.fn_escrow_payer_wallet_type(v.payer, v_payer_user);
    v_currency := upper(COALESCE(v.currency, 'USD'));

    IF v_reason IS NULL THEN
        SELECT w.id, w.balance_cents INTO v_wallet, v_balance
          FROM finance.wallets w
         WHERE w.owner_type = v_payer_type AND w.owner_id = v_payer_id AND w.currency = v_currency;
        IF v_wallet IS NULL THEN
            v_reason := 'no_wallet';
        ELSIF v_balance < v_amount THEN
            v_reason := 'insufficient_funds';
        END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'PF402',
            MESSAGE = 'Needs funding — ' || CASE v_reason
                WHEN 'no_price' THEN 'this stage has no price for this ticket yet.'
                WHEN 'no_wallet' THEN 'the client has no wallet in ' || v_currency || ' to prepay this stage from.'
                ELSE 'the client''s wallet doesn''t hold enough to prepay this stage.'
            END,
            DETAIL = jsonb_build_object(
                'state', 'needs_funding', 'reason', v_reason,
                'amount_minor', v_amount, 'currency', v_currency, 'stage_id', p_stage_id
            )::text;
    END IF;

    BEGIN
        INSERT INTO finance.escrows (
            project_stage_id, ticket_id, payer_business_id, payer_user_id,
            amount_cents, currency, status
        )
        VALUES (p_stage_id, p_ticket_id, v.payer, v_payer_user, v_amount, v_currency, 'reserved')
        RETURNING id INTO v_escrow_id;
    EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint IS DISTINCT FROM 'uq_escrows_ticket_stage_reserved' THEN
            RAISE;
        END IF;
        RETURN NULL;
    END;

    PERFORM finance.fn_wallet_debit(v_payer_id, v_payer_type, v_currency, v_amount, 'escrow_hold', 'escrows', v_escrow_id);

    INSERT INTO projects.ticket_history (ticket_id, actor_id, action_type, new_stage_id, changes)
    VALUES (p_ticket_id, COALESCE(auth.uid(), v.spender), 'stage_prepaid', p_stage_id,
            jsonb_build_object('escrow_id', v_escrow_id, 'amount_minor', v_amount, 'currency', v_currency));
    RETURN v_escrow_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance, projects, org, auth;

-- Return a ticket's reservations to their payer, whole and fee-free (Decision #430): every one, or one
-- stage's. The stages a ticket never reached come back when it completes or is cancelled
-- (projects.fn_ticket_prepay_sync), is deleted (projects.fn_ticket_delete_protocol), drops the stage
-- (fn_ticket_prepay_sync), or has its prepaid hold swept unclaimed (fn_sweep_expired_prepaid_escrows).
-- Locked and guarded as fn_refund_ticket_escrow (Decision #188): the ticket row, then each reservation,
-- and the flip is conditional on it still being `reserved`, so a racing activation or second refund
-- returns nothing twice. Each refund is logged `prepaid_stage_refunded`. Returns how many came back.
CREATE OR REPLACE FUNCTION finance.fn_refund_ticket_reservations(
    p_ticket_id uuid,
    p_stage_id uuid DEFAULT NULL,
    p_reason text DEFAULT 'ticket_ended'
)
RETURNS integer AS $$
DECLARE
    r record;
    v_flipped uuid;
    v_actor uuid;
    v_count integer := 0;
BEGIN
    SELECT COALESCE(auth.uid(), p.client_user_id, p.owner_user_id) INTO v_actor
      FROM projects.tickets t
      JOIN projects.projects p ON p.id = t.project_id
     WHERE t.id = p_ticket_id
       FOR UPDATE OF t;

    FOR r IN
        SELECT * FROM finance.escrows
         WHERE ticket_id = p_ticket_id AND status = 'reserved'
           AND (p_stage_id IS NULL OR project_stage_id = p_stage_id)
         ORDER BY id
           FOR UPDATE
    LOOP
        UPDATE finance.escrows SET status = 'refunded'
         WHERE id = r.id AND status = 'reserved'
        RETURNING id INTO v_flipped;
        CONTINUE WHEN v_flipped IS NULL;
        PERFORM finance.fn_refund_escrow_to_payer(r.id, r.amount_cents, 'escrow_refund');
        IF v_actor IS NOT NULL THEN
            INSERT INTO projects.ticket_history (ticket_id, actor_id, action_type, new_stage_id, changes)
            VALUES (p_ticket_id, v_actor, 'prepaid_stage_refunded', r.project_stage_id,
                    jsonb_build_object('escrow_id', r.id, 'amount_minor', r.amount_cents,
                                       'currency', r.currency, 'reason', p_reason));
        END IF;
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance, projects, org, auth;
-- #endregion

-- A paid revision round (Decision #167) -> one MORE escrow on its ticket, beside the one already held
-- for the work, at the round's snapshotted price, naming the round (`revision_id`) so it is never taken
-- for the base escrow (#189). Same payee rule and the same PF402 refusal shape as
-- fn_hold_ticket_escrow (#165), so the TS side reads one vocabulary; fn_release_ticket_escrow already
-- releases every held row of a ticket on approval, and refunds treat it like any ticket escrow.
-- Internal; projects.fund_paid_revision is the door: it locks the round, holds only one still
-- `awaiting_payment` (so a replay cannot hold twice), and has checked the caller may spend the payer's money.
CREATE OR REPLACE FUNCTION finance.fn_hold_revision_escrow(p_revision_id uuid)
RETURNS uuid AS $$
DECLARE
    v record;
    v_escrow_id uuid;
    v_team_id uuid;
    v_payee_type assignment_type;
    v_payee_id uuid;
    v_payer_type text;
    v_payer_id uuid;
    v_payer_user uuid;
    v_currency text;
    v_wallet uuid;
    v_balance bigint;
    v_reason text;
    v_gate_msg text;
    v_gate_raw text;
    v_gate_detail jsonb := '{}'::jsonb;
BEGIN
    SELECT rv.id, rv.ticket_id, rv.project_stage_id AS stage_id, rv.price_cents AS amount,
           t.current_assignee_id AS assignee,
           p.client_business_id AS payer, COALESCE(p.client_user_id, p.owner_user_id) AS spender, p.currency
      INTO v
      FROM projects.stage_revision_requests rv
      JOIN projects.tickets t ON t.id = rv.ticket_id
      JOIN projects.projects p ON p.id = t.project_id
     WHERE rv.id = p_revision_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Revision round % not found.', p_revision_id USING ERRCODE = 'no_data_found';
    END IF;

    SELECT sa.team_id INTO v_team_id
      FROM projects.stage_assignments sa
     WHERE sa.project_stage_id = v.stage_id AND sa.assignee_type = 'team'
       AND sa.status = 'accepted' AND sa.team_id IS NOT NULL
     LIMIT 1;
    IF v_team_id IS NOT NULL THEN
        v_payee_type := 'team'::assignment_type;
        v_payee_id := v_team_id;
    ELSE
        v_payee_type := 'freelancer'::assignment_type;
        v_payee_id := v.assignee;
    END IF;
    IF v_payee_id IS NULL THEN
        RAISE EXCEPTION 'A paid revision is held for the ticket''s payee; this ticket has none.'
            USING ERRCODE = 'check_violation';
    END IF;

    v_payer_id := COALESCE(v.payer, v.spender);
    v_payer_user := CASE WHEN v.payer IS NULL THEN v.spender END;
    v_payer_type := finance.fn_escrow_payer_wallet_type(v.payer, v_payer_user);
    v_currency := upper(COALESCE(v.currency, 'USD'));

    IF v.amount IS NULL OR v.amount <= 0 THEN
        v_reason := 'no_price';
    ELSE
        SELECT w.id, w.balance_cents INTO v_wallet, v_balance
          FROM finance.wallets w
         WHERE w.owner_type = v_payer_type AND w.owner_id = v_payer_id AND w.currency = v_currency;
        IF v_wallet IS NULL THEN
            v_reason := 'no_wallet';
        ELSIF v_balance < v.amount THEN
            v_reason := 'insufficient_funds';
        ELSIF v_payer_type = 'business' THEN
            -- fund_paid_revision gated this spend for its funder (the gate's cover passes it); a hold
            -- reached any other way spends as the project owner. Refusals read as fn_hold_ticket_escrow's.
            BEGIN
                PERFORM finance.fn_assert_business_spend(v_wallet, v.spender, v.amount, 'revisions', p_revision_id);
            EXCEPTION WHEN SQLSTATE 'PA403' OR SQLSTATE 'PK403' THEN
                GET STACKED DIAGNOSTICS v_gate_msg = MESSAGE_TEXT, v_gate_raw = PG_EXCEPTION_DETAIL;
                v_gate_detail := COALESCE(NULLIF(v_gate_raw, '')::jsonb, '{}'::jsonb);
                v_reason := CASE split_part(v_gate_msg, ':', 1)
                    WHEN 'kyb_required' THEN 'kyb_required'
                    WHEN 'needs_approval' THEN 'needs_approval'
                    ELSE 'spending_limit'
                END;
            END;
        END IF;
    END IF;
    IF v_reason IS NOT NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'PF402',
            MESSAGE = 'Needs funding — ' || CASE v_reason
                WHEN 'no_price' THEN 'this revision has no price to hold in escrow.'
                WHEN 'no_wallet' THEN 'the client has no wallet in ' || v_currency || ' to hold this revision''s escrow from.'
                WHEN 'insufficient_funds' THEN 'the client''s wallet doesn''t hold enough for this revision''s escrow.'
                WHEN 'kyb_required' THEN 'the business must complete verification (KYB) before its wallet can hold escrow.'
                WHEN 'needs_approval' THEN 'this revision''s escrow is at or above the business''s approval threshold and needs an approver.'
                ELSE 'this would exceed the project owner''s spending limit on the business wallet.'
            END,
            DETAIL = (v_gate_detail || jsonb_build_object(
                'state', 'needs_funding', 'reason', v_reason,
                'amount_minor', v.amount, 'currency', v_currency
            ))::text;
    END IF;

    INSERT INTO finance.escrows (
        project_stage_id, ticket_id, revision_id, payer_business_id, payer_user_id,
        payee_type, payee_id, amount_cents, currency, status
    ) VALUES (
        v.stage_id, v.ticket_id, p_revision_id, v.payer, v_payer_user,
        v_payee_type, v_payee_id, v.amount, v_currency, 'held'
    )
    RETURNING id INTO v_escrow_id;

    PERFORM finance.fn_wallet_debit(v_payer_id, v_payer_type, v_currency, v.amount, 'escrow_hold', 'escrows', v_escrow_id);
    RETURN v_escrow_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance, projects, org, auth;

-- The platform fee rate that governs ONE escrow: its payer's active negotiated rate, else
-- `security.platform_params.platform_fee_bp` (5%, Decision #2) — via finance.fn_effective_platform_fee_bp,
-- so a release and a fair-exit split charge the same rate, and an unset fee raises (PX500) rather than
-- releasing fee-free. plpgsql, not sql: the resolver it calls is declared in a later file (00001220),
-- and a sql body is validated at CREATE.
CREATE OR REPLACE FUNCTION finance.fn_escrow_fee_bp(p_payer_business_id uuid, p_payer_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN CASE WHEN p_payer_business_id IS NOT NULL
                THEN finance.fn_effective_platform_fee_bp('business', p_payer_business_id)
                ELSE finance.fn_effective_platform_fee_bp('user', p_payer_user_id)
           END;
END;
$$;

-- Refuse to pay out an escrow while a dispute stands against it (PD409 `dispute_open`): the one check
-- every release path makes through finance.fn_escrow_has_open_dispute (00001260, Decision #212), so a
-- release, a fair-exit split or a forfeit waits for the ruling (FINANCE_AUDIT L9). The dispute's own
-- ruling pays through the seat primitives, which do not ask. Internal.
CREATE OR REPLACE FUNCTION finance.fn_assert_no_open_dispute(p_escrow_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF finance.fn_escrow_has_open_dispute(p_escrow_id) THEN
        RAISE EXCEPTION USING
            ERRCODE = 'PD409',
            MESSAGE = 'dispute_open: this payment is held while a dispute about it is open; it is paid or refunded by the ruling',
            DETAIL = pg_catalog.jsonb_build_object('escrow_id', p_escrow_id)::text;
    END IF;
END;
$$;

-- Release all held escrow for a ticket to its recorded payee (fee + bonus applied, splits for teams).
-- An individual payee is credited to the person wallet they actually hold (fn_person_wallet_type),
-- created if missing, because fn_wallet_credit raises PW404 for a wallet that does not exist.
-- An escrow with an open dispute is not released (PD409 `dispute_open`, fn_assert_no_open_dispute).
-- Idempotent under concurrency (Decision #188): the ticket row, then each held escrow, is locked, and
-- the flip to 'released' is conditional on the row still being 'held'. A second caller racing on the
-- same ticket waits on the lock, then finds nothing held and credits nothing.
CREATE OR REPLACE FUNCTION finance.fn_release_ticket_escrow(p_ticket_id uuid)
RETURNS void AS $$
DECLARE
    r record;
    v_fee_bp integer;
    v_fee bigint;
    v_payout bigint;
    v_ticket_status ticket_status;
    v_payee_wallet text;
    v_flipped uuid;
BEGIN
    -- A prepaid escrow nobody claimed has nobody to pay (Decision #197): it goes back to its payer.
    PERFORM 1 FROM projects.tickets WHERE id = p_ticket_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM finance.escrows
                WHERE ticket_id = p_ticket_id AND status = 'held' AND payee_id IS NULL) THEN
        PERFORM finance.fn_refund_ticket_escrow(p_ticket_id);
        RETURN;
    END IF;

    SELECT status INTO v_ticket_status FROM projects.tickets WHERE id = p_ticket_id FOR UPDATE;

    FOR r IN
        SELECT * FROM finance.escrows WHERE ticket_id = p_ticket_id AND status = 'held'
        ORDER BY id
        FOR UPDATE
    LOOP
        PERFORM finance.fn_assert_no_open_dispute(r.id);
        v_fee_bp := finance.fn_escrow_fee_bp(r.payer_business_id, r.payer_user_id);
        v_fee := (r.amount_cents * v_fee_bp) / 10000;
        v_payout := r.amount_cents + COALESCE(r.deadline_bonus_cents, 0) - v_fee;
        IF v_payout < 0 THEN v_payout := 0; END IF;

        UPDATE finance.escrows SET status = 'released', platform_fee_cents = v_fee, released_at = now()
        WHERE id = r.id AND status = 'held'
        RETURNING id INTO v_flipped;
        CONTINUE WHEN v_flipped IS NULL;

        IF r.payee_type = 'team'::assignment_type THEN
            PERFORM finance.fn_split_team_payout(r.id, r.payee_id, v_payout, r.currency);
        ELSE
            v_payee_wallet := finance.fn_person_wallet_type(r.payee_id);
            PERFORM finance.fn_ensure_wallet(v_payee_wallet, r.payee_id, r.currency);
            PERFORM finance.fn_wallet_credit_pending(r.payee_id, v_payee_wallet, r.currency, v_payout, 'escrow_release', 'escrows', r.id);
        END IF;

        UPDATE projects.tickets
        SET total_amount_paid = total_amount_paid + v_payout,
            payment_status = CASE
                WHEN v_ticket_status = 'completed'::ticket_status THEN 'released'::payment_status
                ELSE 'partially_released'::payment_status
            END
        WHERE id = p_ticket_id;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance, projects, security, org;

-- Consolidate a business's billing period into one invoice PER CURRENCY (PRODUCT_SPEC §Escrow, Wallets
-- & Finance #4): every escrow RELEASED in [p_start, p_end) — by released_at, never created_at — as
-- escrow / deadline-bonus / platform-fee lines, and every on-account credit as an `on_account` line.
-- An escrow a conversion funded is invoiced in the currency the business paid in, at what it cost
-- there, with its own amount, currency and rate on the line (Decision #435).
-- Projective is the issuer (issue_from_profile NULL). total = escrow + bonus + tax: the platform fee
-- was deducted from the payee at release, so it is shown, never added. amount_due = the on-account
-- credit, the only part not already paid from the wallet; with nothing due the invoice is issued Paid.
-- Due `invoice_due_days` after issue (finance-model §15). Idempotent on
-- uq_invoices_business_period_currency: a re-run returns the invoices already issued and writes
-- nothing. A new invoice tells the business's billing members (`invoice.issued`). Returns the
-- period's invoice ids.
CREATE OR REPLACE FUNCTION finance.fn_generate_consolidated_invoice(
    p_business_id uuid, p_start timestamptz, p_end timestamptz
) RETURNS uuid[] AS $$
DECLARE
    v_ids uuid[] := '{}';
    v_invoice uuid;
    v_due_days integer;
    v_tax bigint := 0; -- shortcut: no tax is computed yet; becomes Stripe Tax's figure when tax collection lands.
    v_slug text;
    v_member uuid;
    c record;
    r record;
BEGIN
    SELECT (value #>> '{}')::integer INTO v_due_days
      FROM security.platform_params WHERE key = 'invoice_due_days';
    v_due_days := COALESCE(v_due_days, 14);
    SELECT slug INTO v_slug FROM org.business_profiles WHERE id = p_business_id;

    FOR c IN
        WITH spend AS (
            SELECT upper(COALESCE(cv.from_currency, e.currency)) AS currency,
                   SUM(COALESCE(e.fx_source_minor, e.amount_cents + e.deadline_bonus_cents)) AS subtotal,
                   SUM(CASE WHEN cv.id IS NULL THEN e.platform_fee_cents
                            ELSE div(e.platform_fee_cents::numeric * e.fx_source_minor, e.amount_cents::numeric)::bigint
                       END) AS fee
              FROM finance.escrows e
              LEFT JOIN finance.fx_conversions cv ON cv.id = e.fx_conversion_id
             WHERE e.payer_business_id = p_business_id AND e.status = 'released'
               AND e.released_at >= p_start AND e.released_at < p_end
             GROUP BY 1
        ), credit AS (
            SELECT upper(t.currency) AS currency, SUM(t.amount_cents) AS due
              FROM finance.transactions t
              JOIN finance.wallets w ON w.id = t.wallet_id
             WHERE w.owner_type = 'business' AND w.owner_id = p_business_id
               AND t.direction = 'credit' AND t.reason = 'on_account_credit'
               AND t.created_at >= p_start AND t.created_at < p_end
             GROUP BY 1
        )
        SELECT COALESCE(s.currency, k.currency) AS currency,
               COALESCE(s.subtotal, 0)::bigint AS subtotal,
               COALESCE(s.fee, 0)::bigint AS fee,
               COALESCE(k.due, 0)::bigint AS due
          FROM spend s FULL JOIN credit k ON k.currency = s.currency
    LOOP
        CONTINUE WHEN c.subtotal = 0 AND c.due = 0;
        v_invoice := NULL;
        INSERT INTO finance.invoices (
            project_stage_id, issue_to_business_id, issue_from_profile, invoice_type,
            billing_period_start, billing_period_end, amount_cents, subtotal_cents,
            platform_fee_cents, tax_cents, total_cents, amount_due_cents, currency, status, due_date, paid_at
        )
        VALUES (
            NULL, p_business_id, NULL, 'consolidated_monthly',
            p_start, p_end, c.subtotal + v_tax, c.subtotal,
            c.fee, v_tax, c.subtotal + v_tax, c.due, c.currency,
            CASE WHEN c.due > 0 THEN 'issued' ELSE 'paid' END,
            now() + make_interval(days => v_due_days),
            CASE WHEN c.due > 0 THEN NULL ELSE now() END
        )
        ON CONFLICT ON CONSTRAINT uq_invoices_business_period_currency DO NOTHING
        RETURNING id INTO v_invoice;

        IF v_invoice IS NULL THEN
            SELECT id INTO v_invoice FROM finance.invoices
             WHERE issue_to_business_id = p_business_id AND billing_period_start = p_start AND currency = c.currency;
            v_ids := v_ids || v_invoice;
            CONTINUE;
        END IF;

        FOR r IN
            SELECT e.id, e.amount_cents, e.deadline_bonus_cents, e.platform_fee_cents,
                   upper(e.currency) AS origin_currency, e.fx_source_minor, e.fx_rate, e.fx_as_of,
                   cv.id AS conversion_id, upper(COALESCE(cv.from_currency, e.currency)) AS currency
            FROM finance.escrows e
            LEFT JOIN finance.fx_conversions cv ON cv.id = e.fx_conversion_id
            WHERE e.payer_business_id = p_business_id
                AND e.status = 'released'
                AND e.released_at >= p_start AND e.released_at < p_end
                AND upper(COALESCE(cv.from_currency, e.currency)) = c.currency
            ORDER BY e.released_at, e.id
        LOOP
            IF r.conversion_id IS NOT NULL THEN
                INSERT INTO finance.invoice_line_items (invoice_id, ref_type, ref_id, description, amount_cents, currency,
                                                        origin_minor, origin_currency, fx_rate, fx_as_of)
                VALUES (v_invoice, 'escrow', r.id, 'Released escrow (converted, margin included)', r.fx_source_minor, r.currency,
                        r.amount_cents, r.origin_currency, r.fx_rate, r.fx_as_of);
                IF r.platform_fee_cents > 0 THEN
                    INSERT INTO finance.invoice_line_items (invoice_id, ref_type, ref_id, description, amount_cents, currency,
                                                            origin_minor, origin_currency, fx_rate, fx_as_of)
                    VALUES (v_invoice, 'platform_fee', r.id, 'Platform fee (included, deducted from the payee)',
                            div(r.platform_fee_cents::numeric * r.fx_source_minor, r.amount_cents::numeric)::bigint, r.currency,
                            r.platform_fee_cents, r.origin_currency, r.fx_rate, r.fx_as_of);
                END IF;
                CONTINUE;
            END IF;

            INSERT INTO finance.invoice_line_items (invoice_id, ref_type, ref_id, description, amount_cents, currency)
            VALUES (v_invoice, 'escrow', r.id, 'Released escrow', r.amount_cents, r.currency);

            IF r.deadline_bonus_cents > 0 THEN
                INSERT INTO finance.invoice_line_items (invoice_id, ref_type, ref_id, description, amount_cents, currency)
                VALUES (v_invoice, 'bonus', r.id, 'Deadline bonus', r.deadline_bonus_cents, r.currency);
            END IF;

            IF r.platform_fee_cents > 0 THEN
                INSERT INTO finance.invoice_line_items (invoice_id, ref_type, ref_id, description, amount_cents, currency)
                VALUES (v_invoice, 'platform_fee', r.id, 'Platform fee (included, deducted from the payee)', r.platform_fee_cents, r.currency);
            END IF;
        END LOOP;

        INSERT INTO finance.invoice_line_items (invoice_id, ref_type, ref_id, description, amount_cents, currency)
        SELECT v_invoice, 'on_account', t.id, 'Bought on account', t.amount_cents, upper(t.currency)
          FROM finance.transactions t
          JOIN finance.wallets w ON w.id = t.wallet_id
         WHERE w.owner_type = 'business' AND w.owner_id = p_business_id
           AND t.direction = 'credit' AND t.reason = 'on_account_credit'
           AND t.created_at >= p_start AND t.created_at < p_end
           AND upper(t.currency) = c.currency;

        FOR v_member IN
            SELECT DISTINCT vp.member_user_id FROM finance.vault_permissions vp
              JOIN finance.wallets w ON w.id = vp.wallet_id
             WHERE w.owner_type = 'business' AND w.owner_id = p_business_id
               AND 'manage_billing'::finance.vault_capability = ANY (vp.capabilities)
        LOOP
            PERFORM comms.fn_notify(
                v_member, 'invoice.issued', 'Monthly invoice issued',
                CASE WHEN c.due > 0
                    THEN format('Your %s invoice is ready, with an amount due for what was bought on account.', c.currency)
                    ELSE format('Your %s invoice is ready. Everything on it was paid from the wallet.', c.currency)
                END,
                'invoices', v_invoice,
                jsonb_build_object('total_minor', c.subtotal + v_tax, 'amount_due_minor', c.due, 'currency', c.currency),
                NULL, 'business', p_business_id, NULL,
                '/businesses/' || COALESCE(v_slug, p_business_id::text) || '/billing'
            );
        END LOOP;

        v_ids := v_ids || v_invoice;
    END LOOP;

    RETURN v_ids;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance, org, security, comms;

-- #endregion

-- #region US-007 AC4 — Fair-exit cancellation split (net-new).
-- The arithmetic of one escrow's fair-exit split, shared by fn_fair_exit_release (which moves the money)
-- and projects.fn_fair_exit_quote (which previews it), so the confirmation a reviewer reads can never
-- disagree with the settlement (Decision #198). The payee earns p_bp basis points of the principal less
-- the platform fee on that share; the unearned remainder goes back to the payer, fee-free. Truncates like
-- every fee (Decision #187).
CREATE OR REPLACE FUNCTION finance.fn_fair_exit_split(
    p_amount_cents bigint,
    p_bp integer,
    p_fee_bp integer,
    OUT share_cents bigint,
    OUT fee_cents bigint,
    OUT payout_cents bigint,
    OUT refund_cents bigint
)
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT s.share, s.fee, GREATEST(s.share - s.fee, 0), GREATEST(p_amount_cents - s.share, 0)
      FROM (SELECT (p_amount_cents * p_bp) / 10000 AS share,
                   (((p_amount_cents * p_bp) / 10000) * p_fee_bp) / 10000 AS fee) s
$$;

-- Pays the payee p_bp basis-points of each held escrow's principal (net of the platform fee) and
-- refunds the unearned remainder to the client (payer) business wallet. Locked and guarded exactly as
-- fn_release_ticket_escrow (Decision #188), so a racing release or second split settles nothing, and
-- refused the same way while a dispute is open (PD409, fn_assert_no_open_dispute).
CREATE OR REPLACE FUNCTION finance.fn_fair_exit_release(p_ticket_id uuid, p_bp integer)
RETURNS void AS $$
DECLARE
    r record;
    v_fee bigint;
    v_payout bigint;
    v_refund bigint;
    v_payee_wallet text;
    v_flipped uuid;
BEGIN
    -- Nothing was earned on a prepaid escrow nobody claimed (Decision #197): all of it goes back.
    PERFORM 1 FROM projects.tickets WHERE id = p_ticket_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM finance.escrows
                WHERE ticket_id = p_ticket_id AND status = 'held' AND payee_id IS NULL) THEN
        PERFORM finance.fn_refund_ticket_escrow(p_ticket_id);
        RETURN;
    END IF;

    PERFORM 1 FROM projects.tickets WHERE id = p_ticket_id FOR UPDATE;

    FOR r IN
        SELECT * FROM finance.escrows WHERE ticket_id = p_ticket_id AND status = 'held'
        ORDER BY id
        FOR UPDATE
    LOOP
        PERFORM finance.fn_assert_no_open_dispute(r.id);
        SELECT s.fee_cents, s.payout_cents, s.refund_cents INTO v_fee, v_payout, v_refund
          FROM finance.fn_fair_exit_split(
                   r.amount_cents, p_bp, finance.fn_escrow_fee_bp(r.payer_business_id, r.payer_user_id)) s;

        UPDATE finance.escrows SET status = 'released', platform_fee_cents = v_fee, released_at = now()
        WHERE id = r.id AND status = 'held'
        RETURNING id INTO v_flipped;
        CONTINUE WHEN v_flipped IS NULL;

        IF r.payee_type = 'team'::assignment_type THEN
            PERFORM finance.fn_split_team_payout(r.id, r.payee_id, v_payout, r.currency, 'fair_exit_release');
        ELSE
            v_payee_wallet := finance.fn_person_wallet_type(r.payee_id);
            PERFORM finance.fn_ensure_wallet(v_payee_wallet, r.payee_id, r.currency);
            PERFORM finance.fn_wallet_credit_pending(r.payee_id, v_payee_wallet, r.currency, v_payout, 'fair_exit_release', 'escrows', r.id);
        END IF;

        PERFORM finance.fn_refund_escrow_to_payer(r.id, v_refund, 'fair_exit_refund');

        UPDATE projects.tickets
        SET total_amount_paid = total_amount_paid + v_payout,
            payment_status = 'partially_released'::payment_status
        WHERE id = p_ticket_id;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance, projects, security, org;

-- No wallet is minted money. A business wallet used to be credited 2,500,000 minor units in whatever
-- currency it was opened in (a demo "opening platform credit", fn_seed_business_wallet), so every new
-- business, in every currency, started with spendable funds nobody had paid in. Removed 2026-09-28: a
-- wallet's balance is only ever the sum of real movements (top-ups, releases, transfers).

-- #region 2. Finance: refund path for parking auto-release
-- Distinct from finance.fn_release_ticket_escrow (which PAYS the payee). A parked claim never earned
-- anything, so held escrow is returned to the paying business wallet and the ticket is reset to
-- 'unpaid' so a future claim re-funds cleanly. Platform fee is only ever applied on release, so a
-- refund is exactly amount_cents back — no leakage. Locked and guarded as fn_release_ticket_escrow
-- (Decision #188): a refund racing a release or a second refund returns nothing twice.
CREATE OR REPLACE FUNCTION finance.fn_refund_ticket_escrow(p_ticket_id uuid)
RETURNS void AS $$
DECLARE
    r record;
    v_flipped uuid;
BEGIN
    PERFORM 1 FROM projects.tickets WHERE id = p_ticket_id FOR UPDATE;

    FOR r IN
        SELECT * FROM finance.escrows WHERE ticket_id = p_ticket_id AND status = 'held'
        ORDER BY id
        FOR UPDATE
    LOOP
        UPDATE finance.escrows SET status = 'refunded'
        WHERE id = r.id AND status = 'held'
        RETURNING id INTO v_flipped;
        CONTINUE WHEN v_flipped IS NULL;
        PERFORM finance.fn_refund_escrow_to_payer(r.id, r.amount_cents, 'escrow_refund');
    END LOOP;

    UPDATE projects.tickets
    SET payment_status = 'unpaid'::payment_status
    WHERE id = p_ticket_id
      AND NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = p_ticket_id AND status = 'held');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance, projects, org, auth;

-- The prepaid escrow TTL (Decision #428): every unclaimed prepaid ticket escrow past `expires_at` is
-- refunded whole to its payer's wallet (no fee), logged `prepaid_ttl_expired` and told to the client
-- person (`escrow.refunded`, mandatory). The ticket row is locked first, in the claim's and the
-- refund's own order, and skipped while another transaction holds it; under the lock the escrow is
-- re-read, so a claim that bound it first wins. A ticket somebody holds is left to the claim TTL.
-- The stages the client prepaid beyond it come back with it (Decision #430): nobody claimed the work,
-- so nothing later can start either. `p_now` is injectable for probes. Returns how many escrows were
-- refunded.
CREATE OR REPLACE FUNCTION finance.fn_sweep_expired_prepaid_escrows(
    p_now timestamptz DEFAULT now(),
    p_limit integer DEFAULT 200
)
RETURNS integer AS $$
DECLARE
    r record;
    v_escrow record;
    v_count integer := 0;
    v_prepaid integer;
BEGIN
    FOR r IN
        SELECT t.id AS ticket_id, t.title, t.slug AS ticket_slug,
               p.id AS project_id, p.slug AS project_slug,
               COALESCE(p.client_user_id, p.owner_user_id) AS client_person
          FROM finance.escrows e
          JOIN projects.tickets t ON t.id = e.ticket_id
          JOIN projects.projects p ON p.id = t.project_id
         WHERE e.status = 'held' AND e.payee_id IS NULL
           AND e.expires_at IS NOT NULL AND e.expires_at <= p_now
         ORDER BY e.expires_at, e.id
         LIMIT GREATEST(COALESCE(p_limit, 200), 1)
           FOR UPDATE OF t SKIP LOCKED
    LOOP
        SELECT e.id, e.amount_cents, e.currency, e.project_stage_id, e.expires_at
          INTO v_escrow
          FROM finance.escrows e
         WHERE e.ticket_id = r.ticket_id AND e.status = 'held' AND e.revision_id IS NULL
           AND e.payee_id IS NULL AND e.expires_at IS NOT NULL AND e.expires_at <= p_now
           FOR UPDATE;
        CONTINUE WHEN NOT FOUND;
        CONTINUE WHEN EXISTS (
            SELECT 1 FROM projects.tickets t
             WHERE t.id = r.ticket_id AND (t.current_assignee_id IS NOT NULL OR t.claimed_at IS NOT NULL)
        );

        PERFORM finance.fn_refund_ticket_escrow(r.ticket_id);
        CONTINUE WHEN NOT EXISTS (SELECT 1 FROM finance.escrows WHERE id = v_escrow.id AND status = 'refunded');
        v_count := v_count + 1;
        v_prepaid := finance.fn_refund_ticket_reservations(r.ticket_id, NULL, 'prepaid_ttl_expired');

        INSERT INTO projects.ticket_history (ticket_id, actor_id, action_type, changes)
        VALUES (r.ticket_id, r.client_person, 'prepaid_ttl_expired',
                jsonb_build_object('escrow_id', v_escrow.id, 'stage_id', v_escrow.project_stage_id,
                                   'amount_minor', v_escrow.amount_cents, 'currency', v_escrow.currency,
                                   'expired_at', v_escrow.expires_at, 'prepaid_stages_refunded', v_prepaid));

        PERFORM comms.fn_notify(
            r.client_person, 'escrow.refunded', 'Prepaid escrow returned',
            format(CASE WHEN v_prepaid > 0
                        THEN 'Nobody claimed "%s" in time, so its escrow and the later stages you prepaid are back in your wallet. Fund it again whenever you''re ready.'
                        ELSE 'Nobody claimed "%s" in time, so its escrow is back in your wallet. Fund it again whenever you''re ready.' END,
                   r.title),
            'projects.tickets', r.ticket_id,
            jsonb_build_object('escrow_id', v_escrow.id, 'amount_minor', v_escrow.amount_cents,
                               'currency', v_escrow.currency, 'reason', 'prepaid_ttl_expired'),
            NULL, 'project', r.project_id, NULL,
            '/projects/' || r.project_slug || '/board?tkv=' || r.ticket_slug
        );
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, finance, projects, org, comms, security, auth;

-- #region Ledger integrity — append-only rows and nightly reconciliation (Decision #186)
-- The ledger is the record; a row is never rewritten or removed. Bound BEFORE UPDATE OR DELETE (per row)
-- and BEFORE TRUNCATE (per statement) in 00001830, so it holds for every role — the table owner and
-- the service role included, where a grant alone could not. A mistake is corrected by a compensating
-- row through fn_wallet_credit / fn_wallet_debit.
CREATE OR REPLACE FUNCTION finance.fn_transactions_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'ledger: finance.transactions is append-only — % refused; post a compensating entry', TG_OP
        USING ERRCODE = 'PL403';
END;
$$;

-- finance.wallets.balance_cents is a cache written beside the ledger, so it can drift from it. Compares
-- every wallet's cached balance with the SUM of its signed ledger rows and with its newest row's
-- balance_after_cents, and its pots with their movements and with its balance (FINANCE_AUDIT L7), by
-- reading finance.v_wallet_drift (00003004) in ONE statement, so a movement committing mid-run is seen
-- whole or not at all.
-- Each drifted wallet becomes an `error` row in ops.log_entries (scope `finance.reconcile_wallets`,
-- the figures in `data`) and the run raises a WARNING; every run also writes one `metric` row, its
-- heartbeat (Decision #461 flag (a)). Returns the number of drifted wallets.
-- Read-only on finance: drift is reported for a human, never auto-corrected.
CREATE OR REPLACE FUNCTION finance.fn_reconcile_wallets()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_run uuid := pg_catalog.gen_random_uuid();
    v_count integer;
    v_fx integer;
BEGIN
    WITH drift AS (
        SELECT d.wallet_id AS id, d.owner_type, d.owner_id, d.currency, d.balance_cents,
               d.ledger_sum_cents, d.earmarked_cents, d.pot_drift_cents, d.latest_balance_after_cents
          FROM finance.v_wallet_drift d
    ), logged AS (
        INSERT INTO ops.log_entries (client_id, level, message, occurred_at, source, scope, data)
        SELECT 'reconcile:' || v_run::text,
               'error',
               pg_catalog.format('Wallet %s drifted from its ledger: cached %s, ledger sum %s, latest balance_after %s, pots earmark %s (pot drift %s)',
                   d.id, d.balance_cents, d.ledger_sum_cents, COALESCE(d.latest_balance_after_cents::text, 'none'),
                   d.earmarked_cents, d.pot_drift_cents),
               pg_catalog.now(),
               'server',
               'finance.reconcile_wallets',
               pg_catalog.jsonb_build_object(
                   'run_id', v_run,
                   'wallet_id', d.id,
                   'owner_type', d.owner_type,
                   'owner_id', d.owner_id,
                   'currency', d.currency,
                   'balance_cents', d.balance_cents,
                   'ledger_sum_cents', d.ledger_sum_cents,
                   'latest_balance_after_cents', d.latest_balance_after_cents,
                   'earmarked_cents', d.earmarked_cents,
                   'pot_drift_cents', d.pot_drift_cents
               )
          FROM drift d
        RETURNING 1
    )
    SELECT pg_catalog.count(*)::integer INTO v_count FROM logged;

    INSERT INTO ops.log_entries (client_id, level, message, occurred_at, source, scope, data)
    SELECT 'reconcile:' || v_run::text,
           'error',
           pg_catalog.format('FX conversion %s (%s) does not match its ledger: %s expected %s, found %s',
               x.conversion_id, x.kind, x.problem, x.expected_minor, x.ledger_minor),
           pg_catalog.now(),
           'server',
           'finance.reconcile_wallets',
           pg_catalog.to_jsonb(x) || pg_catalog.jsonb_build_object('run_id', v_run)
      FROM finance.v_fx_conversion_reconciliation x;
    GET DIAGNOSTICS v_fx = ROW_COUNT;
    v_count := v_count + v_fx;

    -- The run's heartbeat (Decision #461 flag (a)): one `metric` row each run, the counts in `data`, so
    -- a clean night still shows that the reconciliation ran and the dead-man switch can tell silence
    -- from health (`ops.alert_rules`, MR4). A `metric` row never alerts.
    INSERT INTO ops.log_entries (client_id, level, message, occurred_at, source, scope, data)
    VALUES ('reconcile:' || v_run::text,
            'metric',
            pg_catalog.format('Reconciliation run %s: %s wallet(s) or conversion(s) drifted', v_run, v_count),
            pg_catalog.now(),
            'server',
            'finance.reconcile_wallets',
            pg_catalog.jsonb_build_object('run_id', v_run, 'drifted', v_count, 'conversions', v_fx));

    IF v_count > 0 THEN
        RAISE WARNING 'finance.fn_reconcile_wallets: % wallet(s) or conversion(s) drifted from the ledger (run %)', v_count, v_run;
    END IF;
    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION finance.fn_reconcile_wallets() IS
'Nightly ledger reconciliation: flags every wallet whose balance_cents differs from the sum of its
ledger rows or from its newest balance_after_cents, or whose pots drift from their movements or
earmark more than it holds, and every FX conversion whose ledger legs or funded escrows do not add up
(finance.v_fx_conversion_reconciliation, Decision #435), into ops.log_entries, plus one metric row per
run as its heartbeat (Decision #461). Read-only on finance; service role / pg_cron only.';

-- Scheduled nightly at 03:40 UTC, after the 02:20 billing run, as `finance-reconcile-wallets` by the
-- job registry (`ops.scheduled_jobs`, 00005060).
-- #endregion

-- #region Conservation identity — checked nightly, read by operators (Decision #337, ruling M2 (A); FBP DB16)
-- The nightly check: one ops.log_entries row per currency in finance.v_conservation_identity (00003004),
-- scope `finance.conservation`, source `server`: `error` when the currency does not conserve, `metric`
-- when it does, every term in `data` under one `run_id`. It runs after finance.fn_reconcile_wallets
-- and, like it, never corrects anything: an imbalance is a human's to explain. Returns how many
-- currencies are out of balance and raises a WARNING when any is. Service role / pg_cron only.
CREATE OR REPLACE FUNCTION finance.fn_check_conservation()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_run uuid := pg_catalog.gen_random_uuid();
    v_bad integer;
BEGIN
    WITH logged AS (
        INSERT INTO ops.log_entries (client_id, level, message, occurred_at, source, scope, data)
        SELECT 'conservation:' || v_run::text,
               CASE WHEN c.imbalance_minor <> 0 THEN 'error' ELSE 'metric' END,
               CASE WHEN c.imbalance_minor <> 0
                    THEN pg_catalog.format('%s does not conserve: the platform accounts for %s, external movements explain %s (imbalance %s)',
                             c.currency, c.accounted_minor, c.external_minor, c.imbalance_minor)
                    ELSE pg_catalog.format('%s conserves: %s accounted for, all of it explained by external movements',
                             c.currency, c.accounted_minor)
               END,
               pg_catalog.now(),
               'server',
               'finance.conservation',
               pg_catalog.to_jsonb(c) || pg_catalog.jsonb_build_object('run_id', v_run)
          FROM finance.v_conservation_identity c
        RETURNING level
    )
    SELECT pg_catalog.count(*) FILTER (WHERE level = 'error')::integer INTO v_bad FROM logged;

    IF v_bad > 0 THEN
        RAISE WARNING 'finance.fn_check_conservation: % currency(ies) do not conserve money (run %)', v_bad, v_run;
    END IF;
    RETURN v_bad;
END;
$$;

COMMENT ON FUNCTION finance.fn_check_conservation() IS
'Nightly conservation check (Decision #337, ruling M2 (A)): one ops.log_entries row per currency of
finance.v_conservation_identity, scope finance.conservation, level error for an imbalance and metric
for a balanced currency, every term in data. Never corrects anything. Service role / pg_cron only.';

-- Scheduled nightly at 03:50 UTC, after the 03:40 reconciliation, as `finance-conservation-check` by
-- the job registry (`ops.scheduled_jobs`, 00005060).

-- The operator read behind /admin/ledger's Conservation and Wallet drift sections: security.is_admin()
-- only; anyone else gets 42501, which the page answers with a 404, as /admin/disputes does (Decision
-- #212). `currencies` is the identity now; `nights` the checks of the last 30 days, newest first (one
-- row per currency per run); `drift` what is open now (every wallet finance.v_wallet_drift lists, every
-- conversion finance.v_fx_conversion_reconciliation does) and how many drift rows the nightly
-- reconciliation logged in those 30 days. Reads only; ids, no names.
CREATE OR REPLACE FUNCTION finance.get_ledger_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT security.is_admin() THEN
        RAISE EXCEPTION 'Only a platform operator can read ledger health' USING ERRCODE = '42501';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'as_of', pg_catalog.now(),
        'currencies', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c) ORDER BY c.currency)
              FROM finance.v_conservation_identity c
        ), '[]'::jsonb),
        'nights', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                       'run_id', l.data ->> 'run_id',
                       'checked_at', l.created_at,
                       'currency', l.data ->> 'currency',
                       'balanced', l.level = 'metric',
                       'external_minor', (l.data ->> 'external_minor')::bigint,
                       'accounted_minor', (l.data ->> 'accounted_minor')::bigint,
                       'imbalance_minor', (l.data ->> 'imbalance_minor')::bigint
                   ) ORDER BY l.created_at DESC, l.data ->> 'currency')
              FROM ops.log_entries l
             WHERE l.scope = 'finance.conservation' AND l.source = 'server'
               AND l.created_at >= pg_catalog.now() - interval '30 days'
        ), '[]'::jsonb),
        'drift', pg_catalog.jsonb_build_object(
            'wallets', COALESCE((
                SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                           'wallet_id', d.wallet_id,
                           'owner_type', d.owner_type,
                           'currency', d.currency,
                           'balance_minor', d.balance_cents,
                           'ledger_sum_minor', d.ledger_sum_cents,
                           'latest_balance_after_minor', d.latest_balance_after_cents,
                           'earmarked_minor', d.earmarked_cents,
                           'pot_drift_minor', d.pot_drift_cents
                       ) ORDER BY d.currency, d.wallet_id)
                  FROM finance.v_wallet_drift d
            ), '[]'::jsonb),
            'conversions', COALESCE((
                SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                           'conversion_id', x.conversion_id,
                           'escrow_id', x.escrow_id,
                           'kind', x.kind,
                           'problem', x.problem,
                           'expected_minor', x.expected_minor,
                           'ledger_minor', x.ledger_minor
                       ) ORDER BY x.kind, x.problem, x.conversion_id)
                  FROM finance.v_fx_conversion_reconciliation x
            ), '[]'::jsonb),
            'logged_30d', (
                SELECT pg_catalog.count(*)
                  FROM ops.log_entries l
                 WHERE l.scope = 'finance.reconcile_wallets' AND l.source = 'server' AND l.level = 'error'
                   AND l.created_at >= pg_catalog.now() - interval '30 days'
            ),
            'last_logged_at', (
                SELECT pg_catalog.max(l.created_at)
                  FROM ops.log_entries l
                 WHERE l.scope = 'finance.reconcile_wallets' AND l.source = 'server' AND l.level = 'error'
            )
        )
    );
END;
$$;
-- #endregion

-- #region Escrow age — how long held money sits in the platform balance (Decision #473, MR7)
-- Under Separate Charges & Transfers every card charge settles into the PLATFORM's Stripe balance, and
-- money leaves it only when a payee withdraws (the Transfer `PaymentBackendService.withdraw` creates).
-- So escrow, a reservation, a disputed escrow and a release still inside its pending window all sit in
-- the platform balance, and how long they sit is the fact counsel's answer to ruling M2 turns on
-- (Decision #337, PRD-F15; the brief is FOUNDER_QUESTIONNAIRE.md Part D). This reader measures it and
-- moves nothing.
--
-- One row per (kind, currency) over the money still held, each kind named for the clock that ends it:
--   held_bound    held for a named payee (a ticket's or a paid revision's) — ends at approval; no timer
--                 today (the 14-day auto-approve, PM-GH1, is not built)
--   held_prepaid  held, nobody has claimed it — the prepaid TTL refunds it at `expires_at` (#428)
--   held_seat     held for a session seat — released `session_payout_hours` after its sitting (#171, #211)
--   reserved      a later ticket stage paid for ahead (#430) — no clock at all
--   disputed      frozen by a dispute (#212) — ends at the operator's ruling
--   pending       released, inside `pending_release_days` (#191); counted as amount − recovered
--   on_hold       a pending release a card dispute froze (ruling M3, fn_open_chargeback) — ends at its close
-- Age runs from when the money entered that state: an escrow's `created_at` (a reservation the stage
-- activates in place keeps it), a pending release's `released_at`. Release therefore starts a second
-- clock, and the time in the platform balance is the two added together. `p_now` is the clock to age
-- against (injectable for probes), never a point-in-time snapshot: a row created after it ages 0.
-- Ages are days to one decimal; `over` counts and sums the rows older than 30, 60 and 90 days.
CREATE OR REPLACE FUNCTION finance.fn_escrow_age(p_now timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    WITH money AS (
        SELECT CASE
                   WHEN e.status = 'disputed' THEN 'disputed'
                   WHEN e.status = 'reserved' THEN 'reserved'
                   WHEN e.cohort_membership_id IS NOT NULL THEN 'held_seat'
                   WHEN e.payee_id IS NULL THEN 'held_prepaid'
                   ELSE 'held_bound'
               END AS kind,
               e.currency::text AS currency,
               e.amount_cents AS amount_minor,
               e.created_at AS since
          FROM finance.escrows e
         WHERE e.status IN ('held', 'reserved', 'disputed')
        UNION ALL
        SELECT pr.state::text, pr.currency::text, pr.amount_cents - pr.recovered_cents, pr.released_at
          FROM finance.pending_releases pr
         WHERE pr.state IN ('pending', 'on_hold')
           AND pr.amount_cents > pr.recovered_cents
    ),
    aged AS (
        SELECT m.kind, m.currency, m.amount_minor, m.since,
               GREATEST(pg_catalog.date_part('epoch', p_now - m.since) / 86400.0, 0) AS age_days
          FROM money m
    ),
    buckets AS (
        SELECT a.kind, a.currency,
               CASE a.kind WHEN 'held_bound' THEN 1 WHEN 'held_prepaid' THEN 2 WHEN 'held_seat' THEN 3
                           WHEN 'reserved' THEN 4 WHEN 'disputed' THEN 5 WHEN 'pending' THEN 6 ELSE 7 END AS rank,
               pg_catalog.jsonb_build_object(
                   'kind', a.kind,
                   'currency', a.currency,
                   'count', pg_catalog.count(*),
                   'total_minor', pg_catalog.sum(a.amount_minor),
                   'oldest_at', pg_catalog.min(a.since),
                   'p50_days', pg_catalog.round((pg_catalog.percentile_cont(0.5) WITHIN GROUP (ORDER BY a.age_days))::numeric, 1),
                   'p90_days', pg_catalog.round((pg_catalog.percentile_cont(0.9) WITHIN GROUP (ORDER BY a.age_days))::numeric, 1),
                   'max_days', pg_catalog.round(pg_catalog.max(a.age_days)::numeric, 1),
                   'over', pg_catalog.jsonb_build_array(
                       pg_catalog.jsonb_build_object('days', 30,
                           'count', pg_catalog.count(*) FILTER (WHERE a.age_days > 30),
                           'total_minor', COALESCE(pg_catalog.sum(a.amount_minor) FILTER (WHERE a.age_days > 30), 0)),
                       pg_catalog.jsonb_build_object('days', 60,
                           'count', pg_catalog.count(*) FILTER (WHERE a.age_days > 60),
                           'total_minor', COALESCE(pg_catalog.sum(a.amount_minor) FILTER (WHERE a.age_days > 60), 0)),
                       pg_catalog.jsonb_build_object('days', 90,
                           'count', pg_catalog.count(*) FILTER (WHERE a.age_days > 90),
                           'total_minor', COALESCE(pg_catalog.sum(a.amount_minor) FILTER (WHERE a.age_days > 90), 0))
                   )
               ) AS item
          FROM aged a
         GROUP BY a.kind, a.currency
    )
    SELECT pg_catalog.jsonb_build_object(
        'as_of', p_now,
        'rows', COALESCE((SELECT pg_catalog.jsonb_agg(r.item ORDER BY r.currency, r.rank) FROM buckets r),
                         '[]'::jsonb)
    );
$$;

COMMENT ON FUNCTION finance.fn_escrow_age(timestamptz) IS
'How long held money has sat in the platform balance, per kind (held_bound · held_prepaid · held_seat ·
reserved · disputed · pending · on_hold) and currency: count, total, oldest, p50 / p90 / max age in
days, and the count and total older than 30, 60 and 90 days (MR7, Decision #473). Read-only. Internal:
reached through finance.read_escrow_age (operators) and probes.';

-- The operator door (`/admin/ledger`'s Escrow age section): security.is_admin() only. Anyone else gets
-- 42501, which the page answers with a 404, as /admin/disputes does (Decision #212).
CREATE OR REPLACE FUNCTION finance.read_escrow_age()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT security.is_admin() THEN
        RAISE EXCEPTION 'Only a platform operator can read escrow age' USING ERRCODE = '42501';
    END IF;
    RETURN finance.fn_escrow_age(pg_catalog.now());
END;
$$;
-- #endregion

-- #region Seller tax reporting — what the ledger credited each seller, per quarter (LEGAL LG6, Decision #527)
-- The dataset a platform-reporting regime may ask of Projective (UK platform-operator rules, EU DAC7):
-- per seller, currency and calendar quarter (UTC), what the ledger credited them as income, the platform
-- fees attributed to it, and how many paid activities it came from. Stripe holds the seller's verified
-- identity and tax number; the row carries only the reference to it (the payout account) and the
-- country the seller's own profile states. Filing is a person's job: an operator exports this
-- (Decision #527 (D), ruling A). Whether and where Projective must report is counsel's (#527 (A)).
--
-- Income is every ledger CREDIT under finance.fn_is_income_reason, dated when it reached the wallet: a
-- release still inside its pending window is counted in the quarter it matures. The fee is the source's
-- own record. An escrow's `platform_fee_cents` is shared across every credit it paid (a team's members
-- and its vault) by each credit's part of the escrow's total payout, the not-yet-matured releases
-- included, each share floored, so a direct payee carries the whole fee. A product sale's fee is the
-- `platform_fee_minor` of that order's lines whose product the seller owns. Read-only.
CREATE OR REPLACE FUNCTION finance.fn_seller_tax_report(p_year integer)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    WITH per_source AS (
        SELECT w.owner_type, w.owner_id, t.currency, t.ref_table, t.ref_id,
               EXTRACT(quarter FROM t.created_at AT TIME ZONE 'UTC')::integer AS quarter,
               pg_catalog.sum(t.amount_cents)::bigint AS credited
          FROM finance.transactions t
          JOIN finance.wallets w ON w.id = t.wallet_id
         WHERE t.direction = 'credit'
           AND finance.fn_is_income_reason(t.reason)
           AND t.created_at >= pg_catalog.make_timestamptz(p_year, 1, 1, 0, 0, 0, 'UTC')
           AND t.created_at < pg_catalog.make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'UTC')
         GROUP BY w.owner_type, w.owner_id, t.currency, t.ref_table, t.ref_id, 6
    ),
    escrow_fee AS (
        SELECT s.ref_id, e.platform_fee_cents AS fee,
               COALESCE((SELECT pg_catalog.sum(t.amount_cents) FROM finance.transactions t
                          WHERE t.ref_table = 'escrows' AND t.ref_id = e.id AND t.direction = 'credit'
                            AND finance.fn_is_income_reason(t.reason)), 0)
             + COALESCE((SELECT pg_catalog.sum(pr.amount_cents - pr.recovered_cents) FROM finance.pending_releases pr
                          WHERE pr.escrow_id = e.id AND pr.state <> 'available'), 0) AS paid_out
          FROM (SELECT DISTINCT ref_id FROM per_source WHERE ref_table = 'escrows') s
          JOIN finance.escrows e ON e.id = s.ref_id
    ),
    with_fees AS (
        SELECT s.*,
               CASE s.ref_table
                   WHEN 'escrows' THEN (
                       SELECT CASE WHEN f.paid_out > 0
                                   THEN pg_catalog.div(f.fee::numeric * s.credited, f.paid_out)::bigint
                                   ELSE 0 END
                         FROM escrow_fee f WHERE f.ref_id = s.ref_id)
                   WHEN 'orders' THEN (
                       SELECT pg_catalog.sum(ol.platform_fee_minor)::bigint
                         FROM finance.order_lines ol
                         JOIN catalogue.products p ON p.id = ol.item_id
                        WHERE ol.order_id = s.ref_id AND ol.item_type = 'digital_product'
                          AND COALESCE(p.owner_team_id, p.owner_user_id) = s.owner_id
                          AND (p.owner_team_id IS NOT NULL) = (s.owner_type = 'team'))
               END AS fee
          FROM per_source s
    ),
    per_quarter AS (
        SELECT owner_type, owner_id, currency, quarter,
               pg_catalog.sum(credited)::bigint AS credited,
               COALESCE(pg_catalog.sum(fee), 0)::bigint AS fees,
               pg_catalog.count(*)::integer AS activities
          FROM with_fees
         GROUP BY owner_type, owner_id, currency, quarter
    )
    SELECT pg_catalog.jsonb_build_object(
        'year', p_year,
        'rows', COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'seller_type', q.owner_type,
            'seller_id', q.owner_id,
            'currency', q.currency,
            'quarter', q.quarter,
            'credited_minor', q.credited,
            'fees_minor', q.fees,
            'gross_minor', q.credited + q.fees,
            'activities', q.activities,
            'profile_country', CASE q.owner_type
                WHEN 'business' THEN (SELECT b.country FROM org.business_profiles b WHERE b.id = q.owner_id)
                WHEN 'enterprise' THEN (SELECT en.address_country FROM org.enterprises en WHERE en.id = q.owner_id)
                WHEN 'team' THEN NULL
                ELSE (SELECT u.country FROM org.users_public u WHERE u.user_id = q.owner_id)
            END,
            'payout_provider', pa.provider,
            'payout_account_id', pa.account_id
        ) ORDER BY q.owner_type, q.owner_id, q.currency, q.quarter), '[]'::jsonb)
    )
      FROM per_quarter q
      LEFT JOIN LATERAL (
          SELECT a.provider, a.account_id FROM finance.payout_accounts a
           WHERE a.owner_id = q.owner_id
             AND CASE WHEN q.owner_type IN ('user', 'freelancer') THEN a.owner_type IN ('user', 'freelancer')
                      ELSE a.owner_type = q.owner_type END
           ORDER BY (a.status <> 'disabled') DESC, a.created_at DESC
           LIMIT 1
      ) pa ON true;
$$;

COMMENT ON FUNCTION finance.fn_seller_tax_report(integer) IS
'Per seller, currency and calendar quarter (UTC) of p_year: credited_minor (ledger income credits),
fees_minor (the platform fees attributed to them), gross_minor (their sum), activities (the distinct
escrows and orders paid), profile_country and the payout account reference (LEGAL LG6, Decision #527).
Read-only. Internal: reached through finance.read_seller_tax_report (operators) and probes.';

-- The operator door (`/api/admin/seller-tax-report`): security.is_admin() only. Anyone else gets 42501,
-- which the route answers with a 404, as /admin/ledger does (Decision #212).
CREATE OR REPLACE FUNCTION finance.read_seller_tax_report(p_year integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT security.is_admin() THEN
        RAISE EXCEPTION 'Only a platform operator can read the seller tax report' USING ERRCODE = '42501';
    END IF;
    IF p_year IS NULL OR p_year < 2000 OR p_year > 9998 THEN
        RAISE EXCEPTION 'year: give a calendar year from 2000' USING ERRCODE = '22023';
    END IF;
    RETURN finance.fn_seller_tax_report(p_year);
END;
$$;
-- #endregion

-- #region Seller tax documents — a residence certificate kept private and shown to one client (LEGAL LG6, Decision #527)
-- A seller's tax residence certificate is an ordinary private upload to their own library (the files
-- pipeline), which finance.mark_tax_document marks `files.items.metadata -> 'tax_document'`. Only a
-- definer can write that key (files.fn_guard_pipeline_columns), so nobody can forge the mark, and
-- marking resets the file to private with no grants. finance.share_tax_document shows it to exactly one
-- person, the client of a project the seller works on, through files.set_item_access (`restricted`
-- with one `user` viewer grant, the complete list), so a second share replaces the first; sharing to no
-- project makes it private again. Scanned when the upload pipeline scans (T&S SN1, PRD-D3); until then
-- it is content-sniffed only, like every upload.

-- The person the caller may show a tax document to for p_project_id: the project's client, when the
-- caller works on it (they own a listing-made engagement, take part, or hold a live assignment, as
-- projects.has_project_access decides) and is not that client. NULL otherwise. Internal.
CREATE OR REPLACE FUNCTION finance.fn_tax_document_client(p_project_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(p.client_user_id, p.owner_user_id)
      FROM projects.projects p
     WHERE p.id = p_project_id
       AND auth.uid() IS NOT NULL
       AND COALESCE(p.client_user_id, p.owner_user_id) <> auth.uid()
       AND projects.has_project_access(p.id);
$$;

-- One tax document as the seller's section shows it, or NULL when p_file_id is not the caller's
-- marked, live document. Internal.
CREATE OR REPLACE FUNCTION finance.fn_tax_document_json(p_file_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT pg_catalog.jsonb_build_object(
        'file_id', i.id,
        'kind', i.metadata #>> '{tax_document,kind}',
        'name', i.display_name,
        'mime_type', i.mime_type,
        'size_bytes', i.size_bytes,
        'created_at', i.created_at,
        'shared', (
            SELECT pg_catalog.jsonb_build_object(
                'project_id', p.id,
                'project_slug', p.slug,
                'project_title', p.title,
                'client_user_id', g.grantee_id,
                'client_name', COALESCE(NULLIF(pg_catalog.btrim(pg_catalog.concat_ws(' ', u.first_name, u.last_name)), ''), u.username)
            )
              FROM files.item_grants g
              JOIN org.users_public u ON u.user_id = g.grantee_id
              LEFT JOIN projects.projects p ON p.id = (i.metadata #>> '{tax_document,shared_project_id}')::uuid
             WHERE i.visibility <> 'private'::files.file_visibility
               AND g.item_id = i.id AND g.revoked_at IS NULL AND g.grantee_kind = 'user'::files.grantee_kind
             ORDER BY g.created_at DESC
             LIMIT 1
        )
    )
      FROM files.items i
     WHERE i.id = p_file_id
       AND i.owner_user_id = auth.uid()
       AND i.owner_type = 'user'::files.owner_kind
       AND i.deleted_at IS NULL
       AND i.metadata ? 'tax_document';
$$;

-- The caller's tax documents, newest first, and the projects they may show one to (Settings →
-- Verification & payouts → Tax documents).
CREATE OR REPLACE FUNCTION finance.list_tax_documents()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to see your tax documents' USING ERRCODE = '42501';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'documents', COALESCE((
            SELECT pg_catalog.jsonb_agg(finance.fn_tax_document_json(i.id) ORDER BY i.created_at DESC, i.id)
              FROM files.items i
             WHERE i.owner_user_id = v_uid AND i.owner_type = 'user'::files.owner_kind
               AND i.deleted_at IS NULL AND i.metadata ? 'tax_document'
        ), '[]'::jsonb),
        'targets', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                       'project_id', c.id,
                       'project_slug', c.slug,
                       'project_title', c.title,
                       'client_user_id', c.client_id,
                       'client_name', COALESCE(NULLIF(pg_catalog.btrim(pg_catalog.concat_ws(' ', u.first_name, u.last_name)), ''), u.username)
                   ) ORDER BY c.title, c.id)
              FROM (
                  SELECT p.id, p.slug, p.title, finance.fn_tax_document_client(p.id) AS client_id
                    FROM projects.projects p
                   WHERE (p.owner_user_id = v_uid AND p.client_user_id IS NOT NULL)
                      OR EXISTS (SELECT 1 FROM projects.project_participants pp
                                  WHERE pp.project_id = p.id AND pp.profile_type = 'freelancer' AND pp.profile_id = v_uid)
                      OR EXISTS (SELECT 1 FROM projects.stage_assignments sa
                                   JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
                                  WHERE ps.project_id = p.id AND sa.freelancer_profile_id = v_uid)
              ) c
              JOIN org.users_public u ON u.user_id = c.client_id
             WHERE c.client_id IS NOT NULL
        ), '[]'::jsonb)
    );
END;
$$;

-- Mark one of the caller's own uploaded files as a tax residence certificate, private and shared with
-- nobody. Marking it again changes nothing but resets its sharing.
-- Errors: 42501 signed out; PF404 not the caller's live file; 22023 not yet through the upload pipeline.
CREATE OR REPLACE FUNCTION finance.mark_tax_document(p_file_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_item files.items%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to keep tax documents' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_item FROM files.items i
     WHERE i.id = p_file_id AND i.owner_user_id = v_uid AND i.owner_type = 'user'::files.owner_kind
       AND i.deleted_at IS NULL
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No such file' USING ERRCODE = 'PF404';
    END IF;
    IF v_item.status <> 'uploaded'::files.file_status OR v_item.source <> 'supabase'::files.file_source THEN
        RAISE EXCEPTION 'That file has not finished uploading' USING ERRCODE = '22023';
    END IF;
    PERFORM files.set_item_access(p_file_id, 'private'::files.file_visibility, NULL, '[]'::jsonb);
    UPDATE files.items
       SET metadata = metadata || pg_catalog.jsonb_build_object(
               'tax_document', pg_catalog.jsonb_build_object('kind', 'residence_certificate'))
     WHERE id = p_file_id;
    RETURN finance.fn_tax_document_json(p_file_id);
END;
$$;

-- Show the caller's tax document to the client of p_project_id and nobody else, or, with no project,
-- to nobody. Errors: 42501 signed out; PF404 not the caller's tax document; 22023 a project the caller
-- cannot show it to (not on it, or its client).
CREATE OR REPLACE FUNCTION finance.share_tax_document(p_file_id uuid, p_project_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_client uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to share tax documents' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM files.items i
     WHERE i.id = p_file_id AND i.owner_user_id = v_uid AND i.owner_type = 'user'::files.owner_kind
       AND i.deleted_at IS NULL AND i.metadata ? 'tax_document'
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No such tax document' USING ERRCODE = 'PF404';
    END IF;

    IF p_project_id IS NULL THEN
        PERFORM files.set_item_access(p_file_id, 'private'::files.file_visibility, NULL, '[]'::jsonb);
        UPDATE files.items SET metadata = metadata #- '{tax_document,shared_project_id}' WHERE id = p_file_id;
        RETURN finance.fn_tax_document_json(p_file_id);
    END IF;

    v_client := finance.fn_tax_document_client(p_project_id);
    IF v_client IS NULL THEN
        RAISE EXCEPTION 'You can show a tax document only to the client of a project you work on'
            USING ERRCODE = '22023';
    END IF;
    PERFORM files.set_item_access(p_file_id, 'restricted'::files.file_visibility, NULL,
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind', 'user', 'id', v_client, 'role', 'viewer')));
    UPDATE files.items
       SET metadata = pg_catalog.jsonb_set(metadata, '{tax_document,shared_project_id}', pg_catalog.to_jsonb(p_project_id))
     WHERE id = p_file_id;
    RETURN finance.fn_tax_document_json(p_file_id);
END;
$$;
-- #endregion
