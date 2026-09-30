> Full rows of Resolved Decisions #64–#69 (former root CLAUDE.md §8), verbatim.

| #  | Decision (2026-07-12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Applied in                                                                                                                                                                                                                                                                                    |
| :- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 64 | **Ticket system rebuilt — the composer, the detail modal, and a derived price (2026-08-01).**
The `.tkm` ticket modal is deleted and replaced by two purpose-built surfaces on
`/projects/[id]/board` and `/projects/[id]/[channel]/tasks`. **The headline rule: a ticket's price
is never typed.** The manual budget field is gone; cost is the SUM of the selected stages, each at
the difficulty multiplier the client chose for it — `stageCostCents` / `ticketTotalCents` in the Zod
SSOT, called by the composer footer, the board card and the fixtures alike, so no second arithmetic
path exists to round differently. **Workload Intensity becomes a first-class control**
(`TicketIntensity` = the Architect's Override, PRODUCT_SPEC §The Weighting Engine: Low 0.5x /
Standard 1.0x / High 2.0x) and is the single lever that moves BOTH the money and the freelancer
capacity `W_i` — the two were always one axis in the spec and are now one axis in the interface.
**All tags removed** (ticket- and stage-level: schema field, card row, `BoardListParams.tag`, the
API param, the fixture vocabulary). **The composer** (`TicketComposer`, `.tkc-*`) is three regions,
each answering exactly one question: LEFT the ticket (title, brief, intensity, priority, due date,
attachments, reorderable task list); CENTRE the stage pipeline as a real flow diagram — a gutter
rail of numbered execution steps, cards carrying a chevron (not a "details" link), the derived stage
cost, a one-line truncated stage brief and a cascading `AvatarStack`, drag-reorderable with a drawn
landing seam; RIGHT a stage inspector that renders ONLY while a stage is selected, split into "This
ticket" (stage brief, intensity override, stage task list) and "Stage overview" (read-only roster,
existing stage tickets, rate, routing mode, capacity cap). **Simultaneous stage execution** is
modelled as `TicketStageRef.parallel` + the pure `executionBands()`: a stage joined to the one above
it starts with it, collapsing two numbered steps into one band drawn on the rail. **The detail
modal** (`TicketDetail`, `.tkd-*`) is a document, not the composer greyed out: status + meta badges,
the brief, the stage run, and three archives — History (`ticket_history`-shaped audit log),
Attachments and Submissions, the latter two mounting the SAME `/files` `FileCard` and `/submissions`
`SubmissionTree`/`SubmissionNodeList` components rather than second renderers. Owner/admin editing
is IN PLACE via the new `InlineEdit` primitive; a viewer without the right sees plain text with no
affordance, because a disabled control advertises a capability and then refuses it. **Three NEW
`@projective/ui` primitives** (§C.1 roster updated in the same change): `dnd/DropIndicator` (the
landing seam — the ghost says _what_, a highlighted neighbour cannot say _where_),
`display/AvatarStack` (data-driven roster + `+N`, one composed a11y label instead of a stream of
initials; `--avatar-ring` added so the gap is drawn in the colour actually behind the stack), and
`fields/InlineEdit`. **No DB migration** — the board stays a read projection over fixtures like its
siblings, and every new field maps to a column that already exists (`tickets.workload_intensity`,
`due_date`, `unit_price_cents`, `ticket_history`, `project_stages.description_text` /
`unit_price_cents` / `assignment_mode` / `max_concurrent_intensity`), so the live path slots in
behind the same `PROJECTS_BACKEND_LIVE` with no shape churn. **Dev Context Switcher (§5 gate) —
wired, no new axis.** The board originally read the raw SSR `viewerIsClient`, so it was blind to the
switcher: flipping the persona changed nothing. A new pure `core/board-access.ts` now resolves a
`BoardAccess` set (`isClient` · `isFreelancer` · `canEditTicket` · `hasTickets`) by layering the
seam over the SSR baseline, and the board body, the composer, the detail modal AND the middle-nav
footer rig all read it, so a persona flip moves all four together with no reload. It does NOT
re-derive the client/provider split — it delegates to the submissions `resolveViewer`, because two
answers to "which side of the market is this person on" is one too many and the board sits one tab
from the Submissions explorer. **No new axis was added**: the existing Account type · Entity
ownership · Team role · Service type controls already express every branch, and a fifth
near-duplicate axis would only create ambiguity about which one wins. `canEditTicket` is
deliberately NARROWER than `isClient` — a project manager can commission work without being able to
silently reword what a freelancer already agreed to deliver, so inside a team it takes ownership or
an admin seat while an individual client owns their project outright. **Two holes found by
measurement:** (a) with the composer open, flipping to a freelancer left the submit button live AND
it created the ticket — read-only inputs gated the controls but not the action, so the capability
now gates the submit and the board closes a composer whose seat has lost the right (the detail modal
stays open and degrades in place, because READING a ticket was never the gated part); (b) a session
engagement has no tickets at all, which absence alone reads as a missing control — `hasTickets`
gives the rig one sentence ("Sessions are booked, not ticketed.") while a viewer who merely lacks
the seat still gets pure absence. **Four defects found by measurement, not inspection:** (a) Escape
inside an inline edit closed the whole dialog — `useDismiss` binds Escape on `document` in the
CAPTURE phase specifically so inner handlers cannot swallow it, so `stopPropagation` loses by
construction; `InlineEdit` now registers on `window` capture, which precedes `document` in the
capture path, and `stopImmediatePropagation`s there. (b) The parallel-execution control was inert
because it was gated on `stage.locked` — that lock governs the PROJECT's stage sequence, not how one
ticket routes through stages; ungated. (c) The four-segment Priority control clipped its last option
to 139px when paired beside Due date in a 21rem panel; both now take a full row. (d) The step
numeral sat on `--primary` at **3.57:1** in dark mode — the theme's own `--on-primary`/`--primary`
pair — so the node was redrawn as a primary RING with the numeral on the surface pair at 14.4:1.
Verified in-browser on both routes: derived totals agree card-to-modal ($525 + $400 + $300 = $1,225;
a Low ticket at $262.50 + $150 = $412.50 with W 1.35), stage-level intensity override moves the
footer live, execution bands collapse the step rail, keyboard drag reorders, create round-trips to
the board, submissions drill tree → unit → files, light + dark all >= 5.38:1, `dir="rtl"` mirrors
with zero horizontal overflow in both directions, 390px reflows the stage card via a CONTAINER query
(the pipeline's width is not the viewport's — with the inspector open on a 1280px desktop the centre
region is ~540px), detector clean, no console errors. **Flagged (surface, do not silently
resolve):** (a) `--on-primary` on `--primary` measures **3.57:1** in dark mode — a theme-engine
pairing used by every filled primary control in the product, not a local choice; this pass routed
around it rather than patching one surface, and it needs a human decision at the token layer. (b) A
stage's `categoryWeight` is fixture-derived; the live path must read the real CREATE-category
weight, or `W_i` will be plausible and wrong. (c) Attachment upload is staged by NAME only — real
upload lands with `PROJECTS_BACKEND_LIVE`. (d) Editing a ticket in place is optimistic and
per-session, like every sibling board mutation. (e) A stale `packages/*` edit is NOT picked up by
HMR — the dev server must be restarted, which cost two false negatives during verification. |
`PRODUCT_SPEC.md` §The Weighting Engine / §Creation & Purchasing Gate · `DESIGN_SYSTEM.md` §C.1 ·
`packages/types/projects/board.ts` ·
`packages/ui/{dnd/components/DropIndicator,display/components/AvatarStack,fields/islands/InlineEdit}`
· `packages/backend/services/projects/board-fixtures.ts` ·
`apps/web/features/projects/{components/ticket/*,core/ticket-model.ts,styles/ticket-{composer,detail}.css,
islands/ProjectBoard.island.tsx,components/TicketCard.tsx}`
· `apps/web/routes/api/projects/board.ts` · Decisions #21 / #32 / #33 / #35 / #62 |

