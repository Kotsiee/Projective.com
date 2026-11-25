# Comms Build Prompts — Claude Code Work Orders for Messaging, Notifications, Delivery & Discovery Search

> **Status: WORK ORDERS, not binding.** Self-contained Claude Code prompts for Wave 2 **track M**
> ([`FOUNDER_QUESTIONNAIRE.md`](FOUNDER_QUESTIONNAIRE.md) Part B §B.3): messaging, notifications,
> outbound delivery and discovery search. They close the open findings of
> [`COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md`](COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md) (CAS `M*`, `N*`,
> `S*`, `D*`) and the open rows of [`PRODUCTION_READINESS.md`](../readiness/PRODUCTION_READINESS.md)
> §E (§0.1), under the owner's rulings on **Decision #339** (N1–N4 and the P3 rows).
>
> **Verified against code 2026-11-23 at `f2e25929`.** 7 open, 1 partly done, 9 done (§0 ledger).
> Runnable now: MS3, MS4, NT5, and SR3 up to its 🧑 stop (MS4 and NT5 share `00005010`: one at a
> time).
>
> **This file holds open work only.** A session that runs a prompt prunes it here when it finishes
> (§1's closing duty; [`build-prompts.md`](../reference/build-prompts.md) §2).
>
> Paste each prompt into its **own fresh session**, after the standard header (§1). Every prompt
> cites its evidence by finding ID and its ruling as `(Decision #NNN, ruling X)`. **Prompt IDs** are
> `MS*` (messaging), `NT*` (notifications), `SR*` (search) and `CD*` (delivery; merged in from the
> retired `COMMS_DELIVERY_BUILD_PROMPTS.md`), so that they never read as the audit's `M*` / `N*` /
> `S*` findings or as the questionnaire's rulings N1–N4.
>
> **A prompt marked 🧑 DECISION stops** and puts the named question to a human before it changes
> behaviour, with the options and a recommendation; §0.3 lists every open stop. Migrations are
> **edited in place** (root `CLAUDE.md` §1), and every prompt names the category file it edits.
>
> **Roadmap note: end-to-end encrypted chat is Planned after MVP** (Decision #339, the P3 row on
> flag (j)). Nothing here builds it. The server reads messages by design, because the Tier 2 mask,
> previews, search and dispute evidence need the text, and Supabase encrypts the database at rest.
> Z1 marks SYSTEM_ARCHITECTURE's two end-to-end encryption passages Planned.

---

## 0. Run order & dependencies

### 0.0 Done

Read a removed prompt with `git show <text at>:<path>`. The path is this file, except CD1, whose
text is in `documentation/readiness/COMMS_DELIVERY_BUILD_PROMPTS.md`.

| ID  | What landed                                                                                      | Commit                                                    | Text at    |
| :-- | :----------------------------------------------------------------------------------------------- | :-------------------------------------------------------- | :--------- |
| MS1 | `cht-` thread `ref`, the thread summary, `comms.inbox_tails`, project-stamped DMs                | `44382c08` (branch commit `bbcf3506` is not in this repo) | `f2e25929` |
| MS2 | One send door `sendMessage(actor, ref)`; `cht-` the only routed form; the project's DM group     | `4958c708` (#508; readiness `c33aef1f`)                   | `f2e25929` |
| NT1 | The engine obeys quiet hours, escalation, digests and collapse; `notify_engine.sql`              | `2f9a9bb6`                                                | `f2e25929` |
| NT2 | Fresh dispatch route on a Vault bearer, claimed deliveries, retry sweep (#344 (a))               | `ee275e93` (digest mail left as PRD-E15)                  | `f2e25929` |
| NT3 | Resend email transport, signed bounce webhook; a hard bounce blocks the address                  | `153f20d9` (transport `527b4cd6`)                         | `f2e25929` |
| NT4 | Web Push: VAPID transport, the device control, `sw.js` handlers, the manifest                    | `322c4dc9`, `a7ceeb92` (reaping is PRD-E18)               | `f2e25929` |
| SR1 | HNSW `ef_search` 200 + iterative scan, `search_path = ''`, unit-length guard; dead definers gone | `481aa59a`, `6f09b3ce` (+ T·E8 `dd4206d3`)                | `f2e25929` |
| SR2 | Bounded discovery query, per-caller embedding budget, hourly backfill job, Voyage key shape      | `1174c896` (+ T·W1 `bc805dff`)                            | `f2e25929` |
| CD1 | Newsletter double opt-in, one-click unsubscribe, Turnstile, Resend contacts sync (#480, #502)    | `2f0feffd`, `cc591846`                                    | `f2e25929` |

Left open by these, with no prompt here: #502 flag (d) (whether an opt-in made on Resend's
preference page counts; the owner's question), and the §E rows in §0.1's last line.

### 0.1 PRODUCTION_READINESS §E — row → work order

| Row     | Gate | Crit     | Work order | The row flips when                                                               |
| :------ | :--- | :------- | :--------- | :------------------------------------------------------------------------------- |
| PRD-E3  | MVP  | Critical | MS3        | ✅ when a message reaches a second browser in ≤ 2 s with no reload               |
| PRD-E4  | UAT  | Critical | CD2        | ✅ on CD2 (built locally: NT2)                                                   |
| PRD-E5  | UAT  | Critical | CD2        | ✅ on CD2 (built locally: NT3)                                                   |
| PRD-E6  | UAT  | Critical | CD2        | ✅ on CD2 (AU5 built it, #448; EPI §8.5 setup 4's hosted runbook, step 5)        |
| PRD-E7  | PROD | High     | CD2        | ✅ on CD2 (built locally: NT4)                                                   |
| PRD-E8  | PROD | Normal   | NT5 → CD2  | 🟡 on placeholders + callback tests · ✅ on CD2, once you hold the Twilio tokens |
| PRD-E9  | UAT  | High     | MS4 → MS5  | 🟡 on MS4 (`message.*` emitted) · ✅ on MS5 (mute, delete, reactions persist)    |
| PRD-E10 | PROD | High     | CD2        | ✅ on CD2 (built locally: NT3)                                                   |
| PRD-E11 | PROD | Normal   | CD2        | ✅ on CD2 (built locally: CD1)                                                   |
| PRD-E14 | PROD | Normal   | CD2        | ✅ on CD2, once `news.<domain>` is verified and `newsletter_mail_from` is set    |

**The flip rule.** A row that needs only the app and the database (E3, E9) is ✅ when its prompt's
acceptance passes locally. A row that needs a provider account or hosted configuration (E4–E8, E10,
E11, E14) is 🟡 when it is built and proved locally, and ✅ only when CD2 proves it on a hosted
project. PRD-E6, PRD-C15 and PRD-M3 set that precedent.

**What each tier needs from §E.** MVP needs MS3 (PRD-E3). UAT also needs MS4, MS5 and CD2's E4–E6
cases. Rows with no work order here: E15 (PROJECTS NO2 ✅, #565), E18 (PROJECTS NO3 ✅, #567) and E16 (none yet);
PRD-E13 and E17 closed with PROJECTS CH3 (#560).

### 0.2 Run order

| Phase                       | Prompts              | Why this order                                                                                                                                                                      |
| :-------------------------- | :------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **2 — Live**                | MS3 (partly: step 2) | The long-poll addresses a chat by MS2's `cht-` refs, and step 3 bumps the version keys from MS2's one door (ruling N2).                                                             |
| **3 — Notifications**       | NT5 → CD2            | CAS §2.5's order ends with SMS (ruling N3). CD2 then proves every outbound channel on a hosted project.                                                                             |
| **3b — Chat on the engine** | MS4 → MS5            | MS4 emits `message.*` into the fixed engine, with `cht-` links. MS5 makes every chat control persist, mute first (ruling N3 (d)).                                                   |
| **4 — Search**              | SR3; SR4             | SR3 stops for its weight; its version-key wait is met (RED WP10a). SR4 waits for the projects track's efficiency measure and stops for its coefficients (Decision #338, ruling P4). |
| **Last**                    | Z1                   | Docs sweep, the end-to-end encryption roadmap marker and the CAS status column.                                                                                                     |

**The SQL lane.** Every open prompt except CD2 and Z1 edits `supabase/migrations`, so each counts
against Part B §B.0's cap of two SQL sessions on the one local DB, a cap shared with every other
track.

| Prompt | Migration files it edits (in place)                              |
| :----- | :--------------------------------------------------------------- |
| MS3    | `00002600`                                                       |
| MS4    | `00001300`, `00001840`, `00005010`                               |
| MS5    | `00000016`, `00001300`, `00002510` (and `00001840` if a trigger) |
| NT5    | `00005010`                                                       |
| SR3    | `00001400`, `00002510`, `00005050`                               |
| SR4    | `00005050`                                                       |

**Waves.**

| Wave | SQL slot A                                   | SQL slot B                                   | App lane               | Starts when                                                                                   | §E rows that flip       |
| :--- | :------------------------------------------- | :------------------------------------------- | :--------------------- | :-------------------------------------------------------------------------------------------- | :---------------------- |
| 1    | **MS4** (`00001300`, `00001840`, `00005010`) | **MS3** (`00002600`)                         | —                      | now                                                                                           | E3 ✅ · E9 🟡           |
| 2    | **NT5** (`00005010`)                         | **MS5** (`00000016`, `00001300`, `00002510`) | —                      | NT5: MS4 merged · MS5: MS3 and MS4 merged                                                     | E8 🟡 · E9 ✅           |
| 3    | **SR3** (🧑 3)                               | —                                            | **CD2** (no migration) | SR3: any free slot, never beside MS5 or SR4 · CD2: NT5 merged and §0.3's hosted prerequisites | E4–E8, E10, E11, E14 ✅ |
| 4    | **SR4** (🧑 4)                               | —                                            | —                      | PM-WP5b merged                                                                                | —                       |
| Last | —                                            | —                                            | **Z1** (docs)          | every prompt above merged                                                                     | —                       |

NT5 may take MS4's slot in wave 1 instead (never beside it: `00005010`). MS4 goes first because
PRD-E9 is UAT · High and PRD-E8 is PROD · Normal. Run MS5 right after MS4: until MS5 step 1, nothing
on `/messages` writes `is_muted`, so MS4's quiet muted threads hold only for mutes made elsewhere.

These cannot run in parallel because they edit the same files:

- MS4 / MS5 (`00001300`, `00001840`) · MS4 / NT5 (`00005010`) · SR3 / SR4 (`00005050`) · MS5 / SR3
  (`00002510`)
- MS3 / MS5 (`MessagingBackendService.ts`, `MessagingService.ts`, `ChatFeed.island.tsx`, the
  messaging sidebar islands)
- NT5 / SR3 (`features/devtools` and `apps/web/utils/dev-seam.ts`, only if NT5 touches the
  `notificationDelivery` axis)

**Cross-track file conflicts** (the §B.0 hot files first):

- **`00001300` (comms).** The trust track's P2 hardening (SEC L7 masking, L8 categories) never runs
  beside MS4 or MS5. MS5 closes L7's reaction half by construction, so the trust track's L7 prompt
  skips `comms.message_reactions`.
- **`00002510` (grants).** One writer at a time across all tracks. Here: MS5 and SR3.
- **`features/devtools` + `dev-seam.ts`.** SR3 here (and NT5 only if it edits the axis); other
  tracks' axis-adding steps elsewhere.
- **`00005010` (the notification catalog).** Several tracks add rows to it (C·WP3 notices, F·DB4's
  schedule-failure notice, P·WP1's claim-TTL notices; EX2's landed, #548; PROJECTS NO1's, #566; EX1 needed none, #569; PROJECTS FL4's, #570). One writer at a
  time; here MS4 → NT5.
- **The shared cache primitives (RED WP10a, landed `7f6b43d5`).** MS3 consumes the KV version keys
  (`bumpCacheVersion`, `cacheVersion`, `cacheVersionTag` in `packages/backend/core/kv.ts`) and SR3
  `cachedGlobal(key, ttlMs, fetch)` from the same file. No prompt here edits `core/cache.ts`.
- **`MessagingBackendService.ts`, `conversations-ssr.ts`, `live-queries.ts`,
  `ChatFeed.island.tsx`.** MS3 and MS5 here; T&S R2 elsewhere (one at a time;
  PROJECTS CH4 landed, #559; CH3 landed, #560; CH1 landed, #562).
- **`00001400`, `00002510` and the `search` schema.** The identity track's erasure (SEC G16, CAS
  S17) and the trust track's search grants and policies (SEC G13–G15, T&S P2d step 5) never run
  beside SR3.
- **`00000016` (`comms.dm_threads`).** The trust track's P2b adds `marketplace_window_until`, and
  never runs beside MS5.
- **`services/explore/live-view.ts`.** The "Similar" rail's cache (RED D-17) is the optimisation
  track's; SR3 does not touch it.
- **`packages/backend/core/env.ts`, `env-manifest.ts`, `.env.example` and SYSTEM_ARCHITECTURE's
  Environment Variable Contract.** NT5 appends keys, and so do other tracks: pull first, append
  only.
- **No prompt here edits the other §B.0 hot files:** `00001240` (finance money), `00001155`
  (sessions), `00001020` (workspaces), `00001060` (erasure), `stripe-webhook.ts` + `00001230`, and
  `live-wallet.ts` / `wallet-scope.ts`.

**Cross-track waits** (⏳ = waits for):

- O·RED WP13 (D-08, the chrome endpoint, which folds in `/api/notifications/summary`'s 30 s poll) ⏳
  **MS3**'s long-poll. This file does not build it.
- SR4 ⏳ PM-WP5b (`PM_BUILD_PROMPTS.md`, the Reliability Index's efficiency measure; Decision #338,
  ruling P4).
- CD2 ⏳ NT5, and a hosted staging project (the staging slice of PRD-G8, ❌ today).

### 0.3 Open decisions and human stops

| #    | Question                                                                                                                          | Stops                         | Recommendation                                                          |
| :--- | :-------------------------------------------------------------------------------------------------------------------------------- | :---------------------------- | :---------------------------------------------------------------------- |
| 🧑 3 | The context-aware ranking weight. A ranking rule changes who earns, so it is a business rule                                      | SR3, before any order changes | 0.25 on signed-in recommended orders, from 5 interest events in 90 days |
| 🧑 4 | The $W_i$ and Reliability Index coefficients (Decision #338, ruling P4)                                                           | SR4                           | Workload 1.50 (unchanged), efficiency 1.75, a newcomer at the median    |
| 🧑 5 | Owner gate, not a build stop: Voyage's written no-training terms before `EMBEDDINGS_ENABLED` (Decision #339 (d); #340, ruling T5) | Nothing in code               | Never switch it on in a committed file                                  |

**Hosted (CD2's 🧑 PREREQUISITES).** A hosted staging Supabase project and a deployed app at a
public HTTPS origin (the staging slice of PRD-G8). You set every secret and every dashboard setting
yourself:

- Vault: `CRON_APP_URL` and `COMMS_DISPATCH_SECRET`, written by
  `deno task cron:vault --env-file <file>` (OPS1, #514 (g)), and the `comms.dispatch_webhook` flag
  on.
- Resend: `notify.<domain>` and `news.<domain>` verified, with SPF, DKIM, Return-Path and DMARC (EPI
  §8.5 setup 1–3). Also `RESEND_API_KEY`, `MAIL_FROM`, and the webhook endpoint
  `https://<origin>/api/comms/webhooks/resend` with its secret as `RESEND_WEBHOOK_SECRET`.
- GoTrue: EPI §8.5 setup 4's hosted runbook (SMTP, Site URL, templates, rate limit).
- Push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- Text (when you have them): the three Twilio keys, a Messaging Service, geo-permissions limited to
  launch markets, and the status callback `https://<origin>/api/comms/webhooks/twilio`.
- The newsletter (CD1 Option A, #502; EPI §8.5 setup 8's runbook): in Resend, create the segment and
  the topics `General` and `Changelog` (default subscription opt_out), and add the four `contact.*`
  events to the webhook. In `security.platform_params`, set `newsletter_provider_segment_id`,
  `newsletter_provider_topic_ids` and `newsletter_mail_from`. Then turn the
  `newsletter.provider_sync` flag on.

No agent types, pastes or echoes a secret, and no agent changes a hosted setting. **Twilio tokens**
(#339 flag (n)): you obtain them; PRD-E8 stays 🟡 until then.

### 0.4 Notes for the coordinator

- No prompt here depends on Wave 1's other open items: whether `project_stages.create_category` is
  stored as a label (#338 P4; ranking never reads it), Agency and Enterprise storage (#252 S2), the
  FX margin (#337 M5), the Agency contract-rate fee (#252 against #187), or any ⚖️ item.
- RED D-27 (encode `(created_at, id)` in the message cursor) is listed under this track by the
  optimisation file, but MS3 declines it: the code keeps a message-id cursor on purpose, because a
  JavaScript timestamp loses the microsecond precision the keyset needs (`live-queries.ts`
  §Cursors). Record it as declined, not as owned.
- A reading applied, not a stop: a one-to-one conversation deleted for oneself returns with the next
  incoming message, while a group or an entity channel never does (MS5, which writes the rule into
  PRODUCT_SPEC).
- Not written here, because they are outside §B.3's track M row: CAS M11 (edit or delete one's own
  message, with a re-mask), M18 (voice-memo drift), M21 (Zod on the messaging GET routes), N4/N5
  (payload hygiene and legacy keys: #336 (e), #57 (a)), N7 beyond `message.*`, S21 (lexical
  relevance), S33 (the jobs session seeded `search-query-log-retention` dormant until the identity
  track writes `search.fn_prune_query_logs`; SEC G13 is the trust track's P2d), CAS §3 (F1–F33:
  files, streaming and the inspector) and D4 (the asset picker's `--fw-bold` title,
  `features/files/styles/asset-picker.css:115`, still open). Z1 lists each one as Open with no
  owner, unless another track's file claims it (PROJECTS CH1 closed M11, #562).

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
     PROJECTIVE_REDUNDANCY_AND_OPTIMIZATION_AUDIT.md (RED, with ADC Q7, Q8, Q11 in
     its §2) and documentation/api/EXTERNAL_PROVIDERS_AND_
     INFRASTRUCTURE_SPECIFICATION.md (EPI §3, §5, §8).
  3. Read the OWNER RULINGS on Decision #339 in full (rulings N1–N4 and the P3 rows):
     grep -n '^| 339 |' documentation/reference/decisions/decisions-122-126.md. Then read the rows
     your prompt cites (#335, #338, #340, #341, #343), and grep documentation/reference/decisions/
     README.md for the surface you touch. At minimum also read #10, #88, #147, #148, #156, #173,
     #179, #180, #203, #204, #306 and #308.
  4. Read documentation/database/{comms,search}/{Tables,Functions,Policies}.md for the objects you
     change, and documentation/architecture/FOUNDER_QUESTIONNAIRE.md Part B §B.0 (hot files).
  5. Read documentation/architecture/COMMS_BUILD_PROMPTS.md §0 (run order, locks, stops, and the
     PRODUCTION_READINESS §E rows §0.1 maps to your prompt). File:line refs were last checked on
     2026-11-23 at f2e25929: re-check each against the current tree before relying on it; another
     track may have landed since.

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
    files. `deno task db:reset` is standing-approved; announce every run to the other sessions
    before you start it.
  - Reproduce first: a probe under supabase/probes/ wrapped in BEGIN … ROLLBACK (or a Deno unit
    test). Run probes with `deno task test:probes`.
  - Finish with your own clean `deno task test:probes:fresh` (it resets, then runs every probe),
    with no other session resetting during that run.

Verification: `deno task check`, `deno task lint`, `deno task test:unit` (the theme-engine
failures are pre-existing, Decisions #96 (a) and #157 (m): compare any red test with main before
calling it yours), and `deno fmt` on the files you touched only, never a directory. Docs are CRLF in
the working tree: edit them with the editor tools, never sed, and judge `deno fmt --check` on an LF
copy. A packages/* edit needs a dev-server restart (no HMR). For a UI prompt also run
`deno task dev`, sign in as the seeded personas (documentation/database/Seed.md) and capture 1440,
900 and 390 px screenshots in light, dark, data-contrast="high" and data-motion="reduced".
This checkout may be shared with other sessions: never switch branch, never stash, and stage only
your own hunks. Commit on the branch you were given with a clear message; do not push, and do not
open a PR unless I ask.

Readiness (Decision #444): in the same change, update documentation/readiness/
PRODUCTION_READINESS.md: the §E row(s) that §0.1 maps to your prompt (status, and evidence naming
your commit and decision); recompute the §E line and the three tier rows of the Scoreboard (score =
Σ weight × credit / Σ weight; ✅ 1 · 🟡 0.5 · ❌ 0; Critical 3 · High 2 · Normal 1; ⏸ rows
excluded); add one line to §Score history. The flip rule (§0.1): a row needing a provider account
or hosted config is 🟡 when built and proved locally, ✅ only on CD2. Update USER_FLOWS.md if a
flow's status changes. A gap you find and do not fix gets a new row at the end of §E, never silence.

When you finish, do the closing duty (documentation/reference/build-prompts.md §2) in the same
commit as the work:
  - In documentation/architecture/COMMS_BUILD_PROMPTS.md: a done prompt leaves the file. Delete its
    section and add its row to §0's Done ledger (ID · what landed · commit · text at <commit>^). A
    partly done prompt keeps only its open steps, with their numbers unchanged, under one rewritten
    Status line. A ruled 🧑 stop becomes the ruled step, with its decision number.
  - Treat any step you built for another prompt the same way, in the file that holds it.
  - Run git grep -n "<ID>" documentation/ and update every place that still calls it open: the
    PRODUCTION_READINESS / USER_FLOWS Track cells, the audit's Status column, other prompts' waits,
    and this file's row in documentation/reference/build-prompts.md §3.
  - If the file has no prompts left, delete it, log it in build-prompts.md §4 and repoint its links.
```

---

## 2. Messaging

### MS3 — Live updates: an ETag long-poll, KV version keys, comms out of Realtime

> **Status 2026-11-23:** step 2 landed in `7f6b43d5` (O·WP10a's version keys in
> `packages/backend/core/kv.ts:156-184`, with the `["messaging", userId]` scope under test); steps 1
> and 3–6 below are open (`00002600:10-18` still publishes the five comms tables; there is no
> `since` route). Its waits are met (MS2 `4958c708`, SAC3 `f52a8502`). Unverified: a 2026-11-19 run
> on `claude/ms3-live-chat` (PROJECTS §0.2) left no branch in this repo; check `git branch -a`
> first. Since PROJECTS CH1 (#562) a message also changes in place: `edited_at`, or a `deleted_at`
> tombstone whose body is empty (`comms.edit_message`, `comms.delete_message`). The long-poll must
> carry those changed rows to the other readers, not only new ones; today they see an edit or a
> delete on their next load.

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
  - This also unblocks RED WP13 (D-08: the chrome endpoint, invalidated on profile and preference
    writes, which will fold in /api/notifications/summary's 30 s poll, #173). Do not build it
    (optimisation track), and leave the notification summary poll as it is.
  - The KV version keys are RED WP10a's, landed in packages/backend/core/kv.ts: bumpCacheVersion,
    cacheVersion and cacheVersionTag over openSharedKv(). With no KV they are no-ops and callers
    fall back to their TTL. The version rides in the ArcCache key, so core/cache.ts is NOT edited.
    The scopes this prompt uses: ["messaging", userId] and ["thread", ref] (a room's scope is its
    channel id).

FILES:
  - supabase/migrations/00002600_permissions_realtime_publication.sql (remove the five comms
    tables; the projects.* tables stay)
  - packages/backend/core/kv.ts (read only: the version keys and openSharedKv)
  - packages/backend/services/messaging/{MessagingBackendService.ts, live-queries.ts}
  - packages/types/messaging/* (the since response)
  - apps/web/routes/api/messaging/since.ts (new, thin)
  - apps/web/features/messaging/core/MessagingService.ts; apps/web/features/projects/islands/
    ChatFeed.island.tsx; apps/web/features/messaging/islands/MessagesSidebar.island.tsx; a chat
    sound under apps/web/static/ (≤ 10 KB) if none exists
  - supabase/probes/comms_realtime_publication.sql (new)
  - documentation: SYSTEM_ARCHITECTURE.md (§The Notification Engine, the Realtime sentence near :2778; one paragraph on
    version keys in §Caching Strategy, which the optimisation track's SA rewrite keeps),
    database/comms/Tables.md (:19 and :128), ROUTING.md (the since route), PRODUCT_SPEC.md
    (:4668-4669, "no message reaches an open page live yet")

STEPS:
  1. Publication: delete the five `ALTER PUBLICATION supabase_realtime ADD TABLE comms.*` lines in
     place. The probe asserts that pg_publication_tables lists no comms table.
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
     (live-queries.ts, #region Cursors) explains the microsecond precision it protects; RED D-27 is not
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
     paragraph joins SA §Caching Strategy. PRODUCT_SPEC:4668-4669 says that messages reach an open
     page through the poll.

SAME CHANGE: ROUTING.md (the new endpoint); database/comms docs; SYSTEM_ARCHITECTURE; PRODUCT_SPEC.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each announcing its resets; finish with your own clean
`deno task test:probes:fresh`.

ACCEPTANCE:
  - comms_realtime_publication.sql: no comms table in supabase_realtime; the projects tables are
    unchanged.
  - A route test (with a short hold): a matching If-None-Match and no write → 304 after the hold; a
    bump during the hold → 200 with the new message; a non-participant → 404.
  - Two browsers (two seeded personas; deno task dev with --unstable-kv): a message sent in one
    appears in the other within 2 s, without a reload; with KV off, within 6 s. Two timestamped
    screenshots.
```

### MS4 — Message notifications: `message.new` and `message.mention`; muted threads stay quiet

> **Status 2026-11-23:** open and runnable now: MS1, NT1 and MS2 have landed, so the
> `'/messages/' || ref` links resolve. No `tg_notify_message` or `fn_channel_reader_ids` exists yet.

```text
PROMPT MS4: Message notifications — message.new and message.mention, and muted threads stay quiet

ROLE: Postgres and backend engineer. Depends on MS1 (the cht- refs) and NT1 (the fixed engine).

CONTEXT:
  - Findings: CAS §2.1 (the message.* types have 0 callers); CAS N7 (the catalog templates build
    uuid links: the message.* rows use /messages/{entity_id}, 00005010:68-70); CAS D1 (the New
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
  - Say plainly in the commit and the readiness evidence that mutes made on /messages are honoured
    only from MS5 step 1 on: until then its islands keep them in local storage
    (ConversationHeader.island.tsx, InboxView.island.tsx, MessagesSidebar.island.tsx), and nothing
    there writes is_muted.
```

### MS5 — Chat actions persist: mute everywhere, delete for me, reactions; dead switches go

> **Status 2026-11-23:** open; ⏳ MS3 (the same islands and service) and MS4. Step 1's star half
> landed outside this prompt (star is server state through the saved system, Decision #180), so step
> 1 is mute only. Nothing writes `dm_participants.deleted_at`, `set_dm_deleted` does not exist, and
> reactions are read (`projects/live-messages.ts`) but written nowhere (`ChatFeed.island.tsx`).

```text
PROMPT MS5: Chat actions persist — mute everywhere, delete for me, reactions; dead switches go

ROLE: Full-stack engineer (comms doors and islands). Depends on MS3 (the same islands and service)
and MS4 (the reaction notice reuses its emitter). MS2's ref-addressed doors have landed.

CONTEXT:
  - Ruling: chat mute persists server-side (Decision #339, ruling N3 (d)); Decision #308 flag (a)
    (/messages still mutes in localStorage).
  - Findings: CAS M12 (Delete is localStorage only, and dm_participants.deleted_at has no writer);
    M13 (mute and delete are local-storage prefs on /messages, LocalKeys.CONVERSATION_PREFS through
    readStored/writeStored: ConversationHeader.island.tsx:66-77 and :128-143, InboxView.island.tsx
    :186 and :304-329, MessagesSidebar.island.tsx:104-106, :261, :323-329 and :395-415); M16 (reactions are optimistic and local,
    and comms.message_reactions is never written); D1 and D2 (§3.11: controls that do nothing); D3
    (a literal backdrop-filter: blur(12px) on the desktop pop-out composer,
    features/messaging/styles/chat-popout.css:156-157).
  - SEC L7 lists the reaction `emoji` as 16 characters of unmasked free text. Pinning reactions to
    one emoji set closes that half by construction; tell the trust track's L7 prompt that it can
    skip comms.message_reactions.

FILES:
  - supabase/migrations/00000016_tables_comms.sql (comms.message_reactions.emoji CHECK, :432-455)
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
  - apps/web/features/settings/components/sections/MessagingSection.tsx (the Read receipts and Typing indicator switches, :106-121)
  - supabase/probes/chat_actions.sql (new)
  - documentation/database/comms/*; ROUTING.md (the new routes); PRODUCT_SPEC.md §Messaging E (the
    delete rule)

STEPS:
  1. Mute: the /messages header, the inbox rows and the sidebar call MessagingService.setMuted (the
     existing door: comms.set_dm_muted). Delete the CONVERSATION_PREFS mute and delete overlays in
     all three islands; the rows read muted from the server projection (live-queries.ts).
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
  - grep -rn "localStorage\|CONVERSATION_PREFS" apps/web/features/messaging finds no mute or
    delete state.
  - Screenshots: the Messaging settings section without the two hidden switches, and the pop-out
    composer, at 1440 and 390.
```

---

## 3. Notifications

### NT5 — SMS through Twilio: built now on placeholder keys; the switch shows only when configured

> **Status 2026-11-23:** open and runnable now (NT2 and NT4 have landed; never beside MS4,
> `00005010`). No Twilio transport exists; `dispatch-transports.ts:57` still says "SMS (NT5) is
> still to come".

```text
PROMPT NT5: SMS through Twilio — built on placeholder keys; the switch shows once it is configured

ROLE: Backend engineer. Its waits, NT2 and NT4, have landed.

CONTEXT:
  - Ruling: build everything Twilio needs now, with XXXX-XXXX placeholders, while the owner obtains
    the tokens; the SMS switch renders only once Twilio is configured (Decision #339, the P3 row on
    flag (n); root CLAUDE.md §3.11).
  - Findings: CAS §2.1 (SMS is in 0 of 112 catalog rows); §2.3; §2.5 step 5 (SMS last, and only
    for security alerts and session-starting-now reminders, because of per-message cost and
    SIM-swap exposure); D5 (SMS rendered as a selectable transport that can never send). ST2 rewrote
    NotificationsSection.tsx: the SMS column renders today with "nothing is sent yet" copy drawn
    from the liveness map (data.delivery, services/comms/channel-liveness.ts, which reads the
    transport registry). EPI §8.6: the Messaging Service, status callbacks verified with
    X-Twilio-Signature, geo-permissions. supabase/config.toml's [auth.sms.twilio] (:394) scaffolds
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
  - apps/web/features/settings/{components/sections/NotificationsSection.tsx,
    core/notifications-model.ts + its test} (no new settings
    field: the liveness map's data.delivery.sms is the smsAvailable this prompt asks for)
  - packages/backend/core/env.ts; .env.example (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and
    TWILIO_MESSAGING_SERVICE_SID = XXXX-XXXX; SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN at :123 leaves);
    packages/backend/core/env-manifest.ts (TWILIO_AUTH_TOKEN is planned("COMMS NT5") today: make
    the three keys live app entries, and drop the cli SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN entry);
    supabase/config.toml (the GoTrue block reads the same names; `enabled` stays false, because
    switching phone OTP on is the identity track's call)
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
  3. smsAvailable is data.delivery.sms, which flips once the Twilio transport registers (no second
     flag). The whole SMS ("Text") column and its master switch render only while it is true
     (#339 flag (n)); delete the "Nothing is sent by text message yet" copy
     (features/settings/core/notifications-model.ts:52) and its test line. A
     person with no confirmed phone sees the switch disabled, with the reason and a link to verify
     a phone (§3.11), but only once the identity track has shipped phone verification; until then
     the column does not render for them.
  4. Catalog: the four types above (and any other security-alert row) gain 'sms'. Record the rule
     in PRODUCT_SPEC §Notifications: a text message carries only a security alert, a session
     starting in minutes or a failed payout.
  5. Dev Context Switcher: no new axis. ST2's notificationDelivery axis already draws every channel
     live or off; check that it covers the SMS column.

SAME CHANGE: migrations edited in place (the seed) + the catalog contract test + database/comms
docs; PRODUCT_SPEC (the SMS rule and the marker); ROUTING; the env contract and env-manifest.ts.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each announcing its resets; finish with your own clean
`deno task test:probes:fresh`. Never beside MS4 or NT3 (00005010).

ACCEPTANCE:
  - sms_routing.sql: a new-device login for a user with a confirmed phone and SMS on → an sms
    delivery row, which stays inside quiet hours (overrides_quiet_hours); message.new never routes
    to sms.
  - With the placeholders, no SMS transport registers and the settings page shows no SMS column
    (notificationDelivery = auto); notificationDelivery = live shows it.
  - Callback tests: a bad signature → 400; a valid "delivered" → the delivery is delivered; a
    replay is a no-op.
```

### CD2 — The hosted delivery proof: every outbound channel sends for real on staging

> **Status 2026-11-23:** open; ⏳ NT5 and the hosted prerequisites (§0.3; PRD-G8 is ❌). NT2, NT3,
> NT4 and CD1 have landed. The owner deferred it twice (#484), and neither run built any of it. The
> `--check` gap is ruled (Decision #484, flags (a) and (c)) and written into FILES and step 1 below.

```text
PROMPT CD2: The hosted delivery proof — every outbound channel sends for real on staging

ROLE: Release / platform engineer. Runs after NT5 has merged (NT2–NT4 and CD1 have), against the
hosted STAGING project only. No migration. It writes one script and one bearer-guarded read, and
records one runbook pass. YOU (the owner) run the sends from your own terminal; this session reads
the output you paste.

CONTEXT:
  - The flip rule (COMMS_BUILD_PROMPTS.md §0.1): PRD-E4, E5, E7, E8, E10, E11 and E14 are 🟡 when
    built and proved locally, and this prompt proves each on a hosted project. PRD-E6's remainder
    is EPI §8.5 setup 4's hosted runbook, step 5 ("Prove it").
  - The hosted wiring is the owner's (§0.3, "Hosted"). Never type, paste, echo or log a secret, and
    never change a hosted setting. The script reports names, presence and shape only (the
    cron:vault rule: print names, never a value), and it prints ids, never addresses or tokens.
  - The script cannot see the hosted app's environment (RESEND_API_KEY, MAIL_FROM, the VAPID pair,
    the Twilio keys), so the app reports its own liveness (ruled: Decision #484). GET
    /api/comms/dispatch, behind the same constant-time COMMS_DISPATCH_SECRET bearer as the POST,
    answers deliverySources() (services/comms/channel-liveness.ts) as the dispatcher and each
    channel by name with ✓ / ✗ only. It also reports RESEND_WEBHOOK_SECRET and the Twilio callback
    token as present ✓ / ✗ (#484 flag (c)). Any other bearer gets the same 404.
  - Resend publishes test recipients for delivered, bounced and complained outcomes
    (…@resend.dev). Check its current docs for the exact addresses.

🧑 PREREQUISITES — STOP first and list, by name, everything in §0.3's "Hosted" list that the
--check mode cannot see yet. Run nothing else until I say they are set.

FILES:
  - scripts/delivery-smoke.ts (new) + `deno task smoke:delivery` with a $comment in deno.json
    (the smoke:stripe pattern; not part of `deno task test`). It reads its target only from
    variables I export in my own shell (DELIVERY_SMOKE_ORIGIN, DELIVERY_SMOKE_SUPABASE_URL,
    DELIVERY_SMOKE_SERVICE_ROLE_KEY, DELIVERY_SMOKE_INBOX, DELIVERY_SMOKE_PHONE, and
    DELIVERY_SMOKE_DISPATCH_SECRET, the bearer for the liveness read: #484 flag (a)), never from a
    file, and never prints one.
  - apps/web/routes/api/comms/dispatch.ts (the GET), features/notifications/core/dispatch-ssr.ts,
    a route test; documentation/architecture/ROUTING.md (the GET row)
  - documentation/api/EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md (§8.1, §8.2, §8.5,
    §8.6: each runbook step marked done on staging with the date; §10)
  - documentation/architecture/SYSTEM_ARCHITECTURE.md §Scheduled jobs (the comms Vault secrets)
  - documentation/readiness/PRODUCTION_READINESS.md and USER_FLOWS.md (the PJ rows of case g)

STEPS:
  1. `--check`: presence and shape only. The dispatch route answers 404 to a wrong bearer, and its
     GET answers the liveness map to the right one (every channel ✓ except sms until Twilio is
     set); /api/notifications/push/config answers 200; vault.secrets holds CRON_APP_URL and
     COMMS_DISPATCH_SECRET (names only, never decrypted_secrets); comms.dispatch_webhook is on;
     security.platform_params holds newsletter_provider_segment_id and
     newsletter_provider_topic_ids, and the newsletter.provider_sync flag is on (CD1 Option A). It
     prints a table of names with ✓ / ✗.
  2. `--send <case>`, each case printing ids only, and each waiting for my "seen" where a human
     must look:
     a. auth (PRD-E6): a recovery from /forgot-password for the test inbox and a password change →
        both branded emails arrive, DKIM passes, the reset link is /forgot-password?step=reset
        with no address in it, and the logo loads.
     b. dispatch (PRD-E4, E5): the service role calls comms.fn_notify for the test account with a
        mandatory type → its email delivery goes queued → sent within 60 s, then delivered through
        the Resend webhook. A forced transport failure is retried by comms-dispatch-sweep.
     c. suppression (PRD-E10): a throwaway account on the bounced test address → the address is
        suppressed for every category, exactly one account.email_undeliverable exists, and a second
        mandatory notice comes back 'suppressed'. The complained address → Marketing only.
     d. push (PRD-E7): I enable "Alerts on this device" in Chrome on the staging origin; a mandatory
        notice shows a system notification whose click opens the in-app path.
     e. sms (PRD-E8, only when Twilio is configured): a new-device login for the test account with
        a confirmed phone → one text carrying the title and the link, then a delivered callback.
     f. newsletter (PRD-E11, E14): subscribe the test inbox → one confirmation mail from
        news.<domain>; Confirm → confirmed, and the contact appears in the provider list; the
        mail's one-click unsubscribe → unsubscribed_at set.
     g. projects mail (USER_FLOWS PJ-17, 60, 61, 71, 72), each case once its prompt has merged: a
        stage.invite email and the mail to an address with no account (PROJECTS NO1 ✅, #566;
        that mail needs `project_invite_mail_enabled`, off until counsel), a schedule.event_invite email and push, an
        event.reminder_email, a digest (PROJECTS NO2 ✅, #565), and a guest invitation through the
        transport PROJECTS NO4 gives it.
  3. Flip each proved row to ✅ with the date, "staging" and the smoke run's ids. A case that
     could not run keeps its 🟡 and says what is missing. Production repeats EPI §8.5 setup 4 and
     `smoke:delivery --check` as part of PRD-G8's go-live: write that line into EPI §8.5.

ACCEPTANCE:
  - `smoke:delivery --check` prints no ✗ on staging (sms excepted until Twilio is live).
  - A route test: GET /api/comms/dispatch with a wrong bearer → 404; with the right one → names and
    ✓ / ✗ only, no value.
  - Every case that ran has its ids in the readiness evidence.
  - None of CD2's §0.1 rows is ❌ (PRD-E8 may stay 🟡 until Twilio is live).
```

---

## 4. Discovery search

### SR3 — 🧑 DECISION · Context-aware ranking for signed-in viewers, and the pgvector result cache

> **Status 2026-11-23:** open and runnable now, to its 🧑 stop. It no longer waits for MS3: the KV
> version keys and `cachedGlobal` landed with RED WP10a (`7f6b43d5`, `core/kv.ts`), and the
> catalogue scope is bumped since WP3b (`live-catalog.ts:577`). SR1 has landed. The hook region is
> still empty (`ExploreBackendService.ts:420-421`).

```text
PROMPT SR3: Context-aware ranking for signed-in viewers, and the pgvector result cache

ROLE: Search engineer (Postgres and backend). Its waits (SR1; the KV version keys) are met.

CONTEXT:
  - Ruling: context-aware ranking and the pgvector KV cache are built now, not Planned (Decision
    #339, the P3 row on flag (c)). SA:2347-2350 describes context-aware ranking, SA:849-850 calls
    user vectors "the separate ranking-v1 task", and SA:3028 says pgvector results "can be cached
    in Deno KV". PRODUCT_SPEC:2791-2792 marks it **Not built yet**.
  - Findings: CAS S25 (an empty personalisation hook region:
    services/explore/ExploreBackendService.ts:420-421, "user vectors re-rank the personal rails");
    S24 (offset paging over a list recomputed per request); ADC Q11 (viewer-scoped data stays in
    the tenant memory tier, KV holds only small global values, and raw text is never a key: EPI
    §3.5 rule 7). The /view "Similar" rail's cache (RED D-17, services/explore/live-view.ts) is the
    optimisation track's anonymous-tenant cache; do not touch it here.
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
    ranking.ts, personalise.ts} + tests; packages/backend/core/kv.ts (read only: RED WP10a's
    cachedGlobal and the version keys, the catalogue scope)
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
     ExploreBackendService.ts:420 hook region), and, under Option A, ExploreBackendService blends
     the similarity into signed-in recommended orders with search.search_weights 'context_affinity'
     (seeded at the ruled value). The result is cached per tenant, in memory only (ArcCache, 5
     minutes).
  3. The pgvector KV cache (SA:3028): a search's resolved neighbours (ids and scores, never
     vectors) are stored through cachedGlobal(key, ttlMs, fetch) under ["cache","nearest",model,
     dims,catalogueVersion,category,sha256(normalised query)] for 15 minutes, behind the existing
     per-isolate LRU (similarity-cache.ts), so every isolate shares one fn_nearest call per query.
     The catalogue version comes from the KV version keys (live-catalog.ts bumps CATALOG_VERSION
     since WP3b); with no KV the TTL governs. Every hit is still re-resolved against the anon
     catalogue, so a stale entry can cost relevance, never visibility. Values stay under 64 KiB.
     Context results never go to KV.
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
`deno task test:probes:fresh`. Never beside SR4 (00005050), MS5 or another 00002510 writer, or
another track's 00001400 writer.

ACCEPTANCE:
  - context_ranking.sql: as viewer A (claims set, then SET LOCAL ROLE authenticated) with 6 clicks
    on design services, the nearest rows lean to design; a viewer with 2 events gets no rows; anon
    is refused; no column of the result is a vector.
  - A unit test: two identical searches through two service instances that share one KV make one
    fn_nearest call; a different category is a miss.
  - A semantic page 1 and a heuristic page 2 return disjoint, contiguous slices of one order.
```

### SR4 — 🧑 DECISION · Load and reliability weigh heavily in ranking

> **Status 2026-11-23:** open; ⏳ PM-WP5b (`PM_BUILD_PROMPTS.md`), which has not landed, so no
> efficiency measure exists to read. Stops at 🧑 4 before seeding values.

```text
PROMPT SR4: Load and reliability weigh heavily in ranking

ROLE: Search engineer. Depends on the projects track's PM-WP5b (the Reliability Index's
delivery-efficiency measure). SR1 has landed.

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
  Read the efficiency measure from wherever PM-WP5b has merged it (org.entity_standing.components
  or a column of its own); do not invent a shape.

FILES (after the ruling):
  - supabase/migrations/00005050_seed_reference_data.sql (the search.search_weights row, and
    workload's value if it changes)
  - packages/backend/services/explore/{ranking.ts, live-catalog.ts (the read of the measure)} +
    ranking.test.ts
  - documentation: finance-model.md §16.7 (the coefficients; remove "the coefficients are not set
    yet") and §16.3 if PM-WP5b left a marker; PRODUCT_SPEC.md:2793-2795 (remove the marker)

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

> **Status 2026-11-23:** open; runs last, after every other prompt in this file has merged.

```text
PROMPT Z1: Comms, notifications and search docs sweep

ROLE: Documentation steward. Docs only; no code. Runs after every prompt above has merged.

CONTEXT:
  - Rulings: end-to-end encrypted chat is Planned after MVP, with encryption at rest now (Decision
    #339, the P3 row on flag (j)); an SSE stream follows the long-poll later (ruling N2). Each
    prompt above already updated the docs its own change touched (the same-change rule); this
    sweep closes what is left and records status.
  - Each built rule's **Not built yet** marker was removed by the prompt that built it; a marker
    that remains must name its prompt or its open 🧑 (§0.3).

FILES: documentation/database/{comms,search}/*; business/PRODUCT_SPEC.md (§Messaging E,
§Notifications, §Reputation & Discovery, the in-app-only bullet :95-97, the sitemap row :3714,
:4668-4669); business/finance-model.md §16.7; PRODUCT_MANAGEMENT.md (the Notification delivery,
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
     it Open with an owner. List this file's §0.4 "Not written here" items as Open with no owner,
     unless another track's file claims them.

ACCEPTANCE: grep -n "Not built yet" PRODUCT_SPEC.md finance-model.md shows no #339 or #338 P4
marker for built work; the CAS §8 status column has no blank cells; every function and trigger
named in MS1–SR4 appears in documentation/database/{comms,search}/*.
```

---

## Map of merged files

`documentation/readiness/COMMS_DELIVERY_BUILD_PROMPTS.md` (PRODUCTION_READINESS §E's rollup) merged
here on 2026-11-23. Read it with
`git show f2e25929:documentation/readiness/COMMS_DELIVERY_BUILD_PROMPTS.md`.

| Old section                                 | Went                                                                                                       |
| :------------------------------------------ | :--------------------------------------------------------------------------------------------------------- |
| Header                                      | This file's header (the §E scope)                                                                          |
| §0.1 Row → work order, the flip rule        | §0.1                                                                                                       |
| §0.2 Run order: waves and cross-track locks | §0.2 (Waves; Cross-track file conflicts). The score projection was dropped: the Scoreboard holds the score |
| §0.3 Human stops, items 1–4                 | Ruled and built (NT2, MS2, CD1, the `newsletter` reservation): done, §0.0                                  |
| §0.3 Human stops, items 5–6                 | §0.3 ("Hosted", Twilio tokens)                                                                             |
| §1.1 Standard header additions              | §1 (before-you-write step 5; the verification paragraph)                                                   |
| §1.2 Readiness addendum                     | §1 (the Readiness paragraph)                                                                               |
| §1.3 Launcher                               | Dropped: paste §1, then the prompt; nothing else is assembled                                              |
| §2 deltas on MS2, NT2, NT3, NT4             | Done, §0.0                                                                                                 |
| §2 deltas on MS3, MS4, MS5, NT5             | Folded into each prompt's status line, CONTEXT, FILES, steps and acceptance                                |
| §3 CD1                                      | Done, §0.0                                                                                                 |
| §3 CD2                                      | §3, CD2 (with #484's rulings folded in)                                                                    |

The COMMS deltas in `PROJECTS_BUILD_PROMPTS.md` §2 (MS4, MS5, NT5 and CD2, verified 2026-11-19; that
section is gone, read it at `f2e25929`) are folded into the same prompts here.
