CREATE TABLE security.feature_flags (
  key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT feature_flags_pkey PRIMARY KEY (key)
);

CREATE TABLE security.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  action text NOT NULL,
  entity_table text NOT NULL,
  entity_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip inet,
  user_agent text,
  request_id uuid,
  actor_profile_id uuid,
  actor_team_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE TABLE security.turnstile_verifications (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    user_id uuid,
    ip inet NOT NULL,
    token_prefix text NOT NULL,
    success boolean NOT NULL,
    created_at timestamp
    with
        time zone NOT NULL DEFAULT now(),
        CONSTRAINT turnstile_verifications_pkey PRIMARY KEY (id),
        CONSTRAINT turnstile_verifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id)
);

CREATE TABLE security.refresh_tokens (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    revoked boolean NOT NULL DEFAULT false,
    created_at timestamp
    with
        time zone NOT NULL DEFAULT now(),
        replaced_by uuid,
        CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id),
        CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id),
        CONSTRAINT refresh_tokens_replaced_by_fkey FOREIGN KEY (replaced_by) REFERENCES security.refresh_tokens (id)
);

CREATE TABLE security.session_context (
    user_id uuid NOT NULL,
    active_profile_type public.profile_type,
    active_profile_id uuid,
    active_team_id uuid,
    updated_at timestamp
    with
        time zone NOT NULL DEFAULT now(),
        CONSTRAINT session_context_pkey PRIMARY KEY (user_id),
        CONSTRAINT session_context_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id),
        CONSTRAINT session_context_user_id_fkey1 FOREIGN KEY (user_id) REFERENCES org.users_public (user_id)
);

-- #region Platform parameters (tunable config; magnitudes intentionally left at safe defaults)
CREATE TABLE security.platform_params (
    key text PRIMARY KEY,
    value jsonb NOT NULL DEFAULT '{}'::jsonb,
    description text,
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

INSERT INTO security.platform_params (key, value, description) VALUES
    ('workload_report_window_hours', '48'::jsonb,
        'Hours a ticket stays hidden after a workload-intensity report before the client is penalized.'),
    ('claim_ttl_minutes', '1440'::jsonb,
        'Minutes a claimed ticket may sit idle before auto-release to the backlog.'),
    ('session_payout_hours', '24'::jsonb,
        'Negative-consent window (hours) after a session completes before payout auto-releases.'),
    ('platform_fee_bp', '0'::jsonb,
        'Platform service fee in basis points. UNRESOLVED: finance-model.md=5% vs investor-summary.md=10%; set deliberately.'),
    ('freelancer_bad_faith_penalty', '0'::jsonb,
        'Discovery-rank penalty severity applied to a freelancer whose report is audited bad-faith.'),
    ('client_no_adjust_penalty', '0'::jsonb,
        'Trust-score penalty severity applied to a client who fails to adjust workload intensity in time.')
ON CONFLICT (key) DO NOTHING;
-- #endregion

-- #region Penalties ledger (dedicated enforcement/reputation table; SSOT for discovery/trust caches)
CREATE TABLE security.penalties (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_type text NOT NULL CHECK (subject_type IN ('freelancer', 'business', 'user', 'team')),
    subject_id uuid NOT NULL,
    penalty_type text NOT NULL CHECK (penalty_type IN ('discovery_rank', 'trust_score', 'monetary_fee', 'suspension')),
    source_type text NOT NULL CHECK (source_type IN ('workload_report', 'dispute', 'no_show', 'pii_violation', 'manual')),
    source_id uuid,
    severity numeric(6,2) NOT NULL DEFAULT 0,
    amount_cents bigint,
    currency text,
    reason text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'reversed')),
    issued_by uuid REFERENCES auth.users (id),
    issued_at timestamp with time zone NOT NULL DEFAULT now(),
    expires_at timestamp with time zone,
    reversed_at timestamp with time zone
);

CREATE INDEX idx_penalties_subject ON security.penalties (subject_type, subject_id, status);

CREATE INDEX idx_penalties_source ON security.penalties (source_type, source_id);

-- Recompute active-penalty aggregates into the denormalized discovery/ranking caches
-- (mirrors the reviews.recalculate_entity_rating pattern so the recommender stays a single read).
CREATE OR REPLACE FUNCTION security.fn_recalc_penalty_aggregates()
RETURNS TRIGGER AS $$
DECLARE
    v_subject_type text;
    v_subject_id uuid;
    v_discovery numeric(6,2);
    v_trust numeric(6,2);
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_subject_type := OLD.subject_type;
        v_subject_id := OLD.subject_id;
    ELSE
        v_subject_type := NEW.subject_type;
        v_subject_id := NEW.subject_id;
    END IF;

    SELECT
        COALESCE(SUM(severity) FILTER (WHERE penalty_type = 'discovery_rank'), 0),
        COALESCE(SUM(severity) FILTER (WHERE penalty_type = 'trust_score'), 0)
    INTO v_discovery, v_trust
    FROM security.penalties
    WHERE subject_type = v_subject_type
        AND subject_id = v_subject_id
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > now());

    UPDATE search.profiles_index
    SET discovery_penalty = v_discovery
    WHERE entity_id = v_subject_id
        AND entity_type::text = v_subject_type;

    IF v_subject_type = 'business' THEN
        UPDATE org.business_profiles
        SET system_penalty_score = v_trust
        WHERE id = v_subject_id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, security, search, org;

CREATE TRIGGER trg_recalc_penalty_aggregates
AFTER INSERT OR UPDATE OR DELETE ON security.penalties
FOR EACH ROW EXECUTE FUNCTION security.fn_recalc_penalty_aggregates();
-- #endregion