-- =============================================================================================
-- 00000022_tables_scheduling.sql — scheduling schema tables (Category 0).
-- Sources: 20260724100000 (schedules, availability_rules, blackout_dates), 102000 (events),
--          103000 (call_settings, discovery_calls, call_attendance, call_audit),
--          coordination (event_attendees, event_reschedules, reschedule_proposals, proposal_votes,
--          event_history, event_attachments) — the tables Decision #71 recorded as deliberately
--          absent while the surface ran on per-process overlay Maps.
-- Ordered after finance/integrations/comms/projects (scheduling.events → integrations.user_connections,
-- projects.session_events, comms.project_channels; scheduling.discovery_calls → finance.escrows).
-- =============================================================================================

CREATE TABLE scheduling.schedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    owner_type scheduling.owner_type NOT NULL,
    owner_id uuid NOT NULL,
    timezone text NOT NULL DEFAULT 'Europe/London',
    is_published boolean NOT NULL DEFAULT false,
    mask_external_events boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_schedule_owner UNIQUE (owner_type, owner_id)
);

CREATE TABLE scheduling.availability_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    schedule_id uuid NOT NULL REFERENCES scheduling.schedules (id) ON DELETE CASCADE,
    kind scheduling.availability_kind NOT NULL DEFAULT 'working_hours',
    -- 0 = Sunday … 6 = Saturday (matches the Zod contract and JS `Date#getDay`).
    weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_minute integer NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
    end_minute integer NOT NULL CHECK (end_minute BETWEEN 0 AND 1440),
    label text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_availability_rule_span CHECK (end_minute > start_minute)
);

CREATE TABLE scheduling.blackout_dates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    schedule_id uuid NOT NULL REFERENCES scheduling.schedules (id) ON DELETE CASCADE,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    label text NOT NULL DEFAULT 'Unavailable',
    label_is_public boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_blackout_span CHECK (ends_at > starts_at)
);

CREATE TABLE scheduling.events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    -- Owner anchor: the schedule this entry belongs to (availability, busy, bookings).
    schedule_id uuid REFERENCES scheduling.schedules (id) ON DELETE CASCADE,
    -- Project anchor: the engagement this entry belongs to (deadlines, milestones, syncs).
    project_id uuid REFERENCES projects.projects (id) ON DELETE CASCADE,
    channel_id uuid REFERENCES comms.project_channels (id) ON DELETE SET NULL,
    kind scheduling.event_kind NOT NULL DEFAULT 'general',
    status scheduling.event_status,
    title text NOT NULL DEFAULT '',
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    all_day boolean NOT NULL DEFAULT false,
    is_masked boolean NOT NULL DEFAULT false,
    -- A CSS custom-property NAME (e.g. '--primary'), never a literal colour (root CLAUDE.md §3).
    accent text,
    location text,
    -- The online room (packages/types/scheduling/meeting.ts). Held on the occurrence rather than in
    -- a child table because an event has exactly one, and the adjacent homes cover only adjacent
    -- cases: projects.session_events carries a COHORT session's join URLs and
    -- scheduling.discovery_calls a CALL's, neither of which is a project stage sync or a standalone
    -- booking.
    --
    -- Deliberately NOT an FK to integrations.providers (slug), unlike discovery_calls.provider_slug.
    -- Five of the six members ARE provider slugs, but `custom` — the host supplying their own link,
    -- a room number, a dial-in bridge — has no catalogue row and never will, so an FK would make the
    -- one arrangement that needs no integration the one arrangement that cannot be recorded.
    meeting_provider text,
    -- Carried, not derived from the provider: for `custom` the host names the room themselves
    -- ("Studio, 2nd floor"), so there is nothing to look the label up from.
    meeting_provider_label text,
    meeting_url text,
    -- Free text on purpose: every provider words a passcode / PIN / meeting id differently, and
    -- normalising them would lose the wording the joiner is actually told to type.
    meeting_passcode text,
    meeting_details text,
    -- The room is still to be minted. A separate fact from a NULL url, which the privacy projection
    -- also produces when withholding the link from a non-party — "not arranged yet" and "you may not
    -- see it" read very differently to somebody trying to join.
    meeting_pending boolean NOT NULL DEFAULT false,
    meta text,
    attendee_count integer CHECK (attendee_count >= 0),
    capacity integer CHECK (capacity >= 0),
    href text,
    source_connection_id uuid REFERENCES integrations.user_connections (id) ON DELETE SET NULL,
    external_event_id text,
    source_session_event_id uuid REFERENCES projects.session_events (id) ON DELETE CASCADE,
    created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- `>=`, not `>`: a DEADLINE is a point in time and has no duration to record. The UI engine has
    -- always drawn `end === start` as a pin rather than as a box, precisely so a due date is not
    -- asserted to be a plausible half-hour meeting, and a `>` check here would refuse to persist the
    -- one shape that view exists to render. A milestone — a review that genuinely takes time — keeps
    -- its span; the two are different objects, not one object recorded two ways.
    CONSTRAINT ck_event_span CHECK (ends_at >= starts_at),
    CONSTRAINT ck_event_anchor CHECK (
        schedule_id IS NOT NULL
        OR project_id IS NOT NULL
    ),
    CONSTRAINT ck_event_meeting_provider CHECK (
        meeting_provider IS NULL
        OR meeting_provider IN (
            'google',
            'outlook',
            'zoom',
            'microsoft_teams',
            'discord',
            'custom'
        )
    ),
    -- A room cannot be both awaiting creation and already reachable. Without this the two columns
    -- can assert opposite things and every reader has to pick which one to believe.
    CONSTRAINT ck_event_meeting_pending CHECK (
        NOT meeting_pending
        OR meeting_url IS NULL
    ),
    CONSTRAINT uq_event_external UNIQUE (source_connection_id, external_event_id)
);

