# Security & Access Control Build Prompts — closing PRODUCTION_READINESS §C

> **Status: WORK ORDERS, not binding.** Claude Code prompts that take
> [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) §C (Security & access control, 41% at
> 2026-11-18) to 100%. Written 2026-11-18 against `main` @ `b7280787`. Every open row was re-checked
> in code that day, and all 19 are still open.
>
> **Rollup, not restatement.** 13 rows already have a work order in
> [`IDENTITY_BUILD_PROMPTS.md`](../architecture/IDENTITY_BUILD_PROMPTS.md) or
> [`TRUST_SAFETY_BUILD_PROMPTS.md`](../architecture/TRUST_SAFETY_BUILD_PROMPTS.md). This file links
> to them and adds only what has changed since they were written (§2). The six rows with no work
> order, or with one that does not cover them, get new prompts **SAC1–SAC6** (§3).

---

## 0. Map, run order and stops

### 0.1 Row → work order

| Row     | Gate | Crit     | Work order                              | The row flips to ✅ when                                                           |
| :------ | :--- | :------- | :-------------------------------------- | :--------------------------------------------------------------------------------- |
| PRD-C6  | UAT  | High     | **SAC1** (or T&S P2d step 4)            | anon `search.is_admin(uuid)` → 42501                                               |
| PRD-C7  | PROD | High     | **SAC1**                                | No app schema lets PUBLIC or anon execute by default; the probe pins it            |
| PRD-C8  | PROD | Normal   | **SAC2**                                | `fn_log_query` takes no user id; nobody can INSERT `query_logs` directly           |
| PRD-C9  | PROD | Normal   | **SAC1**                                | A stranger's `fn_has_capability(<other uid>, …)` → 42501                           |
| PRD-C10 | PROD | Normal   | **SAC1**                                | The grant probe covers every app schema                                            |
| PRD-C11 | UAT  | High     | **SAC3**                                | `/messages/:id` GET writes nothing; a POST marks the thread read                   |
| PRD-C12 | PROD | Normal   | **SAC4**                                | Every non-API write is origin-checked by construction                              |
| PRD-C13 | UAT  | High     | **SAC6** + you, on the hosted dashboard | `auth:parity` is green against the hosted project                                  |
| PRD-C14 | UAT  | High     | **SAC6** + you                          | Parity green, and one live Google sign-in recorded                                 |
| PRD-C15 | PROD | High     | **SAC6** + you                          | Parity green; the hosted widget, keys and secret are set; a bad token refused live |
| PRD-C16 | PROD | Normal   | **SAC6** + you                          | Parity green                                                                       |
| PRD-C17 | PROD | Critical | MFA1 → MFA2 → MFA3 (Identity §7)        | MFA3 lands (⏳ the finance F·DB phase); MFA1 → 🟡                                  |
| PRD-C18 | UAT  | Normal   | SSO1 (Identity §5)                      | `SsoPanel` renders only behind `AUTH_SSO_ENABLED`                                  |
| PRD-C19 | PROD | Critical | ERA1 → ERA2 → ERA3 → ERA4 (Identity §4) | ERA4 lands; ERA1 → 🟡                                                              |
| PRD-C20 | PROD | High     | MIN1 + MIN2 (Identity §8) + LOW1 item 3 | All three land (MIN2's flag built and **off**)                                     |
| PRD-C21 | PROD | Normal   | RLS1 (Identity §9), last of all         | RLS1 lands                                                                         |
| PRD-C22 | UAT  | High     | **SAC5** (🧑 Decision #444 flag (c))    | The approved words are reserved in TS and SQL, pinned by an equality test          |
| PRD-C23 | PROD | Normal   | HK1 (Identity §3; 🧑 conditional)       | HK1 lands                                                                          |
| PRD-C24 | PROD | Normal   | LOW1 items 4, 5, 7 (Identity §10)       | LOW1 lands                                                                         |

**What UAT needs from §C:** SAC1, SAC3, SAC5 and SSO1, plus the hosted half of C13 and C14. All of
it is in Waves 1–2 below.

### 0.2 Run order

At most **two SQL sessions** at once on the one local DB, on disjoint migration files. One writer at
a time for `00002510`, across **all** tracks.

| Wave | SQL slot A                    | SQL slot B                   | App lane (parallel)                                    | Why                                                                                                     |
| :--- | :---------------------------- | :--------------------------- | :----------------------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| 1    | **SAC1** (holds `00002510`)   | HK1                          | **SAC3** · **SAC4** · SSO1 · **SAC6**                  | Clears C6, C11, C18, the biggest grant risk, and the dashboard tooling. HK1 does not touch `00002510`.  |
| 2    | **SAC2** (`00001400`, `2510`) | **SAC5** (`00001020`, types) | LOW1 (after SSO1: `features/auth`) · MFA1 (after SSO1) | SAC2 waits for SAC1 (`00002510`). SAC5 runs before the `00001020` chain starts.                         |
| 3    | —                             | ERA1 → ERA2 → ERA3 → ERA4    | MIN1 (after MFA1: settings registry, devtools)         | The erasure chain edits `00002510`, so SAC1 and SAC2 must have landed. ERA3 and ERA4 stop at a 🧑.      |
| 4    | ARC1 → MFA2 → MIN2            | —                            | —                                                      | `00001020` in series. ARC1 (IW-M5) is not a §C row, but MFA2 must come after it. MFA3 runs inside F·DB. |
| 5    | RLS1                          | —                            | —                                                      | Last: it breaks every invoker reader of other people's names until those readers move.                  |
| any  | —                             | —                            | You: SAC6's runbook, once per hosted environment       | Needs a hosted project (PRD-G8). Closes C13–C16.                                                        |

**§C score projection** (weights: Critical 3 · High 2 · Normal 1; total 45):

| After               | Score | Rows that flip                      |
| :------------------ | ----: | :---------------------------------- |
| Today               |   41% | —                                   |
| Wave 1              |   63% | C6, C7, C9, C10, C11, C12, C18, C23 |
| Wave 2              |   76% | C8, C22, C24; C17 → 🟡              |
| Wave 3              |   84% | C19; C20 → 🟡                       |
| Wave 4 + MFA3       |   90% | C17, C20                            |
| Wave 5              |   92% | C21                                 |
| Hosted runbook done |  100% | C13, C14, C15, C16                  |

### 0.3 Human stops on this path

1. **SAC5:** which top-level segments to reserve (Decision #444 flag (c)).
2. **HK1:** whether to keep `security.turnstile_verifications`. The recommendation is to drop it.
   Decision #447 built Turnstile with no table write. Contradiction (a) in Identity §0.5 still needs
   its decision row.
3. **ERA3:** which seats the freelancer-profile scope leaves. **ERA4:** where the erasure tombstone
   lives. **MFA1:** recovery when an authenticator is lost. **MIN2:** proxied minors on teams.
   (Identity §0.5 has the options and recommendations for each.)
4. **⚖️ counsel:** the retention values (ERA2, ERA4) and the minors proxy (MIN2). These are built
   behind dials or flags that stay off. A row still flips when the mechanism lands.
5. **Hosted:** C13–C16 need a hosted Supabase project (PRD-G8), and you apply the settings yourself.
   No agent changes a hosted setting.

---

## 1. Headers

### 1.1 Standard header — paste above every SAC prompt

This header and §1.2 also serve the other readiness prompt files, such as
[LIVE_DATA_BUILD_PROMPTS.md](LIVE_DATA_BUILD_PROMPTS.md).

```text
You are working in the Projective monorepo (Deno 2.x; apps/web Fresh 2 + Vite + Preact islands
with @preact/signals; packages/ui the pure-CSS BEM design system @projective/ui; packages/types
the Zod SSOT @projective/types; packages/backend fat services @server/services/*;
supabase/migrations Postgres with RLS everywhere; Supabase Auth (GoTrue)).

Before writing code:
  1. Read the root CLAUDE.md and every sub-directory CLAUDE.md on the paths you touch (always
     documentation/CLAUDE.md; documentation/database/CLAUDE.md when SQL changes;
     packages/ui/CLAUDE.md for UI), then documentation/reference/guardrails.md and
     documentation/reference/pr-checklist.md.
  2. Read the documentation/readiness/PRODUCTION_READINESS.md rows your prompt names, and §0 (run
     order, file locks) of the readiness prompt file it came from (documentation/readiness/
     *_BUILD_PROMPTS.md).
  3. Grep documentation/reference/decisions/README.md for the surface you touch and read the
     decision files it names. If a decision already rules the behaviour you are about to change,
     stop and ask me.
  4. The CONTEXT below was verified at main @ b7280787. Re-check every file:line against the
     current tree before relying on it; another track may have landed since.

Hard rules (merge gates; reject your own diff if any fails):
  - Migrations are consolidated and EDITED IN PLACE (vvvvtooo_type_purpose.sql); never an ALTER
    patch or a "fix" file. Each statement in its category file (0 tables · 1 functions · 2
    policies/grants: 00002500 schema grants, 00002510 function grants, 00002520 table grants · 3
    views · 4 indexes · 5 seed). The Additive Rule: no dropped table, column or FK without my OK.
  - SECURITY DEFINER functions pin search_path = '' and schema-qualify every name. RLS stays on.
    A signed-in request runs under the user's JWT; the service role only before a session exists
    or inside a definer/cron door.
  - Thin routes (HTTP parse + Zod + auth guard); logic in packages/backend/services/* returning
    ServiceResult<T> (Decision #10). Islands never import Supabase or @server/*; they fetch
    /api/* through their feature's client service.
  - A schema or RPC-contract change lands with its Zod schema, the backend mapper and
    documentation/database/* in the same change; a route or URL change with ROUTING.md; an env
    key with SYSTEM_ARCHITECTURE.md §Environment Variable Contract and .env.example (XXXX-XXXX
    placeholders, never a real value).
  - Signal-first state; no useState; useEffect only for browser APIs. Token-only pure CSS + BEM.
    Path aliases only; JSDoc on exports; // #region blocks; no meta-comments.
  - A NEW contradiction between source docs: do not pick a side; add a decision row (newest
    decisions-*.md + README index line; re-check the next free number right before writing) and
    ask me.

Verification: reproduce the defect first (a failing probe or test), then fix.
  SQL: rollback-safe probes under supabase/probes/ (BEGIN … ROLLBACK); `deno task test:probes`;
  `deno task db:reset` is standing-approved but announce it to concurrent sessions; finish with
  your own clean `deno task test:probes:fresh`.
  Always: `deno task check`, `deno task lint`, `deno task test:unit`, and `deno fmt` on the files
  you touched only (never a directory). Compare any red unit test with main before calling it
  yours (theme-engine failures are pre-existing, Decisions #96 (a) and #157 (m)).
  UI-visible changes: `deno task dev`, sign in as the seeded personas
  (documentation/database/Seed.md), capture 1440 and 390 px.
This checkout may be shared with other sessions: never switch branch, never stash, stage only
your own hunks. Commit on the branch you were given. Do not push or open a PR unless I ask.
```

### 1.2 Readiness addendum — paste after every prompt (SAC and Identity alike)

The Identity header predates Decision #444. `pr-checklist.md` now requires this, but say it anyway.

```text
READINESS (Decision #444): in the same change, update documentation/readiness/
PRODUCTION_READINESS.md: the row(s) <ROWS> — status, and evidence naming your commit and
decision; recompute your area's line and the three tier rows of the Scoreboard (score = Σ weight ×
credit / Σ weight; ✅ 1 · 🟡 0.5 · ❌ 0; Critical 3 · High 2 · Normal 1; ⏸ rows excluded); add
one line to §Score history. Update USER_FLOWS.md if a flow's status changes. A gap you find and
do not fix gets a new row at the end of its area, never silence.
```

---

## 2. Existing work orders — what changed since they were written

Paste the source file's own header, then the prompt as written, then §1.2 with the rows below. These
notes are deltas only. The prompts themselves are not repeated here.

| Prompt             | Source            | `<ROWS>` for §1.2                 | Delta (re-verified 2026-11-18 at `b7280787`)                                                                                                                                                                           |
| :----------------- | :---------------- | :-------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2d                | Trust & Safety §4 | PRD-C6 (step 4)                   | If SAC1 has landed, step 4 is done; verify it, don't repeat it. If SAC2 has landed, step 3 (G13) is done too. The rest of P2d (G5, G6, G18) belongs to §D, not here.                                                   |
| HK1                | Identity §3       | PRD-C23                           | Its 🧑 still stands. #447 wrote no `turnstile_verifications` row, so the recommendation (drop) holds.                                                                                                                  |
| ERA1               | Identity §4       | PRD-C19 → 🟡                      | Classify `org.legal_acceptances` (AU1, #446) as HOLD in `account_erasure_scope.sql`, as Identity §0 says. After SAC2, every `search.query_logs` row is attributable, so the default to delete a person's rows is safe. |
| ERA2 · ERA3 · ERA4 | Identity §4       | PRD-C19 → ✅ on ERA4              | No change. ERA3 and ERA4 stop at their 🧑. ERA2 and ERA4 are ⚖️: dials only.                                                                                                                                           |
| SSO1               | Identity §5       | PRD-C18                           | The line has moved: `LoginForm.island.tsx:62` (was `:58`). Check `SignInPrompt.island.tsx` again.                                                                                                                      |
| MFA1               | Identity §7       | PRD-C17 → 🟡                      | `[auth.mfa.totp]` is now at `config.toml:392-394`. No email work is left (AU5, #448). Once enrolment is on, add the MFA keys to SAC6's parity list.                                                                    |
| MFA2               | Identity §7       | (C17 stays 🟡)                    | Already lists the sixth action (the sign-in address move, #451). ⏳ ARC1 and ERA4.                                                                                                                                     |
| MFA3               | Identity §7       | PRD-C17 → ✅                      | ⏳ the finance F·DB phase (`00001240` serial chain).                                                                                                                                                                   |
| MIN1               | Identity §8       | PRD-C20 → 🟡 (with LOW1 item 3)   | Its dispatch half waits for comms' notify engine (N8–N12) if that is in flight.                                                                                                                                        |
| MIN2               | Identity §8       | PRD-C20 → ✅                      | ⚖️: the flag ships **off**. ⏳ MFA2 (`00001020`).                                                                                                                                                                      |
| RLS1               | Identity §9       | PRD-C21                           | Still last. It waits for the finance, projects and comms readers (Identity §0.4). Since #481, `org.get_party_cards` answers only people `org.fn_party_visible` admits (visible, or a shared conversation, notification, workspace or project), so a reader moved onto it inherits that rule: check each surface's people share one of those contexts with the viewer. |
| LOW1               | Identity §10      | PRD-C24; item 3 counts toward C20 | Item 4: #448 already took the email out of the recovery link; the `/join` query string half remains. Items 5 and 7 are unchanged (`safeRedirect` is at `features/auth/core/redirect.ts:64`).                           |

---

## 3. New prompts

### SAC1 — Deny-by-default EXECUTE in every schema, one grant probe over all of them

Closes PRD-C6, C7, C9, C10.

```text
PROMPT SAC1: Deny-by-default EXECUTE in every exposed schema; one grant probe over all of them

ROLE: Postgres security engineer. SQL lane. You hold the 00002510 token: no other prompt on any
track edits 00002500 or 00002510 while this runs.

CONTEXT (verified at b7280787; re-check every line):
  - PostgREST exposes 17 schemas (supabase/config.toml:17). Postgres grants EXECUTE on every new
    function to PUBLIC through the GLOBAL default privilege. A per-schema
    `ALTER DEFAULT PRIVILEGES IN SCHEMA x REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` cannot remove
    it (per-schema defaults only add to the global ones), so 00002510:17-18 (org) is a no-op;
    00002510:124-129 already says so for `public` and closes PUBLIC with a loop instead.
  - Schema-wide revokes exist only for org (:15), projects (:44, PUBLIC + anon), editorial +
    community (:146), comms (:158) and finance (:1050, PUBLIC + anon). `search` goes the other
    way: `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA search TO anon, authenticated, service_role`
    (00002510:228-231) and `ALTER DEFAULT PRIVILEGES IN SCHEMA search GRANT EXECUTE ON ROUTINES
    TO anon, authenticated, service_role` (00002500, the search region). Every other exposed
    schema relies on per-name revokes. The 2026-11-18 audit counted 49 SECURITY DEFINERs
    executable by PUBLIC.
  - C6: search.is_admin(uuid) is executable by anon through that schema-wide grant, so anyone can
    test whether a uuid is an admin. TRUST_SAFETY_BUILD_PROMPTS P2d step 4 (SEC G14) claims the
    same fix: if it has landed, only verify.
  - C9: integrations.fn_has_capability(p_user, p_kind) and fn_conferencing_provider(p_user)
    (00001500:20, :40) are definers granted to authenticated (00002510:555-561) that answer for
    ANY user id, so a signed-in stranger learns anyone's connected providers. Their only caller
    found is SQL (00001510:3266, inside a definer); confirm with grep.
  - C10: supabase/probes/function_grants.sql checks `projects` and `public` only (:67-90).

STEPS:
  1. Red first. Extend function_grants.sql to every app schema (derive the set from config.toml's
     `schemas` minus graphql_public, plus any app schema not exposed; do not hard-code a list
     that can rot), and assert:
     a. PUBLIC holds EXECUTE on no app-owned function (exclude extension members through
        pg_depend deptype 'e', as the probe does today);
     b. anon holds EXECUTE only on an explicit allowlist in the probe, one reason per line
        (guest-safe readers: public profile, explore, RSVP, …);
     c. every SECURITY DEFINER pins search_path (keeps PRD-C2 green across all schemas);
     d. a SECURITY DEFINER that takes a user or actor uuid parameter is executable by
        authenticated only if it is on a reviewed list (it ignores the argument for auth.uid() or
        authorises it). This is the C9 class, so the probe catches the next one;
     e. every function that an RLS policy (pg_depend from pg_policy), a column DEFAULT
        (pg_attrdef) or a CHECK (pg_constraint) depends on is executable by every role that
        policy or table grant serves, so the revoke cannot silently break a read;
     f. pg_default_acl grants EXECUTE to none of PUBLIC, anon, authenticated in any app schema, and
        the global default for the migration-owning role (check pg_proc.proowner) revokes PUBLIC.
     Run it against the current DB and put the failure count in your report.
  2. Inventory what clients really call: every `.rpc(` / `.schema("x").rpc(` in packages/backend,
     apps/web and supabase/functions (if present), with the client each uses (user JWT, anon, or
     service role; see read-actor.ts and the service-client helpers), plus functions called from
     SECURITY INVOKER functions and security_invoker views. That list, not today's grants, is what
     gets granted back.
  3. 00002500: delete the search EXECUTE default grant. Add the global
     `ALTER DEFAULT PRIVILEGES FOR ROLE <owner> REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` (no IN
     SCHEMA), once, and per-schema `REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated` where a
     per-schema GRANT exists.
  4. 00002510: one region at the top that, for every app schema, revokes EXECUTE ON ALL FUNCTIONS
     FROM PUBLIC, anon, authenticated and grants service_role. Replace the search schema-wide
     grant with per-name grants from step 2. Remove the no-op per-schema PUBLIC defaults or
     comment them as belt-and-braces (pick one, be consistent). Every existing per-name GRANT
     stays below the region, so it still applies; keep the file's region order.
  5. C6: no grant of search.is_admin(uuid) to anon; to authenticated only if a policy needs it.
  6. C9: revoke both integrations readers from authenticated. Add a self-scoped reader (no user
     parameter, reads auth.uid()) ONLY if step 2 finds a client that needs one.
  7. Green: the probe passes; `deno task test:probes:fresh` passes (the other probes exercise
     real grants). Then the live app: `deno task dev` with the *_BACKEND_LIVE flags on; walk as a
     guest (/, /explore, a public profile, a /view page, /rsvp/:token) and as two seeded personas
     through projects, messages, wallet, calendar and settings, watching the server log and
     console for 42501 / "permission denied for function". Each one is a missing grant-back:
     grant it by name with a reason line; never re-open a schema.

ACCEPTANCE:
  - The extended probe passes; before the fix it failed on at least the 49 known PUBLIC definers.
  - anon → search.is_admin(uuid): 42501. Persona B → integrations.fn_has_capability(<persona A>,
    'conferencing'): 42501. A booking that picks a conferencing provider still works.
  - A function created in a BEGIN … ROLLBACK block in an app schema after the chain is not
    executable by PUBLIC, anon or authenticated.
  - test:probes:fresh, check, lint and test:unit are green, and the live walk shows no permission
    errors.

SAME CHANGE: documentation/database/<schema>/Functions.md for every schema whose posture changed
(one sentence: deny by default, plus the anon allowlist); SYSTEM_ARCHITECTURE.md where it
describes grants; mark P2d step 4 done in TRUST_SAFETY_BUILD_PROMPTS.md if you did it here.
```

§1.2 rows: **PRD-C6, C7, C9, C10** (and C2's evidence count if it changed).

### SAC2 — `search.fn_log_query` logs only as the caller

Closes PRD-C8. The row's Track said COMMS SR1, but SR1 does not cover this, so this prompt owns it.

```text
PROMPT SAC2: Query telemetry is attributed to the caller and nobody else

ROLE: Postgres engineer (search). SQL lane. ⏳ SAC1 (both edit 00002510). Never beside another
00001400 writer (COMMS SR1 / SR3, TRUST_SAFETY P2d step 5).

CONTEXT (verified at b7280787):
  - search.fn_log_query (00001400:404-428) is a SECURITY DEFINER with `p_user_id uuid DEFAULT
    auth.uid()`, granted to anon (00002510, the fn_log_query grant). Anyone can write query
    telemetry in another person's name, and choose which uid the minor rule (Decision #208) is
    evaluated on.
  - The table door is open as well: 00002520:16 grants INSERT on search.query_logs to anon and
    authenticated, and its INSERT policy admits auth.uid() IS NULL (SEC G13; P2d step 3 claims
    it — if P2d has landed it, only verify).
  - The one app caller, packages/backend/services/search/query-log.ts:28, never passes
    p_user_id, and its JSDoc (:20) already claims "a caller cannot name another user". That is
    false today.
  - It pins search_path = search, public.

STEPS:
  1. Red: supabase/probes/search_query_log_attribution.sql (BEGIN … ROLLBACK): as anon, call
     fn_log_query with p_user_id = a seeded persona and show the row lands in their name; as anon,
     INSERT into search.query_logs directly with that user_id and show it lands.
  2. Drop the parameter: the function takes no user id and writes auth.uid() (NULL for a guest;
     the minor rule now reads auth.uid()). The signature changes, so edit the CREATE in place
     and update the grant line in 00002510 to the new signature.
  3. search_path = '' and schema-qualify the body (org.fn_is_minor, search.query_logs,
     public.vector).
  4. G13: revoke INSERT on search.query_logs from anon and authenticated (00002520) and remove
     or tighten the INSERT policy so the definer is the only writer.
  5. grep supabase/, packages/ and apps/ for every other fn_log_query caller (seeds, edge
     functions, tests) and update each.

ACCEPTANCE (the probe): anon call WITH a p_user_id argument → 42883; anon call without one → a
row with user_id NULL; a persona's call → their uid; a minor persona (if Seed.md has one) → NULL
uid and NULL embedding; a direct anon or authenticated INSERT → 42501. Live: one /explore search
writes exactly one row.
SAME CHANGE: documentation/database/search/{Functions,Policies}.md; the query-log.ts JSDoc is now
true.
```

§1.2 rows: **PRD-C8** (set its Track to SAC2).

### SAC3 — No GET with a side effect: a POST marks a conversation read

Closes PRD-C11's open half. The email half closed in #445 (AU4).

```text
PROMPT SAC3: Opening a conversation renders it; a person's POST marks it read

ROLE: Full-stack engineer (messaging). App lane. Not beside a COMMS prompt that edits
features/messaging/ or MessagingBackendService.ts (check COMMS_BUILD_PROMPTS.md §0).

CONTEXT (verified at b7280787):
  - routes/(dashboard)/messages/[conversationId]/index.tsx:36 calls markConversationRead
    (features/messaging/core/conversations-ssr.ts:74 → MessagingBackendService.markRead →
    comms.mark_dm_read) while rendering a GET. Anything that fetches the page marks the thread
    read without the person seeing it: a prefetch, a link unfurler, a retry, or a cross-site
    top-level navigation, which carries the SameSite=Lax cookie.
  - The JSDoc cites CAS M10 ("opening the conversation IS the read"). M10's fix was the missing
    writer, not the GET: keep its rule (read = the person has seen the latest page) and change
    the transport. #445 is the pattern: a GET renders, and a person's POST does the write.
  - Grep the decisions README for M10, mark_dm_read and "read mark". If a row rules that the GET
    marks read, stop and ask me.
  - Out of scope: M10's project-room read marks (no writer yet). Note it; don't build it.

STEPS:
  1. Red: a unit test that the conversation page (or its loader) does not call markRead; it fails
     today.
  2. A thin POST /api/messaging/conversations/[id]/read: Zod on the id, auth guard, bodiless (the
     csrf guard passes a bodiless same-origin write) → MessagingBackendService.markRead.
     Idempotent; 204 on success; 404 when the viewer cannot read the conversation.
  3. The chat island (ConversationChat) calls it through the messaging client service, once the
     initial page has painted AND document.visibilityState is 'visible', or else on the first
     visibilitychange to visible. A failure leaves the thread unread (the safe direction) and
     shows nothing. Find how the sidebar learns about the read today and keep that behaviour on
     success.
  4. Remove the SSR call (and markConversationRead, if nothing else uses it); fix both JSDocs.
  5. Sweep for every other GET with a side effect: page routes under apps/web/routes (non-api)
     and features/*/routes, and every GET handler under routes/api, for calls into a service
     method that writes (mark*, record*, set*, create*, update*, delete*, claim*, consume*,
     spend*, accept*). Classify each one. If it changes user-visible state, move it behind a POST
     as in step 2. If it is telemetry only (view counts, impressions, query logs), list it in
     ROUTING.md as accepted GET telemetry. Put the table in your report.
  6. Regression gate: a static test beside apps/web/utils/thin-routes.test.ts that fails if a
     non-api page route or a features/*/routes screen imports a known write helper (start with
     markConversationRead / markRead, plus anything step 5 moved).

ACCEPTANCE: as a seeded persona, /messages/:id marks the thread read only after the chat paints in
a visible tab (check last_read_at before and after); a bare GET with the persona's cookie leaves it
unread; the unread badge still clears as it does today; the new route refuses a cross-site POST
(403) and a stranger's conversation (404); unit and gate tests green; 1440 and 390 px captures of
the badge clearing.
SAME CHANGE: ROUTING.md (the new API route; the accepted GET-telemetry list); the messaging flow
doc if it describes read marks; the M10 status note in COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md.
```

§1.2 rows: **PRD-C11** (✅, or 🟡 naming whatever step 5 found and could not move).

### SAC4 — The same-origin write guard covers every route, not only `/api`

Closes PRD-C12.

```text
PROMPT SAC4: Every non-API form post is origin-checked by construction

ROLE: Web security engineer. App lane. Not beside another prompt that edits utils/csrf.ts or
routes/_middleware.ts.

CONTEXT (verified at b7280787):
  - routes/api/_middleware.ts → utils/csrf.ts refuseCrossSiteWrite guards /api writes only.
  - The only non-API write handler today is routes/(standalone)/rsvp/[token].tsx →
    features/calendar/routes/rsvp.tsx:73 (POST: answer · code · join). The token is in the URL,
    so a cross-site form can answer an RSVP, or fire a code email, for any token the attacker
    holds. SameSite=Lax protects only the signed-in "join".
  - csrf.ts already accepts form bodies for FORM_ROUTES, and treats `Origin: null` like a
    missing Origin, falling back to Sec-Fetch-Site (#445).

STEPS:
  1. Red: a unit test that posts a form body to the rsvp handler with Origin:
     https://evil.example and expects 403. Today it proceeds.
  2. In csrf.ts, a page-form variant: the same Origin / Sec-Fetch-Site rule, accepting form and
     JSON bodies. Call it from routes/_middleware.ts for every write method on a path outside
     /api, so a future page POST is covered by construction. /api keeps its own guard, and the
     webhook and cron exemptions stay /api-only.
  3. A gate test that lists every route module outside routes/api that exports a
     POST/PUT/PATCH/DELETE handler (today: rsvp) and asserts the root middleware guards its path.
  4. Check that the rsvp page's own headers (Referrer-Policy) still let its same-origin form
     through.

ACCEPTANCE: a cross-site POST to /rsvp/:token → 403, and nothing is written (no answer, no code
email); the page's own form works for answer, code and join (live dev, with a seeded invitation
token or one the test creates); unit and gate tests green.
SAME CHANGE: SYSTEM_ARCHITECTURE.md §Security (the CSRF rule now covers page forms) and the
csrf.ts module JSDoc.
```

§1.2 rows: **PRD-C12**.

### SAC5 — Every planned top-level segment is a reserved handle

Closes PRD-C22, and Decision #444 flag (c).

```text
PROMPT SAC5: Reserve every planned top-level segment before someone claims it as a handle

ROLE: Full-stack engineer (identity namespace). SQL + types. 00001020 is a hot file: never
beside ERA3, ARC1, MFA2, MIN2, or finance's payout-gate or splits prompts.

🧑 DECISION — STOP before step 4 and put the list to me (Decision #444 flag (c): "The
PRODUCT_SPEC sitemap's routes with no file, and which segments to reserve").

CONTEXT (verified at b7280787):
  - RESERVED_HANDLES (packages/types/profile/reserved.ts) and its SQL twin
    org.fn_is_reserved_handle (00001020:981) must agree. workspace.contract.test.ts fails when a
    top-level segment under apps/web/routes/ is missing from either, but it cannot see a planned
    segment with no route file. So `analytics`, `disputes` and `connections` are claimable today,
    and a profile at one of them would collide with the route when it ships.

STEPS:
  1. Build the candidate set: every top-level segment named in PRODUCT_SPEC.md's sitemap,
     ROUTING.md (built and **Planned** rows), the decision log and SYSTEM_ARCHITECTURE §2, minus
     what is already reserved. Add the platform words the namespace will plausibly need (support,
     security, docs, developers, integrations, marketplace, …), each marked "speculative".
  2. Collision check: query the local DB and the seed generator for any existing username, team,
     business or enterprise handle (whatever org.fn_handle_issue and the handle check read) equal
     to a candidate.
  3. Put to me: (a) the sourced list, (b) the speculative list, (c) the collisions.
     Recommendation: reserve (a) and (b); for a collision, never rename a person's handle
     silently — keep the holder and reserve the word for future claims only, or ask the holder.
  4. Add the approved words to both lists. Export PLANNED_SEGMENTS from reserved.ts with a
     source comment per word, and make the contract test assert SET EQUALITY between
     RESERVED_HANDLES and the SQL array (call the function in a probe, or parse the array), with
     PLANNED_SEGMENTS required in both.
  5. A probe: fn_is_reserved_handle('analytics' | 'disputes' | 'connections') → true; claiming
     one as a team handle → refused with the reserved message.

ACCEPTANCE: the contract test and probe are green; /analytics still 404s as a profile; the team
and business create modals refuse the new words (handle-check unit test).
SAME CHANGE: ROUTING.md §Reserved-handle precedence (the list's sources);
documentation/database/org/Functions.md; record my answer against #444 flag (c) in its decision
row.
```

§1.2 rows: **PRD-C22**, plus the #444 (c) line in "Decisions awaiting a human" → decided.

### SAC6 — A hosted-auth parity check, and the runbook for the hosted halves

Gives PRD-C13, C14, C15, C16 their tooling. Those rows flip only when you have applied the runbook
to a hosted project.

```text
PROMPT SAC6: Prove hosted GoTrue matches config.toml, and write the runbook that makes it so

ROLE: Platform engineer. Scripts and docs only: no migration, no app code. You never change a
hosted setting. You build the check and the runbook, and I apply them.

CONTEXT:
  - Local GoTrue matches the app, pinned by contract tests that read supabase/config.toml:
    Decision #449 (AU2: password policy, Google nonce, secure_password_change) and #447 (AU3:
    Turnstile CAPTCHA). A hosted project does not read config.toml, so each must be set or
    pushed. That is all C13–C16 still lack.
  - No hosted project is recorded yet (PRD-G8). Build it so it runs the day one exists.

STEPS:
  1. Read the AU2 and AU3 contract tests and list every pinned auth key and its expected value.
     Add [auth.mfa.totp] as "expected off until MFA1".
  2. scripts/auth-parity.ts + `deno task auth:parity`. Read SUPABASE_PROJECT_REF and
     SUPABASE_ACCESS_TOKEN (a personal access token, .env.local only; add both to .env.example as
     XXXX-XXXX and to SYSTEM_ARCHITECTURE's env contract). GET the project's auth config from the
     Supabase Management API: look up the endpoint and field names in Supabase's API reference
     (believed to be GET /v1/projects/{ref}/config/auth — verify it, don't guess). Map each field
     to its config.toml key and print key · local · hosted · ok. Exit 1 on any drift. The script
     is read-only and sends no PATCH. A secret is reported as set or unset, never printed.
  3. Check whether the installed Supabase CLI has `supabase config push` (`supabase --help`). If
     it does, document it as the apply path, with its caveats (env() secrets must exist as
     project secrets first). If it does not, write the dashboard path step by step.
  4. The runbook, per hosted environment, in SYSTEM_ARCHITECTURE.md §Authentication (or the
     PRD-G8 deployment runbook if one exists by then):
       C13: minimum password length 8, lower + upper + digits.
       C16: secure password change on.
       C14: Google provider nonce check on, then one real Google sign-in, recorded with date and
            environment.
       C15: a Turnstile widget with the environment's hostnames; the site key in the app env; the
            secret in GoTrue's CAPTCHA setting and as /join's server secret; then a sign-in with a
            failing token is refused.
     Each step ends with `deno task auth:parity` green.
  5. Unit-test the field mapping and the diff against a fixture JSON (no network).

ACCEPTANCE: against a fixture, auth:parity prints a clean table; with one key changed it exits 1
and names that key; no token appears in any output; check, lint and test:unit green.
SAME CHANGE: .env.example; SYSTEM_ARCHITECTURE.md (env contract + runbook).
```

§1.2 rows: **none flip from this prompt.** After you apply the runbook to a hosted environment, each
of C13–C16 goes to ✅ with that environment's parity output. For C14, the evidence also needs a
dated live Google sign-in. For C15, it needs a dated refused-token check.
