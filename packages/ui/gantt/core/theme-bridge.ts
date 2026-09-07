/// <reference lib="dom" />
/**
 * @projective/ui/gantt — the THEME BRIDGE (SYSTEM_ARCHITECTURE.md §Charts "ThemeBridge"): the
 * utility that forces the browser to evaluate `var()`, `color-mix()` and `calc()` and hands the
 * canvas engine a plain colour it can paint with.
 *
 * THE PROBLEM. `packages/ui` may not hold a colour — every value is `var(--*)` — but a
 * `CanvasRenderingContext2D` has no access to the cascade at all. So the declarations live where
 * they belong, in `gantt.css`, on a hidden SWATCH subtree whose only job is to be measured: this
 * module reads each swatch's RESOLVED `getComputedStyle` value and hands the result to the paint
 * routine. That is what lets `color-mix(in srgb, var(--primary) 22%, var(--surface))` reach a canvas
 * — the engine resolves the mix, and the number never enters TypeScript.
 *
 * The palette is NOT cacheable forever: this app generates its scheme per request and swaps it at
 * the document root, and a portable consumer may theme a subtree. `useGanttCanvas` re-reads it on any
 * theme attribute write up the probe's ancestor chain, and on any change to the ACCENT SET, which is
 * a property of the data rather than of the theme (a timeline with no overdue item renders no
 * `--danger` swatch).
 *
 * {@link resolveCssColor} is the general form the architecture document describes — hand it any
 * colour EXPRESSION and get a canvas-ready string back — and it is what a consumer reaches for when
 * it needs one token resolved outside the palette.
 */
import { toCanvasColor } from "../../calendar/core/grid-paint.ts";
import type { TextStyle } from "../../calendar/core/grid-paint.ts";
import { onAccentFor } from "../../calendar/core/kinds.ts";

export type { TextStyle };

// #region Palette shape
/** The paints one accent token resolves to. */
export interface GanttAccentPaint {
	/** The solid accent — the milestone diamond, the progress strip, the bar's leading edge. */
	accent: string;
	/** The bar's resting fill — the accent washed toward the surface, so `--on-surface` ink reads on it. */
	fill: string;
	/** The bar's hovered fill — one step stronger. */
	fillHover: string;
	/** The verified-contrast ink for text drawn ON the solid accent (a milestone's chip). */
	onAccent: string;
}

/** Every drawing value the painter reads. Colours are canvas-ready strings; lengths are CSS px. */
export interface GanttPalette {
	/** The minor vertical rule (a bottom-tier boundary). */
	rule: string;
	ruleWidth: number;
	/** The major vertical rule (a top-tier boundary). */
	ruleMajor: string;
	ruleMajorWidth: number;
	/** The horizontal row seam. */
	rowRule: string;
	rowRuleWidth: number;
	/** The alternating row wash. */
	rowAlt: string;
	/** The hovered lane's wash. */
	rowHover: string;
	/** The lane holding the selected item. */
	rowSelected: string;
	/** The weekend wash. */
	weekend: string;
	/** The today rule and its diameter cap. */
	today: string;
	todayWidth: number;
	todayCap: number;
	/** Bar and milestone labels, drawn on the washed fill or beside the mark. */
	labelText: TextStyle;
	/** The second line an expanded lane reveals. */
	metaText: TextStyle;
	/** The bar's corner radius. */
	barRadius: number;
	/** The bar's inset from the row's top and bottom edge. */
	barInset: number;
	/** Text padding inside a bar. */
	barPad: number;
	/** The progress strip's height along the bar's base. */
	progressH: number;
	/** The milestone diamond's diagonal. */
	milestoneSize: number;
	/** Dependency links: stroke, width, arrowhead size. */
	link: string;
	linkWidth: number;
	arrowSize: number;
	/** The draft block: fill, stroke, stroke width, dash + gap, alpha. */
	draftFill: string;
	draftStroke: string;
	draftStrokeWidth: number;
	draftDash: number;
	draftGap: number;
	draftAlpha: number;
	/** The two-tone focus ring (ink + halo) and its width. */
	focusRing: string;
	focusRingHalo: string;
	focusRingWidth: number;
	/** Fly mode's origin marker: ring colour, diameter, stroke. */
	flyRing: string;
	flyRingSize: number;
	flyRingWidth: number;
	/** The base row height token — the store adopts it. */
	rowH: number;
	/** How far (px) a lane expands on hover to reveal a truncated label + its meta line. */
	rowExpand: number;
	accents: Record<string, GanttAccentPaint>;
	/** The paint for a token the probe rendered no swatch for — draws nothing at all. */
	accentFallback: GanttAccentPaint;
}
// #endregion

