# Design System — Projective (`@projective/ui`)

> **Status:** Master design specification and the authoritative contract for the `@projective/ui`
> component layer. **Authority:** extends — never contradicts — the "Visual Identity" section of
> [`../business/PRODUCT_SPEC.md`](../business/PRODUCT_SPEC.md) and the UI/styling directives of
> [`../architecture/SYSTEM_ARCHITECTURE.md`](../architecture/SYSTEM_ARCHITECTURE.md) §3. Where this
> file adds a token, engine, or component, it is additive; where it appears to restate a base value
> (e.g. `#288690`), the product spec remains the origin of that value. Governance:
> [`../../packages/ui/CLAUDE.md`](../../packages/ui/CLAUDE.md) and root
> [`CLAUDE.md`](../../CLAUDE.md).

## Design language: "Visually Interesting Professional Minimalist"

Projective should feel **human, approachable, and high-retention** — the warmth of Patreon's creator
surfaces — while borrowing structural rigor from **Apple HIG** (clarity, deference, depth),
**Material** (a real elevation/tonal model), and **Fluent** (light, materials, motion coherence). It
must look **unmistakably itself** and deliberately avoid the interchangeable "SaaS-AI-startup" look:
no wall-to-wall gradient-on-glass cards, no purple-blue hero blur, no equal-weight bordered boxes
stacked forever. The identity comes from **teal-anchored calm tech**, **asymmetric breathing
space**, **tonal surface layering instead of borders**, and **fluid, spring-based motion that never
bounces.**

[toc]

---

## Part A — Foundations (Tokens)

### A.1 The Core Palette

The brand anchor is **Brand Teal `#288690`** (from `PRODUCT_SPEC.md` §Visual Identity). Teal is the
seed for the entire tonal system (Part 2). All base semantic targets below are the product spec's
values, expressed here as the token contract components consume.

#### Brand & semantic seeds

| Token                   | Light       | Dark                                            | Role                                   |
| :---------------------- | :---------- | :---------------------------------------------- | :------------------------------------- |
| `--brand` / `--primary` | `#288690`   | `#288690` (tonal-lifted for contrast, see §A.2) | Primary action, active state           |
| `--success`             | `#268C66`   | tonal                                           | "Complete" / approved                  |
| `--warning`             | `#D98216`   | tonal                                           | "In Progress" / time-sensitive         |
| `--danger`              | `#D94141`   | tonal                                           | "Incomplete" / error / no-show         |
| `--bg`                  | `#FAFAFA`   | `#1A1A1A`                                       | Primary canvas                         |
| `--surface`             | `#FFFFFF`   | `#212121`                                       | Elevated cards/headers/sidebar         |
| `--text-main`           | `#1A1A1A`   | `#FFFFFF`                                       | Body & headings                        |
| `--text-secondary`      | `#666666`   | `#B3B3B3`                                       | Labels, muted info                     |
| `--text-disabled`       | `#B3B3B3`   | tonal                                           | Non-interactive                        |
| `--border-subtle`       | `#E6E6E6`   | tonal                                           | Razor-thin indicators only (§B.4)      |
| `--focus-ring`          | `#28869066` | `#28869066`                                     | 3px focus glow, all focusable elements |

#### Contrast engineering (light **and** dark)

Teal `#288690` is chosen because it clears **4.5:1 against `#FAFAFA`** for text and holds up on
`#1A1A1A`. The rule (from `PRODUCT_SPEC.md` §Accessibility): the primary teal is verified ≥ 4.5:1
against whatever canvas it sits on. In dark mode the raw seed is **tonally lifted** (a higher tone
from the generated ramp, §A.2) rather than used flat, so contrast is preserved without hand-picking
a second hex. Every semantic color ships as a **tonal ramp** (0–100), and light/dark simply select
different tones from the _same_ ramp — one source, two selections.

### A.2 Dynamic Material You integration

> **Approved library exception.** `@material/material-color-utilities` is the **only** third-party
> package permitted in the UI layer, and **only** inside `packages/ui/system/` (the theming engine).
> It never enters a component. Recorded in `SYSTEM_ARCHITECTURE.md` §3.

