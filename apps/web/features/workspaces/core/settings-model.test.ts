import { assert, assertEquals } from "@std/assert";
import type {
	ArchiveBlocker,
	ArchiveBlockerCode,
	RestoreTarget,
	WorkspaceCapability,
	WorkspaceKind,
	WorkspaceStatus,
} from "@projective/types/workspace";
import {
	blockerLine,
	HANDLE_NOTE,
	identityDirty,
	identityPatch,
	lifecycleControl,
	lifecycleTag,
	nameError,
	refusedBlockers,
	settingsBodyFilledCount,
	type SettingsInput,
	settingsModel,
	simulateSettings,
	VISIBILITY_OPTIONS,
	visibilityHint,
} from "./settings-model.ts";
import { headerBand, headerFilledCount } from "./header-model.ts";
import { rigFilledCount, rigModel } from "./rig-model.ts";
import { importWithoutGlyphs } from "./registry-import.testing.ts";

/**
 * The Settings module (Teams work order C6): Identity · Visibility · Lifecycle, and the ONE lifecycle
 * control per (status, capabilities, blockers) — Publish as the header band's commit while draft,
 * Archive… for an `archive_entity` holder unless the server lists a blocker (then the blockers, each
 * with its link, never a button that would fail), Restore named for where the server says it lands.
 */

// #region Fixtures
const OWNER: readonly WorkspaceCapability[] = [
	"invite_members",
	"remove_members",
	"manage_roles",
	"edit_profile",
	"manage_settings",
	"manage_projects",
	"manage_finances",
	"archive_entity",
];
/** The admin preset: settings and profile, never archive (`org.fn_preset_capabilities`). */
const ADMIN = OWNER.filter((c) => c !== "archive_entity");
/** A custom role holding settings alone. */
const SETTINGS_ONLY: readonly WorkspaceCapability[] = ["manage_settings"];

const STATUSES: readonly WorkspaceStatus[] = ["draft", "active", "archived"];
const ESCROW: ArchiveBlocker = { code: "escrow_held", count: 1 };
const LIVE: ArchiveBlocker = { code: "live_assignments", count: 2 };

function input(overrides: Partial<SettingsInput> = {}): SettingsInput {
	return {
		kind: "team",
		id: "team-1",
		name: "North Loop",
		handle: "northloop",
		status: "active",
		visibility: "public",
		capabilities: OWNER,
		archiveBlockers: [],
		restoreTarget: null,
		memberCount: 3,
		...overrides,
	};
}
// #endregion

// #region The control set
Deno.test("settings: the lifecycle control per (status, capabilities, blockers)", () => {
	const cases: [WorkspaceStatus, readonly WorkspaceCapability[], ArchiveBlocker[], string][] = [
		["draft", OWNER, [], "archive"],
		["draft", OWNER, [ESCROW], "blocked"],
		["draft", ADMIN, [], "none"],
		["active", OWNER, [], "archive"],
		["active", OWNER, [ESCROW], "blocked"],
		["active", OWNER, [LIVE], "blocked"],
		["active", OWNER, [ESCROW, LIVE], "blocked"],
		["active", ADMIN, [], "none"],
		// A blocker list only ever reaches an archive holder; a stray one changes nothing for others.
		["active", ADMIN, [ESCROW], "none"],
		["active", SETTINGS_ONLY, [], "none"],
		["archived", OWNER, [], "restore"],
		["archived", ADMIN, [], "none"],
	];
	for (const [status, capabilities, archiveBlockers, expected] of cases) {
		const control = lifecycleControl(input({ status, capabilities, archiveBlockers }));
		assertEquals(
			control.kind,
			expected,
			`${status}/${capabilities.length}/${archiveBlockers.length}`,
		);
	}
});

Deno.test("settings: a team with a held escrow shows the blocker, not the button", () => {
	const model = settingsModel(input({ archiveBlockers: [ESCROW] }));
	const control = model.lifecycle.control;
	assert(control.kind === "blocked");
	assertEquals(control.blockers.map((b) => b.code), ["escrow_held"]);
	assertEquals(
		control.blockers[0].text,
		"1 escrow is held for this team's work — archiving waits until it releases.",
	);
	assertEquals(control.blockers[0].link, {
		label: "Open the vault",
		href: "/wallet?w=team:team-1",
	});
	// …and the header band's kebab withholds its Archive… for the same read.
	const band = headerBand({
		kind: "team",
		title: "Settings",
		module: "settings",
		name: "North Loop",
		handle: "northloop",
		status: "active",
		acting: false,
		owner: true,
		capabilities: OWNER,
		archiveBlocked: true,
		subViews: [],
		view: null,
		commit: null,
	});
	assertEquals(band.menu.archive, false);
});

