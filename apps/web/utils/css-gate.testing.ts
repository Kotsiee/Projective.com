/**
 * css-gate.testing — the stylesheet merge gates (root CLAUDE.md §3), shared by every feature that holds
 * its sheets to them as a test (`features/workspaces/styles/styles.gate.test.ts`,
 * `features/auth/styles/styles.gate.test.ts`).
 *
 * The repo has no CSS lint hook (`deno.json` runs `deno lint` over TypeScript only), so a feature reads
 * its own sheets with {@link readSheets} and registers the common gates with
 * {@link registerCommonGates}; anything surface-specific (a sanctioned exception, a dead-rule list, a
 * stagger ladder) stays in the feature's own test, built from the helpers below.
 *
 * Comments are blanked before matching (line breaks kept, so offsets still map to source lines): the
 * sheets explain their own history in prose — "never `opacity`", "the 767px step" — and prose must not
 * trip a gate. `url()` arguments are blanked for the colour, pixel and duration gates for the same
 * reason: a resource path is a name, not a value.
 */
import { assert } from "@std/assert";

// #region Sources
/** One stylesheet, read for gating. */
export interface Sheet {
	name: string;
	/** The sheet with every comment blanked to spaces, line breaks preserved. */
	css: string;
}

/** Blank every character of `text[start, end)` except line breaks, so offsets keep their line. */
export function blankRange(text: string, start: number, end: number): string {
	return text.slice(0, start) + text.slice(start, end).replace(/[^\n]/g, " ") + text.slice(end);
}

/** `src` with every comment blanked to spaces, line breaks preserved. */
export function stripComments(src: string): string {
	return src.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

/** Every `.css` file directly in `dir`, sorted by name, comments blanked and line endings normalised. */
export function readSheets(dir: URL): Sheet[] {
	return [...Deno.readDirSync(dir)]
		.filter((entry) => entry.isFile && entry.name.endsWith(".css"))
		.map((entry) => entry.name)
		.sort()
		.map((name) => ({
			name,
			css: stripComments(Deno.readTextFileSync(new URL(name, dir)).replace(/\r\n?/g, "\n")),
		}));
}

/** Every `.tsx` under `dir`, named by its path below `/features/`, for gates that reach past the sheets. */
export function readFeatureTsx(
	dir: URL,
	out: { name: string; src: string }[] = [],
): { name: string; src: string }[] {
	for (const entry of Deno.readDirSync(dir)) {
		if (entry.isDirectory) readFeatureTsx(new URL(`${entry.name}/`, dir), out);
		else if (entry.name.endsWith(".tsx")) {
			const url = new URL(entry.name, dir);
			out.push({ name: url.pathname.split("/features/")[1], src: Deno.readTextFileSync(url) });
		}
	}
	return out;
}
// #endregion

// #region Helpers
/** The 1-based line of `index` in `text`. */
export function lineOf(text: string, index: number): number {
	return text.slice(0, index).split("\n").length;
}

/** Index of the `)` closing the `(` at `open`, or -1. */
export function closeParen(text: string, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		if (text[i] === "(") depth++;
		else if (text[i] === ")" && --depth === 0) return i;
	}
	return -1;
}

/** Index of the `}` closing the `{` at `open`, or -1. */
export function closeBrace(text: string, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		if (text[i] === "{") depth++;
		else if (text[i] === "}" && --depth === 0) return i;
	}
	return -1;
}

/** The text with the ARGUMENTS of every `fn(` call blanked, so a gate can ask "outside var()". */
export function blankCalls(text: string, fn: string): string {
	let out = text;
	const pattern = new RegExp(`\\b${fn}\\(`, "g");
	for (const match of text.matchAll(pattern)) {
		const open = match.index! + fn.length;
		const close = closeParen(text, open);
		if (close > open) out = blankRange(out, open + 1, close);
	}
	return out;
}

