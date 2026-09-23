-- =============================================================================================
-- 00001040_functions_org_profiles.sql — the public profile: its read, and its owner's write path
-- (Category 1: functions).
--
-- `/[handle]` resolves one of four entity kinds by handle — an individual (org.users_public), a
-- team, a business or an organisation — and paints the same page for all of them. Everything that
-- page reads comes through the definer functions below, for the reason org.profiles_index is a
-- definer view: the underlying tables hold far more than a visitor may see (`users_public.dob`, a
-- business's tax id and billing email, a team's payout model) and RLS is ROW-level, so any policy
-- that admits a visitor to a row admits them to every column on it. These functions project only
-- the public facts, and decide visibility themselves.
--
-- WRITES go through definer RPCs too, and that is the security model rather than a convenience:
-- org.users_public and org.freelancer_profiles carry counters, ratings, KYC state and capability
-- flags beside the handful of fields an owner may edit, and a row-level UPDATE policy cannot tell
-- `headline` from `rating_average`. So the client write policies on those tables are gone
-- (00002010) and org.save_profile is the one door — it names every column it will touch.
--
-- The polymorphic owner vocabulary ('user' · 'team' · 'business' · 'organisation') is the
-- org.profile_follows one: an individual is ONE owner whether their profile renders as a client or a
-- freelancer.
-- =============================================================================================

-- #region 1. Owner predicates + handle resolution

