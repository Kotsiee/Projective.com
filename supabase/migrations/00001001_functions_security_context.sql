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

-- #region Derived-column guard
-- A rating, a review count, a view or order counter is DERIVED: a definer trigger or function
-- computes it from rows the owner does not control (`reviews.recalculate_entity_rating` for the
-- ratings). The owner's own-row UPDATE policy still reaches those columns, so without this a seller
-- could PATCH their listing to `rating_average = 5, rating_count = 900` through the API and every
-- card, ranking and search score would repeat it.
--
-- The guard refuses a CLIENT write to any column named in the trigger's arguments. "Client" is the
-- role executing the statement: PostgREST runs a request as `anon` or `authenticated`, while a
-- `SECURITY DEFINER` function runs its statements as its owner and the service role as
-- `service_role` — so the rating trigger, the seed and server-side jobs pass untouched, and nothing
-- that legitimately maintains these columns needs to know the guard exists. This is why the function
-- is deliberately NOT `SECURITY DEFINER`: as a definer it would read its own owner as the caller
-- and wave every client write through.
--
-- UPDATE: the column may not change. INSERT: the column may only start EMPTY — zero for a counter,
-- an average or a balance, false for a flag, null for a server-stamped time — because a new row
-- claiming 900 reviews, a pot holding £10,000 or an item "purchased" yesterday is the same forgery
-- arriving by the other door. A write that restates the current value (PostgREST PATCHing a whole
-- row back) passes, because nothing moved.
--
-- Raises `42501` (insufficient_privilege): the write is refused for who is making it, not for what
-- it contains.
CREATE OR REPLACE FUNCTION security.fn_guard_derived_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_col text;
    v_new jsonb;
    v_old jsonb;
BEGIN
    IF current_user NOT IN ('anon', 'authenticated') THEN
        RETURN NEW;
    END IF;

    v_new := to_jsonb(NEW);
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;

    FOREACH v_col IN ARRAY TG_ARGV LOOP
        IF TG_OP = 'UPDATE' THEN
            IF v_new -> v_col IS DISTINCT FROM v_old -> v_col THEN
                RAISE EXCEPTION '%.% is derived and cannot be written directly', TG_TABLE_NAME, v_col
                    USING ERRCODE = '42501';
            END IF;
        -- On INSERT a derived column must start EMPTY: null, zero or false. Judged by the JSON type
        -- rather than by casting, so a derived timestamp (`purchased_at`) is refused with this message
        -- instead of failing a numeric cast.
        ELSIF jsonb_typeof(v_new -> v_col) = 'number' THEN
            IF (v_new ->> v_col)::numeric <> 0 THEN
                RAISE EXCEPTION '%.% is derived and must start at zero', TG_TABLE_NAME, v_col
                    USING ERRCODE = '42501';
            END IF;
        ELSIF jsonb_typeof(v_new -> v_col) = 'boolean' THEN
            IF (v_new ->> v_col)::boolean THEN
                RAISE EXCEPTION '%.% is derived and must start false', TG_TABLE_NAME, v_col
                    USING ERRCODE = '42501';
            END IF;
        ELSIF COALESCE(jsonb_typeof(v_new -> v_col), 'null') <> 'null' THEN
            RAISE EXCEPTION '%.% is derived and must start empty', TG_TABLE_NAME, v_col
                USING ERRCODE = '42501';
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION security.fn_guard_derived_columns() IS
'BEFORE INSERT OR UPDATE trigger: refuses an anon/authenticated write to the derived columns named in its arguments (ratings, counts, balances, server-stamped times). An INSERT may only start them empty — null, zero or false; an UPDATE may not change them. Definer functions, the service role and the seed pass.';

REVOKE ALL ON FUNCTION security.fn_guard_derived_columns() FROM PUBLIC;

-- The same idea for IDENTITY columns: who a row is between, and what it is about. A policy's
-- `WITH CHECK` sees only the post-image, so "either party may update this" cannot also say "but not
-- the parties themselves" — a host could rewrite `requester_user_id` and drop a request into a
-- stranger's inbox as though they had sent it. This refuses a client UPDATE that changes any named
-- column, of any type; inserts are the policy's job and pass untouched.
CREATE OR REPLACE FUNCTION security.fn_guard_immutable_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_col text;
    v_new jsonb;
    v_old jsonb;
BEGIN
    IF TG_OP <> 'UPDATE' OR current_user NOT IN ('anon', 'authenticated') THEN
        RETURN NEW;
    END IF;

    v_new := to_jsonb(NEW);
    v_old := to_jsonb(OLD);
    FOREACH v_col IN ARRAY TG_ARGV LOOP
        IF v_new -> v_col IS DISTINCT FROM v_old -> v_col THEN
            RAISE EXCEPTION '%.% cannot be changed once written', TG_TABLE_NAME, v_col
                USING ERRCODE = '42501';
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION security.fn_guard_immutable_columns() IS
'BEFORE UPDATE trigger: refuses an anon/authenticated UPDATE that changes any column named in its arguments (the parties and subject of a row). Definer functions and the service role pass.';

REVOKE ALL ON FUNCTION security.fn_guard_immutable_columns() FROM PUBLIC;
-- #endregion
