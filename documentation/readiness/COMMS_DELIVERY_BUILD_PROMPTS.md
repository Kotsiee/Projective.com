# Communications & Delivery Build Prompts — closing PRODUCTION_READINESS §E

> **Status: WORK ORDERS, not binding.** Claude Code prompts that take
> [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) §E (Communications & delivery, 17% at
> 2026-11-18) to 100%. Written 2026-11-18 against `main` @ `b7280787`. Every open row was re-checked
> in code that day, and all ten are still open as their work orders describe.
>
> **Rollup, not restatement.** Eight of the ten open rows already have a work order in
> [`COMMS_BUILD_PROMPTS.md`](../architecture/COMMS_BUILD_PROMPTS.md) (MS2–MS5, NT2–NT5). This file
> links to them and adds only what has changed since they were last verified on 2026-11-12 (§2). Two
> gaps had no work order. One is the newsletter, PRD-E11. The other is the hosted proof that turns
> the built-locally rows ✅. They get new prompts **CD1** and **CD2** (§3).

---

## 0. Map, run order and stops

### 0.1 Row → work order

| Row     | Gate | Crit     | Work order                    | The row flips when                                                                  |
| :------ | :--- | :------- | :---------------------------- | :---------------------------------------------------------------------------------- |
| PRD-E1  | MVP  | High     | NT1 ✅ (`2f9a9bb6`)           | —                                                                                   |
| PRD-E2  | MVP  | Critical | MS2                           | ✅ when one `sendMessage(actor, ref)` serves both stores and only `cht-` routes     |
| PRD-E3  | MVP  | Critical | MS3                           | ✅ when a message reaches a second browser in ≤ 2 s with no reload                  |
| PRD-E4  | UAT  | Critical | NT2 (🧑 1) → **CD2**          | 🟡 when the claim, retries and signed trigger are proved locally · ✅ on CD2        |
| PRD-E5  | UAT  | Critical | NT3 → **CD2**                 | 🟡 when the email transport is registered and probed · ✅ on CD2                    |
| PRD-E6  | UAT  | Critical | AU5 ✅ built (#448) → **CD2** | ✅ on CD2 (EPI §8.5 setup 4's hosted runbook, step 5 "Prove it")                    |
| PRD-E7  | PROD | High     | NT4 → **CD2**                 | 🟡 on NT4's Chrome proof · ✅ on CD2                                                |
| PRD-E8  | PROD | Normal   | NT5 → **CD2**                 | 🟡 on placeholders + callback tests · ✅ on CD2, once you hold the Twilio tokens    |
| PRD-E9  | UAT  | High     | MS4 → MS5                     | 🟡 on MS4 (`message.*` emitted) · ✅ on MS5 (mute, delete, reactions persist)       |
| PRD-E10 | PROD | High     | NT2 step 2 + NT3 → **CD2**    | 🟡 when the claim consults suppression and the signed webhook writes it · ✅ on CD2 |
| PRD-E11 | PROD | Normal   | **CD1** → **CD2**             | 🟡 when double opt-in and the unsubscribe work locally · ✅ on CD2                  |
| PRD-E12 | UAT  | Normal   | LV4 ✅ (#455)                 | — (its email joins NT3, §2)                                                         |

**The flip rule.** A row that needs only the app and the database (E2, E3, E9) is ✅ when its
prompt's acceptance passes locally. A row that needs a provider account or hosted configuration
(E4–E8, E10, E11) is 🟡 when it is built and proved locally, and ✅ only when CD2 proves it on a
hosted project. PRD-E6, PRD-C15 and PRD-M3 already set that precedent.

**What each tier needs from §E.** MVP needs MS2 and MS3, two of the four Critical ❌ on its critical
path (the others are PRD-B1 and PRD-A1). UAT also needs NT2, NT3, MS4, MS5 and CD2's E4–E6 cases.

### 0.2 Run order

At most **two SQL sessions** run at once on the one local DB, and the cap is shared with every other
track, §C's SAC prompts included. `00002510` has **one writer at a time across all tracks**.

| Wave | SQL slot A                                 | SQL slot B                                       | App lane               | Starts when                              | Rows that flip         |
| :--- | :----------------------------------------- | :----------------------------------------------- | :--------------------- | :--------------------------------------- | :--------------------- |
| 1    | **NT2** (🧑 1; `00001310`, `2510`, `5060`) | **MS4** (`00001300`, `00001840`, `00005010`)     | **MS2**                | now (MS2: after §C's SAC3 merges)        | E2 ✅ · E4 🟡 · E9 🟡  |
| 2    | **NT3** (`00001310`, `2510`, `00005010`)   | **MS3** (`00002600`)                             | —                      | NT3: NT2 + MS4 merged · MS3: MS2 merged  | E3 ✅ · E5 🟡 · E10 🟡 |
| 3    | **MS5** (`00000016`, `00001300`, `2510`)   | —                                                | **NT4**                | MS5: MS2–MS4 merged · NT4: NT3 merged    | E9 ✅ · E7 🟡          |
| 4    | **NT5** (`00005010`)                       | **CD1** (`00000025`, `00001320`, `2510`, `5060`) | —                      | NT5: NT4 merged · CD1: NT3 merged        | E8 🟡 · E11 🟡         |
| 5    | —                                          | —                                                | **CD2** (no migration) | your hosted prerequisites (§0.3, item 5) | E4–E8, E10, E11 ✅     |

Each wave keeps the work orders' own file locks (COMMS §0). Cross-track locks:

- **§C's SAC3** (`SECURITY_ACCESS_BUILD_PROMPTS.md`) edits
  `features/messaging/core/conversations-ssr.ts`,
  `routes/(dashboard)/messages/[conversationId]/index.tsx` and the messaging client service. MS2
  touches all three, so MS2 starts only after SAC3 has merged, and MS3 after both.
- **`00002510`**: NT2, NT3, MS5 and CD1 here; SAC1, SAC2 and the ERA chain in §C. Never two at once.
  If SAC1 holds it in wave 1, NT2 waits while MS4 and MS2 go ahead.
- **`00005060`** (jobs): NT2 and CD1 here; never beside another track's job-adding step.
- **`00005010`** (the catalog): MS4 → NT3 → NT5 here. Other tracks add rows too (C·WP3, F·DB4,
  P·WP1): one writer at a time.
- **`00001300`** (comms channels): MS4 and MS5. The trust track's P2 hardening never runs beside
  them.
- **`core/env.ts`, `.env.example`, the dev seam**: NT2 → NT3 → NT4 → NT5 in series. CD1 adds no env
  key and no dev axis on purpose, so that it can run beside NT5.
- **`00001020`** (reserved handles, a §B.0 hot file): CD1 never edits it (§0.3, item 4).

**§E score projection** (weights: Critical 3 · High 2 · Normal 1; total 26):

| After          | Score | Rows that flip              |
| :------------- | ----: | :-------------------------- |
| Today          |   17% | —                           |
| Wave 1         |   38% | E2 ✅; E4, E9 → 🟡          |
| Wave 2         |   60% | E3 ✅; E5, E10 → 🟡         |
| Wave 3         |   67% | E9 ✅; E7 → 🟡              |
| Wave 4         |   71% | E8, E11 → 🟡                |
| CD2 on staging |   98% | E4, E5, E6, E7, E10, E11 ✅ |
| + Twilio live  |  100% | E8 ✅                       |

### 0.3 Human stops on this path

1. ✅ **NT2 · 🧑 1, where the dispatcher runs: ruled 2026-11-18, Option A** (Decision #344 flag
   (a)). It is a Fresh route, `POST /api/comms/dispatch`, posted to by the pg_net trigger with a
   Vault bearer. NT2 skips its stop and adds no decision row; it amends SA:2531 and EPI §8.1.
2. ✅ **MS2 · Decision #444 flag (a): ruled 2026-11-18, `cht-`.** #339 ruling N1 had already chosen
   `cht-`, and the owner confirmed it. MS2 updates ROUTING to match, with no stop.
3. ✅ **CD1 · Q1 and Q2: ruled 2026-11-18 (#480).** Q1 Option A, Resend contacts (one provider); Q2
   yes, a new topic on a confirmed address needs the confirm link. The owner also chose to build
   steps 1–4 ahead of NT3; step 5 (the sync) waits for NT3, and a re-run of CD1 does step 5 only.
4. **§C's SAC5 · Decision #444 flag (c)**: when you rule which top-level segments to reserve,
   include `newsletter`. CD1's two pages live under it, so CD1 then never edits `00001020`. SAC5
   landed (`cd6d016f`) without it; ruled 2026-11-18 (#480): CD1 adds it with its routes.
5. **Hosted (CD2).** A hosted staging Supabase project and a deployed app at a public HTTPS origin
   (the staging slice of PRD-G8). You set every secret and every dashboard setting yourself:
   - Vault: `CRON_APP_URL`, `COMMS_DISPATCH_SECRET` (the PRD-G6 pattern), and the
     `comms.dispatch_webhook` flag on.
   - Resend: `notify.<domain>` (and `news.<domain>` for CD1) verified, with SPF, DKIM, Return-Path
     and DMARC (EPI §8.5 setup 1–3). Also `RESEND_API_KEY`, `MAIL_FROM`, and the webhook endpoint
     `https://<origin>/api/comms/webhooks/resend` with its secret as `RESEND_WEBHOOK_SECRET`.
   - GoTrue: EPI §8.5 setup 4's hosted runbook (SMTP, Site URL, templates, rate limit).
   - Push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
   - Text (when you have them): the three Twilio keys, a Messaging Service, geo-permissions limited
     to launch markets, and the status callback `https://<origin>/api/comms/webhooks/twilio`.
   - CD1 under Option A: the provider list id in `security.platform_params` and the
     `newsletter.provider_sync` flag on.

   No agent types, pastes or echoes a secret, and no agent changes a hosted setting.
6. **Twilio tokens** (#339 flag (n)): you obtain them. PRD-E8 stays 🟡 until then.

---

## 1. Headers

### 1.1 Standard header — the comms header, plus three lines

Paste [`COMMS_BUILD_PROMPTS.md` §1](../architecture/COMMS_BUILD_PROMPTS.md) above every prompt here:
MS*, NT*, CD1 and CD2 alike. It carries the comms hard rules (no private content to a SaaS, the
inbound-webhook standard, constant-time bearers, the placeholder rule). Then paste these lines,
which postdate it:

```text
ADDITIONS (2026-11-18):
  - The CONTEXT was verified at main @ b7280787. Re-check every file:line against the current tree
    before relying on it; another track may have landed since. Also read
    documentation/readiness/COMMS_DELIVERY_BUILD_PROMPTS.md §0 (run order, locks, stops) and your
    row in its §2.
  - Pre-existing unit failures: theme-engine (Decisions #96 (a) and #157 (m)). Compare any red test
    with main before calling it yours.
  - This checkout may be shared with other sessions: never switch branch, never stash, stage only
    your own hunks. `deno task db:reset` is standing-approved; announce it to the other sessions.
```

### 1.2 Readiness addendum — paste after every prompt

```text
READINESS (Decision #444): in the same change, update documentation/readiness/
PRODUCTION_READINESS.md: the row(s) <ROWS> — status, and evidence naming your commit and decision;
recompute the §E line and the three tier rows of the Scoreboard (score = Σ weight × credit /
Σ weight; ✅ 1 · 🟡 0.5 · ❌ 0; Critical 3 · High 2 · Normal 1; ⏸ rows excluded); add one line to
§Score history. The flip rule: a row needing a provider account or hosted config is 🟡 when built
and proved locally, ✅ only on CD2. Update USER_FLOWS.md if a flow's status changes. A gap you find
and do not fix gets a new row at the end of §E, never silence.
```

### 1.3 The launcher — what you actually paste into a fresh session

The session assembles the header, the prompt and the deltas itself:

```text
Run work order <ID> for PRODUCTION_READINESS §E.
1. Read documentation/readiness/COMMS_DELIVERY_BUILD_PROMPTS.md §0 and §1, and <ID>'s row in its
   §2 (or its prompt in §3).
2. Your rules: documentation/architecture/COMMS_BUILD_PROMPTS.md §1 (the standard header) plus the
   ADDITIONS in §1.1 here. Then do PROMPT <ID> as written (COMMS_BUILD_PROMPTS.md, or §3 here),
   applying every "Status" note above it and the §2 delta here; the newest note wins.
3. Stop at every 🧑 and put the question to me with the options and your recommendation.
   <Pre-answered rulings, if any, e.g. "CD1: Q1 Option A; Q2 yes.">
4. Finish with §1.2's readiness update for <ROWS>.
Branch: <branch>. Commit; do not push or open a PR.
```

---

## 2. Existing work orders — what changed since they were written

Each delta below is applied on top of the prompt as written in `COMMS_BUILD_PROMPTS.md`. The prompts
themselves are not repeated.

| Prompt | Source   | `<ROWS>` for §1.2           | Delta (re-verified 2026-11-18 at `b7280787`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| :----- | :------- | :-------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MS2    | Comms §2 | PRD-E2 → ✅; narrows PRD-J1 | Not started. ⏳ §C's SAC3 (shared files, §0.2). Refs moved: `ProjectBackendService.sendMessage` is `:3295` (was `:3163`); its hire-intro caller at `:1986` already calls `MessagingBackendService.sendMessage` (`:428`). The uuid-accepting resolver is `resolveThreadRef` (`live-threads.ts:63`). `apps/web/utils/request-memo.ts` exists (RED WP10a): consume it, don't create it. Step 4's sweep must catch PRD-J1's thread links (`services/saved/live-saved.ts:542`, `:593`; `BookingBackendService.ts:1326`). #444 flag (a) is ruled (`cht-`, 2026-11-18) and already recorded on #444 and in the readiness file's §Decisions table: build it with no stop.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| MS3    | Comms §2 | PRD-E3 → ✅                 | ⏳ MS2 (and SAC3). Step 2 is done: `bumpCacheVersion`, `cacheVersion`, `cacheVersionTag` are in `core/kv.ts:156-184`; don't create `cache-version.ts`. `00002600:10-18` still publishes the five comms tables. O·RED WP13 (the chrome endpoint) is unblocked by this; don't build it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| MS4    | Comms §2 | PRD-E9 → 🟡                 | Not started; runnable now beside NT2 (disjoint files). The three `message.*` rows are `00005010:66-68`, still `/messages/{entity_id}`. Its `'/messages/' \|\| ref` links resolve only once MS2 lands: if both finish together, merge MS2 first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| MS5    | Comms §2 | PRD-E9 → ✅                 | ⏳ MS2, MS3, MS4. localStorage state is now only in `ConversationHeader.island.tsx` and `InboxView.island.tsx` (confirm `MessagesSidebar.island.tsx` holds none). `MessagingSection.tsx`'s line refs are stale: re-find the Read receipts and Typing indicator switches.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| NT2    | Comms §3 | PRD-E4 → 🟡                 | **✅ Built 2026-11-18 (PRD-E4 🟡).** The Status note above NT2 in COMMS §3 lists what landed and the four fixes found on the way. All three additions below are done. Was: not started; 🧑 1 is ruled: Option A, a Fresh route (#344 (a), 2026-11-18). Skip the stop and add no decision row. Refs: the flag read is `00001310:1157`, the URL read `:1169`, the params `00005001:136-143`. Three additions. (1) ST2's `services/comms/channel-liveness.ts:34` hard-codes `dispatcher: false`: derive it from the running dispatcher (the flag plus a well-formed `COMMS_DISPATCH_SECRET`) and extend `channel-liveness.test.ts`. (2) `scripts/cron-vault.ts` provisions only `INTEGRATIONS_CRON_SECRET` (`:16`, `:36`): add `COMMS_DISPATCH_SECRET` when `.env.local` holds a well-formed one, so `db:reset` leaves local dispatch working (notifications move no money, so the script's "money sweeps stay manual" rule holds); update its `$comment` in `deno.json`. (3) Note in PRD-E10's evidence that the claim now consults `fn_is_suppressed` (CAS N8); E10 stays ❌ until NT3. |
| NT3    | Comms §3 | PRD-E5 → 🟡, PRD-E10 → 🟡   | ⏳ NT2 and MS4 (`00005010`). The transport (`527b4cd6`) and `[auth.email.smtp]` (#448) are done. Three additions. (1) ✅ done by NT2: `channel-liveness.ts` reads `transports` from `configuredChannels()` in `dispatch-transports.ts`, so registering the email transport there is the whole step. (2) `waitlist.invited` (`00005010:84`) routes `in_app` only, but #455 says its email rides PRD-E5: add `email` to its channels. (3) The account's marketing unsubscribe and CD1's newsletter unsubscribe share the RFC 8058 one-click shape but not a list (an account vs an anonymous address): name the route `/api/comms/unsubscribe`, so `/api/newsletter/unsubscribe` sits beside it.                                                                                                                                                                                                                                                                                                                                                                                         |
| NT4    | Comms §3 | PRD-E7 → 🟡                 | ⏳ NT3 (`dispatch-transports.ts`, `core/env.ts`, `.env.example`, the dev seam). `static/` has `icon-192.png` and `icon-512.png` but no manifest; `sw.js` has no push handler. `channel-liveness.ts:35` hard-codes `push: false`: read the push registration. Keep `pushPermission` as its own axis: ST2's `notificationDelivery` axis draws channels live or off, not browser permission.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| NT5    | Comms §3 | PRD-E8 → 🟡                 | ⏳ NT4. ST2 rewrote `NotificationsSection.tsx`: the SMS column renders today with "nothing is sent yet" copy from the liveness map (`data.delivery`), and the `:43`, `:50`, `:76` refs are stale. Use `data.delivery.sms` as the `smsAvailable` the prompt asks for, not a second flag, and hide the whole SMS column while it is false (#339 flag (n)). Reuse ST2's `notificationDelivery` dev axis instead of adding `smsProvider`. `.env.example:112` still holds `SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN` (step 1 removes it).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Not in §E: SR1–SR4 (search) and Z1 (the comms docs sweep, which runs after the whole comms track).

---

## 3. New prompts

### CD1 — The newsletter: double opt-in, a one-click unsubscribe, the list synced to the provider

> **Status (2026-11-18, #480).** 🧑 Q1 and Q2 ruled (Option A; yes). Steps 1–4 are built, ahead of
> NT3 by owner ruling; PRD-E11 is 🟡. Step 5 waits for NT3's `DeliveryEventService`. When it runs,
> it also gives the newsletter its own sender (#480 (a), PRD-E14) and maps Resend's per-topic
> unsubscribe to removing that topic (#480 (b)).

```text
PROMPT CD1: The newsletter — double opt-in, a one-click unsubscribe, and the list synced to the
mail provider

ROLE: Backend and Postgres engineer (mail), with two small public pages. Depends on NT3 (the
transport, the signed Resend webhook, the suppression rules). Runs beside NT5: it adds no env key,
no dev axis and no catalog row.

CONTEXT:
  - Gap PRD-E11: a stored subscription is never confirmed and never sent anything.
    NewsletterBackendService.ts:29 ("only the confirm link (not built yet) applies it"; "No
    email-provider sync or confirmation mail exists yet"). Decision #274 moved the list to
    community.newsletter_subscriptions, with one writer, community.subscribe_newsletter; its flag
    (c) is "no confirmation mail / per-topic consent".
  - The table already has the double opt-in shape (00000025_tables_community.sql, region
    [newsletter]): confirmed_at (NULL = captured, unconfirmed), unsubscribed_at +
    unsubscribed_reason, the pending re-subscribe pair (resubscribe_topics,
    resubscribe_requested_at), and token (uuid, UNIQUE, the link credential). Send-eligible is
    exactly confirmed_at IS NOT NULL AND unsubscribed_at IS NULL. The column comments describe the
    confirm handler's one write; build exactly that.
  - Decision #445: a link that a mail scanner can GET never spends a token. Confirming is a page
    with one button that POSTs.
  - The confirmation mail is the requester's own transactional mail. It goes through deliverMail
    (services/mail/transport.ts), like the guest and verification mailers, never through the
    notification dispatcher (the address has no account). In development with no re_… key, the
    transport logs it, as today.
  - EPI §8.5 setup 1: newsletter mail goes out on its own subdomain (news.<domain>), so a
    complaint cannot hurt a password reset. Ruling N3 (b) and NT3's reading: a hard bounce blocks
    the address for every category (comms.channel_suppressions, which the table comment says a
    send job reads); a complaint or unsubscribe blocks Marketing only. The newsletter is Marketing.
  - Abuse: once a confirmation mail sends, the public form can mail any address. EPI §9.1 lists
    Turnstile on the newsletter opt-in as Proposed; #447 built core/turnstile.ts and
    features/auth/components/CaptchaField.tsx. Build it here.

🧑 DECISION — STOP before step 5, and put both questions to me. Log the answers as one decision row
(re-check the next free number in documentation/reference/decisions/README.md right before
writing; #459 was the newest on 2026-11-18):
  Q1 — Where the list lives for sending.
    Option A (recommended): Postgres stays the record. Each confirmed, unsuppressed address syncs
    to the mail provider's contact list (Resend contacts: read its current docs for the audience,
    segment and topic model before coding). Broadcasts are composed and sent in the provider's
    dashboard from news.<domain>, and the provider's unsubscribe comes back through NT3's signed
    webhook. One provider (EPI §8.5), and no composer to build.
    Option B: no provider list. The app sends each issue through a job and deliverMail, with its
    own composer, throttle and per-recipient unsubscribe. One source of truth; the most build.
    Option C: a dedicated newsletter platform (Buttondown, Mailchimp). The best tooling, but a
    second provider and a second DPA, against EPI §8.5.
  Q2 — Per-topic consent (#274 flag (c)): does a topic added to an already confirmed address
    (changelog, from /changelog) need the confirm link? Recommendation: yes, recorded in the
    pending pair. Its CHECK widens in place to allow it while confirmed; the comment is rewritten,
    and the column keeps its name.
  Steps 1–4 do not depend on Q1. Do them first; Q2 decides step 1's branch.

FILES:
  - supabase/migrations/00000025_tables_community.sql (edited in place: confirmation_sent_at
    timestamptz; under Option A, provider_synced_at timestamptz and provider_contact_ref text; the
    pending pair's CHECK only if Q2 = yes)
  - supabase/migrations/00001320_functions_editorial_community.sql (community.confirm_newsletter
    (p_token uuid), community.unsubscribe_newsletter(p_token uuid, p_reason text);
    subscribe_newsletter also reports whether a confirmation mail is due)
  - supabase/migrations/00002510_permissions_function_grants.sql (both → service_role only, beside
    subscribe_newsletter at :192-193)
  - supabase/migrations/00005001_seed_platform_params.sql and 00005060_seed_scheduled_jobs.sql
    (Option A only: the provider list id param; newsletter-provider-sync, http, every 5 minutes,
    behind a newsletter.provider_sync flag seeded false)
  - packages/types/community/newsletter.ts + its contract test
  - packages/backend/services/newsletter/{NewsletterBackendService.ts, newsletter-mailer.ts (new),
    provider-sync.ts (new, Option A)} + tests; under Option A, the provider's contact events branch
    inside NT3's DeliveryEventService (one Resend webhook, one Svix secret, no second endpoint)
  - apps/web/routes/api/newsletter/{subscribe.ts (the Turnstile token), confirm.ts,
    unsubscribe.ts, cron/sync.ts (Option A)} (thin; the cron route checks COMMS_DISPATCH_SECRET in
    constant time and answers 404 otherwise: outbound mail is the dispatcher's concern, and one
    secret means one Vault entry)
  - the confirm and unsubscribe pages, /newsletter/confirm and /newsletter/unsubscribe, under
    apps/web/routes/(public)/ (server-rendered; noindex, no-store, no-referrer). `newsletter` must
    already be reserved (§0.3, item 4): if it is not, STOP and ask. Never edit 00001020 here.
  - the NewsletterForm island (CaptchaField) and its client service
  - supabase/probes/newsletter_double_opt_in.sql (new)
  - documentation: database/community/{Tables,Functions}.md; ROUTING.md (two pages, the routes);
    EPI §8.5 (the newsletter subdomain and the sync) and §9.1 (the newsletter row → Built);
    PRODUCT_SPEC (the newsletter consent rule: double opt-in, per-topic per Q2, an unsubscribe
    holds until re-confirmed), if it has none; the #274 row's flag (c) → Resolved by this change

STEPS:
  1. Subscribe: verify a Turnstile token (core/turnstile.ts, surface `newsletter`) before the
     write, refusing with the auth pattern's CAPTCHA_REFUSAL. Answer the same success whatever the
     address's state (no enumeration, as today). subscribe_newsletter reports a confirmation as
     due for a new address, for an unconfirmed one whose last mail is more than 10 minutes old,
     and for a pending re-subscribe (or, if Q2 = yes, a pending topic). It stamps
     confirmation_sent_at. The service sends the mail after the write commits.
  2. The mail: subject "Confirm your Projective newsletter subscription", one sentence, the topic
     names, and a link to ${APP_URL}/newsletter/confirm?token=…, plus the List-Unsubscribe pair
     (step 4). Nothing else from the row. An address that comms.fn_is_suppressed refuses for email
     gets no mail, and the answer is unchanged.
  3. Confirm: the page shows the topics and one Confirm button, which POSTs to
     /api/newsletter/confirm (origin-guarded, a form body allowed, throttled per client: #445's
     pattern). That calls community.confirm_newsletter(token), the comment's one write:
     confirmed_at = now(), the pending pair applied and cleared, unsubscribed_at cleared only
     through a pending pair. A confirm more than 7 days after confirmation_sent_at answers "This
     link has expired — subscribe again" and writes nothing. An already confirmed token answers the
     same success. An unknown token gets the calm not-found page with a real 404.
  4. Unsubscribe: every newsletter mail, the confirmation included, carries
     List-Unsubscribe: <https://…/api/newsletter/unsubscribe?token=…> and List-Unsubscribe-Post:
     List-Unsubscribe=One-Click (RFC 8058). A POST with that body unsubscribes at once, with no
     origin check: mail clients post cross-site, and the token is the credential. A GET of the page
     shows one button. unsubscribe_newsletter sets unsubscribed_at and the reason, clears the
     pending pair, and is idempotent. Nothing is hard-deleted.
  5. (After Q1, Option A) Sync: newsletter-provider-sync upserts confirmed, unsuppressed rows
     whose provider_synced_at is older than updated_at, and removes unsubscribed or suppressed
     ones, through the provider with an idempotency key. The address is the only data sent. A
     provider unsubscribe arriving on NT3's webhook writes unsubscribed_at (reason 'provider'). A
     hard bounce writes NT3's suppression, and a complaint writes a Marketing-only suppression plus
     unsubscribed_at. Under Option B, write the send job instead and stop for its shape.
  6. No new simulatable axis: a confirm state is data, reachable in development by subscribing
     (the transport logs the link).

SAME CHANGE: the migrations edited in place + Zod + database/community docs; ROUTING; EPI; the
decision row; PRODUCT_SPEC's rule.

SQL SESSION: run probes with `deno task test:probes`; at most 2 SQL sessions at once on the one
local DB, on disjoint migration files, each announcing its resets; finish with your own clean
`deno task test:probes:fresh`. Never beside another 00002510 or 00005060 writer.

ACCEPTANCE:
  - newsletter_double_opt_in.sql (BEGIN … ROLLBACK): a new subscribe → unconfirmed, mail due; a
    second within 10 minutes → not due; confirm → confirmed_at set; a confirm 7 days after the
    mail → refused, nothing written; unsubscribe → unsubscribed_at set, pending cleared; a public
    re-subscribe after that → pending only, still unsubscribed; its confirm applies it; a
    hard-suppressed address → no mail due.
  - Route tests: a subscribe without a Turnstile token → refused; a GET of /api/newsletter/confirm
    writes nothing; an RFC 8058 POST unsubscribes; a wrong cron bearer → 404.
  - A unit test: the mail carries the link and the List-Unsubscribe pair, and no other row data.
  - Option A: a stub-provider unit test shows that only confirmed, unsuppressed rows sync and an
    unsubscribe removes the contact.
  - Screenshots of the confirm and unsubscribe pages at 1440 and 390, light and dark.
```

`<ROWS>` for §1.2: PRD-E11 → 🟡.

### CD2 — The hosted delivery proof: every outbound channel sends for real on staging

> **Status (2026-11-18, re-checked at `b695f326`): deferred again; the owner ruled "wait" twice
> (#484).** The first run (`edb447a9`) found none of its dependencies on `main` and declined a
> PRD-E6-only proof. The second found NT2 (`4dfd07f6`) and CD1 steps 1–4 (`25531b74`) merged, but
> NT3 not yet on `main`, NT4 and NT5 not started, CD1 step 5 waiting for NT3, and no staging
> deployment (PRD-G8 ❌). Neither run built or ran any of CD2. Re-run CD2 in wave 5, after
> re-checking every dependency at HEAD; its 🧑 PREREQUISITES stop still comes first. **The `--check`
> gap is ruled (#484): the app reports its own liveness.** The script reads only the
> `DELIVERY_SMOKE_*` exports and cannot see the hosted app's environment (`RESEND_API_KEY`,
> `MAIL_FROM`, the VAPID pair, the Twilio keys), so step 1's "SAME predicates the code uses" run
> inside the app: `GET /api/comms/dispatch`, behind the same constant-time `COMMS_DISPATCH_SECRET`
> bearer as the `POST`, answers `deliverySources()` (`services/comms/channel-liveness.ts`) as the
> dispatcher and each channel by name with ✓ / ✗ only, and the same 404 to any other bearer. FILES
> gains that route (`routes/api/comms/dispatch.ts`, `dispatch-ssr.ts`, a route test, ROUTING). The
> script presents that bearer from a sixth export, `DELIVERY_SMOKE_DISPATCH_SECRET` (#484 flag (a),
> ruled 2026-11-18), which you export in your own shell like the other five; it is never read from a
> file or printed. The read also reports `RESEND_WEBHOOK_SECRET` and the Twilio callback token as
> present ✓ / ✗ (#484 flag (c), ruled 2026-11-18). Also add CD1's Option A checks (the provider list
> id in `security.platform_params`, the `newsletter.provider_sync` flag) to `--check`, because step
> 1 omits them.

```text
PROMPT CD2: The hosted delivery proof — every outbound channel sends for real on staging

ROLE: Release / platform engineer. Runs after NT2–NT5 and CD1 have merged, against the hosted
STAGING project only. No migration. It writes one script and records one runbook pass. YOU (the
owner) run the sends from your own terminal; this session reads the output you paste.

CONTEXT:
  - The flip rule (COMMS_DELIVERY_BUILD_PROMPTS.md §0.1): PRD-E4, E5, E7, E8, E10 and E11 are 🟡
    when built and proved locally, and this prompt proves each on a hosted project. PRD-E6's
    remainder is EPI §8.5 setup 4's hosted runbook, step 5 ("Prove it").
  - The hosted wiring is the owner's (§0.3, item 5). Never type, paste, echo or log a secret, and
    never change a hosted setting. The script reports names, presence and shape only (the
    cron:vault rule: print names, never a value), and it prints ids, never addresses or tokens.
  - Resend publishes test recipients for delivered, bounced and complained outcomes
    (…@resend.dev). Check its current docs for the exact addresses.

🧑 PREREQUISITES — STOP first and list, by name, everything in §0.3 item 5 that the --check mode
cannot see yet. Run nothing else until I say they are set.

FILES:
  - scripts/delivery-smoke.ts (new) + `deno task smoke:delivery` with a $comment in deno.json
    (the smoke:stripe pattern; not part of `deno task test`). It reads its target only from
    variables I export in my own shell (DELIVERY_SMOKE_ORIGIN, DELIVERY_SMOKE_SUPABASE_URL,
    DELIVERY_SMOKE_SERVICE_ROLE_KEY, DELIVERY_SMOKE_INBOX, DELIVERY_SMOKE_PHONE), never from a file.
  - documentation/api/EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md (§8.1, §8.2, §8.5,
    §8.6: each runbook step marked done on staging with the date; §10)
  - documentation/architecture/SYSTEM_ARCHITECTURE.md §Scheduled jobs (the comms Vault secrets)
  - documentation/readiness/PRODUCTION_READINESS.md

STEPS:
  1. `--check`: presence and shape only. The dispatch route answers 404 to a wrong bearer;
     /api/notifications/push/config answers 200; vault.secrets holds CRON_APP_URL and
     COMMS_DISPATCH_SECRET (names only, never decrypted_secrets); comms.dispatch_webhook is on;
     each transport is configured by the SAME predicates the code uses (import them, don't copy
     them). It prints a table of names with ✓ / ✗.
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
     f. newsletter (PRD-E11): subscribe the test inbox → one confirmation mail; Confirm →
        confirmed (and, under CD1 Option A, the contact appears in the provider list); the
        mail's one-click unsubscribe → unsubscribed_at set.
  3. Flip each proved row to ✅ with the date, "staging" and the smoke run's ids. A case that
     could not run keeps its 🟡 and says what is missing. Production repeats EPI §8.5 setup 4 and
     `smoke:delivery --check` as part of PRD-G8's go-live: write that line into EPI §8.5.

ACCEPTANCE:
  - `smoke:delivery --check` prints no ✗ on staging.
  - Every case that ran has its ids in the readiness evidence.
  - §E in the Scoreboard has no ❌ (PRD-E8 may stay 🟡 until Twilio is live).
```

`<ROWS>` for §1.2: PRD-E4, E5, E6, E7, E8, E10, E11 → ✅ (each only if its case passed).
