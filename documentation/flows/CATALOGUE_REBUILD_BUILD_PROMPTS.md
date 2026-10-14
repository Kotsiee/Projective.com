# Catalogue Rebuild — Build Prompts

> **Status: WORK ORDERS, not binding.** These are 18 self-contained prompts, numbered C0–C17, that
> build the plan in [`CATALOGUE_REBUILD.md`](CATALOGUE_REBUILD.md). Run them **in order**, each in a
> fresh session, and paste the standard header (§1) above every prompt. Section references such as
> "plan §5.2" point at the plan document. The prompts were written against `main` @ `2eafa14`
> (2026-10-14).
>
> **C0 is a gate.** It logs Decision #217 and stops for your rulings on flags **a–m**. Any later
> prompt whose flag you ruled differently must follow your ruling, not the text written here.

---

## 0. Run order

| # | Prompt | Depends on | Layer |
| :-- | :-- | :-- | :-- |
| C0 | Decision #217, docs scaffolding, rulings | — | docs |
| C1 | Catalogue Zod contracts (URL, archetype, media, offer, SEO, analytics, clients, batch) | C0 | types |
| C2 | Scheduling recurrence engine (RRULE, evaluator, describe, templates) | C0 | types |
| C3 | Catalogue, comms and search schema, in place | C1 | db |
| C4 | Scheduling presets, occurrences and gate branch, in place | C2, C3 | db |
| C5 | Analytics rollups, view events and the client-pipeline RPC | C3 | db |
| C6 | `CatalogueBackendService` extension + shared card adapter | C3 | backend |
| C7 | `ScheduleBackendService` presets, compile and horizon cron | C4 | backend |
| C8 | Analytics and clients services and routes | C5, C6 | backend |
| C9 | `@projective/ui`: `ShowcaseGrid`, charts, `MoneyInput`, `NumberStepper`, `DurationPicker`, `TagCombobox`; profile migration | C1 | ui |
| C10 | `@projective/ui/calendar`: `AvailabilityScheduler` compound | C2 | ui |
| C11 | Teardown + console (`/catalogue`): slots, views, grid, batch, quick-create | C6, C9 | web |
| C12 | Workspace shell + Edit part 1 (media, basics, SEO, inspector) | C11 | web |
| C13 | Edit part 2: archetype offers, pricing, intake, availability | C7, C10, C12 | web |
| C14 | Preview tab + `/catalogue/[id]/simulate` | C12 | web |
| C15 | Analytics views (console + item) | C8, C9, C12 | web |
| C16 | Client pipeline + `MiddleNavPanel` client drawer | C8, C12 | web |
| C17 | Dev Context Switcher axes, integration sweep, Playwright, retire leftovers | all | sweep |

C1 and C2 can run in parallel, as can C9 and C10. Everything else is sequential.

---

## 1. Standard header (paste above every prompt)

```text
You are working in the Projective monorepo (Deno 2.x, Fresh 2.x + Vite, Preact + @preact/signals,
Supabase Postgres with RLS, @projective/ui pure-CSS BEM). Before writing code:

1. Read root CLAUDE.md, documentation/reference/guardrails.md, documentation/reference/pr-checklist.md,
   documentation/flows/CATALOGUE_REBUILD.md (the plan; "plan §N" below means a section of it), and the
   Decision #217 row in documentation/reference/decisions/ (with the human's rulings). If a ruling
   contradicts this prompt, the ruling wins.
2. Grep documentation/reference/decisions/README.md for every surface you touch and read the matching
   decision file.
3. Work on the session's designated branch. Commit in small logical commits; push when done.

Non-negotiables (merge gates): migrations edited IN PLACE in their category file (never ALTER-on-top);
schema + Zod + documentation/database/* in the same change; islands never touch Supabase (fetch /api/*);
thin routes (parse + Zod + auth) over fat services returning ServiceResult<T>; path aliases only;
token-only CSS (var(--*); no hex/px radius/duration/shadow; media queries only at the literal --bp-*
values 480/768/1024/1280px, named in a comment), strict BEM,
no inline style=, no UI-lib deps; :focus-visible draws var(--focus-ring-shadow); press feedback is
transform: scale() only and removed under both reduced-motion channels; anti-card (no boxed static
content, no card-in-card, solid --bg → --surface-1 → --surface-2 regions); anti-tagification (meta is
inline --text-secondary middot text); headings < --fw-bold; tabular-nums on changing figures; JSDoc on
exports; // #region groupings; no meta-comments; nothing hard-deleted (Archived); every new
simulatable axis gets its Dev Context Switcher control; new/changed @projective/ui component updates
DESIGN_SYSTEM.md §C.1 in the same change. Never drop columns/FKs of escrows, wallets or stages.

Before you push: deno task check && deno task lint && deno task test:unit, plus deno fmt --check on
the files you touched (never `deno fmt` the whole tree). For DB prompts also run `deno task db:reset`
(permitted; tell concurrent sessions) and the probes you add. The four theme-engine.test.ts failures
are pre-existing (Decision #96(a)). If you hit a NEW contradiction between source docs, stop, add a
row to the newest decisions-*.md + the index, and ask.
```

---

## C0 — Decision #217, docs scaffolding, rulings

**Goal.** Log the plan's collisions so no later prompt has to pick a side silently. Write no code.

**Do:**
1. Append **Decision #217** as a row in the newest decision file (currently
   `documentation/reference/decisions/decisions-122-126.md`), using the same table format as #216,
   and add a matching line to `decisions/README.md`:
   - Status **PROPOSED (2026-10-14)**.
   - Title: "Catalogue rebuild — console views, item workspace tabs, 6-slot showcase, archetype
     forms, scheduling presets with RRULE recurrence, listing analytics and client pipeline".
   - Body: AMENDS #53 (deep analytics and availability), #56 (adds presets and occurrences above
     weekly bands) and #108 (§1.1 editor built).
   - FLAGS (a)–(m) copied from plan §2, each with its proposal.
2. Ask the human the following, one question per flag, giving the proposal as the recommended
   option. Use `AskUserQuestion` in batches of at most 4.
   - **a** (vocabulary)
   - **c / d** (presets and evaluator authority)
   - **e** (dropping URL media and the 6-slot cap)
   - **f** (10 tags)
   - **g** (`dm_threads.subject_listing_id`)
   - **h** (Standing Impact definition, or drop the tile)
   - **i** (licence enum, fulfilment scope)
   - **j** (simulation iframe)
   - **k** (privacy thresholds 5 and 20)
   - **b**, **l** and **m** are confirmations.
3. Record each answer in the #217 row, change the status to **RESOLVED (date)** or keep PROPOSED
   with the open flags named, and update plan §2 to match.
4. Add a "Catalogue rebuild — in progress" status block at the top of
   `documentation/flows/ServiceCreation.md` that links the plan. Do not restate the plan there.

**Done when:** #217 is logged and indexed, every flag has a recorded ruling (or is explicitly left
open with the prompt that will stop on it), and the plan reflects the rulings.

---

## C1 — Catalogue Zod contracts

**Goal.** Build every pure contract the catalogue rebuild consumes, so later prompts never invent
shapes.

**Read:** `packages/types/catalogue/catalogue.ts`, `packages/types/explore/{items,stored,view}.ts`,
`packages/types/services/intake.ts`, `packages/types/org/standing.ts` (`CreateCategory`),
`packages/types/slugs/slug.ts`, and `apps/web/features/view/core/entity-archetype.ts`.

**Create** under `packages/types/catalogue/`, all re-exported from `mod.ts`:

1. **`url.ts`**: exactly as plan §6.2.
   - `ConsoleUrlState` defaults: `view:"listings"`, `type:"all"`, `sort:"recent"`, `dir` from
     `defaultSortDir(sort)`, `search:""`, `period:"30d"`, `scope:"all"` and `createOpen:false`.
     `?create=1` sets `createOpen`; `?create=service:session` also seeds the kind and model.
   - `WorkspaceUrlState` defaults: `tab:"edit"`, `device:"desktop"` and `period:"30d"`.
   - `consoleHref` and `workspaceHref` emit params in a fixed canonical order and omit defaults.
   - `scopeRedirect(url)` returns `"/catalogue/<slug>?tab=analytics|clients"` when `scope` is a
     `svc-` or `prd-` slug (keeping `view` as the tab), and `null` otherwise.
   - `isListingSlug(id)` = `isSlug(id,"service") || isSlug(id,"product")`.