Deno.test("settings: live work points at Projects, in the server's order, counted", () => {
	const control = lifecycleControl(input({ archiveBlockers: [ESCROW, LIVE] }));
	assert(control.kind === "blocked");
	assertEquals(control.blockers.map((b) => b.code), ["escrow_held", "live_assignments"]);
	assertEquals(
		control.blockers[1].text,
		"This team is assigned to 2 live stages — finish them or hand them back first.",
	);
	assertEquals(control.blockers[1].link, {
		label: "Open Projects",
		href: "/teams/northloop/projects",
	});
});

Deno.test("settings: Archive is the danger control with a confirm that says where a restore lands", () => {
	const active = lifecycleControl(input());
	assert(active.kind === "archive");
	assertEquals(active.label, "Archive team…");
	assertEquals(active.confirm.header, "Archive North Loop?");
	assert(active.confirm.message.endsWith("restoring it brings it back live."));
	assertEquals([active.confirm.accept, active.confirm.reject], ["Archive", "Keep it"]);
	const draft = lifecycleControl(input({ status: "draft" }));
	assert(draft.kind === "archive" && draft.confirm.message.endsWith("brings it back as a draft."));
});

Deno.test("settings: Restore names its target, as the server decides it (#250 (c))", () => {
	const target = (restoreTarget: RestoreTarget | null) =>
		lifecycleControl(input({ status: "archived", restoreTarget }));
	assertEquals(target("active"), {
		kind: "restore",
		label: "Restore as active",
		tier: 3,
		target: "active",
	});
	assertEquals(target("draft"), {
		kind: "restore",
		label: "Restore as a draft",
		tier: 3,
		target: "draft",
	});
	// A read that did not say: the button still restores — the server lands it where it decides.
	assertEquals(target(null), { kind: "restore", label: "Restore", tier: 3, target: null });
	assertEquals(
		settingsModel(input({ status: "archived", restoreTarget: "draft" })).lifecycle.facts,
		["It was never published, so a restore brings it back as a draft"],
	);
});
// #endregion

// #region One filled control per region
Deno.test("settings: Publish is the header band's ONE filled action, only while draft, only for manage_settings", () => {
	for (const status of STATUSES) {
		const sets: (readonly WorkspaceCapability[])[] = [OWNER, ADMIN, SETTINGS_ONLY, [
			"edit_profile",
		]];
		for (const capabilities of sets) {
			const model = settingsModel(input({ status, capabilities }));
			const expected = status === "draft" && capabilities.includes("manage_settings");
			assertEquals(model.commit !== null, expected, `${status}/${capabilities.join(",")}`);
			if (model.commit) {
				assertEquals(model.commit, { key: "publish", label: "Publish team", tier: 3 });
			}
		}
	}
	assertEquals(
		settingsModel(input({ kind: "business", status: "draft" })).commit?.label,
		"Publish business",
	);
});

Deno.test("settings: one filled control per region — band (Publish), body (Restore), rig (Save)", () => {
	for (const status of STATUSES) {
		for (const capabilities of [OWNER, ADMIN, SETTINGS_ONLY]) {
			for (const archiveBlockers of [[], [ESCROW]]) {
				const model = settingsModel(input({ status, capabilities, archiveBlockers }));
				assert(settingsBodyFilledCount(model) <= 1);
				const band = headerBand({
					kind: "team",
					title: "Settings",
					module: "settings",
					name: "North Loop",
					handle: "northloop",
					status,
					acting: false,
					owner: capabilities === OWNER,
					capabilities,
					archiveBlocked: archiveBlockers.length > 0,
					subViews: [],
					view: null,
					commit: model.commit ? { ...model.commit, run: () => {} } : null,
				});
				assert(headerFilledCount(band) <= 1);
				// The body's Restore and the band's Publish never share a status.
				assert(!(model.commit && settingsBodyFilledCount(model) > 0));
				for (const dirty of [true, false]) {
					const rig = rigModel({
						kind: "team",
						handle: "northloop",
						module: "settings",
						view: null,
						canCreate: true,
						canInvite: true,
						canManageMoney: true,
						canManageSettings: true,
						canEditProfile: capabilities.includes("edit_profile"),
						dirty,
						saveState: "idle",
					});
					assert(rigFilledCount(rig) <= 1);
				}
			}
		}
	}
});
// #endregion

