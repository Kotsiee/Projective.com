-- =============================================================================================
-- 00001655_functions_ops_contact.sql — /contact's intake (Category 1, Decision #276).
-- `ops.contact_requests` + `ops.contact_request_attachments` (00000013) hold what /contact files.
-- One public door writes them: `ops.submit_contact_request`, SECURITY DEFINER, callable by `anon`
-- and `authenticated` (00002510) — it stamps auth.uid(), re-checks every field a direct PostgREST
-- call could forge, holds the durable rate ceilings, links only the caller's own scanned
-- attachments and tells every operator. Operators move a request along the unified machine through
-- `ops.set_contact_request_status`; `ops.fn_guard_contact_request` (trigger, 00001897) is the
-- authority on which moves are legal and keeps everything else about a request immutable. An
-- attachment that is never sent does not linger: Remove takes it back through
-- `ops.discard_contact_attachment`, and the hourly sweep claims the rest through
-- `ops.fn_claim_stale_contact_attachments` (the app deletes their bytes — storage objects cannot be
-- deleted from SQL).
-- Grants in 00002510; Zod SSOT @projective/types/contact (CONTACT_PAYLOAD_KEYS, CONTACT_DB_CEILINGS,
-- CONTACT_REFERENCE_PATTERN, CONTACT_STATUS_TRANSITIONS and the closed choice lists mirror the
-- literals below).
-- =============================================================================================

-- #region [contact] 1. The reference
-- `CT-XXXX-XXXX` over Crockford base32 (no I, L, O or U, so a reference read aloud or copied by hand
-- cannot become another): eight random bytes, each mapped by its low five bits onto the 32 symbols.
-- VOLATILE because gen_random_bytes is. TypeScript twin: formatContactReference.
CREATE OR REPLACE FUNCTION ops.fn_contact_reference ()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
    v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    v_bytes bytea := extensions.gen_random_bytes(8);
    v_chars text := '';
BEGIN
    FOR i IN 0..7 LOOP
        v_chars := v_chars || pg_catalog.substr(v_alphabet, (pg_catalog.get_byte(v_bytes, i) & 31) + 1, 1);
    END LOOP;
    RETURN 'CT-' || pg_catalog.substr(v_chars, 1, 4) || '-' || pg_catalog.substr(v_chars, 5, 4);
END;
$$;

COMMENT ON FUNCTION ops.fn_contact_reference () IS
'A fresh contact reference, CT-XXXX-XXXX over Crockford base32 (Decision #276). Uniqueness is the table''s constraint; ops.submit_contact_request re-draws on a collision.';
-- #endregion

