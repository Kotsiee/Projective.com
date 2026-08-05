-- =============================================================================
-- RLS POLICIES — projects & files schemas
-- Consolidated verbatim from the original numbered migrations (Category 2:
-- Security, RLS & Permissions). Source file noted before each statement group.
-- =============================================================================


-- --- from 0119_project_lifecycle.sql ---

CREATE POLICY "View project status history" ON projects.project_status_history FOR
SELECT TO public USING (
    actor_user_id = auth.uid()
    OR projects.has_project_access (project_id)
    OR EXISTS (
        SELECT 1 FROM projects.projects p
        WHERE p.id = project_status_history.project_id
            AND (p.owner_user_id = auth.uid()
                OR (p.client_business_id IS NOT NULL AND org.is_active_business_member (p.client_business_id)))
    )
);


-- --- from 0204_projects.sql ---

CREATE POLICY "Project owner can view activity" ON projects.project_activity FOR
SELECT TO public USING (
        EXISTS (
            SELECT 1
            FROM projects.projects p
            WHERE
                p.id = project_activity.project_id
                AND p.owner_user_id = auth.uid ()
        )
    );

CREATE POLICY "Users can insert their own activity" ON projects.project_activity FOR
INSERT
    TO public
WITH
    CHECK (auth.uid () = actor_user_id);

CREATE POLICY "Owner manage assignments" ON projects.stage_assignments FOR ALL TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.project_stages s
            JOIN projects.projects p ON p.id = s.project_id
        WHERE
            s.id = stage_assignments.project_stage_id
            AND p.owner_user_id = auth.uid ()
    )
);

CREATE POLICY "View assignments" ON projects.stage_assignments FOR
SELECT TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.project_stages s
        JOIN projects.projects p ON p.id = s.project_id
        WHERE s.id = stage_assignments.project_stage_id
        AND (
            p.owner_user_id = auth.uid() 
            OR (p.status = 'active'::project_status AND p.visibility = 'public'::visibility)
        )
    )
);

CREATE POLICY "Owner manage budget rules" ON projects.stage_budget_rules FOR ALL TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.project_stages s
            JOIN projects.projects p ON p.id = s.project_id
        WHERE
            s.id = stage_budget_rules.project_stage_id
            AND p.owner_user_id = auth.uid ()
    )
);

CREATE POLICY "View budget rules" ON projects.stage_budget_rules FOR
SELECT TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.project_stages s
        JOIN projects.projects p ON p.id = s.project_id
        WHERE s.id = stage_budget_rules.project_stage_id
        AND (
            p.owner_user_id = auth.uid() 
            OR (p.status = 'active'::project_status AND p.visibility = 'public'::visibility)
        )
    )
);

CREATE POLICY "Users can view/manage own contracts" ON projects.maintenance_contracts FOR ALL TO public USING (
    freelancer_profile_id = auth.uid ()
    OR EXISTS (
        SELECT 1
        FROM projects.projects p
        WHERE
            p.id = maintenance_contracts.project_id
            AND p.owner_user_id = auth.uid ()
    )
);

CREATE POLICY "Manage seats own" ON projects.stage_open_seats FOR ALL TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.project_stages s
            JOIN projects.projects p ON p.id = s.project_id
        WHERE
            s.id = stage_open_seats.project_stage_id
            AND p.owner_user_id = auth.uid ()
    )
);

CREATE POLICY "View seats public or own" ON projects.stage_open_seats FOR
SELECT TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.project_stages s
        JOIN projects.projects p ON p.id = s.project_id
        WHERE s.id = stage_open_seats.project_stage_id
        AND (
            p.owner_user_id = auth.uid() 
            OR (p.status = 'active'::project_status AND p.visibility = 'public'::visibility)
        )
    )
);

CREATE POLICY "Owner manage participants" ON projects.project_participants FOR ALL TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.projects p
        WHERE
            p.id = project_participants.project_id
            AND p.owner_user_id = auth.uid ()
    )
);

CREATE POLICY "View participants" ON projects.project_participants FOR
SELECT TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.projects p
        WHERE p.id = project_participants.project_id
        AND (
            p.owner_user_id = auth.uid() 
            OR (p.status = 'active'::project_status AND p.visibility = 'public'::visibility)
        )
    )
);

