-- =============================================================================================
-- Probe: the newsletter's double opt-in (PRD-E11, CD1; Decision #274 flag (c)).
--
--   1. The doors are the service role's alone: anon and authenticated may EXECUTE none of
--      subscribe_newsletter, read_newsletter_link, confirm_newsletter, unsubscribe_newsletter,
--      fn_newsletter_pending_topics or fn_newsletter_suppressed; the service role may EXECUTE
--      every one.
--   2. A new subscribe is unconfirmed and its mail is due (token + topics in the answer, and
--      confirmation_sent_at stamped); a second inside 10 minutes is not due; one after 10 minutes
--      is due again. A hard-suppressed address (every category) and a Marketing-only one (a
--      complaint) are stored, but no mail is due.
--   3. The link read writes nothing and reports the standing; an unknown token reads NULL.
--   4. Confirm sets confirmed_at; a second confirm is the same success with no write; a confirm 7
--      days after the mail is `expired` and writes nothing; an unknown token is `not_found`.
--   5. Per-topic consent (flag (c)): a confirmed address asking for a new topic records it as
--      pending, still sendable for what it held, mail due; its confirm adds the topic.
--   6. Unsubscribe sets unsubscribed_at and the reason and clears a pending request; a second is
--      idempotent (the first time and reason stay). A public re-subscribe afterwards is pending only
--      and the row stays unsendable; its confirm applies it and ends the opt-out. An unknown reason
--      is refused (22023).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Needs no seed rows: each probe
-- address is its own fixture. Run with `deno task test:probes newsletter_double_opt_in`.
-- =============================================================================================

BEGIN;

-- #region 1. Grants (as postgres)
DO $$
DECLARE
    v_fail text[] := '{}';
    v_role text;
    v_fn text;
BEGIN
    FOREACH v_fn IN ARRAY ARRAY[
        'community.subscribe_newsletter(text,text,text)',
        'community.read_newsletter_link(uuid)',
        'community.confirm_newsletter(uuid)',
        'community.unsubscribe_newsletter(uuid,text)',
        'community.fn_newsletter_pending_topics(community.newsletter_subscriptions)',
        'community.fn_newsletter_suppressed(text)'
    ] LOOP
        FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN
                v_fail := v_fail || format('%s may EXECUTE %s', v_role, v_fn);
            END IF;
        END LOOP;
        IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
            v_fail := v_fail || format('service_role may not EXECUTE %s', v_fn);
        END IF;
    END LOOP;
    IF cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'FAIL %', array_to_string(v_fail, '; ');
    END IF;
    RAISE NOTICE 'PASS every newsletter door is the service role''s alone';
END $$;

-- Two suppressed addresses: a hard bounce (every category) and a complaint (Marketing only).
INSERT INTO comms.channel_suppressions (channel, destination, reason, marketing_only)
VALUES ('email', 'probe-bounced@example.com', 'probe hard bounce', false),
       ('email', 'probe-complained@example.com', 'probe complaint', true);
-- #endregion

-- #region 2–6. The doors (as the service role)
SET LOCAL ROLE service_role;
DO $$
DECLARE
    v_out jsonb;
    v_link jsonb;
    v_row community.newsletter_subscriptions%ROWTYPE;
    v_before community.newsletter_subscriptions%ROWTYPE;
    v_token uuid;