2. **`archetype.ts`**:
   - `FormArchetype`.
   - `formArchetypeOf(kind: CatalogueKind, serviceType: ServiceType | null): FormArchetype`:
     product → product; Pipeline → pipeline; One-Off and Direct Deliverable → one_off; Session →
     session; Group Session → cohort. A service with a null type → one_off.
   - `sectionsFor(archetype, serviceType): readonly EditSection[]`, per the plan §4.3 matrix.
   - `hasTeamRoles(serviceType)`.
   - Assert in a test that this mapping agrees with `resolveArchetype()` for every `ServiceType`.
3. **`media.ts`**: `ListingMediaSlotSchema`, `SHOWCASE_SLOTS = 6`, `MediaChoiceSchema`
   (`{ sourceAssetId: uuid, position 1–6, alt ≤200, crop? }`), `ApplyListingMediaSchema`,
   `ReorderListingMediaSchema` (`{ listingId, order: position[] }` as a permutation of the filled
   positions), and `coverOf(slots)`.
   - Refines: positions are unique; slot 1 is `kind === "image"`; there are at most 6 slots.
4. **`offer.ts`**: per plan §7.1.
   - `StartTrigger = z.enum(["on_project_start","after_previous","fixed_offset"])`, mapped to
     `public.start_trigger_type` by `stageTriggerToDb()`: `on_project_start` →
     `on_project_start`; `after_previous` and `fixed_offset` → `dependent_on_stage`, with
     `fixed_offset` carrying `lagDays`.
   - `ListingOfferSchema` is a `z.discriminatedUnion("archetype", …)` over the five offers. Direct
     Deliverable is `one_off` plus `teamRoles`.
   - `SESSION_DURATIONS = [15,30,45,60,90] as const`.
5. **`seo.ts`**: `ListingSeoSchema` and `serpSnippet()`.
   - Title fallback is `seoTitle || title`. Description fallback is `seoDescription ||` the first
     155 characters of `descriptionText`.
   - Truncate on a word boundary with `…`, and flag `truncated`.
   - URL is `projective.com › view › <slug>`.
6. **`analytics.ts`, `clients.ts` and `batch.ts`**: per plan §7.1.
   - `laneOf(e: ClientEngagement): ClientLane` is pure: any `actionReasons` → `action_required`;
     closed or archived engagement statuses → `closed`; inquiry, quote or discovery call with no
     order → `inquiries`; otherwise → `active`.
   - `RATE_MIN_DENOMINATOR = 20` and `KEYWORD_MIN_SESSIONS = 5` (flag k), plus
     `rateOrNull(n, d)`.
7. **Change `catalogue.ts`**:
   - `ListingDetail`:
     - `media` becomes `ListingMediaSlot[]`.
     - `availability` is replaced by `availabilityBinding: { mode: "default"|"preset"|"override";
       presetId: string|null; presetName: string }` (nullable for non-session archetypes).
     - Add `offer: ListingOffer`, `seo: ListingSeo`, `createCategory: CreateCategory | null` and
       `updatedAt` (already present: keep it).
   - `UpdateListingInput` mirrors these, minus `media` (moved to its own route), plus
     `expectedUpdatedAt: string`.
   - `CreateListingInput` gains `createCategory?` and `currency?`.
   - `publishReadiness` follows plan §7.1, with missing-reason strings that are short imperatives
     ("Add a cover image").
   - **Delete `ListingAvailabilitySchema`** and fix every importer. `deno task check` will list
     them; C3 and C6 own the backend side, so leave those call sites failing **only if** they are in
     files C3 or C6 rewrite, and note them in the commit message.

**Tests:**
- `packages/types/catalogue/url.test.ts`: totality fuzz (500 random query strings never throw);
  `parse(href(x))` deep-equals `x` for generated states; the canonical order; `scopeRedirect`.
- `archetype.test.ts`: the matrix and agreement with `resolveArchetype`.
- `media.test.ts`: refines.
- `seo.test.ts`: truncation, word boundary, fallbacks.
- `clients.test.ts`: `laneOf` table.
- Update `catalogue-model.test.ts` callers.

---

## C2 — Scheduling recurrence engine (pure)

**Goal.** Build the single, dependency-free availability evaluator (plan §5.2–§5.3).

**Read:** `packages/types/scheduling/{rows,owner-availability,ics,booking}.ts` and
`documentation/database/scheduling/Tables.md` §1 (bands never cross midnight).

**Create** under `packages/types/scheduling/`, exported from `mod.ts`:

1. **`civil.ts`**:
   - Tz-free civil date math: `IsoDate` brand + Zod, `addDays`, `addMonths` (clamped),
     `weekdayOf` (0 = Sunday), `daysInMonth`, `nthWeekdayOfMonth(y, m, wd, ordinal)` (−1 = last),
     `compareDates` and `eachDate(from, to)`.
   - `zonedSpan(date, startMinute, endMinute, tz): { startsAt, endsAt }` via `Intl.DateTimeFormat`
     offset probing, following the plan §5.2 step 5 DST rules.
2. **`rrule.ts`**:
   - `RRuleParts { freq, interval, byDay: {wd, ordinal?}[], byMonthDay: number[], byMonth: number[],
     bySetPos: number[], until?: IsoDate, wkst }`.
   - `parseRRule(s): { ok: true; value } | { ok: false; reason }`. It accepts an optional `RRULE:`
     prefix and refuses unsupported parts with a named reason.
   - `serialiseRRule(p)` emits a canonical part order (`FREQ;INTERVAL;BYMONTH;BYMONTHDAY;BYDAY;
     BYSETPOS;UNTIL;WKST`) and omits `INTERVAL=1` and `WKST=MO`.
   - `expandRRule(p, startsOn, range, cap = 2000): IsoDate[]` follows RFC 5545 semantics for the
     subset:
     - **WEEKLY**: weeks counted from the week containing `startsOn` (respecting WKST) modulo
       INTERVAL.
     - **MONTHLY**: BYMONTHDAY and BYDAY intersect when both are present; BYDAY with an ordinal
       selects the nth weekday; BYSETPOS filters the per-period set.
     - **YEARLY**: BYMONTH + BYMONTHDAY.
     - Never emits a date before `startsOn` or after `until`.
3. **`recurrence.ts`**:
   - The plan §5.2 schemas.
   - `draftToRRule(draft): string`. `unlessWeekdays` compiles to the BYDAY complement. It is
     refused for `weekly` (pointless) and for `once`.
   - `rruleToDraft(rrule, startsOn): RulePattern & condition | null`.
4. **`evaluate.ts`**:
   - `occursOn(rule, date)`, `layerBandsFor(preset, date, layer)` (steps 1–4),
     `evaluate(preset, { from, to }, blackouts?)` → `Occurrence[] { kind, startsAt, endsAt,
     ruleIds }` (steps 5–6), `explain(preset, date)` → `{ layer, contributed[], replacedBy?,
     removedBy[], blackout? }[]`, and `validate(preset)` → `Issue[]`.
   - Issue kinds: `call_outside_work`, `overlapping_bands`, `empty_next_30_days`, `rrule_invalid`,
     `replace_tie`.
   - Band algebra: `unionBands`, `subtractBands`, `intersectBands`, all on sorted, merged
     `[start, end)` minute intervals.
5. **`describe.ts`**: `describeRule(draft, locale = "en-GB")` and `describePreset`, using
   `Intl.DateTimeFormat` / `Intl.ListFormat`, with no hard-coded English month names.
6. **`templates.ts`**: `SCHEDULE_TEMPLATES` per plan §5.5, each a valid `AvailabilityPreset` minus
   its ids.
7. **`presets.ts`**: `SavePresetInputSchema`, `BindListingAvailabilitySchema` and
   `OccurrenceSpanSchema`.
8. **`ics.ts`**: add `toVAvailability(preset, range)` (plan §5.3 export).

**Tests:**
- **Golden** (`rrule.golden.test.ts`): 40 or more cases, each with a hand-computed expected date
  list. They must include:
  - bi-weekly with a WKST effect
  - `BYDAY=-1FR`
  - `BYMONTHDAY=31` skipping short months
  - `BYMONTHDAY=-1`
  - 29 Feb yearly
  - `BYSETPOS=-1`
  - the plan's "skip 12th unless Thu/Fri" checked over 24 months
- **Round-trip property tests** with a seeded PRNG generator (no new deps): `rruleToDraft ∘
  draftToRRule = id`, and `parse ∘ serialise = id`.
