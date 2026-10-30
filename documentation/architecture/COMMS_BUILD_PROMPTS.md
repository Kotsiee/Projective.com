# Comms Build Prompts — Claude Code Work Orders for Messaging, Notifications & Discovery Search

> **Status: WORK ORDERS, not binding (Wave 1.2, 2026-10-30).** A sequenced series of self-contained
> Claude Code prompts for Wave 2 **track M** ([`FOUNDER_QUESTIONNAIRE.md`](FOUNDER_QUESTIONNAIRE.md)
> Part B §B.3): messaging, notifications and discovery search. Together they close the open findings
> of [`COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md`](COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md) (CAS `M*`,
> `N*`, `S*`, `D*`) under the owner's rulings on **Decision #339** (N1–N4 and the P3 rows). They
> also write RED WP12 and WP14 of
> [`PROJECTIVE_REDUNDANCY_AND_OPTIMIZATION_AUDIT.md`](PROJECTIVE_REDUNDANCY_AND_OPTIMIZATION_AUDIT.md)
> (`D-04`, `D-05`, `D-13`, `D-17`, `D-22`, `D-28`, `D-29`). Every prompt cites its evidence by
> finding ID and its ruling as `(Decision #NNN, ruling X)`. Paste each prompt into its **own fresh
> session**, after the standard header (§1).
>
> **Prompt IDs** are `MS*` (messaging), `NT*` (notifications) and `SR*` (search), so that they never
> read as the audit's `M*` / `N*` / `S*` findings or as the questionnaire's rulings N1–N4.
>
> **Wave 0, checked against git, not against the brief.** `48c1d1a5` (merged as `a158bc4a`) closed
> SEC L2, E6/G12, L4 (a)(c), L5, L6 and G9, and CAS M5 (`comms.fn_lock_dm_pair` plus
> `UNIQUE (thread_id, user_id)`), M10 (`comms.mark_dm_read`) and M24 (no fixtures behind the live
> gate). `supabase/probes/trust_p1_comms_search.sql` replays them. SEC E1–E5 and E7 were closed
> earlier (`supabase/probes/trust_p0.sql`), so CAS §2.5 step 1 ("close SEC E3/G1/G2 first") holds.
> RED WP3 is `92c7941f` (D-09, QW-8, QW-9), without cross-isolate invalidation. Everything below is
> still open in the tree at `94d22e84`.
>
> **A prompt marked 🧑 DECISION stops** and puts the named question to a human before it changes
> behaviour, with the options and a recommendation; §0 lists every stop. Migrations are **edited in
> place** (root `CLAUDE.md` §1), and every prompt names the category file it edits.
>
> **Roadmap note: end-to-end encrypted chat is Planned after MVP** (Decision #339, the P3 row on
> flag (j)). Nothing here builds it. The server reads messages by design, because the Tier 2 mask,
> previews, search and dispute evidence need the text, and Supabase encrypts the database at rest.
> Z1 marks SYSTEM_ARCHITECTURE's two end-to-end encryption passages Planned.

---

## 0. Run order & dependencies