// #region Identity and visibility
Deno.test("settings: the handle is read-only and says why; the name edits with edit_profile", () => {
	const owner = settingsModel(input());
	assertEquals(owner.identity, {
		editable: true,
		handleText: "@northloop",
		handleNote: HANDLE_NOTE,
	});
	assertEquals(HANDLE_NOTE, "Handles can't change");
	const settingsOnly = settingsModel(input({ capabilities: SETTINGS_ONLY }));
	assertEquals([settingsOnly.identity.editable, settingsOnly.visibility.editable], [false, false]);
});

Deno.test("settings: a name is judged as org.update_workspace judges it", () => {
	assertEquals(nameError("North Loop"), null);
	assertEquals(nameError("  N "), "Give it a name of at least 2 characters.");
	assertEquals(nameError("x".repeat(81)), "Keep the name to 80 characters.");
	assertEquals(nameError("x".repeat(80)), null);
});

Deno.test("settings: Save sends only what moved; nothing moved is not dirty", () => {
	const saved = { name: "North Loop", visibility: "public" as const };
	assertEquals(identityPatch(saved, saved), {});
	assert(!identityDirty(saved, { ...saved, name: " North Loop " }), "whitespace is not a change");
	assertEquals(identityPatch(saved, { name: "North Loop Studio ", visibility: "public" }), {
		name: "North Loop Studio",
	});
	assertEquals(identityPatch(saved, { name: "North Loop", visibility: "unlisted" }), {
		visibility: "unlisted",
	});
	assert(identityDirty(saved, { name: "North Loop", visibility: "invite_only" }));
});

Deno.test("settings: visibility offers the three values and says what each means", () => {
	assertEquals(VISIBILITY_OPTIONS.map((o) => o.value), ["public", "unlisted", "invite_only"]);
	assertEquals(
		visibilityHint("public", "northloop"),
		"Listed in the directory, and anyone can open /@northloop.",
	);
	assertEquals(visibilityHint("invite_only", "northloop"), "Only members can open /@northloop.");
	assertEquals(settingsModel(input()).visibility.statusNote, null);
	assertEquals(
		settingsModel(input({ status: "draft" })).visibility.statusNote,
		"Until the team is published, only members see it.",
	);
	assertEquals(
		settingsModel(input({ status: "archived" })).visibility.statusNote,
		"While the team is archived, only members see it.",
	);
});

Deno.test("settings: a draft says what publishing does — the page, the two-member rule, no way back", () => {
	const facts = (memberCount: number, visibility: SettingsInput["visibility"] = "public") =>
		settingsModel(input({ status: "draft", memberCount, visibility })).lifecycle.facts;
	assertEquals(facts(3), [
		"Publishing lists it on /@northloop",
		"lets it apply for work",
		"a published team never returns to draft",
	]);
	assertEquals(facts(1)[1], { text: "lets it apply once it has 2 members", tabular: true });
	assertEquals(
		facts(3, "invite_only")[0],
		"Publishing keeps /@northloop members-only while it is invite only",
	);
	assertEquals(settingsModel(input({ status: "draft" })).lifecycle.tag, {
		label: "Draft",
		severity: "warning",
	});
	assertEquals(settingsModel(input()).lifecycle.tag, { label: "Active", severity: "success" });
});

Deno.test("settings: the status Tag is the lane header strip's, word for word", async () => {
	const lane = await importWithoutGlyphs<{ statusTag(status: WorkspaceStatus): unknown }>(
		"./lane-model.ts",
	);
	for (const status of STATUSES) assertEquals(lifecycleTag(status), lane.statusTag(status), status);
});
// #endregion