- **Evaluator:**
  - precedence (add, then replace, then subtract)
  - replace tie-break
  - subtract with no bands removes the day
  - call clipping
  - midnight-split bands
  - DST: Europe/London 2026-03-29 and 2026-10-25, America/New_York 2026-03-08, and
    Australia/Sydney 2026-04-05
- **Explain:** every case in the brief:
  - Mon 9–5
  - Wed 6–12 + 14–19
  - bi-weekly
  - monthly by date and by weekday
  - skip the 12th unless Thu/Fri
  - 21st 15–17 override
- **Templates:** `validate(template)` reports no errors.

---

## C3 — Catalogue, comms and search schema (in place)

**Goal.** Make the catalogue tables able to store what the workspace edits (plan §8, catalogue
rows).

**Read:** `supabase/migrations/{00000004,00000014,00000016,00000018,00000023,00000031,00001170,
00001175,00001300,00001400,00001890,00002020}*.sql`,
`documentation/database/{catalogue,marketplace,comms,search}/*` and
`packages/backend/services/catalogue/live-catalogue.ts`.

**Edit in place:**
1. **Enums** (`00000004`): `catalogue.product_licence`.
2. **`service_blueprints`** (`00000014`): `turnaround_days`, `meeting_provider` (CHECK the same set
   as `scheduling.events.meeting_provider`, NULL allowed) and `availability_preset_id uuid`. The FK
   is added in C4's file `00000031`, because the presets table is created there.
3. **`catalogue.listings`** (`00000023`): `seo_title varchar(70)`, `seo_description varchar(160)`
   and `create_category org.create_category`.
4. **`catalogue.listing_media`**: `position smallint CHECK (position BETWEEN 1 AND 6)`, `file_id
   NOT NULL`, **drop `url`**, `kind text NOT NULL DEFAULT 'image' CHECK (kind IN
   ('image','video'))`, `rendition_file_id → files.items`, `poster_file_id → files.items`, and
   `CHECK (position <> 1 OR kind = 'image')`. Keep `UNIQUE(listing_id, position) DEFERRABLE`.
5. **`catalogue.products.licence`** becomes `catalogue.product_licence NOT NULL DEFAULT 'personal'`.
6. **Drop the `catalogue.listing_availability` table**, along with its policies, indexes, docs rows
   and every reference in `save_listing`.
7. **`comms.dm_threads.subject_listing_id`** (flag g) with its CHECK. Make the opener in `00001300`
   take `p_subject_listing uuid DEFAULT NULL`.
8. **`search.interest_events.event_type`** CHECK adds `'view'`. `services_index` and
   `catalogue_index` add `tags text[]`, with fts rebuilt per plan §8. Add `trg_listing_tags_touch`
   (category 1 file `00001800`) so a tag change re-syncs the index row.
9. **`00001170` functions:**
   - `save_listing(p_listing, p_patch)` handles the plan §8 keys. `offer` is decoded per archetype
     onto blueprint or product columns; `stage_template` elements are validated for shape (name ≤80,
     deliverables ≤24, `startTrigger` ∈ set). `expected_updated_at` mismatch → `RAISE 'PC409'` with
     a stale DETAIL.
   - Tags are capped at 10 by a `BEFORE INSERT` count trigger on `listing_tags` (`PG422 tags_max`).
   - New `catalogue.apply_listing_media(p_listing uuid, p_slots jsonb)` (invoker, owner RLS):
     replaces the rows, validates that `file_id`s belong to the caller (`files.items.owner =
     auth.uid()` or a team they manage), and mirrors slot 1's `rendition_file_id ?? file_id` into
     `service_blueprints.cover_file_id`.
   - New `catalogue.set_listings_status(p_listings uuid[], p_status)`: loops `set_listing_status`
     in sub-blocks (`BEGIN … EXCEPTION`) and returns `jsonb[] {listing_id, ok, code, detail}`.
   - `set_listing_status`'s gate checks for a position-1 image.
   - New `catalogue.duplicate_listing(p_listing)`: copies everything, including media by file id
     and the subject row, and mints a new slug through the existing slug guard.
10. **`00001175`:** per-stage trigger mapping (plan §8).
11. **Grants** in `00002510` for the new functions. **Indexes** in `0000400x`.
12. **Seeds:** update the generator so seeded media are file-backed with at most 6 per listing, and
    seeded products' licences are valid. Run `deno task db:seed:generate` and commit the regenerated
    SQL.

**Zod:** update `packages/types/catalogue/*` to match, together with
`packages/types/explore/stored.ts` (`BlueprintStageSchema` + trigger fields with defaults
`after_previous`, 0, `true`) and `packages/types/messaging` (thread subject).

**Docs:** `documentation/database/{catalogue,marketplace,comms,search}/{Tables,Functions,Policies}.md`.

**Probes:** `supabase/probes/catalogue_rebuild.sql` (`BEGIN … ROLLBACK`, run as the authenticated
seller via `set_config('request.jwt.claims', …)`). It asserts:
- the media CHECKs (video in slot 1 refused, a 7th slot refused)
- the cover mirror
- the 11th tag refused
- PC409 on a stale `expected_updated_at`
- batch partial success (one listing gated, one published)
- duplicate
- a stranger cannot apply media to someone else's listing
- `subject_listing_id` refused on a `dm` thread
- the instantiation trigger mapping (a pipeline with 3 stages yields the right `start_trigger_type`
  and dependencies)

**Done when:** `deno task db:reset` applies, the probe passes, `deno task check` passes, or fails
only in `live-catalogue.ts` / `live-catalog.ts` lines that C6 owns, listed in the commit message.

---

## C4 — Scheduling presets, occurrences and gate branch (in place)

**Goal.** Store presets and rules, store compiled occurrences, and make the booking gate honour
them (plan §5.6, §8).

**Read:** `supabase/migrations/{00000022,00000031,00001510,00001520,00001860,00002015,00002510}*.sql`,
`documentation/database/scheduling/*`, and Decisions #56, #192, #208 and #211.

**Edit in place:**
1. **Enums:** `scheduling.rule_effect` and `scheduling.preset_scope`.
2. **Tables** (`00000022`): `availability_presets`, `recurrence_rules`, `recurrence_rule_bands` and
   `availability_occurrences`, exactly as plan §8, with `updated_at` triggers (`00001860`).
3. **FK** (`00000031`): `service_blueprints.availability_preset_id → availability_presets ON DELETE
   SET NULL`, plus a CHECK trigger that a bound preset belongs to the blueprint owner's schedule and,
   when `scope = 'service'`, to this blueprint.
4. **Functions** (`00001510`):
   - `scheduling.save_availability_preset(p_schedule uuid, p_preset jsonb) → uuid` (invoker,
     `fn_can_manage_schedule`). It upserts the preset, replaces rules and bands, and enforces the
     single default, at most 64 rules, at most 6 bands per rule, `rrule` length ≤ 400 and the
     `^FREQ=` prefix. It does **not** parse the RRULE: the TypeScript engine is authoritative,
     flag d.
   - `scheduling.archive_availability_preset(p_preset) → uuid[]`: sets `archived_at`, NULLs
     `availability_preset_id` on bound blueprints, and returns their ids. The default preset cannot
     be archived while it is the only one.
   - `scheduling.replace_preset_occurrences(p_preset, p_from timestamptz, p_to timestamptz, p_spans
     jsonb)`: SECURITY DEFINER, `REVOKE` from everyone except `service_role`. It deletes and
     inserts inside the window and stamps `compiled_from` / `compiled_through`.
   - `scheduling.fn_preset_for_blueprint(p_blueprint) → uuid`: the bound preset, else the owner
     schedule's default, else NULL.
   - `scheduling.fn_occurrence_covers(p_preset, p_kind, p_from, p_to) → boolean`.
   - **Gate:** `fn_band_covers` gains `p_blueprint uuid DEFAULT NULL`. When `fn_preset_for_blueprint`
     returns non-NULL **and** `compiled_through >= p_to::date`, use occurrences; otherwise use the
     existing weekday logic. Thread `p_blueprint` through `fn_book_session_slot` and
     `request_discovery_call`, which already carry a blueprint.
   - **Minors:** `save_availability_preset` refuses a caller classified as restricted, using the
     same predicate #208 uses for scheduling.
5. **Policies** (`00002015`): select and modify on presets, rules and bands through
   `fn_can_manage_schedule`; select on occurrences through `fn_can_view_schedule`; **no client
   write policy on occurrences**.
