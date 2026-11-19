-- =============================================================================================
-- Probe: function EXECUTE is deny-by-default in every app schema (00002500 "Function EXECUTE — deny
-- by default", 00002510 "Deny by default — every app schema"; SAC1, PRD-C6/C7/C9/C10), the
-- self-claim rule of projects.claim_ticket (00001120) and the pinned search_path of every
-- SECURITY DEFINER the migrations own.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. `deno task test:probes` passes
-- the PostgREST-exposed schemas from supabase/config.toml as `api_schemas`. By hand:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -v api_schemas=public,org,projects,… < supabase/probes/function_grants.sql
--
-- "App schemas" are never listed here, so the list cannot rot: they are the schemas config.toml
-- exposes (minus graphql_public) plus every schema holding a function the migration role owns.
-- "App functions" are every routine that role owns outside pg_catalog, minus extension members
-- (pg_depend deptype 'e'). Section 1 collects every violation before failing, so one run lists them
-- all. Every other expected refusal raises `FAIL …` and aborts. A clean run prints only PASS notices.
-- Fixtures are discovered from the seed (deno task db:reset); no ids are hard-coded.
-- =============================================================================================

\if :{?api_schemas}
\else
\set api_schemas ''
\endif

BEGIN;
SET LOCAL search_path = '';
SELECT pg_catalog.set_config('probe.api_schemas', :'api_schemas', true);

-- #region 0. What counts as the app (as postgres)
CREATE TEMP TABLE probe_exposed ON COMMIT DROP AS
SELECT n.oid AS nsp, n.nspname
FROM pg_catalog.unnest(pg_catalog.string_to_array(
        NULLIF(pg_catalog.current_setting('probe.api_schemas'), ''), ',')) AS s(name)
JOIN pg_catalog.pg_namespace n ON n.nspname = pg_catalog.btrim(s.name)
WHERE pg_catalog.btrim(s.name) <> 'graphql_public';

DO $$
DECLARE
    v_missing text[];
    v_owners  text[];
BEGIN
    SELECT pg_catalog.array_agg(pg_catalog.btrim(s.name)) INTO v_missing
    FROM pg_catalog.unnest(pg_catalog.string_to_array(
            NULLIF(pg_catalog.current_setting('probe.api_schemas'), ''), ',')) AS s(name)
    WHERE pg_catalog.btrim(s.name) <> 'graphql_public'
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname = pg_catalog.btrim(s.name));
    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL config.toml exposes schemas the database lacks: %', v_missing;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM probe_exposed) THEN
        RAISE NOTICE 'api_schemas not passed: the migration role is taken to be current_user (%)', current_user;
        PERFORM pg_catalog.set_config('probe.owner', current_user::regrole::oid::text, true);
        RETURN;
    END IF;

    -- The migration-owning role: the one owner of every app function in an exposed schema.
    SELECT pg_catalog.array_agg(DISTINCT p.proowner::regrole::text) INTO v_owners
    FROM pg_catalog.pg_proc p
    WHERE p.pronamespace IN (SELECT nsp FROM probe_exposed)
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
                        WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e');
    IF pg_catalog.cardinality(v_owners) <> 1 THEN
        RAISE EXCEPTION 'FAIL the exposed schemas hold non-extension functions of % owners: %',
            pg_catalog.cardinality(v_owners), v_owners;
    END IF;
    PERFORM pg_catalog.set_config('probe.owner', v_owners[1]::regrole::oid::text, true);
END $$;

CREATE TEMP TABLE probe_fn ON COMMIT DROP AS
SELECT p.oid, p.oid::regprocedure AS fn, n.nspname, p.proname, p.prosecdef, p.proconfig, p.prorettype,
    p.proacl, p.proowner, p.prosrc, p.pronargs, p.proargtypes, p.proargnames
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE p.proowner = pg_catalog.current_setting('probe.owner')::oid
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
                    WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e');

CREATE TEMP TABLE probe_schema ON COMMIT DROP AS
SELECT nsp FROM probe_exposed
UNION
SELECT DISTINCT p.pronamespace FROM pg_catalog.pg_proc p WHERE p.oid IN (SELECT oid FROM probe_fn);

-- The client roles a check is asked of. service_role holds everything and bypasses RLS.
CREATE TEMP TABLE probe_role ON COMMIT DROP AS
SELECT r.rolname, r.oid FROM pg_catalog.pg_roles r WHERE r.rolname IN ('anon', 'authenticated');
-- #endregion