-- May the caller MANAGE this profile — edit its fields, media and settings? An individual owns
-- their own; a team's profile is its owner's or a team lead's; a business's its owner's; an
-- organisation's its owner's or an admin's. Deliberately narrower than membership: a member may
-- READ an unlisted entity profile, not rewrite it.
CREATE OR REPLACE FUNCTION org.fn_profile_manages(p_owner_type text, p_owner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE
        WHEN auth.uid () IS NULL OR p_owner_id IS NULL THEN false
        WHEN security.is_admin () THEN true
        WHEN p_owner_type = 'user' THEN p_owner_id = auth.uid ()
        WHEN p_owner_type = 'team' THEN
            EXISTS (SELECT 1 FROM org.teams t WHERE t.id = p_owner_id AND t.owner_user_id = auth.uid ())
            OR org.is_team_lead (p_owner_id)
        WHEN p_owner_type = 'business' THEN
            EXISTS (SELECT 1 FROM org.business_profiles b WHERE b.id = p_owner_id AND b.owner_user_id = auth.uid ())
        WHEN p_owner_type = 'organisation' THEN
            EXISTS (SELECT 1 FROM org.organisations o WHERE o.id = p_owner_id AND o.owner_user_id = auth.uid ())
            OR org.is_organisation_member (p_owner_id, 'admin'::org.organisation_role)
        ELSE false
    END;
$$;

-- The same predicate, exposed to the fat service so it can refuse an unauthorised media upload
-- BEFORE it spends a decode on it. A thin wrapper rather than granting the fn_ directly, so the
-- predicate's own grants stay internal to the policies that call it.
CREATE OR REPLACE FUNCTION org.can_manage_profile(p_owner_type text, p_owner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT org.fn_profile_manages (p_owner_type, p_owner_id);
$$;

-- May the caller SEE this profile at all? The same visibility rule as org.profiles_index — a public
-- or unlisted individual, an ACTIVE business, an active public/unlisted team, an active organisation
-- — plus two arms the directory has no reason for: whoever manages the profile always sees it (the
-- owner of a private profile must be able to look at it), and a member sees their own entity.
CREATE OR REPLACE FUNCTION org.fn_profile_visible(p_owner_type text, p_owner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT org.fn_profile_manages (p_owner_type, p_owner_id) OR CASE
        WHEN p_owner_type = 'user' THEN
            EXISTS (
                SELECT 1 FROM org.users_public u
                WHERE u.user_id = p_owner_id AND u.visibility IN ('public', 'unlisted')
            )
        WHEN p_owner_type = 'team' THEN
            EXISTS (
                SELECT 1 FROM org.teams t
                WHERE t.id = p_owner_id AND t.status = 'active' AND t.visibility IN ('public', 'unlisted')
            )
            OR org.is_active_team_member (p_owner_id)
        WHEN p_owner_type = 'business' THEN
            EXISTS (SELECT 1 FROM org.business_profiles b WHERE b.id = p_owner_id AND b.status = 'active')
            OR org.is_active_business_member (p_owner_id)
        WHEN p_owner_type = 'organisation' THEN
            EXISTS (
                SELECT 1 FROM org.organisations o
                WHERE o.id = p_owner_id AND o.status = 'active'::org.organisation_status
            )
            OR org.is_organisation_member (p_owner_id)
        ELSE false
    END;
$$;

-- `@handle` → the entity it names. Leading `@`s and case are ignored. The four namespaces are
-- separate UNIQUE columns, so two entities CAN share a handle; the order below is the tie-break and
-- is the same one the directory's `handle` column implies — a person first, then the multi-member
-- entities they run.
CREATE OR REPLACE FUNCTION org.fn_resolve_profile(p_handle text)
RETURNS TABLE (owner_type text, owner_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH h AS (
        SELECT lower(btrim(regexp_replace(COALESCE(p_handle, ''), '^@+', ''))) AS v
    )
    SELECT x.owner_type, x.owner_id
    FROM (
        SELECT 1 AS rank, 'user'::text AS owner_type, u.user_id AS owner_id
        FROM org.users_public u, h WHERE lower(u.username) = h.v
        UNION ALL
        SELECT 2, 'team', t.id FROM org.teams t, h WHERE lower(t.slug) = h.v
        UNION ALL
        SELECT 3, 'business', b.id FROM org.business_profiles b, h WHERE lower(b.slug) = h.v
        UNION ALL
        SELECT 4, 'organisation', o.id FROM org.organisations o, h WHERE lower(o.handle) = h.v
    ) x, h
    WHERE h.v <> ''
    ORDER BY x.rank
    LIMIT 1;
$$;

-- The owner a `@handle` names, for a caller who may see it — NULL for an unknown handle and for a
-- hidden profile alike (the same answer, so a private profile's existence is not disclosed). The
-- cheap resolution the scheduling readers need to find the owner's schedule without the full
-- profile document; fn_resolve_profile itself stays internal because it ignores visibility.
CREATE OR REPLACE FUNCTION org.get_profile_owner(p_handle text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_type text;
    v_id uuid;
BEGIN
    SELECT r.owner_type, r.owner_id INTO v_type, v_id FROM org.fn_resolve_profile (p_handle) r;
    IF v_id IS NULL OR NOT org.fn_profile_visible (v_type, v_id) THEN
        RETURN NULL;
    END IF;
    RETURN jsonb_build_object('owner_type', v_type, 'owner_id', v_id);
END;
$$;
-- #endregion

-- #region 2. The profile read
-- One call paints the whole profile chrome: identity, the showcase, the context bar, the metrics
-- strip, the owner's presentation switches and the viewer's own relationship to the profile. NULL
-- for an unknown handle AND for a profile the caller may not see — the two are deliberately
-- indistinguishable, so a private profile's existence is not disclosed by a different answer.
--
-- Raw facts in, presentation out: this returns snake_case facts (a bio document, skill labels,
-- language codes, storage refs) and the fat service maps them onto the `ProfileView` Zod SSOT —
-- labels, tiers and URLs are decided once, in TypeScript, where the fixtures already decide them.
CREATE OR REPLACE FUNCTION org.get_profile_view(p_handle text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_type text;
    v_id uuid;
    v_uid uuid := auth.uid ();
    v_owner boolean;
    v_seller boolean := false;
    v_base jsonb;
    v_sched_type scheduling.owner_type;
    v_completed integer := 0;
BEGIN
    SELECT r.owner_type, r.owner_id INTO v_type, v_id FROM org.fn_resolve_profile (p_handle) r;
    IF v_id IS NULL OR NOT org.fn_profile_visible (v_type, v_id) THEN
        RETURN NULL;
    END IF;
    v_owner := org.fn_profile_manages (v_type, v_id);

    IF v_type = 'user' THEN
        SELECT jsonb_build_object(
            'kind', CASE WHEN u.is_freelancer THEN 'freelancer' ELSE 'client' END,
            'handle', u.username,
            'name', NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), ''),
            'first_name', u.first_name,
            'last_name', u.last_name,
            'headline', COALESCE(u.headline, ''),
            'bio', u.bio,
            'visibility', u.visibility,
            'city', u.city,
            'country', u.country,
            'timezone', u.timezone,
            'language_names', to_jsonb(u.languages),
            'languages', COALESCE((
                SELECT jsonb_agg(
                    jsonb_build_object('code', ul.code, 'level', ul.level)
                    ORDER BY array_position(
                        ARRAY['native', 'fluent', 'professional', 'conversational', 'basic'], ul.level
                    ), ul.code
                )
                FROM org.user_languages ul WHERE ul.user_id = u.user_id
            ), '[]'::jsonb),
            'skills', COALESCE((
                SELECT jsonb_agg(COALESCE(sk.label, s.slug) ORDER BY s.ord)
                FROM unnest(f.skills) WITH ORDINALITY AS s (slug, ord)
                LEFT JOIN org.skills sk ON sk.slug = s.slug
            ), '[]'::jsonb),
            'avatar', files.fn_public_media_ref (u.avatar_file_id),
            'banner', files.fn_public_media_ref (u.banner_file_id),
            'member_since', u.created_at,
            'rating', jsonb_build_object(
                'as_helper', jsonb_build_object(
                    'value', COALESCE(f.rating_average, 0), 'count', COALESCE(f.rating_count, 0)
                ),
                'as_client', jsonb_build_object(
                    'value', COALESCE(u.rating_average, 0), 'count', COALESCE(u.rating_count, 0)
                )
            ),
            'verified', COALESCE(f.kyc_status = 'verified'::finance.kyc_status, false),
            'hire_intake', CASE WHEN u.is_freelancer THEN COALESCE(f.hire_intake, '[]'::jsonb) ELSE '[]'::jsonb END,
            'response_minutes', NULL
        ), u.is_freelancer
        INTO v_base, v_seller
        FROM org.users_public u
        LEFT JOIN org.freelancer_profiles f ON f.user_id = u.user_id
        WHERE u.user_id = v_id;
        v_sched_type := 'user';

        IF v_seller THEN
            SELECT count(DISTINCT sa.project_stage_id)::int INTO v_completed
            FROM projects.stage_assignments sa
            JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
            WHERE sa.freelancer_profile_id = v_id AND ps.completed_at IS NOT NULL;
        ELSE
            SELECT count(*)::int INTO v_completed
            FROM projects.project_stages ps
            JOIN projects.projects p ON p.id = ps.project_id
            WHERE p.owner_user_id = v_id AND p.client_business_id IS NULL AND ps.completed_at IS NOT NULL;
        END IF;

    ELSIF v_type = 'team' THEN
        SELECT jsonb_build_object(
            'kind', 'team',
            'handle', t.slug,
            'name', t.name,
            'headline', COALESCE(t.headline, ''),
            'bio', t.bio,
            'visibility', t.visibility,
            'city', NULL,
            'country', NULL,
            'timezone', NULL,
            'language_names', '[]'::jsonb,
            'languages', '[]'::jsonb,
            'skills', '[]'::jsonb,
            'avatar', files.fn_public_media_ref (t.avatar_file_id),
            'banner', files.fn_public_media_ref (t.banner_file_id),
            'member_since', t.created_at,
            'rating', jsonb_build_object(
                'as_helper', jsonb_build_object(
                    'value', COALESCE(t.rating_average, 0), 'count', COALESCE(t.rating_count, 0)
                ),
                'as_client', jsonb_build_object('value', 0, 'count', 0)
            ),
            'verified', false,
            'hire_intake', COALESCE(t.hire_intake, '[]'::jsonb),
            'response_minutes', NULL
        )
        INTO v_base
        FROM org.teams t WHERE t.id = v_id;
        v_seller := true;
        v_sched_type := 'team';

        SELECT count(DISTINCT sa.project_stage_id)::int INTO v_completed
        FROM projects.stage_assignments sa
        JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
        WHERE sa.team_id = v_id AND ps.completed_at IS NOT NULL;

    ELSIF v_type = 'business' THEN
        SELECT jsonb_build_object(
            'kind', 'business',
            'handle', b.slug,
            'name', b.name,
            'headline', COALESCE(b.headline, ''),
            'bio', b.bio,
            'visibility', 'public',
            'city', b.address_city,
            'country', b.country,
            'timezone', b.timezone,
            'language_names', to_jsonb(b.languages),
            'languages', '[]'::jsonb,
            'skills', '[]'::jsonb,
            'avatar', files.fn_public_media_ref (b.logo_file_id),
            'banner', files.fn_public_media_ref (b.banner_file_id),
            'member_since', b.created_at,
            'rating', jsonb_build_object(
                'as_helper', jsonb_build_object('value', 0, 'count', 0),
                'as_client', jsonb_build_object(
                    'value', COALESCE(b.rating_average, 0), 'count', COALESCE(b.rating_count, 0)
                )
            ),
            'verified', b.kyb_status = 'verified'::finance.kyc_status,
            'hire_intake', '[]'::jsonb,
            'response_minutes', NULL
        )
        INTO v_base
        FROM org.business_profiles b WHERE b.id = v_id;
        v_sched_type := 'business';

        SELECT count(*)::int INTO v_completed
        FROM projects.project_stages ps
        JOIN projects.projects p ON p.id = ps.project_id
        WHERE p.client_business_id = v_id AND ps.completed_at IS NOT NULL;

    ELSE
        SELECT jsonb_build_object(
            'kind', 'organisation',
            'handle', o.handle,
            'name', COALESCE(NULLIF(btrim(o.trading_name), ''), o.legal_name),
            'headline', '',
            'bio', '{}'::jsonb,
            'visibility', 'public',
            'city', o.address_city,
            'country', o.address_country,
            'timezone', NULL,
            'language_names', '[]'::jsonb,
            'languages', '[]'::jsonb,
            'skills', '[]'::jsonb,
            'avatar', files.fn_public_media_ref (o.logo_file_id),
            'banner', NULL,
            'member_since', o.created_at,
            'rating', jsonb_build_object(
                'as_helper', jsonb_build_object('value', 0, 'count', 0),
                'as_client', jsonb_build_object('value', 0, 'count', 0)
            ),
            'verified', o.verification_level <> 'unverified'::org.organisation_verification_level,
            'hire_intake', '[]'::jsonb,
            'response_minutes', NULL
        )
        INTO v_base
        FROM org.organisations o WHERE o.id = v_id;
        v_sched_type := 'organisation';
    END IF;

    IF v_base IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN v_base || jsonb_build_object(
        'owner_type', v_type,
        'owner_id', v_id,
        'viewer_is_owner', v_owner,
        'viewer_follows', v_uid IS NOT NULL AND EXISTS (
            SELECT 1 FROM org.profile_follows pf
            WHERE pf.follower_user_id = v_uid
              AND pf.target_entity_type = v_type AND pf.target_entity_id = v_id
        ),
        'followers', (
            SELECT count(*) FROM org.profile_follows pf
            WHERE pf.target_entity_type = v_type AND pf.target_entity_id = v_id
        ),
        'following', CASE WHEN v_type = 'user' THEN (
            SELECT count(*) FROM org.profile_follows pf WHERE pf.follower_user_id = v_id
        ) ELSE 0 END,
        'showcase', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'position', s.position,
                    'alt', s.alt,
                    'media', files.fn_public_media_ref (s.file_id)
                )
                ORDER BY s.position
            )
            FROM org.profile_showcase_items s
            WHERE s.owner_type = v_type AND s.owner_id = v_id
        ), '[]'::jsonb),
        'settings', (
            SELECT jsonb_build_object(
                'allow_avatar_expand', ps.allow_avatar_expand,
                'show_location', ps.show_location,
                'show_local_time', ps.show_local_time
            )
            FROM org.profile_settings ps
            WHERE ps.owner_type = v_type AND ps.owner_id = v_id
        ),
        'completed_stages', v_completed,
        'standing', CASE WHEN v_seller THEN COALESCE((
            SELECT jsonb_build_object('level', sl.level, 'label', sl.label)
            FROM org.entity_standing es
            JOIN org.standing_levels sl ON sl.level = es.level
            WHERE es.subject_id = v_id
              AND es.subject_type = CASE WHEN v_type = 'team'
                  THEN 'team'::org.standing_subject ELSE 'freelancer'::org.standing_subject END
            LIMIT 1
        ), (
            SELECT jsonb_build_object('level', sl.level, 'label', sl.label)
            FROM org.standing_levels sl WHERE sl.level = 1
        )) ELSE NULL END,
        'architect', EXISTS (
            SELECT 1 FROM org.entity_achievements ea
            WHERE ea.subject_id = v_id AND ea.achievement_code = 'architect'
        ),
        -- The published weekly bands. A schedule nobody published is the owner's draft — visible to
        -- them (so the edit surface can round-trip it) and to nobody else.
        'hours', (
            SELECT jsonb_build_object(
                'timezone', sc.timezone,
                'published', sc.is_published,
                'rules', COALESCE((
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'weekday', ar.weekday,
                            'start_minute', ar.start_minute,
                            'end_minute', ar.end_minute,
                            'kind', ar.kind
                        )
                        ORDER BY ar.kind, ar.weekday, ar.start_minute
                    )
                    FROM scheduling.availability_rules ar
                    WHERE ar.schedule_id = sc.id AND ar.is_active
                ), '[]'::jsonb)
            )
            FROM scheduling.schedules sc
            WHERE sc.owner_type = v_sched_type AND sc.owner_id = v_id
              AND (sc.is_published OR v_owner)
        ),
        -- Only the public half of the call offer: whether a free intro exists. Fees, buffers and
        -- booking rules are read by the Availability editor through the owner's own RLS.
        'free_consultation', v_seller AND EXISTS (
            SELECT 1
            FROM scheduling.schedules sc
            JOIN scheduling.call_settings cs ON cs.schedule_id = sc.id
            WHERE sc.owner_type = v_sched_type AND sc.owner_id = v_id
              AND sc.is_published AND cs.accepts_calls AND cs.courtesy_enabled
        )
    );
