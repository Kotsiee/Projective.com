import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import type { ProposalAllowanceStatus } from "@projective/types/finance";
import type { SentApplication } from "@projective/types/projects";
import type {
	EngagementAssignee,
	TeamEngagement,
	WorkspaceStatus,
} from "@projective/types/workspace";
import {
	ALLOWANCE_UNAVAILABLE,
	allowanceBand,
	assigneeReadout,
	BAND_ARCHIVED_NOTICE,
	BAND_ASK_A_LEAD,
	BAND_DRAFT_NOTICE,
	BAND_TOO_SMALL_NOTICE,
	bandFilledCount,
	bandGate,
	bandGated,
	ENGAGEMENT_IDLE,
	engagementRow,
	engagementsSummary,
	engagementStatus,
	focusAfterWithdraw,
	formatWi,
	proposalsSummary,
	stageHref,
	teamProposals,
	utcDayMonth,
	utcWeekday,
	withdrawConfirmMessage,
} from "./projects-model.ts";

/**
 * A team console's Projects module (Teams work order C5): the allowance band's gate — exactly one
 * filled control or none, whatever the team's status, head-count and the viewer's `bind_seat` — its
 * meter, the engagement rows' Wᵢ readouts and soft-cap words, and the team's pending proposals with
 * Withdraw only where the server allows it.
 */

// #region Fixtures
const SETTINGS = "/teams/north-loop/settings";
const TEAM = "6a4f2d0e-0c5b-4c11-9a52-1f3b7c9d0e21";

function status(overrides: Partial<ProposalAllowanceStatus> = {}): ProposalAllowanceStatus {
	return {
		subjectType: "team",
		subjectId: TEAM,
		weeklyGranted: 50,
		weeklyConsumed: 12,
		weeklyRemaining: 38,
		weeklyResetsAt: "2026-10-19T00:00:00.000Z",
		bufferUnits: 9,
		bufferCap: 12,
		bufferDrip: 3,
		bufferWindowHours: 10,
		nextBufferRefillAt: "2026-10-18T18:00:00.000Z",
		canApply: true,
		enforced: false,
		planCode: "team_free",
		planLabel: "Free",
		planTier: "free",
		upgrade: null,
		standingLevel: 1,
		standingBonus: 0,
		teamStatus: "active",
		teamMemberCount: 3,
		canBindSeat: true,
		serverNow: "2026-10-18T09:00:00.000Z",
		...overrides,
	};
}

function assignee(overrides: Partial<EngagementAssignee> = {}): EngagementAssignee {
	return {
		handle: "ana",
		displayName: "Ana Reyes",
		avatarUrl: "",
		wi: 6,
		wiCap: 10,
		stageWi: 3,
		...overrides,
	};
}

function engagement(overrides: Partial<TeamEngagement> = {}): TeamEngagement {
	return {
		projectSlug: "prj-tm2bjk9mdq",
		title: "Brand refresh",
		stageSlug: "stg-q7wz3k1p",
		stageTitle: "Identity system",
		assignmentStatus: "accepted",
		projectStatus: "active",
		assignees: [assignee(), assignee({ handle: "ben", displayName: "Ben Ito", stageWi: 1.5 })],
		stageWi: 4.5,
		stageCap: 10,
		...overrides,
	};
}

function sent(overrides: Partial<SentApplication> = {}): SentApplication {
	return {
		id: "app-1",
		status: "pending",
		applicantType: "team",
		teamId: TEAM,
		teamName: "North Loop",
		canWithdraw: true,
		projectSlug: "prj-abc123",
		projectTitle: "Checkout rebuild",
		stageSlug: "stg-def456",
		stageName: "Discovery",
		roleTitle: null,
		createdAt: "2026-10-12T10:00:00.000Z",
		...overrides,
	};
}
// #endregion

// #region The band's gate — the acceptance
const STATUSES: readonly (WorkspaceStatus | null)[] = ["draft", "active", "archived", null];
const HEADCOUNTS: readonly (number | null)[] = [0, 1, 2, 3, null];
const BIND: readonly (boolean | null)[] = [true, false, null];
const FLAGS = [true, false] as const;

