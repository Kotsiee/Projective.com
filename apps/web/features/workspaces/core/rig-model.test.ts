import { assert, assertEquals } from "@std/assert";
import type { WorkspaceKind } from "@projective/types/workspace";
import {
	POLICY_MODULES,
	rigFilledCount,
	type RigInput,
	rigModel,
	type SaveState,
	saveStatus,
} from "./rig-model.ts";
import { MEMBERS_CHART, MEMBERS_PEOPLE, MEMBERS_QUEUE } from "./sub-views.ts";

/**
 * The workspace footer rig (Teams work order L2): every control at its Button Interaction Matrix tier,
 * Save (tier 3) and Discard (tier 5) only while the policy editor is dirty, one filled control at
 * most, navigations as links, and the Org chart toggle on the one sub-view state.
 */

// #region Fixtures
const MODULES = [
	"overview",
	"projects",
	"members",
	"roles",
	"invitations",
	"payouts",
	"spend",
	"billing",
	"settings",
	"verification",
] as const;

function inConsole(overrides: Partial<RigInput> = {}): RigInput {
	return {
		kind: "team",
		handle: "north-loop",
		module: "payouts",
		view: null,
		canCreate: true,
		canInvite: true,
		canManageMoney: true,
		canManageSettings: true,
		dirty: false,
		saveState: "idle",
		...overrides,
	};
}

const keys = (input: RigInput) => rigModel(input).actions.map((a) => a.key);
// #endregion

// #region One filled control
Deno.test("rig: never more than one filled control, in any state", () => {
	const states: SaveState[] = ["idle", "saving", "saved", "error"];
	for (const kind of ["team", "business"] as WorkspaceKind[]) {
		for (const module of MODULES) {
			for (const dirty of [true, false]) {
				for (const saveState of states) {
					for (const allowed of [true, false]) {
						const model = rigModel(inConsole({
							kind,
							module,
							dirty,
							saveState,
							canInvite: allowed,
							canManageMoney: allowed,
							canManageSettings: allowed,
						}));
						assert(rigFilledCount(model) <= 1, `${kind}/${module}`);
					}
				}
			}
		}
		assertEquals(rigFilledCount(rigModel(inConsole({ kind, handle: null, module: null }))), 0);
	}
});

Deno.test("rig: Save (tier 3) and Discard (tier 5) render only while the editor is dirty", () => {
	for (const module of POLICY_MODULES) {
		assertEquals(keys(inConsole({ module, dirty: false })), ["invite", "settings"]);
		const dirty = rigModel(inConsole({ module, dirty: true }));
		assertEquals(dirty.actions.map((a) => a.key), ["invite", "settings", "discard", "save"]);
		const save = dirty.actions.find((a) => a.key === "save");
		const discard = dirty.actions.find((a) => a.key === "discard");
		assert(save?.control === "button" && save.tier === 3);
		assert(discard?.control === "button" && discard.tier === 5);
		assertEquals(rigFilledCount(dirty), 1);
	}
});

Deno.test("rig: no Save without the money right, nor outside a policy editor", () => {
	assert(!keys(inConsole({ dirty: true, canManageMoney: false })).includes("save"));
	for (const module of ["overview", "members", "roles", "settings"]) {
		assert(!keys(inConsole({ module, dirty: true })).includes("save"), module);
	}
});

Deno.test("rig: the commit is 'Save' beside 'Discard' — the status line already says 'changes'", () => {
	const dirty = rigModel(inConsole({ dirty: true }));
	assertEquals(dirty.actions.slice(-2).map((a) => a.label), ["Discard", "Save"]);
	assertEquals(dirty.status?.text, "Unsaved changes");
});

