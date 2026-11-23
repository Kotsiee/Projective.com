-- =============================================================================================
-- Probe: the review sink (T&S R1; Decisions #148, #340 T4, #496 (A) and (d), #533) — ops.reports,
-- ops.file_report, ops.file_automated_finding, ops.fn_guard_report, its RLS and grants, the
-- `evidence` bucket.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/reports_sink.sql
--
-- Every expected refusal is asserted: a statement that SUCCEEDS where it must be refused raises
-- `FAIL …` and aborts the run. Fixtures: three seeded non-operator people (reporter A, author B,
-- stranger C) and an operator made inside the transaction.
-- =============================================================================================

BEGIN;
-- @prelude

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_people uuid[];
BEGIN
    SELECT array_agg(user_id) INTO v_people FROM (
        SELECT u.user_id FROM org.users_public u
         WHERE NOT EXISTS (SELECT 1 FROM ops.admin_users au WHERE au.user_id = u.user_id)
         ORDER BY u.user_id LIMIT 4
    ) p;
    IF coalesce(array_length(v_people, 1), 0) < 4 THEN
        RAISE EXCEPTION 'FAIL no fixture: need four seeded people (deno task db:reset)';
    END IF;
    INSERT INTO ops.admin_users (user_id) VALUES (v_people[4]) ON CONFLICT (user_id) DO NOTHING;
    PERFORM set_config('probe.a', v_people[1]::text, true);
    PERFORM set_config('probe.b', v_people[2]::text, true);
    PERFORM set_config('probe.c', v_people[3]::text, true);
    PERFORM set_config('probe.op', v_people[4]::text, true);
    PERFORM set_config('probe.subject', gen_random_uuid()::text, true);

    IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'evidence' AND NOT public) THEN
        RAISE EXCEPTION 'FAIL the private evidence bucket is missing';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                AND (qual ILIKE '%evidence%' OR with_check ILIKE '%evidence%')) THEN
        RAISE EXCEPTION 'FAIL a storage policy reaches the evidence bucket';
    END IF;
    RAISE NOTICE 'PASS the evidence bucket is private and no storage policy reaches it';
END $$;
-- #endregion

-- #region 1. A client cannot call the doors
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.a'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    BEGIN
        PERFORM ops.file_report(current_setting('probe.a')::uuid, 'dm_message',
            current_setting('probe.subject')::uuid, 'harassment', current_setting('probe.b')::uuid, '{}'::jsonb);
        RAISE EXCEPTION 'FAIL authenticated called ops.file_report';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM ops.file_automated_finding('nudenet', 'file', current_setting('probe.subject')::uuid,
            current_setting('probe.b')::uuid, 'sexual_content', '{}'::jsonb);
        RAISE EXCEPTION 'FAIL authenticated called ops.file_automated_finding';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE NOTICE 'PASS a signed-in client reaches neither filing door (42501)';
END $$;
RESET ROLE;
-- #endregion

-- #region 2. The service role files a person's report and a detector finding
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$
DECLARE
    v_out jsonb;
BEGIN
    v_out := ops.file_report(current_setting('probe.a')::uuid, 'dm_message',
        current_setting('probe.subject')::uuid, 'harassment', current_setting('probe.b')::uuid,
        '{"subjectType":"dm_message","capturedAt":"2026-11-23T10:00:00Z","row":{"id":"x","body":"masked"}}'::jsonb);
    IF v_out ->> 'status' <> 'pending' THEN
        RAISE EXCEPTION 'FAIL a filed report is %, not pending', v_out ->> 'status';
    END IF;
    PERFORM set_config('probe.report', v_out ->> 'id', true);

    BEGIN
        PERFORM ops.file_report(current_setting('probe.a')::uuid, 'dm_message',
            current_setting('probe.subject')::uuid, 'spam_or_scam', current_setting('probe.b')::uuid, '{}'::jsonb);
        RAISE EXCEPTION 'FAIL a second pending report on one subject by one reporter was filed';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;

    BEGIN
        PERFORM ops.file_report(current_setting('probe.a')::uuid, 'dm_message', gen_random_uuid(),
            'evasion_fragmentation', current_setting('probe.b')::uuid, '{}'::jsonb);
        RAISE EXCEPTION 'FAIL a person filed the detector-only reason';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;

    BEGIN
        PERFORM ops.file_report(current_setting('probe.a')::uuid, 'dm_message', gen_random_uuid(),
            'rudeness', current_setting('probe.b')::uuid, '{}'::jsonb);
        RAISE EXCEPTION 'FAIL a reason outside the vocabulary was filed';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    v_out := ops.file_automated_finding('fragmentation', 'dm_message', gen_random_uuid(),
        current_setting('probe.b')::uuid, 'evasion_fragmentation',
        '{"ids":["00000000-0000-4000-8000-000000000001"],"categories":["phone"],"scores":{"phone":0.9}}'::jsonb);
    IF NOT EXISTS (SELECT 1 FROM ops.reports WHERE id = (v_out ->> 'id')::uuid
                    AND source = 'automated' AND reporter_user_id IS NULL AND detector = 'fragmentation') THEN
        RAISE EXCEPTION 'FAIL the automated finding was not stored with a null reporter';
    END IF;
    PERFORM set_config('probe.finding', v_out ->> 'id', true);
    RAISE NOTICE 'PASS a user report is pending; one pending per reporter and subject; the reason is closed and evasion_fragmentation is the detector''s; an automated finding has no reporter';