| 65 | **View Ticket modal rebuilt + the modal STACK primitive (2026-08-01). EXTENDS Decision #64.**
The `.tkd` read modal is replaced by `.tkv` — a Splitter-based document with six tabs and a
collapsible pipeline panel — and, underneath it, a new `@projective/ui/overlay` primitive that
changes how this product opens a modal from inside a modal. **(A) The stack.**
`createModalStack()` + `useFrameState`/`useFrameScroll` (DESIGN_SYSTEM **§B.10.9**, new) is a chain
where only the TOP frame renders: opening a submission review from a ticket REPLACES the ticket
rather than covering it, so a two-deep chain composites ONE blurred backdrop instead of two and runs
one focus trap instead of two, and the ticket's live state — tab, browsed submission path, open
stages, scroll offsets — is held in a deliberately **non-reactive** `Map` cache so popping back
restores the surface the viewer left. Two implementation facts are load-bearing: the cache is not a
signal (a scroll write must not re-render the host), and frames key off a monotonic `uid` (the same
ticket twice is two visits). **(B) The chain owns its URL with `replaceState`.** The obvious design
— `pushState` on open, `history.back()` on dismiss, so browser Back closes the overlay — was built,
and then MEASURED reloading the document: `history.back()` from a pushState entry replaced the page,
destroying the chain and every cached frame. A Back that loses the ticket is worse than a Back that
leaves the board, so the chain replaces rather than pushes; the address bar still tracks the review
(`/projects/[id]/submissions/[stage]/
[submitter]/[unit]?review=1`), and the `?review=1` marker is
what makes a copied link REOPEN the review in the standalone explorer instead of merely landing on
the submission. **(C) Submissions are stage-rooted.** A ticket's tree is rebuilt as **stage →
submitter → unit**, so a node's segment path IS the review URL's tail — the ticket modal and the
Submissions explorer address the same node the same way, with no translation layer to drift. The tab
mounts the SAME tree/cards/file cards and the SAME zoom store (`Ctrl`+wheel, one centre marker, no
toggle button) as `/submissions`; it deliberately does NOT reuse the window virtualization, because
a modal's scroller is the modal body and a window-virtualized list inside a dialog measures the
wrong box — one ticket's deliverables are a bounded handful and render in full. **(D) Additive SSOT,
no DB migration** (still a read projection): `TicketStageRef.unitPriceCents` (the base rate CAPTURED
at agreement, so a stage re-rated tomorrow cannot silently restate an existing ticket),
`BoardCard.owner` (the CLIENT-side accountable seat, distinct from `assignee`, the provider who
claimed it) + `contributors` + `unreadCount` + `payments` (the escrow/fee/release ledger),
`TicketHistoryEntry.unread`/`targetPath`, and
`BoardPage.workspaceKind`/`workspaceLabel`/`clientMembers`. The pure `ticketCostLines()` re-derives
cost from the captured base × the captured multiplier, because the Finances tab's job is to SHOW the
arithmetic and so it must BE the arithmetic. **(E) Intensity is never a number.** Low/Standard/High
is what a client chose; the multiplier appears in exactly one place — as a Finances column beside
the base rate and the product (`$400 × 2 = $800`) — because a badge reading "High ×2" asserts a
conclusion the reader cannot check. The three `W n` chips the composer had beside its intensity
badges are removed; capacity survives as a labelled Finances row and in tooltips. **(F) Two gates,
told apart deliberately** (the `/wallet` §60 rule): a provider-side viewer sees the ticket owner as
read-only TEXT, not a disabled Select — the fact is useful to them, the control would be offered and
then refused; and attachment upload is client-only by product rule, not oversight (a freelancer's
files are OUTPUTS and go through Submissions so they are versioned, reviewed and tied to the escrow
release), so the drop zone is absent and a sentence says where their uploads belong. **Two defects
found by measurement, both in shared code:** (1) `.ui-splitter__pane` shipped
`flex: 0 0
var(--split-size)` while the bases sum to exactly 100% and the gutters are additional
fixed pixels — so every layout Splitter overflowed by `gutters × gutterSize` and clipped its
trailing pane (4px lost, LTR and RTL alike, on the submission review modal too); shrinking is now
allowed. (2) Six labelled tabs needed ~590px in a 343px strip at 375px, making it a hidden
horizontal scroller — labels collapse to glyphs below 640px with `aria-label` always present, so
"label in name" (WCAG 2.5.3) holds in both presentations. **No new Dev Context axis** (§5 gate): the
board now resolves every gate through Decision #64's `board-access.ts`, so the existing persona/role
axes already move the whole surface — verified live, client ↔ freelancer flips the owner control,
the drop zone, both CTAs and the review action with no reload. Verified in-browser: derived totals
agree card ↔ modal at all three multipliers (Low `$200 + $262.50 = $462.50`; Standard
`$400 + $525 + $300 = $1,225`; High `$400×2 +
$525×2 = $1,850`), fee 5% and release check out on the
ledger, the ticket → review → back round trip restores the Submissions tab AT its browsed path with
one backdrop and zero history entries leaked, history-event follow lands on the exact unit, contrast
4.81–5.77:1 light / 7.46–14.37:1 dark, RTL mirrors the rail to the opposite edge with zero overflow
in both directions, 375px reflows full-bleed. **Flagged (surface, do not silently resolve):** (a)
browser Back no longer closes the review — see (B); (b) `onCreateSubmission` ROUTES to the
Submissions explorer rather than opening a third create modal, because that flow owns the pre-submit
checks and a second implementation would be the same flow with different rules; (c) attachment
upload is still staged by NAME only, and review accept/revision are optimistic stubs, pending
`PROJECTS_BACKEND_LIVE`; (d) the `--on-primary` on `--primary` 3.57:1 dark pairing flagged by
Decision #64 is still routed around (numbered step nodes are a primary RING with the numeral on the
surface pair), not fixed at the token layer. | `DESIGN_SYSTEM.md` §B.7.1 / §B.10.9 / §C.1 ·
`packages/ui/overlay/{core/modal-stack.ts,
hooks/useModalStack.ts,mod.ts}` ·
`packages/ui/layout/styles/splitter.css` · `packages/ui/icons/core/paths.tsx` ·
`packages/types/projects/board.ts` · `packages/backend/services/projects/board-fixtures.ts` ·
`apps/web/features/projects/{core/ticket-view.ts,components/ticket/{TicketView,TicketStagePanel}.tsx,
components/ticket/tabs/*,styles/ticket-view.css,islands/{ProjectBoard,SubmissionExplorer}.island.tsx}`
· Decisions #32 / #33 / #35 / #62 / #64 |

