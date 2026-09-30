DO $$
DECLARE
    -- ── Configure ────────────────────────────────────────────────────────────────
    v_user_id   uuid    := '0264997c-5da2-41ad-bd08-7d3f7e3aacf0';  -- ← the user
    v_currency  text    := 'GBP';
    v_days      int     := 180;     -- how far back the history goes
    v_reset     boolean := true;    -- wipe this wallet's existing ledger + payouts first
    -- ─────────────────────────────────────────────────────────────────────────────
    v_owner_type text;
    v_wallet     uuid;
    v_name       text;
    v_card       uuid := gen_random_uuid();
    v_card2      uuid := gen_random_uuid();
    v_bank       uuid := gen_random_uuid();
    v_schedule   uuid := gen_random_uuid();
    v_bal        bigint := 0;
    v_tx         uuid;
    r            record;
BEGIN
    SELECT coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), username)
      INTO v_name FROM org.users_public WHERE user_id = v_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'No org.users_public row for %', v_user_id; END IF;

    -- A seller's personal wallet is 'freelancer', a buyer's is 'user'; the wallet reads both.
    v_owner_type := CASE WHEN EXISTS (SELECT 1 FROM org.freelancer_profiles WHERE user_id = v_user_id)
                         THEN 'freelancer' ELSE 'user' END;

    SELECT id INTO v_wallet FROM finance.wallets
     WHERE owner_id = v_user_id AND owner_type IN ('user', 'freelancer') AND currency = v_currency
     LIMIT 1;
    IF v_wallet IS NULL THEN
        INSERT INTO finance.wallets (owner_type, owner_id, currency, created_at)
        VALUES (v_owner_type, v_user_id, v_currency, now() - make_interval(days => v_days + 5))
        RETURNING id INTO v_wallet;
    ELSE
        SELECT owner_type INTO v_owner_type FROM finance.wallets WHERE id = v_wallet;
    END IF;

    IF v_reset THEN
        DELETE FROM finance.payouts WHERE wallet_id = v_wallet;
        DELETE FROM finance.transactions WHERE wallet_id = v_wallet;
        DELETE FROM finance.deposit_rules WHERE wallet_id = v_wallet;
    ELSIF EXISTS (SELECT 1 FROM finance.transactions WHERE wallet_id = v_wallet) THEN
        RAISE EXCEPTION 'Wallet % already has a ledger; set v_reset := true', v_wallet;
    END IF;

    -- #region Payment methods (display facts only; Stripe refs are fake placeholders)
    INSERT INTO finance.payment_methods
        (id, owner_type, owner_id, method_role, external_ref, label, brand, last4,
         is_default_funding, is_default_payout, created_at)
    VALUES
        (v_card,  v_owner_type, v_user_id, 'funding', 'pm_demo_' || left(v_card::text, 8),
         'Personal Visa', 'visa', '4242',
         NOT EXISTS (SELECT 1 FROM finance.payment_methods WHERE owner_id = v_user_id AND is_default_funding),
         false, now() - make_interval(days => v_days)),
        (v_card2, v_owner_type, v_user_id, 'funding', 'pm_demo_' || left(v_card2::text, 8),
         'Business Mastercard', 'mastercard', '5454', false, false, now() - interval '40 days'),
        (v_bank,  v_owner_type, v_user_id, 'payout', 'ba_demo_' || left(v_bank::text, 8),
         'Monzo current account', 'monzo', '6281', false,
         NOT EXISTS (SELECT 1 FROM finance.payment_methods WHERE owner_id = v_user_id AND is_default_payout),
         now() - make_interval(days => v_days));

    INSERT INTO finance.saved_cards
        (owner_type, owner_id, payment_method_id, stripe_payment_method_id, brand, last4,
         exp_month, exp_year, cardholder_name, is_business_card, created_by_user_id, is_default, created_at)
    VALUES
        (v_owner_type, v_user_id, v_card,  'pm_demo_' || left(v_card::text, 8),  'visa',       '4242',
         8, 2028, v_name, false, v_user_id,
         NOT EXISTS (SELECT 1 FROM finance.saved_cards WHERE owner_id = v_user_id AND owner_type = v_owner_type AND is_default),
         now() - make_interval(days => v_days)),
        (v_owner_type, v_user_id, v_card2, 'pm_demo_' || left(v_card2::text, 8), 'mastercard', '5454',
         2, 2027, v_name, true, v_user_id, false, now() - interval '40 days');
    -- #endregion

    -- #region Ledger — one movement stream, running balance computed in order, never negative
    CREATE TEMP TABLE _mv (at timestamptz, direction text, amount bigint, reason text, payout boolean)
        ON COMMIT DROP;

    -- Opening top-up from the card.
    INSERT INTO _mv VALUES (now() - make_interval(days => v_days) + interval '2 hours', 'credit', 50000, 'topup', false);

    -- Escrow releases roughly every 11 days, each followed by the 5% platform fee.
    INSERT INTO _mv
    SELECT t, 'credit', amt, 'escrow_release', false FROM (
        SELECT now() - make_interval(days => d) + make_interval(hours => 10 + (d % 7)) AS t,
               (45000 + ((d * 7919) % 180000))::bigint AS amt
          FROM generate_series(v_days - 6, 3, -11) AS d) s
    UNION ALL
    SELECT t + interval '1 minute', 'debit', round(amt * 0.05)::bigint, 'platform_fee', false FROM (
        SELECT now() - make_interval(days => d) + make_interval(hours => 10 + (d % 7)) AS t,
               (45000 + ((d * 7919) % 180000))::bigint AS amt
          FROM generate_series(v_days - 6, 3, -11) AS d) s;

    -- Digital product and small service sales, a few per month.
    INSERT INTO _mv
    SELECT now() - make_interval(days => d, hours => d % 11), 'credit',
           (1900 + ((d * 104729) % 6100))::bigint,
           CASE WHEN d % 3 = 0 THEN 'service_sale' ELSE 'product_sale' END, false
      FROM generate_series(v_days - 3, 1, -8) AS d;

    -- Things they bought on the platform, plus one refund.
    INSERT INTO _mv VALUES
        (now() - interval '131 days', 'debit', 12900, 'order_payment', false),
        (now() - interval '88 days',  'debit', 34500, 'order_payment', false),
        (now() - interval '81 days',  'credit', 4500, 'refund', false),
        (now() - interval '37 days',  'debit',  8900, 'order_payment', false),
        (now() - interval '9 days',   'debit', 21000, 'order_payment', false);

    -- Monthly top-ups (the recurring rule below continues these).
    INSERT INTO _mv
    SELECT now() - make_interval(days => d) + interval '9 hours', 'credit', 25000, 'topup', false
      FROM generate_series(v_days - 30, 1, -30) AS d;

    -- Monthly payouts to the bank, plus one instant payout with its fee.
    INSERT INTO _mv
    SELECT now() - make_interval(days => d) + interval '6 hours', 'debit', 0, 'payout', true
      FROM generate_series(v_days - 28, 5, -30) AS d;
    INSERT INTO _mv VALUES
        (now() - interval '52 days', 'debit', 60000, 'payout', true),
        (now() - interval '52 days' + interval '1 minute', 'debit', 900, 'instant_payout_fee', false);

    FOR r IN SELECT * FROM _mv ORDER BY at LOOP
        -- A scheduled payout (amount 0 above) sweeps 70% of the balance; any debit the balance
        -- cannot cover is skipped, so the ledger never goes negative.
        IF r.reason = 'payout' AND r.amount = 0 THEN r.amount := (v_bal * 0.7)::bigint; END IF;
        CONTINUE WHEN r.amount <= 0 OR (r.direction = 'debit' AND r.amount > v_bal);

        v_bal := v_bal + CASE WHEN r.direction = 'credit' THEN r.amount ELSE -r.amount END;

        INSERT INTO finance.transactions
            (wallet_id, direction, amount_cents, currency, reason, balance_after_cents, created_at,
             ref_table, fx_base)
        VALUES (v_wallet, r.direction, r.amount, v_currency, r.reason, v_bal, r.at,
                CASE WHEN r.payout THEN 'payouts' END, v_currency)
        RETURNING id INTO v_tx;

        IF r.payout THEN
            INSERT INTO finance.payouts
                (wallet_id, destination_method_id, amount_cents, currency, status, instant,
                 provider_ref, transaction_id, initiated_at, settled_at)
            VALUES (v_wallet, v_bank, r.amount, v_currency, 'paid', r.amount = 60000,
                    'po_demo_' || left(v_tx::text, 8), v_tx,
                    r.at, r.at + CASE WHEN r.amount = 60000 THEN interval '5 minutes' ELSE interval '2 days' END);
        END IF;
    END LOOP;

    UPDATE finance.wallets SET balance_cents = v_bal WHERE id = v_wallet;
    -- #endregion

    -- #region Upcoming — rules and in-flight money
    INSERT INTO finance.payout_schedules
        (id, owner_type, owner_id, mode, destination_method_id, currency, next_run_at, instant, active)
    VALUES (v_schedule, v_owner_type, v_user_id, 'scheduled_monthly', v_bank, v_currency,
            date_trunc('month', now()) + interval '1 month' + interval '9 hours', false, true)
    ON CONFLICT (owner_type, owner_id, currency) DO UPDATE
        SET mode = EXCLUDED.mode, destination_method_id = EXCLUDED.destination_method_id,
            next_run_at = EXCLUDED.next_run_at, active = true
    RETURNING id INTO v_schedule;

    INSERT INTO finance.deposit_rules (wallet_id, source_method_id, amount_cents, currency, interval, next_run_at)
    VALUES (v_wallet, v_card, 25000, v_currency, 'monthly', now() + interval '6 days'),
           (v_wallet, v_card2, 5000, v_currency, 'weekly',  now() + interval '2 days');

    -- A payout in flight (no ledger row until it settles) and one that failed last week.
    INSERT INTO finance.payouts
        (wallet_id, destination_method_id, schedule_id, amount_cents, currency, status, provider_ref, initiated_at)
    VALUES (v_wallet, v_bank, v_schedule, LEAST(40000, v_bal), v_currency, 'pending', 'po_demo_inflight', now() - interval '6 hours');

    INSERT INTO finance.payouts
        (wallet_id, destination_method_id, amount_cents, currency, status, failure_reason, provider_ref, initiated_at)
    VALUES (v_wallet, v_bank, 15000, v_currency, 'failed', 'Bank declined the transfer (account_closed)',
            'po_demo_failed', now() - interval '8 days');
    -- #endregion

    RAISE NOTICE 'Wallet % (%): % ledger rows, balance %',
        v_wallet, v_owner_type,
        (SELECT count(*) FROM finance.transactions WHERE wallet_id = v_wallet), v_bal;
END $$;