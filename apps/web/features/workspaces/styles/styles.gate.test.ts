/**
 * styles.gate.test — the workspace stylesheets' merge gates (Teams work order W1), held as a test.
 *
 * Reads every sheet in `apps/web/features/workspaces/styles/` and fails, naming `file:line`, on anything
 * the W1 sweep removed coming back. The gates every policed surface shares — a translucent `color-mix`,
 * a literal weight, a literal duration, a hex or `rgb()` colour, glass, a `px` breakpoint (save the
 * footer rig's one mirror of the frame's lane query, Decision #245 (k)), an `outline: none` with no ring
 * beside it, `px` outside a token declaration, and both reduced-motion channels (with an in-app stop
 * for every opt-in animation) — come from `utils/css-gate.testing.ts`. The gates below are this
 * surface's own: the frame mirror, `opacity` only inside an animation, the `data-i` stagger, the
 * deleted dead rules and the removed inset rings.
 */
import { assert, assertEquals } from "@std/assert";
import {
	assertNone,
	blocks,
	blockSelectors,
	closeBrace,
	declarationAt,
	lineOf,
	offencesIn,
	readFeatureTsx,
	readSheets,
	registerCommonGates,
	ruleBody,
	ruleSelector,
	type Sheet,
	within,
} from "@web/utils/css-gate.testing.ts";

// #region Sources
const STYLES_DIR = new URL("./", import.meta.url);
const FEATURE_DIR = new URL("../", import.meta.url);

const SHEETS = readSheets(STYLES_DIR);
const offences = offencesIn(SHEETS);
// #endregion

// #region The frame's lane mirror
/**
 * The one `px` query this surface may write (Decision #245 (k)). The roster's footer rig swaps to its
 * layout without the lane exactly where the frame hides the lane, so it copies the frame's own query
 * from `middle-nav.css`: a `rem` query resolves against the browser's default font size and the
 * frame's `px` one does not, so at any default but 16px a `rem` swap would paint the rig's tier-2 New
 * beside the lane's, or neither. The block may hold only these selectors; `rig-model.test.ts` holds
 * its query to the frame's.
 */