Deno.test("band gate: exactly one filled control or none, per (status, members, bind_seat)", () => {
	for (const s of STATUSES) {
		for (const members of HEADCOUNTS) {
			for (const canBindSeat of BIND) {
				for (const canInvite of FLAGS) {
					for (const canOpenSettings of FLAGS) {
						for (const canRestore of FLAGS) {
							const gate = bandGate({
								status: s,
								members,
								canBindSeat,
								canInvite,
								canOpenSettings,
								canRestore,
								settingsHref: SETTINGS,
							});
							const at = JSON.stringify({
								s,
								members,
								canBindSeat,
								canInvite,
								canOpenSettings,
								canRestore,
							});
							const filled = bandFilledCount(gate);
							assert(filled === 0 || filled === 1, `${filled} filled controls at ${at}`);
							// The one fill is Invite member: a team under two members that is not archived (an
							// archived team takes no invitation), to an inviter — draft or published alike.
							const expectFill = s !== "archived" && members !== null && members < 2 &&
								canInvite;
							assertStrictEquals(filled, expectFill ? 1 : 0, at);
							for (const { action } of gate.items) {
								if (!action) continue;
								if (action.filled) {
									assertEquals(action, {
										key: "invite",
										tier: 2,
										filled: true,
										label: "Invite member",
									});
								}
								// A control never appears for a viewer who could not use it.
								if (action.key === "settings") {
									assert(canOpenSettings, at);
									if (s === "archived") assert(canRestore, at);
								}
								if (action.key === "invite") assert(canInvite, at);
							}
							// Every condition that holds is its own line, in the door's order.
							const expected = s === "archived" ? ["team_not_active"] : [
								...(s === "draft" ? ["team_not_active"] : []),
								...(members !== null && members < 2 ? ["team_too_small"] : []),
							];
							assertEquals(gate.items.map((item) => item.reason), expected, at);
							// The viewer's note is its own condition — except on an archived team, which
							// nobody applies for until it is restored.
							assertStrictEquals(
								gate.viewerNote,
								canBindSeat === false && s !== "archived" ? BAND_ASK_A_LEAD : null,
								at,
							);
							assertStrictEquals(bandGated(gate), expected.length > 0 || gate.viewerNote !== null);
						}
					}
				}
			}
		}
	}
});

Deno.test("band gate: an unpublished team — publish it, a tier-4 link to Settings", () => {
	const input = {
		members: 3,
		canBindSeat: true,
		canInvite: true,
		canOpenSettings: true,
		canRestore: false,
		settingsHref: SETTINGS,
	};
	const draft = bandGate({ ...input, status: "draft" });
	assertEquals(draft.items, [{
		reason: "team_not_active",
		notice: BAND_DRAFT_NOTICE,
		action: { key: "settings", tier: 4, filled: false, label: "Open settings", href: SETTINGS },
	}]);
	assertStrictEquals(BAND_DRAFT_NOTICE, "Publish the team to send proposals.");
	// Somebody who may not open Settings is told, and offered nothing that would only refuse.
	assertStrictEquals(
		bandGate({ ...input, status: "draft", canOpenSettings: false }).items[0].action,
		null,
	);
});

Deno.test("band gate: a new draft team of one is told both — publish it AND invite a member", () => {
	const gate = bandGate({
		status: "draft",
		members: 1,
		canBindSeat: true,
		canInvite: true,
		canOpenSettings: true,
		canRestore: true,
		settingsHref: SETTINGS,
	});
	assertEquals(gate.items.map((item) => [item.reason, item.notice, item.action?.key ?? null]), [
		["team_not_active", BAND_DRAFT_NOTICE, "settings"],
		["team_too_small", BAND_TOO_SMALL_NOTICE, "invite"],
	]);
	// Still one fill: the Settings link is tier-4 outlined, Invite member the band's one filled control.
	assertStrictEquals(bandFilledCount(gate), 1);
	assertStrictEquals(gate.viewerNote, null);
});

