-- =============================================================================================
-- 00000013_tables_ops.sql — ops schema tables (Category 0). Source: 0005_ops_tables.sql.
-- Folded: ops.log_entries — production log ingestion, homed here rather than in a new `logging`
--   schema (see the schema-decision note above the table).
-- =============================================================================================

CREATE TABLE ops.admin_users (
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'admin'::text,
  granted_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT admin_users_pkey PRIMARY KEY (user_id),
  CONSTRAINT admin_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT admin_users_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id)
);

-- #region Log ingestion (production client/server diagnostics)
-- SCHEMA DECISION. The gap audit proposed a dedicated `logging` schema holding this one table. It
-- lands here as `ops.log_entries` instead: `ops` is already the operational/admin namespace, and a
-- fourteenth schema created to hold a single table buys a search_path entry, a grant surface and a
-- policy file for isolation a table name already gives us. `LogBackendService` inserts here through
-- PostgREST, which is why `ops` is in `supabase/config.toml` [api].schemas.
CREATE TABLE ops.log_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  -- LogEntry.id, generated in the browser. Kept beside our own `id` rather than used as the PK: it
  -- arrives from an unauthenticated public surface, so it is a correlation handle for matching a
  -- session's in-browser inspector history to a stored row — never an identity we key on or trust.
  client_id text NOT NULL,
  -- The Zod LogLevel enum has five members but only the two durable ones are ever persisted
  -- (`debug`/`info`/`network` are dev-inspector noise, see packages/types/logging/mod.ts). The third
  -- stored level, `metric`, is not a LogLevel at all: it is a Core Web Vitals sample
  -- (`PersistedLogLevel` in the same SSOT), whose figures live in `data`. Modelled as text + CHECK
  -- rather than a Postgres enum: an enum would either mirror all five and need this same CHECK anyway,
  -- or diverge from the SSOT's name for its own domain.
  level text NOT NULL,
  message text NOT NULL,
  -- Client-supplied event time (LogEntry.at, epoch ms) and therefore UNTRUSTED — a skewed browser clock
  -- lands here verbatim. `created_at` below is the server's receipt time and is the only one a
  -- retention sweep or an ordering may key on; the pair is not redundant because a sendBeacon flush can
  -- arrive minutes after the event it describes, or on the next page load.
  occurred_at timestamp with time zone NOT NULL,
  source text NOT NULL DEFAULT 'client'::text,
  scope text,
  -- Network context. Reachable despite the warn/error-only level CHECK: a failed request is logged as
  -- an `error` carrying its method/url/status/timing, so these are live columns, not dead ones.
  method text,
  url text,
  status integer,
  duration_ms integer,
  request jsonb,
  response jsonb,
  -- Structured payload for non-network entries. jsonb rather than a child table because the shape is
  -- arbitrary per call site (the SSOT types it `unknown`), it is only ever read back whole for a human,
  -- and it is size-capped by the logger before send.
  data jsonb,
  -- LogBatchMeta — envelope diagnostics, best-effort and denormalised onto every entry of the batch so
  -- one row is self-describing when read in isolation during an incident.
  path text,
  user_agent text,
  release text,
  -- Nullable: /api/logs is reachable from public surfaces and is not behind the (dashboard) guard, so
  -- an anonymous entry is the normal case, not a defect. SET NULL on user deletion anonymises the
  -- diagnostic rather than destroying it.
  user_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT log_entries_pkey PRIMARY KEY (id),
  CONSTRAINT log_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES org.users_public (user_id) ON DELETE SET NULL,
  -- The only two refusals on this table. Both are domain definitions the thin route's Zod already
  -- guarantees, so they can only fire on a bug in our own code, never on hostile input. Deliberately NO
  -- length or range CHECKs mirroring the SSOT's max() caps: ingest must never fail loudly (the service
  -- contract is that a logging failure is invisible to the user), so a boundary bug should truncate at
  -- the service, not turn into a rejected insert on the one path that reports our other failures.
  CONSTRAINT log_entries_level_check CHECK (level = ANY (ARRAY['warn'::text, 'error'::text, 'metric'::text])),
  CONSTRAINT log_entries_source_check CHECK (source = ANY (ARRAY['client'::text, 'server'::text]))
);
-- No `updated_at`: an entry is append-only, so the column would be a permanent duplicate of
-- `created_at`. No soft-delete column either — retention pruning is the one legitimate hard delete in
-- this schema, because unbounded growth is the failure mode a log table has to be swept for, and a
-- tombstone flag would leave the rows behind that the sweep exists to remove.
-- #endregion

