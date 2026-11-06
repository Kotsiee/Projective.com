-- =============================================================================================
-- populate_04_businesses.sql
--
-- Fills one account's Businesses: six new businesses, five of which the target belongs to, in the
-- states the product really has. Nothing seeded is changed, and the two seeded businesses are left
-- alone: the target is not added to Helia Finance or Atlas Labs.
--
--   Business               Target's seat                KYB         State / plan
--   Kestrel Freight    Owner                        verified    active, public, Business Pro,
--                                                                   monthly invoicing, balance just
--                                                                   above its floor
--   Ashgrove Supply Co.   Owner                        verified    archived, wallet at zero (a free
--                                                                   personal plan owns one live business,
--                                                                   so this is how the target owns two)
--   Almeida Coffee Co.     Admin + billing right        pending     active, unlisted, Business Free
--   Saltmarsh Provisions   Member (read-only money)     verified    active, public, Business Pro trial
--   Inkwell Press        Admin                        unverified  draft, invite-only, unfunded
--   Brightwater Cycles     pending invitation           verified    active, public, Business Free
--
-- Each one gets what the model allows: a roster with titles, roles, grants and an org chart;
-- invitations, an ask-to-join link and join requests; channels with messages and per-member read state;
-- a group conversation; a vault with a one-pass ledger and its audit trail; spending limits and
-- approvals; invoices, statements, a saved card, deposit rules; orders of published products; and the
-- projects it commissioned, with stages, hires, tickets, escrows, rooms and files.
--
-- A business cannot own listings (buyer-side, Decisions in documentation/database/catalogue/Tables.md),
-- so its "products" are what it bought: orders of seeded products, plus a basket.
--
-- Pages: /businesses · /businesses/[handle] and every tab (Overview, Calendar, Files, Channels,
-- Members, Invitations, Roles, Finance, Spend, Billing, Talent, Profile, Verification) · /wallet with a
-- business selected · /projects · /messages · /@[handle] for the public ones.
--
-- Run: open this file in Studio (localhost:54323) and press Run; the last result lists what is there.
-- Or: docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 < this-file
-- Another account: change the one username in the first statement below.
-- Twice is a no-op. Stands alone: it needs only the seeded world and the target account.
--
-- Known and deliberate: a released escrow or a product sale here pays a seeded persona or team, whose
-- wallet this script may not touch, so the payee's credit is absent; only the payer's side is booked.
-- No business reviews a persona here either: that review would move the persona's
-- seeded rating, so the Talent tab's rating column stays empty.
-- =============================================================================================

BEGIN;

-- ▼ TARGET ACCOUNT — change this one value to populate somebody else.
SELECT set_config('snippet.username', 'ahmed.kotzie-kotwal', true);

-- #region Shared helpers (session-temporary, byte-identical in every populate_* snippet)

/** The target account's id; refuses with a readable message when the username has no account. */
CREATE OR REPLACE FUNCTION pg_temp.me() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_id uuid;
BEGIN
    SELECT user_id INTO v_id
      FROM org.users_public
     WHERE username = current_setting('snippet.username');
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'No account has the username "%": sign up first, or edit the username at the top of this snippet.',
            current_setting('snippet.username');
    END IF;
    RETURN v_id;
END;
$$;

/** A stable uuid for a natural key, namespaced by the target account so two accounts never collide. */
CREATE OR REPLACE FUNCTION pg_temp.sid(p_key text) RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT (substr(h, 1, 12) || '4' || substr(h, 14, 3) || 'a' || substr(h, 18, 15))::uuid
      FROM (SELECT md5(pg_temp.me()::text || ':' || p_key) AS h) x;
$$;

/** A stable opaque slug in the shape the CHECKs want (`prj-…`, `stg-…`, `tkt-…`, `svc-…`). */
CREATE OR REPLACE FUNCTION pg_temp.slug(p_prefix text, p_key text) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT p_prefix || '-' || string_agg(
               substr('23456789abcdefghjkmnopqrstuvwxyz', 1 + get_byte(h, i) % 32, 1), '' ORDER BY i)
      FROM (SELECT decode(md5(p_prefix || ':' || pg_temp.me()::text || ':' || p_key), 'hex') AS h) x,
           generate_series(0, 9) AS i;
$$;

/** A seeded persona's user id, by username; refuses when the seed world is missing. */
CREATE OR REPLACE FUNCTION pg_temp.persona(p_username text) RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_id uuid;
BEGIN
    SELECT user_id INTO v_id FROM org.users_public WHERE username = p_username;
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'Seed persona "%" is missing: these snippets expect the seeded world from `deno task db:reset`.',
            p_username;
    END IF;
    RETURN v_id;
END;
$$;

/**
 * Backdates a brand-new account by eighteen months, so the history these snippets write does not
 * predate the person it belongs to. An account already that old is left alone.
 */
CREATE OR REPLACE FUNCTION pg_temp.ensure_tenure() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE org.users_public
       SET created_at = now() - interval '540 days'
     WHERE user_id = pg_temp.me() AND created_at > now() - interval '500 days';

    UPDATE org.freelancer_profiles
       SET created_at = now() - interval '540 days'
     WHERE user_id = pg_temp.me() AND created_at > now() - interval '500 days';
END;
$$;

/** Makes the target a freelancer: the flag, and a profile row when there is none. */
CREATE OR REPLACE FUNCTION pg_temp.ensure_freelancer() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE org.users_public
       SET is_freelancer = true
     WHERE user_id = pg_temp.me() AND NOT is_freelancer;

    INSERT INTO org.freelancer_profiles (user_id, skills)
    VALUES (pg_temp.me(), ARRAY['product']::text[])
    ON CONFLICT (user_id) DO NOTHING;
END;
$$;

/**
 * Makes the target payout-ready: KYC verified at tier 2 with its case, plus a verified payout account,
 * which is what `finance.fn_freelancer_payout_ready` and every earning door read.
 */
CREATE OR REPLACE FUNCTION pg_temp.ensure_verified() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_temp.ensure_freelancer();

    UPDATE org.freelancer_profiles
       SET kyc_status = 'verified',
           kyc_tier = 2,
           kyc_verified_at = COALESCE(kyc_verified_at, now() - interval '330 days'),
           payout_ready = true,
           identity_provider_ref = COALESCE(identity_provider_ref, 'vs_snippet_' || pg_temp.me())
     WHERE user_id = pg_temp.me();

    INSERT INTO finance.verification_cases
        (id, subject_type, subject_id, kind, status, tier, provider, provider_ref, submitted_at, decided_at)
    VALUES
        (pg_temp.sid('kyc'), 'freelancer', pg_temp.me(), 'kyc', 'verified', 2, 'stripe_identity',
         'vs_snippet_' || pg_temp.me(), now() - interval '331 days', now() - interval '330 days')
    ON CONFLICT (id) DO NOTHING;

    -- One live account per provider: one that exists is verified in place, otherwise one is added.
    UPDATE finance.payout_accounts
       SET status = 'verified'
     WHERE owner_type = 'freelancer' AND owner_id = pg_temp.me() AND provider = 'stripe'
       AND status <> 'disabled';

    INSERT INTO finance.payout_accounts (id, owner_type, owner_id, provider, account_id, status)
    SELECT pg_temp.sid('payout-account'), 'freelancer', pg_temp.me(), 'stripe',
           'acct_snippet_' || replace(pg_temp.me()::text, '-', ''), 'verified'
     WHERE NOT EXISTS (
         SELECT 1 FROM finance.payout_accounts a
          WHERE a.owner_type = 'freelancer' AND a.owner_id = pg_temp.me() AND a.provider = 'stripe'
            AND a.status <> 'disabled'
     );
END;
$$;

/** The wallet of an owner in a currency, created empty on first use. */
CREATE OR REPLACE FUNCTION pg_temp.wallet(p_owner_type text, p_owner_id uuid, p_currency text DEFAULT 'USD')
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
    v_id uuid;
BEGIN
    SELECT id INTO v_id
      FROM finance.wallets
     WHERE owner_type = p_owner_type AND owner_id = p_owner_id AND currency = p_currency;
    IF v_id IS NULL THEN
        INSERT INTO finance.wallets (owner_type, owner_id, currency)
        VALUES (p_owner_type, p_owner_id, p_currency)
        RETURNING id INTO v_id;
    END IF;
    RETURN v_id;
END;
$$;

/**
 * Appends one ledger row and moves the wallet's balance with it; a key already posted is a no-op, so
 * a re-run cannot double-count. The ledger is append-only, so call this in chronological order per
 * wallet: `balance_after_cents` is a running balance over the order of the calls.
 */
CREATE OR REPLACE FUNCTION pg_temp.post(
    p_key text,
    p_wallet uuid,
    p_direction text,
    p_amount_cents bigint,
    p_reason text,
    p_at timestamptz,
    p_ref_table text DEFAULT NULL,
    p_ref_id uuid DEFAULT NULL,
    p_fund_state finance.fund_state DEFAULT 'available'
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
    v_id uuid := pg_temp.sid('tx:' || p_key);
    v_balance bigint;
    v_currency text;
BEGIN
    IF EXISTS (SELECT 1 FROM finance.transactions WHERE id = v_id) THEN
        RETURN v_id;
    END IF;

    UPDATE finance.wallets
       SET balance_cents = balance_cents
           + CASE p_direction WHEN 'credit' THEN p_amount_cents ELSE -p_amount_cents END
     WHERE id = p_wallet
    RETURNING balance_cents, currency INTO v_balance, v_currency;

    INSERT INTO finance.transactions
        (id, wallet_id, direction, amount_cents, currency, reason, ref_table, ref_id,
         balance_after_cents, fund_state, created_at)
    VALUES
        (v_id, p_wallet, p_direction, p_amount_cents, v_currency, p_reason, p_ref_table, p_ref_id,
         v_balance, p_fund_state, p_at);
    RETURN v_id;
END;
$$;

SELECT pg_temp.ensure_tenure();

-- #endregion

SELECT pg_temp.ensure_verified();

-- #region Script helpers
/** This script's ids: every natural key is namespaced, so another populate_* snippet never collides. */
CREATE OR REPLACE FUNCTION pg_temp.b4(p_key text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT pg_temp.sid('b4:' || p_key) $$;

CREATE OR REPLACE FUNCTION pg_temp.b4_ago(p_days numeric) RETURNS timestamptz
LANGUAGE sql STABLE AS $$ SELECT now() - p_days * interval '1 day' $$;

/** A person by world key: `me` is the target, anything else a seed persona. */
CREATE OR REPLACE FUNCTION pg_temp.b4_who(p text) RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN p IS NULL THEN NULL WHEN p = 'me' THEN pg_temp.me() ELSE pg_temp.persona(p) END
$$;

/** A globally unique handle or suffix, so a second account does not collide. */
CREATE OR REPLACE FUNCTION pg_temp.b4_handle(p_base text) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT p_base || '-' || substr(pg_temp.me()::text, 1, 4) $$;

/** An entity channel of one of these businesses, by slug (`general` is minted by the entity trigger). */
CREATE OR REPLACE FUNCTION pg_temp.b4_thread(p_biz text, p_slug text) RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT t.id FROM comms.dm_threads t
     WHERE t.kind = 'entity_channel' AND t.owner_type = 'business'
       AND t.owner_entity_id = pg_temp.b4('biz:' || p_biz) AND t.slug = p_slug AND t.archived_at IS NULL
$$;

/**
 * Where billing period k ends, k = 1 being the last closed one. The billing day is set six days back,
 * so the latest invoice is always a few days old and inside its 14 days to pay, whenever this is run.
 */
CREATE OR REPLACE FUNCTION pg_temp.b4_period_end(p_k int) RETURNS timestamptz
LANGUAGE sql STABLE AS $$
    SELECT ((date_trunc('month', d) + (LEAST(extract(day from d)::int, 28) - 1) * interval '1 day')
            - (p_k - 1) * interval '1 month') AT TIME ZONE 'UTC'
      FROM (SELECT (now() AT TIME ZONE 'UTC') - interval '6 days' AS d) x
$$;

/** The 5% fee, floored, as `platformFeeFor` and every SQL fee path do. */
CREATE OR REPLACE FUNCTION pg_temp.b4_fee(p_amount bigint) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$ SELECT (p_amount * 500 / 10000)::bigint $$;
-- #endregion

-- #region The world: businesses and rosters
DROP TABLE IF EXISTS pg_temp.b4_biz;
CREATE TEMP TABLE b4_biz ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('hf', 'Kestrel Freight', 'kestrel-freight', 'me', 'Kestrel Freight FZ-LLC',
     'United Arab Emirates', 'Dubai', 'Unit 14, Jebel Ali Free Zone South', '17000', 'Asia/Dubai',
     'accounts@kestrelfreight.example', 'pro',
     'Mid-market freight forwarding between the Gulf, East Africa and South Asia',
     'Kestrel moves containers and project cargo for mid-sized importers. We keep a small core team and bring in independent designers and engineers for every piece of product work.',
     ARRAY['English', 'Arabic'], 'AE 100 4872 6190 003', 'intervaled_monthly', 'from_wallet',
     600000::bigint, 500000::bigint, 'active', 'verified', 'public', 420, 405,
     'Lumen Bank — logo', 'Live operations board — cover'),
    ('tw', 'Ashgrove Supply Co.', 'ashgrove-supply', 'me', 'Ashgrove Supply Co. LLC',
     'United Arab Emirates', 'Sharjah', 'Warehouse 6, Sajaa Industrial Area', '61000', 'Asia/Dubai',
     'billing@ashgrovesupply.example', 'free',
     'Marine spares distribution, wound down after the sale of the catalogue',
     'Ashgrove distributed marine spares across the lower Gulf. The catalogue was sold on and the business is closed to new work.',
     ARRAY['English'], 'AE 100 3391 2284 007', 'per_transaction', 'off',
     NULL, NULL, 'archived', 'verified', 'public', 500, 490,
     NULL, NULL),
    ('ac', 'Almeida Coffee Co.', 'almeida-coffee', 'theo', 'Almeida Coffee Co. Lda',
     'Portugal', 'Porto', 'Rua de Santa Catarina 212', '4000-442', 'Europe/Lisbon',
     'contas@almeidacoffee.example', 'free',
     'Small-batch coffee roaster with three cafés and a growing wholesale line',
     'We roast in Porto and sell through our own cafés and a growing list of restaurants. We hire independent studios for brand, packaging and the web.',
     ARRAY['Portuguese', 'English'], 'PT 509 442 871', 'per_transaction', 'off',
     NULL, NULL, 'active', 'pending', 'unlisted', 130, NULL,
     'Almeida Coffee Co. identity — cover', NULL),
    ('sp', 'Saltmarsh Provisions', 'saltmarsh-provisions', 'hannahcole', 'Saltmarsh Provisions Ltd',
     'United Kingdom', 'Whitstable', '3 Harbour Street', 'CT5 1AH', 'Europe/London',
     'finance@saltmarshprovisions.example', 'pro',
     'Chilled and ambient fine foods for independent grocers',
     'Saltmarsh supplies chilled and ambient fine foods to around four hundred independent shops. Our outside teams handle packaging, cold-chain software and everything between.',
     ARRAY['English'], 'GB 412 7781 09', 'per_transaction', 'add_to_basket',
     250000::bigint, 300000::bigint, 'active', 'verified', 'public', 225, 215,
     'Halcyon Motion — logo', 'Packaging in 3D — cover'),
    ('fp', 'Inkwell Press', 'inkwell-press', 'noor', NULL,
     NULL, NULL, NULL, NULL, 'Asia/Dubai',
     NULL, 'free', '', NULL,
     ARRAY[]::text[], NULL, 'per_transaction', 'off',
     NULL, NULL, 'draft', 'unverified', 'invite_only', 9, NULL,
     NULL, NULL),
    ('bw', 'Brightwater Cycles', 'brightwater-cycles', 'miguelsantos', 'Brightwater Cycles BV',
     'Netherlands', 'Utrecht', 'Vredenburg 40', '3511 BD', 'Europe/Amsterdam',
     'admin@brightwatercycles.example', 'free',
     'Direct-to-rider cargo bikes, assembled in Utrecht',
     'Brightwater designs and assembles cargo bikes in Utrecht and sells them directly to riders across the Benelux.',
     ARRAY['Dutch', 'English'], 'NL 8621 44 019 B01', 'per_transaction', 'off',
     NULL, NULL, 'active', 'verified', 'public', 170, 160,
     NULL, NULL)
) AS v(key, name, base, owner, legal, country, city, address, zip, tz, email, plan, headline, bio,
       languages, tax, invoicing, auto_fund, floor, threshold, status, kyb, visibility, created_d,
       verified_d, logo, banner);

DROP TABLE IF EXISTS pg_temp.b4_roles;
CREATE TEMP TABLE b4_roles ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('hf', 'pm', 'Project Manager', 'Creates projects, hires and approves work, and funds escrow within a spending limit.',
     ARRAY['contribute_funds', 'manage_projects', 'hire', 'spend_funds', 'purchase', 'view_analytics']),
    ('hf', 'observer', 'Observer', 'Reads progress and analytics; changes, approves and pays for nothing.',
     ARRAY['view_analytics']),
    ('sp', 'pm', 'Project Manager', 'Creates projects, hires and approves work, and funds escrow within a spending limit.',
     ARRAY['contribute_funds', 'manage_projects', 'hire', 'spend_funds', 'purchase', 'view_analytics'])
) AS v(biz, key, name, summary, caps);