Deno.test("band gate: an archived team — restore it; the link only for a viewer who may restore", () => {
	const input = {
		status: "archived" as const,
		members: 1,
		canBindSeat: false,
		canInvite: true,
		canOpenSettings: true,
		settingsHref: SETTINGS,
	};
	// The owner (manage_settings + archive_entity): the sentence and the way to Settings.
	assertEquals(bandGate({ ...input, canRestore: true }), {
		items: [{
			reason: "team_not_active",
			notice: BAND_ARCHIVED_NOTICE,
			action: { key: "settings", tier: 4, filled: false, label: "Open settings", href: SETTINGS },
		}],
		viewerNote: null,
	});
	// An admin holds manage_settings but not archive_entity: org.set_workspace_status would refuse the
	// restore, so the band says it and sends them nowhere.
	assertEquals(bandGate({ ...input, canRestore: false }).items[0].action, null);
	// archive_entity without Settings access: no link to a module that would not open.
	assertEquals(
		bandGate({ ...input, canRestore: true, canOpenSettings: false }).items[0].action,
		null,
	);
	// No Invite member on an archived team — org.invite_workspace_member refuses one.
	assertStrictEquals(bandFilledCount(bandGate({ ...input, canRestore: true })), 0);
});

Deno.test("band gate: under two members — the sentence and Invite member, for an inviter only", () => {
	const input = {
		status: "active" as const,
		canBindSeat: true,
		canOpenSettings: true,
		canRestore: true,
		settingsHref: SETTINGS,
	};
	const solo = bandGate({ ...input, members: 1, canInvite: true });
	assertEquals(solo.items.map((item) => item.reason), ["team_too_small"]);
	assertStrictEquals(solo.items[0].notice, BAND_TOO_SMALL_NOTICE);
	assertStrictEquals(solo.items[0].action?.key, "invite");
	assertStrictEquals(bandGate({ ...input, members: 1, canInvite: false }).items[0].action, null);
	assertEquals(bandGate({ ...input, members: 2, canInvite: true }).items, []);
});

Deno.test("band gate: a viewer without bind_seat is told as Meta, never offered a control", () => {
	const input = {
		members: 3,
		canInvite: true,
		canOpenSettings: false,
		canRestore: false,
		settingsHref: SETTINGS,
	};
	const gate = bandGate({ ...input, status: "active", canBindSeat: false });
	assertEquals(gate, { items: [], viewerNote: BAND_ASK_A_LEAD });
	assertStrictEquals(BAND_ASK_A_LEAD, "Ask a lead to apply for the team");
	// On a draft team it rides beside the publish line: once published, a lead still applies.
	const draft = bandGate({ ...input, status: "draft", canBindSeat: false });
	assertEquals(draft.items.map((item) => item.reason), ["team_not_active"]);
	assertStrictEquals(draft.viewerNote, BAND_ASK_A_LEAD);
	// A lead — or a read that did not say — gets no note.
	for (const canBindSeat of [true, null]) {
		assertStrictEquals(bandGate({ ...input, status: "active", canBindSeat }).viewerNote, null);
	}
});
// #endregion

// #region The band's meter
/** The viewer's rights for a band read — an owner's by default. */
const OWNER_RIGHTS = {
	canInvite: true,
	canOpenSettings: true,
	canRestore: true,
	settingsHref: SETTINGS,
};
const NO_RIGHTS = {
	canInvite: false,
	canOpenSettings: false,
	canRestore: false,
	settingsHref: SETTINGS,
};

Deno.test("band: the weekly meter is used over granted, tabular, with the buffer and refill day", () => {
	const band = allowanceBand({ allowance: status(), ...OWNER_RIGHTS });
	assertStrictEquals(band.title, "Proposals this week");
	assertEquals(band.meter, {
		used: 12,
		total: 50,
		percent: 24,
		figure: "12 / 50",
		label: "12 of 50 proposals used this week",
	});
	// Monday 00:00 UTC is the period's end; the pool's owner is not named while #154 (b) is open.
	assertEquals(band.meta, ["buffer 9/12", "refills Mon"]);
	assert(!band.meta.some((fact) => /pool/i.test(fact)), "the pool is named");
	assertStrictEquals(band.unavailable, null);
	assertStrictEquals(bandFilledCount(band.gate), 0);
	// Nothing in the way: no gate, so the meter takes the band's full width.
	assertStrictEquals(bandGated(band.gate), false);
});

