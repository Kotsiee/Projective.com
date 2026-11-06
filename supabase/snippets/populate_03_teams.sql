-- =============================================================================================
-- populate_03_teams.sql — six teams around one account, with everything a team accumulates.
--
-- What it fills: Harbourline Studio and Fieldnote Labs (the target owns them), Slipway Motion (admin),
-- Longhand Editorial (lead), Tidewater Collective (plain member, read-only on money and admin), and
-- Marlowe Type Foundry, which the target has only been invited to. Each owned or joined team gets its
-- roster with titles, grants and an org chart, a pending invitation, a join request and an invite
-- link; published products and services with sales; channels with threaded messages and per-person
-- read state; group, direct and inquiry conversations; a treasury with a one-pass ledger, split rule,
-- stakes, released escrows and vault retention, product income, pots, audit rows, payouts or a vault
-- distribution; work for two persona-owned client businesses (Castellan Freight, Brightwater Clinics);
-- a drive of folders and links, reviews, followers, and Standing.
--
-- Where it shows: /teams, /teams/<handle> and its modules (Overview, Projects, Catalogue, Calendar,
-- Files, Channels, Members, Invitations, Roles, Finance, Payouts, Analytics, Standing, Settings),
-- /wallet?wallet=team:<id>, /messages, and each team's public profile at /@<handle>.
--
-- How to run: open this file in Supabase Studio (localhost:54323) and press Run. It runs as role
-- `postgres`, shows only the summary at the end, and is safe to run twice. From a shell:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/snippets/populate_03_teams.sql
--
-- To populate somebody else: change the username in the `snippet.username` line below.
--
-- Money: this script writes the ledgers of the wallets it creates (the team treasuries and the client
-- businesses). Shares of a release are recorded in finance.payout_splits for every shareholder, but
-- no personal wallet is credited: the target's is written only by populate_07_wallet.sql, which reads
-- those rows, and a persona's is seeded and stays as it is.
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

-- #region This script's helpers
SELECT pg_temp.ensure_verified();

/** A moment `p_days` ago (negative: ahead). */
CREATE OR REPLACE FUNCTION pg_temp.t3_ago(p_days numeric) RETURNS timestamptz
LANGUAGE sql STABLE AS $$
    SELECT now() - make_interval(secs => (p_days * 86400)::double precision);
$$;

/** A person by roster key: `me` is the target, anything else a seed persona's username. */
CREATE OR REPLACE FUNCTION pg_temp.t3_who(p_person text) RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT CASE p_person WHEN 'me' THEN pg_temp.me() ELSE pg_temp.persona(p_person) END;
$$;

/** A globally unique handle or address part: the base plus a short target-derived suffix. */
CREATE OR REPLACE FUNCTION pg_temp.t3_handle(p_base text) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT p_base || '-' || substr(pg_temp.me()::text, 1, 4);
$$;

CREATE OR REPLACE FUNCTION pg_temp.t3_team(p_key text) RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT pg_temp.sid('t03:team:' || p_key);
$$;

CREATE OR REPLACE FUNCTION pg_temp.t3_biz(p_key text) RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT pg_temp.sid('t03:business:' || p_key);
$$;

/** A seeded image by a fragment of its path; storage forbids a second row on one object, so rows are shared. */
CREATE OR REPLACE FUNCTION pg_temp.t3_asset(p_path text) RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT i.id FROM files.items i
     WHERE i.visibility = 'public' AND i.storage_path LIKE '%' || p_path || '%'
     ORDER BY i.id LIMIT 1;
$$;

/** A team's role by preset or custom name. */
CREATE OR REPLACE FUNCTION pg_temp.t3_role_of(p_team uuid, p_role text) RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT r.id FROM org.team_roles r WHERE r.team_id = p_team AND (r.preset = p_role OR r.name = p_role);
$$;

/** The wallet a team key or business key holds. */
CREATE OR REPLACE FUNCTION pg_temp.t3_vault(p_owner_type text, p_owner_id uuid) RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT w.id FROM finance.wallets w
     WHERE w.owner_type = p_owner_type AND w.owner_id = p_owner_id AND w.currency = 'USD';
$$;
-- #endregion

-- #region Clients: persona-owned businesses with money of their own
DROP TABLE IF EXISTS z_biz;
CREATE TEMP TABLE z_biz AS
SELECT v.*, pg_temp.t3_biz(v.key) AS id, pg_temp.t3_who(v.owner) AS owner_id, pg_temp.t3_handle(v.base) AS handle
  FROM (VALUES
    ('castellan', 'Castellan Freight', 'castellan', 'Castellan Freight Ltd', 'hannahcole', 'GB', 'Felixstowe',
     'Europe/London', 'GB318440277', 'Container haulage and last-mile freight across the East Coast ports.',
     'A family-run haulier that moved from paper dockets to its own driver and dispatch tools in two years.', 215),
    ('brightwater', 'Brightwater Clinics', 'brightwater', 'Brightwater Clinics LLC', 'miguelsantos', 'AE', 'Dubai',
     'Asia/Dubai', 'AE100394227', 'Outpatient clinics built around short waits and clear information.',
     'Eleven outpatient clinics across the Gulf, with a patient portal and in-house wayfinding programme.', 175)
  ) AS v(key, name, base, legal, owner, country, city, tz, tax_id, headline, bio, created_days);

INSERT INTO org.business_profiles
    (id, owner_user_id, name, slug, legal_name, country, billing_email, plan, headline, bio, languages, timezone,
     default_currency, tax_id, address_city, invoicing_mode, status, kyb_status, kyb_verified_at, kyb_provider_ref,
     visibility, created_at)
SELECT b.id, b.owner_id, b.name, b.handle, b.legal, b.country, 'accounts@' || b.handle || '.example', 'free',
       b.headline, jsonb_build_object('text', b.bio), ARRAY['English'], b.tz, 'USD', b.tax_id, b.city,
       'per_transaction', 'active', 'verified', pg_temp.t3_ago(b.created_days - 5), 'acct_snippet_' || b.handle,
       'public', pg_temp.t3_ago(b.created_days)
  FROM z_biz b
ON CONFLICT (id) DO NOTHING;

SELECT org.fn_seed_preset_roles('business', b.id)
  FROM z_biz b
 WHERE NOT EXISTS (SELECT 1 FROM org.business_roles r WHERE r.business_id = b.id);

INSERT INTO org.business_members (id, business_id, user_id, role_id, status, title, joined_at, created_at)
SELECT pg_temp.sid('t03:business-member:' || b.key), b.id, b.owner_id, r.id, 'active', 'Managing director',
       pg_temp.t3_ago(b.created_days), pg_temp.t3_ago(b.created_days)
  FROM z_biz b
  JOIN org.business_roles r ON r.business_id = b.id AND r.preset = 'owner'
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.verification_cases
    (id, subject_type, subject_id, kind, status, tier, provider, provider_ref, submitted_at, decided_at)
SELECT pg_temp.sid('t03:kyb:' || b.key), 'business', b.id, 'kyb', 'verified', 3, 'stripe_identity',
       'acct_snippet_' || b.handle, pg_temp.t3_ago(b.created_days - 4), pg_temp.t3_ago(b.created_days - 5)
  FROM z_biz b
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.wallets (owner_type, owner_id, currency, created_at)
SELECT 'business', b.id, 'USD', pg_temp.t3_ago(b.created_days) FROM z_biz b
ON CONFLICT (owner_type, owner_id, currency) DO NOTHING;

INSERT INTO finance.payment_methods
    (id, owner_type, owner_id, method_role, provider, external_ref, label, brand, last4, is_default_funding, status, created_at)
SELECT pg_temp.sid('t03:funding:' || b.key), 'business', b.id, 'funding', 'stripe', 'pm_snippet_' || b.handle,
       b.name || ' card', 'visa', '4242', true, 'active', pg_temp.t3_ago(b.created_days)
  FROM z_biz b
ON CONFLICT (id) DO NOTHING;

UPDATE comms.dm_threads c
   SET created_at = b.created_at
  FROM org.business_profiles b
 WHERE b.id IN (SELECT id FROM z_biz) AND c.kind = 'entity_channel' AND c.owner_type = 'business'
   AND c.owner_entity_id = b.id AND c.created_at > b.created_at;
-- #endregion

-- #region Teams: identity, roles, rosters, stakes, split rules, plans, treasuries
DROP TABLE IF EXISTS z_team;
CREATE TEMP TABLE z_team AS
SELECT v.*, pg_temp.t3_team(v.key) AS id, pg_temp.t3_who(v.owner) AS owner_id, pg_temp.t3_handle(v.base) AS handle
  FROM (VALUES
    -- Thriving and established: the target's main studio, public, on Pro, co-op with a 10% vault.
    ('harbour', 'Harbourline Studio', 'harbourline', 'me',
     'Product design and engineering for operations-heavy businesses.',
     'A small studio that designs and ships the tools logistics, health and field teams run on. We work in fixed stages with a named lead on every one, so a client always knows who owns the next delivery.',
     'public', 'pro', 'co_op', 1000, NULL::text, NULL::integer, 400,
     'logos/lumen-bank.jpg', 'ar-paying-step-by-step/banner_7.jpg'),
    -- Small and new: invite-only, free, no mark yet, so the setup hero still has work to ask for.
    ('fieldnote', 'Fieldnote Labs', 'fieldnote', 'me',
     'Illustration-led wayfinding for clinics and public spaces.',
     'Two people who think signs should explain themselves. We are taking on our first clients and keeping the team deliberately small.',
     'invite_only', 'free', 'co_op', 500, NULL, NULL, 38, NULL, NULL),
    -- Treasury running low: a Pro team on a finder''s fee, the target is its admin.
    ('slipway', 'Slipway Motion', 'slipway', 'renkoda',
     'Brand films and product motion, from storyboard to final grade.',
     'A motion studio for companies with something physical to show. Ren finds the work, the crew makes it, and the finder''s fee is written into every release.',
     'public', 'pro', 'finders_fee', 1000, 'renkoda', 1000, 300,
     'logos/halcyon-motion.png', 'ar-getting-started/banner_5.jpg'),
    -- Unlisted, free and at its seat cap; the target leads delivery here.
    ('longhand', 'Longhand Editorial', 'longhand', 'saoirsebyrne',
     'Long-form writing and editing for reports people actually finish.',
     'Editors and designers who turn annual reports and white papers into something a board member reads to the end.',
     'unlisted', 'free', 'co_op', 1500, NULL, NULL, 260,
     'ar-running-a-small-team/cover.jpg', 'ar-running-a-small-team/banner_3.jpg'),
    -- Benevolent dictator: every release goes to the vault and the owner distributes by hand. The target
    -- is a plain Member with no stake, so money and admin are closed to them.
    ('tidewater', 'Tidewater Collective', 'tidewater', 'kwamemensah',
     'Data products for ports, terminals and inland shipping.',
     'A collective of engineers and analysts who have spent years in port authorities. Kwame runs the treasury and pays out when a project closes.',
     'public', 'pro', 'benevolent_dictator', 10000, NULL, NULL, 200,
     'ar-escrow-explained/cover.jpg', 'ar-escrow-explained/banner_4.jpg'),
    -- Not the target''s team: it exists so /teams has an invitation waiting for an answer.
    ('marlowe', 'Marlowe Type Foundry', 'marlowe', 'marisdelacroix',
     'Custom typefaces for brands that read at every size.',
     'A two-person foundry drawing custom type for editorial and wayfinding clients.',
     'public', 'free', 'co_op', 1000, NULL, NULL, 90, 'ar-hiring-a-team/cover.jpg', NULL)
  ) AS v(key, name, base, owner, headline, bio, visibility, tier, rule, vault_bp, finder, finder_bp, created_days,
         avatar, banner);

INSERT INTO org.teams
    (id, owner_user_id, name, slug, avatar_file_id, banner_file_id, headline, bio, visibility, subscription_tier,
     payout_model, available_since, status, created_at)
SELECT t.id, t.owner_id, t.name, t.handle, pg_temp.t3_asset(t.avatar), pg_temp.t3_asset(t.banner), t.headline,
       jsonb_build_object('text', t.bio), t.visibility, t.tier, 'split_rules', pg_temp.t3_ago(least(t.created_days, 14)),
       'active', pg_temp.t3_ago(t.created_days)
  FROM z_team t
ON CONFLICT (id) DO NOTHING;

SELECT org.fn_seed_preset_roles('team', t.id)
  FROM z_team t
 WHERE NOT EXISTS (SELECT 1 FROM org.team_roles r WHERE r.team_id = t.id);

INSERT INTO org.team_roles (id, team_id, name, summary, preset, base_preset, capabilities)
SELECT pg_temp.sid('t03:team-role:' || v.team || ':' || v.name), pg_temp.t3_team(v.team), v.name, v.summary, NULL, v.base,
       v.caps::org.workspace_capability[]
  FROM (VALUES
    ('harbour', 'Delivery manager', 'Runs delivery and client seats, and reads the audit trail; no say over money.', 'lead',
     ARRAY['invite_members', 'bind_seat', 'manage_projects', 'publish_listings', 'spend_funds', 'view_analytics', 'view_audit']),
    ('slipway', 'Post supervisor', 'Owns the edit and the delivery masters, without touching the roster or the vault.', 'member',
     ARRAY['manage_projects', 'view_analytics'])
  ) AS v(team, name, summary, base, caps)
ON CONFLICT (id) DO NOTHING;

DROP TABLE IF EXISTS z_member;
CREATE TEMP TABLE z_member AS
SELECT v.*, pg_temp.t3_team(v.team) AS team_id, pg_temp.t3_who(v.person) AS user_id,
       pg_temp.sid('t03:team-member:' || v.team || ':' || v.person) AS id
  FROM (VALUES
    ('harbour', 'me', 'owner', 'Founder and principal designer', 4000, false, 400, NULL::text, '{}'::text[], '{}'::text[], NULL::integer),
    ('harbour', 'marisdelacroix', 'admin', 'Design director', 2500, true, 395, 'me', '{}', '{}', NULL),
    ('harbour', 'samuelnkemelu', 'Delivery manager', 'Engineering lead', 2000, false, 205, 'me', '{}', '{}', NULL),
    ('harbour', 'tomaszwojcik', 'member', 'Senior backend engineer', 1000, false, 170, 'samuelnkemelu', ARRAY['manage_projects'], '{}', NULL),
    ('harbour', 'aikotanaka', 'member', 'Illustrator', 500, false, 140, 'marisdelacroix', '{}', '{}', NULL),
    ('harbour', 'lenamueller', 'member', 'Content designer', 0, false, 190, NULL, '{}', '{}', 70),
    ('fieldnote', 'me', 'owner', 'Founder', 7000, false, 38, NULL, '{}', '{}', NULL),
    ('fieldnote', 'aikotanaka', 'member', 'Illustrator', 3000, false, 36, 'me', '{}', '{}', NULL),
    ('slipway', 'renkoda', 'owner', 'Creative director', 5500, false, 300, NULL, '{}', '{}', NULL),
    ('slipway', 'me', 'admin', 'Producer', 2500, false, 240, 'renkoda', ARRAY['withdraw_funds'], '{}', NULL),
    ('slipway', 'lenamueller', 'lead', 'Head of post', 1500, false, 190, 'me', '{}', '{}', NULL),
    ('slipway', 'tomaszwojcik', 'Post supervisor', 'Pipeline engineer', 500, false, 120, 'lenamueller', '{}', '{}', NULL),
    ('longhand', 'saoirsebyrne', 'owner', 'Editor-in-chief', 5000, false, 260, NULL, '{}', '{}', NULL),
    ('longhand', 'inesduarte', 'admin', 'Art director', 2000, false, 255, 'saoirsebyrne', '{}', '{}', NULL),
    ('longhand', 'me', 'lead', 'Managing editor', 3000, false, 200, 'saoirsebyrne', ARRAY['edit_profile'], '{}', NULL),
    ('tidewater', 'kwamemensah', 'owner', 'Managing partner', 6000, false, 200, NULL, '{}', '{}', NULL),
    ('tidewater', 'inesduarte', 'admin', 'Operations partner', 2500, false, 195, 'kwamemensah', '{}', '{}', NULL),
    ('tidewater', 'samuelnkemelu', 'lead', 'Technical lead', 1500, false, 190, 'kwamemensah', '{}', '{}', NULL),
    ('tidewater', 'me', 'member', 'Contract product designer', 0, false, 45, 'samuelnkemelu', '{}', ARRAY['view_analytics'], NULL),
    ('marlowe', 'marisdelacroix', 'owner', 'Type director', 8000, false, 90, NULL, '{}', '{}', NULL),
    ('marlowe', 'lenamueller', 'member', 'Editor', 2000, false, 85, 'marisdelacroix', '{}', '{}', NULL)
  ) AS v(team, person, role, title, bp, held, joined_days, reports_to, granted, revoked, left_days);

