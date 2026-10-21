/**
 * roles-screen.gate — the Roles module's source-level merge gates (Decision #320), held as a test
 * because a type-checker cannot see them: the screen is a master-detail (a roster and a capability
 * canvas), never a matrix or a grid; the only raw `<button>` is the roster's row; no raw `<select>`,
 * `<input>` or `<label>`; every dialog field a `FormControl`; every button's tone from the tier model
 * (`rolesTierProps`); Save and Discard are the footer rig's (`usePolicyBridge`), never the body's; New
 * role lives in the roster, never the header band too; no inline style; no hatch.
 *
 * The island and the components import CSS, so they are read as text, never imported.
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

const ISLAND = read("islands/WorkspaceRoles.island.tsx");
const ROSTER = read("components/RoleRoster.tsx");
const CANVAS = read("components/RoleCanvas.tsx");
const DIALOGS = read("components/NewRoleModal.tsx");
const RIG = read("islands/RolesFooterRig.island.tsx");
const FILES: Record<string, string> = {
	"islands/WorkspaceRoles.island.tsx": ISLAND,
	"islands/RolesFooterRig.island.tsx": RIG,
	"components/RoleRoster.tsx": ROSTER,
	"components/RoleCanvas.tsx": CANVAS,
	"components/NewRoleModal.tsx": DIALOGS,
	"components/role-glyphs.tsx": read("components/role-glyphs.tsx"),
};

/** Every Roles file that offends `pattern`, by name. */
function offenders(pattern: RegExp): string[] {
	return Object.entries(FILES).filter(([, src]) => pattern.test(src)).map(([name]) => name);
}

