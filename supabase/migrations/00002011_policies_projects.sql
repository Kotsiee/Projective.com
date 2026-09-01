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

-- The WITH CHECK arm is EXPLICIT, not corrective. Postgres already uses an UPDATE policy's `USING`
-- expression as its `WITH CHECK` when none is written, so `USING`-only did NOT let an owner reassign
-- `owner_user_id` — verified by reconstructing the previous policy and attempting exactly that:
--   ERROR:  new row violates row-level security policy for table "projects"
-- It is spelled out because a reader should not have to know that defaulting rule to see that the
-- post-image is constrained, and because the two arms genuinely diverge on other tables — but it
-- changes no behaviour here.
--
-- ⚠️ Do NOT read the twelve remaining `USING`-only `FOR ALL` policies in this schema as holes on the
-- strength of a missing `WITH CHECK` alone. They may each still deserve a narrower post-image
-- predicate; they are not open by default.
CREATE POLICY "Users can update own projects" ON projects.projects FOR
UPDATE TO public USING (auth.uid () = owner_user_id)
WITH
    CHECK (auth.uid () = owner_user_id);

CREATE POLICY "Users can view own projects" ON projects.projects FOR
SELECT TO public USING (auth.uid () = owner_user_id);

-- The missing arm. Until this policy existed the only two SELECT paths on this
-- table were "I own it" and "it is active AND public", so a freelancer hired onto
-- a private project could not read the project row at all — the engagement they
-- were working on was invisible to them, while every stranger's public listing was
-- not. Every dependent read (detail, board, members, files, submissions) inherited
-- that hole, because each of them resolves the project first.
--
-- projects.has_project_access() is the predicate the rest of this schema already
-- uses for exactly this question — owner, freelancer participant, business
-- participant, stage assignee, or a member of an assigned team — so the definition
-- of "involved" stays in one place rather than being restated here. It is
-- SECURITY DEFINER, so reading projects.projects inside it does not re-enter this
-- policy.
CREATE POLICY "Participants can view their projects" ON projects.projects FOR
SELECT TO authenticated USING (projects.has_project_access (id));

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

-- ⚠️ The stage-access arm is load-bearing. `submitted_by = auth.uid()` on its own proves only that
-- the row is not being attributed to somebody else; it says nothing about WHERE the row lands. Any
-- authenticated caller could therefore file a deliverable against any stage id they had ever seen —
-- and a submission is not inert: it appears in the client's review queue, and
-- projects.review_submission drives stage approval from there. Stage ids leak legitimately (a
-- freelancer released from a stage keeps every id they worked with), so unguessability was never the
-- protection.
--
-- projects.has_stage_access is the predicate the stage rooms already use for "does this person
-- belong to this stage" — the paying side, or live talent assigned to it — so the definition stays
-- in one place rather than being restated here.
CREATE POLICY "Insert own submissions" ON projects.stage_submissions FOR
INSERT
    TO public
WITH
    CHECK (
        submitted_by = auth.uid ()
        AND projects.has_stage_access (project_stage_id)
    );

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