-- ---------------------------------------------------------------------------------------------
-- Event coordination (packages/types/scheduling/coordination.ts).
--
-- scheduling.events positions an occurrence on a grid; the six tables below record the negotiation
-- around it — who is coming, how a time gets moved, what has happened to it, and what was attached.
--
-- Two vocabularies are enums and four are named CHECKs, on purpose. `role` and `response` describe a
-- person's STANDING on the roster and are filtered on from OUTSIDE this file — a policy asking "is
-- this user the host", a notifier asking "who accepted" — so they get a shared named type those
-- readers can switch on exhaustively. `mode`, `status`, `proposed_by_role` and the history `kind`
-- are read only by these tables and evolve with them, so a CHECK keeps a new member an in-place edit
-- of this file rather than a cross-file change to the enum catalogue.
--
-- Free text carries an explicit length CHECK wherever the Zod bound is tight and the value is
-- user-authored. The two layers agreeing is not cosmetic: a row written past the Zod bound stores
-- fine and then fails validation on the way back out, so an unbounded column turns one bad write
-- into a read that 500s for everyone who can see the event.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE scheduling.event_attendees (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    event_id uuid NOT NULL REFERENCES scheduling.events (id) ON DELETE CASCADE,
    -- Nullable so an invitee with no platform account is still a seat, and ON DELETE SET NULL rather
    -- than CASCADE so tearing down a profile does not erase the fact that somebody was invited and
    -- answered (root CLAUDE.md §5 — nothing is hard-deleted).
    user_id uuid REFERENCES org.users_public (user_id) ON DELETE SET NULL,
    role scheduling.attendee_role NOT NULL DEFAULT 'participant',
    -- `pending` is a real answer, not the absence of one: to a host deciding whether a session is
    -- viable, "has not replied yet" and "said no" are different facts. Hence NOT NULL with a default
    -- rather than a nullable column standing in for the unanswered case.
    response scheduling.rsvp_response NOT NULL DEFAULT 'pending',
    responded_at timestamptz,
    note text CHECK (char_length(note) <= 280),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- SQL's UNIQUE ignores NULLs, which is exactly the behaviour wanted here: several external
    -- invitees may share one roster, while a registered user cannot hold two seats on the same event
    -- and therefore cannot vote twice through the back door.
    CONSTRAINT uq_event_attendee UNIQUE (event_id, user_id),
    -- Clearing an answer is itself a move, so returning to `pending` must clear the instant too —
    -- otherwise the roster reports the moment at which somebody did not answer. Only this direction
    -- is enforced: a host seated as `accepted` when the event was created never "responded".
    CONSTRAINT ck_attendee_pending_unanswered CHECK (
        response <> 'pending'::scheduling.rsvp_response
        OR responded_at IS NULL
    )
);