END $$;

-- The service role reads, but writes nothing directly.
DO $$
BEGIN
    BEGIN
        UPDATE ops.reports SET evidence_snapshot = '{"forged":true}' WHERE id = current_setting('probe.report')::uuid;
        RAISE EXCEPTION 'FAIL the service role rewrote a snapshot';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        DELETE FROM ops.reports WHERE id = current_setting('probe.report')::uuid;
        RAISE EXCEPTION 'FAIL the service role deleted a report';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE NOTICE 'PASS the service role holds no UPDATE or DELETE on ops.reports';
END $$;
RESET ROLE;
-- #endregion

-- #region 3. Who reads a report
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.a'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM ops.reports WHERE id = current_setting('probe.report')::uuid) THEN
        RAISE EXCEPTION 'FAIL the reporter cannot read their own report';
    END IF;
    IF EXISTS (SELECT 1 FROM ops.reports WHERE id = current_setting('probe.finding')::uuid) THEN
        RAISE EXCEPTION 'FAIL the reporter reads an automated finding';
    END IF;
    BEGIN
        INSERT INTO ops.reports (source, reporter_user_id, reported_subject_type, reported_subject_id, reason, evidence_snapshot)
        VALUES ('user', current_setting('probe.a')::uuid, 'profile', gen_random_uuid(), 'other', '{}');
        RAISE EXCEPTION 'FAIL a client inserted a report';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        UPDATE ops.reports SET status = 'dismissed', resolution_notes = 'x', resolved_at = now()
         WHERE id = current_setting('probe.report')::uuid;
        RAISE EXCEPTION 'FAIL a client updated a report';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        DELETE FROM ops.reports WHERE id = current_setting('probe.report')::uuid;
        RAISE EXCEPTION 'FAIL a client deleted a report';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE NOTICE 'PASS the reporter reads their report and nothing else; a client INSERT / UPDATE / DELETE is 42501';
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.b'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM ops.reports) THEN
        RAISE EXCEPTION 'FAIL the reported person reads a report about them';
    END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.c'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM ops.reports) THEN
        RAISE EXCEPTION 'FAIL a stranger reads a report';
    END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
BEGIN
    BEGIN
        PERFORM 1 FROM ops.reports;
        RAISE EXCEPTION 'FAIL anon reads ops.reports';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.op'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    IF (SELECT count(*) FROM ops.reports
         WHERE id IN (current_setting('probe.report')::uuid, current_setting('probe.finding')::uuid)) <> 2 THEN
        RAISE EXCEPTION 'FAIL an operator cannot read every report';
    END IF;
    RAISE NOTICE 'PASS the reported person, a stranger and anon read nothing; an operator reads every report';
END $$;
RESET ROLE;
-- #endregion

