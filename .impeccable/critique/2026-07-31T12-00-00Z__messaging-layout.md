> **STATUS: all 20 ranked fixes applied and verified (2026-07-31).** See
> [Outcome](#outcome--what-shipped) at the end of this file, and CLAUDE.md §8 Decision #63. The
> findings below are preserved as written — they are the evidence the fixes were built against, not
> a description of the current code.

# Messaging Layout Audit — `/messages` · `/messages/[conversationId]` · Pop-Out Chat

Date: 2026-07-31 · Scope: `apps/web/routes/(dashboard)/messages/**`,
`apps/web/features/messaging/**` (`messages.css` · `conversation.css` · `chat-popout.css`).
Method: source read + **measured in-browser** at 1440 / 768 / 390, LTR and RTL, dark theme, with
`/wallet` and `/projects` measured as sibling controls.
Mechanical detector (`detect.mjs --scope layout`): **clean, 0 findings** — validated against a
fabricated dirty stylesheet that did emit. Every issue below is structural, not raw-value drift.

> **Environment caveat, stated once.** The preview pane runs hidden (`document.hidden === true`), so
> `requestAnimationFrame` never fires and the CDN images 404. Two things that look like defects are
> therefore **not reported as defects**: the pop-out opening at `scrollTop: 0`, and `.msg-media`
> collapsing to 3px. Both are noted in their sections with what *is* provably wrong about them.

---

## THE HEADLINE: the inbox inverts the region contract

`/wallet` is the reference implementation: **the lane is an accelerator, the body is the surface.**
Measured at 390px, `/wallet` loses its lane and keeps a 3435px functioning body plus both bands.

`/messages` is built the other way round. The lane **is** the surface — search, filters, partitions,
the entire conversation list, and both primary actions all live in it — and the body is a
placeholder.

| Region | `/wallet` @1440 | `/messages` @1440 |
|---|---|---|
| Lane | navigation + scope | **search · filters · partitions · all data · both CTAs** |
| Header band | identity + range + currency | **absent** (`conversation-header-slot.tsx:20` returns `null`) |
| Footer band | every money action + density | **absent** (`conversation-footer-slot.tsx:27` returns `null`) |
| Body | the surface, 3435px of data | 1096×852 holding a glyph, an `h1`, and a sentence |

The proportions are the argument:

- The body canvas is **1096×852 — 80% of the content region** — and contains three static elements
  and zero data.
- The conversation row is **234px wide — 17%** of that region.
- The message preview, the single thing a person scans an inbox for, gets **114px — 8.3%** of the
  content region, and clips at **47% of its natural width** (`scrollWidth` 240 → box 114).

Every other finding in this report is downstream of that one inversion. It is also why the surface
dies on mobile: when the shell removes the lane at 767px, `/messages` has nothing left.

---

## 1. Hierarchy verdict

**Squint at `/messages` and the eye lands on the empty state first.** It is the largest element, the
only 20px/700 type on screen, dead-centre in the widest region, and the only thing carrying a
64px tonal glyph. It wins the composition — and it is the one element on the page that contains no
information.

Second is the lane's tinted head band. Third — genuinely third — is the conversation list.

**The single most important element is the conversation list. It does not win. It comes third, in
17% of the width, with its text channel clipped to under half.**

The ordering is exactly inverted. A placeholder outranks the data; the chrome that filters the data
outranks the data. Restated as a reading path: the composition tells you to look at a sentence that
tells you to look somewhere else.

`/messages/[conversationId]` recovers. The eye lands on the message column (1049px, high contrast,
bottom-anchored), then the identity block, then the composer. That order is correct and the detail
view is broadly well-composed — its problems are alignment and states, not hierarchy.

---

## 2. Region-misplacement table

Judged against the `/wallet` contract: **LANE** = navigation and scope · **HEADER BAND** = identity
and global controls · **FOOTER BAND** = actions and density · **BODY** = viewing and selecting data
only.

### `/messages` (root) — 8 misplacements

| # | Control | Currently in | Contract says | Evidence |
|---|---|---|---|---|
| 1 | **The conversation list** (the data) | LANE | **BODY** | `MessagesSidebar.island.tsx:377-399` |
| 2 | **The BODY** | a static prompt | the data | `MessagesEmptyState.tsx:11-20` |
| 3 | Conversation search | LANE head | HEADER BAND | `MessagesSidebar.island.tsx:314-320` |
| 4 | Advanced filter popover (6 facets) | LANE head | HEADER BAND | `:322-360` |
| 5 | Partition toggles (All · Starred · Archived) | LANE head | HEADER BAND (scope) | `:363-367` + `:93-97` |
| 6 | Quick filters (Unread · Starred) | LANE head | FOOTER BAND (density) | `:368-373` + `:100-103` |
| 7 | **New message** — the primary CTA | LANE footer, 34px icon-only | FOOTER BAND **and** a real button in the body empty state | `:414-420` |
| 8 | Message settings | LANE footer | FOOTER BAND | `:408-413` |
| — | HEADER BAND | **does not exist** | identity + global controls | `conversation-header-slot.tsx:20` |
| — | FOOTER BAND | **does not exist** | actions + density | `conversation-footer-slot.tsx:27` |

Item 7 is the sharpest. The body says *"start a new message"* in prose; the affordance it refers to
is a 34×34 unlabelled icon **1,100px away** in the opposite corner of the screen. The instruction and
the control are as far apart as the layout physically permits.

### `/messages/[conversationId]` — compliant, 1 borderline

| Control | Region | Verdict |
|---|---|---|
| Identity (avatar · title · `@handle`) | HEADER BAND | ✅ correct |
| Tabs (Chat · Files · Members) | HEADER BAND | ✅ correct — the contract bans tabs in the *body*, and these are not in it |
| Star · Pop-out · kebab | HEADER BAND | ✅ correct |
| Composer | FOOTER BAND | ✅ correct (`conversation-footer-slot.tsx:38`) |
| Files-tab zoom rig | FOOTER BAND | ✅ correct (`:35`) |
| Message stream | BODY | ✅ correct |
| Pinned-message banner | BODY, sticky | ⚠️ a thread-global control living in the data region; belongs in the header band beside the identity |

**The detail view honours the contract; the index inverts it.** That split is the finding.

---

## 3. Spatial rhythm

**Proximity is not doing the grouping work, and the compensating device is not a border — it is a
tonal band that measures as a no-op.**

Measured: `.ui-lane-head` background `rgb(25,28,29)` against the list backdrop `rgb(29,32,33)` is a
**1.05:1 luminance ratio** — invisible. The head is also *darker* than the content it sits above, so
the "elevated" band optically recedes. Both head and footer additionally paint a 1px hairline
(`--hairline`), which is doing 100% of the separation. Per §B.4's ladder (spacing → tint → weight →
single hairline) the tint step contributes nothing measurable and should either earn its keep or go.

