-- =============================================================================================
-- populate_05_calendar.sql — one account's calendar, availability, sessions and booked calls.
--
-- WHAT IT FILLS, for the account named a few lines below:
--   * Availability: a published schedule in their own time zone, working hours (a split Wednesday,
--     Friday off), call windows, private and public time off, call settings and platforms.
--   * Entries of every kind (sync, general, milestone, deadline, busy, booking, availability,
--     holiday, session), from a 15-minute check-in to a three-day summit, over last week, this week,
--     next week and later this month, with a dense Wednesday and an overlap.
--   * Reminders (moments on the calendar) and alerts (per-entry overrides of when one goes off).
--   * Routines and recurring series: daily, weekday-only, weekly, fortnightly, monthly; ending on a
--     date, after a count, or open-ended; one moved occurrence and one removed one.
--   * Invitations with real seats: accepted, declined, tentative, pending, on the target's entries
--     and on entries personas host.
--   * Two session services with a session engagement each: a 1-1 block (sittings attended, upcoming,
--     pencilled in, cancelled and refunded) and a group cohort, mirrored onto the calendar, paid from
--     a client business this script creates. Its wallet is the only ledger written here: released
--     escrows name the target as payee, and populate_07_wallet.sql picks those up.
--   * Discovery calls: proposed, confirmed, completed, cancelled, declined, expired, no-show, both
--     hosted by the target and booked by the target. A call is drawn on the calendar from its own row,
--     so it has no scheduling.events twin (see the note on the calls region).
--
-- WHERE IT SHOWS: /calendar · /calendar?view=availability · /@handle/availability · /@handle/edit/availability ·
-- /projects (the two session engagements) · the two listings on the target's profile.
--
-- HOW TO RUN: open this file in Supabase Studio's SQL editor (localhost:54323) and press Run, or
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/snippets/populate_05_calendar.sql
-- It needs only the seeded world and the account, and a second run changes nothing. The last result
-- set is a summary of what is there.
--
-- TO USE ANOTHER ACCOUNT: change the username on the set_config line below the BEGIN.
--
-- RUN IT AGAIN LATER: every time here hangs off the current week, so a re-run in a later week moves
-- the plain entries, their series, the time off and the calls back onto the calendar around today.
-- Session sittings are left where they are: a sitting that has passed carries attendance and released
-- money, which nothing should move.
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

-- #region Calendar helpers (this script's own)

/** The target's zone, read from their profile, so no wall-clock time here assumes one. */
CREATE OR REPLACE FUNCTION pg_temp.cal_tz() RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(NULLIF(btrim(timezone), ''), 'Europe/London')
      FROM org.users_public WHERE user_id = pg_temp.me();
$$;

/** A civil date: weeks from this week's Monday, then days after that Monday (0 = Monday), in a zone. */
CREATE OR REPLACE FUNCTION pg_temp.cal_day(p_week integer, p_day integer, p_tz text DEFAULT NULL)
RETURNS date
LANGUAGE sql STABLE AS $$
    SELECT (date_trunc('week', now() AT TIME ZONE COALESCE(p_tz, pg_temp.cal_tz()))
            + make_interval(days => p_week * 7 + p_day))::date;
$$;

/** The seed's `localAt`: a wall-clock time on one of those days, as an instant. */
CREATE OR REPLACE FUNCTION pg_temp.cal_at(p_week integer, p_day integer, p_time text, p_tz text DEFAULT NULL)
RETURNS timestamptz
LANGUAGE sql STABLE AS $$
    SELECT (pg_temp.cal_day(p_week, p_day, p_tz) + p_time::time) AT TIME ZONE COALESCE(p_tz, pg_temp.cal_tz());
$$;

/** The target's own schedule, whichever id it has. */
CREATE OR REPLACE FUNCTION pg_temp.cal_schedule() RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT id FROM scheduling.schedules WHERE owner_type = 'user' AND owner_id = pg_temp.me();
$$;

/**
 * The civil dates of a series, as `expandIcsSeries` would lay them out. `p_dows` are ISO weekdays
 * (NULL is monthly, on the first date's day of the month), `p_every` the weekly interval.
 */
CREATE OR REPLACE FUNCTION pg_temp.cal_series_dates(
    p_first date, p_dows integer[], p_every integer, p_limit integer, p_until date
)
RETURNS TABLE (n integer, d date)
LANGUAGE sql STABLE AS $$
    SELECT (row_number() OVER (ORDER BY g.d) - 1)::integer, g.d
      FROM (
          SELECT gs::date AS d
            FROM generate_series(p_first::timestamp, p_first + interval '4 years',
                                 CASE WHEN p_dows IS NULL THEN interval '1 month' ELSE interval '1 day' END) AS gs
      ) g
     WHERE (p_dows IS NULL OR extract(isodow FROM g.d)::integer = ANY (p_dows))
       AND ((g.d - date_trunc('week', p_first)::date) / 7) % p_every = 0
       AND (p_until IS NULL OR g.d <= p_until)
     ORDER BY g.d
     LIMIT p_limit;
$$;

/** The 1-1 sittings: which client, which of their four, when, and what became of it. */
CREATE OR REPLACE FUNCTION pg_temp.cal_sittings()
RETURNS TABLE (client text, n integer, week integer, day integer, starts text, state text)
LANGUAGE sql IMMUTABLE AS $$
    VALUES
        -- Noor is halfway through her block.
        ('noor', 1, -2, 1, '15:00', 'attended'),
        ('noor', 2, -1, 1, '15:00', 'attended'),
        ('noor', 3, 1, 1, '15:00', 'upcoming'),
        ('noor', 4, 2, 1, '15:00', 'upcoming'),
        -- Rosa booked yesterday: the first time is agreed, the rest are pencilled in a week apart.
        ('rosalindqvist', 1, 1, 3, '10:30', 'upcoming'),
        ('rosalindqvist', 2, 2, 3, '10:30', 'pencilled'),
        ('rosalindqvist', 3, 3, 3, '10:30', 'pencilled'),
        ('rosalindqvist', 4, 4, 3, '10:30', 'pencilled'),
        -- Miguel came once and cancelled the rest with notice, so those three were refunded.
        ('miguelsantos', 1, -1, 2, '17:00', 'attended'),
        ('miguelsantos', 2, 1, 2, '17:00', 'cancelled'),
        ('miguelsantos', 3, 2, 2, '17:00', 'cancelled'),
        ('miguelsantos', 4, 3, 2, '17:00', 'cancelled');
$$;

/** The group cohort's weekly sittings, Monday mornings, two hours each. */
CREATE OR REPLACE FUNCTION pg_temp.cal_group_sittings()
RETURNS TABLE (n integer, week integer, title text)
LANGUAGE sql IMMUTABLE AS $$
    VALUES
        (1, -2, 'Week 1: framing the problem'),
        (2, -1, 'Week 2: talking to customers'),
        (3, 0, 'Week 3: mapping the opportunity'),
        (4, 1, 'Week 4: testing the riskiest bet'),
        (5, 2, 'Week 5: the roadmap you can defend');
$$;

/**
 * The target's week, one row per band, in minutes from local midnight. Friday is the day off and
 * Wednesday the split day. The weekend keeps short hours, so late in a week there is still call time
 * left to book. `days` are the weekday column's numbering (0 = Sunday), `byday` the same days as RRULE.
 */
CREATE OR REPLACE FUNCTION pg_temp.cal_week()
RETURNS TABLE (
    rule text, kind text, label text, days integer[], byday text, band integer, start_minute integer, end_minute integer
)
LANGUAGE sql IMMUTABLE AS $$
    VALUES
        ('full-days', 'working_hours', 'Full days', ARRAY[1, 2, 4], 'MO,TU,TH', 0, 540, 1080),
        ('wednesday', 'working_hours', 'Split Wednesday', ARRAY[3], 'WE', 0, 510, 750),
        ('wednesday', 'working_hours', 'Split Wednesday', ARRAY[3], 'WE', 1, 900, 1140),
        ('saturday', 'working_hours', 'Short Saturday', ARRAY[6], 'SA', 0, 600, 840),
        ('sunday', 'working_hours', 'Short Sunday', ARRAY[0], 'SU', 0, 600, 900),
        ('call-afternoons', 'call_window', 'Afternoon calls', ARRAY[1, 4], 'MO,TH', 0, 840, 1020),
        ('call-tuesday', 'call_window', 'Tuesday calls', ARRAY[2], 'TU', 0, 600, 720),
        ('call-wednesday', 'call_window', 'Wednesday calls', ARRAY[3], 'WE', 0, 960, 1110),
        ('call-saturday', 'call_window', 'Saturday calls', ARRAY[6], 'SA', 0, 660, 810),
        ('call-sunday', 'call_window', 'Sunday calls', ARRAY[0], 'SU', 0, 660, 840);
