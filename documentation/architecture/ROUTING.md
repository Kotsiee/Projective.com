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
- `_layout.tsx` per group — shell chrome; `(dashboard)` mounts the dual-nav + Splitter.

## Dynamic segments (examples in the skeleton)

| Pattern           | File                                       | URL                             |
| :---------------- | :----------------------------------------- | :------------------------------ |
| `[id]`            | `projects/[projectId]/index.tsx`           | `/projects/:projectId`          |
| nested `[id]`     | `projects/[projectId]/[channelId]/index.tsx` | `/projects/:projectId/:channelId` |
| files (project)   | `projects/[projectId]/files.tsx`           | `/projects/:projectId/files` (File Explorer, all channels) |
| files (channel)   | `projects/[projectId]/[channelId]/files.tsx` | `/projects/:projectId/:channelId/files` (File Explorer, one channel) |
| attachments → files | `projects/[projectId]/attachments.tsx` (+ nested) | `/…/attachments` **308→** `/…/files` (legacy) |
| submissions (project) | `projects/[projectId]/submissions/[...path].tsx` | `/projects/:projectId/submissions/*` (Submissions ledger; Stages as tree roots; wildcard tree path) |
| submissions (channel) | `projects/[projectId]/[channelId]/submissions/[...path].tsx` | `/projects/:projectId/:channelId/submissions/*` (channel submissions; wildcard tree path) |
| calendar (project) | `projects/[projectId]/calendar.tsx`        | `/projects/:projectId/calendar` (Calendar & Schedule — whole engagement) |
| calendar (channel) | `projects/[projectId]/[channelId]/calendar.tsx` | `/projects/:projectId/:channelId/calendar` (channel/stage schedule; a stage channel scopes to that stage) |
| `[...path]`       | `(public)/help/[...path].tsx`              | `/help/*` (catch-all)           |
| top-level dynamic | `[handle]/index.tsx`                       | `/:handle` (profile Overview)   |
| profile tabs      | `[handle]/[tab].tsx`                        | `/:handle/:tab` (one dynamic route serves every entity-conditional tab — services · products · projects · portfolio · education · experience · teams · businesses · articles · reviews · members) |
| profile static    | `[handle]/availability.tsx`                | `/:handle/availability` (FULL-PAGE Availability calendar — its OWN layout, NOT the profile chrome; `_layout` special-cases the `availability` segment to bypass the header/tabs/meta-rail; a static sibling wins over `[tab]`) |
| profile item view | `[handle]/view/[item].tsx`                 | `/:handle/view/:id` (profile-scoped Explore item viewer) |
| entity view (public) | `(public)/view/[entity]/index.tsx`      | `/view/:id` (public Explore item viewer; was the flat `view/[entity].tsx`, now a dir to host the schedule leaf) |
| entity schedule   | `(public)/view/[entity]/schedule.tsx`      | `/view/:id/schedule` (session-based service schedule — recurring slots + attendee counts) |

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

  | Opened from…               | Channel kind                    | URL                                   |
  | :------------------------- | :------------------------------ | :------------------------------------ |
  | **the global `/messages`** | private / team message          | `/messages/[chat-id]`                 |
  | **within a project**       | any channel / DM (all four groups) | `/projects/[project-id]/[channel-id]` |

  Every row of a Project Details channel tree (General, Stages, Teams, Private Messages) routes into
  the **project namespace** via `channelHref(projectId, channelId)`
  (`apps/web/features/projects/core/chat-context.ts`); the destination page loads the thread by its
  shared `chatId`, so a project DM and the same person's global DM (`/messages/[chat-id]`) remain one
  continuous record.

  The channel view itself is a **nested-route tab set** under `[projectId]/[channelId]/`: the pinned
  `ChannelHeader` (`apps/web/features/projects/islands/ChannelHeader.island.tsx`, resolved per route by
  `channelHeaderFor` and mounted by the `(dashboard)` layout into the **middle-nav frame's header band**
  — `MiddleNav`'s `header` slot, flush against the lane) hosts contextual view tabs that each map to a
  segment — `chat` (also the index), `files`, `members`, and the format-gated `submissions` (pipeline ·
  one-off), `calendar` (session), and `tasks` (pipeline). Active-tab state is driven purely by the URL
  segment (`activeTabOf` in `core/channel-view.ts`), so deep-links and refreshes land on the right view. The former `/messages/[chatId]?project=…&scope=…` in-project addressing **and its
  "This project ⁄ Full history" scope switch are retired** (Decision #22) — the entry-point URL alone
  carries the project context now.

- **Submissions are a wildcard tree route** (root `CLAUDE.md` §8 **Decision #33**). Unlike the other
  single-segment tabs, `submissions` is a catch-all `[...path]` route in BOTH scopes — channel
  (`projects/[projectId]/[channelId]/submissions/[...path].tsx`) and project
  (`projects/[projectId]/submissions/[...path].tsx`, a static segment that precedes `[channelId]`, so it
  never shadows a real channel). The trailing `path` is the deliverable-tree node (stage → submitter →
  unit → directory) the interactive breadcrumbs + navigation tree address, so any node is a deep-linkable
  URL and the bare `…/submissions` matches with zero trailing segments (the `help/[...path].tsx`
  precedent). `activeTabOf` reads only the first segment after the channel base, so the header's
  Submissions tab stays active on deep paths. The footer View Control Rig + far-right **Review
  Submission** trigger is resolved by `submissionsFooterFor` (composed after `channelFooterFor` /
  `filesFooterFor` in the `(dashboard)` layout's single footer slot).

## Reserved-handle precedence

Static routes win over `[handle]`. `/about`, `/explore`, `/login`, `/help/*`, `/view/*` resolve to
their `(public)` routes; anything else falls through to `/:handle`.

The reserved-word denylist is **implemented** as the SSOT const + guard
**`RESERVED_HANDLES`/`isReservedHandle`** in [`@projective/types/profile`](../../packages/types/profile/reserved.ts)
(root `CLAUDE.md` §8 Decision #36). It is the second line of defence beyond Fresh's static-route
precedence: it stops a **bare** word with no static route (`/availability`, `/files`) from being
fabricated into a profile, and it is the rule a future "claim your handle" flow must validate
against. Both the fat `ProfileBackendService` (which fabricates the stub profile → returns 404 for a
reserved word) and the `routes/[handle]/_middleware.ts` (which resolves the profile onto
`ctx.state.profile`, `null` for a reserved/unresolved handle → the shared layout paints a calm
not-found, no profile chrome) read this one list, so the two never drift.

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