| Phase                        | Prompts                     | Why this order                                                                                                                                                                                                                                  |
| :--------------------------- | :-------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — The N1 schema window** | MS1                         | One window lands the `cht-` thread ref, the inbox read model (RED WP12) and project-stamped DMs, as ruled (Decision #339, ruling N1). MS2–MS5 build on it, and so do the trust track's Tier 1 and P2 hardening.                                 |
| **2 — One door, then live**  | MS2 → MS3                   | MS2 makes the single send door and the `cht-` addresses. MS3's long-poll addresses a chat by those refs, and the door bumps its version keys (ruling N2).                                                                                       |
| **3 — Notifications**        | NT1 → NT2 → NT3 → NT4 → NT5 | CAS §2.5's order: fix the engine, then the dispatcher, then email, web push and SMS (ruling N3). NT2 and NT3 each stop for a 🧑 ruling first.                                                                                                   |
| **3b — Chat on the engine**  | MS4 → MS5                   | MS4 emits `message.*` into the fixed engine, with `cht-` links (⏳ MS1 and NT1). MS5 makes every chat control persist, mute first (ruling N3 (d)).                                                                                              |
| **4 — Search**               | SR1 → SR2; SR3; SR4         | SR1 restores recall (ruling N4) before anything adds signal (CAS §6.5). SR3 needs MS3's version keys and stops for its weight. SR4 waits for the projects track's efficiency measure and stops for its coefficients (Decision #338, ruling P4). |
| **Last**                     | Z1                          | Docs sweep, the end-to-end encryption roadmap marker and the CAS status column.                                                                                                                                                                 |

**The SQL lane.** Every prompt except MS2 and NT4 edits `supabase/migrations`. Each of them
therefore counts against Part B §B.0's cap of two SQL sessions on the one local DB, a cap shared
with every other track.

| Prompt | Migration files it edits (in place)                                                              |
| :----- | :----------------------------------------------------------------------------------------------- |
| MS1    | `00000016`, `00001001`, `00001300`, `00001840`, `00001890`, `00002510`, `00002520`, `00004006`   |
| MS3    | `00002600`                                                                                       |
| MS4    | `00001300`, `00001840`, `00005010`                                                               |
| MS5    | `00000016`, `00001300`, `00002510`                                                               |
| NT1    | `00001310`                                                                                       |
| NT2    | `00001310`, `00002510`, `00005001`, `00005060`, and `00004006` only if the claim's plan needs it |
| NT3    | `00001310`, `00002510`, `00005010`                                                               |
| NT5    | `00005010`                                                                                       |
| SR1    | `00001400`, `00002510`                                                                           |
| SR2    | `00005060`                                                                                       |
| SR3    | `00001400`, `00002510`, `00005050`                                                               |
| SR4    | `00005050`                                                                                       |

Recommended serial order inside the track: MS1 → NT1 → SR1 → MS3 → NT2 → MS4 → NT3 → MS5 → NT5 → SR2
→ SR3 → SR4. MS2 and NT4 run in the app lane as soon as their predecessor has merged. These pairs
have disjoint files and may share the two slots: MS1 ∥ NT1, SR1 ∥ MS3, NT2 ∥ MS4, NT5 ∥ SR2 and SR3
∥ NT5.

These cannot run in parallel because they edit the same files:

- MS1 / MS4 / MS5 (`00001300`, `00001840`; MS1 and MS5 also `00000016`)
- NT1 / NT2 / NT3 (`00001310`)
- MS4 / NT3 / NT5 (`00005010`)
- SR1 / SR3 (`00001400`) · SR3 / SR4 (`00005050`) · NT2 / SR2 (`00005060`) · MS1 / NT2 (`00004006`)
- any two of MS1, MS5, NT2, NT3, SR1 and SR3 (`00002510`)
- MS2 / MS3 / MS5 (`MessagingBackendService.ts`, `MessagingService.ts`, `ChatFeed.island.tsx`)
- NT2 / NT3 / NT4 / NT5 (`services/comms/dispatch-transports.ts`, `core/env.ts`, `.env.example`)
- NT3 / NT4 / NT5 / SR3 (`features/devtools` and `apps/web/utils/dev-seam.ts`)
- NT4 / NT5 (`NotificationsSection.tsx`)

**Cross-track file conflicts** (the §B.0 hot files first):

- **`00001300` (comms).** The trust track's P2 hardening (SEC L7 masking, L8 categories) never runs
  beside MS1, MS4 or MS5. MS5 closes L7's reaction half by construction, so the trust track's L7
  prompt skips `comms.message_reactions`.
- **`00005060` (jobs).** The Wave 1.3 jobs session merges first. NT2 and SR2 each own the file only
  while they run, and never beside another track's job-adding step (F·DB3, DB4, SV4; P·WP1, WP5; a C
  or T step that adds a job).
- **`00002510` (grants).** One writer at a time across all tracks. Here: MS1, MS5, NT2, NT3, SR1 and
  SR3.
- **`features/devtools` + `dev-seam.ts`.** NT3, NT4, NT5 and SR3 here; F·SV4, F·UI3, S·S4, S·S6 and
  I·F6 elsewhere.
- **`00005010` (the notification catalog).** It is not in §B.0, but several tracks add rows to it
  (C·WP3 notices, F·DB4's schedule-failure notice, P·WP1's claim-TTL notices). One writer at a time;
  here MS4, NT3 and NT5.
- **`MessagingBackendService.ts`, `conversations-ssr.ts`, `live-queries.ts`.** The optimisation
  track's request memo (RED D-06, D-23 / SC-9) never runs beside MS2, MS3 or MS5. That track also
  owns `packages/backend/core/cache.ts`; MS3 adds `cache-version.ts` and leaves `cache.ts` alone.
- **`00001400` and the `search` schema.** The identity track's erasure (SEC G16, CAS S17) and the
  trust track's search grants and policies (SEC G13–G15) never run beside SR1 or SR3.
- **`packages/backend/core/env.ts`, `.env.example` and SYSTEM_ARCHITECTURE's Environment Variable
  Contract.** NT2–NT5 and SR2 append keys, and so do other tracks: pull first, append only.
- **`AccountSection.tsx`** (NT3) may meet the identity track's MFA work (I3), and **`_app.tsx`**
  (NT4's manifest link) may meet shell work. Check `git status` first.
- **No prompt here edits the other §B.0 hot files:** `00001240` (finance money), `00001155`
  (sessions), `00001020` (workspaces), `00001060` (erasure), `stripe-webhook.ts` + `00001230`, and
  `live-wallet.ts` / `wallet-scope.ts`.

**Cross-track waits** (⏳ = waits for):

- The track starts after Wave 0's S-A3, which has merged (`a158bc4a`).
- NT2 ⏳ the Wave 1.3 jobs session. That session registers the comms queue worker, escalation,
  digests, sweep, reaper and compaction, which drive NT1's engine; NT1's last acceptance line needs
  them too.
- T·Tier 1 pre-filter ⏳ **MS2**. MS2 gives it one insertion point instead of two (SEC §2.3):
  `MessagingBackendService.sendMessage(actor, ref, input)`, between the authorisation and the
  insert.
- T·P2 hardening (`00001300`) ⏳ MS1, and never beside MS4 or MS5.
- O·RED WP3's invalidation half (D-14, the catalogue version bump) and O·RED WP13 (D-08, the chrome
  endpoint) ⏳ **MS3**'s `cache-version.ts`. This file builds neither.
- SR3 ⏳ MS3. SR4 ⏳ P·WP5 (the Reliability Index's efficiency measure; Decision #338, ruling P4).
- I·erasure (EPI §3.5 rule 8: delete `comms.device_tokens`, ask the email provider to delete the
  contact) ⏳ NT3 (a provider exists) and NT4 (tokens are written).
- C·WP3 and the session reminders call `comms.fn_enqueue` and use the jobs session's queue worker.
  Nothing here blocks them.

### Open decisions

| #    | Question                                                                                                                                                                                                                                                                                                                                                  | Stops                         | Recommendation                                                          |
| :--- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------- | :---------------------------------------------------------------------- |
| 🧑 1 | Where the notification dispatcher runs. SYSTEM_ARCHITECTURE.md:2531 names `dispatch-push` / `send-email` Edge Functions and EPI §8.1 one `comms-dispatch` Edge Function, while the owner chose "Fresh routes plus pg_cron `http` jobs" over Edge Functions for integration work (Decision #343, ruling C4 (a)). **A new contradiction, not logged here.** | NT2, at the entry point only  | A Fresh route, `POST /api/comms/dispatch`                               |
| 🧑 2 | The email provider (Decision #335 (f); not ruled)                                                                                                                                                                                                                                                                                                         | NT3, before any transport     | Resend                                                                  |
| 🧑 3 | The context-aware ranking weight. A ranking rule changes who earns, so it is a business rule                                                                                                                                                                                                                                                              | SR3, before any order changes | 0.25 on signed-in recommended orders, from 5 interest events in 90 days |
| 🧑 4 | The $W_i$ and Reliability Index coefficients (Decision #338, ruling P4)                                                                                                                                                                                                                                                                                   | SR4                           | Workload 1.50 (unchanged), efficiency 1.75, a newcomer at the median    |
| 🧑 5 | Owner gate, not a build stop: Voyage's written no-training terms before `EMBEDDINGS_ENABLED` (Decision #339 (d); #340, ruling T5)                                                                                                                                                                                                                         | Nothing in code               | Never switch it on in a committed file                                  |

No prompt here depends on Wave 1's other open items: whether `project_stages.create_category` is
stored as a label (#338 P4; ranking never reads it), Agency and Enterprise storage (#252 S2), the FX
margin (#337 M5), the Agency contract-rate fee (#252 against #187), or any ⚖️ item.

**Stale docs the prompts correct.** The rulings already decide these, so no new decision is needed:

- EPI §8.5 rule 7 (a bounce suppresses Marketing only) against ruling N3 (b) → NT3.
- SYSTEM_ARCHITECTURE.md:2499-2502 and `database/comms/Tables.md:19`, `:107` (comms stays in, or
  streams through, the Realtime publication) against ruling N2 → MS3.
- SYSTEM_ARCHITECTURE.md:685-686 and :2705-2706 (end-to-end encryption described as current) against
  the P3 row on flag (j), Planned after MVP → Z1.
- The `comms.fn_dispatch_notification` comment, "the cron worker re-drives pending deliveries".
  Nothing re-drives a delivery today: `fn_process_queue` drains `comms.notification_queue` only →
  NT2.
- The three `message.*` catalog templates (`/messages/{entity_id}`) build uuid links, which stop
  routing at MS2 (CAS N7) → MS4.

**Notes for the coordinator.**

- Part C maps Q0.2 (f) (delete `search.fn_search_entities` / `fn_search_global`) to the T and O
  tracks. The brief puts RED WP14 (D-29) here, so SR1 claims it. Dedupe at merge.
- `comms.dm_threads.slug` already holds the entity-channel name (Decision #306), and
  `security.fn_slug_guard` writes `NEW.slug`. Ruling N1's `cht-` slug therefore lives in a new
  column, `ref` (MS1).
- Readings applied, not stops: a spam complaint suppresses Marketing only (NT3), and a one-to-one
  conversation deleted for oneself returns with the next incoming message, while a group or an
  entity channel never does (MS5, which writes the rule into PRODUCT_SPEC).
- Not written here, because they are outside §B.3's track M row: CAS M11 (edit or delete one's own
  message, with a re-mask), M18 (voice-memo drift), M21 (Zod on the messaging GET routes), N4/N5
  (payload hygiene and legacy keys: #336 (e), #57 (a)), N7 beyond `message.*`, S21 (lexical
  relevance), S33 (`query_logs` retention is the jobs session's; SEC G13 is the trust track's), CAS
  §3 (F1–F33: files, streaming and the inspector) and D4 (the asset picker's `--fw-bold` title,
  `features/files/styles/asset-picker.css:115`, still open). Z1 lists each one as Open with no
  owner, unless another track's file claims it.

---

## 1. Standard header — paste above EVERY prompt

```text
You are working in the Projective monorepo (Deno 2.x; apps/web Fresh 2 + Vite + Preact islands
with @preact/signals; packages/ui the pure-CSS BEM design system @projective/ui; packages/types the
Zod SSOT @projective/types; packages/backend fat services @server/services/*; supabase/migrations
Postgres with RLS everywhere; Deno KV for cross-isolate caches; Voyage voyage-4 vectors in
pgvector).

Before writing code:
  1. Read the root CLAUDE.md and every sub-directory CLAUDE.md on the paths you touch (at least
     documentation/CLAUDE.md, packages/ui/CLAUDE.md, and documentation/database/CLAUDE.md when SQL
     changes), then documentation/reference/guardrails.md and
     documentation/reference/pr-checklist.md.
  2. Read documentation/architecture/COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md (CAS) and the finding
     IDs your prompt cites in SECURITY_MODERATION_AND_AI_GAPS.md (SEC),
     PROJECTIVE_REDUNDANCY_AND_OPTIMIZATION_AUDIT.md (RED), ARCHITECTURAL_DECISIONS_AND_
     CLARIFICATIONS.md (ADC Q7, Q8, Q11) and documentation/api/EXTERNAL_PROVIDERS_AND_
     INFRASTRUCTURE_SPECIFICATION.md (EPI §3, §5, §8).
  3. Read the OWNER RULINGS on Decision #339 in full (rulings N1–N4 and the P3 rows):
     grep -n '^| 339 |' documentation/reference/decisions/decisions-122-126.md. Then read the rows
     your prompt cites (#335, #338, #340, #341, #343), and grep documentation/reference/decisions/
     README.md for the surface you touch. At minimum also read #10, #88, #147, #148, #156, #173,
     #179, #180, #203, #204, #306 and #308.
  4. Read documentation/database/{comms,search}/{Tables,Functions,Policies}.md for the objects you
     change, and documentation/architecture/FOUNDER_QUESTIONNAIRE.md Part B §B.0 (hot files).

Hard rules (merge gates; reject your own diff if any of these fails):
  Messaging and notifications
  - comms.fn_notify never raises and never rolls back its caller: it runs inside escrow and stage
    RPCs. A handler may add a RAISE WARNING; it never re-raises.
  - No private-zone content reaches any SaaS (EPI §3.5 rule 2). A push carries a title, a
    same-origin deep link and a notification id; an email or SMS carries the title and the link.
    None of them ever carries a message body, a notification body or a payload (rule 4).
  - Mandatory catalog types ignore preferences and snooze; only overrides_quiet_hours types break
    quiet hours for push and SMS (Decision #339, ruling N3 (a)). A hard bounce blocks every
    category for that address; an unsubscribe blocks Marketing only (ruling N3 (b)).
  - Every inbound provider webhook follows EPI §3.3: a capped raw body, a timing-safe signature
    check with a 300 s tolerance, the comms.delivery_events (provider, provider_event_id) key
    claimed in the same transaction as the effect, 2xx for handled, replayed and ignored events,
    and ids only in logs.
  - Every machine-to-app entry point (the dispatch webhook, cron routes) checks its bearer in
    constant time and answers 404 otherwise (the apps/web/routes/api/finance/cron/* pattern).
  - A secret whose value is XXXX-XXXX or the wrong shape counts as absent (EPI §3.2). Committed
    files hold placeholders only; real keys live in .env.local, Vault or the host's secret store.
  - Islands never touch Supabase or @server/*, and there is no browser Realtime client: live
    updates come from server routes only (root CLAUDE.md §2; Decision #339, ruling N2).
  SSOT & architecture
  - Migrations are consolidated and EDITED IN PLACE (supabase/migrations/vvvvtooo_type_purpose.sql).
    Never append ALTER TABLE ADD COLUMN / ALTER TYPE ADD VALUE patches or a new "fix" file. Each
    statement goes in its category file: 0 enums/tables · 1 functions/triggers · 2 policies/grants
    · 3 views · 4 indexes · 5 seed (00005060 = scheduled jobs).
  - comms and search are deny-by-default for EXECUTE (00002510). Grant a new function explicitly,
    to the narrowest role, or not at all. A SECURITY DEFINER function pins search_path = '' and
    schema-qualifies everything.
  - A schema or RPC-contract change lands with its Zod schema (packages/types/{comms,messaging,
    explore,slugs}), the backend mapper and documentation/database/{comms,search}/* in the SAME
    change. Never drop a column, table or FK without asking me.
  - Thin routes: HTTP parse + Zod + auth guard ONLY. Logic lives in packages/backend/services/*
    and returns ServiceResult<T> (#10). Route slugs are prefixed and opaque; uuids do not route
    (#88).
  - Signal-first state; useEffect only for external APIs (fetch loops, visibility, push, audio).
  - Path aliases only; folders components/ islands/ styles/ hooks/ wrappers/ types/ core/; no src/.
  - JSDoc on exports; // #region [Name] … // #endregion; no meta-comments.
  UI (DESIGN_SYSTEM.md; root CLAUDE.md §3)
  - Token-only pure CSS + strict BEM; no inline style= except packages/ui styleVars().
  - A control that renders must do something (§3.11). A transport, toggle or action that cannot
    work yet is not rendered, or renders locked with its reason (LockedDialog). Never a dead switch.
  - Anti-tag: metadata is inline --text-secondary text; containers only for controls, lifecycle
    statuses, required disclosures and counts. Changing figures are tabular-nums.
  - Press feedback is transform: scale() only, removed under BOTH reduced-motion channels.
  - A new or changed @projective/ui component updates the DESIGN_SYSTEM.md §C.1 roster in the
    same change.
  Product
  - Business rules land in documentation/business/PRODUCT_SPEC.md, with concrete numbers in
    documentation/business/finance-model.md. A prompt that builds a rule marked **Not built yet**
    (Decision #NNN, ruling X) or **Planned** removes that marker in the same change.
  - A lifecycle or state change updates documentation/PRODUCT_MANAGEMENT.md in the same change. No
    bespoke statuses; nothing hard-deleted (archive, revoke, lifted_at).
  - A route or URL change updates documentation/architecture/ROUTING.md in the same change.
  - Every new simulatable axis gets its Dev Context Switcher control in the same change:
    DevOverrides + DEV_DEFAULTS, the DevOption list, the DevContextPanel control, and reflect() set
    AND delete (apps/web/features/devtools/core/dev-context.ts, apps/web/utils/dev-seam.ts). A dev
    cookie is honoured only under DENO_ENV=development (the pj.dev.embeddings pattern).
  - A NEW contradiction between source docs: do not pick a side. Add a decision row (the newest
    documentation/reference/decisions/decisions-*.md + a README index line; re-check the index for
    a number collision right before you write) and ask me.

SQL session rules (for every prompt that edits supabase/migrations):
  - There is ONE local Supabase DB. At most 2 SQL sessions run at once, on disjoint migration
    files. Announce every `deno task db:reset` to the other sessions before you run it.
  - Reproduce first: a probe under supabase/probes/ wrapped in BEGIN … ROLLBACK (or a Deno unit
    test). Run probes with `deno task test:probes`.
  - Finish with your own clean `deno task test:probes:fresh` (it resets, then runs every probe),
    with no other session resetting during that run.

Verification: `deno task check`, `deno task lint`, `deno task test:unit` (four theme-engine.test.ts
failures are pre-existing, Decision #96(a)), and `deno fmt` on the files you touched only, never a
directory. Docs are CRLF in the working tree: edit them with the editor tools, never sed, and judge
`deno fmt --check` on an LF copy. A packages/* edit needs a dev-server restart (no HMR). For a UI
prompt also run `deno task dev`, sign in as the seeded personas (documentation/database/Seed.md)
and capture 1440, 900 and 390 px screenshots in light, dark, data-contrast="high" and
data-motion="reduced".
Commit on the branch you were given with a clear message; do not push, and do not open a PR unless
I ask.
```

---

## 2. Messaging

### MS1 — The N1 schema window: `cht-` thread refs, the inbox read model, project-stamped DMs

```text
PROMPT MS1: The N1 schema window — cht- thread refs, the inbox read model, project-stamped DMs

ROLE: Postgres engineer (the comms schema). First in the track: MS2–MS5 and the trust track's
Tier 1 and P2 hardening build on it.

CONTEXT:
  - Ruling: one schema window for a cht- slug on comms.dm_threads, dm_messages.project_id written,
    the two message stores NOT merged, and the inbox read model: an inbox_tails RPC plus additive
    summary columns and a trigger (Decision #339, ruling N1; #341 (h) = ADC Q8; #218 (a)). CAS §6.1
    is the design.
  - Findings: CAS M1 (a project does not draw its DMs: services/projects/live-detail.ts:857, :992
    `dms: []`), CAS M4 (two addresses for one conversation, and a raw uuid route), RED D-04 (one
    dm_messages tail request per thread: services/messaging/live-queries.ts:545 → fetchThreadTail
    :873), RED D-05 (reading one thread runs the whole inbox fan-out: fetchConversation :901).
  - comms.dm_threads.slug ALREADY holds the entity-channel name (#306: `general`, `delivery-sync`),
    and security.fn_slug_guard (00001001:304) writes NEW.slug. The new address therefore lives in
    a new column, `ref`, named after CAS §6.1's ChatRef.ref.

FILES:
  - supabase/migrations/00000016_tables_comms.sql (comms.dm_threads: ref, last_message_at,
    last_message_id and their CHECKs)
  - supabase/migrations/00001001_functions_security_context.sql (a `ref` twin of fn_slug_guard,
    beside it) and supabase/migrations/00001890_triggers_slugs.sql (its trigger)
  - supabase/migrations/00001300_functions_comms_channels.sql (comms.inbox_tails; the summary
    trigger function; the project-stamp trigger function; get_or_create_dm_thread and
    send_request_message also return the ref)
  - supabase/migrations/00001840_triggers_comms.sql (the two new triggers)
  - supabase/migrations/00002510_permissions_function_grants.sql (inbox_tails),
    00002520_permissions_table_grants.sql (column grants for the new columns),
    00004006_indexes_comms.sql
  - packages/types/slugs/slug.ts + slug.contract.test.ts; packages/types/messaging/
    {conversations.ts, send.ts, mod.ts} (ref, lastMessageAt, lastMessageId, ChatRef)
  - supabase/probes/comms_thread_refs.sql (new)
  - documentation/database/comms/{Tables,Functions,Policies}.md

STEPS:
  1. The ref: comms.dm_threads.ref text NOT NULL, UNIQUE, with a CHECK on the slug shape of
     @projective/types/slugs and a new prefix (SLUG_PREFIXES gains `thread: "cht"`). A BEFORE
     INSERT OR UPDATE trigger always mints it on insert with security.mint_slug('cht') (a client can
     never choose its own address) and refuses any change on update: fn_slug_guard's contract on a
     column named ref, as one small security.fn_ref_guard() beside fn_slug_guard rather than a
     dynamic-column rewrite of the shared guard. The trigger goes in 00001890 with the other slug
     guards. slug.contract.test.ts assumes a `slug` column: give its table list a column field and
     add comms.dm_threads. Seeds need no change, because the trigger fills the column.
  2. The summary columns: last_message_at timestamptz and last_message_id uuid. There is no FK: the
     pointer is derived, and the reverse FK would be circular. An AFTER INSERT trigger on
     comms.dm_messages advances both only when (NEW.created_at, NEW.id) is newer than the stored
     pair, so seeds and out-of-order inserts never move them back. Guard both against client writes
     with security.fn_guard_derived_columns, as trg_dm_messages_derived does. The guard refuses
     only anon and authenticated, so the summary trigger function must be SECURITY DEFINER
     (search_path = '') or the guard would refuse the trigger's own update. Add no message_count:
     nothing reads it, and an empty thread is last_message_id IS NULL.
  3. comms.inbox_tails(p_thread_ids uuid[], p_k integer DEFAULT 1) RETURNS SETOF the preview row
     (thread_id, id, sender_user_id, body, has_attachments, is_audio, created_at). It is SECURITY
     INVOKER, so RLS on dm_messages is the guard and a non-participant gets nothing back. k = 1
     reads through last_message_id; k > 1 uses LATERAL (… ORDER BY created_at DESC, id DESC LIMIT
     p_k) over idx_dm_messages_thread_recent. Clamp p_k to 1..20 and the array to 200 ids. EXECUTE
     to authenticated only.
  4. project_id: a BEFORE INSERT trigger on comms.dm_messages, named so that it fires before
     trg_dm_messages_mask_pii (triggers fire in name order), sets NEW.project_id. It keeps a
     supplied id only when the sender and every other undeleted participant are parties to that
     project (the predicate comms.fn_dm_protected_project uses). Otherwise it derives the id with
     comms.fn_dm_protected_project(thread, sender, NULL), else leaves NULL. So a client can never
     stamp a DM onto a project it is not on. Do NOT edit the mask functions: the trust track owns
     SEC L7/L8 in this file.
  5. get_or_create_dm_thread and send_request_message also return the thread's ref (keep their
     current outputs and add the field), so MS2 never needs a second read to build an address.
  6. Indexes: the unique index on ref, and idx_dm_messages_project (project_id, thread_id) WHERE
     project_id IS NOT NULL for the project's DM group. Add nothing the EXPLAIN of the inbox read
     does not use.
  7. Zod: the thread and conversation schemas gain ref, lastMessageAt and lastMessageId. Add a
     ChatRef discriminated union to @projective/types/messaging: { kind: "thread", ref: cht-… } |
     { kind: "room", ref: stg-… | prj-…, channel: <the room key /api/projects/messages/send takes
     today> } (CAS §6.1). No service or route changes here; they are MS2's.

SAME CHANGE: migrations edited in place (root §1); the Zod schemas and
documentation/database/comms/* with the schema change. ROUTING.md moves with MS2.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each announcing its resets; finish with your own clean
`deno task test:probes:fresh`. Never beside MS4, MS5 or the trust track's 00001300 work.

ACCEPTANCE (comms_thread_refs.sql, BEGIN … ROLLBACK):
  - Every seeded dm_threads row has a ref matching the cht- shape; a client-supplied ref on insert
    is replaced; an UPDATE of ref → 23514.
  - After 3 messages are inserted out of order, last_message_id is the newest; a client UPDATE of
    last_message_at is refused.
  - inbox_tails as participant A returns A's threads only; as a non-participant it returns zero
    rows; with k = 3 it returns at most 3 rows per thread, newest first.
  - A DM between two parties of a protected project is stamped with it; a forged project_id from a
    non-party is replaced; a DM with no shared project stays NULL.
  - slug.contract.test.ts is green with the thread entity.
```

### MS2 — One send door, `cht-` addresses, and the project's DM group

```text
PROMPT MS2: One send door, cht- addresses, and the project's DM group

ROLE: Backend and routing engineer. Depends on MS1.

CONTEXT:
  - Ruling: one sendMessage(actor, ChatRef); /messages/dm-<handle> answers 303 to the pair's cht-
    thread; dm_messages.project_id is written so that the project draws the inbox's thread; the
    stores stay separate (Decision #339, ruling N1). Root CLAUDE.md §4 and #88: uuids do not route.
  - Findings: CAS M1; M3 (two doors: /api/messaging/messages/send → MessagingBackendService, and
    /api/projects/messages/send → ProjectBackendService.sendMessage :3163); M4; M23 (no send rate
    limit); M25 / D9 (a soft 404); RED D-04, D-05, and D-13 (the conversations cache key includes
    the params, so every page refetches the whole inbox: MessagingBackendService.ts:304).
  - The trust track's Tier 1 pre-filter plugs into the door this prompt makes (one insertion
    point, SEC §2.3). Keep the door's shape plain: parse → authorise → [Tier 1 goes here] → insert
    → bump and notify.

FILES:
  - packages/backend/services/messaging/{MessagingBackendService.ts, live-writes.ts,
    live-queries.ts, live-threads.ts, live-attachment-source.ts, live-workspace.ts} +
    MessagingBackendService.test.ts
  - packages/backend/services/projects/{ProjectBackendService.ts (sendMessage :3163 and the call at
    :1949), live-detail.ts (:857-862, :992)}
  - packages/types/messaging/{send.ts, conversations.ts} (the send input keyed by ChatRef)
  - apps/web/routes/api/messaging/messages/send.ts, apps/web/routes/api/projects/messages/send.ts
  - apps/web/routes/(dashboard)/messages/[conversationId]/{_layout,index,files,members}.tsx,
    apps/web/features/messaging/core/{conversations-ssr.ts, MessagingService.ts}
  - apps/web/features/projects/core/chat-context.ts (channelHref :34, conversationMessageHref) and
    the project route segment that resolves a channel ref
  - every builder of a /messages/ address (grep -rn "/messages/" apps packages --include=*.ts*)
  - documentation/architecture/ROUTING.md (the messages rows :151-152; "Conversations are
    addressed by their entry surface"; the messaging API table; the dm- note :941-943) and
    documentation/business/PRODUCT_SPEC.md (the markers at :1192-1193 and :3714)

STEPS:
  1. MessagingBackendService.sendMessage(actor, ref: ChatRef, input) is the ONE door. A thread ref
     writes comms.dm_messages; a room ref writes comms.project_messages through the code that
     ProjectBackendService.sendMessage runs today (move it, and keep its error handling and
     validation). ProjectBackendService.sendMessage becomes a one-line delegate, or is deleted with
     its callers re-pointed. Both send routes stay, because the composer and the project chat call
     them, and become thin wrappers over the one door.
  2. The send rate limit lives in the door (CAS M23): a per-sender SlidingWindowLimiter
     (packages/backend/core/rate-limit.ts) at 30 messages a minute, answering 429 with
     details.retryAt. A database throttle against direct PostgREST writes is SEC G6 and stays with
     the trust track.
  3. Addresses: /messages/cht-… is the only routed form. /messages/dm-<handle> answers 303 to the
     pair's cht- ref when the thread exists, and keeps today's virtual conversation when it does
     not (ROUTING:941-943); the first send creates the thread, and the island replaceStates to the
     cht- address. A uuid answers 404 with the existing calm not-found page and a real 404 status
     (CAS M25 / D9). Fixture mode keeps its own ids (dm-{handle}, ch-…).
  4. Every address builder emits cht- refs: conversationMessageHref, dmMessageHref
     (live-attachment-source.ts), the inbox rows, the saved list, links built in TS for
     notifications, ChatPopoutHost. No /messages/${uuid} is left. Entity channels (#306) are
     dm_threads too: the workspace channel chat (live-workspace.ts and its console island) sends
     with the channel's cht- ref, while its console URL keeps the channel's name slug.
  5. The project's Private Messages group (live-detail.ts `dms`) lists the viewer's dm_threads that
     hold a message stamped with this project (MS1's idx_dm_messages_project). Each row links to
     /projects/:projectSlug/cht-… through channelHref. The project route segment that resolves
     channel refs accepts a cht- ref when the viewer is a participant and the thread's other
     participants are parties to the project, and answers 404 otherwise. It renders the same
     thread as /messages does.
  6. The inbox read model: fetchConversations reads its previews through comms.inbox_tails in one
     round trip (D-04); fetchConversation reads one participant row, its roster and
     inbox_tails([thread]) (D-05). The read cache key drops the params: rows are cached once per
     tenant and the params are applied after (D-13), as ProjectBackendService.ts:1061 does.
  7. ROUTING: the two messages rows; the entry-surface table (a project DM is
     /projects/:projectSlug/cht-…); the send API rows (one door behind both routes); the dm- note
     (303, or the virtual conversation). PRODUCT_SPEC: remove the **Not built yet** at :1192-1193
     and "**Not built yet** for the `cht-` slug" at :3714.

SAME CHANGE: ROUTING.md with the URL change; the PRODUCT_SPEC markers; the Zod send input. There is
no schema change (MS1 made it).

ACCEPTANCE:
  - MessagingBackendService.test.ts: a thread send and a room send both go through
    sendMessage(ref); the 31st message in a minute is a 429; a non-participant's thread send is a
    404; a uuid conversation id is a 404; dm-<handle> with a thread answers 303 with Location
    /messages/cht-…, and with none, the virtual conversation.
  - A unit test asserts that the inbox read makes one inbox_tails call for N threads (no
    per-thread read), and that two inbox pages reuse one cached row set.
  - grep -rn 'messages/${' apps packages finds no uuid-built address.
  - In the browser (deno task dev, two seeded personas on one project): a DM sent from the
    project's Private Messages group appears under /messages, and back. Screenshots at 1440 and
    390.
```

### MS3 — Live updates: an ETag long-poll, KV version keys, comms out of Realtime

```text
PROMPT MS3: Live updates — an ETag long-poll, KV version keys, and comms out of Realtime

ROLE: Backend and island engineer. Depends on MS2 (the door bumps the keys; the poll addresses a
chat by its ref).

CONTEXT:
  - Ruling: an ETag long-poll first (SSE later); the five comms tables leave the Realtime
    publication; caches invalidate through KV version keys bumped by the writing service, with TTL
    as the backstop (Decision #339, ruling N2; #341 (g) = ADC Q7, option B).
  - Findings: CAS M6 (no message reaches an open client: ChatFeed appends only its own
    MESSAGE_SENT_EVENT); M7 (five comms tables sit in supabase_realtime with no subscriber:
    00002600); RED D-22 (invalidatePrefix reaches only the writer's tenant in one isolate); CAS D1
    (the "Chat sound" switch does nothing).
  - This also unblocks RED WP3's invalidation half (D-14: the catalogue's version bump across
    isolates) and RED WP13 (D-08: the chrome endpoint, invalidated on profile and preference
    writes). Build the primitive they will use; build neither of them (optimisation track).

FILES:
  - supabase/migrations/00002600_permissions_realtime_publication.sql (remove the five comms
    tables; the projects.* tables stay)
  - packages/backend/core/cache-version.ts (new) + cache-version.test.ts; packages/backend/core/
    kv.ts (read only; openSharedKv)
  - packages/backend/services/messaging/{MessagingBackendService.ts, live-queries.ts}
  - packages/types/messaging/* (the since response)
  - apps/web/routes/api/messaging/since.ts (new, thin)
  - apps/web/features/messaging/core/MessagingService.ts; apps/web/features/projects/islands/
    ChatFeed.island.tsx; apps/web/features/messaging/islands/MessagesSidebar.island.tsx; a chat
    sound under apps/web/static/ (≤ 10 KB) if none exists
  - supabase/probes/comms_realtime_publication.sql (new)
  - documentation: SYSTEM_ARCHITECTURE.md (§The Notification Engine :2499-2502; one paragraph on
    version keys in §Caching Strategy, which the optimisation track's SA rewrite keeps),
    database/comms/Tables.md (:19 and :107), ROUTING.md (the since route), PRODUCT_SPEC.md
    (:3881-3882, "no message reaches an open page live yet")

STEPS:
  1. Publication: delete the five `ALTER PUBLICATION supabase_realtime ADD TABLE comms.*` lines in
     place. The probe asserts that pg_publication_tables lists no comms table.
  2. cache-version.ts: bumpVersion(scope) and currentVersion(scope) over openSharedKv(), with keys
     ["cache","v",…scope]. currentVersion is memoised per isolate for at most 1 s. With no KV, both
     are no-ops that answer null, and callers fall back to their TTL. The version rides in the
     ArcCache key (cacheKey(tenant, ns, { …params, v })), so core/cache.ts is NOT edited (the
     optimisation track owns it). The scopes now: ["messaging", userId] and ["thread", ref] (a
     room's scope is its channel id). Export the scope type, so the catalogue and chrome scopes can
     join it later.
  3. The door bumps after the insert commits: the thread or room scope, and the messaging scope of
     every participant (the writer knows them). The inbox and conversation reads key their cache
     with the viewer's messaging version, so a recipient's next read misses (D-22). Writes made
     outside the door (comms.tg_dm_auto_reply, SQL, cron) are covered by the TTL backstop and by
     step 4's re-read.
  4. GET /api/messaging/since?ref=…[&channel=…], with If-None-Match = the newest message id the
     client holds. The service reads the newest id (dm_threads.last_message_id; for a room, one
     indexed read). If it differs, the answer is 200 with the newer messages (at most 50, keyset
     after the client's anchor through the existing cursor resolution, and truncated: true past
     50) and the new ETag. If it is equal, the request waits up to 25 s on kv.watch of the chat's
     scope, re-reads once on wake or timeout, then answers 200 or 304. With no KV, it answers at
     once with Retry-After: 5. Cache-Control: no-store; 401 for a guest; 404 for a conversation the
     viewer cannot read. The message-id cursor stays, because the code's own comment
     (live-queries.ts:216-230) explains the microsecond precision it protects; RED D-27 is not
     adopted.
  5. ChatFeed island: while the tab is visible, loop MessagingService.since(ref, etag), with one
     request in flight, an AbortController on hide, exponential back-off to 60 s on errors and
     Retry-After honoured. Append unseen messages by id; the sender's own optimistic message is
     deduped. Play the chat sound when the Messaging setting `sound` is on, the message is someone
     else's and the tab is visible (D1's sound half). The inbox lane re-reads with If-None-Match on
     the viewer's messaging version every 30 s while visible (a 304 when nothing moved), and at
     once when the open conversation's poll returns a message.
  6. Docs: SA's Realtime sentence becomes "comms is not in the Realtime publication (Decision #339,
     ruling N2); live chat is an ETag long-poll; an SSE stream is Planned". The version-key
     paragraph joins SA §Caching Strategy. PRODUCT_SPEC:3881-3882 says that messages reach an open
     page through the poll.

SAME CHANGE: ROUTING.md (the new endpoint); database/comms docs; SYSTEM_ARCHITECTURE; PRODUCT_SPEC.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each announcing its resets; finish with your own clean
`deno task test:probes:fresh`.

ACCEPTANCE:
  - comms_realtime_publication.sql: no comms table in supabase_realtime; the projects tables are
    unchanged.
  - cache-version.test.ts: after a bump, currentVersion changes within 1 s; with no KV it answers
    null and never throws.
  - A route test (with a short hold): a matching If-None-Match and no write → 304 after the hold; a
    bump during the hold → 200 with the new message; a non-participant → 404.
  - Two browsers (two seeded personas; deno task dev with --unstable-kv): a message sent in one
    appears in the other within 2 s, without a reload; with KV off, within 6 s. Two timestamped
    screenshots.
```

### MS4 — Message notifications: `message.new` and `message.mention`; muted threads stay quiet

```text
PROMPT MS4: Message notifications — message.new and message.mention, and muted threads stay quiet

ROLE: Postgres and backend engineer. Depends on MS1 (the cht- refs) and NT1 (the fixed engine).

CONTEXT:
  - Findings: CAS §2.1 (the message.* types have 0 callers); CAS N7 (the catalog templates build
    uuid links: the message.* rows use /messages/{entity_id}, 00005010:65-67); CAS D1 (the New
    messages, Mentions and Group activity switches do nothing); Decision #308 flag (b) (nothing
    reads is_muted).
  - Rulings: a muted chat stays muted on every device (Decision #339, ruling N3 (d)), so a muted
    thread sends no message notice; the mandatory and quiet-hours rules come from the engine
    (ruling N3 (a)); a payload carries no message text (EPI §3.5 rule 4).
  - The switches already persist. newMessage and mentions are notification_type_mutes rows
    (message.new, message.mention); group activity and service inquiries are the messages category
    layer (services/messaging/live-settings-write.ts:40-62). Emitting the types is enough for the
    router to honour them, so no settings code changes.

FILES:
  - supabase/migrations/00001300_functions_comms_channels.sql (comms.tg_notify_message())
  - supabase/migrations/00001840_triggers_comms.sql (AFTER INSERT on comms.dm_messages and
    comms.project_messages)
  - supabase/migrations/00005010_seed_notification_catalog.sql (the message.* rows'
    action_url_template → NULL; group_window kept)
  - packages/types/comms/catalog.ts + catalog.contract.test.ts
  - supabase/probes/message_notifications.sql (new)
  - documentation/database/comms/{Functions,Tables}.md; PRODUCT_SPEC.md §Notifications only if a
    stated rule changes

STEPS:
  1. comms.tg_notify_message() (AFTER INSERT, SECURITY DEFINER, search_path = ''). The recipients
     are the thread's undeleted participants, or the room's readers, minus the sender, minus anyone
     whose participant row is muted (rooms have no mute). comms.has_channel_access and
     comms.can_access_scope judge the CURRENT user only, so add a set-returning twin,
     comms.fn_channel_reader_ids(p_channel uuid), that applies the same rules to every project
     participant (no client grant), and pin the two together in the probe. The trigger never
     raises: an outer handler does RAISE WARNING and returns.
  2. message.new goes to every recipient, collapsed per conversation (group_key 'chat:' || the ref,
     with the catalog's 5-minute window). Title "New message from <display name>", body NULL, and
     an explicit p_action_url: '/messages/' || ref for a thread, or the room's chat address under
     /projects/… built from the project and stage slugs. An auto-reply notifies like any message.
  3. message.mention goes to each recipient whose @handle appears in NEW.body as a whole token
     (match only the recipients' org.users_public handles, case-insensitively), with the same link
     and group_key 'mention:' || the message id. A mentioned recipient gets the mention instead of
     the new-message notice for that message.
  4. The first message of a service_inquiry thread to its seller uses an existing inquiry type if
     the catalog has one, and message.new otherwise. Do not add a type for it here.
  5. 00005010: the three message.* rows get action_url_template = NULL, because the emitter always
     passes the link. catalog.contract.test.ts stays green.

SAME CHANGE: migrations edited in place; database/comms docs; the catalog contract test.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each announcing its resets; finish with your own clean
`deno task test:probes:fresh`. Never beside MS1, MS5, NT3, NT5 or the trust track's 00001300 work.

ACCEPTANCE (message_notifications.sql, BEGIN … ROLLBACK):
  - A DM from A to B → one message.new for B, with action_url /messages/cht-… and a NULL body;
    none for A.
  - B mutes the thread (comms.set_dm_muted) → the next message writes no notification for B.
  - Five messages in 2 minutes → one row with group_count 5.
  - "@b hello" → one message.mention for B and no message.new for B for that message.
  - B's per-type mute on message.new (the Messaging switch) → the row is recorded with
    channels = {}.
```

### MS5 — Chat actions persist: mute everywhere, delete for me, reactions; dead switches go

```text
PROMPT MS5: Chat actions persist — mute everywhere, delete for me, reactions; dead switches go

ROLE: Full-stack engineer (comms doors and islands). Depends on MS2 (ref-addressed doors) and MS4
(the reaction notice reuses its emitter).

CONTEXT:
  - Ruling: chat mute persists server-side (Decision #339, ruling N3 (d)); Decision #308 flag (a)
    (/messages still mutes in localStorage).
  - Findings: CAS M12 (Delete is localStorage only, and dm_participants.deleted_at has no writer);
    M13 (mute and star are localStorage only on /messages: ConversationHeader.island.tsx:39,
    InboxView.island.tsx:74, MessagesSidebar.island.tsx); M16 (reactions are optimistic and local,
    and comms.message_reactions is never written); D1 and D2 (§3.11: controls that do nothing); D3
    (a literal backdrop-filter: blur(12px) on the desktop pop-out composer,
    features/messaging/styles/chat-popout.css:156-157).
  - SEC L7 lists the reaction `emoji` as 16 characters of unmasked free text. Pinning reactions to
    one emoji set closes that half by construction; tell the trust track's L7 prompt that it can
    skip comms.message_reactions.

FILES:
  - supabase/migrations/00000016_tables_comms.sql (comms.message_reactions.emoji CHECK, :404-420)
  - supabase/migrations/00001300_functions_comms_channels.sql (comms.set_dm_deleted, the twin of
    set_dm_muted; the reaction notice, in the MS4 emitter or a sibling trigger function)
  - supabase/migrations/00001840_triggers_comms.sql (only if the reaction notice is a trigger)
  - supabase/migrations/00002510_permissions_function_grants.sql (set_dm_deleted → authenticated)
  - packages/types/messaging/{folders.ts, conversations.ts} (REACTION_EMOJI) + a contract test
  - packages/backend/services/messaging/{MessagingBackendService.ts, live-folders.ts,
    live-message-marks.ts}
  - apps/web/routes/api/messaging/conversations/[id]/delete.ts (new) and a reaction route beside
    apps/web/routes/api/messages/[id]/pin.ts (new)
  - apps/web/features/messaging/islands/{ConversationHeader,InboxView,MessagesSidebar}.island.tsx,
    apps/web/features/projects/islands/ChatFeed.island.tsx, apps/web/features/messaging/core/
    MessagingService.ts, apps/web/features/messaging/styles/chat-popout.css
  - apps/web/features/settings/components/sections/MessagingSection.tsx (:104-121)
  - supabase/probes/chat_actions.sql (new)
  - documentation/database/comms/*; ROUTING.md (the new routes); PRODUCT_SPEC.md §Messaging E (the
    delete rule)

STEPS:
  1. Mute and star: the /messages header and the inbox rows call MessagingService.setMuted and
     setStarred (the existing doors: comms.set_dm_muted, comms.set_dm_starred). Delete the
     localStorage keys and overlays; the rows read muted and starred from the server projection
     (live-queries.ts:431).
  2. Delete for me: comms.set_dm_deleted(p_thread uuid, p_deleted boolean) writes exactly the
     caller's own participant deleted_at (now() or NULL), like set_dm_muted, and refuses an entity
     channel (22023: leaving a channel means leaving the entity, #306). deleted_at also ends access
     (it is how a departed member loses a channel), so restoring is narrow: the next incoming
     message restores a deleted ONE-TO-ONE thread (kind dm or service_inquiry) by clearing the
     recipient's deleted_at in MS1's summary trigger; a group returns only when its member is added
     back (PRODUCT_SPEC:1198); a channel never. Archive stays a separate folder. Nothing is
     hard-deleted. Write the rule into PRODUCT_SPEC §Messaging E.
  3. Reactions: REACTION_EMOJI (the reaction bubble's set) in @projective/types/messaging, and a
     CHECK emoji = ANY (…) on comms.message_reactions, pinned to the TS list by a contract test.
     Toggle through the existing RLS policies (react_as_self_on_readable_messages and
     remove_own_reaction, 00002012:322-330) from the service, under the caller's JWT. The feed reads
     the reaction counts with the page. A reaction to someone else's message notifies them with
     message.reaction (in-app, collapsed), through MS4's emitter pattern.
  4. Settings → Messaging: hide "Read receipts" and "Typing indicator" until presence exists (an
     SSE stream is Planned, ruling N2), because nothing reads them (CAS D1). Keep the stored
     columns. Sound works since MS3; New messages, Mentions and Group activity work since MS4.
  5. chat-popout.css: a solid --surface-2 panel instead of the literal blur (CAS D3; root §3.9
     does not license backdrop-filter on a desktop floating panel).
  6. Remove the "optimistic, persisted to localStorage" JSDoc claims.

SAME CHANGE: migrations edited in place + Zod + database/comms docs; ROUTING for the new routes;
PRODUCT_SPEC (the delete rule); DESIGN_SYSTEM §C.1 only if a ui component changes.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each announcing its resets; finish with your own clean
`deno task test:probes:fresh`. Never beside MS1, MS4 or the trust track's 00001300 work.

ACCEPTANCE:
  - chat_actions.sql: set_dm_deleted touches only the caller's row; a non-participant → 42501; an
    entity channel → 22023; a reaction outside REACTION_EMOJI → 23514; a reaction by someone who
    cannot read the message → refused by RLS; a new message from the other side of a DM clears the
    deleted_at, while a message in a channel never restores a departed member.
  - Mute in one browser, then sign in as the same persona in a second browser: still muted.
  - grep -rn localStorage apps/web/features/messaging finds no star, mute or delete state.
  - Screenshots: the Messaging settings section without the two hidden switches, and the pop-out
    composer, at 1440 and 390.
```

---

## 3. Notifications

### NT1 — The engine obeys its rules: quiet hours, escalation, digests, collapse

```text
PROMPT NT1: The notification engine obeys its rules — quiet hours, escalation, digests, collapse

ROLE: Postgres engineer (comms notifications). First of the notification chain.

CONTEXT:
  - Ruling: mandatory notices ignore preferences and snooze, and only types flagged
    overrides_quiet_hours break quiet hours for push and SMS (Decision #339, ruling N3 (a)). Q0.3:
    the Wave 1.3 jobs session registers the queue worker, escalation, digests, sweep, reaper and
    compaction in 00005060, so this engine is about to run for real.
  - Findings (CAS §2.2, §2.4), all in 00001310_functions_comms_notifications.sql: N1 (a catch-all
    returns NULL with no WARNING, and the audit insert is swallowed the same way: fn_notify :381,
    handlers :431, :538, :545); N2 (fn_resolve_channels :226 returns early for a mandatory type,
    skipping quiet hours as well as snooze); N3 (the group_key collapse takes no lock, so two
    concurrent events write two rows); N9 (fn_escalate_unread :914 adds an email from the global
    toggle with no category, type or mute check); N10 (fn_build_digests :979 selects only
    global-digest users, so per-category digests are lost); N11 (fn_enqueue :598 has no caller —
    the door is sound, and its callers belong to the scheduling, finance and projects tracks).
  - Suppression (CAS N8) is checked where the destination is known: in NT2's claim.

FILES:
  - supabase/migrations/00001310_functions_comms_notifications.sql (fn_notify, fn_notify_many,
    fn_enqueue, fn_resolve_channels, fn_escalate_unread, fn_build_digests)
  - supabase/probes/notify_engine.sql (new; the collapse race uses dblink, and the runner runs
    committing probes last)
  - documentation/database/comms/{Functions,Tables}.md (the router precedence list; rule 5 of the
    routing contract; the jobs table's "not registered" banner once Wave 1.3 has merged)

STEPS:
  1. Warnings: every handler in fn_notify, fn_notify_many and fn_enqueue still returns NULL, but
     first does RAISE WARNING with the type key and the SQLSTATE (never the payload). The money
     transaction still commits.
  2. The router: for a mandatory type, return default_channels minus push and sms while the
     recipient is inside quiet hours, unless the type sets overrides_quiet_hours. Snooze and every
     preference stay ignored for a mandatory type. Non-mandatory precedence is unchanged (critical
     still pierces a snooze).
  3. Collapse: take pg_advisory_xact_lock(hashtextextended(user_id::text || group_key, 0)) before
     the same-group lookup, so two concurrent events become one row with group_count 2.
  4. Escalation: add an email fallback only when the recipient's resolved email channel for that
     type is on (per-type mute, then the category, then the global toggle), never for a type the
     person muted. Keep the NOT EXISTS idempotency guard.
  5. Digests: fn_build_digests also selects users whose category row sets a digest cadence, and
     rolls up only those categories' digestible rows.
  6. fn_enqueue and fn_cancel_queued: no change beyond the warnings. Record in Functions.md which
     track owns which caller (session reminders: scheduling; the abandoned-basket nudge: finance
     SV4; ghosting timers: finance and projects, ruling P3).

SAME CHANGE: migrations edited in place; database/comms docs. PRODUCT_SPEC §Notifications rule 2
already states step 2, so its text does not change.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each announcing its resets; finish with your own clean
`deno task test:probes:fresh`. Never beside NT2 or NT3 (00001310).

ACCEPTANCE (notify_engine.sql):
  - A mandatory type without the override, at 23:00 inside 22:00–07:00 quiet hours → channels
    without push and sms; an overrides_quiet_hours type keeps push; a mandatory type during a
    snooze is delivered.
  - Two dblink sessions emit the same group_key at once → one row with group_count 2.
  - A user who muted a high-urgency type gets no escalation email; a category-digest user gets a
    digest row for that category only.
  - Once Wave 1.3 has merged: deno task cron:run comms-escalate-unread and comms-digest-daily run
    clean on the seeded DB.
```

### NT2 — 🧑 DECISION · The dispatcher: a signed webhook, claimed deliveries, retries

```text
PROMPT NT2: The dispatcher — a Vault-signed webhook, claimed deliveries and retries

ROLE: Backend and Postgres engineer. Depends on NT1 and the Wave 1.3 jobs session. Owns 00005060
while it runs (one job row).

CONTEXT:
  - Ruling: the outbound dispatch webhook is signed with a Vault-held bearer (Decision #339, ruling
    N3 (c) = #335 (e)). Today fn_dispatch_notification (00001310:1108-1150) posts with only a
    Content-Type header to platform_params.comms_dispatch_url, a placeholder (00005001:113-120).
    Its comment says "the cron worker re-drives pending deliveries", which is false:
    fn_process_queue drains comms.notification_queue only, so nothing retries a delivery.
  - Findings: CAS §2.3 (no dispatcher and no transport; every non-in-app delivery row is stuck
    pending); CAS N8 (fn_is_suppressed has no caller); EPI §8.1 (the pipeline: one entry point that
    fans out to transport modules); EPI §3.5 rules 2 and 4 (no private content to any provider).
  - The runtime is the 🧑 DECISION below. Every other step is the same either way.

🧑 DECISION — STOP before creating the entry point. SYSTEM_ARCHITECTURE.md:2531 names
`dispatch-push` / `send-email` Edge Functions, and EPI §8.1 proposes one `comms-dispatch` Edge
Function. The owner, however, chose "Fresh routes plus pg_cron http jobs" over Edge Functions for
the integration runtime (Decision #343, ruling C4 (a)). Put this to me (it is a new contradiction;
log it with the answer):
  Option A (recommended): POST /api/comms/dispatch in the Fresh app, a thin route over the
  @server/services/comms dispatch service. The trigger posts to Vault's CRON_APP_URL (the origin
  every http job already uses) with Bearer COMMS_DISPATCH_SECRET, and the retry sweep is an
  ordinary http job. One MailTransport serves the dispatcher and the verification mailer (EPI §8.5
  wants one provider and one sending subdomain), the code runs under deno task test:unit, and
  supabase/functions stays empty. SA:2531 and EPI §8.1 are amended in the same change.
  Option B: the comms-dispatch Edge Function of EPI §8.1, with its secrets set through
  `supabase secrets set`, its transports in supabase/functions/_shared, deployed with
  --no-verify-jwt and a constant-time bearer check.
  Steps 1–3 and 5 do not depend on the answer; do them first.

FILES (Option A):
  - supabase/migrations/00001310_functions_comms_notifications.sql (fn_dispatch_notification; new
    comms.fn_claim_deliveries and comms.fn_record_delivery_result)
  - supabase/migrations/00005001_seed_platform_params.sql (retire the comms_dispatch_url row; keep
    the comms.dispatch_webhook flag, still false)
  - supabase/migrations/00005060_seed_scheduled_jobs.sql (comms-dispatch-sweep, http, every minute)
  - supabase/migrations/00002510_permissions_function_grants.sql (both functions → service_role
    only); 00004006_indexes_comms.sql only if the claim's EXPLAIN needs a partial index
  - packages/backend/services/comms/{NotificationDispatchService.ts, dispatch-transports.ts,
    dispatch-payload.ts} (new) + tests
  - apps/web/routes/api/comms/dispatch.ts and apps/web/routes/api/comms/cron/dispatch.ts (new,
    thin; constant-time bearer, 404 otherwise)
  - packages/backend/core/env.ts (commsDispatchSecret); .env.example
    (COMMS_DISPATCH_SECRET=XXXX-XXXX)
  - supabase/probes/comms_dispatch.sql (new)
  - documentation: database/comms/Functions.md (§The dispatch webhook); SYSTEM_ARCHITECTURE.md
    (§The Notification Engine :2477-2534 and the Environment Variable Contract); EPI §3.1, §8.1,
    §10; ROUTING.md (the two routes); PRODUCT_MANAGEMENT.md (the Notification delivery row: who
    writes queued, sent, failed, suppressed and skipped); PRODUCT_SPEC.md:95-97 (reword the
    dispatcher half; the marker stays until a transport ships)

STEPS:
  1. The trigger: fn_dispatch_notification reads CRON_APP_URL and COMMS_DISPATCH_SECRET from
     vault.decrypted_secrets exactly as ops.fn_dispatch_http_job does (00001650:192-262), and posts
     {notification_id} to <origin>/api/comms/dispatch with Authorization: Bearer. A missing secret,
     origin or pg_net logs a warning in the scheduler's style and posts nothing; the deliveries wait
     for the sweep. The flag check stays first. Correct the comment.
  2. comms.fn_claim_deliveries(p_channels comms.notification_channel[], p_notification uuid DEFAULT
     NULL, p_limit integer DEFAULT 200), with FOR UPDATE SKIP LOCKED. It claims only rows of the
     channels the caller can send (rows of any other channel stay pending, untouched, so no attempt
     is burned on a transport that is not configured yet), created in the last 24 hours, that are
     pending, or failed with attempts < 5 and an updated_at older than 2^attempts minutes; it sets
     status = 'queued', attempts + 1 and queued_at. A row older than 24 hours is never sent (a
     notification is not news a day later; the in-app row is the record). It returns each row with
     its resolved destination: for email, the person's primary verified org.user_emails address;
     for sms, the confirmed auth phone (auth.users.phone with phone_confirmed_at); for push, the
     unrevoked comms.device_tokens row. In the same statement it marks rows with no destination
     'skipped', and rows that fn_is_suppressed refuses 'suppressed' with a suppressed_reason (CAS
     N8). A destination never leaves the service and is never logged.
  3. comms.fn_record_delivery_result(p_delivery uuid, p_status comms.delivery_status, p_provider
     text, p_provider_ref text, p_error text) writes the sent, delivered or failed timestamp; a push
     answered 'gone' revokes the device (comms.revoke_device's semantics). Service role only.
  4. NotificationDispatchService.dispatch(notificationId | null) claims for the channels its
     registry can serve, builds the payload (the title, the absolute deep link from APP_URL +
     action_url, and the notification id — never the body or payload, EPI §3.5 rule 4), hands each
     row to its channel's transport, and records the result. Deliveries of an unconfigured channel
     wait (deferred, EPI §3.2), so a provider turned on later sends what is still inside the
     24-hour window. The registry starts EMPTY; NT3, NT4 and NT5 each add one transport.
  5. The retry sweep: the comms-dispatch-sweep http job (every minute, secret
     COMMS_DISPATCH_SECRET, path /api/comms/cron/dispatch?limit=200) calls dispatch(null). It
     honours the same comms.dispatch_webhook flag as the trigger, so one switch turns outbound
     delivery on and off. The same pass sends each due comms.notification_digests row as one
     email, once a mail transport exists (NT3).
  6. The comms.dispatch_webhook flag stays false in the seed. The runbook (EPI §8.1) says when to
     turn it on: once Vault holds both secrets and at least one transport is configured.

SAME CHANGE: migrations edited in place + database/comms docs; PRODUCT_MANAGEMENT (the delivery
lifecycle's writers); ROUTING (two routes); SYSTEM_ARCHITECTURE and EPI (the runtime and the env
contract); .env.example; the decision row for the runtime answer.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each announcing its resets; finish with your own clean
`deno task test:probes:fresh`. Owns 00005060 only while it runs; never beside another job-adding
prompt, and only after the Wave 1.3 jobs session has merged.

ACCEPTANCE:
  - comms_dispatch.sql: with the flag on and both Vault secrets set, a notification queues a
    net.http_request_queue row whose headers carry Authorization: Bearer; with the secret missing,
    there is no request and there is a warning log; two dblink sessions claiming at once never get
    the same delivery; a hard-suppressed email row comes back 'suppressed'; a user with no phone
    comes back 'skipped'.
  - Route tests: a wrong bearer → 404; the right one → 200 with a count.
  - A unit test proves that the payload has no body or payload field, and that its link is a
    same-origin path.
```

### NT3 — 🧑 DECISION · Transactional email: one provider; a hard bounce blocks the address

```text
PROMPT NT3: Transactional email — one provider, signed bounces; a hard bounce blocks the address

ROLE: Backend engineer (mail). Depends on NT2.

CONTEXT:
  - Rulings: a hard bounce blocks every category for that address, and the user is prompted in the
    app to fix the email (Decision #339, ruling N3 (b)); mandatory types ignore preferences (ruling
    N3 (a)). The provider is not ruled (#335 (f) recommends Resend).
  - Findings: CAS §2.3 (no email sender; configuredTransport() in
    services/mail/verification-mailer.ts:43 returns null); CAS §2.5 step 3 (transactional first,
    suppression consulted, bounces written to comms.channel_suppressions); EPI §8.5 (domains, DNS,
    GoTrue SMTP, webhooks). EPI §8.5 rule 7 still says a bounce suppresses Marketing only, which is
    stale against ruling N3 (b): fix it here.
  - Reading (not a stop): a spam complaint is not a bounce — the address works and the person
    objects — so it suppresses Marketing only, like an unsubscribe (PRODUCT_SPEC §Notifications
    rule 3, and the half of EPI rule 7 that the ruling did not change).
  - marketing.newsletter and marketing.product_update route to email (00005010:127-128), so
    marketing mail needs a working unsubscribe the moment email sends.

🧑 DECISION — STOP before writing a transport. Put this to me:
  Option A (recommended): Resend. It is already in the comms vocabulary (the
  NotificationDelivery.provider JSDoc); it has an HTTP API plus SMTP for GoTrue, Svix-signed and
  replayable webhooks that match EPI §3.3, and separate keys per subdomain. SES can come later,
  behind the same MailTransport, when cost demands it.
  Option B: Postmark (the best transactional deliverability and native message streams, but its
  webhooks authenticate with basic auth or an IP allow-list, which is weaker than a signature).
  Option C: Amazon SES (the cheapest at scale; a sandbox exit, SNS plumbing, and you own the
  sending reputation).
  Production cannot launch without one (EPI §8.5: "a go-live blocker").

FILES (Option A; swap the names for B or C):
  - packages/backend/services/mail/transport.ts (new: MailTransport and configuredTransport moved
    out of verification-mailer.ts, which then imports them) and transport-resend.ts (new) + tests
  - packages/backend/services/comms/{dispatch-transports.ts (register email),
    DeliveryEventService.ts (new)} + tests
  - apps/web/routes/api/comms/webhooks/resend.ts (new, thin; the Svix check lives in the service)
  - an unsubscribe route (reuse packages/backend/services/newsletter's token if it has one;
    otherwise a signed one-click route)
  - supabase/migrations/00001310_functions_comms_notifications.sql (comms.fn_record_delivery_event:
    claims delivery_events (provider, provider_event_id), updates the delivery, writes
    comms.channel_suppressions and emits account.email_undeliverable)
  - supabase/migrations/00005010_seed_notification_catalog.sql (account.email_undeliverable:
    account · high · in_app only · mandatory · action URL /settings/account#email)
  - supabase/migrations/00002510_permissions_function_grants.sql (service_role)
  - supabase/config.toml ([auth.email.smtp] through the provider with
    env(SUPABASE_AUTH_SMTP_PASS), replacing the SendGrid sketch at :257-263)
  - packages/backend/core/env.ts; .env.example (RESEND_API_KEY=XXXX-XXXX, MAIL_FROM,
    RESEND_WEBHOOK_SECRET=XXXX-XXXX, SUPABASE_AUTH_SMTP_PASS=XXXX-XXXX)
  - the account read (an emailUndeliverable flag) and
    apps/web/features/settings/components/sections/AccountSection.tsx (an InlineNotice on the email
    block)
  - apps/web/features/devtools/core/dev-context.ts + apps/web/utils/dev-seam.ts (the axis below)
  - supabase/probes/email_bounce.sql (new)
  - documentation: EPI §8.5 (rule 7 rewritten to ruling N3 (b); the runbook), §3.4, §10;
    SYSTEM_ARCHITECTURE's env contract; database/comms/*; PRODUCT_SPEC.md:1333-1336 (remove the
    **Not built yet** once mail sends and the prompt exists) and :95-97 (the email half);
    ROUTING.md (the webhook and unsubscribe routes)

STEPS:
  1. The transport: configuredTransport() returns the provider transport when RESEND_API_KEY is
     well formed (re_…; the placeholder counts as absent), and null otherwise (development logs the
     mail, production reports it unavailable, as today). Send with an Idempotency-Key equal to the
     delivery id. An email carries the title, one sentence and an "Open in Projective" link to the
     absolute action URL, never the body or payload (EPI §3.5 rule 4). Marketing-category mail also
     carries a one-click List-Unsubscribe header (RFC 8058) whose route writes a marketing_only
     suppression.
  2. The webhook: POST /api/comms/webhooks/resend follows EPI §3.3 to the letter: a 256 KiB cap,
     the Svix HMAC over `${svix-id}.${svix-timestamp}.${body}`, a 300 s tolerance, then
     fn_record_delivery_event in one transaction keyed (provider 'resend', provider_event_id =
     svix-id). delivered → the delivery is delivered. A hard bounce → the delivery fails, the
     ADDRESS is suppressed for email with marketing_only = false (every category, ruling N3 (b)),
     and its owner receives account.email_undeliverable. A soft bounce or delivery_delayed is only
     recorded. complained → marketing_only = true. A replay is a no-op.
  3. The in-app prompt: the mandatory account.email_undeliverable notice links to
     /settings/account#email, and the account email block shows an InlineNotice while the primary
     address is suppressed ("We can't deliver email to … — change it or confirm it again").
     Re-verifying that same address through the existing verify flow proves that it receives mail
     and lifts the suppression (lifted_at, lifted_reason 'reverified'); the verification mail is the
     person's own request and goes through verification-mailer, not the dispatcher, so the
     suppression does not block it. Changing the primary address leaves the old address's
     suppression in place.
  4. GoTrue's auth mail goes through the same provider and sending subdomain (config.toml locally,
     the dashboard when hosted). Local development keeps Mailpit.
  5. Dev Context Switcher: emailDeliverability (auto · deliverable · bounced). `bounced` makes the
     account read report the primary address as undeliverable, so the notice and the in-app prompt
     can be seen without a real bounce. DevOverrides + DEV_DEFAULTS, the DevOption list, the
     DevContextPanel control, and reflect() set AND delete.

SAME CHANGE: migrations edited in place + Zod (packages/types/comms) + database/comms docs; the
PRODUCT_SPEC markers; EPI §8.5 rule 7; ROUTING; the Dev switcher axis; the env contract.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each announcing its resets; finish with your own clean
`deno task test:probes:fresh`. Never beside NT1 or NT2 (00001310), or MS4 or NT5 (00005010).

ACCEPTANCE:
  - email_bounce.sql: a hard bounce suppresses the address for every category; a later mandatory
    money email to it comes back 'suppressed' from NT2's claim; exactly one
    account.email_undeliverable exists; the same event replayed changes nothing; a complaint
    suppresses Marketing only; re-verifying lifts the suppression.
  - Webhook tests: a tampered body or a 301-second-old timestamp → 400; a valid event → 200.
  - A unit test: with RESEND_API_KEY=XXXX-XXXX, configuredTransport() is null.
  - Screenshots of the account email block with the notice (emailDeliverability = bounced), at
    1440 and 390.
```

### NT4 — Web Push: VAPID, device registration from an explicit control, a push handler

```text
PROMPT NT4: Web Push — VAPID, device registration from an explicit control, and a push handler

ROLE: Full-stack engineer (service worker and push). Depends on NT2. Runs before NT5: both edit the
Notifications settings section.

CONTEXT:
  - Findings: CAS §2.3 (comms.device_tokens and comms.register_device exist, but there is no
    caller, no push handler in sw.js and no sender); CAS §2.1 (50 catalog types route to push); CAS
    §2.5 step 4; EPI §8.2 (the whole contract: VAPID keys, the browser flow, aes128gcm payloads,
    the 201/404/410/413/429 table, iOS). APNs and FCM (EPI §8.3, §8.4) serve native apps, a Growth
    item: not built here.
  - There is no web app manifest (apps/web/static holds icons only), and iOS delivers Web Push only
    to a web app added to the Home Screen with a manifest.

FILES:
  - packages/backend/services/comms/{transport-webpush.ts (new: the VAPID ES256 JWT, RFC 8291
    aes128gcm, the TTL, Urgency and Topic headers), dispatch-transports.ts} + tests
  - apps/web/routes/api/notifications/push/config.ts (GET: the public key, or 404 when VAPID is
    not configured) and apps/web/routes/api/notifications/devices.ts (POST register and DELETE
    revoke → comms.register_device / comms.revoke_device under the caller's JWT) (new, thin)
  - packages/backend/services/comms/NotificationInboxBackendService.ts (registerDevice,
    revokeDevice), or a small DeviceBackendService
  - apps/web/static/sw.js (push and notificationclick handlers); apps/web/static/
    manifest.webmanifest (new); apps/web/routes/_app.tsx (<link rel="manifest">)
  - apps/web/features/settings/components/sections/NotificationsSection.tsx and a core helper for
    the browser permission flow
  - apps/web/features/devtools/core/dev-context.ts + apps/web/utils/dev-seam.ts (pushPermission)
  - packages/backend/core/env.ts; .env.example (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and
    VAPID_SUBJECT = XXXX-XXXX)
  - documentation: EPI §3.1, §8.2, §10; SYSTEM_ARCHITECTURE's env contract; ROUTING.md (the two
    routes); database/comms/Functions.md (register_device's caller); PRODUCT_SPEC.md:95-97 (the
    push half)

STEPS:
  1. The transport signs the VAPID JWT (aud = the endpoint's origin, exp ≤ 24 h, sub =
     VAPID_SUBJECT), encrypts the payload {title, url, id} (≤ 4 KB) with RFC 8291 aes128gcm through
     Web Crypto, and sets TTL, Urgency (from comms.notification_urgency) and Topic (the
     notification's group_key, or its id). 201 → sent; 404 or 410 → gone (NT2 revokes the device);
     413 → failed and logged; 429 or 5xx → failed, for the sweep's back-off. Unit-test the
     encryption against the test vector published in RFC 8291.
  2. Push is configured when all three VAPID keys are well formed; a placeholder counts as absent.
     Unconfigured, no transport registers and push deliveries wait (NT2 step 4).
  3. Settings → Notifications gets an "Alerts on this device" control. It asks for permission only
     when pressed (never on load), subscribes with userVisibleOnly and the served public key, and
     POSTs the subscription; "Stop on this device" revokes it. The control renders only when push
     is configured and the browser supports it. On iOS Safari outside a Home-Screen app it shows
     the reason and how to add the app instead (§3.11). The existing account-wide Push switch keeps
     its meaning (the transport's master switch).
  4. sw.js: push → showNotification(title, { tag: the Topic, data: { url, id } }); notificationclick
     opens or focuses ONLY a same-origin path that starts with a single "/", and opens "/" for
     anything else.
  5. manifest.webmanifest: name, short_name, start_url "/", display "standalone", and the 192 and
     512 icons. Its two colours are hex values copied from the light-mode tokens (a manifest is
     JSON and cannot read CSS variables); EPI §8.2 says where they come from.
  6. Dev Context Switcher: pushPermission (auto · prompt · granted · denied · unsupported ·
     ios-not-installed), mirroring DevMicPermission, applied client-side under the dev seam.
     DevOverrides + DEV_DEFAULTS, the DevOption list, the DevContextPanel control, and reflect() set
     AND delete.

SAME CHANGE: ROUTING (two routes); the Dev switcher axis; the env contract; the PRODUCT_SPEC marker
(the push half); DESIGN_SYSTEM §C.1 only if a ui component changes.

ACCEPTANCE:
  - transport-webpush.test.ts passes the RFC 8291 vector; a 410 maps to gone.
  - With VAPID unconfigured, the device control does not render and
    /api/notifications/push/config answers 404.
  - In Chrome (deno task dev, with test VAPID keys in .env.local): enabling alerts on this device
    writes a device_tokens row; a mandatory test notification (fn_notify called by the service
    role on the local DB) shows a system notification whose click opens the in-app path; a crafted
    payload with url "https://evil.example" opens "/".
  - Screenshots of each pushPermission state at 1440 and 390.
```

### NT5 — SMS through Twilio: built now on placeholder keys; the switch shows only when configured

```text
PROMPT NT5: SMS through Twilio — built on placeholder keys; the switch shows once it is configured

ROLE: Backend engineer. Depends on NT2, and on NT4 (both edit the Notifications settings section).

CONTEXT:
  - Ruling: build everything Twilio needs now, with XXXX-XXXX placeholders, while the owner obtains
    the tokens; the SMS switch renders only once Twilio is configured (Decision #339, the P3 row on
    flag (n); root CLAUDE.md §3.11).
  - Findings: CAS §2.1 (SMS is in 0 of 112 catalog rows); §2.3; §2.5 step 5 (SMS last, and only
    for security alerts and session-starting-now reminders, because of per-message cost and
    SIM-swap exposure); D5 (SMS rendered as a selectable transport that can never send:
    NotificationsSection.tsx:43, :50, :76). EPI §8.6: the Messaging Service, status callbacks
    verified with X-Twilio-Signature, geo-permissions. supabase/config.toml:335-340 scaffolds
    GoTrue's own Twilio block for Level 1 phone OTP.
  - PRODUCT_SPEC §Notifications rule 2 names the time-critical types that break quiet hours for
    push and SMS: a session starting in minutes, a security alert, a failed payout.

FILES:
  - supabase/migrations/00005010_seed_notification_catalog.sql ('sms' added to the default
    channels of account.password_changed, account.new_device_login, session.reminder_5m and
    payout.failed, plus any other security-alert row the grep finds; nothing else)
  - packages/backend/services/comms/{transport-twilio.ts (new), dispatch-transports.ts} + tests
  - apps/web/routes/api/comms/webhooks/twilio.ts (new, thin: X-Twilio-Signature over the full URL
    and the sorted form parameters, timing-safe, then fn_record_delivery_event with provider
    'twilio' and provider_event_id = the MessageSid and MessageStatus)
  - packages/backend/services/user/NotificationCenterBackendService.ts (smsAvailable in the
    settings read) and apps/web/features/settings/components/sections/NotificationsSection.tsx
  - packages/backend/core/env.ts; .env.example (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and
    TWILIO_MESSAGING_SERVICE_SID = XXXX-XXXX); supabase/config.toml (the GoTrue block reads the
    same names; `enabled` stays false, because switching phone OTP on is the identity track's call)
  - apps/web/features/devtools/core/dev-context.ts + apps/web/utils/dev-seam.ts (smsProvider)
  - packages/types/comms/catalog.ts + catalog.contract.test.ts; supabase/probes/sms_routing.sql
    (new)
  - documentation: EPI §8.6 (the runbook: the Messaging Service, geo-permissions limited to launch
    markets, SMS-pumping protection), §3.4, §10; SYSTEM_ARCHITECTURE's env contract; ROUTING.md
    (the callback route); PRODUCT_SPEC.md §Notifications (which types may text) and :95-97 (remove
    the marker once email, push and SMS have each shipped)

STEPS:
  1. Twilio is configured when TWILIO_ACCOUNT_SID matches ^AC[0-9a-f]{32}$, TWILIO_AUTH_TOKEN is 32
     hex characters and TWILIO_MESSAGING_SERVICE_SID matches ^MG[0-9a-f]{32}$; placeholders count as
     absent. One name per secret: config.toml's auth_token reads env(TWILIO_AUTH_TOKEN), and
     SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN leaves .env.example.
  2. The transport POSTs to the Messages API with MessagingServiceSid, To = the claimed confirmed
     phone, Body = the title and the short link (no body text, EPI §3.5 rule 4), and StatusCallback
     = the webhook URL. 2xx → sent (provider_ref = the SID); a 4xx for an invalid number → failed,
     and the number joins comms.channel_suppressions for sms; 429 or 5xx → failed, for the sweep's
     back-off.
  3. The settings read carries smsAvailable = configured. The SMS ("Text") column and its master
     switch render only when it is true; delete the "Nothing is sent by text message yet" copy. A
     person with no confirmed phone sees the switch disabled, with the reason and a link to verify
     a phone (§3.11), but only once the identity track has shipped phone verification; until then
     the column does not render for them.
  4. Catalog: the four types above (and any other security-alert row) gain 'sms'. Record the rule
     in PRODUCT_SPEC §Notifications: a text message carries only a security alert, a session
     starting in minutes or a failed payout.
  5. Dev Context Switcher: smsProvider (auto · configured · unconfigured), applied to the settings
     read under the dev seam. DevOverrides + DEV_DEFAULTS, the DevOption list, the DevContextPanel
     control, and reflect() set AND delete.

SAME CHANGE: migrations edited in place (the seed) + the catalog contract test + database/comms
docs; PRODUCT_SPEC (the SMS rule and the marker); ROUTING; the env contract; the Dev switcher axis.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each announcing its resets; finish with your own clean
`deno task test:probes:fresh`. Never beside MS4 or NT3 (00005010).

ACCEPTANCE:
  - sms_routing.sql: a new-device login for a user with a confirmed phone and SMS on → an sms
    delivery row, which stays inside quiet hours (overrides_quiet_hours); message.new never routes
    to sms.
  - With the placeholders, no SMS transport registers and the settings page shows no SMS column
    (smsProvider = auto); smsProvider = configured shows it.
  - Callback tests: a bad signature → 400; a valid "delivered" → the delivery is delivered; a
    replay is a no-op.
```

---

## 4. Discovery search

### SR1 — Nearest-neighbour recall at scale, and the dead search definers deleted

```text
PROMPT SR1: Nearest-neighbour recall at scale, and the dead search definers deleted

ROLE: Postgres engineer (search). First of the search chain; this is RED WP14.

CONTEXT:
  - Rulings: HNSW runs ef_search = 200 with iterative_scan, not RED's 100 (Decision #339, ruling
    N4). search.fn_search_entities and fn_search_global are deleted (Q0.2 (f); #340 (E), SEC G11:
    the revoke is done, the deletion is not).
  - Findings: CAS S7 and S11 (the filters apply after the default ef_search = 40 candidate scan, so
    a filtered search starves — a Teams search returns nearly empty and SEMANTIC_POOL = 100 is
    unreachable — hidden at seed scale, where the planner seq-scans); RED D-28 and D-29; CAS S3
    (unit length is not asserted in the database); SEC G18 (fn_nearest and fn_nearest_to_entity
    pin search_path = search, public).
  - 00001400 today: fn_norm :395, fn_search_entities :407-676, fn_search_global :677,
    fn_set_embedding :972, fn_nearest :1025, fn_nearest_to_entity :1083. Grants:
    00002510:246-273 and :317-325. The HNSW indexes: 00004004:4-10.

FILES:
  - supabase/migrations/00001400_functions_search.sql
  - supabase/migrations/00002510_permissions_function_grants.sql (remove the deleted functions'
    lines)
  - supabase/probes/search_recall.sql (new)
  - documentation/database/search/{Functions,Policies}.md; SYSTEM_ARCHITECTURE.md §Discovery (the
    tuning sentence); EPI §5.3 "HNSW tuning"

STEPS:
  1. Check the image's pgvector first: SELECT extversion FROM pg_extension WHERE extname =
     'vector'. From 0.8.0, declare SET hnsw.ef_search = 200 and SET hnsw.iterative_scan =
     relaxed_order on both nearest functions. Below 0.8.0, set ef_search = 200 only, and record in
     Functions.md that iterative_scan waits for the image upgrade (do not stop; say so in your
     report).
  2. Pin search_path = '' on both functions and schema-qualify them (SEC G18, for these two
     functions only; the sync triggers' half stays with its owner).
  3. fn_set_embedding refuses a vector whose norm is not 1 ± 1e-3 (CAS S3), with a distinct
     SQLSTATE that the embedding sync logs and skips.
  4. Delete fn_search_entities and fn_search_global and their grant lines. Delete search.fn_norm
     as well if no caller remains (today only fn_search_entities reads it). The search_weights rows
     that only they read stay, because they are data; list them in the commit message.

SAME CHANGE: migrations edited in place + database/search docs; the SYSTEM_ARCHITECTURE and EPI
tuning notes.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each announcing its resets; finish with your own clean
`deno task test:probes:fresh`. Never beside SR3 (00001400) or another 00002510 writer.

ACCEPTANCE (search_recall.sql, BEGIN … ROLLBACK, with SET LOCAL enable_seqscan = off so that the
HNSW index is used at probe scale):
  - Insert 1,000 synthetic unit vectors into search.profiles_index (700 user rows and 300 team
    rows, each with a display_name and passing fn_nearest's visibility filter; the table has no FK
    on entity_id) and ask fn_nearest for 20 teams. Run it once on the unfixed function first and
    record the shortfall; after the fix it returns 20.
  - Where iterative_scan is on: 2,000 rows with 40 teams still return 20.
  - pg_proc.proconfig of both functions carries hnsw.ef_search=200 (and
    hnsw.iterative_scan=relaxed_order where supported).
  - fn_set_embedding with a vector of norm 2.0 is refused.
  - to_regproc('search.fn_search_entities') and to_regproc('search.fn_search_global') are NULL.
```

### SR2 — Bounded search input, a per-client embedding budget, a scheduled backfill, Voyage pinned

```text
PROMPT SR2: Bounded search input, a per-client embedding budget, a backfill job, Voyage pinned

ROLE: Backend engineer (the explore and search services). Depends on SR1. Owns 00005060 while it
runs (one job row).

CONTEXT:
  - Rulings: embeddings are pinned to Voyage, with written no-training terms before
    EMBEDDINGS_ENABLED is switched on (Decision #339 (d); #340, ruling T5). The semantic blend's
    dials live in finance-model.md §16.7 (Decision #339, ruling N4); Wave 1.1 already wrote them
    there (:880) and in PRODUCT_SPEC §Reputation & Discovery.
  - Findings: CAS S37 (the route hand-parses its input; ExploreParamsSchema is unused and
    unbounded; q, sort and any filter key reach query_logs.filters_applied:
    apps/web/routes/api/explore/search.ts, packages/types/explore/discovery.ts:24-33,
    packages/backend/services/search/query-log.ts:26-31); S30 (no per-client limit on
    /api/explore/search or the SSR /explore?q=, so one client can drain the isolate's Voyage
    bucket); S14 (re-embeds run in process and are lost on restart; nothing scheduled catches up);
    S32 and EPI §3.4 (the client defaults to the MongoDB Atlas host:
    services/search/voyage-client.ts:27-36).

FILES:
  - packages/types/explore/discovery.ts (ExploreParamsSchema, bounded);
    apps/web/features/explore/core/explore-state.ts (parseExploreParams uses it);
    apps/web/routes/api/explore/search.ts; apps/web/routes/(public)/explore.tsx
  - packages/backend/services/explore/ExploreBackendService.ts and
    packages/backend/services/search/{EmbeddingBackendService.ts, voyage-client.ts,
    embedding-sync.ts, query-log.ts} + tests
  - apps/web/utils/client-key.ts and packages/backend/core/rate-limit.ts (read only)
  - apps/web/routes/api/search/cron/embeddings.ts (new, thin; constant-time bearer, 404 otherwise)
  - supabase/migrations/00005060_seed_scheduled_jobs.sql (search-embeddings-backfill, http, hourly,
    secret SEARCH_CRON_SECRET)
  - packages/backend/core/env.ts; .env.example (SEARCH_CRON_SECRET=XXXX-XXXX; the VOYAGE_API_BASE
    comment)
  - packages/backend/services/explore/semantic.contract.test.ts (new)
  - apps/web/features/legal/core/content/privacy.ts (:172, if the wording changes)
  - documentation: EPI §3.4, §5.1–5.3, §10, §11 (the go-live line); SYSTEM_ARCHITECTURE §Discovery
    (S14 and the host); ROUTING.md (the /explore query contract and the cron route);
    database/search docs

STEPS:
  1. Zod at both doors (S37): q ≤ 512 characters, sort an enum of the backend's sorts, facet keys
     from a whitelist that the facet code in explore-state.ts exports, and offset and limit as
     bounded integers. Over-long or unknown input is corrected to the canonical query: the page
     redirects to it, and the API answers 422. Only whitelisted keys reach
     query_logs.filters_applied.
  2. A per-client embedding budget (S30): a SlidingWindowLimiter keyed by client-key.ts (the user
     id when signed in), at 30 query embeddings a minute. Past it, the request ranks heuristically
     (x-discovery-ranking: heuristic, reason client_budget). A page view is never a 429.
  3. A scheduled backfill (S14): the cron route does the work of `deno task embeddings:backfill`
     for at most N stale items (a hash or model mismatch) per run, and is a no-op when
     isEmbeddingsLive() is false. One job row goes in 00005060.
  4. Voyage pinned (#339 (d), T5): voyage-client.ts always calls https://api.voyageai.com, and a key
     that does not start `pa-` counts as absent. VOYAGE_API_BASE remains only to point tests at a
     mock. EPI §3.4's row becomes "Voyage AI", privacy.ts names Voyage only, and EPI §11 gains the
     go-live line "Voyage's written no-training and retention terms on file".
  5. Dials parity (N4): semantic.contract.test.ts reads the "Semantic blend" row of
     finance-model.md §16.7 and asserts that SEMANTIC_BLEND_WEIGHT, the 0.30 floor,
     SEMANTIC_EXTRA_RELATIVE and the 12-extra cap equal it (the file-reading pattern of
     slug.contract.test.ts).

🧑 OWNER GATE (not a build stop): do NOT set EMBEDDINGS_ENABLED=true in any committed file or
hosted environment. The owner switches it on once Voyage's written no-training terms exist.

SAME CHANGE: ROUTING (the /explore contract and the cron route); the env contract; EPI;
SYSTEM_ARCHITECTURE; database/search docs.

SQL SESSION (the one job row): run probes with `deno task test:probes`; at most 2 SQL sessions at
once on the one local DB, on disjoint migration files, each announcing its resets; finish with
your own clean `deno task test:probes:fresh`. Owns 00005060 only while it runs.

ACCEPTANCE:
  - Route tests: a q of 513 characters → 422 from the API and a canonical redirect from the page;
    an unknown facet key never reaches query_logs; the 31st embedded search in a minute ranks
    heuristically.
  - voyage-client.test.ts: an Atlas-shaped key is absent; the URL is api.voyageai.com.
  - The contract test fails when a dial in §16.7 is edited alone.
  - deno task cron:run search-embeddings-backfill succeeds with the gate off, and makes no Voyage
    call.
```

### SR3 — 🧑 DECISION · Context-aware ranking for signed-in viewers, and the pgvector result cache

```text
PROMPT SR3: Context-aware ranking for signed-in viewers, and the pgvector result cache

ROLE: Search engineer (Postgres and backend). Depends on SR1 and MS3 (the version keys).

CONTEXT:
  - Ruling: context-aware ranking and the pgvector KV cache are built now, not Planned (Decision
    #339, the P3 row on flag (c)). SA:2347-2350 describes context-aware ranking, SA:849-850 calls
    user vectors "the separate ranking-v1 task", and SA:3028 says pgvector results "can be cached
    in Deno KV". PRODUCT_SPEC:2791-2792 marks it **Not built yet**.
  - Findings: CAS S25 (an empty personalisation hook region:
    services/explore/ExploreBackendService.ts:403-404, "user vectors re-rank the personal rails");
    S24 (offset paging over a list recomputed per request); RED D-17 (the /view "Similar" rail runs
    fn_nearest_to_entity on every request over public data, services/explore/live-view.ts); ADC Q11
    (viewer-scoped data stays in the tenant memory tier, KV holds only small global values, and raw
    text is never a key: EPI §3.5 rule 7).
  - anon and authenticated can never read a vector (00002520), so the viewer's context vector must
    be computed inside a definer that returns ids and scores only.

🧑 DECISION — STOP before changing any shared order. Personal context changes who earns, so its
weight is a business rule (PRODUCT_SPEC §Reputation & Discovery; the dial in finance-model.md
§16.7). Put this to me:
  Option A (recommended): the viewer's context re-ranks their Home personal rails (the hook the
  code reserves) AND blends at 0.25 into signed-in "recommended" orders. Search results keep the
  query blend (ruling N4). The blend applies only from 5 interest events in 90 days, never to
  guests and never to sponsored slots, and leaves the Discovery Boost and the Standing multiplier
  untouched, so a newcomer is not buried under the incumbents a viewer already knows.
  Option B: the personal rails only; no shared order changes.
  Option C: name a different weight.
  Steps 1, 3, 4 and 5 do not depend on the answer; step 2 does.

FILES:
  - supabase/migrations/00001400_functions_search.sql (search.fn_nearest_for_viewer)
  - supabase/migrations/00002510_permissions_function_grants.sql (EXECUTE to authenticated only)
  - supabase/migrations/00005050_seed_reference_data.sql (search.search_weights: context_affinity)
  - packages/backend/services/explore/{ExploreBackendService.ts, semantic.ts, similarity-cache.ts,
    live-view.ts, ranking.ts, personalise.ts} + tests; packages/backend/core/cache-version.ts (the
    catalogue scope)
  - apps/web/features/devtools/core/dev-context.ts + apps/web/utils/dev-seam.ts (contextRanking)
  - supabase/probes/context_ranking.sql (new)
  - documentation: PRODUCT_SPEC.md:2791-2792 (remove the marker and state the rule);
    finance-model.md §16.7 (the context dials); SYSTEM_ARCHITECTURE.md :849-850, :2347-2350 and
    :3028 (as built); database/search/*

STEPS:
  1. search.fn_nearest_for_viewer(p_types text[], p_exclude uuid[], p_limit integer) RETURNS TABLE
     (entity_type text, entity_id uuid, score real): SECURITY DEFINER, search_path = '', with SR1's
     hnsw settings. It reads ONLY auth.uid()'s own search.interest_events (click · save · view ·
     hire · apply · message, each weighted by `weight` and a 14-day half-life, the topic-affinity
     decay of §16.7), averages the matching public rows' embeddings into one normalised vector, and
     returns the nearest public rows, excluding the viewer's own entities. Below the minimum number
     of events it returns no rows. The vector is never returned or stored. EXECUTE to authenticated
     only: anon has no context.
  2. After the ruling: the Home feed's personal rails rank by fn_nearest_for_viewer (fill the
     ExploreBackendService.ts:403 hook region), and, under Option A, ExploreBackendService blends
     the similarity into signed-in recommended orders with search.search_weights 'context_affinity'
     (seeded at the ruled value). The result is cached per tenant, in memory only (ArcCache, 5
     minutes).
  3. The pgvector KV cache: a search's resolved neighbours (ids and scores, never vectors) and the
     "Similar" rail's neighbours go to Deno KV under ["cache","nearest",model,dims,catalogueVersion,
     category,sha256(normalised query)] and ["cache","similar",model,dims,catalogueVersion,
     entityId] for 15 minutes, behind the existing per-isolate LRU (RED D-17). The catalogue
     version comes from MS3's cache-version.ts; it is null until RED WP3's invalidation half bumps
     it, so the TTL governs until then. Every hit is still re-resolved against the anon catalogue,
     so a stale entry can cost relevance, never visibility. Values stay under 64 KiB. Context
     results never go to KV.
  4. Paging stability (S24): page 2 and later of a search read the cached ordered id list for
     (params, the catalogue's loadedAt) instead of re-ranking, so a heuristic fallback on page 2
     can no longer duplicate or skip results.
  5. Dev Context Switcher: contextRanking (auto · on · off), honoured only under
     DENO_ENV=development, like pj.dev.embeddings. DevOverrides + DEV_DEFAULTS, the DevOption list,
     the DevContextPanel control, and reflect() set AND delete.

SAME CHANGE: migrations edited in place + database/search docs; PRODUCT_SPEC and finance-model
§16.7 (the rule and its dials); SYSTEM_ARCHITECTURE; the Dev switcher axis.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each announcing its resets; finish with your own clean
`deno task test:probes:fresh`. Never beside SR1 (00001400), SR4 (00005050) or another 00002510
writer.

ACCEPTANCE:
  - context_ranking.sql: as viewer A (claims set, then SET LOCAL ROLE authenticated) with 6 clicks
    on design services, the nearest rows lean to design; a viewer with 2 events gets no rows; anon
    is refused; no column of the result is a vector.
  - A unit test: two identical searches through two service instances that share one KV make one
    fn_nearest call; a different category is a miss.
  - A semantic page 1 and a heuristic page 2 return disjoint, contiguous slices of one order.
```

### SR4 — 🧑 DECISION · Load and reliability weigh heavily in ranking

```text
PROMPT SR4: Load and reliability weigh heavily in ranking

ROLE: Search engineer. Depends on SR1 and on the projects track's PM-WP5 (the Reliability Index's
delivery-efficiency measure).

CONTEXT:
  - Ruling: a freelancer's current Workload Intensity load and the Reliability Index's data-based
    efficiency measure both weigh heavily in search (Decision #338, ruling P4; the owner: "both
    should play a large factor in the search engine"). $W_i$ stays the per-ticket load built from
    difficulty, with no CREATE weights. The efficiency measure (estimated against actual time, the
    requested deadline against delivery, the slowdown across concurrent projects) extends $R_i$,
    and sits at a baseline until enough data exists.
  - Today workload enters through Availability with coefficient 1.50 (finance-model.md §16.7), and
    §16.3's score already counts "$W_i$ reliability 10". PRODUCT_SPEC.md:2793-2795 and
    finance-model.md:758-762 and :881 mark the efficiency half **Not built yet**.
  - This prompt does not depend on whether project_stages.create_category is stored as a label
    (still open, #338 P4): ranking never reads it.

🧑 DECISION — STOP before seeding values. Put this to me:
  Option A (recommended): keep workload at 1.50 and add reliability_efficiency at 1.75, equal to
  the largest positive coefficient (review_sentiment), so that "large" means as strong as reviews.
  A freelancer at the baseline scores the median, never zero, so a newcomer is not punished for
  having no history.
  Option B: workload 2.00 and efficiency 2.00 (both above reviews).
  Option C: name your numbers.
  Read the efficiency measure from wherever PM-WP5 has merged it (org.entity_standing.components
  or a column of its own); do not invent a shape.

FILES (after the ruling):
  - supabase/migrations/00005050_seed_reference_data.sql (the search.search_weights row, and
    workload's value if it changes)
  - packages/backend/services/explore/{ranking.ts, live-catalog.ts (the read of the measure)} +
    ranking.test.ts
  - documentation: finance-model.md §16.7 (the coefficients; remove "the coefficients are not set
    yet") and §16.3 if PM-WP5 left a marker; PRODUCT_SPEC.md:2793-2795 (remove the marker)

STEPS:
  1. ranking.ts reads reliability_efficiency from search.search_weights (the key list at :35) and
     adds the measure to the quality score as a normalised term (0..1, with the baseline at 0.5).
     The penalty rule is unchanged: it is never scaled by Standing.
  2. The catalogue read carries the measure for each freelancer and team (for a team, the mean of
     its active members, the way team workload already works: search.fn_team_live_workload).
  3. Seed the ruled coefficients. An admin can still tune them live (search.fn_set_weight).

SAME CHANGE: finance-model §16.7 and the PRODUCT_SPEC marker; the seed edited in place.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each announcing its resets; finish with your own clean
`deno task test:probes:fresh`. Never beside SR3 (00005050).

ACCEPTANCE: in ranking.test.ts, two freelancers equal in every input but efficiency rank in
efficiency order; a freelancer with no history ranks between them; a penalty still dominates; and
changing the coefficient in the weights fixture moves the order without a code change.
```

---

## 5. Last — Docs

### Z1 — Comms, notifications and search docs sweep, and the audit status

```text
PROMPT Z1: Comms, notifications and search docs sweep

ROLE: Documentation steward. Docs only; no code. Runs after every prompt above has merged.

CONTEXT:
  - Rulings: end-to-end encrypted chat is Planned after MVP, with encryption at rest now (Decision
    #339, the P3 row on flag (j)); an SSE stream follows the long-poll later (ruling N2). Each
    prompt above already updated the docs its own change touched (the same-change rule); this
    sweep closes what is left and records status.
  - Each built rule's **Not built yet** marker was removed by the prompt that built it; a marker
    that remains must name its prompt or its open 🧑 (§0 "Open decisions").

FILES: documentation/database/{comms,search}/*; business/PRODUCT_SPEC.md (§Messaging E,
§Notifications, §Reputation & Discovery, the in-app-only bullet :95-97, the sitemap row :3714,
:3881-3882); business/finance-model.md §16.7; PRODUCT_MANAGEMENT.md (the Notification delivery,
Scheduled notification and Inbox folder rows); architecture/SYSTEM_ARCHITECTURE.md (§The
Notification Engine, §Caching Strategy, §Discovery, the end-to-end encryption passages :685-686 and
:2705-2706, the env contract); architecture/ROUTING.md; api/EXTERNAL_PROVIDERS_AND_
INFRASTRUCTURE_SPECIFICATION.md (§3.2's push row, §3.4, §8, §10, §11);
architecture/COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md (a Status column on §8: Fixed by <prompt>, or
Open with an owner); the #339 decision row (each flag Resolved with its ruling and prompt, or Open
with an owner).

STEPS:
  1. Rollup, not restatement (documentation/CLAUDE.md rule 2): link to the source of truth instead
     of copying it.
  2. Mark SYSTEM_ARCHITECTURE's end-to-end encryption passages **Planned** after MVP, and state what
     is true now: the server reads messages by design, because the Tier 2 mask, previews, search
     and dispute evidence need the text, and Supabase encrypts the database at rest. Mark an SSE
     stream for typing and presence **Planned** (ruling N2).
  3. Check that every **Not built yet** marker a prompt above built is gone, and that every
     remaining one names its prompt or its open 🧑.
  4. Add the CAS §8 status column and resolve each #339 flag (with its ruling and prompt) or leave
     it Open with an owner. List this file's §0 "Not written here" items as Open with no owner,
     unless another track's file claims them.

ACCEPTANCE: grep -n "Not built yet" PRODUCT_SPEC.md finance-model.md shows no #339 or #338 P4
marker for built work; the CAS §8 status column has no blank cells; every function and trigger
named in MS1–SR4 appears in documentation/database/{comms,search}/*.
```