BEGIN
    -- 2. A new address: unconfirmed, mail due, the token and the topic in the answer.
    v_out := community.subscribe_newsletter('Probe.Optin@Example.com', 'footer', 'general');
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE email = 'probe.optin@example.com';
    v_token := v_row.token;
    IF v_out->>'outcome' <> 'created' OR NOT (v_out->>'confirmation_due')::boolean
        OR (v_out->>'token')::uuid IS DISTINCT FROM v_token
        OR v_out->'confirm_topics' <> '["general"]'::jsonb
        OR v_row.confirmed_at IS NOT NULL OR v_row.confirmation_sent_at IS NULL THEN
        RAISE EXCEPTION 'FAIL new subscribe: % (confirmed %, sent %)', v_out, v_row.confirmed_at, v_row.confirmation_sent_at;
    END IF;
    RAISE NOTICE 'PASS a new subscribe is unconfirmed and its mail is due';

    v_out := community.subscribe_newsletter('probe.optin@example.com', 'landing', 'general');
    IF (v_out->>'confirmation_due')::boolean OR v_out->>'token' IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL a second subscribe inside 10 minutes is due: %', v_out;
    END IF;
    RAISE NOTICE 'PASS a second subscribe inside 10 minutes mails nothing: %', v_out->>'outcome';

    UPDATE community.newsletter_subscriptions SET confirmation_sent_at = now() - interval '11 minutes'
    WHERE id = v_row.id;
    v_out := community.subscribe_newsletter('probe.optin@example.com', 'footer', 'general');
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE id = v_row.id;
    IF NOT (v_out->>'confirmation_due')::boolean OR v_row.confirmation_sent_at <> now() THEN
        RAISE EXCEPTION 'FAIL an unconfirmed address 11 minutes on is not mailed again: %', v_out;
    END IF;
    RAISE NOTICE 'PASS an unconfirmed address is mailed again after 10 minutes';

    v_out := community.subscribe_newsletter('probe-bounced@example.com', 'footer', 'general');
    SELECT * INTO v_before FROM community.newsletter_subscriptions WHERE email = 'probe-bounced@example.com';
    IF v_out->>'outcome' <> 'created' OR (v_out->>'confirmation_due')::boolean
        OR v_out->>'token' IS NOT NULL OR v_before.confirmation_sent_at IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL a hard-suppressed address is mailed: %', v_out;
    END IF;
    v_out := community.subscribe_newsletter('probe-complained@example.com', 'footer', 'general');
    IF v_out->>'outcome' <> 'created' OR (v_out->>'confirmation_due')::boolean THEN
        RAISE EXCEPTION 'FAIL a Marketing-suppressed address is mailed: %', v_out;
    END IF;
    RAISE NOTICE 'PASS suppressed addresses are stored and never mailed';

    -- 3. The link read writes nothing.
    v_link := community.read_newsletter_link(v_token);
    SELECT * INTO v_before FROM community.newsletter_subscriptions WHERE id = v_row.id;
    IF v_link IS NULL OR (v_link->>'subscribed')::boolean OR (v_link->>'unsubscribed')::boolean
        OR (v_link->>'expired')::boolean OR v_link->'pending_topics' <> '["general"]'::jsonb
        OR v_before.updated_at <> v_row.updated_at OR v_before.confirmed_at IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL link read: %', v_link;
    END IF;
    IF community.read_newsletter_link(gen_random_uuid()) IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL an unknown token reads a row';
    END IF;
    RAISE NOTICE 'PASS the link read reports the standing and writes nothing: %', v_link;

    -- 4. Confirm; again; an expired link; an unknown token.
    v_out := community.confirm_newsletter(v_token);
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE id = v_row.id;
    IF v_out->>'outcome' <> 'confirmed' OR v_out->'topics' <> '["general"]'::jsonb
        OR v_row.confirmed_at IS NULL OR v_row.unsubscribed_at IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL confirm: % (confirmed %)', v_out, v_row.confirmed_at;
    END IF;
    RAISE NOTICE 'PASS confirm sets confirmed_at: %', v_out;

    UPDATE community.newsletter_subscriptions SET updated_at = '2000-01-01T00:00:00Z' WHERE id = v_row.id;
    v_out := community.confirm_newsletter(v_token);
    SELECT * INTO v_before FROM community.newsletter_subscriptions WHERE id = v_row.id;
    IF v_out->>'outcome' <> 'already_confirmed' OR v_before.updated_at <> '2000-01-01T00:00:00Z'::timestamptz THEN
        RAISE EXCEPTION 'FAIL a second confirm: % (updated_at %)', v_out, v_before.updated_at;
    END IF;
    IF (community.read_newsletter_link(v_token)->>'subscribed')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL a confirmed address does not read as subscribed';
    END IF;
    RAISE NOTICE 'PASS a second confirm is the same success and writes nothing';

    v_out := community.subscribe_newsletter('probe.stale@example.com', 'footer', 'changelog');
    SELECT * INTO v_before FROM community.newsletter_subscriptions WHERE email = 'probe.stale@example.com';
    UPDATE community.newsletter_subscriptions
    SET confirmation_sent_at = now() - interval '7 days 1 minute', updated_at = '2000-01-01T00:00:00Z'
    WHERE id = v_before.id;
    IF (community.read_newsletter_link(v_before.token)->>'expired')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL a link 7 days old does not read as expired';
    END IF;
    v_out := community.confirm_newsletter(v_before.token);
    SELECT * INTO v_before FROM community.newsletter_subscriptions WHERE id = v_before.id;
    IF v_out->>'outcome' <> 'expired' OR v_before.confirmed_at IS NOT NULL
        OR v_before.updated_at <> '2000-01-01T00:00:00Z'::timestamptz THEN
        RAISE EXCEPTION 'FAIL a confirm 7 days after the mail: % (confirmed %)', v_out, v_before.confirmed_at;
    END IF;
    RAISE NOTICE 'PASS a confirm 7 days after the mail is expired and writes nothing';

    IF community.confirm_newsletter(gen_random_uuid())->>'outcome' <> 'not_found' THEN
        RAISE EXCEPTION 'FAIL an unknown token confirms something';
    END IF;
    RAISE NOTICE 'PASS an unknown token is not_found';

    -- 5. A confirmed address asks for a new topic: pending, still sendable, mail due; its confirm adds it.
    UPDATE community.newsletter_subscriptions SET confirmation_sent_at = now() - interval '1 hour'
    WHERE id = v_row.id;
    v_out := community.subscribe_newsletter('probe.optin@example.com', 'changelog', 'changelog');
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE id = v_row.id;
    IF v_out->>'outcome' <> 'topic_pending' OR NOT (v_out->>'confirmation_due')::boolean
        OR v_out->'confirm_topics' <> '["changelog"]'::jsonb
        OR v_row.topics <> ARRAY['general'] OR v_row.resubscribe_topics IS DISTINCT FROM ARRAY['changelog']
        OR v_row.confirmed_at IS NULL OR v_row.unsubscribed_at IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL a new topic on a confirmed address: % topics=% pending=%', v_out, v_row.topics, v_row.resubscribe_topics;
    END IF;
    RAISE NOTICE 'PASS a new topic on a confirmed address waits for its own confirmation';

    v_out := community.confirm_newsletter(v_token);
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE id = v_row.id;
    IF v_out->>'outcome' <> 'confirmed' OR v_row.topics <> ARRAY['changelog', 'general']
        OR v_row.resubscribe_topics IS NOT NULL OR v_row.resubscribe_requested_at IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL the pending topic''s confirm: % topics=%', v_out, v_row.topics;
    END IF;
    RAISE NOTICE 'PASS its confirm adds the topic: %', v_row.topics;

    -- 6. Unsubscribe (with a request pending, which it clears); again; a public re-subscribe; its
    -- confirm. Both topics are held now, so the pending request is planted directly.
    UPDATE community.newsletter_subscriptions
    SET resubscribe_topics = ARRAY['general'], resubscribe_requested_at = now() WHERE id = v_row.id;
    v_out := community.unsubscribe_newsletter(v_token, 'one_click');
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE id = v_row.id;
    IF v_out->>'outcome' <> 'unsubscribed' OR v_row.unsubscribed_at IS NULL
        OR v_row.unsubscribed_reason <> 'one_click' OR v_row.resubscribe_topics IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL unsubscribe: % (at %, reason %)', v_out, v_row.unsubscribed_at, v_row.unsubscribed_reason;
    END IF;
    RAISE NOTICE 'PASS unsubscribe sets unsubscribed_at and the reason';

    UPDATE community.newsletter_subscriptions SET unsubscribed_at = '2026-01-02T03:04:05Z' WHERE id = v_row.id;
    v_out := community.unsubscribe_newsletter(v_token, 'link');
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE id = v_row.id;
    IF v_out->>'outcome' <> 'already_unsubscribed'
        OR v_row.unsubscribed_at <> '2026-01-02T03:04:05Z'::timestamptz OR v_row.unsubscribed_reason <> 'one_click' THEN
        RAISE EXCEPTION 'FAIL a second unsubscribe: % (at %, reason %)', v_out, v_row.unsubscribed_at, v_row.unsubscribed_reason;
    END IF;
    RAISE NOTICE 'PASS a second unsubscribe is idempotent: the first opt-out stays';

    UPDATE community.newsletter_subscriptions SET confirmation_sent_at = now() - interval '1 hour' WHERE id = v_row.id;
    v_out := community.subscribe_newsletter('probe.optin@example.com', 'footer', 'general');
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE id = v_row.id;
    IF v_out->>'outcome' <> 'resubscribed' OR NOT (v_out->>'confirmation_due')::boolean
        OR v_row.unsubscribed_at IS NULL OR v_row.resubscribe_topics IS DISTINCT FROM ARRAY['general'] THEN
        RAISE EXCEPTION 'FAIL a public re-subscribe after an unsubscribe: % pending=%', v_out, v_row.resubscribe_topics;
    END IF;
    IF (community.read_newsletter_link(v_token)->>'subscribed')::boolean THEN
        RAISE EXCEPTION 'FAIL a pending re-subscribe made the row sendable';
    END IF;
    RAISE NOTICE 'PASS a public re-subscribe is pending only; the address stays unsubscribed';

    v_out := community.unsubscribe_newsletter(v_token, 'link');
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE id = v_row.id;
    IF v_out->>'outcome' <> 'already_unsubscribed' OR v_row.resubscribe_topics IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL an unsubscribe does not clear the pending request: %', v_out;
    END IF;
    v_out := community.subscribe_newsletter('probe.optin@example.com', 'footer', 'general');
    IF (v_out->>'confirmation_due')::boolean THEN
        RAISE EXCEPTION 'FAIL a re-request inside 10 minutes of the last mail is mailed: %', v_out;
    END IF;
    RAISE NOTICE 'PASS an unsubscribe clears a pending request; the 10-minute spacing holds';

    v_out := community.confirm_newsletter(v_token);
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE id = v_row.id;
    IF v_out->>'outcome' <> 'confirmed' OR v_row.unsubscribed_at IS NOT NULL
        OR v_row.unsubscribed_reason IS NOT NULL OR v_row.topics <> ARRAY['general']
        OR v_row.resubscribe_topics IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL the re-subscribe''s confirm: % (unsub %, topics %)', v_out, v_row.unsubscribed_at, v_row.topics;
    END IF;
    RAISE NOTICE 'PASS its confirm applies the request and ends the opt-out: %', v_row.topics;

    BEGIN
        PERFORM community.unsubscribe_newsletter(v_token, 'because');
        RAISE EXCEPTION 'FAIL an unknown unsubscribe reason was accepted';
    EXCEPTION WHEN invalid_parameter_value THEN
        RAISE NOTICE 'PASS an unknown reason is refused [%]', SQLSTATE;
    END;
    IF community.unsubscribe_newsletter(gen_random_uuid(), 'link')->>'outcome' <> 'not_found' THEN
        RAISE EXCEPTION 'FAIL an unknown token unsubscribes something';
    END IF;
    RAISE NOTICE 'PASS an unknown token is not_found';
END $$;
RESET ROLE;
-- #endregion

-- #region The pending-request CHECK, widened for per-topic consent (as postgres)
DO $$
BEGIN
    INSERT INTO community.newsletter_subscriptions (email, confirmed_at, resubscribe_topics, resubscribe_requested_at)
    VALUES ('probe-pending-ok@example.com', now(), ARRAY['changelog'], now());
    RAISE NOTICE 'PASS a confirmed address may hold a pending topic';
    BEGIN
        INSERT INTO community.newsletter_subscriptions (email, resubscribe_topics, resubscribe_requested_at)
        VALUES ('probe-pending-bad@example.com', ARRAY['changelog'], now());
        RAISE EXCEPTION 'FAIL an unconfirmed active address held a pending topic';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS an unconfirmed active address may not [%]', SQLSTATE;
    END;
END $$;
-- #endregion

ROLLBACK;
