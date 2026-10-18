/**
 * styles.gate.test — the workspace stylesheets' merge gates (Teams work order W1), held as a test.
 *
 * The repo has no CSS lint hook (`deno.json` runs `deno lint` over TypeScript only), so this reads
 * every sheet in `apps/web/features/workspaces/styles/` and fails, naming `file:line`, on anything the
 * W1 sweep removed coming back: a translucent `color-mix`, a literal weight, a literal duration, a hex
 * or `rgb()` colour, glass, a `px` breakpoint, or an `outline: none` with no ring beside it. The
 * remaining gates hold the rest of the sweep in place — `px` only inside a token declaration, `opacity`
 * only inside an animation, both reduced-motion channels (and an in-app stop for every opt-in
 * animation), the `data-i` stagger, the deleted dead rules and the removed inset rings.
 *
 * Comments are blanked before matching (line breaks kept, so offsets still map to source lines): the
 * sheets explain their own history in prose — "never `opacity`", "the 767px step" — and prose must not
 * trip a gate. `url()` arguments are blanked for the colour, pixel and duration gates for the same
 * reason: a resource path is a name, not a value.
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

/** True when `index` falls inside any of `ranges`. */
function within(ranges: [number, number][], index: number): boolean {
	return ranges.some(([open, close]) => index > open && index < close);
}

/** The declaration block of the rule enclosing `index`. */
function ruleBody(text: string, index: number): string {
	const open = text.lastIndexOf("{", index);
	const close = text.indexOf("}", index);
	return text.slice(open + 1, close < 0 ? text.length : close);
}

/** The selector list of the rule whose declaration block encloses `index`, whitespace collapsed. */
function ruleSelector(text: string, index: number): string {
	const open = text.lastIndexOf("{", index);
	const start = Math.max(
		text.lastIndexOf("}", open),
		text.lastIndexOf("{", open - 1),
		text.lastIndexOf(";", open),
	) + 1;
	return text.slice(start, open).replace(/\s+/g, " ").trim();
}

