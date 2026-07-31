# Catalogue — Layout & Region-Discipline Audit

> **Status: all 25 fixes applied and verified in-browser (2026-07-31).** See §12 for the outcome
> record, including three defects found _during_ the fix pass that were not in the original audit.

Date: 2026-07-31 · Scope: `apps/web/routes/(dashboard)/catalogue/{index,[id]}.tsx` +
`apps/web/features/catalogue/**` Method: source read + **measured in-browser**, as one composed page
rather than a component set. Dark theme, 1512 / 900 / 390 px, `dir=ltr` and `dir=rtl`, grid **and**
list presentations.

Measurement environment: a detached git worktree at `c2e7180` with the 31 modified tracked files
copied in, served on port 7483. This was necessary because a **concurrent session** is mid-build on
the messaging feature — its untracked `apps/web/features/messaging/islands/InboxView.island.tsx`
imports a `../styles/inbox.css` that does not exist yet, and Fresh's eager island discovery turns
that into a 500 on _every_ route in the app. That is the other session's in-flight state, not a
defect in this tree, and it was deliberately not touched. The measurements below therefore reflect
the working tree minus that one concurrent edit.

Mechanical detector (`detect.mjs --scope layout`) over the whole surface: **clean, 0 findings** —
every issue below is structural, not raw-value drift.

