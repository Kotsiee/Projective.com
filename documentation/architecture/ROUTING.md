# Routing & Folder Conventions (`apps/web`)

> Companion to [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md) §2 and the sitemap in
> [`../business/PRODUCT_SPEC.md`](../business/PRODUCT_SPEC.md) §Sitemap. Fresh 2.x (Vite) file-based
> routing. This documents the skeleton that lives under `apps/web/routes/`.

## Route groups (URL-transparent)

Parenthesized folders group routes **without** adding a URL segment:

| Group                     | Purpose                                                                                      | Auth        |
| :------------------------ | :------------------------------------------------------------------------------------------- | :---------- |
| `routes/(public)/`        | Marketing + auth (landing, about, explore, help, view, login/join/…)                         | none        |
| `routes/(public)/(auth)/` | Auth sub-group (own chrome later)                                                            | none        |
| `routes/(dashboard)/`     | Authenticated app (home, projects, business, teams, messages, wallet, settings, services, …) | **guarded** |
| `routes/[handle]/`        | Public profile namespace — users, teams, corporations by `@handle`                           | none        |

## Special files

- `routes/_app.tsx` — root `<html>` shell + pre-paint theme + corner-curve app frame.
- `routes/_middleware.ts` — global security headers (no auth).
- `routes/(dashboard)/_middleware.ts` — **auth guard** (skeleton: session-cookie check → `/login`;
  swap in real Supabase JWT verification via `@server/services`).
- `routes/(public)/(auth)/_middleware.ts` — the **inverse guard**: an already-authenticated visitor to
  `/login` or `/join` is returned to their captured `redirectTo` (or `/home`) instead of being asked
  to authenticate again or walked back through onboarding. `/join?oauth=…` is exempt — the OAuth
  callback signs a NEW identity in and then sends them there to create their profile.
- `_layout.tsx` per group — shell chrome; `(dashboard)` mounts the dual-nav + Splitter.

## Dynamic segments (examples in the skeleton)