Deno.test("band: the meter clamps a spent week and reads an empty grant as empty", () => {
	const over = allowanceBand({
		allowance: status({ weeklyConsumed: 60, weeklyGranted: 50 }),
		...NO_RIGHTS,
	});
	assertStrictEquals(over.meter?.percent, 100);
	const none = allowanceBand({
		allowance: status({ weeklyConsumed: 0, weeklyGranted: 0, bufferCap: 0 }),
		...NO_RIGHTS,
	});
	assertStrictEquals(none.meter?.percent, 0);
	assertEquals(none.meta, ["refills Mon"]);
});

Deno.test("band: the gate reads the allowance's team facts, not anything else", () => {
	const band = allowanceBand({
		allowance: status({ teamStatus: "active", teamMemberCount: 1, canBindSeat: true }),
		...OWNER_RIGHTS,
	});
	assertEquals(band.gate.items.map((item) => item.reason), ["team_too_small"]);
	assertStrictEquals(bandFilledCount(band.gate), 1);
	const draft = allowanceBand({
		allowance: status({ teamStatus: "draft", teamMemberCount: 1, canBindSeat: true }),
		...OWNER_RIGHTS,
	});
	assertEquals(draft.gate.items.map((item) => item.reason), ["team_not_active", "team_too_small"]);
	// The archived restore link follows the viewer's archive_entity, which the band passes through.
	const archived = status({ teamStatus: "archived", teamMemberCount: 3 });
	assertStrictEquals(
		allowanceBand({ allowance: archived, ...OWNER_RIGHTS, canRestore: false }).gate.items[0].action,
		null,
	);
	assertStrictEquals(
		allowanceBand({ allowance: archived, ...OWNER_RIGHTS }).gate.items[0].action?.key,
		"settings",
	);
});

Deno.test("band: no allowance answered — no meter, no gate, a sentence instead of a guess", () => {
	const band = allowanceBand({ allowance: null, ...OWNER_RIGHTS });
	assertStrictEquals(band.meter, null);
	assertEquals(band.meta, []);
	assertStrictEquals(band.unavailable, ALLOWANCE_UNAVAILABLE);
	assertEquals(band.gate, { items: [], viewerNote: null });
	assertStrictEquals(bandGated(band.gate), false);
});
// #endregion

// #region Engagements
Deno.test("engagement: the row links the project and the stage by their slugs", () => {
	const row = engagementRow(engagement());
	assertStrictEquals(row.key, "prj-tm2bjk9mdq/stg-q7wz3k1p");
	assertStrictEquals(row.projectHref, "/projects/prj-tm2bjk9mdq");
	assertStrictEquals(row.stageHref, "/projects/prj-tm2bjk9mdq/stg-q7wz3k1p");
	assertStrictEquals(stageHref("prj-a", "stg-b"), "/projects/prj-a/stg-b");
	assertEquals(row.status, { label: "Accepted", severity: "success" });
	assertEquals(row.faces, [{ name: "Ana Reyes", avatar: null }, { name: "Ben Ito", avatar: null }]);
	assertEquals(row.meta, ["team Wᵢ 4.5", "cap 10 per person"]);
	assertStrictEquals(row.idle, null);
	// No uuid reaches a row — the addresses are slugs only (Decision #88).
	assert(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(JSON.stringify(row)));
});

Deno.test("engagement: each assignee reads '3 / 10' with a bar sized to the stage cap", () => {
	const ana = assigneeReadout(assignee(), 10);
	assertStrictEquals(ana.readout, "3 / 10");
	assertStrictEquals(ana.percent, 30);
	assertStrictEquals(ana.barLabel, "Ana Reyes: 3 of 10 workload on this stage");
	assertStrictEquals(ana.softCap, null);
	// A stage with no per-person cap has nothing to size a bar to.
	const uncapped = assigneeReadout(assignee({ stageWi: 2.5 }), null);
	assertStrictEquals(uncapped.readout, "2.5");
	assertStrictEquals(uncapped.percent, null);
	assertEquals(engagementRow(engagement({ stageCap: null })).meta[1], "no stage cap");
});

