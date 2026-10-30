# Messaging, Notifications, Assets & Discovery Search Audit (2026-10-29)

> Read-only evaluation of four domains against `PRODUCT_SPEC.md`, `SYSTEM_ARCHITECTURE.md`,
> `ROUTING.md`, `DESIGN_SYSTEM.md` and `database/{comms,files,search,ops}/*`: real-time messaging and
> the global inbox (`/messages`, project stage rooms, `MessagingBackendService`); the notification
> engine (`comms.notification_types`, `comms.fn_notify`, transports, suppression); asset management
> and streaming (`/files`, the upload pipelines, `MediaBackendService`, `/api/media/proxy/[fileId]`,
> `/inspect/[fileId]`); and discovery search (`/explore`, `ExploreBackendService`,
> `EmbeddingBackendService`, `search.fn_nearest*`). It answers "is it complete and does it do what the
> spec says". Every **security** finding — anything an attacker or a rule-breaker can reach — lives in
> the companion [`SECURITY_MODERATION_AND_AI_GAPS.md`](SECURITY_MODERATION_AND_AI_GAPS.md) (cited
> here as **SEC E1**, **SEC G3** …) and is not restated.
>
> No code was changed. Evidence grades: **[proven]** = reproduced on the local stack inside a
> rolled-back transaction (2026-10-29); **[code]** = verified by reading the cited line; **[doc]** =
> read in documentation only. Lines are cited at the commit `a1017c09`. New contradictions are recorded
> as **Decision #339** (§7; the companion's are #340). Findings already raised by the parallel
> identity audit (Decision #336) and specified by the providers spec (Decision #335, cited **EPI**)
> are cited, not re-raised.
>
> Abbreviations (migrations under `supabase/migrations/`): **T16** = `00000016_tables_comms.sql` ·
> **F1160** = `00001160_functions_files.sql` · **F1300** = `00001300_functions_comms_channels.sql` ·
> **F1310** = `00001310_functions_comms_notifications.sql` · **F1400** = `00001400_functions_search.sql` ·
> **P2012** = `00002012_policies_comms.sql` · **P2017** = `00002017_policies_storage.sql` · **G2510** =
> `00002510_permissions_function_grants.sql` · **RT2600** = `00002600_permissions_realtime_publication.sql` ·
> **I4004** = `00004004_indexes_search.sql` · **I4006** = `00004006_indexes_comms.sql` · **S5010 / S5060** =
> `00005010_seed_notification_catalog.sql`, `00005060_seed_scheduled_jobs.sql` · **msg/** =
> `packages/backend/services/messaging/` · **files/**, **media/**, **explore/**, **search/** = the
> sibling service folders · **SA** = `SYSTEM_ARCHITECTURE.md` · **PS** = `PRODUCT_SPEC.md`.

## 0. Premise corrections

| Brief assumed | Actual (source) |
| :-- | :-- |
| Messaging is unified by `chatId` across the global inbox and project stage rooms | **Only in fixtures.** There are two stores — `comms.dm_threads` / `dm_messages` (kinds `dm`, `group`, `service_inquiry`, `entity_channel`) and `comms.project_channels` / `project_messages` — with two send routes, two services and two tables. On the live path a project's DM group is not drawn at all: `channels.dms` is always empty and nothing writes `dm_messages.project_id` (`services/projects/live-detail.ts:856-862`). SA:988-993 and PS:1116 describe the fixture behaviour. |
| Messages arrive in real time | **No live updates of any kind.** No Realtime subscription, poll or SSE exists in the app; `ChatFeed` appends only the sender's own `MESSAGE_SENT_EVENT` (`apps/web/features/projects/islands/ChatFeed.island.tsx:300-314`). Five `comms` tables sit in the realtime publication (RT2600) with no subscriber. |
| Notification channels are in-app realtime, push, email and SMS | **Only in-app materialises, and it is polled every 30 s** (Decision #173). There is no dispatcher: `supabase/functions/` holds only `scan-file`; `services/mail/verification-mailer.ts`'s transport returns `null`; the service worker has no `push` handler; `comms.register_device` has no caller. **SMS is in 0 of 112 catalog rows** **[proven]**, so it can never be routed. |
| Suppression tables gate sends | `comms.channel_suppressions` and `comms.fn_is_suppressed` exist; **nothing calls `fn_is_suppressed`**. |
| `fn_notify` is fail-open | True, and silent: one `EXCEPTION WHEN OTHERS THEN RETURN NULL` (F1310:545-548) with no `WARNING` and no trace — and it is executable by every signed-in user (**SEC E3**). |
| Quarantine-first → Worker-pool sniff/decode → admission → promotion to public buckets, in `MediaBackendService` | **Three pipelines**, not one: the `/files` hub (`files/live-uploads.ts`, admits anything that is not an executable), the media library (`media/library.ts`, pictures and video only, a still must decode) and `/contact` (`services/contact/live-attachments.ts`). Quarantine is a **bucket**; the Worker pool decodes JPEG, PNG, GIF and WebP stills only. Public objects are **renditions** cut by `showcase-rendition.ts`, not promotions, and `catalogue` / `public_assets` have no pipeline writer at all (**SEC E8**). |
| The File Inspector is "sandboxed" | The inspector **page** cannot be sandboxed — it runs the viewer engines. `'wasm-unsafe-eval'` is correctly scoped to it alone (`apps/web/utils/csp.ts:103-107`; only `InspectScreen.tsx` sends the `inspector` profile). The **raw bytes** are sandboxed: the proxy adds a `sandbox` CSP and `attachment` to anything not inline-safe (`media/stream.ts:118-135`). PDF is inline-safe and is served unsandboxed at the app origin (F20). |
| Voyage `voyage-4` embeddings over pgvector **tables** | Model, 1024 dimensions, unit length and `vector_ip_ops` are all confirmed. The vectors are **columns** on the four existing search tables (`profiles_index`, `projects_index`, `services_index`, `catalogue_index`, `00000018:17,38,58,78`), not dedicated tables. The default host is **MongoDB Atlas** (`ai.mongodb.com`); `api.voyageai.com` is used only for a `pa-` key or an explicit `VOYAGE_API_BASE` (`search/voyage-client.ts:26-37`). |
| Search index triggers maintain the embeddings | The `sync_*_to_index` triggers maintain `fts` and the visibility flags only. Embeddings are written by an **in-process** queue (`reembedInBackground`, 30 s debounce, lost on restart) and a manual `deno task embeddings:backfill`; no cron, no database queue. |

---

## 1. Messaging

### 1.1 Addressing and the unified-thread promise

| # | Capability | Spec | Implementation | Status |
| :-- | :-- | :-- | :-- | :-- |
| M1 | One thread per pair, the same record a project DM opens | PS:1116; SA:988-993 | Live project DMs are not drawn (§0). `dm-{handle}` resolves only through `comms.get_or_create_dm_thread` (`msg/live-writes.ts:83`) | ❌ live / ✅ fixtures |
| M2 | One chat stack everywhere | ROUTING:152 | `ConversationChat` wraps the project `ChatFeed` verbatim (`ConversationChat.island.tsx:18-25`); rooms, DMs and entity channels share `ChatFeed` + `ChatComposer` — but pass `projectId={conversationId}` | ✅ (naming debt) |
| M3 | One send door | SA:1027-1030 | `/api/messaging/messages/send` → `MessagingBackendService.sendMessage` → `dm_messages`, and `/api/projects/messages/send` → `ProjectBackendService.sendMessage` → `project_messages` | ⚠️ two doors, two Tier 1 insertion points (SEC §2.3) |
| M4 | Opaque prefixed refs (Decision #88) | root `CLAUDE.md` §4 | `/messages/<thread uuid>` routes a raw uuid (already Decision #218 flag (a)); `/messages/dm-<handle>` serves the same thread with no canonical redirect — two addresses for one conversation | ⚠️ |
| M5 | One thread per pair holds under concurrency | PS:1116 | `get_or_create_dm_thread` and `send_request_message` select-then-insert with no lock (F1300 ~:37-54, :1073-1088); `idx_dm_participants_thread_user` is not unique (I4006:35-36) | ❌ race |

### 1.2 Real-time delivery

| # | Capability | Spec | Implementation | Status |
| :-- | :-- | :-- | :-- | :-- |
| M6 | A new message reaches an open client | SA:342; Decision #173 ("chat has its own live channel") | Nothing: other people's messages appear only after a reload. The per-process read cache (30 s) is invalidated for the sender only (`msg/MessagingBackendService.ts:433`) | ❌ |
| M7 | Realtime publication | — | `project_messages`, `dm_messages`, `notifications`, `project_channels`, `dm_threads` (RT2600:10-18). Full rows, RLS-filtered, no subscriber. An unmasked **edit** would be broadcast (SEC E1) | ⚠️ unused surface |
| M8 | Presence, typing, read receipts | PS:3566 (`usePresence`) | None. `usePresence` is an overlay mount hook in `@projective/ui/overlay`; presence is hard-coded `online: false` | ❌ |
| M9 | Islands never touch Supabase | root `CLAUDE.md` §2 | None found under `features/*/islands` | ✅ |

### 1.3 Message lifecycle

| # | Capability | Spec | Implementation | Status |
| :-- | :-- | :-- | :-- | :-- |
| M10 | Read marks / unread | PS:1135-1139 | `dm_participants.last_read_at` has no writer (no RPC, no policy), so on the live path **every thread with a message is unread forever** (`msg/live-queries.ts:421-424`); project rooms always report `unread: false` (`live-detail.ts:327-330`) | ❌ |
| M11 | Edit / delete a message | PS (deleted originals, Evidence Vault) | No route, service or UI action. `dm_messages` has no `edited_at` and no `UPDATE` policy (T16:233-268); `project_messages` can be edited only by a raw PostgREST `UPDATE` — which is exactly SEC E1 | ❌ |
| M12 | Delete a conversation | PS:1131-1134 | `localStorage` only (`InboxView.island.tsx:301-305, 330`; `MessagesSidebar.island.tsx:388-409`); `dm_participants.deleted_at` has no writer | ❌ |
| M13 | Mute | ROUTING:875 | `/messages` header and row mute are `localStorage` only (`ConversationHeader.island.tsx:140-143`); only `WorkspaceChannelHeader.island.tsx:119` calls `setMuted` (Decision #308 flag (a)) | ⚠️ |
| M14 | Folders and requests | PS:1131-1139 | `set_dm_inbox_folder`, `send_request_message`, `fn_promote_thread_on_reply` | ✅ (request cap 4,000 at F1300:1052 vs an 8,000 send cap) |
| M15 | Attachments | PS:1188 | Linked after the message insert; the link inserts' results are not checked (`msg/live-writes.ts:164-177`) | ⚠️ |
| M16 | Reactions | — | Optimistic and local only (`ChatFeed.island.tsx:373-393`); `comms.message_reactions` and its policies are never written | ❌ §3.11 |
| M17 | Pins, favourites | ROUTING:796 | `/api/messages/[id]/pin`; favourites via the saved system | ✅ |
| M18 | Voice memos | — | Only `is_audio` is stored; `ChatMessage.audio` is lost on reload (`msg/live-writes.ts:198-201`) | ⚠️ Zod ↔ DB drift |
| M19 | Archived rooms refuse posts | P2012:228-241 (DMs) | Project rooms do not (SEC G5) | ⚠️ |

### 1.4 Service and route quality

| # | Check | Evidence | Status |
| :-- | :-- | :-- | :-- |
| M20 | Thin routes | All 25 messaging and notification routes are one service call | ✅ |
| M21 | Zod at the route | GET routes hand-parse queries (`api/messaging/messages.ts:25-33`, `conversation.ts`, `contacts.ts`, `members.ts`, `context.ts`, `messages/[id]/pin.ts`) | ⚠️ |
| M22 | `ServiceResult<T>`, auth guard | Throughout; writes `401` guests | ✅ |
| M23 | Send rate limit | None on either door; only hire invitations are limited (`ProjectBackendService.ts:662-673`). An app limit is bypassable through PostgREST anyway (SEC G6) | ❌ |
| M24 | Fixture vs live | A live-read failure, or a signed-in actor without a valid token, **silently receives the fabricated fixture corpus** (`MessagingBackendService.ts:132-138, 196, 275-280`); fixture `dm-{handle}` ids could then resolve to real accounts on send | ❌ — outside dev, answer `401` / `503` |
| M25 | Not-found conversation | Soft 404 (`200`, `routes/(dashboard)/messages/[conversationId]/index.tsx:30`) | ⚠️ |

---

## 2. Notifications

### 2.1 The catalog and routing matrix

`comms.notification_types` (S5010) is a sound design: per-type `default_channels`, `mandatory`,
`overrides_quiet_hours`, `digestible`, `audit`, `group_window` and `action_url_template`, plus
user preferences at three grains (global, category, type) over four transports. The data does not
match the promise:

| Metric | Value **[proven]** | Spec |
| :-- | --: | :-- |
| Catalog rows | 112 | SA:2455 says 94 (stale) |
| Mandatory | 40 | PS:1243-1247 |
| Rows routing to email | 82 | — |
| Rows routing to push | 50 | — |
| Rows routing to SMS | **0** | PS:1239 promises SMS as a fourth transport |
| `message.*` emitters | **0** callers | the Settings → Messaging toggles imply them |
| Delivery rows stuck `pending` | every non-in-app row (14 locally) | no dispatcher |

### 2.2 `comms.fn_notify` execution

| # | Capability | Spec | Implementation | Status |
| :-- | :-- | :-- | :-- | :-- |
| N1 | Fail-open | SA:2471 | Savepoint semantics keep the caller's transaction alive, but the catch-all returns `NULL` with no `WARNING` (F1310:545-548), and the `audit` insert is swallowed the same way (:538-541) — a money event can lose its audit row silently | ⚠️ — `RAISE WARNING` with the SQLSTATE in each handler |
| N2 | Preferences, quiet hours, snooze | PS:1243-1253 | `fn_resolve_channels`: mandatory returns early (:256), skipping snooze **and** quiet hours; quiet hours drop push and SMS only (:314) | ⚠️ 📄 (#339 (b)) |
| N3 | Collapse repeated events | PS:1255-1256 | Collapses by `group_key` within `group_window` (:437-461); overwrites title, body and payload but not channels or deliveries, and takes no lock | ⚠️ race |
| N4 | Payload hygiene | — | Copied verbatim from the caller. No `message.*` emitter exists, and the `application.received` excerpts are masked first (`00001130:1143-1144`). But `enterprise.domain_colleague` puts a newcomer's full email in the body (`services/auth/AuthBackendService.ts:503-513`) — already Decision #336 (e) / IW-H1 | ⚠️ |
| N5 | Callers | — | ~70 SQL call sites across org, projects, finance, scheduling, ops and community; one TypeScript caller (service role); zero from messaging. Legacy underscored keys still emitted (`00001150:1256, 1643, 1696`; Decision #57 (a)) | ⚠️ |
| N6 | Only the service role writes notifications | SA:2476 | No client `INSERT` policy — but **SEC E3** | ❌ |
| N7 | Action URLs follow Decision #88 | — | 39 templates build `/projects/{context_id}` uuid links that #88 says 404; the emitters checked pass an explicit slug URL, so this is latent | ⚠️ |

### 2.3 Transports

| Transport | Designed | Built | Status |
| :-- | :-- | :-- | :-- |
| In-app | Inbox + bell, realtime | `NotificationInboxBackendService`; polled every 30 s with ETag (Decision #173) | ✅ (polled) |
| Push | Web push / FCM / APNs via registered devices | `comms.devices` + `register_device` exist; no caller, no `push` handler in the service worker, no sender | ❌ |
| Email | Transactional + digests | No sender. The webhook in `fn_dispatch_notification` is flag-off, its URL is `XXXX-XXXX`, and it is **unauthenticated** — only a `Content-Type` header (F1310:1141-1144; Decision #335 flag (e) proposes a Vault-held bearer). Settings copy ("Sent to your primary email address") overstates reality | ❌ |
| SMS | Security and time-critical alerts | Enum, preferences and Settings UI only; 0 catalog rows | ❌ |

### 2.4 Suppression, digests, escalation, retention

| # | Capability | Spec | Implementation | Status |
| :-- | :-- | :-- | :-- | :-- |
| N8 | Suppression consulted before send | PS:1252-1253 | `fn_is_suppressed` has no caller | ❌ |
| N9 | Unread escalation to email | PS:1258 | `fn_escalate_unread` adds email deliveries from the global `p.email` with no suppression, category or type check (F1310:925-944) | ❌ |
| N10 | Digests | PS:1256-1257 | The resolver honours a per-**category** digest (:290), but `fn_build_digests` selects only users with a **global** digest (:1004), so category digests are silently lost | ❌ |
| N11 | Reminders cancelled when the reason disappears | PS:1261-1263 | `fn_enqueue` / `fn_cancel_queued` exist; `fn_enqueue` has 0 callers | ❌ |
| N12 | Scheduled engine | SA:2467; `database/comms/Functions.md:22` ("every minute") | **No comms job is registered** in S5060 **[proven]**: queue, escalation, digests, expiry sweep, dead-device reaper and delivery compaction never run | ❌ |

### 2.5 Recommended build order

The dispatch pipeline, Web Push (VAPID), APNs / FCM, transactional email with signed inbound
webhooks, and Twilio are specified provider by provider in
[`../api/EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md`](../api/EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md)
§8 (Decision #335, Proposed). This audit adds the order in which they are worth building, given
what exists:

1. **Close SEC E3 / G1 / G2 first** — a dispatcher that faithfully delivers forged notifications by
   email is worse than none.
2. **Register the comms jobs** in S5060 (queue, escalation, digests, sweep, reaper, compaction) so
   the engine that already exists runs.
3. **Email** next (EPI §8.5): transactional, mandatory money and security events only, with
   suppression consulted (N8) and bounces writing `comms.channel_suppressions`. Sign the outbound
   dispatch webhook (F1310:1141-1144 sends only a `Content-Type`) before it carries anything.
4. **Web push** (EPI §8.2) for the 50 push-routed types.
5. **SMS last** (EPI §8.6 already places Twilio in Growth), and only for security alerts and
   session-starting-now reminders: per-message cost, SIM-swap exposure, and no catalog demand today.
   Until then, remove SMS from the Settings UI or lock it with a reason (§3.11), and correct PS:1239.

---

## 3. Files, streaming & the inspector

### 3.1 Ingestion

| # | Capability | Spec | Implementation | Status |
| :-- | :-- | :-- | :-- | :-- |
| F1 | Every upload declared in quarantine | SA:2346-2347 | The `INSERT` guard admits a `supabase` row only as `pending_upload` in `quarantine` (F1160:589-594); signed upload URLs are minted for `quarantine` only (`files/live-uploads.ts:141, 168`; `media/library.ts:444, 468`; `contact/live-attachments.ts:98`) | ✅ |
| F2 | A client cannot flip status, bucket, path, type, size or hash | F1160:511-517 | `UPDATE` arm refuses them (F1160:623-642); the claim is a conditional service-role update (`live-uploads.ts:251-257`) | ✅ |
| F3 | Nothing bypasses quarantine | `00002017` header | Direct client writes to six buckets (**SEC E8**); `target_*` unpinned on `INSERT` (**SEC G8**); forged link rows (**SEC G9**) | ❌ |
| F4 | Dedupe before transfer | PS:3297-3301 | Browser fingerprint + `content_hash` | ✅ |

### 3.2 Sniff and decode

| # | Capability | Implementation | Status |
| :-- | :-- | :-- | :-- |
| F5 | Magic-byte sniff | Real but shallow: 64 bytes (`packages/types/files/sniff.ts:29`); markup detected only in the first 48 characters; PDF / ZIP / OOXML unidentified | ⚠️ (SEC V3) |
| F6 | Declared type never trusted | The hub stores the client's MIME when the sniff misses (`live-uploads.ts:275`) | ❌ (SEC V2) |
| F7 | Worker pool | `POOL_SIZE = 2`, 90 s timeout, crashed or timed-out workers replaced (`media/pipeline.ts:31, 34, 133-136, 179-181`) | ✅ — but unbounded queue and full permissions (SEC V4, V5) |
| F8 | Pixel-bomb limits | 40 MP and 12,000 px per edge, from the header and again after decode (`media/image-codec.ts:65-68, 222-257`); GIF first frame only | ✅ (header-peek fail-open, SEC V5) |
| F9 | Formats | Stills decoded: JPEG, PNG, GIF, WebP. Video: container sniff + client-supplied poster (`media/library.ts:596-607`). HEIC / TIFF / PSD: stored preview only (PS:3317) | ⚠️ — PS promises HEIC/TIFF/PSD previews the server never cuts |
| F10 | Library original | Kept byte-for-byte, EXIF included (`media/image-jobs.ts:22-24`); tiers re-encoded | ⚠️ acceptable while private; not once it is public (SEC Z4) |

### 3.3 Admission, renditions and quota

| # | Capability | Spec | Implementation | Status |
| :-- | :-- | :-- | :-- | :-- |
| F11 | Server-only admission | SA:2351-2354 | Service-role upload and update, `upsert: false` | ✅ |
| F12 | Public stills are fresh pipeline cuts | SA:2353; PS:728-730 | Re-encoded WebP from decoded pixels (`media/showcase-rendition.ts:115-151`); `avatars` / `showcase` have no client write policy | ✅ (unscreened — SEC Z1) |
| F13 | Public videos | PS:728-730 | Published byte-for-byte with metadata (SEC Z2) | ❌ |
| F14 | Storage quota | PS:3257-3272 ("meters and warns before it refuses") | Fail-open by design (F1160:243-272; `00005001:191` = off). Usage is metered from the server-measured size (`live-uploads.ts:304`), but direct bucket writes, renditions, tiers and quarantine objects are never metered — so when refusal is switched on, it will be wrong | ⚠️ |
| F15 | Retention / sweeps | — | Only `contact-attachment-sweep` (S5060:97-100); no upload, quarantine or soft-delete sweeper (SEC V6) | ❌ |

### 3.4 The streaming proxy — `/api/media/proxy/[fileId]`

This is the strongest piece of the domain.

| # | Capability | Implementation | Status |
| :-- | :-- | :-- | :-- |
| F16 | Same-origin streaming, no redirect | `media/stream.ts`, `packages/backend/core/storage-stream.ts:42-58` (`redirect: "manual"`, server-owned percent-encoded path, no host or bucket in headers) | ✅ |
| F17 | Per-request authorisation | Signed-in readers under RLS, guests with the anon client, share links via `fn_resolve_share` then the service client (`files/live-objects.ts:58-75`); requires `uploaded`, not deleted, `source = 'supabase'` (:77); non-uuid → 404 (`stream.ts:253`) | ✅ |
| F18 | Range / 206 / 304 / 416 / HEAD / ETag | Forwarded through an allowlist (`stream.ts:56-63, 138-163, 216-241`) | ✅ |
| F19 | Type from the stored row; never HTML | `proxyContentType` (`stream.ts:74-81`) — but the stored type may be the client's guess (F6) | ✅ / ⚠️ |
| F20 | `nosniff`, `attachment`, `sandbox` | On anything not inline-safe (`stream.ts:118-135`); PDF is inline-safe, so a top-level `?raw=1` navigation renders it unsandboxed at the app origin (`live-objects.ts:108`) | ⚠️ — serve PDF as `attachment` on document navigations |
| F21 | Caching | `private, no-transform, max-age=3600` + `vary: cookie`; share reads `no-store` (`stream.ts:126`). A revoked reader keeps a cached copy for up to an hour | ⚠️ — `max-age=300` or `no-cache` + ETag |
| F22 | Rate limit | 1,200/min sliding window, in-memory per process (`stream.ts:181`) | ⚠️ |
| F23 | Legacy redirect route | `/api/files/object/[id]` still redirects to a signed URL for the picker and the share-folder listing | ⚠️ — retire onto the proxy |

### 3.5 The File Inspector — `/inspect/[fileId]`

| # | Capability | Spec | Implementation | Status |
| :-- | :-- | :-- | :-- | :-- |
| F24 | Shell-free | PS:3305-3307 | `routes/(standalone)/` holds only `_middleware.ts` and `inspect/` — no `_layout` | ✅ |
| F25 | `'wasm-unsafe-eval'` scoped to the inspector | — | `PROFILE_RELAXATIONS.inspector = { wasm: true, blobConnect: true }` (`utils/csp.ts:103-107`); only `InspectScreen.tsx:26` sends it; the middleware leaves a route's own CSP alone (`routes/_middleware.ts:47-49`) | ✅ |
| F26 | Least privilege | — | The inspector profile is the app profile **plus** relaxations, so it also allows Stripe scripts and frames and `youtube-nocookie.com` (`csp.ts:65-67, 76, 91`), none of which a file viewer needs; `script-src` keeps `'unsafe-inline'` with no nonces (Decision #126) | ⚠️ — give `inspector` its own base (`script-src 'self' 'wasm-unsafe-eval'`, no Stripe, no frames) |
| F27 | Engines same-origin | — | Versioned `/vendor/…` paths; pdf.js with `enableXfa: false` and no scripting (`pdf-runtime.ts:31-40`) | ✅ |
| F28 | Script vectors | — | Markdown through DOMPurify (`markdown-runtime.ts:127`); SVG only via `<img>`; DOCX altChunks off, links vetted, scripts stripped — but `harden()` runs **after** insertion into the live DOM (`docx-runtime.ts:54-93`) | ✅ / ⚠️ — render into a detached node, harden, then adopt |
| F29 | Production CSP | — | A missing `DENO_ENV` is treated as development (`csp.ts:130`), so production loses `upgrade-insecure-requests` and gains `ws:` / `wss:` unless `DENO_ENV=production` is set | ⚠️ — default to production (the same rule Decision #336 (D) records for dev overrides) |
| F30 | Same "not available" page for every dead state; never indexed | PS:3325-3331 | `files.fn_can_read` + one fallback | ✅ |

### 3.6 The `/files` hub

| # | Capability | Spec | Implementation | Status |
| :-- | :-- | :-- | :-- | :-- |
| F31 | URL state | ROUTING:114-115, 470-472 | Folders are path segments (`/files/a/b`); the team and business drive uses `?path=` (#315). Sort, search and facets are client signals (`files-state.ts:116-137`) | ⚠️ #315 flag (a) still open |
| F32 | Hard-delete protection | Decision #314 | `fn_guard_hard_delete` (F1160:879-892); deletes are soft | ✅ |
| F33 | Service quality | — | Thin routes with Zod (`api/files/upload-init.ts:48`, `visibility.ts`, `list.ts`); islands never touch Supabase. The `live-*` modules redeclare a local `Result<T>` instead of `ServiceResult<T>` (`live-uploads.ts:48-53`); media routes import `@features/profile/core/respond.ts` | ⚠️ minor |

---

## 4. Discovery search & semantic ranking

### 4.1 Model contract

| # | Capability | Implementation | Status |
| :-- | :-- | :-- | :-- |
| S1 | Model `voyage-4` | `EMBEDDING_MODEL` (`packages/types/explore/embeddings.ts:14`); sent at `voyage-client.ts:209` | ✅ |
| S2 | 1024 dimensions | Types :17; `output_dimension` (:211); response length checked (:161); `vector(1024)` on all four tables and `query_logs`; `vector_dims` check in `fn_set_embedding` (F1400:946) | ✅ |
| S3 | Unit length | Normalised in the client (`unit()`, `voyage-client.ts:148-151, 166`); **not asserted in the database** | ⚠️ — `abs(vector_norm(p_embedding) - 1) < 1e-3` in `fn_set_embedding` |
| S4 | `vector_ip_ops` + inner product | HNSW `vector_ip_ops` on all four tables (I4004:4-10); `ORDER BY embedding <#> p` (F1400:1005-1029); `-(a <#> b)` is cosine for unit vectors | ✅ |
| S5 | `input_type` | `query` for searches (`search/EmbeddingBackendService.ts:312`), `document` for listings (:446) | ✅ |
| S6 | Re-embed on model change | `embedding_model` / `embedding_hash` / `embedded_at` per row; `isEmbeddingCurrent` checks hash + model (`search/embedding-index.ts:127-129`); KV cache keyed by model and dims | ✅ |
| S7 | HNSW recall | Default `m` / `ef_construction`; **no `hnsw.ef_search` and no `iterative_scan` anywhere** | ⚠️ (S11) |

### 4.2 `search.fn_nearest` and `search.fn_nearest_to_entity`

| # | Capability | Implementation | Status |
| :-- | :-- | :-- | :-- |
| S8 | Signatures | F1400:985-990, :1043-1049, returning `(entity_type, entity_id, score)`; match `database/search/Functions.md:182, 193` | ✅ |
| S9 | Grants | `anon` / `authenticated` / `service_role` (G2510:288-290); `fn_set_embedding` service-role only (:294-296); vectors never returned (column grants re-granted without `embedding*`) | ✅ |
| S10 | Visibility | Applies the index flags — which are wider than the source tables' RLS (**SEC E6**) | ❌ |
| S11 | Filter before `LIMIT` | `WHERE` filters + `ORDER BY <#> LIMIT` per table. With HNSW the filters apply after the default `ef_search = 40` candidate scan, so a filtered query starves: `profiles_index` mixes user, freelancer, team and business rows in one index, so a Teams search can return nearly empty, and `SEMANTIC_POOL = 100` (`explore/semantic.ts:42`) is unreachable. Hidden at seed scale, where the planner seq-scans | ⚠️ — `SET hnsw.ef_search = 200` (+ `hnsw.iterative_scan = relaxed_order` on pgvector ≥ 0.8) on both functions, or partial per-type `WHERE is_active` HNSW indexes in I4004 |
| S12 | Bounds | `k` clamped 1..100 (F1400:1006, :1033); `p_exclude` unbounded | ✅ / P3 |

### 4.3 Index maintenance

| # | Capability | Implementation | Status |
| :-- | :-- | :-- | :-- |
| S13 | Lexical index | `fts` + GIN maintained by the sync triggers (F1400:70-329; `00001800:10-39`) — but the live lexical match is a JavaScript substring AND over title, owner, summary, skills and category (`explore/query.ts:165-176`). `fts` is read only by the two dead definers (SEC E5) | 📄 dead weight |
| S14 | Embedding writer | `reembedInBackground` from the Catalogue, Profile, Project and Workspace saves (`CatalogueBackendService.ts:67`, `ProfileBackendService.ts:300`, `ProjectBackendService.ts:2837`, `WorkspaceBackendService.ts:133`) + the backfill task. In-process, 30 s debounce, **lost on isolate restart**, nothing scheduled to catch up | ⚠️ — a scheduled backfill row in S5060 now; a `search.embedding_queue` drained by an http job when volume warrants |
| S15 | Idempotency, retries | SHA-256 of text + model skips unchanged rows (`search/embedding-sync.ts:76-86`); 2 retries with backoff, `429` honoured (`voyage-client.ts:268-306`) | ✅ |
| S16 | Archive / unpublish | Vector kept, hidden by `is_public` / `is_active` — correct only where those flags are (SEC E6) | ⚠️ |
| S17 | Erasure | Search data survives account erasure (**SEC G16**) | ❌ |
| S18 | Articles | No live write path, so articles are embedded only by the backfill (Decision #179 flag (e)) | ⚠️ known |

### 4.4 Ranking

| # | Capability | Spec | Implementation | Status |
| :-- | :-- | :-- | :-- | :-- |
| S19 | Quality score | PS:2539-2550; `finance-model.md` §16.7 | `explore/ranking.ts:217-243` matches the spec: prior, log volume, workload, earned Boost, Standing multiplier, penalty not scaled by Standing | ✅ |
| S20 | Semantic blend | SA:819-821; Decision #179 (G) | `(1 − 0.5) × position + 0.5 × sim / best` (`explore/semantic.ts:96-113`); extras above `max(0.30, 0.8 × best)`, at most 12 (:120-144). **Not in PS or `finance-model.md`** — a ranking rule that changes who earns, living only in SA and code | 📄 (#339 (a)) |
| S21 | Lexical relevance | — | None: the text query is a binary filter, and "recommended" ignores text relevance (`query.ts:183-251`) | ⚠️ — a strong lexical match ("logo designer" in a title) ranks no higher than a weak one |
| S22 | No pay-to-rank | `finance-model.md:723-724` | Sponsored items are separate labelled slots (`ExploreBackendService.ts:193-216`); `ranking.ts` never reads promotion | ✅ |
| S23 | Determinism | — | Ties broken by `createdAt` then `id` (`ranking.ts:250-257`); `fn_nearest` orders by score, type, id (:1032) | ✅ |
| S24 | Pagination stability | — | Offset paging over a list recomputed per request (`ExploreBackendService.ts:315-323`), with a 30 s catalogue TTL and a 60 s similarity cache; a heuristic fallback on page 2 after a semantic page 1 reorders the list (duplicates or skips) | ⚠️ — cache the ordered id list per (params, `loadedAt`) and page by cursor |
| S25 | Personalisation | SA:2335-2339 (user vectors) | Empty hook region (`ExploreBackendService.ts:403-404`); personal rails use `interest_history × relevance` (`explore/personalise.ts:153-160`) | 📄 (#339 (c)) |

### 4.5 Failure modes, cost and privacy

| # | Capability | Implementation | Status |
| :-- | :-- | :-- | :-- |
| S26 | No key | The gate needs a real key; the path is heuristic and Voyage is never called (`packages/backend/core/embeddings-gate.ts:32-45, 63-66`) | ✅ |
| S27 | Voyage down | 2 s per attempt / 3 s deadline, `429` not retried, breaker after 3 failures, then heuristic (`EmbeddingBackendService.ts:34-40, 322-419`) | ✅ — but SSR `/explore?q=` can block first paint for up to 3 s |
| S28 | Query cache | Memory LRU 512 × 6 h, then Deno KV 7 d, keyed by a SHA-256 of the query; in-flight dedupe | ✅ |
| S29 | Per-keystroke cost | Typeahead is debounced and served from the in-memory catalogue; embedding happens only on a submitted search | ✅ |
| S30 | Per-client rate limit | None on `/api/explore/search` or SSR `/explore?q=`; only a per-isolate shared bucket (20 burst at 5/s, `EmbeddingBackendService.ts:330`). One client can drain it and push everyone on that isolate to heuristic ranking; crawlers hitting `/explore?q=` also embed | ⚠️ — `apps/web/utils/client-key.ts` limiter on both |
| S31 | What reaches Voyage | Input + model + type + dimension only (`voyage-client.ts:204-213`); only the public catalogue projection is embedded | ✅ |
| S32 | Processor disclosure | The privacy page names Voyage AI (`features/legal/core/content/privacy.ts:172`), but the default endpoint is MongoDB Atlas; EPI §3.4 lists "Voyage AI / MongoDB Atlas" and asks for written no-training terms before `EMBEDDINGS_ENABLED` goes on | ⚠️ (#339 (d)) |
| S33 | Query logs | Raw query text, `user_id` and query vector kept forever; minors anonymised (F1400:702-704); no retention sweep. `query-log.ts:20-21` claims "a caller cannot name another user", but `fn_log_query` accepts `p_user_id` (F1400:691) and the table policy admits guests (SEC G13) | ❌ |

### 4.6 `/explore` front end

| # | Capability | Implementation | Status |
| :-- | :-- | :-- | :-- |
| S34 | ROUTING.md | **No `/explore` row.** `?q`, `?category` (legacy `?type`), `?sort`, `?item`, the facet keys and `/api/explore/search?offset&limit` are undocumented (`explore-state.ts:17, 47-63`; `api/explore/search.ts:17-24`) | ❌ |
| S35 | State in the URL | `q`, category, sort and facets are; paging offset is API-only (load-more) | ✅ |
| S36 | SSR vs islands | First paint calls the service directly; islands fetch through `ExploreService`; no Supabase or server import in islands, components or hooks | ✅ |
| S37 | Zod at the route | Hand-rolled `Number()` + `parseExploreParams`; the existing `ExploreParamsSchema` (`packages/types/explore/discovery.ts:24-33`) is unused there and unbounded. `q` is unbounded, `sort` takes any string, `filters` any key — all written into `query_logs.filters_applied` (`query-log.ts:26-32`). The service header claims "Zod validation" (`ExploreBackendService.ts:70-71`) | ❌ — bound the schema (`q` ≤ 512, sort enum, whitelisted facet keys) and parse with it |
| S38 | Design gates (spot check) | Inline `style` limited to `--*` custom properties via `vars()` (`ServiceCard.tsx:59`); the Promoted badge is a required disclosure; sort options match the backend. Conversion-lane rule §3.10 does not apply | ✅ (not audited in depth) |
| S39 | Tests | semantic 15, ranking 12, query 7, personalise 11, EmbeddingBackendService 34, embedding-sync 5, gate 8 — **none** for `semanticSimilarTo`, and no SQL test of `fn_nearest` visibility | ⚠️ |

---

## 5. Design-system & routing defect log

| # | Defect | Gate | Evidence | Fix |
| :-- | :-- | :-- | :-- | :-- |
| D1 | Six Settings → Messaging toggles do nothing: Read receipts, Typing indicator, New messages, Mentions, Group activity, Chat sound — nothing reads them and no `message.*` event exists | §3.11 | `features/settings/components/sections/MessagingSection.tsx:106-149` | Hide them, or render them as a `LockedDialog` reason until M8 / N5 land |
| D2 | Reactions render and persist nowhere (M16); conversation delete and mute are device-local (M12, M13) while the UI implies an account-level action | §3.11 | §1.3 | Wire the existing tables and doors, or say "on this device" |
| D3 | Hard-coded `backdrop-filter: blur(12px)` on the desktop pop-out composer — a non-token value, and §3.9 does not license `backdrop-filter` on a desktop floating panel | §3 tokens, §3.9 | `features/messaging/styles/chat-popout.css:156-157` | Solid `--surface-2` panel; if glass is wanted, `--glass-blur` on a `::before` underlay and a logged exception |
| D4 | `.apk__title`, an `h2`, at `--fw-bold` | §3.8 | `asset-picker.css:115` (`AssetPicker.island.tsx:1895`) | `--fw-semibold` (or the section-header register) |
| D5 | SMS rendered as a selectable transport that can never send | §3.11 | Settings notification matrix; §2.3 | Lock with a reason, or remove until §2.5 step 5 |
| D6 | `/messages` page rows absent from ROUTING.md's route table; nine `/api/messaging/*` endpoints and `/api/projects/messages(/send)` undocumented; PS:3397-3401's `/messages/[message id]/{chat, details, files/[file id]}` disagree with the real `index · files · members` | ROUTING contract | §1.1 | Add the rows; correct the sitemap (#339 (e)) |
| D7 | No `/explore` row in ROUTING.md (S34) | ROUTING contract | §4.6 | Add the route and its query contract |
| D8 | `/files` sort, search and facets held in client signals rather than the URL | URL-addressable state | F31 | Owner ruling pending (#315 (a)) |
| D9 | Soft 404 on a missing conversation | — | M25 | `404` status with the same calm page |

---

## 6. Strategic recommendations

### 6.1 Unified messaging — decide it, then build it as a read model

The spec sells one conversation per pair that appears identically in the inbox and in the project.
The live system has two stores, and the project half silently drops DMs. **Do not merge the tables**:
`project_messages` carries stage-room semantics (channel membership, stage scoping, submission
links) that a DM does not, and the Additive Rule protects both. Unify at the **address and read
model** instead:

```ts
/** One opaque, prefixed address for every conversation surface (Decision #88). */
type ChatRef =
	| { kind: "room"; ref: `stg-${string}` | `prj-${string}`; channel: string } // comms.project_channels
	| { kind: "thread"; ref: `cht-${string}` }; // comms.dm_threads (dm · group · service_inquiry · entity_channel)

/** MessagingBackendService — the ONE send door; dispatches to the owning table. */
sendMessage(actor: Actor, ref: ChatRef, input: SendMessageInput): Promise<ServiceResult<ChatMessage>>;
```

- A `cht-…` slug on `comms.dm_threads` (edited into T16 with its Zod type and docs) replaces the uuid
  route; `/messages/dm-<handle>` resolves the pair's thread and **303**s to its `cht-…` address.
- The DM send writes `dm_messages.project_id` whenever `fn_dm_protected_project` resolves one; the
  project's Private Messages group then reads `dm_threads` filtered by that project, which draws the
  same thread the inbox opens.
- One door means one Tier 1 insertion point (SEC §2.3) and one rate limiter (M23).

This needs an owner ruling because it changes addresses (#339 (f)).

### 6.2 Real-time — a server-owned stream, not a browser Supabase client

A browser `supabase-js` Realtime subscription would put a database client in an island, which root
`CLAUDE.md` §2 forbids. Two compliant options:

| Option | How | Cost | Recommendation |
| :-- | :-- | :-- | :-- |
| ETag long-poll | `/api/messaging/conversations/:ref/since?cursor=` answers `304` until a newer message exists — the Decision #173 pattern | Trivial; one indexed query per open conversation per interval | **Ship first** |
| SSE | `/api/messaging/stream` holds one connection per tab; the fat service subscribes server-side (Realtime with the service role, or `LISTEN/NOTIFY` from an `AFTER INSERT` trigger) and re-checks each event under the reader's RLS before forwarding | Connection-heavy; needs sticky routing across isolates | When typing and presence are wanted |

Until either exists, **remove the five tables from `supabase_realtime`** (RT2600): an unused
broadcast of full message rows is attack surface (SEC E1) with no product value. Removing a
publication membership changes no schema shape, but it is a behaviour change to approve
(#339 (g)).

### 6.3 Notifications — the engine is built; nothing drives it

The catalog, router, preferences, quiet hours, collapse and digest builder exist and are
well-modelled. The missing pieces are operational: no scheduled jobs, no transports, no suppression
check. Follow §2.5's order. The single most valuable step after SEC E3 is registering the comms jobs,
because it turns existing code on.

### 6.4 Files — one ingestion contract

Three pipelines have drifted into three acceptance policies. Define one `AdmissionPolicy` per purpose
(`library_any`, `library_media`, `contact`) in `@server/services/files`, applied by one claim →
sniff → scan → decode → promote sequence, so ClamAV (SEC §4.3) and the publication gate (SEC §3.2) each
have exactly one call site. Close the direct-write policies (SEC E8) in the same change, or the
contract governs only the doors that choose to use it.

### 6.5 Search — fix recall and scope before adding signal

In order: the visibility and definer fixes (SEC E5, E6); `ef_search` (S11), without which semantic
discovery degrades exactly as the catalogue grows; erasure (SEC G16); a scheduled embedding backfill
(S14); then a lexical relevance term (S21). The commercial reason for the order: a marketplace whose
search surfaces suspended teams or cancelled briefs, or returns an empty Teams tab at scale, loses
buyer trust faster than a missing relevance signal costs conversion.

---

## 7. Decision #339 — communications, assets & search flags

| Flag | Question | Proposal |
| :-- | :-- | :-- |
| (a) | The semantic blend (weight 0.5, floor 0.30, relative 0.8, ≤ 12 extras) is a discovery rule that changes who earns, yet lives only in SA:819-821, Decision #179 (G) and code; PS:2541-2547 says recommended search ranks by one quality score | Add it to PS §Reputation & Discovery 2 and the dials to `finance-model.md` §16.7 |
| (b) | PS:1246 ("mandatory … ignores every preference") vs PS:1251 ("global snooze is pierced only by critical alerts"); the code follows :1246 (F1310:256) | Owner ruling; recommended: mandatory ignores preferences and snooze, but only `overrides_quiet_hours` types break quiet hours for push/SMS |
| (c) | SA:2335-2339 (context-aware vector ranking from user context) vs SA:848-849 (user vectors are a separate ranking-v1 task); SA:2971-2972 ("pgvector results cached in Deno KV") is aspirational | Mark both as planned |
| (d) | Voyage is the disclosed processor; the default endpoint is MongoDB Atlas (SA:3639; `voyage-client.ts:26-37`) | Disclose MongoDB as the processor when an Atlas key is used, or pin `VOYAGE_API_BASE` to Voyage |
| (e) | PS:3397-3401 `/messages` sitemap vs the real routes; ROUTING.md lacks `/messages` page rows, ten API endpoints and `/explore` | Correct the sitemap; add the rows |
| (f) | Unified messaging (PS:1116, SA:988-993) is not true on the live path (`live-detail.ts:856-862`) | Adopt §6.1 (`cht-…` refs, one send door, `project_id` on DMs) |
| (g) | Decision #173 says "chat has its own live channel (Decision #49)"; #49 defines none and the code has none | Adopt §6.2; drop the five tables from the realtime publication until a server-owned stream exists |
| (h) | PS:1252-1253 ("an unsubscribe **or a bounce** suppresses … Marketing only") vs `database/comms/Tables.md:243` and `fn_is_suppressed` (a hard bounce blocks every category) | Owner ruling; recommended: a hard bounce blocks every category for that **address** (it cannot receive anything) and raises an in-app prompt to fix the email |
| (i) | SA:2462-2464 and `database/comms/Functions.md:15-17` hang the dispatch trigger off `notification_deliveries`; the code and `Functions.md:165` put it on `comms.notifications`. `Functions.md:22` says `fn_process_queue` runs every minute; it is not registered | Factual corrections |
| (j) | SA:683-684 calls for end-to-end AES-GCM encryption of private messages; PS §Messaging 1.A relies on the database reading plaintext bodies (masking, search, previews), and E2EE is not implemented | Owner ruling; recommended: drop E2EE from SA — server-side masking and dispute evidence (PS §Dispute Resolution) require plaintext; keep encryption at rest |
| (k) | SA:2455 "94 seeded" (112); SA:2451 cites pre-consolidation migration names; SA:995 "`messages.*` tables" (the schema is `comms`); PS:3566 describes `usePresence` as presence | Factual corrections |
| (l) | PS:728-730 ("always a fresh copy … no location data ever reaches a visitor") vs videos published as uploaded (`showcase-rendition.ts:24-28`; `00005040:155-157`) | Code follows the spec (SEC Z2) |
| (m) | `Storage.md:538-539` (the sniff refuses executable markup) and SA:1893-1895 (refuses anything not a picture or video) vs the hub admitting everything but executables | Write the per-purpose admission policy (§6.4) into SA and `Storage.md` |
| (n) | PS:1239 promises SMS; 0 catalog rows route to it | Correct PS until §2.5 step 5 |

---

## 8. Prioritised backlog

Security items are prioritised in the companion's §8; they gate everything below.

> **Status (2026-10-30, Wave 0 comms/search):** **M5** fixed (`comms.fn_lock_dm_pair` in both DM
> openers; `dm_participants_thread_user_key UNIQUE (thread_id, user_id)`), **M10** fixed
> (`comms.mark_dm_read`, called when `/messages/[conversationId]` opens), **M24** fixed (with
> `MESSAGING_BACKEND_LIVE` on, no session is a `401` and a failed live read a `503`; fixtures answer
> only with the gate off). Project-room read marks (`unread: false`) are not part of M10's fix.

| Pri | Item | Area |
| :-- | :-- | :-- |
| P0 | SEC §8 P0 block (E1–E8) | DB + edge + UI |
| P1 | M24 never serve fixtures to a live user; M10 read marks (`comms.mark_dm_read`); M5 pair lock + unique `(thread_id, user_id)` | service + DB |
| P1 | M6 ETag message poll (§6.2) and the realtime publication ruling | service + UI |
| P1 | N12 register the comms jobs; N8–N10 suppression, escalation, category digests; N1 `RAISE WARNING` | DB |
| P1 | S11 `ef_search` / per-type indexes; S14 scheduled embedding backfill; S37 bounded Zod at the route; S30 per-client limit | DB + service |
| P1 | F13 video remux or refuse; F15 upload sweeper; F14 meter everything that is stored | service + DB |
| P1 | D1, D2, D5 controls that do nothing (§3.11) | UI |
| P2 | §6.1 unified messaging (after #339 (f)); M11 edit/delete doors that re-mask; M12, M13, M16 persisted actions; M18 voice memo drift | DB + service + UI |
| P2 | §2.5 transports: email → web push → SMS; signed webhook | infra + service |
| P2 | §6.4 one admission contract; F20 PDF attachment on navigation; F21 shorter private cache; F23 retire the redirect route; F26 inspector CSP base; F28 detached DOCX hardening; F29 production default | service + app |
| P2 | S21 lexical relevance; S24 cursor paging; S3 norm assert; S39 tests | service + DB |
| P3 | D3, D4, D6, D7, D9; M4 canonical redirect; M21 Zod on GET routes; N7 uuid templates | UI + docs |
| P3 | Doc corrections after #339 | docs |
