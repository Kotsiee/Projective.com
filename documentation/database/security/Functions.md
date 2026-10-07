# security: Functions

Context resolution + JWT claim stamping for the `security` schema. Other `security` functions
(penalty aggregation, admin checks) remain `_Not yet documented._` until their sections are written.

## Context switching & the access-token hook

These functions are the origin of **User Context Hydration** (root [`CLAUDE.md`](../../../CLAUDE.md)
Decisions #16/#17). `security.session_context` holds the acting context; the switch RPCs mutate it;
the access-token hook copies it into every issued JWT so both Row-Level Security and the web chrome
read one consistent source.

**The switches are the only writers of `security.session_context`** (rewritten 2026-09-28, migration
`00001001` §2, root `CLAUDE.md` §8 Decision #122). The table carries a SELECT-only client policy
([Policies.md](Policies.md)) and `ck_session_context_one_slot` makes a second active slot
unrepresentable. Every switch is `SECURITY DEFINER`, `SET search_path = ''`, refuses an anonymous
caller (`42501`), re-checks the membership it claims, and then **UPSERTS** through one shared writer
— a user with no row yet (nothing had seeded one) used to UPDATE zero rows, return success and stay
exactly where they were. `EXECUTE` on the four public switches is `authenticated` only (revoked from
`PUBLIC` and `anon`, `00002510`). Refusals are `42501 'context: …'` / `22023 'context: …'`.

### `security.fn_set_session_context(p_type, p_profile, p_team, p_org, p_audit_entity)` — internal

The shared writer: one upsert of all four slots (so every switch sets the slot it names and clears
the rest in one statement) plus a `session.switch_context` row in `security.audit_logs`. **Not
reachable by any client role** — it trusts its arguments, and every switch re-checks membership
before calling it.

### `security.switch_session_context(p_type public.profile_type, p_id uuid)`

A **freelancer** profile (the caller's own — `p_id` must be the caller's user id and a
`org.freelancer_profiles` row must exist) or a **business** the caller is an ACTIVE member of and
that is **not archived**. Anything else → `22023` ("choose a freelancer profile or a business").

### `security.switch_team_context(p_team_id uuid)` — new

A **team** the caller is an active member of and that is not archived. The hook always read
`active_team_id`; before this nothing wrote it (a team switch in the app returned a hard 501).

### `security.switch_organisation_context(p_org_id uuid)`

An **organisation** the caller owns or is an active member of (the buyer-only entity, Decisions
#9/#10). (Migration `20260715120000`; rewritten onto the shared writer 2026-09-28.)

### `security.clear_session_context()` — new

Back to **personal** (every slot `NULL`), for anybody — including a client with no freelancer
profile, who previously had no way home once they had switched into a business (returning to
personal meant `switch_session_context('freelancer', …)`, which raises without a freelancer
profile).

### `security.current_context()`

`STABLE` SQL helper reading the active-context claims back out of `auth.jwt()` —
`active_profile_type` / `active_profile_id` / `active_team_id` / `active_organisation_id` — for use
in RLS policies. These claims are only populated once the access-token hook below is enabled.
(Migration 0099; extended `20260715120000` to expose `active_organisation_id`.)

### `public.custom_access_token_hook(event jsonb) → jsonb`

The GoTrue **custom access token hook** (wired in `supabase/config.toml` under
`[auth.hook.custom_access_token]`). Runs before each access token is signed, resolves the acting
context from `security.session_context` (+ membership/handle lookups), and stamps two consumers into
the token's claims:

1. **Raw top-level claims** — `active_profile_type`, `active_profile_id`, `active_team_id`,
   `active_organisation_id` — the exact keys `security.current_context()` reads for RLS.
2. **`app_metadata.active_context`** — the resolved presentation object
   `{ type, id, role, handle, isClient, isFreelancer, onboarded, displayCurrency, locale }` the web
   app decodes for chrome (`@projective/types/auth` `ActiveContextClaim` / `resolveUserContext`).
   `type` is the four-context matrix (`personal` | `team` | `business` | `organisation`); `role`
   is `admin` for the owner and admin presets (the member row's derived `role`, maintained by
   `org.fn_member_role_sync`), else `member` — the chrome's coarse answer, while capability checks
   ask `org.fn_member_can` (since 2026-09-28; before it read a hard-coded
   `owner`/`admin`/`manager` role list plus an ownership check); `isClient`/`isFreelancer` are
   resolved authoritatively from `org.users_public.is_freelancer` / `is_operator` and the active
   context. `displayCurrency` + `locale` are read from `org.user_preferences`
   (`preferred_display_currency` / `locale`, defaulting to `GBP` / `en-GB` when no preferences row
   exists yet) so the very first SSR byte formats every money figure in the viewer's own currency —
   they ride this claim rather than a second one because a figure that paints in one currency and
   corrects itself after hydration is a worse failure than a stale symbol.

> **`onboarded` — the profile-existence claim.** `true` when `org.users_public` holds a row for the
> user, `false` when the hook looked and found none. It exists because a federated sign-up is
> authenticated the moment GoTrue returns and stays **profile-less** until `/join` calls
> `public.complete_onboarding` — `public.handle_new_user` cannot provision it, since OAuth supplies
> neither `username` nor `dob` and both columns are `NOT NULL`. Until the profile exists, every
> table that attributes a row to `org.users_public(user_id)` (`projects.projects`,
> `projects.tickets`, the `catalogue` tables) has a foreign key that cannot be satisfied, so a write
> fails on a constraint name rather than a sentence. Stamping the fact here is what lets
> `routes/(dashboard)/_middleware.ts` route those accounts back to finish **without a query on every
> authenticated request**.
>
> Because the hook returns the event unchanged on any error, a failure OMITS the claim rather than
> asserting an account is un-onboarded, and `resolveUserContext` treats an absent claim as
> `onboarded: true`. Only a confirmed `false` gates anything — a legacy or un-stamped token must
> never walk a fully set-up user back through onboarding. The hook re-runs on the **refresh** grant,
> so a profile created after a token was minted is picked up by one renewal (which is exactly what
> the guard does before acting on a `false`).

> **Presentation, never settlement.** `displayCurrency` selects a **formatting** target only. Every
> stored amount keeps its origin `(amount_minor, currency)`, and every settlement reproduces the
> `(fx_rate, fx_base, fx_as_of)` snapshot written on its own `finance.transactions` /
> `finance.escrows` row. Nothing in this hook — and nothing on any read path — rewrites a ledger
> amount.

> **A stored context is only a PREFERENCE** (2026-09-28). The hook honours `session_context` only
> while the membership it names still holds, re-checked at **every mint**: an organisation the user
> no longer owns or actively belongs to, a team they are no longer an active member of or that is
> archived, or a business likewise, is dropped — back to personal, raw claims included. So a member
> removed from a team, or a team archived, stops acting as it at the next token refresh instead of
> carrying the claim (and the RLS inputs `security.current_context()` reads) until they happen to
> switch.

`SECURITY DEFINER` (reads org/security tables past RLS), `SET search_path = ''` (fully-qualified
identifiers, hijack-hardened), and wrapped so it **never raises** — any failure returns the event
unchanged so a chrome-only claim can never break login. `EXECUTE` is granted only to
`supabase_auth_admin` and revoked from `authenticated`/`anon`/`public`. (Migration
`20260715120000`.)

> **Security boundary.** These claims decide chrome + feed RLS inputs; they are not themselves an
> access grant beyond what the RLS policies enforce. The web app treats the decoded
> `app_metadata.active_context` as a read-only visual guide (it decodes the JWT **unverified**), so
> a tampered client only changes what that browser draws — RLS and the `(dashboard)` guard remain
> the real gates.

---

## Route slugs — `security.mint_slug` and `security.fn_slug_guard`

Every public route on this platform addresses a row by an opaque, prefixed, immutable slug:
`prj-pkksys2xhd` (project), `stg-…`, `svc-…`, `ssn-…`, and `tkt-…` (a ticket, carried by the
`?tkv=` deep link rather than by a path segment). These two functions are the database half of
that contract; the format itself is stated once in `packages/types/slugs/slug.ts`.

They live in `security` rather than beside any one table because two schemas mint slugs across five
tables (`projects.projects`, `projects.project_stages`, `projects.tickets`, `projects.session_events`,
`marketplace.service_blueprints`), and a copy per table is a copy per table to keep in step.

| Function                       | Returns | Notes                                                        |
| :----------------------------- | :------ | :----------------------------------------------------------- |
| `security.mint_slug(p_prefix)` | text    | `VOLATILE`, `search_path = ''`. Prefix + 10 uniform symbols. |
| `security.fn_slug_guard()`     | trigger | `SECURITY DEFINER`, `search_path = ''`. `BEFORE INSERT OR UPDATE`; prefix arrives as `TG_ARGV[0]`. |

**`VOLATILE` is load-bearing.** `gen_random_bytes` is not stable, and a mislabelled `IMMUTABLE` or
`STABLE` would let the planner evaluate the call once and hand the same slug to every row of a
multi-row insert — which the unique index would then refuse, on a statement that looks correct.

**`% 32` is uniform** because 256 is a whole multiple of 32, which is why the alphabet excludes
exactly four characters (`0`, `1`, `i`, `l`) and lands on 32 rather than 31. One member of each
confusable group is dropped, not the whole group: `o` is unambiguous precisely because `0` is gone.
A 31-symbol alphabet would need rejection sampling, and the modulo written without it is silently
biased toward the first symbols — a biased address still routes, so nothing would ever report it.

**The trigger does two jobs, and the first is what lets the columns be `NOT NULL` with no
`DEFAULT`.** On INSERT it fills a slug nobody supplied, and a `BEFORE ROW` trigger runs before
constraints are checked, so the column never needs to be nullable or defaulted (verified by
execution, not assumed). On UPDATE it **raises** on any change to an existing slug rather than
silently pinning the old value: an ordinary write never mentions the column, so the only way to
reach the exception is to genuinely try to move an address — and absorbing that would let the caller
believe the write landed.

**Neither is callable over PostgREST.** `security` is an exposed schema and `CREATE FUNCTION` grants
`EXECUTE` to `PUBLIC` by default, so both are explicitly `REVOKE`d.

**`fn_slug_guard` is `SECURITY DEFINER`, and that is what makes the revoke survivable.** A TRIGGER
DOES NOT EXECUTE AS THE TABLE OWNER — this page said it did, and the guard was `SECURITY INVOKER` on
that reasoning. Postgres checks `EXECUTE` on a trigger **function** once, at `CREATE TRIGGER` time,
against the trigger's creator; the body then runs as the **invoking** role, so a call it makes to
another function is privilege-checked at runtime against whoever fired it. The guard calls
`security.mint_slug`, which is revoked — so every `INSERT` into a slugged table by `authenticated`
**or** `service_role` failed with `permission denied for function mint_slug`, raised from inside a
function the caller never named, on a statement mentioning no slug at all. Running the guard as its
owner breaks that cycle while handing no client role `EXECUTE`.

**Do not answer that error with a `GRANT`.** Granting `EXECUTE` on `mint_slug` makes
`POST /rpc/mint_slug` callable by anyone signed in, and by `anon`, which is precisely the surface the
`REVOKE` exists to remove. `slug.contract.test.ts` pins both halves: the guard must be a definer, and
no migration may grant the minter to a client role.

Definer is safe on this particular function because its body is closed: it touches no table, runs no
dynamic SQL, and takes exactly two inputs — `TG_ARGV[0]`, fixed at `CREATE TRIGGER` time and so
settable only by someone who already owns the table, and `NEW.slug`, which is compared and, when
`NULL`, overwritten. No value a caller can supply reaches the owner's privileges.

The triggers themselves are declared together in `00001890_triggers_slugs.sql` — one per slugged
table, adjacent on purpose. A table added without one fails loudly against `NOT NULL`; a trigger
given the **wrong prefix** would mint valid-looking addresses in another table's namespace, which is
the failure keeping the five declarations side by side is meant to make visible.

## Column guards (2026-09-23)

Two `BEFORE` trigger functions in [`00001001_functions_security_context.sql`](../../../supabase/migrations/00001001_functions_security_context.sql),
attached by [`00001895_triggers_derived_columns.sql`](../../../supabase/migrations/00001895_triggers_derived_columns.sql).
Both are deliberately **not** `SECURITY DEFINER`: they decide by `current_user`, the role executing
the statement. PostgREST runs a request as `anon` or `authenticated`; a definer function runs its
statements as its owner and the service role as `service_role` — so the rating trigger, the seed and
server-side jobs pass, and only a client write is judged. `EXECUTE` is revoked from `PUBLIC`.

### `security.fn_guard_derived_columns()` — trigger arguments: column names

`BEFORE INSERT OR UPDATE`. Refuses (`42501`) a client UPDATE that changes any named column, and a
client INSERT that does not start it **empty**. For the values the platform computes and the
owner's own-row policy would otherwise reach — a seller PATCHing their listing to
`rating_count = 900`, a member inserting a savings pot that already holds money.

"Empty" is decided by the value's JSON type, so one guard covers every column shape: a number must
start at `0`, a boolean at `false`, and anything else (text, a timestamp, an enum, a uuid) at
`NULL`.

| Trigger                          | Table                            | Guarded columns                                            |
| :------------------------------- | :------------------------------- | :--------------------------------------------------------- |
| `trg_service_blueprints_derived` | `marketplace.service_blueprints` | `rating_average`, `rating_count`                           |
| `trg_products_derived`           | `catalogue.products`             | `rating_average`, `rating_count`                           |
| `trg_listings_derived`           | `catalogue.listings`             | `rating_average`, `rating_count`, `view_count`, `order_count` |
| `trg_teams_derived`              | `org.teams`                      | `rating_average`, `rating_count`, `active_project_count`, `total_project_count`, `service_count`, `product_count`, `current_workload_intensity` |
| `trg_wallet_pots_derived` (`00001830`)   | `finance.wallet_pots`   | `balance_cents` |
| `trg_deposit_rules_derived` (`00001830`) | `finance.deposit_rules` | `failure_count`, `last_error` |
| `trg_basket_items_derived` (`00001830`)  | `finance.basket_items`  | `purchased_at`, `discount_amount_minor`, `discount_code`, `original_price_minor` — only checkout marks a line purchased, and only a definer discounts one |

A column a client must never set **at all**, not even on insert, belongs here. A column a client may
set once and never change (a row's parties, its owner) belongs in `fn_guard_immutable_columns`.

### `security.fn_guard_immutable_columns()` — trigger arguments: column names

`BEFORE UPDATE`. Refuses (`42501`) a client UPDATE that changes any named column, of any type — the
parties and subject of a row, which a policy cannot protect because it sees only the post-image.

| Trigger                      | Table                        | Guarded columns                                    |
| :--------------------------- | :--------------------------- | :------------------------------------------------- |
| `trg_quote_requests_parties` | `marketplace.quote_requests` | `requester_user_id`, `host_user_id`, `blueprint_id` |
| `trg_teams_immutable`        | `org.teams`                  | `owner_user_id`, `treasury_wallet_id`, `subscription_tier`, `slug`, `avatar_file_id`, `banner_file_id` (`member_limit` left with the column, 2026-09-28) |
| `trg_organisations_immutable` | `org.organisations`         | `owner_user_id`, `status`, `verification_level`, `handle`, `logo_file_id` |
| `trg_wallet_pots_immutable` (`00001830`)     | `finance.wallet_pots`     | `wallet_id`, `currency` |
| `trg_payment_methods_immutable` (`00001830`) | `finance.payment_methods` | `owner_type`, `owner_id`, `method_role`, `provider`, `external_ref`, `brand`, `last4`, `status` |
| `trg_saved_cards_immutable` (`00001830`)     | `finance.saved_cards`     | the owner, the instrument references, brand, last four, expiry, cardholder, BIN and creator |

The finance guards are attached in `00001830_triggers_finance.sql` beside that schema's other
triggers, and the full write posture they complete is in
[`../finance/Policies.md`](../finance/Policies.md#-column-guards-2026-09-23).

**The `org` audit (2026-09-23; updated 2026-09-28).** `org.users_public`, `org.freelancer_profiles`,
`org.business_profiles` and — since 2026-09-28 — `org.teams` carry no client write policy, so
nothing reaches them but a definer (a team is renamed through `org.update_workspace`, which checks
`edit_profile`). The team guards stay as **defence in depth**: a future policy that re-opens the
table must not re-open these columns with it. `org.organisations` keeps its owner/admin UPDATE policy
and so still genuinely needs its guard. Every writer of the guarded columns was checked and is
`SECURITY DEFINER` — `reviews.recalculate_entity_rating`, `projects.update_entity_project_counts`,
`projects.fn_sync_workload_intensity`, `org.create_workspace` and
`org.transfer_workspace_ownership` (formerly `org.create_team`), `org.save_profile`,
`org.set_profile_avatar`, and `public.create_organisation` (service role) — so no `INVOKER` trigger
maintains any of them on a client's behalf and the guards refuse only the client. Verified by
execution against the running database, as `authenticated`: a rename still succeeds, `save_profile`
still succeeds, and a forged rating, a counter, a plan tier, a member cap, a handle, an ownership
change (including an organisation admin naming themselves owner), a verification level, a status
and a borrowed picture are each refused with `42501`. The two client INSERT policies that would have
let those columns be set at birth were removed in the same change (`org/Policies.md`).

## Email verification tokens (2026-10-06)

### `security.issue_email_verification(p_email_id uuid) → text` — service role only

**Migration:** [`00001050_functions_org_emails.sql`](../../../supabase/migrations/00001050_functions_org_emails.sql)
§3 · `SECURITY DEFINER`, `SET search_path = ''` · **Grant:** `service_role` only — `REVOKE ALL` from
`PUBLIC`, `anon` and `authenticated` (`00002510`; `authenticated` holds `USAGE` on `security`, so the
revoke has to name it).

Mints a verification token for one `org.user_emails` row and returns the **raw** token, once, for the
mailer: 32 bytes from `extensions.gen_random_bytes` as hex (64 chars). Only its SHA-256 (hex) is
stored, in `org.email_verification_tokens`, with `expires_at = now() + 24 hours`
(`EMAIL_TOKEN_TTL_HOURS`); every earlier outstanding token for the address is expired first, so only
the newest link works. An unknown id raises `P0001 'email_not_found'`; an address that is **already
verified returns `NULL`** and issues nothing (there is nothing to prove — `EmailsBackendService`
answers that case itself before calling).

**Why `security`, and why no user id.** The service role holds `USAGE` on `security` and not on `org`,
so this is the one email function that lives here. It takes no identity on purpose: the app decodes
session JWTs without verifying them, so a service-role call must never trust a caller-supplied
identity — and it does not need to. The token is mailed to the row's OWN address and
`org.confirm_user_email` redeems it only for the row's OWN account (`token_wrong_account` otherwise),
so issuing one for someone else's row gains the issuer nothing. `EmailsBackendService` passes only an
id the caller's own token produced (`org.add_user_email`) or listed (`org.get_my_emails`). The rest of
the handshake is in [`../org/Functions.md`](../org/Functions.md#-email-addresses-00001050).
