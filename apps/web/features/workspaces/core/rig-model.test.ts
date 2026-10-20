import { assert, assertEquals } from "@std/assert";
import type { WorkspaceKind } from "@projective/types/workspace";
import {
	editorOpen,
	inviteOpensInPlace,
	POLICY_MODULES,
	PROFILE_EDITOR_MODULE,
	rigFilledCount,
	type RigInput,
	type RigLane,
	rigLayouts,
	rigModel,
	ROLES_EDITOR_MODULE,
	rosterCreateNote,
	type SaveState,
	saveStatus,
} from "./rig-model.ts";
import { MEMBERS_CHART, MEMBERS_PEOPLE, MEMBERS_QUEUE } from "./sub-views.ts";

/**
 * The workspace footer rig (Teams work order L2): every control at its Button Interaction Matrix tier,
 * Save (tier 3) and Discard (tier 5) only while the policy editor is dirty, one filled control at
 * most, navigations as links, and the Org chart toggle on the one sub-view state. The roster's New is
 * a tier-4 utility beside the lane and the tier-2 create with the lane off-canvas, with the plan's
 * reason in its place when the plan admits none (Decision #245 (k)).
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

/**
 * A console rig input. Its layout defaults to the lane off-canvas — the one layout that carries Invite
 * member and Settings, which the lane footer carries beside the lane (Decision #306).
 */
function inConsole(overrides: Partial<RigInput> = {}): RigInput {
	return {
		kind: "team",
		handle: "north-loop",
		module: "payouts",
		view: null,
		lane: "off-canvas",
		canCreate: true,
		canInvite: true,
		canManageMoney: true,
		canManageSettings: true,
		canEditProfile: true,
		dirty: false,
		saveState: "idle",
		...overrides,
	};
}

const keys = (input: RigInput) => rigModel(input).actions.map((a) => a.key);

/** The roster index's rig input. */
function onRoster(overrides: Partial<RigInput> = {}): RigInput {
	return inConsole({ handle: null, module: null, lane: undefined, ...overrides });
}

/** Every place the lane can be beside the rig. */
const LANES: readonly RigLane[] = ["expanded", "rail", "off-canvas"];
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
							canEditProfile: allowed,
							canManageRoles: allowed,
						}));
						assert(rigFilledCount(model) <= 1, `${kind}/${module}`);
					}
				}
			}
		}
		assertEquals(rigFilledCount(rigModel(onRoster({ kind }))), 0);
		// The roster in every layout, every create state: at most one fill, and never beside the lane or
		// its rail.
		for (const canCreate of [true, false]) {
			for (const firstRun of [true, false]) {
				for (const lane of [...LANES, undefined]) {
					const model = rigModel(onRoster({ kind, canCreate, firstRun, lane }));
					const fills = rigFilledCount(model);
					assert(fills <= 1, `${kind} roster lane=${lane}`);
					if (lane !== "off-canvas") assertEquals(fills, 0, `${kind} roster beside the lane`);
				}
			}
		}
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

Deno.test("rig: no Save without the money right, nor outside an editor", () => {
	assert(!keys(inConsole({ dirty: true, canManageMoney: false })).includes("save"));
	for (const module of ["overview", "members", "roles"]) {
		assert(!keys(inConsole({ module, dirty: true })).includes("save"), module);
	}
});

Deno.test("rig: Settings' name and visibility save through the same tier-3 Save (C6)", () => {
	const settings = inConsole({ module: PROFILE_EDITOR_MODULE, dirty: true });
	assertEquals(keys(settings), ["invite", "discard", "save"]);
	assertEquals(rigFilledCount(rigModel(settings)), 1);
	// The identity editor answers edit_profile — not the money right, not manage_settings.
	const team = { kind: "team" } as const;
	assert(editorOpen({ ...team, module: "settings", canManageMoney: false, canEditProfile: true }));
	assert(!editorOpen({ ...team, module: "settings", canManageMoney: true, canEditProfile: false }));
	assert(!editorOpen({ ...team, module: "payouts", canManageMoney: false, canEditProfile: true }));
	assertEquals(keys(inConsole({ module: "settings", dirty: true, canEditProfile: false })), [
		"invite",
	]);
});