-- #region [contact] 2. The intake door
-- Every argument is re-checked here, because `anon` reaches this function directly through PostgREST
-- as well as through the app:
--   * the intent is one of four, and the payload is an object holding ONLY its intent's keys
--     (CONTACT_PAYLOAD_KEYS) with a message of 20–5,000 characters and a name of at most 120;
--   * every key holds what the Zod SSOT parses it to — strings within their caps, the closed choices
--     from their lists (mirrored value for value from CONTACT_COMPANY_SIZES, CONTACT_BUDGETS,
--     ContactSupportTopic, CONTACT_SECURITY_REPORTS), a dispute's engagement exactly as the
--     service resolves it — and the keys every request of an intent stores are present, so no
--     reader of a stored payload is ever handed a shape it does not expect;
--   * an anonymous report is a security report with no address, no name, no attachments and no
--     account (auth.uid() is deliberately not recorded); anything else has a reply address;
--   * the durable ceilings, per rolling hour (CONTACT_DB_CEILINGS): 5 per reply address, 10 per
--     signed-in account, 60 named requests from guests platform-wide and 30 anonymous reports
--     platform-wide — `PR429`. The app's per-process limiter (per IP, per address) answers first;
--     these hold when it is bypassed. The two platform-wide ceilings bound what a script calling this
--     door directly with rotating addresses can write — and so how many `contact.received` notices
--     it can raise — at the cost that such a flood shuts guests (never signed-in senders) out for up
--     to an hour (Decision #276 (j));
--   * attachments only from a signed-in sender, at most 5, each the CALLER's own `files.items` row
--     with `purpose = 'contact'`, `status = 'uploaded'`, not deleted and not already sent — so a
--     request can never claim somebody else's file, or one the scan has not admitted. The rows are
--     locked first, so a concurrent Remove or sweep (sections 5, 6) either finishes before this
--     reads them (and the file is refused as deleted) or waits until the request holds it.
-- The message is stored as written: no copy reaches anyone but operators today, so nothing is masked
-- (comms.mask_pii guards copies shown to non-operators — Decision #147). The operators are told
-- through comms.fn_notify (`contact.received`), which never raises; the notification names the
-- intent and the reference, never the sender's words.
-- Returns {id, reference, intent, status, created_at}. Refusals: 22023 (a malformed field, named in
-- the message), 42501 (attachments without a session), PR429 (a ceiling).
CREATE OR REPLACE FUNCTION ops.submit_contact_request (
    p_intent text,
    p_email text,
    p_anonymous boolean,
    p_payload jsonb,
    p_attachment_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_anonymous boolean := COALESCE(p_anonymous, false);
    v_email text := NULLIF(pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, ''))), '');
    v_ids uuid[] := COALESCE(p_attachment_ids, '{}'::uuid[]);
    v_now timestamptz := pg_catalog.now();
    v_allowed text[];
    v_key text;
    v_recent integer;
    v_found integer;
    v_id uuid;
    v_ref text;
    v_created timestamptz;
    v_attempt integer := 0;
    v_op uuid;
    -- The closed lists, value for value (contact.contract.test.ts reads them).
    v_company_sizes constant text[] := ARRAY['not-say', '1-10', '11-50', '51-200', '201-1000', '1000-plus'];
    v_budgets constant text[] := ARRAY['not-sure', 'under-5k', '5k-25k', '25k-100k', '100k-plus'];
    -- One support topic per help-centre category (editorial.help_categories, permanent slugs), then 'other'.
    v_topics constant text[] := ARRAY['getting-started', 'projects-and-stages', 'escrow-and-payments', 'revisions-and-approvals', 'disputes-and-fair-exit', 'payouts-and-verification', 'teams-and-businesses', 'account-and-security', 'other'];
    v_reports constant text[] := ARRAY['vulnerability', 'abuse', 'whistleblower'];
    v_formats constant text[] := ARRAY['one_off', 'pipeline', 'session'];
    v_engagement jsonb;
