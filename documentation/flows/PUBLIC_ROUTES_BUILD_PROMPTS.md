# Public & Utility Routes — Build Prompts

> **Status: WORK ORDERS, not binding.** One self-contained Claude Code prompt for each public or
> utility surface in the "Public & Utility Routes" brief: `/legal`, `/help`, `/contact`, `/about`,
> `/changelog`, `/articles` and `/feedback`. Run them **in order** (§0), each in its own fresh
> session. Paste the standard header (§1) above every prompt.
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

### 0.1 Decisions you must make (the relevant prompt stops for each)

|       | Collision                                                                                                                                                                                                                                               | What the prompt proposes                                                                                                                                                                                                                                                                                                                                  |
| :---- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **a** | The `PRODUCT_SPEC.md` sitemap lists **`/legal` as a Dashboard route** with sub-paths `audit-packs` and `transfers`, the IP chain-of-title workspace. The brief makes `/legal/*` a public document hub.                                                  | Public documents at `/legal` and `/legal/[slug]`. The signed-in IP workspace moves to `/legal/workspace/{audit-packs,transfers}`, which is reserved and auth-guarded, or to `/settings/legal`. **P1 asks you.**                                                                                                                                           |
| **b** | `/articles/[slug]` is listed under **Dashboard** ("freelancer stories linked from `/become-partner`"). `catalogue.articles` already renders as the `article` archetype in `/view/[entity]` (Decision #43, `features/view/core/entity-archetype.ts:88`). | `/articles/[slug]` becomes the canonical public reader for **platform editorial** articles. `/view/art-…` keeps member-authored posts. Each page emits one `<link rel="canonical">` and nothing is rendered twice. **P6 asks you.**                                                                                                                       |
| **c** | The brief's role groups say "Client, Contributor, Squad". The product's words are Client, Freelancer, Team, Business.                                                                                                                                   | Use the product's words. "Squad" would be a new term, and introducing one is a spec change. **P2 asks only if you want the new words.**                                                                                                                                                                                                                   |
| **d** | The brief's feedback statuses are `Planned`, `In Progress` and `Shipped`. `PRODUCT_MANAGEMENT.md` §3 forbids bespoke statuses.                                                                                                                          | Map them onto the unified machine: `Ready` shows as "Planned", `In Progress` as "In progress", `Complete` as "Shipped", plus `Archived`, and an "Under review" intake state (`Backlog`). Displayed labels differ; the stored state does not. **P7 asks you.**                                                                                             |
| **e** | **Legal text.** I won't write it as if it were final law.                                                                                                                                                                                               | Every legal document ships with a visible "Draft — pending legal review" banner and `noindex`. You remove both only after a lawyer signs off. Clause **content** is grounded in real product behaviour from `PRODUCT_SPEC.md` (5% fee, Fair Exit tiers, 7-day pending window, 48-day invite cooldown, KYC gates), so a lawyer reviews facts, not fiction. |
| **f** | **About-page metrics** ("Total Value Protected", take rate, delivery velocity).                                                                                                                                                                         | Show only real aggregates computed server-side, with a minimum-threshold rule: below it the tile is hidden, never padded. Take rate is read from `security.platform_params.platform_fee_bp`. Investors will check these figures.                                                                                                                          |

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
  `RESERVED_HANDLES`. **`changelog` and `feedback` are not.** Add them in
  `packages/types/profile/reserved.ts` **and** `org.fn_is_reserved_handle` (SQL twin), keeping
  `workspace.contract.test.ts` green (ROUTING.md §Reserved-handle precedence).
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
  A side note links /contact?intent=legal.
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
