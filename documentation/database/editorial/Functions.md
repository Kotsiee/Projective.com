# editorial: Functions

Migration
[`00001320_functions_editorial_community.sql`](../../../supabase/migrations/00001320_functions_editorial_community.sql)
(regions `[editorial.*]`); triggers in `00001898` under the same region names. EXECUTE is revoked
from `PUBLIC`, `anon` and `authenticated` on the whole schema (`00002510`, "editorial + community —
deny by default") and granted back by name in the surface's region there. Editorial content is read
straight from its tables under their SELECT policies, so editorial functions should be rare — a
derived read, never a write door. Tables: [Tables.md](Tables.md) · Policies:
[Policies.md](Policies.md).

## Help

_Not yet documented._ (P2.)

## Changelog

_Not yet documented._ (P5.)

## Articles

_Not yet documented._ (P6.)
