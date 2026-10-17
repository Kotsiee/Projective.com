# editorial: Policies

Migration
[`00002021_policies_editorial_community.sql`](../../../supabase/migrations/00002021_policies_editorial_community.sql)
(RLS enabled in `00002001`, regions `[editorial.*]`). The schema is exposed to PostgREST and `USAGE`
is granted to `anon`, `authenticated` and `service_role` (`00002500`); there is **no schema-wide
table grant to a client role** — each table is named in its region of `00002520`, SELECT only. The
service role holds every table. Every function is revoked from the client roles by default
(`00002510`) and granted back by name. Tables: [Tables.md](Tables.md) · Functions:
[Functions.md](Functions.md).

**The model:** platform-authored content. `anon` and `authenticated` READ what is published; no
client role writes at all — rows arrive through the generated category-5 migrations, and any
operator tooling runs as the service role. So an editorial table needs one SELECT policy (published
rows, or every row where nothing is ever unpublished) and no write policy.

## Help

_Not yet documented._ (P2.)

## Changelog

_Not yet documented._ (P5.)

## Articles

_Not yet documented._ (P6.)
