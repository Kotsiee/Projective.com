# catalogue: Policies

Migration [`00002020_policies_catalogue.sql`](../../../supabase/migrations/00002020_policies_catalogue.sql)
(RLS enabled in `00002001`). The schema is exposed to PostgREST and `USAGE` is granted to `anon`
and `authenticated` (`00002500`); table grants are in `00002520` (SELECT to both; INSERT/UPDATE on
the three subject tables and INSERT/UPDATE/DELETE on the child tables to `authenticated`).

**The model, in one line: a PUBLISHED row is public, everything else is its owner's.**

| Table                  | Read                                                                                             | Write                                                                                          |
| :--------------------- | :----------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| `listings`             | `status = 'published'` to `anon` + `authenticated`; the owner (or an active member of the owning team) sees their own drafts, paused and archived rows. | INSERT / UPDATE by the owner, in their own name (`owner_user_id = auth.uid()` in every `WITH CHECK`), and a team-owned row only as an active team member. **No DELETE** — archive by status. |
| `products`             | Public when a PUBLISHED listing offers it (an `EXISTS` on `listings`); owners see their own.     | Same as listings.                                                                              |
| `articles`             | `status = 'published'`; authors see their own.                                                   | Same as listings.                                                                              |
| `listing_media`, `listing_skills`, `listing_tags`, `listing_availability` | Visible exactly when their listing is — an `EXISTS` on `listings`, whose own policy applies inside the subquery. | The listing's owner manages them (`FOR ALL` with a matching `WITH CHECK`). |
| `collections`, `collection_listings` | Owner only — there is no status saying a collection is public.                   | Owner only.                                                                                    |

Team membership reuses `org.is_active_team_member`, the helper every other team-scoped policy keys
on.

## The console writes through functions that run under these policies

The seller console does not write these tables row by row: `catalogue.create_listing`,
`save_listing` and `set_listing_status` ([Functions.md](Functions.md)) change a listing and its
product or service blueprint in one transaction. They are `SECURITY INVOKER`, so the policies above
remain the gate — the functions add the rules a row-level policy cannot express (a service needs a
freelancer profile; a listing publishes only with a title, a price and an image) and check each
subject UPDATE's row count, because an UPDATE RLS refuses matches nothing rather than raising. The
one definer, `get_listing_sales`, reads the buyers' order lines for the caller's own listings only.
All four are `EXECUTE`-granted to `authenticated` and `service_role`, never `anon`.

## Derived columns are not the owner's to write

The owner's UPDATE policy reaches every column of their row, including the ones the platform
computes: `rating_average` / `rating_count` (from reviews) and the listing's `view_count` /
`order_count`. `security.fn_guard_derived_columns` (attached by
`00001895_triggers_derived_columns.sql`) refuses any `anon` / `authenticated` write that changes one
of them, and any INSERT that starts one anywhere but zero, with `42501`. Definer functions, the
service role and the seed pass. Verified by execution: a seller PATCHing their product to
`rating_count = 50` is refused, a title edit on the same row succeeds.