-- `role` is a preset or one of the custom keys above. Ages keep every join after the persona signed up.
DROP TABLE IF EXISTS pg_temp.b4_members;
CREATE TEMP TABLE b4_members ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('hf', 'me', 'owner', 'Founder and CEO', NULL, ARRAY[]::text[], 420),
    ('hf', 'priyaraman', 'admin', 'Operations Director', 'me', ARRAY[]::text[], 250),
    ('hf', 'danielokafor', 'member', 'Finance Operations', 'priyaraman', ARRAY['spend_funds', 'purchase'], 225),
    ('hf', 'miguelsantos', 'pm', 'Delivery Lead', 'priyaraman', ARRAY[]::text[], 185),
    ('hf', 'noor', 'observer', 'Brand Advisor', 'me', ARRAY[]::text[], 160),

    ('tw', 'me', 'owner', 'Managing Partner', NULL, ARRAY[]::text[], 500),
    ('tw', 'miguelsantos', 'member', 'Procurement', 'me', ARRAY[]::text[], 180),

    ('ac', 'theo', 'owner', 'Founder', NULL, ARRAY[]::text[], 130),
    ('ac', 'me', 'admin', 'Head of Digital', 'theo', ARRAY['manage_billing'], 125),
    ('ac', 'noor', 'member', 'Creative Director', 'theo', ARRAY[]::text[], 90),
    ('ac', 'chloewinters', 'member', 'Brand Copy', 'me', ARRAY[]::text[], 10),

    ('sp', 'hannahcole', 'owner', 'Managing Director', NULL, ARRAY[]::text[], 225),
    ('sp', 'danielokafor', 'admin', 'Commercial Director', 'hannahcole', ARRAY[]::text[], 215),
    ('sp', 'miguelsantos', 'pm', 'Project Lead', 'danielokafor', ARRAY[]::text[], 180),
    ('sp', 'me', 'member', 'Supply Chain Analyst', 'danielokafor', ARRAY[]::text[], 170),
    ('sp', 'lenamueller', 'member', 'Customer Research', 'hannahcole', ARRAY[]::text[], 150),

    ('fp', 'noor', 'owner', 'Publisher', NULL, ARRAY[]::text[], 9),
    ('fp', 'me', 'admin', 'Co-founder', 'noor', ARRAY[]::text[], 8),

    ('bw', 'miguelsantos', 'owner', 'Founder', NULL, ARRAY[]::text[], 170),
    ('bw', 'danielokafor', 'admin', 'Commercial Lead', 'miguelsantos', ARRAY[]::text[], 160)
) AS v(biz, who, role, title, boss, grants, joined_d);
-- #endregion

-- #region Businesses, roles, roster
INSERT INTO org.business_profiles
    (id, owner_user_id, name, slug, legal_name, logo_file_id, banner_file_id, country, billing_email, plan,
     headline, bio, languages, timezone, default_currency, tax_id, address_line_1, address_city, address_zip,
     invoicing_mode, billing_day, auto_fund_mode, low_balance_floor_cents, status, kyb_status, kyb_verified_at,
     kyb_provider_ref, visibility, created_at)
SELECT pg_temp.b4('biz:' || b.key), pg_temp.b4_who(b.owner), b.name, pg_temp.b4_handle(b.base), b.legal,
       (SELECT i.id FROM files.items i WHERE i.display_name = b.logo AND i.visibility = 'public' LIMIT 1),
       (SELECT i.id FROM files.items i WHERE i.display_name = b.banner AND i.visibility = 'public' LIMIT 1),
       b.country, b.email, b.plan, b.headline,
       CASE WHEN b.bio IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('text', b.bio) END,
       b.languages, b.tz, 'USD', b.tax, b.address, b.city, b.zip, b.invoicing,
       CASE WHEN b.invoicing = 'intervaled_monthly'
            THEN LEAST(extract(day from now() - interval '6 days')::int, 28)::smallint END,
       b.auto_fund, b.floor, b.status, b.kyb::finance.kyc_status, pg_temp.b4_ago(b.verified_d),
       CASE WHEN b.kyb <> 'unverified' THEN 'acct_snippet_' || replace(pg_temp.b4('kyb:' || b.key)::text, '-', '') END,
       b.visibility, pg_temp.b4_ago(b.created_d)
  FROM b4_biz b
ON CONFLICT (id) DO NOTHING;

-- The presets are exactly what the create door writes, so they come from the same function.
SELECT count(org.fn_seed_preset_roles('business', pg_temp.b4('biz:' || b.key))) AS preset_roles
  FROM b4_biz b
 WHERE NOT EXISTS (SELECT 1 FROM org.business_roles r WHERE r.business_id = pg_temp.b4('biz:' || b.key));

INSERT INTO org.business_roles (id, business_id, name, summary, preset, base_preset, capabilities)
SELECT pg_temp.b4('role:' || r.biz || ':' || r.key), pg_temp.b4('biz:' || r.biz), r.name, r.summary, NULL, 'member',
       r.caps::org.workspace_capability[]
  FROM b4_roles r
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.business_members
    (id, business_id, user_id, role_id, role, status, invited_by, title, granted_capabilities, reports_to,
     joined_at, created_at)
SELECT pg_temp.b4('member:' || m.biz || ':' || m.who), pg_temp.b4('biz:' || m.biz), pg_temp.b4_who(m.who),
       COALESCE((SELECT r.id FROM org.business_roles r
                  WHERE r.business_id = pg_temp.b4('biz:' || m.biz) AND r.preset = m.role),
                pg_temp.b4('role:' || m.biz || ':' || m.role)),
       'member', 'active',
       CASE WHEN m.role <> 'owner' THEN pg_temp.b4_who((SELECT b.owner FROM b4_biz b WHERE b.key = m.biz)) END,
       m.title, m.grants::org.workspace_capability[],
       CASE WHEN m.boss IS NOT NULL THEN pg_temp.b4('member:' || m.biz || ':' || m.boss) END,
       pg_temp.b4_ago(m.joined_d), pg_temp.b4_ago(m.joined_d)
  FROM b4_members m
ON CONFLICT (id) DO NOTHING;

-- The trail org.fn_workspace_restore_target reads: a published business restores to active.
INSERT INTO security.audit_logs (id, user_id, action, entity_table, entity_id, metadata, created_at)
SELECT pg_temp.b4('audit:' || b.key || ':' || t.to_status), pg_temp.b4_who(b.owner), 'business.status_changed',
       'org.business_profiles', pg_temp.b4('biz:' || b.key),
       jsonb_build_object('from', t.from_status, 'to', t.to_status), pg_temp.b4_ago(t.d)
  FROM b4_biz b
 CROSS JOIN LATERAL (VALUES
        ('draft', 'active', b.created_d - 1),
        ('active', 'archived', CASE WHEN b.status = 'archived' THEN 45 END)) AS t(from_status, to_status, d)
 WHERE b.status <> 'draft' AND t.d IS NOT NULL
ON CONFLICT (id) DO NOTHING;

SELECT org.fn_refresh_membership_flags(pg_temp.me());

INSERT INTO finance.verification_cases
    (id, subject_type, subject_id, kind, status, tier, provider, provider_ref, submitted_at, decided_at, notes)
SELECT pg_temp.b4('kyb:' || b.key), 'business', pg_temp.b4('biz:' || b.key), 'kyb', b.kyb::finance.kyc_status, 3,
       'stripe_identity', 'acct_snippet_' || replace(pg_temp.b4('kyb:' || b.key)::text, '-', ''),
       COALESCE(pg_temp.b4_ago(b.verified_d + 6), pg_temp.b4_ago(11)), pg_temp.b4_ago(b.verified_d),
       CASE WHEN b.kyb = 'pending' THEN 'Trade registry extract under review.' END
  FROM b4_biz b
 WHERE b.kyb <> 'unverified'
ON CONFLICT (id) DO NOTHING;

-- A Connect account is what the Verification tab reads: none on the draft, in review on the pending one.
INSERT INTO finance.payout_accounts (id, owner_type, owner_id, provider, account_id, status, created_at)
SELECT pg_temp.b4('payout-account:' || b.key), 'business', pg_temp.b4('biz:' || b.key), 'stripe',
       'acct_snippet_' || replace(pg_temp.b4('kyb:' || b.key)::text, '-', ''),
       CASE b.kyb WHEN 'verified' THEN 'verified' ELSE 'pending_verification' END,
       COALESCE(pg_temp.b4_ago(b.verified_d + 6), pg_temp.b4_ago(11))
  FROM b4_biz b
 WHERE b.kyb <> 'unverified'
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.subscriptions
    (id, profile_id, subject_type, subject_id, plan_id, state, billing_interval, current_period_start,
     current_period_end, trial_ends_at, ends_at, price_cents, currency, provider_ref, started_at)
SELECT pg_temp.b4('subscription:' || s.biz), pg_temp.b4('biz:' || s.biz), 'business', pg_temp.b4('biz:' || s.biz),
       (SELECT p.id FROM finance.plans p WHERE p.code = 'business_pro'),
       s.state::finance.subscription_state, s.cycle::finance.billing_interval,
       pg_temp.b4_ago(s.period_start_d), pg_temp.b4_ago(s.period_end_d), pg_temp.b4_ago(s.trial_end_d),
       pg_temp.b4_ago(s.end_d), s.price, 'GBP',
       'sub_snippet_' || replace(pg_temp.b4('subscription:' || s.biz)::text, '-', ''), pg_temp.b4_ago(s.started_d)
  FROM (VALUES
        ('hf', 'active', 'annual', 80, -285, NULL::int, NULL::int, 38000::bigint, 400),
        ('sp', 'trialing', 'monthly', 20, -10, -10, NULL, 3900, 20),
        ('tw', 'cancelled', 'monthly', 75, 45, NULL, 45, 3900, 480)
       ) AS s(biz, state, cycle, period_start_d, period_end_d, trial_end_d, end_d, price, started_d)
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.org_invitations
    (id, inviter_user_id, target_user_id, target_handle, target_email, business_id, business_role_id, token, note,
     status, expires_at, created_at)
SELECT pg_temp.b4('invite:' || i.biz || ':' || i.key), pg_temp.b4_who(i.by_who), pg_temp.b4_who(i.target),
       CASE WHEN i.target = 'me' THEN current_setting('snippet.username') ELSE i.target END,
       CASE WHEN i.email IS NOT NULL THEN i.email || '.' || substr(pg_temp.me()::text, 1, 4) || '.example' END,
       pg_temp.b4('biz:' || i.biz),
       (SELECT r.id FROM org.business_roles r WHERE r.business_id = pg_temp.b4('biz:' || i.biz) AND r.preset = i.role),
       pg_temp.b4('invite-token:' || i.biz || ':' || i.key)::text, i.note, 'pending',
       now() + i.expires_in * interval '1 day', pg_temp.b4_ago(i.d)
  FROM (VALUES
        ('hf', 'chloe', 'me', 'chloewinters', NULL, 'member', 'We need a steady hand on customer emails and the portal copy. Would you join us?', 3, 11),
        ('hf', 'finance', 'priyaraman', NULL, 'controller@kestrelfreight', 'admin', 'Controller role, as we discussed. This gets you into the wallet and the approvals queue.', 2, 12),
        ('ac', 'aiko', 'me', 'aikotanaka', NULL, 'member', 'You drew our first bag. Join us so the packaging decisions are in one place?', 4, 10),
        ('sp', 'samuel', 'hannahcole', 'samuelnkemelu', NULL, 'member', 'You know the warehouse app better than anyone. Would you sit in with us?', 2, 12),
        ('fp', 'chloe', 'noor', 'chloewinters', NULL, 'member', 'We are starting a small press and we need your ear for words.', 1, 13),
        ('bw', 'me', 'miguelsantos', 'me', NULL, 'admin', 'We are hiring outside studios for the next bike launch and could use your eye on the spend. Join us?', 2, 12)
       ) AS i(biz, key, by_who, target, email, role, note, d, expires_in)
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.org_invite_links (id, business_id, business_role_id, token, status, created_by, created_at)
SELECT pg_temp.b4('link:' || l.biz), pg_temp.b4('biz:' || l.biz),
       (SELECT r.id FROM org.business_roles r WHERE r.business_id = pg_temp.b4('biz:' || l.biz) AND r.preset = 'member'),
       'w-' || substr(md5('b4-link:' || pg_temp.me() || l.biz) || md5('b4-link2:' || pg_temp.me() || l.biz), 1, 24),
       'active', pg_temp.b4_who(l.by_who), pg_temp.b4_ago(l.d)
  FROM (VALUES ('hf', 'priyaraman', 60), ('ac', 'me', 21)) AS l(biz, by_who, d)
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.org_join_requests
    (id, business_id, requester_user_id, invite_link_id, business_role_id, message, status, created_at)