// #region Readers
/** A resolved declaration, preferring the LOGICAL property name. */
function decl(cs: CSSStyleDeclaration, logical: string, physical: string): string {
	return cs.getPropertyValue(logical) || cs.getPropertyValue(physical);
}

/** A resolved length in px, or `0` when the declaration did not reach the swatch. */
function len(value: string): number {
	const n = parseFloat(value);
	return Number.isFinite(n) ? n : 0;
}

/**
 * A resolved text style, assembled from the LONGHANDS. `getComputedStyle(el).font` is empty in more
 * than one engine, and an empty `ctx.font` silently leaves the 2D context on 10px sans-serif.
 * Building it from the parts is also what lets the open-dyslexic overlay — a family swap PLUS
 * tracking, word spacing and leading — reach the canvas in full.
 */
function textStyle(cs: CSSStyleDeclaration): TextStyle {
	const size = len(cs.fontSize);
	const style = cs.fontStyle && cs.fontStyle !== "normal" ? `${cs.fontStyle} ` : "";
	const lh = parseFloat(cs.lineHeight);
	return {
		font: `${style}${cs.fontWeight || 400} ${size}px ${cs.fontFamily || "sans-serif"}`,
		color: toCanvasColor(cs.color),
		size,
		letterSpacing: cs.letterSpacing || "normal",
		wordSpacing: cs.wordSpacing || "normal",
		lineHeight: Number.isFinite(lh) ? lh : 0,
	};
}

const NO_TEXT: TextStyle = {
	font: "",
	color: "",
	size: 0,
	letterSpacing: "normal",
	wordSpacing: "normal",
	lineHeight: 0,
};

const NO_ACCENT: GanttAccentPaint = { accent: "", fill: "", fillHover: "", onAccent: "" };

/**
 * Resolve one card paint per accent swatch the probe is rendering. FOUR properties on ONE element:
 * `color` the accent, `background-color` the washed fill, the block-start border colour the hovered
 * fill, and `text-decoration-color` the ink drawn on the solid accent — every one a colour property
 * a 0×0 clipped span can declare without painting.
 */
function readAccents(probe: HTMLElement): Record<string, GanttAccentPaint> {
	const out: Record<string, GanttAccentPaint> = {};
	for (const el of Array.from(probe.querySelectorAll(".gantt-probe__swatch--accent"))) {
		const token = el.getAttribute("data-accent");
		if (!token) continue;
		const cs = getComputedStyle(el);
		out[token] = {
			accent: toCanvasColor(cs.color),
			fill: toCanvasColor(cs.backgroundColor),
			fillHover: toCanvasColor(
				cs.getPropertyValue("border-block-start-color") || cs.getPropertyValue("border-top-color"),
			),
			onAccent: toCanvasColor(cs.textDecorationColor),
		};
	}
	return out;
}

/**
 * Read every drawing value off the swatches.
 *
 * Returns `null` when the lattice subtree is not there (a consumer that has not loaded the
 * stylesheet), which the caller treats as "paint nothing" — recoverable on the next draw, where a
 * palette of invented defaults would look deliberate and be wrong. The remaining swatches degrade
 * INDIVIDUALLY: a missing one resolves to an empty colour or a zero length, and the painter skips a
 * layer it has no paint for.
 */