-- #region 4. The record guard holds even for the owner (as postgres)
DO $$
BEGIN
    BEGIN
        UPDATE ops.reports SET evidence_snapshot = '{"forged":true}' WHERE id = current_setting('probe.report')::uuid;
        RAISE EXCEPTION 'FAIL the owner rewrote a snapshot';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        UPDATE ops.reports SET reason = 'other' WHERE id = current_setting('probe.report')::uuid;
        RAISE EXCEPTION 'FAIL the owner changed a reason';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        UPDATE ops.reports SET reporter_user_id = current_setting('probe.c')::uuid WHERE id = current_setting('probe.report')::uuid;
        RAISE EXCEPTION 'FAIL the owner swapped a reporter';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    -- The reporter's erasure (ON DELETE SET NULL) must pass: a report outlives its reporter (#496 (d)).
    UPDATE ops.reports SET reporter_user_id = NULL WHERE id = current_setting('probe.report')::uuid;

    BEGIN
        UPDATE ops.reports SET status = 'dismissed', resolved_at = now() WHERE id = current_setting('probe.report')::uuid;
        RAISE EXCEPTION 'FAIL a report left pending without notes';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    UPDATE ops.reports SET status = 'actioned', resolution_notes = 'Verified.', resolved_at = now(),
           resolved_by = current_setting('probe.op')::uuid
     WHERE id = current_setting('probe.report')::uuid;
    BEGIN
        UPDATE ops.reports SET status = 'dismissed' WHERE id = current_setting('probe.report')::uuid;
        RAISE EXCEPTION 'FAIL a resolved report moved again';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    UPDATE ops.reports SET resolved_by = NULL WHERE id = current_setting('probe.report')::uuid;
    RAISE NOTICE 'PASS snapshot, reason and reporter are immutable for the owner; erasure nulls the reporter and reviewer; pending → actioned needs notes and is final';
END $$;
-- #endregion

-- #region 5. Who may stand behind a row: user, automated, notice (as postgres)
DO $$
BEGIN
    BEGIN
        INSERT INTO ops.reports (source, reported_subject_type, reported_subject_id, reason, evidence_snapshot)
        VALUES ('user', 'profile', gen_random_uuid(), 'other', '{}');
        RAISE EXCEPTION 'FAIL a user report with no reporter was filed';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO ops.reports (source, reporter_user_id, detector, reported_subject_type, reported_subject_id, reason, evidence_snapshot)
        VALUES ('automated', current_setting('probe.a')::uuid, 'nudenet', 'file', gen_random_uuid(), 'sexual_content', '{}');
        RAISE EXCEPTION 'FAIL an automated finding named a reporter';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO ops.reports (source, reported_subject_type, reported_subject_id, reason, evidence_snapshot)
        VALUES ('notice', 'listing', gen_random_uuid(), 'intellectual_property', '{}');
        RAISE EXCEPTION 'FAIL a notice row without its notice block was filed';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO ops.reports (source, reporter_user_id, reported_subject_type, reported_subject_id, reason, evidence_snapshot, notice)
        VALUES ('notice', current_setting('probe.a')::uuid, 'listing', gen_random_uuid(), 'intellectual_property', '{}', '{}');
        RAISE EXCEPTION 'FAIL a notice row named a reporter';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO ops.reports (source, reported_subject_type, reported_subject_id, reason, evidence_snapshot, notice)
        VALUES ('notice', 'listing', gen_random_uuid(), 'spam_or_scam', '{}', '{}');
        RAISE EXCEPTION 'FAIL a notice row carried a reason other than intellectual_property';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    INSERT INTO ops.reports (source, reported_subject_type, reported_subject_id, reason, evidence_snapshot, notice)
    VALUES ('notice', 'listing', gen_random_uuid(), 'intellectual_property', '{}', '{}');
    RAISE NOTICE 'PASS a user row needs its reporter; automated and notice rows name none; a notice needs its block and is an IP claim';
END $$;
-- #endregion

-- #region 6. The per-reporter daily cap (as the service role)
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$
DECLARE
    v_i integer;
BEGIN
    FOR v_i IN 1..20 LOOP
        PERFORM ops.file_report(current_setting('probe.c')::uuid, 'profile', gen_random_uuid(),
            'spam_or_scam', current_setting('probe.b')::uuid, '{}'::jsonb);
    END LOOP;
    BEGIN
        PERFORM ops.file_report(current_setting('probe.c')::uuid, 'profile', gen_random_uuid(),
            'spam_or_scam', current_setting('probe.b')::uuid, '{}'::jsonb);
        RAISE EXCEPTION 'FAIL a 21st report in 24 hours was filed';
    EXCEPTION WHEN SQLSTATE 'PR429' THEN NULL;
    END;
    RAISE NOTICE 'PASS a reporter files at most 20 reports per 24 hours (PR429)';
END $$;
RESET ROLE;
-- #endregion

ROLLBACK;
