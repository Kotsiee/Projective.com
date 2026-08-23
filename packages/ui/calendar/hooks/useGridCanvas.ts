/**
 * @projective/ui/calendar — the DOM half of the grid canvas: measuring it, keeping its backing store
 * honest, and resolving the token palette a canvas cannot read for itself.
 *
 * THE TOKEN PROBLEM, AND HOW IT IS SOLVED. `packages/ui` may not hold a colour — every value comes
 * from `var(--*)` — but a `CanvasRenderingContext2D` has no access to the cascade at all. So the
 * declarations live where they belong, in `calendar.css`, on a hidden SWATCH subtree whose only job
 * is to be measured: this hook reads each swatch's RESOLVED `getComputedStyle` value and hands the
 * result to the paint routine. That is what makes `color-mix(in srgb, var(--primary) var(--tint-subtle),
 * transparent)` usable on a canvas — the engine resolves the mix, and the number never enters TypeScript.
 *
 * THE PALETTE IS NOT CACHEABLE FOREVER. This app generates its scheme per request and swaps it at the
 * document root (`system/core/context.ts` writes the tokens into `<html>`'s inline `style` and stamps
 * `data-theme`/`data-contrast`/`data-cvd`/`data-font`), so a palette cached at mount would keep
 * painting the previous theme after a switch. Watching the root alone is not enough, though: this
 * package is copy-paste portable and `styles/index.css` documents a `.ds-scope` SUBTREE pattern, so a
 * consumer may theme an ancestor that is not `<html>` and never touch the root at all. The observer
 * therefore walks the probe's own ancestor CHAIN and watches each link — bounded by the document's
 * depth, and precise, where a `subtree: true` observer on the root would fire for every `class` write
 * anywhere on the page. A `prefers-color-scheme` listener covers the remaining case of a consumer
 * that themes purely by media query.
 *
 * NO FRAME IS EVER REQUIRED. The draw runs in `useLayoutEffect`, which Preact flushes SYNCHRONOUSLY
 * during commit, and the commit itself is scheduled on a microtask — so scroll → signal → render →
 * paint completes with no `requestAnimationFrame` in the path. That is not a performance choice: rAF,
 * CSS transitions and CSS animations are all frozen in a hidden or background tab, and a grid whose
 * lines needed a frame would simply be blank there. (`useEffect` would NOT do: Preact defers it
 * behind a `requestAnimationFrame` racing a 100 ms timeout.)
 */
import type { RefObject } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef } from "preact/hooks";
import type { AccentPaint, GridScene, ScenePalette, TextStyle } from "../core/grid-paint.ts";
import { toCanvasColor } from "../core/grid-paint.ts";
import type { FrameStats } from "../core/scene-paint.ts";
import { paintScene, sceneCost } from "../core/scene-paint.ts";
import { watchAvatarLoads } from "../core/avatar-cache.ts";

// #region Types
export interface UseGridCanvasOptions {
	/** The canvas the backdrop is painted into. */
	canvasRef: RefObject<HTMLCanvasElement>;
	/** The hidden swatch subtree the palette is resolved from (`GridCanvas` renders it). */
	probeRef: RefObject<HTMLElement>;
	/**
	 * The scene for the NEXT draw. Re-read on every draw — including draws a resize or a theme change
	 * triggers outside the render cycle — so it must be cheap and free of side effects.
	 */
	scene: () => GridScene;
	/**
	 * A stable key for the set of accent tokens the probe is currently rendering swatches for.
	 *
	 * The palette is cached until the THEME moves, but the accent set is a property of the DATA — a
	 * week with no deadlines in it renders no `--danger` swatch — so a change here has to invalidate
	 * the cache too, or the first deadline of the month would be painted in the fallback accent.
	 */
	accentKey?: () => string;
	/**
	 * Called after each painted frame with what it cost. Optional, and absent by default.
	 *
	 * Opt-in rather than flag-gated on purpose. This package has no `IS_DEV` and must not acquire one
	 * — depending on the app's build constants would end the copy-paste portability that is the whole
	 * point of `packages/ui` (see `packages/ui/CLAUDE.md`). A caller who wants the numbers passes a
	 * function; a caller who does not pays one `undefined` check per frame, and `performance.now()` is
	 * never called at all.
	 */
	onFrame?: (stats: FrameStats) => void;
}