BEGIN
    -- #region Shape
    IF p_intent IS NULL OR p_intent NOT IN ('sales', 'support', 'dispute', 'security') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contact: intent must be sales, support, dispute or security';
    END IF;
    IF p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload) <> 'object' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contact: payload must be an object';
    END IF;
    IF pg_catalog.pg_column_size(p_payload) > 16384 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contact: payload is too large';
    END IF;

    v_allowed := CASE p_intent
        WHEN 'sales' THEN ARRAY['name', 'company', 'companySize', 'budget', 'message']
        WHEN 'support' THEN ARRAY['name', 'accountEmail', 'topic', 'message']
        WHEN 'dispute' THEN ARRAY['name', 'referenceId', 'engagement', 'message']
        ELSE ARRAY['name', 'reportType', 'message']
    END;
    FOR v_key IN SELECT pg_catalog.jsonb_object_keys(p_payload) LOOP
        IF NOT (v_key = ANY (v_allowed)) THEN
            RAISE EXCEPTION USING ERRCODE = '22023',
                MESSAGE = pg_catalog.format('contact: a %s request has no field %s', p_intent, v_key);
        END IF;
    END LOOP;

    IF pg_catalog.jsonb_typeof(p_payload -> 'message') IS DISTINCT FROM 'string'
       OR pg_catalog.length(pg_catalog.btrim(p_payload ->> 'message')) < 20
       OR pg_catalog.length(p_payload ->> 'message') > 5000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contact: message must be 20 to 5000 characters';
    END IF;
    IF p_payload ? 'name' AND (pg_catalog.jsonb_typeof(p_payload -> 'name') <> 'string'
       OR pg_catalog.length(pg_catalog.btrim(p_payload ->> 'name')) NOT BETWEEN 1 AND 120) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contact: name must be 1 to 120 characters';
    END IF;
    -- #endregion

    -- #region Field values
    -- What every request of an intent stores (toStoredPayload): the sender's name unless the report
    -- is anonymous, and the intent's required choices.
    IF NOT v_anonymous AND NOT p_payload ? 'name' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contact: name must be 1 to 120 characters';
    END IF;
    -- (Parenthesised: PL/pgSQL ends an IF condition at its first bare THEN.)
    IF NOT (p_payload ?& (CASE p_intent
            WHEN 'sales' THEN ARRAY['company', 'companySize', 'budget']
            WHEN 'support' THEN ARRAY['topic']
            WHEN 'security' THEN ARRAY['reportType']
            ELSE ARRAY[]::text[]
        END)) THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = pg_catalog.format('contact: a %s request is missing a required field', p_intent);
    END IF;

    -- Free text, within the Zod caps (blank optional strings are dropped before storing, so a
    -- present one has at least one character).
    IF p_payload ? 'company' AND (pg_catalog.jsonb_typeof(p_payload -> 'company') <> 'string'
       OR pg_catalog.length(pg_catalog.btrim(p_payload ->> 'company')) NOT BETWEEN 1 AND 160) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contact: company must be 1 to 160 characters';
    END IF;
    IF p_payload ? 'referenceId' AND (pg_catalog.jsonb_typeof(p_payload -> 'referenceId') <> 'string'
       OR pg_catalog.length(pg_catalog.btrim(p_payload ->> 'referenceId')) NOT BETWEEN 1 AND 200) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contact: referenceId must be 1 to 200 characters';
    END IF;
    IF p_payload ? 'accountEmail' AND (pg_catalog.jsonb_typeof(p_payload -> 'accountEmail') <> 'string'
       OR pg_catalog.length(p_payload ->> 'accountEmail') > 254
       OR (p_payload ->> 'accountEmail') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contact: accountEmail must be a valid address';
    END IF;

    -- Closed choices.
    IF p_payload ? 'companySize' AND (pg_catalog.jsonb_typeof(p_payload -> 'companySize') <> 'string'
       OR NOT ((p_payload ->> 'companySize') = ANY (v_company_sizes))) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contact: companySize is not one of the size bands';
    END IF;
    IF p_payload ? 'budget' AND (pg_catalog.jsonb_typeof(p_payload -> 'budget') <> 'string'
       OR NOT ((p_payload ->> 'budget') = ANY (v_budgets))) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contact: budget is not one of the budget bands';
    END IF;
    IF p_payload ? 'topic' AND (pg_catalog.jsonb_typeof(p_payload -> 'topic') <> 'string'
       OR NOT ((p_payload ->> 'topic') = ANY (v_topics))) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contact: topic is not one of the support topics';
    END IF;
    IF p_payload ? 'reportType' AND (pg_catalog.jsonb_typeof(p_payload -> 'reportType') <> 'string'
       OR NOT ((p_payload ->> 'reportType') = ANY (v_reports))) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contact: reportType is not one of the report kinds';
    END IF;

    -- A dispute's engagement, exactly as ContactEngagementRefSchema shapes it: {slug, title, format}
    -- and nothing else. Nested, so no key is read off something that is not an object.
    IF p_payload ? 'engagement' THEN
        v_engagement := p_payload -> 'engagement';
        IF pg_catalog.jsonb_typeof(v_engagement) <> 'object' THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contact: engagement must be {slug, title, format}';
        END IF;
        IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(v_engagement) AS k
                    WHERE k NOT IN ('slug', 'title', 'format'))
           OR pg_catalog.jsonb_typeof(v_engagement -> 'slug') IS DISTINCT FROM 'string'
           OR COALESCE(pg_catalog.length(v_engagement ->> 'slug'), 0) NOT BETWEEN 1 AND 120
           OR pg_catalog.jsonb_typeof(v_engagement -> 'title') IS DISTINCT FROM 'string'
           OR COALESCE(pg_catalog.length(v_engagement ->> 'title'), 0) NOT BETWEEN 1 AND 160
           OR pg_catalog.jsonb_typeof(v_engagement -> 'format') IS DISTINCT FROM 'string'
           OR NOT COALESCE((v_engagement ->> 'format') = ANY (v_formats), false) THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contact: engagement must be {slug, title, format}';
        END IF;
    END IF;
    -- #endregion

    -- #region Sender + ceilings
    IF v_anonymous THEN
        IF p_intent <> 'security' THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contact: only a security report can be anonymous';
        END IF;
        IF v_email IS NOT NULL OR p_payload ? 'name' THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contact: an anonymous report carries no name or address';
        END IF;
        IF pg_catalog.cardinality(v_ids) > 0 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contact: an anonymous report carries no attachments';
        END IF;
        v_uid := NULL;
        SELECT pg_catalog.count(*) INTO v_recent
          FROM ops.contact_requests r
         WHERE r.anonymous AND r.created_at > v_now - interval '1 hour';
        IF v_recent >= 30 THEN
            RAISE EXCEPTION USING ERRCODE = 'PR429',
                MESSAGE = 'contact: too many anonymous reports arrived in the last hour — try again later';
        END IF;
    ELSE
        IF v_email IS NULL OR pg_catalog.length(v_email) > 254 OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contact: email must be a valid reply address';
        END IF;
        SELECT pg_catalog.count(*) INTO v_recent
          FROM ops.contact_requests r
         WHERE r.email = v_email AND r.created_at > v_now - interval '1 hour';
        IF v_recent >= 5 THEN
            RAISE EXCEPTION USING ERRCODE = 'PR429',
                MESSAGE = 'contact: this address has sent 5 requests in the last hour — try again later';
        END IF;
        IF v_uid IS NOT NULL THEN
            SELECT pg_catalog.count(*) INTO v_recent
              FROM ops.contact_requests r
             WHERE r.user_id = v_uid AND r.created_at > v_now - interval '1 hour';
            IF v_recent >= 10 THEN
                RAISE EXCEPTION USING ERRCODE = 'PR429',
                    MESSAGE = 'contact: this account has sent 10 requests in the last hour — try again later';
            END IF;
        ELSE
            SELECT pg_catalog.count(*) INTO v_recent
              FROM ops.contact_requests r
             WHERE r.user_id IS NULL AND NOT r.anonymous AND r.created_at > v_now - interval '1 hour';
            IF v_recent >= 60 THEN
                RAISE EXCEPTION USING ERRCODE = 'PR429',
                    MESSAGE = 'contact: too many requests without an account arrived in the last hour — sign in, or try again later';
            END IF;
        END IF;
    END IF;
    -- #endregion

    -- #region Attachments
    IF pg_catalog.cardinality(v_ids) > 0 THEN
        IF p_intent = 'sales' THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contact: a sales enquiry carries no attachments';
        END IF;
        IF v_uid IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'contact: sign in to attach files';
        END IF;
        IF pg_catalog.cardinality(v_ids) > 5 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contact: at most 5 attachments';
        END IF;
        IF (SELECT pg_catalog.count(DISTINCT x) FROM pg_catalog.unnest(v_ids) AS x) <> pg_catalog.cardinality(v_ids) THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'contact: an attachment is listed twice';
        END IF;
        -- Lock the caller's rows first (never anybody else's), so the count below reads them after
        -- any Remove or sweep that held them has committed.
        PERFORM 1 FROM files.items i
         WHERE i.id = ANY (v_ids) AND i.owner_user_id = v_uid
           FOR UPDATE;
        SELECT pg_catalog.count(*) INTO v_found
          FROM files.items i
         WHERE i.id = ANY (v_ids)
           AND i.owner_user_id = v_uid
           AND i.purpose = 'contact'::files.asset_purpose
           AND i.status = 'uploaded'::files.file_status
           AND i.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM ops.contact_request_attachments a WHERE a.file_id = i.id);
        IF v_found <> pg_catalog.cardinality(v_ids) THEN
            RAISE EXCEPTION USING ERRCODE = '22023',
                MESSAGE = 'contact: an attachment is not yours, has not finished its check, or was already sent';
        END IF;
    END IF;
    -- #endregion

    -- #region Write
    LOOP
        v_attempt := v_attempt + 1;
        v_ref := ops.fn_contact_reference();
        BEGIN
            INSERT INTO ops.contact_requests (reference, intent, email, user_id, anonymous, payload)
            VALUES (v_ref, p_intent, v_email, v_uid, v_anonymous, p_payload)
            RETURNING id, created_at INTO v_id, v_created;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            IF v_attempt >= 5 THEN
                RAISE;
            END IF;
        END;
    END LOOP;

    INSERT INTO ops.contact_request_attachments (request_id, file_id)
    SELECT v_id, x FROM pg_catalog.unnest(v_ids) AS x;
    -- #endregion

    -- #region Tell the operators
    FOR v_op IN SELECT au.user_id FROM ops.admin_users au ORDER BY au.user_id LOOP
        PERFORM comms.fn_notify(
            v_op, 'contact.received',
            pg_catalog.format('New %s request %s', p_intent, v_ref),
            pg_catalog.format('A %s request arrived through /contact%s. Quote %s when you reply.',
                p_intent,
                CASE WHEN pg_catalog.cardinality(v_ids) > 0
                     THEN pg_catalog.format(' with %s attachment%s', pg_catalog.cardinality(v_ids),
                          CASE WHEN pg_catalog.cardinality(v_ids) = 1 THEN '' ELSE 's' END)
                     ELSE '' END,
                v_ref),
            'ops.contact_requests', v_id,
            pg_catalog.jsonb_build_object('reference', v_ref, 'intent', p_intent)
        );
    END LOOP;
    -- #endregion

    RETURN pg_catalog.jsonb_build_object(
        'id', v_id,
        'reference', v_ref,
        'intent', p_intent,
        'status', 'backlog',
        'created_at', v_created
    );
