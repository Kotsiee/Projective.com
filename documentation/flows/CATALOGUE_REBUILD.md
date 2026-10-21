# Catalogue Rebuild — Analysis & Implementation Plan

> **Status: PLAN, not binding.** This document plans the teardown and rebuild of the seller
> catalogue: `/catalogue` and the per-item workspace `/catalogue/[id]`. It was written against `main`
> @ `2eafa14` (2026-10-14). The work orders that build it are in
> [`CATALOGUE_REBUILD_BUILD_PROMPTS.md`](CATALOGUE_REBUILD_BUILD_PROMPTS.md). Where the brief
> contradicts a source document or a logged decision, this plan proposes an answer and does **not**
> choose a side. Every such point is listed in §2. Prompt C0 logs them as **Decision #217 (PROPOSED)** and
> stops until a human has ruled on each one (root `CLAUDE.md` §8).
>
> **Rulings (2026-10-14).** Decision #217 is **RESOLVED**. Every flag in §2 was accepted as
> proposed, except **m**: charts are not SVG-only, and escalate to Canvas2D by density. Under **i**,
> buyer download fulfilment is logged as an open gap. The §2 Ruling column records each answer.
>
> **What I read before writing this:**
> - The whole of `apps/web/features/catalogue/**`, its routes and `/api/catalogue/*`.
> - `packages/backend/services/catalogue/*`.
> - `packages/types/{catalogue,scheduling,services,explore}`.
> - Migrations `00000004`, `00000014`, `00000016`, `00000018`, `00000021`–`00000023`, `00001170`,
>   `00001175`, `00001500`–`00001520`, `00001600` and `00001650`.
> - The docs `database/{catalogue,scheduling,analytics}`, `flows/ServiceCreation.md`, the
>   `(dashboard)/_layout.tsx` slot ladder, `MiddleNav` / `MiddleNavPanel`, the profile `pf-showgrid`
>   (`MediaSection`), `AssetPicker` media mode, the explore `ServiceCard` / `ProductCard` and
>   `live-catalog.ts#assemble`, `resolveArchetype()`, the `/view/[entity]` controller, Projects
>   Quick-Init, `DESIGN_SYSTEM.md` §C.1 / §C.5, and the Dev Context Switcher.
> - Decisions #37, #45, #53, #56, #78–#80, #85, #88, #108/#109, #119, #124, #129, #133, #158, #179,
>   #192/#208, #195 and #209–#211.

---

## Contents

