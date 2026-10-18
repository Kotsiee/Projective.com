-- =============================================================================================
-- Probe: /contact intake (Decision #276) — ops.contact_requests, ops.contact_request_attachments,
-- ops.submit_contact_request, ops.set_contact_request_status, ops.fn_guard_contact_request,
-- ops.discard_contact_attachment, ops.fn_claim_stale_contact_attachments, the `contact` bucket, its
-- storage policy, the files.fn_can_read operator arm, contact.received and the sweep's job row.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/contact_requests.sql
--
-- Every expected refusal is asserted: a call that SUCCEEDS where it must be refused raises `FAIL …`
-- and aborts the run (non-zero exit under ON_ERROR_STOP). A clean run prints only PASS notices.
-- Fixtures come from the seed (two non-operator people); the operator, an identity that has not
-- finished /join (no org.users_public row) and every file row are made inside the transaction.
-- =============================================================================================

BEGIN;
-- @prelude

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_a uuid;
    v_b uuid;
    v_op uuid;
    v_n uuid := gen_random_uuid();
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
         'image/png', 2048, 'uploaded', 'contact', 'user'),
        -- a4: scanned and never sent (A removes it); a7: never sent, long ago (the sweep takes it);
        -- a8: never sent, two hours ago (too young for the sweep); a9: an ordinary library file.
        ('00000000-0000-4000-8000-0000000000a4', v_a, 'contact', v_a || '/a4/wrong.pdf', 'wrong.pdf', 'wrong.pdf',
         'application/pdf', 512, 'uploaded', 'contact', 'user'),
        ('00000000-0000-4000-8000-0000000000a7', v_a, 'contact', v_a || '/a7/old.png', 'old.png', 'old.png',
         'image/png', 512, 'uploaded', 'contact', 'user'),
        ('00000000-0000-4000-8000-0000000000a8', v_a, 'contact', v_a || '/a8/recent.png', 'recent.png', 'recent.png',
         'image/png', 512, 'uploaded', 'contact', 'user'),
        ('00000000-0000-4000-8000-0000000000a9', v_a, 'personal', v_a || '/a9/notes.txt', 'notes.txt', 'notes.txt',
         'text/plain', 512, 'uploaded', 'library', 'user');
    -- Declared for the contact pipeline and not yet promoted: a5 mid-check, a6 still uploading.
    INSERT INTO files.items (id, owner_user_id, bucket_id, storage_path, target_bucket, display_name,
        original_name, mime_type, size_bytes, status, purpose, owner_type)
    VALUES
        ('00000000-0000-4000-8000-0000000000a5', v_a, 'quarantine', v_a || '/a5/checking.png', 'contact',
         'checking.png', 'checking.png', 'image/png', 512, 'scanning', 'library', 'user'),
        ('00000000-0000-4000-8000-0000000000a6', v_a, 'quarantine', v_a || '/a6/uploading.png', 'contact',
         'uploading.png', 'uploading.png', 'image/png', 512, 'pending_upload', 'library', 'user');
    UPDATE files.items SET created_at = '2000-01-01T00:00:00Z'
     WHERE id IN ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a7',
                  '00000000-0000-4000-8000-0000000000a9');
    UPDATE files.items SET created_at = now() - interval '2 hours'
     WHERE id = '00000000-0000-4000-8000-0000000000a8';
    -- The stored objects of a sent (a1) and an unsent (a4) attachment, for the bucket policy.
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('contact', v_a || '/a1/screen.png', v_a), ('contact', v_a || '/a4/wrong.pdf', v_a);

    -- An identity with no profile, as an OAuth sign-up leaves it until /join is finished.
    INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at)
    VALUES (v_n, 'contact-probe-' || v_n || '@projective.invalid', 'authenticated', 'authenticated', '{}'::jsonb, now());

    PERFORM set_config('probe.a', v_a::text, true);
    PERFORM set_config('probe.b', v_b::text, true);
    PERFORM set_config('probe.op', v_op::text, true);
    PERFORM set_config('probe.n', v_n::text, true);
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
       OR has_function_privilege('authenticated', 'ops.fn_guard_contact_request()', 'EXECUTE')
       OR has_function_privilege('anon', 'ops.discard_contact_attachment(uuid)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'ops.discard_contact_attachment(uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'ops.fn_claim_stale_contact_attachments(interval, integer)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'ops.fn_claim_stale_contact_attachments(interval, integer)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'ops.fn_claim_stale_contact_attachments(interval, integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL function grants are not as declared';
    END IF;
    RAISE NOTICE 'PASS no client write privilege; only the intake door is public; Remove is a session''s, the sweep the service''s';

    IF NOT EXISTS (SELECT 1 FROM ops.scheduled_jobs WHERE name = 'contact-attachment-sweep' AND kind = 'http'
                    AND path = '/api/contact/cron/attachments?limit=100' AND secret_name = 'CONTACT_CRON_SECRET') THEN
        RAISE EXCEPTION 'FAIL the contact-attachment-sweep job is not registered';
    END IF;
    RAISE NOTICE 'PASS the hourly attachment sweep is registered';
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

-- #region 2b. A signed-in sender who has not finished /join (no org.users_public row) gets a receipt
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.n'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_out jsonb;
BEGIN
    v_out := ops.submit_contact_request('support', 'NewPerson@Example.com', false,
        '{"name":"New Person","topic":"account","message":"I signed up with Google and cannot finish joining."}'::jsonb);
    PERFORM set_config('probe.n_ref', v_out ->> 'reference', true);
    RAISE NOTICE 'PASS an identity with no profile files a support request %', v_out ->> 'reference';
END $$;
RESET ROLE;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM ops.contact_requests WHERE reference = current_setting('probe.n_ref')
                    AND user_id = current_setting('probe.n')::uuid) THEN
        RAISE EXCEPTION 'FAIL the un-onboarded sender''s request lost its account';
    END IF;
    IF EXISTS (SELECT 1 FROM org.users_public WHERE user_id = current_setting('probe.n')::uuid) THEN
        RAISE EXCEPTION 'FAIL the fixture identity has a profile';
    END IF;
    RAISE NOTICE 'PASS the request is stamped with the identity (auth.users), not a profile';
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
            ('no reply address', 'support', '', false, '{"name":"A","topic":"other","message":"Twenty characters or more here."}'),
            ('malformed address', 'support', 'not-an-address', false, '{"name":"A","topic":"other","message":"Twenty characters or more here."}'),
            ('anonymous sales', 'sales', '', true, '{"company":"A Ltd","companySize":"1-10","budget":"not-sure","message":"Twenty characters or more here."}'),
            ('anonymous with an address', 'security', 'a@example.com', true, '{"reportType":"abuse","message":"Twenty characters or more here."}'),
            ('anonymous with a name', 'security', '', true, '{"name":"A","reportType":"abuse","message":"Twenty characters or more here."}'),
            ('company as an object', 'sales', 'a@example.com', false, '{"name":"A","company":{"x":1},"companySize":"1-10","budget":"not-sure","message":"Twenty characters or more here."}'),
            ('company too long', 'sales', 'a@example.com', false, '{"name":"A","company":"ccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","companySize":"1-10","budget":"not-sure","message":"Twenty characters or more here."}'),
            ('companySize as a number', 'sales', 'a@example.com', false, '{"name":"A","company":"A Ltd","companySize":42,"budget":"not-sure","message":"Twenty characters or more here."}'),
            ('companySize off the list', 'sales', 'a@example.com', false, '{"name":"A","company":"A Ltd","companySize":"huge","budget":"not-sure","message":"Twenty characters or more here."}'),
            ('budget as an array', 'sales', 'a@example.com', false, '{"name":"A","company":"A Ltd","companySize":"1-10","budget":["5k-25k"],"message":"Twenty characters or more here."}'),
            ('sales without a budget', 'sales', 'a@example.com', false, '{"name":"A","company":"A Ltd","companySize":"1-10","message":"Twenty characters or more here."}'),
            ('topic off the list', 'support', 'a@example.com', false, '{"name":"A","topic":"refunds","message":"Twenty characters or more here."}'),
            ('support without a topic', 'support', 'a@example.com', false, '{"name":"A","message":"Twenty characters or more here."}'),
            ('named request without a name', 'support', 'a@example.com', false, '{"topic":"other","message":"Twenty characters or more here."}'),
            ('accountEmail malformed', 'support', 'a@example.com', false, '{"name":"A","topic":"account","accountEmail":"nobody","message":"Twenty characters or more here."}'),
            ('accountEmail as a number', 'support', 'a@example.com', false, '{"name":"A","topic":"account","accountEmail":7,"message":"Twenty characters or more here."}'),
            ('referenceId as an object', 'dispute', 'a@example.com', false, '{"name":"A","referenceId":{"id":1},"message":"Twenty characters or more here."}'),
            ('referenceId too long', 'dispute', 'a@example.com', false, '{"name":"A","referenceId":"rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr","message":"Twenty characters or more here."}'),
            ('engagement as a string', 'dispute', 'a@example.com', false, '{"name":"A","engagement":"prj-abc","message":"Twenty characters or more here."}'),
            ('engagement with an extra key', 'dispute', 'a@example.com', false, '{"name":"A","engagement":{"slug":"prj-abc","title":"T","format":"pipeline","amount":9},"message":"Twenty characters or more here."}'),
            ('engagement without a format', 'dispute', 'a@example.com', false, '{"name":"A","engagement":{"slug":"prj-abc","title":"T"},"message":"Twenty characters or more here."}'),
            ('engagement format off the list', 'dispute', 'a@example.com', false, '{"name":"A","engagement":{"slug":"prj-abc","title":"T","format":"retainer"},"message":"Twenty characters or more here."}'),
            ('reportType off the list', 'security', 'a@example.com', false, '{"name":"A","reportType":"gossip","message":"Twenty characters or more here."}'),
            ('security without a reportType', 'security', '', true, '{"message":"Twenty characters or more here."}')
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

    IF files.fn_can_read('00000000-0000-4000-8000-0000000000a4') THEN
        RAISE EXCEPTION 'FAIL the operator can read a contact attachment nobody sent';
    END IF;
    IF (SELECT count(*) FROM storage.objects o WHERE o.bucket_id = 'contact'
          AND o.name = current_setting('probe.a') || '/a1/screen.png') <> 1 THEN
        RAISE EXCEPTION 'FAIL the operator cannot read a sent attachment''s object';
    END IF;
    IF EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'contact'
                AND o.name = current_setting('probe.a') || '/a4/wrong.pdf') THEN
        RAISE EXCEPTION 'FAIL the operator can read an unsent attachment''s object';
    END IF;
    RAISE NOTICE 'PASS operators read only SENT attachments — rows and objects';

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
    IF EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'contact') THEN
        RAISE EXCEPTION 'FAIL a non-operator stranger can read a contact object';
    END IF;
    RAISE NOTICE 'PASS a stranger cannot read a contact attachment or object';
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

