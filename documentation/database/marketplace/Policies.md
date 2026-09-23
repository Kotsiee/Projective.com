# marketplace: Policies

_Not yet documented._ This file is scaffolded to match the domain/kind structure described in
[../README.md](../README.md), but no Policies content has been written for the `marketplace` schema
yet.

See `brain2.md`'s Database section for the general migration-numbering and RLS conventions this
domain follows once populated.

## Documented policies

Migration [`00002018_policies_reviews_marketplace.sql`](../../../supabase/migrations/00002018_policies_reviews_marketplace.sql).
`marketplace` is exposed to PostgREST; `anon` and `authenticated` hold `USAGE` (`00002500`), and
`TRUNCATE` is revoked from both (it is not row-level, so RLS would not bound it).

### `marketplace.service_blueprints`

| Policy                              | Command | Roles         | Rule                                                                                      |
| :---------------------------------- | :------ | :------------ | :---------------------------------------------------------------------------------------- |
| Public can view published blueprints | SELECT | public        | `is_published` OR the caller is the freelancer.                                           |
| Freelancers create own blueprints   | INSERT  | authenticated | `freelancer_profile_id = auth.uid()`, and a team-owned blueprint only as an active member of that team (`org.is_active_team_member`). |
| Freelancers update own blueprints   | UPDATE  | authenticated | The same predicate on both the pre-image and the post-image.                             |

There is **no DELETE policy**: the previous single `FOR ALL` policy allowed a hard delete that
cascaded into `catalogue.listings`, and named no team check at all. A blueprint is withdrawn by
`is_published`. The derived `rating_*` columns are refused to a client by
`trg_service_blueprints_derived` (see [../security/Functions.md](../security/Functions.md)).

### `marketplace.promoted_placements`

| Policy                            | Command | Roles               | Rule                                                             |
| :-------------------------------- | :------ | :------------------ | :--------------------------------------------------------------- |
| Active placements are public      | SELECT  | anon, authenticated | `cancelled_at IS NULL AND starts_at <= now() AND ends_at > now()` |
| Sponsors see their own placements | SELECT  | authenticated       | `sponsor_user_id = auth.uid()`                                   |

An active placement is public on purpose — it is what the "AD" disclosure is answerable from. There
is deliberately **no client write policy**: a placement is paid for, so it is written by the billing
path that took the payment (a definer or the service role), never by a PostgREST insert.

### `marketplace.quote_requests`

| Policy                              | Command | Roles         | Rule                                                                                         |
| :---------------------------------- | :------ | :------------ | :------------------------------------------------------------------------------------------- |
| Parties see their quote requests    | SELECT  | authenticated | The caller is the requester or the host.                                                     |
| Buyers raise quote requests         | INSERT  | authenticated | The caller is the requester, not the host, and the blueprint is published AND sold by that host. |
| Parties update their quote requests | UPDATE  | authenticated | The caller is a party (pre- and post-image).                                                 |

A policy sees only the post-image, so the parties and the blueprint are pinned by
`trg_quote_requests_parties` (`security.fn_guard_immutable_columns`): the host answers, the buyer
withdraws, and neither can re-address the request. Verified by execution against the seeded corpus.
