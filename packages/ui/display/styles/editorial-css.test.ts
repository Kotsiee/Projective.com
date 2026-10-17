/**
 * The editorial stylesheets' merge gates, checked on the source (root CLAUDE.md §3, DESIGN_SYSTEM.md
 * Part E): token-only values, no glass, the frame's breakpoints mirrored from the tokens, the press
 * feedback removed by both reduced-motion channels, progress encoded in a transform, and a print
 * layer that removes the chrome. A rule here breaking is invisible on the page until someone looks
 * in the one mode that exposes it.
 */
import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";

const SHEETS = [
	"document-layout.css",
	"prose.css",
	"toc.css",
	"reading-progress.css",
	"editorial-print.css",
] as const;

/** A sheet's text with comments removed (comments may name the literals the rules forbid). */
function css(name: string): string {
	return Deno.readTextFileSync(new URL(name, import.meta.url)).replace(/\/\*[\s\S]*?\*\//g, "");
}

Deno.test("the aggregate imports every editorial sheet, in cascade order", () => {
	const aggregate = css("editorial.css");
	const imports = [...aggregate.matchAll(/@import "\.\/([^"]+)";/g)].map((m) => m[1]);
	assertEquals(imports, [...SHEETS]);
});

Deno.test("token-only: no colour, duration, radius or shadow literals", () => {
	for (const sheet of SHEETS) {
		const text = css(sheet);
		assertFalse(/#[0-9a-f]{3,8}\b/i.test(text), `${sheet}: hex colour`);
		assertFalse(/\b(rgb|rgba|hsl|hsla|oklch)\(/i.test(text), `${sheet}: colour function literal`);
		assertFalse(
			/\b\d+(\.\d+)?m?s\b(?![a-z-])/.test(text.replace(/var\([^)]*\)/g, "")),
			`${sheet}: duration literal`,
		);
		assertFalse(/border-radius:\s*[\d.]+(px|rem|em)/.test(text), `${sheet}: radius literal`);
		assertFalse(/box-shadow:\s*(?!none)[^;]*\d/.test(text), `${sheet}: shadow literal`);
	}
});

Deno.test("no glass anywhere in the family (§B.4.3)", () => {
	for (const sheet of SHEETS) assertFalse(css(sheet).includes("backdrop-filter"), sheet);
});

Deno.test("frame steps are container queries on the breakpoint tokens' values", () => {
	const steps = new Set<string>();
	for (const sheet of SHEETS) {
		for (const m of css(sheet).matchAll(/@container ui-doc \(([^)]*)\)(?: and \(([^)]*)\))?/g)) {
			steps.add(m[1]);
			if (m[2]) steps.add(m[2]);
		}
		assertFalse(/@media \((min|max)-width/.test(css(sheet)), `${sheet}: a viewport breakpoint`);
	}
	assertEquals([...steps].sort(), [
		"max-width: 1023.98px",
		"min-width: 1024px",
		"min-width: 1280px",
		"min-width: 768px",
	]);
	assertMatch(css("document-layout.css"), /\.ui-doc \{\s*container: ui-doc \/ inline-size;/);
});

Deno.test("press feedback is transform-only and removed by both reduced-motion channels", () => {
	const toc = css("toc.css");
	assertMatch(toc, /:active[^{]*\{\s*transform: scale\(var\(--btn-press-scale\)\);/);
	assertMatch(
		toc,
		/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?transform: none !important;/,
	);
	assertMatch(toc, /:root\[data-motion="reduced"\][^{]*\{\s*transform: none !important;/);
});

Deno.test("reading progress is a scaleX on a full-width bar that reserves no space", () => {
	const bar = css("reading-progress.css");
	assertMatch(bar, /\.ui-reading-progress \{[^}]*position: sticky;[^}]*block-size: 0;/);
	assertMatch(
		bar,
		/\.ui-reading-progress__bar \{[^}]*position: absolute;[^}]*transform: scaleX\(var\(--doc-progress, 0\)\);/,
	);
	assertFalse(/transition:[^;]*(inline-size|width)/.test(bar));
	assertMatch(bar, /\[dir="rtl"\] \.ui-reading-progress__bar \{\s*transform-origin: right center;/);
});

Deno.test("the TOC's active mark moves no box: a reserved transparent bar recoloured", () => {
	const toc = css("toc.css");
	assertMatch(toc, /\.ui-toc__link \{[^}]*border-inline-start: 2px solid transparent;/);
	assertMatch(
		toc,
		/\.ui-toc__link\[aria-current="location"\] \{[^}]*border-inline-start-color: var\(--primary\);/,
	);
});

Deno.test("smooth scrolling only without a reduced-motion request in either channel", () => {
	assertMatch(
		css("document-layout.css"),
		/@media \(prefers-reduced-motion: no-preference\) \{\s*:root:not\(\[data-motion="reduced"\]\):has\(\.ui-doc\) \{\s*scroll-behavior: smooth;/,
	);
});

Deno.test("print: chrome removed structurally, the TOC and progress hidden, body at the print token", () => {
	const print = css("editorial-print.css");
	assert(print.trimStart().startsWith("@media print {"));
	assertMatch(
		print,
		/body:has\(\.ui-doc\) :not\(:has\(\.ui-doc\)\):not\(\.ui-doc\):not\(\.ui-doc \*\) \{\s*display: none !important;/,
	);
	assertMatch(
		print,
		/\.ui-doc :is\(\.ui-doc__toc, \.ui-reading-progress, \.ui-anchor-heading__glyph, button, \[data-print="hide"\]\)/,
	);
	assertMatch(print, /--doc-print-body: 11pt;/);
	assertMatch(print, /font-family: var\(--font-reading\);\s*font-size: var\(--doc-print-body\);/);
	assertMatch(print, /a\[href\^="http"\]::after \{\s*content: " \(" attr\(href\) "\)";/);
	assertMatch(print, /break-inside: avoid;/);
});