-- EventAttendeeSchema.isViewer is deliberately not a column. It is a fact about who is ASKING,
-- resolved per request at the service boundary; stored on the shared row it could only ever be true
-- for whoever wrote last.

CREATE TABLE scheduling.event_reschedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    event_id uuid NOT NULL REFERENCES scheduling.events (id) ON DELETE CASCADE,
    -- Which attempt this is, from zero. `resolved`, `lapsed` and `withdrawn` all end a round, and a
    -- fresh proposal opens the next one with an empty ballot rather than appending to a question
    -- nobody can answer any more — which is what stops a withdrawn round becoming a dead end.
    round integer NOT NULL DEFAULT 0 CHECK (round >= 0),
    -- A property of the event's head count (rescheduleModeFor), not a choice the opener makes: two
    -- people is settled by the other one agreeing, three or more goes to a vote.
    mode text NOT NULL,
    status text NOT NULL DEFAULT 'none',
    opened_by_user_id uuid REFERENCES org.users_public (user_id) ON DELETE SET NULL,
    opened_at timestamptz,
    -- Stamped server-side from voteResolvesAt — VOTE_RESOLUTION_LEAD_HOURS before the EARLIEST slot
    -- on the ballot — so SSR and the hydrated island read one deadline instead of each deriving it
    -- from a clock they separately own.
    resolves_at timestamptz,
    -- The slot that carried. No inline FK: scheduling.reschedule_proposals references this table
    -- back, so the pair is genuinely circular and the constraint belongs in a trailing
    -- 0000###_tables_fk_*.sql file (root CLAUDE.md §1). Flagged for the integrator.
    resolved_proposal_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_reschedule_round UNIQUE (event_id, round),
    CONSTRAINT ck_reschedule_mode CHECK (mode IN ('counterparty', 'vote')),
    CONSTRAINT ck_reschedule_status CHECK (
        status IN (
            'none',
            'collecting',
            'awaiting_counterparty',
            'voting',
            'resolved',
            'lapsed',
            'withdrawn'
        )
    ),
    -- `resolved` and `lapsed` are two endings, not one ending and its null case: the first means a
    -- time was chosen and names it, the second means the question closed with no majority and the
    -- original time stands. Enforcing the pairing in BOTH directions is what stops a surface
    -- rendering "moved to —" from a resolved row with no winner in it.
    CONSTRAINT ck_reschedule_resolved_names_winner CHECK (
        (status = 'resolved') = (resolved_proposal_id IS NOT NULL)
    ),
    -- `none` means no negotiation has been opened, so it is the one status with no opening instant —
    -- and every other status must have one, or a history line has nothing to date itself against.
    CONSTRAINT ck_reschedule_opened CHECK ((status = 'none') = (opened_at IS NULL)),
    -- A question that was pulled no longer has a deadline to have arrived. `resolved` and `lapsed`
    -- keep theirs: it is the instant the decision was taken, which "closed 3 hours ago" reads.
    CONSTRAINT ck_reschedule_withdrawn_undated CHECK (
        status <> 'withdrawn'
        OR resolves_at IS NULL
    )
);