INSERT INTO org.team_members
    (id, team_id, user_id, role_id, status, invited_by, left_at, title, granted_capabilities, revoked_capabilities,
     joined_at, created_at)
SELECT m.id, m.team_id, m.user_id, pg_temp.t3_role_of(m.team_id, m.role),
       CASE WHEN m.left_days IS NULL THEN 'active' ELSE 'left' END,
       CASE WHEN m.role <> 'owner' THEN t.owner_id END,
       pg_temp.t3_ago(m.left_days), m.title, m.granted::org.workspace_capability[], m.revoked::org.workspace_capability[],
       pg_temp.t3_ago(m.joined_days), pg_temp.t3_ago(m.joined_days)
  FROM z_member m
  JOIN z_team t ON t.key = m.team
ON CONFLICT (id) DO NOTHING;

UPDATE org.team_members c
   SET reports_to = pg_temp.sid('t03:team-member:' || m.team || ':' || m.reports_to)
  FROM z_member m
 WHERE c.id = m.id AND m.reports_to IS NOT NULL
   AND c.reports_to IS NULL;

-- A departed member keeps a zero-stake row, which is what org.fn_rebalance_departed_stake leaves behind.
INSERT INTO finance.contribution_agreements (id, team_id, member_user_id, percent_bp, held)
SELECT pg_temp.sid('t03:stake:' || m.team || ':' || m.person), m.team_id, m.user_id, m.bp, m.held
  FROM z_member m
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.split_rules (id, team_id, rule_type, vault_bp, finder_user_id, finder_bp, active, created_at)
SELECT pg_temp.sid('t03:split-rule:' || t.key), t.id, t.rule::finance.split_rule_type, t.vault_bp,
       CASE WHEN t.finder IS NOT NULL THEN pg_temp.t3_who(t.finder) END, t.finder_bp, true, pg_temp.t3_ago(t.created_days)
  FROM z_team t
ON CONFLICT (id) DO NOTHING;

-- Finder's fee and benevolent dictator are Pro templates, and a Pro team has fifteen seats.
INSERT INTO finance.subscriptions
    (id, profile_id, subject_type, subject_id, plan_id, state, billing_interval, current_period_start,
     current_period_end, price_cents, currency, provider_ref, started_at)
SELECT pg_temp.sid('t03:subscription:' || t.key), t.id, 'team', t.id, (SELECT p.id FROM finance.plans p WHERE p.code = 'team_pro'),
       'active', 'monthly', pg_temp.t3_ago(9), pg_temp.t3_ago(-21), 2900, 'GBP', 'sub_snippet_' || t.handle,
       pg_temp.t3_ago(t.created_days - 30)
  FROM z_team t
 WHERE t.tier = 'pro'
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.wallets (owner_type, owner_id, currency, created_at)
SELECT 'team', t.id, 'USD', pg_temp.t3_ago(t.created_days) FROM z_team t
ON CONFLICT (owner_type, owner_id, currency) DO NOTHING;

UPDATE org.teams t
   SET treasury_wallet_id = pg_temp.t3_vault('team', t.id)
 WHERE t.id IN (SELECT id FROM z_team) AND t.treasury_wallet_id IS NULL;

UPDATE comms.dm_threads c
   SET created_at = t.created_at
  FROM org.teams t
 WHERE t.id IN (SELECT id FROM z_team) AND c.kind = 'entity_channel' AND c.owner_type = 'team'
   AND c.owner_entity_id = t.id AND c.created_at > t.created_at;

SELECT org.fn_refresh_membership_flags(pg_temp.me());
-- #endregion

-- #region Who wants in: invitations, invite links, join requests
INSERT INTO org.org_invitations
    (id, inviter_user_id, target_user_id, target_handle, team_id, team_role_id, token, note, status, expires_at, created_at)
SELECT pg_temp.sid('t03:invitation:' || v.team || ':' || v.target), pg_temp.t3_who(v.inviter), pg_temp.t3_who(v.target), u.username,
       pg_temp.t3_team(v.team), pg_temp.t3_role_of(pg_temp.t3_team(v.team), v.role),
       md5('invitation:' || pg_temp.me() || ':' || v.team) || md5(v.target),
       v.note, 'pending', pg_temp.t3_ago(v.days - 14), pg_temp.t3_ago(v.days)
  FROM (VALUES
    ('harbour', 'me', 'juno', 'member', 3,
     'We need frontend hands on the dispatch console for the next two stages. Your work on the Haddad site is what made us think of you.'),
    ('fieldnote', 'me', 'marisdelacroix', 'member', 6,
     'Would you sit in on our wayfinding crits? A small stake, mostly an excuse to borrow your eye.'),
    ('slipway', 'me', 'juno', 'member', 1,
     'Ren and I want someone who can build the interactive cut of the Castellan film.'),
    ('longhand', 'me', 'chloewinters', 'member', 2,
     'Your review notes were sharper than most editors. We have one seat left if you want to try long-form with us.'),
    ('tidewater', 'kwamemensah', 'tomaszwojcik', 'member', 4,
     'Terminal data is getting heavier. Could use your pipelines for the next quarter.'),
    ('marlowe', 'marisdelacroix', 'me', 'lead', 2,
     'We are drawing a wayfinding typeface and I would like you running delivery on it. You already know the signage problem better than anyone.')
  ) AS v(team, inviter, target, role, days, note)
  JOIN org.users_public u ON u.user_id = pg_temp.t3_who(v.target)
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.org_invite_links (id, team_id, team_role_id, token, status, created_by, created_at)
SELECT pg_temp.sid('t03:invite-link:' || t.key), t.id, pg_temp.t3_role_of(t.id, 'member'),
       'w-' || substr(md5('invite-link:' || pg_temp.me() || ':' || t.key), 1, 24), 'active', t.owner_id,
       pg_temp.t3_ago(least(t.created_days, 20))
  FROM z_team t
 WHERE t.key <> 'marlowe'
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.org_join_requests (id, team_id, requester_user_id, invite_link_id, team_role_id, message, status, created_at)
SELECT pg_temp.sid('t03:join-request:' || v.team), pg_temp.t3_team(v.team), pg_temp.t3_who(v.person),
       pg_temp.sid('t03:invite-link:' || v.team), pg_temp.t3_role_of(pg_temp.t3_team(v.team), 'member'), v.message, 'pending',
       pg_temp.t3_ago(v.days)
  FROM (VALUES
    ('harbour', 'kwamemensah', 2, 'Saw the telematics write-up. I have shipped three fleet integrations and would like to work on the next one.'),
    ('fieldnote', 'tomaszwojcik', 1, 'If you ever need the wayfinding data side built, I am interested.'),
    ('slipway', 'aikotanaka', 3, 'I would love to animate for you between illustration projects.'),
    ('longhand', 'renkoda', 5, NULL),
    ('tidewater', 'marisdelacroix', 8, 'Happy to help the dashboards read better.')
  ) AS v(team, person, days, message)
ON CONFLICT (id) DO NOTHING;

-- What the invitation and join-request doors notify, so /notifications and the roster's update dot agree.
INSERT INTO comms.notifications
    (id, user_id, type, title, body, category, urgency, channels, actor_user_id, context_type, context_id, action_url,
     entity_table, entity_id, read_at, seen_at, created_at)
SELECT pg_temp.sid('t03:notification:' || v.key), pg_temp.me(), nt.key, v.title, v.body, nt.category, nt.urgency,
       nt.default_channels, pg_temp.t3_who(v.actor), 'team', t.id, v.url, v.tbl, v.ref,
       CASE WHEN v.read_after IS NOT NULL THEN pg_temp.t3_ago(v.days - v.read_after) END,
       CASE WHEN v.read_after IS NOT NULL THEN pg_temp.t3_ago(v.days - v.read_after) END,
       pg_temp.t3_ago(v.days)
  FROM (VALUES
    ('invite:marlowe', 'team.invite', 'marlowe', 'marisdelacroix', 'Invitation to join Marlowe Type Foundry',
     'We are drawing a wayfinding typeface and I would like you running delivery on it.', '/teams',
     'org_invitations', pg_temp.sid('t03:invitation:marlowe:me'), 2::numeric, NULL::numeric),
    ('join:harbour', 'team.join_request', 'harbour', 'kwamemensah', 'Kwame Mensah asked to join Harbourline Studio',
     'Saw the telematics write-up. I have shipped three fleet integrations.', '/teams/' || pg_temp.t3_handle('harbourline') || '/members?view=pending',
     'org_join_requests', pg_temp.sid('t03:join-request:harbour'), 2, NULL),
    ('join:fieldnote', 'team.join_request', 'fieldnote', 'tomaszwojcik', 'Tomasz Wójcik asked to join Fieldnote Labs',
     'If you ever need the wayfinding data side built, I am interested.', '/teams/' || pg_temp.t3_handle('fieldnote') || '/members?view=pending',
     'org_join_requests', pg_temp.sid('t03:join-request:fieldnote'), 1, NULL),
    ('join:slipway', 'team.join_request', 'slipway', 'aikotanaka', 'Aiko Tanaka asked to join Slipway Motion',
     'I would love to animate for you between illustration projects.', '/teams/' || pg_temp.t3_handle('slipway') || '/members?view=pending',
     'org_join_requests', pg_temp.sid('t03:join-request:slipway'), 3, 2),
    ('join:longhand', 'team.join_request', 'longhand', 'renkoda', 'Ren Koda asked to join Longhand Editorial',
     'Through your invite link.', '/teams/' || pg_temp.t3_handle('longhand') || '/members?view=pending',
     'org_join_requests', pg_temp.sid('t03:join-request:longhand'), 5, 4)
  ) AS v(key, type, team, actor, title, body, url, tbl, ref, days, read_after)
  JOIN comms.notification_types nt ON nt.key = v.type
  JOIN z_team t ON t.key = v.team
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Catalogue: products and services, published as each team
DROP TABLE IF EXISTS z_product;
CREATE TEMP TABLE z_product AS
SELECT v.*, pg_temp.sid('t03:product:' || v.key) AS id, pg_temp.sid('t03:listing:' || v.key) AS listing_id,
       pg_temp.slug('prd', 't03:' || v.key) AS slug, pg_temp.t3_team(v.team) AS team_id
  FROM (VALUES
    ('dispatch-kit', 'harbour', 'Dispatch console UI kit', 'source_code', 'ui-kit', 8900, 'extended',
     'The tables, map panels and status chips from a working freight dispatch console, as typed Preact components.',
     '[{"name":"dispatch-console-kit.zip","label":"Source bundle","extension":".zip","bytes":18874368},{"name":"dispatch-console-kit.fig","label":"Design file","extension":".fig","bytes":44040192},{"name":"README.md","label":"Integration guide","extension":".md","bytes":524288}]',
     '[{"app":"Deno","versions":"2.x"},{"app":"TypeScript","versions":"5.4 and later"},{"app":"Figma","versions":"Current"}]',
     '[{"label":"Components","value":"46"},{"label":"Language","value":"TypeScript (strict)"},{"label":"Framework","value":"Preact 10"}]',
     2, 'pr-dashboard-blocks', 'sv-realtime-mvp-build', 120, ARRAY['typescript', 'design-systems', 'preact'], 842),
    ('onboarding-flows', 'harbour', 'Driver onboarding flow templates', 'template', 'templates', 4900, 'personal',
     'Twelve mobile onboarding flows for field staff, from licence capture to the first shift, with the copy already written.',
     '[{"name":"driver-onboarding-flows.fig","label":"Figma library","extension":".fig","bytes":28311552},{"name":"flow-copy.pdf","label":"Copy deck","extension":".pdf","bytes":3145728}]',
     '[{"app":"Figma","versions":"Current"}]',
     '[{"label":"Flows","value":"12"},{"label":"Screens","value":"74"},{"label":"Platforms","value":"iOS and Android"}]',
     1, 'pr-notion-ops-suite', 'sv-design-system-foundation', 95, ARRAY['ux', 'ux-writing', 'figma'], 516),
    ('blueprint-deck', 'harbour', 'Service blueprint workshop deck', 'template', 'templates', 2900, 'personal',
     'The half-day workshop we run with every new operations client, with facilitator notes and print templates.',
     '[{"name":"service-blueprint-workshop.pptx","label":"Workshop deck","extension":".pptx","bytes":15728640},{"name":"print-templates.pdf","label":"Print templates","extension":".pdf","bytes":6291456}]',
     '[{"app":"PowerPoint","versions":"2019 and later"},{"app":"Keynote","versions":"12 and later"}]',
     '[{"label":"Slides","value":"38"},{"label":"Duration","value":"Half a day"}]',
     1, 'pr-editorial-type-system', NULL, 60, ARRAY['ux-research', 'user-interviews'], 233),
    ('clinic-icons', 'fieldnote', 'Clinic wayfinding icon set', 'download', 'icons', 1900, 'personal',
     'Sixty pictograms for clinics and outpatient buildings, drawn to read at ten metres and tested with patients.',
     '[{"name":"clinic-wayfinding-icons.zip","label":"SVG and PDF set","extension":".zip","bytes":9437184}]',
     '[{"app":"Figma","versions":"Current"},{"app":"Illustrator","versions":"2022 and later"}]',
     '[{"label":"Pictograms","value":"60"},{"label":"Formats","value":"SVG, PDF"}]',
     1, 'pr-iconography-set', NULL, 14, ARRAY['illustration', 'a11y'], 57),
    ('title-pack', 'slipway', 'Motion titles starter pack', 'preset', 'presets', 3400, 'personal',
     'Thirty lower-thirds and title cards from our brand films, with the easing curves we actually use.',
     '[{"name":"motion-titles.aep","label":"After Effects project","extension":".aep","bytes":157286400},{"name":"motion-titles-preview.mov","label":"ProRes preview","extension":".mov","bytes":262144000}]',
     '[{"app":"After Effects","versions":"2022 and later"},{"app":"Premiere Pro","versions":"2022 and later"}]',
     '[{"label":"Titles","value":"30"},{"label":"Resolution","value":"4K"}]',
     1, 'pr-motion-primitives', 'sv-product-launch-film', 110, ARRAY['motion-design'], 388),
    ('style-sheet', 'longhand', 'Annual report style sheet', 'template', 'templates', 3900, 'personal',
     'The house style we hand to every annual report contributor: voice, numbers, charts and how to write a chair''s letter.',
     '[{"name":"annual-report-style-sheet.docx","label":"Style sheet","extension":".docx","bytes":1572864},{"name":"chart-rules.pdf","label":"Chart rules","extension":".pdf","bytes":2097152}]',
     '[{"app":"Word","versions":"2019 and later"},{"app":"Google Docs","versions":"Current"}]',
     '[{"label":"Pages","value":"44"},{"label":"Includes","value":"Contributor brief"}]',
     1, 'ar-paying-step-by-step/cover', NULL, 80, ARRAY['copywriting', 'editorial-design'], 174),
    ('berth-blocks', 'tidewater', 'Port operations dashboard blocks', 'source_code', 'ui-kit', 5900, 'extended',
     'Berth schedules, crane utilisation and tide windows as ready-made dashboard blocks.',
     '[{"name":"port-ops-blocks.zip","label":"Source bundle","extension":".zip","bytes":12582912}]',
     '[{"app":"Deno","versions":"2.x"},{"app":"Postgres","versions":"15 and later"}]',
     '[{"label":"Blocks","value":"18"},{"label":"Language","value":"TypeScript (strict)"}]',
     2, 'sv-realtime-mvp-build', NULL, 70, ARRAY['typescript', 'realtime', 'postgres'], 121)
  ) AS v(key, team, title, format, category, price, licence, summary, manifest, compat, specs, span, cover, frame,
         created_days, skills, views);