-- A freelancer sends their OWN submission for review, and only while it is still a draft.
--
-- Narrow on purpose, in both directions. `USING` bounds the PRE-image to a draft the caller wrote, so
-- one member cannot send another's work and nobody can reopen a delivery the client is already
-- reviewing. `WITH CHECK` bounds the POST-image to `pending_review` on the same row, so the statement
-- that is allowed to send a draft cannot also re-point it at another stage, re-attribute it, or mark
-- it accepted -- a review verdict belongs to `projects.review_submission`, never to the submitter.
--
-- Postgres would otherwise reuse `USING` as the check, which reads as symmetric and is not: it would
-- permit an UPDATE whose post-image is still a draft, i.e. silent edits to a row after the fact.
CREATE POLICY "Submit own draft submissions" ON projects.stage_submissions FOR
UPDATE TO authenticated USING (
  submitted_by = auth.uid()
  AND status = 'draft'
) WITH CHECK (
  submitted_by = auth.uid()
  AND status = 'pending_review'
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

-- The WITH CHECK arm is EXPLICIT, not corrective. Postgres substitutes an UPDATE policy's `USING`
-- expression for its `WITH CHECK` when none is written, so the shipped USING-only policy DID already
-- constrain the post-image — verified by reconstructing it and attempting exactly the escape:
--   ERROR:  new row violates row-level security policy for table "items"
-- What it stops is therefore real and was never open: donating a row into another tenancy by setting
-- `owner_user_id`, or repointing `bucket_id`/`storage_path` at another tenant's stored object and
-- reading it back through a row that is legitimately yours. Written out because a reader should not
-- have to know the substitution rule to see that the post-image is constrained.
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

-- This table had SELECT and nothing else, so a submission could be read with its files and never
-- created with them: the link row is what turns a deliverable into a deliverable, and without an
-- INSERT path the whole submit flow was reachable only through projects.submit_deliverable's
-- definer context. The write path the API needs is a client one.
--
-- Authority is the PARENT submission's author, not project access. A deliverable is a claim about
-- what one person delivered, so attaching a file to somebody else's submission would let a third
-- party alter the evidence a client reviews and a dispute is settled against.
CREATE POLICY "Attach files to own submissions" ON projects.submission_files FOR
INSERT
    TO authenticated
WITH
    CHECK (
        EXISTS (
            SELECT 1
            FROM projects.stage_submissions ss
            WHERE ss.id = submission_files.submission_id
                AND ss.submitted_by = auth.uid ()
        )
    );

-- Detaching a mistaken attachment is the same authority as making one. It removes only the LINK —
-- the files.items row is untouched and remains in the submitter's library — so this is not the hard
-- deletion root CLAUDE.md §7 forbids.
CREATE POLICY "Detach files from own submissions" ON projects.submission_files FOR
DELETE TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM projects.stage_submissions ss
        WHERE ss.id = submission_files.submission_id
            AND ss.submitted_by = auth.uid ()
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


-- =============================================================================
-- AUDIT LOG, PREFERENCES, REQUIRED SKILLS, INVITATIONS
--
-- These four tables had RLS switched OFF entirely (00002001 never named them)
-- while 00002500 grants `ALL ON ALL TABLES IN SCHEMA projects TO authenticated`.
-- RLS is enabled on all four in 00002001; these are their policies. The
-- consequences that combination carried are recorded there, table by table.
-- =============================================================================

-- --- ticket_history: readable by the project, WRITTEN BY NOBODY ---
--
-- There is deliberately no INSERT, UPDATE or DELETE policy, and that absence is
-- the point rather than an omission. Every row here is written by a
-- SECURITY DEFINER RPC — projects.move_ticket, projects.fn_assign_ticket_core and
-- their siblings — which bypasses RLS entirely, so the table stays fully writable
-- by the paths that are supposed to write it. A client write path could only ever
-- be a forgery route: "this ticket was moved to Done by X" is a server
-- observation, not a claim a browser gets to make, and being able to delete the
-- entry that records what really happened is worse still, because the timeline is
-- read as evidence. Same discipline as comms.notifications (Decision #57) and
-- files.download_events.
--
-- Scoped to the ticket's PROJECT rather than to the actor: a timeline that showed
-- a reader only their own moves would misrepresent the history it is drawn as.
CREATE POLICY "View ticket history" ON projects.ticket_history FOR
SELECT TO authenticated USING (
    EXISTS (
        SELECT 1
        FROM projects.tickets t
        WHERE t.id = ticket_history.ticket_id
            AND projects.has_project_access (t.project_id)
    )
);

-- --- user_preferences: one person's own view state ---
--
-- Starred, archived and last-viewed are per-viewer facts about somebody's own
-- workspace; nothing renders another user's. BOTH arms are written out even though
-- `FOR ALL ... USING (x)` with no WITH CHECK already applies `x` to the post-image
-- too — the arm is explicit, not corrective. What it constrains is real: without a
-- post-image predicate a caller could take their own row and rewrite `user_id` to
-- somebody else's in the same statement, silently starring a project on another
-- account. Spelled out so that is visible without knowing the substitution rule.
CREATE POLICY "Manage own project preferences" ON projects.user_preferences FOR ALL TO authenticated USING (user_id = auth.uid ())
WITH
    CHECK (user_id = auth.uid ());

-- --- project_required_skills: the staffing requirement list ---
--
-- Readable by anyone who can reach the project, because the requirement is part
-- of what a participant is working against. Writable by the OWNER only: the skill
-- list is what proposals are matched and filtered on, so an outside edit changes
-- who the project appears to want.
CREATE POLICY "View required skills" ON projects.project_required_skills FOR
SELECT TO authenticated USING (projects.has_project_access (project_id));

CREATE POLICY "Owner manages required skills" ON projects.project_required_skills FOR ALL TO authenticated USING (
    EXISTS (
        SELECT 1 FROM projects.projects p
        WHERE p.id = project_required_skills.project_id AND p.owner_user_id = auth.uid ()
    )
)
WITH
    CHECK (
        EXISTS (
            SELECT 1 FROM projects.projects p
            WHERE p.id = project_required_skills.project_id AND p.owner_user_id = auth.uid ()
        )
    );

-- --- project_invitations: the token IS the access ---
--
-- 🚨 Never a blanket read. This table's own comment calls `token` the capability:
-- whoever holds the value can accept the invitation and be granted the role it
-- names. RLS is row-level, so a policy that admits a row admits its token, and
-- there is no column-level fallback while 00002500 grants the whole table to
-- `authenticated`. A permissive SELECT here is not a disclosure of who was
-- invited, it is a grant of project access to everyone with an account.
--
-- Two readers, and only two: the project owner, who issued the invitations and
-- has to manage them, and the invited identity, resolved by matching
-- `target_email` against the caller's own verified addresses. The invitee is
-- addressed by email precisely because at invite time they may have no account,
-- so the identity join has to go through org.user_emails — which carries its own
-- own-rows-only policy, making the `user_id = auth.uid()` filter belt and braces
-- rather than the only guard. Compared case-insensitively because an email
-- address is, and an invitation that silently fails to match its own recipient is
-- indistinguishable from one that was never sent.
--
-- Writes are the owner's alone: issuing, revoking and expiring an invitation are
-- all acts of granting or withdrawing access to their project.
CREATE POLICY "View invitations as owner or invitee" ON projects.project_invitations FOR
SELECT TO authenticated USING (
    EXISTS (
        SELECT 1 FROM projects.projects p
        WHERE p.id = project_invitations.project_id AND p.owner_user_id = auth.uid ()
    )
    OR EXISTS (
        SELECT 1 FROM org.user_emails ue
        WHERE ue.user_id = auth.uid ()
            AND lower(ue.email) = lower(project_invitations.target_email)
            -- 🚨 `verified_at` is not optional here, and the reason is the direction of the threat.
            -- `org.user_emails` carries a client INSERT policy (`WITH CHECK (user_id = auth.uid())`)
            -- and `org` is exposed to PostgREST, so any signed-in caller can add an ARBITRARY address
            -- to their OWN row. Without this arm, ASSERTING the invited address is enough to become
            -- an "invitee" and read `token` — which this table's own comment calls the capability:
            -- whoever holds it can accept and be granted the role it names. That is project-access
            -- escalation, not a disclosure.
            --
            -- The own-rows-only policy on `org.user_emails` does not help: it stops you reading
            -- someone else's address, and this attack writes your own.
            AND ue.verified_at IS NOT NULL
    )
);

CREATE POLICY "Owner manages invitations" ON projects.project_invitations FOR ALL TO authenticated USING (
    EXISTS (
        SELECT 1 FROM projects.projects p
        WHERE p.id = project_invitations.project_id AND p.owner_user_id = auth.uid ()
    )
)
WITH
    CHECK (
        EXISTS (
            SELECT 1 FROM projects.projects p
            WHERE p.id = project_invitations.project_id AND p.owner_user_id = auth.uid ()
        )
        AND inviter_user_id = auth.uid ()
    );
