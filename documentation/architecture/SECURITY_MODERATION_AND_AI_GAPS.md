# Security, Moderation & AI-Pipeline Gap Analysis (2026-10-29)

> Read-only evaluation of the trust-and-safety layer across messaging, files, search and ops. It
> covers the Decision #147 contact-leakage pipeline (Tier 1 edge filter, Tier 2 `comms.mask_pii`,
> Tier 3 Presidio), the Decision #148 Two-Zone moderation model (NudeNet publication gate, reactive
> reports, Standing penalties), malware scanning (ClamAV), and the grant, policy and trigger surface
> of the `comms`, `files`, `search` and `ops` schemas. Its companion,
> [`COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md`](COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md), owns functional
> completeness; this document owns everything an attacker or a rule-breaker can reach, and the
> companion links here rather than restating it. The **wiring, data contracts, sizing and runbooks**
> of the planned safety node (Presidio, NudeNet + OCR, ClamAV) are specified in
> [`../api/EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md`](../api/EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md)
> §6 (cited **EPI §6.x**, Decision #335); this document does not restate them. It records what the
> code must change before that node can be plugged in, and where the node alone would not close a gap.
>
> No code was changed. Evidence grades: **[proven]** = reproduced on the local stack
> (`supabase_db_Projective`, 2026-10-29) inside a transaction that was **rolled back**; **[code]** =
> verified by reading the cited line; **[doc]** = read in documentation only. New contradictions are
> recorded as **Decision #340** (§7; the companion's are #339). Findings already raised by the
> parallel identity audit (Decision #336, `IW-*`) are cited, not re-raised.
>
> Abbreviations (all under `supabase/migrations/`): **T12 / T13 / T15 / T16** =
> `0000001{2,3,5,6}_tables_{security,ops,projects,comms}.sql` · **F1001** =
> `00001001_functions_security_context.sql` · **F1100** = `00001100_functions_projects_read_access.sql` ·
> **F1130** = `00001130_functions_projects_stages.sql` · **F1150** =
> `00001150_functions_projects_stage_funding_submissions.sql` · **F1160** = `00001160_functions_files.sql` ·
> **F1300** = `00001300_functions_comms_channels.sql` · **F1310** = `00001310_functions_comms_notifications.sql` ·
> **F1400** = `00001400_functions_search.sql` · **TR1820 / TR1840 / TR1895** = `00001820_triggers_projects.sql`,
> `00001840_triggers_comms.sql`, `00001895_triggers_derived_columns.sql` · **P2010 / P2011 / P2012 / P2014 /
> P2017** = `000020{10,11,12,14,17}_policies_*.sql` · **G2500 / G2510 / G2520** = `00002500_permissions_schema_grants.sql`,
> `00002510_permissions_function_grants.sql`, `00002520_permissions_table_grants.sql` · **RT2600** =
> `00002600_permissions_realtime_publication.sql` · **V3002** = `00003002_views_messaging.sql` · **S5040 / S5060** =
> `00005040_seed_storage_buckets.sql`, `00005060_seed_scheduled_jobs.sql` · **SA** = `SYSTEM_ARCHITECTURE.md` ·
> **PS** = `PRODUCT_SPEC.md`.

## 0. Premise corrections

The commissioning brief carried assumptions that the code contradicts. They are corrected first so
the plan does not build on them.

| Brief assumed | Actual (source) |
| :-- | :-- |
| Tier 1 is an "Edge Regex / Unicode confusable filter" | **Not built.** SA:1125 and PS:976 say Tier 1 is "today only the composer's advisory warning", but no messaging composer calls `containsPii`: its only importers are the feedback board (`features/feedback/core/compose-state.ts:2`, `services/community/FeedbackBackendService.ts:2`). `maskPii` runs only on stub/fixture paths (`MessagingBackendService.ts:457`) and on invite notes. There is no confusable folding anywhere. |
| Tier 2 is "the trigger `comms.mask_pii`" | `comms.mask_pii(text)` is the `IMMUTABLE` matcher (F1300:269-309). The triggers are `trg_mask_message_pii` on `comms.project_messages` and `trg_dm_messages_mask_pii` on `comms.dm_messages`, both **`BEFORE INSERT` only** (TR1840:6-14). |
| The `comms.project_messages` UPDATE hole lets a sender edit `pii_masked` | **Half closed.** G2520:323-325 revokes table UPDATE and re-grants only `UPDATE (body, body_delta, edited_at, deleted_at)`; `supabase/probes/comms_column_grants.sql:96-108` asserts that `pii_masked` / `pii_categories` cannot be cleared. The **body** half is open and is now proven (E1). SA:1136-1139 is stale on this point. `comms.dm_messages` has no UPDATE policy at all (P2012:213-241). |
| A Presidio container, a NudeNet container and a ClamAV deployment exist to be integrated | **None exists.** No client, queue table, worker, Docker or compose file, or environment key for any of the three. The only "scanner" is `supabase/functions/scan-file`, a mock that flags a file whose *name* contains "virus" or "eicar" (`index.ts:211-227`). It is enabled with `verify_jwt = false` and is itself a vulnerability (E4). |
| Quarantine is a status | Quarantine is a **bucket**. The status enum is `pending_upload · scanning · uploaded · error · quarantined` (`00000004:367-369`), and `quarantined` is the terminal *rejected* state, not the holding one. |
| The Two-Zone publication gate runs in `MediaBackendService` | Planned there (SA:1179-1195), but two public buckets — `catalogue` and `public_assets` — have **no pipeline writer at all**. They are written directly by clients (P2017:309-319, :375-385), so a gate in the media service could never see them (§3.1). |

---

## 1. Exploitable now — the P0 register

Every row is reachable with a signed-in user's own JWT through PostgREST (every schema below is in
`supabase/config.toml:17` `schemas = […]`), except E4 and E5, which need no account at all.

> **Status (2026-10-29, after this audit): E1, E2, E3 (with G2), E4 (with G8, G20), E5 and E7 are
> fixed in place** — `00001300` / `00001840` (mask on edit, sticky categories), `00001895`
> (`handover_unlocked_at` derived, `status` door-only), `00002510` (comms deny-by-default, search
> definers service-only), `00000016` + Zod (`action_url` in-app paths only), `00001160` (no client
> promotion target), `00003002` (`security_invoker`), and `supabase/functions/scan-file` deleted.
> `supabase/probes/trust_p0.sql` replays each exploit and must print only PASS. **E6 and E8 stay
> open** (E8 waits on #340 (d)), as does every P1–P3 item.

| ID | Hole | Who | Evidence | Grade |
| :-- | :-- | :-- | :-- | :-- |
| **E1** | **Masked message re-written after the mask ran.** The sender `PATCH`es `comms.project_messages.body`; nothing re-masks it, and the edited row is re-broadcast on the realtime publication (RT2600:10). | Any channel member, on their own messages | Column grant G2520:325; policy `edit_own_messages` P2012:82-90 checks only sender + channel access; triggers TR1840:6-9 are `BEFORE INSERT`. On the local stack an edit stored `call me on +44 7700 900123 or me@example.com` with `pii_masked = false`; the identical text inserted fresh was stored `call me on [phone hidden] or [email hidden]`. | **[proven]** |
| **E2** | **Protected phase lifted by the client.** A reviewer `PATCH`es `projects.projects.handover_unlocked_at` (or `status = 'completed'`, which TR1820:11-15 turns into an unlock). Every channel and DM mask for the engagement lifts, and the full file library unlocks (F1150:1671-1674). Setting `status` directly also skips `set_project_status`'s settlement checks. | The project owner or any reviewer (`projects.can_review_project`) | `GRANT ALL ON ALL TABLES IN SCHEMA projects TO authenticated` (G2500:121); policy "Reviewers can update their projects" (P2011:193-196); no guard on either column among the triggers on `projects.projects` (TR1820, TR1895, `00001890`). Locally, an owner's `UPDATE … SET handover_unlocked_at = now()` was accepted and `projects.is_protected_phase` went from `t` to `f`. | **[proven]** |
| **E3** | **Any user can call every `comms` definer, including `fn_notify`.** A forged mandatory notification ("Payout failed — re-enter your bank details") can be written into any user's inbox with an attacker URL. The inbox renders `action_url` as a raw `href` (`features/notifications/components/NotificationRow.tsx:65`; Zod `actionUrl: z.string()`, `packages/types/comms/notifications.ts:50`; no `CHECK` in T16), so `javascript:` and off-site phishing links are live. The same hole lets a client force `fn_process_queue`, `fn_build_digests`, `fn_escalate_unread` and read another user's quiet hours and suppression state. | Any signed-in user | G2510:443-462 grants these to `service_role` but **never revokes the Postgres default EXECUTE-to-PUBLIC**; `org`, `projects`, `editorial`/`community` and `finance` all have a schema-wide revoke (G2510:15, :44, :140, :976), `comms` does not. Locally, `has_function_privilege('authenticated', …)` is `t` for `fn_notify`, `fn_notify_many`, `fn_enqueue`, `fn_process_queue` and `mask_pii`; a user called `fn_notify(p_user_id => <another user>, …, p_action_url => 'https://evil.example/login')` and the victim's row was written with that URL. | **[proven]** |
| **E4** | **`scan-file` is an unauthenticated service-role write primitive.** It takes any posted `fileId`, flips it to `scanning` (hiding any file, public avatar and showcase renditions included, because `get_public_media` requires `uploaded`), and streams the row's quarantine bytes to the row's `target_bucket` / `target_path` **as the service role with `x-upsert: true`**. A client may set both columns on its own `INSERT`, so an attacker can overwrite any object in any bucket (another user's avatar, `verification`, `invoices`). | Anyone, wherever the function is served (the local edge runtime serves it on every `supabase start`; hosted only if it was ever deployed) | `supabase/config.toml:461-463` (`enabled = true`, `verify_jwt = false`); CORS `*` and service-role client (`index.ts:6-9`, `:34-41`); status flip `:69-71`; upsert stream `:137-151`; the `INSERT` arm of `files.fn_guard_pipeline_columns` pins `status`, `bucket_id`, `purpose` and the link facets but **not** `target_bucket` / `target_path` (F1160:583-621), which are checked only on `UPDATE` (:623-642). Nothing in the repo calls the function. Also raised as Decision #335 flag (d) (EPI §9.5). | **[code]** |
| **E5** | **Guest-callable search definers bypass RLS.** `search.fn_search_entities` and `search.fn_search_global` are `SECURITY DEFINER`, granted to `anon`, and called by **no** application code. The profile branch returns real names, username and country from `org.users_public` for every indexed freelancer, `visibility = 'private'` included, and lets a guest search by real name with `ILIKE`; the project branch returns description, owner and client name for completed, cancelled, archived and on-hold public projects; `p_limit` / `p_offset` are unclamped. | Anyone with the public anon key | Definers F1400:367-386, :637-645; grants G2510:198-201 (schema-wide) and :227-244; profile branch F1400:554-575, name search :616-617; anon has no `SELECT` on `org.users_public` at all (P2010:10-13). Locally, `anon` read **0** rows of `org.users_public` directly and **12 named freelancers** through `fn_search_entities`. The seed holds no private users and no non-active public projects, so those two arms are verified in code only. | **[proven]** (RLS bypass) / **[code]** (private and non-active arms) |
| **E6** | **The search index is wider than the tables it indexes.** `projects_index.is_active = visibility = 'public' AND status <> 'draft'` (F1400:142), so completed, cancelled and archived public projects are listed; a team row is always `true` (:79); freelancer and business rows never get the flag set from `visibility` / `status`. These rows are readable through the anon `SELECT` policies (P2014:10-21), the column grants (G2520:133-145) and `search.fn_nearest` / `fn_nearest_to_entity`, which promise to "answer nothing anon could not already read" (`database/search/Functions.md:186-189`). The app is shielded because it re-resolves every hit against the anon catalogue; a direct REST or RPC caller is not. | Anyone | Directory predicates in `00003001_views_profiles_business.sql:98,156,191,225,260,312` list only `visibility IN ('public','unlisted')` and `status = 'active'`. | **[code]** |
| **E7** | **`comms.message_file_details` is a definer view.** Any signed-in user can list every message attachment platform-wide — display name, MIME, size, `storage_path`, `message_id` — through PostgREST. The three notification views beside it are `security_invoker`; this one is not. | Any signed-in user | V3002:3-6; `pg_class.reloptions` is `NULL` for this view and `{security_invoker=true}` for the other three; `SELECT` granted to `authenticated`. The seed has no attachments, so the leak is shown from the catalogue, not from rows. | **[code]** + catalogue |
| **E8** | **Storage write policies bypass quarantine, metering and immutability.** Any project participant may `UPDATE` (upsert) *any* object under the project's prefix, and any workspace member any object under the entity's prefix — no owner check. A file that was sniffed, decoded and admitted can be swapped for arbitrary bytes afterwards; the proxy then serves them under the row's stale MIME type and hash. Direct `INSERT` is also open into `project`, `messages`, `personal` and `workspace`, and into the two **public** buckets `public_assets` and `catalogue` (SVG allowed in `public_assets`, S5040:130), which skips the publication gate entirely. No application path uses any of these policies. | Project participants, workspace members, any user (own prefix of the public buckets) | P2017:61-85 (project INSERT/UPDATE), :112-126 (messages), :141-153 (personal), :185-234 (workspace), :309-319 (`public_assets` `FOR ALL`), :375-385 (`catalogue`). | **[code]** |

### 1.1 Commercial reading

E1 and E2 are not abstract. Disintermediation is the single largest revenue risk of a managed
marketplace: the 5% stage-completion fee (`finance-model.md`) and escrow TVL both disappear the moment
a client and a freelancer move off-platform. The Tier 2 trigger is the one control the spec calls
"the floor" (PS:982-983), and today the **client** — the party with the most to save — can lift it
with one `PATCH` (E2), while either party can smuggle details past it by editing (E1). Upwork and
Fiverr both treat this as a fraud signal, not a messaging feature. E3 attacks the other half of the
pitch: a trust-first escrow product whose own inbox can carry a forged "payout failed" phishing
notice is a reputational incident, not a bug.

---

## 2. Contact & financial leakage pipeline (Decision #147)

### 2.1 Tier matrix

| Tier | Designed | Implemented | Status |
| :-- | :-- | :-- | :-- |
| 1 · In-process pre-filter | NFKC + confusable folding, `linkify-it` / `tldts` URL extraction, the four Tier 2 categories, Luhn on 13-19 digit runs; refuse `422` naming the category (SA:1115-1124) | Absent from both send doors: `services/messaging/live-writes.ts:140-154` and `services/projects/live-writes.ts:2648-2660` insert without any check. The composer warning SA:1125 describes does not exist in messaging (§0). | ❌ |
| 2 · Database enforcement | `BEFORE INSERT` triggers, every path, authoritative (SA:1130-1135) | Shipped for `INSERT`; bypassable by edit (E1), forged unlock (E2), Delta smuggling (L2) and derivation gaps (L4) | ⚠️ |
| 3 · Async deep NLP | Self-hosted Presidio, queue, worker, review queue (SA:1141-1152) | Nothing: no queue table, worker, client, env key or container | ❌ |
| Public copy (§1.B) | Refuse at create/update in each owning write door (SA:1161-1166) | No check in `org.save_profile` (`00001040:986`), the catalogue functions (`00001170`) or the catalogue / project write services | ❌ |

### 2.2 Tier 2 bypass inventory

| ID | Bypass | Evidence | Fix (edit in place) |
| :-- | :-- | :-- | :-- |
| L1 | Edit after insert (= E1) | §1 | TR1840: `CREATE TRIGGER trg_mask_message_pii BEFORE INSERT OR UPDATE OF body, body_delta ON comms.project_messages …`; F1300 `tg_mask_message_pii`: on `UPDATE`, make the flags sticky — `NEW.pii_masked := OLD.pii_masked OR <hit>`, `NEW.pii_categories := ARRAY(SELECT DISTINCT unnest(OLD.pii_categories \|\| v_cats))`. Add `OR UPDATE` to `trg_dm_messages_mask_pii` as defence in depth. Extend `supabase/probes/comms_column_grants.sql` to edit a protected message with an email and assert `[email hidden]` is stored — the probe currently asserts only that the edit is *permitted* (:109-111). |
| L2 | **Delta smuggling.** The trigger returns early on an empty `body` (F1300:334-336) and nulls `body_delta` only when `body` itself hits. `body: "hi"` plus a Quill Delta that spells a phone number is stored verbatim and is readable over PostgREST and realtime; only the app's renderer drops it (`packages/types/projects/message-rich.ts:135-140`). | **[code]** | F1300, both mask functions: inside the protected phase, null the Delta whenever the body is empty or the Delta does not spell the stored body — `IF NEW.body_delta IS NOT NULL AND (coalesce(NEW.body,'') = '' OR comms.fn_delta_text(NEW.body_delta) IS DISTINCT FROM NEW.body) THEN NEW.body_delta := NULL; END IF;` with a new helper `comms.fn_delta_text(p_delta jsonb) RETURNS text LANGUAGE sql IMMUTABLE` (`string_agg(op->>'insert','' ORDER BY ord)` over `p_delta->'ops'`). |
| L3 | Forged unlock (= E2); a project can also be **inserted** born-unlocked | §1 | TR1895: `BEFORE INSERT OR UPDATE` guard making `handover_unlocked_at` derived (`security.fn_guard_derived_columns('handover_unlocked_at')`) and `status` door-only (`security.fn_guard_immutable_columns('status')`); both guards already pass definers, because they act only when `current_user` is `anon` or `authenticated` (F1001:348-397, :404-434). Trigger names sort alphabetically, so name the guard to fire **after** `trg_project_handover_on_complete`. Before landing, grep for any user-JWT `status` writer (`projectColumnPatch`, `services/projects/live-writes.ts:1080-1110`, writes none). |
| L4 | **DM derivation gaps.** `comms.fn_dm_protected_project` (F1300:359-385) protects a DM only while both people are party to a project in `draft · active · on_hold` through `projects.fn_engaged_projects` (F1100:1517-1548). Unprotected: (a) members of the client business other than its owner; (b) declined or expired applications and invitations — a rejected applicant can DM "cheaper off-platform, email me"; (c) a `cancelled` project, which an owner may set at any time (F1100:1152) — while the stage-channel check `is_protected_phase` (F1100:1499-1510) ignores status, so the two predicates disagree; (d) every pre-proposal conversation — service inquiries and profile DMs. | **[code]** | (a) and (c) are defects: add a business-members arm and align the status predicate with `is_protected_phase`. (b) and (d) need a ruling (#340 (b)): a cooling-off window after an engagement ends, and whether the pre-engagement window is protected at all (§2.6). |
| L5 | **Column forging on `INSERT`.** Message tables keep table-level `INSERT` (G2500:68), so a client may set `created_at`, `edited_at`, `deleted_at`, `pii_masked` and `pii_categories` on insert — backdating dispute evidence. | **[code]** | G2520 §2: `REVOKE INSERT … ; GRANT INSERT (channel_id, sender_user_id, body, body_delta, reply_to_id, …)`, mirroring the UPDATE fix; the trigger then owns the `pii_*` columns. |
| L6 | **Invitation notes bypass the mask.** "Owner manages invitations" is `FOR ALL` with no column grant (P2011:1126-1145), so the owner writes `project_invitations.message` (T15:1103) directly instead of through `invite_to_project`'s mask (F1130:2030-2031). | **[code]** | `BEFORE INSERT OR UPDATE OF message` mask trigger in TR1820, or a column grant in G2520. |
| L7 | **Counterparty-visible text that is never masked.** Reaction `emoji` (16 chars of free text, direct `INSERT`, T16:410-420, P2012:322-328); attachment `files.items.display_name` and link assets; group and channel `title` / `topic` / `emoji` (T16:141-162); `stage_submissions.notes` / `description` / `feedback`, `stage_revision_requests.reason`, ticket `title` / `description` / `tasks` (T15:393-478, :568-595, :725); scheduling event titles; `org.profile_links` (#147 flag (a)). | **[code]** | One shared `comms.fn_mask_protected(p_project uuid, INOUT p_text text)` helper and a `BEFORE` trigger per surface, scoped to the protected phase. Ticket and submission text is the largest gap: it is where a deliverable note naturally carries "send the source files to …". |
| L8 | **Regex coverage** (F1300:284-305). Misses: full-width and Arabic-Indic digits; zero-width, `_` `/` `,` separators; full-width `＠`; "name at gmail dot com"; spelled-out numbers; numbers split across messages; `@handles` (the spec bans social handles, PS:956 — the `handle` category covers only `$cashtags`); LinkedIn / Instagram / Calendly / Discord URLs, which link previews then render as rich cards; IBANs; crypto addresses. False positives: ISO dates such as `2026-10-29` mask as `phone` (#147 flag (e)); the bare words "paypal" and "zelle" mask. | **[code]** | Tier 1 owns normalisation and Luhn (§2.3); Tier 2 gains the categories Tier 1 adds **in the same change** (PS:982-983). Add an IBAN (mod-97) and a crypto-address category; tighten the phone pattern to require a digit count ≥ 9 after separators are stripped, which clears ISO dates. |
| L9 | `mask_pii` is declared `IMMUTABLE` but uses locale-dependent POSIX classes, and is executable by `authenticated` (E3), which hands anyone a free oracle for testing evasions. `pii.contract.test.ts` pins the pattern *strings*, not the behaviour of the regexes `maskPii` actually runs (`pii.ts:31-53` uses `\p{L}` / `\S`). | **[code]** | Revoke with E3's fix; mark `STABLE`; replace the string pin with a shared fixture corpus run against both implementations. |

### 2.3 Tier 1 — the contract to build

- **Where.** One pure module, `packages/types/comms/pii-detect.ts` (types package, so the composer
  can run the same function advisorily), called by **both** send doors before the insert:
  `MessagingBackendService.sendMessage` and `ProjectBackendService.sendMessage`, plus
  `comms.send_request_message`'s caller and every L7 surface's write service.
- **Pipeline.** NFKC → strip `\p{Cf}` (zero-width) → fold confusables (a vendored
  Unicode `confusables.txt` subset; Latin, Cyrillic, Greek and full-width digits are enough to start)
  → collapse `at`/`dot` spellings → extract URLs and bare domains (`linkify-it`, registrable domain via
  `tldts`) → match the payment/messaging host list **read from the same SQL source as Tier 2** →
  Luhn on 13-19 digit runs → mod-97 on IBAN-shaped runs.
- **Output.** `{ refused: boolean, categories: PiiCategory[] }`. A refusal is `422` with the category
  list; the composer shows it inline. Refusals are counted, not stored (#147 flag (b) still needs a
  ruling on refusal logging; recommendation: count per user per day in `ops.log_entries`, never the text).
- **Contract test.** One fixture corpus (`packages/types/comms/pii.fixtures.ts`) run against
  `pii-detect.ts`, `maskPii`, and — through a probe — `comms.mask_pii`, asserting Tier 2 masks every
  case Tier 1 refuses.

### 2.4 Tier 3 — what the code must change before Presidio can plug in

The integration itself — `ops.moderation_queue`, the `moderation-drain` job posting to
`/api/ops/cron/moderation` with `MODERATION_CRON_SECRET`, `ModerationBackendService` in
`services/moderation/`, the analyzer request with Projective's `ad_hoc_recognizers`, scoring weights
in `security.platform_params`, fail-open with Tier 2 as the floor — is EPI §6.2. Readiness today is
nil: none of those objects exists. Four deltas this audit adds to that design:

| # | Delta | Why |
| :-- | :-- | :-- |
| T3-1 | Enqueue on `UPDATE OF body` as well as `INSERT` | EPI §6.2 enqueues on `AFTER INSERT`. Until L1 lands, an edit is the cheapest evasion (E1), and even after it an edit is a fresh body Tier 3 has not seen. |
| T3-2 | Score a **per-thread window** (the sender's last N protected messages), not one row | A number split across messages ("07700" / "900" / "123") defeats every single-row scorer; EPI's spelled-number recogniser needs seven words in one body. |
| T3-3 | Extend the queue to the L7 surfaces (`stage_submissions.notes`, revision reasons, ticket text, attachment names) | Deliverable notes are where "send the source files to …" naturally lives; EPI §6.2 covers the two message tables only. |
| T3-4 | Never enqueue a row Tier 2 already masked unless it is a near-miss | Keeps analyzer load proportional to risk; EPI's `reason` enum already has `near_miss`. |

The review sink (`ops.reports.source` vs a separate findings table) is EPI flag (g); this audit
recommends the `source` column so one reviewer queue serves user reports and automated findings
(§3.3).

### 2.5 Public copy (§1.B) must be enforced in the database

The design puts the public-copy refusal in the service write doors (SA:1161-1166, PS:1010-1013), but
PS:982-983 makes the database the floor, and the doors are not the only writers:
`catalogue.listings` and `catalogue.products` grant `INSERT` / `UPDATE` to clients (G2520:722), and
`marketplace.service_blueprints` and `projects.projects` carry owner `UPDATE` policies
(`00002018:35-37`, P2011:193). The refusal must therefore be a `BEFORE INSERT OR UPDATE` trigger that
`RAISE`s with a field-named `SQLSTATE` the services translate to `422` — the pattern the feedback
board already uses (`00001320:402-408`). `org.users_public` has no client write policy
(TR1895:59-62), so `org.save_profile` alone is sufficient there. This is a doc contradiction to record
(#340 (c)).

### 2.6 Strategic call — the pre-engagement window

PS:954 starts the protected phase "from the initial proposal". The code is narrower still (L4), and a
service inquiry or a profile DM before any proposal is unprotected by design. That window is
precisely where Fiverr and Upwork concentrate their filtering, because it is where a buyer who has
found talent through the marketplace decides whether to pay through it. **Recommendation:** extend
Tier 2 to any thread whose first message was sent through a marketplace surface (service inquiry,
listing, explore card, proposal) until a first escrow funds or 30 days pass, and keep ordinary
profile-to-profile DMs between connected users unprotected. It needs a ruling because it changes
user-visible behaviour (#340 (b)).

---

## 3. Two-Zone moderation (Decision #148)

### 3.1 What reaches the Public Glass Front unscreened today

| ID | Path | Evidence | Status |
| :-- | :-- | :-- | :-- |
| Z1 | Avatar and showcase **stills** — re-encoded WebP renditions cut by the service role, but no classifier runs | `services/media/showcase-rendition.ts:115-151` | ❌ gate absent (designed, SA:1179-1195) |
| Z2 | Showcase and listing **videos** — the original bytes are copied verbatim to the public `showcase` bucket: no re-sniff, no metadata strip, so phone GPS and device atoms are published. Arbitrary bytes can also arrive "as a video": the hub stores the client's declared MIME when the sniff misses (`services/files/live-uploads.ts:275`) and client-supplied `metadata` (:281); `readLibrarySource` accepts any owned `video/*` row with a width and height (`media/library.ts:149-161, 392-407`). | `showcase-rendition.ts:24-28` (docblock: "a video published as uploaded"), :169-181 | ❌ contradicts PS:728-730 ("no location data … ever reaches a visitor") |
| Z3 | `catalogue` and `public_assets` — direct client writes, SVG allowed in `public_assets` (= E8) | P2017:309-319, :375-385; S5040:130 | ❌ #148 flag (b) still open |
| Z4 | A private-library row set to `visibility = 'public'` (at upload init, `live-uploads.ts:159`, or via `/api/files/visibility`) streams its **original**, EXIF included, to anonymous readers through the proxy | `files.fn_can_read` public arm F1160:152; P2011:667-671; `services/files/live-objects.ts:70-75` | ❌ outside both zones as defined (#340 (e)) |
| Z5 | A private group's photo is written to the public `avatars` bucket | `comms.set_group_photo` (Decision #308) | 📄 zone undefined (#340 (f)) |
| Z6 | Public text — `headline`, `bio`, listing, service and project copy — has no hate-speech or leakage screen | §2.5 | ❌ |

### 3.2 The NudeNet publication gate — prerequisites the gate cannot supply

EPI §6.3 specifies the gate: `POST /v1/images/screen` on the safety node, NudeNet labels plus OCR
contact entities, thresholds in `security.platform_params` `moderation_image_thresholds`, a
`files.publication_screenings` verdict record, `422` / correction notice on `flagged`, `503` on
`unavailable`. Its hook points are the rendition cut, the catalogue media writes "once they move
behind the pipeline", and `public_assets` writes. Against today's code that gate would guard **one
door of five**:

| # | Prerequisite | Gap it closes | Why the gate cannot |
| :-- | :-- | :-- | :-- |
| P-1 | Drop the client write policies on `catalogue` and `public_assets` (G10) and route catalogue media through `cutShowcaseRendition` (`services/catalogue/live-catalogue-writes.ts:241` already does for listings) | Z3 | A client `PUT` to a public bucket never passes through any service. |
| P-2 | Re-sniff and **remux** a published video (strip metadata atoms, re-encode or `-c copy` with `-map_metadata -1`), or refuse video renditions until a remux job exists | Z2 | Screening the poster and sampled frames still publishes the original bytes, GPS included, and accepts non-video bytes labelled `video/*`. |
| P-3 | Rule on `visibility = 'public'` library rows (#340 (e)) | Z4 | The proxy serves the original; no rendition is ever cut, so no hook fires. |
| P-4 | Treat the group photo as a publication (#340 (f)) | Z5 | `set_group_photo` writes `avatars` outside the rendition path EPI names. |
| P-5 | Screen public **text** at the same write doors (§2.5) | Z6 | NudeNet and OCR see pixels only; hate speech in a bio is a text classifier's job (a small self-hosted model or the hosted fallback), not yet chosen. |

Open beyond EPI: frame-sampling density for GIF and video; categories NudeNet does not cover
(graphic violence, hate symbols) — the hosted fallback EPI keeps off by default, or a second model;
the reason vocabulary for the correction notice (#148 flag (g)).

### 3.3 Reactive moderation — absent end to end

| ID | Control | Evidence | Status |
| :-- | :-- | :-- | :-- |
| R1 | `ops.reports` table | T13 defines six tables, none of them reports (`database/ops/Tables.md:11-12` says "two" — stale) | ❌ #148 flag (a) |
| R2 | Report route and UI | None; the explore kebab's stub Report was removed (Decision #140; `CardActions.island.tsx:22`). No dead control remains. | ❌ (honest) |
| R3 | Reviewer surface | `apps/web/features/admin` holds only `DisputeRulingDialog` | ❌ |
| R4 | `security.penalties` writer for content | `source_type` has no `content_report` value (T12:92); nothing writes `pii_violation` | ❌ #148 flag (d) |
| R5 | Penalties move Standing | `fn_recalc_penalty_aggregates` (F1001:24-43) feeds `search.profiles_index` and `business_profiles.system_penalty_score`, but never `org.entity_standing.penalty_severity`, which is read (`00001030:78`) and never written | ❌ #148 flag (c) — the Consequences ladder (PS:1056-1063) has no input |

**Build order.** R1 (with the snapshot built server-side under the reporter's JWT, SA:1216-1222) → R4 →
R5 → R3 → R2 last, so the button never renders before a reviewer can act on it (§3.11 gate).

### 3.4 Strategic flag — known illegal material in the private zone

The private zone is a creative safe harbour with "no automated content screening" (PS:1025), yet
PS:1044-1047 commits to escalating illegal content, including any sexual content involving minors,
"beyond the platform as the law requires". Classification and **hash-matching** are different
things: matching uploads against an industry list of *known* illegal images (PhotoDNA or an
equivalent hash list) does not judge creative work, cannot misfire on life drawing or anatomy
modelling, and is the norm for any platform that stores user images. **Recommendation:** treat
known-hash matching as platform integrity — like the contact filter — that runs on every image
upload in both zones, outside the Two-Zone screening question. This is a legal question before it is
an engineering one and needs counsel (#340 (g)).

---

## 4. Malware scanning (ClamAV)

### 4.1 Current state

- **No scanner.** `scan-file` is the only candidate and it is a filename mock (§0) that writes
  statuses the enum does not have (`'clean'`, `'infected'`, `index.ts:96`, :170) and a column that
  does not exist (`scan_notes`, :97). Its `VIRUSTOTAL_API_KEY` is read and unused (:16) and absent from
  `.env.example`. Nothing calls it. It is also E4.
- **Docs disagree with themselves.** SA:2436 lists "Virus Scanning: automated scanning of quarantined
  storage files" as a core function and SA:284 a "Virus Scanner" processor, while SA:1940-1941 and
  :2348-2350 say no malware scan is wired; `database/files/Storage.md:264-265` says objects arrive
  "after passing … AV scan" and :537-540 of the same file says "there is no malware scanner"
  (#340 (h)).

### 4.2 Upload-acceptance gaps a scanner will not fix on its own

| ID | Gap | Evidence | Fix |
| :-- | :-- | :-- | :-- |
| V1 | The `/files` hub admits everything that is not PE / ELF / Mach-O — HTML, SVG, archives, macro-bearing Office files, scripts, MSI / LNK, polyglots. A file that sniffs as an image but fails to decode is still admitted. | `live-uploads.ts:273-274` (refuses `executable` only), :283-293 | Refuse the `markup` family or force `application/octet-stream`; refuse a failed decode of a sniffed image. |
| V2 | A sniff miss stores the **client's** declared MIME | `live-uploads.ts:275` | Fall back to `application/octet-stream`; never persist a client `image/*` / `video/*` type or media envelope. |
| V3 | The sniff reads 64 bytes; PDF, ZIP and OOXML are not identified | `packages/types/files/sniff.ts:29`, :104-121 | Extend the sniffer (PDF `%PDF-`, ZIP local header + `[Content_Types].xml` for OOXML) so the scanner policy can branch by real family. |
| V4 | The decoder Worker inherits **every** server permission, `env` (the service-role key) included | `media/pipeline.ts:117` `new Worker(url, { type: "module" })` | Spawn with `deno: { permissions: { read: true, net: false, env: false, write: false, run: false, ffi: false, sys: false } }` (check whether the Deno version needs `--unstable-worker-options`). A decoder is the component most exposed to hostile bytes. |
| V5 | Unbounded decode queue; a queued job has no deadline; no memory budget (~160 MB per RGBA copy at 40 MP, two workers in one process); the header peek fails open when it cannot read dimensions | `pipeline.ts:179-203`; `image-codec.ts:128-129` | Bounded queue answering `503`; a queue deadline; refuse when the peek returns `null`. |
| V6 | Nothing reclaims abandoned `pending_upload` objects, rows stuck in `scanning` after a crash between `live-uploads.ts:251` and :315, failed promotions, or soft-deleted objects; `upload-init` has no rate limit and accepts `sizeBytes = 0` | S5060 has only `contact-attachment-sweep`; `idx_files_items_pending_upload` (`00004011:22-26`) serves a sweeper that was never built | A `files-upload-sweep` http job in S5060; a cap on outstanding declarations per user in `initUpload`. |

### 4.3 ClamAV — deltas to the EPI §6.4 contract

EPI §6.4 specifies the scan (`POST /v1/files/scan` → clamd `zINSTREAM`, the verdict-to-status
mapping on the real enum, `clamd.conf` limits, freshclam staleness alerts, VirusTotal hash-lookup
only and off for the MVP) behind the proposed `MALWARE_SCAN_LIVE` gate, failing closed (`503`, the
row back to `pending_upload`) when the node is unreachable. This audit agrees and adds:

| # | Delta | Why |
| :-- | :-- | :-- |
| AV-1 | Close E8 / G10 first | The three hook points EPI names are the pipelines; a direct client write to `project`, `messages`, `personal` or `workspace` — or a post-admission swap through the participant `UPDATE` policies — is never scanned. |
| AV-2 | Record the verdict on the row (`files.items.metadata.av = { engine, db_version, verdict, signature?, at }`) | EPI keeps the verdict in the response and the log; a per-row record is what makes the rescan job and a disputed refusal answerable without a schema change. |
| AV-3 | A rescan job in S5060 over recent originals after each signature update, plus a one-off backfill of existing objects | A file clean on Monday can match Tuesday's signatures; EPI alerts on stale signatures but does not rescan. |
| AV-4 | Fix V1–V6 independently of the scanner | ClamAV finds known malware; it does not stop an HTML or SVG file being admitted, a client MIME being trusted, or a decoder Worker holding the service-role key. |
| AV-5 | Rule on macro-bearing Office files | EPI sets `AlertEncrypted no` for password-protected creative deliverables; the same argument applies to `.xlsm` / `.docm`, which clamd's `AlertOLE2Macros` would refuse. Recommend: admit privately, record, never publish. |

---

## 5. Grant, policy & trigger gaps by schema

| ID | Schema | Gap | Evidence | Fix (edit in place) | Pri |
| :-- | :-- | :-- | :-- | :-- | :-- |
| G1 | comms | No schema-wide `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` (= E3). The app **depends** on the hole: `get_or_create_dm_thread` has no grant yet is called under the user's JWT (`services/messaging/live-writes.ts:83`). | G2510 | Add a comms region to G2510: revoke all, grant `service_role`, then grant back by name to `authenticated` the doors and RLS predicates the app needs (`get_or_create_dm_thread`, `get_or_create_project_channel`, `is_dm_participant`, `has_channel_access`, `can_access_scope`, `can_read_message`, `dm_thread_roster`, `mark_*`, `register_device` / `revoke_device`, `fn_resolve_type_key`, …). Add a probe asserting `fn_notify` is not executable by `authenticated`. | P0 |
| G2 | comms | `action_url` unconstrained and rendered as `href` | T16:93-129; `NotificationRow.tsx:65` | T16: `CHECK (action_url IS NULL OR action_url ~ '^/[^/\\]')`; the same regex in Zod; a render guard that drops anything else. | P0 |
| G3 | comms | `message_file_details` definer view (= E7) | V3002:3-6 | `CREATE VIEW … WITH (security_invoker = true)`. | P0 |
| G4 | comms | Mask triggers `INSERT`-only; Delta smuggling; insert-time column forging (L1, L2, L5) | §2.2 | §2.2 | P0 / P1 |
| G5 | comms | Project rooms accept posts after archive: the `INSERT` policy uses `has_channel_access`, which ignores `archived_at` | F1300:121-144; P2012:60-64 | Add `archived_at IS NULL` to `send_messages_if_member`. | P2 |
| G6 | comms | No body-length `CHECK` and no per-sender throttle on either message table; the app limit can be bypassed through PostgREST | T16 | `CHECK (char_length(body) <= 8000)` on both tables; a per-sender rate trigger (token bucket in an unlogged table) or an `ops`-level limiter. | P2 |
| G7 | projects | `handover_unlocked_at` and `status` writable by reviewers (= E2) | §1 | L3 | P0 |
| G8 | files | `fn_guard_pipeline_columns` `INSERT` arm does not pin `target_bucket` / `target_path` (enables E4) | F1160:583-621 | Refuse a client `INSERT` unless `target_bucket IS NULL OR target_bucket = 'contact'`, and require `target_path IS NULL` (the contact pipeline legitimately inserts `'contact'`, `contact/live-attachments.ts:81`). | P0 |
| G9 | files | A `source = 'link'` row may claim any `bucket_id`, `storage_path` and `status`; `fn_can_read`'s project arm then admits members, so a forged row is planted in another project's file listing | F1160:595-610, :176-182; `live-library.ts:569-574` | `INSERT` arm: links require `bucket_id = 'link' AND storage_path = NEW.id::text` (what `attachLink` writes, `live-library-writes.ts:317-318`); add `source = 'supabase'` to the project arm. | P1 |
| G10 | storage | Direct client writes to non-quarantine buckets (= E8) | P2017 | Keep the `SELECT` policies; remove the `authenticated` `INSERT` / `UPDATE` / `ALL` / `DELETE` policies on `project`, `messages`, `personal`, `workspace`, `public_assets`, `catalogue`; drop `image/svg+xml` from `public_assets` (S5040:130). Removing policies changes behaviour, so it needs explicit approval (#340 (d)). | P0 |
| G11 | search | Dead `fn_search_entities` / `fn_search_global` executable by `anon` (= E5) | G2510:227-244 | Revoke from `PUBLIC, anon, authenticated` in G2510 now; deleting the functions from F1400 needs a human decision. | P0 |
| G12 | search | Index visibility flags wider than source RLS (= E6) | F1400:79, :94-101, :142, :177-185 | Edit the sync functions so `is_active` uses the directory predicates; make `sync_user_to_index` also update the freelancer row. | P1 |
| G13 | search | `search.query_logs` `INSERT` policy admits `auth.uid() IS NULL`, and `anon` holds `INSERT` (proven): a guest can write query-log rows in another user's name, which that user then sees | P2014:28-35; G2520:16 | Revoke `INSERT` from `anon` and `authenticated`; the app writes only through `fn_log_query`. | P2 |
| G14 | search | `search.is_admin(uuid)` executable by `anon` through the schema-wide grant (proven) — an admin-uuid oracle | G2510:198-201; F1400:345-353 | `REVOKE EXECUTE ON FUNCTION search.is_admin(uuid) FROM PUBLIC, anon`. | P2 |
| G15 | search | `discovery_penalty` readable by guests on every penalised profile, while `security.penalties` itself is own-or-admin only | G2520:133-135; `00002019:19-23`; documented as intended in `database/search/Tables.md:114-117` | Drop the column from the anon grant and read it server-side (#340 (i)). | P2 |
| G16 | search, org | Erasure leaves search data (extends IW-H6 / Decision #336 (a), whose table list omits the `search` schema): the freelancer row stays active with its embedding of the erased profile; `query_logs` keeps `user_id`, raw text and the query vector forever; `user_affinity` and `interest_events` stay linked. Contradicts the published "erased after 30 days" (`features/legal/core/content/privacy.ts:233`). | `00001060:532-581` | `fn_erase_account` / `fn_erase_freelancer_profile`: deactivate and null `embedding*` on `search.profiles_index`, null `user_id` and `query_embedding` in `query_logs`, clear `user_affinity`, null `interest_events.user_id`; add a `query_logs` retention job to S5060. | P1 |
| G17 | security | `security.is_admin()` is `SECURITY DEFINER` with no pinned `search_path` — already recorded as Decision #336 (G); listed here only because the `comms` and `search` fixes touch the same file | F1001:49-60 | `SET search_path = ''` with qualified names. | P3 |
| G18 | search | `fn_nearest` / `fn_nearest_to_entity` pin `search_path = search, public` (F1400:995, :1054) and the sync triggers put `public` first (:90, :111, :173, :193, :281); the hardened functions in the same file use `''` | F1400 | Pin `''` and qualify the pgvector operator (`OPERATOR(public.<#>)`). | P3 |
| G19 | ops | No moderation tables (R1) | T13 | §3.3 | P1 |
| G20 | edge | `scan-file` (= E4; #335 (d)) | `supabase/config.toml:461-467` | Delete `supabase/functions/scan-file/` and its config block. It is code, not schema, so the Additive Rule does not apply. | P0 |

---

## 6. Safety-node readiness — the order that makes it worth plugging in

EPI §2 places the node in Zone D (private link only, one bearer or mTLS identity, no payload kept)
and EPI §6.1 sizes it at 4 vCPU / 8 GB. Bringing it up before the database holes close would buy
little: every analyzer sits **behind** a door the attacker can walk around today.

| Step | Close first | Then plug in | Fail mode (EPI §6.6) |
| :-- | :-- | :-- | :-- |
| 1 | E1–E3 (masking edits, forged unlock, comms grants) | Tier 1 in-process (§2.3) — no node needed | n/a (refuse `422`) |
| 2 | E4, E8 (scan-file, direct bucket writes) | ClamAV at admission (§4.3) | Closed |
| 3 | Z2–Z5 prerequisites (§3.2) | NudeNet + OCR at publication | Closed |
| 4 | R1 (`ops.reports` with `source`) | Presidio Tier 3 (§2.4) | Open — Tier 2 is the floor |

**Sub-processor honesty.** SA:1149-1150 says message bodies "never leave Projective's
infrastructure". That holds for bodies, but `services/files/link-reputation.ts:8-10` already sends
every posted URL to Google Safe Browsing (disclosed in `privacy.ts:167`; EPI flag (c) separately
records that Safe Browsing's licence is non-commercial and proposes Web Risk). The SA sentence
should say so (#340 (j)).

---

## 7. Decision #340 — security & moderation flags

| Flag | Question | Proposal |
| :-- | :-- | :-- |
| (a) | SA:1136-1139 says a sender can rewrite `pii_masked` and that `dm_messages` "is not exposed"; G2520:323-325 closed the flag columns, and `comms` is exposed (`config.toml:17`) | Factual correction; keep the body-edit hole (E1) as the open half of #147 (c) until L1 lands |
| (b) | Protected-phase scope: PS:951 ("all messaging channels") vs PS:954 ("from the initial proposal") vs the derivation (pending/accepted engagements, three statuses, owner-only business arm) | Owner ruling: adopt §2.6 (marketplace-originated threads protected until first funding or 30 days) plus a cooling-off window after an engagement ends |
| (c) | Public-copy refusal in the write doors (SA:1161-1166, PS:1010-1013) vs "the database tier is the floor" (PS:982-983) and the client write grants (G2520:722, `00002020:43-59`) | Enforce as `BEFORE` triggers that `RAISE`; services translate to `422` |
| (d) | Removing the client write policies on six buckets (G10) | Approve; only the service role writes non-quarantine buckets |
| (e) | `visibility = 'public'` on a library row serves the original world-wide, outside both zones (SA:1176-1177 vs F1160:152) | Route `public` through the publish step (renditions only), or record it as an explicit Glass Front surface subject to the gate |
| (f) | Is a private group's photo (public `avatars` bucket) Glass Front? | Yes: it is world-readable by URL, so it is screened |
| (g) | Known-hash matching for illegal imagery in the private zone (§3.4) | Counsel ruling; recommended in both zones as platform integrity |
| (h) | Malware scanning described three ways (SA:2436, SA:284 vs SA:1940-1941, :2348-2350; `Storage.md:264-265` vs :537-540) | Correct SA:2436, SA:284 and `Storage.md:264-265` to "planned (EPI §6.4)" |
| (i) | `discovery_penalty` readable by guests (`database/search/Tables.md:114-117`) vs own-only `security.penalties` (`00002019:19-23`) | Server-side only |
| (j) | SA:1149-1150 "bodies never leave Projective's infrastructure" vs Safe Browsing URL lookups | Reword to "message bodies never leave; posted URLs are checked with a link-reputation provider" (the provider itself is EPI flag (c)) |
| (k) | `PS:976` / `SA:1125` say a composer warning exists; no messaging composer uses `containsPii` | Factual correction until Tier 1 lands |
| (l) | `Storage.md:541-543` ("nothing writes `target_path`") and `S5040:20-21` (a "SECURITY DEFINER promote" via `target_*`) vs the client-writable columns (F1160:583-621) and the in-process service-role promotion | Factual corrections with G8 |
| (m) | `database/ops/Tables.md:11-12` says T13 defines two tables; it defines six | Factual correction |

---

## 8. Prioritised backlog

> **Status (2026-10-30, Wave 0 comms/search):** fixed in place, replayed by
> `supabase/probes/trust_p1_comms_search.sql` — **L2** (`comms.fn_delta_text`; both mask triggers drop
> a Delta that does not spell the body, in every phase), **E6 / G12** (`00001400`: `is_active` is the
> directory's listed predicate; `sync_user_to_index` re-derives the freelancer row), **L4 (a) (c)**
> (client-business members in `fn_engaged_projects`; the DM mask reads `is_protected_phase`, no status
> filter), **L5** (column-scoped `INSERT` on both message tables), **L6** (invitation-note mask
> trigger), **G9** (link rows pinned to `link` / their id; the project read arm needs stored bytes).
> Still open from the P1 row: L4 (b) (d) (ruling T1), G16 (identity track).

| Pri | Item | Area |
| :-- | :-- | :-- |
| P0 | E4 / G20 delete `scan-file`; G8 pin `target_*` on `INSERT` | edge + DB |
| P0 | E3 / G1 comms schema revoke + grant-back; G2 `action_url` CHECK + Zod + render guard | DB + UI |
| P0 | E1 / L1 mask on `UPDATE` with sticky flags + probe; L2 Delta smuggling | DB |
| P0 | E2 / L3 `handover_unlocked_at` derived, `status` door-only | DB |
| P0 | E5 / G11 revoke the dead search definers; E7 / G3 `security_invoker` on `message_file_details` | DB |
| P0 | E8 / G10 storage write policies (after #340 (d)) | DB |
| P1 | E6 / G12 search index visibility; G16 erasure of search data | DB |
| P1 | L4 (a)(c) DM derivation defects; L5 insert column grants; L6 invitation notes; G9 forged link rows | DB |
| P1 | Z2 video remux or refuse; V1–V2 hub acceptance; V4 worker permissions | service |
| P1 | Tier 1 (§2.3) with the shared fixture corpus; L8 Tier 2 categories in the same change | types + DB |
| P1 | R1 → R4 → R5 → R3 → R2 reactive moderation loop | DB + service + UI |
| P2 | Safety node (EPI §6) in the §6 order: ClamAV (§4.3) → NudeNet gate (§3.2) → Presidio Tier 3 (§2.4) | infra + service |
| P2 | L7 unmasked surfaces; §2.5 public-copy triggers; G5, G6, G13, G14, G15; V3, V5, V6 | DB + service |
| P2 | After rulings: #340 (b) scope, (e) public library rows, (g) hash matching | product + legal |
| P3 | L9, G17 (already #336 (G)), G18; doc corrections (#340 (a), (h), (j)–(m)) | DB + docs |
