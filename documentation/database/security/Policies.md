# security: Policies

Only `security.session_context` is documented so far; the rest of the `security` schema's policies
(penalties, audit logs, feature flags, …) remain _Not yet documented._ — this file is scaffolded to
match the domain/kind structure described in [../README.md](../README.md). See `brain2.md`'s Database
section for the general migration-numbering and RLS conventions.

## `security.session_context` — read-only to the client

Migration [`00002019_policies_security_ops.sql`](../../../supabase/migrations/00002019_policies_security_ops.sql),
grant [`00002520`](../../../supabase/migrations/00002520_permissions_table_grants.sql).

```sql
CREATE POLICY "Users can view own session context"
ON security.session_context FOR SELECT TO authenticated
USING (user_id = auth.uid());

GRANT SELECT ON TABLE security.session_context TO authenticated;
```

**No client write policy, and no write grant** (2026-09-28, root `CLAUDE.md` §8 Decision #122). The
acting context is written only by the `security.switch_*` / `clear_session_context` definers
([Functions.md](Functions.md#context-switching--the-access-token-hook)), each of which re-checks the
membership it names. The `FOR ALL` policy (`"Users can manage own session context"`) and the
`SELECT, INSERT, UPDATE` grant this replaces let any signed-in user write `active_team_id` /
`active_profile_id` to **any** entity over PostgREST — and the access-token hook then stamped that
forged context into their JWT, where `security.current_context()` hands it to RLS as trusted input.
The hook now also re-checks the membership at every mint, so even a row written some other way
authorises nothing it does not describe.