CREATE POLICY "Public can view active published projects" ON projects.projects FOR
SELECT TO public USING (status = 'active'::project_status AND visibility = 'public'::visibility);

CREATE POLICY "Users can create projects" ON projects.projects FOR
INSERT
    TO public
WITH
    CHECK (auth.uid () = owner_user_id);

CREATE POLICY "Users can delete own projects" ON projects.projects FOR DELETE TO public USING (auth.uid () = owner_user_id);

CREATE POLICY "Users can update own projects" ON projects.projects FOR
UPDATE TO public USING (auth.uid () = owner_user_id);

CREATE POLICY "Users can view own projects" ON projects.projects FOR
SELECT TO public USING (auth.uid () = owner_user_id);

CREATE POLICY "Manage own revisions" ON projects.stage_revision_requests FOR ALL TO public USING (requested_by = auth.uid ());

CREATE POLICY "View revisions" ON projects.stage_revision_requests FOR
SELECT TO public USING (
        requested_by = auth.uid ()
        OR EXISTS (
            SELECT 1
            FROM projects.project_stages s
                JOIN projects.projects p ON p.id = s.project_id
            WHERE
                s.id = stage_revision_requests.project_stage_id
                AND p.owner_user_id = auth.uid ()
        )
    );

CREATE POLICY "Manage roles own" ON projects.stage_staffing_roles FOR ALL TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.project_stages s
            JOIN projects.projects p ON p.id = s.project_id
        WHERE
            s.id = stage_staffing_roles.project_stage_id
            AND p.owner_user_id = auth.uid ()
    )
);

CREATE POLICY "View roles public or own" ON projects.stage_staffing_roles FOR
SELECT TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.project_stages s
        JOIN projects.projects p ON p.id = s.project_id
        WHERE s.id = stage_staffing_roles.project_stage_id
        AND (
            p.owner_user_id = auth.uid() 
            OR (p.status = 'active'::project_status AND p.visibility = 'public'::visibility)
        )
    )
);

CREATE POLICY "Users can manage stages of own projects" ON projects.project_stages FOR ALL TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.projects p
        WHERE
            p.id = project_stages.project_id
            AND p.owner_user_id = auth.uid ()
    )
);

CREATE POLICY "Users can view stages of visible projects" ON projects.project_stages FOR
SELECT TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.projects p
        WHERE p.id = project_stages.project_id
        AND (
            p.owner_user_id = auth.uid()
            OR (p.status = 'active'::project_status AND p.visibility = 'public'::visibility)
        )
    )
);

-- Assigned freelancers / business members / team members can read stages of projects they work on.
CREATE POLICY "Participants can view stages" ON projects.project_stages FOR
SELECT TO public USING (projects.has_project_access (project_stages.project_id));

CREATE POLICY "Insert own submissions" ON projects.stage_submissions FOR
INSERT
    TO public
WITH
    CHECK (submitted_by = auth.uid ());

-- Assignee and project owner always see the ticket; other participants / the public see it unless it
-- is suspended inside an active workload-report ("reported_hidden") window.
CREATE POLICY "View tickets" ON projects.tickets FOR
SELECT TO public USING (
        current_assignee_id = auth.uid ()
        OR EXISTS (
            SELECT 1 FROM projects.projects p
            WHERE p.id = project_id AND p.owner_user_id = auth.uid ()
        )
        OR (
            (
                projects.has_project_access (project_id)
                OR EXISTS (
                    SELECT 1 FROM projects.projects p
                    WHERE p.id = project_id
                        AND p.status = 'active'::project_status
                        AND p.visibility = 'public'::visibility
                )
            )
            AND NOT (
                status = 'reported_hidden'::ticket_status
                AND hidden_until IS NOT NULL
                AND hidden_until > now()
            )
        )
    );