**The spacing scale is monotone.** Across all three sheets, 81 atomic `--space-*` uses:

| Step | Value | Count | Share |
|---|---|---|---|
| `--space-2` | 0.5rem | 33 | **40.7%** |
| `--space-1` | 0.25rem | 23 | **28.4%** |
| `--space-3` | 0.75rem | 15 | **18.5%** |
| `--space-4` | 1rem | 6 | 7.4% |
| `--space-5` | 1.5rem | 3 | 3.7% |
| `--space-6` | 2rem | 1 | 1.2% |
| `--space-7` / `--space-8` | 3rem / 4rem | **0** | 0% |

**87.7% of all spacing sits in three adjacent steps spanning 0.25–0.75rem.** There is no generous
interval anywhere in the surface, so there is no contrast to read grouping from — which is precisely
why the head band needs a tint *and* a hairline to be seen at all. Fix the rhythm and the
compensating chrome becomes unnecessary.

Band padding is internally inconsistent too: head `16px 16px 12px`, list `12px 16px 24px`, footer
`12px 16px` — three different vertical rhythms in a 276px column.

---

## 4. Density

Density is **not consistent with itself**, let alone with siblings. Five control heights in one
276px lane:

| Control | Height | file:line |
|---|---|---|
| `.ui-lane-search` | 38px | lane chrome |
| `.ui-lane-iconbtn` | 34px | lane chrome |
| `.ui-lane-collapse` | 32px | lane chrome |
| `.msg-conv__kebab` | 28px | `messages.css:175-176` |
| `.ui-lane-toggle` | 27px | lane chrome |