END;
$$;

COMMENT ON FUNCTION ops.submit_contact_request (text, text, boolean, jsonb, uuid[]) IS
'The /contact intake door (Decision #276): validates intent, payload keys and values, and sender, holds the durable rate ceilings (PR429), links the caller''s own scanned contact attachments, writes ops.contact_requests in backlog and notifies every operator (contact.received). Returns {id, reference, intent, status, created_at}.';
-- #endregion

-- #region [contact] 3. The operator's move
-- Moves one request along the unified machine. Operators only (security.is_admin(), else 42501); an
-- unknown reference is P0002. The trigger decides whether the move is legal (23514 otherwise).
CREATE OR REPLACE FUNCTION ops.set_contact_request_status (
    p_reference text,
    p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row ops.contact_requests%ROWTYPE;
BEGIN
    IF NOT security.is_admin() THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'contact: only an operator can move a request';
    END IF;
    UPDATE ops.contact_requests r
       SET status = p_status
     WHERE r.reference = p_reference
    RETURNING r.* INTO v_row;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'contact: no request has that reference';
    END IF;
    RETURN pg_catalog.jsonb_build_object('reference', v_row.reference, 'status', v_row.status,
        'updated_at', v_row.updated_at);
END;
$$;

COMMENT ON FUNCTION ops.set_contact_request_status (text, text) IS
'Operators only: move a contact request backlog → in_progress → complete | archived (Decision #276). Legality is ops.fn_guard_contact_request''s.';
-- #endregion

-- #region [contact] 4. The record guard (trigger function)
-- BEFORE UPDATE on ops.contact_requests, for every role. A request is a record: only `status` moves,
-- and only along backlog → in_progress | archived, in_progress → complete | archived,
-- complete → archived (`archived` is terminal — CONTACT_STATUS_TRANSITIONS). The one other change
-- allowed is `user_id` → NULL, which is the account-erasure FK (ON DELETE SET NULL) and must pass.
-- Stamps `updated_at`.
CREATE OR REPLACE FUNCTION ops.fn_guard_contact_request ()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.reference IS DISTINCT FROM OLD.reference
       OR NEW.intent IS DISTINCT FROM OLD.intent
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.anonymous IS DISTINCT FROM OLD.anonymous
       OR NEW.payload IS DISTINCT FROM OLD.payload
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR (NEW.user_id IS DISTINCT FROM OLD.user_id AND NEW.user_id IS NOT NULL) THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
            MESSAGE = 'contact: a request is a record — only its status changes';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
           (OLD.status = 'backlog' AND NEW.status IN ('in_progress', 'archived'))
        OR (OLD.status = 'in_progress' AND NEW.status IN ('complete', 'archived'))
        OR (OLD.status = 'complete' AND NEW.status = 'archived')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
            MESSAGE = pg_catalog.format('contact: a request cannot move from %s to %s', OLD.status, NEW.status);
    END IF;
    NEW.updated_at := pg_catalog.now();
    RETURN NEW;
END;
$$;
-- #endregion

-- #region [contact] 5. Taking an unsent attachment back
-- A sender pressed Remove on a file they have not sent. The row is soft-deleted (nothing is
-- hard-deleted, root CLAUDE.md §5) and the answer names its object, so the contact service deletes
-- the BYTES through the Storage API: a file someone took back — perhaps the wrong, sensitive
-- document — is not kept; no operator could read it anyway (the operator arm of
-- files.fn_can_read and the contact storage policy reach only SENT attachments).
-- Only the caller's own contact upload — declared for this pipeline (`target_bucket = 'contact'`,
-- still `library` until promoted) or already promoted (`purpose = 'contact'`) — that is not deleted
-- and not linked to a request. One being checked right now (`scanning`: the pipeline is promoting
-- it) is refused with 55006, try again in a moment. The row is locked, so a submission citing the
-- same file either links it first (and this refuses) or finds it deleted (and refuses).
-- Returns {id, bucket_id, storage_path}. Refusals: 42501 (no session), P0002 (not the caller's
-- unsent contact attachment), 55006 (being checked).
CREATE OR REPLACE FUNCTION ops.discard_contact_attachment (p_file_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_item files.items%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'contact: sign in to remove an attachment';
    END IF;
    SELECT * INTO v_item
      FROM files.items i
     WHERE i.id = p_file_id
       AND i.owner_user_id = v_uid
       AND i.deleted_at IS NULL
       AND (i.purpose = 'contact'::files.asset_purpose
            OR (i.purpose = 'library'::files.asset_purpose AND i.target_bucket = 'contact'))
       FOR UPDATE;
    IF NOT FOUND OR EXISTS (SELECT 1 FROM ops.contact_request_attachments a WHERE a.file_id = p_file_id) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'contact: no unsent attachment of yours has that id';
    END IF;
    IF v_item.status = 'scanning'::files.file_status THEN
        RAISE EXCEPTION USING ERRCODE = '55006', MESSAGE = 'contact: this file is being checked — remove it in a moment';
    END IF;
    UPDATE files.items i SET deleted_at = pg_catalog.now() WHERE i.id = p_file_id;
    RETURN pg_catalog.jsonb_build_object(
        'id', v_item.id,
        'bucket_id', v_item.bucket_id,
        'storage_path', v_item.storage_path
    );
END;
$$;

COMMENT ON FUNCTION ops.discard_contact_attachment (uuid) IS
'Remove on an unsent /contact attachment (Decision #276): soft-deletes the caller''s own unlinked contact upload and answers {id, bucket_id, storage_path} so the service deletes its bytes. P0002 when it is not theirs, already sent or gone; 55006 while it is being checked.';
-- #endregion

-- #region [contact] 6. The sweep of abandoned attachments
-- A form closed with files on it leaves contact uploads nobody will send: invisible in their owner's
-- library (`purpose = 'contact'`), unreadable by operators (never linked), and counted against the
-- owner's storage. The hourly http job `contact-attachment-sweep` (00005060) claims a batch through
-- this function — every contact upload, declared or promoted, older than `p_older_than` (never under
-- an hour), not deleted and not linked to a request, oldest first — soft-deletes the rows and answers
-- each object, which the app then deletes (ContactBackendService.sweepAttachments). A row mid-check
-- is skipped unless its check stalled an hour ago; rows another session holds (a submission linking
-- them, a Remove) are skipped too (SKIP LOCKED), so a sweep never takes a file that is being sent.
-- Service role only.
CREATE OR REPLACE FUNCTION ops.fn_claim_stale_contact_attachments (
    p_older_than interval DEFAULT interval '6 hours',
    p_limit integer DEFAULT 100
)
RETURNS TABLE (file_id uuid, bucket text, object_path text)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH stale AS (
        SELECT i.id
          FROM files.items i
         WHERE i.deleted_at IS NULL
           AND (i.purpose = 'contact'::files.asset_purpose
                OR (i.purpose = 'library'::files.asset_purpose AND i.target_bucket = 'contact'))
           AND i.created_at < pg_catalog.now() - GREATEST(COALESCE(p_older_than, interval '6 hours'), interval '1 hour')
           AND (i.status <> 'scanning'::files.file_status OR i.updated_at < pg_catalog.now() - interval '1 hour')
           AND NOT EXISTS (SELECT 1 FROM ops.contact_request_attachments a WHERE a.file_id = i.id)
         ORDER BY i.created_at
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 1000)
           FOR UPDATE OF i SKIP LOCKED
    )
    UPDATE files.items t
       SET deleted_at = pg_catalog.now()
      FROM stale
     WHERE t.id = stale.id
    RETURNING t.id, t.bucket_id, t.storage_path;
$$;

COMMENT ON FUNCTION ops.fn_claim_stale_contact_attachments (interval, integer) IS
'The contact-attachment sweep (Decision #276): soft-deletes up to p_limit unsent /contact uploads older than p_older_than (at least an hour) and answers each object for the app to delete. Service role only.';
-- #endregion