CREATE TABLE scheduling.reschedule_proposals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    reschedule_id uuid NOT NULL REFERENCES scheduling.event_reschedules (id) ON DELETE CASCADE,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    proposed_by_user_id uuid REFERENCES org.users_public (user_id) ON DELETE SET NULL,
    proposed_by_role text NOT NULL,
    -- One instant, not proposed_at plus created_at: a proposal is written when it is made, so a
    -- second column could only ever restate the first.
    proposed_at timestamptz NOT NULL DEFAULT now(),
    -- Whether the slot is on the ballot. A host's own arrives approved — offering a time and then
    -- approving it would be theatre — while an attendee's waits, because the host's calendar is the
    -- scarce side of the arrangement and a client should not be able to put a time in front of a
    -- cohort that the person delivering the work cannot make.
    approved boolean NOT NULL DEFAULT false,
    note text CHECK (char_length(note) <= 280),
    -- Strict `>`, unlike ck_event_span's `>=`. That relaxation exists so a DEADLINE — a point in time
    -- with no duration — is storable; a slot offered as a replacement MEETING is not that, and a
    -- zero-length one could be voted onto the calendar as an unattendable instant.
    CONSTRAINT ck_proposal_span CHECK (ends_at > starts_at),
    CONSTRAINT ck_proposal_role CHECK (proposed_by_role IN ('host', 'attendee')),
    -- Removes the second way of saying the same thing: isProposalOnBallot already treats a host's
    -- slot as on the ballot regardless, so an unapproved host row is a state with no meaning that a
    -- reader of the raw table would have to know a TypeScript predicate in order to interpret.
    CONSTRAINT ck_proposal_host_preapproved CHECK (
        proposed_by_role <> 'host'
        OR approved
    ),
    -- The same slot listed twice on one ballot would split the vote for a single time and could deny
    -- it the majority it actually holds.
    CONSTRAINT uq_proposal_slot UNIQUE (reschedule_id, starts_at, ends_at),
    -- Target for proposal_votes' composite FK below. It exists so a vote's denormalised round can be
    -- PROVEN to be the round its proposal belongs to rather than merely asserted to be.
    CONSTRAINT uq_proposal_in_reschedule UNIQUE (id, reschedule_id)
);

CREATE TABLE scheduling.proposal_votes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    -- Denormalised from the proposal so one-vote-per-attendee can be enforced across the whole
    -- ROUND rather than per slot. The composite FK below makes the copy unfalsifiable.
    reschedule_id uuid NOT NULL REFERENCES scheduling.event_reschedules (id) ON DELETE CASCADE,
    proposal_id uuid NOT NULL,
    attendee_id uuid NOT NULL REFERENCES scheduling.event_attendees (id) ON DELETE CASCADE,
    -- No updated_at: a vote is immutable once cast (the duplicate_vote refusal), which is also what
    -- lets a round settle early once every eligible voter has spoken.
    cast_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT proposal_votes_proposal_fkey FOREIGN KEY (proposal_id, reschedule_id)
        REFERENCES scheduling.reschedule_proposals (id, reschedule_id) ON DELETE CASCADE,
    -- The rule is one vote per attendee per NEGOTIATION, not per slot. A majority is measured against
    -- everyone ENTITLED to vote (voteQuorum), so an attendee backing two slots would be counted twice
    -- in the tally and would also push votesCast past eligibleVoters, settling the round before the
    -- cohort had finished answering. Keying this on (proposal_id, attendee_id) would only stop the
    -- same person backing the same slot twice, which is not the rule.
    CONSTRAINT uq_one_vote_per_attendee_per_round UNIQUE (reschedule_id, attendee_id)
);

