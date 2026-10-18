# Landing — `/` and `/features` (L0 spec)

> **Status: L0 DELIVERED, 2026-10-17. L1 DELIVERED, 2026-10-17, review applied 2026-10-18 (§0 "L1
> delivered"). L2 DELIVERED, 2026-10-18, review applied 2026-10-18 (§0 "L2 delivered").** This is
> the landing track's spec: the direction the product owner chose, the wireframes, the `--lp-*`
> token sheet, the copy deck, the **claims table** (the honesty gate L6 walks), the visualizer list,
> the performance budget and the asset list. Business rules are not restated here; each claim links
> to the code or decision that proves it, and [`PRODUCT_SPEC.md`](../business/PRODUCT_SPEC.md) stays
> the source of truth for what the product does.

---

## 0. Status & links

| Item            | Where                                                                                                                                                                                                                                                                                                                                                                                                       |
| :-------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work order      | [`PUBLIC_ROUTES_BUILD_PROMPTS.md`](PUBLIC_ROUTES_BUILD_PROMPTS.md) §0.1 (decisions g–k), §2 (the landing reference pack), L0–L6                                                                                                                                                                                                                                                                             |
| Decisions       | [#280](../reference/decisions/decisions-122-126.md) exemption (g) · #281 claims (h) · #282 shortcut (i) · #283 vocabulary (j) · #284 direction · #285 L1 build rulings · #286 L1 review rulings and the initial-JS budget ruling · #287 L2 build and review rulings (FLAGS (B), (C) for the owner) — index in [`decisions/README.md`](../reference/decisions/README.md). #288–#289 stay reserved for L3–L6. |
| Owner answers   | L0 STEP 0, all eight questions answered 2026-10-17 (§1)                                                                                                                                                                                                                                                                                                                                                     |
| Off-system note | [`DESIGN_SYSTEM.md`](../design-system/DESIGN_SYSTEM.md) Part E "Off-system surfaces" · [`PRODUCT_SPEC.md`](../business/PRODUCT_SPEC.md) §Visual Identity                                                                                                                                                                                                                                                    |
| L1 delivered    | 2026-10-17 — the shell, the scoped theme and the background; listed below the table                                                                                                                                                                                                                                                                                                                         |
| L2 delivered    | 2026-10-18 — the hero search, chips, calls to action and theatre; listed below the table                                                                                                                                                                                                                                                                                                                    |
| Next prompt     | L3 (visualizer engine + first demos), once the owner rules on #287 FLAGS (B) and (C)                                                                                                                                                                                                                                                                                                                        |

**L1 delivered (2026-10-17).**

- **Shell.** `/` and `/features` render in `LandingShell` for guests and signed-in visitors
  (`routes/(public)/_layout.tsx` `LANDING_PATHS`; `ROUTING.md`): the `.lp-root` canvas, the skip
  link to `#main-content`, the `LandingHeader` pill and its menu sheet, and `PublicFooter` outside
  `.lp-root`. Without JavaScript every header link works and the pill wears its glass; below
  `--bp-md` the menu button renders once hydrated (until then "Get started" stays in the pill), and
  from `--bp-lg` the pill sheds its glass at the top only over measured quiet zones, which include
  its own band (#286 (B)).
- **Theme.** `lp-theme.css` carries every §3 token (light, dark, both high-contrast channels,
  dyslexic, both reduced-motion channels); `lp-shell.css` the pill, buttons, sheet, hero skeleton
  and the §3.4 registers.
- **Hero.** `#hero` renders the §4.1 option 1 eyebrow, h1 and subline over `LandingBackground`; L2
  adds the search, the chips, the calls to action and the theatre ("L2 delivered" below).
- **Background.** `LandingBackground` paints the static B7 grid, B10 grain and SVG constellation on
  the server and upgrades to the B1 WebGL2 constellation only behind the §3.6 gate; it reflects
  `data-lp-bg`, `data-lp-bg-reason` and `data-lp-bg-paused` on `.lp-root`. The canvas starts from,
  and settles back onto, the SVG's own picture (one 64-node reference layout, its two resting
  teams).
- **Head.** The §4.0 title, meta description and Open Graph copy; Organization + WebSite
  (SearchAction) JSON-LD. The old landing's `LANDING_META` and `landingJsonLd` are deleted from
  `seo.ts`, with their SoftwareApplication offer and FAQ answers (§9 row 15).
- **Gates.** `core/lp-leak.test.ts` gates the namespace (the #285 (B) allowlist, held to the seven
  footer files); `core/lp-theme.contrast.test.ts` recomputes §3.3 from `lp-theme.css` and fails a
  cell below its floor or a published cell that drifts. The old marketing landing is deleted, with
  the leftovers it alone used (`freelancerFloor`, the `data-magnetic` hooks).
- **Held.** The pill lists only Explore until `#how-it-works`, `#pricing` (L4) and `/features` (L5)
  exist. With L2's hero search in place Explore shows from `--bp-lg` (§2.2 note 1), and while it is
  the only link the pill's nav is not drawn below `--bp-lg`, so no empty "Main" landmark shows
  (#287). The FAQPage JSON-LD joins with the FAQ (L4).
- **Budget — RULED 2026-10-18: strip + defer + rescope (§7, §9 row 29, #286 (A)).** L1 measured `/`
  at 171.8 kB gzip initial JS for a guest and 394.4 kB signed in against an all-in 60 kB. `/` and
  `/features` now strip `?tkv=` with a server 303 instead of mounting `TicketDeepLinkHost`, a
  signed-in visitor's `ChatPopoutHost` loads only once a chat is open (`LazyChatHost`), and the 60
  kB counts landing-owned JS while the app baseline is held at its measured size (109,799 bytes,
  pinned by #287). With L2's hero the budget script reports landing-owned 25.2 kB, the baseline at
  its 109.8 kB cap, the hero search's own weight 19.1 kB of 20, and page totals of 138.5 kB guest /
  142.5 kB signed in.

**L2 delivered (2026-10-18; review applied the same day, Decision #287).**

- **Search.** `HeroSearch` over `HeroSearchForm`: a real `GET /explore` form (`q`, a native
  `category` select named "Search in" over the five categories), the input an ARIA combobox on
  Explore's headless `createSuggestController` (200ms debounce, abort, sequence guard) grouped
  People & teams · Services · Projects, recent searches (each with a named remove button; Delete, or
  Backspace on an empty field), Trending, "Search Explore for “q”" and the no-match row; the active
  row kept in sight; forced-colours selection. Enter and the submit land on
  `explorePath(category, q)`, and do so even when the history chunk fails. `/` focuses the field;
  its "/ to search" hint and `aria-keyshortcuts` appear once the key is bound. Below `--bp-md` an
  icon button the select's width opens `CategorySheet` (arrows move the choice inside it; Escape
  keeps the old one).
- **Terms and chips.** `ExploreBackendService.landingHero()` derives them from one catalogue load: a
  generic phrase read off each recommended title, names and acronyms cut out, kept only on a
  typeahead hit and topped up from the §4.1 fallbacks; the chips are the trending terms, else the
  typewriter's. The route is thin: one call, passed through.
- **Motion.** One hero timeline (`core/hero-motion.ts`): typewriter and board take turns; a
  typewriter turn lasts as long as its longest example needs; a board turn the theatre cannot play
  yet is owed, not lost; hovering or focusing the field holds the timeline (the B9 ring may turn),
  using the search ends it; the ring rests while the suggestions are open; Save-Data and either
  reduced-motion channel keep the board a still poster, which goes back to its first frame whenever
  reduced motion turns on.
- **Theatre.** `HeroTheatre` renders real kanban columns over the board model, whose tags read the
  way the product's card reads them (FLAGS #287 (B), (C)); "Try it yourself" waits for L3's `#demo`.
- **Tests.** `core/hero-search.test.ts`, `core/hero-motion.test.ts`,
  `components/landing-hero.test.tsx`, `core/landing-routes.test.ts` (every `LANDING_PATHS` route
  strips `?tkv=` first), `core/demos/board-model.test.ts`,
  `packages/backend/services/explore/landing-hero.test.ts`, and the browser suite
  `apps/web/tests/e2e/landing-hero.spec.ts` (`deno task test:e2e`).

**Peer dependencies.** P0 is merged into this branch; none of the others is yet. Each landing
surface that needs one is hidden until it lands; it never renders a placeholder, a zero or a 404.

| Peer                      | What the landing needs from it                                                                                                                                                                                                                                                                            | Until it lands                                                                                                                                                                                                                                                                                                             |
| :------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 (editorial foundation) | `seo.ts` `pageMeta` + JSON-LD builders; reserved handles incl. `features`; `/test_images/profile_2-6` copied to `apps/web/static/test_images/`                                                                                                                                                            | **Landed** (merged at `48b09a3d`): L1 consumes `pageMeta` / `applyPageMeta`, `JsonLd` + `jsonLdGraph`, `organizationJsonLd` / `webSiteJsonLd` and the `--chrome-pinned-h` hook; `features` is already reserved (`RESERVED_HANDLES`, `org.fn_is_reserved_handle`) and `profile_2`–`6` are in `apps/web/static/test_images/` |
| P1 (legal hub)            | `/legal/escrow-terms`                                                                                                                                                                                                                                                                                     | The "Read the payment protection terms" link is not rendered                                                                                                                                                                                                                                                               |
| P2 (help centre)          | `/help/<article>` for each "Learn more"                                                                                                                                                                                                                                                                   | "Learn more" points at `/help`; per-article links wait                                                                                                                                                                                                                                                                     |
| P4 (about + metrics)      | `PublicMetricsService.get(): ServiceResult<PublicMetrics>` at `@server/services/marketing/PublicMetricsService.ts` (`asOf`, `minN`, `platformFeeBp`, `totalValueProtected {amountMinor, currency} \| null`, `stagesDelivered \| null`, `medianFundingToApprovalHours \| null`); `GET /api/public/metrics` | The Real numbers section is omitted; the fee is read from `security.platform_params.platform_fee_bp` through a service, never hard-coded                                                                                                                                                                                   |
| P8 (integration sweep)    | Sitemap with `/` and `/features`; footer/megamenu link fixes                                                                                                                                                                                                                                              | L6 checks it                                                                                                                                                                                                                                                                                                               |

---

## 1. Direction (owner answers, 2026-10-17)

| #  | Question                 | Answer                                                                                                                                                                                                                                                                                                                                                                                                        |
| :- | :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1  | Layout                   | **A** search-first + **D** product theatre (a tilted live board mock built from real `@projective/ui` components playing the V1 board demo) + **F** live marketplace rails from `ExploreBackendService.landing()` under Ways to work                                                                                                                                                                          |
| 2  | Style                    | **#1 Dark precision** base (near-black, hairlines, mono metadata, 1–2 glowing accents) + **#3 Warm fintech editorial** (serif display) for the trust and payments sections; **light mode is #8 light-airy** (pale gradients, soft shadows), not an inversion of dark                                                                                                                                          |
| 3  | Background               | **B7** grid + cursor spotlight, **B9** glow border on the search bar and **B10** subtle grain now (the static SSR paint is the LCP-safe paint); **B1** constellation (freelancers gather into a team) as a lazy WebGL2 upgrade on capable devices; static SVG constellation as its fallback                                                                                                                   |
| 4  | Demo stage               | Tabs **V1** Live board · **V2** Payment protection · **V4** Booking · **V5** Team pay (`?demo=board\|payments\|booking\|splits`, default `board`); **V8** matchmaker lives in the hero search; everything else goes to `/features` only                                                                                                                                                                       |
| 5  | Exemption (g)            | Scoped: `features/landing/**`, the `/` route and the `/features` route only; `lp-` classes and `--lp-*` tokens scoped to `.lp-root`; a leak unit test. **Not exempt:** accessibility, both reduced-motion channels, islands never touch the DB, thin routes / fat services, security, SEO, the performance budget. **Raw WebGL2, zero new dependencies** (`three` is not used on the landing) — Decision #280 |
| 6  | Shortcut (i)             | Show `/` only (focuses the hero search via `isFocusSearchShortcut`); `Cmd+K` stays reserved; no command palette in this track — Decision #282                                                                                                                                                                                                                                                                 |
| 7  | Cool accent              | **Teal `#288690`** (tints and shades per pairing for contrast) paired with brand **amber `#D98216`** (Decision #157)                                                                                                                                                                                                                                                                                          |
| 8  | Signed-in visitor at `/` | Show the landing page in its LandingShell with an **"Open app"** button in place of "Sign in"; never redirect; `/home` untouched                                                                                                                                                                                                                                                                              |

Claims rule (h) and vocabulary (j) were not STEP 0 questions; they are recorded as #281 and #283 on
the work order's terms, with the corrections the claim research forced (§5, §9).

---

## 2. Wireframes

All copy in the frames is placeholder; §4 (copy deck) and §5 (claims table) own every sentence. `#`
digits are live values, `<…>` payload rows. Vertical spacing is not to scale.

**Legend**

```text
[[ Label ]]  the region's one filled primary            [ Label ]   tonal or outline button
Label ->     text link                                  ( chip )    chip / link pill
[x]          icon button ([=] menu, [*] theme, [#v] category picker, [..] card menu)
[/]          kbd hint: "/" focuses the hero search (#282; never a Cmd+K hint)
.:  :.       fade edge on a horizontal scroller         <| |>       prev/next (pointer: fine only)
~1~ ~2~      animated now; counts toward the cap of two in view at once (§2.7)
voice P      #1 dark precision, mono metadata           voice E     #3 warm editorial, serif titles
+- band      a solid region-tone change (never translucent)
=== fold     the first-viewport fold (375x812 · 768x1024 · 1280x800 · 1600x900)
(n)          annotation number, listed under the block
```

Light mode (#8) keeps every layout. The near-black field becomes a pale gradient wash
(`--lp-canvas-paint`), glows become soft shadows, the grid drops to low contrast and the
constellation is drawn as ink on paper. Under either reduced-motion channel every `~n~` item renders
its static state (§2.7).

### 2.1 `/` at 375 (mobile)

**Hero to How it works** · 1 char ≈ 9.4px · 17px gutter

```text
+- / · 375 · guest · dark ---------------+
|                                        |
| +------------------------------------+ |
| | (P) Projective       Sign in  [=]  | | (1)
| +------------------------------------+ |
|                                        |
| READY-MADE TEAMS · PAYMENT PROTECTION  | (2)
|                                        |
|        Hire a ready-made team.         | (3)
|        Pay one stage at a time.        |
|                                        |
|    Search for a team that's already    |
|   formed. Work starts only once it's   |
|    paid for. They're paid when you     |
|                approve.                |
|                                        |
| +------------------------------------+ |
| | [#v] | Try "brand identity"  [[>]] | | (4) ~2~
| +------------------------------------+ |
|  Try                                   | (5)
|  ( brand identity ) ( landing page ) .:|
|                                        |
|  [           Hire a team            ]  | (6)
|          Offer your skills ->          |
|                                        |
|  .-----------------------------------.:| (7)
|  | WORK BOARD · Website refresh      .:|
|============= fold @ 812px =============|
|  | New         Ready         In Prog .:|
|  | .---------. .---------.   .-------.:|
|  | |Launch   | |Logo v2  |   |Homepa .:|
|  | |emails   | |£400     |   |£2,000 .:|
|  | |Draft    | |Needs    |   |Funded .:|
|  | '---------' |funding  |   '-------.:|
|  |             '---------'           .:|
|  '-----------------------------------.:|
|  Try it yourself ->                    |
|                                        |
|  WHY IT'S DIFFERENT                    | (8)
|  One team, not five strangers.         |
|                                        |
|  WHO YOU HIRE                          |
|  Before  Five freelancers, hired one   |
|          by one                        |
|  Now     One ready-made team. They     |
|          apply, work and get paid      |
|          together                      |
|  ------------------------------------  |
|  HOW IT'S PRICED                       |
|  Before  Open-ended hourly billing     |
|  Now     A fixed price, agreed before  |
|          work starts                   |
|  ------------------------------------  |
|  WHEN MONEY MOVES                      |
|  Before  Pay up front for the whole    |
|          job                           |
|  Now     Pay one stage at a time       |
|  ------------------------------------  |
|  (+ Keeping track · Team pay rows)     |
|                                        |
|  HOW IT WORKS                          | (9)
|  From search to payday in six steps.   |
|                                        |
|  01 o  Find your team                  |
|     |  Search for a ready-made team,   |
|     |  or post your own project.       |
|     |                                  |
|  02 o  Pay for the first stage         |
|     |  Your money is held safely.      |
|     |                                  |
|  03 o  The team gets to work           |
|     |  Each task moves across the      |
|     |  board, from Ready to Review.    |
|     |                                  |
|  04 o  Review the work                 |
|     |  Not quite right? Ask for        |
|     |  changes.                        |
|     |                                  |
|  05 o  Approve and pay                 |
|     |  The team is paid, minus the     |
|     |  5% fee.                         |
|     |                                  |
|  06 o  The team withdraws              |
|        Their money clears in 7 days.   |
|                                        |
+----------------------------------------+
```

1. **Header pill** — LandingShell's own pill, not SiteHeader. Sticky, floating `--lp-header-inset`
   (12px) from the top, glass on `::before`. A skip link to `#main-content` comes before it (the
   app's `PAGE_CANVAS_MAIN_ID`, not the work order's `#main`; #284 flag). Below `--bp-md`: mark +
   wordmark, "Sign in" (→ `/login`) and a menu button for the menu sheet (§2.1 overlays). A
   signed-in visitor sees "Open app" (→ `/home`) instead; the page never redirects. No search in the
   pill; the hero owns search.
2. **Eyebrow** (optional) — mono, wide-tracked caps, `--lp-teal-ink`.
3. **h1** — the page's only h1, SSR text, the LCP element at every width; centred, at most three
   lines at 375.
4. **Search** — `<form role="search" action="/explore" method="get">` with `q` and `category`, so it
   works with no JS.
   - The picker collapses into the leading **[#v]** icon button (current category glyph), opening
     the category sheet; a hidden input carries the value.
   - Full-width input; its typewriter placeholder is the hero's `~2~`.
   - Submit **[[>]]** is icon-only (`aria-label="Search"`), the region's one filled primary, press
     `scale(var(--lp-press-scale))`.
   - B9 glow border static at rest, at most three turns on hover/focus.
   - No `/` hint on `pointer: coarse`.
5. **Suggested chips** ("Try:") — SSR from
   `ExploreBackendService.suggest({q:"",scope:"all"}).trending`, each a real link to
   `explorePath('all', term)`; one row, sideways scroll with snap, bleeds to the edge, mask fades;
   the row's height is reserved so the suggestions panel overlays rather than pushes. Never labelled
   "Popular": on a quiet platform the list falls back to the most-listed terms (§4.1).
6. **CTAs** — neither filled (the submit owns the region's primary). "Hire a team" is tonal, full
   width, a link to `explorePath('teams')`. "Offer your skills" follows the per-viewer mapping in
   §4.1.
7. **Board mock on mobile** — a static poster: the SSR `@projective/ui` kanban over fixtures, marked
   `inert`, flat (no tilt), no loop, no JS, cropped to ~2.3 lanes with a trailing fade. The whole
   block is one link, "Try it yourself" → `/?demo=board#demo` (the same label at every width). Below
   the fold, so never the LCP element.
8. **Why it's different** (voice P) — Before/Now pairs stacked; labels mono caps; "Before" in
   `--lp-text-2`. Compares ways of working, never named companies (#281).
9. **How it works** (`id="how-it-works"`, the anchor the megamenu already targets) — a numbered
   vertical spine; illustrations hidden below `--bp-md`; each step may reveal once (`--lp-dur-base`,
   220ms, `~1~` while it runs) when motion is allowed.

**Background at 375.** B7 grid and B10 grain are static; no pointer, so no spotlight. B1 runs as
`~1~` only on a capable device (WebGL2, `deviceMemory ≥ 4`, `hardwareConcurrency > 4`, no Save-Data,
neither reduced-motion channel) and only while the hero is on screen; it waits for idle after first
paint. Every other device gets the static SVG constellation.

**Demo stage to Real numbers**

```text
+- / · 375 · continued ------------------+
|                                        |
|  SEE IT WORK  #demo                    | (10)
|  See a project run, step by step.      |
|  Example only. No real money moves.    |
|                                        |
|  [Work board] Payment protection Bo.:  | (11)
|                                        |
| +------------------------------------+ |
| | READY               < 2 of 5 >     | | (12)
| | .-------------------------------.  | |
| | | Homepage design               |  | |
| | | £2,000 · Needs funding   [..] |  | |
| | | [ Pay for this stage ]        |  | |
| | '-------------------------------'  | |
| | .-------------------------------.  | |
| | | Logo v2                       |  | |
| | | £400 · Needs funding     [..] |  | |
| | '-------------------------------'  | |
| | [..] Move to In Progress: refused  | |
| | Needs funding. Pay for this stage  | |
| | before work starts.  ~1~           | |
| |                                    | |
| | aspect-ratio 4 / 5, reserved       | |
| +------------------------------------+ |
|  Work only starts once it's paid for.  | (13)
|  Approve, and it moves on.             |
|  [ Start again ]                       |
|  See everything Projective does ->     |
|                                        |
|  WAYS TO WORK  #ways-to-work           | (14)
|  Work the way you want.                |
|                                        |
| +------------------------------------+ |
| | A single job                   ->  | |
| | One clear piece of work, in        | |
| | milestones, each paid for as it    | |
| | starts.                            | |
| +------------------------------------+ |
| | An ongoing workflow            ->  | |
| | Task by task, across several       | |
| | stages.                            | |
| +------------------------------------+ |
| | A live session                 ->  | |
| | One session, a block, or a seat    | |
| | in a group.                        | |
| +------------------------------------+ |
|                                        |
|  Popular services   See all services ->| (15)
|  .-------------------------.  .------.:|
|  | [cover 16:9]            |  | [cov .:|
|  |                         |  |      .:|
|  | <Service title>         |  | <Ser .:|
|  | by <owner name>         |  | by < .:|
|  | from £###               |  | from .:|
|  '-------------------------'  '------.:|
|                                        |
|  Open projects · Ready-made teams ·    |
|  Freelancers (same rail; each hidden   |
|  under 4 items)                        |
|                                        |
+- band · voice E · solid --lp-warm-bg --+
|                                        |
|  PAYMENT PROTECTION #payment-protection| (16)
|  Money held safely, stage by stage.    |
|                                        |
|  This is payment protection (escrow):  |
|  when you pay for a stage, the money   |
|  is held safely before any work        |
|  starts.                               |
|                                        |
|  HELD BEFORE WORK STARTS               |
|  Until then, the task can't move into  |
|  work.                                 |
|  ------------------------------------  |
|  PAID WHEN YOU APPROVE                 |
|  The team is paid when you accept      |
|  their work or approve the stage.      |
|  ------------------------------------  |
|  A FAIR WAY OUT                        |
|  If work stops, end the stage with     |
|  Fair Exit. You pick how much was      |
|  done.                                 |
|  ------------------------------------  |
|  (+ 5 more: missed sessions · checked  |
|  before they take on project work ·    |
|  clears in 7 days · refunds without    |
|  fees · every penny on record)         |
|                                        |
|  .-----------------------------------. | (17)
|  | You                               | |
|  |  |  pay for the stage             | |
|  |  v                                | |
|  | Held safely                       | |
|  |  |  you approve                   | |
|  |  v                                | |
|  | Team paid, minus the 5% fee       | |
|  |  |  clears in 7 days              | |
|  |  v                                | |
|  | Ready to withdraw                 | |
|  '-----------------------------------' |
|  Get help with payments ->             |
|  Read the payment protection terms ->  |
|                                        |
|  THE NUMBERS SO FAR  #numbers          | (18)
|  Counted from real payments on         |
|  Projective, as of 17 Oct 2026.        |
|                                        |
|  £#,###,###                            |
|  Money protected so far                |
|  ------------------------------------  |
|  #,###                                 |
|  Stages delivered                      |
|  ------------------------------------  |
|  ## hours                              |
|  Half of approved stages were approved |
|  within this time of being paid for.   |
|                                        |
+- band ends ----------------------------+
```

10. **Demo stage** (`#demo`) — the SSR panel holds a descriptive paragraph and a poster per demo
    (crawlable). DemoHost hydrates when the stage scrolls into view; only the active demo's chunk
    loads (≤ 35 KB gzip).
11. **Tablist** — "Work board · Payment protection · Booking · Team pay"; one sideways-scrolling row
    with fades, the active tab scrolled into view. Roving tabindex; arrows move focus, Enter/Space
    activate (manual activation, so arrowing never loads chunks). URL `?demo=…` via `replaceState`,
    no scroll jump; the thin `/` controller reads `demo` so the server renders the right tab.
12. **Viewport** — reserved `aspect-ratio`: 4/5 below `--bp-sm`, 4/3 from `--bp-md`, 16/9 from
    `--bp-lg`; swapping demos never shifts the page.
    - V1 on a phone shows one lane at a time with a "< 2 of 5 >" pager (a drag inside a scroller
      fights page scroll).
    - The card's [..] "Move to…" menu is the **demo's own** touch path; the keyboard path is the
      real kanban's Space · Arrows · Enter · Escape
      (`packages/ui/kanban/components/KanbanCard.tsx`). The menu is never presented as a product
      feature (#284 flag).
    - A refused move gets an over-damped shake (no bounce) and a live-region message.
    - The demo counts as `~1~` only while an interaction plays.
13. **Below the viewport** — the caption (< 15 words, per tab), "Start again" (tonal, restores the
    fixture) and "See everything Projective does ->" → `/features`.
14. **Ways to work** — three full-width tiles (cards are allowed under #280). "A single job" posts a
    job: "Post a single job" → `/projects?create=1` (the Quick-Init modal; a guest signs in first
    and returns through `redirectTo`), because one-off service listings cannot be paid for at
    checkout (#281 flag q). The other two link to Explore's real services "Delivery model" facet
    (`filter-config.ts:153`, honoured at `query.ts:204-209`), built with `serializeExploreParams`
    (`explorePath` cannot emit facets): `/explore?category=services&model=Pipeline` and
    `…&model=Session&model=Group+Session` (byte-identical to the Explore Home "Sessions" chip).
    Projects have no archetype facet, so no tile links to `category=projects` filtered by type.
15. **Rails (layout F)** — from `LandingPayload.home`, sliced on the server (never the whole payload
    as island props). Each rail hides below 4 items; the block hides when the payload is null.
    ~260px cards with a peek, scroll-snap, trailing fade, no autoplay. "See all" →
    `explorePath(category)`. Images are payload URLs with width/height and `loading="lazy"`; avatars
    fall back to `DEFAULT_AVATAR_URL` (`/test_images/profile_1.jpg`). No products rail (file
    delivery is not shipped, #281).
16. **Payment protection** (voice E) — a solid `--lp-warm-bg` band, serif display h2, sans body.
    "Payment protection (escrow)" appears once, here (#283). Every point is a claims-table row.
17. **Money-flow diagram** — a static inline SVG (vertical on phones) with `<title>` and `<desc>`.
    "Get help with payments" → `/help`. "Read the payment protection terms" → `/legal/escrow-terms`,
    rendered only once P1 has merged.
18. **The numbers so far** — P4's `PublicMetricsService`. A figure renders only when non-null (at or
    above `minN`); the section disappears when all three are null or the result is not ok. Figures
    `tabular-nums`, no count-up; "as of" from `asOf`. The median's label follows P4's definition.

**For freelancers and teams to footer**

```text
+- / · 375 · continued ------------------+
|                                        |
|  FOR FREELANCERS AND TEAMS             | (19)
|  Earn together. Get paid together.     |
|                                        |
|  PAY THAT SPLITS ITSELF                |
|  When a stage is approved, the team's  |
|  payment splits into each member's     |
|  agreed share.                         |
|  ------------------------------------  |
|  CLEARS IN 7 DAYS                      |
|  Then each member can withdraw it to   |
|  their bank.                           |
|  ------------------------------------  |
|  AGREE WHO OWNS THE WORK               |
|  Every project states up front who     |
|  owns the finished work.               |
|  ------------------------------------  |
|  (+ 5 more rows, §4)                   |
|                                        |
|  .-----------------------------------. | (20)
|  | EXAMPLE · a £2,000 stage          | |
|  | [########|########|########|#]    | |
|  | Owner £570.11 · Designer £569.94  | |
|  | Developer £569.94 · Vault £190.01 | |
|  '-----------------------------------' |
|                                        |
|  [[       Offer your skills        ]]  |
|          Find open projects ->         |
|                                        |
+- band · voice E · solid --lp-warm-bg --+
|                                        |
|  PRICING  #pricing                     | (21)
|  A 5% fee.                             |
|  You pay the price you see.            |
|                                        |
|  The fee comes out of the team's       |
|  payment when it's paid out.           |
|  You pay the stage price, with         |
|  nothing on top.                       |
|                                        |
|  .-----------------------------------. | (22)
|  | Stage price                       | |
|  | +------------------------------+  | |
|  | | £ | 2,000            [-] [+] |  | |
|  | +------------------------------+  | |
|  | ( £500 ) ( £2,000 ) ( £5,000 )    | |
|  | --------------------------------  | |
|  | You pay                £2,000.00  | |
|  | From the team's payment:          | |
|  | Projective fee (5%)     -£100.00  | |
|  | The team receives      £1,900.00  | |
|  | --------------------------------  | |
|  | Example only · the fee is read    | |
|  | live                              | |
|  '-----------------------------------' |
|                                        |
+- band ends ----------------------------+
|                                        |
|  FAQ  #faq                             | (23)
|  Common questions.                     |
|                                        |
|  Is my money safe? (How escrow      -  |
|  works)                                |
|  Projective uses payment protection    |
|  (escrow). ...                         |
|  ------------------------------------  |
|  Who pays the 5% fee?               +  |
|  ------------------------------------  |
|  What if the work stops halfway?    +  |
|  ------------------------------------  |
|  When does the team get paid?       +  |
|  ------------------------------------  |
|  Where do refunds go?               +  |
|  ------------------------------------  |
|  Do I need to show ID to hire?      +  |
|  ------------------------------------  |
|  How do ready-made teams work?      +  |
|  ------------------------------------  |
|  What if a live session doesn't     +  |
|  happen?                               |
|  ------------------------------------  |
|  More answers in Help ->               |
|                                        |
|            Find your team.             | (24)
|                                        |
| +------------------------------------+ |
| | [#v] | Search teams, servi  [[>]]  | |
| +------------------------------------+ |
|  [           Hire a team            ]  |
|          Offer your skills ->          |
|                                        |
+- PublicFooter (existing) --------------+
|  (P) Projective                        | (25)
|  <tagline>                             |
|  [in] [x] [dr] [gh]                    |
|  ------------------------------------  |
|  For helpers                        +  |
|  For clients                        +  |
|  Explore & learn                    +  |
|  ------------------------------------  |
|  Stay updated                          |
|  [ newsletter form, existing island ]  |
|  ------------------------------------  |
|  © 2026 Projective                     |
|  Privacy · Terms · Help                |
+----------------------------------------+
```

19. **For freelancers and teams** (voice P) — rows rest on `fn_team_split_plan`, the 7-day window,
    capacity and the stored IP mode (§5). Never "your work stays yours" (#281).
20. **Static split strip** — one still frame of V5's fixture (even split, 10% vault), labelled
    "Example". It does not animate.
21. **Pricing** (voice E) — "5%" is formatted from `platform_fee_bp` through the service, never
    hard-coded; with no fee value every fee clause drops and the calculator hides. No
    card-processing line: nothing passes processing fees through today (#281 flag).
22. **Calculator** (`PricingCalculator.island`) — NumberInput with a £ prefix and steppers, three
    quick picks; outputs `tabular-nums` in a polite live region, recomputed instantly. The fee is
    `platformFeeFor()` (truncates like SQL), unit-tested against `fn_escrow_fee_bp` examples. With
    no JS the server renders the £2,000 worked example as text and the input appears on hydration
    (gate 11). Below `--bp-md` the panel stacks.
23. **FAQ** — native `<details>`, no island; the FAQPage JSON-LD carries the same text, "escrow"
    included. The first item may be open by default.
24. **Final CTA** — a second HeroSearch instance (id suffix `-final`), static placeholder, no
    typewriter, no `/` hint, no chips; the same two CTAs.
25. **PublicFooter** — reused unchanged (Decision #13). Its `lp-footer*` classes collide with the
    namespace (#280 flag a) and its copy with the vocabulary (#283 flag).

**375 overlays and variants**

```text
+- category sheet · tap [#v] ------------+
| page behind: scrim + blur on ::before  |
|                                        |
| +------------------------------------+ |
| |              ----                  | |
| | Search in                      [x] | |
| |                                    | |
| | (o) All                            | |
| | ( ) Freelancers & teams            | |
| | ( ) Services                       | |
| | ( ) Projects                       | |
| | ( ) Businesses                     | |
| +------------------------------------+ |
+----------------------------------------+
```

```text
+- suggestions open · typing "brand" ----+
| +------------------------------------+ |
| | [#v] | brand|               [[>]]  | |
| +------------------------------------+ |
| | PEOPLE & TEAMS                     | |
| | (o) <Team name>   · Team           | |
| | (o) <Person name> · Freelancer     | |
| | SERVICES                           | |
| | [=] <Service title>                | |
| | PROJECTS                           | |
| | [=] <Project title>                | |
| | ---------------------------------- | |
| | Search Explore for "brand" ->      | |
| +------------------------------------+ |
|  overlays chips + CTAs; max-height =   |
|  visual viewport above the keyboard    |
+----------------------------------------+
```

```text
+- menu sheet · tap [=] -----------------+
| +------------------------------------+ |
| | (P) Projective                 [x] | |
| |                                    | |
| | How it works                       | |
| | Explore                            | |
| | Pricing                            | |
| | Features                           | |
| | ---------------------------------- | |
| | Theme                 [*] System   | |
| | [ Sign in ]   [[ Get started ]]    | |
| +------------------------------------+ |
|                                        |
|  signed in: the pill reads             |
| +------------------------------------+ |
| | (P) Projective    [ Open app ] [=] | |
| +------------------------------------+ |
+----------------------------------------+
```

```text
+- demo stage · reduced motion ----------+
| +------------------------------------+ |
| | STEP 1 OF 6                        | |
| | "Homepage design" waits in Ready.  | |
| | Its tag says Draft.                | |
| |                                    | |
| | [ static frame: the board with     | |
| |   Homepage design in Ready ]       | |
| +------------------------------------+ |
|  [ Previous step ]   [ Next step ]     |
|  Same states as the live demo, as a    |
|  labelled sequence. No autoplay.       |
+----------------------------------------+
```

- **Category sheet** — a bottom sheet from the overlay family (Decision #171), styled `lp-`; glass
  is allowed (a floating mobile sheet). A radio group: choosing closes the sheet, updates the [#v]
  glyph and returns focus to the input. Values follow L2 minus `products`: `all`, `freelancers`,
  `services`, `projects`, `businesses` (the mismatch with `SEARCH_SCOPES` is a #284 flag).
  **Products** stays out of the picker and the suggestions until digital-product delivery ships (W2;
  #281 flag k).
- **Suggestions** — `role="combobox"` with `aria-activedescendant`, rows grouped by kind (a wrapper
  over the headless `suggest-controller`; the existing `SearchSuggest` sections are not grouped by
  entity). Enter submits, Esc closes; recent searches when empty; "No matches — search anyway";
  200ms debounce, superseded requests aborted.
- **Menu sheet** — a top sheet: the four links, the theme control, "Sign in" (tonal) and "Get
  started" (the one fill). Closes on Esc, a link or the scrim. "Features" is hidden until L5 ships.
- **Signed in** — "Open app" (tonal) replaces "Sign in" and "Get started"; never a redirect.
- **Reduced motion** — every demo becomes a labelled frame sequence with Previous/Next; the board
  mock is its poster; the typewriter shows the static placeholder; the background is the static SVG;
  nothing reveals on scroll.

### 2.2 `/` at 768 (tablet)

**Hero to How it works** · 1 char ≈ 12px · 31px gutter

```text
+- / · 768 · guest · dark ---------------------------------------+
|                                                                |
| +------------------------------------------------------------+ |
| | (P)  How it works  Pricing  Features   [*] Sign in [Start] | | (1)
| +------------------------------------------------------------+ |
|                                                                |
|             READY-MADE TEAMS · PAYMENT PROTECTION              | (2)
|                                                                |
|        Hire a ready-made team. Pay one stage at a time.        | (3)
|                                                                |
|      Search for a team that's already formed. Work starts      |
|    only once it's paid for. They're paid when you approve.     |
|                                                                |
|     +----------------------------------------------------+     |
|     | All v | Try "landing page"       [/]  [[ Search ]] |     | (4) ~2~
|     +----------------------------------------------------+     |
|     Try ( brand identity ) ( landing page ) ( design.:         | (5)
|                                                                |
|            [ Hire a team ]     Offer your skills ->            | (6)
|                                                                |
|         .--------------------------------------------.         | (7) ~2~
|        / WORK BOARD · Website refresh                 \        |
|       /   New             Ready           In Progress  \       |
|      /    .---------.     .---------.     .---------.   \      |
|     /     |Launch   |     |Logo v2  |     |Homepage | .: \     |
|    /      |emails   |     |£400     |     |£2,000   | .:  \    |
|   /       |Draft    |     |Needs    |     |Funded   | .:   \   |
|  /        '---------'     |funding  |     '---------' .:    \  |
|======================== fold @ 1024px =========================|
| /                         '---------'                        \ |
| /         ~2~ approve -> team paid -> the task moves on      \ |
|:      . . . fades into the page (mask-image) . . .            :|
|   [ Pause the example ]                    Try it yourself ->  |
|                                                                |
|   WHY IT'S DIFFERENT                                           | (8)
|   One team, not five strangers.                                |
|                                                                |
|                   THE OLD WAY           WITH PROJECTIVE        |
|   -----------------------------------------------------------  |
|   WHO YOU HIRE    Five freelancers,     One ready-made team.   |
|                   hired one by one      They apply, work and   |
|                                         get paid together      |
|   -----------------------------------------------------------  |
|   HOW IT'S        Open-ended hourly     A fixed price, agreed  |
|   PRICED          billing               before work starts     |
|   -----------------------------------------------------------  |
|   WHEN MONEY      Pay up front for      Pay one stage at a     |
|   MOVES           the whole job         time                   |
|   -----------------------------------------------------------  |
|   KEEPING TRACK   Chase updates across  Every task on one      |
|                   email and chat        board                  |
|   -----------------------------------------------------------  |
|   TEAM PAY        Work out who gets     Splits automatically   |
|                   what by hand          into agreed shares     |
|   -----------------------------------------------------------  |
|                                                                |
|   HOW IT WORKS  #how-it-works                                  | (9)
|   From search to payday in six steps.                          |
|                                                                |
|   [ill 160x96]       [ill 160x96]        [ill 160x96]          |
|   01  Find your team 02  Pay the stage   03  Team works        |
|   Search, or post    Your money is       Each task moves       |
|   your project.      held safely.        across the board.     |
|                                                                |
|   [ill 160x96]       [ill 160x96]        [ill 160x96]          |
|   04  You review     05  Approve & pay   06  Withdraw          |
|   Not quite right?   The team is paid,   Their money clears    |
|   Ask for changes.   minus the 5% fee.   in 7 days.            |
|                                                                |
+----------------------------------------------------------------+
```

What changes from 375:

1. **Pill** — from `--bp-md`: "How it works · Pricing · Features"; "Explore" joins at `--bp-lg`
   (below that the hero already is the search; until L2 renders that search, Explore shows from
   `--bp-md`, #286 (B)). Right: theme [*], "Sign in", "Get started" (the pill's one fill). No menu
   button.
2. **Search** — the inline picker returns: a native `<select>` that reads "All v", named "Search in"
   (it announces its own value), which is also the no-JavaScript picker and needs no portal (#287;
   L0 drew a labelled button opening an anchored, portalled listbox). The "/ to search" hint shows
   for `pointer: fine` once the key is bound. ~640px wide.
3. **Chips** still scroll below `--bp-lg`.
4. **CTAs** sit inline, centred.
5. **Board mock** from `--bp-md` — tilted (`--lp-stage-tilt`), three lanes plus a fade. The V1 loop
   plays as `~2~`, alternating with the typewriter on one hero timeline (§2.7); paused when < 50%
   visible or the tab is hidden — a turn it misses is owed and plays once it is visible (#287); the
   static poster under reduced motion or Save-Data. `role="img"` with a label describing the loop,
   inside `inert`; "Try it yourself" → `/?demo=board#demo` once L3 renders `#demo` (until then the
   theatre has no link, #287). A visible **Pause the example** toggle (`aria-pressed`, outside the
   inert figure) sits beside it and stops both the typewriter and the board loop (WCAG 2.2.2, §2.7).
6. **Why** becomes a three-column table (label · old way · Projective), hairline rows.
7. **How it works** becomes a 3×2 grid with `placehold.co` art (§8).

**Demo stage to Real numbers**

```text
+- / · 768 · continued ------------------------------------------+
|                                                                |
|   SEE IT WORK  #demo                                           | (10)
|   See a project run, step by step.                             |
|   Example only. No real money moves.                           |
|                                                                |
|   [ Work board ]  Payment protection  Booking  Team pay        | (11)
|                                                                |
|   +---------------------------------------------------------+  |
|   | New          Ready         In Progress   Review      .: |  | (12) ~1~
|   | .----------. .----------.  .----------.  .----------..: |  |
|   | |Launch    | |Homepage  |  |Logo v2   |  |Case      |.: |  |
|   | |emails    | |design    |  |£400      |  |study     |.: |  |
|   | |Draft [..]| |£2,000    |  |Funded  ..|  |£250      |.: |  |
|   | '----------' |Needs     |  '----------'  |[Approve] |.: |  |
|   |              |funding   |                '----------'.: |  |
|   |              |[ Pay ]   |                            .: |  |
|   |              '----------'                            .: |  |
|   | refused drag: shake + "Needs funding. Pay for this      |  |
|   | stage before work starts."                              |  |
|   | aspect-ratio 4 / 3, reserved                            |  |
|   +---------------------------------------------------------+  |
|   Work only starts once it's paid for.   [ Start again ]       | (13)
|                               See everything Projective does ->|
|                                                                |
|   WAYS TO WORK  #ways-to-work                                  | (14)
|   Work the way you want.                                       |
|                                                                |
|   +----------------+ +------------------+ +-----------------+  |
|   | A single job   | | An ongoing       | | A live session  |  |
|   |                | | workflow         | |                 |  |
|   | Milestones,    | | Task by task,    | | One session, a  |  |
|   | each paid for  | | each paid for    | | block, or a     |  |
|   | as it starts.  | | when picked up.  | | seat in a group.|  |
|   |                | |                  | |                 |  |
|   | Post a single  | | Browse ongoing   | | Browse live     |  |
|   | job ->         | | work ->          | | sessions ->     |  |
|   +----------------+ +------------------+ +-----------------+  |
|                                                                |
|   Popular services                          See all services ->| (15)
|   .-----------------.  .------------------.  .---------------.:|
|   | [cover 16:9]    |  | [cover 16:9]     |  | [cover        .:|
|   | <Service title> |  | <Service title>  |  | <Servi        .:|
|   | by <owner>      |  | by <owner>       |  | by <ow        .:|
|   | from £###       |  | from £###        |  | from          .:|
|   '-----------------'  '------------------'  '---------------.:|
|   Open projects · Ready-made teams · Freelancers (same shape)  |
|                                                                |
+- band · voice E · solid --lp-warm-bg --------------------------+
|                                                                |
|   PAYMENT PROTECTION  #payment-protection                      | (16)
|   Money held safely, stage by stage.                           |
|                                                                |
|   This is payment protection (escrow): when you pay for a      |
|   stage, the money is held safely before any work starts.      |
|                                                                |
|   HELD BEFORE WORK STARTS       PAID WHEN YOU APPROVE          |
|   Until then, the task can't    The team is paid when you      |
|   move into work.               accept their work.             |
|                                                                |
|   A FAIR WAY OUT                MISSED SESSIONS                |
|   If work stops, end the stage  Report a no-show, and a        |
|   with Fair Exit.               Projective reviewer decides.   |
|                                                                |
|   (+ 4 more points in two columns, §4.6)                       |
|                                                                |
|   .---------------------------------------------------------.  | (17)
|   | You ---pay---> Held safely ---approve---> Team paid     |  |
|   |                                           (minus 5% fee)|  |
|   |                              clears in 7 days  |        |  |
|   |                                                v        |  |
|   |                                       Ready to withdraw |  |
|   '---------------------------------------------------------'  |
|   Get help with payments ->                                    |
|   Read the payment protection terms ->                         |
|                                                                |
|   THE NUMBERS SO FAR  #numbers                                 | (18)
|   Counted from real payments on Projective, as of 17 Oct 2026. |
|                                                                |
|   £#,###,###        |  #,###             |  ## hours           |
|   Money protected   |  Stages delivered  |  Half of approved   |
|   so far            |                    |  stages were        |
|                     |                    |  approved within    |
|                     |                    |  this time of being |
|                     |                    |  paid for.          |
|                                                                |
+- band ends ----------------------------------------------------+
```

11. **Tabs** fit on one row from `--bp-md`; "See everything" moves under the viewport,
    right-aligned.
12. **Viewport** 4/3; the real kanban scrolls sideways inside it (five lanes, ~3.5 visible, fade).
    Drag for `pointer: fine`; the demo's "Move to…" menu stays on every card.
13. **Tiles** in a row of three.
14. **Rails** show ~2.6 cards; no prev/next on touch.
15. **The eight points** sit in two columns.
16. **Diagram** runs horizontally.
17. **Figures** in a row of three with hairline dividers; a hidden figure collapses its column (grid
    auto-fit), never a gap.

**For freelancers and teams to footer**

```text
+- / · 768 · continued ------------------------------------------+
|                                                                |
|   FOR FREELANCERS AND TEAMS                                    | (19)
|   Earn together. Get paid together.                            |
|                                                                |
|   PAY THAT SPLITS ITSELF        .---------------------------.  | (20)
|   The team's payment splits     | EXAMPLE · a £2,000 stage  |  |
|   into each agreed share.       | [#########|######|#####|#]|  |
|                                 | Owner £570.11             |  |
|   CLEARS IN 7 DAYS              | Designer £569.94          |  |
|   Then each member can          | Developer £569.94         |  |
|   withdraw it.                  | Team vault £190.01        |  |
|                                 '---------------------------'  |
|   AGREE WHO OWNS THE WORK                                      |
|   Every project states up front who owns the finished work.    |
|                                                                |
|   [[ Offer your skills ]]     Find open projects ->            |
|                                                                |
+- band · voice E · solid --lp-warm-bg --------------------------+
|                                                                |
|   PRICING  #pricing                                            | (21)
|   A 5% fee. You pay the price you see.                         |
|                                                                |
|   The fee comes out of the team's payment when it's paid out.  |
|   You pay the stage price, with nothing on top.                |
|                                                                |
|   .---------------------------------------------------------.  | (22)
|   | Stage price                    You pay        £2,000.00 |  |
|   | +-----------------------+      From the team's payment: |  |
|   | | £ | 2,000     [-] [+] |      Projective fee  -£100.00 |  |
|   | +-----------------------+      ------------------------ |  |
|   | ( £500 ) ( £2,000 ) ( £5,000 ) Team receives  £1,900.00 |  |
|   |                                Example · fee read live  |  |
|   '---------------------------------------------------------'  |
|                                                                |
+- band ends ----------------------------------------------------+
|                                                                |
|   FAQ  #faq                                                    | (23)
|   Common questions.                                            |
|                                                                |
|   Is my money safe? (How escrow works)                     -   |
|   Projective uses payment protection (escrow). When you pay    |
|   for a stage, the money is held safely ...                    |
|   -----------------------------------------------------------  |
|   Who pays the 5% fee?                                     +   |
|   -----------------------------------------------------------  |
|   What if the work stops halfway?                          +   |
|   -----------------------------------------------------------  |
|   (5 more rows · 8 in all)                                 +   |
|   -----------------------------------------------------------  |
|   More answers in Help ->                                      |
|                                                                |
|                         Find your team.                        | (24)
|                                                                |
|     +----------------------------------------------------+     |
|     | All v | Search teams, services and…   [[ Search ]] |     |
|     +----------------------------------------------------+     |
|            [ Hire a team ]     Offer your skills ->            |
|                                                                |
+- PublicFooter (existing) --------------------------------------+
|   (P) Projective      For helpers         For clients          | (25)
|   <tagline>           <links>             <links>              |
|   [in] [x] [dr] [gh]                                           |
|                       Explore & learn     Stay updated         |
|                       <links>             [ newsletter form ]  |
|   -----------------------------------------------------------  |
|   © 2026 Projective                   Privacy · Terms · Help   |
+----------------------------------------------------------------+
```

20. **Split strip** beside the copy from `--bp-md`.
21. **Calculator** — input and quick picks left, results right; the quick picks wrap under the
    input.
22. **Final CTA** — inline picker, static placeholder, no `/` hint (only the hero instance takes the
    shortcut, #282).

### 2.3 `/` at 1280 (desktop)

**Hero to How it works** · 1 char ≈ 13.6px · container `--lp-maxw` (76rem)

```text
+- / · 1280 x 800 · guest · dark ------------------------------------------------------------+
|         . . .   B7 grid · B10 grain · spotlight · B1 constellation   ~1~   . . .           |
|    +----------------------------------------------------------------------------------+    |
|    | (P) Projective   How it works  Explore  Pricing  Features   [*] Sign in [Start]  |    | (1)
|    +----------------------------------------------------------------------------------+    |
|                                                                                            |
|                           READY-MADE TEAMS · PAYMENT PROTECTION                            | (2)
|                                                                                            |
|                                  Hire a ready-made team.                                   | (3)
|                                  Pay one stage at a time.                                  |
|                                                                                            |
|               Search for a team that's already formed. Work starts only once               |
|                       it's paid for. They're paid when you approve.                        |
|                                                                                            |
|                 +--------------------------------------------------------+                 |
|                 | All v | Try "design system"          [/]  [[ Search ]] |  ~2~            | (4)
|                 +--------------------------------------------------------+                 |
|                 Try  ( brand identity ) ( landing page ) ( design system )                 | (5)
|                                                                                            |
|                          [ Hire a team ]     Offer your skills ->                          | (6)
|                                                                                            |
|           .--------------------------------------------------------------------.  ~2~      | (7)
|          /  WORK BOARD · Website refresh              1 task needs £400 to start \         |
|         /      New           Ready         In Progress   Review        Completed \         |
|        /       .---------.   .---------.   .---------.   .---------.   .---------.\        |
|======================================= fold @ 800px =======================================|
|       /        |Launch   |   |Logo v2  |   |Homepage |   |Case     |   |Brand    | \       |
|      /         |emails   |   |£400     |   |design   |   |study    |   |colours  |  \      |
|     /          |Draft    |   |Needs    |   |£2,000   |   |£250     |   |£300     |   \     |
|    /           '---------'   |funding  |   |Funded   |   |[Approve]|   |Team paid|    \    |
|   /                          '---------'   '---------'   '---------'   '---------'     \   |
|  :   ~2~ loop: approve Case study -> Team paid -> it moves to its next stage, funded    :  |
|  :        . . . . . . . bottom edge fades into the page (mask-image) . . . . . . .      :  |
|    [ Pause the example ]                                             Try it yourself ->    |
|                                                                                            |
|    WHY IT'S DIFFERENT                                                           voice P    | (8)
|    One team, not five strangers.                                                           |
|    Team-as-a-service, made simple.                                                         |
|                                                                                            |
|                         THE OLD WAY                     WITH PROJECTIVE                    |
|    -------------------------------------------------------------------------------------   |
|    WHO YOU HIRE         Five freelancers, hired one     One ready-made team. They apply,   |
|                         by one                          work and get paid together         |
|    -------------------------------------------------------------------------------------   |
|    HOW IT'S PRICED      Open-ended hourly billing       A fixed price, agreed before       |
|                                                         work starts                        |
|    -------------------------------------------------------------------------------------   |
|    WHEN MONEY MOVES     Pay up front for the whole job  Pay one stage at a time. The team  |
|                                                         is paid when you approve it.       |
|    -------------------------------------------------------------------------------------   |
|    KEEPING TRACK        Chase updates across email      See every task on one board, from  |
|                         and chat                        New to Completed                   |
|    -------------------------------------------------------------------------------------   |
|    TEAM PAY             Work out who gets what by hand  Team pay splits automatically into |
|                                                         each agreed share                  |
|    -------------------------------------------------------------------------------------   |
|                                                                                            |
|    HOW IT WORKS  #how-it-works                                                  voice P    | (9)
|    From search to payday in six steps.                                                     |
|                                                                                            |
|    01 o--------- 02 o--------- 03 o--------- 04 o--------- 05 o--------- 06 o              |
|    [ill 120x80]  [ill 120x80]  [ill 120x80]  [ill 120x80]  [ill 120x80]  [ill 120x80]      |
|    Find your     Pay for the   The team      Review the    Approve and   The team          |
|    team          first stage   gets to work  work          pay           withdraws         |
|    Search, or    Your money is Each task     Not quite     The team is   Their money       |
|    post your     held safely.  moves across  right? Ask    paid, minus   clears in 7       |
|    project.                    the board.    for changes.  the 5% fee.   days.             |
|                                                                                            |
+--------------------------------------------------------------------------------------------+
```

1. **Full pill** — the four links truly centred on three equal `minmax(0,1fr)` tracks. How it works
   → `#how-it-works`, Explore → `/explore`, Pricing → `#pricing`, Features → `/features` (on
   `/features` the anchors become `/#…`). Right: theme [*], "Sign in", "Get started" (shown as
   [Start] for space). Transparent at the top, glass on `::before` once scrolled (48px, like
   SiteHeader). The glass is the default: the pill sheds it only once hydrated and once the
   background has measured its quiet zones, whose copy zones include the pill's band, so its text
   never sits on a full-alpha node (§3.3 "transparent pill" row).
2. **h1** at display size on two lines; the LCP element.
3. **Search** ~760px, inline picker, `/` hint, B9 glow. The typewriter alternates with the board
   loop (§2.7).
4. **Chips** sit in one centred row from `--bp-lg` (3–5), never wrapped; a row that does not fit
   scrolls sideways, faded at both ends, rather than cut a chip in half (#287).
5. **Product theatre** — tilted (`--lp-stage-tilt`), all five lanes; ~30% above the fold; bottom
   masked into the page. `role="img"`, `inert` inside. The loop shows Chain Reaction as the product
   does it (#210): approving "Case study" pays the team and moves **the same task** to its next
   stage, funded from the wallet — never "the next card". The header line mirrors the app's "{n}
   tickets need {total} to start" in landing words. Pauses below 50% visibility and when the tab is
   hidden; a board turn it misses is owed and plays once at least half of it is visible (#287), so a
   visitor who scrolls to it still sees the loop. "Try it yourself" → `/?demo=board#demo` once L3
   renders `#demo`; the **Pause the example** toggle sits at the theatre's leading edge (§2.2 note
   5).
6. **Why** — one shared three-column grid; the H2 subtitle is the only place "team-as-a-service" may
   appear (#283).
7. **How it works** — one six-step row on a hairline spine, `placehold.co/120x80` art; reveals once
   when motion is allowed.

**Demo stage to Real numbers**

```text
+- / · 1280 · continued ---------------------------------------------------------------------+
|                                                                                            |
|    SEE IT WORK  #demo                                                           voice P    | (10)
|    See a project run, step by step. Example only. No real money moves.                     |
|                                                                                            |
|    [ Work board ]  Payment protection  Booking  Team pay  See everything Projective does ->|
|    +-----------------------------------------------------------------------------------+   |
|    | New             Ready           In Progress     Review          Completed         |   | (12)
|    | .------------.  .------------.  .------------.  .------------.  .------------.    |   |
|    | |Launch      |  |Homepage    |  |Logo v2     |  |Case study  |  |Brand       |    |   |
|    | |emails      |  |design      |  |£400        |  |£250        |  |colours     |    |   |
|    | |Draft   [..]|  |£2,000      |  |Funded  [..]|  |[ Approve ] |  |£300        |    |   |
|    | '------------'  |Needs       |  '------------'  '------------'  |Team paid   |    |   |
|    |                 |funding     |                                  '------------'    |   |
|    |                 |[ Pay ] [..]|                                                    |   |
|    |                 '------------'                                                    |   |
|    |             +--------------------------------------------------------+            |   |
|    |             | Needs funding. Pay for this stage before work starts.  |            |   |
|    |             +--------------------------------------------------------+            |   |
|    | refused drop: over-damped shake (no bounce) + live-region message  ~1~            |   |
|    | aspect-ratio 16 / 9, reserved                                                     |   |
|    +-----------------------------------------------------------------------------------+   |
|    Work only starts once it's paid for. Approve, and it moves on.        [ Start again ]   | (13)
|                                                                                            |
|    WAYS TO WORK  #ways-to-work                                                  voice P    | (14)
|    Work the way you want.                                                                  |
|    Pick a single job, an ongoing workflow or a live session.                               |
|                                                                                            |
|    +-------------------------+ +--------------------------+ +--------------------------+   |
|    | [ill 96x96]             | | [ill 96x96]              | | [ill 96x96]              |   |
|    | A single job            | | An ongoing workflow      | | A live session           |   |
|    | One clear piece of work,| | Ongoing work, task by    | | Book time with an expert:|   |
|    | delivered in milestones.| | task, across several     | | one session, a block, or |   |
|    | Each milestone is paid  | | stages.                  | | a seat in a group.       |   |
|    | for as it starts.       | |                          | |                          |   |
|    | Post a single job ->    | | Browse ongoing work ->   | | Browse live sessions ->  |   |
|    +-------------------------+ +--------------------------+ +--------------------------+   |
|    Need just one thing done? Start with a single task: one deliverable, one price.         |
|                                                                                            |
|    Popular services                                         <|  |>   See all services ->   | (15)
|    .-----------------.  .-----------------.  .-----------------.  .-----------------.  .:  |
|    | [cover 16:9]    |  | [cover 16:9]    |  | [cover 16:9]    |  | [cover 16:9]    |  .:  |
|    |                 |  |                 |  |                 |  |                 |  .:  |
|    | <Service title> |  | <Service title> |  | <Service title> |  | <Service title> |  .:  |
|    | by <owner>      |  | by <owner>      |  | by <owner>      |  | by <owner>      |  .:  |
|    | from £###       |  | from £###       |  | from £###       |  | from £###       |  .:  |
|    '-----------------'  '-----------------'  '-----------------'  '-----------------'  .:  |
|    Open projects · Ready-made teams · Freelancers  (same rail shape; each hidden < 4)      |
|                                                                                            |
+- band · voice E · solid --lp-warm-bg · serif display h2 -----------------------------------+
|                                                                                            |
|    PAYMENT PROTECTION  #payment-protection                                      voice E    | (16)
|    Money held safely,                                                                      |
|    stage by stage.                              .--------------------------------------.   | (17)
|                                                 |                                      |   |
|    This is payment protection (escrow): when    |  You                                 |   |
|    you pay for a stage, the money is held       |   |  pay for the stage               |   |
|    safely before any work starts.               |   v                                  |   |
|                                                 |  Held safely                         |   |
|    HELD BEFORE WORK STARTS                      |   |  you approve                     |   |
|    Work only starts once the stage is paid      |   v                                  |   |
|    for. Until then, the task can't move into    |  Team paid, minus the 5% fee         |   |
|    work.                                        |   |  clears in 7 days                |   |
|    -----------------------------------------    |   v                                  |   |
|    PAID WHEN YOU APPROVE                        |  Ready to withdraw                   |   |
|    The team is paid when you accept their       |                                      |   |
|    work or approve the stage.                   |  - - - - - - - - - - - - - - - - -   |   |
|    -----------------------------------------    |  Fair Exit at 50% on £2,000: the     |   |
|    A FAIR WAY OUT                               |  team gets £950, you get £1,000      |   |
|    If work stops, end the stage with Fair       |  back, fee-free                      |   |
|    Exit. You pick 25%, 50% or 75% done.         '--------------------------------------'   |
|    -----------------------------------------                                               |
|    MISSED SESSIONS · CHECKED BEFORE THEY TAKE ON PROJECT WORK · CLEARS IN 7 DAYS ·         |
|    REFUNDS WITHOUT FEES · EVERY PENNY ON RECORD  (same shape, §4.6)                        |
|                                                                                            |
|    Get help with payments ->    Read the payment protection terms ->                       |
|                                                                                            |
|    THE NUMBERS SO FAR  #numbers                                                 voice E    | (18)
|    Counted from real payments on Projective, as of 17 Oct 2026.                            |
|                                                                                            |
|    £#,###,###                 |  #,###                     |  ## hours                     |
|    Money protected so far     |  Stages delivered          |  Half of approved stages were |
|                               |                            |  approved within this time    |
|                               |                            |  of being paid for.           |
|                                                                                            |
+- band ends --------------------------------------------------------------------------------+
```

11. **Tabs** left, "See everything Projective does" right on the same row; a `?demo=` deep link
    opens the right tab in the server render.
12. **Viewport** 16/9 at the container width; all five lanes visible; drag is the main input; the
    refusal toast sits inside the viewport, never over the page.
13. **Tiles** — three equal cards: "Post a single job" → `/projects?create=1`, the other two to a
    `model=` facet (§2.1 note 14).
14. **Rails** — four cards and a peek, <| |> for `pointer: fine`; each scroller supports scroll-snap
    and the keyboard, `aria-roledescription="carousel"`.
15. **Text** capped at `--lp-measure`; the diagram column is a static SVG.
16. **The Fair Exit line** is static and its figures mirror `fn_fair_exit_split` (fee on the earned
    share only); the interactive version lives in V2 and on `/features`.

**For freelancers and teams to footer**

```text
+- / · 1280 · continued ---------------------------------------------------------------------+
|                                                                                            |
|    FOR FREELANCERS AND TEAMS                                                    voice P    | (19)
|    Earn together. Get paid together.                                                       |
|    Join a team or start one. Apply for work as one unit.                                   |
|                                                                                            |
|    PAY THAT SPLITS ITSELF                       .--------------------------------------.   | (20)
|    When a stage is approved, the team's         | EXAMPLE · a £2,000 stage             |   |
|    payment splits into each agreed share.       |                                      |   |
|    -----------------------------------------    | [###########|#########|#########|##] |   |
|    SEE EACH SHARE FIRST · EVERY PENNY ADDS UP   | Owner £570.11    Designer £569.94    |   |
|    -----------------------------------------    | Developer £569.94  Team vault £190.01|   |
|    CLEARS IN 7 DAYS · WORKLOAD LIMITS           |                                      |   |
|    -----------------------------------------    | a still frame of the Team pay demo   |   |
|    AGREE WHO OWNS THE WORK · FREE TO SPLIT ·    '--------------------------------------'   |
|    VERIFIED BY STRIPE  (rows per §4.8)                                                     |
|                                                                                            |
|    Buying, selling and joining teams unlock at 18.                                         |
|    [[ Offer your skills ]]     Find open projects ->                                       |
|                                                                                            |
+- band · voice E · solid --lp-warm-bg ------------------------------------------------------+
|                                                                                            |
|    PRICING  #pricing                                                            voice E    | (21)
|    A 5% fee.                                  .----------------------------------------.   | (22)
|    You pay the price you see.                 | Stage price                            |   |
|                                               | +-----------------------------------+  |   |
|    The fee comes out of the team's payment    | | £ | 2,000                 [-] [+] |  |   |
|    when it's paid out. You pay the stage      | +-----------------------------------+  |   |
|    price, with nothing on top.                | ( £500 )  ( £2,000 )  ( £5,000 )       |   |
|    There's no fee on refunds.                 | -------------------------------------  |   |
|                                               | You pay                     £2,000.00  |   |
|    On a £10.50 stage, the fee is 52p and      | From the team's payment:               |   |
|    the team receives £9.98.                   | Projective fee (5%)          -£100.00  |   |
|                                               | The team receives           £1,900.00  |   |
|                                               | -------------------------------------  |   |
|                                               | Clears in 7 days, then they can        |   |
|                                               | withdraw it. Example only.             |   |
|                                               '----------------------------------------'   |
|                                                                                            |
+- band ends --------------------------------------------------------------------------------+
|                                                                                            |
|    FAQ  #faq                                                                    voice P    | (23)
|    Common                       Is my money safe? (How escrow works)                  -    |
|    questions.                   Projective uses payment protection (escrow). When you pay  |
|                                 for a stage, the money is held safely ...                  |
|    More answers in Help ->      -------------------------------------------------------    |
|                                 Who pays the 5% fee?                                  +    |
|                                 -------------------------------------------------------    |
|                                 What if the work stops halfway?                       +    |
|                                 -------------------------------------------------------    |
|                                 When does the team get paid?                          +    |
|                                 -------------------------------------------------------    |
|                                 Where do refunds go?                                  +    |
|                                 -------------------------------------------------------    |
|                                 Do I need to show ID to hire?                         +    |
|                                 -------------------------------------------------------    |
|                                 How do ready-made teams work?                         +    |
|                                 -------------------------------------------------------    |
|                                 What if a live session doesn't happen?                +    |
|                                                                                            |
|                                      Find your team.                                       | (24)
|                                                                                            |
|                 +--------------------------------------------------------+                 |
|                 | All v | Search teams, services and pro…   [[ Search ]] |                 |
|                 +--------------------------------------------------------+                 |
|                          [ Hire a team ]     Offer your skills ->                          |
|                                                                                            |
+- PublicFooter (existing, unchanged) -------------------------------------------------------+
|    (P) Projective           For helpers       For clients       Explore & learn            | (25)
|    <tagline>                <4 links>         <4 links>         <5 links>                  |
|    [in] [x] [dr] [gh]                                                                      |
|                                                                                            |
|    Stay updated   [ newsletter form, existing island ]          Get set up                 |
|                                                                 <5 links>                  |
|    -------------------------------------------------------------------------------------   |
|    © 2026 Projective. All rights reserved.                      Privacy · Terms · Help     |
+--------------------------------------------------------------------------------------------+
```

19. **For freelancers** — copy left, still frame right; "Offer your skills" is this region's one
    filled primary.
20. **The calculator panel** is the one raised object in the pricing band; the results column is
    right-aligned `tabular-nums`.
21. **FAQ** — h2 in a narrow left column, the `<details>` list right; answers at `--lp-measure`.
22. **Final CTA** — the B7 spotlight over the grid reacts to the pointer (`~1~`); the B9 glow stays
    static until focus.

**1280 variants and the demo tabs**

```text
+- header pill · signed-in visitor at / (shown the page, never redirected) ------------------+
|       +----------------------------------------------------------------------------+       |
|       | (P) Projective   How it works  Explore  Pricing  Features [*] [ Open app ] |       |
|       +----------------------------------------------------------------------------+       |
+--------------------------------------------------------------------------------------------+
```

```text
+- hero · suggestions open (typing "brand") -------------------------------------------------+
|                 +--------------------------------------------------------+                 |
|                 | All v | brand|                       [/]  [[ Search ]] |                 |
|                 +--------------------------------------------------------+                 |
|                 | PEOPLE & TEAMS                                         |                 |
|                 | > (o) <Team name>             Team                     |                 |
|                 |   (o) <Person name>           Freelancer               |                 |
|                 | SERVICES                                               |                 |
|                 |   [=] <Service title>         <owner>                  |                 |
|                 | PROJECTS                                               |                 |
|                 |   [=] <Project title>         <owner>                  |                 |
|                 | ------------------------------------------------------ |                 |
|                 | Search Explore for "brand" ->                   Enter  |                 |
|                 +--------------------------------------------------------+                 |
|                 overlays chips, CTAs and the board mock; nothing below moves               |
+--------------------------------------------------------------------------------------------+
```

```text
+- demo viewport · ?demo=payments (V2 Payment protection) · 16:9 ----------------------------+
|    +-----------------------------------------------------------------------------------+   |
|    | A £5,000 project in 3 stages      Try Fair Exit: [ off ]  ( 25% ) ( 50% ) ( 75% ) |   |
|    |                                                                                   |   |
|    |    Stage 1 · £1,500          Stage 2 · £2,000           Stage 3 · £1,500          |   |
|    |    Team paid                 Funded                     Needs funding             |   |
|    |                                                                                   |   |
|    |    Held safely -- You approve -- Team paid -- Clears in 7 days -- Withdraw        |   |
|    |    o==============o==============o-------------------o-----------o                |   |
|    |                      ^ scrubber: a slider; arrow keys step it                     |   |
|    |                                                                                   |   |
|    |    Stage 1: the team receives £1,425.00 after the 5% fee. Clearing · 7 days.      |   |
|    +-----------------------------------------------------------------------------------+   |
|    Your money is held safely. The team is paid when you approve.        [ Start again ]    |
+--------------------------------------------------------------------------------------------+
```

```text
+- demo viewport · ?demo=booking (V4 Booking) · 16:9 ----------------------------------------+
|    +-----------------------------------------------------------------------------------+   |
|    | You · London                            The freelancer · New York                 |   |
|    | Tue 21 Oct                              Tue 21 Oct                                |   |
|    |   09:00   [ ]                             04:00   [ ]                             |   |
|    |   15:00   [x] picked                      10:00   [x]                             |   |
|    |   17:00   [ ] taken                       12:00   [ ]                             |   |
|    | --------------------------------------------------------------------------------- |   |
|    | Group session · [ Propose a new time ]   Votes: (o) Thu  (o) Thu  (o) waiting     |   |
|    |                 2 of 3 votes · needs 2 · moves when voting closes                 |   |
|    +-----------------------------------------------------------------------------------+   |
|    Pick a time in your time zone. Moving a group session? Attendees vote. [ Start again ]  |
+--------------------------------------------------------------------------------------------+
```

```text
+- demo viewport · ?demo=splits (V5 Team pay) · 16:9 ----------------------------------------+
|    +-----------------------------------------------------------------------------------+   |
|    | A £2,000 stage is approved: £1,900.00 after the 5% fee                            |   |
|    | (o) Example even split  ( ) Custom split · This team keeps 10% in its vault.      |   |
|    |                                                                                   |   |
|    | [##################|##################|##################|####]                   |   |
|    |  Owner £570.11      Designer £569.94   Developer £569.94  Team vault £190.01      |   |
|    |                                                                                   |   |
|    | Coming soon with Pro Team: a finder's fee, or paying everything into the          |   |
|    | team vault.  (static text)                                                        |   |
|    +-----------------------------------------------------------------------------------+   |
|    Approve a stage and the team's pay splits into each agreed share.    [ Start again ]    |
+--------------------------------------------------------------------------------------------+
```

- **Signed-in pill** — "Open app" (tonal; the pill then has no fill) replaces "Sign in" and "Get
  started". `/home` is untouched.
- **Suggestions** — absolutely positioned under the bar at the same width; `>` marks the
  `aria-activedescendant` row; thumbnails from payload or suggest URLs, falling back to
  `/test_images/profile_1.jpg`.
- **V2** — three stages plus a scrubber and a Fair Exit toggle with three tiers. The fee comes from
  the bp the server passes in; the Fair Exit split mirrors `fn_fair_exit_split` /
  `fn_fair_exit_release`.
- **V4** — two time zones (London BST / New York EDT on 21 Oct 2026: five hours apart), one picked
  slot, then a group reschedule round: the host offers ≥ 2 times and never votes; quorum is
  `floor(eligible / 2) + 1` against everyone entitled. External calendar sync is not shown.
- **V5** — "Example even split" / "Custom split" (co_op stakes) through a pure, unit-tested function
  that mirrors `fn_team_split_plan`. The vault rate is a fixed fixture line ("This team keeps 10% in
  its vault."), never a control: the product's payout screen shows it read-only and saves stakes
  only (`PayoutPolicyScreen.island.tsx:121-124, 199-209`). Finder's fee and all-to-the-vault appear
  only as static "Coming soon" text, never as controls; no tax pot.
- **Below `--bp-md`** every demo stacks inside its 4/5 viewport.

### 2.4 `/` at 1600 (wide)

1 char ≈ 16px · content capped at `--lp-maxw` (76rem); the theatre at `--lp-maxw-wide` (90rem)

```text
+- / · 1600 x 900 · guest · dark ------------------------------------------------------------------+
| : . : . grid · grain · spotlight · constellation run full-bleed, past the container  ~1~ . : .   |
|        +--------------------------------------------------------------------------------+        |
|        | (P) Projective  How it works  Explore  Pricing  Features   [*] Sign in [Start] |        |
|        +--------------------------------------------------------------------------------+        |
|                                                                                                  |
|                              READY-MADE TEAMS · PAYMENT PROTECTION                               |
|                                                                                                  |
|                                     Hire a ready-made team.                                      |
|                                     Pay one stage at a time.                                     |
|                                                                                                  |
|                  Search for a team that's already formed. Work starts only once                  |
|                          it's paid for. They're paid when you approve.                           |
|                                                                                                  |
|                     +------------------------------------------------------+                     |
|                     | All v | Try "motion design"        [/]  [[ Search ]] |  ~2~                |
|                     +------------------------------------------------------+                     |
|                Try  ( brand identity ) ( landing page ) ( design system )                        |
|                                                                                                  |
|                             [ Hire a team ]     Offer your skills ->                             |
|                                                                                                  |
|            .-------------------------------------------------------------------------.  ~2~      |
|           /  WORK BOARD · Website refresh                   1 task needs £400 to start \         |
|          /    New            Ready          In Progress    Review         Completed     \        |
|         /     .-----------.  .-----------.  .-----------.  .-----------.  .-----------. \        |
|        /      |Launch     |  |Logo v2    |  |Homepage   |  |Case study |  |Brand      |  \       |
|       /       |emails     |  |£400       |  |design     |  |£250       |  |colours    |   \      |
|========================================== fold @ 900px ==========================================|
|      /        |Draft      |  |Needs      |  |£2,000     |  |[ Approve ]|  |Team paid  |    \     |
|     /         '-----------'  '-----------'  '-----------'  '-----------'  '-----------'     \    |
|    :          ~2~ same loop as 1280 · theatre capped at --lp-maxw-wide (90rem)               :   |
|            [ Pause the example ]                                     Try it yourself ->          |
|                                                                                                  |
|         WHY IT'S DIFFERENT · HOW IT WORKS · SEE IT WORK (16/9 stage at --lp-maxw)                |
|         as at 1280; text columns keep their 1280 measures                                        |
|                                                                                                  |
|         WAYS TO WORK  #ways-to-work                                              voice P         |
|         +------------------------+ +------------------------+ +------------------------+         |
|         | A single job           | | An ongoing workflow    | | A live session         |         |
|         | Post a single job ->   | | Browse ongoing work -> | | Browse live sessions ->|         |
|         +------------------------+ +------------------------+ +------------------------+         |
|                                                                                                  |
|         Popular services                                        <|  |>  See all services ->      |
|         .-------------.  .-------------.  .-------------.  .-------------.  .----------.  .:     |
|         | [cover]     |  | [cover]     |  | [cover]     |  | [cover]     |  | [cover]  |  .:     |
|         | <Service>   |  | <Service>   |  | <Service>   |  | <Service>   |  | <Service>|  .:     |
|         | from £###   |  | from £###   |  | from £###   |  | from £###   |  | from £###|  .:     |
|         '-------------'  '-------------'  '-------------'  '-------------'  '----------'  .:     |
|                                                                                                  |
+- band · voice E · solid --lp-warm-bg runs full-bleed; its content stays in the container --------+
|                                                                                                  |
|         PAYMENT PROTECTION · THE NUMBERS SO FAR — as at 1280, text at --lp-measure               |
|                                                                                                  |
+- band ends --------------------------------------------------------------------------------------+
|         FOR FREELANCERS AND TEAMS — as at 1280                                                   |
+- band · voice E · solid --lp-warm-bg ------------------------------------------------------------+
|         PRICING — as at 1280                                                                     |
+- band ends --------------------------------------------------------------------------------------+
|         FAQ · FIND YOUR TEAM (final search) — as at 1280                                         |
+- PublicFooter (existing; its own container) -----------------------------------------------------+
+--------------------------------------------------------------------------------------------------+
```

What changes from 1280:

- **Only the frame grows.** Content caps at `--lp-maxw`; the hero text column, the search
  (~760–840px), the FAQ answers and the band text keep their 1280 maximums.
- **Full-bleed layers** — the background (grid, grain, spotlight, constellation) and the solid band
  tones. The WebGL canvas caps `devicePixelRatio` at 1.5, so a wide screen costs pixels, not
  sharpness.
- **The board mock** grows to `--lp-maxw-wide`, wider than the container, so the theatre reads as
  the largest object; more of it sits above the 900px fold. Still one `~2~`, with the same **Pause
  the example** toggle.
- **Rails** let their scroller bleed past the container's right edge (`.:`); ~4.5 cards; <| |> stay
  aligned to the container.

### 2.5 `/features` at 375 (L5)

```text
+- /features · 375 · guest · dark -------+
|                                        |
| +------------------------------------+ |
| | (P) Projective       Sign in  [=]  | | (1)
| +------------------------------------+ |
|                                        |
|  FEATURES                              | (2)
|  Everything Projective does            |
|  Try each feature with example data.   |
|  No real money moves.                  |
|                                        |
|  ( Find & hire ) ( Run the work ) (.:  | (3)
|                                        |
|  FIND & HIRE  #find-and-hire           | (4)
| .------------------------------------. |
| | [poster 16:10 · Search]            | |
| |                                    | |
| | Search as you type                 | |
| | Search people, teams, services     | |
| | and projects, with suggestions.    | |
| | [ Try it ]          Learn more ->  | |
| '------------------------------------' |
| .------------------------------------. |
| | Team builder                       | |
| | Sketch the team you need, then     | |
| | find teams like it.                | |
| | [ Try it ]          Learn more ->  | |
| '------------------------------------' |
| .------------------------------------. |
| | Services & sessions                | |
| | Book a live session. Your payment  | |
| | is held until 24 hours after it    | |
| | ends.                              | |
| | [ Try it ]          Learn more ->  | |
| '------------------------------------' |
|                                        |
|  RUN THE WORK  #run-the-work           |
|  (same shape: the first tile has a     |
|   poster, the rest are compact)        |
|  Work board · Timeline · Booking ·     |
|  Ways to work · Team room              |
|                                        |
|  MONEY  #money                         | (5)
|  Payment protection · Team pay ·       |
|  Fair Exit & no-shows                  |
|                                        |
|  TRUST  #trust                         |
|  Verification · Files & sharing        |
|                                        |
|  COMING SOON  #coming-soon             | (6)
| .------------------------------------. |
| | [ Coming soon ]                    | |
| | Sell your best work                | |
| | Turn great work into a template    | |
| | you can sell.                      | |
| '------------------------------------' |
|  Connected tools · Tax pot (same)      |
|                                        |
|            Find your team.             | (7)
| +------------------------------------+ |
| | [#v] | Search teams, servi  [[>]]  | |
| +------------------------------------+ |
|  [           Hire a team            ]  |
|          Offer your skills ->          |
|                                        |
+- PublicFooter (existing) --------------+
+----------------------------------------+
```

```text
+- /features · Try it at 375 -> sheet ---+
| +------------------------------------+ |
| | Work board                     [x] | | (8)
| | Every job you post runs on a       | |
| | board. Work starts once it's paid  | |
| | for.                               | |
| | +--------------------------------+ | |
| | | V1 module · 4 / 5 · ~1~        | | |
| | |                                | | |
| | +--------------------------------+ | |
| | [ Start again ]    Learn more ->   | |
| +------------------------------------+ |
+----------------------------------------+
```

### 2.6 `/features` at 1280 (L5)

```text
+- /features · 1280 · guest · dark ----------------------------------------------------------+
|                                                                                            |
|    +----------------------------------------------------------------------------------+    |
|    | (P) Projective   How it works  Explore  Pricing  Features   [*] Sign in [Start]  |    | (1)
|    +----------------------------------------------------------------------------------+    |
|                                                                                            |
|    FEATURES                                                                                | (2)
|    Everything Projective does                                                              |
|    Try each feature with example data. No real money moves.                                |
|                                                                                            |
|    ( Find & hire )  ( Run the work )  ( Money )  ( Trust )  ( Coming soon )                | (3)
|                                                                                            |
|    FIND & HIRE  #find-and-hire                                                  voice P    | (4)
|    +------------------------------------------------------+ +--------------------------+   |
|    | [poster 800x500 · Search as you type]                | | [poster · Team builder]  |   |
|    |                                                      | | Team builder             |   |
|    |                                                      | | Sketch the team you need,|   |
|    |                                                      | | then find teams like it. |   |
|    |                                                      | | [ Try it ] Learn more -> |   |
|    |                                                      | +--------------------------+   |
|    | Search as you type                                   | +--------------------------+   |
|    | Search people, teams, services and projects, with    | | [poster · Services]      |   |
|    | suggestions as you type.                             | | Services & sessions      |   |
|    |                                                      | | Book a live session.     |   |
|    | [ Try it ]   Learn more ->                           | | [ Try it ] Learn more -> |   |
|    +------------------------------------------------------+ +--------------------------+   |
|                                                                                            |
|    RUN THE WORK  #run-the-work                                                  voice P    |
|    +------------------------------------------------------+ +--------------------------+   |
|    | [poster · Work board]                                | | [poster · Timeline]      |   |
|    | Work board                                           | | Timeline                 |   |
|    | Every job you post runs on a board. Work starts once | | Zoom out to months or in |   |
|    | it's paid for.                                       | | to days.                 |   |
|    | [ Try it ]   Learn more ->                           | | [ Try it ] Learn more -> |   |
|    +------------------------------------------------------+ +--------------------------+   |
|    +--------------------------+ +--------------------------+ +--------------------------+  |
|    | [poster · Booking]       | | [poster · Ways to work]  | | [poster · Team room]     |  |
|    | Booking                  | | Ways to work             | | Team room                |  |
|    | Pick a time in your time | | See how a task, a job,   | | Chat and share files in  |  |
|    | zone.                    | | ongoing work and a       | | one room.                |  |
|    |                          | | session each run.        | |                          |  |
|    | [ Try it ] Learn more -> | | [ Try it ] Learn more -> | | [ Try it ] Learn more -> |  |
|    +--------------------------+ +--------------------------+ +--------------------------+  |
|                                                                                            |
|    MONEY  #money                                                                voice E    | (5)
|    +------------------------------------------------------+ +--------------------------+   |
|    | [poster · Payment protection]                        | | [poster · Fair Exit]     |   |
|    | Payment protection                                   | | Fair Exit & no-shows     |   |
|    | Pay for each stage before it starts. The team is     | | If work stops, end the   |   |
|    | paid when you approve.                               | | stage fairly.            |   |
|    | [ Try it ]   Learn more ->                           | | [ Try it ] Learn more -> |   |
|    +------------------------------------------------------+ +--------------------------+   |
|    +-----------------------------------------------------------------------------------+   |
|    | [poster · Team pay]                                                               |   |
|    | Team pay — watch a stage payment split into each member's agreed share.           |   |
|    | [ Try it ]   Learn more ->            (full row: the currency tile is HELD, #281) |   |
|    +-----------------------------------------------------------------------------------+   |
|                                                                                            |
|    TRUST  #trust                                                                voice E    |
|    +---------------------------------------+ +-----------------------------------------+   |
|    | [poster · Verification]               | | [poster · Files & sharing]              |   |
|    | Verification                          | | Files & sharing                         |   |
|    | Stripe checks ID and bank details     | | Program files like .exe are refused.    |   |
|    | before anyone takes paid project      | |                                         |   |
|    | work.                                 | |                                         |   |
|    | [ Try it ]   Learn more ->            | | [ Try it ]   Learn more ->              |   |
|    +---------------------------------------+ +-----------------------------------------+   |
|                                                                                            |
|    COMING SOON  #coming-soon                                                               | (6)
|    +-------------------------+ +--------------------------+ +--------------------------+   |
|    | [ Coming soon ]         | | [ Coming soon ]          | | [ Coming soon ]          |   |
|    | Sell your best work     | | Connected tools          | | Tax pot                  |   |
|    | Turn great work into a  | | Link the tools your team | | Set money aside for tax  |   |
|    | template you can sell.  | | already uses.            | | automatically.           |   |
|    +-------------------------+ +--------------------------+ +--------------------------+   |
|    static and muted: no Try it, no hover motion, no Learn more                             |
|                                                                                            |
|                                      Find your team.                                       | (7)
|                 +--------------------------------------------------------+                 |
|                 | All v | Search teams, services and pro…   [[ Search ]] |                 |
|                 +--------------------------------------------------------+                 |
|                          [ Hire a team ]     Offer your skills ->                          |
|                                                                                            |
+- PublicFooter (existing, unchanged) -------------------------------------------------------+
+--------------------------------------------------------------------------------------------+
```

```text
+- /features · Try it -> DemoHost in a Dialog (packages/ui/overlay, styled lp-) -------------+
| page behind: scrim; the background and every poster are paused                             |
|                                                                                            |
|       +----------------------------------------------------------------------------+       |
|       | Work board                                                          [x]    |       | (8)
|       | Every job you post runs on a board. Work starts once it's paid for.        |       |
|       | +------------------------------------------------------------------------+ |       |
|       | | the same V1 module as the landing stage · 16 / 9 · ~1~                 | |       |
|       | |                                                                        | |       |
|       | +------------------------------------------------------------------------+ |       |
|       | [ Start again ]                                          Learn more ->     |       |
|       +----------------------------------------------------------------------------+       |
+--------------------------------------------------------------------------------------------+
```

1. **The same LandingShell pill**; "Features" carries `aria-current="page"`; the other links point
   at `/#how-it-works`, `/#pricing` and `/explore`.
2. **The page's one h1** with SSR description text. JSON-LD: WebPage plus an ItemList of the
   features.
3. **Chapter nav** — anchor chips, sticky under the pill from `--bp-md`, one sideways row below it.
   `?section=<slug>` scrolls to a chapter and focuses its h2. Real links, so they work with no JS.
4. **Bento at 1280** — three columns, each chapter's lead tile spans two. Find & hire: V8 2×2 with
   V11 and V13 stacked. Run the work: V1 (2) + V3; then V4 · V9 · V6. Each tile: a poster
   (`placehold.co/800x500?text=<Feature>` until real captures), a title, one line from §4.12, "Try
   it" (tonal) and "Learn more" (→ `/help` until P2's article exists). At 375 only each chapter's
   first tile shows its poster.
5. **Money** (voice E) — V2 (2) + V12; V5 takes the full row because **V10 is held** (#281: rates
   are seed-only and "locked at funding" is false). Trust: V16 + V7; V7 never says "virus-checked".
6. **Coming soon** — V14, V15 and the tax pot: static, muted, a "Coming soon" lifecycle label (a
   permitted container), no Try it, no motion, no brand names.
7. **The page ends** with the same final CTA and a HeroSearch instance (on `/features` that instance
   takes the `/` shortcut, being the page's only search; #282).
8. **DemoHost** reuses L3's host and demo modules inside `Dialog` (Decision #171), styled `lp-`:
   focus trapped, Esc closes, focus returns to the "Try it" that opened it; a full-height sheet at
   375; the chunk loads on "Try it"; while open, the demo is the page's only `~1~`.

**What changes at 768 and 1600** (no separate frames):

- **768** — the bento drops to two columns; each chapter's lead tile takes the full row and the rest
  pair up beneath it; the chapter nav turns sticky under the pill (from `--bp-md`); every tile keeps
  its poster; the DemoHost dialog is a centred panel at the 4/3 demo ratio.
- **1600** — as at 1280: content capped at `--lp-maxw`, tile measures unchanged; the background runs
  full-bleed past the container, exactly as on `/` (§2.4).

### 2.7 Animation budget (at most two moving things in any viewport)

| Viewport state                                         | `~1~`                                                                              | `~2~`                                                                   | Held still                                                                  |
| :----------------------------------------------------- | :--------------------------------------------------------------------------------- | :---------------------------------------------------------------------- | :-------------------------------------------------------------------------- |
| Hero at rest, ≥ `--bp-md`                              | Background: B1 WebGL constellation, or the B7 spotlight where WebGL is unavailable | The hero timeline: typewriter and board loop take turns, never together | B9 glow (static border)                                                     |
| Hero, search focused                                   | Background                                                                         | B9 glow (≤ 3 turns)                                                     | Typewriter gone while typing; board loop paused                             |
| Hero, suggestions open                                 | Background                                                                         | None                                                                    | Board loop paused under the panel                                           |
| Hero, paused by the visitor (≥ `--bp-md`)              | Background only                                                                    | None                                                                    | Typewriter shows the static placeholder; board loop holds its current frame |
| Hero at rest, < `--bp-md`                              | B1, capable devices only                                                           | Typewriter                                                              | Board poster (static by design)                                             |
| How it works entering                                  | One-shot step reveal (`--lp-dur-base`, 220ms)                                      | None                                                                    | WebGL paused (hero offscreen); board loop paused (< 50% visible)            |
| Demo stage                                             | The active demo, while an interaction plays                                        | "Team paid" burst, at most once per interaction                         | Background (static below the hero)                                          |
| Ways to work, rails, protection, numbers, pricing, FAQ | None                                                                               | None                                                                    | No autoplay, no count-up; the calculator updates instantly                  |
| Final CTA                                              | B7 spotlight (pointer only, from `--bp-md`)                                        | B9 glow on focus                                                        | Constellation (static SVG here)                                             |
| `/features`, browsing                                  | None                                                                               | None                                                                    | Posters and chapter nav (static)                                            |
| `/features`, dialog open                               | The open demo                                                                      | None                                                                    | The page behind (paused)                                                    |
| Reduced motion (either channel)                        | None                                                                               | None                                                                    | Everything: static SVG, poster board, frame-stepped demos                   |

WCAG 2.2.2: the B9 ring runs at most three turns and only on hover/focus; B1's idle drift settles
within 5 seconds and resumes only on pointer movement; the hero timeline stops after one cycle per
example and on any interaction with the hero. That timeline (up to six typewriter examples taking
turns with a board loop of `--lp-dur-demo` steps and `--lp-dur-demo-hold` pauses) runs well past 5
seconds beside other content, so from `--bp-md` a visible **Pause the example** toggle
(`aria-pressed`, outside the inert theatre, drawn in the 768 / 1280 / 1600 frames) stops both the
typewriter and the board loop until pressed again. Below `--bp-md` the theatre is a static poster
and the typewriter is the only hero motion; its whole run is capped at 5 seconds, after which the
static placeholder shows, so no control is needed there.

---

## 3. Token sheet (`--lp-*`)

Lives in `features/landing/styles/lp-theme.css` (L1), scoped to `:is(.lp-root, .lp-portal)`. **35
audited rows (244 measured values across the four mode/contrast states) pass; one row is info-only**
— dark, light, dark high-contrast (HC) and light HC, each measured against the worst case of the
whole effect stack (pale wash, spotlight, lit grid line, glow halo, quiet-zone node and grain
together; §3.3 states the grain and halo models). L0 counted 34 rows and 236 values; L1 adds the
transparent header pill. The §3.3 table is generated from the stylesheet by
`features/landing/core/lp-contrast.ts`, and `core/lp-theme.contrast.test.ts` fails any cell below
its floor and any published cell that no longer matches the sheet (± 0.01), so the table cannot
drift.

### 3.1 Type families and font loading

The app ships no webfont (`packages/ui/styles/index.css:169-171`, `:241`; `DESIGN_SYSTEM.md:440`),
`apps/web/static/fonts/` does not exist, and CSP is `font-src 'self' data:`
(`apps/web/utils/csp.ts:79`). The landing therefore uses **system stacks only**: zero bytes, no
swap, no CLS, no CSP change. A self-hosted OFL face is an owner decision not taken (§9).

| Token               | Value                                                                                                                                      | Resolves to                                                                                                                   |
| :------------------ | :----------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| `--lp-font-display` | `"Segoe UI Variable Display", "Segoe UI Variable", var(--font-sans)`                                                                       | Windows 11: Segoe UI Variable (optical size follows font size). macOS: SF Pro Display. Android: Roboto.                       |
| `--lp-font-serif`   | `ui-serif, "Iowan Old Style", "Sitka Display", "Sitka", "Sitka Text", Charter, "Bitstream Charter", Cambria, Georgia, "Noto Serif", serif` | Safari: New York. Chrome on macOS: Iowan Old Style. Windows: Sitka. Android: Noto Serif. Linux: Charter or the default serif. |
| `--lp-font-body`    | `var(--font-sans)`                                                                                                                         | The product UI's own face, so the board mock matches.                                                                         |
| `--lp-font-mono`    | `ui-monospace, "SF Mono", "Cascadia Mono", var(--font-mono)`                                                                               | Cascadia Mono before Cascadia Code (no ligatures); always `font-variant-ligatures: none`.                                     |

- Serif weight 400 only (a real master on every listed serif). No serif for figures (Georgia has
  only old-style numerals): figures use the display sans with `tabular-nums lining-nums`.
- Weight fallbacks are acceptable: Android Roboto has no 600 (renders 700); Windows 10 static Segoe
  UI has no 500 (renders 400).

### 3.2 Palette (name | dark | light | purpose)

**Canvas and surfaces** (all solid)

| name              | dark          | light                   | purpose                                                               |
| :---------------- | :------------ | :---------------------- | :-------------------------------------------------------------------- |
| `--lp-bg`         | `#07090A`     | `#F6F8F8`               | Page canvas                                                           |
| `--lp-bg-end`     | `#07090A`     | `#FFFFFF`               | Bottom stop of the light canvas's airy fade (dark stays flat)         |
| `--lp-surface-1`  | `#0D1012`     | `#FFFFFF`               | Raised: search field, cards, stage frame, glass base, typeahead panel |
| `--lp-surface-2`  | `#13171A`     | `#F2F5F6`               | Inside a raised surface: stage body, kanban column, rail tile         |
| `--lp-surface-3`  | `#1A1F23`     | `#E9EDEF`               | Hover or selected fill, chips, active tab                             |
| `--lp-wash-teal`  | `transparent` | `rgb(40 134 144 / .06)` | Light airy radial wash, top-left                                      |
| `--lp-wash-amber` | `transparent` | `rgb(217 130 22 / .06)` | Light airy radial wash, top-right                                     |

**Text**

| name          | dark      | light     | purpose                                                                 |
| :------------ | :-------- | :-------- | :---------------------------------------------------------------------- |
| `--lp-text`   | `#EEF1F2` | `#101417` | Headings and primary text. Allowed on glass.                            |
| `--lp-text-2` | `#C6CED2` | `#3E484D` | Sublines and paragraphs; dark ≥ 7:1 even in the hero. Allowed on glass. |
| `--lp-text-3` | `#A1ABAF` | `#475156` | Mono metadata, placeholder, captions. **Never on glass.**               |

**Warm editorial voice** (payment protection, numbers, pricing bands)

| name                | dark                     | light                 | purpose                                                  |
| :------------------ | :----------------------- | :-------------------- | :------------------------------------------------------- |
| `--lp-warm-bg`      | `#12100E`                | `#F6F1E9`             | Editorial band background (warm charcoal / stone paper)  |
| `--lp-warm-surface` | `#1A1714`                | `#FFFCF7`             | Raised surface inside an editorial band (the calculator) |
| `--lp-warm-text`    | `#F3EEE6`                | `#1D1913`             | Serif display and primary text                           |
| `--lp-warm-text-2`  | `#C5BBAE`                | `#52483D`             | Editorial body text                                      |
| `--lp-warm-text-3`  | `#A39A8D`                | `#61574B`             | Editorial metadata                                       |
| `--lp-warm-hair`    | `rgb(243 238 230 / .08)` | `rgb(29 25 19 / .10)` | Single-edge dividers (decorative)                        |

**Amber** — brand `#D98216` (Decision #157). Same fill in both modes; hover and press move lighter,
so label contrast only rises.

| name                | dark      | light     | purpose                                                                                                                                                      |
| :------------------ | :-------- | :-------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--lp-amber`        | `#D98216` | `#D98216` | The **one filled primary per region**: the hero and final-CTA Search submit; "Offer your skills" in For freelancers; "Get started" in the pill               |
| `--lp-amber-hover`  | `#E5953A` | `#E39433` | Hover fill                                                                                                                                                   |
| `--lp-amber-active` | `#ECA457` | `#EAA453` | Press fill (press itself is `scale()` only)                                                                                                                  |
| `--lp-on-amber`     | `#0A0C0D` | `#101417` | Label on the amber fill                                                                                                                                      |
| `--lp-amber-edge`   | `#D98216` | `#A35F0C` | 1px inset contour in **every** state; the light fill is 2.61:1 off the canvas (1.88:1 pressed) and the contour holds ≥ 3.24:1 — #157 flag (b) solved locally |
| `--lp-amber-ink`    | `#F5AD5E` | `#7D4303` | Amber as text: editorial eyebrow, figure accents                                                                                                             |

**Teal** — brand `#288690`, already the app seed (`apps/web/routes/_app.tsx:17`).

| name                    | dark      | light     | purpose                                                                                                                                |
| :---------------------- | :-------- | :-------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| `--lp-teal`             | `#288690` | `#288690` | Glow, constellation, structure. **Never text** (light 4.0:1 on the canvas, 4.3:1 on white).                                            |
| `--lp-teal-ink`         | `#6CCDD5` | `#0A5A62` | Links, precision eyebrow, live and held labels                                                                                         |
| `--lp-teal-fill`        | `#6CCDD5` | `#1F747D` | Filled control inside the demo stage; dark uses a light fill with dark ink so hover/press raise contrast and stay ≥ 3:1 off the canvas |
| `--lp-teal-fill-hover`  | `#8ADDE3` | `#1B6870` | Hover fill                                                                                                                             |
| `--lp-teal-fill-active` | `#9FE5EA` | `#175C63` | Press fill                                                                                                                             |
| `--lp-on-teal`          | `#031214` | `#FFFFFF` | Label on the teal fill                                                                                                                 |

**Monochrome** — secondary filled buttons ("Open app" never fills; it is tonal). Amber plus mono is
the legal two-fill pair under #157.

| name               | dark      | light     | purpose    |
| :----------------- | :-------- | :-------- | :--------- |
| `--lp-mono`        | `#EEF1F2` | `#161B1E` | Rest fill  |
| `--lp-mono-hover`  | `#FFFFFF` | `#0B0E10` | Hover fill |
| `--lp-mono-active` | `#FFFFFF` | `#0B0E10` | Press fill |
| `--lp-on-mono`     | `#07090A` | `#FFFFFF` | Label      |

**Lines and focus**

| name                                 | dark                     | light                 | purpose                                                          |
| :----------------------------------- | :----------------------- | :-------------------- | :--------------------------------------------------------------- |
| `--lp-hair`                          | `rgb(255 255 255 / .07)` | `rgb(16 20 23 / .08)` | Decorative single-edge separators                                |
| `--lp-hair-strong`                   | `rgb(255 255 255 / .12)` | `rgb(16 20 23 / .12)` | Card and stage outline (decorative)                              |
| `--lp-edge`                          | `#7A858A`                | `#646F75`             | Interactive boundary ≥ 3:1: inputs, outline buttons, chips, tabs |
| `--lp-focus`                         | `#8ADDE3`                | `#0B5D65`             | Unused: no focus ring on the landing (#285 (A))                  |
| `--lp-focus-w` / `--lp-focus-offset` | `2px` / `2px`            | `2px` / `2px`         | The offset keeps the ring against the canvas, never a fill       |

**Demo-stage status** — always colour + icon + the app's word.

| name                                  | dark                              | light                             | purpose                              |
| :------------------------------------ | :-------------------------------- | :-------------------------------- | :----------------------------------- |
| `--lp-refuse-ink` / `-fill` / `-edge` | `#FFA39B` / `#2A1517` / `#B24E46` | `#9C2228` / `#FCEDEC` / `#C24A44` | Refused move: lock + "Needs funding" |
| `--lp-ok-ink` / `-fill`               | `#6AD9A7` / `#0F2A21`             | `#126645` / `#E7F4EE`             | Approved: check + "Team paid"        |
| `--lp-held-ink` / `-fill`             | `#6CCDD5` / `#0E2528`             | `#0A5A62` / `#E5F2F3`             | Money held: shield + "Funded"        |

Status uses rose, green and teal; amber stays the CTA only, which avoids #157 (a)'s accent/warning
collision.

**Effects** (B7 grid + spotlight, B9 glow ring, B10 grain, B1 constellation, glass header)

| name                                      | dark                                  | light                   | purpose                                                                                                             |
| :---------------------------------------- | :------------------------------------ | :---------------------- | :------------------------------------------------------------------------------------------------------------------ |
| `--lp-spot`                               | `rgb(108 205 213 / .07)`              | `rgb(40 134 144 / .05)` | B7 spotlight centre                                                                                                 |
| `--lp-spot-r`                             | `clamp(18rem, 36vw, 36rem)`           | same                    | Spotlight radius                                                                                                    |
| `--lp-spot-x` / `--lp-spot-y`             | `50%` / `0%`                          | same                    | SSR static position; pointer-written in px only on fine pointers with neither reduced-motion channel on             |
| `--lp-grid-size`                          | `clamp(2.5rem, 1.6rem + 2.4vw, 4rem)` | same                    | B7 grid cell                                                                                                        |
| `--lp-grid-line`                          | `rgb(255 255 255 / .04)`              | `rgb(16 20 23 / .05)`   | Base grid line                                                                                                      |
| `--lp-grid-line-lit`                      | `rgb(255 255 255 / .07)`              | `rgb(16 20 23 / .08)`   | Grid line under the spotlight (the audited value)                                                                   |
| `--lp-glow-amber`                         | `rgb(217 130 22 / .28)`               | `rgb(217 130 22 / .22)` | B9 halo colour                                                                                                      |
| `--lp-glow-teal`                          | `rgb(40 134 144 / .36)`               | `rgb(40 134 144 / .24)` | B9 halo colour                                                                                                      |
| `--lp-halo-blur`                          | `32px`                                | `28px`                  | Blur only, spread 0                                                                                                 |
| `--lp-ring-w`                             | `1px`                                 | `1px`                   | B9 ring width                                                                                                       |
| `--lp-glow-stop-a` / `-b`                 | `#F5AD5E` / `#6CCDD5`                 | `#A35F0C` / `#1F747D`   | Conic ring stops; both stops and the OKLab midpoint ≥ 3:1 against field and halo                                    |
| `--lp-grain-opacity`                      | `.04`                                 | `.035`                  | B10 grain; stays under reduced motion (static)                                                                      |
| `--lp-grain-size`                         | `160px`                               | same                    | Grain tile                                                                                                          |
| `--lp-node`                               | `#6CCDD5`                             | `#288690`               | B1 node colour                                                                                                      |
| `--lp-node-alpha`                         | `.6`                                  | `.5`                    | Nodes outside the copy column                                                                                       |
| `--lp-node-alpha-quiet`                   | `.08`                                 | `.10`                   | Ceiling for every node and link inside the copy column (+24px)                                                      |
| `--lp-node-alpha-halo`                    | `0`                                   | `0`                     | Nothing drawn inside the search halo box (field rect + 1.5 × halo blur); nodes on the halo drop text-3 to 4.20:1    |
| `--lp-bg-lum-max`                         | `0.040` (ceiling)                     | `0.57` (floor)          | Per-pixel luminance clamp for the live background under copy (the wallet aurora's rule, `DESIGN_SYSTEM.md:927-938`) |
| `--lp-glass-veil` / `-blur` / `-saturate` | `82%` / `16px` / `1.4`                | same                    | Header pill glass on `::before` (text-2 needs 70–71%, teal-ink 74–77%)                                              |

**High-contrast overrides** (dark HC | light HC). Surfaces are deliberately not widened (as in the
app engine); HC hairlines are decorative and not audited.

| name                              | dark HC               | light HC       |    | name                         | dark HC                         | light HC                  |
| :-------------------------------- | :-------------------- | :------------- | :- | :--------------------------- | :------------------------------ | :------------------------ |
| `--lp-text`                       | `#FFFFFF`             | `#000000`      |    | `--lp-edge`                  | `#97A2A7`                       | `#4A555B`                 |
| `--lp-text-2`                     | `#D9E0E3`             | `#252D32`      |    | `--lp-focus` / `-w`          | `#B0F1F5` / 3px                 | `#053F45` / 3px           |
| `--lp-text-3`                     | `#BEC7CB`             | `#30393E`      |    | `--lp-glow-stop-a`           | `#FFBC70`                       | `#6E3E03`                 |
| `--lp-warm-text`                  | `#FFFFFF`             | `#000000`      |    | `--lp-glow-stop-b`           | `#93E3EA`                       | `#06444A`                 |
| `--lp-warm-text-2`                | `#E4DCD2`             | `#372E25`      |    | `--lp-refuse-ink` / `-edge`  | `#FFC1BB` / `#E0766C`           | `#781117` / `#9A2A2A`     |
| `--lp-warm-text-3`                | `#CDC3B6`             | `#433A30`      |    | `--lp-ok-ink`                | `#8FEAC1`                       | `#0A4C33`                 |
| `--lp-amber-ink`                  | `#FFBC70`             | `#663800`      |    | `--lp-held-ink`              | `#93E3EA`                       | `#06444A`                 |
| `--lp-amber-edge`                 | `#D98216`             | `#6E3E03`      |    | `--lp-spot`                  | `transparent`                   | `transparent`             |
| `--lp-on-amber`                   | `#000000`             | `#000000`      |    | `--lp-grid-line` (= lit)     | `rgb(255 255 255/.06)`          | `rgb(16 20 23/.08)`       |
| `--lp-teal-ink`                   | `#93E3EA`             | `#06444A`      |    | `--lp-glow-amber` / `-teal`  | `.16` / `.20`                   | `.12` / `.12`             |
| `--lp-teal-fill`                  | `#93E3EA`             | `#134F55`      |    | `--lp-wash-teal` / `-amber`  | `0` / `0`                       | `.04` / `.03`             |
| `--lp-teal-fill-hover`, `-active` | `#AEEBF0`             | `#0F4247`      |    | `--lp-grain-opacity`         | `0`                             | `0`                       |
| `--lp-on-teal`                    | `#031214`             | `#FFFFFF`      |    | `--lp-node-alpha` / `-quiet` | `.35` / `.06`                   | `.30` / `.05`             |
| `--lp-mono` (+ hover, active)     | `#EEF1F2` / `#FFFFFF` | `#000000`      |    | `--lp-glass-veil`            | `88%`                           | `88%`                     |
| `--lp-on-mono`                    | `#000000`             | `#FFFFFF`      |    | `--lp-hair` / `-strong`      | `rgb(255 255 255/.16)` / `/.24` | `rgb(0 0 0/.18)` / `/.28` |
| `--lp-bg-lum-max`                 | `0.037`               | `0.70` (floor) |    |                              |                                 |                           |

### 3.3 Contrast table

Each row is the worst ground in its family. Effect families stack canvas, wash peak, spotlight peak
and lit grid line, then one of: amber halo, teal halo or quiet-zone node; grain sits on ink and
ground in its worse polarity.

**Grain model (normal-mode columns).** Normal-mode rows composite B10 grain at `--lp-grain-opacity`
in sRGB over the ground in both polarities (white and black) and keep the worse, a conservative
bound: grain never paints over surfaces or fills (`.lp-bg::after` sits under content, §3.6). The
table below is `lp-contrast.ts`'s output
(`deno run --allow-read apps/web/features/landing/core/lp-contrast.ts` prints it); it differs from
L0's uncommitted script by up to 0.3 (L0 also grained the ink), and no pairing fails AA under either
model. HC columns carry no grain (`--lp-grain-opacity: 0`) and reproduce L0 exactly.

**Halo geometry.** No text overlaps the search field box. The halo alpha at the nearest text is ≤ ½
× `--lp-glow-*` (the field edge; Gaussian σ = `--lp-halo-blur`), and the "on hero effects" rows are
evaluated there: at the peak alpha directly under text, dark text-3 drops to 3.74 and light text-3,
teal-ink and amber-ink to 4.18 / 4.07 / 4.03, all below 4.5. The "Try:" label beside the chips uses
`--lp-text-2`, not `--lp-text-3`. `lp-contrast.ts` evaluates the halo at that alpha (`HALO_EDGE`).

**Header pill.** Below `--bp-lg`, and wherever JavaScript has not run, the pill wears its glass (the
glass-pill row). From `--bp-lg` the hydrated pill sheds it within 48px of the top only once
`LandingBackground` has measured its quiet zones, which include the pill's band (its width, from its
resting place down through that 48px), so its text sits on the hero stack under a quiet-alpha node
(the transparent-pill row) — never on a full-alpha node, where `--lp-text-2` fails AA in both normal
modes (the L1 review measured 2.29 dark and 3.65 light).

| pairing (worst ground)                                                                     |                  dark |                 light |               dark HC |              light HC | floor (HC floor)                      | pass                                                       |
| :----------------------------------------------------------------------------------------- | --------------------: | --------------------: | --------------------: | --------------------: | :------------------------------------ | :--------------------------------------------------------- |
| text on canvas + surface-1..3                                                              |                 13.11 |                 14.56 |                 16.61 |                 17.82 | 4.5 (7)                               | PASS                                                       |
| text on hero effects                                                                       |                  9.68 |                 10.74 |                 16.05 |                 15.01 | 4.5 (7)                               | PASS                                                       |
| text-2 on canvas + surface-1..3                                                            |                  9.33 |                  7.38 |                 12.44 |                 11.88 | 4.5 (7)                               | PASS                                                       |
| text-2 on hero effects                                                                     |                  6.89 |                  5.44 |                 12.02 |                 10.01 | 4.5 (7); dark aim 7                   | PASS                                                       |
| text-3 on canvas + surface-1..3                                                            |                  6.35 |                  6.41 |                  9.67 |                 10.01 | 4.5 (7)                               | PASS                                                       |
| text-3 on hero effects                                                                     |                  4.69 |                  4.72 |                  9.34 |                  8.43 | 4.5 (7)                               | PASS                                                       |
| amber-ink on canvas + surface-1..3                                                         |                  7.81 |                  6.17 |                 10.03 |                  8.37 | 4.5 (7)                               | PASS                                                       |
| amber-ink on hero effects                                                                  |                  5.77 |                  4.55 |                  9.69 |                  7.04 | 4.5 (7)                               | PASS                                                       |
| teal-ink on canvas + surface-1..3                                                          |                  8.03 |                  6.23 |                 11.40 |                  9.22 | 4.5 (7)                               | PASS                                                       |
| teal-ink on hero effects                                                                   |                  5.93 |                  4.60 |                 11.02 |                  7.76 | 4.5 (7)                               | PASS                                                       |
| hero display (large) on full-alpha node (outside copy)                                     |                  3.22 |                  7.20 |                  7.88 |                 11.56 | 3 (4.5)                               | PASS — legal only because copy never leaves the quiet zone |
| text · text-2 on the transparent pill (from --bp-lg at the top; its band is a copy zone)   |          10.06 · 7.15 |          10.96 · 5.55 |         16.05 · 12.02 |         15.17 · 10.11 | 4.5 (7)                               | PASS                                                       |
| warm-text on warm-bg / warm-surface                                                        |                 13.99 |                 14.41 |                 17.85 |                 18.68 | 4.5 (7)                               | PASS                                                       |
| warm-text-2 on editorial                                                                   |                  8.53 |                  7.35 |                 13.15 |                 11.82 | 4.5 (7)                               | PASS                                                       |
| warm-text-3 on editorial                                                                   |                  5.82 |                  5.82 |                 10.26 |                  9.90 | 4.5 (7)                               | PASS                                                       |
| amber-ink / teal-ink on editorial                                                          |           8.48 / 8.72 |           6.47 / 6.53 |         10.78 / 12.25 |           8.77 / 9.66 | 4.5 (7)                               | PASS                                                       |
| on-amber on amber / hover / active                                                         |    6.18 / 7.49 / 8.62 |    5.90 / 7.03 / 8.16 |   7.15 / 8.69 / 10.01 |    7.15 / 8.55 / 9.93 | 4.5 (7)                               | PASS                                                       |
| on-mono on mono / hover / active                                                           | 16.11 / 18.27 / 18.27 | 15.86 / 18.10 / 18.10 | 18.50 / 21.00 / 21.00 | 21.00 / 21.00 / 21.00 | 4.5 (7)                               | PASS                                                       |
| on-teal on teal-fill / hover / active                                                      |  9.48 / 11.30 / 12.40 |    5.08 / 5.95 / 7.01 | 13.10 / 14.49 / 14.49 |  9.22 / 11.11 / 11.11 | 4.5 (7)                               | PASS                                                       |
| text on surface-3 (tonal, ghost hover)                                                     |                 14.63 |                 15.71 |                 16.61 |                 17.82 | 4.5 (7)                               | PASS                                                       |
| text · text-2 · teal-ink on the glass pill (veil 82%, HC 88%, over white or black content) |    9.92 · 7.06 · 6.08 |   12.13 · 6.15 · 5.19 |  13.91 · 10.42 · 9.55 |  15.97 · 10.64 · 8.26 | 4.5 (7)                               | PASS                                                       |
| refuse-ink on refuse-fill · text on refuse-fill                                            |          9.00 · 15.19 |          6.91 · 16.28 |         11.16 · 17.24 |          9.76 · 18.46 | 4.5 (7)                               | PASS                                                       |
| ok-ink on ok-fill · held-ink on held-fill                                                  |           8.81 · 8.62 |           6.17 · 6.91 |         10.71 · 10.97 |           8.87 · 9.48 | 4.5 (7)                               | PASS                                                       |
| refuse / ok / held ink on surface-1 and -2                                                 |   9.41 / 10.38 / 9.72 |    7.17 / 6.36 / 7.23 | 11.67 / 12.62 / 12.37 |   10.14 / 9.15 / 9.91 | 4.5 (7)                               | PASS                                                       |
| edge vs canvas + surfaces · hero · editorial                                               |    4.39 · 3.28 · 4.72 |    4.38 · 3.22 · 4.59 |    6.36 · 6.15 · 6.84 |    6.50 · 5.47 · 6.81 | 3 (4.5)                               | PASS                                                       |
| amber-edge vs canvas + surfaces · hero · editorial                                         |    5.66 · 4.22 · 6.08 |    4.24 · 3.12 · 4.45 |    5.66 · 5.47 · 6.08 |    7.57 · 6.38 · 7.94 | 3 (4.5)                               | PASS                                                       |
| mono fill vs canvas + surfaces · hero                                                      |         14.63 · 10.92 |         14.74 · 10.84 |         14.63 · 14.14 |         17.82 · 15.01 | 3 (4.5)                               | PASS                                                       |
| teal-fill vs canvas + surfaces · hero · editorial                                          |    8.96 · 6.69 · 9.63 |    4.63 · 3.40 · 4.85 | 11.40 · 11.02 · 12.25 |    7.83 · 6.59 · 8.20 | 3 (4.5)                               | PASS                                                       |
| refuse-edge vs surface-2                                                                   |                  3.49 |                  4.40 |                  5.99 |                  7.00 | 3 (4.5)                               | PASS                                                       |
| B9 ring stop-a vs field · halo                                                             |          10.02 · 6.51 |           5.00 · 3.12 |          11.53 · 9.73 |           8.92 · 6.38 | 3 (4.5)                               | PASS                                                       |
| B9 ring stop-b vs field · halo                                                             |          10.30 · 6.69 |           5.45 · 3.40 |         13.11 · 11.06 |          10.86 · 7.76 | 3 (4.5)                               | PASS                                                       |
| B9 ring OKLab midpoint vs field · halo                                                     |          10.19 · 6.62 |           5.20 · 3.25 |         12.33 · 10.40 |           9.82 · 7.02 | 3 (4.5)                               | PASS                                                       |
| focus vs canvas + surfaces · hero · editorial                                              |  10.70 · 7.99 · 11.50 |    6.44 · 4.74 · 6.75 | 13.25 · 12.80 · 14.23 |   9.88 · 8.32 · 10.36 | 3 (4.5)                               | PASS                                                       |
| focus vs amber / mono / teal fill (separated by the 2px gap)                               |    1.89 / 1.37 / 1.19 |    2.58 / 2.29 / 1.39 |    2.34 / 1.10 / 1.16 |    3.97 / 1.80 / 1.26 | info only                             | info                                                       |
| hover/press boundary: teal-fill (all states) vs worst of bg, surface-1, -2, warm-bg        |                ≥ 9.72 |                ≥ 4.85 |               ≥ 12.37 |                ≥ 8.20 | 3                                     | PASS                                                       |
| hover/press boundary: light amber fill (rest → press)                                      |                     — |           2.61 → 1.88 |                     — |           2.61 → 1.88 | carried by `--lp-amber-edge` (≥ 4.45) | PASS via contour                                           |

**Halo stacking.** Two halo `box-shadow` layers on one point fail (dark text-3 4.12, edge 2.76). A
single blurred conic halo passes: every point is a mix of the two single-colour composites, and the
worst mix equals the worst single case (dark text-3 4.88, light 4.70). The recipe therefore uses one
blurred conic layer; never stack the two halo colours at one point.

### 3.4 Type scale

Sizes in px at 375 / 768 / 1280 / 1600; every clamp keeps max ≤ 2.5 × min, so 200% zoom works.

| register  | token                              | value                                        | px                  | family              | weight               | tracking | leading                                                                |
| :-------- | :--------------------------------- | :------------------------------------------- | :------------------ | :------------------ | :------------------- | :------- | :--------------------------------------------------------------------- |
| 1 Display | `--lp-fs-hero`                     | `clamp(2.5rem, 1.5rem + 4vw, 4.75rem)`       | 40 / 55 / 75 / 76   | `--lp-font-display` | `var(--fw-semibold)` | -0.03em  | 1.04 · `text-wrap: balance` · `--lp-measure-display`                   |
| 1 Display | `--lp-fs-section` (editorial)      | `clamp(2rem, 1.4rem + 2.5vw, 3.5rem)`        | 32 / 42 / 54 / 56   | `--lp-font-serif`   | `var(--fw-normal)`   | -0.012em | 1.08                                                                   |
| 1 Display | `--lp-fs-section` (precision)      | same                                         | same                | `--lp-font-display` | `var(--fw-semibold)` | -0.022em | 1.08                                                                   |
| 1 Display | `--lp-fs-figure`                   | `clamp(2.25rem, 1.6rem + 2.8vw, 4rem)`       | 36 / 47 / 61 / 64   | `--lp-font-display` | `var(--fw-medium)`   | -0.03em  | 1.0 · `tabular-nums lining-nums`                                       |
| 2 Heading | `--lp-fs-h3`                       | `clamp(1.125rem, 1.02rem + .45vw, 1.375rem)` | 18 / 20 / 22 / 22   | display sans        | `var(--fw-semibold)` | -0.01em  | 1.3                                                                    |
| 2 Heading | `--lp-fs-eyebrow`                  | `0.75rem`, uppercase                         | 12                  | `--lp-font-mono`    | `var(--fw-medium)`   | 0.1em    | 1.2 · teal-ink (precision) / amber-ink (editorial)                     |
| 3 Body    | `--lp-fs-body-lg`                  | `clamp(1.0625rem, .98rem + .3vw, 1.25rem)`   | 17 / 18 / 19.5 / 20 | `--lp-font-body`    | 400                  | -0.005em | 1.55 · `--lp-measure-lead` · text-2                                    |
| 3 Body    | `--lp-fs-body` / `--lp-fs-body-sm` | `1rem` / `.875rem`                           | 16 / 14             | body                | 400                  | 0        | 1.65 / 1.55 · `--lp-measure`                                           |
| 3 Body    | `--lp-fs-search`                   | `clamp(1rem, .95rem + .25vw, 1.125rem)`      | 16 / 17 / 18 / 18   | body                | 400                  | 0        | 1.3 · never below 16px on coarse pointers (`DESIGN_SYSTEM.md:586-587`) |
| 3 Body    | `--lp-fs-btn` / `-lg`              | `.9375rem` / `1rem`                          | 15 / 16             | body                | `var(--fw-semibold)` | -0.005em | 1                                                                      |
| 4 Meta    | `--lp-fs-meta`                     | `clamp(.75rem, .72rem + .12vw, .8125rem)`    | 12 / 12.4 / 13 / 13 | `--lp-font-mono`    | 400                  | 0        | 1.45 · `tabular-nums` · ligatures off · text-3                         |

The four registers differ by size, family, case and tracking, never by weight alone; headings stay
below `--fw-bold`. Weights alias `--fw-*`, so the dyslexic overlay collapses them automatically.

### 3.5 Radii, shadows, layout, motion

`si` means `var(--shadow-intensity)`.

| name                                                                         | dark                                                                                                                                                             | light                                                                                                                                                         | purpose                                                                                                                                                                               |
| :--------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--lp-r-xs` … `--lp-r-2xl`                                                   | `calc(4/8/12/16/24/32px * var(--radius-scale))`                                                                                                                  | same                                                                                                                                                          | Keyboard hint · small controls · cards and typeahead · rail media and stage inner · demo stage and search field · final CTA and bento                                                 |
| `--lp-r-pill` / `--lp-r-search` / `--lp-r-btn`                               | `999px` / `var(--lp-r-xl)` / `var(--lp-r-pill)`                                                                                                                  | same                                                                                                                                                          | Header pill and chips · search field · CTAs                                                                                                                                           |
| `--lp-shadow-1`                                                              | `inset 0 1px 0 rgb(255 255 255/.04), 0 1px 2px rgb(0 0 0/calc(.5*si))`                                                                                           | `0 1px 2px rgb(16 20 23/calc(.05*si)), 0 2px 6px -2px rgb(16 20 23/calc(.06*si))`                                                                             | Card at rest                                                                                                                                                                          |
| `--lp-shadow-pop`                                                            | `0 0 0 1px var(--lp-hair-strong), 0 16px 40px -8px rgb(0 0 0/calc(.65*si))`                                                                                      | `0 0 0 1px var(--lp-hair), 0 12px 32px -6px rgb(16 20 23/calc(.14*si))`                                                                                       | Typeahead and category panels                                                                                                                                                         |
| `--lp-shadow-stage`                                                          | `inset 0 1px 0 rgb(255 255 255/.06), 0 0 0 1px var(--lp-hair-strong), 0 24px 48px -12px rgb(0 0 0/calc(.7*si)), 0 64px 128px -32px rgb(40 134 144/calc(.28*si))` | `0 0 0 1px var(--lp-hair), 0 2px 4px rgb(16 20 23/calc(.04*si)), 0 12px 32px -8px rgb(16 20 23/calc(.10*si)), 0 48px 96px -24px rgb(40 134 144/calc(.20*si))` | Elevated demo stage                                                                                                                                                                   |
| `--lp-shadow-header`                                                         | `0 8px 24px -8px rgb(0 0 0/calc(.6*si))`                                                                                                                         | `0 8px 24px -10px rgb(16 20 23/calc(.12*si))`                                                                                                                 | Glass header pill                                                                                                                                                                     |
| `--lp-stage-tilt`                                                            | `perspective(2000px) rotateX(14deg) rotateZ(-1.5deg) scale(.94)`                                                                                                 | same                                                                                                                                                          | Hero theatre only; `none` below 768px, on `:focus-within`, and under both reduced-motion channels                                                                                     |
| `--lp-gutter`                                                                | `clamp(1rem, .25rem + 3.5vw, 3rem)`                                                                                                                              | same                                                                                                                                                          | Side gutter: 17 / 31 / 48 / 48px                                                                                                                                                      |
| `--lp-section-pad`                                                           | `clamp(4rem, 2.5rem + 6.5vw, 9rem)`                                                                                                                              | same                                                                                                                                                          | Section block padding: 64 / 90 / 123 / 144px                                                                                                                                          |
| `--lp-hero-pad`                                                              | `calc(var(--lp-header-h) + var(--lp-header-inset) + clamp(2.5rem, .5rem + 8vw, 8rem))`                                                                           | same                                                                                                                                                          | Hero top                                                                                                                                                                              |
| `--lp-header-h` / `--lp-header-inset`                                        | `3.5rem` / `.75rem`                                                                                                                                              | same                                                                                                                                                          | Floating pill height and top inset                                                                                                                                                    |
| `--lp-gap` / `--lp-heading-gap`                                              | `clamp(.75rem, .5rem + 1vw, 1.5rem)` / `clamp(.75rem, .55rem + .8vw, 1.25rem)`                                                                                   | same                                                                                                                                                          | Grid and rail gap · eyebrow → display → lead                                                                                                                                          |
| `--lp-stack-2xs` … `--lp-stack-3xl`                                          | `var(--space-1)` … `var(--space-8)`                                                                                                                              | same                                                                                                                                                          | Vertical rhythm                                                                                                                                                                       |
| `--lp-maxw` / `--lp-maxw-wide` / `--lp-maxw-text`                            | `76rem` / `90rem` / `44rem`                                                                                                                                      | same                                                                                                                                                          | Content · hero theatre · text column                                                                                                                                                  |
| `--lp-measure` / `--lp-measure-lead` / `--lp-measure-display`                | `var(--measure)` / `56ch` / `18ch`                                                                                                                               | same                                                                                                                                                          | Reading measures                                                                                                                                                                      |
| `--lp-dur-press` / `-fast` / `-base` / `-slow`                               | `50ms` / `140ms` / `220ms` / `360ms`                                                                                                                             | same                                                                                                                                                          | Press-in · hover and colour · tabs, panels, stage swap, typeahead and the How it works step reveal (inside L3's 150–250ms) · the theatre's tilt release only                          |
| `--lp-dur-reveal` / `-demo` / `-demo-hold` / `-ring` / `--lp-stagger`        | `600ms` / `900ms` / `1600ms` / `6000ms` / `50ms`                                                                                                                 | same                                                                                                                                                          | Section entrance only (never the step reveal) · one simulated step · pause between steps · one ring turn (≤ 3 turns, hover/focus only) · stagger                                      |
| `--lp-ease-out` / `-standard` / `-in-out` / `-exit` / `-linear`              | `cubic-bezier(.16,1,.3,1)` / `cubic-bezier(.2,0,0,1)` / `cubic-bezier(.65,0,.35,1)` / `cubic-bezier(.4,0,1,1)` / `linear`                                        | same                                                                                                                                                          | No overshoot anywhere                                                                                                                                                                 |
| `--lp-reveal-distance` / `--lp-press-scale`                                  | `12px` / `.96` (L2's `scale(0.96)`)                                                                                                                              | same                                                                                                                                                          | Both become `0px` / `1` under either reduced-motion channel                                                                                                                           |
| `--lp-mask-ink` / `--lp-mask-keep` / `--lp-mask-clear`                       | `#000` / `#fff` / `#000`                                                                                                                                         | same                                                                                                                                                          | Mask stops, never painted: the opaque stop of every CSS alpha mask (grid fade, lit grid, bottom fade) and the keep / clear fills of the SVG luminance mask that draws the quiet zones |
| `--lp-fade-mask` · `--lp-calm-half` / `--lp-calm-feather` · `--lp-calm-mask` | `linear-gradient(to bottom, ink 50%, transparent 92%)` · `min(50%, 30rem)` / `4rem` · a horizontal mask clearing the centre column (± half, feathered)           | same                                                                                                                                                          | The constellation layers' bottom fade; the conservative centre column the static constellation clears until the island has measured its quiet zones (no JS, before hydration)         |

### 3.6 Recipes

**Theme keying.** The selectors mirror the app's exactly (`_app.tsx:34-56`). `.lp-portal` goes on
the root of any panel `BodyPortal` moves to `<body>` (the current hero search portals at
`SearchBar.island.tsx:193`), so `--lp-*` resolves there too. Colour tokens are declared only in the
mode and HC blocks; type, motion and layout tokens only in the base block.

```css
@property --lp-ring-angle {
	syntax: "<angle>";
	inherits: false;
	initial-value: 0deg;
}

/* LIGHT (#8 airy) — the app's :root default (no attribute, or data-theme="light") */
.lp-root,
.lp-portal {
	color-scheme: light;
	--lp-bg: #F6F8F8; /* …light column + type, radii, layout, motion… */
	--lp-canvas-paint:
		radial-gradient(60% 50% at 12% 0%, var(--lp-wash-teal), transparent 70%),
    radial-gradient(50% 45% at 88% 4%, var(--lp-wash-amber), transparent 70%),
    linear-gradient(var(--lp-bg), var(--lp-bg-end) 60%);
}
/* DARK (#1 precision) */
:root[data-theme="dark"] :is(.lp-root, .lp-portal) {
	color-scheme: dark;
	--lp-bg: #07090A; /* …dark column… */
	--lp-canvas-paint: var(--lp-bg);
}
/* HIGH CONTRAST — OS channel, mirrors _app.tsx:38-47 (mode-qualified so light can never override dark) */
@media (prefers-contrast: more) {
	:root:not([data-theme="dark"]):not([data-contrast="normal"]) :is(.lp-root, .lp-portal) {
		/* light HC */
	}
	:root[data-theme="dark"]:not([data-contrast="normal"]) :is(.lp-root, .lp-portal) {
		/* dark HC */
	}
}
/* HIGH CONTRAST — in-app channel, mirrors _app.tsx:49-56 */
:root:not([data-theme="dark"])[data-contrast="high"] :is(.lp-root, .lp-portal) {
	/* light HC */
}
:root[data-theme="dark"][data-contrast="high"] :is(.lp-root, .lp-portal) {
	/* dark HC */
}
```

**Reduced motion — both channels.**

```css
@media (prefers-reduced-motion: reduce) {
	:root :is(.lp-root, .lp-portal) {
		--lp-dur-press: 0ms;
		--lp-dur-fast: 0ms;
		--lp-dur-base: 0ms;
		--lp-dur-slow: 0ms;
		--lp-dur-reveal: 0ms;
		--lp-dur-demo: 0ms;
		--lp-dur-demo-hold: 0ms;
		--lp-dur-ring: 0ms;
		--lp-stagger: 0ms;
		--lp-reveal-distance: 0px;
		--lp-press-scale: 1;
	}
}
:root[data-motion="reduced"] :is(.lp-root, .lp-portal) {
	--lp-dur-press: 0ms;
	--lp-dur-fast: 0ms;
	--lp-dur-base: 0ms;
	--lp-dur-slow: 0ms;
	--lp-dur-reveal: 0ms;
	--lp-dur-demo: 0ms;
	--lp-dur-demo-hold: 0ms;
	--lp-dur-ring: 0ms;
	--lp-stagger: 0ms;
	--lp-reveal-distance: 0px;
	--lp-press-scale: 1;
}
/* end-state transforms go to none (the #174(D) / gate-12 precedent); hidden start states only when BOTH allow motion */
@media (prefers-reduced-motion: reduce) {
	.lp-theatre,
	.lp-reveal,
	:is(.lp-btn, .lp-search__submit, .lp-chip, .lp-tab):active {
		transform: none;
	}
}
:root[data-motion="reduced"] :is(.lp-theatre, .lp-reveal),
:root[data-motion="reduced"] :is(.lp-btn, .lp-search__submit, .lp-chip, .lp-tab):active {
	transform: none;
}
@media (prefers-reduced-motion: no-preference) {
	:root:not([data-motion="reduced"]) .lp-reveal:not(.is-in) {
		opacity: 0;
		translate: 0 var(--lp-reveal-distance);
	}
}
```

- **JS gate** (WebGL, spotlight follow, demo autoplay, typewriter):
  `matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduced"`,
  re-checked on the media query's `change` event and by a MutationObserver on `data-motion` /
  `data-theme` / `data-contrast` / `data-cvd` (as
  `apps/web/features/wallet/core/aurora-runtime.ts:80,405-406` does). The existing `SearchBar`
  typewriter checks only `matchMedia` — the landing must not copy that.
- **WebGL gate**, in addition: WebGL2 available, `deviceMemory ≥ 4` (or unknown on desktop),
  `hardwareConcurrency > 4`, no Save-Data, the hero intersecting, after first paint on
  `requestIdleCallback`; a frame-time watchdog tears it down.

**Dyslexic overlay inside `lp-`.**

```css
:root[data-font="dyslexic"] :is(.lp-root, .lp-portal) {
	--lp-font-display: var(--font-sans);
	--lp-font-serif: var(--font-sans);
	--lp-font-body: var(--font-sans);
	--lp-font-mono: var(--font-mono);
	--lp-fs-hero: clamp(2.25rem, 1.35rem + 3.6vw, 4.25rem); /* the face runs wide */
	--lp-track-hero: 0em;
	--lp-track-section: 0em;
	--lp-track-figure: 0em;
	--lp-track-h3: .01em;
	--lp-track-body: var(--tracking-normal);
	--lp-track-meta: var(--tracking-normal);
	--lp-track-eyebrow: var(--tracking-wide);
	--lp-lead-hero: 1.2;
	--lp-lead-section: 1.25;
	--lp-lead-h3: 1.45;
	--lp-lead-body-lg: 1.75;
	--lp-lead-body: var(--leading-normal);
	--lp-measure: var(--measure);
	--lp-measure-lead: var(--measure-narrow);
}
```

The `lp-` tracking tokens override `body`'s letter-spacing, so they are remapped here; ligatures-off
and italic-to-weight still inherit from `index.css:995-1011`.

**Colour-blind and forced colours.**

```css
/* value-scoped, never bare [data-cvd] — the client writes data-cvd="none" (context.ts:142) */
:root:is([data-cvd="protan"], [data-cvd="deutan"], [data-cvd="tritan"]) .lp-card--refused {
	background-image: repeating-linear-gradient(135deg, var(--lp-refuse-edge) 0 1px, transparent 1px
		6px);
}
@media (forced-colors: active) {
	.lp-bg,
	.lp-bg__spot,
	.lp-search::after,
	.lp-constellation {
		display: none;
	}
	.lp-search::before {
		background: CanvasText;
	}
	.lp-header::before {
		backdrop-filter: none;
		background: Canvas;
	}
}
```

**B7 grid + spotlight, B10 grain** (background stack, under content).

```css
.lp-hero {
	position: relative;
	isolation: isolate;
}
.lp-bg {
	position: absolute;
	inset: 0;
	z-index: -1;
	overflow: clip;
	contain: strict;
	pointer-events: none;
	background: var(--lp-canvas-paint);
}
.lp-bg::before {
	content: "";
	position: absolute;
	inset: 0; /* base grid, faded to the edges */
	background-image: linear-gradient(to right, var(--lp-grid-line) 1px, transparent 1px),
		linear-gradient(to bottom, var(--lp-grid-line) 1px, transparent 1px);
	background-size: var(--lp-grid-size) var(--lp-grid-size);
	background-position: center top;
	mask-image: radial-gradient(ellipse 70% 60% at 50% 30%, #000 30%, transparent 75%);
}
.lp-bg::after {
	content: "";
	position: absolute;
	inset: 0;
	opacity: var(--lp-grain-opacity); /* B10, static */
	background-size: var(--lp-grain-size);
	background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
/* a sized layer moved by translate (compositor only); physical left/top because the pointer writes physical px */
.lp-bg__spot {
	position: absolute;
	left: 0;
	top: 0;
	inline-size: calc(var(--lp-spot-r) * 2);
	aspect-ratio: 1;
	translate: calc(var(--lp-spot-x) - var(--lp-spot-r)) calc(var(--lp-spot-y) - var(--lp-spot-r));
	background: radial-gradient(closest-side, var(--lp-spot), transparent);
	will-change: translate;
}
```

Pointer handling: a passive `pointermove`, applied once per animation frame through
`host.style.setProperty('--lp-spot-x', x + 'px')`, only under `(hover: hover) and (pointer: fine)`
with neither reduced-motion channel on. The spotlight stops following the pointer (and `--lp-spot-x`
/ `--lp-spot-y` return to their SSR values) while the B1 canvas is mounted, so B1, the spotlight and
the hero timeline never move at once (§2.7). Grain is a background layer below content (text pixels
stay clean, no full-viewport `mix-blend-mode`; `img-src data:` allows it, `csp.ts:78`).

**B9 glow ring and single-layer halo on the search field.**

```css
.lp-search {
	position: relative;
	isolation: isolate;
	border-radius: var(--lp-r-search);
	background: var(--lp-surface-1);
	box-shadow: var(--lp-shadow-1);
}
.lp-search::before {
	content: "";
	position: absolute;
	inset: 0;
	z-index: 1;
	pointer-events: none; /* the ring */
	padding: var(--lp-ring-w);
	border-radius: inherit;
	background: conic-gradient(from var(--lp-ring-angle), var(--lp-glow-stop-a),
		var(--lp-glow-stop-b), var(--lp-glow-stop-a));
	background: conic-gradient(from var(--lp-ring-angle) in oklab, var(--lp-glow-stop-a),
		var(--lp-glow-stop-b), var(--lp-glow-stop-a));
	-webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
	-webkit-mask-composite: xor;
	mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
	mask-composite: exclude;
}
.lp-search::after {
	content: "";
	position: absolute;
	inset: 0;
	z-index: -1;
	pointer-events: none; /* ONE halo layer */
	border-radius: inherit;
	filter: blur(var(--lp-halo-blur));
	background: conic-gradient(from var(--lp-ring-angle), var(--lp-glow-amber), var(--lp-glow-teal),
		var(--lp-glow-amber));
}
@keyframes lp-ring-turn {
	to {
		--lp-ring-angle: 360deg;
	}
}
@media (prefers-reduced-motion: no-preference) {
	:root:not([data-motion="reduced"]) .lp-search:is(:hover, :focus-within) {
		animation: lp-ring-turn var(--lp-dur-ring) var(--lp-ease-linear) 3;
	}
}
```

`@property` registers on the element, so the animation sits on `.lp-search`, not the pseudos. Under
reduced motion the ring is a static gradient (the B9 fallback). The sRGB fallback midpoints also
pass (dark ≈ `#B0BD99`, light ≈ `#616A44`).

**Elevated stage and hero theatre.**

```css
.lp-stage {
	border-radius: var(--lp-r-xl);
	background: var(--lp-surface-1);
	box-shadow: var(--lp-shadow-stage);
	padding: clamp(.5rem, .25rem + 1vw, 1rem);
	container-type: inline-size;
}
.lp-stage__frame {
	border-radius: var(--lp-r-lg);
	background: var(--lp-surface-2);
	overflow: clip;
}
.lp-theatre {
	transform: var(--lp-stage-tilt);
	transform-origin: 50% 0;
	transition: transform var(--lp-dur-slow) var(--lp-ease-out);
}
.lp-theatre:focus-within {
	transform: none;
}
@media (max-width: 767px) {
	.lp-theatre {
		transform: none;
	}
}
```

Inside the frame the real `@projective/ui` board keeps the app's own tokens so the mock matches the
product (#280 flag c).

**Glass header pill** (glass on `::before`).

```css
.lp-header {
	position: sticky;
	inset-block-start: var(--lp-header-inset);
	z-index: 10;
	isolation: isolate;
	margin-inline: auto;
	inline-size: min(100% - 2 * var(--lp-gutter), var(--lp-maxw));
	block-size: var(--lp-header-h);
	border-radius: var(--lp-r-pill);
}
.lp-header::before {
	content: "";
	position: absolute;
	inset: 0;
	z-index: -1;
	border-radius: inherit;
	background: color-mix(in srgb, var(--lp-surface-1) var(--lp-glass-veil), transparent);
	-webkit-backdrop-filter: blur(var(--lp-glass-blur)) saturate(var(--lp-glass-saturate));
	backdrop-filter: blur(var(--lp-glass-blur)) saturate(var(--lp-glass-saturate));
	box-shadow: inset 0 0 0 1px var(--lp-hair-strong), var(--lp-shadow-header);
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
	.lp-header::before {
		background: var(--lp-surface-1);
	}
}
```

Only `--lp-text`, `--lp-text-2` and `--lp-teal-ink` sit on glass; header buttons are opaque fills.

**Focus — two options; the owner chooses (#280 flag b). L1 ships neither until then.**

```css
/* (A) visible ring — overrides apps/web/styles/global.css:263-282 for the lp scope only */
.lp-root :is(a[href], button, summary, [tabindex]:not([tabindex="-1"])):focus-visible,
.lp-portal :is(a[href], button, [tabindex]:not([tabindex="-1"])):focus-visible {
	outline: var(--lp-focus-w) solid var(--lp-focus) !important;
	outline-offset: var(--lp-focus-offset) !important;
}
/* (B) directive-compliant — no outline or box-shadow: border colour, surface tint and underline */
.lp-root :is(.lp-chip, .lp-tab, .lp-btn--outline):focus-visible {
	border-color: var(--lp-focus);
	background: var(--lp-surface-3);
}
.lp-root a:focus-visible {
	text-decoration: underline 2px var(--lp-focus);
	text-underline-offset: 3px;
}
```

**Constellation (B1 WebGL2 and its static SVG fallback).** Colours read back from the tokens with
`getComputedStyle` (no literals). Nodes and links ≤ `--lp-node-alpha-quiet` inside the copy column's
box (+24px), 0 inside the search halo box, each pixel's luminance clamped to `--lp-bg-lum-max`. Fade
in with `opacity` only. Never mounted under either reduced-motion channel, Save-Data,
`deviceMemory < 4` or `hardwareConcurrency ≤ 4`. Shaders are tagged template strings in
`features/landing/core/shaders/*.ts`; no dependency (#280). LandingBackground reflects its state as
`data-lp-bg="webgl|static"` and `data-lp-bg-reason` on `.lp-root` (the wallet aurora's rule,
`DESIGN_SYSTEM.md:927-938`), and the Dev Context Switcher's `landingBackground` axis forces either
path (§6).

### 3.7 Selector and attribute map

| concern                                          | selector / attribute                                                                              | where                                                                                 |
| :----------------------------------------------- | :------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------ |
| Light (default) app tokens                       | `:root`                                                                                           | `apps/web/routes/_app.tsx:35`                                                         |
| Dark app tokens                                  | `:root[data-theme="dark"]`                                                                        | `_app.tsx:36`; `packages/ui/styles/index.css:911`                                     |
| Theme written before first paint                 | inline script: `localStorage "theme"` or `prefers-color-scheme`                                   | `_app.tsx:116-122`                                                                    |
| Theme written and read at runtime                | `el.dataset.theme = cfg.mode` / `data.theme === "dark"`                                           | `packages/ui/system/core/context.ts:139` / `:159`                                     |
| High contrast, OS                                | `@media (prefers-contrast: more) { :root:not([data-contrast="normal"]) … }`                       | `_app.tsx:38-47`; `index.css:915-923`                                                 |
| High contrast, in-app                            | `:root[data-contrast="high"]`, `:root[data-theme="dark"][data-contrast="high"]`                   | `_app.tsx:49-56`; `index.css:890, 925, 929`                                           |
| HC attribute writers                             | server writes only when on / client writes `"high"` or `"normal"`                                 | `apps/web/utils/a11y-context.ts:115` / `context.ts:140`                               |
| Dyslexic                                         | `:root[data-font="dyslexic"]`                                                                     | `index.css:965-1011`; writers `a11y-context.ts:116`, `context.ts:141`                 |
| Reduced motion, OS                               | `@media (prefers-reduced-motion: reduce)` (zeroes `--dur-*`, kills transitions and animations)    | `index.css:1307-1323`                                                                 |
| Reduced motion, in-app                           | `:root[data-motion="reduced"]` (same)                                                             | `index.css:1329-1342`; writers `a11y-context.ts:118`, `context.ts:143`                |
| Colour-blind                                     | `:root[data-cvd="protan\|deutan\|tritan"]`, value-scoped                                          | `context.ts:142`; precedent `features/workspaces/styles/workspace-tokens.css:430-440` |
| Theme crossfade (applies to `lp-` automatically) | `*, *::before, *::after { transition: color/background-color/border-color/fill var(--dur-slow) }` | `index.css:1296-1305`                                                                 |
| Focus suppression                                | token overrides · element `outline/box-shadow: none !important` · field glow · portal ring        | `apps/web/styles/global.css:245-255` · `:263-282` · `:337-345` · `:356-367`           |
| Portal host                                      | `data-ui-portal` on the `<body>` child                                                            | `packages/ui/overlay/components/BodyPortal.tsx:35`                                    |
| `/` search shortcut                              | `isFocusSearchShortcut` (+ skip `isEditableTarget`)                                               | `apps/web/features/shell/core/shortcuts.ts:32-38, 57-61`                              |

---

## 4. Copy deck

Rules (#283): reading age 12–14; one idea per sentence; no unexplained acronyms; verbs over nouns;
every demo caption under 15 words. `[A1]` tags point at §5; a sentence without a tag is a label, a
CTA or the page describing its own controls (verified by L2/L3 tests, not the claims table).

**Placeholders.** `{platformFee}` is formatted from `platform_fee_bp` (renders "5%" today; never
hard-coded). Every after-fee amount is a computed placeholder, never a literal: `{net(minor)}` and
`{fee(minor)}` from `platformFeeFor()` (floors like SQL); `{fairExit(minor, tier).payout}` /
`.refund` from the `fn_fair_exit_split` mirror; `{vault}` and `{shares}` from the
`fn_team_split_plan` mirror. The literal figures live only in §5's arithmetic (C4, C5, F5, N2–N5).
If the fee is unavailable, drop each fee clause — how it works 5, V1 frame 5 and its live region, V2
frame 3 and FAQ 2's example fall back to "The team is paid" — and hide the calculator, the worked
and rounding examples, the Fair Exit figures and V5's amounts. Live metrics:
`{totalValueProtected}`, `{stagesDelivered}`, `{medianFundingToApprovalHours}`, `{asOf}`. Money is
GBP, en-GB, pinned with `displayCurrency="GBP"` and `table={null}` (`MoneyView`).

**Banned in page copy:** squad, micro-agency, TVL, CREATE, KYC/KYB, IP, "release", "only paid when
you approve", "until you approve", "virus-checked", "instant payout", "next card", "No bidding".
**"Escrow"** appears only in the §4.6 explainer line, the FAQ, the meta description and the FAQPage
JSON-LD.

### 4.0 Shell, header, meta

| Slot                      | Guest                                                                                                                           | Signed in                            |
| :------------------------ | :------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------- |
| Logo                      | "Projective", link `/`, `aria-label` "Projective home"                                                                          | same                                 |
| Nav (`aria-label` "Main") | "How it works" `/#how-it-works` · "Explore" `/explore` · "Pricing" `/#pricing` · "Features" `/features` (hidden until L5 ships) | same                                 |
| Actions                   | ThemeToggle (existing label) · "Sign in" `/login` · "Get started" `/join`                                                       | ThemeToggle · **"Open app"** `/home` |

- Skip link "Skip to main content" → `#main-content`.
- `<title>`: **Projective — Hire a ready-made team with payment protection** `[A1]` `[B1]`
- meta description: **Hire a ready-made team and pay one stage at a time. Payment protection
  (escrow) holds your money safely, and the team is paid when you approve.** `[A1]` `[A2]` `[B1]`
  `[B2]`
- og:title / twitter:title: **Hire a ready-made team with payment protection** `[A1]` `[B1]`
  (`_app.tsx` renders no og:/twitter: tags today; L1/L4 add them for `/` and `/features`.)
- og:description / twitter:description: **Search freelancers, teams and services. Pay for each stage
  before it starts. The team is paid when you approve.** `[U1]` `[B3]` `[B2]`
- JSON-LD: Organization; WebSite with SearchAction → `{origin}/explore?q={search_term_string}`, the
  origin from `serverEnv().appUrl` (not the hard-coded `https://projective.app` in `seo.ts:23`);
  FAQPage with text identical to §4.10. **Drop** the SoftwareApplication `offers {price:"0"}` (no
  proof; §5.1).

### 4.1 Hero (`id="hero"`)

**Eyebrow (optional):** Ready-made teams · Payment protection `[A1]` `[B1]`

**Headline options**

| #                   | h1                                                                 | Subline                                                                                                                               | Note                                                                                                                                                                  |
| :------------------ | :----------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — RECOMMENDED** | **Hire a ready-made team. Pay one stage at a time.** `[A1]` `[A2]` | **Search for a team that's already formed. Work starts only once it's paid for. They're paid when you approve.** `[A3]` `[B3]` `[B2]` | Names both differentiators, keeps "team" in the h1 and leads into the search bar; "held safely" never sits directly before "paid when you approve" here (#281 flag f) |
| 2                   | One team for each stage. `[A8]`                                    | Hire a ready-made team that applies, works and gets paid together. Work starts only once it's paid for. `[A4]` `[B3]`                 | Strong on teams, silent on safety in the h1                                                                                                                           |
| 3                   | Find your team. Keep your money safe. `[B1]`                       | Search freelancers, teams and services. Each stage's money is held safely. The team is paid when you approve. `[U1]` `[B1]` `[B2]`    | Strong on search, weaker on what makes it different                                                                                                                   |

**Search bar** (`role="search"`; no-JS form `action="/explore" method="get"`, fields `q`,
`category`)

- Label (visually hidden): "Search freelancers, teams, services and projects"
- Category picker: a native select, `aria-label` "Search in" (it announces its own value, so the
  name never repeats it; #287); on mobile an icon button, `aria-label` "Choose what to search (now:
  {label})", sheet title "Search in", close "Close". Options: **All** → `all` · **Freelancers &
  teams** → `freelancers` · **Services** → `services` · **Projects** → `projects` · **Businesses** →
  `businesses`. No **Products** option until digital-product delivery ships (W2): a product bought
  today is paid for but never delivered (wave 8 C1, #281 flag k).
- Static placeholder (screen readers, no JS, both reduced-motion channels): **Search teams, services
  and projects** `[U1]`
- Typewriter overlay (`aria-hidden`; off under either reduced-motion channel): "Try “brand
  identity”" · "Try “landing page”" · "Try “design system”" · "Try “motion design”" · "Try “mobile
  app”" `[U2]`. Source: 4–6 derived at SSR from the live `home.recommended.*[].title`; this list is
  the fallback, and each fallback term renders only when `suggest()` returns a hit for it at SSR.
  With none left, the typewriter stays off and the static placeholder shows.
- Submit: **Search**. Shortcut hint: `/` "to search", `aria-keyshortcuts="/"` on the input, hidden
  on touch-only devices; never ⌘K (#282).
- Suggested chips: label "Try:" (never "Popular:"; `--lp-text-2`),
  `<nav aria-label="Suggested searches">`, terms SSR'd from `suggest({q:"",scope:"all"}).trending`
  (fallback: the typewriter terms that survived the SSR check), each → `explorePath('all', term)`;
  an empty list omits the row (known at SSR, no CLS). `[U3]`
- Dropdown sections: **Recent searches** (remove button `aria-label` "Remove “{term}” from recent
  searches", beside its option; the option's description "Press Delete to remove", referenced and
  never read out on its own; footer "Clear recent searches") · **Trending** · **People & teams** ·
  **Services** · **Projects** (no **Products** section until W2 ships).
- Rows and states: "Search Explore for “{q}”" · **No matches — search anyway** (accessible name "No
  matches for “{q}”. Search anyway") · "Searching…" (polite) · "{n} suggestions. Use the up and down
  arrows to choose." · failure: "Suggestions aren't available right now. Press Enter to search."

**CTAs** (per viewer; `userContext` from `ctx.state`)

| Label                 | Guest                     | Signed-in client  | Signed-in freelancer                              | Restricted (13–17) |
| :-------------------- | :------------------------ | :---------------- | :------------------------------------------------ | :----------------- |
| **Hire a team**       | `explorePath('teams')`    | same              | same                                              | same               |
| **Offer your skills** | `/join?intent=freelancer` | `/become-partner` | becomes **Find work** → `explorePath('projects')` | hidden             |

`/become-partner` is auth-guarded (a guest would bounce through `/login`), hence the guest mapping
(#284 flag).

**Hero theatre (V1 loop)** — a
`<figure role="img" aria-label="Example board: work starts once a task is paid for.">` whose board
subtree is `inert`; no `aria-hidden`, no figcaption. `[B3]` Fixture: board "Website refresh"; lanes
New · Ready · In Progress · Review · Completed (the project board's Statuses view, `[K1]`: "Fund
all" is that view's action, a stage's Tasks board reading "Fund stage"; #287); cards "Launch emails"
(Draft), "Logo v2" (Needs funding), "Homepage design" (In Progress, no tag: its lane says it, as on
the product's card; FLAG #287 (C)), "Case study" (in Review), "Brand colours" (Completed, Team
paid); header "1 task needs £400 to start" with "Fund all" `[K8]`. Static mid-state frame when
motion is off.

- Theatre link: **Try it yourself** → `/?demo=board#demo` (all widths), rendered once L3's demo
  stage renders `#demo` (#287).
- Toggle (from `--bp-md`, outside the inert figure): **Pause the example**, `aria-pressed`; stops
  the typewriter and the board loop (§2.7).

### 4.2 Why it's different (`id="why-different"`)

- h2: **One team, not five strangers.** `[A1]`
- H2 subtitle (the glossary's one allowed place): Team-as-a-service, made simple.
- Columns: **The old way** / **With Projective**

| Row              | The old way                                 | With Projective                                                              |
| :--------------- | :------------------------------------------ | :--------------------------------------------------------------------------- |
| Who you hire     | Five freelancers, hired one by one. `[Z1]`  | One ready-made team. They apply, work and get paid together. `[A4]`          |
| How it's priced  | Open-ended hourly billing. `[Z2]`           | A fixed price per stage, agreed before work starts. `[B7]`                   |
| When money moves | Pay up front for the whole job. `[Z3]`      | Pay one stage at a time. The team is paid when you approve it. `[A2]` `[B2]` |
| Keeping track    | Chase updates across email and chat. `[Z4]` | See every task on one board, from New to Completed. `[K1]`                   |
| Team pay         | Work out who gets what by hand. `[Z5]`      | Team pay splits automatically into each agreed share. `[N1]`                 |

### 4.3 How it works (`id="how-it-works"` — keep this exact id)

- h2: **How it works** · subline: From search to payday in six steps.

1. **Find your team.** Search for a ready-made team, or post your own project. `[A3]` `[L5]`
2. **Pay for the first stage.** Your money is held safely. Work only starts once it's paid for.
   `[B1]` `[B3]`
3. **The team gets to work.** Each task moves across its stage's board, from Ready to Review. `[K1]`
4. **Review the work.** Not quite right? Ask for changes. `[M1]` If the free rounds run out, extra
   rounds can be paid for where the terms offer them. `[M2]`
5. **Approve and pay.** The team is paid, minus the {platformFee} fee. `[B2]` `[C1]` Does the task
   have a next stage? Your wallet pays for it straight away when your balance covers it. You can
   switch this off for any stage. `[D1]` — without the fee: "The team is paid."
6. **The team withdraws.** Their money clears in 7 days. Then they withdraw it to their bank. `[E1]`
   `[E2]`

- Link: "See it work" → `#demo`. Art: §8.

### 4.4 Demo stage (`id="demo"`, `?demo=board|payments|booking|splits`)

- Eyebrow: See it work · h2: **See a project run, step by step.**
- Stage note (always visible): **Example only. No real money moves.** `[P9]`
- Role note: "You play both sides: the client pays and approves; the freelancer starts the work."
- Controls: "Start again" (`aria-label` "Reset the example"); frame mode "Previous step" / "Next
  step" / "Step {n} of {total}"; link **See everything Projective does →** `/features`.
- Tabs: **Work board** · **Payment protection** · **Booking** · **Team pay**

**Work board (`board`)**

- Caption (12 words): Work only starts once it's paid for. Approve, and it moves on. `[B3]` `[D1]`
- SSR description: Every job you post runs on a board. Work only starts on a task once it's paid
  for. Approve a stage, and the task moves on to its next stage. `[K1]` `[K3]` `[D1]`
- Poster alt: "Example work board with five columns."
- Frames (fixture "Homepage design", a £2,000 stage):
  1. “Homepage design” waits in Ready. Its tag says Draft. `[K2]`
  2. The freelancer tries to start it. Your wallet is short, so the board says no. The tag changes
     to Needs funding. `[K3]`
  3. You pay for the stage. The tag changes to Funded. `[K4]`
  4. Work starts. The task moves to In Progress, then Review. `[K5]`
  5. You approve. The team receives {net(200000)} after the {platformFee} fee. `[C4]` — without the
     fee: "You approve. The team is paid."
  6. The task moves to its next stage, paid for from your wallet. `[D1]` — second line: If your
     wallet is short, it waits until you pay for it. `[D2]`
- Microcopy: drag hint "Drag a card to try starting it." · keyboard help "To move a card: Space to
  pick up, arrow keys to move, Enter to drop, Escape to cancel." · refusal **"Needs funding. Pay for
  this stage before work starts."** `[K3]` · client drops an unclaimed card: "A freelancer starts
  this task by claiming it." `[K6]` · approve button **Approve and pay** · paid moment "Team paid ·
  clears in 7 days" `[E1]`.
- Live region: "Moved “{card}” to {lane}." · "Can't start “{card}” yet. It needs funding first." ·
  "Paid for “{card}”. It can start now." · "Approved. The team receives {net(200000)}. It clears in
  7 days." (without the fee: "Approved. The team is paid. It clears in 7 days.")

**Payment protection (`payments`)**

- Caption (12 words): Your money is held safely. The team is paid when you approve. `[B1]` `[B2]`
- SSR description: Follow a £5,000 project in three stages. Each stage's money is held safely before
  work starts. When you approve, the team is paid, minus the {platformFee} fee. `[B6]` `[B3]` `[B2]`
  `[C1]`
- Fixture: wallet £5,000; stages £1,500 / £2,000 / £1,500. Stepper: Held safely → You approve → Team
  paid → Clears in 7 days → Withdraw to bank.
- Frames:
  1. You pay £1,500 for Stage 1. It's held safely, marked Funded. `[K4]` — second line: Your wallet
     goes down by exactly £1,500, with no fee on top. `[C2]`
  2. The team works. Your money stays held. `[B1]`
  3. You approve. The team receives {net(150000)} after the {platformFee} fee. `[C4]` — without the
     fee: "You approve. The team is paid."
  4. Their money clears in 7 days. Then they withdraw it to their bank. `[E1]` `[E2]`
  5. Stage 2 is paid for from your wallet, so work keeps going. `[D1]`
  6. Work stopped on Stage 2? Pick 25%, 50% or 75% done. `[F2]` — second line: At 50%: the team gets
     {fairExit(200000, 50).payout}. You get {fairExit(200000, 50).refund} back, fee-free. `[F5]`
- Fair Exit controls: toggle "Try Fair Exit"; radio label "How much of the stage was done?"; results
  "Team receives {x} · clears in 7 days" / "Back to you {y} · straight away, no fee" `[F3]` `[F4]`;
  the stage then reads "Cancelled" `[F6]`. Figures on £2,000 are `{fairExit(200000, 25 | 50 | 75)}`
  (payout / refund); §5 F5 carries today's arithmetic. `[F5]`
- Withdraw outcome: "Withdrawal started. Stripe sends it to the bank." `[E2]` · wallet labels
  "Clearing · 7 days" → "Available" `[E1]`.

**Booking (`booking`)**

- Caption (13 words): Pick a time in your time zone. Moving a group session? Attendees vote. `[J8]`
  `[J10]`
- SSR description: Pick a session time from the freelancer's live availability, shown in your time
  zone. Moving a group session? Offer new times, and it moves only if more than half agree. `[J8]`
  `[J10]`
- Fixture: you in London, the freelancer in New York; frames 4–5 switch to a group session with
  three attendees plus the host.
- Frames:
  1. Times show in your time zone. We tell you the freelancer's too. `[J8]`
  2. Taken times stay on the list, greyed out. `[J9]` (the demo shows no visible reason; as in the
     product, the reason is in the slot's accessible name only)
  3. Pick 3 pm. The session is booked, and your payment is held. `[J2]`
  4. Group session? The host offers two new times. Three attendees vote. `[J10]`
  5. Two of three pick Thursday. More than half agree, so it moves when voting closes. `[J10]`
  6. Add it to Google Calendar, Outlook or any calendar app. `[J12]`
- Microcopy: "Times shown in your time zone (London). The freelancer is in New York." `[J8]` · "Book
  3:00 pm" · "Propose a new time" · tally "{votes} of {eligible} votes · needs {quorum}" · outcomes
  "Moved to Thu 3:00 pm" / "No majority. The original time stands." `[J10]` · lockout "Too late to
  move this. It starts in under 12 hours." `[J11]`

**Team pay (`splits`)**

- Caption (12 words): Approve a stage and the team's pay splits into each agreed share. `[N1]`
- SSR description: See a £2,000 stage payment reach a three-person team. The {platformFee} fee comes
  off, then the team's vault share. The rest splits into each member's agreed share, to the penny.
  `[C1]` `[N1]` `[N4]`
- Fixture: Owner, Designer, Developer; vault 10% (a fixed fixture value, never a control).
- Frames:
  1. A £2,000 stage is approved. The {platformFee} fee leaves {net(200000)}. `[C4]`
  2. The team keeps 10% in its shared vault: {vault}. `[N2]`
  3. The rest splits three ways: {shares}. `[N3]` (shown as 33.34% / 33.33% / 33.33%)
  4. Any spare penny goes to the vault. It all adds up. `[N4]` (the vault then shows {vault} plus
     the dust)
  5. Try custom shares: 50%, 30% and 20%. Watch the amounts change. `[N5]` ({shares}; the vault
     unchanged)
  6. Each share clears in 7 days. Then members can withdraw it. `[E1]` `[E2]`
- Controls: radios **Example even split** / **Custom split** (a real team's stakes are whatever its
  money manager set, `[N1]`); a fixed line, not a control: **This team keeps 10% in its vault.**
  `[N2]`; validation "Shares must add up to 100%." `[N5]`; row format "{role} · {pct} · {amount} ·
  clears in 7 days".
- Static text, not a control: **Coming soon with Pro Team: a finder's fee, or paying everything into
  the team vault.** `[N8]`

### 4.5 Ways to work (`id="ways-to-work"`)

- h2: **Work the way you want.** · subline: Pick a single job, an ongoing workflow or a live
  session. `[L4]`

| Tile                    | Body                                                                                                                                                                                                                                               | Link label → target                                                                                              |
| :---------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| **A single job**        | One clear piece of work, delivered in milestones. Each milestone is paid for as it starts. `[L1]`                                                                                                                                                  | "Post a single job" → `/projects?create=1` (the Quick-Init modal; a guest signs in and returns via `redirectTo`) |
| **An ongoing workflow** | Ongoing work, task by task, across several stages. Each task is paid for when someone picks it up. `[L2]` `[K7]`                                                                                                                                   | "Browse ongoing work" → `/explore?category=services&model=Pipeline`                                              |
| **A live session**      | Book time with an expert: one session, a block, or a seat in a group. `[J1]` Your payment is held. It goes to them 24 hours after each session ends, unless you report a no-show. For a group seat, that's 24 hours after the last session. `[J2]` | "Browse live sessions" → `/explore?category=services&model=Session&model=Group+Session`                          |

- Small print: Need just one thing done? Start with a single task: one deliverable, one price.
  `[L3]`
- Rails (each hidden when null or < 4 items; no empty state): "Popular services" → "See all
  services" `explorePath('services')` · "Open projects" → "See all projects"
  `explorePath('projects')` · "Ready-made teams" → "See all teams" `explorePath('teams')` (hidden on
  the dev seed: 3 teams) · "Freelancers" → "See all freelancers" `explorePath('freelancers')`. **No
  products rail.** `[U4]`
- Rail microcopy: region `aria-label` "{title}, {n} items"; scroll buttons "Scroll {title} back" /
  "forward"; card byline "by {ownerName}"; avatar `alt=""`.

### 4.6 Payment protection (`id="payment-protection"`, editorial serif voice)

- Eyebrow: Payment protection · h2: **Money held safely, stage by stage.** `[B1]` `[A2]`
- **Explainer line (the one "escrow" in the page body):** This is payment protection (escrow): when
  you pay for a stage, the money is held safely before any work starts. `[B5]`

| h3                                       | Body                                                                                                                                                                                             |
| :--------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Held before work starts                  | Work only starts once the stage is paid for. `[B3]` Until then, the task can't move into work. `[B4]`                                                                                            |
| Paid when you approve                    | The team is paid when you accept their work or approve the stage. `[B2]`                                                                                                                         |
| A fair way out                           | If work stops, end the stage with Fair Exit. `[F1]` You pick how much was done: 25%, 50% or 75%. `[F2]` The rest comes straight back to you, fee-free. `[F4]`                                    |
| Missed sessions                          | Booked a live session that didn't happen? Report a no-show, and a Projective reviewer decides. `[J3]` `[J5]`                                                                                     |
| Checked before they take on project work | Stripe checks a person's photo ID and bank details first. Only then can they take paid project work, join a team or withdraw earnings. `[H1]`                                                    |
| Clears in 7 days                         | When you approve, the team's money clears in 7 days. Then they can withdraw it. `[E1]` `[E2]`                                                                                                    |
| Refunds without fees                     | Refunds go straight back into your Projective wallet, with no fee. `[G1]`                                                                                                                        |
| Every penny on record `[I1]`             | Every change to a wallet balance is written to a log that can't be edited or deleted. `[I1]` Balances are checked against it every night. `[I2]` Each payment goes out once, never twice. `[I3]` |

- Links: "Read the payment protection terms" → `/legal/escrow-terms` (rendered only once P1 lands) ·
  "Get help with payments" → `/help`.

### 4.7 The numbers so far (`id="numbers"`)

- h2: **The numbers so far** · subline: Counted from real payments on Projective, as of {asOf}.
  `[Y4]`

| Tile | Figure                               | Label                                                                                          |
| :--- | :----------------------------------- | :--------------------------------------------------------------------------------------------- |
| 1    | {totalValueProtected}                | **Money protected so far** (P4's currency with its code; never converted, no "approx.") `[Y1]` |
| 2    | {stagesDelivered}                    | **Stages delivered** (footnote follows P4's definition) `[Y2]`                                 |
| 3    | {medianFundingToApprovalHours} hours | Half of approved stages were approved within this time of being paid for. `[Y3]`               |

- No fee tile: the wireframes draw three figures, and the fee lives in Pricing (§4.9).
- Hide/omit: a tile is hidden when its field is `null` (P4 nulls anything below `minN`); the
  section, h2 included, is omitted when all three are null or the result is not ok.
- Never show a 0, a dash, a lingering skeleton, padded or estimated values, or anything from
  `LandingPayload.stats` / `search.platform_stats` (§5.1).
- Format: amounts rounded **down** to the whole unit; `tabular-nums`; `{asOf}` as a UTC date ("17
  Oct 2026").

### 4.8 For freelancers and teams (`id="for-freelancers"`)

- Eyebrow: For freelancers and teams · h2: **Earn together. Get paid together.** `[A4]` · subline:
  Join a team or start one. Apply for work as one unit. `[A7]`

| h3                      | Body                                                                                                                                                                                |
| :---------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pay that splits itself  | When a stage is approved, the team's payment splits automatically into each member's agreed share. `[N1]`                                                                           |
| See each share first    | Whoever manages the team's money sees each person's share before a payment lands. `[N6]`                                                                                            |
| Every penny adds up     | Splits add up to the penny. Any leftover penny stays in the team vault. `[N4]`                                                                                                      |
| Clears in 7 days        | Each member's share clears in 7 days. Then they can withdraw it to their bank. `[E1]` `[E2]`                                                                                        |
| Workload limits         | The board won't let anyone claim a task that would push them past their workload limit. `[O1]`                                                                                      |
| Agree who owns the work | Every project states up front who owns the finished work: a full transfer, a licence, shared ownership or Projective's partner terms. It's written into the project's rules. `[P1]` |
| Free to split           | Split evenly or set custom shares, free on every team. `[N7]` Coming soon with Pro Team: a finder's fee, or paying everything into the team vault. `[N8]`                           |
| Verified by Stripe      | Verify with a photo ID, a quick selfie and your bank details. `[H5]`                                                                                                                |

- Small print: Buying, selling and joining teams unlock at 18. `[Q2]`
- CTAs: **Offer your skills** (§4.1 mapping) · **Find open projects** → `explorePath('projects')`

### 4.9 Pricing (`id="pricing"`)

- h2: **A {platformFee} fee. You pay the price you see.** `[C1]` `[C2]` ("flat" stays out until
  legal confirms it against per-payer negotiated rates, #281 flag j)
- Body: The fee comes out of the team's payment when it's paid out. `[C3]` You pay the stage price,
  with nothing on top. `[C2]` There's no fee on refunds. `[C7]`
- Worked example (SSR, visible without JS): **On a £2,000 stage you pay £2,000. The team receives
  {net(200000)} after the {platformFee} fee.** `[C4]`
- Rounding example: On a £10.50 stage, the fee is {fee(1050)} and the team receives {net(1050)}.
  `[C5]`
- Calculator (`PricingCalculator.island`): input **Stage price**, prefix "£", hint "Type what one
  stage costs.", default 2000. Rows **You pay** {price} · "From the team's payment:" **Projective
  fee ({platformFee})** {fee} · **The team receives** {price − fee}. Notes: "Clears in 7 days, then
  they can withdraw it." `[E1]` · "We round the fee down to the nearest penny." `[C6]` · "Paying a
  team? The team's vault share comes off, then the rest splits into each member's share." `[N9]`.
  Empty "Type a stage price to see who gets what." · invalid "Use numbers only, like 2000 or
  2000.50." · live region "You pay {price}. The team receives {net}."
- **Must not show:** the client paying the price plus the fee, card fees or a processing line, a fee
  on refunds, instant payout, the word "flat".

### 4.10 Common questions (`id="faq"`, `<details>`; FAQPage JSON-LD uses the same text)

1. **Is my money safe? (How escrow works)** — Projective uses payment protection (escrow). When you
   pay for a stage, the money is held safely. Work can't start until it is. The team is paid when
   you accept their work or approve the stage. If work stops, Fair Exit lets you end the stage
   fairly. `[B5]` `[B3]` `[B2]` `[F1]`
2. **Who pays the {platformFee} fee?** — The team does. A {platformFee} fee comes out of their
   payment when it's paid out. On a £2,000 stage you pay £2,000, and the team receives
   {net(200000)}. There's no fee on refunds. `[C3]` `[C4]` `[C7]`
3. **What if the work stops halfway?** — End the stage with Fair Exit. You pick how much was done:
   25%, 50% or 75%. The team is paid that share, minus the {platformFee} fee. The rest comes
   straight back to you, with no fee. `[F1]` `[F2]` `[F3]` `[F4]`
4. **When does the team get paid?** — When you approve, the team's money clears in 7 days. Then they
   can withdraw it to their bank through Stripe. The smallest withdrawal is £10. `[E1]` `[E2]`
   `[E3]`
5. **Where do refunds go?** — Refunds go straight back into your Projective wallet, with no fee. Use
   the money again, or withdraw it to your bank. Withdrawing needs a bank account set up through
   Stripe. The smallest withdrawal is £10. `[G1]` `[G2]` `[E4]` `[E3]`
6. **Do I need to show ID to hire?** — No. Clients pay by card or from their wallet, with no ID
   check. `[H2]` People who take on project work are checked instead. `[H3]` Stripe checks a
   person's photo ID and bank details first. Only then can they take paid project work, join a team
   or withdraw earnings. `[H1]` A business must be verified before it can spend from its shared
   business wallet. `[H4]`
7. **How do ready-made teams work?** — A ready-made team applies for a stage of your project as one
   unit. They work together and get paid together. `[A5]` `[A4]` Every team that applies has at
   least two members, and everyone paid from it is verified. `[A6]` When you approve a stage, the
   team's pay splits automatically into each member's agreed share. `[N1]`
8. **What if a live session doesn't happen?** — Report a no-show once the session has started, and
   within 24 hours of it ending. `[J3]` The expert has 48 hours to reply. `[J4]` Then a Projective
   reviewer decides: pay the expert, refund you, or split the payment. `[J5]` Cancel more than 24
   hours before the session (for a group, before its first session) and you get a full refund.
   `[J6]` Cancel later and the expert keeps the payment. `[J7]`

- Link under the list: **More answers in Help** → `/help`.

Alternate question: **How old do I need to be?** — You need to be 13 to join. `[Q1]` Buying, selling
and joining teams unlock at 18. `[Q2]`

### 4.11 Final CTA (`id="get-started"`)

- h2: **Find your team.** · subline: Search for the help you need. Pay safely, one stage at a time.
  `[U1]` `[A2]` `[B1]`
- Second HeroSearch instance (id suffix `-final`): same hidden label, static placeholder, **no
  typewriter**, **no `/` hint** (`enabled=false`).
- CTAs: **Hire a team** · **Offer your skills** (§4.1 mapping). Footer: PublicFooter, unchanged.

### 4.12 `/features` (L5)

- h1: **Everything Projective does** · subline: Try each feature with example data. No real money
  moves. `[P9]`
- Live tiles: "Try it" (`aria-label` "Try {title}") and "Learn more" → `/help`; coming-soon tiles:
  no buttons.
- Meta title: "Projective features — teams, boards and payment protection" `[A1]` `[K1]` `[B1]`;
  description: "See everything Projective does: ready-made teams, work boards, booking, team pay and
  payment protection for every stage." `[A1]` `[K1]` `[J8]` `[N1]` `[B1]`

| Chapter              | Tile                     | One-line description                                                                                                                                    |
| :------------------- | :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Find & hire          | V8 Search as you type    | Search people, teams, services and projects, with suggestions as you type. `[U1]`                                                                       |
|                      | V11 Team builder         | Sketch the team you need, then find teams like it. `[W1]`                                                                                               |
|                      | V13 Services & sessions  | Book a live session. Your payment is held until 24 hours after it ends. `[J2]` Small print: Coming soon: digital products with instant download. `[W2]` |
| Run the work         | V1 Work board            | Every job you post runs on a board. Work starts once it's paid for. `[K1]` `[B3]`                                                                       |
|                      | V3 Timeline              | See every stage on a timeline. Zoom out to months or in to days. `[T1]`                                                                                 |
|                      | V4 Booking               | Pick a time in your time zone. Moving a group session? Attendees vote. `[J8]` `[J10]`                                                                   |
|                      | V9 Ways to work          | See how a task, a job, ongoing work and a session each run. `[L4]`                                                                                      |
|                      | V6 Team room             | Chat and share files in one room. `[R1]` New messages mask contact details mid-project. `[R2]`                                                          |
| Money                | V2 Payment protection    | Pay for each stage before it starts. The team is paid when you approve. `[B3]` `[B2]`                                                                   |
|                      | V5 Team pay              | Watch a stage payment split into each member's agreed share, to the penny. `[N1]` `[N4]`                                                                |
|                      | V10 Your currency        | **HELD** — not on the page (#281; §5.1)                                                                                                                 |
|                      | V12 Fair Exit & no-shows | If work stops, end the stage fairly. `[F1]` Missed a session? Report a no-show. `[J3]`                                                                  |
| Trust                | V16 Verification         | Stripe checks ID and bank details before anyone takes paid project work. `[H1]`                                                                         |
|                      | V7 Files & sharing       | Preview files and share links that expire. `[S1]` `[S2]` Program files like .exe are refused. `[S3]`                                                    |
| Coming soon (static) | V14 Sell your best work  | Coming soon: turn great work into a template you can sell, with a share for the client who commissioned it. `[X1]` (never "Blueprint")                  |
|                      | V15 Connected tools      | Coming soon: link the tools your team already uses. `[X2]` (no brand names)                                                                             |
|                      | Tax pot                  | Coming soon: set money aside for tax automatically. `[X3]`                                                                                              |

Every live tile's one-line description is under 15 words (the work order's §2.6: "every visualizer's
caption is under 15 words"; V13's Coming soon line is small print, not the caption); the static
Coming soon tiles have no visualizer. "Every job you post runs on a board" on V1 is held to `[K1]`'s
proof: every client-created archetype, a Task included, has the board (a Task drops only Timeline
and Calendar, `features/projects/core/task-project.ts:38`). A session engagement is a project too
(`project_format` `session`) but has no board (`features/projects/core/session-model.ts:54`), so the
line never says "every project".

---

## 5. Claims table (decision h, #281)

**The gate.** Every factual sentence in §4 carries a tag that resolves to a row here. Status is one
of **Shipped** (code or a decision proves it), **Live metric** (rendered only from P4 above its
threshold), **Coming soon** (labelled as such on the page), **Model** (describes a way of working,
names no company and states no figure) or **Page fact** (true by the landing's own construction,
proved by an L3/L6 test). **Blocked on <flag>** marks a sentence true on the normal path that a
known code path still contradicts: it is built like any other row, and L6 fails the launch gate
while the named flag's fix is not on main (#285 (E)). **Live metric — pending P4** marks a metric
whose service is not in this branch yet. L6 walks this table sentence by sentence against the
rendered page and pastes it into its report. A sentence with no row is deleted, not shipped.

Paths are relative to the repo root; `mig/` = `supabase/migrations/`.

| #   | Sentence as it appears on the page                                                                                                                                                                                                                                                                                                                             | Section                                                                                               | Status                     | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| :-- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------- | :------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | Hire a ready-made team. / One team, not five strangers. / Hire a ready-made team with payment protection. / Ready-made teams                                                                                                                                                                                                                                   | h1 · title · og:title · eyebrow · meta · why h2 · /features meta                                      | Shipped                    | A team applies and is seated as one applicant: `mig/00001130_functions_projects_stages.sql:891-929` (`fn_assert_team_can_apply`, used by `apply_to_seat` and `apply_to_project`); the team is the escrow payee, `mig/00001200_functions_finance_core.sql:325-349` (`fn_ticket_payee`); teams are an Explore category, `packages/types/explore/items.ts:31-41`; Decisions #196, #228 (E)                                                                                                                                                                                                                                                                                                                                                                                                           |
| A2  | Pay one stage at a time.                                                                                                                                                                                                                                                                                                                                       | h1 · meta · why · protection h2 · final CTA                                                           | Shipped                    | One escrow per ticket per stage, held separately: `mig/00001200_functions_finance_core.sql:370-519` (`fn_hold_ticket_escrow`); one held base escrow per ticket, Decision #189; whole-stage funding while open/assigned/in progress, Decision #197                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A3  | Search for a team that's already formed. / Search for a ready-made team, or post your own project.                                                                                                                                                                                                                                                             | hero subline · how it works 1                                                                         | Shipped                    | Teams are searchable (`items.ts:31-41`; teams fold into `freelancers`, `packages/backend/services/explore/query.ts:143-152`); a team is published, has ≥ 2 active members and payout-ready shareholders before it can apply (`mig/00001130:891-929`) — nothing checks shared history or past work together, so never "a team that already works together" (§5.1); clients create projects, `packages/types/projects/setup.ts:907,973-984`                                                                                                                                                                                                                                                                                                                                                         |
| A4  | They apply, work and get paid together. / Earn together. Get paid together.                                                                                                                                                                                                                                                                                    | why · FAQ 7 · freelancers h2 · hero option 2                                                          | Shipped                    | Apply as one (`mig/00001130:891-929`), seated as one assignee (`mig/00000003_enums_core.sql:17` `assignment_type` team), paid as one payee then split (`mig/00001200:325-349`, `:752-754`, `fn_split_team_payout` `:176`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A5  | A ready-made team applies for a stage of your project as one unit.                                                                                                                                                                                                                                                                                             | FAQ 7                                                                                                 | Shipped                    | `apply_to_project(p_project, p_stage, …)` with a team applicant, `mig/00001130:1034-1040` ("to a stage (optionally one of its staffing roles)", `:1207`); team gate `:891-929`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A6  | Every team that applies has at least two members, and everyone paid from it is verified.                                                                                                                                                                                                                                                                       | FAQ 7                                                                                                 | Shipped                    | `mig/00001130:891-929` (≥ 2 active members, published, every shareholder payout-ready); `mig/00001210_functions_finance_kyc_wallet.sql:34-56` (`fn_team_shareholders`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A7  | Join a team or start one. Apply for work as one unit.                                                                                                                                                                                                                                                                                                          | freelancers subline                                                                                   | Shipped                    | `org.create_workspace` team, `mig/00001020_functions_org_entities.sql:1092-1160`; joining gated by payout readiness (`:1129`, `:1771`); apply as one, `mig/00001130:891-929`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A8  | One team for each stage.                                                                                                                                                                                                                                                                                                                                       | hero option 2 (not recommended)                                                                       | Shipped                    | A team applies to a stage (`apply_to_project(p_project, p_stage, …)`, `mig/00001130:1034-1040`, `:1207`) and holds only the stages it is accepted on; a team payee per ticket, `mig/00001200:325-349`. Never "one team for the whole job" (§5.1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| B1  | Your money is held safely. / Each stage's money is held safely. / Find your team. Keep your money safe. / Money held safely, stage by stage. / The team works. Your money stays held. / …with payment protection / Payment protection                                                                                                                          | title · og:title · eyebrow · hero option 3 · meta · demo V2 · protection · final CTA · /features meta | **Blocked on #281 (f)**    | `mig/00001200:370-519` (`fn_hold_ticket_escrow` inserts `finance.escrows` status `held` at :474 and debits the payer's wallet `escrow_hold` at :491); release only flips a `held` row, `:709-779`; Decisions #165, #188. **Blocked:** one door releases a held escrow with no approval — an assignee's workload report (RLS `mig/00002011_policies_projects.sql:374-385` → `mig/00001850_triggers_projects_tickets.sql:76-79` → `projects.fn_open_workload_report` `mig/00001140:62-80` clears the assignee → `fn_ticket_escrow_sync` releases the escrow, minus the fee, to them, `mig/00001110:156-159`; `PRODUCT_SPEC.md:2005-2008` says no payout). Fixed on peer branch `claude/workload-report-no-release` as Decision #290 (pending merge); Shipped once #290 is on main                   |
| B2  | They're paid when you approve. / The team is paid when you approve. / The team is paid when you accept their work or approve the stage.                                                                                                                                                                                                                        | hero · meta · og · why · how 5 · V2 · protection · FAQ 1                                              | Shipped                    | Accepting a submission settles its ticket, `mig/00001150_functions_projects_stage_funding_submissions.sql:452` → `fn_settle_ticket_stage` `:1404-1461`; `approve_stage` `:1518-1700` (review authority + `hire` on a business; stage → `paid` at :1633); release `mig/00001200:716-779`; Decision #194. Deliberately never "only" — see §5.1                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| B3  | Work only starts once it's paid for. / Work only starts once the stage is paid for. / Work starts only once it's paid for. / Work starts once it's paid for. / Pay for each stage before it starts. / Work can't start until it is. / Example board: work starts once a task is paid for.                                                                      | hero options 1–2 · how 2 · demo · protection · FAQ 1 · og · /features                                 | Shipped                    | DB trigger refuses entering `claimed`/`in_progress`/`in_review` without a `held` escrow on every update path, `mig/00001110_functions_projects_ticket_guards.sql:142-148` (PF402 `not_held`), fired by `mig/00001850_triggers_projects_tickets.sql:41-44` (AFTER UPDATE only: a direct INSERT of a ticket already in a work state skips it — `Manage tickets` WITH CHECK `mig/00002011:347-366`, table grant ALL `mig/00002500_permissions_schema_grants.sql:121`; #281 flag (w)); pure mirror `workColumnLocked`, `packages/types/projects/board.ts:351-390`; Decisions #165, #170. Personal (13–17) projects carry no money and are exempt (#192)                                                                                                                                               |
| B4  | Until then, the task can't move into work.                                                                                                                                                                                                                                                                                                                     | protection                                                                                            | Shipped                    | The work-entry gate refuses `claimed` / `in_progress` / `in_review` without a held escrow, `mig/00001110:142-148`; the tag is not "Needs funding" here: a priced, described, unfunded ticket reads Draft, and Needs funding only after a refused hold or for work already running without one, `packages/backend/services/finance/funding-state.ts:158-173`; labels `apps/web/features/projects/core/funding-ui.ts:15-25`; Decision #169                                                                                                                                                                                                                                                                                                                                                          |
| B5  | This is payment protection (escrow): when you pay for a stage, the money is held safely before any work starts. / Projective uses payment protection (escrow). When you pay for a stage, the money is held safely.                                                                                                                                             | protection explainer · FAQ 1                                                                          | **Blocked on #281 (f)**    | B1 + B3. FAQ 1 never opens "Yes." (§5.1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| B6  | Each stage's money is held safely before work starts.                                                                                                                                                                                                                                                                                                          | V2 SSR                                                                                                | **Blocked on #281 (f)**    | B1 + B3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| B7  | A fixed price per stage, agreed before work starts.                                                                                                                                                                                                                                                                                                            | why                                                                                                   | Shipped                    | A hold needs a price (`COALESCE(ticket.unit_price_cents, stage.unit_price_cents)`; refusal reason `no_price`), `mig/00001200:420-462`; no work without a hold (B3); extra revision rounds are priced in the same terms before work starts (`extra_revision_price_cents`, `mig/00000015:303-311`; M2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| C1  | A {platformFee} fee. / …minus the {platformFee} fee.                                                                                                                                                                                                                                                                                                           | how 5 · V2 · V5 · pricing h2                                                                          | Shipped                    | `platform_fee_bp` 500, `mig/00005001_seed_platform_params.sql:30-31`; payer's effective rate `mig/00001200:691-707` (`fn_escrow_fee_bp`), `mig/00001220_functions_finance_billing_entitlements.sql:231-249`; deducted from the payee `mig/00001200:743-744`, `:867`; Decisions #2, #187. Never "flat": an admin-approved `finance.negotiated_rates` row overrides the rate per payer at release (`fn_effective_platform_fee_bp`; the seed comment says so, `mig/00005001:31`) — #281 flag (j)                                                                                                                                                                                                                                                                                                     |
| C2  | You pay the price you see. / You pay the stage price, with nothing on top. / Your wallet goes down by exactly £1,500, with no fee on top.                                                                                                                                                                                                                      | pricing · V2                                                                                          | Shipped                    | Wallet debit = `amount_cents`, `mig/00001200:491`; card escrow charge = the exact amount, `mig/00001230_functions_finance_stripe.sql:375`; `seller_deducted`, `packages/types/finance/checkout.ts:476-499`; `PRODUCT_SPEC.md:1252-1253`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| C3  | The fee comes out of the team's payment when it's paid out. / Who pays the fee? The team does.                                                                                                                                                                                                                                                                 | pricing · FAQ 2                                                                                       | Shipped                    | `mig/00001200:743-744` (`fee := amount × bp / 10000`; `payout := amount + bonus − fee`) at every release, a session's automatic one included (`fn_release_seat_escrow`, `mig/00001155:390`; auto-release `:1534-1610`, with no approval), so never "when you approve"; invoice line "Platform fee (included, deducted from the payee)" `mig/00001200:867`; `PRODUCT_SPEC.md:1253`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| C4  | On a £2,000 stage you pay £2,000. The team receives {net(200000)} after the {platformFee} fee. / You approve. The team receives {net(200000)} / {net(150000)} after the {platformFee} fee. / A £2,000 stage is approved. The {platformFee} fee leaves {net(200000)}.                                                                                           | pricing · FAQ 2 · V1 · V2 · V5                                                                        | Shipped                    | Rendered by `platformFeeFor()`, `checkout.ts:406-409`; today floor(200000 × 500 / 10000) = 10000 → 190000 (£1,900) and floor(150000 × 500 / 10000) = 7500 → 142500 (£1,425); `mig/00001200:743`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| C5  | On a £10.50 stage, the fee is {fee(1050)} and the team receives {net(1050)}.                                                                                                                                                                                                                                                                                   | pricing                                                                                               | Shipped                    | Today floor(1050 × 500 / 10000) = floor(52.5) = 52 (52p); payee 998 (£9.98); same refs as C4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| C6  | We round the fee down to the nearest penny.                                                                                                                                                                                                                                                                                                                    | calculator                                                                                            | Shipped                    | Integer division `mig/00001200:743`; `Math.floor`, `checkout.ts:408`; Decision #187                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| C7  | There's no fee on refunds.                                                                                                                                                                                                                                                                                                                                     | pricing · FAQ 2                                                                                       | Shipped                    | Refund credits the full `amount_cents`, `mig/00001200:1001-1033` (`fn_refund_ticket_escrow`); Fair Exit refund share fee-free, `:980`; the fee is taken only on release (`:743`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D1  | Does the task have a next stage? Your wallet pays for it straight away when your balance covers it. You can switch this off for any stage. / The task moves to its next stage, paid for from your wallet. / Stage 2 is paid for from your wallet, so work keeps going. / Approve, and it moves on. / Approve a stage, and the task moves on to its next stage. | how 5 · V1 · V2                                                                                       | Shipped                    | Chain Reaction moves the **same** ticket to its next required stage and holds it from the live wallet balance, `mig/00001130_functions_projects_stages.sql:644-760` (chain branch :705-726, `chain_held`); per-stage switch `project_stages.chain_reaction` DEFAULT true, `mig/00000015_tables_projects.sql:355-359` ("Fund on arrival", `SetupStageFields.tsx:413`) — off, the ticket moves on as Draft and nothing is held (`chain_off`, `mig/00001130:727-736`); on a business project the spend gate (KYB, approval threshold, spending limit) can refuse the hold even when the balance covers it (`fn_hold_ticket_escrow` → `fn_assert_business_spend`, `mig/00001200:438-452`), which lands as Needs funding; both approval doors reach it via `fn_settle_ticket_stage`; Decision #210 (C) |
| D2  | If your wallet is short, it waits until you pay for it.                                                                                                                                                                                                                                                                                                        | V1                                                                                                    | Shipped                    | Refused hold → ticket `todo` + Needs funding (`fn_mark_needs_funding`), approval and payout stand, `mig/00001130:717-726`; a top-up alone moves nothing for an individual client: the client pays for it (`projects.fund_ticket` / `fund_stage`, `mig/00001150:934`, `:788`) or a fresh claim retries the hold (`mig/00001110:131-137`), while a move into work without a hold is refused (`:142-148`); only a business project's auto-funding acts on its own (`mig/00001140:339-341`, `mig/00001250_functions_finance_auto_fund_billing.sql:106`); Decision #210. Never "until you top up" (§5.1)                                                                                                                                                                                               |
| E1  | Their money clears in 7 days. / When you approve, the team's money clears in 7 days. / Each (member's) share clears in 7 days. / Team paid · clears in 7 days. / Clearing · 7 days → Available                                                                                                                                                                 | how 6 · V1 · V2 · V5 · protection · freelancers · calculator · FAQ 4                                  | Shipped                    | `pending_release_days` 7, `mig/00005001:80-81`; `fn_wallet_credit_pending` `mig/00001240_functions_finance_money_movement.sql:1502-1546`; matured by `fn_mature_pending_releases` `:1585-1640` (hourly, `mig/00005060_seed_scheduled_jobs.sql:50-52`); every team share, finder cut and vault cut too, `mig/00001200:195-216`; Decision #191                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| E2  | Then they (can) withdraw it to their bank (through Stripe). / Withdrawal started. Stripe sends it to the bank.                                                                                                                                                                                                                                                 | how 6 · V2 · V5 · protection · freelancers · FAQ 4                                                    | Shipped                    | `begin_payout` (Available only), `mig/00001240:248-400`; Stripe Transfer to a verified Connect account, `packages/backend/services/finance/stripe-rails.ts:400`; Decisions #125, #202                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| E3  | The smallest withdrawal is £10.                                                                                                                                                                                                                                                                                                                                | FAQ 4 · FAQ 5                                                                                         | Shipped                    | `min_withdrawal_minor` GBP 1000, `mig/00005001:87-89`; `fn_min_withdrawal_minor`, `mig/00001240:179-195`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| E4  | Withdrawing needs a bank account set up through Stripe.                                                                                                                                                                                                                                                                                                        | FAQ 5                                                                                                 | Shipped                    | Verified Stripe Connect destination required, `mig/00001240:213-231`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| F1  | If work stops, end the stage with Fair Exit. / …Fair Exit lets you end the stage fairly. / If work stops, end the stage fairly.                                                                                                                                                                                                                                | protection · FAQ 1, 3 · /features                                                                     | Shipped                    | `cancel_stage_fair_exit`, `mig/00001150:1139-1288` (reviewer only; open/assigned/in_progress/submitted/revisions with something held); preview `:1070-1137`; `FairExitDialog.tsx`; Decision #198                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| F2  | You pick how much was done: 25%, 50% or 75%. / Pick 25%, 50% or 75% done.                                                                                                                                                                                                                                                                                      | protection · V2 · FAQ 3                                                                               | Shipped                    | Tier must be 25, 50 or 75, chosen by the reviewer, `mig/00001150:1167-1171`; not derived from elapsed time (#198 flag f; #281 flag d)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| F3  | The team is paid that share, minus the {platformFee} fee. / Team receives {x} · clears in 7 days                                                                                                                                                                                                                                                               | FAQ 3 · V2                                                                                            | Shipped                    | share = floor(amount × bp / 10000), fee on the share only, `mig/00001200:914-932` (`fn_fair_exit_split`); payout through pending, `:975`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| F4  | The rest comes straight back to you, fee-free. / Back to you {y} · straight away, no fee                                                                                                                                                                                                                                                                       | protection · FAQ 3 · V2                                                                               | Shipped                    | Refund `fair_exit_refund`, immediate, no fee, `mig/00001200:980`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| F5  | At 50%: the team gets £950. You get £1,000 back, fee-free. (and 25% → £475 / £1,500, 75% → £1,425 / £500)                                                                                                                                                                                                                                                      | V2 · protection diagram                                                                               | Shipped                    | 200000 × 5000 / 10000 = 100000; fee 5000; payout 95000; refund 100000 (25%: 50000 / 2500 / 47500 / 150000; 75%: 150000 / 7500 / 142500 / 50000); `mig/00001200:914-932`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| F6  | The stage then reads "Cancelled".                                                                                                                                                                                                                                                                                                                              | V2                                                                                                    | Shipped                    | Stage and its remaining tickets → `cancelled`, `mig/00001150:1139-1288`; Decision #198                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| G1  | Refunds go straight back into your Projective wallet, with no fee.                                                                                                                                                                                                                                                                                             | protection · FAQ 5                                                                                    | Shipped                    | `mig/00001200:1001-1033` (credit to the paying wallet, `escrow_refund`), `:308-319` (back to the wallet type it came from); `PRODUCT_SPEC.md:1327-1329`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| G2  | Use the money again, or withdraw it to your bank.                                                                                                                                                                                                                                                                                                              | FAQ 5                                                                                                 | Shipped                    | Refunds are immediately Available; a refund-only balance needs no ID check, `mig/00001240:327-333`; withdrawing still needs an adult account holder (`fn_assert_adult`, `:268`), a verified payout destination (`:337-340`, E4) and at least £10 (E3), which FAQ 5 states; Decision #196                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| H1  | Stripe checks a person's photo ID and bank details first. Only then can they take paid project work, join a team or withdraw earnings. / Stripe checks ID and bank details before anyone takes paid project work.                                                                                                                                              | protection · FAQ 6 · /features V16                                                                    | Shipped                    | `fn_freelancer_payout_ready` (KYC verified AND payout-ready), `mig/00001210:17-29`; `fn_assert_payout_ready` `:63-115`, called at `mig/00001130:928,984,1090,1500,2182`, `mig/00001135_functions_projects_membership.sql:650`, `mig/00001140_functions_projects_automation_workload.sql:414`, `mig/00001020:1129,1771,2320`; withdrawals `mig/00001240:323-333`; Stripe Identity `mig/00001230:977-1022, 1099-1188`; Decision #196. Sessions and product sales are not gated before withdrawal (no check on the session and seat order lines, `mig/00001210:1745-1790`; #281 flag (o)), so no sentence says everyone who is paid is checked (§5.1)                                                                                                                                                |
| H2  | No. Clients pay by card or from their wallet, with no ID check.                                                                                                                                                                                                                                                                                                | FAQ 6                                                                                                 | Shipped                    | The gate sits on earning doors only (H1); a buyer's refund balance needs no ID, `mig/00001240:327-333`; `finance-model.md:298-302`; Decision #196 (4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| H3  | People who take on project work are checked instead.                                                                                                                                                                                                                                                                                                           | FAQ 6                                                                                                 | Shipped                    | H1 (project work, teams and withdrawals only; a session or product seller is checked when they withdraw, #281 flag (o))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| H4  | A business must be verified before it can spend from its shared business wallet.                                                                                                                                                                                                                                                                               | FAQ 6                                                                                                 | Shipped                    | `fn_business_kyb_verified`, `mig/00001210:122-133`; `kyb_required` refusal `:212-217`; Connect KYB `mig/00001230:1370-1386`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| H5  | Verify with a photo ID, a quick selfie and your bank details.                                                                                                                                                                                                                                                                                                  | freelancers                                                                                           | Shipped                    | Stripe Identity session (document + selfie: `require_live_capture`, `require_matching_selfie`, `packages/backend/services/finance/stripe-rails.ts:308-320`), opened by `begin_identity_verification`, `mig/00001230:977-1022`; payout account → `payout_ready`, `:1342-1391`; `apps/web/features/settings/core/verification-model.ts:24-170`; Decisions #155, #196                                                                                                                                                                                                                                                                                                                                                                                                                                |
| I1  | Every change to a wallet balance is written to a log that can't be edited or deleted. / Every penny on record                                                                                                                                                                                                                                                  | protection                                                                                            | Shipped                    | Every `balance_cents` write goes through `fn_wallet_credit` / `fn_wallet_debit` (`mig/00001200:10`, `:34`), which insert a `finance.transactions` row; that table refuses UPDATE / DELETE / TRUNCATE for every role, `fn_transactions_append_only` `mig/00001200:1039-1050`, bound by `mig/00001830_triggers_finance.sql:96-104`; Decision #186. Not "every payment": earned money waits in the mutable `finance.pending_releases` (`mig/00001240:1536-1542`; a chargeback recovery updates it, `:1557-1567`) and reaches the ledger only at maturity (`:1612-1628`); escrows are mutable status rows (§5.1)                                                                                                                                                                                      |
| I2  | Balances are checked against it every night.                                                                                                                                                                                                                                                                                                                   | protection                                                                                            | Shipped                    | `fn_reconcile_wallets`, `mig/00001200:1057+`; daily 03:40 UTC, `mig/00005060:47-49`; Decision #186                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| I3  | Each payment goes out once, never twice.                                                                                                                                                                                                                                                                                                                       | protection                                                                                            | Shipped                    | Release: row locks + flip only while `held`, `mig/00001200:709-779`; withdrawal: one Stripe Transfer per payout id (`createTransfer` idempotency key, `packages/backend/services/finance/stripe-rails.ts:398-403`) behind `begin_payout`'s attempt key (`mig/00001240:284-297`); Decision #188                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| J1  | Book time with an expert: one session, a block, or a seat in a group.                                                                                                                                                                                                                                                                                          | ways to work                                                                                          | Shipped                    | `fn_book_session_slot`, `mig/00001155_functions_projects_sessions.sql:564`; session / block / cohort-seat order lines `mig/00001210:1751-1790`; Decisions #171, #211                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| J2  | Your payment is held. It goes to them 24 hours after each session ends, unless you report a no-show. For a group seat, that's 24 hours after the last session. / The session is booked, and your payment is held. / Book a live session. Your payment is held until 24 hours after it ends.                                                                    | ways to work · V4 · /features V13                                                                     | Shipped                    | One escrow per 1-1 sitting, auto-released `session_payout_hours` (24) after it ends with no open dispute; a group seat is one escrow released 24 hours after the cohort's LAST sitting, `mig/00001155:1520-1650` (`:1529-1530`, `:1608-1630`), `PRODUCT_SPEC.md:118-119`; `mig/00005001:12`; every 15 min, `mig/00005060:24-26`; Decision #211                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| J3  | Report a no-show once the session has started, and within 24 hours of it ending. / Missed a session? Report a no-show. / Report a no-show, and a Projective reviewer decides.                                                                                                                                                                                  | protection · FAQ 8 · /features V12                                                                    | Shipped                    | `claim_session_no_show`, `mig/00001155:1142+` (an attendee with a held escrow, after the start, "only while the escrow is still held", `:1138-1139`); a 1-1 sitting's escrow auto-releases 24 hours after it ends (`:1584-1595`), after which nothing can be claimed; Decision #212                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| J4  | The expert has 48 hours to reply.                                                                                                                                                                                                                                                                                                                              | FAQ 8                                                                                                 | Shipped                    | `dispute_response_hours` 48, `mig/00005001:24`; lifecycle `mig/00001260_functions_finance_disputes.sql:1-40`. Every claim reaches this step: no tracked meeting room is minted (`live-orders.ts:390`, `joinUrl: null`), so the attendance audit returns `ambiguous` (`mig/00001260:130-140`, `:186-197`) — never "if attendance doesn't settle it" (§5.1); Decision #212                                                                                                                                                                                                                                                                                                                                                                                                                          |
| J5  | Then a Projective reviewer decides: pay the expert, refund you, or split the payment. / …and a Projective reviewer decides.                                                                                                                                                                                                                                    | FAQ 8 · protection                                                                                    | Shipped                    | `fn_settle_dispute` writes `resolved_release` / `resolved_refund` / `resolved_split`, `mig/00001260:274-386`; operator door `resolve_dispute` (`security.is_admin()`), `:765-789`; operator page `/admin/disputes`, Decision #216; the review SLA alerts but never rules (`:16-18`), so never "sorted"; sessions only (§5.1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| J6  | Cancel more than 24 hours before the session (for a group, before its first session) and you get a full refund.                                                                                                                                                                                                                                                | FAQ 8                                                                                                 | Shipped                    | `session_cancel_notice_hours` 24, `mig/00005001:20`; cancel rule `mig/00001155:762-880` — a cohort seat is judged against the cohort's first sitting, and cancelling after the cohort started forfeits the whole seat (`:762-767`, `:825-831`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| J7  | Cancel later and the expert keeps the payment.                                                                                                                                                                                                                                                                                                                 | FAQ 8                                                                                                 | Shipped                    | Inside 24h forfeited to the provider, `mig/00001155:762-880`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| J8  | Pick a session time from the freelancer's live availability, shown in your time zone. / Times show in your time zone. We tell you the freelancer's too. / Times shown in your time zone (London). The freelancer is in New York. / Pick a time in your time zone.                                                                                              | V4 · /features                                                                                        | Shipped                    | `packages/types/scheduling/booking.ts:14-23, 72-75`; `packages/backend/services/scheduling/slot-grid.ts:239-240`; `apps/web/features/view/components/SlotPicker.tsx:170-183`; the grid reads Projective availability rules and events (`scheduling.availability_rules` through `fn_slot_is_free`, `booking.ts:5-9`), never a synced calendar (every connection refused, `IntegrationsBackendService.ts:26-31`), so never "real calendar"; Decision #211                                                                                                                                                                                                                                                                                                                                           |
| J9  | Taken times stay on the list, greyed out.                                                                                                                                                                                                                                                                                                                      | V4                                                                                                    | Shipped                    | Unavailable slots are rendered and `aria-disabled`, never hidden, `SlotPicker.tsx:18-24`; their reason (taken · blackout · past · full · call rules, `booking.ts:14-23`) is only in a visually hidden span, `SlotPicker.tsx:105-109`, so the page never says the reason is shown                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| J10 | Moving a group session? Attendees vote. / Moving a group session? Offer new times, and it moves only if more than half agree. / The host offers two new times. Three attendees vote. / Two of three pick Thursday. More than half agree, so it moves when voting closes. / No majority. The original time stands.                                              | V4 · /features                                                                                        | Shipped                    | Vote mode for 3+ (host included), eligible = roster minus the host (the host never votes, hence "attendees"), quorum floor(eligible / 2) + 1, ≥ 2 ballot slots, settle at the deadline or when all voted, `packages/types/scheduling/coordination.ts:56-89, 230-272, 651-760`; `close_reschedule_round` `mig/00001510_functions_scheduling.sql:330-421`; Decision #71                                                                                                                                                                                                                                                                                                                                                                                                                             |
| J11 | Too late to move this. It starts in under 12 hours.                                                                                                                                                                                                                                                                                                            | V4                                                                                                    | Shipped                    | 12h lockout, `coordination.ts:56-89`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| J12 | Add it to Google Calendar, Outlook or any calendar app.                                                                                                                                                                                                                                                                                                        | V4                                                                                                    | Shipped                    | `calendarLinksFor` (Google template, Outlook deeplink, `.ics`), `packages/types/finance/order.ts:349-430`; `apps/web/routes/api/checkout/calendar.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| K1  | Each task moves across its stage's board, from Ready to Review. / See every task on one board, from New to Completed. / Every job you post runs on a board. / Lanes New · Ready · In Progress · Review · Completed                                                                                                                                             | how 3 · why · V1 · /features                                                                          | Shipped                    | `TICKET_COLUMN_LABEL`, `packages/types/projects/board.ts:1017-1023`; `ticket_status`, `mig/00000003:97`; columns map 1:1 to status, Decision #210 (E). The project board opens in the **Stages** view (New · stage columns · Completed; "default `stages`", `board.ts:865`; `cardColumnId` `:1004-1012`); the Ready → Review lanes are the Statuses view and a stage's Tasks board, which the theatre and V1 show. Every client-created archetype has the board (a Task drops only Timeline and Calendar, `apps/web/features/projects/core/task-project.ts:38`); a session engagement has none (`apps/web/features/projects/core/session-model.ts:52-55`; `channel-view.ts:74-75, 93`), so never "every project is a board" (§5.1)                                                                |
| K2  | “Homepage design” waits in Ready. Its tag says Draft.                                                                                                                                                                                                                                                                                                          | V1                                                                                                    | Blocked on #287 (B)        | FLAG #287 (B): the product's card tags this ticket Needs funding ("Unfunded" when compact; `fundingTagState`, `apps/web/features/projects/core/funding-ui.ts:64-71`), and the board model follows the card until the owner rules. Its STATE is Draft: `packages/backend/services/finance/funding-state.ts:158-173`; label `funding-ui.ts:16`                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| K3  | The freelancer tries to start it. Your wallet is short, so the board says no. The tag changes to Needs funding. / Needs funding. Pay for this stage before work starts.                                                                                                                                                                                        | V1                                                                                                    | Shipped                    | A claim tries the hold from the client's live balance and is refused (`no_price` / `no_wallet` / `insufficient_funds`), `mig/00001200:420-462`; the refused claim records Needs funding (`fn_mark_needs_funding`, `mig/00001140:385`, `:434`), and only then does the tag read it (`funding-state.ts:158-173`); the board shows the lock and the reason, `packages/ui/kanban/islands/KanbanBoard.tsx:44-48`, `apps/web/features/projects/islands/ProjectBoard.island.tsx:683-716`; Decisions #165, #206                                                                                                                                                                                                                                                                                           |
| K4  | You pay for the stage. The tag changes to Funded. / It's held safely, marked Funded.                                                                                                                                                                                                                                                                           | V1 · V2                                                                                               | Shipped                    | Funding holds (or prepays) the escrow; tag "Funded", `funding-ui.ts:15-25`; Decisions #166, #197                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| K5  | Work starts. The task moves to In Progress, then Review.                                                                                                                                                                                                                                                                                                       | V1                                                                                                    | Shipped                    | Lane fold `board.ts:53-90`; status `in_progress` → `in_review` on submission                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| K6  | A freelancer starts this task by claiming it.                                                                                                                                                                                                                                                                                                                  | V1                                                                                                    | Shipped                    | The client's drop of an unclaimed card into a work lane is refused with this reason, `ProjectBoard.island.tsx:683-716`; Decision #206                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| K7  | Each task is paid for when someone picks it up.                                                                                                                                                                                                                                                                                                                | ways to work                                                                                          | Shipped                    | A claim fires the hold (or binds a prepaid escrow), `mig/00001110:128-136`; open-pull claims, Decision #206                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| K8  | 1 task needs £400 to start · Fund all                                                                                                                                                                                                                                                                                                                          | hero theatre                                                                                          | Shipped                    | The board header's "{n} tickets need {total} to start", `funding-ui.ts:285-290` (`BoardFundingTotal`); "Fund all", `ProjectBoard.island.tsx:1034-1045`; Decision #169                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| L1  | One clear piece of work, delivered in milestones. Each milestone is paid for as it starts.                                                                                                                                                                                                                                                                     | ways to work                                                                                          | Shipped                    | One-off hint "A fixed scope delivered against milestones, each funded as it starts.", `packages/types/projects/setup.ts:973-984`; one master ticket, `mig/00001130:113-149`; Decision #143 (A). The tile posts a job (`/projects?create=1`, the Quick-Init modal, `apps/web/features/shell/core/actions-model.ts:43-47`) rather than linking to one-off listings, which checkout refuses (PS501, `CheckoutBackendService.ts:232-250`; #281 flag q)                                                                                                                                                                                                                                                                                                                                                |
| L2  | Ongoing work, task by task, across several stages.                                                                                                                                                                                                                                                                                                             | ways to work                                                                                          | Shipped                    | Pipeline hint, `setup.ts:973-984`; a Pipeline listing carries at most 12 stages (`STAGES_MAX`, `packages/types/catalogue/offer.ts:83`, `:131-134`), so never "as many stages as you need"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| L3  | Need just one thing done? Start with a single task: one deliverable, one price.                                                                                                                                                                                                                                                                                | ways to work                                                                                          | Shipped                    | Task hint "One deliverable for one price.", `setup.ts:973-984`; one stage + one ticket, `task-project.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| L4  | Pick a single job, an ongoing workflow or a live session. / Switch between a single task, a fixed job, ongoing work and live sessions to see how each runs.                                                                                                                                                                                                    | ways to work · /features V9                                                                           | Shipped                    | Task / One-off / Pipeline creatable (`setup.ts:907`); sessions bought from a provider's listing (J1); Decision #143 (A) — sessions are a provider-side flow, never a client project type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| L5  | …or post your own project.                                                                                                                                                                                                                                                                                                                                     | how 1                                                                                                 | Shipped                    | `setup.ts:907`; `projects.create_project`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| M1  | Not quite right? Ask for changes.                                                                                                                                                                                                                                                                                                                              | how 4                                                                                                 | Shipped                    | `review_submission` revisions, `mig/00001150:332`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| M2  | If the free rounds run out, extra rounds can be paid for where the terms offer them.                                                                                                                                                                                                                                                                           | how 4                                                                                                 | Shipped                    | `file_revisions_allowed`, `extra_revision_price_cents` (NULL = not for sale), `mig/00000015:303-311`; `fund_paid_revision` `mig/00001150:625`; Decisions #167, #199                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| N1  | Team pay splits automatically into each agreed share. / When a stage is approved, the team's payment splits automatically into each member's agreed share. / Approve a stage and the team's pay splits into each agreed share.                                                                                                                                 | why · V5 · freelancers · FAQ 7 · /features                                                            | Shipped                    | `fn_team_split_plan` `mig/00001200:106-170`, `fn_split_team_payout` `:176-219`, called at release `:752-754`; stakes are set by the team's `manage_finances` holder — the creator starts at 100% and each new member at 0% (`mig/00001020:1162-1163`, `:1793-1795`), so V5's even split is labelled an example; Decision #234                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| N2  | The team keeps 10% in its shared vault: {vault}. / This team keeps 10% in its vault.                                                                                                                                                                                                                                                                           | V5                                                                                                    | Shipped                    | `vault = floor(rest × vault_bp / 10000)`, `mig/00001200:106-170`; seeded teams use a 10% vault, `supabase/seeds/03_entities.sql:61-66`; today 190000 × 1000 / 10000 = 19000 (£190); the product shows the vault rate read-only and saves stakes only (`PayoutPolicyScreen.island.tsx:121-124, 199-209`), so the demo has no vault control                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| N3  | The rest splits three ways: {shares}.                                                                                                                                                                                                                                                                                                                          | V5                                                                                                    | Shipped                    | Today pool 171000; stakes 3334 / 3333 / 3333 (even split gives the owner the spare bp, `packages/backend/services/workspace/mappers.ts:809-830`); floor(171000 × 3334 / 10000) = 57011 (£570.11), floor(171000 × 3333 / 10000) = 56994 (£569.94)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| N4  | Any spare penny goes to the vault. It all adds up. / Splits add up to the penny. Any leftover penny stays in the team vault. / …to the penny.                                                                                                                                                                                                                  | V5 · freelancers · /features                                                                          | Shipped                    | Dust = pool − Σ shares → vault, `mig/00001200:160-167`; conservation probe `supabase/probes/team_split_properties.sql:1-15`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| N5  | Try custom shares: 50%, 30% and 20%. / Shares must add up to 100%.                                                                                                                                                                                                                                                                                             | V5                                                                                                    | Shipped                    | Stakes editable by a `manage_finances` holder (`PayoutPolicyScreen.island.tsx:109-124`); stakes total 0 or 10000 bp, `mig/00001200:270-287`; today 171000 → 85500 / 51300 / 34200 (£855.00 / £513.00 / £342.00)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| N6  | Whoever manages the team's money sees each person's share before a payment lands.                                                                                                                                                                                                                                                                              | freelancers                                                                                           | Shipped                    | `preview_team_split` (same plan as the release), `mig/00001210:2459-2500`; visible to `manage_finances`, Decision #233                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| N7  | Split evenly or set custom shares, free on every team.                                                                                                                                                                                                                                                                                                         | freelancers                                                                                           | Shipped                    | `co_op` free on Team, `mig/00005030_seed_billing_plans_entitlements.sql:77-79`; `save_split_rule` `mig/00001210:2365-2453`; Decision #234                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| N8  | Coming soon with Pro Team: a finder's fee, or paying everything into the team vault.                                                                                                                                                                                                                                                                           | V5 · freelancers                                                                                      | Coming soon                | Templates exist in SQL/API only: no UI picker (Decision #234 flag a, `PayoutPolicyScreen.island.tsx:121-124`) and Pro Team cannot be bought (`packages/backend/services/finance/PlanBackendService.ts:17`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| N9  | Paying a team? The team's vault share comes off, then the rest splits into each member's share.                                                                                                                                                                                                                                                                | calculator                                                                                            | Shipped                    | N1; the vault cut comes off before the member pool, `mig/00001200:142-144`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| O1  | The board won't let anyone claim a task that would push them past their workload limit.                                                                                                                                                                                                                                                                        | freelancers                                                                                           | Shipped                    | `check_ticket_capacity` on every claim/assignment, `mig/00001140:192-266` (sums claimed / in_progress / in_review tickets only), `:383-430`; global cap default 10.00, `mig/00005001:40-41`. Never "never overloaded": seating on a stage (an accepted application or invitation) is not checked and session work is not counted (Decision #214 flag); Decisions #214, #233, #235                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P1  | Every project states up front who owns the finished work: a full transfer, a licence, shared ownership or Projective's partner terms. It's written into the project's rules.                                                                                                                                                                                   | freelancers                                                                                           | Shipped (stored and shown) | `ip_option_mode` (four modes), `mig/00000003:41`; labels `IP_LABEL`, `apps/web/features/projects/components/setup/setup-format.ts:44-48`; `projects.ip_ownership_mode` (default `exclusive_transfer`), `mig/00000015:106`; setup `SetupLegalSection.tsx:429-431`; rules panel `packages/types/projects/workspace.ts:633`. Nothing enforces it — the copy claims only that it is stated (#281 flag m)                                                                                                                                                                                                                                                                                                                                                                                              |
| P9  | Example only. No real money moves. / Try each feature with example data. No real money moves.                                                                                                                                                                                                                                                                  | stage note · /features subline                                                                        | Page fact                  | Demos are pure reducers over typed fixtures with no network calls and no writes (§2.0 addendum; L3 reducer tests; L6 network check)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Q1  | You need to be 13 to join.                                                                                                                                                                                                                                                                                                                                     | FAQ (alternate)                                                                                       | Shipped                    | `org.fn_check_dob` under 13 → PM422, `mig/00001010_functions_org_onboarding.sql:697-713`; Decisions #6, #190, #208                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Q2  | Buying, selling and joining teams unlock at 18.                                                                                                                                                                                                                                                                                                                | freelancers · FAQ (alternate)                                                                         | Shipped                    | `fn_assert_adult` `mig/00001010:759-772` (19 call sites), `trg_workspace_member_adult` `:777-795`; derived from the date of birth, `:743-755`; Decisions #190, #192                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| R1  | Chat and share files in one room.                                                                                                                                                                                                                                                                                                                              | /features V6                                                                                          | Shipped                    | Attachments reach recipients, `packages/backend/services/messaging/MessagingBackendService.ts:860-906`; `apps/web/routes/api/messaging/files.ts`; Decisions #131, #132                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| R2  | New messages mask contact details mid-project.                                                                                                                                                                                                                                                                                                                 | /features V6                                                                                          | Shipped                    | `comms.mask_pii` (emails, phone numbers of 8+ characters, `$handles` and a fixed list of payment-link hosts — paypal, venmo, cash.app, zelle, wise, revolut, monzo, ko-fi, buymeacoffee, t.me, wa.me, telegram.me), `mig/00001300_functions_comms_channels.sql:269-317` (`:286-294`); BEFORE INSERT triggers only, `:323-416`, `mig/00001840_triggers_comms.sql:6-14` — an edit (`edit_own_messages`, `mig/00002012_policies_comms.sql:82`) is never masked (#147 (c), #281 flag n), hence "new messages"; lifted at the handover, `mig/00001150:1671-1684`; Decision #147. Never "hidden" for every message, never "no one can take you off-platform" (§5.1)                                                                                                                                     |
| S1  | Preview files in your browser.                                                                                                                                                                                                                                                                                                                                 | /features V7                                                                                          | Shipped                    | Inspector canvases, `packages/backend/services/files/live-uploads.ts:25-44, 268-280`; `apps/web/routes/(standalone)/inspect/[fileId].tsx`; Decisions #161, #162                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| S2  | Share links that expire, cap downloads or switch off any time.                                                                                                                                                                                                                                                                                                 | /features V7                                                                                          | Shipped                    | Expiry presets, download limit 1–100,000, terminal revoke, `packages/types/files/sharing.ts:30-118`; `packages/backend/services/files/live-library-writes.ts:356-395`; `apps/web/routes/api/files/share-revoke.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| S3  | Program files like .exe are refused.                                                                                                                                                                                                                                                                                                                           | /features V7                                                                                          | Shipped                    | Only native binaries (PE/MZ, ELF, Mach-O) sniff as `executable` and are refused at upload, `packages/types/files/sniff.ts:93-102`, `packages/backend/services/files/live-uploads.ts:269`; scripts (.bat, .ps1, .sh, .js), .jar / .apk and .msi pass, and there is no malware scanner (`live-uploads.ts:43-44`), so never "programs can't be uploaded" (§5.1)                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| T1  | See every stage on a timeline. Zoom out to months or in to days.                                                                                                                                                                                                                                                                                               | /features V3                                                                                          | Shipped                    | `packages/ui/gantt/core/time-scale.ts:36-80` (px/day 0.6–2400, tiers year → hour); `apps/web/routes/(dashboard)/projects/[projectSlug]/timeline.tsx`; Decision #91                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| U1  | Search freelancers, teams and services. / Search teams, services and projects. / Search people, teams, services and projects, with suggestions as you type. / Search for the help you need.                                                                                                                                                                    | og · hero placeholder · option 3 · /features V8 · final CTA                                           | Shipped                    | `GET /api/explore/suggest`, `apps/web/routes/api/explore/suggest.ts:11-21`; `ExploreBackendService.suggest` `packages/backend/services/explore/ExploreBackendService.ts:680-687`; categories `items.ts:32-42`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| U2  | Try “brand identity” · “landing page” · “design system” · “motion design” · “mobile app”                                                                                                                                                                                                                                                                       | typewriter                                                                                            | Page fact                  | Derived at SSR from the live `home.recommended`; each fallback term renders only when `suggest()` returns a hit for it at SSR, with the typewriter off when none survive (the seed-corpus hits — `supabase/seeds/gen/corpus.ts:105, 446, 264, 1196`; `supabase/seeds/gen/world.ts:521-552, 1540, 1664` — prove nothing in production); L2 tests the SSR check                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| U3  | Try: {chips}                                                                                                                                                                                                                                                                                                                                                   | hero                                                                                                  | Live metric                | SSR `suggest({q:"",scope:"all"}).trending`; omitted when empty; labelled "Try:", never "Popular:", because a quiet platform's trending list degrades to the most-listed terms, `packages/backend/services/explore/suggest.ts:187-192`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| U4  | Rails: Popular services · Open projects · Ready-made teams · Freelancers ("by {ownerName}", "from £###")                                                                                                                                                                                                                                                       | ways to work                                                                                          | Live metric                | `LandingPayload.home` from `ExploreBackendService.landing()` (`ExploreBackendService.ts:657-672`); each rail hidden below 4 items                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| W1  | Sketch the team you need, then find teams like it.                                                                                                                                                                                                                                                                                                             | /features V11                                                                                         | Shipped (demo)             | Explore `category=teams` + `skill` facet, `apps/web/features/explore/core/filter-config.ts:41-48,130-134`, `query.ts:191-194`; the hand-off sends only `category=teams`, `skill` and `q` — never a team-size parameter, since the "Team size" facet renders but is never applied (`filter-config.ts:132`; `query.ts:183-230`; #281 flag l); inside the demo, budgets are labelled "Example — not a quote" by construction                                                                                                                                                                                                                                                                                                                                                                         |
| W2  | Coming soon: digital products with instant download.                                                                                                                                                                                                                                                                                                           | /features V13                                                                                         | Coming soon                | Order line written without `asset_id`, `mig/00001210:1821-1832`; `live-orders.ts:313, 336-343`; wave 8 C1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| X1  | Coming soon: turn great work into a template you can sell, with a share for the client who commissioned it.                                                                                                                                                                                                                                                    | /features V14                                                                                         | Coming soon                | Spec only, `PRODUCT_SPEC.md:2161-2210`; no royalty code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| X2  | Coming soon: link the tools your team already uses.                                                                                                                                                                                                                                                                                                            | /features V15                                                                                         | Coming soon                | Every connection refused, `packages/backend/services/integrations/IntegrationsBackendService.ts:26-31, 253-286`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| X3  | Coming soon: set money aside for tax automatically.                                                                                                                                                                                                                                                                                                            | /features tax pot                                                                                     | Coming soon                | `wallet_pots.auto_allocate_bp` never read by a credit path, `mig/00000017_tables_finance.sql:466`; wave 8 F2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Y1  | {totalValueProtected} — Money protected so far                                                                                                                                                                                                                                                                                                                 | numbers                                                                                               | Live metric — pending P4   | P4 `PublicMetrics.totalValueProtected` (null below `minN` → hidden), shown in P4's currency with its code and never converted: the FX rates are seed-only and stale (#281 flag c)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Y2  | {stagesDelivered} — Stages delivered                                                                                                                                                                                                                                                                                                                           | numbers                                                                                               | Live metric — pending P4   | P4 `PublicMetrics.stagesDelivered`; footnote follows P4's definition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Y3  | {medianFundingToApprovalHours} hours — Half of approved stages were approved within this time of being paid for.                                                                                                                                                                                                                                               | numbers                                                                                               | Live metric — pending P4   | P4 `PublicMetrics.medianFundingToApprovalHours`; a funding-to-approval median covers approved stages only, so the label never speaks for all stages; it must match P4's definition (§9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Y4  | Counted from real payments on Projective, as of {asOf}.                                                                                                                                                                                                                                                                                                        | numbers                                                                                               | Live metric — pending P4   | P4 `PublicMetrics.asOf`; P4 must exclude seed/test data (assert in L6) — seeded escrows exist on dev (`supabase/seeds/`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Z1  | Five freelancers, hired one by one.                                                                                                                                                                                                                                                                                                                            | why (old way)                                                                                         | Model                      | A way of working, no company named, no figure (#281 ruling)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Z2  | Open-ended hourly billing.                                                                                                                                                                                                                                                                                                                                     | why (old way)                                                                                         | Model                      | as Z1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Z3  | Pay up front for the whole job.                                                                                                                                                                                                                                                                                                                                | why (old way)                                                                                         | Model                      | as Z1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Z4  | Chase updates across email and chat.                                                                                                                                                                                                                                                                                                                           | why (old way)                                                                                         | Model                      | as Z1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Z5  | Work out who gets what by hand.                                                                                                                                                                                                                                                                                                                                | why (old way)                                                                                         | Model                      | as Z1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### 5.1 Omitted claims

Deleted from the copy because nothing proves them (or code contradicts them). L6 fails the page if
any of these sentences, or a paraphrase, renders.

| Omitted sentence                                                                      | Source                                                                                                                                                                                                  | Reason                                                                                                                                                                                                                                                                                                                                                                                                                            |
| :------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Your money is held safely until you approve" / "only paid when you approve"          | §2.6 glossary; old `LANDING_META` ("only when you're happy")                                                                                                                                            | Approval is not the only release path: member removal and ticket deletion pay out (`mig/00001130:2342/2420`, `mig/00001120:56-101`), sessions auto-release (J2), dispute rulings and Fair Exit split, and a workload report can release to the assignee (#281 flag f; fixed on a peer branch as Decision #290, pending merge — drop this reason once #290 is on main). Copy says "the team is paid when you approve" instead (B2) |
| "On a £2,000 stage you pay £2,000 + 5% fee"                                           | §2.1 item 9                                                                                                                                                                                             | False: the fee is deducted from the payee (C2, C3)                                                                                                                                                                                                                                                                                                                                                                                |
| "Card processing fees are passed through at cost"                                     | Decision #2, `finance-model.md`, invoice footer                                                                                                                                                         | False in code: no pass-through (`mig/00001230:375`; `CheckoutBackendService.ts:741-744`) — #281 flag b                                                                                                                                                                                                                                                                                                                            |
| "Refunds go back to your card"                                                        | —                                                                                                                                                                                                       | False: every refund is a wallet credit; no card refund path (`mig/00001200:1019-1024`)                                                                                                                                                                                                                                                                                                                                            |
| "The exchange rate is locked when you fund a stage" / "Pay in your currency" (V10)    | §2.3 V10, `PRODUCT_SPEC.md:1380-1381`                                                                                                                                                                   | False: no SQL writes the escrow FX snapshot; rates are seed-only and stale (#281 flags c) — V10 held                                                                                                                                                                                                                                                                                                                              |
| "Raise a dispute on project work; the money stays held"                               | wireframe draft, `PRODUCT_MANAGEMENT.md:480`                                                                                                                                                            | Disputes exist for session seat escrows only (`mig/00001260:255-272`) — #281 flag e                                                                                                                                                                                                                                                                                                                                               |
| "If the expert never joined, you get a full refund automatically"                     | claims research M6                                                                                                                                                                                      | Needs a tracked meeting room; none is minted (`live-orders.ts` `joinUrl: null`) — #281 flag t                                                                                                                                                                                                                                                                                                                                     |
| "Instant payouts"                                                                     | —                                                                                                                                                                                                       | The flag is recorded but behaves the same (`instant_payout_fee_bp` 0)                                                                                                                                                                                                                                                                                                                                                             |
| "Everyone who gets paid is ID-verified"                                               | §2.6 glossary, §2.3 V16; paraphrased by the drafts' "Verified before they're paid" (§4.6 h3), "People who earn are checked instead" (FAQ 6) and "Stripe checks ID before anyone earns" (§2.6 wireframe) | Product sales and session bookings credit an unverified seller's wallet (withdrawal is gated) — #281 flag o; H1's wording instead                                                                                                                                                                                                                                                                                                 |
| "Your work stays yours"                                                               | §2.1 item 8                                                                                                                                                                                             | The default is exclusive transfer to the client and nothing enforces any mode — #281 flag m; P1's wording instead                                                                                                                                                                                                                                                                                                                 |
| "Cryptographic IP deeds" / "signed Deed of Transfer"                                  | decision (h) list, `PRODUCT_SPEC.md:2564-2571`                                                                                                                                                          | No code                                                                                                                                                                                                                                                                                                                                                                                                                           |
| "Blueprints & royalties" as a feature                                                 | §2.3 V14                                                                                                                                                                                                | Spec only; "Coming soon" on `/features` (X1) without the word "Blueprint" (it names the shipped `marketplace.service_blueprints`)                                                                                                                                                                                                                                                                                                 |
| "An automatic tax pot" as a feature                                                   | decision (h) list                                                                                                                                                                                       | Not built; "Coming soon" on `/features` (X3)                                                                                                                                                                                                                                                                                                                                                                                      |
| "Instant download of digital products"                                                | §2.3 V13, receipt copy `mig/00001210:1827`                                                                                                                                                              | Not delivered (wave 8 C1); "Coming soon" (W2) — #281 flag k                                                                                                                                                                                                                                                                                                                                                                       |
| "Buy a fixed-price service at checkout"                                               | §2.3 V13; the draft "Browse single jobs" link (`model=One-Off`)                                                                                                                                         | One-off service listings are refused at checkout (PS501, `CheckoutBackendService.ts:232-250`) — #281 flag q                                                                                                                                                                                                                                                                                                                       |
| "Built for enterprise buyers"                                                         | —                                                                                                                                                                                                       | An enterprise cannot go active (no RPC, no plan checkout) — #281 flag s                                                                                                                                                                                                                                                                                                                                                           |
| "Lead-heavy split template" / a selectable Finder's fee                               | §2.3 V5, L3                                                                                                                                                                                             | Not a template (a co_op split with uneven stakes); finder's fee and all-to-vault have no UI picker and need Pro Team, which cannot be bought (N8)                                                                                                                                                                                                                                                                                 |
| "Drag a stage and see the dates move"                                                 | §2.3 V3                                                                                                                                                                                                 | Stage items are `movable: false` (`packages/types/projects/timeline.ts:280,299`)                                                                                                                                                                                                                                                                                                                                                  |
| "Freelancers earn a bonus for finishing early"                                        | §2.3 V3, setup copy                                                                                                                                                                                     | Nothing writes `deadline_bonus_cents` — #281 flag g                                                                                                                                                                                                                                                                                                                                                                               |
| "Sync with Google or Outlook" / "Connect GitHub, Zoom or your calendar"               | §2.3 V4, V15                                                                                                                                                                                            | Every connection refused (`IntegrationsBackendService.ts:26-31`)                                                                                                                                                                                                                                                                                                                                                                  |
| "See who's online" / presence dots                                                    | §2.3 V6                                                                                                                                                                                                 | No presence source; every roster row is `offline` (`live-support.ts:543-555`)                                                                                                                                                                                                                                                                                                                                                     |
| "No one can take you off-platform"                                                    | §2.3 V6                                                                                                                                                                                                 | Edits, proposal text and file names are not masked (#147 (c), H1) — #281 flag n                                                                                                                                                                                                                                                                                                                                                   |
| "Every file is virus-checked"                                                         | decision (h) list                                                                                                                                                                                       | No scanner (`live-uploads.ts:43-44`; wave 8 H3)                                                                                                                                                                                                                                                                                                                                                                                   |
| "Assemble a team in under 4 minutes"                                                  | decision (h) list                                                                                                                                                                                       | No measurement exists                                                                                                                                                                                                                                                                                                                                                                                                             |
| "Built on a Deno and Rust architecture"                                               | decision (h) list                                                                                                                                                                                       | No Rust in the repo; not a visitor benefit — #281 flag r                                                                                                                                                                                                                                                                                                                                                                          |
| "0% escrow capital lost"                                                              | decision (h) list                                                                                                                                                                                       | No metric                                                                                                                                                                                                                                                                                                                                                                                                                         |
| "Never miss a deadline"                                                               | draft                                                                                                                                                                                                   | Unprovable outcome                                                                                                                                                                                                                                                                                                                                                                                                                |
| Competitor fees ("Upwork 10–20%")                                                     | decision (h) list                                                                                                                                                                                       | Owner ruling (#281): no competitor figures without a sourced, dated citation; none is provided                                                                                                                                                                                                                                                                                                                                    |
| "No bidding, no surprises"                                                            | §2.6 glossary                                                                                                                                                                                           | No proof; freelancers do send applications and proposals (Decision #154)                                                                                                                                                                                                                                                                                                                                                          |
| "The next card gets funded" / a "Needs payment" column / a "Done" column              | §2.3 V1, L3                                                                                                                                                                                             | Chain Reaction funds the same ticket's next stage (#210); lanes are New · Ready · In Progress · Review · Completed (#210 (E))                                                                                                                                                                                                                                                                                                     |
| "Money paid out" / "stages delivered" from `search.platform_stats`                    | `LandingPayload.stats`                                                                                                                                                                                  | `paid_out` counts USD only and `stages_delivered` counts a status nothing writes (`mig/00003004_views_finance_integrations_analytics.sql:160-186`) — #281 flag p                                                                                                                                                                                                                                                                  |
| SoftwareApplication `offers {price: "0"}` (JSON-LD)                                   | `seo.ts:23-77`                                                                                                                                                                                          | No proof the product is "free" as a claim; dropped unless the owner confirms (§9)                                                                                                                                                                                                                                                                                                                                                 |
| Testimonials                                                                          | `LandingPayload.testimonials`                                                                                                                                                                           | Seed-only today; decision (h) bans fake testimonials. Not on the page until real reviews exist                                                                                                                                                                                                                                                                                                                                    |
| "Is my money safe? — Yes." (an unconditional yes)                                     | FAQ 1 draft                                                                                                                                                                                             | Money can leave a held escrow without approval (row 1; #281 flag f until #290 merges); FAQ 1 opens "Projective uses payment protection (escrow)." instead (B5)                                                                                                                                                                                                                                                                    |
| "Search for a team that already works together"                                       | hero option 1 draft                                                                                                                                                                                     | Nothing checks shared history or past work together; a team made yesterday from strangers qualifies (A3)                                                                                                                                                                                                                                                                                                                          |
| "One team for the whole job" / a team that "applies for your project"                 | hero option 2, FAQ 7 drafts                                                                                                                                                                             | A team applies to a stage and holds only the stages it is accepted on (A5, A8)                                                                                                                                                                                                                                                                                                                                                    |
| "Every project is a board"                                                            | V1 SSR, /features V1 drafts                                                                                                                                                                             | Session engagements are projects with no board (`session-model.ts:52-55`); K1's "Every job you post runs on a board" instead                                                                                                                                                                                                                                                                                                      |
| "Until then, the task shows Needs funding" / an unrefused ticket tagged Needs funding | §4.6, V1 frame 1 drafts                                                                                                                                                                                 | An unfunded ticket reads Draft until a hold is refused (`funding-state.ts:158-173`); B4 and K2 instead — the STATE; the product's card TAG reads Needs funding for a described, priced ticket (`fundingTagState`), FLAG #287 (B)                                                                                                                                                                                                  |
| "If your wallet is short, it waits until you top up"                                  | V1 frame 6 draft                                                                                                                                                                                        | A top-up alone restarts nothing for an individual client (D2)                                                                                                                                                                                                                                                                                                                                                                     |
| "A flat {platformFee} fee" / "Flat fee"                                               | pricing h2, how 5, V2, FAQ 2, meta and numbers drafts                                                                                                                                                   | Per-payer negotiated rates change the fee at release (C1; #281 flag j); held until legal confirms                                                                                                                                                                                                                                                                                                                                 |
| "The fee comes out of the team's payment when you approve"                            | pricing, FAQ 2 drafts                                                                                                                                                                                   | Session escrows release automatically, with no approval, and the fee is taken then (C3)                                                                                                                                                                                                                                                                                                                                           |
| "Goes to them 24 hours after each session" (for every seat)                           | ways-to-work, /features V13 drafts                                                                                                                                                                      | A group seat is one escrow released 24 hours after the cohort's last sitting (J2)                                                                                                                                                                                                                                                                                                                                                 |
| "Ongoing work across as many stages as you need"                                      | ways-to-work draft                                                                                                                                                                                      | Pipeline listings cap at 12 stages (L2)                                                                                                                                                                                                                                                                                                                                                                                           |
| "Taken times are greyed out, with the reason shown"                                   | V4 frame 2 draft                                                                                                                                                                                        | The reason is only in the accessible name (`SlotPicker.tsx:105-109`); J9 instead                                                                                                                                                                                                                                                                                                                                                  |
| "Pick a time from the freelancer's real calendar"                                     | V4 SSR, /features V4 drafts                                                                                                                                                                             | The grid is Projective availability; no external calendar is synced (J8)                                                                                                                                                                                                                                                                                                                                                          |
| "Moving a group session? Everyone votes."                                             | V4 caption and 1280 frame drafts                                                                                                                                                                        | The host never votes (J10); "Attendees vote" instead                                                                                                                                                                                                                                                                                                                                                                              |
| "If attendance doesn't settle it…" / "Missed sessions, sorted"                        | §4.6, FAQ 8 drafts                                                                                                                                                                                      | No tracked room is minted, so every claim goes to a reviewer, and the review SLA never rules (J4, J5)                                                                                                                                                                                                                                                                                                                             |
| "Nobody can pick up more work than they can handle" / "Never overloaded"              | §4.8 draft                                                                                                                                                                                              | Capacity is checked on claims and assignments only; seating on a stage is not, and sessions are not counted (O1; Decision #214)                                                                                                                                                                                                                                                                                                   |
| "Phone numbers, emails and payment links are hidden while a project is under way"     | /features V6 draft                                                                                                                                                                                      | Masking runs on insert only, over a fixed host list; edits are never masked (R2; #281 flag n)                                                                                                                                                                                                                                                                                                                                     |
| "Programs can't be uploaded"                                                          | /features V7 and wireframe drafts                                                                                                                                                                       | Only native binaries are refused; scripts, .jar / .apk and .msi pass (S3)                                                                                                                                                                                                                                                                                                                                                         |
| "Every payment is recorded in a log that can't be changed"                            | §4.6 draft                                                                                                                                                                                              | Pending releases and escrows are mutable rows; only wallet-balance changes reach the append-only ledger (I1)                                                                                                                                                                                                                                                                                                                      |
| "Popular:" as the chip label                                                          | L2 work order, hero draft                                                                                                                                                                               | On a quiet platform trending degrades to the most-listed terms (U3); "Try:" instead                                                                                                                                                                                                                                                                                                                                               |
| "Half of all stages are approved within this time of being paid for"                  | numbers draft                                                                                                                                                                                           | A funding-to-approval median covers approved stages only (Y3)                                                                                                                                                                                                                                                                                                                                                                     |
| A converted "approx." protected total                                                 | numbers tile 1 draft                                                                                                                                                                                    | The FX rates are seed-only and stale (#281 flag c); one currency, never converted (Y1)                                                                                                                                                                                                                                                                                                                                            |

---

## 6. Visualizers (§2.3 re-verified)

Every demo is a pure simulation over typed fixtures (Zod-validated against the real
`@projective/types` shapes) with no network calls and no writes; money in integer minor units; the
fee bp passed in from the server. Demo modules live **outside** `islands/` (e.g.
`features/landing/core/demos/`) because every file under an `islands/` folder is registered as an
island and evaluated by the server snapshot at boot (`vite.config.ts:43, 62-95`, at the repo root);
DemoHost is the only island and `import()`s the active one (#284 flag).

| id  | name                 | status                                                                            | where it appears                                                                            | sim facts it must mirror                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | must not show                                                                                                                                                                                                                                                                                      | reduced-motion version                                                      |
| :-- | :------------------- | :-------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------- |
| V1  | Work board           | Shipped (board, work-start gate, Chain Reaction)                                  | Hero theatre (passive, inert loop) · stage tab `board` (default) · `/features` Run the work | Lanes New · Ready · In Progress · Review · Completed (claimed + in_progress fold into In Progress; anything else in New). Funding tags Draft · Needs funding · Processing · Funded · In progress · In review · Released (shown as "Team paid", #283 (b)) · Failed · Refunded; `canStart` only when Funded. Lock = not personal ∧ target ∈ {claimed, in_progress, in_review} ∧ source ∉ that set ∧ claimed ∧ ¬canStart. Client drop of an unclaimed card → "A freelancer starts this task by claiming it." Freelancer drop = claim → hold from the client's live wallet; refusal leaves it Ready + Needs funding. Hold = exact price; fee = floor(amount × bp / 10000); payout pending 7 days. Chain Reaction on a non-final stage → same task, next stage, held from live balance (or Needs funding / Draft when off); final stage → Completed. Keyboard: Space · Arrows · Enter · Escape, `aria-live` moves and reasons | A "Needs payment" or "Done" column; "the next card" funded; a client starting an unclaimed card; a fee on top; instant withdrawal; presence dots; the demo's "Move to…" menu presented as the product's                                                                                            | Six labelled frames with Previous/Next; the hero theatre is a static poster |
| V2  | Payment protection   | Shipped flow (#165, #187, #191, #194, #197, #198, #202); the demo is a simulation | Stage tab `payments` · `/features` Money                                                    | £5,000 in stages 150000 / 200000 / 150000. Hold: wallet −= stage exactly; tag Funded; only open/assigned/in_progress fundable. Release per escrow: fee floor, payout pending → Available after 7 days. Chain Reaction or Needs funding when short. Withdraw: Available only, min 1000 (£10), verified payout account. Fair Exit tiers 25/50/75 chosen by the client; share floor; fee on the share; refund immediate, fee-free; stage → Cancelled; an unclaimed prepaid escrow refunded whole                                                                                                                                                                                                                                                                                                                                                                                                                            | The client paying +5%; a fee on refunds or the unearned share; Fair Exit by elapsed time or by the freelancer; withdrawing before 7 days or spending pending money; instant payouts; refunds to the card; deadline bonuses; card fees passed through; an FX lock; a dispute button on project work | Frames                                                                      |
| V3  | Timeline             | Partial (zoom, lanes, links shipped; stage drag false)                            | `/features` Run the work only                                                               | px/day clamp [0.6, 2400], default 44, wheel ×1.12; tier ladder year/quarter → day/hour; stage start = fixed start ?? predecessor end + max(0, lag); one date → milestone; Overdue in warning tone; ticket due-date drag only on a project with deadline terms, client only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Dragging a stage bar; re-flow; a deadline bonus or "+10%"; a timeline on a Task; negative-delay overlaps                                                                                                                                                                                           | Static frames at three zoom tiers with Previous/Next                        |
| V4  | Booking              | Shipped (slots across zones, reschedule rounds, add-to-calendar); sync ❌         | Stage tab `booking` · `/features` Run the work                                              | ≤ 2 attendees incl. host → the other party confirms; > 2 → vote. Eligible = roster minus host; quorum floor(e/2)+1; ≥ 2 ballot slots, ≤ 12; deadline min(earliest slot − 12h, start − 12h) or all voted; no majority → lapsed; 12h lockout; slots absolute instants, days in the viewer's zone, provider zone named                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Calendar sync or busy import; auto-created meeting links; the host voting; a majority among answerers only; moves inside 12h; a plurality winner                                                                                                                                                   | Frames                                                                      |
| V5  | Team pay             | Shipped (co_op stakes + vault); finder's fee / all-to-vault SQL-only              | Stage tab `splits` · `/features` Money · static still in For freelancers                    | fee = floor(amount × bp / 10000) on the amount only; payout = amount + bonus − fee; finder first; vault = floor(rest × vault_bp / 10000); each active member floor(pool × bp / 10000), ordered bp desc then id; dust → vault; Σ = payout. Even split floor(10000/n) with the spare bp to the owner. Examples: 200000 → 190000; vault 19000; 57011 / 56994 / 56994 + dust 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Instant payout; a tax pot; a "Lead-heavy" template; all-to-vault described as lead-heavy; dust to the lead; a fee on the bonus; a fee on top; a template picker or Pro upgrade button; a vault-share control; an even split presented as the default                                               | Frames                                                                      |
| V6  | Team room            | Partial (chat, attachments, masking; presence ❌)                                 | `/features` Run the work                                                                    | `maskPii` pass order email → payment link → `$handle` → phone (8+ chars); tokens `[email hidden]` / `[link hidden]` / `[handle hidden]` / `[phone hidden]`; only while the project is protected; 8,000-character cap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Presence or typing; a pre-send warning; masking edits; masking after the handover; embeds; AI detection                                                                                                                                                                                            | Frames                                                                      |
| V7  | Files & sharing      | Shipped ("virus-checked" ❌)                                                      | `/features` Trust                                                                           | pending_upload → scanning (byte sniff) → uploaded / error; programs refused; share = one file or folder, link or public, expiry none/24h/7d/30d, limit 1–100,000, revoke terminal, every failure the same not-found                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | "Virus-checked"; editing through a link; a different "expired" page; quotas; Drive/Dropbox                                                                                                                                                                                                         | Frames                                                                      |
| V8  | Search as you type   | Shipped                                                                           | **Hero search** (live, read-only) · `/features` poster linking to the hero                  | `SuggestQuerySchema` (q ≤ 80, scope); 200ms debounce, abort, sequence guard; caps (2 hits per type, 6 isolated, 5 terms, 4 handles, 6 trending); teams fold into `freelancers`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Invented results; a ⌘K hint                                                                                                                                                                                                                                                                        | Typewriter off; static placeholder; suggestions still work without motion   |
| V9  | Ways to work         | Partial (Task / One-off / Pipeline creatable; sessions bookable)                  | `/features` Run the work                                                                    | Type hints (`setup.ts:973-984`); lock triggers (One-off/Task at stage start, Pipeline at claim, Session at booking); rooms per type                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | A session as a client-created project; buying a one-off listing at checkout; a timeline on a Task                                                                                                                                                                                                  | Frames                                                                      |
| V10 | Your currency        | **Held** (#281)                                                                   | Nowhere                                                                                     | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | "Locked at funding"; live rates                                                                                                                                                                                                                                                                    | n/a                                                                         |
| V11 | Team builder         | Shipped as a demo                                                                 | `/features` Find & hire                                                                     | Seat cap Team 4 / Pro Team 15 (owner counts); apply needs published + ≥ 2 members + verified shareholders; link `/explore?category=teams&skill=…&q=…`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Prices as quotes; > 4 free seats; the `members` facet (renders, never applied); automatic assembly; a one-member team applying                                                                                                                                                                     | Frames                                                                      |
| V12 | Fair Exit & no-shows | Partial (Fair Exit; disputes for sessions only)                                   | `/features` Money (and V2's toggle)                                                         | Fair Exit as V2. Sessions: claim after start → audit: provider absent (15 min) on a tracked room → refund; both ≥ 80% → dismissed; else 48h response → under review → operator rules release / refund / split                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | An automatic split by time; a freelancer-started exit; project disputes; a Refund Offer; an Evidence Vault; automatic rulings after the 72h SLA; reputation strikes; a fee on the refund                                                                                                           | Frames                                                                      |
| V13 | Services & sessions  | Partial (sessions and tickets payable; one-off listings refused; downloads ❌)    | `/features` Find & hire                                                                     | Session lines "Session booked · payment held" / block per sitting / cohort seat; add-to-calendar; product fee seller-deducted, pending 7 days                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | A download button; a buyer library; "Join call"; an 8–20% commission; calendar sync; buying a one-off service listing; the app's "escrow held" wording (never the word "escrow" in demo copy, #283)                                                                                                | Frames                                                                      |
| V14 | Sell your best work  | Not shipped                                                                       | `/features` Coming soon (static)                                                            | None                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | A royalty %, a founding-partner payout, "Request to sell", a minted link, the word "Blueprint"                                                                                                                                                                                                     | Static by design                                                            |
| V15 | Connected tools      | Not shipped                                                                       | `/features` Coming soon (static, no brand names)                                            | None                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Toggles that appear to connect                                                                                                                                                                                                                                                                     | Static by design                                                            |
| V16 | Verification         | Shipped                                                                           | `/features` Trust                                                                           | Identity states Not verified · In review · Verified · Needs another try · Expired; payout account Not set up · Pending · Ready · Needs attention · Unavailable; payout-ready = both; ≤ 5 sessions/24h; never regresses                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Projective storing ID or bank details; a phone rung; client verification; instant approval                                                                                                                                                                                                         | Frames                                                                      |
| —   | Tax pot              | Not shipped                                                                       | `/features` Coming soon (static)                                                            | None                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Any skim                                                                                                                                                                                                                                                                                           | Static by design                                                            |

**Dev Context Switcher axes** (root `CLAUDE.md` §5; each lands with `DevOverrides` + `DEV_DEFAULTS`,
a `DevOption` list, a `DevContextPanel` control and `reflect()` set **and** delete in
`apps/web/features/devtools/`, seam `apps/web/utils/dev-seam.ts`):

- `landingBackground` — Auto · Static · WebGL. Forces LandingBackground's path; the page reflects
  `data-lp-bg="webgl|static"` and `data-lp-bg-reason` on `.lp-root` (§3.6). Built in L1.
- `landingMetrics` — Auto · All hidden · All shown. Forces the numbers section's threshold result so
  both the omitted section and every tile can be seen without real data. Built in L4.

---

## 7. Performance budget

From the §2.0 addendum, verbatim numbers (mobile mid-tier):

- **LCP < 2.5s, INP < 200ms, CLS < 0.05.**
- **Initial JS ≤ 60 KB gzip**, excluding the lazily loaded WebGL/demo chunks.
- **WebGL starts only after first paint and on idle, only when visible, and never under reduced
  motion or Save-Data or with `deviceMemory < 4`.**
- **It pauses when offscreen or when the tab is hidden.**

Prompt-level budgets carried with it: the hero island ≤ 20 KB gzip (L2); each demo chunk ≤ 35 KB
gzip, only the active one loaded (L3); WebGL `devicePixelRatio` capped at 1.5 (L1); `/features`
initial JS ≤ the landing budget, demo chunks on "Try it" (L5).

**What the 60 KB counts (Decision #286 (A), ruled 2026-10-18: strip + defer + rescope).** The
addendum's 60 KB is **landing-owned** initial JS: every chunk a landing island reaches beyond the
app baseline — `LandingShell`'s header and the page's own islands (hero, theatre, background,
demos), whether or not the footer or a layout host shares the chunk. It fails over 60 KB. The **app
baseline** (the client entry and the `_app.tsx` islands, loaded by every page of the app) is tracked
apart and held at its measured size, **109,799 bytes** (109.8 KB) on the production build of
2026-10-18, pinned in `js-budget.ts` (#287 (A)(12)): one more byte fails. The layout hosts and the
footer islands are reported as what each adds beyond those two groups, and the page totals for a
guest and for a signed-in visitor are reported and never fail. The hero island keeps its ≤ 20 KB own
weight, and every lazy chunk the landing owns (its source under `features/landing/`, or loaded by
`import()` from a landing-owned chunk) its ≤ 35 KB. Two hosts left the landing's initial JS to get
there: `/` and `/features` strip `?tkv=` on the server with a `303`
(`features/landing/core/strip-tkv.ts`; `ROUTING.md`) instead of mounting `TicketDeepLinkHost`, and a
signed-in visitor gets `LazyChatHost`, which loads `ChatPopoutHost` only once a floating chat is
open in the tab.

**How L6 measures it.**

| Metric          | Method                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| :-------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial JS      | `deno task build && deno task budget:landing` (`scripts/landing-budget.ts` over `features/landing/core/js-budget.ts` and `core/island-graph.ts`, unit-tested by `js-budget.test.ts` and `island-graph.test.ts`): it reads `apps/web/_fresh/client/.vite/manifest.json`, warns on a build older than the landing's sources, walks the client entry plus every island each landing page renders for a guest and for a signed-in visitor, gzips each chunk with `CompressionStream`, puts each initial chunk in a group by the mount of the islands that reach it (app baseline · landing-owned · layout host · footer), reports each island's added and exclusive weight, and exits 1 when a failing line is over: the landing-owned 60 kB, the baseline's 110 kB growth cap, an island's own-weight cap (the hero's 20 kB), a landing-owned lazy chunk's 35 kB. Dev-server sizes are meaningless (unbundled). **L1, 2026-10-18, before the ruling: OVER** — 171.8 kB guest / 394.4 kB signed in against an all-in 60 kB: client entry 23.0, the `_app` islands 86.7 (CurrencyBridge 44.7, OfflineBridge 20.6, DesignSystemRoot 14.2, WebVitalsBridge 3.0, ImageFallbackBridge 2.0, ExploreHistoryTracker 1.9, ServiceWorkerBridge 0.3), `TicketDeepLinkHost` 47.2 (46.6 exclusive), the landing's islands 11.7, the footer's 3.1, `ChatPopoutHost` 222.6 signed in (§9 row 29). **L2, 2026-10-18, as ruled: within budget** — app baseline 109.8 / 110 kB (0.2 kB of headroom); landing-owned 24.3 / 60 kB (HeroSearch 10.9, LandingBackground 7.9, LandingHeader 4.1, HeroTheatre 1.0, SchemaInjector 0.4); own weight HeroSearch 18.2 / 20 kB, HeroTheatre 3.4 / 12 kB; lazy, each ≤ 35: the hero's `ExploreService.ts` 31.7 and `search-history.ts` 0.7, `constellation-gl.ts` 4.5, `theatre-player.ts` 1.4, `CategorySheet.tsx` 1.0. Reported: `LazyChatHost` 4.1 signed in, the footer 3.4, page totals 137.5 guest / 141.6 signed in, and `ChatPopoutHost` 259.7 (+55 lazy behind it), fetched only once a chat is open. |
| LCP / INP / CLS | Playwright (`npm:playwright-core@1.56.1`, the `deno task test:e2e` harness) against `deno task start`, Chromium with CDP CPU throttling ×4 and a Slow-4G network profile, cold cache, five runs, median reported; `WebVitalsBridge` already reports CLS/LCP/INP to `/api/logs/vitals` and is read back                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| WebGL gates     | The same harness with `prefers-reduced-motion`, `data-motion="reduced"`, Save-Data, `deviceMemory` 2 and a forced `webglcontextlost`: assert no WebGL context is created or that it is torn down                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Pause rules     | Scroll the hero offscreen and toggle `document.visibilityState`; assert the rAF loop stops                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Security stays as is: CSP needs no change (`script-src 'self'`, no `unsafe-eval`; WebGL shader
compilation is not eval; `img-src https:` admits placehold.co; `font-src 'self' data:`;
`connect-src` blocks fetching external textures, so none are fetched).

---

## 8. Assets

No stock photography; every image has width/height or an `aspect-ratio`.

| Use                                                         | Source                                                                                                                                                                   | Notes                                                                  |
| :---------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------- |
| How it works art (6)                                        | `https://placehold.co/320x200?text=Find+your+team` · `Pay+the+stage` · `Team+works` · `Review` · `Approve` · `Withdraw`                                                  | Rendered at 160×96 (768) / 120×80 (1280); replace with product renders |
| Ways to work art (3)                                        | `https://placehold.co/192x192?text=Single+job` · `Ongoing+work` · `Live+session`                                                                                         | Rendered at 96×96                                                      |
| Demo posters (4, SSR)                                       | `https://placehold.co/1280x720?text=Work+board` · `Payment+protection` · `Booking` · `Team+pay`                                                                          | Replaced by real captures once the demos exist                         |
| Board fixture covers (if any)                               | `https://placehold.co/320x180?text=Homepage+design` · `Logo+v2`                                                                                                          | Labelled, per L3                                                       |
| `/features` tile posters (13)                               | `https://placehold.co/800x500?text=<Feature>` for V8, V11, V13, V1, V3, V4, V9, V6, V2, V5, V12, V16, V7                                                                 | Coming-soon tiles have no poster                                       |
| Demo fixture avatars                                        | `/test_images/profile_2.webp`, `profile_3.jpg` … `profile_6.jpg` copied from the root `/test_images/` into `apps/web/static/test_images/` (same filenames; P0 does this) | Seeded profile URLs from the payload win when available                |
| Fallback avatar                                             | `DEFAULT_AVATAR_URL` `/test_images/profile_1.jpg` (already static)                                                                                                       | Rails and suggestions                                                  |
| Rail covers, owner avatars, suggestion thumbnails           | Payload / suggest URLs (`publicObjectUrl`, seeded from `/test_images` by the seed pipeline)                                                                              | Never a second hard-coded copy                                         |
| Money-flow diagram, static constellation, grain             | Inline SVG / data-URI SVG authored in `features/landing`                                                                                                                 | No file assets                                                         |
| og:image                                                    | none yet                                                                                                                                                                 | Owner follow-up (§9); no placehold.co in social cards                  |
| `platform/marketing/hero.webp` (`LandingPayload.heroImage`) | seeded                                                                                                                                                                   | Unused by this direction; L1 may drop it from the payload              |

---

## 9. Open flags and owner follow-ups

Each is also a FLAG in the decision row named; none is resolved silently.

| #  | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Needs                                                                   | Row           |
| :- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- | :------------ |
| 1  | **RULED #285 (A): no ring.** Focus indicator — the owner chose the app-wide no-focus-ring directive over a landing-only ring                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Owner ruling before L1 styles focus                                     | #280 (b)      |
| 2  | **RULED #285 (B): allowlisted.** `lp-` namespace collision with the footer family; it renders outside `.lp-root`; rename after P8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Owner OK to rename to `.site-footer` / `--sf-*` in L1 (or an allowlist) | #280 (a)      |
| 3  | Board mock tokens: keep app tokens (matches the product, inherits #183 (e) 3.57:1) vs L3's `.lp-demo` bridge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Owner ruling                                                            | #280 (c)      |
| 4  | Fonts: system stacks today; a self-hosted OFL serif/sans                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Owner approval if wanted                                                | #280 (f)      |
| 5  | **Workload-report release path** — the assignee can file a report that releases the held escrow to themselves with no approval. Fixed on a peer branch as Decision #290 (`claude/workload-report-no-release`, pending merge); B1, B5 and B6 stay **Blocked** until then, and §5.1 row 1 drops this reason once #290 is on main                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Merge #290; then unblock B1 / B5 / B6                                   | #281 (f)      |
| 6  | Stripe processing fees: docs, seed comment and invoice footer say "passed through"; code does not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Ruling: change the docs or build pass-through                           | #281 (b)      |
| 7  | "Flat 5%" vs admin-negotiated rates — "flat" is out of every page sentence until confirmed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Legal / owner confirmation                                              | #281 (j)      |
| 8  | Legal review of the payment-protection copy (§4.6, FAQ) and of P1's escrow terms before the terms link renders                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Lawyer                                                                  | #281          |
| 9  | Fair Exit time rule (`finance-model.md`) vs the client-chosen tier in code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Doc fix                                                                 | #281 (d)      |
| 10 | Disputes on project work promised in `PRODUCT_MANAGEMENT.md` / PRODUCT_SPEC vs sessions-only code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Doc fix or build                                                        | #281 (e)      |
| 11 | Deadline bonus promised in setup copy ("an extra 10%") and never paid                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Product fix (out of landing scope)                                      | #281 (g)      |
| 12 | V10 currency view held until a live rate feed exists and the FX snapshot claim is fixed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Owner                                                                   | #281 (c)      |
| 13 | One-off service listings cannot be paid at checkout; the "single job" tile now posts a job (`/projects?create=1`) instead of browsing them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Owner may revert to browse once one-off checkout ships                  | #281 (q)      |
| 14 | P4's `medianFundingToApprovalHours` definition — the tile's label must match it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | P4 author                                                               | #281          |
| 15 | SoftwareApplication `offers {price:"0"}` — **removed in L1** with the old `landingJsonLd`; it returns only if the owner confirms "free to join" as a claim                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Owner                                                                   | #281, #286    |
| 16 | og:image for `/` and `/features` (no placeholder in social cards)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Asset                                                                   | #284          |
| 17 | Hero animation cap: typewriter and board loop alternate on one timeline, with a visible "Pause the example" toggle from `--bp-md` and a 5-second typewriter cap below it (WCAG 2.2.2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Owner OK                                                                | #284 (a)      |
| 18 | V1 twice (hero theatre + default stage tab) — kept: passive vs hands-on                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Owner may veto (default the stage to `payments`)                        | #284 (b)      |
| 19 | Theme control in the pill (and the menu sheet), not in L1's pill spec                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Owner OK                                                                | #284 (c)      |
| 20 | The hero picker's "Businesses" option vs `SEARCH_SCOPES` (People & businesses, Articles) site-wide; "Products" is left out until W2 ships                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Owner: follow L2 (as specced) or `SEARCH_SCOPES`                        | #284 (d)      |
| 21 | PublicFooter copy ("micro-agency helper teams", "helpers") breaks #283 on every public page                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Owner: change the footer copy site-wide (Decision #13) or accept it     | #283 (a)      |
| 22 | `/features` on `/` shortcut: its only search (the final CTA instance) takes `/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Owner may veto                                                          | #282 (a)      |
| 23 | Founder / about data, testimonials, customer logos: none on the landing until real (P4 owns the manifesto)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Owner supplies real data later                                          | #281          |
| 24 | `.lp-portal` widens the owner's "scoped to `.lp-root`" for panels the overlay layer moves to `<body>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Owner may veto                                                          | #280 (g)      |
| 25 | "Open app" replaces "Get started" as well as "Sign in" for a signed-in visitor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Owner may veto                                                          | #284 (n)      |
| 26 | The theatre is a static poster below `--bp-md` (the V1 loop plays from `--bp-md` only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Owner may veto                                                          | #284 (o)      |
| 27 | A direct INSERT of a ticket already in a work state skips the work-start gate (AFTER UPDATE only); needs a BEFORE INSERT guard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Product fix (out of landing scope)                                      | #281 (w)      |
| 28 | L4's "build P4 if it hasn't landed" is overridden: P4 is in flight on a peer branch, so the numbers section waits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Owner OK                                                                | #284 (e)      |
| 29 | **RULED #286 (A): strip + defer + rescope.** Options (2), (3) and (4) together: `/` and `/features` strip `?tkv=` with a server 303, `LazyChatHost` defers `ChatPopoutHost` until a chat is open, and the 60 kB counts landing-owned JS while the app baseline is held at its measured 109,799 bytes (#287; §7 has the shape and the L2 measurement). The flag was: initial-JS budget OVER on the app baseline. §7's never-exempt 60 kB counts the global `_app.tsx` islands, which are 86.7 kB on their own (109.7 with the client entry); `/` measures 171.8 kB for a guest and 394.4 kB signed in (§7). Options: (1) trim or lazy-load the global islands on the landing paths (app-wide work); (2) swap `TicketDeepLinkHost` on `LANDING_PATHS` for a small `?tkv=` stripper (−46.6 kB, ~125 kB left); (3) defer `ChatPopoutHost` on `/` for a signed-in visitor (−222.6 kB); (4) rescope the 60 kB to landing-owned JS (11.7 kB today) and track the baseline separately | Ruled 2026-10-18, before L2; L6 enforces the ruled shape (§7)           | #286 (A)      |
| 30 | **L2 board model vs the product (FLAGS #287 (B), (C)).** (B) §5 K2 and the V1 frame-1 draft say a described, priced, unbought ticket's tag reads Draft; the product's card reads Needs funding (`fundingTagState`), and the board model's own header count already counted it. The model now tags it the product's way. (C) §4.1 drew "Homepage design (Funded)" in In Progress; the product's card shows no tag in a work lane and #283 (B) keeps the tags verbatim ("In progress"). The model now leaves the work lanes untagged, as the card does. Either can be reversed by the owner before L3 builds V1 on the model                                                                                                                                                                                                                                                                                                                                                    | Owner ruling before L3                                                  | #287 (B), (C) |
