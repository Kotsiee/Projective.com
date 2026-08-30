# Read API — Findings

> **Status: FINDINGS. The security items are fixed; the contract contradictions in §2 are the
> remaining open decisions.**
>
> Produced while implementing the live read path, HEAD/OPTIONS, ETag revalidation and the service
> cache for the fifteen `GET` endpoints under `apps/web/routes/api/{projects,messaging}/`. Everything
> here was found by reading the migrations and the Zod SSOT against each other, or by executing the
> code. Nothing in §1 is a style opinion; each item either already misbehaves or would the first time
> its gate is switched on.
>
> Per root [`CLAUDE.md`](../../CLAUDE.md) §8, a new cross-source contradiction is **flagged, not
> silently resolved**. §1.2 is the one exception — it is fixed here, because without it the
> deliverable cannot function at all, and the fix is SELECT-only.

---

## 1. Security

### 1.1 ✅ FIXED — five `comms` tables had RLS switched off, with `GRANT ALL` to `authenticated`

`00002001_policies_enable_rls.sql` enabled RLS on nineteen of the schema's twenty-four tables. The
five it never named were `comms.message_reactions`, `message_pins`, `message_favorites`,
`auto_responses` and `newsletter_subscriptions` — and `00002500` grants
`ALL ON ALL TABLES IN SCHEMA comms TO authenticated`, with `ALTER DEFAULT PRIVILEGES` extending it to
any table added later. RLS off plus a blanket grant is not weak protection; it is none. Any signed-in
user could read and rewrite every other user's reactions, pins, favourites and auto-reply rules, and
read the entire newsletter subscriber list **together with each row's `token`, which is the
unsubscribe capability**.

**Fixed.** RLS is enabled on all five (`00002001`), with policies in `00002012` built on one new
predicate, `comms.can_read_message(message_table, message_id)` (`00001300`). That predicate exists
because four tables — reactions, pins, favourites and attachments — are polymorphic on
`(message_table, message_id)` with **no foreign key**, so each needs the same question answered and
four copies would be four chances for the project half and the DM half to drift. It is
`SECURITY DEFINER` for the same reason `comms.is_dm_participant` is: its lookups reach the message
tables, which carry their own policies, and a policy re-entering another policy is a performance
cliff at best.

The shape of each, and why:

| Table | Rule | Reasoning |
| :---- | :--- | :-------- |
| `message_reactions` | SELECT follows the message; INSERT/DELETE own row only | A reaction is public *within* the conversation — that is the point — but writing one is personal. The `user_id = auth.uid()` arm on INSERT is what stops a caller reacting *as* someone else. |
| `message_pins` | SELECT and INSERT/DELETE follow the message | The UNIQUE is `(message_table, message_id)` with **no `user_id`** — a pin is channel-wide, so un-pinning acts on everyone. DELETE is deliberately not restricted to the pinner: in a two-person DM the counterparty must be able to clear one, and a stale pin outliving whoever set it is the state this avoids. |
| `message_favorites` | Own row for every verb | UNIQUE is `(user_id, …)` and nothing renders another person's favourites. Deliberately **no** `can_read_message` arm on SELECT/DELETE: a favourite that outlives access to its message should still be listable and removable, and the row carries no content. |
| `auto_responses` | Own row, split into four policies | Split rather than `FOR ALL` so UPDATE carries **both** `USING` and `WITH CHECK`. `FOR ALL` applies one expression to both, which reads as equivalent and is not — without the check arm a caller can UPDATE their own row and set `user_id` to somebody else in the same statement, handing the row away. That is the `files.items` defect from Decision #67. |
| `newsletter_subscriptions` | **No policy, deliberately** | Default-deny for `anon` and `authenticated`; reachable only through the service-role key. Every row is an email address paired with an unsubscribe token, so a SELECT policy wide enough to be useful is a subscriber-list dump and a per-row one still confirms whether an address is subscribed. The public form posts to `/api/newsletter/subscribe`, which upserts server-side. |

**This is not the same thing as §1.2's bug**, and the distinction is written into the migration so a
future reader does not "fix" it: there, the app genuinely needed to read those tables as the
signed-in user, so default-deny silently returned an empty inbox. Here nothing should ever read this
table as a user.