CREATE TABLE scheduling.event_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    event_id uuid NOT NULL REFERENCES scheduling.events (id) ON DELETE CASCADE,
    kind text NOT NULL,
    -- auth.users, not org.users_public, matching the scheduling.call_audit precedent: an audit line
    -- must outlive the profile row it names. NULL is also the honest actor for a system transition —
    -- a vote resolving on its own deadline was nobody's act.
    actor_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 200),
    detail text CHECK (char_length(detail) <= 400),
    -- A flat id (a proposal, an attendee), NOT a path. The ticket log's positional target_path
    -- addresses a submission TREE; an event has no tree, so a path here would be a shape this domain
    -- can never fill honestly.
    target_id text CHECK (char_length(target_id) <= 120),
    -- One instant, and no updated_at. The log is append-only — a correction is a new line, never an
    -- edit (root CLAUDE.md §5) — so there is no second event for a second column to record, and a
    -- backfilled line wants the moment it HAPPENED rather than the moment it was written down.
    occurred_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_event_history_kind CHECK (
        kind IN (
            'created',
            'edited',
            'rescheduled',
            'proposal',
            'vote',
            'rsvp',
            'attachment',
            'meeting_link',
            'cancelled'
        )
    )
);

-- EventHistoryEntrySchema.unread and .dateLabel are deliberately not columns. `unread` is a fact
-- about the VIEWER, not about the line, so on a shared row it could only ever describe whoever read
-- it last — the live path needs a per-viewer read marker, not a flag here. `dateLabel` is a
-- formatted string derived from occurred_at in the reader's own locale and timezone.

CREATE TABLE scheduling.event_attachments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    event_id uuid NOT NULL REFERENCES scheduling.events (id) ON DELETE CASCADE,
    -- A JOIN, not a copy. An agenda pack is the same asset the file hub, a submission and a channel
    -- attachment already address (one asset, one owner, many anchors), so anchoring it to an event
    -- must not fork a second row that can drift from the original's name or privacy scope. Mirrors
    -- projects.project_attachments and comms.message_attachments, neither of which can reference an
    -- event, which is why this is a sibling of those rather than a reuse.
    file_id uuid NOT NULL REFERENCES files.items (id) ON DELETE CASCADE,
    added_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_event_attachment UNIQUE (event_id, file_id)
);

CREATE TABLE scheduling.call_settings (
    schedule_id uuid PRIMARY KEY REFERENCES scheduling.schedules (id) ON DELETE CASCADE,
    accepts_calls boolean NOT NULL DEFAULT false,
    courtesy_enabled boolean NOT NULL DEFAULT false,
    courtesy_duration_minutes integer NOT NULL DEFAULT 15 CHECK (
        courtesy_duration_minutes BETWEEN 5 AND 240
    ),
    courtesy_max_per_week integer NOT NULL DEFAULT 0 CHECK (courtesy_max_per_week >= 0),
    courtesy_cooldown_days integer NOT NULL DEFAULT 0 CHECK (courtesy_cooldown_days >= 0),
    paid_enabled boolean NOT NULL DEFAULT false,
    paid_duration_minutes integer NOT NULL DEFAULT 30 CHECK (
        paid_duration_minutes BETWEEN 5 AND 480
    ),
    fee_amount_minor bigint CHECK (fee_amount_minor >= 0),
    fee_currency char(3),
    buffer_before_minutes integer NOT NULL DEFAULT 0 CHECK (
        buffer_before_minutes BETWEEN 0 AND 240
    ),
    buffer_after_minutes integer NOT NULL DEFAULT 10 CHECK (
        buffer_after_minutes BETWEEN 0 AND 240
    ),
    min_notice_minutes integer NOT NULL DEFAULT 720 CHECK (min_notice_minutes >= 0),
    max_advance_days integer NOT NULL DEFAULT 60 CHECK (max_advance_days BETWEEN 1 AND 365),
    auto_confirm boolean NOT NULL DEFAULT false,
    agenda_required boolean NOT NULL DEFAULT true,
    preferred_provider_slug text REFERENCES integrations.providers (slug) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_paid_call_priced CHECK (
        NOT paid_enabled
        OR (
            fee_amount_minor IS NOT NULL
            AND fee_amount_minor > 0
            AND fee_currency IS NOT NULL
        )
    )
);

