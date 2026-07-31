# Entity View — layout & composition audit

Date: 2026-07-31 · Scope: `/view/[entity]` (all four templates) + `/view/[entity]/schedule`.
Files: `apps/web/routes/(public)/view/[entity]/{index,schedule}.tsx` · `apps/web/features/view/**`
(`styles/view.css` 1203 · `project-view.css` 744 · `article-view.css` 631).
Method: source read + **measured in-browser** (dev server `web-view`, port 6373, dark theme, authed
shell) at 390 / 768 / 1024 / 1180 / 1440, LtR and `dir="rtl"`.
Mechanical detector (`detect.mjs --scope layout`) over the feature + routes: **clean, 0 findings** —
every issue below is structural, not raw-value drift.

Measurement caveat: the preview pane does not composite, so programmatic `scrollTo` does not fire a
`scroll` event and `getComputedStyle` returns transition **start** values. Scroll-dependent chrome
was verified by dispatching `scroll` manually and reading `getBoundingClientRect`. On that basis the
project sticky-header migration **works correctly** (`data-condensed` flips, band reveals to 48px) —
it is not a finding.

---

## P0 — THE HEADLINE: below 768px this commerce page cannot transact

The entire transactional block — price, primary CTA, secondary CTA, message, trust facts — lives
**only** in the lane (`ViewActionLane.island.tsx:278-433`). `ViewDetails` is deliberately
informational-only by its own contract (`ViewDetails.tsx:13-15`: *"The transactional actions live in
the sidebar action lane, so this column is purely informational"*). Below 767px the lane is
`display: none`. Nothing takes its place.

Measured at 390 × 844, cold load, after hydration:

| Route | element | text | rendered |
|---|---|---|---|
| `/view/pr-aurora-ui-kit` | `.vw-price__value` | `$79` | **not visible** (0×0) |
| | `.vw-cta--primary` | `Buy now` | **not visible** |
| | `.vw-cta--outline` | `Add to basket` | **not visible** |
| | `.vw-cta--ghost` | `Message team` | **not visible** |
| | `.vw-trust` | trust facts | **not visible** |
| `/view/sv-portfolio-review-session` | `.vw-price__value` | `$180 / session` | **not visible** |
| | `.vw-cta--primary` | `Book a session` | **not visible** |

`laneDisplay: "none"`, `overflowPx: 0`. So the mobile page is a gallery, a title, a description and
a reviews list — with **no price and no purchase path anywhere on it**.

This is the identical failure the profile page already diagnosed and fixed. `profile.css:246-252`
documents it verbatim: *"at 375px it started at x=379 — entirely off-screen, with the lane copy
`display:none` … Three Hire buttons in the DOM, none reachable. It is now its own full-width row
under the identity."* The profile got `.pf-header__actions { display: block }` at `≤767px`
(`profile.css:260-280`). **The entity view never received the equivalent.** `view.css` contains no
`max-width: 767px` block at all — its only queries are `min-768` (line 46), `max-960` (61),
`max-540` (180), `max-780` (948).

Fix: a `@media (max-width: 767px)` fallback that renders the price + CTA stack in the body (under
`ViewDetails`, or as a sticky bottom action bar — the shell already reserves `--shell-bottomnav-h`).
Nothing else on this list matters if a phone user cannot buy.

---

## P0 — the not-found state ships with **no stylesheet at all**

`/view/<unknown-id>` renders raw, unstyled HTML. Measured CSSOM on that route:

| selector | rules found in CSSOM |
|---|---|
| `.vw` / `.vw__back` / `.vw-hero` / `.vw-cta` | **0** |
| `.ui-empty` (the EmptyState component) | **0** |
| `.ex-btn` (the only call to action) | **0** |
| delivered sheets | `explore-results.css` only |

The one CTA — `<a class="ex-btn ex-btn--solid" href="/explore">Explore Projective</a>`
(`EntityViewScreen.tsx:44`) — computes to `display: inline`, `padding: 0px`,
`background: rgba(0,0,0,0)`, `border-radius: 0px`, `font-weight: 400`, `height: 21px`. It is a bare
blue link.

**Root cause, precisely.** Every app-local sheet on this surface is delivered by the **lane island**
(`ViewActionLane` imports `profile.css` + `view.css` + `project-view.css`;
`ViewActionLane.island.tsx:8-12`). `viewLaneFor` returns `null` when the id does not resolve
(`view-lane-slot.tsx:38-41`), and `EntityViewScreen` early-returns at line 35 **before**
`<ViewStyleAnchor />` at line 67. So the one state that renders no lane and no anchor gets no CSS —
and `ViewStyleAnchor` would not have helped anyway: it carries only `Avatar`/`RatingStars`/`Tag`
package CSS, not `view.css` or `empty-state.css`.

This is the island-carrier trap the card-system audit found on `/explore`, hitting the one state
where a working next action matters most. Fix: import `../styles/view.css` (and the `EmptyState`
sheet) into `ViewStyleAnchor.island.tsx`, and render `<ViewStyleAnchor />` **inside** the not-found
branch. Two lines.

Secondary: the empty state top-aligns at `y=88` in a 900px viewport with `.vw` only 144px tall — it
sits in the top 16% of an otherwise blank canvas, no vertical centring, no illustration.

---

## 1. Hierarchy verdict

**The single most important element is the price + primary CTA pair. It does not win. It is 4th and
12th.**

Squint test, quantified. First viewport, `/view/sv-brand-identity-sprint`, 1440×900, ink mass =
visible area × contrast-vs-page-bg (text weighted at 0.22 coverage, solid fills at 1.0):

| # | element | region | size | ink |
|---|---|---|---|---|
| 1 | `.vw-gallery__main` (hero image) | BODY | 516×387 | **18 812** |
| 2 | `.vw-trust` (trust facts list) | LANE | 242×249 | **13 272** |
| 3 | `.vw-h2` "How this pipeline works" | BODY | 1033×23 | 5 234 |
| 4 | `.vw-cta--primary` **Buy now** | LANE | 242×44 | 4 431 |
| 5 | `.vw-details__title` (32px/700) | BODY | 405×37 | 3 280 |
| 6 | `.pf-lane__header` (Back + share row) | LANE | 276×48 | 2 915 |
| 7 | `.vw-details__summary` | BODY | 405×47 | 2 841 |
| 8 | `.vw-creator` | BODY | 405×76 | 2 777 |
| … | | | | |
| **12** | **`.vw-price__value`** (25.6px/700) | LANE | 242×28 | **1 498** |

The image winning is correct — this is a commerce page. Everything after that is wrong:

- **The trust list carries 8.9× the ink of the price.** `.vw-trust` (`view.css:620-662`) is a
  three-row stack of 2rem circular icon chips with a two-line label/value each, `gap: var(--space-3)`
  — 249px of lane height for reassurance copy nobody came for. The price gets 28px.
- **The price is typographically under-built for its job.** `1.6rem/700` (`view.css:542-547`) is
  smaller than the page title (32px) and barely above `.vw-h2` (19.2px). On a page whose whole
  purpose is a purchase decision, the number should be the second thing you see.
- **The title is 5th**, behind a section heading and a trust list, because `.vw-h2` spans the full
  1033px content width while the title is confined to the 405px details column.

**The composition also spends three quarters of its length on other people's products.** Same page:

| block | height | share |
|---|---|---|
| hero (gallery + overview) | 448px | 11% |
| stage showcase | 601px | 14% |
| **`.vw-body` — More by · Similar · Reviews** | **3 122px** | **73%** |
| total `.vw` | 4 258px | |

`.vw-related` #1 alone is 1550px. The article template is the same shape: `art-bottom` is 3202px of
a 6525px page (**49%**), the article body itself 2312px (35%).

A cross-sell rail should be a coda, not the body of the page. Two full recommendation sections
(each fanning out into per-type sub-blocks, `RelatedRail.tsx:42-52`) plus a full reviews panel is
three scroll-lengths of deferral before the page ends.

**Template ranking.** Article > Project > Service ≈ Generic. `article-view.css:110-128` is the one
place on this surface where the spatial thinking is genuinely first-rate — `--measure` at 68ch with
the font-size moved onto the container so `ch` resolves against the prose's own size, measured line
width 596px at 18px ≈ 70 characters. That is real craft and it should be the model for the rest.

---

## 2. Region discipline — misplacement table

Judged against the `/wallet` contract (Decision #60): LANE = navigation + scope · HEADER BAND =
identity + global controls · FOOTER BAND = actions + density · BODY = viewing and selecting data
only.

**Structural finding first: this surface never renders a FOOTER BAND, and renders a HEADER BAND on
one template out of four.** With two of the four regions unused, the body absorbs sort, filter, tabs
and a submit action by default. Measured: `middleNavFooterFor` yields nothing for `/view/*`;
`.ui-middle-nav__header` is populated only by `ProjectStickyHeader`.

| # | Control | Currently in | Belongs in | Evidence |
|---|---|---|---|---|
| 1 | **Showcase ⇄ Availability tablist** (duplicate of the lane's) | **BODY** | LANE (already there) — delete the body copy above 767px | `ServiceShowcase.island.tsx:43-66`. Measured on `/view/sv-portfolio-review-session` at 1440: **two `role="tablist"` elements, both visible, identical options** — `pf-availtoggle` (LANE, label "Showcase or availability") and `vw-showcase__switch` (BODY, label "Showcase view"). Its own doc says the body copy exists "so the calendar is reachable on mobile" — but it carries no media query, so it duplicates on desktop. Also an ARIA defect: two tablists, same two tabs. |
| 2 | **Review sort** (Most recent · Highest · Lowest) | **BODY** | FOOTER BAND | `ReviewsPanel.island.tsx:127-140` (`.vw-sort`, 3 buttons) |
| 3 | **Review star filter** (5→1 distribution bars) + **Clear filter** | **BODY** | FOOTER BAND or LANE scope | `ReviewsPanel.island.tsx:81-107` (`.vw-revbar` ×5), `:116-123` (clear) |
| 4 | **Comment submit** (a filled primary action) | **BODY** | FOOTER BAND | `ArticleComments.island.tsx` → `.art-composer__post`, measured 152×44 at x=1097 |
| 5 | **Back** | LANE header on `/view/[id]`; **BODY** on `/view/[id]/schedule` | one region, consistently | `ViewLaneHeader.tsx:108-115` vs `schedule.tsx:30` |
| 6 | **Apply to project** | 3 DOM copies; **1 ever visible** | LANE (the visible one) | `ProjectActions.tsx:25-36` rendered into `.pf-header__actions` (BODY, `display:none` ≥768 per `profile.css:254-258`) **and** `.pf-stickyhead__actions` (HEADER BAND, `display:none`) **and** the lane (`ProjectViewLane.island.tsx:161-170`). Measured: body + band copies are 0×0 on desktop; only the lane copy paints. |
| 7 | **17 card kebab menus** (`ex-actions__kebab`) | BODY | — | Measured on a single service page. On a public read-only entity page, 17 per-card overflow menus is card chrome imported wholesale from a surface that needed it. |

Item 6 is not a §B.8.2 breach (one filled per region), but two component docs assert a CTA that
never paints: `ProjectActions.tsx:9-13` ("Shared by the body header and the migrated sticky header")
and `ProjectViewScreen.tsx:16` ("a single primary CTA (Apply, in the header + the side lane)"). On
desktop the header copies are dead markup. Delete them or make the docs true.

---

## 3. Spatial rhythm — one value, plus one that is missing

Top-level section gaps, `/view/sv-brand-identity-sprint`, 1440:

| boundary | gap |
|---|---|
| back-row → hero | 72px |
| **hero → stage showcase** | **0px** |
| stage showcase → `.vw-body` | 32px |
| More-by → Similar | 32px |
| Similar → Reviews | 32px |

**The hero and the stage showcase touch.** `ServiceViewScreen.tsx:68` renders
`<section class="vw-project__stages vw-service__stages">` as a direct child of `.vw` —
and **`.vw-service__stages` has zero CSS rules anywhere in the repo**. It is a dead hook. `.vw` is a
plain block with no `gap`; only `.vw-body` carries `margin-block-start` (`view.css:846`). So the
second-most-important block on a Pipeline service page butts flush against the first. (The project
template escapes this because its stages sit inside `.vw-project__body`, which has
`margin-block-start: var(--space-5)`, `project-view.css:103`.)

Everything else is **32px, four times**. `--space-6` is doing all the structural work; `--space-7`
(48px) and `--space-8` (64px) are unused at page level. Per §B.4 tier 1, asymmetric spacing is the
*first* separation tool — here it is a constant, so the ordering between "the product" and "other
products" is carried by nothing. The eye cannot tell that the boundary between the stage showcase
and the recommendation rails is the most important boundary on the page; it reads the same as the
boundary between two recommendation rails.

Where the page does separate, it reaches past tier 1 straight to tier 4: `.vw-section`
(`view.css:471-477`) gives **every** description/spec group a `border-block-start` hairline inside a
346px column — four hairlines stacked in the overview column where a `--space-5` above each heading
would read on its own. `.vw-reviews` (933-934) and `.art-comments` (486-487) do the same.

The article template, by contrast, has an actual cadence: 72 / 16 / 16 / 24 / 32 / 32 — tight inside
the editorial header, opening up as you leave it. That is the pattern the other three need.

---

## 4. Density

Appropriate in the lane, thin in the body, and **inconsistent with its siblings in type**.

- **Type ramp: 104 raw `font-size` declarations, 1 token, across the three sheets.**

  | sheet | raw values | `var(--text-*)` |
  |---|---|---|
  | `view.css` | 43 | 0 |
  | `project-view.css` | 39 | 0 |
  | `article-view.css` | 22 | 1 |

  21 distinct raw rem values are declared (`0.66 · 0.7 · 0.72 · 0.74 · 0.75 · 0.78 · 0.8 · 0.82 ·
  0.85 · 0.875 · 0.88 · 0.9 · 0.925 · 0.95 · 1.15 · 1.2 · 1.3 · 1.4 · 1.5 · 1.6 · 2.6`), producing
  **19 distinct rendered pixel sizes on a single page** (10.88 → 41.6px), with clusters that cannot
  be told apart: 13.6 / 13.12 / 12.8 / 12.48 and 0.85 / 0.875 / 0.88rem. The tokens exist
  (`--text-xs` .75 · `--text-sm` .8125 · `--text-base` 1 · `--text-lg` 1.125 · `--text-xl` 1.375 ·
  `--text-2xl` 1.75) and are used once. This is the same "zero adoption of the type ramp" the §B.10
  overlay audit found, on a newer surface.

- **Focus vocabulary: 8 hand-rolled rings, 1 outright removal, 0 uses of the canonical token.**
  `grep focus-ring` across all three sheets returns **0**. Instead: `outline: 2px solid var(--primary)`
  at `view.css:110, 261, 577, 714, 761` and `project-view.css:364, 641` — a single-channel
  accent ring, which is exactly what `--focus-ring-shadow` (measured
  `0 0 0 2px #0b0f0f, 0 0 0 4px #f8fafa`) exists to replace, because no single colour clears 3:1
  against both the control fill and the page. Worse, `article-view.css:521-524` sets
  `outline: none` and changes only `border-color` — a 1px colour shift as the **sole** focus
  indicator on the comment composer. That is the auth.css failure mode §B.8/§A.7 was written
  against.

- **Hand-rolled controls.** `.vw-cta` (`view.css:558-608`), `.vw-sort__opt` (1079-1096),
  `.vw-showcase__tab` (692-717), `.pf-availtoggle__opt` (738-764), `.art-composer__input`
  (507-524) and `.art-composer__post` (529-536) each re-declare padding, radius, font, transition
  and focus rather than composing `Button` / `SelectButton` / `Textarea`. The Button policy
  (§B.8.1) cannot be enforced on a control that is not a `Button`: `.vw-cta--primary`,
  `--outline` and `--ghost` are a private three-variant vocabulary parallel to the system's four.

---

## 5. Scannability

Not a list surface at the page level, so the three-second test applies to the reviews list and the
recommendation rails.

- **Reviews pass.** Star filter + sort + a `min(240px,300px)` sticky aggregate column
  (`view.css:942-964`) is a good, conventional pattern and the empty result is handled
  (`"No reviews match this filter."`, `ReviewsPanel.island.tsx:144`).
- **Recommendations fail.** `RelatedSection` splits items by type into sub-blocks
  (`RelatedRail.tsx:42-52`), each rendering a *different* idiom — a Carousel for services /
  projects / articles / profiles, a CSS multi-column masonry for products
  (`view.css:920-925`). Two sections × up to five type-blocks × two idioms means the user
  scans a rail, then a masonry, then a rail, with a `.vw-group__label` at 0.9rem/600 in
  `--text-secondary` as the only signpost. 1550px of one section is a lot of vertical distance to
  hold a mental model across.
- The `.vw-creator` card (`view.css:408-419`) sits on `--surface-1` against `--bg`: measured
  contrast **1.1:1**. It is a 405×76 box that is functionally invisible as a box — either commit to
  the tonal step or drop the container and let the avatar + name do the work (§B.4 tier 1).

---

## 6. Empty / loading / error / partial states

| State | Status |
|---|---|
| **Item not found** | **Unstyled** — see P0 above. Copy is fine ("This item may have been removed or the link is out of date") and it does teach a next action; it just renders as a bare link. |
| **Schedule unavailable** | **Undesigned.** `schedule.tsx:24-26` returns a bare `<p class="cal-surface__empty">This schedule isn't available.</p>`. Measured: the class has **no rule in the CSSOM** on that route (the calendar sheet rides the `ScheduleView` island, which this branch does not render), so it inherits `--on-surface` at 16px, full-bleed at `y=64`, top-left. No title, no icon, no back link, **no next action**. |
| **Reviews filtered to zero** | Designed enough — a one-line message plus a persistent "clear filter" control. |
| **Partial / incomplete project data** | **Genuinely well done.** `project-view.css:705-737` defines a three-tier degradation (`none` / `neutral` / `prompt`), tints placeholder values down, and `:empty` / `:has()` rules collapse unconfigured sub-blocks so a bare stage never draws an empty strip. `ProjectShowcaseBody.tsx:52-74` writes owner-facing prompts that teach the next action ("Add a description so freelancers understand the goals"). This is the standard the two states above should meet. |
| **Loading** | None exists, and none is needed for the SSR body. But `ServiceShowcase` swapping to the calendar (`ServiceShowcase.island.tsx:68-73`) has no skeleton for the client-fetch fallback path, and the basket/apply/report actions are optimistic with a single `role="status"` line (`ViewActionLane.island.tsx:387`, `min-block-size: 1rem`) as the only feedback channel. |

---

## 7. Responsive walk

| Width | Behaviour |
|---|---|
| **1440** | Sidebar 64 + lane 280 + body 1081. Hero 596/405. Gallery main **516×387**. Healthy. |
| **1180** | Body 821. Hero `421px 320px`. Gallery main **341×256**. |
| **1024** | Body 665. Hero `265px 320px`. **Gallery main 185×139px.** |
| **768** | Lane still 280px. Body **409px** (361px of content). Hero stacks. Page height balloons 4258 → **5548px**. |
| **390** | Lane `display:none`. **Price and every CTA disappear** (P0). Zero horizontal overflow. |

Two distinct structural failures:

**(a) The media column is the only one that yields.** `.vw-hero` is
`minmax(0, 1.25fr) minmax(320px, 0.85fr)` (`view.css:56`). The **secondary, informational** column
has a hard 320px floor; the **primary** media column has a floor of `0`. So under pressure the hero
image collapses while the description holds its width. At 1024 the product's primary showcase
renders at **185×139px — smaller than any recommendation card below it.** That is a hierarchy
inversion caused entirely by which column got the floor.

**(b) The stacking breakpoint measures the wrong box.** `@media (max-width: 960px)`
(`view.css:61`) is a **viewport** query on a surface whose container is 344px narrower than the
viewport (64px rail + 280px lane). At a 1024 viewport the container is 665px — well past the point
where two columns work — but the query still reads 1024 and keeps them. The hero needs a container
query, or a breakpoint set ~350px higher to account for the chrome.

**(c) 768–960 is the worst state on the surface.** The lane holds a fixed 280px while the body drops
to a single 361px column: nav chrome takes **45% of the viewport** to show a phone-width page. The
lane has a perfectly good collapsed icon rail (`ViewActionLane.island.tsx:232-266`) that is never
auto-engaged at this range.

---

## 8. RTL — passes cleanly

`dir="rtl"` at 1440, measured. Every element mirrors to the opposite edge and nothing overflows:

| element | LtR x | RtL x |
|---|---|---|
| lane | 64 | 1081 |
| `.vw-details` / title / creator | 996 | 24 |
| `.vw-gallery__strip` | 368 | 989 |
| `.vw-gallery__main` | 448 | 461 |
| `.vw-revagg` / `.vw-revlist` | 368 / 700 | 757 / 24 |
| `.vw-related__all` ("See all →") | 1346 | 24 |
| `.vw-gallery__zoomhint` | 831 | 473 |

`document.scrollWidth - innerWidth = -15` and `scrollLeft` min `0` in **both** directions — zero
horizontal overflow. Logical properties are used consistently across all three sheets. This is the
one axis the surface fully satisfies.

Residual: the `→` in "See all →" (`RelatedRail.tsx:39`) and the `←` in the back links
(`EntityViewScreen.tsx:39`, `ViewLaneHeader.tsx:113`, `schedule.tsx:30`) are **literal characters**,
so they point the wrong way under RtL. §B.7 also bans the Unicode icon family outright — these are
five sites of it.

---

## 9. Anti-patterns

- **Nested containers.** `.vw-teamrole` (`view.css:787-794`) and `.vw-role` /`.vw-seatpool`
  (`project-view.css:186-232`) are non-interactive rows given `--surface-1` + `--radius-md` +
  padding — card geometry for content that is not a discrete addressable object (§B.9.1). Inside
  `.vw-stage__card`, which is itself `--surface-1` (+ `--surface-2` and `elevation-low` when open,
  `project-view.css:345-348`) — so an open stage is tint → tint → tint, three surface layers deep.
- **Card geometry declared locally.** §B.9.6 requires padding/radius/media ratio from the §A.3 card
  tokens. `--card-pad` (1rem), `--card-gap` (0.75rem), `--card-radius` (12px) appear **zero** times
  across the three sheets; `.vw-stage__card`, `.vw-teamrole`, `.vw-role`, `.vw-seatpool`,
  `.vw-revagg`, `.art-audio` and `.vw-empty--block` each declare their own.
- **Redundant separation.** `.vw-stage[data-open]` carries a tonal step **and** an inset
  `border-inline-start: 3px` accent **and** `elevation-low` on one boundary — three devices where
  §B.9.3 budgets one.
- **Competing primaries in one eyeline.** The service lane stacks `.vw-cta--primary` (filled),
  `.vw-cta--outline` and `.vw-cta--ghost` at 242px wide each, all full-width, all 44px, all
  `--radius-full`, separated by 8px (`ViewActionLane.island.tsx:344-365`). Three identically-shaped
  full-width pills; only fill distinguishes them. §B.8.1's weight ladder is present in colour but
  not in form.
- **Colour as sole meaning carrier.** `.vw-stage[data-status]` (`project-view.css:315-344`) encodes
  completed / active / upcoming purely as `--success` / `--primary` / neutral on the node and the
  inline-start accent. The node does carry an index number, but nothing distinguishes *state* other
  than hue — no shape, no mark, no text. `.vw-seatmeter__seg[data-filled]`
  (`project-view.css:424-435`) is the same: filled vs unfilled is hue alone.
- **`max-inline-size` on a framed surface.** `.vw` sets `max-inline-size: 1180px; margin-inline: auto`
  (`view.css:11-17`) *inside* a shell region that is already 1081px at 1440. It never binds where it
  is needed and centres the article column 152px away from its own TOC lane on the article template
  (measured: lane ends at 344, `.vw-article` starts at 496). Decision #60 deleted exactly this
  pattern from `/wallet` for the same reason. A reading measure belongs on the prose element
  (`.art-layout` already does it correctly); the page frame should fill its region.

---

## Ranked fix list

| # | Fix | File:line |
|---|---|---|
| 1 | **Mobile transactional fallback.** Render price + CTA stack in the body (or a sticky bottom bar) under `@media (max-width: 767px)`, mirroring `profile.css:260-280`. Nothing else matters until a phone can buy. | `view.css` (new ≤767 block) · `EntityViewScreen.tsx:75-78` · `ServiceViewScreen.tsx:53-63` |
| 2 | **Style the not-found state.** Import `view.css` + the `EmptyState` sheet into `ViewStyleAnchor`, and render `<ViewStyleAnchor />` inside the early-return branch. | `ViewStyleAnchor.island.tsx:1-21` · `EntityViewScreen.tsx:35-47` |
| 3 | **Give the media column the floor, not the description.** `minmax(360px, 1.25fr) minmax(0, 0.85fr)`, and convert the stack breakpoint to a container query (or raise it to ~1300px viewport). | `view.css:54-66` |
| 4 | **Restore the hero → stage-showcase boundary.** Give `.vw-service__stages` a real rule (`margin-block-start: var(--space-7)`) or make `.vw` a flex column with a gap. | `view.css:11-17` · `ServiceViewScreen.tsx:68` |
| 5 | **Delete the duplicate body tablist above 767px** (or scope it `@media (max-width: 767px)`), removing the second `role="tablist"` with identical options. | `ServiceShowcase.island.tsx:43-66` · `view.css:684-717` |
| 6 | **Rebalance the lane.** Promote the price above the CTA stack at ~2rem, and demote `.vw-trust` to a compact single-line row set — currently 249px of lane for reassurance vs 28px for the number. | `ViewActionLane.island.tsx:280-283, 421-433` · `view.css:537-551, 620-662` |
| 7 | **Cap the cross-sell.** One recommendation section, not two; collapse the per-type sub-blocks into a single mixed rail. Target ≤35% of page height (currently 73%). | `EntityViewScreen.tsx:82-98` · `ServiceViewScreen.tsx:85-102` · `RelatedRail.tsx:42-52` |
| 8 | **Adopt `--focus-ring-shadow`** at all 8 hand-rolled sites, and fix the composer's `outline:none` single-channel ring. | `view.css:110, 261, 577, 714, 761` · `project-view.css:364, 641` · `article-view.css:521-524` |
| 9 | **Move sort + star-filter out of the body** into a `/view`-scoped footer band (mirroring `filesFooterFor` / `walletFooterFor`). | `ReviewsPanel.island.tsx:81-107, 127-140` · new `viewFooterFor` |
| 10 | **Map 21 raw font sizes onto the 6 `--text-*` tokens.** Start with the indistinguishable clusters (0.85/0.875/0.88 → `--text-sm`; 13.6/13.12/12.8/12.48px). | `view.css` (43) · `project-view.css` (39) · `article-view.css` (22) |
| 11 | **Auto-collapse the lane to its icon rail between 768–960px**, returning ~216px to a 361px body. | `ViewActionLane.island.tsx:232-266` · shell lane CSS |
| 12 | **Design the schedule empty state** — use `EmptyState` with a back link to the entity, and deliver its CSS on that branch. | `schedule.tsx:24-26` |
| 13 | **Compose `Button` instead of `.vw-cta` / `.vw-sort__opt` / `.vw-showcase__tab` / `.pf-availtoggle__opt`**, so §B.8 is enforceable; differentiate the three lane CTAs by form, not fill alone. | `view.css:558-608, 692-764, 1079-1096` · `ViewActionLane.island.tsx:319-385` |
| 14 | **Replace the five literal `←`/`→` characters** with registry glyphs (§B.7) so they mirror under RtL. | `EntityViewScreen.tsx:39, 71` · `ViewLaneHeader.tsx:113` · `RelatedRail.tsx:39` · `schedule.tsx:30` |
| 15 | **Spend the separation budget once.** Drop the `.vw-section` hairline stack in favour of `--space-5` above each heading; pick one device for the open-stage boundary. | `view.css:471-477` · `project-view.css:326-348` |
| 16 | **Delete the two dead Apply copies**, or fix the two component docs that claim they render. | `ProjectActions.tsx:9-13` · `ProjectViewScreen.tsx:16` · `ProjectViewHeader.island.tsx:125-127` |
| 17 | **Add a non-colour state channel** to stage status and the seat meter. | `project-view.css:315-344, 424-435` |
| 18 | **Read card geometry from the §A.3 tokens** in the seven local card-shaped blocks. | `view.css:787-794, 955-964` · `project-view.css:186-232, 326-348` · `article-view.css:269-277` |

---

## Outcome — all 18 applied (2026-07-31)

Re-measured in-browser after the pass, same method. `detect.mjs` over the feature + both route
hierarchies: **clean, 0 findings**. `deno check` + `deno fmt` clean, no console errors.

| Metric (flagship Pipeline service, 1440×900) | Before | After |
|---|---|---|
| Page height | 4 258px | **3 131px** (−26%) |
| Cross-sell share | 73% | **39%** (reviews a further 19%) |
| Product share (hero + stages) | 25% | **34%** |
| Hero → stages gap | **0px** | 48px |
| Stages → cross-sell gap | 32px | 64px |
| Showcase image @ 1024 viewport | **185×139** | **537×403** |
| Showcase image @ 900 viewport | ~140px wide | **623×467** (lane auto-collapses to 70px) |
| Content region @ 900 viewport | 541px | **751px** |
| Price rank by ink mass | 12th of 15 | **8th** |
| Trust-block ink | 13 272 | 8 468 (−36%) |
| Raw `font-size` values across 3 sheets | 104 | **0** |
| Hand-rolled focus rings | 8 (+1 `outline:none`) | **0** |
| Visible duplicate tablists | 2 | **1** |

Two P0s closed, verified:

- **Mobile transaction.** 390×844 now renders `$120 – $480` at 28px, and Buy now (`filled`) / Add to
  basket (`outlined`) / Message team (`text`) at 342×40 each, plus trust facts — with **zero**
  duplicate CTAs in the lane and zero horizontal overflow. Reading order is back → hero → **buy** →
  stages → cross-sell.
- **Not-found.** `.vw`, `.ui-empty`, `.ui-button` and `.vw__back` all present in the CSSOM; the CTA
  measures a real 156×40 filled pill (`rgb(0,146,158)`, `radius 999px`) instead of a 21px bare link.
  Same fix applied to both `/view/[id]/schedule` routes.

**Three defects found during verification that the source read had missed** — each one only visible
by measuring the composed page:

1. **A stray `.ex` class was capping every recommendation section at one viewport.**
   `RelatedSection` wore `.ex` to inherit the `--ex-*` card tokens, but those moved to `:root` when
   the card system was unified — so all that remained was `explore.css`'s page-root
   `min-block-size: 100vh`. Measured: both sections stood at **exactly 900px** in a 900px window
   while their real content was 439px and 786px. Removing one class took `.vw-body` from 3 122px to
   1 871px. This was the single largest contributor to the 73%.
2. **A one-item rail rendered one card at full width.** `RelatedCarousel` caps `numVisible` to the
   item count so a lone card "fills the viewport" — which turned a single article into a 1017×**773px**
   block, taller than the entire stage showcase. Capped the card, not the slot.
3. **`.view-schedule*` lived in the calendar feature's sheet**, so it was delivered only by the
   `ScheduleView` island — meaning the branch that renders no calendar had no rules at all. Moved to
   `view.css`, which owns the route.

**One fix was deliberately not implemented as specified — flagged, not silently dropped.** #9 said to
hoist the review sort + star filter into a page-level footer band. The `/wallet` contract's footer
owns controls that govern the **surface**; these govern one section a third of the way down a
composed page, and a persistent band offering "Most recent · Highest · Lowest" while the reader is
looking at the hero would be worse than the problem it solved. `/view` is Persuade, not Operate — its
body is a composition, not one dataset. The controls stay with their list and are now **sticky to
it** (`view.css` `.vw-revlist__toolbar`), which removes the "body content that scrolled past" reading
without inventing surface chrome for a section control. Every other region breach in the table was
fixed outright.

Also applied beyond the list, from the craft floor: both eyebrows removed (the entity format folded
into the badge row, the article topic moved into its byline), `text-wrap: balance` on both titles, the
pull-quote's 3px accent slab reduced to 1px, a native `title` removed from the seat meter (§B.6), and
`--fld-hit` floors on the back link, review bars, sort options and clear-filter control.

---

## What is already right

Worth protecting through any of the above:

- **RtL is complete and correct** — logical properties throughout, zero overflow both directions.
- **The article reading measure** (`article-view.css:110-128`) — `ch` resolved against the prose's
  own font-size, with the reasoning recorded in the comment. Best spatial decision on the surface.
- **The incomplete-data degradation model** (`project-view.css:705-737` +
  `ProjectShowcaseBody.tsx:52-74`) — three tiers, collapsing empty strips, prompts that teach.
- **Reduced-motion is honoured** in all three sheets (`view.css:353`, `project-view.css:739`,
  `article-view.css:625`).
- **The lane genuinely owns the transaction** on desktop — the region intent is right; it is the
  responsive fallback and the internal balance that fail.
