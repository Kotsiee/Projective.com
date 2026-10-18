-- =============================================================================================
-- Probe: /contact intake (Decision #276) — ops.contact_requests, ops.contact_request_attachments,
-- ops.submit_contact_request, ops.set_contact_request_status, ops.fn_guard_contact_request, the
-- `contact` bucket, its storage policy, the files.fn_can_read operator arm and contact.received.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/contact_requests.sql
--
-- Every expected refusal is asserted: a call that SUCCEEDS where it must be refused raises `FAIL …`
-- and aborts the run (non-zero exit under ON_ERROR_STOP). A clean run prints only PASS notices.
-- Fixtures come from the seed (two non-operator people); the operator is made inside the transaction.
-- =============================================================================================

BEGIN;
-- @prelude

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_a uuid;
    v_b uuid;
    v_op uuid;
BEGIN
    SELECT u.user_id INTO v_a FROM org.users_public u
     WHERE NOT EXISTS (SELECT 1 FROM ops.admin_users au WHERE au.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_b FROM org.users_public u
     WHERE u.user_id <> v_a AND NOT EXISTS (SELECT 1 FROM ops.admin_users au WHERE au.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_op FROM org.users_public u
     WHERE u.user_id NOT IN (v_a, v_b) ORDER BY u.user_id LIMIT 1;
    IF v_a IS NULL OR v_b IS NULL OR v_op IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need three seeded people (deno task db:reset)';
    END IF;
    INSERT INTO ops.admin_users (user_id) VALUES (v_op) ON CONFLICT (user_id) DO NOTHING;

    -- Two scanned contact attachments of A's, and one of B's, as the pipeline would leave them.
    INSERT INTO files.items (id, owner_user_id, bucket_id, storage_path, display_name, original_name,
        mime_type, size_bytes, status, purpose, owner_type)
    VALUES
        ('00000000-0000-4000-8000-0000000000a1', v_a, 'contact', v_a || '/a1/screen.png', 'screen.png', 'screen.png',
         'image/png', 2048, 'uploaded', 'contact', 'user'),
        ('00000000-0000-4000-8000-0000000000a2', v_a, 'contact', v_a || '/a2/log.txt', 'log.txt', 'log.txt',
         'text/plain', 512, 'uploaded', 'contact', 'user'),
        ('00000000-0000-4000-8000-0000000000a3', v_a, 'quarantine', v_a || '/a3/pending.pdf', 'pending.pdf', 'pending.pdf',
         'application/pdf', 512, 'scanning', 'library', 'user'),
        ('00000000-0000-4000-8000-0000000000b1', v_b, 'contact', v_b || '/b1/other.png', 'other.png', 'other.png',
         'image/png', 2048, 'uploaded', 'contact', 'user');

    PERFORM set_config('probe.a', v_a::text, true);
    PERFORM set_config('probe.b', v_b::text, true);
    PERFORM set_config('probe.op', v_op::text, true);
    RAISE NOTICE 'fixture a=% b=% operator=%', v_a, v_b, v_op;
END $$;
-- #endregion

-- #region 1. Schema facts — bucket, catalog type, RLS, policies, grants
DO $$
DECLARE
    v_bucket record;
BEGIN
    SELECT public, file_size_limit, allowed_mime_types INTO v_bucket FROM storage.buckets WHERE id = 'contact';
    IF NOT FOUND OR v_bucket.public OR v_bucket.file_size_limit <> 10485760
       OR v_bucket.allowed_mime_types <> ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain'] THEN
        RAISE EXCEPTION 'FAIL contact bucket missing or not private / 10 MiB / six types: %', v_bucket;
    END IF;
    RAISE NOTICE 'PASS contact bucket private, 10 MiB, six types';

    IF NOT EXISTS (SELECT 1 FROM comms.notification_types WHERE key = 'contact.received' AND NOT mandatory) THEN
        RAISE EXCEPTION 'FAIL contact.received not in the catalog';
    END IF;
    RAISE NOTICE 'PASS contact.received in the catalog';

    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'ops' AND c.relname IN ('contact_requests', 'contact_request_attachments')
                  AND NOT c.relrowsecurity) THEN
        RAISE EXCEPTION 'FAIL RLS off on a contact table';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'ops'
                AND tablename IN ('contact_requests', 'contact_request_attachments') AND cmd <> 'SELECT') THEN
        RAISE EXCEPTION 'FAIL a contact table has a write policy';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                    AND policyname = 'Operators read contact attachments' AND cmd = 'SELECT') THEN
        RAISE EXCEPTION 'FAIL the contact bucket read policy is missing';
    END IF;
    RAISE NOTICE 'PASS RLS on, SELECT-only policies, operator bucket policy present';

    IF has_table_privilege('anon', 'ops.contact_requests', 'SELECT')
       OR has_table_privilege('anon', 'ops.contact_requests', 'INSERT')
       OR has_table_privilege('authenticated', 'ops.contact_requests', 'INSERT')
       OR has_table_privilege('authenticated', 'ops.contact_requests', 'UPDATE')
       OR has_table_privilege('authenticated', 'ops.contact_requests', 'DELETE')
       OR has_table_privilege('authenticated', 'ops.contact_requests', 'TRUNCATE')
       OR has_table_privilege('authenticated', 'ops.contact_request_attachments', 'INSERT')
       OR has_table_privilege('service_role', 'ops.contact_requests', 'DELETE') THEN
        RAISE EXCEPTION 'FAIL a role holds a write privilege on a contact table';
    END IF;
    IF NOT has_function_privilege('anon', 'ops.submit_contact_request(text, text, boolean, jsonb, uuid[])', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'ops.submit_contact_request(text, text, boolean, jsonb, uuid[])', 'EXECUTE')
       OR has_function_privilege('anon', 'ops.set_contact_request_status(text, text)', 'EXECUTE')
       OR has_function_privilege('anon', 'ops.fn_contact_reference()', 'EXECUTE')
       OR has_function_privilege('authenticated', 'ops.fn_contact_reference()', 'EXECUTE')
       OR has_function_privilege('authenticated', 'ops.fn_guard_contact_request()', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL function grants are not as declared';
    END IF;
    RAISE NOTICE 'PASS no client write privilege; only the intake door is public';
END $$;

DO $$
DECLARE
    v_ref text;
BEGIN
    FOR i IN 1..200 LOOP
        v_ref := ops.fn_contact_reference();
        IF v_ref !~ '^CT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$' THEN
            RAISE EXCEPTION 'FAIL malformed reference %', v_ref;
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS 200 references, all CT-XXXX-XXXX over Crockford base32';
END $$;
-- #endregion

-- #region 2. A guest (anon): a support request lands in backlog with no account
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
DECLARE
    v_out jsonb;
BEGIN
    v_out := ops.submit_contact_request('support', '  Guest@Example.COM ', false,
        '{"name":"Guest","topic":"payments","message":"My payout has not arrived after seven days."}'::jsonb);
    IF v_out ->> 'status' <> 'backlog' OR v_out ->> 'intent' <> 'support'
       OR (v_out ->> 'reference') !~ '^CT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$' THEN
        RAISE EXCEPTION 'FAIL guest submit answered %', v_out;
    END IF;
    PERFORM set_config('probe.guest_ref', v_out ->> 'reference', true);
    RAISE NOTICE 'PASS guest support request %', v_out ->> 'reference';

    BEGIN
        PERFORM 1 FROM ops.contact_requests;
        RAISE EXCEPTION 'FAIL anon read ops.contact_requests';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS anon cannot read requests';
    END;

    BEGIN
        PERFORM ops.submit_contact_request('support', 'guest@example.com', false,
            '{"name":"Guest","topic":"payments","message":"With somebody else''s file attached here."}'::jsonb,
            ARRAY['00000000-0000-4000-8000-0000000000a1']::uuid[]);
        RAISE EXCEPTION 'FAIL a guest attached a file';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS a guest cannot attach files [%]', SQLERRM;
    END;

    BEGIN
        PERFORM ops.set_contact_request_status(current_setting('probe.guest_ref'), 'archived');
        RAISE EXCEPTION 'FAIL anon moved a request';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS anon cannot move a request';
    END;
END $$;
RESET ROLE;

DO $$
DECLARE
    v_row ops.contact_requests%ROWTYPE;
BEGIN
    SELECT * INTO v_row FROM ops.contact_requests WHERE reference = current_setting('probe.guest_ref');
    IF v_row.user_id IS NOT NULL OR v_row.email <> 'guest@example.com' OR v_row.anonymous
       OR v_row.payload ->> 'topic' <> 'payments' THEN
        RAISE EXCEPTION 'FAIL guest row stored as %', row_to_json(v_row);
    END IF;
    RAISE NOTICE 'PASS guest row: no account, address lower-cased and trimmed, payload as sent';
END $$;
-- #endregion

-- #region 3. Shape refusals (anon) — every one a 22023 naming the field
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
DECLARE
    v_case record;
BEGIN
    FOR v_case IN
        SELECT * FROM (VALUES
            ('unknown intent', 'press', 'a@example.com', false, '{"message":"Twenty characters or more here."}'),
            ('payload not an object', 'support', 'a@example.com', false, '["message"]'),
            ('key outside the intent', 'sales', 'a@example.com', false, '{"name":"A","topic":"payments","message":"Twenty characters or more here."}'),
            ('short message', 'support', 'a@example.com', false, '{"name":"A","message":"Too short"}'),
            ('message not a string', 'support', 'a@example.com', false, '{"name":"A","message":42}'),
            ('blank name', 'support', 'a@example.com', false, '{"name":"   ","message":"Twenty characters or more here."}'),
            ('no reply address', 'support', '', false, '{"name":"A","message":"Twenty characters or more here."}'),
            ('malformed address', 'support', 'not-an-address', false, '{"name":"A","message":"Twenty characters or more here."}'),
            ('anonymous sales', 'sales', '', true, '{"message":"Twenty characters or more here."}'),
            ('anonymous with an address', 'security', 'a@example.com', true, '{"reportType":"abuse","message":"Twenty characters or more here."}'),
            ('anonymous with a name', 'security', '', true, '{"name":"A","reportType":"abuse","message":"Twenty characters or more here."}')
        ) AS t(label, intent, email, anon, payload)
    LOOP
        BEGIN
            PERFORM ops.submit_contact_request(v_case.intent, v_case.email, v_case.anon, v_case.payload::jsonb);
            RAISE EXCEPTION 'FAIL accepted: %', v_case.label;
        EXCEPTION WHEN invalid_parameter_value THEN
            RAISE NOTICE 'PASS refused % [%]', v_case.label, SQLERRM;
        END;
    END LOOP;
END $$;
RESET ROLE;
-- #endregion

-- #region 4. An anonymous security report stores no account, even from a signed-in caller
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.a'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_out jsonb;
BEGIN
    v_out := ops.submit_contact_request('security', NULL, true,
        '{"reportType":"whistleblower","message":"Something is wrong in a business I work with."}'::jsonb);
    PERFORM set_config('probe.anon_ref', v_out ->> 'reference', true);
    BEGIN
        PERFORM ops.submit_contact_request('security', NULL, true,
            '{"reportType":"vulnerability","message":"A file came with this anonymous report."}'::jsonb,
            ARRAY['00000000-0000-4000-8000-0000000000a1']::uuid[]);
        RAISE EXCEPTION 'FAIL an anonymous report carried an attachment';
    EXCEPTION WHEN invalid_parameter_value THEN
        RAISE NOTICE 'PASS an anonymous report carries no attachments';
    END;
END $$;
RESET ROLE;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM ops.contact_requests WHERE reference = current_setting('probe.anon_ref')
                    AND anonymous AND user_id IS NULL AND email IS NULL AND NOT payload ? 'name') THEN
        RAISE EXCEPTION 'FAIL the anonymous report kept an identity';
    END IF;
    RAISE NOTICE 'PASS anonymous report: no account, no address, no name';