DROP TABLE IF EXISTS z_sale;
CREATE TEMP TABLE z_sale AS
SELECT v.*, pg_temp.sid('t03:order:' || v.key) AS order_id, pg_temp.sid('t03:order-line:' || v.key) AS line_id,
       p.team_id, p.title, p.price, p.licence, p.id AS product_id, p.manifest,
       (p.price * finance.fn_effective_commission_bp('team', p.team_id)) / 10000 AS fee,
       finance.fn_effective_commission_bp('team', p.team_id) AS fee_bp
  FROM (VALUES
    ('sale-1', 'dispatch-kit', 'theo', 96, 'Visa •••• 4242'),
    ('sale-2', 'dispatch-kit', 'noor', 61, 'Visa •••• 1881'),
    ('sale-3', 'dispatch-kit', 'hannahcole', 33, 'Mastercard •••• 4444'),
    ('sale-4', 'dispatch-kit', 'danielokafor', 12, 'Visa •••• 0005'),
    ('sale-5', 'onboarding-flows', 'theo', 52, 'Visa •••• 4242'),
    ('sale-6', 'onboarding-flows', 'priyaraman', 25, 'Amex •••• 0005'),
    ('sale-7', 'blueprint-deck', 'noor', 40, 'Visa •••• 1881'),
    ('sale-8', 'blueprint-deck', 'miguelsantos', 4, 'Visa •••• 9424'),
    ('sale-9', 'clinic-icons', 'theo', 6, 'Visa •••• 4242'),
    ('sale-10', 'title-pack', 'noor', 70, 'Visa •••• 1881'),
    ('sale-11', 'title-pack', 'theo', 15, 'Visa •••• 4242'),
    ('sale-12', 'style-sheet', 'priyaraman', 44, 'Amex •••• 0005'),
    ('sale-13', 'style-sheet', 'noor', 9, 'Visa •••• 1881'),
    ('sale-14', 'berth-blocks', 'danielokafor', 30, 'Visa •••• 0005')
  ) AS v(key, product, buyer, days, card)
  JOIN z_product p ON p.key = v.product;

INSERT INTO catalogue.products
    (id, slug, owner_user_id, owner_team_id, title, description, description_text, format, category, price_cents, currency,
     licence, attribution_required, file_manifest, compatibility, specs, span, created_at)
SELECT p.id, p.slug, t.owner_id, t.id, p.title, jsonb_build_object('html', '<p>' || p.summary || '</p>'), p.summary,
       p.format::catalogue.product_format, p.category, p.price, 'USD', p.licence::catalogue.product_licence, false, p.manifest::jsonb, p.compat::jsonb, p.specs::jsonb, p.span,
       pg_temp.t3_ago(p.created_days)
  FROM z_product p
  JOIN z_team t ON t.id = p.team_id
ON CONFLICT (id) DO NOTHING;

DROP TABLE IF EXISTS z_service;
CREATE TEMP TABLE z_service AS
SELECT v.*, pg_temp.sid('t03:service:' || v.key) AS id, pg_temp.sid('t03:listing:' || v.key) AS listing_id,
       pg_temp.slug('svc', 't03:' || v.key) AS slug, pg_temp.t3_team(v.team) AS team_id
  FROM (VALUES
    ('ops-sprint', 'harbour', 'Operations app discovery sprint', 'pipeline', 950000, 'product', '3-week delivery',
     'Three weeks from a messy operation to a tested service map, a prioritised backlog and a clickable prototype your drivers or nurses have already tried.',
     'sv-design-system-foundation', 2, 45000, 75, ARRAY['ux-research', 'prototyping', 'user-interviews'],
     ARRAY['Service blueprint of the current operation', 'Prioritised delivery backlog', 'Clickable prototype tested with staff'],
     '[{"name":"Field research","skills":["UX research","User interviews"],"priceCents":320000,"turnaround":"~1 week","description":"Shadow the people doing the work and map where the operation actually breaks.","deliverables":["Field notes","Service blueprint"]},{"name":"Prototype","skills":["Prototyping"],"priceCents":380000,"turnaround":"~1 week","description":"Turn the worst three breakpoints into a clickable prototype.","deliverables":["Clickable prototype"]},{"name":"Test and backlog","skills":["UX research"],"priceCents":250000,"turnaround":"~1 week","description":"Test with staff on shift and leave a delivery backlog your team can run.","deliverables":["Test report","Delivery backlog"]}]'),
    ('report-package', 'longhand', 'Annual report editorial package', 'one_off', 350000, 'content', '4-week delivery',
     'A managing editor, a contributor brief and two rounds of edits, so your annual report arrives written in one voice.',
     'sv-brand-identity-sprint', 2, 60000, 58, ARRAY['copywriting', 'editorial-design'],
     ARRAY['Contributor brief', 'Edited manuscript', 'Style sheet'], '[]')
  ) AS v(key, team, title, model, price, category, delivery, summary, cover, free_revisions, extra_price, created_days,
         skills, deliverables, stages);

INSERT INTO marketplace.service_blueprints
    (id, owner_type, owner_team_id, freelancer_profile_id, title, slug, description, description_text, delivery_model,
     pricing_model, price_cents, currency, category, cover_file_id, free_revisions, extra_revision_price_cents,
     requires_upfront_escrow, max_seats_per_cohort, allow_continuous_enrollment, intake_fields, stage_template, team_roles,
     deliverables, is_published, created_at)
SELECT s.id, 'team', s.team_id, t.owner_id, s.title, s.slug, jsonb_build_object('html', '<p>' || s.summary || '</p>'),
       s.summary, s.model::marketplace.service_delivery_model, 'flat_fee', s.price, 'USD', s.category, pg_temp.t3_asset(s.cover),
       s.free_revisions, s.extra_price, true, 1, false,
       '[{"id":"depth","kind":"radio","label":"How deep should this go?","slider":false,"options":[{"hint":"Polish what exists.","label":"Light touch","value":"light"},{"hint":"A proper pass with revisions.","label":"Standard","value":"standard"},{"hint":"Rethink it from the ground up.","label":"Deep","value":"deep"}],"multiple":false,"required":true}]'::jsonb,
       s.stages::jsonb, '[]'::jsonb, s.deliverables, true, pg_temp.t3_ago(s.created_days)
  FROM z_service s
  JOIN z_team t ON t.id = s.team_id
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalogue.listings
    (id, owner_user_id, owner_team_id, kind, status, service_blueprint_id, product_id, title, description, description_text,
     category, delivery_label, amount_cents, currency, free_revisions, extra_revision_price_cents, promoted, view_count,
     order_count, published_at, created_at)
SELECT p.listing_id, t.owner_id, t.id, 'product'::catalogue.listing_kind, 'published'::catalogue.listing_status, NULL::uuid, p.id, p.title,
       jsonb_build_object('html', '<p>' || p.summary || '</p>'), p.summary, p.category, 'Instant download', p.price, 'USD',
       NULL, NULL, false, p.views, (SELECT count(*) FROM z_sale z WHERE z.product = p.key),
       pg_temp.t3_ago(p.created_days - 1), pg_temp.t3_ago(p.created_days)
  FROM z_product p
  JOIN z_team t ON t.id = p.team_id
UNION ALL
SELECT s.listing_id, t.owner_id, t.id, 'service'::catalogue.listing_kind, 'published'::catalogue.listing_status, s.id, NULL::uuid, s.title,
       jsonb_build_object('html', '<p>' || s.summary || '</p>'), s.summary, s.category, s.delivery, s.price, 'USD',
       s.free_revisions, s.extra_price, false, s.created_days * 9, 0, pg_temp.t3_ago(s.created_days - 1),
       pg_temp.t3_ago(s.created_days)
  FROM z_service s
  JOIN z_team t ON t.id = s.team_id
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalogue.listing_media (id, listing_id, file_id, kind, alt_text, position)
SELECT pg_temp.sid('t03:listing-media:' || x.listing_id || ':' || x.position), x.listing_id, pg_temp.t3_asset(x.path), 'image',
       CASE WHEN x.position = 1 THEN x.title ELSE x.title || ' in use' END, x.position
  FROM (
    SELECT p.listing_id, p.title, p.cover AS path, 1 AS position FROM z_product p
    UNION ALL SELECT p.listing_id, p.title, p.frame, 2 FROM z_product p WHERE p.frame IS NOT NULL
    UNION ALL SELECT s.listing_id, s.title, s.cover, 1 FROM z_service s
  ) x
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalogue.listing_skills (listing_id, skill_id)
SELECT x.listing_id, s.id
  FROM (SELECT listing_id, skills FROM z_product UNION ALL SELECT listing_id, skills FROM z_service) x
  CROSS JOIN LATERAL unnest(x.skills) AS k(skill)
  JOIN org.skills s ON s.slug = k.skill
ON CONFLICT (listing_id, skill_id) DO NOTHING;

INSERT INTO catalogue.listing_tags (listing_id, tag)
SELECT listing_id, category FROM z_product UNION ALL SELECT listing_id, category FROM z_service
ON CONFLICT (listing_id, tag) DO NOTHING;
-- #endregion

-- #region Work: projects, stages, seats, tickets, deliveries
DROP TABLE IF EXISTS z_project;
CREATE TEMP TABLE z_project AS
SELECT v.*, pg_temp.sid('t03:project:' || v.key) AS id, pg_temp.slug('prj', 't03:' || v.key) AS slug, pg_temp.t3_biz(v.client) AS client_id,
       b.owner_id, pg_temp.t3_team(v.team) AS team_id
  FROM (VALUES
    ('castellan-app', 'harbour', 'castellan', 'Castellan driver app rebuild',
     'Replace paper dockets with a driver app and a dispatch console, then roll them out depot by depot.', 'active', 165, 158),
    ('brightwater-portal', 'harbour', 'brightwater', 'Brightwater patient portal redesign',
     'Rebuild the patient portal around appointments and results, tested with patients in three clinics.', 'completed', 160, 155),
    ('castellan-scan', NULL, 'castellan', 'Warehouse scanning app',
     'A rugged-device scanning app for the Felixstowe cross-dock, starting with a prototype on the floor.', 'active', 6, -10),
    ('brightwater-signage', 'fieldnote', 'brightwater', 'Clinic wayfinding illustrations',
     'An illustrated wayfinding language for the new Jumeirah clinic, from icons to print-ready artwork.', 'active', 30, 26),
    ('castellan-film', 'slipway', 'castellan', 'Castellan brand film',
     'A two-minute film on what it takes to move a container at four in the morning, for recruitment and the website.', 'active', 150, 145),
    ('brightwater-report', 'longhand', 'brightwater', 'Brightwater annual report',
     'The first public annual report: an editorial plan, contributor drafts, then a designed and proofed document.', 'active', 120, 115),
    ('castellan-portops', 'tidewater', 'castellan', 'Port operations dashboard',
     'Bring berth, crane and yard data into one dashboard with alerts the night shift can trust.', 'active', 95, 90)
  ) AS v(key, team, client, title, summary, status, created_days, started_days)
  JOIN z_biz b ON b.key = v.client;

