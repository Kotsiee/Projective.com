# community: Policies

Migration
[`00002021_policies_editorial_community.sql`](../../../supabase/migrations/00002021_policies_editorial_community.sql)
(RLS enabled in `00002001`, regions `[community.*]`). The schema is exposed to PostgREST and `USAGE`
is granted to `anon`, `authenticated` and `service_role` (`00002500`); there is **no schema-wide
table grant to a client role** — each table a client reaches is named in its region of `00002520`
with the narrowest verbs it needs, and never `ALL` (it carries TRUNCATE, which RLS does not bound).
The service role holds every table. Every function is revoked from the client roles by default
(`00002510`) and granted back by name. Tables: [Tables.md](Tables.md) · Functions:
[Functions.md](Functions.md).

**The model:** reads are as narrow as the surface needs; writes go through SECURITY DEFINER doors
that stamp the actor from `auth.uid()`, rate-limit and screen public text — not through INSERT
policies a PostgREST call could reach directly.

## Newsletter

| Table                                | Read                           | Write | Client privilege                                |
| :----------------------------------- | :----------------------------- | :---- | :---------------------------------------------- |
| `community.newsletter_subscriptions` | — **No policy, deliberately.** | —     | **None**, for `anon` and `authenticated` alike. |

Default-deny, and — unlike its old home in `comms`, where a blanket `GRANT ALL … TO authenticated`
left RLS as the only barrier — no client role holds any privilege on it either, so a stray policy
would still grant nothing. Nothing should ever read this table as a user: every row is somebody's
email address paired with a `token` that is the unsubscribe capability, so a SELECT policy wide
enough to be useful is a subscriber-list dump, and a per-row one would still confirm whether a given
address is subscribed. A direct PostgREST INSERT would let anyone enumerate addresses by observing
unique-violation errors. The public form therefore posts to `/api/newsletter/subscribe`, and
`NewsletterBackendService` calls `community.subscribe_newsletter` with the service-role client.

Verified by `supabase/probes/community_editorial_schemas.sql`: both client roles are refused `42501`
on SELECT, INSERT, UPDATE and on the writer itself, before RLS is consulted.

## Help feedback

_Not yet documented._ (P2.)

## Feedback board

_Not yet documented._ (P7.)