// #region Refusals that raced the read
Deno.test("settings: a refused archive's codes are worded the same way, without counts", () => {
	assertEquals(refusedBlockers("escrow_held,live_assignments"), [
		"escrow_held",
		"live_assignments",
	]);
	assertEquals(refusedBlockers("escrow_held,nonsense"), ["escrow_held"]);
	assertEquals(refusedBlockers(undefined), []);
	const raced = blockerLine(input(), "live_assignments", null);
	assertEquals(
		raced.text,
		"This team is still assigned to live work — finish it or hand it back first.",
	);
	assertEquals(
		blockerLine(input(), "escrow_held", null).text,
		"Money is held in escrow for this team's work — archiving waits until it releases.",
	);
});

Deno.test("settings: every blocker code either kind can raise has words and a link", () => {
	const codes: ArchiveBlockerCode[] = [
		"escrow_held",
		"live_assignments",
		"live_projects",
		"pending_approvals",
		"unpaid_invoices",
		"on_account_owed",
		"wallet_balance",
		"pending_payouts",
	];
	for (const kind of ["team", "business"] as WorkspaceKind[]) {
		for (const code of codes) {
			for (const count of [null, 1, 3]) {
				const line = blockerLine(input({ kind }), code, count);
				assert(line.text.length > 0 && line.link.href.startsWith("/"), `${kind}/${code}`);
				assert(!/\bundefined\b|\bnull\b/.test(line.text), line.text);
			}
		}
	}
	assertEquals(
		blockerLine(input({ kind: "business" }), "pending_approvals", 2).link.href,
		"/businesses/northloop/spend",
	);
});
// #endregion

// #region The island renders the model
/**
 * The island cannot be rendered under `deno test` (every `@projective/ui` component imports CSS), so
 * its wiring is read from source.
 */
const ISLAND = Deno.readTextFileSync(
	new URL("../islands/TeamSettingsScreen.island.tsx", import.meta.url),
);

Deno.test("settings island: Publish rides the band, Save the rig, Archive confirms as a danger", () => {
	assert(/useModuleCommit\(\(\) => \{[\s\S]*?model\.value\.commit/.test(ISLAND), "Publish → band");
	assert(/usePolicyBridge\(\{ dirty, save, discard \}\)/.test(ISLAND), "Save/Discard → rig");
	assert(
		/severity="danger"\s+variant="outlined"\s+label=\{control\.label\}/.test(ISLAND),
		"Archive is the danger outlined control",
	);
	assert(/<ConfirmDialog\b[\s\S]*?acceptSeverity="danger"/.test(ISLAND), "…behind a confirm");
	assert(/control\.kind === "blocked" && <Blockers/.test(ISLAND), "blockers replace the button");
	assert(/\{failed && \(/.test(ISLAND), "a raced refusal renders inline");
});

Deno.test("settings island: ui controls only, signal state, no inline style", () => {
	assert(!/<button\b|<a\s/.test(ISLAND), "no raw <button>/<a> — ui Button and Link");
	assert(!/\buseState\b/.test(ISLAND), "signal-first");
	assert(!/\bstyle=/.test(ISLAND), "no inline style");
	assert(
		/<FormControl[\s\S]*?<InputText/.test(ISLAND),
		"the name is an InputText in a FormControl",
	);
	assert(/<FormControl[\s\S]*?<SelectButton/.test(ISLAND), "visibility is a SelectButton");
	assert(/WorkspaceService\.update\(\{ kind: ws\.kind, id: ws\.id, status \}\)/.test(ISLAND));
	assert(/move\("restore", "restore"\)/.test(ISLAND), "Restore asks the server where it lands");
});
// #endregion

// #region Dev Context Switcher
Deno.test("settings: the teamSettings axis substitutes the lifecycle, and auto changes nothing", () => {
	const real = input();
	assertEquals(simulateSettings(real, "auto"), real);
	assertEquals(simulateSettings(real, undefined), real);
	assertEquals(lifecycleControl(simulateSettings(real, "escrow_held")).kind, "blocked");
	assertEquals(lifecycleControl(simulateSettings(real, "live_assignments")).kind, "blocked");
	assertEquals(settingsModel(simulateSettings(real, "draft")).commit?.label, "Publish team");
	const restore = lifecycleControl(simulateSettings(real, "archived_published"));
	assert(restore.kind === "restore" && restore.label === "Restore as active");
	const draft = lifecycleControl(simulateSettings(real, "archived_draft"));
	assert(draft.kind === "restore" && draft.label === "Restore as a draft");
	assertEquals(
		lifecycleControl(simulateSettings(input({ status: "archived" }), "active")).kind,
		"archive",
	);
});
// #endregion
