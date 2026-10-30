-- BU5 — org.get_business_bench: the Talent module's bench (Decision #230 (i), #241). Run on a reset DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/probes/business_bench.sql
-- Everything runs in one transaction and is rolled back.
--
-- Seed facts read here: Helia Finance (priyaraman owner, hannahcole admin) hired marisdelacroix on two
-- projects (Meridian s1 paid + s2 live, the wallet's s1 live), juno on Meridian's documentation stage
-- (accepted; the stage opens after her Haddad Studio deadline), and the team Atelier Nova (owner
-- inesduarte, admin lenamueller) on Verdant; hannah reviewed Maris 5.0 on Meridian. Atlas Labs
-- (danielokafor owner, miguelsantos member granted hire) hired North Loop (owner kwamemensah: s1 paid,
-- s2 live), reviewed 4.8 by daniel. noor and lenamueller join Helia as members (rolled back). Each
-- what-if region runs inside a SAVEPOINT and is rolled back to it, so every region reads the seed.
BEGIN;

CREATE FUNCTION pg_temp.act(p_username text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
    SELECT u.user_id INTO v FROM org.users_public u WHERE u.username = p_username;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v::text, true);
END $f$;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
    IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAILED: %', p_what; END IF;
    RAISE NOTICE 'ok — %', p_what;
END $f$;

-- The entry for one handle in a bench answer, or NULL.
CREATE FUNCTION pg_temp.entry(p_bench jsonb, p_handle text) RETURNS jsonb LANGUAGE sql AS $f$
    SELECT e FROM jsonb_array_elements(p_bench->'entries') e WHERE e->>'handle' = p_handle;
$f$;

GRANT EXECUTE ON FUNCTION pg_temp.act(text), pg_temp.check(boolean, text), pg_temp.entry(jsonb, text) TO authenticated;

-- #region Grants
SELECT pg_temp.check(has_function_privilege('authenticated', 'org.get_business_bench(text)', 'EXECUTE'),
                     'authenticated may call the bench');
SELECT pg_temp.check(NOT has_function_privilege('anon', 'org.get_business_bench(text)', 'EXECUTE'),
                     'anon may not call the bench');
-- #endregion

-- #region The owner reads Helia's bench
SELECT set_config('probe.helia', (SELECT id::text FROM org.business_profiles WHERE slug = 'heliafinance'), true);
SELECT pg_temp.act('priyaraman');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE b_owner ON COMMIT DROP AS SELECT org.get_business_bench('heliafinance') AS b;
SELECT b AS helia_bench FROM b_owner;
SELECT pg_temp.check((SELECT b->>'status' FROM b_owner) = 'ok', 'the owner reads the bench');
SELECT pg_temp.check((SELECT count(*) FROM b_owner, jsonb_array_elements(b->'entries') e WHERE e->>'kind' = 'freelancer') >= 2,
                     'two freelancers on Helia''s bench');
SELECT pg_temp.check((SELECT (e->>'engagements')::int = 2 AND (e->>'live_now')::boolean AND e->>'last_worked_at' IS NOT NULL
                             AND (e->>'rating_average')::numeric = 5.00 AND (e->>'rating_count')::int = 1
                             AND e->>'kind' = 'freelancer' AND e->>'contact_handle' = 'marisdelacroix'
                             AND e->>'name' = 'Maris Delacroix'
                        FROM b_owner, pg_temp.entry(b, 'marisdelacroix') e),
                     'Maris: two projects, working now, last delivered on Meridian, 5.0 from one review');
SELECT pg_temp.check((SELECT (e->>'engagements')::int = 1 AND (e->>'live_now')::boolean AND (e->>'rating_count')::int = 0
                             AND e->'rating_average' = 'null'::jsonb AND e->'last_worked_at' = 'null'::jsonb
                        FROM b_owner, pg_temp.entry(b, 'juno') e),
                     'Juno: one project, working now, nothing delivered or reviewed yet');
SELECT pg_temp.check((SELECT e->>'kind' = 'team' AND (e->>'engagements')::int = 1 AND (e->>'live_now')::boolean
                             AND e->>'contact_handle' = 'inesduarte' AND e->>'name' = 'Atelier Nova'
                        FROM b_owner, pg_temp.entry(b, 'ateliernova') e),
                     'Atelier Nova: a team, one project, its Message reaches its owner');
SELECT pg_temp.check((SELECT b->'entries'->0->>'handle' FROM b_owner) = 'marisdelacroix',
                     'working-now parties with the latest delivery lead');
SELECT pg_temp.check((SELECT bool_and((e->>'profile_visible')::boolean) AND NOT bool_or((e->>'viewer_manages')::boolean)
                        FROM b_owner, jsonb_array_elements(b->'entries') e),
                     'every seeded party''s profile opens for the owner, and she manages none of them');
SELECT pg_temp.check(NOT EXISTS (
                         SELECT 1 FROM b_owner, jsonb_array_elements(b->'entries') e
                          WHERE (e - 'avatar_path')::text ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'),
                     'no row id leaves the read (avatar object paths aside)');
SELECT pg_temp.check((SELECT org.get_business_bench('HeliaFinance')->'entries' = b->'entries' FROM b_owner),
                     'the handle resolves in any case');
SELECT pg_temp.check((SELECT org.get_business_bench(current_setting('probe.helia'))->'entries' = b->'entries' FROM b_owner),
                     'a row id still resolves');

SELECT pg_temp.act('hannahcole');
SELECT pg_temp.check((SELECT org.get_business_bench('heliafinance')->>'status') = 'ok', 'the admin (hire by preset) reads the bench');
-- #endregion

-- #region The seed's second freelancer holds a legal booking
RESET ROLE;
SELECT pg_temp.check((SELECT NOT projects.fn_assignee_slot_conflict(sa.project_stage_id, 'freelancer', sa.freelancer_profile_id, NULL)
                        FROM projects.stage_assignments sa
                        JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
                        JOIN projects.projects pr ON pr.id = ps.project_id
                        JOIN org.users_public u ON u.user_id = sa.freelancer_profile_id
                       WHERE pr.title = 'Meridian design system' AND u.username = 'juno'),
                     'Juno''s Meridian seat does not overlap her Haddad Studio seat (AC6, the accept door''s guard)');
-- #endregion

-- #region Rows whose profile the viewer cannot open, or manages; an erased account
SAVEPOINT visibility;
UPDATE org.teams SET visibility = 'invite_only' WHERE slug = 'ateliernova';
UPDATE org.users_public SET visibility = 'private' WHERE username = 'juno';
SELECT pg_temp.act('priyaraman');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE b_hidden ON COMMIT DROP AS SELECT org.get_business_bench('heliafinance') AS b;
SELECT pg_temp.check((SELECT NOT (e->>'profile_visible')::boolean FROM b_hidden, pg_temp.entry(b, 'ateliernova') e)
                     AND (SELECT org.get_profile_view('ateliernova') IS NULL),
                     'an invite-only team stays on the bench, its profile flagged closed — as /@ateliernova answers');
SELECT pg_temp.check((SELECT NOT (e->>'profile_visible')::boolean FROM b_hidden, pg_temp.entry(b, 'juno') e)
                     AND (SELECT org.get_profile_view('juno') IS NULL),
                     'a freelancer who went private stays on the bench, her profile flagged closed');
SELECT pg_temp.check((SELECT (e->>'profile_visible')::boolean FROM b_hidden, pg_temp.entry(b, 'marisdelacroix') e),
                     'a public freelancer''s profile still opens');
-- Lena, Atelier Nova's admin, joins Helia with hire: she manages Nova's profile and opens it although it
-- is invite-only.
RESET ROLE;
INSERT INTO org.business_members (business_id, user_id, role_id, role, granted_capabilities)
SELECT b.id, u.user_id, r.id, 'member', ARRAY['hire']::org.workspace_capability[]
  FROM org.business_profiles b JOIN org.business_roles r ON r.business_id = b.id AND r.preset = 'member'
  JOIN org.users_public u ON u.username = 'lenamueller'
 WHERE b.slug = 'heliafinance';
SELECT pg_temp.act('lenamueller');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check((SELECT (e->>'viewer_manages')::boolean AND (e->>'profile_visible')::boolean
                        FROM pg_temp.entry(org.get_business_bench('heliafinance'), 'ateliernova') e),
                     'a team''s admin manages its row (no Add to project) and still opens its profile');
SELECT pg_temp.check((SELECT NOT (e->>'viewer_manages')::boolean
                        FROM pg_temp.entry(org.get_business_bench('heliafinance'), 'marisdelacroix') e),
                     'she manages nobody else''s row');
RESET ROLE;
INSERT INTO org.deletion_requests (user_id, scope, status, requested_at, scheduled_for, completed_at)
SELECT u.user_id, 'account', 'completed', now() - interval '31 days', now() - interval '1 day', now()
  FROM org.users_public u WHERE u.username = 'juno';
SELECT pg_temp.act('priyaraman');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check(pg_temp.entry(org.get_business_bench('heliafinance'), 'juno') IS NULL,
                     'an erased account has left the bench');
RESET ROLE;
ROLLBACK TO SAVEPOINT visibility;
-- #endregion

-- #region A past engagement: dated, after everyone working now
SELECT set_config('probe.meridian_paid', (SELECT ps.completed_at::text FROM projects.project_stages ps
                                            JOIN projects.projects pr ON pr.id = ps.project_id
                                           WHERE pr.title = 'Meridian design system' AND ps.status = 'paid'), true);
SAVEPOINT past;
-- Maris finishes both of her live Helia seats.
UPDATE projects.stage_assignments sa SET status = 'completed'
  FROM projects.project_stages ps, projects.projects pr, org.users_public u
 WHERE ps.id = sa.project_stage_id AND pr.id = ps.project_id
   AND pr.client_business_id = current_setting('probe.helia')::uuid
   AND u.user_id = sa.freelancer_profile_id AND u.username = 'marisdelacroix'
   AND sa.status NOT IN ('released', 'cancelled', 'declined', 'completed');
SELECT pg_temp.act('priyaraman');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE b_past ON COMMIT DROP AS SELECT org.get_business_bench('heliafinance') AS b;
SELECT pg_temp.check((SELECT NOT (e->>'live_now')::boolean AND (e->>'engagements')::int = 2
                             AND (e->>'last_worked_at')::timestamptz = current_setting('probe.meridian_paid')::timestamptz
                        FROM b_past, pg_temp.entry(b, 'marisdelacroix') e),
                     'Maris, finished: two past projects, last worked the day Meridian''s first stage was paid');
SELECT pg_temp.check((SELECT b->'entries'->-1->>'handle' FROM b_past) = 'marisdelacroix'
                     AND (SELECT bool_and((e->>'live_now')::boolean) FROM b_past, jsonb_array_elements(b->'entries') e
                           WHERE e->>'handle' <> 'marisdelacroix'),
                     'a past party sorts after everyone working now');
RESET ROLE;
ROLLBACK TO SAVEPOINT past;
-- #endregion

-- #region A completed project counts the stages work began on, not a seat nobody started
SAVEPOINT closed;
UPDATE projects.projects SET status = 'completed' WHERE title = 'Meridian design system';
SELECT pg_temp.act('priyaraman');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check(pg_temp.entry(org.get_business_bench('heliafinance'), 'juno') IS NULL,
                     'Meridian completes: Juno''s documentation seat, never started or funded, is no engagement');
SELECT pg_temp.check((SELECT (e->>'engagements')::int = 2 FROM pg_temp.entry(org.get_business_bench('heliafinance'), 'marisdelacroix') e),
                     'Maris keeps Meridian (a paid stage)');
RESET ROLE;
UPDATE projects.project_stages ps SET status = 'in_progress'
  FROM projects.projects pr
 WHERE pr.id = ps.project_id AND pr.title = 'Meridian design system' AND ps.name = 'Documentation site';
SET LOCAL ROLE authenticated;
SELECT pg_temp.check((SELECT (e->>'engagements')::int = 1 AND NOT (e->>'live_now')::boolean
                             AND e->'last_worked_at' = 'null'::jsonb
                        FROM pg_temp.entry(org.get_business_bench('heliafinance'), 'juno') e),
                     'had the work begun, the closed project is a past engagement — undated, nothing was paid');
RESET ROLE;
ROLLBACK TO SAVEPOINT closed;
-- #endregion

-- #region The rating is the business's own
SAVEPOINT rating;
-- Juno, who works on Meridian but is no Helia member, reviews Maris there.
WITH ins AS (
    INSERT INTO reviews.entity_reviews (target_entity_id, target_entity_type, reviewer_user_id, project_id, rating, comment)
    SELECT r.target_entity_id, r.target_entity_type, j.user_id, r.project_id, 1.0,
           repeat('Not the business''s view of Maris. ', 4)
      FROM reviews.entity_reviews r
      JOIN projects.projects pr ON pr.id = r.project_id
      JOIN org.users_public t ON t.user_id = r.target_entity_id AND t.username = 'marisdelacroix'
      JOIN org.users_public j ON j.username = 'juno'
     WHERE pr.title = 'Meridian design system'
    RETURNING 1)
SELECT pg_temp.check((SELECT count(*) FROM ins) = 1, 'an outsider''s review of Maris on Meridian is written');
SELECT pg_temp.act('priyaraman');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check((SELECT (e->>'rating_average')::numeric = 5.00 AND (e->>'rating_count')::int = 1
                        FROM pg_temp.entry(org.get_business_bench('heliafinance'), 'marisdelacroix') e),
                     'a review by someone outside the business is not its rating');
RESET ROLE;
ROLLBACK TO SAVEPOINT rating;
-- #endregion

-- #region What is not an engagement
RESET ROLE;
-- Maris leaves the wallet's discovery stage: that project no longer counts, Meridian still does.
UPDATE projects.stage_assignments sa SET status = 'released'
  FROM projects.project_stages ps, projects.projects pr, org.users_public u
 WHERE ps.id = sa.project_stage_id AND pr.id = ps.project_id AND pr.title = 'Helia wallet redesign'
   AND u.user_id = sa.freelancer_profile_id AND u.username = 'marisdelacroix';
-- Juno's documentation seat is declined: she has hired nowhere else at Helia. The seed seats her, and
-- a taken seat cannot be returned to declined, so the fixture bypasses that guard to stage the row.
SET LOCAL session_replication_role = replica;
UPDATE projects.stage_assignments sa SET status = 'declined'
  FROM projects.project_stages ps, projects.projects pr, org.users_public u
 WHERE ps.id = sa.project_stage_id AND pr.id = ps.project_id AND pr.title = 'Meridian design system'
   AND u.user_id = sa.freelancer_profile_id AND u.username = 'juno';
SET LOCAL session_replication_role = origin;
SELECT pg_temp.act('priyaraman');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check((SELECT (e->>'engagements')::int = 1 AND (e->>'live_now')::boolean
                        FROM pg_temp.entry(org.get_business_bench('heliafinance'), 'marisdelacroix') e),
                     'a released seat is no engagement; Maris keeps Meridian and is still working');
SELECT pg_temp.check(pg_temp.entry(org.get_business_bench('heliafinance'), 'juno') IS NULL,
                     'a declined seat is no engagement; Juno leaves the bench');
-- #endregion

-- #region Who may not read
RESET ROLE;
INSERT INTO org.business_members (business_id, user_id, role_id, role)
SELECT b.id, u.user_id, r.id, 'member'
  FROM org.business_profiles b JOIN org.business_roles r ON r.business_id = b.id AND r.preset = 'member'
  JOIN org.users_public u ON u.username = 'noor'
 WHERE b.slug = 'heliafinance';
SELECT pg_temp.act('noor');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check((SELECT org.get_business_bench('heliafinance')->>'status') = 'forbidden',
                     'a plain member (no hire) is refused');
RESET ROLE;
UPDATE org.business_members m SET granted_capabilities = ARRAY['hire']::org.workspace_capability[]
  FROM org.users_public u, org.business_profiles b
 WHERE u.user_id = m.user_id AND u.username = 'noor' AND b.id = m.business_id AND b.slug = 'heliafinance';
SET LOCAL ROLE authenticated;
SELECT pg_temp.check((SELECT org.get_business_bench('heliafinance')->>'status') = 'ok',
                     'granting hire opens it — the capability, not the role');
SELECT pg_temp.act('marisdelacroix');
SELECT pg_temp.check((SELECT org.get_business_bench('heliafinance')->>'status') = 'forbidden',
                     'a non-member (even one on the bench) is refused');
SELECT pg_temp.check((SELECT org.get_business_bench('no-such-business')->>'status') = 'not_found',
                     'an unknown reference is not_found');
-- #endregion

-- #region Atlas
SELECT pg_temp.act('danielokafor');
SELECT pg_temp.check((SELECT e->>'kind' = 'team' AND e->>'contact_handle' = 'kwamemensah'
                             AND (e->>'rating_average')::numeric = 4.80 AND (e->>'rating_count')::int = 1
                             AND (e->>'engagements')::int = 1 AND (e->>'live_now')::boolean
                             AND e->>'last_worked_at' IS NOT NULL
                        FROM pg_temp.entry(org.get_business_bench('atlaslabs'), 'northloop') e),
                     'Atlas: North Loop, one project, delivered and still working, 4.8, reached through Kwame');
SELECT pg_temp.act('miguelsantos');
SELECT pg_temp.check((SELECT org.get_business_bench('atlaslabs')->>'status') = 'ok', 'a member granted hire reads it');
RESET ROLE;
UPDATE org.business_members m SET granted_capabilities = '{}'
  FROM org.users_public u, org.business_profiles b
 WHERE u.user_id = m.user_id AND u.username = 'miguelsantos' AND b.id = m.business_id AND b.slug = 'atlaslabs';
SET LOCAL ROLE authenticated;
SELECT pg_temp.check((SELECT org.get_business_bench('atlaslabs')->>'status') = 'forbidden',
                     'the same member without the grant is refused');
-- #endregion

ROLLBACK;
