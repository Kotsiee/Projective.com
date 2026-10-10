-- =============================================================================================
-- 00001145 · projects — lane view activity marks
--
--   1. projects.fn_touch_updated_at — keeps `projects.projects.updated_at` honest
--   2. projects.get_nav_activity    — what changed in each lane view since the caller last opened it
--   3. projects.mark_view_seen      — the caller opened a lane view
--
-- Both RPCs are SECURITY INVOKER: every count is taken under the caller's own RLS, which is what
-- separates the roles. A participant cannot read invitations, applications or the owner's activity
-- log, so those arms answer nothing for them without a role test of their own; the role tests that
-- do appear decide what a signal MEANS for that side (a reviewer waits on pending submissions, a
-- submitter on the verdicts), never what the caller may see.
--
-- The baseline for a view the caller has never opened is their FIRST mark on the engagement, else
-- now: a person who has just joined is told about what happens from here, not shown a dot on every
-- view for the history they arrived after. The deadline arm alone ignores that floor, because a
-- deadline inside 48 hours is news whether or not the timeline was ever opened.
-- =============================================================================================

-- #region 1. fn_touch_updated_at
-- `projects.projects.updated_at` is documented as touched by every write, and nothing touched it, so
-- it held the insert instant forever. The Overview's "details changed" mark is read from it.
CREATE OR REPLACE FUNCTION projects.fn_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
-- #endregion

