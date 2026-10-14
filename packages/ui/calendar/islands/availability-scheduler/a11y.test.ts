import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";

const PARTS = [
	"Root.tsx",
	"PresetBar.tsx",
	"Toolbar.tsx",
	"WeekCanvas.tsx",
	"MonthPreview.tsx",
	"RuleList.tsx",
	"RuleEditor.tsx",
	"Issues.tsx",
	"ShortcutSheet.tsx",
];
const INTERACTIVE = [
	"button",
	"summary",
	"Button",
	"SelectButton",
	"InputMask",
	"InputText",
	"Select",
	"Dialog",
	"Popover",
];
const NAME_ATTR = /\s(aria-label|aria-labelledby|label|header)=/;

const read = (file: string) => Deno.readTextFileSync(new URL(`./${file}`, import.meta.url));
const css = Deno.readTextFileSync(
	new URL("../../styles/availability-scheduler.css", import.meta.url),
);

// #region JSX scan
interface Element {
	file: string;
	tag: string;
	attrs: string;
	inner: string;
}

function openingTagEnd(src: string, from: number): number {
	let depth = 0;
	let quote: string | null = null;
	for (let i = from; i < src.length; i++) {
		const c = src[i];
		if (quote) {
			if (c === quote) quote = null;
			continue;
		}
		if (c === '"' || c === "'" || c === "`") quote = c;
		else if (c === "{") depth++;
		else if (c === "}") depth--;
		else if (c === ">" && depth === 0) return i;
	}
	return -1;
}

function elements(file: string): Element[] {
	const src = read(file);
	const out: Element[] = [];
	const re = new RegExp(`<(${INTERACTIVE.join("|")})[\\s>]`, "g");
	for (const match of src.matchAll(re)) {
		const tag = match[1];
		const end = openingTagEnd(src, match.index + tag.length + 1);
		assert(end > 0, `${file}: unterminated <${tag}`);
		const attrs = src.slice(match.index, end + 1);
		const selfClosing = attrs.trimEnd().endsWith("/>");
		const close = selfClosing ? end : src.indexOf(`</${tag}>`, end);
		out.push({ file, tag, attrs, inner: selfClosing ? "" : src.slice(end + 1, close) });
	}
	for (const match of src.matchAll(/role="(grid)"/g)) {
		const line = src.slice(src.lastIndexOf("\n", match.index) + 1, match.index).trim();
		if (line.startsWith("*") || line.startsWith("//")) continue;
		const start = src.lastIndexOf("<", match.index);
		const end = openingTagEnd(src, start + 1);
		out.push({ file, tag: `role=${match[1]}`, attrs: src.slice(start, end + 1), inner: "" });
	}
	return out;
}

