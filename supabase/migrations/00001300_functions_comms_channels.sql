-- ============================================================================
-- 00001300 functions comms channels
-- Consolidated verbatim from: 0113_get_or_create_dm_thread.sql, 0311_e7_private_channels_pii_handover.sql
-- ============================================================================

-- Serialise every "find the pair's thread, else open one" for one unordered pair of people until the
-- caller's transaction ends (CAS M5). Both doors that open a pair's DM select-then-insert, so two
-- first messages racing each other each found nothing and each minted a thread — two records for one
-- pair, which unified messaging promises never exists. A transaction-scoped advisory lock keyed on the
-- ordered pair makes the second caller wait and then find the first one's thread; unrelated pairs
-- never contend. (UNIQUE (thread_id, user_id) on dm_participants is the row-level half: it cannot say
-- "one thread per pair", which spans rows.)
CREATE OR REPLACE FUNCTION comms.fn_lock_dm_pair(p_a uuid, p_b uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
    SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'comms.dm_pair:' || LEAST(p_a, p_b)::text || ':' || GREATEST(p_a, p_b)::text, 0
    ));
$$;

-- `p_subject_listing` (Decision #217(g)): the listing a buyer pressed Contact on. A thread this call
-- OPENS then becomes a `service_inquiry` about that listing; an existing service inquiry without a
-- subject gains it. A thread already under way between the pair keeps its kind — unified messaging
-- keeps one record per pair, and a DM cannot carry a subject (`ck_dm_threads_subject_inquiry`).
--
-- Answers `{ thread_id, thread_ref }`: the thread and its `cht-` address (Decision #339, ruling N1),
-- so a caller builds the conversation's URL without a second read.
CREATE OR REPLACE FUNCTION comms.get_or_create_dm_thread(
    target_user_id uuid,
    p_subject_listing uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, org, auth
AS $$
DECLARE
    v_current_user_id uuid := auth.uid();
    v_thread_id uuid;
    v_ref text;
BEGIN
    IF v_current_user_id IS NULL THEN
        RAISE EXCEPTION 'get_or_create_dm_thread: no acting user' USING ERRCODE = '42501';
    END IF;
    -- A DM with oneself would be one participant row twice, which UNIQUE (thread_id, user_id) refuses.
    IF target_user_id IS NULL OR target_user_id = v_current_user_id THEN
        RAISE EXCEPTION 'recipient: invalid' USING ERRCODE = '22023';
    END IF;

    -- The subject must be a live listing the recipient sells; otherwise a thread could claim to be
    -- about a listing that has nothing to do with them.
    IF p_subject_listing IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM catalogue.listings l
         WHERE l.id = p_subject_listing
           AND l.owner_user_id = target_user_id
           AND l.status = 'published'::catalogue.listing_status
    ) THEN
        RAISE EXCEPTION 'That listing is not on sale from this person' USING ERRCODE = '22023';
    END IF;

    -- A GROUP that happens to contain both people is not their DM: the join alone would return
    -- it (nothing requires the thread to hold ONLY these two), so a "message this person" from a
    -- profile would land in a group chat everyone else can read. A service inquiry IS the pair's
    -- thread (unified messaging, one record per pair); a group and an entity channel are not. A dm
    -- or service_inquiry never holds a third person (comms.add_dm_thread_members, PRD-C27), which
    -- is what lets this join on the two people alone.
    PERFORM comms.fn_lock_dm_pair(v_current_user_id, target_user_id);
    SELECT t.id, t.ref INTO v_thread_id, v_ref
    FROM comms.dm_threads t
    JOIN comms.dm_participants p1 ON p1.thread_id = t.id AND p1.user_id = v_current_user_id
    JOIN comms.dm_participants p2 ON p2.thread_id = t.id AND p2.user_id = target_user_id
    WHERE t.kind IN ('dm', 'service_inquiry')
    ORDER BY t.created_at
    LIMIT 1;

    IF v_thread_id IS NOT NULL THEN
        IF p_subject_listing IS NOT NULL THEN
            UPDATE comms.dm_threads t
               SET subject_listing_id = p_subject_listing
             WHERE t.id = v_thread_id AND t.kind = 'service_inquiry' AND t.subject_listing_id IS NULL;
        END IF;
        RETURN jsonb_build_object('thread_id', v_thread_id, 'thread_ref', v_ref);
    END IF;

    INSERT INTO comms.dm_threads (created_by_user_id, kind, subject_listing_id)
    VALUES (
        v_current_user_id,
        CASE WHEN p_subject_listing IS NULL THEN 'dm' ELSE 'service_inquiry' END::comms.conversation_kind,
        p_subject_listing
    )
    RETURNING id, ref INTO v_thread_id, v_ref;

    
    INSERT INTO comms.dm_participants (thread_id, user_id)
    VALUES (v_thread_id, v_current_user_id), (v_thread_id, target_user_id);

    RETURN jsonb_build_object('thread_id', v_thread_id, 'thread_ref', v_ref);
END;
$$;

-- Does the current user belong to a given (project, stage, visibility) scope? Single source of truth
-- reused by has_channel_access, the channel opener and the channel lister.
CREATE OR REPLACE FUNCTION comms.can_access_scope(
    p_project_id uuid,
    p_stage_id uuid,
    p_visibility text
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, comms, projects, org, auth
AS $$
BEGIN
    -- Whole-project channels keep the broad project gate.
    IF p_stage_id IS NULL THEN
        RETURN projects.has_project_access(p_project_id);
    END IF;

    -- Every scoped stage room requires stage-room membership first.
    IF NOT projects.has_stage_access(p_stage_id) THEN
        RETURN false;
    END IF;

    IF p_visibility = 'business_private' THEN
        -- Client side only: owner or an active (verified) member of the paying business.
        RETURN projects.can_review_project(p_project_id);
    ELSIF p_visibility = 'team_private' THEN
        -- Talent side only: an assigned freelancer or an active member of an assigned team.
        RETURN EXISTS (
            SELECT 1 FROM projects.stage_assignments sa
            WHERE sa.project_stage_id = p_stage_id
                AND sa.assignee_type = 'freelancer'
                AND sa.freelancer_profile_id = auth.uid()
                AND sa.status NOT IN ('released', 'cancelled', 'declined')
        ) OR EXISTS (
            SELECT 1 FROM projects.stage_assignments sa
            JOIN org.team_members tm ON tm.team_id = sa.team_id
            WHERE sa.project_stage_id = p_stage_id
                AND sa.assignee_type = 'team'
                AND tm.user_id = auth.uid()
                AND tm.status = 'active'
                AND sa.status NOT IN ('released', 'cancelled', 'declined')
        );
    ELSE
        -- 'stage_all' General room: everyone with stage access.
        RETURN true;
    END IF;
END;
$$;

-- Resolve a channel row to its scope and delegate. Used by every comms RLS policy below.
CREATE OR REPLACE FUNCTION comms.has_channel_access(p_channel_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, comms, projects, org, auth
AS $$
DECLARE
    v_project uuid;
    v_stage uuid;
    v_vis text;
BEGIN
    SELECT project_id, stage_id, visibility
        INTO v_project, v_stage, v_vis
    FROM comms.project_channels
    WHERE id = p_channel_id;

    IF v_project IS NULL THEN
        RETURN false;
    END IF;

    RETURN comms.can_access_scope(v_project, v_stage, v_vis);
END;
$$;

CREATE OR REPLACE FUNCTION comms.get_or_create_project_channel(
    p_project_id uuid,
    p_stage_id uuid,
    p_name text,
    p_visibility text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, projects, org, auth
AS $$
DECLARE
    v_channel_id uuid;
    v_visibility text;
BEGIN
    -- Default scope: stage rooms open the General ('stage_all') room; project-wide channels stay
    -- 'project_all'. Existing 3-arg callers resolve here with p_visibility = NULL.
    v_visibility := COALESCE(
        p_visibility,
        CASE WHEN p_stage_id IS NULL THEN 'project_all' ELSE 'stage_all' END
    );

    IF NOT comms.can_access_scope(p_project_id, p_stage_id, v_visibility) THEN
        RAISE EXCEPTION 'You do not have access to this % channel.', v_visibility
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT id INTO v_channel_id
    FROM comms.project_channels
    WHERE project_id = p_project_id
        AND stage_id IS NOT DISTINCT FROM p_stage_id
        AND visibility = v_visibility
    LIMIT 1;

    IF v_channel_id IS NOT NULL THEN
        RETURN v_channel_id;
    END IF;

    INSERT INTO comms.project_channels (project_id, stage_id, name, visibility)
    VALUES (p_project_id, p_stage_id, p_name, v_visibility)
    RETURNING id INTO v_channel_id;

    RETURN v_channel_id;
END;
$$;

-- Ensure the three scoped rooms exist for a stage and return them with a per-row access flag plus the
-- project's protected-phase status. Channel creation is system-level (definer) so the General room can
-- be provisioned even for a caller who only belongs to one scope; message access is still RLS-gated.
CREATE OR REPLACE FUNCTION comms.get_stage_channels(p_stage_id uuid)
RETURNS TABLE (
    id uuid,
    visibility text,
    name text,
    accessible boolean,
    protected_phase boolean,
    handover_unlocked_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, projects, org, auth
AS $$
DECLARE
    v_project uuid;
    v_stage_name text;
    v_scopes text[] := ARRAY['stage_all', 'team_private', 'business_private'];
    v_scope text;
    v_label text;
BEGIN
    -- An archived stage (projects.sanitize_single_room_topology) is gone from the product.
    SELECT ps.project_id, ps.name INTO v_project, v_stage_name
    FROM projects.project_stages ps WHERE ps.id = p_stage_id AND ps.archived_at IS NULL;

    IF v_project IS NULL THEN
        RAISE EXCEPTION 'Stage not found.' USING ERRCODE = 'no_data_found';
    END IF;

    IF NOT projects.has_stage_access(p_stage_id) THEN
        RAISE EXCEPTION 'You do not have access to this stage workspace.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- A Session presents one room, its project-wide Discussion, so its stages (its sessions) are never
    -- given rooms of their own — provisioning here would undo the sanitizer on the next open. The
    -- existence test below deliberately counts archived rooms, so an archived scope is not re-created.
    FOREACH v_scope IN ARRAY v_scopes LOOP
        EXIT WHEN EXISTS (
            SELECT 1 FROM projects.projects p WHERE p.id = v_project AND p.format::text = 'session'
        );
        IF NOT EXISTS (
            SELECT 1 FROM comms.project_channels pc
            WHERE pc.project_id = v_project AND pc.stage_id = p_stage_id AND pc.visibility = v_scope
        ) THEN
            v_label := CASE v_scope
                WHEN 'stage_all' THEN v_stage_name
                WHEN 'team_private' THEN v_stage_name || ' — Team'
                WHEN 'business_private' THEN v_stage_name || ' — Business'
            END;
            INSERT INTO comms.project_channels (project_id, stage_id, name, visibility)
            VALUES (v_project, p_stage_id, v_label, v_scope);
        END IF;
    END LOOP;

    RETURN QUERY
    SELECT
        pc.id,
        pc.visibility,
        pc.name,
        comms.can_access_scope(v_project, p_stage_id, pc.visibility) AS accessible,
        projects.is_protected_phase(v_project) AS protected_phase,
        (SELECT p.handover_unlocked_at FROM projects.projects p WHERE p.id = v_project)
            AS handover_unlocked_at
    FROM comms.project_channels pc
    WHERE pc.project_id = v_project
        AND pc.stage_id = p_stage_id
        AND pc.archived_at IS NULL
        AND pc.visibility IN ('stage_all', 'team_private', 'business_private')
    ORDER BY array_position(v_scopes, pc.visibility);
END;
$$;

-- Regex masker. Order matters: emails, then payment links/handles, then bare phone numbers (a payment
-- URL can contain digits that would otherwise be eaten by the phone pass). Kept intentionally aligned
-- with the @projective/backend PIIFilter so both layers mask the same shapes.
CREATE OR REPLACE FUNCTION comms.mask_pii(p_text text)
RETURNS TABLE (masked text, categories text[])
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v text := p_text;
    cats text[] := '{}';
BEGIN
    IF v IS NULL OR v = '' THEN
        RETURN QUERY SELECT p_text, '{}'::text[];
        RETURN;
    END IF;

    -- Email addresses.
    IF v ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}' THEN
        v := regexp_replace(v, '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}', '[email hidden]', 'gi');
        cats := array_append(cats, 'email');
    END IF;

    -- Third-party payment links / off-platform contact URLs.
    IF v ~* '(https?://)?(www\.)?(paypal(\.me)?|venmo|cash\.?app|cash\.me|zelle|wise\.com|revolut\.me|monzo\.me|ko-?fi\.com|buymeacoffee\.com|t\.me|wa\.me|telegram\.me)[[:graph:]]*' THEN
        v := regexp_replace(v, '(https?://)?(www\.)?(paypal(\.me)?|venmo|cash\.?app|cash\.me|zelle|wise\.com|revolut\.me|monzo\.me|ko-?fi\.com|buymeacoffee\.com|t\.me|wa\.me|telegram\.me)[[:graph:]]*', '[link hidden]', 'gi');
        cats := array_append(cats, 'payment_link');
    END IF;

    -- Payment handles / cashtags ($name).
    IF v ~ '\$[[:alpha:]][[:alnum:]_]{1,}' THEN
        v := regexp_replace(v, '\$[[:alpha:]][[:alnum:]_]{1,}', '[handle hidden]', 'g');
        cats := array_append(cats, 'handle');
    END IF;

    -- External phone numbers: 7+ digits, optional +, spaces, dashes, parens, dots.
    IF v ~ '[+(]?[0-9][0-9 ().-]{6,}[0-9]' THEN
        v := regexp_replace(v, '[+(]?[0-9][0-9 ().-]{6,}[0-9]', '[phone hidden]', 'g');
        cats := array_append(cats, 'phone');
    END IF;

    RETURN QUERY SELECT v, cats;
END;
$$;

-- The plain text a stored Delta spells: its `ops` runs' `insert`s joined in order — the SQL twin of
-- `messageDeltaText` (packages/types/projects/message-rich.ts). NULL for anything that is not the
-- normalised shape `MessageDeltaSchema` admits: an `{ ops }` envelope and nothing else, each op an
-- object with a string `insert` and at most an `attributes` object of the four marks set to `true`.
-- Strict on purpose: a key the renderer ignores (a second `text`, a mark set to a string) is still
-- stored and still readable over PostgREST and realtime, so it is as good a hiding place for a
-- phone number as a run the body does not contain (SECURITY_MODERATION_AND_AI_GAPS L2).
CREATE OR REPLACE FUNCTION comms.fn_delta_text(p_delta jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_op jsonb;
    v_text text := '';
BEGIN
    IF p_delta IS NULL OR jsonb_typeof(p_delta) <> 'object'
       OR jsonb_typeof(p_delta -> 'ops') IS DISTINCT FROM 'array'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_delta) k WHERE k <> 'ops') THEN
        RETURN NULL;
    END IF;

    FOR v_op IN SELECT e.op FROM jsonb_array_elements(p_delta -> 'ops') WITH ORDINALITY AS e(op, ord) ORDER BY e.ord LOOP
        IF jsonb_typeof(v_op) <> 'object'
           OR jsonb_typeof(v_op -> 'insert') IS DISTINCT FROM 'string'
           OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_op) k WHERE k NOT IN ('insert', 'attributes')) THEN
            RETURN NULL;
        END IF;
        IF v_op ? 'attributes' THEN
            IF jsonb_typeof(v_op -> 'attributes') <> 'object'
               OR EXISTS (
                   SELECT 1 FROM jsonb_each(v_op -> 'attributes') a
                    WHERE a.key NOT IN ('bold', 'italic', 'underline', 'strike')
                       OR a.value <> 'true'::jsonb
               ) THEN
                RETURN NULL;
            END IF;
        END IF;
        v_text := v_text || (v_op ->> 'insert');
    END LOOP;

    RETURN NULLIF(v_text, '');
END;
$$;

-- BEFORE INSERT OR UPDATE gate: mask + flag messages sent while the parent project is in its
-- protected phase. This is the authoritative enforcement point — it fires for every insert path
-- (service or direct) and for every edit of `body` / `body_delta`, since the sender's column grant
-- (00002520) lets them rewrite a stored body. An edit's categories add to the row's, never replace them.
--
-- A masked message also LOSES its formatting (`body_delta := NULL`). The Delta spells the ORIGINAL
-- words run by run, so leaving it in place would keep every address and number this trigger just
-- hid readable one column over. It is not masked op by op instead, because a contact detail can
-- straddle formatting runs — a bold area code, an italic domain — and the patterns match the JOINED
-- text: a per-run pass misses exactly the split ones, and mapping the masked text back onto the runs
-- would have to invent where each mark now begins and ends inside a placeholder. So the message
-- renders plain. Losing the bold on a sentence is the cheap failure here; a leaked phone number is
-- not. (The read side would also discard the stale Delta, which no longer spells the body — but the
-- original words must not be STORED, not merely go unrendered.)
--
-- The Delta must also AGREE with the body before the mask ever looks at it (Delta smuggling, SEC L2):
-- the mask reads only `body`, so `body: "hi"` beside a Delta that spells a phone number would pass
-- untouched, and an empty body skipped the gate entirely. A Delta that does not spell the stored body
-- exactly (comms.fn_delta_text) is dropped on every write, in every phase — every writer already
-- sends an agreeing one (`messageDeltaText(delta) === body`), and the read side discards a disagreeing
-- one anyway, so the only Delta this ever removes is one no reader would render.
CREATE OR REPLACE FUNCTION comms.tg_mask_message_pii()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, projects
AS $$
DECLARE
    v_project uuid;
    v_masked text;
    v_cats text[];
BEGIN
    IF NEW.body_delta IS NOT NULL
       AND (coalesce(NEW.body, '') = '' OR comms.fn_delta_text(NEW.body_delta) IS DISTINCT FROM NEW.body) THEN
        NEW.body_delta := NULL;
    END IF;

    IF NEW.body IS NULL OR NEW.body = '' THEN
        RETURN NEW;
    END IF;

    SELECT project_id INTO v_project FROM comms.project_channels WHERE id = NEW.channel_id;
    IF v_project IS NULL OR NOT projects.is_protected_phase(v_project) THEN
        RETURN NEW;
    END IF;

    SELECT m.masked, m.categories INTO v_masked, v_cats FROM comms.mask_pii(NEW.body) m;
    IF array_length(v_cats, 1) IS NOT NULL THEN
        NEW.body := v_masked;
        NEW.body_delta := NULL;
        NEW.pii_masked := true;
        NEW.pii_categories := CASE WHEN TG_OP = 'UPDATE'
            THEN ARRAY(SELECT DISTINCT c FROM unnest(coalesce(OLD.pii_categories, '{}') || v_cats) c)
            ELSE v_cats END;
    END IF;

    RETURN NEW;
END;
$$;

-- The protected engagement a DM falls under, or NULL. The message's own `project_id` when that
-- project is still protected; otherwise a live, protected project the sender and another member of
-- the thread are BOTH party to. A client cannot opt a message out: omitting `project_id` only sends
-- the lookup to the derivation, and naming an unrelated project can only add masking.
--
-- "Protected" is projects.is_protected_phase and nothing else, the predicate a stage room's mask
-- reads (SEC L4 (c)). Status is deliberately not part of it: a `cancelled` project an owner may set
-- at any time is not the Projective Unlock, and a status filter here let cancelling an engagement lift
-- its DM mask while its rooms stayed masked. Who counts as party to a project is
-- projects.fn_engaged_projects, which includes the client business's active members (L4 (a)).
CREATE OR REPLACE FUNCTION comms.fn_dm_protected_project(
    p_thread_id uuid,
    p_sender uuid,
    p_project_id uuid
) RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, comms, projects
AS $$
    SELECT COALESCE(
        (SELECT p.id FROM projects.projects p
          WHERE p.id = p_project_id AND projects.is_protected_phase(p.id)),
        (SELECT p.id
           FROM projects.projects p
          WHERE projects.is_protected_phase(p.id)
            AND p.id IN (SELECT e.project_id FROM projects.fn_engaged_projects(p_sender) e)
            AND p.id IN (
                SELECT e.project_id
                  FROM comms.dm_participants o
                  CROSS JOIN LATERAL projects.fn_engaged_projects(o.user_id) e
                 WHERE o.thread_id = p_thread_id AND o.user_id <> p_sender
            )
          LIMIT 1)
    );
$$;

-- BEFORE INSERT OR UPDATE gate for direct messages: the same mask + flag comms.tg_mask_message_pii applies to
-- a stage room, applied whenever the thread falls under a protected engagement — a hiring request,
-- an application, or two parties already working together. A masked body drops its formatting for
-- the reason stated on that function: the Delta spells the unmasked words. A Delta that does not
-- spell the body is dropped first, in every phase, for the Delta-smuggling reason given there.
CREATE OR REPLACE FUNCTION comms.tg_mask_dm_message_pii()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, projects
AS $$
DECLARE
    v_masked text;
    v_cats text[];
BEGIN
    IF NEW.body_delta IS NOT NULL
       AND (coalesce(NEW.body, '') = '' OR comms.fn_delta_text(NEW.body_delta) IS DISTINCT FROM NEW.body) THEN
        NEW.body_delta := NULL;
    END IF;

    IF NEW.body IS NULL OR NEW.body = '' THEN
        RETURN NEW;
    END IF;

    IF comms.fn_dm_protected_project(NEW.thread_id, NEW.sender_user_id, NEW.project_id) IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT m.masked, m.categories INTO v_masked, v_cats FROM comms.mask_pii(NEW.body) m;
    IF array_length(v_cats, 1) IS NOT NULL THEN
        NEW.body := v_masked;
        NEW.body_delta := NULL;
        NEW.pii_masked := true;
        NEW.pii_categories := CASE WHEN TG_OP = 'UPDATE'
            THEN ARRAY(SELECT DISTINCT c FROM unnest(coalesce(OLD.pii_categories, '{}') || v_cats) c)
            ELSE v_cats END;
    END IF;

    RETURN NEW;
END;
$$;

-- =============================================================================
-- Replies stay inside their own conversation.
--
-- `reply_to_id` is a self-reference (00000016), so the foreign key already
-- guarantees the original EXISTS and is a message of the same table. What it
-- cannot say is that the original sits in the same CHANNEL (or, for a DM, the
-- same THREAD) as the reply. Without that, a member of two rooms could post a
-- reply in one whose quote is a message from the other — and every reader of the
-- first room would be shown words from a room they may not be allowed into. The
-- quote is rendered from the original, so this is a disclosure, not a cosmetic
-- mismatch.
--
-- BEFORE INSERT, and BEFORE UPDATE of the two columns that could break the rule
-- afterwards: `edit_own_messages` (00002012) lets a sender UPDATE their own
-- project message, and a guard that ran only on INSERT would be one PATCH away
-- from being bypassed. dm_messages has no client UPDATE policy today; the guard
-- covers it anyway so the rule does not depend on that staying true.
--
-- SECURITY DEFINER for the same reason as the PII gates above: the rule is
-- structural, so its lookup must not depend on what the inserting role's SELECT
-- policy happens to admit. That reveals nothing — the refusal is ONE sentence for
-- an original that is missing, in another room, or the row itself, so it cannot
-- be used to probe which ids exist where. The sentence is written for a reader
-- and raised as `check_violation`, which `refusalFrom` (projects/live-writes.ts)
-- matches by its words and reports as a 422 on the `replyToId` field. The fat
-- services refuse the same reply with the same words BEFORE inserting; this is
-- the backstop every other insert path (service role, a hand-rolled request)
-- cannot step around.
--
-- A soft-deleted original is NOT refused. It still exists and is still in the
-- room, the reply is a true statement about what it answered, and its quote
-- renders as unavailable — refusing would only punish somebody for a delete that
-- landed while they were typing.
-- =============================================================================
CREATE OR REPLACE FUNCTION comms.tg_guard_message_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms
AS $$
BEGIN
    IF NEW.reply_to_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.reply_to_id = NEW.id OR NOT EXISTS (
        SELECT 1 FROM comms.project_messages o
        WHERE o.id = NEW.reply_to_id
          AND o.channel_id = NEW.channel_id
    ) THEN
        RAISE EXCEPTION 'That message can''t be replied to here.'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

-- The DM twin of comms.tg_guard_message_reply: the original must sit in the reply's own thread.
CREATE OR REPLACE FUNCTION comms.tg_guard_dm_message_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms
AS $$
BEGIN
    IF NEW.reply_to_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.reply_to_id = NEW.id OR NOT EXISTS (
        SELECT 1 FROM comms.dm_messages o
        WHERE o.id = NEW.reply_to_id
          AND o.thread_id = NEW.thread_id
    ) THEN
        RAISE EXCEPTION 'That message can''t be replied to here.'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

-- BEFORE INSERT on comms.dm_messages: a reply accepts a request. When the SENDER's own copy of the
-- thread sits in their Requests folder, posting into it moves it to their Primary inbox. Every other
-- participant's folder is left alone, so a requester's follow-up can never pull a thread out of the
-- recipient's Requests — only the recipient answering does.
CREATE OR REPLACE FUNCTION comms.fn_promote_thread_on_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms
AS $$
BEGIN
    -- An automatic reply is not the person answering, so it never accepts a request; an entity
    -- channel never holds one.
    IF NEW.auto_response_id IS NOT NULL OR EXISTS (
        SELECT 1 FROM comms.dm_threads t WHERE t.id = NEW.thread_id AND t.kind = 'entity_channel'
    ) THEN
        RETURN NEW;
    END IF;

    UPDATE comms.dm_participants p
    SET inbox_folder = 'primary'
    WHERE p.thread_id = NEW.thread_id
      AND p.user_id = NEW.sender_user_id
      AND p.inbox_folder = 'requests'
      AND p.deleted_at IS NULL;

    RETURN NEW;
END;
$$;

-- =============================================================================
-- DM thread membership — the predicate the /messages read policies are built on.
--
-- SECURITY DEFINER is not a convenience here, it is the whole point. The natural
-- way to write "may I read this thread" is an EXISTS over comms.dm_participants,
-- and the policy ON comms.dm_participants would then subquery its own table —
-- which re-enters the policy and fails at runtime with 42P17 (infinite recursion
-- detected in policy for relation "dm_participants"). A definer function runs as
-- the owner, so the lookup inside it is NOT re-filtered by RLS and the cycle is
-- broken. This is the same shape comms.has_channel_access already uses for the
-- project-channel side.
--
-- It answers membership ONLY. It grants nothing by itself: every caller is a
-- policy that has already narrowed to a specific row, and a bare `true` from
-- here still has to survive the policy it is embedded in.
--
-- `deleted_at IS NULL` is load-bearing. A participant row is soft-deleted when
-- that member deletes the conversation for themselves, and treating a deleted
-- participation as membership would resurrect a thread the user meant to be rid
-- of — for them alone, since everyone else's row is untouched.
-- =============================================================================
CREATE OR REPLACE FUNCTION comms.is_dm_participant(p_thread_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, comms, auth
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM comms.dm_participants p
        WHERE
            p.thread_id = p_thread_id
            AND p.user_id = auth.uid()
            AND p.deleted_at IS NULL
    );
$$;

COMMENT ON FUNCTION comms.is_dm_participant(uuid) IS
'True when the calling user has an undeleted participant row in the given DM thread. SECURITY DEFINER so the RLS policies on comms.dm_participants can use it without recursing into themselves.';

-- =============================================================================
-- DM thread roster — identity WITHOUT per-viewer state.
--
-- The inbox needs to know who else is in a thread: to title a DM after its
-- counterparty and to draw a group's roster. It does NOT need to know whether
-- those people muted, archived, deleted or last read the conversation, and the
-- policy on comms.dm_participants deliberately will not tell it (see 00002012) —
-- RLS is row-level, so admitting a co-participant's row admits every private
-- column on it.
--
-- This function is the narrow answer: three columns, and none of them is state.
-- SECURITY DEFINER so it can read past that own-row-only policy, with the
-- membership check done here instead: a caller only ever receives rosters for
-- threads they are themselves an undeleted participant of.
--
-- Note what is NOT filtered: a co-participant whose own `deleted_at` is set is
-- still returned. They are still in the conversation as far as everyone else is
-- concerned — deleting it for yourself is not leaving it — and omitting them
-- would silently rewrite a group's roster for the remaining members.
-- =============================================================================
CREATE OR REPLACE FUNCTION comms.dm_thread_roster(p_thread_ids uuid[])
RETURNS TABLE (thread_id uuid, user_id uuid, joined_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, comms, auth
AS $$
    SELECT p.thread_id, p.user_id, p.joined_at
    FROM comms.dm_participants p
    WHERE
        p.thread_id = ANY (p_thread_ids)
        AND EXISTS (
            SELECT 1
            FROM comms.dm_participants mine
            WHERE
                mine.thread_id = p.thread_id
                AND mine.user_id = auth.uid()
                AND mine.deleted_at IS NULL
        );
$$;

COMMENT ON FUNCTION comms.dm_thread_roster(uuid[]) IS
'Thread membership as identity only (thread_id, user_id, joined_at) for threads the caller participates in. Exists so the inbox can draw a roster without the own-row-only SELECT policy on comms.dm_participants having to disclose other members private per-viewer state.';

-- =============================================================================
-- Message readability — the one predicate behind reactions, pins and favourites.
--
-- comms.message_reactions, message_pins, message_favorites and message_attachments
-- are all POLYMORPHIC on (message_table, message_id): Postgres cannot point one
-- column at two parents, so there is no foreign key and no join a policy can
-- lean on. Each therefore needs the same question answered — "may the caller read
-- the message this row hangs off?" — and answering it four times in four policies
-- is four places for the project half and the DM half to drift apart.
--
-- SECURITY DEFINER for the same reason comms.is_dm_participant is: the lookups
-- inside reach comms.project_messages and comms.dm_messages, both of which carry
-- their own SELECT policies, and a policy that re-enters another policy is at best
-- a performance cliff and at worst a recursion error. Running as owner makes the
-- inner reads plain table reads and the authority decision explicit, right here.
--
-- The discriminator vocabulary is the SCHEMA-QUALIFIED pair
-- ('comms.project_messages' / 'comms.dm_messages') that the CHECK constraints on
-- those four tables use — NOT the bare 'project'/'dm' pair comms.channel_files
-- uses for the same concept. Two vocabularies for one idea inside one schema;
-- matching the wrong one returns false rather than erroring, which is why this is
-- written once.
--
-- An unrecognised discriminator returns FALSE, not NULL: a policy treats NULL as
-- "no", but returning it explicitly means a future third message table fails
-- closed and visibly rather than by accident.
-- =============================================================================
CREATE OR REPLACE FUNCTION comms.can_read_message(
    p_message_table text,
    p_message_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, comms, projects, org, auth
AS $$
DECLARE
    v_channel uuid;
    v_thread  uuid;
BEGIN
    IF p_message_id IS NULL THEN
        RETURN false;
    END IF;

    IF p_message_table = 'comms.project_messages' THEN
        SELECT channel_id INTO v_channel
        FROM comms.project_messages
        WHERE id = p_message_id AND deleted_at IS NULL;

        IF v_channel IS NULL THEN
            RETURN false;
        END IF;
        RETURN comms.has_channel_access(v_channel);
    END IF;

    IF p_message_table = 'comms.dm_messages' THEN
        SELECT thread_id INTO v_thread
        FROM comms.dm_messages
        WHERE id = p_message_id AND deleted_at IS NULL;

        IF v_thread IS NULL THEN
            RETURN false;
        END IF;
        RETURN comms.is_dm_participant(v_thread);
    END IF;

    RETURN false;
END;
$$;

COMMENT ON FUNCTION comms.can_read_message(text, uuid) IS
'True when the calling user may read the message identified by the polymorphic (message_table, message_id) pair — channel access for a project message, thread participation for a DM. SECURITY DEFINER so the policies on the interaction tables do not re-enter the policies on the message tables.';

-- =============================================================================
-- Group conversations — minting one, and adding people to an existing thread.
--
-- The write policies on comms.dm_threads / dm_participants are deliberately
-- ABSENT (00002012): who may open a thread and who may join one is decided
-- here, once, as SECURITY DEFINER, exactly as comms.get_or_create_dm_thread
-- already decides it for a DM. A client INSERT policy on dm_participants would
-- have to admit "a participant may add a row for somebody else", which is the
-- shape that lets anyone be added to anything; a definer function can check
-- the caller's membership first and then write the rows the policy could not.
--
-- Both refuse an anonymous caller explicitly. auth.uid() is NULL for anon, and
-- without the guard the NOT NULL on created_by_user_id would refuse the insert
-- anyway — but by constraint violation, which is the wrong sentence and, for
-- add_dm_thread_members, no refusal at all (nothing is NOT NULL there).
-- =============================================================================

-- A new group thread with the caller plus the given people. Members are
-- de-duplicated, the caller is never listed twice, and an id that names no
-- org.users_public row is dropped rather than left to fail the FK — the picker
-- offers only real people, so a phantom id is a stale client, not a request.
CREATE OR REPLACE FUNCTION comms.create_group_thread(
    p_title text,
    p_member_ids uuid[]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, org, auth
AS $$
DECLARE
    v_me      uuid := auth.uid();
    v_thread  uuid;
    v_members uuid[];
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'create_group_thread: no acting user' USING ERRCODE = '42501';
    END IF;

    SELECT array_agg(DISTINCT m) INTO v_members
    FROM unnest(p_member_ids) AS m
    WHERE m IS NOT NULL
      AND m <> v_me
      AND EXISTS (SELECT 1 FROM org.users_public u WHERE u.user_id = m);

    IF v_members IS NULL OR array_length(v_members, 1) < 1 THEN
        RAISE EXCEPTION 'A group needs at least one other person' USING ERRCODE = '22023';
    END IF;

    INSERT INTO comms.dm_threads (kind, title, created_by_user_id)
    VALUES ('group', NULLIF(btrim(p_title), ''), v_me)
    RETURNING id INTO v_thread;

    INSERT INTO comms.dm_participants (thread_id, user_id)
    SELECT v_thread, m FROM unnest(v_members || v_me) AS m;

    RETURN v_thread;
END;
$$;

COMMENT ON FUNCTION comms.create_group_thread(text, uuid[]) IS
'Mint a group thread (kind = group) containing the caller and the given users, in one transaction. SECURITY DEFINER because dm_threads/dm_participants carry no client INSERT policy on purpose; the membership decision is made here. A NULL/blank title is stored as NULL (a group may be unnamed).';

-- Add people to a thread the caller is an undeleted participant of. Returns
-- how many were actually added: already-present members are skipped, and a
-- member who had deleted the conversation for themselves is RESTORED rather
-- than duplicated — being added back by somebody is the one event that should
-- bring a conversation back into a person's inbox. A plain DM that gains a
-- third person becomes a group, because that is what the kind column exists to
-- record.
--
-- A service inquiry takes nobody (PRD-C27, Decision #482). It is its buyer's and its seller's pair
-- thread, and it cannot become a group, which carries no listing (ck_dm_threads_subject_inquiry).
-- Widened in place it stayed a pair thread, and the pair lookups (get_or_create_dm_thread,
-- send_request_message) join on two people only — so after a stranger added C to their inquiry,
-- the seller's and C's "message this person" and hiring requests landed where the stranger reads
-- them. So every `dm` and `service_inquiry` holds exactly its two people, and to bring somebody
-- else in, a member starts a group.
CREATE OR REPLACE FUNCTION comms.add_dm_thread_members(
    p_thread_id uuid,
    p_member_ids uuid[]
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_me       uuid := auth.uid();
    v_kind     comms.conversation_kind;
    v_added    integer := 0;
    v_restored integer := 0;
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'add_dm_thread_members: no acting user' USING ERRCODE = '42501';
    END IF;

    IF NOT comms.is_dm_participant(p_thread_id) THEN
        RAISE EXCEPTION 'Not a participant of this conversation' USING ERRCODE = '42501';
    END IF;

    SELECT t.kind INTO v_kind FROM comms.dm_threads t WHERE t.id = p_thread_id;

    -- An entity channel's people are the entity's active members (comms.fn_sync_channel_member);
    -- joining the entity is the only way in.
    IF v_kind = 'entity_channel'::comms.conversation_kind THEN
        RAISE EXCEPTION 'A channel''s members are its workspace''s members' USING ERRCODE = '22023';
    END IF;
    IF v_kind = 'service_inquiry'::comms.conversation_kind THEN
        RAISE EXCEPTION 'An inquiry is only between its buyer and its seller. Start a group to bring someone else in.'
            USING ERRCODE = '22023';
    END IF;

    UPDATE comms.dm_participants p
    SET deleted_at = NULL
    WHERE p.thread_id = p_thread_id
      AND p.user_id = ANY (p_member_ids)
      AND p.user_id <> v_me
      AND p.deleted_at IS NOT NULL;
    GET DIAGNOSTICS v_restored = ROW_COUNT;

    INSERT INTO comms.dm_participants (thread_id, user_id)
    SELECT DISTINCT p_thread_id, m
    FROM pg_catalog.unnest(p_member_ids) AS m
    WHERE m IS NOT NULL
      AND m <> v_me
      AND EXISTS (SELECT 1 FROM org.users_public u WHERE u.user_id = m)
      AND NOT EXISTS (
          SELECT 1 FROM comms.dm_participants p
          WHERE p.thread_id = p_thread_id AND p.user_id = m
      );
    GET DIAGNOSTICS v_added = ROW_COUNT;

    IF v_added + v_restored > 0 THEN
        UPDATE comms.dm_threads t
        SET kind = 'group'::comms.conversation_kind
        WHERE t.id = p_thread_id
          AND t.kind = 'dm'::comms.conversation_kind
          AND (SELECT pg_catalog.count(*) FROM comms.dm_participants p WHERE p.thread_id = p_thread_id) > 2;
    END IF;

    RETURN v_added + v_restored;
END;
$$;

-- Set (or, with NULL, clear) a GROUP's photo. Any participant may: a group's picture is shared
-- furniture, like its name. The file must be a processed public profile-style rendition the CALLER
-- owns (the server cut it from the caller's own library, in the `avatars` bucket) — the same proof
-- org.set_profile_avatar demands, so a client cannot point a thread at somebody else's file. The
-- photo it replaces is soft-deleted, exactly as a replaced profile photo is.
CREATE OR REPLACE FUNCTION comms.set_group_photo(
    p_thread_id uuid,
    p_file_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_me   uuid := auth.uid();
    v_kind comms.conversation_kind;
    v_prev uuid;
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'set_group_photo: no acting user' USING ERRCODE = '42501';
    END IF;

    IF NOT comms.is_dm_participant(p_thread_id) THEN
        RAISE EXCEPTION 'Not a participant of this conversation' USING ERRCODE = '42501';
    END IF;

    SELECT t.kind, t.photo_file_id INTO v_kind, v_prev
    FROM comms.dm_threads t WHERE t.id = p_thread_id
    FOR UPDATE;

    IF v_kind IS DISTINCT FROM 'group'::comms.conversation_kind
       AND v_kind IS DISTINCT FROM 'entity_channel'::comms.conversation_kind THEN
        RAISE EXCEPTION 'Only a group conversation or a channel has its own photo' USING ERRCODE = '22023';
    END IF;

    -- A channel's photo is part of its identity, so it follows the edit right (Decision #308) rather
    -- than a group's any-participant rule.
    IF v_kind = 'entity_channel'::comms.conversation_kind
       AND NOT comms.fn_can_manage_entity_channel(p_thread_id, v_me) THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
            MESSAGE = 'channel: only the person who added it, or someone who manages settings, can change it';
    END IF;

    IF p_file_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM files.items i
        WHERE i.id = p_file_id
          AND i.purpose = 'avatar'::files.asset_purpose
          AND i.bucket_id = 'avatars'
          AND i.visibility = 'public'::files.file_visibility
          AND i.status = 'uploaded'::files.file_status
          AND i.deleted_at IS NULL
          AND i.owner_type = 'user'::files.owner_kind
          AND i.owner_user_id = v_me
    ) THEN
        RAISE EXCEPTION 'file: not a processed photo of yours' USING ERRCODE = '22023';
    END IF;

    UPDATE comms.dm_threads SET photo_file_id = p_file_id WHERE id = p_thread_id;

    IF v_prev IS NOT NULL AND v_prev IS DISTINCT FROM p_file_id THEN
        UPDATE files.items SET deleted_at = now()
        WHERE id = v_prev AND purpose = 'avatar'::files.asset_purpose AND deleted_at IS NULL;
    END IF;

    RETURN jsonb_build_object('ok', true, 'file_id', p_file_id, 'previous', v_prev);
END;
$$;

COMMENT ON FUNCTION comms.set_group_photo(uuid, uuid) IS
'Set or clear (NULL) a group conversation''s or an entity channel''s photo. Any undeleted participant of a group may; a channel''s creator or a manage_settings holder for a channel (Decision #308); the file must be a processed public avatars-bucket rendition owned by the caller. SECURITY DEFINER because dm_threads carries no client UPDATE policy; the previous photo is soft-deleted.';

COMMENT ON FUNCTION comms.add_dm_thread_members(uuid, uuid[]) IS
'Add users to a thread the caller participates in; returns the number added (restored self-deletions included). Converts a plain DM with a third participant into a group; refuses a service inquiry and an entity channel (22023), so a dm or service_inquiry always holds exactly its pair (PRD-C27, Decision #482). SECURITY DEFINER for the same reason as create_group_thread.';

-- =============================================================================
-- Inbox folders and hiring requests.
--
-- `comms.dm_participants.inbox_folder` is per-participant state with no client UPDATE policy, for the
-- reason the SELECT policy is own-row-only: a policy wide enough to write it would also reach
-- `last_read_at` and `deleted_at`. The two doors below each touch exactly one thing.
-- =============================================================================

-- Move a conversation between the caller's own folders (Primary · Requests · Archived). Refusals use
-- the '<field>: <reason>' 22023 / 42501 shape the fat service maps to 422 / 403.
CREATE OR REPLACE FUNCTION comms.set_dm_inbox_folder(
    p_thread_id uuid,
    p_folder text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, auth
AS $$
DECLARE
    v_me uuid := auth.uid();
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'set_dm_inbox_folder: no acting user' USING ERRCODE = '42501';
    END IF;
    IF p_folder IS NULL OR p_folder NOT IN ('primary', 'requests', 'archived') THEN
        RAISE EXCEPTION 'folder: not_a_folder' USING ERRCODE = '22023';
    END IF;

    UPDATE comms.dm_participants p
    SET inbox_folder = p_folder
    WHERE p.thread_id = p_thread_id
      AND p.user_id = v_me
      AND p.deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Not a participant of this conversation' USING ERRCODE = '42501';
    END IF;

    RETURN p_folder;
END;
$$;

COMMENT ON FUNCTION comms.set_dm_inbox_folder(uuid, text) IS
'Set the caller''s own inbox folder (primary | requests | archived) for a thread they are an undeleted participant of. SECURITY DEFINER because dm_participants carries no client UPDATE policy.';

-- Star or unstar a conversation for the caller only (the /saved system, Decision #180). Idempotent:
-- setting the state it already has succeeds.
CREATE OR REPLACE FUNCTION comms.set_dm_starred(
    p_thread_id uuid,
    p_starred boolean
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, auth
AS $$
DECLARE
    v_me uuid := auth.uid();
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'set_dm_starred: no acting user' USING ERRCODE = '42501';
    END IF;
    IF p_starred IS NULL THEN
        RAISE EXCEPTION 'starred: required' USING ERRCODE = '22023';
    END IF;

    UPDATE comms.dm_participants p
    SET is_starred = p_starred,
        -- A repeat star keeps its original time; un-starring clears it.
        starred_at = CASE WHEN NOT p_starred THEN NULL WHEN p.is_starred THEN p.starred_at ELSE now() END
    WHERE p.thread_id = p_thread_id
      AND p.user_id = v_me
      AND p.deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Not a participant of this conversation' USING ERRCODE = '42501';
    END IF;

    RETURN p_starred;
END;
$$;

COMMENT ON FUNCTION comms.set_dm_starred(uuid, boolean) IS
'Set the caller''s own star on a thread they are an undeleted participant of. SECURITY DEFINER because dm_participants carries no client UPDATE policy.';

-- Mute or unmute a conversation for the caller only (Decision #308): the participant row's `is_muted`,
-- which the inbox and the channel header read. Idempotent, as set_dm_starred is.
CREATE OR REPLACE FUNCTION comms.set_dm_muted(
    p_thread_id uuid,
    p_muted boolean
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, auth
AS $$
DECLARE
    v_me uuid := auth.uid();
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'set_dm_muted: no acting user' USING ERRCODE = '42501';
    END IF;
    IF p_muted IS NULL THEN
        RAISE EXCEPTION 'muted: required' USING ERRCODE = '22023';
    END IF;

    UPDATE comms.dm_participants p
    SET is_muted = p_muted
    WHERE p.thread_id = p_thread_id
      AND p.user_id = v_me
      AND p.deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Not a participant of this conversation' USING ERRCODE = '42501';
    END IF;

    RETURN p_muted;
END;
$$;

COMMENT ON FUNCTION comms.set_dm_muted(uuid, boolean) IS
'Set the caller''s own mute on a thread they are an undeleted participant of (Decision #308). SECURITY DEFINER because dm_participants carries no client UPDATE policy.';

-- Mark a conversation read for the caller only (CAS M10): the participant row's `last_read_at`, the
-- watermark the inbox compares the latest message against. Before this door the column had no writer,
-- so every live thread with a message in it was unread forever. The watermark moves only when there is
-- something to read past it — never opened, or a message newer than the mark — so opening a read
-- thread writes nothing. Returns whether it moved, which is what tells the caller its cached inbox is
-- stale. Refuses a caller who is not an undeleted participant, in the shape of the folder doors.
CREATE OR REPLACE FUNCTION comms.mark_dm_read(p_thread_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_me uuid := auth.uid();
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'mark_dm_read: no acting user' USING ERRCODE = '42501';
    END IF;
    IF NOT comms.is_dm_participant(p_thread_id) THEN
        RAISE EXCEPTION 'Not a participant of this conversation' USING ERRCODE = '42501';
    END IF;

    UPDATE comms.dm_participants p
    SET last_read_at = pg_catalog.now()
    WHERE p.thread_id = p_thread_id
      AND p.user_id = v_me
      AND p.deleted_at IS NULL
      AND (p.last_read_at IS NULL OR EXISTS (
          SELECT 1 FROM comms.dm_messages m
           WHERE m.thread_id = p_thread_id AND m.created_at > p.last_read_at
      ));

    RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION comms.mark_dm_read(uuid) IS
'Advance the caller''s own read watermark (dm_participants.last_read_at) on a thread they are an undeleted participant of; true when it moved. SECURITY DEFINER because dm_participants carries no client UPDATE policy.';

-- #region Room read marks and the project's Private Messages (PROJECTS CH3; PRD-E13, PRD-E17)
-- A project room's read watermark (comms.project_channel_reads): the room twin of mark_dm_read
-- above, sent by the same read POST the chat island makes once a page has painted in a visible tab
-- (CAS M10, PRD-C11; a GET writes nothing). The mark moves only when there is something to read past
-- it — never opened, or a message newer than the mark — so re-opening a read room writes nothing, and
-- the answer says whether it moved, which is what tells the caller its cached project tree is stale.
-- A caller who cannot read the room is refused 42501, in the shape of mark_dm_read. SECURITY DEFINER
-- because the table carries no client write policy or grant: this is its one writer.
CREATE OR REPLACE FUNCTION comms.mark_room_read(p_channel_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_me uuid := auth.uid();
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'mark_room_read: no acting user' USING ERRCODE = '42501';
    END IF;
    IF NOT comms.has_channel_access(p_channel_id) THEN
        RAISE EXCEPTION 'Not a member of this room' USING ERRCODE = '42501';
    END IF;

    INSERT INTO comms.project_channel_reads AS r (channel_id, user_id, last_read_at)
    VALUES (p_channel_id, v_me, pg_catalog.now())
    ON CONFLICT (channel_id, user_id) DO UPDATE
        SET last_read_at = EXCLUDED.last_read_at
        WHERE EXISTS (
            SELECT 1 FROM comms.project_messages m
             WHERE m.channel_id = p_channel_id AND m.created_at > r.last_read_at
        );

    RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION comms.mark_room_read(uuid) IS
'Advance the caller''s own read watermark in a project room they can read (comms.project_channel_reads); true when it moved. The room twin of mark_dm_read. SECURITY DEFINER because the table carries no client write policy or grant.';

-- The rooms of one project the caller can read that hold news for them: a message by somebody else,
-- not deleted, newer than their mark in the room, or, in a room they never opened, newer than their
-- first lane mark on the engagement. That baseline is projects.get_nav_activity's (00001145): a
-- person who has just arrived is told about what happens from here, not shown every room's history,
-- and a caller with no lane mark on the project has no news yet. The project tree's per-room unread
-- dot (live-detail.ts). SECURITY INVOKER: the room, message and mark read policies are the guard, so
-- a room the caller cannot read never answers and an archived room is never listed.
CREATE OR REPLACE FUNCTION comms.unread_rooms(p_project_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    WITH me AS (
        SELECT auth.uid() AS uid,
               (SELECT pg_catalog.min(v.seen_at) FROM projects.view_reads v
                 WHERE v.user_id = auth.uid() AND v.project_id = p_project_id) AS baseline
    )
    SELECT c.id
      FROM comms.project_channels c
      CROSS JOIN me
      LEFT JOIN comms.project_channel_reads r ON r.channel_id = c.id AND r.user_id = me.uid
     WHERE c.project_id = p_project_id
       AND me.uid IS NOT NULL
       AND COALESCE(r.last_read_at, me.baseline) IS NOT NULL
       AND EXISTS (
           SELECT 1 FROM comms.project_messages m
            WHERE m.channel_id = c.id
              AND m.sender_user_id <> me.uid
              AND m.deleted_at IS NULL
              AND m.created_at > COALESCE(r.last_read_at, me.baseline)
       );
$$;

COMMENT ON FUNCTION comms.unread_rooms(uuid) IS
'The project rooms the caller can read holding an undeleted message by somebody else newer than the caller''s mark in the room, else newer than their first lane mark on the engagement (projects.view_reads); none without a lane mark. SECURITY INVOKER: RLS is the guard.';

-- The project's Private Messages group (Decision #339 ruling N1; #508 (e), (f), (g)): every thread of
-- the caller's that holds an undeleted message stamped with this project or that either participant
-- brought into it (comms.dm_thread_projects), and that nobody has taken out since, one row per thread
-- with its newest stamped (or brought-in) instant, newest first. A DM, a service inquiry or a group,
-- never an entity channel (comms.tg_bind_dm_project never stamps one). A thread the caller deleted for
-- themselves stays out, as it does the inbox. Read thread by thread from the caller's own participant
-- rows, each one index probe (idx_dm_messages_project), where the scan it replaces read at most 500
-- stamped messages and let one busy thread crowd the others out. SECURITY INVOKER: the participant,
-- thread, message and link read policies are the guard.
CREATE OR REPLACE FUNCTION comms.project_dm_threads(p_project_id uuid)
RETURNS TABLE (
    thread_id uuid,
    ref text,
    kind comms.conversation_kind,
    title text,
    last_stamped_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT t.id, t.ref, t.kind, t.title, GREATEST(s.created_at, l.brought_in_at)
      FROM comms.dm_participants p
      JOIN comms.dm_threads t ON t.id = p.thread_id
      LEFT JOIN comms.dm_thread_projects l ON l.thread_id = t.id AND l.project_id = p_project_id
      LEFT JOIN LATERAL (
          SELECT m.created_at FROM comms.dm_messages m
           WHERE m.project_id = p_project_id AND m.thread_id = t.id AND m.deleted_at IS NULL
           ORDER BY m.created_at DESC
           LIMIT 1
      ) s ON true
     WHERE p.user_id = auth.uid()
       AND p.deleted_at IS NULL
       AND t.kind IN ('dm', 'service_inquiry', 'group')
       AND l.taken_out_at IS NULL
       AND (s.created_at IS NOT NULL OR l.brought_in_at IS NOT NULL)
     ORDER BY 5 DESC, t.id;
$$;

COMMENT ON FUNCTION comms.project_dm_threads(uuid) IS
'The caller''s undeleted threads (dm, service_inquiry, group) holding an undeleted message stamped with the project or brought into it, and not taken out (comms.dm_thread_projects), one row each with its newest stamped or brought-in instant, newest first. SECURITY INVOKER: RLS is the guard.';

-- Whether one thread is in one project's Private Messages group right now: a stamped undeleted
-- message or a bring-in, and no take-out. The one rule the two doors below share with
-- comms.project_dm_threads above. SECURITY DEFINER so the doors can ask it for a thread whatever the
-- caller's own message reads; no client EXECUTE.
CREATE OR REPLACE FUNCTION comms.fn_dm_in_project(p_thread_id uuid, p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT NOT EXISTS (
               SELECT 1 FROM comms.dm_thread_projects l
                WHERE l.thread_id = p_thread_id AND l.project_id = p_project_id AND l.taken_out_at IS NOT NULL
           )
       AND (
           EXISTS (
               SELECT 1 FROM comms.dm_thread_projects l
                WHERE l.thread_id = p_thread_id AND l.project_id = p_project_id AND l.brought_in_at IS NOT NULL
           )
           OR EXISTS (
               SELECT 1 FROM comms.dm_messages m
                WHERE m.thread_id = p_thread_id AND m.project_id = p_project_id AND m.deleted_at IS NULL
           )
       );
$$;

COMMENT ON FUNCTION comms.fn_dm_in_project(uuid, uuid) IS
'Whether the thread is in the project''s Private Messages group: an undeleted stamped message or a bring-in, and no take-out (comms.dm_thread_projects). No client EXECUTE.';

-- Bring the caller's one-to-one conversation with another person into a project (PROJECTS CH3; the
-- owner's ruling on stop 23, Decision #560): either participant may, while both are parties to the
-- project, and the other is told. The pair's thread is found or opened by comms.get_or_create_dm_thread,
-- so the DM opener's every rule holds (the pair lock, the DM shield, no self-DM); then the thread joins
-- the project's Private Messages group (comms.dm_thread_projects), clearing a past take-out. Answers
-- { thread_id, thread_ref, moved }: `moved` is false when it was already in the group, and then nobody
-- is told again. A caller who is not a party to the project is refused 42501, as if it did not exist;
-- the other not being one is CH409, in a sentence the roster shows.
CREATE OR REPLACE FUNCTION comms.bring_dm_into_project(p_project_id uuid, p_target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_me uuid := auth.uid();
    v_opened jsonb;
    v_thread uuid;
    v_ref text;
    v_project record;
    v_name text;
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'bring_dm_into_project: no acting user' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM projects.fn_engaged_projects(v_me) e WHERE e.project_id = p_project_id) THEN
        RAISE EXCEPTION 'No such project' USING ERRCODE = '42501';
    END IF;
    IF p_target_user_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM projects.fn_engaged_projects(p_target_user_id) e WHERE e.project_id = p_project_id
    ) THEN
        RAISE EXCEPTION 'They are not on this project, so your conversation cannot be brought into it.'
            USING ERRCODE = 'CH409';
    END IF;

    v_opened := comms.get_or_create_dm_thread(p_target_user_id);
    v_thread := (v_opened ->> 'thread_id')::uuid;
    v_ref := v_opened ->> 'thread_ref';

    IF comms.fn_dm_in_project(v_thread, p_project_id) THEN
        RETURN pg_catalog.jsonb_build_object('thread_id', v_thread, 'thread_ref', v_ref, 'moved', false);
    END IF;

    INSERT INTO comms.dm_thread_projects AS l (thread_id, project_id, brought_in_by, brought_in_at)
    VALUES (v_thread, p_project_id, v_me, pg_catalog.now())
    ON CONFLICT (thread_id, project_id) DO UPDATE
        SET brought_in_by = EXCLUDED.brought_in_by,
            brought_in_at = EXCLUDED.brought_in_at,
            taken_out_by = NULL,
            taken_out_at = NULL;

    SELECT p.slug, p.title INTO v_project FROM projects.projects p WHERE p.id = p_project_id;
    SELECT NULLIF(pg_catalog.btrim(COALESCE(up.first_name, '') || ' ' || COALESCE(up.last_name, '')), '')
      INTO v_name
      FROM org.users_public up WHERE up.user_id = v_me;

    PERFORM comms.fn_notify(
        p_target_user_id,
        'message.brought_into_project',
        pg_catalog.format('%s brought your conversation into %s', COALESCE(v_name, 'Someone'), v_project.title),
        'It now opens inside the project too, with the same history.',
        'comms.dm_threads',
        v_thread,
        pg_catalog.jsonb_build_object('project_slug', v_project.slug, 'project_title', v_project.title,
                                      'thread_ref', v_ref),
        v_me,
        'project',
        p_project_id,
        NULL,
        '/projects/' || v_project.slug || '/' || v_ref
    );

    RETURN pg_catalog.jsonb_build_object('thread_id', v_thread, 'thread_ref', v_ref, 'moved', true);
END;
$$;

COMMENT ON FUNCTION comms.bring_dm_into_project(uuid, uuid) IS
'Either participant brings their one-to-one conversation with another party to the project into its Private Messages group (Decision #560, stop 23 as ruled); the thread is found or opened by get_or_create_dm_thread, a past take-out is cleared, and the other is told (message.brought_into_project). Returns { thread_id, thread_ref, moved }. 42501 for a caller not on the project; CH409 when the other is not.';

-- Take a one-to-one conversation out of a project's Private Messages group (Decision #560, stop 23 as
-- ruled): either participant may. It leaves the group for both people, and every stamp stays as
-- evidence; bringing it back (above) restores it. True when it left the group, false when it was not
-- in it. A caller who is not a participant is refused 42501; a group thread is 22023, because a group
-- cannot be brought back by the pair door and would be lost to the project.
CREATE OR REPLACE FUNCTION comms.take_dm_out_of_project(p_thread_id uuid, p_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_me uuid := auth.uid();
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'take_dm_out_of_project: no acting user' USING ERRCODE = '42501';
    END IF;
    IF NOT comms.is_dm_participant(p_thread_id) THEN
        RAISE EXCEPTION 'Not a participant of this conversation' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM comms.dm_threads t WHERE t.id = p_thread_id AND t.kind IN ('dm', 'service_inquiry')
    ) THEN
        RAISE EXCEPTION 'Only a one-to-one conversation can be taken out of a project.' USING ERRCODE = '22023';
    END IF;
    IF NOT comms.fn_dm_in_project(p_thread_id, p_project_id) THEN
        RETURN false;
    END IF;

    INSERT INTO comms.dm_thread_projects AS l (thread_id, project_id, taken_out_by, taken_out_at)
    VALUES (p_thread_id, p_project_id, v_me, pg_catalog.now())
    ON CONFLICT (thread_id, project_id) DO UPDATE
        SET taken_out_by = EXCLUDED.taken_out_by,
            taken_out_at = EXCLUDED.taken_out_at;

    RETURN true;
END;
$$;

COMMENT ON FUNCTION comms.take_dm_out_of_project(uuid, uuid) IS
'Either participant takes their one-to-one conversation out of the project''s Private Messages group for both people (Decision #560, stop 23 as ruled); stamps are never touched. True when it left the group. 42501 for a non-participant; 22023 for a group.';
-- #endregion

-- Post the opening message of a hiring request into the pair's DM, opening the thread if there is
-- none. The caller must hold an OPEN engagement with the recipient on `p_project_id` — a pending
-- invitation they issued, or a pending application of theirs to the recipient's project — so the
-- Requests folder cannot be used to file arbitrary messages into a stranger's inbox.
--
-- Routing applies only to a thread this request effectively OPENS (created now, holding no message
-- yet, or restored from the recipient's own deletion): the sender keeps it in Primary and the
-- recipient gets it in Requests unless the two follow each other. A conversation already under way
-- is never re-filed. The message carries `p_project_id`, so comms.tg_mask_dm_message_pii masks it
-- while that project is protected.
CREATE OR REPLACE FUNCTION comms.send_request_message(
    p_recipient uuid,
    p_body text,
    p_project_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, projects, org, auth
AS $$
DECLARE
    v_me       uuid := auth.uid();
    v_body     text := btrim(COALESCE(p_body, ''));
    v_thread   uuid;
    v_ref      text;
    v_opens    boolean := false;
    v_restored integer := 0;
    v_mutual   boolean;
    v_routed   text;
    v_message  uuid;
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'send_request_message: no acting user' USING ERRCODE = '42501';
    END IF;
    IF p_recipient IS NULL OR p_recipient = v_me THEN
        RAISE EXCEPTION 'recipient: invalid' USING ERRCODE = '22023';
    END IF;
    IF v_body = '' THEN
        RAISE EXCEPTION 'message: required' USING ERRCODE = '22023';
    END IF;
    IF char_length(v_body) > 4000 THEN
        RAISE EXCEPTION 'message: too_long' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM projects.project_invitations i
         WHERE i.project_id = p_project_id
           AND i.inviter_user_id = v_me
           AND i.target_user_id = p_recipient
           AND i.status = 'pending'
    ) AND NOT EXISTS (
        SELECT 1 FROM projects.project_applications a
          JOIN projects.projects p ON p.id = a.project_id
         WHERE a.project_id = p_project_id
           AND a.applicant_user_id = v_me
           AND p.owner_user_id = p_recipient
           AND a.status = 'pending'
    ) THEN
        RAISE EXCEPTION 'No open request to this person on that project' USING ERRCODE = '42501';
    END IF;

    -- The same pair lock as comms.get_or_create_dm_thread: the two doors open the same thread.
    PERFORM comms.fn_lock_dm_pair(v_me, p_recipient);
    SELECT t.id, t.ref INTO v_thread, v_ref
    FROM comms.dm_threads t
    JOIN comms.dm_participants p1 ON p1.thread_id = t.id AND p1.user_id = v_me
    JOIN comms.dm_participants p2 ON p2.thread_id = t.id AND p2.user_id = p_recipient
    WHERE t.kind IN ('dm', 'service_inquiry')
    ORDER BY t.created_at
    LIMIT 1;

    IF v_thread IS NULL THEN
        INSERT INTO comms.dm_threads (created_by_user_id)
        VALUES (v_me)
        RETURNING id, ref INTO v_thread, v_ref;

        INSERT INTO comms.dm_participants (thread_id, user_id)
        VALUES (v_thread, v_me), (v_thread, p_recipient);
        v_opens := true;
    ELSE
        -- A new request is the one event that should bring a conversation somebody deleted for
        -- themselves back into their inbox (the add_dm_thread_members rule).
        UPDATE comms.dm_participants p
        SET deleted_at = NULL
        WHERE p.thread_id = v_thread
          AND p.user_id = p_recipient
          AND p.deleted_at IS NOT NULL;
        GET DIAGNOSTICS v_restored = ROW_COUNT;

        UPDATE comms.dm_participants p
        SET deleted_at = NULL
        WHERE p.thread_id = v_thread
          AND p.user_id = v_me
          AND p.deleted_at IS NOT NULL;

        v_opens := v_restored > 0 OR NOT EXISTS (
            SELECT 1 FROM comms.dm_messages m
             WHERE m.thread_id = v_thread AND m.deleted_at IS NULL
        );
    END IF;

    IF v_opens THEN
        v_mutual := EXISTS (
            SELECT 1 FROM org.profile_follows f
             WHERE f.follower_user_id = v_me
               AND f.target_entity_type = 'user'
               AND f.target_entity_id = p_recipient
        ) AND EXISTS (
            SELECT 1 FROM org.profile_follows f
             WHERE f.follower_user_id = p_recipient
               AND f.target_entity_type = 'user'
               AND f.target_entity_id = v_me
        );
        v_routed := CASE WHEN v_mutual THEN 'primary' ELSE 'requests' END;

        UPDATE comms.dm_participants p
        SET inbox_folder = v_routed
        WHERE p.thread_id = v_thread AND p.user_id = p_recipient;

        UPDATE comms.dm_participants p
        SET inbox_folder = 'primary'
        WHERE p.thread_id = v_thread AND p.user_id = v_me;
    END IF;

    INSERT INTO comms.dm_messages (thread_id, sender_user_id, project_id, body)
    VALUES (v_thread, v_me, p_project_id, v_body)
    RETURNING id INTO v_message;

    RETURN jsonb_build_object(
        'thread_id', v_thread,
        'thread_ref', v_ref,
        'message_id', v_message,
        'opened', v_opens,
        'routed_to', v_routed
    );
END;
$$;

COMMENT ON FUNCTION comms.send_request_message(uuid, text, uuid) IS
'Post a hiring request''s opening message (an invitation''s intro or an application''s cover note) into the pair''s DM, opening it if needed. A thread the request opens is filed in the recipient''s Requests folder unless the two follow each other; the sender keeps it in Primary. Requires an open invitation or application between the two on p_project_id.';

-- #region Auto-replies (Settings → Messaging)
-- Is a person in a status an auto-reply answers during? Every condition is DERIVED from what the
-- person already keeps, never asserted (Decision #149(C) — there is no hand-set presence):
--   away         notifications are paused (comms.notification_prefs.muted_until)
--   busy         inside a calendar event or a blackout on their own schedule
--   out_of_hours outside their published weekly working hours (no published hours, never matches)
--   holiday      the rule's own dates, which the caller's window test has already applied
-- PL/pgSQL, not SQL: the scheduling predicates it reads are created later (00001510), and a SQL body
-- is resolved at CREATE time while a PL/pgSQL one is resolved when it runs.
CREATE OR REPLACE FUNCTION comms.fn_auto_reply_status(p_user uuid, p_status text, p_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN CASE p_status
        WHEN 'away' THEN EXISTS (
            SELECT 1 FROM comms.notification_prefs np
             WHERE np.user_id = p_user AND np.muted_until > p_at
        )
        WHEN 'busy' THEN EXISTS (
            SELECT 1 FROM scheduling.schedules s
             WHERE s.owner_id = p_user AND s.owner_type IN ('user', 'freelancer')
               AND (scheduling.fn_has_conflicting_event(s.id, p_at, p_at + interval '1 minute')
                 OR scheduling.fn_is_blacked_out(s.id, p_at, p_at + interval '1 minute'))
        )
        WHEN 'out_of_hours' THEN EXISTS (
            SELECT 1 FROM scheduling.schedules s
             WHERE s.owner_id = p_user AND s.owner_type IN ('user', 'freelancer') AND s.is_published
               AND EXISTS (
                   SELECT 1 FROM scheduling.availability_rules r
                    WHERE r.schedule_id = s.id AND r.kind = 'working_hours' AND r.is_active
               )
               AND NOT scheduling.fn_band_covers(
                   s.id, 'working_hours'::scheduling.availability_kind, p_at, p_at + interval '1 minute')
        )
        WHEN 'holiday' THEN true
        ELSE false
    END;
END;
$$;

-- AFTER INSERT on comms.dm_messages: answer a human message in a one-to-one thread with the
-- recipient's best matching rule. Most specific first — a keyword, a named service, a hiring
-- invitation, any service request, a status, then a first-contact greeting — and each rule at most
-- once per thread per day. A product rule matches nothing yet: an inquiry carries no product.
--
-- Best effort by design: the person's own message has already been written, and an auto-reply that
-- cannot be sent must never take it down with it, so a failure is reported as a WARNING (server log)
-- and the insert stands.
CREATE OR REPLACE FUNCTION comms.tg_dm_auto_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_kind comms.conversation_kind;
    v_recipient uuid;
    v_invite boolean;
    v_first boolean;
    v_rule comms.auto_responses;
    v_now timestamptz := now();
BEGIN
    IF NEW.auto_response_id IS NOT NULL OR NEW.quote_event_id IS NOT NULL OR NEW.deleted_at IS NOT NULL THEN
        RETURN NULL;
    END IF;

    BEGIN
        SELECT t.kind INTO v_kind FROM comms.dm_threads t WHERE t.id = NEW.thread_id;
        IF NOT FOUND OR v_kind NOT IN ('dm', 'service_inquiry') THEN
            RETURN NULL;
        END IF;
        IF (SELECT count(*) FROM comms.dm_participants p WHERE p.thread_id = NEW.thread_id) <> 2 THEN
            RETURN NULL;
        END IF;
        SELECT p.user_id INTO v_recipient
          FROM comms.dm_participants p
         WHERE p.thread_id = NEW.thread_id AND p.user_id <> NEW.sender_user_id
         LIMIT 1;
        IF v_recipient IS NULL OR NOT EXISTS (
            SELECT 1 FROM comms.notification_prefs np
             WHERE np.user_id = v_recipient AND np.auto_responses_enabled
        ) THEN
            RETURN NULL;
        END IF;

        v_invite := NEW.project_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM projects.project_invitations i
             WHERE i.project_id = NEW.project_id AND i.inviter_user_id = NEW.sender_user_id
               AND i.target_user_id = v_recipient AND i.status = 'pending'
        );
        v_first := NOT EXISTS (
            SELECT 1 FROM comms.dm_messages m
             WHERE m.thread_id = NEW.thread_id AND m.sender_user_id = v_recipient
               AND m.auto_response_id IS NULL AND m.deleted_at IS NULL
        );

        SELECT r.* INTO v_rule
          FROM comms.auto_responses r
         WHERE r.user_id = v_recipient AND r.enabled AND btrim(r.message) <> ''
           AND (r.starts_at IS NULL OR r.starts_at <= v_now)
           AND (r.ends_at IS NULL OR r.ends_at > v_now)
           AND CASE r.trigger
               WHEN 'keyword' THEN strpos(lower(NEW.body), lower(r.keyword)) > 0
               WHEN 'service' THEN (NEW.service_id IS NOT NULL OR v_kind = 'service_inquiry')
                   AND (r.service_id IS NULL OR r.service_id = NEW.service_id)
               WHEN 'project_invitation' THEN v_invite
               WHEN 'status' THEN comms.fn_auto_reply_status(v_recipient, r.status_condition, v_now)
               WHEN 'any' THEN v_first
               ELSE false
           END
           AND NOT EXISTS (
               SELECT 1 FROM comms.dm_messages m
                WHERE m.thread_id = NEW.thread_id AND m.auto_response_id = r.id
                  AND m.created_at > v_now - interval '24 hours'
           )
         ORDER BY CASE
               WHEN r.trigger = 'keyword' THEN 0
               WHEN r.trigger = 'service' AND r.service_id IS NOT NULL THEN 1
               WHEN r.trigger = 'project_invitation' THEN 2
               WHEN r.trigger = 'service' THEN 3
               WHEN r.trigger = 'status' THEN 4
               ELSE 5
           END, r.created_at, r.id
         LIMIT 1;
        IF NOT FOUND THEN
            RETURN NULL;
        END IF;

        INSERT INTO comms.dm_messages (thread_id, sender_user_id, body, auto_response_id)
        VALUES (NEW.thread_id, v_recipient, v_rule.message, v_rule.id);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'comms.tg_dm_auto_reply: thread % — % (%)', NEW.thread_id, SQLERRM, SQLSTATE;
    END;
    RETURN NULL;
END;
$$;
-- #endregion

-- #region Direct-message shielding for under-18 accounts (Decision #208)
-- UK Children's Code: a restricted (13–17) account is not messaged by — and does not message —
-- arbitrary people. A direct thread that includes a minor holds only people who follow each other.
-- Two triggers enforce it on every path: a participant row may join a thread only if it is allowed
-- with every participant already there (get_or_create_dm_thread, create_group_thread,
-- add_dm_thread_members, send_request_message all write participants), and a message may be sent
-- only while its sender is still allowed with every other participant (an unfollow ends it).
-- Project and stage channels are a separate table and unaffected; a minor is never on anyone
-- else's project anyway.
CREATE OR REPLACE FUNCTION comms.fn_is_mutual_follow(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM org.profile_follows f
         WHERE f.follower_user_id = p_a AND f.target_entity_type = 'user' AND f.target_entity_id = p_b
    ) AND EXISTS (
        SELECT 1 FROM org.profile_follows f
         WHERE f.follower_user_id = p_b AND f.target_entity_type = 'user' AND f.target_entity_id = p_a
    );
$$;

-- Whether two people may share a direct thread: always, unless one is a minor — then only when they
-- follow each other.
CREATE OR REPLACE FUNCTION comms.fn_dm_allowed(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p_a = p_b
        OR NOT (org.fn_is_minor(p_a) OR org.fn_is_minor(p_b))
        OR comms.fn_is_mutual_follow(p_a, p_b);
$$;

CREATE OR REPLACE FUNCTION comms.trg_dm_shield()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_person uuid := (pg_catalog.to_jsonb(NEW) ->> CASE WHEN TG_TABLE_NAME = 'dm_messages' THEN 'sender_user_id' ELSE 'user_id' END)::uuid;
BEGIN
    -- An entity channel is not a direct thread: who is in it is the entity's roster, decided when they
    -- joined the entity, not a contact one person opened with another.
    IF EXISTS (SELECT 1 FROM comms.dm_threads t WHERE t.id = NEW.thread_id AND t.kind = 'entity_channel') THEN
        RETURN NEW;
    END IF;
    IF EXISTS (
        SELECT 1 FROM comms.dm_participants p
         WHERE p.thread_id = NEW.thread_id AND p.user_id <> v_person
           AND NOT comms.fn_dm_allowed(v_person, p.user_id)
    ) THEN
        RAISE EXCEPTION 'messages: people under 18 can message only people they follow who follow them back'
            USING ERRCODE = 'PM403';
    END IF;
    RETURN NEW;
END;
$$;
-- #endregion

-- #region Entity channels (Decision #306)
-- A team's or a business's named rooms (`# general`, `# delivery-sync`). A channel is a comms.dm_threads
-- row of kind `entity_channel`, so the /messages chat stack — the feed, the send path, read state,
-- attachments, reactions and every policy built on comms.is_dm_participant — serves it unchanged. What
-- differs is who is in it: never somebody a person added, always the owner's ACTIVE members, kept in
-- step by the triggers in 00001840. Leaving soft-deletes the participation (`deleted_at`), so the
-- history stays and the access ends; rejoining restores it on every live channel.
--
-- The two doors are SECURITY DEFINER for the reason create_group_thread is: dm_threads and
-- dm_participants carry no client write policy on purpose (00002012), and a channel's participant rows
-- are written for OTHER people (every member), which no INSERT policy may admit. Each re-checks the
-- caller's active membership itself. Refusals follow the workspace doors' '<field>: <reason>'
-- convention (packages/backend/services/workspace/live-support.ts refusalFrom).

-- The name a person typed, as a channel slug: trimmed, a leading `#` dropped, lowercased. The TS twin is
-- channelSlugOf (@projective/types/workspace channels.ts).
CREATE OR REPLACE FUNCTION comms.fn_channel_slug(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT lower(regexp_replace(btrim(COALESCE(p_name, '')), '^#+\s*', ''));
$$;

-- The user ids of an entity's active members who can hold a participant row (org.users_public).
CREATE OR REPLACE FUNCTION comms.fn_entity_member_ids(p_kind text, p_entity uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT m.user_id FROM org.team_members m
     WHERE p_kind = 'team' AND m.team_id = p_entity AND m.status = 'active'
       AND EXISTS (SELECT 1 FROM org.users_public u WHERE u.user_id = m.user_id)
    UNION
    SELECT m.user_id FROM org.business_members m
     WHERE p_kind = 'business' AND m.business_id = p_entity AND m.status = 'active'
       AND EXISTS (SELECT 1 FROM org.users_public u WHERE u.user_id = m.user_id);
$$;

-- Whether a person may edit or archive an entity channel (Decision #308): an active member who added it,
-- or one holding `manage_settings`. FALSE for anything that is not a live channel. Internal.
CREATE OR REPLACE FUNCTION comms.fn_can_manage_entity_channel(p_channel_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE((
        SELECT EXISTS (SELECT 1 FROM org.fn_member_seat(t.owner_type, t.owner_entity_id, p_user))
           AND (t.created_by_user_id = p_user
                OR 'manage_settings'::org.workspace_capability
                   = ANY (org.fn_member_capabilities(t.owner_type, t.owner_entity_id, p_user)))
          FROM comms.dm_threads t
         WHERE t.id = p_channel_id AND t.kind = 'entity_channel' AND t.archived_at IS NULL
    ), false);
$$;

-- An entity's live channels as the console lists them for one viewer: the default first, then by slug,
-- each with the viewer's unread count (other people's messages after their read watermark; a NULL
-- watermark is "never opened", so every one) and the newest message's time, its display name, emoji and
-- photo, the viewer's own star and mute, and whether the viewer may edit it (Decision #308). Internal —
-- read by org.get_workspace_detail, which has already decided the viewer is an active member.
CREATE OR REPLACE FUNCTION comms.fn_entity_channel_list(p_kind text, p_entity uuid, p_viewer uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', t.id,
            'slug', t.slug,
            'name', t.title,
            'topic', t.topic,
            'emoji', t.emoji,
            'photo_file_id', t.photo_file_id,
            'starred', COALESCE(me.is_starred, false),
            'muted', COALESCE(me.is_muted, false),
            'can_manage', comms.fn_can_manage_entity_channel(t.id, p_viewer),
            'is_default', t.is_default,
            'unread', (SELECT count(*) FROM comms.dm_messages m
                        WHERE m.thread_id = t.id AND m.deleted_at IS NULL
                          AND m.sender_user_id <> p_viewer
                          AND (me.last_read_at IS NULL OR m.created_at > me.last_read_at)),
            'last_activity_at', (SELECT max(m.created_at) FROM comms.dm_messages m
                                  WHERE m.thread_id = t.id AND m.deleted_at IS NULL)
        ) ORDER BY t.is_default DESC, t.slug), '[]'::jsonb)
      FROM comms.dm_threads t
      LEFT JOIN comms.dm_participants me
             ON me.thread_id = t.id AND me.user_id = p_viewer AND me.deleted_at IS NULL
     WHERE t.kind = 'entity_channel' AND t.owner_type = p_kind AND t.owner_entity_id = p_entity
       AND t.archived_at IS NULL;
$$;

-- The entity's default `general` channel, created when it is missing; its id either way. NULL when the
-- creator has no org.users_public row to stand as the thread's author (the entity is still created).
CREATE OR REPLACE FUNCTION comms.fn_ensure_default_channel(p_kind text, p_entity uuid, p_creator uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
BEGIN
    SELECT t.id INTO v_id FROM comms.dm_threads t
     WHERE t.kind = 'entity_channel' AND t.owner_type = p_kind AND t.owner_entity_id = p_entity
       AND t.is_default;
    IF v_id IS NOT NULL THEN
        RETURN v_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM org.users_public u WHERE u.user_id = p_creator) THEN
        RETURN NULL;
    END IF;
    INSERT INTO comms.dm_threads (kind, owner_type, owner_entity_id, slug, is_default, created_by_user_id)
    VALUES ('entity_channel', p_kind, p_entity, 'general', true, p_creator)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- Put one person into, or take them out of, every channel of an entity. Joining restores a participation
-- they had and adds the rest, on LIVE channels only; leaving soft-deletes it on every channel, archived
-- ones included, so no channel of an entity they left stays readable.
CREATE OR REPLACE FUNCTION comms.fn_sync_channel_member(
    p_kind text,
    p_entity uuid,
    p_user uuid,
    p_active boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_active THEN
        UPDATE comms.dm_participants p
           SET deleted_at = NULL
          FROM comms.dm_threads t
         WHERE p.thread_id = t.id AND p.user_id = p_user AND p.deleted_at IS NOT NULL
           AND t.kind = 'entity_channel' AND t.owner_type = p_kind AND t.owner_entity_id = p_entity
           AND t.archived_at IS NULL;
        INSERT INTO comms.dm_participants (thread_id, user_id)
        SELECT t.id, p_user FROM comms.dm_threads t
         WHERE t.kind = 'entity_channel' AND t.owner_type = p_kind AND t.owner_entity_id = p_entity
           AND t.archived_at IS NULL
           AND EXISTS (SELECT 1 FROM org.users_public u WHERE u.user_id = p_user)
           AND NOT EXISTS (
               SELECT 1 FROM comms.dm_participants p WHERE p.thread_id = t.id AND p.user_id = p_user
           );
    ELSE
        UPDATE comms.dm_participants p
           SET deleted_at = now()
          FROM comms.dm_threads t
         WHERE p.thread_id = t.id AND p.user_id = p_user AND p.deleted_at IS NULL
           AND t.kind = 'entity_channel' AND t.owner_type = p_kind AND t.owner_entity_id = p_entity;
    END IF;
END;
$$;

-- AFTER INSERT on comms.dm_threads, entity channels only: every active member of the owner joins.
CREATE OR REPLACE FUNCTION comms.tg_entity_channel_seed_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO comms.dm_participants (thread_id, user_id)
    SELECT NEW.id, m.user_id
      FROM comms.fn_entity_member_ids(NEW.owner_type, NEW.owner_entity_id) AS m(user_id)
     WHERE NOT EXISTS (
         SELECT 1 FROM comms.dm_participants p WHERE p.thread_id = NEW.id AND p.user_id = m.user_id
     );
    RETURN NULL;
END;
$$;

-- AFTER INSERT OR UPDATE OF status on org.team_members / org.business_members (TG_ARGV[0] = the kind):
-- a membership that becomes active joins the entity's channels, one that stops being active leaves them.
CREATE OR REPLACE FUNCTION comms.tg_entity_member_channels()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_kind text := TG_ARGV[0];
    v_entity uuid := (to_jsonb(NEW) ->> CASE WHEN TG_ARGV[0] = 'team' THEN 'team_id' ELSE 'business_id' END)::uuid;
    v_was boolean := false;
    v_is boolean := NEW.status = 'active';
BEGIN
    IF TG_OP = 'UPDATE' THEN
        v_was := OLD.status = 'active';
    END IF;
    IF v_is IS DISTINCT FROM v_was THEN
        PERFORM comms.fn_sync_channel_member(v_kind, v_entity, NEW.user_id, v_is);
    END IF;
    RETURN NULL;
END;
$$;

-- AFTER INSERT on org.teams / org.business_profiles (TG_ARGV[0] = the kind): the entity's `general`.
CREATE OR REPLACE FUNCTION comms.tg_entity_default_channel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM comms.fn_ensure_default_channel(TG_ARGV[0], NEW.id, NEW.owner_user_id);
    RETURN NULL;
END;
$$;

-- A new channel, by an active member of a team or business that is not archived. Returns the channel as
-- the console lists it. Caps an entity at 30 live channels (CHANNEL_LIVE_CAP); the count and the insert
-- run under a per-entity advisory lock so two concurrent creates cannot both take the last place.
CREATE OR REPLACE FUNCTION comms.create_entity_channel(
    p_entity_type text,
    p_entity_id uuid,
    p_name text,
    p_topic text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_status text;
    v_slug text := comms.fn_channel_slug(p_name);
    v_topic text := NULLIF(btrim(COALESCE(p_topic, '')), '');
    v_id uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    IF p_entity_type IS NULL OR p_entity_type NOT IN ('team', 'business') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'kind: choose a team or a business';
    END IF;
    v_status := CASE p_entity_type
        WHEN 'team' THEN (SELECT t.status FROM org.teams t WHERE t.id = p_entity_id)
        ELSE (SELECT b.status FROM org.business_profiles b WHERE b.id = p_entity_id) END;
    IF v_status IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'workspace: not found';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM org.fn_member_seat(p_entity_type, p_entity_id, v_uid)) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'workspace: only its members can add a channel';
    END IF;
    IF v_status = 'archived' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'workspace: restore it before adding a channel';
    END IF;
    IF char_length(v_slug) < 2 OR char_length(v_slug) > 40 OR v_slug !~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = 'name: use 2 to 40 lowercase letters, numbers or hyphens, starting and ending with a letter or number';
    END IF;
    IF v_topic IS NOT NULL AND char_length(v_topic) > 200 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'topic: keep it to 200 characters';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('comms.entity_channels:' || p_entity_id::text));
    IF EXISTS (
        SELECT 1 FROM comms.dm_threads t
         WHERE t.kind = 'entity_channel' AND t.owner_type = p_entity_type AND t.owner_entity_id = p_entity_id
           AND t.archived_at IS NULL AND t.slug = v_slug
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'name: there is already a #' || v_slug || ' channel';
    END IF;
    IF (SELECT count(*) FROM comms.dm_threads t
         WHERE t.kind = 'entity_channel' AND t.owner_type = p_entity_type AND t.owner_entity_id = p_entity_id
           AND t.archived_at IS NULL) >= 30 THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
            MESSAGE = 'channel: a workspace holds at most 30 channels — archive one to make room';
    END IF;

    INSERT INTO comms.dm_threads (kind, owner_type, owner_entity_id, slug, topic, created_by_user_id)
    VALUES ('entity_channel', p_entity_type, p_entity_id, v_slug, v_topic, v_uid)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object(
        'id', v_id,
        'slug', v_slug,
        'name', NULL,
        'topic', v_topic,
        'emoji', NULL,
        'photo_file_id', NULL,
        'starred', false,
        'muted', false,
        'can_manage', true,
        'is_default', false,
        'unread', 0,
        'last_activity_at', NULL
    );
END;
$$;

-- Archive a channel: its creator, or a member holding `manage_settings`. The default channel never is.
-- A channel the caller cannot see (not an active member, already archived, not a channel at all) is one
-- answer — not found — so the door cannot be used to probe ids.
CREATE OR REPLACE FUNCTION comms.archive_entity_channel(p_channel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_t record;
    v_at timestamptz := now();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    SELECT t.id, t.owner_type, t.owner_entity_id, t.is_default, t.created_by_user_id, t.archived_at
      INTO v_t
      FROM comms.dm_threads t
     WHERE t.id = p_channel_id AND t.kind = 'entity_channel'
       FOR UPDATE;
    IF v_t.id IS NULL OR v_t.archived_at IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM org.fn_member_seat(v_t.owner_type, v_t.owner_entity_id, v_uid)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'channel: not found';
    END IF;
    IF v_t.is_default THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'channel: the default channel stays — every member is in it';
    END IF;
    IF v_t.created_by_user_id <> v_uid
       AND NOT ('manage_settings'::org.workspace_capability
                = ANY (org.fn_member_capabilities(v_t.owner_type, v_t.owner_entity_id, v_uid))) THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
            MESSAGE = 'channel: only the person who added it, or someone who manages settings, can archive it';
    END IF;

    UPDATE comms.dm_threads SET archived_at = v_at WHERE id = v_t.id;

    RETURN jsonb_build_object(
        'id', v_t.id,
        'owner_type', v_t.owner_type,
        'owner_entity_id', v_t.owner_entity_id,
        'archived_at', v_at
    );
END;
$$;

-- Edit a channel's display name, topic and emoji (Decision #308): its creator, or a member holding
-- `manage_settings`, on an entity that is not archived. Every field is replaced — NULL or blank clears
-- it — and the slug is never touched, so the channel keeps its address. The default channel may be
-- renamed like any other. A channel the caller cannot see is one answer, not found, as on archive.
CREATE OR REPLACE FUNCTION comms.update_entity_channel(
    p_channel_id uuid,
    p_name text,
    p_topic text,
    p_emoji text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_t record;
    v_status text;
    v_name text := NULLIF(btrim(COALESCE(p_name, '')), '');
    v_topic text := NULLIF(btrim(COALESCE(p_topic, '')), '');
    v_emoji text := NULLIF(btrim(COALESCE(p_emoji, '')), '');
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth: sign in first';
    END IF;
    SELECT t.id, t.owner_type, t.owner_entity_id, t.slug, t.archived_at
      INTO v_t
      FROM comms.dm_threads t
     WHERE t.id = p_channel_id AND t.kind = 'entity_channel'
       FOR UPDATE;
    IF v_t.id IS NULL OR v_t.archived_at IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM org.fn_member_seat(v_t.owner_type, v_t.owner_entity_id, v_uid)) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'channel: not found';
    END IF;
    IF NOT comms.fn_can_manage_entity_channel(v_t.id, v_uid) THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
            MESSAGE = 'channel: only the person who added it, or someone who manages settings, can edit it';
    END IF;
    v_status := CASE v_t.owner_type
        WHEN 'team' THEN (SELECT e.status FROM org.teams e WHERE e.id = v_t.owner_entity_id)
        ELSE (SELECT e.status FROM org.business_profiles e WHERE e.id = v_t.owner_entity_id) END;
    IF v_status = 'archived' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'workspace: restore it before editing a channel';
    END IF;
    IF v_name IS NOT NULL AND char_length(v_name) > 60 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'name: keep it to 60 characters';
    END IF;
    IF v_topic IS NOT NULL AND char_length(v_topic) > 200 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'topic: keep it to 200 characters';
    END IF;
    IF v_emoji IS NOT NULL AND char_length(v_emoji) > 16 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'emoji: choose a single emoji';
    END IF;

    UPDATE comms.dm_threads
       SET title = v_name, topic = v_topic, emoji = v_emoji
     WHERE id = v_t.id;

    RETURN jsonb_build_object(
        'id', v_t.id,
        'slug', v_t.slug,
        'name', v_name,
        'topic', v_topic,
        'emoji', v_emoji
    );
END;
$$;

COMMENT ON FUNCTION comms.update_entity_channel(uuid, text, text, text) IS
'Replace an entity channel''s display name (title, <= 60), topic (<= 200) and emoji (<= 16); blank clears. The creator or a manage_settings holder on a non-archived entity; the slug never changes. A channel the caller cannot see is P0002. SECURITY DEFINER because dm_threads carries no client UPDATE policy (Decision #308).';

COMMENT ON FUNCTION comms.fn_can_manage_entity_channel(uuid, uuid) IS
'Whether a user may edit or archive a live entity channel: an active member who created it, or one holding manage_settings (Decision #308). Internal.';

COMMENT ON FUNCTION comms.create_entity_channel(text, uuid, text, text) IS
'Create a channel (kind entity_channel) on a team or business the caller is an active member of. Name normalised by comms.fn_channel_slug and held to 2-40 of [a-z0-9-]; a duplicate live slug is 23505, more than 30 live channels 55000, an archived entity 55000. Participants are seeded by trigger. SECURITY DEFINER because dm_threads/dm_participants carry no client write policy (Decision #306).';

COMMENT ON FUNCTION comms.archive_entity_channel(uuid) IS
'Archive an entity channel (archived_at; never deleted). The creator or a manage_settings holder; the default channel is refused (55000); a channel the caller cannot see is P0002. SECURITY DEFINER because dm_threads carries no client UPDATE policy (Decision #306).';
-- #endregion

-- #region The inbox read model and project-stamped DMs (Decision #339, ruling N1)
-- One conversation per pair, drawn the same in the inbox and in its project (CAS §6.1). The two message
-- stores stay separate; what unifies them is the thread's `cht-` address (dm_threads.ref, 00001890), a
-- summary of each thread's newest message that the inbox reads instead of every thread's messages,
-- and the project a DM is about, written on the message itself.

-- AFTER INSERT on comms.dm_messages: point the thread's summary at this message when it is newer than
-- the one recorded, by (created_at, id), the order every reader of a thread sorts by, so a seed or any
-- out-of-order insert never moves it back. A message inserted already deleted is never a tail.
-- SECURITY DEFINER because the sender's role holds no UPDATE on comms.dm_threads (00002520) and
-- trg_dm_threads_derived refuses it these columns; the owner passes both.
CREATE OR REPLACE FUNCTION comms.tg_dm_thread_summary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.deleted_at IS NULL THEN
        UPDATE comms.dm_threads t
           SET last_message_at = NEW.created_at,
               last_message_id = NEW.id
         WHERE t.id = NEW.thread_id
           AND (t.last_message_at IS NULL
                OR (NEW.created_at, NEW.id) > (t.last_message_at, t.last_message_id));
    END IF;
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION comms.tg_dm_thread_summary() IS
'AFTER INSERT trigger on comms.dm_messages: advances comms.dm_threads.last_message_at / last_message_id to the new message when (created_at, id) is newer than the recorded pair, never backwards. Skips a message inserted already deleted.';

-- BEFORE INSERT on comms.dm_messages: the project a DM is about, so the project's Private Messages
-- group draws the same thread the inbox opens (CAS M1). A supplied project_id is kept only when the
-- sender and every other undeleted participant are parties to it (projects.fn_engaged_projects, the
-- predicate comms.fn_dm_protected_project derives with). Otherwise it is derived, a protected project
-- the sender and another member share, or left NULL, so no client can file a DM under a project it
-- is not on. An entity channel is its entity's room, never a project's conversation, and carries
-- none. Its trigger sorts before trg_dm_messages_mask_pii (00001840), so the mask reads the project
-- settled here.
CREATE OR REPLACE FUNCTION comms.tg_bind_dm_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM comms.dm_threads t
         WHERE t.id = NEW.thread_id AND t.kind = 'entity_channel'
    ) THEN
        NEW.project_id := NULL;
        RETURN NEW;
    END IF;

    IF NEW.project_id IS NOT NULL AND NOT (
        EXISTS (
            SELECT 1 FROM projects.fn_engaged_projects(NEW.sender_user_id) e
             WHERE e.project_id = NEW.project_id
        )
        AND EXISTS (
            SELECT 1 FROM comms.dm_participants o
             WHERE o.thread_id = NEW.thread_id
               AND o.user_id <> NEW.sender_user_id
               AND o.deleted_at IS NULL
        )
        AND NOT EXISTS (
            SELECT 1 FROM comms.dm_participants o
             WHERE o.thread_id = NEW.thread_id
               AND o.user_id <> NEW.sender_user_id
               AND o.deleted_at IS NULL
               AND NOT EXISTS (
                   SELECT 1 FROM projects.fn_engaged_projects(o.user_id) e
                    WHERE e.project_id = NEW.project_id
               )
        )
    ) THEN
        NEW.project_id := NULL;
    END IF;

    IF NEW.project_id IS NULL THEN
        NEW.project_id := comms.fn_dm_protected_project(NEW.thread_id, NEW.sender_user_id, NULL);
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION comms.tg_bind_dm_project() IS
'BEFORE INSERT trigger on comms.dm_messages: keeps a supplied project_id only when the sender and every other undeleted participant are parties to that project, else derives one with comms.fn_dm_protected_project(thread, sender, NULL), else NULL. An entity-channel message carries none. Fires before trg_dm_messages_mask_pii.';

-- The inbox's previews in one round trip (RED D-04, CAS §6.1.1): the newest p_k messages of each listed
-- thread, newest first, threads in the order given. SECURITY INVOKER, so the dm_threads and dm_messages
-- read policies are the guard and a thread the caller is not in returns nothing. k = 1 reads through
-- the thread summary (dm_threads.last_message_id), falling back to the thread's own newest message
-- when that one has been deleted since; k > 1 walks idx_dm_messages_thread_recent. p_k is held to
-- 1..20, the list to its first 200 ids, and a repeated id is read once.
CREATE OR REPLACE FUNCTION comms.inbox_tails(p_thread_ids uuid[], p_k integer DEFAULT 1)
RETURNS TABLE (
    thread_id uuid,
    id uuid,
    sender_user_id uuid,
    body text,
    has_attachments boolean,
    is_audio boolean,
    created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_k integer := LEAST(GREATEST(COALESCE(p_k, 1), 1), 20);
    v_ids uuid[];
BEGIN
    v_ids := ARRAY(
        SELECT u.tid
          FROM unnest(p_thread_ids[1:200]) WITH ORDINALITY AS u(tid, ord)
         WHERE u.tid IS NOT NULL
         GROUP BY u.tid
         ORDER BY min(u.ord)
    );

    IF v_k = 1 THEN
        RETURN QUERY
        SELECT tail.thread_id, tail.id, tail.sender_user_id, tail.body, tail.has_attachments,
               tail.is_audio, tail.created_at
          FROM unnest(v_ids) WITH ORDINALITY AS u(tid, ord)
          JOIN comms.dm_threads t ON t.id = u.tid
          CROSS JOIN LATERAL (
              SELECT m.thread_id, m.id, m.sender_user_id, m.body, m.has_attachments, m.is_audio,
                     m.created_at
                FROM comms.dm_messages m
               WHERE m.id = t.last_message_id AND m.deleted_at IS NULL
              UNION ALL
              SELECT f.thread_id, f.id, f.sender_user_id, f.body, f.has_attachments, f.is_audio,
                     f.created_at
                FROM (
                    SELECT m.thread_id, m.id, m.sender_user_id, m.body, m.has_attachments,
                           m.is_audio, m.created_at
                      FROM comms.dm_messages m
                     WHERE m.thread_id = t.id AND m.deleted_at IS NULL
                     ORDER BY m.created_at DESC, m.id DESC
                     LIMIT 1
                ) f
               WHERE NOT EXISTS (
                   SELECT 1 FROM comms.dm_messages p
                    WHERE p.id = t.last_message_id AND p.deleted_at IS NULL
               )
          ) tail
         ORDER BY u.ord;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT m.thread_id, m.id, m.sender_user_id, m.body, m.has_attachments, m.is_audio, m.created_at
      FROM unnest(v_ids) WITH ORDINALITY AS u(tid, ord)
      CROSS JOIN LATERAL (
          SELECT d.thread_id, d.id, d.sender_user_id, d.body, d.has_attachments, d.is_audio,
                 d.created_at
            FROM comms.dm_messages d
           WHERE d.thread_id = u.tid AND d.deleted_at IS NULL
           ORDER BY d.created_at DESC, d.id DESC
           LIMIT v_k
      ) m
     ORDER BY u.ord, m.created_at DESC, m.id DESC;
END;
$$;

COMMENT ON FUNCTION comms.inbox_tails(uuid[], integer) IS
'The newest p_k (1..20) undeleted messages of each listed thread (first 200 ids), newest first, threads in the order given. SECURITY INVOKER: RLS on dm_threads / dm_messages is the guard, so a non-participant gets no rows. k = 1 reads through dm_threads.last_message_id.';
-- #endregion

-- #region The send: a message and its files in one transaction (CAS M15, M18; PROJECTS CH4)
-- MessagingBackendService.sendMessage, the one send door (#508), used to write a message as three
-- PostgREST calls: the message row, then its comms.message_attachments links, then its
-- comms.channel_files rows, never reading the answer of the second or third. A link the database
-- refused (a file the sender cannot read, one deleted meanwhile) left a message that said "see
-- attached" with nothing attached, already delivered, and the door reported it sent. This is that
-- write as one statement of one transaction: every row lands, or none does.
--
-- SECURITY INVOKER on purpose. It adds no authority: the INSERT policies of the four tables
-- (00002012), the column grants (00002520), the reply guards, the DM shield and the PII mask
-- (00001840) all run exactly as they did for the separate inserts, as the caller. It cannot write a
-- message the caller could not already write.
--
-- p_kind 'room' writes comms.project_messages into the room p_target_id; 'dm' writes
-- comms.dm_messages into the thread p_target_id, with p_project_id when the thread was opened inside
-- a project (comms.tg_bind_dm_project decides whether it is kept). p_copies are the files sent as
-- copies and p_links the sender's own files shared as links (Decision #401), both files.items ids
-- in the order the sender attached them; the links are written in that order, a microsecond apart,
-- so the feed's (created_at, id) order is the attach order rather than a uuid shuffle.
--
-- p_audio is the voice memo, or NULL: {"attachmentId": uuid, "durationMs": int, "peaks": [0..1]}.
-- Its file must be one of p_copies. Its facts land on that one link row (audio_duration_ms,
-- audio_peaks), which is what the feed rebuilds the player from after a reload. A malformed memo is
-- refused 22023 before anything is written. Any refused link raises PA422 with one sentence the
-- send door answers in its own words, the cause in DETAIL. Returns the new message id.
CREATE OR REPLACE FUNCTION comms.send_message(
    p_kind text,
    p_target_id uuid,
    p_body text,
    p_body_delta jsonb DEFAULT NULL,
    p_reply_to_id uuid DEFAULT NULL,
    p_project_id uuid DEFAULT NULL,
    p_copies uuid[] DEFAULT '{}'::uuid[],
    p_links uuid[] DEFAULT '{}'::uuid[],
    p_audio jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_copies   uuid[] := COALESCE(p_copies, '{}'::uuid[]);
    v_links    uuid[] := COALESCE(p_links, '{}'::uuid[]);
    v_has_files boolean;
    v_table    text;
    v_channel  text;
    v_id       uuid;
    v_memo     uuid;
    v_duration integer;
    v_peaks    real[];
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in to send a message.' USING ERRCODE = '42501';
    END IF;
    IF p_kind IS NULL OR p_kind NOT IN ('room', 'dm') THEN
        RAISE EXCEPTION 'send_message: p_kind must be room or dm.' USING ERRCODE = '22023';
    END IF;
    IF array_position(v_copies, NULL) IS NOT NULL OR array_position(v_links, NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'send_message: a file id is missing.' USING ERRCODE = '22023';
    END IF;
    v_has_files := cardinality(v_copies) + cardinality(v_links) > 0;

    -- #region The memo, checked before anything is written
    IF p_audio IS NOT NULL THEN
        IF pg_catalog.jsonb_typeof(p_audio) IS DISTINCT FROM 'object'
           OR pg_catalog.jsonb_typeof(p_audio -> 'durationMs') IS DISTINCT FROM 'number'
           OR pg_catalog.jsonb_typeof(p_audio -> 'peaks') IS DISTINCT FROM 'array'
           OR COALESCE(p_audio ->> 'attachmentId', '')
              !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN
            RAISE EXCEPTION 'audio: The voice memo is incomplete.' USING ERRCODE = '22023';
        END IF;
        v_memo := (p_audio ->> 'attachmentId')::uuid;
        IF NOT (v_memo = ANY (v_copies)) THEN
            RAISE EXCEPTION 'audio: The voice memo must be one of this message''s own uploads.'
                USING ERRCODE = '22023';
        END IF;
        IF (p_audio ->> 'durationMs')::numeric <> trunc((p_audio ->> 'durationMs')::numeric)
           OR (p_audio ->> 'durationMs')::numeric NOT BETWEEN 0 AND 2147483647
        THEN
            RAISE EXCEPTION 'audio: The voice memo has no valid length.' USING ERRCODE = '22023';
        END IF;
        v_duration := (p_audio ->> 'durationMs')::integer;
        IF pg_catalog.jsonb_array_length(p_audio -> 'peaks') > 512
           OR EXISTS (
               SELECT 1 FROM pg_catalog.jsonb_array_elements(p_audio -> 'peaks') AS e(v)
                WHERE CASE WHEN pg_catalog.jsonb_typeof(e.v) = 'number'
                           THEN (e.v #>> '{}')::numeric NOT BETWEEN 0 AND 1
                           ELSE true END
           )
        THEN
            RAISE EXCEPTION 'audio: The voice memo''s waveform is not valid.' USING ERRCODE = '22023';
        END IF;
        v_peaks := ARRAY(
            SELECT (e.v #>> '{}')::real
              FROM pg_catalog.jsonb_array_elements(p_audio -> 'peaks') WITH ORDINALITY AS e(v, ord)
             ORDER BY e.ord
        );
    END IF;
    -- #endregion

    -- #region The message, as the caller
    IF p_kind = 'room' THEN
        v_table := 'comms.project_messages';
        v_channel := 'project';
        INSERT INTO comms.project_messages
            (channel_id, sender_user_id, body, body_delta, reply_to_id, has_attachments, is_audio)
        VALUES
            (p_target_id, auth.uid(), p_body, p_body_delta, p_reply_to_id, v_has_files, p_audio IS NOT NULL)
        RETURNING id INTO v_id;
    ELSE
        v_table := 'comms.dm_messages';
        v_channel := 'dm';
        INSERT INTO comms.dm_messages
            (thread_id, sender_user_id, project_id, body, body_delta, reply_to_id, has_attachments, is_audio)
        VALUES
            (p_target_id, auth.uid(), p_project_id, p_body, p_body_delta, p_reply_to_id, v_has_files,
             p_audio IS NOT NULL)
        RETURNING id INTO v_id;
    END IF;
    -- #endregion

    -- #region Its files: every link lands, or the message does not
    IF v_has_files THEN
        BEGIN
            INSERT INTO comms.message_attachments
                (message_table, message_id, attachment_id, mode, created_at, audio_duration_ms, audio_peaks)
            SELECT v_table, v_id, f.id, f.mode::comms.attachment_mode,
                   pg_catalog.now() + pg_catalog.make_interval(secs => f.ord / 1000000.0),
                   CASE WHEN f.mode = 'copy' AND f.id = v_memo THEN v_duration END,
                   CASE WHEN f.mode = 'copy' AND f.id = v_memo THEN v_peaks END
              FROM (
                  SELECT c.id, 'copy'::text AS mode, c.ord
                    FROM unnest(v_copies) WITH ORDINALITY AS c(id, ord)
                  UNION ALL
                  SELECT l.id, 'link'::text, cardinality(v_copies) + l.ord
                    FROM unnest(v_links) WITH ORDINALITY AS l(id, ord)
              ) f
             ORDER BY f.ord;

            INSERT INTO comms.channel_files (channel_type, channel_id, attachment_id)
            SELECT v_channel, p_target_id, f.id
              FROM (
                  SELECT c.id, c.ord FROM unnest(v_copies) WITH ORDINALITY AS c(id, ord)
                  UNION ALL
                  SELECT l.id, cardinality(v_copies) + l.ord FROM unnest(v_links) WITH ORDINALITY AS l(id, ord)
              ) f
             ORDER BY f.ord;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'A file could not be attached to this message, so nothing was sent.'
                USING ERRCODE = 'PA422', DETAIL = SQLSTATE || ' ' || SQLERRM;
        END;
    END IF;
    -- #endregion

    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION comms.send_message(text, uuid, text, jsonb, uuid, uuid, uuid[], uuid[], jsonb) IS
'The send door write (CAS M15, M18; PROJECTS CH4): one message (room: comms.project_messages; dm: comms.dm_messages) and every comms.message_attachments and comms.channel_files row for its files, in one transaction, as the caller (SECURITY INVOKER: every table policy, column grant and trigger applies). A voice memo (p_audio) is checked first (22023) and its duration and waveform land on its own link row. Any refused link fails the whole send with PA422. Returns the message id.';
-- #endregion