DROP TABLE IF EXISTS z_stage;
CREATE TEMP TABLE z_stage AS
SELECT v.*, pg_temp.sid('t03:stage:' || v.project || ':' || v.key) AS id, pg_temp.slug('stg', 't03:' || v.project || ':' || v.key) AS slug,
       pg_temp.sid('t03:project:' || v.project) AS project_id
  FROM (VALUES
    ('castellan-app', 's1', 1, 'Discovery and service map', 'Shadow two depots and map the operation from booking to proof of delivery.', 600000, 'paid', 135, NULL::numeric, ARRAY['ux-research', 'user-interviews']),
    ('castellan-app', 's2', 2, 'Design foundations', 'A design system fit for gloves, glare and a cracked Android.', 840000, 'paid', 108, NULL, ARRAY['design-systems', 'figma']),
    ('castellan-app', 's3', 3, 'Driver app beta', 'The driver app in the hands of twenty drivers on live routes.', 1200000, 'paid', 72, NULL, ARRAY['typescript', 'react-native']),
    ('castellan-app', 's4', 4, 'Dispatch console', 'The console dispatchers use to assign, reroute and chase jobs.', 960000, 'paid', 34, NULL, ARRAY['typescript', 'realtime']),
    ('castellan-app', 's5', 5, 'Telematics integration', 'Live vehicle positions and proof-of-delivery events from the trucks.', 720000, 'paid', 5, NULL, ARRAY['postgres', 'realtime']),
    ('castellan-app', 's6', 6, 'Rollout and training', 'Two tickets: the depot checklist and the driver training deck.', 240000, 'in_progress', NULL, 12, ARRAY['ux-writing']),
    ('brightwater-portal', 's1', 1, 'Patient research', 'Interviews and journey maps across three clinics.', 500000, 'paid', 120, NULL, ARRAY['ux-research']),
    ('brightwater-portal', 's2', 2, 'Portal interface', 'The appointments and results interface, handed over with its design system.', 1100000, 'paid', 80, NULL, ARRAY['ux', 'design-systems']),
    ('castellan-scan', 's1', 1, 'Scanner prototype', 'A working prototype on two rugged handsets, tested on the cross-dock.', 450000, 'open', NULL, NULL, ARRAY['react-native', 'ux']),
    ('brightwater-signage', 's1', 1, 'Icon language', 'A pictogram grid and the first twenty icons, tested at ten metres.', 120000, 'paid', 11, NULL, ARRAY['illustration']),
    ('brightwater-signage', 's2', 2, 'Illustration set', 'The full set, drawn to the grid and reviewed in the clinic.', 180000, 'in_progress', NULL, 6, ARRAY['illustration']),
    ('brightwater-signage', 's3', 3, 'Final artwork', 'Print-ready artwork for vinyl, wall panels and the portal.', 90000, 'open', NULL, 20, ARRAY['illustration', 'typography']),
    ('castellan-film', 's1', 1, 'Storyboard', 'Treatment, storyboard and a shot list agreed with the depot teams.', 300000, 'paid', 118, NULL, ARRAY['art-direction']),
    ('castellan-film', 's2', 2, 'Principal production', 'Three night shoots at Felixstowe and an assembly edit.', 1400000, 'paid', 66, NULL, ARRAY['motion-design']),
    ('castellan-film', 's3', 3, 'Grade and delivery', 'Final grade, sound mix and delivery masters for web and recruitment events.', 600000, 'in_progress', NULL, 9, ARRAY['motion-design']),
    ('brightwater-report', 's1', 1, 'Editorial plan', 'The story of the year, a contributor brief and a production calendar.', 420000, 'paid', 85, NULL, ARRAY['copywriting']),
    ('brightwater-report', 's2', 2, 'Writing and editing', 'Contributor drafts edited into one voice, with sign-off from each clinic lead.', 560000, 'paid', 28, NULL, ARRAY['copywriting', 'brand-voice']),
    ('brightwater-report', 's3', 3, 'Layout and proof', 'The designed report, proofed against the audited figures.', 300000, 'submitted', NULL, 7, ARRAY['editorial-design', 'typography']),
    ('castellan-portops', 's1', 1, 'Data mapping', 'Berth, crane and yard feeds mapped into one model.', 900000, 'paid', 62, NULL, ARRAY['postgres']),
    ('castellan-portops', 's2', 2, 'Dashboard build', 'The live dashboard for the shift supervisors.', 700000, 'paid', 19, NULL, ARRAY['typescript', 'realtime']),
    ('castellan-portops', 's3', 3, 'Alerting', 'Alert rules and escalation paths the night shift can trust.', 500000, 'in_progress', NULL, 14, ARRAY['ux', 'realtime'])
  ) AS v(project, key, ord, name, brief, price, status, done_days, due_in, skills);

DROP TABLE IF EXISTS z_ticket;
CREATE TEMP TABLE z_ticket AS
SELECT v.*, v.project || ':' || v.stage || ':' || v.n AS key,
       pg_temp.sid('t03:ticket:' || v.project || ':' || v.stage || ':' || v.n) AS id,
       pg_temp.slug('tkt', 't03:' || v.project || ':' || v.stage || ':' || v.n) AS slug,
       pg_temp.sid('t03:stage:' || v.project || ':' || v.stage) AS stage_id,
       pg_temp.sid('t03:project:' || v.project) AS project_id,
       CASE WHEN v.assignee IS NOT NULL THEN pg_temp.t3_who(v.assignee) END AS assignee_id
  FROM (VALUES
    ('castellan-app', 's1', 1, 'Depot walkthroughs and service map', 'Two days in Felixstowe and Tilbury, then the map of how a job really moves.', 'completed', 'high', 1.5, 'samuelnkemelu', 160, 'released', 158, 135, ARRAY['Shadow the Felixstowe night shift', 'Shadow the Tilbury day shift', 'Service map workshop'], 3, 'Service map and findings. The docket hand-off at the gate is the biggest source of lost jobs.'),
    ('castellan-app', 's2', 1, 'Driver app design foundations', 'Type, colour and touch targets that survive gloves and glare.', 'completed', 'normal', 1.5, 'marisdelacroix', 132, 'released', 130, 108, ARRAY['Glare and glove testing', 'Component library', 'Handoff notes'], 3, 'Foundations and component library, tested on the Samsung XCover the depots use.'),
    ('castellan-app', 's3', 1, 'Driver app beta build', 'Job list, navigation hand-off and proof of delivery, offline first.', 'completed', 'high', 2.0, 'tomaszwojcik', 104, 'released', 102, 72, ARRAY['Offline job queue', 'Proof-of-delivery capture', 'Beta with twenty drivers'], 3, 'Beta build. Twenty drivers ran it for two weeks with no lost jobs.'),
    ('castellan-app', 's4', 1, 'Dispatch console', 'Assign, reroute and chase, with live status from the driver app.', 'completed', 'high', 2.0, 'samuelnkemelu', 68, 'released', 66, 34, ARRAY['Assignment board', 'Reroute flow', 'Dispatcher training notes'], 3, 'Console is live for the Felixstowe desk. Training notes attached to the stage.'),
    ('castellan-app', 's5', 1, 'Telematics integration', 'Vehicle positions and proof-of-delivery events into the console.', 'completed', 'normal', 1.5, 'tomaszwojcik', 30, 'released', 28, 5, ARRAY['Ingest vehicle positions', 'Soak test at 40k events'], 2, 'Soak test passed overnight, no dropped pings across 40k events.'),
    ('castellan-app', 's6', 1, 'Depot rollout checklist', 'What each depot needs in place the week before go-live.', 'in_progress', 'normal', 1.0, 'samuelnkemelu', 6, 'escrow_funded', 6, NULL, ARRAY['Draft the checklist', 'Walk it through with Felixstowe', 'Confirm the Tilbury date'], 1, NULL),
    ('castellan-app', 's6', 2, 'Driver training deck', 'A twenty-minute shift briefing for drivers, in plain language.', 'in_review', 'normal', 1.0, 'me', 6, 'escrow_funded', 6, NULL, ARRAY['Write the briefing', 'Record the walkthrough'], 2, 'Training deck and walkthrough for sign-off. Hannah, the second depot''s wording is in the notes.'),
    ('brightwater-portal', 's1', 1, 'Patient interviews and journey map', 'Twelve patients, three clinics, one journey.', 'completed', 'normal', 1.5, 'me', 152, 'released', 150, 120, ARRAY['Recruit twelve patients', 'Interviews', 'Journey map'], 3, 'Journey map and the top ten pains, in the order patients ranked them.'),
    ('brightwater-portal', 's2', 1, 'Portal interface and handoff', 'Appointments and results, built on a handed-over design system.', 'completed', 'high', 2.0, 'marisdelacroix', 116, 'released', 114, 80, ARRAY['Appointments flow', 'Results flow', 'Design system handoff'], 3, 'Final interface and design system, accepted by the Brightwater product team.'),
    ('brightwater-signage', 's1', 1, 'Icon language and grid', 'A grid and twenty icons, tested at distance.', 'completed', 'normal', 1.0, 'aikotanaka', 25, 'released', 24, 11, ARRAY['Pictogram grid', 'Twenty icons', 'Distance test'], 3, 'Grid and twenty icons. All passed at ten metres except pharmacy, redrawn.'),
    ('brightwater-signage', 's2', 1, 'Wayfinding illustration set', 'The remaining forty icons and the corridor illustrations.', 'in_review', 'high', 1.0, 'aikotanaka', 8, 'escrow_funded', 8, NULL, ARRAY['Forty icons', 'Corridor illustrations'], 2, 'Full set for review. Corridor panels are drawn at final size.'),
    ('brightwater-signage', 's3', 1, 'Print-ready artwork', 'Vinyl, wall panels and portal exports.', 'backlog', 'low', 0.5, NULL, NULL, 'unpaid', NULL, NULL, '{}'::text[], 0, NULL),
    ('castellan-film', 's1', 1, 'Storyboard and shot list', 'A treatment the depot teams recognise as their own.', 'completed', 'normal', 1.5, 'renkoda', 142, 'released', 140, 118, ARRAY['Treatment', 'Storyboard', 'Shot list'], 3, 'Storyboard and shot list, agreed with both depot managers.'),
    ('castellan-film', 's2', 1, 'Principal production', 'Three night shoots at Felixstowe and an assembly edit.', 'completed', 'high', 2.5, 'lenamueller', 112, 'released', 110, 66, ARRAY['Night shoot one', 'Night shoot two', 'Night shoot three', 'Assembly edit'], 4, 'Assembly edit from the three nights. Sound is a guide track for now.'),
    ('castellan-film', 's3', 1, 'Final grade and delivery masters', 'Grade, mix and masters for web and recruitment events.', 'in_progress', 'high', 1.5, 'me', 10, 'escrow_funded', 10, NULL, ARRAY['Colour grade', 'Sound mix', 'Delivery masters'], 1, NULL),
    ('brightwater-report', 's1', 1, 'Editorial plan and contributor brief', 'The narrative of the year and who writes what.', 'completed', 'normal', 1.0, 'me', 110, 'released', 108, 85, ARRAY['Narrative outline', 'Contributor brief', 'Production calendar'], 3, 'Editorial plan and brief, approved by the board secretary.'),
    ('brightwater-report', 's2', 1, 'Chapter drafting and editing', 'Twelve contributors edited into one voice.', 'completed', 'high', 2.0, 'inesduarte', 80, 'released', 78, 28, ARRAY['First drafts in', 'Structural edit', 'Clinic lead sign-off'], 3, 'Edited manuscript, signed off by every clinic lead.'),
    ('brightwater-report', 's3', 1, 'Layout proof and corrections', 'The designed report checked line by line against the audited figures.', 'in_review', 'normal', 1.0, 'me', 7, 'escrow_funded', 7, NULL, ARRAY['First proof', 'Figures check'], 2, 'Second proof. Every figure now matches the audited accounts.'),
    ('castellan-portops', 's1', 1, 'Terminal data mapping', 'Berth, crane and yard feeds in one model.', 'completed', 'high', 2.0, 'samuelnkemelu', 88, 'released', 86, 62, ARRAY['Feed inventory', 'Warehouse model', 'Reconciliation against gate logs'], 3, 'Unified model. Reconciles to the gate logs within half a percent.'),
    ('castellan-portops', 's2', 1, 'Berth dashboard build', 'The live board for the shift supervisors.', 'completed', 'high', 2.0, 'kwamemensah', 58, 'released', 56, 19, ARRAY['Berth timeline', 'Crane utilisation', 'Supervisor walkthrough'], 3, 'Dashboard live for the supervisors, with their edits folded in.'),
    ('castellan-portops', 's3', 1, 'Alert rules and escalation paths', 'Which alerts wake somebody up, and who.', 'claimed', 'normal', 1.0, 'me', 3, 'escrow_funded', 3, NULL, ARRAY['Interview night supervisors', 'Draft alert rules', 'Escalation map'], 0, NULL)
  ) AS v(project, stage, n, title, brief, status, priority, intensity, assignee, claimed_days, payment, funded_days,
         released_days, tasks, done_n, note);

INSERT INTO projects.projects
    (id, client_business_id, owner_user_id, title, slug, description, description_text, format, structure_variation,
     status, visibility, publish_visibility, currency, budget_type, budget_amount_cents, timeline_preset,
     target_project_start_date, ip_ownership_mode, nda_required, portfolio_display_rights, location_restriction,
     language_requirement, allow_deadline_bonuses, handover_unlocked_at, created_at, updated_at, last_activity_at)
SELECT p.id, p.client_id, p.owner_id, p.title, p.slug, jsonb_build_object('text', p.summary), p.summary, 'pipeline',
       'standard', p.status::project_status, 'public', 'public', 'USD', 'fixed_price',
       (SELECT sum(s.price * greatest(1, (SELECT count(*) FROM z_ticket t WHERE t.stage_id = s.id))) FROM z_stage s WHERE s.project_id = p.id),
       'sequential', pg_temp.t3_ago(p.started_days), 'exclusive_transfer', false, 'allowed', ARRAY['Remote'], ARRAY['English'],
       p.status = 'active', CASE WHEN p.status = 'completed' THEN pg_temp.t3_ago(78) END, pg_temp.t3_ago(p.created_days),
       pg_temp.t3_ago(least(p.created_days, 3)), pg_temp.t3_ago(least(p.created_days, 3))
  FROM z_project p
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_status_history (id, project_id, actor_user_id, from_status, to_status, reason, created_at)
SELECT pg_temp.sid('t03:project-status:' || p.key || ':' || v.step), p.id, p.owner_id, v.from_status::project_status,
       v.to_status::project_status, v.reason, pg_temp.t3_ago(p.created_days - v.offset_days)
  FROM z_project p
  CROSS JOIN LATERAL (VALUES
    (1, NULL, 'draft', 'Created', 0),
    (2, 'draft', 'active', 'Published', 1)
  ) AS v(step, from_status, to_status, reason, offset_days)
UNION ALL
SELECT pg_temp.sid('t03:project-status:' || p.key || ':3'), p.id, p.owner_id, 'active', 'completed', 'All stages accepted',
       pg_temp.t3_ago(78)
  FROM z_project p
 WHERE p.status = 'completed'
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_stages
    (id, project_id, name, slug, description, description_text, sort_order, status, skills, unit_price_cents, milestone,
     completed_at, seat_limit, start_trigger_type, file_duration_mode, file_due_date, created_at)
SELECT s.id, s.project_id, s.name, s.slug, jsonb_build_object('text', s.brief), s.brief, s.ord, s.status::stage_status,
       s.skills, s.price, CASE WHEN s.status = 'paid' THEN 'Accepted and paid' ELSE '' END, pg_temp.t3_ago(s.done_days), 3,
       'on_project_start', CASE WHEN s.due_in IS NOT NULL THEN 'fixed_deadline' END, pg_temp.t3_ago(-s.due_in),
       (SELECT pg_temp.t3_ago(p.created_days) FROM z_project p WHERE p.id = s.project_id)
  FROM z_stage s
 WHERE NOT EXISTS (SELECT 1 FROM projects.project_stages x WHERE x.id = s.id);

INSERT INTO projects.project_participants (id, project_id, profile_type, profile_id, role, created_at)
SELECT pg_temp.sid('t03:participant:' || p.key || ':business'), p.id, 'business'::profile_type, p.client_id, 'client', pg_temp.t3_ago(p.created_days)
  FROM z_project p
UNION ALL
SELECT pg_temp.sid('t03:participant:' || p.key || ':' || m.person), p.id, 'freelancer'::profile_type, m.user_id, 'assignee',
       pg_temp.t3_ago(p.created_days - 2)
  FROM z_project p
  JOIN z_member m ON m.team = p.team AND m.left_days IS NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.stage_assignments
    (id, project_stage_id, assignee_type, team_id, assigned_by, is_client_managed, status, created_at)
SELECT pg_temp.sid('t03:assignment:' || p.key || ':' || s.key), s.id, 'team', p.team_id, p.owner_id, false,
       CASE WHEN s.status = 'paid' THEN 'completed' ELSE 'accepted' END,
       pg_temp.t3_ago(COALESCE((SELECT max(t.funded_days) + 2 FROM z_ticket t WHERE t.stage_id = s.id), p.created_days - 2))
  FROM z_stage s
  JOIN z_project p ON p.id = s.project_id
 WHERE p.team IS NOT NULL AND s.status <> 'open'
ON CONFLICT (id) DO NOTHING;