const FRAME_MIRROR = {
	sheet: "workspace-chrome.css",
	prelude: /@media\s*\(max-width:\s*767px\)\s*\{/g,
	selectors: [
		".wsp-headerband__menu",
		'.wsp-footerrig__layout[data-lane="shown"]',
		'.wsp-footerrig__layout[data-lane="hidden"]',
		'.wsp-footerrig:has(.wsp-footerrig__layout[data-lane="hidden"] > .wsp-footerrig__createnote)',
		'.wsp-footerrig:has(.wsp-footerrig__layout[data-lane="hidden"] > .wsp-footerrig__createnote) .wsp-footerrig__actions',
	],
} as const;

/** The selectors of the at-rule block opening at `open`, in source order. */
function selectorsOf(sheet: Sheet, open: number): string[] {
	return blockSelectors(sheet.css, open, closeBrace(sheet.css, open)).map((rule) => rule.selector);
}

/**
 * [start, end) of each frame-mirror block, from its `@media` to its closing brace — only while it
 * holds nothing but the mirror's selectors, so any other rule in it trips the `px` gates.
 */
function frameMirrorRanges(sheet: Sheet): [number, number][] {
	if (sheet.name !== FRAME_MIRROR.sheet) return [];
	const ranges: [number, number][] = [];
	for (const match of sheet.css.matchAll(FRAME_MIRROR.prelude)) {
		const open = match.index! + match[0].length - 1;
		const close = closeBrace(sheet.css, open);
		const allowed: readonly string[] = FRAME_MIRROR.selectors;
		if (close > open && selectorsOf(sheet, open).every((s) => allowed.includes(s))) {
			ranges.push([match.index!, close + 1]);
		}
	}
	return ranges;
}

/** True when `index` falls inside the frame's lane mirror. */
function inFrameMirror(sheet: Sheet, index: number): boolean {
	return frameMirrorRanges(sheet).some(([start, end]) => index >= start && index < end);
}
// #endregion

// #region The W1 acceptance gates
Deno.test("workspace styles: the sheets were found", () => {
	assert(SHEETS.length >= 9, `expected the nine workspace sheets, read ${SHEETS.length}`);
});

registerCommonGates({
	label: "workspace styles",
	sheets: SHEETS,
	pxException: (sheet, index) => inFrameMirror(sheet, index),
	pxBreakpointFix: "spell the ui breakpoint in rem (workspace-tokens.css)",
	pxLiteralFix: "read a token (--space-*, --wsp-* geometry)",
});

Deno.test("workspace styles: the one px query is the frame's lane mirror, holding only the rig's swap (#245 (k))", () => {
	const found: string[] = [];
	for (const sheet of SHEETS) {
		for (const match of sheet.css.matchAll(/@media[^{]*\d+px[^{]*\{/g)) {
			const where = `${sheet.name}:${lineOf(sheet.css, match.index!)}`;
			found.push(where);
			assertEquals(sheet.name, FRAME_MIRROR.sheet, `${where} is not the mirror's sheet`);
			assert(new RegExp(FRAME_MIRROR.prelude.source).test(match[0]), `${where}: ${match[0]}`);
			assertEquals(
				selectorsOf(sheet, match.index! + match[0].length - 1),
				[...FRAME_MIRROR.selectors],
				`${where} holds more than the rig's swap`,
			);
		}
	}
	assertEquals(found.length, 1, `one frame mirror, found: ${found.join(", ")}`);
});

// #endregion

// #region The rest of the sweep
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
		// The roster card's figure row and its setup percentage (R1). The roster's visible count line is
		// gone: its toolbar carries no count (Decision #307).
		".wsp-card__figure",
		".wsp-card__figure-value",
		".wsp-card__setup-text",
		// The payout preview's rate and figure columns, and the payout notices' percentages.
		".wsp-ledger__rate",
		".wsp-ledger__amount",
		".wsp-payout__notice.ui-inline-notice",
		// Text that carries a count or an amount: the lane's queue count, a band's live queue count
		// ("2 requests waiting") and a feed line's sum. (A projects-preview row's facts and the roles
		// page head are MetaLines, and a role's member count is the PermissionMatrix's column meta —
		// each sets its own `tabular-nums`.)
		".wsp-lane__navcount",
		".wsp-band__title",
		".wsp-activity__text",
		// A metric tile's caption: "of 50 this week", "1 invitation out".
		".wsp-tiles .ui-stat__caption",
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
			/\.wsp-skel\b|\.wsp-lane__new\b|\.wsp-footerrig__action\[data-(variant|locked)|\.wsp-lane__(filter|switch|row|verify|foot|note)\b|\.wsp-rail__verify\b|\.wsp-verdict\b/,
		),
		"a deleted dead selector is back:",
	);
	// The team split bar before Teams C4 — the feature's own bar, legend, drift box and quick-split
	// chips, replaced by the ui SplitBar, a MetaLine legend and an InlineNotice — and the spend verdict
	// box (TEAMS_AUDIT D12).
	assertNone(
		offences(
			/\.wsp-split\b|\.wsp-split__|\.wsp-verdict\b|\[data-stake\b|--wsp-stake\b|--wsp-held-hatch\b/,
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
	// The roles matrix before Teams C3: the hand-rolled grid, its cells, column buttons, legend marks
	// and hatch gradients, the inline composer, its error line and the native select's class, and
	// every token only they read — replaced by the ui PermissionMatrix, the RoleEditor dialog, an
	// InlineNotice and ui fields.
	assertNone(
		offences(
			/\.wsp-matrix\b|\.wsp-matrix__|\.wsp-roleeditor\b|\.wsp-roleeditor__|\.wsp-select\b|\.wsp-capchip\b|\.wsp-create__error\b|--wsp-(allowed|conditional|denied|locked|hatch|matrix|grant|revoke|consequential)\b|--wsp-(allowed|conditional|denied|locked|hatch|matrix)-|repeating-linear-gradient/,
		),
		"a deleted dead selector is back:",
	);
	// The Roles matrix of Teams C3, rebuilt as a master-detail by Decision #320: the matrix frame and its
	// tightened band inset, the glyph legend and the list of remits under it.
	assertNone(
		offences(
			/\.wsp-roles__(matrix|legend|legend-item|legend-glyph|remits|remit|remit-list|remit-name|remit-summary)\b/,
		),
		"a deleted dead selector is back:",
	);
	// The Roles master-detail's clutter, removed by Decision #321: the roster's remit line, its run
	// counts and selected-row rule, the canvas's notice stack, header actions and their refusal line,
	// and the inline capability and domain descriptions (now behind a "?").
	assertNone(
		offences(
			/\.wsp-roles__(row-summary|section-count|notices|actions|action-note|cap-desc|domain-desc)\b|\.wsp-roles__row[^{,]*::before/,
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
	// The create dialog's kind options and its borrowed label (BU1, #245): their last consumers went
	// in Teams R3 (the dialog's own radio) and C2 (the invite dialog's chooser, now a SelectButton);
	// no form borrows `__label` since billing and payouts moved onto FormControl.
	assertNone(offences(/\.wsp-create__(kind|label)\b/), "a deleted dead selector is back:");
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

	const inline = readFeatureTsx(FEATURE_DIR)
		.filter((file) => /['"`]--wsp-i['"`]|--wsp-i\s*:/.test(file.src))
		.map((file) => file.name);
	assertNone(inline, "a component writes --wsp-i inline — set data-i instead:");
});
// #endregion
