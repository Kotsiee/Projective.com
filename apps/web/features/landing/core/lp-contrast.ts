/**
 * lp-contrast.ts — the landing token sheet's contrast audit (`flows/LANDING.md` §3.3), recomputed
 * from `styles/lp-theme.css` itself so the published table cannot drift from the stylesheet.
 *
 * {@link themeStates} reads the sheet's four mode/contrast states (light, dark, and each with the
 * in-app high-contrast overlay; the OS channel must declare the same values). {@link contrastTable}
 * evaluates every §3.3 pairing in each state against the worst ground of its family:
 *
 *   - **Grounds.** The canvas (and the pale wash that moves it furthest towards the ink), the three
 *     surfaces, the warm editorial pair; the hero stack — canvas, wash, spotlight peak, lit grid line —
 *     and that stack plus one of: the amber halo or the teal halo at half its `--lp-glow-*` alpha (the
 *     search field's edge; no text sits closer), a node at `--lp-node-alpha-quiet` (every copy zone,
 *     the header pill's band included) or a node at full `--lp-node-alpha` (outside copy).
 *   - **Grain.** B10 grain at `--lp-grain-opacity` composited over the ground in both polarities
 *     (white and black), the worse kept — a conservative bound, since grain never paints over
 *     surfaces or fills. The high-contrast states carry no grain (`--lp-grain-opacity: 0`).
 *   - **Glass.** The pill's glass is `--lp-surface-1` at `--lp-glass-veil` over white or black content.
 *
 * Run it to print the table: `deno run --allow-read apps/web/features/landing/core/lp-contrast.ts`.
 * `lp-theme.contrast.test.ts` fails any cell below its floor and any published cell that differs from
 * this output by more than 0.01.
 */
import { composite, relativeLuminance, type Rgb } from "./constellation.ts";

// #region Sheet
/** The four states the table reports, in column order. */
export const STATES = ["dark", "light", "dark HC", "light HC"] as const;

/** One mode/contrast state. */
export type ThemeState = (typeof STATES)[number];

/** Every `--lp-*` declaration in effect for one state, as raw CSS values. */
export type TokenSet = Readonly<Record<string, string>>;

/** The selectors whose blocks make up each state, in cascade order (later wins). */
const BLOCKS = {
	base: ":is(.lp-root, .lp-portal) {",
	light: "/* #region Light",
	dark: ':root[data-theme="dark"] :is(.lp-root, .lp-portal) {',
	osLight:
		':root:not([data-theme="dark"]):not([data-contrast="normal"]) :is(.lp-root, .lp-portal) {',
	osDark: ':root[data-theme="dark"]:not([data-contrast="normal"]) :is(.lp-root, .lp-portal) {',
	appLight: ':root:not([data-theme="dark"])[data-contrast="high"] :is(.lp-root, .lp-portal) {',
	appDark: ':root[data-theme="dark"][data-contrast="high"] :is(.lp-root, .lp-portal) {',
} as const;

function stripComments(css: string): string {
	return css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
}

/** The declarations of the first rule block opening at or after `from` with `opener`. */
function block(css: string, opener: string, from = 0): Record<string, string> {
	const at = css.indexOf(opener, from);
	if (at < 0) throw new Error(`lp-theme.css: no block "${opener}"`);
	const open = css.indexOf("{", at);
	let depth = 1;
	let i = open + 1;
	while (depth > 0 && i < css.length) {
		if (css[i] === "{") depth += 1;
		else if (css[i] === "}") depth -= 1;
		i += 1;
	}
	const body = css.slice(open + 1, i - 1);
	const out: Record<string, string> = {};
	let paren = 0;
	let start = 0;
	for (let k = 0; k <= body.length; k++) {
		const ch = body[k];
		if (ch === "(") paren += 1;
		else if (ch === ")") paren -= 1;
		else if ((ch === ";" && paren === 0) || k === body.length) {
			const decl = body.slice(start, k);
			start = k + 1;
			const colon = decl.indexOf(":");
			if (colon < 0) continue;
			const name = decl.slice(0, colon).trim();
			if (name.startsWith("--lp-")) out[name] = decl.slice(colon + 1).trim().replace(/\s+/g, " ");
		}
	}
	return out;
}

