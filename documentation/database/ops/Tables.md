# ops: Tables

_Not yet documented._ This file is scaffolded to match the domain/kind structure described in
[../README.md](../README.md), but no Tables content has been written for the `ops` schema yet.

See `brain2.md`'s Database section for the general migration-numbering and RLS conventions this
domain follows once populated.

## `ops.reports` — not migrated

The user-reporting table of the Two-Zone moderation model (Decision #148) **does not exist yet**:
`00000013_tables_ops.sql` defines only `ops.admin_users` and `ops.log_entries`. Its proposed shape —
`reporter_user_id`, `reported_subject_type`, `reported_subject_id`, `reason`, an immutable
server-built `evidence_snapshot jsonb`, `status` (`pending` · `dismissed` · `actioned`) and
`resolution_notes` — is in `SYSTEM_ARCHITECTURE.md` §Backend Services → Content moderation. It is
documented here only when its migration, RLS policies and Zod schema land (see
[../CLAUDE.md](../CLAUDE.md): this folder documents the migrated schema).