-- #region 0b. The two reviewed lists
-- (b) Everything `anon` may execute, one reason per line. A guest-safe reader, a predicate an RLS
-- policy or a view runs as the guest, or a door that stamps auth.uid() itself.
CREATE TEMP TABLE probe_anon_allow (sig text PRIMARY KEY, reason text NOT NULL) ON COMMIT DROP;
INSERT INTO probe_anon_allow VALUES
    ('community.feedback_status_counts()',                    'INVOKER tab counts under the caller''s own policies'),
    ('community.submit_help_feedback(text,boolean,text)',     'help vote: stamps auth.uid() itself, rate-limited'),
    ('files.fn_folder_in_library(uuid,files.owner_kind,uuid,uuid)', 'called inside the files write guards, which run as the client'),
    ('files.fn_library_archived(files.owner_kind,uuid)',      'called inside the files write guards, which run as the client'),
    ('files.fn_owns_library(files.owner_kind,uuid)',          'the files items/folders INSERT and UPDATE policy predicate'),
    ('files.fn_resolve_share(text)',                          'a share slug is the credential; a guest holding one is the case'),
    ('files.fn_storage_object_withheld(text,text)',           'the workspace storage policy''s withheld-object check'),
    ('files.get_public_media(uuid[])',                        'public profile media, already public'),
    ('ops.submit_contact_request(text,text,boolean,jsonb,uuid[])', '/contact intake: a guest may write to the platform'),
    ('org.fn_age_years(date,text)',                           'org.profiles_index masks a minor''s location with it; pure'),
    ('org.fn_today_in(text)',                                 'org.profiles_index helper; pure'),
    ('org.fn_valid_time_zone(text)',                          'org.profiles_index helper; pure'),
    ('org.fn_profile_visible(text,uuid)',                     'the SELECT policy of the profile detail tables'),
    ('org.get_profile_cards(text[],uuid[])',                  'follower cards; drops every profile the caller may not see'),
    ('org.get_profile_experience(text)',                      'public profile read'),
    ('org.get_profile_owner(text)',                           'public profile read'),
    ('org.get_profile_past_projects(text)',                   'public profile read'),
    ('org.get_profile_portfolio(text)',                       'public profile read'),
    ('org.get_profile_reviews(text,integer)',                 'public profile read'),
    ('org.get_profile_roster(text)',                          'public profile read'),
    ('org.get_profile_view(text)',                            'public profile read: a guest reads it as a member does'),
    ('org.is_active_business_member(uuid)',                   'RLS predicate about auth.uid() (org, projects, comms, files)'),
    ('org.is_active_team_member(uuid)',                       'RLS predicate about auth.uid() (org, projects, comms, files)'),
    ('org.is_enterprise_member(uuid,org.enterprise_role)',    'RLS predicate about auth.uid()'),
    ('projects.can_edit_project_details(uuid)',               'RLS predicate about auth.uid()'),
    ('projects.can_manage_project_members(uuid)',             'RLS predicate about auth.uid()'),
    ('projects.can_review_project(uuid)',                     'RLS predicate about auth.uid()'),
    ('projects.get_cohort_offer(uuid)',                       'a listing''s public seat count and curriculum (entity view)'),
    ('projects.has_project_access(uuid)',                     'RLS predicate about auth.uid() (projects, storage, scheduling)'),
    ('projects.has_stage_access(uuid)',                       'RLS predicate about auth.uid()'),
    ('projects.is_cohort_member(uuid)',                       'RLS predicate about auth.uid()'),
    ('projects.is_ticket_manager(uuid)',                      'RLS predicate about auth.uid()'),
    ('scheduling.fn_can_view_schedule(uuid)',                 'SELECT policy of availability_rules and call_platforms (anon)'),
    ('scheduling.fn_local_minute_of_day(timestamp with time zone,text)', 'booking-engine time helper; pure'),
    ('scheduling.fn_local_weekday(timestamp with time zone,text)', 'booking-engine time helper; pure'),
    ('scheduling.fn_owner_visible(scheduling.owner_type,uuid)', 'SELECT policy of scheduling.schedules (anon); about auth.uid()'),
    ('scheduling.fn_preset_for_blueprint(uuid)',              'a published service''s booking preset'),
    ('scheduling.fn_resolved_slot_fee(uuid,timestamp with time zone)', 'a published schedule''s call fee (Decision #408)'),
    ('scheduling.fn_schedule_is_public(uuid)',                'whether a schedule is published'),
    ('scheduling.get_free_busy(uuid,timestamp with time zone,timestamp with time zone)', 'public booking calendar: free/busy of a published schedule'),
    ('scheduling.get_public_blackouts(uuid,timestamp with time zone,timestamp with time zone)', 'public booking calendar: published blackouts'),
    ('search.fn_log_query',                                   'guest /explore search telemetry; logs only as auth.uid() (#462)'),
    ('search.fn_nearest(public.vector,text[],uuid[],integer)', 'explore: ids and scores over public index rows'),
    ('search.fn_nearest_to_entity(text,uuid,text[],uuid[],integer)', 'explore: ids and scores over public index rows'),
    ('search.ranking_weights()',                              'the guest catalogue''s ranking coefficients'),
    ('search.trending_entities(integer,integer)',             'k-anonymous trending aggregates for the guest catalogue'),
    ('security.is_admin()',                                   'about auth.uid() only; storage, scheduling and search policies');

