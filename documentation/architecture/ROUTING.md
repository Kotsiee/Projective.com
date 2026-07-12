# Routing & Folder Conventions (`apps/web`)

> Companion to [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md) §2 and the sitemap in
> [`../business/PRODUCT_SPEC.md`](../business/PRODUCT_SPEC.md) §Sitemap. Fresh 2.x (Vite) file-based
> routing. This documents the skeleton that lives under `apps/web/routes/`.

## Route groups (URL-transparent)

Parenthesized folders group routes **without** adding a URL segment:

| Group                     | Purpose                                                                                      | Auth        |
| :------------------------ | :------------------------------------------------------------------------------------------- | :---------- |
| `routes/(public)/`        | Marketing + auth (landing, about, explore, help, view, login/register/…)                     | none        |
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
| nested `[id]`     | `projects/[projectId]/[stageId]/index.tsx` | `/projects/:projectId/:stageId` |
| `[...path]`       | `(public)/help/[...path].tsx`              | `/help/*` (catch-all)           |
| top-level dynamic | `[handle]/index.tsx`                       | `/:handle`                      |

## Reserved-handle precedence

Static routes win over `[handle]`. `/about`, `/explore`, `/login`, `/help/*`, `/view/*` resolve to
their `(public)` routes; anything else falls through to `/:handle`. Maintain a reserved-word
denylist in the profile resolver so a user cannot claim a handle that collides with a top-level
route.

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