1. [Current system audit & teardown](#1-current-system-audit--teardown)
2. [Collisions you must rule on (Decision #217)](#2-collisions-you-must-rule-on-decision-217)
3. [Information architecture](#3-information-architecture)
4. [Component architecture & UX](#4-component-architecture--ux)
5. [The Rule-Based Availability Scheduler](#5-the-rule-based-availability-scheduler)
6. [Routing, middle-nav & state contracts](#6-routing-middle-nav--state-contracts)
7. [Zod contracts](#7-zod-contracts)
8. [Database strategy](#8-database-strategy)
9. [Services & routes](#9-services--routes)
10. [Dev Context Switcher, docs & tests](#10-dev-context-switcher-docs--tests)
11. [Risks](#11-risks)

---

## 1. Current system audit & teardown

### 1.1 What exists today

| Layer | Files | Shape |
| :-- | :-- | :-- |
| Routes | `routes/(dashboard)/catalogue/{index,[id]}.tsx` | Thin. `[id]` reads the listing by its `svc-` or `prd-` slug and sends a listing the seller does not own to `/catalogue` with a 303. |
| API | `routes/api/catalogue/{list,item,create,update,status}.ts` | Thin and Zod-validated. `status` runs the `refuseIfRestricted` age gate before publishing. |
| Service | `packages/backend/services/catalogue/{CatalogueBackendService,live-catalogue}.ts` | Fat (801 lines). Calls the RPCs `catalogue.create_listing`, `save_listing`, `set_listing_status` and `get_listing_sales`. After a write it runs `invalidateCatalog()` and `reembedInBackground`. |
| Types | `@projective/types/catalogue` (432 lines) | `ListingSummary`, `ListingDetail`, `ListingPricing`, `ListingAvailability`, the mutation inputs, and `resolveListingPricing` / `publishReadiness`. |
| Slots | `core/catalogue-{lane,header,footer}-slot.tsx` | Async URL resolvers in the `_layout.tsx` ladder. The catalogue registers no panel. |
| Islands | `CatalogueScreen`, `CatalogueLane`, `CatalogueHeader`, `CatalogueViewControlRig`, `CatalogueCreateModal`, `ListingEditor` (670 lines), `ListingHeader`, `ListingActionRig`, `CatalogueUnavailable` | Coupled through signals in `catalogue-state.ts`. |
| CSS | `styles/catalogue.css` (2,104 lines, `cat-` prefix) | One stylesheet for every catalogue surface. |
| Tests | `core/catalogue-model.test.ts` (7 tests) | Nothing covers the service, the routes, the SSR helpers, the slots or the islands. |

**No `/catalogue/new` exists** in code or docs. Creation is a modal followed by
`location.assign('/catalogue/{slug}')`, which already follows the Quick-Init pattern. The rebuild
keeps that and **locks it in with a test** (§6.1).

### 1.2 Critique

**Information architecture**
1. **One undifferentiated editor.** `ListingEditor` is a single two-column form. There are no
   Preview, Analytics or Clients modes, so a seller cannot see how a listing performs or who is
   buying it from the place where they manage it.
2. **Analytics stop at a KPI strip.** `AnalyticsStrip` shows five figures, and the lifetime `views`
   figure is never incremented: no function writes `catalogue.listings.view_count`. Nothing writes
   `analytics.daily_rollups`. There is no funnel, heatmap or keyword data.
3. **There is no client surface at all.** Inquiries, bookings, tickets and reschedules for a
   listing can only be reached through `/messages`, `/projects` and `/calendar`.
4. **The middle-nav is under-used.** The panel slot is unused. The footer holds only zoom and sort,
   with no batch operations. The header has no rollups beyond a count.

**Media**
5. **Raw URL entry.** The editor has a "Paste an image URL" input next to the picker
   (`ListingEditor` ~385–439). `save_listing` stores any URL that is not one of the project's own
   storage objects as `{url}` in `catalogue.listing_media`, which bypasses quarantine, sniffing and
   WebP tiering (Decision #119).
6. **No cover semantics, order or alt text.** `media` is a flat `string[]` capped at 24. Slot 0 is
   the cover only by convention. There is no reorder (a seller has to remove and re-add), no alt
   input (`alt=""`), no video, and `blueprint.cover_file_id` is never written.

**Forms**
7. **The forms do not branch on archetype.** Delivery-model branching is a handful of conditionals
   over numeric `InputText type="number"` fields. Columns that the buyer pages already render
   have **no editor**:
   - `stage_template`, `team_roles`, `deliverables`, `session_minutes` and `session_count`.
     `save_listing` does not write these either.
   - `intake_fields`. `ServiceCreation.md` §1.1 has been waiting for this editor since #108.
   - Product `licence`, `format` and `file_manifest`.
   - Call platforms.
8. **The availability editor is a toy.** It offers seven weekday toggles, one hour range and a
   timezone that cannot be edited (`"UTC"` fallback). It writes `catalogue.listing_availability`, a
   second availability model parallel to `scheduling.*` (Decision #56). The booking gate never
   reads it.
9. **SEO and CREATE are missing.** There are no meta title or description columns. `category` is
   free text, even though the `org.create_category` enum exists. Tags are not in the search fts
   (`search.sync_service_to_index` indexes only the title and `description_text`).

**Preview**
10. **The preview drifts.** The card preview uses the real `ServiceCard`, but feeds it from
    `buildPreviewItem()`, a hand-written duplicate of the backend's `live-catalog.ts#assemble`
    mapping. The two will drift. The "View public page" link opens a new tab and shows nothing for a
    draft, because `/view` reads published listings only.

**Design-system gates** (§3)
11. Literal values throughout `catalogue.css`:
    - About 40 literal `font-size` values and 26 literal `font-weight: 600`, with no
      `--text-*` / `--fw-*` tokens.
    - Raw px dots and borders, and px column tracks.
    - Ad-hoc breakpoints (900 px, 620 px) that match no `--bp-*` value.
    - `transition: all`.
    - Literal `color-mix` percentages instead of `--tint-*`.
12. Every catalogue `:focus-visible` rule sets `outline: none; box-shadow: none` and draws nothing
    in its place, so keyboard focus is invisible. This fails §3 gate 2.
13. **Labelling (WCAG 2.5.3).** Editor fields wrap a `<label>` and also set a different
    `aria-label` (for example "Title" against "Listing title"). A `Select` is wrapped in a `<label>`
    it cannot take. Weekday toggles announce "Toggle day 0".
14. **BEM leaks.** `.cat-lane__models` is used inside `.cat-filter`. `.cat-field-row > .cat-field`
    is a child combinator across blocks. There are two inline `style=` attributes for
    virtualisation (`ListingTable` :118, :132) and hard-coded magic numbers kept in sync with the
    CSS (`GRID_GAP = 16`, `CARD_BODY = 116`).

**Robustness**
15. Autosave fires 800 ms after the last change, with no flush on `pagehide` and no optimistic
    concurrency check, so two tabs silently overwrite each other.
16. "Duplicate" creates a listing titled `"(copy)"` and copies nothing else.

### 1.3 File disposition

**R** = retire (delete in the prompt named). **X** = restructure (rewrite in place, same
responsibility). **K** = keep (light edits).

| File | Fate | Prompt | Notes |
| :-- | :-: | :-: | :-- |
| `islands/ListingEditor.island.tsx` | R | C12 | Replaced by `ListingWorkspace` and its tab islands. |
| `islands/CatalogueScreen.island.tsx` | X | C11 | Becomes `CatalogueConsole.island.tsx`, a router for the three views. |
| `islands/CatalogueLane.island.tsx` | X | C11 | Same lane, plus the CREATE and model facets, selection-aware; on `[id]` Back and every listing (the sections are the Edit canvas's rail, #309). |
| `islands/CatalogueHeader.island.tsx` | X | C11 | Header band with the rollups and the view switch. |
| `islands/CatalogueViewControlRig.island.tsx` | X | C11 | Footer: zoom and sort, which becomes the batch bar while a selection exists. |
| `islands/CatalogueCreateModal.island.tsx` | X | C11 | Kept. Adds the archetype picker, CREATE category and currency; lands on `?tab=edit&section=media`. |
| `islands/ListingHeader.island.tsx` | X | C12 | Header band: title, lifecycle status and the four tabs (the save state moved to the footer, #304). |
| `islands/ListingActionRig.island.tsx` | X | C12 | Footer: save status, icon-only lifecycle actions and the locked/open Publish (#304). |
| `islands/CatalogueUnavailable.island.tsx` | K | — | — |
| `components/ListingCard.tsx` | X | C11 | Adds a selection affordance and moves to tokens. |
| `components/ListingTable.tsx` | X | C11 | The inline `style=` becomes `--cat-vs-*` custom properties set from a ref. |
| `components/ListingLaneRow.tsx`, `CatalogueRail.tsx`, `CatalogueFilterPanel.tsx` | X | C11 | BEM fixes; `listingHref` in place of literals. |
| `components/AnalyticsStrip.tsx` | R | C15 | Replaced by `CatalogueRollups` (header) and `AnalyticsCanvas`. |
| `components/catalogue-glyphs.tsx` | X | C11 | Keep only glyphs missing from `@projective/ui/icons`; the rest go to `Icon(...)`. |
| `core/catalogue-model.ts` | X | C11 | `buildPreviewItem` is deleted in favour of the shared adapter (§4.6). |
| `core/catalogue-state.ts` | R | C11/C12 | Split into `console-store.ts` and `workspace-store.ts` (§6.4). |
| `core/catalogue-ssr.ts`, `core/*-slot.tsx` | X | C11/C12 | New `catalogue-panel-slot.tsx`. The slots read the URL contract (§6.2). |
| `styles/catalogue.css` | R | C11–C16 | Split per block (§4.8). Token-only. |
| `catalogue.listing_availability` (table) and `ListingAvailabilitySchema` | R | C3/C4 | Replaced by scheduling presets bound to the blueprint (§5, flag **c**). |
| `ListingDetail.media: string[]` | X | C1/C3 | Becomes `ListingMediaSlot[]` (6 slots). |
| `features/profile/components/edit/MediaSection.tsx` + `pf-showgrid` CSS | X | C9 | Migrates to the shared `ShowcaseGrid` so the grid has one implementation. |
| `features/wallet/core/chart-geometry.ts`, `components/FlowAreaChart.tsx` | X | C9 | Geometry moves to `@projective/ui/display/charts`; the wallet re-imports it. |

---

## 2. Collisions you must rule on (Decision #217)

| | Collision | Proposal | Ruling (2026-10-14) |
| :-- | :-- | :-- | :-- |
| **a** | **Delivery-model vocabulary.** The brief lists `pipeline`, `one_off`, `session`, `cohort` and `product`. The real enum `marketplace.service_delivery_model` is `pipeline`, `one_off`, `direct_deliverable`, `session` and `group_session`; products are `catalogue.listing_kind = 'product'`. | **Never fork the enum.** Form archetypes come from the existing `resolveArchetype()` mapping: `direct_deliverable` uses the `one_off` form plus a Team-roles section; `group_session` uses the `cohort` form. One pure `formArchetypeOf(kind, serviceType)` in `@projective/types/catalogue`. | **Accepted.** |
| **b** | **Decision #53** says the deep analytics dashboard is "a separate future surface". It also gives the catalogue its own bespoke availability editor (`listing_availability`). | **Amend #53.** Analytics and Clients become tabs and views of the catalogue. Availability moves to scheduling presets (c). | **Accepted:** #53 amended. |
| **c** | **Per-service availability vs one schedule per owner.** `scheduling.schedules` is `UNIQUE (owner_type, owner_id)`, and `listing_availability` is a parallel model the booking gate never reads. | **Presets under the owner's schedule.** `scheduling.availability_presets` is a set of named rule sets. A blueprint binds one with `availability_preset_id` (NULL means the schedule's default). "Override" forks a service-scoped preset (`blueprint_id` set). `listing_availability` is removed in place. | **Accepted.** |
| **d** | **Recurrence authority.** The booking gate predicates (`fn_band_covers`, `fn_slot_is_free`) understand only weekday bands. RRULE expansion in SQL would be a second implementation of the evaluator. | **One evaluator, in TypeScript** (`@projective/types/scheduling/evaluate.ts`, pure). The service compiles each preset into `scheduling.availability_occurrences` (timestamptz spans, rolling 120-day horizon) through a service-role door. A pg_cron job extends the horizon nightly (#203 registry). The gate reads occurrences when the target blueprint is bound to a preset, and weekday bands otherwise. **Discovery calls and `/[handle]/availability` stay on weekly bands for now.** The default preset's weekly-expressible rules are mirrored into `availability_rules` so they keep working. Retiring the weekly model is a follow-up. | **Accepted.** The weekly model stays for discovery calls and `/[handle]/availability`. |
| **e** | **Media.** The brief asks for 6 slots, files only, and video in slots 2–6. Today there are 24, URLs are allowed, and positions start at 0. | `catalogue.listing_media` is edited in place: `position` 1–6, `file_id NOT NULL`, the `url` column dropped, and `kind` (`image` / `video`), `rendition_file_id` and `poster_file_id` added. Slot 1 must be an image and is mirrored to `service_blueprints.cover_file_id`. **Seeds and fixtures with more than 6 items or URL media are rewritten** (`db:seed:generate`). | **Accepted.** |
| **f** | **Search tags.** The brief says at most 10; today's schema allows 24, and tags are not in fts or embeddings. | Cap at **10** (Zod and a DB CHECK through a count trigger). Tags go into `services_index` / `catalogue_index` fts at weight B, and into the embedding input text, which `reembedInBackground` already re-runs on save. | **Accepted.** |
| **g** | **Inquiries cannot be tied to a listing.** `comms.dm_threads` has no subject column, so "New inquiries for this item" cannot be answered. | Add `subject_listing_id uuid NULL → catalogue.listings` to `dm_threads` in place, with `CHECK (subject_listing_id IS NULL OR kind = 'service_inquiry')`. The `/view` Contact path sets it. | **Accepted.** |
| **h** | **"Standing Impact"** has no definition in `PRODUCT_SPEC.md`. | Proposal: the number of reviews and completions this listing contributed to the seller's Standing (`org/standing.ts`) in the listing's CREATE category over the window, shown as a count with a direction, **not** a fabricated score. A human confirms the definition, or the tile is dropped. | **Accepted:** this definition stands; the tile stays. |
| **i** | **Product licences.** `catalogue.products.licence` is free text with the default `'standard'`. The brief asks for "commercial / personal". Delivering files to a buyer after purchase is not specified anywhere I could find. | Constrain `licence` with a CHECK to `personal`, `commercial` or `extended`, and rewrite existing `standard` rows to `personal`. The workspace **attaches** library files and ZIP bundles to `file_manifest`. **Buyer fulfilment is out of scope** and must be confirmed as already shipped or logged as a gap. | **Accepted.** Fulfilment is **logged as a gap**: `finance.place_wallet_order` (`00001210`) writes the download order line without `asset_id`, so every bought product shows "The seller hasn't attached the files yet". No C-prompt closes it. |
| **j** | **The Preview tab and §3.11** ("a control that renders must do something"). An owner previewing their own listing must not be able to buy it. | `/catalogue/[id]/simulate` renders the real `EntityViewPage` in **simulation mode**, framed in an `<iframe>` so the real `--bp-*` breakpoints apply for the desktop and mobile toggle. Every CTA opens its real modal; the commit button says "Simulated: nothing is booked or charged" and shows the would-be outcome. It never posts. | **Accepted.** |
| **k** | **Analytics privacy.** The brief asks for "keyword impressions" and per-item booking heatmaps. | Aggregates only, never a buyer-level trail. A keyword row is shown only when it comes from **5 or more distinct sessions** (k-anonymity), and a rate is shown only from **20 or more** in its denominator. Views are recorded in `search.interest_events`, with `'view'` added to its `event_type` CHECK in place and one view per session per listing per day. | **Accepted:** 5 and 20. |
| **l** | **`?scope=` semantics.** | `?scope=` is only meaningful on `/catalogue` (`all`, `product`, `service`, `model:<delivery>` or `collection:<slug>`). A listing slug passed as scope gets a **303 to `/catalogue/<slug>?tab=…`**, so per-item analytics and clients have one home and are moved, never duplicated. | **Accepted.** |
| **m** | **Charts.** `@projective/ui` has no chart components. `DESIGN_SYSTEM.md` §C.5 resolves the engine as "D3 (SVG/math) → Canvas2D → PIXI". The wallet has a private `FlowAreaChart`. | Promote it to `@projective/ui/display` charts (`AreaChart`, `FunnelChart`, `HeatmapGrid`, `Sparkline`, `StatTile`), SVG tier only, built on the `d3-scale` / `d3-shape` packages already pinned. That is math only and consistent with the zero-UI-library rule. Update the §C.1 roster. | **Accepted, amended: not SVG-only.** Charts follow the tiered engine of #1 / §C.5. They render SVG at low density and escalate to Canvas2D when the data or geometry would cost frame budget (entity-count threshold plus measured frame budget, colours through the `theme-bridge`). Still no chart library: d3 math plus native Canvas2D. |

These need no ruling, because they follow existing rules:
- The brief's "metric cards" are **unboxed stat tiles** (§3.6).
- Lifecycle status chips are a permitted container; everything else is middot meta (§3.7).
- Client-pipeline lanes are **derived groupings over existing statuses**, not new statuses (§5).
- Presets are archived, never deleted.
- Minors (#208): the scheduler and publish controls are hidden, with one `InlineNotice`.

---

## 3. Information architecture

### 3.1 `/catalogue`: global console

```
┌ Lane ─────────────┬ Header band ──────────────────────────────────────────┬ Panel ─────────┐
│ STATUS            │ Catalogue           ⟨Listings|Analytics|   $4,820 ▲12%  │ (docked ≥1280) │
│  ◉ Published    9 │ 9 of 14 live · 4.8   Clients⟩    Gross · 30 days  …  │ Client drawer  │
│  ✎ Drafts       2 ├───────────────────────────────────────────────────────┤ when ?client=  │
│  ⏸ Paused       1 │ ⟪All ▾⟫ [Search…] 12 listings      ⟨Sort⟩ [+ New]    │                │
│  ▣ Archived     2 │ ↑ sticky .fx-toolbar                                   │                │
│ HIGHLIGHTS …      │ Main canvas: ?view=listings → grid/table               │                │
│ DELIVERY MODEL …  │              ?view=analytics → AnalyticsCanvas         │                │
│ CREATE CATEGORY … ├───────────────────────────────────────────────────────┤                │
│ ◫  [+ New ▾]      │ Footer: zoom  ⇄  batch bar (n selected)                │                │
└───────────────────┴───────────────────────────────────────────────────────┴────────────────┘
```

- **Lane** (Decision #221: no head; the type moved to the toolbar).
  - Collapsible facet sections in the section-header register: Status, Highlights (needs
    attention, promoted, best-selling), Delivery model (services only) and CREATE category
    (`org.create_category`). Each row is its glyph (the CREATE glyphs are the `category-*`
    icons), its label, its count as plain `tabular-nums` meta text (Decision #220 — the §B.6.2
    facet exception, from `CataloguePage.facetCounts`) and a `SelectionCheck` while on.
  - Status, Delivery model and CREATE category are **multi-select** on the file explorer's model
    (`core/facet-select.ts`): a press selects only that row (pressed again, the facet returns to its
    default), Ctrl/Cmd toggles one row, Shift selects the run from the last row pressed,
    Ctrl/Cmd+Shift adds that run. Status opens on Published · Drafts · Paused (Archived off);
    its header action is Reset, the others' Clear. Highlights combine as before.
  - The collapse toggle and the quick-create menu in the lane footer.
- **Header band** (`.cat-band`, shared with the workspace): identity at the start, the view
  switch centred, the sales figures at the end.
  - Title over the catalogue's health (`CatalogueHealth`): "9 of 14 live · Rated 4.8", inline
    middot meta text.
  - The view switch (`TabMenu`, centred, 2px `::after` underline on the band's hairline).
  - `CatalogueSales`: gross volume over the window (with its change), orders and conversion, each
    a `tabular-nums` figure over its label, unboxed (a `<dl>`, never tiles — the tiles live in the
    Analytics view). Below a 64rem band only gross stays; below 48rem the group goes.
- **Toolbar** (`CatalogueToolbar`, the shared sticky `.fx-toolbar` of the File, Submissions and
  Members explorers, pinned under the band): on Listings the search docked at the start; at the end
  the type as a bare `Select` (every view) directly beside the sort (Listings); New listing below
  `--bp-md`. No visible count; the match count is a visually hidden `role="status"` (Decision #309).
- **Canvas.** `?view=listings|analytics|clients`.
- **Footer band.** Zoom. While a selection exists it becomes the batch bar: Publish, Pause,
  Archive, Delete (while any selected listing has no buyer history), Add to collection, Duplicate,
  and Clear. Archive and Delete confirm first (`ListingRemovalDialog`), each worded for what it does.
- **Removal** (Decision #221). Archive is a status and always available; Delete is
  `DELETE /api/catalogue/item?id=` → `catalogue.delete_listing`, offered (card menu, batch bar,
  workspace rig) only when `ListingSummary.deletable` — the viewer created it and
  `catalogue.get_listing_engagement` counts no buyer history — and refused `409` otherwise.
- **Panel.** The client drawer (`?client=@handle`) on `view=clients`. Nothing on the other views.

### 3.2 `/catalogue/[id]`: item workspace

```
┌ Lane ─────────────┬ Header band ─────────────────────────────────────────┬ Panel ──────────┐
│ ← Back            │ Brand identity sprint                      ◔ 60% (◫) │ Edit tab:       │
│ (every listing,   │ [Draft]                  ⟨Edit|Preview|Analytics|…⟩  │  Live card      │
│  current marked)  ├──────────────────────────────────────────────────────┤  (real          │
│                   │ Edit: ┃ Basics    Basics · [Media showcase 3×2,      │   ServiceCard)  │
│                   │         Media       slot 1 = cover] · Offer          │  Readiness ✓✓✗  │
│                   │         Offer       (archetype) · Pricing · …        │ Clients tab:    │
│                   │         …           (sticky section rail, #309)      │  client drawer  │
│                   ├──────────────────────────────────────────────────────┤                 │
│                   │ Footer: ● save state · ◯◯◯◯ icon actions · Publish   │                 │
└───────────────────┴──────────────────────────────────────────────────────┴─────────────────┘
```

The header band's tabs lead with their glyphs, and a draft carries the publish checklist's progress
ring before the Card toggle: a Tooltip of what is left, a press to the section that fixes the first
missing line (Decision #310).

| Tab | Canvas | Panel (docked ≥1280; a `Drawer` from a header button below that) |
| :-- | :-- | :-- |
| `edit` | Basics first, then the media showcase, then archetype-driven sections (§4.3; Decision #304), beside the sticky `EditSectionNav` rail, laid out as the project setup shell: the rail flush at the start, the stack centred at 44rem (a scrolling tab strip below a 52rem canvas; Decisions #309, #310). | Live feed card and publish-readiness list. |
| `preview` | `<iframe src="/catalogue/[id]/simulate?device=">` with a device toggle. | None; the canvas takes the full width. |
| `analytics` | Per-item tiles, funnel, revenue area, keyword table, booking heatmap (sessions), churn. An empty window still draws every chart (axes, gridlines, zero baseline) under a centred `InlineNotice`; a failed read never does (Decision #220). | None. |
| `clients` | This listing's pipeline lanes. | Client drawer (`?client=@handle`). |

---

## 4. Component architecture & UX

### 4.1 Console hierarchy

```
routes/(dashboard)/catalogue/index.tsx            → re-exports features/catalogue/routes/console.tsx
features/catalogue/
  routes/console.tsx                               thin controller: parseConsoleUrl → SSR read → <CatalogueConsole/>
  islands/CatalogueConsole.island.tsx              view router (listings | analytics | clients)
    components/listings/ListingsGrid.tsx           VirtualGrid of ListingCard (selection-aware)
    components/listings/ListingsTable.tsx          virtual table (zoom < threshold)
    components/analytics/AnalyticsCanvas.tsx       shared with the workspace (scope prop)
    components/clients/ClientPipelineBoard.tsx     shared with the workspace (scope prop)
  islands/CatalogueLane.island.tsx                 facets + sections + quick-create
  islands/CatalogueHeader.island.tsx               title · search · CatalogueRollups · view TabMenu
  islands/CatalogueFooterRig.island.tsx            zoom/sort ⇄ BatchBar
  islands/CatalogueCreateModal.island.tsx          Quick-Init (no /catalogue/new)
  islands/ClientDrawer.island.tsx                  MiddleNavPanel body / <Drawer> below 1280
```

### 4.2 Workspace hierarchy

```
routes/(dashboard)/catalogue/[id].tsx               → features/catalogue/routes/workspace.tsx
routes/(dashboard)/catalogue/[id]/simulate.tsx      → features/catalogue/routes/simulate.tsx (chrome:"bare")
features/catalogue/
  islands/ListingWorkspace.island.tsx               tab router; owns workspace-store hydration
    edit/EditCanvas.tsx                             section rail + stack + scroll-spy → `?section=`
      edit/MediaShowcaseSection.tsx                 ShowcaseGrid + MediaCropPicker (§4.4)
      edit/BasicsSection.tsx                        title · RichTextEditor · CREATE category · skills
      edit/offer/ProductOffer.tsx                   format · licence · attribution · AttachmentList
      edit/offer/OneOffOffer.tsx                    MilestoneEditor · TurnaroundSlider · ScopeChecklist · revisions
      edit/offer/PipelineOffer.tsx                  StageBlueprintEditor (sequence · price · roles · trigger)
      edit/offer/SessionOffer.tsx                   FormatToggle (solo|cohort) · DurationPicker · count · seats · provider
      edit/offer/TeamRolesEditor.tsx                Direct Deliverable only
      edit/PricingSection.tsx                       archetype-aware money fields (NumberInput + MONEY_FIELD)
      edit/AvailabilitySection.tsx                  PresetBinding + <AvailabilityScheduler/> (sessions only)
      edit/IntakeSection.tsx                        IntakeBuilder (≤12, ids immutable after publish)
      edit/SeoSection.tsx                           SerpPreview · meta title/description · TagCombobox (≤10)
    preview/PreviewCanvas.tsx                       device toggle + iframe + reload-on-saved
    analytics/AnalyticsCanvas.tsx (shared)
    clients/ClientPipelineBoard.tsx (shared)
  islands/ListingHeader.island.tsx                  title · status · centred TabMenu · Card icon toggle
  islands/ListingActionRig.island.tsx               save status · icon-only lifecycle actions · Publish (lock + missing list)
  islands/ListingInspector.island.tsx               panel body: LiveCardPreview + ReadinessList | ClientDrawer
```

### 4.3 Archetype → section matrix

`formArchetypeOf(kind, serviceType)` maps `product`, `Pipeline`, `One-Off`, `Direct Deliverable`,
`Session` and `Group Session` to the five form archetypes `product`, `pipeline`, `one_off`,
`session` and `cohort`. Direct Deliverable uses the `one_off` form and adds Team roles.

| Section | product | one_off (+direct) | pipeline | session | cohort | Writes |
| :-- | :-: | :-: | :-: | :-: | :-: | :-- |
| Basics (title, CREATE, delivery model, description, skills — #305) | ● | ● | ● | ● | ● | `listings.*`, `listing_skills`, `create_category` |
| Media showcase | ● | ● | ● | ● | ● | `catalogue.listing_media`, `blueprint.cover_file_id` |
| Format, licence, attribution, attachments | ● | | | | | `products.format`, `licence`, `attribution_required`, `file_manifest` |
| Milestones (StageFlow showcase, #45) | | ● | | | | `blueprint.stage_template` |
| Turnaround (`MilestoneSlider`) | | ● | per stage | | | `blueprint.turnaround_days` (new) |
| Scope checklist | | ● | per stage | | | `blueprint.deliverables` |
| Team roles | | direct only | ● | | | `blueprint.team_roles` |
| Stage blueprint (sequence, price, roles, trigger, chain) | | | ● | | | `blueprint.stage_template` (extended, §7.1) |
| Revisions (free and extra price) | | ● | ● (per stage) | | | `listings.free_revisions`, `extra_revision_price_cents` |
| Format toggle (solo or cohort) | | | | ● | ● | `delivery_model` (`session` ↔ `group_session`) |
| Duration (15, 30, 45, 60 or 90 minutes) and session count | | | | ● | ● | `blueprint.session_minutes`, `session_count` |
| Seats and enrolment | | | | | ● | `seats_per_session`, `max_seats_per_cohort`, `allow_continuous_enrollment` |
| Conferencing provider | | | | ● | ● | `blueprint.meeting_provider` (new; NULL means `fn_conferencing_provider`) |
| Availability scheduler | | | | ● | ● | `blueprint.availability_preset_id` and presets (§5) |
| Buyer questions | | ● | ● | ● | ● | `blueprint.intake_fields` |
| SEO and reach | ● | ● | ● | ● | ● | `listings.seo_title`, `seo_description`, `listing_tags` (≤10) |

Section-level UX rules:
- **One column of sections**, each a `<section aria-labelledby>` heading in the section-header
  register, separated by spacing (`--space-8`). There are **no boxed section cards** (§3.6).
- **Unboxed rows.** The scope checklist is a list of `Icon('check')` rows with inline edit,
  drag-reorder through `@projective/ui/dnd`, and Enter to add a row below. Milestones and stages
  render as a numbered `Timeline` with inline fields. Only interactive controls carry borders.
- **Money fields.** Every money field is the project setup form's: `NumberInput` with the app-wide
  `MONEY_FIELD` preset and `moneyDigits(currency)` (`apps/web/utils/money-field.ts`) — the
  currency symbol as the leading adornment, steppers and icon scrub by whole units, Ctrl for the
  currency's minor unit — in the listing currency, in major units. No raw `type="number"`.
- **Changing the delivery model** is allowed only while the listing is a draft. Afterwards, Basics
  shows the model as text with an "Archive & recreate" explanation, because a model change on a
  live listing would orphan bookings.

### 4.4 Media showcase grid (`pf-showgrid` parity)

**Package split.** The UI package cannot depend on `features/files` (`AssetPicker`), so the work is
split in two:
- **`@projective/ui/display` `ShowcaseGrid`.** Pure presentation: six slots, 16:10, slot-1 cover
  semantics, keyboard reorder. It renders the BEM block `ui-showgrid`.
- **`features/files/components/showcase/ShowcaseSlots.tsx`.** Wires the grid to `MediaCropPicker`
  in media mode. Both the profile `MediaSection` and the catalogue `MediaShowcaseSection` mount
  it, and `pf-showgrid` CSS is retired.

```ts
/** One slot as the grid renders it — structural (no @projective/types import in packages/ui). */
export interface ShowcaseGridSlot {
	position: 1 | 2 | 3 | 4 | 5 | 6;
	kind: "image" | "video";
	thumb: string;          // 16:10 rendition md tier
	alt: string;
	placeholder?: string;   // blurhash data URI
	pending?: boolean;      // rendition being cut
}
export interface ShowcaseGridProps {
	slots: readonly ShowcaseGridSlot[];             // sparse; missing positions render empty
	coverLabel?: string;                             // "1 · Cover"
	onAdd: (positions: number[]) => void;            // empty slot → all empty positions, pressed first
	onReplace: (position: number) => void;
	onRemove: (position: number) => void;
	onReorder: (from: number, to: number) => void;   // refuses video → 1
	onEditAlt?: (position: number) => void;
	disabled?: boolean;
	class?: string;
}
```

| BEM | Role |
| :-- | :-- |
| `.ui-showgrid` | `<ol>`. Grid with 3 columns, or 2 below `--bp-md` (`max-width: 767.98px`). The cover spans 2×2 from `--bp-lg` up (`.ui-showgrid--hero`, `min-width: 1024px`). |
| `__cell` | `<li>`. `data-position`, `data-primary` on slot 1, and `data-dragging` / `data-drop-target`. |
| `__filled` / `__empty` | `aspect-ratio: 16 / 10`. Empty slots use `--surface-2` with a dashed `--outline-variant` border, because they are interactive. |
| `__mark` | Play badge (video). |
| `__overlay` / `__action` | Replace, Alt text and Remove. Shown on hover or focus-within; always shown on `(hover: none)`. |
| `__label` | "1 · Cover" or the slot number (`--text-xs`, `--text-secondary`). |
| `__status` | `aria-live="polite"` "Preparing 16:10 rendition…". |

**Interaction.**
- Drag to reorder: pointer through `@projective/ui/dnd`. With the keyboard, Space lifts a slot,
  the arrows move it, Space drops it and Esc cancels, with live-region announcements.
- Dropping a video on slot 1 is refused with an inline reason.
- Removing slot 1 promotes the first remaining **image**. If none remains, the publish gate reports
  "Add a cover image".

**Pipeline.**
- `MediaCropPicker` is opened with `target: "showcase"`, `allowVideo: positions.some(p => p !== 1)`
  and `max = empty positions`.
- `onSave` goes to `POST /api/catalogue/media` → `CatalogueBackendService.applyMedia`. That reuses
  `ProfileBackendService.applyMedia`'s rendition cut, extracted to a shared
  `services/media/showcase-rendition.ts`, then writes the `listing_media` rows and mirrors the
  cover.
- The library admission path (quarantine → sniff → WebP tiers) is unchanged (#119). There is
  **no URL input anywhere**.

### 4.5 Rich controls introduced

| Control | Home | Notes |
| :-- | :-- | :-- |
| `MoneyInput` | `@projective/ui/fields` | Minor units in and out, currency adornment, locale grouping on blur, `inputmode="decimal"`. No longer used by the catalogue: its money fields are `NumberInput` + `MONEY_FIELD`, the same as project setup. |
| `DurationPicker` | `@projective/ui/fields` | `SelectButton` preset (15, 30, 45, 60, 90) plus a "Custom" stepper (5–600). |
| `NumberStepper` | `@projective/ui/fields` | − / + buttons with `role="spinbutton"`. Arrow keys step by 1, PageUp / PageDown by 10, Home / End go to the bounds. |
| `TagCombobox` | `@projective/ui/fields` | ARIA 1.2 combobox with a chip list and `max`. Suggestions are injected (`/api/search/suggest-tags`). Enter or comma commits, Backspace removes the last chip. |
| `TurnaroundSlider` | app | Composes `MilestoneSlider` with `milestones=[1,2,3,5,7,10,14,21,30]` days. |
| `SerpPreview` | app | Pure display of `serpSnippet()` (§7.1): title truncated near 60 characters, description near 155, and the URL `projective.com › view › svc-…`. |
| `ShowcaseGrid` | `@projective/ui/display` | §4.4. |
| `AvailabilityScheduler` | `@projective/ui/calendar` | §5. |
| Charts | `@projective/ui/display/charts` | §4.7. |

Each new `@projective/ui` component lands with its `DESIGN_SYSTEM.md` §C.1 roster row (§3 gate 5).

### 4.6 Preview fidelity

1. **One adapter.** Extract the listing-row → `ServiceItem` / `ProductItem` mapping out of
   `live-catalog.ts#assemble` into the pure
   `packages/types/explore/listing-card.ts#listingCardItem(detail)`. Both the explore assembler and
   the workspace's live card call it. `buildPreviewItem` is deleted. A contract test asserts
   `assemble(rows).services[i]` deep-equals `listingCardItem(detailFromSameRows)` for every seeded
   listing.
2. **Live card.** `LiveCardPreview` renders the real `ServiceCard` / `ProductCard` from
   `listingCardItem(workspace.draft.value)`, so it updates on every keystroke. It lives in the
   **panel**, never a third sticky column. Below 1280 the header's "Card" button opens the same body
   in a `Drawer`.
3. **Full buyer simulation.**
   - `/catalogue/[id]/simulate` is a dashboard route with `chrome: "bare"`. It reads
     `CatalogueBackendService.previewView(slug, actor)`, an owner-RLS read of the **draft** built
     with the same `EntityView` assembler `/view` uses (`resolveListing` source).
   - It renders `EntityViewPage` with `simulation={true}`, so the conversion lane, archetype and
     `resolveCta` are all real (#78–#80).
   - The Preview tab frames it in an iframe at desktop (1280 px, scaled to fit) or mobile
     (390 × 844).
   - It reloads when the workspace save state flips to `saved`, so the preview always shows stored
     truth.
   - A simulation banner (an `InlineNotice` at the top of the frame) states that buttons are
     simulated (flag **j**).

### 4.7 Analytics

| Metric | Definition (window W) | Source |
| :-- | :-- | :-- |
| Impressions | Count of `interest_events` `impression` for the listing's subject | rollup `listing.impressions` |
| Views | Distinct (session, listing, day) `view` events | rollup `listing.views` |
| CTR | clicks ÷ impressions (shown only when impressions ≥ 20) | derived |
| Checkout starts | Basket adds of the listing (`finance.basket_items` created) | rollup `listing.checkout_starts` |
| Orders / bookings | `finance.order_lines` on confirmed or invoiced orders, plus session bookings | rollup `listing.orders` |
| Gross volume | Their gross by currency in `dimensions`, converted only when mixed (`FxService`) | rollup `listing.gross_minor` |
| Conversion | orders ÷ views (shown only when views ≥ 20) | derived |
| Booking heatmap | Booked session starts by (weekday, hour) in the **seller's** timezone | rollup `listing.booking_slot` with `{dow, hour}` |
| Keyword impressions | Impressions with a `query`, grouped by normalised query, k ≥ 5 sessions | rollup `listing.query_impressions` with `{q}` |
| Churn | Cancelled or refunded orders and sittings ÷ orders | rollup `listing.cancellations` |
| Standing impact | Flag **h** | `org` standing events |

**Rendering.**
- `StatTile` row: unboxed, separated by spacing, the value at the display register with
  `tabular-nums`, and the delta as meta text with an arrow glyph. Colour never carries meaning
  alone.
- `AreaChart` for revenue velocity, with a crosshair and a keyboard-scrubbable focus point.
- `FunnelChart`: impressions → views → checkout → orders, each step showing its drop-off
  percentage.
- `HeatmapGrid` (7 × 24): ramp on `--primary` tint steps, plus a pattern overlay under the
  colour-blind overlay.
- A keyword `DataTable`.
- Each chart renders SVG at low density and switches to Canvas2D when its entity count or measured
  frame budget calls for it (flag **m**, §C.5). Either renderer meets the same figure, caption,
  hidden-table and keyboard contract.
- Every chart is a `<figure>` with a `<figcaption>` and a visually hidden `<table>` holding the
  same data.
- Empty and sparse states follow the dev axis `catalogueAnalytics` (§10).

**Dual scope.** `AnalyticsCanvas` takes `scope: { kind: "catalogue"; filter } | { kind: "listing";
slug }` and calls `/api/catalogue/analytics`. The console shows catalogue totals plus a
"Top listings" table whose rows link to `/catalogue/<slug>?tab=analytics`.

### 4.8 CSS split (all token-only)

`features/catalogue/styles/` is split into one file per block:

- `console.css` (`cat-console`)
- `lane.css` (`cat-lane`)
- `listing-card.css` (`cat-card`)
- `listing-table.css` (`cat-table`)
- `workspace.css` (`cat-ws`)
- `edit-sections.css` (`cat-sec`, `cat-edit`)
- `section-nav.css` (`cat-secnav`)
- `offer.css` (`cat-offer`)
- `seo.css` (`cat-seo`)
- `preview.css` (`cat-preview`)
- `analytics.css` (`cat-an`)
- `clients.css` (`cat-cl`)
- `client-drawer.css` (`cat-cdrawer`)

Rules for all of them:
- **Focus.** Every interactive selector gets `:focus-visible { box-shadow: var(--focus-ring-shadow);
  }`.
- **Breakpoints.** Media queries cannot read custom properties, so a media query uses only the
  literal value of a `--bp-*` token (480 / 768 / 1024 / 1280 px; `max-width: 767.98px` for "below
  `--bp-md`"), with the token named in a comment. Component-internal layout uses container queries.
- **Press feedback.** `transform: scale(var(--cat-press-scale))` only (a block-local token in the same
  family as `--btn-press-scale` / `--ex-press-scale`), and `transform: none` under both
  reduced-motion channels.

---

## 5. The Rule-Based Availability Scheduler

### 5.1 Goals, beyond typical calendar tools

1. **Two layers in one view.** Working hours and call windows are distinct layers (#56). A call
   window is painted as a *subset* band, hatched so it does not rely on colour.
2. **Split shifts are first-class.** One rule carries up to 6 bands, so "Wed 6–12 + 14–19" is one
   rule, not two.
3. **Real recurrence**: weekly with an interval (bi-weekly), monthly by date, monthly by weekday
   ordinal ("2nd Tuesday", "last Friday"), yearly, and one-off dates.
4. **Conditional exceptions** ("skip the 12th unless it is Thursday or Friday"), compiled to
   **pure RFC 5545**. The `BYMONTHDAY=12` set is intersected with `BYDAY` of the *other* weekdays.
   Any condition that cannot be expressed in RRULE is refused at authoring time with a reason, and
   never approximated.
5. **Date-pattern overrides** ("on the 21st, work 15:00–17:00 *instead*") use effect `replace`.
6. **Explainability.** Any date in the preview answers "why?": it lists the rules that contributed,
   the rules that were overridden, and any blackout.
7. **Presets.** Load a template, save the current rules as a preset, bind a service to a preset
   (linked), or override it (fork).
8. **Direct manipulation and a full keyboard model**, so neither mouse nor keyboard is second
   class.

### 5.2 State model

```ts
// @projective/types/scheduling/recurrence.ts
export const RuleEffect = z.enum(["add", "replace", "subtract"]);
/** One band in minutes from local midnight; never crosses midnight (#56) — the editor splits. */
export const BandSchema = z.object({ start: z.number().int().min(0).max(1439), end: z.number().int().min(1).max(1440) })
	.refine((b) => b.end > b.start, "A band must end after it starts.");

/** The human-shaped pattern the editor authors; normalised to an RRULE for storage. */
export const RulePatternSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("weekly"), days: z.array(Weekday).min(1).max(7), interval: z.number().int().min(1).max(8) }),
	z.object({ type: z.literal("monthly_date"), days: z.array(z.number().int().min(-31).max(31).refine((d) => d !== 0)).min(1).max(31), interval: z.number().int().min(1).max(12) }),
	z.object({ type: z.literal("monthly_weekday"), ordinal: z.union([z.literal(-1), z.number().int().min(1).max(4)]), weekday: Weekday, interval: z.number().int().min(1).max(12) }),
	z.object({ type: z.literal("yearly"), month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) }),
	z.object({ type: z.literal("once"), date: IsoDate }),
]);
/** "unless it is Thursday or Friday" — compiled into BYDAY of the complement. */
export const RuleConditionSchema = z.object({ unlessWeekdays: z.array(Weekday).max(6).default([]) });

export const AvailabilityRuleDraftSchema = z.object({
	id: z.string().max(40),                 // client id until saved; uuid after
	layer: AvailabilityKind,                // working_hours | call_window
	effect: RuleEffect,
	pattern: RulePatternSchema,
	condition: RuleConditionSchema.default({ unlessWeekdays: [] }),
	bands: z.array(BandSchema).max(6),      // empty + subtract = whole day off
	startsOn: IsoDate,                      // DTSTART anchor (bi-weekly parity!)
	endsOn: IsoDate.nullable(),             // UNTIL
	priority: z.number().int().min(0).max(99).default(50),
	label: z.string().max(80).default(""),
	active: z.boolean().default(true),
});

export const AvailabilityPresetSchema = z.object({
	id: z.string(), name: z.string().min(1).max(60), description: z.string().max(200),
	timezone: IanaTimezone, isDefault: z.boolean(), scope: z.enum(["library", "service"]),
	blueprintId: z.string().nullable(), rules: z.array(AvailabilityRuleDraftSchema).max(64),
	archivedAt: z.string().nullable(),
});
```

**Evaluation per local date D**, in the preset's timezone and for each layer:

1. `base` = the union of the bands of every active `add` rule that occurs on D.
2. If any active `replace` rule occurs on D, `base` = the bands of the **highest-priority** one.
   Ties go to the most recently `startsOn`, then to the lowest rule id.
3. `base` −= the bands of every active `subtract` rule on D. A subtract rule with no bands removes
   the whole day.
4. Clip `call_window` to `working_hours`. The editor warns about any call band that falls outside
   working hours; the evaluator **never silently widens** working hours.
5. Convert to timestamptz with the zone rules. In a DST gap, a band starting in the gap starts at
   the gap's end. In a DST overlap, the first occurrence is used.
6. Subtract `blackout_dates` (absolute).
7. For bookable slots: subtract booked events, then apply buffers and notice from `call_settings`
   or the blueprint.

Every step is a pure function: `occursOn(rule, date)`, `layerBandsFor(preset, date, layer)`,
`evaluate(preset, range) → Occurrence[]` and `explain(preset, date) → Explanation`.

### 5.3 RRULE normalisation

`@projective/types/scheduling/rrule.ts` is a **dependency-free** RFC 5545 subset. Every rule must
round-trip, so `normalise(parse(serialise(x))) ≡ x`.

| Draft | RRULE (DTSTART carried separately as `startsOn`) |
| :-- | :-- |
| Mon–Fri weekly | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR` |
| Every other Wednesday | `FREQ=WEEKLY;INTERVAL=2;BYDAY=WE` |
| 1st and 15th monthly | `FREQ=MONTHLY;BYMONTHDAY=1,15` |
| Last Friday monthly | `FREQ=MONTHLY;BYDAY=-1FR` |
| Skip the 12th unless Thu/Fri | effect `subtract`, `FREQ=MONTHLY;BYMONTHDAY=12;BYDAY=SU,MO,TU,WE,SA` |
| 21st: 15:00–17:00 instead | effect `replace`, `FREQ=MONTHLY;BYMONTHDAY=21`, bands `[900,1020]` |

- **Supported parts:** `FREQ` (`DAILY`, `WEEKLY`, `MONTHLY` or `YEARLY`), `INTERVAL`, `BYDAY` (with
  an ordinal only under MONTHLY or YEARLY), `BYMONTHDAY` (including negative values), `BYMONTH`,
  `BYSETPOS`, `UNTIL` (a date) and `WKST`.
- **Unsupported:** `COUNT` (use `endsOn`), and `BYHOUR`, `BYMINUTE` and `BYSECOND`, because bands
  carry the time of day. These are refused by Zod with a message.
- **Expansion limits:** expansion stops at `[from, to]`, and at most 2,000 occurrences per rule per
  call.
- **Precision:** expansion iterates dates in civil, timezone-free arithmetic, so it is exact.

`describeRule(draft, locale)` gives the sentence form the rule list shows, for example "Every other
Wednesday from 6 Oct · 06:00–12:00, 14:00–19:00 · working hours".

**Exporting.** `toICalendar(preset, range)` reuses `scheduling/ics.ts`. It emits one `VAVAILABILITY`
component per preset (RFC 7953) with `AVAILABLE` sub-components carrying each `add` rule's RRULE.
Subtract and replace rules are emitted as **evaluated** `EXDATE` / extra `AVAILABLE` instances, so a
consumer that cannot handle precedence still sees the correct result.

### 5.4 The compound component (`@projective/ui/calendar`)

**Packaging.** `packages/ui` does not import `@projective/types`, so the engine is **injected**:
`AvailabilityScheduler` takes `engine: SchedulerEngine` (`evaluate`, `explain`, `describe`,
`validate`). The app passes the `@projective/types/scheduling` implementation. This is the same
adapter pattern the Gantt engine uses. The component is a self-contained block that works the same
inside a `Dialog` or on a full page, because it sizes from its container (container queries) and
not the viewport.

```tsx
<AvailabilityScheduler.Root value={preset} onChange={…} engine={engine} timezone={tz} weekStartsOn={1}>
	<AvailabilityScheduler.PresetBar templates={TEMPLATES} presets={library} binding={…} />
	<AvailabilityScheduler.Toolbar />          {/* layer toggle · snap · view (Week | Month) · undo/redo · help */}
	<AvailabilityScheduler.WeekCanvas />       {/* direct manipulation of the weekly add-rules */}
	<AvailabilityScheduler.MonthPreview />     {/* evaluated result with per-date "why" */}
	<AvailabilityScheduler.RuleList />         {/* sentence rows; select → RuleEditor */}
	<AvailabilityScheduler.RuleEditor />       {/* pattern · condition · bands · effect · range */}
	<AvailabilityScheduler.Issues />           {/* conflicts, call outside work, empty weeks */}
</AvailabilityScheduler.Root>
```

**Internal store** (signals; the context is local to the root):
- `draft: Signal<Preset>`
- `history: Signal<Preset[]>` (undo depth 50)
- `cursor: Signal<{day: 0..6, minute}>`
- `selection: Signal<{ruleId, bandIndex} | null>`
- `layer: Signal<AvailabilityKind>`
- `snap: Signal<5 | 15 | 30>`
- `view: Signal<"week" | "month">`
- `focusMonth: Signal<IsoMonth>`
- derived: `occurrences = computed(() => engine.evaluate(draft, monthRange(focusMonth)))`
- derived: `issues = computed(() => engine.validate(draft))`

**WeekCanvas** (`role="grid"`; 7 columns × 96 quarter-hour rows; the bands are absolutely
positioned buttons):

| Input | Action |
| :-- | :-- |
| Drag on empty | Create a band (snapped) on the active layer. If the day belongs to a weekly `add` rule, the band is added to it; otherwise a new weekly rule is created. |
| Drag a band body or edge | Move it, or resize it. |
| Alt-drag | Duplicate to another day. |
| Shift-click days | Apply the band to several days. |
| Arrow keys | Move the cursor (one snap step vertically, one day horizontally). |
| Enter | Create a 1 h band at the cursor, or open the selected band in `RuleEditor`. |
| Shift + ↑/↓ | Resize the selected band's end. Alt + Shift + ↑/↓ resizes its start. |
| Alt + ↑/↓/←/→ | Move the selected band in time or across days. |
| Ctrl/Cmd + D | Duplicate to the next day. |
| Delete / Backspace | Remove the band. Removing the last band removes the rule, with undo. |
| `W` / `C` | Switch the active layer to working hours or call window. |
| `[` / `]` | Previous or next month (`MonthPreview`). |
| Ctrl/Cmd + Z, Shift + Ctrl/Cmd + Z | Undo, redo. |
| `?` | Shortcut sheet (`Dialog`). |

Overnight drags (for example 23:00 → 01:00) are stored as two bands, and drawn joined by a
continuation mark (#56).

**Accessibility.**
- Each band is a `button` with
  `aria-label="Wednesday, 06:00 to 12:00, working hours, rule: Every other Wednesday"`.
- An `aria-live="polite"` region announces create, move, resize and delete.
- In the grid, `aria-rowindex` and `aria-colindex` describe time and day.
- **High contrast.** Working hours are a solid `--surface-3` band with a `--outline` edge. Call
  windows are an `--accent`-tone band with a 45° hatch (`repeating-linear-gradient` from tokens).
  Subtract and blackout are crossed hatching. Every state is distinguishable without colour.
- **Reduced motion.** Drag ghosts snap without a spring.

**MonthPreview.**
- Each date cell shows evaluated band bars for both layers and a summary ("7h · calls 3h").
- Hover, focus or Enter opens a `Popover` with `explain()`, for example: "Rule *Skip the 12th
  unless Thu/Fri* removed 09:00–17:00 · Override *21st afternoons* replaced working hours".
- Dates under a blackout show their label only when `label_is_public` is set or the viewer owns
  the schedule.

**RuleEditor.**
- Pattern `SelectButton` (Weekly · Monthly by date · Monthly by weekday · Yearly · One date),
  followed by the controls specific to that pattern.
- "Unless it's…" weekday chips, shown only for patterns where they compile.
- A band list (up to 6) of time-range rows using a `TimeRangeField` (two `InputMask` `HH:MM`
  fields with stepper keys).
- Effect: Add · Replace the day · Remove.
- Date range.
- A live sentence from `describeRule`, and the raw RRULE in a collapsed "Advanced" disclosure. That
  field is editable: paste an RRULE, and it is parsed or rejected with a reason.

### 5.5 Presets

- **Templates.** These are pure constants (`scheduling/templates.ts`), not rows.
  - **General Freelancer Availability.** Mon–Fri 09:00–17:30 working; calls 10:00–12:00 and
    14:00–16:00.
  - **VIP Intensive Advising.** Tue and Thu 07:00–09:00 and 18:00–20:00 calls (working the same);
    every other Saturday 10:00–13:00.
  - **Evening Sprints.** Mon–Thu 18:00–22:00 working; calls 18:00–19:00.
- **Library presets** are rows (`scope = 'library'`). Exactly one is the default
  (`is_default`, enforced by a partial unique index).
- **Binding a service.**
  - `service_blueprints.availability_preset_id` holds either a library preset (linked; edits to
    the preset flow to every bound service) or a service-scoped preset (`scope = 'service'`, a
    fork).
  - NULL means the default preset.
  - The binding line is plain text plus actions: "Uses **General** · Edit preset · Override for
    this service". Once forked: "Custom for this service · Revert to General · Save as preset".
- **Archiving.** A preset is archived, never deleted. A bound service falls back to the default,
  and the archive confirm lists every affected service first.

### 5.6 Persistence and gate

1. `PUT /api/scheduling/presets` → `ScheduleBackendService.savePreset(input, actor)`.
   - Zod-validates the input, and re-validates every RRULE with the same parser.
   - Writes the preset, its rules and its bands through the invoker RPC
     `scheduling.save_availability_preset`, under the RLS predicate `fn_can_manage_schedule`.
   - Then calls `compileOccurrences(presetId, horizon)`, which runs the TypeScript evaluator over
     today → +120 d and writes spans through the definer door
     `scheduling.replace_preset_occurrences(p_preset, p_from, p_to, p_spans jsonb)`. That door is
     executable by `service_role` only.
2. **Horizon job** (`scheduling-availability-horizon`): daily at 03:05 UTC, registered in
   `ops.scheduled_jobs`, dispatched over HTTP to `POST /api/scheduling/cron/horizon` with the Vault
   bearer (#203). It recompiles any preset whose `compiled_through` is earlier than today + 90 d.
3. **Gate.** `scheduling.fn_band_covers(…)` gains a preset branch: if the booking's blueprint has
   a resolved preset, coverage means "inside one `availability_occurrences` span of the right
   layer". Otherwise it uses the existing weekday-band logic. `fn_book_session_slot` (#211) and
   `request_discovery_call` (with a `service_blueprint_id`) inherit this through the predicate.
4. **Mirror for legacy readers.** When the **default** preset is saved, its weekly `add` rules
   whose interval is 1 (the only weekly-band-expressible subset) are mirrored into
   `availability_rules` (`save_owner_availability` path). `/[handle]/availability` and discovery
   calls keep working. Anything richer is reported in the UI ("Your profile's call booking uses
   the weekly part of this preset"), per flag **d**.

---

## 6. Routing, middle-nav & state contracts

### 6.1 Routes

| Route | Controller | Slots (lane · header · footer · panel) |
| :-- | :-- | :-- |
| `/catalogue` | `features/catalogue/routes/console.tsx` | `CatalogueLane` · `CatalogueHeader` · `CatalogueFooterRig` · `ClientDrawer` (only on `view=clients` with `client`) |
| `/catalogue/[id]` | `…/routes/workspace.tsx` | `CatalogueLane` (outline mode) · `ListingHeader` · `ListingActionRig` · `ListingInspector` |
| `/catalogue/[id]/simulate` | `…/routes/simulate.tsx` | `chrome: "bare"`, no slots |
| `/catalogue/new` | **none** | The `[id]` controller runs `isSlug(id, "service" \| "product")` **before** any read; any other value gets a 303 to `/catalogue?create=1`. A contract test asserts that no route file matches `catalogue/new` and that `/catalogue/new` never renders a form. |

### 6.2 URL contract (pure resolvers, `@projective/types/catalogue/url.ts`)

```ts
export const ConsoleView = z.enum(["listings", "analytics", "clients"]);
export const WorkspaceTab = z.enum(["edit", "preview", "analytics", "clients"]);
export const EditSection = z.enum(["basics", "media", "offer", "pricing", "availability", "questions", "seo"]);
export const PreviewDevice = z.enum(["desktop", "mobile"]);
export const ConsoleScope = z.union([
	z.literal("all"), z.literal("product"), z.literal("service"),
	z.string().regex(/^model:(pipeline|one_off|direct_deliverable|session|group_session)$/),
	z.string().regex(/^collection:[a-z0-9-]{1,60}$/),
]);
export const ClientKey = z.string().regex(/^@[a-z0-9_]{2,30}$/);   // a buyer handle — never a uuid (#88)

// The facets are lists (Decision #221): `?status=draft,paused` · `?model=pipeline,session` ·
// `?category=educate,test`, canonical order, unknown values dropped. `status` is never empty and
// defaults to draft · published · paused (Archived off), a default the href omits.
export interface ConsoleUrlState { view; type; status: ListingStatus[]; model: ServiceType[]; create: CreateCategory[]; sort; dir; search; period; scope; client?; createOpen: boolean }
export interface WorkspaceUrlState { tab; section?; device; period; client? }
export function parseConsoleUrl(url: URL): ConsoleUrlState;          // total: bad values → defaults
export function consoleHref(state: Partial<ConsoleUrlState>): string; // canonical param order, defaults omitted
export function parseWorkspaceUrl(url: URL): WorkspaceUrlState;
export function workspaceHref(slug: string, state: Partial<WorkspaceUrlState>): string;
/** `?scope=<listing slug>` on the console → the one per-item home (flag l). */
export function scopeRedirect(url: URL): string | null;
```

**URL invariants.**
- **Resolvers are total.** An unknown value falls back to its default and never throws.
- **One home per thing.** The tab, view and client are always in the URL, so a reload or a shared
  link restores the same screen.
- **Navigation.** Switching tabs uses `history.pushState`, and slot islands subscribe to
  `popstate` through `urlState` signals. The SSR-resolved slots read the same parser, so the first
  byte is right.

### 6.3 Slot resolver additions (`_layout.tsx`)

- `catalogueLaneFor(url, context, actor)`: console mode or outline mode, chosen by path depth.
- `catalogueHeaderFor` and `catalogueFooterFor`: extended for tabs and the batch bar.
- **New** `cataloguePanelFor(url, context, actor)`, added to the panel ladder:
  `conversationPanelFor ?? channelPanelFor ?? cataloguePanelFor`.
- The panel is open when `?client=` is present, or `tab=edit` at ≥1280 (toggled by the inspector
  button, persisted with `LocalKeys.CATALOGUE_INSPECTOR`).

### 6.4 Signal stores

```ts
// features/catalogue/core/console-store.ts
export const consoleUrl = signal<ConsoleUrlState>(…);         // hydrated from SSR, synced to history
export const listingsPage = signal<CataloguePage | null>(null);
export const listingsBusy = signal(false); export const listingsError = signal<string | null>(null);
export const selection = signal<ReadonlySet<string>>(new Set()); // listing slugs
export const selectionAnchor = signal<string | null>(null);     // shift-range
export const batchState = signal<{ running: boolean; results: BatchOutcome[] }>(…);
export const rollups = computed(() => listingsPage.value?.stats ?? null);
export function setConsoleUrl(patch: Partial<ConsoleUrlState>, mode?: "push" | "replace"): void;
export function toggleSelect(slug: string, range?: boolean): void; export function clearSelection(): void;

// features/catalogue/core/workspace-store.ts
export const workspaceUrl = signal<WorkspaceUrlState>(…);
export const saved = signal<ListingDetail>(…);               // last server-acknowledged
export const draft = signal<ListingDetail>(…);               // edited copy
export const dirtyPaths = computed(() => diffPaths(saved.value, draft.value));
export const saveState = signal<"saved" | "dirty" | "saving" | "error" | "conflict">("saved");
export const readiness = computed(() => publishReadiness(draft.value));
export const cardItem = computed(() => listingCardItem(draft.value));
export function edit<K extends keyof ListingDetail>(key: K, value: ListingDetail[K]): void; // marks dirty + schedules save
export function flush(): Promise<void>;                     // pagehide → sendBeacon fallback
export function requestStatus(next: ListingStatus): Promise<void>;
```

**Concurrency.** `UpdateListingInput.expectedUpdatedAt` is checked by `save_listing`. On a mismatch
it raises `PC409`, the service returns 409, and the store enters `conflict`. A `ConfirmDialog` then
offers "Reload theirs" or "Overwrite with mine".

---

## 7. Zod contracts

### 7.1 `@projective/types/catalogue` (new and changed modules)

| File | Exports |
| :-- | :-- |
| `url.ts` | §6.2 |
| `archetype.ts` | `FormArchetype = z.enum(["product","pipeline","one_off","session","cohort"])`, `formArchetypeOf(kind, serviceType)`, `sectionsFor(archetype, serviceType): EditSection[]` |
| `media.ts` | `ListingMediaSlotSchema { position 1–6, kind, fileId (uuid), thumb, src, alt ≤200, placeholder?, pending? }`, `SHOWCASE_SLOTS = 6`, `ApplyListingMediaSchema { listingId, choices: MediaChoice[] ≤6 }`, `ReorderListingMediaSchema`, `coverOf(slots)` |
| `offer.ts` | `ProductOfferSchema { format, licence: "personal"\|"commercial"\|"extended", attributionRequired, attachments: AttachmentRef[] ≤24 }`; `MilestoneSchema` = re-export of `BlueprintStageSchema` extended with `{ startTrigger: StartTrigger, lagDays 0–90, chainReaction }`; `OneOffOfferSchema { milestones ≤12, turnaroundDays 1–90, scope: string ≤140 [] ≤24 }`; `PipelineOfferSchema { stages 1–12 }`; `SessionOfferSchema { format: "solo"\|"cohort", minutes ∈ {15,30,45,60,90} ∪ 5–600, count 1–52, seats?, continuousEnrollment, meetingProvider: ProviderSlug \| null, presetBinding }`; `TeamRoleSchema` (re-export) |
| `seo.ts` | `ListingSeoSchema { seoTitle ≤70, seoDescription ≤160, createCategory: CreateCategory \| null, tags ≤10 × ≤40 }`, `serpSnippet(input): { title, url, description, truncated: {title, description} }` |
| `analytics.ts` | `AnalyticsScope` (discriminated union), `AnalyticsPeriod = CataloguePeriod ∪ "12m"`, `MetricTile { key, value, label, delta \| null, sufficient }`, `SeriesPoint`, `FunnelStep`, `HeatCell { dow, hour, value }`, `KeywordRow`, `CatalogueAnalyticsSchema` |
| `clients.ts` | `ClientLane = z.enum(["inquiries","active","action_required","closed"])`, `EngagementKind = z.enum(["inquiry","quote","discovery_call","order","session_booking","pipeline_project"])`, `ActionReason = z.enum(["revision_requested","reschedule_open","handshake_pending","dispute_open","inquiry_unanswered","submission_pending"])`, `ClientEngagementSchema`, `ClientSummarySchema`, `ClientPipelineSchema`, `laneOf(engagement)` (**pure, derived from existing statuses**) |
| `batch.ts` | `BatchActionSchema = z.discriminatedUnion("action", [{action:"status", status}, {action:"collection", name}, {action:"duplicate"}])`, `BatchInputSchema { ids ≤100, … }`, `BatchOutcomeSchema { id, ok, message? }` |
| `catalogue.ts` (changed) | `ListingDetail` replaces `media` with `ListingMediaSlot[]` and `availability` with `availabilityBinding`, and gains `offer` (a discriminated union by archetype) and `seo`. `UpdateListingInput` takes the same, plus `expectedUpdatedAt`. `publishReadiness` now requires a slot 1 image, a price, the archetype minimums (pipeline: 1 or more stages; session: a preset that yields at least 1 window in the next 30 days) and the SEO title fallback. |

### 7.2 `@projective/types/scheduling` (new)

| File | Exports |
| :-- | :-- |
| `rrule.ts` | `RRuleParts`, `parseRRule(s): Result<RRuleParts>`, `serialiseRRule(p)`, `expandRRule(p, startsOn, range, cap)` |
| `recurrence.ts` | §5.2 schemas, `draftToRRule(draft)`, `rruleToDraft(s, startsOn)` (or `null` when the result is not representable as a draft, and the Advanced field then keeps the raw rule) |
| `evaluate.ts` | `occursOn`, `layerBandsFor`, `evaluate`, `explain`, `validate → Issue[]` |
| `describe.ts` | `describeRule`, `describePreset` |
| `templates.ts` | `SCHEDULE_TEMPLATES` (§5.5) |
| `presets.ts` | `SavePresetInputSchema`, `BindListingAvailabilitySchema { listingId, mode: "default"\|"preset"\|"override", presetId? }`, `OccurrenceSpanSchema` |

---

## 8. Database strategy

**All changes are edits in place** in the consolidated files (§1). Each one ships with Zod, the
`documentation/database/*` update and a rolled-back probe under `supabase/probes/`.

| File | Change |
| :-- | :-- |
| `00000004_enums_domains.sql` | `scheduling.rule_effect ('add','replace','subtract')`, `scheduling.preset_scope ('library','service')`, `catalogue.product_licence ('personal','commercial','extended')` |
| `00000014_tables_marketplace.sql` | `service_blueprints`: add `turnaround_days smallint CHECK 1–90`, `meeting_provider text CHECK (… same set as events)`, `availability_preset_id uuid` (the FK goes in `00000031` because the dependency is circular). The `stage_template` element shape is documented to include the trigger fields. |
| `00000016_tables_comms.sql` | `dm_threads.subject_listing_id` (flag **g**). The FK goes in a trailing fk file if ordering requires it. |
| `00000018_tables_search.sql` | `interest_events.event_type` CHECK adds `'view'`. `services_index` and `catalogue_index` add `tags text[] NOT NULL DEFAULT '{}'`. |
| `00000022_tables_scheduling.sql` | New: `availability_presets(id, schedule_id → schedules CASCADE, scope, blueprint_id → service_blueprints NULL, name, description, is_default, compiled_from date, compiled_through date, archived_at, created_at, updated_at; UNIQUE(schedule_id, name) WHERE archived_at IS NULL; partial UNIQUE(schedule_id) WHERE is_default AND archived_at IS NULL; CHECK (scope='service') = (blueprint_id IS NOT NULL))`. Also `recurrence_rules(id, preset_id CASCADE, kind availability_kind, effect rule_effect, rrule text CHECK length ≤ 400, starts_on date, ends_on date NULL, priority smallint, unless_weekdays smallint[], label, is_active, position, timestamps)`, `recurrence_rule_bands(rule_id CASCADE, position, start_minute, end_minute, CHECK as availability_rules)` and `availability_occurrences(preset_id CASCADE, kind, starts_at, ends_at, rule_ids uuid[], CHECK ends_at > starts_at)`. |
| `00000023_tables_catalogue.sql` | `listings`: add `seo_title varchar(70)`, `seo_description varchar(160)`, `create_category org.create_category NULL`. `listing_media`: position 1–6, `file_id NOT NULL`, **drop `url`**, add `kind`, `rendition_file_id`, `poster_file_id`, and the CHECK `position = 1 ⇒ kind = 'image'`. `products.licence` becomes `catalogue.product_licence`. **Drop `listing_availability`.** |
| `00000031_tables_fk_scheduling.sql` | `service_blueprints.availability_preset_id → availability_presets ON DELETE SET NULL`. |
| `00001170_functions_catalogue.sql` | `save_listing` gains the keys `offer`, `seo`, `create_category`, `expected_updated_at` (PC409), `stage_template`, `team_roles`, `deliverables`, `turnaround_days`, `session_minutes`, `session_count`, `meeting_provider`, `licence`, `format`, `attribution_required` and `file_manifest`. It loses `media`, which moves to its own door, and `availability`. New: `catalogue.apply_listing_media(p_listing, p_slots jsonb)` (validates slot 1 is an image, mirrors `cover_file_id`) and `catalogue.set_listings_status(p_listings uuid[], p_status)` (per-row outcome jsonb; the publish gate runs per row). `set_listing_status`'s gate reads slot 1. A tag count trigger enforces at most 10. |
| `00001175_functions_marketplace_instantiate.sql` | Per stage, map `startTrigger`, `lagDays` and `chainReaction` into `project_stages.start_trigger_type` (`public.start_trigger_type`), `start_dependency_stage_id` (the previous stage), `start_dependency_lag_days` and `chain_reaction`. |
| `00001300_functions_comms_channels.sql` | The inquiry-thread opener accepts and stores `subject_listing_id`. |
| `00001400_functions_search.sql` | `sync_service_to_index` / catalogue sync build fts as `setweight(title,'A') ‖ setweight(tags,'B') ‖ setweight(description_text,'C')`. A trigger on `listing_tags` touches the index row. |
| `00001510_functions_scheduling.sql` | New: `save_availability_preset` (invoker), `replace_preset_occurrences` (definer, service role only), `fn_preset_for_blueprint(uuid) → uuid` and `fn_occurrence_covers(preset, kind, from, to)`. `fn_band_covers` gains the preset branch (§5.6). |
| `00001600_functions_analytics.sql` | New `analytics.fn_rollup_listings(p_day date)` (definer, idempotent upsert on the UNIQUE key; metrics per §4.7) and `analytics.fn_backfill_listing_rollups(p_from, p_to)`. `fn_subject_visible('listing', id)` is verified or extended so the listing owner (user, or team member) sees its rows. |
| `00001650_functions_ops_scheduler.sql` + `00005xxx_seed_scheduled_jobs` | Register `analytics-listing-rollups` (daily 02:10 UTC, SQL) and `scheduling-availability-horizon` (daily 03:05 UTC, HTTP). |
| `00001170_functions_catalogue.sql` | New `catalogue.get_client_pipeline(p_listing uuid NULL, p_limit int)` (invoker): a UNION over `dm_threads` (service_inquiry + `subject_listing_id`), `marketplace.quote_requests`, `scheduling.discovery_calls` (blueprint), `finance.order_lines` → orders, `projects.session_events` / cohorts by blueprint, `projects.projects.source_blueprint_id` (pipelines), with action reasons joined from `event_reschedules`, paid-revision requests, disputes and submissions awaiting the seller. It returns `ClientEngagement` rows. |
| `0000200x_policies_*` | RLS on every new scheduling table through `fn_can_manage_schedule` (and `fn_can_view_schedule` for read where public). `availability_occurrences` has **no client write policy**. Policies for `listing_media` are unchanged. |
| `0000400x_indexes_*` | `availability_occurrences (preset_id, kind, starts_at)`, `recurrence_rules (preset_id)`, `dm_threads (subject_listing_id) WHERE NOT NULL`, `interest_events (entity_id, event_type, occurred_at)` (if absent) and GIN on `services_index.tags`. |
| Seeds | `db:seed:generate`: rewrite seeded listing media to at most 6 file-backed slots, seed one library preset per seeded freelancer (the "General" template), bind seeded session listings, and seed 90 days of synthetic interest events for the demo personas, then run the backfill. |

**Never touched:** columns or FKs of escrows, wallets and stages. `project_stages` only gains
values written by instantiation; there are no column changes.

---

## 9. Services & routes

The brief's `CatalogueBackendService` and `SchedulingBackendService` map onto **existing**
services. No parallel service is forked.

### 9.1 `CatalogueBackendService` (extended)

```ts
static list(params: CatalogueListParams, actor, displayCurrency): Promise<ServiceResult<CataloguePage>>     // + createCategory, scope
static detail(slug, actor): Promise<ServiceResult<ListingDetail>>
static create(input: CreateListingInput, actor): Promise<ServiceResult<{ listing: ListingDetail }>>        // + createCategory, currency
static update(input: UpdateListingInput, actor): Promise<ServiceResult<ListingDetail>>                     // PC409 → 409
static applyMedia(input: ApplyListingMediaInput, actor): Promise<ServiceResult<ListingMediaSlot[]>>
static reorderMedia(input: ReorderListingMediaInput, actor): Promise<ServiceResult<ListingMediaSlot[]>>
static setStatus(input: SetListingStatusInput, actor): Promise<ServiceResult<ListingSummary>>
static batch(input: BatchInput, actor): Promise<ServiceResult<BatchOutcome[]>>                              // 207-style: ok:true + per-row outcomes
static duplicate(slug, actor): Promise<ServiceResult<{ listing: ListingDetail }>>                          // full copy, media by file_id
static previewView(slug, actor): Promise<ServiceResult<EntityView>>                                         // owner draft → /view assembler
```

### 9.2 New fat services

```ts
// packages/backend/services/catalogue/CatalogueAnalyticsBackendService.ts
static overview(scope: AnalyticsScope, period: AnalyticsPeriod, actor, displayCurrency): Promise<ServiceResult<CatalogueAnalytics>>
// packages/backend/services/catalogue/CatalogueClientsBackendService.ts
static pipeline(scope: { listing?: string; filter?: ConsoleScope }, actor): Promise<ServiceResult<ClientPipeline>>
static client(handle: string, scope, actor): Promise<ServiceResult<ClientSummary>>
// packages/backend/services/scheduling/ScheduleBackendService.ts (extended)
static presets(actor): Promise<ServiceResult<AvailabilityPreset[]>>
static savePreset(input: SavePresetInput, actor): Promise<ServiceResult<AvailabilityPreset>>
static archivePreset(id, actor): Promise<ServiceResult<{ rebound: string[] }>>
static bindListing(input: BindListingAvailability, actor): Promise<ServiceResult<AvailabilityPreset>>
static compileOccurrences(presetId, horizonDays = 120): Promise<ServiceResult<{ spans: number }>>  // service role
static extendHorizons(): Promise<ServiceResult<{ presets: number }>>                               // cron
```

### 9.3 Routes

All of these are thin: parse, Zod, auth guard, service, then `toCatalogueResponse`.

| Method + path | Service | Notes |
| :-- | :-- | :-- |
| `GET /api/catalogue/list` | `list` | Extended parameters. |
| `GET /api/catalogue/item` | `detail` | — |
| `POST /api/catalogue/create` | `create` | — |
| `POST /api/catalogue/update` | `update` | 409 on a conflict. Accepts `text/plain` beacon bodies. |
| `POST /api/catalogue/media` · `POST /api/catalogue/media/reorder` | `applyMedia` · `reorderMedia` | — |
| `POST /api/catalogue/status` | `setStatus` | Age gate kept. |
| `POST /api/catalogue/batch` | `batch` | Age gate when the action publishes. |
| `POST /api/catalogue/duplicate` | `duplicate` | — |
| `GET /api/catalogue/analytics?scope=&period=` | `overview` | — |
| `GET /api/catalogue/clients?listing=&scope=` · `GET /api/catalogue/clients/[handle]` | `pipeline` · `client` | — |
| `GET/PUT /api/scheduling/presets` · `POST /api/scheduling/presets/archive` | presets | **Refused for 13–17-year-olds** (#208). |
| `POST /api/catalogue/availability` | `bindListing` | — |
| `GET /api/catalogue/simulate/slots` | `BookingBackendService.simulatedSlots` | The buyer simulation's slot grid, read as the owner (C14; Decision #217 (j)). A read; the simulation commits nothing. |
| `POST /api/scheduling/cron/horizon` | `extendHorizons` | Vault bearer only. |

---

## 10. Dev Context Switcher, docs & tests

**New simulatable axes** (§5). Each is added to `DevOverrides` + `DEV_DEFAULTS`, a `DevOption`
list, a `DevContextPanel` control, and `reflect()` with both set and delete:

| Axis | Values | Seam |
| :-- | :-- | :-- |
| `catalogueAnalytics` | `auto` · `empty` · `sparse` · `rich` | `data-dev-catalogue-analytics`. The service's fixture path returns the matching shape when `*_BACKEND_LIVE` is off. |
| `clientPipeline` | `auto` · `empty` · `action_required` · `busy` | `data-dev-client-pipeline` |
| `availabilityConflict` | `auto` · `call_outside_work` · `empty_horizon` | `data-dev-availability-conflict`. Drives the `Issues` and readiness states. |

**Docs that change in the same prompts:**
- `ROUTING.md` (the routes in §6.1 and the URL contract).
- `PRODUCT_SPEC.md` sitemap (`/catalogue` views and tabs).
- `flows/ServiceCreation.md` (§1.1 intake editor now built, §1.3 provider per listing, the
  availability binding).
- `database/{catalogue,scheduling,analytics,comms,search,marketplace}/*`.
- `DESIGN_SYSTEM.md` §C.1 (`ShowcaseGrid`, charts, `MoneyInput`, `NumberStepper`, `DurationPicker`,
  `TagCombobox`, `AvailabilityScheduler`) and §C.5 (the SVG and Canvas2D tiers are shipped).
- `PRODUCT_MANAGEMENT.md` (a note that client lanes are derived and presets are archived, not
  deleted).
- Decision #217.

**Tests.** Every prompt lists its own tests (Part 2). The cross-cutting suites are:
- **RRULE.** Round-trip property tests over generated drafts. A golden table of 40 RRULEs against
  hand-computed occurrence lists across DST in Europe/London, America/New_York and
  Australia/Sydney, including leap years and month ends.
- **Evaluator.** Precedence, ties, clipping, gaps and overlaps.
- **URL resolvers.** Totality fuzzing and round-trips (`parse(href(x)) ≡ x`).
- **Card fidelity.** `assemble` against `listingCardItem` over all seeded listings.
- **Probes.** SQL probes in `BEGIN … ROLLBACK` for every new door and the gate branch.
- **Routes.** Contract tests: 401, 422 and 409 paths, and `/catalogue/new` never rendering.
- **Playwright smoke.** Create → media → publish → preview → analytics → clients drawer.

---

## 11. Risks

| Risk | Mitigation |
| :-- | :-- |
| Two availability models coexist (weekly bands and presets) | Mirror the default preset's weekly subset (§5.6). Name the gap in the UI. Make the follow-up an explicit flag (**d**). |
| The occurrence horizon goes stale if the cron fails | The `ops.fn_watch_jobs` alert, plus a lazy recompile when `compiled_through < slot end` on a booking read. |
| Changing `media: string[]` breaks the explore assembler and fixtures | One prompt (C3 + C6) changes types, SQL, assembler and fixtures together. `deno task check` gates it. |
| The iframe preview doubles SSR cost | It reloads only on `saved`, and `previewView` reuses the per-request cache. |
| Analytics on sparse data mislead | Sufficiency thresholds (flag **k**), and tiles say "Not enough data yet" instead of 0%. |
| Scope creep in the client drawer | The drawer **hands off** (deep links to the canonical ticket, submission and calendar surfaces). It acts inline only for reply, accepting or proposing a reschedule, and opening a review. |
