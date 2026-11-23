# catalogue: Policies

Migration [`00002020_policies_catalogue.sql`](../../../supabase/migrations/00002020_policies_catalogue.sql)
(RLS enabled in `00002001`). The schema is exposed to PostgREST and `USAGE` is granted to `anon`
and `authenticated` (`00002500`); table grants are in `00002520` (SELECT to both; INSERT/UPDATE on
the three subject tables and INSERT/UPDATE/DELETE on the child tables to `authenticated`).

**The model, in one line: a PUBLISHED row is public, everything else is its owner's.**

| Table                  | Read                                                                                             | Write                                                                                          |
| :--------------------- | :----------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| `listings`             | `status = 'published'` to `anon` + `authenticated`; the owner (or an active member of the owning team) sees their own drafts, paused and archived rows. | INSERT / UPDATE by the owner, in their own name (`owner_user_id = auth.uid()` in every `WITH CHECK`), and a team-owned row only as an active team member. An INSERT is a **draft** (`status = 'draft'` in its `WITH CHECK`, Decision #494); `status`, `published_at` and `promoted` never change by a client write (below). **No DELETE** — archive by status. |
| `products`             | Public when a PUBLISHED listing offers it (an `EXISTS` on `listings`); owners see their own.     | Same as listings.                                                                              |
| `articles`             | `status = 'published'`; authors see their own.                                                   | Same as listings, drafts only: a member article has no publish door yet, so no client publishes one (#494 (e)). |
| `listing_media`, `listing_skills`, `listing_tags` | Visible exactly when their listing is — an `EXISTS` on `listings`, whose own policy applies inside the subquery. | The listing's owner manages them (`FOR ALL` with a matching `WITH CHECK`). A media row's `WITH CHECK` also asks `catalogue.fn_listing_file_ok` of its file, rendition and poster, as `apply_listing_media` does, so a direct INSERT cannot name another person's file (#494 (A) 4). |
| `collections`, `collection_listings` | Owner only — there is no status saying a collection is public.                   | Owner only.                                                                                    |
| `entitlements` (Decision #488) | `authenticated` only (`anon` is revoked in `00002520`): the holder — the person (`holder_type = 'user' AND holder_id = auth.uid()`), or an active member of the holding team, business or enterprise. Deliberately not `finance.fn_owner_visible`, whose operator arm would let an admin session read, and the download route then stream, any buyer's purchase. | **None.** Written only by `finance.place_wallet_order`. |
| `product_versions` (Decision #488) | `authenticated` only: the product's seller (the creator, or an active member of the owning team), and whoever holds an entitlement to the version (an `EXISTS` on `entitlements`, whose policy applies inside). The manifest names no storage address. | **None.** Written by `fn_freeze_product_version` and stamped by `mark_product_version_ready`. |

The download route also checks that the **acting context is the holder** (ASSET §6 gate 4), so a
business member acting personally reads the business's entitlement under RLS but does not download it.
The `originals` bucket the files are streamed from has **no storage policy at all**
([../files/Storage.md](../files/Storage.md)).

Team membership reuses `org.is_active_team_member`, the helper every other team-scoped policy keys
on.

## The console writes through functions that run under these policies

The seller console does not write these tables row by row: `catalogue.create_listing`,
`save_listing`, `set_listing_status` / `set_listings_status`, `apply_listing_media` and
`duplicate_listing` ([Functions.md](Functions.md)) change a listing and its product or service
blueprint in one transaction. All but the publish door are `SECURITY INVOKER`, so the policies above
remain the gate — the functions add the rules a row-level policy cannot express (a service needs a
freelancer profile; a showcase file must be the seller's) and check each subject UPDATE's row count,
because an UPDATE RLS refuses matches nothing rather than raising. `set_listing_status` and
`set_listings_status` are definers (Decision #494 (B)): a client write to the lifecycle columns is
refused for every client role, the doors included, so the door that runs the publish gate — a title,
a price, a slot-1 image, a Pipeline's stage, a product's file to deliver — is the one that may move
them, and it keeps its own ownership check. The other definer, `get_listing_sales`, reads the buyers'
order lines for the caller's own listings only. All are `EXECUTE`-granted to `authenticated` and `service_role`, never
`anon`. The tag cap (`trg_listing_tags_max`) is a definer trigger, so a direct INSERT under the
owner policy is held to it too.

## Derived columns are not the owner's to write

The owner's UPDATE policy reaches every column of their row, including the ones the platform
computes: `rating_average` / `rating_count` (from reviews) and the listing's `view_count` /
`order_count`. `security.fn_guard_derived_columns` (attached by
`00001895_triggers_derived_columns.sql`) refuses any `anon` / `authenticated` write that changes one
of them, and any INSERT that starts one anywhere but zero, with `42501`. Definer functions, the
service role and the seed pass. Verified by execution: a seller PATCHing their product to
`rating_count = 50` is refused, a title edit on the same row succeeds. The definer that writes
`view_count` / `order_count` is `analytics.fn_rollup_listings` (MARKETPLACE SC5);
`supabase/probes/listing_view_events.sql` proves both halves: the rollup moves them, a seller's
direct `view_count` UPDATE is `42501`.

## Only the doors publish (Decision #494)

The same guards hold a listing's lifecycle. `published_at` and `promoted` are derived columns on
`catalogue.listings` (an INSERT starts them empty, an UPDATE may not move them), `status` is an
immutable column for a client (`security.fn_guard_immutable_columns`), and `is_published` is derived on
`marketplace.service_blueprints`; a member article's `status` and `published_at` are held the same
way. Each is `42501`. Only `set_listing_status` (and the account-lifecycle definers that pause,
restore and archive a person's listings) moves them, and only `marketplace.promote_listing` /
`stop_listing_promotion`, past the plan check, move `promoted`.

A published listing's own locks are held on the tables too, by `catalogue.trg_published_locks` and the
deferred `listing_media_keeps_cover` constraint trigger ([Functions.md](Functions.md)), so a direct
PATCH meets the refusal the editor gives: the currency once published (`22023` `currency`), the
questions' ids, order and kinds (`22023` `intake`), a live listing's delivery model (`22023`
`delivery_model`), its last cover and a Pipeline's last stage (`PG422`, #494 (d)). The owner policies
on `marketplace.service_blueprints` (`00002018`) are unchanged; the guards do the work.
`supabase/probes/catalogue_publish_locks.sql` §5–9 proves each refusal under a seller's JWT, and that
the doors still publish.