**One thing found while fixing it, and worth its own attention.** `GRANT ALL` includes `TRUNCATE`,
and **TRUNCATE is not row-level, so RLS does not bound it.** A caller who cannot SELECT a single row
of `comms.dm_messages` could still discard the whole table. It is revoked for `comms` here, and from
the default privileges so a new table does not silently re-acquire it. **The same `GRANT ALL` pattern
is used for `org`, `public`, `files`, `projects`, `marketplace` and `reviews`** — the same reasoning
applies to every one of them, and that is left for a human, because a platform-wide privilege change
deserves its own review rather than riding along with this one. (Practical exposure today is low:
PostgREST exposes only SELECT/INSERT/UPDATE/DELETE over HTTP, so reaching TRUNCATE needs a direct
connection or a `SECURITY INVOKER` function that performs one. It is defence in depth, not a live
breach.)

### 1.2 ✅ FIXED — the whole DM stack was default-denied

Five tables had RLS **enabled with zero policies**, which as `authenticated` returns `200 []` — never
an error, never a hint:

`comms.dm_threads` · `comms.dm_participants` · `comms.dm_messages` · `comms.channel_files` ·
`comms.project_channel_participants`

So the entire `/messages` inbox was unreadable the moment `MESSAGING_BACKEND_LIVE` was switched on,
and it would have looked exactly like "this user has no conversations". The fixture corpus masked it
completely, because with the gate off nothing reached Postgres.

**Fixed** by adding SELECT-only policies (edited in place into `00002012_policies_comms.sql`,
category 2) plus one predicate (`00001300_functions_comms_channels.sql`, category 1).

**The predicate is not optional, and the reason is worth keeping.** The natural policy is an `EXISTS`
over `comms.dm_participants` — but the policy **on** `dm_participants` would then subquery its own
table, which Postgres rejects at runtime with `42P17 infinite recursion detected in policy`. The
first draft of this fix had exactly that bug. `comms.is_dm_participant(uuid)` is `SECURITY DEFINER`,
so the lookup inside it is not re-filtered by RLS and the cycle is broken — the same shape
`comms.has_channel_access` already uses for the project-channel side.

Write policies were deliberately **not** added: the read API does not need them, and a missing write
policy fails closed and visibly, whereas a wrong one does not.

### 1.3 The read routes have no session guard — by design, stated plainly

None of the fifteen routes guards on a session, and `routes/api/` sits outside the `(dashboard)`
group, so that group's guest bounce never runs for them. That is deliberate (a capability bounce
would make every Dev Context Switcher axis inert — Decision #53(b)), but it should be said out loud
rather than assumed:

- With a gate **off**, a signed-out caller gets the fixture corpus, which belongs to nobody.
- With a gate **on**, the live branch requires a resolvable actor (`canReadLive`), and RLS under that
  actor's own JWT is the real gate. `anon` additionally holds **no USAGE on the `projects` schema**
  (`00002500` revokes it and re-grants only to `authenticated`/`service_role`), so an unauthenticated
  live read fails `42501` rather than returning rows.

Verified by execution: with both gates on and no cookie, neither service issued a query.

### 1.4 `ctx.state.accessToken` is never populated on any `/api/*` route

`routes/(dashboard)/_middleware.ts` is its only writer, and `routes/api/` is that group's sibling. A
live read that reached for it would bind `getUserClient(undefined)`, query as `anon`, and return
nothing — indistinguishable from an empty account. `apps/web/utils/api-session.ts` names the existing
cookie-fallback idiom once so fifteen routes cannot each get it subtly wrong.

---

## 2. Contract contradictions — now RESOLVED in the mapping layer

**All fifteen reads now reach Postgres.** Verified by execution: with the gates on, a session cookie
present and `SUPABASE_URL` pointed at an unroutable host, all fifteen logged a distinct table read
attempt and degraded to fixtures — proving the live branch executes rather than falling through.

The contradictions below are kept because they are still the reason certain fields come back NEUTRAL
rather than populated, and because each is a live trap for anyone editing either side. They are no
longer blockers: every one is reconciled in `services/projects/live-support.ts`, in one place, with
its mapping pinned by `live-support_test.ts` against the literal enum members in the migration. A
mapping written per-endpoint would have been ten chances to spell `revisions_requested` the way Zod
does rather than the way the database does — and that mistake does not fail loudly.