/** The two high-contrast channels' blocks, so a test can hold them to the same values. */
export interface ContrastChannels {
	os: { light: TokenSet; dark: TokenSet };
	app: { light: TokenSet; dark: TokenSet };
}

/** Read the high-contrast overlays of both channels from `lp-theme.css`'s text. */
export function contrastChannels(sheet: string): ContrastChannels {
	const css = stripComments(sheet);
	return {
		os: { light: block(css, BLOCKS.osLight), dark: block(css, BLOCKS.osDark) },
		app: { light: block(css, BLOCKS.appLight), dark: block(css, BLOCKS.appDark) },
	};
}

/** The tokens in effect in each of the four states, from `lp-theme.css`'s text. */
export function themeStates(sheet: string): Record<ThemeState, TokenSet> {
	const css = stripComments(sheet);
	const base = block(css, BLOCKS.base);
	const light = {
		...base,
		...block(css, ":is(.lp-root, .lp-portal) {", sheet.indexOf(BLOCKS.light)),
	};
	const dark = { ...light, ...block(css, BLOCKS.dark) };
	const hc = contrastChannels(sheet).app;
	return {
		dark,
		light,
		"dark HC": { ...dark, ...hc.dark },
		"light HC": { ...light, ...hc.light },
	};
}
// #endregion

// #region Colour
const WHITE: Rgb = [1, 1, 1];
const BLACK: Rgb = [0, 0, 0];

/** A parsed colour: straight sRGB 0–1 and its alpha. */
interface Rgba {
	rgb: Rgb;
	alpha: number;
}

/** Parse the colour forms the sheet uses: `#rrggbb`, `rgb(r g b / a)` and `transparent`. */
export function parseColor(value: string): Rgba {
	const v = value.trim();
	if (v === "transparent") return { rgb: BLACK, alpha: 0 };
	const hex = v.match(/^#([0-9a-f]{6})$/i);
	if (hex) {
		const n = Number.parseInt(hex[1], 16);
		return { rgb: [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255], alpha: 1 };
	}
	const rgb = v.match(/^rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)$/);
	if (rgb) {
		return {
			rgb: [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255],
			alpha: rgb[4] === undefined ? 1 : Number(rgb[4]),
		};
	}
	throw new Error(`lp-contrast: cannot read colour "${value}"`);
}