-- The assignee manages their claimed ticket; the project owner manages otherwise. Column-level
-- immutability once claimed is enforced by projects.fn_ticket_immutability_guard (0007).
CREATE POLICY "Manage tickets" ON projects.tickets FOR ALL TO public USING (
    current_assignee_id = auth.uid ()
    OR EXISTS (
        SELECT 1 FROM projects.projects p
        WHERE p.id = project_id AND p.owner_user_id = auth.uid ()
    )
)
WITH CHECK (
    current_assignee_id = auth.uid ()
    OR EXISTS (
        SELECT 1 FROM projects.projects p
        WHERE p.id = project_id AND p.owner_user_id = auth.uid ()
    )
);

-- Only the ticket's current assignee (the working freelancer) may flag a workload mismatch.
CREATE POLICY "File workload report" ON projects.ticket_workload_reports FOR
INSERT
    TO public
WITH
    CHECK (
        reporter_user_id = auth.uid ()
        AND EXISTS (
            SELECT 1 FROM projects.tickets t
            WHERE t.id = ticket_id AND t.current_assignee_id = auth.uid ()
        )
    );

CREATE POLICY "View workload reports" ON projects.ticket_workload_reports FOR
SELECT TO public USING (
        reporter_user_id = auth.uid ()
        OR EXISTS (
            SELECT 1
            FROM projects.tickets t
                JOIN projects.projects p ON p.id = t.project_id
            WHERE t.id = ticket_id
                AND (p.owner_user_id = auth.uid () OR projects.has_project_access (p.id))
        )
    );

CREATE POLICY "View cohorts" ON projects.cohorts FOR
SELECT TO public USING (
        EXISTS (
            SELECT 1
            FROM projects.cohort_memberships cm
            WHERE
                cm.cohort_id = id
                AND cm.user_id = auth.uid ()
        )
        OR EXISTS (
            SELECT 1
            FROM projects.projects p
            WHERE
                p.id = project_id
                AND (
                    p.owner_user_id = auth.uid ()
                    OR p.visibility = 'public'
                )
        )
    );

CREATE POLICY "Manage cohorts" ON projects.cohorts FOR ALL TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.projects p
        WHERE
            p.id = project_id
            AND p.owner_user_id = auth.uid ()
    )
);

CREATE POLICY "View cohort memberships" ON projects.cohort_memberships FOR
SELECT TO public USING (
        user_id = auth.uid ()
        OR EXISTS (
            SELECT 1
            FROM projects.cohorts c
                JOIN projects.projects p ON p.id = c.project_id
            WHERE
                c.id = cohort_id
                AND p.owner_user_id = auth.uid ()
        )
    );

CREATE POLICY "Manage cohort memberships" ON projects.cohort_memberships FOR ALL TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.cohorts c
            JOIN projects.projects p ON p.id = c.project_id
        WHERE
            c.id = cohort_id
            AND p.owner_user_id = auth.uid ()
    )
);

CREATE POLICY "View session events" ON projects.session_events FOR
SELECT TO public USING (
        EXISTS (
            SELECT 1
            FROM projects.cohort_memberships cm
            WHERE
                cm.cohort_id = cohort_id
                AND cm.user_id = auth.uid ()
        )
        OR EXISTS (
            SELECT 1
            FROM projects.cohorts c
                JOIN projects.projects p ON p.id = c.project_id
            WHERE
                c.id = cohort_id
                AND p.owner_user_id = auth.uid ()
        )
    );

CREATE POLICY "Manage session events" ON projects.session_events FOR ALL TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.cohorts c
            JOIN projects.projects p ON p.id = c.project_id
        WHERE
            c.id = cohort_id
            AND p.owner_user_id = auth.uid ()
    )
);

CREATE POLICY "View own attendance" ON projects.session_attendance FOR
SELECT TO public USING (
        user_id = auth.uid ()
        OR EXISTS (
            SELECT 1
            FROM projects.session_events se
                JOIN projects.cohorts c ON c.id = se.cohort_id
                JOIN projects.projects p ON p.id = c.project_id
            WHERE
                se.id = session_event_id
                AND p.owner_user_id = auth.uid ()
        )
    );

CREATE POLICY "Log own attendance" ON projects.session_attendance FOR
INSERT
    TO public
WITH
    CHECK (user_id = auth.uid ());