6. **Seeds:** one "General" library preset (`is_default`) per seeded freelancer schedule, built
   from `SCHEDULE_TEMPLATES` (generate the SQL from the TypeScript constant in the seed generator,
   never by hand-copying). Bind every seeded Session and Group Session blueprint.

**Zod:** the row schemas in `packages/types/scheduling/rows.ts` (`AvailabilityPresetRow`,
`RecurrenceRuleRow`, `RecurrenceRuleBandRow` and `AvailabilityOccurrenceRow`).

**Docs:** `documentation/database/scheduling/{Tables,Functions,Policies}.md`, including a new
"Presets & recurrence" section that explains the TypeScript-authoritative evaluator and the
horizon.

**Probe** `supabase/probes/scheduling_presets.sql`:
- the single default
- archive rebinding
- a stranger cannot read a private preset
- `replace_preset_occurrences` refused for `authenticated`
- the gate:
  - a slot inside an occurrence succeeds
  - a slot outside one is refused
  - a preset that is not yet compiled falls back to weekday bands
  - a minor is refused

---

## C5 — Analytics rollups, view events and the client-pipeline RPC

**Goal.** Make the analytics truthful: a writer for `daily_rollups`, recorded views, and a single
client-pipeline read.

**Read:** `supabase/migrations/{00000021,00001600,00001650,00002016,00005050}*.sql`, the
`ops.scheduled_jobs` seed, Decision #203, `search.interest_events`, `finance.orders` /
`order_lines` / `basket_items`, `projects.session_events` / `cohorts`, and the
`scheduling.event_reschedules` / `discovery_calls` / `marketplace.quote_requests` /
`finance.disputes` / paid-revision tables.

**Edit in place:**
1. **`analytics.fn_rollup_listings(p_day date)`**: SECURITY DEFINER, idempotent `INSERT … ON
   CONFLICT (day, metric, subject_kind, subject_id, dimensions) DO UPDATE`.
   - Metrics: `listing.impressions`, `listing.clicks`, `listing.views` (distinct session), and
     `listing.checkout_starts`.
   - `listing.orders`, and `listing.gross_minor` with `{currency}`.
   - `listing.bookings`, and `listing.booking_slot` with `{dow, hour}` in the **schedule owner's
     timezone**.
   - `listing.query_impressions` with `{q}`, written only when there are 5 or more distinct
     sessions.
   - `listing.cancellations`.
   - Map `interest_events.entity_id` (blueprint or product id) to `listing_id` through
     `catalogue.listings`.
2. **`analytics.fn_backfill_listing_rollups(p_from date, p_to date)`**: loops days. Service role
   only.
3. **`fn_subject_visible`**: verify `'listing'` resolves to the listing owner, or to members of the
   owner team with a manage role. Fix it in place if it does not.
4. **Job registration:** `analytics-listing-rollups` daily at 02:10 UTC, SQL command
   `SELECT analytics.fn_rollup_listings(current_date - 1)`, through the #203 registry seed and
   helper. Never call `cron.schedule` directly.
5. **`catalogue.get_client_pipeline(p_listing uuid DEFAULT NULL, p_limit int DEFAULT 200)`**:
   SECURITY INVOKER, so every arm is filtered by RLS. It returns
   `TABLE(engagement_kind, engagement_id, listing_id, buyer_user_id, buyer_handle, status, opened_at,
   last_activity_at, amount_minor, currency, next_event_at, action_reasons text[], href text)`. The
   arms are listed in plan §8. `href` is the canonical deep link (`/messages/…`, `/projects/prj-…`,
   `/calendar?event=…`) built only from slugs. **Do not invent statuses**: return the source
   table's own status, and let TypeScript `laneOf` derive the lane.
6. Index any arm whose `EXPLAIN` shows a sequential scan on seeded data.

**Zod:** `packages/types/analytics/events.ts` rollup metric names as `ListingRollupMetric`, and the
`ClientEngagement` row in C1's `clients.ts` aligned to the RPC columns.