Deno.test("engagement: a member at or over the global soft cap is warned in words", () => {
	const at = assigneeReadout(assignee({ wi: 10, wiCap: 10 }), 10);
	assertStrictEquals(at.softCap, "At their workload cap — 10 / 10 across all work");
	const over = assigneeReadout(assignee({ wi: 12.25, wiCap: 10 }), 10);
	assertStrictEquals(over.softCap, "Over their workload cap — 12.25 / 10 across all work");
	assertStrictEquals(assigneeReadout(assignee({ wi: 9.99, wiCap: 10 }), 10).softCap, null);
	// The stage bar never draws an over-cap state — the database refuses one; the fill is clamped.
	assertStrictEquals(assigneeReadout(assignee({ stageWi: 11 }), 10).percent, 100);
});

Deno.test("engagement: a stage nobody holds a live ticket on says so instead of an empty stack", () => {
	const row = engagementRow(engagement({ assignees: [], stageWi: 0 }));
	assertEquals(row.faces, []);
	assertEquals(row.assignees, []);
	assertStrictEquals(row.idle, ENGAGEMENT_IDLE);
});

Deno.test("engagement: the status is the seat's lifecycle word, a held project wins, unknown is neutral", () => {
	assertEquals(engagementStatus({ assignmentStatus: "accepted", projectStatus: "active" }), {
		label: "Accepted",
		severity: "success",
	});
	assertEquals(engagementStatus({ assignmentStatus: "assigned", projectStatus: "active" }), {
		label: "Assigned",
		severity: "info",
	});
	assertEquals(engagementStatus({ assignmentStatus: "pending_funding", projectStatus: "active" }), {
		label: "Awaiting funding",
		severity: "warning",
	});
	assertEquals(engagementStatus({ assignmentStatus: "accepted", projectStatus: "on_hold" }), {
		label: "On hold",
		severity: "warning",
	});
	assertEquals(engagementStatus({ assignmentStatus: "something_new", projectStatus: "active" }), {
		label: "Seated",
		severity: "secondary",
	});
});

Deno.test("engagements: the summary counts stages and distinct projects; none says nothing", () => {
	assertEquals(engagementsSummary([]), []);
	assertEquals(engagementsSummary([engagement()]), ["1 stage", "1 project"]);
	assertEquals(
		engagementsSummary([
			engagement(),
			engagement({ stageSlug: "stg-second" }),
			engagement({ projectSlug: "prj-other", stageSlug: "stg-third" }),
		]),
		["3 stages", "2 projects"],
	);
});

Deno.test("formatting: Wᵢ figures drop trailing zeros; dates are UTC and locale-free", () => {
	assertStrictEquals(formatWi(3), "3");
	assertStrictEquals(formatWi(2.5), "2.5");
	assertStrictEquals(formatWi(7.256), "7.26");
	assertStrictEquals(formatWi(-1), "0");
	assertStrictEquals(formatWi(Number.NaN), "0");
	assertStrictEquals(utcWeekday("2026-10-19T00:00:00.000Z"), "Mon");
	assertStrictEquals(utcWeekday("not a date"), null);
	assertStrictEquals(utcDayMonth("2026-10-12T23:30:00.000Z"), "12 Oct");
});
// #endregion

// #region Proposals
Deno.test("proposals: the team's pending applications only, newest first", () => {
	const rows = teamProposals([
		sent({ id: "older", createdAt: "2026-10-10T10:00:00.000Z" }),
		sent({ id: "newer", createdAt: "2026-10-14T10:00:00.000Z" }),
		sent({ id: "answered", status: "rejected" }),
		sent({ id: "withdrawn", status: "withdrawn" }),
		sent({ id: "personal", applicantType: "freelancer", teamId: null, teamName: null }),
		sent({ id: "another-team", teamId: "0b7e3c11-5d2a-4f6e-8a1c-2e9f4b6d7a30" }),
	], TEAM);
	assertEquals(rows.map((r) => r.id), ["newer", "older"]);
	assertEquals(proposalsSummary(rows), ["2 awaiting a reply"]);
	assertEquals(proposalsSummary([]), []);
});