CREATE POLICY "View waitlists" ON projects.waitlists FOR
SELECT TO public USING (
        user_id = auth.uid ()
        OR EXISTS (
            SELECT 1
            FROM marketplace.service_blueprints sb
            WHERE
                sb.id = service_blueprint_id
                AND sb.freelancer_profile_id = auth.uid ()
        )
    );

CREATE POLICY "Join waitlist" ON projects.waitlists FOR
INSERT
    TO public
WITH
    CHECK (user_id = auth.uid ());

CREATE POLICY "Manage waitlists" ON projects.waitlists FOR
UPDATE TO public USING (
    user_id = auth.uid ()
    OR EXISTS (
        SELECT 1
        FROM marketplace.service_blueprints sb
        WHERE
            sb.id = service_blueprint_id
            AND sb.freelancer_profile_id = auth.uid ()
    )
);

CREATE POLICY "Leave waitlist" ON projects.waitlists FOR DELETE TO public USING (user_id = auth.uid ());


-- --- from 0208_files.sql ---

-- =============================================================================================
-- ⚠️ BEHAVIOUR CHANGE TO A SHIPPED POLICY — READ THIS BEFORE TOUCHING THE FILES POLICIES.
--
-- The SELECT policy below REPLACES `"Authenticated users can view files" USING (true)`, which has
-- been live since 0208. That predicate meant literally what it said: ANY signed-in account could
-- read EVERY row of files.items — every other tenant's filename, MIME type, size, storage path and
-- bucket, across every project, DM and private drive on the platform. It was not a scoping bug in
-- one branch; there was no scoping at all.
--
-- It is now delegated to files.fn_can_read(id) — the SINGLE read predicate the share route also
-- calls, so the two cannot drift (00001160). Consequences that are intended, not oversights:
--   * A cross-tenant `SELECT * FROM files.items` now returns only rows the caller owns, is an
--     active member of the owning entity for, has project access to, or that are `public`.
--   * `link` visibility deliberately does NOT satisfy this predicate. The opaque slug is the
--     credential; honouring `link` here would let any signed-in user enumerate every shared asset.
--     The share route resolves slug -> item through files.fn_resolve_share(slug) instead.
--   * Any existing caller that relied on reading a foreign row will now get zero rows rather than
--     an error. Nothing raises; a leak just stops.
-- =============================================================================================
CREATE POLICY "Users can view permitted files" ON files.items FOR
SELECT TO authenticated USING (files.fn_can_read (id));

-- Public assets are readable without an account (the world-readable tier of files.file_visibility).
CREATE POLICY "Public files are viewable by everyone" ON files.items FOR
SELECT TO anon USING (
    visibility = 'public'::files.file_visibility
    AND deleted_at IS NULL
);

CREATE POLICY "Users can insert own files" ON files.items FOR
INSERT
    TO authenticated
WITH
    CHECK (owner_user_id = auth.uid ());

-- ⚠️ The WITH CHECK arm is new. The shipped policy had USING only, and an UPDATE policy without a
-- WITH CHECK validates the row you STARTED from, never the row you are writing — so a user could
-- take their own row and set `owner_user_id` to someone else (donating a row into another tenancy)
-- or repoint `bucket_id`/`storage_path` at another tenant's stored object and read it back through
-- their own now-legitimate row. Both are closed by re-asserting ownership on the post-image.
CREATE POLICY "Users can update own files" ON files.items FOR
UPDATE TO authenticated USING (owner_user_id = auth.uid ())
WITH
    CHECK (owner_user_id = auth.uid ());

CREATE POLICY "Users can delete own files" ON files.items FOR DELETE TO authenticated USING (owner_user_id = auth.uid ());


-- --- files.folders — the hierarchy (RLS newly ENABLED in 00002001; see the note there) ---