Deno.test("rig: what the trailing side holds — the width its words need before they fold", () => {
	assertEquals(rigModel(inConsole({ handle: null, module: null })).holds, "create");
	assertEquals(
		rigModel(inConsole({ handle: null, module: null, canCreate: false })).holds,
		"create",
	);
	for (const module of MODULES) {
		const holds = POLICY_MODULES.includes(module) ? "editor" : "utilities";
		assertEquals(rigModel(inConsole({ module })).holds, holds, module);
		// Outside a policy editor a dirty flag changes nothing the rig holds.
		if (holds === "utilities") {
			assertEquals(rigModel(inConsole({ module, dirty: true })).holds, holds);
		}
	}
	for (const module of POLICY_MODULES) {
		// At rest the editor holds its status line ("Saved" after a save) beside the utilities.
		assertEquals(rigModel(inConsole({ module, saveState: "saved" })).holds, "editor", module);
		assertEquals(rigModel(inConsole({ module, dirty: true })).holds, "commit", module);
		for (const saveState of ["saving", "error"] as SaveState[]) {
			assertEquals(rigModel(inConsole({ module, dirty: true, saveState })).holds, "commit");
		}
	}
	// Without the money right no editor is open: no status line, no commit.
	assertEquals(rigModel(inConsole({ dirty: true, canManageMoney: false })).holds, "utilities");
});

Deno.test("rig: while a save is in flight Save shows progress and Discard holds", () => {
	const model = rigModel(inConsole({ dirty: true, saveState: "saving" }));
	const save = model.actions.find((a) => a.key === "save");
	const discard = model.actions.find((a) => a.key === "discard");
	assert(save?.key === "save" && save.busy);
	assert(discard?.key === "discard" && discard.disabled);
});
// #endregion

// #region Save status
Deno.test("rig: the save status says what the buttons are for, then that it landed", () => {
	assertEquals(saveStatus(true, "idle"), { text: "Unsaved changes", tone: "unsaved" });
	assertEquals(saveStatus(true, "saving"), { text: "Saving…", tone: "saving" });
	assertEquals(saveStatus(true, "error"), { text: "Could not save", tone: "error" });
	assertEquals(saveStatus(false, "saved"), { text: "Saved", tone: "saved" });
	assertEquals(saveStatus(false, "idle"), null);
	assertEquals(saveStatus(false, "error"), null);
	assertEquals(rigModel(inConsole({ module: "members", dirty: true })).status, null);
	assertEquals(rigModel(inConsole({ canManageMoney: false, dirty: true })).status, null);
});

Deno.test("rig: the status line stays mounted for the whole life of a policy editor", () => {
	// A live region that exists before it speaks, and somewhere for focus to land when the Save or
	// Discard the reader pressed goes inert or leaves.
	for (const module of POLICY_MODULES) {
		for (const dirty of [true, false]) {
			assert(rigModel(inConsole({ module, dirty })).statusLine, `${module}/${dirty}`);
		}
	}
	assert(!rigModel(inConsole({ canManageMoney: false })).statusLine);
	for (const module of ["overview", "members", "settings"]) {
		assert(!rigModel(inConsole({ module })).statusLine, module);
	}
	assert(!rigModel(inConsole({ handle: null, module: null })).statusLine);
});
// #endregion

// #region Utilities and links
Deno.test("rig: Invite opens in place where the modal is mounted, links to Members elsewhere", () => {
	for (const module of ["members", "invitations"]) {
		const invite = rigModel(inConsole({ module })).actions.find((a) => a.key === "invite");
		assert(invite?.control === "button" && invite.tier === 4, module);
	}
	const invite = rigModel(inConsole({ module: "payouts" })).actions.find((a) => a.key === "invite");
	assert(invite?.control === "link");
	assertEquals(invite.href, "/teams/north-loop/members?invite=1");
	assert(!keys(inConsole({ canInvite: false })).includes("invite"));
});

Deno.test("rig: Settings is a link, never offered on Settings itself", () => {
	const settings = rigModel(inConsole({ kind: "business", module: "spend" })).actions
		.find((a) => a.key === "settings");
	assert(settings?.control === "link");
	assertEquals(settings.href, "/businesses/north-loop/settings");
	assert(!keys(inConsole({ module: "settings" })).includes("settings"));
	assert(!keys(inConsole({ canManageSettings: false })).includes("settings"));
});

