/**
 * roles-screen.gate — the Roles module's source-level merge gates (Teams work order C3), held as a
 * test because a type-checker cannot see them: the matrix is the ui `PermissionMatrix`, not a
 * hand-built grid; no raw `<button>`, `<select>`, `<input>` or `<label>` in the island or the editor;
 * every field a `FormControl`; every editor button's tone from the tier model (`rolesTierProps`); Save
 * and Discard are the footer rig's (`usePolicyBridge`), never the body's; no inline style; no hatch.
 *
 * The island and the editor import CSS, so they are read as text, never imported.
 */
import { assert, assertEquals } from "@std/assert";

const FEATURE = new URL("../", import.meta.url);

/** A source file with its comments stripped, so prose about a pattern never trips the gate on it. */
function read(rel: string): string {
	return Deno.readTextFileSync(new URL(rel, FEATURE))
		.replaceAll("\r\n", "\n")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|\s)\/\/.*$/gm, "$1");
}

const ISLAND = read("islands/RolesMatrix.island.tsx");
const EDITOR = read("components/RoleEditor.tsx");
const FILES: Record<string, string> = {
	"islands/RolesMatrix.island.tsx": ISLAND,
	"components/RoleEditor.tsx": EDITOR,
	"components/role-glyphs.tsx": read("components/role-glyphs.tsx"),
};

/** Every C3 file that offends `pattern`, by name. */
function offenders(pattern: RegExp): string[] {
	return Object.entries(FILES).filter(([, src]) => pattern.test(src)).map(([name]) => name);
}

Deno.test("roles: no raw button, select, input or label — ui controls only", () => {
	assertEquals(offenders(/<button\b/), [], "a raw <button> — use the ui Button");
	assertEquals(offenders(/<select\b/), [], "a native <select> — use the ui Select");
	assertEquals(offenders(/<input\b/), [], "a raw <input> — use a ui field");
	assertEquals(offenders(/<label\b/), [], "a hand-rolled label — FormControl owns the label");
	assertEquals(offenders(/\bwsp-select\b/), [], "the wsp-select class");
	assertEquals(offenders(/\bstyle=/), [], "an inline style");
	assertEquals(offenders(/styleVars\(/), [], "styleVars in feature code");
});

Deno.test("roles: the matrix is the ui PermissionMatrix — the hand-rolled grid is gone", () => {
	assert(/<PermissionMatrix\b/.test(ISLAND), "the island renders no PermissionMatrix");
	assertEquals(
		offenders(/wsp-matrix|role="grid"|role="gridcell"|data-cell=/),
		[],
		"a hand-built grid",
	);
	assertEquals(offenders(/onKeyDown/), [], "the island keys its own grid navigation");
	// Rows and columns, every lock and every cell state come from the pure model.
	for (
		const fn of [
			"roleMatrixRows",
			"roleMatrixColumns",
			"roleCellState",
			"cellLock",
			"toggleRoleCap",
			"roleSavePlan",
			"roleMenu",
		]
	) {
		assert(new RegExp(`\\b${fn}\\(`).test(ISLAND), `the island does not use ${fn}`);
	}
	assert(/columnActions=/.test(ISLAND), "a role column's menu rides the column header");
	assert(/cellLock=/.test(ISLAND), "cells the editor may not grant are not locked with a reason");
});

Deno.test("roles: Save and Discard are the footer rig's — the body has none", () => {
	assert(/usePolicyBridge\(\{ dirty, save, discard \}\)/.test(ISLAND));
	assert(
		!/saveRequested|discardRequested|policyDirty/.test(ISLAND),
		"the island reaches round the bridge",
	);
	assert(!/label="Save"|label=\{?"Save/.test(ISLAND), "the body grows a Save of its own");
	assert(!/\buseEffect\b|\buseState\b/.test(ISLAND), "signal-first: no useEffect / useState");
	assert(/useModuleCommit\(/.test(ISLAND), "New role is the header band's commit");
	assert(/rolesCommit\(/.test(ISLAND));
});

Deno.test("roles: archive is confirmed as danger; the editor's fields are FormControls", () => {
	assert(
		/<ConfirmDialog[\s\S]*?acceptSeverity="danger"/.test(ISLAND),
		"archive is not a danger confirm",
	);
	assert(
		/WorkspaceService\.archiveRole\(/.test(ISLAND),
		"archive does not call the role-archive API",
	);
	// Every field in the editor sits inside a FormControl render prop.
	const fields = EDITOR.match(/<(InputText|Select)\b/g) ?? [];
	const wrapped = EDITOR.match(/\{\(\{ id, describedBy[^}]*\}\) => \(\s*<(InputText|Select)\b/g) ??
		[];
	assertEquals(fields.length, 3, "Name, Start from and Based on");
	assertEquals(wrapped.length, fields.length, "a field outside a FormControl");
	// Every footer button takes its tone from the tier model.
	const buttons = EDITOR.match(/<Button\b[\s\S]*?\/>/g) ?? [];
	assertEquals(buttons.length, 2);
	assert(buttons.every((b) => /\{\.\.\.rolesTierProps\(/.test(b)), "a button picks its own tone");
});

Deno.test("roles: the matrix glyphs are IconShell marks, and the sheet draws no hatch", () => {
	assert(/IconShell/.test(FILES["components/role-glyphs.tsx"]));
	const sheet = Deno.readTextFileSync(new URL("styles/workspace-matrix.css", FEATURE));
	assert(!/gradient|hatch/.test(sheet.replace(/\/\*[\s\S]*?\*\//g, "")), "a hatch is back");
	assert(!/\.ui-permission-matrix/.test(sheet), "the feature sheet reaches inside the ui matrix");
});
