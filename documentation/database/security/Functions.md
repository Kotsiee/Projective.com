# security: Functions

Context resolution + JWT claim stamping for the `security` schema. Other `security` functions
(penalty aggregation, admin checks) remain `_Not yet documented._` until their sections are written.

## Context switching & the access-token hook

These functions are the origin of **User Context Hydration** (root [`CLAUDE.md`](../../../CLAUDE.md)
Decisions #16/#17). `security.session_context` holds the acting context; the switch RPCs mutate it;
the access-token hook copies it into every issued JWT so both Row-Level Security and the web chrome
read one consistent source.

### `security.switch_session_context(p_type public.profile_type, p_id uuid)`

`SECURITY DEFINER`, granted to `authenticated`. Validates that the caller owns/actively belongs to
the target freelancer or business profile, then sets it as the active context and **clears the team
and organisation slots** so the four active slots stay mutually exclusive. Writes a
`session.switch_context` audit entry. (Migration 0100; extended `20260715120000` to clear
`active_organisation_id`.)

### `security.switch_organisation_context(p_org_id uuid)`

`SECURITY DEFINER`, granted to `authenticated`. Validates that the caller is the owner or an active
member of the organisation (the buyer-only entity, Decisions #9/#10), then sets it as the active
context and clears the profile/team slots. Writes a `session.switch_context` audit entry. (Migration
`20260715120000`.)

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
   collapses ownership/admin membership to `admin`, else `member`; `isClient`/`isFreelancer` are
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