export interface GridCanvasApi {
	/**
	 * Re-measure and repaint SYNCHRONOUSLY — a complete, final frame on return, with no
	 * `requestAnimationFrame` anywhere in the path. Safe to call from any event.
	 */
	redraw: () => void;
	/**
	 * The palette resolved for the last draw, or null before the first one.
	 *
	 * A pointer handler needs it: the pill's box and the gauge's track come from the token layer, and
	 * a hit test computed from different numbers than the paint used is a control that is drawn in one
	 * place and clickable in another. Exposing the ONE resolved palette is what keeps them the same.
	 */
	palette: () => ScenePalette | null;
}
// #endregion

// #region Palette resolution
/**
 * A resolved declaration, preferring the LOGICAL property name.
 *
 * The physical fallback is not superstition about support — it is that a computed-style read is a
 * MEASUREMENT, not an authored declaration, and in this package's horizontal writing mode
 * `block-start` and `top` are by definition the same edge, so the two can never disagree. The
 * authored side stays logical, which is what the merge gate is actually about.
 */
function decl(cs: CSSStyleDeclaration, logical: string, physical: string): string {
	return cs.getPropertyValue(logical) || cs.getPropertyValue(physical);
}

/** A resolved length in px, or `0` when the declaration did not reach the swatch. */
function len(value: string): number {
	const n = parseFloat(value);
	return Number.isFinite(n) ? n : 0;
}

/**
 * A resolved text style, assembled from the LONGHANDS.
 *
 * `getComputedStyle(el).font` returns an empty string in more than one engine, and an empty
 * `ctx.font` silently leaves the 2D context on its 10px sans-serif default — which looks like a
 * deliberate choice rather than a failed read. Building it from the parts also means the reader's
 * own font settings and the open-dyslexic overlay reach the canvas: `fontSize` resolves to px
 * against the live root size, and `fontFamily` is whatever `--font-sans` currently is.
 */
function textStyle(cs: CSSStyleDeclaration): TextStyle {
	const size = len(cs.fontSize);
	const style = cs.fontStyle && cs.fontStyle !== "normal" ? `${cs.fontStyle} ` : "";
	// `line-height` computes to `normal` when it was never set, which is not a length — the caller
	// falls back rather than being handed a NaN it would silently render as a zero-height line.
	const lh = parseFloat(cs.lineHeight);
	return {
		font: `${style}${cs.fontWeight || 400} ${size}px ${cs.fontFamily || "sans-serif"}`,
		color: toCanvasColor(cs.color),
		size,
		/*
		 * The open-dyslexic overlay is a family swap PLUS tracking, word spacing and leading, all three
		 * of which `styles/index.css` calls documented reading aids rather than a preference. Reading
		 * only the family would give a dyslexic reader a third of the accommodation on the canvas while
		 * every DOM label beside it widened, so all four travel together.
		 */
		letterSpacing: cs.letterSpacing || "normal",
		wordSpacing: cs.wordSpacing || "normal",
		lineHeight: Number.isFinite(lh) ? lh : 0,
	};
}

/** A text style that resolves to nothing, so a painter skips its layer instead of inventing one. */
const NO_TEXT: TextStyle = {
	font: "",
	color: "",
	size: 0,
	letterSpacing: "normal",
	wordSpacing: "normal",
	lineHeight: 0,
};

/** The accent used for a token the probe did not render a swatch for — draws nothing at all. */
const NO_ACCENT: AccentPaint = {
	fill: "",
	fillHover: "",
	fillMasked: "",
	accent: "",
	onAccent: "",
	edge: "",
	edgeWidth: 0,
};

/**
 * Read every drawing value off the swatches.
 *
 * Returns `null` when the LATTICE subtree is not there yet (a consumer that has not loaded the
 * stylesheet), which the caller treats as "paint nothing" — an empty backdrop is recoverable on the
 * next draw, whereas a palette of invented defaults would look deliberate and would be wrong.
 *
 * The overlay values below the lattice degrade INDIVIDUALLY rather than failing the whole read: a
 * missing swatch resolves to an empty colour or a zero length, and each painter skips a layer it has
 * no paint for. That is the same principle one step finer — a layer this package cannot draw
 * honestly is a layer it does not draw.
 */