-- #region Scheduled jobs (Decision #203)
-- The one registry of recurring work. Each row is a pg_cron job: inserting, updating or disabling it
-- schedules, reschedules or unschedules the job in the same transaction (`ops.tg_scheduled_jobs_apply`,
-- 00001897), so the cadence written here is the cadence that runs. A `sql` job runs its `command` in
-- the database; an `http` job POSTs to the app at `path`, dispatched by pg_net with a bearer read from
-- Vault (`ops.fn_dispatch_http_job`, 00001650). The jobs are seeded by 00005060.
CREATE TABLE ops.scheduled_jobs (
  name text NOT NULL,
  kind text NOT NULL,
  -- Five-field cron, UTC. pg_cron validates it when the row is applied; an invalid value is refused
  -- together with the write.
  schedule text NOT NULL,
  -- A single SELECT, so `ops.run_job` can return its result.
  command text,
  path text,
  -- The bearer's Vault secret name, which is also the app's env key: the dispatcher and the route
  -- each read the same value from their own store.
  secret_name text,
  description text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT scheduled_jobs_pkey PRIMARY KEY (name),
  CONSTRAINT scheduled_jobs_name_check CHECK (name ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT scheduled_jobs_kind_check CHECK (kind = ANY (ARRAY['sql'::text, 'http'::text])),
  CONSTRAINT scheduled_jobs_target_check CHECK (
    (kind = 'sql' AND command ~ '^SELECT [^;]+;?$' AND path IS NULL AND secret_name IS NULL)
    OR (kind = 'http' AND command IS NULL AND path ~ '^/api/\S*$' AND secret_name ~ '^[A-Z][A-Z0-9_]*$')
  )
);

-- One row per HTTP dispatch. pg_net answers asynchronously and keeps a response for six hours
-- (`pg_net.ttl`), so `ops.fn_settle_http_dispatches` copies each outcome here and reports a non-2xx,
-- a transport error or a response that never came. Written once, settled once; never deleted.
CREATE TABLE ops.http_job_dispatches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  job_name text NOT NULL,
  -- `net.http_request_queue.id`, which becomes `net._http_response.id`.
  request_id bigint NOT NULL,
  dispatched_at timestamp with time zone NOT NULL DEFAULT now(),
  settled_at timestamp with time zone,
  status_code integer,
  error text,
  CONSTRAINT http_job_dispatches_pkey PRIMARY KEY (id),
  CONSTRAINT http_job_dispatches_job_name_fkey FOREIGN KEY (job_name) REFERENCES ops.scheduled_jobs (name) ON UPDATE CASCADE ON DELETE RESTRICT
);
-- #endregion

-- #region [contact] Contact requests (P3, Decision #276)
-- What /contact files: one row per request, on the unified status machine (PRODUCT_MANAGEMENT §3.1 —
-- `backlog` on arrival → `in_progress` → `complete` | `archived`). Written only by the definer door
-- `ops.submit_contact_request` (00001655), which stamps auth.uid(), validates the per-intent payload
-- keys, links the sender's own attachments and tells every operator; read by operators only
-- (00002019). Never deleted, and nothing but `status` / `updated_at` ever changes after insert
-- (`ops.fn_guard_contact_request`, 00001897). Zod SSOT: @projective/types/contact.
CREATE TABLE ops.contact_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  -- The human reference the sender is shown and quotes back (`CT-7K4Q-2M9X`, Crockford base32 —
  -- ops.fn_contact_reference). A second key beside `id`, never a route: uuids and references do not
  -- address anything (Decision #88), they correlate a reply to its request.
  reference text NOT NULL,
  intent text NOT NULL,
  status text NOT NULL DEFAULT 'backlog'::text,
  -- The reply address, lower-cased. NULL only on an anonymous security report.
  email text,
  -- The signed-in sender, when there was one and the report is not anonymous. Keyed on the
  -- IDENTITY (auth.users), not the profile: /contact is public, and an account that has not finished
  -- /join has no org.users_public row yet — it is still a signed-in sender, and the one most likely
  -- to need support. SET NULL on account erasure, so a request outlives the account that sent it.
  user_id uuid,
  anonymous boolean NOT NULL DEFAULT false,
  -- The intent's own fields (name, message, the sales/support/dispute/security specifics), stored as
  -- the sender wrote them. NOT masked through comms.mask_pii: no copy is shown to anyone but
  -- operators today; a copy ever shown to a non-operator must be masked first (Decision #147).
  payload jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT contact_requests_pkey PRIMARY KEY (id),
  CONSTRAINT contact_requests_reference_key UNIQUE (reference),
  CONSTRAINT contact_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE SET NULL,
  CONSTRAINT contact_requests_reference_check CHECK (reference ~ '^CT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'),
  CONSTRAINT contact_requests_intent_check CHECK (intent = ANY (ARRAY['sales'::text, 'support'::text, 'dispute'::text, 'security'::text])),
  CONSTRAINT contact_requests_status_check CHECK (status = ANY (ARRAY['backlog'::text, 'in_progress'::text, 'complete'::text, 'archived'::text])),
  CONSTRAINT contact_requests_email_check CHECK (email IS NULL OR (length(email) <= 254 AND email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' AND email = lower(email))),
  -- An anonymous report is a security report with no address and no account; anything else has an
  -- address to reply to.
  CONSTRAINT contact_requests_anonymous_check CHECK (
    CASE WHEN anonymous THEN intent = 'security' AND email IS NULL AND user_id IS NULL
         ELSE email IS NOT NULL END
  ),
  CONSTRAINT contact_requests_payload_check CHECK (
    jsonb_typeof(payload) = 'object'
    AND jsonb_typeof(payload -> 'message') = 'string'
    AND length(payload ->> 'message') BETWEEN 1 AND 5000
    AND pg_column_size(payload) <= 16384
  )
);

-- A request's attachments: files the SENDER uploaded through the contact pipeline (`files.items`,
-- `purpose = 'contact'`, in the private `contact` bucket). A file is attached to one request at most;
-- RESTRICT on both sides, because the request is a record and the file is part of it.
CREATE TABLE ops.contact_request_attachments (
  request_id uuid NOT NULL,
  file_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT contact_request_attachments_pkey PRIMARY KEY (request_id, file_id),
  CONSTRAINT contact_request_attachments_file_key UNIQUE (file_id),
  CONSTRAINT contact_request_attachments_request_fkey FOREIGN KEY (request_id) REFERENCES ops.contact_requests (id) ON DELETE RESTRICT,
  CONSTRAINT contact_request_attachments_file_fkey FOREIGN KEY (file_id) REFERENCES files.items (id) ON DELETE RESTRICT
);
-- #endregion
