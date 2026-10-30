# Optimisation Build Prompts — Claude Code Work Orders for Read Paths, Caching & the Design System

> **Status: WORK ORDERS, not binding.** This is a sequenced series of self-contained Claude Code
> prompts for track O ("Optimisation and design") of
> [`FOUNDER_QUESTIONNAIRE.md`](FOUNDER_QUESTIONNAIRE.md) Part B §B.3. Together they close the open
> work of the [redundancy audit](PROJECTIVE_REDUNDANCY_AND_OPTIMIZATION_AUDIT.md) under the owner's
> rulings on Decision #341 (E1–E3). Every prompt cites its evidence by finding ID (`U-`, `L-`, `D-`,
> `G-`, and the audit's `QW-`, `SC-`, `DB-` rows) and its ruling as `(Decision #NNN, ruling X)`. The
> options behind each ruling are in
> [`ARCHITECTURAL_DECISIONS_AND_CLARIFICATIONS.md`](ARCHITECTURAL_DECISIONS_AND_CLARIFICATIONS.md)
> (ADC, Q1–Q17). Paste each prompt into its **own fresh session**, after the standard header (§1).
>
> **Before you start:** these prompts assume `main` at or after `94d22e84` (Wave 1.1). Run them in
> the §0 order. A prompt marked **🧑 DECISION** must stop and put the named question to a human
> before it changes behaviour; it gives the options and a recommendation. What Wave 0 built was
> verified against git on 2026-10-30 and is listed in §0.3; it is not rebuilt here.
>
> **IDs.** The questionnaire names the RED work packages (§B.1, §B.3: "RED WPn", "O: WPn") without
> defining them. §0.1 is the mapping this file uses, reconstructed from those sections and the
> audit's §4 rows. A letter suffix splits a package whose halves wait on different tracks. `Q9`,
> `Q12` and `Q15` are #341 E1 rulings with no work package of their own.
>
> **Migrations are edited in place** (root `CLAUDE.md` §1). Every SQL prompt names the existing
> category file to edit.

---

## 0. Run order & dependencies

| Phase                               | Prompts                                  | Why this order                                                                                                                                                                                                                                                           |
| :---------------------------------- | :--------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 — Doctrine**                    | WP17                                     | Docs only, no waits. The binding SA text stops teaching the unsafe `withCache` sample before any Wave 2 track writes a cache.                                                                                                                                            |
| **1 — Cache primitives**            | WP10a                                    | Single-flight, one request memo, `cachedGlobal` and KV version keys. Every later read-path prompt, and track M's N2 long-poll, builds on them. No cross-track wait.                                                                                                      |
| **2 — Read paths**                  | WP2 → WP11; WP10b; WP3b → Q12; Q9 → WP13 | WP2 memoises the wallet context and runs the Q13 check that sets WP11's priority (**P0** if a shown figure comes from the 1,000-row window). WP10b and WP3b need WP10a. Q12 shares `live-catalog.ts` with WP3b. WP13 needs Q9's claims, WP10a's version keys and M's N2. |
| **3 — Shared rules & server flags** | WP5a → WP5b → WP6; Q15                   | WP5a has no open wait (P·WP2 merged in Wave 0). WP5b and WP6 write the projects function files, so they follow P·WP6. Q15 follows WP2 (the wallet DTO) and F·UI3/UI4 (the wallet literals).                                                                              |
| **4 — UI & design system**          | WP4; WP7; WP8 → WP9 → WP16               | WP4 and WP7 follow the finance UI prompts that edit the same files. WP8 lands the stylesheet gate that WP9 drives to zero. WP16 goes last because it touches the ten modal files that tracks P and C also edit.                                                          |
| **Last**                            | Z1                                       | Docs sweep and the audit's status column.                                                                                                                                                                                                                                |

**Cross-track waits.** §B.3 lists the first five rows. The rest are added here because the prompt
writes a file that the named step also writes.

| Prompt                 | Waits for                                                                  | Status on 2026-10-30                                                                                                  |
| :--------------------- | :------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| WP2, WP11              | F·SV2, F·SV3, F·SV5 (`live-wallet.ts` / `wallet-scope.ts`)                 | Open. §B.3 names SV2/SV5; §B.0's hot-file table also names SV3 as a writer of the same file, so WP2 waits for it too. |
| WP5a                   | P·WP2                                                                      | **Merged** in Wave 0 (`3fcf2d54`, merge `8464dbdd`): X4, X8, W7, without D12.                                         |
| WP4                    | F·UI2, F·UI3, F·UI5                                                        | Open.                                                                                                                 |
| WP7                    | F·UI5, S·S5 (and F·UI2/UI3, which edit `WalletDialogs.tsx`)                | Open. S5 fixes `PlanBlock.tsx`; WP7 leaves it.                                                                        |
| WP13                   | M·N2 (the ETag long-poll)                                                  | Open.                                                                                                                 |
| WP5b, WP6              | P·WP6 (P·WP1–WP6 edit `00001110` / `00001140` and the board files)         | Open. P·WP6 also owns the move matrix (L-03); see §0.3.                                                               |
| WP10b (FxService step) | F's FX-feed prompt (#337 M5 (f)) and F·SV5, if either edits `FxService.ts` | Open.                                                                                                                 |
| Q15                    | WP2; F·UI3, F·UI4 (`wallet-home.ts`, `AnalyticsView.tsx`)                  | Open.                                                                                                                 |
| WP8                    | F·UI1 (the wallet sheets, `wlt-account`)                                   | Open.                                                                                                                 |
| WP9, WP16              | P·WP8/WP9 and C·WP10, while they are open on the modal files               | Open.                                                                                                                 |

These cannot run in parallel because they edit the same files:

- WP2 / WP11 / Q15 (`live-wallet.ts`, `WalletBackendService.ts`, the wallet DTO), and none of them
  beside F·SV2, SV3 or SV5
- WP10a before WP10b and WP3b (`packages/backend/core/cache.ts`, `kv.ts`); WP10b and WP3b may then
  run together
- WP3b / Q12 (`live-catalog.ts`)
- Q9 / WP13 (`UserBackendService.ts`, `apps/web/routes/api/user/*`)
- WP5a / WP5b / WP6 (`packages/types/projects/*`; `00001110`, `00001140`)
- WP6 / WP7 (`stage-funding.ts`); WP4 / WP7 (`ConsultationModal.tsx`, `ScopeBriefModal.island.tsx`,
  the wallet components); WP4 / WP16 (`TicketView.tsx`)
- WP8 / WP9 (the gate, its baseline, DESIGN_SYSTEM §B); WP9 / WP16 (the modal sheets)
- SQL: WP11, WP5b, WP6 and Q9. At most two at once, never two on `00002510`

**Hot files (§B.0).**

- `live-wallet.ts` / `wallet-scope.ts`: WP2, then WP11, then Q15. One O writer at a time, and never
  beside F·SV2, SV3 or SV5.
- `00002510` (grants): WP11, WP6, and WP5b if it grants. One writer across all tracks.
- `features/devtools` + `apps/web/utils/dev-seam.ts`: no O prompt plans to write them. Q9 writes
  them only if the existing `layoutDirection` override stops winning over the new claim.
- `00001240`, `00005060`, `00001155`, `00001020`, `00001060`, `00001300`, `stripe-webhook.ts` +
  `00001230`: no O prompt writes them.