/** `source` with every regex metacharacter escaped, for building a pattern from a selector. */
function escapeRegExp(source: string): string {
	return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The declaration block of the `:root[data-motion="reduced"] <selector>` twin, or `null` when the sheet
 * has none. `flat` is the sheet with whitespace collapsed. The selector must END where the twin's
 * selector does (at a `,` or the `{`), so `.x` is not satisfied by a twin for `.x-glyph` or `.x::after`.
 */
function reducedTwin(flat: string, selector: string): string | null {
	const twin = new RegExp(
		`:root\\[data-motion="reduced"\\] ${escapeRegExp(selector)}(?=\\s*[,{])`,
	).exec(flat);
	if (!twin) return null;
	const open = flat.indexOf("{", twin.index);
	const close = flat.indexOf("}", open);
	return flat.slice(open + 1, close < 0 ? flat.length : close);
}

/** A selector list split on its top-level commas (a comma inside `:is(…)` does not split it). */
function splitSelectorList(list: string): string[] {
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
function blockSelectors(text: string, open: number, close: number): {
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

/**
 * The sheet with every `url()` argument blanked: a path such as `/icons/24px/mark.svg` or a fragment
 * such as `#fade` is a resource name, not a pixel or a colour.
 */
function withoutUrls(sheet: Sheet): string {
	return blankCalls(sheet.css, "url");
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

Deno.test("workspace styles: no heading heavier than --fw-semibold", () => {
	assertNone(offences(/var\(--fw-bold\)/), "--fw-bold on this surface (§A.4):");
});

Deno.test("workspace styles: no literal duration outside var()", () => {
	assertNone(
		offences(
			/\b\d+ms\b|\b\d+(\.\d+)?s\b/,
			undefined,
			(sheet) => blankCalls(withoutUrls(sheet), "var"),
		),
		"literal duration — use var(--dur-*):",
	);
});

Deno.test("workspace styles: no hex colour", () => {
	assertNone(
		offences(/#[0-9a-f]{3,8}\b/i, undefined, withoutUrls),
		"hex colour — use a theme token:",
	);
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
	// `outline: 0` and a zero `outline-width` hide the outline exactly as `none` does. The ring must be
	// a real `box-shadow` declaration, not a custom property whose name happens to end in one.
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
// #endregion

// #region The rest of the sweep
Deno.test("workspace styles: px literals live only in token declarations", () => {
	assertNone(
		offences(
			/(\d*\.?\d+)px\b/,
			(sheet, index, match) =>
				Number(match[1]) !== 0 && !declarationAt(sheet.css, index).startsWith("--"),
			withoutUrls,
		),
		"px literal in a rule — read a token (--space-*, --wsp-* geometry):",
	);
});

Deno.test("workspace styles: opacity only animates", () => {
	// Enter/exit motion may fade: a `@keyframes` step, or an `@starting-style` entry state.
	assertNone(
		offences(/\bopacity\s*:/, (sheet, index) => {
			const animating = within(blocks(sheet.css, /@keyframes\s[^{]*\{/g), index) ||
				within(blocks(sheet.css, /@starting-style\s*\{/g), index);
			return !animating &&
				!/^opacity\s*:\s*var\(--wsp-minor-fade\)$/.test(declarationAt(sheet.css, index));
		}),
		"opacity used as a state — dim the ink with --text-secondary / --fld-disabled-mix:",
	);
});

Deno.test("workspace styles: every reduced-motion rule has both channels", () => {
	const missing: string[] = [];
	for (const sheet of SHEETS) {
		const flat = sheet.css.replace(/\s+/g, " ");
		// Any prelude that asks for reduced motion — `screen and (…)`, the boolean form — not one spelling.
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

Deno.test("workspace styles: an opt-in animation stops under the in-app reduced-motion switch", () => {
	// A `no-preference` block runs its animation for everyone whose OS has not asked for reduced
	// motion — including a reader who switched motion off in the app. Each animated selector must be
	// scoped out of `:root[data-motion="reduced"]` or reset there.
	const unguarded: string[] = [];
	for (const sheet of SHEETS) {
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
		// The roster card's figure row and its setup percentage, and the roster's live count (R1).
		".wsp-card__figure",
		".wsp-card__figure-value",
		".wsp-card__setup-text",
		".wsp-roster__count",
		".wsp-split__pip",
		".wsp-split__drift-text",
		// Text that carries a count or an amount: the lane's queue count, a role's member count, a
		// band's live queue count ("2 requests waiting"), a counterparty's "+N" and a feed line's sum.
		".wsp-lane__navcount",
		".wsp-matrix__rownote",
		".wsp-band__title",
		".wsp-projects__party",
		".wsp-activity__text",
	]
		.filter((selector) => {
			const at = all.search(new RegExp(`(^|\\n)${selector.replace(/[.-]/g, "\\$&")}\\s*\\{`));
			return at < 0 || !ruleBody(all, all.indexOf("{", at) + 1).includes("tabular-nums");
		});
	assertNone(untabular, "figure class without tabular-nums (§A.4):");
});

Deno.test("workspace styles: the body and micro money steps keep the minor run whole", () => {
	// MoneyView's contract (DESIGN_SYSTEM §C.1): only the larger steps shrink and fade the minor run.
	const rules = SHEETS.flatMap((sheet) => blockSelectors(sheet.css, -1, sheet.css.length));
	const split = [".wsp-money--body", ".wsp-money--micro"].flatMap((step) => {
		const declared = rules.filter((rule) => rule.selector === step).map((rule) => rule.body)
			.join(";");
		return [
			/(^|[;{\s])--wsp-minor-size\s*:\s*1em\s*(;|$)/.test(declared) ? [] : [`${step} shrinks it`],
			/(^|[;{\s])--wsp-minor-fade\s*:\s*1\s*(;|$)/.test(declared) ? [] : [`${step} fades it`],
		];
	}).flat();
	assertNone(split, "a small money step splits its minor run (MoneyView body/micro):");
});

Deno.test("workspace styles: the dead rules stay deleted", () => {
	assertNone(
		offences(
			/\.wsp-skel\b|\.wsp-lane__new\b|\.wsp-footerrig__action\[data-(variant|locked)|\.wsp-lane__(filter|switch|row|verify|foot|note)\b|\.wsp-rail__verify\b/,
		),
		"a deleted dead selector is back:",
	);
	// The header band and footer rig before Teams L2: the hand-rolled tab strip, the Popover menu and
	// the rig's ghost-button extras — and the L2 review's folded-label and painted-toggle overrides of
	// the shared Button, replaced by two presentations and Button's own engaged state.
	assertNone(
		offences(
			/\.wsp-headerband__(tab|identity|name|handle|badge|divider|controls|icon|panel)\b|\.wsp-footerrig__(more|menu|note|nudge|fold|toggle)\b/,
		),
		"a deleted dead selector is back:",
	);
	// The roster before Teams R1: the hand-rolled tab strip, the role chip's flag stack, the three-stat
	// grid, the face stack, the hand-drawn meter fill and kebab, and the hand-built empty state — each
	// replaced by a ui primitive (TabMenu, MetaLine, ProgressBar, Button, EmptyState) — and the acting
	// role chip, the table's quiet acting chip and the raw Try again, whose last consumers R1 removed.
	assertNone(
		offences(
			/\.wsp-roster__(tab|tab-count|pitch|tools|section)\b|\.wsp-card__(flags|dot|kebab|stats?|stat-label|stat-value|stat-delta|faces?|more|members|membercount|setup-fill|name-text)\b|\.wsp-empty\b|--wsp-card-min\b|\.wsp-chip--acting\b|\.wsp-actingchip--quiet\b|\.wsp-error__retry\b/,
		),
		"a deleted dead selector is back:",
	);
});

Deno.test("workspace styles: the bands never reach inside a shared Button", () => {
	assertNone(
		offences(/\.ui-button__(label|icon)\b|--btn-[a-z-]+\s*:/),
		"a workspace sheet restyles the inside of ui Button:",
	);
});

Deno.test("workspace styles: the stagger is a data-i ladder, not an inline style", () => {
	const problems: string[] = [];
	const step = (i: number) => new RegExp(`(^|\\n)\\[data-i="${i}"\\]\\s*\\{`);
	const catchAll = /(^|\n)\[data-i\]\s*\{/g;

	/** The value the rule opening at or after `index` gives `--wsp-i`, or `null`. */
	const rungAt = (text: string, index: number): string | null => {
		const open = text.indexOf("{", index);
		const set = /--wsp-i\s*:\s*([^;}]*)/.exec(text.slice(open + 1, text.indexOf("}", open)));
		return set ? set[1].trim() : null;
	};

	// The whole ladder lives in one sheet, so "before" and "after" are its own source order.
	const home = SHEETS.find((sheet) => step(0).test(sheet.css));
	if (!home) problems.push('[data-i="0"] is missing');
	else {
		// Every step 0-11 exists and sets its own index.
		const steps = Array.from({ length: 12 }, (_, i) => {
			const at = home.css.search(step(i));
			if (at < 0) problems.push(`[data-i="${i}"] is missing from ${home.name}`);
			else if (rungAt(home.css, at) !== String(i)) {
				problems.push(`[data-i="${i}"] sets --wsp-i: ${rungAt(home.css, at)} (expected ${i})`);
			}
			return at;
		});
		const firstStep = Math.min(...steps.filter((at) => at >= 0));

		// The bare catch-all sets the last delay and comes BEFORE every step: an equal-specificity rule
		// after them would override each exact match and give every band the last delay.
		let catchAlls = 0;
		for (const sheet of SHEETS) {
			for (const match of sheet.css.matchAll(catchAll)) {
				catchAlls++;
				const where = `${sheet.name}:${lineOf(sheet.css, match.index! + 1)}`;
				if (sheet !== home) problems.push(`${where}  [data-i] outside the ladder's sheet`);
				else if (match.index! > firstStep) {
					problems.push(`${where}  [data-i] comes after the steps it would override`);
				}
				if (rungAt(sheet.css, match.index!) !== "11") {
					problems.push(`${where}  [data-i] sets --wsp-i: ${rungAt(sheet.css, match.index!)}`);
				}
			}
		}
		if (catchAlls === 0) problems.push("[data-i] (the past-11 default) is missing");
	}

	// Nothing else in the sheets sets the index.
	for (const sheet of SHEETS) {
		for (const match of sheet.css.matchAll(/--wsp-i\s*:/g)) {
			const selector = ruleSelector(sheet.css, match.index!);
			if (!/^\[data-i(="\d+")?\]$/.test(selector)) {
				problems.push(`${sheet.name}:${lineOf(sheet.css, match.index!)}  ${selector} sets --wsp-i`);
			}
		}
	}
	assertNone(problems, "the data-i ladder is broken:");

	const inline = readFeatureTsx()
		.filter((file) => /['"`]--wsp-i['"`]|--wsp-i\s*:/.test(file.src))
		.map((file) => file.name);
	assertNone(inline, "a component writes --wsp-i inline — set data-i instead:");
});
// #endregion
