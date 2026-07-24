-- =============================================================================================
-- 20260724103000_scheduling_discovery_calls.sql
-- Availability & Discovery Calls foundation (4/5) — per-owner call settings, the discovery-call
-- booking record, the Digital Handshake attendance log, and the transition audit trail.
--
-- ADDITIVE ONLY. New enums/tables/policies in the `scheduling` schema. No existing object is
-- altered. Authored, NOT applied to any live database.
--
-- THE CENTRAL DISTINCTION (PRODUCT_SPEC.md §Discovery & Courtesy Calls):
--   A discovery call is a TOP-OF-FUNNEL CONVERSION TOOL, not a deliverable. It therefore does NOT
--   enter the §3.1 delivery state-machine, does NOT create a project/stage/ticket, and does NOT
--   count toward Workload Intensity. Two flavours:
--     * `courtesy` (free) — the common case. A pure "Calendar Handshake": request → confirm →
--       auto-generated meeting link. NO payment, NO escrow, NO KYC gate. Deliberately frictionless.
--     * `paid` — a chargeable consultation. Priced by the provider (PRODUCT_SPEC.md §Why Sessions
--       are Fixed: session pricing is provider-set, never negotiated) and settled through the
--       Session money path.
--
-- ⚠️ FLAGGED — paid calls cannot ride `finance.escrows` as it stands (root CLAUDE.md §8). That table
-- requires BOTH `project_stage_id` and `payer_business_id` NOT NULL, so a paid 1-1 call between an
-- individual client and a freelancer has no legal escrow row. Relaxing either column is a change to
-- a PROTECTED table (root CLAUDE.md §1) and is NOT done here. `escrow_id` below is nullable and is
-- populated only when a call is genuinely attached to an existing funded stage. The two candidate
-- resolutions — (a) make those two columns nullable, or (b) auto-provision a session-format
-- micro-project so an escrow row is legal — both need human sign-off before either is implemented.
-- Until then a paid call records its own `payment_ref` / fee columns and the money path is deferred.
--
-- ⚠️ FLAGGED — cancellation economics. `finance-model.md` §4 says a late session cancel forfeits
-- 50%; `PRODUCT_SPEC.md` §Sessions says full forfeit; the hierarchy makes PRODUCT_SPEC win and that
-- conflict is already logged. This schema deliberately does NOT hard-code either: it stores
-- `refund_amount_minor` + `penalty_amount_minor` as recorded OUTCOMES so whichever rule a human
-- ratifies is expressible without a migration. The COURTESY rules are new and are defined
-- deliberately rather than inherited: a free call has no money, so a late cancel or a no-show
-- carries NO financial consequence — it is recorded as a reliability signal only. Whether that
-- signal feeds `security.penalties` / discovery rank is FLAGGED for human sign-off.
-- =============================================================================================

