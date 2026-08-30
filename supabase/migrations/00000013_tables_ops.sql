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
-- SCHEMA DECISION — FLAGGED. The gap audit proposed a dedicated `logging` schema holding this one
-- table, and `packages/backend/services/logging/LogBackendService.ts` + `packages/backend/core/env.ts`
-- both still name `logging.entries` as the live insert target. It lands here as `ops.log_entries`
-- instead: `ops` is already the operational/admin namespace, and a fourteenth schema created to hold a
-- single table buys a search_path entry, a grant surface and a policy file for isolation a table name
-- already gives us. Those two docstrings are the only references, neither is executable, and the live
-- branch of `LogBackendService.ingest` is still a fall-through — so nothing breaks until the insert is
-- actually wired, at which point both must be repointed at `ops.log_entries`.
CREATE TABLE ops.log_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  -- LogEntry.id, generated in the browser. Kept beside our own `id` rather than used as the PK: it
  -- arrives from an unauthenticated public surface, so it is a correlation handle for matching a
  -- session's in-browser inspector history to a stored row — never an identity we key on or trust.
  client_id text NOT NULL,
  -- The Zod LogLevel enum has five members but only the two durable ones are ever persisted
  -- (`debug`/`info`/`network` are dev-inspector noise, see packages/types/logging/mod.ts). Modelled as
  -- text + CHECK rather than a Postgres enum: an enum would either mirror all five and need this same
  -- CHECK anyway, or diverge from the SSOT's name for its own domain.
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
  CONSTRAINT log_entries_level_check CHECK (level = ANY (ARRAY['warn'::text, 'error'::text])),
  CONSTRAINT log_entries_source_check CHECK (source = ANY (ARRAY['client'::text, 'server'::text]))
);
-- No `updated_at`: an entry is append-only, so the column would be a permanent duplicate of
-- `created_at`. No soft-delete column either — retention pruning is the one legitimate hard delete in
-- this schema, because unbounded growth is the failure mode a log table has to be swept for, and a
-- tombstone flag would leave the rows behind that the sweep exists to remove.
-- #endregion