-- Harbourline's sent proposal: the Projects module's Proposals view.
INSERT INTO projects.project_applications
    (id, project_id, applicant_user_id, applicant_type, applicant_profile_id, message, status, created_at, updated_at)
SELECT pg_temp.sid('t03:application:castellan-scan'), pg_temp.sid('t03:project:castellan-scan'), pg_temp.me(), 'team',
       pg_temp.t3_team('harbour'),
       'We built your driver app and already know the cross-dock. Two weeks to a working prototype on your handsets.',
       'pending', pg_temp.t3_ago(2), pg_temp.t3_ago(2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_application_targets (id, application_id, target_type, target_id)
SELECT pg_temp.sid('t03:application-target:castellan-scan'), pg_temp.sid('t03:application:castellan-scan'), 'stage',
       pg_temp.sid('t03:stage:castellan-scan:s1')
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.tickets
    (id, project_id, current_stage_id, current_assignee_id, slug, owner_user_id, title, description, text_description,
     status, priority, required_stages, tasks, due_date, workload_intensity, payment_status, unit_price_cents, total_amount_paid,
     sort_order, claimed_at, created_at, updated_at)
SELECT t.id, t.project_id, t.stage_id, t.assignee_id, t.slug, p.owner_id, t.title, jsonb_build_object('text', t.brief),
       t.brief, t.status::ticket_status, t.priority::projects.ticket_priority,
       jsonb_build_array(jsonb_build_object('stage_id', t.stage_id, 'order', 0)),
       (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', pg_temp.sid('t03:task:' || t.key || ':' || x.n),
            'text', x.txt,
            'done', x.n <= t.done_n,
            'completed_by', CASE WHEN x.n <= t.done_n THEN jsonb_build_array(t.assignee_id) ELSE '[]'::jsonb END
        ) ORDER BY x.n), '[]'::jsonb)
          FROM unnest(t.tasks) WITH ORDINALITY AS x(txt, n)),
       CASE WHEN t.status IN ('claimed', 'in_progress', 'in_review') THEN pg_temp.t3_ago(1 - s.due_in) END,
       t.intensity, t.payment::payment_status, s.price,
       CASE WHEN t.payment = 'released' THEN s.price - (s.price * 500) / 10000 ELSE 0 END, t.n - 1,
       pg_temp.t3_ago(t.claimed_days), pg_temp.t3_ago(COALESCE(t.claimed_days + 2, 5)),
       pg_temp.t3_ago(COALESCE(t.released_days, least(t.claimed_days, 1), 5))
  FROM z_ticket t
  JOIN z_project p ON p.id = t.project_id
  JOIN z_stage s ON s.id = t.stage_id
 WHERE NOT EXISTS (SELECT 1 FROM projects.tickets x WHERE x.id = t.id);

INSERT INTO projects.ticket_history
    (id, ticket_id, actor_id, action_type, previous_stage_id, new_stage_id, previous_status, new_status, changes, created_at)
SELECT pg_temp.sid('t03:ticket-history:' || t.key || ':created'), t.id, p.owner_id, 'created', NULL, t.stage_id, NULL,
       'backlog'::ticket_status, jsonb_build_object('title', t.title), pg_temp.t3_ago(COALESCE(t.claimed_days + 2, 5))
  FROM z_ticket t JOIN z_project p ON p.id = t.project_id
UNION ALL
SELECT pg_temp.sid('t03:ticket-history:' || t.key || ':claimed'), t.id, t.assignee_id, 'reassigned', t.stage_id, t.stage_id,
       'todo'::ticket_status, 'claimed'::ticket_status, jsonb_build_object('assignee', t.assignee_id), pg_temp.t3_ago(t.claimed_days)
  FROM z_ticket t WHERE t.assignee_id IS NOT NULL
UNION ALL
SELECT pg_temp.sid('t03:ticket-history:' || t.key || ':' || t.status), t.id,
       CASE WHEN t.status = 'completed' THEN p.owner_id ELSE t.assignee_id END, 'status_changed', t.stage_id, t.stage_id,
       CASE WHEN t.status = 'completed' THEN 'in_review' ELSE 'claimed' END::ticket_status, t.status::ticket_status, '{}'::jsonb,
       pg_temp.t3_ago(COALESCE(t.released_days, greatest(t.claimed_days - 1, 0)))
  FROM z_ticket t JOIN z_project p ON p.id = t.project_id
 WHERE t.status IN ('in_progress', 'in_review', 'completed')
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.stage_submissions
    (id, project_stage_id, ticket_id, submitted_by, notes, title, status, description, checked_item_ids, number,
     reviewed_by, reviewed_at, feedback, created_at, updated_at)
SELECT pg_temp.sid('t03:submission:' || t.key), t.stage_id, t.id, t.assignee_id, t.note, t.title || ' — final',
       CASE WHEN t.status = 'completed' THEN 'accepted' ELSE 'pending_review' END, jsonb_build_object('text', t.note), '[]'::jsonb, 1,
       CASE WHEN t.status = 'completed' THEN p.owner_id END,
       CASE WHEN t.status = 'completed' THEN pg_temp.t3_ago(t.released_days) END,
       CASE WHEN t.status = 'completed' THEN jsonb_build_object('text', 'Accepted. Thank you all.') END,
       pg_temp.t3_ago(COALESCE(t.released_days + 1, 1)),
       pg_temp.t3_ago(COALESCE(t.released_days, 1))
  FROM z_ticket t
  JOIN z_project p ON p.id = t.project_id
 WHERE t.note IS NOT NULL AND t.status IN ('completed', 'in_review')
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Money: escrows, splits, sales, payouts, then every ledger written in one chronological pass
-- Every release runs the plan the live release runs, so vault, finder and member shares cannot drift
-- from finance.fn_split_team_payout. Every fee, cut and share floors (integer division), as
-- `platformFeeFor` and the SQL release do; dust stays in the vault.
DROP TABLE IF EXISTS z_escrow;
CREATE TEMP TABLE z_escrow AS
SELECT t.key, pg_temp.sid('t03:escrow:' || t.key) AS id, t.id AS ticket_id, t.stage_id, p.client_id, p.team_id, s.price AS amount,
       t.payment = 'released' AS released, t.funded_days, t.released_days,
       (s.price * finance.fn_escrow_fee_bp(p.client_id, NULL)) / 10000 AS fee,
       finance.fn_team_split_plan(p.team_id, s.price - (s.price * finance.fn_escrow_fee_bp(p.client_id, NULL)) / 10000) AS plan
  FROM z_ticket t
  JOIN z_project p ON p.id = t.project_id
  JOIN z_stage s ON s.id = t.stage_id
 WHERE t.payment IN ('released', 'escrow_funded');

INSERT INTO finance.escrows
    (id, project_stage_id, ticket_id, payer_business_id, payee_type, payee_id, amount_cents, platform_fee_cents,
     deadline_bonus_cents, currency, status, created_at, released_at)
SELECT e.id, e.stage_id, e.ticket_id, e.client_id, 'team', e.team_id, e.amount, CASE WHEN e.released THEN e.fee ELSE 0 END,
       0, 'USD', CASE WHEN e.released THEN 'released' ELSE 'held' END, pg_temp.t3_ago(e.funded_days),
       pg_temp.t3_ago(e.released_days)
  FROM z_escrow e
ON CONFLICT (id) DO NOTHING;

-- shortcut: a persona's share is recorded here but not credited to their seeded wallet, which these
-- snippets must not move; the target's is credited by populate_07_wallet.sql.
INSERT INTO finance.payout_splits (id, escrow_id, member_user_id, amount_cents, currency, created_at)
SELECT pg_temp.sid('t03:split:' || e.key || ':' || s.kind || ':' || s.user_id), e.id, s.user_id, s.amount, 'USD',
       pg_temp.t3_ago(e.released_days)
  FROM z_escrow e
  CROSS JOIN LATERAL (
    SELECT 'share' AS kind, (m ->> 'member_user_id')::uuid AS user_id, (m ->> 'amount_minor')::bigint AS amount
      FROM jsonb_array_elements(e.plan -> 'members') m
    UNION ALL
    SELECT 'finder', (e.plan ->> 'finder_user_id')::uuid, (e.plan ->> 'finder_minor')::bigint
     WHERE (e.plan ->> 'finder_minor')::bigint > 0
  ) s
 WHERE e.released AND s.amount > 0
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.orders
    (id, reference, status, placed_at, owner_type, owner_id, currency, subtotal_minor, creator_discount_minor,
     platform_fee_minor, platform_fee_bp, platform_fee_mode, total_minor, charged_minor, payment_provider,
     payment_method_label, idempotency_key, created_at)
SELECT z.order_id, 'PJ-' || upper(substr(md5(z.order_id::text), 1, 8)), 'confirmed', pg_temp.t3_ago(z.days), 'user', pg_temp.t3_who(z.buyer),
       'USD', z.price, 0, z.fee, finance.fn_effective_platform_fee_bp('user', pg_temp.t3_who(z.buyer)), 'seller_deducted', z.price, z.price,
       'stripe', z.card, 'snippet:' || z.order_id, pg_temp.t3_ago(z.days)
  FROM z_sale z
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.order_lines
    (id, order_id, item_type, item_id, title, subtitle, quantity, line_total_minor, currency, platform_fee_bp,
     platform_fee_minor, fulfilment, download_name, download_bytes, download_format, licence, position, created_at)
SELECT z.line_id, z.order_id, 'digital_product', z.product_id, z.title, 'Instant download', 1, z.price, 'USD', z.fee_bp, z.fee,
       'download', z.manifest::jsonb -> 0 ->> 'name', (z.manifest::jsonb -> 0 ->> 'bytes')::bigint,
       ltrim(z.manifest::jsonb -> 0 ->> 'extension', '.'), z.licence, 0, pg_temp.t3_ago(z.days)
  FROM z_sale z
ON CONFLICT (id) DO NOTHING;

DROP TABLE IF EXISTS z_payout;
CREATE TEMP TABLE z_payout AS
SELECT v.*, pg_temp.sid('t03:payout:' || v.key) AS id, pg_temp.t3_team(v.team) AS team_id
  FROM (VALUES
    ('harbour-1', 'harbour', 60, 250000::bigint, 'paid', 58::numeric),
    ('harbour-2', 'harbour', 3, 40000, 'failed', NULL),
    -- This is what leaves Slipway's treasury running low.
    ('slipway-1', 'slipway', 12, 240000, 'paid', 10)
  ) AS v(key, team, days, amount, status, settled_days);

DROP TABLE IF EXISTS z_ledger;
CREATE TEMP TABLE z_ledger
    (key text, wallet uuid, at timestamptz, direction text, amount bigint, reason text, ref_table text, ref_id uuid,
     fund finance.fund_state NOT NULL DEFAULT 'available');

-- The clients' money: opening deposits, a top-up, and an `escrow_hold` for each ticket they funded.
INSERT INTO z_ledger
SELECT 't03:topup:' || v.key, pg_temp.t3_vault('business', v.id), pg_temp.t3_ago(v.days), 'credit', v.amount, 'topup', 'payment_methods',
       pg_temp.sid('t03:funding:' || v.biz)
  FROM (VALUES
    ('castellan-open', 'castellan', pg_temp.t3_biz('castellan'), 214, 7000000::bigint),
    ('castellan-q4', 'castellan', pg_temp.t3_biz('castellan'), 80, 4000000),
    ('brightwater-open', 'brightwater', pg_temp.t3_biz('brightwater'), 174, 4000000)
  ) AS v(key, biz, id, days, amount);

INSERT INTO z_ledger
SELECT 't03:hold:' || e.key, pg_temp.t3_vault('business', e.client_id), pg_temp.t3_ago(e.funded_days), 'debit', e.amount, 'escrow_hold',
       'escrows', e.id, 'locked'
  FROM z_escrow e;

-- Team treasuries: an owner's opening deposit, each release's vault cut and each product sale. Money
-- earned reaches Available seven days after it is released; younger money is still in the window below.
INSERT INTO z_ledger
SELECT 't03:topup:' || v.team, pg_temp.t3_vault('team', pg_temp.t3_team(v.team)), pg_temp.t3_ago(v.days), 'credit', v.amount, 'topup',
       'payment_methods', pg_temp.sid('t03:team-funding:' || v.team)
  FROM (VALUES
    ('harbour', 396, 300000::bigint),
    ('fieldnote', 37, 25000),
    ('slipway', 296, 100000),
    ('longhand', 258, 50000),
    ('tidewater', 198, 200000)
  ) AS v(team, days, amount);

INSERT INTO z_ledger
SELECT 't03:vault:' || e.key, pg_temp.t3_vault('team', e.team_id), pg_temp.t3_ago(e.released_days - 7), 'credit',
       (e.plan ->> 'vault_total_minor')::bigint, 'escrow_release_vault_retention', 'escrows', e.id
  FROM z_escrow e
 WHERE e.released AND e.released_days >= 7 AND (e.plan ->> 'vault_total_minor')::bigint > 0;

INSERT INTO z_ledger
SELECT 't03:sale:' || z.key, pg_temp.t3_vault('team', z.team_id), pg_temp.t3_ago(z.days - 7), 'credit', z.price - z.fee, 'product_sale',
       'orders', z.order_id
  FROM z_sale z
 WHERE z.days >= 7;

INSERT INTO z_ledger
SELECT 't03:payout:' || p.key, pg_temp.t3_vault('team', p.team_id), pg_temp.t3_ago(p.days), 'debit', p.amount, 'payout', 'payouts', p.id
  FROM z_payout p;

-- A failed withdrawal comes straight back, as finance.fail_payout returns it.
INSERT INTO z_ledger
SELECT 't03:payout-reversal:' || p.key, pg_temp.t3_vault('team', p.team_id), pg_temp.t3_ago(p.days - 0.1), 'credit', p.amount,
       'payout_reversal', 'payouts', p.id
  FROM z_payout p
 WHERE p.status = 'failed';

-- A benevolent dictator distributes by hand: the vault is debited for what the stakes paid out. The
-- target holds no stake at Tidewater, so nothing here is owed to their personal wallet.
INSERT INTO z_ledger
SELECT 't03:distribution:tidewater', pg_temp.t3_vault('team', pg_temp.t3_team('tidewater')), pg_temp.t3_ago(15), 'debit', 600000,
       'team_distribution', 'team_distribution', pg_temp.sid('t03:distribution:tidewater');

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT l.*, row_number() OVER (PARTITION BY l.wallet ORDER BY l.at, l.key) AS n
          FROM z_ledger l
         ORDER BY l.wallet, n
    LOOP
        PERFORM pg_temp.post(r.key, r.wallet, r.direction, r.amount, r.reason, r.at + make_interval(secs => r.n::double precision),
                             r.ref_table, r.ref_id, r.fund);
    END LOOP;
END $$;

INSERT INTO finance.pending_releases
    (id, escrow_id, order_id, wallet_id, reason, amount_cents, currency, released_at, available_at, created_at)
SELECT pg_temp.sid('t03:pending:' || e.key), e.id, NULL, pg_temp.t3_vault('team', e.team_id), 'escrow_release_vault_retention',
       (e.plan ->> 'vault_total_minor')::bigint, 'USD', pg_temp.t3_ago(e.released_days), pg_temp.t3_ago(e.released_days - 7),
       pg_temp.t3_ago(e.released_days)
  FROM z_escrow e
 WHERE e.released AND e.released_days < 7 AND (e.plan ->> 'vault_total_minor')::bigint > 0