-- #region 2. get_nav_activity
-- projects.get_nav_activity(slug) -> jsonb | NULL
--
-- NULL when the slug resolves to nothing the caller can read. Otherwise:
--   overview    { changes: ["details" | "status" | "stages"] }
--   discussion  { unread: 0..10 }               messages by others in the discussion room (10 = "9+")
--   board       { tone: "new" | "moved" | null } new tickets or stages win over moves
--   timeline    { tone: "deadline" | "update" | null }
--   files       { fresh: boolean }              the owner attached a file in a project room
--   submissions { count: 0..100 }
--   members     { count: 0..100 }
--
-- Counts are capped: the lane draws "9+" past nine, so counting a busy room to the end would be work
-- nothing renders.
CREATE OR REPLACE FUNCTION projects.get_nav_activity(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_uid          uuid := auth.uid();
    v_now          timestamptz := now();
    v_project      record;
    v_is_owner     boolean;
    v_reviewer     boolean;
    v_manager      boolean;
    v_first        timestamptz;
    v_overview     timestamptz;
    v_discussion   timestamptz;
    v_board        timestamptz;
    v_timeline     timestamptz;
    v_timeline_raw timestamptz;
    v_files        timestamptz;
    v_submissions  timestamptz;
    v_members      timestamptz;
    v_room         uuid;
    v_changes      text[] := '{}';
    v_unread       integer;
    v_board_tone   text;
    v_time_tone    text;
    v_files_fresh  boolean;
    v_submitted    integer;
    v_member_count integer;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'insufficient_privilege: sign in to read project activity'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT p.id, p.owner_user_id, p.format, p.structure_variation, p.updated_at
      INTO v_project
      FROM projects.projects p
     WHERE p.slug = p_slug;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    v_is_owner := v_project.owner_user_id = v_uid;
    v_reviewer := projects.can_review_project(v_project.id);
    v_manager := projects.can_manage_project_members(v_project.id);

    SELECT min(r.seen_at),
           max(r.seen_at) FILTER (WHERE r.lane_view = 'overview'),
           max(r.seen_at) FILTER (WHERE r.lane_view = 'discussion'),
           max(r.seen_at) FILTER (WHERE r.lane_view = 'board'),
           max(r.seen_at) FILTER (WHERE r.lane_view = 'timeline'),
           max(r.seen_at) FILTER (WHERE r.lane_view = 'files'),
           max(r.seen_at) FILTER (WHERE r.lane_view = 'submissions'),
           max(r.seen_at) FILTER (WHERE r.lane_view = 'members')
      INTO v_first, v_overview, v_discussion, v_board, v_timeline_raw, v_files, v_submissions,
           v_members
      FROM projects.view_reads r
     WHERE r.user_id = v_uid
       AND r.project_id = v_project.id;

    v_first := coalesce(v_first, v_now);
    v_overview := coalesce(v_overview, v_first);
    v_discussion := coalesce(v_discussion, v_first);
    v_board := coalesce(v_board, v_first);
    v_timeline := coalesce(v_timeline_raw, v_first);
    v_files := coalesce(v_files, v_first);
    v_submissions := coalesce(v_submissions, v_first);
    v_members := coalesce(v_members, v_first);

    -- Overview. Only the owner edits the engagement's own fields, so "details" is news to everyone else.
    IF NOT v_is_owner AND v_project.updated_at > v_overview THEN
        v_changes := array_append(v_changes, 'details');
    END IF;
    IF EXISTS (
        SELECT 1 FROM projects.project_status_history h
         WHERE h.project_id = v_project.id
           AND h.actor_user_id <> v_uid
           AND h.created_at > v_overview
    ) THEN
        v_changes := array_append(v_changes, 'status');
    END IF;
    IF EXISTS (
        SELECT 1 FROM projects.project_stages s
         WHERE s.project_id = v_project.id
           AND ((NOT v_is_owner AND s.created_at > v_overview) OR s.completed_at > v_overview)
    ) OR EXISTS (
        SELECT 1 FROM projects.project_activity a
         WHERE a.project_id = v_project.id
           AND a.entity_table = 'project_stages'
           AND a.actor_user_id <> v_uid
           AND a.created_at > v_overview
    ) THEN
        v_changes := array_append(v_changes, 'stages');
    END IF;

    -- Discussion: a Task talks in its root stage's room, everything else in the project-wide room.
    IF v_project.format = 'one_off'
       AND v_project.structure_variation IN ('single_stage', 'single_task') THEN
        SELECT c.id INTO v_room
          FROM comms.project_channels c
          JOIN projects.project_stages s ON s.id = c.stage_id
         WHERE c.project_id = v_project.id
           AND s.archived_at IS NULL
           AND c.visibility NOT IN ('team_private', 'business_private')
         ORDER BY s.sort_order, c.created_at
         LIMIT 1;
    END IF;
    IF v_room IS NULL THEN
        SELECT c.id INTO v_room
          FROM comms.project_channels c
         WHERE c.project_id = v_project.id
           AND c.stage_id IS NULL
         ORDER BY c.created_at
         LIMIT 1;
    END IF;
    SELECT count(*) INTO v_unread
      FROM (
          SELECT 1 FROM comms.project_messages m
           WHERE m.channel_id = v_room
             AND m.sender_user_id <> v_uid
             AND m.deleted_at IS NULL
             AND m.created_at > v_discussion
           LIMIT 10
      ) unread;

    -- Board: a new card or a new stage is "new"; a card that changed lane is "moved".
    IF EXISTS (
        SELECT 1 FROM projects.tickets t
         WHERE t.project_id = v_project.id
           AND t.created_at > v_board
           AND t.owner_user_id IS DISTINCT FROM v_uid
    ) OR (NOT v_is_owner AND EXISTS (
        SELECT 1 FROM projects.project_stages s
         WHERE s.project_id = v_project.id
           AND s.created_at > v_board
    )) THEN
        v_board_tone := 'new';
    ELSIF EXISTS (
        SELECT 1 FROM projects.ticket_history h
          JOIN projects.tickets t ON t.id = h.ticket_id
         WHERE t.project_id = v_project.id
           AND h.action_type IN ('stage_moved', 'status_changed')
           AND h.actor_id <> v_uid
           AND h.created_at > v_board
    ) THEN
        v_board_tone := 'moved';
    END IF;

    -- Timeline: a deadline entering its last 48 hours since the last look outranks a progress shift.
    IF EXISTS (
        SELECT 1 FROM projects.project_stages s
         WHERE s.project_id = v_project.id
           AND s.archived_at IS NULL
           AND s.completed_at IS NULL
           AND s.status NOT IN ('approved', 'paid', 'cancelled')
           AND s.file_due_date > v_now
           AND s.file_due_date <= v_now + interval '48 hours'
           AND (v_timeline_raw IS NULL OR v_timeline_raw < s.file_due_date - interval '48 hours')
    ) THEN
        v_time_tone := 'deadline';
    ELSIF EXISTS (
        SELECT 1 FROM projects.project_stages s
         WHERE s.project_id = v_project.id
           AND (s.completed_at > v_timeline OR (NOT v_is_owner AND s.created_at > v_timeline))
    ) OR EXISTS (
        SELECT 1 FROM projects.project_activity a
         WHERE a.project_id = v_project.id
           AND a.kind = 'milestone_confirmed'
           AND a.actor_user_id <> v_uid
           AND a.created_at > v_timeline
    ) THEN
        v_time_tone := 'update';
    END IF;

    -- Files: what the owner shared into any room the caller can read.
    v_files_fresh := NOT v_is_owner AND EXISTS (
        SELECT 1 FROM comms.message_attachments ma
          JOIN comms.project_messages m ON m.id = ma.message_id
          JOIN comms.project_channels c ON c.id = m.channel_id
         WHERE ma.message_table = 'comms.project_messages'
           AND c.project_id = v_project.id
           AND m.sender_user_id = v_project.owner_user_id
           AND m.deleted_at IS NULL
           AND ma.created_at > v_files
    );

    -- Submissions: a reviewer waits on new work; a submitter waits on verdicts.
    IF v_reviewer THEN
        SELECT count(*) INTO v_submitted
          FROM (
              SELECT 1 FROM projects.stage_submissions sub
                JOIN projects.project_stages s ON s.id = sub.project_stage_id
               WHERE s.project_id = v_project.id
                 AND sub.status = 'pending_review'
                 AND sub.submitted_by <> v_uid
                 AND sub.updated_at > v_submissions
               LIMIT 100
          ) pending;
    ELSE
        SELECT count(*) INTO v_submitted
          FROM (
              SELECT 1 FROM projects.stage_submissions sub
                JOIN projects.project_stages s ON s.id = sub.project_stage_id
               WHERE s.project_id = v_project.id
                 AND sub.submitted_by = v_uid
                 AND sub.status IN ('accepted', 'revisions_requested')
                 AND sub.reviewed_at > v_submissions
               LIMIT 100
          ) reviewed;
    END IF;

    -- Members: everyone hears about arrivals; the staffing side also about requests and invitations.
    SELECT count(*) INTO v_member_count
      FROM (
          SELECT 1 FROM projects.project_participants pp
           WHERE pp.project_id = v_project.id
             AND pp.profile_id <> v_uid
             AND pp.created_at > v_members
          UNION ALL
          SELECT 1 FROM projects.project_applications pa
           WHERE v_manager
             AND pa.project_id = v_project.id
             AND pa.status = 'pending'
             AND pa.created_at > v_members
          UNION ALL
          SELECT 1 FROM projects.project_invitations pi
           WHERE v_manager
             AND pi.project_id = v_project.id
             AND (
                 pi.declined_at > v_members
                 OR (pi.status = 'expired' AND pi.expires_at > v_members)
                 OR (pi.status = 'pending' AND pi.expires_at > v_members AND pi.expires_at <= v_now)
             )
          LIMIT 100
      ) arrivals;

    RETURN jsonb_build_object(
        'overview', jsonb_build_object('changes', to_jsonb(v_changes)),
        'discussion', jsonb_build_object('unread', v_unread),
        'board', jsonb_build_object('tone', v_board_tone),
        'timeline', jsonb_build_object('tone', v_time_tone),
        'files', jsonb_build_object('fresh', v_files_fresh),
        'submissions', jsonb_build_object('count', v_submitted),
        'members', jsonb_build_object('count', v_member_count)
    );
END;
$$;
-- #endregion

-- #region 3. mark_view_seen
-- projects.mark_view_seen(slug, view) -> timestamptz | NULL
--
-- Moves the caller's read mark for one lane view to now and answers the instant written; NULL when
-- the slug resolves to nothing the caller can read. The view vocabulary is the table's CHECK, so an
-- unknown view is a 23514 rather than a silently stored typo.
CREATE OR REPLACE FUNCTION projects.mark_view_seen(p_slug text, p_view text)
RETURNS timestamptz
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_uid        uuid := auth.uid();
    v_project_id uuid;
    v_seen       timestamptz := now();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'insufficient_privilege: sign in to mark a view as seen'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT p.id INTO v_project_id FROM projects.projects p WHERE p.slug = p_slug;
    IF v_project_id IS NULL THEN
        RETURN NULL;
    END IF;

    INSERT INTO projects.view_reads (user_id, project_id, lane_view, seen_at)
    VALUES (v_uid, v_project_id, p_view, v_seen)
    ON CONFLICT (user_id, project_id, lane_view) DO UPDATE SET seen_at = EXCLUDED.seen_at;

    RETURN v_seen;
END;
$$;
-- #endregion
