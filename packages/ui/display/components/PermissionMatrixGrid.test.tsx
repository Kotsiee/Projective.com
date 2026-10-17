import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.7.0";
import { PermissionMatrixGrid, type PermissionMatrixProps } from "./PermissionMatrixGrid.tsx";
import type { PermissionCellState } from "../core/permission-matrix-nav.ts";

const css = Deno.readTextFileSync(new URL("../styles/permission-matrix.css", import.meta.url));

const states: Record<string, PermissionCellState> = {
	"spend:owner": "allowed",
	"spend:admin": "conditional",
	"spend:member": "off",
	"invite:owner": "allowed",
	"invite:admin": "allowed",
	"invite:member": "locked",
};

const base: PermissionMatrixProps = {
	id: "pm",
	caption: "Role permissions",
	rowHeaderLabel: "Capability",
	rows: [
		{
			key: "spend",
			label: "Approve spend",
			group: "Money",
			hint: "Up to the envelope",
			sensitive: true,
		},
		{ key: "invite", label: "Invite members", group: "People" },
	],
	columns: [
		{ key: "owner", label: "Owner", locked: true },
		{ key: "admin", label: "Admin", meta: "3 members" },
		{ key: "member", label: "Member" },
	],
	value: (row, col) => states[`${row.key}:${col.key}`],
	glyphs: { allowed: <i>check</i>, conditional: <i>half</i>, locked: <i>lock</i> },
};

/** Every opening tag with the given attribute fragment. */
function tags(html: string, fragment: string): string[] {
	return [...html.matchAll(/<[a-z]+\b[^>]*>/g)].map((m) => m[0]).filter((t) =>
		t.includes(fragment)
	);
}

Deno.test("grid semantics: caption, column and row headers, group headers", () => {
	const html = renderToString(<PermissionMatrixGrid {...base} onToggle={() => {}} />);
	assertMatch(html, /<table[^>]*role="grid"/);
	assertMatch(html, /<caption[^>]*>Role permissions<\/caption>/);
	assertEquals(tags(html, 'scope="col"').length, 4); // corner + three roles
	assertEquals(tags(html, 'scope="row"').length, 2);
	assertEquals(tags(html, 'scope="rowgroup"').length, 2);
	assertFalse(html.includes("aria-readonly"));
});

Deno.test("every cell is a named toggle button with exactly one tab stop", () => {
	const html = renderToString(<PermissionMatrixGrid {...base} onToggle={() => {}} />);
	const cells = tags(html, "data-pm-row");
	assertEquals(cells.length, 6);
	assert(cells.every((t) => t.startsWith("<button")));
	assertEquals(cells.filter((t) => t.includes('tabindex="0"')).length, 1);
	assertEquals(cells.filter((t) => t.includes('tabindex="-1"')).length, 5);
	assert(cells[0].includes('tabindex="0"'), "the first cell holds the stop");
	assert(cells.some((t) => t.includes('aria-label="Approve spend for Admin: Conditional"')));
	assert(cells.some((t) => t.includes('aria-label="Approve spend for Member: Not allowed"')));
	assert(cells.some((t) => t.includes('aria-label="Invite members for Member: Locked"')));
});

Deno.test("pressed and disabled states follow the cell and its column", () => {
	const html = renderToString(<PermissionMatrixGrid {...base} onToggle={() => {}} />);
	const cell = (label: string) => tags(html, `aria-label="${label}`)[0];

	const admin = cell("Approve spend for Admin");
	assert(admin.includes('aria-pressed="mixed"'));
	assertFalse(admin.includes("aria-disabled"));

	const member = cell("Approve spend for Member");
	assert(member.includes('aria-pressed="false"'));

	// A locked state: no pressed state at all, disabled, described by the lock reason.
	const locked = cell("Invite members for Member");
	assertFalse(locked.includes("aria-pressed"));
	assert(locked.includes('aria-disabled="true"'));
	assert(locked.includes('aria-describedby="pm-locked"'));
	assertMatch(html, /<span id="pm-locked" hidden(="")?>[^<]+<\/span>/);

	// A locked column keeps its readable state but never toggles.
	const owner = cell("Approve spend for Owner");
	assert(owner.includes('aria-pressed="true"'));
	assert(owner.includes('aria-disabled="true"'));
	assert(owner.includes('aria-describedby="pm-locked pm-hint-0"'));
});

Deno.test("glyphs are decorative and off draws none", () => {
	const html = renderToString(<PermissionMatrixGrid {...base} onToggle={() => {}} />);
	const glyphs = tags(html, 'class="ui-permission-matrix__glyph"');
	assertEquals(glyphs.length, 5); // six cells, one off
	assert(glyphs.every((t) => t.includes('aria-hidden="true"')));
});

Deno.test("read-only: no buttons, focusable named gridcells, aria-readonly", () => {
	const html = renderToString(<PermissionMatrixGrid {...base} />);
	assertFalse(html.includes("<button"));
	assertMatch(html, /<table[^>]*aria-readonly="true"/);
	const cells = tags(html, "data-pm-row");
	assertEquals(cells.length, 6);
	assert(cells.every((t) => t.startsWith("<td")));
	assertEquals(cells.filter((t) => t.includes('tabindex="0"')).length, 1);
	assert(cells.some((t) => t.includes('aria-label="Approve spend for Owner: Allowed"')));
});

Deno.test("the caption can be visually hidden but never dropped", () => {
	const html = renderToString(<PermissionMatrixGrid {...base} captionHidden />);
	assertMatch(html, /<caption class="[^"]*ui-visually-hidden[^"]*">Role permissions<\/caption>/);
});

Deno.test("stylesheet: opaque fills, token durations, press removed under both motion channels", () => {
	assertFalse(/color-mix\([^)]*transparent/.test(css), "no translucent mixes");
	assertFalse(/\d+m?s\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")), "no literal durations");
	assertFalse(/#[0-9a-f]{3,8}\b/i.test(css), "no literal colours");
	assertFalse(/linear-gradient|repeating-/.test(css), "no hatch gradients");
	assert(css.includes("transform: scale(var(--btn-press-scale-icon))"));
	assert(css.includes("@media (prefers-reduced-motion: reduce)"));
	assert(css.includes(':root[data-motion="reduced"] button.ui-permission-matrix__cell:active'));
	assert(css.includes("box-shadow: var(--focus-ring-shadow)"));
	assert(css.includes("--pm-allowed: var(--primary-tint)"));
	assert(css.includes("--pm-conditional: var(--warning-tint)"));
	assert(css.includes("--pm-locked: var(--surface-2)"));
});