END $$;
-- #endregion

-- #region 5. A signed-in sender: account stamped, own attachments linked, nobody else's
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.a'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_out jsonb;
    v_case record;
BEGIN
    v_out := ops.submit_contact_request('dispute', 'a@example.com', false,
        '{"name":"A","engagement":{"slug":"prj-abc","title":"Brand refresh","format":"pipeline"},"message":"The stage was approved but the files were never delivered."}'::jsonb,
        ARRAY['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2']::uuid[]);
    PERFORM set_config('probe.a_ref', v_out ->> 'reference', true);
    RAISE NOTICE 'PASS signed-in dispute with two attachments %', v_out ->> 'reference';

    FOR v_case IN
        SELECT * FROM (VALUES
            ('somebody else''s file', ARRAY['00000000-0000-4000-8000-0000000000b1']::uuid[], 'support'),
            ('a file still scanning', ARRAY['00000000-0000-4000-8000-0000000000a3']::uuid[], 'support'),
            ('a file already sent', ARRAY['00000000-0000-4000-8000-0000000000a1']::uuid[], 'support'),
            ('the same file twice', ARRAY['00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b1']::uuid[], 'support'),
            ('a sales enquiry with a file', ARRAY['00000000-0000-4000-8000-0000000000b1']::uuid[], 'sales')
        ) AS t(label, ids, intent)
    LOOP
        BEGIN
            PERFORM ops.submit_contact_request(v_case.intent, 'a@example.com', false,
                CASE WHEN v_case.intent = 'sales'
                     THEN '{"name":"A","company":"A Ltd","companySize":"1-10","budget":"not-sure","message":"Twenty characters or more here."}'
                     ELSE '{"name":"A","topic":"other","message":"Twenty characters or more here."}' END::jsonb,
                v_case.ids);
            RAISE EXCEPTION 'FAIL linked %', v_case.label;
        EXCEPTION WHEN invalid_parameter_value THEN
            RAISE NOTICE 'PASS refused % [%]', v_case.label, SQLERRM;
        END;
    END LOOP;

    BEGIN
        PERFORM 1 FROM ops.contact_requests WHERE reference = current_setting('probe.a_ref');
        IF FOUND THEN
            RAISE EXCEPTION 'FAIL a non-operator read their request back';
        END IF;
        RAISE NOTICE 'PASS a non-operator reads no request (RLS)';
    END;

    BEGIN
        UPDATE ops.contact_requests SET status = 'archived' WHERE reference = current_setting('probe.a_ref');
        RAISE EXCEPTION 'FAIL a sender updated their request';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS a sender cannot update a request';
    END;

    BEGIN
        PERFORM ops.set_contact_request_status(current_setting('probe.a_ref'), 'complete');
        RAISE EXCEPTION 'FAIL a non-operator moved a request';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS a non-operator cannot move a request';
    END;
