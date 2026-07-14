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
  Rounding") · `--radius-lg 12px` · `--radius-xl 16px`, each multiplied by `--radius-scale`.
- **Elevation ramp:** Low `0 2px 4px /.05` · Medium `0 4px 12px /.1` · High `0 8px 24px /.15`, each
  scaled by `--shadow-intensity`. Reserved: Low = cards, Medium = hover/sidebar header, High =
  modals/popovers.
- **Sizing:** header `48px`, sidebar `64px` collapsed / `224px` expanded, input height `40px`. All
  spacing/type in **`rem`** for zoom & user font-scaling (per spec §Accessibility).

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

---

## Part C — Component Library Architecture (`@projective/ui`)

A single, decoupled, **copy-paste-portable** umbrella package (`packages/ui/`) with **multi-export
sub-paths** declared in `deno.json` (`packages/ui/deno.json`). It plugs into external projects
verbatim because every component depends only on the token contract (Part A) — no app coupling.

### C.1 The seven taxonomies (authoritative roster)

| Sub-path                        | Components                                                                                                                                                                                                                                                                                                                                                                                                                            |
| :------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`@projective/ui/layout`**     | Box, Container, Grid, Row, Column, Stack, AspectRatio, Divider, Separator, Panel, Fieldset, Toolbar, ScrollPanel, Splitter (+SplitterPanel), Stepper (+StepperPanel), MeterGroup                                                                                                                                                                                                                                                       |
| **`@projective/ui/navigation`** | AppShell, ShellFrame, ShellTopBar, ShellSidebar, MiddleNav, PageCanvas, NavItem, Link, MiddleNavSplitter, MobileMenu, Menu, Menubar, MegaMenu, TieredMenu, PanelMenu, SlideMenu, ContextMenu, Breadcrumb, Steps, TabMenu, TabView (+TabPanel), Paginator (alias Pagination)                                                                                                                                                            |
| **`@projective/ui/fields`**     | Button, SplitButton, SpeedDial, InputText, Textarea, InputNumber, InputMask, Password, InputGroup(+Addon), FloatLabel, IftaLabel, IconField(+InputIcon), Checkbox, TriStateCheckbox, RadioButton, RadioGroup, ToggleSwitch (alias InputSwitch), ToggleButton, SelectButton, Rating, Select (alias Dropdown), MultiSelect, Listbox, AutoComplete, Chips, TreeSelect, CascadeSelect, Slider, Knob, DatePicker, ColorPicker, FileUpload, FormControl |
| **`@projective/ui/display`**    | Table, TreeTable, Tree, DataView, VirtualScroller, Scroller, OrgChart, Timeline, GMap, Card, Avatar, AvatarGroup, Badge (+OverlayBadge), RatingStars, Chip, Tag, List, ListItem, Accordion (+AccordionTab), Carousel, Galleria, Image                                                                                                                                                                                                               |
| **`@projective/ui/feedback`**   | Message, Messages, Alert, Banner, Toast, Dialog, DynamicDialog, ConfirmDialog, ConfirmPopup, Drawer (alias Sidebar), Tooltip, Popover (alias OverlayPanel), ProgressBar, ProgressSpinner, ProgressRing, Spinner, Loader, Skeleton                                                                                                                                                                                                      |
| **`@projective/ui/overlay`**    | Backdrop, Overlay, HoverCard, Portal (+ `usePresence`)                                                                                                                                                                                                                                                                                                                                                                                |
| **`@projective/ui/utils`**      | CommandPalette, Kbd, ScrollArea, ScrollTop, EmptyState, BlockUI, Inplace, Terminal, Captcha, FocusTrap, Defer, AnimateOnScroll, Ripple                                                                                                                                                                                                                                                                                                |

> These supersede the deprecated `atoms/charts/data/time/files/system` split (see
> `SYSTEM_ARCHITECTURE.md` Restructure Change Log). Migration note: the former Fields/Data/Charts
> package docs describe existing implementations now re-homed under these sub-paths.

**Implementation status:** `layout` is built and consumed by the app — Box, Container, Grid, Row,
Column, Stack, AspectRatio, Divider, Separator (`packages/ui/layout/`, zero-JS server components;
token-only BEM; `--space-*`/`--container-*`/`--font-*` tokens added to `styles/index.css`).

