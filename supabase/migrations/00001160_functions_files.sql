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
-- An upload still in flight (`pending_upload`, `scanning`) COUNTS at its declared size: that is a
-- reservation, and fn_check_storage_quota depends on it — it charges a promotion only the DELTA
-- between declared and measured size, so parallel declarations must each see the others. A refused
-- or failed upload (`quarantined`, `error`) holds no bytes and releases its reservation; counting
-- it would let a rejected file eat the allowance forever.
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
      AND i.status NOT IN ('quarantined'::files.file_status, 'error'::files.file_status)
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
    -- no bytes, so neither can ever exhaust our quota — and neither can a refused or failed upload,
    -- which fn_recompute_usage has already released. The gate and the rollup must agree on this set.
    IF NEW.source <> 'supabase'::files.file_source OR NEW.deleted_at IS NOT NULL
       OR NEW.status IN ('quarantined'::files.file_status, 'error'::files.file_status) THEN
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

    -- On UPDATE only the DELTA is new capacity, because the old size is already in the rollup; on
    -- INSERT the whole file is — and so it is for a row the rollup had released.
    IF TG_OP = 'UPDATE'
       AND OLD.status NOT IN ('quarantined'::files.file_status, 'error'::files.file_status) THEN
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

-- #region 6. files.fn_public_media_ref — one stored image, as a public reference with its tiers
-- The projection every public surface reads an image through: where the original lives, what is
-- known about it before it loads (dimensions, BlurHash, average colour) and the WebP tiers the
-- media pipeline wrote beside it (files.item_variants). NULL for anything that is not PUBLIC, not
-- live, not stored by us, or not yet through the pipeline — so a caller renders the honest absence
-- (an initials avatar, no slide) rather than a URL a visitor cannot load.
--
-- Storage REFS, never URLs: the URL is a deployment fact (the public storage host) and is built
-- once, in packages/backend/core/storage-url.ts.
--
-- SECURITY DEFINER because the caller may be anonymous and the item row is not theirs to read; the
-- visibility test above is what makes that safe — nothing it returns is not already world-readable.
CREATE OR REPLACE FUNCTION files.fn_public_media_ref (p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_item files.items%ROWTYPE;
    v_media jsonb;
BEGIN
    IF p_item_id IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_item FROM files.items i WHERE i.id = p_item_id;
    IF NOT FOUND
       OR v_item.deleted_at IS NOT NULL
       OR v_item.visibility <> 'public'::files.file_visibility
       OR v_item.source <> 'supabase'::files.file_source
       OR v_item.status <> 'uploaded'::files.file_status THEN
        RETURN NULL;
    END IF;

    v_media := v_item.metadata -> 'media';
    RETURN jsonb_build_object(
        'id', v_item.id,
        'bucket', v_item.bucket_id,
        'path', v_item.storage_path,
        'mime', v_item.mime_type,
        'purpose', v_item.purpose,
        -- Numbers are read defensively: metadata is a client-extracted document on older rows, and
        -- one malformed value must cost that field, not the whole profile read.
        'width', CASE WHEN (v_media ->> 'width') ~ '^[0-9]{1,6}$' THEN (v_media ->> 'width')::integer END,
        'height', CASE WHEN (v_media ->> 'height') ~ '^[0-9]{1,6}$' THEN (v_media ->> 'height')::integer END,
        'duration_ms', CASE WHEN (v_media ->> 'durationMs') ~ '^[0-9]{1,10}$' THEN (v_media ->> 'durationMs')::bigint END,
        'blurhash', v_media ->> 'blurhash',
        'color', v_media -> 'colors' ->> 'average',
        'variants', COALESCE((
            SELECT jsonb_object_agg(
                v.tier::text,
                jsonb_build_object(
                    'bucket', v.bucket_id,
                    'path', v.storage_path,
                    'width', v.width,
                    'height', v.height,
                    'mime', v.mime_type
                )
            )
            FROM files.item_variants v
            WHERE v.item_id = v_item.id
        ), '{}'::jsonb)
    );
END;
$$;

-- The batch door onto fn_public_media_ref, for readers that hold file ids rather than a profile
-- (a roster, a message list). Capped at 500 ids per call; ids that resolve to nothing public come
-- back with a NULL ref so a caller can tell "asked and absent" from "never asked".
CREATE OR REPLACE FUNCTION files.get_public_media (p_ids uuid[])
RETURNS TABLE (id uuid, ref jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN QUERY
    SELECT x.item_id, files.fn_public_media_ref (x.item_id)
    FROM (
        SELECT DISTINCT u.item_id
        FROM unnest(p_ids[1:500]) AS u (item_id)
        WHERE u.item_id IS NOT NULL
    ) x;
END;
$$;
-- #endregion

-- #region 7. files.fn_guard_pipeline_columns — only the server may claim "processed"
-- BEFORE INSERT OR UPDATE on files.items.
--
-- The row-level policies let an owner write their own rows, and a row-level policy cannot tell a
-- rename from a forgery: without this, an owner could INSERT a row that says `status = 'uploaded'`,
-- `bucket_id = 'avatars'`, `purpose = 'avatar'` for an object that never went through the quarantine
-- scan, and every reader that trusts "uploaded" would serve it. So the columns that describe the
-- BYTES and their processing belong to the server: the upload pipeline (service role) and the
-- definer functions (whose current_user is their owner) pass; the two roles PostgREST runs a
-- client's request as do not.
--
-- What a client may still do, deliberately: DECLARE an upload (a `pending_upload` row in
-- `quarantine`), attach a link (no bytes), and edit the presentational columns the hub edits — the
-- name, folder, visibility, star, archive flag and soft-delete stamp.
CREATE OR REPLACE FUNCTION files.fn_guard_pipeline_columns ()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF current_user NOT IN ('authenticated', 'anon') THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.purpose <> 'library'::files.asset_purpose OR NEW.derived_from_id IS NOT NULL THEN
            RAISE EXCEPTION USING
                ERRCODE = '42501',
                MESSAGE = 'files: renditions are written by the media pipeline only';
        END IF;
        IF NEW.source = 'supabase'::files.file_source
           AND (NEW.status <> 'pending_upload'::files.file_status OR NEW.bucket_id <> 'quarantine') THEN
            RAISE EXCEPTION USING
                ERRCODE = '42501',
                MESSAGE = 'files: an upload starts pending in quarantine; only the upload pipeline promotes it';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.bucket_id IS DISTINCT FROM OLD.bucket_id
       OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
       OR NEW.target_bucket IS DISTINCT FROM OLD.target_bucket
       OR NEW.target_path IS DISTINCT FROM OLD.target_path
       OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
       OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
       OR NEW.metadata IS DISTINCT FROM OLD.metadata
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
       OR NEW.hash_algo IS DISTINCT FROM OLD.hash_algo
       OR NEW.source IS DISTINCT FROM OLD.source
       OR NEW.purpose IS DISTINCT FROM OLD.purpose
       OR NEW.derived_from_id IS DISTINCT FROM OLD.derived_from_id THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'files: an asset''s bytes and processing state are written by the upload pipeline only';
    END IF;
    RETURN NEW;
END;
$$;
-- #endregion

-- #region 8. files.fn_owns_library — may the caller file things into this library?
-- The WRITE-side twin of fn_can_read's ownership arms, for the items/folders INSERT and UPDATE
-- policies. Those policies long checked only `owner_user_id = auth.uid()` — who CREATED the row — and
-- never whether the creator belonged to the library they filed it into, so any signed-in user could
-- plant a link ("Invoice.pdf" → anywhere) or a folder into another team's library and every member of
-- that team would see it as their own team's file. Verified by execution before this was written.
--
-- A personal row names no entity; an entity row needs ACTIVE membership of the entity it names. The
-- membership helpers are definer functions the policies already call, so this stays INVOKER.
CREATE OR REPLACE FUNCTION files.fn_owns_library (
    p_owner_type files.owner_kind,
    p_owner_entity_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT CASE p_owner_type
        WHEN 'user'::files.owner_kind THEN p_owner_entity_id IS NULL
        WHEN 'team'::files.owner_kind THEN
            p_owner_entity_id IS NOT NULL AND org.is_active_team_member (p_owner_entity_id)
        WHEN 'business'::files.owner_kind THEN
            p_owner_entity_id IS NOT NULL AND org.is_active_business_member (p_owner_entity_id)
        WHEN 'organisation'::files.owner_kind THEN
            p_owner_entity_id IS NOT NULL AND org.is_organisation_member (p_owner_entity_id)
        ELSE false
    END;
$$;
-- #endregion

-- #region 9. files.get_storage_quota — one principal's allowance, for the principal only
-- Everything the storage meter shows, in one round trip: the effective limit (plan × standing ×
-- grants, through finance.fn_effective_limit — so the ladder lives in one place), the bytes the
-- usage rollup measured, the plan it came from, whether a grant raised it, and whether the cap is
-- enforced at all.
--
-- A definer because the resolver and the plan tables are not the caller's to read — and therefore it
-- authorises first: the caller must BE the user, or an active member of the entity, whose allowance
-- they ask for. An allowance is a fact about someone's subscription and not public.
--
-- `limit_mib` NULL means unlimited (the fn_effective_limit convention). Refusals: 42501.
CREATE OR REPLACE FUNCTION files.get_storage_quota (
    p_owner_type files.owner_kind,
    p_owner_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid ();
    v_subject text := p_owner_type::text;
    v_plan uuid;
    v_code text;
    v_limit integer;
    v_used bigint;
    v_count integer;
    v_grant boolean;
    v_enforced boolean;
BEGIN
    IF v_uid IS NULL OR p_owner_id IS NULL THEN
        RAISE EXCEPTION 'Sign in to read a storage allowance' USING ERRCODE = '42501';
    END IF;
    IF NOT (
        (p_owner_type = 'user'::files.owner_kind AND p_owner_id = v_uid)
        OR (p_owner_type = 'team'::files.owner_kind AND org.is_active_team_member (p_owner_id))
        OR (p_owner_type = 'business'::files.owner_kind AND org.is_active_business_member (p_owner_id))
        OR (p_owner_type = 'organisation'::files.owner_kind AND org.is_organisation_member (p_owner_id))
    ) THEN
        RAISE EXCEPTION 'That allowance isn''t yours to read' USING ERRCODE = '42501';
    END IF;

    v_plan := finance.fn_active_plan (v_subject, p_owner_id);
    SELECT p.code INTO v_code FROM finance.plans p WHERE p.id = v_plan;
    v_limit := finance.fn_effective_limit (v_subject, p_owner_id, 'storage_megabytes'::finance.entitlement_key);

    SELECT EXISTS (
        SELECT 1 FROM finance.entitlement_grants g
        WHERE g.subject_type = v_subject
          AND g.subject_id = p_owner_id
          AND g.entitlement_key = 'storage_megabytes'::finance.entitlement_key
          AND g.starts_at <= now ()
          AND (g.expires_at IS NULL OR g.expires_at > now ())
    ) INTO v_grant;

    SELECT u.bytes_used, u.item_count INTO v_used, v_count
    FROM files.storage_usage u
    WHERE u.owner_type = p_owner_type AND u.owner_id = p_owner_id;

    SELECT (p.value #>> '{}')::boolean INTO v_enforced
    FROM security.platform_params p
    WHERE p.key = 'storage_quota_enforced';

    RETURN jsonb_build_object(
        'limit_mib', v_limit,
        'used_bytes', COALESCE(v_used, 0),
        'item_count', COALESCE(v_count, 0),
        'plan_code', v_code,
        'from_grant', COALESCE(v_grant, false),
        'enforced', COALESCE(v_enforced, false)
    );
END;
$$;
-- #endregion

-- #region 10. files.fn_record_download — the download ledger's only writer
-- Appends one download and bumps the counters it moves, in ONE transaction. For a share download the
-- link's own count is bumped FIRST and only while the link is still live and under its limit — a
-- single guarded UPDATE, so a link with one download left cannot serve two to concurrent requests —
-- and the link must actually reach the file (the file itself, or a folder the file sits in).
--
-- Service role only: the server calls this after it has decided the caller may read the file, and
-- `p_actor` is the identity the SESSION evidenced. "This was downloaded" is a server observation, never
-- a claim a browser makes (the table carries no client INSERT policy for the same reason).
--
-- Only a SETTLED file (`status = 'uploaded'`; a link is written so too) can be downloaded: a pending,
-- refused or failed upload has no bytes, and recording a download of one would write a false ledger
-- line and spend a share link's allowance on nothing.
-- Refusals: PS404 the link is not live or does not reach the file · PB404 no such file.
CREATE OR REPLACE FUNCTION files.fn_record_download (
    p_item_id uuid,
    p_actor uuid,
    p_device text,
    p_via files.download_via,
    p_share_slug text
)
RETURNS files.download_events
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_event files.download_events;
    v_target uuid;
    v_folder uuid;
BEGIN
    -- Checked before the share's count moves, so a refusal here never costs the link a download.
    IF NOT EXISTS (
        SELECT 1 FROM files.items i
        WHERE i.id = p_item_id AND i.deleted_at IS NULL AND i.status = 'uploaded'::files.file_status
    ) THEN
        RAISE EXCEPTION 'No such file' USING ERRCODE = 'PB404';
    END IF;

    IF p_share_slug IS NOT NULL THEN
        UPDATE files.share_links s
           SET download_count = s.download_count + 1
         WHERE s.slug = p_share_slug
           AND s.revoked_at IS NULL
           AND (s.expires_at IS NULL OR s.expires_at > now ())
           AND (s.download_limit IS NULL OR s.download_count < s.download_limit)
        RETURNING s.item_id, s.folder_id INTO v_target, v_folder;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'That link is no longer available' USING ERRCODE = 'PS404';
        END IF;
        IF NOT (
            v_target = p_item_id
            OR (v_folder IS NOT NULL AND EXISTS (
                SELECT 1 FROM files.items i
                WHERE i.id = p_item_id AND i.folder_id = v_folder AND i.deleted_at IS NULL
            ))
        ) THEN
            RAISE EXCEPTION 'That link does not reach this file' USING ERRCODE = 'PS404';
        END IF;
    END IF;

    UPDATE files.items i
       SET download_count = i.download_count + 1
     WHERE i.id = p_item_id AND i.deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No such file' USING ERRCODE = 'PB404';
    END IF;

    INSERT INTO files.download_events (item_id, actor_user_id, device_fingerprint, via, share_slug)
    VALUES (p_item_id, p_actor, NULLIF (p_device, ''), p_via, p_share_slug)
    RETURNING * INTO v_event;
    RETURN v_event;
END;
$$;
-- #endregion