$$;

/**
 * The call slots the public grid would offer in a span of local dates: the walk `buildGrid` takes
 * through each window, each one judged by the booking gate itself, for somebody with no history here.
 */
CREATE OR REPLACE FUNCTION pg_temp.cal_open_slots(p_from date, p_to date) RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT count(*)
      FROM generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') AS d(day)
      JOIN scheduling.availability_rules r
        ON r.schedule_id = pg_temp.cal_schedule()
       AND r.kind = 'call_window'
       AND r.is_active
       AND r.weekday = extract(dow FROM d.day)::integer
      JOIN scheduling.call_settings c ON c.schedule_id = r.schedule_id
     CROSS JOIN LATERAL generate_series(
               r.start_minute, r.end_minute - c.courtesy_duration_minutes,
               c.courtesy_duration_minutes + c.buffer_before_minutes + c.buffer_after_minutes
           ) AS m(minute)
     WHERE scheduling.fn_call_request_refusal(
               r.schedule_id, pg_temp.persona('aikotanaka'), 'courtesy'::scheduling.call_type,
               (d.day + make_interval(mins => m.minute)) AT TIME ZONE pg_temp.cal_tz(),
               (d.day + make_interval(mins => m.minute + c.courtesy_duration_minutes)) AT TIME ZONE pg_temp.cal_tz()
           ) IS NULL;
$$;

-- #endregion

-- #region Availability

-- The session services below are paid work, and taking it needs a payout-ready freelancer.
SELECT pg_temp.ensure_verified();

INSERT INTO scheduling.schedules (id, owner_type, owner_id, timezone, is_published, mask_external_events, created_at)
VALUES (pg_temp.sid('schedule'), 'user', pg_temp.me(), pg_temp.cal_tz(), true, true, now() - interval '200 days')
ON CONFLICT (owner_type, owner_id) DO UPDATE
    SET is_published = true
  WHERE NOT scheduling.schedules.is_published;

-- populate_02 lays plain Monday-to-Friday hours when it runs first, so its exact rows give way to the
-- week below. Its calls still land inside these windows, and anything else on the schedule stays.
DELETE FROM scheduling.availability_rules r
 USING generate_series(1, 5) AS d,
       (VALUES ('working_hours', 540), ('call_window', 600), ('call_window', 840)) AS b (kind, start_minute)
 WHERE r.id = pg_temp.sid('band:' || b.kind || ':' || d || ':' || b.start_minute);

-- Left alone once the schedule has hours, so a re-run never stacks a band on ones its owner has edited.
INSERT INTO scheduling.availability_rules (id, schedule_id, kind, weekday, start_minute, end_minute, label, is_active)
SELECT pg_temp.sid('week-band:' || w.rule || ':' || w.band || ':' || d), pg_temp.cal_schedule(),
       w.kind::scheduling.availability_kind, d, w.start_minute, w.end_minute, w.label, true
  FROM pg_temp.cal_week() w
 CROSS JOIN LATERAL unnest(w.days) AS d
 WHERE NOT EXISTS (SELECT 1 FROM scheduling.availability_rules r WHERE r.schedule_id = pg_temp.cal_schedule())
ON CONFLICT (id) DO NOTHING;

-- The same week as a template, which is what /calendar?view=availability edits. Saved in the app, the
-- default template mirrors into the bands above; left uncompiled, the booking gate reads those bands.
INSERT INTO scheduling.availability_presets (id, schedule_id, scope, slug, name, description, is_default)
SELECT pg_temp.sid('preset:working-week'), pg_temp.cal_schedule(), 'library', pg_temp.slug('avp', 'working-week'),
       'Working week', 'Split Wednesdays, Fridays off and short weekends.',
       NOT EXISTS (
           SELECT 1 FROM scheduling.availability_presets p
            WHERE p.schedule_id = pg_temp.cal_schedule() AND p.is_default AND p.archived_at IS NULL
       )
ON CONFLICT (id) DO NOTHING;

INSERT INTO scheduling.recurrence_rules (id, preset_id, kind, rrule, starts_on, label, position)
SELECT DISTINCT ON (w.rule) pg_temp.sid('preset-rule:' || w.rule), pg_temp.sid('preset:working-week'),
       w.kind::scheduling.availability_kind, 'FREQ=WEEKLY;BYDAY=' || w.byday, pg_temp.cal_day(-26, 0), w.label,
       (dense_rank() OVER (ORDER BY w.kind DESC, w.rule) - 1)::smallint
  FROM pg_temp.cal_week() w
 ORDER BY w.rule
ON CONFLICT (id) DO NOTHING;

INSERT INTO scheduling.recurrence_rule_bands (rule_id, position, start_minute, end_minute)
SELECT pg_temp.sid('preset-rule:' || w.rule), w.band, w.start_minute, w.end_minute
  FROM pg_temp.cal_week() w
ON CONFLICT (rule_id, position) DO NOTHING;

INSERT INTO scheduling.blackout_dates (id, schedule_id, starts_at, ends_at, label, label_is_public)
SELECT pg_temp.sid('blackout:' || v.key), pg_temp.cal_schedule(),
       pg_temp.cal_at(v.w1, v.d1, v.t1), pg_temp.cal_at(v.w2, v.d2, v.t2), v.label, v.public
  FROM (VALUES
      ('family-visit', -1, 4, '00:00', -1, 5, '00:00', 'Family visit', false),
      ('dentist', 1, 3, '16:00', 1, 3, '18:00', 'Dentist', false),
      ('muscat', 2, 5, '00:00', 3, 0, '00:00', 'Long weekend in Muscat', false),
      ('summit', 3, 0, '00:00', 3, 3, '00:00', 'Speaking at the regional product summit', true)
  ) AS v (key, w1, d1, t1, w2, d2, t2, label, public)
ON CONFLICT (id) DO UPDATE
    SET starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at
  WHERE scheduling.blackout_dates.starts_at IS DISTINCT FROM EXCLUDED.starts_at;

