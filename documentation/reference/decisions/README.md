> Index of the Resolved Decisions log (former root CLAUDE.md §8): one line per decision, pointing at the file holding its full row.

## 8. Resolved Decisions & New-Conflict Rule

The four founding conflicts were **resolved on 2026-07-12** (below). For any **new** contradiction
you find between source docs: do not pick a side quietly — flag it in the PR, add a row here, and
ask a human. This table is the durable decision log.


## Second-order conflicts

_Second-order conflicts noted but out of this pass (surface if you touch them): the `SPRING_EXPRESSIVE_EXIT` bounce is a live exception to §B.5's zeta >= 1 rule, sanctioned by the product owner and scoped to one decorative exit (Decision #75(a)). Pinch-to-zoom ships implemented-but-off because enabling it reverses a logged WCAG 1.4.4 position (#75(c)). The `/explore` fold re-derives its height from `100dvh` minus a
shell-set chrome token and carries a `min-block-size` floor, both of which Part D's fit-to-screen rule forbids — the fill
technique it prescribes cannot express a FIRST screenful followed by a scrolling body (#76(a)). Four of the theme engine's
seven `--on-<role>` pairs measure ~3.17:1 in LIGHT mode, so small text on a solid `--success` / `--warning` / `--danger` /
`--info` fill needs the mix `.ex-status` now applies, or a different role (#76). `finance-model.md`
§4 session late-cancel says a 50% penalty while `PRODUCT_SPEC.md`'s Session table says full forfeit
— `PRODUCT_SPEC.md` wins per the hierarchy. `storage-keys.ts` `THEME_PREFERENCE` names a key nothing reads, while
`packages/ui/system/core/context.ts` persists the theme under plain `"theme"` — Decision #74(d)._


## Decisions

- **#1** Chart engine — tiered. → `decisions/decisions-001-030.md`
- **#2** Platform fee — 5% → `decisions/decisions-001-030.md`
- **#3** Profile route param — `[handle]` → `decisions/decisions-001-030.md`
- **#4** Brand mark ratios — 1:1 (icon) + 7:2 (wordmark) → `decisions/decisions-001-030.md`
- **#5** Signup route — `/join` → `decisions/decisions-001-030.md`
- **#6** Age guardrails (new rule, 2026-07-13). → `decisions/decisions-001-030.md`
- **#7** Onboarding shapes (new rule, 2026-07-13). → `decisions/decisions-001-030.md`
- **#8** Auth UX overhaul (2026-07-13). → `decisions/decisions-001-030.md`
- **#9** `/join` premium redesign (2026-07-13). → `decisions/decisions-001-030.md`
- **#10** Thin-Frontend / Fat-Backend service pattern (2026-07-14). → `decisions/decisions-001-030.md`
- **#11** Env-name drift — RESOLVED (2026-07-14, product owner). → `decisions/decisions-001-030.md`
- **#13** Global footer redesign + newsletter thin/fat (2026-07-14). → `decisions/decisions-001-030.md`
- **#12** Explore thin-frontend/fat-backend decoupling (2026-07-14). → `decisions/decisions-001-030.md`
- **#14** Navigation-shell overhaul — four-profile matrix (2026-07-15). → `decisions/decisions-001-030.md`
- **#15** Shell scroll model → native window scroll + micro-interaction pass (2026-07-15). → `decisions/decisions-001-030.md`
- **#16** User Context Hydration (2026-07-15). → `decisions/decisions-001-030.md`
- **#17** Access-token hook — the backend origin of the active context (2026-07-15). → `decisions/decisions-001-030.md`
- **#18** Header re-architecture + action menus (2026-07-15). → `decisions/decisions-001-030.md`
- **#19** Boundary-aware overlay positioning (2026-07-16). → `decisions/decisions-001-030.md`
- **#20** Desktop-User scroll model → locked viewport / internal body scroll (2026-07-16). REVERSES → `decisions/decisions-001-030.md`
- **#21** Project Details sidebar — the lane's engagement mode (2026-07-16). → `decisions/decisions-001-030.md`
- **#22** Icon-first sidebar philosophy + global link-shape rules (2026-07-16). → `decisions/decisions-001-030.md`
- **#23** Project Details sidebar — icon-first refactor (2026-07-16). → `decisions/decisions-001-030.md`
- **#24** Project Details sidebar — card-less header + channel quick-filters + footer realign → `decisions/decisions-001-030.md`
- **#25** Project Details sidebar — dedicated collapsed icon rail + smooth lane width (2026-07-16). → `decisions/decisions-001-030.md`
- **#26** Channel/chat view chrome — middle-nav-integrated header + composer footer (2026-07-16). → `decisions/decisions-001-030.md`
- **#27** Shell scroll model → native window scroll (2026-07-16). REVERSES Decision #20. → `decisions/decisions-001-030.md`
- **#28** Configurable middle-nav content-pane header slot (2026-07-17). → `decisions/decisions-001-030.md`
- **#29** Middle-nav header band — lifted from the content pane to the frame, connected to the lane → `decisions/decisions-001-030.md`
- **#30** Middle-nav frame → pinned, internal content scroll so the corners follow (2026-07-17). → `decisions/decisions-001-030.md`
- **#31** Channel chat feed + scroll model → native window scroll & composer footer band → `decisions/decisions-031-043.md`
- **#32** File Explorer — `/files` (channel + project scope) (2026-07-20). → `decisions/decisions-031-043.md`
- **#33** Submissions explorer — `/submissions` (channel + project scope) (2026-07-20). → `decisions/decisions-031-043.md`
- **#34** Shared AudioVisualizer + Table sort config + attachment-modal & submission-card polish → `decisions/decisions-031-043.md`
- **#35** Kanban Board system + reusable DnD/Kanban primitives (2026-07-20). → `decisions/decisions-031-043.md`
- **#36** Public Profile Page — `/[handle]` (2026-07-21). → `decisions/decisions-031-043.md`
- **#37** Calendar & Schedule system + reusable `@projective/ui/calendar` engine (2026-07-21). → `decisions/decisions-031-043.md`
- **#38** Unified floating-glass GuestShell (2026-07-21). → `decisions/decisions-031-043.md`
- **#39** Explore & Search visual overhaul — lean cards + bounded fill-grid layout engine → `decisions/decisions-031-043.md`
- **#40** Search filters relocated to the nav sidebar + guest full-width footer (2026-07-22). AMENDS → `decisions/decisions-031-043.md`
- **#40** Profile — Organisation entity kind + tab-bar overflow + color-coded languages → `decisions/decisions-031-043.md`
- **#41** Explore/Search layout, pricing & density pass (2026-07-22). → `decisions/decisions-031-043.md`
- **#41** Entity View pages — `/view/[id]` Amazon-style item viewer (2026-07-22). → `decisions/decisions-031-043.md`
- **#42** Profile tab partials + width-aware `pf-tabs` overflow + menu/carousel polish → `decisions/decisions-031-043.md`
- **#43** Custom Projects & Articles view templates — `/view/[id]` (2026-07-22). → `decisions/decisions-031-043.md`
- **#44** Projects view — de-escrowed, classification-led, flexible stage openings (2026-07-22). → `decisions/decisions-044-056.md`
- **#45** Services view — five delivery models + Projects-aligned stage showcase + availability → `decisions/decisions-044-056.md`
- **#46** Session-refresh lifecycle — silent renewal, refresh-before-redirect, redirect memory → `decisions/decisions-044-056.md`
- **#47** Header search parity + smart logout + account popover real-data binding (2026-07-22). → `decisions/decisions-044-056.md`
- **#48** Session-based service sidebars + functional channel-header actions (2026-07-22). → `decisions/decisions-044-056.md`
- **#49** Global Messaging module — floating chat popover, `/messages` inbox, profile quick-message → `decisions/decisions-044-056.md`
- **#50** `/messages` ⇄ `/projects` parity: shared lane chrome, body-portalled overlays, partial-nav → `decisions/decisions-044-056.md`
- **#51** Partial-nav island desync + chat scroll-to-bottom + footer parity (2026-07-23). → `decisions/decisions-044-056.md`
- **#52** Fresh Partial navigation REVERSED — back to standard full-page navigation (2026-07-23). → `decisions/decisions-044-056.md`
- **#53** Catalogue — the seller product & service management surface (`/catalogue`) + the platform's → `decisions/decisions-044-056.md`
- **#54** Wallet & Finance system — documentation + database FOUNDATION (2026-07-23). → `decisions/decisions-044-056.md`
- **#55** Wallet & Finance frontend surface — `/wallet` (2026-07-24). → `decisions/decisions-044-056.md`
- **#56** Availability & Discovery Calls — documentation + database FOUNDATION (2026-07-24). → `decisions/decisions-044-056.md`
- **#57** Notification Engine — documentation + database FOUNDATION (2026-07-24). → `decisions/decisions-057-063.md`
- **#58** Subscriptions, Entitlements & the earned Standing ladder — documentation + database → `decisions/decisions-057-063.md`
- **#59** Integration & Plugin Platform — `integrations` schema redesigned from scratch (2026-07-25). → `decisions/decisions-057-063.md`
- **#60** Wallet & Finance surface — complete redesign to a band architecture (2026-07-28). → `decisions/decisions-057-063.md`
- **#61** Teams & Businesses — the multi-member entity console (`/teams`, `/businesses`) → `decisions/decisions-057-063.md`
- **#62** Iconography unified — the `@projective/ui/icons` contract (2026-07-31). → `decisions/decisions-057-063.md`
- **#62** Fields — one state language, one geometry (`--fld-*`) (2026-07-31). → `decisions/decisions-057-063.md`
- **#63** Wallet — reachability, and the other half of the region contract (2026-07-31). REFINES → `decisions/decisions-057-063.md`
- **#63** Messaging — the `/messages` root inverted the region contract; the inbox moves to the body → `decisions/decisions-057-063.md`
- **#64** Ticket system rebuilt — the composer, the detail modal, and a derived price (2026-08-01). → `decisions/decisions-064-069.md`
- **#65** View Ticket modal rebuilt + the modal STACK primitive (2026-08-01). EXTENDS Decision #64. → `decisions/decisions-064-069.md`
- **#66** Browser audio capture — micro-permissions, pause/resume, and a real outgoing payload → `decisions/decisions-064-069.md`
- **#66** Ticket modal unified — one surface for create, view and edit (2026-08-02). SUPERSEDES the → `decisions/decisions-064-069.md`
- **#67** Asset management — the `/files` hub, the universal Asset Picker, privacy scopes, quotas and → `decisions/decisions-064-069.md`
- **#68** Universal Basket, Checkout, the card visualizer and the money-flow debugger (2026-08-06). → `decisions/decisions-064-069.md`
- **#69** Global multi-currency — the FX engine, `MoneyView`, and the header switcher (2026-08-10). → `decisions/decisions-064-069.md`
- **#70** Checkout redesigned into a four-step flow + the FOCUS chrome (2026-08-10). → `decisions/decisions-070-075.md`
- **#71** Scheduling coordination — majority resolution, per-viewer withholding, and a reschedule → `decisions/decisions-070-075.md`
- **#72** Calendar system — overlay ownership, the `cal__view` engine, the Event Modal and the → `decisions/decisions-070-075.md`
- **#73** Calendar — playful palette, card stacking, avatars, adaptive bubbles, and the scrollbar's → `decisions/decisions-070-075.md`
- **#74** Discovery card family rebuilt — ambient hover, split badge corners, one profile card, and → `decisions/decisions-070-075.md`
- **#75** Calendar physics — cursor-anchored zoom, the lever scrollbar, the placement engine, the pin, and the HTML popover layer (2026-08-21). → `decisions/decisions-070-075.md`
- **#76** Explore Home rebuilt — an above-the-fold block, one rail idiom, and the card family's tags, price and crest (2026-08-23). → `decisions/decisions-076-081.md`
- **#77** Explore polish — full-bleed layout, a calmer card, and the icon set's first two-tone channel (2026-08-24). REFINES #76. → `decisions/decisions-076-081.md`
- **#78** Clean Minimalist Luxury Architecture — the anti-card / anti-tag / conversion-lane laws institutionalized (2026-08-24). → `decisions/decisions-076-081.md`
- **#79** Entity View refactor — inverted conversion rig, content-first canvas, migrated sticky header, full-width session stage (2026-08-25). REFINES Decision #78. → `decisions/decisions-076-081.md`
- **#80** Service booking — the seven CTA formats, the Contact menu, and the slot picker (2026-08-26). → `decisions/decisions-076-081.md`
- **#81** Site-wide unified scrollbar — one always-visible 10px bar, a surface-inherited track, and a thumb that is actually visible (2026-08-27). REVERSES the self-hiding scrollbar of Decision #15. → `decisions/decisions-076-081.md`
- **#82** Projects & Messaging read API — live DB branch, HEAD/OPTIONS, ETag revalidation and a tenant-scoped ARC cache (2026-08-30). → `decisions/decisions-082-085.md`
- **#83** The read API goes live — ten remaining endpoints wired, and the `comms` RLS hole closed (2026-08-30). COMPLETES Decision #82. → `decisions/decisions-082-085.md`
- **#84** Projects domain completion — the dropdown regression, the write layer, the role-split engagement page, and media metadata (2026-08-31). → `decisions/decisions-082-085.md`
- **#85** Project creation split into Quick-Init and workspace setup — and visibility becomes two columns (2026-09-03). → `decisions/decisions-082-085.md`
- **#85** Project creation wired to Postgres — `POST /api/projects/create` (2026-09-01). → `decisions/decisions-085-090.md`
- **#86** Project Creation rebuilt as a six-step wizard — the offer narrows, the enum does not (2026-09-02). → `decisions/decisions-085-090.md`
- **#87** An authenticated account with no profile — the un-onboarded trap, closed at the token, the gate and the write (2026-09-03). → `decisions/decisions-085-090.md`
- **#88** Route addresses become prefixed opaque slugs — `/projects/prj-…`, and the uuid stops routing (2026-09-06). → `decisions/decisions-085-090.md`
- **#89** Post-onboarding immutability, the publish confirmation, and the stage Details tab (2026-09-06). → `decisions/decisions-085-090.md`
- **#90** `projects.create_project`'s phantom `nda_mode` column — resolved (2026-09-06). CLOSES Decision #88 flag (a). → `decisions/decisions-085-090.md`
- **#91** Timeline / Gantt — `@projective/ui/gantt`, the project timeline, the calendar's fourth view and the ticket modal's Timeline tab (2026-09-06). → `decisions/decisions-091-096.md`
- **#92** Button tactile feedback, and the `--on-primary` contrast defect fixed at the token layer (2026-09-07). → `decisions/decisions-091-096.md`
- **#93** Stages are addressed by their slug — the channel segment stops being a uuid (2026-09-07). EXTENDS Decision #88. → `decisions/decisions-091-096.md`
- **#94** Kanban — the whole card is the handle, and a ticket's funding scope decides who sees it and who may move it (2026-09-07). → `decisions/decisions-091-096.md`
- **#95** Ticket deep links — `?tkv=<ticket-slug>`, the `tkt-` address, and the root cause of "Back reloads the document" (2026-09-08). EXTENDS Decisions #65 / #88. → `decisions/decisions-091-096.md`
- **#96** Entity view — projects fold into the shared frame; the Gutenberg reading gravity is the contract (2026-09-09). SUPERSEDES the bespoke project template of Decisions #43/#44; EXTENDS #78/#79. → `decisions/decisions-091-096.md`
- **#96** Public profile rebuilt as an editorial single column — the split hero, four sections, and a monochrome chrome (2026-09-10). → `decisions/decisions-096-101.md`
- **#97** Public profile — the seller rig (Hire), the Services row, availability + at-a-glance facts, the guest sign-in prompt, and the Reviews stance filter (2026-09-15). REVERSES two positions of Decision #96 at the product owner's direction → `decisions/decisions-096-101.md`
- **#98** Entity viewer + Explore cards — token contract, iconography and the provider line aligned to the profile overview (2026-09-15). → `decisions/decisions-096-101.md`
- **#99** Explore filters — the facet SSOT, three range controls, the section-header standard, the refine field and the guest sidebar toggle (2026-09-16). → `decisions/decisions-096-101.md`
- **#100** Progressive images, the Recommended fold's dead band, and the hero search bar aligned to the header (2026-09-17). → `decisions/decisions-096-101.md`
- **#101** Profile — the showcase carousel, the in-place photo editor, and the owner-written headline (2026-09-17). EXTENDS Decisions #96 / #97. → `decisions/decisions-096-101.md`
- **#102** Messaging — one lane on every `/messages` route, group creation, the relationship-ranked people picker, and the unified share modal (2026-09-18). PARTLY REVERSES the messaging half of Decision #63 at the product owner's direction. → `decisions/decisions-102-107.md`
- **#103** Profile Hire invitation modal + the persistent floating messenger, and the inbox's first SEND (2026-09-18). EXTENDS Decisions #49 / #97 / #102. → `decisions/decisions-102-107.md`
- **#104** Sign-in form — one identifier (email OR username), the shared Checkbox, in-field floating labels, and Enter that moves before it submits (2026-09-18). → `decisions/decisions-102-107.md`
- **#105** `/join` — the Enter chain: next field → next step → submission (2026-09-18). EXTENDS #104. → `decisions/decisions-102-107.md`
- **#106** Product cards and the product showcase — the work-tile register, the showcase aspect band, and one masonry on three surfaces (2026-09-18). → `decisions/decisions-102-107.md`
- **#107** Video playback controls — `@projective/ui/display` `VideoPlayer`, one surface for the profile hero, the Selected-work tile and the entity canvas (2026-09-18). → `decisions/decisions-102-107.md`
- **#108** Profile Hire and Add-to-project rebuilt — popovers at the control, the split modals, the intake SSOT, placeholder assignments, custom-start consultations and the type wizard (2026-09-19). EXTENDS Decisions #97 / #103. → `decisions/decisions-108-113.md`
- **#109** The schema behind Decision #108 — intake columns, identity-addressed invitations, the call-platform allow-list, and the seller-side write contract (2026-09-19). COMPLETES #108. → `decisions/decisions-108-113.md`
- **#110** Offline handling refactored — the navigation guard, the write guard, the interstitial, the Ribbon and the list-tail notice (2026-09-20). → `decisions/decisions-108-113.md`
- **#111** Profile chrome follows the reader — the migrated header band returns with the rig, the tab bar floats as a glass pill, and the Explore tree gets one contextual Back (2026-09-20). PARTLY REVERSES Decision #96 → `decisions/decisions-108-113.md`
- **#112** The scroll-migrated sticky header is ONE shell contract — the probe, the signal, the back control and its hand-over shared by `/view` and `/[handle]` (2026-09-21). REFINES Decisions #79 / #111. → `decisions/decisions-108-113.md`
- **#113** Profile hiring — dispatch closes the modal, the 48-day re-invitation cooldown, the outbound rate limit, popovers that follow the rig, tab switches that keep the reader's place, and two Work-section fixes (2026-09-21). EXTENDS Decisions #103 / #108 / #111. → `decisions/decisions-108-113.md`
- **#114** Development seed — the interconnected dev world with storage-backed images (2026-09-21). → `decisions/decisions-114-121.md`
- **#115** Explore Search Results (guest) — the filter column moves into the results body, aligned to the results bar; the results head spans the page (2026-09-21). REFINES Decisions #40 / #99 for the guest shell. → `decisions/decisions-114-121.md`
- **#116** Invitations — the one-off staffing relaxation, the invitation lifecycle in the database, the client's three acts on a record, and the Dev Tools Invites window (2026-09-22). → `decisions/decisions-114-121.md`
- **#117** Three project types, one create modal, and a keyboard-first form layer (2026-09-22). → `decisions/decisions-114-121.md`
- **#118** The profile's create modal is paced as two steps again (2026-09-22). PARTLY REVERSES Decision #117 at the product owner's direction. → `decisions/decisions-114-121.md`
- **#119** The public profile goes live — the owner's three views, the media pipeline, and one door for a person's picture (2026-09-23). → `decisions/decisions-114-121.md`
- **#120** Project Details lane — Teams and Private Messages render only when the viewer has something in them (2026-09-23). → `decisions/decisions-114-121.md`
- **#121** Task projects get their own engagement chrome — one conversation, no Timeline or Calendar, and a lane for the work (2026-09-23). → `decisions/decisions-114-121.md`
- **#122** Wallet re-architected into one command-centre page — a luminous balance hero, a sliding dashboard sheet, every money action in a dialog (2026-09-29). SUPERSEDES the presentation of Decisions #55 / #60 / #63 (wallet); the finance backend, `/api/wallet/*` and `@projective/types/finance` are kept. → `decisions/decisions-122-126.md`
- **#123** Wallet polish — the hero behind the glass chrome, a header band with the range ruler, the four-state allocation meter, the Finance drawer, and the MoneyView minor-digit baseline (2026-09-29). REFINES Decision #122. → `decisions/decisions-122-126.md`
- **#124** Wallet — the Finance drawer becomes the middle-nav lane, the header band becomes hero corner tools, the range ruler pins, and transactions · analytics · invoices get pages (2026-09-29). REFINES Decision #123. → `decisions/decisions-122-126.md`
- **#125** Stripe fiat rails, Phase 1 — card payments into the ledger, Connect payout accounts, Identity KYC and the signed webhook (2026-09-29). → `decisions/decisions-122-126.md`
- **#126** Stripe fiat rails, Phase 2 — withdrawals, saved cards, recurring deposits, disputes, verification, card checkout and the CSP (2026-09-30). CLOSES Decision #125 flags (b), (d), (e), (f), (g), (h) and most of (c). → `decisions/decisions-122-126.md`
- **#127** One avatar rule — uploaded photo → OAuth picture → default picture → initials; `UserAvatar` is the app's one person renderer (2026-09-30). FLAGS for a human: the temporary stock-face default contradicts the documented initials fallback. → `decisions/decisions-122-126.md`
- **#128** Project requests, the hiring handshake, inbox folders (Primary · Requests · Archived), the conversation context panel and safe link previews with the `/exit` interstitial (2026-10-01). REFINES Decisions #116(B) (the intro the client wrote is posted as their own DM message) and #113 (the cooldown refusal names when it lifts). FLAGS (a)–(m) for a human, including the un-migrated local database. → `decisions/decisions-122-126.md`
- **#129** The middle-nav frame's full-height, drag-resizable right panel (`MiddleNavPanel`); the canvas becomes a four-corner card between lane and panel; the conversation context panel and a channel's details dock in it (2026-10-01). REFINES Decision #128(D). FLAGS (a)–(d) for a human. → `decisions/decisions-122-126.md`
- **#130** Group conversation photos (`comms.set_group_photo`, any member, cut from the member's own library), a started conversation lists for its starter at once, and the temporary group-picture fallback `banner_5.jpg` (2026-10-01). FLAGS (a)–(h) for a human. → `decisions/decisions-122-126.md`
- **#131** Messaging — four-mark rich text stored as plain text + Quill Delta (the agreement rule), replies (`reply_to_id`, same-room guard), the ghost side-rail actions, highlight mode with multi-select and the unfocused-composer keyboard, swipe-to-reply / long-press reactions and the mobile header action bar (2026-10-03). Scoped glass extension of §B.4.3 at the owner's direction. FLAGS (a)–(i) for a human, including the un-run migrations. → `decisions/decisions-122-126.md`
- **#132** Messaging — chat attachments reach their recipients (`files.fn_can_read` message arm + a read-before-link INSERT policy, the shared attachment loader, object-route URLs, link tiles), the 8,000-character text cap end to end (DMs were stored truncated at 4,000), and long messages collapse to four lines or open as a card in a dialog (2026-10-04). FLAGS (a)–(d). → `decisions/decisions-122-126.md`
- **#133** Project Details lane — a top tier of primary views (archetype-specific `NavItem` rows: Discussion first), a utility-only footer, no General folder; every engagement's discussion at `/projects/[slug]/discussion` (`DISCUSSION_REF`, one room rule at every layer; old addresses 303), and the live create path now opens the project-wide room (2026-10-05). AMENDS DESIGN_SYSTEM §B.6.3; REFINES Decision #121. FLAGS (a)–(h) for a human. → `decisions/decisions-122-126.md`
- **#134** The lane's view sets and the channel tab sets per project type, applied exactly as the owner specified (`CHANNEL_TAB_MATRIX`; pipeline lane drops Timeline, Task lane gains Details, Task/session Discussion is Chat-only) (2026-10-05). REFINES Decision #133. FLAGS (a)–(d). → `decisions/decisions-122-126.md`
- **#135** One-off and pipeline projects always get their discussion room — `projects.create_project` opens the project-wide room (step 7b) and the one local project without one was backfilled (2026-10-05). CLOSES #133 flag (b). → `decisions/decisions-122-126.md`
- **#136** The Members tab becomes an explorer — addressed Members · Requests · Invitations sections (`?view=`), the profile-card grid ⇄ table on the shared zoom with Invite in the footer, a profile preview, the floating messenger, and the owner's decline of an applicant (`projects.reject_application`) (2026-10-05). EXTENDS #32 / #33 / #50 / #74 / #116 / #128. FLAGS (a)–(d) for a human. → `decisions/decisions-122-126.md`
- **#137** The pop-out chat closes on arriving at any chat view from another page (the spawning page and its reload keep it; bfcache-safe), "Open in input" and the Members preview's "View full profile" become ghost icon-only links, and the popout composer floats as a compact glass band over its feed (2026-10-05). AMENDS #103 (A); scoped glass extension of §B.4.3. FLAGS (a)–(c). → `decisions/decisions-122-126.md`
- **#138** Universal backdrop dismissal and LIFO modal stacking — one Escape owner (`escape-stack`) that only ever reaches the top overlay, scrim-only outside dismissal for modals with a backdrop, `useBackdropPress` (a press must start and end on the scrim), and the `:where(.ui-portal)` fix that revives every `Dialog` backdrop (2026-10-05). REFINES Decision #72(A). → `decisions/decisions-122-126.md`
- **#139** Stage seats are offered one at a time and accepted — stage invitations for existing members (`/api/projects/members/stage-invite`, "Invite to stage ›", the preview's Stages section, the card's pending line with Cancel), the cascading `ActionMenu` in `@projective/ui/navigation`, the post-onboarding shape lock backstopped in the database (`trg_project_shape_lock`), publishing promotes draft-staged seats, and a whole-project invite seats only a single-stage shape (2026-10-05). EXTENDS #89 / #108(E) / #116 / #136. FLAGS (a)–(g). → `decisions/decisions-122-126.md`