| Pattern                 | File                                                         | URL                                                                                                                                                                                                                                                                           |
| :---------------------- | :----------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[id]`                  | `projects/[projectId]/index.tsx`                             | `/projects/:projectId` — a ROLE DISPATCHER, not one page. The client/owner gets the **Details** setup surface (its progress ladder in the middle-nav header band, its actions in the footer band); everybody else gets the member **dashboard** (updates · rooms · assignments · earnings). `viewerIsClient` is re-derived server-side, so the dispatch is authoritative rather than cosmetic. The public showcase moved to `/view/:id?type=projects`, which is where a stranger evaluating the engagement belongs. |
| project preview (owner) | `projects/[projectId]/preview.tsx`                           | `/projects/:projectId/preview` — the owner's Explore preview, currently a deliberate placeholder. Guarded TWICE server-side: a non-owner, and an owner whose required setup steps are outstanding, both get a 303 back to Details. The tab that leads here renders locked until then, and a control disabled in the interface but open at its URL is a gate that only holds for people who did not type the address. |
| project edit → details  | `projects/[projectId]/edit.tsx`                              | `/projects/:projectId/edit` **308→** `/projects/:projectId` (retired). The editor IS the Details half of the engagement page now, so there is one working address; the file stays so a bookmark or an old notification link still lands. |
| nested `[id]`           | `projects/[projectId]/[channelId]/index.tsx`                 | `/projects/:projectId/:channelId`                                                                                                                                                                                                                                             |
| files (project)         | `projects/[projectId]/files.tsx`                             | `/projects/:projectId/files` (File Explorer, all channels)                                                                                                                                                                                                                    |
| files (channel)         | `projects/[projectId]/[channelId]/files.tsx`                 | `/projects/:projectId/:channelId/files` (File Explorer, one channel)                                                                                                                                                                                                          |
| attachments → files     | `projects/[projectId]/attachments.tsx` (+ nested)            | `/…/attachments` **308→** `/…/files` (legacy)                                                                                                                                                                                                                                 |
| submissions (project)   | `projects/[projectId]/submissions/[...path].tsx`             | `/projects/:projectId/submissions/*` (Submissions ledger; Stages as tree roots; wildcard tree path)                                                                                                                                                                           |
| submissions (channel)   | `projects/[projectId]/[channelId]/submissions/[...path].tsx` | `/projects/:projectId/:channelId/submissions/*` (channel submissions; wildcard tree path)                                                                                                                                                                                     |
| calendar (project)      | `projects/[projectId]/calendar.tsx`                          | `/projects/:projectId/calendar` (Calendar & Schedule — whole engagement)                                                                                                                                                                                                      |
| calendar (channel)      | `projects/[projectId]/[channelId]/calendar.tsx`              | `/projects/:projectId/:channelId/calendar` (channel/stage schedule; a stage channel scopes to that stage)                                                                                                                                                                     |
| calendar hub (personal) | `(dashboard)/calendar/index.tsx`                             | `/calendar` (the acting account's own agenda — the UNION of the two rows above across every engagement, over its own working hours, call windows and booked leave. The body is the grid alone; the lane and both bands are resolved per-URL by `features/calendar/core/calendar-slots.tsx`. Read by `GET /api/scheduling/personal`, which is signed-in only and takes NO scope parameter: "whose calendar" is answered by the session, never by the caller) |
| files hub (root)        | `(dashboard)/files/index.tsx`                                | `/files` (personal/entity asset library — re-exports the wildcard below, so the root and a deep folder resolve through ONE code path)                                                                                                                                         |
| files hub (deep)        | `(dashboard)/files/[...path].tsx`                            | `/files/*` (any folder, at any depth — a real, deep-linkable, shareable URL the tree, the breadcrumbs and the address bar all address identically; each segment is percent-encoded INDEPENDENTLY, so a folder literally named `a/b` never reads back as the pair `["a","b"]`) |
| share link              | `(public)/share/[slug].tsx`                                  | `/share/:slug` (the public resolution of a read-only share link — the one files surface a stranger can reach)                                                                                                                                                                 |
| integrations            | `(dashboard)/settings/integrations/index.tsx`                | `/settings/integrations` (the connector console — the caller's stored authorizations, and the catalogue)                                                                                                                                                                      |
| `[...path]`             | `(public)/help/[...path].tsx`                                | `/help/*` (catch-all)                                                                                                                                                                                                                                                         |
| top-level dynamic       | `[handle]/index.tsx`                                         | `/:handle` (profile Overview)                                                                                                                                                                                                                                                 |
| profile tabs            | `[handle]/[tab].tsx`                                         | `/:handle/:tab` (one dynamic route serves every entity-conditional tab — services · products · projects · portfolio · education · experience · teams · businesses · articles · reviews · members)                                                                             |
| profile static          | `[handle]/availability.tsx`                                  | `/:handle/availability` (FULL-PAGE Availability calendar — its OWN layout, NOT the profile chrome; `_layout` special-cases the `availability` segment to bypass the header/tabs/meta-rail; a static sibling wins over `[tab]`)                                                |
| profile item view       | `[handle]/view/[item]/index.tsx`                             | `/:handle/view/:id` (profile-scoped Explore item viewer; was the flat `view/[item].tsx`, now a dir to host the schedule leaf)                                                                                                                                                 |
| profile entity schedule | `[handle]/view/[item]/schedule.tsx`                          | `/:handle/view/:id/schedule` (profile-scoped session schedule; `_layout` special-cases the `view` → `schedule` segment to a full-page calendar, bypassing the profile chrome, mirroring `availability`)                                                                       |
| entity view (public)    | `(public)/view/[entity]/index.tsx`                           | `/view/:id` (public Explore item viewer; was the flat `view/[entity].tsx`, now a dir to host the schedule leaf)                                                                                                                                                               |
| entity schedule         | `(public)/view/[entity]/schedule.tsx`                        | `/view/:id/schedule` (session-based service schedule — recurring slots + attendee counts; reached from the Entity View "Book a session" CTA for Session-format services)                                                                                                      |

## Global routing rules (canonical link shapes)

Two link shapes are **fixed platform-wide**; every route, island, and link builder must emit them.

- **User / entity profiles → `/[handle]`.** All profile links use the shortpath handle namespace
  (`/@handle`), **never** `/profile/[handle]`. This is root `CLAUDE.md` §8 **Decision #3** (the
  `@handle` entity identifier _is_ the route). Builder: `profileHref()`
  (`apps/web/features/projects/core/routing.ts`, mirrored in `explore/core/routing.ts`) — normalises
  a bare or `@`-prefixed handle to `/@handle`.
- **Conversations are addressed by their _entry surface_.** A thread keeps its stable `chatId` (so
  it stays **one continuous record** — `PRODUCT_SPEC.md` §Unified Messaging, Decision #21); only the
  **base path** changes with where it is opened (resolved 2026-07-16, Decisions #22 / #23):

  | Opened from…               | Channel kind                       | URL                                   |
  | :------------------------- | :--------------------------------- | :------------------------------------ |
  | **the global `/messages`** | private / team message             | `/messages/[chat-id]`                 |
  | **within a project**       | any channel / DM (all four groups) | `/projects/[project-id]/[channel-id]` |

  Every row of a Project Details channel tree (General, Stages, Teams, Private Messages) routes into
  the **project namespace** via `channelHref(projectId, channelId)`
  (`apps/web/features/projects/core/chat-context.ts`); the destination page loads the thread by its
  shared `chatId`, so a project DM and the same person's global DM (`/messages/[chat-id]`) remain
  one continuous record.

  The channel view itself is a **nested-route tab set** under `[projectId]/[channelId]/`: the pinned
  `ChannelHeader` (`apps/web/features/projects/islands/ChannelHeader.island.tsx`, resolved per route
  by `channelHeaderFor` and mounted by the `(dashboard)` layout into the **middle-nav frame's header
  band** — `MiddleNav`'s `header` slot, flush against the lane) hosts contextual view tabs that each
  map to a segment — `chat` (also the index), `files`, `members`, and the format-gated `submissions`
  (pipeline · one-off), `calendar` (session), and `tasks` (pipeline). Active-tab state is driven
  purely by the URL segment (`activeTabOf` in `core/channel-view.ts`), so deep-links and refreshes
  land on the right view. The former `/messages/[chatId]?project=…&scope=…` in-project addressing
  **and its "This project ⁄ Full history" scope switch are retired** (Decision #22) — the
  entry-point URL alone carries the project context now.

- **Submissions are a wildcard tree route** (root `CLAUDE.md` §8 **Decision #33**). Unlike the other
  single-segment tabs, `submissions` is a catch-all `[...path]` route in BOTH scopes — channel
  (`projects/[projectId]/[channelId]/submissions/[...path].tsx`) and project
  (`projects/[projectId]/submissions/[...path].tsx`, a static segment that precedes `[channelId]`,
  so it never shadows a real channel). The trailing `path` is the deliverable-tree node (stage →
  submitter → unit → directory) the interactive breadcrumbs + navigation tree address, so any node
  is a deep-linkable URL and the bare `…/submissions` matches with zero trailing segments (the
  `help/[...path].tsx` precedent). `activeTabOf` reads only the first segment after the channel
  base, so the header's Submissions tab stays active on deep paths. The footer View Control Rig +
  far-right **Review Submission** trigger is resolved by `submissionsFooterFor` (composed after
  `channelFooterFor` / `filesFooterFor` in the `(dashboard)` layout's single footer slot).

- **The asset hub `/files` is a wildcard tree route too**, and for the same reason: a folder must be
  a URL. `files/index.tsx` **re-exports** `files/[...path].tsx` rather than duplicating it, so
  `/files` and `/files/Brand/Logos` cannot drift in how they resolve. `AssetListPage.readOnly` is a
  fact about the LOCATION (a mounted project channel or a connected drive is browsable in place but
  managed where it lives), distinct from the per-asset `AssetItem.canManage` — the hub withholds the
  write affordances on a read-only location rather than offering them and refusing each attempt. Its
  lane, header band and footer rig are resolved by `filesLaneFor` / `filesHeaderFor` /
  `filesFooterFor`.

- **A share link is a capability URL, and `/share/[slug]` is the ONLY route that resolves one.** It
  lives in `(public)`, not `(dashboard)`: the recipient has no account, and a resolver behind a
  sign-in wall resolves nothing. Nothing in the handler reads the session, so a signed-in visitor
  and an anonymous one are treated identically — holding the opaque, server-minted slug is the
  entire test.

  **Every failure is one answer.** `resolveShare` collapses `not_found` · `expired` · `revoked` ·
  `exhausted` · a service failure into a single outcome at the SSR boundary, and the route renders
  the same body with the same words at the same **404** for all of them. A distinguishable failure
  confirms that a slug was real, which is the one bit an enumeration attack is probing for. The
  response carries `X-Robots-Tag: noindex, nofollow` (a share URL gets pasted somewhere public
  eventually) and `Referrer-Policy: no-referrer` (the slug is IN the path, so any `Referer` this
  page emits hands the credential to a third party) — and because of that second header the global
  `routes/_middleware.ts` **defaults** `referrer-policy` rather than setting it, so a route may
  harden it and nothing can silently lower it.

  The optional `?u=` is a **verification hint, not a credential**: an opaque, server-minted
  per-recipient reference used to attribute a download to the copy of the link that was actually
  opened. The slug alone resolves; a missing, stale or fabricated `u` changes nothing about whether
  the file is served. It is never a handle, a user id or an email — a share URL is forwarded and
  pasted into public places, and personal data must not travel in a query string.

- **The checkout is four routes, not four modes of one route.** Each step is its own file under
  `(dashboard)/checkout/`, which is what makes the browser's own Back button work through the flow and
  makes every step a link a buyer can be sent. It is also why the stepper is a row of real anchors
  rather than a controlled widget: the URL is already the state, and a second copy of it in a signal
  is a second thing that can be wrong. Builders: `checkoutStepHref()` / `basketHref()` /
  `checkoutHref()` in `apps/web/features/checkout/core/basket-model.ts` — never a hand-written path.

  | Step | File                                     | URL                      | Chrome (Part D.6) |
  | :--- | :--------------------------------------- | :----------------------- | :---------------- |
  | 1    | `(dashboard)/checkout/index.tsx`         | `/checkout`              | `full` — basket + the list explorer in the lane |
  | 2    | `(dashboard)/checkout/details.tsx`       | `/checkout/details`      | **`focus`** |
  | 3    | `(dashboard)/checkout/payment.tsx`       | `/checkout/payment`      | **`focus`** |
  | 4    | `(dashboard)/checkout/confirmation.tsx`  | `/checkout/confirmation` | `full` — restored, its job is to send the buyer onward |

  **`/basket` is retired to a `302`, and the file is kept.** `(dashboard)/basket/index.tsx` redirects
  to `/checkout` **preserving the query string** — `?basket=` and `?owner=` are load-bearing, and
  dropping them lands an entity buyer on their personal basket. It is not deleted (root `CLAUDE.md`
  §5 — nothing is hard-deleted) because the URL is reachable from the globally-mounted basket drawer
  and from persisted client state, so a 404 there is a dead end reachable from the header. It is a
  **302, not a 308**: a permanent redirect is cached by the browser indefinitely with no server-side
  way to invalidate it, and the flow's first step is still *called* "Basket", so the route may
  legitimately return. `isCheckoutPath()` keeps matching `/basket`, so the slot resolvers still claim
  it during the redirect hop.

  **Query params, all optional.** `?basket=` selects a named basket (a list is a named
  `finance.baskets` row, not a separate table); `?owner=` selects the acting principal's scope
  (`personal` · `team:{id}` · `business:{id}` · `organisation:{id}`); `?order=` names the order the
  confirmation resolves (absent → the account's most recent); `?project_id=` / `?service_id=` narrow
  the flow to one engagement; `?edit=1` on Details forces the form open. Dev Context Switcher axes
  travel as separate validated `sim*` params (`simOwnerScope` · `simProviders` · `simWalletCover` ·
  `simCards` · `simDetails` · `simBilling` · `simInvoicing` · `simSpendLimit` · `simFulfilment` ·
  `simConferencing`) and are ignored on the live path.

  **Two redirects govern the Details step, and one predicate governs both.** Details **auto-skips** to
  `/checkout/payment` when `canSkipDetails(session)` holds and `?edit=1` is absent; Payment **bounces
  back** to `/checkout/details` when `buyerDetailsComplete(session.buyer)` does not — a buyer who deep
  links past the form must be sent back, not shown a Pay button the server will refuse. Because both
  directions delegate to the same predicate (`@projective/types/finance/checkout`), they cannot
  disagree and produce a redirect loop. `?edit=1` is mandatory rather than polish: without it a buyer
  whose details are complete can never reach the form again, since every route into it redirects away.

  ⚠ **Both redirects are returned from `define.handlers`, never from `define.page`.** A `Response`
  returned from a page component is **dead code** — it is a render function, not a handler; the page
  renders anyway and nothing errors. Root `CLAUDE.md` §8 Decision #61 records a whole surface lost to
  exactly this.

## Reserved-handle precedence

Static routes win over `[handle]`. `/about`, `/explore`, `/login`, `/help/*`, `/view/*`, `/share/*`
resolve to their `(public)` routes; anything else falls through to `/:handle`.

**`files` and `share` are both in the denylist**, and each is there for a different reason, which is
why the denylist is not merely a duplicate of the route table:

- **`files`** has no `(public)` route at all — `/files` lives under `(dashboard)`, so a signed-out
  visitor asking for `/files` never meets a static route and would otherwise fall through to
  `/:handle` and be answered with a fabricated profile for a word that is a section of the product.
  The denylist is what makes that a 404 instead.
- **`share`** does have a static route, so precedence already covers `/share/abc`. It is denied
  anyway because precedence protects the PATH, not the NAME: without the entry, `@share` remains
  claimable as a handle, and a handle that shadows the one route on the platform that hands out read
  access to private files is a phishing primitive rather than a routing curiosity.

Both are enforced through the one SSOT guard (`isReservedHandle`), so a future "claim your handle"
flow validating against it inherits both without knowing why either is listed.

The reserved-word denylist is **implemented** as the SSOT const + guard
**`RESERVED_HANDLES`/`isReservedHandle`** in
[`@projective/types/profile`](../../packages/types/profile/reserved.ts) (root `CLAUDE.md` §8
Decision #36). It is the second line of defence beyond Fresh's static-route precedence: it stops a
**bare** word with no static route (`/availability`, `/files`) from being fabricated into a profile,
and it is the rule a future "claim your handle" flow must validate against. Both the fat
`ProfileBackendService` (which fabricates the stub profile → returns 404 for a reserved word) and
the `routes/[handle]/_middleware.ts` (which resolves the profile onto `ctx.state.profile`, `null`
for a reserved/unresolved handle → the shared layout paints a calm not-found, no profile chrome)
read this one list, so the two never drift.

## Thin controllers / fat services

Routes only parse + validate + guard, then delegate. The handler → service → `page(data)` pattern is
shown in `projects/[projectId]/index.tsx`. Islands never fetch — data is hydrated via props
(SYSTEM_ARCHITECTURE §State Hydration).

## Feature folders & islands

Route controllers may grow into `apps/web/features/[group]/[sub]/` (per PRODUCT_SPEC §Directory
Structure); `routes/` then re-exports them. Islands live in a `features/**/islands/` folder and are
auto-discovered by `vite.config.ts` (`discoverFeatureIslands` → `islandSpecifiers`). Example:
`features/dashboard/home/islands/WorkloadGauge.island.tsx`. Path aliases: `@web/*`, `@features/*`,
`@ui/*`, `@projective/ui`, `@server/services/*` — never `../../../` across boundaries.

## Aliases in use

`@web/` → `apps/web/` (routes import `@web/utils/state.ts`, `@web/components/…`). Declared in the
root `deno.json` import map alongside `@features/`, `@ui/`, `@server/services/`.