**Goal:** from a single **seed color** (default `#288690`, or a user's chosen accent) generate a
full, accessible, contextual set of tonal palettes, and write them into the same `--*` CSS custom
properties the components already read. Components stay 100% library-agnostic; only the engine knows
Material exists.

#### The mathematical path

1. **Seed → HCT.** Convert the seed hex to **HCT** (Hue, Chroma, Tone) — Material's perceptual space
   where _Tone_ is a CIELAB-L\*-based lightness that maps monotonically to WCAG contrast.
   `argbFromHex(seed)` → `Hct.fromInt(argb)`.
2. **HCT → `CorePalette`.** `CorePalette.of(argb)` derives five tonal palettes from the seed: `a1`
   **primary**, `a2` **secondary**, `a3` **tertiary**, `n1` **neutral**, `n2` **neutral-variant** —
   each a continuous function `tone(0..100) → color`. (The implementation uses `CorePalette` for
   version-robustness; the newer `DynamicScheme`/`SchemeTonalSpot` "flavor" API is an available
   upgrade path when a scheme flavor becomes user-selectable.)
3. **Tone selection = the light/dark switch.** A **tone** is picked per role per mode. Because tone
   correlates with contrast, the pairs are engineered, not eyeballed:
   - Light: `primary = P.tone(40)`, `on-primary = P.tone(100)`, `surface = N.tone(98)`,
     `on-surface = N.tone(10)`, `outline = NV.tone(50)`.
   - Dark: `primary = P.tone(80)`, `on-primary = P.tone(20)`, `surface = N.tone(6)`,
     `on-surface = N.tone(90)`, `outline = NV.tone(60)`. The **±40-tone** delta between a color and
     its `on-` pair guarantees ≥ 4.5:1 by construction.
4. **Emit CSS variables.** The engine serializes selected tones to `--primary`, `--on-primary`,
   `--surface-1…5`, `--outline`, etc., and sets them on `:root` (and on any nested
   `<DesignSystemProvider>` scope, §D.3).

```ts
// packages/ui/system/theme-engine.ts  (engine only — never imported by a component)
import { argbFromHex, CorePalette, hexFromArgb } from "@material/material-color-utilities";

/** Generate the token map for one seed + mode, ready to write to CSS custom properties. */
export function buildScheme(
	{ seed, dark }: { seed: string; dark: boolean },
): Record<string, string> {
	const core = CorePalette.of(argbFromHex(seed)); // a1 P · a2 · a3 · n1 N · n2 NV
	const hx = (argb: number) => hexFromArgb(argb);
	return dark
		? {
			"--primary": hx(core.a1.tone(80)),
			"--on-primary": hx(core.a1.tone(20)),
			"--surface": hx(core.n1.tone(6)),
			"--surface-1": hx(core.n1.tone(10)),
			"--on-surface": hx(core.n1.tone(90)),
			"--outline": hx(core.n2.tone(60)),
			// …secondary/tertiary + fixed-hue success/warning/danger seeded from their own hues.
		}
		: {
			"--primary": hx(core.a1.tone(40)),
			"--on-primary": hx(core.a1.tone(100)),
			"--surface": hx(core.n1.tone(100)),
			"--surface-1": hx(core.n1.tone(96)),
			"--on-surface": hx(core.n1.tone(10)),
			"--outline": hx(core.n2.tone(50)),
		};
}
```

**High-contrast (§A.5)** widens the tonal separation: foreground tones (`on-*`, `outline`) are
pushed further from mid-tone (50) toward the extremes, re-deriving every pair at a wider gap with
**zero component changes**. The full implementation (semantic ramps, focus-ring alpha, the
`applyConfig`/`bindRootTheme`/`schemeToCss` surface, and the `<DesignSystemProvider>` mount) lives
in `packages/ui/system/`.

#### Framework-level user adjustments (not per-component hacks)

The engine exposes three **global** knobs, each a small set of root variables that cascade
everywhere. Adjusting them re-themes the whole app; **components never special-case them.**

| Knob                 | Mechanism                            | Root variables                                         |
| :------------------- | :----------------------------------- | :----------------------------------------------------- |
| **Colors**           | seed + scheme flavor → §A.2 pipeline | all `--primary/-surface/-outline/…`                    |
| **Border radius**    | one global scale multiplier          | `--radius-scale` × the `--radius-*` ramp (§A.3)        |
| **Shadow intensity** | one global opacity/spread multiplier | `--shadow-intensity` × the `--elevation-*` ramp (§A.3) |

```css
:root {
	--radius-scale: 1; /* user: 0 (sharp) … 1.6 (very round) */
	--shadow-intensity: 1; /* user: 0 (flat) … 1.5 (deep) */
	--radius-base: calc(8px * var(--radius-scale));
	--elevation-low: 0 2px 4px rgba(0, 0, 0, calc(0.05 * var(--shadow-intensity)));
}
```

### A.3 Geometry & elevation (from `PRODUCT_SPEC.md`, made adjustable)

- **Radius ramp:** `--radius-xs 4px` · `--radius-sm 6px` · `--radius-base 8px` ("Projective
  Rounding") · `--radius-lg 12px` · `--radius-xl 16px` · `--radius-2xl 24px` · `--radius-3xl 32px`,
  each multiplied by `--radius-scale`. The `2xl`/`3xl` steps are the **luxury container curvatures**
  reserved for large panel intersections (Part D shell frames).
- **Fluid container radii (Part D):**
  `--radius-container-lg: clamp(--radius-lg, 0.6vw + 8px,
  --radius-2xl)` (nested-frame exposed
  corner) and `--radius-container-xl: clamp(--radius-xl,
  1.2vw + 10px, --radius-3xl)` (the main
  body panel / `PageCanvas`). They grow with the viewport so the corners where sidebar, middle nav,
  and body cross read soft and premium on wide screens without over-rounding compact ones; both
  still ride `--radius-scale`. A `ShellFrame` raises its corner via a local `--frame-radius`
  (default `--radius-container-lg`; `PageCanvas` sets `--radius-container-xl`).
- **Hairline separator:** `--hairline: 1px solid var(--hairline-color)`
  (`--hairline-color =
  color-mix(in srgb, var(--outline) 40%, transparent)`) — a razor-thin,
  low-contrast **single-edge** seam (§B.4). Applied on ONE edge only (header↔body, sidebar↔body
  region seams), never as a four-sided box on non-interactive content.
- **Elevation ramp:** Low `0 2px 4px /.05` · Medium `0 4px 12px /.1` · High `0 8px 24px /.15`, each
  scaled by `--shadow-intensity`. Reserved: Low = cards, Medium = hover/sidebar header, High =
  modals/popovers.
- **Sizing:** header `48px`, sidebar `64px` collapsed / `224px` expanded (`--shell-nav-block 48px`
  collapsed-rail square hit-target), input height `40px`. All spacing/type in **`rem`** for zoom &
  user font-scaling (per spec §Accessibility).

### A.4 Typography

Scale defined in `rem` on a modular ramp; families via `--font-sans` (UI), `--font-mono`
(code/`Kbd`), and the **accessibility-swappable** `--font-reading` (see §A.5). Weight/size/tracking
are the primary hierarchy tools — this is load-bearing for the border-avoidance strategy in Part
B.4.

### A.5 Accessibility themes (design tokens)

Accessibility is a set of **token overlays** toggled at the framework level (a `data-a11y-*`
attribute on `:root` or a `<DesignSystemProvider>` scope), never per-component patches.

| Theme                        | Trigger                                                         | Token effect                                                                                                                                                                                                |
| :--------------------------- | :-------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Open-dyslexic typography** | `data-font="dyslexic"`                                          | Remaps `--font-sans`/`--font-reading` → OpenDyslexic; widens `--tracking`, raises `--line-height`, disables italic synthesis.                                                                               |
| **Color-blindness shifts**   | `data-cvd="protan\|deutan\|tritan"`                             | Swaps status hues for a CVD-safe set and **adds a non-color channel** (icon/shape/label) to every status token so meaning never rides on hue alone — success gets a check glyph token, danger a cross, etc. |
| **High contrast**            | `data-contrast="high"`                                          | Drives the Material `contrast` param (§A.2) to a wider tone separation; promotes `--border-subtle` to a visible `--outline`; forces `≥ 7:1` (AAA) text.                                                     |
| **Reduced motion**           | `prefers-reduced-motion: reduce` **or** `data-motion="reduced"` | Every transition/spring collapses to `0ms` **jump-to-final** (per spec §Motion Reduction); ripples and theme-crossfades disabled; only opacity/position _end states_ apply. See §B.5.                       |

```css
@media (prefers-reduced-motion: reduce) {
	:root {
		--dur-fast: 0ms;
		--dur-medium: 0ms;
		--dur-slow: 0ms;
		--spring: none;
	}
	*, *::before, *::after {
		animation: none !important;
		transition-duration: 0ms !important;
	}
}
```

---

## Part B — Design Principles (the "unique, not over-designed" rules)

### B.4 The Separation Hierarchy (STRICT)

> **Prohibition:** Do **not** wrap every section in a full four-sided border. Bordered boxes stacked
> uniformly are the exact "over-designed SaaS" look we reject. Full border contours are **reserved
> for interactive elements** (buttons, inputs, selectable cards, menu items) where they signal "you
> can act on this."

Separate content using this **ordered toolkit** — reach for the earliest tool that reads clearly:

1. **Asymmetric spacing first.** Group by whitespace. Uneven, intentional gaps (a large space above
   a section, tight space within it) carry hierarchy with zero ink. Use the spacing ramp, not
   borders.
2. **Alternating surface tints.** Distinguish adjacent regions with `--surface` vs `--surface-1/-2`
   tonal steps (Material surface-container tones), not lines. Elevation/tint = "different layer."
3. **Typographic weight & size.** A heavier, larger label _is_ the section boundary. Let type do
   structural work.
4. **Single-line razor-thin indicators.** When a divider is truly needed, use **one** hairline
   (`1px`, `--border-subtle`) — a `Divider`/`Separator`, never a full enclosure.
5. **Full border contour — interactive only.** A complete outline means "interactive": buttons,
   inputs, combobox triggers, selectable/hoverable cards, focus rings.

Reviewers reject any PR that boxes non-interactive content in a four-sided border where a tint step
or spacing would read. This rule is a merge gate (root `CLAUDE.md`).

### B.5 Fluid Motion Primitives

Motion is **purposeful, fluid, and never bouncy** (reconciling the product spec's "avoid Cascading
or Bounce effects" with spring physics: we use **critically/over-damped** springs — no overshoot).

#### Duration ramp (from spec)

`--dur-fast 150ms` (hover) · `--dur-medium 250ms` (sidebar/modal) · `--dur-slow 350ms` (theme &
layout shifts).

#### Unitless spring constants

Springs are defined by **unitless** `mass / stiffness / damping` (consumed by JS-driven animations
in islands, e.g. splitter drag, sheet drag, kanban reorder):

| Spring token        | mass | stiffness | damping | Character                           |
| :------------------ | :--- | :-------- | :------ | :---------------------------------- |
| `--spring-snappy`   | 1    | 480       | 44      | Fast, no overshoot (menus, toggles) |
| `--spring-standard` | 1    | 320       | 38      | Default (drawers, sheets, splitter) |
| `--spring-gentle`   | 1    | 180       | 32      | Large surfaces (layout reflow)      |

Damping is chosen so the damping ratio ζ ≥ 1 (critically/over-damped) — **motion settles, never
bounces.**

#### Custom cubic-bezier set (CSS transitions)

```css
:root {
	--ease-standard: cubic-bezier(0.2, 0, 0, 1); /* Fluent-like decelerate; default */
	--ease-emphasized: cubic-bezier(0.3, 0, 0, 1); /* entrances */
	--ease-exit: cubic-bezier(0.4, 0, 1, 1); /* exits/dismiss */
}
```

#### Simultaneous theme transition (no staggered redraw)

**Requirement:** when the theme context shifts (light↔dark, seed change, contrast toggle), **all
color transitions occur across the entire DOM tree at once** — no cascade, no per-component stagger,
no jarring repaint.

Mechanism: colors live in inherited CSS custom properties on `:root`. Changing them once triggers a
**single** synchronized transition because every element transitions the _same_ properties on the
_same_ clock:

```css
/* Applied globally; one clock, one duration → simultaneous crossfade */
*, *::before, *::after {
	transition:
		color var(--dur-slow) var(--ease-standard),
		background-color var(--dur-slow) var(--ease-standard),
		border-color var(--dur-slow) var(--ease-standard),
		fill var(--dur-slow) var(--ease-standard);
}
```

For seed-driven re-theming we optionally wrap the swap in a **`View Transitions` root crossfade** so
the whole tree fades between palettes as one frame-coherent step (feature-detected; falls back to
the synchronized `transition` above). Reduced-motion (§A.5) collapses all of this to an instant
swap.

> **Resolved (2026-07-12):** the charting stack is **tiered** — **D3.js** for scales/geometry +
> low-density **SVG**, **Canvas2D** for mid-density, **PIXI.js (WebGL)** for the high-density stage
> (Gantt/pipeline, 10k+ entities). The renderer is selected on a performance metric. This reconciles
> `PRODUCT_SPEC.md` §Libraries and `SYSTEM_ARCHITECTURE.md` §Charts; see root `CLAUDE.md` "Resolved
> Decisions."

### B.6 Icon-First Density (sidebars & dense list surfaces)

Navigation columns, channel/project lists, and panel action clusters are **high-density, icon-led**
surfaces. Vertical space is the scarce resource; spend it on content, not prose. This governs every
sidebar (global rail, middle-nav lane, Project Details channel tree) and any dense list row.

1. **Icons over words.** Prefer icon-based affordances, compact text, and hover tooltips to verbose
   textual descriptions. A row's identity is its glyph + a short name — not a sentence.
2. **Status is iconographic, never textual (in-row).** Layout states, warnings, and system states on
   a list item (channel, project card, stage row) render as **small contextual icons or a colored
   dot** (a visual state — cf. the §D.1 pulsing-dot rule; **never** a count/label). The words that
   explain a state live **only in the on-hover tooltip**, never inline.
3. **Icon-only action rows in sticky footers.** Panel-scoped actions and view-switching controls are
   grouped into **horizontal, icon-only button rows**, typically pinned to a **sticky footer**, so
   the scrollable content region keeps its full height (mirrors the §D.2 collapsed splitter's
   vertical icon-only rows and the §D.1 bottom-pinned collapse toggle).
4. **Tooltips everywhere (mandatory).** Every icon-only button, action, or status indicator carries a
   lightweight, **portal-based `@projective/ui` `Tooltip`** — never a native `title`. The visible
   label may be hidden, but the anchor keeps an `aria-label` (icon-only ≠ nameless), so accessibility
   holds without cluttering the canvas. This is the same discipline the collapsed rail already
   enforces (§D.1).

> Merge gate: a dense-list or sidebar PR that spells a status out in inline text (rather than an icon
> + tooltip), or ships an icon-only control without a `Tooltip` + `aria-label`, is not mergeable.

---

## Part C — Component Library Architecture (`@projective/ui`)

A single, decoupled, **copy-paste-portable** umbrella package (`packages/ui/`) with **multi-export
sub-paths** declared in `deno.json` (`packages/ui/deno.json`). It plugs into external projects
verbatim because every component depends only on the token contract (Part A) — no app coupling.

### C.1 The seven taxonomies (authoritative roster)

| Sub-path                        | Components                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| :------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`@projective/ui/layout`**     | Box, Container, Grid, Row, Column, Stack, AspectRatio, Divider, Separator, Panel, Fieldset, Toolbar, ScrollPanel, Splitter (+SplitterPanel), Stepper (+StepperPanel), MeterGroup                                                                                                                                                                                                                                                                  |
| **`@projective/ui/navigation`** | AppShell, ShellFrame, ShellTopBar, ShellSidebar, MiddleNav, PageCanvas, NavItem, BottomNav, Link, MiddleNavSplitter, MobileMenu, TreeNav, Menu, Menubar, MegaMenu, TieredMenu, PanelMenu, SlideMenu, ContextMenu, Breadcrumb, Steps, TabMenu, TabView (+TabPanel), Paginator (alias Pagination)                                                                                                                                                            |
| **`@projective/ui/fields`**     | Button, SplitButton, SpeedDial, InputText, Textarea, InputNumber, InputMask, Password, InputGroup(+Addon), FloatLabel, IftaLabel, IconField(+InputIcon), Checkbox, TriStateCheckbox, RadioButton, RadioGroup, ToggleSwitch (alias InputSwitch), ToggleButton, SelectButton, Rating, Select (alias Dropdown), MultiSelect, Listbox, AutoComplete, Chips, TreeSelect, CascadeSelect, Slider, Knob, SortControl, ZoomSlider, DatePicker, ColorPicker, FileUpload, FormControl |
| **`@projective/ui/display`**    | Table (sort/multi-sort + per-column `multiSort` toggle), TreeTable, Tree, DataView, VirtualScroller, Scroller, VirtualGrid, OrgChart, Timeline, GMap, AudioVisualizer, Card, Avatar, AvatarGroup, Badge (+OverlayBadge), RatingStars, Chip, Tag, List, ListItem, Accordion (+AccordionTab), Carousel, Galleria, Image                                                                                                                                            |
| **`@projective/ui/feedback`**   | Message, Messages, Alert, Banner, Toast, Dialog, DynamicDialog, ConfirmDialog, ConfirmPopup, Drawer (alias Sidebar), Tooltip, Popover (alias OverlayPanel), ProgressBar, ProgressSpinner, ProgressRing, Spinner, Loader, Skeleton                                                                                                                                                                                                                 |
| **`@projective/ui/overlay`**    | Backdrop, Overlay, HoverCard, Portal, BodyPortal (+ `usePresence`)                                                                                                                                                                                                                                                                                                                                                                                            |
| **`@projective/ui/utils`**      | CommandPalette, Kbd, ScrollArea, ScrollTop, EmptyState, BlockUI, Inplace, Terminal, Captcha, FocusTrap, Defer, AnimateOnScroll, Ripple                                                                                                                                                                                                                                                                                                            |
| **`@projective/ui/dnd`**        | DndContext, Draggable, Droppable, SortableContext (alias SortableContainer), DragOverlay (+ hooks `useDraggable`, `useDroppable`, `useSortable`, `useDndMonitor`, `useDnd`; detectors `pointerWithin`/`closestCenter`/`defaultCollision`/`nextInDirection`)                                                                                                                                                                                          |
| **`@projective/ui/kanban`**     | KanbanBoard, KanbanColumn, KanbanCard                                                                                                                                                                                                                                                                                                                                                                                                            |
| **`@projective/ui/calendar`**   | Calendar (island), CalendarHeader, MiniMonth, AvailabilityPanel, TimeGrid (Week), DayTimeline (infinite Day), MonthGrid, DayColumn, EventBlock (+ hooks `useCalendarViewport`, `useNowTick`; overlap-packing `packDayEvents`; timezone-explicit `calendarTime` matrix utils)                                                                                                                                                                        |

> These supersede the deprecated `atoms/charts/data/time/files/system` split (see
> `SYSTEM_ARCHITECTURE.md` Restructure Change Log). Migration note: the former Fields/Data/Charts
> package docs describe existing implementations now re-homed under these sub-paths.

**Implementation status:** `layout` is built and consumed by the app — Box, Container, Grid, Row,
Column, Stack, AspectRatio, Divider, Separator (`packages/ui/layout/`, zero-JS server components;
token-only BEM; `--space-*`/`--container-*`/`--font-*` tokens added to `styles/index.css`).

`navigation` ships the **nested shell layout engine** (Part D): AppShell (Red) → MiddleNav (Blue) →
PageCanvas (Green) with the ShellFrame exposed-corner curvature (top-left always; bottom-left when a
parent track remains), persona/device gates (guest/mobile hide the sidebar and switch the top bar to
a `--glass-blur` glass header). `MiddleNav` is a three-row frame carrying optional route-filled
**`header`** (`.ui-middle-nav__header`, sticky at `--shell-topbar-h`, token `--shell-midnav-header-h`)
and **`footer`** (`.ui-middle-nav__footer`, sticky at `bottom: 0`) bands flush against the lane; each
collapses to zero when unset (see §D.4, Decisions #29/#31). Plus ShellTopBar, ShellSidebar,
NavItem, Link, the
`MiddleNavSplitter` and `MobileMenu` islands, and the `useSplitter`/`useFlushBottom`/`useMediaQuery`
hooks (`packages/ui/navigation/`, wired into the app's group layouts). Shell tokens
(`--radius-container-lg`, `--glass-blur`, `--shell-*`) added to `styles/index.css`. The **wayfinding
atoms** now ship alongside the shell (`navigation/islands/` + `components/`): Menu, Menubar,
MegaMenu, TieredMenu, PanelMenu, SlideMenu, ContextMenu (cascading submenus over the shared
`MenuItem` model + `navigation/core/menu.ts` helpers), Breadcrumb, Steps, TabMenu, TabView
(+TabPanel), and Paginator (alias Pagination) — full WAI-ARIA menu/tab/menubar keyboard models,
`useFloating`/`useDismiss` anchoring, and reduced-motion ink-bar transitions.

**Shell overhaul (Part D four-profile matrix).** `NavItem` drops the native `title` (the collapsed
rail wraps items in the real `Tooltip`, `placement="right"`) and gains a `dot` update-indicator
(pulsing dot, no count; state folded into `aria-label`). The interactive rail is an **app island**
(`apps/web/features/shell/islands/ShellSidebar.island.tsx`) composing the package `ShellSidebar`
frame

- `NavItem` + `Tooltip` + nested disclosures — it owns the cached collapse preference (via the app's
  `storage-keys.ts`, pre-painted through `:root[data-sidebar]`) and the Projects/Dashboard sub-link
  disclosures. New shell tokens: `--radius-2xl/-3xl`, fluid `--radius-container-lg/-xl`,
  `--hairline`, `--shell-nav-block`. `MiddleNavSplitter` no longer hardcodes its persistence key —
  the app wrapper passes `LocalKeys.MIDDLE_LANE_WIDTH` so the package stays portable.

`fields` is now built to **PrimeNG feature-parity** (`packages/ui/fields/`): 31 controls plus the
adornment/label/group primitives and the `FormControl` wrapper, on the shared `.ui-field` token
geometry (`fields/styles/field.css`). Interactive controls live in `fields/islands/`, zero-JS
adornments + `Button` in `fields/components/`, the wrapper in `fields/wrappers/`; shared state /
positioning logic in `fields/hooks/` (`useControllable`, `useId`, `useDismiss`, `useFloating`,
`useListNavigation`) and shared vocabulary in `fields/types/`. Every bound control takes the
signal-first `Bindable<T>` value (raw value **or** `Signal<T>`) via `useControllable`. All
type-check, lint, and `deno fmt` clean.

> **Roster rename (same-change, per §8 rule):** the original placeholder names were realigned to the
> PrimeNG vocabulary the product brief targets — `TextInput → InputText`, `Switch → ToggleSwitch`,
> `Toggle → ToggleButton`, `Autocomplete → AutoComplete`, and `RadioGroup` now ships alongside a
> single `RadioButton`. PrimeNG-familiar aliases are exported where our canonical name differs
> (`Dropdown → Select`, `InputSwitch → ToggleSwitch`). `Combobox` is covered by
> `Select`/`AutoComplete`; `FileUpload` now ships; `ButtonGroup`, `InputOTP`, `TimePicker` (folded
> into `DatePicker`'s `showTime`), `Dropzone` (covered by `FileUpload`'s drag zone), and `Form`
> remain scaffolded for a later pass.

The remaining four taxonomies — **`display`, `feedback`, `overlay`, `utils`** — are now built to
PrimeNG feature-parity, all type-check / lint / `deno fmt` clean:

- **`display`** — the performance-first collections (Table with 3-state sort (asc→desc→none) +
  Shift-click multi-sort gated by a per-table `multiSort` on/off flag, per-column filter,
  row selection + expansion, column resize/reorder, row grouping, conditional styling, lazy loading
  and `stateKey` persistence; TreeTable; Tree with checkboxes/drag-drop/filter/context-menu;
  DataView list⇄grid; VirtualScroller; Scroller; **VirtualGrid** — a windowed, infinite-scroll GRID
  of stretch-to-fill cells built as a "1D-by-row window" over `useVirtualScroll` (measures its own
  inline width → derives columns → virtualizes ROWS; `rowHeight` may be a function of the computed
  cell width for a square/aspect grid; the File Explorer's card grid) all window rows through the
  package-level
  `hooks/useVirtualScroll` (fixed **or** measured sizes; **own-container OR window scroll**; infinite
  `onReachEnd`; and — additively, for bottom-up feeds like the channel chat — `startAtEnd`/`scrollToEnd`
  to open at the bottom, `onReachStart` to load older at the head, and stable `getItemKey` measurement
  keys so a head-prepend never corrupts the offset table). Plus OrgChart, Timeline, GMap (dumb embed
  wrapper — no keys), Carousel,
  Galleria, Image (zoom/rotate/fullscreen), **AudioVisualizer** — a token-driven voice/audio player
  (play/pause · seekable rounded-bar waveform · elapsed clock · optional speed cycle) with a dual
  real-`<audio>`/simulated transport and a two-tone `--wave-played`/`--wave-rest` waveform a consumer
  can re-tint (the projects chat memo + attachment/review previews consume it), and the content atoms
  (Card, Avatar/AvatarGroup,
  Badge/OverlayBadge, RatingStars — a zero-JS read-only star meter, the display counterpart to the
  interactive `fields` Rating — Chip, Tag, List/ListItem, Accordion).
- **`feedback`** — Message/Messages/Alert/Banner, Toast (+`useToast`), the Dialog family
  (Dialog/DynamicDialog + `useDialog`/ConfirmDialog/ConfirmPopup), Drawer (alias Sidebar,
  bottom-sheet under `--bp-md`), Tooltip, Popover (alias OverlayPanel), and the progress/placeholder
  set (ProgressBar/Spinner/Ring, Spinner/Loader, Skeleton).
- **`overlay`** — Portal (in-tree fixed-layer, no `preact/compat`), BodyPortal (a real
  `document.body` DOM portal — still no `preact/compat`, built on Preact core `render` — for anchored
  micro-popups that must escape a transformed ancestor's re-based `position: fixed`; used by Tooltip,
  HoverCard, and ConfirmPopup), Backdrop, the generic controlled Overlay, HoverCard, and the
  `usePresence` enter/exit helper.
- **`utils`** — CommandPalette, Kbd, ScrollArea, ScrollTop, EmptyState, BlockUI, Inplace, Terminal,
  Captcha (dumb mount point), and the directives FocusTrap, Defer, AnimateOnScroll, Ripple.

File-Explorer additions (root CLAUDE.md §8 Decision #32): **`fields/SortControl`** (a sort-property
dropdown + an asc/desc toggle inside ONE borderless compound block, signal-first so it can share the
sort signals with a table's clickable headers), **`fields/ZoomSlider`** (− · a segmented track with a
distinct centre transition marker · +, for a zoom-density rig), the borderless **`.ui-field--bare`**
variant (no resting border/background; hover reveals a faint tint, focus a soft ring — for dense
enterprise toolbars), and **`layout/Splitter` `SplitterPanel.maxSize`** (a hard per-pane maximum so a
modal split enforces a fixed structural ratio). **Splitter collision note:** the layout `Splitter` and
the nav lane `MiddleNavSplitter` share the `.ui-splitter` block name and the nav's globally-loaded
`splitter.css` sets `.ui-splitter { inline-size: var(--shell-lane-w) }`; the layout splitter's root
box rules are therefore scoped to its `--horizontal`/`--vertical` modifiers (higher specificity; the
lane never carries them) so the two never corrupt each other — do NOT move those declarations back
onto the bare `.ui-splitter` selector.

Submissions additions (root CLAUDE.md §8 Decision #33): **`navigation/TreeNav`** — a wayfinding tree
explorer (a lighter sibling of `display/Tree`): borderless disclosure rows with **chevron** open/close
affordances (never triangles), an optional leading icon OR circular avatar per node, an icon-only
trailing status slot + a muted count, controllable selection + a controllable/internal expanded-key
set, `role="tree"`/`treeitem` with arrow/Home/End keys. Selecting a row scopes the host workspace; a
single-hairline vertical divider between the tree and the workspace is the host's concern (§B.4). Also
a backward-compatible **`Breadcrumb` extension**: a crumb may carry a `MenuItem.command` for
**client-driven** trails (an in-place tree navigator) — the crumb stays an anchor (its `url` remains
deep-linkable / new-tab-openable) but a plain left-click is intercepted (`preventDefault` → `command`);
crumbs without a `command` are byte-identical to before. Both consume the review-modal's reuse of the
existing `layout/Splitter` (hard min/max %), and inherit the same **Splitter collision** discipline
above unchanged (the feature does not touch `splitter.css` or the nav splitter).

Kanban additions (root CLAUDE.md §8 Decision #35): two NEW sub-paths. **`@projective/ui/dnd`** — a
dependency-free, **Pointer-Events** drag-and-drop kit (NO native HTML5 `draggable`, NO external library
— root CLAUDE.md §3 · PRODUCT_SPEC §Libraries · SYSTEM_ARCHITECTURE §KanbanBoard). One `DndContext`
island owns the sensor engine (a pointer sensor with a movement-threshold so a click is never a drag +
capture-phase click-suppression, and a keyboard sensor: Space/Enter pick up · Arrows move · Enter drops
· Escape cancels) over a signal-first store; `Draggable`/`Droppable`/`SortableContext` (alias
`SortableContainer`) + the `useDraggable`/`useDroppable`/`useSortable` hooks mark nodes; `DragOverlay`
renders the elevated ghost through `BodyPortal` (escapes the glass-blur `position: fixed` trap);
`useDndMonitor` lets a consumer react to the drag lifecycle. Collision detectors (`pointerWithin` →
`closestCenter` fallback, and `nextInDirection` for the keyboard sensor) are pure. Signal-first, `--z-`/
`--elevation-high`/`--spring-*` token-only, reduced-motion collapses the ghost tilt, and it ships an
`aria-live` keyboard-DnD announcer. **`@projective/ui/kanban`** — a generic, **controlled**
`KanbanBoard` (+ `KanbanColumn`/`KanbanCard`) built on `dnd`: columns hold items; a card drags across
columns (and reorders within a `sortable` column), `reorderable` columns re-sequence, with live drop
indicators, WIP counts, sleek inner scrollbars, elevation-on-drag, and a grip handle for keyboard drag.
It NEVER mutates the model — it emits `KanbanItemMove`/`KanbanColumnMove` on drop, so a consumer can
commit immediately OR intercept a move behind a confirmation modal (the projects board's stage-reorder /
claimed-ticket / revision warnings). §B.4: columns are non-interactive containers (tonal tint + a single
hairline, no box); cards are interactive (surface + radius + resting elevation).

Calendar additions (root CLAUDE.md §8 Decision #37): one NEW sub-path **`@projective/ui/calendar`** — a
high-performance, generic, **controlled** Calendar & Schedule engine (Google-Calendar / Monday.com
inspired), portable + **zod-free** (a consumer maps its own domain data into the presentational
`CalendarEvent`/`CalendarAvailability` shapes and reacts to the selection/open callbacks, so the ONE
engine serves the project/channel calendar, `@handle` availability, and session schedules). The
`Calendar` island lays out a two-panel shell: a narrow left panel (`MiniMonth` mini-map — hovering a day
tints its whole week ~15%, clicking jumps the main view — over an `AvailabilityPanel` of working hours ·
timezone live clock · blackout dates) and a main viewport (`CalendarHeader` view-switch + nav + search +
privacy-safe integration chips, over the `MonthGrid`, the Week `TimeGrid`, or the infinite Day
`DayTimeline`). `useCalendarViewport` owns
the time-grid engine: **virtualized** hour cells, an initial scroll centred on the time-scale (now when
today is in view, else noon — symmetric room across both midnights via a ±3h overscroll pad), **Ctrl+wheel
zoom** that scales `--cal`-px-per-hour in place AND transitions Day↔Week↔Month across thresholds,
middle-mouse / Ctrl-drag 2D **panning** (handlers `preventDefault` so no native autoscroll/page-zoom), and
a return-to-present pill, plus an immediate scroll-signal `sync` after any programmatic scroll (so a
hidden/deferred `scroll` event never leaves a day-timeline virtualizing the wrong window). The **Week**
`TimeGrid` is the standard bounded time-of-day grid; the **Day** `DayTimeline` is a genuinely INFINITE,
virtualized continuous multi-day timeline — scroll flows seamlessly past midnight into adjacent days
endlessly (a ~4-year elapsed-time axis, only the viewport's days rendered, DST-correct via zoned day
arithmetic; inline date markers label each midnight and the centred day is tracked back to the header +
mini-map). `packDayEvents` resolves overlap into fractional side-by-side columns; the
`calendarTime` matrix utils are **timezone-explicit** (`Intl`) so SSR == the hydrated island (no drift).
§Part 1.4 privacy masking: external-integration + general-availability blocks render ONLY Available /
Busy / Tentative (never a real title); public group sessions may show an attendee counter. §B.4: grid
lines/cells/panels separate by spacing + tonal surface + single hairlines; the interactive event blocks +
day cells + controls carry the surface/accent/border + focus ring.

Cross-cutting behaviour lives in a new **package-level `packages/ui/hooks/`** (`useFloating`,
`useEdgeDetection` [alias `usePopoverPosition`], `useDismiss`, `useFocusTrap`, `useOverlayStack`
[z-index stacking + ref-counted scroll lock], `useVirtualScroll`, `useIntersectionObserver`,
`useMediaQuery`, `useRipple`, + re-exports of the value/id/list-nav hooks). Additive tokens added to
`styles/index.css`: the `--z-*` overlay-stacking scale, `--bp-*` breakpoints, and the over-damped
`--spring-*` curves. Shared collection/menu/overlay vocabulary (`MenuItem`, `TreeNode`,
`TableColumn`, `SortState`, `Placement`, `Edge`, …) lives in the package `types/mod.ts`. Overlays
render **inline with `position: fixed` + a z token** (the Select pattern), coordinated by
`useOverlayStack` — no DOM portals.

**Collision + boundary model (`useFloating` / `useEdgeDetection`).** Anchored overlays resolve in
three layers: (1) **viewport flip/clamp** — flip to the opposite side when the preferred one lacks
room, then clamp on-screen (minus `padding`); (2) **higher-level nav avoidance** (`avoid`) — a hard
constraint keeping the panel clear of primary layout chrome (the site sidebar, the header), shifting
it away (a left sidebar pushes it right); (3) **lower-level allowed overflow** (`allowOverflow`) —
the panel may spill past the named viewport edges into subordinate regions (a header search dropping
into the body/middle-nav). `avoid` accepts CSS selectors (re-measured on every reposition so
collapsed/expanded/dragged chrome stays honoured), refs, or rects. `useFloating` is the ref-consuming
engine `Popover`/`Tooltip` compose (both now take `avoid`/`allowOverflow`); `useEdgeDetection` is the
ref-owning facade a feature reaches for to hand-roll a dropdown, returning `{ triggerRef, ref, style,
placement, … }` to spread onto a panel carrying the `.ui-anchored` primitive class (fixed +
`--float-*`), so ancestor `overflow: hidden`/`clip` never truncates it.

### C.2 Engineering guidelines (merge-gated)

- **Zero framework libraries.** Raw, native, high-performance **CSS via strict BEM** only. No
  Tailwind, no CSS-in-JS, no UI-library dependencies. (Sole exception: the Part A.2 theming engine.)
- **Signal-first reactivity.** `@preact/signals` for local state; islands are "dumb" (no direct
  Supabase/DB — `fetch` internal routes only), per `SYSTEM_ARCHITECTURE.md` §2.
- **Token-only styling.** Components read `var(--*)`; never hardcode a hex, radius, duration, or
  shadow. This is what makes the package portable and theme-adjustable.

### C.3 Responsive fluidity

Every component works on **Desktop / Tablet / Mobile out of the box** using **fluid** rules —
`clamp()`/`min()`/`max()` for type & spacing, container queries where a component must adapt to _its
own_ box rather than the viewport, and CSS Grid/Flex. Breakpoint tokens: `--bp-sm 480`,
`--bp-md 768` (the modal→bottom-sheet swap point), `--bp-lg 1024`, `--bp-xl 1280`.

### C.4 Media asset infrastructure

- **Open-source fallbacks.** Placeholders/fallbacks map to external open registries (e.g.
  **Unsplash** `https://images.unsplash.com/...` for imagery/video streams). Fallback source URLs
  are centralized in `packages/ui/system/asset-registry.ts`, never inlined per component.
- **Aspect-ratio enforcement (strict).** Logos, user avatars, and org/branding marks use the
  `AspectRatio` primitive with two enforced variants (resolved 2026-07-12 to match `PRODUCT_SPEC.md`
  §Visual Identity — the SSOT): **1:1** (icon-only — favicons, avatars, profile placeholders) and
  **7:2** (wordmark — primary header navigation / branding marks). The earlier "3:1" figure from the
  brief is superseded; 7:2 is the actual wordmark lockup geometry.

### C.5 Performance-first Tables & Charts

- **Virtualization primitives.** Infinite-scrolling panes virtualize rows (1D) and masonry (2D):
  gap-detection data manager + `ResizeObserver` variable heights + `@preact/signals` `batch()` (the
  existing Data package architecture, re-homed under `display`).
- **Intelligent SVG ↔ Canvas switch.** Complex charting grids (**Gantt**, **Pipeline flows**) switch
  between **SVG** (few entities: crisp, stylable, accessible) and **high-density HTML5 Canvas**
  (large datasets: no DOM bloat) based on a **performance metric** (entity count threshold +
  measured frame budget). A `theme-bridge` resolves `var()`/`calc()` colors to numeric values for
  the canvas/WebGL engine so charts recolor instantly when the theme shifts (§B.5). **Engine
  (resolved):** tiered **D3 (SVG/math) → Canvas2D → PIXI/WebGL**, escalating by density — see §B.5.

### C.6 ARIA & context isolation

- **Comprehensive ARIA.** Every interactive element ships correct `role`, name, state, focus
  management, and keyboard model (Dialog traps focus + `ESC`; Menu/Combobox roving tabindex; Tabs
  arrow-key model; etc.). ARIA is a merge gate, not a follow-up.
- **Nested `<DesignSystemProvider>` / `DesignSystemContext`.** A nestable context exposes the
  **active layout configuration tokens** (current mode, seed, `--radius-scale`,
  `--shadow-intensity`, a11y flags, breakpoint) so components read live config dynamically. Nesting
  scopes a subtree to a different theme (e.g. a always-dark preview pane inside a light app) by
  writing that subtree's custom properties — see §D.3.

---

## Part D — Navigation Shell (Application Layout)

Preserve the functional shell architecture; modernize its execution.

**Four navigation profiles (form-factor × auth).** The shell resolves to one of four configurations,
selected by viewport and auth state (auth is resolved **site-wide** in the global middleware so
Home/Explore render the user shell when signed in):

1. **Desktop Guest** (every guest-reachable route) — the unified floating `GuestShell`: the same
   full-width, scroll-adaptive glass `SiteHeader` (the four discovery megamenus — Helpers · Services ·
   Projects · Products) over a **full-bleed body**, plus, on routes that supply one, a **floating glass
   side nav** (the route lane — no splitter handle, a footer collapse toggle) and a **floating glass
   sub-header**. Guests never render the full-bleed `ui-shell-topbar` or the full-height
   `ui-app-shell__sidebar`.
2. **Desktop User** (site-wide incl. Explore) — the unified **L-shell** below: the header layers
   join the left sidebar; header (main + middle) carry a `--glass-blur` backdrop blur while the
   sidebar is **explicitly opaque** (no blur); regions are separated by single-edge `--hairline`
   seams.
3. **Mobile Guest** (`< --bp-md`) — compact glass header (icon mark · centered search ·
   veggie-burger → blurred side drawer of megamenu accordions); the `GuestShell`'s floating side nav
   and sub-header **drop** (header + full-bleed body only). _[Phase 2/3]_
4. **Mobile User** (`< --bp-md`) — glass header (centered search · Messages · Notifications · avatar
   → account sheet) + a persistent bottom utility nav. _[Phase 2]_

The authenticated shells (2, 4) are one composition — `UserShell` (`apps/web/features/shell/`) —
shared verbatim by the `(dashboard)` layout and the authed branch of the `(public)` layout, so there
is zero layout duplication. The guest shells (1, 3) are **likewise one composition** — `GuestShell`
(`apps/web/features/shell/`) — shared verbatim by the `(public)` layout and the guest branch of the
`/[handle]` profile layout, replacing the prior split between the marketing header and
`AppShell persona="guest"` (see D.5).

**Scroll model — native window scroll (every profile).** The shell flows in the document's **own**
scroll on every form-factor × auth profile. The root grows past the viewport (`min-block-size:
100dvh`, **no** `overflow` cap) and the **browser window** owns the single main scrollbar. The chrome
stays put by **pinning to the viewport, not by locking the document**: the top bar is `position:
sticky; top: 0`; the global sidebar and the middle-nav lane are `position: sticky` just below the top
bar (`inset-block-start: var(--shell-topbar-h)`), each capped to the remaining viewport height
(`block-size: calc(100dvh - topbar)`, `align-self: start`) with its **own** internal overflow
(`.ui-shell-sidebar__items`, `.ui-splitter__body`) so a tall rail scrolls inside itself rather than
lengthening — or scrolling away with — the page. The Green body (`.ui-page-canvas__body`,
`overflow: visible`) flows naturally: its content lengthens the document and the window scrolls it,
while in-view chrome (the channel header **band** + the chat composer **footer band**) sticks to the
viewport within that same window scroll. The nested frames use `overflow: clip` (for the rounded
corners), which does **not** establish a scroll container, so every sticky descendant resolves against
the window — one scrollbar, no nested traps. The **main window scrollbar keeps standard browser
behaviour** (always visible). Every **inner** scroll container instead gets a global **self-hiding
custom scrollbar** (`styles/index.css`, scoped `:not(html):not(body)`): a permanently transparent
track, hidden buttons/arrows, and a muted, highly-rounded pill thumb that is **invisible at rest** and
**fades in while the container is hovered _or_ actively scrolling** (and deepens when the thumb is
grabbed), token-driven `color-mix(--outline …)` — `scrollbar-color` for Firefox, `::-webkit-scrollbar-*`
for Chromium. Pure CSS has no "is-scrolling" selector, so the scroll-driven half comes from the global
**`ScrollIdle`** island (mounted once in `_app.tsx`): a capture-phase `scroll` listener stamps the
scrolled element with `[data-ui-scrolling]` for a short idle window, which the CSS reveals exactly like
`:hover`. The window scroll is skipped (a document/window scroll targets `document`, not an element), so
the main window keeps its native bar; a `@projective/ui` consumer that omits the island degrades to the
hover-only reveal.

> _History: this **reverses Decision #20's** locked-viewport model and returns to the
> native-window-scroll intent of Decision #15/#27. Decision #30 briefly re-pinned the middle-nav frame
> (internal content scroll) so its rounded corners wouldn't scroll away; **Decision #31 reverses #30**
> — the middle-nav region is back on the native window scroll, and the chat composer moves from inside
> the scrolling body to a sticky **middle-nav footer band** (`.ui-middle-nav__footer`). The old
> `.ui-page-canvas__scroll` is renamed `.ui-page-canvas__body` (it no longer scrolls — the window
> does). See root CLAUDE.md §8 Decisions #27/#30/#31._

### D.1 Desktop layout

- **Corner-curve framing.** The app frame keeps Projective's signature **rounded outer-corner
  framing** — the nested frames inset with the **fluid** `--radius-container-lg`/`-xl` curvature
  (§A.3; the body `PageCanvas` carries the largest, `--radius-container-xl`) — a recognizable,
  non-generic silhouette.
- **Visual segregation (Desktop User).** Header layers use
  `backdrop-filter: blur(var(--glass-blur))`; the left sidebar carries **no blur** (opaque
  `--surface-2`). Region seams are **organic flowing `--hairline` contours**: a single hairline on
  each nested frame's two exposed edges (top + inline-start) that **curves along the frame's large
  corner radius** rather than reading as mechanical straight lines. Because it hugs one continuous
  edge that follows the radius, it stays within §B.4 (a single hairline, not a four-sided box).
- **Dual-level navigation:**
  1. **Global website sidebar** (left, `64px` collapsed / `224px` expanded): top-level destinations
     (Home, Explore, Messages, Projects, Services & Products, Teams, Businesses, Dashboard, Wallet).
     Buttons lay out with **meticulous vertical alignment** and **consistent spatial padding** — a
     single icon column axis, equal row rhythm, labels appearing on expand without shifting the
     axis.
  2. **Page-level contextual middle nav column:** a second, context-specific column for the current
     section (e.g. within a Project: Board / Timeline / Finance / Team / Stages).
- **Collapse/expand + caching.** The rail defaults to the **slim collapsed** icon column and its
  expanded/collapsed state is cached in `localStorage` (`LocalKeys.SIDEBAR_COLLAPSED`, via
  `apps/web/utils/storage-keys.ts`). A pre-paint inline script in `_app.tsx` writes
  `:root[data-sidebar]` before first paint so the correct width renders with **no
  flash-of-wrong-state**; the `ShellSidebar` island re-syncs after hydration. The width is switched
  through one inherited custom property (`--shell-sidebar-cur-w`) rather than a rule-swap, so the
  transition animates reliably.
- **Toggle control.** A **labelless custom SVG** pinned **bottom-left** (sidebar footer): a rounded
  square framing a vertical dotted divider that **morphs** between the left edge (collapsed) and the
  right edge (expanded) via a CSS transform on `.shell-toggle__bar` — not a static icon swap.
- **Collapsed rail.** Items render as `--shell-nav-block` (48px) **square blocks** with one large
  icon. Each carries a real `@projective/ui` **`Tooltip`** (`placement="right"`, opacity fade) —
  never a native `title`. The visible label is hidden but the anchor keeps an `aria-label`, so
  icon-only items are never nameless. Icons are bespoke line glyphs (`nav-icons.tsx`) — Explore is a
  **minimalist compass**, Projects an **architectural arch structure**. (Settings was removed from
  the rail — account access lives in the header profile menu.)
- **Nested sub-links (YouTube-style).** Under **Projects**, an expandable disclosure of the most
  recently-active workspaces — each shown by its **owner's circular avatar** (never a generic icon);
  under **Dashboard**, compact quick-links. Sublinks show only in the expanded rail, keyed off a
  guide-hairline indent. The disclosure caret is **hidden in the collapsed rail**, toggles
  **vertically** (chevron down = closed, up = open), and its wrapper has **no hover background** —
  only the glyph itself transitions color.
- **Update indicators.** Micro-updates on destinations are shown as a **pulsing colored dot** (a
  visual color state), **never** a text/count badge (a `NavItem` `dot`; the visually-hidden state is
  folded into the `aria-label`). Elsewhere use `Badge dot` / `OverlayBadge`.
- **Alignment discipline:** sidebar button icons share one vertical centerline at both widths;
  padding tokens are fixed so nothing jitters between collapsed and expanded states.
- **Header element layout (Desktop User):** a strict left→right flow. _Left block_ — the Projective
  brand mark (1:1 icon) fused to the **integrated search** (`NavSearchBar` island): the same modular
  scope-selector + self-typing (typewriter) placeholder the guest header uses, sharing the
  `landing-data` scope vocabulary so selector/placeholder/`/explore?category=` stay in lockstep; it
  grows to fill the row (desktop-first — the mobile shell supplies its own search overlay). _Right
  block_ — the `UserActions` island, left→right: **Create · Notifications · Basket · User Profile**,
  every control vertically centered with **soft circular** hover highlights (`border-radius: 999px`,
  not rounded squares).
  - **Create** opens a context-aware quick-create menu (Popover): Project · Team · Business ·
    Service · Product · Article, gated on the hydrated `UserContext` exactly as the sidebar is —
    seller surfaces (Business/Service/Product) appear only for `isFreelancer` (so a
    client/buyer-only profile never sees "Create Product"), and Team is hidden inside an
    `organisation` context.
  - **Notifications** and **Basket** each open a **right-side, blurring** sliding `Drawer` (glass
    panel over the backdrop blur), fixture-backed via the thin-frontend pattern (`nav-fixtures`).
    Unseen state shows as a **pulsing dot**, never a count.
  - **User Profile** is the circular avatar; it opens a padded account menu (Popover) with **View
    profile**, the **dark/light `ToggleSwitch`** (relocated here entirely — it no longer sits loose
    in the header), a **Log out** action, and an **icon-only Settings** button with a circular hover
    highlight.
  - **Collapse toggle placement:** the sidebar's dotted collapse/expand control is pinned so its
    centre stays on the shared 32px icon axis at **both** rail widths — centered within the
    collapsed rail and holding the identical absolute x when expanded (only the dotted divider
    inside it slides; the button never jumps).
  - **Collapsed-rail tooltips** float above the body panel on a lifted stacking context (the rail
    carries `position: relative; z-index: --z-sticky`) and are vertically centered on their link; expanded-rail
    labels use a **medium** weight with **bolder** glyph strokes for a readable, high-end tone.

### D.2 Middle-nav Flex Splitter

The divider between the middle nav column and the main content is an **active, drag-responsive
Splitter island** (not a static rule). It reflows the middle column into three
**pixel-column-driven** layouts (spring: `--spring-standard`, §B.5):

| Width band             | Layout                      | Content                                  |
| :--------------------- | :-------------------------- | :--------------------------------------- |
| **Collapsed** (narrow) | **Vertical icon-only rows** | Single icon column, tooltips on hover    |
| **Moderate**           | **Icon matrix**             | Multi-column icon grid with short labels |
| **Maximized** (wide)   | **Full master-detail**      | Rich list + detail pane data layout      |

The Splitter is keyboard-accessible (`role="separator"`, `aria-orientation`, arrow-key resize),
persists its width (per `SYSTEM_ARCHITECTURE.md` caching: local storage), and drives layout via a
signal bound to a `--middle-nav-w` custom property so the reflow is a single synchronized
transition. Beyond drag, `useSplitter` accepts an opt-in **`collapseEventName`**: a window
`CustomEvent` (dispatched by lane chrome such as the Projects lane's footer toggle) collapses the lane
to its rail (`min`) or restores the last expanded width — the programmatic equivalent of dragging the
handle shut, matching the main-nav rail toggle. Off by default so the package stays portable.

### D.3 Mobile adaptive navigation

Below `--bp-md` (768px) the frame adapts:

- **Strict viewport isolation.** The desktop shell mechanics are **completely stripped** on mobile —
  no global sidebar, no middle-nav lane, no nested `ShellFrame` chrome. Every `ShellFrame`
  **flattens** (`--frame-radius: 0`, all `--hairline` seams removed) and the AppShell/MiddleNav
  content **gutters collapse to 0**, so the body is a single **full-width, un-nested,
  native-scrolling** column. Only three things render: the glass mobile header, the flat main body,
  and the fixed `BottomNav`. This is pure CSS `@media` (no JS breakpoint / conditional render), so
  switching viewports never shifts layout or overlaps containers.
- **Backdrop-filter blur** surfaces (header/drawer/sheet use `backdrop-filter: blur()` over
  content).
- **Mobile-User header (`UserActions`).** Below `--bp-md` the trailing tray swaps its set via
  `.shell-util__slot--desktop`/`--mobile` (pure CSS — no JS breakpoint branching, so no hydration
  mismatch): the desktop **Create · Basket · Profile-Popover** give way to **Messages ·
  Notifications · Profile-avatar**. The avatar toggles a right-side **account side-sheet**
  (`Drawer`) — profile · switch profiles · settings · dark-mode · log out — instead of the desktop
  Popover; the same `accountBody` feeds both so they never drift. (The integrated search is hidden
  here pending the mobile search overlay.)
- **Pull-out drawer side-menu** (the global sidebar becomes a `NavigationDrawer`, slides from the
  edge, focus-trapped).
- **Ergonomic bottom utility nav bar** — the `BottomNav` component (`@projective/ui/navigation`): a
  `position: fixed`, glass (blurred), single-top-hairline bar of **exactly five** thumb-reachable
  primaries — **Home · Explore · Create · Workspace** (Projects/Services) **· Dashboard** — each an
  icon + short label with an active tint and a pulsing update-dot (never a count). It is
  **mobile-only** (`display: none` ≥ `--bp-md`), so the shell renders it unconditionally; the page
  reserves `--shell-bottomnav-h` (+ `env(safe-area-inset-bottom)`) of trailing space so content
  never hides behind it. Icons are supplied by the app (`bottom-nav-model.tsx`) — the package stays
  icon-agnostic. Modals/side-panels auto-replace with the **bottom sheet** at this breakpoint.

Nested `<DesignSystemProvider>` (§C.6) lets the mobile shell (e.g. a blurred overlay) carry its own
scoped tokens without affecting the page beneath.

### D.4 Channel / chat view chrome

Inside an open engagement, the `/projects/[project-id]/[channel-id]` view mounts its header into the
**middle-nav frame's configurable header band** rather than rendering an independent header inside the
scroll flow. The `MiddleNav` frame is a two-row grid: the **lane spans both rows** on the left, while
the right (content) column splits into an optional **`header` band** (`.ui-middle-nav__header`, row 1)
above the content canvas (row 2). The **shell layout fills the band per route** — a pure resolver keyed
on the URL (`channelHeaderFor`, the sibling of the lane's `laneFor`), not a client context (which could
not paint it on the first SSR byte). On a specific channel engagement it holds the app-level
`ChannelHeader`; on every other route the band is **omitted entirely**, so the row collapses and the
canvas fills the top of the frame with **no reserved space / no empty bar**. Crucially the band sits
**flush against the lane on the shared Blue `--surface-1` frame + top curve**, so it and the lane's own
Back/kebab header (sized to the same `--shell-midnav-header-h`) read as **ONE connected strip across the
whole middle-nav frame** — the header is attached to the same surface/curve as the sidebar, not floating
inside the content pane. The routed tab body + `ChatComposer` flow in the canvas beneath it:

- **Configurable header band (top).** A single row pinned `position: sticky` at the top-bar offset,
  spanning the content column of the frame — the active channel's identity (kind glyph / DM avatar +
  title + presence/activity sub-line) on the left, the contextual **view tabs** (Chat · Files · Members
  [· Submissions | Calendar] [· Tasks], format-gated) in the centre, and icon-only actions (primary
  create · details drawer · star · kebab) on the right. It is **not** a boxed toolbar — a single
  `--hairline` `border-block-end` continues the seam across from the lane header (§B.4). The band
  (`.ui-middle-nav__header`) owns the sticky positioning; `ChannelHeader` itself is a plain in-flow strip
  on `--surface-1` that fills it. `PageCanvas` no longer carries a header slot of its own.
- **Underlined tabs.** Tabs are **plain text items**, no pill/box background. The active (and hover)
  indicator is a 2px `--primary` underline (`::after`, `scaleX` transform, jump-to-final under
  reduced-motion) pinned to the header's bottom edge (`inset-block-end: -1px`) so it sits **precisely
  on top of the divider hairline** — a seamless tab-to-body seam. Tabs are real anchors into the
  nested routes (`.../[channel-id]/{chat,files,members,submissions,calendar,tasks}`), so the active
  tab is URL-driven and deep-links land correctly. On mobile the labels collapse to their leading
  glyph.
- **Composer footer band (bottom, Chat-only).** The blurred message input (`ChatComposer` —
  auto-growing field, attachment/paste chips, voice recorder, dynamic Mic→Send→Stop control) is the
  content of the **middle-nav frame's configurable `footer` band** (`.ui-middle-nav__footer`), a sibling
  of the header band that is `position: sticky; inset-block-end: 0` at `--z-sticky` under the native
  window scroll — so it locks to the viewport bottom while the message stream scrolls in the window
  beneath it (Decision #31). It is resolved per route by `channelFooterFor` and threaded through
  `UserShell.middleNavFooter` → `MiddleNav.footer` **only for the Chat tab** (nothing to compose on
  Files/Members/…), mirroring the header slot exactly. `.chat-composer` itself is only
  `position: relative` (the containing block for its scrim/drop overlays); its `--glass-blur` scrim
  stays on a separate underlay element (the fixed-overlay trap, root CLAUDE.md §8/§9).
- **Native window scroll for the middle-nav region (Decision #31, reverses #30).** The middle-nav frame
  is NOT pinned — it flows in the native window scroll like the rest of the shell. The frame is a
  three-row grid (header band · content · footer band; the lane spans all three); the header band
  (`sticky` at `--shell-topbar-h`) and footer band (`sticky; bottom: 0`) pin to the viewport while the
  content flows and lengthens the document. `.ui-page-canvas__body` (renamed from `__scroll` — no longer
  a scroll container) is a flex column so the channel view + chat feed can `flex: 1` to fill the content
  row and bottom-anchor a short conversation just above the composer. **Mobile** keeps the native window
  scroll and drops the frame chrome (Part D.3).
- **Bottom-up, window-virtualized message feed (Chat tab).** The Chat body is the `ChatFeed` island: it
  virtualizes the stream against the **window** (`useVirtualScroll` `useWindow`), opens at the newest
  message, and loads OLDER history as the viewer scrolls up (a top IntersectionObserver sentinel → thin
  `MessagesService` page → prepend, re-anchored by the exact document-growth delta so the view stays
  put). Rows are keyed by message id so a head-prepend never corrupts the offset table (variable message
  heights are measured at runtime). Grouping (same author within 10–30 min): reduced separation, one
  avatar + name on the group's first row, and corner masking (others sharpen the group-toward LEFT
  corners; own the RIGHT). Own messages align right, others left; bubbles cap at `max-width: 60%`. Hover
  reveals the sent time (always in the DOM, opacity-toggled — no layout shift) + a Reply·React·Copy
  toolbar and a `…` menu (Pin·Favourite·Report; Pin gated by server-derived `canPin` — anyone in a DM,
  owner-granted in a project/team channel). A favourited message carries a custom **"wonky star"** mark
  on its bubble border. Media lays out as an aspect-ratio row (≤3 visual media) or a rounded-square grid
  (mixed/overflow, **max 4 tiles**, the 4th a `+N` overlay); audio memos reuse the composer's waveform
  visualizer; system-activity notices render inline and route to their target on click. Up to **3
  pinned** messages sit in a sticky banner (one at a time, `‹`/`›` loop, Expand, and jump-to-message).
- **Channel-tree icons (§B.6).** Stage channels render as ordinary **`#` hash channels** (matching
  General/Team rows), not a coloured lifecycle dot; their state surfaces through the trailing
  icon-only status signal + unread dot. DM/team rows keep their **circular avatar** thumbnail.

### D.5 Guest floating shell

For **guests** the shell is not the nested L-frame — it is one floating composition, `GuestShell`
(`apps/web/features/shell/`), used verbatim on every guest-reachable route (the `(public)` surfaces
and `/[handle]`). It layers floating, glassmorphic panels over a **full-bleed body**, reusing the
marketing `.site` / `.site__main` base (the fixed → pill-on-scroll `SiteHeader`, the reserved header
band, and `overflow-x: clip`), so lane-less routes (`/`, `/explore`) are structurally unchanged:

- **Floating pill header.** The unchanged `SiteHeader` (full-width, morphing to a glass pill on
  scroll, discovery megamenus intact) is the top chrome on **all** guest routes — replacing both the
  prior marketing-only header and the guest `AppShell` `ui-shell-topbar`.
- **Floating side nav (route-driven).** When a route supplies a lane (today: the profile action
  lane), it mounts in a floating `.ui-guest-aside` (`position: fixed`, rounded, glass) — the guest
  counterpart of the middle-nav lane, but with **no drag-resize splitter handle**. Collapse/expand is
  the lane's own footer toggle, driving the same `MIDDLE_LANE_TOGGLE_EVENT`; the state is cached
  (`LocalKeys.GUEST_NAV_COLLAPSED`) and expressed on the **pre-painted** `:root[data-guest-nav]`
  (mirroring the authed rail's `:root[data-sidebar]`), so the width + the lane's rail/full
  presentation paint correctly on the first byte (no flash-of-wrong-width).
- **Floating sub-header (route-driven).** A route sticky header (the profile `ProfileStickyHeader`)
  mounts in a floating `.guest-shell__subheader` beneath the site header, adjacent to the side nav,
  revealed on scroll. It overlays the body (no reserved band).
- **Glass on a `::before` underlay.** Both floating panels carry their `backdrop-filter` on a
  `::before` (not the element), so neither becomes a containing block for the `position: fixed`
  overlays the lane renders (the profile kebab Popover) — the same fixed-overlay-trap fix as
  `.ui-shell-topbar--glass::before` (root CLAUDE.md §8 #8/#9).
- **Mobile (`< --bp-md`).** The floating side nav + sub-header `display: none`; the body gutters
  collapse — header + full-bleed native-scrolling body only (Part D.3).

Content chrome written for the authed frame (the profile tab/meta-rail sticky offsets, which assume
`--shell-topbar-h + --shell-midnav-header-h`) is re-based under `.guest-shell` to the site-header
height `--site-header-h`.

---

## Part E — Contracts & merge gates (summary)

A PR touching `@projective/ui` must satisfy (enforced via root `CLAUDE.md`):

1. Token-only styling — no literal colors/radii/durations/shadows.
2. BEM class naming; no framework CSS; no CSS-in-JS.
3. Separation-hierarchy rule (§B.4) — full borders on interactive elements only.
4. Reduced-motion + the four a11y overlays (§A.5) honored; comprehensive ARIA.
5. Responsive at Desktop/Tablet/Mobile without app-side overrides.
6. New/changed component ⇒ its entry in the §C.1 roster + this spec updated **in the same change.**

---

_Related: [`PRODUCT_SPEC.md`](../business/PRODUCT_SPEC.md) §Visual Identity ·
[`SYSTEM_ARCHITECTURE.md`](../architecture/SYSTEM_ARCHITECTURE.md) §UI ·
[`PRODUCT_MANAGEMENT.md`](../PRODUCT_MANAGEMENT.md) ·
[`packages/ui/CLAUDE.md`](../../packages/ui/CLAUDE.md)_