Deno.test("rig: the Roles matrix saves through the same tier-3 Save, for manage_roles, on both kinds (C3)", () => {
	for (const kind of ["team", "business"] as WorkspaceKind[]) {
		const roles = inConsole({ kind, module: ROLES_EDITOR_MODULE, canManageRoles: true });
		assert(editorOpen({ ...roles }), kind);
		assert(rigModel(roles).statusLine, `${kind}: the status line is mounted`);
		assertEquals(rigModel(roles).holds, "editor");
		const dirty = rigModel({ ...roles, dirty: true });
		assertEquals(dirty.actions.slice(-2).map((a) => a.key), ["discard", "save"], kind);
		const save = dirty.actions.find((a) => a.key === "save");
		assert(save?.control === "button" && save.tier === 3);
		assertEquals(rigFilledCount(dirty), 1);
		assertEquals(dirty.holds, "commit");
		// Without manage_roles the module is no editor: no status line, no Save, whatever the flag says.
		const reader = rigModel({ ...roles, canManageRoles: false, dirty: true });
		assert(!reader.statusLine);
		assert(!reader.actions.some((a) => a.key === "save"));
	}
	// manage_roles opens no other module's editor.
	assert(
		!editorOpen({
			kind: "team",
			module: "members",
			canManageMoney: false,
			canEditProfile: false,
			canManageRoles: true,
		}),
	);
});

Deno.test("rig: a business's Settings is not an editor — only a team's mounts one (C6)", () => {
	// /businesses/:handle/settings is still a placeholder: no status line, no Save, the utilities' fold.
	assert(
		!editorOpen({
			kind: "business",
			module: "settings",
			canManageMoney: true,
			canEditProfile: true,
		}),
	);
	for (const dirty of [false, true]) {
		const business = rigModel(inConsole({ kind: "business", module: "settings", dirty }));
		assertEquals(business.statusLine, false);
		assertEquals(business.status, null);
		assertEquals(business.holds, "utilities");
		assertEquals(business.actions.map((a) => a.key), ["invite"]);
	}
	// A business's money editors are unchanged.
	assert(rigModel(inConsole({ kind: "business", module: "spend" })).statusLine);
});

Deno.test("rig: the commit is 'Save' beside 'Discard' — the status line already says 'changes'", () => {
	const dirty = rigModel(inConsole({ dirty: true }));
	assertEquals(dirty.actions.slice(-2).map((a) => a.label), ["Discard", "Save"]);
	assertEquals(dirty.status?.text, "Unsaved changes");
});