END $$;
RESET ROLE;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM ops.contact_requests WHERE reference = current_setting('probe.a_ref')
                    AND user_id = current_setting('probe.a')::uuid AND payload -> 'engagement' ->> 'slug' = 'prj-abc') THEN
        RAISE EXCEPTION 'FAIL the signed-in request lost its account or engagement';
    END IF;
    IF (SELECT count(*) FROM ops.contact_request_attachments ca
          JOIN ops.contact_requests r ON r.id = ca.request_id
         WHERE r.reference = current_setting('probe.a_ref')) <> 2 THEN
        RAISE EXCEPTION 'FAIL the two attachments were not linked';
    END IF;
    RAISE NOTICE 'PASS account stamped, engagement stored, two attachments linked';
END $$;
-- #endregion

-- #region 6. The operator: told, reads everything, moves along the machine only
DO $$
BEGIN
    IF (SELECT count(*) FROM comms.notifications n
         WHERE n.user_id = current_setting('probe.op')::uuid AND n.type = 'contact.received'
           AND n.payload ->> 'reference' IN (current_setting('probe.guest_ref'), current_setting('probe.a_ref'),
               current_setting('probe.anon_ref'))) < 3 THEN
        RAISE EXCEPTION 'FAIL the operator was not told about every request';
    END IF;
    IF EXISTS (SELECT 1 FROM comms.notifications n
                WHERE n.type = 'contact.received' AND n.body LIKE '%payout has not arrived%') THEN
        RAISE EXCEPTION 'FAIL a notification carried the sender''s words';
    END IF;
    RAISE NOTICE 'PASS every request notified the operator, without the message';
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.op'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_out jsonb;
    v_case record;