| #  | Contradiction | Consequence |
| :- | :------------ | :---------- |
| 1  | **Submission status spelling.** Zod `SubmissionStatus` has `revision_requested`; the CHECK on `projects.stage_submissions.status` writes `revisions_requested` (plural). | Every revision row fails Zod parse. The column is also NULLABLE and a SQL CHECK is NULL-tolerant, so an explicit NULL is storable, passes the constraint, and fails the required Zod field. |
| 2  | **Stage status enum.** `projects.project_stages.status` is `stage_status` (open/assigned/in_progress/submitted/approved/revisions/paid/cancelled); `StageChannel.status` reuses `ProjectStatus` (draft/active/on_hold/completed/cancelled). | Exactly **one** shared member (`cancelled`). `stageLocked(stage) = stage.status !== "draft"` is written against a value the DB can never produce. |
| 3  | **`InviteStatus`** is `(pending, expired)`; the DB CHECK allows `('pending','accepted','expired','revoked')`. | Two storable values fail parse. |
| 4  | **`project_status` has `archived`; Zod `ProjectStatus` does not.** | Handled: archived rows are excluded from the feed at the query level (correct on its own terms — it is the soft delete), but the alternative was never available. |
| 5  | **`FileItem` is a narrowing of `AssetItem`** that re-mandates `channelId`/`channelName`/`channelKind`/`messageId`/`messageText`/`sender` as non-null `min(1)`; `comms.channel_files` has **no `message_id`**. | A channel-level file can satisfy `AssetItem` and can **never** satisfy `FileItem`. |
| 6  | **`BoardStageRef.categoryWeight`** is bounded 0..10 and has **no column anywhere**. | It drives the workload figure `W_i`, so inventing it makes the number plausible and wrong. Already flagged by Decision #64(b). |
| 7  | **No presence column exists** in either schema; `MemberPresence` is required, not nullable. | The roster cannot state what it is required to state. |
| 8  | **`projects.project_participants.role`** is unconstrained free text with no CHECK and no default; the only value the migrations write is `'assignee'`. | Not a member of `ProjectViewerRole` at all. (Happy accident: `MemberRole`'s seven members match `project_invitations.role`'s CHECK exactly.) |
| 9  | **No per-viewer read watermark for a project channel.** `comms.project_channel_participants` is keyed by `(profile_type, profile_id)` — a PROFILE, not a user — has no `user_id` and no `last_read_at`, and is consulted by no RLS policy. | `ProjectChannel.unread`, `StageChannel.channel.unread` and `ProjectSummary.unread` have no backing. The DM side has all four columns on `dm_participants`. |
| 10 | **`MessagingSettings.notifications`** carries four per-event booleans `comms.notification_prefs` does not have; `muteAll: boolean` maps onto a three-state `muted_until timestamptz`. | Needs the sparse `notification_category_prefs` + `notification_type_mutes` pair, where a missing row *and* a NULL column both mean "inherit". |
| 11 | **`marketplace` is not exposed to PostgREST**, but `ProjectSummary.serviceId` and `AutoResponseRule.serviceName` both resolve through it. | `EngagementKind` is derived from `source_blueprint_id`'s mere presence instead; the service-filter list is returned **empty** rather than fixture-derived, because an empty list means "no filter available" while the fixture list would render a filter that selects nothing. |
| 11b | ✅ **FIXED — `projects.projects` had NO policy granting a PARTICIPANT SELECT.** The only two SELECT paths were `"Users can view own projects"` and `"Public can view active published projects"`, so a freelancer hired onto a private project could not read the project row — the engagement they were working on was invisible to them while every stranger's public listing was not, and every dependent read (detail, board, members, files, submissions) inherited the hole because each resolves the project first. | Closed with one policy on the predicate the rest of the schema already uses for this question: `USING (projects.has_project_access(id))` — owner, freelancer participant, business participant, stage assignee, or a member of an assigned team. It is `SECURITY DEFINER`, so reading `projects.projects` inside it does not re-enter the policy. |
| 12 | 🚨 **The unified-inbox contract has no live representation.** `ProjectChannel.chatId` and `ConversationSummary.id` must be the same string (Decisions #21/#22/#49). Fixtures mint `dm-{handle}` on both sides. Live, `comms.dm_threads.id` is a v4 uuid and `comms.project_channels` has **no `chatId` column at all**. | The live path returns the thread's real uuid — the honest answer for a row that exists. Reconciling needs a deterministic id convention, a new `chat_id` column on both tables, or a shared resolver. **This is the hardest single mapping and needs a human.** |

### 2.1 Two structural properties, not contradictions

- **Truncation is a contract.** Every free-text column is unbounded `text` while its Zod field is
  bounded and **throws** rather than truncating — `ChatMessage.text` 4000, `ConversationSummary.preview`
  200, `ProjectDetail.description` 2000, `BoardCard.description` 4000. One long row 500s the whole
  read. The live path clamps at the mapping boundary, in one place, so a new consumer cannot forget.
- **No monotonic column exists in `comms`.** Every PK is `uuid DEFAULT gen_random_uuid()` — v4,
  random, not time-ordered — and there is no `seq`, identity or ordinal on any table. Cursors are
  therefore the `(created_at, id)` pair, base64url-encoded to fit `max(80)`. The id half is not
  decorative: `created_at` has a `now()` default, so rows inserted in one transaction share an
  instant and a timestamp-only cursor would skip or repeat the tie.

### 2.2 Also worth knowing

- **`comms.project_messages.pii_masked` / `pii_categories`**: the body may arrive already rewritten
  by `trg_mask_message_pii`, the original is not stored anywhere, and `ChatMessage` has **no field to
  say so**. A reader watches an email vanish with no explanation. `dm_messages` has no such trigger,
  so DMs are never masked — an asymmetry the client cannot detect either.
- **`has_attachments` / `is_audio`** are denormalised booleans **no trigger maintains**. Treat as
  advisory; derive from `comms.message_attachments`.
- **`comms.message_attachments` is polymorphic with no FK on `message_id`** (Postgres cannot point one
  column at two parents), so **PostgREST cannot embed it**. Attachments need a second keyed query.
- **Zero indexes on any messaging table.** `00004006_indexes_comms.sql` is entirely notification-engine
  indexes. Every query in `messaging/live-queries.ts` is a sequential scan today.
- **`comms.channel_files` uses the bare `'project'`/`'dm'` discriminator** while
  `message_attachments`/`reactions`/`pins`/`favorites` use schema-qualified
  `'comms.project_messages'`/`'comms.dm_messages'`. Two vocabularies for one concept in one schema;
  matching the wrong one returns no rows rather than erroring.
- **`org.users_public` has no `display_name`, no `handle` and no `avatar_url`.** The real columns are
  `username`, `first_name`, `last_name` and `avatar_file_id` — the last a FK into `files.items`, not a
  URL. Every party's `avatar` is therefore `null` on the live path; a guessed path would render a
  broken image on every row.

---

## 3. Deviations from the brief, recorded rather than resolved silently

| Brief said | What shipped | Why |
| :--------- | :----------- | :-- |
| "14 read endpoints" | 15 | `/api/messaging/settings` is a `GET`+`POST` preference read the brief appears to have dropped. All 15 are covered. |
| `docs/architecture/QUERY_OPERATOR_RECOMMENDATIONS.md` | `documentation/architecture/…` | Root `CLAUDE.md` §0: "All markdown documentation lives under `documentation/`." No `docs/` exists. |
| "make the read services async" (implied by live DB branches) | Async **only** where a live path exists | `list`/`item` and messaging `conversations`/`conversation`/`messages` are async. The eleven blocked reads stay synchronous: a `Promise` that never awaits buys nothing today and would force ~20 out-of-scope slot resolvers and the dashboard layout async. They keep an optional `actor` parameter so their call sites are already correct the day a live path lands. |

---

## 4. What was verified, and what was not

**Verified by execution** — production build (`deno task build`, exit 0) served by
`deno serve _fresh/server.js`, measured with `curl`:

- **All 15 endpoints reach Postgres.** With the gates on, a session cookie present and
  `SUPABASE_URL` unroutable, each of the fifteen logged its own distinct table read
  (`projects.projects`, `comms.dm_participants`, `comms.project_channels`,
  `comms.notification_prefs`, …) and degraded to fixtures. The previous code returned identical
  fixtures on both sides of every gate and could not demonstrate this at all.
- With the gates on and **no** cookie, no service issued a query (`canReadLive` short-circuits).
- **All 15 are HTTP-conforming**: `GET` 200, `HEAD` **0 bytes** with headers byte-identical to `GET`
  (including `Content-Length`), `If-None-Match` → **304 with 0 bytes** in both strong and `W/` forms,
  `OPTIONS` 204 advertising `Allow: GET, HEAD, OPTIONS` — and `GET, HEAD, OPTIONS, POST` on the two
  routes that also serve a write. A cross-origin preflight receives no `Access-Control-Allow-Origin`.
- On `/api/projects/board` the 304 turns a **283 KB** repeat into ~200 bytes.
- Every dashboard route renders (`/projects`, `/messages`, `/files`, a project board): real HTML,
  no `[object Promise]`, no server errors — the async-component conversion works end to end.
- **553 unit tests**, including 33 for the ARC policy (scan resistance pinned against an LRU baseline
  that FAILS the same workload), 29 for the HTTP semantics, and 22 pinning the enum reconciliations
  against the literal member lists in the migrations.

**NOT verified — stated, not claimed:**

- **No SQL was executed.** Docker's Linux engine is down and no `psql` exists in this environment, so
  every migration in this pass — the DM policies, the five newly-protected tables, the three new
  predicates, the participant SELECT policy, the `TRUNCATE` revoke — is authored and structurally
  reviewed only. Same footing as Decision #67(a). A structural validator (paren balance, statement
  termination, every referenced function defined, every referenced column existing, RLS-vs-policy
  coverage per table) reports clean and shows every `comms` table RLS-on, but that is not the same as
  Postgres accepting it.