-- Courtesy calls only: paid ones are off across the product (Decision #343, ruling C1).
INSERT INTO scheduling.call_settings (
    schedule_id, accepts_calls, courtesy_enabled, courtesy_duration_minutes, courtesy_max_per_week,
    courtesy_cooldown_days, paid_enabled, buffer_before_minutes, buffer_after_minutes, min_notice_minutes,
    max_advance_days, auto_confirm, agenda_required, preferred_provider_slug
)
VALUES (pg_temp.cal_schedule(), true, true, 20, 5, 14, false, 0, 10, 240, 45, false, true, 'google')
-- A lower weekly cap, as populate_02 sets, would fill next week with the calls below and close its grid.
ON CONFLICT (schedule_id) DO UPDATE
    SET courtesy_max_per_week = EXCLUDED.courtesy_max_per_week
  WHERE scheduling.call_settings.courtesy_max_per_week < EXCLUDED.courtesy_max_per_week;

INSERT INTO scheduling.call_platforms (schedule_id, provider_slug, position)
SELECT pg_temp.cal_schedule(), v.slug, v.position
  FROM (VALUES ('google', 0), ('zoom', 1), ('microsoft_teams', 2)) AS v (slug, position)
ON CONFLICT (schedule_id, provider_slug) DO NOTHING;

-- #endregion

-- #region Entries on the target's own calendar

-- A moment (`mins` 0) is a Reminder and anything with a length an Event; `days` makes an all-day entry
-- that many days long. `room` is a provider whose link is still to be minted, or `custom` for a place.
-- These are the only rows a re-run moves: the time columns follow the current week.
INSERT INTO scheduling.events (
    id, schedule_id, kind, status, title, starts_at, ends_at, all_day, availability_behavior, location,
    description, meeting_provider, meeting_provider_label, meeting_pending, meeting_details, created_by, created_at
)
SELECT pg_temp.sid('event:' || v.key), pg_temp.cal_schedule(), v.kind::scheduling.event_kind,
       (CASE v.kind WHEN 'busy' THEN 'busy' WHEN 'availability' THEN 'available' ELSE 'confirmed' END)::scheduling.event_status,
       v.title, s.at,
       CASE WHEN v.days IS NULL THEN s.at + make_interval(mins => v.mins)
            ELSE pg_temp.cal_at(v.w, v.d + v.days, '00:00') END,
       v.days IS NOT NULL, COALESCE(v.behaviour, 'disruptive'), v.place, v.agenda, v.room,
       CASE v.room WHEN 'google' THEN 'Google Meet' WHEN 'zoom' THEN 'Zoom'
                   WHEN 'microsoft_teams' THEN 'Microsoft Teams' WHEN 'custom' THEN 'In person' END,
       COALESCE(v.room <> 'custom', false), CASE WHEN v.room = 'custom' THEN v.place END,
       pg_temp.me(), LEAST(now(), s.at) - interval '8 days'
  FROM (VALUES
      -- Last week
      ('harbour-kickoff', 'sync', 'Kick-off with Harbour Lane', -1, 0, '11:00', 60, NULL, NULL, NULL, 'google',
       '<p>Agree scope, who signs off what, and the first three weeks.</p>'),
      ('discovery-workshop', 'general', 'Product discovery workshop', -1, 1, '09:00', 240, NULL, NULL,
       'Dubai Design District, Building 7', 'custom',
       '<p>Half a day with the product leads.</p><ul><li>Customer interviews so far</li><li>Assumptions map</li><li>What we test first</li></ul>'),
      ('client-deep-dive', 'busy', 'Client deep dive', -1, 2, '09:00', 150, NULL, NULL, NULL, NULL, NULL),
      ('beta-signoff', 'milestone', 'Beta sign-off', -1, 2, '16:00', 45, NULL, NULL, NULL, 'zoom',
       '<p>Walk the acceptance list and record the decision.</p>'),
      ('chloe-checkin', 'sync', 'Check-in with Chloe', -1, 3, '09:30', 15, NULL, NULL, NULL, 'google', NULL),
      ('proposal-due', 'deadline', 'Proposal due to Harbour Lane', -1, 3, '17:00', 0, NULL, NULL, NULL, NULL, NULL),
      ('invoices-sent', 'general', 'Send monthly invoices', -1, 6, '09:30', 0, NULL, NULL, NULL, NULL, NULL),
      -- This week: a dense Wednesday, with the crit overlapping the focus block
      ('standup-priya', 'sync', 'Stand-up with Priya', 0, 2, '08:45', 15, NULL, NULL, NULL, 'google', NULL),
      ('roadmap-review', 'sync', 'Roadmap review', 0, 2, '09:00', 60, NULL, NULL, NULL, 'microsoft_teams',
       '<p>Next quarter''s bets, and what we stop doing to make room for them.</p>'),
      ('pricing-call', 'sync', 'Pricing page call', 0, 2, '10:00', 30, NULL, NULL, NULL, 'zoom', NULL),
      ('focus-wednesday', 'busy', 'Focus block', 0, 2, '10:30', 90, NULL, NULL, NULL, NULL, NULL),
      ('design-crit', 'sync', 'Design crit', 0, 2, '11:00', 60, NULL, NULL, NULL, 'google',
       '<p>Onboarding flow, second pass.</p>'),
      ('lunch-noor', 'sync', 'Lunch with Noor', 0, 2, '12:30', 60, NULL, NULL, 'Alserkal Avenue', 'custom', NULL),
      ('contract-review', 'sync', 'Contract review', 0, 2, '15:00', 45, NULL, NULL, NULL, NULL, NULL),
      ('proposal-walkthrough', 'sync', 'Proposal walkthrough', 0, 2, '16:00', 60, NULL, NULL, NULL, 'google', NULL),
      ('chase-sow', 'general', 'Chase the signed SOW', 0, 2, '17:30', 0, NULL, NULL, NULL, NULL, NULL),
      ('retainer-checkin', 'sync', 'Retainer check-in', 0, 3, '11:00', 30, NULL, NULL, NULL, 'zoom', NULL),
      ('office-hours', 'availability', 'Open office hours', 0, 3, '14:00', 60, NULL, NULL, NULL, NULL, NULL),
      -- Next week
      ('sprint-planning', 'sync', 'Sprint planning', 1, 0, '12:00', 60, NULL, NULL, NULL, 'google',
       '<p>Commit to the sprint goal and agree who picks up the analytics work.</p>'),
      ('investor-prep', 'sync', 'Investor update prep', 1, 1, '13:00', 60, NULL, NULL, NULL, NULL, NULL),
      ('phase-acceptance', 'milestone', 'Phase 1 acceptance', 1, 2, '09:00', 120, NULL, NULL, NULL, 'google',
       '<p>Client walkthrough against the acceptance criteria.</p>'),
      ('focus-next-week', 'busy', 'Focus block', 1, 2, '11:00', 90, NULL, NULL, NULL, NULL, NULL),
      ('readout-due', 'deadline', 'Research readout due', 1, 2, '15:00', 0, NULL, NULL, NULL, NULL, NULL),
      ('analytics-review', 'sync', 'Analytics review', 1, 2, '15:15', 30, NULL, NULL, NULL, 'zoom', NULL),
      ('dads-birthday', 'general', 'Dad''s birthday', 1, 3, '00:00', NULL, 1, 'passive', NULL, NULL, NULL),
      ('podcast-recording', 'booking', 'Podcast recording', 1, 4, '10:00', 120, NULL, NULL,
       'In5 Media, Dubai Design District', 'custom', NULL),
      -- Later this month
      ('trade-licence', 'general', 'Renew trade licence', 2, 1, '09:30', 0, NULL, NULL, NULL, NULL, NULL),
      ('stakeholder-workshop', 'general', 'Stakeholder workshop', 2, 2, '08:30', 240, NULL, NULL,
       'Dubai Internet City, Building 12', 'custom',
       '<p>Bring the leadership team to one view of the roadmap.</p>'),
      ('quarterly-review', 'sync', 'Quarterly review', 2, 3, '14:30', 60, NULL, NULL, NULL, 'google', NULL),
      ('product-summit', 'general', 'Regional product summit', 3, 0, '00:00', NULL, 3, NULL, 'Riyadh', NULL, NULL),
      ('final-invoice-due', 'deadline', 'Final invoice due', 3, 3, '17:00', 0, NULL, NULL, NULL, NULL, NULL),
      ('contract-renewal', 'sync', 'Contract renewal', 4, 0, '11:00', 60, NULL, NULL, NULL, 'google', NULL),
      ('public-holiday', 'holiday', 'Public holiday', 4, 2, '00:00', NULL, 1, NULL, NULL, NULL, NULL)
  ) AS v (key, kind, title, w, d, t, mins, days, behaviour, place, room, agenda)
 CROSS JOIN LATERAL (SELECT pg_temp.cal_at(v.w, v.d, v.t) AS at) s
ON CONFLICT (id) DO UPDATE
    SET starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at
  WHERE scheduling.events.starts_at IS DISTINCT FROM EXCLUDED.starts_at
     OR scheduling.events.ends_at IS DISTINCT FROM EXCLUDED.ends_at;

-- Entries personas host, on their own schedules, in their own zones, each one a new row beside what
-- the seed put there. They are clear of those personas' seeded entries and call windows.
INSERT INTO scheduling.events (
    id, schedule_id, kind, status, title, starts_at, ends_at, meeting_provider, meeting_provider_label,
    meeting_pending, created_by, created_at
)
SELECT pg_temp.sid('event:' || v.key), s.id, 'sync', 'confirmed', v.title,
       pg_temp.cal_at(1, v.d, v.t, s.timezone),
       pg_temp.cal_at(1, v.d, v.t, s.timezone) + make_interval(mins => v.mins),
       v.room, v.room_label, true, s.owner_id, now() - interval '3 days'
  FROM (VALUES
      ('design-guild', 'marisdelacroix', 'Design systems guild', 2, '14:00', 60, 'zoom', 'Zoom'),
      ('landing-teardown', 'juno', 'Landing page teardown', 0, '12:00', 45, 'google', 'Google Meet'),
      ('illustration-brief', 'aikotanaka', 'Illustration brief review', 3, '18:00', 30, 'google', 'Google Meet')
  ) AS v (key, host, title, d, t, mins, room, room_label)
  JOIN scheduling.schedules s ON s.owner_type = 'user' AND s.owner_id = pg_temp.persona(v.host)
ON CONFLICT (id) DO UPDATE
    SET starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at
  WHERE scheduling.events.starts_at IS DISTINCT FROM EXCLUDED.starts_at;

-- #endregion

-- #region Invitations

-- A seat is a real roster row: the host sits on their own entry, as `invite_to_event` leaves it, and
-- every answer lands in the entry's history. Answers are dated before now and before the entry starts.
WITH seat (key, who, role, response, hours, note) AS (VALUES
    ('harbour-kickoff', 'noor', 'participant', 'accepted', 40, NULL),
    ('discovery-workshop', 'hannahcole', 'participant', 'accepted', 90, NULL),
    ('discovery-workshop', 'danielokafor', 'participant', 'accepted', 70, 'Joining from the Dubai office that week.'),
    ('discovery-workshop', 'priyaraman', 'optional', 'accepted', 50, NULL),
    ('discovery-workshop', 'theo', 'participant', 'rejected', 60, 'Clashes with a board meeting on our side, so Priya has my notes.'),
    ('beta-signoff', 'noor', 'participant', 'accepted', 30, NULL),
    ('beta-signoff', 'rosalindqvist', 'participant', 'accepted', 26, NULL),
    ('chloe-checkin', 'chloewinters', 'participant', 'accepted', 12, NULL),
    ('roadmap-review', 'priyaraman', 'participant', 'accepted', 48, NULL),
    ('roadmap-review', 'hannahcole', 'participant', 'accepted', 36, NULL),
    ('design-crit', 'marisdelacroix', 'participant', 'accepted', 20, NULL),
    ('lunch-noor', 'noor', 'participant', 'accepted', 24, NULL),
    ('sprint-planning', 'noor', 'participant', 'accepted', 30, NULL),
    ('sprint-planning', 'priyaraman', 'participant', 'accepted', 22, NULL),
    ('sprint-planning', 'danielokafor', 'participant', 'rejected', 18, 'On leave that day. Send me the notes?'),
    ('sprint-planning', 'juno', 'optional', 'tentative', 9, 'Might drop in for the analytics part.'),
    ('sprint-planning', 'hannahcole', 'participant', 'pending', NULL, NULL),
    ('phase-acceptance', 'noor', 'participant', 'accepted', 15, NULL),
    ('phase-acceptance', 'rosalindqvist', 'participant', 'pending', NULL, NULL),
    ('stakeholder-workshop', 'hannahcole', 'participant', 'accepted', 28, NULL),
    ('stakeholder-workshop', 'danielokafor', 'participant', 'accepted', 25, NULL),
    ('stakeholder-workshop', 'theo', 'participant', 'tentative', 16, 'Depends on my flights. I will know by Friday.'),
    ('stakeholder-workshop', 'miguelsantos', 'participant', 'pending', NULL, NULL),
    ('stakeholder-workshop', 'priyaraman', 'optional', 'accepted', 14, NULL),
    ('quarterly-review', 'noor', 'participant', 'accepted', 11, NULL),
    -- Personas' entries: one waiting on the target, one accepted, one a maybe.
    ('design-guild', 'priyaraman', 'participant', 'accepted', 20, NULL),
    ('design-guild', 'me', 'participant', 'pending', NULL, NULL),
    ('landing-teardown', 'me', 'participant', 'accepted', 10, NULL),
    ('illustration-brief', 'me', 'participant', 'tentative', 6, 'I may have to join a few minutes late.')
), placed AS (
    SELECT s.*, e.id AS event_id, e.created_by AS host, e.starts_at, e.created_at AS asked_at,
           CASE s.who WHEN 'me' THEN pg_temp.me() ELSE pg_temp.persona(s.who) END AS user_id
      FROM seat s
      JOIN scheduling.events e ON e.id = pg_temp.sid('event:' || s.key)
), seated AS (
    INSERT INTO scheduling.event_attendees (id, event_id, user_id, role, response, responded_at, note, created_at)
    SELECT pg_temp.sid('seat:' || p.key || ':' || p.who), p.event_id, p.user_id,
           p.role::scheduling.attendee_role, p.response::scheduling.rsvp_response,
           LEAST(now(), p.starts_at) - make_interval(hours => p.hours), p.note, p.asked_at
      FROM placed p
    UNION ALL
    SELECT DISTINCT pg_temp.sid('seat:' || p.key || ':host'), p.event_id, p.host,
           'host'::scheduling.attendee_role, 'accepted'::scheduling.rsvp_response,
           NULL::timestamptz, NULL::text, p.asked_at
      FROM placed p
    ON CONFLICT (id) DO NOTHING
    RETURNING id, event_id, user_id, role, response, responded_at, note, created_at
)
INSERT INTO scheduling.event_history (id, event_id, kind, actor_user_id, summary, detail, target_id, occurred_at)
SELECT pg_temp.sid('history:' || s.id),
       s.event_id,
       CASE WHEN s.role = 'host' THEN 'created' ELSE 'rsvp' END,
       s.user_id,
       CASE WHEN s.role = 'host' THEN 'Scheduled ' || e.title
            WHEN s.response = 'accepted' THEN 'Marked Going'
            WHEN s.response = 'rejected' THEN 'Marked Not going'
            ELSE 'Marked Maybe' END,
       s.note,
       CASE WHEN s.role = 'host' THEN NULL ELSE s.id::text END,
       COALESCE(s.responded_at, s.created_at)
  FROM seated s
  JOIN scheduling.events e ON e.id = s.event_id
 WHERE s.role = 'host' OR s.responded_at IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- #endregion

-- #region Routines and recurring series

-- A routine groups series under one name. Its behaviour is what its entries take: `passive` leaves
-- the time bookable and `disruptive` holds it. Its rule is the cadence a new entry would start on.
INSERT INTO scheduling.routines (id, schedule_id, name, slug, color_token, behavior, recurrence_rule)
SELECT pg_temp.sid('routine:' || v.key), pg_temp.cal_schedule(), v.name, pg_temp.slug('rtn', 'calendar:' || v.key),
       v.color, v.behaviour, v.rule
  FROM (VALUES
      ('training', 'Training', '--accent', 'passive', 'FREQ=WEEKLY;BYDAY=MO,WE,SA'),
      ('language', 'Language study', '--primary', 'passive', 'FREQ=DAILY'),
      ('rhythm', 'Daily rhythm', '--accent', 'passive', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'),
      ('deep-work', 'Deep work', '--primary', 'disruptive', 'FREQ=WEEKLY;BYDAY=TU,TH')
  ) AS v (key, name, color, behaviour, rule)
ON CONFLICT (id) DO NOTHING;

-- A series is a MASTER carrying the rule (its own start is DTSTART) plus one row per later occurrence
-- pointing back at it, in the composer's canonical rule text. There is no exception table: a moved
-- occurrence is simply a row at another time, and a removed one is cancelled and archived, as
-- `removeEntry` leaves it. An open-ended series stops at 42 rows, the most one create lays down
-- (ENTRY_BATCH_MAX). Masters sort first within each series, so an
-- occurrence always finds its master.
INSERT INTO scheduling.events (
    id, schedule_id, kind, status, title, starts_at, ends_at, availability_behavior, routine_id,
    recurrence_rule, recurrence_parent_id, archived_at, created_by, created_at
)
SELECT pg_temp.sid('series:' || v.key || ':' || o.n), pg_temp.cal_schedule(), v.kind::scheduling.event_kind,
       (CASE WHEN o.n IS NOT DISTINCT FROM v.removed_n THEN 'cancelled' WHEN v.kind = 'busy' THEN 'busy' ELSE 'confirmed' END)::scheduling.event_status,
       v.title, s.at, s.at + make_interval(mins => v.mins), v.behaviour,
       CASE WHEN v.routine IS NOT NULL THEN pg_temp.sid('routine:' || v.routine) END,
       CASE WHEN o.n = 0 THEN v.rule
            || CASE WHEN v.until IS NOT NULL THEN ';UNTIL=' || to_char(v.until, 'YYYYMMDD') ELSE '' END
            || CASE WHEN v.counted THEN ';COUNT=' || v.lim ELSE '' END END,
       CASE WHEN o.n > 0 THEN pg_temp.sid('series:' || v.key || ':0') END,
       CASE WHEN o.n IS NOT DISTINCT FROM v.removed_n THEN s.at - interval '2 days' END,
       pg_temp.me(), LEAST(now(), v.first) - interval '5 days'
  FROM (VALUES
      -- Weekly on three days, open-ended. Next week's Wednesday moved an hour, its Saturday removed.
      ('gym', 'training', 'Gym', 'general', pg_temp.cal_day(-2, 0), '07:00', 60, ARRAY[1, 3, 6]::integer[], 1,
       42, NULL::date, false, 'FREQ=WEEKLY;BYDAY=MO,WE,SA', 'passive', 10, 60, 11),
      -- Daily, ending after a count.
      ('arabic-practice', 'language', 'Arabic practice', 'general', pg_temp.cal_day(-1, 0), '21:00', 20,
       ARRAY[1, 2, 3, 4, 5, 6, 7], 1, 30, NULL, true, 'FREQ=DAILY', 'passive', NULL, NULL, NULL),
      -- Weekly on one day, ending after a count.
      ('arabic-lesson', 'language', 'Arabic lesson', 'general', pg_temp.cal_day(-3, 1), '19:00', 60,
       ARRAY[2], 1, 12, NULL, true, 'FREQ=WEEKLY;BYDAY=TU', 'passive', NULL, NULL, NULL),
      -- Every weekday, ending on a date.
      ('morning-planning', 'rhythm', 'Morning planning', 'general', pg_temp.cal_day(-2, 0), '08:30', 15,
       ARRAY[1, 2, 3, 4, 5], 1, 42, pg_temp.cal_day(5, 4), false, 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'passive',
       NULL, NULL, NULL),
      -- Two mornings a week that hold their time, open-ended.
      ('deep-work', 'deep-work', 'Deep work', 'busy', pg_temp.cal_day(-2, 1), '09:00', 60, ARRAY[2, 4], 1,
       42, NULL, false, 'FREQ=WEEKLY;BYDAY=TU,TH', 'disruptive', NULL, NULL, NULL),
      -- Outside any routine: weekly, open-ended.
      ('weekly-review', NULL, 'Weekly review', 'general', pg_temp.cal_day(-3, 6), '16:00', 30, ARRAY[7], 1,
       42, NULL, false, 'FREQ=WEEKLY;BYDAY=SU', 'disruptive', NULL, NULL, NULL),
      -- Every other week, ending on a date.
      ('mentoring-hour', NULL, 'Mentoring hour', 'general', pg_temp.cal_day(-2, 3), '18:30', 60, ARRAY[4], 2,
       42, pg_temp.cal_day(8, 3), false, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TH', 'disruptive', NULL, NULL, NULL),
      -- Monthly, open-ended, and anchored on the month so its day of the month stays put.
      ('bookkeeping', NULL, 'Bookkeeping review', 'general',
       date_trunc('month', now() AT TIME ZONE pg_temp.cal_tz())::date, '19:00', 90, NULL, 1,
       42, NULL, false, 'FREQ=MONTHLY;BYMONTHDAY=1', 'disruptive', NULL, NULL, NULL),
      -- A recurring Reminder: a moment each month, ending after a count.
      ('coworking-rent', NULL, 'Pay co-working rent', 'general',
       date_trunc('month', now() AT TIME ZONE pg_temp.cal_tz())::date + 24, '09:00', 0, NULL, 1,
       6, NULL, true, 'FREQ=MONTHLY;BYMONTHDAY=25', 'disruptive', NULL, NULL, NULL)
  ) AS v (key, routine, title, kind, first, t, mins, dows, every, lim, until, counted, rule, behaviour,
          moved_n, moved_by, removed_n)
 CROSS JOIN LATERAL pg_temp.cal_series_dates(v.first, v.dows, v.every, v.lim, v.until) AS o
 CROSS JOIN LATERAL (
     SELECT (o.d + v.t::time) AT TIME ZONE pg_temp.cal_tz()
            + make_interval(mins => CASE WHEN o.n IS NOT DISTINCT FROM v.moved_n THEN v.moved_by ELSE 0 END) AS at
 ) s
 ORDER BY v.key, o.n
ON CONFLICT (id) DO UPDATE
    SET starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, recurrence_rule = EXCLUDED.recurrence_rule,
        status = EXCLUDED.status, archived_at = EXCLUDED.archived_at
  WHERE scheduling.events.starts_at IS DISTINCT FROM EXCLUDED.starts_at
     OR scheduling.events.recurrence_rule IS DISTINCT FROM EXCLUDED.recurrence_rule;

-- #endregion

-- #region Alerts on entries

-- An alert belongs to the person, so these are the target's own overrides of their default (ten minutes
-- before, in the app). Nearest first, as `normalizeReminders` stores them; `[]` switches an entry's off.
INSERT INTO scheduling.event_reminders (event_id, user_id, reminders)
SELECT pg_temp.sid('event:' || v.key), pg_temp.me(), v.alerts::jsonb
  FROM (VALUES
      ('sprint-planning', '[{"minutes":15,"channel":"in_app"},{"minutes":1440,"channel":"email"}]'),
      ('stakeholder-workshop', '[{"minutes":60,"channel":"in_app"},{"minutes":2880,"channel":"email"}]'),
      ('readout-due', '[{"minutes":120,"channel":"in_app"},{"minutes":1440,"channel":"email"}]'),
      ('trade-licence', '[{"minutes":0,"channel":"in_app"},{"minutes":10080,"channel":"email"}]'),
      ('final-invoice-due', '[{"minutes":1440,"channel":"in_app"}]'),
      ('landing-teardown', '[{"minutes":30,"channel":"in_app"}]'),
      ('lunch-noor', '[]')
  ) AS v (key, alerts)
ON CONFLICT (event_id, user_id) DO NOTHING;

INSERT INTO scheduling.event_reminders (event_id, user_id, reminders)
SELECT e.id, pg_temp.me(), v.alerts::jsonb
  FROM (VALUES
      ('arabic-lesson', '[{"minutes":60,"channel":"in_app"}]'),
      ('coworking-rent', '[{"minutes":1440,"channel":"email"}]')
  ) AS v (key, alerts)
  JOIN scheduling.events e
    ON e.id = pg_temp.sid('series:' || v.key || ':0') OR e.recurrence_parent_id = pg_temp.sid('series:' || v.key || ':0')
ON CONFLICT (event_id, user_id) DO NOTHING;

-- #endregion

-- #region The client who pays for sessions

-- Escrow needs a payer whose ledger this script may write, so seeded wallets stay as they are: a
-- business made here, owned by a persona, with its own vault.
INSERT INTO org.business_profiles (
    id, owner_user_id, name, slug, legal_name, country, headline, languages, timezone, default_currency,
    address_city, status, kyb_status, kyb_verified_at, visibility, created_at
)
VALUES (
    pg_temp.sid('payer-business'), pg_temp.persona('noor'), 'Harbour Lane Trading',
    'harbour-lane-' || substr(pg_temp.me()::text, 1, 4), 'Harbour Lane Trading FZ-LLC', 'AE',
    'Speciality food imports across the Gulf', ARRAY['en', 'ar'], 'Asia/Dubai', 'USD',
    'Dubai', 'active', 'verified', now() - interval '110 days', 'unlisted', now() - interval '120 days'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.business_roles (id, business_id, name, summary, preset, base_preset)
VALUES (
    pg_temp.sid('payer-business:owner-role'), pg_temp.sid('payer-business'), 'Owner',
    'Full authority, including archiving and transferring ownership.', 'owner', 'owner'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.business_members (id, business_id, user_id, role_id, role, status, title, joined_at, created_at)
VALUES (
    pg_temp.sid('payer-business:owner'), pg_temp.sid('payer-business'), pg_temp.persona('noor'),
    pg_temp.sid('payer-business:owner-role'), 'owner', 'active', 'Founder',
    now() - interval '120 days', now() - interval '120 days'
)
ON CONFLICT (id) DO NOTHING;

-- #endregion

-- #region Session services and their engagements

INSERT INTO marketplace.service_blueprints (
    id, owner_type, freelancer_profile_id, title, slug, description, description_text, delivery_model,
    pricing_model, price_cents, session_price_cents, currency, category, requires_upfront_escrow,
    max_seats_per_cohort, allow_continuous_enrollment, deliverables, session_minutes, session_count,
    is_published, created_at
)
SELECT pg_temp.sid('service:' || v.key), 'freelancer', pg_temp.me(), v.title, pg_temp.slug('svc', 'calendar:' || v.key),
       jsonb_build_object('html', '<p>' || v.summary || '</p>'), v.summary,
       v.model::marketplace.service_delivery_model, 'per_seat'::marketplace.pricing_model, v.price, v.session_price,
       'USD', 'product', false, v.seats, v.seats > 1, v.deliverables, v.minutes, v.sessions, true,
       now() - interval '60 days'
  FROM (VALUES
      ('strategy-block', 'Product strategy block',
       'Four one-to-one working sessions on your product strategy: where to play, what to cut, and the plan you take to your team.',
       'session', 60000::bigint, 15000::bigint, 1, 60, 4,
       ARRAY['Four 60-minute sessions', 'A written plan after each session', 'Async feedback between sessions']),
      ('discovery-cohort', 'Product discovery cohort',
       'Five live weekly classes with a small group, working a real product decision from framing to a roadmap you can defend.',
       'group_session', 48000::bigint, 48000::bigint, 12, 120, NULL,
       ARRAY['Five live two-hour classes', 'Templates for every exercise', 'Recordings of each class'])
  ) AS v (key, title, summary, model, price, session_price, seats, minutes, sessions, deliverables)
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalogue.listings (
    id, owner_user_id, kind, status, service_blueprint_id, title, description, description_text, category,
    delivery_label, amount_cents, currency, session_price_cents, seats_per_session, published_at, created_at
)
SELECT pg_temp.sid('listing:' || v.key), pg_temp.me(), 'service', 'published', b.id, b.title, b.description,
       b.description_text, b.category, v.delivery, b.price_cents, b.currency, b.session_price_cents, v.seats,
       now() - interval '55 days', now() - interval '60 days'
  FROM (VALUES
      ('strategy-block', '4 × 60-minute sessions', NULL::integer),
      ('discovery-cohort', '5 × 2-hour classes', 12)
  ) AS v (key, delivery, seats)
  JOIN marketplace.service_blueprints b ON b.id = pg_temp.sid('service:' || v.key)
ON CONFLICT (id) DO NOTHING;

-- One engagement per service, as `fn_session_engagement_for` makes it: unlisted, active, and with the
-- one "Sessions" stage every booking's cohort hangs off.
INSERT INTO projects.projects (
    id, owner_user_id, title, slug, description, description_text, format, structure_variation, session_kind,
    status, visibility, publish_visibility, currency, budget_type, source_blueprint_id, created_at
)
SELECT pg_temp.sid('project:' || v.key), pg_temp.me(), b.title, pg_temp.slug('prj', 'calendar:' || v.key),
       b.description, b.description_text, 'session', 'standard', v.kind, 'active', 'unlisted', 'unlisted',
       b.currency, 'fixed_price', b.id, now() - interval '50 days'
  FROM (VALUES ('strategy-block', 'normal'), ('discovery-cohort', 'group')) AS v (key, kind)
  JOIN marketplace.service_blueprints b ON b.id = pg_temp.sid('service:' || v.key)
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_stages (id, project_id, name, slug, sort_order, unit_price_cents)
SELECT pg_temp.sid('stage:' || v.key), pg_temp.sid('project:' || v.key), 'Sessions',
       pg_temp.slug('stg', 'calendar:' || v.key), 0, b.session_price_cents
  FROM (VALUES ('strategy-block'), ('discovery-cohort')) AS v (key)
  JOIN marketplace.service_blueprints b ON b.id = pg_temp.sid('service:' || v.key)
 WHERE NOT EXISTS (SELECT 1 FROM projects.project_stages s WHERE s.id = pg_temp.sid('stage:' || v.key));

-- A 1-1 client is a cohort of one seat. Miguel's seat and cohort ended when he cancelled.
INSERT INTO projects.cohorts (id, project_id, project_stage_id, name, max_seats, status, created_at)
SELECT pg_temp.sid('cohort:' || v.client), pg_temp.sid('project:strategy-block'), pg_temp.sid('stage:strategy-block'),
       'Product strategy block', 1, v.status::projects.cohort_status, now() - make_interval(days => v.paid_days)
  FROM (VALUES ('noor', 'active', 24), ('rosalindqvist', 'active', 1), ('miguelsantos', 'cancelled', 14))
       AS v (client, status, paid_days)
UNION ALL
SELECT pg_temp.sid('cohort:group'), pg_temp.sid('project:discovery-cohort'), pg_temp.sid('stage:discovery-cohort'),
       'Autumn cohort', 12, 'enrolling', now() - interval '30 days'
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.cohort_memberships (id, cohort_id, user_id, seats, status, joined_at, cancelled_at)
SELECT pg_temp.sid('membership:' || v.client), pg_temp.sid('cohort:' || v.client), pg_temp.persona(v.client), 1,
       v.status, now() - make_interval(days => v.paid_days),
       CASE WHEN v.status = 'cancelled' THEN now() - interval '3 days' END
  FROM (VALUES ('noor', 'active', 24), ('rosalindqvist', 'active', 1), ('miguelsantos', 'cancelled', 14))
       AS v (client, status, paid_days)
UNION ALL
SELECT pg_temp.sid('membership:group:' || v.who), pg_temp.sid('cohort:group'), pg_temp.persona(v.who), 1,
       'active', now() - make_interval(days => v.paid_days), NULL
  FROM (VALUES ('theo', 23), ('chloewinters', 22), ('priyaraman', 21), ('danielokafor', 21), ('hannahcole', 20))
       AS v (who, paid_days)
ON CONFLICT (id) DO NOTHING;

-- No room is named here, so a sitting takes the provider `fn_sitting_provider` finds: a connected one
-- when the target has one, else none, and the session page asks them for a link.
INSERT INTO projects.session_events (id, cohort_id, title, slug, start_time, end_time, status, created_at)
SELECT pg_temp.sid('sitting:' || s.client || ':' || s.n), pg_temp.sid('cohort:' || s.client),
       'Product strategy block — session ' || s.n || ' of 4', pg_temp.slug('ssn', 'calendar:' || s.client || ':' || s.n),
       pg_temp.cal_at(s.week, s.day, s.starts), pg_temp.cal_at(s.week, s.day, s.starts) + interval '60 minutes',
       (CASE s.state WHEN 'attended' THEN 'completed' WHEN 'cancelled' THEN 'cancelled_by_client' ELSE 'scheduled' END)::projects.session_event_status,
       m.joined_at
  FROM pg_temp.cal_sittings() s
  JOIN projects.cohort_memberships m ON m.id = pg_temp.sid('membership:' || s.client)
UNION ALL
SELECT pg_temp.sid('sitting:group:' || g.n), pg_temp.sid('cohort:group'), g.title,
       pg_temp.slug('ssn', 'calendar:group:' || g.n), t.at, t.at + interval '120 minutes',
       (CASE WHEN t.at + interval '120 minutes' <= now() THEN 'completed' ELSE 'scheduled' END)::projects.session_event_status,
       now() - interval '30 days'
  FROM pg_temp.cal_group_sittings() g
 CROSS JOIN LATERAL (SELECT pg_temp.cal_at(g.week, 0, '09:30') AS at) t
ON CONFLICT (id) DO NOTHING;

-- The calendar mirrors. A mirror sits on the schedule and on the engagement, which is what puts it on
-- the agenda with the project's name. A pencilled-in sitting is tentative, and a cancelled one stays
-- on the calendar as cancelled. Left DO NOTHING: moving one moves its sitting (trg_sitting_follows_calendar).
INSERT INTO scheduling.events (
    id, schedule_id, project_id, kind, status, title, starts_at, ends_at, attendee_count, capacity,
    source_session_event_id, created_by, created_at
)
SELECT pg_temp.sid('mirror:' || s.client || ':' || s.n), pg_temp.cal_schedule(), pg_temp.sid('project:strategy-block'),
       'session'::scheduling.event_kind,
       (CASE s.state WHEN 'pencilled' THEN 'tentative' WHEN 'cancelled' THEN 'cancelled' ELSE 'confirmed' END)::scheduling.event_status,
       se.title, se.start_time, se.end_time, 1, 1, se.id, pg_temp.me(), se.created_at
  FROM pg_temp.cal_sittings() s
  JOIN projects.session_events se ON se.id = pg_temp.sid('sitting:' || s.client || ':' || s.n)
UNION ALL
SELECT pg_temp.sid('mirror:group:' || g.n), pg_temp.cal_schedule(), pg_temp.sid('project:discovery-cohort'),
       'session'::scheduling.event_kind, 'confirmed'::scheduling.event_status, se.title, se.start_time, se.end_time, 5, 12, se.id, pg_temp.me(), se.created_at
  FROM pg_temp.cal_group_sittings() g
  JOIN projects.session_events se ON se.id = pg_temp.sid('sitting:group:' || g.n)
ON CONFLICT (id) DO NOTHING;

-- A 1-1 mirror has both people on its roster. A group one has none, so no vote can move it.
INSERT INTO scheduling.event_attendees (id, event_id, user_id, role, response, responded_at, created_at)
SELECT pg_temp.sid('seat:mirror:' || s.client || ':' || s.n || ':' || w.who), pg_temp.sid('mirror:' || s.client || ':' || s.n),
       w.user_id, w.role::scheduling.attendee_role,
       (CASE WHEN w.who = 'buyer' AND s.state = 'pencilled' THEN 'pending' ELSE 'accepted' END)::scheduling.rsvp_response,
       CASE WHEN w.who = 'host' OR s.state <> 'pencilled' THEN m.joined_at END, m.joined_at
  FROM pg_temp.cal_sittings() s
  JOIN projects.cohort_memberships m ON m.id = pg_temp.sid('membership:' || s.client)
 CROSS JOIN LATERAL (VALUES ('host', pg_temp.me(), 'host'), ('buyer', m.user_id, 'participant')) AS w (who, user_id, role)
ON CONFLICT (id) DO NOTHING;

-- Rosa's pencilled-in times are waiting on the handshake a block opens: 72 hours from payment, and
-- never later than a day before the sitting. If it lapses the time stands, and the sweep confirms it.
INSERT INTO scheduling.event_reschedules (id, event_id, round, mode, status, opened_by_user_id, opened_at, resolves_at)
SELECT pg_temp.sid('handshake:' || s.client || ':' || s.n), pg_temp.sid('mirror:' || s.client || ':' || s.n), 0,
       'counterparty', 'collecting', pg_temp.me(), m.joined_at,
       LEAST(m.joined_at + interval '72 hours', se.start_time - interval '24 hours')
  FROM pg_temp.cal_sittings() s
  JOIN projects.cohort_memberships m ON m.id = pg_temp.sid('membership:' || s.client)
  JOIN projects.session_events se ON se.id = pg_temp.sid('sitting:' || s.client || ':' || s.n)
 WHERE s.state = 'pencilled'
ON CONFLICT (id) DO NOTHING;

-- Attended: the attendee's own confirmation is the evidence, as `answer_session_review` records it,
-- so the payout sweep reads these as successful.
INSERT INTO projects.session_attendance (id, session_event_id, user_id, joined_at, left_at, source)
SELECT pg_temp.sid('attendance:' || se.id || ':' || m.user_id), se.id, m.user_id, se.start_time, se.end_time, 'confirmed'
  FROM projects.session_events se
  JOIN projects.cohort_memberships m ON m.cohort_id = se.cohort_id
 WHERE se.status = 'completed'
   AND se.cohort_id IN (
       pg_temp.sid('cohort:noor'), pg_temp.sid('cohort:miguelsantos'), pg_temp.sid('cohort:group')
   )
ON CONFLICT (id) DO NOTHING;

-- #endregion

-- #region Session money

-- 1-1: one escrow per sitting, released a day after it ended, or refunded when it was cancelled. Group:
-- one escrow per seat, held until a day after the cohort's last sitting. The fee is the platform's own
-- rate for this payer. Released rows pay the target, and populate_07_wallet.sql walks them into the
-- target's ledger; nothing here touches that wallet.
INSERT INTO finance.escrows (
    id, project_stage_id, cohort_membership_id, session_event_id, payer_business_id, payee_type, payee_id,
    amount_cents, platform_fee_cents, currency, status, created_at, released_at
)
SELECT pg_temp.sid('escrow:' || s.client || ':' || s.n), pg_temp.sid('stage:strategy-block'), m.id, se.id,
       pg_temp.sid('payer-business'), 'freelancer'::assignment_type, pg_temp.me(), 15000,
       CASE WHEN s.state = 'attended'
            THEN 15000 * finance.fn_escrow_fee_bp(pg_temp.sid('payer-business'), NULL) / 10000 ELSE 0 END,
       'USD', CASE s.state WHEN 'attended' THEN 'released' WHEN 'cancelled' THEN 'refunded' ELSE 'held' END,
       m.joined_at, CASE WHEN s.state = 'attended' THEN se.end_time + interval '24 hours' END
  FROM pg_temp.cal_sittings() s
  JOIN projects.cohort_memberships m ON m.id = pg_temp.sid('membership:' || s.client)
  JOIN projects.session_events se ON se.id = pg_temp.sid('sitting:' || s.client || ':' || s.n)
UNION ALL
SELECT pg_temp.sid('escrow:seat:' || m.id), pg_temp.sid('stage:discovery-cohort'), m.id, NULL,
       pg_temp.sid('payer-business'), 'freelancer'::assignment_type, pg_temp.me(), 48000, 0, 'USD', 'held',
       m.joined_at, NULL
  FROM projects.cohort_memberships m
 WHERE m.cohort_id = pg_temp.sid('cohort:group')
ON CONFLICT (id) DO NOTHING;

-- The payer's ledger, in one chronological pass: the top-up, each hold when it was paid, and the three
-- refunds when Miguel cancelled. $6,000 in, $4,200 held, $450 back, which leaves $2,250.
DO $$
DECLARE
    v_wallet uuid := pg_temp.wallet('business', pg_temp.sid('payer-business'));
    v_step integer := 0;
    r record;
BEGIN
    PERFORM pg_temp.post('calendar:topup', v_wallet, 'credit', 600000, 'topup', now() - interval '30 days');
    FOR r IN
        SELECT e.id, e.amount_cents, 'hold' AS move, e.created_at AS at
          FROM finance.escrows e
         WHERE e.payer_business_id = pg_temp.sid('payer-business')
        UNION ALL
        SELECT e.id, e.amount_cents, 'refund', m.cancelled_at
          FROM finance.escrows e
          JOIN projects.cohort_memberships m ON m.id = e.cohort_membership_id
         WHERE e.payer_business_id = pg_temp.sid('payer-business') AND e.status = 'refunded'
         ORDER BY at, id
    LOOP
        v_step := v_step + 1;
        PERFORM pg_temp.post(
            'calendar:' || r.move || ':' || r.id, v_wallet,
            CASE r.move WHEN 'hold' THEN 'debit' ELSE 'credit' END, r.amount_cents,
            CASE r.move WHEN 'hold' THEN 'escrow_hold' ELSE 'escrow_refund' END,
            r.at + make_interval(secs => v_step), 'escrows', r.id
        );
    END LOOP;
END;
$$;

-- #endregion

-- #region Discovery calls

-- A call is its own calendar row: /calendar draws every call a person is party to straight from this
-- table, as a `booking`, at the call's own instant, for both of them. An events row beside it would
-- hold the call's slot against any move of the call (fn_has_conflicting_event has no way to exclude
-- it), so `event_id` stays NULL. Declined, cancelled and expired calls leave the calendar and release
-- the time. All are courtesy calls: `request_discovery_call` refuses a paid one (Decision #343, ruling
-- C1), so no paid call is reachable. Times are in the host's zone, inside the host's call windows.
-- `proposed` calls were asked for hours ago: the sweep expires one 72 hours after it was asked.
WITH call (key, host, requester, status, w, d, t, platform, asked_hours, cancelled_by, reason, agenda) AS (VALUES
    -- Persona books the target
    ('hannah-proposed', 'me', 'hannahcole', 'proposed', 1, 0, '14:30', 'google', 6, NULL, NULL,
     'Could you look over our onboarding funnel and say whether a discovery sprint would help?'),
    ('chloe-confirmed', 'me', 'chloewinters', 'confirmed', 1, 3, '15:00', 'zoom', 50, NULL, NULL,
     'Advice on pricing my first retainer before I pitch it to a client.'),
    ('priya-completed', 'me', 'priyaraman', 'completed', -1, 0, '14:30', 'google', 96, NULL, NULL,
     'A second opinion on how we scope our next research round.'),
    ('lena-no-show', 'me', 'lenamueller', 'no_show', -1, 3, '15:30', 'zoom', 72, NULL, NULL,
     'Whether the strategy block suits a two-person studio.'),
    ('rosa-declined', 'me', 'rosalindqvist', 'declined', -1, 3, '14:30', 'google', 80, NULL,
     'Fully booked that week. Happy to look at the one after.',
     'Quick chat about a mobile redesign.'),
    ('kwame-expired', 'me', 'kwamemensah', 'expired', -1, 6, '11:30', 'zoom', 110, NULL, NULL,
     'Exploring a partnership on data tooling.'),
    ('miguel-cancelled', 'me', 'miguelsantos', 'cancelled', 0, 1, '10:30', 'microsoft_teams', 96, 'requester',
     'Budget moved to next quarter, so I will come back to you then.',
     'Scoping a workshop for our product team.'),
    -- The target books a persona, in that persona's windows
    ('maris-proposed', 'marisdelacroix', 'me', 'proposed', 1, 3, '11:15', 'google', 5, NULL, NULL,
     'Could I ask how you structured your design system retainer?'),
    ('samuel-confirmed', 'samuelnkemelu', 'me', 'confirmed', 1, 1, '15:00', 'google', 40, NULL, NULL,
     'Talking through an API integration for a client''s order flow.'),
    ('tomasz-completed', 'tomaszwojcik', 'me', 'completed', -1, 0, '13:00', 'microsoft_teams', 90, NULL, NULL,
     'A sanity check on a data pipeline estimate.'),
    ('ren-cancelled', 'renkoda', 'me', 'cancelled', 1, 5, '11:00', 'zoom', 96, 'host',
     'Travelling that week after all. Please book the week after.',
     'Packaging art direction for a client launch.')
), placed AS (
    SELECT c.*, s.id AS schedule_id, s.owner_id AS host_id, s.timezone, st.courtesy_duration_minutes AS minutes,
           r.user_id AS requester_id, r.timezone AS requester_tz,
           pg_temp.cal_at(c.w, c.d, c.t, s.timezone) AS starts_at,
           -- A cancelling host had confirmed it: only a requester can drop a call still proposed.
           c.status IN ('confirmed', 'completed', 'no_show') OR c.cancelled_by = 'host' AS agreed
      FROM call c
      JOIN scheduling.schedules s
        ON s.owner_type = 'user'
       AND s.owner_id = CASE c.host WHEN 'me' THEN pg_temp.me() ELSE pg_temp.persona(c.host) END
      JOIN scheduling.call_settings st ON st.schedule_id = s.id
      JOIN org.users_public r
        ON r.user_id = CASE c.requester WHEN 'me' THEN pg_temp.me() ELSE pg_temp.persona(c.requester) END
)
INSERT INTO scheduling.discovery_calls (
    id, host_schedule_id, host_user_id, requester_user_id, call_type, status, proposed_start, proposed_end,
    proposed_by, confirmed_start, confirmed_end, requester_timezone, agenda, provider_slug, proposed_at,
    responded_at, confirmed_at, completed_at, cancelled_at, cancelled_by, cancellation_reason, no_show_party
)
SELECT pg_temp.sid('call:' || p.key), p.schedule_id, p.host_id, p.requester_id, 'courtesy',
       p.status::scheduling.call_status, p.starts_at, x.ends_at, 'requester',
       CASE WHEN p.agreed THEN p.starts_at END, CASE WHEN p.agreed THEN x.ends_at END,
       p.requester_tz, p.agenda, p.platform, x.asked_at,
       CASE WHEN p.agreed OR p.status = 'declined' THEN x.asked_at + interval '5 hours' END,
       CASE WHEN p.agreed THEN x.asked_at + interval '5 hours' END,
       CASE WHEN p.status = 'completed' THEN x.ends_at END,
       CASE WHEN p.status = 'cancelled' THEN x.asked_at + interval '30 hours' END,
       p.cancelled_by::scheduling.call_party, p.reason,
       CASE WHEN p.status = 'no_show' THEN 'requester'::scheduling.call_party END
  FROM placed p
 CROSS JOIN LATERAL (
     SELECT p.starts_at + make_interval(mins => p.minutes) AS ends_at,
            LEAST(now(), p.starts_at) - make_interval(hours => p.asked_hours) AS asked_at
 ) x
ON CONFLICT (id) DO UPDATE
    SET status = EXCLUDED.status, proposed_start = EXCLUDED.proposed_start, proposed_end = EXCLUDED.proposed_end,
        confirmed_start = EXCLUDED.confirmed_start, confirmed_end = EXCLUDED.confirmed_end,
        proposed_at = EXCLUDED.proposed_at, responded_at = EXCLUDED.responded_at,
        confirmed_at = EXCLUDED.confirmed_at, completed_at = EXCLUDED.completed_at,
        cancelled_at = EXCLUDED.cancelled_at
  WHERE (scheduling.discovery_calls.proposed_start, scheduling.discovery_calls.status)
        IS DISTINCT FROM (EXCLUDED.proposed_start, EXCLUDED.status);

-- Who was in the room. A no-show has only the host.
INSERT INTO scheduling.call_attendance (id, call_id, user_id, joined_at, left_at)
SELECT pg_temp.sid('call-attendance:' || c.id || ':' || w.user_id), c.id, w.user_id,
       c.confirmed_start, c.confirmed_end
  FROM scheduling.discovery_calls c
 CROSS JOIN LATERAL (VALUES (c.host_user_id), (c.requester_user_id)) AS w (user_id)
 WHERE c.id IN (pg_temp.sid('call:priya-completed'), pg_temp.sid('call:tomasz-completed'), pg_temp.sid('call:lena-no-show'))
   AND (c.status = 'completed' OR w.user_id = c.host_user_id)
ON CONFLICT (id) DO NOTHING;

-- #endregion

-- #region Summary
WITH own AS (
    SELECT e.* FROM scheduling.events e WHERE e.schedule_id = pg_temp.cal_schedule() AND e.archived_at IS NULL
), seats AS (
    SELECT a.response
      FROM scheduling.event_attendees a
      JOIN scheduling.events e ON e.id = a.event_id
     WHERE a.role <> 'host' AND e.source_session_event_id IS NULL
       AND (e.created_by = pg_temp.me() OR a.user_id = pg_temp.me())
), sittings AS (
    SELECT se.status, e.status AS calendar_status
      FROM projects.session_events se
      JOIN scheduling.events e ON e.source_session_event_id = se.id
      JOIN projects.cohorts c ON c.id = se.cohort_id
      JOIN projects.projects p ON p.id = c.project_id
     WHERE p.owner_user_id = pg_temp.me()
), calls AS (
    SELECT c.status, c.host_user_id = pg_temp.me() AS hosted
      FROM scheduling.discovery_calls c
     WHERE pg_temp.me() IN (c.host_user_id, c.requester_user_id)
)
SELECT what, how_many FROM (
    SELECT 10 AS ord, 'Availability: published schedule in ' || pg_temp.cal_tz() AS what, 1::bigint AS how_many
    UNION ALL SELECT 11, 'Availability: weekly bands', count(*) FROM scheduling.availability_rules WHERE schedule_id = pg_temp.cal_schedule()
    UNION ALL SELECT 12, 'Availability: blackouts', count(*) FROM scheduling.blackout_dates WHERE schedule_id = pg_temp.cal_schedule()
    UNION ALL SELECT 13, 'Availability: call slots open for the rest of this week',
        pg_temp.cal_open_slots((now() AT TIME ZONE pg_temp.cal_tz())::date, pg_temp.cal_day(0, 6))
    UNION ALL SELECT 14, 'Availability: call slots open next week', pg_temp.cal_open_slots(pg_temp.cal_day(1, 0), pg_temp.cal_day(1, 6))
    UNION ALL SELECT 20, 'Entries of kind: ' || kind, count(*) FROM own GROUP BY kind
    UNION ALL SELECT 30, 'Reminders (moments with no length)', count(*) FROM own WHERE ends_at = starts_at
    UNION ALL SELECT 31, 'All-day entries', count(*) FROM own WHERE all_day
    UNION ALL SELECT 32, 'Alert overrides on entries', count(*) FROM scheduling.event_reminders WHERE user_id = pg_temp.me()
    UNION ALL SELECT 33, 'Routines', count(*) FROM scheduling.routines WHERE schedule_id = pg_temp.cal_schedule()
    UNION ALL SELECT 34, 'Recurring series', count(*) FROM own WHERE recurrence_rule IS NOT NULL
    UNION ALL SELECT 35, 'Later occurrences of those series', count(*) FROM own WHERE recurrence_parent_id IS NOT NULL
    UNION ALL SELECT 40, 'Invitations: ' || response, count(*) FROM seats GROUP BY response
    UNION ALL SELECT 50, 'Session services', count(*) FROM marketplace.service_blueprints
        WHERE freelancer_profile_id = pg_temp.me() AND delivery_model IN ('session', 'group_session')
    UNION ALL SELECT 51, 'Sittings: ' || status || ' (on the calendar as ' || calendar_status || ')', count(*)
        FROM sittings GROUP BY status, calendar_status
    UNION ALL SELECT 60, 'Calls hosted: ' || status, count(*) FROM calls WHERE hosted GROUP BY status
    UNION ALL SELECT 61, 'Calls booked with others: ' || status, count(*) FROM calls WHERE NOT hosted GROUP BY status
) summary
ORDER BY ord, what;
-- #endregion

COMMIT;