Deno.test("proposals: a row links the project, says stage · role · when, and asks the server about Withdraw", () => {
	const [row] = teamProposals([sent({ roleTitle: "Researcher" })], TEAM);
	assertStrictEquals(row.title, "Checkout rebuild");
	assertStrictEquals(row.href, "/projects/prj-abc123");
	assertEquals(row.meta, ["Discovery", "Researcher", "sent 12 Oct"]);
	assertStrictEquals(row.canWithdraw, true);
	// Neither the filer nor a bind_seat holder: the server says no, and no Withdraw is offered.
	assertStrictEquals(teamProposals([sent({ canWithdraw: false })], TEAM)[0].canWithdraw, false);
	// A stage the read could not name falls back to its slug.
	assertEquals(teamProposals([sent({ stageName: null })], TEAM)[0].meta[0], "stg-def456");
});

Deno.test("proposals: two proposals on one project get Withdraw names that tell them apart", () => {
	const rows = teamProposals([
		sent({ id: "a", stageName: "Discovery", createdAt: "2026-10-12T10:00:00.000Z" }),
		sent({ id: "b", stageName: "Build", createdAt: "2026-10-13T10:00:00.000Z" }),
	], TEAM);
	assertEquals(rows.map((r) => r.withdrawLabel), [
		"Withdraw the proposal for Checkout rebuild, Build, sent 13 Oct",
		"Withdraw the proposal for Checkout rebuild, Discovery, sent 12 Oct",
	]);
	const [withRole] = teamProposals([sent({ roleTitle: "Researcher" })], TEAM);
	assertStrictEquals(
		withRole.withdrawLabel,
		"Withdraw the proposal for Checkout rebuild, Discovery, Researcher, sent 12 Oct",
	);
});

Deno.test("proposals: after a withdrawal focus goes to the next Withdraw, else the previous, else none", () => {
	const rows = teamProposals([
		sent({ id: "1", createdAt: "2026-10-15T10:00:00.000Z" }),
		sent({ id: "2", createdAt: "2026-10-14T10:00:00.000Z", canWithdraw: false }),
		sent({ id: "3", createdAt: "2026-10-13T10:00:00.000Z" }),
		sent({ id: "4", createdAt: "2026-10-12T10:00:00.000Z" }),
	], TEAM);
	assertEquals(rows.map((r) => r.id), ["1", "2", "3", "4"]);
	// The next row that has a Withdraw — a row the viewer may not withdraw is skipped.
	assertStrictEquals(focusAfterWithdraw(rows, "1"), "3");
	assertStrictEquals(focusAfterWithdraw(rows, "3"), "4");
	// The last one falls back to the previous row with a Withdraw.
	assertStrictEquals(focusAfterWithdraw(rows, "4"), "3");
	// Nothing left to take it — the list's heading does (the island's fallback).
	assertStrictEquals(focusAfterWithdraw(rows.slice(0, 1), "1"), null);
	assertStrictEquals(focusAfterWithdraw(rows, "missing"), null);
});

Deno.test("proposals: the Withdraw confirm names no pool owner while #154 (b) is open", () => {
	const message = withdrawConfirmMessage({ title: "Checkout rebuild" });
	assertStrictEquals(
		message,
		"Checkout rebuild — one proposal returns to this week's allowance. The anti-burst token does not come back, so applying again spends one.",
	);
	assert(!/'s weekly allowance|team's|members'|pool/i.test(message), message);
});
// #endregion

// #region The screen and the dispatcher — source scans
/*
 * The island cannot be rendered under `deno test` (every `@projective/ui` component imports CSS), so
 * these read its source: what it fills, what it withdraws with, and that the dispatcher reaches it.
 */
function source(file: string): string {
	return Deno.readTextFileSync(new URL(file, import.meta.url))
		.replaceAll("\r\n", "\n")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|\s)\/\/.*$/gm, "$1");
}

const SCREEN = source("../islands/TeamProjectsScreen.island.tsx");
const DISPATCH = source("../components/ModuleScreen.tsx");

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