/** WCAG 2.x contrast ratio of two opaque colours. */
export function contrastRatio(a: Rgb, b: Rgb): number {
	const x = relativeLuminance(a);
	const y = relativeLuminance(b);
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function linear(c: number): number {
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function gamma(c: number): number {
	const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
	return Math.min(1, Math.max(0, v));
}

/** The `t` mix of `a` and `b` in OKLab — the B9 ring's `conic-gradient(in oklab, …)` midpoints. */
export function mixOklab(a: Rgb, b: Rgb, t: number): Rgb {
	const lab = (c: Rgb) => {
		const [r, g, bl] = c.map(linear);
		const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
		const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
		const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
		return [
			0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
			1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
			0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
		];
	};
	const x = lab(a);
	const y = lab(b);
	const [L, A, B] = x.map((v, i) => v * (1 - t) + y[i] * t);
	const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
	const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
	const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
	return [
		gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
		gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
		gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
	];
}
// #endregion

// #region Grounds
/** The share of `--lp-glow-*` alpha at the nearest text: the search field's edge (§3.3). */
export const HALO_EDGE = 0.5;

/** One state's resolved colours and grounds. */
interface Palette {
	color(token: string): Rgb;
	number(token: string): number;
	grain: number;
	ground: Record<GroundKey, Rgb>;
}

type GroundKey =
	| "bg"
	| "wash"
	| "surface-1"
	| "surface-2"
	| "surface-3"
	| "warm-bg"
	| "warm-surface"
	| "hero"
	| "hero+amber-halo"
	| "hero+teal-halo"
	| "hero+quiet-node"
	| "hero+full-node";

/** The ground families the table names. */
const CANVAS: readonly GroundKey[] = ["bg", "wash", "surface-1", "surface-2", "surface-3"];
const HERO: readonly GroundKey[] = ["hero", "hero+amber-halo", "hero+teal-halo", "hero+quiet-node"];
const EDITORIAL: readonly GroundKey[] = ["warm-bg", "warm-surface"];
const HALOS: readonly GroundKey[] = ["hero+amber-halo", "hero+teal-halo"];
/** The header pill's band at the top of the page: the hero stack under the quiet constellation. */
const PILL_BAND: readonly GroundKey[] = ["hero", "hero+quiet-node"];

function palette(tokens: TokenSet, dark: boolean): Palette {
	const raw = (token: string) => {
		const v = tokens[token];
		if (v === undefined) throw new Error(`lp-theme.css: ${token} is not declared`);
		return v;
	};
	const rgba = (token: string) => parseColor(raw(token));
	const color = (token: string) => {
		const c = rgba(token);
		if (c.alpha !== 1) throw new Error(`${token} is translucent; it is not a solid ink or fill`);
		return c.rgb;
	};
	const number = (token: string) => {
		const n = Number.parseFloat(raw(token));
		if (!Number.isFinite(n)) throw new Error(`${token} is not a number`);
		return n;
	};
	const over = (under: Rgb, token: string, scale = 1) => {
		const c = rgba(token);
		return composite(under, c.rgb, c.alpha * scale);
	};
	const bg = color("--lp-bg");
	const pole = dark ? WHITE : BLACK;
	const washes = [bg, over(bg, "--lp-wash-teal"), over(bg, "--lp-wash-amber")];
	const toPole = (c: Rgb) => Math.abs(relativeLuminance(c) - relativeLuminance(pole));
	const wash = washes.reduce((worst, c) => (toPole(c) < toPole(worst) ? c : worst));
	const hero = over(over(wash, "--lp-spot"), "--lp-grid-line-lit");
	const node = color("--lp-node");
	return {
		color,
		number,
		grain: number("--lp-grain-opacity"),
		ground: {
			bg,
			wash,
			"surface-1": color("--lp-surface-1"),
			"surface-2": color("--lp-surface-2"),
			"surface-3": color("--lp-surface-3"),
			"warm-bg": color("--lp-warm-bg"),
			"warm-surface": color("--lp-warm-surface"),
			hero,
			"hero+amber-halo": over(hero, "--lp-glow-amber", HALO_EDGE),
			"hero+teal-halo": over(hero, "--lp-glow-teal", HALO_EDGE),
			"hero+quiet-node": composite(hero, node, number("--lp-node-alpha-quiet")),
			"hero+full-node": composite(hero, node, number("--lp-node-alpha")),
		},
	};
}

/** `ink` against `ground`, with grain over the ground in its worse polarity when `grain` is set. */
function pair(p: Palette, ink: Rgb, ground: Rgb, grain: boolean): number {
	if (!grain || p.grain === 0) return contrastRatio(ink, ground);
	return Math.min(
		contrastRatio(ink, composite(ground, WHITE, p.grain)),
		contrastRatio(ink, composite(ground, BLACK, p.grain)),
	);
}

/** The worst of `ink` over every ground in `family`. */
function worst(p: Palette, ink: Rgb, family: readonly GroundKey[], grain: boolean): number {
	return Math.min(...family.map((g) => pair(p, ink, p.ground[g], grain)));
}
// #endregion

// #region Table
/** One published row: a value group per state (one or more figures), its floors and verdict. */
export interface ContrastRow {
	label: string;
	/** Per state, the row's figures in order (`a / b / c` or `a · b · c` in the table). */
	values: Record<ThemeState, number[]>;
	/** How the figures join in a cell. */
	join: " / " | " · " | " → ";
	/** Printed before the figure (`≥`) when the row reports a minimum over a set. */
	prefix?: string;
	/** States the row does not apply to (printed `—`). */
	skip?: readonly ThemeState[];
	/** The normal floor and the high-contrast floor; `null` for an info-only row. */
	floor: { normal: number; hc: number } | null;
	/** The floor column's text. */
	floorText: string;
	/** The pass column's text when every figure clears its floor. */
	passText: string;
	/** When set, the floor is checked against these figures instead of the printed ones. */
	gate?: Record<ThemeState, number[]>;
}

const AA = { normal: 4.5, hc: 7 };
const NON_TEXT = { normal: 3, hc: 4.5 };

/** Every §3.3 row, evaluated from the sheet's text. */
export function contrastTable(sheet: string): ContrastRow[] {
	const states = themeStates(sheet);
	const pals = Object.fromEntries(
		STATES.map((s) => [s, palette(states[s], s.startsWith("dark"))]),
	) as Record<ThemeState, Palette>;
	const per = (fn: (p: Palette, state: ThemeState) => number[]) =>
		Object.fromEntries(STATES.map((s) => [s, fn(pals[s], s)])) as Record<ThemeState, number[]>;
	const rows: ContrastRow[] = [];
	const text = (
		label: string,
		inks: readonly string[],
		family: readonly GroundKey[],
		opts: Partial<ContrastRow> & { grain?: boolean } = {},
	) => {
		const grain = opts.grain ?? true;
		rows.push({
			label,
			values: per((p) => inks.map((ink) => worst(p, p.color(ink), family, grain))),
			join: " / ",
			floor: AA,
			floorText: "4.5 (7)",
			passText: "PASS",
			...opts,
		});
	};

	// Text on the canvas and the hero.
	for (
		const [name, ink] of [
			["text", "--lp-text"],
			["text-2", "--lp-text-2"],
			["text-3", "--lp-text-3"],
			["amber-ink", "--lp-amber-ink"],
			["teal-ink", "--lp-teal-ink"],
		] as const
	) {
		text(`${name} on canvas + surface-1..3`, [ink], CANVAS);
		text(
			`${name} on hero effects`,
			[ink],
			HERO,
			name === "text-2" ? { floorText: "4.5 (7); dark aim 7" } : {},
		);
	}
	text(
		"hero display (large) on full-alpha node (outside copy)",
		["--lp-text"],
		["hero+full-node"],
		{
			floor: NON_TEXT,
			floorText: "3 (4.5)",
			passText: "PASS — legal only because copy never leaves the quiet zone",
		},
	);
	text(
		"text · text-2 on the transparent pill (from --bp-lg at the top; its band is a copy zone)",
		["--lp-text", "--lp-text-2"],
		PILL_BAND,
		{ join: " · " },
	);

	// The warm editorial voice.
	text("warm-text on warm-bg / warm-surface", ["--lp-warm-text"], EDITORIAL);
	text("warm-text-2 on editorial", ["--lp-warm-text-2"], EDITORIAL);
	text("warm-text-3 on editorial", ["--lp-warm-text-3"], EDITORIAL);
	text("amber-ink / teal-ink on editorial", ["--lp-amber-ink", "--lp-teal-ink"], EDITORIAL);

	// Filled controls.
	const fill = (label: string, ink: string, fills: readonly string[], grain = true) =>
		rows.push({
			label,
			values: per((p) => fills.map((f) => pair(p, p.color(ink), p.color(f), grain))),
			join: " / ",
			floor: AA,
			floorText: "4.5 (7)",
			passText: "PASS",
		});
	fill("on-amber on amber / hover / active", "--lp-on-amber", [
		"--lp-amber",
		"--lp-amber-hover",
		"--lp-amber-active",
	]);
	fill("on-mono on mono / hover / active", "--lp-on-mono", [
		"--lp-mono",
		"--lp-mono-hover",
		"--lp-mono-active",
	]);
	fill("on-teal on teal-fill / hover / active", "--lp-on-teal", [
		"--lp-teal-fill",
		"--lp-teal-fill-hover",
		"--lp-teal-fill-active",
	]);
	fill("text on surface-3 (tonal, ghost hover)", "--lp-text", ["--lp-surface-3"], false);

	// The glass pill, once scrolled (and always below --bp-lg).
	rows.push({
		label:
			"text · text-2 · teal-ink on the glass pill (veil 82%, HC 88%, over white or black content)",
		values: per((p) => {
			const veil = p.number("--lp-glass-veil") / 100;
			const grounds = [WHITE, BLACK].map((c) => composite(c, p.color("--lp-surface-1"), veil));
			return ["--lp-text", "--lp-text-2", "--lp-teal-ink"].map((ink) =>
				Math.min(...grounds.map((g) => contrastRatio(p.color(ink), g)))
			);
		}),
		join: " · ",
		floor: AA,
		floorText: "4.5 (7)",
		passText: "PASS",
	});

	// Demo-stage status.
	const solid = (
		label: string,
		pairs: readonly [string, readonly string[]][],
		join: ContrastRow["join"],
	) =>
		rows.push({
			label,
			values: per((p) =>
				pairs.map(([ink, grounds]) =>
					Math.min(...grounds.map((g) => contrastRatio(p.color(ink), p.color(g))))
				)
			),
			join,
			floor: AA,
			floorText: "4.5 (7)",
			passText: "PASS",
		});
	solid("refuse-ink on refuse-fill · text on refuse-fill", [
		["--lp-refuse-ink", ["--lp-refuse-fill"]],
		["--lp-text", ["--lp-refuse-fill"]],
	], " · ");
	solid("ok-ink on ok-fill · held-ink on held-fill", [
		["--lp-ok-ink", ["--lp-ok-fill"]],
		["--lp-held-ink", ["--lp-held-fill"]],
	], " · ");
	solid("refuse / ok / held ink on surface-1 and -2", [
		["--lp-refuse-ink", ["--lp-surface-1", "--lp-surface-2"]],
		["--lp-ok-ink", ["--lp-surface-1", "--lp-surface-2"]],
		["--lp-held-ink", ["--lp-surface-1", "--lp-surface-2"]],
	], " / ");

	// Boundaries (non-text, 3:1).
	const boundary = (
		label: string,
		ink: (p: Palette) => Rgb,
		families: readonly (readonly GroundKey[])[],
		opts: Partial<ContrastRow> = {},
	) =>
		rows.push({
			label,
			values: per((p) => families.map((f) => worst(p, ink(p), f, false))),
			join: " · ",
			floor: NON_TEXT,
			floorText: "3 (4.5)",
			passText: "PASS",
			...opts,
		});
	boundary("edge vs canvas + surfaces · hero · editorial", (p) => p.color("--lp-edge"), [
		CANVAS,
		HERO,
		EDITORIAL,
	]);
	boundary(
		"amber-edge vs canvas + surfaces · hero · editorial",
		(p) => p.color("--lp-amber-edge"),
		[CANVAS, HERO, EDITORIAL],
	);
	boundary("mono fill vs canvas + surfaces · hero", (p) => p.color("--lp-mono"), [CANVAS, HERO]);
	boundary("teal-fill vs canvas + surfaces · hero · editorial", (p) => p.color("--lp-teal-fill"), [
		CANVAS,
		HERO,
		EDITORIAL,
	]);
	rows.push({
		label: "refuse-edge vs surface-2",
		values: per((p) => [contrastRatio(p.color("--lp-refuse-edge"), p.ground["surface-2"])]),
		join: " · ",
		floor: NON_TEXT,
		floorText: "3 (4.5)",
		passText: "PASS",
	});
	const ring = (label: string, stop: (p: Palette) => Rgb) =>
		boundary(label, stop, [["surface-1"], HALOS]);
	ring("B9 ring stop-a vs field · halo", (p) => p.color("--lp-glow-stop-a"));
	ring("B9 ring stop-b vs field · halo", (p) => p.color("--lp-glow-stop-b"));
	ring(
		"B9 ring OKLab midpoint vs field · halo",
		(p) => mixOklab(p.color("--lp-glow-stop-a"), p.color("--lp-glow-stop-b"), 0.5),
	);
	boundary("focus vs canvas + surfaces · hero · editorial", (p) => p.color("--lp-focus"), [
		CANVAS,
		HERO,
		EDITORIAL,
	]);
	rows.push({
		label: "focus vs amber / mono / teal fill (separated by the 2px gap)",
		values: per((p) =>
			["--lp-amber", "--lp-mono", "--lp-teal-fill"].map((f) =>
				contrastRatio(p.color("--lp-focus"), p.color(f))
			)
		),
		join: " / ",
		floor: null,
		floorText: "info only",
		passText: "info",
	});
	const boundaryGrounds = ["bg", "surface-1", "surface-2", "warm-bg"] as const;
	rows.push({
		label: "hover/press boundary: teal-fill (all states) vs worst of bg, surface-1, -2, warm-bg",
		values: per((p) => [
			Math.min(
				...["--lp-teal-fill", "--lp-teal-fill-hover", "--lp-teal-fill-active"].flatMap((f) =>
					boundaryGrounds.map((g) => contrastRatio(p.color(f), p.ground[g]))
				),
			),
		]),
		join: " · ",
		prefix: "≥ ",
		floor: { normal: 3, hc: 3 },
		floorText: "3",
		passText: "PASS",
	});
	const amberBoundary = (p: Palette, token: string) =>
		Math.min(...boundaryGrounds.map((g) => contrastRatio(p.color(token), p.ground[g])));
	const contour = per((p) => [amberBoundary(p, "--lp-amber-edge")]);
	const lightContour = Math.min(contour.light[0], contour["light HC"][0]);
	rows.push({
		label: "hover/press boundary: light amber fill (rest → press)",
		values: per((p) => [amberBoundary(p, "--lp-amber"), amberBoundary(p, "--lp-amber-active")]),
		join: " → ",
		skip: ["dark", "dark HC"],
		floor: { normal: 3, hc: 3 },
		floorText: `carried by \`--lp-amber-edge\` (≥ ${lightContour.toFixed(2)})`,
		passText: "PASS via contour",
		gate: contour,
	});
	return rows;
}

/** Whether every gated figure of `row` clears its floor in `state`. */
export function rowPasses(row: ContrastRow, state: ThemeState): boolean {
	if (!row.floor || row.skip?.includes(state)) return true;
	const floor = state.endsWith("HC") ? row.floor.hc : row.floor.normal;
	return (row.gate ?? row.values)[state].every((v) => v >= floor);
}

/** A row's printed cell for `state`. */
export function cell(row: ContrastRow, state: ThemeState): string {
	if (row.skip?.includes(state)) return "—";
	return (row.prefix ?? "") + row.values[state].map((v) => v.toFixed(2)).join(row.join);
}

/** The §3.3 table as Markdown, header included. */
export function markdownTable(rows: readonly ContrastRow[]): string {
	const lines = [
		`| pairing (worst ground) | ${STATES.join(" | ")} | floor (HC floor) | pass |`,
		"| :-- | --: | --: | --: | --: | :-- | :-- |",
	];
	for (const row of rows) {
		const pass = STATES.every((s) => rowPasses(row, s)) ? row.passText : "**FAIL**";
		lines.push(
			`| ${row.label} | ${
				STATES.map((s) => cell(row, s)).join(" | ")
			} | ${row.floorText} | ${pass} |`,
		);
	}
	return lines.join("\n");
}
// #endregion

if (import.meta.main) {
	const sheet = Deno.readTextFileSync(new URL("../styles/lp-theme.css", import.meta.url));
	const rows = contrastTable(sheet);
	console.log(markdownTable(rows));
	const audited = rows.filter((r) => r.floor !== null);
	const values = audited.reduce(
		(n, r) => n + STATES.reduce((m, s) => m + (r.skip?.includes(s) ? 0 : r.values[s].length), 0),
		0,
	);
	console.log(
		`\n${audited.length} audited rows, ${values} measured values, ${
			rows.length - audited.length
		} info-only.`,
	);
}