UNION ALL
SELECT pg_temp.sid('t03:pending:' || z.key), NULL, z.order_id, pg_temp.t3_vault('team', z.team_id), 'product_sale', z.price - z.fee, 'USD',
       pg_temp.t3_ago(z.days), pg_temp.t3_ago(z.days - 7), pg_temp.t3_ago(z.days)
  FROM z_sale z
 WHERE z.days < 7
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.payment_methods
    (id, owner_type, owner_id, method_role, provider, external_ref, label, brand, last4, is_default_funding,
     is_default_payout, status, created_at)
SELECT pg_temp.sid('t03:team-funding:' || t.key), 'team', t.id, 'funding'::finance.method_role, 'stripe', 'pm_snippet_' || t.handle, t.name || ' card',
       'visa', '4242', true, false, 'active', pg_temp.t3_ago(t.created_days)
  FROM z_team t WHERE t.key <> 'marlowe'
UNION ALL
SELECT pg_temp.sid('t03:team-bank:' || t.key), 'team', t.id, 'payout'::finance.method_role, 'stripe', 'ba_snippet_' || t.handle,
       'Bank account •••• ' || v.last4, 'bank_account', v.last4, false, true, 'active', pg_temp.t3_ago(t.created_days - 10)
  FROM z_team t
  JOIN (VALUES ('harbour', '4821'), ('slipway', '6130'), ('tidewater', '2907')) AS v(team, last4) ON v.team = t.key
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.payout_accounts (id, owner_type, owner_id, provider, account_id, status, created_at)
SELECT pg_temp.sid('t03:team-payout-account:' || v.team), 'team', t.id, 'stripe', 'acct_snippet_' || replace(t.handle, '-', '_'), v.status,
       pg_temp.t3_ago(least(t.created_days - 5, 300))
  FROM (VALUES ('harbour', 'verified'), ('slipway', 'verified'), ('tidewater', 'verified'), ('fieldnote', 'pending_verification')) AS v(team, status)
  JOIN z_team t ON t.key = v.team
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.payouts
    (id, wallet_id, destination_method_id, amount_cents, currency, status, instant, provider, provider_ref, transaction_id,
     failure_reason, destination_account, initiated_at, settled_at, created_at)
SELECT p.id, pg_temp.t3_vault('team', p.team_id), pg_temp.sid('t03:team-bank:' || p.team), p.amount, 'USD', p.status::finance.payout_status,
       false, 'stripe', CASE WHEN p.status = 'paid' THEN 'tr_snippet_' || substr(md5(p.id::text), 1, 16) END,
       pg_temp.sid('tx:t03:payout:' || p.key),
       CASE WHEN p.status = 'failed' THEN 'The bank returned the transfer: the account details have changed.' END,
       'acct_snippet_' || replace(t.handle, '-', '_'), pg_temp.t3_ago(p.days), pg_temp.t3_ago(p.settled_days), pg_temp.t3_ago(p.days)
  FROM z_payout p
  JOIN z_team t ON t.id = p.team_id
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.wallet_pots (id, wallet_id, purpose, name, balance_cents, currency, auto_allocate_bp, created_at)
SELECT pg_temp.sid('t03:pot:' || v.key), pg_temp.t3_vault('team', pg_temp.t3_team(v.team)), v.purpose::finance.pot_purpose, v.name, v.cents, 'USD', v.bp,
       pg_temp.t3_ago(v.days)
  FROM (VALUES
    ('harbour-tax', 'harbour', 'tax', 'Tax set-aside', 120000::bigint, 1500, 180),
    ('harbour-offsite', 'harbour', 'goal', 'Studio offsite', 45000, 500, 90),
    ('tidewater-kit', 'tidewater', 'general', 'Hardware fund', 250000, 0, 60)
  ) AS v(key, team, purpose, name, cents, bp, days)
ON CONFLICT (id) DO NOTHING;

-- The vault audit: every top-up of a shared wallet is an `add_funds` by its owner, and the distribution
-- carries the shares finance.distribute_vault would record.
INSERT INTO finance.ledger_audit (id, wallet_id, actor_user_id, action, amount_cents, currency, ref_table, ref_id, metadata, created_at)
SELECT pg_temp.sid('t03:audit:' || l.key), l.wallet, COALESCE(t.owner_id, b.owner_id), 'add_funds', l.amount, 'USD', l.ref_table, l.ref_id,
       jsonb_build_object('note', CASE l.key
           WHEN 't03:topup:castellan-q4' THEN 'Winter rollout budget'
           ELSE 'Opening deposit' END),
       l.at
  FROM z_ledger l
  JOIN finance.wallets w ON w.id = l.wallet
  LEFT JOIN z_team t ON w.owner_type = 'team' AND t.id = w.owner_id
  LEFT JOIN z_biz b ON w.owner_type = 'business' AND b.id = w.owner_id
 WHERE l.reason = 'topup'
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.ledger_audit (id, wallet_id, actor_user_id, action, amount_cents, currency, ref_table, ref_id, metadata, created_at)
SELECT pg_temp.sid('t03:audit:distribution:tidewater'), pg_temp.t3_vault('team', t.id), t.owner_id, 'distribute', 600000, 'USD',
       'team_distribution', pg_temp.sid('t03:distribution:tidewater'),
       jsonb_build_object('requested_minor', 600000, 'shares', (
           SELECT jsonb_agg(jsonb_build_object('member_user_id', m.user_id, 'handle', u.username,
                                               'amount_minor', (600000::bigint * m.bp) / 10000, 'percent_bp', m.bp) ORDER BY m.bp DESC)
             FROM z_member m JOIN org.users_public u ON u.user_id = m.user_id
            WHERE m.team = t.key AND m.bp > 0)),
       pg_temp.t3_ago(15)
  FROM z_team t
 WHERE t.key = 'tidewater'
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Channels: `general` comes from the entity trigger, the rest are created here
DROP TABLE IF EXISTS z_channel;
CREATE TEMP TABLE z_channel AS
SELECT v.*, pg_temp.t3_team(v.team) AS team_id,
       CASE WHEN v.slug = 'general' THEN (SELECT c.id FROM comms.dm_threads c
                                           WHERE c.owner_type = 'team' AND c.owner_entity_id = pg_temp.t3_team(v.team) AND c.is_default)
            ELSE pg_temp.sid('t03:channel:' || v.team || ':' || v.slug) END AS id
  FROM (VALUES
    ('harbour', 'general', NULL::text, NULL::text, 'me', 400, 2),
    ('harbour', 'delivery-sync', 'What ships this week, and what is blocked', NULL, 'samuelnkemelu', 150, 3),
    ('harbour', 'client-updates', 'Drafts of what we tell clients, before they go out', NULL, 'me', 150, 0),
    ('harbour', 'design-crit', 'Post work early. Critique the work, not the person.', '✏️', 'marisdelacroix', 120, 1),
    ('fieldnote', 'general', NULL, NULL, 'me', 38, 1),
    ('fieldnote', 'delivery-sync', 'Clinic deadlines and what is with the printer', NULL, 'me', 28, 0),
    ('slipway', 'general', NULL, NULL, 'renkoda', 300, 0),
    ('slipway', 'delivery-sync', 'Shoot days, edit status, what the client still owes us', NULL, 'renkoda', 150, 2),
    ('slipway', 'client-updates', 'Notes for Hannah at Castellan', NULL, 'me', 140, 0),
    ('longhand', 'general', NULL, NULL, 'saoirsebyrne', 260, 1),
    ('longhand', 'delivery-sync', 'Proof rounds and contributor chasers', NULL, 'me', 118, 1),
    ('longhand', 'client-updates', 'What Miguel at Brightwater has been told', NULL, 'saoirsebyrne', 118, 0),
    ('tidewater', 'general', NULL, NULL, 'kwamemensah', 200, 3),
    ('tidewater', 'delivery-sync', 'Terminal feeds, dashboards and the on-call rota', NULL, 'samuelnkemelu', 92, 1)
  ) AS v(team, slug, topic, emoji, creator, created_days, me_unread);

INSERT INTO comms.dm_threads (id, kind, owner_type, owner_entity_id, slug, topic, emoji, created_by_user_id, created_at)
SELECT c.id, 'entity_channel', 'team', c.team_id, c.slug, c.topic, c.emoji, pg_temp.t3_who(c.creator), pg_temp.t3_ago(c.created_days)
  FROM z_channel c
 WHERE c.slug <> 'general'
ON CONFLICT (id) DO NOTHING;

DROP TABLE IF EXISTS z_post;
CREATE TEMP TABLE z_post AS
SELECT v.*, pg_temp.sid('t03:post:' || v.team || ':' || v.slug || ':' || v.n) AS id
  FROM (VALUES
    ('harbour', 'general', 1, 'samuelnkemelu', 172, NULL::integer, 'Reminder: Castellan''s ops lead joins Thursday''s demo, so staging needs the new route planner by Wednesday night.'),
    ('harbour', 'general', 2, 'tomaszwojcik', 171, 1, 'It will be there. Merging the telematics branch first thing tomorrow.'),
    ('harbour', 'general', 3, 'marisdelacroix', 96, NULL, 'Portfolio photos are next week. If you have a project you want shot, add it to the brand folder.'),
    ('harbour', 'general', 4, 'aikotanaka', 30, NULL, 'Onboarding illustrations for the driver app are ready for review in design-crit.'),
    ('harbour', 'general', 5, 'marisdelacroix', 6, 4, 'Lovely. Commenting there this afternoon.'),
    ('harbour', 'delivery-sync', 1, 'me', 200, NULL, 'Week plan: telematics goes to Castellan on Thursday and the rollout tickets open Monday. Anything at risk?'),
    ('harbour', 'delivery-sync', 2, 'samuelnkemelu', 199, 1, 'Telematics is on track. Rollout depends on Castellan confirming depot dates.'),
    ('harbour', 'delivery-sync', 3, 'tomaszwojcik', 178, NULL, 'Release build passed the soak test overnight. No dropped pings across 40k events.'),
    ('harbour', 'delivery-sync', 4, 'samuelnkemelu', 140, NULL, 'Depot checklist is claimed. You have the training deck, right?'),
    ('harbour', 'delivery-sync', 5, 'me', 139, 4, 'Yes. First draft by Friday.'),
    ('harbour', 'delivery-sync', 6, 'marisdelacroix', 40, 5, 'I can review the slides before they go to Hannah.'),
    ('harbour', 'delivery-sync', 7, 'samuelnkemelu', 5, NULL, 'Hannah confirmed the first two depots. Moving the training session to next Tuesday.'),
    ('harbour', 'delivery-sync', 8, 'tomaszwojcik', 2, 7, 'I will keep Tuesday free in case the handsets misbehave.'),
    ('harbour', 'client-updates', 1, 'me', 146, NULL, 'Draft for Hannah: telematics is with her for sign-off and rollout is scoped for the next two weeks. Edits welcome.'),
    ('harbour', 'client-updates', 2, 'marisdelacroix', 145, 1, 'Looks good. I would lead with the soak test result.'),
    ('harbour', 'client-updates', 3, 'me', 143, NULL, 'Done and sent.'),
    ('harbour', 'design-crit', 1, 'aikotanaka', 30, NULL, 'Driver onboarding illustrations, round two. The hi-vis figure reads better at thumbnail size now.'),
    ('harbour', 'design-crit', 2, 'marisdelacroix', 8, 1, 'Much better. Could the depot background lose one tone so the figure sits forward?'),
    ('harbour', 'design-crit', 3, 'aikotanaka', 4, 2, 'Yes, new version tomorrow.'),
    ('fieldnote', 'general', 1, 'me', 700, NULL, 'Welcome to the smallest team on the platform. Brightwater said yes to the icon language, so we have a client.'),
    ('fieldnote', 'general', 2, 'aikotanaka', 698, 1, 'Excellent. I will start the grid this week.'),
    ('fieldnote', 'general', 3, 'aikotanaka', 9, NULL, 'Could we get a logo before the Jumeirah install? Our profile still has initials on it.'),
    ('fieldnote', 'delivery-sync', 1, 'me', 290, NULL, 'Miguel wants the pharmacy icon redrawn. Everything else passed at ten metres.'),
    ('fieldnote', 'delivery-sync', 2, 'aikotanaka', 288, 1, 'Redrawn and uploaded. Starting on the remaining forty now.'),
    ('fieldnote', 'delivery-sync', 3, 'me', 20, NULL, 'Set is in review with Brightwater. Print quote comes back Monday.'),
    ('slipway', 'general', 1, 'renkoda', 2000, NULL, 'Kit list for the Felixstowe nights is in the drive. Bring layers, the quay is brutal after two.'),
    ('slipway', 'general', 2, 'lenamueller', 1998, 1, 'Noted. I am bringing the second monitor for video village.'),
    ('slipway', 'general', 3, 'renkoda', 285, NULL, 'Heads up: I took the vault down to pay for the camera service. It is tight until the grade releases.'),
    ('slipway', 'delivery-sync', 1, 'lenamueller', 300, NULL, 'Assembly is locked. Starting the grade on Monday.'),
    ('slipway', 'delivery-sync', 2, 'me', 240, 1, 'Grade ticket is on me. Sound mix is booked for the end of next week.'),
    ('slipway', 'delivery-sync', 3, 'tomaszwojcik', 40, NULL, 'Render farm is back up. The 4K masters take about six hours each.'),
    ('slipway', 'delivery-sync', 4, 'lenamueller', 15, NULL, 'Colour pass one is on the review link.'),
    ('slipway', 'client-updates', 1, 'me', 250, NULL, 'Sent Hannah the assembly with notes on the guide track, and told her final sound arrives with the grade.'),
    ('longhand', 'general', 1, 'saoirsebyrne', 2800, NULL, 'Brightwater has signed the report. I will set up the channel and the contributor brief with you this week.'),
    ('longhand', 'general', 2, 'inesduarte', 2790, 1, 'Grid is roughed in. Twelve chapters feels right.'),
    ('longhand', 'general', 3, 'saoirsebyrne', 12, NULL, 'We are at four seats with Chloe''s invitation out. Anyone else waits for the next plan review.'),
    ('longhand', 'delivery-sync', 1, 'me', 1150, NULL, 'Two clinic leads are late on their chapters. I am chasing both today.'),
    ('longhand', 'delivery-sync', 2, 'inesduarte', 1100, 1, 'Thanks. Layout can absorb a week, not two.'),
    ('longhand', 'delivery-sync', 3, 'me', 26, NULL, 'Second proof is with Brightwater. Every figure now matches the audited accounts.'),
    ('longhand', 'delivery-sync', 4, 'saoirsebyrne', 3, 3, 'Good. If Miguel signs this week we print on schedule.'),
    ('longhand', 'client-updates', 1, 'saoirsebyrne', 650, NULL, 'Told Miguel the manuscript is signed off and proofs start next week.'),
    ('tidewater', 'general', 1, 'kwamemensah', 1080, NULL, 'Welcome to the team. Kwame here. Samuel will get you onto the alerts work.'),
    ('tidewater', 'general', 2, 'samuelnkemelu', 1078, 1, 'Glad to have a designer on this. Night shift has been asking for less noise.'),
    ('tidewater', 'general', 3, 'kwamemensah', 200, NULL, 'Distribution went out last week. Thanks for a strong quarter, everyone with a stake.'),
    ('tidewater', 'general', 4, 'inesduarte', 96, NULL, 'Terminal two changes its feed format next month. Samuel has the spec.'),
    ('tidewater', 'general', 5, 'samuelnkemelu', 20, 4, 'Mapped it. No dashboard changes needed.'),
    ('tidewater', 'delivery-sync', 1, 'samuelnkemelu', 70, NULL, 'Alerting is funded and claimed. Interviews with the night supervisors are this week.'),
    ('tidewater', 'delivery-sync', 2, 'me', 40, 1, 'Two interviews done. The crane alarm is the one they trust least.'),
    ('tidewater', 'delivery-sync', 3, 'kwamemensah', 6, 2, 'That matches what the ops director told me.')
  ) AS v(team, slug, n, person, hours, reply_to, body);