Type sizing is the same story — **33 font-size declarations, zero use of `--text-*`**, including
three sizes that exist nowhere in the token system: `0.9rem` (`messages.css:130`, the conversation
name — the most-repeated string on the surface), `0.95rem` (`:604`), `1.25rem` (`:844`). A size that
is off-ramp cannot align with any sibling surface by construction.

Compare `chat-popout.css`, written later: fully migrated to `--text-xs` / `--text-md` /
`--fw-semibold` / `--icon-xs` / `--icon-md`. **The newest file in the surface speaks the current
vocabulary; the largest file still speaks the pre-token one.**

For the task itself: an inbox is a scanning surface and should be *denser* than it is in the vertical
axis and far wider in the horizontal. Right now it is cramped in the wrong dimension.

---

## 5. Scannability

**No — a user cannot reliably find one row in under three seconds, and the reason is measurable.**

The 234px row spends its width like this:

```
8 pad │ 40 avatar │ 12 gap │ ◄── 130 body ──► │ 8 pad │ 4 │ 28 kebab │ 4
                              name+time / preview+dot
```

- **The kebab reserves 32px permanently** (`messages.css:170-177`) for a control that is
  `opacity: 0` until hover — 14% of the row, always, for something invisible 95% of the time.
- **The unread dot reserves a further 16px** inside the body (`:163-169`).
- Net text channel: **114px**, showing **47%** of the preview (`scrollWidth` 240) and truncating
  names as short as "Northwind Studio".

Measured previews at 1440px read: `"You: Final dire…"`, `"Theo: Can you s…"`, `"Omar: Hi! Intere…"`.
Three of the five visible previews begin with `"You: "` or a name prefix, so **the first ~40% of the
visible characters is a speaker label, not content.** The effective information channel is roughly
eight characters.

Aggravating factors: eleven of thirteen rows carry an identical 8px primary dot, so the unread
channel does not discriminate; and every row is the same 62px with no date grouping, so there is no
vertical landmark to scan against.

The fix is not typographic. It is the region inversion — the list belongs in the 1096px body, where
a preview can breathe and a second metadata column becomes affordable.

---

## 6. Empty · loading · error · partial states

**Empty is designed. Loading is invisible. Error does not exist.**

**Empty — good, with one gap.** Four designed empties, and the lane's note is genuinely
context-aware, branching across archived / starred / filtered / virgin
(`MessagesSidebar.island.tsx:291-297`). Credit where due.
The gap: **the body empty state teaches nothing it can act on.** `MessagesEmptyState.tsx:11-20`
renders a glyph, a title and a sentence — **and no control.** An empty state should teach the next
action; this one narrates it and points off-screen.

**Loading — present in code, absent on screen.** `MessagesSidebar.island.tsx:377` passes
`busy={loading.value}` to `LaneList`; `LaneChrome.tsx:56` turns that into `aria-busy="true"` and
nothing else — `lane.css` has **zero** rules matching `aria-busy`. Search, filter and role-switch
refetches are therefore silent to a sighted user. Pop-out pagination has no pending state either
(`PopoutChat.tsx:81-93`), so "Load earlier" can be re-fired mid-flight.

**Error — six silent failures.** The transport layer is careful (`api.ts:21-23,42` returns soft
`{ok:false, message}` and never throws) and then **every single caller discards the message**:

| Failure | What the user sees | file:line |
|---|---|---|
| Conversation list refetch fails | stale list, no signal | `MessagesSidebar.island.tsx:149` (no `else`) |
| Contacts fetch fails | *"No matching contacts."* — indistinguishable from empty | `ContactPicker.tsx:40-42` |
| Pop-out message fetch fails | *"No messages yet. Say hello 👋"* on a network error | `PopoutChat.tsx:70-79` |
| Create conversation fails | modal closes, nothing happens | `NewConversationModal.tsx:27-28` |
| Save settings fails | modal closes, result never read | `MessageSettingsModal.tsx:83` (`void`, un-awaited) |
| Conversation not found on **Files** tab | renders `FilesView` with a null projection | `[conversationId]/files.tsx:15-24` — **no guard**, while `index.tsx:17` and `members.tsx:17` both have one |

Three of these actively lie: a failed fetch renders as an empty result. That is worse than an error,
because it teaches the user their inbox is empty.

**Partial — two real gaps.** `hasMore`/`nextCursor` are resolved server-side
(`conversations-ssr.ts:33`) and **never read by the lane** — no infinite scroll, no "load more", no
count. A truncated inbox is silently truncated. And `ContactPicker.tsx:79-96` renders every selected
chip unwindowed with no cap and no `+N`, so a 50-member group unrolls the dialog.

Text overflow is handled on exactly two selectors (`messages.css:133-135, 156-158`) and nowhere else
— `.msg-picker__row-name`, `.msg-picker__chip-name`, `.msg-set__row-label` will all push their rows.

**On `.msg-media` collapsing to 3px** (`msg-media__cell` at `flex-basis: 0`, `width: 0`, no
`aspect-ratio`): in this environment the images 404, so I cannot call the collapse a live defect.
What *is* provably true from source is that the cell reserves no intrinsic box, so its height comes
only from the loaded image — meaning a slow load shifts the feed and a failed load leaves a message
with no visible content. That is an undesigned partial state regardless of network. (Owned by
`projects/styles/chat-feed.css`; inherited, not authored here.)

---

## 7. Responsive

**There is exactly one `@media` block in the entire surface, and it is `prefers-reduced-motion`**
(`messages.css:856-863`) — which is itself redundant, since `--dur-fast` is already globally zeroed
under reduced motion (`packages/ui/styles/index.css:909`). **Zero width breakpoints in 989 lines of
CSS.**

| Viewport | Result |
|---|---|
| **1440 desktop** | Works. Lane 280 fixed, body 1096. Zero horizontal overflow. |
| **768 tablet** | Degrades silently. Lane stays **280px fixed** while the body compresses 1096 → 424. The lane now consumes **40%** of the content region for 17% of the value, and the preview still clips at 47% — the same 114px, because nothing adapts. |
| **390 mobile** | **The surface is dead.** |

At ≤767px, `packages/ui/navigation/styles/middle-nav.css:168` sets
`.ui-middle-nav__lane { display: none }`. `MessagesSidebar` mounts **only** into that lane. Measured
at 390px, every one of these returns `0×0`:

conversation list · search · filter popover and all six facets · all five partition/quick toggles ·
every per-row kebab (Favourite · Archive · Delete) · the collapse toggle · **Message settings** ·
**New message**.

What remains on screen is `MessagesEmptyState`, reading *"Select a conversation from the list, or
start a new message"* — **while both the list and the new-message control are `display: none`.**
The mobile bottom nav (Home · Explore · Create · Workspace · Dashboard) has no Messages entry
either, so there is no second route in.

The collapsed `MessagesRail` is **not** a fallback: it is revealed by
`.ui-splitter[data-mode="collapsed"]` (`messages.css:28-30`), a density state of the very element the
767px rule removes.

