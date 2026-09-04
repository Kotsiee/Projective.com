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
   context.
   `displayCurrency` + `locale` are read from `org.user_preferences` (`preferred_display_currency` /
   `locale`, defaulting to `GBP` / `en-GB` when no preferences row exists yet) so the very first SSR
   byte formats every money figure in the viewer's own currency — they ride this claim rather than a
   second one because a figure that paints in one currency and corrects itself after hydration is a
   worse failure than a stale symbol.

> **`onboarded` — the profile-existence claim.** `true` when `org.users_public` holds a row for the
> user, `false` when the hook looked and found none. It exists because a federated sign-up is
> authenticated the moment GoTrue returns and stays **profile-less** until `/join` calls
> `public.complete_onboarding` — `public.handle_new_user` cannot provision it, since OAuth supplies
> neither `username` nor `dob` and both columns are `NOT NULL`. Until the profile exists, every table
> that attributes a row to `org.users_public(user_id)` (`projects.projects`, `projects.tickets`, the
> `catalogue` tables) has a foreign key that cannot be satisfied, so a write fails on a constraint
> name rather than a sentence. Stamping the fact here is what lets `routes/(dashboard)/_middleware.ts`
> route those accounts back to finish **without a query on every authenticated request**.
>
> Because the hook returns the event unchanged on any error, a failure OMITS the claim rather than
> asserting an account is un-onboarded, and `resolveUserContext` treats an absent claim as
> `onboarded: true`. Only a confirmed `false` gates anything — a legacy or un-stamped token must never
> walk a fully set-up user back through onboarding. The hook re-runs on the **refresh** grant, so a
> profile created after a token was minted is picked up by one renewal (which is exactly what the
> guard does before acting on a `false`).

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
