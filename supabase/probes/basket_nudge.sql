-- =============================================================================================
-- Probe: a basket left idle gets one reminder, within the notification rules (CK5; MK-18). Owner
-- rulings: the nudge is Marketing (A), Marketing is opt-in at the root, and it ships switched off.
--
--   1  door      the finder exists, is the service role's alone, and a daily job runs it; the
--                catalogue row is Marketing, email, never mandatory, never digested, and opens
--                /checkout
--   2  opt-in    a category's own value wins; with none it follows the master, except Marketing,
--                which is off; the router, the unread escalation and the digests all read that rule
--   3  switch    while comms.basket_nudge is off, the finder queues nothing
--   4  idle      a personal default basket with a live line, untouched past the lead time, with no
--                order since, queues exactly one basket.abandoned for its opted-in adult owner,
--                an email-digest reader included
--   5  payload   the notice names the lines and never a price; it opens /checkout, which reprices
--   6  repeat    a second run queues nothing; a basket touched after its nudge and idle again inside
--                the group window is not nudged; one never touched since an old nudge is not either;
--                one touched after a nudge older than the window is nudged again
--   7  none      a fresh basket, a checked-out one, an emptied one, an owner who ordered since, a
--                muted notice, no Marketing opt-in, an unsubscribed address, a minor, a basket of
--                saved-for-later lines only, a wishlist and a business basket queue nothing
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Each person's default basket is
-- its own fixture (an existing one is reused, its lines retired inside the transaction). Run with
-- `deno task test:probes basket_nudge`.
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;