/** [start, end) ranges of every `@<at-rule>` block whose prelude matches `prelude`. */
export function blocks(text: string, prelude: RegExp): [number, number][] {
	const ranges: [number, number][] = [];
	for (const match of text.matchAll(prelude)) {
		const open = text.indexOf("{", match.index!);
		const close = closeBrace(text, open);
		if (open >= 0 && close > open) ranges.push([open, close]);
	}
	return ranges;
}

/** True when `index` falls inside any of `ranges`. */
export function within(ranges: [number, number][], index: number): boolean {
	return ranges.some(([open, close]) => index > open && index < close);
}

/** The declaration block of the rule enclosing `index`. */
export function ruleBody(text: string, index: number): string {
	const open = text.lastIndexOf("{", index);
	const close = text.indexOf("}", index);
	return text.slice(open + 1, close < 0 ? text.length : close);
}

/** The selector list of the rule whose declaration block encloses `index`, whitespace collapsed. */
export function ruleSelector(text: string, index: number): string {
	const open = text.lastIndexOf("{", index);
	const start = Math.max(
		text.lastIndexOf("}", open),
		text.lastIndexOf("{", open - 1),
		text.lastIndexOf(";", open),
	) + 1;
	return text.slice(start, open).replace(/\s+/g, " ").trim();
}