SELECT pg_temp.b4('join:' || j.biz || ':' || j.who), pg_temp.b4('biz:' || j.biz), pg_temp.b4_who(j.who),
       CASE WHEN j.via_link THEN pg_temp.b4('link:' || j.biz) END,
       (SELECT r.id FROM org.business_roles r WHERE r.business_id = pg_temp.b4('biz:' || j.biz) AND r.preset = 'member'),
       j.message, 'pending', pg_temp.b4_ago(j.d)
  FROM (VALUES
        ('hf', 'juno', true, 'Priya shared the link. I am building the portal front end with North Loop and it would help to see the business side.', 2),
        ('hf', 'lenamueller', false, 'I ran the discovery interviews for the carrier work and would like to stay close to the research.', 5),
        ('ac', 'inesduarte', true, 'Happy to look after the packaging decisions from inside if that helps.', 1)
       ) AS j(biz, who, via_link, message, d)
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Vault wallets and instruments
INSERT INTO finance.wallets (id, owner_type, owner_id, currency, approval_threshold_cents, created_at)
SELECT pg_temp.b4('wallet:' || b.key), 'business', pg_temp.b4('biz:' || b.key), 'USD', b.threshold,
       pg_temp.b4_ago(b.created_d)
  FROM b4_biz b
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.payment_methods
    (id, owner_type, owner_id, method_role, provider, external_ref, label, brand, last4, is_default_funding,
     is_default_payout, status, created_at)
SELECT pg_temp.b4('pm:' || c.biz), 'business', pg_temp.b4('biz:' || c.biz), 'funding', 'stripe',
       'pm_snippet_' || replace(pg_temp.b4('pm:' || c.biz)::text, '-', ''),
       c.holder || ' — ' || c.brand || ' ' || c.last4, c.brand, c.last4, true, false, 'active', pg_temp.b4_ago(c.d)
  FROM (VALUES
        ('hf', 'Kestrel Freight', 'visa', '4242', 8, 2029, 400),
        ('tw', 'Ashgrove Supply Co.', 'mastercard', '4444', 3, 2027, 495),
        ('ac', 'Almeida Coffee Co.', 'visa', '1881', 11, 2028, 120),
        ('sp', 'Saltmarsh Provisions', 'mastercard', '8210', 6, 2028, 220),
        ('bw', 'Brightwater Cycles', 'amex', '0005', 2, 2029, 165)
       ) AS c(biz, holder, brand, last4, exp_month, exp_year, d)
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.saved_cards
    (id, owner_type, owner_id, payment_method_id, stripe_payment_method_id, brand, last4, exp_month, exp_year,
     cardholder_name, is_business_card, created_by_user_id, is_default, created_at)
SELECT pg_temp.b4('card:' || c.biz), 'business', pg_temp.b4('biz:' || c.biz), pg_temp.b4('pm:' || c.biz),
       'pm_snippet_' || replace(pg_temp.b4('pm:' || c.biz)::text, '-', ''), c.brand::finance.card_brand, c.last4,
       c.exp_month, c.exp_year, c.holder, true, pg_temp.b4_who(c.who), true, pg_temp.b4_ago(c.d)
  FROM (VALUES
        ('hf', 'Kestrel Freight', 'visa', '4242', 8, 2029, 'me', 400),
        ('tw', 'Ashgrove Supply Co.', 'mastercard', '4444', 3, 2027, 'me', 495),
        ('ac', 'Almeida Coffee Co.', 'visa', '1881', 11, 2028, 'theo', 120),
        ('sp', 'Saltmarsh Provisions', 'mastercard', '8210', 6, 2028, 'hannahcole', 220),
        ('bw', 'Brightwater Cycles', 'amex', '0005', 2, 2029, 'miguelsantos', 165)
       ) AS c(biz, holder, brand, last4, exp_month, exp_year, who, d)
ON CONFLICT (id) DO NOTHING;

-- The company record the business checkout reads, keyed as the checkout writes it.
INSERT INTO finance.buyer_details
    (id, context_id, context_kind, owner_type, owner_id, delivery_first_name, delivery_last_name, delivery_email,
     personal_name, personal_phone, business_company_name, business_registration_number, business_tax_id,
     business_corporate_email, business_phone, business_address_line_1, business_address_city,
     business_address_postcode, business_address_country, created_at, updated_at)
SELECT pg_temp.b4('buyer:' || d.biz), 'business:' || pg_temp.b4('biz:' || d.biz), 'business', 'business',
       pg_temp.b4('biz:' || d.biz), d.first, d.last, d.first || '.' || d.last || '@' || d.domain, '', '',
       b.legal, d.reg, b.tax, b.email, d.phone, b.address, b.city, b.zip, b.country,
       pg_temp.b4_ago(30), pg_temp.b4_ago(30)
  FROM (VALUES
        ('hf', 'Priya', 'Raman', 'kestrelfreight.example', 'FZ-44127', '+971 4 555 0142'),
        ('sp', 'Hannah', 'Cole', 'saltmarshprovisions.example', '11872204', '+44 20 7946 0188')
       ) AS d(biz, first, last, domain, reg, phone)
  JOIN b4_biz b ON b.key = d.biz
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.deposit_rules
    (id, wallet_id, source_method_id, amount_cents, currency, interval, next_run_at, active, created_by, archived_at, created_at)
SELECT pg_temp.b4('deposit:' || r.biz || ':' || r.interval), pg_temp.b4('wallet:' || r.biz), pg_temp.b4('pm:' || r.biz),
       r.amount, 'USD', r.interval::finance.deposit_interval,
       CASE WHEN r.interval = 'below_floor' THEN 'infinity'::timestamptz ELSE now() + r.next_in * interval '1 day' END,
       r.active, pg_temp.b4_who(r.who), NULL, pg_temp.b4_ago(r.d)
  FROM (VALUES
        ('hf', 'monthly', 1000000::bigint, 12, true, 'me', 8),
        ('hf', 'below_floor', 800000, NULL, true, 'me', 60),
        ('ac', 'weekly', 50000, 4, false, 'me', 40),
        ('sp', 'monthly', 500000, 18, true, 'hannahcole', 14)
       ) AS r(biz, interval, amount, next_in, active, who, d)
ON CONFLICT (id) DO NOTHING;

-- Ceilings are Business Pro's, so only the two Pro vaults carry any.
INSERT INTO finance.spending_limits
    (id, wallet_id, member_user_id, cap_cents, per_transaction_cents, period_interval, spent_cents, resets_at)
SELECT pg_temp.b4('limit:' || l.biz || ':' || l.who), pg_temp.b4('wallet:' || l.biz), pg_temp.b4_who(l.who),
       l.cap, l.per_tx, l.period, l.spent,
       CASE l.period WHEN 'monthly' THEN date_trunc('month', now()) + interval '1 month'
                     WHEN 'weekly' THEN date_trunc('week', now()) + interval '1 week' END
  FROM (VALUES
        ('hf', 'priyaraman', 2500000::bigint, 1000000::bigint, 'monthly', 840000::bigint),
        ('hf', 'miguelsantos', 1500000, 500000, 'monthly', 1280000),
        ('hf', 'danielokafor', 200000, 100000, 'weekly', 190000),
        ('sp', 'miguelsantos', 1000000, 400000, 'monthly', 600000),
        ('sp', 'danielokafor', NULL, 800000, 'total', 0)
       ) AS l(biz, who, cap, per_tx, period, spent)
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region The world: projects
DROP TABLE IF EXISTS pg_temp.b4_projects;
CREATE TEMP TABLE b4_projects ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('hf-portal', 'hf', 'Carrier portal rebuild', 'pipeline', 'standard', 'active', 'public', 'me', 200, 0.3,
     'Replace the spreadsheet-and-email carrier process with a self-serve portal: booking, live tracking, rate cards and proof of delivery.'),
    ('hf-guide', 'hf', 'Driver onboarding guide', 'one_off', 'one_off', 'completed', 'public', 'priyaraman', 150, 70,
     'A short illustrated guide that takes a new owner-driver through their first week with us, in English and Arabic.'),
    ('hf-signage', 'hf', 'Warehouse signage system', 'pipeline', 'standard', 'on_hold', 'invite_only', 'miguelsantos', 90, 8,
     'A wayfinding and safety signage family for the Jebel Ali warehouse, held until the racking contractor finishes.'),
    ('hf-dataroom', 'hf', 'Investor data room', 'one_off', 'one_off', 'cancelled', 'invite_only', 'danielokafor', 88, 80,
     'A structured data room for the Series A conversations. Cancelled when the round moved to the investor''s own tooling.'),
    ('hf-customs', 'hf', 'Customs paperwork assistant', 'pipeline', 'standard', 'draft', 'unlisted', 'me', 6, 1,
     'Pre-fill bills of entry from booking data so the desk only checks exceptions.'),
    ('tw-catalogue', 'tw', 'Supplier catalogue migration', 'pipeline', 'standard', 'completed', 'public', 'me', 175, 60,
     'Clean nine thousand spare-part records and hand them to the buyer of the catalogue in their schema.'),
    ('ac-packaging', 'ac', 'Seasonal packaging refresh', 'pipeline', 'standard', 'active', 'public', 'me', 34, 3,
     'A new bag and carton range for the autumn single-origin releases, across three sizes.'),
    ('ac-loyalty', 'ac', 'Cafe loyalty microsite', 'one_off', 'single_stage', 'active', 'invite_only', 'theo', 26, 2,
     'A small site where regulars check their stamps and hear about new roasts first.'),
    ('sp-dashboard', 'sp', 'Cold-chain dashboard', 'pipeline', 'standard', 'active', 'public', 'hannahcole', 130, 1,
     'One screen for every chilled delivery: temperature, ETA and the shops about to run out.'),
    ('sp-relaunch', 'sp', 'Packaging line relaunch', 'one_off', 'one_off', 'completed', 'public', 'miguelsantos', 160, 100,
     'New labels and shelf-ready trays for the ambient range ahead of the spring trade shows.')
) AS v(key, biz, title, format, structure, status, visibility, owner, created_d, activity_d, summary);

DROP TABLE IF EXISTS pg_temp.b4_stages;
CREATE TEMP TABLE b4_stages ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('hf-portal', 's1', 1, 'Discovery and service map', 'Interview the booking desk and six carriers, then map the journey from quote to proof of delivery.', 'paid', 480000::bigint, ARRAY['ux-research', 'service-design'], 165, NULL::int),
    ('hf-portal', 's2', 2, 'Portal design system', 'Tokens, components and page templates the build can assemble from.', 'paid', 720000, ARRAY['design-systems', 'ui-design'], 120, NULL),
    ('hf-portal', 's3', 3, 'Shipment tracking build', 'The carrier-facing tracking, alerts and rate-card features.', 'in_progress', 960000, ARRAY['typescript', 'postgres'], NULL, 12),
    ('hf-portal', 's4', 4, 'Launch and handover', 'Run the pilot with five carriers, write the runbook and train the desk.', 'open', 300000, ARRAY['technical-writing'], NULL, 34),
    ('hf-guide', 's1', 1, 'Write, illustrate and lay out', 'Twenty pages in two language editions, for print and for the driver app.', 'paid', 650000, ARRAY['editorial-design', 'illustration'], 70, NULL),
    ('hf-signage', 's1', 1, 'Wayfinding concepts', 'Three directions for zones, bays and safety notices.', 'paid', 240000, ARRAY['illustration', 'wayfinding'], 45, NULL),
    ('hf-signage', 's2', 2, 'Signage artwork', 'Print-ready artwork for the chosen direction.', 'in_progress', 360000, ARRAY['editorial-design'], NULL, 20),
    ('hf-signage', 's3', 3, 'Installation drawings', 'Placement drawings for the contractor.', 'open', 150000, ARRAY['wayfinding'], NULL, NULL),
    ('hf-dataroom', 's1', 1, 'Data room structure', 'Index, templates and a redaction pass.', 'cancelled', 180000, ARRAY['technical-writing'], NULL, NULL),
    ('hf-customs', 's1', 1, 'Field mapping', 'Map booking fields to the bill of entry.', 'open', 800000, ARRAY['postgres'], NULL, NULL),
    ('hf-customs', 's2', 2, 'Exception review screen', 'A desk view of what the assistant could not fill.', 'open', 450000, ARRAY['ui-design'], NULL, NULL),
    ('tw-catalogue', 's1', 1, 'Data audit', 'Profile the part records and agree the target schema with the buyer.', 'paid', 500000, ARRAY['postgres'], 130, NULL),
    ('tw-catalogue', 's2', 2, 'Import and QA', 'Transform, import and reconcile against the buyer''s stock counts.', 'paid', 900000, ARRAY['postgres', 'typescript'], 62, NULL),
    ('ac-packaging', 's1', 1, 'Concept routes', 'Three routes for the autumn range, shown on the actual bag sizes.', 'open', 420000, ARRAY['branding', 'packaging'], NULL, 24),
    ('ac-packaging', 's2', 2, 'Print-ready artwork', 'Final artwork and supplier specifications.', 'open', 360000, ARRAY['packaging'], NULL, 45),
    ('ac-loyalty', 's1', 1, 'Microsite build', 'Stamp card, roast news and a simple admin view for the cafés.', 'assigned', 680000, ARRAY['typescript', 'ui-design'], NULL, 30),
    ('sp-dashboard', 's1', 1, 'Telemetry ingest', 'Pull probe data from the three carriers into one stream.', 'paid', 550000, ARRAY['postgres', 'realtime'], 80, NULL),
    ('sp-dashboard', 's2', 2, 'Alerts and reports', 'Thresholds, alerts to drivers and the weekly compliance report.', 'in_progress', 600000, ARRAY['typescript', 'realtime'], NULL, 16),
    ('sp-dashboard', 's3', 3, 'Mobile view', 'A driver view of the same data.', 'open', 250000, ARRAY['mobile'], NULL, 50),
    ('sp-relaunch', 's1', 1, 'Labels and trays', 'Label family, tray artwork and supplier files.', 'paid', 750000, ARRAY['editorial-design', 'packaging'], 100, NULL)
) AS v(project, key, ord, name, brief, status, price, skills, done_d, due_in);

