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

> **Scoped exception — the `/wallet` hero (Decisions #122 / #123).** At the product owner's direction
> the wallet's balance hero is a luminous gradient — since the owner's 2026-09-29 "gradient" commit a
> cyan · cobalt · violet aurora whose five hues are LITERAL hexes declared once in the wallet's own
> token sheet (`--wlt-aurora-*`, `wallet-tokens.css`) and identical in both themes. Since Decision #123
> it runs up behind the glass top bar, so the chrome reads as glass over the wallet's light; since
> Decision #124 the wallet registers no header band and the hero heads every `/wallet*` page (a compact
> variant off the overview). It is the only gradient hero in the product and it licenses no other surface; the
> literal palette is the owner's own and is flagged there rather than re-derived here.

[toc]

---

## Part A — Foundations (Tokens)

### A.1 The Core Palette

The brand anchor is **Brand Teal `#288690`** (from `PRODUCT_SPEC.md` §Visual Identity). Teal seeds
the tonal system (Part 2); amber `#D98216` seeds the one accent role (§A.1.2). All base semantic
targets below are the product spec's values, expressed here as the token contract components
consume.

#### Brand & semantic seeds

| Token                   | Light       | Dark                                            | Role                                                   |
| :---------------------- | :---------- | :---------------------------------------------- | :----------------------------------------------------- |
| `--brand` / `--primary` | `#288690`   | `#288690` (tonal-lifted for contrast, see §A.2) | Brand primary — tier 3 (§B.8.1)                        |
| `--success`             | `#268C66`   | tonal                                           | "Complete" / approved                                  |
| `--warning`             | `#D98216`   | tonal                                           | "In Progress" / time-sensitive                         |
| `--danger`              | `#D94141`   | tonal                                           | "Incomplete" / error / no-show                         |
| `--info`                | `#3D7BD9`   | tonal                                           | Neutral-informational state (Ready / To do / advisory) |
| `--accent`              | `#d88115`   | `#e58b22` (tonal lift, fixed polarity — §A.1.2) | Terminal financial / conversion commit (§B.8.1)        |
| `--on-accent`           | `#191c1d`   | `#0b0f0f` (`N.tone(4)`, dark `--surface`)       | Ink on `--accent` — dark in every mode (§A.1.2)        |
| `--bg`                  | `#FAFAFA`   | `#1A1A1A`                                       | Primary canvas                                         |
| `--surface`             | `#FFFFFF`   | `#212121`                                       | Elevated cards/headers/sidebar                         |
| `--text-main`           | `#1A1A1A`   | `#FFFFFF`                                       | Body & headings                                        |
| `--text-secondary`      | `#666666`   | `#B3B3B3`                                       | Labels, muted info                                     |
| `--text-disabled`       | `#B3B3B3`   | tonal                                           | Non-interactive                                        |
| `--border-subtle`       | `#E6E6E6`   | tonal                                           | Razor-thin indicators only (§B.4)                      |
| `--focus-ring`          | `#4a6366`   | `#b1cbcf`                                       | Focus ring — generated, tracks `--secondary` (§A.7.3)  |

> **Two names in this table are not what the code reads (Decision #157 flags (c), (d)).** The
> engine's `--warning` seed is `#F19C13` (light tone 60 = `#ca8100`), not the `#D98216` above — a
> pre-existing drift, left as written pending a ruling; `#D98216` is now the accent's seed (§A.1.2).
> And `--text-main` is a spec name, not a token: ink is `--on-surface` everywhere in code. The
> `--accent` / `--on-accent` cells are the engine's resolved tokens (`A.tone(62)` / `A.tone(66)`,
> `N.tone(10)` / `N.tone(4)`), not the directive's approximations (`#D98216` / `#E58A18` /
> `#1A1A1A`); the `--bg` / `--surface` dark cells are spec targets — the engine resolves dark
> `--surface` to `#0b0f0f`.

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

**Goal:** from a **brand seed** (default `#288690`, or a user's chosen brand colour) and one
**accent seed** (default `#D98216`, the amber conversion role of §A.1.2) generate a full,
accessible, contextual set of tonal palettes, and write them into the same `--*` CSS custom
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
   upgrade path when a scheme flavor becomes user-selectable.) A **second** `CorePalette` is built
   from `ACCENT_SEED`; only its `a1` is read (`A`), and only for `--accent`. Its ink is not taken
   from `A` at all but from the brand seed's `n1` (`N`), the palette `--surface` / `--on-surface`
   already resolve from.
3. **Tone selection = the light/dark switch — except for the brand pair, which does not switch.**
   A **tone** is picked per role per mode. Because tone correlates with contrast, the pairs are
   engineered, not eyeballed:
   - Light: `secondary = P2.tone(40)`, `on-secondary = P2.tone(98)`, `surface = N.tone(100)`,
     `on-surface = N.tone(10)`, `outline = NV.tone(50)`.
   - Dark: `secondary = P2.tone(80)`, `on-secondary = P2.tone(20)`, `surface = N.tone(4)`,
     `on-surface = N.tone(90)`, `outline = NV.tone(60)`.
   - **Both, identically:** `primary = P.tone(45)`, `on-primary = P.tone(98)` — see §A.1.1.
   - **Fixed polarity, re-toned per mode:** light `accent = A.tone(62)`, `on-accent = N.tone(10)`;
     dark `accent = A.tone(66)`, `on-accent = N.tone(4)` — see §A.1.2.

   **The invariant is straddling mid-tone, not the size of the gap.** A mode-adaptive pair must sit
   on opposite sides of tone 50 with a gap of ~60 tones. This is stated precisely because the looser
   reading — "any wide delta guarantees ≥4.5:1" — is false and the engine once shipped against it:
   dark `primary = P.tone(60)` with `on-primary = P.tone(98)` is a 38-tone gap that is still
   light-on-light, and computes to **3.02:1**, below AA, on every filled button, badge and chip in
   dark mode. A straddled pair such as dark `secondary` computes to **7.72:1** (AAA). Any change to a
   tone selection is verified by reproducing `buildScheme()` against the real seed and printing WCAG
   ratios for every `on-`/base pair in all four modes — never by eye.

**A.1.1 The brand pair is mode-invariant (product owner, 2026-09-07).** `--primary` and
`--on-primary` are the core brand identity and are **the same colour in every state the product can
be in** — light, dark, and both high-contrast variants: `#007680` on `#ebfdff`, always. They resolve
from two module constants (`theme-engine.ts` `BRAND_TONE` / `BRAND_ON_TONE`) that deliberately
bypass the `fg()` / `on()` helpers every other role uses.

That bypass is not stylistic. `fgTone` widens a fill UP in dark and DOWN in light while `onTone` does
the opposite, so writing `fg(45)` / `on(98)` in both branches — one expression, apparently
symmetric — resolves to tone 45 on tone 98 **only while high contrast is off**. Switch
`data-contrast="high"` on and the dark branch lands on tone 57 over tone 86: `#0097a4` on `#63e9f9`,
measured **2.44:1**, under even the 3:1 non-text floor, while light widens correctly to 8.42:1. The
brand would differ between themes in the one state a struggling reader opts into. Raw tones remove
the mode input entirely, so there is nothing left for the value to vary with.

**What this costs, stated rather than hidden.** `--primary` is the one role that does not widen under
the high-contrast overlay: it holds **5.13:1** in all four states — AA for normal text, above the 3:1
non-text floor, but not the ~7–8:1 a mode-adaptive pair reaches. It is also one of two roles whose
_polarity_ does not flip with the theme (dark fill, light ink, in both modes — the other is
`--accent`, §A.1.2), which is why
`button.css` cannot blend every severity in one direction (§B.12.4), and why its fill sits at
**3.05:1** against `--surface-3` in dark — enough to see, with 0.05 of a ratio point to spare and
therefore nothing to spend. Every one of these figures is pinned by test in
`packages/ui/system/core/theme-engine.test.ts`, including the byte-for-byte equality of the pair
across all four states.

> **Engine drift (Decision #157 flag (m)).** The code does not currently match this section's dark
> branch: `theme-engine.ts` emits dark `--primary` as `core.a1.tone(55)` (`#00929e`), not
> `tone(45)` (`#007680`), while its own comments, the light branch and the text above say 45. The
> "byte-for-byte" claim is therefore the contract, not the shipped value; it is logged, not changed
> here, and nothing that cites the brand pair as a fixed-polarity precedent (§A.1.2) should be
> pinned against it until the drift is ruled.

**A.1.2 The accent pair is fixed-polarity amber (product owner, 2026-10-09, Decision #157).**
`--accent` / `--on-accent` is the one role that means _money moves now_ — the terminal financial and
conversion commit (§B.8.1 tier 1). It is global, not a surface's private pair: ONE seed,
`ACCENT_SEED = #D98216`, through its own `CorePalette` (`A` = its `a1`), with the ink taken from the
brand seed's neutral `N` — so the light label is literally `--on-surface` (in both contrast states)
and, at normal contrast only, the dark label is literally the dark `--surface`; under
`data-contrast="high"` the dark label moves to `N.tone(0)` (`#000000`) while `--surface` holds at
`N.tone(4)`, because surfaces are never widened.

| State                | `--accent`                                   | `--on-accent`                                     | Ratio       |
| :------------------- | :------------------------------------------- | :------------------------------------------------ | :---------- |
| Light                | `A.tone(62)` = `#d88115` (≈ the seed itself) | `N.tone(10)` = `#191c1d` (= light `--on-surface`) | **5.77:1**  |
| Dark                 | `A.tone(66)` = `#e58b22` (tonal lift)        | `N.tone(4)` (= dark `--surface`)                  | **7.39:1**  |
| Light, high contrast | `A.tone(62)` — holds                         | `N.tone(0)`                                       | **7.07:1**  |
| Dark, high contrast  | `A.tone(78)` = `#ffb061`                     | `N.tone(0)`                                       | **11.63:1** |

**Polarity is fixed — light fill, dark ink, in every mode** — like `--primary`, unlike every
mode-adaptive role. That is why it bypasses `fg()` / `on()` exactly as the brand pair does (§A.1.1):
those helpers choose a widening direction from the mode on the assumption that fill and ink swap
sides with the theme. Written `fg(62)` / `on(10)`, the light branch widens the fill DOWN and the ink
UP — 62 → 50 over 10 → 22 (`#af6500` on `#323536`, **2.76:1**, down from 5.77:1 and under both
the 4.5:1 and 3:1 floors) — so the pair converges under `data-contrast="high"`, the brand-pair trap
verbatim. The accent's own rule is stated per side instead:

- **The ink always moves away from the fill:** `on-accent = max(0, t − HC_DELTA)` (12) in BOTH
  modes (light 10 → 0, dark 4 → 0).
- **The fill moves up by 12 in dark only** (66 → 78). In light it **holds at 62**: raising it costs
  visibility on a near-white page, and lowering it closes the gap with the ink. The pair never
  narrows.

**Pressure blends toward a light pole.** `--btn-shade` (`--on-surface`) is the right pole for a role
whose polarity follows the theme; for a fixed-polarity light fill it is the INK in light mode, and
blending toward it walks both sides of the pair together. The accent's hover and press therefore
blend toward a mode-invariant near-white (`N.tone(100)`, the value `--on-scrim` already resolves
to), so the label's contrast rises with pressure in both modes (§B.12.4) — the mechanism that
Decision #153 built for the checkout commit, now owned by the token layer.

**What this costs, stated rather than hidden.** The light fill sits under the 3:1 non-text floor
this house applies to fills (§B.12.4) on **every** light ground, and pressure lowers it further:

| Light ground                     | Resting | Hover (8% to the pole) | Press (12% to the pole) |
| :------------------------------- | :------ | :--------------------- | :---------------------- |
| `--surface` (`N.tone(100)`)      | 2.97:1  | 2.71:1                 | 2.59:1                  |
| `--bg` (`N.tone(98)`)            | 2.84:1  | —                      | —                       |
| `--surface-1` (`N.tone(96)`)     | 2.69:1  | —                      | —                       |
| `--surface-2` (`N.tone(94)`)     | 2.55:1  | —                      | —                       |
| `--surface-3` (`N.tone(92)`)     | 2.42:1  | 2.21:1                 | **2.11:1** (worst case) |

High contrast leaves every figure unchanged — the light fill holds at 62 and surfaces are never
widened. The label carries the control's identification, so WCAG 1.4.11 is not failed, and the
Decision #153 checkout amber had the same property; it is nonetheless a house-rule deviation —
covering every light ground and both pressure states, and waiving §B.12.4's "do not shave a floor"
rule for this role — logged as Decision #157 flag (b), not granted. The alternative the flag puts to
a human is the brand's treatment in light mode (a zero tonal step plus the border-channel hover,
§B.12.4), with the light pole kept for dark only.

And the fill is one hue with `--warning` in **both** modes: light `#d88115` against light warning
`#ca8100` measures **1.06:1**, dark `#e58b22` against dark warning `#ed990d` (`F19C13` `a1` tone 70)
**1.14:1**. "Commit" and "needs attention" are again one hue — the §B.8.3 failure that #153 fixed —
flag (a), awaiting a ruling on which ramp moves. Every ratio in the four-state table is pinned in
`packages/ui/system/core/theme-engine.test.ts`.
4. **Emit CSS variables.** The engine serializes selected tones to `--primary`, `--on-primary`,
   `--surface-1…5`, `--outline`, etc., and sets them on `:root` (and on any nested
   `<DesignSystemProvider>` scope, §D.3).

```ts
// packages/ui/system/theme-engine.ts  (engine only — never imported by a component)
import { argbFromHex, CorePalette, hexFromArgb } from "@material/material-color-utilities";

/** Generate the token map for the brand + accent seeds and one mode, ready for CSS custom properties. */
export function buildScheme(
	{ seed, accentSeed = ACCENT_SEED, dark, highContrast = false }: ThemeInput,
): Record<string, string> {
	const core = CorePalette.of(argbFromHex(seed)); // a1 P · a2 · a3 · n1 N · n2 NV
	const accent = CorePalette.of(argbFromHex(accentSeed)).a1; // A — read for --accent only (§A.1.2)
	const hx = (argb: number) => hexFromArgb(argb);
	return dark
		? {
			"--primary": hx(core.a1.tone(80)), // straddles mid against on-primary tone(20)
			"--on-primary": hx(core.a1.tone(20)),
			"--surface": hx(core.n1.tone(4)),
			"--surface-1": hx(core.n1.tone(10)),
			"--on-surface": hx(core.n1.tone(90)),
			"--outline": hx(core.n2.tone(60)),
			"--accent": hx(accent.tone(66)), // fixed polarity: HC widening is per side (§A.1.2)
			"--on-accent": hx(core.n1.tone(4)),
			// …secondary/tertiary + fixed-hue success/warning/danger/info from their own seeds.
		}
		: {
			"--primary": hx(core.a1.tone(45)),
			"--on-primary": hx(core.a1.tone(98)),
			"--surface": hx(core.n1.tone(100)),
			"--surface-1": hx(core.n1.tone(96)),
			"--on-surface": hx(core.n1.tone(10)),
			"--outline": hx(core.n2.tone(50)),
			"--accent": hx(accent.tone(62)),
			"--on-accent": hx(core.n1.tone(10)),
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

**Mode vs preference.** `dsConfig.mode` is what is PAINTED (`light` | `dark`); `themePreference` is
what the viewer CHOSE (`ThemePreference` = `light` | `dark` | `system`). `setThemePreference` /
`cycleThemePreference` (light → dark → system) store a fixed mode under the `"theme"` key exactly as
`setMode` does, while `system` REMOVES the key — the same absence the inline pre-paint script reads
as "follow the OS" — and `bindRootTheme` then repaints live on a `prefers-color-scheme` change for as
long as the preference stays `system`. A theme control shows the preference, never the painted mode,
or "system" is unrepresentable (Decision #149).

#### Framework-level user adjustments (not per-component hacks)

The engine exposes three **global** knobs, each a small set of root variables that cascade
everywhere. Adjusting them re-themes the whole app; **components never special-case them.**

| Knob                 | Mechanism                                                  | Root variables                                         |
| :------------------- | :--------------------------------------------------------- | :----------------------------------------------------- |
| **Colors**           | brand seed + accent seed + scheme flavor → §A.2 pipeline   | all `--primary/-accent/-surface/-outline/…`            |
| **Border radius**    | one global scale multiplier                                | `--radius-scale` × the `--radius-*` ramp (§A.3)        |
| **Shadow intensity** | one global opacity/spread multiplier                       | `--shadow-intensity` × the `--elevation-*` ramp (§A.3) |

The Colors knob has **two seeds**, both live-adjustable through the store mutators `setSeed` /
`setAccentSeed`: `dsConfig.seed` (brand) and `dsConfig.accentSeed` (accent) → `applyConfig` →
`:root` `style.setProperty`, the same path for both, so retuning the amber re-derives `--accent` /
`--on-accent` in all four mode/contrast states without a reload and without touching a component.
Neither seed is persisted by the design system: the SSR first paint (`_app.tsx`) builds from the
defaults, and an omitted `accentSeed` resolves to `ACCENT_SEED`.

**All three knobs have a development control.** The Dev Context Switcher's **Theme** group
(`apps/web/features/devtools/core/dev-theme.ts`, `components/DevThemeControls.tsx`) drives
`dsConfig.seed`, `dsConfig.accentSeed`, `radiusScale` and `shadowIntensity` live through
`updateConfig`; `applyConfig` writes the scheme and `--radius-scale` / `--shadow-intensity` on
`:root` via `style.setProperty`, readable in the element inspector. The seeds are native colour
inputs (the `@projective/ui` `ColorPicker` popover renders beneath the dev window's near-maximum
`z-index`); radius and shadow are the `@projective/ui` `Slider`, bounded by `DEV_THEME_RANGES`. The
group ignores the simulation master switch, keeps a session-only copy (`sessionStorage`
`pj.session.dev.themeOverrides`) only while a value differs from `DEFAULT_CONFIG`, and its Reset
restores `DEFAULT_CONFIG`. It is a recorded exception to the root `CLAUDE.md` §5 Dev Context
Switcher contract: it has `DevThemeKnobs` and `DEV_THEME_DEFAULTS` (derived from `DEFAULT_CONFIG`,
so Reset cannot drift from the shipping values) but no `DevOption` list and no `data-dev-*`
`reflect()`, because the theme engine reads `dsConfig` directly — there is no seam to mirror.

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
>
> **One scoped exception (product owner, 2026-09-10 — §8 Decision #96).** The public profile's hero
> name (`.pf-hero__name`, `/[handle]`) is set at `--text-3xl` / **`--fw-bold`**. It is the only
> element on that page above `--fw-medium`: the `@handle` line beside it is Meta register, every
> section title is the `--text-xs` uppercase register, and the surface carries no other display
> step, so the "next more important thing has no register left" cost does not arise — there is no
> next thing. It is recorded here so it is not generalised to a listing or an article title, where
> the rule stands.
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
		--dur-highlight: 0ms;
		--dur-stagger: 0ms;
		--dur-ambient: 0ms;
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

**The in-app channel (Decision #151).** Settings → Appearance sets the four overlays per person. The
server renders them onto `<html>` from the `pj.a11y` cookie before first paint — only overlays that
are ON become attributes, so `standard` leaves the OS media queries in charge — and
`hydrateConfigFromDom` reads them back into the `dsConfig` store, so hydration never repaints the
defaults. `:root[data-motion="reduced"]` now carries the same global duration collapse as the media
query above (`styles/index.css`), so the switch is honoured everywhere, not only by the components
that read the attribute themselves. **Known gap:** `data-cvd` still reaches only the workspace tokens
and the calendar / gantt canvases — the global status-hue swap this table promises is not built, and
the setting's description says exactly what it adjusts.

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
| **Figures**         | A money figure, a card number or any other digit run is **isolated left-to-right** (`direction: ltr; unicode-bidi: isolate`) so its sign, symbol, major and minor parts keep their order in both directions — only its position in the line mirrors. Without it a split figure's flex parts reverse and the bidi algorithm reorders the digits (`£3,414.25` renders `25.3,414£`). `MoneyView` and `PaymentCard` carry this; a hand-built figure must too. |

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
field on focus and does not zoom back out. It raises `.ui-field` as well as the input, so a Select-family
trigger or a picker value, which inherits the field's font, reads at the same 16px as a typed value
beside it (Decision #247 (x), ruled by the owner 2026-10-18).

**A.7.3 The canonical state matrix.** Every state declares the same **four channels — border ·
surface · ink · ring — plus a mark.** A control that cannot compose `.ui-field` (Checkbox, Slider,
Rating, Knob, ZoomSlider, ToggleSwitch…) keeps its own **shape** but reads the same channels, so a
state reaches all 27 rather than only the input family.

| State      | Border                        | Surface             | Ink                           | Ring                  | Mark (`.ui-field__mark`)         | `aria-`                           |
| :--------- | :---------------------------- | :------------------ | :---------------------------- | :-------------------- | :------------------------------- | :-------------------------------- |
| `default`  | `--fld-rest-bd`               | `--fld-rest-bg`     | `--fld-rest-fg`               | —                     | none                             | —                                 |
| `hover`    | `--fld-hover-bd`              | `--fld-rest-bg`     | `--fld-rest-fg`               | —                     | none                             | —                                 |
| `focus`    | `--fld-focus-bd`              | `--fld-rest-bg`     | `--fld-rest-fg`               | `--focus-ring-shadow` | none                             | —                                 |
| `invalid`  | `--fld-invalid-bd`            | `--fld-invalid-bg`  | `--fld-rest-fg`               | **cleared** by focus  | `--fld-invalid-mark` · AlertMark | `aria-invalid="true"`             |
| `required` | `--fld-required-bd`           | `--fld-required-bg` | `--fld-rest-fg`               | **cleared** by focus  | `--fld-invalid-mark` · AlertMark | `aria-invalid` **on submit only** |
| `gate`     | `--fld-gate-bd`               | `--fld-gate-bg`     | `--fld-rest-fg`               | **cleared** by focus  | `--fld-warning-mark` · GateMark  | **not** `aria-invalid`            |
| `success`  | `--fld-valid-bd`              | `--fld-rest-bg`     | `--fld-rest-fg`               | **cleared** by focus  | `--fld-valid-mark` · CheckMark   | —                                 |
| `warning`  | `--fld-warning-bd`            | `--fld-warning-bg`  | `--fld-rest-fg`               | **cleared** by focus  | `--fld-warning-mark` · AlertMark | —                                 |
| `loading`  | `--fld-rest-bd`               | `--fld-rest-bg`     | `--fld-loading-fg`            | —                     | BusyMark (`--fld-loading-alpha`) | `aria-busy="true"`                |
| `readonly` | `--fld-readonly-bd`           | `--fld-readonly-bg` | `--fld-rest-fg`               | `--focus-ring-shadow` | none                             | `readonly` (**still focusable**)  |
| `disabled` | faded by `--fld-disabled-mix` | **unchanged**       | faded by `--fld-disabled-mix` | none                  | none                             | `disabled`                        |

`required`/`gate` are the two-tier creation gate (see the §C.1 note): `required` is needed **now**
to create the base record and drives the danger ramp; `gate` is optional to draft but needed to
**publish**, drives the warning ramp, and is deliberately **not** `aria-invalid` — a
soft-informative state announced as an error is a lie to a screen reader.

Four consequences a reviewer can check without opening a browser:

- **One focus treatment, and it is `:focus-visible` — never `:focus`.** The two differ exactly on
  pointer input, and a ring that answers a mouse click is the thing this rule exists to prevent. For a
  COMPOSITE control whose focusable element is a descendant, the equivalent is `:has(:focus-visible)`;
  `:focus-within` has no modality-aware form and fires on a click, so it may carry an "active" tint or
  lift but never the ring.
- **The ring is `--secondary`, 1px, offset 2px, over a soft glow.** Two delivery mechanisms, one
  appearance: `--focus-ring-shadow` for a control with its own sheet (a gap layer, the ring, then the
  glow), and a zero-specificity `:where(…):focus-visible` base rule in `styles/index.css` drawing the
  same thing as a native `outline` for everything else. The base rule weighs nothing on purpose — any
  component rule replaces it rather than doubling it. `--focus-ring-shadow-inset` remains the only
  permitted variant, and only where an outset ring would be clipped by a segmented group's own
  overflow; it carries no glow, having no outside to glow into.
- **The 2px offset is a correctness requirement, not breathing room.** `--secondary` measures 1.00:1
  on a `--secondary` fill and 1.19:1 on `--primary`, so a ring drawn ON the border box is invisible on
  exactly the controls that matter. Pushed clear it abuts the PAGE, where it measures 5.23:1 at worst
  in light and 9.61:1 in dark. Never set the offset to 0 to tighten the ring. The `box-shadow` form
  buys the same separation with its neutral gap layer, which is also the tone that rescues the
  indicator on an accent fill — the pair straddles mid-tone, so whatever sits behind it, one of the
  two contrasts. Both are pinned in `theme-engine.test.ts`, in all four mode/contrast states.
- **Whole pixels only.** A browser FLOORS `outline-width` to whole device pixels while it antialiases
  a `box-shadow` spread freely, so a 1.5px ring renders at 1px through one mechanism and 1.5px through
  the other. The thickness is stated in two languages — `--focus-ring-w` in CSS and the gap/edge pair
  in `focusShadow()` — and a contract test reads the stylesheet and fails if they drift.
- `--focus-ring` is a **colour**, not a shadow — `box-shadow: var(--focus-ring)` is invalid CSS and
  paints **nothing**, which is how 56 controls once shipped with no focus indicator at all.
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

**A.7.5 A validation colour is a REST state (merge gate).** The matrix above says what each state
_paints_. This says _when_ a control is given one, which is a separate question and the one every
form used to answer privately.

One rule, in three parts:

- **Nothing paints before the reader has had a turn.** A field is given a validation status only
  once it has been _touched_ — finished with, i.e. blurred at least once. `invalid` and `required`
  also set `aria-invalid`, so an empty field painted at rest is announced as an error before anybody
  has typed into it. This is already the house precedent: `checkout`'s `AddressFields` and
  `EmailAssignment` never pass `status="required"` for exactly this reason, and the matrix's own
  `aria-invalid` **on submit only** note for `required` anticipates it.
- **A submit force-reveals.** The one moment an untouched field may legitimately paint, because a
  refusal with no visible cause is worse than an early warning. A form owns a single
  `Signal<boolean>` and hands it to every field.
- **Focus clears the paint, and only the paint.** The instant a control takes focus, its border,
  surface and accent stand down and the focus treatment owns the outline alone. A coloured outline
  that survives focus competes with the focus indicator for the same contour, so "where I am" and
  "what is wrong" arrive on one edge and the reader can separate neither; and a field that stays red
  for the whole time it is being corrected has stopped reporting anything. The **mark** and the
  **message** do not clear — withdrawing the explanation at the exact moment the reader acts on it is
  the failure the two channels below exist to avoid.

**This reverses the Ring column's earlier reading.** The matrix previously said a validation state
"composes with focus"; it now says **cleared by focus**, and the change is deliberate rather than a
transcription slip. Nothing else in the matrix moves — every state still paints the same four
channels plus a mark, and `required` is still the red creation gate and `gate` still the amber
publishing one.

**Two status channels, not one.** `resolveFieldVerdict` (`packages/ui/fields/core/field.ts`)
returns both, and the difference is load-bearing:

| Channel      | Goes to                             | Cleared by focus | Because                                                                                              |
| :----------- | :---------------------------------- | :--------------- | :--------------------------------------------------------------------------------------------------- |
| `status`     | the **control**                     | **yes**          | it drives the outline _and_ `aria-invalid`, neither of which belongs on a field the reader is inside  |
| `hintStatus` | the **message row** (`FormControl`) | no               | the sentence explaining the problem has to still be there while it is being fixed                    |

**Where it is enforced.** Two halves, and both are needed because they cover different callers:

- `useFieldValidation` (`fields/hooks/`) owns the touched/focused/reveal lifecycle and simply
  withholds the status. It reaches **all 27** controls, including the ones that cannot compose
  `.ui-field`, because a status that is never passed cannot be painted by any sheet.
- `field.css` gates every colour channel on `:not(.ui-field--focused):not(:focus-within)` — both
  halves, because focus arrives either natively or as a signal-stamped modifier. This is the safety
  net for a caller that passes `status` directly (a server-side verdict, a form pre-dating the hook),
  and it reaches the ten controls that compose `.ui-field`.

**A status rule must never declare `box-shadow`.** The focus ring _is_ a `box-shadow`, so a status
that declares one **replaces** the ring instead of composing with it. That is precisely how `auth.css`
once shipped a focused invalid field carrying no focus indicator at all (Decision #62). Gating custom
properties composes by construction; a second `box-shadow` never can. `fields/core/field_test.ts`
asserts both sides of this section against the stylesheet, and each assertion was verified to fail
against the ungated form.

**Flagged, not resolved — the shipped focus treatment is not the canonical one.** Standing a status
paint down on focus is only worth anything while a focus indicator is there to take the outline over,
so this rule was written against what `.ui-field` actually declares today, read from the stylesheet
rather than assumed from the matrix: a single-tone 2px `--primary` underline, not the
`--focus-ring-shadow` composite that §A.7.3's "one focus treatment" bullet requires. That
divergence predates this section and was left alone on purpose — replacing it repaints every field
in the product, which is a visual ruling rather than a validation one — but it sits two rows below a
matrix that says otherwise, and it is the exact single-accent-colour shape §A.7.3 records as unable
to clear 3:1 against both a control fill and the page. It needs a human decision.

> **Merge gate.** A control given a validation status at rest, or one whose status paint survives
> focus, is not mergeable. Nor is a status rule that declares a `box-shadow`, or one that gates the
> `--field-mark` — a state that loses its icon channel is riding on hue alone (§A.5).

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
surface the rule itself named — except the selected / active state of a navigation rail, a
middle-nav row or a tag, which is a solid tonal step (below). It is wrong as the definition of a
**region's own background**.

**The active row is a tonal step too (owner directive, 2026-10-09, Decision #157).** A selected
item on a navigation rail, a row in a middle-nav list and a tag are region backgrounds in miniature,
and they are where the translucent brand wash keeps coming back — `rgba(primary, .15)`,
`color-mix(in srgb, var(--primary) 15%, transparent)`. On those three surfaces it is **prohibited**:
a teal wash over an unknown ground is unmeasurable for the same reasons as above, and it spends the
brand hue on a state the brand is not making a claim about. The active rail is solid:

```css
background: var(--surface-2);
color: var(--on-surface);
```

plus, optionally, a **2px inline-start indicator** — a `border-inline-start` that is reserved
`transparent` at rest and only recoloured when active, so selection moves no box (§B.12.3) and
mirrors for free under `dir="rtl"` (§A.6). The indicator is inked **`--on-surface`** — a house
choice, not the directive's (it names the indicator, not its colour): the brand hue would put back
the claim the wash was removed for. A square **icon rail** button reserves `border-inline` on BOTH
sides (`2px solid transparent`) and recolours only the start edge, so the glyph stays centred in its
box whether or not the indicator shows. A rail with an indicator hovers at `--surface-2` too, so
hover is never heavier than active; the indicator and the active weight carry the difference.

**Shipped on the solid step.** Every surface that carried the wash now renders `--surface-2` /
`--on-surface`:

- **Package:** `TreeNav`'s active row (`.ui-treenav__row--active`, with the indicator) and
  `LaneIconButton`'s engaged state (`.ui-lane-iconbtn[data-on]`, a round icon control, so no
  indicator — its glyph takes a 16% `currentColor` fill instead), and a toggled-on `text` `Button`
  (`.ui-button--text[aria-pressed="true"]`, Teams L2 review). The `--accent` modifier
  (`.ui-lane-iconbtn--accent`) keeps its `--primary` glyph and moves only its hover to a
  `--surface-2` fill: the wash was banned, not the hue.
- **Rails and middle-nav rows, with the indicator:** the asset picker's sources and drives
  (`.apk-nav__source` / `__drive[aria-current]`), the settings rail (`.stg-rail__item`, formerly an
  opaque teal mix with `--surface`), inbox rows (`.inbox-row[data-active]`), the files hub rail
  (`.fh-rail__item`), the catalogue rail and lane rows (`.cat-rail__item` / `.cat-lrow`), the
  project rail and channels (`.proj-railbtn` / `.proj-chan`), the file explorer tree
  (`.fx-tree__node`), the wallet lane (`.wlt-link-row` / `.wlt-rail__item[aria-current]`), the
  `/view` lane items and rail buttons (`.pf-laneitem` / `.pf-railbtn`) and the basket lane rail
  (`.bsk-lane__railbtn`).
- **The calendar rail** (`.cal-rail__item[data-active]`) keeps its solid `--surface-3` active and
  changes only its ink, from `--primary` to `--on-surface`.

**Which active rows are surface-2 and which are teal is not yet drawn (Decision #157 flag (k)).**
The directive says both "the active rail is `--surface-2`" and that tier 3 of the Button
Interaction Matrix (§B.8.1) — solid `--primary` — is reserved for "major navigation active states",
without naming which surfaces are which. What this section prohibits outright is the **wash**, and
that is now gone. Rows whose active state is a SOLID `--primary` / `--on-primary` fill — the
package `NavItem` as shipped, in the global `ShellSidebar` rail and in the Project Details lane's
top tier (`ProjectNavSection`, §D.4), and `BottomNav` — are held as shipped as tier-3 "major
navigation active states", not as a precedent. The flag asks whether the middle-nav `NavItem` rows
join the surface-2 set. It also asks for an order between hover and active: on `LaneIconButton` and
the indicator rails the hover fill equals the active fill, and on `TreeNav` and the asset picker the
hover tint (`--on-surface` at `--tint-subtle`) is about as heavy as the active step, so only the
indicator or the glyph fill tells them apart. The options are an active at `--surface-3` (as
`.msg-conv` does) or a lighter hover; an active at `--surface-3` would revise this section's
`--surface-2` rule.

> **Merge gate.** A non-interactive region whose `background` is a translucent colour is not
> mergeable. Use `--bg` / `--surface-1` / `--surface-2`. Nor is an active navigation-rail item,
> middle-nav list row or tag whose fill is a translucent `--primary` wash — use `--surface-2` with
> `--on-surface` ink.

> **Scoped exception — the `/wallet` sheet rim (Decision #123).** The dashboard sheet that slides over
> the wallet hero is translucent for its first `--wlt-sheet-fade` (`--space-7`) only: a veil running
> from `--glass-veil-chrome` to opaque `--surface`, on a `::before` underlay, so the hero's light reads
> through the sheet's edge. The sheet's own background is solid from a step inside that band, so no
> content ever sits on an unmeasurable ground — the rim carries a section heading at most, inked
> `--on-surface-variant` (the token the veil's floor was computed for). Scoped to `.wlt-sheet`.

**Opaque status tints.** A region that takes a status hue as a quiet fill — a success banner's wash,
a warning row, a danger callout, a brand-tinted band — reads one of four tokens: `--success-tint`,
`--warning-tint`, `--danger-tint`, `--primary-tint`, each
`color-mix(in oklab, var(--<ramp>) var(--status-tint-mix), var(--surface-1))`. Mixed against the
solid `--surface-1`, **never `transparent`**, so the result is a measurable solid tone that does not
compound when nested; mixed in OKLab so the step is perceptually even across hues. The strength is
one knob per mode/contrast state (`packages/ui/styles/index.css`): light `--tint` (12%), dark
`--tint-strong` (20%, since a 12% wash on a near-black surface does not read as tinted), and both
high-contrast states one ramp step lower (`--tint-soft` light, `--tint` dark), which pulls the fill
toward the surface and widens the ink on it. `--on-surface` on every tint clears 4.5:1 in all four
states and never narrows under the high-contrast overlay — pinned in
`packages/ui/system/core/theme-engine.test.ts`, which reads the knob from the stylesheet.

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

> **Scoped exception — the `/wallet` action pills (Decision #122).** The hero's glass pills
> (`.wlt-pill`) blur the painted gradient beneath them, which is none of the three cases. They ship
> at the product owner's direction, on a `::before` underlay, scoped to `.wlt-hero`; the exception
> does not extend to any other control or surface.
>
> **Extended by Decision #123, at the owner's direction and on the same terms:** the sheet's
> translucent rim (`.wlt-sheet::before`, §B.4.2 above) and the wallet's three anchored popovers — the
> scope switcher, the More menu and the currency list (`.ui-popover.wlt-glass-pop`), a
> `--glass-veil-panel` veil with secondary ink held to `--on-surface-variant`. Each blurs on a
> `::before` underlay and falls back to an opaque fill where `backdrop-filter` is unsupported.
>
> **Extended by Decision #124, at the owner's direction and on the same terms:** the hero's two corner
> tools (`.wlt-tool` — display currency · settings), which take the pills' glass exactly; and the
> pinned range ruler (`.wlt-ruler`), a viewport-pinned control the sheet scrolls beneath — case 1 in
> spirit, but a control rather than a bar — on a `--glass-veil-chrome` veil of `--surface-2` with a
> slight drop shadow, its ink held to `--on-surface` / `--on-surface-variant`.
>
> **Live background under the glass (Decision #152).** The wallet hero may paint a procedural
> aurora (`HeroAurora`, `apps/web/features/wallet/core/aurora-*`) — the ONE live background in the
> product, and the rule for any future one: it is an `aria-hidden`, pointer-inert `<canvas>` at
> `z-index: -1` in a host that already has a complete static CSS background (the resting state and
> the no-JS picture); its colours are tokens resolved at runtime, never literals; it fades in on its
> first drawn frame through `opacity` only; it never mounts under either reduced-motion channel,
> Save-Data, `deviceMemory < 4` or `hardwareConcurrency ≤ 4`, and pauses while hidden or off-screen;
> every pixel's luminance is clamped (hue kept) to a ceiling solved from the host's own inks so text
> above it keeps ≥ 4.5:1; and a watchdog (the p95 of the first 90 frames after the page settles
> > 22 ms, or rAF silent > 1 s) restores the static background for the rest of the page view. State
> is reflected on `data-aurora` / `data-aurora-reason`; the Dev Context Switcher's `walletAurora`
> axis forces either path.
>
> **Extended by Decision #131, at the owner's direction and on the same terms:** the chat's two
> floating bubbles — the composer's formatting bubble (`.msg-format`) and the touch reaction bubble
> (`.msg-reactbubble`), both `.msg-glass` — which float over the conversation so the words being
> acted on stay legible through them. A `--glass-veil-panel` veil of `--surface` on a `::before`
> underlay, an opaque `--surface` fallback, `--on-surface` ink. The highlight-mode context menu, the
> count pill and the mobile header bar are solid; the blur on the stepped-back messages is a
> `filter`, not glass.
### B.5 Fluid Motion Primitives

Motion is **purposeful, fluid, and never bouncy** (reconciling the product spec's "avoid Cascading
or Bounce effects" with spring physics: we use **critically/over-damped** springs — no overshoot).

#### Duration ramp (from spec)

`--dur-fast 150ms` (hover) · `--dur-medium 250ms` (sidebar/modal) · `--dur-slow 350ms` (theme &
layout shifts) · `--dur-highlight 1800ms` (a one-shot arrival highlight on content that changed since
the reader's last visit — the Overview's `.pjd-arrival`, Decision #146; `0ms` and no animation under
either reduced-motion channel).

Two rhythm tokens sit beside the ramp, so a list entrance or a live loop never carries its own literal:

| Token            | Value    | Use                                                                                          |
| :--------------- | :------- | :------------------------------------------------------------------------------------------- |
| `--dur-stagger`  | `40ms`   | per-item entrance offset — item `i` waits `calc(i * var(--dur-stagger))`                      |
| `--dur-ambient`  | `2400ms` | one period of an ambient loop — a live dot's pulse, a pending mark's breathe                 |

Both collapse to `0ms` with the rest of the ramp under **both** reduced-motion channels
(`prefers-reduced-motion: reduce` and `:root[data-motion="reduced"]`), where `animation: none` also
stops the loop itself. An ambient loop is still bounded where it signals something live (WCAG 2.2.2,
below).

#### Unitless spring constants

Springs are defined by **unitless** `mass / stiffness / damping` (consumed by JS-driven animations
in islands, e.g. splitter drag, sheet drag, kanban reorder):

| Spring token        | mass | stiffness | damping | Character                           |
| :------------------ | :--- | :-------- | :------ | :---------------------------------- |
| `--spring-snappy`   | 1    | 480       | 44      | Fast, no overshoot (menus, toggles, the milestone stamp) |
| `--spring-standard` | 1    | 320       | 38      | Default (drawers, sheets, splitter) |
| `--spring-gentle`   | 1    | 180       | 32      | Large surfaces (layout reflow)      |

Damping is chosen so the damping ratio ζ ≥ 1 (critically/over-damped) — **motion settles, never
bounces.**

CSS transitions and keyframes take each spring as an easing curve with both y control points at 1, so
no CSS spring can overshoot either: `--spring-snappy: cubic-bezier(0.16, 1, 0.3, 1)` (added for the
milestone stamp, Decision #155), `--spring-standard: cubic-bezier(0.22, 1, 0.36, 1)`,
`--spring-gentle: cubic-bezier(0.33, 1, 0.68, 1)` (`packages/ui/styles/index.css`).

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

#### Hover intent, press and shelf transitions (Decision #174)

- **Hover intent** is a CSS `transition-delay`, never a timer: a reveal waits `--ex-reveal-delay`
  (`--dur-slow`, 350ms) on the way in and `0s` on the way out, so a pointer sweeping across a rail
  fires nothing. It runs only under `(hover: hover) and (pointer: fine)`, on `--spring-standard`,
  through `grid-template-rows: 0fr → 1fr` into space the container already reserved, so nothing
  reflows. Keyboard focus reveals the same content with no delay.
- **Press** is `transform: scale(var(--ex-press-scale))` (0.98) on `--dur-press`, released at
  `--dur-fast`; a toggle's confirmation (the Star) is a one-shot `scale(0.6 → 1)` on
  `--spring-snappy`, which cannot overshoot.
- **A live signal loops a bounded number of times** (the Available-now dot: three
  `--dur-highlight` cycles, then rest), never indefinitely (WCAG 2.2.2).
- **View Transitions** — same-document for in-place filtering (`withViewTransition`), cross-document
  (`@view-transition { navigation: auto }` inside `prefers-reduced-motion: no-preference`) for the
  card → `/view` hero morph — are feature-detected and skipped under either reduced-motion channel
  (`motionReduced()`; `:root[data-motion="reduced"]::view-transition-*` animate nothing).
- **Removal, not a jump.** The duration collapse in `styles/index.css` would still snap a transform
  to its end state, so every transform above is `transform: none` and hover reveals stay at rest
  (a focus reveal still opens, instantly) under BOTH `prefers-reduced-motion: reduce` and `:root[data-motion="reduced"]`.

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
   explain a state live **only in the on-hover tooltip**, never inline. **One exception** (Decision
   #146): the Project Details lane's top tier prints a figure where the number is what the reader
   acts on — Discussion's unread messages, Submissions awaiting the viewer, Members changes — as
   plain `tabular-nums` `--fw-semibold` text capped at `9+`, never inside a pill, chip or fill; every
   other view keeps a toned dot (brand `--primary` · neutral `--text-secondary` · `--warning`), the
   collapsed rail keeps the dot, and the figure's meaning is always in the link's accessible name. **A second exception** (Decision #220): a lane FILTER FACET row — the catalogue console's status, highlight, delivery-model and CREATE-category rows — prints how many listings it holds, because that number is what the reader filters by; it is the same plain `tabular-nums` meta text at `--text-xs` in `--text-secondary`, right-aligned, never in a pill, with "N listings" in the row's accessible name. Those rows are multi-select on the file explorer's model (Decision #221): a press selects only that row, Ctrl/Cmd toggles one, Shift selects a run, and one visually hidden hint (`aria-describedby`) says so. A status ON a list item stays a dot.
3. **Icon-only action rows in sticky footers.** Panel-scoped actions and utilities are grouped into
   **horizontal, icon-only button rows**, typically pinned to a **sticky footer**, so the scrollable
   content region keeps its full height (mirrors the §D.2 collapsed splitter's vertical icon-only
   rows and the §D.1 bottom-pinned collapse toggle). **A lane's PRIMARY views are not footer
   utilities** (Decision #133): the destinations a reader moves between most are named `NavItem`
   rows (icon + label) at the TOP of the lane, beneath its header — never icons folded into a
   footer kebab as the lane narrows. The footer keeps only utilities (the collapse toggle, a
   details/settings trigger).
4. **Tooltips everywhere (mandatory).** Every icon-only button, action, or status indicator carries
   a lightweight, **portal-based `@projective/ui` `Tooltip`** — never a native `title`. The visible
   label may be hidden, but the anchor keeps an `aria-label` (icon-only ≠ nameless), so
   accessibility holds without cluttering the canvas. This is the same discipline the collapsed rail
   already enforces (§D.1).
5. **A lane's actions are rows, not tiles** (Decision #152). Actions a lane offers (not its
   destinations) take the SAME icon + label row as its page links, rendered as `<button>`; a locked
   action keeps its lock glyph, the accessible name "…, unavailable" and a `Tooltip` carrying the
   reason. A standing condition on the lane (the wallet's verification gate) is a presence pip — a
   solid attention tone when the next step is the reader's, a hollow `--text-secondary` ring while it
   is in review — plus ONE line and an optional text link, never an `Alert` box.

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

Three more arrived with the wallet rebuild (Decision #122) for the same reason. **`arrow-up-right`**
and **`arrow-down-left`** are value leaving and value arriving — diagonal movement with no box,
because `external-link` (an arrow leaving a box) means navigation, not money. **`repeat`** is two
arrows round one loop — something that happens again on a schedule — where `refresh` is a single
arc: do it again, now.

The file inspector (Decision #161) added an **Inspector & canvas tools** group, each drawn so it
cannot be mistaken for the neighbour it would otherwise be reused as: `zoom-in` · `zoom-out` (the
`search` lens with a plus / minus) · `zoom-fit` (a frame held inside four corners — fit to view, not
`expand`, which fills the screen) · `rotate-cw` · `rotate-ccw` (an arrow bending over a tile — a
quarter turn, not `refresh`, a retry) · `flip-horizontal` · `flip-vertical` · `print` · `move`
(arrows out along both axes — pan, not `grip`, a drag handle) · `cube-3d` (an oblique cube — a 3D
object, not `box`, a product) · `light-bulb` · `camera-scene` (a viewpoint camera, not
`video-camera`, a call) · `grid-floor` (a ground grid in perspective, not `grid`, a density choice) ·
`axes-3d` · `wireframe` · `globe-environment` (a sphere with a horizon and a light source, not
`globe`, a language) · `text-wrap` · `code-brackets` · `list-numbers` · `page-single` ·
`page-thumbnails` · `font-type` · `table-grid` · `orbit-rotate`.

The catalogue workspace's publish checklist added **`circle`**: an open ring, a step not yet done,
beside `check` — not `minus`, which reads as "none", nor `success`, which is a check already inside
a ring.

The catalogue facet redesign (Decision #220) added a **CREATE framework** group, one glyph per
category of the platform taxonomy, each prefixed `category-` so the category never borrows the verb
it is named after: `category-create` (a pen nib — not `plus` or `edit`) · `category-run` (a loop
round a play mark — not `refresh`) · `category-educate` (a mortarboard) · `category-advise` (a
two-way signpost) · `category-test` (a flask with a fill line) · `category-empower` (a key — a
handover, not `lock`/`unlock`).

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

Three glyphs use it, and they are the verification crests (Decision #155): `seal-check` (a check by
Projective — identity, or a credential), `shield-check` (identity AND a verified payout account) and
`keystone-check` (a business's corporate KYB). They replaced the single `verified` crest, which drew
three different claims identically. They are three glyphs because they are three claims, told apart
by silhouette so the distinction survives every colour-vision overlay; `VerificationStampBadge`
(§C.1) is their one renderer, and the ground under the check is the surface the crest sits on. The
INK is the renderer's alone: a call site sets the knockout ground and the size, never `color`, so the
same owner's crest reads identically on the profile hero, its sticky band, a reused card on the
profile and an `/explore` card. The crest an owner attribution draws resolves through ONE function,
`ownerVerificationStamp` (`@projective/types/org` — the owner's projected `verificationStamp`, else
the identity ⁄ corporate fallback), which the app's `VerifiedBadge` and every direct
`VerificationStampBadge` call site use (Decision #227).

> Merge gate: a PR that hand-authors an `<svg>` icon root outside `@projective/ui/icons`, authors a
> `stroke-width` on a glyph, names a colour inside a glyph (including a second `data-knockout` part, or
> a knockout whose ground is set anywhere but the call site), introduces a second glyph for an existing
> concept, reuses a registry name for a new meaning, or reaches for a Unicode character in place of a
> glyph, is not mergeable.

---

### B.8 Button Usage Policy (merge gate)

`Button` ships **four variants** (`filled` · `outlined` · `text` · `link`) × **seven shared
severities** (`primary` · `secondary` · `success` · `info` · `warning` · `help` · `danger`) × three
sizes, plus two Button-only severities that each allow one variant — `accent` (`filled` only) and
`neutral` (`outlined` only), B.8.1 / B.8.3 — the filled-only `structural` tone (tier 2, B.8.1), and
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

**The Button Interaction Matrix (owner directive, 2026-10-09, Decision #157).** Weight says how
loud an action is; the matrix says **which fill** a loud action gets, by what the action commits
the person to. A `filled` button takes exactly one of the first three tiers; the last two are the
non-fill weights above, named for the jobs the matrix reserves them for.

| Tier                                   | Fill · ink                                                                                                  | Shape                                              | Use for                                                                   | Examples                                                                                                         |
| :------------------------------------- | :---------------------------------------------------------------------------------------------------------- | :------------------------------------------------- | :------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------- |
| **1. Terminal financial / conversion** | `severity="accent"` (Button-only, `filled` only): solid `--accent` · `--on-accent` (§A.1.2)                 | pill — `rounded` (`--radius-full`)                 | A commit inside a financial / conversion flow, or the act that starts one | Checkout Pay / Place Order and every checkout commit · the entity-view lane's money verb (Buy now · Book session · Reserve seat) · Fund Escrow |
| **2. Primary structural commitment**   | `structural` (`filled` only): monochrome inverted, solid `--on-surface` · `--surface` ink (§D.7.7)          | per surface (§D.7.7: pill)                         | Commits to structure, not money                                           | Add to project · the entity-view lane's Add to basket · primary creation triggers (Create project, `LaneCreateButton`) |
| **3. Brand primary**                   | `severity="primary"`: solid `--primary` · mode-invariant `--on-primary`                                     | the radius ramp (B.8.4)                            | Major navigation active states (§B.4.2), core workflow commits            | Save photo · Attach Selected · profile hero Hire (Decision #183) · a business profile's Message (Decision #244)   |
| **4. Neutral outlined**                | `severity="neutral" variant="outlined"` (Button-only): border `var(--hairline-strong)` · `--on-surface` ink | the radius ramp; icon-only may be a circle (B.8.4) | Utility actions — **mandatory** for them                                  | Asset-picker Upload · Show more · Try again · profile media upload · profile Message · Follow · Settings · Share |
| **5. Ghost / bare**                    | `text`: transparent · a subtle tonal hover lift                                                             | the radius ramp                                    | Secondary toolbar tools, escape hatches                                   | Toolbar verbs · Cancel · the basket footer's Checkout pill (B.8.4) · a drawer header's icon-only Save / Share beside Close (Decision #182)                                               |

Tier 2 has no severity of its own: it is the §D.7.7 override `--btn-accent: var(--on-surface);
--btn-on: var(--surface)` on a `filled` Button, which swaps sides with the theme by construction.
The override is spelled `structural`: `<Button structural>` sets `.ui-button--structural`, whose CSS
is exactly that pair, declared after every severity so it wins whatever ramp the Button carries.
`ButtonStructuralTone` types it `filled` only — `structural` with `outlined`, `text` or `link`, or
with the `accent` or `neutral` severity, does not compile. Its hover is the §B.12 zero tonal step
on the border channel: the base ramp blends toward `--on-surface`, which is this fill, so a tonal
step would be a no-op. The press is the shared scale compression. The pair measures **17.14:1**
light / **14.93:1** dark, widening under `data-contrast="high"` (21.00:1 / 19.28:1), and
`theme-engine.test.ts` pins it with the mode-adaptive pairs (≥ 4.5:1 in all four states, ≥ 7:1 in
dark). `LaneCreateButton` wears the same pair (§C.1, Decision #228 (D)).
The tiers are ranked by **hue before emphasis** — amber is the one colour in the product that means
the person is in the act of paying or converting, monochrome is structure, teal is the brand's own
navigation and workflow voice. That is what makes tier 1 safe beside tier 2 (B.8.2).

**The tier-1 test, stated once.** Tier 1 is **a commit inside a financial or conversion flow, or
the act that starts one**: every commit of the checkout — Continue, Save details, the Add-card
actions, Pay / Place Order (B.8.4) — the entity-view lane's money verb, which starts a purchase, and
Fund Escrow. The profile's Hire also starts a flow but is held at tier 3 by owner direction
(Decision #183 flag (b)). It is
never borrowed for a commit outside such a flow: an amber "Save" on a settings form teaches the
reader that amber means nothing. Every other statement of tier 1's scope in this document, in
`PRODUCT_SPEC.md` §Visual Identity and in the B.8 gate reads from this sentence. The narrower
reading — amber for the money-moving commit alone (Pay / Place Order, Fund Escrow), with the flow's
other commits in tier 2 — is open as Decision #157 flag (j); the docs follow the directive's
"every checkout commit" until it is ruled.

**Where tier 1 renders today.** Beyond the checkout (B.8.4) and the entity-view lane's money verb
(§D.7.7):

- the basket summary's **Proceed to Checkout** link (`bsk-summary__cta`) — the act that starts the
  checkout flow;
- the wallet movement dialog (`WalletDialogs.tsx` `MoveDialog`): its **Continue** and its review
  commit — _Fund escrow €X_, _Withdraw €X_, _Transfer €X_, _Split €X_, _Continue to payment_; its
  review body is `CommitReviewBody` (§C.1, Decision #247);
- a business's Billing module (`/businesses/:h/billing`, Decision #247): ONE **Pay €X** for the
  oldest payable invoice, in the band above the invoice table; every other payable row carries a
  tier-5 **Pay** that opens the same `CommitReview`, whose commit (_Pay €X_, or _Top up the wallet_
  when the wallet does not cover it) is the tier-1 control inside it. The balance band's **Top up**
  (below the floor; it starts the business wallet's top-up and returns to Billing) is tier 1 only
  while no Pay renders, tier 4 beside one — so the page never holds two amber controls;
- the shared `StripeElementPanel`'s **Pay £X** confirm in payment mode — the wallet top-up's card
  step and the `/checkout/payment` card step;
- `FundStageDialog`'s commit — _Fund €X_ from the wallet or _Continue to payment_ (Decision #197);
- the DM context drawer's **Fund escrow & confirm seat** — both the `fund_escrow` link and the
  `confirm_seat` Button;
- the project board footer's **Checkout N** pill (`.brd-rig__action--accent`, a feature-local
  control whose hover and press blend toward `--on-scrim` by `--tint-soft` / `--tint`, B.12.4);
- a business checkout's short-pool **Add money** (`.cko-gate__add`, an anchor in the accent pill's
  classes) — it starts the business wallet's top-up and returns to the checkout (Decision #243). The
  same gate's **Request approval** and its dialog's **Send request** are tier 3: they file a request
  and move no money (Decision #243 (h), ruled by the owner 2026-10-17: the one stated exception to
  "every commit of the checkout" above). Either
  fill is the payment step's commit while it renders: the rail's Buy Now is then not rendered at all
  (`gateTakesCommit`), as for a pending card step (B.8.2), and the rail keeps its "Pay is off
  until…" line;
- Settings → Verification & payouts' **Set up payouts** / **Continue setup** — the start of the
  personal Connect account money is transferred to, and only while it is the page's one next step
  (`nextVerificationStep`); otherwise, and as **Update payout details** on a verified account, it
  is tier 4. This widens the tier-1 test above by owner ruling (Decision #225): the identity check
  and a business's KYB on the same page stay tier 3.

**Commits that stay tier 3 — the "never borrowed" sentence, worked.** Wallet configuration commits
(the payout schedule, recurring-deposit setup, spend request, income smoother, Save card), the
spend-approval **Approve**, **Accept Submission** and **Publish** commit a setting or a workflow
step, not a payment in flight, and keep `severity="primary"`. One money-releasing commit, and its
opener, are held non-amber by a component, not by the rule: `ConfirmDialog` / `ConfirmPopup` type `acceptSeverity`
as the shared `Severity`, so _Approve and release_ (`ApproveStageDialog`) cannot take `accent`, and
its opener _Approve Stage_ (`SubmissionActionBar`) stays beside it for consistency (Decision #157
flag (o)). The schedule view's _Book this slot_ (`EventModal`), the body counterpart of the lane's
held _Book session_, waits on flag (f) (flag (q)).

**Tier 1 is `<Button severity="accent" rounded>`.** The severity sets the colour only; the pill comes
from `rounded`. `accent` is `filled`-only by type — `ButtonAccentTone` admits only `variant?:
"filled"` — because `--accent` is contrast-checked as a fill under `--on-accent`, not as ink on a
page: as text on light `--surface` it measures 2.97:1, so an outlined, text or link amber label would
be unreadable. A native `<button>` or `<a>` that must carry a ref or an `href` (the profile's Hire,
the basket's Proceed to Checkout, the drawer's fund link) wears the same class set,
`ui-button--accent ui-button--filled ui-button--rounded`, with no local colour overrides.

**Tier 4 is `<Button severity="neutral" variant="outlined">`.** `neutral` is the second Button-only
severity, typed through `ButtonNeutralTone`, which requires `variant: "outlined"` — a neutral
`filled`, `text` or `link` does not compile, because a neutral fill would read as tier 2.
`button.css` sets `.ui-button--neutral { --btn-accent: var(--on-surface); --btn-on: var(--surface) }`
and `.ui-button--neutral.ui-button--outlined { border: var(--hairline-strong) }`; hover is the
`outlined` variant's own `--tint-soft` lift in `--on-surface`. A native element wears
`ui-button--neutral ui-button--outlined` (the profile owner rig's Settings `<a>`). Whether every
`outlined` turns neutral, or only utility actions do while a severity-tinted `outlined` keeps the
weight table's "real alternative" row, is open as flag (l); until it is ruled, utility actions take
the neutral severity and the weight table's `outlined` row is unchanged. `--hairline-strong` is the
existing border shorthand (`1px solid var(--hairline-strong-color)`, §A.3), used as-is, never
re-mixed.

**B.8.2 One filled action per view — and per overlay.** A view's primary action is singular by
definition; the moment there are two, neither is primary and the user reads a fork. The cap counts
**per rendered region a user is deciding within** — a page body, a modal, a drawer, a footer rig
each get one. It does **not** count a `filled` button that is mutually exclusive with another by
render condition (a Publish that swaps to a Pause is one button in two states, not two buttons).

**Right** — `apps/web/features/catalogue/islands/ListingActionRig.island.tsx`: the listing
workspace's status rig, where exactly one action is `filled` (Publish, `aria-disabled` and described
by the gate sentence until `publishReadiness` clears), Archive is neutral `outlined`, and Delete —
present only while no buyer has engaged with the listing (Decision #221) — is a `text` danger action. On a
published listing Publish swaps to an `outlined` Pause, so the rig holds one fill in either state.
The hierarchy is legible at a glance and survives translation, because it is carried by weight
rather than by word length.

**Right** — `apps/web/features/workspaces/components/InviteQueue.tsx:147-236`: four repeated row
actions all `text` (severity distinguishing accept from the rest), and the one utility action
`outlined`. A repeated action is **never** `filled` — a column of filled buttons is a column of
noise, and it makes the row's _content_ the least prominent thing in the row.

> **Two fills are legal only when ranked by hue (§D.7.7, Decision #157).** The cap exists to
> protect the reader's ability to rank the actions. Where a decision region genuinely holds a
> terminal financial commit AND a structural commitment, the two may both be filled because the
> matrix ranks them by **hue** — amber tier 1 against monochrome tier 2 — rather than by emphasis,
> so the ranking survives. The canonical case is the entity view's commerce lane: the **money
> verb** (amber accent) beside **Add to basket** (monochrome inverted) (Decision #183). The profile
> action rig's teal **Hire** beside monochrome **Add to project** is an owner-directed exception
> scoped to `ProfileRig` (Decision #183 flag (a)), not a precedent. Two fills of the SAME colour — or
> any other two tiers — is the case the cap was written for, and remains a finding.
>
> The pair is spelled in Button terms as `<Button severity="accent" rounded>` beside
> `<Button structural rounded>`, and it is already allowed in any one decision region that holds a
> terminal commit and a structural one — nothing new is permitted by the `structural` prop, which
> only gives tier 2 a name. Two `structural` fills in one region are the same-colour case.

**Right** — `/checkout/payment` while a card step is pending (`cardStepPending`,
`apps/web/features/checkout/core/card-step.ts`: a `requires_action` result carrying a payment
handoff). The card panel's **Pay £X** is then the only tier-1 commit: the rail's Buy Now block is not
rendered at all, rather than rendered beside it, which also stops a second charge attempt
mid-handoff. Two amber Pay buttons for one payment are the same-colour case, so one of them leaves
the DOM.

**B.8.3 Severity is meaning, never decoration.** Severity encodes what the action _is_ — it is not a
palette. Two rules follow:

- **An irreversible or destructive action takes `severity="danger"`, always.**
  `apps/web/features/workspaces/components/OwnershipTransfer.tsx:120` shipped "Transfer ownership" —
  an irreversible transfer of an entity — styled **identically to a safe primary**. The user's last
  chance to notice was the word "Transfer"; the interface said "this is the normal thing to do
  here." Now `variant="filled" severity="danger"`, a vocabulary the codebase already had and had
  simply not reached for. Read that as the general failure mode: the wrong severity is almost never
  a _misuse_ of the API, it is a _non-use_ of it. This rule and tier 1 of B.8.1 overlap on an
  irreversible but intended money movement — _Approve and release_, _Withdraw_, _Transfer_ — which
  the matrix makes amber; the wallet's movement commits ship as tier 1. Which rule wins is open as
  Decision #157 flag (p); the reading proposed there is that `danger` is for destructive or loss
  actions, and an irreversible financial commit the person intends is tier 1.
- **Do not invent a severity by re-tinting.** The severity pair block (`--x-accent` / `--x-on`) is
  hand-copied across `Button` · `Badge` · `Tag` · `Alert` · `Message` · `Toast`, so a wrong pair
  appears **six times, not once**. `secondary` once paired with `--on-surface` and measured **2.67:1
  light / 1.32:1 dark**; `info` was aliased to `--secondary`, so the generated blue ramp rendered
  nowhere and two severities were visual duplicates. When a severity or ramp changes, all six
  components are in scope for that PR. The rule covers the seven shared severities only: the two
  Button-only rows below exist in `button.css` alone and are not hand-copied anywhere.
- **`accent` and `neutral` are Button-only severities (Decision #157).** Each names a tier of the
  Interaction Matrix (B.8.1) — `accent` the terminal commit (tier 1), `neutral` the utility action
  (tier 4) — not a state, so neither has a meaning on `Badge` · `Tag` · `Alert` · `Message` ·
  `Toast`: an amber tag or alert would borrow tier 1 outside a financial flow and put a fill where
  §B.11.6 forbids one. Neither is in the shared `Severity` union
  (`packages/ui/fields/types/mod.ts`) those five components read; `Button` takes the wider
  `ButtonSeverity` (`Severity | "accent" | "neutral"`), each Button-only member narrowed to its one
  legal variant (`ButtonAccentTone` → `filled`, `ButtonNeutralTone` → `outlined`), and the other five
  severity pair blocks have no row for either. Components that forward a severity to an inner
  `Button` keep the shared type: `ConfirmDialog` / `ConfirmPopup` `acceptSeverity` is `Severity`, so
  a financial commit hosted in one cannot be amber — widening it to `ButtonSeverity` with an
  accept-`rounded` hook is open as Decision #157 flag (o).

**B.8.4 Shape.** `rounded` is the **pill** (`--radius-full`) and is a _shape_, reserved for
chip-like and floating controls; it is deliberately not multiplied by `--radius-scale` (§A.3). Every
other button reads the radius ramp **at its own size** — a `sm` button is not a `lg` button's corner
on a smaller box. `Button` and `ToggleButton` shipped a fixed `--radius-base` at all three sizes,
which is why an `sm` control read visibly rounder than its neighbours. `raised` is a **response**
(hover / drag / active), never a resting state — the same rule §B.9 applies to `Card`. Tier 1 of the
Button Interaction Matrix (B.8.1) is the one place the pill is part of an action's identity rather
than a surface's choice: an amber terminal commit is a pill wherever it renders (Decision #157).
Tier 1 does not by itself license `rounded` for any other tier; a pill elsewhere stands on its own
justification — a surface's recorded choice (the §D.7.7 rigs, the §C.1 `LaneCreateButton`) or the
chip-like / floating rule above, under which an icon-only control (a tier-4 Message or Follow
circle) may be round.

> **Scoped exception — the checkout surface (owner-approved, 2026-08-10).** Every CTA and quiet
> action across `/checkout`, `/checkout/details`, `/checkout/payment` and `/checkout/confirmation`
> takes the pill, because the flow's design draws them that way consistently and a single rounded
> rectangle among them reads as a mistake rather than as a distinction. This is a **surface**
> decision, not a relaxation of the rule: the pill still means nothing semantically, it is still not
> multiplied by `--radius-scale`, and it does **not** extend to any other surface (tier 1 of B.8.1
> excepted). A control outside the checkout that wants `rounded` still has to earn it by being
> chip-like or floating. The flow's three dialogs — confirm-and-pay, Save details and Add payment
> method — are inside the exception: their footers pill both the commit and the Back / Cancel escape
> hatch (they took the size-based radius before). Logged in
> root `CLAUDE.md` §8 Decision #70.
>
> **The checkout's commit colour (Decision #153, amended by Decision #157).** Every COMMIT on the
> flow — Continue, Buy Now / Pay, the confirm-and-pay dialog's Pay, Save details and both Add-card
> actions — is `<Button severity="accent" variant="filled" rounded>`: the **global accent pair**
> `--accent` / `--on-accent` (§A.1.2), tier 1 of the Button Interaction Matrix (B.8.1) by the tier-1
> test there — each is a commit inside a financial flow, whether or not that one press moves money
> (scope open as flag (j)). The basket summary's **Proceed to Checkout** link (`bsk-summary__cta`),
> the act that starts the flow, wears the same class set (`ui-button--accent ui-button--filled
> ui-button--rounded`); it was `ui-button--warning`. The surface's private `--checkout-commit-bg` /
> `-fg` / `-pole` tokens and the `.cko-commit` class are **deleted**; what they proved — a
> fixed-polarity amber whose hover and press blend toward a LIGHT pole so the label's contrast rises
> with pressure (§B.12) — moved into the token layer, where `theme-engine.test.ts` pins it.
> `checkout-commit-tokens.test.ts` is gone with the tokens; `checkout-commit-tier.test.ts`
> (`apps/web/features/checkout/core/`) now covers the markup contract — no private commit token or
> class, no warning-ramp commit, every commit an accent filled pill, and the card-step rule of B.8.2.
> The colour is no longer a checkout exception; the **pill** above still is (Decision #70),
> unchanged.
>
> **The basket footer band defers to the summary card.** On the basket step the band's **Checkout**
> pill is tier 5 ghost — `ui-button--text`, ink `--btn-accent: var(--on-surface)`, no underline —
> not a filled link: it duplicates the summary card's amber commit, and the region holds one fill.
> The band's other ghost actions take the same `--on-surface` ink and hover tint, not `--primary`;
> `danger` toolbar actions keep their hue. The footer rig types its commitment as
> `CtaTier = "accent" | "ghost"`, defaulting to `accent`, so `warning` is no longer a rig commit ramp.

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
> decision region (other than the hue-ranked amber + monochrome pair, B.8.2, and the entity-view
> lane rig held as shipped under Decision #157 flag (f), §D.7.7), fills a button from outside its
> Interaction Matrix tier (an amber commit outside a financial / conversion flow, B.8.1's tier-1
> test — wallet configuration commits, spend-approval Approve, Accept Submission and Publish stay
> tier 3; a utility action that is not `severity="neutral" variant="outlined"`), puts
> `severity="accent"` or `severity="neutral"` on any component other than `Button`, styles an irreversible action without `severity="danger"`, ships an
> icon-only button lacking `aria-label` + `Tooltip` + a ≥24px target, uses `raised` as a resting
> state, or orders a footer's actions with a spacer instead of `justify-content`.

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
that actually shipped is subtler and just as banned — **a card inside an already-elevated surface**:
the file preview modal's sheet (`apps/web/features/projects/styles/attachment-modal.css`, before
Decision #162 rewrote it) gave `.fx-audio`, `.fx-code` and `.fx-doc` each
`background: var(--surface)` + `box-shadow: var(--elevation-low)`, inside `.fx-modal__media`
(tinted), inside `.fx-modal__panel` (`--surface`). **Three nested surface layers, two of them the
same colour, separated by shadow alone** — which is exactly the "wall of equal-weight bordered
boxes" §B.4 was written against, just built from shadows instead of borders. A panel is already a
surface; content inside it separates by spacing and tint, and the innermost thing is not a card. The
rebuilt modal is the worked fix: the stage is a solid `--bg` region, the aside a solid `--surface`
region, and the legacy fallback's audio, code and document views sit on the stage unboxed.

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
render as an unboxed list: an `Icon` (`check`) in the brand (`--primary`), the item in Body
register, one row per item at `--space-3`. No per-row surface, no per-row border, no per-row chip. The check glyph is the
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
term** so a panel can never exceed the window — the old `attachment-modal.css` shipped
`block-size: min(860px, 100%)` with no viewport term and stood taller than an 800px laptop window
(the rebuilt preview modal is `--overlay-w-full` × `--overlay-h-lg`, Decision #162; below `--bp-md`
it goes fullscreen at `100dvh` with radius 0, a scoped and flagged exception to this token set on
the #161(C) inspector precedent — Decision #162 flag (e)).
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

**The one exception is a TIER, not a knob.** `Backdrop intensity="heavy"` (and `Dialog
backdropIntensity`) reads its own pair, `--scrim-tint-heavy` (per theme, dark heavier) and
`--scrim-blur-heavy` (the glass-chrome strength), and exists for exactly one meaning: *the page
beneath cannot be used right now*. The offline interstitial — a navigation refused because nothing is
stored for the destination — is that case, and the scrim says so before the copy is read. It is
chosen by what the modal means, never by which surface opened it or how important its author feels
it is; a second modal reaching for `heavy` because it "wants more focus" is the drift this rule
exists to stop, and is a finding.

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
- **A persistent window claims passively.** `DraggablePopover` (and `MoneyFlowPopover`, the chat
  pop-out and the dev windows built on it) takes a `passive` claim in the draggable band: it raises the
  ceiling, so a dropdown or message menu opened inside it steps above it, and touching it re-claims
  the top through `raise()`. It never takes `isTop`, so a modal open beside it keeps Escape (Decision
  #171). The old module-global counter, and the `calc(var(--z-draggable) + 1)` the message menus used
  to clear it, are gone.
- **The toast and tooltip bands are static by design.** `--z-toast` and `--z-tooltip` sit above every
  class the stack allocates, never nest another overlay and never own Escape, so `toast.css`,
  `tooltip.css` and the board/timeline notice strips keep a literal band, each with a comment saying
  so. A claim would only steal `isTop` from the dialog a tooltip is shown inside.

**B.10.4 Every panel must render through `BodyPortal`.** A `position: fixed` panel that merely stays
in the tree is not safe: the sticky middle-nav lane is a **stacking context** that caps its
subtree's paint order, it is `overflow: clip`, and any glass ancestor's `backdrop-filter` **re-bases
`fixed` onto that ancestor's box**. All three at once. The Dialog is the trap in its purest form —
`dialog.css:71-72,80` settles its enter transform to `scale(1)` and never to `none`, and **a
transform at rest is still a containing block for `fixed` descendants and a stacking context**,
alongside `overflow: hidden` — so every field dropdown opened inside a Dialog was simultaneously
re-based and clipped. The last hand-rolled holdout — a `position: absolute; z-index: 2` kebab menu
inside the preview modal's `overflow: hidden` panel (`attachment-modal.css`) — went with
Decision #162: its one item, Report, had no backend (§3 gate 11), so the menu was removed rather
than re-portalled.

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
4. **Escape and the backdrop each dismiss exactly one layer.** Escape is owned by ONE `document`
   capture listener (`hooks/escape-stack.ts`) that hands each press to the most recently opened
   overlay only and `stopImmediatePropagation`s it — per-instance listeners ran in registration
   order, so a caller that forgot `enabled: isTop` let the LOWEST modal take the key. A modal with a
   scrim dismisses on outside clicks through its `Backdrop` ONLY (`closeOnOutside: false`): the top
   scrim covers every layer beneath, and `useBackdropPress` fires only for a press that starts and
   ends on the scrim itself, so a text selection or drag released over it, or the release of a press
   whose layer closed mid-gesture, never closes anything.
5. **Focus returns** to the trigger on close.
6. **The overlay is named.** `role="dialog"` without an accessible name announces _worse_ than no
   role; `Popover` and `ConfirmPopup` shipped unnamed. A confirmation is `role="alertdialog"`.
   A `headerTemplate` that carries controls passes `labelledBy` at its own title — otherwise the
   name is the whole header region, every action button's label included (Decision #151).
7. **Dismissal resolves to the safe outcome.** Escape and backdrop **reject**, never accept — the
   one thing the family already got right, and the one thing it can never regress.

**Focus is visible inside every overlay.** The product removes the focus ring by owner directive
(152a27a; `apps/web/styles/global.css`), but an overlay is exempt (Decision #171): a keyboard user in
a trapped panel has no page context to orient by. Every portalled overlay mounts under a
`[data-ui-portal]` host, and one rule there draws `--overlay-focus-ring` at `--overlay-focus-offset`
— a 2px `--fld-focus-fg` outline (6.25:1 dark / 6.93:1 light on `--surface`), widened to 3px
`--on-surface` under `data-contrast="high"`. An outline, not a shadow, so it never fights a control's
elevation and the panel's scroller does not clip it. The package's own close/action buttons
(`.ui-drawer__close`, `.ui-dialog__action`) spend the same pair, so the indicator travels with the
package into a project that never neutralised focus.

The same pair is the second scoped exception (Decision #176): the discovery controls a keyboard
reader pages through — the Explore rail arrows (`.ex-railbtn`), the card stretched links
(`.ex-card__link`), the sponsored promo slot (`.ex-promo--sponsored`) and the carousel arrows and
indicators (`.ui-carousel__nav`, `.ui-carousel__indicator`). A card link sits inside a rail scroller
that clips vertically, so its ring is drawn inside the card edge (`--overlay-focus-offset × −2`).

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

**The footer slot.** `Drawer` and `Dialog` both take `footer` (Dialog also `footerTemplate`). It
renders as the scroll body's **sibling** (`.ui-drawer__footer` / `.ui-dialog__footer`), `flex: none`
under a single `--hairline`, with `padding-block-end: max(var(--space-4), env(safe-area-inset-bottom))`
so a bottom sheet or phone-height drawer clears the home indicator. The slot supplies the seam and the
padding; what goes in it supplies neither again (the basket's `.bskd__foot` dropped its own hairline
and padding when it moved in). Pass the whole action block, totals included when they qualify the
commit:

```tsx
<Drawer visible={open} position="right" header="Basket" footer={<BasketFoot />}>
  {lines}
</Drawer>
```

A conditional footer may pass `false`/`null` — no empty hairline renders. The drawer's width is the
`--drawer-w` contract; `size` is for a genuinely different panel, never a per-feature retune (the
basket's `min(27rem, 94vw)` and the shell's `min(25rem, 92vw)` / `min(20rem, 88vw)` were removed).

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

**Both examples above are now built this way (Decision #162(E)).**

- **A ticket opening a file.** The ticket chain's `ticketStack` (`features/projects/core/ticket-view.ts`)
  carries a `"file"` frame beside `"ticket"` and `"review"`. A file clicked in a ticket's Attachments
  or Submissions tab is pushed as that frame and renders `AttachmentPreviewModal` with
  `frame={{ stack: ticketStack, uid }}` — the ticket's DOM is gone while the file shows, and popping
  the frame restores the ticket with its tab and scroll and refocuses the file it was opened from.
  Middle / Ctrl / ⌘-click still opens `/inspect` in a new tab. On a standalone chain `?tkv=` stays
  while a file frame shows.
- **A review opening a file.** `SubmissionExplorer` owns a per-surface
  `createModalStack<"review" | "file" | "presubmit" | "picker">()`; the review, the preview, PreSubmit
  and the asset picker render only as the top frame, never as sibling portals.
  `SubmissionReviewModal` keeps its rail selection, annotations and draft feedback in frame state (`useFrameState`, its mount reset guarded by
  `stack.has(uid, key)`), so a file opened from the rail and closed again returns to the unsaved
  review intact.
- **The preview modal is frame-aware.** With a `frame` it caches its own page index, aside, sheet,
  shortcuts and note draft per frame uid (aside scroll through `useFrameScroll`), and the stack — not
  the modal — owns dismissal; without one it behaves as a standalone modal. It draws one `Backdrop`
  as a frame exactly as it does alone, so a chain never shows two scrims.
- **A ticket opening the asset picker (Decision #162(E2)).** "From library" on a ticket's
  Attachments tab pushes a `"picker"` frame (`pushTicketPicker`, `ticket-view.ts`), and
  `TicketPickerFrame` renders `AssetPicker` with `frame={{ stack: ticketStack, uid }}`. The ticket is
  unmounted, the picker's own `Backdrop` is the one scrim, and dismissal pops the frame (`back()`,
  else `close()`). The picker frame copies the ticket's address (`ticketId`, `slug`, `standalone`,
  `mode`), and `addressingFrame` skips it as it skips a file frame, so `?tkv=` stays while it shows
  and Back closes the whole chain. `pushTicketPicker` refuses unless that ticket is on top and a
  mounted host renders picker frames for its posture (the file-frame host registry).
- **PreSubmit opening the asset picker.** "Add from your files" calls the host's
  `onOpenLibrary`; `SubmissionExplorer` records `PRESUBMIT_LIBRARY_TRIGGER` on the PreSubmit frame
  and pushes a `"picker"` frame that renders `AssetPicker` with `frame={{ stack, uid }}`. The picks
  land in the explorer's own `libraryPicks`, which stays mounted, so no handoff is needed. PreSubmit
  keeps its selected rail row in frame state, so the round trip returns to the row it was on.
- **The asset picker is a leaf frame.** Inspect and crop happen inside its own pane and "open raw"
  opens a new tab, so nothing ever covers it. Its folder, selection, inspect and crop state therefore
  live exactly as long as the component and are **not** frame-cached; it still resets on every open.
  Every awaited upload or link captures a session token, so one that lands after the frame popped
  still finishes in the library but is never picked, and the `/files` hub selection is restored when
  the picker closes **or** unmounts while open. A future picker that opens an overlay of its own
  moves its browsing state into `useFrameState` first.
- **A frame returns its result through the requesting frame's cache.** The frame that asked is
  unmounted when the answer arrives, so the picker's `onPick` writes the picks into that frame's own
  cache entry — `handOffPicks(stack, uid, assets)` under `PICKER_HANDOFF_KEY`, de-duplicated by id
  (`features/files/core/picker-frame.ts`) — and the restored frame reads and clears them once on
  mount (`takePicks`). The cache is the carrier because it is not reactive (the write re-renders
  nothing), it dies with its frame (a chain closed before the answer is read leaks nothing), and uids
  are per stack (`ticketStack`, the explorer stack and `eventStack` all count from 1, so a
  module-level map keyed by uid would collide). A requester that stays mounted beneath the chain
  needs no handoff.
- **Focus return has one mechanism.** The frame being replaced records a trigger under
  `FILE_FRAME_TRIGGER` (`features/projects/core/file-frame.ts`): a file id for a preview, a control
  token for anything else (`TICKET_LIBRARY_TRIGGER` = `"control:library"` for the picker). When the
  frame is restored, `useFileTriggerFocus` (`features/projects/hooks/useFileTiles.ts`) takes the
  trigger once and focuses it after the restored modal's trap has placed its own initial focus (one
  animation frame plus one task, with a timer fallback), and skips it if focus has already left that
  dialog; a token that is not a file resolves through `useFileTiles`' `locateTrigger`. A ticket being
  created leaves its title unfocused while a trigger is waiting. Do not add a second refocus path
  beside it.
- **Nothing is pushed over a ticket whose create is in flight.** `repointFrame` re-points only a
  ticket that is on top, so while a new ticket's save is in flight "From library" is disabled and an
  attachment opens in a new tab rather than as a frame.
- **A swap never unlocks the page.** `useOverlayStack`'s reference-counted body lock
  (`createScrollLock`, `packages/ui/hooks/scroll-lock.ts`, internal) releases deferred — two
  animation frames, with a timer watchdog for a tab that services none — and a claim arriving in
  between cancels the release. The lock is claimed in a layout effect, in the same commit that
  mounts the overlay, so a swap's incoming claim lands in the very task of the outgoing release and
  cancels it; a long task between the swap and paint (measured: 400 ms and 1 s injected) no longer
  lets the deferred release win, which it did while the claim waited for the post-paint effect.

Two piles remain and are flagged, not sanctioned (Decision #162 flag (v)): `NewConversationModal`
→ `ContactPicker` → `MediaCropPicker`; and the mobile profile `Drawer` → `PopoutChat` →
`ChatComposer`. A requester with no modal beneath it (a page's composer slot, a listing editor
section, the non-modal desktop `DraggablePopover`) keeps the global `openPicker` path.

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

**`MetaLine` (`@projective/ui/display`) is THE way to render it** — never a hand-rolled join:

```tsx
<MetaLine items={["Owner", isPublic && "Public", { text: "4 members", tabular: true }]} />
```

`items` takes strings or `{ text, tabular?, title? }` and drops falsy entries, so a conditional fact
needs no filter at the call site; `tabular` sets a changing figure in `tabular-nums` (§A.4); `title`
carries a fact's long form (a full date). `as` picks `p` (default) · `span` · `div`, and `size` the
Meta register's `sm` (default) or a dense row's `xs`. The separator is a real middot (`·`) in an
`aria-hidden` `.ui-meta-line__sep` span, in the line's own `--text-secondary` ink, with the items as
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
in the brand (`--primary`), each carrying a portal `Tooltip` (§B.6.4) that says what earned it. The signal is a
claim the reader may want to check, so it gets an explanation on demand; it does not get a fill,
because a fill makes six earned signals compete with the one lifecycle status that genuinely needs
the colour channel. Where a signal is inherently graphical — the verification crest — it is an
`Icon`, not a pill (§B.7.8).

**B.11.5 Two chips in a row is the smell.** One status on a card is a state. Two adjacent fills mean
at least one of them is metadata wearing a control's clothes. Reviewers should read a chip row
right-to-left and ask of each: *is this clicked, is this a lifecycle state, is this a legal
disclosure, is this a numeral?* The first "no" is the finding.

**B.11.6 A permitted container is still a solid fill (owner directive, 2026-10-09).** A chip or tag
that earns its container under B.11.3 fills it with a **solid tonal step** — `--surface-1` /
`--surface-2` for a neutral control, the role's own generated ramp tone for a lifecycle status —
never a semi-transparent brand wash (`rgba(primary, .15)`, `color-mix(… var(--primary) …,
transparent)`). The prohibition is the same one §B.4.2 states for active navigation rails and
middle-nav lists, and for the same reasons: the wash is unmeasurable over whatever it lands on, it
compounds when a tag sits on a tinted card, and a teal tint on a tag reads as the brand making a
claim the tag is not making.

> **Merge gate.** A PR that wraps non-actionable metadata in a pill, chip, tag or badge — or that
> ships two adjacent non-interactive fills on one row — is not mergeable. The fix is inline Meta-
> register text with middot separators, not a smaller chip. A permitted chip or tag whose fill is a
> translucent `--primary` wash is not mergeable either (B.11.6).
>
> **One scoped exception (product owner, 2026-09-10 — §8 Decision #96).** The public profile's
> context bar renders its **Skills** and **Languages** as monochrome, borderless pills (`.pf-tag`:
> `--surface-1` fill, `--text-secondary` ink, `--text-xs`). Skills are CONTROLS — each is a link
> into the Explore search for that skill — and are compliant on their own terms. Languages are not
> clickable and are the one non-actionable row on the platform permitted a fill, by the owner's
> explicit direction for that surface's editorial cluster. The pills are achromatic and identical in
> shape, so the exception does not smuggle a status colour in; it is recorded here so it is not
> generalised to a card, a lane or any other surface, where B.11.2 stands.
>
> The same bar's **availability status is not a container.** It is unboxed text led by an inline
> dot that differs by shape as well as by word: _Available_ draws a solid `--on-surface` dot beside
> `--on-surface` text at `--fw-medium`; _Away_ a hollow `--on-surface` ring beside `--text-secondary`
> text at `--fw-normal`. The sticky header band's pip matches. The dot stays achromatic under
> Decision #96's monochrome profile chrome — no `--success` for Available, and no `--warning` for
> Away, which would also collide with the amber commit (Decision #157 flag (a)).

---

### B.12 Button Feedback & the Contrast Invariant (merge gate)

§B.8 governs **which** button an action gets. This section governs what a button does when a person
actually touches it, and what its label is guaranteed to measure while they are looking at it. The
two belong together because they fail together: a control that does not acknowledge a press invites a
second press, and a control whose label thins out under the cursor is hardest to read in exactly the
moment it is being read.

> **Numbering note.** This is **§B.12**, not §B.11. §B.11 is Anti-Tagification and is referenced by
> name from root `CLAUDE.md` §3 gate 7 and §9, from Part E's "six component laws", and from Part F.
> Renumbering it to make room would have silently redirected five live cross-references.

**B.12.1 Scale-compression baseline.** A pressable control compresses under the pointer:

```css
transform: translateZ(0) scale(var(--btn-press-scale)); /* 0.97 */
transition-duration: var(--dur-press); /* 50ms in; --dur-fast out */
```

Icon-only controls take `--btn-press-scale-icon` (0.92) instead. The deeper step is not decoration:
compression is read **relative to the control's own size**, so 3% off a 96px button is ~3px of travel
while 3% off a 32px square is under a pixel and reads as nothing. The press-in is deliberately shorter
than the release — a press should land under the finger and settle on the way back; equal durations in
both directions read as a twitch. The resting `scale(1)` is **declared**, not implied: a transform
that exists only in `:active` animates from `none`, which is not interpolable with `scale()` in every
engine, and the return then snaps instead of easing.

Reduced motion sets `transform: none !important` under **both** `@media (prefers-reduced-motion:
reduce)` **and** `[data-motion="reduced"]`. These are two different populations — one reads the
operating system, the other is this product's own in-app overlay (§A.5), which a user can set without
touching an OS setting. Zeroing the duration is **not** sufficient, and that is the mistake to avoid:
the token layer already zeroes every `--dur-*` under the media query, which removes the animation but
leaves the compression, so the button still jumps to 97% instantly — which is the motion the setting
was turned on to avoid. The press stays legible through the tonal shift, which is not motion.

**B.12.2 The contrast invariant.** A filled control's label is `--on-<role>` on a `--<role>` fill, the
single most repeated colour relationship in the product. **Every filled pair must measure ≥ 4.5:1 in
every mode and contrast state; a mode-adaptive pair must reach ≥ 7:1 in dark; and the high-contrast
overlay must never narrow a pair.** All three are pinned by test in
`packages/ui/system/core/theme-engine.test.ts` — not asserted in prose, because this relationship
failed silently for months and reading the stylesheet never revealed it.

For a pair free to re-tone per mode, the mechanism is that the role and its `on-` partner must
**straddle mid-tone**. Dark `--primary` / `--on-primary` was once written `fg(55)` / `on(98)` — both
tones _above_ mid — and measured **3.57:1**. Worse, `fgTone` widens a fill upward in dark mode while
`onTone` widens an `on-` role downward, so the two **converged** under `data-contrast="high"` and
measured **1.75:1**: the accessibility setting made the product's most-used control unreadable, the
exact inverse of its job. `--secondary` and `--tertiary` were always written straddled and measure
**7.72:1**, and **14.55:1** under high contrast.

> **The brand pair is exempt from the 7:1 rule, because it is exempt from re-toning.** `--primary` /
> `--on-primary` are mode-invariant by product decision (§A.1.1): one colour in all four states,
> `#007680` on `#ebfdff`, **5.13:1** everywhere. A pair that cannot re-tone cannot straddle in both
> directions, so it is held to the AA floor and to the 3:1 non-text floor against every surface — not
> to AAA. Demanding 7:1 of it would be demanding the thing brand invariance forbids.

> **The accent pair is held to the whole rule — and it is fixed-polarity.** `--accent` /
> `--on-accent` (§A.1.2) re-tones per mode, so unlike the brand pair it owes all three clauses:
> **5.77:1** light, **7.39:1** dark (≥ 7:1), **7.07:1** and **11.63:1** under `data-contrast="high"`
> — wider in both modes, never narrower. Its polarity, however, does not flip with the theme (light
> fill, dark ink, always), so it neither straddles through `fg()` / `on()` nor blends toward
> `--btn-shade`: its widening is written per side, and its hover and press blend toward a
> mode-invariant LIGHT pole (§B.12.4). All four ratios join the pinned set in `theme-engine.test.ts`.

> **Ink is locked at the token layer, never by a literal.** Enforcing the invariant as a hardcoded
> `color: #fff !important` would break **§D.7.7**, the inverted conversion-lane CTA, which is itself a
> merge gate and works by overriding `--btn-on` — and after §A.1.1 it would be wrong on its own terms,
> since the brand ink is a resolved token rather than white. The base rule stays `color:
> var(--btn-on)`; the guarantee lives where it can be measured.

**B.12.3 Zero layout shift.** An interaction may move `transform`, `box-shadow`, `background`,
`border-color` and `color`. It may **not** move `padding`, `margin`, `inset`, `border-width`,
`block-size` or `line-height`. Those resize the box, and a control that resizes on hover drags its
neighbours with it — on a footer rig or a toolbar the whole row reflows under the cursor that is
trying to hit one thing in it. `transform` and `box-shadow` are composited and reserve no space, which
is why they lead the permitted set. A border that appears on hover is the common violation: give it a
resting `transparent` border of the same width and recolour it — which is a real channel, and the one
the brand button spends (§B.12.4).

**B.12.4 Tonal blending, its direction, and when a control cannot afford it.** Hover shifts the fill
by **8%**, active by **12%** — the §B.4 tint ramp (`--tint-soft` → `--tint`) reused rather than
re-invented, so a button's hover reads at the same strength as every other hover in the product.

The blend runs **toward `--btn-shade`** (`--on-surface`), and the direction is load-bearing. Mixing
toward the button's own ink walks both sides of the pair together: measured, a light-mode primary goes
from 5.13:1 at rest to **4.42:1 on hover and 4.12:1 pressed** — under the AA floor, in the state a
reader spends the most time in. `--on-surface` is the pole opposite the _page_, so for any role whose
polarity follows the theme it is also away from the ink, and contrast _rises_ with pressure:
`--secondary` runs 7.72 → 7.91 → 8.00 in dark and 6.13 → 6.69 → 6.99 in light.

**A fixed-polarity fill needs a fixed pole.** For `--accent` (§A.1.2) the ink is dark in every mode,
so in light mode `--on-surface` IS the ink's side and the default blend would walk the pair
together — the very failure the direction rule exists to prevent. `severity="accent"` therefore
points `--btn-shade` at a mode-invariant near-white (`N.tone(100)`, the value `--on-scrim` resolves
to), away from the ink in both modes, so the label's contrast rises with pressure exactly as it does
for a theme-following role. This is the pole Decision #153 built for the checkout commit, promoted
to the token layer.

`.ui-button--accent` sets `--btn-shade: var(--on-scrim)` with the standard 92% / 88% steps.
`--on-scrim` is `n1.tone(100)` = `#ffffff` in all four mode/contrast states and in the
pre-hydration defaults, so the pole cannot move with the theme. Measured, the label rises with
pressure in every state (rest → hover → press):

| State                | Rest    | Hover (92%) | Press (88%) |
| :------------------- | :------ | :---------- | :---------- |
| Light                | 5.77:1  | 6.31:1      | 6.62:1      |
| Light, high contrast | 7.07:1  | 7.74:1      | 8.11:1      |
| Dark                 | 7.39:1  | 7.97:1      | 8.31:1      |
| Dark, high contrast  | 11.63:1 | 12.17:1     | 12.44:1     |

So the button family has **three pole rules**, one per kind of pair: `--on-surface` for a
theme-following role, a zero step for the mode-invariant `--primary` (below), and the light
`--on-scrim` pole for the fixed-polarity `--accent`. The accent takes no border-channel hover — its
label has the headroom the brand's does not. A feature-local amber control blends toward the same
pole: the project board footer's `.brd-rig__action--accent` hovers and presses at
`color-mix(in srgb, var(--accent), var(--on-scrim) var(--tint-soft))` / `var(--tint)`, which
replaced a `filter: brightness()` hover this section bans.

**It is also the one place the rule below is waived, and the waiver is logged, not granted.** In
light mode the accent fill has no page-side headroom at all — it rests at 2.42–2.97:1 across the
light grounds — and lightening it for pressure lowers that further, to **2.71:1** hovered and
**2.59:1** pressed on `--surface` and **2.11:1** pressed on `--surface-3` (the full table is in
§A.1.2). That is exactly the floor-shaving the next paragraph forbids. The directive fixes the light
pole, so the docs record the departure as Decision #157 flag (b); the alternative before a human is
the brand's own treatment for the light branch — `--btn-mix-hover` / `--btn-mix-active: 100%` plus
the border-channel hover — with the light pole kept for dark, where the fill has the headroom.

> **A control with no contrast headroom spends a different channel — it does not spend the last 0.03.**
> The brand fill is mode-invariant (§A.1.1), so the single value it has must be readable under a
> near-white ink *and* findable on a near-black page at once, and in dark it clears both only just:
> 5.13:1 against its ink, **3.05:1** against `--surface-3`. Measured, neither direction is available.
> Darkening toward `--scrim` lifts the label but drops page visibility to 2.69:1 hovered and **2.51:1**
> pressed, under the 3:1 non-text floor. Lightening toward `--on-surface` lifts visibility but drops
> the label to 4.53:1 at 8% and **4.29:1** at 12%. The 8% step passes by 0.03, which is a rounding
> artefact rather than a margin. So `--primary` carries `--btn-mix-hover: 100%` / `--btn-mix-active:
> 100%` — a zero luminance step — and draws its hover on the **border**, a channel with no bearing on
> either ratio, at a width the base already reserves as `transparent` (§B.12.3). The press is carried
> by the scale compression every button shares. The rule this generalises: **when a state cannot be
> afforded in one channel, move it to another; do not shave a floor.**

`filter: brightness()` is **not** an acceptable substitute and was removed from the base button. It is
applied to the rendered element, so it darkens the label and the icon by exactly as much as the fill;
both sides move together, contrast is preserved only by luck, and the result cannot be measured
statically at all, because it depends on whatever the fill happened to resolve to.

> **Merge gate.** A PR is not mergeable if a pressable control gives no press feedback, or gives it by
> a means other than `transform`; if an interaction moves any box-model property; if a hover or active
> state lowers a filled control's label contrast or drops its fill under 3:1 against any surface it can
> sit on; if a filled pair measures below 4.5:1, if a mode-adaptive one measures below 7:1 in dark, or
> if any pair narrows under `data-contrast="high"`; if `--primary`/`--on-primary` differ between any
> two mode/contrast states; if `--accent`/`--on-accent` flips polarity in any state or blends its
> hover or press toward its own ink; or if press feedback survives either reduced-motion channel. The
> light `--accent` fill — **2.42–2.97:1** at rest across `--bg` and `--surface` … `--surface-3`,
> falling to **2.11:1** pressed on `--surface-3`, unchanged under high contrast (§A.1.2) — is a
> logged deviation from the 3:1 clause above and from §B.12.4's no-headroom rule (Decision #157
> flag (b)), not a precedent.

### B.13 Permission matrices — capability × role grids

A grant table (which role may do what) is drawn with `PermissionMatrix` (`@projective/ui/display`),
never a hand-built table of checkboxes or a wall of toggle switches. Capabilities are rows, roles are
columns, and each cell is one of four states:

| State         | Fill                    | Glyph (consumer `IconShell`) | `aria-*`                                   |
| :------------ | :---------------------- | :--------------------------- | :----------------------------------------- |
| `allowed`     | `--primary-tint`        | check                        | `aria-pressed="true"`                      |
| `conditional` | `--warning-tint`        | half                         | `aria-pressed="mixed"`                     |
| `locked`      | `--surface-2`           | lock                         | `aria-disabled`, `aria-describedby`        |
| `off`         | the row's own surface   | none                         | `aria-pressed="false"`                     |

1. **Two channels per state.** Fill and glyph always move together, so the state survives every
   colour-blind overlay and greyscale. The tints are the opaque U1 tokens mixed against
   `--surface-1`, the matrix's own ground — never a mix with `transparent`, never a hatch gradient.
2. **One tab stop.** A roving `tabindex` holds a single cell at `0`. Arrows move without wrapping,
   Home/End go to the ends of the row, Ctrl/Cmd + Home/End to the ends of the grid; Space/Enter
   fall through to the native button. Locked cells (a `locked` state or a `locked` column) are
   skipped for activation but stay focusable, because a reader must be able to hear why a grant is
   fixed. The rules are the pure `display/core/permission-matrix-nav.ts`.
3. **Semantics.** `<table role="grid">` with a required `<caption>`, `th[scope=col]` role headers,
   `th[scope=row]` capability headers and `th[scope=rowgroup]` group rows in the section-header
   register. Each `td` is the gridcell and holds ONE toggle `<button>` named "<capability> for
   <role>: <state>" (the APG single-widget cell) — not a `button[role=gridcell]`, which would nest a
   gridcell inside the `td`'s own and could not carry `aria-pressed`. Without `onToggle` the grid is
   `aria-readonly` and renders no buttons at all (§3 gate 11): the `td`s take the roving focus.
4. **Geometry.** Fixed table layout — every role column the same width, every cell at least
   `--fld-h-md` — so a state change never reflows. The header row and capability column are pinned
   on solid `--surface-1` inside a `ScrollArea` (`focusable={false}`, so the scroller adds no second
   tab stop); bound the root's block size for the header to pin vertically.
5. **Press and focus.** `:active` is `scale(var(--btn-press-scale-icon))`, `transform: none` under
   both reduced-motion channels. `:focus-visible` draws `--focus-ring-shadow` AND the hover tonal
   step; the app's no-focus-ring directive neutralises the ring (Decision #217 flag (n)), so the
   tonal step is what a keyboard reader actually sees.

---

## Part C — Component Library Architecture (`@projective/ui`)

A single, decoupled, **copy-paste-portable** umbrella package (`packages/ui/`) with **multi-export
sub-paths** declared in `deno.json` (`packages/ui/deno.json`). It plugs into external projects
verbatim because every component depends only on the token contract (Part A) — no app coupling.

### C.1 The seven taxonomies (authoritative roster)

| Sub-path                        | Components                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| :------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`@projective/ui/layout`**     | Box, Container, Grid (auto-fit `minChildWidth` + column-capped `maxCols`; `fit="exact"` keeps every track at exactly `minChildWidth` so a zoom-driven width scales cards continuously, Decision #223; `fill` swaps `auto-fit` for `auto-fill` so a short row keeps full-row track widths, start-aligned, instead of stretching — the profile Services row), Row, Column, Stack, AspectRatio, Divider, Separator, Panel, Fieldset, Toolbar, ScrollPanel, Splitter (+SplitterPanel), Stepper (+StepperPanel), MeterGroup                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **`@projective/ui/navigation`** | AppShell (optional `skipTo`: the shell's FIRST Tab stop becomes a "Skip to content" link to the page's main landmark, off-screen until focused, out of the shell grid — WCAG 2.4.1, Decision #144; `chrome` `"full" \| "focus" \| "bare"` — `bare` renders no top bar, rail or skip link for a page another surface frames, the catalogue buyer simulation, §D.6 / Decision #217 (j)), ShellFrame, ShellTopBar, ShellSidebar, MiddleNav (optional `panel` column — §D.4), PageCanvas (its body is the page's one `<main>` landmark, `id="main-content"` = `PAGE_CANVAS_MAIN_ID` unless `mainId` says otherwise, `tabIndex={-1}` so the skip link moves focus into it; a page inside it never renders a second `<main>`), NavItem (optional decorative `trailing` status slot — a lane's activity mark: a dot, or on the Project Details lane's top tier a plain figure (Decision #146) — removed with the label in a collapsed rail, its meaning carried by `dot`/`dotLabel` in the accessible name; `active` takes `"true"` for a SECTION link so a page beneath it announces `aria-current="true"` rather than `"page"` — Decision #133), BottomNav, Link, MiddleNavSplitter, MiddleNavPanel (the frame's drag-resizable right panel: leading-edge `role="separator"` handle with Arrow/Home/End resize, `min`/`max` clamp, persisted width hoisted to `.ui-middle-nav` as `--shell-panel-w`, `data-open` docking, own scroll body — §D.2), MobileMenu (overlay body-portalled at its `modal` stack slot), TreeNav, **Lane chrome** (LaneHead, LaneFooter(+Actions), LaneList, LaneBar, LaneTabs (a tab may carry an unseen-activity `dot` with its count spoken through a visually hidden `hint` — §D.1, a dot never a count; Arrow keys · Home · End move a roving tab stop, RTL-aware; an optional `panelId` gives each tab the id `{panelId}-tab-{value}` and `aria-controls`, so a section panel can name itself with `aria-labelledby` — the Members tab's Members · Requests · Invitations, Decision #136), LaneCreateButton (a lane's ONE primary action as the tier-2 monochrome pill — `.ui-lane-create`, the §B.8.1 tier-2 / §D.7.7 inverted pair `--on-surface` fill · `--surface` ink, the same tone as `<Button structural>`, so it swaps with the theme by construction; its pill stands as the lane surface's own shape (§B.8.4); the §B.12 zero tonal step with the border-ring hover in `--surface` and a scale-only press, removed under both reduced-motion channels; the label folds away in a collapsed splitter; `href` renders the same pill as a link — a create action that lands on another page is an `<a>`, never a button that assigns `location`, as `LaneIconButton`'s `href`. Every lane's create action takes it — New message (Messages), Create project (Projects), New listing (Catalogue), and the four-zone Teams / Businesses lane's New team · New business on the roster and Invite member in a console (only for an `invite_members` holder — otherwise no create at all; a button that opens the invite modal on Members, a link to `members?invite=1` from every other module; the collapsed workspace rail folds it to its glyph) — by Decision #228 (D), which closed #157 flag (i)), LaneSearch, LaneIconButton (`href` renders the same control as a link — a destination is an `<a>`, never a button that assigns `location`; hover and the engaged state `data-on` are a solid `--surface-2` fill with `--on-surface` ink, the engaged glyph taking a 16% `currentColor` fill; the `--accent` modifier keeps a `--primary` glyph and hovers to `--surface-2` — §B.4.2, no translucent wash; `fillWhenActive` draws the engaged state as a solid `--primary` / `--on-primary` fill instead, glyph unfilled (`.ui-lane-iconbtn--fill-active`) — for a link whose destination is a distinct mode, the lane footer's Edit project, Decision #163), LaneToggleRow, LaneSection(+LaneSections) (its header is the §A.4 section-header register — `--text-xs`, uppercase, `--fw-semibold`, `--tracking-wide` — Decision #220), LaneCollapseButton (stationary: docks to the `.ui-splitter` block-end/inline-start corner, centred on `--shell-lane-rail-w`, so render it in BOTH the expanded footer and the collapsed rail and the two share one hitbox), LaneEmpty — the shared middle-nav lane control set every lane surface composes), Menu (popup panel body-portalled at a stack slot), Menubar, MegaMenu, TieredMenu, PanelMenu, SlideMenu, ContextMenu (body-portalled at a stack slot, so a right-click over a Dialog/Drawer is neither clipped nor re-based and Escape closes only it; a right-click inside its panel never reaches the browser, and its `global` binding yields to a card surface that took the event — Decision #222), ActionMenu (the kebab/action-menu primitive — and, given a `surface` (the card or list item, a ref or getter), that entity's right-click menu too: `contextmenu`, the ContextMenu key and Shift+F10 on the surface open the SAME model at the pointer or under the focused element, with focus returned to its prior holder; editable text, a live selection, Shift+right-click and an inner surface keep the browser's menu; a right-click inside any open panel is swallowed; `trigger` is optional for a context-only surface such as an Explore card. `linkActionItems` builds the browser utility rows Open · Open in new tab · Copy link · Share · Save, only those that work, and `composeMenu` stacks row groups — every card or list item with actions adopts this, never a per-component `contextmenu` handler, Decision #222; a `Popover`-contract trigger render-prop opening a portalled `role="menu"` whose parent rows cascade into flyout submenus — every flyout its own `BodyPortal`, `right-start` flipping and clamping into the viewport, owned by its parent row so presses inside never dismiss; roving focus over readable rows (disabled ones included, their `disabledReason` in a Tooltip + `aria-describedby`), typeahead, Right/Enter/Space open onto the first child, Left/Escape close one level through the shared escape stack, Tab closes all; mouse hover-intent with a safe-triangle aim test, touch taps toggle; `danger`/`hint`/`emptyLabel` rows; pure logic in `navigation/core/menu-tree.ts`), Breadcrumb, Steps, TabMenu (tablist mode takes an optional `panelId`: every tab names that one `role="tabpanel"` in `aria-controls`, completing the WAI-ARIA tabs pattern — §D.9; an optional `id` fixes the root id so tab `i` is `{id}-tab-{i}`, letting a panel in another hydration root name its tab in `aria-labelledby` — the catalogue workspace's header band and canvas; every tab compresses on press, `scale(var(--btn-press-scale))` on `--dur-press`, removed under both reduced-motion channels — §B.12, Teams L2 review), TabView (+TabPanel), Paginator (alias Pagination)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **`@projective/ui/fields`**     | **Button** (4 variants `filled`/`outlined`/`text`/`link` × the 7 shared severities × 3 sizes, plus two Button-only severities on `ButtonSeverity` = `Severity | "accent" | "neutral"`, each typed to one variant: `accent` (`ButtonAccentTone`, `filled` only) is the amber terminal-commit tier on the global `--accent`/`--on-accent` pair, its hover and press blending toward the `--on-scrim` light pole — tier 1 is `severity="accent" rounded`, the pill coming from `rounded` (§A.1.2, §B.8.1 tier 1, §B.12.4); `neutral` (`ButtonNeutralTone`, `outlined` only) is the tier-4 utility action, `--on-surface` ink on a `var(--hairline-strong)` border with the `outlined` tint-soft hover (§B.8.1 tier 4). Neither is on the `Severity` union `Badge`/`Tag`/`Alert`/`Message`/`Toast` share (§B.8.3, Decision #157). Tier 2 is not a severity but the `structural` prop (`ButtonStructuralTone`, `filled` only — a type error with `outlined`/`text`/`link` or with `accent`/`neutral`): `.ui-button--structural` sets exactly the §D.7.7 inverted pair `--btn-accent: var(--on-surface); --btn-on: var(--surface)` over the carried ramp, with the zero tonal step and the border-channel hover (§B.8.1 tier 2, Decision #228 (D)). The tone contract lives CSS-free in `fields/types/button.ts` so `button.test.ts` can pin those type errors. Plus the `raised`/`rounded`/`iconOnly`/`fluid` modifiers — governed by §B.8 and its Button Interaction Matrix, which is what decides _which_ of those 90 typed combinations is correct; the anchor form — `<a class="ui-button" href>` — never carries a link underline, whatever link rule is in scope (`.ui-button:any-link:not(.ui-button--link)`, (0,3,0), over the prose's (0,2,1)), so no surface cancels one locally, Decision #279. `triggerRef` hands the native `<button>` to an overlay the Button opens (`ActionMenu` / `Popover`'s `api.ref`), because a `ref` on a function component stops at the component and never reaches the node the overlay anchors to and returns focus to — the `LaneIconButton.triggerRef` seam; the workspace header band's tier-5 kebab uses it, Teams L2. A `text` Button carrying `aria-pressed="true"` — a two-state toggle — draws its engaged state as the §B.4.2 solid step, `--surface-2` fill with `--on-surface` ink, held under the pointer (`.ui-button--text[aria-pressed="true"]`); the workspace footer rig's Org chart toggle uses it, so no feature paints a pressed Button itself, Teams L2 review), SplitButton, SpeedDial (its list is a `role="menu"` whose `<li>`s are `role="none"`, so each action is a `menuitem` the menu owns directly, and each hover label is `aria-hidden` — it repeats the action's `aria-label`, and a `tooltip` is not a child a menu may own — Decision #279), InputText (a typed `enterKeyHint`, so a form that walks forward on Enter labels the virtual keyboard's key `next`/`go` to match — Decision #153), Textarea (`minLength` forwarded, so a plain pre-hydration post is length-checked by the browser while what was typed is still on the page — Decision #276), **InlineEdit** (text that becomes its own field in place, at identical metrics — the owner-editing affordance), InputNumber, **NumberInput** (the direct-manipulation numeric field, sibling to `InputNumber` rather than a replacement for it: leading adornment · value · ghost `+`/`−` steppers, reachable four ways because the same control sets `3 seats` and `£250,000` and no one gesture is good at both. Type it; step it from a `-`/`+` pair sitting side by side in the trailing slot (`adjacent`, the default; `stacked` is the vertical column and `split` flanks the value), where a press fires once and a HOLD ramps after ~380ms and stops the moment the value stops moving, so a button held at its bound is not still running a timer; scrub it by dragging the leading adornment, logarithmically accelerated — `1 + gain · ln(1 + v/ref)^exponent`, capped — so a creep moves single steps while a flick covers orders of magnitude, through Pointer Lock for unbounded travel with a window-delta fallback that is honest about ending at the screen edge rather than continuing on the last known velocity; or spin the wheel over it, on a hand-attached non-passive listener because a wheel handler that cannot `preventDefault` scrolls the page out from under the field it is editing. The wheel has TWO gates, because the two gestures ask for different things: a plain wheel needs focus, since the event arrives merely because the pointer is over the field and a reader scrolling a long form past it did not ask to change anything; Ctrl+wheel needs only hover, since nobody holds a modifier and turns the wheel over one specific number field by accident. That second gate takes the browser's page zoom over any hovered field — a deliberate WCAG 1.4.4 trade, with zoom still reachable by keyboard and by the browser's own menu — and it fires on a whole-number field too, stepping by `step` rather than silently handing the zoom back while its neighbour steps. Left/Right jump to `min`/`max`, but ONLY on a fully bounded field — on a half-bounded one the caret keys keep the meaning every text field gives them. Typing is FILTERED live, on every `input` rather than on blur: digits, grouping commas, exactly one decimal point, and a leading sign only where the field's own `min` permits one — a field that accepts `abc` for as long as the reader is looking at it and then silently empties itself the moment they click away has taught them nothing about what went wrong. The filter is one left-to-right scan, which is what makes `sanitize(prefix)` a prefix of `sanitize(whole)` and so lets the caret be restored by counting survivors to its left; without that, correcting a typo in the middle of `1250.00` throws the reader to the far end of the figure on the very keystroke they used to fix it. Rejecting a character need not CHANGE the draft (`a` typed onto `12` filters back to `12`), so the element is corrected imperatively — a re-render that never happens cannot undo what the browser already painted. What survives the filter is then authoritative and is clamped but never snapped to the step grid: `step` is the size of a nudge, not a claim about which values are legal, and a currency field that steps by whole pounds must still accept `12.50`. Holding Ctrl (or Cmd) swaps the unit to `precisionStep` for EVERY gesture at once — arrows, wheel, steppers and drag — so "hold Ctrl to work in pennies" is one thing to learn rather than four; it is read live per pointer sample, so the modifier can be taken mid-drag to creep onto an exact figure, and swapping the unit IS the damping rather than a hardcoded divide-by-100 that only the drag would honour. It is ignored where `maxFractionDigits: 0` says the field holds whole numbers, since a fine step there produces a figure the next blur rounds away. A currency field puts its symbol in the leading adornment and NOWHERE else — the box holds the bare figure, because a symbol inside the string is something the reader has to type around, and `aria-valuetext` is formatted WITH the currency precisely because the visible text is not. The placeholder defaults to the field's OWN zero, formatted by the same formatter that renders the value (`0.00` at two fraction digits, `0` at none), so the hint shows the shape the box expects rather than a word describing the value's absence — a form of "Unpriced" / "Not set" / "No bonus" in boxes that only accept digits taught the reader nothing about what to type. The input is the `spinbutton` and carries the whole contract including `aria-valuetext`, so the steppers and the handle stay out of the tab order rather than adding three stops per field to a form that has nine of them. Every question of what a number BECOMES — clamp, snap, round, and the scrub curve — lives in the pure `fields/core/number-field.ts`, which `InputNumber` also folds onto: two numeric controls that each rounded their own way would eventually disagree about one figure, and these fields carry prices), InputMask, Password (the show/hide toggle is a real `type="button"` — inside a form, an untyped button is a submit, and Enter in the secret input performs implicit submission by clicking the form's FIRST submit button; `onKeyDown` is an explicit prop, as on InputText, for a form that moves focus on Enter rather than submitting), InputGroup(+Addon), FloatLabel (`over` · `on` · `in`; `in` grows the control to the shared `--fld-h-infield` two-line geometry so the floated label and the value never overlap — the one variant whose label stays inside the box and so composes with a `FormControl` hint row), IftaLabel (the same in-field geometry, pinned rather than animated), IconField(+InputIcon), Checkbox, TriStateCheckbox, RadioButton, RadioGroup (an option's `description` draws as a second, meta-register line under its label, the ring aligned to the label's first line, and is the radio's accessible DESCRIPTION — the input is named by its label alone (`aria-labelledby`) and described by that line (`aria-describedby`), never named by the two run together; `aria-labelledby` on the group names it from visible text, e.g. a `FormControl`'s `labelId`, in place of a duplicate `aria-label` — Decision #276), ToggleSwitch (alias InputSwitch), ToggleButton, SelectButton (an option's `description` switches the group to the **described layout** — two-line segments, label then a `--text-xs` `--text-secondary` line, on a wrapping grid at `--radius-lg` / `--radius-md` rather than a one-line pill, its column count the HOST's `--sb-described-columns` (unset, ≥ 9.5rem segments auto-fit); **`hrefFor(value)`** (single mode) renders the segments as links, so the choice works without JavaScript — server-rendered a plain `role="group"` of links with `aria-current` on the selected one and the selected treatment, hydrated the same radiogroup with each radio keeping its `href`: a plain press selects in place and is not followed, a modified or middle click still opens the link, Space and Enter select, and the host keeps the address bar in step with `history.replaceState` — Decision #276), Rating, Select (alias Dropdown — with `optionTemplate`/`valueTemplate` for rows that carry an identity rather than a word: a person's face, a workspace mark, rendered in both the panel and the trigger while `Option.label` stays the name typeahead matches. Opens CENTRED on the current value and keeps the active row in view through Arrow/Home/End/typeahead, so a long list never asks the reader to hunt for the value they already chose; the centring runs before paint, because a deferred one visibly paints the wrong end of the list and snaps. The panel caps itself at `min(--fld-panel-maxh, --float-available-h)` and scrolls internally, so a list longer than the space below the trigger loses its scrollbar rather than its last rows. **`panelWidth`** (Decision #156) — `trigger` (default: the trigger's width, never under `--fld-panel-minw`) · `auto` (as wide as the widest row, never narrower than the trigger, capped at the viewport less the collision inset; the positioner measures the rendered box, so a wide panel slides back on screen) · any CSS length — and **`panelClass`**, the one hook for styling the portalled panel. An option may carry **`description`**, drawn as a second, meta-register line and searched by the filter (typeahead still matches the label)), **CurrencySelect** (Decision #156 — THE currency picker: a `Select` whose trigger and every option draw the same `CurrencyLabel`, fed any `CurrencyChoice[]` such as `DISPLAY_CURRENCIES`; `panelWidth` defaults to `auto`, the filter turns on past eight currencies and searches code, name and country; used by Settings → Language & region, the checkout band, the project budget, the paid-call fee. `Select`/`CurrencySelect` have no `variant` prop: a borderless trigger is asked for with `class="ui-field--bare"` (as `MemberToolbar` does), and the checkout band does exactly that, with `panelClass="cko-cur__panel"` giving a solid `--surface-2` panel with `--on-surface` ink), MultiSelect, Listbox, **AutoComplete** (the WAI-ARIA editable combobox: `sections` render labelled `role="group"` blocks that Up/Down cross as one list; `loading` draws skeleton rows (after any rows already shown) and sets `aria-busy`; a `removable` section — or a per-row predicate — lets Delete or the row's hover/active-only remove control forget a row, announced through `aria-describedby`; `onSelect` replaces the commit (return `true` to keep the panel open for an in-panel action such as Retry); `freeText` binds the value to the typed text and Escape on a closed panel clears it; `openOnFocus` + `onOpen`; `emptyMessage={null}` keeps an empty panel shut; Home/End stay with the caret, Alt+Down/Alt+Up open/close, Enter with no active row closes and lets the form submit; a polite status line announces loading and the row count. `bare` + `inputClass` + `anchorRef` render the wrapper and control as `display: contents`, so the input sits directly in a host's own search pill and the panel aligns to the whole pill — the app's `SearchSuggest` typeahead uses this in the shell `NavSearchBar`, the hero `SearchBar` and the results `ResultsHeader`), Chips, TreeSelect, CascadeSelect, Slider (`allowCross` lets a range's two handles pass THROUGH each other — each keeps its DOM identity across the crossing so pointer capture and focus stay on the handle the reader is holding, and only its spoken role, "minimum"/"maximum", follows the value; a focus-gated wheel steps the focused handle, focus being the gate because the event reaches the track merely by the pointer resting over it, while Ctrl/Cmd + wheel needs only hover — the `NumberInput` two-gate rule; pressing the bare track jumps the nearest handle there AND keeps dragging it until release, so click-then-drag is one gesture — Decision #159), **RangeSlider** (alias `DualSlider` — the dual-thumb track over two adorned `NumberInput` boxes, one value set two ways and re-sorted whichever way it was changed, so typing a minimum above the maximum swaps the pair rather than refusing the entry; tab order is lower handle → upper handle → minimum box → maximum box, and the boxes are always the ORDERED pair), **StarRatingInput** (a half-precision star rating modelled as ONE `role="slider"` rather than a radiogroup — a value that steps by halves is a number on a scale, not one of five choices — with Arrow ±precision, PageUp/Down ±1, Home/End, pointer-position half previews in either writing direction, and click-again-to-clear; every star is the registry `star` glyph twice, an outline under a width-clipped filled copy, so the two cannot drift geometrically; the fill is `--ui-star-fill`, defaulting to the amber `--warning` ramp and re-tonable by the host, the rest state the neutral `--outline`), **MilestoneSlider** (a discrete, NON-LINEAR track of named stops equally spaced whatever their values — `Same day · 1–3 days · 1 week · 1 month` — composed over `Slider` so keyboard, wheel and capture are inherited; ticks beneath, the selected stop's label riding the handle, and `aria-valuetext` speaking the LABEL, never the index), Knob, SortControl, **ZoomSlider** (THE zoom control, Decision #223 — `zoom-out` / `zoom-in` lens buttons as ghost circles that step once on a press and repeat while held (`useHoldRepeat`, Ctrl/Cmd at press = a fine step), a muted rail with NO progress fill and a neutral handle, optional segment markers (`segments={0}` for none) and centre marker (`center={null}`), Ctrl/Cmd + wheel steps on hover; `onStep` keeps a non-linear surface's own step maths and `onValueChange(v, source)` tells a `"drag"` from a `"step"` so a host can ease steps; used by every view rig, the timeline rig, the crop stage and the inspector's image zoom), **SplitBar** (the proportional basis-point split — one rail of segments, solid ramp tones cycled from a supplied list of categorical tone TOKEN NAMES (default the six `--split-bar-tone-*` declared in `split-bar.css`), and a `role="slider"` handle between each pair of neighbours. Handle `i` trades integer basis points between segments `i` and `i + 1` ONLY, so the whole is exactly 10 000 bp by construction; a `held` segment locks both its handles and is never changed by a neighbour; each segment's `min` (default 0) is a floor. Pointer 1 bp; arrows 1% (Shift 0.1%); PageUp/PageDown 10%; Home/End to the handle's reachable ends; horizontal arrows invert under RTL. Each handle speaks the LEFT neighbour's share as `aria-valuemin/max/now` in percent with two decimals, `aria-valuetext` "<left> 42.50% · <right> 17.50%" and an `aria-label` naming both neighbours. Controlled — `value` + `onValueChange(next, "drag" \| "key")` per frame, `onCommit(next)` once on pointer release or key release, so a console marks itself dirty and never saves per frame; pointer capture, and Escape mid-drag restores the drag-start split. Widths ride `--split-bar-seg` through the `styleVars` seam as ProgressBar's does and are NEVER transitioned (a share must not be shown mid-animation); no segment gets a minimum visual width. Press is `scale(var(--btn-press-scale-icon))` on the handle (centred by margins so `transform` is the press alone), removed under both reduced-motion channels; below `--bp-md` or on a coarse pointer the hit area grows to 44px without changing the track's visual height. The legend is a `MetaLine` of tabular percentages — no chips. Every number lives in the pure, exported `fields/core/split-bar-model.ts`, whose outputs assert the 10 000 invariant; an unbalanced input (server drift) locks every handle rather than compounding it), DatePicker (a click anywhere on the field opens the calendar and puts focus in it — the first empty segment, else the first — while the icon toggles; the segments' separators follow `dateFormat` unless a `delimiter` of `/`, `.` or `-` overrides them; while open, Ctrl/Cmd + Left/Right steps a month, Ctrl/Cmd + Up/Down a year and Ctrl/Cmd + Shift + Up/Down five, from either the segments or the grid, the focused day travelling with the view so the grid keeps focus; over the panel a wheel notch steps one month and Ctrl/Cmd + wheel one year on a non-passive listener — wheel up increments, as on `NumberInput` — with a stream latched to ONE step until it pauses (50ms) or reverses, so a trackpad flick and its momentum are one step and a notch is exactly one; `wheelNavigation` defaults on in popup mode and off inline, and `DateTimePicker` opts its inline calendar in; a step that leaves no selectable day in view is refused as the chevrons are; Escape commits nothing, returns the view to the committed or typed date, and hands focus back to the field; the rules live in the pure `fields/core/calendar-nav.ts`. Enter on the segmented field opens the calendar only while the date is INCOMPLETE — a complete date is a finished answer, so Enter is left to the surrounding form's implicit submission or a wizard's next-field rule, and Space opens the calendar at any time; the month grid speaks the mini-month's visual language — one-letter weekday strip, seam-separated square cells on `--fld-opt-h`, whole-week hover — copied rather than imported, because `calendar.css` ships only through the Calendar island; its month/year controls are the package's own `Select`, the year one windowed over a `yearSpan` that defaults to ±100 years and opens scrolled to the current selection), **TimeTumbler** (a drum-roll time picker — two reels, three under `hour12`, drawn as a combination lock: pointer/touch drag with a release flick, wheel/trackpad, ▲/▼ controls, keyboard (Up/Down, PageUp/PageDown a quarter turn, Home/End) and DIRECT numeric entry, because the centre cell IS the `role="spinbutton"` rather than a display with a hidden input beside it. The selected cell is placed by LAYOUT and every gesture commits a whole number of cells synchronously — the reel’s transform carries only the sub-cell remainder — so the drum lands on the value the gesture asked for in a background tab, where rAF and every transition are frozen. `minMinutes`/`maxMinutes` narrow the REELS rather than rejecting a value afterwards, and a bound that misses the `minuteStep` grid is offered anyway, or a coarse step would make the earliest legal time unreachable; the faded neighbours are `aria-hidden` affordances, never content), **DateTimePicker** (ONE popover composing the inline `DatePicker` and the `TimeTumbler`, returning a single `Date` that carries both. `min`/`max` constrain the TIME on the boundary day and not merely the date, so a legal day can never be left holding an illegal hour; the composed calendar keeps its grid and loses its card, since a bordered card inside a panel is a box in a box (§B.4)), ColorPicker, FileUpload (`aria-describedby` reaches the drop zone, or the basic picker, so visible limits are heard as well as seen — Decision #276), FormControl (its render child also receives `labelId`, the visible label's id, for a control `<label for>` cannot name — a `role="radiogroup"`, a listbox — Decision #276), **FieldLegend** (the one-line explanation an asterisk needs), **status marks** (AlertMark/CheckMark/GateMark/BusyMark + `FieldMark`/`statusMark` — the §A.5 icon channel rendered into every `.ui-field__mark` slot), **SelectionCheck** (the circular selected-state mark — a hollow `--outline` ring, a solid `--primary` disc with an `--on-primary` tick when `checked`; `md` 20px for a tile corner, `sm` 16px for a list row; decorative, so the wrapping control owns `role="checkbox"` + `aria-checked` or `aria-pressed` — the catalogue card select and lane facet rows, Decision #220), **MoneyInput** (Decision #217 / catalogue §4.5 — `value` / `onValueChange` in integer MINOR units, `currency`, `min`, `max`, `locale`; `inputmode="decimal"`; what is typed is read with the locale's own group and decimal separators by string arithmetic, never `major × 100`, clamped and re-grouped on blur through `Intl.NumberFormat`; the currency mark sits on its locale's side as an adornment the input names in `aria-describedby`; `core/money-input.ts` round-trips en-GB / de-DE / ja-JP; its consumers are a business's Spend module (`/businesses/:h/spend` — the approval threshold, and each member's spending limit and per-purchase cap, Decision #246) and Billing module (`/businesses/:h/billing` — the balance floor, Decision #247); the app's other money fields, the catalogue editor included, are `NumberInput` in `currency` mode with the shared `MONEY_FIELD` preset and `moneyDigits(currency)` from `apps/web/utils/money-field.ts`), **NumberStepper** (− / + around a typed `role="spinbutton"` with `aria-valuenow/min/max/text`; ↑/↓ step, PageUp/PageDown big-step, Home/End go to the bounds, every value snapped to the step grid from `min` and clamped (`core/number-stepper.ts`); the buttons are pointer affordances outside the tab order), **DurationPicker** (a `SelectButton` of 15/30/45/60/90-minute presets plus "Custom", which reveals a `NumberStepper` over 5–600 in fives; a non-preset value reads back on Custom; the root is a size container, and below 30rem the presets wrap into a three-across track instead of overflowing a phone column), **TagCombobox** (ARIA 1.2 combobox — `aria-expanded` / `aria-controls` / `aria-activedescendant` over a body-portalled listbox of suggestions from an injected `suggest(q): Promise<string[]>`; Enter or comma commits, Backspace on an empty query removes the last tag, Escape closes then clears; case-insensitive de-duplication, `max` (default 10) and `maxLength` (40); the "7 of 10" count is inline `--text-secondary` meta, not a chip; keys are the pure `reduceTagCombo`). All geometry and every state read the `--fld-*` contract (§A.7) |
| **`@projective/ui/display`**    | **DataTable** (Decision #224 — the ONE table for every tabular surface, replacing the old `Table`, `FileTable`'s and `ListingsTable`'s markup: typed columns whose `type` picks the formatter — text (with a `lead` mark and a secondary line) · number · date (absolute or relative, the app may pass `formatDate`) · file (kind glyph, or a thumbnail at `thumbnailMinRowHeight`) · fileSize · image · status (one toned `Tag`, a lifecycle status, §B.11) · tags (middot text, never chips) · money (`MoneyView` micro; `income` = credit tone and `+`, `outgoing` = `−` in the deliberately neutral debit tone) · person (avatar + name) · people (`AvatarStack` + `+N`, names only in the label) · rating · duration · boolean · custom; selection none / single / multiple on the circular `SelectionCheck` in a `<button role="checkbox">` — Ctrl/Cmd toggles, Shift replaces with the range, Ctrl+Shift adds it, Shift on a check applies its new state to the range, Shift+Arrow extends, Space toggles, Ctrl/Cmd+A and Escape, the anchor an id (shareable as `selectionAnchor`); 3-state single or Shift multi-column sort (`sortCycle`, `firstSortDir`, `sortKey` speaks the server's vocabulary); per-column filter popovers (text with in-cell match highlight · range in display units · date range · set); pointer / keyboard / double-click auto-fit resize previewed through CSS variables; drag or keyboard reorder through `@projective/ui/dnd`; a column chooser; `columnState` persistence (versioned, unknown ids dropped); `priority` hiding from the declared widths as the container narrows, then horizontal scroll with `pinned` columns; row link (`rowHref`, a stretched anchor), `onRowActivate`, and `rowActions` on a kebab or meatball AND right-click through `ActionMenu.surface` (#222); `role="grid"` with a roving row tabindex; `client` or `server` data mode; sort, filters and selection each a signal, a controlled value or owned; the virtualizer in §C.5), **PermissionMatrix** (§B.13 — capabilities × roles, each cell `allowed` · `conditional` · `locked` · `off` carried by an opaque tint (`--primary-tint` · `--warning-tint` · `--surface-2` · the row's surface) AND a consumer-supplied `IconShell` glyph; `<table role="grid">` with a required `caption`, `th[scope=col]` roles (optional `meta` line, `locked` column), `th[scope=row]` capabilities (`hint`, `sensitive`) and `th[scope=rowgroup]` group rows in the section-header register; each `td` holds one toggle `<button>` named "<capability> for <role>: <state>" with `aria-pressed` true / false / mixed, or `aria-disabled` + `aria-describedby` when locked; one tab stop with arrow / Home / End / Ctrl+Home / Ctrl+End roving focus and no wrap; without `onToggle` it is `aria-readonly` and renders no buttons; fixed columns at least `--fld-h-md`, header row and capability column pinned on solid `--surface-1` inside a non-focusable `ScrollArea`; press `scale(var(--btn-press-scale-icon))`, none under both reduced-motion channels; pure model `core/permission-matrix-nav.ts`, stylesheet-free markup `components/PermissionMatrixGrid.tsx` so roles and names are unit-tested), TreeTable, Tree, DataView, VirtualScroller, Scroller, VirtualGrid, OrgChart, Timeline, GMap, AudioVisualizer, **VideoPlayer** (the ONE video surface, in two sizes — `compact`: Play ⁄ Pause + Mute as two ghost buttons in a corner; `full`: a glass transport bar with play · mute + an expanding volume slider · the clock · a seekable scrubber · a speed cycle, plus a centred paused-state mark. The `<video>` element is the single source of truth: every control writes to it and every piece of UI mirrors its events, so a host driving the element through `videoRef` — a carousel that lets only its active slide play — sees the controls agree with no second channel. Controls are hidden at rest and revealed by hover, keyboard focus or a tap (a second tap hides; a reveal on a playing video withdraws after a beat); the `full` bar also stands while the video is not playing. Every control stops propagation, so a press never follows a host's stretched link nor starts its swipe; a `children` slot layers a host's link and caption between the picture and the controls. Autoplay is always muted; an unplayable source (`#`, absent) renders the poster and NO controls; every colour is the scrim pair, on `::before` glass (§B.4.3), never a theme role; the fills are geometry that encodes a fact and are never transitioned. Reached through the narrow `./display/video` sub-path as well as the barrel), **MoneyView** (the single way a money figure reaches the screen: an inline, baseline-aligned, `tabular-nums` amount in the VIEWER's display currency plus, when the figure was priced in another, an always-visible estimate indicator carrying the origin — `£78.50 (~€90.00 EUR)`; never a hover, since the hover is unavailable on touch and this is the fact that says whether the number is exact. Resolves its currency through props → the request context → the host's ambient resolver → the shared `@preact/signals` store, so the SAME component is correct in a zero-JS server component and reactive inside a hydrated island. The minor units (pence, cents) sit on the SAME baseline as the major run — never raised — sized by `--minor-size` and faded by `--minor-fade` (§A.3, both widening under high contrast) through the per-step `--money-minor-size` / `--money-minor-fade` hooks: `hero` caps its tail at 0.42em, and `body`/`micro` keep it at full size and full ink because a split there is noise. Motion touches `opacity` only — never a property that carries the value), **Card** (`elevated`/`filled`/`flat`, default **`filled`**; a **non-interactive** container — `raised` is a transient hover/drag/focus response, never a resting state; all geometry from the §A.3 card rhythm tokens, governed by §B.9), **Avatar** (fallback chain `image` → `fallbackImage` → initials of `label` → `icon`; `fallbackImage` is a host's stand-in picture, painted as a CSS background layer OVER the initials — fetched only when shown, and a stand-in that fails to load leaves the initials visible; it covers both "no photo" and "photo failed to load". The app draws every PERSON through `UserAvatar` / `UserAvatarStack` (`apps/web/components/UserAvatar.tsx`, which fixes the stand-in to `DEFAULT_AVATAR_URL` and requires `label`) and passes `personFallbackImage(kind)` where one surface draws people and entities alike; enterprises, teams and group chats keep initials — Decision #127), AvatarGroup, **AvatarStack** (the data-driven cascading roster with a `+N` overflow chip and one composed a11y label; `fallbackImage` is forwarded to every face, never the `+N` chip), Badge (+OverlayBadge), RatingStars, Chip, Tag (a permitted container under §B.11.3, filled with a SOLID tonal step, never a translucent `--primary` wash, §B.11.6: `filled` is the role's own fill and `--on-<role>` ink; `subtle` is solid `--surface-2`; `outlined` keeps a role-coloured border on a transparent ground. `outlined` and `subtle` share the label ink `--tag-ink` = `color-mix(in srgb, var(--tag-accent) 60%, var(--on-surface))` — raw role ink measured 2.57:1 for the light semantic roles and 4.38:1 for `primary`, while the mix measures 5.00:1 at worst across all 7 severities × 4 mode/contrast states — light `info` on `--surface-2`/`--surface-3`), **MetaLine** (THE non-actionable metadata line, §B.11.2 — `items` as strings or `{ text, tabular?, title? }`, falsy entries dropped, joined by an `aria-hidden` middot `.ui-meta-line__sep`; Meta register in `--text-secondary`, `size` `sm` · `xs`, `as` `p` · `span` · `div`; no container, no border, no fill; renders nothing when every entry is falsy; the markup is the stylesheet-free `core/meta-line.tsx` so it is unit-tested), **PaymentCard** (+ **PaymentCardOption**, + `paymentCardArt`) — the CR80/ISO-7810 saved-card instrument with a real `preserve-3d` flip: three `aria-hidden` mask groups plus the REAL `last4`, and a back whose CVV box is `•••` **ornament** (never a value, never an `<input>`, no reveal affordance); art arrives as token expressions through `--pc-*` and geometry steps by `@container`, List, ListItem, Accordion (+AccordionTab), Carousel, Galleria, Image, **ProgressiveImage** (every card thumbnail's and every `Avatar` photo's `<img>`: the picture, else its BlurHash preview, else a neutral fallback slot — a zero-JS server frame whose ground colour is read from the hash's DC term on the server and whose full decode is painted client-side by ONE per-page watcher (`watchProgressiveImages`, document-level `load`/`error` capture + a `MutationObserver`, never a `src` rewrite), with optional `srcset` / `sizes` handed straight to the `<img>` so a processed image's WebP tiers are chosen by the browser (`sizes` is dropped when there is no `srcset` to size), reached through the narrow `./display/image` sub-path; `Avatar` renders its photo through it so a broken photo degrades to the same `fallbackImage`-then-initials a photo-less avatar shows; the pure decoder is `./display/blurhash`), **Flag** (Decision #156 — a circular national flag from an ISO 3166-1 code or `EU`, drawn inline from `flag-art.tsx` so it renders identically on every platform (regional-indicator emoji draw as two letters on Windows); `xs`–`xl` on the icon ramp; a hairline ring keeps a white field readable; a code without artwork falls back to its letters on a neutral disc; decorative unless given a `label`. The artwork carries the flags' own colours as CONTENT, like a brand mark, never through the token layer), **CurrencyLabel** (Decision #156 — the one way a currency is drawn: flag, then `[symbol] [code]` over the issuing country in the meta register; `currencyHeadline` drops the symbol when it IS the code), **VerificationStampBadge** (Decision #155 — the verification crest beside a name: `stamp` ∈ `id_verified` · `vault_verified` · `corporate_verified` renders the `seal-check` · `shield-check` · `keystone-check` glyph filled, its check knocked out to the call site's `--icon-knockout`, inked `--primary` · `--tertiary` · `--on-surface-variant` so SHAPE, not hue, tells the authorities apart; `none` renders nothing; `explained` (default) is a focusable crest with a portal `Tooltip` naming the claim and who checked it, `decorative` is `aria-hidden` for a crest repeated elsewhere on the surface; `celebrate` plays a one-shot `transform: scale()` stamp on `--spring-snappy`, none under either reduced-motion channel; call sites never re-ink it, and the app's owner-attribution wrapper is `VerifiedBadge` (`apps/web/features/explore/components/`), which takes the OWNER and resolves its crest through `ownerVerificationStamp` (Decision #227) — never a pill, §B.11.4), **TrustAdornments** (Decision #155 — earned trust signals as ONE Meta-register list: `--text-sm` · `--fw-normal` · `--text-secondary`, each an inline registry glyph + its claim, middot-separated by `aria-hidden` siblings, every claim explained by a portal `Tooltip`; no fill, no badge row; the caller passes them already ranked and capped — §B.11.2 / §B.11.4), **ShowcaseGrid** (island, Decision #217(e) / catalogue §4.4 — six 16:10 slots as an `<ol class="ui-showgrid">`, slot 1 the cover; empty slots are dashed `--surface-2` buttons, filled ones a still on `--surface-1` with Replace / Alt text / Remove / Move over a `--scrim` `::before` underlay (no `backdrop-filter`), always shown on `(hover: none)`; reorder MOVES one filled slot onto another (gaps stay gaps) by pointer drag through `@projective/ui/dnd` or by keyboard — Space lifts on Move, arrows step (RTL-mirrored), Space drops, Escape cancels, each step announced; `onReorder` fires only for a `legalMove`, so a video onto slot 1 is refused with its reason; `.ui-showgrid--hero` spans the cover 2×2 from `--bp-lg`; pure model `core/showcase.ts` incl. `reorderedPositions` = the catalogue reorder payload; the app wires it to the File Picker through `features/files/components/showcase/ShowcaseSlots.tsx`), **Charts** (`display/charts/`, Decision #217(m) — `AreaChart` (series as washed areas / lines on one shared y-axis, `invert` for a diverging series below zero, HTML ticks / gridlines / crosshair placed by the same ratios), `FunnelChart` (steps against the widest, each with share-of-first and drop-off as meta), `HeatmapGrid` (rows × columns on a five-step `color-mix(in oklch, var(--primary) var(--tint-*), var(--surface-1))` ramp, plus a `data-pattern` hatch of rising density under any `data-cvd` overlay), `Sparkline` (decorative inside a tile, the full contract standalone); `d3-scale` / `d3-shape` math only (`charts/geometry.ts`, moved from the wallet and generalised: `areaGeometry`, `funnelGeometry`, `heatSteps`, `sparkGeometry`, `timeAxis`, `chartTier`), no chart library; SVG at low density, escalating to native Canvas2D past an entity threshold or two measured over-budget updates (`useChartTier`), the canvas painting the same path strings through `Path2D` with colours resolved by the theme-bridge on a probe inside the figure, so a theme change recolours it; every chart is a `<figure role="group">` with a `<figcaption>`, a visually hidden data `<table>` (in a hidden wrapper, never on the table) and one focusable plot whose ←/→ move an `aria-live` readout; nothing tweens; colours via `--ui-chart-1…4` / `--ui-chart-accent` set on the chart or any ancestor), **StatTile** / **StatTileRow** (`ui-stat` / `ui-stats` — unboxed: tracked micro-label, the value at the display register in `tabular-nums` — a count, a server-formatted string, or a `MoneyView` element, which converts to the viewer's currency and takes the tile's weight and line box (`.ui-stat__value .ui-money__amount`), its origin disclosure at the tile's meta size, so a money tile reads at its neighbours' register (Teams C1's vault tile) — a signed delta as meta text with an arrow glyph so direction never rides on hue, an optional decorative `Sparkline`; one hairline per boundary, turning to the block axis below `--bp-sm`; the single implementation the workspace console re-tunes through `--ui-stat-*`), **The editorial reading family** (PUBLIC_ROUTES P0, Decision #273 — the shared reader under `/legal`, `/help`, `/changelog` and `/articles`; its AST, document core, anchors and TOC tree are `@projective/types/content`). Two doors: `./display/editorial` is the server-rendered half and imports no stylesheet and no `Icon`, so `deno test` renders a whole document to a string; `./display/editorial-islands` holds the two islands and `EDITORIAL_ICONS`; the barrel re-exports both. All of it is styled by ONE aggregate, `display/styles/editorial.css` (imported by `apps/web/client.ts` and by both islands, because the server half's own CSS import would reach no page). Geometry follows the FRAME, not the viewport: `.ui-doc` is a named inline-size container (`ui-doc`) and every step is a container query on the breakpoint tokens' values. **DocumentLayout** (an `<article>` named by its title, reading column `minmax(0, var(--measure))`; one column below `--bp-lg` with the TOC as a disclosure (`--bp-md`–`--bp-lg`) or a bottom-sheet trigger (below `--bp-md`); TOC rail `--doc-rail-w` | column from `--bp-lg`; the meta `<aside>` rail on the far side from `--bp-xl`, after the body below it; each rail reserved by the grid the moment its slot is passed, so hydration shifts nothing; `--doc-chrome-h` feeds every sticky offset and heading scroll margin: outside the L-shell it is the package hook `--chrome-pinned-h` (`styles/index.css`, 0px; a host shell sets it — `.guest-shell` to its scrolled pill's `--site-header-pinned-h` — so the package names no app token), and inside `.ui-page-canvas__body` it is the frame's own block inset `--shell-frame-inset-block` (the top bar, plus a middle-nav header band when one is mounted, 0 under bare chrome); the container makes `.ui-doc` the containing block of `position: fixed` descendants and a stacking context, so anything inside a document that must pin to the viewport or float above the page portals out (`Portal` / `BodyPortal`); a surface varies the look only through a modifier on the frame (`class`) or the prose (`bodyClass`) declared in the shared sheet — `ui-doc--clauses` (one `--hairline` above each section after the first) and `ui-doc--article` (body at `--text-lg` from `--bp-lg` of frame, and a quotation set as a pull quote in the display register — sans, `--text-xl`, `--fw-light` so it never reads as a same-size section heading, `--tracking-tight`, balanced, still on the prose's one inline-start `--hairline`, its attribution in the meta register); a numbered document widens the TOC-side gap to `--space-8` so its hung clause numbers clear the rail; it renders NO `<main>` — the shell owns the one main landmark and its skip link), **DocumentHeader** (eyebrow in the section-header register · `<h1>` at `--text-3xl` / `--fw-medium` / `--tracking-tight`, fluid on `1rem + 3cqi` · the lead in `--font-reading` · one Meta-register facts line, `tabular-nums`, `aria-hidden` middots between list items (each hung in the column gap before its fact and clipped by the list where a fact starts a line, so a wrapped line never leads with one) — each fact text or phrasing content, the list the flex row and each fact in-flow inline text (`.ui-doc-header__meta-item { display: inline-block; position: relative }`, the containing block of its hung separator; a flex fact dropped the space between a prefix and its `<time>`), a date as **DocumentDate** (`Updated <time datetime="2026-10-17">17 October 2026</time>`, formatted in UTC), empty facts skipped · a slot for a required disclosure), **DocumentBody** (sections as un-named `<section>`s — no landmark per clause — each an `h2` AnchorHeading, an optional summary line (label `tldrLabel`, default "In short") on one solid `--surface-1` step with no border, then the ContentRenderer; `sectionSlots(section, i)` adds a class, content after the heading and content after the body to any section; a numbered document's prose carries `ui-doc-body--numbered`), **Prose** (`--font-reading` at `--text-base` / `--leading-relaxed`, capped at `--measure`; §B.4.1 asymmetric heading spacing; prose `h2`/`h3` at `--text-xl`/`--text-lg` `--fw-medium`, split by size; links keep the reading ink and spend `--primary` on the underline, readable in every mode; code blocks, inline code and keys on `--surface-2`, a quote on one inline-start `--hairline`, a callout's 2px rule in its tone hue, and under `data-contrast="high"` the callout's tone word takes the full `--on-surface` ink), **ContentRenderer** (+ **InlineContent** — the closed AST to semantic HTML: `p`, `h3`, nested `ul`/`ol` (an ordered list's `marker` — decimal · lower-alpha · lower-roman — is its `<ol type>`), a `blockquote` (attributed: a `<figure>` whose `<figcaption>` names the person outside the quoted words), `pre > code` keyboard-scrollable, `figure` + `img` with intrinsic `width`/`height` and lazy decoding, `callout` as `role="note"` that always prints its tone WORD beside the hue, `table` with `scope`d headers in a keyboard-scrollable wrapper that is a named `region` only when captioned, `dl` of `dt`/`dd` pairs; runs `<strong>` · `<em>` · `<code>` · `<kbd>` · `<a>`; a bare list's `h3` ids come from an optional shared `registry`, so a feed of bodies never repeats one; every string a text child — no `dangerouslySetInnerHTML`, no markdown parser), **AnchorHeading** (the heading's text is a real `<a href="#id">` to itself; the decorative link glyph appears on hover / `:focus-visible` and at rest on `(hover: none)`; optional clause number in `--font-mono` / `--text-secondary` / `tabular-nums`, hung in the gutter from `--bp-md` of frame in a numbered document), **TocNav** / **TocList** (one `<nav aria-label="On this page">` holding the rail list, a native `<details>` disclosure — the no-JS fallback at every width — and the sheet trigger, the last two at one row geometry; nested `<ol role="list">`, the current entry `aria-current="location"`, marked by `--fw-medium` + a 2px `--primary` inline-start bar the hairline track reserves `transparent`, each label stacked in one grid cell with an `aria-hidden` copy at `--fw-medium` so the heavier weight never re-wraps it; a `TocEntry` with `href` is a cross-page link (a rail of documents), never spied, `aria-current="page"` when `current`; clause numbers in `--font-mono`; Decision #273 flag (d)), **TableOfContents** (island — scroll-spy by `IntersectionObserver` re-reading every heading's position on each callback, so a long jump is still right; the current entry is kept scrolled into the rail, which is its own scroll container from `--bp-lg`; the sheet is a bottom `Drawer`, choosing an entry closes it, scrolls, writes the hash and hands focus to the heading's link through the Drawer's `returnFocusRef`), **ReadingProgress** (island — a zero-height sticky anchor at `--doc-chrome-h` with a 2px bar filled by `transform: scaleX(var(--doc-progress))`, starting past the page canvas's `--frame-radius` corner inside the L-shell, `role="progressbar"` + `aria-valuenow` / `aria-valuetext`, hidden and withdrawn from the accessibility tree until measured and on a document that scrolls under half a viewport), **PrintStylesheet** (`editorial-print.css`, `@media print`: every element that neither contains, is, nor sits inside the `.ui-doc` is not printed — chrome removed structurally, no app class named — the TOC, progress and buttons hidden, body in `--font-reading` at the `--doc-print-body` token (11pt), external links print their URL, headings / tables / figures avoid page breaks, `Canvas`/`CanvasText` under a forced light scheme) and the glyph seam `EditorialGlyphContext` (the server half reads its decorative glyphs from context; `EDITORIAL_ICONS` supplies the registry set) |
| **`@projective/ui/feedback`**   | Message, Messages, Alert, Banner, **InlineNotice** (the unboxed edge-of-region status line — one sentence in the meta register plus at most one underlined `Button --link` action, no fill and no border, so a note appended under a list never reads as one more item in it; `busy` for an in-flight retry; the offline stall notice at the loading edge of every paginated list is this), **ErrorBoundary** (contains a client render or lifecycle failure to the subtree that threw: `onError` reports it, `fallback(error, reset)` replaces it, and the default fallback is an assertive `InlineNotice` with a "Try again" action that re-mounts the children. Server render errors go to the app `_error` route instead), **Ribbon** (the viewport-pinned bottom status strip for a fact about the whole SESSION — offline, a maintenance window — controlled and network-agnostic, `--on-surface`-on-`--surface` inverted so it clears ≥ 14:1 in every theme state by construction; enter/exit on `transform`/`opacity`, the closed state `visibility: hidden` after the exit so a withdrawn action is out of the tab order; **the box is always mounted — it is the `role="status"` live region — and EMPTY while hidden**: its glyph/statement/action are presence-gated (`usePresence`, exit grace `--dur-medium`), present only while visible or on the way out, so a closed strip paints nothing even before its island-carried stylesheet lands — a hidden strip that kept its words relied on CSS timing and painted them as a plain line of text at the bottom of every page for the window before the sheet applied; while open it writes `:root[data-ribbon="open"]`, which sets `--ribbon-inset` — the room every bottom-pinned surface [the middle-nav footer band, bottom toast anchors, the page tail] adds to its own offset so it moves WITH the strip rather than under it; sits at `--z-nav`, above sticky bands and below every backdrop; stacks above the mobile bottom nav when one is present), Toast (`position` — nine anchors, each resolved with logical insets so it mirrors under RTL; `bottom-start`/`-end` &c. are accepted spellings of the same points; the three bottom anchors clear `--ribbon-inset`), Dialog (`footer`/`footerTemplate` — the same pinned, safe-area-padded slot as Drawer's, §B.10.8; `role`, `initialFocusRef`, `labelledBy` — names a templated dialog by its own title rather than its whole header region, `backdropIntensity` — `standard` | `heavy`, see the Backdrop row), DynamicDialog, ConfirmDialog (`role="alertdialog"`, opens on the reject action), ConfirmPopup (`label`), **CommitReview** (the review step before money moves — `title`, `total` (the server-formatted figure), `rows` (`{label, value, tabular?}` facts as a hairline-separated description list: From · To · Balance now · Balance after), `consequence`, then ONE commit: `commitLabel` + `onCommit` (async, resolves `null` to close or the reader's sentence for a refusal, said inside the review as an assertive `InlineNotice` with the commit relabelled "Try again") or `commitHref` (a hand-off commit, an anchor in the amber pill's classes); with neither, only a text Close. `role="alertdialog"`, focus opens on the action group so the text **Cancel** is the first stop and the tier-1 accent commit the last; nothing dismisses it while the commit is in flight; a bottom sheet below `--bp-md`. A refusal hands focus back to the commit, now _Try again_, or to the lone Close — the commit was disabled in flight, so the browser had dropped focus to the document (`commitReviewRefocusIndex`, unit-tested). `ConfirmDialog` cannot host it — its accept is never the amber pill, Decision #157 (o). Its body is the stylesheet-free **CommitReviewBody** — the wallet's movement dialog composes it in its own frame and imports `commit-review.css` itself, never through the barrel's side effect — and the actions contract is the pure `commitReviewActions` and the dialog contract the pure `commitReviewDialog` (role, initial focus, what dismisses it while sending), all unit-tested. Every figure — the total, each `tabular` value's run (`__figure`) and the commit's amount (`commitFigure`, rendered by the stylesheet-free **CommitLabel** as a tabular `__commit-figure` run after the verb: _Pay_ · _US$640.00_, dropped while it reads "Try again") — is isolated left-to-right (§A Figures); Decision #247), Drawer (alias Sidebar; `footer` — actions pinned below the scrolling body behind one `--hairline`, safe-area padded, rendered by the stylesheet-free `DrawerRegions` so the contract is unit-tested; width defaults to `--drawer-w`, §B.10.8; the header basket drawer composes it with the app's `BasketSwitcher` — a grouped `Select` of every owner's baskets and lists, each row's subtotal through `MoneyView`, "New list" last, `compact` icon-only trigger for the checkout band below `--bp-md` — in `header`, and totals + View all baskets + Proceed to Checkout in `footer`, §D.1 / Decision #70(k)), Tooltip, Popover (alias OverlayPanel; `label` promotes it to `role="dialog"` — an unnamed dialog announces worse than no role; `initialFocusRef` lands focus on a chosen element — a picker opens on its CURRENT choice; under EITHER reduced-motion channel — the OS query or `:root[data-motion="reduced"]` — it appears in place with no slide and no fade), ProgressBar, ProgressSpinner, ProgressRing, Spinner, Loader, **Skeleton** (`shape` rect · circle · text, `lines`; `animation` `pulse` · `wave` · **`shimmer`** — a `--surface-2` band swept on `transform` across a `--surface-1` block, reversed under RTL, Decision #174; every treatment is a static block under EITHER reduced-motion channel; Explore composes it as `CardSkeleton` / `CardSkeletonGrid` for the Continue rail and the results refresh)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **`@projective/ui/overlay`**    | Backdrop (dismisses only on a press that starts and ends on the scrim itself, via the exported `useBackdropPress` + pure `isDismissPress` — reuse it for any bespoke dismiss surface; tint/blur fixed by `--scrim`/`--scrim-tint`/`--scrim-blur`, no `blur` prop; ONE named second tier, `intensity="heavy"` → `--scrim-tint-heavy`/`--scrim-blur-heavy`, chosen by what the modal MEANS — "the page beneath cannot be used right now", the offline interstitial — never by taste, §B.10.2), Overlay (modal band + `inert` background), HoverCard (stack-managed, Escape-dismissable per WCAG 1.4.13), Portal, BodyPortal, DraggablePopover (non-modal draggable/resizable window; a PASSIVE `useOverlayStack` claim that `raise()`s on touch and never takes `isTop`, §B.10.3) (+ `usePresence`, watchdogged enter), **MoneyFlowPopover** (the developer money-flow debugger composed ON DraggablePopover — glass on a `::before` underlay, a four-state capital meter whose segment widths are set from the value and **never animated**, a purchase → escrow → release → disburse simulator, a balance override, a before/after wallet preview and an ordered flow trace; **fully controlled, zero fetch, zero money arithmetic** — see the portability note below), **the modal STACK** (`createModalStack` + `useFrameState`/`useFrameScroll`/`bindFrameSignal`) — a replace-in-place router for a chain of modals: only the TOP frame renders, so a ticket → review chain composites ONE blurred backdrop instead of two, and each frame's live UI state (tab, inputs, scroll offsets) is held in a deliberately **non-reactive** cache so popping back restores the surface the viewer left rather than a fresh one (§B.10.9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **`@projective/ui/utils`**      | CommandPalette (body-portalled at a `modal` stack slot), Kbd, ScrollArea (`focusable={false}` drops the viewport's tab stop when its content is itself focusable — a roving-focus grid such as `PermissionMatrix`), ScrollTop, EmptyState (`heading` `1 \| 2 \| 3` renders the title as that heading instead of a `<p>`, looking the same, only when the empty state IS the page's subject — the root error page's `<h1>`), BlockUI, Inplace, Terminal, Captcha, FocusTrap, Defer, AnimateOnScroll, Ripple                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **`@projective/ui/dnd`**        | DndContext, Draggable, Droppable, SortableContext (alias SortableContainer), DragOverlay, **DropIndicator** (the landing seam a sortable list draws at the insertion point — the ghost says _what_, this says _where_) (+ hooks `useDraggable`, `useDroppable`, `useSortable`, `useDndMonitor`, `useDnd`; detectors `pointerWithin`/`closestCenter`/`defaultCollision`/`nextInDirection`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **`@projective/ui/kanban`**     | KanbanBoard, KanbanColumn, KanbanCard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **`@projective/ui/calendar`**   | Calendar (island — `hideHeader`/`hideSidePanel` for a host that owns those regions itself, TRACKED `view`/`focus` + `onViewChange`/`onFocusChange` so an external switch and trail can drive it, a `headerActions` slot, and a `renderSource` callback the consumer supplies its own provider marks through), CalendarHeader (period trail · nav · search · filter toggle · the consumer's `actions` slot), MiniMonth, AvailabilityPanel, TimeGrid (infinite Week), DayTimeline (infinite Day), MonthGrid (paginated), EventBlock (+ the stacked `sources` provenance marks), NowIndicator, OverlayScrollbar, **GridCanvas** + **GridProbe** (the canvas layer, at two depths. The Day `DayTimeline` stays HYBRID — the canvas paints its lattice, its events stay HTML cards. The Week `TimeGrid` is a PURE immediate-mode canvas: `.cal-tg__viewport` holds one `aria-hidden` `<canvas>` and NOTHING else, and the hour scale, day columns, working-hours bands, blackout hatch, every event card, the current-time rule, the drag preview, the period markers, the depth gauge and the return-to-present pill are all pixels from ONE ordered pass over one `GridScene`. There is no scroll container — `useCanvasViewport` owns the offset as a signal and re-implements what the native scroller was quietly providing (the three wheel `deltaMode` units, Arrow/Page/Home/End, clamping, and `reveal` in place of `scrollIntoView`) — and every gesture is resolved by mapping a pointer into scene coordinates and asking `hitTest` what is there. Because a canvas is opaque to assistive technology and to the keyboard, the viewport ships with a PARALLEL ACCESSIBLE LAYER as its SIBLING, which is the merge gate rather than a nicety: the same events as real focusable controls carrying the same names and firing the same handlers, a Return-to-now and a keyboard create ahead of the list (a control reached after twenty cards is a control lost), scroll-into-view when focus lands off-screen AND a hold on the focused card's block so paging cannot unmount the element under focus, and an `aria-live` region naming the visible range — quantised to the hour, so it speaks once per hour crossed rather than once per pixel. Its controls are visually hidden, so none of them can show a focus ring of its own: the canvas paints one for each — the focused card, the pill, and the whole viewport for the scroll region — TWO-TONE (halo inside, ink outside), because one tone cannot clear 3:1 against both an accent-tinted card fill and the grid, and a canvas ring cannot be fixed later by a cascade. There is no scroll container for a browser to pan, so the viewport declares `touch-action: pinch-zoom` and owns the one-finger drag: a finger SCROLLS, a tap activates, and pinch stays with the browser so page zoom survives. On a canvas card the `sources` channel becomes a COUNT — one neutral dot each, "on N calendars" in the accessible name — since a consumer-supplied brand VNode cannot be painted; a masked card carries neither. A canvas cannot read a custom property, so every colour, width, radius, font and box is still authored in `calendar.css` against `var(--*)` on a hidden swatch subtree and read back RESOLVED — which is what makes `color-mix()`, the generated palette and the a11y overlays reach a canvas at all, `data-font` included now that the canvas draws type — re-resolved on any root theme write and on any change to the ACCENT SET, which is a property of the data rather than of the theme; the swatches opt out of the global crossfade so a read is always the final value and never the one a frozen animation clock is passing through. WHAT THE PIXELS COST: canvas text has no find-in-page, no selection and no native text cursor, which is why the hour LABELS stayed DOM while the backdrop was hybrid and why the accessible layer is not optional now that they are not) (+ hooks `useCalendarViewport`, `useCanvasViewport`, `useNowTick`, `useOverlayScrollbar`, `useGridCanvas`; the pure `paintGrid`/`paintScene`/`toCanvasColor` and the pure scene geometry `buildSceneEvents`/`hitTest`/`eventRect`/`gaugeGeometry`/`eventAccessibleName`, all unit-tested with no DOM — once a card is pixels, only arithmetic can tell a click from a miss; the PLACEMENT engine `packDayEvents`, which since 2026-08-22 answers a resting day and an EXPANDED cluster differently and deliberately. AT REST every overlap cluster collapses to ONE merged card carrying a `+N` chip, whatever the relationship between its members — the previous behaviour gave three different answers to "these two overlap" (a contained pair nested, a plain straddle folded, a demoted nest split), which is two too many for a reader to hold. PRESSING that card, or its chip, expands the cluster AND opens its list popover in one move: the expansion is DERIVED from the open popover rather than held beside it, so a click outside, an Escape and a committed pick all collapse it for free and the two facts cannot come apart. An expanded cluster is laid out FLAT — every member a root, in lanes — and each member is drawn `bare`: its fill and its shape, and no text at all. That is a measurement rather than a preference: `NEST_INSET_FRAC` leaves a container visible as two 6% strips, about 7px in a real column, which is not something a reader can identify or point at once the text is gone; and N titles clipped to three characters each is noise where the reader is trying to read a SHAPE. The names live in the list beside the grid, at a full line each, and hovering one there rings its block (`highlighted`) while every other card recedes (`recede`, resolved from `--cal-dim-drag`/`--cal-dim-focus` so the DOM Day card and the Week canvas step back by ONE number). `bare` is presentation only — the card keeps its rect, its hit target and its whole accessible name. The containment engine is preserved behind `PackOptions.merge: false`, which restores the pre-2026-08-22 resting layout wholesale; no app surface passes it today. A zero-duration event (`end === start`) is a DEADLINE and survives layout as an INSTANT — admitted rather than filtered out, given no synthetic duration, and drawn as a pin (rule + kind chip + timestamp pill) rather than as a box, because a deadline drawn as a plausible twelve-minute meeting is worse than one drawn as nothing; the total `dayWindow`; the lever physics `core/chrome.ts` (`joystickVelocity`/`leverScrollDelta`/`leverBall`/`handleLength`) — the scroll handle is a RATE control, not a position mapping: pressing it morphs the pill into a circular joystick ball and dragging scrolls at a velocity proportional to displacement from the GRAB ORIGIN, which is what lets the gesture outlast a finite track on an axis that is effectively infinite, and the handle's LENGTH encodes the share of one PERIOD visible at the live zoom rather than a proportional thumb of a nineteen-year axis (a hair nobody can grab). `EventPopoverLayer` is the HTML popover layer floating OVER the canvas — `BodyPortal`'d so it escapes the canvas viewport, the lane's `overflow: clip` and any glass ancestor's `backdrop-filter` re-base, positioned by `useFloating`'s collision model, with a single-event view, a two-step stack list → detail flow whose rows publish a `highlight` channel back to the grid (the panel is body-portalled, so travelling into it fires the viewport's own `pointerleave` — one hover channel would collapse the highlight on the very card the row stands for), and a quick-create composer that leaves a live DRAFT block on the grid: dashed, grabbable, draggable and resizable from either edge while the composer tracks its timestamps, with Enter committing on defaults, Escape cancelling and removing it, and `onExpandCreate`/`compose` carrying every entered field to a host's full surface and back again. The draft is painted pixels rather than an element, so overlay containment cannot see it — the grid raises a `pointerGuard` for the duration of a press that lands on it, from a document capture listener registered ahead of `useDismiss`'s, or the panel would close under the finger about to drag it. While ANY popover is open a press on empty grid only dismisses (§2 of the redesign): the create gesture is suppressed for that press, because "get this out of my way" must not produce another thing in the way; a canvas rect is not a DOM element, so the anchor is a zero-size portalled proxy and ownership is tethered by a second inline one (`overlay-registry` derives parentage from where a TRIGGER sits, not from where a panel renders). Zoom is CURSOR-ANCHORED — `zoomAnchor(viewportY)` pins the timestamp under the pointer and `zoomTo` interpolates through it, re-solving the offset in closed form on every frame so the fixed point holds for the whole journey and a wheel burst compounds instead of collapsing to one notch; timezone-explicit `calendarTime` matrix utils; `CALENDAR_KIND_LABEL`/`calendarKindLabel` — the ONE plain-language name per event kind, owned here because `packages/ui` may not read the Zod SSOT, so a map owned there could never reach the engine's own filter chips: every surface that names a kind reads this one, and a masked block still names none of it); **AvailabilityScheduler** (compound, plan §5.4 of `flows/CATALOGUE_REBUILD.md` — `Root` · `PresetBar` · `Toolbar` · `WeekCanvas` · `MonthPreview` · `RuleList` · `RuleEditor` · `Issues` · `ShortcutSheet`; engine INJECTED as `SchedulerEngine`, block `ui-avsched`; see "AvailabilityScheduler additions" below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **`@projective/ui/gantt`**      | Gantt (island — the Timeline / Gantt engine: the HTML `GanttTaskList` beside the HTML tiered `GanttHeader` over ONE immediate-mode `<canvas>` stage, driven by a `@preact/signals` store (`createGanttStore`: `scrollX`/`scrollY`/`pxPerDay`/`rowScale`/hover/focus/fly, the computed `tier`/`visibleRange`/`contentH`, cursor-anchored `setZoom`, `fitRange`, `centerOn`) so a pan, a zoom or a hover moves the pixels with no VDOM render in the path. Generic, CONTROLLED, zod-free: `GanttLane[]` + `GanttItem[]` (a `bar` is a span, a `milestone` is an instant drawn as a diamond — a point in time has no width that could honestly encode a duration), `onOpenItem`/`onCreateRange`/`onQuickCreate`/`onMoveItem`, a host-owned `zoom` signal, a one-shot `commands` channel (`today` · `fit` · `center`) and `onTierChange`. The time axis is linear (`x = (ms − origin) / DAY × pxPerDay`, `core/time-scale.ts`): seven zoom tiers from `year/quarter` down to `day/hour`, ticks generated through the calendar's own zoned-time matrix (DST-correct — a 23h day is 23h wide), `snapTo` at the live tier's grain, `fitZoom`, weekend bands, `AXIS_LIMIT_DAYS` two centuries each way. Rows are virtualized by lane window (`core/layout.ts`: `laneTop`/`laneAtY`/`laneWindow`; the hovered lane grows by `expandPx` and every lane beneath shifts by exactly that in the DOM list AND the canvas), `hitTestItems` is pure arithmetic over the same `itemBox` the paint used (once a bar is pixels, only arithmetic can tell a click from a miss), `dependencyPath` draws the elbowed link. GESTURES (§Part B): wheel scrolls time, Shift+wheel lanes, Ctrl+wheel zooms the time scale anchored on the cursor (the anchor is captured once and held for `ZOOM_ANCHOR_HOLD_MS` so a trackpad burst compounds around one point), Ctrl+Shift+wheel scales the rows; Ctrl-drag or middle-drag pans in 2D with momentum; a middle CLICK enters FLY MODE (a rAF velocity pan by pointer distance from the origin — the calendar's `joystickVelocity` reused — exited by any press, Escape, wheel or blur); Left/Right scroll time (Shift: a page), Ctrl+Up/Down scroll lanes, Up/Down move between items, Enter opens the focused item's popover, Escape closes; a left-drag on empty lane space creates (snapped, dashed draft, absent under `readOnly`); one finger pans, two fingers pinch-zoom the time scale (`touch-action: none` on the viewport — this engine owns both gestures, see the flag in Decision #91) and a tap opens. Hovering an item whose label or meta was TRUNCATED expands its lane (a spring on `expandPx`; the paint report says which items truncated, so the lane grows only when growing reveals something). THE THEME BRIDGE (`core/theme-bridge.ts`, SYSTEM_ARCHITECTURE §Charts): every colour, width, radius and font the canvas draws is authored in `gantt.css` against `var(--*)` on a hidden swatch subtree (`GanttProbe`) and read back RESOLVED through `getComputedStyle` — per-accent swatches `[data-accent]` for every token the DATA names, so a `color-mix()`, the generated palette and the a11y overlays reach the canvas; re-resolved on any root theme write and on any change to the accent set; `resolveCssColor` evaluates an arbitrary expression, `cssColorToHex` returns the numeric form a WebGL tier would take. A PARALLEL ACCESSIBLE LAYER is the viewport's sibling (the same items as real focusable controls, a live region naming the visible range, Return-to-today), visually hidden, with the canvas painting a two-tone focus ring for whichever has focus. The built-in popover (`GanttPopover`) is `BodyPortal`'d over the canvas with the two-proxy anchoring the calendar's layer uses (a portalled positioning proxy + an inline ownership tether); below `--bp-md` it becomes a bottom-sheet `Drawer` — the brief's `MobilePopup`, realised with the primitive the package already had. Portable + token-only; the consumer maps its own Zod projection into the shapes (the project timeline, the ticket modal's stage run and the calendar's Timeline view all mount the ONE engine) (+ hooks `useGanttViewport` [gestures · momentum · fly · zoom spring · pinch], `useGanttCanvas` [sync paint in a layout effect, ResizeObserver, palette invalidation]; the pure `paintGantt`, `readGanttPalette`, `ticksFor`/`tierFor`/`xOfMs`/`msAtX`/`zoomedScrollX`/`fitZoom`/`snapTo`/`weekendSpans`/`durationLabel`, `itemBox`/`hitTestItems`/`laneWindow`/`dependencyPath` — unit-tested with no DOM, 43 tests incl. DST days and zoom-anchor invariance across twenty notches) |
| **`@projective/ui/icons`**      | Icon (registry glyph by canonical name), IconShell (the base every feature-owned glyph module renders through), `ICON_PATHS` registry + `IconName` union — the single icon contract (§B.7). Token-driven via `--icon-2xs…--icon-xl` + `--icon-stroke`; one 24-unit grid; `vector-effect: non-scaling-stroke` holds one rendered weight at every size. `data-filled` floods the whole glyph; a glyph may nominate ONE `data-knockout` part, which stays stroked in `--icon-knockout` (default `--surface`) so a solid badge with a cut-out symbol is expressible without the glyph naming a colour (§B.7.8) — the three verification crests (`seal-check` · `shield-check` · `keystone-check`, Decision #155) are the ones that use it. The registry's 24-glyph **Inspector & canvas tools** group (`zoom-*`, `rotate-*`, `flip-*`, `print`, `move`, the 3D-scene and text-view marks; Decision #161) is listed in §B.7.1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **`@projective/ui/editor`**     | RichTextEditor — a stripped, token-themed QuillJS wrapper (toolbar restricted to Bold/Italic/Strikeout/Underline/Bullet+Numbered lists/Headings H1–H3; Quill's `snow`/`bubble` CSS not imported; client-only `import()` so it never evaluates during SSR). **Tab and Shift+Tab move focus** (Decision #144): Quill's Tab bindings — `tab` · `indent` · `outdent` · `remove tab` · the code-block pair — are switched off by name, because `indent` and `code-block` are not allowed formats (they only swallowed the key) and `tab` wrote a literal tab into the text, which a keyboard user crossing a form typed once per press. **IT SHIPS THE EDITOR IT OFFERS, AND NOT THE PACKAGE.** The `quill` default entry ends in one `Quill.register({ ...29 things... }, true)`, and because that is a side effect over live references no bundler may drop any of it — importing it ships both themes, the picker/tooltip UI, syntax, table, KaTeX formula and fourteen formats this toolbar already forbids in `ALLOWED_FORMATS`. `editor/core/quill-runtime.ts` assembles `quill/core` plus exactly the seven registrations the toolbar offers, so the bytes correspond one-to-one with the buttons and cannot drift: measured, **271 KB → 225 KB** on the shipped chunk. Adding a button is therefore two edits, deliberately — a format registered but not offered is dead weight, and one offered but not registered is a control that does nothing (§3 gate 11). **WHEN it loads is a separate decision from HOW.** Fresh boots a page by statically importing every island from one inline module script, so a fetch started in a mount effect begins only after that whole graph has downloaded AND executed; `warmQuill()` is called during RENDER instead, which overlaps the download with the rest of hydration. It is NOT called at module scope, because eleven island entries statically import this component — `ProjectBoard` and `CheckoutBasketScreen` among them — and most draw no editor, so module-scope warming would bill all eleven for it; render-time warming bills exactly the surfaces that show one. The import stays DYNAMIC for the same reason: made static it would become a 225 KB blocking dependency of all eleven. The promise is memoised, so the two editors on the project setup form perform one import between them, and a later one mounts synchronously via `loadedQuill()` with no microtask in which its container is on screen and empty. **THE PRE-MOUNT STATE IS DESIGNED, NOT INCIDENTAL** — `data-ready="false"` + `aria-busy` ship in the SSR markup and the mount effect clears them by writing the DOM (never by re-rendering, which would have Preact diff a subtree Quill owns): the ghost text is drawn from `data-placeholder` by CSS so the field reads as loading rather than broken, the toolbar recedes and stops offering a pointer it cannot honour, and a press that lands before Quill arrives is remembered and spent on `focus()` at mount instead of being swallowed. Nothing user-authored is ever put into the container as markup — the seed still goes through Quill's own sanitising converter, so a stored description carrying `<img onerror=…>` cannot become script. **SIZING IS CSS, AND ONLY A DRAG IS JAVASCRIPT.** Auto-expansion has no measurement loop at all: the editing surface is its content's natural height (`block-size: 100%` against an indefinite parent resolves to `auto`), floored by `defaultHeight` and ceilinged by `maxAutoHeight`, with the overflow scrolling — which the engine recomputes on every reflow, paints correctly on the first frame of a page load, and cannot get stuck on a frame that is never composited. A measure-and-set loop needs the height reset to `auto` before each read or it can only ever GROW, and it is the classic textarea trap. The MANUAL bounds are a SEPARATE pair — `minHeight`/`maxHeight`, the reader's limits rather than the layout's, deliberately wider — and the lock attribute is what switches CSS from one pair to the other, which is why `useEditorResize` stamps the lock BEFORE it reads `getComputedStyle`: by then the engine is reporting the manual pair, resolved to used pixels, so a consumer may express a bound in `rem`, `%` or `calc()` and the hook never parses a length itself. Dragging ANY handle retires auto-expansion for the rest of the session (a width drag included — once the box is in hand, a later reflow changing its height underneath is the surprise that prevents). Three custom **handles** replace the native grip, which is unstylable, unthemeable, keyboard-inert and only ever offered at one corner (`resize: none` suppresses it): a full-width bottom bar always, plus a full-height inline bar and a corner under `enableHorizontalResize`. Invisible at rest, revealed on container hover / focus / the length of a drag; each is a focusable `role="separator"` operable by arrow key (±16px, ±64 with Shift) because a mouse-only affordance excludes keyboard users from a capability the design is offering, and every other key passes through so the handle traps neither Tab nor Escape. Pointer listeners live on `window`, so a drag survives the cursor leaving the element and every exit — release, cancel, blur, unmount — runs one teardown; `setPointerCapture` is deliberately not used (it throws when the pointer is already gone, aborting the handler mid-gesture). Direction is a parameter and never an assumption: the inline handle sits at the opposite physical edge under `dir="rtl"`, so the same rightward travel and the same ArrowRight must SHRINK the box there, and the corner's cursor mirrors `nwse` → `nesw` — a physical keyword with no logical form. Width is clamped to the parent's content box, so no drag can push the page into horizontal overflow. The grip mark steps to `--on-surface` when engaged, NOT to `--primary`, which measures 2.97:1 on this surface in light mode — under the 3:1 a graphical object owes and BELOW the rest state it is meant to strengthen (measured 4.21 → 16.12 light, 5.63 → 13.88 dark). **MARKDOWN PASTE** is intercepted in the CAPTURE phase on the container, a strict ancestor of the node Quill binds its own listener to — two listeners on one node fire in registration order regardless of phase, and Quill registers in its constructor, so a JSX `onPaste` would always run second. Quill's handler opens with `if (e.defaultPrevented) return`, so `preventDefault()` is the whole hand-off and `stopPropagation()` is deliberately NOT called. Interception is declined when the clipboard's `text/html` already carries semantic tags — a rendered document is Quill's converter's job — but taken when that HTML is only wrappers and colour spans, which is exactly what a code editor puts on the clipboard beside the Markdown source. The pure `core/markdown.ts` escapes before it builds any tag (`<u>` is the one tag restored, by name), and unsupported constructs keep their words and lose only their decoration: a code fence becomes one paragraph per line with NO inline pass (or its own underscores italicise it), a table loses only its `\|---\|` rule, a link stays literal because that is lossless, and a thematic break is the one thing dropped — `---` is punctuation standing in for a rule this format set cannot draw. An ordered item may only OPEN a list when numbered 1, or "2024. The year we shipped." becomes a list item **The loader is exported too (Decision #131):** `loadQuill` / `loadedQuill` / `warmQuill` leave the sub-path so the chat composer can mount Quill's engine with no toolbar (its own four-mark allow-list, a floating selection bubble) on the SAME memoised import and registered format set — one Quill build per page, never two.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

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
> - **One focus treatment.** `:focus-visible` (or `:has(:focus-visible)` on a composite), drawn with
>   `--focus-ring-shadow` on every control including the custom ones — or left to the base rule, which
>   draws the same ring as an `outline`. Never bare `:focus`, which fires on a mouse click.
>   `--focus-ring-shadow-inset` is the only permitted variant, and only where an outset ring
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
> height so an appearing error cannot shove the form down. **One scoped exception:** the checkout's
> Details step (`/checkout/details`, its own `DetailsField` row) renders the note only when it has
> text, because the reserved band under every control was the largest reason a one-sitting form
> scrolled at 900px — owner direction, Decision #153; everywhere else the reservation stands.
> `IconField` adds an affordance glyph
> inside an already-labelled control. `InputGroup` joins two controls that form ONE value
> (amount+currency). `IftaLabel` suits dense data-entry tables where a stacked label costs a row.
> `FloatLabel` suits marketing/auth surfaces only. Its `over` variant floats the label ABOVE the
> control's box and so collides with the previous field's described-by text — never in a form
> carrying hints or validation. Its `in` variant is the exception that makes the auth forms
> possible: the label stays INSIDE the box (the control grows to the same two-line
> `--fld-*infield*` geometry `IftaLabel` uses, so the value sits beneath the floated label), nothing
> leaves the control, and it composes with `FormControl` — pass `FormControl` no `label`, wrap the
> control in `FloatLabel variant="in"` with the threaded `id`, and the `for` association is the
> float label's while the hint/error wiring stays `FormControl`'s. Do not mix models within one
> form. A form that marks any field `required` renders `FieldLegend` once near its submit.

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
submenus over the shared `MenuItem` model + `navigation/core/menu.ts` helpers), ActionMenu (the
portalled kebab menu app surfaces adopt instead of a hand-built `Popover` + `role="menu"`; its
open-path, key-resolution and hover-aim logic is the pure, unit-tested `navigation/core/menu-tree.ts`),
Breadcrumb, Steps,
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

- **`display`** — the performance-first collections (**DataTable** with typed cell formatters,
  single / multiple selection with Shift ranges and Ctrl/Cmd toggles, 3-state single or multi-column
  sort, per-column filters, resize / reorder / show-hide columns persisted per surface, priority
  hiding on a narrow container, row actions on a kebab and right-click, and fixed or measured row
  virtualization with infinite scroll (Decision #224); TreeTable; Tree with checkboxes/drag-drop/filter/context-menu; DataView
  list⇄grid; VirtualScroller; Scroller; **VirtualGrid** — a windowed, infinite-scroll GRID of
  stretch-to-fill or `fit="exact"` cells (Decision #223: an exact cell is the zoom width itself, so
  cards scale continuously; cells are keyed by item and placed by `transform`, so a column-count
  change glides each card FLIP-style on `--dur-medium`/`--ease-standard`, skipped under reduced
  motion, while the item at the top of the view stays anchored) built as a "1D-by-row window" over `useVirtualScroll` (measures its own
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
  consumer can re-tint (the projects chat memo + attachment/review previews consume it),
  **VideoPlayer** — the one video surface: a `compact` corner pair (Play ⁄ Pause · Mute ⁄ Unmute)
  for a tile, or the `full` transport (play · mute + expanding volume · clock · seekable scrubber ·
  speed) for a hero or a canvas, revealed on hover ⁄ keyboard focus ⁄ tap over the picture and
  mirroring the `<video>` element's own events so a host may drive playback through `videoRef`
  (the profile hero's carousel, the Selected-work tile and the entity canvas's video preview consume
  it; its pure rules — reveal, slider arithmetic, the clock — are `core/video.ts` and unit-pinned),
  **ProgressiveImage** — the frame every card thumbnail and avatar photo renders through: the
  picture on top, its BlurHash beneath (average colour from the hash's DC term at SSR, so the first
  byte is already the right tone; the full 32px decode painted once by the page's watcher into a
  `--pimg-hash` custom property), and a fallback slot — a muted `image` glyph, or an avatar's own
  initials — shown only on an `error` frame with no hash. State is an attribute the watcher writes
  from `complete`/`naturalWidth` and the document-level `load`/`error` CAPTURE (those events do not
  bubble), so no image carries a listener, a re-sourced image reports again for free, and nothing
  ever rewrites a `src` — the one way a reload loop could start. Motion is `opacity` only, and a
  frame that was already complete when observed never fades. Its placeholder shape is the metadata
  SSOT's `ImagePlaceholder` (`{blurhash, color?}`), which the package mirrors structurally — and the
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
- **`feedback`** — Message/Messages/Alert/Banner, InlineNotice (the unboxed edge-of-region status
  line with one underlined text action — the foot of a stalled list), Ribbon (the viewport-pinned
  bottom status strip for a session-wide fact, reserving `--ribbon-inset` for the pinned chrome
  beneath it while open), Toast (+`useToast`), the Dialog family (Dialog/DynamicDialog +
  `useDialog`/ConfirmDialog/ConfirmPopup), Drawer (alias Sidebar, bottom-sheet under `--bp-md`;
  header `actions` at the start, icon-only `tools` before Close at its `--overlay-action-size` and
  muted ink, and `initialFocusRef` focused itself — Decision #182),
  Tooltip, Popover (alias OverlayPanel), and the progress/placeholder set (ProgressBar/Spinner/Ring,
  Spinner/Loader, Skeleton).
- **`overlay`** — Portal (in-tree fixed-layer, no `preact/compat`), BodyPortal (a real
  `document.body` DOM portal — still no `preact/compat`, built on Preact core `render` — for
  anchored micro-popups that must escape a transformed ancestor's re-based `position: fixed`; used
  by Tooltip, HoverCard, and ConfirmPopup), Backdrop, the generic controlled Overlay, HoverCard,
  **DraggablePopover** (a non-modal draggable + resizable floating window — Pointer-Events drag with
  viewport clamping, keyboard move, eight resize grips [four edges + four corners, named logically
  `block-start` … `end-end` and sitting just OUTSIDE the frame so they never cover content or the
  body's scrollbar, which is why the panel does not clip with `overflow` and the header/body round
  their own corners; the opposite edge stays anchored so the box never inverts, held to the panel's
  computed `min-*`/`max-*` and the viewport; a start-edge grip also moves the origin and fires
  `onPositionChange` beside `onSizeChange`; the bottom inline-end corner is the one keyboard grip],
  a `--primary` resize cue [one `__resize-cue` element masked to a 2px ring inside the hairline: the
  target edge or corner solid, its adjacent corners or edges fading to transparent, held for the
  whole drag; mirrored with `scaleX(-1)` under `:dir(rtl)` like a directional glyph, §A.6],
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
sort signals with a table's clickable headers), **`fields/ZoomSlider`** (zoom-out lens · a muted segmented track with
a distinct centre transition marker · zoom-in lens, for a zoom-density rig; redesigned by Decision #223), the borderless
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
expanded-key set, `role="tree"`/`treeitem` with arrow/Home/End keys. The active row is a solid
`--surface-2` step with `--on-surface` ink and a 2px `--on-surface` inline-start indicator, reserved
`transparent` at rest (§B.4.2). Selecting a row scopes the host
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
live drop indicators, WIP counts, sleek inner scrollbars and elevation-on-drag. **The whole card is
the handle** (Decision #94): it is the pointer drag surface AND the single tab stop — Space picks it
up for a keyboard drag (Arrows move · Enter drops · Escape cancels), Enter or a click ACTIVATES it
through `onItemActivate`, and `data-draggable` lets the sheet promise `cursor: grab` only where a drag
exists. There is no separate grip, and a consumer's `renderItem` content must stay non-interactive
(no nested `role="button"` root) or every card becomes two tab stops that both open it. It NEVER
mutates the model — it emits `KanbanItemMove`/`KanbanColumnMove` on drop, so
a consumer can commit immediately OR intercept a move behind a confirmation modal (the projects
board's stage-reorder / claimed-ticket / revision warnings). §B.4: columns are non-interactive
containers (tonal tint + a single hairline, no box); cards are interactive (surface + radius +
resting elevation). A card that needs a REAL control (the projects board's **Claim**) gets it through
`renderItemActions(item)`: `KanbanColumn` draws it in `.ui-kanban__card-actions`, a sibling of the
card inside the same `listitem` and outside its `role="button"` root, so the control is its own tab
stop, a press on it neither starts a drag nor activates the card, and its press feedback stays
`Button`'s own `scale()` (§3 gates 11–12). Return `null` for an item with none; the drag ghost never
carries it. A column that must refuse ONE item rather than all of them (`column.disabled` refuses
everything) answers `itemDropRefusal(item, column) → reason | null` (Decision #210 — the projects
board's column lock): while that item is dragged the refusing column takes `data-locked` (it steps
down to `--surface-2` instead of the drop tint, its cards recede, `cursor: not-allowed`), states the
reason in `.ui-kanban__col-lock` under its header, shows no drop indicator, and the live region
announces "{column} is locked. {reason}" in place of a position. The item's own column never refuses
it, and the consumer still re-checks on `onItemMove` (a keyboard drop, a stale board).

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
`TableColumn`, `SortState`, `Placement`, `Edge`, …) lives in the package `types/mod.ts`. `MenuItem`
(re-exported from `@projective/ui/navigation`) carries four optional ActionMenu fields: `danger`
(destructive row in the `--danger` role), `hint` (one Meta-register `--text-secondary` line under the
label, e.g. "Pending invite"), `disabledReason` (why a `disabled` row is refused — the row stays
visible and keyboard-readable, the reason shows in a Tooltip) and `emptyLabel` (shown inside a
submenu whose `items` is empty, so the parent is never a dead row).

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
and marks every sibling of the trapped subtree `inert` + `aria-hidden`. `useDismiss` routes Escape
through the LIFO `escape-stack`, so only the most recently opened overlay ever receives it;
`enabled` (pass `useOverlayStack().isTop`) further silences it while a non-dismissing layer such as
`BlockUI` sits above. `Portal`'s click-through default is `:where(.ui-portal) > *` (zero
specificity) so a component's own full-viewport positioner (`.ui-dialog`) stays `pointer-events:
none` whatever order the sheets load in — at equal specificity a later `portal.css` re-enabled it
and the positioner swallowed every Dialog backdrop click. `useOverlayStack` derives its ceiling from live claims
and pushes `isTop` to every open overlay (skipping `passive` claims — a persistent window raises the
ceiling but never owns Escape; `raise()` re-claims the top for a window touched to the front), so the class hierarchy cannot drift upward across a
session, and it compensates the scrollbar with `padding-inline-end` so `dir="rtl"` is not shifted.
`useFocusTrap`'s `returnFocusRef` (passed through by `Drawer`) redirects the restore on close to a
caller-chosen element, read at close: a sheet whose choice moved the reader elsewhere (the
editorial table of contents) hands focus to the destination once the trap has let go, instead of
to its trigger and then racing a timer to move it on.

**App-side frames on the modal stack (§B.10.9, Decision #162(E)/(E2)).** No `@projective/ui` export
was added for them; each is a feature module composed on `createModalStack` + `useFrameState`.
`AttachmentPreviewModal` takes `frame?: { stack, uid }`; `FileFrame` (`features/projects/components/`)
draws it as a frame of any stack and `TicketFileFrame` binds it to `ticketStack`.
**`AssetPicker`** (`features/files/islands/`) takes `frame?: PickerFrameRef` (always open; dismissal
pops the frame unless `onClose` is given) and `title?: string` (header and dialog label for a
controlled or framed picker, before the open request's own title); `TicketPickerFrame`
(`features/projects/components/ticket/`, `{ uid }`) binds it to `ticketStack` and hands the picks to
the ticket beneath. `features/files/core/picker-frame.ts` exports `PickerFrameRef`,
`PICKER_HANDOFF_KEY`, `handOffPicks` and `takePicks`; `features/projects/core/file-frame.ts` exports
`FILE_FRAME_TRIGGER` (a file id or a control token) and `takeFileTrigger`; `useFileTiles` takes
`locateTrigger?: (trigger) => HTMLElement | null` for a token that is not a file, and
`useFileTriggerFocus` is the one focus-return consumer. `TicketView` takes `saving?: boolean`, and
`TicketAttachmentsTab` takes `uid` and `saving?`. `PreSubmitModal` takes `onOpenLibrary?: () => void`
(replacing `onAddFromLibrary`; the control renders only when it is given) and `frame?: TileFrame`, and
exports `PRESUBMIT_LIBRARY_TRIGGER`.

**`SubmissionReviewModal` — the revision allotment (`features/projects/components/`, Decision #167).**
Two optional props: `revisions?` (the stage's `SubmissionRevisions` — `used`, `allowed`
(`null` = unlimited), `priceMinor`, `priceLabel` — as the host resolved it, the Dev Context
Switcher's `revisionAllotment` applied) and `onBuyRevision?` (same feedback payload as
`onRequestRevision`). The footer gains one meta line, `.subm-review__allotment` ("1 of 2 free
revisions used", `--text-secondary`, `tabular-nums`; absent when unlimited), beside the hint; the
footer wraps below `--bp-md`. Past the allotment the revision control reads **"Buy a revision ·
{price}"** and calls `onBuyRevision` (the host raises the round, then opens Buy Now for a
`paid_revision` line through a `BuyNowModal host="body"` it mounts — since Decision #199 through
`PaidRevisionPayDialog` first); with no price or no handler it
stays disabled and the hint says why (§3 gate 11). `revisionIsFree` (`@projective/types/projects`)
and `revisionAllowanceLabel` (`core/submission-model.ts`) are the one rule and the one sentence. The
freelancer's side is a `Message` (success, subtle) in the explorer: "Paid revision, funded, you can
start." Since Decision #213, **Accept & release payment** is the trigger of a `ConfirmPopup`
(`placement="top"`, "Accepting releases this ticket's escrow to the freelancer now. This cannot be
undone." · **Accept & release** / **Not yet**): acceptance moves money irreversibly (#194), so it is
never one click; dismissal is rejection, and `onAccept` fires only from the popup's accept.

**`PaidRevisionPayDialog` (`features/projects/components/`, Decision #199).** Opens once a paid
round is raised: `open`, `round` (`PaidRevisionRaised`), the route address (`projectId`, `stageId`,
`submissionId`) and `onClose` / `onFunded(message)` / `onAddToBasket`. Built on the shared `Dialog`
with the `subm-modal` classes (no CSS of its own). The note states the price and that it is held in
escrow until the revised work is approved. Footer: **Add to basket** (text) · **Pay by card**
(outlined) · **Pay from wallet** (filled), one in flight at a time and the dialog not dismissable
while one is. Card mounts `StripeElementPanel` ("Pay {price}") and polls `waitForLock`: `locked` →
`onFunded`; declined or lock-failed → back to the choice with the reason; slow → a status line saying
the round opens when the payment clears. `CreateSubmissionModal`'s tickets are now the page's `tickets` (the viewer's open tickets,
revision rounds marked) — the hash-generated `submissionTickets` is gone.

**`FairExitDialog` (`features/projects/components/`, Decision #198).** The reviewer's "End stage
(Fair Exit)" confirmation. `SubmissionActionBar` gains `onEndStage` and renders **End Stage (Fair
Exit)** — the `--danger` text button with a new `ExitGlyph`, its word dropped below 1100px like
Delete's (`aria-label` kept) — whenever a stage is in scope (`WorkflowActions.endStage`: a reviewer
on a stage channel or under a stage node; not tied to a unit, because ending early is for a stage
that never reached an acceptance). Built on `Dialog` (`alertdialog`, 34rem), not `ConfirmDialog`,
which closes on accept and cannot hold a disabled or loading confirm. Props: `open:
Signal<boolean>`, `projectId`, `stageId` (uuid or `stg-…`), `stageName`, `onExited(result,
message)`. It owns its read (`GET …/stages/:stageId/fair-exit` on open; a superseded answer is
dropped), its tier (`SelectButton` 25 · 50 · 75 %, opening on 50) and its write. The figures are a
`dl` of three rows — paid to the freelancer · platform fee · refunded to the client — with
meta-register terms, `tabular-nums` values and the one hairline above the refund row; under them a
meta line (held amount · tickets that close · prepaid money returned whole · "this cannot be
undone"). Every amount arrives formatted by the server; the island does no money math
(`core/fair-exit-model.ts` only picks the chosen tier's quote and decides when the confirm may fire).
A settled stage, or one with nothing held, shows an info `Message` and a disabled confirm; a failed
read a danger `Message` with **Try again**; a refused exit stays in the dialog beside the confirm.
Initial focus lands on **Keep stage open**. On success the explorer states the server's notice in
its bar and re-reads the page. Styles: `styles/fair-exit.css`. Not a conversion-lane surface
(§3 gate 10 governs entity-view routes only).

**`SessionDisputes` + `DisputeCaseDialog` (`features/projects/components/`, Decision #212).** A
session engagement's no-show section and its case dialog. `SessionDisputes` mounts in
`ProjectSidebar` under the Normal or Group session panel (props: `workspace` — the viewer's
`SessionWorkspace` after the dev preview — and `onNotice(message, severity)`, the sidebar's toast).
It is static text and controls, not a card (§3 gate 6): a meta-register label ("No-show claims")
under one hairline, then **Report no-show** (`--danger` outlined `sm` button, with the sitting's title
and UTC time as meta text) for an attendee on `workspace.claimable` only — the provider never sees it,
because PRODUCT_SPEC lets only the client claim — and one row per live claim plus the latest ruling:
the lifecycle `Tag` (`subtle`, rounded; warning for open / awaiting response, info under review,
success released / refunded, secondary split — a lifecycle status, §3 gate 7), one sentence written
for the viewer's side, and a **View case** text button. Report opens a `Dialog` (`alertdialog`,
32rem; initial focus on the actions) that explains what happens to the money and how the claim is
decided, with an optional reason `Textarea` (480); a refusal stays beside the confirm. After a claim
or a statement the section re-reads the workspace (`SessionService.workspace`), so the list follows
the act (§3 gate 11). Renders nothing with nothing to report and no claim.
`DisputeCaseDialog` (`Dialog`, 36rem; props `open: Signal<boolean>`, `summary`, `workspace`,
`onChanged`) is the status panel and the Evidence Vault: the `Tag` and sentence, a `dl` of facts
(session · payment at stake · response due · paid to the provider / refunded to the attendee, every
amount server-formatted, `tabular-nums`), the attendance-audit line, the ruling's reasons, then the
statements (who · when · text, evidence files as links to `/api/files/object/:id`) and, while the
case is live, the response form: `Textarea` (4,000) + `FileUpload` (advanced queue, `sm`, a secondary
outlined **Attach evidence** in its header, `customUpload` → `uploadForProject` into the viewer's own
library) + **Send response** / **File statement**; **Send to an auditor now** in the footer when the
case is awaiting a response. A previewed case (the `disputeState` dev axis) is built client-side by
`devDisputeCase` and never fetched. Model: `core/dispute-view.ts` (labels, tones, sentences, UTC
times, the dev preview). Styles: `styles/session-disputes.css` (`sess-dispute*`, `dispute-dlg*`).

**`DisputeDesk` + `DisputeRulingDialog` (`features/admin/`, Decision #212).** The platform operator's
dispute desk at `/admin/disputes` — rendered only for `security.is_admin()` (the controller 404s
anyone else, so no ruling control ever reaches a non-operator, §3 gate 11). `DisputeDesk`
(`islands/`, props `initial: DisputeQueue`, `preview`) is a page, not a card (§3 gate 6): the display
title with a meta-register lede and a text **Refresh** (it re-reads `GET /api/finance/disputes`), a
warning `Message` while any review is overdue, a `TabMenu` (tablist mode, one `tabpanel`) — Under
review · Awaiting response · Open · All live, each with the server's count as its badge (a count, §3
gate 7) — then one hairline-separated row per case, oldest-due first: the case title (the sitting,
else the engagement), one `--text-secondary` meta line (claimant v. respondent · the held amount,
`tabular-nums` · the deadline that applies: ruling due / ruling overdue since / response due /
raised), the claim reason clamped to two lines, a meta evidence count, and a secondary outlined `sm`
**Review**. A row carries a lifecycle `Tag` only on All live (elsewhere the tab already says it) and a
danger **Overdue** `Tag` when the review SLA has passed (a required disclosure). An empty tab is an
`EmptyState` (`sm`). Below `--bp-md` rows stack with the button full-width. `DisputeRulingDialog`
(`components/`, `Dialog` 40rem; props `open: Signal<boolean>`, `item`, `onRuled`) reads the case
(`GET /api/finance/disputes/:id`): the status `Tag` (+ **Overdue**) and an operator sentence, a `dl` of
facts (claimant · provider · session · payment held · raised · response due · under review since ·
ruling due), the attendance-audit line, the claim and every statement with its evidence links
(`/api/files/object/:id`), then — while `canResolve` — the ruling form: a `SelectButton` (Pay the
provider · Refund the attendee · Split) with a one-line hint, a `NumberInput` for the provider's share
in % (0.01–99.99, sent as basis points) on a split, a `Textarea` (2,000) for the reasons both parties
read, the form's first problem as meta text, and **Record ruling**, which opens an in-place confirm
(warning `Message` naming what moves and that it is final, **Back** · danger **Confirm ruling**). A
refusal stays beside the form; a ruling closes the dialog, states the server's notice and re-reads
the queue. The island does no money math: amounts are server-formatted. The `operatorDesk` dev axis
renders sample cases (`previewQueue` / `previewCase`, never fetched; a ruling still meets the
database's refusal). Model: `core/dispute-desk.ts` (tabs, counts, names, deadlines, the form's
validity mirroring `DisputeResolveInputSchema`, the preview). Styles: `styles/dispute-desk.css`
(`ddesk*`, `ddesk-row*`, `ddesk-dlg*`).

**The document page and the SEO head (`features/marketing/components/`, PUBLIC_ROUTES P0, Decision #273).**
`DocumentPage` is a whole editorial document in one component — reading progress, `DocumentHeader`,
the "On this page" table of contents and the body, every heading anchored once — that the legal,
help, changelog and article readers render; `DocumentPageView` is the same composite with its islands
injected (`STATIC_DOCUMENT_ISLANDS` in a render test). Neither renders a `<main>` (the shell's) or any
SEO: a route sets `applyPageMeta(...)`, which `_app` writes into `<head>` through **`PageMetaTags`**
(the one canonical link, alternates, robots, Open Graph, the Twitter card), and renders
**`JsonLd`** beside the page (a server `<script type="application/ld+json">` plus the
`SchemaInjector` island's live copy). No visual surface of their own.

**`PublicFooter` + `FooterLinkGroups` (`features/marketing/`, Decisions #13 / #279).** The public
footer: three lanes over a utility bar (copyright · Terms, Privacy and Cookie Policy · Contact
Help). Above 900px the outer lanes are two rows each — the brand, then Get set up; the newsletter
capture, then Recently viewed — and the six quick-link stacks hold the wide middle lane
(`1fr 3fr 1.25fr`) across both rows, so no stack label wraps at 1280 and neither outer lane is left
empty beside them (`.lp-footer__aux` is `display: contents` there and a full-width row of its own
below). The stacks are the three audience stacks, then **Company** (About · Changelog · Articles ·
Contact), **Help** (Help centre · Feedback & roadmap) and **Legal** (the six documents, titled from
the legal library, and All legal documents) — three tracks, so two rows of stacks on desktop, and
`FooterLinkGroups`' `<details>` accordions below `--bp-md`. An action's label leads to where it is
taken (Showcase / Sell → the seller console's create flow, Post a project → `/projects?create=1`),
never to a browse page or to `/join`. Every destination is
`core/footer-links.ts`, whose test resolves each href against the route tree, the help content and
the legal slugs (a label never points at a hub in place of the page it names). The Feedback entry is
`/feedback` as an href and, on a plain click, opens the board's drawer over the current page
(`openFeedback`, Decision #272). There is no status line (nothing measures the platform's health)
and no social tray until Projective's profiles exist (an empty `SOCIAL_PROFILES` renders nothing). It
is always a sibling of `<main>` on a guest page, so it is the page's `contentinfo` landmark
(`GuestShell`, Part D). Token-only, strict BEM (`lp-footer*`, `styles/footer.css`).

**The help centre (`features/help/`, P2 — `/help`, `/help/:category`, `/help/:category/:article`).** `HelpSearch` (island) is the omnibar: a real `<form role="search" method="get" action="/help">` bar (`.hc-omni`, `hero` on the hub · `compact` in the top bar of a category or an article) — one hairline contour on a solid `--surface-1`, stepping to `--hairline-strong` on hover and focus, a `/` `Kbd` hint (hidden on touch, and `aria-hidden`: the field carries `aria-keyshortcuts="/"` and `aria-haspopup="dialog"`, since it opens one) and a ghost icon-only submit with `aria-label` + `Tooltip`; the compact field keeps the 16px mobile floor on a touch phone (field.css). Typing, clicking the field, Enter or `/` anywhere on the page (`isFocusSearchShortcut`, never from a field or behind a modal) opens a `Dialog` (`.hc-palette`; `position="top"`, so a bottom sheet below `--bp-md`; `--overlay-w-lg` × a FIXED `--overlay-h-md`, so results scroll inside it and typing never moves the panel — the scroller is the listbox itself (`.hc-palette__list`, the body a column it shrinks into), so the region that scrolls is the combobox's own popup, reached row by row with ↑ / ↓, and the status line stays put above it (Decision #279); enter `--dur-medium` on `--ease-emphasized`, exit `--dur-fast` on `--ease-exit`, `transform: none` under both reduced-motion channels). Its header is the combobox (`aria-activedescendant`, `aria-expanded`, `aria-controls`) and a ghost **Close**; its body one `listbox` of `group`s per category, each hit a `HelpHit` option (title + a two-line snippet, the active row a solid `--surface-2`, a matched word `<mark>` in `--fw-semibold` with a 2px `--primary` underline — no fill, so it reads on every ground and overlay); ↑ / ↓ / Home / End wrap, Enter opens, Escape closes; an empty field lists the last eight searches (`localStorage`, try/catch, a ghost **Clear** above the listbox — a listbox holds options only) else the common questions; a polite status line counts the results, or says the search failed — the body then holds only a tier-4 `neutral` outlined **Try again** (no listbox, so the combobox is collapsed); the footer lists the keys (hidden on touch). The overlay is addressable — `?q=` written with `replaceState` while open, opened by a page requested with it, removed on close — and without JavaScript the hub renders the same `HelpHit`s as a server list (kept under the overlay that opens on its query, removed when it closes, so waking up never shifts the page). `HelpfulnessPrompt` (island) is "Was this helpful?": plain text and two tier-4 `neutral` outlined buttons; **No** opens an optional 280-character `Textarea` with a characters-left count, a ghost **Skip** and a tier-3 **Send** last (§B.8.6); while an answer is on its way the form that sent it stays mounted, its controls `aria-disabled` (never `disabled`, which drops focus) and the pressed one `aria-busy`; a note that fails keeps its text and shows the error in its own form; an answer becomes one quiet thank-you line in a polite live region — no toast — and focus moves to the block's heading; without JavaScript it is a form whose post returns a 303 to the block. `HelpStillStuck` is the hub and category pages' closing band: a solid `--surface-1` region holding controls, tier-3 **Contact support** last and, signed in, tier-4 **How disputes work** (it opens the article; it becomes **Raise a dispute** when a member dispute route exists, Decision #275 (a)). The hub's "Start here by role" is four text lists under `--text-xs` caps labels (never cards), one column, then 2 × 2, then four across, stepped on the `hc` frame container; its Topics are link rows on `--bg` with a `--surface-1` hover, one `--icon-md` glyph, a `--surface-2` article-count pill (a count, §B.11.3) and one hairline between rows; its FAQ native `<details>`. A category is a list of heading links with their summaries and a Meta read time; an article is P0's `DocumentPage` under a `Breadcrumb` trail and the compact search (a bar on the document frame's geometry — the reading column, plus the TOC rail and its gap from 1024px of frame — so it lines up with the article), followed by the helpfulness block, related articles and a previous / next pager. Section headings sit at the reading family's h2 (`--text-xl`, `--fw-medium`). The three pages are `HelpHubPage`, `HelpCategoryPage` and `HelpArticlePage` (`features/help/{hub,category,article}/components/`), each server-rendered around the two islands. Styles `features/help/styles/help.css` (`hc-*`), carried by both islands — with the Breadcrumb's sheet, which has no island of its own.

**`ProjectCreatePricingFields` (`features/projects/components/`, Decision #195).** The Quick-Init
create modal's money row: a `CurrencySelect` (`DISPLAY_CURRENCIES`, the set the workspace's Rules
section offers and the fat service accepts; filterable, fluid) beside an optional baseline price
`NumberInput` (`MONEY_FIELD`, the currency's own exponent and minor-unit step) whose label and hint
follow the format (`BASELINE_PRICE_LABEL` / `BASELINE_PRICE_HINT`: a per-ticket rate or a whole
escrow budget), marked **Optional** in `--text-secondary`. Props `format`, `currency`, `amount`
(MAJOR units, `null` = unpriced), `onCurrencyChange`, `onAmountChange`, `field(key)` (the modal's
focus-tracking wrapper, keyed `currency` · `baselineAmountCents` so a server refusal lands on its
field), `currencyStatus` / `amountStatus` and optional `currencyError` / `amountError`, which replace
the hint as an error line. Presentational only — the modal owns state and submits the minor amount.
Styles: the modal's `pjc__row` / `pjc__label` / `pjc__hint` (`projects/styles/project-create-modal.css`), token-only.

**Articles — `ArticleTile` · `ArticleTopicFilter` · `ArticlePagination` · `ArticleByline` · `ArticleCta` · `ArticleMeta` · `ArticleMediaFade` (`features/articles/`, Decision #271).**
Projective's own articles on `/articles` and `/articles/[slug]`, composed by the two page views
`ArticlesIndexView` and `ArticleReaderView`. **`ArticleMeta`** is a tile's facts line (below). Every component is server-rendered;
the `ArticleMediaFade` island renders nothing and carries `articles.css` (block `artl-`; `art-` is the
member-article view's) plus the Button sheet onto every state of both routes, and fades lazy images in
at `--dur-medium` — only under no-preference motion in both channels, never the eagerly loaded lead or
cover, and nothing is hidden without JavaScript. **`ArticleTile`** is an interactive media card
(§B.9.5): solid `--surface-1`, `--card-radius-media`, resting `--elevation-low`, no border, the §A.3
card rhythm tokens, media at `--card-media-ratio` on a `--surface-2` ground with intrinsic
`width`/`height`; one stretched title link is its only control (hover raises `--elevation-medium` and
zooms the media by `--card-media-zoom`; a press compresses by `--btn-press-scale`; both reduced-motion
channels set `transform: none`; keyboard focus underlines the title in `--primary` — no ring). Variants
`lead` (beside its picture from 1024px of the `artl-index` container; stacked below, where its text
column would be ~280px), `feature`, `grid` and `compact` (the reader's related rows). A tile's cover
is decoration (`alt=""`) — the title link names the card; the reader's cover keeps its description.
Its eyebrow is the primary topic in the section register and its facts — byline · reading time ·
date — one Meta-register line with `aria-hidden` middots (§B.11.2), never chips; each middot closes
the fact before it, so a wrapped line never starts with a separator. **`ArticleTopicFilter`** is a control group of real links (`?topic=`, any-of, back to page 1):
pill chips with a full `--hairline-strong` border, the chosen ones `aria-current="true"` on a solid
`--surface-2` step with an `--on-surface` border and a check glyph, so the state never rides on hue;
counts in `tabular-nums`. **`ArticlePagination`** is Previous · "Page n of m" · Next as tier-4 neutral
outlined links that keep the filter; an unusable neighbour is omitted, not disabled. The reader is
P0's `DocumentPage` with the `ui-doc--article` frame: **`ArticleByline`** is the article's unboxed
`<address>` (picture, name — a link only when the author has a page — and role; the role's weight
is explicit, so the dyslexic overlay's bold `address` never makes it heavier than the name, and the
end-of-article `artl-byline--lg` sets the name at `--text-base`, never smaller than the bio under
it); **`ArticleCta`** is the article's one call to action, an `<aside>` on a solid `--surface-1`
step after ~60% of the body holding the region's only filled button (tier 3 brand primary; a guest
is sent to `/join`, a signed-in reader into the product), which re-asserts the Button's press
transition over the prose link rule and is not printed (`data-print="hide"`). The index frame (`artl-index`) is a named inline-size container — features
two-up from 768px, the grid two-up from 480px and three-up from 1024px — and static content on it
(the header, the summary, section labels, the empty state) is never boxed. The `ui-doc--article` variant also sets a
quotation as a pull quote in the display register (sans, `--text-xl`, `--fw-light` so it never reads
as a same-size section heading, on the prose's one `--hairline`). P0's `DocumentHeader` facts are
no longer flex containers, which had dropped the space between a date's prefix and the date; the
integrated rule is the help centre's (`.ui-doc-header__meta-item` is `display: inline-block` and
positioned for its hung separator).

**`PromoSlot` (`features/explore/components/promos/`, Decision #175).** The Explore Home's one promo
surface; it replaces `SponsoredFrame`, `CtaBanner` (both "Become a Freelancer" and "Launch a Team")
and `HelpArticlesStrip`, which are deleted. One prop, `slot` (the `PromoSlot` union from
`@projective/types/explore`, discriminated by `variant`): **`sponsored`** — a paid placement read
from `marketplace.promoted_placements` (surface `explore_home`, any number of slots), rendered as a
two-cell featured `RailCell` (`featured` prop, `.ex-rail__cell--featured`: `min(2 × --ex-cell-w +
gap, 100%)`) at the head of the rail of the listing it promotes, with that listing removed from the
rail's own cells (`featureInRail`, `core/promo-model.ts`); the whole slot is one link, media is
`ProgressiveImage` in the card family's 16:10 `.ex-media`, and its only disclosure is the card
family's AD badge (`PromotedBadge`, aria "Sponsored"), with no separate "Sponsored" eyebrow.
**`cta`** — eyebrow · title · body · one `.ex-btn--solid` action; `audience` (`everyone` ·
`non_freelancers`) and `dismissible` are enforced by the **`PromoGate`** island
(`features/explore/islands/`), which owns the slot's `.ex-home__section`, withholds a
`non_freelancers` slot from a viewer who can sell (`userContext.isFreelancer`, or the simulated
persona) or who is a restricted (13–17) account and so cannot become a seller (`viewerRestricted`, or
the switcher's Age axis — Decision #192), and renders an icon-only ghost dismiss `Button` that stores the slot id in
`LocalKeys.EXPLORE_DISMISSED_PROMOS` (applied after hydration; the Dev Context Switcher's
`promoDismissal` axis forces every dismissible slot shown or dismissed). **`editorial`** — the shared
`RailHeading` (lead · tail) with a "view all" link over a list of help reads. Every variant is a solid
`--surface-1` region (no translucent `--primary` wash, §3 gate 6) on the rails' measure inside
`.ex-home__section` (no `--container-xl` cap); titles take `--ex-rail-title-size`, the rail-heading
register and its ceiling (§3 gate 8); the stacked ⇄ two-column reflow is a container query on the
`expromo` container (the featured cell or `.ex-home__section--promo`), never the viewport; press
feedback is `scale(var(--ex-press-scale))` on the link surfaces and `--btn-press-scale` on `.ex-btn`,
with no hover `translateY`, and `transform: none` under both reduced-motion channels (§3 gate 12).
The same change moves the glass of `.ex-ad` and `.ex-actions__btn` onto a `::before` underlay (§3
gate 9); `.ex-actions__btn`'s fill is `--ex-actions-fill`, so hosts override the variable, not
`background`.

**Explore Home shelves and card intent (`features/explore/`, Decision #174).** The Home is a stack
of shelves inside `.ex-shelves`: the hero fold, a **sticky chip bar** (`.ex-chipbar` — solid `--bg`,
pinned under the header at `--ex-chipbar-top`, one `--ex-hair` hairline only while `data-stuck`),
the Recommended panel (`.ex-fold--rec`), then `.ex-home` (`#ex-home-shelves`) at one
`--ex-section-gap`: rails, the projects grid, the chip-filtered Products rail and the editorial
promos. Every body shelf carries `data-shelf`; a chip whose `CategoryChip.shelf` names one filters
the shelves in place (`data-filter`, `aria-current` on the chip, "All" restores) inside a
same-document View Transition, and every chip stays a real link without script. `RailFrame` takes
`facets` / `facetLabel` for in-rail filter chips matched on `RailCell`'s `facet` (`data-facet`; a
featured promo cell has none and shows only under "All"). Rail arrows (`.ex-rail__nav`) are
revealed on rail hover or focus for fine pointers and always shown on touch. Media cards (service,
product, profile) end with `CardReveal` — one `--on-surface-variant` line of the summary that opens
on a **rail** card after `--ex-reveal-delay` (350ms) of hover, or at once on `:focus-within`, into
the track's reserved `--ex-reveal-reserve`; grids never reveal and card media never scales
(#77(H) stands). "New" (created < 14 days, `isNew`) is inline middot meta (`NewFact`), "Available
now" carries a three-cycle pulse dot, and "0 delivered" is omitted. Edge-fade masks take
`--ex-fade-ink`, never a raw hex. A card link into `/view` names the card's media
`ex-hero-media` on click (`core/hero-morph.ts`), matching `.evp-canvas__stage`, for a
cross-document View Transition; any un-armed navigation from Explore skips its transition.


**Notifications (`features/notifications/`, §D.9, Decision #173).** `NotificationTabs` (the
category `TabMenu` with unread counts from the shared summary — the inbox's only containers),
`NotificationRow` (avatar · title · body · one inline meta line · unread mark on a solid ramp step ·
a sibling Archive control; the row is a link to `actionUrl`, or a mark-read button when there is
none; optional bulk-select checkbox), `NotificationList` (loading placeholders · error notice with
Retry · empty state · hairline rows · Load more · the polite live region), and two islands over them:
`NotificationDrawer` (the header drawer, mounted by `UserActions`; it also runs the page's ONE
`/summary` poller) and `NotificationsPage` (`/notifications`). State and rules live in `core/`
(`NotificationService`, `notification-model`, `notification-state`, `useNotificationFeed`,
`notification-sim`). Replaces the `nav-fixtures` notification list and the `.shell-feed` rows.

**`ContactIntake` + `ContactRail` + `AttachmentDropzone` (`features/contact/`, Decision #276).** The
`/contact` page: a page header (eyebrow · display `<h1>` · lede at `--measure`), then a split canvas —
the intake column 3 : the rail 2 from 60rem of PAGE (a container query on `.ctc`, never the
viewport — 60rem of the guest shell's content box lands at about a `--bp-lg` viewport), stacked below
that with the rail moved under the form, never copied. **`ContactIntake`**
(island, the carrier of `contact.css` for the whole page) is the intent switcher — `SelectButton`
with descriptions and `hrefFor`, two segments a row on a narrow column and four from 40rem of
column — over one `<form method="post" action="/api/contact">` whose four intents are four
`<fieldset>`s with legends (**`IntentFieldsets`**; the support form's Topic select is the help
centre's categories in hub order, titled as the help centre titles them, then "Something else" —
`contactSupportTopics`, read by the page from `HelpBackendService`, Decision #279); on the split canvas they share ONE grid cell, so the column is as tall
as the tallest and switching moves nothing, while stacked (below 60rem) the inactive three leave the
flow (absolute, clipped to the active one's box) so the rail follows the active form's Send button
with no reserved band — a resize the reader's own switch causes, not layout shift. The inactive
three are `disabled`, `inert` and `aria-hidden`, and the pair
cross-fades on `--dur-fast` (opacity, with a delayed `visibility` step on the way out; a cut under
both reduced-motion channels). Labels sit above fields through `FormControl`, hints are
`--text-secondary`, and an error is inline and `aria-describedby`; a signed-in reader's name and
address open pre-filled (editable); a submission is pre-checked against the shared Zod schema and
the first invalid field takes focus. A refusal of the whole request (a rate limit, the intake
unavailable, files still checking) is a danger `Message` directly above the active form's actions,
where the sender is looking, announcing itself (`role="alert"`) and not repeated to the live region;
only a no-JavaScript refusal, which the page opens on, sits at the top of the form. The outcome replaces the
form: `ContactReceiptPanel` (a plain `div` — the intake region already takes its heading as its name)
— a success mark, the heading in the display register (`--text-2xl` · `--fw-medium`, sentence case,
the focus target) over two section-header eyebrows, the reference in `--font-mono` with a Copy
control that really copies (a success is said through the live region), the intent's next steps, and Send another
(neutral outlined) beside Browse the help centre (a `link`-variant anchor; no fill competes once the
request is in) — announced through the intake's polite live region independently of any motion. Each form's submit
is the column's one filled primary; the sales form's Book a discovery call is `neutral` `outlined`
(tier 4), sized to its label and top-aligned with Send, and, while no Projective sales profile
exists, `aria-disabled` with its reason as visible text (gate 11). Routing notes (sign in to pick an engagement; a session's no-show claim; responsible
disclosure) are one glyph and one or two sentences, unboxed. The anonymous box is a `Checkbox` (a
real input, so a report can be anonymous without JavaScript — CSS hides the name and email while it
is ticked); hydrated, ticking it removes those fields and says so through the live region. A
`ToggleSwitch` would not do: its `role="switch"` button needs a script to turn. **`AttachmentDropzone`** composes
the package `FileUpload` (drag-and-drop plus click) with this surface's rows: the bucket's limits
printed above the zone, then per file its name, size and state in the meta register — Uploading
with a determinate `ProgressBar`, Checking the file (the pipeline's `scanning`), Ready, or Not
attached with the reason; rows are spaced by a gap, not boxed — and an icon-only Remove with its file
name in the label and a `Tooltip`. Remove works at every step but the brief check: while a file
uploads it cancels the PUT, and once the server knows the file it takes it back there (row and bytes
go); during the check it stays focusable, `aria-disabled`, with the reason in its name and tooltip.
The zone is named `Attach files (optional)` and described by the limits line. A guest sees why
attachments need an account instead. **`ContactRail`** (server
component, zero JavaScript) is the page's one tonal region — a solid `--surface-1` at
`--radius-xl`, no border, no shadow, nothing boxed inside it — with three groups separated by
spacing and ONE hairline: who you're contacting (the brand `Logo` and the entity facts as a `dl`,
`XXXX-XXXX` in `--font-mono` until supplied; the mark carries intrinsic `width`/`height` so it never
paints rail-wide before its CSS lands), when you'll hear back (one reply target per intent),
and answers without waiting (`/help`, `/legal`). No status line: no health endpoint exists to read
one from.

**Saved (`features/saved/`, Decisions #180 / #181).** The one saved system's client half.
`SavedService` (thin client over `/api/saved/*`, substituted by `saved-sim` while the Dev Context
Switcher's `saved` axis is set — Auto · Nothing saved · Every type), `optimistic` (THE star / save
write discipline: apply at once → persist → roll back on refusal → hand back the sentence to
announce; one press in flight per key) and `saved-state` (`toggleSaved`; `savedFlag` — one shared
signal per listing / profile / project, answered for a whole Explore grid by ONE batched
`/api/saved/state` read; `savedTypeOf` maps an Explore entity to its kind). Every star control
(`CardActions`, the view lanes, `ProjectCard` / `SidebarHeader`, the conversation header / row menu
/ inbox row, `ChatFeed` / `PopoutChat` favourite, the file `PreviewHeader`, `ChannelHeader`) keeps
`aria-pressed` and announces its outcome in a polite region or toast. Components:
`CollectionPicker` (a `Dialog`: a `RadioGroup` of No collection + the viewer's collections, nothing
preselected when the current one is unknown, an inline **New collection** field, Cancel / Save;
saving through it saves the thing too) and `SavedRow` (lead picture — a person's `UserAvatar`, a
thumbnail, else the kind's glyph on `--surface-2` — · the title as the row's link · ONE inline
`--text-secondary` meta line, kind · owner or place · when saved; Add to collection and Remove are
sibling icon-only text `Button`s named with the row's title, never inside the link). The island
`SavedPage` (`/saved`): display title; a `TabMenu` tablist (All · Services & products · People ·
Projects · Messages · Files) deep-linked with `?tab=`; a collection `Select` (+ Delete collection)
only on a tab with a collectable kind and only once a collection exists; hairline rows, **never
cards or chips**; **People you follow** as its own labelled section after the saves; loading
placeholders, an error `InlineNotice` with Try again, an `EmptyState` (`star`) whose sentence names
the tab; removal in place, rolled back and explained on refusal; Load more. Elsewhere in the same
change: Explore's `CardActions` is **Share · Save** — the kebab and its Report / Add to project stubs
are gone (§3 gate 11, as Decision #140); the file preview's star renders only for a file the viewer
may star (its owner); `projects/core/channel-stars` carries a room star from the channel header to
the sidebar tree's **Starred** filter without a reload; the profile hero's meta line gains the
follower / following counts (`tabular-nums` text controls) that open `ConnectionsDialog`
(`features/profile/components/`, hairline rows of avatar · name · `@handle · kind`, Load more); the
account menu gains **Saved** (`NavIcon` `saved`, a bookmark glyph).

**Legal (`features/legal/`, Decision #270).** The public legal hub and documents compose the
editorial layer above and add no `@projective/ui` export. `LegalHubView` (`/legal`): the display
title, a reading-face lead, the library's `LegalDraftNotice`, then the documents in two groups
(section-header labels) as a plain hairline-free list — each row its title as a `--text-lg` /
`--fw-medium` heading whose link is stretched over the row, a one-line summary and ONE Meta-register
facts line (version · effective · updated · Draft — each fact opens with its middot inside a clipping
wrapper, so a line that wraps never starts with a separator), a `--surface-1` tint on hover and on the link's
`:focus-visible`, **never cards or chips** — and a "Questions" side note beside the list from
`--bp-lg` of its own width. `LegalDocumentViewComponent` (`/legal/:slug`): `DocumentLayout` with
`ui-doc--clauses`, the "Legal documents" rail (every document as an `href` entry, the open one
expanded into its numbered clauses), each clause opening with its "Plain-English summary".
`LegalDraftNotice`: the "Draft — pending legal review" required disclosure (§B.11.3) — `role="note"`
named by its title, one solid `--warning`-tinted step, no border, printed. A dated fact
(`Effective 17 October 2026`) is P0's `DocumentDate` straight into the facts: both facts lines keep
each fact's content in flow (the frame's `.ui-doc-header__meta-item`, the hub's `inline-block`
`lgl-facts__item`), so the prefix keeps its space — the `LegalDate` wrapper that worked around the
old inline-flex item is retired (Decision #279). `LegalCompareBody` (`?compare=`): each changed, added or removed clause in
full with a 2px `--info` gutter bar and a "Changed in version X" Meta line that describes its diff
group (`aria-describedby`); `<ins>` / `<del>` words on a solid tint of `--success` / `--danger`
over the page AND an underline / strike, with visually hidden "Added:" / "Removed:" (a small gap before
an insertion only where it starts a new word); a table drawn as the document's own `ui-prose__table`
(caption, column and row headers), diffed cell by cell; a unit that did not change word by word in
its authored form, links kept; every run of unchanged clauses folded behind a native `<details>`
("Show n unchanged clauses" / "Hide …"; a fold still closed at print time is left off the paper). The
island `LegalVersionControls` (the meta rail, `data-print="hide"`): a `<form method="get">` of two
native `RadioGroup`s (Version · Compare with — the latter only versions older than the one picked)
with a tier-4 submit, so it works without JavaScript; Download PDF (a tier-4 `ui-button` link — the
Button's anchor form draws no underline) and
Print (tier 4, offered once hydrated; it opens every fold before printing). The hub's sheet rides the
zero-UI `LegalStyleAnchor` island. Below the frame's meta-rail width the controls render after the
body, so each version's "What changed" notice under the header also links "Compare with version X".
Classes `lgl-*`, token-only (`styles/legal.css`).

**The `/about` page (`features/marketing/about/`, PUBLIC_ROUTES P4, Decision #277).** `AboutView`
composes the page — its bands, in order — from three app-level pieces, on one editorial column (`--measure-wide` display, `--measure` prose) of
full-bleed bands in SOLID alternating tones (`--bg` / `--surface-1`, each band publishing its
ground as `--abt-ground`; the founders band is drawn only once real founders exist — an empty
`ABOUT_FOUNDERS` draws none, never stock portraits, and the bands after it re-pair their tones so
two of one tone never meet, Decision #279), no cards, a named inline-size container (`abt`)
answering every breakpoint. **`AboutMetrics`** — the live metrics row: one unboxed tile per published figure
(section-caps label · the figure at `--text-3xl` / `--fw-medium` / `tabular-nums`, an abbreviated
money figure carrying its exact words for assistive technology · one `--text-sm` meta sentence ·
`As of <time>` in `--font-mono` `--text-2xs`), one column below 768px of frame (a block hairline
between tiles) and two a row from it (an inline hairline between the pair, rows separated by spacing
alone), so a display money figure never breaks mid-number; a figure below the threshold has NO tile
and one sentence names what is withheld; a failed read says so and shows none. Feature-local rather
than `StatTile` because it needs the timestamp slot and must render under `deno test` (`StatTile`
imports its sheet). **`TourFigure`** —
the walkthrough diagram: inline SVG in tokens only (`fill` / `stroke` set by class, `--icon-stroke`
with `vector-effect: non-scaling-stroke`; labels a step up the scale, `--text-base` places and
`--text-md` numerals, because the viewBox is drawn smaller than itself, so they render at 11px or
more), eight numbered nodes on a rail, the money's place bracketed (in the muted ink, ≥ 3:1) and
named beneath, a token moved by `transform` alone (`--dur-medium` / `--ease-standard`; colour on the
theme clock, `--dur-slow`); two layouts of one drawing — a row of eight from 768px of frame
(`--bp-md`), two rows of four with a U-turn below, capped at `--measure-narrow` — exactly one
displayed; `role="img"` named by its `<title>` and described by its `<desc>`
(`aria-describedby`). **`DeliveryTour`** (island, the page's only one
and its stylesheet carrier) — the WAI-ARIA tabs pattern over that diagram: eight real buttons
(roving tabindex, arrows wrap, Home / End, automatic activation; a reserved transparent 2px
block-end bar recoloured `--primary` when selected, each label set twice in one cell, the copy at the
selected weight, so selection re-wraps nothing; press `scale()` removed under both reduced-motion
channels) controlling one explanation panel ("Where the money is" + two lines; all eight stacked in
one grid cell, only the selected one visible, so the panel never changes height under autoplay), a
visually hidden ordered list as the text equivalent, and a ghost Play / Pause / Replay control.
Autoplay is one pass, only under no-preference motion on BOTH channels, only once 35% of it is on
screen, never in a hidden tab; a pointer resting on it holds it, keyboard focus or a picked step
stops it for good (the WAI-ARIA carousel rule), and under reduced motion there is no autoplay and no
control. The closing band's actions are native links in the Button class set: the neutral outlined
escape first, the one filled `--primary` commitment last (§B.8.6).

**Changelog (`features/changelog/`, PUBLIC_ROUTES P5, Decision #278).** The public release feed,
composed on the editorial reading family. **`ui-doc--feed`** — a new `DocumentLayout` variant in
`document-layout.css`'s Variants region: from `--bp-md` of frame the reading column widens by a
dated gutter (`--doc-feed-gutter`, 8.5rem) and `--space-6`, so an entry's body still reads at
`--measure`. **`ChangelogFeedView`** (`/changelog`: `DocumentHeader` with the display title, the
standfirst and a Meta-register facts line — count · latest version · `Updated <time>` — and, in its
slot, the subscribe row: a tier-4 neutral outlined **RSS feed** link beside `NewsletterForm
topic="changelog" source="changelog"`, the field's `--lp-*` hooks pointed at solid tones; then
`CategoryFilters`, the timeline and `FeedPager`). **`CategoryFilters`** (a `<nav>` of real links —
"All releases" plus a chip per category that has releases or is selected; each toggles its category
on page 1, several may be on; solid `--surface-1` fill, the selected chip the inverted
`--on-surface` / `--surface` pair Explore's chip bar uses, with `aria-current="true"` and the count
in tabular figures and in its name). **`ReleaseEntry`** (one `<li>` of the `<ol
class="chl-timeline">` holding an `<article>` named by its `h2` `AnchorHeading` — `#v0-12-0`, a link
to itself — at the document family's h2 step: `--text-xl` / `--fw-medium`; a gutter of `<time
datetime>` (short month, `23 Sept 2026`, `nowrap`, so it fits under every font overlay) and the
version as a small solid-fill link to the release page, both `--font-mono` and spaced as text,
sticky at `--doc-sticky-top` from 768px of frame, its dot riding ONE `--hairline` spine —
`--primary` for the newest release, which also says "Latest" in words, `--text-secondary` for the
rest; the categories as inline meta text with a TRAILING `::after` middot (a wrapped line never
opens on a dot), never chips; the summary in the reading face; the body through `ContentRenderer`
against ONE page-wide anchor registry; entries `--space-7` apart). **`ReleaseGallery`** (a
responsive grid of 16:10 `--card-media-ratio` tiles, each a real link to its picture carrying
`data-chl-image="<anchor>:<n>"`, intrinsic `width`/`height`, every picture lazy (a gallery follows
its release's whole body), a required caption under the tile that also describes the link; hover the
card family's `--card-media-zoom` inside the tile's corner, press `--btn-press-scale`, both removed
under either reduced-motion channel). **`FeedPager`** (Newer / Older releases as tier-4 links with
`rel`, "Page n of m" between, rendered only for links that exist, above one `--hairline`).
**`ChangelogReleaseView`** (`/changelog/[version]`: breadcrumb, `DocumentHeader` with "Released
<time>" · version · categories — the date and the version figure in `.chl-mono`, the words around
them in the sans face — the body and gallery in a `<section>` under a visually hidden `h2` so the
body's `h3`s never skip a level, and a footer of previous / next release rows beside "All releases":
one column below `--bp-md` of frame, older left and newer right from it, each row's hover tint hung
into the margin so the text lines up with the hairline and the button). **`ChangelogNoticeView`**
(the 404 and 503 states in the same frame, one `<h1>`, one way out). The island
**`ChangelogLightbox`** is the one owner of `?image=` and the CSS carrier of every changelog page
(it imports `changelog.css` and the button sheet, and mounts even on a page with no pictures); it
draws the app's one media lightbox, `MediaLightbox` (Decision #184), which gains an optional caption
for it. Press feedback is `transform` only and removed under both reduced-motion channels; every
step is a container query on the `ui-doc` frame.

**Feedback board (`features/feedback/`, Decision #272).** One body, `FeedbackBoard`, renders both
`/feedback` (the `FeedbackPage` island) and the `?feedback=open` drawer (`FeedbackDrawer`, the
overlay family's right `Drawer` at `--drawer-w`, imported on first use by the `FeedbackHost` island
the public, profile and dashboard layouts mount; entering at `--dur-medium` / `--ease-emphasized`,
leaving at `--dur-fast` /
`--ease-exit`). The board's header is the display title (page only) with its lede and **Suggest an
idea** — the region's one filled primary (tier 3), a sign-in link for a guest; then a `TabMenu`
tablist (All · Under review · Planned · In progress · Shipped, roving tabindex) whose counts are
`--surface-2` count chips, and a Top / New `SelectButton`. On the page the All tab is the roadmap —
three solid `--surface-1` columns (Planned · In progress · Shipped) from 1024px of frame, stacked
below it — and never the drag-surface `kanban` package; in the drawer it is one list. Components:
**`VoteButton`** (a stacked `chevron-up` over a `tabular-nums` count that reserves `3ch`; a
`<button aria-pressed>` named "Upvote <title>, n votes", pressed = the brand pair with a
border-channel hover, §B.12.4; press = `scale(var(--btn-press-scale-icon))` only, `transform: none`
under both reduced-motion channels; a guest gets the same face as a sign-in link; a shipped idea
gets a borderless count, not a control), **`IdeaRow`** (unboxed — one hairline between rows, never a
card, since the drawer is an elevated panel, §B.9.2: the vote control, the title as the link that
opens the idea, a one-line reason, and one meta line — the lifecycle `Tag` (subtle, rounded:
Under review `secondary` · Planned `info` · In progress `primary` · Shipped `success`; only on a
mixed list — a roadmap column or a single-status tab already names it), then category · age as
inline middot text, each dot closing the item before it so a wrapped line never starts with one; a
refused vote's reason inline as an alert; on the page the row's `id` is its slug, the
`/feedback#<slug>` anchor the JSON-LD lists), **`IdeaDetail`** (the idea with a large `VoteButton`
and its inline refusal, an
`<address>` byline with `UserAvatar`, the team's response behind one inline-start hairline, the
status history with `--font-mono` dates, related ideas), **`IdeaComposeForm`** + **`ComposeActions`**
(title ≤ 90 with a live `tabular-nums` count, category `Select`, "What problem does this solve?",
optional details, an "Already suggested?" list whose action button reads **Vote for this instead**
/ **Remove my vote** — an action, not a toggle, so no `aria-pressed`; `aria-disabled` while in
flight — with each refusal inline, and votes announced by the FORM's own live region, since on the
page the form's Dialog makes the board inert; the contact-detail hint as you type;
the commit pinned in the drawer's or dialog's footer) and **`SentFlourish`** (the owner's "whoosh":
the `send` glyph flies off the success mark once — transform and opacity only, never overshooting,
not rendered under either reduced-motion channel; the success itself is announced by the form's own
polite live region, present before the send, and focus moves to the success heading).
Votes are optimistic through `core/vote-store.ts`; a vote that lands is announced in a polite
region, a refusal once, by its inline alert. Loading placeholders are `role="status"` regions with a
visually hidden "Loading…" (the `Skeleton`s stay `aria-hidden`).

**`FundStageDialog` (`features/payments/components/`, Decision #197).** The client funds a whole
stage — every ticket in it nobody has paid for, claimed or not — from the stage board's money sentence
("{n} tickets need {total} to start." → **Fund stage**; the project board keeps **Fund all**, the
basket hand-off). Props `visible` (a `Signal<boolean>`), `project` (`prj-…`), `stage` (`stg-…` or
row id), `onFunded`. It renders on the shared `Dialog` at `--overlay-w-sm`: the stage name (Meta),
the server's figure (`--text-2xl`, `--fw-medium`, `tabular-nums` — never computed in the island; read
from `GET /api/finance/escrow/quote`), the ticket count, a `SelectButton` **From wallet · By card**
only when the paying wallet covers the stage (else the card alone), one `--text-secondary` sentence
on where the money sits, and one tier-1 `accent` commit (_Fund €X_ or _Continue to payment_). The card
path mounts `StripeElementPanel` (payment mode) on the escrow intent's PaymentIntent and then waits
for the webhook (`PaymentsService.waitForLock`), saying which of locked · declined (nothing charged)
· lock failed (the money is in the wallet) · still clearing happened. A stage with an unpriced ticket,
a finished stage or one with nothing waiting shows a warning `Alert` and no commit (§3 gate 11).
Copy and the method rule live in `payments/core/stage-funding.ts` (tested), shared with the wallet's
**Fund a stage** dialog, which gains the same **From this wallet · By card** choice and now lists
an individual owner's stages on their personal wallet. Not a conversion-lane control: `/projects`
routes are a workspace, not an entity view (§D.7.10). Styles `payments/styles/stage-fund.css`
(`.sfd*`), token-only, no box around static text.

**`FundingStatus` (`features/projects/components/`, Decision #169).** One ticket's payment &
work-start line (PRODUCT_MANAGEMENT §3.6): props `funding` (the server-derived `FundingStatus` from
`@projective/types/finance`, never derived in an island), `side` (`client` · `provider`),
`freelancer?`, `dateLabel?`, `compact?`, `pollSlug?` (re-reads the ticket every 3s while
`processing`), `busy?`, and the handlers `onBuyNow` · `onAddToBasket` · `onReview` · `onRetry` ·
`onStart` — a control renders only when its handler is given, except Start work, which renders
DISABLED with the sentence as its `aria-describedby` while the ticket is not funded (§3 gate 11). It
draws a lifecycle tag (a solid role fill on the `.pjd-status` recipe, §B.11.3/§B.11.6), one Body
sentence (`aria-live="polite"`, `tabular-nums`) and at most one decision's controls (Buy now `accent`
filled + Add to basket `neutral` outlined; Review / Start work brand filled; Retry from wallet
`accent`), press feedback being `Button`'s own `scale()`. `compact` is the board card's mark: the tag
alone with the sentence in a `Tooltip`, an icon-only check when funded, nothing for the states the
card's column already states. Copy, actions and the dev preview live in `core/funding-ui.ts`
(`fundingSentence`, `fundingAction`, `fundingRollup`, `previewFunding`); the Dev Context Switcher's
`fundingState` axis forces a state. It has ONE home per surface: the ticket modal's footer, moved into
the Finances tab while that tab is open, status-only in `StageInspector` (prop `funding?`). The same
change adds `TicketView`'s `onBuyNow?` · `onAddToBasket?` · `onStartWork?` · `fundingBusy?`,
`TicketFinanceTab`'s `funding?`, `TicketCard`'s `side?`, the ticket chain's REPLACING `buy` frame
(`pushTicketBuy`, §B.10.9), `BuyNowTarget.ticket?` (a ticket purchase with the Payment Element in the
modal), and the Overview's `ReadyBlock` ("Ready to start?"). The freelancer's self-claim adds
`TicketView`'s `onClaim?` · `claimBusy?` (a filled **Claim ticket** in the footer actions, passed only
while `viewerCanClaim` holds); `onStart` is now offered only on a CLAIMED ticket, because Start work
on an unassigned one is a `move_ticket` the escrow sync must refuse.

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

Timeline / Gantt additions (root CLAUDE.md §8 Decision #91): one NEW sub-path **`@projective/ui/gantt`** — the
high-performance Timeline / Gantt engine, and the reuse point for every surface that lays work on a time axis: the
project timeline (`/projects/[id]/timeline`, one lane per stage), a stage's timeline (`/projects/[id]/[channel]/timeline`,
one lane per ticket), the ticket modal's **Timeline** tab (one lane per required stage, steps from the execution bands,
links band to band), and the calendar's fourth view mode, **Timeline** (`CalendarViewMode` gains `timeline`;
`components/TimelineView.tsx` is a pure MAPPING from the calendar's events onto the engine's lanes — one per event KIND —
and from the engine's gestures back onto the calendar's own `onOpenEvent`/`onQuickCreate`/`onExpandCreate`/`onMoveEvent`/
`renderEventActions`, so a host that wired the calendar gets the view for free and there is no second vocabulary for
"an event was opened"). It follows the Week grid's architecture exactly — tiered rendering (HTML chrome, ONE immediate-mode
canvas stage, a parallel accessible layer), a signal store that bypasses the VDOM, a swatch-reading theme bridge, sync
paint in a layout effect with no frame ever REQUIRED (every rAF loop is decoration over geometry that is already correct)
— and reuses the calendar's pure modules rather than copying them: its zoned-time matrix (`core/time.ts`),
`toCanvasColor`/`fitText`, the lever physics (`joystickVelocity` drives fly mode), the momentum constants and the
`packages/ui/core/motion.ts` springs. Nothing on it is fabricated: the DATA layer is a projection over the board
(`@projective/types/projects/timeline.ts` — `buildProjectTimeline`/`buildTicketTimeline`, pure and total, pinned by 14
tests), a stage with no scheduled window is an empty lane, a ticket with no date is counted in its lane's caption and
drawn nowhere, and a claimed ticket with no due date is a milestone at its claim rather than a bar to an invented end.
Two positions are flagged rather than silently taken: the viewport declares `touch-action: none` because the brief
mandates native pinch-to-zoom of the time scale, which reverses the calendar's logged WCAG 1.4.4 position that two-finger
gestures belong to the browser (Decision #75(c)); and the brief's `MobilePopup` names no primitive in this package, so the
mobile popover is a bottom-sheet `Drawer`.

AvailabilityScheduler additions (Decision #217, work order C10): `@projective/ui/calendar` gains the rule-based
availability editor of `flows/CATALOGUE_REBUILD.md` §5.4 as a compound component,
`AvailabilityScheduler = Object.assign(Root, { PresetBar, Toolbar, WeekCanvas, MonthPreview, RuleList, RuleEditor,
Issues, ShortcutSheet })` in `calendar/islands/availability-scheduler/`. `packages/ui` never imports
`@projective/types`, so the preset, rule, band, occurrence, explanation and issue shapes are structural mirrors and the
engine is injected (`SchedulerEngine { evaluate; explain; describe; validate; parseRRule; draftToRRule }`) — the Gantt
adapter precedent. State is one signal over a pure `reduce(state, action)` (undo depth 50); `createSchedulerStore`
projects the plan's signals and commits every draft change through `onChange`. `WeekCanvas` draws the active weekly
`add` rules as a `role="grid"` (7 days × 96 quarter hours, `aria-activedescendant` cursor, bands as named buttons
"Wednesday, 06:00 to 12:00, working hours, rule: …"); an edit to a band edits its RULE, so a band of a Mon–Fri rule
moves on all five days, and a cross-day move forks one band of a split shift into its own rule. Overnight drags are
stored as two bands joined by a continuation mark. The keyboard map is the pure `keyToAction(event, state, context)`;
a polite live region announces every create, move, resize and delete. `MonthPreview` shows evaluated band bars and
a summary per date and opens `explain()` in a `Popover` on click or Enter (not on hover: the popover traps focus).
The block sizes from its container (`.ui-avsched-scope` carries `container-type`; two columns from 64rem), so it
works unchanged inside a `Dialog` or on a page. Working bands are `--surface-3` with a `--outline` edge, call bands an
`--accent` tint with a 45° hatch, blackouts a crossed hatch; the drag ghost's `--avsched-ghost-opacity` reads
`--fld-loading-alpha` because the theme engine emits no state-layer alpha. The package has no component gallery, so
there is no demo entry; the two hosts (a full-height `Dialog` and the item workspace) land in work order C13.
Hosting rules, verified in a browser: render `Root` inside an app island (its `engine` holds functions, which cannot
cross an island boundary as props), and put the whole `Root` inside a `Dialog`, never only its parts — `BodyPortal`
mounts overlay content with a separate `render()`, so context does not reach a part portalled away from its `Root`.

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
- **Stored asset bytes come through the proxy, at a tier (Decision #162(A)).** A file thumbnail,
  tray item or preview resolves its address with `assetMediaSrc(asset, tier)` /
  `assetMediaSrcset(asset)` (`apps/web/features/files/core/asset-media.ts`) and draws through
  `ProgressiveImage` with `assetPlaceholder(asset)` (the stored BlurHash): `sm` (320px) for grid
  cells, table rows, trays and rails, `md` (1280px) for chat bubbles, the original or `lg` on a
  canvas. A row without stored bytes (a fixture, a web link, a connector file) falls back to its own
  URL; a storage host never reaches the markup.
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
- **Shipped tiers (Decision #217(m), 2026-10-14).** The SVG and Canvas2D tiers are built in
  `@projective/ui/display/charts` (`AreaChart`, `FunnelChart`, `HeatmapGrid`, `Sparkline`, with
  `StatTile`). A chart renders SVG while its entity count is under `DEFAULT_TIER_POLICY.threshold`
  (2,000) and switches to native Canvas2D past it, or after two consecutive SVG updates measured
  over `budgetMs` (8 ms; the first mount is never measured, because its commit carries the whole
  page's hydration). Both tiers draw the same `d3-shape` geometry and meet the same figure, caption,
  hidden-table and keyboard contract; canvas colours resolve through the theme-bridge and re-resolve
  on any theme attribute change. PIXI/WebGL stays reserved for the densest engines and is not used
  by these charts.

- **The DataTable virtualizer (Decision #224).** `useTableViewport` windows rows against the page or
  a scroller (a dialog's list passes `virtualize={false}`, Decision #67). Fixed heights are
  arithmetic; measured heights live in a Fenwick tree (`core/table-metrics.ts`), so one
  measurement and one offset lookup are O(log n), and a row above the fold that grows scrolls the
  page by the same amount, so nothing in view moves. A fixed height may be a signal: a zoom step
  rescales the scroll so the same row stays under the top edge, and rows are placed by
  `translateY(var(--dt-i) × var(--dt-row-h))`, so each spring frame writes one variable and
  re-renders no cell. Rows are class components that skip re-rendering unless what they show changed;
  the visible range is written only when it changes; the next page shows skeleton rows at the real
  column widths, so nothing shifts when it lands.

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

**One route renders no shell at all — the file inspector (Decision #161(C), flagged).** At the
product owner's direction `/inspect/[fileId]` lives in its own route group, `routes/(standalone)/`,
which has **no `_layout.tsx`**: the page renders straight inside `_app.tsx` (tokens, accessibility
overlays, `DevMount`), so neither `UserShell` nor `GuestShell` is constructed for any of the four
profiles. That is a fifth shell mode ("none") the four-profile matrix above and the D.6 rule ("a page
is not a candidate because it is dense, important, or 'wants to feel focused'") do not provide for; it
is logged as a flagged deviation, not a new profile, and nothing else may join the group without its
own decision. The page brings its own minimal frame instead (`apps/web/features/inspector/`, BEM block
`ins-`): a solid `--surface-1` top bar (the Projective mark linking `/`, the file name, inline
`--text-secondary` metadata, Download, full screen, the panel toggle) separated by one hairline from a
viewport-filling body — the canvas and, at `--bp-md` and up, a horizontal `Splitter` with a solid
details panel; below `--bp-md` the panel becomes a floating bottom sheet (the one place its
`backdrop-filter` scrim is sanctioned, §B.4.3). Floating zoom readouts over imagery may use the
glass `::before` underlay as marks on photography; every region background stays solid. The canvas
alone takes `touch-action: none` for pinch and pan, on the #159 precedent.

**The same canvases open in place, inside the file preview modal (Decision #162).** The modal
(`AttachmentPreviewModal`, BEM block `fx-modal`, `features/projects/components/preview/`) is a
hand-rolled `BodyPortal` workspace modal — not `Dialog` (#67(C)) — that mounts the inspector's own
viewer through `useInspectorHost(asset, { signedIn, embedded: true })` and the embed components in
`features/inspector/components/embed/` (`InspectorEmbedStage`, `InspectorChipBar`,
`InspectorEmbedControls`, `InspectorEmbedFacts`). An embedded shell runs with URL sync, printing
and document-level keys off (keys are scoped to the `data-ins-key-scope` panel), the stages hide
their own floating bars in favour of one on-canvas chip bar, and a 3D model hands off to `/inspect`
through a model card. On desktop the panel is a header (category glyph, the renameable name, inline
`--text-secondary` meta, Star · Download · Copy link · Open in new tab · the aside toggle · Close),
a horizontal `Splitter` of a solid `--bg` stage and a solid `--surface` aside (facts, the viewer's
controls, the source message, notes, shortcuts), and a thumbnail tray. **The mobile preview sheet:**
below `--bp-md` the panel goes fullscreen (`100dvh`, radius 0, no scrim drawn beneath an opaque
panel) and the aside becomes an in-panel `InspectorSheet` opened by a floating Info button — not a
portal, its own Escape layer (the first Escape closes the sheet, the second the modal),
swipe-down to dismiss with a grip, a half / full snap by drag or its Expand button, a solid
`--surface-1` panel over a solid tonal scrim with **no second blur** (`scrim="solid"`; `/inspect`
keeps its blurred `scrim="glass"`), focus moved in on open and back to the Info button on close,
and no animation under either reduced-motion channel. The chip bar carries zoom out · level · zoom in
· fit · rotate · reset for an image or SVG and page n/N + zoom for a PDF; pinch and twist stay on the
canvas only.

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
- **Keyboard toggle.** `Ctrl+B` / `Cmd+B` (no other modifier, not a held repeat, not a key a
  handler already took) toggles the rail from anywhere — EXCEPT while the viewer is typing: an
  input, textarea, select, any content-editable region and anywhere inside the rich-text editor
  (where the chord means bold) keep it (`features/shell/core/shortcuts.ts`, pinned by its test). The
  shortcut calls `preventDefault`, so the browser's own Ctrl+B (a bookmarks sidebar) never fires on
  top of it.
- **Toggle control.** A **labelless custom SVG** pinned **bottom-left** (sidebar footer): a rounded
  square framing a vertical dotted divider that **morphs** between the left edge (collapsed) and the
  right edge (expanded) via a CSS transform on `.shell-toggle__bar` — not a static icon swap.
- **Collapsed rail.** Items render as `--shell-nav-block` (48px) **square blocks** with one large
  icon. Each carries a real `@projective/ui` **`Tooltip`** (`placement="right"`, opacity fade) —
  never a native `title`. The visible label is hidden but the anchor keeps an `aria-label`, so
  icon-only items are never nameless. Icons are bespoke line glyphs (`nav-icons.tsx`) — Explore is a
  **minimalist compass**, Projects an **architectural arch structure**. (Settings was removed from
  the rail — account access lives in the header profile menu.)
- **Nested sub-links (YouTube-style).** Under **Projects**, an expandable disclosure of the viewer's
  most recently-active workspaces — each shown by its **owner's circular avatar** (never a generic
  icon); under **Teams** / **Businesses**, the entity the session is acting as. The Projects (and
  Catalogue) disclosures render **only once the viewer's own recent projects (and listings) have a
  read** — until then the entry is a plain link (Decision #296 (C)): the fixture list they carried
  showed every user the same two non-existent projects, four 404 listings and hot-linked avatars.
  **Analytics** leads to the acting context's real view — the team's or business's Analytics
  module, or a personal seller's `/catalogue?view=analytics` — and is withheld where there is none
  (there is no `/analytics` page). Sublinks show only in the expanded rail, keyed off a
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
    `enterprise` context.
  - **Notifications** and **Basket** each open a **right-side** sliding `Drawer` (the Drawer's solid
    `--surface` over the backdrop blur — the 92% glass veil was removed, §B.4.2; "View all" and the
    basket totals + checkout sit in the pinned `footer`). The basket drawer's **header is a switcher**
    (`BasketSwitcher`, grouped Personal / each team / each business, every basket and list with its
    count and selected subtotal, "New list" last); its **body** keeps the server's groups, the
    saved-for-later shelf and the loading / error / empty states, rows hairline-separated with no
    nested cards (§B.9.7), and a ticket or session line states what paying does in meta text
    ("Funds {freelancer} to start {ticket}. Held in escrow until you approve the work." / "Held in
    escrow until after the session."); its **footer** is Subtotal · Creator discounts · **Total
    before fees** in `tabular-nums` (a valid promo is a note below, never a third deduction — `net`
    excludes it), **View all baskets** (secondary) and **Proceed to Checkout** (primary, opens step 1),
    disabled with its reason stated when nothing is ticked. Every figure renders through
    `Amount`/`MoneyView` and follows a currency switch (Decision #70(D)/(k)). Both read live data through thin services:
    the basket through `BasketService`, notifications through `NotificationService` over
    `/api/notifications/*` — the drawer's anatomy, tabs, rows and live behaviour are §D.9.
    Unseen state shows as a **pulsing dot**, never a count (notifications: `/summary.unseen > 0`).
  - **User Profile** is the person's avatar inside a **profile-completion ring** (`ProfileProgressAvatar`
    — an `aria-hidden` two-circle SVG on `pathLength=100`, so `stroke-dashoffset` is the missing
    percentage; `--primary` arc on a neutral track, `--success` at 100%, offset transitions on
    `--ease-standard`, jump-to-final under both reduced-motion channels, `--outline` track under
    `data-contrast="high"`) with a **presence pip** at its foot: solid `--success` while inside a
    PUBLISHED working band, a hollow `--warning` ring outside one (hue AND fill, so it survives the
    CVD overlays), absent when no hours are published. Presence is derived from the hours and the
    clock, never chosen. No ring is drawn while completeness is unmeasured — never a ring at 0% for a
    profile nobody read. The trigger's `aria-label` speaks both ("Your account, profile 80% set up,
    away"). It opens the account Popover (`label="Account"` → a named `dialog`, portalled, first focus
    on the Acting-as row), top to bottom: the **identity block** (ringed avatar · name with its
    `VerificationStampBadge` crest · `@handle · Trusted standing` as inline meta text · the presence
    line, a link to the hours editor whose `Tooltip` is the weekly schedule); the **Acting as** row
    (the one tonal `--surface-1` fill — it is a control) opening the in-panel context switcher (the
    person, then Teams · Businesses · Enterprises); the **profile-setup nudge**
    (`AccountSetupNudge`, Decision #155 — the score is `org.fn_compute_profile_setup_progress`'s, a
    finished sign-up reading 40%): below 100% `Profile setup 60% · 2 steps left`, a slim
    `ProgressBar` and an inline checklist disclosure whose pending steps link to their editors; at
    100% the percentage gives way to the verification status (crest · "Payout verified"); beneath
    either, the ONE suggested next step as a filled `--primary` call to action (an `<a>` in the
    `ui-button` classes, so press feedback is the shared `transform: scale()`), with a one-line reason
    for a seller's earning gate — never for the freelancer unlock, which the destinations already
    offer. A milestone (a stamp landing, setup reaching 100%) is celebrated in place: a one-shot
    stamp on the ring and the crest and one transient toast, never a modal; directly beneath it, for anyone who
    sends proposals (a freelancer, or a team context), the **proposal allowance meter**
    (`AllowanceMeter`, `features/proposals/`, Decision #154) — one unboxed Meta-register row
    (`--text-xs` · `--fw-normal` · `--text-secondary`, figures `tabular-nums`): `Proposals: 38/50 weekly
    · 12/12 ready` as a link to the sent proposals on `/projects` whose portal `Tooltip` names the drip
    and the earned bonus, the refill line (`Next token in 2h 45m`, on the server's clock), and — at ≤ 5
    weekly or an empty buffer on a free plan — the text link `Accelerate volume with Pro →`; never a
    chip, never a bar; the destinations (**View profile ·
    Become a Freelancer** (buyer context only) **· Availability & hours · Wallet & payouts ·
    Settings**); and a footer rig — an icon-only **theme** control cycling light → dark → system at
    the start, **Log out** (`Button` text/danger) at the end. Display currency is NOT in this
    popover; it is switched from the wallet hero tools and the checkout stepper (Decision #149).
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

**The right panel (`MiddleNavPanel`, Decision #129)** is the lane's mirror on the inline-end side of
the frame. `useSplitter({ edge: "start" })` puts the handle on the panel's LEADING edge and inverts
the drag (toward inline-start widens); the same hook's `onKeyDown` gives the separator Arrow-key
resize (`step`, default 16px) and Home/End to `min`/`max`. It clamps to `min`/`max` (the app uses
280–520px, default 320px = the `--shell-panel-w` token), persists its width under its own storage key,
and hoists the live width onto `.ui-middle-nav` as `--shell-panel-w` so the canvas's viewport-fixed
surface can stop at its edge. It has no density bands — it is open at a readable width or closed
(`open` → `data-open`). Its body (`.ui-midnav-panel__body`) is its own `overscroll-behavior: contain`
scroll container, independent of the window scroll the canvas flows in; mid-drag the body takes no
pointer events. **Drag-to-close:** given `onCollapse`, a drag that would take the panel more than
`collapseDistance` (default 80px) below `min` arms a close — `data-collapse-pending`, the body recedes
to `--minor-fade` — and releasing there calls `onCollapse` instead of resizing, restoring the width the
drag started from (so it reopens at that width). The app closes the shared docked state, so the header's
Details toggle returns to inactive. Below the threshold the drag simply clamps at `min`. Built on
`useSplitter`'s opt-in `releaseCollapseAt` / `onReleaseCollapse` (+ `collapsePending`,
`onPointerCancel`, which never collapses).

### D.3 Mobile adaptive navigation

Below `--bp-md` (768px) the frame adapts:

- **Strict viewport isolation.** The desktop shell mechanics are **completely stripped** on mobile —
  no global sidebar, no middle-nav lane, no nested `ShellFrame` chrome. Every `ShellFrame`
  **flattens** (`--frame-radius: 0`, all `--hairline` seams removed) and the AppShell/MiddleNav
  content **gutters collapse to 0**, so the body is a single **full-width, un-nested,
  native-scrolling** column. The shell zeroes the rail's width variable (`--shell-sidebar-cur-w`)
  here, because every fixed frame fill and seam offsets itself by it — left at the desktop value they
  started 64px in on a phone and drew a hairline "L" down the page (Decisions #108(e) / #123), and the
  top bar's outer frame "L" is hidden like the nested frames' own seams. Only three things render: the glass mobile header, the flat main body,
  and the fixed `BottomNav`. This is pure CSS `@media` (no JS breakpoint / conditional render), so
  switching viewports never shifts layout or overlaps containers.
- **Backdrop-filter blur** surfaces (header/drawer/sheet use `backdrop-filter: blur()` over
  content).
- **Mobile-User header (`UserActions`).** Below `--bp-md` the trailing tray swaps its set via
  `.shell-util__slot--desktop`/`--mobile` (pure CSS — no JS breakpoint branching, so no hydration
  mismatch): the desktop **Create · Basket · Profile-Popover** give way to **Messages ·
  Notifications · Profile-avatar** (the same ringed avatar). The avatar toggles a right-side
  **account side-sheet** (`Drawer`) — identity · acting-as · setup nudge · destinations · theme ·
  log out — instead of the desktop Popover; the same `accountBody` feeds both so they never drift. (The integrated search is hidden
  here pending the mobile search overlay.)
- **Pull-out drawer side-menu** (the global sidebar becomes a `NavigationDrawer`, slides from the
  edge, focus-trapped).
- **Ergonomic bottom utility nav bar** — the `BottomNav` component (`@projective/ui/navigation`): a
  `position: fixed`, glass (blurred), single-top-hairline bar of **exactly five** thumb-reachable
  primaries — **Home · Explore · Create · Workspace** (Projects/Services) **· Calendar** — each an
  icon + short label with an active tint and a pulsing update-dot (never a count). Every primary
  leads to a route that exists (gate 11, Decision #296 (B)): **Create** opens the project
  Quick-Init modal (`/projects?create=1`, the Create menu's first entry — there is no `/create`
  page) and never lights itself (Workspace does); the fifth slot is **Calendar** because the former
  **Dashboard** pointed at the retired `/dashboard` (a 404 the `[handle]` route titled "Profile")
  and the dashboard IS `/home` (PRODUCT_SPEC sitemap), so it duplicated Home — the choice of fifth
  primary is FLAGGED for the owner. The destinations are the pure `bottom-nav-destinations.ts`. It is
  **mobile-only** (`display: none` ≥ `--bp-md`), so the shell renders it unconditionally; the page
  reserves `--shell-bottomnav-h` (+ `env(safe-area-inset-bottom)`) of trailing space so content
  never hides behind it. Icons are supplied by the app (`bottom-nav-model.tsx`) — the package stays
  icon-agnostic. Modals/side-panels auto-replace with the **bottom sheet** at this breakpoint. The
  file preview modal is the one workspace modal that instead goes fullscreen and moves its side panel
  into an in-panel bottom sheet (the mobile preview sheet, Part D intro; Decision #162(F)).

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
- **Compact tab strip (overflow collapse).** The tabs are one shared component,
  `ChannelTabStrip` (project `ChannelHeader` and messaging `ConversationHeader`). When the full strip
  would meet the trailing actions it collapses to ONE control: the active tab (glyph + label, no
  underline) centred between `prev`/`next` chevrons that step **circularly** and are never disabled
  (`aria-label` "Previous tab: X" / "Next tab: X"). Pressing the active tab opens a `Popover` picker
  listing every tab, the current one marked (`aria-current`, check glyph) and focused on open; Escape
  and an outside press dismiss it and focus returns to the trigger. A horizontal swipe on the active
  tab (≥ 44px, more horizontal than vertical; `touch-action: pan-y`) steps like the chevrons — left →
  next, right → previous — and a shorter drag stays a tap. The trigger is **measured, not a media
  query**: a hidden zero-size copy of the full strip (same `.chan-tab` rules, same `--chan-tabs-gap`)
  gives its natural width in either layout, and a `ResizeObserver` (header · copy · each action
  control) collapses once `(inner − tabs) / 2 − gap < actions + gap` (`core/tab-strip.ts`, pure and
  unit-tested). The rule reads only the NATURAL width, so the compact layout cannot feed back and
  flip it. SSR renders the full strip; a narrow header switches on hydration. With only ONE visible
  tab the strip shows nothing (`.chan-header__tabs--single`, `aria-hidden`): the nav stays as the
  empty centre spacer and the active tab stays in the DOM for the Chat canvas `:has` hook.
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
  at `max-width: 60%`. Each bubble sits on a **line** with a **side rail** literally beside it (on
  the bubble's inner side — right of another person's, left of the viewer's own): a **ghost**
  Reply·React·Copy toolbar and a `…` menu (Pin·Favourite; Pin gated by server-derived
  `canPin` — anyone in a DM, owner-granted in a project/team channel; Report is absent until a
  report flow exists, Decision #140(c), §3 gate 11) — no fill, border or shadow,
  only the buttons tint on hover — with the viewer's own sent time directly beneath it (Decision
  #131). The rail is always laid out and only fades on hover, so revealing it never shifts the feed;
  on touch (`hover: none`) it is not drawn at all — the long press and the swipe replace it. A favourited
  message carries a custom **"wonky star"** mark on its bubble border. Media lays out as an
  aspect-ratio row (≤3 visual media) or a rounded-square grid (mixed/overflow, **max 4 tiles**, the
  4th a `+N` overlay); audio memos reuse the composer's waveform visualizer; system-activity notices
  render inline and route to their target on click. Up to **3 pinned** messages sit in a sticky
  banner (one at a time, `‹`/`›` loop, Expand, and jump-to-message).
- **The conversation context panel (DM Chat tab, Decision #128).** A one-to-one conversation's
  Chat tab carries a panel at the thread's right edge: the counterpart (photo · name · `@handle` ·
  Standing as middot meta), the request between the two as unboxed hairline rows (a section header
  register, a lifecycle `Tag` — the one container, a status — then scope, questionnaire answers and
  milestones with `tabular-nums` prices) and an action rig whose controls the SERVER derived. From
  **1280px** it stands IN the flow beside the feed, `position: sticky` under the header band and
  sized to the viewport between the bands (the footer band's live height is measured, because the
  composer grows); it collapses from a **Details** toggle in the header actions, remembered per
  viewer. **Below 1280px** the same content is a right-docked `Drawer` (portal, modal, Escape and
  backdrop dismissal) that only ever opens when asked. Region background is the solid
  `--surface-1` with one inline-start hairline — no card, no shadow.
- **Composer autofocus.** Arriving on a conversation's or a stage channel's Chat tab focuses the
  composer field ONCE — for a precise pointer only (`(pointer: fine)`): on touch it would raise the
  keyboard over the thread being read — and never over focus the viewer has already placed.
- **Formatting and replies (Decision #131).** The composer field is a Quill editor (the shared
  `@projective/ui/editor` loader, no toolbar) that accepts exactly four marks. Highlighting text
  raises the **formatting bubble** — Bold · Italic · Strikethrough · Underline as `aria-pressed`
  toggles, glass on a `::before` underlay (the §B.4.3 extension below), portalled and fixed directly
  above the selection; the marks are also on Ctrl+B/I/U and Ctrl+Shift+X. A send stores the body
  twice — plain text and the normalised Quill Delta — and a bubble renders the Delta's runs as fixed
  elements around linkified text. **Reply** (toolbar, context menu, ←/→, swipe) puts a strip above
  the bar quoting who and what is being answered (× or Escape cancels); the sent reply's bubble opens
  with a tonal **quote** that jumps to the original, paging earlier history in first when needed.
- **Highlight mode, selection and the unfocused keyboard (Decision #131).** A right-click on a
  message (the browser menu is suppressed), Up/Down with the composer unfocused, or a Ctrl/Shift
  click enters **highlight mode**: every message neither selected nor under the keyboard cursor is
  blurred and stepped back (`filter: blur` + opacity — not `backdrop-filter`), the chosen ones lift
  with a ring and `--elevation-high`, and the cursor's message shows its actions as a **context
  menu** beside the bubble (portalled; the hover toolbar steps aside — one message menu on the page
  at a time, across islands). Holding **Shift** un-blurs the hovered message without selecting it. A
  plain click never highlights; it marks where the next arrow press starts. Ctrl-click toggles,
  Shift-click and Shift-arrow extend; a **count pill** ("3 selected" · Copy · Clear) hangs from a
  zero-height sticky anchor at the column's top. ←/→ reply to exactly one message (several is
  refused out loud), Ctrl+C copies the selection (several copy as a who/when transcript), Ctrl+↑/↓
  scroll, Escape leaves. With the composer unfocused, ordinary typing focuses it and appends at the
  end of the draft. A key is never taken from a field, a menu, a dialog, a Space meant for a focused
  button, or the other chat surface (the pop-out window owns the keyboard while focus is inside it).
- **Long messages (Decision #132).** Over 750 characters or 10 author-written lines (whichever comes
  first) a body is clamped to **four lines** (CSS `line-clamp` — the full text stays in the DOM)
  with a **Show more / Show less** text toggle beneath it in the bubble's own ink (`aria-expanded`,
  `aria-controls`). Over **4,000 characters** it is never expanded inline: the body becomes a card
  in the attachment idiom (type glyph · "Long message" · words · characters, `tabular-nums` · a
  two-line opening), a tint of the bubble's ink like the reply quote, that opens the full formatted
  text in a modal `Dialog` capped at `--measure`, portalled to `document.body` (the row carries a
  transform and, in highlight mode, a filter). Thresholds are read from the text, not the wrapped
  layout, so SSR and the island agree. The window-virtualized feed observes its rows with one
  `ResizeObserver` and re-measures a row whose height changes (an expansion, a late image).
  Attachment tiles are now new-tab links to the private-object route (the original for an image)
  and inert `<span>`s when an asset has no address — never a button that does nothing.
- **Touch (Decision #131).** Dragging a message sideways (either way) follows the finger with
  resistance and replies on release past the threshold — the reply cue appears at the edge it left;
  `touch-action: pan-y` keeps vertical scrolling. A **long press** selects the message, raises the
  glass **reaction bubble** above it, and enters tap-to-toggle selection; below `--bp-md` an action
  bar (close · count · Reply for one · Copy · Pin · Favourite) **replaces the site header**
  at its own height and tone, fixed over its slot.
- **Links in a bubble (Decision #128).** A written link is an underlined anchor in the text; a
  flagged one (suspicious · blocked) draws a wavy `--warning` underline. Beneath the text each link
  (three at most) gets ONE preview row of fixed shape — a 2rem lead (avatar · cover · re-hosted
  favicon · glyph), a title line and a meta line — in every state (checking · ready · flagged ·
  plain), so a verdict arriving never moves the feed. Rows are unboxed: one `currentColor`-mixed
  hairline separates them from the text, so they read on both bubble tones. The flagged state's
  label is the one container — a required disclosure — as a solid warning tint
  (`color-mix(--warning 40%, --surface)`) with `--on-surface` text; the filled `--warning` /
  `--on-warning` pair measured 3.2:1 at the badge's size and is not used for text this small.
- **Inbox rows — the action slot (Decision #128).** A lane conversation row ends in a fixed
  **48px slot** (`place-items: center`) holding the compact time (`now` · `5m` · `3h` · `2d` · `4w` ·
  `1y`, `tabular-nums`; the full label is spoken inside the row's link) above the unread dot. On
  hover, `:focus-within` or while its menu is open the time and dot fade out and a horizontal `…`
  (24px, `.ui-hit`) fades in — opacity only, `--dur-fast` `--ease-standard`, so the row never
  shifts; both reduced-motion channels drop the fade and the press scale. On a **coarse pointer**
  there is no hover, so the menu sits permanently beneath the time. The row's link stretches over
  the whole row (`::after`), so a press anywhere but the menu opens the conversation. The lane's
  folder tabs — Primary · Requests · Archived — are `LaneTabs` above the search, with the unread
  dot on Requests.
- **Channel-tree icons (§B.6).** Stage channels render as ordinary **`#` hash channels** (matching
  Team rows), not a coloured lifecycle dot; their state surfaces through the trailing icon-only
  status signal + unread dot. DM/team rows keep their **circular avatar** thumbnail.
- **The Project Details lane — four zones (Decision #133).** Top to bottom:
  1. **Project header** — the sticky Back · Star · kebab row over the card-less identity header.
  2. **Top tier** (`ProjectNavSection`) — the engagement's primary views as package `NavItem` rows.
     **Overview** leads every set (Decision #144): the engagement's root, its command center — left
     out only on the owner's draft, whose root forwards to Details, so the link would point back at
     the page it was pressed on. Then, archetype-specific: a **Task** gets Discussion · Files ·
     Submissions · Members (its Details view link was removed — Decision #163; the configuration is
     the footer's Edit project on every type); a
     **one-off** Discussion · Timeline · Files · Submissions · Members; a **pipeline** Discussion ·
     Board · Files · Submissions · Members; a **session** Discussion · Calendar · Files · Members
     (`projectViewLinks`, Decision #134). **Discussion** always links
     `/projects/[slug]/discussion`; it is absent — never a dead link — when the engagement has no
     room for it. A view's status is a trailing dot (the room's unread · a new ticket on Board · a
     revision on Submissions), spoken in the link's name. The list pulls out by the item's own
     inline margin so each row lines up with the content column. The active row is the package's
     filled `--primary` / `--on-primary` pair; its dot takes `currentColor`. That solid fill is not
     the translucent wash §B.4.2 prohibits, and it is held as shipped as a tier-3 navigation active
     state (§B.8.1) — but this is a middle-nav list, for which the directive also names
     `--surface-2` / `--on-surface`, so the row's final treatment waits on Decision #157 flag (k).
  3. **Contextual body** — a staged engagement's **STAGES** section (the owner's inline ＋ opens
     Create Stage) plus Teams / Private Messages when the viewer has something in them, under the
     quick filters; a Task's Overview (Status · Due · Owner · Assigned) and Tasks checklist; a
     session's panel. There is **no General folder**: the project-wide room is the top tier's
     Discussion, and a folder holding it beside that link would be one destination twice.
  4. **Utility footer** (`LaneFooter`) — the docked `LaneCollapseButton` and, for REVIEW AUTHORITY
     (the owner or an active client-business member, `viewerCanConfigure`), an icon-only **Edit
     project** link to `/details` (`LaneIconButton` with `href` and `fillWhenActive`, so it is a
     solid `--primary` / `--on-primary` fill while `/details` is open — Decisions #144 / #163) — not
     drawn for anybody else, whose way in is the top tier's Overview. It is the one way into the
     configuration on every type: a Task's top tier no longer carries Details (Decision #163).
     Nothing else.

  The identity header's engagement name is a paragraph, not an `<h1>` (the page owns the one title),
  at `--text-base` / `--fw-semibold`; its description is clamped to three lines with an in-place
  **Show details** disclosure (`aria-expanded`), drawn only while the text is actually clamped.

  Collapsed (`.ui-splitter[data-mode="collapsed"]`), `ProjectRail` mirrors the same view set as
  `--shell-nav-block` (48px) squares, each in a portal `Tooltip` with its status folded into the
  name, with Add stage · review authority's Edit project (`.proj-railbtn--edit`, the same solid
  `--primary` fill while `/details` is open) · the docked expand toggle at the foot. The
  expanded and collapsed toggles are one `LaneCollapseButton` hitbox.

**The frame panel (Decision #129).** `MiddleNav` takes an optional **`panel`** — a third grid column
(`.ui-middle-nav__panel`, `grid-template-columns: auto minmax(0, 1fr) auto`) that spans **all three
rows** on the inline-end side, as the lane does on the inline-start side — except under a header
band. The **header band spans the panel column too** (`grid-column: 2 / -1`), so its trailing
actions keep one position whether the panel is open, closed or being dragged; the panel then starts
below the band (`grid-row: 2 / -1`, pinned at `--shell-topbar-h + --shell-midnav-header-h`). The
**footer band runs only between the lane and the panel**, and the panel runs to the viewport bottom,
cutting through the footer band's row. It takes the lane's
geometry for the lane's reasons: `sticky` at `--shell-topbar-h`, `max-block-size` as a cap (never a
definite height, so it never bids the `1fr` row up), `align-self: stretch`. With a panel docked, the
Green canvas becomes a **card rounded on all four exposed corners**: `.ui-page-canvas::before`
subtracts `--shell-panel-cur-w` from its width, adds the `--hairline` end seam (coincident with the
panel's resize track) and rounds its end corners to mirror its start corners (top always; bottom
when a footer band sits beneath). `--shell-panel-cur-w` is `0px` unless a panel stands open — keyed
on the panel's own `data-open` and the docking breakpoint, so width, seam and corners cannot
disagree. The panel **docks only from 1280px**; below that the wrapper is `display: none` and the
registering surface presents the same content as a right `Drawer`. The slot is filled per route by
`middleNavPanelFor` in the dashboard layout (`UserShell`'s `middleNavPanel`, wrapped in the
`MiddleNavPanel` island): a one-to-one conversation's context panel on `/messages/[id]`
(`conversationPanelFor`) and a project channel's Task · Stage · Channel details on its Chat view
(`channelPanelFor`). Other tabs register none — the board, files and timeline views keep the canvas's
full width, and their Details control opens the drawer. Docked open/closed is ONE shell preference
(`features/shell/core/context-panel-state.ts`), toggled from the header band's Details control.

### D.5 Guest floating shell

For **guests** the shell is not the nested L-frame — it is one floating composition, `GuestShell`
(`apps/web/features/shell/`), used verbatim on every guest-reachable route (the `(public)` surfaces
and `/[handle]`). It layers floating, glassmorphic panels over a **full-bleed body**, reusing the
marketing `.site` / `.site__main` base (the fixed → pill-on-scroll `SiteHeader`, the reserved header
band, and `overflow-x: clip`), so lane-less routes (`/`, both Explore states) are structurally
unchanged:

- **Floating pill header.** The unchanged `SiteHeader` (full-width, morphing to a glass pill on
  scroll, discovery megamenus intact) is the top chrome on **all** guest routes — replacing both the
  prior marketing-only header and the guest `AppShell` `ui-shell-topbar`.
- **Keyboard path (Decision #176).** The shell's first Tab stop is a "Skip to content" link
  (`.guest-shell__skip`, off-screen until focused) to the `<main>` landmark, which carries
  `PAGE_CANVAS_MAIN_ID` and `tabIndex={-1}` — the same target as `AppShell`'s `skipTo`. A megamenu
  panel is `inert` while closed and opens on hover or the trigger's Enter/Space, never on focus, so
  Tab crosses the four pillar triggers rather than every link behind them; Escape closes it and
  returns focus to its trigger, and focus leaving the pillar closes it. The `PublicFooter` link
  stacks (`FooterLinkGroups`) are open columns from `--bp-md` up (`::details-content` on first paint,
  then `open` with the summary out of the tab order) and `<details>` accordions below it; their
  Feedback entry is a real `/feedback` link that opens the board's drawer on a plain click.
- **Side nav (route-driven).** When a route supplies a lane (today only an article's table of
  contents, `viewLaneFor`; every other Entity View renders its conversion rail as a page column
  — §D.7 — the profile mounts NONE since Decision #96, and the Explore Search filters mount none
  since Decision #115) it mounts in a glass `.ui-guest-aside` (rounded, glass) —
  the guest counterpart of the middle-nav lane, but with **no drag-resize splitter handle**. It is
  an **in-flow `position: sticky`** flex item of `.guest-shell__region` (Decision #40 changed it
  from `position: fixed`): it pins below the header while the page scrolls, but is bounded by the
  region so it **terminates cleanly above the full-width footer** instead of overlapping it.
  Collapse/expand is the lane's own footer toggle, driving the same `MIDDLE_LANE_TOGGLE_EVENT`; the
  state is cached (`LocalKeys.GUEST_NAV_COLLAPSED`) and expressed on the **pre-painted**
  `:root[data-guest-nav]` (mirroring the authed rail's `:root[data-sidebar]`), so the width paints
  correctly on the first byte (no flash-of-wrong-width).
- **A lane whose placement is a function of the page's own layout is the page's to render.** The
  shell can place a lane beside the whole body and nowhere else, so a panel that must align with
  something INSIDE the body is not a shell lane. The Explore Search Results are the worked case
  (Decision #115): a guest's filter column is the results body's inline-start column
  (`.ex-dash__aside`, rendered by the dashboard island), so its top is the results bar's top and the
  results head above it spans the page; the shell's floating aside would have sat beside the head as
  well and forced it to two-thirds width. The column takes the aside's geometry — the same
  `position: sticky` pin under the scrolled pill (`--site-header-pinned-h`), the same gap and
  viewport-based height — but its surface is a SOLID `--surface-1` step, no shadow and no glass:
  §B.4.3's grandfathering covers the shell's aside only, and the `/view` conversion rail took the same
  position for the same reason. The signed-in frame is untouched — its middle-nav lane is a full-height
  column beside the whole content pane by design, and the Explore filters still mount there.
- **Full-width footer + flex-column region (Decision #40).** On lane routes GuestShell is a flex
  column: the aside + body share a growing `.guest-shell__region` (`flex: 1 0 auto`) above a
  **full-width `PublicFooter`** that is a sibling of the region — so the footer spans the whole
  window (never inheriting the aside's inline gutter) and pins to the viewport bottom on short
  pages. Lane-less routes keep the plain `.site` block flow with the footer AFTER `<main>` (already
  full-width). On every guest route the footer is a sibling of `<main>`, never inside it, so it is
  the page's `contentinfo` landmark (Decision #279). The signed-in public pages still mount it at the
  end of the canvas's `<main>` (`UserShell.bodyFooter`) — flagged in #279.
- **Floating sub-header (route-driven).** A route sticky header (the Entity View's
  `EntityStickyHeader`; the profile's `ProfileStickyHeader`, back since Decision #111) mounts in a
  floating `.guest-shell__subheader` beneath the site header, adjacent to the side nav, revealed on
  scroll. It overlays the body (no reserved band). The profile's section tab bar pins a small gap
  beneath it (`--site-header-h` + `--shell-midnav-header-h` + `--space-2`) and, below the phone
  cusp where this sub-header is not rendered, under the scrolled pill (`--site-header-pinned-h`).
- **Glass on a `::before` underlay.** Both floating panels carry their `backdrop-filter` on a
  `::before` (not the element), so neither becomes a containing block for the `position: fixed`
  overlays the lane renders (the view lane's kebab Popover) — the same fixed-overlay-trap fix as
  `.ui-shell-topbar--glass::before` (root CLAUDE.md §8 #8/#9).
- **Mobile (`< --bp-md`).** The floating side nav + sub-header `display: none`; the body gutters
  collapse — header + full-bleed native-scrolling body only (Part D.3).

Content chrome written for the authed frame (the profile tab-bar sticky offset, which assumes
`--shell-topbar-h`) is re-based under `.guest-shell` to the site-header height `--site-header-h`.

### D.6 Focus chrome (the distraction-free mode)

**Focus chrome is a chrome _density_, not a fifth navigation profile.** The four profiles above are
resolved by form factor × auth and describe _which shell composes the page_; focus chrome is a
property of the **route** that says how much of that shell is constructed. It applies to the
authenticated profiles (2 and 4) and is expressed as one prop — `AppShell`/`UserShell`
`chrome?: ShellChrome` (`"full" | "focus" | "bare"`, default `"full"`,
`packages/ui/navigation/components/AppShell.tsx`) — which stamps `data-chrome="focus"` (or `"bare"`)
on `.ui-app-shell` as the single CSS hook. In `focus` the shell renders **no global sidebar, no lane,
no header search, no utility bar and no `BottomNav`**; the top bar keeps only the brand mark.

**`bare` is for a page another surface frames.** Today that is only the catalogue's buyer
simulation, `/catalogue/[id]/simulate`, which the item workspace's Preview tab renders in an
`<iframe>` (Decision #217 (j)). `bare` withholds everything `focus` does, and the top bar and both
middle-nav bands as well: only the canvas renders. The dashboard layout resolves no slots for it,
and mounts none of its floating hosts. A same-origin frame shares the tab's sessionStorage, so the
pop-out chat would otherwise re-seed inside the preview. `app-shell.css` zeroes `--shell-topbar-h`
and the frame insets on the bare root, so every sticky offset re-bases onto the frame's own top
edge. It is a density for a FRAMED page, never a way to make an ordinary page feel focused.

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
The shell-free file inspector is NOT focus chrome and does not relax this rule: it constructs no
shell at all, is an owner-directed exception, and is flagged as such (Part D intro; Decision #161(C)).

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

**The two checkout focus steps keep a keyboard ring (Decision #153 — a flagged exception).** The
product-wide "no visible focus indicator" directive (`apps/web/styles/global.css`, commit `152a27a`)
neutralises every `--focus-ring-*` token. Details and Payment are committing forms a buyer walks with
Enter and Tab, and their brief asks for the ring, so `checkout-shared.css` draws one inside `.ckod` and
`.cko-pstep` only: private `--cko-ring*` tokens derived as the engine derives `--focus-ring`
(`--secondary`; 1px, 2px under `data-contrast="high"`; held 2px clear), one `outline` for controls and
for composite fields (`.ui-field:has(:focus-visible)`). The contradiction with the global directive is
logged for a human; deleting that one region restores the directive here too.

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
   actions live in the kebab, not on the lane**: _Share listing · Save · Add to collection… · Request
   custom scope_ (a project lane: _Share project · Save project_). Save is a bookmark (the project's
   star on a project), filed into a named collection through `CollectionPicker` (Decision #180);
   Report was removed with no backend behind it (§3 gate 11). Each is one decision the buyer is not currently making, and every
   one promoted to a visible button competes with the one they are.
2. **Price.** The converted local figure in **`--text-2xl` (1.75rem), `--fw-medium`, `tabular-nums`**
   through `MoneyView` (§C.1) — so a currency switch re-projects it and the origin is disclosed
   rather than hidden. The creator's original currency sits directly beneath in **`--text-sm`
   (0.8125rem), `--text-secondary`** (`Orig. £76.99 GBP`). Two registers, one figure; never two
   equally-weighted numbers, which reads as two prices. A discount delta, where one applies, is a
   third line in Meta register carrying both the struck original and the saving — never a chip.
3. **Primary CTA — one, full-width pill.** Its label is the archetype's actual verb:
   **Buy now** · **Book session** · **Reserve seat** · **Fund Stage 1** · **Apply to project**. A
   money verb is tier 1 amber (`--accent` / `--on-accent`); _Apply to project_ is teal (§D.7.7,
   Decision #183).
4. **Secondary CTA — one, full-width, MONOCHROME pill.** _Add to basket_. Solid `--on-surface` on
   `--surface`, same height and radius as the primary, ranked below it by hue rather than by emphasis
   (§D.7.7).
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
same pattern as the `/wallet` header switcher (§8 Decision #63): **a duty removed from one region is re-homed in another, never rendered twice.**
For a restricted (13–17) viewer (Decision #192) the duty is an EXPLANATION, not a transaction: the lane
and the body-side block each hold one unboxed `InlineNotice` ("Buying services and selling work unlock
on your 18th birthday…", `RESTRICTED_REFUSAL`) instead of the price and the Buy / Book / Apply controls
(`RestrictedLaneNotice`, `placement` `lane` | `body`, the body one riding `.evp-buybar`'s
breakpoint) — still one region at a time, and no control that would only be refused (§3 gate 11).

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
  honoured. Recorded in `profile-skeleton.css`, verified twice.
- **The band root must carry `.pf-stickyhead`.** That is load-bearing, not cosmetic reuse: the guest
  shell keys its glass underlay, hairline and elevation off the literal selector
  `.guest-shell__subheader:has(.pf-stickyhead[data-condensed="true"])`. A band that drops the class
  renders unstyled for guests **while looking correct when signed in**, which is the worst shape a
  regression can take.
- **The probe measures once on mount, before any event.** A deep link into the middle of a page, a
  restored scroll position, or a throttling environment must still resolve the correct initial state.

**The probe, the signal and the back control are the SHELL's, shared by every surface that registers
a band** (`apps/web/features/shell/{core/migrating-header.ts,hooks/useMigratingHeader.ts,components/MigratingBack.tsx,styles/migrating-back.css}`,
Decision #112). One `headerCondensed` signal and one `useMigratingHeader(anchor)` hook — the entity
view attaches it to its hero (a zero-height sentinel as the hero's last child), the profile to its
hero's action rig — so the two surfaces condense on one rule: the band reveals when the anchor's
bottom edge passes under the line the band itself pins to (measured off the band element, never a
token), leaves one band-height lower in the authenticated frame (the hysteresis below), and never
condenses at all where no band is rendered (a guest phone, whose sub-header is `display: none`) —
which is what lets the page keep its own back control there without a per-shell CSS exception.

**The way out is ONE control with two homes.** `MigratingBack` renders the Explore tree's contextual
`ExploreBackNav` as the page copy (arrow + "Back", in the meta register, near the top of the content
area) and as the band copy (the compact circle, §B.6, with the destination in a portal `Tooltip` +
`aria-label`). The probe's write withdraws the page copy with `visibility` on
`:root[data-header-condensed]` — its box left in place, so nothing shifts on the crossing — in the
same instant `.pf-stickyhead`'s own `visibility` gating reveals the band copy, so a keyboard or
screen-reader user meets exactly one "Back" at every scroll position (§D.7.4 — moved, never
duplicated). **Focus follows the hand-over**: if the copy about to withdraw holds focus, the copy
taking over receives it, with `preventScroll` so the hand-over never moves the page — and it is
deferred one macrotask, because the signal write only QUEUES the band's re-render and a synchronous
`focus()` lands on a band still `visibility: hidden` (measured: focus fell to `<body>`). The band's
box is `inline-size: 100%` of its header container in the authenticated frame with no margin or cap
of its own; the `--space-4` inline inset is the skeleton's content gutter, declared once.

**The profile's band is the one exception to the control rule, and the reason is structural, not a
preference.** `ProfileStickyHeader` (`/[handle]`, Decision #111) carries the hero's own action rig
in its compact size — Hire · Add to project · Message · Follow, or Message · Follow, or Settings ·
Share — because a profile has no body-side transactional block for the duty to transfer to: the
rig IS the hero's, and once it has scrolled away nothing else on the page can open the
conversation or the hire flow. What keeps §B.8.2 whole is the **probe's threshold**: it watches the
rig itself (the shell's `useMigratingHeader`, anchored on the rig), so the band reveals exactly as the rig's bottom edge
passes under the band's pinned line and the two copies of the filled Hire are mutually exclusive
by render condition. The rig is ONE component (`ProfileRig`) rendered twice, its handlers ONE
module (`core/rig-actions.ts`), and its modals are mounted once, in the hero, on shared signals —
a row picked in the band's popover opens the modal a row picked in the hero's would. Two further
facts are load-bearing: **the hysteresis is the band's own height** (in the authenticated frame the
reveal grows the band's grid row and shifts the page beneath it, so a single threshold oscillates —
the rule to leave the condensed state sits one band-height below the rule to enter it; the guest
band is `fixed` and takes a small margin instead); and **secondary text on the glass is
`--on-surface-variant`, never `--text-secondary`** — at the 76% chrome veil over a white tile the
variant measures 4.83:1 in dark and 4.77:1 in light where `--text-secondary` measures 3.59:1 and
3.28:1. On a guest phone the sub-header is not rendered, and the hero's rig scrolls away like any
in-flow control — recorded here, not solved.

**The profile's tab bar is the page's own sticky element and has two states in one box.** In flow it
is a full-width strip: transparent, sharp-cornered, closed by the one hairline the active tab's
underline lands on. Stuck — a small gap (`--space-2`) beneath the band — it becomes a floating
pill of the tabs' own content width: the strip lets go of its hairline while the `.pf-tabs__pill`
around the tabs takes the band's own glass (the same veil, blur, saturation and hairline, on a
`::before` underlay) plus `--elevation-medium`, and the strip around it passes pointer events
through to the content beneath. The transition moves only `border-color`, `opacity` and
`box-shadow` — no width, padding or height — so it costs no layout and CLS is 0 by construction.
CSS has no `:stuck`, so a zero-height sentinel marks the natural position and the island compares
it against the bar's own computed `top` (the offset lives in the stylesheet and nowhere else),
re-measuring a beat after the band flips because that reveal moves the page with no scroll event.

> **On IntersectionObserver.** The obvious implementation is an observer on the hero, and the brief
> that requested this feature named it first. It was built that way and then replaced. In this repo's
> preview harness **neither observer callbacks nor `scroll` events fire** — both are compositor-driven
> and it does not composite — while `scrollY` moves normally, so neither mechanism can be verified
> there. Given two unverifiable options, the shipped one wins: a passive `scroll` listener is what the
> profile and project views already run in production. The observer is the better mechanism and should
> replace this the moment there is somewhere to prove it works; it is not currently a correctness
> question but a verifiability one.

**D.7.7 The action rig is ranked by hue.**

Two rigs share this idiom and they are not the same rig, so which control takes which tier of the
Button Interaction Matrix (§B.8.1, Decision #157) is stated per control:

| Rig                                | Control                                                                 | Tier (§B.8.1)                         | Treatment                           |
| :--------------------------------- | :---------------------------------------------------------------------- | :------------------------------------ | :---------------------------------- |
| Profile hero + band (`ProfileRig`) | **Hire**                                                                | 3 · brand (Decision #183)             | teal `--primary` pill, white ink    |
| Profile hero + band (`ProfileRig`) | **Add to project** — beside Hire or alone                               | 2 · structural commitment             | monochrome inverted pill            |
| Profile hero + band (`ProfileRig`) | Seller rig: Message · Follow (a team's Message reaches its owner)       | 4 · neutral outlined, icon-only       | `neutral` `outlined` circle         |
| Profile hero + band (`ProfileRig`) | Team rig, a member who may edit it: Manage team (an `<a>`, Hire's slot) | 4 · neutral outlined (Teams P1)       | `neutral` `outlined` pill           |
| Profile hero + band (`ProfileRig`) | Buyer rig (client · enterprise): Message · Follow                       | 4 · neutral outlined                  | `neutral` `outlined` text pill      |
| Profile hero + band (`ProfileRig`) | Business rig: **Message** (reaches the owner)                           | 3 · brand (Decision #244)             | teal `--primary` pill, white ink    |
| Profile hero + band (`ProfileRig`) | Business rig: Follow                                                    | 4 · neutral outlined, icon-only       | `neutral` `outlined` circle         |
| Profile hero + band (`ProfileRig`) | Business rig, a member who may edit it: Manage business (an `<a>`)      | 4 · neutral outlined                  | `neutral` `outlined` pill           |
| Profile hero + band (`ProfileRig`) | Owner rig: Settings (an `<a>`) · Share                                  | 4 · neutral outlined                  | `neutral` `outlined` pill           |
| Entity-view lane (§D.7.2 item 3)   | Primary CTA, non-financial verb (_Apply to project_)                    | 3 · brand (Decision #183 flag (c))    | teal `--primary` pill               |
| Entity-view lane (§D.7.2 item 3)   | Primary CTA, money verb (_Buy now_ · _Book session_ · _Fund Stage 1_ …) | 1 · terminal conversion               | amber `--accent` pill (`accent`)    |
| Entity-view lane (§D.7.2 item 4)   | _Add to basket_                                                         | 2 · structural commitment             | monochrome inverted pill (`mono`)   |
| Entity-view lane (§D.7.2 item 5)   | _Message seller_                                                        | 5 · ghost                             | `text`                              |

The entity-view commerce lane is the matrix's canonical two-fill case: the amber money verb beside
the monochrome Add to basket, ranked by hue (§B.8.2). The profile seller rig's teal Hire beside
monochrome Add to project is an owner-directed exception scoped to `ProfileRig` (Decision #183
flag (a)); the client / enterprise buyer rig and the owner rig have no filled control at all —
§B.8.2 caps fills at one and sets no minimum — and the business rig has at most one, its Message,
which a member who may edit the business sees as the tier-4 Manage business link instead, and which
is withheld (Follow then stands alone) when the read names no owner for it to reach (Decision #244;
the business rig's Message is the `Button` `severity="primary" variant="filled"` preset, the same
class set as Hire). A team's editor sees the tier-4 Manage team link in Hire's place, so their rig
keeps one fill — Add to project's monochrome pill — and the team rig withholds its Message icon
when the read names no owner for it to reach (Teams P1; `rigFills` / `rigFor` in
`features/profile/core/profile-model.ts`). Manage team is twice Hire's width, so below the phone cusp
one control per rig gives up its words: the band folds Manage team to a `settings` glyph circle, and
the hero folds Add to project to its `plus` circle (as the band already does) so Manage team keeps
the words the owner header's preview note names; a folded control's label is its accessible name.
The member notice above a business page outsiders cannot
open (`ProfileMemberNotice`) carries no control: BP1's tier-4 link to Settings waits for a Settings
screen that can publish a business or change its visibility (Decision #244 (d)). A TEAM page's
notice waits on the same ground (root CLAUDE.md §3.11): its tier-4 "Team settings" link (`neutral`
`outlined` `sm` pill, an `<a>`) to the console's Settings, for a `manage_settings` holder, beside
the line and wrapping beneath it on a phone (Teams P1 SPEC 1), renders once Teams C6 gives the
team's Settings screen Publish and Visibility — `SETTINGS_PUBLISHES` in
`features/profile/core/profile-model.ts` is the one switch. The markup per tier: Hire is the bare
`ui-button--primary ui-button--filled ui-button--rounded` class set on a native `<button>` (its
`Popover` needs the ref `Button` does not forward), with no rig-local colour override; Add to project is `ui-button--primary ui-button--filled` plus `.pf-rig__cta--mono`, the
inverted override, wherever it renders; every tier-4 control is the shared
`severity="neutral" variant="outlined"` preset (`ui-button--neutral ui-button--outlined` on the
Settings anchor), the rig keeping only a muted ink for a pressed Follow
(`.pf-rig__cta--neutral[aria-pressed="true"]`). The entity-view lane's tones are `CtaButton` /
`CtaLink`'s `CtaTone`: `BookingCtaRig` passes `accent` to its primary (button and link forms alike)
and `mono` to a `filled` Add to basket; each tone carries its own tonal ramp (`accent` the
`.ui-button--accent` ramp toward `--on-scrim`, `mono` the `.pf-rig__cta--mono` ramp toward
`--surface`) and withdraws the brand's border-channel hover. Every other `CtaButton` keeps the
default teal `inverted` tone (Decision #183, resolving #157 flag (f)).

The monochrome fill — the lane's Add to basket, and the profile rig's Add to project — is **inverted**: the
page's ink colour as its fill. Expressed as
`--btn-accent: var(--on-surface); --btn-on: var(--surface)` — the inverted-surface idiom the system
already has in `Tooltip` — the pair swaps sides with the theme by construction, so one declaration is
correct in both directions: near-white on near-black in light, near-black on near-white in dark.
The shared spelling of this override is `<Button structural>` (`.ui-button--structural`, §B.8.1),
and `LaneCreateButton` wears the same pair (Decision #228 (D)). The two rig overrides above —
`.pf-rig__cta--mono` and `CtaTone` `mono` — predate it and keep their own tonal ramp toward
`--surface`; the structural tone and the lane pill take the zero step with the border-channel hover.

**Measured, because the alternative was not viable.** The inverted pill is **17.14:1** light /
**14.93:1** dark, and it *improves* under `data-contrast="high"` (~20:1 both), so it needs no
accessibility carve-out and is unaffected by the colour-blindness overlays, being achromatic.

**Historical (pre-#183): in the entity-view lane**, the secondary carried the brand teal, and **its
ink was `--surface` too**. (Since Decision #183 the lane's teal is gone and the profile's Hire is
the teal fill, on the mode-invariant `--on-primary`.)
Solid `--primary` with white text measures **5.38:1 in light** (correct, and literally white) but
**3.75:1 in dark**, and the token pair `--on-primary` measures **3.57:1** there. Both then *collapse*
under `data-contrast="high"` in dark — **2.52:1** and **1.75:1** — so the overlay meant to rescue
them makes them unreadable. `--surface` resolves to `#ffffff` in light and `#0b0f0f` in dark, so it
**is** the white text where white works and flips where it does not: 5.38:1 / 5.15:1.

> **Root cause — FIXED at the token layer (§B.12.2).** `theme-engine.ts` set dark
> `--primary: a1.tone(fg(55))` and `--on-primary: a1.tone(on(98))` — both above mid-tone 50, which
> violated the file's own stated invariant that a colour and its `on-` pair must straddle it. Every
> other dark `on-` pair correctly used `on(20)`, and the comment directly above the offending line
> described code that was not there. That is the defect flagged since §8 Decision #64 and routed
> around seven times. It is now resolved a different way: `--primary` and `--on-primary` are
> **mode-invariant** (§A.1.1, product owner 2026-09-07), resolving from raw tone constants in both
> branches, so the pair is `#007680` on `#ebfdff` — **5.13:1** — in light, dark, and both
> high-contrast states. It is pinned by test, so it cannot silently drift back.
>
> The measurements above are therefore **historical**, and the rig's own reasoning survives them
> intact: `--surface` is still the right ink for the brand secondary here, because it is achromatic
> and swaps sides with the theme by construction. What changed is that it is no longer the *only*
> viable choice — a filled `--primary` control elsewhere in the product now clears AA on its own token
> pair in every state, rather than 3.57:1 in dark and 1.75:1 under the overlay.

Geometry (entity-view lane): both pills are `--radius-full`, `--fw-medium`, and **36px** tall. The
profile rig's pills are `--radius-full` too, but take the Button `size` ramp the rig is rendered
at per placement (hero, sticky band), and are not bound by this height. That height is
deliberately OFF the `--fld-h-*` ramp, which steps 32 → 40 → 48 — a compact commit control is neither
of its neighbours. It stays on the ramp's own 4px grid, and if the pattern spreads the ramp should
gain the step rather than each surface re-declaring it.

> **§B.8.2 note.** Both rigs can render two solid fills (the profile's seller rig does; its buyer and
> owner rigs render none), which the one-`filled`-per-decision-region cap
> reads as a violation. The entity-view lane is the sanctioned case the matrix names: the amber
> money verb against the monochrome basket, ranked by HUE rather than by emphasis, so the hierarchy
> a reader perceives is intact — which is what the cap protects. The profile rig's teal Hire against
> monochrome Add to project is an owner-directed exception scoped to `ProfileRig` (Decision #183
> flag (a)). Neither generalises: two fills of the same colour, or any pair other than amber +
> monochrome, remains a finding on every other surface.

**D.7.8 The canvas is content-first.**

Structured information leads and media trails: title, metadata, summary, seller, then the stage
ledger / scope checklist / specification tables on the **inline-start** side, with the media showcase
on the **inline-end**. A listing is evaluated by reading, and a gallery-first canvas makes the reader
scroll past pictures to reach the terms.

**The columns are reversed in the DOM, never with `order` or `direction`.** Those move the boxes and
leave the reading and tab order behind, so a keyboard or screen-reader user would traverse a strip of
thumbnails before reaching the title of the thing they are being asked to buy. Reversing the source is
the only version that moves both, and it is the version that survives the mobile stack for free.

**D.7.9 The cross-sell is Explore's rail, contained.** "More by …", "Similar & recommended" and the
article's "Suggested" sections (`RelatedSection`, `apps/web/features/view/components/RelatedRail.tsx`)
are built from the `/explore` section module, not from `@projective/ui/display`'s `Carousel` (§8
Decision #177, reversing #43's choice). One idiom across Explore and the view page means a reader
learns the drag, the progress separator and the arrows once.

- **Composition.** A non-project block is `HomeRail` → `RailFrame` with `variant="contained"`, its
  cards server-rendered `RailCell` + `EntityCard productLayout="fixed"` children. A project block is
  `HomeGrid` with `columns` 2 (default) or 3 (a project page's "Similar"), capped at two rows. A
  section with one format IS that rail (heading level 2). A section with two is a titled set whose
  blocks take `RailHeading level={3}`, the section-header register (§A.4), never the same size as
  the section heading at a different weight. "See all" is the module's `action` slot
  (`.ex-viewall.ex-rail__action`) and the heading links to the same place, so the destination
  survives the phone header where the action folds away. The subtitle is `RailFrame` / `HomeGrid`
  `subtitle`, in the Meta register, pulled up to its heading.
- **Contained, not bled.** The track stops at its column; past it is the conversion lane (§D.7.1),
  not the viewport edge. Cells size to the column, never the viewport:
  `--ex-cell-w: clamp(17rem, 30cqi, 19rem)` against `.vw-related { container-type: inline-size }`.
  The floor is the widest service card's kind + delivery row, measured at 269px across the corpus
  ("Direct deliverable · 7-day delivery"). A 14rem floor truncated it in the article's 728px column
  at 1440. 30% of the column leaves the next card peeking at every width, including a 390px phone
  (one 272px card + an 86px peek). The cards are SSR-sized by CSS alone, with no script-measured
  slide widths, so hydration moves nothing.
- **Edge states (all rails, both surfaces).** The arrows are withheld (`visibility`) whenever
  `data-scrollable="false"`. A single-cell rail withholds them from the server render on.
  They are pinned to the trailing edge (`margin-inline-start: auto`), so a phone header without
  its progress track or action does not leave them beside the title. The track carries
  `overscroll-behavior-x: contain`. `useCarousel`'s `atStart` / `atEnd` and
  `pageScroll` read a right-to-left track's negative `scrollLeft` correctly, and the paging glyphs
  flip under `dir="rtl"`.
- **Carriers.** `RailFrame` imports `explore.css` · `explore-home.css` · `rail.css`.
  `ViewStyleAnchor` imports them too, because a cross-sell made only of project grids mounts no rail
  island.

**D.7.10 A project's workspace is not an entity view.** The lane gate governs `/view/[entity]` and
`/[handle]/view/[item]`, where a buyer evaluates an offer. `/projects/[slug]/…` is the participants'
workspace for work already bought, and funding a stage there (Decision #197) is not a listing
purchase: it lives in the stage board's one-line money sentence and opens `FundStageDialog` — never a
sticky column, never a price in the board's header band, and never on `/view`. The `/view` pipeline
lane's **Fund Stage 1** stays what it is, the listing's purchase through checkout. One transaction
still has one home per surface: the stage board offers **Fund stage**, the project board **Fund all**,
never both on one board.

> **Merge gate.** A view-page PR is not mergeable if it introduces a third sticky column, renders a
> price or a purchase control in the main stage on desktop, adds a THIRD fill or a SECOND ghost to
> the lane rig (§D.7.7), promotes any action other than seller contact out of the kebab, duplicates
> the transactional block across two simultaneously-visible regions, puts a purchase control in the
> sticky header band (§D.7.6), flips the canvas columns with `order`/`direction` rather than in the
> DOM (§D.7.8), resolves the lane from an island rather than a URL resolver, or renders a
> recommendation block through anything other than the contained Explore rail module (§D.7.9).
### D.8 Entity-view archetypes — the render contract

One page, six bodies. The archetype is resolved server-side from the listing's own delivery model,
and each dictates what the main stage renders and what the lane's summary ledger says. All six —
the five commerce archetypes and a project (§D.8.6) — inherit §B.4, §B.9.7 and §B.11 without
exception — **none of these is built from cards.**

**D.8.0 The media showcase is common to all five.** A 16:10 primary canvas
(`--card-media-ratio`) with the active thumbnail strip **directly beneath it**, never floating over
it. The strip reserves its own height at SSR so a late-decoding image cannot shift the canvas, and an
audio or video artefact embeds `AudioVisualizer` or the `VideoPlayer` (`full`) **inside the same 16:10 box** —
the box is the layout contract, the artefact is what fills it, so switching media type causes no
reflow.

Opening a still mounts the app's one media lightbox (`MediaLightbox`, `vw-lightbox`, its own
`lightbox.css`; Decision #184), shared with the `/[handle]` showcase and chat messages of two or more
images. It keeps only the embed container of the file modal (`.ins-embed`'s box: full viewport,
`overflow: clip`, solid `--bg`), with no header and one floating Close. The picture fits, zooms
and pans against the **viewport**, never inside a frame, through the inspector's `core/viewport.ts`.
A bitmap is never upscaled to fit and never zoomed out past the fit. A click toggles fit ↔
enlarged at the click point; wheel and pinch zoom at the pointer; a drag pans an enlarged picture and
swipes the gallery while it is fitted. A bottom carousel (Previous · thumbnail strip with an
`aria-current` ring · Next · `n / m`) is drawn only for two or more items. An item may carry a
`caption` (the changelog's release pictures do, Decision #278): it renders as a `--surface-1` band
between the stage and the tray, in `--text-sm` `--on-surface`, and is the dialog's
`aria-describedby`; an item without one renders nothing there.

**D.8.1 Pipelines and multi-stage services.** The stage ledger is a **continuous vertical timeline
track**: one hairline running the full height of the run, with each stage's step number in a small
circular **outline** on it (a `--primary` ring with the numeral on the surface pair). The ring was
originally chosen to route around `--on-primary` on `--primary` measuring 3.57:1 in dark; §B.12.2 has
since fixed that pair at the token layer, so the ring is now a composition choice rather than a
workaround — an outline reads as a waypoint on a track where a filled disc reads as a button. A
stage's title
is Section-header register, its brief is Body, its turnaround and stage budget are inline Meta.
Expanding a stage reveals its deliverable checklist (§B.9.8) **inline, without interrupting the
track** — the line runs behind the expansion, because a track that breaks at every open stage stops
reading as a sequence, which is the only thing it was drawn to communicate. It is not an `Accordion`:
that component brings a bordered panel per tab, which is the boxed accordion this rule exists to
prevent. The expansion stays native `<details>` (server-rendered, keyboard-operable, working without
script) and is **animated in CSS alone**: `::details-content` is a one-row grid whose row springs
`0fr` ⇄ `1fr` on `--spring-standard` / `--dur-medium` (the caret's own timing), with
`content-visibility` transitioned `allow-discrete` so content is not removed before the row closes
over it, and a padding-free `.evp-track__reveal` clip inside it (a box cannot shrink below its own
padding). The single track rule is on the list, so it grows and shrinks with the expansion frame by
frame and never breaks. Both reduced-motion channels jump to final; an engine without
`::details-content` opens instantly. The same ledger serves `?type=services` and `?type=projects`
(Decision #142). Lane ledger: `Stage 2 of 5 · Discovery`, plus per-stage quick-jumps.

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
the `VideoPlayer` transport for video (never the browser's own `controls` — the one default-styled control set the page would otherwise carry), an interactive viewport for 3D, a syntax-highlighted excerpt for a code kit.
Beneath it, a key–value **file specification ledger** — formats (`.blend`, `.wav`, `.psd`),
uncompressed payload size, dimensions or sample rate, the compatibility matrix (host application and
version), and the licence permissions in full — as hairline-separated rows in Meta register. Licence
is never abbreviated into a chip: it is the term of the sale, and a reader who cannot see whether
commercial use is included has not been told the price of anything.

**D.8.6 Projects — a brief being staffed.** A project renders through the SAME frame as the five
commerce bodies, never a template of its own. It has no media column, so its hero spans the frame's
two content tracks (the shape a session's scheduler stage already takes) and its title is the page's
primary optical area — top-left, directly after the back link. **There is no banner** (Decision #142,
retiring the slim strip of Decision #96(B)): the client's identity is the seller line — face, name and
role headline. Then title · one inline meta line (live stage · classification · leading skills) ·
summary · the seller line, whose score jumps to the client reviews below.
The body is a two-column details ledger (type · current stage · stage count · open seats · posted
by), the roles being hired as ONE inline meta line, and the stage run on the §D.8.1 timeline track
with its seat facts and open roles shown. The conversion rail is `ProjectLane` in the END column,
built from the same lane parts as `EntityLane` (`lane-parts.tsx`): identity band · the per-ticket
price (the floor, "From", for a pipeline; the fixed amount for a one-off) · stage quick-jumps ·
summary ledger · a pinned footer carrying ONE inverted primary **Apply to project** and ONE ghost
**Message client** — no secondary, since a brief is applied to and never basketed. In the
authenticated shell the lane docks clear of BOTH top bars at all times
(`top: calc(var(--shell-topbar-h) + var(--shell-midnav-header-h) + var(--space-4))`), is sized to its
content and clamped to the remaining viewport (a flex column, so the clamp reaches the scroll region
and the footer stays on screen), and sits at `--z-raised` — BELOW the in-flow header band — so a lane
carried up by the frame's foot passes under the band instead of covering it.

Below the body, at the product owner's direction (Decision #142, reversing #44/#96): **"More by
[client]"** — the client's other public briefs as project cards (stage pipeline shown), two-up, first —
then **"Similar & recommended"** — other clients' briefs ranked by shared skills, then classification,
three-up; a brief sharing no skill is dropped, not padded in — and then the **client's reviews**:
the reviews freelancers left on the owner AS A CLIENT (the client track only — a client's helper
reviews are a different reputation), read through `org.get_profile_reviews`, which releases an
engagement's title only when that project is `public`; an unlisted or private engagement prints
nothing rather than a placeholder. A client nobody has reviewed reads "No freelancer has reviewed …
yet", never a 0.0 score. Payment-timeliness and spec-clarity sub-scores are NOT rendered: no column
stores them (flagged in Decision #142).

**The owner's preview (`/projects/[slug]/preview`, View Mode 2 of 2)** is the same `EntityViewPage` in
`mode="preview"`, composed by the same service from the owner's own rows (drafts included): the back
link's row carries a one-line Meta notice — _This is how freelancers and applicants evaluate your
project brief._ · **Edit details** — with no fill, border or dismiss; there are no rails and no
reviews; the lane has no kebab; and the lane footer and apply bar NAME the applicant's two actions
(_Applicants act here_ · Apply to project · Message client) instead of rendering them — a disabled
Apply would be a control that does nothing (§3 gate 11). Below the frame breakpoint `ProjectApplyBar` re-homes the
price and the rig into the body (§D.7.4), and the header band is the same `EntityStickyHeader` a
listing shows, labelled _Project_. Read as a Gutenberg diagram: primary optical area (top-left) =
title + identifiers; strong follow (top-right) = the lane's identity and price; weak follow (body) =
the ledgers and the stage run; terminal (bottom-right) = the pinned Apply.

**Apply and its cost (Decision #154).** Beneath **Apply to project**, in the shared `ProjectCtaRig`
(so the lane and the apply bar quote one cost, §D.7.4), sits the required disclosure of what the
primary spends — `1 proposal token · 12 ready` (`AllowanceDisclosure`) — as centred inline Meta text,
never a chip. Apply opens `ProjectApplyModal`, mounted ONCE per listing (not in the lane or the bar,
which hide each other by `display`): stage · role (only roles that take proposals) · **apply as**
(yourself, or a team you may bind) · an optional cover note, with the cost in the footer's Meta
register beside the one primary, **Send proposal**. Its pre-flight statement is an `InlineNotice`
used inside a dialog (the `prop-notice` modifier keeps the glyph beside a two-line sentence and drops
the notice's own edge padding): the pacing limit with a live `04h 12m 30s` countdown — the ticking
figure is `aria-hidden` and a still phrase ("about 4 hours 13 minutes, at 11:52") is spoken instead,
because a figure changing every second inside a live region would be announced every second — the
spent week with its reset and the upgrade, a one-member team, or a missing `bind_seat`. When the
status refuses, Send proposal is disabled; while the allowance runs as a meter only, the notice says
the application will still go through and the primary stays live. "Applied" is derived from the
viewer's real pending proposals, and pressing it opens the same dialog, which lists them first with
the quiet text action **Withdraw proposal (refunds 1 proposal)** (two presses — the action, then
Confirm — because a withdrawal cannot be taken back). `/projects` carries the same list under the
portfolio ("Your proposals": hairline rows, the lifecycle status the one contained thing).

> **Merge gate.** An archetype PR is not mergeable if it boxes the stage ledger, scope list or spec
> table; breaks the timeline track at an expansion or builds it from `Accordion`; renders session
> times without naming the zone the grid is drawn in, or claims a zone the engine is not using;
> confines the booking calendar to a hero column, or ships a second/one-way availability switcher;
> encodes seat capacity in an animated property or omits the spoken count; reduces licence terms
> to a chip; or renders a project through a frame of its own — a boxed stage card, a pill for its
> classification or roles, a banner of any scale, an Apply control anywhere but the lane footer
> and the below-breakpoint apply bar, or a live Apply/Message control on the owner's preview; or
> names an engagement in a review whose project is not `public`.
### D.9 Notifications — the header drawer and the inbox page

The in-app inbox has two surfaces over one read model (`comms.notification_feed` through
`/api/notifications/*`, `NotificationInboxBackendService`): the header **drawer** and the
**`/notifications`** page. Both are built from the same parts in `features/notifications/`
(`NotificationTabs`, `NotificationList`, `NotificationRow`, the `useNotificationFeed` hook), so a
rule stated here holds on both. Islands stay dumb: they call the thin `NotificationService`, never
Supabase.

**D.9.1 Anatomy — the drawer.** A right `Drawer` (§B.10, `--drawer-w`) titled "Notifications",
top to bottom: the **category tabs**; a one-control toolbar holding **Mark all as read**, aligned to
the inline end; the tab's **rows**; and, in the pinned **`footer`** slot (§B.10.8), one link —
**View all notifications** → `/notifications`. The rows bleed to the panel's edges (the body's own
padding is cancelled on the list, then re-applied inside each row) so the unread step and the
hairlines run edge to edge. Opening a row's link closes the drawer.

**D.9.2 Anatomy — the page.** `/notifications` (ROUTING.md), at `--measure-wide`: a display-register
title "Notifications" with a Meta-register **Notification settings** link (→
`/settings/notifications`) on the same baseline; the same **category tabs**; a bar with the **view
switch** (`SelectButton`: All · Unread · Archived) at the start and the **bulk controls** at the end;
then the rows and **Load more** (keyset on `created_at`). The tab and view are the URL —
`?category=&view=`, replaced in place, defaults omitted — so any state on screen is a deep link.
Desktop, tablet and mobile are one fluid column; below `--bp-md` only the padding and the title step
down (`--text-3xl` → `--text-2xl`), and the bar wraps.

**D.9.3 Category tabs.** All · Money · Work · Messages · Schedule · Discovery · Account · System —
the `comms.notification_category` enum **minus `marketing`**, which lives only in Settings →
Notifications (a promotion is never a tab in someone's inbox; an in-app marketing row, if a user
opted into one, still lists under All). The strip is `TabMenu` in tablist mode (scrollable with
chevrons when it overflows the drawer). A tab with unread rows carries its **count** from
`/summary` (`byCategory`, sparse — absent is zero; All reads `unread`), capped at `99+`,
`tabular-nums`. **The tab counts are the only containers in the inbox** (§B.11's "counts").

**D.9.4 The row.** One `<li>`, separated from the next by **one `--hairline`** — never a card, never
a radius, never a shadow (§B.9). Left to right:

- the **actor's avatar** (`UserAvatar`, `sm`, from the row's party card); the platform itself (no
  actor) is the brand initial on the neutral `Avatar`;
- the **title** (`--text-md` / `--fw-medium`, `--on-surface`);
- the **body** (`--text-sm`, `--text-secondary`, clamped to two lines);
- ONE **meta line** (`--text-xs`, `--text-secondary`, `tabular-nums`): **relative time · context**,
  middot-joined inline text — never pills (§B.11). Context is the project or stage the payload names
  (`project_title` → `stage_name` → `entity_name`), else the category's label;
- the **unread mark** — a `--space-2` `--primary` dot in the leading gutter, level with the title;
- **Archive** — an icon-only text `Button` (`archive-box`), a sibling of the link, never inside it.

The row's main area is **a link to `actionUrl`** that marks the row read on click (`keepalive`, so the
write outlives the navigation). A row with no unambiguous destination (`actionUrl` is `null` — never
a broken link) is a button that only marks it read. **Unread** = the row sits on the **next solid ramp
step** of the surface it lists on — `--surface-1` in the drawer (on `--surface`), `--surface-2` on the
page — never a translucent wash (§B.4.2); the link's name is prefixed "Unread:" for assistive tech.
The title's weight does not change with read state (§A.4: levels never differ by weight alone).

**D.9.5 Grouped rows.** A row the router collapsed (`group_count > 1`, keyed by `group_key`) is ONE
row with the latest event's title and body; its count rides the meta line as a third item —
`2h ago · Messages · 3 updates`. No stacked avatars, no expander: opening it goes to the conversation
or object that holds all of them.

**D.9.6 States.** **Loading** — four placeholder rows (avatar circle + two text lines, `Skeleton`),
`aria-busy`. **Error** — an `InlineNotice` with the server's sentence and **Try again**; a failed
_write_ rolls the optimistic change back and shows the same notice above the rows. **Empty** — an
`EmptyState` (`bell`) whose sentence names the slice: "No notifications yet" · "No money
notifications" · "Nothing unread in Work" · "Nothing archived". Empty is not an error and never
offers Retry.

**D.9.7 Mark all as read** is **scoped to the open tab** (`POST /read-all { category }`; All sends no
category), applies server-side — so rows beyond the loaded page move too — and is disabled when the
tab has nothing unread. On the page, while a selection exists it gives way to **Mark read** and
**Archive** for the selection; a **Select all** checkbox (indeterminate on a partial selection) heads
the bar. The Archived view has no selection and no archive control — there is nothing left to
dismiss (restore is not built).

**D.9.8 Seen vs read, and the header dot.** The header trigger keeps its **dot, never a count**
(§D.1). It shows while `/summary.unseen > 0`. Opening the drawer (or the page) calls `POST /seen`,
which clears the dot without marking anything read; reading is per row or per mark-all.

**D.9.9 Realtime behaviour.** The shell **polls `GET /api/notifications/summary`** (Decision #173):
every 30 s while the tab is visible, at once when it becomes visible again, never while hidden. ONE
poller runs per page (started by the header drawer island) and publishes the summary on a shared
signal — the dot and the tab counts read it. When `total` or `unseen` **rises**, an open list
re-reads its first page and **prepends only rows newer than its head** (known rows take their fresh
state; nothing the reader is looking at reorders), then marks the inbox seen again. Arrivals are
announced in a `polite` live region, **rate-limited**: the first speaks at once, later ones inside
the next 8 s are summed into one "N new notifications". Nothing animates in, so there is no motion
to reduce; the footer link's press scale is removed under both reduced-motion channels.

**D.9.10 Accessibility.** Tabs follow the WAI-ARIA tabs pattern — `role="tablist"`, roving tabindex,
arrows auto-activate, Home/End, `aria-selected`, and `aria-controls` → the one `role="tabpanel"`
(`TabMenu`'s `panelId`); a count is spoken as ", N unread". The rows are a `role="list"`; every
control has a name that includes the row's title ("Archive: …", "Select: …"). Writes announce their
outcome in the same polite region ("Notification archived.", "All marked as read.").

**D.9.11 Dev Context Switcher.** The `notifications` axis (Auto · None · Many unread · Realtime burst)
substitutes the inbox client-side through `notification-sim`: no notifications at all; 56 rows across
every inbox category, most unread (counts, paging, bulk select); or a small read inbox plus eight
arrivals 1.2 s apart while the poller runs at 1 s (the merge, the dot, the rate-limited
announcement). Nothing is written to the server.

> **Merge gate.** A notification surface that boxes a row, draws metadata as a pill or tag, washes an
> unread row with a translucent fill, prints a count on the header trigger, gives marketing a tab,
> nests the archive control inside the row's link, or reads Supabase from an island is not mergeable.

## Part E — Contracts & merge gates (summary)

A PR touching `@projective/ui` must satisfy (enforced via root `CLAUDE.md`):

1. Token-only styling — no literal colors/radii/durations/shadows.
2. BEM class naming; no framework CSS; no CSS-in-JS.
3. Separation-hierarchy rule (§B.4) — full borders on interactive elements only.
4. Reduced-motion + the four a11y overlays (§A.5) honored; comprehensive ARIA.
5. Responsive at Desktop/Tablet/Mobile without app-side overrides.
6. New/changed component ⇒ its entry in the §C.1 roster + this spec updated **in the same change.**
7. **The seven component laws** — §A.7 field state contract, §B.7 iconography, §B.8 buttons, §B.9
   cards, §B.10 overlays, §B.11 anti-tagification, §B.12 button feedback & the contrast invariant.
   Each carries its own gate paragraph; they are listed here so a reviewer has one place to check
   rather than seven.
8. **§B.12's contrast invariant is machine-checked, and that is the point.** Every filled
   `--<role>` / `--on-<role>` pair must measure ≥ 4.5:1 in all four mode/contrast states, a
   mode-adaptive pair must reach ≥ 7:1 in dark, no pair may narrow under `data-contrast="high"`, and
   `--primary`/`--on-primary` must be byte-identical across every state (§A.1.1). `--accent` /
   `--on-accent` (§A.1.2) is in the set on the full terms — ≥ 4.5:1 in all four states, ≥ 7:1 in
   dark, never narrowing under high contrast — and, being fixed-polarity (light fill, dark ink in
   every mode), its hover and press blend toward a light pole, never toward `--on-surface`; its
   light fill's sub-3:1 page visibility (2.42–2.97:1, 2.11:1 pressed) is a logged deviation
   (Decision #157 flag (b)), not a precedent. Press
   feedback must be `transform`-only, must move no box-model property, and must be disabled by
   **both** reduced-motion channels. The colour half is pinned in
   `packages/ui/system/core/theme-engine.test.ts` because it is the one law here whose failure is
   invisible to a source-reading review — the pair it governs shipped at 3.57:1, and at 1.75:1 under
   the accessibility overlay, for months without anyone reading a stylesheet and noticing.
9. **The three composition laws** — §A.4's four typographic registers (hierarchy over raw weight),
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

**F.1 — Focus ring: `box-shadow` composite vs. native `outline`.** _Partially resolved 2026-09-08;
the forced-colors half is still open._ _Audit position:_ the focus indicator should be an `outline`
with `outline-offset`. `outline` is never clipped by an ancestor's `overflow`, and — decisively —
**Windows High Contrast / forced-colors mode discards `box-shadow` entirely**, so a shadow ring
vanishes for exactly the users most dependent on it. _House position (§A.7.1, in force):_
`--focus-ring-shadow` is a two-tone composite because **no single colour clears 3:1 against both the
control fill and the page** — the previous single-colour ring measured 1.00:1 on `--primary` in dark.
An `outline` is one colour.

_What changed:_ both now ship, and the audit's own argument is what decides which is used where. A
zero-specificity `:where(…):focus-visible` base rule draws a NATIVE `outline` for every control that
has no sheet of its own — previously those fell through to the user agent's default, so this is new
coverage rather than a swap — and a single colour is legal there precisely because `outline-offset`
keeps the ring off the fill, which is the dependency that forced two tones. The 556 controls that
draw their own ring keep the composite, whose neutral gap layer both reads as that offset and remains
the tone that rescues the indicator on an accent fill.

_Still open, and it is the half that mattered most:_ **forced-colors** still discards the composite,
so those 556 controls remain uncovered there while the base-rule remainder is now fine. The proposed
`@media (forced-colors: active){ outline: 2px solid Highlight }` was deliberately NOT taken here — it
is the ruling this entry defers, and it would give every control two focus implementations. It is now
a smaller change than it was, since the mechanism and the geometry already exist.

**F.2 — Eight severities is more than this product means.** _Audit position:_ `help` (mapped to
`--tertiary`) carries no meaning anywhere in Projective, and `info` vs `secondary` were literal
visual duplicates until 2026-07-30 — evidence that the set is wider than the vocabulary. A smaller
set is harder to misuse, and §B.8.3's whole problem is misuse. _House position:_ the roster is
committed to **PrimeNG feature-parity** (§C.1 roster-rename note); a severity is part of that
surface, and removing one is a breaking change to a copy-paste-portable package. _Ruling needed:_
keep all seven parity severities and forbid `help` by policy, or drop it from the `Severity` union.
_Since Decision #157:_ `Button` carries two more, `accent` (filled only) and `neutral` (outlined
only), neither of which is a PrimeNG severity — the parity argument above no longer describes
`Button` exactly. Both are confined to `Button` (`ButtonSeverity`, §B.8.3) so the shared `Severity`
union, and the parity of the five other severity-bearing components, is unchanged; whether that
departure is acceptable is part of the same ruling.

**F.3 — The `filled`-per-view cap vs. genuinely two-primary surfaces.** _Audit position (encoded as
§B.8.2):_ one `filled` per decision region. _Unresolved case:_ the wallet footer rig legitimately
offers **Top up** and **Withdraw** as co-equal primaries — neither is subordinate, and demoting one
to `outlined` would misrepresent the surface. §B.8.2's "mutually exclusive by render condition"
escape does not cover them. _Options:_ (a) accept the cap and pick a winner per rig; (b) formalise a
"co-primary pair" exception limited to a footer action rig; (c) treat each as its own decision
region. Since Decision #157 the cap has one exception — two fills ranked by hue, amber tier 1
against monochrome tier 2 (§B.8.2) — but it does not reach the wallet: Top up and Withdraw both move
money, so under the Interaction Matrix both would be tier 1, and two amber fills are the same-colour
case the cap still forbids. _As shipped:_ the pair no longer sits in a footer rig — it is part of
the `/wallet` hero's glass action-pill row (`WalletHero.tsx` `.wlt-pill`), where neither pill is
filled, and the amber lives on each movement dialog's own commit (§B.8.1, "where tier 1 renders
today"), so the two-amber case does not arise today. The options above still stand the moment the
pills become filled — (a) pick a winner and move the other to tier 2 or 4, (b) a scoped co-primary
exception, (c) separate regions — and the choice is logged with the tier-1 scope question as
Decision #157 flag (j), not settled by the matrix.

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