CREATE TABLE scheduling.discovery_calls (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    host_schedule_id uuid NOT NULL REFERENCES scheduling.schedules (id) ON DELETE CASCADE,
    host_user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    requester_user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    call_type scheduling.call_type NOT NULL DEFAULT 'courtesy',
    status scheduling.call_status NOT NULL DEFAULT 'proposed',
    proposed_start timestamptz NOT NULL,
    proposed_end timestamptz NOT NULL,
    confirmed_start timestamptz,
    confirmed_end timestamptz,
    requester_timezone text,
    agenda text,
    provider_slug text REFERENCES integrations.providers (slug) ON DELETE SET NULL,
    connection_id uuid REFERENCES integrations.user_connections (id) ON DELETE SET NULL,
    meeting_url text,
    meeting_external_id text,
    event_id uuid REFERENCES scheduling.events (id) ON DELETE SET NULL,
    fee_amount_minor bigint CHECK (fee_amount_minor >= 0),
    fee_currency char(3),
    payment_ref text,
    escrow_id uuid REFERENCES finance.escrows (id) ON DELETE SET NULL,
    refund_amount_minor bigint CHECK (refund_amount_minor >= 0),
    penalty_amount_minor bigint CHECK (penalty_amount_minor >= 0),
    proposed_at timestamptz NOT NULL DEFAULT now(),
    responded_at timestamptz,
    confirmed_at timestamptz,
    cancelled_at timestamptz,
    cancelled_by scheduling.call_party,
    cancellation_reason text,
    is_late_cancel boolean NOT NULL DEFAULT false,
    completed_at timestamptz,
    no_show_party scheduling.call_party,
    reschedule_count integer NOT NULL DEFAULT 0 CHECK (reschedule_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_call_parties_distinct CHECK (host_user_id <> requester_user_id),
    CONSTRAINT ck_call_proposed_span CHECK (proposed_end > proposed_start),
    CONSTRAINT ck_call_confirmed_span CHECK (
        confirmed_end IS NULL
        OR confirmed_start IS NULL
        OR confirmed_end > confirmed_start
    ),
    CONSTRAINT ck_call_confirmed_has_slot CHECK (
        status <> 'confirmed'::scheduling.call_status
        OR (
            confirmed_start IS NOT NULL
            AND confirmed_end IS NOT NULL
        )
    ),
    CONSTRAINT ck_call_fee_matches_type CHECK (
        (
            call_type = 'paid'::scheduling.call_type
            AND fee_amount_minor IS NOT NULL
            AND fee_amount_minor > 0
            AND fee_currency IS NOT NULL
        )
        OR (
            call_type = 'courtesy'::scheduling.call_type
            AND COALESCE(fee_amount_minor, 0) = 0
        )
    )
);

CREATE TABLE scheduling.call_attendance (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    call_id uuid NOT NULL REFERENCES scheduling.discovery_calls (id) ON DELETE CASCADE,
    user_id uuid REFERENCES org.users_public (user_id) ON DELETE SET NULL,
    joined_at timestamptz NOT NULL DEFAULT now(),
    left_at timestamptz,
    source_provider_slug text REFERENCES integrations.providers (slug) ON DELETE SET NULL,
    external_participant_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_attendance_span CHECK (
        left_at IS NULL
        OR left_at >= joined_at
    )
);

CREATE TABLE scheduling.call_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    call_id uuid NOT NULL REFERENCES scheduling.discovery_calls (id) ON DELETE CASCADE,
    action scheduling.call_action NOT NULL,
    actor_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    from_status scheduling.call_status,
    to_status scheduling.call_status,
    slot_start timestamptz,
    slot_end timestamptz,
    detail text,
    created_at timestamptz NOT NULL DEFAULT now()
);
