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

| Token                   | Light       | Dark                                            | Role                                                   |
| :---------------------- | :---------- | :---------------------------------------------- | :----------------------------------------------------- |
| `--brand` / `--primary` | `#288690`   | `#288690` (tonal-lifted for contrast, see §A.2) | Primary action, active state                           |
| `--success`             | `#268C66`   | tonal                                           | "Complete" / approved                                  |
| `--warning`             | `#D98216`   | tonal                                           | "In Progress" / time-sensitive                         |
| `--danger`              | `#D94141`   | tonal                                           | "Incomplete" / error / no-show                         |
| `--info`                | `#3D7BD9`   | tonal                                           | Neutral-informational state (Ready / To do / advisory) |
| `--bg`                  | `#FAFAFA`   | `#1A1A1A`                                       | Primary canvas                                         |
| `--surface`             | `#FFFFFF`   | `#212121`                                       | Elevated cards/headers/sidebar                         |
| `--text-main`           | `#1A1A1A`   | `#FFFFFF`                                       | Body & headings                                        |
| `--text-secondary`      | `#666666`   | `#B3B3B3`                                       | Labels, muted info                                     |
| `--text-disabled`       | `#B3B3B3`   | tonal                                           | Non-interactive                                        |
| `--border-subtle`       | `#E6E6E6`   | tonal                                           | Razor-thin indicators only (§B.4)                      |
| `--focus-ring`          | `#28869066` | `#28869066`                                     | 3px focus glow, all focusable elements                 |

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
   - Light: `primary = P.tone(45)`, `on-primary = P.tone(98)`, `surface = N.tone(100)`,
     `on-surface = N.tone(10)`, `outline = NV.tone(50)`.
   - Dark: `primary = P.tone(80)`, `on-primary = P.tone(20)`, `surface = N.tone(6)`,
     `on-surface = N.tone(90)`, `outline = NV.tone(60)`.

   **The invariant is straddling mid-tone, not the size of the gap.** A pair must sit on opposite
   sides of tone 50 with a gap of ~60 tones. This is stated precisely because the looser reading —
   "any wide delta guarantees ≥4.5:1" — is false and the engine once shipped against it: dark
   `primary = P.tone(60)` with `on-primary = P.tone(98)` is a 38-tone gap that is still
   light-on-light, and computes to **3.02:1**, below AA, on every filled button, badge and chip in
   dark mode. The documented pair above computes to **7.74:1** (AAA). Any change to a tone selection
   is verified by reproducing `buildScheme()` against the real seed and printing WCAG ratios for
   every `on-`/base pair in all four modes — never by eye.
4. **Emit CSS variables.** The engine serializes selected tones to `--primary`, `--on-primary`,
   `--surface-1…5`, `--outline`, etc., and sets them on `:root` (and on any nested
   `<DesignSystemProvider>` scope, §D.3).

```ts
// packages/ui/system/theme-engine.ts  (engine only — never imported by a component)
import { argbFromHex, CorePalette, hexFromArgb } from "@material/material-color-utilities";

/** Generate the token map for one seed + mode, ready to write to CSS custom properties. */
export function buildScheme(
	{ seed, dark, highContrast = false }: ThemeInput,
): Record<string, string> {
	const core = CorePalette.of(argbFromHex(seed)); // a1 P · a2 · a3 · n1 N · n2 NV
	const hx = (argb: number) => hexFromArgb(argb);
	return dark
		? {
			"--primary": hx(core.a1.tone(80)), // straddles mid against on-primary tone(20)
			"--on-primary": hx(core.a1.tone(20)),
			"--surface": hx(core.n1.tone(6)),
			"--surface-1": hx(core.n1.tone(10)),
			"--on-surface": hx(core.n1.tone(90)),
			"--outline": hx(core.n2.tone(60)),
			// …secondary/tertiary + fixed-hue success/warning/danger/info from their own seeds.
		}
		: {
			"--primary": hx(core.a1.tone(45)),
			"--on-primary": hx(core.a1.tone(98)),
			"--surface": hx(core.n1.tone(100)),
			"--surface-1": hx(core.n1.tone(96)),
			"--on-surface": hx(core.n1.tone(10)),
			"--outline": hx(core.n2.tone(50)),
		};
}
```

**High-contrast (§A.5)** widens the tonal separation on **both sides of every pair**, re-deriving
them at a wider gap with **zero component changes**. Two rules make it work:

- **Direction comes from the mode, not from the tone's own position.** A foreground widens toward
  the end opposite its background — up in dark, down in light. Keying off the tone instead
  (`t < 50 ? t - 8 : t + 8`) is mode-blind, and light-mode `--outline` sits at exactly tone 50: it
  took the "lighter" branch and dropped from 4.27:1 to **3.24:1**, so the accessibility overlay
  degraded the token it was meant to rescue. An `on-` role's background is the filled role it sits
  on, so it widens the other way.
- **The widening reaches every foreground role**, including the semantic ramps — `--success` /
  `--warning` / `--danger` / `--info` were previously byte-identical in high contrast, so a third of
  the palette opted out of the overlay. `--border-subtle` is promoted to the `--outline` tone here,
  as this section's table promises. **Surfaces are deliberately left alone:** widening a light ramp
  of 100/96/94/92 clamps its top steps to the same white and destroys the elevation ramp, which is
  itself a §B.4 separation tier.