**Docs:** `documentation/database/analytics/*` (documenting that **rollups are now written**),
`documentation/database/catalogue/Functions.md`, and `API_BACKLOG.md` (close the "daily_rollups
never queried" rows; quote their ids).

**Probe** `supabase/probes/listing_analytics.sql`:
- seed synthetic events, roll up, and assert counts
- idempotency (run twice, same counts)
- the k-anonymity drop at 4 sessions
- the owner reads rows and a stranger reads none
- `get_client_pipeline` returns one row per arm for a seeded seller and zero for a stranger

---

## C6 — `CatalogueBackendService` extension + shared card adapter

**Goal.** A fat catalogue service over the new schema, and structural preview fidelity (plan §4.6,
§9.1).

**Read:** `packages/backend/services/catalogue/*`,
`packages/backend/services/explore/{live-catalog,listing-source,ExploreBackendService}.ts`,
`packages/backend/services/profile/ProfileBackendService.ts#applyMedia`,
`packages/backend/services/media/*` and `apps/web/features/catalogue/core/catalogue-model.ts`.

**Do:**
1. **The adapter.** Extract the listing → card mapping into
   `packages/types/explore/listing-card.ts#listingCardItem(detail: ListingCardSource): ServiceItem |
   ProductItem`. Define `ListingCardSource` as the minimal structural input that both
   `live-catalog.ts` rows and `ListingDetail` can provide. Make `assemble()` call it. **Delete
   `buildPreviewItem`** and its tests (moved).
2. **Rendition cut.** Extract the shared showcase rendition cut from `ProfileBackendService.applyMedia`
   into `packages/backend/services/media/showcase-rendition.ts#cutShowcaseRendition(sourceFileId,
   crop, actor)`. The profile and the catalogue both call it.
3. **Extend `CatalogueBackendService`** with the plan §9.1 surface. `live-catalogue.ts`:
   - reads the new columns and maps `offer` per archetype;
   - `update` sends `expected_updated_at` and maps `PC409` to `fail(409, { message: "This listing
     changed in another tab.", details: { current } })`;
   - `applyMedia` runs `cutShowcaseRendition` per choice and then `catalogue.apply_listing_media`;
   - `batch` calls `catalogue.set_listings_status` and maps the per-row codes to `BatchOutcome`;
   - `duplicate` calls `catalogue.duplicate_listing`;
   - `previewView` builds `EntityView` through the same assembler `/view` uses, fed by an
     **owner-RLS** listing source (add `resolveListing(slug, { as: "owner", actor })` to
     `listing-source.ts`; draft and paused allowed only for the owner).
4. **Side effects:** keep `invalidateCatalog()` and `reembedInBackground` after every write. The
   embedding input text now includes tags and the SEO description.
5. **Fixtures:** update the `*_BACKEND_LIVE=false` fixture path and `packages/backend/mocks` to the
   new shapes.

**Tests** (`packages/backend/services/catalogue/*.test.ts`):
- **Card fidelity contract:** for every seeded fixture listing, `assemble(rows)` item deep-equals
  `listingCardItem(detail)`.
- `update` 409 mapping, using a stubbed client.
- `batch` outcome mapping.
- The `offer` round-trip (detail → update patch → detail) for each archetype.
- `previewView` refuses a non-owner (`404`, never revealing that the listing exists).
- **Route contract tests** for `/api/catalogue/{media,media/reorder,batch,duplicate}`: 401 when
  signed out, 422 for Zod failures with field paths, and age-gate refusal on a publishing batch.

---

## C7 — `ScheduleBackendService` presets, compile and horizon cron

**Goal.** The service layer for presets (plan §5.6, §9.2).

**Read:** `packages/backend/services/scheduling/*` (especially `live-owner-availability.ts`,
`slot-grid.ts` and `live-slots.ts`), `apps/web/routes/api/finance/cron/payouts.ts` (the cron bearer
pattern), and Decision #203.

**Do:**
1. **Methods on `ScheduleBackendService`:** `presets`, `savePreset`, `archivePreset`, `bindListing`,
   `compileOccurrences` and `extendHorizons`.
   - `savePreset` re-validates with `SavePresetInputSchema` and `validate()`. **Hard** issues
     (`rrule_invalid`) give 422; soft issues are returned in `data.issues`. It then calls the RPC and
     then compiles.
   - `compileOccurrences` runs `evaluate(preset, today → today + 120 d, blackouts)` and writes
     through `replace_preset_occurrences` with `getServiceClient()`.
   - **Mirror:** when the saved preset is the default, project its weekly interval-1 `add` rules to
     `OwnerBand[]` and call the existing `save_owner_availability` path. Return `mirrored: { full:
     boolean }` so the UI can explain any gap.
   - `bindListing` handles three modes. `default` sets the blueprint's preset to NULL. `preset`
     binds a library preset. `override` forks the current effective preset into a `scope='service'`
     copy (or updates the existing fork) and binds it.
2. **Slot reads:** `live-slots.ts` and `slot-grid.ts` read occurrences when the blueprint resolves a
   compiled preset, falling back to bands otherwise. This is the same rule as the SQL gate, so the
   grid never offers a slot the gate refuses. Add a test that pins the two together.
3. **Routes** (thin):
   - `apps/web/routes/api/scheduling/presets/index.ts` (GET, PUT)
   - `presets/archive.ts` (POST)
   - `apps/web/routes/api/catalogue/availability.ts` (POST → `bindListing`)
   - `apps/web/routes/api/scheduling/cron/horizon.ts` (POST, Vault bearer, `extendHorizons`)
   - Register the HTTP job `scheduling-availability-horizon` in the job registry seed.
4. **Minors:** every preset route calls the #208 restricted refusal first.

**Tests:**
- `savePreset` hard and soft issues.
- `compileOccurrences` writes the expected spans for the "VIP Intensive" template over a DST week.
- The mirror projection (full / partial).
- The `bindListing` override fork is idempotent.
- Slot grid against gate agreement over 200 generated presets × random slots, with a stubbed
  occurrence store.
- Route contract tests: 401, 422 and minor refusal; the cron route refuses without a bearer.

---

## C8 — Analytics and clients services and routes

**Goal.** Read models for the Analytics and Clients tabs and views (plan §4.7, §9.2).

**Do:**
1. **`CatalogueAnalyticsBackendService.overview(scope, period, actor, displayCurrency)`**:
   - Reads `analytics.daily_rollups` under the user JWT for the listings in scope. A
     `ConsoleScope` filter is resolved to listing ids through `catalogue.listings`.
   - Builds `CatalogueAnalytics`:
     - tiles: Gross Volume, Orders, Conversion, Standing Impact (flag h; omit the tile if it was
       ruled out);
     - an `AreaChart` series (daily gross; weekly buckets for `90d` and `12m`);
     - funnel steps;
     - the heatmap (sessions only);
     - keyword rows;
     - churn;
     - top listings (console only).
   - Applies `rateOrNull` thresholds and converts mixed currencies with `FxService`.
   - States the window honestly: `asOf` is the last rolled-up day, and today is excluded with a
     label.
2. **`CatalogueClientsBackendService`**:
   - `pipeline(scope)` calls `catalogue.get_client_pipeline`, maps rows to `ClientEngagement`,
     groups them by `laneOf`, sorts by `last_activity_at` descending, and puts action-required first
     by severity (`dispute_open` > `revision_requested` > `reschedule_open` > `handshake_pending` >
     `submission_pending` > `inquiry_unanswered`).
   - `client(handle, scope)` returns the buyer's public identity, all their engagements in scope,
     the DM thread id for the inline thread, and open reschedule rounds with their proposals (reuse
     `ScheduleBackendService` coordination reads).
3. **Routes:** `GET /api/catalogue/analytics`, `GET /api/catalogue/clients` and
   `GET /api/catalogue/clients/[handle]`. Validate `scope` and `period` with the C1 schemas, and
   check the handle against `ClientKey` (the `@` is stripped in the path).
4. **Fixtures:** when `CATALOGUE_BACKEND_LIVE=false`, return deterministic fixtures for each
   dev-axis state. C17 adds the axes; read the data attribute through the dev seam the same way the
   existing fixture paths do.

**Tests:** threshold behaviour; currency mixing; the scope filter; lane grouping and severity
order; `client()` refuses a handle with no engagement in scope (404); route contracts.

---

## C9 — `@projective/ui` primitives + profile migration

**Goal.** Shared primitives the workspace composes, each with a roster row.

**Read:** `packages/ui/CLAUDE.md`, `DESIGN_SYSTEM.md` Part B and §C.1, `packages/ui/fields/*`
(`InputText`, `SelectButton`, `MilestoneSlider`, `Chips`, `AutoComplete`), `packages/ui/dnd/*`,
`apps/web/features/profile/components/edit/MediaSection.tsx` with `profile-edit.css` ~330–460,
`apps/web/features/wallet/{core/chart-geometry.ts,components/FlowAreaChart.tsx}` and
`apps/web/features/workspaces/components/StatTile.tsx`.

**Build:**
1. **`packages/ui/display/islands/ShowcaseGrid.tsx`** with `display/styles/showcase-grid.css`:
   - Props and BEM per plan §4.4.
   - Keyboard reorder (Space lift, arrows, Space drop, Esc) with an `aria-live` region; pointer
     reorder through `@projective/ui/dnd`.
   - Refuses a video drop onto position 1 by calling `onReorder` only for legal moves and announcing
     the refusal.
   - Tokens:
     - `aspect-ratio: 16 / 10`
     - filled cells `--surface-1`
     - empty cells `--surface-2` with `1px dashed var(--outline-variant)`
     - `--radius-lg`
     - overlay `--scrim` on a `::before` underlay (no `backdrop-filter`: not a sanctioned case)
     - label `--text-xs` / `--text-secondary`
     - `gap: var(--space-3)`
     - modifier `.ui-showgrid--hero` at `@media (min-width: 1024px)` (`--bp-lg`)
2. **Migrate the profile.** Create `apps/web/features/files/components/showcase/ShowcaseSlots.tsx`,
   which wires `ShowcaseGrid` to `MediaCropPicker` and takes `{ requesterId, slots, onSave,
   onRemove, onReorder, coverLabel }`. `MediaSection` uses it. Delete the `pf-showgrid` CSS block
   and keep the `pf-edit__*` wrappers. The profile's behaviour must be unchanged: run the profile
   tests.
3. **Charts** in `packages/ui/display/charts/`: `geometry.ts` (moved from the wallet and
   generalised), `AreaChart.tsx`, `FunnelChart.tsx`, `HeatmapGrid.tsx`, `Sparkline.tsx` and
   `StatTile.tsx`, with CSS `charts.css` (block `ui-chart`) and a `ui-stat` block.
   - Use `d3-scale` / `d3-shape` only (they are already in `deno.json`). Use SVG; colours via
     `currentColor` and CSS custom properties.
   - Every chart: a `<figure role="group">` with a `<figcaption>`, a visually hidden data `<table>`,
     and a keyboard-focusable plot. ←/→ move the focused point and announce it through
     `aria-live`. Reduced motion means no tweening.
   - The heatmap ramp is `color-mix(in oklch, var(--primary) var(--tint-*), var(--surface-1))` over
     5 named steps, plus a `data-pattern` overlay when `[data-a11y-colorblind]` is set.
   - The wallet re-imports from `@projective/ui/display`; delete its private copy. Workspaces'
     `StatTile` migrates or re-exports, so there is one implementation.
4. **Fields:**
   - `MoneyInput` (`fields/islands/MoneyInput.tsx`): `value` / `onValueChange` in minor units,
     `currency`, `min`, `max`; formats on blur with `Intl.NumberFormat`; `inputmode="decimal"`;
     `aria-describedby` for the currency.
   - `NumberStepper` (`role="spinbutton"`, plan §4.5 keys).
   - `DurationPicker` (composes `SelectButton` + `NumberStepper`).
   - `TagCombobox` (ARIA 1.2 combobox: `aria-expanded`, `aria-activedescendant`, a listbox of
     suggestions from an injected `suggest(q): Promise<string[]>`, `max`, and an inline count
     "7 of 10" as `--text-secondary` meta, not a chip).
5. **Roster:** add rows for every component above to `DESIGN_SYSTEM.md` §C.1, and update §C.5 to say
   the SVG tier has shipped.

**Tests:** pure tests for the geometry and scale helpers; `ShowcaseGrid` reorder-legality tests
(pure `legalMove(slots, from, to)`); `MoneyInput` parse and format round-trip over locales en-GB,
de-DE and ja-JP; `TagCombobox` key handling as a pure reducer test.

---

## C10 — `AvailabilityScheduler` compound component

**Goal.** The isolated, accessible, direct-manipulation scheduler (plan §5.4), in
`packages/ui/calendar/islands/availability-scheduler/`.

**Read:** `packages/ui/calendar/*` (reuse its grid math, hour gutter and tokens),
`packages/ui/gantt/core/types.ts` (the adapter-injection precedent) and plan §5 in full.

**Build:**
1. **`types.ts`**: structural mirrors of `Preset`, `RuleDraft`, `Band`, `Occurrence`,
   `Explanation` and `Issue` (**no `@projective/types` import**), plus
   `SchedulerEngine { evaluate; explain; describe; validate; parseRRule; draftToRRule }`.
2. **`store.ts`**: `createSchedulerStore(initial, engine)` returning the plan §5.4 signals and
   actions:
   - `createBand(day, start, end)`, `moveBand`, `resizeBand`, `duplicateBand`, `deleteBand`
   - `upsertRule`, `deleteRule`, `setLayer`, `undo`, `redo`, `loadTemplate`
   - `commit()`, which emits `onChange`
   - A pure reducer `reduce(state, action)` underneath, so everything is unit-testable.
3. **Components:** `Root.tsx` (context provider; container-type `inline-size`), `PresetBar.tsx`,
   `Toolbar.tsx`, `WeekCanvas.tsx`, `MonthPreview.tsx`, `RuleList.tsx`, `RuleEditor.tsx`,
   `Issues.tsx`, `ShortcutSheet.tsx` and `index.ts`, which exports the compound
   `AvailabilityScheduler = Object.assign(Root, { PresetBar, … })`.
4. **BEM** (`calendar/styles/availability-scheduler.css`), block `ui-avsched`:
   - `__toolbar`, `__canvas`, `__gutter`, `__day`, `__slot`, `__band` (`--working`, `--call`,
     `--selected`, `--dragging`), `__band-handle` (`--start`, `--end`), `__continuation`
   - `__month`, `__date` (`--outside`, `--blackout`, `--today`), `__date-bar`
   - `__rules`, `__rule` (`--inactive`), `__editor`, `__issues`, `__issue` (`--error`, `--warn`)
   - Tokens:
     - working band: `--surface-3` with `1px solid var(--outline)`
     - call band: `color-mix(in oklch, var(--accent) var(--tint-soft), var(--surface-1))` with a
       45° hatch from `--outline`
     - subtract and blackout: crossed hatch
     - band radius `--radius-sm`
     - drag ghost: a block-local `--avsched-ghost-opacity` defined from an existing state-layer token
       (grep `packages/ui/system/core/theme-engine.ts` for the emitted state tokens; never a literal)
     - motion `--spring-snappy`, `none` under reduced motion
5. **Keyboard map, ARIA and announcements** exactly as plan §5.4. The shortcut sheet is a
   `Dialog`. `?` opens it, unless focus is in a text input.
6. **Usage in a dialog and on a full page:** add a gallery or demo entry wherever the UI package
   keeps its component demos, if it has one, showing both.

**Tests:** the reducer (create / move / resize / overnight split / duplicate / delete-last-band
removes the rule / undo / redo); keyboard-to-action mapping (pure `keyToAction(event, state)`);
announcement strings; and a structural check that every interactive element has an accessible name
(render with Preact's `render` into a DOM shim, which the repo already uses in UI tests: find and
reuse it).

---

## C11 — Teardown + console (`/catalogue`)

**Goal.** Replace the console with the plan §3.1 / §4.1 architecture, and keep the Quick-Init
create.

**Read:** every file in plan §1.3 marked C11, `apps/web/routes/(dashboard)/_layout.tsx`,
`apps/web/features/shell/{components/UserShell.tsx,islands/MiddleNavPanel.island.tsx,core/context-panel-state.ts}`,
the Projects Quick-Init files (`ProjectCreateModal`, `ProjectsLane`) and Decision #195.

**Do:**
1. **Controller.**
   - `features/catalogue/routes/console.tsx`: the handler calls `scopeRedirect(url)` and returns a
     303 if it yields a target. Otherwise it runs `parseConsoleUrl`, does the SSR read for the
     active view (listings page; analytics and clients are fetched client-side after first paint, to
     keep SSR light), and renders `<CatalogueConsole initial url={state} />`.
   - `routes/(dashboard)/catalogue/index.tsx` re-exports it.
2. **`console-store.ts`** per plan §6.4. URL sync uses `history.pushState` / `replaceState` plus a
   `popstate` listener.
3. **`CatalogueConsole.island.tsx`**: switches on `consoleUrl.view`. The listings view is
   `ListingsGrid` / `ListingsTable`, chosen by zoom (keep `view-state.ts`).
   - **Selection model:** a checkbox on the card (visible on hover or focus, always when a selection
     exists); Shift-click selects a range from `selectionAnchor`; Ctrl/Cmd-A selects all; Esc
     clears.
   - **Virtualisation:** the table's inline `style=` becomes custom properties set on a ref
     (`el.style.setProperty('--cat-vs-total', …)`), the only sanctioned dynamic-style path. The magic
     numbers (`GRID_GAP`, `CARD_BODY`) are read from computed tokens at mount.
   - The Analytics and Clients views mount placeholders that C15 and C16 replace.
4. **Lane** (`CatalogueLane.island.tsx`):
   - `LaneTabs` type; status sections (presence dots); model facet; **CREATE facet** (six
     categories, `?create=`); toggles; sort; quick-create footer menu (New product · New service ▸
     five models).
   - **Outline mode** on `/catalogue/[id]` lists the seller's listings with the current one pinned,
     plus an "On this page" section list (wired in C12).
5. **Header** (`CatalogueHeader.island.tsx`): title and count; search; `CatalogueRollups` (inline
   middot sentence, `tabular-nums`, deltas with an arrow glyph plus text); view `TabMenu` with
   `aria-controls` on the canvas.
6. **Footer** (`CatalogueFooterRig.island.tsx`):
   - Zoom and sort.
   - While `selection.size > 0`, the **BatchBar** takes over: "3 selected" meta, Publish (teal
     workflow commit), Pause, Archive (neutral outlined), Add to collection (`Popover`), Duplicate,
     Clear.
   - It calls `/api/catalogue/batch` and shows per-row failures in an `InlineNotice` listing the
     titles and reasons.
7. **Create modal.** Restyle; add CREATE category (`SelectButton`, 6 options + "Not yet") and
   currency (default `context.displayCurrency`). On success, navigate to
   `workspaceHref(slug, { tab: "edit", section: "media" })`. Opened by `?create=` deep links.
   **Do not add `routes/(dashboard)/catalogue/new.tsx`.**
8. **`[id]` guard.** Before any read, if `!isListingSlug(ctx.params.id)`, respond 303 to
   `/catalogue?create=1`.
9. **Styles.** Create `console.css`, `lane.css`, `listing-card.css` and `listing-table.css` per plan
   §4.8. Delete the corresponding regions of `catalogue.css`. Fix every audit item from plan §1.2
   items 11–14 in the files you touch.
10. **Retire** `CatalogueScreen.island.tsx`, `CatalogueViewControlRig.island.tsx` and
    `catalogue-state.ts`'s console half.

**Tests:**
- `console-store.test.ts`: selection reducer, range, URL sync as pure functions.
- `routes/catalogue-new.contract.test.ts`: no route file matching `catalogue/new` exists (walk
  `routes/`), and the `[id]` handler returns 303 → `/catalogue?create=1` for `"new"` without calling
  the service (spy).
- `scopeRedirect` wired into the handler (303).
- `deno task check` covers every route file.

---

## C12 — Workspace shell + Edit part 1

**Goal.** Build the `/catalogue/[id]` tabbed workspace and the first Edit sections: media, basics
and SEO, plus the inspector panel with the live card.

**Do:**
1. **Controller.** `features/catalogue/routes/workspace.tsx`: run the slug guard, read
   `CatalogueBackendService.detail`, apply `parseWorkspaceUrl`, render `<ListingWorkspace
   initial url />`. Keep the 303 for "not yours" and the 503 for unreadable.
2. **`workspace-store.ts`** per plan §6.4.
   - Save every 800 ms after the last edit, **section-scoped patches**, plus `expectedUpdatedAt`.
   - On `pagehide` and `visibilitychange: hidden`, flush via
     `navigator.sendBeacon('/api/catalogue/update', new Blob([json], { type: 'text/plain' }))`. The
     route accepts `text/plain` JSON.
   - A 409 conflict shows a `ConfirmDialog` with "Reload theirs" or "Overwrite with mine" (the
     latter re-sends with the server's `updatedAt`).
3. **`ListingWorkspace.island.tsx`**: tab router; `role="tabpanel"` with `aria-labelledby` the header
   tab.
4. **Header** (`ListingHeader.island.tsx`): back link (`consoleHref`); title (live from `draft`);
   lifecycle status chip (permitted container); save state as meta text ("Saved · 2s ago",
   "Saving…", "Couldn't save · Retry"); `TabMenu` (Edit · Preview · Analytics · Clients with the
   action-required count when > 0); below 1280, a "Card" button that opens the inspector in a
   `Drawer`.
5. **Footer** (`ListingActionRig.island.tsx`): a readiness sentence ("Add a cover image and a price
   to publish"); Archive / Pause (neutral outlined); Publish (teal workflow commit; disabled with
   the reason in `aria-describedby`).
6. **Panel.** Add `features/catalogue/core/catalogue-panel-slot.tsx#cataloguePanelFor` and register
   it in `_layout.tsx`'s panel ladder. `ListingInspector.island.tsx` renders:
   - `LiveCardPreview`: the real `ServiceCard` / `ProductCard` from `cardItem`, inside the
     explore CSS scope. Not interactive: `onSelect` is a no-op and links are `tabindex=-1` with
     `aria-hidden` on the card, plus a visually hidden description.
   - `ReadinessList`: `Icon('check')` / `Icon('circle')` rows, unboxed.
   - When `?client=` is present it renders `ClientDrawer` instead (C16).
7. **`EditCanvas`**: section stack with scroll-spy (`IntersectionObserver`) writing `?section=`
   (replace) and highlighting the lane outline. `?section=` on load scrolls to the section and
   focuses its heading.
8. **`MediaShowcaseSection`**: `ShowcaseSlots` with `requesterId="catalogue-media"`. `onSave` posts
   to `/api/catalogue/media`; reorder posts to `/api/catalogue/media/reorder`; alt text is edited
   in a small `Dialog` (≤ 200). The pending rendition state comes from the response.
9. **`BasicsSection`**:
   - Title (`InputText`, visible label = accessible name; no differing `aria-label`).
   - Description (`RichTextEditor`).
   - CREATE category (`SelectButton`).
   - Skills (`AutoComplete` over `org.skills` via the existing skills API).
   - Delivery model: draft only; otherwise text plus an explanation.
10. **`SeoSection`**:
    - `SerpPreview`.
    - Meta title (`InputText` with a live "54 / 70" meta count).
    - Meta description (`Textarea`, "142 / 160").
    - `TagCombobox` (max 10; `suggest` hits `/api/search/suggest-tags` if it exists; otherwise add a
      thin route over the existing search suggest service with `scope=tags`).
11. **Styles:** `workspace.css`, `edit-sections.css` and `seo.css`.
12. **Retire** `ListingEditor.island.tsx` and the rest of `catalogue.css`. The file must be gone
    by the end of this prompt.

**Tests:**
- `workspace-store.test.ts`: dirty diffing, section patch building, conflict state transitions,
  beacon payload.
- `serpSnippet` usage (already in C1).
- Panel slot resolver: returns the inspector on `tab=edit`, the client drawer on `client=`, and
  `null` on `tab=preview`.

---

## C13 — Edit part 2: archetype offers, pricing, intake, availability

**Goal.** The dynamic, archetype-aware form body (plan §4.3) and the scheduler integration.

**Do:**
1. **`edit/offer/*`**, chosen by `formArchetypeOf`:
   - **`ProductOffer`**:
     - Format (`Select` over `catalogue.product_format`).
     - Licence (`SelectButton`: Personal · Commercial · Extended), with an inline summary sentence
       per licence.
     - Attribution (`ToggleSwitch`).
     - `AttachmentList`: library files via `AssetPicker` (`accept` = any non-image kinds plus
       `zip`) and ZIP bundles. Format tags are derived from extensions as meta text, never chips.
   - **`OneOffOffer`**:
     - `MilestoneEditor`: a numbered `Timeline` of `BlueprintStage` rows with inline name and
       description, drag-reorder (`@projective/ui/dnd`) and "Add milestone"; at most 12.
     - `TurnaroundSlider` (`MilestoneSlider`).
     - `ScopeChecklist`: unboxed `Icon('check')` rows; Enter adds below; Backspace on an empty row
       removes it; drag-reorder; at most 24.
     - Free revisions (`NumberStepper` 0–99, with a "Not set" toggle for `null`).
     - Extra revision price (`MoneyInput`).
     - `TeamRolesEditor` when the model is Direct Deliverable.
   - **`PipelineOffer`**: `StageBlueprintEditor`.
     - Each stage row: name, description, deliverables (`ScopeChecklist`), price (`MoneyInput`,
       defaulting to the baseline `ticketPrice` and showing the 0.5×–2.0× range as meta), skills,
       start trigger (`SelectButton`: "When the project starts" · "After the previous stage" ·
       "N days after the previous stage" + `NumberStepper`) and Chain Reaction (`ToggleSwitch`,
       default on, #210 copy: "Fund on arrival").
     - Baseline ticket price at the top.
     - Roles via `TeamRolesEditor`.
     - A live `StageFlow` mini-preview, read-only, reusing the `/view` component.
   - **`SessionOffer`**:
     - Format (`SelectButton`: One-to-one · Cohort), which flips `delivery_model` between `session`
       and `group_session` (draft only).
     - `DurationPicker`.
     - Sessions per booking (`NumberStepper` 1–52).
     - Seats and continuous enrolment (cohort).
     - Conferencing provider (`Select` over the host's active conferencing connections from the
       existing integrations read; the first option is "My default (<fn_conferencing_provider
       label>)", which maps to `null`; empty state links to `/settings/integrations`).
2. **`PricingSection`**: archetype-aware `MoneyInput`s (`amount` / `ticketPrice` /
   `sessionPrice`), the `resolveListingPricing` display line as meta, and the currency fixed once
   published.
3. **`IntakeSection`**: an `IntakeBuilder` over `IntakeFieldSchema` (≤ 12, the nine kinds).
   - Reorder; per-kind option editor; validation via `intakeRefusal`'s inverse.
   - **Field ids are immutable once the listing has been published** (`ServiceCreation.md` §1.1):
     only labels and options are editable, and an explanation is shown.
4. **`AvailabilitySection`** (session and cohort only; hidden with an `InlineNotice` for restricted
   accounts, #208):
   - The binding line per plan §5.5.
   - "Edit availability" opens the scheduler **in a full-height `Dialog`** (the same component
     works inline; use the dialog here to keep the form scannable).
   - The app adapter `features/catalogue/core/scheduler-engine.ts` implements `SchedulerEngine`
     with `@projective/types/scheduling`.
   - Save goes to `PUT /api/scheduling/presets`, then `POST /api/catalogue/availability` for the
     binding.
   - The "next 14 days" summary is a `MonthPreview`-style strip, read-only, inline.
   - Shows `mirrored.full === false` as plain meta text with an explanation.
5. **Readiness:** publishing a session listing needs at least 1 window in the next 30 days, as an
   explicit readiness line.

**Tests:** per-archetype section rendering (`sectionsFor`); the patch built from each offer editor;
intake id-immutability enforcement (a pure guard); `scheduler-engine.ts` adapter conformance against
the `SchedulerEngine` type and one end-to-end evaluate.

---

## C14 — Preview tab + `/catalogue/[id]/simulate`

**Goal.** A 1:1 buyer simulation without leaving the workspace (plan §4.6 item 3; flag j).

**Read:** `apps/web/features/view/components/EntityViewPage.tsx`, `islands/EntityLane.island.tsx`,
`EntityBuyBar`, `BookingPanels`, `SessionSchedulerStage`, `QuoteRequestModal`, `core/booking-ssr.ts`,
`(dashboard)/projects/[projectSlug]/preview.tsx` (the precedent), the `chromeFor` handling in
`_layout.tsx`, and Decisions #78–#80 and #112.

**Do:**
1. **Route** `routes/(dashboard)/catalogue/[id]/simulate.tsx` → `features/catalogue/routes/simulate.tsx`:
   - Slug guard.
   - `CatalogueBackendService.previewView(slug, actor)` (owner only; otherwise 404).
   - `resolveEntityCommerce` in a simulation mode that resolves the real offer without the
     buyer-side "already booked / own listing" refusals.
   - Set `chrome: "bare"` (add a `"bare"` `ShellChrome` if none exists: no rails, no shell bands).
   - Render `<EntityViewPage … simulation />`.
   - Send `Content-Security-Policy: frame-ancestors 'self'` so only the workspace can frame it.
2. **`simulation` prop**, threaded through `EntityViewPage` → lane / buy bar / booking panels /
   scheduler stage / quote modal:
   - A top `InlineNotice` (info): "Preview · This is what buyers see. Nothing you do here books or
     charges."
   - Every commit button keeps its label and tier but, in simulation, resolves locally with a
     success state describing the would-be outcome ("A buyer would now pay $480 into escrow and
     land on Project setup") and **never** calls an API.
   - Add a test that, with `simulation`, no `fetch` to `/api/(basket|checkout|booking|services)`
     happens. Stub `fetch` and drive each CTA's handler.
3. **`PreviewCanvas`**:
   - Device `SelectButton` (Desktop · Mobile) → `?device=`.
   - An `<iframe title="Buyer preview of <title>">`. Desktop is 1280 px wide, scaled with
     `transform: scale(var(--cat-preview-scale))`, the scale set as a custom property from a
     `ResizeObserver`. Mobile is 390 × 844 inside a device frame drawn with tokens.
   - Reload when `saveState` goes from `saving` to `saved` (debounced 1.5 s), keeping the scroll
     position via `postMessage({ type: "pj:preview-scroll" })` between same-origin frames.
   - "Open in a new tab" link to the simulate URL.
4. **Styles:** `preview.css` (`cat-preview`).

**Tests:** the simulation no-network test above; the simulate handler returns 404 for a non-owner
and sets `frame-ancestors 'self'`; the scale computation is a pure function.

---

## C15 — Analytics views (console + item)

**Goal.** Dual-scope analytics (plan §4.7).

**Do:**
1. **`components/analytics/AnalyticsCanvas.tsx`** (shared), driven by `scope` and `period`:
   - Period `SelectButton` (7d · 30d · 90d · 12m) → `?period=`.
   - A `StatTile` row: Gross Volume, Orders, Conversion, Standing Impact (if ruled in). Each tile's
     delta is meta text; insufficient data reads "Not enough data yet" with the threshold explained
     in a `Tooltip`.
   - `AreaChart` "Revenue velocity".
   - `FunnelChart` "From impression to order".
   - `HeatmapGrid` "When buyers book": session and cohort archetypes, or any session listing in
     console scope.
   - Keyword `Table` "Searches you appeared in": query · impressions · CTR (`rateOrNull`).
   - Churn line.
   - Console only: a "Top listings" table linking to each listing's analytics tab.
   - An `asOf` caption: "Through 13 Oct · updated nightly".
2. **Fetch** `/api/catalogue/analytics` from the island. Use skeletons while loading, and an
   error state with Retry. **Never render zeros on a failed read.**
3. Wire the console `view=analytics` and the workspace `tab=analytics`.
4. **Header rollups** (C11) read the same service through `CataloguePage.stats`. Make sure their
   definitions match (same window, same thresholds); add a test.
5. **Styles:** `analytics.css` (`cat-an`). Regions are spacing-separated on `--bg`; the chart plot
   area is `--surface-1`; no boxed tiles.

**Tests:** pure view-model mapping (`toTiles`, `toFunnel`, heatmap normalisation); rollups ↔ tiles
definition agreement.

---

## C16 — Client pipeline + `MiddleNavPanel` client drawer

**Goal.** A grouped client hub with the contextual drawer (plan §3, §4.1, §9.2).

**Read:** `apps/web/features/messaging/*` (thread components, `ConversationContextPanel`),
`apps/web/features/projects/islands/ChannelHeader.island.tsx` (the panel ↔ `Drawer` pattern),
the scheduling coordination UI (reschedule proposal components), and
`shell/core/context-panel-state.ts`.

**Do:**
1. **`components/clients/ClientPipelineBoard.tsx`** (shared):
   - Four lane columns from `--bp-lg` (`min-width: 1024px`) up; stacked sections below.
   - Lane headers show a count, which is permitted.
   - Rows are unboxed list items: buyer avatar and name · engagement kind and listing title (in
     console scope) as middot meta · `last_activity` relative time · the action reason as a
     **lifecycle-status container** only when actionable.
   - Selecting a row sets `?client=@handle` (push).
   - Keyboard: roving tabindex within a lane; ←/→ between lanes.
   - Lanes are **read-only groupings**: no drag (§3.11), since lanes derive from source statuses.
2. **`islands/ClientDrawer.island.tsx`**: the `MiddleNavPanel` body at ≥1280, and a `<Drawer
   position="right" size="min(24rem, 100vw)">` below that, driven by `contextPanelDocked` /
   `contextDrawerOpen` exactly like `ConversationContextPanel`. It fetches
   `/api/catalogue/clients/[handle]?listing=`. Sections:
   - **Identity:** name, handle, and a link to the profile.
   - **Engagements:** each with its status and a deep link (`href` from the RPC) for heavy actions
     (open ticket, open submission review, open project).
   - **Conversation:** the existing messaging thread component, embedded, live through the same
     transport `/messages` uses, with composer. Inquiries use the `service_inquiry` thread.
   - **Scheduling:** open reschedule rounds with the existing propose / accept controls; the next
     session time.
   - **Close:** clears `?client=` (replace) and returns focus to the selected row.
3. **Panel slot:** `cataloguePanelFor` returns `ClientDrawer` when `?client=` is set, on console
   `view=clients` or workspace `tab=clients`.
4. **Contact path:** the `/view` Contact / inquiry opener passes `subject_listing_id` (C3's RPC
   parameter), so new inquiries appear in the listing's pipeline.
5. **Styles:** `clients.css` (`cat-cl`) and `client-drawer.css` (`cat-cdrawer`).

**Tests:** grouping and order (from C8, reused); the drawer resolver; focus return on close (a pure
focus-target helper); the inquiry opener passes the listing.

---

## C17 — Dev axes, integration sweep, Playwright, retire leftovers

**Goal.** Close every same-change obligation and prove the flow end to end.

**Do:**
1. **Dev Context Switcher** (`apps/web/features/devtools/`, `apps/web/utils/dev-seam.ts`): add
   `catalogueAnalytics`, `clientPipeline` and `availabilityConflict` (plan §10). Each needs:
   - the `DevOverrides` field + `DEV_DEFAULTS`;
   - a `DevOption` list;
   - a `DevContextPanel` control (in a "Catalogue" group);
   - `reflect()` setting **and** deleting `data-dev-catalogue-analytics`,
     `data-dev-client-pipeline` and `data-dev-availability-conflict`.

   Make the C8 fixtures and the C13 readiness and `Issues` read them.
2. **Docs sweep:**
   - `ROUTING.md`: routes plus the URL contract.
   - `PRODUCT_SPEC.md` sitemap.
   - `SYSTEM_ARCHITECTURE.md`: the services list and the job registry entries.
   - `flows/ServiceCreation.md`: mark §1.1 built, record the provider and availability bindings,
     remove the in-progress block.
   - `DESIGN_SYSTEM.md` §C.1: verify every new component has a row.
   - `PRODUCT_MANAGEMENT.md`: derived client lanes; presets archived, not deleted.
   - `database/*`: check against the migrations.
   - Decision #217: add a summary of the files changed, in the #216 format.
3. **Retire:**
   - `rg 'cat-(editor|media__|avail|create__legacy)|ListingEditor|buildPreviewItem|listing_availability|ListingAvailability|pf-showgrid'`
     must return only docs history.
   - Delete any glyph in `catalogue-glyphs.tsx` that `@projective/ui/icons` now covers.
4. **Playwright** smoke (`apps/web/tests/e2e/catalogue.spec.ts`, using the existing e2e setup and
   the seeded freelancer persona; use `/opt/pw-browsers/chromium` if the pinned version differs):
   1. `/catalogue` → New service ▸ Session → land on `?tab=edit&section=media`.
   2. Upload a still into slot 1 → the cover appears in the live card.
   3. Set title, price, duration and a preset → Publish enabled → Publish.
   4. Preview tab → iframe shows the session archetype with the lane; clicking Book shows the
      simulation outcome, with no network call.
   5. Analytics tab renders (fixture axis `rich`).
   6. Clients tab → select a client → drawer opens with the thread.
   7. `/catalogue/new` → 303 to `/catalogue?create=1`, and the modal is open.
   8. Keyboard-only run of step 3, checking that focus is visible (the screenshot diff asserts a
      ring).
5. **Full gate:** `deno task test`, `deno task build` and `deno task fmt:check` on touched files.
   Run every probe added in C3–C5 against a fresh `db:reset`.

**Done when:** the gate is green (apart from the four known theme-engine failures), the smoke test
passes, the docs agree with the code, and Decision #217 is marked RESOLVED with its file list.