export function readGanttPalette(probe: HTMLElement): GanttPalette | null {
	const swatch = (name: string): CSSStyleDeclaration | null => {
		const el = probe.querySelector(`.gantt-probe__swatch--${name}`);
		return el ? getComputedStyle(el) : null;
	};
	const rule = swatch("rule");
	const ruleMajor = swatch("rule-major");
	const row = swatch("row");
	if (!rule || !ruleMajor || !row) return null;

	const colour = (cs: CSSStyleDeclaration | null, prop: string): string =>
		cs ? toCanvasColor(cs.getPropertyValue(prop)) : "";
	const border = (cs: CSSStyleDeclaration | null): string =>
		cs ? toCanvasColor(decl(cs, "border-block-start-color", "border-top-color")) : "";
	const borderW = (cs: CSSStyleDeclaration | null): number =>
		cs ? len(decl(cs, "border-block-start-width", "border-top-width")) : 0;
	const size = (cs: CSSStyleDeclaration | null): number => cs ? len(cs.inlineSize || cs.width) : 0;
	const blockSize = (cs: CSSStyleDeclaration | null): number =>
		cs ? len(cs.blockSize || cs.height) : 0;
	const text = (name: string): TextStyle => {
		const cs = swatch(name);
		return cs ? textStyle(cs) : NO_TEXT;
	};

	const today = swatch("today");
	const bar = swatch("bar");
	const milestone = swatch("milestone");
	const link = swatch("link");
	const draft = swatch("draft");
	const focus = swatch("focus");
	const fly = swatch("fly");
	const weekend = swatch("weekend");
	const rowHover = swatch("row-hover");
	const rowSelected = swatch("row-selected");
	const rowRule = swatch("row-rule");

	return {
		rule: border(rule),
		ruleWidth: borderW(rule),
		ruleMajor: border(ruleMajor),
		ruleMajorWidth: borderW(ruleMajor),
		rowRule: border(rowRule),
		rowRuleWidth: borderW(rowRule),
		// The washes ride `color` — the one inherited paint property a swatch can carry without
		// painting itself; a `background-color` probe would be a visible box.
		rowAlt: colour(row, "color"),
		rowHover: colour(rowHover, "color"),
		rowSelected: colour(rowSelected, "color"),
		weekend: colour(weekend, "color"),
		today: border(today),
		todayWidth: borderW(today),
		todayCap: size(today),
		labelText: text("label"),
		metaText: text("meta"),
		barRadius: bar ? len(decl(bar, "border-start-start-radius", "border-top-left-radius")) : 0,
		// Geometry off lengths that resolve EXACTLY. A border width snaps to whole device pixels, so a
		// fractional token would round; `block-size`, `inline-size` and a padding do not.
		barInset: blockSize(bar),
		barPad: bar ? len(decl(bar, "padding-inline-start", "padding-left")) : 0,
		progressH: bar ? len(decl(bar, "margin-block-end", "margin-bottom")) : 0,
		milestoneSize: size(milestone),
		link: border(link),
		linkWidth: borderW(link),
		arrowSize: size(link),
		draftFill: colour(draft, "background-color"),
		draftStroke: border(draft),
		draftStrokeWidth: borderW(draft),
		// A canvas takes a dash as a pair of NUMBERS, and `border-style: dashed` gives back only the
		// word — so the two lengths ride `column-rule-width` and `outline-width`, which compute to real
		// pixels on an element that paints neither.
		draftDash: draft ? len(draft.getPropertyValue("column-rule-width")) : 0,
		draftGap: draft ? len(draft.outlineWidth) : 0,
		draftAlpha: draft ? parseFloat(draft.opacity) || 1 : 1,
		focusRing: focus ? toCanvasColor(focus.outlineColor) : "",
		focusRingHalo: border(focus),
		focusRingWidth: focus ? len(focus.outlineWidth) : 0,
		flyRing: border(fly),
		flyRingSize: size(fly),
		flyRingWidth: borderW(fly),
		rowH: blockSize(row),
		rowExpand: row ? len(decl(row, "padding-block-end", "padding-bottom")) : 0,
		accents: readAccents(probe),
		accentFallback: NO_ACCENT,
	};
}
// #endregion

// #region General resolution
/**
 * Resolve ANY colour expression the cascade understands — `var(--primary)`,
 * `color-mix(in srgb, var(--danger) 40%, transparent)` — to a canvas-ready string.
 *
 * It writes the expression to a scratch swatch inside `probe` (created on first use, reused after),
 * reads the computed `color` back and normalises it. The scratch element is a child of the probe so
 * it inherits the same theme scope the palette does. A consumer resolving many tokens should read
 * them in one pass: each call is one style recalc.
 */
export function resolveCssColor(probe: HTMLElement, expression: string): string {
	let scratch = probe.querySelector<HTMLElement>(".gantt-probe__scratch");
	if (!scratch) {
		scratch = document.createElement("span");
		scratch.className = "gantt-probe__swatch gantt-probe__scratch";
		probe.appendChild(scratch);
	}
	scratch.style.color = expression;
	return toCanvasColor(getComputedStyle(scratch).color);
}

/**
 * The `--on-x` ink token for an accent token, by the palette's own naming convention. Re-exported
 * from the calendar engine so the two canvases derive ink identically.
 */
export const onAccentTokenFor = onAccentFor;

/** A canvas colour string as `#rrggbb` (or `#rrggbbaa` when translucent); `null` if unparsable. */
export function cssColorToHex(value: string): string | null {
	const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
		toCanvasColor(value),
	);
	if (!m) return null;
	const hex = (n: number) =>
		Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
	const a = m[4] === undefined ? 1 : Number(m[4]);
	const base = `#${hex(Number(m[1]))}${hex(Number(m[2]))}${hex(Number(m[3]))}`;
	return a >= 1 ? base : `${base}${hex(a * 255)}`;
}
// #endregion