-- (d) Every SECURITY DEFINER that takes a user or actor uuid and that `authenticated` may execute
-- (the PRD-C9 class). Each was read (SAC1, 2026-11-18): it ignores the argument for auth.uid()
-- (caller), checks the caller's authority over it (authorised), answers only about auth.uid()'s own
-- tie to it (predicate), or returns data already public (public). A line with an `open_row` is a known
-- hole that row tracks; the probe names it on every run until the fix deletes the line.
CREATE TEMP TABLE probe_actor_reviewed (sig text PRIMARY KEY, reason text NOT NULL, open_row text) ON COMMIT DROP;
INSERT INTO probe_actor_reviewed VALUES
    ('analytics.fn_subject_visible(analytics.subject_kind,uuid)', 'predicate: admin, self, member or listing manager', NULL),
    ('comms.add_dm_thread_members(uuid,uuid[])',             'authorised: a participant; never into a pair''s inquiry or a channel (#482)', NULL),
    ('comms.create_group_thread(text,uuid[])',               'caller: the creator is auth.uid(); members are recipients', NULL),
    ('comms.get_or_create_dm_thread(uuid,uuid)',             'caller: the pair is (auth.uid(), target)', NULL),
    ('comms.send_request_message(uuid,text,uuid)',           'authorised: the other side of the caller''s pending invitation or application', NULL),
    ('files.get_storage_quota(files.owner_kind,uuid)',       'authorised: self, or an entity the caller belongs to', NULL),
    ('finance.ensure_purchase_wallet(text,uuid,text)',       'authorised: own wallet, or spend on the entity''s', NULL),
    ('finance.fn_can_manage_basket(text,uuid)',              'predicate: admin, self or spend capability', NULL),
    ('finance.fn_owner_capability(text,uuid,finance.vault_capability)', 'predicate: the caller''s own vault capability', NULL),
    ('finance.fn_owner_visible(text,uuid)',                  'predicate: admin, self or an active member', NULL),
    ('finance.fn_subject_standing_level(text,uuid)',         'public: a seller''s Standing rung', NULL),
    ('finance.get_purchase_owner(text,uuid)',                'public: an active public or unlisted entity''s face; the rest to members (#481)', NULL),
    ('finance.get_seller_commission(text,uuid)',             'authorised: fn_owner_visible or 42501', NULL),
    ('finance.quote_fx_conversion(text,uuid,text,text,bigint,text,text,uuid)', 'authorised: the basket''s spender or the project''s payer', NULL),
    ('finance.save_payout_schedule(text,uuid,text,finance.payout_mode,bigint,uuid,boolean)', 'authorised: own wallet, or withdraw on the entity''s', NULL),
    ('finance.save_split_rule(uuid,finance.split_rule_type,integer,uuid,integer)', 'authorised: manage_finances; the finder is an active member', NULL),
    ('finance.set_invoicing_terms(text,uuid,text,integer)',  'authorised: manage_billing on the business', NULL),
    ('marketplace.get_quotes_with(uuid)',                    'caller: only quotes between auth.uid() and the counterpart', NULL),
    ('org.archive_portfolio_piece(text,uuid,uuid)',          'authorised: fn_profile_manages', NULL),
    ('org.can_manage_profile(text,uuid)',                    'predicate: may auth.uid() edit this profile', NULL),
    ('org.fn_compute_profile_setup_progress(uuid)',          'caller: raises unless the id is auth.uid()', NULL),
    ('org.fn_profile_visible(text,uuid)',                    'predicate: a public or unlisted profile, or the caller''s own tie', NULL),
    ('org.fn_standing_level(org.standing_subject,uuid)',     'public: a seller''s Standing rung', NULL),
    ('org.get_party_cards(uuid[])',                          'authorised: a visible person, or one sharing a context with the caller (fn_party_visible, #481)', NULL),
    ('org.save_portfolio_piece(text,uuid,jsonb)',            'authorised: fn_profile_manages', NULL),
    ('org.save_profile(text,uuid,jsonb)',                    'authorised: fn_profile_manages', NULL),
    ('org.save_showcase(text,uuid,jsonb)',                   'authorised: fn_profile_manages', NULL),
    ('org.set_profile_avatar(text,uuid,uuid)',               'authorised: fn_profile_manages', NULL),
    ('org.transfer_workspace_ownership(text,uuid,uuid,boolean)', 'authorised: only the owner, to an active member', NULL),
    ('org.update_workspace_member(text,uuid,jsonb)',         'authorised: manage_roles and a higher rank', NULL),
    ('projects.assign_ticket_manual(uuid,uuid)',             'authorised: review authority, to a live seat holder', NULL),
    ('projects.claim_ticket(uuid,uuid)',                     'caller: the assignee must be auth.uid()', NULL),
    ('projects.get_engagement_context(uuid)',                'caller: only rows between auth.uid() and the counterpart', NULL),
    ('projects.invite_to_project(uuid,uuid,uuid,text,text,bigint,jsonb)', 'authorised: can_manage_project_members', NULL),
    ('projects.record_host_attendance(uuid,uuid)',           'authorised: only the session host', NULL),
    ('scheduling.fn_detect_event_clashes(uuid,timestamp with time zone,timestamp with time zone,uuid)', 'caller: raises unless the id is auth.uid()', NULL),
    ('scheduling.fn_owner_manages(scheduling.owner_type,uuid)', 'predicate: does auth.uid() manage the owner', NULL),
    ('scheduling.fn_owner_visible(scheduling.owner_type,uuid)', 'predicate: does auth.uid() own or share the schedule', NULL),
    ('scheduling.invite_to_event(uuid,uuid[],text[])',       'authorised: fn_can_manage_schedule on the event', NULL),
    ('scheduling.withdraw_invitation(uuid,uuid)',            'authorised: fn_can_manage_schedule on the event', NULL);

-- The argument names that mean "a person or an owner". Matched on the argument name, uuid or uuid[].
CREATE TEMP TABLE probe_actor_arg (pattern text) ON COMMIT DROP;
INSERT INTO probe_actor_arg VALUES (
    '^_?(p_)?(target_|finder_)?(user|users|user_ids?|actor|actor_id|members?|member_ids?|recipient|'
    'recipient_id|requester|requester_id|attendee|attendee_id|counterpart|counterpart_id|successor|'
    'successor_id|assignee|assignee_id|invitee|invitee_id|owner|owner_id|viewer|viewer_id|caller|'
    'caller_id|profile|profile_id|person|person_id|subject|subject_id|uid|by|by_id)$');
-- #endregion

-- #region 1. Catalog assertions (as postgres)
DO $$
DECLARE
    v_fail text[] := '{}';
    r      record;
