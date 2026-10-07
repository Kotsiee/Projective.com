-- =============================================================================================
-- 00001050_functions_org_emails.sql — a person's email addresses and the token handshake that proves
-- they own one (Category 1: functions). Zod SSOT: packages/types/org/user-emails.ts.
--
-- `org.user_emails.verified_at` is load-bearing: a verified address unlocks the project and workspace
-- invitations sent to it (projects.project_invitations SELECT, org.fn_is_invitee,
-- projects.invite_by_email). Until 2026-10-06 the table carried own-row INSERT/UPDATE/DELETE policies
-- and `org` is exposed to PostgREST, so any signed-in caller could file someone else's address with
-- `verified_at` already set — or stamp it on a row they had — and read every invitation sent to it.
-- The table is now READ-ONLY to a client (00002010 / 00002520), and these definers are the only
-- writers besides provisioning (public.provision_user_profile) and the GoTrue mirror
-- (public.handle_email_confirmed):
--
--   org.add_user_email            files an UNVERIFIED, non-primary address
--   security.issue_email_verification  (service role only) mints a single-use token, stores ONLY its
--                                 SHA-256, and returns the raw value for the mailer
--   org.confirm_user_email        the signed-in owner redeems the token; the one path that stamps
--                                 `verified_at` on a secondary address
--   org.set_primary_email         moves the contact address to a VERIFIED row
--   org.remove_user_email         drops a secondary address (never the primary or the sign-in one)
--   org.get_my_emails             the caller's addresses, primary first
--
-- Refusals are raised as the exception MESSAGE with SQLSTATE `P0001`, and the message is exactly one
-- of the `EmailRefusal` codes, so the service maps a code to a sentence without parsing prose. Two
-- conditions are not refusals of the request and carry their own SQLSTATE instead: no signed-in
-- subject (`28000`, 'not_authenticated') and an account with no profile yet (`42501`,
-- 'profile_required' — an OAuth sign-up that has not finished onboarding has no org.users_public row
-- for an address to hang from).
--
-- Every function is SECURITY DEFINER with `search_path = ''` and fully-qualified names (pgcrypto
-- lives in `extensions`). The per-person writes take an advisory transaction lock on the person, so
-- two concurrent adds cannot both pass the five-address limit and two primary switches cannot race
-- the one-primary index into a unique violation.
-- =============================================================================================

-- #region 1. Read

-- The caller's addresses, primary first. `is_sign_in` marks the address GoTrue signs this account in
-- with — it cannot be removed from the settings console, and it is NOT the same fact as "primary".
CREATE OR REPLACE FUNCTION org.get_my_emails()
RETURNS TABLE (
    id uuid,
    email text,
    is_primary boolean,
    verified_at timestamptz,
    is_sign_in boolean,
    created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT e.id,
           e.email,
           e.is_primary,
           e.verified_at,
           COALESCE(lower(e.email) = lower(u.email), false) AS is_sign_in,
           e.created_at
    FROM org.user_emails e
    LEFT JOIN auth.users u ON u.id = e.user_id
    WHERE e.user_id = auth.uid()
    ORDER BY e.is_primary DESC, e.created_at, e.id;
$$;

COMMENT ON FUNCTION org.get_my_emails() IS
'The calling user''s addresses (primary first, then oldest first) with is_sign_in = the GoTrue sign-in address. Empty for a caller with no subject.';
-- #endregion

-- #region 2. Writes (the signed-in owner)

-- File a new address for the caller: trimmed and lower-cased, loosely shape-checked (the only real
-- validation of an address is the mail that has to arrive at it), unique per person, at most five per
-- person — and always UNVERIFIED and secondary.
--
-- Deliberately NOT refused when another account already holds the address verified: saying so here
-- would turn this door into a lookup of who is registered under which address. That refusal
-- (`email_in_use`) happens at confirm time, when the caller has already proved they hold the inbox.
CREATE OR REPLACE FUNCTION org.add_user_email(p_email text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_email text := lower(btrim(COALESCE(p_email, '')));
    v_id uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
    END IF;

    IF length(v_email) > 254
       OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
        RAISE EXCEPTION 'email_invalid' USING ERRCODE = 'P0001';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM org.users_public up WHERE up.user_id = v_uid) THEN
        RAISE EXCEPTION 'profile_required' USING ERRCODE = '42501';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('user-emails:' || v_uid::text));

    IF EXISTS (
        SELECT 1 FROM org.user_emails e WHERE e.user_id = v_uid AND lower(e.email) = v_email
    ) THEN
        RAISE EXCEPTION 'email_exists' USING ERRCODE = 'P0001';
    END IF;

    -- Mirrors MAX_USER_EMAILS in packages/types/org/user-emails.ts.
    IF (SELECT count(*) FROM org.user_emails e WHERE e.user_id = v_uid) >= 5 THEN
        RAISE EXCEPTION 'email_limit' USING ERRCODE = 'P0001';
    END IF;

    BEGIN
        INSERT INTO org.user_emails (user_id, email, is_primary, verified_at)
        VALUES (v_uid, v_email, false, NULL)
        RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        -- uq_user_emails_user_email: a row the check above could not see yet.
        RAISE EXCEPTION 'email_exists' USING ERRCODE = 'P0001';
    END;

    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, 'user.email_added', 'org.user_emails', v_id, '{}'::jsonb);

    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION org.add_user_email(text) IS
