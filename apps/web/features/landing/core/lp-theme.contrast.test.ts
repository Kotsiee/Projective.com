/**
 * lp-theme.contrast.test — the landing token sheet holds its contrast floors, and the published
 * §3.3 table is exactly what the sheet computes (`flows/LANDING.md` §3.3; model in `lp-contrast.ts`).
 *
 * A palette edit that drops any pairing below its floor fails here, in every mode and contrast
 * state; so does a table cell that no longer matches the stylesheet (± 0.01), and a high-contrast
 * value the OS channel and the in-app channel disagree on. Regenerate the table with
 * `deno run --allow-read apps/web/features/landing/core/lp-contrast.ts`.
 */
import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
	cell,
	contrastChannels,
	contrastTable,
	markdownTable,
	rowPasses,
	STATES,
} from "./lp-contrast.ts";

// #region Fixtures
const ROOT = new URL("../../../../../", import.meta.url);
const SHEET = Deno.readTextFileSync(
	new URL("apps/web/features/landing/styles/lp-theme.css", ROOT),
);
const SPEC = Deno.readTextFileSync(new URL("documentation/flows/LANDING.md", ROOT));
const ROWS = contrastTable(SHEET);

/** The §3.3 table as published: label → its cells, in column order. */
function publishedTable(markdown: string): Map<string, string[]> {
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
	const start = lines.findIndex((l) => /^\|\s*pairing \(worst ground\)\s*\|/.test(l));
	assert(start >= 0, "LANDING.md §3.3 has its contrast table");
	const out = new Map<string, string[]>();
	for (const line of lines.slice(start + 2)) {
		if (!line.startsWith("|")) break;
		const cells = line.slice(1, line.lastIndexOf("|")).split("|").map((c) => c.trim());
		out.set(cells[0], cells.slice(1));
	}
	return out;
}

/** The figures in a printed cell (`9.92 · 7.06`, `≥ 4.85`, `2.61 → 1.88`, `—`). */
function figures(text: string): number[] {
	return [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}
// #endregion

// #region Floors
Deno.test("contrast: every pairing clears its floor in all four mode/contrast states", () => {
	const failures: string[] = [];
	for (const row of ROWS) {
		for (const state of STATES) {
			if (!rowPasses(row, state)) failures.push(`${row.label} — ${state}: ${cell(row, state)}`);
		}
	}
	assertEquals(failures, [], "a token edit dropped a pairing below its floor (§3.3)");
});

Deno.test("contrast: the header bar is covered at the top of the page and once scrolled", () => {
	const labels = ROWS.map((r) => r.label);
	assert(labels.some((l) => l.includes("transparent header bar")), "the transparent-at-top state");
	assert(labels.some((l) => l.includes("glass bar")), "the glass state");
	assert(labels.some((l) => l.includes("(outlined and ghost hover)")), "the tier 4 and 5 hovers");
	assert(labels.some((l) => l.startsWith("on-mono on mono")), "Get started and Open app (tier 2)");
});

Deno.test("contrast: the hero search's contour and its tier-3 submit are audited", () => {
	const labels = ROWS.map((r) => r.label);
	assert(labels.some((l) => l.startsWith("field-edge vs canvas")), "the field's 1px edge");
	assert(labels.some((l) => l.startsWith("on-brand on brand")), "the Search label");
	assert(labels.some((l) => l.startsWith("brand fill vs canvas")), "the Search fill's boundary");
	assert(labels.some((l) => l.startsWith("on-amber on amber")), "tier 1, kept for the demos");
});

Deno.test("contrast: the OS and in-app high-contrast channels declare the same values", () => {
	const { os, app } = contrastChannels(SHEET);
	assertEquals(os.light, app.light, "light high contrast");
	assertEquals(os.dark, app.dark, "dark high contrast");
	assert(Object.keys(app.light).length > 20 && Object.keys(app.dark).length > 20);
});
// #endregion

// #region Published table
Deno.test("contrast: LANDING.md §3.3 publishes exactly what the stylesheet computes", () => {
	const published = publishedTable(SPEC);
	assertEquals(
		[...published.keys()],
		ROWS.map((r) => r.label),
		"the table's rows (regenerate with `deno run --allow-read …/lp-contrast.ts`)",
	);
	for (const row of ROWS) {
		const cells = published.get(row.label)!;
		STATES.forEach((state, i) => {
			const want = figures(cell(row, state));
			const got = figures(cells[i]);
			assertEquals(got.length, want.length, `${row.label} — ${state}`);
			got.forEach((v, k) => assertAlmostEquals(v, want[k], 0.01, `${row.label} — ${state}`));
		});
		const pass = STATES.every((s) => rowPasses(row, s)) ? row.passText : "**FAIL**";
		assertEquals(cells[STATES.length + 1], pass, `${row.label} — verdict`);
	}
});

Deno.test("contrast: the printed table has one line per row under its header", () => {
	const lines = markdownTable(ROWS).split("\n");
	assertEquals(lines.length, ROWS.length + 2);
	assert(lines[0].startsWith("| pairing (worst ground) | dark | light | dark HC | light HC |"));
});
// #endregion