BEGIN
    -- Named expectations: the provisioning routine, the claim core and the C6 / C9 readers are
    -- reachable by no client role; the doors are signed-in only.
    FOR r IN
        SELECT * FROM (VALUES
            ('anon',          'public.provision_user_profile(uuid,text,timestamp with time zone,jsonb)', false),
            ('authenticated', 'public.provision_user_profile(uuid,text,timestamp with time zone,jsonb)', false),
            ('anon',          'public.complete_onboarding(jsonb)', false),
            ('authenticated', 'public.complete_onboarding(jsonb)', true),
            ('anon',          'public.handle_new_user()', false),
            ('authenticated', 'public.handle_new_user()', false),
            ('anon',          'public.handle_email_confirmed()', false),
            ('authenticated', 'public.handle_email_confirmed()', false),
            ('anon',          'projects.claim_ticket(uuid,uuid)', false),
            ('authenticated', 'projects.claim_ticket(uuid,uuid)', true),
            ('anon',          'projects.fn_assign_ticket_core(uuid,uuid,boolean)', false),
            ('authenticated', 'projects.fn_assign_ticket_core(uuid,uuid,boolean)', false),
            ('anon',          'projects.assign_ticket_manual(uuid,uuid)', false),
            ('authenticated', 'projects.assign_ticket_manual(uuid,uuid)', true),
            ('authenticated', 'projects.check_ticket_capacity(uuid,uuid)', false),
            ('anon',          'projects.move_ticket(uuid,public.ticket_status,uuid,integer,timestamp with time zone,boolean)', false),
            ('authenticated', 'projects.move_ticket(uuid,public.ticket_status,uuid,integer,timestamp with time zone,boolean)', true),
            ('anon',          'projects.fund_stage(uuid,uuid)', false),
            ('authenticated', 'projects.fund_stage(uuid,uuid)', true),
            ('service_role',  'projects.claim_ticket(uuid,uuid)', true),
            -- The doors whose grants once sat beside their functions in 00001100 / 00001130.
            ('authenticated', 'projects.create_project(jsonb)', true),
            ('authenticated', 'projects.respond_to_project_invitation(uuid,boolean)', true),
            -- RLS predicates: a policy expression runs as the invoking role.
            ('anon',          'projects.has_project_access(uuid)', true),
            ('authenticated', 'projects.has_project_access(uuid)', true),
            ('anon',          'projects.can_review_project(uuid)', true),
            ('authenticated', 'projects.can_manage_project_members(uuid)', true),
            ('authenticated', 'projects.has_stage_access(uuid)', true),
            ('authenticated', 'projects.is_cohort_member(uuid)', true),
            ('authenticated', 'files.fn_can_read(uuid)', true),
            -- The guest offer read stays public.
            ('anon',          'projects.get_cohort_offer(uuid)', true),
            -- PRD-C6: whether a uuid is an admin is nobody's business but the operator console's.
            ('anon',          'search.is_admin(uuid)', false),
            ('authenticated', 'search.is_admin(uuid)', false),
            ('service_role',  'search.is_admin(uuid)', true),
            ('anon',          'security.is_admin()', true),
            -- PRD-C9: a stranger's connected providers.
            ('anon',          'integrations.fn_has_capability(uuid,integrations.provider_kind)', false),
            ('authenticated', 'integrations.fn_has_capability(uuid,integrations.provider_kind)', false),
            ('anon',          'integrations.fn_conferencing_provider(uuid)', false),
            ('authenticated', 'integrations.fn_conferencing_provider(uuid)', false),
            -- Extension members in `public` keep their grants (pgvector ops back the search doors).
            ('anon',          'public.cosine_distance(public.vector,public.vector)', true),
            ('authenticated', 'public.similarity(text,text)', true)
        ) AS t(role_name, fn, expected)
    LOOP
        IF pg_catalog.to_regprocedure(r.fn) IS NULL THEN
            v_fail := v_fail || pg_catalog.format('named expectation lists a missing function %s', r.fn);
        ELSIF pg_catalog.has_function_privilege(r.role_name, pg_catalog.to_regprocedure(r.fn), 'EXECUTE') <> r.expected THEN
            v_fail := v_fail || pg_catalog.format('%s %s EXECUTE on %s', r.role_name,
                CASE WHEN r.expected THEN 'lacks' ELSE 'holds' END, r.fn);
        END IF;
    END LOOP;

    -- (a) PUBLIC holds EXECUTE on no app function, in any schema.
    FOR r IN
        SELECT f.fn FROM probe_fn f
        WHERE EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
                      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
        ORDER BY 1
    LOOP
        v_fail := v_fail || pg_catalog.format('(a) PUBLIC holds EXECUTE on %s', r.fn);
    END LOOP;

    -- (b) anon executes exactly the allowlist: nothing outside it, and no stale line in it.
    FOR r IN
        SELECT f.fn FROM probe_fn f
        WHERE pg_catalog.has_function_privilege('anon', f.oid, 'EXECUTE')
            AND NOT EXISTS (SELECT 1 FROM probe_anon_allow a
                            WHERE pg_catalog.to_regprocedure(a.sig) = f.oid
                                OR a.sig = f.nspname || '.' || f.proname)
        ORDER BY 1
    LOOP
        v_fail := v_fail || pg_catalog.format('(b) anon holds EXECUTE on %s, which the allowlist does not name', r.fn);
    END LOOP;
    -- A line names one signature, or (no argument list) every overload of a name.
    FOR r IN
        SELECT a.sig FROM probe_anon_allow a
        WHERE NOT EXISTS (SELECT 1 FROM probe_fn f
                          WHERE (pg_catalog.to_regprocedure(a.sig) = f.oid OR a.sig = f.nspname || '.' || f.proname)
                              AND pg_catalog.has_function_privilege('anon', f.oid, 'EXECUTE'))
        ORDER BY 1
    LOOP
        v_fail := v_fail || pg_catalog.format('(b) stale allowlist line: anon cannot execute %s (or it does not exist)', r.sig);
    END LOOP;

    -- (c) Every SECURITY DEFINER pins its search_path (PRD-C2, across every schema).
    FOR r IN
        SELECT f.fn FROM probe_fn f
        WHERE f.prosecdef
            AND NOT EXISTS (SELECT 1 FROM pg_catalog.unnest(f.proconfig) c WHERE c LIKE 'search_path=%')
        ORDER BY 1
    LOOP
        v_fail := v_fail || pg_catalog.format('(c) SECURITY DEFINER without SET search_path: %s', r.fn);
    END LOOP;

    -- (d) A definer `authenticated` may call with somebody else's id is on the reviewed list.
    FOR r IN
        SELECT f.fn, pg_catalog.string_agg(a.argname, ',') AS args
        FROM probe_fn f
        -- Multi-argument unnest is FROM-clause syntax, not a pg_catalog function, so it stays unqualified.
        CROSS JOIN LATERAL unnest(f.proargtypes::oid[], f.proargnames[1:f.pronargs]) AS a(argtype, argname)
        WHERE f.prosecdef
            AND pg_catalog.has_function_privilege('authenticated', f.oid, 'EXECUTE')
            AND a.argtype IN ('uuid'::regtype, 'uuid[]'::regtype)
            AND a.argname ~ (SELECT pattern FROM probe_actor_arg)
            AND f.oid NOT IN (SELECT pg_catalog.to_regprocedure(v.sig)::oid FROM probe_actor_reviewed v
                              WHERE pg_catalog.to_regprocedure(v.sig) IS NOT NULL)
        GROUP BY f.fn
        ORDER BY 1
    LOOP
        v_fail := v_fail || pg_catalog.format(
            '(d) %s takes a person (%s), runs as its owner and is executable by authenticated, but is not on the reviewed list',
            r.fn, r.args);
    END LOOP;
    FOR r IN
        SELECT v.sig FROM probe_actor_reviewed v
        WHERE pg_catalog.to_regprocedure(v.sig) IS NULL
            OR NOT pg_catalog.has_function_privilege('authenticated', pg_catalog.to_regprocedure(v.sig), 'EXECUTE')
        ORDER BY 1
    LOOP
        v_fail := v_fail || pg_catalog.format('(d) stale reviewed line: authenticated cannot execute %s (or it does not exist)', r.sig);
    END LOOP;

    -- (e) A function an RLS policy, a column default or generated column, a CHECK or a view runs is
    -- executable by every client role that policy or grant serves; otherwise the deny-by-default
    -- revoke turns a read or a write into 42501.
    FOR r IN
        SELECT DISTINCT f.fn, pol.polrelid::regclass AS rel, pol.polname, ro.rolname
        FROM pg_catalog.pg_policy pol
        JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid AND c.relrowsecurity
        JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_policy'::regclass AND d.objid = pol.oid
            AND d.refclassid = 'pg_catalog.pg_proc'::regclass
        JOIN probe_fn f ON f.oid = d.refobjid
        CROSS JOIN probe_role ro
        WHERE (0 = ANY (pol.polroles) OR ro.oid = ANY (pol.polroles))
            AND CASE pol.polcmd
                WHEN 'r' THEN pg_catalog.has_any_column_privilege(ro.rolname, pol.polrelid, 'SELECT')
                WHEN 'a' THEN pg_catalog.has_any_column_privilege(ro.rolname, pol.polrelid, 'INSERT')
                WHEN 'w' THEN pg_catalog.has_any_column_privilege(ro.rolname, pol.polrelid, 'UPDATE')
                WHEN 'd' THEN pg_catalog.has_table_privilege(ro.rolname, pol.polrelid, 'DELETE')
                ELSE pg_catalog.has_any_column_privilege(ro.rolname, pol.polrelid, 'SELECT')
                    OR pg_catalog.has_any_column_privilege(ro.rolname, pol.polrelid, 'INSERT')
                    OR pg_catalog.has_any_column_privilege(ro.rolname, pol.polrelid, 'UPDATE')
                    OR pg_catalog.has_table_privilege(ro.rolname, pol.polrelid, 'DELETE')
                END
            AND NOT pg_catalog.has_function_privilege(ro.rolname, f.oid, 'EXECUTE')
        ORDER BY 1, 2
    LOOP
        v_fail := v_fail || pg_catalog.format('(e) policy "%s" on %s runs %s, which %s cannot execute',
            r.polname, r.rel, r.fn, r.rolname);
    END LOOP;

    FOR r IN
        SELECT DISTINCT f.fn, ad.adrelid::regclass AS rel, a.attname, ro.rolname
        FROM pg_catalog.pg_attrdef ad
        JOIN pg_catalog.pg_attribute a ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
        JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_attrdef'::regclass AND d.objid = ad.oid
            AND d.refclassid = 'pg_catalog.pg_proc'::regclass
        JOIN probe_fn f ON f.oid = d.refobjid
        CROSS JOIN probe_role ro
        WHERE (pg_catalog.has_any_column_privilege(ro.rolname, ad.adrelid, 'INSERT')
               OR (a.attgenerated <> '' AND pg_catalog.has_any_column_privilege(ro.rolname, ad.adrelid, 'UPDATE')))
            AND NOT pg_catalog.has_function_privilege(ro.rolname, f.oid, 'EXECUTE')
        ORDER BY 1, 2
    LOOP
        v_fail := v_fail || pg_catalog.format('(e) the default of %s.%s runs %s, which %s (a writer) cannot execute',
            r.rel, r.attname, r.fn, r.rolname);
    END LOOP;

    FOR r IN
        SELECT DISTINCT f.fn, con.conname, COALESCE(con.conrelid::regclass::text, con.contypid::regtype::text) AS owner_obj,
            ro.rolname
        FROM pg_catalog.pg_constraint con
        JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_constraint'::regclass AND d.objid = con.oid
            AND d.refclassid = 'pg_catalog.pg_proc'::regclass
        JOIN probe_fn f ON f.oid = d.refobjid
        CROSS JOIN probe_role ro
        WHERE con.contype = 'c'
            AND (
                (con.conrelid <> 0
                 AND (pg_catalog.has_any_column_privilege(ro.rolname, con.conrelid, 'INSERT')
                      OR pg_catalog.has_any_column_privilege(ro.rolname, con.conrelid, 'UPDATE')))
                OR (con.contypid <> 0 AND EXISTS (
                    SELECT 1 FROM pg_catalog.pg_attribute att
                    WHERE att.atttypid = con.contypid AND att.attnum > 0 AND NOT att.attisdropped
                        AND (pg_catalog.has_any_column_privilege(ro.rolname, att.attrelid, 'INSERT')
                             OR pg_catalog.has_any_column_privilege(ro.rolname, att.attrelid, 'UPDATE'))))
            )
            AND NOT pg_catalog.has_function_privilege(ro.rolname, f.oid, 'EXECUTE')
        ORDER BY 1, 2
    LOOP
        v_fail := v_fail || pg_catalog.format('(e) CHECK %s on %s runs %s, which %s (a writer) cannot execute',
            r.conname, r.owner_obj, r.fn, r.rolname);
    END LOOP;

    -- A view's function calls are checked against the role reading the view, owner or not.
    FOR r IN
        SELECT DISTINCT f.fn, rw.ev_class::regclass AS rel, ro.rolname
        FROM pg_catalog.pg_rewrite rw
        JOIN pg_catalog.pg_class c ON c.oid = rw.ev_class AND c.relkind = 'v'
        JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_rewrite'::regclass AND d.objid = rw.oid
            AND d.refclassid = 'pg_catalog.pg_proc'::regclass
        JOIN probe_fn f ON f.oid = d.refobjid
        CROSS JOIN probe_role ro
        WHERE pg_catalog.has_any_column_privilege(ro.rolname, rw.ev_class, 'SELECT')
            AND NOT pg_catalog.has_function_privilege(ro.rolname, f.oid, 'EXECUTE')
        ORDER BY 1, 2
    LOOP
        v_fail := v_fail || pg_catalog.format('(e) view %s runs %s, which %s (a reader) cannot execute',
            r.rel, r.fn, r.rolname);
    END LOOP;

    -- A SECURITY INVOKER function runs its calls as its caller, and an INVOKER trigger function as
    -- the writer. pg_depend records neither for plpgsql, so the body is read: every schema-qualified
    -- call to an app function (comments stripped) must be executable by every client role that can
    -- reach the caller.
    FOR r IN
        WITH reach AS (
            SELECT f.oid, ro.rolname, 'a call' AS via
            FROM probe_fn f CROSS JOIN probe_role ro
            WHERE NOT f.prosecdef AND f.prorettype <> 'trigger'::regtype
                AND pg_catalog.has_function_privilege(ro.rolname, f.oid, 'EXECUTE')
            UNION
            SELECT f.oid, ro.rolname, 'a write to ' || t.tgrelid::regclass::text
            FROM probe_fn f
            JOIN pg_catalog.pg_trigger t ON t.tgfoid = f.oid AND NOT t.tgisinternal
            CROSS JOIN probe_role ro
            WHERE NOT f.prosecdef
                AND (pg_catalog.has_any_column_privilege(ro.rolname, t.tgrelid, 'INSERT')
                     OR pg_catalog.has_any_column_privilege(ro.rolname, t.tgrelid, 'UPDATE')
                     OR pg_catalog.has_table_privilege(ro.rolname, t.tgrelid, 'DELETE'))
        )
        , calls AS (
            -- Every `schema.name(` in each reachable body, read once.
            SELECT DISTINCT f.oid, pg_catalog.lower(m[1]) AS nsp, pg_catalog.lower(m[2]) AS name
            FROM probe_fn f
            CROSS JOIN LATERAL pg_catalog.regexp_matches(
                pg_catalog.regexp_replace(f.prosrc, '--[^\n]*', '', 'g'),
                '\m([a-z_][a-z0-9_]*)\s*\.\s*([a-z_][a-z0-9_]*)\s*\(', 'gi') AS m
            WHERE f.oid IN (SELECT oid FROM reach)
        )
        SELECT DISTINCT ca.fn AS caller, x.via, x.rolname AS ro_name, c.nsp || '.' || c.name AS callee
        FROM reach x
        JOIN probe_fn ca ON ca.oid = x.oid
        JOIN calls c ON c.oid = x.oid
        WHERE EXISTS (SELECT 1 FROM probe_fn ce WHERE ce.nspname = c.nsp AND ce.proname = c.name AND ce.oid <> ca.oid)
            AND NOT EXISTS (SELECT 1 FROM probe_fn ce
                            WHERE ce.nspname = c.nsp AND ce.proname = c.name
                                AND pg_catalog.has_function_privilege(x.rolname, ce.oid, 'EXECUTE'))
        ORDER BY 1, 4
    LOOP
        v_fail := v_fail || pg_catalog.format('(e) INVOKER %s calls %s, which %s (reaching it through %s) cannot execute',
            r.caller, r.callee, r.ro_name, r.via);
    END LOOP;

    -- (f) No default privilege hands EXECUTE to a client role: the migration role's global default
    -- revokes PUBLIC, and none of its per-schema defaults in an app schema grants PUBLIC, anon or
    -- authenticated. (supabase_admin's own defaults cover only the extension members it creates.)
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_default_acl da
        WHERE da.defaclrole = pg_catalog.current_setting('probe.owner')::oid
            AND da.defaclnamespace = 0 AND da.defaclobjtype = 'f'
            AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(da.defaclacl) a
                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    ) THEN
        v_fail := v_fail || pg_catalog.format(
            '(f) %s''s global default privileges still give EXECUTE on new functions to PUBLIC',
            pg_catalog.current_setting('probe.owner')::oid::regrole);
    END IF;
    FOR r IN
        SELECT da.defaclnamespace::regnamespace AS nsp, a.grantee
        FROM pg_catalog.pg_default_acl da
        CROSS JOIN LATERAL pg_catalog.aclexplode(da.defaclacl) a
        WHERE da.defaclrole = pg_catalog.current_setting('probe.owner')::oid
            AND da.defaclobjtype = 'f'
            AND da.defaclnamespace IN (SELECT nsp FROM probe_schema)
            AND a.privilege_type = 'EXECUTE'
            AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM probe_role))
        ORDER BY 1
    LOOP
        v_fail := v_fail || pg_catalog.format('(f) default privileges in %s give EXECUTE on new functions to %s',
            r.nsp, CASE WHEN r.grantee = 0 THEN 'PUBLIC' ELSE r.grantee::regrole::text END);
    END LOOP;

    IF pg_catalog.cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'FAIL % grant violation(s):%', pg_catalog.cardinality(v_fail),
            E'\n  ' || pg_catalog.array_to_string(v_fail, E'\n  ');
    END IF;
    FOR r IN SELECT v.open_row, v.sig, v.reason FROM probe_actor_reviewed v WHERE v.open_row IS NOT NULL ORDER BY 1 LOOP
        RAISE NOTICE 'OPEN % %: %', r.open_row, r.sig, r.reason;
    END LOOP;
    RAISE NOTICE 'PASS catalog: % app functions in % schemas; deny by default, % anon doors, % reviewed actor doors, every dependency executable',
        (SELECT pg_catalog.count(*) FROM probe_fn), (SELECT pg_catalog.count(*) FROM probe_schema),
        (SELECT pg_catalog.count(*) FROM probe_anon_allow), (SELECT pg_catalog.count(*) FROM probe_actor_reviewed);