-- Read: the creator, or an active member of the owning entity. Mirrors fn_can_read's ownership
-- arms; folders carry no project-mount case (a mounted connector directory is reached through its
-- connection, and a project's tree is the channel tree, not a folder).
CREATE POLICY "Users can view permitted folders" ON files.folders FOR
SELECT TO authenticated USING (
    owner_user_id = auth.uid ()
    OR visibility = 'public'::files.file_visibility
    OR (owner_type = 'team'::files.owner_kind AND org.is_active_team_member (owner_entity_id))
    OR (owner_type = 'business'::files.owner_kind AND org.is_active_business_member (owner_entity_id))
    OR (owner_type = 'organisation'::files.owner_kind AND org.is_organisation_member (owner_entity_id))
);

CREATE POLICY "Users can insert own folders" ON files.folders FOR
INSERT
    TO authenticated
WITH
    CHECK (owner_user_id = auth.uid ());

-- Same WITH CHECK discipline as files.items: the post-image must still belong to the caller, so a
-- folder cannot be re-parented INTO another tenant's tree or donated out of this one.
CREATE POLICY "Users can update own folders" ON files.folders FOR
UPDATE TO authenticated USING (owner_user_id = auth.uid ())
WITH
    CHECK (owner_user_id = auth.uid ());

CREATE POLICY "Users can delete own folders" ON files.folders FOR DELETE TO authenticated USING (owner_user_id = auth.uid ());


-- --- files.share_links — READ-ONLY, revocable grants ---

-- The creator manages their own links; there is no "any member" arm, because revocation authority
-- must sit with the person who took the decision to publish.
--
-- The WITH CHECK arm asserts TWO independent things, and the second is load-bearing. `created_by =
-- auth.uid()` only proves the row is not being attributed to someone else; on its own it lets any
-- signed-in user INSERT (slug, item_id => an asset they do NOT own, created_by => self) — and
-- because `authenticated` holds a direct INSERT grant on this table (00002500) and
-- files.fn_resolve_share is SECURITY DEFINER and checks only liveness, that forged link would
-- resolve and serve the bytes. It needs a known id, which uuid4 makes unguessable in general, but
-- ids leak legitimately: a member removed from a team, or a user removed from a project, keeps
-- every id they ever saw and could otherwise mint themselves permanent access on the way out.
--
-- The same predicate governs UPDATE, so an existing link cannot be re-pointed at another tenant's
-- asset after the fact.
--
-- Deliberately STRICT: authority is `owner_user_id = auth.uid()`, so an ENTITY-owned (team /
-- business / organisation) asset cannot currently be shared by a member who is not its owner. That
-- fails CLOSED, which is the correct direction to be wrong in while the entity share-capability
-- question is still open (see the connections owner-axis flag, Decision #59). Widening it is a
-- deliberate decision that belongs with whoever settles that, not a side effect of this pass.
CREATE POLICY "Creators manage their share links" ON files.share_links FOR ALL TO authenticated USING (created_by = auth.uid ())
WITH
    CHECK (
        created_by = auth.uid ()
        AND (
            item_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM files.items i
                WHERE i.id = share_links.item_id
                    AND i.owner_user_id = auth.uid ()
                    AND i.deleted_at IS NULL
            )
        )
        AND (
            folder_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM files.folders f
                WHERE f.id = share_links.folder_id
                    AND f.owner_user_id = auth.uid ()
                    AND f.deleted_at IS NULL
            )
        )
    );