-- `who` is a freelancer's username or a team's slug, by `kind`.
DROP TABLE IF EXISTS pg_temp.b4_assign;
CREATE TEMP TABLE b4_assign ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('hf-portal', 's1', 'freelancer', 'marisdelacroix', 'accepted', 'completed', 192),
    ('hf-portal', 's2', 'team', 'ateliernova', 'accepted', 'completed', 161),
    ('hf-portal', 's3', 'team', 'northloop', 'accepted', 'accepted', 112),
    ('hf-guide', 's1', 'freelancer', 'inesduarte', 'accepted', 'completed', 140),
    ('hf-signage', 's1', 'freelancer', 'marisdelacroix', 'accepted', 'completed', 80),
    ('hf-signage', 's2', 'freelancer', 'inesduarte', 'accepted', 'accepted', 31),
    ('hf-dataroom', 's1', 'freelancer', 'kwamemensah', 'accepted', 'cancelled', 85),
    ('tw-catalogue', 's1', 'freelancer', 'kwamemensah', 'accepted', 'completed', 170),
    ('tw-catalogue', 's2', 'freelancer', 'tomaszwojcik', 'accepted', 'completed', 126),
    ('ac-loyalty', 's1', 'freelancer', 'kwamemensah', 'accepted', 'pending_funding', 14),
    ('sp-dashboard', 's1', 'team', 'northloop', 'accepted', 'completed', 122),
    ('sp-dashboard', 's2', 'team', 'northloop', 'accepted', 'accepted', 14),
    ('sp-relaunch', 's1', 'team', 'ateliernova', 'accepted', 'completed', 152)
) AS v(project, stage, kind, who, how, status, d);

DROP TABLE IF EXISTS pg_temp.b4_tickets;
CREATE TEMP TABLE b4_tickets ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('hf-portal', 's1', 't1', 'Map the carrier booking journey', 'Run the interviews and deliver the service map with the three biggest failure points marked.',
     'completed', 'high', 'marisdelacroix', 1.0, 'released', 189, 190, 165, NULL::int,
     ARRAY['Interview the booking desk', 'Interview six carriers', 'Service map, annotated'], 3,
     'Service map and interview notes are attached; the three failure points are on page 4.'),
    ('hf-portal', 's2', 't2', 'Build the portal component kit', 'Component library and templates for booking, tracking and rate cards.',
     'completed', 'normal', 'inesduarte', 1.5, 'released', 159, 160, 120, NULL,
     ARRAY['Tokens and type', 'Core components', 'Page templates'], 3,
     'Kit is published with usage notes. Booking and tracking templates are ready for the build stage.'),
    ('hf-portal', 's3', 't3', 'Live shipment timeline API', 'A single timeline per shipment, merged from the carrier feeds.',
     'completed', 'high', 'tomaszwojcik', 1.0, 'released', 109, 110, 60, NULL,
     ARRAY['Feed adapters', 'Merge and dedupe', 'Replay test against last month'], 3,
     'Replay matched every event from last month. Adapter notes are in the repository readme.'),
    ('hf-portal', 's3', 't4', 'Exceptions and delay alerts', 'Alert the desk and the shipper when a leg slips past its promised window.',
     'in_review', 'urgent', 'samuelnkemelu', 0.2, 'escrow_funded', 39, 40, NULL, 6,
     ARRAY['Delay rules', 'Desk view', 'Shipper notifications'], 2,
     'Rules and desk view are in for review. Notifications follow once the wording is agreed.'),
    ('hf-portal', 's3', 't5', 'Carrier rate-card import', 'Let carriers upload rate cards and validate them against the lane list.',
     'in_progress', 'normal', 'tomaszwojcik', 0.4, 'escrow_funded', 17, 18, NULL, 10,
     ARRAY['Upload and parse', 'Validate against lanes', 'Publish a version'], 1, NULL),
    ('hf-portal', 's3', 't6', 'Proof-of-delivery upload', 'Drivers upload a signed note; the shipper sees it on the timeline.',
     'todo', 'normal', NULL, 1.0, 'unpaid', NULL, NULL, NULL, 12,
     ARRAY['Capture on mobile', 'Attach to the timeline'], 0, NULL),
    ('hf-portal', 's4', 't7', 'Go-live runbook and training', 'A runbook for the desk and two training sessions.',
     'backlog', 'low', NULL, 1.0, 'unpaid', NULL, NULL, NULL, NULL,
     ARRAY['Runbook', 'Training sessions'], 0, NULL),
    ('hf-guide', 's1', 't1', 'Driver onboarding guide', 'Write, illustrate and lay out the guide in both languages.',
     'completed', 'normal', 'inesduarte', 1.0, 'released', 139, 140, 70, NULL,
     ARRAY['Outline sign-off', 'Illustrations', 'Layout and print files'], 3,
     'Final files in English and Arabic, print-ready, with a screen edition for the driver app.'),
    ('hf-signage', 's1', 't1', 'Three wayfinding directions', 'Concepts shown on photographs of the bays.',
     'completed', 'normal', 'marisdelacroix', 0.5, 'released', 79, 80, 45, NULL,
     ARRAY['Audit the site photographs', 'Three directions', 'Mock-ups on the bays'], 3,
     'Direction two is the one the warehouse team preferred; mock-ups are attached.'),
    ('hf-signage', 's2', 't2', 'Signage artwork set', 'Artwork for zones, bays and safety notices.',
     'in_progress', 'normal', 'inesduarte', 0.4, 'escrow_funded', 29, 30, NULL, NULL,
     ARRAY['Zone signs', 'Bay markers', 'Safety notices'], 1, NULL),
    ('hf-dataroom', 's1', 't1', 'Data room structure', 'Index, templates and a redaction pass.',
     'cancelled', 'normal', NULL, 1.0, 'refunded', NULL, 84, NULL, NULL,
     ARRAY['Index', 'Redaction pass'], 0, NULL),
    ('tw-catalogue', 's1', 't1', 'Profile the part records', 'Find duplicates and gaps, and agree the mapping.',
     'completed', 'normal', 'kwamemensah', 1.0, 'released', 169, 170, 130, NULL,
     ARRAY['Profile records', 'Agree mapping'], 2,
     'Profile and mapping sheet attached. About eleven percent of records were duplicates.'),
    ('tw-catalogue', 's2', 't2', 'Import and reconcile', 'Run the import twice and reconcile with the stock count.',
     'completed', 'normal', 'tomaszwojcik', 1.0, 'released', 124, 125, 62, NULL,
     ARRAY['Transform', 'Import', 'Reconcile'], 3,
     'Second import reconciled to the stock count within four records, listed in the note.'),
    ('ac-packaging', 's1', 't1', 'Autumn bag concepts', 'Three routes on the 250 g and 1 kg bags.',
     'todo', 'high', NULL, 1.0, 'needs_funding', NULL, NULL, NULL, 15,
     ARRAY['Three routes', 'Mock-ups on the bags'], 0, NULL),
    ('ac-loyalty', 's1', 't1', 'Stamp card and admin view', 'The stamp card for regulars and the view for café staff.',
     'todo', 'normal', NULL, 1.0, 'needs_funding', NULL, NULL, NULL, NULL,
     ARRAY['Stamp card', 'Admin view'], 0, NULL),
    ('sp-dashboard', 's1', 't1', 'Probe data ingest', 'One stream from all three carriers.',
     'completed', 'normal', 'tomaszwojcik', 1.0, 'released', 119, 120, 80, NULL,
     ARRAY['Carrier adapters', 'Stream and storage'], 2,
     'All three carriers are in the stream with a day of backfill.'),
    ('sp-dashboard', 's2', 't2', 'Threshold alerts', 'Alert drivers and the depot when a load drifts out of range.',
     'in_progress', 'high', 'samuelnkemelu', 0.2, 'escrow_funded', 11, 12, NULL, 9,
     ARRAY['Thresholds', 'Driver alerts', 'Weekly report'], 1, NULL),
    ('sp-relaunch', 's1', 't1', 'Label family and trays', 'Label system, trays and supplier files.',
     'completed', 'normal', 'inesduarte', 1.0, 'released', 149, 150, 100, NULL,
     ARRAY['Label system', 'Trays', 'Supplier files'], 3,
     'Everything is with the printer, and the supplier files passed their preflight.')
) AS v(project, stage, key, title, brief, status, priority, who, intensity, payment, claimed_d, funded_d,
       released_d, due_in, tasks, done, note);

-- The target's own seat on a project they do not own. No row means they reach it through the business
-- alone: it is on the console, not in their /projects feed.
DROP TABLE IF EXISTS pg_temp.b4_seats;
CREATE TEMP TABLE b4_seats ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('hf-guide', 'member', false, 148),
    ('hf-signage', 'manager', true, 88),
    ('ac-loyalty', 'manager', true, 25),
    ('sp-dashboard', 'member', false, 120)
) AS v(project, role, manages, d);
-- #endregion

-- #region Projects, stages, hiring
INSERT INTO projects.projects
    (id, client_business_id, owner_user_id, title, slug, description, description_text, format, structure_variation,
     status, visibility, publish_visibility, currency, budget_type, budget_amount_cents, timeline_preset,
     target_project_start_date, ip_ownership_mode, nda_required, portfolio_display_rights, location_restriction,
     language_requirement, allow_deadline_bonuses, created_at, updated_at, last_activity_at)
SELECT pg_temp.b4('project:' || p.key), pg_temp.b4('biz:' || p.biz), pg_temp.b4_who(p.owner), p.title,
       pg_temp.slug('prj', 'b4:' || p.key), jsonb_build_object('text', p.summary), p.summary,
       p.format::public.project_format, p.structure::projects.structure_variation, p.status::public.project_status,
       p.visibility::public.visibility,
       CASE WHEN p.status = 'draft' THEN 'public' ELSE p.visibility END::public.visibility, 'USD', 'fixed_price',
       (SELECT sum(s.price) FROM b4_stages s WHERE s.project = p.key), 'sequential',
       pg_temp.b4_ago(p.created_d - 4), 'exclusive_transfer', false, 'allowed', ARRAY['Remote'], ARRAY['English'],
       true, pg_temp.b4_ago(p.created_d), pg_temp.b4_ago(p.activity_d), pg_temp.b4_ago(p.activity_d)
  FROM b4_projects p
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_status_history (id, project_id, actor_user_id, from_status, to_status, reason, created_at)
SELECT pg_temp.b4('status:' || p.key || ':' || h.to_status), pg_temp.b4('project:' || p.key), pg_temp.b4_who(p.owner),
       h.from_status::public.project_status, h.to_status::public.project_status, h.reason, pg_temp.b4_ago(h.d)
  FROM b4_projects p
 CROSS JOIN LATERAL (VALUES
        (NULL, 'draft', 'Created', p.created_d),
        ('draft', 'active', 'Published', CASE WHEN p.status <> 'draft' THEN p.created_d - 1 END),
        ('active', p.status, CASE p.status WHEN 'completed' THEN 'Final stage paid' WHEN 'on_hold' THEN 'Waiting on the racking contractor' WHEN 'cancelled' THEN 'Round moved to the investor''s tooling' END,
         CASE WHEN p.status IN ('completed', 'on_hold', 'cancelled') THEN p.activity_d END)
       ) AS h(from_status, to_status, reason, d)
 WHERE h.d IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_stages
    (id, project_id, name, slug, description, description_text, sort_order, status, skills, unit_price_cents,
     milestone, completed_at, seat_limit, start_trigger_type, file_duration_mode, file_due_date, created_at)
SELECT pg_temp.b4('stage:' || s.project || ':' || s.key), pg_temp.b4('project:' || s.project), s.name,
       pg_temp.slug('stg', 'b4:' || s.project || ':' || s.key), jsonb_build_object('text', s.brief), s.brief, s.ord,
       s.status::public.stage_status, s.skills, s.price,
       CASE WHEN s.status = 'paid' THEN 'Accepted and paid' ELSE '' END, pg_temp.b4_ago(s.done_d), 3,
       'on_project_start'::public.start_trigger_type, CASE WHEN s.due_in IS NOT NULL THEN 'fixed_deadline' END,
       now() + s.due_in * interval '1 day', pg_temp.b4_ago(p.created_d)
  FROM b4_stages s
  JOIN b4_projects p ON p.key = s.project
 WHERE NOT EXISTS (SELECT 1 FROM projects.project_stages x WHERE x.id = pg_temp.b4('stage:' || s.project || ':' || s.key));

INSERT INTO projects.stage_assignments
    (id, project_stage_id, assignee_type, freelancer_profile_id, team_id, assigned_by, is_client_managed, status, created_at)
SELECT pg_temp.b4('assign:' || a.project || ':' || a.stage), pg_temp.b4('stage:' || a.project || ':' || a.stage),
       a.kind::public.assignment_type,
       CASE WHEN a.kind = 'freelancer' THEN pg_temp.b4_who(a.who) END,
       CASE WHEN a.kind = 'team' THEN (SELECT t.id FROM org.teams t WHERE t.slug = a.who) END,
       pg_temp.b4_who(p.owner), false, a.status, pg_temp.b4_ago(a.d)
  FROM b4_assign a
  JOIN b4_projects p ON p.key = a.project
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_participants (id, project_id, profile_type, profile_id, role, created_at)
SELECT pg_temp.b4('participant:' || p.key || ':business'), pg_temp.b4('project:' || p.key), 'business',
       pg_temp.b4('biz:' || p.biz), 'owner', pg_temp.b4_ago(p.created_d)
  FROM b4_projects p
ON CONFLICT (id) DO NOTHING;

-- A freelancer holds their own row; a team's seat enrols its active members, as the hiring doors do.
INSERT INTO projects.project_participants (id, project_id, profile_type, profile_id, role, created_at)
SELECT DISTINCT ON (u.project, u.user_id) pg_temp.b4('participant:' || u.project || ':' || u.user_id),
       pg_temp.b4('project:' || u.project), 'freelancer'::public.profile_type, u.user_id, 'assignee',
       pg_temp.b4_ago(u.d)
  FROM (
        SELECT a.project, pg_temp.b4_who(a.who) AS user_id, a.d FROM b4_assign a WHERE a.kind = 'freelancer'
        UNION ALL
        SELECT a.project, m.user_id, a.d
          FROM b4_assign a
          JOIN org.teams t ON t.slug = a.who
          JOIN org.team_members m ON m.team_id = t.id AND m.status = 'active'
         WHERE a.kind = 'team'
       ) u
 ORDER BY u.project, u.user_id, u.d DESC
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_participants (id, project_id, profile_type, profile_id, role, can_manage_tickets, created_at)
SELECT pg_temp.b4('participant:' || s.project || ':me'), pg_temp.b4('project:' || s.project), 'freelancer',
       pg_temp.me(), s.role, s.manages, pg_temp.b4_ago(s.d)
  FROM b4_seats s
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_invitations
    (id, project_id, project_stage_id, target_user_id, message, offer_price_cents, placeholder, role, inviter_user_id,
     token, status, created_at, expires_at, accepted_at, declined_at)
