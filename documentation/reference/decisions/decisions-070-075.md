> Full rows of Resolved Decisions #70–#75 (former root CLAUDE.md §8), verbatim.

| #  | Decision (2026-07-12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Applied in                                                                                                                                                                                                                                                                                    |
| :- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 70 | **Checkout redesigned into a four-step flow + the FOCUS chrome (2026-08-10).** `/checkout`
becomes a four-route linear flow — **Basket → Details → Payment → Confirmation** — and `/basket`
retires to a 302 redirect, so one surface has one URL. New
**`packages/types/finance/{buyer,order}.ts`**: buyer delivery + billing (personal AND business), the
completeness predicate `missingBuyerFields()` / `buyerDetailsComplete()` / `canSkipDetails(session)`
that the auto-skip, the form, the Pay refusal and the invoice all ask ONCE; and the order /
fulfilment / invoice projection with `calendarLinksFor()` + an RFC-5545 `buildIcsCalendar()`.
**`CheckoutResult.orderId` is no longer permanently `null`** — the hole logged as Decision #68(g) —
because a charge now records an order the confirmation reads back. `checkoutTotals()` gained
`processingContributionMinor`, added LAST and never part of the platform-fee base: charging a
percentage of a voluntary gift would make the buyer's generosity revenue. Plus `SpendLimitBlock` and
the `missing_details` / `spend_limit` blocker codes. **Reuse over invention:** monthly invoicing is
the EXISTING `org.business_profiles.invoicing_mode` + `billing_day` (1–28 CHECK), the department
allocation is `org.organisations.departments`, a user "list" is a named `finance.baskets` row (that
table's own comment says a wishlist is not a separate kind), and the invoice's FX record COMPOSES
`ledger.ts`'s `FxSnapshotSchema` rather than restating `fx_rate`/`fx_base`/`fx_as_of`. **No DB
migration** — a read+write projection over fixtures like every sibling, behind the existing
`FINANCE_BACKEND_LIVE`. **(A) FOCUS CHROME (new `DESIGN_SYSTEM.md` Part D.6).** A fifth shell mode
for a linear, committing flow: `AppShell` gains `chrome?: "full" | "focus"`, resolved per-URL by
`checkoutChromeFor()` so it paints in the FIRST byte rather than flashing chrome and removing it
under the buyer's cursor. It removes chrome by **not constructing it**, never by hiding it — hidden
chrome still holds a grid track and still feeds the `--shell-frame-inset-inline` seam accumulator.
Verified by measurement: with no lane the frame's `auto minmax(0,1fr)` grid resolves column 1 to
`0px` and the header band renders flush at x=0 (1265px wide, zero overflow); and `--frame-radius`
must be set on **`.ui-app-shell__content`**, not on a descendant, because the pseudo-element that
reads it belongs to that element (setting it on `.ui-middle-nav` left the curve at 15.68px). The
basket and the confirmation deliberately keep FULL chrome — the basket is a page a buyer
legitimately leaves, and the confirmation's whole job is to send them onward. **(B) Two defects
caught before shipping, both invisible in source.** `middle-nav.css` lifts the footer band by
`--shell-bottomnav-h` unconditionally at ≤767px, so withholding `BottomNav` left a **56px dead gap
under the Pay button on every phone** (now measured at `0`); and `user-shell.css` reached a page
ONLY through the `ShellSidebar` / `UserActions` island bundles, both of which focus mode suppresses
— so Details and Payment would have rendered an **unstyled header**. Moved to `client.ts`. **(C) A
pre-existing money bug fixed at the root.** `wallet-fixtures.ts` held a private THREE-entry FX table
(`GBP`/`USD`/`EUR`) with a `?? 1` fallback while `fx-fixtures.ts` / `FxService` carry all twelve
offerable currencies — so nine of twelve converted at a rate of exactly 1, and the converter also
ignored currency exponents, compounding it by a further 100× for JPY. Measured: a $95.00 product
rendered `JP¥7,480` where the seeded table says `JP¥14,362`, and `AED 74.80` against a true AED
348.58. It now reads `FX_FIXTURE_RATES` through the SSOT's own
`resolveRate`/`convertMinorUnits`/`currencyExponent`, so the server's figure and the client's
re-projection derive from ONE table; **five regression tests** iterate the full offerable set rather
than a sample, because a GBP→USD test would have passed throughout the entire period both bugs were
live. This also corrects `/wallet`. **(D) `Amount` was a correctness bug, not a style choice.** It
printed `value.display` and emitted no `data-money-*`, so the currency sweep (Decision #69) could
not see it: **every figure on the checkout kept the old currency after a switch**, on the number the
buyer was about to pay. It now delegates to `MoneyView` — 0 money nodes before, 29 after, and
switching to JPY converts all 21 visible figures with each disclosing its immutable origin. **Six
new Dev axes** (`buyerDetails` · `billingContext` · `invoicingMode` · `spendLimit` · `fulfilmentMix`
· `conferencing`), each with BOTH `reflect()` branches, travelling as validated `sim*` query params
because the seam is a CLIENT surface the server cannot see. **Verified in-browser** at
1440/1024/768/375, LTR + RTL, light + dark: all four routes hold zero horizontal overflow in both
directions at every width; the payment cards measure **exactly 302×192 (ratio 1.5729)** on BOTH the
option wrapper and the card (both selectors are required — `.ui-paycard-option--*` restates
`--pc-max`); the "Selected" badge renders once as an `aria-hidden` sibling of the radio, never
nested inside it; the details form's 12 controls are all labelled with **zero** premature
`aria-invalid`; the contribution threads £1,366.15 → £1,385.48 exactly; the `.ics` is valid RFC 5545
with CRLF and a deterministic `DTSTAMP`. One defect of my own, found by measurement: the stepper's
`upcoming` ink measured **3.33:1** — it had been treated as a disabled control, but these labels are
the only thing telling a reader what the rest of the flow consists of, so they carry the full 4.5:1
floor (now 10.36:1; the recession is carried by weight and the un-filled mark instead). **CONFLICTS
FLAGGED, NOT SILENTLY RESOLVED — each needs a human:** (a) **the brief's hexes do not exist in this
theme.** Colours are Material-You generated at request time, so `--primary` is `#00929e` dark /
`#007680` light (NOT `#288690`, which is the SEED), `#F5A623` appears nowhere in the repo, and
**`--text-main` and `--text-disabled` are never declared at all**. The tokens the brief NAMES were
used and the hexes ignored, per §3. (b) **The amber CTA re-purposes a status token as the action
colour.** §A.1 assigns `--primary` to "primary action" and `--warning` to "in progress /
time-sensitive", and §B.8.3 forbids inventing a severity by re-tinting. Built as the brief specifies
(`variant="filled"
severity="warning"`), and **measured: `--warning` is amber `#ffb872` in dark but
`#8c5000`, a dark ochre, in light** — so the brief's visual intent is unreachable in light mode
through any token. Literal amber platform-wide is a `theme-engine.ts` tone change that repaints
every warning surface, plus an §A.1 role-table amendment. (c) **The pill shape on every checkout CTA
is an owner-approved, surface-scoped deviation from §B.8.4**, which otherwise reserves
`--radius-full` for chip-like and floating controls. Approved 2026-08-10 because the design draws
the flow's actions as pills throughout and one rounded rectangle among them reads as a mistake;
documented as an explicit exception in §B.8.4 rather than left to be rediscovered, and deliberately
NOT extended to any other surface. (d) **Two `filled` CTAs vs §B.8.2** — the desktop lane footer
owns the commitment and the duty transfers to the footer rig ≤767px, so exactly one is ever on
screen; logged rather than resolved. (e) **The brief's "replace the disabled Use button" describes a
state that never existed** — selection has always been a `role="radiogroup"`; the badge was added,
nothing was removed. (f) **302:192 contradicts the package's documented ISO-7810 CR80 rationale**
(`1.586`, "the real ratio, not a rounded 1.6"); applied as a call-site token override only, never a
package edit. (g) The currency flag is a **data mark, not an icon** (`aria-hidden`, off `.ui-icon`,
the ISO code carries the name) — the §B.7.7 exemption Decision #63 established for the wallet's
fund-state marks. (h) Deep links use the canonical `/projects/[projectId]/[channelId]`, NOT the
brief's `/projects/[id]/[stageId]`, which has no route and would 404. (i) **No blanket "escrow hold"
copy was added**: `PRODUCT_SPEC.md` locks escrow at checkout for SESSIONS only — a pipeline ticket
escrows at the freelancer's Claim, and a digital product has no documented escrow at all. (i)
`finance.orders` / `finance.buyer_details` are the deferred live-path tables; field names were
chosen so they can adopt them verbatim. (j) Inherited and untouched: Decision #68's `authenticated`
has no `USAGE` on the `finance` schema, `platform_fee_bp` seeded `0`, and the three overlapping
instrument tables. | `DESIGN_SYSTEM.md` **Part D.6** · `ROUTING.md` · `PRODUCT_SPEC.md` §Sitemap ·
`SYSTEM_ARCHITECTURE.md` §Backend Services ·
`packages/types/finance/{buyer,order,checkout,basket,fx}.ts` ·
`packages/backend/services/finance/{buyer,order,basket,wallet}-fixtures.ts` +
`{Checkout,Basket,Order}BackendService.ts` + `wallet-fixtures_test.ts` ·
`packages/ui/navigation/{components/AppShell.tsx,styles/{app-shell,middle-nav,page-canvas}.css}` ·
`apps/web/features/shell/components/UserShell.tsx` · `apps/web/client.ts` ·
`apps/web/features/checkout/**` · `apps/web/routes/(dashboard)/{checkout/*,basket}` ·
`apps/web/routes/api/{checkout/*,basket/lists}` · `apps/web/utils/dev-seam.ts` ·
`apps/web/features/devtools/*` · Decisions #2 / #45 / #60 / #62 / #63 / #68 / #69 |

| 71 | **Scheduling coordination — majority resolution, per-viewer withholding, and a reschedule
lifecycle that can end (2026-08-17).** Repairs the scheduling data layer behind the calendar
surfaces. **(A) MAJORITY, resolving a contradiction with the business SSOT.** `PRODUCT_SPEC.md` §The
Proactive Calendar: _"In multi-attendee sessions (Group Sessions), a change in time requires a
majority consensus to be finalized."_ What had shipped was first-past-the-post — `leadingProposal`
returned the top of a sorted tally with no threshold, so a slot holding 1 of 8 votes "led" — and the
contradiction was neither flagged nor logged. `PRODUCT_SPEC.md` wins on business rules (§0), so
majority is now implemented: `voteQuorum(n) = floor(n / 2) + 1` and `majorityProposal()`, with the
denominator being everyone ENTITLED to vote (the roster minus the host, who authored the options),
**not** everyone who answered. **Abstaining is therefore a vote against moving**, deliberately: a
turnout-based denominator would let two people move a session of twelve by being the only two paying
attention, and the honest default for an unanswered question is that nothing changes. **When nobody
reaches a majority the vote LAPSES and the original time stands** — a seventh `RescheduleStatus`,
not `resolved` with a null winner, because a reader of `resolved` must be able to assume something
was decided and an overloaded null is how a surface comes to render "moved to —".
`leadingProposal`'s earlier-slot tie-break now only ever orders the DISPLAY: two slots cannot both
hold more than half of one electorate. **(B) The vote could never be resolved at all.** `confirm`
was hard-gated to counterparty mode, nothing acted on `resolvesAt`, and
`leadingProposal`/`voteTally` were never called by the service — so `resolved` was unreachable on
the vote path and the only exit was to withdraw. Resolution is now a pure, total, idempotent
`settleVote(now, reschedule, voters)` applied on **every read and before every action** (there is no
cron in this layer, and a deadline nothing observes is not a deadline; the live path runs the same
function from a sweep). It closes on either trigger: the deadline arriving, or every eligible voter
having answered — a vote is immutable once cast, so making a cohort wait out a deadline whose
outcome is already fixed is theatre. A host may additionally `confirm` early, but **only a vote that
has already carried**: they close a decided vote, they never decide one. **(C) `withdraw` was an
unrecoverable dead end** — it set a status the closed-round guard then blocked `open` from leaving
while still admitting `propose`, so a host who withdrew once accumulated slots forever with no way
to put any of them to anybody. Resolved by making all three endings terminal **for that round** and
`propose` the succession: a proposal on a closed round opens round `n + 1` with a fresh ballot (new
`EventReschedule.round`, which also keeps proposal ids unique across rounds). **(D) `propose` never
validated the SLOT** against the 12-hour lockout, so `open` could stamp a vote whose deadline was
already in the past and the ballot could elect a time that was itself already unmovable; the lockout
now applies to the slot being offered as well as the event being moved, and `open` additionally
refuses a ballot that is no longer answerable. **(E) 🚨 PRIVACY — public, unauthenticated reads were
serving the attendee roster, the meeting `joinUrl`, the passcode, the dial-in details, attendees'
personal notes and the HOST'S EARNINGS.** `meeting.ts` stated the contract ("`joinUrl` is present
ONLY to the event's own parties — the server withholds it from everyone else rather than relying on
the URL being unguessable, because a meeting link IS the access control for most providers") and
nothing implemented it: the only gate was `if (event.masked)`, a PRESENTATION flag, and the weekly
public group session is deliberately unmasked. Closed by a new SSOT layer
`@projective/types/scheduling` `privacy.ts` — a `SchedulingViewer` (deliberately **not** a Zod
schema, because a viewer a caller could parse is a viewer a caller could invent), `isEventParty`,
and an **allow-list** `redactEventForViewer` — applied at the fat-service boundary on the way out,
unconditionally, on the read AND write paths. Allow-list rather than deny-list so a field added
tomorrow is withheld until somebody publishes it: forgetting then costs a missing label, which is
visible, instead of a leak, which is not. Every service method takes a viewer defaulting to
`ANONYMOUS_VIEWER`, so forgetting to pass one withholds MORE. Public reads keep exactly what §Part
1.4 allows — position, privacy-safe status, and the seat COUNT, whose whole point is that it names
nobody. Seating is now viewer-aware too (a guest is seated nowhere), and `/api/scheduling/calendar`
— whose only surfaces live under `(dashboard)` — gained the signed-in guard its two genuinely public
siblings must not have. **(F) Fixture defects with user-visible consequences:** the host was seated
TWICE on 34 of 84 rosters (the domain casts include the owner and the fallback pool overlaps them),
so `rescheduleModeFor(2)` routed a "meeting" of one person with himself down the counterparty branch
— rosters are now deduplicated by identity with the host excluded; `@sofia` read "Sofia Almeida"
here and "Sofia Marin" everywhere else, so `profileHref` sent two different people to one profile —
the pool is now the domain's identity table and `normaliseParty` canonicalises through it; 154 of
498 audit lines were dated AFTER the fixed clock and all were marked unread (timestamps derived from
the event's START, not the clock) — every line is now anchored to `min(NOW, event.start)` and
`unread` requires a non-negative delta; an RSVP of `pending` stamped `respondedAt` and logged
"Marked Maybe" — clearing an answer is a real move, so it now clears the timestamp per the schema's
own invariant and logs nothing false; the attendee counter was being MINTED on stage syncs that
never had one, turning on `EventBlock`'s people-badge across every project calendar — it is now only
ever restated, never introduced. Also: the ballot's per-seat entropy was keyed on a trailing seat
index, and since `hash` multiplies by 31 (≡ 1 mod 3) every roster in the corpus produced the
identical abstention pattern and the identical tally; it is keyed on the voter's identity instead.
**Flagged, needs a human — do NOT silently resolve:** (a) **the 12-hour reschedule lockout is
unreconciled with the 24-hour cancellation window** (§Cancellation & Escrow Protection refunds an
attendee outside 24h and forfeits their escrow inside it). Between T-24h and T-12h an attendee may
still MOVE a session they can no longer cancel without forfeiting, so rescheduling is a documented
route around the forfeit rule. Which boundary governs, and whether moving inside the escrow window
should carry the same financial consequence as cancelling, is a money decision. (b) With the backend
gates off an AUTHENTICATED reader is still seated by fixture DESIGNATION rather than by identity, so
"authenticated non-party" is a state the stub corpus cannot produce — the live path replaces the
seating, not the projection, and the rule itself is unit-tested directly. (c) `findProfile`
synthesises a short display name for a handle it does not know ("Ivy" for `@ivy`) while the
projects, explore and messaging corpora all say "Ivy Chen" — the scheduling corpus now speaks with
one voice, but `/@ivy` itself still renders the short name, which is a PROFILE-corpus divergence to
reconcile there. (d) `lapsed` is unreachable through the service under a FIXED fixture clock once
slots are lockout-valid, so it is produced by the derived corpus and proven by unit test rather than
by an end-to-end write. **No DB migration** — coordination remains a read+write projection over
fixtures with no `scheduling.*` attendee, proposal, vote or history table yet (`mod.ts` says what
persisting it would need), so no `documentation/database/*` change; no new `@projective/ui`
primitive → no `DESIGN_SYSTEM.md` §C.1 change; no new simulatable axis a surface branches on →
nothing to mirror in the Dev Context Switcher (§5). `PRODUCT_MANAGEMENT.md` §3.5 gains the two
lifecycle rows, the three named caps and the majority rule **in this change**, and its "a reschedule
is not a state" sentence is reconciled: true of a discovery CALL (one slot, one acceptor, a
counter), untrue of a multi-attendee EVENT, and the two now sit side by side with the reasoning.
Verified: `deno task check` clean, `deno test packages/` 144 passed (96 before), `deno lint` clean
on all 30 touched files. | `PRODUCT_SPEC.md` §The Proactive Calendar / §Cancellation & Escrow
Protection · `PRODUCT_MANAGEMENT.md` §3.5 ·
`packages/types/scheduling/{privacy,coordination,
mod,rows,calls}.ts` +
`{privacy,coordination}_test.ts` ·
`packages/backend/services/scheduling/{ScheduleBackendService,coordination-fixtures,calendar-fixtures,
availability-fixtures,schedule-fixtures}.ts` +
`coordination-fixtures_test.ts` · `apps/web/features/calendar/core/{viewer,calendar-ssr}.ts` ·
`apps/web/routes/api/scheduling/*` ·
`apps/web/routes/(dashboard)/projects/[projectId]/{calendar,[channelId]/calendar}.tsx` ·
`apps/web/routes/[handle]/{availability,view/[item]/schedule}.tsx` ·
`apps/web/routes/(public)/view/[entity]/schedule.tsx` · Decisions #37 / #48 / #56 |

| 72 | **Calendar system — overlay ownership, the `cal__view` engine, the Event Modal and the
`/calendar` hub (2026-08-17).** The surface work Decision #71's data layer serves, plus the
primitive fix underneath all of it. **(A) OVERLAY CONTAINMENT IS OWNERSHIP, NOT ANCESTRY.** Every
anchored panel is `BodyPortal`'d into `document.body`, so a dropdown opened inside a modal is that
modal's DOM SIBLING and `panelRef.contains(target)` reports a click on the overlay's own menu as an
OUTSIDE click. The live instance was `TicketView.tsx` (`closeOnOutside: true`, no `enabled`), where
the modal closed on selection AND the edit was lost, because its working copy is a modal-stack frame
slot that `forget()`s on close. New `packages/ui/hooks/overlay-registry.ts` derives parentage from
the DOM at query time — **B is a child of A iff A's panel contains B's TRIGGER**, the trigger being
the only part of a portalled overlay that stays where the author wrote it. Preact context cannot do
this job: `BodyPortal` renders through a separate `render()` root, so a provider above the trigger
is invisible inside the panel (the Decision #69 finding, again). **The two dismissal channels are
now gated differently and this is load-bearing:** ESCAPE is exclusive (the handler calls
`stopImmediatePropagation`, so `enabled`/`isTop` picks the one owner, and it must gate the LISTENER
— a callback that no-ops still consumes the press), while OUTSIDE POINTER is NOT gated by `isTop` —
doing so made an overlay undismissable for as long as anything sat above it. **The two divergent
`useDismiss` copies are now one** (`fields/hooks/` had no `enabled` and used `stopPropagation`), as
are the two `useFloating` copies; ten components that never claimed a stacking slot now do, which
surfaced that `--z-overlay` is **1100 — exactly `LAYER_BASE.popover`** — so all five nav panels
painted UNDER any open modal. `useFloating` gained `collisionPadding`, an
`availableHeight`/`availableWidth` output (a clamp cannot keep a panel on screen when the panel is
TALLER than the space left: `Math.max` pins its top and the overflow simply runs off, which is why a
100-year year picker clipped instead of scrolling) and a panel `ResizeObserver`. **(B) `cal__view`**
— a Figma-style overlay scrollbar whose handle is a DEPTH gauge rather than a proportional thumb and
whose length freezes on drag until pointerup AND pointer-exit; Day/Week continuous virtualization
anchored on the current time; Month switched from clipping to discrete pagination; a 60s indicator
that moves only itself. **Motion may only ever decorate `transform`/`opacity`** — a background tab
freezes rAF, transitions and animations, so geometry that ENCODES data is set directly (the Decision
#60 defect class). **(C) The Event Modal** mirrors `tkv` structurally with its own BEM prefix, and
every business rule is CALLED from the SSOT rather than re-implemented — a client gate that was
looser than the server's (it applied the 12-hour lockout to the event but not to the slot being
OFFERED) is the failure that pattern exists to prevent. **ONE clock**: the modal advances from the
fixtures' pinned reference at wall rate, because moving the GATES to the wall clock would declare
the whole seeded corpus finished rather than fix the header/body contradiction. **(D) `/calendar`**
follows the region contract (`/wallet` §60/§63): lane owns navigation, header band identity + range,
footer rig every action behind container-query tiers with the menu holding every action at every
tier, body views and selects only. The legacy five static provider tags are replaced by a real
Connect-Calendar surface; provider marks stack; `.ics` import is a pure, unit-tested SSOT parser
(RFC 5545 line-unfolding before parsing, CRLF, escaped TEXT). `sess-cal` is removed from the
projects sidebar — `calendarHref` was used TWICE there, so the Propose-time CTA had to survive it.
**THREE SECURITY DEFECTS found by adversarial review and fixed** (each now pinned by a test): a
signed-in STRANGER was seated as an attendee on the two guest-reachable surfaces that show OTHER
people's calendars, receiving the host's join URL, passcode, the named roster with private notes,
and per-occurrence and per-series EARNINGS — seating is now by IDENTITY, because being signed in is
not a relationship to somebody else's meeting; the `sim` developer overlay, whose `seat: "host"` is
the sole input to host authority and which arrives on a caller-controlled query string and request
body, was ungated and therefore a privilege-forgery primitive **in production** — it is now honoured
only where the SERVER says `DENO_ENV=development`, stripped at one choke point; and
`/api/scheduling/personal` had no guard, serving the titles and locations of other people's
engagements (the per-viewer projection withholds only the COORDINATION fields). A masked block also
no longer discloses `sources` — masking says "this time is taken" without saying what takes it, and
provenance answers exactly the question the mask refuses. **Process note worth keeping:** the first
repair closed the ANONYMOUS leak and its own test asserted exactly that, so the suite stayed green
while the surface still leaked to anyone with an account — a test written against the case you just
fixed cannot see the case you did not. **Flagged, NOT resolved (needs a human):** (a)
`dangerouslySetInnerHTML` on `event.description` is unreachable today (server-derived only, withheld
from non-parties, never persisted) but becomes stored XSS the moment an update write path lands, and
this repo has no sanitiser; (b) the 12-hour reschedule lockout sits INSIDE `PRODUCT_SPEC.md`'s
24-hour cancellation window, so between T-24h and T-12h rescheduling is a documented route around
the escrow-forfeit rule (also logged on #71); (c) `CommandPalette` is `role="dialog" aria-modal`
with `lockScroll` but claims the `popover` band (1100), and moving it to `modal` would change paint
order against Dialog/Drawer. | `DESIGN_SYSTEM.md` §C.1 · `ROUTING.md` · `PRODUCT_SPEC.md` §Sitemap ·
`PRODUCT_MANAGEMENT.md` §3.5 ·
`packages/ui/hooks/{overlay-registry,useDismiss,useFloating,useEdgeDetection}.ts` ·
`packages/ui/fields/{islands/{DatePicker,Select}.tsx,hooks/{useDismiss,useFloating}.ts}` ·
`packages/ui/calendar/**` · `packages/ui/layout/core/split-sizes.ts` ·
`packages/types/scheduling/{privacy,ics,sim,meeting,coordination}.ts` ·
`packages/backend/services/scheduling/**` · `apps/web/features/calendar/**` ·
`apps/web/routes/(dashboard)/calendar/**` · `apps/web/routes/api/scheduling/*` ·
`apps/web/features/projects/{components/NormalSessionPanel,islands/ProjectSidebar.island}.tsx` ·
Decisions #19 / #37 / #48 / #60 / #63 / #64 / #65 / #68 / #69 / #71 |

| 73 | **Calendar — playful palette, card stacking, avatars, adaptive bubbles, and the scrollbar's
edge-hold/momentum physics (2026-08-20).** A visual + interaction pass over the Canvas-based Week
grid and its DOM twins (Day/Month), executed directly against the engine (no app-side data wiring
required — every new capability is additive/optional on `CalendarEvent`). **(A) Palette.** A card's
identity now rides exactly three channels — fill, glyph, spoken label — down from four: the leading
BAR texture is retired, and `core/kinds.ts` gains `effectiveAccent(kind, status, masked)` (layers a
cross-cutting tentative/pending → `--warning` STATUS overlay, and a three-way status→hue map for
masked blocks, over the existing per-kind default) + `onAccentFor(token)` (derives `--on-<token>` by
the same naming convention `theme-engine.ts` already generates verified-AA/AAA pairs under, for
`--primary/secondary/tertiary/danger/warning/success/info` — no colour math of this engine's own).
`holiday` moved `--warning`→`--tertiary`; `busy` moved the neutral `--on-surface-variant`→`--danger`
("Busy/Conflicting" reads as an alarm colour on purpose). Card fills are now the accent at FULL
strength (was a 16% wash) with `--cal-accent-on` ink — verified in-browser: light ink on a dark fill
and dark ink on a light fill from the SAME palette, i.e. genuinely computed, never a fixed white.
Corner radius stepped `--radius-sm`→`--radius-lg` (6px→12px). The hourly grid lattice is decluttered
to day-boundary rules only (`paintGrid` skips non-boundary `scene.rules`); the DOM gutter's hour
LABELS are untouched. **(B) Stacking.** `core/layout.ts` `packDayEvents` rewritten: an overlap
cluster no longer fans into fractional side-by-side columns (`DaySlot.col/cols/span` and
`SceneEvent.offset/width` are gone) — every member renders at FULL column width, and only the
EARLIEST-starting (`stackDepth === 0`) is actually painted, behind up to two decorative shadow
silhouettes and a `+N` badge (`scene-paint.ts` `paintBadge`/the stack-shadow loop in `paintCard`;
`DayTimeline.tsx`'s `.cal-daycol__eventshadow`/`.cal-daycol__stackbadge` mirror it in DOM). A11y
parity is unconditional: every member still gets its own `SceneEvent`/`DaySlot` (`hitTest` and the
paint pass merely skip `stackDepth > 0`), so the Week canvas's existing accessible list and a NEW
visually-hidden `.cal-tg__a11y` block in `DayTimeline` keep every event independently reachable and
`eventAccessibleName` states the overlap in words. **(C) Avatars.** New `CalendarAttendee`
(`core/types.ts`) + `CalendarEvent.attendeeFaces` (photo-or-initials, host-first, the viewer's own
face expected pre-filtered by the CONSUMER); a new `core/avatar-cache.ts` resolves a photo
synchronously from a module-level cache and kicks off the load as a side effect, wiring
`watchAvatarLoads` into `useGridCanvas`'s existing invalidate-and-redraw path (the same mechanism
theme/DPR changes already use) so a photo finishing its load repaints with no frame otherwise
required. The face stack and the (still count-only, per `SceneEvent.sources`'s existing doc)
provider stack share ONE "overlapping circles, max 3, then `+N`" convention (`AVATAR_MAX`), placed
on the meta line's trailing edge for an ordinary card and promoted to a dedicated footer row only
when genuinely spacious — a fixed-row design was tried first and found NOT to fit a realistic
one-hour default card (48px @ 48px/hr leaves ~10px spare against a 20px avatar), caught by the
existing test suite rather than by inspection. **(D) Adaptive Bubble + proximity clustering (§Part
3).** Below `BUBBLE_MAX_H` (20px) a card collapses to a small trailing-edge pill (accent + glyph
only); a single forward pass in `paintEvents` merges consecutive bubble-eligible cards in the same
column within `BUBBLE_CLUSTER_GAP` into one larger pill carrying a count, rather than a wall of dots
— every merged event stays in the accessible list regardless. **(E) Scrollbar physics ("Figma-style
depth gauge", §Part 4).** `core/scene-build.ts` gains two pure, unit-tested formulas shared by BOTH
scrollbar implementations (the native `useOverlayScrollbar`, used by `DayTimeline`, and the inline
canvas drag gesture in `TimeGrid.tsx`'s `"bar"` gesture) so the two answer "how fast / how much" the
same way: `edgeHoldVelocity(overshootPx)` (quadratic ramp, saturating — a drag held past the track's
edge keeps scrolling, faster the further past it is, without an accidental few-px overshoot already
reading as a committed fast-scroll) and `pressuredLength(frozen, overshootPx)` (the pinned handle
shrinks toward a floor under sustained pressure, snapping back the instant pressure returns to zero
— no smoothing, per the header note on why nothing here may depend on an animation clock). A
CSS-only "ball" grip (`.cal-bar--dragging`, a `::before` circle) grows the handle on grab; the
canvas twin gets the same dot via `paintScrollbar`. **(F) Release momentum.** `useCanvasViewport`
(virtual/Week) and `useCalendarViewport` (native/Day) both gain a velocity-sampled fling on
pan-release (middle-mouse/Ctrl-drag/touch), decelerating via a shared `MOMENTUM_DECAY` per-frame
factor with `dt` CAPPED per tick (a hidden-tab `requestAnimationFrame` gap must not integrate a
stale velocity across the whole elapsed time in one jump — found and fixed during this pass, the
same class of bug `--dur-*`-driven CSS motion in this engine already guards against). A genuine
one-finger TOUCH drag on the native Day scroller already had free OS momentum
(`touch-action: pan-y`); only the synthetic middle/Ctrl-drag pan needed it added. **(G) Month
glide.** `MonthGrid`'s prior "deliberately un-animated" position (frozen-clock risk) is narrowed,
not reversed: the month's IDENTITY was never gated on a frame (`days` recomputes from `focusMs`
synchronously regardless), so a purely decorative directional slide-and-fade
(`.cal-month__page--glide`, keyed by month to force a fresh element) is layered on top, gated
exactly like `scrollBehaviorFor()` gates a programmatic smooth scroll — skipped outright under
`prefers-reduced-motion` OR `document.hidden` at the moment of the page change. **Verified:**
`deno
check`/`deno lint` clean across the package and its `apps/web` consumers; 97 unit tests (34
new, covering the two scrollbar-physics formulas directly since their LIVE rAF motion cannot be
observed by a static assertion); live in-browser on the guest-reachable `/view/[entity]/schedule`
surface (Week/Day/Month all render, theme switch re-resolves the palette live, zero horizontal
overflow under a forced `dir="rtl"`, no console errors across view switches, drag, and
theme/direction toggles). **Flagged (surface, do not silently resolve):** (a) real avatar PHOTOS
have no current producer — `attendeeFaces` is a new, currently-unpopulated optional field; the
initials fallback is what every existing fixture will show until a consumer wires real data through.
(b) overlap stacking is UNCONDITIONAL (any 2+ overlapping events stack, no side-by-side threshold) —
a deliberate literal reading of "do not render overlapping cards as squished slivers," not a
threshold tuned against real usage data. (c) `/[handle]/availability`'s full-page bypass has a
PRE-EXISTING zero-height bug (`.guest-shell__region` is `align-items: flex-start`, so `<main>` never
stretches to the region's height) — confirmed unrelated to this pass by cross-checking a sibling
guest calendar surface (`/view/[entity]/schedule`, same `GuestShell`) which renders correctly; not
fixed here (out of scope for a canvas/paint-engine pass). (d) the edge-hold/momentum rAF loops could
not be watched live in this session's preview pane (not composited/displayed, so
`requestAnimationFrame` never fires there — a harness limitation this repo's own memory already
documents) — correctness rests on the direct drag-to-position mapping working live (verified) plus
the pure formulas' unit tests, not on watching the animation itself play. (e)
`CALENDAR_KIND_BAR`/`CalendarKindBar` are removed from the package's public barrel — a breaking
change to `@projective/ui/calendar`'s exported surface, though no `apps/web` consumer referenced
either. |
`packages/ui/calendar/core/{kinds,types,layout,
grid-paint,scene-build,scene-paint,avatar-cache}.ts`
·
`packages/ui/calendar/hooks/{useCalendarViewport,useCanvasViewport,useOverlayScrollbar,
useGridCanvas}.ts`
·
`packages/ui/calendar/components/{EventBlock,DayTimeline,MonthGrid,GridProbe,OverlayScrollbar}.tsx`
· `packages/ui/calendar/styles/calendar.css` · `packages/ui/calendar/mod.ts` ·
`packages/ui/calendar/core/{scene-build_test,scene-paint_test}.ts` · `.claude/launch.json` ·
Decisions #1 / #37 / #48 / #62 / #63 / #64 / #71 / #72 |

| 74 | **Discovery card family rebuilt — ambient hover, split badge corners, one profile card, and
the Project row→card conversion (2026-08-21).** The four item cards shared by `/explore` and every
Profile tab were rebuilt against a supplied visual spec, and the marketing landing twins came with
them so the product keeps ONE card system. **(A) Ambient hover, with real pixels.** `.ex-card` is
now transparent at rest — no fill, no border, no shadow — because its media already draws a hard
edge and the old tonal fill measured 1.13:1 against the page for its trouble (§B.4: one device). On
hover the card warms toward the dominant colour OF ITS OWN THUMBNAIL plus a matching glow. Two
layers resolve that: the deterministic `--ex-accent` token painted at SSR, and the real extracted
`r g b` written by a new `AmbientPalette` island and switched in by `[data-ambient="on"]`. Both
funnel into `--ex-wash`/`--ex-glow` so the hover rule never branches; `--ex-ambient` cannot take a
`var()` fallback (a fallback colour and a channel triplet are not the same grammar), which is why
the switch is an attribute selector. **ONE island for the whole page**, not one per card: the cards
stay server components and the island finds them by attribute (the `CardStyleAnchor` shape).
Extraction only ever UPGRADES a card that is already finished — no-JS, a CORS refusal, a decode
failure and a 404 all keep the token wash. It reads a separate off-DOM `Image()` in CORS mode, never
the rendered `<img>`, so a host without `Access-Control-Allow-Origin` loses the swatch rather than
the thumbnail. **The weighting is absolute chroma biased to mid-tones, NOT relative saturation** —
`(max-min)/max` scores `rgb(0,10,20)` a perfect 1.0, so shadow detail with a faint cast wins every
vote; measured against this corpus it returned near-black for 7 of the first 8 thumbnails. The
winner is then clamped into a usable lightness/saturation band with its HUE untouched, because a
dark tint at 12% over a dark surface is invisible and the hover would silently do nothing on exactly
the moodiest cards. **(B) Two corners, two meanings.** A signal the entity EARNED and a placement it
BOUGHT never share a stack: derived trust chips (`Top rated` / `Fast replies` / `Available now`) are
pills top-LEFT on the solid `--ex-chip-on-media` label surface; the sponsorship disclosure is a
circular blurred-glass "AD" token top-RIGHT. The hover actions cluster steps aside for it via
`:has()` — the disclosure is owed to the reader at rest and must not be displaced by a transient
control. **(C) One profile card.** `FreelancerCard` + `ProfileBannerCard` are DELETED and replaced
by `ProfileCard`, used by all four profile entities: masked cover, a large avatar centred on the
seam overlapping it 50%, centred name/`@handle`, then a left-aligned 2-line headline, a
`location • languages` line, and a foot splitting the rating from stacked metrics. The pair rendered
the same seller two ways depending on which section surfaced them, which is the opposite of a card's
job. **(D) Service/Product anatomy** reordered to creator row → title → classification chip (+
right-aligned secondary) → rating-left / price-right; the creator row prints the seller's NAME, not
their handle, and the type chip and the product price both moved OFF the media, where they had to
survive arbitrary photography. **(E) `ProjectRow` → `ProjectCard`**, a bordered card in a fixed
TWO-COLUMN `.ex-projgrid` everywhere (never auto-fit, never one column) — reverses Decision #41's
"never a boxed card" rule. Projects are deliberately EXEMPT from the ambient system and carry no
badges: with no media there is no colour to extract, and trust/sponsorship belong to things being
sold, not to a brief being staffed. **Additive Zod SSOT** (`ProfileItemSchema.location`,
`.responseMinutes`) — a read projection over fixtures like Decision #12, so **no DB migration**. No
new `@projective/ui` primitive → **no `DESIGN_SYSTEM.md` §C.1 change**; no lifecycle change → no
`PRODUCT_MANAGEMENT.md` change; no new simulatable axis a surface branches on → nothing to mirror in
the Dev Context Switcher (§5). **Five defects found by measurement, not inspection:** (1) the AD
token's white text over a BLOWN-OUT WHITE photo measured **2.68:1** at its first glass opacity — the
worst case is the image, not the theme, and a `text-shadow` changes the impression of contrast
without changing the contrast (now 6.19:1 at 0.62); (2) `--success` as chip ink measured 8.44:1 in
dark and **3.17:1 in light**, so the label now mixes the accent toward `--on-surface`, which is
self-correcting because that token is near-white in dark and near-black in light — the DOT keeps the
pure accent, being fully redundant with the word beside it; (3) at 375px the absolute two-column
rule leaves a project card ~167px and the `nowrap` timestamp won the whole header row, crushing the
publisher's name to a measured **0px** — present in the DOM, invisible on screen — fixed with a
CONTAINER query, since a viewport media query would be reading a box more than twice the size of the
one actually too narrow; (4) `.ex-pricebadge` was `nowrap` and a Pipeline range in a converted
currency renders `From £94.49 – £377.95 (~US$480.00 USD) / ticket` — one unbreakable 312px run that
escaped a 161px card entirely; the badge now wraps at its spaces while each FIGURE stays atomic, and
the foot's existing `flex-wrap` had been doing nothing because the overflow was one atomic child
rather than the row; (5) the first swatch pass shipped the relative- saturation bug in (A).
**Verified in-browser** on `/explore` Home, `/explore?category=projects`, `/@handle/services` and
`/@handle/projects`: 36 cards across five modifiers, zero legacy classes remaining, 2-per-row across
all 9 project rows, avatar overlap 50%, media 16:10 at 12px radius, product frame capped at 288px,
badge corners correct in LTR **and** mirrored under `dir="rtl"` with zero horizontal overflow either
direction, light + dark both clean (worst measured text 8.06:1, worst chip 5.97:1, AD 6.19:1), 375px
reflow with nothing clipped inside any card, `deno task test` 284 passed (9 new, pinning the
derivation rules — each is a CLAIM the product makes, and the failure mode is a confident wrong
statement rather than a broken layout). **Flagged (surface, do not silently resolve):** (a) the
brief's "Recently Viewed" secondary chip needs per-viewer browsing history the discovery corpus does
not carry, so that slot holds the real turnaround instead — no fabricated signal; (b)
**two-column-on-mobile is the brief's explicit instruction and it costs real legibility** — a 167px
card at 375px is tight even after the container-query reflow, and one column would read better on a
phone; the rule was followed literally and the card was made to survive it, but the trade-off is the
product owner's to confirm; (c) two Unsplash fixture URLs 404 and so keep the token fallback — a
pre-existing dead-URL problem, correctly degrading; (d) `storage-keys.ts`
`THEME_PREFERENCE: "pj.local.theme"` is read by NOTHING — `packages/ui/system/core/context.ts`
writes plain `"theme"` — an unrelated inconsistency found while testing themes; (e) the
`--on-primary` on `--primary` 3.57:1 dark pairing flagged by Decisions #64/#65 is still routed
around, not fixed at the token layer: **no chip in this family tints with `--primary`**, which is a
deliberate constraint and not an aesthetic preference. | `DESIGN_SYSTEM.md` §B.4/§B.6 ·
`packages/types/explore/items.ts` · `packages/backend/services/explore/fixtures.ts` ·
`apps/web/features/explore/{components/cards/{ProfileCard,ServiceCard,ProductCard,ProjectCard,EntityCard},
components/{StatusChip,PromotedBadge,OwnerBadge},components/collections/{ProfileGrid,ProjectsList},
core/{card-signals,card-signals_test},islands/{AmbientPalette,SearchDashboard},styles/explore.css}`
· `apps/web/features/profile/components/ProfileTabContent.tsx` ·
`apps/web/features/marketing/components/{ProfileCard,ServiceCard,ProductCard,ProjectCard}.tsx` ·
`deno.json` · Decisions #3 / #12 / #39 / #41 / #45 / #62 / #64 / #69 |

| 75 | **Calendar physics — cursor-anchored zoom, the lever scrollbar, the placement engine, the pin, and the HTML popover layer (2026-08-21).** The Canvas engine's interaction layer, rebuilt against a supplied brief. **(A) THE PLACEMENT ENGINE.** `core/layout.ts` grew from a 78-line stack sweep into a containment forest: `solo`/`nested`/`split`/`folded`, resolving overlap VERTICALLY first because a column is a time axis and width is the one cue that must not be spent on a fact unrelated to width. A properly-contained event is drawn INSIDE its parent at nearly full width (`--cal-nest-inset`); a plain straddle STACKS under a `+N` chip; side-by-side lanes are the EXPLICIT fallback for a nest the pixels cannot hold (`NEST_HEADER_PX` — the child must clear its parent's only label) or for a cluster the reader has unfolded. **A zero-duration event is a DEADLINE and now survives as an INSTANT** — the old filter dropped it outright — drawn as a pin (rule + kind chip + timestamp pill), never a box, and never given a synthetic duration; the SSOT contradiction that made this unexercisable is resolved in the same change (`packages/types/scheduling` said `end > start` while the engine had always documented `end === start`; the deadline fixtures now emit true instants, milestones keep their span, and `ck_event_span` was relaxed to `>=` so a persisted deadline is not refused by the DB). **(B) THE LEVER.** `core/chrome.ts` — the module `grid-paint.ts` already NAMED and nobody had written — makes both scrollbars RATE controls: pressing the handle morphs the pill into a circular ball and dragging scrolls at a velocity proportional to displacement from the GRAB ORIGIN, which is what lets the gesture outlast a finite track on an effectively infinite axis. Edge-hold is subsumed (`edgeHoldVelocity` now delegates, so one ramp answers "how fast"), `pressuredLength` is retired with the edge-pin it served, and the handle's LENGTH becomes the share of one PERIOD visible at the live zoom — the denominator changes, not the idea, because `viewport / content` over nineteen years is a hair nobody can grab. **(C) CURSOR-ANCHORED ZOOM.** `zoomAnchor(viewportY)` pins the timestamp under the pointer; `zoomTo` interpolates through it with `SPRING_STANDARD`, re-solving the offset in CLOSED FORM each frame so the fixed point holds for the whole journey rather than only its endpoints. Verified by measurement: anchored at the top edge the range narrowed from 8:00–16:00 to 8:00–15:00 with the top unmoved, and anchored at the bottom the bottom held instead. A threshold crossing now calls `onViewChange` — it wrote `view.value` directly before, so on `/calendar`, which renders `hideHeader` and owns the segmented control in two OTHER hydration roots, the grid showed Day while the control and the period label still said Week. **(D) THE HTML POPOVER LAYER** (`EventPopoverLayer`) — single event, a two-step stack list → detail flow, and a drag-to-create composer that TRACKS the live selection — `BodyPortal`'d past the canvas, the lane's `overflow: clip` and the glass re-base, positioned by `useFloating`. A canvas rect is not a DOM element, so the anchor is a zero-size PORTALLED proxy while ownership is tethered by a second INLINE one: `overlay-registry` derives parentage from where a TRIGGER sits, and with one portalled proxy a parent dialog reads a click inside this popover as an outside click and closes. **(E) Month** gains continuous threshold-based scrolling (a three-page track translated by `transform` only, committing SYNCHRONOUSLY at the threshold so the month's identity never depends on a frame) and a "Now" pill, defined for a paginated view as paging to the month containing today. **(F) The card** anchors top-left with generous padding, OMITS a metadata item whole rather than ellipsising it (the title still degrades gracefully — a card with no title is an unlabelled box), keeps a strict 1px gap taken inside `eventRect` so paint and hit-test cannot disagree, expands DOWNWARD on hover with a lift and an ambient shadow from the four `lift*` palette entries that were resolved but read by nothing, and steps its stack silhouettes straight down with no horizontal offset. **THIRTEEN DEFECTS, TWELVE FOUND BY MEASUREMENT RATHER THAN INSPECTION AND THE THIRTEENTH BY THE PRODUCT OWNER, EACH OF WHICH WOULD HAVE SHIPPED:** (1) a TDZ `ReferenceError` — a signal effect reaching the `canvas` const during a partial re-render — took the whole island down; (2) **`createSpring` never resolved when rAF EXISTS and never fires** (`document.hidden` false, `visibilityState` "visible", zero callbacks in 16.7s — a fully occluded window, some remote displays, and this repo's preview pane), so every spring in the product could strand: closed with a timer watchdog, since `setTimeout` fires where rAF does not; (3) **`.cal` lost its layout box when `calendar.css` was split into sheets** — only its tokens moved — so `.cal__main` sized to content at 2,630,960px and the Day view had no bounded scroller and therefore no scrollbar; (4) `zonedParts`/`zonedTimeToMs` threw `RangeError` inside a RENDER BODY, removing the component and every child under it — now total, because a clamped date at the edge of time is visible and findable while a throw shows nothing at all; (5) the day window clamped only ONE side of each index; (6) the zoom anchor was re-derived mid-gesture against a `scrollTop` not yet re-pinned for the new scale, and the error compounded — a six-notch trackpad burst walked the viewport twenty-five weeks off target; (7) that same burst then collapsed to a SINGLE notch, because each notch read a `pxPerHour` the spring had not moved yet; (8) `durationLabel` printed **"0 min"** for a deadline at four call sites; (9) keyboard activation bypassed the popover entirely, so the accessible layer had become a second, quieter product; (10) **every anchored panel in the product mirrors to the wrong side under `dir="rtl"`** — `--float-left` is a physical `getBoundingClientRect` number and ten sheets fed it to `inset-inline-start`; (11) `--cal-pop-*` was scoped to `.cal`, which a body-portalled panel is not a descendant of — the `--wlt-*` trap of Decision #60, closed by lifting the whole token block to `:root`; (12) `.cal-pop__event--masked` was a class hook with no rule; (13) **INTRODUCED BY THIS PASS AND CAUGHT BY THE PRODUCT OWNER, NOT BY ME** — lifting the calendar token block to `:root` (the correct fix for (11)) carried the engine’s LAYOUT declarations up with it, and `:root` IS `<html>`: the document became `display: flex; overflow: hidden`, which made `<body>` a shrink-to-fit flex ITEM. The entire shell, top bar included, then stopped at its content width — and because a canvas has an intrinsic width of 300px, the calendar pages collapsed hardest. Measured at 1600px viewport: `body` 1440. The lesson is the same one (11) taught from the other side: `:root` is a shared, global selector, so a block moved there must be audited declaration by declaration, not moved wholesale. The `:root` block now holds custom properties and nothing else, with the trap written into its own doc comment, and `.cal` carries the box. **NOT VERIFIED IN THIS ENVIRONMENT, and stated rather than claimed:** anything needing a composited frame — the lever's live rate-scrolling, the morph, the hover expansion's motion, the month spring-back, and drag-to-create tracking. The preview pane reports `visible` and composites nothing, so screenshots time out and real pointer input is unavailable; the pure physics is pinned by unit test instead (`chrome_test.ts`, `layout_test.ts`, `day-window_test.ts` — 385 green). **FLAGGED, NOT SILENTLY RESOLVED:** (a) the exit spring `{300, 18}` is ζ 0.520 and **BOUNCES**, which §B.5 and root §3 gate #4 forbid — it ships at the product owner's explicit request as `SPRING_EXPRESSIVE_EXIT`, declared once, scoped to one decorative exit, with `requireOverDamped: false` as the single greppable opt-out; (b) a rate control **cannot be dragged to an absolute depth** — inherent to the brief and paid for by the mini-map, the period trail and the present pill, but it is a real loss; (c) **pinch-to-zoom is implemented but ships OFF** (`enablePinchZoom`, default `false`): turning it on requires `touch-action: none` on the grid and reverses a logged WCAG 1.4.4 decision that two-finger gestures belong to the browser, which needs a human; (d) `/[handle]/availability`'s zero-height guest-shell bug (Decision #73(c)) is FIXED, in two halves that failed for different reasons. On DESKTOP `.guest-shell__region` carried `align-items: flex-start`, which the aside never needed — it already opts out with its own `align-self: flex-start` AND carries an explicit `block-size` — so the only item that rule ever governed was the BODY, which it stopped from stretching; a surface whose `block-size: 100%` chain then had nothing to resolve against rendered at ZERO height. On MOBILE the desktop rules sit inside `@media (min-width: 768px)`, so the body fell back to auto height — and even once it filled, `100%` still computed to `0`, because a MAIN-axis flex item's size is treated as indefinite for percentage resolution where a cross-axis stretch is not. The mobile body is therefore a flex COLUMN, which hands the surface the remainder through the `flex: 1 1 0` its base rule already carries — the dashboard's own mechanism, and no percentage at all. `.cal-surface--full` also gained the `block-size: 100%` it had never had: it was a class hook with no rule, relying on a `flex` that is inert inside a block parent. Verified at 1600 / 768 / 375, LTR + RTL: `.cal` measures 800 / 600 / 724px where it measured 0, the canvas paints, 19 accessible cards are present, zero horizontal overflow either direction — and the other three guest lane routes (`/@handle`, `/explore?category=`, `/view/[id]`) are unchanged at both widths, with the aside still sticky, still bounded by the region, and the footer still flush against it; (e) `Element.l` shows Preact's handlers bound to the DOM lever handle, yet a synthetic `pointerdown` does not reach them in this pane — unresolved, and indistinguishable here from the same compositing limitation. | `DESIGN_SYSTEM.md` §B.5 / §C.1 · `packages/ui/core/motion.ts` (+ `SPRING_EXPRESSIVE_EXIT`, the frame watchdog) · `packages/ui/calendar/core/{layout,chrome,scene-build,scene-paint,time}.ts` · `packages/ui/calendar/components/{TimeGrid,DayTimeline,MonthGrid,EventPopoverLayer,OverlayScrollbar,EventBlock}.tsx` · `packages/ui/calendar/hooks/{useCanvasViewport,useCalendarViewport,useOverlayScrollbar}.ts` · `packages/ui/calendar/islands/Calendar.tsx` · `packages/ui/calendar/styles/{shell,popover,motion,event,month,chrome,grid}.css` · `packages/ui/styles/index.css` + 9 anchored-panel sheets (the RTL fix) · `packages/types/scheduling/scheduling.ts` · `packages/backend/services/scheduling/calendar-fixtures.ts` · `apps/web/features/calendar/**` · `supabase/migrations/00000022_tables_scheduling.sql` · Decisions #37 / #60 / #62 / #71 / #72 / #73 |