The step is **12 tones** — the smallest value that lifts every text pair in both modes to the ≥7:1
this section promises (at 8, the light primary link lands at 6.88:1 and 6.19:1 on tinted surfaces).
The full implementation (semantic ramps, focus-ring alpha, the
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
  - **`--radius-md` is an alias of `--radius-base`**, not a seventh step. The ramp's third step is
    named `base`, but a ramp reading `xs / sm / … / lg / xl` reads as if position three were `md`,
    so authors reached for `var(--radius-md)` — which resolved to nothing and computed
    `border-radius` back to its initial `0`, rendering square. The alias is emitted so the trap
    cannot fire again; prefer `--radius-base` in new code, and never give `md` a distinct value.
  - **`--radius-full 999px`** is the terminal **pill** step and the only one **not** multiplied by
    `--radius-scale`. Every other step is a curvature _amount_ and the knob is right to scale it; a
    pill is a _shape_, and `--radius-scale: 0` would square every chip, switch and avatar frame
    while the `border-radius: 50%` circles beside them stayed round. **`50%` is a separate idiom** —
    the circle, tied to the element's own box — and is deliberately not tokenised into the radius
    ramp.
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
  color-mix(in srgb, var(--outline) 20%, transparent)`) — a razor-thin,
  low-contrast **single-edge** seam (§B.4). Applied on ONE edge only (header↔body, sidebar↔body
  region seams), never as a four-sided box on non-interactive content. **20%, not 40%** — this
  section documented 40% while the code shipped 20%, a 2× discrepancy on §B.4's most-used separation
  tier, and 19 consumers then re-derived the mix by hand at 16/18/20/22/24% so the seam had no
  single visual weight anywhere in the app. Reconciled to the code; every consumer now reads the
  token.
  - **`--hairline-strong` (`--outline` at 40%)** is the visible sibling, for a real border on an
    **interactive** element — the only place §B.4 permits a full box. It exists because two features
    had independently re-derived exactly that value (`--lp-hair-strong`, `--ex-hair-strong`). A raw
    `color-mix` against `--outline` in a PR is now a finding: one of these two tokens is meant.
- **Elevation ramp:** Low `0 2px 4px /.05` · Medium `0 4px 12px /.1` · High `0 8px 24px /.15`, each
  scaled by `--shadow-intensity`. Reserved: Low = cards, Medium = hover/sidebar header, High =
  modals/popovers.
- **Card rhythm — `--card-pad` / `-media` / `-tight`, `--card-gap` / `-tight`, `--card-radius` /
  `-media`, `--card-media-ratio` / `-square`.** The padding, gap, corner and media proportion every
  card family reads. It lives in `packages/ui/styles/index.css` rather than in `display/card.css`
  because component CSS reaches a page **only through an island bundle**, while the token sheet is
  imported unconditionally by `apps/web/client.ts` — so a server-rendered card family can consume
  the contract even where it cannot consume the component. That gap is why every family had
  re-derived its own values and why no two agreed: five body paddings, seven radii and three media
  ratios across eight families. **Two densities, deliberately not one:** a CONSOLE card is text-led
  and scanned in bulk (roster rows, file tiles, listing cells); a MEDIA card is image-led and
  scanned one at a time (explore, marketing), and takes the larger corner because `--radius-lg` on a
  16:10 photograph reads as a clipped rectangle rather than a rounded one. `--card-radius-media`
  settles a drift with no defensible origin — explore shipped `calc(var(--radius-xl) * 1.4)`
  (22.4px) and marketing `calc(var(--radius-xl) * 1.5)` (24px), two hand-tuned multipliers of the
  same token 1.6px apart, neither reachable from the ramp; `--radius-2xl` is 24px, so marketing was
  already on it by accident. A card family declaring its own radius, media ratio or body padding is
  a finding.
- **Sizing:** header `48px`, sidebar `64px` collapsed / `224px` expanded (`--shell-nav-block 48px`
  collapsed-rail square hit-target), input height `40px`. All spacing/type in **`rem`** for zoom &
  user font-scaling (per spec §Accessibility) — with the single documented exception of
  `--space-px`, below.
- **Spacing ramp:** `--space-0 0` · **`--space-px 2px`** · `--space-1 0.25rem` · `--space-2 0.5rem`
  · `--space-3 0.75rem` · `--space-4 1rem` · `--space-5 1.5rem` · `--space-6 2rem` ·
  `--space-7 3rem` · `--space-8 4rem`. Applied asymmetrically per §B.4 (more space above a heading
  than below it).
  - **`--space-px` is the sub-ramp step and the one value deliberately in `px`.** The ramp started
    at 4px, so dense chrome — segmented meters, chip rows, calendar cells, icon rails — had nowhere
    to go and reached for a literal, 134 times. It is a graphical **seam** between adjacent marks,
    not content rhythm: content spacing should grow when a reader scales their type, a seam should
    not, or at 200% zoom a 2px hairline becomes a 4px hole in a bar meant to read as one object.
    Both feature token layers had independently invented the identical token (`--wlt-seg-gap`,
    `--wsp-seg-gap`), which is what earned it a place in the global contract.
- **Surface structure (promoted from the feature layers).** `--track-recessed` · `--track-meter` ·
  `--hatch-color` · `--track-h 18px` / `--track-h-hi 24px` · `--pip-dot 7px` · `--band-gap` ·
  `--band-pad-block-end`(`-lg`) · `--row-h 3rem` / `--row-h-dense 2.25rem` · `--rig-row-h 1.75rem` ·
  `--chart-h 11rem` / `--chart-h-sm 9rem` · `--drawer-w min(30rem, 92vw)` · `--field-max 28rem` ·
  `--minor-size 0.55em` / `--minor-fade 0.62`. The **promotion rule** is the point: a value moves to
  this layer only when two feature layers written independently arrived at it **without knowing
  about each other**. That agreement is the evidence it is global; a value used once, however
  sensible, stays feature-local. `--hatch-color`, `--track-recessed` and `--minor-fade` carry their
  `data-contrast="high"` widening with them. Deliberately **not** promoted: the two sliver
  thresholds and the two overspend tints, which disagree for real reasons.

### A.4 Typography

Families via `--font-sans` (UI), `--font-mono` (code/`Kbd`), and the **accessibility-swappable**
`--font-reading` (see §A.5). Weight/size/tracking are the primary hierarchy tools — this is
load-bearing for the border-avoidance strategy in Part B.4, which means every one of those three
channels has to actually render.

- **Size — `--text-2xs … --text-3xl`**, all in `rem`. It is deliberately **two ramps end to end**,
  and the contract says so rather than claiming a single ratio: `2xs 0.6875` · `xs 0.75` ·
  `sm 0.8125` · `md 0.875` step by one pixel because the product is a dense console whose registers
  are separated by tracking, weight and case as much as by size; `base 1` · `lg 1.125` · `xl 1.375`
  · `2xl 1.75` · `3xl 2.25` then run on a ~1.25 modular ramp, where size does the work again. A
  single 1.2 ratio through the dense band would jump 11 → 13 → 16 and leave label-vs-body nowhere to
  sit. `--text-base` is `1rem` so the name keeps meaning what `rem` means; the product's dense body
  is `--text-md`, and a reading surface uses `--text-base`.
- **THE label register is `--text-xs` (0.75rem)**, uppercase, `--tracking-wide`, `--fw-semibold`.
  `--text-2xs` is micro (timestamps, counts, unit suffixes) and never a label — uppercase strips the
  ascender/descender cues a reader identifies a word by, so an all-caps label needs more size than
  lowercase at the same role, not less.
- **Leading — `--leading-tight/snug/normal/relaxed` (1.2 / 1.35 / 1.5 / 1.7)**, unitless so it
  inherits as a ratio and re-multiplies per descendant. `--leading-normal` is set on `<body>`
  alongside `--text-base`; a surface that declares neither inherits a real leading rather than the
  UA's `normal` (≈1.2), which is what wrapping empty-state copy used to get.
- **Tracking — `--tracking-tight/normal/wide` (-0.02 / 0 / 0.08em)**, floor -0.04em.
- **Weight — FIVE masters and no intermediates: `--fw-light 300` · `normal 400` · `medium 500` ·
  `semibold 600` · `bold 700`.** This is a decision. The repo ships **no webfonts at all** — no
  `@font-face`, no font asset — so `--font-sans` resolves to variable SF Pro on macOS but to static
  Segoe UI / Roboto on Windows and Android, where an intermediate snaps to the nearest installed
  master. A ramp once carrying 18 numeric weights (520/550/560/580/620/640/650/680/750…) therefore
  rendered its middle steps on one platform in three, while B.4 leaned on weight as the tier that
  replaces borders. Intermediates are not permitted; if a self-hosted variable face is ever adopted,
  these tokens are the single place a sixth step is added. `300` survives because it is a genuine
  master on all three platforms and marketing/editorial surfaces use it for display text.
- **Measure — `--measure 68ch` / `--measure-narrow 52ch`**, in `ch` so it tracks the reader's own
  font size instead of freezing at a pixel width. Every prose container reads one of these two.
- **Fluid type uses `rem + vw`, never bare `vw`.** `clamp(2.6rem, 11vw, 11rem)` ignores the reader's
  font size entirely between its bounds; `clamp(2.6rem, 1.9rem + 4vw, 6rem)` does not. A surface may
  keep genuinely local fluid display steps, but the fixed steps alias `--text-*` — that aliasing is
  what stops two feature ramps from independently reinventing the same scale and drifting.


#### The four registers — hierarchy over raw weight (merge gate)

Weight is the channel most often reached for and the one that degrades worst. The five masters above
mean "slightly bolder" **does not exist**, so a surface that expresses every level of importance
through weight collapses two or three levels onto `600`/`700` and they compete. **Hierarchy is built
from four registers, each of which moves SIZE, CASE and TRACKING together — never weight alone.** A
surface that needs a fifth register has too many levels, not a missing token.

| Register            | Size                   | Weight                | Case / tracking              | Leading                   | Carries                                                            |
| :------------------ | :--------------------- | :-------------------- | :--------------------------- | :------------------------ | :----------------------------------------------------------------- |
| **Display / title** | `--text-3xl` (2.25rem) | `--fw-medium` (500)   | sentence, `--tracking-tight` | `--leading-tight` (1.2)   | the one thing the page is about — a listing, a profile, an article |
| **Section header**  | `--text-xs` (0.75rem)  | `--fw-semibold` (600) | UPPERCASE, `--tracking-wide` | `--leading-snug`          | a section boundary that costs no ink (§B.4 tier 3)                 |
| **Body**            | `--text-base` (1rem)   | `--fw-normal` (400)   | sentence, `--tracking-normal` | `--leading-relaxed` (1.7) | prose, descriptions, scope copy — capped at `--measure` (68ch)     |
| **Meta**            | `--text-sm` / `-2xs`   | `--fw-normal` (400)   | sentence, `--tracking-normal` | `--leading-normal`        | non-actionable metadata, timestamps, counts, in `--text-secondary` |

**A title is never `--fw-bold` (700) or heavier.** At `--text-3xl` the size already carries the whole
claim, and weight on top of it produces the shouted tone this language rejects — but the structural
cost is worse than the tonal one: it spends the top of the ramp, so the next genuinely-more-important
thing on the page has no register left to occupy. Bold is reserved for a **word inside a paragraph**,
where size, case and tracking are all fixed and weight is the only channel available.

**Two adjacent elements at `600` or above are a hierarchy failure** regardless of their sizes: the
reader is being told that both are the most important thing, which is the same as being told neither
is. The fix is a register change, not a weight change — demote one to Body or Meta, or promote the
other to Display.

**Numeric columns and money read `font-variant-numeric: tabular-nums`.** A price, a balance, a seat
count or a duration that changes — on a currency switch, a re-fetch, a count-up — must not reflow the
glyphs around it; proportional digits make a figure appear to jitter while it is merely updating.

> **Merge gate.** A PR that sets a heading at `--fw-bold` or above, distinguishes two adjacent levels
> by weight alone while size / case / tracking match, or renders a changing figure in proportional
> digits, is not mergeable.
### A.5 Accessibility themes (design tokens)

Accessibility is a set of **token overlays** toggled at the framework level (a `data-a11y-*`
attribute on `:root` or a `<DesignSystemProvider>` scope), never per-component patches.

| Theme                        | Trigger                                                         | Token effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| :--------------------------- | :-------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Open-dyslexic typography** | `data-font="dyslexic"`                                          | Remaps `--font-sans`/`--font-reading`/`--font-mono` → OpenDyslexic (`local()` first, so an already-installed copy costs zero bytes); widens all three `--tracking-*`, raises all four `--leading-*`, shortens `--measure` to 55ch, collapses `--fw-*` to the face's only two masters, turns ligatures off, and replaces synthesised italics with a weight step. **The woff2 is the one asset the repo cannot ship** — see the `@font-face` snippet in `packages/ui/styles/index.css`; every other effect works without it. |
| **Color-blindness shifts**   | `data-cvd="protan\|deutan\|tritan"`                             | Swaps status hues for a CVD-safe set and **adds a non-color channel** (icon/shape/label) to every status token so meaning never rides on hue alone — success gets a check glyph token, danger a cross, etc.                                                                                                                                                                                                                                                                                                                |
| **High contrast**            | `data-contrast="high"`                                          | Drives the Material `contrast` param (§A.2) to a wider tone separation; promotes `--border-subtle` to a visible `--outline`; forces `≥ 7:1` (AAA) text.                                                                                                                                                                                                                                                                                                                                                                    |
| **Reduced motion**           | `prefers-reduced-motion: reduce` **or** `data-motion="reduced"` | Every transition/spring collapses to `0ms` **jump-to-final** (per spec §Motion Reduction); ripples and theme-crossfades disabled; only opacity/position _end states_ apply. See §B.5.                                                                                                                                                                                                                                                                                                                                      |

```css
@media (prefers-reduced-motion: reduce) {
	:root {
		--dur-fast: 0ms;
		--dur-medium: 0ms;
		--dur-slow: 0ms;
		--spring: none;
	}
	*,
	*::before,
	*::after {
		animation: none !important;
		transition-duration: 0ms !important;
	}
}
```

---

### A.6 Layout direction (RtL / LtR) — the bidirectional contract

Projective renders in **both** reading directions. Direction is a **user preference**, resolved
independently of language, and the component layer is expected to mirror **for free**.

| Concern             | Contract                                                                                                                                                                                                                                                                                                                                                                |
| :------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source of truth** | `org.user_preferences.layout_direction` — `ltr` / `rtl` / `auto`. `auto` resolves to the natural direction of the user's `locale`. Chosen **independent of language** (an RtL reader may keep an LtR locale and vice-versa).                                                                                                                                            |
| **Application**     | The resolved value is written as the document root **`dir`** attribute (`dir="rtl"` / `"ltr"`). Nothing else is toggled — no direction-specific stylesheet, no JS layout swap.                                                                                                                                                                                          |
| **Mirroring**       | Automatic, because components style with **CSS logical properties only**: `inline-size`/`block-size`, `inset-inline-*`/`inset-block-*`, `margin-inline`/`padding-inline`, `border-inline-*`, `text-align: start/end`. Under `dir="rtl"` the shell sidebar flips to the right, list chevrons/affordances mirror, and anchored overlays resolve against the writing mode. |
| **Prohibition**     | **No hardcoded physical directions** in component CSS (`left`/`right`, `margin-left`, `text-align: left`, `::before` pinned to a physical edge). Each is a migration target — convert to its logical equivalent. **No app-side per-component direction overrides** (matching the responsive rule, §C.3).                                                                |
| **Icons/glyphs**    | Direction-agnostic glyphs are untouched; **directional** glyphs (back/forward carets, progress arrows) mirror under RtL via `scale-x` on a `:dir(rtl)` / `[dir="rtl"]` scope, never a swapped asset.                                                                                                                                                                    |
| **Motion**          | Slide/enter transforms are expressed on the inline axis so they honour direction; reduced-motion (§A.5) still jumps to final.                                                                                                                                                                                                                                           |

> This is the **documentation-only contract** for the 2026-07-23 Wallet & Finance / i18n foundation
> — the DB column + preference exist; the CSS/UI mirroring pass is later work. Architecture side:
> `SYSTEM_ARCHITECTURE.md` §Internationalization, Currency & Localization. Currency/number/date
> **formatting** follows `locale`; money is stored in origin currency and displayed converted
> (presentational only).

---

### A.7 The field token layer (`--fld-*`) and the state contract (merge gate)

The `fields` sub-path ships 27 controls. An audit measured them rather than read them and found a
good spine reaching only one family: the 10 controls that compose `.ui-field` were already
pixel-identical, while the other 15 re-declared their own geometry and their own state vocabulary in
parallel — **five** disabled opacities (0.40–0.55, measuring 2.30–5.04:1), **four** option-row
heights across four sibling dropdowns (43.6 / 38.5 / 37.0 / 30.5px), **five** label typographies,
and a `MultiSelect` that stood 20px taller than every sibling when empty. This section is the single
token layer that ends that, and the state matrix every control must satisfy to ship.

**A.7.1 The layer lives on `:root`, not on `.ui-field`.** A control's label, hint, footer rig and —
since the panels now render through `BodyPortal` — its dropdown all paint **outside** the control's
subtree. A token scoped to `.ui-field` therefore falls back silently for four of five surfaces. This
is the same defect the wallet layer shipped and fixed (`--wlt-*` scoped to `.wlt` while the lane,
header band, footer rig and every portalled overlay rendered outside it); the fields layer is
`:root`-scoped from the start, and every name carries the `--fld-` prefix so a global scope costs
nothing in collisions.

**A.7.2 Geometry is shared, not coincidental.** A `Select` and an `InputText` at the same size are
pixel-identical: **32 / 40 / 48px** tall, **8 / 12 / 16px** inline padding, **6 / 8 / 12px** radius,
**13 / 15 / 17px** type. `--fld-fs-md`/`-lg` sit a half-step above their neighbours on the §A.4 ramp
**deliberately** — a value the user _typed_ is read under different conditions than a table cell
they scan. A **16px floor applies on coarse-pointer viewports** because iOS Safari zooms a sub-16px
field on focus and does not zoom back out.

**A.7.3 The canonical state matrix.** Every state declares the same **four channels — border ·
surface · ink · ring — plus a mark.** A control that cannot compose `.ui-field` (Checkbox, Slider,
Rating, Knob, ZoomSlider, ToggleSwitch…) keeps its own **shape** but reads the same channels, so a
state reaches all 27 rather than only the input family.

| State      | Border                        | Surface             | Ink                           | Ring                  | Mark (`.ui-field__mark`)         | `aria-`                           |
| :--------- | :---------------------------- | :------------------ | :---------------------------- | :-------------------- | :------------------------------- | :-------------------------------- |
| `default`  | `--fld-rest-bd`               | `--fld-rest-bg`     | `--fld-rest-fg`               | —                     | none                             | —                                 |
| `hover`    | `--fld-hover-bd`              | `--fld-rest-bg`     | `--fld-rest-fg`               | —                     | none                             | —                                 |
| `focus`    | `--fld-focus-bd`              | `--fld-rest-bg`     | `--fld-rest-fg`               | `--focus-ring-shadow` | none                             | —                                 |
| `invalid`  | `--fld-invalid-bd`            | `--fld-invalid-bg`  | `--fld-rest-fg`               | composes with focus   | `--fld-invalid-mark` · AlertMark | `aria-invalid="true"`             |
| `required` | `--fld-required-bd`           | `--fld-required-bg` | `--fld-rest-fg`               | composes with focus   | `--fld-invalid-mark` · AlertMark | `aria-invalid` **on submit only** |
| `gate`     | `--fld-gate-bd`               | `--fld-gate-bg`     | `--fld-rest-fg`               | composes with focus   | `--fld-warning-mark` · GateMark  | **not** `aria-invalid`            |
| `success`  | `--fld-valid-bd`              | `--fld-rest-bg`     | `--fld-rest-fg`               | composes with focus   | `--fld-valid-mark` · CheckMark   | —                                 |
| `warning`  | `--fld-warning-bd`            | `--fld-warning-bg`  | `--fld-rest-fg`               | composes with focus   | `--fld-warning-mark` · AlertMark | —                                 |
| `loading`  | `--fld-rest-bd`               | `--fld-rest-bg`     | `--fld-loading-fg`            | —                     | BusyMark (`--fld-loading-alpha`) | `aria-busy="true"`                |
| `readonly` | `--fld-readonly-bd`           | `--fld-readonly-bg` | `--fld-rest-fg`               | `--focus-ring-shadow` | none                             | `readonly` (**still focusable**)  |
| `disabled` | faded by `--fld-disabled-mix` | **unchanged**       | faded by `--fld-disabled-mix` | none                  | none                             | `disabled`                        |

`required`/`gate` are the two-tier creation gate (see the §C.1 note): `required` is needed **now**
to create the base record and drives the danger ramp; `gate` is optional to draft but needed to
**publish**, drives the warning ramp, and is deliberately **not** `aria-invalid` — a
soft-informative state announced as an error is a lie to a screen reader.

Four consequences a reviewer can check without opening a browser:

- **One focus treatment.** `--focus-ring-shadow` on **every** control, custom ones included.
  `--focus-ring-shadow-inset` is the only permitted variant, and only where an outset ring would be
  clipped by a segmented group's own overflow. `--focus-ring` is a **colour**, not a shadow —
  `box-shadow: var(--focus-ring)` is invalid CSS and paints **nothing**, which is how 56 controls
  once shipped with no focus indicator at all. A single accent-derived colour cannot clear 3:1
  against both the control fill and the page (the old ring measured **1.00:1** on `--primary` in
  dark), which is why the canonical value is a two-tone halo+ink composite emitted by
  `theme-engine.ts`.
- **One disabled value.** `--fld-disabled-mix` (55%, widening to 78% under `data-contrast="high"`)
  fades **ink and border, never the box**, measures **5.04:1**, and is **never** paired with
  `pointer-events: none` — which silently cancels the `not-allowed` cursor sitting beside it. It
  replaced five divergent opacities that measured 2.30–5.04:1. A state you cannot read is not a
  state.
- **Status never rides on hue** (§A.5). Each validation state paints its own
  `--fld-{invalid,valid,warning}-mark`, and the control renders it into the `.ui-field__mark` slot
  (`packages/ui/fields/styles/field.css:202`), which is **zero-width at rest** so an appearing mark
  cannot reflow the row.
- **A hit-target floor.** `.ui-hit` grows any part below `--fld-hit` (24px, WCAG 2.2 AA 2.5.8) via a
  transparent pseudo-element — the 6px slider track, 18px handle, 12px zoom handle, 20px
  checkbox/radio, 15px stepper. Density survives the floor instead of trading against it.

**A.7.4 Panels are one object.** Every dropdown shares one option-row contract — `--fld-opt-h`
(2.25rem), `--fld-opt-px`, `--fld-opt-fs`, `--fld-opt-radius` — over one panel contract:
`--fld-panel-maxh` (18rem), `--fld-panel-minw` (**12rem**), `--fld-panel-radius`,
`--fld-panel-border`. Four sibling dropdowns previously shipped four row heights (43.6 / 38.5 / 37.0
/ 30.5px), three paddings and two type sizes. The min-width is load-bearing on its own: without it a
71px trigger produced a 71px menu with every label ellipsised away. Every panel renders through
`BodyPortal` with a `useOverlayStack` index — a `position: fixed` panel that merely stays in the
tree is re-based by the glass chrome (measured: **324px** off) and clipped by the Dialog's own
`overflow: hidden` (§B.10.4).

> **Merge gate.** A `fields` PR that declares a control-local height, radius, inline padding, label
> type, disabled opacity or focus treatment instead of reading `--fld-*` is not mergeable. Nor is a
> control that implements fewer than the matrix's states, or ships an interactive part under
> `--fld-hit` without `.ui-hit`.

> **Two engine traps this layer has already hit** — both fail **silently**, so they are review
> items, not runtime errors. This engine drops `min()` and nested `calc()` inside `min-inline-size`
> (use a plain `var()`), and drops a `color-mix()` whose percentage arrives as
> `calc(var(…) * 100%)`. Hence the deliberate pair: **`--fld-disabled-mix`** (a literal `%`, for
> mixes) and **`--fld-disabled-alpha`** (unitless, for `opacity`). They are not duplicates.

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


#### B.4.1 Asymmetric spacing is the first tool, and asymmetry is the point

Tier 1 says "spacing" and gets read as "add a gap." A **symmetric** gap does not group — equal air
above and below a heading attaches it to both neighbours equally, which is exactly the ambiguity a
border was being used to resolve. The canonical ratio is **`--space-7` (3rem) above a section
heading and `--space-3` (0.75rem) below it**: the heading is pulled hard toward the content it
labels and pushed away from the section it is not part of, so ownership is unambiguous with zero
ink. Within a section, rows sit at `--space-3`/`--space-4`; between sections, `--space-7`. If those
two numbers are within 2× of each other the spacing is not doing tier-1 work and a reviewer will ask
why a hairline appeared.

#### B.4.2 The surface ladder is SOLID — tier 2 has no alpha

A tonal step means an **opaque tone from the generated ramp** (§A.2), never a translucent wash over
whatever happens to be behind it. The canvas is `--bg`; an elevated region steps to `--surface-1`
and, if a third layer is genuinely warranted, `--surface-2`. Each is a real hex the theme engine
computed against its own background, which is what makes the step measurable and stable.

A semi-transparent fill — `rgba(255,255,255,0.04)`, `color-mix(… 6%, transparent)` used as a region
background — fails in three ways at once, and all three were found in the dark-theme audit that
motivated this rule. **It is unmeasurable**: its rendered value depends on the stack beneath it, so
the same declaration reads as two different tones in two places and neither can be checked against a
contrast floor. **It compounds**: two translucent layers nested produce a third tone nobody chose,
which is how "muddy" happens — the dark theme's mid-greys converge until three nested regions are
within ~1.1:1 of each other and the hierarchy the alpha was expressing disappears. **And it invites
an outline to rescue it**: once the fill stops reading, a border gets added to restore the boundary,
and the boundary is now spending two devices (§B.9.3) to do what one opaque step did for free.

`color-mix()` remains correct for **ink, marks and states** — a chip label mixed toward
`--on-surface`, a hover tint over a known parent, a disabled ink — because those composite against a
surface the rule itself named. It is wrong as the definition of a **region's own background**.

> **Merge gate.** A non-interactive region whose `background` is a translucent colour is not
> mergeable. Use `--bg` / `--surface-1` / `--surface-2`.

#### B.4.3 Functional transparency only — where `--glass-blur` is allowed

Glass is part of the identity (§D.1, §D.5) and it is expensive: `backdrop-filter` is the costliest
thing this app composites, it re-bases every `position: fixed` descendant (§B.10, the fixed-overlay
trap), and it is the tier-2 alpha problem with a filter attached. It is therefore **not a surface
treatment** — it is a signal that *content is passing underneath this element right now*, and it is
allowed only where that is literally true:

1. **Persistent viewport-pinned top bars** — `.ui-shell-topbar`, the guest `SiteHeader` pill, the
   floating guest sub-header. Content scrolls beneath them.
2. **Floating mobile sheets and the scrim** — a sheet or modal layer that overlays a page still
   visible behind it.
3. **A chip or badge sitting directly on photography** — where the ground is an arbitrary image and
   no token can be checked against it (§B.7.7's mark exemption; the AD disclosure and media chips).

Everywhere else — panels, lanes, bands, cards, sections, list rows, tables, empty states — glass is
banned outright, and a lane or band that "wants" it wants a tonal step (§B.4.2). Where glass is used
the blur goes on a **`::before` underlay**, never on the element, so the element does not become a
containing block for the overlays it renders.

> **Merge gate.** `backdrop-filter` outside those three cases is not mergeable. Inside them, it must
> sit on a pseudo-element underlay.
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

The rule is enforced mechanically rather than by review: `packages/ui/core/motion.ts` is the one
spring integrator in the product, and `assertOverDamped(cfg, name)` throws on any constant below ζ 1.
`createSpring` refuses such a config at construction unless the caller passes
`requireOverDamped: false`, which is deliberately the single greppable place a bounce can enter.

**The one sanctioned exception** is `SPRING_EXPRESSIVE_EXIT` (`{ mass: 1, stiffness: 300,
damping: 18 }`, ζ 0.520), declared beside the three that obey the rule so that "where can a bounce
enter this product" has exactly one answer. It exists at the product owner's explicit request and is
logged as root CLAUDE.md §8 Decision #75. Its scope is fixed and narrow: an **exit**, on
**decoration** — a calendar card's hover expansion collapsing as the pointer leaves — never on a
value a reader must trust, because an overshoot on a number that encodes a FACT is a frame in which
the interface is stating something false. Like every other spring it is skipped entirely under
`prefers-reduced-motion` or in a hidden tab.

**Every spring also needs a frame WATCHDOG.** `prefersJumpToFinal()` degrades on a hidden document
and `createSpring` degrades on an absent `requestAnimationFrame` — but a third state exists and was
reachable in production: rAF is present, `document.hidden` is `false`, `visibilityState` is
`"visible"`, and frames never arrive. Measured at zero callbacks in 16.7 seconds in this repo's own
preview pane, and reachable outside it on a fully occluded window and on some remote and virtualised
displays. In that state a spring started a loop and its value never moved again, so a zoom the reader
asked for simply did not happen, with no error to see. `setTimeout` still fires where rAF does not,
which is why the watchdog is a timer — the same reason §B.10.5 requires one behind every rAF flip.

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
*,
*::before,
*::after {
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
4. **Tooltips everywhere (mandatory).** Every icon-only button, action, or status indicator carries
   a lightweight, **portal-based `@projective/ui` `Tooltip`** — never a native `title`. The visible
   label may be hidden, but the anchor keeps an `aria-label` (icon-only ≠ nameless), so
   accessibility holds without cluttering the canvas. This is the same discipline the collapsed rail
   already enforces (§D.1).

> Merge gate: a dense-list or sidebar PR that spells a status out in inline text (rather than an
> icon
>
> - tooltip), or ships an icon-only control without a `Tooltip` + `aria-label`, is not mergeable.

---

### B.7 Iconography (merge gate)

§B.6 made the product icon-first. This section is what makes those icons **one set** rather than
twenty-three lookalikes, and it exists because an audit found exactly that: 134 hand-authored
`<svg>` roots across 75 files, **ten** declared `stroke-width` values, **seven** viewBoxes,
**three** sizing models, **47** distinct rendered sizes, and a second complete icon family made of
Unicode characters (`▾ ▸ ▲ ▼ ‹ › × ✓ ☰ ★ 👤 🗗`) living inside `packages/ui` itself. Measured end to
end, the same set rendered its lightest glyph at **0.93px** and its heaviest at **1.80px** — a 1.93×
spread, which is precisely what "assembled from different families" looks like.

**B.7.1 One registry, one primitive.** Shared vocabulary lives in `@projective/ui/icons` and is
imported by canonical name through `<Icon name="…" />`. A feature that owns genuine domain
vocabulary (file kinds, fund states, session archetypes) keeps those glyphs in the feature, but
renders them through `<IconShell>` so it inherits the contract rather than re-declaring one. No
feature may hand-author a bare `<svg>` icon root.

Two entries added with the ticket-view rebuild are worth naming because both exist to stop a
near-synonym from being reused: **`history`** is a clock with the counter-clockwise arrow, which is
what separates an ARCHIVE from `clock` (a time) and `refresh` (a repeat); **`panel-right`** is a
frame with its trailing column divided, so the glyph says WHERE the companion panel appears rather
than merely that something toggles — which a chevron cannot.

**B.7.2 One grid, one weight.** `viewBox="0 0 24 24"`, artwork inset ≥2 units per side,
`fill="none"`, `stroke="currentColor"`, round cap and join. `stroke-width` is **not** authored on
the glyph: `icon.css` sets it from `--icon-stroke` (1.5) against `.ui-icon` and pairs it with
`vector-effect: non-scaling-stroke`, so ONE number renders identically from 12px to 32px. A CSS
declaration outranks an SVG presentation attribute, which is what lets one stylesheet normalise the
whole set — and what makes a per-glyph override impossible by construction. Because the stroke is
decoupled from the grid, a legacy 20/16/14-unit glyph can join the set before it is redrawn; 24
remains the target for proportion.

**B.7.3 Size is inherited, not chosen.** An icon beside text takes `1em` and inherits the line's
font-size. On the 24-unit grid that puts ~0.83em of live artwork against a system-sans cap height of
~0.72em — the icon reads a touch larger than the caps, which is the optical overshoot a glyph needs
so it does not look starved. **That is the relationship, and it stays correct at every type step for
free.** Only an icon with NO adjacent text takes an explicit size, and only from the ramp:

| Token        | px | Pairs with       | Use                                             |
| :----------- | :- | :--------------- | :---------------------------------------------- |
| `--icon-2xs` | 12 | `--text-2xs/xs`  | inline status pips, dense table marks           |
| `--icon-xs`  | 14 | `--text-sm`      | lane rows, chips, table cells                   |
| `--icon-sm`  | 16 | `--text-md/base` | **the default** — buttons, menu items, toolbars |
| `--icon-md`  | 20 | `--text-lg`      | icon-only controls, tabs, header rigs           |
| `--icon-lg`  | 24 | `--text-xl`      | nav rail, bottom nav, file-kind glyphs          |
| `--icon-xl`  | 32 | `--text-2xl`     | section and empty-state marks                   |

Every step is an integer pixel at a 16px root. **A fractional icon box is a defect**, not a rounding
detail: it half-pixels the stroke, and a half-pixel stroke on a 14px glyph is the mush. A control's
hit-target is NOT an icon size — it is governed by touch-target rules and keeps its own value.

**B.7.4 Optical alignment.** Icon rows are `inline-flex; align-items: center` with `flex: none` on
the icon, so a long label wraps or truncates and the glyph holds its box. The icon-to-label gap is
`var(--space-2)` at `--icon-sm` and below, `var(--space-3)` above. A glyph whose visual mass sits
off the artboard centre (arrows, carets, play marks) corrects once in `icon.css` via `data-optical`,
never by nudging the box at a call site. Icon-only squares centre on the `--shell-nav-block` box,
not on padding, so they stay centred at every rail width.

**B.7.5 Functional vs decorative — and what it costs when it slips.** Every `<svg>` is
`aria-hidden="true"`. A functional icon's accessible name lives on the **control** (`aria-label`),
plus a portal `Tooltip` when icon-only (§B.6). An icon is never the sole carrier of a status — pair
it with text, a tooltip, or a labelled container. `<Icon title="…">` promotes a glyph to
`role="img"` and exists only for the rare icon that IS the whole control and has no labelled
ancestor.

**The consequence is not theoretical.** `packages/ui/feedback/core/icons.tsx` was the one glyph
module shipping **without** `aria-hidden`, so every `Alert` announced its decorative severity mark
_before_ its own text — a screen-reader user heard the ornament first and the message second, on the
component whose entire job is to deliver a message. The rule is stated as "every `<svg>`", with no
per-module discretion, precisely because a single module opting out is invisible to sighted review.
The mirror-image defect is a **decorative** icon given a name: an `aria-label` on a glyph that sits
beside its own visible label makes the control announce twice, and an `aria-label` on the _control_
that differs from the visible text breaks WCAG 2.5.3 (Label in Name) — three fields in
`apps/web/features/catalogue/islands/CatalogueCreateModal.island.tsx` carried `aria-label`s that
overrode the visible label they sat under, and two of the three were not associated with their
control at all.

**B.7.6 currentColor only.** No `fill`/`stroke` literal and no token reference inside a glyph;
colour comes from the inherited `color`. Two exceptions, both narrow: a third-party **brand** mark
(social logos), quarantined in its own module and never reused as UI iconography; and the knockout
part of §B.7.8, which still names no colour of its own — it declares only that it IS the knockout, and
the call site supplies the ground.

**B.7.7 Banned.**

- **Emoji and Unicode characters as iconography.** They render in the user's system font at the
  wrong weight and metrics, and become full-colour glyphs on some platforms. Every one is a registry
  glyph.
- **Two glyphs for one concept**, including across form factors — desktop and mobile navigation to
  the same destination use the same mark.
- **One name for two concepts.** Disambiguate at the name (`pin-location` vs `pin-fixed`), never by
  import path.
- **Icon inflation** — a decorative icon beside every label. An icon earns its place by aiding
  scanning; a full column of them aids nothing.
- **Icons that duplicate their label.** An icon replaces a word or reinforces a scan target; it does
  not restate the text beside it.

**B.7.8 The knockout part — the one two-tone channel.** `data-filled` floods the whole `<svg>`
(`fill: currentColor; stroke: none`), which is right for a star or a bookmark and wrong for the one
shape a BADGE is: a solid mark with a symbol cut out of it. Filling a verification crest that way turns
its checkmark into a blob, because the check is an open polyline and filling an open path closes it.

So a glyph may nominate **exactly one** part `data-knockout`. Filled, that part keeps its stroke and
takes `--icon-knockout`, defaulting to `--surface` — the ground a mark on a page surface is cut out of.
Unfilled, the rule does not apply at all and the glyph is the ordinary outline, so the two states still
cannot drift apart geometrically, which is the whole reason `data-filled` is an attribute rather than a
second component.

§B.7.6 survives **by the direction of the dependency**: the glyph declares only which part is the
knockout, and the CALL SITE says what colour the ground is. A crest sitting on a `--primary` fill sets
`--icon-knockout: var(--on-primary)` on its own wrapper; the architect tier chip, which inverts the
pair, sets `--icon-knockout: var(--primary)` — and gets it right precisely because the decision lives
where the ground is known.

One part, and one only. A glyph that needs two knockouts is two glyphs, or it is artwork.

> Merge gate: a PR that hand-authors an `<svg>` icon root outside `@projective/ui/icons`, authors a
> `stroke-width` on a glyph, names a colour inside a glyph (including a second `data-knockout` part, or
> a knockout whose ground is set anywhere but the call site), introduces a second glyph for an existing
> concept, reuses a registry name for a new meaning, or reaches for a Unicode character in place of a
> glyph, is not mergeable.

---

### B.8 Button Usage Policy (merge gate)

`Button` ships **four variants** (`filled` · `outlined` · `text` · `link`) × **seven severities**
(`primary` · `secondary` · `success` · `info` · `warning` · `help` · `danger`) × three sizes, plus
`raised` / `rounded` / `iconOnly` / `fluid`. That is a large surface, and a large surface without a
policy is how a screen ends up with four equally-loud buttons and no answer to "what do I do here."
The policy is that **the variant is not a taste choice — it is a declaration of interaction
weight**, and weight is a property of the action, not of the designer's mood.

**B.8.1 Variant by interaction weight.**

| Variant    | Weight                | Use for                                                                                    |
| :--------- | :-------------------- | :----------------------------------------------------------------------------------------- |
| `filled`   | The commitment        | The **one** action the view exists to complete — Publish, Sign in, Send                    |
| `outlined` | A real alternative    | A second path a user genuinely picks between (Cancel-with-consequence, a secondary create) |
| `text`     | Repeated / in-context | Row actions, list affordances, toolbar verbs, the escape hatch (Cancel)                    |
| `link`     | Navigation            | Goes somewhere; never mutates                                                              |

**B.8.2 One filled action per view — and per overlay.** A view's primary action is singular by
definition; the moment there are two, neither is primary and the user reads a fork. The cap counts
**per rendered region a user is deciding within** — a page body, a modal, a drawer, a footer rig
each get one. It does **not** count a `filled` button that is mutually exclusive with another by
render condition (a Publish that swaps to a Pause is one button in two states, not two buttons).

**Right** — `apps/web/features/catalogue/islands/ListingEditor.island.tsx:245-271`: a status rig of
three actions where exactly one is `filled` (Publish, and it is `disabled` until `publishReadiness`
clears), Pause is `outlined`, Archive is `text`. The hierarchy is legible at a glance and survives
translation, because it is carried by weight rather than by word length.

**Right** — `apps/web/features/workspaces/components/InviteQueue.tsx:147-236`: four repeated row
actions all `text` (severity distinguishing accept from the rest), and the one utility action
`outlined`. A repeated action is **never** `filled` — a column of filled buttons is a column of
noise, and it makes the row's _content_ the least prominent thing in the row.

> **The one sanctioned two-fill rig (§D.7.7).** The entity view's conversion lane renders two solid
> pills — an inverted monochrome primary and a brand-teal secondary — plus a ghost tertiary. The cap
> exists to protect the reader's ability to rank the actions, and here the ranking is carried by
> **hue** (a monochrome commit against a brand basket) rather than by emphasis, so it survives. The
> exception is scoped to that rig and must not be generalised: two fills of the SAME colour is the
> case the cap was written for, and remains a finding.

**B.8.3 Severity is meaning, never decoration.** Severity encodes what the action _is_ — it is not a
palette. Two rules follow:

- **An irreversible or destructive action takes `severity="danger"`, always.**
  `apps/web/features/workspaces/components/OwnershipTransfer.tsx:120` shipped "Transfer ownership" —
  an irreversible transfer of an entity — styled **identically to a safe primary**. The user's last
  chance to notice was the word "Transfer"; the interface said "this is the normal thing to do
  here." Now `variant="filled" severity="danger"`, a vocabulary the codebase already had and had
  simply not reached for. Read that as the general failure mode: the wrong severity is almost never
  a _misuse_ of the API, it is a _non-use_ of it.
- **Do not invent a severity by re-tinting.** The accent-pair block (`--x-accent` / `--x-on`) is
  hand-copied across `Button` · `Badge` · `Tag` · `Alert` · `Message` · `Toast`, so a wrong pair
  appears **six times, not once**. `secondary` once paired with `--on-surface` and measured **2.67:1
  light / 1.32:1 dark**; `info` was aliased to `--secondary`, so the generated blue ramp rendered
  nowhere and two severities were visual duplicates. When a severity or ramp changes, all six
  components are in scope for that PR.

**B.8.4 Shape.** `rounded` is the **pill** (`--radius-full`) and is a _shape_, reserved for
chip-like and floating controls; it is deliberately not multiplied by `--radius-scale` (§A.3). Every
other button reads the radius ramp **at its own size** — a `sm` button is not a `lg` button's corner
on a smaller box. `Button` and `ToggleButton` shipped a fixed `--radius-base` at all three sizes,
which is why an `sm` control read visibly rounder than its neighbours. `raised` is a **response**
(hover / drag / active), never a resting state — the same rule §B.9 applies to `Card`.

> **Scoped exception — the checkout surface (owner-approved, 2026-08-10).** Every CTA and quiet
> action across `/checkout`, `/checkout/details`, `/checkout/payment` and `/checkout/confirmation`
> takes the pill, because the flow's design draws them that way consistently and a single rounded
> rectangle among them reads as a mistake rather than as a distinction. This is a **surface**
> decision, not a relaxation of the rule: the pill still means nothing semantically, it is still not
> multiplied by `--radius-scale`, and it does **not** extend to any other surface. A control outside
> the checkout that wants `rounded` still has to earn it by being chip-like or floating. Logged in
> root `CLAUDE.md` §8 Decision #70.

**B.8.5 Icon-only buttons.** An icon-only button is a control with its label removed, not a control
without one. It must carry **all three**: an `aria-label`, a portal `Tooltip` (§B.6 — never a native
`title`), and a hit target of at least `--fld-hit` (24px, WCAG 2.2 AA 2.5.8) via `.ui-hit` where the
glyph box is smaller. The overlay family shipped close buttons in **four sizes and two shapes** (24
/ 28 / 32 / 36px; `--radius-sm` vs `--radius-full`), the 24px one failing 2.5.8 outright — which is
why the single `--overlay-action-size` now exists (§B.10). The glyph is **not** the hit target
(§B.7.3).

**B.8.6 Action order is fixed.** Secondary and destructive actions lead; the primary is **last in
the inline direction** (rightmost under LtR, and it mirrors for free under `dir="rtl"` because the
row uses logical properties, §A.6). Order is set with `justify-content`, **not** with a spacer —
three modal footers achieve `flex-end` only via an unconditional `flex: 1 1 auto` spacer
(`apps/web/features/projects/styles/ticket-modal.css:331`, `project-create-modal.css:442`,
`submission-review.css:523`), so they are one conditional render away from silently left-aligning
their actions.

> **Merge gate.** A PR is not mergeable if it renders more than one `filled` button in a single
> decision region, styles an irreversible action without `severity="danger"`, ships an icon-only
> button lacking `aria-label` + `Tooltip` + a ≥24px target, uses `raised` as a resting state, or
> orders a footer's actions with a spacer instead of `justify-content`.

---

### B.9 Card Usage Policy (merge gate)

§B.4 says do not box non-interactive content. The card is the component most likely to break that
rule, because reaching for a card _feels_ like structure while actually being the absence of it — it
is the tool you use when you have not decided what the hierarchy is. This section is §B.4 applied to
the one component that most tempts you out of it.

**B.9.1 A card is warranted only when the content is a discrete, addressable object.** The test is
whether the content would still make sense **lifted out of the page** — a listing, a file, a member,
a message, a workspace. If it would not, it is a _section of this page_, and a section gets **§B.4
tier 1 + 3: spacing and a heading**, not a box.

**Wrong** — grouped, non-interactive content in a four-sided border, because the group needed a
name. **Right** — give the group a `--text-xs` uppercase label (§A.4's label register), a
`--space-6` gap above it and `--space-3` below, and let the type do the structural work. If that
still does not read, escalate to a **tonal step** (`--surface-1`/`-2`), and only then to a **single
hairline**. Reaching straight for the box skips three tiers that cost no ink.

**B.9.2 Cards do not nest.** A card inside a card means one of the two is not an object. The nesting
that actually ships is subtler and just as banned — **a card inside an already-elevated surface**:
`apps/web/features/projects/styles/attachment-modal.css:548,601,646` gives `.fx-audio`, `.fx-code`
and `.fx-doc` each `background: var(--surface)` + `box-shadow: var(--elevation-low)`, inside
`.fx-modal__media` (tinted), inside `.fx-modal__panel` (`--surface`). **Three nested surface layers,
two of them the same colour, separated by shadow alone** — which is exactly the "wall of
equal-weight bordered boxes" §B.4 was written against, just built from shadows instead of borders. A
panel is already a surface; content inside it separates by spacing and tint, and the innermost thing
is not a card.

**B.9.3 One separation device per boundary — the budget.** A boundary gets **one** of: a tonal step,
a hairline, a shadow, or a radius+border. Not two, and never all four. The audit's clearest symptom
of an exhausted budget is a boundary carrying a tint _and_ a hairline _and_ an elevation, which
reads as three competing claims about how far apart the two things are.

**B.9.4 The variants, and why `filled` is the default.** `Card` ships `elevated` · `filled` · `flat`
and **defaults to `filled`** (`packages/ui/display/components/Card.tsx:63`). The default was once
`elevated` — the _most_ restricted variant — so every future consumer would have inherited a resting
shadow it never asked for. **Elevation means the surface is genuinely above its neighbours**: it
overlaps content, it drags, or it is lifted out of flow. `raised` is a hover/drag/focus **response**
and never a resting state. A tonal step is measured against the card's actual **parent**, not
against the page — `filled` on a tinted region needs a different step than `filled` on `--bg`.

**B.9.5 Interactivity is what licenses the border.** Per §B.4 tier 5, a full contour declares "you
can act on this." The `kanban` sub-path is the reference implementation of the pair: **columns are
non-interactive containers** (tonal tint + a single hairline, no box) while **cards are
interactive** (surface + radius + resting elevation). If a card family carries a full border, a
reviewer is entitled to ask what happens when it is clicked; "nothing" is a finding.

**B.9.6 A card family declares no geometry.** Padding, gap, corner and media proportion come from
the §A.3 card rhythm tokens (`--card-pad`/`-media`/`-tight`, `--card-gap`/`-tight`,
`--card-radius`/`-media`, `--card-media-ratio`/`-square`). This is stated as law because the
alternative is measured: **`ui-card` currently has zero consumers in `apps/web` source** — all eight
feature card families hand-rolled their own container, and no two agreed (five body paddings, seven
radii, three media ratios). The token layer lives in `packages/ui/styles/index.css`, not in
`display/card.css`, specifically so a **server-rendered** card family can consume the contract even
where it cannot consume the component (component CSS reaches a page only through an island bundle).
A family that declares its own padding, radius or media ratio is a finding regardless of whether it
imports `Card`.

**B.9.7 Zero cards for static content — the anti-card rule.** §B.9.1 gives the test; this states the
consequence for the surfaces that fail it most. **Plain prose, a stage breakdown, a scope checklist,
a specification ledger, a set of key–value facts and a reviews summary are never wrapped in a card.**
They are sections of the page they are on: none of them would mean anything lifted out of it, none
of them is addressable, and none of them can be acted on. They get a §B.4 tier-1 + tier-3 treatment —
asymmetric spacing and a section header — and nothing else.

The failure this bans is compound, not cosmetic. A card around a scope list inside a card around a
stage inside an elevated panel produces **three surfaces, two shadows and up to twelve borders on
one screen**, and the reader's eye has no way to tell which enclosure is the meaningful one because
they all look equally deliberate. That is the "boxed-in" weight §B.4 was written against, arriving
by a different route: not one bad decision, but the absence of a decision repeated at every level.

**A list of objects is one card each, never a card around the list.** A grid of listings is N cards
on the canvas; it does not also get a container card. The grid is expressed by the grid, and the
section by its heading.

**B.9.8 A checklist is glyph + text, not a row of boxes.** Deliverables, inclusions and scope items
render as an unboxed list: an `Icon` (`check`) in the accent, the item in Body register, one row per
item at `--space-3`. No per-row surface, no per-row border, no per-row chip. The check glyph is the
only ink the row spends, and it is doing the work a box would have done worse.

> **Merge gate.** A PR is not mergeable if it boxes non-interactive grouped content where spacing +
> a heading would read, nests a card inside a card or inside an elevated panel, wraps prose / a stage
> breakdown / a scope checklist / a spec ledger in a card at all (§B.9.7), puts a container card
> around a list of cards, renders a checklist row as a box or a chip (§B.9.8), spends more than one
> separation device on a boundary, uses `elevated`/`raised` as a resting state without genuine
> overlap, or declares card padding / radius / media ratio locally instead of reading §A.3.

---

### B.10 Overlay Family Contract (merge gate)

A consistency audit of the twelve overlay siblings scored the family **21/40** and found it was not
a family: **five radii**, **two separator token families**, **six scrim recipes**, **seven ad-hoc
dialog widths**, **six right-drawer widths**, **five header-density systems** (bar heights running
~40→64px within one behavioural class), and **zero adoption of the type ramp** — `grep` for
`--text-*`/`--fw-*`/`--leading-*` across all fourteen sheets returned nothing. Border presence was
_inverted by layer_: every package panel had a full four-sided border, every app modal panel had
none, so the same role read bordered or borderless depending on who built it. This section makes the
family one object.

**B.10.1 Two tiers, two geometries.** Every overlay resolves to one of two tiers, and the tier fixes
the geometry:

| Tier                  | Members                                                          | Radius                | Seam         |
| :-------------------- | :--------------------------------------------------------------- | :-------------------- | :----------- |
| **Anchored / system** | Popover, Tooltip, ConfirmPopup, Toast, Message, Alert, HoverCard | `--overlay-radius-sm` | `--hairline` |
| **Workspace**         | Dialog, Drawer sheet, DraggablePopover, the app modals           | `--overlay-radius-lg` | `--hairline` |

Size comes from `--overlay-w-sm/md/lg/xl/full` and `--overlay-h-md/lg`, **each carrying a viewport
term** so a panel can never exceed the window — `attachment-modal.css:20` shipped
`block-size: min(860px, 100%)` with no viewport term and stood taller than an 800px laptop window.
`--drawer-w`/`--drawer-h` are the drawer's, and the Drawer now actually consumes them (it hardcoded
`min(22rem, 92vw)` while orphaning the defined token). **Seams are `--hairline` everywhere** — the
package layer drew them with opaque `--border-subtle` and the app layer with `--hairline` (20%
alpha) for the same job; `draggable-popover.css` used **both, in one component**. `.ui-dialog__body`
reads `--measure` (§A.4); without it a 48rem dialog rendered body prose at ~76ch.

**B.10.2 The scrim is one recipe, and it is not the caller's choice.** `--scrim` (the darkest
neutral in **both** themes) at a per-theme `--scrim-tint`, `--on-scrim` for anything drawn on top,
blurred by the single `--scrim-blur`. `Backdrop` **no longer takes a `blur` prop** — how hard the
page dims is a property of "a modal is open", not of which component opened it, and while it was a
prop the package modals shipped 4px and all four app modals shipped 18px. The shared recipe was also
simply **wrong**: `backdrop.css:12` mixed `--surface` (≈ white in light mode) where the comment two
lines above prescribed `--on-surface`, so every modal dimmed the page with **white at 40%** — the
same hue as the panel above it, leaving separation to a shadow and a 4px blur. A scrim built from a
literal `#000` (`mobile-menu.css:36`, `site-shell.css:564`) is a finding for the same reason: it
does not exist in either theme's ramp.

**B.10.3 The z-class scale is a hierarchy, not a suggestion.** Page content `--z-base` < nav lane
`--z-raised` < sticky bands `--z-sticky` < site header `--z-nav` < popovers `--z-popover`/
`--z-overlay` (1100) < modals/drawers `--z-modal` (1300) < draggable windows `--z-draggable` (1500)
< toasts < tooltips. `useOverlayStack(layer)` allocates from the class base, stepping above anything
already open, so an independent modal always outranks an independent popover **and** a dropdown
opened _inside_ a modal still stacks above it. Two rules keep it true:

- **No static `z-index` on an overlay.** `tooltip.css:14`, `toast.css:10` and `hover-card.css:14`
  (at **1100 — behind any Dialog**) opted out of the manager, and eight `fields/styles/*.css` sheets
  carried a literal `z-index: 1000` **with no portal at all**.
- **The counter must be bounded.** `useOverlayStack` releases only when the top claim is its own, so
  out-of-order teardown leaked 10 permanently and nothing reset when the last overlay unmounted;
  `DraggablePopover` incremented a module-global on every `pointerdown` and never released. In a
  shell that never full-page-navigates, both climb monotonically until **the documented hierarchy
  inverts** — a plain Popover outranking `--z-draggable`, then `--z-toast`, then `--z-tooltip`. The
  ceiling is derived from live claims, not accumulated.

**B.10.4 Every panel must render through `BodyPortal`.** A `position: fixed` panel that merely stays
in the tree is not safe: the sticky middle-nav lane is a **stacking context** that caps its
subtree's paint order, it is `overflow: clip`, and any glass ancestor's `backdrop-filter` **re-bases
`fixed` onto that ancestor's box**. All three at once. The Dialog is the trap in its purest form —
`dialog.css:71-72,80` settles its enter transform to `scale(1)` and never to `none`, and **a
transform at rest is still a containing block for `fixed` descendants and a stacking context**,
alongside `overflow: hidden` — so every field dropdown opened inside a Dialog was simultaneously
re-based and clipped. `apps/web/features/projects/styles/attachment-modal.css:151` is the last
hand-rolled holdout: a `position: absolute; z-index: 2` menu inside an `overflow: hidden` panel.

**B.10.5 Motion may decorate, never encode.** Every panel transitions off `[data-state]`, animates
only `transform`/`opacity`, and settles with the enter transform cleared — which is why reduced
motion snaps to a **real static rule** in all twelve rather than freezing a half-drawn frame. That
architecture is the family's best decision and is not up for renegotiation. Its one failure mode is
the rule: **presence must never depend on a frame.** Resting CSS is `opacity: 0`, corrected only by
`[data-state="open"]`, while scroll-lock and focus-trap key off `mounted` — so a hidden or throttled
tab, which never services `requestAnimationFrame`, left a mounted, scroll-locked, focus-trapped,
**invisible** modal that never repaired itself. Every rAF flip therefore carries a **timer
watchdog**, and reduced motion opens in the same commit and skips the frame entirely. The same rule
governs CSS: the Toast countdown animates `transform: scaleX()` on a statically full-width bar,
never `inline-size` — a frozen clock previously parked the bar at 100%, claiming an infinite timer
while the toast expired on schedule.

**B.10.6 Focus-management checklist.** Every modal-behaving overlay satisfies **all seven**:

1. **Focus enters the panel** — and lands on the first meaningful control, not the close ×. Where
   the safe choice is a specific control, `initialFocusRef` names it (`ConfirmDialog` opens on
   **reject**).
2. **Focus is trapped on `document`, not the container.** A container-scoped `keydown` listener
   stops firing the moment focus escapes — which silently un-traps the overlay, and with
   `closeOnOutside: false` and no background `inert`, one background click was enough.
3. **The background is `inert` + `aria-hidden`.** Scroll-lock is not containment.
4. **Escape dismisses exactly one layer.** Every instance listens on `document` in the capture
   phase, so dismissal is gated on `useOverlayStack().isTop` and Escape uses
   **`stopImmediatePropagation`** — with `stopPropagation` and an `isTop` that was never demoted,
   one Escape closed the confirmation _and_ the dialog beneath it.
5. **Focus returns** to the trigger on close.
6. **The overlay is named.** `role="dialog"` without an accessible name announces _worse_ than no
   role; `Popover` and `ConfirmPopup` shipped unnamed. A confirmation is `role="alertdialog"`.
7. **Dismissal resolves to the safe outcome.** Escape and backdrop **reject**, never accept — the
   one thing the family already got right, and the one thing it can never regress.

**B.10.7 Non-modal overlays are held to the parts that apply.** A `Tooltip` takes no focus
(correct); a `HoverCard` still needs **Escape** (WCAG 1.4.13) and must not point `aria-describedby`
at a node it also marks `aria-hidden="true"`. A `Toast` that carries an action needs a keyboard path
to it before auto-dismissal — see the deferred list, Part F.

**B.10.8 Density and the irreversible-action rule.** A panel already supplies its own padding and
its own scroll region; content inside it supplies neither again. `wallet-overlays.css:28`
re-declares `padding: var(--space-5)` **and** `overflow-y: auto` inside `.ui-drawer__body`, which
already has both — 3rem of inline padding and **two nested scrollers on one axis**. And an
irreversible action must never be able to scroll out of view: `ConfirmMoveModal.island.tsx:114`
passes its footer as **children**, so the "Confirm / Withdraw £X" commit lands inside the scrolling
`.ui-dialog__body` rather than the footer slot and drops below the fold on a short viewport. Footers
go in the `footer` prop.

**B.10.9 A second modal REPLACES the first — it never covers it.** When an overlay opens another (a
ticket opening a submission review, a review opening a file), the obvious implementation mounts the
second on top of the first. Do not. Every overlay in this system dims through a blurred `Backdrop`,
and a full-viewport `backdrop-filter` is the most expensive thing a browser can be asked to
composite each frame; stacking two multiplies that cost to make the lower surface unreadable anyway,
and leaves two focus traps arguing about Escape.

The contract is the `@projective/ui/overlay` **modal stack**: a chain where only the top frame
renders, and the frame beneath keeps its live UI state in a cache so returning restores the surface
the viewer actually left — the tab they were on, the tree node they had browsed to, where they had
scrolled — rather than a reset one. Three properties make it work and each is load-bearing:

1. **The state cache is not reactive.** A modal writing its scroll offset on every scroll event must
   not invalidate the frame list and re-render the host. The frames are a signal; the per-frame
   cache is a plain `Map` keyed by a monotonic frame id.
2. **Frames are keyed by that id, not by what they show.** The same ticket opened twice in one chain
   is two visits, and must not share a tab position.
3. **The chain owns its URL with `replaceState`, not `pushState` + `history.back()`.** The tempting
   design makes the browser's Back button close the overlay; measured, `history.back()` from a
   pushState entry was observed reloading the document, which destroys the chain and every cached
   frame with it. A Back that loses the work is worse than a Back that leaves the page. Replacing
   keeps the address bar honest — a link copied mid-review still addresses the submission — while
   making it structurally impossible for a traversal to tear the chain down.

> **Merge gate.** An overlay PR is not mergeable if it introduces a radius, width, seam token or
> scrim recipe outside this section, sets a static `z-index` instead of `useOverlayStack`, renders a
> panel without `BodyPortal`, encodes state in an animated property, fails any of B.10.6's seven
> focus items, or places a destructive/irreversible action anywhere it can scroll out of view.

---

### B.11 Anti-Tagification — the metadata containment rule (merge gate)

§B.9 governs the box around a *region*. This section governs the box around a *word*, which is the
same failure at a smaller scale and a great deal more common. A discovery and entity-view audit found
surfaces where a category, a delivery model, a skill, a turnaround, a file format, a language and a
timestamp were **each** wrapped in a pill — nine containers on one card, none of which could be
clicked. The reader is offered nine affordances and none of them is one.

**B.11.1 A chip is a control. Containment is a promise of interactivity.** A rounded fill with
padding around a short string is the same visual object as a button, a filter and a removable token,
because in this product it *is* those things (`Chip`, `Tag`, `SelectButton`, the Explore facet
pills). Putting metadata inside one asserts "you can act on this" and then refuses — the §B.4 tier-5
rule ("a full contour means interactive") applies to fills and pills exactly as it applies to
borders. If a reviewer asks what happens when a pill is clicked, **"nothing" is a finding.**

**B.11.2 Non-actionable metadata renders as inline text.** Category, sub-category, tags, delivery
model, turnaround, revision counts, seat counts, file formats, licence terms, language,
proficiency, location, read time and timestamps are **Meta register** (§A.4) — `--text-sm`,
`--fw-normal`, `--text-secondary` — set inline and separated by a middot with hair spacing:

```
Branding · Marketing · Pipeline · 3 revisions · 5–7 days
```

The separator is a real middot (`·`) in a `--text-disabled` span, `aria-hidden`, with the items as
siblings so a screen reader reads a list rather than a sentence full of punctuation. It costs one
line, no fills, no radii, and it scales to any number of facts, which a pill row does not: pills wrap
into a ragged block whose height is unpredictable, which is why every card family that tagified its
metadata also had to hand-roll a height.

**B.11.3 The four things that ARE still allowed a container.** The distinction is not "short text"
— it is whether the containment is carrying a fact the text alone cannot.

| Allowed                        | Why                                                                                                        | Component                          |
| :----------------------------- | :--------------------------------------------------------------------------------------------------------- | :--------------------------------- |
| **A control**                  | It is clicked — a filter facet, a removable token, a segmented option                                       | `Chip` / `Tag` / `SelectButton`    |
| **A lifecycle status**         | The fill *is* the semantic channel (§A.1 role colours) — Draft, Paused, Disputed, Overdue                   | `Tag severity` / `.ex-status`      |
| **A required disclosure**      | It must survive an arbitrary photographic ground and be impossible to mistake for content — sponsorship, AD | glass token (§B.4.3 case 3)        |
| **A count that must not wrap** | A numeral whose neighbours would otherwise absorb it — unread, `+N` overflow                                | `Badge` / `OverlayBadge`           |

Everything else is text. **A status is a state that can change; a category is what a thing
permanently is** — that is the test when the two feel similar. "In review" is a status. "Branding" is
not, no matter how much it looks like one.

**B.11.4 Trust and promotional signals are inline composites, not badge rows.** A seller's standing
renders as one line: the `Avatar`, the name as a link, `RatingStars compact` (one star + the score),
then the derived signals — *Top rated*, *Fast replies*, *Available now* — as **subtle text links**
in the accent, each carrying a portal `Tooltip` (§B.6.4) that says what earned it. The signal is a
claim the reader may want to check, so it gets an explanation on demand; it does not get a fill,
because a fill makes six earned signals compete with the one lifecycle status that genuinely needs
the colour channel. Where a signal is inherently graphical — the verification crest — it is an
`Icon`, not a pill (§B.7.8).

**B.11.5 Two chips in a row is the smell.** One status on a card is a state. Two adjacent fills mean
at least one of them is metadata wearing a control's clothes. Reviewers should read a chip row
right-to-left and ask of each: *is this clicked, is this a lifecycle state, is this a legal
disclosure, is this a numeral?* The first "no" is the finding.

> **Merge gate.** A PR that wraps non-actionable metadata in a pill, chip, tag or badge — or that
> ships two adjacent non-interactive fills on one row — is not mergeable. The fix is inline Meta-
> register text with middot separators, not a smaller chip.

---
## Part C — Component Library Architecture (`@projective/ui`)

A single, decoupled, **copy-paste-portable** umbrella package (`packages/ui/`) with **multi-export
sub-paths** declared in `deno.json` (`packages/ui/deno.json`). It plugs into external projects
verbatim because every component depends only on the token contract (Part A) — no app coupling.

### C.1 The seven taxonomies (authoritative roster)

| Sub-path                        | Components                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| :------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`@projective/ui/layout`**     | Box, Container, Grid (auto-fit `minChildWidth` + column-capped `maxCols`), Row, Column, Stack, AspectRatio, Divider, Separator, Panel, Fieldset, Toolbar, ScrollPanel, Splitter (+SplitterPanel), Stepper (+StepperPanel), MeterGroup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **`@projective/ui/navigation`** | AppShell, ShellFrame, ShellTopBar, ShellSidebar, MiddleNav, PageCanvas, NavItem, BottomNav, Link, MiddleNavSplitter, MobileMenu, TreeNav, **Lane chrome** (LaneHead, LaneFooter(+Actions), LaneList, LaneBar, LaneTabs, LaneSearch, LaneIconButton, LaneToggleRow, LaneSection(+LaneSections), LaneCollapseButton, LaneEmpty — the shared middle-nav lane control set every lane surface composes), Menu, Menubar, MegaMenu, TieredMenu, PanelMenu, SlideMenu, ContextMenu, Breadcrumb, Steps, TabMenu, TabView (+TabPanel), Paginator (alias Pagination)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **`@projective/ui/fields`**     | **Button** (4 variants `filled`/`outlined`/`text`/`link` × 7 severities × 3 sizes, plus the `raised`/`rounded`/`iconOnly`/`fluid` modifiers — governed by §B.8, which is what decides _which_ of those 84 combinations is correct), SplitButton, SpeedDial, InputText, Textarea, **InlineEdit** (text that becomes its own field in place, at identical metrics — the owner-editing affordance), InputNumber, InputMask, Password, InputGroup(+Addon), FloatLabel, IftaLabel, IconField(+InputIcon), Checkbox, TriStateCheckbox, RadioButton, RadioGroup, ToggleSwitch (alias InputSwitch), ToggleButton, SelectButton, Rating, Select (alias Dropdown — with `optionTemplate`/`valueTemplate` for rows that carry an identity rather than a word: a person's face, a workspace mark, rendered in both the panel and the trigger while `Option.label` stays the name typeahead matches. Opens CENTRED on the current value and keeps the active row in view through Arrow/Home/End/typeahead, so a long list never asks the reader to hunt for the value they already chose; the centring runs before paint, because a deferred one visibly paints the wrong end of the list and snaps. The panel caps itself at `min(--fld-panel-maxh, --float-available-h)` and scrolls internally, so a list longer than the space below the trigger loses its scrollbar rather than its last rows), MultiSelect, Listbox, AutoComplete, Chips, TreeSelect, CascadeSelect, Slider, Knob, SortControl, ZoomSlider, DatePicker (the month grid speaks the mini-month's visual language — one-letter weekday strip, seam-separated square cells on `--fld-opt-h`, whole-week hover — copied rather than imported, because `calendar.css` ships only through the Calendar island; its month/year controls are the package's own `Select`, the year one windowed over a `yearSpan` that defaults to ±100 years and opens scrolled to the current selection), **TimeTumbler** (a drum-roll time picker — two reels, three under `hour12`, drawn as a combination lock: pointer/touch drag with a release flick, wheel/trackpad, ▲/▼ controls, keyboard (Up/Down, PageUp/PageDown a quarter turn, Home/End) and DIRECT numeric entry, because the centre cell IS the `role="spinbutton"` rather than a display with a hidden input beside it. The selected cell is placed by LAYOUT and every gesture commits a whole number of cells synchronously — the reel’s transform carries only the sub-cell remainder — so the drum lands on the value the gesture asked for in a background tab, where rAF and every transition are frozen. `minMinutes`/`maxMinutes` narrow the REELS rather than rejecting a value afterwards, and a bound that misses the `minuteStep` grid is offered anyway, or a coarse step would make the earliest legal time unreachable; the faded neighbours are `aria-hidden` affordances, never content), **DateTimePicker** (ONE popover composing the inline `DatePicker` and the `TimeTumbler`, returning a single `Date` that carries both. `min`/`max` constrain the TIME on the boundary day and not merely the date, so a legal day can never be left holding an illegal hour; the composed calendar keeps its grid and loses its card, since a bordered card inside a panel is a box in a box (§B.4)), ColorPicker, FileUpload, FormControl, **FieldLegend** (the one-line explanation an asterisk needs), **status marks** (AlertMark/CheckMark/GateMark/BusyMark + `FieldMark`/`statusMark` — the §A.5 icon channel rendered into every `.ui-field__mark` slot). All geometry and every state read the `--fld-*` contract (§A.7) |
| **`@projective/ui/display`**    | Table (sort/multi-sort + per-column `multiSort` toggle), TreeTable, Tree, DataView, VirtualScroller, Scroller, VirtualGrid, OrgChart, Timeline, GMap, AudioVisualizer, **MoneyView** (the single way a money figure reaches the screen: an inline, baseline-aligned, `tabular-nums` amount in the VIEWER's display currency plus, when the figure was priced in another, an always-visible estimate indicator carrying the origin — `£78.50 (~€90.00 EUR)`; never a hover, since the hover is unavailable on touch and this is the fact that says whether the number is exact. Resolves its currency through props → the request context → the host's ambient resolver → the shared `@preact/signals` store, so the SAME component is correct in a zero-JS server component and reactive inside a hydrated island. Motion touches `opacity` only — never a property that carries the value), **Card** (`elevated`/`filled`/`flat`, default **`filled`**; a **non-interactive** container — `raised` is a transient hover/drag/focus response, never a resting state; all geometry from the §A.3 card rhythm tokens, governed by §B.9), Avatar, AvatarGroup, **AvatarStack** (the data-driven cascading roster with a `+N` overflow chip and one composed a11y label), Badge (+OverlayBadge), RatingStars, Chip, Tag, **PaymentCard** (+ **PaymentCardOption**, + `paymentCardArt`) — the CR80/ISO-7810 saved-card instrument with a real `preserve-3d` flip: three `aria-hidden` mask groups plus the REAL `last4`, and a back whose CVV box is `•••` **ornament** (never a value, never an `<input>`, no reveal affordance); art arrives as token expressions through `--pc-*` and geometry steps by `@container`, List, ListItem, Accordion (+AccordionTab), Carousel, Galleria, Image                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **`@projective/ui/feedback`**   | Message, Messages, Alert, Banner, Toast, Dialog (`role`, `initialFocusRef`), DynamicDialog, ConfirmDialog (`role="alertdialog"`, opens on the reject action), ConfirmPopup (`label`), Drawer (alias Sidebar), Tooltip, Popover (alias OverlayPanel; `label` promotes it to `role="dialog"` — an unnamed dialog announces worse than no role), ProgressBar, ProgressSpinner, ProgressRing, Spinner, Loader, Skeleton                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **`@projective/ui/overlay`**    | Backdrop (tint/blur fixed by `--scrim`/`--scrim-tint`/`--scrim-blur`, no `blur` prop), Overlay (modal band + `inert` background), HoverCard (stack-managed, Escape-dismissable per WCAG 1.4.13), Portal, BodyPortal, DraggablePopover (non-modal draggable/resizable window, bounded z counter) (+ `usePresence`, watchdogged enter), **MoneyFlowPopover** (the developer money-flow debugger composed ON DraggablePopover — glass on a `::before` underlay, a four-state capital meter whose segment widths are set from the value and **never animated**, a purchase → escrow → release → disburse simulator, a balance override, a before/after wallet preview and an ordered flow trace; **fully controlled, zero fetch, zero money arithmetic** — see the portability note below), **the modal STACK** (`createModalStack` + `useFrameState`/`useFrameScroll`/`bindFrameSignal`) — a replace-in-place router for a chain of modals: only the TOP frame renders, so a ticket → review chain composites ONE blurred backdrop instead of two, and each frame's live UI state (tab, inputs, scroll offsets) is held in a deliberately **non-reactive** cache so popping back restores the surface the viewer left rather than a fresh one (§B.10.9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **`@projective/ui/utils`**      | CommandPalette, Kbd, ScrollArea, ScrollTop, EmptyState, BlockUI, Inplace, Terminal, Captcha, FocusTrap, Defer, AnimateOnScroll, Ripple                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **`@projective/ui/dnd`**        | DndContext, Draggable, Droppable, SortableContext (alias SortableContainer), DragOverlay, **DropIndicator** (the landing seam a sortable list draws at the insertion point — the ghost says _what_, this says _where_) (+ hooks `useDraggable`, `useDroppable`, `useSortable`, `useDndMonitor`, `useDnd`; detectors `pointerWithin`/`closestCenter`/`defaultCollision`/`nextInDirection`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **`@projective/ui/kanban`**     | KanbanBoard, KanbanColumn, KanbanCard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **`@projective/ui/calendar`**   | Calendar (island — `hideHeader`/`hideSidePanel` for a host that owns those regions itself, TRACKED `view`/`focus` + `onViewChange`/`onFocusChange` so an external switch and trail can drive it, a `headerActions` slot, and a `renderSource` callback the consumer supplies its own provider marks through), CalendarHeader (period trail · nav · search · filter toggle · the consumer's `actions` slot), MiniMonth, AvailabilityPanel, TimeGrid (infinite Week), DayTimeline (infinite Day), MonthGrid (paginated), EventBlock (+ the stacked `sources` provenance marks), NowIndicator, OverlayScrollbar, **GridCanvas** + **GridProbe** (the canvas layer, at two depths. The Day `DayTimeline` stays HYBRID — the canvas paints its lattice, its events stay HTML cards. The Week `TimeGrid` is a PURE immediate-mode canvas: `.cal-tg__viewport` holds one `aria-hidden` `<canvas>` and NOTHING else, and the hour scale, day columns, working-hours bands, blackout hatch, every event card, the current-time rule, the drag preview, the period markers, the depth gauge and the return-to-present pill are all pixels from ONE ordered pass over one `GridScene`. There is no scroll container — `useCanvasViewport` owns the offset as a signal and re-implements what the native scroller was quietly providing (the three wheel `deltaMode` units, Arrow/Page/Home/End, clamping, and `reveal` in place of `scrollIntoView`) — and every gesture is resolved by mapping a pointer into scene coordinates and asking `hitTest` what is there. Because a canvas is opaque to assistive technology and to the keyboard, the viewport ships with a PARALLEL ACCESSIBLE LAYER as its SIBLING, which is the merge gate rather than a nicety: the same events as real focusable controls carrying the same names and firing the same handlers, a Return-to-now and a keyboard create ahead of the list (a control reached after twenty cards is a control lost), scroll-into-view when focus lands off-screen AND a hold on the focused card's block so paging cannot unmount the element under focus, and an `aria-live` region naming the visible range — quantised to the hour, so it speaks once per hour crossed rather than once per pixel. Its controls are visually hidden, so none of them can show a focus ring of its own: the canvas paints one for each — the focused card, the pill, and the whole viewport for the scroll region — TWO-TONE (halo inside, ink outside), because one tone cannot clear 3:1 against both an accent-tinted card fill and the grid, and a canvas ring cannot be fixed later by a cascade. There is no scroll container for a browser to pan, so the viewport declares `touch-action: pinch-zoom` and owns the one-finger drag: a finger SCROLLS, a tap activates, and pinch stays with the browser so page zoom survives. On a canvas card the `sources` channel becomes a COUNT — one neutral dot each, "on N calendars" in the accessible name — since a consumer-supplied brand VNode cannot be painted; a masked card carries neither. A canvas cannot read a custom property, so every colour, width, radius, font and box is still authored in `calendar.css` against `var(--*)` on a hidden swatch subtree and read back RESOLVED — which is what makes `color-mix()`, the generated palette and the a11y overlays reach a canvas at all, `data-font` included now that the canvas draws type — re-resolved on any root theme write and on any change to the ACCENT SET, which is a property of the data rather than of the theme; the swatches opt out of the global crossfade so a read is always the final value and never the one a frozen animation clock is passing through. WHAT THE PIXELS COST: canvas text has no find-in-page, no selection and no native text cursor, which is why the hour LABELS stayed DOM while the backdrop was hybrid and why the accessible layer is not optional now that they are not) (+ hooks `useCalendarViewport`, `useCanvasViewport`, `useNowTick`, `useOverlayScrollbar`, `useGridCanvas`; the pure `paintGrid`/`paintScene`/`toCanvasColor` and the pure scene geometry `buildSceneEvents`/`hitTest`/`eventRect`/`gaugeGeometry`/`eventAccessibleName`, all unit-tested with no DOM — once a card is pixels, only arithmetic can tell a click from a miss; the PLACEMENT engine `packDayEvents`, which since 2026-08-22 answers a resting day and an EXPANDED cluster differently and deliberately. AT REST every overlap cluster collapses to ONE merged card carrying a `+N` chip, whatever the relationship between its members — the previous behaviour gave three different answers to "these two overlap" (a contained pair nested, a plain straddle folded, a demoted nest split), which is two too many for a reader to hold. PRESSING that card, or its chip, expands the cluster AND opens its list popover in one move: the expansion is DERIVED from the open popover rather than held beside it, so a click outside, an Escape and a committed pick all collapse it for free and the two facts cannot come apart. An expanded cluster is laid out FLAT — every member a root, in lanes — and each member is drawn `bare`: its fill and its shape, and no text at all. That is a measurement rather than a preference: `NEST_INSET_FRAC` leaves a container visible as two 6% strips, about 7px in a real column, which is not something a reader can identify or point at once the text is gone; and N titles clipped to three characters each is noise where the reader is trying to read a SHAPE. The names live in the list beside the grid, at a full line each, and hovering one there rings its block (`highlighted`) while every other card recedes (`recede`, resolved from `--cal-dim-drag`/`--cal-dim-focus` so the DOM Day card and the Week canvas step back by ONE number). `bare` is presentation only — the card keeps its rect, its hit target and its whole accessible name. The containment engine is preserved behind `PackOptions.merge: false`, which restores the pre-2026-08-22 resting layout wholesale; no app surface passes it today. A zero-duration event (`end === start`) is a DEADLINE and survives layout as an INSTANT — admitted rather than filtered out, given no synthetic duration, and drawn as a pin (rule + kind chip + timestamp pill) rather than as a box, because a deadline drawn as a plausible twelve-minute meeting is worse than one drawn as nothing; the total `dayWindow`; the lever physics `core/chrome.ts` (`joystickVelocity`/`leverScrollDelta`/`leverBall`/`handleLength`) — the scroll handle is a RATE control, not a position mapping: pressing it morphs the pill into a circular joystick ball and dragging scrolls at a velocity proportional to displacement from the GRAB ORIGIN, which is what lets the gesture outlast a finite track on an axis that is effectively infinite, and the handle's LENGTH encodes the share of one PERIOD visible at the live zoom rather than a proportional thumb of a nineteen-year axis (a hair nobody can grab). `EventPopoverLayer` is the HTML popover layer floating OVER the canvas — `BodyPortal`'d so it escapes the canvas viewport, the lane's `overflow: clip` and any glass ancestor's `backdrop-filter` re-base, positioned by `useFloating`'s collision model, with a single-event view, a two-step stack list → detail flow whose rows publish a `highlight` channel back to the grid (the panel is body-portalled, so travelling into it fires the viewport's own `pointerleave` — one hover channel would collapse the highlight on the very card the row stands for), and a quick-create composer that leaves a live DRAFT block on the grid: dashed, grabbable, draggable and resizable from either edge while the composer tracks its timestamps, with Enter committing on defaults, Escape cancelling and removing it, and `onExpandCreate`/`compose` carrying every entered field to a host's full surface and back again. The draft is painted pixels rather than an element, so overlay containment cannot see it — the grid raises a `pointerGuard` for the duration of a press that lands on it, from a document capture listener registered ahead of `useDismiss`'s, or the panel would close under the finger about to drag it. While ANY popover is open a press on empty grid only dismisses (§2 of the redesign): the create gesture is suppressed for that press, because "get this out of my way" must not produce another thing in the way; a canvas rect is not a DOM element, so the anchor is a zero-size portalled proxy and ownership is tethered by a second inline one (`overlay-registry` derives parentage from where a TRIGGER sits, not from where a panel renders). Zoom is CURSOR-ANCHORED — `zoomAnchor(viewportY)` pins the timestamp under the pointer and `zoomTo` interpolates through it, re-solving the offset in closed form on every frame so the fixed point holds for the whole journey and a wheel burst compounds instead of collapsing to one notch; timezone-explicit `calendarTime` matrix utils; `CALENDAR_KIND_LABEL`/`calendarKindLabel` — the ONE plain-language name per event kind, owned here because `packages/ui` may not read the Zod SSOT, so a map owned there could never reach the engine's own filter chips: every surface that names a kind reads this one, and a masked block still names none of it)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **`@projective/ui/icons`**      | Icon (registry glyph by canonical name), IconShell (the base every feature-owned glyph module renders through), `ICON_PATHS` registry + `IconName` union — the single icon contract (§B.7). Token-driven via `--icon-2xs…--icon-xl` + `--icon-stroke`; one 24-unit grid; `vector-effect: non-scaling-stroke` holds one rendered weight at every size. `data-filled` floods the whole glyph; a glyph may nominate ONE `data-knockout` part, which stays stroked in `--icon-knockout` (default `--surface`) so a solid badge with a cut-out symbol is expressible without the glyph naming a colour (§B.7.8) — the verification crest is the one that uses it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **`@projective/ui/editor`**     | RichTextEditor — a stripped, token-themed QuillJS wrapper (toolbar restricted to Bold/Italic/Strikeout/Underline/Bullet+Numbered lists/Headings H1–H3; Quill's `snow`/`bubble` CSS not imported; client-only `import()` so it never evaluates during SSR)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

> These supersede the deprecated `atoms/charts/data/time/files/system` split (see
> `SYSTEM_ARCHITECTURE.md` Restructure Change Log). Migration note: the former Fields/Data/Charts
> package docs describe existing implementations now re-homed under these sub-paths.

> **Field validation statuses — two-tier creation gate.** Beyond the generic `invalid`/`success`/
> `warning` `FieldStatus`es, `fields` (and `editor`) expose the platform's "quick to onboard, slow
> to set up" gate as two explicit severities: **`required` (RED)** — needed _now_ to create the base
> record (e.g. a Project Name; drives the danger ramp + `aria-invalid`), and **`gate` (AMBER)** —
> optional to draft but needed to _publish_ to Explore / open for hiring (e.g. Description, Budget,
> Stage details; drives the warning ramp, soft-informative so NOT `aria-invalid`). Both carry a
> faint tonal fill so an unmet gate reads at a glance in a dense form.

> **The field contract — one state language, one geometry (§A.7 `--fld-*`).** Every control in
> `fields` resolves its size, surface and state from a single token layer on `:root`, and every
> state declares the same four channels: **border · surface · ink · ring**, plus a **mark**.
> Consequences a reviewer can check:
>
> - **Geometry is shared, not coincidental.** A Select and an InputText at the same size are
>   pixel-identical — 32/40/48px tall, 8/12/16px inline padding, 6/8/12px radius, 13/15/17px type.
>   Controls that cannot compose `.ui-field` (Checkbox, Slider, Rating, ZoomSlider…) keep their own
>   SHAPE but read the same state channels, so `disabled`/`readonly`/`invalid`/`gate`/`loading`
>   reach all of them rather than only the input family.
> - **One focus treatment.** `--focus-ring-shadow` (two-tone) on every control, including the custom
>   ones. `--focus-ring-shadow-inset` is the only permitted variant, and only where an outset ring
>   would be clipped by a segmented group's own overflow.
> - **One disabled value.** `--fld-disabled-mix` fades INK and BORDER, never the box, and never with
>   `pointer-events: none` — that silently cancels the `not-allowed` cursor it is paired with. It
>   measures 4.5:1 or better; a state you cannot read is not a state.
> - **Status never rides on hue.** Each validation state paints `--field-mark` and the control
>   renders it into a `.ui-field__mark` slot that is zero-width at rest (§A.5).
> - **A hit target floor.** `.ui-hit` grows any part smaller than `--fld-hit` (24px, WCAG 2.2 AA
>   2.5.8) via a transparent pseudo-element, so density survives the floor instead of trading
>   against it.
> - **Panels are one object.** Every dropdown shares option-row height, padding, type, panel
>   max-height, min-width, radius, border and surface — and renders through `BodyPortal` with a
>   managed z-index, because a `position: fixed` layer that stays in the tree is re-based by the
>   glass chrome (measured: 324px off).

> **Which labelling model.** `FormControl` is the default for every form field — it is the only one
> that wires `for` + `aria-describedby` + required + error together, and it reserves the hint row's
> height so an appearing error cannot shove the form down. `IconField` adds an affordance glyph
> inside an already-labelled control. `InputGroup` joins two controls that form ONE value
> (amount+currency). `IftaLabel` suits dense data-entry tables where a stacked label costs a row.
> `FloatLabel` suits marketing/auth surfaces only, and never a form carrying hints or validation — a
> floated label collides with its own described-by text. Do not mix models within one form. A form
> that marks any field `required` renders `FieldLegend` once near its submit.

**Implementation status:** `layout` is built and consumed by the app — Box, Container, Grid, Row,
Column, Stack, AspectRatio, Divider, Separator (`packages/ui/layout/`, zero-JS server components;
token-only BEM; `--space-*`/`--container-*`/`--font-*` tokens added to `styles/index.css`).

`navigation` ships the **nested shell layout engine** (Part D): AppShell (Red) → MiddleNav (Blue) →
PageCanvas (Green) with the ShellFrame exposed-corner curvature (top-left always; bottom-left when a
parent track remains), persona/device gates (guest/mobile hide the sidebar and switch the top bar to
a `--glass-blur` glass header). `MiddleNav` is a three-row frame carrying optional route-filled
**`header`** (`.ui-middle-nav__header`, sticky at `--shell-topbar-h`, token
`--shell-midnav-header-h`) and **`footer`** (`.ui-middle-nav__footer`, sticky at `bottom: 0`) bands
flush against the lane; each collapses to zero when unset (see §D.4, Decisions #29/#31). Plus
ShellTopBar, ShellSidebar, NavItem, Link, the `MiddleNavSplitter` and `MobileMenu` islands, and the
`useSplitter`/`useFlushBottom`/`useMediaQuery` hooks (`packages/ui/navigation/`, wired into the
app's group layouts). Shell tokens (`--radius-container-lg`, `--glass-blur`, `--shell-*`) added to
`styles/index.css`. The **wayfinding atoms** now ship alongside the shell (`navigation/islands/` +
`components/`): Menu, Menubar, MegaMenu, TieredMenu, PanelMenu, SlideMenu, ContextMenu (cascading
submenus over the shared `MenuItem` model + `navigation/core/menu.ts` helpers), Breadcrumb, Steps,
TabMenu, TabView (+TabPanel), and Paginator (alias Pagination) — full WAI-ARIA menu/tab/menubar
keyboard models, `useFloating`/`useDismiss` anchoring, and reduced-motion ink-bar transitions.

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
> `Select`/`AutoComplete`; `FileUpload` now ships. **`TimePicker` now ships too, as `TimeTumbler`**
> — the earlier note folded it into `DatePicker`'s `showTime`, which was three native `<select>`s and
> therefore neither token-driven nor touch-usable; `DatePicker.showTime` stays for callers that want a
> compact clock under a calendar, and `DateTimePicker` is the composed control to reach for otherwise.
> `ButtonGroup`, `InputOTP`, `Dropzone` (covered by `FileUpload`'s drag zone), and `Form` remain
> scaffolded for a later pass.

The remaining four taxonomies — **`display`, `feedback`, `overlay`, `utils`** — are now built to
PrimeNG feature-parity, all type-check / lint / `deno fmt` clean:

- **`display`** — the performance-first collections (Table with 3-state sort (asc→desc→none) +
  Shift-click multi-sort gated by a per-table `multiSort` on/off flag, per-column filter, row
  selection + expansion, column resize/reorder, row grouping, conditional styling, lazy loading and
  `stateKey` persistence; TreeTable; Tree with checkboxes/drag-drop/filter/context-menu; DataView
  list⇄grid; VirtualScroller; Scroller; **VirtualGrid** — a windowed, infinite-scroll GRID of
  stretch-to-fill cells built as a "1D-by-row window" over `useVirtualScroll` (measures its own
  inline width → derives columns → virtualizes ROWS; `rowHeight` may be a function of the computed
  cell width for a square/aspect grid; the File Explorer's card grid) all window rows through the
  package-level `hooks/useVirtualScroll` (fixed **or** measured sizes; **own-container OR window
  scroll**; infinite `onReachEnd`; and — additively, for bottom-up feeds like the channel chat —
  `startAtEnd`/`scrollToEnd` to open at the bottom, `onReachStart` to load older at the head, and
  stable `getItemKey` measurement keys so a head-prepend never corrupts the offset table). Plus
  OrgChart, Timeline, GMap (dumb embed wrapper — no keys), Carousel, Galleria, Image
  (zoom/rotate/fullscreen), **AudioVisualizer** — a token-driven voice/audio player (play/pause ·
  seekable rounded-bar waveform · elapsed clock · optional speed cycle) with a dual
  real-`<audio>`/simulated transport and a two-tone `--wave-played`/`--wave-rest` waveform a
  consumer can re-tint (the projects chat memo + attachment/review previews consume it), and the
  content atoms (Card, Avatar/AvatarGroup, Badge/OverlayBadge, RatingStars — a zero-JS read-only
  star meter (a `compact` prop renders a single primary star + score for dense card bylines, in
  place of the full five-star meter), the display counterpart to the interactive `fields` Rating —
  Chip, Tag, List/ListItem, Accordion). **`Card` defaults to `filled`, not `elevated`** — the
  default was the most RESTRICTED variant, so every future consumer would have inherited a resting
  shadow it never asked for. Elevation means the surface is genuinely above its neighbours (it
  overlaps content, drags, or is lifted out of flow); `raised` is a hover/drag/focus response and
  never a resting state. All four card variants and every feature card family read the §A.3 card
  rhythm tokens; none declares its own padding, radius or media ratio.

  **`PaymentCard` — the saved-card instrument, and where its honesty line falls.** A CR80 / ISO-7810
  ID-1 face (a real **1.586:1**, not a rounded 1.6) with a genuine 3D flip (`preserve-3d` +
  `rotateY(180deg)` + `backface-visibility: hidden`), a drawn EMV chip and contactless mark, a
  magnetic stripe and a hatched signature panel. It does **not** supersede the app's wallet
  `PaymentCard`, which renders a `PaymentMethodView` that genuinely has no expiry and no holder name
  and is right to print neither; this one renders a **saved card**, where Stripe returns `brand`,
  `last4`, `exp_month`, `exp_year` and a billing name, and printing what is stored is reporting
  rather than fabrication. The line falls in exactly one place and is structural, not stylistic: the
  PAN zone is three (two on Amex, which prints 4-6-5) **`aria-hidden` mask groups** plus the REAL
  `last4`, and the reverse's security-code box is a `•••` **ornament** — `aria-hidden`, never an
  `<input>`, never a value, with no reveal affordance in the markup or the BEM inventory, and the
  back face's accessible name states outright that no code is held. Every field **degrades to
  absence**: a null `expMonth`/`expYear` renders no expiry block rather than `--/--`, a null
  `cardholderName` renders nothing, a null `last4` renders no PAN.

  Three mechanics are worth knowing before touching it. **The flip control lives OUTSIDE the
  flipper**, because a face goes `aria-hidden` + `inert` the moment it turns away and a control on
  one would leave the accessibility tree exactly when it is needed (it is also what stops a Tab
  landing on an off-screen face). **The picker cell is a sibling component, not a prop** —
  `PaymentCardOption` renders `role="radio"` + `aria-checked` around a `decorative` (fully
  `aria-hidden`) face, because a nested `<button>` inside a `role="radio"` button is invalid HTML
  and the separation makes that combination unreachable rather than merely discouraged; the consumer
  owns the `role="radiogroup"` wrapper and the roving `tabIndex`. **Geometry steps by `@container`,
  never by viewport**: the shell eats ~344px on a laned surface, so a media query here measures a
  box the card does not live in. Art is passed in as token expressions (`resolveCardArt()` from
  `@projective/types/finance`) and applied through
  `--pc-gradient`/`--pc-chip`/`--pc-sheen`/`--pc-fg`; `paymentCardArt()` is the self-contained
  fallback so the package stays importable with no SSOT. There is no network logo artwork anywhere
  in it — a network is named by its wordmark, because there is no asset origin under the CSP and
  reproducing a trademark is a licensing claim a design system must not make for its consumers. Both
  non-colour states carry a glyph and a word as well as a tone (default: tick + "Default"; expired:
  warning mark + "Expired" + a neutral veil + a hatch), and the holographic foil holds full opacity
  under reduced motion because its PRESENCE encodes "business card" — only its drift stops.
- **`feedback`** — Message/Messages/Alert/Banner, Toast (+`useToast`), the Dialog family
  (Dialog/DynamicDialog + `useDialog`/ConfirmDialog/ConfirmPopup), Drawer (alias Sidebar,
  bottom-sheet under `--bp-md`), Tooltip, Popover (alias OverlayPanel), and the progress/placeholder
  set (ProgressBar/Spinner/Ring, Spinner/Loader, Skeleton).
- **`overlay`** — Portal (in-tree fixed-layer, no `preact/compat`), BodyPortal (a real
  `document.body` DOM portal — still no `preact/compat`, built on Preact core `render` — for
  anchored micro-popups that must escape a transformed ancestor's re-based `position: fixed`; used
  by Tooltip, HoverCard, and ConfirmPopup), Backdrop, the generic controlled Overlay, HoverCard,
  **DraggablePopover** (a non-modal draggable + resizable floating window — Pointer-Events drag with
  viewport clamping, keyboard move, a styled bottom-right corner resize handle [Pointer-Events +
  keyboard, clamped to a min size and the viewport, with `onSizeChange` for persistence — a custom
  grip rather than the browser's near-invisible `resize` under the rounded corner],
  `aria-modal="false"`, no backdrop so the page stays interactive; renders through BodyPortal),
  **MoneyFlowPopover** (below), and the `usePresence` enter/exit helper.
- **`utils`** — CommandPalette, Kbd, ScrollArea, ScrollTop, EmptyState, BlockUI, Inplace, Terminal,
  Captcha (dumb mount point), and the directives FocusTrap, Defer, AnimateOnScroll, Ripple.

**`overlay/MoneyFlowPopover` — an app-specific debugger inside a portable package.** The money-flow
debugger is a floating, glassmorphic developer window that shows the active scope, each bound
wallet's Available / Escrow-held / Pending / Projected-payout meter, controls to override a balance
and to drive a purchase → lock escrow → fast-track release → disburse simulation, a before/after
preview of the inspected seller wallet, and the ordered flow trace that simulation produced. It
**composes** `DraggablePopover` rather than forking it, so drag, resize, keyboard move/resize, the
`BodyPortal` mount, the bounded z-stack and `role="dialog"` + `aria-modal="false"` are inherited
unchanged and the page beneath stays fully interactive — which is the point of the tool.

Three decisions in it are contract, not preference:

1. **Portability is resolved by control, not by exception.** `packages/ui` may not reach for app
   code, `@projective/types` or an API route. So the component is **fully controlled and
   data-driven**: it declares its own structural shapes (`FlowWallet`, `FlowLeg`, `FlowScope`,
   `FlowBalances`, `FlowSimulateRequest`, `FlowSetBalanceRequest`), performs **no fetch and no money
   arithmetic**, and emits intent through `onSimulate` / `onSetBalance` / `onSelectWallet` /
   `onScopeChange` / `onResetTrace`. The app wires those to `/api/…` and the fat service does every
   calculation. Money arrives as a `FlowMoney` — the SERVER's pre-formatted `display` string plus
   the minor units, which are used **only** for rail geometry and to state a before/after
   _direction_, never to produce a figure.
2. **The meter never lies under a frozen clock.** Segment widths are set from the value
   (`flex-basis: var(--mf-seg)`, written by the island) and **no property that encodes a datum
   carries a transition** — the failure this rule exists to prevent has already shipped once, a
   meter that animated `flex-grow` with a `backwards` fill and drew every share at zero width in a
   backgrounded tab, on a surface about money. Motion is confined to `opacity`/`transform`. There is
   also **no minimum segment width**: a sliver renders as a sliver with an overhanging achromatic
   pip, because a floor draws a share that does not exist. The rail is `aria-hidden` and decorative;
   the legend carries every fact in four redundant channels — shape mark, label, server-rendered
   figure and printed proportion. **Projected payout is a marker, not a fourth slice**: it is a
   forecast, and summing a forecast into a 100% capital bar would state something untrue.
3. **Glass rides a `::before` underlay**, never the panel, so the window does not become the
   containing block for its own `position: fixed` descendants (§B.10 / the glass-blur fixed-overlay
   trap). Its body text uses `--on-surface` and `--on-surface-variant` only — the veil scale carries
   the variant tone at 4.5:1 by construction, and **secondary text does not go on glass**.

File-Explorer additions (root CLAUDE.md §8 Decision #32): **`fields/SortControl`** (a sort-property
dropdown + an asc/desc toggle inside ONE borderless compound block, signal-first so it can share the
sort signals with a table's clickable headers), **`fields/ZoomSlider`** (− · a segmented track with
a distinct centre transition marker · +, for a zoom-density rig), the borderless
**`.ui-field--bare`** variant (no resting border/background; hover reveals a faint tint, focus a
soft ring — for dense enterprise toolbars), and **`layout/Splitter` `SplitterPanel.maxSize`** (a
hard per-pane maximum so a modal split enforces a fixed structural ratio). **Splitter collision
note:** the layout `Splitter` and the nav lane `MiddleNavSplitter` share the `.ui-splitter` block
name and the nav's globally-loaded `splitter.css` sets
`.ui-splitter { inline-size: var(--shell-lane-w) }`; the layout splitter's root box rules are
therefore scoped to its `--horizontal`/`--vertical` modifiers (higher specificity; the lane never
carries them) so the two never corrupt each other — do NOT move those declarations back onto the
bare `.ui-splitter` selector.

Submissions additions (root CLAUDE.md §8 Decision #33): **`navigation/TreeNav`** — a wayfinding tree
explorer (a lighter sibling of `display/Tree`): borderless disclosure rows with **chevron**
open/close affordances (never triangles), an optional leading icon OR circular avatar per node, an
icon-only trailing status slot + a muted count, controllable selection + a controllable/internal
expanded-key set, `role="tree"`/`treeitem` with arrow/Home/End keys. Selecting a row scopes the host
workspace; a single-hairline vertical divider between the tree and the workspace is the host's
concern (§B.4). Also a backward-compatible **`Breadcrumb` extension**: a crumb may carry a
`MenuItem.command` for **client-driven** trails (an in-place tree navigator) — the crumb stays an
anchor (its `url` remains deep-linkable / new-tab-openable) but a plain left-click is intercepted
(`preventDefault` → `command`); crumbs without a `command` are byte-identical to before. Both
consume the review-modal's reuse of the existing `layout/Splitter` (hard min/max %), and inherit the
same **Splitter collision** discipline above unchanged (the feature does not touch `splitter.css` or
the nav splitter).

Kanban additions (root CLAUDE.md §8 Decision #35): two NEW sub-paths. **`@projective/ui/dnd`** — a
dependency-free, **Pointer-Events** drag-and-drop kit (NO native HTML5 `draggable`, NO external
library — root CLAUDE.md §3 · PRODUCT_SPEC §Libraries · SYSTEM_ARCHITECTURE §KanbanBoard). One
`DndContext` island owns the sensor engine (a pointer sensor with a movement-threshold so a click is
never a drag + capture-phase click-suppression, and a keyboard sensor: Space/Enter pick up · Arrows
move · Enter drops · Escape cancels) over a signal-first store;
`Draggable`/`Droppable`/`SortableContext` (alias `SortableContainer`) + the
`useDraggable`/`useDroppable`/`useSortable` hooks mark nodes; `DragOverlay` renders the elevated
ghost through `BodyPortal` (escapes the glass-blur `position: fixed` trap); `useDndMonitor` lets a
consumer react to the drag lifecycle. Collision detectors (`pointerWithin` → `closestCenter`
fallback, and `nextInDirection` for the keyboard sensor) are pure. Signal-first, `--z-`/
`--elevation-high`/`--spring-*` token-only, reduced-motion collapses the ghost tilt, and it ships an
`aria-live` keyboard-DnD announcer. **`@projective/ui/kanban`** — a generic, **controlled**
`KanbanBoard` (+ `KanbanColumn`/`KanbanCard`) built on `dnd`: columns hold items; a card drags
across columns (and reorders within a `sortable` column), `reorderable` columns re-sequence, with
live drop indicators, WIP counts, sleek inner scrollbars, elevation-on-drag, and a grip handle for
keyboard drag. It NEVER mutates the model — it emits `KanbanItemMove`/`KanbanColumnMove` on drop, so
a consumer can commit immediately OR intercept a move behind a confirmation modal (the projects
board's stage-reorder / claimed-ticket / revision warnings). §B.4: columns are non-interactive
containers (tonal tint + a single hairline, no box); cards are interactive (surface + radius +
resting elevation).

Calendar additions (root CLAUDE.md §8 Decision #37): one NEW sub-path **`@projective/ui/calendar`**
— a high-performance, generic, **controlled** Calendar & Schedule engine (Google-Calendar /
Monday.com inspired), portable + **zod-free** (a consumer maps its own domain data into the
presentational `CalendarEvent`/`CalendarAvailability` shapes and reacts to the selection/open
callbacks, so the ONE engine serves the project/channel calendar, `@handle` availability, and
session schedules). The `Calendar` island lays out a two-panel shell: a narrow left panel
(`MiniMonth` mini-map — hovering a day tints its whole week ~15%, clicking jumps the main view —
over an `AvailabilityPanel` of working hours · timezone live clock · blackout dates) and a main
viewport (`CalendarHeader` view-switch + nav + search + a consumer-owned `actions` slot, over the
`MonthGrid`, the Week `TimeGrid`, or the infinite Day `DayTimeline`). Both panels are optional —
`hideSidePanel` and `hideHeader` let a host that has already given those duties a home of its own (a
surface built on the shell's region contract, Part D) mount the grid alone and drive it through the
tracked `view`/`focus` props, hearing back through `onViewChange`/`onFocusChange`. The header
previously carried a fixed row of external-calendar STATUS CHIPS painted from a hardcoded
five-provider list; they are gone, and the slot replaced them, because the package had no business
holding a connector vocabulary and the chips could not be pressed. An event's PROVENANCE is now
`CalendarEvent.sources` — every calendar an occurrence is on — drawn as a stack of overlapped
circular marks the consumer renders through `renderSource`, so the engine still carries no brand
artwork (§B.7 quarantines a brand mark out of the icon registry: it cannot be re-weighted or
recoloured without ceasing to be the mark). `useCalendarViewport` owns the time-grid engine:
**virtualized** hour cells, an initial scroll centred on the time-scale (now when today is in view,
else noon — symmetric room across both midnights via a ±3h overscroll pad), **Ctrl+wheel zoom** that
scales `--cal`-px-per-hour in place AND transitions Day↔Week↔Month across thresholds, middle-mouse /
Ctrl-drag 2D **panning** (handlers `preventDefault` so no native autoscroll/page-zoom), and a
return-to-present pill, plus an immediate scroll-signal `sync` after any programmatic scroll (so a
hidden/deferred `scroll` event never leaves a day-timeline virtualizing the wrong window). Every
navigation jump goes through `scrollToFocus`/`scrollToNow` rather than a hand-rolled `scrollTo`, and
their behaviour comes from `scrollBehaviorFor()`: on this surface the scroll offset is not
decoration but WHICH PERIOD the grid renders, so a smooth scroll — a frame-driven animation CSS
cannot neutralise — degrades to an instant jump under `prefers-reduced-motion` (the §B.5
jump-to-final rule, which a JS `scrollTo` has to honour itself) and in a hidden/background document,
where the animation clock is paused and the header would otherwise advance to a period the grid
never travelled to. The timed views replace the global native-styled scrollbar with
`OverlayScrollbar`/`useOverlayScrollbar` (`.cal-tg__scroll` opts out at class specificity, which
also closes the header/column misalignment the reserved native gutter caused): a self-hiding overlay
DEPTH gauge whose handle is longest at the shallow end and shrinks toward a 24px floor as you go
deeper, touching the leading end at the top of the range and the trailing end at the bottom —
because a proportional thumb on an effectively infinite axis is a hair that means nothing. The
handle's length FREEZES on pointer-down and stays frozen until the pointer has both released and
left it, so it never resizes under a stationary cursor. Position and length are written directly
from measurements and only `opacity`/`background-color` transition, because a frozen animation clock
(a hidden or background tab) must never be able to strand a value the reader is meant to trust.
Wheel and the container's middle-click/Ctrl-drag pan pass through the overlay unchanged. The live
current-time line is its own leaf (`NowIndicator`) reading the clock signal directly, and
`useNowTick` runs at a 60s cadence with everything upstream consuming a day-granular `computed`
instead — so a tick moves the indicator and nothing else (measured: 3 DOM mutations across the whole
calendar subtree for one tick, none of them in the event tree). **Both** timed views are genuinely
INFINITE, virtualized continuous timelines: the **Day** `DayTimeline` stacks days on a ~4-year
elapsed-time axis, and the **Week** `TimeGrid` stacks WEEKS — seven days are columns, so one week is
exactly 24 hours of vertical axis and scrolling past 24:00 flows into the next week's 00:00,
endlessly (~19 years each way). Only the blocks/days intersecting the viewport render, DST-correct
via zoned day arithmetic; inline period markers label each seam and the centred period is tracked
back to the header + mini-map. Both fall back to the FOCUSED period whenever the container is not a
bounded scroll viewport (SSR, or a host that does not cap the calendar's height), which is also the
condition the centering latch uses — a decades-long axis in an unbounded box would otherwise put
every block "in view". The **Month** `MonthGrid` deliberately does NOT scroll: a month is a discrete
named unit, so it PAGINATES a whole month per gesture (wheel with an inertia refractory period, Page
Up / Page Down, and the header's own Prev/Next, all through one `onPage` callback so they cannot
disagree), and its per-cell chip cap is MEASURED against the cell rather than fixed, so hidden chips
are always announced by "+N more" instead of silently clipped. `packDayEvents` resolves overlap into
fractional side-by-side columns; the `calendarTime` matrix utils are **timezone-explicit** (`Intl`)
so SSR == the hydrated island (no drift).

**The timed views are CANVAS, at two depths** (`GridCanvas` + `useGridCanvas` + the pure `paintGrid`
and `paintScene`). Hour rules, day boundaries, day-column separators, working-hours bands and the
blacked-out-day hatch are decoration — every fact they carry is already spoken by the gutter's hour
labels, the column headers and the availability panel — and they used to cost an element apiece, so
the layer's node count tracked how much axis was on screen (measured on `/@handle/availability` at
1440×900: **52 nodes in Week and 105 in Day → 7**, and 7 at every zoom, scroll depth and column
count).

The **Day** `DayTimeline` stops there and stays HYBRID: its event cards remain HTML over the
lattice, so its hour LABELS stay in the DOM gutter too — at that depth there is no parallel layer to
carry them, and canvas text has no find-in-page, no selection and no text cursor. The **Week**
`TimeGrid` goes the whole way: `.cal-tg__viewport` holds one `aria-hidden` `<canvas>` and nothing
else, and the hour scale, day columns, every event card, the current-time rule, the drag preview,
the period markers, the depth gauge and the return-to-present pill are all pixels from one ordered
pass. **That is only shippable because of what sits BESIDE the viewport**, which is the merge gate
rather than a nicety: a parallel accessible layer of real focusable controls carrying the same names
and the same handlers — one per card, plus Return-to-now, plus a keyboard create — a `role="region"`
that owns Arrow/Page/Home/End scrolling, a `reveal` that replaces `scrollIntoView` and holds a
focused card's block in the layout window so paging cannot unmount it, and an `aria-live` line
naming the visible range, quantised to the hour so it speaks once per hour crossed rather than once
per pixel. Those controls are visually hidden and so can show no focus ring of their own; the canvas
paints one for each — around the focused card, around the pill, and around the whole viewport for
the region — **two-tone**, halo inside and ink outside, because a single tone cannot clear 3:1
against both an accent-tinted card fill and the grid behind it, and a canvas ring cannot be
corrected later by a cascade.

Three consequences are designed for rather than discovered. A canvas cannot read a CSS custom
property, so every colour, width, radius, alpha, box and glyph weight is still AUTHORED in
`calendar.css` against `var(--*)` — on a hidden swatch subtree whose resolved `getComputedStyle`
values the hook reads back, which is what lets `color-mix()`, the generated Material palette and the
a11y token overlays reach a canvas at all. The palette is re-resolved whenever the theme attributes
or inline tokens move on the probe's ancestor CHAIN (not the root alone — a portable consumer may
theme a `.ds-scope` subtree), the swatches opting OUT of the global crossfade so a read is always
the final value rather than the one a frozen animation clock happens to be passing through; and
because canvas type is now real type, the open-dyslexic overlay travels in FULL — family, tracking,
word spacing and leading, since `styles/index.css` calls all four documented reading aids rather
than a preference. And the draw is synchronous in a layout effect with **no `requestAnimationFrame`
anywhere in the path** (verified with rAF stubbed dead in a hidden tab: a scroll still repainted to
the exact new offset), because a grid whose lines needed a frame would simply be blank in a
background tab. The canvas itself is `aria-hidden`, takes no pointer, scales its backing store by
`devicePixelRatio` (verified: 1568×1361 for a 784×680.5 box at 2×, hairlines landing on whole device
pixels), observes its box with a `ResizeObserver` rather than a window listener, and mirrors under
`dir="rtl"` by a single negated horizontal scale so the column order matches the CSS grid's own RTL
flow. Because the Week viewport has no scroll container for the browser to pan, it declares
`touch-action: pinch-zoom` and owns the one-finger drag itself — a finger SCROLLS and a tap
activates — while pinch stays with the browser so page zoom survives (WCAG 1.4.4).

§Part 1.4 privacy masking: external-integration +
general-availability blocks render ONLY Available / Busy / Tentative (never a real title); public
group sessions may show an attendee counter. §B.4: grid lines/cells/panels separate by spacing +
tonal surface + single hairlines; the interactive event blocks + day cells + controls carry the
surface/accent/border + focus ring.

Cross-cutting behaviour lives in a new **package-level `packages/ui/hooks/`** (`useFloating`,
`useEdgeDetection` [alias `usePopoverPosition`], `useDismiss`, `useFocusTrap`, `useOverlayStack`
[z-index stacking + ref-counted scroll lock], `useVirtualScroll`, `useIntersectionObserver`,
`useMediaQuery`, `useRipple`, + re-exports of the value/id/list-nav hooks). Additive tokens added to
`styles/index.css`: the `--z-*` overlay-stacking scale, `--bp-*` breakpoints, and the over-damped
`--spring-*` curves. Shared collection/menu/overlay vocabulary (`MenuItem`, `TreeNode`,
`TableColumn`, `SortState`, `Placement`, `Edge`, …) lives in the package `types/mod.ts`.

**Overlay portalling + the layered z-scale (2026-07-23).** Every anchored/modal overlay panel now
renders through the real `document.body` **`BodyPortal`** — `Popover`/`Tooltip`/`HoverCard`/
`Dialog`/`Drawer`/`ConfirmPopup`/`DraggablePopover`. A `position: fixed` panel that merely stays in
the tree is NOT safe inside the authenticated shell: the sticky middle-nav lane is a stacking
context that caps its subtree's paint order, and any glass ancestor's `backdrop-filter` re-bases
`fixed` onto that ancestor's box — so a menu opened from the lane was clipped away. Portalling to
the body escapes all three (stacking context, `overflow: clip`, and the transform/filter re-base).
The `--z-*` scale in `styles/index.css` encodes a **strict class hierarchy** — page content
`--z-base` < nav lane `--z-raised` < sticky bands `--z-sticky` < site header `--z-nav` < popovers
`--z-popover`/`--z-overlay` (1100) < modals/drawers `--z-modal` (1300) < draggable windows
`--z-draggable` (1500) < toasts < tooltips. `useOverlayStack(layer)` allocates each mounted overlay
a live index from its class base, stepping above any overlay already open, so an
independently-opened modal always outranks an independent popover AND a dropdown opened _inside_ a
modal still stacks above it. The lane itself carries `z-index: var(--z-raised)` so its sticky bands
can never paint over its own content.

**The overlay family contract (2026-07-31).** A consistency audit found the family had drifted into
twelve panels with five radii, two seam tokens, six scrim recipes and seven ad-hoc dialog widths.
Geometry is now named once in `styles/index.css` and consumed everywhere: `--overlay-radius-sm`
(anchored/system tier — Popover, Tooltip, ConfirmPopup, Toast, Message, Alert, HoverCard) and
`--overlay-radius-lg` (workspace tier — Dialog, Drawer sheet, DraggablePopover, the app modals);
`--overlay-w-sm/md/lg/xl/full` and `--overlay-h-md/lg`, **each carrying a viewport term** so a panel
can never exceed the window; `--overlay-action-size` as the single close/action hit target (the four
shipped sizes included a 24px one that failed WCAG 2.5.8); and `--drawer-w`/`--drawer-h`, which the
Drawer now actually consumes. Seams are `--hairline` throughout — the package layer had used opaque
`--border-subtle` for the same job the app layer did with `--hairline`. **The scrim is one recipe:**
`--scrim` (the darkest neutral in BOTH themes) at a per-theme `--scrim-tint`, plus `--on-scrim` for
anything drawn on top of it, blurred by the single `--scrim-blur`. `Backdrop` no longer takes a
`blur` prop — how hard the page dims is a property of "a modal is open", not of the caller.

**Modal focus + dismissal contract.** `useFocusTrap` binds Tab to `document` (a container-scoped
listener stops firing the moment focus escapes, silently un-trapping the overlay), keeps a stack so
nested traps do not fight, resolves an `initialFocusRef` that points at a non-focusable scope to its
first tabbable (`ConfirmDialog` uses this to open on the REJECT button rather than the header ×),
and marks every sibling of the trapped subtree `inert` + `aria-hidden`. `useDismiss` takes `enabled`
— pass `useOverlayStack().isTop` — because every instance listens on `document` in the capture
phase, so gating only inside the callback let an outer overlay consume an Escape it then ignored.
Escape now uses `stopImmediatePropagation`. `useOverlayStack` derives its ceiling from live claims
and pushes `isTop` to every open overlay, so the class hierarchy cannot drift upward across a
session, and it compensates the scrollbar with `padding-inline-end` so `dir="rtl"` is not shifted.

**Presence must never depend on a frame.** Every panel's resting CSS is `opacity: 0`, corrected only
by `[data-state="open"]` — so the enter flip in `usePresence` (and the initial focus move, and the
Toast enter class) carries a timer watchdog beside its `requestAnimationFrame`. A hidden or
throttled tab never services rAF, which previously left a mounted, scroll-locked, focus-trapped,
**invisible** modal that never repaired itself. Reduced motion opens in the same commit and skips
the frame entirely. The same rule governs CSS: the Toast countdown animates `transform: scaleX()` on
a statically full-width bar, never `inline-size`, so a frozen animation clock cannot leave the bar
claiming a timer that has already expired.

**Collision + boundary model (`useFloating` / `useEdgeDetection`).** Anchored overlays resolve in
three layers: (1) **viewport flip/clamp** — flip to the opposite side when the preferred one lacks
room, then clamp on-screen (minus `padding`); (2) **higher-level nav avoidance** (`avoid`) — a hard
constraint keeping the panel clear of primary layout chrome (the site sidebar, the header), shifting
it away (a left sidebar pushes it right); (3) **lower-level allowed overflow** (`allowOverflow`) —
the panel may spill past the named viewport edges into subordinate regions (a header search dropping
into the body/middle-nav). `avoid` accepts CSS selectors (re-measured on every reposition so
collapsed/expanded/dragged chrome stays honoured), refs, or rects. `useFloating` is the
ref-consuming engine `Popover`/`Tooltip` compose (both now take `avoid`/`allowOverflow`);
`useEdgeDetection` is the ref-owning facade a feature reaches for to hand-roll a dropdown, returning
`{ triggerRef, ref, style,
placement, … }` to spread onto a panel carrying the `.ui-anchored`
primitive class (fixed + `--float-*`), so ancestor `overflow: hidden`/`clip` never truncates it.

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
   full-width, scroll-adaptive glass `SiteHeader` (the four discovery megamenus — Helpers · Services
   · Projects · Products) over a **full-bleed body**, plus, on routes that supply one, a **floating
   glass side nav** (the route lane — no splitter handle, a footer collapse toggle) and a **floating
   glass sub-header**. Guests never render the full-bleed `ui-shell-topbar` or the full-height
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
scroll on every form-factor × auth profile. The root grows past the viewport
(`min-block-size:
100dvh`, **no** `overflow` cap) and the **browser window** owns the single main
scrollbar. The chrome stays put by **pinning to the viewport, not by locking the document**: the top
bar is `position:
sticky; top: 0`; the global sidebar and the middle-nav lane are `position: sticky`
just below the top bar (`inset-block-start: var(--shell-topbar-h)`), each capped to the remaining
viewport height with its **own** internal overflow (`.ui-shell-sidebar__items`,
`.ui-splitter__body`) so a tall rail scrolls inside itself rather than lengthening — or scrolling
away with — the page.

> **The two rails express that cap differently, and the difference is load-bearing.** The global
> sidebar sits in a single grid row, so a definite `block-size: calc(100dvh - topbar)` with
> `align-self: start` is safe. The **middle-nav lane spans all three frame rows**
> (`grid-row: 1 / -1`, so its own header/footer align into the header and footer bands), which makes
> a definite height on it an **input to sizing the tracks it crosses** — and a spanning item's
> contribution lands on the flexible `1fr` content row **without the auto-sized bands being deducted
> first**. So the lane must cap with **`max-block-size`** and **stretch** to its area, never
> `block-size` + `align-self: start`. With the definite height it sized the content row to the whole
> viewport remainder and the bands then stacked _on top_, making the frame taller than the viewport
> by **exactly (header band + footer band)** — a document scrollbar on every laned route meant to
> fit the screen (measured at 720px: 98px on `/projects/{id}/{channel}/tasks`, 50.4px on `/…/board`,
> 48px on `/…/calendar` and `/@handle/availability`). A long body is unaffected either way: the rows
> already exceed the cap, so the lane clamps to it.

**A surface that is meant to fit the screen fills its grid row; it does not re-derive one.** The
Kanban board (`.brd`) and the in-app calendar (`.cal-surface`) are `flex: 1 1 0` down the
`.ui-page-canvas__body` column rather than computing `100dvh` minus a guess at the chrome above and
below. Those guesses cannot be made correct: a band's height is whatever the route mounts into it,
and which bands exist changes per route. **The basis must be `0`, not `auto`** — the frame is
content-sized so the window can scroll a long body, so an `auto` basis lets the surface's natural
height bid the `1fr` row larger and the frame grows to honour it (measured: a 639.83px board demand
against a 621.61px region — 18px of scrollbar on a board already told to fit). A `0` basis
contributes nothing intrinsically, so the row is sized by what is **left** and the surface expands
into exactly that; its own columns / time grid keep the internal scroll, which is where that
overflow belongs. For the same reason such a surface carries **no `min-block-size` floor** — a floor
taller than the region is precisely how a fit-to-screen page grows a scrollbar on a short viewport.

The Green body (`.ui-page-canvas__body`, `overflow: visible`) flows naturally: its content lengthens
the document and the window scrolls it, while in-view chrome (the channel header **band** + the chat
composer **footer band**) sticks to the viewport within that same window scroll. The nested frames
use `overflow: clip` (for the rounded corners), which does **not** establish a scroll container, so
every sticky descendant resolves against the window — one scrollbar, no nested traps.

**One scrollbar, everywhere.** The root document and every inner scroll container share a single
always-visible **10px** bar (`styles/index.css`), declared once against `*` and the bare
`::-webkit-scrollbar-*` pseudo-elements so it reaches `html`/`body` as well as every descendant:
`scrollbar-width: thin` + `scrollbar-color` for Firefox and the standard, the richer pseudo-elements
for Chromium/WebKit, both fed from the SAME two tokens so the engines cannot drift. Buttons/arrows
are never drawn. `width` and `height` are both set — a horizontal bar's thickness is its `height`,
and setting only `width` leaves it at the UA default; physical rather than logical here because
`::-webkit-scrollbar` is a non-standard construct with no writing mode of its own, so this is not an
§A.6 exception.

**The thumb is a token; the track is a surface.** `--scrollbar-thumb` / `--scrollbar-thumb-hover`
are generated by the theme engine off the neutral-variant ramp through `fg()`, so they follow the
mode AND widen under the high-contrast overlay — a thumb is a graphical control, so it clears the
**3:1** of WCAG 2.2 SC 1.4.11 against **every** surface it can abut (measured: 3.17:1 at worst on
`--surface-3`, 3.89:1 on `--bg`, hover ≥4.83:1, high contrast ≥4.83:1 / ≥7.14:1, identical in both
modes). `--scrollbar-track` is NOT a palette entry — it is whatever surface the scroller sits on —
so it is declared once at `:root` as `var(--bg)` and RE-SCOPED on each container that establishes a
surface. Custom properties inherit, so only the surface ROOT carries a rule and every scroller
inside it follows: this is the whole mechanism, and it is why a body-portalled panel needs scoping
most of all (it hangs outside the shell and would otherwise take the page ground). A **translucent**
panel takes `transparent`, never a tone — its ground is a `color-mix` over whatever is behind it, so
an opaque track would draw the seam the veil exists to avoid. A surface nobody scoped still inherits
`--bg`, which is the correct answer for anything sitting directly on the page.

A component that renders its own overlay bar (`.ui-scroll-area__viewport`, `.ui-scrollpanel__viewport`,
`.cal-tg__scroll`) or a horizontal rail/tab strip that must show none opts out at class specificity
with `scrollbar-width: none` **and** `::-webkit-scrollbar { display: none }` — **both**, or one
engine hides the bar and the other does not.

> _History: this **reverses Decision #20's** locked-viewport model and returns to the
> native-window-scroll intent of Decision #15/#27. Decision #30 briefly re-pinned the middle-nav
> frame (internal content scroll) so its rounded corners wouldn't scroll away; **Decision #31
> reverses #30** — the middle-nav region is back on the native window scroll, and the chat composer
> moves from inside the scrolling body to a sticky **middle-nav footer band**
> (`.ui-middle-nav__footer`). The old `.ui-page-canvas__scroll` is renamed `.ui-page-canvas__body`
> (it no longer scrolls — the window does). See root CLAUDE.md §8 Decisions #27/#30/#31.
>
> The **self-hiding** scrollbar this section used to describe — transparent at rest, revealed on
> container hover or by a `[data-ui-scrolling]` stamp from a global `ScrollIdle` island, and scoped
> `:not(html):not(body)` so the window kept the raw native bar — is **retired**. It shipped two
> scrollbars with two behaviours and two colour vocabularies, and its thumb was registered at a tone
> that measured **1.00:1** against `--surface-3` in dark mode (the identical colour) and 1.23:1 at
> its best. `ScrollIdle` is deleted with it: with the bar always drawn it had nothing left to
> reveal._

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
    carries `position: relative; z-index: --z-sticky`) and are vertically centered on their link;
    expanded-rail labels use a **medium** weight with **bolder** glyph strokes for a readable,
    high-end tone.

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
`CustomEvent` (dispatched by lane chrome such as the Projects lane's footer toggle) collapses the
lane to its rail (`min`) or restores the last expanded width — the programmatic equivalent of
dragging the handle shut, matching the main-nav rail toggle. Off by default so the package stays
portable.

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
**middle-nav frame's configurable header band** rather than rendering an independent header inside
the scroll flow. The `MiddleNav` frame is a two-row grid: the **lane spans both rows** on the left,
while the right (content) column splits into an optional **`header` band**
(`.ui-middle-nav__header`, row 1) above the content canvas (row 2). The **shell layout fills the
band per route** — a pure resolver keyed on the URL (`channelHeaderFor`, the sibling of the lane's
`laneFor`), not a client context (which could not paint it on the first SSR byte). On a specific
channel engagement it holds the app-level `ChannelHeader`; on every other route the band is
**omitted entirely**, so the row collapses and the canvas fills the top of the frame with **no
reserved space / no empty bar**. Crucially the band sits **flush against the lane on the shared Blue
`--surface-1` frame + top curve**, so it and the lane's own Back/kebab header (sized to the same
`--shell-midnav-header-h`) read as **ONE connected strip across the whole middle-nav frame** — the
header is attached to the same surface/curve as the sidebar, not floating inside the content pane.
The routed tab body + `ChatComposer` flow in the canvas beneath it:

- **Configurable header band (top).** A single row pinned `position: sticky` at the top-bar offset,
  spanning the content column of the frame — the active channel's identity (kind glyph / DM avatar +
  title + presence/activity sub-line) on the left, the contextual **view tabs** (Chat · Files ·
  Members [· Submissions | Calendar] [· Tasks], format-gated) in the centre, and icon-only actions
  (primary create · details drawer · star · kebab) on the right. It is **not** a boxed toolbar — a
  single `--hairline` `border-block-end` continues the seam across from the lane header (§B.4). The
  band (`.ui-middle-nav__header`) owns the sticky positioning; `ChannelHeader` itself is a plain
  in-flow strip on `--surface-1` that fills it. `PageCanvas` no longer carries a header slot of its
  own.
- **Underlined tabs.** Tabs are **plain text items**, no pill/box background. The active (and hover)
  indicator is a 2px `--primary` underline (`::after`, `scaleX` transform, jump-to-final under
  reduced-motion) pinned to the header's bottom edge (`inset-block-end: -1px`) so it sits
  **precisely on top of the divider hairline** — a seamless tab-to-body seam. Tabs are real anchors
  into the nested routes (`.../[channel-id]/{chat,files,members,submissions,calendar,tasks}`), so
  the active tab is URL-driven and deep-links land correctly. On mobile the labels collapse to their
  leading glyph.
- **Composer footer band (bottom, Chat-only).** The blurred message input (`ChatComposer` —
  auto-growing field, attachment/paste chips, voice recorder, dynamic Mic→Send→Stop control) is the
  content of the **middle-nav frame's configurable `footer` band** (`.ui-middle-nav__footer`), a
  sibling of the header band that is `position: sticky; inset-block-end: 0` at `--z-sticky` under
  the native window scroll — so it locks to the viewport bottom while the message stream scrolls in
  the window beneath it (Decision #31). It is resolved per route by `channelFooterFor` and threaded
  through `UserShell.middleNavFooter` → `MiddleNav.footer` **only for the Chat tab** (nothing to
  compose on Files/Members/…), mirroring the header slot exactly. `.chat-composer` itself is only
  `position: relative` (the containing block for its scrim/drop overlays); its `--glass-blur` scrim
  stays on a separate underlay element (the fixed-overlay trap, root CLAUDE.md §8/§9).
- **Native window scroll for the middle-nav region (Decision #31, reverses #30).** The middle-nav
  frame is NOT pinned — it flows in the native window scroll like the rest of the shell. The frame
  is a three-row grid (header band · content · footer band; the lane spans all three); the header
  band (`sticky` at `--shell-topbar-h`) and footer band (`sticky; bottom: 0`) pin to the viewport
  while the content flows and lengthens the document. `.ui-page-canvas__body` (renamed from
  `__scroll` — no longer a scroll container) is a flex column so the channel view + chat feed can
  `flex: 1` to fill the content row and bottom-anchor a short conversation just above the composer.
  **Mobile** keeps the native window scroll and drops the frame chrome (Part D.3).
- **Bottom-up, window-virtualized message feed (Chat tab).** The Chat body is the `ChatFeed` island:
  it virtualizes the stream against the **window** (`useVirtualScroll` `useWindow`), opens at the
  newest message, and loads OLDER history as the viewer scrolls up (a top IntersectionObserver
  sentinel → thin `MessagesService` page → prepend, re-anchored by the exact document-growth delta
  so the view stays put). Rows are keyed by message id so a head-prepend never corrupts the offset
  table (variable message heights are measured at runtime). Grouping (same author within 10–30 min):
  reduced separation, one avatar + name on the group's first row, and corner masking (others sharpen
  the group-toward LEFT corners; own the RIGHT). Own messages align right, others left; bubbles cap
  at `max-width: 60%`. Hover reveals the sent time (always in the DOM, opacity-toggled — no layout
  shift) + a Reply·React·Copy toolbar and a `…` menu (Pin·Favourite·Report; Pin gated by
  server-derived `canPin` — anyone in a DM, owner-granted in a project/team channel). A favourited
  message carries a custom **"wonky star"** mark on its bubble border. Media lays out as an
  aspect-ratio row (≤3 visual media) or a rounded-square grid (mixed/overflow, **max 4 tiles**, the
  4th a `+N` overlay); audio memos reuse the composer's waveform visualizer; system-activity notices
  render inline and route to their target on click. Up to **3 pinned** messages sit in a sticky
  banner (one at a time, `‹`/`›` loop, Expand, and jump-to-message).
- **Channel-tree icons (§B.6).** Stage channels render as ordinary **`#` hash channels** (matching
  General/Team rows), not a coloured lifecycle dot; their state surfaces through the trailing
  icon-only status signal + unread dot. DM/team rows keep their **circular avatar** thumbnail.

### D.5 Guest floating shell

For **guests** the shell is not the nested L-frame — it is one floating composition, `GuestShell`
(`apps/web/features/shell/`), used verbatim on every guest-reachable route (the `(public)` surfaces
and `/[handle]`). It layers floating, glassmorphic panels over a **full-bleed body**, reusing the
marketing `.site` / `.site__main` base (the fixed → pill-on-scroll `SiteHeader`, the reserved header
band, and `overflow-x: clip`), so lane-less routes (`/`, the Explore Home feed) are structurally
unchanged (the Explore **Search Results** now supply a filter lane — Decision #40):

- **Floating pill header.** The unchanged `SiteHeader` (full-width, morphing to a glass pill on
  scroll, discovery megamenus intact) is the top chrome on **all** guest routes — replacing both the
  prior marketing-only header and the guest `AppShell` `ui-shell-topbar`.
- **Side nav (route-driven).** When a route supplies a lane (today: the profile action lane; the
  Explore Search filters — Decision #40) it mounts in a glass `.ui-guest-aside` (rounded, glass) —
  the guest counterpart of the middle-nav lane, but with **no drag-resize splitter handle**. It is
  an **in-flow `position: sticky`** flex item of `.guest-shell__region` (Decision #40 changed it
  from `position: fixed`): it pins below the header while the page scrolls, but is bounded by the
  region so it **terminates cleanly above the full-width footer** instead of overlapping it.
  Collapse/expand is the lane's own footer toggle, driving the same `MIDDLE_LANE_TOGGLE_EVENT`; the
  state is cached (`LocalKeys.GUEST_NAV_COLLAPSED`) and expressed on the **pre-painted**
  `:root[data-guest-nav]` (mirroring the authed rail's `:root[data-sidebar]`), so the width paints
  correctly on the first byte (no flash-of-wrong-width). The filter lane has no toggle, so it forces
  the aside expanded.
- **Full-width footer + flex-column region (Decision #40).** On lane routes GuestShell is a flex
  column: the aside + body share a growing `.guest-shell__region` (`flex: 1 0 auto`) above a
  **full-width `PublicFooter`** that is a sibling of the region — so the footer spans the whole
  window (never inheriting the aside's inline gutter) and pins to the viewport bottom on short
  pages. Lane-less routes keep the plain `.site` block flow with the footer at the body's end
  (already full-width).
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

### D.6 Focus chrome (the distraction-free mode)

**Focus chrome is a chrome _density_, not a fifth navigation profile.** The four profiles above are
resolved by form factor × auth and describe _which shell composes the page_; focus chrome is a
property of the **route** that says how much of that shell is constructed. It applies to the
authenticated profiles (2 and 4) and is expressed as one prop — `AppShell`/`UserShell`
`chrome?: ShellChrome` (`"full" | "focus"`, default `"full"`,
`packages/ui/navigation/components/AppShell.tsx`) — which stamps `data-chrome="focus"` on
`.ui-app-shell` as the single CSS hook. In `focus` the shell renders **no global sidebar, no lane,
no header search, no utility bar and no `BottomNav`**; the top bar keeps only the brand mark.

**When to use it.** A **linear, committing flow** — one the person entered on purpose, that has a
defined end, and where a stray navigational exit costs them the work in progress. Today that is the
checkout's **Details** and **Payment** steps. The two steps either side of them deliberately keep
the full shell, and the contrast is the rule rather than an inconsistency:

- The **basket** is a place a buyer legitimately leaves — to add one more thing, to re-read a
  listing — so removing its exits would trap them in a flow they have not committed to yet.
- The **confirmation** is _after_ the commitment, and its entire job is to send the buyer somewhere
  (a download, a project board, a calendar). Removing the exits there would defeat the page.

Anything that is not a committing flow keeps `full`. A page is not a candidate because it is dense,
important, or "wants to feel focused"; it is a candidate because leaving it mid-way loses something.

**The mode removes chrome by NOT CONSTRUCTING it.** Nothing is hidden with `display: none`, and the
distinction is load-bearing rather than stylistic: hidden chrome is still in the layout, so it still
holds its grid track and still contributes to the frame geometry. `AppShell` computes
`showSidebar = persona === "user" && !!sidebar`, so a caller that passes no sidebar gets no
`"sidebar"` track at all — keying on the persona alone left a 64px empty column _and_ left
`--shell-frame-inset-inline` accounting for a rail that was not on screen, so the nested frame's
fixed corner seam sat 64px inboard of the frame it traces. A "hidden" 280px lane leaves a 280px hole
for exactly the same reason. `UserShell` therefore sets `activeLane = undefined` in focus and drops
the lane even when one is passed, rather than styling it away.

**The middle-nav frame still renders — with no lane.** The frame is registered whenever _any_ band
is (`framed = activeLane || middleNavHeader || middleNavFooter`), which is how the checkout stepper
spans the top of the canvas with nothing beside it. `.ui-middle-nav` is
`grid-template-columns: auto minmax(0, 1fr)` and the band placements are **explicit**
(`grid-column: 2`), so with no grid item in column 1 the `auto` track resolves to `0px` and the
bands simply start at the frame's inline edge (measured `0px 1265px`; the header flush at `x = 0`,
zero overflow). Nothing collapses and nothing reflows — the lane and the bands were never coupled.

**Two geometry facts survive removal, and both are custom properties rather than layout.**

1. **The seam accumulator.** `.ui-middle-nav` adds the lane's width to `--shell-frame-inset-inline`
   **unconditionally**. With no lane, the fixed corner seam drawn by
   `.ui-app-shell__content::before` would sit `--shell-lane-w` (280px) inboard of the frame it
   traces — a stray hairline and tint running down the middle of the page. The focus block resets it
   to `0px` on `.ui-app-shell__content`, `.ui-middle-nav` and `.ui-page-canvas` (specificity
   `(0,3,0)` against the frame rule's `(0,1,0)`, so the override wins).
2. **The nested-frame curve.** The top-left radius is the _mark of nesting_. In focus there is no
   rail and no lane beside the content, so the curve describes a relationship that is not on screen;
   it flattens against the top edge.

> ⚠ **`--frame-radius` must be set on `.ui-app-shell__content`, not on a descendant.** The
> pseudo-element that reads it (`.ui-app-shell__content::before`) belongs to **that element**, and a
> custom property set on a descendant cannot reach its ancestor's pseudo. Setting it on
> `.ui-middle-nav` looks correct and leaves the seam at a measured **15.68px**. The bare-canvas
> focus route additionally needs the **direct** `border-start-start-radius: 0` rule, because
> `shell-frame.css`'s `:not(:has(.ui-middle-nav))` override sets the corner directly rather than
> through the variable. `.ui-shell-topbar` needs its own reset too — the outer hairline L
> (`.ui-shell-topbar__border`) reads `--frame-radius` off the top bar itself, which is a **sibling**
> of `__content`, not a descendant.

**Mobile: `BottomNav` is withheld, and two paired rules must move with it.** On a phone the bottom
bar _is_ the side navigation, so leaving it would reinstate on mobile every exit the mode removes on
desktop. But withholding it does **not** by itself free the bottom edge: at `≤767px`
`middle-nav.css` lifts the footer band by `--shell-bottomnav-h` unconditionally (it otherwise shares
the bar's exact rect — measured `390 × 56` for both), and `page-canvas.css` reserves the same offset
on `.ui-page-canvas__body`. With nothing occupying those 56px the clearance becomes a **dead gap
under the step's commit action**, and the buyer's thumb lands on empty canvas. The focus overrides
drop both to `env(safe-area-inset-bottom, 0px)`. **They are a pair** — move one without the other
and the pinned band and the scrolling body disagree about where the viewport bottom is.

The focus rules are **not** scoped inside a `@media (min-width: 768px)`: they must hold at every
width so the seam accumulator is right on a tablet mid-range, and they are idempotent with the
mobile rules (which already collapse to one column and already flatten the radius).

**Resolution is a per-URL slot resolver, exactly like the lane and the bands.**
`checkoutChromeFor(url)` (`apps/web/features/checkout/core/checkout-chrome.ts`) is the fourth member
of the `laneFor` / `middleNavHeaderFor` / `middleNavFooterFor` family, composed in the `(dashboard)`
layout and returning `null` for a URL it does not own so the `??` chain still works. It is pure and
synchronous and takes **no `UserContext`** — chrome is a property of the route, not of the actor. It
must never be an island: a client-resolved chrome cannot paint on the first SSR byte and would flash
the full shell on every step change.

> ⚠ **The CSS-carrier trap this mode creates.** `apps/web/features/shell/styles/user-shell.css`
> historically reached the page **only** through the client bundles of `ShellSidebar` and
> `UserActions` — a sheet imported by a server component alone never ships (§C.1). Focus mode
> suppresses both islands, so the brand-only top bar rendered unstyled on every focus route. The
> import lives in `apps/web/client.ts` alongside the other global sheets; the island-level imports
> stay (the bundler dedupes, and removing them risks the reverse regression). Verify by reading the
> **CSSOM** on a focus route, never the source.

---

### D.7 The Conversion Lane — public entity view pages (merge gate)

`/view/[entity]` and `/[handle]/view/[item]` are the product's evaluation-and-purchase surface, and
they are the one place where the shell's two navigation columns and a page's own commerce chrome all
want the same pixels. This section resolves that collision by **assigning the transaction to the
lane** and forbidding the third column outright.

**D.7.1 There is no right-hand sticky purchase card. Ever.** The reflex on a marketplace listing is a
sticky right rail carrying price and CTA. On this shell that produces a **four-track layout** —
global rail, middle-nav lane, main stage, purchase rail — inside a content region that has already
spent ~344px on chrome. Measured consequences: the main stage falls below the width its 16:10 media
needs and the gallery starts down-scaling; the sticky rail and the lane both claim `position: sticky`
under the same top offset and their seams double up; and below ~1280px one of the two has to be
dropped, which means the primary CTA's presence depends on the viewport rather than on the offer. A
commerce surface whose Buy button is a function of window width is not a commerce surface.

**D.7.2 The middle-nav lane IS the conversion engine.** On a view route the lane stops being
navigation and becomes the transaction. It mounts identically in both shells —
`.ui-middle-nav__lane` for authenticated viewers, the floating glass `.ui-guest-aside` for guests
(§D.5) — because it is one component on the shared `pf-lane` skeleton, so a guest and a signed-in
buyer see the same offer in the same place. Its anatomy is fixed, top to bottom:

1. **Identity band.** The creator's `@handle` as a link to `/[handle]` (canonical, §8 Decision #3),
   the verification crest as an `Icon` (never a pill — §B.11.4), and an overflow kebab. **Secondary
   actions live in the kebab, not on the lane**: _Share listing · Save to custom list · Request
   custom scope · Report listing_. Each is one decision the buyer is not currently making, and every
   one promoted to a visible button competes with the one they are.
2. **Price.** The converted local figure in **`--text-2xl` (1.75rem), `--fw-medium`, `tabular-nums`**
   through `MoneyView` (§C.1) — so a currency switch re-projects it and the origin is disclosed
   rather than hidden. The creator's original currency sits directly beneath in **`--text-sm`
   (0.8125rem), `--text-secondary`** (`Orig. £76.99 GBP`). Two registers, one figure; never two
   equally-weighted numbers, which reads as two prices. A discount delta, where one applies, is a
   third line in Meta register carrying both the struck original and the saving — never a chip.
3. **Primary CTA — one, full-width, INVERTED pill.** Its label is the archetype's actual verb:
   **Buy now** · **Book session** · **Reserve seat** · **Fund Stage 1** · **Apply to project**. The
   treatment is §D.7.7's monochrome fill, not `--primary`.
4. **Secondary CTA — one, full-width, BRAND pill.** _Add to basket_. Solid `--primary`, same height
   and radius as the primary, ranked below it by hue rather than by emphasis (§D.7.7).
5. **Tertiary — one ghost action, and only ever this one.** _Message seller_, with its glyph. This is
   the single sanctioned exception to item 1's "secondary actions live in the kebab", and the reason
   is specific rather than general: every other kebab action is something the buyer does INSTEAD of
   buying, while asking the seller a question is something they do **on the way to** buying. Burying
   it costs the sale the rest of the lane is trying to make. It is a text-weight control, so it adds
   no third fill and the ranking still reads primary → secondary → tertiary at a glance. A **second**
   ghost action is a finding.
6. **Summary ledger.** The archetype's live state and the operational facts, as inline Meta text
   (§B.11.2) on hairline-separated rows — delivery timeframe, revisions included, stage or seat
   state, and the escrow notice (_Funds held in escrow_) where the archetype escrows. Not chips.

**D.7.3 The main stage is for evaluation and is fluid.** Everything that helps a reader _decide_
lives in `.ui-page-canvas__body` and takes the full content width: the 16:10 media canvas, the stage
ledger or scope checklist, the specification table, the creator section, related work, reviews. It
carries **no price and no purchase control** on desktop — the offer has exactly one home, so the two
can never disagree about what is being sold or what it costs.

**D.7.4 Below `--bp-md` the duty transfers; it does not duplicate.** `middle-nav.css` and
`guest-shell.css` both drop the lane at `≤767px`, and the entire transaction lives in it — measured
at 390×844 before the fix, a product page rendered its price, _Buy now_, _Add to basket_ and
_Message_ all at `0×0`. A single body-side transactional block is revealed by media query **exactly
where the lane is not**, so the two are mutually exclusive by `display` and only ever one is in the
accessibility tree. Both derive their offer from the same resolver, so they cannot drift. This is the
same pattern as `.pf-header__actions` on the profile page and the `/wallet` header switcher (§8
Decision #63): **a duty removed from one region is re-homed in another, never rendered twice.**

**D.7.5 Resolution is a per-URL slot resolver, and it dispatches on the item's type.**
`viewLaneFor(url, authed)` is a member of the `laneFor` / `middleNavHeaderFor` / `middleNavFooterFor`
/ `checkoutChromeFor` family: pure, synchronous, evaluated by the `(public)` and `[handle]` layouts,
returning `null` for a URL it does not own. It must never be an island — a client-resolved lane
cannot paint on the first SSR byte and would flash an empty rail on every navigation. It dispatches
by the **resolved item type**, not by a query string: a project gets the stage-jump lane, an article
the table of contents (an article has no transaction), everything else the transactional action lane.
`?type=` in the URL is presentational SEO only and never decides what renders.

**D.7.6 The scroll-migrated sticky header.** Once the body hero passes under the sticky chrome, the
middle-nav header band reveals a condensed identity: the title (capped at **24ch** with native
truncation), the seller line (avatar · `@handle` · verification crest · compact rating), the
archetype label as unboxed text, and **one contact control**.

Four things about it are rules rather than choices:

- **It carries no purchase control.** `.guest-shell__subheader` is `display: none` at ≤767px while
  `.ui-middle-nav__header` still renders there, so a CTA in this band would exist for a signed-in
  phone user and not for a guest one — and would sit alongside the body transactional block, which
  owns the offer below `--bp-md`. Two primaries on one phone screen is the §D.7.4 duty-transfer
  conflict. Contacting the seller is not a purchase, so the one control here is safe.
- **The reveal is `min-block-size` + `max-block-size`, never `block-size`.** The band sits in the
  frame's grid context, which overrides an explicit height; only the min/max logical constraints are
  honoured. Recorded in `profile.css`, verified twice.
- **The band root must carry `.pf-stickyhead`.** That is load-bearing, not cosmetic reuse: the guest
  shell keys its glass underlay, hairline and elevation off the literal selector
  `.guest-shell__subheader:has(.pf-stickyhead[data-condensed="true"])`. A band that drops the class
  renders unstyled for guests **while looking correct when signed in**, which is the worst shape a
  regression can take.
- **The probe measures once on mount, before any event.** A deep link into the middle of a page, a
  restored scroll position, or a throttling environment must still resolve the correct initial state.

> **On IntersectionObserver.** The obvious implementation is an observer on the hero, and the brief
> that requested this feature named it first. It was built that way and then replaced. In this repo's
> preview harness **neither observer callbacks nor `scroll` events fire** — both are compositor-driven
> and it does not composite — while `scrollY` moves normally, so neither mechanism can be verified
> there. Given two unverifiable options, the shipped one wins: a passive `scroll` listener is what the
> profile and project views already run in production. The observer is the better mechanism and should
> replace this the moment there is somewhere to prove it works; it is not currently a correctness
> question but a verifiability one.

**D.7.7 The action rig is monochrome-first.**

The primary CTA is **inverted**: the page's ink colour as its fill. Expressed as
`--btn-accent: var(--on-surface); --btn-on: var(--surface)` — the inverted-surface idiom the system
already has in `Tooltip` — the pair swaps sides with the theme by construction, so one declaration is
correct in both directions: near-white on near-black in light, near-black on near-white in dark.

**Measured, because the alternative was not viable.** The inverted pill is **17.14:1** light /
**14.93:1** dark, and it *improves* under `data-contrast="high"` (~20:1 both), so it needs no
accessibility carve-out and is unaffected by the colour-blindness overlays, being achromatic.

The secondary carries the brand teal, and **its ink is `--surface` too** — which is the whole trick.
Solid `--primary` with white text measures **5.38:1 in light** (correct, and literally white) but
**3.75:1 in dark**, and the token pair `--on-primary` measures **3.57:1** there. Both then *collapse*
under `data-contrast="high"` in dark — **2.52:1** and **1.75:1** — so the overlay meant to rescue
them makes them unreadable. `--surface` resolves to `#ffffff` in light and `#0b0f0f` in dark, so it
**is** the white text where white works and flips where it does not: 5.38:1 / 5.15:1.

> **Root cause, for whoever fixes it at the layer it belongs to.** `theme-engine.ts` sets dark
> `--primary: a1.tone(fg(55))` and `--on-primary: a1.tone(on(98))` — both above mid-tone 50, which
> violates the file's own stated invariant that a colour and its `on-` pair must straddle it. Every
> other dark `on-` pair correctly uses `on(20)`, and the comment directly above the offending line
> describes code that is not there. This is the defect flagged since §8 Decision #64 and routed around
> seven times; it is a one-line change that repaints every filled primary control in the product, so
> it needs a human, not a silent edit.

Geometry: both pills are `--radius-full`, `--fw-medium`, and **36px** tall. That height is
deliberately OFF the `--fld-h-*` ramp, which steps 32 → 40 → 48 — a compact commit control is neither
of its neighbours. It stays on the ramp's own 4px grid, and if the pattern spreads the ramp should
gain the step rather than each surface re-declaring it.

> **§B.8.2 note.** The lane renders two solid fills, which the one-`filled`-per-decision-region cap
> reads as a violation. It is a sanctioned exception, scoped to this rig: the two are ranked by HUE
> (monochrome commit vs brand basket) rather than by emphasis, so the hierarchy a reader perceives is
> intact — which is what the cap protects. It is recorded here so the next author does not generalise
> it to a surface where both fills would be the same colour.

**D.7.8 The canvas is content-first.**

Structured information leads and media trails: title, metadata, summary, seller, then the stage
ledger / scope checklist / specification tables on the **inline-start** side, with the media showcase
on the **inline-end**. A listing is evaluated by reading, and a gallery-first canvas makes the reader
scroll past pictures to reach the terms.

**The columns are reversed in the DOM, never with `order` or `direction`.** Those move the boxes and
leave the reading and tab order behind, so a keyboard or screen-reader user would traverse a strip of
thumbnails before reaching the title of the thing they are being asked to buy. Reversing the source is
the only version that moves both, and it is the version that survives the mobile stack for free.
> **Merge gate.** A view-page PR is not mergeable if it introduces a third sticky column, renders a
> price or a purchase control in the main stage on desktop, adds a THIRD fill or a SECOND ghost to
> the lane rig (§D.7.7), promotes any action other than seller contact out of the kebab, duplicates
> the transactional block across two simultaneously-visible regions, puts a purchase control in the
> sticky header band (§D.7.6), flips the canvas columns with `order`/`direction` rather than in the
> DOM (§D.7.8), or resolves the lane from an island rather than a URL resolver.
### D.8 Entity-view archetypes — the render contract

One page, five bodies. The archetype is resolved server-side from the listing's own delivery model,
and each dictates what the main stage renders and what the lane's summary ledger says. All five
inherit §B.4, §B.9.7 and §B.11 without exception — **none of these is built from cards.**

**D.8.0 The media showcase is common to all five.** A 16:10 primary canvas
(`--card-media-ratio`) with the active thumbnail strip **directly beneath it**, never floating over
it. The strip reserves its own height at SSR so a late-decoding image cannot shift the canvas, and an
audio or video artefact embeds `AudioVisualizer` or a native player **inside the same 16:10 box** —
the box is the layout contract, the artefact is what fills it, so switching media type causes no
reflow.

**D.8.1 Pipelines and multi-stage services.** The stage ledger is a **continuous vertical timeline
track**: one hairline running the full height of the run, with each stage's step number in a small
circular **outline** on it (a `--primary` ring with the numeral on the surface pair — never
`--on-primary` on `--primary`, which measures 3.57:1 in dark, §8 Decisions #64/#65). A stage's title
is Section-header register, its brief is Body, its turnaround and stage budget are inline Meta.
Expanding a stage reveals its deliverable checklist (§B.9.8) **inline, without interrupting the
track** — the line runs behind the expansion, because a track that breaks at every open stage stops
reading as a sequence, which is the only thing it was drawn to communicate. It is not an `Accordion`:
that component brings a bordered panel per tab, which is the boxed accordion this rule exists to
prevent. Lane ledger: `Stage 2 of 5 · Discovery`, plus per-stage quick-jumps.

**D.8.2 One-off deliverables.** No timeline — a single unboxed **scope checklist** (`Icon` `check` +
Body text, one row per item) under a Section header, followed by a key–value specification ledger
(turnaround, revisions, source files, commercial licence) as a two-column definition list separated
by single hairlines, never as a bordered table. Lane ledger: the delivery window and revisions.

**D.8.3 Session-based services (1-on-1).** The booking calendar is a **full-bleed stage spanning the
whole content width**, not a hero column — and that is a functional requirement, not a preference.
The calendar engine drops `.cal__side` (the mini-month **and** the availability panel) below ~768px
of its own ELEMENT width, and a hero column inside a content region that has already spent ~344px on
chrome crosses that line on an ordinary laptop. Squeezed into a column, the booking surface silently
loses the only control that explains what the provider's working hours are. The hero collapses to a
single column for these archetypes and the stage takes the full width beneath it.

**The stage carries a segmented Availability ⇄ Showcase switcher, and there is exactly ONE copy of
it, working in BOTH directions.** This is stated because the first implementation had two and neither
worked: the in-stage tablist was `display: none` above 767px and the lane's replacement only ever
turned availability ON, so a desktop reader who opened the calendar could not get back to the gallery
without reloading the page. A view-mode switch is a data selection, so the canvas is allowed to own
it (§D.7.3) — but the lane must not carry a second, one-way copy.

**The timezone disclosure states the zone the grid is actually drawn in.** The engine renders one
wall clock from one zone string, and the app feeds it the schedule's own `timezone` — the
**provider's**. Copy claiming "times are shown in your local timezone" is therefore false, and was
shipped that way once. Name the zone being rendered, and name the reader's too when the two differ. A
time that is right for one party and unlabelled for the other is the single most expensive error this
surface can make; a time that is labelled with a zone the surface is not using is worse.

The stage carries **no price and no Book CTA** — it is evaluation material, and the offer has one home
(§D.7.3). Lane ledger: next available slot and session length; primary CTA **Book session**.

**D.8.4 Group sessions (cohorts).** Capacity is a **segmented track meter** on `--track-meter`
(§A.3) — filled segments for taken seats, recessed for remaining, `--space-px` seams — with the fact
stated in words beside it (`4 of 10 seats remaining`). The meter is decorative and `aria-hidden`; the
sentence is the accessible fact, because a bar cannot be read aloud and a nearly-full cohort is
precisely when the number matters. Geometry is set directly and never animated — a frozen animation
clock in a background tab must not be able to draw an empty cohort as full (§8 Decision #60). Beneath
it runs the **chronological curriculum**, on the same timeline track as D.8.1 with dates instead of
stage numbers. Lane ledger: remaining seats, cohort start, cadence; primary CTA **Reserve seat**.

**D.8.5 Digital products** (templates · 3D assets · audio stems · video presets · code kits). The
16:10 canvas carries the **live** artefact, not a screenshot of it: `AudioVisualizer` for stems, a
native player for video, an interactive viewport for 3D, a syntax-highlighted excerpt for a code kit.
Beneath it, a key–value **file specification ledger** — formats (`.blend`, `.wav`, `.psd`),
uncompressed payload size, dimensions or sample rate, the compatibility matrix (host application and
version), and the licence permissions in full — as hairline-separated rows in Meta register. Licence
is never abbreviated into a chip: it is the term of the sale, and a reader who cannot see whether
commercial use is included has not been told the price of anything.

> **Merge gate.** An archetype PR is not mergeable if it boxes the stage ledger, scope list or spec
> table; breaks the timeline track at an expansion or builds it from `Accordion`; renders session
> times without naming the zone the grid is drawn in, or claims a zone the engine is not using;
> confines the booking calendar to a hero column, or ships a second/one-way availability switcher;
> encodes seat capacity in an animated property or omits the spoken count; or reduces licence terms
> to a chip.
## Part E — Contracts & merge gates (summary)

A PR touching `@projective/ui` must satisfy (enforced via root `CLAUDE.md`):

1. Token-only styling — no literal colors/radii/durations/shadows.
2. BEM class naming; no framework CSS; no CSS-in-JS.
3. Separation-hierarchy rule (§B.4) — full borders on interactive elements only.
4. Reduced-motion + the four a11y overlays (§A.5) honored; comprehensive ARIA.
5. Responsive at Desktop/Tablet/Mobile without app-side overrides.
6. New/changed component ⇒ its entry in the §C.1 roster + this spec updated **in the same change.**
7. **The six component laws** — §A.7 field state contract, §B.7 iconography, §B.8 buttons, §B.9
   cards, §B.10 overlays, §B.11 anti-tagification. Each carries its own gate paragraph; they are
   listed here so a reviewer has one place to check rather than six.
8. **The three composition laws** — §A.4's four typographic registers (hierarchy over raw weight),
   §B.4.1–B.4.3 (asymmetric spacing, solid tonal steps, functional transparency only), and §D.7/§D.8
   (the conversion lane and the entity-view archetypes). These govern how a *page* is assembled
   rather than how a *component* is built, which is why they are listed apart: a PR can satisfy every
   component law and still ship a boxed, tagified, three-column view page.

---

## Part F — Deferred / conflicted (awaiting a ruling)

Recommendations surfaced by the Button, Card, Iconography, Form-primitive and Overlay audits that
were **not** encoded above, because each conflicts with a standing house rule. Per the root
`CLAUDE.md` §8 rule, they are logged rather than silently resolved. Both positions are stated; none
is currently in force.

**F.1 — Focus ring: `box-shadow` composite vs. native `outline`.** _Audit position:_ the focus
indicator should be an `outline` with `outline-offset`. `outline` is never clipped by an ancestor's
`overflow`, and — decisively — **Windows High Contrast / forced-colors mode discards `box-shadow`
entirely**, so today's ring vanishes for exactly the users most dependent on it. _House position
(§A.7.1, in force):_ `--focus-ring-shadow` is a two-tone halo+ink composite because **no single
colour clears 3:1 against both the control fill and the page** — the previous single-colour ring
measured 1.00:1 on `--primary` in dark. An `outline` is one colour. _Possible resolution not yet
taken:_ ship both — the composite as the default, plus a `@media (forced-colors: active)` block that
swaps to `outline: 2px solid Highlight`. Needs a ruling because it makes every control carry two
focus implementations.

**F.2 — Seven severities is more than this product means.** _Audit position:_ `help` (mapped to
`--tertiary`) carries no meaning anywhere in Projective, and `info` vs `secondary` were literal
visual duplicates until 2026-07-30 — evidence that the set is wider than the vocabulary. A smaller
set is harder to misuse, and §B.8.3's whole problem is misuse. _House position:_ the roster is
committed to **PrimeNG feature-parity** (§C.1 roster-rename note); a severity is part of that
surface, and removing one is a breaking change to a copy-paste-portable package. _Ruling needed:_
keep all seven for parity and forbid `help` by policy, or drop it from the `Severity` union.

**F.3 — The `filled`-per-view cap vs. genuinely two-primary surfaces.** _Audit position (encoded as
§B.8.2):_ one `filled` per decision region. _Unresolved case:_ the wallet footer rig legitimately
offers **Top up** and **Withdraw** as co-equal primaries — neither is subordinate, and demoting one
to `outlined` would misrepresent the surface. §B.8.2's "mutually exclusive by render condition"
escape does not cover them. _Options:_ (a) accept the cap and pick a winner per rig; (b) formalise a
"co-primary pair" exception limited to a footer action rig; (c) treat each as its own decision
region. Currently the cap is written as absolute, so the wallet rig is technically in violation.

**F.4 — §B.6 icon-first density vs. §B.7.7's ban on icon inflation.** _These two sections point
opposite ways and the boundary is undrawn._ §B.6 mandates a glyph on every lane row and every dense
list item; §B.7.7 bans "a decorative icon beside every label" and "icons that duplicate their
label." A lane row reading `[folder glyph] Files` satisfies the first and arguably violates the
second. _Ruling needed:_ state where the density mandate stops — e.g. "a glyph is required where it
is the row's **only** distinguishing mark at a glance, and banned where the label alone is already
unique within its list."

**F.5 — Card nesting vs. the shipped split-pane modals.** _Audit position (encoded as §B.9.2):_ no
card inside a card, and no card inside an elevated panel. _Conflict:_ four app modals (attachment
preview, ticket, project-create, submission review) are `Splitter`-based two-pane workspaces where
the panes are, structurally, containers inside an elevated panel. §B.9.2 as written condemns the
pattern; what it _means_ to condemn is a nested **surface + shadow**, not a nested **region**.
_Ruling needed:_ an explicit carve-out for a layout region that carries tint and spacing but no
shadow and no border, so the rule is enforceable without flagging four legitimate modals.

**F.6 — Toast auto-dismiss vs. WCAG 2.2.1.** _Audit position:_ a Toast carrying an action
auto-dismisses at 3000ms with **no keyboard path to reach it** — a keyboard or screen-reader user
cannot act on it at all, which is a Timing Adjustable failure, not a polish item. _House position:_
toasts are transient by design and a persistent toast becomes an `Alert`. _Options:_ (a) actionable
toasts never auto-dismiss; (b) any focus or hover within the region pauses every timer; (c) actions
are banned from `Toast` outright and promoted to `Alert`. Not encoded because all three change
shipped behaviour.

**F.7 — `--scrim-blur` vs. the glass identity.** _Audit position:_ the scrim's `backdrop-filter`
stacks on top of the shell chrome's own `--glass-blur`, and two composited blur layers over a full
viewport is the most expensive thing the app draws — on low-end hardware it is the modal-open jank.
Drop blur from the scrim; the corrected `--scrim` tint (F/B.10.2) now provides the separation the
blur was compensating for. _House position:_ glass is a stated part of the visual identity (§D.1,
§D.5), and the scrim is where it reads most. _Ruling needed:_ keep, drop, or gate behind a measured
device signal.

**F.8 — The type ramp has zero adoption in the overlay family.** Not a conflict so much as an
unbudgeted migration: `grep var(--text-*)|var(--fw-*)|var(--leading-*)` across all fourteen overlay
sheets returns **nothing**, and the off-ramp literals (`1.0625rem`, `1.05rem`, `0.74rem`, `0.72rem`)
are what produce five header-density systems and bar heights running 40→64px within one class.
Encoding it as a gate would make the next overlay PR responsible for a family-wide refactor. _Ruling
needed:_ ship it as a gate now, or as a tracked migration with a deadline.

---

_Related: [`PRODUCT_SPEC.md`](../business/PRODUCT_SPEC.md) §Visual Identity ·
[`SYSTEM_ARCHITECTURE.md`](../architecture/SYSTEM_ARCHITECTURE.md) §UI ·
[`PRODUCT_MANAGEMENT.md`](../PRODUCT_MANAGEMENT.md) ·
[`packages/ui/CLAUDE.md`](../../packages/ui/CLAUDE.md)_
