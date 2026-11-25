# Projects Build Prompts — closing USER_FLOWS PJ: Projects, collaboration, files & calendar

> **Status: WORK ORDERS, not binding.** Claude Code prompts that take the
> [USER_FLOWS.md](USER_FLOWS.md) **PJ** cluster (77 flows in eleven sections; 64 % at `f2e25929`) to
> 100 % under the readiness rule (Decision #444). Most PJ rows already have work orders in their
> domain's file; this file maps every row to its prompt (§0.1), orders the path across those files
> (§0.2), and holds the prompts no domain owns.
>
> **Verified against code 2026-11-23 at `f2e25929`.** 4 open, 2 partly done (FL3, #563; FL2, #568), 20 done (§0 ledger).
> Runnable now: FL2 and FL3, each up to its own 🧑 stop.
>
> **This file holds open work only.** A session that runs a prompt prunes it here when it finishes
> (§1's closing duty; [`build-prompts.md`](../reference/build-prompts.md) §2).

**Rollup, not restatement.** The other work orders these rows use:

- [`PM_BUILD_PROMPTS.md`](../architecture/PM_BUILD_PROMPTS.md) (PM): the stage guards, the money
  exits, workload, the dependency engine and the board's addresses. Its prompts are pasted under its
  own header.
- [`COMMS_BUILD_PROMPTS.md`](../architecture/COMMS_BUILD_PROMPTS.md) (COMMS, which holds the CD
  prompts too): chat, notifications and the hosted send, CD2.
- [`TRUST_SAFETY_BUILD_PROMPTS.md`](../architecture/TRUST_SAFETY_BUILD_PROMPTS.md) (T&S, which holds
  LK1 and the rest of the safety prompts): scanning, masking and reports.
- [`OPERATIONS_BUILD_PROMPTS.md`](OPERATIONS_BUILD_PROMPTS.md) (OPS, which holds the CFG prompts):
  jobs and keys.
- [`FINANCE_BUILD_PROMPTS.md`](../architecture/FINANCE_BUILD_PROMPTS.md) (FBP, which holds the MR
  prompts too): the finance prompts, the serial SQL lane for money files (§0.1) and the
  PRODUCTION_READINESS §F row map (§0.7).
- [`IDENTITY_BUILD_PROMPTS.md`](../architecture/IDENTITY_BUILD_PROMPTS.md), which holds the SAC
  prompts.

| Group   | Covers                                |
| :------ | :------------------------------------ |
| ST1–ST6 | Stages and staffing                   |
| EX1–EX4 | Completion, exit and disputes         |
| CH1–CH4 | Chat                                  |
| NO1–NO4 | Notices                               |
| FL1–FL4 | Files                                 |
| LP1     | The live-provider proof, run with you |
| PJZ     | The closing sweep                     |

Paste §1.1, then the prompt, then §1.2 with the prompt's rows. A prompt marked 🧑 DECISION stops at
the named step; ⚖️ builds behind a switch that stays off. Migrations are edited in place. Each
prompt's CONTEXT was verified at `e1ff027b` on 2026-11-19: re-check every cite.

---

## 0. Map, run order and stops

### 0.0 Done

A prompt that lands gets a row here.

| ID  | What landed                                                                                                                                                                                    | Commit            | Text at    |
| :-- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------- | :--------- |
| ST5 | Seats and participant rows are written only by their definer doors: the owner's two `FOR ALL` policies dropped, client `INSERT` / `UPDATE` / `DELETE` revoked; probe `seat_insert_consent.sql` | `70b0d8c5` (#554) | `f398cd9f` |
| ST1 | A setup save names its version: `UpdateProject.expectedUpdatedAt` from `ProjectSetup.updatedAt`, `apply_write_batch`'s `version` op (lock, compare to the ms, advance), `409 stale_write` with `details.current`, `428` without one; the rigs' Reload notice; probe `setup_stale_write.sql` | `295f12f8` (#551) | `a9959c64` |
| ST2 | The setup form's Remove reaches a door: `projects.delete_stage` refuses a stage with history `55000` before anything moves and deletes an untouched one; `projects.stage_removability` gives the setup DTO its `removable` flag; `DELETE /api/projects/:id/stages/:stageId`; a touched stage's Remove opens `StageLockedDialog`; the stub PATCH keeps an omitted stage as live does; probe `stage_removal.sql` | `60a0d652` (#553) | `4fed9f01` |
| EX2 | Either side disputes a ticket's stage money, held or still clearing: `finance.disputes` `ticket_id` · `stage_id` · `claimant_side` (`ticket_escrow`), `finance.dispute_offers`; `open_ticket_dispute`, `propose_dispute_offer`, `accept_dispute_offer`, `ticket_dispute_state`, `fn_settle_ticket_dispute` (held: release, Fair Exit split or refund; pending: the frozen rows recovered in proportion, the fee given back), the `PD409` move and claim guard; `/api/finance/disputes` POST, `…/ticket/[ticketId]`, `…/offers`, `…/accept`; `DisputeCaseDialog` generalised, the ticket chain's `dispute` frame, `TicketDisputeLine`, the card's Disputed tag, the `ticketDispute` dev axis; probe `ticket_dispute.sql` | `21427dae` (#548, #549) | `1929b313` |
| TK1 | Everyone on a project sees which of a ticket's stages are prepaid, ids only (`projects.get_project_prepaid_stages`, read by `ticketBillingFacts` and the setup DTO's `prepaidCount`); the payer takes one back while unreached (`projects.refund_ticket_stage_reservation`, `POST /api/finance/escrow/reservation`, a Refund per prepaid stage on the funding line); a ticket sent back to New, or a New ticket whose funding stage is reserved, gives the reservation back (`fn_ticket_prepay_sync`); a reservation keeps its price and the stage editor counts them; the Prepaid stages dev axis gains Some; probe `stage_funding_prepaid.sql` 9–13 | `592ccfc0` (#556) | `62d6b1a7` |
| ST3 | Manual assignment: `set_stage_assignment_mode` granted (planned modes refused `0A000`); `tickets.pinned_assignee_id`; `assign_ticket_manual` pins on a Manual stage and binds nothing; `decline_ticket_pin`; `claim_ticket` takes the pinned freelancer's acceptance; the stage inspector's Routing control, Assign to… and its picker, Accept / Decline; Helia's Discovery stage seeded Manual with a pin; probe `seat_lock_and_capacity.sql` region 4 | `1929b313` (#547) | `9d55866d` |
| ST6 | A write by one party to a shared project shows on the other's next read, in every isolate: each cached project read is keyed by the project's KV version (`services/projects/freshness.ts`), bumped by every write path (#555 lists them); a KV-less isolate keeps its own bumps; a board reads around the cache while the claim sweep is due; #427 (a) confirmed and written into PRODUCT_SPEC | `08f27344` (#555) | `70f78452` |
| ST4 | The freelancer's own workload: `projects.get_my_workload_capacity()` (no argument, `auth.uid()`, per-stage split) granted to `authenticated` only, the any-user `get_workload_capacity` revoked by name; `WorkloadCapacitySchema`, `ProjectWorkloadService.mine`, `GET /api/projects/workload`; the `WorkloadGauge` island in the `/projects` header; the capacity line and over-cap refusal beside the ticket view's and the board card's Claim; dev axis `workload`; probe `workload_capacity_self.sql` | `97680598` (#550) | `97680598` |
| TK2 | The funding path driven end to end in a real browser on the live path: `apps/web/tests/e2e/ticket-funding.spec.ts` (`deno task test:e2e:funding`). One stage through the basket picker and the checkout narrowed by `?ticket_id=`, paid from the business wallet; a stage held and two prepaid in one Buy now, the freelancer seeing the marks and no amounts; Buy now by a 3-D Secure card and a plain one, held after the signed webhook (the spec forwards it from Stripe test mode) and after a reload; a short wallet and a paid-for stage refused. The checkout's client re-read keeps `?ticket_id=` (it widened to the whole basket); `test:e2e` no longer names the deleted `landing-hero.spec.ts` (PRD-K3) | `f9bce8aa` (#557) | `288865a0` |
| EX3 | Raising a ticket dispute freezes its Evidence Vault in the same transaction: `finance.dispute_vaults` (manifest jsonb, `sha256` of its canonical text, `pending` → `ready`, `object_prefix`; immutable by trigger, RLS with no client policy), `fn_dispute_vault_manifest` (terms, escrows, history, submissions with their file hashes, the stage's rooms), `fn_freeze_dispute_vault` from `open_ticket_dispute`, `mark_dispute_vault_ready` (service role), `get_dispute_vault`, `get_dispute.vault`; the service copies the files to `evidence/vault/{dispute}/`; `GET /api/finance/disputes/[disputeId]/summary.pdf` and `…/vault`; the case dialog's and the desk's Evidence Vault line and links; probe `dispute_vault.sql` | `a91a5080` (#558) | `0e06fa9d` |
| CH4 | A message and its files are one write, and a voice memo survives a reload: `comms.send_message` (invoker) writes the message, its `message_attachments` links and `channel_files` rows in one transaction and refuses the whole send on a refused file (PA422 → 422 `not_attached`); `message_attachments.audio_duration_ms` + `audio_peaks` (four CHECKs, `uq_message_attachments_one_memo`); `SendAudioSchema` names the memo's upload; `fetchMessageAttachments` returns the memo as the player on every read; `MessageAttachmentRowSchema`; probe `message_send.sql` | `1732ac6d` (#559) | `0e06fa9d` |
| CH3 | Inside a project every DM and group opens in place, and reading marks it read: `comms.project_channel_reads` + `comms.mark_room_read` + `comms.unread_rooms` behind `POST /api/projects/messages/read` (the send's own pair; a `cht-` channel marks the thread, so `/messages` clears too) and the `ProjectChat` island's after-paint read; `comms.project_dm_threads` (groups, no 500 cap); the `cht-` Files and Members tabs; `comms.dm_thread_projects` + `comms.bring_dm_into_project` (the other told, `message.brought_into_project`) + `comms.take_dm_out_of_project` (stamps kept) behind `POST | DELETE /api/projects/messages/dm`, the Members "Message" action and the header's Take out; probe `room_read_marks.sql` | `619a3885` (#560) | `b14e115f` |
| CH1 | Authors edit and delete their messages through doors: `comms.edit_message` (within `message_edit_window_minutes`, 15) and `comms.delete_message` (a tombstone at any time), definers that keep every replaced text in the append-only `comms.message_revisions` and refuse an archived room or one a live dispute freezes (the stage's rooms and the project's General room, PM423); the `edit_own_messages` policy and every client `UPDATE` on the message tables gone; `dm_messages.edited_at`; `comms.message_edit_rules`, `comms.get_message_revisions` (operators); the vault manifest v2 carries each message's revision trail by hash; `PATCH`/`DELETE /api/messages/[id]`; the bubble's Edit and Delete for everyone, `MessageEditor`, `DeleteMessageDialog`, the Edited mark and the tombstone; dev axis `chatEdits`; probe `message_edit.sql` | `2e8df2a4` (#562) | `a48975b5` |
| CH2 | A team's own room and a business's room on every stage they work on, opened in the transaction that makes them due: `comms.project_channels.team_id` + `ck_project_channels_team_room` + `uq_project_channels_private_room`; `comms.open_private_rooms` from three triggers (a team seat going live, a stage inserted, a project re-pointed at a business) and the lazy `get_stage_channels`; `can_access_scope`'s team arm is one team's (4-arg, `p_team_id`), the solo arm gone; the tree's Business group (`ProjectChannels.business`, `ChannelKind` `business`), team rooms joined by `team_id`; probe `private_rooms.sql` | `1958096c` (#561) | `47db5bca` |
| NO1 | An email invitation is answered by its own `/invite/<token>` link, by the account holding the invited address verified: `projects.email_invitation` (invalid · not_yours with a masked hint · open · accepted · declined · expired · withdrawn) and `projects.answer_email_invitation` (binds an open email row to the caller, audited, then `fn_apply_invitation_decision`), the `EmailInvitationLanding` island and `POST /api/projects/invites/email`; an address no verified account holds is mailed the link once, never when suppressed, at most once per (project, address) in 14 days, behind ⚖️ `project_invite_mail_enabled` (seeded off): `projects.invitation_mail`, `claim_invitation_mail` / `finish_invitation_mail`, `services/mail/invitation-mailer.ts`, `EmailInvitationService.sendDue` after an invite and from the `projects-invitation-mail` job; a verified holder's `stage.invite` links to the invitation; `application.received` emails; probe `invitation_email.sql` | `9c56ec06` (#566) | `e95669e9` |
| NO2 | The daily and weekly digests are mailed once each, as counts, titles and links and never a body: `comms.notification_digests` gains `attempts`, `claimed_until`, `provider_ref`, `last_error`, `skipped_reason`; `comms.fn_claim_digests` (`SKIP LOCKED`, a 15-minute lease, each digest decided again against preferences, snooze and suppression) and `comms.fn_record_digest_result` (2^attempts backoff, failed at the fifth); `DigestMailService` through the dispatcher's Resend transport, `POST /api/comms/cron/digests`, job `comms-digest-send`; probes `digest_claim.sql`, `digest_claim_race.sql` | `04ebee7a` (#565) | `0c7aa8dc` |
| NO3 | A push device is dropped only when the push service says it is gone, after 5 consecutive failures whose first is at least 24 hours old, or after 180 days with nothing delivered: `comms.device_tokens.failing_since`; `fn_record_delivery_result` keeps the streak's start and a success resets it and refreshes `last_seen_at`; `fn_reap_dead_devices` waits out an outage (`search_path = ''`); Settings → This device says "This browser stopped receiving notifications" with Turn on again (`/devices/status` `stopped`, `restartPush`), dev axis Push permission → Stopped; probe `push_device_health.sql` | `ca1793c4` (#567) | `0e9cb82a` |
| EX1 | A project completes when its last money settles or when its client completes it, and completing it opens its reviews: `projects.fn_complete_project` (the one writer of `completed`), `fn_project_complete_blocked`, `can_complete_project`, `preview_project_complete`, `complete_project`, `reopen_project`; `approve_stage` completes the engagement once no stage is unsettled and every ticket has ended, its handover notice reaching every seat holder; the ended-engagement escrow guard refuses a completed engagement (extending is the client's logged Reopen); `GET`/`POST /api/projects/:id/complete`, `POST /reopen`; `CompleteProjectDialog`, `ReopenProjectDialog`; probe `project_completion.sql` | `dc354519` (#569) | `9c56ec06` |
| FL4 | A person grant tells that person, every grant is listed in Shared with me, and a link cannot outlive its file's tier (#570, stop 30 as recommended; (e) deferred, PJ-78): `files.set_item_access` emits `file.shared` for a new person grant on a file left above Only you (catalogued in `00005010`, digestible); `files.list_shared_with_me` behind `/files?source=shared` (`SharedWithMe`, the lane's and Browse menu's row); `trg_files_items_revoke_links_on_tier_drop` revokes a file's links when it goes to Only you or Specific people, and `fn_resolve_share` opens a file link only while the file is `link` or `public`; both tier writes answer 409 `links_would_stop` with the count until `stopLinks`, confirmed in the Access tab, the hub's privacy control and in place in `ShareDialog`; probe `file_sharing.sql` | `f70469ab` (#570) | `aaa6fd99` |
| NO4 | Guest mail honours the suppression list and its bounces, and leaves from a sender of its own: `scheduling.claim_guest_mail` mails no address `comms.fn_is_suppressed` refuses (the message stops, the host is told); `guest_request_code` answers `undeliverable`; `deliverMailWithReceipt` keeps Resend's id in `scheduling.guest_mail.provider_ref` (`uq_guest_mail_provider_ref`) through `finish_guest_mail (uuid, boolean, text)`, and `fn_record_delivery_event` matches it on a hard bounce; guest mail leaves through `inviteTransport()`, from `MAIL_FROM_INVITES` or else `MAIL_FROM` (#391 (n) ruled); probe `guest_mail_suppression.sql` | `e4a39ff9` (#571) | `3fd9fc56` |
| FL1 | The storage quota meters every stored byte: `fn_recompute_usage` adds each asset's `files.item_variants` tiers and `trg_files_item_variants_usage` recomputes the asset's owner; the backfill is one `fn_recompute_usage` statement. Stop 27 ruled (30 days; the quota on in UAT, flipped by you). `files.items.purged_at` + `items_purged_check`; `files.claim_purge` / `release_purge` (service role; never a file a submission, a dispute, an order version or line, an invoice, a statement or a sent contact request names); `purgeDeletedFiles` behind `POST /api/files/cron/purge` and the nightly `files-soft-delete-purge` job; T&S SN2 step 5 told how the two sweeps meet; probes `storage_usage_variants.sql`, `file_purge.sql` | `4b224ccc`, `0c7aa8dc`, `35ad258e` (#564) | `cad28a4f` |

### 0.1 Row → work order

Rows not listed are ✅ with no note: PJ-01, 02 (ST1, #551), 03, 04 (ST6, #555), 05, 06, 08, 11 (ST4, #550), 12, 13 (ST3, #547), 16, 18, 19, 20 (ST5, #554), 24, 25 (PM-WP1,
`07d853f6`, #516), 28, 40 (EX1, #569), 41, 42, 45, 48 (CH2, #561), 51, 53, 55, 67, 70 and 73 (OPS2, `dd1ee9a2`, #513); 50 (CH3, #560). PJ-14 and
PJ-74 are ⏸ (§0.4).

**Project setup** (100%): every row ✅.

**Stages** (81%)

| Row   | Now · Crit · Gate | Work order                   | The row flips (or its note clears) when                                                                         |
| :---- | :---------------- | :--------------------------- | :-------------------------------------------------------------------------------------------------------------- |
| PJ-07 | ✅ · High · MVP   | PM-WP5a step 1               | `categoryWeight` is gone; $W_i$ reads intensity alone (note clears)                                             |
| PJ-09 | 🟡 · High · UAT   | PM-WP4b steps 4, 6 (ST2 landed, #553) | ✅ after WP4b (a touched stage archives and settles) |
| PJ-10 | ❌ · High · UAT   | PM-D7a → PM-D7b              | 🟡 after D7a (no loops, no cross-project routes); ✅ after D7b (a waiting stage opens)                          |

**Hiring & members** (83%)

| Row   | Now · Crit · Gate | Work order                        | The row flips (or its note clears) when                                       |
| :---- | :---------------- | :-------------------------------- | :---------------------------------------------------------------------------- |
| PJ-15 | ✅ · Crit · MVP   | PJZ (stale note); NO1 ✅ (#566) | The note says what is true: push is built locally, the hosted send is CD2's   |
| PJ-17 | 🟡 · Crit · MVP   | NO1 ✅ (#566) + counsel (⚖️) + CD2 | Counsel's answer lets `project_invite_mail_enabled` go on; a hosted send is recorded |
| PJ-21 | 🟡 · Crit · UAT   | PM-WP4b step 3 (⏳ WP4a)          | A removal refunds or splits the held escrow by the state of the work          |

**Tickets & delivery** (59%)

| Row   | Now · Crit · Gate | Work order                | The row flips (or its note clears) when                                                                      |
| :---- | :---------------- | :------------------------ | :----------------------------------------------------------------------------------------------------------- |
| PJ-22 | ✅ · Crit · MVP   | PM-P6                     | One price rule: a ticket's own price applies only to a single-stage ticket (note clears)                     |
| PJ-23 | ✅ · Crit · MVP   | TK1 ✅ #556, TK2 ✅ #557   | A payee sees which stages are prepaid; the funding line, basket and Buy now are driven by wallet and by card |
| PJ-26 | 🟡 · Crit · MVP   | PM-WP6 (🧑 PM #8)         | Only the move matrix's roles move a ticket; `canMove` is a server flag                                       |
| PJ-27 | 🟡 · Crit · MVP   | PM-WP9                    | Drafts are private, in RLS and in realtime; inserts go through doors; draft + files are atomic               |
| PJ-29 | 🟡 · Crit · MVP   | PM-D7a (🧑 PM #9) → PM-P6 | The next stage is validated, and the assignee's capacity and seat are checked there                          |
| PJ-30 | 🟡 · Crit · MVP   | PM-S3 (⏳ D7a)            | A stage's status shows submitted, approved and revisions                                                     |
| PJ-31 | ❌ · Crit · UAT   | PM-GH1 (the money lane)   | A silent client's delivery auto-approves on its timer                                                        |
| PJ-32 | ❌ · Normal · UAT | PM-WP6 step 6 (🧑 PM #10) | A stage's date moves only by an accepted proposal                                                            |
| PJ-33 | ❌ · High · UAT   | PM-WP5a (🧑 PM #5)        | A freelancer files a report and the resolver job acts on it                                                  |
| PJ-34 | 🟡 · High · UAT   | PM-WP4b                   | A touched ticket archives and settles; the SQL door enforces what the product's gate says                    |
| PJ-35 | 🟡 · Normal · UAT | PM-WP8 step 3             | `TicketMenu` copies `?tkv=tkt-…`                                                                             |
| PJ-36 | 🟡 · High · MVP   | PM-WP8 steps 1–2          | View state lives in the URL; `/board` and stage `tasks` turn away a type without one                         |
| PJ-37 | ✅ · Normal · UAT | PM-WP8 step 1             | The timeline API 404s for a Task (note clears)                                                               |
| PJ-38 | 🟡 · High · UAT   | PM-WP9                    | Slug segments, Zod, and an honest 404 instead of a shorter chain                                             |

**Completion & exit** (85%)

| Row   | Now · Crit · Gate | Work order                                    | The row flips when                                                                 |
| :---- | :---------------- | :-------------------------------------------- | :--------------------------------------------------------------------------------- |
| PJ-39 | 🟡 · Crit · UAT   | PM-WP4a (🧑 PM #3; with MR2's project cancel) | Fair Exit pays at least its floor: on a stage, on a ticket and in a project cancel |

**Disputes** (75%)

| Row   | Now · Crit · Gate | Work order               | The row flips when                                                                                        |
| :---- | :---------------- | :----------------------- | :-------------------------------------------------------------------------------------------------------- |
| PJ-43 | ✅ · Crit · UAT   | EX2 ✅ (#548) → EX3 ✅ (#558) | ✅ (EX3: the vault snapshot and PDF)                                                                |
| PJ-44 | 🟡 · High · UAT   | **LP1** (you)            | The three audit outcomes are recorded on live Zoom, Teams and Meet                                        |
| PJ-46 | ❌ · Normal · UAT | PM-WP4a step 6 → **EX4** | 🟡 after WP4a's Fair Exit contest; ✅ after EX4 (the workload-verdict appeal)                             |

The operator's ruling is MW-59; it is not this file's row.

**Messaging** (61%)

| Row   | Now · Crit · Gate | Work order                                        | The row flips when                                                                            |
| :---- | :---------------- | :------------------------------------------------ | :-------------------------------------------------------------------------------------------- |
| PJ-47 | 🟡 · Crit · MVP   | COMMS MS3 → MS5 step 3; T&S P2d (G5, G6); CH1 ✅ (#562) | Live delivery; persisted reactions; an archived room refuses at the database |
| PJ-49 | 🟡 · Crit · MVP   | COMMS MS3; T&S SN3                                | Live delivery; the group photo is screened                                                    |
| PJ-52 | 🟡 · Normal · UAT | COMMS MS5                                         | Mute and delete persist on the server                                                         |
| PJ-54 | 🟡 · High · UAT   | T&S LK1                                           | A link nobody could check goes through `/exit`                                                |
| PJ-56 | 🟡 · High · MVP   | CH4 ✅ (#559); T&S SN1                                  | Files are scanned (M15 and M18 closed by CH4)             |
| PJ-57 | 🟡 · Crit · MVP   | T&S P1d → P2a → P2b → P2c; SN6                    | Tiers 1–3, the marketplace window and the cooling-off run                                     |
| PJ-58 | ❌ · High · PROD  | T&S R4 → R5 → R3 → R2 (R1 landed)               | A message or a file can be reported and triaged                                               |

**Notifications** (50%)

| Row   | Now · Crit · Gate  | Work order                | The row flips (or its note clears) when                                                 |
| :---- | :----------------- | :------------------------ | :-------------------------------------------------------------------------------------- |
| PJ-59 | ✅ · High · MVP    | PJZ                       | The note says what is true: email and push dispatch locally; the drawer polls until MS3 |
| PJ-60 | 🟡 · Crit · UAT    | CD2 (NO2 ✅, #565)         | A hosted send is recorded                                                               |
| PJ-61 | 🟡 · Normal · PROD | COMMS NT5 + CD2 (NO3 ✅, #567) | SMS runs behind its configuration; dead devices are dropped; hosted VAPID keys          |
| PJ-62 | ❌ · High · UAT    | COMMS MS4                 | `message.new` and `message.mention` notify, and a muted thread stays quiet              |

**Files & assets** (64%)

| Row   | Now · Crit · Gate | Work order                     | The row flips when                                                                                         |
| :---- | :---------------- | :----------------------------- | :--------------------------------------------------------------------------------------------------------- |
| PJ-63 | 🟡 · High · MVP   | T&S SN1 → SN2 (FL1 ✅, #564) | Uploads are scanned; stale uploads and quarantine objects leave the bucket (every byte metered and deleted files' bytes purged, #564) |
| PJ-64 | 🟡 · Normal · UAT | T&S LK1                        | Offline or with no key, a link reads "unchecked" and goes through `/exit`                                  |
| PJ-65 | 🟡 · Normal · UAT | **FL2** step 5 (with you) | The live Drive round trip is recorded: consent, browse, Add to Library, open (steps 1–4 landed, #568) |
| PJ-66 | 🟡 · High · UAT   | **FL3** (🧑; steps 1, 3 #563)  | A `fil-` slug routes; the inspector has its own CSP (a raw PDF is sandboxed, #563)                         |
| PJ-68 | ✅ · High · UAT   | FL4 ✅ (#570)                 | A grant tells its grantee, and a share link cannot outlive its tier                                        |
| PJ-78 | ❌ · Normal · PROD | — (no blocking exists; #402 (e) deferred, #570) | A person grant to someone in a block pair is refused, once blocking exists                  |

**Calendar, integrations & rooms** (68%)

| Row   | Now · Crit · Gate | Work order                     | The row flips (or its note clears) when                                     |
| :---- | :---------------- | :----------------------------- | :-------------------------------------------------------------------------- |
| PJ-69 | ✅ · High · UAT   | PJZ                            | The note says email and push are built locally and the hosted send is CD2's |
| PJ-71 | 🟡 · High · UAT   | COMMS CD2 (an invitation case) | A hosted send of an invitation is recorded                                  |
| PJ-72 | 🟡 · Normal · UAT | CD2 (NO4 ✅, #571)           | A hosted send is recorded                                                   |
| PJ-75 | 🟡 · High · UAT   | OPS CFG2                       | Vault keys rotate with a rewrap                                             |
| PJ-76 | 🟡 · High · UAT   | **LP1** (you)                  | Microsoft consent, busy read and mirror run on a live tenant                |
| PJ-77 | 🟡 · High · UAT   | **LP1** (you)                  | A room on each provider is created, joined and read for presence            |

**Score projection** (section score = Σ weight × credit / Σ weight; Critical 3 · High 2 · Normal 1;
✅ 1 · 🟡 0.5 · ❌ 0; ⏸ excluded). Today is 2026-11-19's score, with Tickets & delivery re-scored
after PM-WP1. The paths follow §0.2's order:

| Section                        | Today | Path                                                                                                              |
| :----------------------------- | ----: | :---------------------------------------------------------------------------------------------------------------- |
| Project setup                  |  100% | ✅ (ST1, ST6)                                                                                                      |
| Stages                         |   81% | D7a 88% → WP4b 94% → D7b 100%                                                                                     |
| Hiring & members               |   83% | WP4b 92% → CD2 + counsel 100% (NO1 ✅, #566)                                                                               |
| Tickets & delivery             |   59% | WP8 62% → P6 70% → GH1 77% → S3 80% → WP9 87% → WP4b 89% → WP5a 94% → WP6 100% (TK2 ✅, #557)               |
| Completion & exit              |   85% | WP4a 100% (EX1 ✅, #569)                                                                                           |
| Disputes                       |   75% | WP4a 81% → EX4 88% → LP1 100% (EX2 ✅, #548; EX3 ✅, #558)                                                        |
| Messaging                      |   61% | MS5 61% → P2d 67% (CH1 ✅, #562; CH3 ✅, #560) → CH2 ✅ (#561) → LK1 74% → CH4 ✅ (#559) + SN1 78% → SN3 85% → T&S P-chain + SN6 91% → R2 100% |
| Notifications                  |   50% | MS4 75% → CD2 94% → NT5 100% (NO2 ✅, #565; NO3 ✅, #567)                                                                    |
| Files & assets                 |   64% | LK1 68% → FL3 77% → FL2 + you 82% → SN1 + SN2 91% → blocking (PJ-78, no work order) 100% (FL4 ✅, #570; FL1 ✅, #564)   |
| Calendar, integrations & rooms |   68% | CFG2 75% → CD2 86% → LP1 100% (NO4 ✅, #571)                                                                    |

**What MVP needs from this cluster:** the eight Critical · MVP rows not yet ✅, which are PJ-17,
26, 27, 29, 30, 47, 49 and 57 (PJ-23 ✅, TK2). Their work orders, in order: D7a + P6, S3, WP9, WP6, CD2
+ counsel (NO1 ✅, #566), and the chat chain (MS3, MS5, P2d, SN3, the T&S P-chain; CH1 ✅, #562).

**What UAT adds:** PJ-21 (WP4b), PJ-31 (GH1), PJ-39 (WP4a) and PJ-60 (CD2; NO2 ✅, #565) (PJ-43 ✅, EX2 + EX3).
Those are the Critical · UAT rows. Below them come the High · UAT rows: WP5a,
FL3, CFG2 and LP1 (FL4 ✅, #570).

### 0.2 Run order

The global rules hold:

- At most **two SQL sessions** run on the one local DB, on disjoint migration files.
- Only one writer at a time, across **all** tracks, for each of `00002500`, `00002510`, `00002520`
  and `00005060`.
- The money lane in [`FINANCE_BUILD_PROMPTS.md`](../architecture/FINANCE_BUILD_PROMPTS.md) §0.1 wins
  on any money file: `00001200`, `00001240`, `00000017` and `00001210`.

The order below is priority and dependency (⏳). The file locks decide what may overlap. Before
every SQL prompt, compare its files with what is running: check `git status`, this file's §0, FBP
§0.1's lane, and PM §0.4. Nothing was in flight on these files at `f2e25929`. COMMS MS3 has not
landed, and its branch `claude/ms3-live-chat` no longer exists. An uncommitted PM-WP8 attempt sits
in the worktree `.claude/worktrees/wave2-p-wp8-c305ac` (PM-WP8's status line).

**Queue M — the money lane** (FBP §0.1, serial). This file adds four turns to that lane; ask the
lane's coordinator before taking one.

1. **PM-GH1** (PJ-31). The lane ran DB6 first (#532).
2. FBP **DB6** ✅ (#532): WP4a, WP4b and EX2 no longer wait for it.
3. **EX2** ✅ (#548, #549): the ticket escrow on DB21's dispute subject; PM-WP4a step 6 reuses it.
4. **PM-WP4a** (PJ-39, PJ-46's half), then **PM-WP4b** (PJ-09, PJ-21, PJ-34). They run right after
   EX2, never beside DB21 or MR3, which touch `00001200`.
5. **EX3** ✅ (#558): PJ-43 → ✅.

**Queue S — the second SQL slot.** It holds projects, comms and files SQL in priority order, one at
a time. It shares the slot with other tracks' second-session prompts (SBP, SAC, T&S). A prompt
marked (★00001150) never runs beside a Queue M prompt that holds `00001150`: GH1, WP4a or WP4b.

1. **TK1** ✅ (#556, §0.0).
2. **PM-D7a**, with its Chain Reaction capacity step: PJ-29, PJ-10.
3. **ST5** ✅ (#554): seats and participants are written only through their doors.
4. **COMMS MS4**: PJ-62. Run MS5 right after it.
5. **PM-P6** (no longer a money-lane prompt). Then **PM-S3** (⏳ D7a).
6. **PM-WP9** (★00001150, ⏳ PM-WP8 step 4): PJ-27, PJ-38.
7. **COMMS MS5** (⏳ MS3): PJ-52. CH1 ✅ (#562) ran ahead of MS3 by your ruling; MS3's live
   delivery must carry its edits and deletes.
8. **EX1** ✅ (#569, §0.0): PJ-40.
9. **CH2** ✅ (#561): team and business rooms open with the seat and the stage.
10. **PM-WP5a**, then **PM-WP6**, then **PM-D7b** (⏳ D7a, P6, GH1).
11. CH3 ✅ (#560), CH4 ✅ (#559) and NO2 ✅ (#565); FL4 ✅ (#570); NO1 ✅ (#566) and NO4 ✅ (#571); FL1 ✅ (#564); next **FL3**'s
    slug.
12. **EX4** (⏳ PM-WP5a and T&S R3, R4; R1 landed).

**App lane** (up to three at once, file-disjoint):

- **PM-WP8** now.
- **FL2** step 5, with you (steps 1–4 landed, #568).
- **FL3** step 4, the inspector's CSP (its stream half landed, #563), once stop 29 is ruled.
- **PJZ** last.

**Human lane:**

- **LP1**, which needs a public HTTPS origin: OPS6 (#512) or a tunnel.
- **COMMS CD2**, deferred twice (#484).
- FL2 step 5: the live Drive round trip on your account.
- Counsel's answers for NO1, EX3 and CH1 (§0.3).

**Other tracks' prompts these rows wait on** run in their own files' order:

- COMMS MS3 and NT5.
- T&S LK1.
- T&S SN1 → SN2 → SN3. The node repo `Projective-Safety` sits beside this one with N0–N4 built, so
  SN1 is runnable now.
- T&S P1d → P2a → P2b → P2c, P2d, SN6, and R4 → R5 → R3 → R2 (R1 landed).
- OPS CFG2.

**Hot files across this file:**

| File                                                     | Writers here                                                 | Writers elsewhere (never at the same time)                        |
| :------------------------------------------------------- | :----------------------------------------------------------- | :---------------------------------------------------------------- |
| `00001150` (stage funding, submissions, cancel, approve) | PM GH1, WP4a, WP4b, P6's callers, WP9, D7b              | FBP DB13, DB14                                                    |
| `00001130` (stages, members, `apply_write_batch`)        | PM D7a, WP4a, WP4b, S3, D7b                             | —                                                                 |
| `00001110` / `00001120` (ticket guards and doors)        | PM D7a, WP4b, P6, WP5a, WP6, GH1, D7b                   | O·WP5b, O·WP6 (after WP6)                                         |
| `00001140` (claims, capacity, workload)                  | PM WP5a, D7b                                                 | —                                                                 |
| `00002011` (projects policies)                           | PM WP4b, WP5a, WP9                                           | —                                                                 |
| `00000017` + `00001260` (disputes)                       | PM-WP4a step 6                                               | FBP DB21; MR3                                                     |
| `00000016`, `00002012`, `00001300`, `00001840` (comms)   | —                                                            | COMMS MS3, MS4, MS5; T&S P1d, P2a–c, P2d                          |
| `00001310` (notification engine)                         | — (NO2 ✅, #565)                                            | T&S                                                               |
| `00001160` (files)                                       | FL3 (FL4 ✅, #570; FL1 ✅, #564)                            | T&S SN2; T&S LK1 (services only)                                  |
| `00005010` (notification catalogue)                      | PM WP4a, WP5a, WP6, D7b, GH1 (FL4 ✅, #570)            | COMMS MS4                                                         |
| `00005060` (jobs)                                        | PM WP5a, D7b, GH1 (FL1 ✅, #564)                             | MR5; T&S SN2                                                      |
| `00002500` / `00002510` / `00002520` (grants)            | every SQL prompt here                                        | every SQL prompt everywhere: one at a time, by name               |
| `features/devtools/**` + `apps/web/utils/dev-seam.ts`    | PM WP4a, WP4b, WP5a, WP5b, WP6, D7b, GH1           | COMMS NT5; T&S R3                                                 |
| `ChatFeed.island.tsx`, `MessagingBackendService.ts`      | —                                                            | COMMS MS3, MS5; T&S R2                                            |
| `ProjectBoard.island.tsx`, `board.ts`, `live-board.ts`   | PM WP4b, P6, WP5a, S3, D7b, WP6, WP8                         | O·WP6                                                             |
| `USER_FLOWS.md`, `PRODUCTION_READINESS.md`               | every prompt                                                 | every readiness track: edit your rows and the computed lines only |

### 0.3 Human stops on this path

Answer them in one sitting and each prompt runs straight through. Each prompt keeps its own 🧑
block, so a question you defer still stops the build at the right step. The PM prompts' stops
(PM-D7a, P6, WP4a, WP5a, WP5b, WP6 and D7b) are in PM §0.5. The numbers below are kept from
2026-11-19, so the missing ones moved to PM §0.5 or were ruled.

| #  | Question                                                                                                                                     | Prompt        | Recommendation                                                                                                                                                                                                           |
| :- | :------------------------------------------------------------------------------------------------------------------------------------------- | :------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5  | #430 (b): what a payee may see of prepaid stages                                                                                             | TK1 ✅ (#556) | Which stages are prepaid, never the amounts, for anyone with project access                                                                                                                                              |
| 6  | #430 (c): a reservation whose stage is repriced                                                                                              | TK1 ✅ (#556) | It keeps the price it was bought at; the new price applies to unfunded stages only                                                                                                                                       |
| 7  | #430 (d) a refund of one prepaid stage; (f) a card prepaying later stages                                                                    | TK1 ✅ (#556) | (d) a payer door while the stage is unclaimed; (f) a card funds the funding stage only, and Buy now says so                                                                                                              |
| 13 | #427 (a): the client creates every ticket on a service engagement                                                                            | ST6 ✅ (#555)  | **Ruled #555:** confirmed: the client creates every ticket on a service engagement, and the details the seller edits exclude tickets (PRODUCT_SPEC.md §Services)                                                         |
| 14 | Manual assignment: who pins a ticket, and what the pinned freelancer may do                                                                  | ST3 ✅         | **Ruled #547:** B, the pin binds nothing until the freelancer accepts it by claiming (or declines); pins on Manual stages only |
| 15 | Where the workload gauge sits                                                                                                                | ST4 ✅ (#550)  | **Ruled #550:** as recommended: beside both Claim controls (the ticket view and the board card) and in the freelancer's `/projects` header; `/home` once PRD-A1 lands |
| 16 | What completes a project; **new contradiction**: PRODUCT_MANAGEMENT.md:255 "stays fundable for extension" vs a terminal `completed`          | EX1 ✅ (#569) | **Ruled #569:** as recommended (owner rulings 1 and 2): both, on its own at the last settlement and by the client's Complete; `completed` stays terminal for money, and extending is the client's logged Reopen |
| 17 | Stage and ticket disputes: what money is contestable, who raises and when, the Phase-1 offer                                                 | EX2 ✅ (#548) | Held escrow, plus the pending window once DB6 lands; either party, from in_review or within the pending window; a share offer the other side accepts                                                                     |
| 18 | **New contradictions**: the spec's 48 h offer cooling-off vs the built respondent deadline; §3.1 "work suspended" vs no disputed state       | EX2 ✅ (#549) | Keep the built deadline, with the offer inside it; no new status, a guard freezes moves and claims instead                                                                                                               |
| 19 | What the Evidence Vault captures, who reads it; ⚖️ its retention                                                                             | EX3 ✅ (#558) | Stage rooms (with revisions), ticket history, submitted file versions and the terms at raise, under a sha256 manifest; parties read the manifest and PDF, operators the raw snapshot; nothing purged until counsel rules |
| 20 | Which workload verdict can be appealed                                                                                                       | EX4 (#552)    | The moderator's bad-faith flag only: once, to a different operator, within 7 days. **(a) ruled #552:** a client's keep penalises nobody and refers the report to a moderator                                             |
| 21 | The message edit and delete rule; ⚖️ keeping an original after "delete for everyone"                                                         | CH1 ✅ (#562) | **Ruled #562:** as recommended (A): edit for 15 minutes; delete for everyone at any time; originals kept; nothing in an archived room changes, nor in the disputed stage's rooms or the project's General room while the dispute is live |
| 22 | Who gets team and business rooms, and when                                                                                                   | CH2 ✅ (#561) | **Ruled #561:** eagerly, as recommended: a team's room when its seat on a stage goes live, a business's on every stage of a business-client project. And a new contradiction, ruled: one room per team, so a second team or a solo freelancer on the stage never reads it; a released seat keeps nothing |
| 23 | Who may bring a pair DM into a project                                                                                                       | CH3 ✅ (#560) | **Ruled #560:** as recommended: either participant, while both are on the project; the other is told; either may take it out, which hides it for both and keeps every stamp |
| 24 | ⚖️ Mailing an invitation to an address with no account; does `application.received` email?                                                   | NO1 ✅ (#566) | **Ruled #566:** as recommended: one transactional invite behind `project_invite_mail_enabled`, off until counsel; `application.received` emails. No hourly digest exists; ruled keep as built (#566 (a)): in a person's daily or weekly digest when they take one, else one email per application |
| 25 | When a push device is dropped                                                                                                                | NO3 ✅ (#567) | **Ruled #567:** as recommended: at once on 404 / 410; otherwise after 5 consecutive failures whose first is at least 24 h old; a successful push refreshes `last_seen_at`; Settings says so |
| 26 | Guest invitations on their own mail subdomain (#391 (n)) | NO4 ✅ (#571) | **Ruled #571:** yes, as recommended: `MAIL_FROM_INVITES`, falling back to `MAIL_FROM` while unset; the DNS is yours |
| 27 | Retention of soft-deleted files; when `storage_quota_enforced` flips (#58)                                                                   | FL1 ✅ (#564) | **Ruled #564:** as recommended: purge the bytes after 30 days and keep the row; the quota on in UAT, flipped by you                                                                                                    |
| 28 | #394 (a) one Google connection or two; which connectors ship for UAT | FL2 ✅ (#568) | **Ruled #568:** as recommended: one Google client, two connections (`google_drive` beside `google`); Google Drive and S3 ship for UAT, and Dropbox, OneDrive and Frame.io are Planned |
| 29 | #161 (a) a `fil-` slug and the old uuid links; **new contradiction**: F26's "no frames" vs #401's preview ladder                             | FL3 (#563)    | A `fil-` slug, with old links 404ing per #88 (or one release of 301s, your call); the inspector CSP allows only the ladder's frames                                                                                      |
| 30 | #402 (d) who a grant notifies; (k) re-ruled, so a tier drop revokes links; (e) a block check on person grants                                | FL4 ✅        | **Ruled #570:** as recommended for (d) and (k): person grants notify; group grants appear in Shared with me; a tier drop revokes after a confirm naming how many. (e) deferred: the platform has no blocking, so PJ-78 waits for it |
| 31 | An owner-present run on your Zoom, Microsoft and Google accounts                                                                             | LP1           | Yes, in one sitting, once a public HTTPS origin exists                                                                                                                                                                   |
| —  | T&S P2a (#147 (a)), P2b's cooling-off and T&S §0.4 (SN1's production default); SCH-WP7 (#344 (f)); CD2's hosted prerequisites | their prompts | Their own                                                                                                                                                                                                                |

**For counsel** (build behind a switch that stays off; never switch it on):

- NO1's lawful basis for mailing someone who has no account (built behind
  `project_invite_mail_enabled`, seeded off, #566).
- CH1 (built with no purge, #562): keeping a message's original after its author deletes it for
  everyone. This is evidence retention against erasure.
- EX3 (built with no purge, #558): the Evidence Vault's retention period, and the weight of the dispute summary PDF.

### 0.4 Not in this file

- **PJ-14** (Round Robin, Parallel Stream, the Global Workload Kanban) stays ⏸: Planned by #338 P3
  (PM §0.6).
- **PJ-74** (the project calendar) stays ⏸ by ruling (#343 C7 (a), #413).
- **COMMS CD2, the hosted send**, deferred twice by you (#484). Five rows here stay 🟡 until it
  runs: PJ-17, 60, 61, 71 and 72. Its proof list names this file's cases.
- **The safety node** (PRD-D10) lives outside this repo, in `Projective-Safety`, which sits beside
  it with N0–N4 built. T&S SN1 and SN3 run against it; SN1 is runnable now.
- **Calls & sessions** (MK-48 to MK-59) shares LP1 and SCH-WP7. A work-order file for it should cite
  LP1 for the live run rather than write a second.
- **PM-WP5b** (the Reliability Index), **PRD-E16** (Marketing re-subscribe) and **#508 (a)** (the
  uuid link in `00001170`) move no PJ row.
- **The `fixed_date` and `on_hire_confirmed` start triggers** drive nothing (PM §0.6). No PJ row
  names them; D7b may take them if you want.

---

## 1. Headers

### 1.1 Standard header — paste above every ST, TK, EX, CH, NO, FL, LP and PJZ prompt

```text
You are working in the Projective monorepo (Deno 2.x; apps/web Fresh 2 + Vite + Preact islands
with @preact/signals; packages/ui the pure-CSS BEM design system @projective/ui; packages/types
the Zod SSOT @projective/types; packages/backend fat services @server/services/*;
supabase/migrations Postgres with RLS everywhere; Stripe Separate Charges & Transfers on
Accounts v2 Express).

Before writing code:
  1. Read the root CLAUDE.md and every sub-directory CLAUDE.md on the paths you touch (always
     documentation/CLAUDE.md; documentation/database/CLAUDE.md when SQL changes;
     packages/ui/CLAUDE.md for UI), then documentation/reference/guardrails.md and
     documentation/reference/pr-checklist.md.
  2. Read documentation/readiness/USER_FLOWS.md (your rows) and
     documentation/readiness/PROJECTS_BUILD_PROMPTS.md §0 (run order, file locks, stops). If you
     touch 00001200, 00001240, 00000017 or 00001210, also read FINANCE_BUILD_PROMPTS.md §0.1: its
     SQL lane decides when you run. If you touch the projects schema, read PM_BUILD_PROMPTS.md
     §0.4 (its file locks) and the OWNER RULINGS on Decision #338.
  3. Grep documentation/reference/decisions/README.md for the surface you touch and read the
     decision files it names. If a decision already rules the behaviour you are about to change,
     stop and ask me.
  4. Read the spec sections your prompt names: PRODUCT_SPEC.md, PRODUCT_MANAGEMENT.md (§3.4-§3.8
     for any lifecycle), documentation/flows/Projects.md, and documentation/database/<schema>/ for
     every object you change.
  5. The CONTEXT below was verified at main @ e1ff027b on 2026-11-19. Re-check every file:line
     against the current tree before relying on it; another track may have landed since. Report
     any premise that no longer holds in your final message; never work around it silently.

Hard rules (merge gates; reject your own diff if any fails):
  - Migrations are consolidated and EDITED IN PLACE (vvvvtooo_type_purpose.sql); never an ALTER
    patch or a "fix" file. Each statement in its category file (0 tables · 1 functions · 2
    policies/grants: 00002500 schema grants, 00002510 function grants, 00002520 table grants · 3
    views · 4 indexes · 5 seed; 00005001 params, 00005010 notification types, 00005060 jobs).
    The Additive Rule: no dropped table, column or FK without my OK, above all on escrows,
    wallets and project_stages.
  - SECURITY DEFINER functions pin search_path = '' and schema-qualify every name. Function
    EXECUTE is deny-by-default (#477): grant each callable function by name in 00002510. RLS
    stays on; a new write goes through a door, never a client policy. A signed-in request runs
    under the user's JWT; the service role only inside a definer, cron or webhook door.
  - Money: integer minor units; floor every cut; dust to a named sink. Every escrow moves through
    its finance door (fn_hold_ticket_escrow, fn_release_ticket_escrow, fn_refund_ticket_escrow,
    fn_fair_exit_release); never UPDATE finance.escrows or finance.wallets directly. No hold, no
    work (#165). Released and Refunded are reached exactly once per escrow (#188). Every Stripe
    effect claims finance.idempotency_keys in the same transaction. finance_invariants.sql and
    conservation_identity.sql stay green; a new money flow adds its terms to
    finance.v_conservation_identity (#483).
  - Authority lives in the SQL door (can_review_project, is_ticket_manager,
    fn_assert_business_actor, fn_assert_ticket_move, fn_holds_live_seat); the service mirrors it
    only to decide what to offer. Pure rules are mirrored in TS under a parity test;
    state-dependent rules reach the client as server DTO flags; never a permissive client on a
    money path (#338 P5 (e); #341 (n)).
  - Thin routes (HTTP parse + Zod + auth guard); logic in packages/backend/services/* returning
    ServiceResult<T> (#10). The stub path uses the same pure predicates as the live one
    (stub-parity.test.ts). Islands never import Supabase or @server/*.
  - A schema or RPC-contract change lands with its Zod row schema (packages/types/*/rows.ts and
    its contract test), the backend mapper and documentation/database/* in the same change; a
    business rule with PRODUCT_SPEC.md (and finance-model.md for numbers; remove any "Not built
    yet" marker you build); a lifecycle or state with PRODUCT_MANAGEMENT.md; a route or URL state
    with ROUTING.md (prj-/stg-/tkt-/cht- slugs, Decision #88; uuids do not route; state that
    should be addressable is a URL, not a signal; a redirect comes from define.handlers, #61); a
    component with DESIGN_SYSTEM.md §C.1; an env key with SYSTEM_ARCHITECTURE.md §Environment
    Variable Contract and .env.example (XXXX-XXXX).
  - UI: token-only pure CSS + strict BEM; no card in a card; non-actionable metadata as inline
    --text-secondary MetaLine text, a Tag only for a lifecycle status; headings never reach
    --fw-bold; tabular-nums on every figure; every money figure a MoneyView; one filled control
    per decision region (#157); one dialog at a time (@projective/ui Dialog with a Signal
    `visible`, a bottom sheet on mobile); press feedback transform: scale() only, removed under
    both reduced-motion channels; focus rings stay OFF app-wide (#245 (a)). A control that renders
    must do something: one whose engine is not running opens LockedDialog with its reason.
  - Signal-first state; no useState; useEffect only for browser or Stripe APIs. Path aliases only;
    folders components/ islands/ styles/ hooks/ wrappers/ types/ core/, no src/. JSDoc on exports;
    // #region blocks; no meta-comments.
  - Every new simulatable axis gets its Dev Context Switcher control in the same change
    (DevOverrides + DEV_DEFAULTS, DevOption list, DevContextPanel, reflect() set AND delete).
  - No bespoke statuses. Nothing is hard-deleted except a ticket or stage never claimed, funded or
    submitted against (#338 P2 (b)); everything else archives.
  - Log one decision row for the work: what is now true, the date, the prompt ID, the USER_FLOWS
    rows it moves, OWNER RULINGS, BUILT, and FLAGS (a)… for what you leave open. Use the newest
    decisions-*.md plus a README index line, and grep for the next free number right before you
    write (numbers collide across peers). A NEW contradiction between source docs: do not pick a
    side; log it and ask me.
  - 🧑 DECISION: stop at the named step, put the options and your recommendation to me, and build
    nothing that depends on the answer until I give it. Build every step the question does not
    touch. ⚖️: build behind a param or flag that stays off; never switch it on.

Verification: reproduce the defect first (a failing probe or test), then fix.
  SQL: rollback-safe probes under supabase/probes/ (\set ON_ERROR_STOP on, a pg_temp helper that
  raises 'PROBE FAIL: …', ROLLBACK; only a concurrency probe commits, gated on :{?disposable},
  modelled on seat_fill_concurrency.sql); `deno task test:probes` (a name filters); `deno task
  db:reset` is standing-approved but announce it to concurrent sessions first; finish with your
  own clean `deno task test:probes:fresh`.
  Always: `deno task check`, `deno task lint`, `deno task test:unit`, and `deno fmt` on the files
  you touched only (never a directory). Compare a red unit test with main before calling it yours
  (theme-engine failures are pre-existing, Decisions #96 (a) and #157 (m)).
  UI-visible changes: `deno task dev`, the seeded personas (documentation/database/Seed.md), and
  screenshots at 1440, 900 and 390 px in light, dark, data-contrast="high" and
  data-motion="reduced".
This checkout is shared with other sessions: never switch branch, never stash, stage only your
own hunks, verify in a clean worktree. Commit on the branch you were given. Do not push or open a
PR unless I ask.

When you finish, do the closing duty (documentation/reference/build-prompts.md §2) in the same
commit as the work:
  - In documentation/readiness/PROJECTS_BUILD_PROMPTS.md: a done prompt leaves the file. Delete
    its section and add its row to §0's Done ledger (ID · what landed · commit · text at
    <commit>^). A partly done prompt keeps only its open steps, with their numbers unchanged,
    under one rewritten Status line. A ruled 🧑 stop becomes the ruled step, with its decision
    number.
  - Treat any step you built for another prompt the same way, in the file that holds it.
  - Run git grep -n "<ID>" documentation/ and update every place that still calls it open: the
    PRODUCTION_READINESS / USER_FLOWS Track cells, the audit's Status column, other prompts' waits,
    this file's §0.1 row map, and this file's row in documentation/reference/build-prompts.md §3.
  - If the file has no prompts left, delete it, log it in build-prompts.md §4 and repoint its links.
```

### 1.2 Readiness addendum — paste after every prompt

```text
READINESS (Decision #444): in the same change, update documentation/readiness/USER_FLOWS.md:
the row(s) <ROWS> — Status and "What's missing", with evidence naming your commit and decision;
recompute the PJ cluster line and the three tier rows of the Scoreboard (score = Σ weight ×
credit / Σ weight; ✅ 1 · 🟡 0.5 · ❌ 0; Critical 3 · High 2 · Normal 1; ⏸ excluded; a row counts
in every tier from its own Gate on) and the "Critical flows not yet ✅" list; add one §Score
history line in the file's format ("ST3 (#NNN): PJ-13 ❌ → ✅ (…)"). If your prompt names a PRD-
row, update documentation/readiness/PRODUCTION_READINESS.md the same way. Use 🟡 when a hosted or
human step is left, and name it; never flip a row on a test you did not run. Other sessions edit
these files: re-read right before you edit, change only your rows and the computed lines (split
table cells on unescaped pipes only). A gap you find and do not fix gets a new row at the end of
its section (IDs are never reused), never silence. Finish with: what you built; the rows you moved
(old → new); every probe and test you ran, with its result; every 🧑 question still open.
```

---

## 2. Project setup, stages & members

## 3. Tickets & delivery

Both prompts landed: TK1 (#556) and TK2 (#557); their rows are in §0.0.

---

## 4. Completion, exit & disputes

### EX4 — A moderator's workload verdict can be appealed once

Closes PJ-46 (🟡 → ✅) after PM-WP4a step 6.

**Status (2026-11-24, #552):** stop 20 is ruled: the moderator's bad-faith flag only, once, within 7
days, to a different operator. Nothing is built: PM-WP5a, T&S R3 and R4 have not landed. Premises
corrected below: the flag writes a `discovery_rank` penalty, so a successful appeal restores the
Explore rank through R4's `fn_reverse_penalty` and leaves Standing alone, and the cites moved. #552
(a) is ruled (2026-11-25): a client's keep penalises nobody and refers the report to a moderator.
Re-checked at `2a143020`: the three waits still have not landed.

```text
PROMPT EX4: A freelancer can appeal a moderator's bad-faith verdict on a workload report once,
to a different operator, and a successful appeal reverses its penalty

ROLE: Full-stack engineer. Queue S, after PM-WP5a and T&S R3 and R4 (R1 has landed).

CONTEXT (verified at e1ff027b, cites re-checked at 2a143020; re-check every line):
  - This is W8 (PM §0.6's last bullet; PROJECT_MANAGEMENT_COMPLETENESS_AUDIT.md:538, :667), with no
    prompt. projects.fn_flag_bad_faith_report (00001140:7) is ungranted, so no moderator can
    call it. /admin/disputes reads finance.disputes only.
  - A workload report moves no money (#290, PRODUCT_SPEC.md:3133-3155), so its contest is an
    appeal against a penalty, not a finance.disputes row. Its home is ops.reports (T&S R1, landed; subject type workload_report), R3's
    /admin/reports desk and R4's penalty writer (TRUST_SAFETY_BUILD_PROMPTS.md:723-931).

RULED (#552): only the moderator's bad-faith flag is appealable (the lapse penalty is
mechanical); once, within 7 days of the flag, to a different operator. The flag writes a
discovery_rank penalty (source_type workload_report, 00001140:29-35), so a successful appeal
reverses it through R4's security.fn_reverse_penalty and restores the Explore rank. Standing is
untouched: R5 computes it from trust_score penalties only.
RULED (#552 (a)): the client's "keep" answer (PM-WP5a hands it here; §Dispute Mechanism 4)
penalises nobody. It closes the report 'acknowledged' with no W_i change, resumes the work, and
refers the report to a moderator; only the moderator's bad-faith flag cuts the rank.

STEPS:
  1. Red first: a probe in which a moderator flags a report and nothing can appeal it.
  2. The moderator door: fn_flag_bad_faith_report reached only through an ops definer that
     checks ops.admin_users. Beside it, the client's keep (#552 (a)): a review-authority door
     that closes the open report 'acknowledged', resumes the work at the original W_i and
     files the ops.reports referral; the moderator's flag then moves it to dismissed_bad_faith.
  3. The appeal: an ops.reports subject for a workload report, with a CHECK that the deciding
     operator is not the one who flagged it. A freelancer control on the verdict notice, and a
     desk view.
  4. The reversal through R4; notifications both ways.

ACCEPTANCE: the probe is green (a keep penalises nobody and queues a referral; appeal once; a
second refused; the same operator refused; the penalty reversed); live as the seeded freelancer
and two operators; screenshots.

SAME CHANGE: PRODUCT_SPEC.md §Dispute Mechanism 4; PRODUCT_MANAGEMENT.md §3.5's Workload report
row (clear EX4's Not built yet); documentation/database/{ops,projects}/*; Zod; the decision row
(W8 closed).
```

§1.2 rows: **PJ-46** → ✅ if PM-WP4a step 6 has landed (else 🟡, naming it).

---

## 5. Messaging

---

## 6. Notices

---

## 7. Files & assets

### FL2 — Importing from a connected drive works, and each connector is proved or ruled

Closes PJ-65 (🟡 → ✅) once you have walked it.

**Status (2026-11-25, #568):** steps 1–4 landed. A Drive file is added to the library as a reference
("Add to Library", a service-role mount, one row per object per connection); the tree's children page
by cursor and a drive's search is Drive's own; S3 connects on its credential form
(`fn_open_s3_connection` / `fn_store_s3_connection`, probe `s3_connection.sql`). Stop 28 is ruled
(#568): one Google client, two connections; Google Drive and S3 ship for UAT, and Dropbox, OneDrive
and Frame.io are Planned. Step 5 is left, and it needs you.

```text
PROMPT FL2 (step 5 of 5): the live Drive round trip, with the owner present

ROLE: Full-stack engineer, with the owner. App lane.

CONTEXT (verified at #568):
  - IntegrationsBackendService.importAsset mounts through mountAsset (live-library-writes.ts);
    the hub's drive files carry "Add to Library". Everything was exercised against faked Google
    answers only (#394 (c)).
  - #568's flags (b) no folder choice from the hub and (c) no way to remove a mount are open and
    are not this step.

STEPS:
  5. With me present: the live Drive round trip on my account (consent, browse, import, open),
     recorded like #386 with no secret printed.

ACCEPTANCE: the live round trip is recorded; a screenshot of Add to Library and of the mounted
file in the library.
```

§1.2 rows: **PJ-65** → ✅ once Drive import is walked live (the rest are ruled Planned, #568).
Otherwise 🟡, naming what is left.

### FL3 — The File Inspector routes by slug, sandboxes a raw PDF, and has its own CSP

Closes PJ-66 (🟡 → ✅).

> **Status 2026-11-25:** steps 1 and 3 landed (#563): a stored PDF is always an attachment under
> the sandbox CSP and keeps `application/pdf` for pdf.js (`live-objects.ts:97-115`,
> `stream.ts:69-83`), so F20 is closed; `csp.test.ts` holds step 4's red test as `ignore: true`.
> The new contradiction is logged in #563 (b). Steps 2 and 4 below are open and wait on the three
> stops, which were put to the owner on 2026-11-25.

```text
PROMPT FL3: The File Inspector is addressed by a fil- slug, and the inspector's
Content-Security-Policy allows only what it uses

ROLE: Full-stack engineer. Queue S for the slug (files schema); app lane for the CSP.

CONTEXT (verified at e1ff027b; re-check every line):
  - #161 (a): /inspect/[fileId].tsx re-exports InspectScreen; inspector-ssr.ts:27-35 passes the
    raw id on; AssetIdSchema is a uuid (packages/types/files/assets.ts:162).
  - F26: the inspector profile is the app profile plus relaxations (csp.ts:122-126). Its base
    keeps Stripe and Turnstile in script-src (:86), and in frame-src Stripe, Turnstile,
    youtube-nocookie and EMBED_FRAME_ORIGINS (:102-110), with 'unsafe-inline'. It also serves
    /files/* ((dashboard)/files/[...path].tsx:102, #396).
  - A NEW contradiction (#563 (b)): F26's fix ("no frames") conflicts with #401's preview ladder,
    which needs EMBED_FRAME_ORIGINS (csp.test.ts:30).

🧑 DECISION (before step 2). Put all three to me:
  1. #161 (a). Recommended: a fil- slug (Decision #88: security.fn_slug_guard('fil'),
     SLUG_PREFIXES, the Tables.md entry, the contract tests).
  2. Old uuid links. Recommended: they 404, per #88. Or, your call, one release of 301s from
     define.handlers (#61).
  3. F26 against #401. Recommended: the inspector gets its own base, with no Stripe or Turnstile;
     frame-src holds only the preview ladder's origins.

STEPS:
  2. The fil- slug, in place: column, guard, index and Zod; the route and inspector-ssr resolve
     it; every link builder uses it.
  4. F26: the inspector base as ruled; csp.test.ts's F26 test (now `ignore: true`) switched on,
     with the ruled frame-src asserted.

ACCEPTANCE: the tests are green; live, a PDF opens in the inspector from its slug URL;
screenshots.

SAME CHANGE: ROUTING.md; documentation/database/files/*; Zod; SYSTEM_ARCHITECTURE.md (the CSP
profiles); COMMUNICATIONS_ASSETS_SEARCH_AUDIT.md (F26); the decision rows.
```

§1.2 rows: **PJ-66** 🟡 → ✅.

---

## 8. The live-provider proof

### LP1 — Zoom, Teams, Meet and Microsoft calendar, run on your accounts

Closes PJ-44, PJ-76 and PJ-77 (each 🟡 → ✅ per provider proved). The Calls & sessions work orders
(MK-49, MK-52) cite this run rather than writing their own.

```text
PROMPT LP1: Prove the rooms, the presence reads, the no-show audit and Microsoft calendar sync
on real provider accounts, with me signing in and you reading the results

ROLE: Integration engineer. Human lane: I am present for every sign-in. You never sign in to a
provider account, never type a secret, and never print one (.env.local values are quoted; check
key shapes in a script, not in your output).

CONTEXT (verified at e1ff027b; re-check every line):
  - Built and probed locally only (#392: "Not run on live provider accounts"):
    rooms/adapters.ts (Zoom past_meetings participants :233, Meet conferenceRecords :345, Teams
    attendanceReports :453); the canonical webhook /api/integrations/webhooks/[provider].ts
    (/api/sessions/webhooks/:provider is a legacy alias); the no-show route
    routes/api/sessions/sittings/[eventId]/no-show.ts → finance-dispute-sweep (00005060:30-32);
    integrations-presence-reconcile (:283) feeds presence; fn_dispute_attendance_audit
    (00001260:146). USER_FLOWS PJ-77 names the legacy alias as its entry; Meet is unproven too
    (#386).
  - #386 proved Google on my account (consent, a busy read of 373 spans, one mirrored copy). Not
    proved: Microsoft or Zoom consent, a real Meet room, Teams.
  - Graph subscriptions (channels.ts:88) and Google watch channels (:65) need a public HTTPS
    notification URL. OPS6 (#512, OPERATIONS_BUILD_PROMPTS.md) describes the hosted origin and
    lists the OAuth redirect URIs and these provider notification endpoints (its step 5 (d)).
  - EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md §7.4 (:1333+), §7.5 (:1397+), §7.7
    (:162) hold each provider's setup.

PREREQUISITES (mine; list what is missing before you start, then stop until I have them):
  - A public HTTPS origin: staging per OPS6/OPS7, or a tunnel to the dev server.
  - Zoom: a General app (ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET) with the granular scopes, including
    meeting:write:batch_registrants; an Event Subscription to
    {APP_URL}/api/integrations/webhooks/zoom with ZOOM_WEBHOOK_SECRET and URL validation; a
    licensed (Pro) host and a Basic host.
  - Microsoft: a work or school M365 tenant with Teams (personal accounts are out, #383 R4); an
    Entra app with a redirect URI per environment and the delegated permissions §7.4 names
    (OnlineMeetings.ReadWrite among them); MICROSOFT_INTEGRATION_CLIENT_ID / _SECRET / _TENANT.
  - Google: the meetings.space.* scopes on the account #386 used.
  - INTEGRATIONS_BACKEND_LIVE on in that environment only.

RUN (record each as evidence: what was done, the result, redacted payloads, screenshots):
  1. Preflight: the env shape check, deploy:check if OPS6 has landed, and every webhook URL
     reachable from outside.
  2. Microsoft calendar (PJ-76): consent; a busy read; mirroring out to the Projective calendar;
     a change notification arriving; disconnect revoking it.
  3. Teams (PJ-77): a room for a seeded sitting; the lobby; two people join; the attendance read.
  4. Zoom (PJ-77): on the licensed host, registrants approved at first join and presence read; on
     the Basic host, the participant read refused, so a no-show claim holds.
  5. Meet (PJ-77): a RESTRICTED room; join; conferenceRecords read.
  6. The no-show audit (PJ-44) on live data: one refund, one dismissal and one ambiguous case.
  7. Anything that fails is a bug: fix it in this session if it is small; otherwise stop and
     write it up as a new USER_FLOWS row.

ACCEPTANCE: each step's evidence is in a decision row like #386's; every probe stays green.

SAME CHANGE: EXTERNAL_PROVIDERS_AND_INFRASTRUCTURE_SPECIFICATION.md (what was proved);
SCHEDULING_BUILD_PROMPTS.md's live-run notes; the decision row (#386 and #392 updated).
```

§1.2 rows: **PJ-76** (Microsoft), **PJ-77** (each provider), **PJ-44** (the three outcomes), each →
✅ only for what was run. Correct PJ-77's entry route.

---

## 9. Last — the sweep

### PJZ — The rows, the work orders and the specs agree with the code

```text
PROMPT PJZ: The PJ readiness rows, this file, PM_BUILD_PROMPTS and the specs agree with the code

ROLE: Documentation engineer. App lane, last.

STEPS:
  1. Re-check every row of USER_FLOWS §PJ (PJ-01 to PJ-77) against main: the status, the
     "What's missing" text and every file:line. Rows whose note is stale but whose status is
     right get their text fixed here. Known on 2026-11-19: PJ-15, PJ-69 and PJ-71 say "in-app
     only" or "Push and email not sent (#390)", but email and push are dispatched locally through
     NT2–NT4 (ee275e93, 153f20d9, 322c4dc9), the hosted send is CD2's, and #390 (g) was closed by
     #391; PJ-57 files Tier 3 under PRD-D7 and D8, but Tier 3 is PRD-D13 (T&S SN6); PJ-59 per
     §0.1.
  2. Fix what no prompt fixed: PRODUCTION_READINESS PRD-H2's work-order cell (it says "—"; it is
     OPS CFG2, and the gates differ: PJ-75 is UAT, PRD-H2 is PROD), and USER_FLOWS line 64's PJ
     cells ("No email, push or SMS reaches anyone": email and push are built locally, the hosted
     send and SMS are left; tell the COMMS owner). Check OPERATIONS §0.1's PRD-B6 row too: on
     2026-11-23 it still listed F·DB3, landed in 44382c08, as a PM-WP4b blocker.
  3. PROJECTS_BUILD_PROMPTS.md: each prompt that landed has left the file under the closing duty;
     check §0.0 and §0.1 against git log, and re-run the score projection over the rows as they
     stand.
  5. If PM-Z1 has not run, do its PJ half here and say so.

SAME CHANGE: docs only. `deno fmt` on the files you touched.
```

§1.2 rows: the notes named in step 1; the scoreboard as it then stands.