-- #region 9. Remove: a sender takes back an unsent attachment — only their own, only unsent
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
BEGIN
    BEGIN
        PERFORM ops.discard_contact_attachment('00000000-0000-4000-8000-0000000000a4');
        RAISE EXCEPTION 'FAIL anon removed an attachment';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS anon cannot remove an attachment';
    END;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.a'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_out jsonb;
    v_case record;
BEGIN
    v_out := ops.discard_contact_attachment('00000000-0000-4000-8000-0000000000a4');
    IF v_out ->> 'bucket_id' <> 'contact' OR v_out ->> 'storage_path' <> current_setting('probe.a') || '/a4/wrong.pdf' THEN
        RAISE EXCEPTION 'FAIL Remove answered %', v_out;
    END IF;
    v_out := ops.discard_contact_attachment('00000000-0000-4000-8000-0000000000a6');
    IF v_out ->> 'bucket_id' <> 'quarantine' THEN
        RAISE EXCEPTION 'FAIL Remove of a file still uploading answered %', v_out;
    END IF;
    RAISE NOTICE 'PASS Remove takes back a checked file and one still uploading, naming each object';

    FOR v_case IN
        SELECT * FROM (VALUES
            ('00000000-0000-4000-8000-0000000000a1'::uuid, 'a file already sent'),
            ('00000000-0000-4000-8000-0000000000a4'::uuid, 'a file already removed'),
            ('00000000-0000-4000-8000-0000000000b1'::uuid, 'somebody else''s file'),
            ('00000000-0000-4000-8000-0000000000a9'::uuid, 'a library file')
        ) AS t(id, label)
    LOOP
        BEGIN
            PERFORM ops.discard_contact_attachment(v_case.id);
            RAISE EXCEPTION 'FAIL removed %', v_case.label;
        EXCEPTION WHEN no_data_found THEN
            RAISE NOTICE 'PASS refused to remove % [%]', v_case.label, SQLERRM;
        END;
    END LOOP;

    BEGIN
        PERFORM ops.discard_contact_attachment('00000000-0000-4000-8000-0000000000a5');
        RAISE EXCEPTION 'FAIL removed a file mid-check';
    EXCEPTION WHEN object_in_use THEN
        RAISE NOTICE 'PASS a file mid-check is 55006 [%]', SQLERRM;
    END;

    BEGIN
        PERFORM ops.submit_contact_request('support', 'a@example.com', false,
            '{"name":"A","topic":"other","message":"Sending the file I removed a moment ago."}'::jsonb,
            ARRAY['00000000-0000-4000-8000-0000000000a4']::uuid[]);
        RAISE EXCEPTION 'FAIL a removed file was sent';
    EXCEPTION WHEN invalid_parameter_value THEN
        RAISE NOTICE 'PASS a removed file cannot be sent';
    END;