Deno.test("rig: the roster index holds the zoom and New (tier 4) — or nothing to create", () => {
	const roster = rigModel(inConsole({ handle: null, module: null }));
	assertEquals(roster.zoom, { label: "Teams view zoom" });
	assertEquals(roster.actions, [{ key: "create", control: "button", tier: 4, label: "New team" }]);
	assertEquals(rigModel(inConsole({ handle: null, module: null, canCreate: false })).actions, []);
});
// #endregion

// #region View switching
Deno.test("rig: the zoom and the Org chart toggle ride the Members people readings only", () => {
	const people = rigModel(inConsole({ module: "members", view: MEMBERS_PEOPLE }));
	assertEquals(people.zoom, { label: "People view zoom" });
	assertEquals(people.chart, { label: "Org chart", pressed: false, next: MEMBERS_CHART });
	// The chart ignores the table⇄cards axis, so it carries no zoom — only the toggle back to People.
	const chart = rigModel(inConsole({ module: "members", view: MEMBERS_CHART }));
	assertEquals(chart.zoom, null);
	assertEquals(chart.chart, { label: "Org chart", pressed: true, next: MEMBERS_PEOPLE });
	// The invitation queue has no density and no chart; nor does any other module.
	const queue = rigModel(inConsole({ module: "members", view: MEMBERS_QUEUE }));
	assertEquals([queue.zoom, queue.chart], [null, null]);
	for (const module of ["overview", "payouts", "invitations"]) {
		const model = rigModel(inConsole({ module }));
		assertEquals([model.zoom, model.chart], [null, null], module);
	}
});
// #endregion

// #region Rendered rig — source scan
/*
 * The island cannot be rendered under `deno test` (every `@projective/ui` component imports CSS), so
 * these read its source and the policy editors' — the rig's controls are ui controls, and every
 * editor answers its pulses through the one bridge.
 */
function source(file: string): string {
	return Deno.readTextFileSync(new URL(file, import.meta.url))
		.replaceAll("\r\n", "\n")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|\s)\/\/.*$/gm, "$1");
}

/** Every `<Button … />` element in a source, read to its own `/>` (JSX inside `{…}` skipped). */
function buttonElements(text: string): string[] {
	const out: string[] = [];
	for (let at = text.indexOf("<Button"); at >= 0; at = text.indexOf("<Button", at + 1)) {
		let depth = 0;
		for (let i = at + 1; i < text.length; i++) {
			const ch = text[i];
			if (ch === "{") depth++;
			else if (ch === "}") depth--;
			else if (depth === 0 && ch === "/" && text[i + 1] === ">") {
				out.push(text.slice(at, i + 2));
				break;
			}
		}
	}
	return out;
}

const RIG = source("../islands/WorkspaceFooterRig.island.tsx");

Deno.test("footer rig: no raw <button>, no raw or action-styled <a> — Buttons and ui Links", () => {
	assert(!/<button\b/.test(RIG), "the rig renders a raw <button>");
	assert(!/<a\b/.test(RIG), "the rig renders a raw <a>");
	assert(!/wsp-footerrig__action\b/.test(RIG), "the rig still draws the ghost action");
	assert(/<Link\b/.test(RIG), "navigations are ui Links");
	assert(!/\bRigButton\b/.test(RIG), "RigButton is back");
});

Deno.test("footer rig: Save is the only filled Button; Discard and the toggle are text, utilities outlined", () => {
	const buttons = buttonElements(RIG);
	const filled = buttons.filter((b) => !/\bvariant="(outlined|text)"/.test(b));
	assertEquals(filled.length, 1, `filled: ${filled.join(" | ")}`);
	assert(/onClick=\{props\.onSave\}/.test(filled[0]), "the one filled Button is Save");
	assert(/onSave=\{\(event\) => pressPending\(event, requestSave\)\}/.test(RIG));
	assert(buttons.some((b) => /variant="text"[\s\S]*onClick=\{props\.onDiscard\}/.test(b)));
	assert(/onDiscard=\{\(event\) => pressPending\(event, requestDiscard\)\}/.test(RIG));
	assert(buttons.some((b) => /severity="neutral"\s+variant="outlined"/.test(b)));
	const toggles = buttons.filter((b) => /aria-pressed=\{chart\.pressed\}/.test(b));
	assertEquals(toggles.length, 2, "the toggle's two presentations");
	assert(toggles.every((b) => /variant="text"/.test(b)));
});

