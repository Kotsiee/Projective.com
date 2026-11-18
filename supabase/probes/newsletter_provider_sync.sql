-- =============================================================================================
-- Probe: the newsletter's provider copy (PRD-E11, CD1 step 5; Decision #480 Q1 A).
--
--   1. The doors are the service role's alone: anon and authenticated may EXECUTE none of
--      fn_newsletter_provider_sync_enabled, newsletter_sync_batch, record_newsletter_sync or
--      record_newsletter_provider_event; the service role may EXECUTE each, and does (the batch
--      and both writers are called under SET ROLE service_role, as PostgREST calls them).
--   2. The batch: with newsletter.provider_sync off it answers no rows. On, it answers exactly the
--      rows the provider is behind on: a send-eligible row it has not received (upsert; `reconfirmed`
--      when confirmed since), and an ineligible row with a known contact (remove: unsubscribed, or
--      suppressed for marketing). Never an unconfirmed row, a synced one, or a suppressed row with no
--      contact. Each row carries id, email, topics, action, contact_ref, version, reconfirmed, and
--      nothing else of the subscription. The limit holds.
--   3. The record: an upsert stamps the version READ (a change made during the sync is still due),
--      never updated_at; an older version is `stale`; a refusal stops the retries until the row
--      changes; a removal clears the provider columns only for the contact it deleted.
--   4. The provider's events: an unsubscribe of the known contact unsubscribes (reason provider) and
--      a different contact's is `stale`; a complaint unsubscribes (reason complaint) unless it came
--      before the last confirmation; a topic opt-out counts only for a topic the provider held (the
--      sync's own echo changes nothing) and the last one is an unsubscribe; an opt-in of a topic the
--      provider never held re-syncs; a stray contact is recorded and re-synced; the known contact's
--      deletion unsubscribes, another deletion changes nothing; an unknown address is `not_found`.
--   5. Unknown actions, events and topics are refused (22023); a free-text reason is refused (23514).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Needs no seed rows: each probe
-- address is its own fixture. Run with `deno task test:probes newsletter_provider_sync`.
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
        'community.fn_newsletter_provider_sync_enabled()',
        'community.newsletter_sync_batch(integer)',
        'community.record_newsletter_sync(uuid,timestamptz,text,text,text[])',
        'community.record_newsletter_provider_event(text,text,timestamptz,text,text[],text[])'
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
    RAISE NOTICE 'PASS every provider door is the service role''s alone';
END $$;
-- #endregion

-- #region Fixtures
-- Only probe rows may reach the batch: every other row is made already synced, then restored by the
-- ROLLBACK.
UPDATE community.newsletter_subscriptions
SET provider_synced_at = updated_at, provider_contact_ref = NULL, provider_topics = NULL
WHERE email NOT LIKE 'probe-sync-%@example.com';

INSERT INTO comms.channel_suppressions (channel, destination, reason, marketing_only)
VALUES ('email', 'probe-sync-bounced@example.com', 'probe hard bounce', false),
       ('email', 'probe-sync-complained@example.com', 'probe complaint', true);

INSERT INTO community.newsletter_subscriptions
    (email, topics, confirmed_at, unsubscribed_at, unsubscribed_reason, provider_contact_ref,
     provider_topics, provider_synced_at, updated_at)
VALUES
    -- new: confirmed, never synced → upsert, reconfirmed
    ('probe-sync-new@example.com', '{general}', now() - interval '1 hour', NULL, NULL, NULL, NULL, NULL,
        now() - interval '1 hour'),
    -- unconfirmed: never reaches the provider
    ('probe-sync-unconfirmed@example.com', '{general}', NULL, NULL, NULL, NULL, NULL, NULL, now() - interval '50 minutes'),
    -- synced: the provider has this version
    ('probe-sync-synced@example.com', '{general}', now() - interval '3 hours', NULL, NULL, 'ct-synced', '{general}',
        now() - interval '2 hours', now() - interval '2 hours'),
    -- changed: synced before a change that was not a confirmation → upsert, not reconfirmed
    ('probe-sync-changed@example.com', '{general}', now() - interval '3 hours', NULL, NULL, 'ct-changed', '{general}',
        now() - interval '2 hours', now() - interval '40 minutes'),
    -- left: unsubscribed with a contact → remove
    ('probe-sync-left@example.com', '{general}', now() - interval '3 hours', now() - interval '30 minutes', 'link',
        'ct-left', '{general}', now() - interval '2 hours', now() - interval '30 minutes'),
    -- bounced: hard-suppressed with a contact → remove
    ('probe-sync-bounced@example.com', '{general}', now() - interval '3 hours', NULL, NULL, 'ct-bounced', '{general}',
        now() - interval '2 hours', now() - interval '2 hours'),
    -- complained: Marketing-suppressed, no contact → nothing to do
    ('probe-sync-complained@example.com', '{general}', now() - interval '3 hours', NULL, NULL, NULL, NULL, NULL,
        now() - interval '20 minutes');
-- #endregion

-- #region 2. The batch
DO $$
DECLARE
    v_out jsonb;
    v_rows jsonb;
    v_actions jsonb;
    v_keys text[];
BEGIN
    UPDATE security.feature_flags SET enabled = false WHERE key = 'newsletter.provider_sync';
    v_out := community.newsletter_sync_batch(50);
    IF (v_out->>'enabled')::boolean OR jsonb_array_length(v_out->'rows') <> 0 THEN
        RAISE EXCEPTION 'FAIL the batch answers rows while the flag is off: %', v_out;
    END IF;
    RAISE NOTICE 'PASS the batch is empty while newsletter.provider_sync is off';

    UPDATE security.feature_flags SET enabled = true WHERE key = 'newsletter.provider_sync';
    v_out := community.newsletter_sync_batch(50);
    v_rows := v_out->'rows';
    SELECT jsonb_object_agg(r->>'email', r->>'action') INTO v_actions FROM jsonb_array_elements(v_rows) r;
    IF NOT (v_out->>'enabled')::boolean
        OR v_actions IS DISTINCT FROM jsonb_build_object(
            'probe-sync-new@example.com', 'upsert',
            'probe-sync-changed@example.com', 'upsert',
            'probe-sync-left@example.com', 'remove',
            'probe-sync-bounced@example.com', 'remove'
        ) THEN
        RAISE EXCEPTION 'FAIL the batch chose the wrong rows: %', v_actions;
    END IF;
    IF NOT (v_out ? 'segment_id' AND v_out ? 'topic_ids') THEN
        RAISE EXCEPTION 'FAIL the batch does not carry the provider config: %', v_out;
    END IF;
    RAISE NOTICE 'PASS the batch answers what the provider is behind on, and only that';

    SELECT array_agg(k ORDER BY k) INTO v_keys
    FROM (SELECT DISTINCT jsonb_object_keys(r) AS k FROM jsonb_array_elements(v_rows) r) s;
    IF v_keys <> ARRAY['action', 'contact_ref', 'email', 'id', 'reconfirmed', 'topics', 'version'] THEN
        RAISE EXCEPTION 'FAIL a batch row carries more than it needs: %', v_keys;
    END IF;
    IF NOT (SELECT (r->>'reconfirmed')::boolean FROM jsonb_array_elements(v_rows) r WHERE r->>'email' = 'probe-sync-new@example.com')
        OR (SELECT (r->>'reconfirmed')::boolean FROM jsonb_array_elements(v_rows) r WHERE r->>'email' = 'probe-sync-changed@example.com') THEN
        RAISE EXCEPTION 'FAIL reconfirmed is wrong: %', v_rows;
    END IF;
    IF (SELECT r->>'email' FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS a (r, n) ORDER BY n LIMIT 1)
        <> 'probe-sync-bounced@example.com' THEN
        RAISE EXCEPTION 'FAIL the oldest change is not first: %', v_rows;
    END IF;
    IF jsonb_array_length(community.newsletter_sync_batch(2)->'rows') <> 2
        OR jsonb_array_length(community.newsletter_sync_batch(0)->'rows') <> 1 THEN
        RAISE EXCEPTION 'FAIL the batch limit does not hold';
    END IF;
    RAISE NOTICE 'PASS each row carries the address, its topics and the sync''s own fields only; the limit holds';
END $$;
-- #endregion

-- #region 3. The record
DO $$
DECLARE
    v_row community.newsletter_subscriptions%ROWTYPE;
    v_version timestamptz;
    v_updated timestamptz;
    v_out text;
BEGIN
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE email = 'probe-sync-new@example.com';
    v_version := v_row.updated_at;
    v_updated := v_row.updated_at;
    v_out := community.record_newsletter_sync(v_row.id, v_version, 'upserted', 'ct-new', ARRAY['general']);
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE id = v_row.id;
    IF v_out <> 'recorded' OR v_row.provider_contact_ref <> 'ct-new' OR v_row.provider_topics <> ARRAY['general']
        OR v_row.provider_synced_at <> v_version OR v_row.updated_at <> v_updated THEN
        RAISE EXCEPTION 'FAIL an upsert record: % (ref %, topics %, at %)', v_out, v_row.provider_contact_ref,
            v_row.provider_topics, v_row.provider_synced_at;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(community.newsletter_sync_batch(50)->'rows') r
               WHERE r->>'email' = 'probe-sync-new@example.com') THEN
        RAISE EXCEPTION 'FAIL a synced row is still in the batch';
    END IF;
    IF community.record_newsletter_sync(v_row.id, v_version - interval '1 minute', 'upserted', 'ct-old', ARRAY['general']) <> 'stale' THEN
        RAISE EXCEPTION 'FAIL an older version overwrote a newer record';
    END IF;
    RAISE NOTICE 'PASS an upsert stamps the version it read and leaves updated_at alone; an older one is stale';

    -- A change committed while a sync is in flight: the version read is older than the row.
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE email = 'probe-sync-changed@example.com';
    v_version := v_row.updated_at;
    UPDATE community.newsletter_subscriptions SET updated_at = now() WHERE id = v_row.id;
    PERFORM community.record_newsletter_sync(v_row.id, v_version, 'upserted', 'ct-changed', ARRAY['general']);
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(community.newsletter_sync_batch(50)->'rows') r
                   WHERE r->>'email' = 'probe-sync-changed@example.com' AND r->>'action' = 'upsert') THEN
        RAISE EXCEPTION 'FAIL a change made during the sync was lost';
    END IF;
    -- A permanent refusal of the newer version stops the retries until the row changes again.
    -- (Each call is its own statement: a query sees the snapshot from before its own volatile calls.)
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE id = v_row.id;
    v_out := community.record_newsletter_sync(v_row.id, v_row.updated_at, 'refused');
    IF v_out <> 'recorded'
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(community.newsletter_sync_batch(50)->'rows') r
                   WHERE r->>'email' = 'probe-sync-changed@example.com') THEN
        RAISE EXCEPTION 'FAIL a refused address is retried with nothing changed';
    END IF;
    RAISE NOTICE 'PASS a change made during the sync goes out next; a refusal waits for the next change';

    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE email = 'probe-sync-left@example.com';
    IF community.record_newsletter_sync(v_row.id, v_row.updated_at, 'removed', 'ct-other') <> 'stale' THEN
        RAISE EXCEPTION 'FAIL a removal cleared a contact it did not delete';
    END IF;
    v_out := community.record_newsletter_sync(v_row.id, v_row.updated_at, 'removed', 'ct-left');
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE id = v_row.id;
    IF v_out <> 'recorded' OR v_row.provider_contact_ref IS NOT NULL OR v_row.provider_topics IS NOT NULL
        OR v_row.provider_synced_at IS NOT NULL OR v_row.unsubscribed_at IS NULL THEN
        RAISE EXCEPTION 'FAIL a removal record: %', v_out;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(community.newsletter_sync_batch(50)->'rows') r
               WHERE r->>'email' = 'probe-sync-left@example.com') THEN
        RAISE EXCEPTION 'FAIL a removed row is still in the batch';
    END IF;
    IF community.record_newsletter_sync(gen_random_uuid(), now(), 'refused') <> 'not_found' THEN
        RAISE EXCEPTION 'FAIL an unknown row is not not_found';
    END IF;
    RAISE NOTICE 'PASS a removal clears only the contact it deleted; an unknown row is not_found';