| 66 | **Browser audio capture — micro-permissions, pause/resume, and a real outgoing payload
(2026-08-02).** The composer's voice memo already had a working `MediaRecorder` engine; this pass
closes the gaps that made it unshippable and applies to BOTH messaging surfaces at once —
`/projects/[projectId]/[channelId]` and `/messages/[conversationId]` mount the SAME `ChatComposer`
island through `channelFooterFor`/`conversationFooterFor`, so parity is structural, not duplicated.
**(A) Pause/resume is a real capture state, not a UI flag.** `RecorderPhase` gains `paused`
(`inactive → requesting → recording ⇄ paused → recorded`) driving `MediaRecorder.pause()/resume()`,
and the elapsed clock changes from `now - startedAt` to **banked segments** (`bankedRef` + an open
segment), because the old subtraction counted paused wall-time — a memo paused for a minute would
have reported, and auto-stopped at, a duration it did not contain. Sampling halts with the clock so
a pause records no silence bars, and the waveform HOLDS its window instead of clearing. Verified by
measurement: 1.3s paused, timer frozen at `00:02` across the whole pause, resumed take reporting 3s
of a ~4.25s wall-clock session. **(B) `denied` vs `blocked` is the distinction that earns its
keep.** A dismissed prompt is recoverable by pressing the mic again; a **persisted** block makes the
next press silently inert, so only that case spends words on recovery — and they are
browser-specific (`micHelpFor`, six families, pure and UA-string-driven so it stays testable). The
state is resolved through the Permissions API with the load-bearing rule that **absence of an answer
is never denial** (Firefox rejects a `"microphone"` descriptor outright), so `unknown` always falls
through to a real attempt. A positively-denied state short-circuits before `getUserMedia`. Errors
became a structured `RecorderError {kind,title,detail,help}` rendered **inline** through the
existing `Message` primitive rather than a corner `Toast`: the control that failed is right there,
and instructions are read while looking at the button that refused. **(C) Guards the spec asked
for.** `MAX_AUDIO_BYTES` (10 MB) checked at finalize — the memo stays playable but Send is refused;
the device-loss path (`track` `ended` + a `readyState` poll on the clock interval already running,
since some UAs drop a removed device without firing the event) **keeps what was captured** rather
than discarding the take; and every exit path — stop, discard, error, unmount, `pagehide` — runs
`track.stop()`, so the OS recording indicator clears immediately (verified: one stop per take).
**(D) Send now assembles a real payload.** `ComposerPayload` carries an actual `File` named for the
container the UA **actually produced** (`audioExtOf` — a `.webm` name on Safari's MP4 breaks players
that sniff by extension) plus the `MessageAudio`-shaped projection, with `peaks` resampled ONCE at
the boundary to the SSOT's `.max(512)` — a five-minute take captures ~3300 samples and would have
failed Zod validation the moment the backend went live. `onSend` widened from `() => void` to take
it (both existing callers ignore the argument, so they are unchanged). Transport stays stubbed
behind `PROJECTS_BACKEND_LIVE`; the payload does not. **(E) Background tabs record seamlessly** — a
memo that silently drops audio while the viewer checks a reference is data loss — with a
`visibilitychange` handler resuming a UA-suspended `AudioContext` on return, which only ever
affected the visualiser, never the encoder. **(F) Dev Context Switcher (§5 gate):** a new
`micPermission` axis (`auto`·`prompt`·`granted`·`denied`·`unsupported`) wired end-to-end through
`dev-seam` (`DevMicPermission` + `DevSeamState` + `MIC_PERMISSIONS`) and `dev-context`
(`DevOverrides` + `DEV_DEFAULTS` + `DEV_MIC_PERMISSIONS` + `reflect()` set AND delete) + a panel
control, reaching the blocked / unsupported / slow-grant branches without changing real browser
settings and reloading. Simulating `granted` deliberately **overrides** the persisted-block
short-circuit — otherwise the axis is inert in exactly the browser a developer needs it in — but
still asks the real device; nothing here fabricates audio. **Three defects found by measurement, not
inspection:** (1) an oversize memo fell through to an **enabled Mic button that does nothing** (the
press guard rejects a `recorded` phase), so a finished memo now always shows Send, disabled with the
reason printed directly beneath, and the disabled Send steps down to a tonal control rather than a
0.4-alpha wash of `--primary`; (2) `setPointerCapture` throws `NotFoundError` when the pointer is
already gone, and the throw preceded `rec.start()` — costing the viewer the recording they just
asked for; (3) simulating `granted` hit the block short-circuit described above. **A11y:** the
ticking clock is deliberately NOT a live region (a counter announcing five times a second buries
everything else) — it stays readable on demand while a `role="status"` line announces only the phase
transitions. No new `@projective/ui` primitive (reuses `Message`/`Popover`/`Tooltip`) → no
`DESIGN_SYSTEM.md` §C.1 change; no persisted-shape change (the composer draft is transient client
state; `MessageAudioSchema` already existed and is now actually satisfied) → **no DB migration**, no
`documentation/database/*` and no `PRODUCT_MANAGEMENT.md` change. **Flagged (surface, do not
silently resolve):** (a) upload/transport is still stubbed — the payload is real and complete, only
its dispatch waits on the backend; (b) the attachment-cap overflow remains silent (`addFiles` drops
the excess with no feedback) — out of scope here but now conspicuous beside a composer that explains
every capture failure; (c) recording in a background tab relies on the UA exempting audio-capturing
pages from timer throttling — where it does not, the envelope goes sparse (cosmetic only, since it
is resampled) while the encoder is unaffected. | `PRODUCT_SPEC.md` §Unified Messaging ·
`apps/web/features/projects/{hooks/{useAudioRecorder,useWaveform}.ts,core/composer-model.ts,
types/composer-types.ts,components/composer-glyphs.tsx,islands/ChatComposer.island.tsx,
styles/chat-composer.css}`
· `apps/web/utils/dev-seam.ts` · `apps/web/features/devtools/` ·
`packages/types/projects/messages.ts` (satisfied, unchanged) · Decisions #31 / #34 / #49 / #50 / #62
/ #63 |