-- #region 1. Vocabulary
DO $$ BEGIN
    CREATE TYPE scheduling.call_type AS ENUM ('courtesy', 'paid');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- The discovery-call lifecycle (PRODUCT_MANAGEMENT.md §3.5 — a DOMAIN lifecycle, never a build
-- board column):
--   proposed → confirmed → completed
--   proposed → declined      (host says no)
--   proposed → expired       (nobody answered before the slot passed)
--   confirmed → cancelled    (either party; `cancelled_by` + `is_late_cancel` record which/when)
--   confirmed → no_show      (the slot passed with a party absent; `no_show_party` records who)
-- A reschedule is NOT a state: it returns the row to `proposed`, increments `reschedule_count`, and
-- appends an audit line. Nothing is hard-deleted (root CLAUDE.md §5).
DO $$ BEGIN
    CREATE TYPE scheduling.call_status AS ENUM (
        'proposed', 'confirmed', 'declined', 'cancelled', 'completed', 'no_show', 'expired'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE scheduling.call_party AS ENUM ('host', 'requester', 'both');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE scheduling.call_action AS ENUM (
        'requested', 'confirmed', 'declined', 'rescheduled', 'cancelled',
        'completed', 'marked_no_show', 'expired', 'link_generated', 'reminder_sent'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;
-- #endregion

-- #region 2. scheduling.call_settings — the provider's booking configuration
-- One row per schedule. This is the surface a freelancer configures under Settings; the booking
-- gate in migration 5/5 reads it. Fees are `(amount_minor, currency)` pairs exactly like every
-- `finance` amount — no floats, no forked money model (root CLAUDE.md §1).
CREATE TABLE IF NOT EXISTS scheduling.call_settings (
    schedule_id uuid PRIMARY KEY REFERENCES scheduling.schedules (id) ON DELETE CASCADE,
    -- Master switch. When false the "Book a call" affordance never renders and every booking
    -- attempt is refused regardless of the flags below.
    accepts_calls boolean NOT NULL DEFAULT false,
    -- Free courtesy calls.
    courtesy_enabled boolean NOT NULL DEFAULT false,
    courtesy_duration_minutes integer NOT NULL DEFAULT 15 CHECK (
        courtesy_duration_minutes BETWEEN 5 AND 240
    ),
    -- Anti-abuse: a cap on free calls the owner will host per rolling week, and a per-requester
    -- cooldown so one person cannot re-book a free call indefinitely. 0 = unlimited.
    courtesy_max_per_week integer NOT NULL DEFAULT 0 CHECK (courtesy_max_per_week >= 0),
    courtesy_cooldown_days integer NOT NULL DEFAULT 0 CHECK (courtesy_cooldown_days >= 0),
    -- Paid consultations.
    paid_enabled boolean NOT NULL DEFAULT false,
    paid_duration_minutes integer NOT NULL DEFAULT 30 CHECK (
        paid_duration_minutes BETWEEN 5 AND 480
    ),
    fee_amount_minor bigint CHECK (fee_amount_minor >= 0),
    fee_currency char(3),
    -- Burnout guard: dead time the booking gate reserves either side of every call so back-to-back
    -- bookings cannot be stacked.
    buffer_before_minutes integer NOT NULL DEFAULT 0 CHECK (
        buffer_before_minutes BETWEEN 0 AND 240
    ),
    buffer_after_minutes integer NOT NULL DEFAULT 10 CHECK (
        buffer_after_minutes BETWEEN 0 AND 240
    ),
    -- How close to the slot a request may still be made, and how far ahead the grid opens.
    min_notice_minutes integer NOT NULL DEFAULT 720 CHECK (min_notice_minutes >= 0),
    max_advance_days integer NOT NULL DEFAULT 60 CHECK (max_advance_days BETWEEN 1 AND 365),
    -- When true a request inside a call window is auto-`confirmed` instead of waiting on the host.
    auto_confirm boolean NOT NULL DEFAULT false,
    -- Force the requester to state a purpose (the anti-tyre-kicker field).
    agenda_required boolean NOT NULL DEFAULT true,
    -- Which connected provider should mint the room. NULL falls back to
    -- `integrations.fn_conferencing_provider(host)` and then to a manually-entered link.
    preferred_provider_slug text REFERENCES integrations.providers (slug) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- A paid call must be priced. Enforced in-DB so a mispriced settings row cannot exist.
    CONSTRAINT ck_paid_call_priced CHECK (
        NOT paid_enabled
        OR (
            fee_amount_minor IS NOT NULL
            AND fee_amount_minor > 0
            AND fee_currency IS NOT NULL
        )
    )
);

CREATE OR REPLACE TRIGGER trg_call_settings_touch
    BEFORE UPDATE ON scheduling.call_settings
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_touch_updated_at ();
-- #endregion

-- #region 3. scheduling.discovery_calls — the booking record
CREATE TABLE IF NOT EXISTS scheduling.discovery_calls (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    host_schedule_id uuid NOT NULL REFERENCES scheduling.schedules (id) ON DELETE CASCADE,
    -- Denormalised so party checks never need to resolve the schedule first.
    host_user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    requester_user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    call_type scheduling.call_type NOT NULL DEFAULT 'courtesy',
    status scheduling.call_status NOT NULL DEFAULT 'proposed',
    -- The slot as first asked for, kept even after a reschedule so the trail is legible.
    proposed_start timestamptz NOT NULL,
    proposed_end timestamptz NOT NULL,
    -- The agreed slot. NULL until `confirmed`.
    confirmed_start timestamptz,
    confirmed_end timestamptz,
    -- IANA zone the REQUESTER was viewing in — the host's zone lives on the schedule.
    requester_timezone text,
    -- Why the requester wants the call (`call_settings.agenda_required` gates emptiness at the app
    -- layer; a free-text purpose is not a schema constraint).
    agenda text,
    -- #region Conferencing (the generated room)
    provider_slug text REFERENCES integrations.providers (slug) ON DELETE SET NULL,
    connection_id uuid REFERENCES integrations.user_connections (id) ON DELETE SET NULL,
    meeting_url text,
    meeting_external_id text,
    -- #endregion
    -- The calendar mirror, so the call renders on both parties' grids.
    event_id uuid REFERENCES scheduling.events (id) ON DELETE SET NULL,
    -- #region Money (paid calls only — see the FLAGGED note in this file's header)
    fee_amount_minor bigint CHECK (fee_amount_minor >= 0),
    fee_currency char(3),
    -- Stripe PaymentIntent / provider reference. Opaque, no PII (PRODUCT_SPEC.md §Data Privacy).
    payment_ref text,
    -- Populated ONLY when the call is attached to an already-funded stage; NULL otherwise, because
    -- `finance.escrows` cannot currently represent a standalone 1-1 call (header note).
    escrow_id uuid REFERENCES finance.escrows (id) ON DELETE SET NULL,
    -- Recorded OUTCOMES, not a hard-coded policy: whichever cancellation rule a human ratifies is
    -- expressible here without another migration.
    refund_amount_minor bigint CHECK (refund_amount_minor >= 0),
    penalty_amount_minor bigint CHECK (penalty_amount_minor >= 0),
    -- #endregion
    -- #region Lifecycle stamps
    proposed_at timestamptz NOT NULL DEFAULT now(),
    responded_at timestamptz,
    confirmed_at timestamptz,
    cancelled_at timestamptz,
    cancelled_by scheduling.call_party,
    cancellation_reason text,
    -- True when the cancel landed inside the platform cancellation window
    -- (`security.platform_params.discovery_call_cancellation_window_hours`, migration 5/5).
    is_late_cancel boolean NOT NULL DEFAULT false,
    completed_at timestamptz,
    no_show_party scheduling.call_party,
    reschedule_count integer NOT NULL DEFAULT 0 CHECK (reschedule_count >= 0),
    -- #endregion
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_call_parties_distinct CHECK (host_user_id <> requester_user_id),
    CONSTRAINT ck_call_proposed_span CHECK (proposed_end > proposed_start),
    CONSTRAINT ck_call_confirmed_span CHECK (
        confirmed_end IS NULL
        OR confirmed_start IS NULL
        OR confirmed_end > confirmed_start
    ),
    -- A confirmed call must have an agreed slot.
    CONSTRAINT ck_call_confirmed_has_slot CHECK (
        status <> 'confirmed'::scheduling.call_status
        OR (
            confirmed_start IS NOT NULL
            AND confirmed_end IS NOT NULL
        )
    ),
    -- A paid call must carry its price; a courtesy call must NOT (free means free).
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

CREATE INDEX IF NOT EXISTS idx_discovery_calls_host ON scheduling.discovery_calls (host_user_id, status, confirmed_start);

CREATE INDEX IF NOT EXISTS idx_discovery_calls_requester ON scheduling.discovery_calls (
    requester_user_id,
    status,
    confirmed_start
);

CREATE INDEX IF NOT EXISTS idx_discovery_calls_schedule_window ON scheduling.discovery_calls (
    host_schedule_id,
    confirmed_start,
    confirmed_end
);

CREATE OR REPLACE TRIGGER trg_discovery_calls_touch
    BEFORE UPDATE ON scheduling.discovery_calls
    FOR EACH ROW EXECUTE FUNCTION scheduling.fn_touch_updated_at ();
-- #endregion

-- #region 4. scheduling.call_attendance — the "Digital Handshake" presence log
-- Fed by server-to-server conferencing webhooks (SYSTEM_ARCHITECTURE.md §Conferencing: Zoom's
-- `participant_joined` and its equivalents). This is the evidence that a call actually happened —
-- the same role `projects.session_attendance` plays for a delivered Session Service.
CREATE TABLE IF NOT EXISTS scheduling.call_attendance (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    call_id uuid NOT NULL REFERENCES scheduling.discovery_calls (id) ON DELETE CASCADE,
    -- NULL when the provider reported a participant the platform cannot map to an account.
    user_id uuid REFERENCES org.users_public (user_id) ON DELETE SET NULL,
    joined_at timestamptz NOT NULL DEFAULT now(),
    left_at timestamptz,
    -- Which provider webhook asserted this (`google` / `zoom` / …), and its participant id.
    source_provider_slug text REFERENCES integrations.providers (slug) ON DELETE SET NULL,
    external_participant_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_attendance_span CHECK (
        left_at IS NULL
        OR left_at >= joined_at
    )
);

CREATE INDEX IF NOT EXISTS idx_call_attendance_call ON scheduling.call_attendance (call_id, joined_at);
-- #endregion

-- #region 5. scheduling.call_audit — the transition trail
-- Every status change, reschedule, link generation and reminder. Append-only in practice; this is
-- where a reschedule lives (reschedules are not a status).
CREATE TABLE IF NOT EXISTS scheduling.call_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    call_id uuid NOT NULL REFERENCES scheduling.discovery_calls (id) ON DELETE CASCADE,
    action scheduling.call_action NOT NULL,
    actor_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    from_status scheduling.call_status,
    to_status scheduling.call_status,
    -- The slot as of this line, so a reschedule chain is reconstructable.
    slot_start timestamptz,
    slot_end timestamptz,
    detail text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_audit_call ON scheduling.call_audit (call_id, created_at);
-- #endregion

-- #region 6. Party predicate
-- Is the caller one of the two people on this call? Used by every policy below. SECURITY DEFINER so
-- it reads `discovery_calls` without recursing into that table's own policy.
CREATE OR REPLACE FUNCTION scheduling.fn_is_call_party(p_call uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = scheduling, security, public
AS $$
    SELECT COALESCE((
        SELECT security.is_admin ()
            OR c.host_user_id = auth.uid ()
            OR c.requester_user_id = auth.uid ()
        FROM scheduling.discovery_calls c
        WHERE c.id = p_call
    ), false);
$$;

GRANT
EXECUTE ON FUNCTION scheduling.fn_is_call_party (uuid) TO authenticated;
-- #endregion

-- #region 7. RLS
ALTER TABLE scheduling.call_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE scheduling.discovery_calls ENABLE ROW LEVEL SECURITY;

ALTER TABLE scheduling.call_attendance ENABLE ROW LEVEL SECURITY;

ALTER TABLE scheduling.call_audit ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE scheduling.call_settings TO anon,
authenticated;

GRANT
INSERT,
UPDATE,
DELETE ON TABLE scheduling.call_settings TO authenticated;

GRANT SELECT,
INSERT,
UPDATE ON TABLE scheduling.discovery_calls TO authenticated;

GRANT SELECT ON TABLE scheduling.call_attendance TO authenticated;

GRANT SELECT ON TABLE scheduling.call_audit TO authenticated;

GRANT ALL ON TABLE scheduling.call_settings TO service_role;

GRANT ALL ON TABLE scheduling.discovery_calls TO service_role;

GRANT ALL ON TABLE scheduling.call_attendance TO service_role;

GRANT ALL ON TABLE scheduling.call_audit TO service_role;

-- Settings are readable by anyone who can see the published schedule — a visitor must know whether
-- calls are offered, how long they run, and what a paid one costs BEFORE signing in.
DROP POLICY IF EXISTS "View call settings" ON scheduling.call_settings;

CREATE POLICY "View call settings" ON scheduling.call_settings FOR
SELECT TO anon,
authenticated USING (
        scheduling.fn_schedule_is_public (schedule_id)
        OR scheduling.fn_can_view_schedule (schedule_id)
    );

DROP POLICY IF EXISTS "Manage call settings" ON scheduling.call_settings;

CREATE POLICY "Manage call settings" ON scheduling.call_settings FOR ALL TO authenticated USING (
    scheduling.fn_can_manage_schedule (schedule_id)
)
WITH
    CHECK (
        scheduling.fn_can_manage_schedule (schedule_id)
    );

-- A call is private to its two parties (plus admins). There is deliberately no `anon` read.
DROP POLICY IF EXISTS "View own discovery calls" ON scheduling.discovery_calls;

CREATE POLICY "View own discovery calls" ON scheduling.discovery_calls FOR
SELECT TO authenticated USING (
        host_user_id = auth.uid ()
        OR requester_user_id = auth.uid ()
        OR security.is_admin ()
    );

-- A signed-in user may REQUEST a call as themselves. Every other constraint (call windows, notice,
-- buffers, cooldowns, whether calls are offered at all) is enforced by the BEFORE INSERT trigger
-- `scheduling.fn_enforce_call_request` in migration 5/5 — a policy cannot express that much logic,
-- and putting it in a trigger means a hand-rolled PostgREST insert cannot bypass the booking gate
-- either.
DROP POLICY IF EXISTS "Request a discovery call" ON scheduling.discovery_calls;

CREATE POLICY "Request a discovery call" ON scheduling.discovery_calls FOR INSERT TO authenticated
WITH
    CHECK (
        requester_user_id = auth.uid ()
        AND status = 'proposed'::scheduling.call_status
    );

-- Both parties may transition a call they are on (confirm / decline / cancel / reschedule). The
-- legal-transition matrix itself is enforced by the trigger in migration 5/5, not by this policy.
DROP POLICY IF EXISTS "Update own discovery calls" ON scheduling.discovery_calls;

CREATE POLICY "Update own discovery calls" ON scheduling.discovery_calls FOR
UPDATE TO authenticated USING (
    host_user_id = auth.uid ()
    OR requester_user_id = auth.uid ()
    OR security.is_admin ()
)
WITH
    CHECK (
        host_user_id = auth.uid ()
        OR requester_user_id = auth.uid ()
        OR security.is_admin ()
    );

-- Attendance and the audit trail are readable by the parties; both are written exclusively by
-- webhooks / definer functions running as service-role, so no write policy is opened.
DROP POLICY IF EXISTS "View call attendance" ON scheduling.call_attendance;

CREATE POLICY "View call attendance" ON scheduling.call_attendance FOR
SELECT TO authenticated USING (
        scheduling.fn_is_call_party (call_id)
    );

DROP POLICY IF EXISTS "View call audit" ON scheduling.call_audit;

CREATE POLICY "View call audit" ON scheduling.call_audit FOR
SELECT TO authenticated USING (
        scheduling.fn_is_call_party (call_id)
    );
-- #endregion