-- ⚠️ DEVIATION FROM THE BRIEF — FLAGGED, NOT SILENTLY RESOLVED. READ BEFORE "FIXING" THIS.
--
-- The brief specified a visitor-facing policy: `anon SELECT ... USING (revoked_at IS NULL AND
-- (expires_at IS NULL OR expires_at > now()))`. Taken literally that is a credential leak, because
-- RLS filters ROWS — it cannot require that the caller already knew the slug. Granting anon SELECT
-- on this table plus that predicate lets any anonymous visitor run
--
--     SELECT slug FROM files.share_links
--
-- through PostgREST and harvest EVERY live share slug on the platform. The slug is the credential;
-- an enumerable credential is not a credential, and revocation would become meaningless.
--
-- Resolved structurally, the way the codebase already handles a secret it must expose an operation
-- on but never the value of (integrations.connection_secrets: RLS on, no policy, definer only;
-- "column safety is structural, not a policy" — Decision #56 §(c)):
--   * NO anon or authenticated table grant, and therefore no enumerable SELECT policy.
--   * A SECURITY DEFINER resolver, files.fn_resolve_share(slug), which REQUIRES the slug as input
--     and carries the exact revoked/expired predicate the brief asked for — so the rule still lives
--     in one place and a forgotten check in one route still cannot resurrect a revoked link.
--
-- The predicate is unchanged. Only the reachability model is: you must present the slug, rather
-- than being handed the list.


-- --- files.download_events — the audit trail ---

-- Read-own only, and NO client INSERT policy anywhere in this file. That absence is the point:
-- "this asset was downloaded" is a server observation, not a claim a browser gets to make (the
-- same discipline as comms.notifications, Decision #57). The schema-wide INSERT grant in 00002500
-- is harmless precisely because RLS is on and no INSERT policy exists.
CREATE POLICY "Actors and owners can read download events" ON files.download_events FOR
SELECT TO authenticated USING (
    actor_user_id = auth.uid ()
    OR EXISTS (
        SELECT 1
        FROM files.items i
        WHERE i.id = download_events.item_id
            AND i.owner_user_id = auth.uid ()
    )
);


-- --- files.storage_usage — the metered rollup ---

-- Read-own so the hub can render "12.4 GB of 25 GB used" without a round trip through a service.
-- No write policy at all: the rollup is maintained exclusively by files.fn_usage_trigger (a
-- SECURITY DEFINER trigger) and by the service role — a client that could write it could write
-- itself unlimited storage.
CREATE POLICY "Owners can read their storage usage" ON files.storage_usage FOR
SELECT TO authenticated USING (
    (owner_type = 'user'::files.owner_kind AND owner_id = auth.uid ())
    OR (owner_type = 'team'::files.owner_kind AND org.is_active_team_member (owner_id))
    OR (owner_type = 'business'::files.owner_kind AND org.is_active_business_member (owner_id))
    OR (owner_type = 'organisation'::files.owner_kind AND org.is_organisation_member (owner_id))
);


-- --- from 0303_projects_lifecycle_rls.sql ---

CREATE POLICY "View submissions" ON projects.stage_submissions FOR
SELECT TO public USING (
    submitted_by = auth.uid ()
    OR projects.has_project_access (
        (SELECT ps.project_id FROM projects.project_stages ps WHERE ps.id = stage_submissions.project_stage_id)
    )
    OR EXISTS (
        SELECT 1
        FROM projects.project_stages s
        JOIN projects.projects p ON p.id = s.project_id
        WHERE s.id = stage_submissions.project_stage_id
            AND (
                p.owner_user_id = auth.uid ()
                OR (p.client_business_id IS NOT NULL AND org.is_active_business_member (p.client_business_id))
            )
    )
);

CREATE POLICY "View submission files" ON projects.submission_files FOR
SELECT TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.stage_submissions ss
        JOIN projects.project_stages s ON s.id = ss.project_stage_id
        JOIN projects.projects p ON p.id = s.project_id
        WHERE ss.id = submission_files.submission_id
            AND (
                ss.submitted_by = auth.uid ()
                OR projects.has_project_access (p.id)
                OR p.owner_user_id = auth.uid ()
                OR (p.client_business_id IS NOT NULL AND org.is_active_business_member (p.client_business_id))
            )
    )
);


-- --- from 0307_stage_staffing.sql ---

CREATE POLICY "View seat skills" ON projects.stage_open_seat_skills FOR SELECT TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.stage_open_seats s
        JOIN projects.project_stages ps ON ps.id = s.project_stage_id
        WHERE s.id = stage_open_seat_skills.seat_id
            AND (projects.has_project_access (ps.project_id) OR EXISTS (
                SELECT 1 FROM projects.projects p
                WHERE p.id = ps.project_id AND p.status = 'active'::project_status
            ))
    )
);

CREATE POLICY "View own or owned applications" ON projects.project_applications FOR SELECT TO public USING (
    applicant_user_id = auth.uid()
    OR projects.can_review_project (project_id)
);

CREATE POLICY "View application targets" ON projects.project_application_targets FOR SELECT TO public USING (
    EXISTS (
        SELECT 1 FROM projects.project_applications pa
        WHERE pa.id = project_application_targets.application_id
            AND (pa.applicant_user_id = auth.uid() OR projects.can_review_project (pa.project_id))
    )
);
