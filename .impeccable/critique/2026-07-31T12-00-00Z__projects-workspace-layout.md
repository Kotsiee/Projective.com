# Projects Workspace — Layout & Region-Discipline Audit

Date: 2026-07-31 · Scope: `apps/web/routes/(dashboard)/projects/**` + `apps/web/features/projects/**`
Method: source read + **measured in-browser** (dev server `web-projlayout`, port 8373, dark theme,
1512 / 900 / 390 px, `dir=ltr` and `dir=rtl`), as one composed page rather than a component set.
Mechanical detector (`detect.mjs --scope layout`) over the whole surface: **clean, 0 findings** —
every issue below is structural, not raw-value drift.

Judged against `DESIGN_SYSTEM.md` §B.4 (separation), §B.6 (icon-first density), §B.7 (iconography),
§B.8 (buttons), §B.9 (cards), §B.10 (overlays), Part D (shell), and the `/wallet` region contract
(root `CLAUDE.md` Decision #60).

---

## 0. The one-paragraph verdict

The Projects workspace is **thirteen routes wearing one shell, and only one of them has read the
contract**. The channel Chat view is close to exemplary: identity and tabs in the header band, the
composer in the footer band, nothing in the body but messages. Every other route in the surface
treats the frame's two bands as optional decoration and rebuilds them, badly, inside the scrolling
body — so the surface ships **six in-body toolbars**, **five body search inputs**, density controls
in **three different regions across four sibling screens**, and **five routes that render with both
bands empty**. The cost is not stylistic. It is measurable: 40% of the desktop viewport is
navigation before the first file; the header band on a channel route carries **467px of empty
space** twelve pixels above a duplicate toolbar; the surface's landing route is a dev placeholder;
its project page's only call-to-action is `0×0` on desktop; and at 390px three controls are
**silently clipped out of existence** with no scrollbar to recover them.

---

## 1. VISUAL HIERARCHY — the squint test

### 1.1 What the eye lands on, per route

| Route | 1st | 2nd | 3rd | Should be |
|---|---|---|---|---|
| `/projects` | The **lane** (8 project cards, the only content) | Empty 1168×897 canvas | An `h1` reading "Projects" over a `<code>/projects</code>` | The project you want to open |
| `/projects/[id]` | Banner + project title | 7 stacked stage cards, all reading "Not configured yet" | — (the CTA is `0×0`) | **Apply / Edit** — the reason the page exists |
| `…/[ch]/chat` | **The message stream** ✅ | Composer | Header band | The message stream ✅ |
| `…/files` | The **glass toolbar pill** (a floating 889px bar) | Thumbnail grid | Channel tree | A named file |
| `…/submissions` | A **two-row, full-bleed search field** | Stage cards | Tree | The submission awaiting review |
| `…/board` | 9 columns of equal weight | Toolbar | Footer rig | The ticket that needs you |
| `…/members` | "Members 8" + a **filled Invite button** | Toolbar | Table | The roster |

### 1.2 The single most important element, and whether it wins

The Projects workspace exists so a person can **act on the engagement in front of them** — open the
right channel, review the pending submission, move the blocked ticket, apply to the project. The
single most important element is therefore **the current engagement's primary action**.

**It does not win on any route except Chat and Board.** Two measurements make the case:

**(a) `/projects/[projectId]` — no visible call to action at first paint on desktop.**
Measured at 1512px on `northwind-atlas-portal` (a `viewerRole: "member"` engagement, so the
non-owner path): **both** "Apply to project" copies measure `0×0`. The BODY copy is inside
`.pf-header__actions`, which is `display: none` above 767px
(`apps/web/features/profile/styles/profile.css:255`); the HEADER-BAND copy is inside
`.pf-stickyhead`, which rests at `visibility: hidden; max-block-size: 0`.

The band copy **is** reachable — it reveals at `data-condensed → true` after ~437px of scroll — so
this is "no CTA until you scroll past the thing you came to act on", not "unreachable". The reason
the same component set works on the public `/view/[id]?type=projects` is that **the guest lane
carries a third, always-visible copy**: `.vw-projlane__apply`, measured **256×44** at 1512px. The
dashboard lane is the `ProjectSidebar` channel tree and carries none.

At **390px the body copy renders 318×40** (`profile.css:260-269`). So the surface's only
always-visible CTA is the mobile one — responsive behaviour that gains a control on the small screen
and loses it on the large one. The route's own JSDoc says it "adds the role-appropriate CTA"
(`routes/(dashboard)/projects/[projectId]/index.tsx:11-12`); on desktop it adds one that starts
hidden.

**(b) `/projects` — the surface's landing route is a scaffold.**
The lane renders the real feed (8 project cards, tabs, search, role toggle, filter popover,
"Create project"). The 1168×897 body next to it renders `PagePlaceholder`
(`routes/(dashboard)/projects/index.tsx:6-10`): an `h1`, a `<code>` echoing the literal route path
`/projects`, a divider, and the note "Pick a project from the list on the left to open it."
**78% of the region is a published placeholder that names its own URL.**

**Verdict: the hierarchy fails.** On five of thirteen routes the eye's first landing is a control
bar, not content or action; on the two most important entry points (the workspace root and the
project page) the primary object is either absent or invisible.

---

## 2. REGION DISCIPLINE — the misplacement table

The contract (`/wallet`, Decision #60): **LANE** owns navigation and scope · **HEADER BAND** owns
identity and global controls · **FOOTER BAND** owns actions and density · **BODY** owns viewing and
selecting data only — no tabs, no filter dropdowns, no primary CTAs.

### 2.1 Slot occupancy, all thirteen renderable routes

| Route | LANE | HEADER BAND | FOOTER BAND | Verdict |
|---|---|---|---|---|
| `/projects` | `ProjectsLane` | **—** | **—** | body is a placeholder |
| `/projects/[id]` | `ProjectSidebar` | Preview/Edit tabs | **—** | CTA invisible |
| `/projects/[id]/edit` | `ProjectSidebar` | Preview/Edit tabs | **—** | **Save changes in body** |
| `/projects/[id]/board` | `ProjectSidebar` | **—** | `BoardViewControlRig` | toolbar in body |
| `/projects/[id]/files` | `ProjectSidebar` | **—** | `ViewControlRig` (zoom only) | toolbar in body |
| `/projects/[id]/members` | `ProjectSidebar` | **—** | **—** | **whole page in body** |
| `/projects/[id]/calendar` | `ProjectSidebar` | **—** | **—** | body builds its own header |
| `/projects/[id]/submissions/*` | `ProjectSidebar` | **—** | rig + Tasks | toolbar in body |
| `…/[ch]` · `…/[ch]/chat` | `ProjectSidebar` | `ChannelHeader` | `ChatComposer` | ✅ **correct** |
| `…/[ch]/files` | `ProjectSidebar` | `ChannelHeader` | `ViewControlRig` | toolbar duplicates band |
| `…/[ch]/members` | `ProjectSidebar` | `ChannelHeader` | **—** | CTA + toolbar in body |
| `…/[ch]/calendar` | `ProjectSidebar` | `ChannelHeader` | **—** | body builds its own header |
| `…/[ch]/tasks` | `ProjectSidebar` | `ChannelHeader` | `BoardViewControlRig` | toolbar in body |

**Five routes render with both bands empty.** `/wallet` cannot do this: `walletFooterFor` claims
every `/wallet*` route unconditionally, and its own doc comment says why — *"unlike its siblings this
resolver is not scoped to one page."* Every projects resolver is a narrow per-URL match, which is
precisely why five routes fall through to nothing.

### 2.2 Every misplaced control

| # | Control | Currently in | Belongs in | Evidence |
|---|---|---|---|---|
| 1 | **"Invite"** `variant="filled"` | BODY | FOOTER band | `islands/MemberRoster.island.tsx:271-278` — measured `ui-button--filled ui-button--primary`, `rgb(0,146,158)` |
| 2 | **"Save changes"** `variant="filled"` | BODY | FOOTER band | `islands/ProjectEditor.island.tsx:485-491`, inside `.proj-editor__foot` (`:479`) while the frame footer renders nothing |
| 3 | Files search + type filter + sort + direction | BODY `.fx-toolbar` | HEADER band (search/filter) + FOOTER (sort) | `islands/FileExplorer.island.tsx:271-307` |
| 4 | Submissions search + filter + sort | BODY `.fx-toolbar` | same | `islands/SubmissionExplorer.island.tsx:522-558` |
| 5 | Board search + Priority + Assignee + sort | BODY `.brd-toolbar` | same | `islands/ProjectBoard.island.tsx:360-401` |
| 6 | Members search + role filter + stage filter | BODY `.mem-toolbar` | same | `islands/MemberRoster.island.tsx:282-321` |
| 7 | Calendar today/prev/next + search + filter + view switch | BODY `.cal-header` | HEADER band | `packages/ui/calendar/components/CalendarHeader.tsx:50-98` via `ProjectCalendar.island.tsx:58` |
| 8 | **Table / Card view toggle** (a density control) | BODY | FOOTER band | `islands/MemberRoster.island.tsx:322-346` — while Files/Submissions/Board put the identical class of control in the footer |
| 9 | "Members 8" + context line (identity) | BODY | HEADER band | `islands/MemberRoster.island.tsx:260-270` |
| 10 | Submissions **Review / Create / Upload / Delete / Submit** | BODY crumb bar | FOOTER band | `components/SubmissionActionBar.tsx:69-128` — incl. a `--danger` Delete inline between two constructive actions |
| 11 | Per-column "+" create ticket ×8 | BODY | acceptable (kanban idiom), but duplicates the footer's "Ticket" | `islands/ProjectBoard.island.tsx:419-425` vs `BoardViewControlRig.island.tsx:102-129` |
| 12 | File / submission **tree navigators** | BODY | LANE | `FileExplorer.island.tsx:318-323`, `SubmissionExplorer.island.tsx:567-574` — a second nav column beside the one the lane already owns |
| 13 | Submission **breadcrumbs** | BODY | HEADER band | `components/SubmissionBreadcrumbs.tsx:37-42` |

Correctly placed, for contrast: `FilterPanel` (LANE popover, `ProjectsLane.island.tsx:369-398`),
`IncomingRequests` (LANE footer, `:452-456`), `ChannelQuickFilters` (LANE,
`ProjectSidebar.island.tsx:274`), `TasksPanel`'s footer trigger
(`SubmissionViewControlRig.island.tsx:40-52`), the three board rig actions
(`BoardViewControlRig.island.tsx:102-129`), and the entire Chat view.

### 2.3 The measurement that settles it

On `…/[channelId]/files` the header band **exists** and is mostly empty, while a duplicate bar sits
12px below it. Measured at 1512px:

| Header-band block | Box | Content | Slack |
|---|---|---|---|
| `.chan-header__meta` | 397px | 187px | 210px |
| `.chan-header__tabs` | 302px | 302px | 0 |
| `.chan-header__actions` | 397px | 140px | **257px** |

**467px of empty header band**, and 12px beneath it a 48px `.fx-toolbar` carrying a 352px search, a
type filter and a sort control. The band is not full. The toolbar is not necessary.

### 2.4 A broken link the region model hides

`/projects/[slug]/finances` is rendered as a view-link by the lane and the collapsed rail
(`components/detail-glyphs.tsx:273`). **No such route exists.** The segment falls through to the
`[channelId]` dynamic route, `resolveChannelMeta` returns null, so no header band and no footer band
resolve — and the page renders **the general channel's chat transcript** with no tabs and no
composer, titled "Projective". Measured: `HTTP 200`, body text begins
`"PinnedYou: Final direction locked ✅ …"`.

---

## 3. SPATIAL RHYTHM

### 3.1 Proximity is doing the work; borders are not compensating

Genuinely good: no four-sided boxes around non-interactive groups anywhere in the surface. Section
separation is spacing + a single hairline throughout, and the `fx-card` / `subm-card` /
`subm-noderow` family (already praised in the card audit) carries **one** device at rest. §B.4 holds.

### 3.2 But the outer rhythm has no agreed unit

Outermost body padding, five surfaces, four answers:

| Surface | Inline | Block | File |
|---|---|---|---|
| `.fx-explorer` / `.subm-explorer` | `--space-4` | `--space-3` / `--space-6` | `file-explorer.css:17-18` |
| `.brd` | `--space-4` | `--space-2` / `0` | `board.css:14-15` |
| `.mem-root` | **`--space-5`** | `--space-5` / `--space-6` | `members.css:14` |
| `.chat-feed` | `--space-4` | none | `chat-feed.css:25` |
| `.proj-editor` | none | none | `project-showcase.css:144` |

Navigating Files → Members shifts the content edge a full step. This is the cheapest fix in the
report.

### 3.3 A 16px misalignment inside the File Explorer — measured

`.fx-explorer` sets `padding-inline: var(--space-4)` (`file-explorer.css:17`) and its own child
`.fx-workspace` sets `padding-inline: var(--space-4)` again (`:137`). The toolbar is a **sibling** of
`.fx-workspace`, so it does not get the second step:

| Element | left edge |
|---|---|
| `.fx-toolbar` | **592px** |
| `.ui-vgrid` / first `.fx-card` | **608px** |

The search field starts one full `--space-4` to the left of the first file. This is invisible in
isolation and obvious the moment you look for a vertical edge.

### 3.4 Vertical chrome budget

On `…/[ch]/files` at 945px: topbar 48 + header band 48 + in-body toolbar 48 + footer rig 44 =
**188px, 20% of the viewport height**, spent on four stacked horizontal strips before any content.
The middle one is the removable one.

---

## 4. DENSITY

### 4.1 Horizontal: three navigation columns, 40% of the viewport

Measured on `/projects/[id]/files` at 1512px:

| Column | Width |
|---|---|
| Global rail | 64px |
| Middle-nav lane (channel tree) | 280px |
| In-body `.fx-tree` (channel tree, again) | 208px |
| gutters | 56px |
| **First file card begins at** | **x = 608px = 40.2% of the viewport** |

Two of those three columns are channel trees. §B.6 asks for icon-first density in navigation columns
— it does not ask for three of them.

### 4.2 Row density: four list surfaces, four models

| Surface | Model | Value | File |
|---|---|---|---|
| `.fx-row` (Files, Submissions) | fixed, **zoom-driven** | 38–78px (measured 54 @ zoom 0.2) | `core/view-state.ts:21` |
| `.mem-table td` | intrinsic | `--space-3` → **measured 65px** | `members.css:326-330` |
| `.brd-list__row` | intrinsic | `--space-2` | `board.css:360` |
| `.subm-noderow` | intrinsic | `--space-2 --space-3` | `submission-card.css:118` |

Only the file table participates in the zoom ramp, so **the footer's density rig has no effect on the
Members table or the ticket list** — the control exists on some siblings and silently does nothing on
others.

### 4.3 The board's scroll thicket

Measured on `/projects/[id]/board` at 1512×945:

- `.ui-kanban__board` — `scrollWidth 2624` in `clientWidth 1121` (9 × 280px columns): horizontal scroll
- 9 × `.ui-kanban__col-body`, each its own vertical scroller (one measured `scrollHeight 1577` / `clientHeight 714`)
- the document itself overflows by **exactly 50px** — an "almost fits" that makes the whole frame
  nudge under a sticky footer rig for no gain

Eleven potential scroll regions on one screen, on a surface whose task is "see what is blocked."

---

## 5. SCANNABILITY — can a user find one row in under three seconds?

| Surface | Verdict |
|---|---|
| **File table** (list mode) | ✅ **Yes.** 4 columns (Name 369 / Sender 200 / Date 176 / Size 112), 54px rows, sticky header pinned at `top: 96px` with an **opaque** background. This is the best data surface in the workspace. |
| **File grid** (the default) | ❌ **No.** Default zoom 0.62 renders 159×221 thumbnail cards with a **13px single-line ellipsised** filename, 204 files deep. |
| **Members table** | ⚠️ Sortable headers, 65px rows, readable — but the toolbar above it is `position: static` (`members.css:77-84`), so search and both filters scroll away the moment you start reading. |
| **Ticket list** | ⚠️ Header row is display-only, **not sortable** (`components/TicketListView.tsx:29-37`), while the Kanban toolbar 40px above it offers a `SortControl`. Same data, two different sort stories. |
| **Board** | ❌ 9 equal-weight columns, no visual ranking, 2.3× horizontal overflow. |

**What is in the way, specifically:** the good scannable view (the table) is **not the default** and
**has no toggle button** — by design, the grid⇄list switch is a continuous zoom slider in the footer
band (Decision #32). A user hunting a named file must first discover that dragging an unlabelled
density slider changes the *view mode*. That was a defensible call when Files was one surface; it is
now the reason three of five list surfaces cannot be scanned by default.

---

## 6. EMPTY, LOADING, ERROR, PARTIAL

### 6.1 The scoreboard

| Surface | Empty | Loading | Error |
|---|---|---|---|
| FileExplorer | designed, no action | spinner only, no skeleton | ❌ **none — renders the empty state** |
| SubmissionExplorer | designed, no action | spinner only | ❌ **none — renders the empty state** |
| ProjectBoard | designed, no action | ❌ **none at all** | ❌ none |
| MemberRoster | designed, no action | `opacity: 0.6` dim | ✅ present |
| ChatFeed | designed, no action, has an icon | spinner + SR text | ❌ none (`catch` swallows) |
| ProjectCalendar | — | ❌ none | ✅ bare string, no retry |

**0 of 6 empty states teach the next action.** Every one is a title `<p>` and a note `<p>`. Measured
`.fx-empty`: 237px tall, `padding: 64px 0`, two paragraphs, **no icon, no button, no link**. The
shared `LaneEmpty` primitive (`packages/ui/navigation/components/LaneChrome.tsx:411-419`) has **no
action prop at all**, so no consumer can add one without changing the primitive.

The sharpest instance: `MemberRoster.island.tsx:271` renders the Invite CTA in the header, and
`:354-359` renders "Nobody has access to this space yet" with **no way to invite anyone** — the
button is 400px away in a different block, and the empty state does not mention it.

### 6.2 Four empty states whose headline contradicts their own note

This is a real defect, not a copy nit, and it goes in **both** directions:

| File:line | Headline (constant) | Note (branches) | Failure |
|---|---|---|---|
| `islands/FileExplorer.island.tsx:86` | "No files here **yet**" | "No files match the current search and filters." | filtered to zero → told the folder is empty |
| `islands/SubmissionExplorer.island.tsx:139` | "Nothing submitted **yet**" | "No submissions match…" | same |
| `islands/SubmissionExplorer.island.tsx:170` | "No files here" | "No files match…" | same |
| `islands/MemberRoster.island.tsx:354` | "No members **match**" | "Nobody has access to this space yet." | **inverse** — no filters active, still says "match" |
| `components/TicketListView.tsx:22-23` | "No tickets here" | "No tickets match the current search and filters." **(hardcoded, no branch)** | an empty board always claims a filter is active |

Verified rendered: typing `zzq` into the Files search produces the literal pair
*"No files here yet"* / *"No files match the current search and filters."*

### 6.3 Failure is indistinguishable from emptiness

`FileExplorer.island.tsx:167-186` and `SubmissionExplorer.island.tsx:313` discard `!res.ok` silently;
the state defaults to `[]`, which renders the **empty** state. A backend outage and an empty folder
are the same screen. `ChatFeed.island.tsx:112-114` catches a failed history load and only nulls its
scroll anchor — the user scrolls up, nothing arrives, nothing says why.

### 6.4 Partial states

`/projects/[id]` renders **seven consecutive stage cards each reading "Not configured yet"** — a
partial state repeated until it reads as the page's content. One "this pipeline has no stages
configured — add the first" would say more and occupy a seventh of the space.

---

## 7. RESPONSIVE — desktop → tablet → mobile

### 7.1 Tablet (900px) — holds

Lane narrows 280 → 136px, all five channel tabs keep their labels, all four header actions and all
toolbar controls remain on-screen. `scrollWidth 885 ≤ 900`. No finding.

### 7.2 Mobile (390px) — **three controls are silently destroyed**

Measured on `/projects/monarch-design-system/stage-2/files`:

```
.ui-middle-nav          width          390px
.ui-middle-nav          grid track   473.734px      ← 84px wider than its own box
.ui-middle-nav          overflow        clip
document.scrollWidth                    390px      ← no scrollbar; nothing to scroll to
```

Off-screen and **unreachable by any means**:

| Control | x | right | in `.chan-header`? |
|---|---|---|---|
| "Stage details" (opens the stage drawer) | **390** | 422 | yes |
| "More actions" (the kebab menu) | **426** | 458 | yes |
| "Sort by Date" | 335 | **424** | `.fx-toolbar` |

Root cause: `.ui-middle-nav`'s mobile rule sets `grid-template-columns: 1fr`
(`packages/ui/navigation/styles/middle-nav.css:165`), and `1fr` resolves to `minmax(auto, 1fr)` —
`auto` takes the **min-content** width of the track's contents. `.chan-header` at five tabs + four
actions + a meta block has a min-content of 473.7px, so the track exceeds the container and
`overflow: clip` eats the difference. The general channel (three tabs) fits at 391px, which is why
this reproduces only on stage channels.

### 7.3 Mobile — the lane vanishes and nothing replaces it

`.ui-app-shell__sidebar` and `.ui-middle-nav__lane` are both `display: none` below `--bp-md`. Measured
on a stage channel at 390px, the **only** in-project links still reachable are the five tabs of the
channel you are already in. There is:

- no channel switcher (the tree lived in the lane),
- no "Back" to the project (it lived in the lane header),
- no route to `/projects`.

`BottomNav` renders (390×56) with the five global primaries, so a user can leave the project — but
cannot move **within** it. On a workspace whose core loop is switching between channels, that is the
loop removed.

### 7.4 The CTA inversion, restated

Because `.pf-header__actions` is `display: none` above 767px and `display: block` below it
(`profile.css:255`, `:265-269`), **"Apply to project" is *always* visible only on mobile** — 318×40
at 390px, `0×0` at 1512px until ~437px of scroll reveals the header-band copy. Responsive behaviour
that guarantees a control on the small screen and makes it conditional on the large one is exactly
backwards. See §1.2(a) for the full measurement.

---

## 8. RTL — clean, with three motion exceptions

**Layout mirrors perfectly.** Measured on `/projects/[id]/submissions`, `dir` flipped live at 1512px:

| Element | LTR x | RTL x |
|---|---|---|
| Global rail | 0 | 1433 |
| Lane | 64 | 1153 |
| Body / footer band | 344 | 0 |
| In-body tree | 360 | 897 |
| In-body toolbar | 624 | 16 |

`document.scrollWidth` **1497 in both directions**; zero elements leak past either edge on
`/submissions` or on `…/chat`. A grep of all 22 projects stylesheets (10,112 lines) for
`margin-left|margin-right|padding-left|padding-right|border-left|border-right|left:|right:|text-align: left|right`
returns **zero matches** — the logical-property discipline is complete, and there is not a single
`[dir="rtl"]` override in the feature because none is needed.

**The exception is motion, which logical properties do not catch.** Three `translateX` declarations
encode a *direction*, not a layout:

| File:line | Declaration | Failure |
|---|---|---|
| `styles/project-sidebar.css:1381` | `transform: translateX(6px)` on the lane collapse-toggle divider | **Measured: `matrix(1,0,0,1,6,0)` in both directions.** In RTL the lane collapses toward the opposite edge, so the glyph animates *away* from the direction it promises |
| `styles/project-sidebar.css:1385` | `translateX(0)` | the resting half of the pair |
| `styles/project-create-modal.css:123` | `translateX(8px)` in `@keyframes pcm-right-in` | the right panel slides in from `+8px`; in RTL that panel is on the left and enters from the wrong side |

`file-table.css:90`'s `translateX(-50%)` is symmetric centring and is **not** a violation.

---

## 9. ANTI-PATTERNS

| # | Pattern | Found? | Evidence |
|---|---|---|---|
| A | **Nested containers** | ⚠️ one class | `.fx-explorer` pads, `.fx-workspace` pads again (`file-explorer.css:17`, `:137`) — 16px measured misalignment. Card nesting: none in this surface (the `attachment-modal.css` violation is logged in §B.9 and is out of this scope) |
| B | **Redundant separation** | ✅ **none** | No four-sided boxes on non-interactive content. §B.4 holds throughout |
| C | **Competing primary actions** | ⚠️ **no region has two `filled`** — verified, all five `variant="filled"` sites are single-per-region. But two of them are *in the body* (`MemberRoster:271`, `ProjectEditor:485`), and `SubmissionActionBar.tsx:102-130` renders `--soft` / `--danger` / `--primary` in one body bar with a destructive action sandwiched between two constructive ones |
| D | **Colour as sole meaning carrier** | ✅ **none found** | Stage status pairs a glyph with a tooltip (`StageStatusIcon`), submission status prints its word, board tickets carry labels |
| E | **KPI row that says nothing** | ✅ **none** | The surface has no decorative stat row — genuinely avoided |
| F | **Chart present for decoration** | ✅ **none** | The only meter is `proj-card__track`, a real progress value |
| G | **A table of every field** | ✅ **avoided** | File table is 4 useful columns; members table is 4. Both restrained |
| H | **Duplicate control in two regions** | ❌ **six instances** | §2.2 — trees, search, sort, density, breadcrumbs, create-ticket |
| I | **Dead class** | ❌ | `.subm-toolbar` applied at `SubmissionExplorer.island.tsx:522`; **measured `0` matching CSS rules in the live CSSOM**. No rule exists anywhere |
| J | **Unscoped override of shared chrome** | ❌ | `styles/submission-explorer.css:100-108` neutralises `.fx-toolbar::before` at the **same specificity (0,1,1)** as `fx-toolbar.css:23` and with **no scoping selector**, so load order decides it for every `.fx-toolbar` on the page — including the Catalogue console's. Line `:108` is `border-radius: none`, which is **invalid CSS** and dropped |
| K | **Raw px where a token exists** | ❌ | `fx-toolbar.css:32` `border-radius: 50px` (`--radius-full` exists) and `submission-explorer.css:97` `border-radius: 15px` — **two different literals for the same glass underlay** |
| L | **Emoji as UI** (§B.7.7) | ⚠️ borderline | `.msg-reaction` renders `👍` / `❤️` — user content, not iconography. Noted, not filed |

### 9.1 The finding that only shows up rendered — two toolbars, one class, two different components

`SubmissionExplorer.island.tsx:4-11` imports eight stylesheets. **`fx-toolbar.css` is not among
them** — it is imported only by `FileExplorer.island.tsx:4` and the Catalogue console, neither of
which mounts on a `/submissions` route. Because feature CSS reaches a page only through an island
bundle, the submissions toolbar renders **without its own stylesheet**. Measured at 1512px:

| | `/projects/[id]/files` | `/projects/[id]/submissions` |
|---|---|---|
| `.fx-toolbar` `display` | `flex` | **`block`** |
| `.fx-toolbar` `gap` | `8px` | **`normal`** |
| Height | **48px** | **65px** (wraps to two rows) |
| `.fx-toolbar__search` `max-inline-size` | `352px` (22rem) | **`none`** |
| Search field width | 352px | **857px — full bleed** |
| `.fx-toolbar__spacer` | flexes | **0 × 21px, inert** |
| `::before` `backdrop-filter` | `blur(18px)` | **`none`** |
| `::before` background | `srgb(.06 .08 .08 / .62)` | **`transparent`** |
| `::before` `border-radius` | `50px` | **`0px`** |

Two sibling surfaces, the same class name, the same intent: one is a 48px glass pill with a capped
search; the other is a 65px two-row block with an uncapped full-bleed search and no glass. The
glass loss is caused twice over — the sheet is missing *and* `submission-explorer.css:100-108`
neutralises the underlay.

---

## 9.5 STATUS — what has since been fixed

Applied and verified in-browser on 2026-07-31, after this audit was written. Everything else in §10
still stands.

| Fix | Status | Verification |
|---|---|---|
| **P0-1** dead `finances` link | ✅ removed (`components/detail-glyphs.tsx`) | lane view-links now resolve to real routes only; `financesLinked: false` |
| **P0-2** no CTA at first paint on `/projects/[id]` | ✅ new footer band | `projectFooterFor` → `ProjectPreviewRig`; Apply measures **150×36 at y=901** on a non-owner engagement, band **absent** for an owner (gate = absence), rig `display: none` at 390px so the body copy stays the single mobile CTA |
| **P0-3a** mobile grid clip | ✅ `minmax(0, 1fr)` (`middle-nav.css`) | track **473.7px → 390px**; `offscreen: 0`; `document.scrollWidth` 390 |
| **P0-3b** header actions overlapping the tabs | ✅ mobile composition reworked | overlap **63px → a 16px gap**; title "Design" no longer clipped; Star + Pop-out move into the kebab (`.chan-action--desktop` / `.chan-menu__item--mobile`), exactly one copy of each action at each width |
| **P0-4** no in-project navigation on mobile | ⏸ **not applied — deliberately** | see below |
| §B.7 hand-authored `<svg>` in `ChannelHeader` | ✅ → `<Icon name="external-link">` | the module authored its own `stroke-width="1.6"`, a §B.7 merge gate |

**Why P0-4 was not applied here.** The rule that removes the lane is global —
`@media (max-width: 767px) { .ui-middle-nav__lane { display: none } }` in `middle-nav.css` — and
**every** lane-bearing surface renders one: verified `laneInSSR: true` on `/messages`, `/catalogue`,
`/wallet` and `/teams`. Building a projects-only mobile channel drawer would fix a fifth of the
problem and add a fifth inconsistency of exactly the kind this audit is about. It needs one shell-level
decision (drawer off the header identity · bottom sheet · a mobile lane route) applied to all five at
once, and Part D.3 is a documented contract, so it is a human call rather than an inferred one.

**One defect was introduced and caught during the work**, worth recording because it is the same
class as §9 J: the new `.chan-menu__item--mobile { display: none }` was authored as a bare modifier
(0,1,0) and placed *above* `.chan-menu__item { display: flex }` (also 0,1,0) — the tie resolves on
source order, so both copies of Star and Pop-out rendered on desktop. Fixed by making it the compound
`.chan-menu__item.chan-menu__item--mobile` (0,2,0), the same discipline the splitter-collision fix
already uses.

**Also fixed, unrelated and not mine:** `features/messaging/islands/InboxHeader.island.tsx` imported
a stylesheet that did not exist yet. Island discovery imports every island eagerly, so **every**
`(dashboard)` route returned 500 — the same failure mode as the orphaned `./file-tree.css` import in
`packages/ui/navigation/styles/index.css`. A placeholder unblocked SSR and the owning session has
since written the real sheet.

---

## 10. RANKED FIX LIST

Each item is independently landable. `file:line` verified against the working tree at
commit `c2e7180`.

### P0 — the surface is broken here

**1. `/projects/[slug]/finances` renders another channel's chat.**
`apps/web/features/projects/components/detail-glyphs.tsx:273` links a `seg: "finances"` with no
route behind it; it falls through to `[channelId]`, resolves no header and no footer band, and
renders the general channel's transcript with no tabs and no composer. Either build the route or
remove the link. *(Measured: HTTP 200, chat body, both bands absent.)*

**2. `/projects/[projectId]` has no visible CTA at first paint on desktop.**
`apps/web/features/profile/styles/profile.css:255` (`display: none` above 767px) is correct for the
profile — where `pf-lane` carries the copy — and wrong for `/projects/[projectId]`, whose lane is the
channel tree. `/view/[id]` escapes it only because its guest lane carries a third copy
(`.vw-projlane__apply`, 256×44). Give the project preview a **footer band** carrying the
role-appropriate CTA (the `/wallet` pattern) and let the existing body copy remain the mobile
fallback, exactly as `profile.css:246-252` already documents for Hire.
*(Measured: both copies 0×0 at 1512px until ~437px of scroll reveals the band copy; body copy
318×40 at 390px.)*

**3. Mobile clips three controls out of existence.**
`packages/ui/navigation/styles/middle-nav.css:165` — `grid-template-columns: 1fr` resolves to
`minmax(auto, 1fr)`; change to `minmax(0, 1fr)` so the track cannot exceed its container. Then make
`.chan-header` actually adapt below `--bp-md` (collapse the meta block, or overflow the tab strip to
a scroller). *(Measured: 473.734px track in a 390px `overflow: clip` box; "Stage details", "More
actions" and "Sort by Date" unreachable with `document.scrollWidth === 390`.)*

**4. Mobile has no in-project navigation.**
Below `--bp-md` both the rail and the lane are `display: none`, leaving only the current channel's
five tabs. The lane's channel tree needs a mobile home — a `Drawer` off the header's identity block
is the smallest change consistent with Part D.3.

### P1 — fix before this surface ships

**5. Import `fx-toolbar.css` into `SubmissionExplorer.island.tsx` (after line 4)** and **delete
`submission-explorer.css:100-108`** (the unscoped `.fx-toolbar::before` neutraliser, which also
carries the invalid `border-radius: none`). If the submissions toolbar genuinely needs a different
underlay, scope it: `.subm-main .fx-toolbar::before`. *(Measured: eight computed-style divergences,
§9.1.)*

**6. Hoist the four in-body toolbars into the bands.** Search and filters → header band; sort and
density → footer band. Priority order by damage: `MemberRoster.island.tsx:282-346` (whole page in
the body, no bands at all) → `FileExplorer.island.tsx:271-307` and
`SubmissionExplorer.island.tsx:522-558` (a header band already exists and is 467px empty on channel
scope) → `ProjectBoard.island.tsx:360-401`.

**7. Move the two body `filled` buttons into footer bands.**
`islands/MemberRoster.island.tsx:271-278` ("Invite") and `islands/ProjectEditor.island.tsx:485-491`
("Save changes") — the latter is the clearest violation in the surface: an irreversible-ish commit
in a body footer while the frame's footer band renders nothing.

**8. Give the projects footer resolver the `/wallet` shape.** Make it claim every `/projects/*` route
unconditionally with a per-route body, instead of five narrow per-page matches that leave five routes
bandless. Reference: `apps/web/features/wallet/core/wallet-footer-slot.tsx:11-13`, `:25-41`.

**9. Fix the four contradicting empty states.** Branch the **headline** on `hasFilters`, not just the
note: `FileExplorer.island.tsx:86`, `SubmissionExplorer.island.tsx:139`, `:170`,
`MemberRoster.island.tsx:354`, and give `TicketListView.tsx:22-23` a branch at all.

**10. Add error states to the four surfaces that have none.** `FileExplorer.island.tsx:167-186` and
`SubmissionExplorer.island.tsx:313` currently render the *empty* state on a backend failure —
outage and empty folder are indistinguishable. `ProjectBoard` has neither loading nor error.
`ChatFeed.island.tsx:112-114` swallows a failed history fetch.

**11. Fix the RTL motion.** `styles/project-sidebar.css:1381` and `:1385` — drive the toggle from a
`--proj-toggle-slide` custom property inverted under `[dir="rtl"]`, or use `translate` with a logical
sign. Same for `styles/project-create-modal.css:123`. *(Measured: `matrix(1,0,0,1,6,0)` identical in
both directions.)*

### P2 — the coherence work

**12. Give every empty state an action.** Add an `action` slot to
`packages/ui/navigation/components/LaneChrome.tsx:411-419` (`LaneEmpty` has no action prop, so no
consumer can add one) and to `.fx-empty` / `.mem-empty` / `.brd-empty`. The Members empty state in
particular should offer the Invite button it currently renders 400px away.

**13. Collapse the third navigation column.** The in-body `.fx-tree` / `.subm-aside-tree`
(`FileExplorer.island.tsx:318-323`, `SubmissionExplorer.island.tsx:567-574`) duplicates the lane's
job. Either scope it into the lane or drop it — 40.2% of the desktop viewport is currently chrome
before the first file.

**14. One body padding.** `.mem-root` (`members.css:14`) is the outlier at `--space-5`; align it and
`.proj-editor` (`project-showcase.css:144`, none) to the `--space-4` / `--space-3` `--space-6`
rhythm the other four use.

**15. Remove the double inline padding.** Drop `padding-inline` from `.fx-workspace`
(`file-explorer.css:137`) so the toolbar and the grid share an edge. *(Measured 16px offset: toolbar
at x=592, first card at x=608.)*

**16. One density story.** Either put the Members table/card toggle in the footer band
(`MemberRoster.island.tsx:322-346`) beside its siblings, or make the footer's zoom rig actually drive
the Members and ticket-list row heights — today the rig is present on some routes and inert on others.

**17. Make the ticket list sortable** (`components/TicketListView.tsx:29-37`) or remove the
`SortControl` from the board toolbar; the same data currently has two different sort stories.

**18. Delete the dead `.subm-toolbar` class** (`SubmissionExplorer.island.tsx:522`) — verified zero
matching rules in the live CSSOM.

**19. Tokenise the two glass radii.** `fx-toolbar.css:32` (`50px` → `--radius-full`) and
`submission-explorer.css:97` (`15px`) — two literals for one visual layer.

**20. Reconsider the board's scroll model.** 9 × 280px columns = 2624px in 1121px, plus 9 column
scrollers, plus a 50px document overflow. At minimum, remove the 50px window overflow so the frame
stops nudging.

### P3 — polish

**21. Replace `/projects`'s `PagePlaceholder`** (`routes/(dashboard)/projects/index.tsx:6-10`) — a
1168×897 canvas currently printing its own URL in a `<code>` block. Even a "recent activity across
your projects" panel would beat it; an explicit empty-selection illustration would beat that.

**22. Collapse the seven "Not configured yet" stage cards** on `/projects/[projectId]` into one
configured-state empty state.

**23. Make `.mem-toolbar` sticky** (`members.css:77-84`) to match `.fx-toolbar` — or, better, it
disappears entirely under fix #6.

**24. `mem-empty__note` `26rem` vs `fx-empty__note` `24rem`** (`members.css:665`,
`file-explorer.css:159`) — one measure for one role.

---

## 11. Positive findings

These are load-bearing and should not be disturbed by the fixes above.

- **The Chat view is the reference implementation.** Header band = identity + tabs + four icon
  actions; footer band = composer; body = messages, a pinned banner, and row actions. Nothing else.
  Every other route in the surface should be argued against this one.
- **§B.4 holds completely.** No four-sided borders on non-interactive content anywhere in 22
  stylesheets. Grouping is spacing and single hairlines.
- **RTL layout is genuinely correct** — zero physical properties in 10,112 lines, zero
  `[dir="rtl"]` overrides needed, zero measured leak in either direction. Only three `transform`
  declarations escape, which is the one class logical properties cannot catch.
- **No generic-dashboard tropes.** No decorative KPI row, no chart for atmosphere, no table of every
  available field. The surface is restrained where most workspace UIs are not.
- **No colour-as-sole-meaning violations.** Every tinted state carries a glyph, a word, or both.
- **The file table is excellent** — four useful columns, opaque sticky header, resizable, a real
  zoom-driven row ramp. It deserves to be more discoverable than a slider in the footer.
- **`fx-card` / `subm-card` / `subm-noderow` remain the best cards in the codebase** (carried over
  from the card audit): one separation device, canonical focus ring, reduced-motion branch.
- **`BoardViewControlRig` is the correct footer band** — three actions, exactly one primary,
  view-mode icons, all in the region that owns them. It is proof the team already knows the pattern.
- **The mechanical detector is clean** over the entire surface.