INSERT INTO comms.dm_messages (id, thread_id, sender_user_id, body, reply_to_id, created_at)
SELECT p.id, c.id, pg_temp.t3_who(p.person), p.body,
       CASE WHEN p.reply_to IS NOT NULL THEN pg_temp.sid('t03:post:' || p.team || ':' || p.slug || ':' || p.reply_to) END,
       pg_temp.t3_ago(p.hours / 24.0)
  FROM z_post p
  JOIN z_channel c ON c.team = p.team AND c.slug = p.slug
 ORDER BY p.team, p.slug, p.n
ON CONFLICT (id) DO NOTHING;

-- Everybody has read everything, except the target's `me_unread` newest messages in each channel.
UPDATE comms.dm_participants x
   SET last_read_at = CASE WHEN x.user_id = pg_temp.me() AND c.me_unread > 0
                           THEN (SELECT m.created_at FROM comms.dm_messages m WHERE m.thread_id = c.id
                                  ORDER BY m.created_at DESC OFFSET c.me_unread LIMIT 1)
                           ELSE (SELECT max(m.created_at) FROM comms.dm_messages m WHERE m.thread_id = c.id) END
  FROM z_channel c
 WHERE x.thread_id = c.id AND x.last_read_at IS NULL;

UPDATE comms.dm_participants x
   SET joined_at = m.joined_at
  FROM z_channel c
  JOIN org.team_members m ON m.team_id = c.team_id
 WHERE x.thread_id = c.id AND x.user_id = m.user_id AND x.joined_at > m.joined_at;

-- The channel's Files tab reads what was attached to its messages; these are seeded public images.
INSERT INTO comms.message_attachments (id, message_table, message_id, attachment_id, created_at)
SELECT pg_temp.sid('t03:attachment:' || v.team || ':' || v.slug || ':' || v.n), 'comms.dm_messages',
       pg_temp.sid('t03:post:' || v.team || ':' || v.slug || ':' || v.n), pg_temp.t3_asset(v.path), m.created_at
  FROM (VALUES
    ('harbour', 'design-crit', 1, 'sv-design-system-foundation'),
    ('fieldnote', 'delivery-sync', 2, 'pr-iconography-set'),
    ('slipway', 'delivery-sync', 4, 'sv-product-launch-film'),
    ('longhand', 'delivery-sync', 3, 'pr-editorial-type-system')
  ) AS v(team, slug, n, path)
  JOIN comms.dm_messages m ON m.id = pg_temp.sid('t03:post:' || v.team || ':' || v.slug || ':' || v.n)
ON CONFLICT (id) DO NOTHING;

UPDATE comms.dm_messages m
   SET has_attachments = true
  FROM comms.message_attachments a
 WHERE a.message_table = 'comms.dm_messages' AND a.message_id = m.id AND NOT m.has_attachments
   AND m.thread_id IN (SELECT id FROM z_channel);
-- #endregion

-- #region Conversations: group threads, direct messages and client inquiries about each team's work
DROP TABLE IF EXISTS z_thread;
CREATE TEMP TABLE z_thread AS
SELECT v.*, pg_temp.sid('t03:thread:' || v.key) AS id
  FROM (VALUES
    ('harbour-leads', 'group', 'Castellan rollout leads', 'me', 20, NULL::text, ARRAY['me', 'samuelnkemelu', 'marisdelacroix', 'hannahcole'], 2, true),
    ('harbour-dm', 'dm', NULL, 'tomaszwojcik', 14, NULL, ARRAY['me', 'tomaszwojcik'], 1, false),
    ('harbour-inquiry', 'service_inquiry', NULL, 'theo', 3, 'ops-sprint', ARRAY['me', 'theo'], 1, false),
    ('fieldnote-dm', 'dm', NULL, 'aikotanaka', 10, NULL, ARRAY['me', 'aikotanaka'], 0, false),
    ('fieldnote-inquiry', 'service_inquiry', NULL, 'noor', 5, 'clinic-icons', ARRAY['me', 'noor'], 0, false),
    ('slipway-edit', 'group', 'Castellan film edit review', 'renkoda', 12, NULL, ARRAY['me', 'renkoda', 'lenamueller'], 1, false),
    ('slipway-dm', 'dm', NULL, 'renkoda', 4, NULL, ARRAY['me', 'renkoda'], 1, true),
    ('longhand-proof', 'group', 'Annual report proofing', 'saoirsebyrne', 9, NULL, ARRAY['me', 'saoirsebyrne', 'inesduarte', 'miguelsantos'], 1, false),
    ('tidewater-dm', 'dm', NULL, 'kwamemensah', 44, NULL, ARRAY['me', 'kwamemensah'], 0, false)
  ) AS v(key, kind, title, creator, created_days, listing, people, me_unread, me_starred);

DROP TABLE IF EXISTS z_line;
CREATE TEMP TABLE z_line AS
SELECT v.*
  FROM (VALUES
    ('harbour-leads', 1, 'hannahcole', 480, 'Tilbury can take the first rollout. Felixstowe wants the week after, once the night shift has seen the deck.'),
    ('harbour-leads', 2, 'me', 476, 'That works. Samuel, can you shift the checklist to Tilbury first?'),
    ('harbour-leads', 3, 'samuelnkemelu', 470, 'Done. Tilbury is now the first go-live.'),
    ('harbour-leads', 4, 'hannahcole', 30, 'The driver union rep would like to see the training deck before it goes out. Is that all right?'),
    ('harbour-leads', 5, 'marisdelacroix', 10, 'Fine by us. I will send the review copy today.'),
    ('harbour-dm', 1, 'tomaszwojcik', 330, 'Have you got ten minutes on the proof-of-delivery schema? I think we need a photo hash.'),
    ('harbour-dm', 2, 'me', 328, 'Yes. Call after lunch?'),
    ('harbour-dm', 3, 'tomaszwojcik', 26, 'Hash is in and Castellan''s insurer is happy. Thanks for pushing on that.'),
    ('harbour-inquiry', 1, 'theo', 70, 'Hi, we run a small courier fleet in Lisbon and everything lives in spreadsheets. Is the discovery sprint overkill for twelve vans?'),
    ('harbour-inquiry', 2, 'me', 66, 'Not overkill. Twelve vans is often where it pays off soonest. What breaks first on a bad day?'),
    ('harbour-inquiry', 3, 'theo', 18, 'Failed deliveries, always. Could the sprint start next month?'),
    ('fieldnote-dm', 1, 'aikotanaka', 240, 'Do you want the corridor panels at full size or a quarter scale for review?'),
    ('fieldnote-dm', 2, 'me', 236, 'Full size. Miguel wants to tape them up in the clinic.'),
    ('fieldnote-dm', 3, 'aikotanaka', 22, 'Done, they are in the review now.'),
    ('fieldnote-inquiry', 1, 'noor', 120, 'Could the clinic icon set be extended for a hospitality client? We need about twenty more symbols.'),
    ('fieldnote-inquiry', 2, 'me', 110, 'Yes, happy to quote. Send me the list and how far away they need to read.'),
    ('slipway-edit', 1, 'lenamueller', 280, 'Assembly v3 is on the review link. The crane shot now opens the film.'),
    ('slipway-edit', 2, 'renkoda', 270, 'Better. Hold on the driver''s hands two seconds longer at the end.'),
    ('slipway-edit', 3, 'me', 262, 'Hannah loved the crane opening. She asked if the logo can wait until the very last frame.'),
    ('slipway-edit', 4, 'lenamueller', 16, 'Colour pass one is up. The dawn scenes have much more depth now.'),
    ('slipway-dm', 1, 'renkoda', 96, 'I pulled most of the vault for the camera service. Sorry for the short notice.'),
    ('slipway-dm', 2, 'me', 92, 'Understood. We are about a hundred dollars from zero though, so nothing else leaves until the grade pays out.'),
    ('slipway-dm', 3, 'renkoda', 7, 'Agreed. Can you put the render storage renewal on hold until then?'),
    ('longhand-proof', 1, 'miguelsantos', 200, 'Page 34 still has last year''s patient number.'),
    ('longhand-proof', 2, 'me', 196, 'Thanks, corrected in the second proof along with the two tables after it.'),
    ('longhand-proof', 3, 'inesduarte', 150, 'New proof uploaded with the wider chart on page 41.'),
    ('longhand-proof', 4, 'saoirsebyrne', 26, 'Miguel, this is ready for your sign-off when the audit committee has seen it.'),
    ('tidewater-dm', 1, 'kwamemensah', 1050, 'Thanks for joining. You will not see the money side here, that is how we run it. If anything looks off with your contract, tell me directly.'),
    ('tidewater-dm', 2, 'me', 1046, 'Understood, and thanks. Is the alerting scope written up anywhere?'),
    ('tidewater-dm', 3, 'kwamemensah', 1040, 'On the project board. Samuel owns the detail.')
  ) AS v(thread, n, person, hours, body);

INSERT INTO comms.dm_threads (id, kind, title, subject_listing_id, created_by_user_id, created_at)
SELECT t.id, t.kind::comms.conversation_kind, t.title, CASE WHEN t.listing IS NOT NULL THEN pg_temp.sid('t03:listing:' || t.listing) END,
       pg_temp.t3_who(t.creator), pg_temp.t3_ago(t.created_days)
  FROM z_thread t
ON CONFLICT (id) DO NOTHING;

INSERT INTO comms.dm_participants (id, thread_id, user_id, is_starred, starred_at, joined_at)
SELECT pg_temp.sid('t03:thread-participant:' || t.key || ':' || p.person), t.id, pg_temp.t3_who(p.person),
       t.me_starred AND p.person = 'me', CASE WHEN t.me_starred AND p.person = 'me' THEN pg_temp.t3_ago(1) END,
       pg_temp.t3_ago(t.created_days)
  FROM z_thread t
  CROSS JOIN LATERAL unnest(t.people) AS p(person)
ON CONFLICT (id) DO NOTHING;

INSERT INTO comms.dm_messages (id, thread_id, sender_user_id, body, created_at)
SELECT pg_temp.sid('t03:line:' || l.thread || ':' || l.n), t.id, pg_temp.t3_who(l.person), l.body, pg_temp.t3_ago(l.hours / 24.0)
  FROM z_line l
  JOIN z_thread t ON t.key = l.thread
 ORDER BY l.thread, l.n
ON CONFLICT (id) DO NOTHING;

UPDATE comms.dm_participants x
   SET last_read_at = CASE WHEN x.user_id = pg_temp.me() AND t.me_unread > 0
                           THEN (SELECT m.created_at FROM comms.dm_messages m WHERE m.thread_id = t.id
                                  ORDER BY m.created_at DESC OFFSET t.me_unread LIMIT 1)
                           ELSE (SELECT max(m.created_at) FROM comms.dm_messages m WHERE m.thread_id = t.id) END
  FROM z_thread t
 WHERE x.thread_id = t.id AND x.last_read_at IS NULL;
-- #endregion

-- #region Team drives: folders and saved links
-- shortcut: drives hold folders and links only, because a stored file needs an uploaded object and
-- files.items allows one row per object; upgrade by uploading through the app.
INSERT INTO files.folders (id, owner_user_id, owner_type, owner_entity_id, name, path, created_at)
SELECT pg_temp.sid('t03:folder:' || v.team || ':' || v.name), t.owner_id, 'team', t.id, v.name, '{}', pg_temp.t3_ago(v.days)
  FROM (VALUES
    ('harbour', 'Client work', 150), ('harbour', 'Brand', 380), ('harbour', 'Templates', 200),
    ('fieldnote', 'Brightwater wayfinding', 28),
    ('slipway', 'Castellan film', 148), ('slipway', 'Kit and locations', 280),
    ('longhand', 'Annual report', 118),
    ('tidewater', 'Terminal data', 92)
  ) AS v(team, name, days)
  JOIN z_team t ON t.key = v.team
ON CONFLICT (id) DO NOTHING;

INSERT INTO files.items
    (id, owner_user_id, owner_type, owner_entity_id, folder_id, bucket_id, storage_path, display_name, original_name,
     mime_type, size_bytes, source, status, visibility, link_url, link_domain, link_title, link_description,
     link_scan_status, link_scanned_at, created_at)