END $$;
-- #endregion

-- #region 1b. A function created after the chain starts closed, in every app schema
DO $$
DECLARE
    v_nsp  regnamespace;
    v_fn   regprocedure;
    v_fail text[] := '{}';
BEGIN
    IF current_user::regrole::oid <> pg_catalog.current_setting('probe.owner')::oid THEN
        RAISE EXCEPTION 'FAIL run me as the migration role (%), not %',
            pg_catalog.current_setting('probe.owner')::oid::regrole, current_user;
    END IF;
    FOR v_nsp IN SELECT nsp::regnamespace FROM probe_schema ORDER BY 1 LOOP
        EXECUTE pg_catalog.format('CREATE FUNCTION %s.probe_sac1_future() RETURNS integer LANGUAGE sql AS ''SELECT 1''', v_nsp);
        v_fn := pg_catalog.format('%s.probe_sac1_future()', v_nsp)::regprocedure;
        IF pg_catalog.has_function_privilege('public', v_fn, 'EXECUTE')
            OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
            OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
            v_fail := v_fail || pg_catalog.format('%s is executable by a client role the moment it exists', v_fn);
        END IF;
    END LOOP;
    IF pg_catalog.cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'FAIL %', pg_catalog.array_to_string(v_fail, '; ');
    END IF;
    RAISE NOTICE 'PASS a new function in each of % app schemas is executable by no client role', (SELECT pg_catalog.count(*) FROM probe_schema);