- **The live reads have never seen a real database.** They are proven to ISSUE their queries and to
  degrade correctly when the query fails; the rows they would map back have not been observed. Every
  column name and enum literal was checked against the migration files — twice, after two were found
  wrong — but a live `select` is the only thing that proves a mapping.
- **`OPTIONS` is intercepted by Vite in DEV.** Anyone testing it against `deno task dev` measures
  Vite's CORS middleware, not this code. Production is correct.
- **An unsupported verb returns Fresh's 404, not a 405.** The router answers before any handler runs,
  so `methodNotAllowed()` is unreachable; the RFC-correct 405 + `Allow` needs middleware.
- **The skeletons were not rendered in a browser.** Their geometry is derived from the live
  components' own CSS and virtualizer arithmetic, not measured on screen.
- **The ARC cache has no live hit-rate evidence.** It only runs on the live path.

## 5. Adversarial review — eight defects found in this pass's own work

The change was reviewed by five independent skeptics reading against the migrations. **Its automated
verification stage never ran** (the session hit its usage limit and all seventeen verifier agents
died), so the run reported `confirmed: 0 / refuted: 17` — a number that means nothing was checked,
not that nothing was wrong. Every candidate was therefore triaged by hand against the schema. Eight
were real and are fixed; the rest were either already addressed or not defects.