END;
$$;
-- #endregion

-- #region 3. The section reads
-- Experience — an individual's ledger: roles, education and certifications, in the order the owner
-- arranged them. NULL when the profile is unknown or hidden (the caller 404s the section).
CREATE OR REPLACE FUNCTION org.get_profile_experience(p_handle text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_type text;
    v_id uuid;
BEGIN
    SELECT r.owner_type, r.owner_id INTO v_type, v_id FROM org.fn_resolve_profile (p_handle) r;
    IF v_id IS NULL OR NOT org.fn_profile_visible (v_type, v_id) THEN
        RETURN NULL;
    END IF;
    IF v_type <> 'user' THEN
        RETURN jsonb_build_object('experience', '[]'::jsonb, 'education', '[]'::jsonb, 'certifications', '[]'::jsonb);
    END IF;
    RETURN jsonb_build_object(
        'experience', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', e.id, 'org_name', e.org_name, 'role', e.role, 'start_year', e.start_year,
                'end_year', e.end_year, 'is_current', e.is_current, 'summary', e.summary,
                'logo', files.fn_public_media_ref (e.logo_file_id)
            ) ORDER BY e.sort_order, e.created_at)
            FROM org.experience_entries e WHERE e.user_id = v_id
        ), '[]'::jsonb),
        'education', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', d.id, 'school', d.school, 'credential', d.credential, 'field', d.field,
                'start_year', d.start_year, 'end_year', d.end_year,
                'logo', files.fn_public_media_ref (d.logo_file_id)
            ) ORDER BY d.sort_order, d.created_at)
            FROM org.education_entries d WHERE d.user_id = v_id
        ), '[]'::jsonb),
        'certifications', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', c.id, 'name', c.name, 'issuer', c.issuer, 'issued_year', c.issued_year,
                'expires_year', c.expires_year, 'credential_url', c.credential_url,
                'verified', c.verified, 'logo', files.fn_public_media_ref (c.logo_file_id)
            ) ORDER BY c.sort_order, c.created_at)
            FROM org.certifications c WHERE c.user_id = v_id
        ), '[]'::jsonb)
    );
END;
$$;

-- Reviews the profile RECEIVED, newest first. An individual is reviewed on two tracks: as a
-- freelancer (by clients) and as a client (by freelancers), and `author_role` records the AUTHOR's
-- side so the app can filter by stance. The engagement title is disclosed only when that project is
-- itself public — a review may be public while the work it was about is confidential.
CREATE OR REPLACE FUNCTION org.get_profile_reviews(p_handle text, p_limit integer DEFAULT 60)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_type text;
    v_id uuid;
BEGIN
    SELECT r.owner_type, r.owner_id INTO v_type, v_id FROM org.fn_resolve_profile (p_handle) r;
    IF v_id IS NULL OR NOT org.fn_profile_visible (v_type, v_id) THEN
        RETURN NULL;
    END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC)
        FROM (
            SELECT
                rv.id,
                rv.rating,
                rv.title,
                rv.comment,
                rv.created_at,
                -- The profile's stance in the engagement → the author sat on the other side.
                CASE WHEN rv.target_entity_type IN ('freelancer', 'team') THEN 'client' ELSE 'freelancer' END
                    AS author_role,
                up.username AS author_handle,
                NULLIF(btrim(concat_ws(' ', up.first_name, up.last_name)), '') AS author_name,
                files.fn_public_media_ref (up.avatar_file_id) AS author_avatar,
                CASE WHEN p.visibility = 'public' THEN p.title END AS context_title
            FROM reviews.entity_reviews rv
            JOIN org.users_public up ON up.user_id = rv.reviewer_user_id
            LEFT JOIN projects.projects p ON p.id = rv.project_id
            WHERE rv.target_entity_id = v_id
              AND (
                  (v_type = 'user' AND rv.target_entity_type IN ('user', 'freelancer'))
                  OR (v_type = 'team' AND rv.target_entity_type = 'team')
                  OR (v_type = 'business' AND rv.target_entity_type = 'business')
              )
            ORDER BY rv.created_at DESC
            LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 60), 200))
        ) x
    ), '[]'::jsonb);