Deno.test("rig: what the trailing side holds — the width its words need before they fold", () => {
	assertEquals(rigModel(onRoster()).holds, "create");
	assertEquals(rigModel(onRoster({ canCreate: false })).holds, "create");
	for (const module of MODULES) {
		const holds = POLICY_MODULES.includes(module) || module === PROFILE_EDITOR_MODULE
			? "editor"
			: "utilities";
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
	assert(rigModel(inConsole({ module: "settings" })).statusLine, "Settings is an editor too");
	assert(!rigModel(inConsole({ module: "settings", canEditProfile: false })).statusLine);
	for (const module of ["overview", "members"]) {
		assert(!rigModel(inConsole({ module })).statusLine, module);
	}
	assert(!rigModel(onRoster()).statusLine);
});
// #endregion

// #region Utilities and links
Deno.test("rig: Invite opens in place where the modal is mounted, links to Members elsewhere", () => {
	for (const kind of ["team", "business"] as WorkspaceKind[]) {
		for (const module of ["members", "invitations"]) {
			const invite = rigModel(inConsole({ kind, module })).actions.find((a) => a.key === "invite");
			assert(invite?.control === "button" && invite.tier === 4, `${kind} ${module}`);
		}
	}
	// A team's Projects mounts the modal (its allowance band invites a team short of members), so the
	// rig's Invite there opens it too rather than leaving the page.
	const projects = rigModel(inConsole({ module: "projects" })).actions.find((a) =>
		a.key === "invite"
	);
	assert(projects?.control === "button" && projects.tier === 4);
	const invite = rigModel(inConsole({ module: "payouts" })).actions.find((a) => a.key === "invite");
	assert(invite?.control === "link");
	assertEquals(invite.href, "/teams/north-loop/members?invite=1");
	// A business's Projects hands off and mounts no modal.
	const business = rigModel(inConsole({ kind: "business", handle: "acme", module: "projects" }))
		.actions.find((a) => a.key === "invite");
	assert(business?.control === "link");
	assertEquals(business.href, "/businesses/acme/members?invite=1");
	assert(!keys(inConsole({ canInvite: false })).includes("invite"));
});

Deno.test("rig: inviteOpensInPlace names exactly the screens that mount the invite modal", () => {
	for (const kind of ["team", "business"] as WorkspaceKind[]) {
		for (const module of [...MODULES, null]) {
			const expected = module === "members" || module === "invitations" ||
				(kind === "team" && module === "projects");
			assertEquals(inviteOpensInPlace(kind, module), expected, `${kind} ${module}`);
		}
	}
	// The screens that answer `true` really mount it.
	const projects = source("../islands/TeamProjectsScreen.island.tsx");
	assert(/<InviteModal\b/.test(projects), "TeamProjectsScreen mounts no InviteModal");
	assert(/<InviteModal\b/.test(source("../islands/MembersScreen.island.tsx")));
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
	const roster = rigModel(onRoster());
	assertEquals(roster.zoom, { label: "Teams view zoom" });
	assertEquals(roster.actions, [{ key: "create", control: "button", tier: 4, label: "New team" }]);
	assertEquals(rigModel(onRoster({ canCreate: false })).actions, []);
});

Deno.test("rig: the roster's first run offers no New — the canvas's empty state carries the create", () => {
	for (const kind of ["team", "business"] as WorkspaceKind[]) {
		const first = rigModel(onRoster({ kind, firstRun: true }));
		assertEquals(first.actions, [], kind);
		assertEquals(rigFilledCount(first), 0, kind);
	}
	// Inside a console the roster's first run means nothing.
	assertEquals(keys(inConsole({ module: "members", firstRun: true })), ["invite", "settings"]);
});

Deno.test("rig: with the lane off-canvas the roster's New is the tier-2 create (#245 (k))", () => {
	for (const kind of ["team", "business"] as WorkspaceKind[]) {
		const label = kind === "team" ? "New team" : "New business";
		const bare = rigModel(onRoster({ kind, lane: "off-canvas" }));
		assertEquals(bare.actions, [{ key: "create", control: "button", tier: 2, label }], kind);
		assertEquals(rigFilledCount(bare), 1, kind);
		assertEquals(bare.note, null, kind);
		assertEquals(bare.holds, "create", kind);
		// Beside the lane, expanded or as the rail, the lane's LaneCreateButton is the tier-2 create.
		for (const lane of ["expanded", "rail", undefined] as const) {
			const docked = rigModel(onRoster({ kind, lane }));
			assertEquals(docked.actions, [{ key: "create", control: "button", tier: 4, label }], kind);
			assertEquals(rigFilledCount(docked), 0, kind);
			assertEquals(docked.note, null, kind);
		}
		// The zoom does not depend on the lane.
		assertEquals(bare.zoom, rigModel(onRoster({ kind })).zoom, kind);
	}
});

Deno.test("rig: a plan-capped roster offers no New in any layout, and says the lane's reason wherever the expanded lane is not drawn", () => {
	const reason = "Your plan includes 1 business — archive one or upgrade to create another.";
	for (const kind of ["team", "business"] as WorkspaceKind[]) {
		const capped = { kind, canCreate: false, createBlockedReason: reason };
		const docked = rigModel(onRoster({ ...capped, lane: "expanded" }));
		const rail = rigModel(onRoster({ ...capped, lane: "rail" }));
		const bare = rigModel(onRoster({ ...capped, lane: "off-canvas" }));
		// The server would refuse it, so no layout offers a create at any tier.
		assertEquals([docked.actions, rail.actions, bare.actions], [[], [], []], kind);
		assertEquals([docked, rail, bare].map(rigFilledCount), [0, 0, 0], kind);
		// The expanded lane says why. The collapsed rail draws the lane's create but no reason, and
		// without the lane there is neither, so the rig says the same line in both.
		assertEquals([docked.note, rail.note, bare.note], [null, reason, reason], kind);
		assertEquals(rigModel(onRoster(capped)).note, null, `${kind}: absent means expanded`);
		// No reason from the projection: the kind's own words, as the lane says them.
		for (const lane of ["rail", "off-canvas"] as const) {
			assertEquals(
				rigModel(onRoster({ kind, canCreate: false, lane })).note,
				rosterCreateNote(kind, null),
			);
			// In first run the canvas's empty state carries the reason, so the rig says nothing.
			assertEquals(rigModel(onRoster({ ...capped, lane, firstRun: true })).note, null);
		}
	}
	assertEquals(rosterCreateNote("team", "  "), "Your plan does not include another team.");
	assertEquals(rosterCreateNote("business", null), "Your plan does not include another business.");
	assertEquals(rosterCreateNote("team", ` ${reason} `), reason);
});

Deno.test("rig: the roster's first run holds no New and no note in any layout", () => {
	for (const kind of ["team", "business"] as WorkspaceKind[]) {
		for (const canCreate of [true, false]) {
			const { withLane, withRail, withoutLane } = rigLayouts(
				onRoster({ kind, canCreate, firstRun: true }),
			);
			for (const model of [withLane, withRail, withoutLane]) {
				assertEquals(model?.actions, [], kind);
				assertEquals(model?.note, null, kind);
			}
		}
	}
});

Deno.test("rig: rigLayouts answers every layout on the roster, and the lane and phone in a console", () => {
	for (const kind of ["team", "business"] as WorkspaceKind[]) {
		for (const canCreate of [true, false]) {
			const input = { kind, canCreate, createBlockedReason: "Upgrade to add another." };
			const roster = rigLayouts(onRoster({ ...input, lane: "off-canvas" }));
			assertEquals(roster.withLane, rigModel(onRoster({ ...input, lane: "expanded" })));
			assertEquals(roster.withRail, rigModel(onRoster({ ...input, lane: "rail" })));
			assertEquals(roster.withoutLane, rigModel(onRoster({ ...input, lane: "off-canvas" })));
			// Whatever the caller passed, each layout is its own answer.
			for (const lane of LANES) assertEquals(rigLayouts(onRoster({ ...input, lane })), roster);
			// The island draws the rail's layout as the lane's controls plus its reason, so the two hold
			// the same controls and differ by the note alone.
			assertEquals(roster.withRail?.actions, roster.withLane.actions, kind);
			assertEquals(roster.withLane.note, null, kind);
			// Beside the lane or its rail the rig never fills; without the lane its New is the one fill.
			assertEquals(rigFilledCount(roster.withLane), 0);
			assertEquals(rigFilledCount(roster.withRail!), 0);
			assertEquals(rigFilledCount(roster.withoutLane!), canCreate ? 1 : 0);
		}
		// A console's lane footer and its rail carry Invite member and Settings (Decision #306); the
		// phone rig carries them where the frame hides the lane.
		for (const module of MODULES) {
			const inside = rigLayouts(inConsole({ kind, module }));
			assertEquals(inside.withRail, null, `${kind}/${module}`);
			assertEquals(inside.withLane, rigModel(inConsole({ kind, module, lane: "expanded" })));
			assertEquals(inside.withoutLane, rigModel(inConsole({ kind, module, lane: "off-canvas" })));
			for (const key of ["invite", "settings"]) {
				assert(!inside.withLane.actions.some((a) => a.key === key), `${kind}/${module}: ${key}`);
			}
			assertEquals(inside.withLane.note, null);
		}
	}
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

Deno.test("footer rig: the filled Buttons are Save and the roster's promoted New; Discard and the toggle are text, utilities outlined", () => {
	const buttons = buttonElements(RIG);
	const filled = buttons.filter((b) => !/\bvariant="(outlined|text)"/.test(b));
	assertEquals(filled.length, 2, `filled: ${filled.join(" | ")}`);
	// Save (tier 3) lives in a console's editor and the promoted New (tier 2) on the roster without
	// the lane, so no model draws both (the fill sweep above).
	const save = filled.filter((b) => /onClick=\{props\.onSave\}/.test(b));
	const create = filled.filter((b) => /\bstructural\b/.test(b));
	assertEquals([save.length, create.length], [1, 1], `filled: ${filled.join(" | ")}`);
	assert(!/\bstructural\b/.test(save[0]), "Save is tier 3, not structural");
	assert(
		/onClick=\{props\.onCreate\}/.test(create[0]),
		"the structural Button is the roster's New",
	);
	assert(/\brounded\b/.test(create[0]), "the promoted New is the lane's pill, moved");
	assert(
		/action\.tier === 2\s*\?/.test(RIG),
		"the structural New is drawn only for a tier-2 create",
	);
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

/** Every `@media` block of a sheet: its query and its body, read to the matching brace. */
function mediaBlocks(sheet: string): { query: string; body: string }[] {
	const out: { query: string; body: string }[] = [];
	for (const match of sheet.matchAll(/@media([^{]*)\{/g)) {
		const open = (match.index ?? 0) + match[0].length;
		let depth = 1;
		let at = open;
		while (at < sheet.length && depth > 0) {
			if (sheet[at] === "{") depth++;
			else if (sheet[at] === "}") depth--;
			at++;
		}
		out.push({ query: match[1].trim(), body: sheet.slice(open, at - 1) });
	}
	return out;
}

/** A sheet's text with its comments removed and its line endings unified. */
function sheetText(url: URL): string {
	return Deno.readTextFileSync(url).replaceAll("\r\n", "\n").replace(/\/\*[\s\S]*?\*\//g, "");
}

Deno.test("footer rig: the roster draws both layouts, and the sheet paints one with the frame's own lane query (#245 (k))", () => {
	// The island draws each layout's answer in its own wrapper; the reason rides only where the
	// expanded lane is not drawn: the phone's in its layout, the rail's in the lane's.
	assert(/rigLayouts\(\{/.test(RIG), "the rig reads every layout");
	assert(
		/class="wsp-footerrig__layout" data-lane="shown">\s*\{controls\(rig\)\}\s*\{withRail\?\.note && \(\s*<span class="wsp-footerrig__createnote" data-lane="rail">\{withRail\.note\}<\/span>/
			.test(RIG),
	);
	assert(
		/class="wsp-footerrig__layout" data-lane="hidden">\s*\{controls\(withoutLane\)\}/.test(RIG),
	);
	assert(/class="wsp-footerrig__createnote">\{withoutLane\.note\}/.test(RIG));
	assert(
		!/\bmatchMedia\b|\buseMediaQuery\b/.test(RIG),
		"the swap is the stylesheet's, not a script's",
	);

	const sheet = sheetText(new URL("../styles/workspace-chrome.css", import.meta.url));
	// At rest the layout beside the lane paints, and the one without it is out of the tree.
	assert(/\.wsp-footerrig__layout\s*\{\s*display:\s*contents;\s*\}/.test(sheet));
	assert(/\.wsp-footerrig__layout\[data-lane="hidden"\]\s*\{\s*display:\s*none;\s*\}/.test(sheet));
	// One media block swaps them.
	const swaps = mediaBlocks(sheet).filter((b) => /wsp-footerrig__layout/.test(b.body));
	assertEquals(swaps.length, 1, "one block swaps the layouts");
	const [swap] = swaps;
	assert(
		/\.wsp-footerrig__layout\[data-lane="shown"\]\s*\{\s*display:\s*none;\s*\}/.test(swap.body),
	);
	assert(
		/\.wsp-footerrig__layout\[data-lane="hidden"\]\s*\{\s*display:\s*contents;\s*\}/.test(
			swap.body,
		),
	);

	// The phone's reason wraps under the zoom in the same block, so it follows the same query.
	assert(
		/\.wsp-footerrig:has\(\.wsp-footerrig__layout\[data-lane="hidden"\] > \.wsp-footerrig__createnote\)\s*\{[^}]*flex-wrap:\s*wrap;/
			.test(swap.body),
	);

	// That block's query IS the frame's, character for character, so the rig's tier-2 New and the
	// lane's LaneCreateButton never paint together and the page is never left without either. A
	// `rem` copy would agree only at a 16px browser default: a media query's `rem` reads the
	// browser's default font size, and the frame's `px` does not move with it.
	const frameSheet = new URL(import.meta.resolve("@ui/navigation/styles/middle-nav.css"));
	const frame = mediaBlocks(sheetText(frameSheet))
		.filter((b) => /\.ui-middle-nav__lane\s*\{\s*display:\s*none;\s*\}/.test(b.body));
	assertEquals(frame.length, 1, "the frame hides its lane in one block");
	assertEquals(swap.query, frame[0].query, "the rig swaps on the frame's own lane query");

	// The rail's reason paints only while the splitter is collapsed, and only from the lane's layout,
	// which the phone's query hides.
	assert(
		/\.wsp-footerrig__createnote\[data-lane="rail"\]\s*\{\s*display:\s*none;\s*\}/.test(sheet),
	);
	assert(
		/\.ui-middle-nav:has\(\.ui-middle-nav__lane \.ui-splitter\[data-mode="collapsed"\]\)\s+\.ui-middle-nav__footer\s+\.wsp-footerrig__createnote\[data-lane="rail"\]\s*\{\s*display:\s*-webkit-box;\s*\}/
			.test(sheet),
		"the rail's reason paints beside the collapsed rail",
	);
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
			"../islands/TeamSettingsScreen.island.tsx",
			"../islands/RolesMatrix.island.tsx",
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