**Two were in the database mapping and would have been silently wrong forever:**

| # | Defect | Why it mattered |
| :- | :----- | :-------------- |
| 1 | `.eq("profile_type", "user")` — the `profile_type` enum is `('freelancer','business')`; there is **no `'user'`** | Every viewer-role read would raise `22P02` on every request. The lookup swallows its errors by design, so the whole feed would degrade to `viewerRole: "member"` for everyone, permanently, with no log line. Now keyed on `profile_id` alone, which is the discriminating column anyway. |
| 2 | Stage progress counted against `"completed"` — `stage_status` is `('open','assigned','in_progress','submitted','approved','revisions','paid','cancelled')` | `completedStages` would be `0` forever while `totalStages` stayed correct, so a finished project renders a *plausible* "0/5" rather than an obvious break. Now counts `approved` + `paid`. |

**One was a privacy leak this pass introduced:**

| # | Defect | Why it mattered |
| :- | :----- | :-------------- |
| 3 | `view_own_dm_participation` had a second arm returning every co-participant's row | RLS is ROW-level, and every private per-viewer field lives on that row. Alice could read whether Bob muted, archived, deleted or last read their conversation. Narrowed to own-row-only, with a new `comms.dm_thread_roster()` returning identity (`thread_id`, `user_id`, `joined_at`) and nothing else. |