'Files an UNVERIFIED secondary address for the caller. Refuses email_invalid / email_exists / email_limit (5). Verification is security.issue_email_verification + org.confirm_user_email.';

-- Drop one of the caller's secondary addresses. "Not yours" and "does not exist" are one answer, so
-- the door cannot be used to probe other people's row ids. The primary must be replaced first, and
-- the sign-in address belongs to GoTrue, not to this console. Its tokens go with it (ON DELETE CASCADE).
CREATE OR REPLACE FUNCTION org.remove_user_email(p_email_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_row org.user_emails%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('user-emails:' || v_uid::text));

    SELECT * INTO v_row
    FROM org.user_emails e
    WHERE e.id = p_email_id AND e.user_id = v_uid
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'email_not_found' USING ERRCODE = 'P0001';
    END IF;

    IF v_row.is_primary THEN
        RAISE EXCEPTION 'email_is_primary' USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
        SELECT 1 FROM auth.users u WHERE u.id = v_uid AND lower(u.email) = lower(v_row.email)
    ) THEN
        RAISE EXCEPTION 'email_is_sign_in' USING ERRCODE = 'P0001';
    END IF;

    DELETE FROM org.user_emails e WHERE e.id = v_row.id;

    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, 'user.email_removed', 'org.user_emails', v_row.id,
            jsonb_build_object('was_verified', v_row.verified_at IS NOT NULL));
END;
$$;

COMMENT ON FUNCTION org.remove_user_email(uuid) IS
'Removes one of the caller''s secondary addresses. Refuses email_not_found (also for another person''s row), email_is_primary, email_is_sign_in.';

-- Make a VERIFIED address the caller's primary (the contact address the platform writes to). The old
-- primary is cleared BEFORE the new one is set: uq_user_emails_one_primary is a partial unique index,
-- which is never deferrable. Choosing the current primary again is a no-op, not a refusal.
CREATE OR REPLACE FUNCTION org.set_primary_email(p_email_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_row org.user_emails%ROWTYPE;
    v_previous uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('user-emails:' || v_uid::text));

    SELECT * INTO v_row
    FROM org.user_emails e
    WHERE e.id = p_email_id AND e.user_id = v_uid
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'email_not_found' USING ERRCODE = 'P0001';
    END IF;

    IF v_row.verified_at IS NULL THEN
        RAISE EXCEPTION 'email_unverified' USING ERRCODE = 'P0001';
    END IF;

    IF v_row.is_primary THEN
        RETURN;
    END IF;

    UPDATE org.user_emails e
       SET is_primary = false
     WHERE e.user_id = v_uid AND e.is_primary AND e.id <> v_row.id
    RETURNING e.id INTO v_previous;

    UPDATE org.user_emails e SET is_primary = true WHERE e.id = v_row.id;

    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (v_uid, 'user.email_primary_changed', 'org.user_emails', v_row.id,
            jsonb_build_object('previous_email_id', v_previous));
END;
$$;

COMMENT ON FUNCTION org.set_primary_email(uuid) IS
'Makes one of the caller''s VERIFIED addresses primary, clearing the old primary first. Refuses email_not_found, email_unverified.';