END $$;
RESET ROLE;
DO $$
BEGIN
    IF (SELECT count(*) FROM files.items WHERE deleted_at IS NOT NULL
          AND id IN ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000a6')) <> 2
       OR EXISTS (SELECT 1 FROM files.items WHERE deleted_at IS NOT NULL
          AND id IN ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a5',
                     '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a9')) THEN
        RAISE EXCEPTION 'FAIL Remove soft-deleted the wrong rows';
    END IF;
    RAISE NOTICE 'PASS exactly the two removed rows are soft-deleted (never hard-deleted)';
END $$;
-- #endregion

-- #region 10. The sweep: only unsent contact uploads, only once they are old enough
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.op'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    BEGIN
        PERFORM 1 FROM ops.fn_claim_stale_contact_attachments();
        RAISE EXCEPTION 'FAIL a signed-in caller (even an operator) ran the sweep';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS the sweep is the service role''s alone';
    END;
END $$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$
DECLARE
    v_claimed uuid[];
BEGIN
    SELECT array_agg(file_id) INTO v_claimed FROM ops.fn_claim_stale_contact_attachments(interval '6 hours', 1000);
    IF NOT ('00000000-0000-4000-8000-0000000000a7'::uuid = ANY (v_claimed)) THEN
        RAISE EXCEPTION 'FAIL the sweep missed an old unsent attachment';
    END IF;
    IF v_claimed && ARRAY['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a8',
                          '00000000-0000-4000-8000-0000000000a9', '00000000-0000-4000-8000-0000000000a4']::uuid[] THEN
        RAISE EXCEPTION 'FAIL the sweep claimed a sent, recent, library or already-removed file: %', v_claimed;
    END IF;
    IF EXISTS (SELECT 1 FROM ops.fn_claim_stale_contact_attachments(interval '6 hours', 1000)
                WHERE file_id = '00000000-0000-4000-8000-0000000000a7') THEN
        RAISE EXCEPTION 'FAIL the sweep claimed the same file twice';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ops.fn_claim_stale_contact_attachments(interval '1 minute', 1000)
                    WHERE file_id = '00000000-0000-4000-8000-0000000000a8') THEN
        RAISE EXCEPTION 'FAIL the sweep''s one-hour floor did not let a two-hour-old file through';
    END IF;
    RAISE NOTICE 'PASS the sweep takes unsent contact uploads past the window, once, and nothing else';
