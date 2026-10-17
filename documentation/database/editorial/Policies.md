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
operator tooling runs as the service role. So an editorial table needs one SELECT policy for `anon`
and `authenticated` and no write policy; the probe `community_editorial_schemas.sql` fails on a
client INSERT / UPDATE / DELETE grant or a non-SELECT policy anywhere in the schema.

**Visibility is one rule on both roads.** Every authored record is seeded, hidden ones included (a
draft, a release dated in the future, a retraction). What a reader is served is decided by the
table's `visible` predicate (`defineEditorialTable`), which `readEditorialTable` applies to the
mapped records on the live road and the fixture road alike — so turning `EDITORIAL_BACKEND_LIVE` on
or off never changes what is shown. The SELECT policy states the same predicate in SQL, so a direct
PostgREST read is closed too, and is never narrower than it (a row it hides that the predicate shows
would be served by the fixture road and missing live). Where nothing is ever hidden: no `visible`,
and `USING (true)`.

## Help

RLS on both tables (`00002001`, `[editorial.help]`); `GRANT SELECT` to `anon` and `authenticated`
(`00002520`) and nothing else.

| Policy                           | Table                       | Command | Roles               | Rule                                                                                                                                                                             |
| :------------------------------- | :-------------------------- | :------ | :------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `help_categories_select_public`  | `editorial.help_categories` | SELECT  | anon, authenticated | `true` — categories are never hidden.                                                                                                                                            |
| `help_articles_select_published` | `editorial.help_articles`   | SELECT  | anon, authenticated | `published_on <= (now() AT TIME ZONE 'UTC')::date AND (archived_on IS NULL OR archived_on > (now() AT TIME ZONE 'UTC')::date)` — the content source's `visible`, never narrower. |

Verified by `supabase/probes/help_centre.sql`: anon reads every published article and no future or
archived one, and neither client role may INSERT, UPDATE or DELETE either table (`42501`).

## Changelog

_Not yet documented._ (P5.)

## Articles

_Not yet documented._ (P6.)
