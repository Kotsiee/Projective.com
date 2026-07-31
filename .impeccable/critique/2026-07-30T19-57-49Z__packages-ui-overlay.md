---
target: overlay family (packages/ui/overlay + feedback)
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 4
p1_count: 6
timestamp: 2026-07-30T19-57-49Z
slug: packages-ui-overlay
---
# Overlay family critique — Projective design system

Method: dual-agent (A: a0de7c115430255b4 · B: a12b9f0309b4690b7). Read-only. Detector: exit 0 (clean) over the three TSX dirs; its ruleset is CSS-slop oriented and says nothing about focus, layering or dismissal — everything below is source analysis, spot-verified in the parent context.

## Design Health

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | A toast pushed in a backgrounded tab is announced but never painted, then expires |
| 2 | Match System / Real World | 3 | Naming is clean; `--z-*` scale is legible |
| 3 | User Control and Freedom | 2 | Escape closes — and over-closes the whole stack; HoverCard has no Escape at all |
| 4 | Consistency and Standards | 1 | 5 radii, 2 separator tokens, 6 scrim recipes, 7 dialog widths, 6 right-drawer widths |
| 5 | Error Prevention | 2 | Dismissal correctly resolves to reject; but initial focus lands on ×, no `inert` on background |
| 6 | Recognition Rather Than Recall | 3 | Close-button placement uniform across all 12 |
| 7 | Flexibility and Efficiency | 2 | No keyboard path to a toast before it auto-dismisses |
| 8 | Aesthetic and Minimalist | 2 | Nested elevation cards inside an already-elevated panel; doubled padding + nested scrollers |
| 9 | Error Recovery | 2 | Wallet's irreversible confirm can scroll below the fold |
| 10 | Help and Documentation | 2 | JSDoc is unusually good, but two comments contradict their own code |
| **Total** | | **21/40** | **Acceptable** |

## 1. Overlay-family consistency table

