# security: Policies

`security.session_context` and the four policy-less tables are documented here; the penalties and
platform-params policies remain _Not yet documented._ — this file is scaffolded to match the
domain/kind structure described in [../README.md](../README.md). See `brain2.md`'s Database section
for the general migration-numbering and RLS conventions.

**RLS is on for every `security` table** (`00002001`; probe
`supabase/probes/rls_exposed_tables.sql`). `security` is exposed to PostgREST
(`supabase/config.toml`), so a table guarded only by holding no grant was one stray `GRANT` from
public.

## `security.audit_logs` · `feature_flags` · `refresh_tokens` · `turnstile_verifications` — definer-only

**RLS on, no policy, no client grant** (IW-M6, 2026-10-30). Until then all four had RLS **off** and
relied on holding no table grant alone. RLS with no policy is default-deny for every client role,
whatever a later grant says. Their writers and readers are `SECURITY DEFINER` functions owned by the
table owner, which RLS does not bind (no `FORCE`, as everywhere in the tree). `refresh_tokens` and
`turnstile_verifications` are referenced by nothing; dropping them waits on the owner's approval
(FOUNDER_QUESTIONNAIRE), so until then they are held shut like the rest.

## `security.session_context` — read-only to the client

Migration [`00002019_policies_security_ops.sql`](../../../supabase/migrations/00002019_policies_security_ops.sql),
grant [`00002520`](../../../supabase/migrations/00002520_permissions_table_grants.sql).

```sql
CREATE POLICY "Users can view own session context"
ON security.session_context FOR SELECT TO authenticated
USING (user_id = auth.uid());

GRANT SELECT ON TABLE security.session_context TO authenticated;
```

**No client write policy, and no write grant** (2026-09-28, root `CLAUDE.md` §8 Decision #61). The
acting context is written only by the `security.switch_*` / `clear_session_context` definers
([Functions.md](Functions.md#context-switching--the-access-token-hook)), each of which re-checks the
membership it names. The `FOR ALL` policy (`"Users can manage own session context"`) and the
`SELECT, INSERT, UPDATE` grant this replaces let any signed-in user write `active_team_id` /
`active_profile_id` to **any** entity over PostgREST — and the access-token hook then stamped that
forged context into their JWT, where `security.current_context()` hands it to RLS as trusted input.
The hook now also re-checks the membership at every mint, so even a row written some other way
authorises nothing it does not describe.