END $$;
-- #endregion

-- #region 4. The provider's events
DO $$
DECLARE
    v_row community.newsletter_subscriptions%ROWTYPE;
    v_out jsonb;
BEGIN
    -- Unsubscribed at the provider: the known contact's counts, another contact's is stale.
    IF community.record_newsletter_provider_event('probe-sync-new@example.com', 'unsubscribed', now(), 'ct-elsewhere')->>'outcome' <> 'stale' THEN
        RAISE EXCEPTION 'FAIL another contact''s unsubscribe was applied';
    END IF;
    v_out := community.record_newsletter_provider_event('Probe-Sync-New@example.com', 'unsubscribed', now(), 'ct-new');
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE email = 'probe-sync-new@example.com';
    IF v_out->>'outcome' <> 'unsubscribed' OR v_row.unsubscribed_reason <> 'provider' OR v_row.unsubscribed_at IS NULL THEN
        RAISE EXCEPTION 'FAIL a provider unsubscribe: % (reason %)', v_out, v_row.unsubscribed_reason;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(community.newsletter_sync_batch(50)->'rows') r
                   WHERE r->>'email' = 'probe-sync-new@example.com' AND r->>'action' = 'remove') THEN
        RAISE EXCEPTION 'FAIL an address that left at the provider keeps its contact';
    END IF;
    IF community.record_newsletter_provider_event('probe-sync-new@example.com', 'unsubscribed', now(), 'ct-new')->>'outcome'
        <> 'already_unsubscribed' THEN
        RAISE EXCEPTION 'FAIL a second provider unsubscribe is not idempotent';
    END IF;
    RAISE NOTICE 'PASS the known contact''s unsubscribe unsubscribes (provider); another contact''s is stale';

    -- A complaint: before the last confirmation it is stale; after, it unsubscribes and clears a request.
    INSERT INTO community.newsletter_subscriptions (email, topics, confirmed_at, resubscribe_topics, resubscribe_requested_at)
    VALUES ('probe-sync-spam@example.com', '{general}', now() - interval '1 hour', '{changelog}', now() - interval '5 minutes');
    IF community.record_newsletter_provider_event('probe-sync-spam@example.com', 'complaint', now() - interval '2 hours')->>'outcome' <> 'stale' THEN
        RAISE EXCEPTION 'FAIL a complaint older than the confirmation was applied';
    END IF;
    v_out := community.record_newsletter_provider_event('probe-sync-spam@example.com', 'complaint', now());
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE email = 'probe-sync-spam@example.com';
    IF v_out->>'outcome' <> 'unsubscribed' OR v_row.unsubscribed_reason <> 'complaint'
        OR v_row.resubscribe_topics IS NOT NULL OR v_row.resubscribe_requested_at IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL a complaint: % (reason %, pending %)', v_out, v_row.unsubscribed_reason, v_row.resubscribe_topics;
    END IF;
    RAISE NOTICE 'PASS a complaint unsubscribes (complaint) and clears a request; an older one is stale';

    -- Topics: confirmed for both, but the provider only ever opted in to `general`.
    INSERT INTO community.newsletter_subscriptions (email, topics, confirmed_at, provider_contact_ref, provider_topics, provider_synced_at, updated_at)
    VALUES ('probe-sync-topics@example.com', '{changelog,general}', now() - interval '1 hour', 'ct-topics', '{general}',
        now() - interval '2 hours', now() - interval '1 hour');
    v_out := community.record_newsletter_provider_event('probe-sync-topics@example.com', 'topics', now(), NULL, ARRAY['changelog'], ARRAY['general']);
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE email = 'probe-sync-topics@example.com';
    IF v_out->>'outcome' <> 'unchanged' OR v_row.topics <> ARRAY['changelog', 'general'] THEN
        RAISE EXCEPTION 'FAIL the sync''s own echo removed a topic: % (topics %)', v_out, v_row.topics;
    END IF;
    v_out := community.record_newsletter_provider_event('probe-sync-topics@example.com', 'topics', now(), NULL, ARRAY['general'], ARRAY['changelog']);
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE email = 'probe-sync-topics@example.com';
    IF v_out->>'outcome' <> 'topics_removed' OR v_row.topics <> ARRAY['changelog']
        OR v_row.provider_topics <> '{}'::text[] OR v_row.unsubscribed_at IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL a provider topic opt-out: % (topics %, provider %)', v_out, v_row.topics, v_row.provider_topics;
    END IF;
    -- The provider now says `changelog` is opted in, which it was never set to: re-synced, not added.
    v_out := community.record_newsletter_provider_event('probe-sync-topics@example.com', 'topics', now(), NULL, ARRAY['general'], ARRAY['changelog']);
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE email = 'probe-sync-topics@example.com';
    IF v_out->>'outcome' <> 'resync' OR v_row.provider_synced_at IS NOT NULL OR v_row.topics <> ARRAY['changelog'] THEN
        RAISE EXCEPTION 'FAIL a provider opt-in: % (topics %)', v_out, v_row.topics;
    END IF;
    -- The last topic the provider held, opted out: the address leaves.
    UPDATE community.newsletter_subscriptions SET provider_topics = '{changelog}' WHERE id = v_row.id;
    v_out := community.record_newsletter_provider_event('probe-sync-topics@example.com', 'topics', now(), NULL, ARRAY['changelog', 'general'], NULL);
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE id = v_row.id;
    IF v_out->>'outcome' <> 'unsubscribed' OR v_row.unsubscribed_reason <> 'provider' OR v_row.topics <> ARRAY['changelog'] THEN
        RAISE EXCEPTION 'FAIL the last topic opted out: % (reason %, topics %)', v_out, v_row.unsubscribed_reason, v_row.topics;
    END IF;
    RAISE NOTICE 'PASS a topic opt-out counts only for a topic the provider held; an opt-in re-syncs; the last one unsubscribes';

    -- A stray contact for an unconfirmed address: recorded, so the sync deletes it.
    v_out := community.record_newsletter_provider_event('probe-sync-unconfirmed@example.com', 'present', now(), 'ct-stray');
    IF v_out->>'outcome' <> 'resync' OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(community.newsletter_sync_batch(50)->'rows') r
        WHERE r->>'email' = 'probe-sync-unconfirmed@example.com' AND r->>'action' = 'remove' AND r->>'contact_ref' = 'ct-stray'
    ) THEN
        RAISE EXCEPTION 'FAIL a stray contact is not removed: %', v_out;
    END IF;
    IF community.record_newsletter_provider_event('probe-sync-unconfirmed@example.com', 'present', now(), 'ct-stray')->>'outcome' <> 'unchanged' THEN
        RAISE EXCEPTION 'FAIL the known contact''s presence is not unchanged';
    END IF;
    RAISE NOTICE 'PASS a stray contact is recorded for removal';

    -- Deletion at the provider: another contact's changes nothing; the known one's unsubscribes.
    IF community.record_newsletter_provider_event('probe-sync-synced@example.com', 'deleted', now(), 'ct-older')->>'outcome' <> 'unchanged' THEN
        RAISE EXCEPTION 'FAIL another contact''s deletion changed the row';
    END IF;
    v_out := community.record_newsletter_provider_event('probe-sync-synced@example.com', 'deleted', now(), 'ct-synced');
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE email = 'probe-sync-synced@example.com';
    IF v_out->>'outcome' <> 'unsubscribed' OR v_row.unsubscribed_reason <> 'provider'
        OR v_row.provider_contact_ref IS NOT NULL OR v_row.provider_topics IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL the known contact''s deletion: % (reason %, ref %)', v_out, v_row.unsubscribed_reason, v_row.provider_contact_ref;
    END IF;
    IF community.record_newsletter_provider_event('probe-sync-nobody@example.com', 'complaint', now())->>'outcome' <> 'not_found' THEN
        RAISE EXCEPTION 'FAIL an unknown address is not not_found';
    END IF;
    RAISE NOTICE 'PASS the known contact''s deletion unsubscribes; another changes nothing; an unknown address is not_found';