-- Redeem a verification token. The token is hashed (SHA-256, hex) and looked up; the raw value is
-- never stored, so a database read cannot be turned into a working link. Checked in this order:
-- token_invalid (no such token) → token_used → token_expired → token_wrong_account (it was issued
-- for another signed-in account) → email_in_use (another account already holds this address
-- VERIFIED — said only now, to someone who has proved they hold the inbox). On success the address is
-- stamped verified (only if it was not already) and every outstanding token for it is consumed.
-- A refusal consumes nothing: the exception rolls the call back whole.
CREATE OR REPLACE FUNCTION org.confirm_user_email(p_token text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_token text := lower(btrim(COALESCE(p_token, '')));
    v_tok org.email_verification_tokens%ROWTYPE;
    v_row org.user_emails%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
    END IF;

    -- A token is 32 random bytes as hex; anything else cannot be one, so it is not even hashed.
    IF v_token !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'token_invalid' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_tok
    FROM org.email_verification_tokens t
    WHERE t.token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'token_invalid' USING ERRCODE = 'P0001';
    END IF;

    IF v_tok.consumed_at IS NOT NULL THEN
        RAISE EXCEPTION 'token_used' USING ERRCODE = 'P0001';
    END IF;

    IF v_tok.expires_at <= now() THEN
        RAISE EXCEPTION 'token_expired' USING ERRCODE = 'P0001';
    END IF;

    IF v_tok.user_id <> v_uid THEN
        RAISE EXCEPTION 'token_wrong_account' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_row
    FROM org.user_emails e
    WHERE e.id = v_tok.email_id AND e.user_id = v_uid
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'token_invalid' USING ERRCODE = 'P0001';
    END IF;

    IF v_row.verified_at IS NULL THEN
        -- Serialise on the ADDRESS, so two accounts redeeming tokens for the same address at the same
        -- moment cannot both pass the check below.
        PERFORM pg_advisory_xact_lock(hashtext('user-email-address:' || lower(v_row.email)));

        IF EXISTS (
            SELECT 1 FROM org.user_emails o
            WHERE lower(o.email) = lower(v_row.email)
              AND o.user_id <> v_uid
              AND o.verified_at IS NOT NULL
        ) THEN
            RAISE EXCEPTION 'email_in_use' USING ERRCODE = 'P0001';
        END IF;

        UPDATE org.user_emails e
           SET verified_at = now()
         WHERE e.id = v_row.id AND e.verified_at IS NULL;

        INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
        VALUES (v_uid, 'user.email_verified', 'org.user_emails', v_row.id, '{}'::jsonb);
    END IF;

    UPDATE org.email_verification_tokens t
       SET consumed_at = now()
     WHERE t.email_id = v_row.id AND t.consumed_at IS NULL;

    RETURN v_row.id;
END;
$$;

COMMENT ON FUNCTION org.confirm_user_email(text) IS
'Redeems a verification token for the signed-in owner: stamps verified_at, consumes the address''s tokens, returns the address id. Refuses token_invalid / token_used / token_expired / token_wrong_account / email_in_use.';
-- #endregion

-- #region 3. Issue (service role only)

-- Mint a verification token for one address and return the RAW token, once, for the mailer. Only its
-- SHA-256 (hex) is stored; it is valid for 24 hours (EMAIL_TOKEN_TTL_HOURS); issuing expires every
-- earlier outstanding token for the address, so only the newest link works.
--
-- Lives in `security`, not `org`, because the service role holds USAGE on `security` and not on
-- `org`; EXECUTE is the service role's alone (00002510). It takes NO user id on purpose: the app
-- decodes session JWTs without verifying them, so a service-role call must never trust a
-- caller-supplied identity. It does not need to — the token is mailed to the row's OWN address and
-- redeemable only by the row's OWN account, so issuing one for someone else's row gains the issuer
-- nothing. The service establishes ownership first anyway (the id comes from the caller's own
-- org.add_user_email, or is checked against org.get_my_emails).
--
-- Returns NULL, issuing nothing, when the address is already verified (there is nothing to prove).
-- An unknown id raises `email_not_found`.
CREATE OR REPLACE FUNCTION security.issue_email_verification(p_email_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row org.user_emails%ROWTYPE;
    v_token text;
BEGIN
    SELECT * INTO v_row FROM org.user_emails e WHERE e.id = p_email_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'email_not_found' USING ERRCODE = 'P0001';
    END IF;

    IF v_row.verified_at IS NOT NULL THEN
        RETURN NULL;
    END IF;

    UPDATE org.email_verification_tokens t
       SET expires_at = now()
     WHERE t.email_id = v_row.id AND t.consumed_at IS NULL AND t.expires_at > now();

    v_token := encode(extensions.gen_random_bytes(32), 'hex');

    INSERT INTO org.email_verification_tokens (email_id, user_id, token_hash, expires_at)
    VALUES (
        v_row.id,
        v_row.user_id,
        encode(extensions.digest(v_token, 'sha256'), 'hex'),
        now() + interval '24 hours'
    );

    RETURN v_token;
END;
$$;

COMMENT ON FUNCTION security.issue_email_verification(uuid) IS
'SERVICE ROLE ONLY. Mints a 24-hour single-use verification token for an unverified org.user_emails row, stores only its SHA-256, expires earlier tokens, returns the raw token (NULL when the address is already verified). Raises email_not_found.';
-- #endregion

-- #region 4. Guard trigger function (trigger: 00001815)

-- Defence in depth under the grants: refuses an anon/authenticated INSERT that arrives verified or
-- primary, and an anon/authenticated UPDATE that changes `verified_at`, `email`, `is_primary` or
-- `user_id`. INVOKER on purpose — inside a SECURITY DEFINER function `current_user` is the function's
-- owner, so the definers above, provisioning, the GoTrue mirror, the service role and the seed all
-- pass, and only a client role's own statement is judged. Raises `42501`: the write is refused for
-- who is making it.
CREATE OR REPLACE FUNCTION org.trg_user_emails_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF current_user NOT IN ('anon', 'authenticated') THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.verified_at IS NOT NULL OR NEW.is_primary THEN
            RAISE EXCEPTION 'org.user_emails: an address is added unverified and secondary; only the verification handshake changes that'
                USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.verified_at IS DISTINCT FROM OLD.verified_at
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.is_primary IS DISTINCT FROM OLD.is_primary
       OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        RAISE EXCEPTION 'org.user_emails: verified_at, email, is_primary and user_id are written by the email functions only'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION org.trg_user_emails_guard() IS
'BEFORE INSERT OR UPDATE on org.user_emails: refuses an anon/authenticated write that sets verified_at/is_primary on insert or changes verified_at/email/is_primary/user_id on update. Definers, the service role and the seed pass.';
-- #endregion
