-- ============================================================================
-- 00001001 functions security context
-- Consolidated verbatim from: 0004_security_tables.sql, 0099_helpers_functions.sql, 20260715120000_access_token_context_hook.sql
-- ============================================================================

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

CREATE OR REPLACE FUNCTION security.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM ops.admin_users au
    WHERE au.user_id = auth.uid()
  );
$$;

-- #endregion

-- #region 2. Context switches keep the four active slots mutually exclusive
-- Re-declare the profile switcher (migration 0100) with one added line: selecting a
-- freelancer/business profile clears any active organisation, so the slots never conflict.
CREATE OR REPLACE FUNCTION security.switch_session_context(
  p_type public.profile_type,
  p_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, security, org
AS $$
BEGIN
  IF p_type = 'freelancer' THEN
    IF NOT EXISTS (
      SELECT 1 FROM org.freelancer_profiles
      WHERE user_id = auth.uid() AND user_id = p_id
    ) THEN
      RAISE EXCEPTION 'Access Denied: You do not have a freelancer profile.';
    END IF;
  ELSIF p_type = 'business' THEN
    IF NOT EXISTS (
      SELECT 1 FROM org.business_members
      WHERE business_id = p_id
        AND user_id = auth.uid()
        AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'Access Denied: You are not an active member of this business.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid profile type';
  END IF;

  UPDATE security.session_context
  SET
    active_profile_type = p_type,
    active_profile_id = p_id,
    active_team_id = NULL,
    active_organisation_id = NULL,
    updated_at = NOW()
  WHERE user_id = auth.uid();

  INSERT INTO security.audit_logs (
    user_id, action, entity_table, entity_id, actor_profile_id
  ) VALUES (
    auth.uid(), 'session.switch_context', 'security.session_context', auth.uid(), p_id
  );
END;
$$;

-- New: switch the acting context to an organisation the caller belongs to (owner or active member).
-- Clears the profile/team slots so the four active slots stay mutually exclusive.
CREATE OR REPLACE FUNCTION security.switch_organisation_context(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, security, org
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM org.organisations o
    WHERE o.id = p_org_id AND o.owner_user_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM org.organisation_members m
    WHERE m.organisation_id = p_org_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Access Denied: You are not an active member of this organisation.';
  END IF;

  UPDATE security.session_context
  SET
    active_profile_type = NULL,
    active_profile_id = NULL,
    active_team_id = NULL,
    active_organisation_id = p_org_id,
    updated_at = NOW()
  WHERE user_id = auth.uid();

  INSERT INTO security.audit_logs (
    user_id, action, entity_table, entity_id, actor_profile_id
  ) VALUES (
    auth.uid(), 'session.switch_context', 'security.session_context', p_org_id, NULL
  );
END;
$$;

-- #endregion

-- #region 3. current_context() also exposes the active organisation (additive)
-- Extend the RLS helper (migration 0099) to surface the new claim alongside the existing three.
CREATE OR REPLACE FUNCTION security.current_context()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'user_id', auth.uid(),
    'active_profile_type',    auth.jwt()->>'active_profile_type',
    'active_profile_id',      auth.jwt()->>'active_profile_id',
    'active_team_id',         auth.jwt()->>'active_team_id',
    'active_organisation_id', auth.jwt()->>'active_organisation_id'
  );
$$;

-- #region 4. Route slugs — the minter and the immutability guard
--
-- Every public route on this platform addresses a row by an opaque, prefixed, immutable slug
-- (`prj-pkksys2xhd`, `stg-w4n8zqe6mt`). The format, and the reasoning behind each of its choices, is
-- stated once in `packages/types/slugs/slug.ts`; this is its Postgres twin. `slug.contract.test.ts`
-- reads THIS FILE and asserts the alphabet and the body length below are character-identical to the
-- TypeScript constants, because two implementations of one format is precisely the drift that stays
-- invisible until a row is minted through the wrong path and cannot be addressed.
--
-- They live in `security` rather than beside any one table because three schemas mint slugs
-- (`projects`, `marketplace`) and a copy per schema is a copy per schema to keep in step. EXECUTE is
-- revoked below, and `security` IS exposed to PostgREST, so an un-revoked function here is an RPC
-- anybody can call.
--
-- A TRIGGER DOES NOT RUN AS THE TABLE OWNER. Postgres checks EXECUTE on the trigger FUNCTION once, at
-- `CREATE TRIGGER` time, against the trigger's creator — but the body still executes as the INVOKING
-- role, so a call it makes to another function is privilege-checked at runtime against THAT role.
-- This file previously said otherwise, and the guard below was `SECURITY INVOKER` as a result: every
-- INSERT into a slugged table by `authenticated` OR `service_role` failed with
-- `permission denied for function mint_slug`, raised from inside a guard the caller never named.
-- The guard is `SECURITY DEFINER` for exactly that reason — see the note above it.

-- Mint one slug: `p_prefix`, a hyphen, and 10 symbols drawn uniformly from the 32-symbol alphabet.
--
-- `% 32` is uniform because 256 is a whole multiple of 32 — which is why the alphabet excludes exactly
-- four characters (`0`, `1`, `i`, `l`) and lands on 32 rather than 31. One member of each confusable
-- group is dropped, not the whole group: `o` is unambiguous precisely because `0` is gone. Dropping it
-- too would leave 31 symbols, which needs rejection sampling — and the modulo written without it is
-- silently biased toward the first symbols. A biased address still routes, so nothing would ever have
-- reported it.
--
-- VOLATILE, and it matters: `gen_random_bytes` is not stable, and a mislabelled IMMUTABLE/STABLE here
-- would let the planner evaluate this once and hand the same slug to every row of a multi-row insert.
CREATE OR REPLACE FUNCTION security.mint_slug(p_prefix text)
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
    SELECT p_prefix || '-' || string_agg(
        substr(
            '23456789abcdefghjkmnopqrstuvwxyz',
            (pg_catalog.get_byte(extensions.gen_random_bytes(1), 0) % 32) + 1,
            1
        ),
        ''
    )
    FROM pg_catalog.generate_series(1, 10);
$$;

COMMENT ON FUNCTION security.mint_slug(text) IS
'Mints one opaque route slug: the given prefix, a hyphen, and 10 symbols drawn uniformly from the 32-character confusable-free alphabet (50 bits). The Postgres twin of mintSlug() in @projective/types/slugs; the two alphabets are cross-checked by slug.contract.test.ts.';

-- Fill a slug that no insert supplied, and refuse one an update tries to move. `TG_ARGV[0]` is the
-- prefix, so one function serves every slugged table rather than four near-copies.
--
-- The INSERT half is why the columns can be NOT NULL with no DEFAULT: a BEFORE ROW trigger runs before
-- constraints are checked, so filling NULL here satisfies NOT NULL (verified by execution, not
-- assumed). A DEFAULT could not do this job — a DEFAULT expression may not contain a subquery, so
-- generating 10 symbols inline would mean four copies of a ten-line expression with four chances to
-- diverge, and column defaults are laid down in category 0, before any function exists to call.
--
-- The UPDATE half is the immutability guarantee, and it RAISES rather than silently pinning the old
-- value. An ordinary `UPDATE ... SET title = ...` never mentions the slug, so `NEW.slug` already
-- equals `OLD.slug` and nothing fires; the only way to reach the exception is to genuinely try to move
-- an address, which is a bug worth hearing about rather than absorbing. Silently reverting it would
-- let the caller believe the write landed.
--
-- SECURITY DEFINER, and it is load-bearing rather than defensive. A trigger function runs as the
-- INVOKING role, so as `authenticated` this called `security.mint_slug` — which is deliberately
-- revoked from PUBLIC — and every insert into a slugged table died on a function the caller never
-- named. Running as the owner breaks that cycle without handing any client role EXECUTE, which is
-- what keeps `mint_slug` off PostgREST: granting it instead would make `POST /rpc/mint_slug`
-- callable by anyone signed in, and by `anon` too, which is the surface the REVOKE below removes.
--
-- Definer is safe here because the body is closed. It touches no table, runs no dynamic SQL, and
-- takes exactly two inputs: `TG_ARGV[0]`, fixed at `CREATE TRIGGER` time and therefore settable only
-- by someone who already owns the table, and `NEW.slug`, which is compared and — when NULL —
-- overwritten. There is no value a caller can supply that reaches the owner's privileges.
CREATE OR REPLACE FUNCTION security.fn_slug_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.slug IS NULL THEN
            NEW.slug := security.mint_slug(TG_ARGV[0]);
        END IF;
    ELSIF NEW.slug IS DISTINCT FROM OLD.slug THEN
        RAISE EXCEPTION
            'A % slug is permanent and cannot be changed (% -> %).', TG_ARGV[0], OLD.slug, NEW.slug
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION security.fn_slug_guard() IS
'BEFORE INSERT OR UPDATE trigger for any table with a slug column. On insert, mints one when none was supplied (running before NOT NULL is checked); on update, refuses any change to an existing slug, which is what makes a slug a permanent address rather than a convention.';

-- Neither is callable over PostgREST. `security` is an exposed schema and CREATE FUNCTION grants
-- EXECUTE to PUBLIC by default, so without this a signed-out caller could mint slugs at will —
-- harmless in itself, but surface with no purpose.
--
-- These REVOKEs hold for every client role BECAUSE the guard above is `SECURITY DEFINER`: the only
-- caller that needs `mint_slug` reaches it as the owner. Do not answer a
-- `permission denied for function mint_slug` by granting EXECUTE here — that re-opens the RPC this
-- removes. The cause is a slug caller running as the invoker; make that caller a definer instead.
REVOKE ALL ON FUNCTION security.mint_slug(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION security.fn_slug_guard() FROM PUBLIC;

-- #endregion