function readPalette(probe: HTMLElement): ScenePalette | null {
	const swatch = (name: string) => probe.querySelector(`.cal-grid__swatch--${name}`);
	const rule = swatch("rule");
	const boundary = swatch("boundary");
	const band = swatch("band");
	const bandEdge = swatch("band-edge");
	const blackout = swatch("blackout");
	if (!rule || !boundary || !band || !bandEdge || !blackout) return null;

	const ruleCs = getComputedStyle(rule);
	const boundaryCs = getComputedStyle(boundary);
	const bandCs = getComputedStyle(band);
	const edgeCs = getComputedStyle(bandEdge);
	const blackoutCs = getComputedStyle(blackout);

	/** A computed style for an optional overlay swatch, or null when it is absent. */
	const optional = (name: string): CSSStyleDeclaration | null => {
		const el = swatch(name);
		return el ? getComputedStyle(el) : null;
	};
	const text = (name: string): TextStyle => {
		const cs = optional(name);
		return cs ? textStyle(cs) : NO_TEXT;
	};
	const colour = (cs: CSSStyleDeclaration | null, prop: string): string =>
		cs ? toCanvasColor(cs.getPropertyValue(prop)) : "";

	const now = optional("now");
	const selection = optional("selection");
	const bar = optional("bar");
	const barHitCs = optional("bar-hit");
	const ball = optional("ball");
	const pill = optional("pill");
	const focus = optional("focus");
	const tooltip = optional("tooltip");
	const card = optional("card");
	const marker = optional("marker");
	const glyph = optional("glyph");
	const avatar = optional("avatar");
	const badge = optional("badge");
	const lift = optional("lift");
	const pin = optional("pin");

	return {
		rule: toCanvasColor(decl(ruleCs, "border-block-start-color", "border-top-color")),
		ruleWidth: len(decl(ruleCs, "border-block-start-width", "border-top-width")),
		boundary: toCanvasColor(decl(boundaryCs, "border-block-start-color", "border-top-color")),
		boundaryWidth: len(decl(boundaryCs, "border-block-start-width", "border-top-width")),
		// The two region tints ride `color`, which is the one inherited paint property a swatch can
		// carry without ALSO painting itself — a `background-color` probe would be a visible box.
		bandFill: toCanvasColor(bandCs.getPropertyValue("color")),
		bandEdge: toCanvasColor(decl(edgeCs, "border-block-start-color", "border-top-color")),
		bandEdgeWidth: len(decl(edgeCs, "border-block-start-width", "border-top-width")),
		blackout: toCanvasColor(blackoutCs.getPropertyValue("color")),
		hatchStripe: len(blackoutCs.getPropertyValue("--cal-hatch-stripe")),
		hatchPitch: len(blackoutCs.getPropertyValue("--cal-hatch-pitch")),

		hourText: text("hour"),
		titleText: text("title"),
		metaText: text("meta"),
		markerText: text("marker"),
		pillText: text("pill"),
		maskedText: text("masked"),
		markerFill: colour(marker, "background-color"),
		// A card carries the cancelled treatment's alpha as a real `opacity`, so the canvas and
		// `.cal-event--cancelled` read one declaration instead of restating the same number twice.
		cancelledAlpha: card ? parseFloat(card.opacity) || 0 : 0,
		highlightRingWidth: card ? len(card.outlineWidth) : 0,
		/*
		 * The two RECESSION depths, read as the inherited custom properties they are rather than
		 * smuggled through a property the swatch does not paint with. They are declared on `:root`
		 * (where the whole calendar token layer lives, so body-portalled surfaces resolve it too) and
		 * inherit down to every swatch — which is what lets `.cal-daycol__event` and this canvas read
		 * ONE declaration each instead of two that agree today. See `SceneEvent.recede`.
		 */
		dimDrag: card ? parseFloat(card.getPropertyValue("--cal-dim-drag")) || 1 : 1,
		dimFocus: card ? parseFloat(card.getPropertyValue("--cal-dim-focus")) || 1 : 1,

		now: colour(now, "border-block-start-color") || colour(now, "border-top-color"),
		nowWidth: now ? len(decl(now, "border-block-start-width", "border-top-width")) : 0,
		nowDotSize: now ? len(now.inlineSize || now.width) : 0,
		// How faint the LEAD-IN run is drawn — the stretch of rule between the gutter dot and the start
		// of the active day's column, in a view where the two are not adjacent.
		nowLeadAlpha: now ? parseFloat(now.opacity) || 0 : 0,

		selectionFill: colour(selection, "background-color"),
		selectionStroke: colour(selection, "border-block-start-color") ||
			colour(selection, "border-top-color"),
		selectionStrokeWidth: selection
			? len(decl(selection, "border-block-start-width", "border-top-width"))
			: 0,
		selectionInsetStart: selection ? len(decl(selection, "margin-inline-start", "margin-left")) : 0,
		selectionInsetEnd: selection ? len(decl(selection, "margin-inline-end", "margin-right")) : 0,
		// The DRAFT's dashed stroke. A canvas takes a dash as a pair of NUMBERS, and `border-style:
		// dashed` gives back only the word `dashed` — so the two lengths ride `column-rule-width` and
		// `outline-width`, both of which compute to real pixels on an element that paints neither.
		selectionDash: selection ? len(selection.getPropertyValue("column-rule-width")) : 0,
		selectionGap: selection ? len(selection.getPropertyValue("outline-width")) : 0,
		selectionAlpha: selection ? parseFloat(selection.opacity) || 1 : 1,
		selectionGrab: selection ? len(selection.blockSize || selection.height) : 0,

		barFill: colour(bar, "background-color"),
		barFillStrong: colour(bar, "outline-color"),
		barEdge: colour(bar, "border-block-start-color") || colour(bar, "border-top-color"),
		barEdgeWidth: bar ? len(decl(bar, "border-block-start-width", "border-top-width")) : 0,
		barRadius: bar ? len(decl(bar, "border-start-start-radius", "border-top-left-radius")) : 0,
		barWidth: bar ? len(bar.inlineSize || bar.width) : 0,
		barInset: bar ? len(decl(bar, "margin-inline-end", "margin-right")) : 0,
		// The pointer-target floor, on its OWN swatch: a `min-inline-size` on the bar's would have won
		// over that swatch's `inline-size`, so the DRAWN gauge would have been measured — and painted —
		// at the target width, which is exactly the substitution the pair exists to prevent.
		barHit: barHitCs ? len(barHitCs.inlineSize || barHitCs.width) : 0,
		// The grabbed handle's ball. Its own swatch rather than a state of the bar's, because a
		// computed style is a snapshot of ONE element and the two shapes coexist mid-morph.
		barBallSize: ball ? len(ball.inlineSize || ball.width) : 0,
		barBallFill: colour(ball, "background-color"),

		pillFill: colour(pill, "background-color"),
		pillStroke: colour(pill, "border-block-start-color") || colour(pill, "border-top-color"),
		pillStrokeWidth: pill ? len(decl(pill, "border-block-start-width", "border-top-width")) : 0,
		pillStrokeWidthHover: pill ? len(pill.outlineWidth) : 0,
		pillAccent: pill ? toCanvasColor(pill.color) : "",
		pillW: pill ? len(pill.inlineSize || pill.width) : 0,
		pillH: pill ? len(pill.blockSize || pill.height) : 0,
		pillInset: pill ? len(decl(pill, "margin-block-end", "margin-bottom")) : 0,

		focusRing: colour(focus, "outline-color"),
		// The halo half of the two-tone indicator. Carried as a border colour because a swatch has one
		// `outline-color` and the pair needs two — see `ScenePalette.focusRing`.
		focusRingHalo: colour(focus, "border-block-start-color") ||
			colour(focus, "border-top-color"),
		focusRingWidth: focus ? len(focus.outlineWidth) : 0,

		tooltipFill: colour(tooltip, "background-color"),
		tooltipStroke: colour(tooltip, "border-block-start-color") ||
			colour(tooltip, "border-top-color"),
		tooltipStrokeWidth: tooltip
			? len(decl(tooltip, "border-block-start-width", "border-top-width"))
			: 0,

		eventRadius: card ? len(decl(card, "border-start-start-radius", "border-top-left-radius")) : 0,
		// The kind mark's box and rendered weight, both off the §B.7 icon ramp rather than out of this
		// engine — so a card's mark carries the same weight as every other glyph on the page.
		glyphSize: glyph ? len(glyph.inlineSize || glyph.width) : 0,
		// On a SIZE, not a border width: a computed border width is snapped to whole device pixels, so
		// `--icon-stroke`'s 1.5 would come back as 1 and the mark would be drawn a third lighter than
		// every other glyph in the product.
		glyphStroke: glyph ? len(glyph.blockSize || glyph.height) : 0,
		// The hovered card's lift, decomposed: a canvas takes a shadow as three numbers where CSS
		// takes one `box-shadow`, and `box-shadow` cannot be taken apart by the cascade.
		liftShadow: lift ? toCanvasColor(lift.color) : "",
		liftBlur: lift ? len(lift.blockSize || lift.height) : 0,
		liftOffsetY: lift ? len(decl(lift, "border-block-start-width", "border-top-width")) : 0,
		// A RATIO off a length, divided back down. It cannot ride a border width — that snaps to whole
		// device pixels, so 1.02 would arrive as 1 and the lift would not scale at all.
		liftScale: lift ? len(lift.inlineSize || lift.width) / 100 || 1 : 1,
		pinThickness: pin ? len(pin.blockSize || pin.height) : 0,
		pinChipW: pin ? len(pin.inlineSize || pin.width) : 0,
		pinInk: pin ? toCanvasColor(pin.color) : "",
		pinRadius: pin ? len(decl(pin, "border-start-start-radius", "border-top-left-radius")) : 0,
		// A unitless RATIO, read as the custom property it is: the pin's band is a fraction of a column
		// whose width changes with the view, the zoom and the nesting depth, so the extent cannot be a
		// length — and a computed `%` on a 0x0 probe resolves to zero. Inherited from `:root`, which is
		// where the calendar's token layer lives so that body-portalled surfaces resolve it too.
		pinWidthFrac: pin ? parseFloat(pin.getPropertyValue("--cal-pin-width-frac")) || 1 : 1,
		avatarSize: avatar ? len(avatar.inlineSize || avatar.width) : 0,
		badgeText: text("avatar"),
		badgeMinW: badge ? len(badge.inlineSize || badge.width) : 0,
		badgeH: badge ? len(badge.blockSize || badge.height) : 0,
		accents: readAccents(probe),
		accentFallback: NO_ACCENT,
	};
}