END $$;
-- #endregion

-- #region 2. Fixtures (as postgres)
-- An unclaimed, described ticket on a self-claim (open_pull) stage, a freelancer participant of its
-- project with no review authority, another person to claim on behalf of, and an outsider.
DO $$
DECLARE
    c  record;
    v_other    uuid;
    v_outsider uuid;
BEGIN
    FOR c IN
        SELECT t.id AS ticket, t.project_id AS project, pp.profile_id AS freelancer
        FROM projects.tickets t
        LEFT JOIN projects.project_stages s ON s.id = t.current_stage_id
        JOIN projects.project_participants pp
            ON pp.project_id = t.project_id AND pp.profile_type = 'freelancer'
        WHERE t.current_assignee_id IS NULL
            AND t.description IS DISTINCT FROM '{}'::jsonb
            AND COALESCE(s.assignment_mode::text, 'open_pull') = 'open_pull'
        ORDER BY t.id, pp.profile_id
    LOOP
        PERFORM pg_catalog.set_config('request.jwt.claims',
            pg_catalog.json_build_object('sub', c.freelancer, 'role', 'authenticated')::text, true);
        CONTINUE WHEN NOT projects.has_project_access(c.project) OR projects.can_review_project(c.project);

        SELECT u.user_id INTO v_other FROM org.users_public u
        WHERE u.user_id <> c.freelancer ORDER BY u.user_id LIMIT 1;

        v_outsider := NULL;
        FOR v_outsider IN
            SELECT fp.user_id FROM org.freelancer_profiles fp
            WHERE fp.user_id NOT IN (c.freelancer, v_other) ORDER BY fp.user_id
        LOOP
            PERFORM pg_catalog.set_config('request.jwt.claims',
                pg_catalog.json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
            EXIT WHEN NOT projects.has_project_access(c.project);
            v_outsider := NULL;
        END LOOP;
        CONTINUE WHEN v_other IS NULL OR v_outsider IS NULL;

        PERFORM pg_catalog.set_config('probe.ticket', c.ticket::text, true);
        PERFORM pg_catalog.set_config('probe.project', c.project::text, true);
        PERFORM pg_catalog.set_config('probe.freelancer', c.freelancer::text, true);
        PERFORM pg_catalog.set_config('probe.other', v_other::text, true);
        PERFORM pg_catalog.set_config('probe.outsider', v_outsider::text, true);
        PERFORM pg_catalog.set_config('request.jwt.claims', '', true);
        RAISE NOTICE 'fixture ticket=% project=% freelancer=% other=% outsider=%',
            c.ticket, c.project, c.freelancer, v_other, v_outsider;
        RETURN;
    END LOOP;
    RAISE EXCEPTION 'FAIL no fixture: need an unclaimed open_pull ticket with a freelancer participant (deno task db:reset)';
END $$;
-- #endregion

-- #region 3. anon — refused by the grant before any body runs
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
DECLARE
    v_sql text;
BEGIN
    FOREACH v_sql IN ARRAY ARRAY[
        pg_catalog.format('SELECT public.provision_user_profile(%L, ''probe@example.invalid'', NULL, ''{"username":"probe","dob":"1900-01-01"}''::jsonb)',
            pg_catalog.gen_random_uuid()),
        pg_catalog.format('SELECT projects.claim_ticket(%L, %L)', pg_catalog.current_setting('probe.ticket'), pg_catalog.current_setting('probe.freelancer')),
        pg_catalog.format('SELECT projects.fn_assign_ticket_core(%L, %L, false)', pg_catalog.current_setting('probe.ticket'), pg_catalog.current_setting('probe.freelancer')),
        -- PRD-C6: a guest cannot test whether a uuid is an admin.
        pg_catalog.format('SELECT search.is_admin(%L)', pg_catalog.current_setting('probe.freelancer')),
        pg_catalog.format('SELECT integrations.fn_has_capability(%L, ''conferencing'')', pg_catalog.current_setting('probe.freelancer'))
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL anon executed: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS anon refused [%]: %', SQLERRM, left(v_sql, 60);
        END;
    END LOOP;
END $$;

-- The weights policy asks security.is_admin(), so a guest's read is empty, not a 42501.
DO $$
DECLARE
    v_rows bigint;
BEGIN
    SELECT pg_catalog.count(*) INTO v_rows FROM search.search_weights;
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'FAIL a guest read % search_weights rows', v_rows;
    END IF;
    RAISE NOTICE 'PASS a guest reads search.search_weights as an empty set';
END $$;
RESET ROLE;
-- #endregion

-- #region 4. authenticated — the claim core and provisioning are unreachable; claim_ticket is self-only
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', pg_catalog.current_setting('probe.freelancer'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_sql text;
BEGIN
    FOREACH v_sql IN ARRAY ARRAY[
        pg_catalog.format('SELECT public.provision_user_profile(%L, ''probe@example.invalid'', NULL, ''{"username":"probe","dob":"1900-01-01"}''::jsonb)',
            pg_catalog.gen_random_uuid()),
        pg_catalog.format('SELECT projects.fn_assign_ticket_core(%L, %L, false)', pg_catalog.current_setting('probe.ticket'), pg_catalog.current_setting('probe.other')),
        -- A participant attaching somebody else: the escrow hold must never fire.
        pg_catalog.format('SELECT projects.claim_ticket(%L, %L)', pg_catalog.current_setting('probe.ticket'), pg_catalog.current_setting('probe.other')),
        -- PRD-C6 and PRD-C9: a signed-in stranger learns neither another person's admin bit nor
        -- their connected providers.
        pg_catalog.format('SELECT search.is_admin(%L)', pg_catalog.current_setting('probe.other')),
        pg_catalog.format('SELECT integrations.fn_has_capability(%L, ''conferencing'')', pg_catalog.current_setting('probe.other')),
        pg_catalog.format('SELECT integrations.fn_conferencing_provider(%L)', pg_catalog.current_setting('probe.other'))
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL participant executed: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS participant refused [%]: %', SQLERRM, left(v_sql, 60);
        END;
    END LOOP;
END $$;

SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated"}', true);
DO $$
BEGIN
    PERFORM projects.claim_ticket(pg_catalog.current_setting('probe.ticket')::uuid, pg_catalog.current_setting('probe.freelancer')::uuid);
    RAISE EXCEPTION 'FAIL subject-less caller claimed';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS no-subject refused [%]', SQLERRM;
END $$;

SELECT pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', pg_catalog.current_setting('probe.outsider'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    PERFORM projects.claim_ticket(pg_catalog.current_setting('probe.ticket')::uuid, pg_catalog.current_setting('probe.outsider')::uuid);
    RAISE EXCEPTION 'FAIL outsider self-claimed a ticket on a project they cannot access';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS outsider refused [%]', SQLERRM;
END $$;

-- The participant's own claim clears the authority gate. Capacity or funding may still refuse it
-- further in; only a 42501 would mean the self-claim rule is too tight.
SELECT pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', pg_catalog.current_setting('probe.freelancer'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_escrow uuid;
BEGIN
    v_escrow := projects.claim_ticket(pg_catalog.current_setting('probe.ticket')::uuid, pg_catalog.current_setting('probe.freelancer')::uuid);
    RAISE NOTICE 'PASS self-claim accepted (escrow=%)', COALESCE(v_escrow::text, 'none: needs funding');
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE EXCEPTION 'FAIL self-claim refused by the authority gate: %', SQLERRM;
    WHEN OTHERS THEN
        RAISE NOTICE 'PASS self-claim cleared the authority gate, refused further in [%]: %', SQLSTATE, SQLERRM;
END $$;
RESET ROLE;
-- #endregion

ROLLBACK;