**Context, stated fairly:** `/projects` fails identically ("Pick a project from the list on the
left", no list) — this is a shell-wide gap, not a messaging invention. But `/wallet` proves it is
solvable within the same shell: it keeps a full body and both bands at 390px. Messaging is on the
wrong side of a line its sibling already crossed.

---

## 8. RTL — **pass, cleanly**

Measured by flipping `documentElement.dir` and re-reading every box:

| Element | LTR (L..R) | RTL (L..R) |
|---|---|---|
| Lane | 64..344 | 1081..1361 |
| Row avatar | 88..128 | 1297..1337 |
| Row kebab | 282..310 | 1115..1143 |
| Unread dot | 262..270 | 1155..1163 |
| Header actions | 975..1409 | 16..451 |
| Header tabs | 807..963 | 463..619 |
| Own message bubble | 1236..1405 | 20..189 |

**Horizontal overflow: 0px in both directions.** Corroborated at source: zero physical properties
across all three sheets — no `left`/`right`, no `margin-left/right`, no `text-align: left|right`, no
`translateX`, no `overflow-x`, and consequently **no `[dir="rtl"]` guards needed**. The one `inset`
shorthand (`chat-popout.css:82`) is uniform on four edges and direction-agnostic.

This is the strongest part of the surface and should be left alone.

---

## 9. Anti-patterns

**Competing/duplicated primary actions — the clearest one.** `Starred` is rendered **twice in the
same 244px row**, with the **same glyph and the same label**, doing different things:

```
MessagesSidebar.island.tsx:95   { key: "starred", label: "Starred", icon: <MessagingIcon name="star" /> }  // partition
MessagesSidebar.island.tsx:102  { key: "starred", label: "Starred", icon: <MessagingIcon name="star" /> }  // quick filter
```

Measured 160px apart. One partitions (`starred && !archived`), one ANDs onto the current partition —
and setting both is a no-op. They also have different latencies: `unread` refetches from the server
(`:272-275`), `starred` is a client overlay (`:277`), so two visually identical toggles respond on
different timescales.

**Colour as sole meaning carrier — provable.** For `.msg-matrix__opt` (`messages.css:394-398`),
measured against the real popover backdrop `rgb(16,20,20)`:

| | off | on |
|---|---|---|
| chip background luminance | 0.01400 | 0.01429 |
| font-weight | 400 | 400 |
| shape / mark | — | — |
| **label contrast on its own chip** | **7.14:1** | **4.36:1** |

The two states differ by a **1.003:1 luminance ratio** — under greyscale or a CVD overlay they are
the same chip. Worse, **selecting a facet drops its label contrast from 7.14:1 to 4.36:1**, below the
4.5:1 AA floor at 13px. Selection currently costs legibility and carries no non-hue channel. Same
pattern at `.msg-ar__trigger` (`:748-752`).

(The conversation row does this correctly — `messages.css:68-76` adds a 3px leading bar precisely so
active isn't hue-only, and documents why at `:61-67`. The filter chips should copy it.)

**Nested containers — eight chains, worst is three deep.** The auto-response editor tints *down* to
`--surface-2` and then its children tint *back up* to `--surface-1` and add a full border:

```
.ui-dialog__panel        surface + border + radius + shadow   [dialog.css:67-70]
└ .msg-ar__rule          bg --surface-2 + radius-lg           [messages.css:683-690]
  ├ .msg-ar__cond        bg --surface-1 + 1px border          [messages.css:753-763]
  ├ .msg-ar__trigger     bg --surface-1 + 1px border          [messages.css:739-747]
  └ .msg-ar__add         1px dashed border                    [messages.css:799-812]
```

Three surface levels inside one dialog, with the innermost lighter than its parent.

**Bespoke components duplicating system primitives.** `.msg-btn` (`messages.css:402-443`) is a
complete button family — base, `--ghost`, `--primary`, hover, focus, disabled — reimplementing
`@projective/ui` `Button` inside a feature stylesheet. It hardcodes `background: color-mix(in srgb,
var(--primary) 88%, #000)` at `:441` — **the only raw hex in the surface**, and a raw `88%` with no
`--tint-*` step. Same pattern for the fields at `:499-509`, `:656-663`, `:753-763`, which
reimplement `.ui-field` and therefore inherit none of the `--fld-*` state contract.

**Token drift, counted.** 33 font-sizes with zero `--text-*` · 11 font-weights with zero `--fw-*` ·
22 icon sizes in raw px with zero `--icon-*`, of which `18px` (`:569,570,609,610`) is off-ramp
entirely · `letter-spacing: 0.03em` (`:372`) where `--tracking-wide` is the uppercase-label token ·
four different disabled opacities (0.5 / 0.55 / 0.5 / 0.6) where `--fld-disabled-alpha` exists.

**Two focus vocabularies.** `messages.css:91-95` uses the canonical two-tone
`box-shadow: var(--focus-ring-shadow)`; `:284` and `:423` use a single-tone
`outline: 2px solid var(--focus-ring)`. And **eleven interactive controls have no focus rule at
all**: `.conv-menu__item` · `.msg-matrix__opt` · `.msg-filter__reset` · `.msg-picker__row` ·
`.msg-picker__chip-remove` · `.msg-ar__remove` · `.msg-ar__trigger` · `.msg-ar__add` ·
`.msg-set__quiet-field input` · `.pop-chat__earlier` · `.chat-popout__return`. `.msg-conv__kebab`
has a `:focus-visible` selector (`:190`) but it only sets `opacity: 1` — no ring.

**Hit targets below the 24px floor** (`--fld-hit`, `index.css:578`; `.ui-hit` is used **zero times**
in this feature): `.msg-picker__chip-remove` **18×18** (`:471-483`) · `.msg-filter__reset`
**15.6px** block, no padding declared (`:354-362`) · `.msg-reaction` **41×19** measured ·
`.msg-ar__remove` exactly 24×24 with no margin.

**Dead class hooks — four applied in TSX with no rule anywhere in the repo:**
`msg-rail__btn--toggle` (`MessagesRail.tsx:76`) · `msg-set` (`MessageSettingsModal.tsx:94`) ·
`msg-newconv` (`NewConversationModal.tsx:43`) · `conv-menu-pop` (`ConversationRow.tsx:69`, while the
analogous `.chan-menu-pop` *is* styled at `channel-header.css:286`).

**Measure mismatch, conversation view.** The composer is capped at `max-inline-size: 56rem`
(`chat-composer.css:51`) while the feed has no cap (`chat-feed.css:25`, padding only). Measured: feed
`360..1409`, composer field `490..1280` — the input is inset **130px** from the message column, and
**125px** short of where your own bubbles land. You type in a narrower column than you read.

**No generic-dashboard tropes.** No decorative chart, no vanity KPI row, no table-of-every-field.
Worth stating: the surface's problems are structural, not padding-out.

**On the pop-out bottom-anchor.** `PopoutChat.tsx:61-66` uses a **single unguarded
`requestAnimationFrame`** to pin to bottom. I could not verify it (rAF is paused here). But its
sibling `ChatFeed` required rAF **plus settle timers plus a re-pin** to hold reliably (Decision #51),
and the pop-out loads images that grow `scrollHeight` after that one frame. Flagged as fragile by
construction, **not** as an observed break.

---

## Ranked fix list

Ranked by severity × reach. `file:line` throughout.

### P0 — the surface does not work

| # | Fix | Where |
|---|---|---|
| 1 | **Give the body the conversation list.** Move `LaneList`/`ConversationRow` into the canvas as the primary view; demote the lane to scope + saved views. This single change fixes the hierarchy inversion, the 8.3% text channel, the tablet squeeze, and most of mobile. | `MessagesSidebar.island.tsx:377-399` → `routes/(dashboard)/messages/index.tsx:10` |
| 2 | **Make `/messages` survive ≤767px.** Once (1) lands the list is in the body and already survives; then repoint the empty-state copy and add a Messages entry to the bottom nav. Until then the route is unusable on mobile. | `middle-nav.css:168` (shell) · `MessagesEmptyState.tsx:17-18` |
| 3 | **Give the empty state a control.** A real "New message" `Button` in the body, not a sentence pointing at a 34px icon 1,100px away. | `MessagesEmptyState.tsx:11-20` |
| 4 | **Add the missing not-found guard on the Files tab.** `index.tsx` and `members.tsx` both guard; `files.tsx` renders a null projection. | `[conversationId]/files.tsx:15-24` |

### P1 — the surface misleads

| # | Fix | Where |
|---|---|---|
| 5 | **Render the six discarded errors.** Every caller drops `res.message`. Three of them render failure as *empty*, which teaches the user a lie. | `MessagesSidebar.island.tsx:149` · `ContactPicker.tsx:40-42` · `PopoutChat.tsx:70-79` · `NewConversationModal.tsx:27-28` · `MessageSettingsModal.tsx:83` |
| 6 | **Give `busy` a visual.** `aria-busy` alone is invisible to sighted users; add a skeleton or dim to the lane list. | `LaneChrome.tsx:56` · `packages/ui/navigation/styles/lane.css` (no `aria-busy` rule exists) |
| 7 | **Resolve the duplicated `Starred` control.** Same glyph, same label, 160px apart, different behaviour and different latency. Drop the quick-filter duplicate or re-label and re-glyph both. | `MessagesSidebar.island.tsx:95` vs `:102` |
| 8 | **Stop reserving 48px of a 234px row for a hidden kebab and a dot.** Overlay the kebab on hover; move the unread mark to the row gutter. Recovers ~40% of the text channel immediately. | `messages.css:170-177` · `:163-169` |
| 9 | **Read `hasMore`/`nextCursor`.** The inbox is silently truncated today. | `conversations-ssr.ts:33` → `MessagesSidebar.island.tsx` (never read) |
| 10 | **Align the composer to the message column.** Either cap the feed at `56rem` or uncap the composer; a 130px offset between what you read and what you type is not a choice. | `chat-composer.css:51` vs `chat-feed.css:25` |
| 11 | **Give the selected filter chip a non-hue channel** (weight, or a check mark) and stop dropping its label contrast to 4.36:1. | `messages.css:394-398` · `:748-752` |

### P2 — the surface drifts

| # | Fix | Where |
|---|---|---|
| 12 | **Break the spacing monotony.** 87.7% of spacing sits in three adjacent steps; `--space-7`/`--space-8` are unused. Introduce a generous interval between bands so proximity groups without a tint. | `messages.css` throughout |
| 13 | **Retire the 1.05:1 band tint** or make it earn its keep; today the hairline does all the work while the "raised" band optically recedes. | `messages.css` head/footer (via `lane.css`) |
| 14 | **Migrate `messages.css` to the token vocabulary `chat-popout.css` already uses.** 33 font-sizes → `--text-*`; 11 weights → `--fw-*`; 22 icon px → `--icon-*`; kill the `18px` off-ramp and the `0.9`/`0.95`/`1.25rem` type sizes. | `messages.css` (sizes listed §4/§9) |
| 15 | **Remove the only raw hex and the bespoke button family.** Use `@projective/ui` `Button`. | `messages.css:402-443`, hex at `:441` |
| 16 | **Add focus rings to the eleven controls that have none**, and unify on `--focus-ring-shadow`. | list in §9; vocabularies at `messages.css:91` vs `:284`/`:423` |
| 17 | **Raise the sub-24px hit targets.** | `messages.css:471-483` (18×18) · `:354-362` (15.6px) |
| 18 | **Flatten the auto-response box-in-box** — three surface levels with the innermost lighter than its parent. | `messages.css:683-690` + `:739-763` |
| 19 | **Delete or implement the four dead class hooks.** | `MessagesRail.tsx:76` · `MessageSettingsModal.tsx:94` · `NewConversationModal.tsx:43` · `ConversationRow.tsx:69` |
| 20 | **Harden the pop-out bottom-anchor** to match `ChatFeed`'s rAF + settle-timer pattern. | `PopoutChat.tsx:61-66` |

---

## What is already right

Stated plainly, because it should not be regressed:

- **RTL is exemplary** — zero physical properties, zero overflow, zero `[dir]` guards needed.
- **`conversation.css` is 19 lines** because the conversation view genuinely reuses the channel
  chrome rather than copying it. That is the correct instinct, executed.
- **The lane empty-note branches on real context** (archived / starred / filtered / virgin).
- **The active-row mark already solves the CVD problem correctly** (`messages.css:61-76`) — the
  filter chips just need to copy it.
- **`chat-popout.css` is fully tokenised.** The house style exists in this feature; `messages.css`
  simply predates it.
- **The detail view honours the region contract.** Only the index inverts it.

---

## Outcome — what shipped

All 20 ranked fixes applied. Measured in-browser at 1440 / 1024 / 900 / 768 / 390, LTR and RTL.
Detector clean, typecheck clean, `deno fmt` clean.

### The headline fix

The root's regions were rebuilt to the contract, and the detail route was left as it was (it already
complied):

| Region | Before | After |
|---|---|---|
| Lane | search · filters · partitions · **all data** · both CTAs | scope only — partitions + relation facets as **named rows with live counts** |
| Header band | **absent** | identity · live count · search · id-based refinements |
| Body | a glyph, an `h1`, a sentence | **the conversation list** |
| Footer band | **absent** | New message (labelled) · Settings · density |

### The numbers that moved

| Measure | Before | After |
|---|---|---|
| Preview track @1440 | 114px | **577px** |
| Preview shown | 47% of natural | **100%** at every width tested |
| Row width for content | 234px | 873px |
| Kebab cost at rest | 32px reserved always | **0** — overlays the meta column on hover |
| Composer ↔ message column | 130px apart | **0** — one `--chat-measure` |
| Filter-chip selected state | 1.003:1 luminance, label 7.14:1 → **4.36:1** | weight + ink + mark, label stays ≥7:1 |
| Lane toggles | 5 (two identical "Starred") | 4 |
| Mobile @390 | list, search, filters, both CTAs = `0×0` | **all reachable**, 13 rows, 0 overflow |
| Footer band vs bottom nav @390 | identical 390×56 rect | **clear** (788 / 788) |
| Spacing steps in use | 88% inside a 3× band | 8× contrast (`--space-1` rows → `--space-6` groups) |
| Off-ramp type sizes | 3 (`0.9`/`0.95`/`1.25rem`) | 0 |
| Focus vocabularies | 2 (+11 controls with none) | 1 composite, 0 uncovered controls |
| Raw hex | 1 | 0 |

### Two decisions worth keeping

**Container queries, not media queries, for the row.** At exactly 768px the shell still shows the
280px lane, so the content region is 424px — *narrower* than the same viewport with the lane hidden.
A viewport breakpoint produced a 36px preview track at that boundary. `container-type: inline-size`
on `.inbox` asks the only question that matters and keeps working when the lane collapses to its rail.

**Derive, don't sync.** The header's count and the body's list are the same set. An early version had
the body publish its rows through a signal for the header to read, and the header rendered the
*previous* interaction's count. Both now call one pure `visibleConversations()` over the same shared
signals.

### Two bugs found in the new code during verification

Both the same class — **treating "empty" as "not loaded yet"**:

1. The seed guard was `inboxAll.value.length === 0`. A search matching nothing sets the list empty,
   which re-satisfies the guard on the next render and **re-seeds the SSR conversations** — so a
   zero-result query silently rendered the full inbox back. Now an explicit one-shot ref.
2. The header inferred the same way and **printed the SSR count above an empty list**. Now an
   explicit `inboxSeeded` signal.

### Not verified here

**`:focus-visible` rendering.** The preview pane never takes real keyboard focus (`document.hidden`
is true; synthetic `focus()` does not satisfy Chrome's heuristic and dispatched `Tab` never reaches
the page). The rules are confirmed present and on the composite token by source audit — 26
`:focus-visible` selectors, 18 of 18 `cursor: pointer` controls covered, 0 single-tone outlines
remaining — but they were not seen rendering.

### Deliberately left undone

- **`/projects` has the identical mobile failure** ("Pick a project from the list on the left", no
  list). Same shell rule, same shape of fix. Out of scope for a messaging pass; it is now the only
  surface still failing this way.
- **Row actions on touch.** The mobile row drops the hover-revealed kebab, because there is no hover
  to reveal it — so Favourite/Archive/Delete are reachable only from inside a conversation on a
  phone. A long-press or swipe affordance is the right answer and is a separate piece of work.