END $$;
-- #endregion

-- #region 5. Refusals
DO $$
DECLARE
    v_id uuid;
BEGIN
    SELECT id INTO v_id FROM community.newsletter_subscriptions WHERE email = 'probe-sync-bounced@example.com';
    BEGIN
        PERFORM community.record_newsletter_sync(v_id, now(), 'deleted', 'ct-bounced');
        RAISE EXCEPTION 'FAIL an unknown sync action was accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
    BEGIN
        PERFORM community.record_newsletter_sync(v_id, now(), 'upserted', NULL, ARRAY['general']);
        RAISE EXCEPTION 'FAIL an upsert without its contact id was accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
    BEGIN
        PERFORM community.record_newsletter_provider_event('probe-sync-bounced@example.com', 'resubscribed', now());
        RAISE EXCEPTION 'FAIL an unknown provider event was accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
    BEGIN
        PERFORM community.record_newsletter_provider_event('probe-sync-bounced@example.com', 'topics', now(), NULL, ARRAY['weekly']);
        RAISE EXCEPTION 'FAIL an unknown topic was accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
    BEGIN
        UPDATE community.newsletter_subscriptions SET unsubscribed_at = now(), unsubscribed_reason = 'because' WHERE id = v_id;
        RAISE EXCEPTION 'FAIL a free-text unsubscribe reason was stored';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    RAISE NOTICE 'PASS unknown actions, events and topics are refused (22023); a free-text reason is refused (23514)';
END $$;
-- #endregion

-- #region 6. As the service role (how PostgREST calls them)
SET LOCAL ROLE service_role;
DO $$
DECLARE
    v_out jsonb;
BEGIN
    v_out := community.newsletter_sync_batch(5);
    IF NOT (v_out->>'enabled')::boolean OR jsonb_typeof(v_out->'rows') <> 'array' THEN
        RAISE EXCEPTION 'FAIL the service role cannot read the batch: %', v_out;
    END IF;
    PERFORM community.record_newsletter_sync(gen_random_uuid(), now(), 'refused');
    PERFORM community.record_newsletter_provider_event('probe-sync-nobody@example.com', 'complaint', now());
    RAISE NOTICE 'PASS the service role runs the batch and both writers';
END $$;
RESET ROLE;
-- #endregion

ROLLBACK;