function visibleText(inner: string): string {
	return inner
		.replace(/<(\w+)[^>]*aria-hidden="true"[^>]*\/>/g, "")
		.replace(/<(\w+)[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, "")
		.replace(/<[^>]+>/g, "")
		.trim();
}

function named(el: Element): boolean {
	if (NAME_ATTR.test(el.attrs)) return true;
	if (el.tag === "Popover" && el.attrs.includes("trigger=")) return false;
	if (el.tag === "button" || el.tag === "summary" || el.tag.startsWith("role=")) {
		return /[A-Za-z{]/.test(visibleText(el.inner));
	}
	return false;
}

const ALL = PARTS.flatMap(elements);
// #endregion

// #region Accessible names
Deno.test("a11y: the scan finds the scheduler's interactive surface", () => {
	assert(ALL.length >= 40, `only ${ALL.length} interactive elements found — the scanner is broken`);
	for (
		const tag of ["button", "Button", "SelectButton", "InputMask", "summary", "Dialog", "role=grid"]
	) {
		assert(ALL.some((el) => el.tag === tag), `no <${tag}> found`);
	}
});

Deno.test("a11y: every interactive element has an accessible name", () => {
	const unnamed = ALL.filter((el) => !named(el)).map((el) =>
		`${el.file}: ${el.attrs.slice(0, 120)}`
	);
	assertEquals(unnamed, []);
});

Deno.test("a11y: icon-only buttons carry both a name and a glyph", () => {
	for (const el of ALL.filter((e) => e.tag === "Button" && /\biconOnly\b/.test(e.attrs))) {
		assert(el.attrs.includes("aria-label="), `${el.file}: icon-only Button without aria-label`);
		assert(
			el.attrs.includes("icon={"),
			`${el.file}: icon-only Button without icon (children are dropped)`,
		);
	}
});

Deno.test("a11y: grids describe time and day, and the canvas announces politely", () => {
	const canvas = read("WeekCanvas.tsx");
	for (
		const attr of [
			"aria-rowindex",
			"aria-colindex",
			"aria-rowcount",
			"aria-colcount",
			"aria-activedescendant",
		]
	) {
		assert(canvas.includes(attr), `WeekCanvas lacks ${attr}`);
	}
	const root = read("Root.tsx");
	assertMatch(root, /aria-live="polite"/);
	assertMatch(root, /role="status"/);
});
// #endregion

// #region CSS gates
function rule(selector: string): string {
	const at = css.indexOf(`${selector} {`);
	assert(at >= 0, `missing rule ${selector}`);
	return css.slice(at, css.indexOf("}", at));
}

Deno.test("css: token-only, uncommented, no hardcoded colours or durations", () => {
	assertFalse(/#[0-9a-fA-F]{3,8}\b/.test(css), "hex colour");
	assertFalse(/\b\d+(\.\d+)?m?s\b/.test(css.replace(/var\([^)]*\)/g, "")), "literal duration");
	assertFalse(css.includes("/*"), "comment");
	assertFalse(/rgba?\(|hsla?\(/.test(css), "literal colour function");
	assertFalse(/border-radius:\s*\d/.test(css), "literal radius");
});

Deno.test("css: bands follow the plan's tokens and the ghost derives from an existing alpha", () => {
	const working = rule(".ui-avsched__band--working");
	assert(working.includes("background: var(--surface-3)"));
	assert(working.includes("border: 1px solid var(--outline)"));
	assert(
		rule(".ui-avsched").includes(
			"--avsched-call-fill: color-mix(in oklch, var(--accent) var(--tint-soft), var(--surface-1))",
		),
	);
	assert(rule(".ui-avsched").includes("--avsched-ghost-opacity: var(--fld-loading-alpha)"));
	assert(rule(".ui-avsched__band--call").includes("45deg"));
	assert(rule(".ui-avsched__date--blackout").includes("-45deg"));
	assert(rule(".ui-avsched__band").includes("border-radius: var(--radius-sm)"));
	assert(rule(".ui-avsched__band").includes("var(--spring-snappy)"));
	assert(rule(".ui-avsched__band--dragging").includes("opacity: var(--avsched-ghost-opacity)"));
});

Deno.test("css: motion and press feedback are removed under both reduced-motion channels", () => {
	assert(css.includes("@media (prefers-reduced-motion: reduce)"));
	assert(css.includes(':root[data-motion="reduced"] .ui-avsched__band:active'));
	const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
	assert(reduced.includes("transition: none"));
	assert(reduced.includes("transform: none"));
	for (
		const pressable of [
			".ui-avsched__band:active",
			".ui-avsched__date:active",
			".ui-avsched__rule-main:active",
		]
	) {
		assert(rule(pressable).includes("transform: scale(var(--btn-press-scale))"));
	}
});

Deno.test("css: the container query targets a child of the container, never the container", () => {
	assert(rule(".ui-avsched-scope").includes("container-type: inline-size"));
	assertFalse(/@container[^{]*\{\s*\.ui-avsched-scope\b/.test(css));
});
// #endregion