Deno.test("footer rig: below --bp-md a control swaps to its icon-only Button, never a restyled one", () => {
	// Two presentations per utility and per toggle; the stylesheet picks one by viewport and never
	// reaches inside the shared Button (no `.ui-button__label`, no `--btn-*` override).
	const buttons = buttonElements(RIG);
	const narrow = buttons.filter((b) => /class="wsp-footerrig__narrow"/.test(b));
	const wide = buttons.filter((b) => /class="wsp-footerrig__wide"/.test(b));
	assertEquals([narrow.length, wide.length], [2, 2]);
	assert(narrow.every((b) => /\biconOnly\b/.test(b) && /aria-label=/.test(b)));
	assert(!/wsp-footerrig__(fold|toggle)\b/.test(RIG), "the folded-label hack is back");
});

Deno.test("footer rig: the folds ask the rig's own room, and the commit never shrinks", () => {
	// The trailing side names what it holds, so the sheet's container queries fold at the width its
	// words need; Discard and Save carry the class that keeps them from shrinking into a wrap.
	assert(/class="wsp-footerrig__actions" data-holds=\{rig\.holds\}/.test(RIG));
	const commits = buttonElements(RIG).filter((b) => /class="wsp-footerrig__commit"/.test(b));
	assertEquals(commits.length, 2, "Discard and Save");
	assert(commits.some((b) => /onClick=\{props\.onSave\}/.test(b)));
	assert(commits.some((b) => /onClick=\{props\.onDiscard\}/.test(b)));
	assert(!/wsp-footerrig__spacer/.test(RIG), "the trailing side fills the rig; no spacer");
	const sheet = Deno.readTextFileSync(new URL("../styles/workspace-chrome.css", import.meta.url));
	for (const holds of ["create", "utilities", "editor", "commit"]) {
		assert(
			new RegExp(
				`@container wsp-footerrig-actions[^{]*\\{\\s*\\.wsp-footerrig__actions\\[data-holds="${holds}"\\]`,
			)
				.test(sheet),
			`no fold for data-holds="${holds}"`,
		);
	}
});

Deno.test("footer rig: a Save or Discard that held focus hands it on, signal-driven", () => {
	assert(!/\buseEffect\b/.test(RIG), "the rig keys an effect on a signal's value");
	assert(
		/useSignalEffect\(\(\) => \{[\s\S]*?policyDirty\.value;[\s\S]*?saveState\.value;/.test(RIG),
	);
	assert(/landFocus\(actionsRef\.current, statusRef\.current\)/.test(RIG));
	assert(/role="status"\s+tabIndex=\{-1\}/.test(RIG), "the status line can take focus");
	assert(/\{rig\.statusLine && \(/.test(RIG), "the status line follows the model's statusLine");
});

Deno.test("policy editors answer Save and Discard through usePolicyBridge, never a useEffect", () => {
	for (
		const file of [
			"../islands/PayoutPolicyScreen.island.tsx",
			"../islands/SpendPolicyScreen.island.tsx",
			"../islands/BillingScreen.island.tsx",
		]
	) {
		const text = source(file);
		assert(/usePolicyBridge\(/.test(text), `${file} does not use the bridge`);
		assert(!/saveRequested|discardRequested|policyDirty/.test(text), `${file} reaches round it`);
	}
	const bridge = source("../hooks/usePolicyBridge.ts");
	assert(!/\buseEffect\b/.test(bridge), "the bridge keys an effect on a signal's value");
	assertEquals(bridge.match(/useSignalEffect\(/g)?.length, 3);
});
// #endregion