END;
$$;

-- The roster of a multi-member entity, and — for an organisation — the departments it is grouped
-- by. Active memberships only; a member's display facts come from their public row and their
-- avatar from its public rendition. Empty for an individual.
CREATE OR REPLACE FUNCTION org.get_profile_roster(p_handle text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_type text;
    v_id uuid;
BEGIN
    SELECT r.owner_type, r.owner_id INTO v_type, v_id FROM org.fn_resolve_profile (p_handle) r;
    IF v_id IS NULL OR NOT org.fn_profile_visible (v_type, v_id) THEN
        RETURN NULL;
    END IF;

    IF v_type = 'team' THEN
        RETURN jsonb_build_object('departments', '[]'::jsonb, 'members', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'handle', up.username,
                'name', NULLIF(btrim(concat_ws(' ', up.first_name, up.last_name)), ''),
                'avatar', files.fn_public_media_ref (up.avatar_file_id),
                'role', COALESCE(NULLIF(btrim(tm.title), ''), initcap(tm.role)),
                'is_freelancer', up.is_freelancer,
                'departments', '[]'::jsonb
            ) ORDER BY (tm.role = 'owner') DESC, tm.joined_at)
            FROM org.team_members tm
            JOIN org.users_public up ON up.user_id = tm.user_id
            WHERE tm.team_id = v_id AND tm.status = 'active'
        ), '[]'::jsonb));
    ELSIF v_type = 'business' THEN
        RETURN jsonb_build_object('departments', '[]'::jsonb, 'members', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'handle', up.username,
                'name', NULLIF(btrim(concat_ws(' ', up.first_name, up.last_name)), ''),
                'avatar', files.fn_public_media_ref (up.avatar_file_id),
                'role', COALESCE(NULLIF(btrim(bm.title), ''), initcap(bm.role)),
                'is_freelancer', up.is_freelancer,
                'departments', '[]'::jsonb
            ) ORDER BY bm.joined_at)
            FROM org.business_members bm
            JOIN org.users_public up ON up.user_id = bm.user_id
            WHERE bm.business_id = v_id AND bm.status = 'active'
        ), '[]'::jsonb));
    ELSIF v_type = 'organisation' THEN
        RETURN jsonb_build_object(
            'departments', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'name', d.name,
                    'member_count', (
                        SELECT count(*) FROM org.organisation_members m
                        WHERE m.organisation_id = v_id AND m.status = 'active' AND d.name = ANY (m.departments)
                    )
                ) ORDER BY d.ord)
                FROM org.organisations o, unnest(o.departments) WITH ORDINALITY AS d (name, ord)
                WHERE o.id = v_id
            ), '[]'::jsonb),
            'members', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'handle', up.username,
                    'name', NULLIF(btrim(concat_ws(' ', up.first_name, up.last_name)), ''),
                    'avatar', files.fn_public_media_ref (up.avatar_file_id),
                    'role', initcap(m.role::text),
                    'is_freelancer', up.is_freelancer,
                    'departments', to_jsonb(m.departments)
                ) ORDER BY m.joined_at)
                FROM org.organisation_members m
                JOIN org.users_public up ON up.user_id = m.user_id
                WHERE m.organisation_id = v_id AND m.status = 'active'
            ), '[]'::jsonb)
        );
    END IF;
    RETURN jsonb_build_object('departments', '[]'::jsonb, 'members', '[]'::jsonb);
END;
$$;

-- The portfolio masonry ("Selected work") — the owner's own pieces, public ones only for a visitor.
-- A piece's picture is its cover rendition; a piece without a public cover is not drawable and is
-- left out rather than drawn as an empty tile.
CREATE OR REPLACE FUNCTION org.get_profile_portfolio(p_handle text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_type text;
    v_id uuid;
    v_owner boolean;
BEGIN
    SELECT r.owner_type, r.owner_id INTO v_type, v_id FROM org.fn_resolve_profile (p_handle) r;
    IF v_id IS NULL OR NOT org.fn_profile_visible (v_type, v_id) THEN
        RETURN NULL;
    END IF;
    IF v_type <> 'user' THEN
        RETURN '[]'::jsonb;
    END IF;
    v_owner := org.fn_profile_manages (v_type, v_id);
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', pf.id, 'title', pf.title, 'client', pf.client_name, 'category', pf.category,
            'description', pf.description, 'media', files.fn_public_media_ref (pf.cover_file_id)
        ) ORDER BY pf.sort_order, pf.created_at DESC)
        FROM org.portfolios pf
        WHERE pf.user_id = v_id AND (pf.is_public OR v_owner) AND pf.cover_file_id IS NOT NULL
    ), '[]'::jsonb);
END;
$$;