- Shared but not in §B.0: `FxService.ts` (F); the wallet and checkout components and sheets (F UI
  prompts, and the #243 peers); `PlanBlock.tsx` (S5); `00001110` / `00001140` and the board files
  (P); the modal files (P, C); `00001700` (I3's session guard may edit it); `DESIGN_SYSTEM.md` and
  `SYSTEM_ARCHITECTURE.md` (every track). Check `git log` on these before starting.

**Peer warning:** other sessions edit `apps/web/features/wallet/**` and
`apps/web/features/checkout/**` (the finance UI prompts and the Decision #243 work). Check
`git status` before WP4, WP7, WP8 or WP9.

### 0.1 The work packages

| ID    | Audit rows                                                                 | Ruling                      |
| :---- | :------------------------------------------------------------------------- | :-------------------------- |
| WP2   | DB-1, QW-4 (D-01, D-02)                                                    | #341 E1 Q13                 |
| WP3b  | DB-4 / DB-8 invalidation half (D-14)                                       | #339 N2; #341 E1 Q11        |
| WP4   | SC-1, SC-2 (U-02, U-03, U-05–U-09, U-13–U-15), plus U-10, U-11, U-16, U-26 | none needed (audit §4.2)    |
| WP5a  | SC-3 (L-04, L-05, L-07, L-09 TS half, L-10, L-12, L-14, L-16, L-17)        | #338 P5 (e) = #341 flag (n) |
| WP5b  | SC-3 (L-09 SQL half)                                                       | #338 P5 (e) = #341 flag (n) |
| WP6   | SC-4 (L-06, L-08, L-20)                                                    | #338 P5 (e) = #341 flag (n) |
| WP7   | SC-5 (L-11, L-13), FDD N10, L-01's locale half                             | #341 E2                     |
| WP8   | SC-6, SC-11 (U-21, U-22, U-28)                                             | #341 E3 Q6                  |
| WP9   | SC-7, SC-8 (U-23, U-24, U-25, U-27), the split panes                       | #341 E3 Q4, Q5              |
| WP10a | SC-9 (D-06's and D-23's primitives), `cachedGlobal`, version keys          | #341 E1 Q10, Q2; #339 N2    |
| WP10b | QW-7, DB-6, DB-7 (D-12, D-16, D-17, D-21, D-24, D-25)                      | #341 E1 Q11, Q10            |
| WP11  | DB-2 (D-03, D-20)                                                          | #341 E1 Q13                 |
| WP13  | DB-5 (D-08)                                                                | #341 E1 Q9; #339 N2         |
| WP16  | SC-10 (G-1)                                                                | #341 E3 Q17                 |
| WP17  | DB-10                                                                      | #341 E1 Q2, Q11             |
| Q9    | QW-6 (D-07, D-10, D-11)                                                    | #341 E1 Q9                  |
| Q12   | DB-4's measured switch                                                     | #341 E1 Q12                 |
| Q15   | L-15, L-18, L-19                                                           | #341 E1 Q15                 |

### 0.2 Open decisions in this file

- **🧑 Q12:** the in-isolate catalogue budget's value. The prompt measures first, then stops.
  Recommendation: a serialised-size budget plus a reload-latency budget, whichever trips first.
- **🧑 WP7, a new ambiguity (not logged, per the Wave 1 rule):** the ticked E2 text in
  `FOUNDER_QUESTIONNAIRE.md` and the #341 row say money strings appear "only in aria and sentences".
  ADC Q16 option A, which the ⭐ points at, also allows "commit-button labels in the charge
  currency". Recommendation: the strict reading, with `MoneyView` pinned to the charge currency
  inside commit buttons, because a string label escapes the screen-share mask (DESIGN_SYSTEM §B.14).
- **🧑 Roadmap, no prompt: E3 Q3, the keyboard focus ring.** Accepted in principle; the owner is
  still choosing the design (Decision #341, ruling E3 Q3). Until then #245 (a)'s no-ring rule and
  the FA D20 allocation-ring exception stand, and no prompt here adds a ring. When the owner rules,
  one prompt restores a keyboard-only `:focus-visible` ring in `apps/web/styles/global.css`, adds
  the forced-colors outline (closing DESIGN_SYSTEM §F.1), and corrects the cited criterion to WCAG
  2.4.7.
- **Owner action, no prompt: Q0.5.** The root `CLAUDE.md` diff is drafted in
  [`WAVE1_CLAUDE_MD_PROPOSAL.md`](WAVE1_CLAUDE_MD_PROPOSAL.md). Agents may not edit guardrail files.
- **Inherited open items:** none of the five rulings still open after Wave 1.1 (#338 P4's
  `create_category` label, #252 S2's storage and contract-rate questions, #337 M5's FX margin, and
  the ⚖️ items) gates a prompt here.

### 0.3 Done, owned elsewhere, or unassigned

- **Done in Wave 0** (verified against git, 2026-10-30):
  - QW-1–QW-3 are in `660c9658`. `formatTicketMoney` requires a currency and uses
    `currencyExponent`, but still formats with `en-US` (WP7 takes that). No sheet uses the four
    undefined tokens. `QuoteRequestModal` uses `MoneyInput`.
  - RED WP3 (`92c7941f`, merge `b91de658`): D-09 keyset paging past `max_rows`, articles without
    `body`, SWR on expiry, `byIds` in parallel, QW-8, QW-9. Its invalidation half is WP3b.
  - RED WP15 (`e30b4111`, merge `8c825070`): QW-10's registry glyphs and the one brand-marks module;
    QW-11's dead CSS. QW-11's search half belongs to WP14.
  - Not done (verified): QW-4 (the lane still re-runs `overviewWithSwitcher`), QW-5, QW-6, QW-7,
    single-flight (the `through()` comment still argues against it), the shared request memo (six
    copies), `cachedGlobal`, every SC row, DB-1, DB-2, DB-5 to DB-10.
- **Owned by [`COMMS_BUILD_PROMPTS.md`](COMMS_BUILD_PROMPTS.md) (track M):** RED WP12, the inbox
  (DB-3: D-04, D-05; #339 N1 = ADC Q8), with QW-5 (D-06, D-13); D-27 is declined there and closed
  (the id cursor stays: a JavaScript timestamp would drop the microseconds the keyset needs);
  messaging invalidation across isolates (D-22, #339 N2); RED WP14, search (DB-9: D-28 at
  `ef_search` 200 plus `iterative_scan` per #339 N4, D-29, and Q0.2 (f)'s deletion of
  `fn_search_entities` / `fn_search_global`, which #340 (E) / G11 also names for track T). Track M
  consumes WP10a's primitives. If an M step lands first, it creates them at WP10a's paths and names.
- **Owned by [`PM_BUILD_PROMPTS.md`](PM_BUILD_PROMPTS.md) (track P), PM-WP6:** L-03, the ticket-move
  matrix: the P5 (a)–(d) changes to `projects.fn_assert_ticket_move`, the pure TS mirror in
  `@projective/types/projects/board.ts` with its SQL-probe parity test, and replacing
  `ProjectBoard`'s `canDrag` (#338 P5). WP6 takes the other server flags. This boundary was sent to
  the PM session on 2026-10-30. If that file draws it differently, the coordinator keeps one owner.
- **Owned by [`FINANCE_BUILD_PROMPTS.md`](FINANCE_BUILD_PROMPTS.md) (track F):** the wallet's D-13
  (Top up becomes tier 1), FA (h) (an Expand Dialog), FA (l) (aurora violet kept for reserved
  funds).
- **Owned by [`SUBSCRIPTIONS_BUILD_PROMPTS.md`](SUBSCRIPTIONS_BUILD_PROMPTS.md) S5:**
  `PlanBlock.tsx` (L-11's plan half; #252 D11).
- **No work package in §B.3, recorded Open by Z1:** U-12, U-17, U-30 (field and tooltip hygiene);
  G-2, G-3, G-5 (package proposals); G-4 and G-6, which block U-15's `ContactList` and `RoleToggle`
  rows.

### 0.4 Findings for the coordinator

- §B.3's O row misses two waits that the file overlap forces: F·SV3 (a §B.0 writer of
  `live-wallet.ts`) for WP2/WP11, and P·WP6 for the projects SQL that WP5b and WP6 write.
- Part C's N2 row unblocks "RED WP3 invalidation" without naming a track. This file gives it to O
  (WP3b) and gives the KV version-key primitive to WP10a, which track M's N2 consumes.
- **Q13 pre-scan (read-only, 2026-10-30):** shown values probably derive from the 1,000-row ledger
  window: `smootherState`'s first-earning date, which decides Income Smoother eligibility and the
  weeks to go (`live-wallet.ts:423`), and the invoice statements over a 200-day window (`:1688`).
  The CSV export is capped at `LEDGER_WINDOW` (`:1081`), so a long history exports truncated. The
  overview's `lifetime` and the per-project `byProject` attribution (`:1245-1265`) are
  window-derived too, but no component was found rendering them. If WP2 confirms any shown value,
  WP11 is **P0**.
- Wave 1.1 applied no DESIGN_SYSTEM or SYSTEM_ARCHITECTURE edits for #341. DESIGN_SYSTEM §F.5 still
  reads "Ruling needed" and SA still carries `withCache`. WP17, WP8, WP9 and WP16 land those halves.

---

## 1. Standard header — paste above EVERY prompt

```text
You are working in the Projective monorepo (Deno 2.x; apps/web Fresh 2 + Vite + Preact islands
with @preact/signals; packages/ui the pure-CSS BEM design system @projective/ui; packages/types the
Zod SSOT @projective/types; packages/backend fat services @server/services/*; supabase/migrations
Postgres with RLS everywhere). You are building one work package of track O (optimisation and
design system), FOUNDER_QUESTIONNAIRE.md Part B §B.3.

Before writing code:
  1. Read the root CLAUDE.md and every sub-directory CLAUDE.md on the paths you touch (at least
     documentation/CLAUDE.md and packages/ui/CLAUDE.md; documentation/database/CLAUDE.md when SQL
     changes), then documentation/reference/guardrails.md and
     documentation/reference/pr-checklist.md.
  2. Read documentation/architecture/PROJECTIVE_REDUNDANCY_AND_OPTIMIZATION_AUDIT.md (the U-, L-,
     D-, G-, QW-, SC- and DB- IDs cited below) and ARCHITECTURAL_DECISIONS_AND_CLARIFICATIONS.md
     (Q1-Q17, the options behind each ruling).
  3. Read Decision #341's OWNER RULINGS (grep -n '^| 341 |'
     documentation/reference/decisions/decisions-122-126.md) and FOUNDER_QUESTIONNAIRE.md Part C,
     rows E1, E2 and E3. Where a prompt cites #337, #338 or #339, read that row's rulings too.
  4. Grep documentation/reference/decisions/README.md for the surface you touch and read the
     decision files it names. At minimum: #10 (ServiceResult), #88 (slugs), #157 (button tiers),
     #191 (the pending window), #245 (a) (no focus ring), #248 (pinned currency), #277, #281 and
     #301 (figures never converted), #280 (the landing exemption), #293/#294 (ticket moves), #330
     (the neutral --tint).

Hard rules (merge gates; reject your own diff if any of these fails):
  Caching (SYSTEM_ARCHITECTURE §Caching Strategy, as rewritten by WP17)
  - Read order: request memo → ArcCache (per isolate, tenant-scoped) → Deno KV (global, small,
    optional) → Postgres. Aggregates (wallet flow, inbox order) are computed in Postgres.
  - A key for any RLS-scoped read carries its tenant (cacheKey(tenantOf(actor))). Never a global
    key for a viewer-scoped answer. Public data uses the explicit anonymous tenant.
  - KV holds only small, global values (FX tables, query embeddings, version keys, rate-limit
    counters): under 64 KiB, never tenant-scoped, never awaited on the answer path.
  - TTL is the guarantee; invalidation is the optimisation. A writer bumps its version key after
    its write commits. A single-flight shares a rejection only with that flight's callers and never
    caches it.
  Money (Decision #341, ruling E2)
  - Integer minor units. Every visible figure renders through MoneyView (@projective/ui/display).
    Strings appear only in aria-labels and sentences (WP7 settles commit-button labels).
  SSOT & architecture
  - Migrations are consolidated and EDITED IN PLACE (supabase/migrations/vvvvtooo_type_purpose.sql).
    Never an ALTER patch or a new "fix" file. Each statement goes in its category file: 0 tables ·
    1 functions/triggers · 2 policies/grants · 3 views · 4 indexes · 5 seed.
  - A schema or RPC-contract change lands with its Zod schema (packages/types/*), the backend
    mapper and documentation/database/<schema>/* in the SAME change.
  - Thin routes: HTTP parse + Zod + auth guard only. Logic lives in packages/backend/services/* and
    returns ServiceResult<T> (#10). Islands never import Supabase or @server/*.
  - Signal-first state; useEffect only for external DOM/browser APIs. No useState.
  - Path aliases only; folders components/ islands/ styles/ hooks/ wrappers/ types/ core/; no src/.
  - JSDoc on exports; // #region [Name] … // #endregion; no meta-comments.
  UI (DESIGN_SYSTEM.md; root CLAUDE.md §3), for any prompt that touches a component or a sheet
  - Token-only pure CSS + strict BEM: no hex/rgb, no literal radius/duration/shadow/weight/
    breakpoint, no inline style= except packages/ui styleVars().
  - Solid region fills (--bg → --surface-1 → --surface-2); no color-mix(…, transparent) on a
    region; no card in a card or in an elevated panel; static content unboxed (§B.9).
  - Anti-tag (§B.11): non-actionable metadata is inline --text-secondary MetaLine text joined by
    " · ". Containers only for controls, lifecycle statuses, required disclosures and counts.
  - Type (§A.4): four registers; no heading at --fw-bold or heavier; tabular-nums on any figure
    that changes.
  - Buttons (§B.8, #157): one filled button per decision region; tier 1 amber for money movement
    only. Press = transform: scale(var(--btn-press-scale)), removed (transform: none) under BOTH
    @media (prefers-reduced-motion: reduce) AND :root[data-motion="reduced"].
  - Focus rings stay OFF (#245 (a)). Ruling E3 Q3 accepts a keyboard ring in principle, but the
    owner's design is pending: add no ring and restore none.
  - The conversion lane (§3.10) on entity-view routes; a control that renders must act (§3.11).
  - A new or changed @projective/ui component updates the DESIGN_SYSTEM.md §C.1 roster in the same
    change. Re-read DESIGN_SYSTEM.md from main right before you edit it: every track edits it.
  Product
  - Every new simulatable axis gets its Dev Context Switcher control in the same change:
    DevOverrides + DEV_DEFAULTS, DevOption list, DevContextPanel control, reflect() set AND delete
    (apps/web/features/devtools/, seam apps/web/utils/dev-seam.ts, a §B.0 hot file).
  - No bespoke statuses; nothing hard-deleted (archive / active=false).
  - A rule this prompt builds that PRODUCT_SPEC, finance-model.md, PRODUCT_MANAGEMENT.md,
    SYSTEM_ARCHITECTURE.md or DESIGN_SYSTEM.md marks "**Not built yet** (Decision #NNN, ruling X)"
    or "**Planned**": remove the marker in the same change.
  - A NEW contradiction between source docs: do not pick a side. Add a decision row (the newest
    documentation/reference/decisions/decisions-*.md + a README index line; re-check the index for
    the next free number right before you write, because parallel sessions race for numbers) and
    ask me.

Verification: reproduce the defect first (a Deno unit test with a counting fake, or a SQL probe
under supabase/probes/ wrapped in a ROLLBACK), then fix. Run `deno task check`, `deno task lint`,
`deno task test:unit`, and `deno fmt` on the files you touched only (never a directory). Some
theme-engine.test.ts failures are pre-existing (Decisions #96 (a), #157 (m)): compare with main
before treating a failure as yours. SQL prompts follow their SQL RULES block. UI prompts: run
`deno task dev` (restart it after editing packages/*), sign in as the seeded personas
(documentation/database/Seed.md), and capture screenshots at 1440, 900 and 390 px in light, dark,
data-contrast="high" and data-motion="reduced". Docs are CRLF in the working tree: edit them with
an editor, never sed. Commit on the branch you were given with a clear message; do not open a PR
unless I ask.
```

---

## 2. Phase 0 — Doctrine

### WP17 — SYSTEM_ARCHITECTURE §Caching Strategy describes the real tiers

```text
PROMPT WP17: SA §Caching Strategy describes the four real tiers and the placement table

ROLE: Documentation steward (architecture). Docs only; no code.

CONTEXT: #341 flag (b) is a new contradiction. SA §Caching Strategy's withCache sample has no
implementation, and if copied it would leak across tenants (ADC Q2: KV opened per call, falsy values
treated as misses, no tenant in the key, no memory tier, no single-flight, kv.set awaited on the
request path, the 64 KiB limit ignored). Its prose describes behaviour the code lacks: project
metadata "5 minutes in KV" is a 30 s per-isolate ArcCache, static metadata is uncached, and
profile-view counters use the search.record_view definer, not kv.atomic(). Ruled: SA rewritten to
the four real tiers plus cachedGlobal on KV (Decision #341, ruling E1 Q2), with Q11's placement
table (ruling E1 Q11), Q10's coalescing (ruling E1 Q10) and Q7's invalidation (Decision #339,
ruling N2). This runs first so no Wave 2 track copies the unsafe sample while WP10a builds the
real helpers.

WAITS: none.

FILES:
  - documentation/architecture/SYSTEM_ARCHITECTURE.md §Caching Strategy (:2942-3056). Rewrite the
    intro (:2944-2946), "Server-Side: Deno KV" (:2948-2963), "What to Cache" (:3023-3029) and
    "Implementation Patterns" (:3031-3054). Leave "Browser Storage", "Service Workers" and the
    shipped offline table (:2965-3021) as they are.

STEPS:
  1. The tiers, in read order: request memo (one request; apps/web/utils/request-memo.ts) →
     ArcCache (packages/backend/core/cache.ts: per isolate, tenant-scoped by type, size- and
     TTL-bounded) → Deno KV (packages/backend/core/kv.ts openSharedKv: global, small,
     cross-isolate, optional, degrading to memory) → Postgres. State the tenant rule, "TTL is the
     guarantee, invalidation the optimisation", the 64 KiB value limit, and that a KV write is
     never awaited before answering.
  2. Q11's placement table from ADC Q11: request memo; ArcCache by tenant (30 s); ArcCache under
     the anonymous tenant (5-15 min) for public read models; a 1 h module memo for reference data,
     only after a per-table RLS check; memory → KV for FX tables and query embeddings; aggregates
     in Postgres. Add an empty row for the in-isolate catalogue budget, which Q12 fills.
  3. Invalidation (#339 N2 = ADC Q7 B): KV version keys bumped by the fat-service writer after a
     successful write. One key per global domain (["cache","v","catalogue"], "fx", "reference"),
     one per affected tenant for messaging. Isolates compare at most once a second. The TTL
     backstops out-of-band writes (SQL console, cron).
  4. Replace the withCache sample with the cachedGlobal(key, ttlMs, fetch) contract (global public
     values only, never a tenant-scoped one) and a short ArcCache example with a tenant key.
  5. Mark each helper WP10a has not built yet "**Not built yet** (Decision #341, ruling E1 Q10)" or
     "(… ruling E1 Q2)" or "(Decision #339, ruling N2)": the request memo module, single-flight in
     through(), cachedGlobal, the version keys. WP10a removes the markers.
  6. Do NOT delete "Search Results … cached in Deno KV" (:3028-3029). The owner ruled the pgvector
     KV cache Build now (Decision #339, ruling P3 (c)); track M's search step builds it. Rewrite
     it as a placement row (KV, global, public results only, ids not payloads, under 64 KiB) marked
     "**Not built yet** (Decision #339, ruling P3 (c))".
  7. Rewrite the remaining Deno KV prose (secondary indexes, kv.atomic() counters, kv.enqueue()
     queues) to what the code does today (grep first). A capability no code uses becomes one line
     marked "not used".

ACCEPTANCE:
  - grep -n "withCache" documentation/architecture/SYSTEM_ARCHITECTURE.md → no hits.
  - The placement table is present, and every unbuilt helper carries a marker naming its ruling.
  - No code file changed.
```

---

## 3. Phase 1 — Cache primitives

### WP10a — Single-flight, one request memo, `cachedGlobal` and version keys

```text
PROMPT WP10a: Single-flight in ArcCache, one request memo, cachedGlobal and KV version keys

ROLE: Backend platform engineer (Deno). Code only; no SQL.

CONTEXT: ArcCache.through does not coalesce concurrent misses, and its comment's rationale does
not hold, because keys are tenant-prefixed by type, so one key is one RLS scope (D-06, D-23; ADC
Q10). The per-request memo is copy-pasted six times (D-23). The get() comment says an expired entry
is demoted to its ghost list, but #expire deletes it (ADC Q2). Nothing invalidates across isolates
(D-14, D-22). Ruled: single-flight in through() plus one shared request memo (Decision #341, ruling
E1 Q10); cachedGlobal on KV (ruling E1 Q2); KV version keys bumped by the writer, with the TTL as
the backstop (Decision #339, ruling N2). Track M's N2 long-poll and RED WP12 consume these. If an M
step already created any of them at these paths, adopt it and only migrate the remaining copies.

WAITS: none (WP17 first is preferred, not required).

FILES:
  - packages/backend/core/cache.ts (get() doc :298-303 vs #expire :253; through() and its comment
    :425-438) + cache.test.ts
  - packages/backend/core/kv.ts (cachedGlobal; the version keys) + kv.test.ts (new)
  - apps/web/utils/request-memo.ts (new) + request-memo.test.ts (new)
  - the six copies: apps/web/features/workspaces/core/workspace-memo.ts (:23),
    apps/web/features/catalogue/core/catalogue-ssr.ts (:64), apps/web/features/calendar/core/
    calendar-slots.tsx (:45), apps/web/features/projects/core/files-ssr.ts (:61),
    apps/web/features/projects/core/submissions-ssr.ts (:35), apps/web/utils/session.ts (:57)
  - documentation/architecture/SYSTEM_ARCHITECTURE.md §Caching Strategy (remove WP17's markers for
    what you build)

STEPS:
  1. Reproduce: a test fires two concurrent through() misses for one key and counts the compute
     calls (2 today).
  2. Single-flight: an in-flight Map<string, Promise<V>> keyed exactly as the entry. A second miss
     awaits the first flight; the slot clears in finally; a rejection reaches only that flight's
     callers and is never set. Rewrite the :425-432 comment to say why this is safe (one key = one
     tenant = one RLS scope), and correct the get() comment to match #expire.
  3. request-memo.ts: once<T>(scope: object, key: string, run: () => Promise<T>): Promise<T> over a
     WeakMap<object, Map<string, Promise<unknown>>>, keyed by the request's own URL (or Request)
     object so it is collected with the request. A rejected promise leaves the memo, so a retry in
     the same request runs again. Migrate the six copies (session.ts keeps its Request scope) and
     delete each local copy and its comment.
  4. cachedGlobal<T>(key: Deno.KvKey, ttlMs: number, fetch: () => Promise<T>): Promise<T> in kv.ts:
     memory → KV → fetch; a KV hit fills memory; single-flight; the KV write not awaited on the
     answer path; a value over 60 KiB served from memory only (log once); null, false, 0 and "" are
     cacheable (store a wrapper, never test `if (value)`). Its JSDoc says it takes global public
     values only.
  5. Version keys: bumpCacheVersion(scope: readonly string[]) writes a fresh crypto.randomUUID()
     to ["cache","v",...scope]; cacheVersion(scope) reads it at most once a second per isolate per
     scope. With KV absent, versions are constant and TTLs carry freshness. Document how a version
     enters a cache key (one helper, used everywhere).
  6. SA: remove the Not built yet markers for these four pieces.

ACCEPTANCE:
  - The concurrency test shows one compute; a rejection test shows the next flight recomputes.
  - grep -rn "new WeakMap<URL" apps/web/features → no hits. request-memo.test.ts covers reuse,
    isolation between two requests, and the rejection drop.
  - kv.test.ts runs with KV absent (test:unit passes no --unstable-kv) and with a stub Kv handle; a
    falsy answer is cached; an oversized value is served from memory.
  - Callers see no behaviour change beyond fewer duplicate reads; `deno task test` passes.
```

---

## 4. Phase 2 — Read paths

### WP2 — `/wallet` resolves its wallet context once

```text
PROMPT WP2: /wallet resolves its wallet context once per request, and the Q13 check runs

ROLE: Backend engineer (fat services + SSR). Code only. You are the only writer of the §B.0 hot file
live-wallet.ts / wallet-scope.ts while this runs.

CONTEXT: One /wallet render resolves the wallet context 7 times: 6 in wallet-ssr's Promise.all,
each through WalletBackendService.read() → resolveWalletContext (6 PostgREST reads plus FX), and a
7th, with a second overviewOf, in the layout lane (D-01, D-02; QW-4). That is about 45 duplicate
reads on the TVL-critical surface. Ruled: memoise the wallet context, then SQL aggregates; P0 if
any displayed figure comes from the 1,000-row window (Decision #341, ruling E1 Q13). This prompt is
the memoisation and the verification; WP11 is the aggregates.

WAITS: F·SV2, F·SV3 and F·SV5 merged (all three write live-wallet.ts / wallet-scope.ts).

FILES:
  - packages/backend/services/finance/WalletBackendService.ts (read() :70-79; a new home())
  - packages/backend/services/finance/wallet-scope.ts (resolveWalletContext :149-172)
  - packages/backend/services/finance/live-wallet.ts (the projections take a resolved context)
  - apps/web/features/wallet/core/wallet-ssr.ts (the fan-out :92-101) and wallet-lane-slot.tsx
    (:29); the handlers behind apps/web/routes/(dashboard)/wallet/{index,transactions,analytics,
    invoices,[section]}.tsx (they put the result on ctx.state)
  - tests (new): packages/backend/services/finance/WalletBackendService.test.ts,
    apps/web/features/wallet/core/wallet-ssr.test.ts

STEPS:
  1. Reproduce: a unit test with a counting stub of resolveWalletContext shows 6 calls for a
     personal /wallet read, and 7 with the lane.
  2. WalletBackendService.home(query, view, params, actor): resolve the context once, then run
     overview + switcher, transactions, activity, funding, payouts, methods, access and invoices
     against it in one Promise.all. Keep each existing method as a thin wrapper (resolve, then
     project) for the API routes that need one projection. Same ServiceResult shapes and errors.
  3. wallet-ssr.ts calls home() once. The handler puts the result on ctx.state (the
     projectWorkspace / projectNavActivity pattern); wallet-lane-slot.tsx reads ctx.state and
     never re-runs overviewWithSwitcher.
  4. The Q13 verification. For each figure below, record whether it is rendered, and whether it
     comes from LEDGER_WINDOW (1,000 rows) rather than a balance column or an SQL aggregate. A
     read-only pre-scan (2026-10-30) found these candidates; confirm or refute each:
       - overviewOf / aggregateOverview: `lifetime` and balances.lifetimeCents (live-wallet.ts
         :867, :1010; no wallet component rendered it on 2026-10-30, so check every surface that
         reads the overview DTO), and the overview `flow` series (flowSeries over the window);
       - activityOf: the per-project "moved" attribution (:1245-1265; byProject in the DTO, with
         no rendering component found on 2026-10-30);
       - payoutsOf → smootherState (:423): the first-earning date that decides eligibility and the
         weeks to go, and `projected`;
       - invoicesOf: statement figures over a 200-day window (:1688);
       - the CSV export, capped by EXPORT_LIMIT = LEDGER_WINDOW (:1081).
     Write the table into the commit message and into the D-03 row of
     PROJECTIVE_REDUNDANCY_AND_OPTIMIZATION_AUDIT.md (one line: "Q13 check: …"). If any rendered
     figure is window-derived, say "WP11 is P0" in the commit message's first line.
  5. If WP5a has landed ticketHref(), adopt it at live-wallet.ts:889 (WP5a leaves this hot file to
     you).

ACCEPTANCE:
  - The counting tests show exactly 1 context resolution for /wallet, /wallet/transactions,
    /wallet/analytics and /wallet/invoices, lane included.
  - The rendered HTML for a seeded persona is identical before and after (mask now()-derived
    figures).
  - The Q13 table is in the commit message and the audit row.
```

### WP11 — Wallet figures from SQL aggregates

```text
PROMPT WP11: Wallet figures come from SQL aggregates, never a 1,000-row JS fold

ROLE: Postgres + backend engineer. SQL prompt.

CONTEXT: overviewOf, activityOf and payoutsOf each pull up to 1,000 finance.transactions rows and
fold them in JS (D-03). The ledger filters run after the keyset page, so pages come back short or
empty while hasMore is true (D-20). Ruled: SQL aggregates after the memoised context, P0 if any
displayed figure is window-derived (Decision #341, ruling E1 Q13); fetch less rather than cache
more (ruling E1 Q11, option C). WP2's commit message holds the verification table.

WAITS: WP2 merged (and so F·SV2/SV3/SV5). Not while F·DB3 runs (00001210) or any session writes
00002510.

FILES:
  - supabase/migrations/00001210_functions_finance_kyc_wallet.sql (finance.list_ledger :3199,
    with the fundState / category / project filters pushed in; finance.ledger_flow :3290; the new
    aggregate function(s) beside them)
  - supabase/migrations/00002510_permissions_function_grants.sql (:1831-1838, plus the new
    functions' REVOKE / GRANT)
  - packages/backend/services/finance/wallet-ledger.ts (LEDGER_WINDOW :50; the post-page filters
    :1095-1097; readFlowBuckets :1178) and live-wallet.ts (every readLedger(…, LEDGER_WINDOW))
  - packages/types/finance/{ledger,wallet}.ts (any DTO field whose meaning changes)
  - supabase/probes/wallet_aggregates.sql (new)
  - documentation/database/finance/Functions.md

SQL RULES (§B.0): there is one local Supabase DB. Run probes with `deno task test:probes`. At most
2 SQL sessions at once, on disjoint migration files; announce each `deno task db:reset` to the other
sessions before you run it. Finish with your own clean `deno task test:probes:fresh`.

STEPS:
  1. Reproduce in a ROLLBACK probe: seed 1,200 earning credits on a test wallet and show that a
     1,000-row window understates the lifetime sum; page list_ledger with a category filter and get
     a short page while more matching rows exist.
  2. finance.list_ledger: the filters move into the WHERE before the keyset LIMIT (edit in place;
     the signature change re-grants in 00002510). The service stops filtering after the page.
  3. Add the smallest set of read functions that covers every window-derived figure WP2 confirmed,
     with ledger_flow's security model (RLS applies to the caller). For example one
     finance.wallet_summary(p_wallet_ids uuid[], p_since timestamptz) returning per-currency
     lifetime earned and spent, the first earning instant, and per-project moved sums. Sums stay
     per currency; conversion stays in the service (sumOf), unchanged.
  4. Replace each confirmed window fold with its aggregate. `recent` uses list_ledger limit 8; the
     overview flow uses ledger_flow (readFlowBuckets), as analytics already does. The CSV export
     pages list_ledger to the end instead of stopping at LEDGER_WINDOW (same content type).
  5. If no figure still needs LEDGER_WINDOW, delete it; otherwise leave one comment naming the
     remaining non-figure use.
  6. Zod and Functions.md in the same change.

ACCEPTANCE:
  - wallet_aggregates.sql passes: the 1,200-row lifetime and per-project sums are exact, a filtered
    page is full while more rows exist, and the export returns every row.
  - grep -n "LEDGER_WINDOW" packages/backend/services/finance/live-wallet.ts → no use that feeds a
    figure.
  - finance_invariants.sql and function_grants.sql pass; `deno task test:probes:fresh` is clean.
```

### WP10b — Each cacheable read in its Q11 tier

```text
PROMPT WP10b: Put each cacheable read in its Q11 tier

ROLE: Backend engineer. Code only.

CONTEXT: FxService reads KV first, and a KV hit never fills memory, so every request (the 30 s
poller included) pays a KV read, with no single-flight on expiry (D-12, QW-7). The public profile
view and its section RPCs run on every anonymous hit (D-16). The /view similar rail runs a vector
search per request (D-17). Reference data (standing_*, plans, platform_params) is read per call
(D-24). The seller console builds actors with one WorkspaceBackendService.detail per team (D-21).
The reviews tab re-reads get_profile_view (D-25). Ruled: memory first, KV only for small global
values, per the placement table (Decision #341, ruling E1 Q11); single-flight (ruling E1 Q10).

WAITS: WP10a merged. The FxService step also waits for F's FX-feed prompt (#337 M5 (f)) and F·SV5
if either edits FxService.ts: check git log -- packages/backend/services/finance/FxService.ts.

FILES:
  - packages/backend/services/finance/FxService.ts (the tier order :69-95; :214-227;
    invalidate() :338, which has no caller)
  - packages/backend/services/profile/live-profile.ts (:481 get_profile_view and the section
    RPCs) and ProfileBackendService.ts (:209-211)
  - packages/backend/services/explore/live-view.ts (:354 fn_nearest_to_entity)
  - packages/backend/services/finance/wallet-standing.ts (:54-55), PlanBackendService.ts (:75),
    live-buyer.ts (:759)
  - apps/web/features/catalogue/core/catalogue-lane-slot.tsx (:52-54)
  - the matching tests; documentation/architecture/SYSTEM_ARCHITECTURE.md placement table

STEPS:
  1. FxService: memory → KV → DB (the EmbeddingBackendService order). A KV hit fills memory; one
     in-flight refresh per base. invalidate() bumps the "fx" version (WP10a), and every rate writer
     calls it.
  2. An anonymous-tenant ArcCache for get_profile_view and its section RPCs, ONLY when
     !canReadLive(actor): the signed-in payload carries isOwner and follows. The same for
     fn_nearest_to_entity, keyed by entity (the PublicMetricsService pattern). Start at 60 s; once
     profile and listing writers bump a version, use Q11's 5-15 min.
  3. Reference data: for each of security.platform_params, finance.standing_levels,
     finance.standing_commission_tiers and the plan tables, read its RLS policies and record in the
     commit message whether the answer varies by viewer. Only an invariant table gets a 1 h module
     memo (cachedGlobal if it is small), invalidated by the "reference" version. A table whose
     answer varies by viewer stays uncached.
  4. D-21: take the needed capabilities from the roster read, or one tenant-scoped ArcCache entry;
     never one detail read per team.
  5. D-25: pass in the rating the page already holds.
  6. SA: each adopter appears in the placement table.

ACCEPTANCE:
  - FxService test: N reads inside the TTL → no KV read after the first fill; concurrent expiry →
    one DB read.
  - A signed-in viewer never receives a cached anonymous payload (a test with two actors).
  - The per-table RLS finding is in the commit message.
```

### WP3b — The catalogue invalidates across isolates

```text
PROMPT WP3b: The catalogue invalidates across isolates, so its TTL can grow

ROLE: Backend engineer. Code only.

CONTEXT: Wave 0 (92c7941f) fixed the 1,000-row truncation (D-09), parallelised byIds and added SWR,
but invalidation stayed in one isolate: invalidateCatalog() reaches only the writer's isolate and
forces a blocking reload there. So the TTL stays 30 s (live-catalog.ts:438), and each expiry costs
a reload of about 20 requests (D-14; ADC Q7). Ruled: KV version keys bumped by the writer, with the
TTL as the backstop (Decision #339, ruling N2); public read models at 5-15 min (Decision #341,
ruling E1 Q11).

WAITS: WP10a merged.

FILES:
  - packages/backend/services/explore/live-catalog.ts (CATALOG_TTL_MS :438; loadCatalog;
    invalidateCatalog :489)
  - its callers: packages/backend/services/catalogue/CatalogueBackendService.ts,
    packages/backend/services/search/embedding-sync.ts, and any writer step 3 finds
  - packages/backend/services/explore/live-catalog-version.test.ts (new)

STEPS:
  1. invalidateCatalog() keeps its local reset, so the writer reads its own write, and also bumps
     ["cache","v","catalogue"] after the write commits. Every other isolate's loadCatalog() reads
     the version (at most once a second) and treats a change as expiry: serve `latest` and refresh
     in the background, through the existing SWR path.
  2. CATALOG_TTL_MS moves into Q11's 5-15 min band. Its comment says the version key is the
     freshness path and the TTL the backstop for out-of-band writes.
  3. Every catalogue-visible write (publish, unpublish, profile, article, placement, skill) reaches
     invalidateCatalog(). List the writers you found in the commit message.

ACCEPTANCE:
  - Two simulated isolates (import the module twice, the second with a query string such as
    "./live-catalog.ts?isolate=2", sharing a stub Kv): a bump in one makes the other refresh on its
    next read after the 1 s version check, without a blocking reload.
  - With KV absent, the catalogue still refreshes by TTL.
```

### Q12 — Measure the in-memory catalogue and name the switch

```text
PROMPT Q12: Measure the in-memory catalogue and name the switch to per-query search

ROLE: Backend engineer + architect. Code + docs. 🧑 DECISION before the budget is encoded.

CONTEXT: The public catalogue is held whole in every isolate (live-catalog.ts), so memory grows
linearly with the marketplace (ADC Q11, Q12). Ruled: in memory now, loaded correctly (D-09, built
in Wave 0), with a measured switch to per-query search later (Decision #341, ruling E1 Q12), and a
memory budget for the in-isolate catalogue (ADC Q11).

WAITS: WP3b merged (same file).

FILES:
  - packages/backend/services/explore/live-catalog.ts (a size measure after each load)
  - packages/backend/services/logging/LogBackendService.ts (the ops.log_entries writer)
  - packages/backend/services/explore/live-catalog-budget.test.ts (new)
  - documentation/architecture/SYSTEM_ARCHITECTURE.md §Caching Strategy (the budget row WP17 left)

STEPS:
  1. Measure: after each successful load, the entity count per type and the projection's
     serialised size (JSON byte length, a stable proxy for heap). Log both at debug and expose them
     to the test.
  2. Measure at seed scale and at a synthetic 10× and 100× (the paging test's fake source). Record
     load time and size per scale in the commit message.
  3. 🧑 DECISION — STOP and put the threshold to me. Options: (a) an entity-count budget per type;
     (b) a serialised-size budget per isolate; (c) a reload-latency budget (p95 of the keyset
     reload). Recommendation: (b) plus (c), whichever trips first, sized from step 2 against the
     per-isolate memory of the deploy target, with the numbers proposed.
  4. After the ruling: when the projection passes the budget, write one warning per isolate per
     day to the ops log, naming the measure and its value. Write the budget and the switch plan
     into SA: the per-query path is Q12 option B (search.* per request, HNSW for semantic, keyset
     pages, first pages cached under the anonymous tenant), marked "**Planned** (Decision #341,
     ruling E1 Q12)". The switch itself is not built here.

ACCEPTANCE: the size and count measures are tested on the fake source; the warning fires once past
the budget and not again that day; SA names the budget and the trigger.
```

### Q9 — Chrome reads come from the token's presentation claims

```text
PROMPT Q9: Chrome reads come from the token's presentation claims

ROLE: Postgres + backend engineer. SQL prompt.

CONTEXT: Every hydration makes a GoTrue HTTP auth.getUser for identity (D-07), reads
user_preferences twice (D-10; liveDateFormat guards a schema state consolidated migrations make
impossible) and calls get_party_cards only for the handle (D-11). The access-token hook already
stamps displayCurrency, locale, dateFormat, the handle and the context (00001700). Ruled: JWT
claims drive presentation only, adding layout_direction and timezone, never role or capability
(Decision #341, ruling E1 Q9). ADC Q9 A adds: refresh the session after a preference write.

WAITS: none in this track. Do not run beside an identity step that edits
00001700_functions_access_token_hook.sql (I3's session guard may): check git log for that file.

FILES:
  - supabase/migrations/00001700_functions_access_token_hook.sql, edited in place (the
    presentation claim :223-258)
  - packages/types/auth/user-context.ts (AccessTokenClaims :142; resolveUserContext :293) +
    user-context.test.ts
  - apps/web/utils/user-context.ts (decodeAccessClaims :32)
  - packages/backend/services/user/UserBackendService.ts (getUser :240; livePreferences and
    liveDateFormat :437-470; setup :204-211)
  - apps/web/routes/api/user/preferences.ts (re-issue the session after a write, through the
    renewal path apps/web/utils/auth-cookies.ts already uses)
  - documentation/database/org/Functions.md (or the file that documents custom_access_token_hook:
    grep documentation/database); SYSTEM_ARCHITECTURE.md where the claims are listed
  - supabase/probes/access_token_claims.sql (new)

SQL RULES (§B.0): there is one local Supabase DB. Run probes with `deno task test:probes`. At most
2 SQL sessions at once, on disjoint migration files; announce each `deno task db:reset` to the other
sessions before you run it. Finish with your own clean `deno task test:probes:fresh`.

STEPS:
  1. Reproduce: a unit test with a stubbed GoTrue client counts one getUser per /api/user/me; a
     probe calls the hook for a seeded user and shows layoutDirection and timezone absent.
  2. The hook adds layoutDirection (org.user_preferences.layout_direction) and timezone
     (org.users_public.timezone) to the same presentation claim as displayCurrency, locale and
     dateFormat. Nothing about role, capability, team or vault rights is added or newly trusted.
  3. AccessTokenClaims and resolveUserContext carry the two fields (Zod in the same change).
  4. UserBackendService: identity display (email; user_metadata name and avatar, the avatar still
     through safeOAuthAvatarUrl) comes from the claims of the access token the middleware has
     already verified, never from an unverified decode. Preferences come from the claim, with one
     select only when the claim is absent (an old token). Delete liveDateFormat. setup takes the
     handle from context.handle in a personal context and keeps its one progress RPC.
  5. PATCH /api/user/preferences re-issues the session after a successful write, so the next
     request carries the new claims; the response sets the renewed cookies as the refresh path does.
  6. List in the commit message every server-side decision that reads a role or capability claim.
     A write, money or authorisation decision taken from a claim is a finding: flag it there and in
     the audit; do not widen this prompt.
  7. The Dev Context Switcher's existing layoutDirection axis must still win over the claim under
     the dev seam (assert it in a test). No new axis. If the seam needs an edit, you become a writer
     of the §B.0 hot file features/devtools + dev-seam.ts: check no other session holds it.

ACCEPTANCE:
  - access_token_claims.sql: the claim carries layoutDirection and timezone for a seeded user; a
    user with no preferences row gets 'auto' and null.
  - The counting test shows no getUser call and at most one preferences read per /api/user/me (none
    when the claim is present).
  - After PATCH /api/user/preferences, the next /api/user/me shows the new value without a DB read.
  - The token still fits the auth cookie (check auth-cookies.ts's size handling).
  - `deno task test:probes:fresh` is clean.
```

### WP13 — One cached chrome read per navigation

```text
PROMPT WP13: One cached chrome read per navigation

ROLE: Full-stack engineer (thin route, fat service, island). Code only.

CONTEXT: The header fetches /api/user/me and /api/user/setup on every page, each re-running the
global middleware: about 7 uncached Supabase reads per navigation, plus /api/notifications/summary
every 30 s (D-08). Ruled: one chrome endpoint (DB-5) whose identity and preferences come from the
token after Q9 (Decision #341, ruling E1 Q9), cached per tenant and invalidated through KV version
keys (Decision #339, ruling N2); the 30 s summary poll gives way to N2's long-poll.

WAITS: Q9 and WP10a merged; track M's N2 long-poll step merged (it owns the notification transport).

FILES:
  - apps/web/routes/api/user/me.ts (carries the setup projection too); apps/web/routes/api/user/
    setup.ts stays as a thin wrapper over the same cached call, so the dev seam's setup override
    (apps/web/utils/dev-seam.ts :117, a hot file) needs no edit
  - packages/backend/services/user/UserBackendService.ts (one chrome(actor) projection)
  - apps/web/features/shell/core/AccountService.ts (:17, :35) and
    apps/web/features/shell/islands/UserActions.island.tsx
  - apps/web/features/notifications/core/NotificationService.ts (:99, the summary poll)
  - documentation/architecture/ROUTING.md (the /api/user/me row)

STEPS:
  1. Reproduce: count Supabase requests for one signed-in navigation (a test with a counting client
     around the two handlers).
  2. UserBackendService.chrome(actor): me + setup in one projection, in a tenant ArcCache entry
     (cacheKey(tenantOf(actor)), 30-60 s) whose key includes the tenant's version (WP10a). Every
     profile, preference, handle and setup-progress write bumps that tenant's version.
  3. The island makes one fetch per navigation.
  4. The unread badge follows what N2 shipped (the ETag long-poll) instead of a 30 s interval. If N2
     exposes the summary with an ETag, the island makes conditional GETs. Remove the interval.
  5. ROUTING.md: update the /api/user/me row to its new response.

ACCEPTANCE:
  - One navigation → 1 chrome fetch and at most 1 Supabase read on a warm tenant cache.
  - A preference write shows on the next navigation in a second simulated isolate (the version
    bump).
  - No setInterval remains for the summary in NotificationService.
```

---

## 5. Phase 3 — Shared rules & server flags

### WP5a — One home for each shared pure rule

```text
PROMPT WP5a: One home for each shared pure rule, each with a parity test

ROLE: Types engineer. Code only (TypeScript).

CONTEXT: Pure rules exist in two to four copies that already drift: the pipeline price range
(L-04; the copies round differently, and the "exactly once" comment is untrue), the IQR-fenced
lowestActivePrice (L-05), the even split (L-07), the ?tkv= param and its three exclusion lists
(L-16), the Chain Reaction default restated about nine times (L-10), the "in work" and
"work-locked" sets (L-09, TS half), two identical formatMoney implementations (L-12), the FX rate
at 4 dp in the wallet and 6 dp in MoneyView (L-14), and about ten bp→% formatters (L-17). Ruled:
pure rules mirrored in TS with a parity test (Decision #338, ruling P5 (e) = Decision #341 flag
(n); ADC Q14 A). PM-WP6 owns the ticket-move matrix (L-03); this prompt does not touch it.

WAITS: P·WP2, merged in Wave 0 (3fcf2d54). The projects service files below are P-track files:
one-line edits, but do not run while a P step is open on the same file (git status, git log).

FILES (each helper lands with a unit test asserting parity with every copy it replaces):
  - packages/types/projects/board.ts: pipelineRange() beside stageCostCents, on INTENSITY_MULTIPLIER
    (:111); CHAIN_REACTION_DEFAULT; TICKET_PARAM, ticketHref() and one exclusion set, re-exported
    by apps/web/features/projects/core/ticket-link.ts (:76-89) and used by
    apps/web/routes/(public)/_layout.tsx (:16, :22)
  - packages/types/explore/*: lowestActivePrice, from apps/web/features/explore/core/pricing.ts
    (:23) and packages/backend/services/explore/query.ts (:23)
  - packages/types/workspace/*: evenSplit, from packages/backend/services/workspace/mappers.ts
    (:1146) and apps/web/features/workspaces/core/payout-model.ts (:510, evenStakes)
  - formatMoney: keep packages/types/finance/wallet.ts (:1407); packages/ui/display/core/
    currency-store.ts (:188) re-exports it. Export fxRateLabel from currency-store.ts; MoneyView's
    spokenLabel (MoneyView.tsx :103) and apps/web/features/shell/core/currency-state.ts (:84) use it
  - one formatPercentBp (or formatSplitPercent from @projective/ui/fields where it already fits)
  - callers: apps/web/features/catalogue/core/pricing-model.ts (:77-78);
    packages/backend/services/explore/{pricing.ts :24-26 and its comment :10, live-view.ts
    :146-147}; apps/web/features/explore/core/pricing.ts (:87-88); the WORK_STATUSES and
    ticketWorkLocked sites (types/projects/board.ts :352, :355; workspace.ts :334, :750;
    packages/backend/services/finance/funding-state.ts :95; ProjectBackendService.ts :596, :2979;
    live-members.ts :585); the `chain_reaction ?? true` sites (live-writes.ts :450, live-board.ts
    :753, write-store.ts :1234, ProjectBackendService.ts :711, types/projects/{board.ts :825,
    setup.ts :457}, services/explore/stored.ts :52, apps/web/features/catalogue/core/offer-model.ts
    :120)
  - NOT here, because other prompts own those files: live-wallet.ts :889 (WP2); the wallet and
    checkout formatter sites (WP7 adopts fxRateLabel and formatPercentBp there); the landing demos
    (Q15). packages/backend/services/scheduling/live-calendar.ts (:1046, :1382) only if no C step is
    open on it.
  - DESIGN_SYSTEM.md §C.1 display row, since currency-store's export list changes

STEPS:
  1. For each rule, write the parity test first, against every existing copy. Fixture rows cover
     the edges: 0, 1, odd splits, the IQR fence with fewer than 4 prices, a 0-exponent currency
     (JPY), a 3-exponent one (KWD).
  2. Where copies disagree, the server's behaviour wins (it is what is charged); record each
     client-visible change in the commit message.
  3. Move, re-export, delete the copies; the parity test then asserts the helper against the
     fixture.
  4. CHAIN_REACTION_DEFAULT is tested against the column DEFAULT in
     supabase/migrations/00000015_tables_projects.sql (:370, `NOT NULL DEFAULT true`; read the file
     in the test). Remove the `?? true` fallbacks, since the column is NOT NULL.

ACCEPTANCE:
  - grep -rn "PIPELINE_LOW\|PIPELINE_HIGH\|evenStakes\|chain_reaction ?? true" apps packages, with
    apps/web/features/landing excluded (Q15 pins the demos) → only the canonical definitions remain.
  - No TS file outside @projective/types restates the in-work or work-locked status list.
  - Every new helper has its parity test; `deno task test` passes.
```

### WP5b — One SQL definition of each status set

```text
PROMPT WP5b: One SQL definition of each named ticket-status set

ROLE: Postgres engineer. SQL prompt.

CONTEXT: The "in work" set {claimed, in_progress, in_review} is restated in about 10 inline SQL
lists in 00001140 and at F1110 :372; the "work-locked" set at F1110 :154 (L-09, SQL half). Wave 0's
PM-WP2 added a "held" set with reported_hidden for capacity (Zod HELD_TICKET_STATUSES). Ruled: pure
rules mirrored, with a SQL parity test (Decision #338, ruling P5 (e) = Decision #341 flag (n)).

WAITS: P·WP6 merged (P·WP1, WP4, WP5 and WP6 edit 00001110 and 00001140). WP5a merged.

FILES:
  - supabase/migrations/00001110_functions_projects_ticket_guards.sql, edited in place: one
    IMMUTABLE predicate per named set the TS exports (in work, work-locked, held), beside the
    guards (:154, :372)
  - supabase/migrations/00001140_functions_projects_automation_workload.sql, edited in place: the
    inline lists (for example get_workload_capacity :360-372)
  - supabase/migrations/00002510_permissions_function_grants.sql, only if a caller needs EXECUTE
  - supabase/probes/work_status_parity.sql (new);
    packages/types/projects/work-status.parity.test.ts (new)
  - documentation/database/projects/Functions.md

SQL RULES (§B.0): there is one local Supabase DB. Run probes with `deno task test:probes`. At most
2 SQL sessions at once, on disjoint migration files; announce each `deno task db:reset` to the other
sessions before you run it. Finish with your own clean `deno task test:probes:fresh`.

STEPS:
  1. The probe holds the full matrix as one VALUES list (every ticket_status × in work /
     work-locked / held) and asserts each predicate row by row.
  2. Replace each inline list with the matching predicate. A list that includes reported_hidden is
     the held set (capacity), not the in-work set: keep the two apart.
  3. The TS parity test reads the probe file, parses its VALUES list and asserts WORK_STATUSES,
     ticketWorkLocked and HELD_TICKET_STATUSES row by row: one matrix, two runners.
  4. Functions.md in the same change.

ACCEPTANCE: work_status_parity.sql passes; the TS test passes, and fails when a status is added to
one side only (verify, then revert); no inline status list is left in 00001140;
`deno task test:probes:fresh` is clean.
```

### WP6 — State-dependent rules arrive as server flags

```text
PROMPT WP6: State-dependent rules arrive as server flags on the DTO

ROLE: Full-stack engineer (fat services + Zod + islands). SQL prompt (one read function).

CONTEXT: The client re-derives state-dependent rules the server owns. claimableOf re-checks the
$W_i$ cap with its own HOLDING set (L-06). The board-header funding rollup adopts the first
currency it sees (L-08). The stage-funding dialog decides "the wallet covers it" by comparing the
balance with the amount (L-20). Ruled: state-dependent rules come from the server as DTO flags,
and a permissive client is never acceptable on a money path (Decision #338, ruling P5 (e) =
Decision #341 flag (n); ADC Q14 B). The move matrix (L-03, canMove / canDrag) is PM-WP6's.

WAITS: P·WP6 merged (it owns the move matrix and edits live-board.ts, types/projects/{board,
workspace}.ts and 00001140). WP5a and WP5b merged. Not beside WP7 (stage-funding.ts) or another
00002510 writer.

FILES:
  - supabase/migrations/00001140_functions_projects_automation_workload.sql, edited in place: a
    STABLE read of the tickets the viewer may claim now, using the same seat, Ready and
    stage/global cap predicates as claim_ticket and check_ticket_capacity (call their helpers; do
    not copy the arithmetic) + 00002510 grant + documentation/database/projects/Functions.md + a
    probe
  - packages/types/projects/workspace.ts (:750-775, claimableOf and HOLDING → a server field)
  - packages/backend/services/projects/live-board.ts (the board DTO: claimable; the server rollup
    from rollupFundingState) and the workspace overview mapper
  - apps/web/features/projects/core/funding-ui.ts (:296, fundingRollup → read the DTO)
  - apps/web/features/payments/core/stage-funding.ts (:44), apps/web/routes/api/finance/escrow/
    quote.ts and the quote service (walletCovers on the quote)
  - Zod for every new DTO field

SQL RULES (§B.0): there is one local Supabase DB. Run probes with `deno task test:probes`. At most
2 SQL sessions at once, on disjoint migration files; announce each `deno task db:reset` to the other
sessions before you run it. Finish with your own clean `deno task test:probes:fresh`.

STEPS:
  1. Reproduce each: a test where the client shows a ticket as claimable and the SQL claim refuses
     it (a stage cap); a mixed-currency rollup; a balance that covers in the display currency but
     not in the charge currency.
  2. The read returns the ticket ids the viewer may claim now; the board and workspace DTOs carry
     claimable per card; claimableOf and HOLDING are deleted.
  3. The board DTO carries the server rollup; the client rollup is deleted.
  4. The quote carries walletCovers, computed by the funding service in the charge currency.
  5. The island offers Claim and the wallet method only when the flag says so, and the door still
     refuses on its own: the flag decides what to OFFER, the door decides what happens.
  6. No new Dev Context Switcher axis: the flags derive from state the switcher already simulates.
     If you add one, its full control set lands in the same change (root CLAUDE.md §5).

ACCEPTANCE: the probe shows the read and claim_ticket agree across a matrix of seat × Ready × cap
states; unit tests per flag; grep -rn "claimableOf\|walletBalanceMinor >=" apps packages → no hits;
`deno task test:probes:fresh` is clean.
```

### Q15 — Product constants from the server; the landing pins its literals

```text
PROMPT Q15: The wallet shows the release window the server applies; the landing pins its literals

ROLE: Full-stack engineer. Code only.

CONTEXT: pending_release_days = 7 is correct (#191), but it reaches no DTO, so every "7" in the
product UI is a literal (L-15). The dispute previews hard-code 47, 48 and 72 h windows, and the two
copies disagree (L-18). The landing demos restate the clearing window, the Fair Exit tiers and the
team split (L-19). Ruled: a runtime DTO for product constants (pendingReleaseDays); literals plus a
parity test on the landing (Decision #341, ruling E1 Q15; ADC Q15: A for product surfaces, B for
the landing, whose performance budget is #280's).

WAITS: WP2 merged (the wallet DTO; hot file live-wallet.ts); WP5a merged (evenSplit); F·UI3 and
F·UI4 merged (they edit wallet-home.ts and AnalyticsView.tsx).

FILES:
  - packages/types/finance/wallet.ts (pendingReleaseDays on the wallet DTO) + the wallet read
    (live-wallet.ts or WalletBackendService.home(); read security.platform_params once per request,
    or through WP10b's reference memo if its RLS check cleared the table)
  - apps/web/features/wallet/core/wallet-home.ts (:276, :390), apps/web/features/wallet/components/
    AnalyticsView.tsx (:249), and the other product literals (grep for "7 days", "seven days" and a
    bare 7 in wallet, payments and projects; the landing excluded)
  - apps/web/features/projects/core/dispute-view.ts (:167, :191-195) and
    apps/web/features/admin/core/dispute-desk.ts (:241-244): dispute_response_hours and
    dispute_review_hours (seeded in 00005001 :24-26) from the server
  - apps/web/features/landing/core/demos/{board-model.ts :109, :505-540; payments-model.ts :67,
    :96, :125-131; split-model.ts :110-160} + apps/web/features/landing/core/demos/
    constants.parity.test.ts (new)

STEPS:
  1. The wallet DTO carries pendingReleaseDays from platform_params; every product literal reads it.
  2. The dispute surfaces take the two windows from the server read they already make (add them to
     its DTO, Zod in the same change); the dev previews take them from the same place.
  3. The landing keeps its literals. The parity test parses
     supabase/migrations/00005001_seed_platform_params.sql for pending_release_days and asserts
     both CLEARS_IN_DAYS constants equal it; it asserts the demo tiers equal FairExitTier
     (packages/types/projects/settlement.ts :138) and the demo split equals evenSplit. When P·WP4
     changes Fair Exit (#338 P1), this test makes that session update the demo, as intended.

ACCEPTANCE: changing pending_release_days in a scratch copy of the seed fails the landing test
(verify, then revert); the wallet renders the DTO value (a test with 5 days); no product "7 days"
literal remains outside the landing.
```

---

## 6. Phase 4 — UI & design system

### WP4 — Keyboard-complete money paths

```text
PROMPT WP4: Every money-path choice is keyboard-complete through @projective/ui

ROLE: Frontend engineer (Preact + @projective/ui). Code + CSS.

CONTEXT: Money actions and choices are hand-built without a keyboard model. WalletHero's money
actions sit in a Popover role="menu" with no arrow keys, and a locked row shows a bare lock glyph,
so the reason is lost (U-02). Thirteen more menus are hand-built; the ticket menu exposes
role=dialog behind aria-haspopup="menu" (U-03). Escrow and payment choices are role="radio" buttons
with no roving tabindex (U-05). Seat steppers that drive the charged amount are raw type=number
inputs (U-06). ServiceModifier has its own document listeners and an in-tree listbox (U-07). The
site header has a document-level Escape listener (U-08). The search-scope listbox is copied into
two headers (U-09). role="tab" has no roving tabindex (U-13). The wallet display-currency
radiogroup has an <li> between group and radio (U-14). Segmented controls lack a keyboard model
(U-15). The revision and brief commit paths use raw textareas (U-16). Two comboboxes lack
aria-activedescendant, and one renders duplicate ids (U-10, U-11). SelectButton's status ring never
clears on focus (U-26). Audit SC-1, SC-2; quick-win and structural work needing no ruling.

WAITS: F·UI2, F·UI3 and F·UI5 merged (WalletHero, WalletTools, the dialogs and checkout). Not
while track M's N1 window is open on the three channel headers, nor while P·WP8/WP9 are open on
TicketView.tsx or StageInspector.tsx (git log on each file before you start it).

FILES (line numbers from the 2026-10-30 tree; re-find them):
  - SC-1, ActionMenu (@projective/ui/navigation; disabledReason, hint, danger, linkActionItems):
    apps/web/features/wallet/components/WalletHero.tsx (:270) first; then one shared slot for the
    three chan-menu copies in apps/web/features/projects/islands/ChannelHeader.island.tsx,
    apps/web/features/messaging/islands/ConversationHeader.island.tsx and
    apps/web/features/workspaces/islands/WorkspaceChannelHeader.island.tsx; then
    projects/components/MessageActions.tsx, calendar/components/EventPopoverActions.tsx,
    projects/components/composer/ComposerActions.tsx, projects/components/SidebarHeader.tsx,
    shell/islands/UserActions.island.tsx, view/components/lane-parts.tsx,
    projects/components/ticket/TicketView.tsx (TicketMenu), view/islands/ContactPopover.island.tsx
  - SC-2: SelectButton or RadioGroup for view/islands/ScopeBriefModal.island.tsx (:310),
    view/islands/SessionBookingModal.island.tsx (:308-318) and profile/components/hire/
    ConsultationModal.tsx (:407-418); NumberStepper for SessionBookingModal (:365) and
    profile/components/hire/ServiceDetailModal.tsx (:449); Select for
    projects/components/ServiceModifier.tsx (:28-42); one shared scope picker (Select + the
    registry search glyph) for marketing/islands/SiteHeader.island.tsx and
    shell/islands/NavSearchBar.island.tsx; MegaMenu for SiteHeader (:127-140); TabStrip for
    projects/components/ticket/StageInspector.tsx and view/islands/SessionSchedulerStage.island.tsx;
    CurrencySelect for wallet/components/WalletTools.tsx (:66, :342)
  - U-10 invites/components/UniversalInviteModal.tsx → AutoComplete freeText; U-11
    auth/components/TagSelect.tsx → TagCombobox; U-16 projects/components/SubmissionReviewModal.tsx
    (:501, :575) and ScopeBriefModal (:243) → Textarea + useFieldValidation
  - U-26 packages/ui/fields/styles/select-button.css (:139-149): status paint on the --fld-* border
    and fill, never a box-shadow + its DESIGN_SYSTEM.md §C.1 row
  - the feature sheets whose hand-built menu, radio and stepper CSS becomes dead (delete it)

STEPS:
  1. Before each migration, a keyboard test of the target behaviour (arrows, Home/End, Escape
     returns focus to the trigger, Tab leaves the group), using the package's existing test
     harness for that component.
  2. Migrate one surface at a time, keeping each control's behaviour and copy. A locked money
     action uses disabledReason, so the reason is read, not a bare glyph.
  3. The money segmented controls keep their description text (SelectButton option descriptions);
     the seat steppers keep min/max, and the charged amount updates exactly as before. Keep every
     control where the conversion lane puts it (§3.10).
  4. Delete the dead hand-built CSS. Press feedback stays transform: scale only.
  5. ContactList (G-4) and RoleToggle (G-6) wait on package gaps: leave them unless the gap exists.

ACCEPTANCE:
  - A Playwright keyboard pass over /wallet (the More actions menu), a /view service page (Fund
    Stage 1 vs the whole engagement; seats), the profile hire ConsultationModal and the site
    header: every choice reachable and operable by keyboard, Escape restores focus, axe-core shows
    zero serious issues.
  - No hand-built role="menu", role="radio" or type="number" remains in the files above.
  - Screenshots at 1440 and 390 of each migrated money surface; one filled button per region.
```

### WP7 — Every visible figure through `MoneyView`

```text
PROMPT WP7: Every visible figure renders through MoneyView, and a gate keeps it so

ROLE: Frontend engineer + tooling. Code + tests + docs.

CONTEXT: PolicyAmount splits the server's display string by hand, and the explore filters
hard-code "$" (L-11). 28 formatMoney( calls in 16 non-landing files print origin-currency strings
that never re-project (L-13). Buy Now (nine figures), FundStageDialog, the WalletDialogs review,
headline and done figures, and the line detail's "Original" render money without MoneyView (FDD
N10, #337; Part C row E2 settles it, so this prompt owns it). formatTicketMoney still formats with
"en-US" after QW-1 (board.ts :157-161). Ruled: MoneyView for every visible figure plus a lint ban on
formatMoney and Intl.NumberFormat; strings only in aria and sentences (Decision #341, ruling E2;
ADC Q16 A + C).

WAITS: F·UI5 and S·S5 merged (S5 fixes PlanBlock.tsx: leave it); F·UI2/UI3 merged
(WalletDialogs.tsx). Not beside WP4 or WP6, nor while P·WP6/WP8/WP9 are open on the ticket
components or ProjectBoard.island.tsx.

🧑 DECISION — STOP before step 4 and put this to me. The ticked E2 text says "strings only in aria
and sentences"; ADC Q16 option A, which the ⭐ points at, also allows "commit-button labels in the
charge currency". Options: (a) strict: a commit button that shows a figure renders MoneyView pinned
to the charge currency (no conversion), so the screen-share mask (DESIGN_SYSTEM §B.14) covers it;
(b) ADC A: a commit-button label may be a charge-currency string, marked in the gate.
Recommendation: (a). It satisfies both texts, and a string label escapes the screen-share mask.

FILES:
  - apps/web/features/workspaces/components/PolicyAmount.tsx (:38);
    apps/web/features/explore/core/filter-config.ts (:126, :173, :202, :219; the symbol comes from
    ctx.state.currency.displayCurrency)
  - the L-13 files (grep -rln "formatMoney(" apps/web; landing excluded), among them
    payments/core/stage-funding.ts (:48), projects/components/PaidRevisionPayDialog.tsx (:57),
    profile/components/hire/ConsultationModal.tsx (:329), profile/core/profile-model.ts (:380),
    wallet/components/WalletDialogs.tsx (:280, :676-711, :1193-1194), view/core/simulation.ts (:63)
  - N10: apps/web/features/checkout/islands/BuyNowModal.island.tsx (:380-618),
    apps/web/features/payments/components/FundStageDialog.tsx, the line detail
  - the formatTicketMoney callers: projects/components/ticket/{StageInspector,StagePipeline}.tsx,
    ticket/tabs/{TicketFinanceTab,TicketDetailsTab}.tsx,
    projects/core/{ticket-model,ticket-view}.ts, projects/islands/ProjectBoard.island.tsx; then
    packages/types/projects/board.ts (:157) keeps formatTicketMoney for aria only, or deletes it
  - WP5a's fxRateLabel and formatPercentBp, adopted in the wallet and checkout files
  - apps/web/utils/money-strings.gate.test.ts (new; the house *.gate.test.ts pattern)
  - DESIGN_SYSTEM.md: the money-string policy where MoneyView is specified, and its §C.1 row

STEPS:
  1. Inventory every formatMoney(, Intl.NumberFormat, formatTicketMoney( and hard-coded currency
     symbol in apps/web. Exempt: the landing and about pages (#277, #281, #301). A pinned business
     currency (#248) renders MoneyView pinned. Classify each hit: visible figure · aria · sentence ·
     not money (inspector numbers, metrics, the language preview).
  2. Visible figures → MoneyView from {minor, currency}, with its origin disclosure.
  3. Aria and sentence strings stay, each marked on its line or the line above:
     // money-string: aria|sentence|not-money — <why>.
  4. Commit buttons, per the ruling.
  5. The gate scans apps/web/**/*.{ts,tsx} (landing and marketing/about excluded) for formatMoney(,
     Intl.NumberFormat and formatTicketMoney(. A hit passes only with a money-string marker on the
     same or the preceding line. It prints file:line for each offence.

ACCEPTANCE:
  - The gate passes, and fails on a planted unmarked formatMoney( (verify, then revert).
  - With the display currency set to EUR on a GBP project, every board, ticket, wallet, checkout and
    Buy Now figure re-projects (screenshots at 1440 and 390, light and dark).
  - grep -rn '"\$"' apps/web/features/explore → no currency-symbol literal.
```

### WP8 — The card token contract, held by a stylesheet gate

```text
PROMPT WP8: The card token contract, held by a repo-wide stylesheet gate

ROLE: Design-system engineer (CSS + gate tests). CSS + tests + docs.

CONTEXT: Card has 0 consumers; of 17 card families, 9 set their own padding, radius or ratio
(U-21). The reviews summary is carded (U-22). Four undefined tokens shipped in 30 declarations with
no failing check (U-01, fixed by QW-2; nothing stops the next one). The tree carries hand-mixed
hover darkening, 42 border-radius: 50%, 31 literal box-shadow rings and 19 literal durations
(U-28). Ruled: a Card token contract plus a lint gate, not a migration (Decision #341, ruling E3
Q6; ADC Q6 B; SC-6, SC-11). DESIGN_SYSTEM §B.9.6 already states the contract; what is missing is
enforcement. SC-11 named `deno task lint`, but the repo has no CSS lint hook: its stylesheet gates
are *.gate.test.ts files built on apps/web/utils/css-gate.testing.ts and run by
`deno task test:unit`, and both run in `deno task test`, the merge gate. Follow the house pattern.

WAITS: F·UI1 merged (the wallet sheets, wlt-account). Re-read DESIGN_SYSTEM.md from main first.

FILES:
  - apps/web/utils/css-gate.testing.ts (the new gates as shared helpers)
  - apps/web/utils/design-tokens.gate.test.ts (new; repo-wide over packages/ui/**/*.css and
    apps/web/**/*.css) + apps/web/utils/design-tokens.baseline.json (new; the ratchet)
  - the drifting families: wsp-card (workspaces), proj-card (projects), ints-card / ints-row
    (files/styles/integrations-console.css), art-mediacard (articles), wlt-account (wallet: a
    1.586 ratio and --elevation-low at rest), ex-pcard__banner (explore, 16/7), and the other three
    the gate finds
  - apps/web/features/view/styles/view.css (:320, .vw-revagg) + view/islands/ReviewsPanel.island.tsx
    (:77)
  - DESIGN_SYSTEM.md §B.9.6 (the enforcement sentence; Card as the reference implementation) and
    Part E (the gate in the merge-gate summary)

STEPS:
  1. Gates, each reporting file:line:
     a. undefined custom property: every var(--x) resolves to a declaration somewhere: a `--x:` in
        any sheet, a key of the theme engine's scheme (buildScheme from @projective/ui/system, as
        business-hue.gate.test.ts uses it), or a property set from TS (setProperty("--x") or a
        styleVars key; scan the TS for them);
     b. a literal border-radius, transition or animation duration, or box-shadow (0 and none are
        not literals);
     c. a block whose selector contains "card" sets padding, border-radius or aspect-ratio only
        through --card-* tokens;
     d. color-mix(…var(--primary) or var(--accent)…, transparent) on a state selector (:hover,
        :active, :checked, [aria-selected], [aria-current], [data-active], .is-active). WP9 drives
        it to zero.
  2. The ratchet: the first run writes design-tokens.baseline.json (rule → file → count). The test
     fails when a count rises or a new file appears, and prints the lower figure to commit when a
     count falls. Rules (a) and (c) start at zero: fix every hit they find now.
  3. Retire the geometry literals in the nine families (--card-pad / -media / -tight,
     --card-radius / -media, --card-media-ratio / -square). wlt-account keeps its ratio only if the
     wallet exception (#122, #123, #124, #152) licenses it, as a --card-* token; otherwise it takes
     the standard ratio.
  4. Uncard the reviews summary: a section header and asymmetric spacing (--space-7 over
     --space-3).
  5. Sweep U-28's mechanical swaps where the gate shows them (border-radius: 50% → --radius-full;
     literal durations → --dur-*; hand-mixed 88% black hovers → the hover ramp tones). The rest
     stays in the baseline.
  6. DESIGN_SYSTEM §B.9.6: one sentence that design-tokens.gate.test.ts enforces the contract
     (Decision #341, ruling E3 Q6), that Card is the reference implementation, and that no family
     has to migrate to it. Part E lists the gate.

ACCEPTANCE:
  - The gate passes on the tree; planting var(--nope), a literal 12px radius in a card block, or a
    --primary wash on :hover fails it (verify each, then revert).
  - The rule (a) and rule (c) baselines are zero.
  - Screenshots of each re-tokenised card family at 1440 and 390, light and dark.
```

### WP9 — No brand washes, no boxed facts, no metadata pills, one device per split pane

```text
PROMPT WP9: No brand washes, no boxed facts, no metadata pills, one device per split pane

ROLE: Design-system engineer (CSS + components). CSS + TSX + docs.

CONTEXT: Static facts sit in tinted, bordered or translucent boxes, one of them inside an elevated
drawer, and 26 region backgrounds are translucent (U-23). Non-actionable metadata renders as pills
(U-24). A --primary brand wash marks selected rows, tabs and toggles in about 15 feature rules and
10 package components (U-25). A bare :focus paints a fill or border on pointer click (U-27). Split
panes carry a tint AND a hairline (.tkv__side, .evm__side), .subm-review__aside is translucent, and
§F.5's list is stale (ADC Q5). Ruled: no brand wash on any state fill, and the neutral --tint step
over a known parent (#330) is the sanctioned active fill everywhere (Decision #341, ruling E3 Q4);
a layout region inside an elevated panel carries one tonal step or one hairline, never a shadow and
never both, and the list is refreshed (ruling E3 Q5). Audit SC-7, SC-8.

WAITS: WP8 merged (the gate and its baseline); F·UI5 merged (the checkout sheets); P·WP9 and
C·WP10 merged, or not open on the TicketView, SubmissionReviewModal and EventModal sheets.
Re-read DESIGN_SYSTEM.md from main first.

FILES:
  - U-23: checkout/styles/checkout-payment.css (:119 .cko-contract, whose comment claims an
    exception DESIGN_SYSTEM does not grant; :1278; :1336), checkout/styles/checkout-body.css
    (:701), projects/styles/project-sidebar.css (:815, :1121, :1185), files/styles/
    upload-drawer.css (:213), catalogue/styles/offer.css (:291), and the rest of the 26 that WP8's
    gate lists
  - U-24 → MetaLine (@projective/ui/display): checkout/components/BasketRow.tsx (:218-219),
    BasketEngagement.tsx (:202), CheckoutLine.tsx (:370-371); explore/components/cards/
    ProjectCard.tsx (:83; a skill becomes a SkillPill link or meta text); files/islands/
    IntegrationsConsole.island.tsx (:342, :516); view/islands/ReviewsPanel.island.tsx (:240-252;
    trust badges become inline --primary text with a Tooltip, §B.11.4); projects/components/ticket/
    tabs/TicketFinanceTab.tsx (:98); projects/styles/chat-feed.css (:115)
  - U-25, feature: shell/styles/user-shell.css (:244, :1029), explore/styles/explore-home.css
    (:411), messaging/styles/contact-picker.css (:253), files/styles/files-hub.css (:254),
    view/styles/view.css (:422), projects/styles/{submission-review.css :249, projects-lane.css
    :577, channel-header.css :170, submission-rig.css :53}; package: packages/ui/display/styles/
    tree.css (:99, :103) and the selected states of listbox, menu, multiselect, cascadeselect,
    command palette, treetable, calendar month and mini, the money-flow popover and gantt
  - U-27: invites/styles/invite-modal.css (:272), inspector/styles/viewer-document.css (:135),
    packages/ui/navigation/styles/action-menu.css (:70), packages/ui/calendar/styles/
    availability-scheduler.css (:273)
  - the split panes: the .tkv__side, .evm__side and .subm-review__aside sheets
  - DESIGN_SYSTEM.md §B.4.2 (the two clauses), §B.9.2 / §B.9.3 (the split-pane carve-out), §F.5
    (marked resolved with its ruling, the list refreshed: attachment preview, ticket, submission
    review, EventModal, SettingsModalBody, AssetPicker; project-create removed), and the §C.1 row of
    every package component whose selected state changes

STEPS:
  1. State fills: every brand wash becomes the neutral --tint step over its known parent; where the
     parent is unknown, a solid --surface-2. Add a contrast gate (the business-hue.gate.test.ts
     pattern: parse the mix and compute it over buildScheme) asserting the selected row's text
     keeps at least 4.5:1 on the tinted fill over each parent it sits on, in light, dark and high
     contrast.
  2. Drive WP8's rule (d) baseline to 0.
  3. Region fills: solid ramp tones (--surface-1 / --surface-2). Static facts are unboxed (spacing
     and type registers). Nothing is boxed inside the upload drawer.
  4. Metadata pills → MetaLine. Containers stay only for controls, lifecycle statuses, required
     disclosures and counts.
  5. U-27: :focus → :focus-visible on those fills and borders. Add no ring (#245 (a) stands).
  6. Split panes: one device each, never a shadow (keep the tonal step and drop the hairline, or
     the reverse where the pane shares the panel's tone); .subm-review__aside takes a solid tone.
  7. The DESIGN_SYSTEM edits in FILES, each citing Decision #341, ruling E3 Q4 or Q5.

ACCEPTANCE: WP8's rule (d) count is 0, and its translucent-region count fell for every rule
touched; the contrast gate passes in all four mode and contrast states; screenshots of each touched
surface (checkout summary, project sidebar, the ticket and event modals, explore cards) at 1440 and
390 in light, dark and high contrast.
```

### WP16 — Delete `Overlay`; one `useAppModal()` for the ten app modals

```text
PROMPT WP16: Delete Overlay; one useAppModal() for the ten app modals

ROLE: Design-system engineer (Preact hooks). Code + docs.

CONTEXT: @projective/ui/overlay exports Overlay, which renders through Portal instead of BodyPortal
(failing §B.10.4) and has 0 consumers. The ten app modals each hand-assemble BodyPortal, Backdrop,
useFocusTrap, useDismiss and useOverlayStack (G-1). Ruled: delete Overlay and extract useAppModal()
(Decision #341, ruling E3 Q17; ADC Q17 B; SC-10).

WAITS: WP4 and WP9 merged (TicketView's menu; the split-pane sheets). P·WP8/WP9 (TicketView,
SubmissionReviewModal, PreSubmitModal, PreviewShell, ProjectCreateModal) and C·WP10 (EventModal)
merged, or not open on those files.

FILES:
  - packages/ui/overlay/islands/Overlay.tsx (delete) and packages/ui/overlay/mod.ts (:26-27)
  - packages/ui/overlay/hooks/useAppModal.ts (new, beside useBackdropPress.ts and
    useModalStack.ts) + a test. It composes packages/ui/hooks/{useFocusTrap,useDismiss,
    useOverlayStack}.ts and packages/ui/overlay/components/BodyPortal.tsx
  - the ten app modals: calendar/components/EventModal.tsx; files/islands/{AssetPicker,
    DriveBrowser,ShareDialog}.island.tsx; projects/components/{PreSubmitModal,ProjectCreateModal,
    SubmissionReviewModal}.tsx; projects/components/preview/PreviewShell.tsx;
    projects/components/ticket/TicketView.tsx; view/components/lightbox/LightboxDialog.tsx
  - DESIGN_SYSTEM.md §C.1, the @projective/ui/overlay row (:2478), and §B.10.1 (the app-modal hook
    tier)

STEPS:
  1. grep -rn "\bOverlay\b" apps packages for any consumer (expect none). Delete the island and its
     export. §C.1 records the removal: a breaking change to a copy-paste-portable package, with
     zero consumers.
  2. useAppModal({ open, onClose, initialFocus?, returnFocus?, label }), where open is a Signal,
     returns what the modals assemble today: the portal target, the backdrop props, the trap ref,
     the dismiss handlers and the stack entry. Exactly the six-hook assembly; no layout.
  3. Migrate the ten modals one at a time. Each keeps its own layout and CSS, and its behaviour is
     unchanged: Escape order through the overlay stack, scrim press through useBackdropPress, focus
     return.
  4. §C.1 and §B.10.1 in the same change.

ACCEPTANCE: no Overlay export or import remains; each modal opens, traps focus, closes on Escape
and on a scrim press, and returns focus (a Playwright pass over the ten, or each modal's existing
tests); a Dialog opened inside TicketView still closes innermost first.
```

---

## 7. Last — Docs

### Z1 — Track O docs sweep and the audit status column

```text
PROMPT Z1: Track O documentation sweep

ROLE: Documentation steward. Runs after every prompt above has merged.

FILES: architecture/PROJECTIVE_REDUNDANCY_AND_OPTIMIZATION_AUDIT.md (a Status column on every U-,
L-, D-, G-, QW-, SC- and DB- row: Fixed by <prompt> / Owned by <track and prompt> / Open),
architecture/ARCHITECTURAL_DECISIONS_AND_CLARIFICATIONS.md (each Q: ruled, and built by <prompt>),
the #341 decision row (each flag (a)-(q) Resolved with its ruling and prompt, or Open with an
owner), architecture/SYSTEM_ARCHITECTURE.md §Caching Strategy (no Not built yet marker left on a
built piece), design-system/DESIGN_SYSTEM.md (§B.4.2, §B.9.6, §B.10.1, §B.14, §C.1, §F.1, §F.5,
Part E), architecture/ROUTING.md (the /api/user/me row), database/{finance,projects,org}/
Functions.md.

STEPS:
  1. Rollup, not restatement (documentation/CLAUDE.md rule 2).
  2. §F.1: record that a keyboard-only focus ring is accepted in principle (Decision #341, ruling
     E3 Q3) and not built while the owner's design is pending; #245 (a) stands until then.
  3. List as Open, each with an owner: U-12, U-17, U-30 (no work package); G-2, G-3, G-5 (package
     proposals); G-4 and G-6 with U-15's ContactList and RoleToggle rows, if still blocked; and
     anything a prompt above deferred.

ACCEPTANCE: the audit's Status column has no blank cell; every #341 flag ends Resolved or Open with
an owner; grep -n "withCache\|Not built yet" documentation/architecture/SYSTEM_ARCHITECTURE.md
shows no withCache and no marker on a piece that is built.
```