`navigation` ships the **nested shell layout engine** (Part D): AppShell (Red) → MiddleNav (Blue) →
PageCanvas (Green) with the ShellFrame exposed-corner curvature (top-left always; bottom-left when a
parent track remains), persona/device gates (guest/mobile hide the sidebar and switch the top bar to
a `--glass-blur` glass header), plus ShellTopBar, ShellSidebar, NavItem, Link, the
`MiddleNavSplitter` and `MobileMenu` islands, and the `useSplitter`/`useFlushBottom`/`useMediaQuery`
hooks (`packages/ui/navigation/`, wired into the app's group layouts). Shell tokens
(`--radius-container-lg`, `--glass-blur`, `--shell-*`) added to `styles/index.css`. The **wayfinding
atoms** now ship alongside the shell (`navigation/islands/` + `components/`): Menu, Menubar, MegaMenu,
TieredMenu, PanelMenu, SlideMenu, ContextMenu (cascading submenus over the shared `MenuItem` model +
`navigation/core/menu.ts` helpers), Breadcrumb, Steps, TabMenu, TabView (+TabPanel), and Paginator
(alias Pagination) — full WAI-ARIA menu/tab/menubar keyboard models, `useFloating`/`useDismiss`
anchoring, and reduced-motion ink-bar transitions.

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

- **`display`** — the performance-first collections (Table with sort/multi-sort, per-column filter,
  row selection + expansion, column resize/reorder, row grouping, conditional styling, lazy loading
  and `stateKey` persistence; TreeTable; Tree with checkboxes/drag-drop/filter/context-menu; DataView
  list⇄grid; VirtualScroller; Scroller) all window rows through the package-level
  `hooks/useVirtualScroll` (fixed **or** measured sizes; **own-container OR window scroll**; infinite
  `onReachEnd`). Plus OrgChart, Timeline, GMap (dumb embed wrapper — no keys), Carousel, Galleria,
  Image (zoom/rotate/fullscreen), and the content atoms (Card, Avatar/AvatarGroup, Badge/OverlayBadge,
  RatingStars — a zero-JS read-only star meter, the display counterpart to the interactive `fields`
  Rating — Chip, Tag, List/ListItem, Accordion).
- **`feedback`** — Message/Messages/Alert/Banner, Toast (+`useToast`), the Dialog family
  (Dialog/DynamicDialog + `useDialog`/ConfirmDialog/ConfirmPopup), Drawer (alias Sidebar, bottom-sheet
  under `--bp-md`), Tooltip, Popover (alias OverlayPanel), and the progress/placeholder set
  (ProgressBar/Spinner/Ring, Spinner/Loader, Skeleton).
- **`overlay`** — Portal (fixed-layer, no `preact/compat`), Backdrop, the generic controlled Overlay,
  HoverCard, and the `usePresence` enter/exit helper.
- **`utils`** — CommandPalette, Kbd, ScrollArea, ScrollTop, EmptyState, BlockUI, Inplace, Terminal,
  Captcha (dumb mount point), and the directives FocusTrap, Defer, AnimateOnScroll, Ripple.

Cross-cutting behaviour lives in a new **package-level `packages/ui/hooks/`** (`useFloating`,
`useDismiss`, `useFocusTrap`, `useOverlayStack` [z-index stacking + ref-counted scroll lock],
`useVirtualScroll`, `useIntersectionObserver`, `useMediaQuery`, `useRipple`, + re-exports of the
value/id/list-nav hooks). Additive tokens added to `styles/index.css`: the `--z-*` overlay-stacking
scale, `--bp-*` breakpoints, and the over-damped `--spring-*` curves. Shared collection/menu/overlay
vocabulary (`MenuItem`, `TreeNode`, `TableColumn`, `SortState`, `Placement`, `Edge`, …) lives in the
package `types/mod.ts`. Overlays render **inline with `position: fixed` + a z token** (the Select
pattern), coordinated by `useOverlayStack` — no DOM portals.

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

### D.1 Desktop layout

- **Corner-curve framing.** The app frame keeps Projective's signature **rounded outer-corner
  framing** (the canvas insets from the viewport with `--radius-xl` outer corners) — a recognizable,
  non-generic silhouette.
- **Dual-level navigation:**
  1. **Global website sidebar** (left, `64px` collapsed / `224px` expanded): top-level destinations
     (Home, Explore, Projects, Messages, Wallet, …). Buttons lay out with **meticulous vertical
     alignment** and **consistent spatial padding** — a single icon column axis, equal row rhythm,
     labels appearing on expand without shifting the icon axis.
  2. **Page-level contextual middle nav column:** a second, context-specific column for the current
     section (e.g. within a Project: Board / Timeline / Finance / Team / Stages).
- **Alignment discipline:** sidebar button icons share one vertical centerline at both widths;
  padding tokens (`--nav-pad-x`, `--nav-row-h`) are fixed so nothing jitters between collapsed and
  expanded states.

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
transition.

### D.3 Mobile adaptive navigation

Below `--bp-md` (768px) the frame adapts:

- **Backdrop-filter blur** surfaces (header/drawer/sheet use `backdrop-filter: blur()` over
  content).
- **Centered micro search bar** in the header (compact, centered).
- **Pull-out drawer side-menu** (the global sidebar becomes a `NavigationDrawer`, slides from the
  edge, focus-trapped).
- **Ergonomic bottom utility nav bar** (thumb-reachable primary destinations), with
  modals/side-panels auto-replaced by the **bottom sheet** (`MobilePopup`) at this breakpoint.

Nested `<DesignSystemProvider>` (§C.6) lets the mobile shell (e.g. a blurred overlay) carry its own
scoped tokens without affecting the page beneath.

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