-- The "Completed projects" list — engagements the profile POSTED or DELIVERED on that finished.
--
-- Two gates, both required, and neither is the profile owner's to lift: the project must have been
-- public (a private engagement is never disclosed by a profile that took part in it), and its client
-- must allow portfolio display (`portfolio_display_rights = 'allowed'` — `embargoed` and `forbidden`
-- both keep it off every profile, the poster's own included, because the flag is the client's promise
-- to the people who delivered it as much as a restriction on them).
--
-- "Delivered on" is an assignment that was ever real: `declined`, `cancelled` and `pending_funding`
-- (a blueprint draft nobody was committed to) never put anybody to work. Returns the posting entity's
-- identity with each project, because a completed brief is framed by who commissioned it.
CREATE OR REPLACE FUNCTION org.get_profile_past_projects(p_handle text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_type text;
    v_id uuid;
BEGIN
    SELECT r.owner_type, r.owner_id INTO v_type, v_id FROM org.fn_resolve_profile (p_handle) r;
    IF v_id IS NULL OR NOT org.fn_profile_visible (v_type, v_id) THEN
        RETURN NULL;
    END IF;
    RETURN COALESCE((
        SELECT jsonb_agg(x.doc ORDER BY x.finished DESC)
        FROM (
            SELECT
                p.updated_at AS finished,
                jsonb_build_object(
                    'slug', p.slug,
                    'title', p.title,
                    'summary', COALESCE(p.description_text, ''),
                    'format', p.format,
                    'currency', p.currency,
                    'budget_amount_cents', p.budget_amount_cents,
                    'created_at', p.created_at,
                    'phases', COALESCE((
                        SELECT jsonb_agg(ps.name ORDER BY ps.sort_order)
                        FROM projects.project_stages ps WHERE ps.project_id = p.id
                    ), '[]'::jsonb),
                    'roles', COALESCE((
                        SELECT jsonb_agg(DISTINCT sr.role_title)
                        FROM projects.stage_staffing_roles sr
                        JOIN projects.project_stages ps ON ps.id = sr.project_stage_id
                        WHERE ps.project_id = p.id
                    ), '[]'::jsonb),
                    'skills', COALESCE((
                        SELECT jsonb_agg(sk.label ORDER BY sk.label)
                        FROM projects.project_required_skills prs
                        JOIN org.skills sk ON sk.id = prs.skill_id
                        WHERE prs.project_id = p.id
                    ), '[]'::jsonb),
                    'poster', CASE
                        WHEN p.client_business_id IS NOT NULL THEN (
                            SELECT jsonb_build_object(
                                'handle', b.slug, 'name', b.name, 'kind', 'business',
                                'avatar', files.fn_public_media_ref (b.logo_file_id),
                                'verified', b.kyb_status = 'verified'::finance.kyc_status
                            ) FROM org.business_profiles b WHERE b.id = p.client_business_id
                        )
                        WHEN p.owner_team_id IS NOT NULL THEN (
                            SELECT jsonb_build_object(
                                'handle', t.slug, 'name', t.name, 'kind', 'team',
                                'avatar', files.fn_public_media_ref (t.avatar_file_id),
                                'verified', false
                            ) FROM org.teams t WHERE t.id = p.owner_team_id
                        )
                        ELSE (
                            SELECT jsonb_build_object(
                                'handle', up.username,
                                'name', COALESCE(NULLIF(btrim(concat_ws(' ', up.first_name, up.last_name)), ''), up.username),
                                'kind', CASE WHEN up.is_freelancer THEN 'freelancer' ELSE 'user' END,
                                'avatar', files.fn_public_media_ref (up.avatar_file_id),
                                'verified', false
                            ) FROM org.users_public up WHERE up.user_id = p.owner_user_id
                        )
                    END
                ) AS doc
            FROM projects.projects p
            WHERE p.status = 'completed'
              AND p.visibility = 'public'
              AND p.portfolio_display_rights = 'allowed'
              AND (
                  (v_type = 'user' AND (
                      p.owner_user_id = v_id
                      OR EXISTS (
                          SELECT 1 FROM projects.project_participants pp
                          WHERE pp.project_id = p.id AND pp.profile_type = 'freelancer' AND pp.profile_id = v_id
                      )
                      OR EXISTS (
                          SELECT 1 FROM projects.stage_assignments sa
                          JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
                          WHERE ps.project_id = p.id AND sa.freelancer_profile_id = v_id
                            AND sa.status NOT IN ('declined', 'cancelled', 'pending_funding')
                      )
                  ))
                  OR (v_type = 'team' AND (
                      p.owner_team_id = v_id
                      OR EXISTS (
                          SELECT 1 FROM projects.stage_assignments sa
                          JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
                          WHERE ps.project_id = p.id AND sa.team_id = v_id
                            AND sa.status NOT IN ('declined', 'cancelled', 'pending_funding')
                      )
                  ))
                  OR (v_type = 'business' AND p.client_business_id = v_id)
                  OR (v_type = 'organisation' AND p.owner_organisation_id = v_id)
              )
            ORDER BY p.updated_at DESC
            LIMIT 24
        ) x
    ), '[]'::jsonb);
END;
$$;
-- #endregion

-- #region 4. Public identity cards — the batch door for every other surface
-- A person's display facts for ANY surface that shows other people (project rosters, message
-- senders, contact pickers, review authors): name, handle and the avatar's public rendition. The
-- one place those are resolved, so an avatar change reaches every surface on its next read instead
-- of living in a dozen copies — and the one door that reads other people's rows without exposing
-- the columns a visitor may never see. Capped per call; order is not preserved (callers key by id).
--
-- PL/pgSQL rather than SQL on purpose: a SQL-language body is validated when the function is
-- CREATED, and files.fn_public_media_ref is created later, in 00001160 — a PL/pgSQL body resolves it
-- when it runs, so the file order between the org and files function files stays free.
CREATE OR REPLACE FUNCTION org.get_party_cards(p_user_ids uuid[])
RETURNS TABLE (
    user_id uuid,
    username text,
    first_name text,
    last_name text,
    is_freelancer boolean,
    avatar jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN QUERY
    SELECT u.user_id, u.username, u.first_name, u.last_name, u.is_freelancer,
           files.fn_public_media_ref (u.avatar_file_id)
    FROM org.users_public u
    WHERE u.user_id = ANY (p_user_ids[1:500]);
END;
$$;
-- #endregion

-- #region 5. The owner write path
-- Save the owner-editable fields of a profile in ONE transaction. `p_patch` carries only the
-- sections being changed (an absent key is untouched); list sections REPLACE the whole list. The
-- friendly validation is the route's (Zod); this re-checks every hard limit, because a definer
-- function is the last thing between a crafted request and the row.
--
-- Errors are raised with SQLSTATE 22023 and a message of the form `<field>: <reason>` so the fat
-- service can pin the refusal to the input that caused it.
CREATE OR REPLACE FUNCTION org.save_profile(p_owner_type text, p_owner_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid ();
    v_patch jsonb := COALESCE(p_patch, '{}'::jsonb);
    v_item jsonb;
    v_i integer;
    v_text text;
    v_keep uuid[];
    v_id uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in to edit a profile';
    END IF;
    IF p_owner_type NOT IN ('user', 'team', 'business', 'organisation') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'owner: unknown profile kind';
    END IF;
    IF NOT org.fn_profile_manages (p_owner_type, p_owner_id) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'owner: you cannot edit this profile';
    END IF;
    IF jsonb_typeof(v_patch) <> 'object' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'patch: expected an object';
    END IF;

    -- #region Shared text limits
    IF v_patch ? 'headline' AND char_length(COALESCE(v_patch ->> 'headline', '')) > 160 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'headline: must be 160 characters or fewer';
    END IF;
    IF v_patch ? 'story' AND char_length(COALESCE(v_patch ->> 'story', '')) > 4000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'story: must be 4,000 characters or fewer';
    END IF;
    IF v_patch ? 'timezone' AND NULLIF(v_patch ->> 'timezone', '') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = v_patch ->> 'timezone') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'timezone: not a known time zone';
    END IF;
    -- #endregion

    -- #region Individual
    IF p_owner_type = 'user' THEN
        IF v_patch ? 'first_name' AND char_length(btrim(COALESCE(v_patch ->> 'first_name', ''))) NOT BETWEEN 1 AND 60 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'first_name: enter a first name (60 characters or fewer)';
        END IF;
        IF v_patch ? 'last_name' AND char_length(btrim(COALESCE(v_patch ->> 'last_name', ''))) > 60 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'last_name: must be 60 characters or fewer';
        END IF;
        IF v_patch ? 'visibility' AND COALESCE(v_patch ->> 'visibility', '') NOT IN ('public', 'unlisted', 'private') THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'visibility: choose public, unlisted or private';
        END IF;

        UPDATE org.users_public u SET
            first_name = CASE WHEN v_patch ? 'first_name' THEN btrim(v_patch ->> 'first_name') ELSE u.first_name END,
            last_name = CASE WHEN v_patch ? 'last_name' THEN NULLIF(btrim(v_patch ->> 'last_name'), '') ELSE u.last_name END,
            headline = CASE WHEN v_patch ? 'headline' THEN btrim(COALESCE(v_patch ->> 'headline', '')) ELSE u.headline END,
            bio = CASE WHEN v_patch ? 'story' THEN jsonb_build_object('text', COALESCE(v_patch ->> 'story', '')) ELSE u.bio END,
            city = CASE WHEN v_patch ? 'city' THEN NULLIF(btrim(v_patch ->> 'city'), '') ELSE u.city END,
            country = CASE WHEN v_patch ? 'country' THEN NULLIF(btrim(v_patch ->> 'country'), '') ELSE u.country END,
            timezone = CASE WHEN v_patch ? 'timezone' THEN NULLIF(v_patch ->> 'timezone', '') ELSE u.timezone END,
            visibility = CASE WHEN v_patch ? 'visibility' THEN v_patch ->> 'visibility' ELSE u.visibility END,
            updated_at = now()
        WHERE u.user_id = p_owner_id;

        -- Languages: the leveled set replaces the old one, and the legacy text[] (the directory's
        -- match set) is kept in step as upper-case codes so the two can never disagree.
        IF v_patch ? 'languages' THEN
            IF jsonb_typeof(v_patch -> 'languages') <> 'array' OR jsonb_array_length(v_patch -> 'languages') > 12 THEN
                RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'languages: up to 12 languages';
            END IF;
            DELETE FROM org.user_languages WHERE user_id = p_owner_id;
            FOR v_item IN SELECT * FROM jsonb_array_elements(v_patch -> 'languages') LOOP
                IF COALESCE(v_item ->> 'code', '') !~ '^[A-Za-z]{2,3}$' THEN
                    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'languages: each language needs a 2–3 letter code';
                END IF;
                IF COALESCE(v_item ->> 'level', '') NOT IN ('native', 'fluent', 'professional', 'conversational', 'basic') THEN
                    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'languages: choose a proficiency for every language';
                END IF;
                INSERT INTO org.user_languages (user_id, code, level)
                VALUES (p_owner_id, lower(v_item ->> 'code'), v_item ->> 'level')
                ON CONFLICT (user_id, code) DO UPDATE SET level = EXCLUDED.level;
            END LOOP;
            UPDATE org.users_public u
            SET languages = COALESCE((
                SELECT array_agg(upper(ul.code) ORDER BY array_position(
                    ARRAY['native', 'fluent', 'professional', 'conversational', 'basic'], ul.level), ul.code)
                FROM org.user_languages ul WHERE ul.user_id = p_owner_id
            ), '{}'::text[])
            WHERE u.user_id = p_owner_id;
        END IF;

        -- Skills live on the freelancer row; a client has none to edit.
        IF v_patch ? 'skills' THEN
            IF jsonb_typeof(v_patch -> 'skills') <> 'array' OR jsonb_array_length(v_patch -> 'skills') > 15 THEN
                RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'skills: up to 15 skills';
            END IF;
            IF EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(v_patch -> 'skills') s
                WHERE char_length(btrim(s)) NOT BETWEEN 1 AND 40
            ) THEN
                RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'skills: each skill is 1–40 characters';
            END IF;
            -- Stored as the vocabulary SLUG when the label names a known skill (so the directory and
            -- the search index keep matching on one spelling), otherwise as the owner's own words;
            -- de-duplicated case-insensitively while keeping the order the owner chose.
            -- The window runs over the RESOLVED value, so "Design systems" and "design-systems" are
            -- one skill, not two.
            UPDATE org.freelancer_profiles f
            SET skills = ARRAY(
                    SELECT r.v
                    FROM (
                        SELECT m.v, m.ord, row_number() OVER (PARTITION BY lower(m.v) ORDER BY m.ord) AS rn
                        FROM (
                            SELECT
                                COALESCE((
                                    SELECT sk.slug FROM org.skills sk
                                    WHERE sk.slug = lower(btrim(s.v)) OR lower(sk.label) = lower(btrim(s.v))
                                    ORDER BY (sk.slug = lower(btrim(s.v))) DESC
                                    LIMIT 1
                                ), btrim(s.v)) AS v,
                                s.ord
                            FROM jsonb_array_elements_text(v_patch -> 'skills') WITH ORDINALITY AS s (v, ord)
                        ) m
                    ) r
                    WHERE r.rn = 1
                    ORDER BY r.ord
                ),
                updated_at = now()
            WHERE f.user_id = p_owner_id;
        END IF;

        -- Experience — the whole ordered list. Rows the owner kept are updated in place (their ids
        -- survive, so nothing that links to one breaks); rows they removed are deleted.
        IF v_patch ? 'experience' THEN
            IF jsonb_typeof(v_patch -> 'experience') <> 'array' OR jsonb_array_length(v_patch -> 'experience') > 30 THEN
                RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'experience: up to 30 roles';
            END IF;
            v_keep := '{}';
            v_i := 0;
            FOR v_item IN SELECT * FROM jsonb_array_elements(v_patch -> 'experience') LOOP
                IF char_length(btrim(COALESCE(v_item ->> 'org_name', ''))) NOT BETWEEN 1 AND 120
                   OR char_length(btrim(COALESCE(v_item ->> 'role', ''))) NOT BETWEEN 1 AND 120
                   OR COALESCE(v_item ->> 'start_year', '') !~ '^\d{4}$'
                   OR (NULLIF(v_item ->> 'end_year', '') IS NOT NULL AND v_item ->> 'end_year' !~ '^\d{4}$')
                   OR char_length(COALESCE(v_item ->> 'summary', '')) > 600 THEN
                    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('experience.%s: check the organisation, role and years', v_i);
                END IF;
                v_id := NULLIF(v_item ->> 'id', '')::uuid;
                IF v_id IS NOT NULL AND EXISTS (SELECT 1 FROM org.experience_entries e WHERE e.id = v_id AND e.user_id = p_owner_id) THEN
                    UPDATE org.experience_entries e SET
                        org_name = btrim(v_item ->> 'org_name'),
                        role = btrim(v_item ->> 'role'),
                        start_year = v_item ->> 'start_year',
                        end_year = CASE WHEN COALESCE((v_item ->> 'is_current')::boolean, false) THEN NULL ELSE NULLIF(v_item ->> 'end_year', '') END,
                        is_current = COALESCE((v_item ->> 'is_current')::boolean, false),
                        summary = COALESCE(v_item ->> 'summary', ''),
                        sort_order = v_i
                    WHERE e.id = v_id;
                ELSE
                    INSERT INTO org.experience_entries (user_id, org_name, role, start_year, end_year, is_current, summary, sort_order)
                    VALUES (
                        p_owner_id, btrim(v_item ->> 'org_name'), btrim(v_item ->> 'role'), v_item ->> 'start_year',
                        CASE WHEN COALESCE((v_item ->> 'is_current')::boolean, false) THEN NULL ELSE NULLIF(v_item ->> 'end_year', '') END,
                        COALESCE((v_item ->> 'is_current')::boolean, false), COALESCE(v_item ->> 'summary', ''), v_i
                    )
                    RETURNING id INTO v_id;
                END IF;
                v_keep := v_keep || v_id;
                v_i := v_i + 1;
            END LOOP;
            DELETE FROM org.experience_entries e WHERE e.user_id = p_owner_id AND NOT (e.id = ANY (v_keep));
        END IF;

        IF v_patch ? 'education' THEN
            IF jsonb_typeof(v_patch -> 'education') <> 'array' OR jsonb_array_length(v_patch -> 'education') > 20 THEN
                RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'education: up to 20 entries';
            END IF;
            v_keep := '{}';
            v_i := 0;
            FOR v_item IN SELECT * FROM jsonb_array_elements(v_patch -> 'education') LOOP
                IF char_length(btrim(COALESCE(v_item ->> 'school', ''))) NOT BETWEEN 1 AND 120
                   OR char_length(btrim(COALESCE(v_item ->> 'credential', ''))) NOT BETWEEN 1 AND 80
                   OR char_length(btrim(COALESCE(v_item ->> 'field', ''))) > 120
                   OR COALESCE(v_item ->> 'start_year', '') !~ '^\d{4}$'
                   OR (NULLIF(v_item ->> 'end_year', '') IS NOT NULL AND v_item ->> 'end_year' !~ '^\d{4}$') THEN
                    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('education.%s: check the school, credential and years', v_i);
                END IF;
                v_id := NULLIF(v_item ->> 'id', '')::uuid;
                IF v_id IS NOT NULL AND EXISTS (SELECT 1 FROM org.education_entries d WHERE d.id = v_id AND d.user_id = p_owner_id) THEN
                    UPDATE org.education_entries d SET
                        school = btrim(v_item ->> 'school'),
                        credential = btrim(v_item ->> 'credential'),
                        field = btrim(COALESCE(v_item ->> 'field', '')),
                        start_year = v_item ->> 'start_year',
                        end_year = NULLIF(v_item ->> 'end_year', ''),
                        sort_order = v_i
                    WHERE d.id = v_id;
                ELSE
                    INSERT INTO org.education_entries (user_id, school, credential, field, start_year, end_year, sort_order)
                    VALUES (
                        p_owner_id, btrim(v_item ->> 'school'), btrim(v_item ->> 'credential'),
                        btrim(COALESCE(v_item ->> 'field', '')), v_item ->> 'start_year', NULLIF(v_item ->> 'end_year', ''), v_i
                    )
                    RETURNING id INTO v_id;
                END IF;
                v_keep := v_keep || v_id;
                v_i := v_i + 1;
            END LOOP;
            DELETE FROM org.education_entries d WHERE d.user_id = p_owner_id AND NOT (d.id = ANY (v_keep));
        END IF;

        -- Certifications keep their PLATFORM verification only while the credential is the one that
        -- was checked: an unchanged name + issuer keeps `verified`; any edit to either clears it.
        IF v_patch ? 'certifications' THEN
            IF jsonb_typeof(v_patch -> 'certifications') <> 'array' OR jsonb_array_length(v_patch -> 'certifications') > 20 THEN
                RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'certifications: up to 20 certifications';
            END IF;
            v_keep := '{}';
            v_i := 0;
            FOR v_item IN SELECT * FROM jsonb_array_elements(v_patch -> 'certifications') LOOP
                v_text := NULLIF(btrim(COALESCE(v_item ->> 'credential_url', '')), '');
                IF char_length(btrim(COALESCE(v_item ->> 'name', ''))) NOT BETWEEN 1 AND 120
                   OR char_length(btrim(COALESCE(v_item ->> 'issuer', ''))) NOT BETWEEN 1 AND 120
                   OR COALESCE(v_item ->> 'issued_year', '') !~ '^\d{4}$'
                   OR (NULLIF(v_item ->> 'expires_year', '') IS NOT NULL AND v_item ->> 'expires_year' !~ '^\d{4}$')
                   OR (v_text IS NOT NULL AND (v_text !~* '^https://[^\s]+$' OR char_length(v_text) > 500)) THEN
                    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('certifications.%s: check the name, issuer, years and link (https only)', v_i);
                END IF;
                v_id := NULLIF(v_item ->> 'id', '')::uuid;
                IF v_id IS NOT NULL AND EXISTS (SELECT 1 FROM org.certifications c WHERE c.id = v_id AND c.user_id = p_owner_id) THEN
                    UPDATE org.certifications c SET
                        verified = c.verified AND c.name = btrim(v_item ->> 'name') AND c.issuer = btrim(v_item ->> 'issuer'),
                        verified_at = CASE
                            WHEN c.verified AND c.name = btrim(v_item ->> 'name') AND c.issuer = btrim(v_item ->> 'issuer')
                            THEN c.verified_at END,
                        name = btrim(v_item ->> 'name'),
                        issuer = btrim(v_item ->> 'issuer'),
                        issued_year = v_item ->> 'issued_year',
                        expires_year = NULLIF(v_item ->> 'expires_year', ''),
                        credential_url = v_text,
                        sort_order = v_i
                    WHERE c.id = v_id;
                ELSE
                    INSERT INTO org.certifications (user_id, name, issuer, issued_year, expires_year, credential_url, sort_order)
                    VALUES (
                        p_owner_id, btrim(v_item ->> 'name'), btrim(v_item ->> 'issuer'), v_item ->> 'issued_year',
                        NULLIF(v_item ->> 'expires_year', ''), v_text, v_i
                    )
                    RETURNING id INTO v_id;
                END IF;
                v_keep := v_keep || v_id;
                v_i := v_i + 1;
            END LOOP;
            DELETE FROM org.certifications c WHERE c.user_id = p_owner_id AND NOT (c.id = ANY (v_keep));
        END IF;
    -- #endregion

    -- #region Team
    ELSIF p_owner_type = 'team' THEN
        IF v_patch ? 'name' AND char_length(btrim(COALESCE(v_patch ->> 'name', ''))) NOT BETWEEN 1 AND 80 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'name: enter a team name (80 characters or fewer)';
        END IF;
        IF v_patch ? 'visibility' AND COALESCE(v_patch ->> 'visibility', '') NOT IN ('public', 'unlisted', 'invite_only') THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'visibility: choose public, unlisted or invite only';
        END IF;
        UPDATE org.teams t SET
            name = CASE WHEN v_patch ? 'name' THEN btrim(v_patch ->> 'name') ELSE t.name END,
            headline = CASE WHEN v_patch ? 'headline' THEN btrim(COALESCE(v_patch ->> 'headline', '')) ELSE t.headline END,
            bio = CASE WHEN v_patch ? 'story' THEN jsonb_build_object('text', COALESCE(v_patch ->> 'story', '')) ELSE t.bio END,
            visibility = CASE WHEN v_patch ? 'visibility' THEN v_patch ->> 'visibility' ELSE t.visibility END,
            updated_at = now()
        WHERE t.id = p_owner_id;
    -- #endregion

    -- #region Business
    ELSIF p_owner_type = 'business' THEN
        IF v_patch ? 'name' AND char_length(btrim(COALESCE(v_patch ->> 'name', ''))) NOT BETWEEN 1 AND 80 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'name: enter a business name (80 characters or fewer)';
        END IF;
        UPDATE org.business_profiles b SET
            name = CASE WHEN v_patch ? 'name' THEN btrim(v_patch ->> 'name') ELSE b.name END,
            headline = CASE WHEN v_patch ? 'headline' THEN btrim(COALESCE(v_patch ->> 'headline', '')) ELSE b.headline END,
            bio = CASE WHEN v_patch ? 'story' THEN jsonb_build_object('text', COALESCE(v_patch ->> 'story', '')) ELSE b.bio END,
            address_city = CASE WHEN v_patch ? 'city' THEN NULLIF(btrim(v_patch ->> 'city'), '') ELSE b.address_city END,
            country = CASE WHEN v_patch ? 'country' THEN NULLIF(btrim(v_patch ->> 'country'), '') ELSE b.country END,
            timezone = CASE WHEN v_patch ? 'timezone' THEN NULLIF(v_patch ->> 'timezone', '') ELSE b.timezone END,
            updated_at = now()
        WHERE b.id = p_owner_id;
    -- #endregion

    -- #region Organisation — the trading name is the only presentational field it carries
    ELSE
        IF v_patch ? 'name' AND char_length(btrim(COALESCE(v_patch ->> 'name', ''))) > 120 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'name: must be 120 characters or fewer';
        END IF;
        UPDATE org.organisations o SET
            trading_name = CASE WHEN v_patch ? 'name' THEN NULLIF(btrim(v_patch ->> 'name'), '') ELSE o.trading_name END,
            address_city = CASE WHEN v_patch ? 'city' THEN NULLIF(btrim(v_patch ->> 'city'), '') ELSE o.address_city END,
            address_country = CASE WHEN v_patch ? 'country' THEN NULLIF(btrim(v_patch ->> 'country'), '') ELSE o.address_country END,
            updated_at = now()
        WHERE o.id = p_owner_id;
    END IF;
    -- #endregion

    -- #region Presentation switches (every kind)
    IF v_patch ? 'settings' THEN
        IF jsonb_typeof(v_patch -> 'settings') <> 'object' THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'settings: expected an object';
        END IF;
        INSERT INTO org.profile_settings AS ps (owner_type, owner_id, allow_avatar_expand, show_location, show_local_time)
        VALUES (
            p_owner_type, p_owner_id,
            COALESCE((v_patch -> 'settings' ->> 'allow_avatar_expand')::boolean, false),
            COALESCE((v_patch -> 'settings' ->> 'show_location')::boolean, true),
            COALESCE((v_patch -> 'settings' ->> 'show_local_time')::boolean, true)
        )
        ON CONFLICT (owner_type, owner_id) DO UPDATE SET
            allow_avatar_expand = COALESCE((v_patch -> 'settings' ->> 'allow_avatar_expand')::boolean, ps.allow_avatar_expand),
            show_location = COALESCE((v_patch -> 'settings' ->> 'show_location')::boolean, ps.show_location),
            show_local_time = COALESCE((v_patch -> 'settings' ->> 'show_local_time')::boolean, ps.show_local_time),
            updated_at = now();
    END IF;
    -- #endregion

    RETURN jsonb_build_object('ok', true);
