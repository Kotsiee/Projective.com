-- =============================================================================================
-- 00001160_functions_files.sql — files schema functions (Category 1).
--
-- The `files` schema had ZERO functions before this file: no touch trigger, no read predicate, no
-- quota gate, no usage rollup. Its RLS therefore had to be expressed as raw predicates inline in
-- every policy — which is exactly how a read rule and a share route drift apart.
--
-- Placed AFTER the projects function files (00001100–00001150) because files.fn_can_read delegates
-- to projects.has_project_access, and BEFORE 00001200_functions_finance_core.sql. The CREATE
-- TRIGGERs that bind these live in 00001880_triggers_files.sql (a trigger needs its function first).
--
-- Every function pins `SET search_path = ''` and fully qualifies every identifier, so nothing here
-- can be hijacked by a caller's search_path. SECURITY DEFINER is used only where a function MUST
-- read a table the caller cannot (membership tables, the item row itself, the platform params).
-- =============================================================================================

-- #region 1. Touch — updated_at maintenance
-- The files schema's `updated_at` columns were previously only ever set by the application, so any
-- write that did not remember to set them left a stale timestamp. Bound to both tables in 00001880.
CREATE OR REPLACE FUNCTION files.fn_touch_updated_at ()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
-- #endregion

-- #region 2. files.fn_recompute_usage — the metered rollup
-- Recomputes one owner's stored-byte total from scratch and upserts files.storage_usage.
--
-- Recompute rather than increment DELIBERATELY: an incremental counter drifts silently the first
-- time a write path is missed, and a storage total that is quietly wrong is worse than one that is
-- momentarily expensive. It counts ONLY what we actually store — `source = 'supabase'`, not soft
-- deleted — because a mounted Drive file consumes the provider's quota and a link consumes none.
--
-- SECURITY DEFINER: it runs from an AFTER trigger and must see every row of the owner's library,
-- including rows the acting user cannot read.
CREATE OR REPLACE FUNCTION files.fn_recompute_usage (
    p_owner_type files.owner_kind,
    p_owner_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bytes bigint;
    v_count integer;
BEGIN
    IF p_owner_id IS NULL THEN
        RETURN;
    END IF;

    SELECT COALESCE(sum(i.size_bytes), 0), count(*)
    INTO v_bytes, v_count
    FROM files.items i
    WHERE i.owner_type = p_owner_type
      AND COALESCE(i.owner_entity_id, i.owner_user_id) = p_owner_id
      AND i.source = 'supabase'::files.file_source
      AND i.deleted_at IS NULL;

    INSERT INTO files.storage_usage (owner_type, owner_id, bytes_used, item_count, recomputed_at)
    VALUES (p_owner_type, p_owner_id, v_bytes, v_count, now())
    ON CONFLICT (owner_type, owner_id) DO UPDATE
        SET bytes_used = EXCLUDED.bytes_used,
            item_count = EXCLUDED.item_count,
            recomputed_at = EXCLUDED.recomputed_at;
END;
$$;
-- #endregion

-- #region 2b. files.fn_usage_trigger — the trigger adapter for fn_recompute_usage
-- A trigger function must be `RETURNS trigger` and take no declared parameters, while
-- fn_recompute_usage takes (owner_type, owner_id) — so a thin adapter is structurally required, not
-- a convenience. It recomputes BOTH sides of an ownership change: moving an asset from a personal
-- library into a team vault has to debit one rollup and credit the other, and a single-sided
-- recompute would leave the origin permanently overstated.
CREATE OR REPLACE FUNCTION files.fn_usage_trigger ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        PERFORM files.fn_recompute_usage (
            OLD.owner_type, COALESCE(OLD.owner_entity_id, OLD.owner_user_id)
        );
    END IF;

    IF TG_OP <> 'DELETE' THEN
        PERFORM files.fn_recompute_usage (
            NEW.owner_type, COALESCE(NEW.owner_entity_id, NEW.owner_user_id)
        );
    END IF;

    RETURN NULL;   -- AFTER trigger: the return value is ignored
END;
$$;
-- #endregion

-- #region 3. files.fn_can_read — THE read predicate
-- One function, called by the RLS SELECT policy on files.items AND by the share route, so a read
-- rule cannot be tightened in one place and left open in the other (the scheduling refusal-function
-- precedent, Decision #56 §(g)).
--
-- What grants a read:
--   * `public` visibility — world readable by design.
--   * Personal ownership — owner_type = 'user' and the caller is owner_user_id.
--   * Entity membership — an active member of the owning team / business / organisation.
--   * A project mount — the asset sits in the `project` bucket and the caller passes the existing
--     projects.has_project_access gate for the {project_id} path anchor.
--
-- What does NOT grant a read, deliberately:
--   * `link` visibility. The opaque SLUG is the credential, not the item id. If `link` returned
--     true here, any signed-in user could enumerate every link-shared asset on the platform with a
--     bare `SELECT * FROM files.items`. The share route resolves slug -> item through
--     files.fn_resolve_share (§4b), which takes the slug as INPUT and carries the
--     revoked/expired/exhausted predicate, and only then serves the bytes.
--
-- SECURITY DEFINER + STABLE: it reads the item row and the membership tables the caller cannot.
CREATE OR REPLACE FUNCTION files.fn_can_read (p_item_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_item files.items%ROWTYPE;
    v_uid uuid := auth.uid ();
    v_project_id uuid;
BEGIN
    SELECT * INTO v_item FROM files.items i WHERE i.id = p_item_id;

    IF NOT FOUND OR v_item.deleted_at IS NOT NULL THEN
        RETURN false;
    END IF;

    IF v_item.visibility = 'public'::files.file_visibility THEN
        RETURN true;
    END IF;

    -- Everything below requires an identity.
    IF v_uid IS NULL THEN
        RETURN false;
    END IF;

    IF v_item.owner_user_id = v_uid THEN
        RETURN true;
    END IF;

    IF v_item.owner_type = 'team'::files.owner_kind THEN
        RETURN org.is_active_team_member (v_item.owner_entity_id);
    ELSIF v_item.owner_type = 'business'::files.owner_kind THEN
        RETURN org.is_active_business_member (v_item.owner_entity_id);
    ELSIF v_item.owner_type = 'organisation'::files.owner_kind THEN
        RETURN org.is_organisation_member (v_item.owner_entity_id);
    END IF;

    -- Mounted engagement attachment: the `project` bucket anchors on {project_id}, the same anchor
    -- 00002017_policies_storage.sql gates storage.objects on. Reusing that one gate is why a hub
    -- read and a storage read can never disagree about who is on a project.
    IF v_item.bucket_id = 'project' THEN
        BEGIN
            v_project_id := (string_to_array (v_item.storage_path, '/')) [1]::uuid;
        EXCEPTION WHEN OTHERS THEN
            RETURN false;   -- an unparseable anchor is not an authorization
        END;
        RETURN projects.has_project_access (v_project_id);
    END IF;

    RETURN false;
END;
$$;
-- #endregion

-- #region 4. files.fn_check_storage_quota — the FAIL-OPEN gate
-- BEFORE INSERT / UPDATE OF size_bytes on files.items.
--
-- ⚠️ SHIPS FAIL-OPEN, exactly like `proposal_allowance_enforced` and `footprint_caps_enforced`
-- (Decision #58). While `security.platform_params.storage_quota_enforced` is false this function
-- RETURNS WITHOUT RAISING — it does not meter, warn or block. Flipping that param to true changes
-- user-visible behaviour on a live tenant (an upload starts failing) and is a deliberate human
-- decision, never a side effect of running a migration.
--
-- The quota is resolved through finance.fn_effective_limit, which is already generic over
-- finance.entitlement_key — so plan × standing × grant resolution, and the "NULL = unlimited"
-- convention, come for free and stay in one place.
--
-- UNITS: the entitlement is MEBIBYTES and the usage rollup is BYTES. The conversion happens HERE,
-- once, and nowhere else. `limit_value` is `integer`; 25 GB in bytes is 26,843,545,600, which
-- overflows int4 — so the ladder is never denominated in bytes anywhere in the system.
CREATE OR REPLACE FUNCTION files.fn_check_storage_quota ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_enforced boolean;
    v_owner_id uuid;
    v_subject_type text;
    v_limit_mib integer;
    v_used bigint;
    v_projected bigint;
BEGIN
    -- Only stored bytes count. A mounted connector file is metered by its provider and a link has
    -- no bytes, so neither can ever exhaust our quota.
    IF NEW.source <> 'supabase'::files.file_source OR NEW.deleted_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    SELECT (p.value #>> '{}')::boolean INTO v_enforced
    FROM security.platform_params p
    WHERE p.key = 'storage_quota_enforced';

    -- FAIL OPEN: absent param, malformed param, or an explicit false all mean "do not block".
    IF COALESCE(v_enforced, false) IS NOT TRUE THEN
        RETURN NEW;
    END IF;

    v_owner_id := COALESCE(NEW.owner_entity_id, NEW.owner_user_id);
    v_subject_type := CASE NEW.owner_type
        WHEN 'user' THEN 'user'
        WHEN 'team' THEN 'team'
        WHEN 'business' THEN 'business'
        WHEN 'organisation' THEN 'organisation'
    END;

    v_limit_mib := finance.fn_effective_limit (
        v_subject_type, v_owner_id, 'storage_megabytes'::finance.entitlement_key
    );

    -- NULL = UNLIMITED (the fn_effective_limit convention). 0 = the plan does not grant storage at
    -- all, which is a real refusal and is allowed to fall through to the comparison below.
    IF v_limit_mib IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT u.bytes_used INTO v_used
    FROM files.storage_usage u
    WHERE u.owner_type = NEW.owner_type AND u.owner_id = v_owner_id;
    v_used := COALESCE(v_used, 0);

    -- On UPDATE only the DELTA is new capacity; on INSERT the whole file is.
    IF TG_OP = 'UPDATE' THEN
        v_projected := v_used + (NEW.size_bytes - COALESCE(OLD.size_bytes, 0));
    ELSE
        v_projected := v_used + NEW.size_bytes;
    END IF;

    IF v_projected > (v_limit_mib::bigint * 1048576) THEN
        RAISE EXCEPTION
            'Storage quota exceeded: % MiB used of % MiB allowed.',
            (v_projected / 1048576), v_limit_mib
            USING ERRCODE = 'check_violation',
                  HINT = 'Free space or upgrade the plan holding this storage_megabytes entitlement.';
    END IF;

    RETURN NEW;
END;
$$;
-- #endregion

-- #region 4b. files.fn_resolve_share — the ONLY way in from a slug
-- Resolves a share slug to its target, or returns nothing.
--
-- ⚠️ THIS EXISTS INSTEAD OF AN `anon SELECT` POLICY ON files.share_links, and the reason is not
-- stylistic. RLS filters ROWS; it cannot require that the caller already knew the slug. A policy of
-- `USING (revoked_at IS NULL AND ...)` plus an anon table grant would let any visitor run
-- `SELECT slug FROM files.share_links` and harvest every live share credential on the platform.
-- The slug IS the credential, so it must be an INPUT, never an output of an unfiltered read.
--
-- Same discipline as integrations.connection_secrets: the table keeps RLS on with no visitor
-- policy and no visitor grant, and the one sanctioned operation is exposed as a definer function.
-- The revoked / expired / exhausted predicate lives HERE, in one place, so a route that forgets to
-- check cannot resurrect a revoked link.
--
-- Returns READ metadata only — never the bytes, never a signed URL. Minting a download URL stays a
-- server decision so the download can be counted and audited (files.download_events).
CREATE OR REPLACE FUNCTION files.fn_resolve_share (p_slug text)
RETURNS TABLE (
    share_id uuid,
    item_id uuid,
    folder_id uuid,
    visibility files.file_visibility,
    expires_at timestamptz,
    downloads_remaining integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        s.id,
        s.item_id,
        s.folder_id,
        s.visibility,
        s.expires_at,
        CASE WHEN s.download_limit IS NULL
             THEN NULL::integer
             ELSE GREATEST(s.download_limit - s.download_count, 0)
        END
    FROM files.share_links s
    WHERE s.slug = p_slug
      AND s.revoked_at IS NULL
      AND (s.expires_at IS NULL OR s.expires_at > now())
      AND (s.download_limit IS NULL OR s.download_count < s.download_limit)
      -- A share of a soft-deleted asset resolves to nothing: the link outliving its target would
      -- otherwise present as a broken download rather than an honest 404.
      AND (
          s.item_id IS NULL
          OR EXISTS (
              SELECT 1 FROM files.items i
              WHERE i.id = s.item_id AND i.deleted_at IS NULL
          )
      );
$$;
-- #endregion

-- #region 5. files.fn_mint_share_slug — the opaque share token
-- Server-minted, >= 128 bits of entropy, URL-safe. The slug IS the credential for a `link`-
-- visibility asset, so it is never derived from the item id, the filename or a counter — anything
-- guessable would make revocation meaningless.
--
-- ⚠️ DEVIATION (flagged, deliberate): the brief specified `gen_random_bytes(16)`, which lives in
-- pgcrypto. pgcrypto's home schema is NOT stable across environments — a from-scratch
-- `CREATE EXTENSION pgcrypto` puts it in `public`, hosted Supabase puts it in `extensions` — so no
-- single qualified reference works under `SET search_path = ''`, and relaxing the search_path to
-- guess at both would weaken every other function in this file by example. `gen_random_uuid()` is a
-- pg_catalog builtin backed by the same CSPRNG; two of them yield 244 bits of entropy, of which 24
-- bytes (192 bits) are taken. Strictly MORE entropy than the brief asked for, and portable.
CREATE OR REPLACE FUNCTION files.fn_mint_share_slug ()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
    v_raw bytea;
BEGIN
    v_raw := pg_catalog.decode (
        pg_catalog.replace (pg_catalog.gen_random_uuid ()::text, '-', '')
        || pg_catalog.replace (pg_catalog.gen_random_uuid ()::text, '-', ''),
        'hex'
    );

    -- base64 -> base64url: '+/' become '-_', the '=' padding is dropped, and any wrap newline
    -- encode() may insert is stripped (it wraps at 76 chars; 24 bytes is 32, but never rely on it).
    RETURN pg_catalog.rtrim (
        pg_catalog.translate (
            pg_catalog.replace (
                pg_catalog.encode (pg_catalog.substring (v_raw, 1, 24), 'base64'),
                E'\n', ''
            ),
            '+/', '-_'
        ),
        '='
    );
END;
$$;
-- #endregion