/**
 * Resolve one card paint per accent swatch the probe is rendering.
 *
 * FIVE properties on ONE element rather than five elements per accent: the probe already costs a
 * node per drawn value, and an accent needs five (resting fill, hover fill, masked fill, the accent
 * itself, and — since the 2026-08-20 palette pass made the resting fill the accent at FULL strength —
 * its verified-contrast "on-" ink). Each is a real declaration in `calendar.css` against
 * `var(--cal-accent)` / `var(--cal-accent-on)`, so the mixes, the generated Material palette and the
 * contrast overlays all still do the resolving. `text-decoration-color` carries the fifth value
 * because it is, like the other four, a colour property a swatch can declare without visibly painting
 * anything — the probe is a 0×0 clipped subtree, so what the property is FOR never matters here.
 */
function readAccents(probe: HTMLElement): Record<string, AccentPaint> {
	const out: Record<string, AccentPaint> = {};
	for (const el of Array.from(probe.querySelectorAll(".cal-grid__swatch--accent"))) {
		const token = el.getAttribute("data-accent");
		if (!token) continue;
		const cs = getComputedStyle(el);
		out[token] = {
			accent: toCanvasColor(cs.color),
			fill: toCanvasColor(cs.backgroundColor),
			fillHover: toCanvasColor(
				cs.getPropertyValue("border-block-start-color") || cs.getPropertyValue("border-top-color"),
			),
			fillMasked: toCanvasColor(cs.outlineColor),
			onAccent: toCanvasColor(cs.textDecorationColor),
			// The OPTIONAL edge. The colour comes off `column-rule-color`; the WIDTH comes off
			// `column-gap`, because a computed border-like width snaps to whole device pixels and read
			// the design's 1.5px back as 1px. An accent with no `--x-edge` declared resolves the probe's
			// `var()` fallback to `transparent` at `0px`, and a zero width is this palette's established
			// "draw nothing", so no caller downstream needs a test.
			edge: toCanvasColor(cs.getPropertyValue("column-rule-color")),
			edgeWidth: len(cs.columnGap),
		};
	}
	return out;
}
// #endregion