END;
$$;

-- Point the profile photo at a new AVATAR RENDITION. The pipeline has already written the rendition
-- (service role, after the quarantine scan) — this is the step that decides whether the caller may
-- put it on this profile, and it re-checks everything about the file rather than trusting that the
-- id came from the pipeline: it must be a live, public avatar rendition in the avatars bucket,
-- belonging to this profile's owner. The previous rendition is retired (soft-deleted) so it leaves
-- every listing; its bytes stay, because nothing here is hard-deleted.
CREATE OR REPLACE FUNCTION org.set_profile_avatar(p_owner_type text, p_owner_id uuid, p_file_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_prev uuid;
BEGIN
    IF auth.uid () IS NULL OR NOT org.fn_profile_manages (p_owner_type, p_owner_id) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'owner: you cannot edit this profile';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM files.items i
        WHERE i.id = p_file_id
          AND i.purpose = 'avatar'::files.asset_purpose
          AND i.bucket_id = 'avatars'
          AND i.visibility = 'public'::files.file_visibility
          AND i.status = 'uploaded'::files.file_status
          AND i.deleted_at IS NULL
          AND ((p_owner_type = 'user' AND i.owner_type = 'user'::files.owner_kind AND i.owner_user_id = p_owner_id)
               OR (p_owner_type <> 'user' AND i.owner_type::text = p_owner_type AND i.owner_entity_id = p_owner_id))
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'file: not a processed profile photo for this profile';
    END IF;

    IF p_owner_type = 'user' THEN
        SELECT u.avatar_file_id INTO v_prev FROM org.users_public u WHERE u.user_id = p_owner_id;
        UPDATE org.users_public SET avatar_file_id = p_file_id, updated_at = now() WHERE user_id = p_owner_id;
    ELSIF p_owner_type = 'team' THEN
        SELECT t.avatar_file_id INTO v_prev FROM org.teams t WHERE t.id = p_owner_id;
        UPDATE org.teams SET avatar_file_id = p_file_id, updated_at = now() WHERE id = p_owner_id;
    ELSIF p_owner_type = 'business' THEN
        SELECT b.logo_file_id INTO v_prev FROM org.business_profiles b WHERE b.id = p_owner_id;
        UPDATE org.business_profiles SET logo_file_id = p_file_id, updated_at = now() WHERE id = p_owner_id;
    ELSE
        SELECT o.logo_file_id INTO v_prev FROM org.organisations o WHERE o.id = p_owner_id;
        UPDATE org.organisations SET logo_file_id = p_file_id, updated_at = now() WHERE id = p_owner_id;
    END IF;

    IF v_prev IS NOT NULL AND v_prev <> p_file_id THEN
        UPDATE files.items SET deleted_at = now()
        WHERE id = v_prev AND purpose = 'avatar'::files.asset_purpose AND deleted_at IS NULL;
    END IF;
    RETURN jsonb_build_object('ok', true, 'file_id', p_file_id, 'previous', v_prev);
END;
$$;

-- Replace the showcase with the given slots in ONE transaction: `p_slots` is the whole grid,
-- `[{position, file_id, alt}]`, and a slot absent from it is emptied. Every file must be a live,
-- public SHOWCASE rendition of this profile's owner; slot 1 — the primary thumbnail every card
-- leads with — must be an image. Renditions that drop out of the grid are retired.
CREATE OR REPLACE FUNCTION org.save_showcase(p_owner_type text, p_owner_id uuid, p_slots jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid ();
    v_slot jsonb;
    v_pos integer;
    v_file uuid;
    v_mime text;
    v_before uuid[];
    v_after uuid[] := '{}';
BEGIN
    IF v_uid IS NULL OR NOT org.fn_profile_manages (p_owner_type, p_owner_id) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'owner: you cannot edit this profile';
    END IF;
    IF jsonb_typeof(COALESCE(p_slots, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_slots) > 6 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'slots: up to six showcase slots';
    END IF;

    SELECT COALESCE(array_agg(s.file_id), '{}') INTO v_before
    FROM org.profile_showcase_items s WHERE s.owner_type = p_owner_type AND s.owner_id = p_owner_id;

    DELETE FROM org.profile_showcase_items s WHERE s.owner_type = p_owner_type AND s.owner_id = p_owner_id;

    FOR v_slot IN SELECT * FROM jsonb_array_elements(p_slots) LOOP
        v_pos := NULLIF(v_slot ->> 'position', '')::integer;
        v_file := NULLIF(v_slot ->> 'file_id', '')::uuid;
        IF v_pos IS NULL OR v_pos NOT BETWEEN 1 AND 6 OR v_file IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'slots: every slot needs a position (1–6) and a file';
        END IF;
        IF char_length(COALESCE(v_slot ->> 'alt', '')) > 200 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('slots.%s: alternative text is 200 characters or fewer', v_pos);
        END IF;
        SELECT i.mime_type INTO v_mime
        FROM files.items i
        WHERE i.id = v_file
          AND i.purpose = 'showcase'::files.asset_purpose
          AND i.bucket_id = 'showcase'
          AND i.visibility = 'public'::files.file_visibility
          AND i.status = 'uploaded'::files.file_status
          AND i.deleted_at IS NULL
          AND ((p_owner_type = 'user' AND i.owner_type = 'user'::files.owner_kind AND i.owner_user_id = p_owner_id)
               OR (p_owner_type <> 'user' AND i.owner_type::text = p_owner_type AND i.owner_entity_id = p_owner_id));
        IF v_mime IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('slots.%s: not a processed showcase file for this profile', v_pos);
        END IF;
        IF v_pos = 1 AND v_mime NOT LIKE 'image/%' THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'slots.1: the first slot is the profile''s thumbnail and must be an image';
        END IF;
        INSERT INTO org.profile_showcase_items (owner_type, owner_id, position, file_id, alt, created_by)
        VALUES (p_owner_type, p_owner_id, v_pos, v_file, COALESCE(v_slot ->> 'alt', ''), v_uid);
        v_after := v_after || v_file;
    END LOOP;

    UPDATE files.items i SET deleted_at = now()
    WHERE i.id = ANY (v_before) AND NOT (i.id = ANY (v_after))
      AND i.purpose = 'showcase'::files.asset_purpose AND i.deleted_at IS NULL;

    RETURN jsonb_build_object('ok', true, 'slots', jsonb_array_length(p_slots));
END;
$$;
-- #endregion