CREATE FUNCTION pg_temp.ok(p boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
END;
$$;

-- The person's default basket (or, with p_default false, a wishlist of theirs), holding exactly one
-- live line, last touched `p_idle` ago. Lines it already held are retired and every timestamp is moved
-- back, so nothing else reads as activity.
CREATE FUNCTION pg_temp.basket_for(p_user uuid, p_idle interval, p_title text, p_default boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_basket uuid;
    v_at timestamptz := pg_catalog.now() - p_idle;
BEGIN
    IF p_default THEN
        SELECT b.id INTO v_basket FROM finance.baskets b
         WHERE b.owner_type = 'user' AND b.owner_id = p_user AND b.is_default;
    END IF;
    IF v_basket IS NULL THEN
        INSERT INTO finance.baskets (owner_type, owner_id, name, is_default)
        VALUES ('user', p_user, CASE WHEN p_default THEN 'Main Basket' ELSE 'Probe wishlist' END, p_default)
        RETURNING id INTO v_basket;
    END IF;
    UPDATE finance.basket_items
       SET removed_at = COALESCE(removed_at, v_at), updated_at = v_at, created_at = LEAST(created_at, v_at)
     WHERE basket_id = v_basket;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency,
                                      created_at, updated_at)
    VALUES (v_basket, 'digital_product', gen_random_uuid(), p_title, 4200, 'GBP', v_at, v_at);
    UPDATE finance.baskets SET updated_at = v_at, created_at = LEAST(created_at, v_at) WHERE id = v_basket;
    RETURN v_basket;
END;
$$;

-- Move a basket's last touch (the basket row and every line) to `p_at`.
CREATE FUNCTION pg_temp.touch(p_basket uuid, p_at timestamptz) RETURNS void LANGUAGE sql AS $$
    UPDATE finance.basket_items SET updated_at = p_at WHERE basket_id = p_basket;
    UPDATE finance.baskets SET updated_at = p_at WHERE id = p_basket;
$$;

-- The basket.abandoned rows queued for one basket, whatever their state.
CREATE FUNCTION pg_temp.nudges(p_basket uuid) RETURNS integer LANGUAGE sql AS $$
    SELECT count(*)::integer FROM comms.notification_queue q
     WHERE q.type = 'basket.abandoned' AND q.entity_table = 'finance.baskets' AND q.entity_id = p_basket;
$$;

DO $probe$
DECLARE
    v_fn constant text := 'comms.fn_enqueue_basket_nudges(integer)';
    v_people uuid[];
    v_baskets uuid[];
    v_idle uuid;
    v_row comms.notification_queue%ROWTYPE;
    v_note comms.notifications%ROWTYPE;
    v_type comms.notification_types%ROWTYPE;
    v_address text;
    v_i integer;
BEGIN
    -- #region 1. The door and the catalogue row
    PERFORM pg_temp.ok(pg_catalog.to_regprocedure(v_fn) IS NOT NULL,
        'an idle basket queues one nudge: there is no finder (comms.fn_enqueue_basket_nudges)');
    PERFORM pg_temp.ok(
        NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
        AND NOT has_function_privilege('anon', v_fn, 'EXECUTE')
        AND has_function_privilege('service_role', v_fn, 'EXECUTE'),
        'the finder is the service role''s alone');
    PERFORM pg_temp.ok(
        EXISTS (SELECT 1 FROM ops.scheduled_jobs j
                 WHERE j.name = 'comms-basket-nudges' AND j.kind = 'sql'
                   AND j.command ILIKE '%comms.fn_enqueue_basket_nudges%'),
        'a daily job runs the finder');

    SELECT * INTO v_type FROM comms.notification_types t WHERE t.key = 'basket.abandoned';
    PERFORM pg_temp.ok(v_type.category = 'marketing' AND NOT v_type.mandatory
                       AND v_type.default_channels = ARRAY['email']::comms.notification_channel[],
        'the nudge is Marketing, email only, never mandatory (ruling A)');
    PERFORM pg_temp.ok(NOT v_type.digestible,
        'the nudge is a reminder, never rolled into a digest (so a digest reader is reminded too)');
    PERFORM pg_temp.ok(v_type.action_url_template = '/checkout', 'the catalogue row opens /checkout');
    PERFORM pg_temp.ok(v_type.default_lead_time IS NOT NULL AND v_type.group_window IS NOT NULL,
        'the catalogue row carries the lead time and the group window');
    -- #endregion

    -- Twelve adults with a primary verified address, so no case is decided by an age rule or a
    -- missing address. Each starts with every global channel on, no snooze, no mute, no suppression
    -- and Marketing email turned on; the cases below take one of those away.
    SELECT array_agg(p.user_id ORDER BY p.user_id) INTO v_people
      FROM (SELECT u.user_id FROM org.users_public u
             WHERE u.dob IS NOT NULL AND NOT org.fn_is_minor(u.user_id)
               AND EXISTS (SELECT 1 FROM org.user_emails e
                            WHERE e.user_id = u.user_id AND e.is_primary AND e.verified_at IS NOT NULL)
             ORDER BY u.user_id LIMIT 12) p;
    PERFORM pg_temp.ok(array_length(v_people, 1) = 12, 'the seed has twelve adults with a verified address');

    FOR v_i IN 1 .. 12 LOOP
        PERFORM comms.fn_ensure_notification_prefs(v_people[v_i]);
    END LOOP;
    UPDATE comms.notification_prefs
       SET in_app = true, email = true, muted_until = NULL, digest_frequency = 'off'
     WHERE user_id = ANY (v_people);
    UPDATE comms.notification_category_prefs SET digest_frequency = NULL WHERE user_id = ANY (v_people);
    DELETE FROM comms.notification_type_mutes WHERE user_id = ANY (v_people);
    UPDATE comms.channel_suppressions SET lifted_at = pg_catalog.now()
     WHERE lifted_at IS NULL AND channel = 'email'
       AND lower(destination) IN (SELECT lower(e.email) FROM org.user_emails e WHERE e.user_id = ANY (v_people));
    INSERT INTO comms.notification_category_prefs (user_id, category, email)
    SELECT p, 'marketing', true FROM unnest(v_people) AS p
    ON CONFLICT (user_id, category) DO UPDATE SET email = true;

    -- #region 2. Opt-in, at the root
    PERFORM pg_temp.ok(
        comms.fn_category_channel_on('work', true, false) AND NOT comms.fn_category_channel_on('work', false, true)
        AND comms.fn_category_channel_on('work', NULL, true) AND NOT comms.fn_category_channel_on('work', NULL, false)
        AND comms.fn_category_channel_on('marketing', true, false)
        AND NOT comms.fn_category_channel_on('marketing', NULL, true)
        AND NOT comms.fn_category_channel_on('marketing', NULL, NULL),
        'a category''s own value wins; with none it follows the master, except Marketing, which is off');

    DELETE FROM comms.notification_category_prefs WHERE user_id = v_people[7] AND category = 'marketing';
    PERFORM pg_temp.ok(
        comms.fn_resolve_channels(v_people[7], 'marketing.product_update') = '{}'::comms.notification_channel[],
        'with every master on and no Marketing choice, a Marketing notice goes nowhere');
    PERFORM pg_temp.ok(
        comms.fn_resolve_channels(v_people[7], 'search.saved_alert') @> ARRAY['in_app', 'email']::comms.notification_channel[],
        'another category with no choice of its own still follows the masters');
    PERFORM pg_temp.ok(
        comms.fn_resolve_channels(v_people[1], 'marketing.product_update') = ARRAY['email']::comms.notification_channel[],
        'Marketing reaches exactly the channels the person turned on for it');
    PERFORM pg_temp.ok(
        pg_catalog.pg_get_functiondef('comms.fn_resolve_channels(uuid,text)'::regprocedure) ~ 'fn_category_channel_on'
        AND pg_catalog.pg_get_functiondef('comms.fn_escalate_unread(integer)'::regprocedure) ~ 'fn_category_channel_on'
        AND pg_catalog.pg_get_functiondef('comms.fn_build_digests(comms.digest_frequency)'::regprocedure) ~ 'fn_category_channel_on',
        'the router, the unread escalation and the digests read the one opt-in rule');
    -- #endregion

    -- The cases. Every basket but the fresh one is idle past the lead time.
    v_baskets := ARRAY[
        pg_temp.basket_for(v_people[1],  v_type.default_lead_time + interval '1 hour', 'Probe idle line'),
        pg_temp.basket_for(v_people[2],  v_type.default_lead_time - interval '1 hour', 'Probe fresh line'),
        pg_temp.basket_for(v_people[3],  v_type.default_lead_time + interval '1 hour', 'Probe bought line'),
        pg_temp.basket_for(v_people[4],  v_type.default_lead_time + interval '1 hour', 'Probe removed line'),
        pg_temp.basket_for(v_people[5],  v_type.default_lead_time + interval '1 hour', 'Probe ordered line'),
        pg_temp.basket_for(v_people[6],  v_type.default_lead_time + interval '1 hour', 'Probe muted line'),
        pg_temp.basket_for(v_people[7],  v_type.default_lead_time + interval '1 hour', 'Probe no opt-in line'),
        pg_temp.basket_for(v_people[8],  v_type.default_lead_time + interval '1 hour', 'Probe unsubscribed line'),
        pg_temp.basket_for(v_people[9],  v_type.default_lead_time + interval '1 hour', 'Probe later line'),
        pg_temp.basket_for(v_people[10], v_type.default_lead_time + interval '1 hour', 'Probe wishlist line', false),
        pg_temp.basket_for(v_people[11], v_type.default_lead_time + interval '1 hour', 'Probe minor line'),
        pg_temp.basket_for(v_people[12], v_type.default_lead_time + interval '1 hour', 'Probe digest line')
    ];
    v_idle := v_baskets[1];

    UPDATE finance.basket_items SET purchased_at = pg_catalog.now() - v_type.default_lead_time - interval '1 hour'
     WHERE basket_id = v_baskets[3] AND removed_at IS NULL;
    UPDATE finance.basket_items SET removed_at = pg_catalog.now() - v_type.default_lead_time - interval '1 hour'
     WHERE basket_id = v_baskets[4] AND removed_at IS NULL;
    INSERT INTO finance.orders (reference, owner_type, owner_id, currency, subtotal_minor, platform_fee_bp,
                                total_minor, placed_at, idempotency_key)
    VALUES ('PJ-PROB-CK5X', 'user', v_people[5], 'GBP', 100, 500, 100, pg_catalog.now() - interval '30 minutes',
            'probe:basket_nudge:' || gen_random_uuid());
    INSERT INTO comms.notification_type_mutes (user_id, type_key, muted_until, channels)
    VALUES (v_people[6], 'basket.abandoned', NULL, NULL);
    SELECT lower(e.email) INTO v_address FROM org.user_emails e
     WHERE e.user_id = v_people[8] AND e.is_primary AND e.verified_at IS NOT NULL;
    INSERT INTO comms.channel_suppressions (channel, destination, user_id, reason, marketing_only)
    VALUES ('email', v_address, v_people[8], 'unsubscribe', true);
    UPDATE finance.basket_items SET saved_for_later = true WHERE basket_id = v_baskets[9] AND removed_at IS NULL;
    UPDATE org.users_public SET dob = (pg_catalog.now() - interval '15 years')::date WHERE user_id = v_people[11];
    UPDATE comms.notification_prefs SET digest_frequency = 'daily' WHERE user_id = v_people[12];

    -- #region 3. The switch
    UPDATE security.feature_flags SET enabled = false WHERE key = 'comms.basket_nudge';
    PERFORM pg_temp.ok(comms.fn_enqueue_basket_nudges(500) = 0 AND pg_temp.nudges(v_idle) = 0,
        'while comms.basket_nudge is off, the finder queues nothing');
    UPDATE security.feature_flags SET enabled = true WHERE key = 'comms.basket_nudge';
    PERFORM pg_temp.ok(FOUND, 'the comms.basket_nudge switch is seeded');
    -- #endregion

    PERFORM comms.fn_enqueue_basket_nudges(500);

    -- #region 4. Idle
    PERFORM pg_temp.ok(pg_temp.nudges(v_idle) = 1, 'an idle basket queues exactly one nudge');
    PERFORM pg_temp.ok(pg_temp.nudges(v_baskets[12]) = 1, 'a person on an email digest is reminded too');
    SELECT * INTO v_row FROM comms.notification_queue q
     WHERE q.type = 'basket.abandoned' AND q.entity_id = v_idle;
    PERFORM pg_temp.ok(v_row.user_id = v_people[1] AND v_row.status = 'scheduled'
                       AND v_row.scheduled_for <= pg_catalog.now(),
        'the nudge is its owner''s, due now');
    -- #endregion

    -- #region 5. Payload
    PERFORM pg_temp.ok(v_row.payload -> 'lines' @> '["Probe idle line"]'::jsonb
                       AND v_row.body LIKE 'Probe idle line is still in your basket.%',
        'the notice names the basket''s lines');
    PERFORM pg_temp.ok(v_row.payload::text !~* '(price|_minor|amount|total|currency)'
                       AND v_row.body !~ '(42|£|\$|GBP)',
        'the notice never states a price that may have changed');
    -- #endregion

    -- #region 6. Repeat, the idle spell and the group window
    PERFORM comms.fn_enqueue_basket_nudges(500);
    PERFORM pg_temp.ok(pg_temp.nudges(v_idle) = 1, 'a second run queues nothing');

    PERFORM comms.fn_process_queue(500);
    SELECT * INTO v_row FROM comms.notification_queue q
     WHERE q.type = 'basket.abandoned' AND q.entity_id = v_idle;
    PERFORM pg_temp.ok(v_row.status = 'sent' AND v_row.notification_id IS NOT NULL,
        'the worker turns the nudge into a notification');
    SELECT * INTO v_note FROM comms.notifications n WHERE n.id = v_row.notification_id;
    PERFORM pg_temp.ok(v_note.action_url = '/checkout' AND v_note.category = 'marketing'
                       AND v_note.channels = ARRAY['email']::comms.notification_channel[],
        'the notice is a Marketing email that opens /checkout, which reprices');

    -- Rows written in one transaction share now(), so the nudge's age is set by hand.
    UPDATE comms.notification_queue SET created_at = pg_catalog.now() - v_type.default_lead_time - interval '2 hours'
     WHERE id = v_row.id;
    PERFORM pg_temp.touch(v_idle, pg_catalog.now() - v_type.default_lead_time - interval '1 hour');
    PERFORM comms.fn_enqueue_basket_nudges(500);
    PERFORM pg_temp.ok(pg_temp.nudges(v_idle) = 1,
        'a basket touched after its nudge and idle again inside the group window is not nudged');

    UPDATE comms.notification_queue SET created_at = pg_catalog.now() - v_type.group_window - interval '1 hour'
     WHERE id = v_row.id;
    PERFORM pg_temp.touch(v_idle, pg_catalog.now() - v_type.group_window - interval '2 hours');
    PERFORM comms.fn_enqueue_basket_nudges(500);
    PERFORM pg_temp.ok(pg_temp.nudges(v_idle) = 1,
        'a basket left untouched since a nudge gets no second one, however old the first');

    PERFORM pg_temp.touch(v_idle, pg_catalog.now() - v_type.default_lead_time - interval '1 hour');
    PERFORM comms.fn_enqueue_basket_nudges(500);
    PERFORM pg_temp.ok(pg_temp.nudges(v_idle) = 2,
        'a basket touched after a nudge older than the group window, and idle again, is nudged again');
    -- #endregion

    -- #region 7. Nothing for the rest
    PERFORM pg_temp.ok(pg_temp.nudges(v_baskets[2]) = 0, 'a basket touched inside the lead time queues nothing');
    PERFORM pg_temp.ok(pg_temp.nudges(v_baskets[3]) = 0, 'a checked-out basket queues nothing');
    PERFORM pg_temp.ok(pg_temp.nudges(v_baskets[4]) = 0, 'an emptied basket queues nothing');
    PERFORM pg_temp.ok(pg_temp.nudges(v_baskets[5]) = 0, 'an owner who ordered since is not nudged');
    PERFORM pg_temp.ok(pg_temp.nudges(v_baskets[6]) = 0, 'a person who muted the notice is not nudged');
    PERFORM pg_temp.ok(pg_temp.nudges(v_baskets[7]) = 0, 'a person who never opted into Marketing is not nudged');
    PERFORM pg_temp.ok(pg_temp.nudges(v_baskets[8]) = 0, 'an address unsubscribed from Marketing is not nudged');
    PERFORM pg_temp.ok(pg_temp.nudges(v_baskets[9]) = 0, 'a basket of saved-for-later lines queues nothing');
    PERFORM pg_temp.ok(pg_temp.nudges(v_baskets[10]) = 0, 'a wishlist queues nothing');
    PERFORM pg_temp.ok(pg_temp.nudges(v_baskets[11]) = 0, 'a 13-17 account is never nudged');
    PERFORM pg_temp.ok(
        NOT EXISTS (SELECT 1 FROM comms.notification_queue q
                      JOIN finance.baskets b ON b.id = q.entity_id
                     WHERE q.type = 'basket.abandoned' AND b.owner_type <> 'user'),
        'a business, team or enterprise basket queues nothing');
    -- #endregion

    RAISE NOTICE 'basket_nudge: all checks passed';
END;
$probe$;

ROLLBACK;
