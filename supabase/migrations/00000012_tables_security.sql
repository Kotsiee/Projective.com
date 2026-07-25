-- =============================================================================================
-- 00000012_tables_security.sql — security schema tables (Category 0). Source: 0004_security_tables.sql.
-- Folded ALTER:
--   * security.session_context += active_organisation_id (FK org.organisations) (20260715120000)
-- =============================================================================================

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
        -- Folded (20260715120000): the active organisation (buyer-only) context slot.
        active_organisation_id uuid REFERENCES org.organisations (id) ON DELETE SET NULL,
        CONSTRAINT session_context_pkey PRIMARY KEY (user_id),
        CONSTRAINT session_context_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id),
        CONSTRAINT session_context_user_id_fkey1 FOREIGN KEY (user_id) REFERENCES org.users_public (user_id)
);

CREATE TABLE security.platform_params (
    key text PRIMARY KEY,
    value jsonb NOT NULL DEFAULT '{}'::jsonb,
    description text,
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

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
