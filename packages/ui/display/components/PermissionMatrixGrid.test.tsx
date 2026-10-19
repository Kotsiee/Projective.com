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

Deno.test("a locked column gives its own reason; a fixed cell keeps its state and gives its own", () => {
	const html = renderToString(
		<PermissionMatrixGrid
			{...base}
			columns={[
				{ key: "owner", label: "Owner", locked: true, lockedHint: "Presets are read-only." },
				{ key: "admin", label: "Admin" },
				{ key: "member", label: "Member" },
			]}
			cellLock={(row, col) =>
				row.key === "spend" && col.key === "member" ? "You can't grant what you don't hold." : null}
			onToggle={() => {}}
		/>,
	);
	const cell = (label: string) => tags(html, `aria-label="${label}`)[0];

	const owner = cell("Approve spend for Owner");
	assert(owner.includes('aria-describedby="pm-locked-1 pm-hint-0"'));
	assertMatch(html, /<span id="pm-locked-1" hidden(="")?>Presets are read-only\.<\/span>/);

	// The fixed cell still says it is off — only its toggle is withheld.
	const member = cell("Approve spend for Member: Not allowed");
	assert(member.includes('aria-pressed="false"'));
	assert(member.includes('aria-disabled="true"'));
	assert(member.includes("ui-permission-matrix__cell--fixed"));
	assert(member.includes('aria-describedby="pm-locked-2 pm-hint-0"'));
	assertMatch(
		html,
		/<span id="pm-locked-2" hidden(="")?>You can't grant what you don't hold\.<\/span>/,
	);

	// The matrix-wide hint still describes a locked STATE, and stays rendered under its base id.
	assert(cell("Invite members for Member").includes('aria-describedby="pm-locked"'));
	assertMatch(html, /<span id="pm-locked" hidden(="")?>[^<]+<\/span>/);

	// An unfixed cell is untouched.
	const admin = cell("Approve spend for Admin");
	assertFalse(admin.includes("aria-disabled"));
	assertFalse(admin.includes('aria-describedby="pm-locked'));
});

Deno.test("a read-only matrix ignores cellLock", () => {
	const html = renderToString(
		<PermissionMatrixGrid {...base} cellLock={() => "Never shown."} />,
	);
	assertFalse(html.includes("Never shown."));
});

Deno.test("column actions render in the header beside the label, outside the grid's cells", () => {
	const html = renderToString(
		<PermissionMatrixGrid
			{...base}
			onToggle={() => {}}
			columnActions={(col) => col.key === "admin" ? <button type="button">More</button> : null}
		/>,
	);
	// Every column's label sits on the control's line, seated or not, so the header row stays level.
	assertEquals(tags(html, 'class="ui-permission-matrix__colhead-row"').length, 3);
	assertEquals(tags(html, 'class="ui-permission-matrix__colhead-actions"').length, 1);
	assertMatch(
		html,
		/<span class="ui-permission-matrix__colhead-actions"><button type="button">More<\/button><\/span>/,
	);
	// A header control is never a roving-focus cell.
	assertEquals(tags(html, "data-pm-row").length, 6);
});

Deno.test("no column seats a control: labels keep their own line", () => {
	for (const columnActions of [undefined, () => null]) {
		const html = renderToString(
			<PermissionMatrixGrid {...base} onToggle={() => {}} columnActions={columnActions} />,
		);
		assertEquals(tags(html, "ui-permission-matrix__colhead-row").length, 0);
		assertEquals(tags(html, 'class="ui-permission-matrix__colhead-label"').length, 3);
	}
});

Deno.test("column meta: one line from a string, one line per entry from a list", () => {
	const html = renderToString(
		<PermissionMatrixGrid
			{...base}
			columns={[
				{ key: "admin", label: "Admin", meta: "3 members" },
				{ key: "designer", label: "Designer", meta: ["0 members · edited", "based on Lead"] },
			]}
			value={() => "off"}
		/>,
	);
	assertEquals(tags(html, 'class="ui-permission-matrix__meta-line"').length, 3);
	assertMatch(html, /<span class="ui-permission-matrix__meta-line">3 members<\/span><\/span>/);
	// A second line is read after a pause, not run into the first.
	assertMatch(
		html,
		/0 members · edited<\/span><span class="ui-visually-hidden">,<\/span><span class="ui-permission-matrix__meta-line">based on Lead</,
	);
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

Deno.test("stylesheet: a seated header's label line is the control's height in every column", () => {
	assert(css.includes("--pm-action-size: var(--fld-h-sm)"));
	const row = css.match(/\.ui-permission-matrix__colhead-row \{[^}]*\}/)?.[0] ?? "";
	assert(row.includes("min-block-size: var(--pm-action-size)"), row);
	assert(row.includes("align-items: center"), row);
});

Deno.test("stylesheet: the narrow step asks the matrix's own width, never the viewport", () => {
	assert(css.includes("container: ui-pm / inline-size"));
	assert(/@container ui-pm \(width < 480px\)/.test(css), "the step sits at --bp-sm");
	assertFalse(/@media[^{]*width/.test(css), "no viewport breakpoint");
});