Deno.test("projects module: a team's renders TeamProjectsScreen, never ModulePlaceholder", () => {
	const at = DISPATCH.indexOf('case "projects":');
	assert(at >= 0, "the dispatcher has no projects case");
	const block = DISPATCH.slice(at, DISPATCH.indexOf("case ", at + 10));
	const team = block.slice(0, block.indexOf("return (\n"));
	assert(/if \(ws\.kind === "team"\) \{\s*return <TeamProjectsScreen\b/.test(team), block);
	assert(!/ModulePlaceholder/.test(team), "the team branch still reaches ModulePlaceholder");
});

Deno.test("projects screen: one filled control — the structural Invite member; Withdraw is tier 5", () => {
	const buttons = buttonElements(SCREEN);
	const filled = buttons.filter((b) => !/\bvariant="(outlined|text|link)"/.test(b));
	assertEquals(filled.length, 1, `filled Buttons: ${filled.join("\n")}`);
	assert(/\bstructural\b/.test(filled[0]), "the fill is not the tier-2 structural tone");
	assert(/onClick=\{onInvite\}/.test(filled[0]), "the fill is not Invite member");
	const withdraw = buttons.find((b) => /label="Withdraw"/.test(b));
	assert(withdraw && /variant="text"/.test(withdraw), "Withdraw is not a tier-5 text Button");
	assert(/\{row\.canWithdraw && \(/.test(SCREEN), "Withdraw is not gated on the server's answer");
	assert(/<ConfirmDialog\b[\s\S]*?acceptSeverity="danger"/.test(SCREEN), "no danger confirm");
});

Deno.test("projects screen: it is the header band tabs' panel and reads the shared sub-view", () => {
	assert(/subViewsFor\("projects", ws\.kind, ws\.viewerCapabilities\)/.test(SCREEN));
	assert(/id: SUB_VIEW_PANEL_ID,\s*role: "tabpanel"/.test(SCREEN));
	assert(/viewOr\(props\.view \?\? null\)/.test(SCREEN));
	assert(!/selectModuleView|<TabMenu\b/.test(SCREEN), "the body draws or writes its own tabs");
	assert(!/style=/.test(SCREEN), "an inline style");
});

Deno.test("projects screen: Withdraw is named per row, confirmed owner-neutrally, and keeps focus", () => {
	assert(/aria-label=\{row\.withdrawLabel\}/.test(SCREEN), "Withdraw's name is not the row's own");
	assert(/message=\{withdrawFor\.value \? withdrawConfirmMessage\(/.test(SCREEN));
	assert(!/weekly allowance/.test(SCREEN), "the confirm's sentence is written in the island");
	// Focus is placed after a refusal and after a landed withdrawal, never left on the body.
	assertEquals(SCREEN.match(/focusWhenLive\(/g)?.length, 3, "focusWhenLive is not called twice");
	assert(/focusAfterWithdraw\(before, row\.id\)/.test(SCREEN));
	assert(/id=\{PROPOSALS_TITLE_ID\} tabIndex=\{-1\}/.test(SCREEN), "the heading cannot take focus");
	assert(/data-proposal=\{row\.id\}/.test(SCREEN));
});

Deno.test("engagement row: each row is named by its project AND its stage", () => {
	const row = source("../components/EngagementRow.tsx");
	assert(
		/aria-labelledby=\{`\$\{titleId\} \$\{stageId\}`\}/.test(row),
		"the row is named by its project only",
	);
	assert(/class="wsp-engagement__stage" id=\{stageId\}/.test(row));
});

Deno.test("projects sheet: no rule styles a class nothing renders", () => {
	const sheet = Deno.readTextFileSync(
		new URL("../styles/workspace-projects.css", import.meta.url),
	).replace(/\/\*[\s\S]*?\*\//g, "");
	const rendered = SCREEN + source("../components/EngagementRow.tsx");
	const classes = new Set([...sheet.matchAll(/\.(wsp-[a-z0-9_-]+)/g)].map((m) => m[1]));
	for (const name of classes) {
		// `wsp-band…` is the console sheet's family, drawn here and on every module.
		if (name.startsWith("wsp-band")) continue;
		assert(rendered.includes(name), `.${name} is styled but never rendered`);
	}
});

Deno.test("projects screen: its regions are grouped (§7)", () => {
	const raw = Deno.readTextFileSync(
		new URL("../islands/TeamProjectsScreen.island.tsx", import.meta.url),
	);
	const opened = raw.match(/#region\b/g)?.length ?? 0;
	assert(opened >= 6, `only ${opened} regions`);
	assertEquals(opened, raw.match(/#endregion\b/g)?.length);
});
// #endregion