Deno.test("roles: ui controls only — the roster row is the one native button", () => {
	assertEquals(offenders(/<select\b/), [], "a native <select> — use the ui Select");
	assertEquals(offenders(/<input\b/), [], "a raw <input> — use a ui field");
	assertEquals(offenders(/<label\b/), [], "a hand-rolled label — FormControl owns the label");
	assertEquals(offenders(/<textarea\b/), [], "a raw <textarea> — use the ui Textarea");
	assertEquals(offenders(/\bstyle=/), [], "an inline style");
	assertEquals(offenders(/styleVars\(/), [], "styleVars in feature code");
	// A roster row is two lines of rich content, which the ui Button does not hold; nothing else is raw.
	assertEquals(offenders(/<button\b/), ["components/RoleRoster.tsx"]);
	assertEquals(ROSTER.match(/<button\b/g)?.length, 1);
	assert(/<button\s+type="button"\s+class="wsp-roles__row"/.test(ROSTER));
	assert(/aria-current=\{row\.id === props\.selected \? "true" : undefined\}/.test(ROSTER));
	assert(/aria-controls=\{props\.canvasId\}/.test(ROSTER), "a row says which canvas it drives");
});

Deno.test("roles: a master-detail — the matrix and every hand-built grid are gone", () => {
	assertEquals(offenders(/PermissionMatrix|wsp-matrix|role="grid"|role="gridcell"/), []);
	assert(/<RoleRoster\b/.test(ISLAND) && /<RoleCanvas\b/.test(ISLAND));
	assert(/<ToggleSwitch\b/.test(CANVAS), "a capability is a ToggleSwitch row");
	// The roster, the canvas, every lock, the draft and the save all come from the pure model.
	for (
		const fn of [
			"rosterSections",
			"roleCanvas",
			"canvasMeta",
			"rigActions",
			"toggleRoleCap",
			"roleSavePlan",
			"initialRoleId",
			"keepSelection",
		]
	) {
		assert(new RegExp(`\\b${fn}\\(`).test(ISLAND), `the island does not use ${fn}`);
	}
	// Selection is a signal; a whole-role lock is said once, and a row's own lock beside the row.
	assert(/selectedRoleId = useSignal/.test(ISLAND));
	assert(/canvas\.lock && \(/.test(CANVAS), "the read-only reason is one notice over the canvas");
	assert(
		/disabled=\{canvas\.lock !== null \|\| row\.lock !== null \|\| props\.busy\}/.test(CANVAS),
	);
	assert(/row\.lock && \(/.test(CANVAS), "a fixed row says why beside it");
	// The narrow drill-down is data on the root, read by a container query — never a JS breakpoint.
	assert(/data-pane=\{pane\.value\}/.test(ISLAND));
	assertEquals(offenders(/matchMedia|useMediaQuery|innerWidth/), []);
});

Deno.test("roles: the footer band is the catalogue's rig — save line, auto-save, the role's actions", () => {
	// The body grows no Save, no notice line and no action row of its own (Decision #321).
	assert(!/usePolicyBridge|useModuleCommit\(/.test(ISLAND), "the body reaches for another rig");
	assertEquals(offenders(/label="Save"|label=\{?"Save"/), [], "a Save button in the body");
	assertEquals(
		offenders(/\buseEffect\b|\buseState\b/),
		[],
		"signal-first: no useEffect / useState",
	);
	assert(
		/<SaveStatus\b[\s\S]*?autoSave=\{/.test(RIG),
		"the save line carries the Auto-save switch",
	);
	assert(/rolesSaveLabel\(/.test(RIG) && /rigActions\(/.test(ISLAND));
	assert(/setTimeout\(\(\) => void save\(\), ROLES_AUTOSAVE_MS\)/.test(ISLAND), "auto-save waits");
	// The rig reads the body only through the seam; it never calls a service itself.
	assert(
		/from "\.\.\/core\/roles-rig\.ts"/.test(RIG) && /from "\.\.\/core\/roles-rig\.ts"/.test(ISLAND),
	);
	assert(!/WorkspaceService/.test(RIG), "the footer writes on its own");
	// A refused action stays focusable and says why — never `disabled` with a silent tooltip.
	assert(/aria-disabled=/.test(RIG) && !/\sdisabled=\{/.test(RIG));
	// New role is the roster's slim list affordance alone.
	assert(/newRoleAction\(/.test(ISLAND));
	assert(/\{\.\.\.rolesTierProps\(props\.create\.tier\)\}\s*size="sm"/.test(ROSTER));
	const slot = read("core/workspace-footer-slot.tsx");
	assert(
		/activeModule === "roles" && held\.has\("manage_roles"\)\) return <RolesFooterRig \/>/.test(
			slot,
		),
	);
});

Deno.test("roles: the decluttered screen — no remits, notices, counts or badges in the roster", () => {
	// The screen's own files — a dialog's refusal notice is the dialog's, and stays.
	const removed =
		/wsp-roles__(row-summary|notices|section-count|action-note|actions)\b|<Badge\b|<InlineNotice\b/;
	assertEquals(
		[ISLAND, ROSTER, CANVAS, RIG].filter((src) => removed.test(src)).length,
		0,
		"a removed element is back",
	);
	// Descriptions are on demand: a capability's, a domain's, and why a role is read-only.
	assertEquals(CANVAS.match(/<HintPopover\b/g)?.length, 3);
	assert(
		!/wsp-roles__cap-desc|wsp-roles__domain-desc/.test(CANVAS),
		"a description is drawn inline",
	);
});

Deno.test("roles: archive is confirmed as danger and calls the role-archive door", () => {
	assert(
		/<ConfirmDialog[\s\S]*?acceptSeverity="danger"/.test(ISLAND),
		"archive is not a danger confirm",
	);
	assert(
		/WorkspaceService\.archiveRole\(/.test(ISLAND),
		"archive does not call the role-archive API",
	);
	assert(
		/WorkspaceService\.upsertRole\(/.test(ISLAND) && /WorkspaceService\.upsertRole\(/.test(DIALOGS),
	);
});

Deno.test("roles: the dialogs' fields are FormControls; ONE clone field replaces Start from + Based on", () => {
	const fields = DIALOGS.match(/<(InputText|Select|Textarea)\b/g) ?? [];
	const wrapped = DIALOGS.match(
		/\{\(\{ id, describedBy[^}]*\}\) => \(\s*(<div ref=\{nameScope\}>\s*)?<(InputText|Select|Textarea)\b/g,
	) ?? [];
	// New role: Name · Description · Clone permissions from. Edit details: Name · Description · Ranks as.
	assertEquals(fields.length, 6);
	assertEquals(wrapped.length, fields.length, "a field outside a FormControl");
	assert(/label="Clone permissions from"/.test(DIALOGS));
	assert(!/label="Start from"|label="Based on"/.test(DIALOGS), "the doubled question is back");
	assertEquals(DIALOGS.match(/initialFocusRef=\{nameScope\}/g)?.length, 2, "focus opens on Name");
	// Every footer button takes its tone from the tier model.
	const buttons = DIALOGS.match(/<Button\b[\s\S]*?\/>/g) ?? [];
	assertEquals(buttons.length, 4);
	assert(buttons.every((b) => /\{\.\.\.rolesTierProps\(/.test(b)), "a button picks its own tone");
	const canvasButtons = CANVAS.match(/<Button\b[\s\S]*?\/>/g) ?? [];
	assert(canvasButtons.length > 0);
	assert(canvasButtons.every((b) => /\{\.\.\.rolesTierProps\(/.test(b)), "a canvas button's tone");
});

Deno.test("roles: the domain mark is an IconShell glyph, and the sheet draws no hatch", () => {
	assert(/IconShell/.test(FILES["components/role-glyphs.tsx"]));
	const sheet = Deno.readTextFileSync(new URL("styles/workspace-roles.css", FEATURE));
	const css = sheet.replace(/\/\*[\s\S]*?\*\//g, "");
	assert(!/gradient|hatch/.test(css), "a hatch is back");
	assert(
		!/\.ui-(switch|button|badge|notice)/.test(css),
		"the feature sheet reaches inside a ui control",
	);
	assert(
		/@container wsp-roles \(inline-size < 48rem\)/.test(css),
		"the drill-down is a container step",
	);
	assert(!/@media[^{]*(min|max)-width/.test(css), "a viewport breakpoint on a laned surface");
});