SELECT pg_temp.b4('pinvite:' || i.project || ':' || i.who), pg_temp.b4('project:' || i.project),
       pg_temp.b4('stage:' || i.project || ':' || i.stage), pg_temp.b4_who(i.who), i.message, i.offer, false, 'freelancer',
       pg_temp.b4_who(i.by_who), pg_temp.b4('pinvite-token:' || i.project || ':' || i.who)::text, i.status,
       pg_temp.b4_ago(i.d), pg_temp.b4_ago(i.d - 14),
       CASE WHEN i.status = 'accepted' THEN pg_temp.b4_ago(i.d - 1) END,
       CASE WHEN i.status = 'declined' THEN pg_temp.b4_ago(i.d - 1) END
  FROM (VALUES
        ('hf-portal', 's4', 'marisdelacroix', 'me', 'You mapped this journey at the start. Would you run the pilot and the handover too?', 300000::bigint, 'pending', 2),
        ('hf-signage', 's3', 'lenamueller', 'miguelsantos', 'We need placement drawings once the racking is in. Interested?', 150000, 'declined', 12),
        ('ac-packaging', 's1', 'aikotanaka', 'me', 'We love the bag you drew for us. Could you take the autumn range?', 420000, 'pending', 3),
        ('sp-dashboard', 's3', 'samuelnkemelu', 'miguelsantos', 'A driver view of the dashboard is next. You already know the alerts.', 250000, 'pending', 4)
       ) AS i(project, stage, who, by_who, message, offer, status, d)
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_applications
    (id, project_id, applicant_user_id, applicant_type, applicant_profile_id, message, status, created_at, updated_at)
SELECT pg_temp.b4('application:' || a.project || ':' || a.who), pg_temp.b4('project:' || a.project),
       pg_temp.b4_who(a.who), 'freelancer', pg_temp.b4_who(a.who), a.message, a.status::projects.application_status,
       pg_temp.b4_ago(a.d), pg_temp.b4_ago(a.d)
  FROM (VALUES
        ('hf-portal', 's4', 'lenamueller', 'I ran pilots like this at my last two clients and would love to see the desk through go-live.', 'pending', 4),
        ('ac-packaging', 's1', 'inesduarte', 'Atelier Nova did the original identity, so the autumn range is a natural next step.', 'pending', 6),
        ('ac-packaging', 's2', 'saoirsebyrne', 'I prepare print artwork for small food brands and can start in two weeks.', 'pending', 2),
        ('sp-dashboard', 's3', 'tomaszwojcik', 'Happy to take the mobile view after the alerts ship.', 'rejected', 7)
       ) AS a(project, stage, who, message, status, d)
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_application_targets (id, application_id, target_type, target_id)
SELECT pg_temp.b4('application-target:' || a.project || ':' || a.who), pg_temp.b4('application:' || a.project || ':' || a.who),
       'stage', pg_temp.b4('stage:' || a.project || ':' || a.stage)
  FROM (VALUES
        ('hf-portal', 's4', 'lenamueller'), ('ac-packaging', 's1', 'inesduarte'),
        ('ac-packaging', 's2', 'saoirsebyrne'), ('sp-dashboard', 's3', 'tomaszwojcik')
       ) AS a(project, stage, who)
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Tickets, submissions, escrows
INSERT INTO projects.tickets
    (id, project_id, current_stage_id, current_assignee_id, slug, owner_user_id, title, description, text_description,
     status, priority, required_stages, tasks, due_date, workload_intensity, payment_status, unit_price_cents,
     total_amount_paid, sort_order, claimed_at, created_at, updated_at)
SELECT pg_temp.b4('ticket:' || t.project || ':' || t.key), pg_temp.b4('project:' || t.project),
       pg_temp.b4('stage:' || t.project || ':' || t.stage), pg_temp.b4_who(t.who),
       pg_temp.slug('tkt', 'b4:' || t.project || ':' || t.key), pg_temp.b4_who(p.owner), t.title,
       jsonb_build_object('text', t.brief), t.brief, t.status::public.ticket_status, t.priority::projects.ticket_priority,
       jsonb_build_array(jsonb_build_object('stage_id', pg_temp.b4('stage:' || t.project || ':' || t.stage), 'order', 0)),
       (SELECT jsonb_agg(jsonb_build_object(
                   'id', pg_temp.b4('task:' || t.project || ':' || t.key || ':' || u.n), 'text', u.txt, 'done', u.n <= t.done,
                   'completed_by', CASE WHEN u.n <= t.done THEN jsonb_build_array(pg_temp.b4_who(t.who)) ELSE '[]'::jsonb END)
                   ORDER BY u.n)
          FROM unnest(t.tasks) WITH ORDINALITY AS u(txt, n)),
       now() + t.due_in * interval '1 day', t.intensity, t.payment::public.payment_status, s.price,
       CASE WHEN t.payment = 'released' THEN s.price ELSE 0 END,
       row_number() OVER (PARTITION BY t.project ORDER BY t.key)::int,
       pg_temp.b4_ago(t.claimed_d), pg_temp.b4_ago(LEAST(p.created_d, COALESCE(t.funded_d + 2, p.created_d))),
       pg_temp.b4_ago(COALESCE(t.released_d, t.claimed_d, p.activity_d))
  FROM b4_tickets t
  JOIN b4_stages s ON s.project = t.project AND s.key = t.stage
  JOIN b4_projects p ON p.key = t.project
 WHERE NOT EXISTS (SELECT 1 FROM projects.tickets x WHERE x.id = pg_temp.b4('ticket:' || t.project || ':' || t.key));

INSERT INTO projects.ticket_history
    (id, ticket_id, actor_id, action_type, previous_stage_id, new_stage_id, previous_status, new_status, changes, created_at)
SELECT pg_temp.b4('ticket-history:' || t.project || ':' || t.key || ':' || h.step),
       pg_temp.b4('ticket:' || t.project || ':' || t.key), pg_temp.b4_who(h.actor), h.action, h.stage_from,
       pg_temp.b4('stage:' || t.project || ':' || t.stage), h.status_from::public.ticket_status,
       h.status_to::public.ticket_status, h.changes, pg_temp.b4_ago(h.d)
  FROM b4_tickets t
  JOIN b4_projects p ON p.key = t.project
 CROSS JOIN LATERAL (VALUES
        ('created', p.owner, 'created', NULL::uuid, NULL, 'backlog', jsonb_build_object('title', t.title),
         LEAST(p.created_d::numeric, COALESCE(t.funded_d + 2, p.created_d))),
        ('claimed', t.who, 'reassigned', pg_temp.b4('stage:' || t.project || ':' || t.stage), 'todo', 'claimed',
         jsonb_build_object('assignee', pg_temp.b4_who(t.who)), t.claimed_d),
        ('moved', COALESCE(t.who, p.owner), 'status_changed', pg_temp.b4('stage:' || t.project || ':' || t.stage), 'claimed', t.status,
         '{}'::jsonb, CASE WHEN t.status IN ('in_progress', 'in_review', 'completed') THEN COALESCE(t.released_d, t.claimed_d - 1) END)
       ) AS h(step, actor, action, stage_from, status_from, status_to, changes, d)
 WHERE h.d IS NOT NULL AND h.actor IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.stage_submissions
    (id, project_stage_id, ticket_id, submitted_by, notes, title, status, description, checked_item_ids, number,
     reviewed_by, reviewed_at, feedback, created_at, updated_at)
SELECT pg_temp.b4('submission:' || t.project || ':' || t.key), pg_temp.b4('stage:' || t.project || ':' || t.stage),
       pg_temp.b4('ticket:' || t.project || ':' || t.key), pg_temp.b4_who(t.who), t.note, t.title || ' — final',
       CASE t.status WHEN 'completed' THEN 'accepted' ELSE 'pending_review' END,
       jsonb_build_object('text', t.note),
       (SELECT COALESCE(jsonb_agg(pg_temp.b4('task:' || t.project || ':' || t.key || ':' || g.n)), '[]'::jsonb)
          FROM generate_series(1, t.done) AS g(n)),
       row_number() OVER (PARTITION BY t.project, t.stage ORDER BY t.key)::int,
       CASE WHEN t.status = 'completed' THEN pg_temp.b4_who(p.owner) END,
       pg_temp.b4_ago(t.released_d),
       CASE WHEN t.status = 'completed' THEN jsonb_build_object('text', 'Accepted. Thanks for keeping this tight.') END,
       pg_temp.b4_ago(COALESCE(t.released_d + 2, 3)), pg_temp.b4_ago(COALESCE(t.released_d, 3))
  FROM b4_tickets t
  JOIN b4_projects p ON p.key = t.project
 WHERE t.note IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- `held` is what fn_hold_ticket_escrow writes and the only status a release accepts. Each stage holds
-- its own price per ticket; the 5% fee comes out of the payee's side at release.
INSERT INTO finance.escrows
    (id, project_stage_id, ticket_id, payer_business_id, payee_type, payee_id, amount_cents, platform_fee_cents,
     deadline_bonus_cents, currency, status, created_at, released_at)
SELECT pg_temp.b4('escrow:' || t.project || ':' || t.key), pg_temp.b4('stage:' || t.project || ':' || t.stage),
       pg_temp.b4('ticket:' || t.project || ':' || t.key), pg_temp.b4('biz:' || p.biz), a.kind::public.assignment_type,
       CASE WHEN a.kind = 'team' THEN (SELECT x.id FROM org.teams x WHERE x.slug = a.who) ELSE pg_temp.b4_who(a.who) END,
       s.price, CASE WHEN t.payment = 'released' THEN pg_temp.b4_fee(s.price) ELSE 0 END, 0, 'USD',
       CASE t.payment WHEN 'released' THEN 'released' WHEN 'refunded' THEN 'refunded' ELSE 'held' END,
       pg_temp.b4_ago(t.funded_d), pg_temp.b4_ago(t.released_d)
  FROM b4_tickets t
  JOIN b4_projects p ON p.key = t.project
  JOIN b4_stages s ON s.project = t.project AND s.key = t.stage
  JOIN b4_assign a ON a.project = t.project AND a.stage = t.stage
 WHERE t.funded_d IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Per-transaction businesses get one invoice per escrow; a monthly one gets the consolidated run below.
INSERT INTO finance.invoices
    (id, project_stage_id, issue_to_business_id, issue_from_profile, invoice_type, amount_cents, subtotal_cents,
     platform_fee_cents, tax_cents, total_cents, currency, status, due_date, paid_at, created_at)
SELECT pg_temp.b4('stage-invoice:' || t.project || ':' || t.key), e.project_stage_id, e.payer_business_id, e.payee_id,
       'per_stage', e.amount_cents, e.amount_cents, e.platform_fee_cents, 0, e.amount_cents, 'USD',
       CASE WHEN e.status = 'released' THEN 'paid' ELSE 'issued' END, e.created_at + interval '30 days', e.released_at,
       e.created_at
  FROM b4_tickets t
  JOIN b4_projects p ON p.key = t.project
  JOIN b4_biz b ON b.key = p.biz AND b.invoicing = 'per_transaction'
  JOIN finance.escrows e ON e.id = pg_temp.b4('escrow:' || t.project || ':' || t.key)
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.invoice_line_items (id, invoice_id, ref_type, ref_id, description, amount_cents, currency)
SELECT pg_temp.b4('stage-invoice-line:' || t.project || ':' || t.key || ':' || l.kind),
       pg_temp.b4('stage-invoice:' || t.project || ':' || t.key), l.kind, e.id, l.label, l.amount, 'USD'
  FROM b4_tickets t
  JOIN b4_projects p ON p.key = t.project
  JOIN b4_biz b ON b.key = p.biz AND b.invoicing = 'per_transaction'
  JOIN finance.escrows e ON e.id = pg_temp.b4('escrow:' || t.project || ':' || t.key)
 CROSS JOIN LATERAL (VALUES
        ('escrow', t.title, e.amount_cents),
        ('platform_fee', 'Platform fee (5%) — deducted from the payee', -e.platform_fee_cents)) AS l(kind, label, amount)
 WHERE l.amount <> 0
ON CONFLICT (id) DO NOTHING;

-- A provider's review of the business is the client-proof the public profile shows. The other direction,
-- a business reviewing a persona, would move that persona's seeded rating, so there is none here.
INSERT INTO reviews.entity_reviews
    (id, target_entity_id, target_entity_type, reviewer_user_id, project_id, rating, title, comment, created_at, updated_at)
SELECT pg_temp.b4('review:' || r.project), pg_temp.b4('biz:' || r.biz), 'business', pg_temp.b4_who(r.who),
       pg_temp.b4('project:' || r.project), r.rating, r.title, r.comment, pg_temp.b4_ago(r.d), pg_temp.b4_ago(r.d)
  FROM (VALUES
        ('hf', 'hf-guide', 'inesduarte', 4.80, 'Clear brief, fast decisions',
         'The team knew exactly what a new driver needed to hear, signed off the outline in one round and released payment the day the final files landed.', 68),
        ('tw', 'tw-catalogue', 'kwamemensah', 4.60, 'Organised client with honest data',
         'The records were messy but nobody pretended otherwise. We agreed the mapping quickly, and every question came back the same day from someone who knew the answer.', 58),
        ('sp', 'sp-relaunch', 'inesduarte', 5.00, 'Trusted us with the shelf',
         'Saltmarsh gave real feedback from real shopkeepers and left the craft to us. The tray artwork passed preflight first time, which says a lot about their preparation.', 98)
       ) AS r(biz, project, who, rating, title, comment, d)
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.profile_follows (id, follower_user_id, target_entity_type, target_entity_id, created_at)
SELECT pg_temp.b4('follow:' || f.biz || ':' || f.who), pg_temp.b4_who(f.who), 'business', pg_temp.b4('biz:' || f.biz),
       pg_temp.b4_ago(f.d)
  FROM (VALUES ('hf', 'marisdelacroix', 150), ('hf', 'kwamemensah', 90), ('hf', 'renkoda', 60), ('sp', 'saoirsebyrne', 90))
       AS f(biz, who, d)
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.user_preferences (user_id, project_id, is_starred, starred_at, is_archived, last_viewed_at)
SELECT pg_temp.me(), pg_temp.b4('project:' || p.key), p.key = 'hf-portal',
       CASE WHEN p.key = 'hf-portal' THEN pg_temp.b4_ago(30) END, false, pg_temp.b4_ago(1)
  FROM b4_projects p
 WHERE p.owner = 'me' OR p.key IN (SELECT s.project FROM b4_seats s)
ON CONFLICT (user_id, project_id) DO NOTHING;
-- #endregion