SELECT i.id, t.owner_id, 'team', t.id, pg_temp.sid('t03:folder:' || v.team || ':' || v.folder), 'link', i.id::text, v.title,
       'https://' || v.domain || v.path, 'text/uri-list', 0, 'link', 'uploaded', 'private', 'https://' || v.domain || v.path,
       v.domain, v.title, v.summary, 'safe', pg_temp.t3_ago(v.days), pg_temp.t3_ago(v.days)
  FROM (VALUES
    ('harbour', 'Client work', 'Castellan service map', 'www.figma.com', '/board/castellan-service-map', 'The depot-to-delivery map from the discovery stage.', 130),
    ('harbour', 'Client work', 'Castellan rollout plan', 'docs.google.com', '/document/d/castellan-rollout-plan', 'Depot order, go-live dates and owners.', 18),
    ('harbour', 'Brand', 'Studio brand guidelines', 'www.figma.com', '/design/harbourline-brand', 'Mark, type and tone of voice.', 370),
    ('harbour', 'Templates', 'Stage kickoff template', 'docs.google.com', '/document/d/stage-kickoff-template', 'What every stage starts with.', 190),
    ('fieldnote', 'Brightwater wayfinding', 'Print quotes', 'docs.google.com', '/spreadsheets/d/jumeirah-print-quotes', 'Vinyl and wall panel quotes for the Jumeirah clinic.', 3),
    ('slipway', 'Castellan film', 'Film review link', 'frame.io', '/reviews/castellan-brand-film', 'Current cut with timecoded client notes.', 7),
    ('slipway', 'Kit and locations', 'Felixstowe location notes', 'docs.google.com', '/document/d/felixstowe-location-notes', 'Quay access, hi-vis rules and parking.', 120),
    ('longhand', 'Annual report', 'Contributor tracker', 'docs.google.com', '/spreadsheets/d/brightwater-contributors', 'Who owes which chapter.', 110),
    ('tidewater', 'Terminal data', 'Feed specification', 'www.notion.so', '/tidewater/terminal-feed-spec', 'Field-by-field spec of each terminal feed.', 88)
  ) AS v(team, folder, title, domain, path, summary, days)
  JOIN z_team t ON t.key = v.team
  CROSS JOIN LATERAL (SELECT pg_temp.sid('t03:drive-link:' || v.team || ':' || v.title) AS id) i
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Calendars and listing analytics
-- A team's Calendar is the union of its projects' stage due dates, ticket deadlines and these meetings,
-- placed on wall-clock days of the current week so they stay about now (the seed's `localAt`).
INSERT INTO scheduling.events
    (id, project_id, kind, status, title, starts_at, ends_at, meeting_provider, meeting_provider_label, meeting_details,
     meta, created_by, created_at)
SELECT pg_temp.sid('t03:meeting:' || v.key), pg_temp.sid('t03:project:' || v.project), 'sync', 'confirmed', v.title,
       (date_trunc('week', now() AT TIME ZONE v.tz) + make_interval(days => v.day, mins => v.minute)) AT TIME ZONE v.tz,
       (date_trunc('week', now() AT TIME ZONE v.tz) + make_interval(days => v.day, mins => v.minute + v.duration)) AT TIME ZONE v.tz,
       'custom', v.how, v.details, v.meta, pg_temp.t3_who(v.person), pg_temp.t3_ago(4)
  FROM (VALUES
    ('rollout-brief', 'castellan-app', 'Tilbury rollout briefing', 'Europe/London', 8, 540, 60, 'In person', 'Tilbury depot, drivers'' room', 'Stage 6 · Rollout and training', 'me'),
    ('rollout-weekly', 'castellan-app', 'Castellan weekly check-in', 'Europe/London', 2, 900, 30, 'Video call', 'Link in the project room', 'Stage 6 · Rollout and training', 'samuelnkemelu'),
    ('signage-walk', 'brightwater-signage', 'Clinic walk-through', 'Asia/Dubai', 9, 600, 90, 'In person', 'Jumeirah clinic, front desk', 'Stage 2 · Illustration set', 'me'),
    ('grade-review', 'castellan-film', 'Colour review with Hannah', 'Europe/London', 3, 840, 45, 'Video call', 'Link in the project room', 'Stage 3 · Grade and delivery', 'renkoda'),
    ('proof-signoff', 'brightwater-report', 'Proof sign-off', 'Asia/Dubai', 4, 660, 30, 'Video call', 'Link in the project room', 'Stage 3 · Layout and proof', 'saoirsebyrne'),
    ('alert-review', 'castellan-portops', 'Night shift alert review', 'Europe/London', 10, 480, 60, 'In person', 'Felixstowe control room', 'Stage 3 · Alerting', 'samuelnkemelu')
  ) AS v(key, project, title, tz, day, minute, duration, how, details, meta, person)
ON CONFLICT (id) DO NOTHING;

-- The catalogue's Analytics tab reads daily rollups: thirty days of traffic per listing, and each sale
-- on its day. Only a listing with none yet is written, so a later re-run adds no new days.
INSERT INTO analytics.daily_rollups (day, metric, subject_kind, subject_id, dimensions, value, sample_count)
SELECT x.day, x.metric, 'listing', x.listing_id, x.dimensions, x.value, x.value::integer
  FROM (
    SELECT (now() - make_interval(days => d))::date AS day, m.metric, l.listing_id, '{}'::jsonb AS dimensions,
           (m.base + get_byte(decode(md5(l.listing_id::text || d || m.metric), 'hex'), 0) % m.spread)::numeric AS value
      FROM (SELECT listing_id FROM z_product UNION ALL SELECT listing_id FROM z_service) l
     CROSS JOIN generate_series(1, 30) AS d
     CROSS JOIN (VALUES ('listing.impressions', 18, 40), ('listing.views', 4, 12), ('listing.clicks', 2, 8)) AS m(metric, base, spread)
    UNION ALL
    SELECT (now() - make_interval(days => z.days))::date, 'listing.orders', p.listing_id, '{}'::jsonb, count(*)
      FROM z_sale z JOIN z_product p ON p.key = z.product GROUP BY 1, 3
    UNION ALL
    SELECT (now() - make_interval(days => z.days))::date, 'listing.gross_minor', p.listing_id, '{"currency":"USD"}'::jsonb, sum(z.price)
      FROM z_sale z JOIN z_product p ON p.key = z.product GROUP BY 1, 3
  ) x
 WHERE NOT EXISTS (SELECT 1 FROM analytics.daily_rollups r WHERE r.subject_kind = 'listing' AND r.subject_id = x.listing_id)
ON CONFLICT (day, metric, subject_kind, subject_id, dimensions) DO NOTHING;
-- #endregion

-- #region The public face: reviews, followers, showcase, hours, Standing
INSERT INTO reviews.entity_reviews
    (id, target_entity_id, target_entity_type, reviewer_user_id, project_id, rating, title, comment, created_at, updated_at)
SELECT pg_temp.sid('t03:review:' || v.key), v.target, v.kind::reviews.review_target_type, pg_temp.t3_who(v.person), v.project, v.rating,
       v.title, v.comment, pg_temp.t3_ago(v.days), pg_temp.t3_ago(v.days)
  FROM (VALUES
    ('harbour-portal', pg_temp.t3_team('harbour'), 'team', 'miguelsantos', pg_temp.sid('t03:project:brightwater-portal'), 4.90::numeric,
     'Patients noticed within a week', 'The research was careful and the handover was better than our own documentation. Support calls about appointments fell within a week of launch, and our team can extend the design system themselves.', 78),
    ('harbour-app', pg_temp.t3_team('harbour'), 'team', 'hannahcole', pg_temp.sid('t03:project:castellan-app'), 4.70::numeric,
     'They learned how a depot works', 'They spent nights on the quay before they drew a single screen, and it shows. Drivers took to the app without a fight, and each stage landed when they said it would.', 33),
    ('slipway-film', pg_temp.t3_team('slipway'), 'team', 'hannahcole', pg_temp.sid('t03:project:castellan-film'), 4.60::numeric,
     'Made our night shift look heroic', 'Three brutal nights on the quay and not one complaint from the crew. The assembly already had our drivers talking, and the team handled every one of our notes with patience.', 60),
    ('kit-theo', pg_temp.sid('t03:product:dispatch-kit'), 'product', 'theo', NULL, 4.80::numeric,
     'Saved us a month', 'We lifted the assignment board and status chips straight into our own dispatch tool. The components are typed properly and the Figma file matches the code, which almost never happens.', 80),
    ('kit-noor', pg_temp.sid('t03:product:dispatch-kit'), 'product', 'noor', NULL, 4.50::numeric,
     'Solid, if opinionated', 'A really well-built kit for logistics interfaces, though the map panels assume a particular provider. Support answered my question about swapping that out within a day.', 50)
  ) AS v(key, target, kind, person, project, rating, title, comment, days)
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.profile_follows (id, follower_user_id, target_entity_type, target_entity_id, created_at)
SELECT pg_temp.sid('t03:follow:' || v.team || ':' || v.person), pg_temp.t3_who(v.person), 'team', pg_temp.t3_team(v.team), pg_temp.t3_ago(v.days)
  FROM (VALUES
    ('harbour', 'hannahcole', 70), ('harbour', 'miguelsantos', 60), ('harbour', 'theo', 45), ('harbour', 'noor', 30), ('harbour', 'juno', 8),
    ('slipway', 'hannahcole', 50), ('slipway', 'noor', 22),
    ('tidewater', 'priyaraman', 18),
    ('longhand', 'marisdelacroix', 25)
  ) AS v(team, person, days)
ON CONFLICT (follower_user_id, target_entity_type, target_entity_id) DO NOTHING;

INSERT INTO org.profile_showcase_items (id, owner_type, owner_id, position, file_id, alt, created_by, created_at)
SELECT pg_temp.sid('t03:showcase:' || v.team || ':' || v.position), 'team', t.id, v.position, pg_temp.t3_asset(v.path), v.alt, t.owner_id,
       pg_temp.t3_ago(40)
  FROM (VALUES
    ('harbour', 1, 'sv-design-system-foundation', 'A design system built for gloves and glare'),
    ('harbour', 2, 'pr-dashboard-blocks', 'The dispatch console in use on the Felixstowe desk'),
    ('harbour', 3, 'ar-paying-step-by-step/banner_7', 'Stage plan from the Castellan rebuild'),
    ('slipway', 1, 'sv-product-launch-film', 'Frame from the Castellan brand film'),
    ('slipway', 2, 'pr-motion-primitives', 'Title cards from the starter pack'),
    ('tidewater', 1, 'sv-realtime-mvp-build', 'Berth dashboard for the shift supervisors')
  ) AS v(team, position, path, alt)
  JOIN z_team t ON t.key = v.team
ON CONFLICT (owner_type, owner_id, position) DO NOTHING;

INSERT INTO scheduling.schedules (id, owner_type, owner_id, timezone, is_published)
SELECT pg_temp.sid('t03:schedule:' || v.team), 'team', pg_temp.t3_team(v.team), v.tz, true
  FROM (VALUES ('harbour', 'Asia/Dubai'), ('slipway', 'Europe/London')) AS v(team, tz)
ON CONFLICT (id) DO NOTHING;

INSERT INTO scheduling.availability_rules (id, schedule_id, kind, weekday, start_minute, end_minute)
SELECT pg_temp.sid('t03:availability:' || v.team || ':' || d), pg_temp.sid('t03:schedule:' || v.team), 'working_hours', d, v.starts, v.ends
  FROM (VALUES ('harbour', 540, 1080), ('slipway', 600, 1140)) AS v(team, starts, ends)
  CROSS JOIN generate_series(1, 5) AS d
ON CONFLICT (id) DO NOTHING;

-- Standing is a derived cache: inputs from the record above, the score and the rung from the platform.
-- Only a team without a row is computed, so a re-run appends nothing to org.standing_events.
WITH fresh AS (
    INSERT INTO org.entity_standing
        (subject_type, subject_id, stages_completed, completion_rate, on_time_rate, client_rating_avg, peer_rating_avg,
         dispute_rate, workload_reliability, tenure_days, penalty_severity)
    SELECT 'team', t.id,
           (SELECT count(*) FROM projects.stage_assignments sa WHERE sa.team_id = t.id AND sa.status = 'completed'),
           1, 1, COALESCE(o.rating_average, 0), 0, 0, 1, greatest(0, now()::date - o.created_at::date), 0
      FROM z_team t
      JOIN org.teams o ON o.id = t.id
    ON CONFLICT (subject_type, subject_id) DO NOTHING
    RETURNING subject_type, subject_id
)
SELECT org.fn_recompute_standing(f.subject_type, f.subject_id) FROM fresh f;
-- #endregion

-- #region Self-check: refuse to commit books that do not add up
DO $$
DECLARE
    v_bad integer;
BEGIN
    SELECT count(*) INTO v_bad
      FROM finance.escrows e
     WHERE e.status = 'released' AND e.id IN (SELECT id FROM z_escrow)
       AND e.amount_cents <> e.platform_fee_cents
           + COALESCE((SELECT sum(s.amount_cents) FROM finance.payout_splits s WHERE s.escrow_id = e.id), 0)
           + COALESCE((SELECT sum(x.amount_cents) FROM finance.transactions x
                        WHERE x.wallet_id = pg_temp.t3_vault('team', e.payee_id) AND x.ref_id = e.id AND x.direction = 'credit'), 0)
           + COALESCE((SELECT sum(p.amount_cents) FROM finance.pending_releases p
                        WHERE p.wallet_id = pg_temp.t3_vault('team', e.payee_id) AND p.escrow_id = e.id AND p.state = 'pending'), 0);
    IF v_bad > 0 THEN
        RAISE EXCEPTION 'Nothing was saved: % released escrow(s) do not equal fee + splits + vault.', v_bad;
    END IF;

    SELECT count(*) INTO v_bad
      FROM finance.wallets w
     WHERE w.owner_id IN (SELECT id FROM z_team UNION ALL SELECT id FROM z_biz)
       AND w.balance_cents <> COALESCE((
           SELECT sum(CASE x.direction WHEN 'credit' THEN x.amount_cents ELSE -x.amount_cents END)
             FROM finance.transactions x WHERE x.wallet_id = w.id), 0);
    IF v_bad > 0 THEN
        RAISE EXCEPTION 'Nothing was saved: % wallet(s) disagree with their ledger.', v_bad;
    END IF;
END $$;
-- #endregion

-- #region Summary
SELECT 'Team: ' || t.name || ' (target is ' || m.role || ', ' || t.visibility || ', ' || t.subscription_tier || ')' AS label,
       (SELECT count(*) FROM org.team_members x WHERE x.team_id = t.id AND x.status = 'active') AS count
  FROM org.teams t
  JOIN org.team_members m ON m.team_id = t.id AND m.user_id = pg_temp.me() AND m.status = 'active'
 WHERE t.id IN (SELECT id FROM z_team)
UNION ALL
SELECT 'Treasury of ' || t.name || ', whole dollars', (w.balance_cents / 100)::bigint
  FROM org.teams t
  JOIN finance.wallets w ON w.id = t.treasury_wallet_id
 WHERE t.id IN (SELECT id FROM z_team)
UNION ALL SELECT 'Pending invitations across these teams', count(*) FROM org.org_invitations i WHERE i.team_id IN (SELECT id FROM z_team) AND i.status = 'pending'
UNION ALL SELECT 'Join requests waiting', count(*) FROM org.org_join_requests r WHERE r.team_id IN (SELECT id FROM z_team) AND r.status = 'pending'
UNION ALL SELECT 'Published team listings', count(*) FROM catalogue.listings l WHERE l.owner_team_id IN (SELECT id FROM z_team) AND l.status = 'published'
UNION ALL SELECT 'Product sales', count(*) FROM finance.order_lines l WHERE l.id IN (SELECT line_id FROM z_sale)
UNION ALL SELECT 'Team projects', count(*) FROM projects.projects p WHERE p.id IN (SELECT id FROM z_project)
UNION ALL SELECT 'Tickets', count(*) FROM projects.tickets k WHERE k.id IN (SELECT id FROM z_ticket)
UNION ALL SELECT 'Escrows released to these teams', count(*) FROM finance.escrows e WHERE e.payee_id IN (SELECT id FROM z_team) AND e.status = 'released'
UNION ALL SELECT 'Escrows held for these teams', count(*) FROM finance.escrows e WHERE e.payee_id IN (SELECT id FROM z_team) AND e.status = 'held'
UNION ALL SELECT 'Payout splits to the target (populate_07 credits these)', count(*) FROM finance.payout_splits s WHERE s.member_user_id = pg_temp.me()
UNION ALL SELECT 'Treasury ledger rows', count(*) FROM finance.transactions x JOIN finance.wallets w ON w.id = x.wallet_id WHERE w.owner_type = 'team' AND w.owner_id IN (SELECT id FROM z_team)
UNION ALL SELECT 'Team channels', count(*) FROM comms.dm_threads c WHERE c.owner_entity_id IN (SELECT id FROM z_team)
UNION ALL SELECT 'Channel messages', count(*) FROM comms.dm_messages m WHERE m.thread_id IN (SELECT id FROM z_channel)
UNION ALL SELECT 'Conversations', count(*) FROM comms.dm_threads c WHERE c.id IN (SELECT id FROM z_thread)
UNION ALL SELECT 'Drive links', count(*) FROM files.items i WHERE i.owner_entity_id IN (SELECT id FROM z_team);
-- #endregion

COMMIT;
