# integrations Schema: Policies

RLS is **always on** for `integrations`. The schema mixes two very different postures in four
objects, because it mixes two very different kinds of data: a **public catalogue** and a **secret
token store**.

## Posture at a glance

| Object                            | RLS | `authenticated` grant | Policy                              |
| :-------------------------------- | :-- | :-------------------- | :----------------------------------- |
| `integrations.providers`          | on  | `SELECT`              | `USING (true)` — public reference    |
| `integrations.user_connections`   | on  | **none**              | **none — definer-only**              |
| `integrations.v_my_connections`   | —   | `SELECT`              | (view; filtered to `auth.uid()`)     |
| `integrations.connection_audit`   | on  | `SELECT`              | own rows or admin                    |

## 🔓 `integrations.providers` — deliberately public

```sql
CREATE POLICY "View integration providers" ON integrations.providers
FOR SELECT TO anon, authenticated USING (true);
```

Labels, capabilities and enablement drive the Settings → Integrations provider chips, and a visitor
on a public availability page may legitimately see that a host uses Zoom. `default_scopes` is
**configuration, not a credential** — no secret is stored on this table, so there is nothing to
hide. Writes are service-role only.

## 🔒 `integrations.user_connections` — definer-only, no policy

The token store. RLS is enabled and **no policy is created and no grant is issued to
`authenticated`** — exactly the hidden-ledger posture the core `finance` money tables use. There is
no client path to this table at all.

This is not an oversight to be "fixed" later by adding a `user_id = auth.uid()` policy. Such a
policy would make `access_token_cipher` and `refresh_token_cipher` selectable by anyone who can
craft a PostgREST query with their own JWT, which is precisely what the design prevents. **Column
security here is structural** — the client-facing surface is a view that cannot name those columns —
rather than a policy that a later edit could weaken.

## 👁 `integrations.v_my_connections` — the safe projection

A **non-`security_invoker`** view: it runs as its owner, so it can read the un-policied base table,
and its `WHERE c.user_id = auth.uid ()` clause scopes each caller to their own rows. Only
`SELECT` is granted, only to `authenticated`.

> ⚠️ **Do not add `WITH (security_invoker = true)`** to this view. Under invoker semantics it would
> execute as the caller, who has no privilege on `user_connections`, and every read would fail. If a
> future Postgres/Supabase default flips, this view needs `security_invoker = false` stated
> explicitly.

## 📜 `integrations.connection_audit` — own history

```sql
CREATE POLICY "View own connection audit" ON integrations.connection_audit
FOR SELECT TO authenticated USING (user_id = auth.uid () OR security.is_admin ());
```

Read-only for the user. **No write policy is opened**: every line is appended by the OAuth Edge
Function running as service-role, so a client cannot forge or backdate a consent record.

## Capability checks never leak tokens

The two predicates in [Functions.md](Functions.md) — `fn_has_capability` and
`fn_conferencing_provider` — are `SECURITY DEFINER` and return only a boolean and a slug. They are
the sanctioned way for the booking flow to ask *"can this user mint a room?"* without any path to
the credentials that would answer it.

---

See [Tables.md](Tables.md) for the schema and [Functions.md](Functions.md) for the predicates.