-- #region Products: what these businesses bought
-- A business is buyer-side and cannot own a listing, so these are orders of seeded products. Only a
-- digital product can be paid for (Seed.md), and a KYB-unverified business cannot buy at all.
DROP TABLE IF EXISTS pg_temp.b4_orders;
CREATE TEMP TABLE b4_orders ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('hf', 'o1', 240, 'wallet', 'me', ARRAY['Dashboard blocks', 'Iconography set — 640']),
    ('hf', 'o2', 50, 'on_account', 'priyaraman', ARRAY['Editorial type system', 'Aurora UI kit']),
    ('hf', 'o3', 20, 'on_account', 'miguelsantos', ARRAY['Notion ops suite']),
    ('tw', 'o1', 200, 'wallet', 'me', ARRAY['Notion ops suite']),
    ('sp', 'o1', 140, 'wallet', 'hannahcole', ARRAY['3D product scenes']),
    ('sp', 'o2', 33, 'wallet', 'miguelsantos', ARRAY['Grain — Lightroom pack', 'Motion primitives'])
) AS v(biz, key, d, pay, who, items);

INSERT INTO finance.orders
    (id, reference, status, placed_at, owner_type, owner_id, currency, subtotal_minor, creator_discount_minor,
     platform_fee_minor, platform_fee_bp, platform_fee_mode, total_minor, charged_minor, payment_provider,
     payment_method_label, idempotency_key, created_at)
SELECT pg_temp.b4('order:' || o.biz || ':' || o.key),
       'PJ-2026-' || upper(substr(md5('b4-order:' || pg_temp.me() || o.biz || o.key), 1, 7)),
       CASE o.pay WHEN 'on_account' THEN 'invoiced' ELSE 'confirmed' END::finance.order_status, pg_temp.b4_ago(o.d),
       'business', pg_temp.b4('biz:' || o.biz), 'USD', x.subtotal, 0, x.fee, 500, 'seller_deducted', x.subtotal,
       CASE o.pay WHEN 'on_account' THEN 0 ELSE x.subtotal END, 'stripe',
       CASE o.pay WHEN 'on_account' THEN 'On account' ELSE b.name || ' vault' END,
       'snippet:' || pg_temp.b4('order:' || o.biz || ':' || o.key), pg_temp.b4_ago(o.d)
  FROM b4_orders o
  JOIN b4_biz b ON b.key = o.biz
 CROSS JOIN LATERAL (
        SELECT sum(p.price_cents)::bigint AS subtotal, sum(pg_temp.b4_fee(p.price_cents))::bigint AS fee
          FROM catalogue.products p WHERE p.title = ANY (o.items)) x
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.order_lines
    (id, order_id, item_type, item_id, title, subtitle, quantity, line_total_minor, currency, platform_fee_bp,
     platform_fee_minor, fulfilment, download_name, download_format, licence, position)
SELECT pg_temp.b4('order-line:' || o.biz || ':' || o.key || ':' || l.n), pg_temp.b4('order:' || o.biz || ':' || o.key),
       'digital_product', p.id, p.title, 'Instant download', 1, p.price_cents, 'USD', 500, pg_temp.b4_fee(p.price_cents),
       'download', p.slug || '.zip', 'zip', p.licence::text, (l.n - 1)::int
  FROM b4_orders o
 CROSS JOIN LATERAL unnest(o.items) WITH ORDINALITY AS l(title, n)
  JOIN catalogue.products p ON p.title = l.title
ON CONFLICT (id) DO NOTHING;

-- An open basket on the Pro vault, waiting on the approval its buyer asked for below.
INSERT INTO finance.baskets (id, owner_type, owner_id, name, is_default)
VALUES (pg_temp.b4('basket:hf'), 'business', pg_temp.b4('biz:hf'), 'Main Basket', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.basket_items
    (id, basket_id, item_type, item_id, title, subtitle, unit_price_minor, currency, quantity, saved_for_later,
     position, destination_email, created_at)
SELECT pg_temp.b4('basket-item:hf:' || l.n), pg_temp.b4('basket:hf'), 'digital_product', p.id, p.title, 'Instant download',
       p.price_cents, 'USD', 1, false, (l.n - 1)::smallint,
       (SELECT e.email FROM org.user_emails e WHERE e.user_id = pg_temp.persona('danielokafor') ORDER BY e.is_primary DESC NULLS LAST LIMIT 1),
       pg_temp.b4_ago(2)
  FROM unnest(ARRAY['Motion primitives', '3D product scenes']) WITH ORDINALITY AS l(title, n)
  JOIN catalogue.products p ON p.title = l.title
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region The ledger: one chronological pass per vault
-- Nothing is minted: each vault opens with a dated top-up. Holds, refunds and orders are read back from
-- the rows above, so the ledger cannot disagree with them.
DROP TABLE IF EXISTS pg_temp.b4_tx;
CREATE TEMP TABLE b4_tx ON COMMIT DROP AS
SELECT t.biz, 'topup:' || t.biz || ':' || t.d AS key, pg_temp.b4_ago(t.d) AS at, 'credit' AS direction, t.amount,
       'topup' AS reason, 'payment_methods' AS ref_table, pg_temp.b4('pm:' || t.biz) AS ref_id, 'available' AS state,
       t.who, t.note
  FROM (VALUES
        ('hf', 420, 2500000::bigint, 'me', 'Opening deposit'),
        ('hf', 245, 1500000, 'priyaraman', 'Carrier programme budget'),
        ('hf', 180, 1000000, 'me', 'Portal build, phase two'),
        ('hf', 95, 1000000, 'danielokafor', 'Q3 operating top-up'),
        ('tw', 500, 1402900, 'me', 'Opening deposit'),
        ('ac', 125, 2500000, 'theo', 'Opening deposit'),
        ('ac', 28, 600000, 'me', 'Autumn range budget'),
        ('sp', 224, 2500000, 'hannahcole', 'Opening deposit'),
        ('sp', 100, 1000000, 'danielokafor', 'Dashboard build'),
        ('bw', 169, 2500000, 'miguelsantos', 'Opening deposit')
       ) AS t(biz, d, amount, who, note);

INSERT INTO b4_tx
SELECT p.biz, 'hold:' || t.project || ':' || t.key, pg_temp.b4_ago(t.funded_d), 'debit', s.price, 'escrow_hold', 'escrows',
       pg_temp.b4('escrow:' || t.project || ':' || t.key), 'locked', NULL, NULL
  FROM b4_tickets t
  JOIN b4_projects p ON p.key = t.project
  JOIN b4_stages s ON s.project = t.project AND s.key = t.stage
 WHERE t.funded_d IS NOT NULL;

INSERT INTO b4_tx
SELECT p.biz, 'refund:' || t.project || ':' || t.key, pg_temp.b4_ago(t.funded_d - 4), 'credit', s.price, 'escrow_refund', 'escrows',
       pg_temp.b4('escrow:' || t.project || ':' || t.key), 'available', NULL, NULL
  FROM b4_tickets t
  JOIN b4_projects p ON p.key = t.project
  JOIN b4_stages s ON s.project = t.project AND s.key = t.stage
 WHERE t.payment = 'refunded';

-- An order on account: the wallet is credited and the order paid from it, so a hold always has a wallet.
INSERT INTO b4_tx
SELECT o.biz, 'on-account:' || o.biz || ':' || o.key, pg_temp.b4_ago(o.d), 'credit', r.total_minor, 'on_account_credit',
       'orders', r.id, 'available', NULL, NULL
  FROM b4_orders o
  JOIN finance.orders r ON r.id = pg_temp.b4('order:' || o.biz || ':' || o.key)
 WHERE o.pay = 'on_account';

INSERT INTO b4_tx
SELECT o.biz, 'order:' || o.biz || ':' || o.key, pg_temp.b4_ago(o.d) + interval '1 second', 'debit', r.total_minor,
       'order_payment', 'orders', r.id, 'available', NULL, NULL
  FROM b4_orders o
  JOIN finance.orders r ON r.id = pg_temp.b4('order:' || o.biz || ':' || o.key);

-- Last month's on-account purchase was paid; this month's is still due (see the invoices below).
INSERT INTO b4_tx
SELECT 'hf', 'invoice-payment:hf:2', pg_temp.b4_ago(31), 'debit', r.total_minor, 'invoice_payment', 'invoices',
       pg_temp.b4('invoice:hf:2'), 'available', NULL, NULL
  FROM finance.orders r
 WHERE r.id = pg_temp.b4('order:hf:o2');

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT * FROM b4_tx ORDER BY biz, at, direction LOOP
        PERFORM pg_temp.post('b4:' || r.key, pg_temp.b4('wallet:' || r.biz), r.direction, r.amount, r.reason, r.at,
                             r.ref_table, r.ref_id, r.state::finance.fund_state);
    END LOOP;
END $$;

-- The vault audit is derived, not typed: every top-up is one add_funds row by the member who paid it.
INSERT INTO finance.ledger_audit
    (id, wallet_id, actor_user_id, action, amount_cents, currency, ref_table, ref_id, metadata, created_at)
SELECT pg_temp.b4('audit-row:' || t.key), pg_temp.b4('wallet:' || t.biz), pg_temp.b4_who(t.who), 'add_funds', t.amount, 'USD',
       t.ref_table, t.ref_id, jsonb_build_object('note', t.note, 'kind', 'card_topup'), t.at
  FROM b4_tx t
 WHERE t.reason = 'topup'
ON CONFLICT (id) DO NOTHING;

-- The consolidated run, written as finance.fn_generate_consolidated_invoice writes it but with
-- deterministic ids (the ledger above points at one) and with the dates the invoices really had.
DO $$
DECLARE
    v_biz uuid := pg_temp.b4('biz:hf');
    v_inv uuid;
    v_start timestamptz;
    v_end timestamptz;
    v_sub bigint;
    v_fee bigint;
    v_due bigint;
    v_rows int;
BEGIN
    FOR k IN 1..6 LOOP
        v_start := pg_temp.b4_period_end(k + 1);
        v_end := pg_temp.b4_period_end(k);
        v_inv := pg_temp.b4('invoice:hf:' || k);
        SELECT COALESCE(sum(e.amount_cents + e.deadline_bonus_cents), 0), COALESCE(sum(e.platform_fee_cents), 0)
          INTO v_sub, v_fee
          FROM finance.escrows e
         WHERE e.payer_business_id = v_biz AND e.status = 'released' AND e.released_at >= v_start AND e.released_at < v_end;
        SELECT COALESCE(sum(t.amount_cents), 0) INTO v_due
          FROM finance.transactions t
         WHERE t.wallet_id = pg_temp.b4('wallet:hf') AND t.reason = 'on_account_credit'
           AND t.created_at >= v_start AND t.created_at < v_end;
        CONTINUE WHEN v_sub = 0 AND v_due = 0;

        INSERT INTO finance.invoices
            (id, issue_to_business_id, invoice_type, billing_period_start, billing_period_end, amount_cents, subtotal_cents,
             platform_fee_cents, tax_cents, total_cents, amount_due_cents, currency, status, due_date, paid_at, created_at)
        SELECT v_inv, v_biz, 'consolidated_monthly', v_start, v_end, v_sub, v_sub, v_fee, 0, v_sub, v_due, 'USD',
               CASE WHEN v_due > 0 AND k = 1 THEN 'issued' ELSE 'paid' END, v_end + interval '14 days',
               CASE WHEN v_due > 0 AND k = 1 THEN NULL WHEN v_due > 0 THEN pg_temp.b4_ago(31) ELSE v_end END, v_end
         WHERE NOT EXISTS (SELECT 1 FROM finance.invoices i
                            WHERE i.issue_to_business_id = v_biz AND i.billing_period_start = v_start AND i.currency = 'USD')
        ON CONFLICT (id) DO NOTHING;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        CONTINUE WHEN v_rows = 0;

        INSERT INTO finance.invoice_line_items (id, invoice_id, ref_type, ref_id, description, amount_cents, currency)
        SELECT pg_temp.b4('invoice-line:' || k || ':' || l.kind || ':' || e.id), v_inv, l.kind, e.id, l.label, l.amount, 'USD'
          FROM finance.escrows e
         CROSS JOIN LATERAL (VALUES
                ('escrow', 'Released escrow', e.amount_cents),
                ('platform_fee', 'Platform fee (included, deducted from the payee)', e.platform_fee_cents)) AS l(kind, label, amount)
         WHERE e.payer_business_id = v_biz AND e.status = 'released' AND e.released_at >= v_start AND e.released_at < v_end
           AND l.amount > 0
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO finance.invoice_line_items (id, invoice_id, ref_type, ref_id, description, amount_cents, currency)
        SELECT pg_temp.b4('invoice-line:' || k || ':on-account:' || t.id), v_inv, 'on_account', t.id, 'Bought on account',
               t.amount_cents, 'USD'
          FROM finance.transactions t
         WHERE t.wallet_id = pg_temp.b4('wallet:hf') AND t.reason = 'on_account_credit'
           AND t.created_at >= v_start AND t.created_at < v_end
        ON CONFLICT (id) DO NOTHING;
    END LOOP;
END $$;

-- The platform's own statement run, over the last six closed months of every funded vault. Its ids are
-- its own; uq_statement_period makes a second run return the row it already wrote.
DO $$
DECLARE
    r record;
    v_first timestamptz := date_trunc('month', now(), 'UTC');
BEGIN
    FOR r IN
        SELECT w.id, m.n
          FROM finance.wallets w
         CROSS JOIN generate_series(1, 6) AS m(n)
         WHERE w.id IN (SELECT pg_temp.b4('wallet:' || b.key) FROM b4_biz b)
    LOOP
        PERFORM finance.fn_generate_statement(r.id, v_first - r.n * interval '1 month',
                                              v_first - (r.n - 1) * interval '1 month');
    END LOOP;
END $$;
-- #endregion

-- #region Spend approvals
INSERT INTO finance.spend_approvals
    (id, wallet_id, requested_by, amount_cents, currency, reason, ref_table, ref_id, status, approver_user_id,
     decided_at, expires_at, consumed_at, consumed_ref_table, consumed_ref_id, created_at)
SELECT pg_temp.b4('approval:' || a.biz || ':' || a.key), pg_temp.b4('wallet:' || a.biz), pg_temp.b4_who(a.who), a.amount, 'USD',
       a.reason, a.ref_table, pg_temp.b4(a.ref_key), a.status::finance.approval_status, pg_temp.b4_who(a.approver),
       pg_temp.b4_ago(a.decided_d), pg_temp.b4_ago(a.d - 7), pg_temp.b4_ago(a.consumed_d),
       CASE WHEN a.consumed_d IS NOT NULL THEN a.ref_table END,
       CASE WHEN a.consumed_d IS NOT NULL THEN pg_temp.b4(a.ref_key) END, pg_temp.b4_ago(a.d)
  FROM (VALUES
        ('hf', 'launch', 'miguelsantos', 300000::bigint, 'Fund Launch and handover for the carrier portal. This would take me past my monthly limit.',
         'project_stages', 'stage:hf-portal:s4', 'pending', NULL, NULL::numeric, NULL::numeric, 2),
        ('hf', 'basket', 'danielokafor', 14400, 'Motion and 3D assets for the investor update. I am close to my weekly limit.',
         'baskets', 'basket:hf', 'pending', NULL, NULL, NULL, 1),
        ('hf', 'rates', 'miguelsantos', 960000, 'Fund the rate-card ticket on the carrier portal. Over my per-purchase limit.',
         'tickets', 'ticket:hf-portal:t5', 'approved', 'priyaraman', 19, 18, 20),
        ('hf', 'alerts', 'miguelsantos', 960000, 'Fund the delay alerts ticket on the carrier portal.',
         'tickets', 'ticket:hf-portal:t4', 'approved', 'me', 41, 40, 42),
        ('hf', 'dataroom', 'danielokafor', 180000, 'A second data room pass for the investor round.',
         'project_stages', 'stage:hf-dataroom:s1', 'rejected', 'me', 79, NULL, 81),
        ('hf', 'install', 'miguelsantos', 150000, 'Installation drawings for the signage. Withdrawn: the racking contractor slipped.',
         'project_stages', 'stage:hf-signage:s3', 'withdrawn', NULL, 22, NULL, 24),
        ('hf', 'pod', 'danielokafor', 960000, 'Proof-of-delivery upload for the carrier portal.',
         'tickets', 'ticket:hf-portal:t6', 'expired', NULL, NULL, NULL, 12),
        ('sp', 'mobile', 'miguelsantos', 250000, 'Fund the mobile view once Samuel accepts. Takes me past this month''s limit.',
         'project_stages', 'stage:sp-dashboard:s3', 'pending', NULL, NULL, NULL, 3),
        ('sp', 'alerts', 'miguelsantos', 600000, 'Fund the threshold alerts ticket.',
         'tickets', 'ticket:sp-dashboard:t2', 'approved', 'hannahcole', 13, 12, 14)
       ) AS a(biz, key, who, amount, reason, ref_table, ref_key, status, approver, decided_d, consumed_d, d)
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Channels and conversations
DROP TABLE IF EXISTS pg_temp.b4_channels;
CREATE TEMP TABLE b4_channels ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('hf', 'general', NULL, 'me', 420, 1.0),
    ('hf', 'ops-daily', 'Day-to-day running of the desk', 'priyaraman', 240, NULL::numeric),
    ('hf', 'finance-approvals', 'Spend, invoices and who is signing what', 'danielokafor', 200, 2.5),
    ('hf', 'carrier-portal', 'The portal rebuild, from the client side', 'miguelsantos', 180, 0.6),
    ('tw', 'general', NULL, 'me', 500, NULL),
    ('ac', 'general', NULL, 'theo', 130, 3.0),
    ('ac', 'autumn-range', 'Packaging for the autumn releases', 'noor', 30, 1.2),
    ('sp', 'general', NULL, 'hannahcole', 225, 4.0),
    ('sp', 'cold-chain', 'Dashboard and depot follow-ups', 'miguelsantos', 125, NULL),
    ('fp', 'general', NULL, 'noor', 9, 2.0)
) AS v(biz, slug, topic, creator, d, me_read_d);