BEGIN
    IF (SELECT count(*) FROM ops.contact_requests WHERE reference IN (current_setting('probe.guest_ref'),
            current_setting('probe.a_ref'), current_setting('probe.anon_ref'))) <> 3 THEN
        RAISE EXCEPTION 'FAIL the operator cannot read every request';
    END IF;
    IF (SELECT count(*) FROM ops.contact_request_attachments) < 2 THEN
        RAISE EXCEPTION 'FAIL the operator cannot read attachment links';
    END IF;
    IF NOT files.fn_can_read('00000000-0000-4000-8000-0000000000a1') THEN
        RAISE EXCEPTION 'FAIL the operator cannot read a contact attachment row';
    END IF;
    RAISE NOTICE 'PASS the operator reads requests, links and attachment rows';

    v_out := ops.set_contact_request_status(current_setting('probe.a_ref'), 'in_progress');
    IF v_out ->> 'status' <> 'in_progress' THEN RAISE EXCEPTION 'FAIL move answered %', v_out; END IF;
    v_out := ops.set_contact_request_status(current_setting('probe.a_ref'), 'complete');
    v_out := ops.set_contact_request_status(current_setting('probe.a_ref'), 'archived');
    RAISE NOTICE 'PASS backlog → in_progress → complete → archived';

    FOR v_case IN
        SELECT * FROM (VALUES
            (current_setting('probe.a_ref'), 'backlog', 'archived is terminal'),
            (current_setting('probe.guest_ref'), 'complete', 'backlog cannot skip to complete'),
            (current_setting('probe.guest_ref'), 'open', 'a status outside the machine')
        ) AS t(ref, status, label)
    LOOP
        BEGIN
            PERFORM ops.set_contact_request_status(v_case.ref, v_case.status);
            RAISE EXCEPTION 'FAIL allowed: %', v_case.label;
        EXCEPTION WHEN check_violation THEN
            RAISE NOTICE 'PASS refused % [%]', v_case.label, SQLERRM;
        END;
    END LOOP;

    BEGIN
        PERFORM ops.set_contact_request_status('CT-0000-0000', 'archived');
        RAISE EXCEPTION 'FAIL an unknown reference moved';
    EXCEPTION WHEN no_data_found THEN
        RAISE NOTICE 'PASS an unknown reference is P0002';
    END;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.b'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    IF files.fn_can_read('00000000-0000-4000-8000-0000000000a1') THEN
        RAISE EXCEPTION 'FAIL a non-operator stranger can read A''s contact attachment';
    END IF;
    RAISE NOTICE 'PASS a stranger cannot read a contact attachment';