**Three were correctness bugs in the live reads:**

| # | Defect | Why it mattered |
| :- | :----- | :-------------- |
| 4 | The feed read relied on RLS alone | The policies are OR-ed and one is `"Public can view active published projects"` — the entire public marketplace. The 500-row cap would fill with strangers' projects and push the viewer's own out. The feed is now scoped to involvement (owner or participant) *before* the read. RLS answers "may I see this"; the feed answers "am I working on this". |
| 5 | The inbox scanned messages with ONE global cap across all threads | Ordered across threads, so a few busy conversations consume the window and every quieter thread reports zero — which the `messageCount > 0` visibility rule then deletes. A user with forty conversations would see three. Now one bounded tail per thread, and a thread whose tail could not be *read* is exempt from the visibility rule, because unmeasured is not empty. |
| 6 | The message cursor encoded the instant as epoch **millis** | `created_at` is `timestamptz` (microseconds). The truncated value made `created_at = cursor` match nothing, so the `AND id <` tie-break — the entire reason the id was in the cursor — could never fire, and every message sharing the boundary millisecond was skipped silently. The cursor is now the row id and the server reads the real timestamp back at full precision. |

**Two were in the cache and the HTTP layer:**

| # | Defect | Why it mattered |
| :- | :----- | :-------------- |
| 7 | TTL expiry demoted the aged-out key into a **ghost** list | A ghost means "I evicted this for capacity and may have been wrong", and ARC reacts by shifting `p` and evicting a live neighbour to re-admit it. With five entries in a 512-slot cache, every refresh of an expired key evicted a warm one. Every invariant still held and every test still passed — only a hit-rate measurement could see it. Expiry now deletes, and REPLACE is guarded on actual fullness. |
| 8 | `stableStringify` serialised `Date`/`Map`/`Set` to `{}` | Their data lives in internal slots, so `Object.entries` returns `[]`. Two different date ranges would share one cache key. No consumer passes one today; the point is that the failure would be silent and tenant-correct. |

**Plus one that made the rest unreviewable:** six literal **NUL (U+0000) bytes** were embedded in
`cache.ts` as the key delimiter (and one in its test), so git classified both files as binary and
reported `Bin 0 -> 19238 bytes` instead of a diff — the whole ARC implementation, including defect 7,
was invisible to normal review. This is the defect class Decision #67 already records. Replaced with
`\u0000` escapes: identical at runtime, plain text on disk, 489 reviewable lines.

**Two more were found and fixed before the review, by the same reading:** the short-circuit guard
branch broke GET/HEAD parity (its test asserted status and an empty body without ever diffing the
headers, so it passed vacuously), and `OPTIONS` under-reported the method set on the two routes that
also serve `POST`. Both now have tests that fail against the old behaviour.

**Still open from the review, recorded not fixed:** the SELECT policies call a `SECURITY DEFINER`
predicate once per candidate row against DM tables that have **no indexes at all**, so a
5,000-message thread evaluates it 5,000 times and each evaluation scans `dm_participants`. And
`comms.get_or_create_dm_thread` ignores `deleted_at` while the new predicate honours it, so a user
who soft-deleted a participation can be handed back a thread they can no longer read. Both are
pre-existing schema properties this pass makes reachable rather than creates.

---

## 6. Related

- [`QUERY_OPERATOR_RECOMMENDATIONS.md`](./QUERY_OPERATOR_RECOMMENDATIONS.md) — the HTTP `QUERY`
  evaluation (recommendation: do not implement yet; §9 lists what would change that).
- [`../../API_BACKLOG.md`](../../API_BACKLOG.md) — the platform-wide inventory of surfaces with no
  backend. Its headline finding (seventeen of twenty fat services contain zero Supabase calls) is now
  two services less true.
