/**
 * styles.gate.test — the workspace stylesheets' merge gates (Teams work order W1), held as a test.
 *
 * The repo has no CSS lint hook (`deno.json` runs `deno lint` over TypeScript only), so this reads
 * every sheet in `apps/web/features/workspaces/styles/` and fails, naming `file:line`, on anything the
 * W1 sweep removed coming back: a translucent `color-mix`, a literal weight, a literal duration, a hex
 * or `rgb()` colour, glass, a `px` breakpoint, or an `outline: none` with no ring beside it. The
 * remaining gates hold the rest of the sweep in place — `px` only inside a token declaration, `opacity`
 * only inside an animation, both reduced-motion channels, the `data-i` stagger, the deleted dead rules
 * and the removed inset rings.
 *
 * Comments are blanked before matching (line breaks kept, so offsets still map to source lines): the
 * sheets explain their own history in prose — "never `opacity`", "the 767px step" — and prose must not
 * trip a gate.
 */
import { assert } from "@std/assert";

// #region Sources
const STYLES_DIR = new URL("./", import.meta.url);
const FEATURE_DIR = new URL("../", import.meta.url);

interface Sheet {
	name: string;
	/** The sheet with every comment blanked to spaces, line breaks preserved. */
	css: string;
}

/** Blank every character of `text[start, end)` except line breaks, so offsets keep their line. */
function blankRange(text: string, start: number, end: number): string {
	return text.slice(0, start) + text.slice(start, end).replace(/[^\n]/g, " ") + text.slice(end);
}

function stripComments(src: string): string {
	return src.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

function readSheets(): Sheet[] {
	return [...Deno.readDirSync(STYLES_DIR)]
		.filter((entry) => entry.isFile && entry.name.endsWith(".css"))
		.map((entry) => entry.name)
		.sort()
		.map((name) => ({
			name,
			css: stripComments(
				Deno.readTextFileSync(new URL(name, STYLES_DIR)).replace(/\r\n?/g, "\n"),
			),
		}));
}

/** Every `.tsx` under the feature, for the gates that reach past the sheets. */
function readFeatureTsx(dir: URL = FEATURE_DIR, out: { name: string; src: string }[] = []) {
	for (const entry of Deno.readDirSync(dir)) {
		if (entry.isDirectory) readFeatureTsx(new URL(`${entry.name}/`, dir), out);
		else if (entry.name.endsWith(".tsx")) {
			const url = new URL(entry.name, dir);
			out.push({ name: url.pathname.split("/features/")[1], src: Deno.readTextFileSync(url) });
		}
	}
	return out;
}

const SHEETS = readSheets();
// #endregion

// #region Helpers
function lineOf(text: string, index: number): number {
	return text.slice(0, index).split("\n").length;
}

/** Index of the `)` closing the `(` at `open`, or -1. */
function closeParen(text: string, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		if (text[i] === "(") depth++;
		else if (text[i] === ")" && --depth === 0) return i;
	}
	return -1;
}

/** Index of the `}` closing the `{` at `open`, or -1. */
function closeBrace(text: string, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		if (text[i] === "{") depth++;
		else if (text[i] === "}" && --depth === 0) return i;
	}
	return -1;
}