END $$;
RESET ROLE;
-- #endregion

-- #region 11. The guest ceiling: 60 named requests without an account per hour, platform-wide
DO $$
DECLARE
    v_have integer;
BEGIN
    SELECT count(*) INTO v_have FROM ops.contact_requests
     WHERE user_id IS NULL AND NOT anonymous AND created_at > now() - interval '1 hour';
    INSERT INTO ops.contact_requests (reference, intent, email, user_id, anonymous, payload)
    SELECT ops.fn_contact_reference(), 'support', 'flood' || g || '@example.com', NULL, false,
           '{"name":"F","topic":"other","message":"A scripted request through the door."}'::jsonb
      FROM generate_series(1, GREATEST(60 - v_have, 0)) AS g;
END $$;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
BEGIN
    BEGIN
        PERFORM ops.submit_contact_request('support', 'fresh-address@example.com', false,
            '{"name":"G","topic":"other","message":"A real guest behind the flood of requests."}'::jsonb);
        RAISE EXCEPTION 'FAIL a guest request past the platform-wide ceiling was accepted';
    EXCEPTION WHEN SQLSTATE 'PR429' THEN
        RAISE NOTICE 'PASS the 61st guest request in an hour is PR429 [%]', SQLERRM;
    END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.b'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    PERFORM ops.submit_contact_request('support', 'b@example.com', false,
        '{"name":"B","topic":"payments","message":"Signed in, so the guest ceiling does not stop me."}'::jsonb);
    RAISE NOTICE 'PASS a signed-in sender is not held by the guest ceiling';
END $$;
RESET ROLE;
-- #endregion

ROLLBACK;