/**
 * Wire a canvas to a {@link GridScene}: it re-measures on layout change, rescales for the display's
 * pixel ratio, re-resolves its palette when the theme moves, and repaints synchronously.
 */
export function useGridCanvas(opts: UseGridCanvasOptions): GridCanvasApi {
	const { canvasRef, probeRef } = opts;
	const paletteRef = useRef<ScenePalette | null>(null);
	/** The accent set the cached palette was resolved for — see {@link UseGridCanvasOptions.accentKey}. */
	const accentKeyRef = useRef<string>("");
	// Written during render so that a draw triggered from OUTSIDE the render cycle — a ResizeObserver,
	// a theme mutation — still paints the scene belonging to the latest render rather than a captured
	// stale one. A ref write is the whole point of a ref; it schedules nothing.
	const sceneRef = useRef(opts.scene);
	sceneRef.current = opts.scene;
	const accentRef = useRef(opts.accentKey);
	accentRef.current = opts.accentKey;
	// Mirrored into a ref like every other option: the draw closure is created once, so reading the
	// latest callback through a ref is what lets a caller attach or drop a listener without
	// re-creating the paint path.
	const onFrameRef = useRef(opts.onFrame);
	onFrameRef.current = opts.onFrame;

	const draw = useCallback(() => {
		const canvas = canvasRef.current;
		const probe = probeRef.current;
		if (!canvas || !probe) return;

		// Both reads first, before any write: interleaving them is what turns a cheap measurement into
		// a forced synchronous layout on every scroll frame.
		const rect = canvas.getBoundingClientRect();
		const rtl = getComputedStyle(canvas).direction === "rtl";
		if (rect.width <= 0 || rect.height <= 0) return;

		const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
		const backingW = Math.max(1, Math.round(rect.width * dpr));
		const backingH = Math.max(1, Math.round(rect.height * dpr));
		// Assigning either dimension RE-CREATES and clears the backing store, so it is written only
		// when it actually changed — writing on every scroll would discard the previous frame for
		// nothing and make the grid flicker under a fast wheel.
		if (canvas.width !== backingW) canvas.width = backingW;
		if (canvas.height !== backingH) canvas.height = backingH;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const accentKey = accentRef.current?.() ?? "";
		if (accentKey !== accentKeyRef.current) paletteRef.current = null;
		accentKeyRef.current = accentKey;

		const palette = paletteRef.current ?? readPalette(probe);
		paletteRef.current = palette;
		if (!palette) {
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, backingW, backingH);
			return;
		}
		const scene = sceneRef.current();
		const box = { width: rect.width, height: rect.height, dpr, rtl };

		// The clock is only started when somebody is listening, so an unmeasured frame does no work it
		// would not otherwise do — not even reading the time.
		const report = onFrameRef.current;
		const t0 = report ? performance.now() : 0;
		paintScene(ctx, scene, palette, box);
		if (report) {
			const drawMs = performance.now() - t0;
			const cost = sceneCost(scene);
			report({
				drawMs,
				shapes: cost.shapes,
				textRuns: cost.textRuns,
				eventsInScene: scene.events?.length ?? 0,
				eventsTotal: scene.eventsTotal ?? null,
				columns: scene.columns,
				width: rect.width,
				height: rect.height,
				dpr,
			});
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	/*
	 * Every render, synchronously, with no frame in the path. See the header note.
	 *
	 * There is deliberately NO rAF-coalescing sibling to this. A coalescing entry point would have to
	 * be the only path a burst takes to be worth anything, and it cannot be — the layout effect runs
	 * on every render regardless — so it would coalesce nothing while adding a second, weaker route to
	 * a frame that must never depend on one. The cost it was there to avoid is avoided upstream
	 * instead: `buildSceneEvents` no longer re-walks the corpus per column, and the Week grid memoises
	 * its layout across scrolls within a block.
	 */
	useLayoutEffect(() => {
		draw();
	});

	// #region Environment (size · theme · pixel ratio)
	useEffect(() => {
		if (typeof document === "undefined") return;
		const canvas = canvasRef.current;
		const invalidate = () => {
			paletteRef.current = null;
			draw();
		};

		// A ResizeObserver, not a window `resize` listener: the calendar sits in a middle-nav lane the
		// reader can DRAG wider, and the side panel can collapse — neither of which resizes the window.
		const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => draw()) : null;
		if (canvas) ro?.observe(canvas);

		const mo = new MutationObserver(invalidate);
		/*
		 * `style` carries the generated colour tokens; `dir` flips the mirror; `data-theme`,
		 * `data-contrast` and `data-cvd` are the overlays that RESTATE a colour.
		 *
		 * `data-font` is in the list too, and that is a real change from the hybrid backdrop, which
		 * deliberately left it out because it drew no type. The pure-canvas viewport draws its own hour
		 * scale and card titles, so the open-dyslexic overlay — which swaps `--font-sans` and its
		 * tracking/leading at the root — has to reach the palette, or the canvas would keep painting
		 * the previous typeface while every DOM label around it changed.
		 */
		const themeAttrs = [
			"style",
			"class",
			"dir",
			"data-theme",
			"data-contrast",
			"data-cvd",
			"data-font",
		];
		/*
		 * Every link from the probe up to the root, not the root alone. The app writes `<html>`, but
		 * `styles/index.css` documents a `.ds-scope` SUBTREE pattern for a portable consumer, and a
		 * theme swapped on an ancestor that is not the root would otherwise leave this canvas painting
		 * the previous one for the rest of the session. The walk is bounded by document depth, and one
		 * observer takes many targets — where `subtree: true` on the root would wake for every `class`
		 * write anywhere on the page.
		 */
		for (
			let el: HTMLElement | null = probeRef.current;
			el;
			el = el.parentElement
		) {
			mo.observe(el, { attributes: true, attributeFilter: themeAttrs });
		}
		mo.observe(document.documentElement, { attributes: true, attributeFilter: themeAttrs });

		const scheme = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
		scheme?.addEventListener("change", invalidate);

		// A photo finishing its (async, module-level) load is one more reason this frame needs to be
		// painted again — see `core/avatar-cache.ts`. A plain `draw()`, not `invalidate()`: the palette
		// did not change, only a pixel source `paintCard` reads synchronously inside it did.
		const unwatchAvatars = watchAvatarLoads(draw);

		/*
		 * Dragging the window onto a display with a different pixel ratio changes nothing else the
		 * observers above can see — no resize, no mutation — so the backing store would stay at the old
		 * scale and the whole grid would go soft. The query has to be rebuilt around each new ratio,
		 * because `(resolution: Xdppx)` only reports the moment it stops matching.
		 */
		let dprQuery: MediaQueryList | null = null;
		const watchDpr = () => {
			dprQuery?.removeEventListener("change", onDpr);
			dprQuery = globalThis.matchMedia?.(
				`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`,
			) ?? null;
			dprQuery?.addEventListener("change", onDpr);
		};
		const onDpr = () => {
			watchDpr();
			draw();
		};
		watchDpr();

		return () => {
			ro?.disconnect();
			mo.disconnect();
			scheme?.removeEventListener("change", invalidate);
			dprQuery?.removeEventListener("change", onDpr);
			unwatchAvatars();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [draw]);
	// #endregion

	return { redraw: draw, palette: useCallback(() => paletteRef.current, []) };
}