/** The text with the ARGUMENTS of every `fn(` call blanked, so a gate can ask "outside var()". */
function blankCalls(text: string, fn: string): string {
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
function blocks(text: string, prelude: RegExp): [number, number][] {
	const ranges: [number, number][] = [];
	for (const match of text.matchAll(prelude)) {
		const open = text.indexOf("{", match.index!);
		const close = closeBrace(text, open);
		if (open >= 0 && close > open) ranges.push([open, close]);
	}
	return ranges;
}

/** The declaration block of the rule enclosing `index`. */
function ruleBody(text: string, index: number): string {
	const open = text.lastIndexOf("{", index);
	const close = text.indexOf("}", index);
	return text.slice(open + 1, close < 0 ? text.length : close);
}

/** The single declaration (`prop: value`) that `index` falls inside. */
function declarationAt(text: string, index: number): string {
	const start = Math.max(
		text.lastIndexOf(";", index),
		text.lastIndexOf("{", index),
		text.lastIndexOf("}", index),
	) + 1;
	const end = text.indexOf(";", index);
	return text.slice(start, end < 0 ? text.length : end).trim();
}

/** `file:line  snippet` for every match of `pattern` the `keep` predicate accepts. */
function offences(
	pattern: RegExp,
	keep: (sheet: Sheet, index: number, match: RegExpMatchArray) => boolean = () => true,
	view: (sheet: Sheet) => string = (sheet) => sheet.css,
): string[] {
	const found: string[] = [];
	for (const sheet of SHEETS) {
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
}

function assertNone(found: string[], gate: string): void {
	assert(found.length === 0, `${gate}\n  ${found.join("\n  ")}`);
}
// #endregion

// #region The W1 acceptance gates
Deno.test("workspace styles: the sheets were found", () => {
	assert(SHEETS.length >= 9, `expected the nine workspace sheets, read ${SHEETS.length}`);
});

Deno.test("workspace styles: no color-mix() against transparent", () => {
	// The acceptance pattern verbatim, plus a paren-balanced read: `[^)]*` stops at the first `)`
	// inside a nested `var()`, so on its own it misses `color-mix(in srgb, var(--x) 8%, transparent)`.
	const literal = offences(/color-mix\([^)]*transparent/);
	const balanced = offences(/color-mix\(/, (sheet, index) => {
		const open = index + "color-mix".length;
		return /\btransparent\b/.test(sheet.css.slice(open, closeParen(sheet.css, open)));
	});
	assertNone([...new Set([...literal, ...balanced])], "translucent color-mix() (§B.4.2):");
});

Deno.test("workspace styles: no literal font-weight", () => {
	assertNone(
		offences(/font-weight:\s*([0-9]|bold|bolder|lighter)/),
		"literal font-weight — use var(--fw-*) (§A.4):",
	);
});

Deno.test("workspace styles: no heading heavier than --fw-semibold", () => {
	assertNone(offences(/var\(--fw-bold\)/), "--fw-bold on this surface (§A.4):");
});

Deno.test("workspace styles: no literal duration outside var()", () => {
	assertNone(
		offences(/\b\d+ms\b|\b\d+(\.\d+)?s\b/, undefined, (sheet) => blankCalls(sheet.css, "var")),
		"literal duration — use var(--dur-*):",
	);
});

Deno.test("workspace styles: no hex colour", () => {
	assertNone(offences(/#[0-9a-f]{3,8}\b/i), "hex colour — use a theme token:");
});

Deno.test("workspace styles: no rgb()/rgba()", () => {
	assertNone(offences(/rgba?\(/), "rgb()/rgba() — use a theme token:");
});

Deno.test("workspace styles: no backdrop-filter", () => {
	assertNone(offences(/backdrop-filter/), "backdrop-filter on this surface (§B.4.3):");
});

Deno.test("workspace styles: no px breakpoint", () => {
	assertNone(
		offences(/@media[^{]*\d+px/),
		"px in @media — spell the ui breakpoint in rem (workspace-tokens.css):",
	);
});

Deno.test("workspace styles: no outline: none without a ring in the same rule", () => {
	assertNone(
		offences(
			/outline:\s*none/,
			(sheet, index) =>
				!/box-shadow:[^;]*var\(--(focus-ring|fld-focus)/.test(ruleBody(sheet.css, index)),
		),
		"outline: none with no box-shadow ring beside it:",
	);
});
// #endregion

// #region The rest of the sweep
Deno.test("workspace styles: px literals live only in token declarations", () => {
	assertNone(
		offences(
			/(\d*\.?\d+)px\b/,
			(sheet, index, match) =>
				Number(match[1]) !== 0 && !declarationAt(sheet.css, index).startsWith("--"),
		),
		"px literal in a rule — read a token (--space-*, --wsp-* geometry):",
	);
});

Deno.test("workspace styles: opacity only animates", () => {
	assertNone(
		offences(/\bopacity\s*:/, (sheet, index) => {
			const inKeyframes = blocks(sheet.css, /@keyframes\s[^{]*\{/g)
				.some(([open, close]) => index > open && index < close);
			return !inKeyframes &&
				!/^opacity\s*:\s*var\(--wsp-minor-fade\)$/.test(declarationAt(sheet.css, index));
		}),
		"opacity used as a state — dim the ink with --text-secondary / --fld-disabled-mix:",
	);
});

Deno.test("workspace styles: every reduced-motion rule has both channels", () => {
	const missing: string[] = [];
	for (const sheet of SHEETS) {
		const flat = sheet.css.replace(/\s+/g, " ");
		for (
			const [open, close] of blocks(
				sheet.css,
				/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g,
			)
		) {
			const inner = sheet.css.slice(open + 1, close);
			for (const rule of inner.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
				for (const selector of rule[1].split(",").map((s) => s.trim()).filter(Boolean)) {
					if (!flat.includes(`:root[data-motion="reduced"] ${selector}`)) {
						missing.push(`${sheet.name}:${lineOf(sheet.css, open)}  ${selector}`);
					}
				}
			}
		}
	}
	assertNone(missing, 'prefers-reduced-motion rule with no :root[data-motion="reduced"] twin:');
});

Deno.test("workspace styles: no four-sided inset ring on a card or row", () => {
	assertNone(
		offences(
			/box-shadow:\s*inset 0 0 0 [^;]*var\(--(hairline-color|wsp-acting-ring|wsp-kind-edge)\)/,
		),
		"inset ring around static content — use a leading rule or a tonal step (§B.4):",
	);
});

Deno.test("workspace styles: figure classes are tabular", () => {
	const all = SHEETS.map((sheet) => sheet.css).join("\n");
	const untabular = [
		".wsp-card__stats",
		".wsp-card__stat",
		".wsp-card__stat-delta",
		".wsp-split__pip",
	]
		.filter((selector) => {
			const at = all.search(new RegExp(`(^|\\n)${selector.replace(/[.-]/g, "\\$&")}\\s*\\{`));
			return at < 0 || !ruleBody(all, all.indexOf("{", at) + 1).includes("tabular-nums");
		});
	assertNone(untabular, "figure class without tabular-nums (§A.4):");
});

Deno.test("workspace styles: the dead rules stay deleted", () => {
	assertNone(
		offences(/\.wsp-skel\b|\.wsp-lane__new\b|\.wsp-footerrig__action\[data-variant/),
		"a deleted dead selector is back:",
	);
});

Deno.test("workspace styles: the stagger is a data-i ladder, not an inline style", () => {
	const ladder = SHEETS.map((sheet) => sheet.css).join("\n");
	const rungs = Array.from({ length: 12 }, (_, i) => `[data-i="${i}"]`).filter((rung) =>
		!ladder.includes(`${rung} {`)
	);
	if (!/(^|\n)\[data-i\] \{/.test(ladder)) rungs.push("[data-i] (the past-11 default)");
	assertNone(rungs, "missing data-i ladder rung:");

	const inline = readFeatureTsx()
		.filter((file) => file.src.includes('"--wsp-i"'))
		.map((file) => file.name);
	assertNone(inline, "a component writes --wsp-i inline — set data-i instead:");
});
// #endregion