DROP TABLE IF EXISTS pg_temp.b4_chat;
CREATE TEMP TABLE b4_chat ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('hf', 'general', 'me', 410.0, 'Welcome to Kestrel on Projective. Business chat lives here; anything about a specific project stays in its rooms.'),
    ('hf', 'general', 'priyaraman', 248.0, 'Glad to be in. I will move the operations notes over this week.'),
    ('hf', 'general', 'noor', 158.0, 'Thanks for having me. I will mostly watch the brand work and shout when something looks off.'),
    ('hf', 'general', 'danielokafor', 3.2, 'Reminder: month-end accruals close on Friday. Anything not in by then rolls over.'),
    ('hf', 'general', 'priyaraman', 0.8, 'Two new carriers signed for the pilot. I will share the list once the contracts are back.'),
    ('hf', 'ops-daily', 'priyaraman', 12.0, 'Morning. Jebel Ali gate delays are back to under an hour.'),
    ('hf', 'ops-daily', 'miguelsantos', 11.5, 'Good. The tracking team wants a real delay event for testing, so tell them if it happens again.'),
    ('hf', 'ops-daily', 'me', 7.0, 'Booking desk is short on Sunday. Can someone cover the morning shift?'),
    ('hf', 'ops-daily', 'priyaraman', 6.8, 'Covered. I moved one person from the afternoon.'),
    ('hf', 'finance-approvals', 'danielokafor', 21.0, 'The rate-card ticket needs an approval before Miguel can fund it. It is over his per-purchase limit.'),
    ('hf', 'finance-approvals', 'priyaraman', 19.0, 'Approved. It is in the budget for this quarter.'),
    ('hf', 'finance-approvals', 'danielokafor', 6.0, 'The balance is getting close to the floor. The monthly deposit lands soon, but we should plan the launch stage around it.'),
    ('hf', 'finance-approvals', 'miguelsantos', 1.9, 'Asked for sign-off on the launch stage. That takes me past my monthly limit.'),
    ('hf', 'finance-approvals', 'danielokafor', 0.9, 'And I have a small asset basket waiting on approval too.'),
    ('hf', 'carrier-portal', 'miguelsantos', 44.0, 'Delay alerts are funded. North Loop can start on them today.'),
    ('hf', 'carrier-portal', 'me', 30.0, 'The first carriers we showed the timeline to asked straight away if they could export it.'),
    ('hf', 'carrier-portal', 'miguelsantos', 2.5, 'Delay alerts are in review. Could one of us read through the wording before we accept?'),
    ('hf', 'carrier-portal', 'priyaraman', 0.4, 'I will take it this afternoon. The desk has opinions.'),
    ('tw', 'general', 'me', 180.0, 'We have agreed the sale of the catalogue. Migration starts next week.'),
    ('tw', 'general', 'miguelsantos', 176.0, 'Understood. I will get the supplier contacts ready to hand over.'),
    ('tw', 'general', 'me', 46.0, 'Everything is paid and handed over. I am closing the business down tomorrow. Thank you.'),
    ('ac', 'general', 'theo', 120.0, 'Bem-vindos. This is where we run the coffee side of things now.'),
    ('ac', 'general', 'noor', 88.0, 'Happy to be here. I will keep an eye on anything customer-facing.'),
    ('ac', 'general', 'me', 12.0, 'We still cannot fund anything until the verification clears. The registry extract is with them.'),
    ('ac', 'general', 'theo', 2.0, 'Chased again this morning. They say a few more days.'),
    ('ac', 'general', 'chloewinters', 0.7, 'Tasting notes for the Yirgacheffe are in the shared folder when you get a minute.'),
    ('ac', 'autumn-range', 'noor', 29.0, 'I want the autumn bags to feel heavier than the summer ones. Darker stock, less ink.'),
    ('ac', 'autumn-range', 'theo', 27.0, 'Agreed. The roasters also want the roast date bigger.'),
    ('ac', 'autumn-range', 'me', 5.0, 'Two applications in so far. The Atelier Nova one looks strongest.'),
    ('ac', 'autumn-range', 'noor', 0.9, 'Agree on Atelier Nova, but let us hear from Aiko before we decide.'),
    ('sp', 'general', 'hannahcole', 200.0, 'Welcome all. Weekly numbers go here every Monday.'),
    ('sp', 'general', 'danielokafor', 19.0, 'Spend this month is on plan. The trial of the Pro features has started.'),
    ('sp', 'general', 'hannahcole', 3.0, 'Two more independents in Kent signed for the spring range.'),
    ('sp', 'general', 'lenamueller', 1.1, 'Shop owners keep asking for smaller chilled cases. I will write it up.'),
    ('sp', 'cold-chain', 'miguelsantos', 79.0, 'Ingest is accepted. Next up, alerts.'),
    ('sp', 'cold-chain', 'me', 12.0, 'I have pulled the last quarter of excursions if the team needs real data for the thresholds.'),
    ('sp', 'cold-chain', 'miguelsantos', 11.0, 'Yes please. Drop it in the shared drive and I will pass it on.'),
    ('fp', 'general', 'noor', 8.0, 'Early days. I want to settle the name and the first list before we publish anything.'),
    ('fp', 'general', 'me', 7.0, 'Agreed. I will look at verification once we have registered.'),
    ('fp', 'general', 'noor', 1.0, 'Invited Chloe. No rush on money until the first title is confirmed.')
) AS v(biz, slug, who, d, body);

DROP TABLE IF EXISTS pg_temp.b4_groups;
CREATE TEMP TABLE b4_groups ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('hf', 'Kestrel leadership', 'me', ARRAY['me', 'priyaraman', 'danielokafor'], 200, 1.5),
    ('ac', 'Almeida launch crew', 'theo', ARRAY['me', 'theo', 'noor'], 40, NULL::numeric),
    ('sp', 'Saltmarsh supply check-in', 'hannahcole', ARRAY['me', 'hannahcole', 'miguelsantos'], 110, 2.2)
) AS v(biz, title, creator, people, d, me_read_d);

DROP TABLE IF EXISTS pg_temp.b4_gchat;
CREATE TEMP TABLE b4_gchat ON COMMIT DROP AS
SELECT * FROM (VALUES
    ('hf', 'priyaraman', 16.0, 'Board pack is due on the 20th. Can we agree the headline numbers this week?'),
    ('hf', 'me', 15.5, 'Yes. Let us lead with on-time delivery and the portal pilot.'),
    ('hf', 'danielokafor', 2.0, 'Draft is in the Finance folder. Cash is fine, but we are close to the floor until the deposit lands.'),
    ('hf', 'priyaraman', 0.5, 'Thanks. I will add the carrier numbers tonight.'),
    ('ac', 'theo', 22.0, 'If verification clears this month we can still hit the autumn dates.'),
    ('ac', 'me', 21.0, 'It will be tight. I will have everything ready to fund the day it does.'),
    ('sp', 'hannahcole', 30.0, 'Can you look at the excursion numbers before the depot review?'),
    ('sp', 'me', 29.0, 'On it. The Tuesday route is the outlier.'),
    ('sp', 'miguelsantos', 1.5, 'Alerts demo is ready whenever you are both free.')
) AS v(biz, who, d, body);

INSERT INTO comms.dm_threads (id, kind, owner_type, owner_entity_id, slug, topic, created_by_user_id, created_at)
SELECT pg_temp.b4('channel:' || c.biz || ':' || c.slug), 'entity_channel', 'business', pg_temp.b4('biz:' || c.biz), c.slug,
       c.topic, pg_temp.b4_who(c.creator), pg_temp.b4_ago(c.d)
  FROM b4_channels c
 WHERE c.slug <> 'general'
ON CONFLICT (id) DO NOTHING;

INSERT INTO comms.dm_messages (id, thread_id, sender_user_id, body, created_at)
SELECT pg_temp.b4('chat:' || m.biz || ':' || m.slug || ':' || m.d), pg_temp.b4_thread(m.biz, m.slug), pg_temp.b4_who(m.who),
       m.body, pg_temp.b4_ago(m.d)
  FROM b4_chat m
ON CONFLICT (id) DO NOTHING;

-- Everybody has read their channels up to the last message; the target is behind where `me_read_d` says.
UPDATE comms.dm_participants p
   SET last_read_at = CASE WHEN p.user_id = pg_temp.me() AND c.me_read_d IS NOT NULL
                           THEN pg_temp.b4_ago(c.me_read_d) ELSE l.last_at END
  FROM b4_channels c
  JOIN LATERAL (SELECT max(m.created_at) AS last_at FROM comms.dm_messages m
                 WHERE m.thread_id = pg_temp.b4_thread(c.biz, c.slug)) l ON true
 WHERE p.thread_id = pg_temp.b4_thread(c.biz, c.slug) AND p.last_read_at IS NULL;

INSERT INTO comms.dm_threads (id, kind, title, created_by_user_id, created_at)
SELECT pg_temp.b4('group:' || g.biz), 'group', g.title, pg_temp.b4_who(g.creator), pg_temp.b4_ago(g.d)
  FROM b4_groups g
ON CONFLICT (id) DO NOTHING;

INSERT INTO comms.dm_participants (id, thread_id, user_id, last_read_at, is_starred, joined_at)
SELECT pg_temp.b4('group-member:' || g.biz || ':' || w.who), pg_temp.b4('group:' || g.biz), pg_temp.b4_who(w.who),
       CASE WHEN w.who = 'me' AND g.me_read_d IS NOT NULL THEN pg_temp.b4_ago(g.me_read_d)
            ELSE (SELECT pg_temp.b4_ago(min(m.d)) FROM b4_gchat m WHERE m.biz = g.biz) END,
       false, pg_temp.b4_ago(g.d)
  FROM b4_groups g
 CROSS JOIN LATERAL unnest(g.people) AS w(who)
ON CONFLICT (id) DO NOTHING;

INSERT INTO comms.dm_messages (id, thread_id, sender_user_id, body, created_at)
SELECT pg_temp.b4('group-chat:' || m.biz || ':' || m.d), pg_temp.b4('group:' || m.biz), pg_temp.b4_who(m.who), m.body,
       pg_temp.b4_ago(m.d)
  FROM b4_gchat m
ON CONFLICT (id) DO NOTHING;

-- A project's rooms: its Discussion, a stage_all room per stage, and the client-side room of each stage
-- in flight. comms.get_stage_channels finds these and provisions only what is missing.
INSERT INTO comms.project_channels (id, project_id, name, stage_id, visibility, created_at)
SELECT pg_temp.b4('room:' || p.key || ':general'), pg_temp.b4('project:' || p.key), 'Discussion', NULL, 'project_all',
       pg_temp.b4_ago(p.created_d)
  FROM b4_projects p WHERE p.status <> 'draft'
UNION ALL
SELECT pg_temp.b4('room:' || s.project || ':' || s.key), pg_temp.b4('project:' || s.project), s.name,
       pg_temp.b4('stage:' || s.project || ':' || s.key), 'stage_all', pg_temp.b4_ago(p.created_d)
  FROM b4_stages s JOIN b4_projects p ON p.key = s.project WHERE p.status <> 'draft'
UNION ALL
SELECT pg_temp.b4('room:' || s.project || ':' || s.key || ':biz'), pg_temp.b4('project:' || s.project), s.name || ' — Business',
       pg_temp.b4('stage:' || s.project || ':' || s.key), 'business_private', pg_temp.b4_ago(p.created_d)
  FROM b4_stages s JOIN b4_projects p ON p.key = s.project WHERE s.status = 'in_progress'
ON CONFLICT (id) DO NOTHING;

INSERT INTO comms.project_channel_participants (id, channel_id, profile_type, profile_id, role)
SELECT pg_temp.b4('room-member:' || p.key || ':business'), pg_temp.b4('room:' || p.key || ':general'), 'business',
       pg_temp.b4('biz:' || p.biz), 'owner'
  FROM b4_projects p WHERE p.status <> 'draft'