| 66 | **Ticket modal unified — one surface for create, view and edit (2026-08-02). SUPERSEDES the
two-modal split of Decisions #64/#65.** `TicketComposer` is DELETED (with `TicketBasics` and the
now-orphaned `TicketStagePanel`), and `TicketView` became the single context-aware surface:
`mode="create"` composes, `mode="view"` reads, and editing happens IN PLACE in both. The split cost
more than it saved — the composer and the detail modal each owned a description field, a task list,
an attachment flow and a stage pipeline, four pairs that had to be kept in agreement by hand, and it
made "edit this ticket" a mode switch that threw away the reader's position. **One working SHAPE**:
a ticket being composed is a `BoardCard` nobody has saved yet, so `TicketDraft`/`DraftStage` and
their reducers are gone; `ticket-model.ts` now operates on the card itself
(`newTicketCard`/`stageOps`/`taskOps`/`ticketTotals`/`ticketGate`), and **`reconcileCard()` is the
ONE place a derived field is computed** — price, capacity, checklist counts and due label — called
by the modal and the board alike so no second arithmetic path can round differently. **Edits are
STAGED**: the working copy lives in the modal-stack frame cache (so a review round trip preserves
half-made edits), the footer grows Save/Discard the moment `ticketFingerprint()` diverges from the
baseline, and nothing reaches the board until Save. **(A) Meta bar** — Intensity · Priority · Due
follow the `InlineEdit` contract (static value + quiet caret → the real `@projective/ui` control in
place, opened on the SAME click via a synthetic trigger click, which also dodges the `useDismiss`
race a programmatic open would lose); Owner keeps its dropdown and gains faces; **"Claimed by" is
pinned to the far end** (`data-end`) because it is the one value on the row the client does not set.
**(B) Footer** — the standalone Close is gone (the header × remains); **Ticket cost and Spent lead
as two prominent currency figures**, then the count badges behind one hairline, then the actions.
New pure `ticketSpentCents(payments)` in the Zod SSOT counts only **settled** `release` + `fee`,
never a held escrow — a client must never be told they paid for work nobody has accepted (verified:
a completed ticket reads Spent $925 against a ledger of $878.75 release + $46.25 fee). **(C) Task
lists** are client-owned and **never tickable here** — completion is a delivery claim and is made at
the SUBMISSION level, so the row shows the outcome plus the faces of everyone who satisfied it (new
additive `TicketTask.completedBy`). **(D) Side panel appears on exactly two tabs**: Details carries
a recent-activity feed, Stages opens only when a stage is selected — and the stage inspector renders
in the MODAL's own panel rather than a nested one, so there is one place a stage is configured.
**(E)** All ticket + stage descriptions use the shared `RichTextEditor` (keyed per ticket/stage —
Quill owns its DOM after mount, so a shared editor would write the previous subject's brief back on
the next keystroke). **(F)** Attachments mirrors `/files`, mounting the same `FileCard`/`FileTable`
and the same zoom store, with the rig + Add-attachment in the Submissions tab's bar position;
`FileTable` gained an additive `virtualize` flag because it windows against the WINDOW and a
dialog's scroller is its own body. **(G)** Create mode omits Submissions and History — empty
archives on a ticket that does not exist yet invite the reader to wonder what they missed. **One
`@projective/ui` change** (§C.1 updated in the same change): `Select` gained
`optionTemplate`/`valueTemplate` for rows that carry an identity rather than a word,
presentation-only (the row keeps its selected-check, `role="option"` and `aria-selected`;
`Option.label` stays what typeahead matches). **Bug found by measurement and fixed:** the
ticket-level intensity — the surface's headline price lever — moved a word and no money, because
`reconcileCard` prices from each STAGE's intensity (measured: Standard → High left the total at
$1,225). New `applyTicketIntensity()` cascades it to stages that were
tracking the default and leaves a deliberately-overridden stage alone, which is what "default"
means; `blankStageRef` now seeds from the ticket's difficulty too. Also fixed in the fixtures: an
UNCLAIMED ticket could carry completed steps, which the completer rule makes impossible — there is
nobody to attribute them to. **No DB migration** (still a read+write projection over fixtures, like
#64/#65) → no `documentation/database/*` change; no lifecycle change → no `PRODUCT_MANAGEMENT.md`
change. **No new Dev Context axis** (§5 gate): every gate routes through Decision #64's
`board-access.ts`, verified live — a persona flip moves the meta-bar affordances, the editor, the
task grips, the drop zone and both CTAs with no reload. Verified in-browser: create → named → Create
→ transitions in place to view mode with all six tabs and the card on the board; edit → Save
round-trips to the card ($1,225 → $2,450 at High); stage select opens the inspector in the modal's
panel with its RTE and reorderable steps; attachments grid ⇄ list at the `/files` columns
(non-virtualized, 3 rows in a 114px sizer); contrast 5.85–17.14:1 light / 7.46–14.37:1 dark;
`dir="rtl"` mirrors the meta row and the footer to the opposite edge with **zero horizontal overflow
in both directions**; 375px hides the panel, collapses the tab labels to glyphs and fits the strip
with no hidden scroller; no console errors. **Flagged (surface, do not silently resolve):** (a)
`ticket-composer.css` was renamed `ticket-pipeline.css` and keeps the `.tkc-` prefix — it now names
ticket COMPOSITION (pipeline · inspector · task list), not a composer modal; (b) attachment upload
is still staged by NAME only and every ticket write stays optimistic and per-session, pending
`PROJECTS_BACKEND_LIVE`; (c) the `--on-primary` on `--primary` 3.57:1 dark pairing flagged by #64 is
still routed around, not fixed at the token layer. | `PRODUCT_SPEC.md` §The Weighting Engine /
§Creation & Purchasing Gate · `DESIGN_SYSTEM.md` §C.1 · `packages/types/projects/board.ts`
(`TicketTask.completedBy`, `ticketSpentCents`) ·
`packages/ui/fields/{islands/Select.tsx,
styles/select.css}` ·
`packages/backend/services/projects/board-fixtures.ts` ·
`apps/web/features/projects/{components/ticket/**,components/FileTable.tsx,
core/{ticket-model,ticket-view}.ts,islands/ProjectBoard.island.tsx,
styles/{ticket-view,ticket-pipeline}.css}`
· Decisions #32 / #33 / #35 / #62 / #64 / #65 |

| 67 | **Asset management — the `/files` hub, the universal Asset Picker, privacy scopes, quotas and
the connector substrate (2026-08-05).** The 17th thin/fat vertical and the platform's first
**cross-cutting** one: every file, image, recording and web link on the platform becomes one
**asset** owned by one principal and reachable through one hub, so the same asset can be a
submission deliverable, a profile banner and a channel attachment without being copied. **(A) THE
WIDENING (the load-bearing change).** `projects/files.ts` `FileItemSchema` mandated message
provenance — `channelId`/`channelName`/`channelKind`/`messageId`/`messageText`/`sender` — which is
correct for a channel attachment and wrong for a hub upload, a drive mount and a link, none of which
has a channel or a message. Rather than fork a second file shape (doubling every card, table,
preview and modal), the files domain now owns `AssetItemSchema` — the SUPERSET with provenance
**flat and nullable** — and `FileItemSchema` is re-expressed as `AssetItemSchema.extend({…})`
re-mandating those fields. `FileItem` stays assignable to `AssetItem`, so all twelve existing
consumers compiled unchanged while `FileCard`/`FileTable`/`FilePreview`/`AttachmentPreviewModal`
needed their prop types widened exactly once. Flat-and-nullable over nested-optional deliberately:
nesting forces an edit at every `file.sender` read, where flat is a pure widening the type-checker
walks for you. `FileKind` moved down to a new leaf `files/kinds.ts` — `files/categories.ts` had been
reaching UP into `projects/files.ts` for the vocabulary the files domain owns while
`projects/files.ts` reached back for `FileCategory`, a mutual edge surviving only because one side
was `import type`; the graph is now a one-way DAG (kinds ← categories ← assets ← projects), which
matters because a cycle in a module whose corpus builds at import time is the TDZ crash class of
Decision #49, not a style problem. `FileKind` gained `link`, which correctly broke four exhaustive
`Record<FileKind,…>` maps. **(B) The `/files` hub** follows the §63 region contract exactly: LANE =
the three-section tree (My library · read-only **Mounted** engagements · **Connected drives**) with
a collapsed rail and the quota meter; HEADER BAND = identity + search + kind/source filter + sort,
at exactly `--shell-midnav-header-h`; FOOTER = Upload · New folder · Attach link · Connect drive ·
zoom · Export, `container-type:
inline-size` with three container tiers where **the menu holds every
action at every tier** (the `/wallet` defect where a `nth-child(n+3){display:none}` deleted three
actions on four pages that had no menu to recover them); BODY = viewing and selecting only. Below
767px the lane is `display:none` and the section-switching duty **transfers** to a header-band
"Browse" control — `/projects` still has no mobile answer and that failure was deliberately not
inherited. File cards are `FileCard` VERBATIM and folder cards are the `/submissions`
`SubmissionCard` VERBATIM (shaped through `shapeFolderAsNode`), which works only because
`.fx-card__meta` and `.subm-card__meta` are both exactly 62px and one `rowHeight = w + 62 + 16` fits
both in one grid. **(C) The Asset Picker** is one hand-rolled `BodyPortal` modal (NOT `Dialog`,
whose `overflow:hidden` + `--overlay-w-lg` + body padding fight a two-pane workspace) over a single
`<Splitter layout="horizontal">` — the modifier is mandatory, because
`navigation/styles/splitter.css` ships a BARE `.ui-splitter` rule (0,1,0) forcing
`inline-size: var(--shell-lane-w)` globally, and without it the picker collapses to 280px. Verified
open at 1088×768 with panes 238/846 going to 238/583/259 the moment a file is selected (the Inspect
panel is absent, not disabled, until then), `Attach Selected (N)` carrying a live count, and the
`accept` filter naming itself in the empty state ("No images here", not "No files"). Window
virtualization is correct in the hub body and WRONG in every overlay, so the picker uses a plain
auto-fill grid and `FileTable virtualize={false}`. **(D) Privacy scopes** — `private` (default) ·
`link` (auto-elevated inside a channel/DM/submission, because a recipient who can read the message
must be able to open what it carries) · `public` (auto-elevated on a
service/product/profile/banner); elevation is one-directional and automatic, de-escalation always
explicit, so attaching can never silently narrow access something else depends on. A channel
attachment is therefore `link`-visible BY CONSTRUCTION, which the fixtures now encode.
`/share/[slug]` is anonymous-reachable with `X-Robots-Tag: noindex, nofollow` +
`Referrer-Policy: no-referrer`, and every dead state — unknown, expired, revoked, exhausted —
renders an IDENTICAL 404: measured, revoked-vs-unknown differ by **exactly one byte, the last
character of the slug the caller supplied**, everything else being a per-request CSP nonce. **(E)
Quotas are an ENTITLEMENT, not a parallel system** — a new `storage_megabytes` key resolved by the
existing `fn_effective_limit`/`fn_footprint_usage`, which needed one `ELSIF`. Denominated in
**MEBIBYTES** because `plan_entitlements.limit_value` and all three resolver return types are
`integer`: 25 GB in bytes is 26,843,545,600 and overflows int4, and 1 TB is off by ~512×. Ladder:
free tiers 25600 · individual_pro 153600 · team/business_pro 512000 · organisation unlimited
(`NULL`, never a huge number that would eventually be rendered as a promise). Enforcement ships
**fail-open** behind `storage_quota_enforced`, matching both existing footprint gates. **(F) Dedup**
is a client fingerprint BEFORE the bytes move: full SHA-256 under 256 MiB, sampled (head ‖ tail ‖
size) above it — `crypto.subtle` has no streaming API, so a 2 GB file genuinely cannot be digested
whole — with `sampled: boolean` carried in the schema so the server knows the STRENGTH of the claim
and never collapses two objects on a hint. Outside a secure context it degrades to name+size and
never fails the upload. **Four pre-existing security holes closed:** `files.items` SELECT was
`USING (true)` (every signed-in user could read every row's filename, MIME, size, bucket and storage
path, including verification documents), its UPDATE policy had `USING` with no `WITH CHECK` (a user
could reassign `owner_user_id` or repoint `storage_path` at another tenant's object in the same
statement), and `files.folders` had **RLS off entirely** while inheriting a blanket `authenticated`
CRUD grant. **A fifth was introduced and caught in review:** the share-link policy's
`WITH CHECK (created_by = auth.uid())` proved identity but never OWNERSHIP, so any signed-in user
could mint a permanent share over any asset id they had ever seen — a member removed from a team
keeps those ids. **Six Dev Context axes** (§5 gate) — `storageProvider` · `connectionState` ·
`storageQuota` · `assetVisibility` · `linkScan` · `dedupState` — wired through all three files
including both `reflect()` branches, travelling to the server as validated `sim*` query params.
**Defects found by measurement, not inspection:** (1) `pg_catalog.substring(v_raw FROM 1 FOR 24)` —
the SQL-standard `FROM/FOR` form is a bare-keyword grammar production and is a syntax error when
schema-qualified; plpgsql defers parsing, so it would have created cleanly and failed the first time
anyone minted a share slug; (2) a literal **NUL byte** in `fingerprint.ts` made an 11 KB file binary
to git and invisible to grep, and it was the delimiter of a dedup lookup key — any transcoding
round-trip would have turned "have you got one of these?" into a permanent silent miss; (3)
`UserConnectionSchema.config` was required with no such column and no view projection, so every
parse of a real row would have failed; (4) the `workspace` bucket was seeded with full RLS but
absent from `StorageBucket`, leaving entity assets with no addressable bucket and no builder for the
`{entity_id}` anchor its own policies key on; (5) `dedupState` was plumbed through six layers and
**dropped at the route** — a panel control that changed nothing; (6) reads did not normalise the
fixture owner while writes did, so SSR painted an empty hub with a 0-byte quota and a client refetch
painted the full library over it — two answers for one screen. **Flagged (surface, do not silently
resolve):** (a) the migrations are authored-not-applied AND **were not executed** — Docker's Linux
engine was down, so unlike Decisions #57/#58 there is no throwaway-Postgres proof, only a structural
audit (enum parity diffed member-by-member, category placement, dependency order, RLS coverage,
`SECURITY DEFINER`/ `search_path`); (b) connections stay **per-user** —
`integrations.user_connections` has no owner axis, so a team's shared Drive is inexpressible
(inherits Decision #59); (c) entity-owned assets cannot yet be shared by a non-owner member — the
policy fails CLOSED pending (b); (d) `AssetListParams` has no `recursive` flag, so the picker's
"Recent" is the library ROOT newest-first, not a cross-folder recency feed; (e) `accept` filters by
category CLIENT-side, so `total`/`hasMore` describe the server's kind-narrowed set rather than the
drawn one; (f) provider adapters, the OAuth consent handshake, the KMS token vault, favicon
re-hosting and link scanning are all **stub-first behind the gate** — the payloads and interfaces
are real, only the outbound calls wait on credentials; (g) `ENCRYPTION_KEY` in the env contract
still contradicts the `connection_secrets.key_id` envelope design (inherits #59), and
`token-vault.ts` deliberately REFUSES to seal while gated rather than return a reversible encoding
that would survive the gate flip as plaintext; (h) `/api/wallet/*` reads the session on every route
while `/api/files`, `/api/catalogue` and `/api/projects` do not — the read convention is not uniform
and wants one human decision, not a third pattern. | `PRODUCT_SPEC.md` §Assets & Attachments +
§Sitemap · `packages/types/files/*` · `packages/types/projects/files.ts` ·
`packages/types/integrations/*` · `packages/backend/services/{files,integrations}/*` ·
`packages/backend/core/{env,supabase}.ts` · `apps/web/features/files/**` ·
`apps/web/routes/(dashboard)/files/**` · `apps/web/routes/(public)/share/[slug].tsx` ·
`apps/web/routes/api/{files,integrations}/*` ·
`supabase/migrations/{00000004,00000010,00000020,00000030,00001160,00001220,00001880,00002001,00002011,00002017,00003004,00004011,00005001,00005030,00005040,00005050}*`
· `documentation/database/{files,integrations,finance}/*` · `.env.example` · Decisions #32 / #33 /
#53 / #58 / #59 / #60 / #63 |

| 68 | **Universal Basket, Checkout, the card visualizer and the money-flow debugger (2026-08-06).**
The 18th thin/fat vertical and the platform's second write surface: one basket per acting context, a
`/checkout` that pays for all **ten** `PurchasableItemKind`s, a portable card visualizer, and a
dev-only money-flow debugger. **(A) Schema, folded in place** (root §1 — the brief asked for new
timestamped migrations; the governing rule forbids them): `finance.baskets` · `finance.basket_items`
· `finance.saved_cards` into `00000017`, two enums (`purchasable_item_kind` 10 values,
`card_brand` 9) into `00000004`, the `simulate_wallet_transaction` RPC + two predicates into
`00001210`, RLS/policies/grants/indexes into their category files. **`owner_type` was widened** from
the brief's `'user' | 'business'` to the existing 5-value finance CHECK — task §4.2 requires a Team
basket, which the narrow pair cannot express. **Validated by execution, not inspection:** every
statement applied to a live Postgres inside `BEGIN … ROLLBACK` plus a 32-case suite (enum order, the
`split_payout` round trip, **all 13 simulator refusal paths**, every CHECK, RLS coverage, `EXECUTE`
= `authenticated` only). **Authored, NOT applied to any live DB.** **(B) The simulator is dangerous
and is gated like it.** It mutates real balances, so it fail-closes on a new
`finance_simulation_enabled` param seeded **false**, refuses a NULL `auth.uid()`, and — **wider than
the brief** — checks the DESTINATION wallet too, since `top_up`/`escrow_release`/`refund` would
otherwise let any signed-in caller mint balance into a stranger's wallet. **(C) The card's custody
conflict, resolved honestly.** Decision #60's `wlt-card` refuses expiry/name/CVV/flip on the thesis
that "an affordance implying we hold data we do not is worse than an empty space" — but Stripe DOES
return brand/last4/exp/name, and the brief's own `saved_cards` stores exactly those. So the NEW
`@projective/ui/display` `PaymentCard` renders the real expiry, cardholder name and last4 with the
PAN as `aria-hidden` mask groups (4-6-5 on Amex) and the CVV as `•••` **ornament — never an input,
never a value, never a reveal**; absent fields render as ABSENCE, never `--/--`. `SavedCardSchema`
carries no `pan`/`cvv` key, not even optional. The wallet's card is untouched. `PaymentCardOption`
is a **sibling, not an `interactive` prop**, because a flip `<button>` nested in a `role="radio"`
button is invalid HTML that breaks both controls — a sibling wrapping a `decorative` face makes the
combination unreachable rather than merely discouraged. **(D) Portability held at both boundaries.**
`packages/ui` still imports only preact/signals/material: the card takes a structural
`PaymentCardData` (proven assignable from `SavedCard` by typecheck, so the app passes real Zod types
with no adapter), and `MoneyFlowPopover` is **fully controlled — zero fetch, zero arithmetic** —
over `DraggablePopover`. Its balance meter sets geometry directly and confines motion to
`transform`/`opacity`, so a backgrounded tab with a frozen animation clock still shows correct
widths. **(E) One arithmetic path.** `basketSubtotal` → `applyDiscounts` → `platformFeeFor` →
`checkoutTotals` live in the SSOT and are the ONLY implementation; the fat services wrap their
integer minor units into `MoneyView`s and the client renders `display` strings — **zero**
`toFixed`/`Intl.NumberFormat`/`reduce`-over-prices in any island. `explore/pricing.ts` was extracted
so a basket line's unit price cannot disagree with the card that added it (Decision #45 parity).
`create()` is idempotent on `idempotencyKey` and **re-verifies `expectedTotalMinor`** — a
client-supplied total accepted blindly is a price-tampering hole. **(F) Region contract** (#60/#63)
honoured: lane = scope, header band = identity/search, footer rig = every action with
`container-type` tiers **whose menu holds every action at every tier**, body = views and selects
only. **Nine defects found by measurement, not inspection**, four of them the same class — _a
control that exists but cannot be reached_: the collapsed lane never narrowed (280px held, 216px of
body lost) and dropped its own scope duty; header search was `display:none`d at the narrowest tier,
so **every phone** lost find-in-basket (the `/wallet` `nth-child(n+3)` failure in a header's
clothes); the same field was inert on `/checkout` at every width; BuyNow's `<li>` broke the
radiogroup ownership chain; its card picker set `tabIndex={-1}` on **every** option when none was
chosen, making the group un-enterable; `role="alert"` + `aria-live="polite"` demoted a REFUSED
payment to the politeness of a successful one; and post-payment focus fell to `<body>` because the
confirm dialog restored focus to a trigger that no longer existed, on an exit animation. Also fixed
in the SSOT: `CheckoutBlockerCode` had no **`price_changed`** member, so the tamper refusal returned
`blockers: []` and any surface explaining refusals by rendering blockers showed nothing on the
refusal a buyer is most likely to hit. **(G) Dev parity (§5 gate):** four axes — `basketOwner` ·
`paymentProviders` · `walletCoverage` · `savedCards` — through `dev-seam` +
`DevOverrides`/`DEV_DEFAULTS`/`DevOption`/`reflect()` **set AND delete** + a panel group, travelling
to the server as validated `sim*` query params and genuinely consumed (no plumbed-and-dropped
param). Verified in-browser at 1440 and 390, LTR + RTL, **zero horizontal overflow in both
directions at both widths**; full gate chain 3 blockers → 0 → Pay → `succeeded £1,366.15`; the
drawer's CSS ships from a non-checkout page, closing the island-carrier trap. **Flagged — needs a
human, do NOT silently resolve:** (a) **🚨 `authenticated` has no `USAGE` on the `finance` schema**
— `00002500` revokes it and never re-grants; `finance` is the only schema in the revoke list without
a matching grant, verified live (`42501`), so every finance policy old and new is latent. Granting
it would expose the whole ledger to direct PostgREST reads wherever a permissive policy exists;
deliberately NOT granted. (b) **`platform_fee_bp` is seeded `0`** while the SSOT says `500` and
Decision #2 resolved 5% — the live DB charges nothing; a fee change across every reset is a money
decision. (c) **Who bears the fee** — modelled as `PlatformFeeMode`, defaulted to the documented
`seller_deducted`, so the buyer's total excludes it; checkout must render one of the two. (d) The
simulator needs sign-off before its param is ever flipped. (e) **Three overlapping instrument
tables** now (`payment_methods` + `payout_accounts` + `saved_cards`), mitigated by a nullable FK,
not resolved (extends #54(f)). (f) `revision_id` has no FK — the target table is unsettled. (g)
`CheckoutResult.orderId` is always `null`; no orders table exists. (h) **Item deep-links follow the
canonical `/[handle]` + `/view/[id]` + `/projects/[projectId]/[channelId]`**, NOT the brief's
`/[handle]/products/[id]` or `/projects/[id]/[stageId]`, which would 404. (i) "CDN card art" and
"zero-JS pointer-reactive sheen" are not implementable (no external origin under the CSP; pointer
tracking needs JS) — art is derived into token expressions and the sheen is CSS-only with pointer
parallax an opt-in prop. (j) `bin_number` is usually NULL (Stripe entitlement-gated); every consumer
degrades to `brand`. (k) Free-text is Zod-bounded but DB-unbounded — a **truncation contract** the
resolving service must honour or the basket read 500s. (l) Mixed sim query vocabulary (four plain
knobs vs four `sim*`-prefixed) wants one rename pass. (m) Bulk basket actions are N sequential
writes. | root CLAUDE.md §1/§2/§3/§5 · `packages/types/finance/{basket,checkout,card-art}.ts` ·
`packages/backend/services/finance/{Basket,Checkout,Cards}BackendService.ts` +
`{basket,cards}-fixtures.ts` + `basket-query.ts` · `packages/backend/services/explore/pricing.ts` ·
`packages/ui/display/components/PaymentCard.tsx` ·
`packages/ui/overlay/islands/MoneyFlowPopover.island.tsx` · `apps/web/features/checkout/**` ·
`apps/web/routes/(dashboard)/{basket,checkout}/**` · `apps/web/routes/api/{basket,cards,checkout}/*`
· `apps/web/routes/(dashboard)/_layout.tsx` ·
`apps/web/features/shell/islands/UserActions.island.tsx` ·
`apps/web/utils/{dev-seam,storage-keys}.ts` · `apps/web/features/devtools/*` ·
`packages/types/profile/reserved.ts` ·
`supabase/migrations/{00000004,00000017,00001210,00002001,00002013,00002510,00002520,00004005,00005001}*`
· `documentation/database/finance/*` · `DESIGN_SYSTEM.md` §C.1 · Decisions #2 / #10 / #45 / #53 /
#54 / #55 / #60 / #62 / #63 / #67 |

| 69 | **Global multi-currency — the FX engine, `MoneyView`, and the header switcher (2026-08-10).**
Money presentation becomes global: one FX engine, one component, and a currency switch that
re-renders every visible figure with no page load. **The rule the whole pass protects:** a
conversion is a **read-time projection over an immutable origin**. Every stored amount keeps its
origin `(amount_minor, currency)`; settlement always reproduces the `(fx_rate, fx_base, fx_as_of)`
snapshot committed on its own row; nothing on any read path rewrites a ledger amount. **(A) Schema,
folded in place** (root §1 — no new timestamped migrations): `preferred_display_currency` gains
`DEFAULT 'GBP'`

- a `^[A-Z]{3}$` CHECK; `finance.transactions`/`escrows`.`fx_base` gains `DEFAULT 'GBP'` so a
  stamped rate is never orphaned from its base; `custom_access_token_hook` stamps
  `displayCurrency` + `locale` into `app_metadata.active_context` — on the SAME claim, because a
  figure that paints in one currency and corrects itself after hydration is worse than a stale
  symbol. `finance.fx_rates` gains a **seeded floor** for all 12 offerable currencies with **both
  directions of every pair written explicitly** (a reader that divides by the forward rate and one
  that multiplies by the inverse disagree in the last minor unit) at a FIXED `as_of` so a reset is
  reproducible. Authored, **not applied to any live DB**. **(B) Zod SSOT** — new leaf
  `@projective/types/finance/fx.ts` (`FxRateTable`/`FxQuote`/ `ConvertedAmount`, the curated
  `DISPLAY_CURRENCIES`, pure `resolveRate`/`convertMinorUnits`); `UserPreferencesUpdate` +
  `DisplayPreferences` on `org/preferences`; `displayCurrency`/`locale` on `UserContext` +
  `ActiveContextClaim`; `preferences` on `CurrentUser`; `toMoneyView()` bridging the engine to the
  existing money shape. `org/preferences` **re-exports** the currency defaults from the FX SSOT
  rather than restating them. **(C) `FxService`** is the only thing on the platform that converts: a
  per-base table cached 15 min in **Deno KV** → a per-isolate memory cache → the seeded fixtures,
  with `convertAmount()` returning the value **and** its `asOf` snapshot instant. It never throws
  and never returns "no answer": an unresolvable pair returns the **origin unchanged** with
  `converted: false`, because assuming a rate of 1 or relabelling an amount with a symbol it was not
  priced in turns a missing number into a WRONG one — the only FX failure a reader cannot detect.
  **(D) `MoneyView`** in `@projective/ui/display`, plus a portable signal store, on a narrow
  `./display/money` sub-path (the barrel re-exports Table/Tree/Galleria/GMap, and the
  globally-mounted bridge would have dragged all of them into every route's bundle to render a
  price). ONE component, three ways of learning the currency — props → request context → the host's
  ambient resolver → the signal store — so it is correct as a zero-JS server component AND reactive
  inside a hydrated island, with no second renderer to drift. **(E) Live switching** without a
  reload: the store re-renders hydrated figures, and a DOM sweep re-projects every server-rendered
  `[data-money]` node from its own IMMUTABLE origin attributes (never from the previous conversion,
  which would compound a rounding error on each switch). Islands flag themselves `data-money-live`
  from an effect — which only runs on hydration, so "is this reactive" is answered by the one signal
  that knows. **Adopted on the Explore service + product cards** (additive `priceMinor`/`currency`
  on the explore SSOT, parsed ONCE server-side at fixture construction — parsing a localised
  currency string in the browser is how "$1,800" becomes 1.8). **Four findings, all by
  measurement:** (1) **a Preact context provider at the document root is NOT visible to a server
  component deeper in the page** — an island boundary sits between them and island subtrees render
  in a pass that drops the outer context (an app-side probe beside a price returned `null`; the same
  probe under the provider returned the real value). A module signal would reach everywhere but is
  shared across concurrent requests, i.e. a data race over money that passes every manual test.
  Resolved with `AsyncLocalStorage`, which is request-scoped and survives every await and render
  pass. (2) The DOM sweep seeded `display: ""`, and `projectMoney`'s "target is already this
  currency" branch returns `display` **verbatim** by design — so switching TO the origin currency
  **blanked every figure**. (3) The currency PATCH went through `apiFetch`, whose unrecoverable-401
  path **navigates to `/login`** — throwing someone off the page they were reading because a
  formatting preference could not be saved; now a plain `fetch`, where a 401 leaves the local choice
  in place and the surface says it saved on this device only. (4) Vite caches the package `exports`
  map at startup, so a new sub-path needs a dev-server restart — as does any `packages/*` edit,
  since HMR does not pick them up (two false negatives during this pass). **Verified in-browser:**
  SSR paints the viewer's currency in the first byte from the cookie/JWT (GBP · EUR · JPY all
  correct, JPY exponent-aware with no phantom decimals); the header picker changed **all 19**
  figures on `/explore` at once with the URL unchanged; GBP→EUR→JPY→USD→AED→GBP round-trips to the
  exact starting figure; the choice survives a reload; a guest PATCH 401s cleanly with no redirect;
  `deno task test` (check · lint · 33 unit tests) green. **Flagged (surface, do not silently
  resolve):** (a) `preferred_display_currency` now has a DEFAULT while `NULL` still means "follow
  the origin" — distinguishable, but subtle enough to deserve a human's confirmation. (b) **Adoption
  is one surface, not a migration**: ~180 other money sites (wallet, checkout, workspaces, tickets)
  still render through their surface-local components and do not respond to a currency switch; each
  now has a `MoneyView`-shaped target. (c) The brief's `£78.50 (~€90.00 EUR)` puts the `~` on the
  ORIGIN, which is the exact figure, while the converted primary is the estimate — implemented
  literally as specified, with the honest full statement in the accessible label and `title`. (d)
  **`deno fmt --check` is deliberately NOT in `deno task test`**: `core.autocrlf=true` makes it fail
  on any Windows checkout regardless of what is committed, and ~280 files predate the formatter. (e)
  FX spread / conversion-fee economics remain OPEN (finance-model §11) — the surface renders origin,
  converted and rate, and never a fee. (f) `finance.fx_rates` is read with the service-role client
  because SSR converts for signed-out visitors too; the rows are public reference data
  (`USING (true)`), but the read bypasses RLS and wants revisiting if that table ever carries
  anything else. | `SYSTEM_ARCHITECTURE.md` §Internationalization · `DESIGN_SYSTEM.md` §C.1 ·
  `packages/types/finance/fx.ts` ·
  `packages/types/{org/preferences,auth/user-context,user/current-user}.ts` ·
  `packages/backend/services/finance/{FxService,fx-fixtures}.ts` ·
  `packages/backend/services/user/UserBackendService.ts` ·
  `packages/ui/display/{money.ts,core/currency-store.ts,components/MoneyView.tsx,styles/money-view.css}`
  · `apps/web/utils/{currency-context,state,storage-keys}.ts` ·
  `apps/web/routes/{_app,_middleware}.tsx` · `apps/web/routes/api/{user/preferences,finance/fx}.ts`
  ·
  `apps/web/features/shell/{core/{CurrencyService,currency-state},islands/{CurrencyBridge,UserActions}}`
  · `apps/web/features/explore/{core/pricing,components/cards/{Service,Product}Card}` ·
  `supabase/migrations/{00000011,00000017,00001700,00005050}*` ·
  `documentation/database/{org,finance,security}/*` · Decisions #2 / #10 / #16 / #17 / #54 / #55 /
  #60 / #68 |
