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

An active placement is public on purpose — it is what the "Promoted" slot's disclosure is
answerable from. There is deliberately **no client write policy**: a placement is allocated by the
seller's plan (Decision #454), so it is written only by the entitlement-checked
`marketplace.promote_listing` / `stop_listing_promotion` definers, never by a PostgREST insert (the
probe `promoted_placements.sql` asserts both roles are refused).

### `marketplace.quote_requests`

| Policy                           | Command | Roles         | Rule                                     |
| :------------------------------- | :------ | :------------ | :--------------------------------------- |
| Parties see their quote requests | SELECT  | authenticated | The caller is the requester or the host. |

**No client write (Decision #458).** The former INSERT and UPDATE policies are gone. A shared UPDATE
could not tell which party moved which status, so a buyer could mark their own request `answered`
(reproduced on the shared DB before the change). Every write is a door in
[`00001177`](Functions.md#quote-requests-and-offers--00001177_functions_marketplace_quotessql), and
`trg_quote_requests_parties` still pins the parties and the blueprint against the doors themselves.

### `marketplace.quote_offers`

| Policy                         | Command | Roles         | Rule                                                 |
| :----------------------------- | :------ | :------------ | :--------------------------------------------------- |
| Parties see their quote offers | SELECT  | authenticated | The caller is the requester or the host of its request. |

No client write: the offer doors in 00001177 are the only way in. Both tables are verified by
execution in `supabase/probes/quote_offers.sql`: a direct insert answers `42501`, a buyer's
direct status update changes nothing, and a stranger reads neither table.