| Overlay | Surface | Radius | Shadow | Border | Backdrop | Padding (h/b/f) | Structure |
|---|---|---|---|---|---|---|---|
| Dialog `dialog.css:58` | `--surface` | `--radius-lg` (12) · maximized→base (8) `:90` | `--elevation-high` | full 1px `--border-subtle` `:68` | Backdrop, **no blur** → 4px | 4/5 · 5 · 4/5 | head+body+foot, foot `flex-end` `:157` |
| ConfirmDialog `confirm.css:8` | inherits | inherits | inherits | inherits | inherits | body only | Dialog + `footer` prop |
| ConfirmPopup `confirm.css:31` | `--surface` | **`--radius-base` (8)** `:42` | high | full 1px `--border-subtle` | none | `--space-4` | body + actions `flex-end` |
| Drawer `drawer.css:7` | `--surface` | **none** | high | single docking edge `:29,35,45,51` | Backdrop, no blur → 4px | 4/5 · 5 · — | head+body, **no footer region** |
| Popover `popover.css:7` | `--surface` | `--radius-base` (8) | high | full 1px `--border-subtle` | none | — · `--space-4` · — | content only |
| Tooltip `tooltip.css:10` | **inverted** `--on-surface` | `--radius-sm` (6) | **`--elevation-medium`** | none | none | 1/2 | single |
| Toast `toast.css:78` | `--surface` | `--radius-base` (8) | **medium** | **none** | none | 3/4 | icon+body+close |
| Message `message.css:8` | variant tint | `--radius-base` (8) | none | 3px inline-start `:59` | n/a | 3/4 | inline |
| Alert `alert.css:7` | variant tint | **`--radius-lg` (12)** `:17` | none | **4px** inline-start `:56` | n/a | `--space-5` | title/desc/actions |
| DraggablePopover `draggable-popover.css:9` | **`--surface-1`** `:21`; head `--surface-2` `:80` | **`--radius-xl` (16)** | high | full `--border-subtle` `:22` **+ `--hairline` divider** `:79` | none | 2 · 3 | head+body |
| HoverCard `hover-card.css:10` | `--surface` | **`--radius-lg` (12)** | high | full 1px `--border-subtle` | none | `--space-4` | single |
| AttachmentPreview `attachment-modal.css:17` | `--surface` | `--radius-xl` | high | **none**; `--hairline` seams | **blur → 18px** | 2/3 · — · none | head+split |
| TicketModal `ticket-modal.css:17` | `--surface` | `--radius-xl` | high | none; `--hairline` | blur → 18px | 3 · 4 · 3 | head+split+foot |
| ProjectCreate `project-create-modal.css:21` | `--surface` | `--radius-xl` | high | none; `--hairline` | blur → 18px | 3/4 · 4 · 3/4 | head+split+foot |
| SubmissionReview `submission-review.css:16` | `--surface` | `--radius-xl` | high | none; `--hairline` | blur → 18px | 2/3 · varies · 3 | top+split+foot |
| Wallet drawer `wallet-overlays.css:11` | inherits; foot **`--surface-2`** `:65` | inherits (none) | inherits | `--hairline` | inherits → 4px | 5 · 5 · 4/5 | head/body/**sticky** foot |
| Wallet confirm `wallet-overlays.css:71` | inherits Dialog | `--radius-lg` | high | `--hairline` rows | inherits → 4px | 5/5/3 · 5 · 5 | **foot inside body** |
| Chat popout `chat-popout.css` | inherits `--surface-1` | `--radius-xl` | high | `--hairline` `:76` | none | 0 · 3 | scroll + composer |

### Where the family breaks

- **Two separator token families.** Package draws seams with opaque `1px solid var(--border-subtle)` (n2.tone 85). Apps draw them with `var(--hairline)` (`--outline` @ 20% alpha). Different colours, same job. `DraggablePopover` uses both in one component (`:22` vs `:79`).
- **Border presence is inverted by layer.** Every package panel has a full 4-sided border; every app modal panel has none. The same role reads bordered or borderless depending on who built it.
- **Five radii across twelve siblings** — sharpest within a single behavioural class: Popover 8 / HoverCard 12 / DraggablePopover 16. And `dialog.css:90` *reduces* radius 12→8 on maximize.
- **Surface split:** ten panels on `--surface`, DraggablePopover on `--surface-1` — a visible 4-tone step in light mode when both are open.
- **Alert vs Message** diverge on radius (12 vs 8), rail (4px vs 3px) and tint step (`--tint-soft` 8% vs `--tint` 12%).
- **Zero type-ramp adoption.** `grep var(--text-*)|var(--fw-*)|var(--leading-*)` across all 14 sheets returns nothing. Off-ramp literals: `1.0625rem` (`dialog.css:110`, `drawer.css:79`, `message.css:83`), `1.05rem` (`project-create-modal.css:59`), `0.74/0.72rem` (`ticket-modal.css:122,130`).
- **Header density has five systems**, so bar heights run ~40→64px across modals of the same class.

## 2. Backdrop language

Six recipes. The shared one is wrong.

| Where | Colour | Blur |
|---|---|---|
| `backdrop.css:12` | `color-mix(--surface, --tint-heavy)` | 4px |
| `backdrop.css:20` | same | `--glass-blur` = 18px |
| `block-ui.css:19` | `--bg` @ raw 55% | 2px |
| `command-palette.css:21` | `--bg` @ raw 60% | 2px |
| `mobile-menu.css:36` | **`#000` @ 40%** | 6px |
| `site-shell.css:564` | `--surface` @ `--tint-strong` over **`rgba(0,0,0,0.45)`** | 2px |

## 3. Size & measure

No named size set. `Dialog.width` is a free CSS length (`Dialog.tsx:57`); callers produced 26/27/28/30/34rem. App modals: 1200/1080/1040/1440px inline, 860/760/760/1000px block. `attachment-modal.css:20` `block-size: min(860px, 100%)` has no viewport term — taller than an 800px laptop window. Drawer hardcodes `--drawer-size: min(22rem,92vw)` (`drawer.css:8`) while orphaning the defined `--drawer-w: min(30rem,92vw)` (`index.css:363`); six distinct right-drawer widths ship. `.ui-dialog__body` sets no `max-inline-size`, so a 48rem dialog renders body prose at ~76ch.

## 4. Motion

Architecturally strong: every panel transitions off `[data-state]`, animates only transform/opacity, and settles with the enter transform cleared. Reduced motion snaps to a real static rule in all 12.

Three defects, all the same class:

- **`usePresence.ts:37`** — `requestAnimationFrame(() => setState("open"))`. rAF does not fire in a hidden tab. Static state for every panel is `opacity: 0` (`dialog.css:73`, `drawer.css:56`, `popover.css:23`, +9 more), corrected only by `[data-state="open"]`. Meanwhile scroll-lock and focus-trap key off `mounted`, not `state` (`Dialog.tsx:116,121`). Result: invisible, scroll-locked, focus-trapped modal that never repairs — deps are `[open, exitMs]`, unchanged. `:41` short-circuits only the *exit* under reduced motion.
- **`toast.css:104` + `Toast.tsx:89`** — same shape. `--enter` is statically `opacity: 0`; the 3000ms dismiss timer still fires.
- **`toast.css:212`** — countdown animates `inline-size`, a layout property. Frozen clock parks the bar at 100%, claiming an infinite timer while the toast expires on schedule. Should be `transform: scaleX()` with `transform-origin: left`.

Minor: `toast.css:99` and `message.css:159` are the only panel transforms not on `--spring-standard`. `draggable-popover.css` has no local reduced-motion block. `wallet-overlays.css:201` sets `transform: none` at the same specificity (0,1,0) as `drawer.css:35` `translateX(100%)` — source-order-dependent; if the wallet rule wins, the closed drawer rests on-screen.

## 5. Focus / keyboard compliance matrix

| Overlay | Focus in | Trapped | Esc | Returns | Background inert | ARIA name |
|---|---|---|---|---|---|---|
| Dialog | Yes → header × | Partial | Yes | Yes | **scroll-lock only** | **dangles** w/ headerTemplate |
| ConfirmDialog | Yes → × (JSDoc `:41` says otherwise) | Partial | Yes | Yes | scroll-lock only | OK, but `role="dialog"` not `alertdialog` |
| ConfirmPopup | Yes → reject btn | Partial | Yes → `reject()` | Yes | none (correct) | **none** on `alertdialog` |
| DynamicDialog | Yes | Partial | Yes | Yes | scroll-lock only | inherits defect |
| Drawer | Yes → × | Partial | Yes | Yes | scroll-lock only | **correct** |
| Popover | Yes (questionable) | Yes — but page stays scrollable | Yes | Partial (Safari) | none | **none** on `role="dialog"` |
| DraggablePopover | **No** | No (deliberate) | Panel-scoped only | **No** | none | **correct** |
| HoverCard | No | No | **No** — WCAG 1.4.13 | n/a | none | `aria-describedby` → `aria-hidden="true"` |
| Tooltip | No (correct) | No | Anchor-scoped only | n/a | none | correct |
| Toast | No | No | **No** | n/a | none | nested live regions |
| Messages | No | No | **No** | n/a | none | nested live regions |

`useFocusTrap.ts`: Tab/Shift+Tab wrap works (`:60-69`); zero-focusable handled (`:55-58`); tabbables re-queried per keydown (`:54`). Gaps — `:32` filters on `offsetParent !== null`, so `visibility: hidden` elements stay tabbable and can absorb initial focus; `inert` subtrees likewise; `:63`'s `!container.contains(activeEl)` is dead code; `:50` is rAF-gated.

## 6. Layering

`useOverlayStack.ts:23-30`: per-class base + a module-global `topZ` stepped by 10.

- Popover in a Dialog: 1300 → `max(1100, 1310)` = **1310**. Correct.
- Second modal's backdrop over the first modal's panel: B's whole layer (1310) is above A's (1300) — scrim dims A. Correct.
- Tooltip over DraggablePopover: 1700 vs `1500 + --dd-z`. `DraggablePopover.tsx:69` `let zTop = 0`, `:155` `++zTop` on every pointerdown, never released. After ~200 interactions the window ties the tooltip; at 201 it wins.
- `useOverlayStack.ts:93` releases only `if (topZ === mine)` — out-of-order teardown leaks 10 permanently. No reset when the last overlay unmounts. In an SPA shell that never full-page-navigates, `topZ` climbs monotonically until a plain Popover outranks `--z-draggable`, then `--z-toast`, then `--z-tooltip`.
- `useOverlayStack.ts:78-94`: `isTop` is set true on mount and false only in own cleanup — nothing demotes an overlay when a higher one opens. Combined with `useDismiss.ts:40` using `stopPropagation()` (not `stopImmediatePropagation()`) on a shared `document` capture listener, **one Escape fires both callbacks**.
- Static, unmanaged z: `tooltip.css:14`, `toast.css:10`, `hover-card.css:14` (**1100 — behind any Dialog**), plus eight `fields/styles/*.css` at literal `1000` with no portal.
- `Overlay.tsx:63` omits `layer`, so a modal-behaving surface allocates from the popover band (1100).

**The Select-in-Dialog break:** `dialog.css:72` sets `transform: translate(var(--dlg-x,0), var(--dlg-y,0)) scale(0.96)` and `:80` settles to `scale(1)` — never `none`. A transform at rest is still a containing block for `position: fixed` descendants and a stacking context, and `:71` adds `overflow: hidden`. So every field dropdown re-bases *and* is clipped. This is the trap the package fixed for Popover/Tooltip/ConfirmPopup via BodyPortal and left unfixed for all eight form controls.

## 7. Nesting & density

- `attachment-modal.css:548,601,646` — `.fx-audio` / `.fx-code` / `.fx-doc` each carry `background: var(--surface); box-shadow: var(--elevation-low)` inside `.fx-modal__media` (tinted) inside `.fx-modal__panel` (`--surface`). Three nested surface layers, two the same colour, separated by shadow alone.
- `wallet-overlays.css:28` `.wlt-drawer__body { padding: var(--space-5); overflow-y: auto }` renders inside `.ui-drawer__body` which already has both (`drawer.css:107`) — 3rem inline padding and two nested scrollers on one axis. Same doubling at `:80` inside `dialog.css:149`.
- `wallet-overlays.css:57` `.wlt-drawer__foot` sticks to the padding box, 24px above the panel's true edge, with content visible below it.
- `submission-review.css:411` borders a textarea with `--outline`; `attachment-modal.css:336` borders the sibling textarea with `--hairline` — the token reserved for *non*-interactive seams.
- `attachment-modal.css:151` `.fx-modal__menu` is a hand-rolled `position: absolute; z-index: 2` dropdown inside an `overflow: hidden` panel, bordered with `--outline` — the only overlay in the codebase not going through BodyPortal.
- Raw percentages where a `--tint-*` step exists: `submission-review.css:76,123`, `attachment-modal.css:319,425,533,588`, `toast.css:197`, `message.css:139`, `alert.css:144`.

## 8. Dismissal

`useDismiss.ts:45` listens on `pointerdown` and ignores targets inside panel/trigger, so mousedown-inside → mouseup-outside does not dismiss. `Backdrop.tsx:32` uses `onClick`, which retargets to the common ancestor — also drag-safe, by construction rather than by an explicit guard.

Per class: Dialog and Drawer set `closeOnOutside: false` (`Dialog.tsx:129`, `Drawer.tsx:93`) and rely on backdrop click. `Overlay.tsx:75` + `:86` is the outlier — it closes on arbitrary outside pointerdown *and* on backdrop click, double-wired.

**Destructive confirmation safety is correct.** Both surfaces dismiss to reject, never accept: `ConfirmPopup.tsx:119` calls `reject()`; `ConfirmDialog.tsx:74-77` routes `onVisibleChange(false)` → `onReject?.()`, and `useControllable`'s `set()` semantics mean the accept button does not re-enter that path. No double-fire, no mistaken confirm. Three residual issues: `role="dialog"` instead of `alertdialog`; initial focus lands on the header × (safe by luck — × fires reject); and the `isTop` bug means Escape rejects the confirmation *and* closes the parent dialog.

## 9. Content patterns

Action order is consistent everywhere — secondary/destructive first, primary rightmost. Close-button placement is uniform (trailing, after a `flex: 1 1 auto` title) in all twelve.

But: three footers get `flex-end` only via an unconditional `flex: 1 1 auto` spacer, not a declaration (`ticket-modal.css:331`, `project-create-modal.css:442`, `submission-review.css:523`) — one conditional render from left-aligned actions. Close-button hit targets come in four sizes (1.5 / 1.75 / 2 / 2.25rem — 24px is under WCAG 2.5.8) and two shapes (`--radius-sm` vs `--radius-full`).

**Primary action below the fold:** `ConfirmMoveModal.island.tsx:114` passes `<footer class="wlt-modal__foot">` as *children*, so it lands inside the scrolling `.ui-dialog__body` rather than the footer slot, and `wallet-overlays.css:127` gives it no `sticky` (unlike the sibling drawer footer at `:57`). On a short viewport the irreversible "Confirm / Withdraw £X" commit scrolls out of view.

## Ranked findings

### P0
1. **Light-mode scrim brightens the page.** `packages/ui/overlay/styles/backdrop.css:12` — `color-mix(in srgb, var(--surface) var(--tint-heavy), transparent)`. The comment two lines above prescribes `--on-surface`; the code uses `--surface`, which in light mode is ~white. Every modal, drawer and overlay dims with *white at 40%*, the same hue as the panel above it. Separation rests entirely on `--elevation-high` and a 4px blur. One-token fix.
2. **rAF-gated visibility leaves a locked, invisible modal.** `packages/ui/overlay/core/usePresence.ts:37`, `packages/ui/hooks/useFocusTrap.ts:50`, `packages/ui/feedback/islands/Toast.tsx:89`. Seed `state` from `open`, or add a watchdog timer that force-sets `"open"`, and gate the enter on reduced motion the way `:41` gates the exit.
3. **The focus trap is escapable in one click.** `packages/ui/hooks/useFocusTrap.ts:72` binds keydown to the *container*. With `closeOnOutside: false` and no `inert`/`aria-hidden` on the background, a background click moves focus out and Tab is untrapped. Bind to `document` and apply `inert` to `#root` siblings while a modal is open.
4. **Every field dropdown is re-based and clipped inside a Dialog.** `dialog.css:71-72,80` (transform never clears to `none`, plus `overflow: hidden`) against eight `packages/ui/fields/styles/*.css` at literal `z-index: 1000` with no portal. Route them through BodyPortal + `useOverlayStack` like Popover.

### P1
5. **One Escape closes the whole stack.** `useOverlayStack.ts:78,87,94` (`isTop` never demoted) + `useDismiss.ts:40` (`stopPropagation`, not `stopImmediatePropagation`).
6. **Two unbounded z counters.** `useOverlayStack.ts:93` conditional release; `DraggablePopover.tsx:69` `zTop` never released. The documented class hierarchy inverts over a session.
7. **HoverCard is outside the system.** `hover-card.css:14` static `--z-overlay` (1100) renders behind any Dialog; no Escape (WCAG 1.4.13); `HoverCard.tsx:85` `aria-describedby` points at a node marked `aria-hidden="true"` (`:94`).
8. **Irreversible money action can scroll below the fold.** `ConfirmMoveModal.island.tsx:114` — pass the footer to Dialog's `footer` prop.
9. **Two separator token families.** `--border-subtle` (opaque) in packages vs `--hairline` (20% alpha) in apps; `draggable-popover.css:22` vs `:79` uses both.
10. **Same Backdrop, 4px or 18px depending on caller.** `Dialog.tsx:195` / `Drawer.tsx:105` omit `blur`; all four project modals pass it. Make it a property of the scrim, not the caller. Also `mobile-menu.css:36` and `site-shell.css:564` build scrims from literal `#000`.

### P2
11. Five radii across twelve siblings; `dialog.css:90` shrinks radius on maximize.
12. No named width set — 26/27/28/30/34rem from callers; 1200/1080/1040/1440px in app modals; `attachment-modal.css:20` has no viewport term.
13. `drawer.css:8` orphans `--drawer-w` (`index.css:363`); six right-drawer widths ship.
14. `.ui-dialog__body` (`dialog.css:147`) has no `max-inline-size`; `submission-review.css:468` hardcodes `46rem` where `var(--measure)` exists.
15. `toast.css:212` animates `inline-size`; encode with `scaleX`.
16. ARIA naming: `Dialog.tsx:210` dangles with `headerTemplate`; `Popover.tsx:173` and `ConfirmPopup.tsx:151` are unnamed; `ConfirmDialog` should be `alertdialog`.
17. Close-button targets: four sizes (24/28/32/36px), two shapes; 24px fails WCAG 2.5.8.
18. `wallet-overlays.css:28,80` double padding + nested scrollers; `:201` specificity tie against `drawer.css:35`.
19. Zero type-ramp adoption family-wide; off-ramp literals throughout.
20. `useOverlayStack.ts:44` uses physical `paddingRight` — wrong edge under the shipped `dir="rtl"`.
21. `DynamicDialog.tsx:62` `closeAll()` wipes dialogs opened during the 350ms window; `:95` drops `onClose` on every non-imperative close.
22. Three footers rely on a spacer rather than `justify-content: flex-end` (`ticket-modal.css:331`, `project-create-modal.css:442`, `submission-review.css:523`).

## What's working

1. **`[data-state]` transitions instead of keyframes.** Every overlay's open appearance is a real static rule, so reduced motion snaps to a genuine final state rather than freezing a half-drawn frame. The entire reduced-motion column passes because of this one decision.
2. **Destructive dismissal is genuinely safe.** Traced through `useControllable` — Escape and backdrop resolve to reject on both confirm surfaces, with no double-fire and no path where dismissing reads as confirming.
3. **Drag-safe dismissal by construction.** `pointerdown` + panel/trigger containment on one path, `click` retargeting on the other. Neither dismisses on a mousedown-inside → mouseup-outside text selection.
4. **The `--hairline`-per-docking-edge Drawer and the single-rail Message/Alert** read §B.4 correctly where it was least convenient.