/** `source` with every regex metacharacter escaped, for building a pattern from a selector. */
export function escapeRegExp(source: string): string {
	return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The declaration block of the `:root[data-motion="reduced"] <selector>` twin, or `null` when the sheet
 * has none. `flat` is the sheet with whitespace collapsed. The selector must END where the twin's
 * selector does (at a `,` or the `{`), so `.x` is not satisfied by a twin for `.x-glyph` or `.x::after`.
 */
export function reducedTwin(flat: string, selector: string): string | null {
	const twin = new RegExp(
		`:root\\[data-motion="reduced"\\] ${escapeRegExp(selector)}(?=\\s*[,{])`,
	).exec(flat);
	if (!twin) return null;
	const open = flat.indexOf("{", twin.index);
	const close = flat.indexOf("}", open);
	return flat.slice(open + 1, close < 0 ? flat.length : close);
}

/** A selector list split on its top-level commas (a comma inside `:is(…)` does not split it). */
export function splitSelectorList(list: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < list.length; i++) {
		if (list[i] === "(") depth++;
		else if (list[i] === ")") depth--;
		else if (list[i] === "," && depth === 0) {
			parts.push(list.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(list.slice(start));
	return parts.map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** Every selector of every rule directly inside the at-rule block `[open, close)`. */
export function blockSelectors(text: string, open: number, close: number): {
	selector: string;
	body: string;
}[] {
	const out: { selector: string; body: string }[] = [];
	for (const rule of text.slice(open + 1, close).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		for (const selector of splitSelectorList(rule[1])) out.push({ selector, body: rule[2] });
	}
	return out;
}

/** The single declaration (`prop: value`) that `index` falls inside. */
export function declarationAt(text: string, index: number): string {
	const start = Math.max(
		text.lastIndexOf(";", index),
		text.lastIndexOf("{", index),
		text.lastIndexOf("}", index),
	) + 1;
	const end = text.indexOf(";", index);
	return text.slice(start, end < 0 ? text.length : end).trim();
}

/** A match filter: keep the match at `index` of `sheet`? */
export type Keep = (sheet: Sheet, index: number, match: RegExpMatchArray) => boolean;

/** `file:line  snippet` for every match of `pattern` in `sheets` the `keep` predicate accepts. */
export type Offences = (
	pattern: RegExp,
	keep?: Keep,
	view?: (sheet: Sheet) => string,
) => string[];

/** An {@link Offences} finder over `sheets`. */
export function offencesIn(sheets: Sheet[]): Offences {
	return (pattern, keep = () => true, view = (sheet) => sheet.css) => {
		const found: string[] = [];
		for (const sheet of sheets) {
			const text = view(sheet);
			const global = new RegExp(
				pattern.source,
				pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
			);
			for (const match of text.matchAll(global)) {
				if (!keep(sheet, match.index!, match)) continue;
				const line = lineOf(text, match.index!);
				found.push(`${sheet.name}:${line}  ${sheet.css.split("\n")[line - 1].trim()}`);
			}
		}
		return found;
	};
}

/**
 * The sheet with every `url()` argument blanked: a path such as `/icons/24px/mark.svg` or a fragment
 * such as `#fade` is a resource name, not a pixel or a colour.
 */
export function withoutUrls(sheet: Sheet): string {
	return blankCalls(sheet.css, "url");
}

/** Fail with `gate` and every offence, one per line, unless there are none. */
export function assertNone(found: string[], gate: string): void {
	assert(found.length === 0, `${gate}\n  ${found.join("\n  ")}`);
}
// #endregion

// #region The common gates
/** What a surface tells {@link registerCommonGates}. */
export interface CommonGateOptions {
	/** The test-name prefix, e.g. `"workspace styles"`. */
	label: string;
	sheets: Sheet[];
	/** True for a `px` match a sanctioned exception owns (both `px` gates skip it). */
	pxException?: (sheet: Sheet, index: number) => boolean;
	/** The fix the `px` breakpoint gate names. */
	pxBreakpointFix?: string;
	/** The fix the `px` literal gate names. */
	pxLiteralFix?: string;
}

/**
 * Register the gates every policed surface shares: no translucent `color-mix`, no literal weight, no
 * `--fw-bold`, no literal duration, no hex or `rgb()`, no glass, no `px` breakpoint, no `outline: none`
 * without a ring, `px` only in token declarations, both reduced-motion channels, and an in-app stop for
 * every opt-in animation.
 */
export function registerCommonGates(options: CommonGateOptions): void {
	const { label, sheets } = options;
	const offences = offencesIn(sheets);
	const pxException = options.pxException ?? (() => false);

	Deno.test(`${label}: no color-mix() against transparent`, () => {
		// The acceptance pattern verbatim, plus a paren-balanced read: `[^)]*` stops at the first `)`
		// inside a nested `var()`, so on its own it misses `color-mix(in srgb, var(--x) 8%, transparent)`.
		const literal = offences(/color-mix\([^)]*transparent/);
		const balanced = offences(/color-mix\(/, (sheet, index) => {
			const open = index + "color-mix".length;
			return /\btransparent\b/.test(sheet.css.slice(open, closeParen(sheet.css, open)));
		});
		assertNone([...new Set([...literal, ...balanced])], "translucent color-mix() (§B.4.2):");
	});

	Deno.test(`${label}: no literal font-weight`, () => {
		// The longhand, and a weight inside the `font` shorthand (`font: 600 1rem/1.2 …`).
		assertNone(
			[
				...offences(/font-weight:\s*([0-9]|bold|bolder|lighter)/),
				...offences(
					/(?<=^|[;{\s])font\s*:[^;{}]*?(?<=[\s:])([1-9]00|bold|bolder|lighter)(?=[\s;}]|$)/,
				),
			],
			"literal font-weight — use var(--fw-*) (§A.4):",
		);
	});

	Deno.test(`${label}: no heading heavier than --fw-semibold`, () => {
		assertNone(offences(/var\(--fw-bold\)/), "--fw-bold on this surface (§A.4):");
	});

	Deno.test(`${label}: no literal duration outside var()`, () => {
		assertNone(
			offences(
				/\b\d+ms\b|\b\d+(\.\d+)?s\b/,
				undefined,
				(sheet) => blankCalls(withoutUrls(sheet), "var"),
			),
			"literal duration — use var(--dur-*):",
		);
	});

	Deno.test(`${label}: no hex colour`, () => {
		assertNone(
			offences(/#[0-9a-f]{3,8}\b/i, undefined, withoutUrls),
			"hex colour — use a theme token:",
		);
	});

	Deno.test(`${label}: no rgb()/rgba()`, () => {
		assertNone(offences(/rgba?\(/), "rgb()/rgba() — use a theme token:");
	});

	Deno.test(`${label}: no backdrop-filter`, () => {
		assertNone(offences(/backdrop-filter/), "backdrop-filter on this surface (§B.4.3):");
	});

	Deno.test(`${label}: no px breakpoint`, () => {
		assertNone(
			offences(/@media[^{]*\d+px/, (sheet, index) => !pxException(sheet, index)),
			`px in @media — ${options.pxBreakpointFix ?? "spell the breakpoint in rem"}:`,
		);
	});

	Deno.test(`${label}: no outline: none without a ring in the same rule`, () => {
		// `outline: 0` and a zero `outline-width` hide the outline exactly as `none` does. The ring must
		// be a real `box-shadow` declaration, not a custom property whose name happens to end in one.
		assertNone(
			offences(
				/(?<=^|[;{\s])outline(-style|-width)?\s*:\s*(none|0(\.0+)?[a-z]*)\s*(!important\s*)?(?=[;}]|$)/,
				(sheet, index) =>
					!/(^|[;{\s])box-shadow\s*:[^;]*var\(--(focus-ring|fld-focus)/.test(
						ruleBody(sheet.css, index),
					),
			),
			"outline: none with no box-shadow ring beside it:",
		);
	});

	Deno.test(`${label}: px literals live only in token declarations`, () => {
		assertNone(
			offences(
				/(\d*\.?\d+)px\b/,
				(sheet, index, match) =>
					Number(match[1]) !== 0 && !declarationAt(sheet.css, index).startsWith("--") &&
					!pxException(sheet, index),
				withoutUrls,
			),
			`px literal in a rule — ${options.pxLiteralFix ?? "read a token (--space-*, --icon-*)"}:`,
		);
	});

	Deno.test(`${label}: every reduced-motion rule has both channels`, () => {
		const missing: string[] = [];
		for (const sheet of sheets) {
			const flat = sheet.css.replace(/\s+/g, " ");
			// Any prelude that asks for reduced motion — `screen and (…)`, the boolean form — not one
			// spelling.
			const reduce = /@media[^{]*\(\s*prefers-reduced-motion(\s*:\s*reduce)?\s*\)[^{]*\{/g;
			for (const [open, close] of blocks(sheet.css, reduce)) {
				for (const { selector } of blockSelectors(sheet.css, open, close)) {
					if (reducedTwin(flat, selector) === null) {
						missing.push(`${sheet.name}:${lineOf(sheet.css, open)}  ${selector}`);
					}
				}
			}
		}
		assertNone(missing, 'prefers-reduced-motion rule with no :root[data-motion="reduced"] twin:');
	});

	Deno.test(`${label}: an opt-in animation stops under the in-app reduced-motion switch`, () => {
		// A `no-preference` block runs its animation for everyone whose OS has not asked for reduced
		// motion — including a reader who switched motion off in the app. Each animated selector must be
		// scoped out of `:root[data-motion="reduced"]` or reset there.
		const unguarded: string[] = [];
		for (const sheet of sheets) {
			const flat = sheet.css.replace(/\s+/g, " ");
			const opted = /@media[^{]*\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)[^{]*\{/g;
			for (const [open, close] of blocks(sheet.css, opted)) {
				for (const { selector, body } of blockSelectors(sheet.css, open, close)) {
					if (!/(^|[;{\s])animation(-name)?\s*:/.test(body)) continue;
					if (selector.startsWith(':root:not([data-motion="reduced"])')) continue;
					const twin = reducedTwin(flat, selector);
					if (twin === null || !/(^|[;\s])animation(-name)?\s*:\s*none\b/.test(twin)) {
						unguarded.push(`${sheet.name}:${lineOf(sheet.css, open)}  ${selector}`);
					}
				}
			}
		}
		assertNone(
			unguarded,
			'no-preference animation with no :root[data-motion="reduced"] { animation: none } twin:',
		);
	});
}
// #endregion