ON CONFLICT (id) DO NOTHING;

INSERT INTO comms.project_channel_participants (id, channel_id, profile_type, profile_id, role)
SELECT pg_temp.b4('room-member:' || p.key || ':' || pp.profile_id), pg_temp.b4('room:' || p.key || ':general'), 'freelancer',
       pp.profile_id, 'participant'
  FROM b4_projects p
  JOIN projects.project_participants pp ON pp.project_id = pg_temp.b4('project:' || p.key) AND pp.profile_type = 'freelancer'
 WHERE p.status <> 'draft'
ON CONFLICT (id) DO NOTHING;

INSERT INTO comms.project_messages (id, channel_id, sender_user_id, body, created_at)
SELECT pg_temp.b4('room-chat:' || m.project || ':' || m.room || ':' || m.d), pg_temp.b4('room:' || m.project || ':' || m.room),
       pg_temp.b4_who(m.who), m.body, pg_temp.b4_ago(m.d)
  FROM (VALUES
        ('hf-portal', 'general', 'me', 198.0, 'Thanks for joining. The brief is in the project files, and the booking desk is expecting your questions.'),
        ('hf-portal', 'general', 'marisdelacroix', 188.0, 'Interviews are booked for next week. I will post the themes as they come up.'),
        ('hf-portal', 'general', 'kwamemensah', 108.0, 'North Loop is on the tracking stage. We will start from the carrier feeds.'),
        ('hf-portal', 'general', 'me', 4.0, 'Pilot carriers are confirmed for next month, so the alerts need to be ready by then.'),
        ('hf-portal', 's3', 'tomaszwojcik', 62.0, 'Timeline replay matched every event from last month. Ready for review.'),
        ('hf-portal', 's3', 'me', 60.5, 'Accepted, nice work. Payment is on its way.'),
        ('hf-portal', 's3', 'samuelnkemelu', 3.0, 'Delay alerts are in review. The wording is the only open question.'),
        ('hf-portal', 's3', 'tomaszwojcik', 1.0, 'Rate-card upload parses all the sample files now. Starting on the lane checks.'),
        ('hf-portal', 's3:biz', 'miguelsantos', 2.4, 'The alert wording reads a bit harsh for shippers. Can we soften it before we accept?'),
        ('hf-portal', 's3:biz', 'priyaraman', 0.6, 'Yes. I will send suggestions to Samuel today.'),
        ('hf-guide', 'general', 'inesduarte', 90.0, 'First layout is up. The Arabic edition follows once you sign off the English.'),
        ('hf-guide', 'general', 'priyaraman', 72.0, 'Signed off. The drivers we showed it to loved the depot map.'),
        ('hf-signage', 'general', 'miguelsantos', 44.0, 'Direction two is approved. Inês is taking the artwork.'),
        ('hf-signage', 'general', 'inesduarte', 27.0, 'Zone signs are drafted. I will hold the rest until the racking is confirmed.'),
        ('hf-signage', 'general', 'miguelsantos', 8.0, 'Putting this on hold: the racking contractor slipped by a month.'),
        ('tw-catalogue', 'general', 'kwamemensah', 168.0, 'Profiling is running. Expect a lot of duplicates in the filters range.'),
        ('tw-catalogue', 'general', 'tomaszwojcik', 64.0, 'Second import reconciles to the stock count. Four records to check, listed in the note.'),
        ('ac-packaging', 'general', 'me', 3.0, 'Heads up for anyone applying: we cannot fund until our verification clears. It should be days, not weeks.'),
        ('ac-loyalty', 'general', 'kwamemensah', 13.0, 'Happy to start as soon as the stage is funded.'),
        ('ac-loyalty', 'general', 'theo', 2.0, 'Thanks for your patience. The verification is the last thing we are waiting on.'),
        ('sp-dashboard', 'general', 'kwamemensah', 118.0, 'All three carriers are feeding the stream now.'),
        ('sp-dashboard', 's2', 'samuelnkemelu', 2.0, 'First pass at the thresholds is live on staging.'),
        ('sp-dashboard', 's2', 'hannahcole', 1.0, 'Looks right for chilled. Ambient can be looser.'),
        ('sp-relaunch', 'general', 'inesduarte', 104.0, 'Tray artwork passed preflight. Files are with the printer.')
       ) AS m(project, room, who, d, body)
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Calendar and files
-- Stage and ticket deadlines already reach the Calendar tab; these are the project meetings around them.
INSERT INTO scheduling.events
    (id, project_id, channel_id, kind, status, title, starts_at, ends_at, meeting_provider, meeting_provider_label,
     meeting_details, meeting_pending, meta, created_by, created_at)
SELECT pg_temp.b4('event:' || e.project || ':' || e.key), pg_temp.b4('project:' || e.project),
       pg_temp.b4('room:' || e.project || ':general'), 'sync'::scheduling.event_kind, 'confirmed'::scheduling.event_status,
       e.title,
       (date_trunc('week', now() AT TIME ZONE e.tz) + e.day * interval '1 day' + e.minute * interval '1 minute') AT TIME ZONE e.tz,
       (date_trunc('week', now() AT TIME ZONE e.tz) + e.day * interval '1 day' + (e.minute + e.length) * interval '1 minute') AT TIME ZONE e.tz,
       e.provider, e.provider_label, e.details, e.pending, 'Project meeting', pg_temp.b4_who(e.who), pg_temp.b4_ago(10)
  FROM (VALUES
        ('hf-portal', 'weekly', 'Carrier portal weekly', 'Asia/Dubai', 1, 600, 45, 'google', 'Google Meet', NULL, true, 'me'),
        ('hf-portal', 'pilot', 'Pilot readiness review', 'Asia/Dubai', 10, 780, 60, 'custom', 'In person', 'Kestrel office, Jebel Ali', false, 'priyaraman'),
        ('sp-dashboard', 'demo', 'Alerts demo', 'Europe/London', 3, 840, 30, 'google', 'Google Meet', NULL, true, 'miguelsantos')
       ) AS e(project, key, title, tz, day, minute, length, provider, provider_label, details, pending, who)
ON CONFLICT (id) DO NOTHING;

INSERT INTO files.folders (id, owner_user_id, name, owner_type, owner_entity_id, path, created_at)
SELECT pg_temp.b4('folder:' || f.biz || ':' || f.key), pg_temp.b4_who(f.who), f.name, 'business', pg_temp.b4('biz:' || f.biz),
       '{}'::text[], pg_temp.b4_ago(f.d)
  FROM (VALUES
        ('hf', 'contracts', 'Contracts', 'priyaraman', 200), ('hf', 'finance', 'Finance', 'danielokafor', 180),
        ('hf', 'brand', 'Brand', 'noor', 150), ('ac', 'autumn', 'Autumn range', 'noor', 30),
        ('sp', 'compliance', 'Compliance', 'hannahcole', 120), ('tw', 'handover', 'Handover', 'me', 60)
       ) AS f(biz, key, name, who, d)
ON CONFLICT (id) DO NOTHING;

-- SQL cannot upload a binary, so the drive holds links: a real product state that needs no stored object.
INSERT INTO files.items
    (id, owner_user_id, folder_id, bucket_id, storage_path, display_name, original_name, mime_type, size_bytes,
     status, source, visibility, owner_type, owner_entity_id, link_url, link_domain, link_title, link_scan_status,
     link_scanned_at, created_at)
SELECT l.id, pg_temp.b4_who(l.who), CASE WHEN l.folder IS NOT NULL THEN pg_temp.b4('folder:' || l.biz || ':' || l.folder) END,
       'link', l.id::text, l.title, l.url, 'text/uri-list', 0, 'uploaded', 'link', 'private', 'business',
       pg_temp.b4('biz:' || l.biz), l.url, 'docs.example.com', l.title, 'safe', pg_temp.b4_ago(l.d), pg_temp.b4_ago(l.d)
  FROM (SELECT pg_temp.b4('file:' || v.biz || ':' || v.title) AS id, v.*
          FROM (VALUES
                ('hf', 'contracts', 'Carrier framework agreement', 'https://docs.example.com/kestrel/carrier-framework', 'priyaraman', 190),
                ('hf', 'contracts', 'Warehouse lease summary', 'https://docs.example.com/kestrel/warehouse-lease', 'priyaraman', 120),
                ('hf', 'finance', 'Board pack draft', 'https://docs.example.com/kestrel/board-pack', 'danielokafor', 2),
                ('hf', 'finance', 'Quarterly cash forecast', 'https://docs.example.com/kestrel/cash-forecast', 'danielokafor', 28),
                ('hf', 'brand', 'Brand guidelines', 'https://docs.example.com/kestrel/brand-guidelines', 'noor', 150),
                ('hf', NULL, 'Team handbook', 'https://docs.example.com/kestrel/handbook', 'me', 300),
                ('ac', 'autumn', 'Yirgacheffe tasting notes', 'https://docs.example.com/almeida/tasting-notes', 'chloewinters', 1),
                ('ac', 'autumn', 'Bag sizes and dielines', 'https://docs.example.com/almeida/dielines', 'noor', 25),
                ('sp', 'compliance', 'Chilled delivery SOP', 'https://docs.example.com/saltmarsh/chilled-sop', 'hannahcole', 118),
                ('sp', NULL, 'Spring range price list', 'https://docs.example.com/saltmarsh/price-list', 'danielokafor', 40),
                ('tw', 'handover', 'Catalogue sale agreement', 'https://docs.example.com/ashgrove/sale-agreement', 'me', 62)
               ) AS v(biz, folder, title, url, who, d)) l
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Notifications
INSERT INTO comms.notifications
    (id, user_id, type, title, body, category, urgency, channels, actor_user_id, context_type, context_id, action_url,
     read_at, seen_at, created_at)
SELECT pg_temp.b4('notification:' || n.key), pg_temp.me(), nt.key, n.title, n.body, nt.category, nt.urgency, nt.default_channels,
       pg_temp.b4_who(n.actor), 'business', pg_temp.b4('biz:' || n.biz),
       '/businesses/' || pg_temp.b4_handle(b.base) || n.path, pg_temp.b4_ago(n.read_d), pg_temp.b4_ago(n.read_d), pg_temp.b4_ago(n.d)
  FROM (VALUES
        ('launch', 'spend_approval.requested', 'hf', 'A spend needs your approval', 'Fund Launch and handover for the carrier portal.', 'miguelsantos', '/spend', 2.0, NULL::numeric),
        ('basket', 'spend_approval.requested', 'hf', 'A spend needs your approval', 'Motion and 3D assets for the investor update.', 'danielokafor', '/spend', 1.0, NULL),
        ('invoice', 'invoice.issued', 'hf', 'Monthly invoice issued', 'Your USD invoice is ready, with an amount due for what was bought on account.', NULL, '/billing', 6.0, 5.0),
        ('join', 'business.join_request', 'hf', 'Juno Park asked to join', 'Juno Park asked to join Kestrel Freight through your invite link.', 'juno', '/members', 2.0, NULL),
        ('ac-join', 'business.join_request', 'ac', 'Inês Duarte asked to join', 'Inês Duarte asked to join Almeida Coffee Co.', 'inesduarte', '/members', 1.0, NULL),
        ('bw-invite', 'business.invite', 'bw', 'You are invited to Brightwater Cycles', 'Miguel Santos invited you to join Brightwater Cycles as an Admin.', 'miguelsantos', '', 2.0, NULL)
       ) AS n(key, type, biz, title, body, actor, path, d, read_d)
  JOIN comms.notification_types nt ON nt.key = n.type
  JOIN b4_biz b ON b.key = n.biz
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Summary
SELECT b.name || ' — ' || CASE WHEN i.id IS NOT NULL AND m.role IS NULL THEN 'invited' ELSE COALESCE(r.name, m.role) END
           || ' · KYB ' || p.kyb_status || ' · ' || p.status
           || ' · ' || (SELECT pl.label FROM finance.plans pl WHERE pl.id = finance.fn_active_plan('business', p.id)) AS item,
       (SELECT count(*) FROM org.business_members x WHERE x.business_id = p.id AND x.status = 'active') AS count
  FROM b4_biz b
  JOIN org.business_profiles p ON p.id = pg_temp.b4('biz:' || b.key)
  LEFT JOIN org.business_members m ON m.business_id = p.id AND m.user_id = pg_temp.me()
  LEFT JOIN org.business_roles r ON r.id = m.role_id
  LEFT JOIN org.org_invitations i ON i.business_id = p.id AND i.target_user_id = pg_temp.me() AND i.status = 'pending'
UNION ALL SELECT 'Projects', count(*) FROM projects.projects WHERE id IN (SELECT pg_temp.b4('project:' || key) FROM b4_projects)
UNION ALL SELECT 'Stages', count(*) FROM projects.project_stages WHERE project_id IN (SELECT pg_temp.b4('project:' || key) FROM b4_projects)
UNION ALL SELECT 'Tickets', count(*) FROM projects.tickets WHERE project_id IN (SELECT pg_temp.b4('project:' || key) FROM b4_projects)
UNION ALL SELECT 'Escrows', count(*) FROM finance.escrows WHERE payer_business_id IN (SELECT pg_temp.b4('biz:' || key) FROM b4_biz)
UNION ALL SELECT 'Vault ledger rows', count(*) FROM finance.transactions WHERE wallet_id IN (SELECT pg_temp.b4('wallet:' || key) FROM b4_biz)
UNION ALL SELECT 'Invoices', count(*) FROM finance.invoices WHERE issue_to_business_id IN (SELECT pg_temp.b4('biz:' || key) FROM b4_biz)
UNION ALL SELECT 'Statements', count(*) FROM finance.statements WHERE owner_type = 'business' AND owner_id IN (SELECT pg_temp.b4('biz:' || key) FROM b4_biz)
UNION ALL SELECT 'Spend approvals', count(*) FROM finance.spend_approvals WHERE wallet_id IN (SELECT pg_temp.b4('wallet:' || key) FROM b4_biz)
UNION ALL SELECT 'Product orders', count(*) FROM finance.orders WHERE owner_type = 'business' AND owner_id IN (SELECT pg_temp.b4('biz:' || key) FROM b4_biz)
UNION ALL SELECT 'Channel and group messages', count(*) FROM comms.dm_messages WHERE id IN (SELECT pg_temp.b4('chat:' || biz || ':' || slug || ':' || d) FROM b4_chat UNION ALL SELECT pg_temp.b4('group-chat:' || biz || ':' || d) FROM b4_gchat)
UNION ALL SELECT 'Project room messages', count(*) FROM comms.project_messages WHERE channel_id IN (SELECT id FROM comms.project_channels WHERE project_id IN (SELECT pg_temp.b4('project:' || key) FROM b4_projects));
-- #endregion

COMMIT;