END $$;
RESET ROLE;
-- #endregion

-- #region 7. The record guard holds for every role, and lets account erasure through
DO $$
BEGIN
    BEGIN
        UPDATE ops.contact_requests SET payload = '{"message":"Rewritten after the fact, by anyone."}'::jsonb
         WHERE reference = current_setting('probe.guest_ref');
        RAISE EXCEPTION 'FAIL the payload was rewritten';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS the payload is immutable, even to the owner role';
    END;
    BEGIN
        UPDATE ops.contact_requests SET user_id = current_setting('probe.b')::uuid
         WHERE reference = current_setting('probe.a_ref');
        RAISE EXCEPTION 'FAIL a request was re-attributed';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS a request cannot be re-attributed';
    END;
    UPDATE ops.contact_requests SET user_id = NULL WHERE reference = current_setting('probe.a_ref');
    RAISE NOTICE 'PASS account erasure (user_id → NULL) passes the guard';
END $$;
-- #endregion

-- #region 8. The durable ceiling: five per address per hour
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
BEGIN
    FOR i IN 1..5 LOOP
        PERFORM ops.submit_contact_request('sales', 'ceiling@example.com', false,
            '{"name":"C","company":"C Ltd","companySize":"11-50","budget":"5k-25k","message":"We would like a demo for our team."}'::jsonb);
    END LOOP;
    BEGIN
        PERFORM ops.submit_contact_request('sales', 'CEILING@example.com', false,
            '{"name":"C","company":"C Ltd","companySize":"11-50","budget":"5k-25k","message":"We would like a demo for our team."}'::jsonb);
        RAISE EXCEPTION 'FAIL a sixth request from one address in an hour was accepted';
    EXCEPTION WHEN SQLSTATE 'PR429' THEN
        RAISE NOTICE 'PASS the sixth request from one address is PR429 [%]', SQLERRM;
    END;
END $$;
RESET ROLE;
-- #endregion

ROLLBACK;