Judged against `DESIGN_SYSTEM.md` §B.4 (separation), §B.6 (icon-first density), §B.7 (iconography),
§B.8 (buttons), §B.9 (cards), §B.10 (overlays), the field contract (Decision #62), Part D (shell),
and the `/wallet` region contract (root `CLAUDE.md` Decision #60).

---

## 0. The one-paragraph verdict

The Catalogue has the best _lane_ in the application and the worst _use of the frame around it_.
`CatalogueLane` is composed almost entirely from the shared `@projective/ui/navigation` chrome, it
groups by status, it owns the create action, and it is genuinely exemplary. Then both routes throw
the rest of the contract away: **neither `/catalogue` nor `/catalogue/[id]` renders a header band at
all** (`middleNavHeaderFor` has no catalogue branch, and `catalogue.css:524` states the omission as
a fact rather than a bug), the footer band is claimed only for the exact path `/catalogue` so the
manage page renders **bandless in both directions**, and everything the bands were built for —
identity, search, filters, sort, the analytics scope switch, Publish, Archive, the save-state
indicator — is stacked into the scrolling body. The costs are measurable and they are not stylistic.
The largest, boldest type on the console is a **KPI value at 24px/700 — 63% larger than a listing
title at 14.72px/600** — so the eye lands on five decorative numbers before any of the sixteen
listings. Those numbers keep reporting **"9 active listings" while the body beneath them reads "0
listings"**. The list view's fixed 1136px column grid **never fits its container at any viewport
width**, and because every ancestor is `overflow: visible` up to a `clip`, it is destroyed without a
scrollbar: 7px of _Edited_ at 1512px, **five of eight columns including Price at 900px**, six of
eight at 390px, with `document.scrollWidth` _smaller_ than the viewport in every case. A failed API
call renders the **full unfiltered list under a search term that matched nothing**, with no error,
no notice and no busy state. And on mobile the lane is `display: none`, which takes the surface's
single most important verb — **"New listing" measures 0×0 at 390px** — with it.

---

## 1. VISUAL HIERARCHY — the squint test

### 1.1 What the eye lands on

| Route             | 1st                                                  | 2nd                   | 3rd                                 | Should be                            |
| ----------------- | ---------------------------------------------------- | --------------------- | ----------------------------------- | ------------------------------------ |
| `/catalogue`      | The **KPI numbers** (24px/700, five of them)         | The card grid         | The glass toolbar pill              | The listing you came to act on       |
| `/catalogue/[id]` | The **form** (626px column, 5 sections, 1080px tall) | The live preview card | The action bar — which scrolls away | **Publish**, and what is blocking it |

### 1.2 The type ramp, measured

Every distinct rendered size/weight inside `.cat-console` at 1512px:

| Size / weight  | Count | Example                                       |
| -------------- | ----- | --------------------------------------------- |
| **24px / 700** | 5     | `.cat-tile__value` — the KPI figures          |
| 14.72px / 600  | 16    | `.cat-card__link` — **the listing titles**    |
| 13.44px / 600  | 16    | `.cat-card__price`                            |
| 13px / 400–600 | 3     | `.ui-sort__*`, `.ui-multiselect__placeholder` |
| 12.8px / 700   | 1     | `.cat-analytics__title`                       |
| 11.84px / 400  | 69    | `.cat-tile__label`, `.cat-card__kind`, …      |
| 10.88px / 600  | 18    | `.cat-card__status`, `.cat-card__flag`        |

There is **no `<h1>` on the surface**. The largest heading element is an `<h2>` reading "Analytics"
at 12.8px. The page never names itself; the tab title does the work the page will not.

### 1.3 The single most important element, and whether it wins

The Catalogue console exists so a seller can **find one listing and act on it** — publish the draft,
fix the paused one, price the new one. The most important element is therefore the listing itself,
and after it, the create action.

**It does not win.** Measured at 1512×945:

| Band                                                          | y       | height |
| ------------------------------------------------------------- | ------- | ------ |
| `.fx-toolbar` (search · type · sort)                          | 72      | 48     |
| `.cat-analytics` (heading + period switch + 5 tiles + a link) | 136     | 115    |
| `.cat-console__count` ("16 listings")                         | 267     | 19     |
| **first `.cat-card`**                                         | **302** | 317    |

**302px — 32% of the viewport — sits above the first listing**, and 115px of it is an analytics
block whose figures are the loudest thing on screen. On the manage page the inversion is sharper
still: **`.cat-editor__bar` is `position: static`**, so scrolling to the bottom of the 1264px
document puts Publish at **y = −247, off-screen**, while the sticky preview aside keeps the "Ready
to publish" gate visible at y = 613. The gate that _describes_ the action outlives the action
itself.

**Verdict: the hierarchy fails on both routes** — on the console because a decorative KPI row
outweighs the data, on the manage page because the primary action is neither pinned nor banded.

---

## 2. REGION DISCIPLINE — the misplacement table

The contract (`/wallet`, Decision #60): **LANE** owns navigation and scope · **HEADER BAND** owns
identity and global controls · **FOOTER BAND** owns actions and density · **BODY** owns viewing and
selecting data only — no tabs, no filter dropdowns, no primary CTAs.

### 2.1 Slot occupancy

| Route             | LANE               | HEADER BAND             | FOOTER BAND                           | Verdict                                  |
| ----------------- | ------------------ | ----------------------- | ------------------------------------- | ---------------------------------------- |
| `/catalogue`      | `CatalogueLane` ✅ | **—** (measured absent) | `CatalogueViewControlRig` (zoom only) | toolbar + KPI + scope switch in body     |
| `/catalogue/[id]` | `CatalogueLane` ✅ | **—**                   | **—**                                 | **whole page in body, both bands empty** |

`middleNavHeaderFor` (`apps/web/routes/(dashboard)/_layout.tsx:94-97`) composes five resolvers;
**none of them is a catalogue resolver.** There is no `catalogueHeaderFor` anywhere in the tree.
`catalogue.css:524` records the consequence in a comment — _"the console has no middle-nav header
band"_ — and then compensates by re-pinning the in-body toolbar to `--shell-topbar-h` instead.

`catalogueFooterFor` (`catalogue-footer-slot.tsx:15`) returns `null` unless `segs.length === 1`, so
the manage page is deliberately excluded. `/wallet` does the opposite, and its own doc comment says
why: _"unlike its siblings this resolver is not scoped to one page."_

### 2.2 Every misplaced control

| #  | Control                                                        | Currently in           | Belongs in                | Evidence                                                                                                                                                                                   |
| -- | -------------------------------------------------------------- | ---------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1  | **Publish** (`variant="filled" severity="primary"`)            | BODY                   | FOOTER band               | `ListingEditor.island.tsx:254-263` — measured `rgb(0,146,158)`, 93×32 at y=72, scrolls to **y=−247**                                                                                       |
| 2  | **Pause** / **Archive**                                        | BODY                   | FOOTER band               | `ListingEditor.island.tsx:244-272`                                                                                                                                                         |
| 3  | **Save-state indicator** ("All changes saved" / "Saving…")     | BODY                   | HEADER band               | `ListingEditor.island.tsx:234-240` — an autosave signal that scrolls out of view is not a signal                                                                                           |
| 4  | Listing **identity** (status chip · title context · back link) | BODY                   | HEADER band               | `ListingEditor.island.tsx:230-241`                                                                                                                                                         |
| 5  | Console **search**                                             | BODY `.fx-toolbar`     | HEADER band               | `CatalogueScreen.island.tsx:226-242`                                                                                                                                                       |
| 6  | **Type filter** `MultiSelect` ("All types")                    | BODY `.fx-toolbar`     | LANE (it already has one) | `CatalogueScreen.island.tsx:244-253` — a filter dropdown in the body, explicitly banned                                                                                                    |
| 7  | **SortControl**                                                | BODY `.fx-toolbar`     | FOOTER band               | `CatalogueScreen.island.tsx:254-262` — its sibling density control is already in the footer                                                                                                |
| 8  | **Analytics period switch** (7d / 30d / 90d)                   | BODY                   | HEADER band               | `CatalogueScreen.island.tsx:268`, `:349-366` — a global scope control. Its own JSDoc calls it "relocated here from the lane footer"; `catalogue.css:263` still labels the block "(footer)" |
| 9  | **"Full analytics →"**                                         | BODY (a KPI grid cell) | —                         | `AnalyticsStrip.tsx:82` — see §9, the link is dead                                                                                                                                         |
| 10 | Result **count** ("16 listings")                               | BODY, own 19px row     | HEADER band               | `CatalogueScreen.island.tsx:275-277`                                                                                                                                                       |

Correctly placed, for contrast — and this is the surface's real strength: the type `LaneTabs`
(`CatalogueLane.island.tsx:202-207`), the lane search (`:210-216`), the delivery-model Filter
popover (`:218-247`), the quick-filter toggle row (`:250-255`), the status-section accordion
(`:258-297`), the collapse button and the **New listing** primary in the lane footer (`:299-357`),
and the zoom rig in the frame's footer band (`CatalogueViewControlRig.island.tsx`). That is seven
controls in the right region — more than any sibling surface manages.

### 2.3 The measurement that settles it — two searches that do not talk

`/catalogue` ships **two search fields**, both labelled _Search_, in two regions, with different
scopes and no shared state. Typing `zzqq` into the body search:

|                           | Body (`.fx-toolbar input`)                       | Lane (`.ui-lane-search input`) |
| ------------------------- | ------------------------------------------------ | ------------------------------ |
| value after typing `zzqq` | `zzqq`                                           | empty                          |
| result                    | `.cat-empty` — _"No listings match your search"_ | **16 rows, unchanged**         |
| scope                     | server refetch, all statuses                     | client narrow, all statuses    |

The seller sees an empty console sitting beside a full listing list, in the same viewport, at the
same moment. Neither field indicates it is the narrower one.

### 2.4 Two filled primaries, simultaneously, in two regions

Measured on `/catalogue/sv-realtime-mvp-build` (a draft):

| Control         | Region          | background         | color                |
| --------------- | --------------- | ------------------ | -------------------- |
| **New listing** | LANE footer     | `rgb(0, 146, 158)` | `rgb(235, 253, 255)` |
| **Publish**     | BODY action bar | `rgb(0, 146, 158)` | `rgb(235, 253, 255)` |

Byte-identical fills, two regions, one screen. §B.8's one-primary-per-region rule is satisfied
literally and violated in spirit: the user is offered two equally-weighted "do the important thing"
buttons that do unrelated things.

---

## 3. SPATIAL RHYTHM

### 3.1 Four sections, one spacing value — and it is smaller than the intra-group gap

Measured gaps between the console's four direct children at 1512px:

| From                               | To                              | gap      |
| ---------------------------------- | ------------------------------- | -------- |
| `.fx-toolbar` bottom (120)         | `.cat-analytics` top (136)      | **16px** |
| `.cat-analytics` bottom (251)      | `.cat-console__count` top (267) | **16px** |
| `.cat-console__count` bottom (286) | `.cat-workspace` top (302)      | **16px** |

`.cat-console { gap: var(--space-4) }` (`catalogue.css:531`) is applied once and never varied. Four
structurally unrelated regions — a control bar, an analytics block, a status line, and the data
itself — are separated by exactly the same interval. There is no cadence, so nothing groups.

Then, inside the analytics block, `.cat-kpis { gap: var(--space-5) }` (`catalogue.css:587`) measures
**24px**. **The gap between two tiles of one group is 50% larger than the gap between the group and
the unrelated section beside it.** Proximity is not merely absent here; it is inverted, and it
actively argues that the five tiles are _less_ related to each other than the toolbar is to the
grid.

This is the cheapest structural fix in the report and it needs no new tokens.

### 3.2 Borders are _not_ compensating — §B.4 holds

Genuinely good, and worth protecting: there is **no four-sided border on non-interactive content**
anywhere in the surface. The KPI tiles are deliberately unboxed, with a comment
(`catalogue.css:590-598`) explaining that the wrapping `auto-fit` grid rules out a sibling hairline
because it would draw a stray leading edge on each wrapped row. The preview panel dropped its frame
for the same reason and says so (`catalogue.css:1369-1374`). Separation is spacing, tonal tint and
type weight throughout. The problem in §3.1 is that the spacing was then never varied.

### 3.3 Outer padding disagrees with the surface it borrows its toolbar from

| Surface                             | inline             | block                     | file                         |
| ----------------------------------- | ------------------ | ------------------------- | ---------------------------- |
| `.cat-console` / `.cat-editor`      | `--space-5` (24px) | `--space-5` / `--space-8` | `catalogue.css:532`, `:1170` |
| `.fx-explorer` (same `.fx-toolbar`) | `--space-4`        | `--space-3` / `--space-6` | `file-explorer.css:17-18`    |

The Catalogue reuses the File Explorer's toolbar verbatim — correctly, and by design — but sets a
content edge one full step further in. Navigating `/files` → `/catalogue` shifts the whole column.

### 3.4 One thing this surface gets exactly right

`.cat-table__head` pins at `calc(--shell-topbar-h + --cat-toolbar-h − --space-4)`
(`catalogue.css:992-994`). Measured at `scrollY 494`: the toolbar's bottom edge is at **104px** and
the sticky column header's top edge is at **104px** — **a 0px gap, perfectly flush**. The sibling
file table pins at 96 and does not achieve this. Do not disturb it when moving the toolbar.

---

## 4. DENSITY

### 4.1 The analytics block _grows_ as the viewport shrinks

`.cat-kpis` is `repeat(auto-fit, minmax(9.5rem, 1fr))` (`catalogue.css:584`) over **six** cells —
five stat tiles plus the "Full analytics" link, which occupies a full tile-width grid cell.

| Viewport | columns     | block height | share of viewport height |
| -------- | ----------- | ------------ | ------------------------ |
| 1512     | 6 × 164px   | **115px**    | 12%                      |
| 900      | 2 × 234.5px | **245px**    | 27%                      |
| 390      | 2 × 159px   | **245px**    | **29%**                  |

At 390px, nearly a third of the screen is spent on five numbers and a dead link before the seller
sees a single listing. The block that should yield first is the one that expands.

### 4.2 Row density

| Presentation                          | model                   | measured               |
| ------------------------------------- | ----------------------- | ---------------------- |
| `.cat-card` grid (default, zoom 0.62) | zoom ramp `196–372` col | 358×317, 3/row at 1512 |
| `.cat-trow` list (zoom 0.2)           | zoom ramp `48–84`       | 62px rows, 16 rendered |
| `.cat-lrow` lane row                  | fixed                   | 32px                   |

The zoom rig genuinely drives both presentations — unlike `/projects`, where the same rig is inert
on three of five list surfaces. This is correct and consistent.

### 4.3 Eight columns, and the one you scan by is the narrowest

`ListingTable.tsx:28-37`:

| Column      | width     | sortable  |
| ----------- | --------- | --------- |
| **Listing** | **220px** | ❌ **no** |
| Status      | 112px     | ✅        |
| Type        | 148px     | ❌        |
| Price       | 132px     | ✅        |
| Views       | 88px      | ❌        |
| Orders      | 88px      | ✅        |
| Rating      | 92px      | ✅        |
| Edited      | 160px     | ✅        |

The four metric columns total **356px** against the listing name's **220px**. The name is the only
column a seller scans by and the only content column that **cannot be sorted** — while `Views`
cannot be sorted but `Orders` beside it can, for no reason visible in the UI. `Type` duplicates the
kind glyph already rendered inside `.cat-trow__thumb`.

---

## 5. SCANNABILITY — can a user find one row in under three seconds?

| Presentation                | Verdict                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Card grid** (the default) | ⚠️ 3 per row at 1512px, 317px tall, 2-line clamped titles. Sixteen listings fill 1836px — you scroll to see half your own catalogue.                                                                    |
| **List table**              | ❌ **No — it is clipped at every width** (§7.1). At 1512px you lose 7px of _Edited_; at 900px you lose _Price, Views, Orders, Rating, Edited_; at 390px, six of eight columns.                          |
| **Lane list**               | ✅ **Yes.** Status-grouped, 32px rows, thumbnail + title + signal dots, searchable and filterable in place. This is the fastest way to find a listing on the surface — and it is in the correct region. |

**What is in the way:** the grid is the default, the table is reachable only by discovering that an
unlabelled zoom slider in the footer band also changes view _mode_, and the table is broken when you
get there. The lane — the one component that answers the question in under three seconds — is the
one the mobile breakpoint deletes.

---

## 6. EMPTY, LOADING, ERROR, PARTIAL

| State              | Console                                                                  | Manage page                             |
| ------------------ | ------------------------------------------------------------------------ | --------------------------------------- |
| Empty (unfiltered) | ✅ **designed, with an action** — glyph, title, note, `+ New {noun}` CTA | n/a                                     |
| Empty (filtered)   | ⚠️ no action — _"Try clearing the search"_ with nothing to click         | n/a                                     |
| Loading            | ❌ **none**                                                              | ❌ none                                 |
| Error              | ❌ **none**                                                              | ⚠️ `notice` only, for lifecycle actions |
| Partial            | ✅ infinite paging via `onReachEnd`                                      | ✅ publish-readiness checklist          |

### 6.1 The good one, stated plainly

`CatalogueEmpty`'s unfiltered branch (`CatalogueScreen.island.tsx:388-403`) is the **best empty
state in the codebase**: it names the next action ("Create your first product"), explains the
lifecycle it teaches ("draft, price, publish"), and ships a working button that opens the create
modal. The `/projects` audit found 0 of 6 empty states with an action. This one has it. Keep it.

The filtered branch (`:377-386`) does not, and it is the branch a seller will actually hit.

### 6.2 Loading is declared and never rendered

`loading` and `loadingMore` signals exist (`CatalogueScreen.island.tsx:74-75`). `loading` reaches
exactly one attribute — `aria-busy` on `.cat-workspace` (`:279`). `loadingMore` reaches **nothing**.
There is no skeleton, no spinner, no dimming. Between keystroke and result the surface is
indistinguishable from an idle one.

### 6.3 A failed request renders a confident lie — measured

`reload()` (`CatalogueScreen.island.tsx:95-109`) commits state only inside `if (res.ok && res.data)`
and has **no `else`**. `loadMore()` (`:111-123`) is identical. A failure is not surfaced, not
logged, and not distinguishable from success.

Measured, with `/api/catalogue` stubbed to `500`:

|                       | before        | after typing `zzqqzz`                        |
| --------------------- | ------------- | -------------------------------------------- |
| search box            | empty         | **`zzqqzz`**                                 |
| `.cat-console__count` | "16 listings" | **"16 listings"**                            |
| rows rendered         | 16            | **16** (first row still _Motion primitives_) |
| notice / `role=alert` | —             | **none**                                     |
| `aria-busy`           | —             | **null**                                     |

The console reports sixteen results for a query that returned nothing, under a term that matches
none of them, with no indication anything went wrong. If the prior state happened to be empty, the
same failure renders _"No listings match your search"_ instead — **a backend outage and a
zero-result search are the same screen, in both directions.**

### 6.4 The KPI row contradicts the body it sits on

With the body filtered to zero results, the tiles still read:

> Active listings **9** · 14 total | Views · 30 days **3,784** | Orders **233** | Revenue **$69.4K**
> | Avg rating **4.5**

directly above `.cat-console__count` reading **"0 listings"**. The analytics block is scope-blind:
it does not respond to the search, and nothing on it says which set it describes. Two numbers about
the same catalogue, 130px apart, disagreeing.

---

## 7. RESPONSIVE — desktop → tablet → mobile

### 7.1 The list table is clipped at **every** width, including 1512px

`TEMPLATE` (`ListingTable.tsx:39`) joins eight fixed widths; the leading `minmax(220px, 1fr)`
resolves to a flat **220px** because `1fr` cannot shrink below the sum of the fixed tracks. Total
required: **1136px**.

| Viewport | container | table needs | clipped                                             |
| -------- | --------- | ----------- | --------------------------------------------------- |
| 1512     | 1105      | 1136        | 7px of _Edited_                                     |
| 900      | 493       | 1136        | **Price · Views · Orders · Rating · Edited**        |
| 390      | 342       | 1136        | **Type · Price · Views · Orders · Rating · Edited** |

**Proven unreachable at 900px.** Walking the ancestor chain from `.cat-table`:

```
.cat-table              overflow-x visible   scrollW 1136  clientW  493
.cat-workspace          overflow-x visible   scrollW 1136  clientW  493
.cat-console            overflow-x visible   scrollW 1160  clientW  541
.ui-page-canvas__body   overflow-x visible   scrollW 1160  clientW  541
.ui-page-canvas         overflow    clip     scrollW 1160  clientW  541   ← destroyed here
BODY                                         scrollW  885  clientW  885
document.scrollWidth    885   <   innerWidth 900                          ← no scrollbar
```

Setting `scrollLeft = 9999` on every ancestor moves nothing (`anyAncestorScrolledX: false`);
`window.scrollX` stays `0`; the _Price_ header's right edge remains at **1028px** in a 900px
viewport. This is the same `1fr` + `overflow: clip` failure class the `/projects` audit found at
390px — but here it bites at **tablet** width and it takes **Price**, the one column a seller cannot
work without.

### 7.2 Mobile (390px) — the primary action is deleted

`.ui-app-shell__sidebar` and `.ui-middle-nav__lane` are both `display: none` below `--bp-md`. The
lane is where the Catalogue keeps **New listing**, and it is measured at **0 × 0** at 390px.

Lost with the lane, with no replacement anywhere:

| Control                                                   | Only home           | Reachable at 390px? |
| --------------------------------------------------------- | ------------------- | ------------------- |
| **New listing** (the surface's primary verb)              | lane footer         | ❌ **no**           |
| Status sections (Published / Drafts / Paused / Archived)  | lane list           | ❌ no               |
| Quick filters (Needs attention · Promoted · Best-selling) | lane toggles        | ❌ no               |
| Delivery-model filter                                     | lane Filter popover | ❌ no               |
| Collapse toggle                                           | lane footer         | ❌ no               |

A seller on a phone can browse their catalogue and open a listing, but **cannot create one** unless
their catalogue is empty — the only other `+ New` on the surface is inside `CatalogueEmpty`
(`CatalogueScreen.island.tsx:399-401`), which by definition never renders when they have listings.

The body toolbar survives, which means the _misplaced_ type filter (§2.2 #6) is the only filter that
still works on mobile. Fixing region discipline without giving the lane a mobile home would remove
the last one.

Also at 390px: `.cat-console` keeps `padding-inline: 24px` unchanged, and the search field collapses
to **85px**.

### 7.3 Tablet (900px) — holds apart from the table

Lane stays 280px, rail stays 64px, toolbar keeps all three controls on-screen,
`scrollWidth 885 ≤
900`. The only failure is §7.1.

---

## 8. RTL — clean

**Layout mirrors correctly.** Measured at 1512px with `dir` flipped live:

| Element                      | LTR x | RTL x |
| ---------------------------- | ----- | ----- |
| Global rail                  | 0     | 1433  |
| Lane                         | 64    | 1153  |
| `.cat-console` / footer band | 344   | 0     |
| `.fx-toolbar__search`        | 368   | 777   |
| First `.cat-tile`            | 368   | 965   |
| Lane **New listing**         | 194   | 1173  |

`document.scrollWidth` is **1497 in both directions** — zero horizontal overflow either way. A grep
of `catalogue.css` (1,466 lines) for
`margin-left|margin-right|padding-left|padding-right|border-left|border-right|left:|right:|text-align: left|right|translateX`
returns **zero matches**. The logical-property discipline is complete and there is not a single
`[dir="rtl"]` override in the feature, because none is needed.

Two notes, neither an RTL defect of this surface:

- The 18 elements measured outside the viewport in RTL are the §7.1 table columns mirrored — the
  same fixed 1136px grid clipping at the opposite edge (`minX: −7`). Fix §7.1 and this goes with it.
- `SidebarToggleIcon`'s `transform: translateX(6px)` measures `matrix(1,0,0,1,6,0)` in both
  directions. That is the shared shell glyph already logged in the `/projects` audit, not catalogue
  code.

---

## 9. ANTI-PATTERNS

| # | Pattern                                  | Found?                                       | Evidence                                                                                                                                                                                                                                                                                                                                                           |
| - | ---------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A | **Nested containers**                    | ✅ none                                      | `.cat-console` pads once; `.cat-workspace` adds nothing. No double-padding misalignment                                                                                                                                                                                                                                                                            |
| B | **Redundant separation**                 | ✅ none                                      | No four-sided borders on non-interactive content; §B.4 holds throughout (§3.2)                                                                                                                                                                                                                                                                                     |
| C | **Competing primary actions**            | ❌                                           | Lane **New listing** and body **Publish** are the same filled `rgb(0,146,158)` on one screen (§2.4)                                                                                                                                                                                                                                                                |
| D | **Colour as sole meaning carrier**       | ✅ none                                      | `.cat-card__status` prints its status word; `.cat-secdot` sits beside a text label; `--alert` carries a glyph **and** a `Tooltip` (`ListingCard.tsx:66-76`)                                                                                                                                                                                                        |
| E | **A KPI row that says nothing**          | ❌ **the sharpest instance in the codebase** | Five tiles that ignore the active search, contradict the count 130px below them (§6.4), dominate the type ramp (§1.2), and expand to 29% of a mobile viewport (§4.1)                                                                                                                                                                                               |
| F | **Chart present for decoration**         | ❌                                           | `Sparkline` (`AnalyticsStrip.tsx:126-158`) renders a 96×22 unlabelled polyline with no axis, no scale and no tooltip. Its own `delta` is derived from the same `trend` array's first→last, so the number beside it already carries every fact the line does                                                                                                        |
| G | **A table of every field**               | ⚠️                                           | 8 columns where the sibling file table restrains itself to 4; `Type` duplicates the row thumbnail's glyph; three separate metric columns (§4.3)                                                                                                                                                                                                                    |
| H | **Duplicate control in two regions**     | ❌ **twice**                                 | **Search** — lane + body, different scopes, no shared state (§2.3). **Type filter** — lane `LaneTabs` + body `MultiSelect`, both navigating `segmentHref`                                                                                                                                                                                                          |
| I | **Dead link**                            | ❌                                           | `AnalyticsStrip.tsx:82` links `/catalogue?view=analytics`. Grep across the feature and route: **`view` is read by nothing** — the handler parses only `type`/`sort`/`search` (`index.tsx:22-24`). The link reloads the identical page                                                                                                                              |
| J | **Control that lies about its type**     | ❌                                           | The body `MultiSelect` (`CatalogueScreen.island.tsx:244-253`) offers two options, but selecting _both_ collapses to `all` (`:134`) — identical to selecting neither. A multi-select whose only multi state is indistinguishable from empty                                                                                                                         |
| K | **A focus indicator actively removed**   | ❌                                           | `catalogue.css:1358-1361` — `.cat-textarea:focus-visible { outline: none; border-color: var(--primary) }`. This is the exact pattern the field audit (Decision #62) condemned in `auth.css`. Canonical is `box-shadow: var(--focus-ring-shadow)`                                                                                                                   |
| L | **Raw control where a primitive exists** | ❌                                           | `ListingEditor.island.tsx:499-509` renders a bare `<textarea class="cat-textarea">` (`catalogue.css:1346-1361`) instead of the `@projective/ui` `Textarea`, so it misses the whole `--fld-*` state model beside nine sibling fields that use it                                                                                                                    |
| M | **Two inks on one fill**                 | ⚠️                                           | `.cat-lane__newbtn` uses `--on-primary` on `--primary` (measured **3.57:1**); `.cat-empty__cta` (`:1153`), `.cat-rail__new` (`:429`) and `.cat-avail__day[data-on]` (`:1342`) use `--surface` on the same fill (measured **4.95:1**). Same fill, two inks, one feature — and the non-canonical one measures better, which is a token-layer signal worth passing on |
| N | **Hardcoded colour keyword**             | ❌                                           | `catalogue.css:98` — `color-mix(in srgb, var(--primary) 88%, black)`. Two sibling primaries hover by `filter: brightness(1.06)` (`:433`, `:1160`); three hover treatments for one pill                                                                                                                                                                             |
| O | **Arbitrary viewport unit**              | ⚠️                                           | `catalogue.css:551` — `.cat-workspace { min-block-size: 40vh }`, a magic number on no scale                                                                                                                                                                                                                                                                        |

### 9.1 Fourteen hand-rolled controls, one canonical focus ring

Querying the live CSSOM for a `:focus-visible` rule on each local control class:

**Declares one:** `.cat-lane__newbtn` (canonical `--focus-ring-shadow`) · `.cat-textarea` (the
broken one, item K).

**Declares none — 14:** `.cat-period__btn` · `.cat-empty__cta` · `.cat-newmenu__item` ·
`.cat-menu__item` · `.cat-model-pill` · `.cat-filter__reset` · `.cat-th__btn` · `.cat-trow` ·
`.cat-card__kebab` · `.cat-avail__day` · `.cat-media__remove` · `.cat-lrow` · `.cat-rail__new` ·
`.cat-rail__item`.

These fall through to the UA outline, so they are _reachable_ — this is a consistency finding, not
an accessibility failure, and it is a much smaller problem than item K, where the outline is removed
and replaced with a border tint. But `.cat-empty__cta` and `.cat-rail__new` are re-declared filled
primary pills that `@projective/ui` `Button` already ships under §B.8.

### 9.2 Stale documentation, three places

`AnalyticsStrip.tsx:13-14` says the period is chosen by "the lane footer's period selector";
`catalogue.css:263` labels the block "Analytics period selector (footer)". The selector is in the
**body** (`CatalogueScreen.island.tsx:268`), and `CatalogueScreen`'s own JSDoc (`:34-36`) describes
a header band with "underlined segment tabs · search · SortControl" that **does not exist** — the
tabs were retired (`:132`) and no header band is ever rendered. Three comments describing three
different layouts, none of them the shipped one.

---

## 10. RANKED FIX LIST

Each item is independently landable. `file:line` verified against the working tree at `c2e7180` plus
the staged card-system changes.

### P0 — the surface is broken here

**1. The list table is clipped at every viewport width, with no scrollbar.**
`apps/web/features/catalogue/components/ListingTable.tsx:28-39` — eight fixed tracks sum to 1136px
against a 1105px container at 1512px, 493px at 900px, 342px at 390px. Either give `.cat-table` an
`overflow-x: auto` of its own, or make the template responsive (drop `Type`, collapse the three
metric columns below `--bp-lg`, and let `Listing` take `minmax(0, 2fr)`). _(Measured: 5 of 8 columns
including Price unreachable at 900px; every ancestor `scrollLeft` write is a no-op;
`document.scrollWidth` 885 < 900.)_

**2. A failed request renders the full unfiltered list under a non-matching query.**
`islands/CatalogueScreen.island.tsx:95-109` and `:111-123` — both commit only inside
`if (res.ok && res.data)` with no `else`. Add an error branch that sets `notice` and a distinct
error state, so an outage stops looking like a result. _(Measured with the API stubbed to 500:
search box `zzqqzz`, count "16 listings", 16 rows, zero alerts, `aria-busy` null.)_

**3. Mobile deletes the surface's primary verb.** `New listing` lives only in the lane footer
(`islands/CatalogueLane.island.tsx:306-356`) and the lane is `display: none` below `--bp-md` —
measured **0×0** at 390px. A seller with listings cannot create one on a phone. Give the lane a
mobile home (a `Drawer`, consistent with Part D.3), or surface the create action in the mobile
footer band.

**4. `/catalogue/[id]` renders with both bands empty and its primary action in the scroll flow.**
`core/catalogue-footer-slot.tsx:15` excludes the manage page (`segs.length !== 1`), and
`routes/(dashboard)/_layout.tsx:94-97` has no catalogue header resolver at all. Publish, Pause,
Archive, the save-state indicator and the identity block all sit in `.cat-editor__bar`, which is
`position: static` and scrolls to **y = −247**. Add `catalogueHeaderFor` (identity · status chip ·
save state) and widen `catalogueFooterFor` to claim every `/catalogue*` route with a per-route body
— the `/wallet` shape. Reference: `features/wallet/core/wallet-footer-slot.tsx:11-13`, `:25-41`.

### P1 — fix before this surface ships

**5. Give `/catalogue` a header band and empty the body toolbar into it.** Search
(`CatalogueScreen.island.tsx:226-242`) and the result count (`:275-277`) → header band; sort
(`:254-262`) → footer band beside the zoom rig it already shares a region with; the type
`MultiSelect` (`:244-253`) → **delete**, the lane's `LaneTabs` already owns type. Keep
`.cat-table__head`'s sticky offset flush when `--cat-toolbar-h` changes (`catalogue.css:992-994` —
currently a measured perfect 0px seam; do not regress it).

**6. Resolve the two searches.** Either bridge them through a shared signal (the
`filter-bridge`/`board-state` pattern already used twice in this codebase) or delete one. Today they
disagree on screen: body says "No listings match", lane shows 16 rows.

**7. Make the analytics block answer to the active scope, or say what it describes.**
`components/AnalyticsStrip.tsx` — the tiles report the unfiltered catalogue while
`.cat-console__count` reports the filtered one, 130px apart. At minimum, label the scope; better,
recompute against the same query.

**8. Demote the KPI figures below the listing titles.** `catalogue.css:618-626` — 24px/700 makes
five numbers the loudest thing on a surface whose job is listings (§1.2). The `/wallet` precedent is
that a figure earns its size by being the page's subject; here it is not.

**9. Fix the filtered empty state.** `islands/CatalogueScreen.island.tsx:377-386` tells the seller
to "try clearing the search" and gives them nothing to click. Add a Clear button that resets `q` and
the type scope. The unfiltered branch (`:388-403`) already shows how.

**10. Add a loading state.** `:74-75` declare `loading` and `loadingMore`; `loading` reaches only
`aria-busy` (`:279`) and `loadingMore` reaches nothing. A skeleton matching the active presentation
(card grid / table rows) is the sibling-consistent answer.

**11. Restore the textarea's focus ring and use the field primitive.** `catalogue.css:1358-1361`
removes the outline and substitutes a border tint — the pattern Decision #62 condemned in
`auth.css`. Replace `ListingEditor.island.tsx:499-509`'s raw `<textarea>` with the `@projective/ui`
`Textarea` and delete `.cat-textarea` (`:1346-1361`) entirely.

**12. Remove the dead "Full analytics →" link.** `components/AnalyticsStrip.tsx:82` — `?view=` is
parsed by nothing (`routes/(dashboard)/catalogue/index.tsx:22-24`); the link reloads the same page.
Either build the route or drop the cell — it currently occupies a full KPI grid column.

### P2 — the coherence work

**13. One spacing story.** `.cat-console { gap: var(--space-4) }` (`catalogue.css:531`) is the only
interval between four unrelated sections, while `.cat-kpis { gap: var(--space-5) }` (`:587`) spaces
tiles _within_ one group more generously. Invert them: tighten the intra-group gap, open the
inter-group one.

**14. Align the content edge with the surface whose toolbar this is.** `.cat-console`/`.cat-editor`
use `--space-5` (`catalogue.css:532`, `:1170`); `.fx-explorer` uses `--space-4`
(`file-explorer.css:17`). Same toolbar, two content edges.

**15. Trim the table to the columns a seller uses**, and make `Listing` sortable
(`ListingTable.tsx:29` — `sort: null` on the only column anyone scans by). Drop `Type` (duplicated
by the row thumbnail glyph) or fold the three metric columns into one.

**16. Make the analytics block yield on small screens.** `catalogue.css:584` — `auto-fit` over six
cells produces a 245px block at both 900px and 390px, 29% of a mobile viewport. Cap it to a
horizontal scroll rail or collapse it behind a disclosure below `--bp-md`.

**17. Reconcile the create-action weight.** Lane **New listing** and body **Publish** render the
identical filled primary (§2.4). Once Publish moves to the footer band (fix #4) they no longer
compete for the same reading position — but the pills should still differ in weight.

**18. Replace the re-declared primary pills with `Button`.** `.cat-empty__cta`
(`catalogue.css:1144-1157`) and `.cat-rail__new` (`:427-434`) hand-roll what §B.8's `Button` already
ships, each with its own hover treatment (`filter: brightness(1.06)`) and its own ink (`--surface`,
not `--on-primary`).

**19. Tokenise the hover and drop the colour keyword.** `catalogue.css:98` —
`color-mix(… var(--primary) 88%, black)`; the surface has three different hover treatments for one
pill shape.

**20. Replace `min-block-size: 40vh`** (`catalogue.css:551`) with a token-scale value or a row-count
derived height.

### P3 — polish

**21. Give the console a name.** There is no `<h1>`; the largest heading on the surface reads
"Analytics" at 12.8px. If the header band lands (fix #5) it can carry the identity instead.

**22. Fix the three stale comments** describing three layouts that were never shipped:
`AnalyticsStrip.tsx:13-14`, `catalogue.css:263`, `CatalogueScreen.island.tsx:34-36` (§9.2).

**23. Either give the sparkline an axis or drop it.** `AnalyticsStrip.tsx:126-158` — a 96×22
unlabelled polyline whose entire information content is already printed as the `delta` beside it.

**24. Give the 14 hand-rolled controls the canonical focus ring** (§9.1) — `.cat-lane__newbtn`
(`catalogue.css:101-104`) already shows the one-line pattern.

**25. Reconsider the `MultiSelect` that cannot express its multi state.**
`CatalogueScreen.island.tsx:244-253` + `:134` — selecting both options is indistinguishable from
selecting neither. If it survives fix #5's deletion, it should be a `SelectButton`.

---

## 11. Positive findings

These are load-bearing and should not be disturbed by the fixes above.

- **`CatalogueLane` is the best lane in the application.** Seven controls, all in the correct
  region, all composed from the shared `@projective/ui/navigation` chrome — `LaneHead` · `LaneTabs`
  · `LaneBar` · `LaneSearch` · `LaneIconButton` · `LaneToggleRow` · `LaneList` · `LaneSections` ·
  `LaneSection` · `LaneEmpty` · `LaneFooter` · `LaneCollapseButton`. Status grouping with sensible
  defaults (Published + Drafts open, Paused + Archived closed). It is the reference the rest of the
  surface should be argued against.
- **The unfiltered empty state teaches the next action** — the only one in the codebase that does.
- **§B.4 holds completely.** Zero four-sided borders on non-interactive content, with two comments
  (`catalogue.css:590-598`, `:1369-1374`) recording _why_ a box was rejected. That is the standard.
- **RTL is genuinely correct** — zero physical properties in 1,466 lines, zero `[dir="rtl"]`
  overrides needed, `document.scrollWidth` identical in both directions.
- **The sticky table header seams perfectly** to the sticky toolbar — measured 0px gap, better than
  the sibling file table.
- **The zoom rig actually drives both presentations**, unlike `/projects` where the identical rig is
  inert on three of five list surfaces.
- **No colour-as-sole-meaning violations.** Every tinted state prints its word or carries a glyph
  plus a tooltip.
- **The toolbar is genuinely shared**, not a lookalike — `.fx-toolbar` is imported from
  `features/projects/styles/fx-toolbar.css`, so the Catalogue and the File Explorer render one
  control. The irony is that it is shared into the wrong region on both surfaces.
- **The mechanical detector is clean** over the entire surface.

---

## 12. OUTCOME — what was built (2026-07-31)

All 25 fixes applied. Verified in-browser at 1512 / 900 / 390 px, `dir=ltr` and `dir=rtl`, grid and
list presentations, light and dark themes, on both routes. `deno check` clean, `deno fmt` clean,
mechanical detector **0 findings**.

### 12.1 The regions, after

| Region                  | `/catalogue`                                                                          | `/catalogue/[id]`                                           |
| ----------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **LANE**                | type tabs · filter popover · quick filters · status sections · New listing · collapse | same                                                        |
| **HEADER band** _(new)_ | identity + live count · **the one search field** · analytics window                   | back · live title · status chip · **pinned autosave state** |
| **FOOTER band**         | density · sort · mobile-only create                                                   | **publish gate + Publish / Pause / Archive**                |
| **BODY**                | analytics · listings · empty/loading/error                                            | the form · live preview                                     |

The body toolbar, the second search field, the body type dropdown, `.cat-editor__bar`, the duplicate
readiness checklist and the dead analytics link are all gone. New: `catalogue-header-slot.tsx`,
`CatalogueHeader.island.tsx`, `ListingHeader.island.tsx`, `ListingActionRig.island.tsx`, and the
console/editor bridges in `catalogue-state.ts`. `catalogueFooterFor` now claims every `/catalogue*`
route, the `/wallet` shape.

### 12.2 Measured before → after

|                                    | before                                                        | after                                                              |
| ---------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| Header band on either route        | **absent**                                                    | 48px, both routes                                                  |
| Footer band on `/catalogue/[id]`   | **absent**                                                    | present                                                            |
| Largest type in the body           | KPI value **24px/700** (63% over a card title)                | card title 14.72 ≈ tile 15.2; page identity leads                  |
| Space above the first listing      | **302px**                                                     | 236px                                                              |
| Section gap vs intra-group gap     | 16px vs **24px** (inverted)                                   | 32px vs 24px                                                       |
| Table at 1512 / 900 / 390          | overflows at **every** width; 5 of 8 columns destroyed at 900 | fits at all three (8 / 4 / 3 cols), `scrollWidth === clientWidth`  |
| Search fields                      | 2, different scopes, no shared state                          | **1**; lane + body + count all agree                               |
| Failed fetch                       | renders "16 listings" under a non-matching query              | error + retry, list dimmed + `data-stale`, count refuses to assert |
| Loading state                      | none                                                          | shape-matched skeleton + "Searching…"                              |
| Filtered empty state               | no action                                                     | **Clear search**                                                   |
| KPI vs body                        | "9 active listings" above "0 listings"                        | type-scoped, self-labelled, disclaims search                       |
| `New listing` at 390px             | **0×0**                                                       | 109×27, reachable                                                  |
| Unreachable controls at 390px      | 4 sortable headers                                            | **0**                                                              |
| Analytics height at 390px          | 245px (29% of viewport)                                       | 92px, scroll rail                                                  |
| Publish after scrolling the form   | **y = −247, off-screen**                                      | pinned in the footer band                                          |
| RTL leaks                          | 18 (mirrored table clip)                                      | **0**, both routes, both directions                                |
| `:focus-visible` on local controls | 1 of 16 correct                                               | 16 of 16                                                           |

### 12.3 Three defects found during the fix pass, not in the audit

1. **The header field mirrored the shared signal instead of binding to it.** The island re-renders
   on every busy/count/error tick, so the mirror reset the input's value out from under whoever was
   typing. Now bound straight to `consoleQuery` — one signal, one writer.
2. **Two islands both primed the query.** Whichever hydrated last won, and keystrokes in the gap
   were discarded. Only the header band — which owns the field — primes it now.
3. **"7 total" beside 8 rows.** The roll-up excludes archived listings; the body list does not. The
   caption now names the exclusion (`of 7 not archived`) instead of hiding it.

### 12.4 Two decisions worth recording

- **The responsive table is CSS, not a `ResizeObserver`.** A measured layout renders all eight
  columns on the server and reflows on hydration — and in a context where frames are not being
  produced it never settles at all (the first attempt measured 0 columns dropped). It is now
  `@container` queries on `.cat-table`, keyed to the _container_ because the table's width depends
  on whether the lane is expanded.
- **Mobile control allocation.** Three lane-orphaned controls do not fit a 390px band. The type
  segment went to the header band (which has already hidden the page title at that width) and
  `New listing` to the footer; the analytics period yields, since the summary states its own window
  in the body. Verified: header fits, rig fits, nothing unreachable.

### 12.5 Not changed, deliberately

- The lane does not refetch after a lifecycle change made on the manage page — pre-existing SSR
  behaviour, unchanged here; a navigation refreshes it.
- `--on-primary` measures **3.57:1** on `--primary` in dark (5.13:1 in light). That is the theme
  engine's token pair, not this surface's choice; the surface's own inconsistency — three controls
  painting `--surface` on the same fill — was fixed to use the canonical ink.
