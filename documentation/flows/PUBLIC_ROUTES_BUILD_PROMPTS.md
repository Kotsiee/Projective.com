# Public & Utility Routes — Build Prompts

> **Status: WORK ORDERS, not binding.** One self-contained Claude Code prompt for each public or
> utility surface in the "Public & Utility Routes" brief: `/legal`, `/help`, `/contact`, `/about`,
> `/changelog`, `/articles` and `/feedback`. It also carries the **landing page track** (L0–L6): a
> new, deliberately off-system marketing home page at `/` whose hero must search Explore. Run them
> **in order** (§0), each in its own fresh session. Paste the standard header (§1) above every
> prompt, and for the landing track, the landing addendum (§2.0) under it.
>
> These prompts were written against `main` @ `9ef9785`. Before writing them I read `ROUTING.md`,
> the `PRODUCT_SPEC.md` sitemap, `packages/types/profile/reserved.ts`, the token sheet
> `packages/ui/styles/index.css`, the shell shortcuts, and decisions #13, #43, #92/#157, #96,
> #147/#148 and #171. Where the brief collides with a source document, the prompt **stops and asks**
> (§0.1) instead of choosing a side. That is root `CLAUDE.md` §8.

---

## 0. Run order, decisions and repo facts

| #  | Prompt                                        | Depends on | Why this order                                                                                                                                        |
| :- | :-------------------------------------------- | :--------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 | Shared editorial foundation                   | —          | The document reader, table of contents, reading progress, print sheet, SEO helpers, reserved handles and static images are used by P1, P2, P5 and P6. |
| P1 | `/legal` hub + `/legal/[slug]`                | P0         | The footer's Privacy and Terms links point at `/help` today, and that gap blocks a launch.                                                            |
| P2 | `/help` hub + `/help/[...path]`               | P0         | Replaces the `PagePlaceholder` that sits there now.                                                                                                   |
| P3 | `/contact`                                    | P0         | Needs the intake table and a file dropzone.                                                                                                           |
| P4 | `/about`                                      | P0         | Needs a live-metrics read.                                                                                                                            |
| P5 | `/changelog` + RSS                            | P0         | —                                                                                                                                                     |
| P6 | `/articles` + `/articles/[slug]`              | P0         | Read §0.1 (b) first.                                                                                                                                  |
| P7 | `/feedback` + global `?feedback=open` overlay | P0         | New schema, moderation and the shell overlay.                                                                                                         |
| P8 | Integration sweep                             | P1–P7      | Sitemap, robots, footer and megamenu, docs, Playwright smoke.                                                                                         |
| L0 | Landing: art direction & decisions            | P0         | Choose the layout, style, background and visualizers; log the design-system exemption. Nothing is built until it lands.                               |
| L1 | Landing: decoupled shell, theme, background   | L0         | Full-bleed route, scoped `lp-` theme, performance budget, WebGL background with fallbacks.                                                            |
| L2 | Landing: hero + Explore search                | L1         | **The one hard requirement**: the hero searches Explore.                                                                                              |
| L3 | Landing: visualizer engine + first demos      | L2         | One tabbed stage that swaps simulations, so the page never shows ten widgets at once.                                                                 |
| L4 | Landing: remaining sections                   | L3, P4     | Comparison, how it works, ways to work, payment protection, live numbers (P4's metrics service), pricing, FAQ, final CTA.                             |
| L5 | `/features` extension page                    | L3         | The full visualizer catalogue the landing page links into, so the home page stays light.                                                              |
| L6 | Landing: QA & launch gate                     | L1–L5      | Performance, accessibility, honesty (claims table), leak check, SEO, Playwright.                                                                      |

### 0.1 Decisions you must make (the relevant prompt stops for each)

|       | Collision                                                                                                                                                                                                                                                                                                                                                                                                          | What the prompt proposes                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| :---- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **a** | The `PRODUCT_SPEC.md` sitemap lists **`/legal` as a Dashboard route** with sub-paths `audit-packs` and `transfers`, the IP chain-of-title workspace. The brief makes `/legal/*` a public document hub.                                                                                                                                                                                                             | Public documents at `/legal` and `/legal/[slug]`. The signed-in IP workspace moves to `/legal/workspace/{audit-packs,transfers}`, which is reserved and auth-guarded, or to `/settings/legal`. **P1 asks you.**                                                                                                                                                                                                                                                                                       |
| **b** | `/articles/[slug]` is listed under **Dashboard** ("freelancer stories linked from `/become-partner`"). `catalogue.articles` already renders as the `article` archetype in `/view/[entity]` (Decision #43, `features/view/core/entity-archetype.ts:88`).                                                                                                                                                            | `/articles/[slug]` becomes the canonical public reader for **platform editorial** articles. `/view/art-…` keeps member-authored posts. Each page emits one `<link rel="canonical">` and nothing is rendered twice. **P6 asks you.**                                                                                                                                                                                                                                                                   |
| **c** | The brief's role groups say "Client, Contributor, Squad". The product's words are Client, Freelancer, Team, Business.                                                                                                                                                                                                                                                                                              | Use the product's words. "Squad" would be a new term, and introducing one is a spec change. **P2 asks only if you want the new words.**                                                                                                                                                                                                                                                                                                                                                               |
| **d** | The brief's feedback statuses are `Planned`, `In Progress` and `Shipped`. `PRODUCT_MANAGEMENT.md` §3 forbids bespoke statuses.                                                                                                                                                                                                                                                                                     | Map them onto the unified machine: `Ready` shows as "Planned", `In Progress` as "In progress", `Complete` as "Shipped", plus `Archived`, and an "Under review" intake state (`Backlog`). Displayed labels differ; the stored state does not. **P7 asks you.**                                                                                                                                                                                                                                         |
| **e** | **Legal text.** I won't write it as if it were final law.                                                                                                                                                                                                                                                                                                                                                          | Every legal document ships with a visible "Draft — pending legal review" banner and `noindex`. You remove both only after a lawyer signs off. Clause **content** is grounded in real product behaviour from `PRODUCT_SPEC.md` (5% fee, Fair Exit tiers, 7-day pending window, 48-day invite cooldown, KYC gates), so a lawyer reviews facts, not fiction.                                                                                                                                             |
| **f** | **About-page metrics** ("Total Value Protected", take rate, delivery velocity).                                                                                                                                                                                                                                                                                                                                    | Show only real aggregates computed server-side, with a minimum-threshold rule: below it the tile is hidden, never padded. Take rate is read from `security.platform_params.platform_fee_bp`. Investors will check these figures.                                                                                                                                                                                                                                                                      |
| **g** | **The landing page breaks the design system on purpose.** Root `CLAUDE.md` §3 makes token-only CSS, "no UI-lib deps", the anti-card rules and the `backdrop-filter` limit merge gates.                                                                                                                                                                                                                             | One decision row granting a **scoped exemption**: the `/` and `/features` routes only, under an `lp-` CSS namespace with its own palette, type and motion that cannot leak into the app. **Not exempt:** accessibility, reduced motion, islands-never-touch-the-DB, thin routes, security, SEO and the performance budget. **L0 asks you** to confirm the scope and the dependency policy (zero-dependency raw WebGL2 recommended; at most one small, version-pinned WebGL helper if you approve it). |
| **h** | **Claims on the page.** The landing-page draft states things the code doesn't back: "0% escrow capital lost", "assembly under 4 minutes", "Deno/Rust architecture", "virus-checked files" (the scanner is still a sniff; wave 8 H3), "cryptographic IP deeds", royalties (spec only), tool integrations (connections are refused today), the tax-pot auto-skim (wave 8 F2), and competitor fees ("Upwork 10–20%"). | Every claim must be **shipped and true**, or a real live number from the metrics service, or labelled "Coming soon". Competitor comparisons cite a current public source with a date and go through the legal review in (e). L0 builds a claims table; L6 checks every sentence against it.                                                                                                                                                                                                           |
| **i** | **The `⌘K` hint.** `Cmd+K` is reserved for a platform command palette that does not exist yet (`shell/core/shortcuts.ts`).                                                                                                                                                                                                                                                                                         | The hero shows the shortcut that works today: `/` focuses the hero search, and `Ctrl/Cmd+/` the header search. Show `⌘K` only once the palette ships. **L0 asks** whether to build the palette in this track.                                                                                                                                                                                                                                                                                         |
| **j** | **Vocabulary.** The draft uses "Squads", "micro-agencies", "TVL" and "CREATE taxonomy" in user-facing copy.                                                                                                                                                                                                                                                                                                        | Plain language for everyone (§2.6 glossary): "ready-made team", "payment protection", "money protected so far". Product words (Team, Client, Freelancer) remain the stored and spec terms (c). "Escrow" stays in metadata, the FAQ schema and secondary explanatory copy for SEO.                                                                                                                                                                                                                     |
| **k** | **Explore deep-link contract.** The draft routes to `/explore?q=&scope=` with scopes "Pipelines, One-Offs, Sessions, Squads".                                                                                                                                                                                                                                                                                      | The real contract is `/explore?q=&category=` with `category ∈ all, users, freelancers, teams, businesses, services, projects, products, articles` (`packages/types/explore/items.ts:31`), built with `explorePath()` (`features/marketing/core/megamenu-data.ts:46`). Project types (one-off, pipeline, session) are filters inside Explore, not search categories. No decision needed; the prompts use the real contract.                                                                            |

### 0.2 Repo facts every prompt relies on

- **Image rules (from the brief), adapted to this repo.** The root `/test_images/` folder is **not
  web-served**. Only `apps/web/static/test_images/` is (today: `banner_5.jpg`, `profile_1.jpg`).
  - **UI placeholders** not backed by a DB row use `https://placehold.co/{w}x{h}?text={Label}` (CSP
    `img-src` already allows `https:`; `apps/web/utils/csp.ts:70`).
  - **Seed-shaped imagery** (avatars, covers, logos, evidence): copy the exact files you need from
    `/test_images/` into `apps/web/static/test_images/`, keep the filenames, and reference them as
    `/test_images/<file>`. For anything already in the DB (article covers, author avatars from
    seeded profiles), use the URL the seeded row already carries. The seed pipeline uploads
    `/test_images` into storage (`supabase/seeds/gen/images.ts`), and you never hard-code a second
    copy of that.
  - Available files: `banner_1-9`, `brandmark_1-7`, `product_1-6`, `profile_1-8`, `service_1-7`.
    Check the extensions with `ls test_images`.
  - No unresolved imports, and no external stock URLs other than `placehold.co`.
- **Reserved handles.** `/legal`, `/contact`, `/about`, `/help` and `/articles` are already in
  `RESERVED_HANDLES`. **P0 reserved `changelog`, `feedback` and `features`** (2026-10-17) in
  `packages/types/profile/reserved.ts` **and** `org.fn_is_reserved_handle` (SQL twin), keeping
  `workspace.contract.test.ts` green (ROUTING.md §Reserved-handle precedence). No later prompt adds
  them again.
- **Tokens** (`packages/ui/styles/index.css`) — use these names, never raw values:

  | Family          | Tokens                                                                                                                                                                     |
  | :-------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Type families   | `--font-sans`, `--font-reading`, `--font-mono`                                                                                                                             |
  | Type scale      | `--text-2xs` … `--text-3xl`                                                                                                                                                |
  | Leading         | `--leading-tight`, `--leading-snug`, `--leading-normal`, `--leading-relaxed`                                                                                               |
  | Tracking        | `--tracking-tight`, `--tracking-normal`, `--tracking-wide` (0.08em, used for "wide-tracked caps")                                                                          |
  | Weights         | `--fw-light` … `--fw-bold`; headings stay below `--fw-bold` (gate 8)                                                                                                       |
  | Measure         | `--measure` (68ch), `--measure-narrow`, `--measure-wide`                                                                                                                   |
  | Space           | `--space-0` … `--space-8`, `--space-px`                                                                                                                                    |
  | Surfaces        | `--bg` → `--surface-1` → `--surface-2` → `--surface-3`, solid only                                                                                                         |
  | Lines           | `--hairline`, `--border-subtle`                                                                                                                                            |
  | Text and action | `--text-secondary`; `--primary` / `--on-primary`; `--accent` / `--on-accent` (Decision #157)                                                                               |
  | Motion          | `--dur-fast` (150ms), `--dur-medium` (250ms), `--dur-press`; easings `--ease-standard`, `--ease-emphasized`, `--ease-exit`; springs `--spring-snappy`, `--spring-standard` |
  | Layout          | `--bp-sm`, `--bp-md`, `--bp-lg`, `--bp-xl`; `--z-*`; `--elevation-*`                                                                                                       |

  The dyslexic overlay redefines the font, tracking and leading tokens. Reduced motion zeroes the
  `--dur-*` tokens. So if you use tokens, both accessibility channels work for free. The brief's
  "150–250ms, mechanical, no bounce" maps to `--dur-fast` / `--dur-medium` with `--ease-standard`.
- **Buttons.** Use the Button Interaction Matrix (Decision #157, DESIGN_SYSTEM §B.8.1): one filled
  primary per region; secondary actions are tonal or outline; press feedback is `transform: scale()`
  only (gate 12). Do not invent tiers.
- **Shortcuts** (`apps/web/features/shell/core/shortcuts.ts`): taken are `/` (surface search),
  `Ctrl/Cmd+/` (header search), `Ctrl/Cmd+B` (sidebar); `Cmd+K` is reserved for the command palette.
  Add new shortcuts as pure predicates there, and skip `isEditableTarget`.
- **Existing pieces to reuse, not rebuild:**
  - `features/marketing/{islands/SiteHeader, components/PublicFooter, islands/SchemaInjector, core/seo.ts, islands/NewsletterForm}`
  - `api/newsletter/subscribe.ts`
  - `packages/backend/core/pdf.ts` (text-only PDF writer)
  - the files upload pipeline (`api/files/upload-init.ts`, `upload-complete.ts`; scan states)
  - the overlay family (`packages/ui/overlay`, Decision #171: Dialog/Drawer, one `--drawer-w`)
  - `components/PagePlaceholder.tsx`, which is what `/about` and `/help` render today and is what
    you replace
- **Content storage.** All _markdown_ must live under `documentation/`, so product content (legal,
  help, changelog) is **not** markdown files in the app. It is Zod-validated TypeScript content
  modules (`features/<x>/core/content/*.ts`) whose schema lives in `@projective/types`.
  User-generated content (feedback, contact requests, helpfulness votes) goes in Postgres. Editorial
  articles stay in `catalogue.articles`.
  > **Superseded for help, changelog, articles, helpfulness votes and feedback (owner, 2026-10-17;
  > Decision #274).** Help, changelog and Projective's articles are rows in the `editorial` schema,
  > authored as Zod-validated content sources in `packages/backend/services/editorial/content/` and
  > emitted into seed migrations by `deno task db:editorial:generate`; Projective's articles are
  > canonical at `/articles/[slug]` and `catalogue.articles` keeps member posts only. Helpfulness
  > votes and the feedback board live in the `community` schema (not `ops` / `comms`), as does the
  > newsletter. Legal stays TypeScript modules; contact requests stay in `ops`. Every shared SQL
  > file carries a named region per surface — fill only yours.

---

## 1. Standard header — paste above EVERY prompt

```text
You are building a public route in the Projective monorepo (Deno 2.x; apps/web Fresh 2.x + Vite +
Preact + @preact/signals; packages/ui pure-CSS BEM design system; packages/types Zod SSOT;
packages/backend fat services; Supabase Postgres with RLS).

Before writing code:
  1. Read root CLAUDE.md and every sub-directory CLAUDE.md on the paths you touch (packages/ui/
     CLAUDE.md, documentation/CLAUDE.md, documentation/database/CLAUDE.md), then
     documentation/reference/guardrails.md, documentation/reference/pr-checklist.md,
     DESIGN_SYSTEM.md Parts B and E, and ROUTING.md.
  2. Read documentation/flows/PUBLIC_ROUTES_BUILD_PROMPTS.md §0 (run order, decisions a–f, repo
     facts: image rules, reserved handles, tokens, shortcuts, reusable pieces, content storage).
  3. Grep documentation/reference/decisions/README.md for your surface and read the decision files
     it names (at minimum #13 footer, #43 view templates, #96 editorial column, #147/#148 PII and
     moderation, #157 buttons, #171 overlays).

Global asset rules (merge gate for these routes):
  - UI or graphic imagery NOT backed by a DB row → https://placehold.co/{w}x{h}?text={Label}, with
    real alt text.
  - Imagery that would come from the DB (avatars, covers, logos, evidence) → the seeded row's own
    URL if one exists; otherwise copy the file from /test_images/ into
    apps/web/static/test_images/ (same filename) and reference /test_images/<file>.
  - No unresolved imports, no raw external stock URLs, every <img> has width/height (or
    aspect-ratio) so nothing shifts.

Hard rules:
  - Routes are thin (parse, Zod, guard) and re-export a page controller from
    apps/web/features/<group>/<sub>/; feature folders use only components/ islands/ styles/ hooks/
    wrappers/ types/ core/ (+ routes/ services/). Islands fetch /api/* only, never Supabase. Logic
    lives in @server/services/* returning ServiceResult<T>.
  - Styling: pure CSS, strict BEM, tokens only (var(--*); no hex, radius, duration or shadow
    literals); no inline styles, no Tailwind, no UI libraries. Anti-card (static content never
    boxed; solid region tones; no nested cards). Anti-tagification (non-actionable metadata is
    inline --text-secondary middot text; containers only for controls, lifecycle statuses, required
    disclosures, counts). Four type registers; headings < --fw-bold; changing figures tabular-nums.
    backdrop-filter only on viewport-pinned top bars or floating mobile sheets, on a ::before
    underlay. Every control that renders does something (gate 11).
  - Schema changes edit the consolidated migrations IN PLACE in the right category file and land
    with their Zod schema and documentation/database/* in the same change. New lifecycles go into
    PRODUCT_MANAGEMENT.md (no bespoke statuses; nothing hard-deleted — Archived). New simulatable
    axes get a Dev Context Switcher control. New or changed components update DESIGN_SYSTEM.md §C.1.
  - JSDoc on exports; // #region groupings; no meta-comments.
  - New contradiction between source docs → add a decision-log row (newest decisions-*.md + README
    index) and ASK ME. Do not pick a side.

Verification before you commit:
  - deno task check, deno task lint, deno task test:unit (four theme-engine failures are known).
  - deno fmt only on the files you touched.
  - If SQL changed: deno task db:reset plus a probe under supabase/probes/.
  - Run the route in `deno task dev` and check it with Playwright at 375px, 768px and 1280px, in
    light and dark, with prefers-reduced-motion, and with the dyslexic and high-contrast overlays.
    Attach the screenshots to your final message.
Commit on a new branch; do not open a PR unless I ask.
```

---

## P0 · Shared editorial foundation

```text
TASK: Build the shared primitives that /legal, /help, /changelog and /articles all use, so those
prompts compose instead of duplicating.

1. ROUTE TARGET & SCOPE
- No user-facing route of its own. Deliverables:
  * packages/ui/display (or the right taxonomy folder per DESIGN_SYSTEM §C):
    - DocumentLayout: an editorial reading column at --measure, with an optional sticky TOC rail
      and an optional meta rail.
    - TableOfContents: built from h2/h3 ids; scroll-spy via IntersectionObserver; aria-current on
      the active item.
    - ReadingProgress: a 2px bar pinned under the site header; role="progressbar" with
      aria-valuenow; hidden from AT when the page is not long.
    - Prose: typographic defaults for long-form body.
    - AnchorHeading: a heading with a copy-link affordance that is a real <a href="#id">.
    - PrintStylesheet: a @media print layer.
  * apps/web/features/marketing/core/seo.ts: extend with pageMeta({title, description, path,
    noindex?, ogImage?}) and JSON-LD builders: Article, TechArticle, FAQPage, BreadcrumbList,
    Organization, WebPage, ContactPage, AboutPage, CollectionPage. Inject through the existing
    SchemaInjector island; never hand-write <script> tags in pages.
  * packages/types/content/: Zod schemas for content modules — Doc (id, slug, title, summary,
    updatedAt, version, sections[{id, heading, tldr?, body: ContentNode[]}]) and ContentNode (a
    small typed AST: p, h3, list, quote, code{lang, text}, image{src, alt, w, h}, callout{tone},
    table). Write a renderer (ContentRenderer) in packages/ui that maps nodes to semantic HTML. No
    dangerouslySetInnerHTML and no markdown parser dependency.
  * Reserved handles: add "changelog" and "feedback" to packages/types/profile/reserved.ts AND
    org.fn_is_reserved_handle (edit the existing migration in place); keep
    workspace.contract.test.ts green.
  * Copy into apps/web/static/test_images/ ONLY the /test_images files P1–P7 will reference
    (start with profile_2-8 for authors, banner_1-4 for covers, brandmark_1-3 for logos). Keep
    filenames; list what you copied in the commit message.

2. LAYOUT & COMPONENT ARCHITECTURE
- DocumentLayout grid:
  * ≥ --bp-lg: TOC rail (sticky, top offset = header height) | reading column (--measure) | meta
    rail (optional).
  * --bp-md to --bp-lg: TOC collapses to a disclosure ("On this page") above the body.
  * < --bp-md: single column; TOC becomes a bottom-sheet trigger.
  * Responsive purely in packages/ui CSS (gate 3: no app-side overrides).
- Separation by spacing → tonal tint → weight → one hairline (gate 1). The TOC rail is NOT a box:
  it is text on --bg with the active item marked by weight plus a 2px --primary inline-start bar.

3. DESIGN SYSTEM & STYLING DIRECTIVES
- Registers:
  * Display: --text-3xl, --fw-semibold, --tracking-tight, --leading-tight.
  * Section caps: --text-2xs, uppercase, --tracking-wide, --fw-medium, --text-secondary.
  * Body: --font-reading at --text-base, --leading-relaxed.
  * Meta: --font-mono at --text-xs, --text-secondary, tabular-nums.
  * Section caps must not be the only thing separating levels from body (gate 8: never weight
    alone; use size and case too).
- Motion: TOC active-state and progress transitions use --dur-fast with --ease-standard;
  scroll-behavior smooth only under prefers-reduced-motion: no-preference.
- Print: hide header, footer, TOC, progress and buttons; body in --font-reading at 11pt; print
  link URLs after anchors (a[href^="http"]::after); page-break-inside: avoid on headings and
  tables. Token values only (map tokens in the print layer, no literals).

4. DATA CONTRACT & ASSET MOCKING
- Pure presentational components; props typed from @projective/types/content. TOC and progress
  state are signals local to the island. Islands: TableOfContents.island (scroll-spy) and
  ReadingProgress.island only; everything else is SSR.
- Write one sample Doc fixture in packages/types/content/fixtures.ts using placehold.co for a
  figure and /test_images/banner_1.jpg for a cover, so P1–P6 tests can render it.

5. SEO, PERFORMANCE & ACCESSIBILITY
- Landmarks: <main id="main">, <nav aria-label="On this page"> for the TOC, <article> for
  content. Skip link to #main if the public layout lacks one.
- Heading ids are slugified and stable; duplicates are suffixed.
- Zero layout shift: the TOC rail width is reserved, images carry dimensions, and the progress bar
  is absolutely positioned.
- Unit tests: slugify/duplicate ids, the TOC tree from content, every ContentNode renderer, and
  each JSON-LD builder (valid shapes).
- Update DESIGN_SYSTEM.md §C.1 for every new component, and ROUTING.md reserved-handle text.
```

---

## P1 · Legal & compliance hub — `/legal`, `/legal/[slug]`

```text
TASK: Build the public legal hub and its child documents.

DECISION (a) IS RULED — owner, 2026-10-17 (Decision #270). Do not stop for it: public documents at
/legal + /legal/[slug]; the IP workspace at /legal/workspace/{audit-packs,transfers} (reserved,
auth-guarded by the (dashboard) group). Built: the sitemap, ROUTING.md and the decision row are
updated, and the workspace routes render the PagePlaceholder until the workspace is built.
The original STEP 0, kept for the record:

STEP 0 — STOP AND ASK ME about decision (a) in PUBLIC_ROUTES_BUILD_PROMPTS.md §0.1. PRODUCT_SPEC's
sitemap lists /legal as a Dashboard route (index, audit-packs, transfers). Propose: public docs at
/legal + /legal/[slug], with the IP workspace at /legal/workspace/{audit-packs,transfers}
(reserved, auth-guarded) or /settings/legal. Wait for my answer, then add the decision row and
update the PRODUCT_SPEC sitemap and ROUTING.md accordingly.

1. ROUTE TARGET & SCOPE
- Routes:
  * apps/web/routes/(public)/legal/index.tsx — the hub.
  * apps/web/routes/(public)/legal/[slug].tsx — one document.
  * apps/web/routes/(public)/legal/[slug]/pdf.ts — PDF export.
- Page controllers in apps/web/features/legal/{hub,document}/.
- Slugs: terms, privacy, cookies, ip-transfer-deed, escrow-terms, acceptable-use. An unknown slug
  is a real 404.
- Standalone routes (not overlays).

2. LAYOUT & COMPONENT ARCHITECTURE
- Hub: display title "Legal"; a one-paragraph intro; then a plain list (NOT cards) of the six
  documents, each row showing title (section-header register), a one-line summary (body) and meta
  in mono ("v2.1 · Updated 2026-10-01"). Rows are links; hover is a tonal tint on --surface-1.
  A side note links /contact?intent=support for legal questions.
- Document page = P0 DocumentLayout:
  * TOC rail: all six documents as a nav (current one expanded into its sections) — the
    "synchronized multi-document navigation".
  * Reading column:
    - document title, version, effective date, a "Draft — pending legal review" disclosure
      (required-disclosure container, allowed by anti-tagification) until a reviewedAt is set;
    - then sections. Each section opens with a "Plain-English summary" block: a callout node on
      --surface-1, no border, prefixed by a section-caps label. The clause body follows in
      --font-reading.
  * Meta rail (≥ --bp-lg): version picker, "Compare with…" control, Print, Download PDF.
- ReadingProgress pinned under the header.
- Version compare: ?compare=<fromVersion> renders a clause-level diff against the current version.
  Changed clauses are marked with an inline-start --accent bar plus a "Changed in vX" meta line;
  added text is <ins> and removed text is <del>, both styled with tokens. Unchanged clauses
  collapse behind "Show n unchanged clauses". Compute the diff server-side, word-level, in a pure
  function in features/legal/core/diff.ts, with unit tests.

3. DESIGN SYSTEM & STYLING DIRECTIVES
- Swiss discipline:
  * one reading column at --measure;
  * clause numbers in --font-mono, --text-secondary, tabular-nums, hanging in the gutter at
    ≥ --bp-md;
  * no decoration beyond one hairline above each section.
- Buttons: Download PDF is the region's single filled primary; Print and Compare are
  tonal/outline. The version picker is a field from @projective/ui fields.
- Print stylesheet from P0. The draft banner prints.

4. DATA CONTRACT & ASSET MOCKING
- Content: features/legal/core/content/<slug>.ts exporting Doc[] (all versions, newest first),
  validated against @projective/types/content at module load in a unit test.
- Write substantive draft clauses GROUNDED IN REAL PRODUCT RULES. Cite PRODUCT_SPEC.md sections
  in a JSDoc above each clause so a lawyer can trace them:
  * Escrow Terms: escrow lock points, the 5% platform fee from security.platform_params, Fair
    Exit 25/50/75 tiers, the 7-day pending window (top-ups immediate, Decision #191), disputes and
    no-show (Decisions #211/#212), refunds.
  * Terms: accounts, the age rules (13+, under-18 restricted from buying/selling — G1), the 48-day
    invite cooldown, the KYC/payout gate before earning (Decision #196).
  * Privacy: categories of data actually stored (grep org.users_public, comms, finance tables),
    processors (Supabase, Stripe, Stripe Identity), retention per PRODUCT_SPEC (financial records
    ~7 years), the account erasure sweep.
  * Cookies: list the REAL cookies the app sets — sb-access-token, sb-refresh-token,
    pj_session_transient, the pending-verification cookie, the oauth verifier, any pj.dev.* (dev
    only). Grep apps/web/utils and features/auth to build the table.
  * IP Transfer Deed: the chain-of-title rules in PRODUCT_SPEC "Chain of Title".
  * Acceptable Use: Decisions #147/#148 (PII leakage, moderation).
  Two versions of at least Terms and Escrow Terms, so Compare has something to show.
- Every document sets noindex while it is a draft (reviewedAt null).
- PDF: [slug]/pdf.ts → a LegalBackendService.documentPdf(slug, version) using
  packages/backend/core/pdf.ts (text-only). Include the version, effective date and draft
  watermark text. Content-Disposition attachment; cache by version.
- Search params: ?v=<version> (view an older version), ?compare=<version>. Both are reflected in
  the canonical URL rules: the canonical is always the current version without params.
- No imagery needed; if the hub wants a graphic, use https://placehold.co/1200x400?text=Legal.

5. SEO, PERFORMANCE & ACCESSIBILITY
- JSON-LD:
  * Hub: WebPage + BreadcrumbList.
  * Document: WebPage with dateModified, version and inLanguage.
  * Meta from pageMeta().
- Landmarks: TOC <nav aria-label="Legal documents">; diff regions use aria-describedby on "Changed
  in vX"; ins/del carry visually-hidden "added"/"removed" text for screen readers.
- Fully SSR; the only islands are TOC scroll-spy, progress and the version/compare controls
  (which navigate via URL, so it works without JS as a <form method="get">).
- Update PublicFooter (Decision #13): Privacy Policy → /legal/privacy, Terms of Service →
  /legal/terms, add Cookie Policy. Update the PRODUCT_SPEC sitemap and ROUTING.md route table.
```

---

## P2 · Help Center & knowledge base — `/help`, `/help/[...path]`

```text
TASK: Replace the PagePlaceholder at apps/web/routes/(public)/help/[...path].tsx with a real help
centre.

Decision (c), §0.1: use the product's role words (Client, Freelancer, Team, Business). Only ask me
if you think the brief's "Contributor"/"Squad" should be introduced; that would be a spec change.

1. ROUTE TARGET & SCOPE
- Keep the existing catch-all apps/web/routes/(public)/help/[...path].tsx (it also serves /help).
  Dispatch:
  * no path → hub;
  * one segment that is a category → category page;
  * category/article → article;
  * anything else → 404.
- Controllers in apps/web/features/help/{hub,category,article}/.
- The omnibar search is an overlay inside the help surface, addressable as ?q=<query> (shareable;
  closes by removing the param).
- API: GET /api/help/search?q= and POST /api/help/feedback (helpfulness).

2. LAYOUT & COMPONENT ARCHITECTURE
- Hub:
  * Display title "How can we help?" and the omnibar trigger: a large search field that opens the
    overlay. Shortcut "/" via the existing isFocusSearchShortcut; don't add a new one.
  * "Start here by role": four columns (Client · Freelancer · Team · Business), each a section-caps
    label with 4–6 article links underneath. Text lists, NOT cards.
  * "Topics": categories — Getting started, Projects & stages, Escrow & payments, Revisions &
    approvals, Disputes & Fair Exit, Payouts & verification, Teams & businesses, Account &
    security. Each is a row with an icon from @projective/ui icons, the title, an article count (a
    count container is allowed) and a one-line description.
  * The FAQ absorbed: the eight most-asked questions as <details> disclosures; their answers link
    to the full article.
  * Footer band: "Still stuck?" → /contact?intent=support (filled primary) and the dispute route
    for signed-in users (tonal).
- Category page: breadcrumb, title, description, article list (title, summary, mono read-time
  meta).
- Article page = P0 DocumentLayout with a sticky nested TOC, prev/next within the category, "Was
  this helpful?" (Yes/No, then an optional 280-char textarea on No) and "Related articles".
- Omnibar overlay (packages/ui/overlay Dialog, Decision #171):
  * input; instant results grouped by category with matched-term highlighting via <mark>;
  * arrow-key navigation (aria-activedescendant), Enter opens, Esc closes;
  * "Recent searches" (last 8, localStorage via a try/catch helper — a per-viewer convenience) with
    a Clear control.
  * It never shifts layout: the dialog has a fixed max-height and results scroll inside it.

3. DESIGN SYSTEM & STYLING DIRECTIVES
- High-density but calm: category rows on --bg with --surface-1 hover tint; icons at a single size
  token; one hairline between groups.
- Helpfulness block: plain text plus two outline buttons; on submit it becomes a quiet thank-you
  line. No toast spam.
- Code samples in articles: --font-mono on --surface-2, no border.
- Motion: overlay enter --dur-medium --ease-emphasized, exit --dur-fast --ease-exit.

4. DATA CONTRACT & ASSET MOCKING
- SUPERSEDED BY DECISION #274 (owner, 2026-10-17) — it overrides the Content and Helpfulness
  bullets below; see documentation/database/{editorial,community}/Tables.md:
  * Content is rows in the `editorial` schema, not features/help/core/content/. Row schemas go in
    @projective/types/editorial/help.ts (name the record HelpCentreArticle…: HelpArticle is taken),
    records in packages/backend/services/editorial/content/help.ts (split into content/help/*.ts
    if long), tables in the [help] region of 00000024; run `deno task db:editorial:generate`
    (writes 00005071) and read through readEditorialTable (EDITORIAL_BACKEND_LIVE).
  * Helpfulness votes are a `community` table in the [help_feedback] region of 00000025, written
    through a definer door in [community.help_feedback] of 00001320 and read through
    readCommunityTable (COMMUNITY_BACKEND_LIVE) — not ops.help_feedback.
- Content: features/help/core/content/ — categories.ts and one module per category exporting
  HelpArticle (the Doc schema from P0 plus category, roles[], related[], faq?: boolean).
  Write ~30 real articles grounded in actual behaviour. Each article's JSDoc cites the
  PRODUCT_SPEC section or decision it explains. For example:
  * how stage funding works (prepaid escrow, Decision #197);
  * free vs paid revisions;
  * Accept & release payment (#194);
  * Fair Exit (#198);
  * no-show claims and disputes (#211/#212);
  * the payout-ready gate (#196);
  * the 7-day pending window;
  * withdrawals and minimums;
  * age rules;
  * the 48-day invite cooldown.
  Inaccurate help is worse than none: if behaviour is unclear, read the code and say so in the
  commit message.
- Search: HelpBackendService.search(q) builds an in-memory index at boot (title > headings > body
  weighting, prefix match, small typo tolerance). It is pure and unit-tested. Do not add a search
  dependency. GET /api/help/search returns {results:[{slug, title, category, snippet,
  highlights}]} via Zod.
- (Superseded by #274, above: the table lives in `community`, not `ops`.)
- Helpfulness: a new table ops.help_feedback (article_slug, helpful bool, comment text null,
  user_id null, created_at; no update/delete for clients; rate-limited insert). Put RLS in the
  policies file and grants in 00002520, with Zod + documentation/database/ops. Run comments
  through comms.mask_pii before storage (Decision #147). The route is anon-allowed and rate-limited
  (packages/backend/core/rate-limit.ts).
- Imagery:
  * article screenshots → https://placehold.co/1200x675?text=<Screen+name> with real alt text;
  * author/maintainer avatar (if shown) → /test_images/profile_3.jpg (copied in P0).

5. SEO, PERFORMANCE & ACCESSIBILITY
- JSON-LD:
  * Hub: CollectionPage + FAQPage (from the FAQ disclosures).
  * Category: CollectionPage + BreadcrumbList.
  * Article: TechArticle (headline, dateModified, articleSection) + BreadcrumbList.
- Landmarks: role="search" on the omnibar form; the dialog is labelled; results are a listbox
  with options.
- Zero JS required to read articles. Search degrades to a GET form → /help?q= rendering
  server-side results.
- Update ROUTING.md (help dispatch), the PRODUCT_SPEC sitemap, DESIGN_SYSTEM §C.1, and the megamenu
  "Pricing → /help" link if a pricing article exists.
```

---

## P3 · Contact & enterprise routing — `/contact`

```text
TASK: Build a multi-intent contact page with a real intake pipeline.

1. ROUTE TARGET & SCOPE
- Routes:
  * apps/web/routes/(public)/contact.tsx — standalone. Controller in
    apps/web/features/contact/page/.
  * POST /api/contact (intake).
  * POST /api/contact/attachments/init and /complete, which reuse the files upload pipeline and a
    dedicated private bucket.
- Intent is URL state: ?intent=sales|support|dispute|security (default support). Switching
  intent updates the URL (history.replaceState) so every variant is shareable.

2. LAYOUT & COMPONENT ARCHITECTURE
- Split canvas ≥ --bp-lg:
  * Left: the intake column (60%).
  * Right: the "operational transparency rail" (40%) on --surface-1 (solid), showing:
    - verified entity info (legal name, company number, registered address, support hours — all
      placeholders "XXXX-XXXX" until I supply them);
    - a platform status line (a dot + "All systems operational" read from an existing health
      endpoint if one exists; otherwise omit it — never fake it);
    - response-time expectations per intent;
    - links to /help and /legal.
  * < --bp-lg the rail stacks below the form; content moves, it is not duplicated.
- Intent switcher: a segmented control (radiogroup) from @projective/ui with four options, each
  with a one-line description.
- The form adapts per intent:
  * sales: name, work email, company, company size (select), budget range (select), message, plus
    "Book a discovery call".
  * support: name, email, account email (if different), topic (select: help categories from P2),
    message, attachments.
  * dispute: for SIGNED-IN users, show their open engagements (project / stage / ticket picker)
    and route to the existing dispute flow (/api/finance/disputes, Decisions #211/#212) instead of
    a free-form ticket. For guests, ask them to sign in (link to /login?redirectTo=/contact?
    intent=dispute) and offer a reference-ID field + message as a fallback intake.
  * security: name, email, report type (vulnerability / abuse / whistleblower), an optional
    anonymous toggle (hides name/email and makes them optional), message, attachments. Include a
    note on responsible disclosure and a link to /legal/acceptable-use.
- Attachment dropzone:
  * drag-and-drop plus click;
  * per-file progress (a determinate progress bar), scan state from the files pipeline (scanning →
    ready / refused), remove control;
  * limits from the bucket's file_size_limit / allowed_mime_types, shown up front.
- Discovery-call booking: do NOT add a third-party embed. Reuse the platform's own scheduling.
  Book against a designated Projective sales profile's availability through the existing
  discovery-call flow (api/services/call-offer.ts / api/scheduling/*; Decision #80). If no sales
  profile exists, render the button disabled with its reason (gate 11) and tell me.
- Success state: a confirmation panel with the reference number (mono), what happens next, and
  the expected response time.

3. DESIGN SYSTEM & STYLING DIRECTIVES
- Calm form design: generous field geometry from @projective/ui fields; a focus ring per the
  tokens; labels above fields; helper text in --text-secondary; errors inline with aria-describedby.
- The submit button is the single filled primary in the intake column; "Book a call" is tonal.
- The rail is NOT a card: a solid tonal region, its content separated by spacing and one hairline.
- Intent switch transition: the field group cross-fades at --dur-fast; no height jump (reserve a
  min-height or animate with transform only).

4. DATA CONTRACT & ASSET MOCKING
- New table ops.contact_requests:
  * columns: id, reference (human-readable, unique), intent, payload jsonb (Zod-validated per
    intent), user_id null, email, status (use the unified machine: Backlog → In Progress →
    Complete/Archived), created_at;
  * attachments link table → files;
  * RLS: anon and authenticated can INSERT via a SECURITY DEFINER RPC only; reads are operator
    only.
  Edit migrations in place (tables 00000013, functions, policies, grants), with Zod in
  @projective/types/contact and documentation/database/ops.
- Messages pass through comms.mask_pii only for stored copies shown to non-operators (none
  today) — record that decision in a JSDoc. Rate-limit by IP + email. Add a honeypot field. No
  CAPTCHA dependency.
- Notify operators via comms.fn_notify with a new catalog type (contact.received) seeded in
  00005010.
- Imagery: rail logo → /test_images/brandmark_1.webp (copied in P0) only if there is no real
  brand asset in apps/web/static; a map or office image → https://placehold.co/640x360?text=Office.

5. SEO, PERFORMANCE & ACCESSIBILITY
- JSON-LD: ContactPage + Organization (contactPoint per intent: sales, customer support,
  security).
- The form works without JS: a POST form to /api/contact with a server-rendered result. The
  intent switcher degrades to links (?intent=…).
- Fieldsets with legends per intent; the anonymous toggle announces the field changes
  (aria-live="polite").
- Playwright: submit each intent; upload a file and see it go scanning → ready; dispute as a guest
  and as a signed-in seed persona.
- Docs: PRODUCT_MANAGEMENT (contact request lifecycle), the PRODUCT_SPEC sitemap, ROUTING.md,
  DESIGN_SYSTEM §C.1 (dropzone, segmented intent switcher if new).
```

---

## P4 · About & platform mission — `/about`

```text
TASK: Replace the PagePlaceholder at apps/web/routes/(public)/about.tsx with the editorial
manifesto page.

Decision (f), §0.1: every metric shown must be real.

1. ROUTE TARGET & SCOPE
- apps/web/routes/(public)/about.tsx re-exports apps/web/features/marketing/about/AboutPage.tsx
  (marketing group already exists).
- GET /api/public/metrics → PublicMetricsService.
- Standalone route; the product tour is an inline, interactive section, not a modal.

2. LAYOUT & COMPONENT ARCHITECTURE
Sections (single editorial column at --measure-wide for display, --measure for prose, per
Decision #96's editorial single-column language):
  1. Opening: a display headline about the shift from isolated freelancing to escrow-backed
     micro-agencies; a two-sentence standfirst; no hero image (typography leads). Optional
     abstract graphic → https://placehold.co/1600x600?text=Team-as-a-Service.
  2. "The friction" vs "The model": a two-column contrast (stacks below --bp-md). Each side is a
     section-caps label plus 4 short statements. Plain text separated by a single vertical
     hairline, no boxes.
  3. Pull quote: an editorial blockquote in display register, attributed.
  4. Live metrics row (tabular-nums), each tile = a big figure + a label + a mono "as of" timestamp:
     - Total value protected = sum of held + released escrow, all time.
     - Stages delivered = count of approved/paid stages.
     - Median time from funding to approval.
     - Platform fee = platform_fee_bp / 100 %.
     Thresholds: hide a tile if its underlying count < a minimum (default 10, in
     security.platform_params as public_metrics_min_n, seeded in 00005001). Show "Updated hourly".
  5. How delivery works (the product tour): an interactive SVG walkthrough of the stage-based
     escrow pipeline — Fund → Prepaid escrow → Claim → In progress → Submit → Accept & release →
     7-day clearing → Withdraw.
     - Each step is a button in a stepper (roving tabindex); selecting one highlights that stage
       of the SVG and shows a two-line explanation.
     - Autoplay only with no-preference motion and only after the section scrolls into view;
       pause on hover/focus; a visible Pause control.
     - Build the SVG inline with token colours via currentColor / CSS custom properties. No video
       file; if you want a video slot, use a placehold.co poster and no src.
  6. Founders: a text list of founders (name, role, a one-line bio, links) with avatars from
     /test_images/profile_4.jpg … profile_6.jpg (copied in P0). Names/bios are placeholders
     "Founder name — XXXX" until I supply them; tell me in your final message.
  7. Security & architecture credentials: factual statements only, each linking to the doc that
     proves it — RLS on every table, escrow concurrency probes, the append-only ledger, Stripe
     Connect, KYC via Stripe Identity, PII masking (#147). No certifications we don't hold (no
     "SOC 2" unless I confirm).
  8. Closing CTA band: "Start a project" (filled primary → /join) and "Talk to sales" (tonal →
     /contact?intent=sales).

3. DESIGN SYSTEM & STYLING DIRECTIVES
- Strong typographic contrast: display at --text-3xl, --tracking-tight; section caps for every
  section label; body in --font-reading. Region tones alternate --bg / --surface-1 (solid) to pace
  sections; no cards anywhere.
- Metrics: figures at --text-3xl, --fw-medium, tabular-nums; labels in section caps; timestamps
  in --font-mono --text-2xs.
- SVG: strokes at --hairline width tokens; the active stage in --primary; inactive in
  --text-secondary; transitions --dur-medium --ease-standard; reduced motion = instant state
  changes, no autoplay.

4. DATA CONTRACT & ASSET MOCKING
- PublicMetricsService (service-role read, aggregated only, no row-level data) returns
  ServiceResult<PublicMetrics> (Zod in @projective/types/marketing). Cache 1h in the existing
  service cache (packages/backend/core/cache.ts). Fixture mode returns realistic-shaped seed
  aggregates computed from the seeded DB, not invented numbers.
- SSR-render the metrics (no client fetch needed); the stepper is the only island.

5. SEO, PERFORMANCE & ACCESSIBILITY
- JSON-LD: AboutPage + Organization (name, url, logo, founders as Person once real).
- The SVG has <title>/<desc> plus a text equivalent list for screen readers.
- The stepper is a tablist/tab pattern or a radiogroup with aria-controls on the explanation
  panel.
- LCP is text, so no hero image to optimise.
- Docs: the PRODUCT_SPEC sitemap "/about" description, DESIGN_SYSTEM §C.1 (metric tile and stepper
  if new), documentation/database/security (new param).
```

---

## P5 · Changelog & velocity feed — `/changelog`

```text
TASK: Build the public changelog with RSS and deep-linkable releases.

1. ROUTE TARGET & SCOPE
- Routes:
  * apps/web/routes/(public)/changelog/index.tsx — the feed.
  * apps/web/routes/(public)/changelog/[version].tsx — the canonical single-release page.
  * apps/web/routes/(public)/changelog/rss.xml.ts — RSS 2.0, application/rss+xml.
- Controllers in apps/web/features/changelog/.
- "changelog" must already be reserved (P0).
- Search params: ?category=<infrastructure|escrow|ux|…> filters (multi via repeat), ?page=n.
  Anchors #v<semver-with-dashes> on the feed.
- The lightbox is ?image=<entryId>:<index> (shareable; Esc/back closes).

2. LAYOUT & COMPONENT ARCHITECTURE
- Header:
  * display title "Changelog"; one-line standfirst;
  * subscribe row: an RSS link (outline) and the existing NewsletterForm island with a "changelog"
    topic if the newsletter API supports topics (check api/newsletter/subscribe.ts; if not, add an
    optional topic field end to end, with Zod + docs);
    (Done by work order F, Decision #274: use <NewsletterForm topic="changelog" />.)
  * category filters as a filter control group — these are controls, so containers are allowed.
- Release spine: a vertical timeline.
  * Left gutter (≥ --bp-md, sticky per entry): date (mono), version tag (mono, in a small
    lifecycle-free container only if it is a link; otherwise plain mono text).
  * Right: title (section-header register), category metadata as inline middot text, NOT tag
    pills (anti-tagification — categories are non-actionable here; the filters above are the
    controls).
  * Body via ContentRenderer: prose, code blocks (--font-mono on --surface-2), and images in a
    responsive grid; clicking an image opens the lightbox (packages/ui overlay Dialog: image,
    caption, prev/next, Esc).
  * A hairline spine connects entries; the entry dot for the newest release uses --primary.
  * Each entry has an AnchorHeading copy-link.
- Pagination: 10 releases per page, plus "Older releases" (a link, not infinite scroll).
- Single-release page: the same entry, prev/next versions, "All releases".

3. DESIGN SYSTEM & STYLING DIRECTIVES
- Clean vertical rhythm: --space-7 between entries; mono for every version/date; dark mode is
  automatic via tokens (don't special-case it).
- Scroll: anchor jumps use scroll-margin-top = header height; smooth only with no-preference.
- Lightbox open/close --dur-medium --ease-emphasized; under reduced motion, instant.

4. DATA CONTRACT & ASSET MOCKING
- SUPERSEDED BY DECISION #274 (owner, 2026-10-17) — it overrides the Content bullet below:
  releases are rows in the `editorial` schema ([changelog] region of 00000024), with the row
  schema in @projective/types/editorial/changelog.ts and the records in
  packages/backend/services/editorial/content/changelog.ts; run `deno task db:editorial:generate`
  (writes 00005072) and read through readEditorialTable. A future-dated release is hidden by the
  table's `visible` predicate and its SELECT policy. See documentation/database/editorial/.
- Content: features/changelog/core/content/releases.ts exporting Release[] (version semver,
  date, title, categories[], summary, body: ContentNode[], images[{src, alt, w, h}]), with Zod in
  @projective/types/content.
- Seed it with REAL releases reconstructed from git history (git log --merges and the
  decisions log #180–#212 are good sources: the money-integrity hardening, scheduler, disputes,
  prepaid stage funding, age guardrails). Never invent features that don't exist.
- Images:
  * product captures → https://placehold.co/1600x1000?text=<Feature> with alt text. If a seed
    banner fits (a cover), use /test_images/banner_2.jpg (copied in P0).
  * List in your final message which captures should be replaced with real screenshots (no TODO
    comments in code).
- RSS: title, link, guid = canonical release URL, pubDate RFC-822, description = summary;
  absolute URLs from the request origin.

5. SEO, PERFORMANCE & ACCESSIBILITY
- JSON-LD:
  * Feed: CollectionPage + ItemList of releases.
  * Release page: TechArticle (headline, datePublished, version as softwareVersion via
    about → SoftwareApplication).
- <link rel="alternate" type="application/rss+xml"> in head.
- The timeline is an <ol> of <article>s; dates are <time datetime>.
- The lightbox traps focus, restores focus on close, and its images have alt text and captions.
- Images are lazy below the fold with explicit dimensions.
- Unit tests: semver anchor ids, the category filter, RSS XML validity (parse it back), and
  pagination.
- Docs: add /changelog to the PRODUCT_SPEC sitemap and ROUTING.md; footer link under "Company"
  (Decision #13); DESIGN_SYSTEM §C.1 (Timeline, Lightbox if new).
```

---

## P6 · Articles & insights — `/articles`, `/articles/[slug]`

```text
TASK: Build the editorial index and reader.

DECISION (b) IS RULED — owner, 2026-10-17, revised (Decision #274). Do not stop for it, and
read every catalogue.articles mention below through it: Projective's articles are rows in the
`editorial` schema, canonical at /articles/[slug]; catalogue.articles keeps member posts only —
no is_editorial flag, no /view redirect. The original STEP 0, kept for the record:

STEP 0 — STOP AND ASK ME about decision (b) in §0.1. /articles/[slug] is listed under Dashboard
in PRODUCT_SPEC, and catalogue.articles already renders as the `article` archetype at
/view/[entity] (Decision #43; features/view/core/entity-archetype.ts:88). Propose: /articles is
the public canonical home for PLATFORM editorial articles (a flag or author type on
catalogue.articles — check the table first). Member-authored posts stay at /view and
/[handle]/posts. Each article has exactly one canonical URL; the other path 301s or sets
rel=canonical. Wait for my answer, log the decision, and update the PRODUCT_SPEC sitemap and
ROUTING.md.

1. ROUTE TARGET & SCOPE
- Routes:
  * apps/web/routes/(public)/articles/index.tsx — the index.
  * apps/web/routes/(public)/articles/[slug].tsx — the reader.
- Controllers in apps/web/features/articles/{index,reader}/.
- SUPERSEDED BY DECISION #274: data comes from the `editorial` schema ([articles] region of
  00000024; records in packages/backend/services/editorial/content/articles.ts, row schemas in
  @projective/types/editorial/articles.ts, generated into 00005073), read through
  readEditorialTable by an EditorialArticles…BackendService — not from catalogue.articles.
- Data from catalogue.articles via a new ArticlesBackendService (anon-readable published rows
  only; reuse the existing explore/live-view readers where possible).
- Search params: ?topic=<slug> (repeatable), ?page=n.

2. LAYOUT & COMPONENT ARCHITECTURE
- Index:
  * a lead story (cover, title in display register, standfirst, author + mono meta "8 min read ·
    12 Oct 2026");
  * then two secondary features;
  * then a list grid of the rest.
  * Article tiles ARE interactive (whole-tile link), so a media card is allowed per DESIGN_SYSTEM
    §B (card = interactive): surface, radius, resting elevation, no full border, no nested card.
  * Topic filters as a control group above the list: asynchronous collaboration, agile delivery,
    team structure, value pricing, escrow & trust.
- Reader = P0 DocumentLayout:
  * ReadingProgress; cover image (full measure-wide, aspect-ratio reserved, a blur-up placeholder
    via a tiny inline data URI or a dominant-colour token background, no layout shift);
  * title, standfirst, byline (author card: avatar, name, role, link to /[handle]);
  * a dynamic TOC from headings;
  * body via ContentRenderer;
  * a contextual CTA block after ~60% of the body: one per article, chosen by topic — e.g. "Run
    your next project in stages" → /join (filled primary). That is the region's only primary.
  * end-of-article author card plus 3 related articles (same topic).
- No conversion-lane rules apply (not an entity-view route). Never show prices here.

3. DESIGN SYSTEM & STYLING DIRECTIVES
- Reading comfort:
  * body --font-reading, --text-base (--text-lg at ≥ --bp-lg), --leading-relaxed, at --measure;
  * headings with generous space-before (--space-7) and tight space-after;
  * blockquotes in display register with an inline-start --hairline rule.
- Topic and read-time metadata = inline middot --text-secondary text (anti-tagification); the
  topic filter chips above the index are controls.
- Images fade in at --dur-medium only with no-preference motion.

4. DATA CONTRACT & ASSET MOCKING
- SUPERSEDED BY DECISION #274 — it overrides this bullet and the corpus.ts one below: the
  editorial seed migrations run in every environment, so an author is an `editorial` row (never
  an FK onto a seeded profile) and a cover is a static asset; author the articles in
  services/editorial/content/articles.ts, not supabase/seeds/gen/corpus.ts.
- Covers and author avatars come from the seeded catalogue.articles rows and seeded profiles
  (their stored URLs originate from /test_images via the seed pipeline). Do NOT hard-code
  /test_images for these. If a seeded article lacks a cover, fall back to
  /test_images/banner_3.jpg (copied in P0).
- Inline body figures with no DB backing → https://placehold.co/1200x675?text=<Figure>.
- If there are fewer than 6 platform editorial articles in the seed corpus
  (supabase/seeds/gen/corpus.ts), add real, well-written ones there on the brief's topics. Regenerate
  with `deno task db:seed:generate`; never hand-edit the generated SQL.
- Read time is computed server-side from word count (pure function, tested).

5. SEO, PERFORMANCE & ACCESSIBILITY
- JSON-LD:
  * Index: CollectionPage + ItemList.
  * Reader: Article (headline, image, author Person with url, datePublished, dateModified,
    wordCount) + BreadcrumbList.
- OG image = the cover. One canonical per article (decision b).
- <article> landmark, <address> for the byline, <time datetime>. The TOC is the
  <nav aria-label="On this page">.
- LCP = the cover on the reader: fetchpriority="high" on it only; lazy everything else.
- Docs: the PRODUCT_SPEC sitemap row moves from Dashboard to Public (after decision b), ROUTING.md,
  DESIGN_SYSTEM §C.1 (article tile if new), documentation/database/catalogue (any new flag).
```

---

## P7 · Community feedback & roadmap — `/feedback` + global `?feedback=open`

```text
TASK: Build the feedback board as a standalone route AND a global overlay.

DECISION (d) IS RULED — owner, 2026-10-17 (Decision #274). Do not stop for it: ideas store
unified-machine states — Backlog (shown "Under review", visible only to its author and
operators), Ready ("Planned"), In Progress, Complete ("Shipped"), Archived. Still add the
"Feedback idea" lifecycle to PRODUCT_MANAGEMENT.md. The original STEP 0, kept for the record:

STEP 0 — STOP AND ASK ME about decision (d) in §0.1: map the brief's Planned / In Progress /
Shipped onto the unified status machine in PRODUCT_MANAGEMENT.md §3 (proposal: Backlog shows as
"Under review", Ready as "Planned", In Progress as "In progress", Complete as "Shipped", plus
Archived). Displayed labels are allowed to differ; stored states are not. Wait, then log the
decision and add the "Feedback idea" lifecycle to PRODUCT_MANAGEMENT.md.

1. ROUTE TARGET & SCOPE
- Routes:
  * apps/web/routes/(public)/feedback.tsx — standalone, shareable; "feedback" reserved in P0.
  * The same board content mounted as a Drawer (packages/ui overlay, Decision #171) in BOTH the
    public layout and the dashboard layout, opened whenever the URL has ?feedback=open on any
    route. Closing removes the param (history.replaceState); back closes it.
- Deep links:
  * ?feedback=open&idea=<id> opens a specific idea;
  * &compose=1 opens the submission form;
  * ?status=<planned|in_progress|shipped|under_review> and ?sort=<top|new> filter the board (in
    both modes).
- Keyboard: add an isOpenFeedbackShortcut predicate to apps/web/features/shell/core/shortcuts.ts.
  Propose a binding to me before wiring it (suggestion: the two-key sequence "g" then "f"). It must
  not collide with /, Ctrl/Cmd+/, Ctrl/Cmd+B or Cmd+K, and must skip isEditableTarget.
- APIs: GET /api/feedback/ideas, POST /api/feedback/ideas, POST/DELETE /api/feedback/ideas/[id]/vote,
  GET /api/feedback/ideas/[id].
- Controller in apps/web/features/feedback/; the board body is one component shared by the page
  and the drawer.

2. LAYOUT & COMPONENT ARCHITECTURE
- Board header:
  * title "Feedback & roadmap";
  * a status tab group (Under review · Planned · In progress · Shipped) with counts (count
    containers allowed);
  * sort control (Top / New);
  * "Suggest an idea" (the region's single filled primary).
- Roadmap view at ≥ --bp-lg on the standalone page: three columns (Planned | In progress |
  Shipped), using the existing packages/ui kanban layout read-only if it fits; otherwise a simple
  three-column list. In the drawer it is always the single list.
- Idea row (a dense, interactive micro-card is allowed because it is interactive):
  * vote button on the left: a stacked up-chevron + tabular count, aria-pressed, optimistic;
  * title (body register, --fw-medium);
  * one-line description;
  * meta in middot text: category · n comments · age;
  * a lifecycle status container (allowed: lifecycle status);
  * no other pills.
- Idea detail (route section or a nested panel in the drawer): full description, status history
  (mono dates), the official response from the team if any, related ideas.
- Submission form (in the drawer as a second view; on the page as a Dialog):
  * title (≤ 90), category (select: Projects, Escrow & payments, Messaging, Profiles, Teams,
    Explore, Other), "What problem does this solve?" (impact), optional details;
  * a duplicate-suggestion list appears as you type the title (search existing ideas,
    debounced) with "Vote for this instead".
- Guests can read; voting and submitting require sign-in: show a sign-in prompt in place of the
  action that returns to the same URL (including ?feedback=open).

3. DESIGN SYSTEM & STYLING DIRECTIVES
- Tactile voting:
  * press feedback is transform: scale() only, at --dur-press (gate 12);
  * the count changes with tabular-nums and no width jump (reserve min-width in ch);
  * the voted state uses the --primary / --on-primary pair (≥ 4.5:1 in all four mode/contrast
    states);
  * hover never lowers contrast.
- Status containers use the existing lifecycle status tag component (do not invent colours).
- Drawer uses the one --drawer-w; backdrop-filter only on the mobile sheet's ::before scrim
  (gate 9).
- Motion: drawer --dur-medium --ease-emphasized in, --dur-fast --ease-exit out; reduced motion is
  instant.

4. DATA CONTRACT & ASSET MOCKING
- SUPERSEDED BY DECISION #274: the tables go in the `community` schema — the [feedback] region
  of 00000025 and the [community.feedback] regions of the shared files (functions, triggers, RLS,
  policies, grants, indexes; keep vote_count with a trigger), documented in
  documentation/database/community/, read through readCommunityTable (COMMUNITY_BACKEND_LIVE).
  Notification types go in the [feedback] regions of 00005010 and packages/types/comms/catalog.ts.
- New tables, in a new comms or ops domain — pick the one the database docs say owns
  community/UGC, and ask if unclear:
  * feedback_ideas (id, slug, title, body, impact, category, status from the unified enum,
    author_id, team_response, created_at, updated_at, archived_at);
  * feedback_votes (idea_id, user_id, created_at; PK (idea_id, user_id));
  * feedback_status_events (idea_id, from, to, actor, at) — append-only.
- vote_count is maintained by trigger or computed in a view; unique vote per user.
- RLS: anyone reads non-archived ideas; authenticated users insert ideas and votes through
  SECURITY DEFINER RPCs (rate-limited); only operators change status / team_response.
- Moderation: public UGC must follow Decision #148 (Two-Zone, screened at publication). Run
  title/body through comms.mask_pii (#147). If #148's screening isn't built yet, new ideas enter
  Backlog ("Under review") and appear publicly only after an operator moves them to Ready.
  Say so in the UI copy ("New ideas appear after review").
- Notifications: authors and voters get a notification when status changes (new catalog types in
  00005010).
- Optimistic votes: a signal store; roll back on a non-2xx with an inline error. Idempotent
  POST/DELETE.
- Seed 12–20 realistic ideas across statuses in the seed generator (supabase/seeds/gen/world.ts →
  `deno task db:seed:generate`), authored by existing seed personas so their avatars come from
  the seeded profile URLs (originating in /test_images). Any decorative empty-state graphic →
  https://placehold.co/480x320?text=No+ideas+yet.
- Dev Context Switcher (root §5): if you add a simulatable "operator" capability for moderating
  ideas, add its control (DevOverrides + DEV_DEFAULTS, DevOption, DevContextPanel, reflect() set
  AND delete).

5. SEO, PERFORMANCE & ACCESSIBILITY
- Standalone page: indexable, with JSON-LD CollectionPage + ItemList. The drawer mode adds
  nothing to the head of the host page.
- The drawer is a labelled dialog (aria-modal), traps focus, and returns focus to the trigger.
  The URL param is the source of truth (open on load if present).
- Vote buttons: aria-pressed plus an aria-label "Upvote <title>, n votes". Count changes are
  announced politely.
- The status tablist uses roving tabindex.
- The drawer island loads lazily (dynamic import) only when ?feedback=open is present or the
  shortcut/trigger fires, so it costs nothing on other routes.
- Probes for: a unique vote, a guest who can't vote, an operator-only status change, archived
  ideas hidden, and mask_pii applied.
- Docs: PRODUCT_MANAGEMENT lifecycle, documentation/database/<schema>, ROUTING.md (global
  overlay param), the PRODUCT_SPEC sitemap, DESIGN_SYSTEM §C.1 (VoteButton, IdeaRow,
  FeedbackDrawer). Add a "Feedback" entry point in the shell user menu and footer.
```

---

## P8 · Integration sweep

```text
TASK: Tie P1–P7 together and prove them.

1. Footer and megamenu (Decision #13):
   - Legal group → the six /legal docs.
   - Company → About, Changelog, Articles, Contact.
   - Help → Help Center, Feedback (?feedback=open).
   - Fix "Pricing → /help" in features/marketing/core/megamenu-data.ts (point at the real
     pricing/fees article or remove it; never a dead or misleading link).
2. GET /sitemap.xml and /robots.txt routes: every public indexable URL (legal docs only once
   reviewedAt is set, help categories and articles, changelog releases, articles, /about,
   /contact, /feedback); robots disallows dashboard paths and ?feedback=open variants.
3. Docs: PRODUCT_SPEC sitemap "Public" rows for every new route; ROUTING.md route table + reserved
   handles; DESIGN_SYSTEM §C.1 roster check; the decision rows a/b/d (and c/f if raised) present
   and indexed.
4. A Playwright smoke spec (scripts/ or the repo's existing e2e location) visiting every route at
   375px, 768px and 1280px, in light and dark, with prefers-reduced-motion, asserting:
   - no console errors;
   - no 404 image requests (catches unresolved /test_images paths);
   - exactly one <h1>;
   - landmarks present;
   - the JSON-LD parses.
   Also run axe-core if it can be added as a dev-only dependency; otherwise do a manual
   keyboard-only pass and record it.
5. Lighthouse-style budget check on /articles/[slug] and /help/<article>: CLS < 0.05, no
   render-blocking third-party.
Report a table: route | a11y issues | CLS | broken assets | docs updated.
```

---

## 2. Landing page track — reference pack

This section is the **reference pack** that L0–L6 point at. It distils the landing-page conversation
(layouts, visualizers, backgrounds, styles, references, plain language) and corrects it against the
codebase. Everything here is an option list; **L0 is where you choose.**

### 2.0 Landing addendum — paste under the standard header for L0–L6

```text
LANDING TRACK ADDENDUM (applies to L0–L6 only).

This route is a marketing surface that intentionally breaks the app design system, under the scoped
exemption recorded in decision (g) of documentation/flows/PUBLIC_ROUTES_BUILD_PROMPTS.md §0.1. Read
§2 of that file (the reference pack) before you start.

Exempt, inside the `lp-` namespace only (apps/web/features/landing/**, the `/` route and the
`/features` route):
  - its own palette, type scale, radii, shadows, glass/backdrop-filter, gradients and glows, defined
    as `--lp-*` custom properties in features/landing/styles/lp-theme.css and scoped to
    `.lp-root`;
  - cards, bento grids and decorative containers;
  - motion beyond the app's spring set (scroll choreography, WebGL, pointer effects);
  - one approved WebGL helper dependency, ONLY if decision (g) approved it; otherwise raw WebGL2.

Never exempt:
  - Accessibility: WCAG 2.2 AA contrast on every text-over-effect, full keyboard path, visible
    focus, ARIA on every interactive demo.
  - Reduced motion: honour BOTH prefers-reduced-motion and the app's data-motion="reduced" overlay
    — no WebGL animation, no autoplay, no scroll-jacking, instant state changes.
  - Islands never touch Supabase; demos are pure simulations over typed fixtures and write nothing.
  - Thin route, fat service; ServiceResult<T>; Zod at every boundary.
  - Every claim is true per the claims table (decision h). No fake numbers, logos or testimonials.
  - SEO: SSR text content, one h1, JSON-LD, meta, and "escrow" kept in metadata and the FAQ schema
    (decision j).
  - Performance budget (enforced in L6), mobile mid-tier:
    * LCP < 2.5s, INP < 200ms, CLS < 0.05;
    * initial JS ≤ 60 KB gzip excluding the lazily loaded WebGL/demo chunks;
    * WebGL starts only after first paint and on idle, only when visible, and never under
      reduced motion or Save-Data or with deviceMemory < 4;
    * it pauses when offscreen or when the tab is hidden.
  - No `lp-` class or token may appear outside the exempt paths. Add a unit test that greps for
    leaks.
  - Dynamic imagery follows the global asset rules (placehold.co for UI graphics; seeded row URLs
    or /test_images copies for DB-shaped imagery). No stock photography.
```

### 2.1 What must be on the page (sections, in priority order)

1. **Hero (mandatory search).**
   - Plain-language headline and subline.
   - The **Explore search bar**: a category picker, typeahead, "popular searches" chips, and a
     submit that routes to `/explore?q=&category=`.
   - One background visual.
   - Two calls to action: "Hire a team" and "Offer your skills" (→ `/become-partner`).
2. **Why it's different.** Old way vs. Projective way: one ready-made team instead of five
   strangers; fixed stage prices instead of open-ended hourly billing; pay as each stage is
   approved. Competitor numbers are optional and must be sourced (decision h).
3. **How it works.** The project journey in 4–6 plain steps: post or pick → fund the stage → team
   works → you review → you approve and they're paid → they withdraw after 7 days.
4. **The visualizer engine.** One tabbed interactive stage showing 3–5 demos (§2.3); "See
   everything" links to `/features`.
5. **Ways to work.** The three project types in human words: a one-off job, an ongoing pipeline, and
   a live session. Each links to a pre-filtered Explore search.
6. **Payment protection.** Money is held until you approve; Fair Exit if work stops; disputes;
   verified identities before anyone gets paid. "Escrow" appears here as the secondary term.
7. **Real numbers.** Live figures from the metrics service (P4), hidden below threshold.
8. **For freelancers and teams.** Earn as a team, automatic splits, payouts after the 7-day window,
   your work stays yours (IP modes).
9. **Pricing.** A flat 5% platform fee read from `platform_fee_bp`, plus a small calculator ("on a
   £2,000 stage you pay £2,000 + 5% fee").
10. **FAQ.** 6–8 questions with FAQPage JSON-LD; this is where "escrow" earns its SEO.
11. **Final CTA.** "Hire a team" / "Offer your skills" and a repeat of the search bar.

### 2.2 Layout options (L0 picks one)

| Option                                               | Shape                                                                                                      | Best when                                                               | Risk                                                                                                   |
| :--------------------------------------------------- | :--------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------- |
| **A. Search-first** (Airbnb / Linear hybrid)         | Centered headline → large search bar → chips → one live visual under the fold line → stacked sections.     | Search is the main action (it is). Cleanest for non-technical visitors. | Can feel generic unless the visual is strong.                                                          |
| **B. Bento showcase** (Apple / Vercel)               | Short hero + floating search dock, then an asymmetric bento grid where each cell is a mini demo.           | Showing breadth fast.                                                   | Clutter; many demos fight each other. Keep ≤ 6 cells and ≤ 2 animated at once.                         |
| **C. Editorial split** (Stripe Press / Mercury)      | A sticky narrative column on the left; on the right, a canvas that changes as you scroll (scrollytelling). | Building trust and explaining money.                                    | Scroll-driven pages are harder on mobile and for accessibility; needs a strong reduced-motion version. |
| **D. Product-theatre** (Linear / Raycast)            | Hero search over a large, slightly tilted, realistic app mock that animates through a real workflow.       | Proving "this is a real product".                                       | The mock must match the real UI or it reads as fake.                                                   |
| **E. Chapters** (Arc / Framer)                       | Full-viewport chapters, one idea each, snapping (not jacking) between them, with a progress rail.          | Strong storytelling for investors and press.                            | Long; the search must repeat at the end.                                                               |
| **F. Search + live marketplace** (Dribbble / Contra) | Hero search, then real live listings (rails from `ExploreBackendService.landing()`) immediately below.     | Proving supply exists.                                                  | Weak or empty data looks bad; needs the seed corpus or real supply.                                    |

**Recommendation:** A with D's product theatre inside the hero, F's live rails as section 5, and the
tabbed engine (§2.3) as section 4. That gives one search, one hero visual and one interactive stage,
and pushes depth to `/features`.

### 2.3 Interactive visualizer catalogue — with a truth table

Every demo is a **simulation over typed fixtures** (no API writes). A demo may only show behaviour
that is **shipped**. Status is from the October 2026 audits
(`documentation/architecture/MVP_FLOW_AUDIT.md` and the wave-7 verification).

| #   | Visualizer                    | What the visitor does                                                                                                                              | Shows (plain words)                                                   | Status                                                                                                                             |
| :-- | :---------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| V1  | **Live board** (kanban)       | Drag a card; an unfunded card is refused ("needs payment first"); approve a card and the next one gets funded (Chain Reaction, #210).              | "Work only starts when it's paid for, and moves on when you approve." | ✅ shipped                                                                                                                         |
| V2  | **Payment protection slider** | Scrub a £5,000 project across 3 stages: money is held → you approve → the team is paid → 7-day clearing → withdraw. Toggle Fair Exit at 25/50/75%. | "Your money waits safely until you're happy."                         | ✅ shipped (#194, #197, #198, M4)                                                                                                  |
| V3  | **Timeline** (gantt)          | Zoom months ↔ days; drag a stage; see the dates move.                                                                                              | "See what's happening and when."                                      | ✅ shipped (`packages/ui/gantt`); deadline bonuses exist (`allow_deadline_bonuses`); verify stage dependencies before showing them |
| V4  | **Booking & rescheduling**    | Pick a slot across two time zones; propose a new time and watch the group vote.                                                                    | "Book time without the back-and-forth."                               | ✅ shipped (scheduling, reschedule rounds, #211); external calendar sync ❌ — don't show                                           |
| V5  | **Team wallet splits**        | Choose an equal split, a lead-heavy split or a finder's fee; watch a payment divide.                                                               | "Payments split fairly and automatically."                            | ✅ shipped (`fn_team_split_plan`); the tax-pot skim ❌ (wave 8 F2) — "Coming soon" or omit                                         |
| V6  | **Team room** (messaging)     | A chat where a phone number typed in gets masked; files dropped into the thread; presence dots.                                                    | "Your whole team in one place, and no one can take you off-platform." | ✅ shipped (messaging, `mask_pii` #147); Figma/GitHub embeds ❌                                                                    |
| V7  | **Files & sharing**           | Drop a file → it's stored, previewed, and shared via an expiring link.                                                                             | "Keep every file together; share safely."                             | ✅ upload, preview and share links; "virus-checked" ❌ until wave 8 H3                                                             |
| V8  | **Explore matchmaker**        | Type, switch category, see real results update (uses the live suggest API, read-only).                                                             | "Find the right team in seconds."                                     | ✅ shipped (semantic ranking optional, #179)                                                                                       |
| V9  | **Ways to work**              | Switch One-off / Pipeline / Session and see how the project shape changes.                                                                         | "Pick how you want to work."                                          | ✅ shipped (three archetypes)                                                                                                      |
| V10 | **Currency view**             | Switch GBP/USD/EUR/JPY on one price; see the rate snapshot.                                                                                        | "Pay in your currency."                                               | ⚠️ partial: `finance.fx_rates` and escrow FX snapshots exist; verify the claim "locked at funding" in code before showing it       |
| V11 | **Team builder**              | Pick a goal, slot in roles, see an indicative stage budget, then "Find teams like this" → Explore pre-filtered.                                    | "Assemble a team the way you'd build a playlist."                     | ✅ as a demo; budget figures must be labelled "example", not quotes                                                                |
| V12 | **Disputes & Fair Exit**      | Flip "work stopped halfway" and see the fair split.                                                                                                | "If something goes wrong, there's a fair way out."                    | ✅ shipped (#198, #212)                                                                                                            |
| V13 | **Products & services shelf** | Hover a service, a product and a session; see what each delivers.                                                                                  | "Buy a fixed service, a ready product or a live session."             | ✅ listing and checkout; digital file delivery ❌ (wave 8 C1) — don't show downloads                                               |
| V14 | **Blueprints & royalties**    | Turn finished work into a sellable template with a founding-client share.                                                                          | "Turn great work into income."                                        | ❌ spec only (PRODUCT_SPEC §Revenue & Royalties) — `/features` "Coming soon" only                                                  |
| V15 | **Connected tools**           | Toggle GitHub / Zoom / Calendar on.                                                                                                                | "Plug in the tools you use."                                          | ❌ connections are refused today — omit                                                                                            |
| V16 | **Verification ladder**       | Step through identity checks before payouts.                                                                                                       | "Everyone who gets paid is verified."                                 | ✅ shipped (Stripe Identity, payout-ready gate #196)                                                                               |

**Progressive disclosure.** The landing page uses **one** stage with 3–5 tabs (recommended: V1 Live
board · V2 Payment protection · V4 Booking · V5 Team splits, with V8 living in the hero search
itself). Tabs are URL state (`?demo=board|payments|booking|splits`). Only the active demo's chunk is
loaded, and a "See everything Projective does →" link goes to `/features`, which hosts the whole
catalogue (L5). `/about` (P4) keeps the manifesto and the numbers.

### 2.4 Background options (L0 picks one, plus its fallback)

| Option                         | Effect                                                                             | Cost                                                       | Reduced-motion / low-power fallback                                                 |
| :----------------------------- | :--------------------------------------------------------------------------------- | :--------------------------------------------------------- | :---------------------------------------------------------------------------------- |
| B1 **Constellation**           | Faint nodes (freelancers) that the cursor gathers into a glowing cluster (a team). | Medium (instanced points + lines)                          | A static SVG constellation.                                                         |
| B2 **Flowing waves**           | A dark topographic noise mesh that drifts with scroll.                             | Low–medium (one fragment shader)                           | A static CSS gradient-mesh image.                                                   |
| B3 **Circuit traces**          | An isometric grid whose traces light up in sequence (money moving through stages). | Low (shader or SVG stroke-dash)                            | Static traces, no animation.                                                        |
| B4 **Glass metaballs**         | Liquid glass blobs that merge as they touch (people forming teams).                | High (raymarch); test on mobile                            | A static blurred-blob image.                                                        |
| B5 **Particle field**          | Thousands of particles deflected by cursor velocity.                               | Medium–high                                                | Static dots.                                                                        |
| B6 **Aurora gradient**         | A slow, soft colour field (shader or animated CSS conic gradients).                | Low                                                        | A frozen gradient.                                                                  |
| B7 **Grid + spotlight**        | A dot or line grid lit by a cursor spotlight (Vercel/Linear style).                | Very low (CSS radial-gradient following a custom property) | No spotlight.                                                                       |
| B8 **Wavy image displacement** | Hero imagery rippling under the cursor.                                            | Medium                                                     | A static image. Note that no stock photos are allowed, so use product renders only. |
| B9 **Glow-border components**  | Animated conic-gradient borders on the search bar and cards.                       | Very low                                                   | A static border.                                                                    |
| B10 **Noise/grain overlay**    | A film-grain texture over everything for a tactile feel.                           | Very low                                                   | Keep it (it's static).                                                              |

**Recommendation:**

- **B7 + B9** for the hero: cheap, crisp, works on every device, and keeps focus on the search bar.
- **B1** as an opt-in enhancement once the WebGL budget allows, so the "freelancers become a team"
  metaphor is told by the background itself.
- **B10** subtly on top.

Avoid B4 and B5 on mobile.

### 2.5 Style directions — top 10 for Projective (L0 picks one, optionally plus a secondary)

| Rank | Direction                                                    | Look                                                                           | Why for Projective                                                                      |
| :--- | :----------------------------------------------------------- | :----------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| 1    | **Dark precision / "dev-tool industrial"** (Linear, Raycast) | Near-black canvas, hairline borders, mono metadata, one or two glowing accents | Signals craft and trust together; the default recommendation.                           |
| 2    | **Bento modular** (Apple, Vercel)                            | Asymmetric tiles each holding one idea or demo                                 | Mirrors stages and boards; scannable. Pair with #1.                                     |
| 3    | **Warm fintech editorial** (Mercury, Stripe Press)           | Serif display + sans body, warm stone/charcoal, calm accent inks               | Best for "your money is safe" and for investors; pairs well as the secondary voice.     |
| 4    | **Swiss / International**                                    | Strict grid, big type, lots of space, no decoration                            | Clarity for non-technical buyers; ages well.                                            |
| 5    | **Refined glassmorphism**                                    | Frosted layers used sparingly (search dock, demo frame)                        | Matches the "transparent, held safely" metaphor; restrict it to 2–3 surfaces.           |
| 6    | **Soft 3D / clay** (Family, Framer)                          | Rounded, tactile 3D objects and playful motion                                 | Friendly for "built for everyone"; good for the visualizers.                            |
| 7    | **Kinetic typography**                                       | Moving, variable-weight headlines that react to the pointer                    | High energy for the hero line; use once.                                                |
| 8    | **Light airy minimal / "ethereal"**                          | Pale gradients, soft shadows, lots of white                                    | The opposite of #1; approachable. A good light-mode counterpart.                        |
| 9    | **Human scrapbook accents**                                  | Hand-drawn arrows, sticky-note annotations over product shots                  | Makes demos feel human and explanatory; accents only, never the base.                   |
| 10   | **Neo-brutalist friendly** (Gumroad-esque)                   | Bold flat colours, thick outlines, chunky buttons                              | Very approachable and memorable for creators; a risk for the high-value business buyer. |

**Avoid as a base:** cyberpunk, Y2K, pixel art, heavy maximalism and full scrapbook. They undercut
"your money is safe". Neumorphism hurts contrast and accessibility; at most use it for one tactile
control such as the payment slider. Wabi-sabi and bohemian are off-brand for a payments product.

**Recommended combination:**

- **#1 Dark precision** as the base.
- **#3 Warm editorial** typography for the trust and payments sections.
- **#2 Bento** for the `/features` page.
- **#9 Scrapbook accents** sparingly on the demos.

Give the light-mode version **#8**'s airiness rather than inverting the dark design. Seed accents
from the real brand pair, `--accent` amber `#D98216` (Decision #157), plus one cool accent picked in
L0. The Gem's teal `#288690` and emerald `#268C66` are candidates, checked for contrast.

### 2.6 Plain-language glossary (copy rules)

| Internal / spec term                      | Say on the landing page                                                                                                                         | Keep for SEO / secondary                                                                                    |
| :---------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------- |
| Escrow                                    | "Payment protection" · "your money is held safely until you approve"                                                                            | "Payment protection (escrow)" in one explainer line, the FAQ, the meta description, and the FAQPage JSON-LD |
| Release escrow                            | "Pay the team" · "approve and pay"                                                                                                              | —                                                                                                           |
| Pending window (7 days)                   | "Clears in 7 days"                                                                                                                              | —                                                                                                           |
| Micro-agency / squad / Team-as-a-Service  | "Ready-made team" · "a team that already works together"                                                                                        | "team-as-a-service" in meta keywords and an H2 subtitle only                                                |
| Stage                                     | "Step" or "stage" (stage is understood)                                                                                                         | —                                                                                                           |
| CREATE framework                          | "Create · Run · Teach · Advise · Test · Hand over" as plain categories (note "Educate" → "Teach", "Empower" → "Hand over"), or skip the acronym | "CREATE framework" on `/features`                                                                           |
| Workload intensity (Wᵢ) / capacity        | "Nobody takes on more than they can handle"                                                                                                     | —                                                                                                           |
| KYC / KYB                                 | "Everyone who gets paid is ID-verified"                                                                                                         | —                                                                                                           |
| Fair Exit                                 | "A fair way out if work stops"                                                                                                                  | "Fair Exit" as the feature name                                                                             |
| Platform fee 5%                           | "A flat 5% fee. No bidding, no surprises."                                                                                                      | —                                                                                                           |
| TVL                                       | "Money protected so far"                                                                                                                        | —                                                                                                           |
| Archetypes (one-off / pipeline / session) | "A single job · an ongoing workflow · a live session"                                                                                           | —                                                                                                           |

Rules: a reading age around 12–14; one idea per sentence; no unexplained acronyms; verbs over nouns.
Every visualizer's caption is under 15 words.

### 2.7 References

**Live sites to study.** Check each is still live before citing it in the L0 board.

| Site                               | Study it for                                                              |
| :--------------------------------- | :------------------------------------------------------------------------ |
| linear.app                         | Dark precision, hairlines, product-theatre hero, keyboard-first feel      |
| stripe.com and stripe.com/payments | Animated gradient canvas, money-flow diagrams, dense but readable type    |
| vercel.com                         | Grid + spotlight background, bento, glow borders, search-like hero inputs |
| raycast.com                        | Floating glass command bar, shortcut hints, extension showcases           |
| airbnb.com                         | The gold standard for a search-first hero with a category picker          |
| contra.com                         | A freelance marketplace aimed at independents; tone and onboarding        |
| mercury.com                        | Warm fintech editorial; making money feel safe                            |
| ramp.com                           | Fintech clarity, live product mocks, calculators                          |
| cal.com                            | Booking UI showcased on a landing page (relevant to V4)                   |
| attio.com                          | Data-dense modular product shots                                          |
| liveblocks.io                      | Multiplayer cursors and live collaboration demos (relevant to V6)         |
| family.co                          | Soft 3D, delightful spring motion                                         |
| framer.com                         | Chapters, scroll choreography, kinetic type                               |
| arc.net                            | Storytelling chapters and personality                                     |
| notion.com/product/calendar        | Interactive calendar hero (relevant to V4)                                |
| gumroad.com                        | Approachable neo-brutalist creator tone                                   |

**Dribbble searches:**

- "search hero landing page", "marketplace landing page hero search"
- "freelance marketplace landing", "team hiring platform landing"
- "fintech escrow landing page", "payment protection UI"
- "bento grid landing page dark", "SaaS dark landing page glow"
- "kanban landing page interactive", "booking calendar landing hero"

**Awwwards searches and categories:**

- Categories: "Business & Corporate", "Web & Interactive", "Technology".
- Tags: "WebGL", "Scrolling", "Interaction design", "Typography", "Minimal", "Dark".
- Collections: "Best SaaS websites", "Fintech websites".

**Pinterest boards:**

- "dark SaaS landing page", "bento grid web design", "fintech web design"
- "glassmorphism UI dark", "editorial web typography"
- "landing page hero search bar", "product UI mockup perspective"
- "clay 3D icons UI"

---

## L0 · Landing — art direction & decisions

```text
TASK: Choose the landing page's direction and record it before anything is built. Produce a written
direction, not code.

STEP 0 — STOP AND ASK ME, with the options from PUBLIC_ROUTES_BUILD_PROMPTS.md §2 laid out and your
recommendation first:
  1. Layout: §2.2 A–F (recommend A + D hero theatre + F rails).
  2. Style: §2.5 base + secondary (recommend #1 Dark precision + #3 Warm editorial), and the light
     mode treatment.
  3. Background: §2.4 primary + fallback (recommend B7 + B9 now, B1 later, B10 subtle).
  4. Visualizers: which 3–5 go in the landing tab stage (recommend V1, V2, V4, V5; V8 in the hero),
     and which go to /features only.
  5. Decision (g): confirm the exemption scope and the dependency policy (raw WebGL2, or one pinned
     helper).
  6. Decision (i): build a command palette now (so ⌘K is real), or show `/` only?
  7. The cool accent colour to pair with amber #D98216.

STEP 1 — after my answers:
- Write the decision rows (g, h, i, j and the chosen direction) in the newest
  documentation/reference/decisions/decisions-*.md and index them in README.md.
- Create documentation/flows/LANDING.md, the landing spec:
  * the chosen layout as an ASCII wireframe per breakpoint (375 / 768 / 1280 / 1600);
  * the `--lp-*` token sheet: palette with contrast ratios for every text pairing, type scale,
    radii, glow and shadow recipes, motion durations and easings;
  * a section-by-section copy deck written to the §2.6 glossary — headline, subline, CTAs, chips,
    captions, FAQ. Offer 3 headline options; the plain-language bar is a reading age of 12–14;
  * the CLAIMS TABLE (decision h): every factual sentence on the page → its proof (file:line, a
    decision #, or a live metric) or "Coming soon". Delete any claim with no proof.
  * the visualizer list with its truth-table status (§2.3), and the reduced-motion version of each;
  * the performance budget from the addendum.
- Update PRODUCT_SPEC.md "Visual identity" with one line pointing at LANDING.md and the exemption,
  and DESIGN_SYSTEM.md with a short "Off-system surfaces" note that names the `lp-` namespace and
  says the app gates still apply everywhere else.
No code in this prompt.
```

---

## L1 · Landing — decoupled shell, scoped theme, background

```text
TASK: Make `/` a full-bleed, off-system surface with its own theme and the chosen background,
without touching the rest of the app.

1. ROUTE TARGET & SCOPE
- apps/web/routes/(public)/index.tsx stays the thin controller (it already calls
  ExploreBackendService.landing() and sets LANDING_META). Change it to render
  features/landing/LandingPage.tsx instead of features/marketing/components/LandingPage.tsx.
- apps/web/routes/(public)/_layout.tsx resolves GuestShell/UserShell per auth state (with the
  AUTH_PATHS exemption). Add a LANDING_PATHS check (`/`, `/features`) that renders a minimal
  LandingShell instead:
  * its own floating header: logo, 3–4 links, Sign in / Open app;
  * the existing PublicFooter, so footer links stay in one place (Decision #13).
  For a signed-in visitor on `/`, decide with me in L0 whether to show the landing page or redirect
  to /home. The default is to show the landing page with an "Open app" button; never break
  /home.
- The new feature folder is apps/web/features/landing/ with components/ islands/ styles/ core/
  only. Retire the old marketing landing components (Hero, HowItWorks, Testimonials,
  OpenProjectsGrid, ProductsMasonry, HeroParticles.island, MagneticField.island) once nothing
  imports them. Delete them, don't leave them dead (grep first; SiteHeader, PublicFooter,
  NewsletterForm and SchemaInjector stay).

2. LAYOUT & COMPONENT ARCHITECTURE
- LandingShell: `.lp-root`, full-bleed. A sticky floating header pill whose glass sits on a
  ::before (still a good pattern even though it is exempt). A skip link. A <main id="main">.
- Background island (features/landing/islands/LandingBackground.island.tsx) implements the L0
  choice. Its contract:
  * It renders a static fallback (CSS/SVG) on the server — that is the LCP-safe first paint.
  * On the client, it only upgrades when ALL of these hold: no prefers-reduced-motion, no
    data-motion="reduced", no Save-Data, deviceMemory ≥ 4 (or unknown on desktop), a WebGL2
    context is available, and the hero is intersecting.
  * The upgrade waits for requestIdleCallback after first paint.
  * It caps devicePixelRatio at 1.5, pauses on visibilitychange and when the hero leaves the
    viewport, and is destroyed on navigation.
  * Shaders live in features/landing/core/shaders/*.ts as tagged template strings.
  * Pointer input uses throttled pointermove and writes a CSS custom property for cheap effects
    (the B7 spotlight).

3. DESIGN SYSTEM & STYLING DIRECTIVES
- features/landing/styles/lp-theme.css defines every `--lp-*` token from LANDING.md, scoped to
  `.lp-root`, with light and dark variants keyed to the app's theme attribute so the visitor's
  theme choice is respected. Every landing stylesheet uses `--lp-*` (and may read the app's
  accessibility overlays). No `lp-` selector or token outside features/landing (add a leak test).
- Motion: define `--lp-dur-*` and easings. Under reduced motion, every transition is instant and no
  animation runs.

4. DATA CONTRACT & ASSET MOCKING
- No new data. Keep LandingPayload from ExploreBackendService.landing() flowing to the page (for
  L2 chips and L4 rails). Seed-shaped imagery comes from payload URLs; decorative graphics use
  placehold.co until real product renders exist.

5. SEO, PERFORMANCE & ACCESSIBILITY
- The SSR HTML contains all text (h1, sublines) with no JS dependency. The background is
  aria-hidden. Add the performance budget check as a script (L6 enforces it), and measure the
  initial JS here.
- Docs: ROUTING.md (the LANDING_PATHS shell exemption), DESIGN_SYSTEM "Off-system surfaces",
  DESIGN_SYSTEM §C.1 (remove the retired marketing components, add LandingShell).
```

---

## L2 · Landing — hero + Explore search (the hard requirement)

```text
TASK: Build the hero, whose core is a search bar that searches Explore.

1. ROUTE TARGET & SCOPE
- features/landing/components/LandingHero.tsx (SSR) plus
  features/landing/islands/HeroSearch.island.tsx.
- REUSE, don't rebuild, the existing Explore typeahead plumbing:
  * the client service ExploreService suggest call (features/explore/core/ExploreService.ts:56,
    which already takes an AbortSignal);
  * the suggest controller (features/explore/core/suggest-controller.ts);
  * the SearchSuggest island patterns;
  * search history (features/explore/core/search-history.ts).
  Import across features only through path aliases. If the landing island needs a different look,
  wrap the logic (headless) and give it lp- styling. Do not fork the logic.
- APIs: GET /api/explore/suggest?q=&scope= (existing; Zod SuggestQuerySchema, where `scope` takes
  the same ExploreCategory values). Submit navigates to explorePath(category, q) →
  /explore?category=…&q=… — the page's real contract (decision k). The typeahead API says `scope`,
  the Explore page says `category`; don't mix them up.

2. LAYOUT & COMPONENT ARCHITECTURE
- Hero copy from the LANDING.md copy deck: an eyebrow (optional), an h1, a subline, and two CTAs
  ("Hire a team" → focuses the search or opens /explore; "Offer your skills" → /become-partner).
- The search bar (centre stage, the largest element after the h1):
  * Left: a category picker over the real categories: All · Freelancers & teams (`freelancers`;
    teams fold into it per detail-nav scopeOf) · Services · Projects · Products · Businesses.
    Human labels; real values.
  * Centre: the input, with an animated typewriter placeholder cycling 4–6 real example searches
    (taken from the seed corpus / landing payload, not invented). The placeholder animation is off
    under reduced motion, and the real placeholder text stays readable for screen readers.
  * Right: the submit button (the page's single accent primary in this region) with press feedback
    scale(0.96).
  * Under it: "Popular:" chips — server-rendered from the landing payload or trending suggest
    results, so there is no layout flash. Each chip is a real link to explorePath(...).
  * Suggestions dropdown: grouped results (people/teams, services, projects, products) with
    avatars or covers from the payload URLs; keyboard navigation (aria-activedescendant); Enter
    submits; Esc closes; recent searches when empty.
  * The dropdown overlays without moving the page (absolute positioning, a reserved height for the
    chips row).
  * Debounce at 200ms; abort superseded requests; show an inline "No matches — search anyway"
    row.
- Shortcuts per decision (i): `/` focuses the hero search (isFocusSearchShortcut), and the visible
  hint shows `/`. Show ⌘K only if the palette exists.
- Hero visual per L0 (product theatre or background only). If it is product theatre: a tilted,
  realistic board mock built from real @projective/ui components rendering fixtures — not a
  screenshot — which plays V1 in a loop when motion is allowed and is static otherwise.
- Without JS: the search is a real <form action="/explore" method="get"> with name="q" and
  name="category", so it works with no hydration.

3. DESIGN SYSTEM & STYLING DIRECTIVES (lp- exemption)
- The search bar is the hero's focal point:
  * a pill/rounded container with a B9 glow border;
  * glass (backdrop-filter on ::before) only if L0 chose it;
  * focus states unmistakable (a ring at 3:1 against every background state).
- Type at hero scale from `--lp-*`. Contrast is checked over the background's brightest frame.
- Mobile: the category picker collapses into a leading icon button opening a sheet; the input stays
  full-width; chips scroll horizontally with scroll-snap and fade edges.

4. DATA CONTRACT & ASSET MOCKING
- Chips, typewriter examples and suggestion thumbnails come from LandingPayload and the suggest
  responses (seeded URLs that originate in /test_images via the seed pipeline). No placehold.co in
  the search UI, except a neutral fallback avatar (DEFAULT_AVATAR_URL
  /test_images/profile_1.jpg, already static).

5. SEO, PERFORMANCE & ACCESSIBILITY
- role="search" form. A visible or visually-hidden <label>. The combobox pattern (role="combobox",
  aria-expanded, aria-controls, listbox/options).
- JSON-LD: WebSite with potentialAction SearchAction targeting /explore?q={search_term_string}
  (sitelinks search box), plus Organization.
- The hero island is the only JS needed above the fold, ≤ 20 KB gzip.
- Tests:
  * Unit: category→URL mapping uses explorePath; typewriter disabled under reduced motion.
  * Playwright: type → suggestions → Enter lands on /explore with q and category; no-JS form
    submit works; `/` focuses.
```

---

## L3 · Landing — visualizer engine + first demos

```text
TASK: Build the single tabbed "see it in action" stage and the demos chosen in L0 (default V1 Live
board, V2 Payment protection, V4 Booking, V5 Team splits).

1. ROUTE TARGET & SCOPE
- features/landing/components/DemoStage.tsx (SSR frame and tabs) plus
  features/landing/islands/DemoHost.island.tsx, which lazy-loads the active demo via dynamic
  import().
- Each demo is one module: features/landing/islands/demos/<Name>.demo.tsx.
- URL state: ?demo=board|payments|booking|splits (default board). Switching tabs updates the URL
  with replaceState; deep links open the right tab; no scroll jump.
- Demos are PURE SIMULATIONS: a reducer over typed fixtures (features/landing/core/demo-fixtures.ts,
  Zod-validated against the real @projective/types shapes so they stay honest). They make no
  network calls and no writes.

2. LAYOUT & COMPONENT ARCHITECTURE
- Stage frame: tabs (tablist with roving tabindex and plain-language labels: "Work board",
  "Payment protection", "Booking", "Team pay"), a demo viewport with a reserved aspect-ratio (no
  CLS when demos swap), a one-line caption (< 15 words), and a "Reset" control. "See everything
  →" goes to /features.
- Demos, using the REAL @projective/ui components wherever one exists (kanban, gantt, calendar,
  fields) so the demo looks like the product:
  * V1 board: columns Ready · Needs payment · In progress · Review · Done. Dragging an unpaid card
    into In progress is refused with a gentle over-damped shake and "Needs payment first". A "Pay
    for this step" button funds it. Approving in Review → Done shows the next card getting funded
    automatically (Chain Reaction, Decision #210) and a "Team paid" moment.
    Keyboard alternative: card menu → "Move to…".
  * V2 payment protection: a £5,000, three-stage project; a stepper/scrubber through Held → You
    approve → Team paid (minus the 5% fee, read from the server-provided bp passed in props) → Clears
    in 7 days → Withdraw. A Fair Exit toggle at 25/50/75% shows the earned and refunded split
    (mirrors fn_fair_exit_release, fee on the earned share only).
  * V4 booking: two time zones side by side; pick a slot; then "Propose a new time" shows 3
    attendees voting until the majority confirms.
  * V5 team pay: a payment arriving; switch Equal / Lead-heavy / Finder's fee (the real split_rules
    names in plain words) and watch the amounts divide, with a vault share and rounding exactly as
    fn_team_split_plan does. Put the arithmetic in a pure, unit-tested function that mirrors the SQL.
- Every demo has a static, fully readable reduced-motion version: the same states shown as a
  labelled sequence of frames, with next/previous buttons.

3. DESIGN SYSTEM & STYLING DIRECTIVES (lp- exemption)
- The stage is the one big elevated object in its section (glass or solid per L0). Inner demo UI
  uses the app components and so picks up app tokens. Wrap the demo viewport in a scoped theme
  bridge so app components render in the landing palette, by mapping the app tokens to `--lp-*`
  inside `.lp-demo` only.
- Motion: snappy (150–250ms), over-damped; no bounce. A celebratory moment (a light particle burst
  on "Team paid") at most once per interaction, never under reduced motion.

4. DATA CONTRACT & ASSET MOCKING
- Fixture avatars use seeded profile URLs from the landing payload when available, else
  /test_images/profile_2-6 (copied to apps/web/static/test_images in P0).
- Ticket covers and file thumbs: placehold.co with labels ("Homepage design", "Logo v2").
- Money: format with the app's money helper (the existing MoneyView or formatter) in GBP by
  default. If decision (h) verified it, switch currency from the visitor's preference.

5. SEO, PERFORMANCE & ACCESSIBILITY
- The tab panel's SSR content is a descriptive paragraph plus an image placeholder per demo
  (crawlable text). The island hydrates on visible (IntersectionObserver), not on load.
- Each demo chunk ≤ 35 KB gzip; only the active one loads.
- Every drag has a keyboard path and live-region announcements ("Card moved to Review").
- Tests: reducer unit tests per demo (states, refusals, chain reaction, the split math matching
  the SQL fixtures, Fair Exit tiers). Playwright: deep-link each ?demo=; keyboard-only run-through.
```

---

## L4 · Landing — remaining sections

```text
TASK: Build the sections around the hero and the demo stage, per LANDING.md and §2.1.

1. ROUTE TARGET & SCOPE
- SSR components in features/landing/components/:
  * WhyDifferent
  * HowItWorks (new; the old marketing one is retired)
  * WaysToWork
  * PaymentProtection
  * LiveNumbers
  * ForTeams
  * Pricing
  * Faq
  * FinalCta
- Islands only where interaction exists: PricingCalculator.island, the optional
  TeamBuilder.island (V11), and the FAQ needs none (use <details>).

2. LAYOUT & COMPONENT ARCHITECTURE
- WhyDifferent: an old-way vs. Projective-way split. Competitor figures appear only if decision (h)
  produced a sourced, dated citation; otherwise compare models ("open-ended hourly billing" vs
  "fixed price per step"), not companies.
- HowItWorks: 5–6 numbered steps with small inline illustrations (placehold.co until real art).
  Scroll-revealed only when motion is allowed.
- WaysToWork: three tiles — single job, ongoing workflow, live session. Each links to Explore
  pre-filtered with the real filter params for that archetype (read parseExploreParams; if no
  archetype filter exists, link the closest category and tell me).
- PaymentProtection: the trust section — money held until you approve, Fair Exit, disputes, ID
  verification before payouts, the 7-day clearing. "Escrow" appears once here as "payment
  protection (escrow)". Link to /legal/escrow-terms (P1) and /help.
- LiveNumbers: reuse P4's PublicMetricsService (call the service from the route; extend
  LandingPayload or add a second read in the thin controller). Same threshold-hiding rule. If P4
  hasn't landed, build the service exactly as P4 specifies.
- ForTeams: earn as a team, automatic splits, payouts, your IP options (ip_option_mode, in plain
  words). The CTA "Offer your skills" → /become-partner.
- Pricing: a flat fee read from security.platform_params.platform_fee_bp via the service (never
  hard-coded). The calculator takes a stage price → shows what the client pays and what the team
  receives, with the same truncating rule as SQL (unit-tested against fn_escrow_fee_bp examples).
- Faq: 6–8 Q&As from LANDING.md, including "Is my money safe? (How escrow works)". FAQPage
  JSON-LD.
- FinalCta: headline, the search bar again (the same HeroSearch island, a second instance with its
  own id), and the two CTAs.
- Optional V11 TeamBuilder: goal → role slots → an "example budget" (clearly labelled) → "Find
  teams like this" → explorePath('freelancers', <goal skills>).
- Rails (layout F, if chosen): live listings from LandingPayload under WaysToWork, rendered with
  lp-styled cards. Hide the rail entirely when the payload is null or thin (< 4 items).

3. DESIGN SYSTEM & STYLING DIRECTIVES (lp- exemption)
- One idea per section; generous vertical rhythm; at most two animated things in view at once
  (count the background and the demo stage).
- The payments sections lean on the secondary editorial voice chosen in L0.

4. DATA CONTRACT & ASSET MOCKING
- Live data: LandingPayload (listings) and PublicMetrics (numbers, fee bp). Everything else is
  copy from LANDING.md.
- Imagery: listing images come from payload URLs; illustrations and section art use
  https://placehold.co/{w}x{h}?text=<Label> until real renders replace them (list them for me).
  No logos of customers we don't have.

5. SEO, PERFORMANCE & ACCESSIBILITY
- One h1 (the hero); each section an h2 with descriptive text; landmarks per section (aria-labelledby).
- JSON-LD: FAQPage, and Offer/AggregateOffer only if real.
- Meta from LANDING.md: the title includes "team" and "payment protection"; the description
  includes "escrow".
- Images lazy below the fold with dimensions.
- Tests: the fee calculator against SQL examples, threshold hiding, and the payload-null rendering
  path.
```

---

## L5 · `/features` — the extension page

```text
TASK: Build /features, the "everything Projective does" page that the landing page links into, so
the home page stays light.

1. ROUTE TARGET & SCOPE
- Route: apps/web/routes/(public)/features.tsx, using LandingShell (it is in LANDING_PATHS; same
  lp- exemption).
- "features" is already reserved (P0) in RESERVED_HANDLES and org.fn_is_reserved_handle; verify
  only — do not add it a second time (the contract test compares sets and would not notice).
- URL state: ?section=<slug> scrolls to and opens a section; each section has an anchor.

2. LAYOUT & COMPONENT ARCHITECTURE
- A bento grid (style #2) grouped into chapters:
  * Find & hire: V8 matchmaker, V11 team builder, V13 shelf.
  * Run the work: V1 board, V3 timeline, V9 ways to work, V6 team room.
  * Money: V2 protection, V5 team pay, V10 currency (only if verified), V12 Fair Exit.
  * Trust: V16 verification, V7 files & sharing (no "virus-checked" until H3).
  * Coming soon: V14 blueprints & royalties, V15 connected tools, the tax pot — static tiles
    labelled "Coming soon", never interactive.
- Each tile: a title, a one-line plain description, and a "Try it" that opens that demo in a shared
  DemoHost overlay (reuse L3's host and demo modules; Dialog from packages/ui/overlay for the
  frame, styled lp-), plus "Learn more" → the matching /help article (P2).
- Never more than 2 tiles animate at once; tile previews are static images or posters until the
  demo opens.
- The page ends with the same final CTA and search.

3. DESIGN SYSTEM & STYLING DIRECTIVES — as L3/L4. The bento cells use the landing tokens.

4. DATA CONTRACT & ASSET MOCKING — demo fixtures from L3. Tile posters use
   https://placehold.co/800x500?text=<Feature> until real captures exist (list them).

5. SEO, PERFORMANCE & ACCESSIBILITY
- Indexable. JSON-LD: WebPage plus ItemList of features, with each feature's description as
  crawlable SSR text.
- Demos open in an accessible dialog (focus trap, Esc, focus return).
- Total initial JS ≤ the landing budget; demo chunks load on "Try it".
- Docs: the PRODUCT_SPEC sitemap (Public: /features), ROUTING.md, DESIGN_SYSTEM "Off-system
  surfaces"; link /features from the footer and from /about (P4).
```

---

## L6 · Landing — QA & launch gate

```text
TASK: Prove the landing track is fast, accessible, honest and leak-free, and fix what fails.

1. Performance, measured on a throttled mid-tier mobile profile (Playwright + Chrome tracing or a
   Lighthouse CI run, whichever the repo can host without a new runtime dependency; ask if neither
   fits):
   - LCP < 2.5s, INP < 200ms, CLS < 0.05 on `/` and `/features`;
   - initial JS ≤ 60 KB gzip;
   - WebGL not started under reduced motion, Save-Data, or a lost context (simulate each).
2. Accessibility:
   - axe-core (dev-only dependency, if approved) or a scripted manual pass;
   - keyboard-only end to end: search → submit, every demo tab and every demo, the FAQ, the CTAs;
   - contrast of every text over the background's brightest and darkest frames;
   - both reduced-motion channels;
   - the dyslexic and high-contrast overlays still apply to landing text.
3. Honesty: walk the LANDING.md claims table sentence by sentence against the rendered page. Every
   claim has its proof or the "Coming soon" label, and live numbers hide below threshold. Paste the
   table into your final message.
4. Leak check: no `lp-` class or `--lp-*` token outside the exempt paths; the app's routes render
   byte-identical CSS to before (diff the built CSS for app routes).
5. SEO:
   - one h1;
   - JSON-LD (WebSite + SearchAction, Organization, FAQPage, ItemList) parses;
   - the meta description contains "escrow";
   - the sitemap includes / and /features.
6. Playwright smoke at 375 / 768 / 1280 / 1600, in light and dark: no console errors; no 404 assets
   (catches bad /test_images paths); the hero search reaches /explore with q and category, both
   with JS and without.
Report a table: check | result | evidence | fix commit.
```
