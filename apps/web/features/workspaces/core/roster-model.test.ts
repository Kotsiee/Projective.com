import { assert, assertEquals } from "@std/assert";
import type { WorkspaceKind, WorkspaceSummary } from "@projective/types/workspace";
import {
	BUSINESS_ROSTER_COLUMNS,
	cardFigure,
	cardMeta,
	cardPeople,
	countLabel,
	filledCount,
	filterRoster,
	isFiltered,
	isFirstRun,
	lifecycleTag,
	ROSTER_COLUMNS,
	ROSTER_TABS,
	rosterCanvasControls,
	type RosterCanvasInput,
	type RosterCanvasState,
	rosterCanvasState,
	rosterColumns,
	rosterCountLine,
	rosterEmptyCopy,
	rosterFirstRunCopy,
	rosterHeadMeta,
	rosterHref,
	rosterSearch,
	rosterSpent,
	type RosterTab,
	rosterTabBadge,
	rosterTabCounts,
	rosterTabFromSearch,
	rosterTabIndex,
	rosterToolsShown,
	rosterTrackWidth,
	setupPercent,
	setupUnfinished,
	spentSortValue,
	statusSortValue,
	statusTag,
	toRosterTab,
} from "./roster-model.ts";
import { rigFilledCount, rigModel } from "./rig-model.ts";
import { filledAcceptCount, planInviteActions } from "./invitation-strip-model.ts";
import { sortRowsBy } from "@ui/display/core/table-sort.ts";
import { importWithoutGlyphs } from "./registry-import.testing.ts";

/**
 * The roster canvas (Teams work order R1), pinned at the pure model the island, its cards and its
 * table bind: the partitions and the address that remembers them, the five canvas states, the
 * controls each state draws at their Button-matrix tiers — and, composed with the lane's footer, the
 * footer rig and the invitation strip, exactly ONE filled control on the page in first run,
 * populated, empty and error while no invitation waits, and one per decision region once one does
 * (Decision #245 (j)), beside the lane or its rail and with the lane off-canvas (#245 (k)) — the head's facts, each card's facts as metadata (never chips), and the
 * table's column contract.
 */

// #region Fixtures
function summary(overrides: Partial<WorkspaceSummary> = {}): WorkspaceSummary {
	return {
		id: "w-1",
		kind: "team",
		name: "North Loop",
		handle: "north-loop",
		avatar: "",
		status: "active",
		verification: "verified",
		role: "owner",
		isOwner: true,
		memberCount: 4,
		activeProjects: 2,
		faces: [],
		stats: [
			{ label: "Members", value: "4", delta: null },
			{ label: "Active projects", value: "2", delta: null },
			{ label: "Earned (30d)", value: "US$28,500.00", delta: null },
		],
		money30d: [],
		updatedAt: "2026-10-12T09:00:00.000Z",
		hasUpdate: false,
		isActing: false,
		tagline: "Brand systems for climate start-ups",
		setupProgress: 1,
		...overrides,
	};
}

function canvas(overrides: Partial<RosterCanvasInput> = {}): RosterCanvasInput {
	return {
		loaded: true,
		entityCount: 3,
		invitationCount: 0,
		rowCount: 3,
		stripIsTheList: false,
		...overrides,
	};
}

const KINDS: readonly WorkspaceKind[] = ["team", "business"];
const TABS: readonly RosterTab[] = ["all", "owned", "member", "invitations", "archived"];

/** The lane model reaches the module registry, whose glyphs import CSS — load it glyph-free. */
interface LaneApi {
	laneZones(input: {
		view: "roster";
		kind: WorkspaceKind;
		liveCount: number;
		invitationCount: number;
		canCreate: boolean;
		createBlockedReason?: string | null;
		firstRun?: boolean;
	}): { footer: { create: { action: string; label: string } | null; note: string | null } };
	ROSTER_PARTITIONS: readonly { value: string; label: string }[];
	statusTag(status: string): { label: string; severity: string };
}
const lane = await importWithoutGlyphs<LaneApi>("./lane-model.ts");
// #endregion

// #region Partitions
Deno.test("roster: the canvas partitions are All · Owned · Member · Invitations · Archived", () => {
	assertEquals(ROSTER_TABS.map((t) => t.label), [
		"All",
		"Owned",
		"Member",
		"Invitations",
		"Archived",
	]);
	assertEquals(ROSTER_TABS.map((t) => t.value), TABS);
	// The lane offers the same words over the same partition, minus the canvas-only Archived.
	assertEquals(lane.ROSTER_PARTITIONS, ROSTER_TABS.filter((t) => t.value !== "archived"));
});

Deno.test("roster: a raw value coerces to a partition, and every partition has its own index", () => {
	assertEquals(toRosterTab("owned"), "owned");
	for (const raw of [null, undefined, "", "Owned", "teams", "member of"]) {
		assertEquals(toRosterTab(raw), "all");
	}
	assertEquals(TABS.map(rosterTabIndex), [0, 1, 2, 3, 4]);
});

Deno.test("roster: archived entities appear only under Archived; Invitations lists no entities", () => {
	const items = [
		summary({ id: "a", name: "Atlas", isOwner: true }),
		summary({ id: "b", name: "Birch", isOwner: false, role: "member" }),
		summary({ id: "c", name: "Cove", status: "archived" }),
		summary({ id: "d", name: "Dune", status: "draft", isOwner: false, role: "lead" }),
	];
	const ids = (tab: RosterTab, search = "") => filterRoster(items, tab, search).map((i) => i.id);
	assertEquals(ids("all"), ["a", "b", "d"]);
	assertEquals(ids("owned"), ["a"]);
	assertEquals(ids("member"), ["b", "d"]);
	assertEquals(ids("archived"), ["c"]);
	assertEquals(ids("invitations"), []);
	assertEquals(ids("all", "  BIR "), ["b"]);
	assertEquals(rosterTabCounts(items, [{ id: "i-1" }]), {
		all: 3,
		owned: 1,
		member: 2,
		invitations: 1,
		archived: 1,
	});
});

Deno.test("roster: every partition carries its count Badge, an empty one none", () => {
	const counts = { all: 3, owned: 1, member: 2, invitations: 1, archived: 0 };
	assertEquals(
		TABS.map((tab) => rosterTabBadge(tab, counts)),
		[3, 1, 2, 1, undefined],
	);
});

Deno.test("roster: only a partition or a search term counts as filtered", () => {
	assertEquals(isFiltered("all", ""), false);
	assertEquals(isFiltered("all", "   "), false);
	assertEquals(isFiltered("archived", ""), true);
	assertEquals(isFiltered("all", "nor"), true);
});
// #endregion

// #region The address
Deno.test("roster: the address reads ?view=, falls back to the pre-R1 ?tab=, else All", () => {
	const read = (search: string) => rosterTabFromSearch(new URLSearchParams(search));
	assertEquals(read("?view=archived"), "archived");
	assertEquals(read("?tab=owned"), "owned");
	assertEquals(read("?view=member&tab=owned"), "member");
	assertEquals(read("?view=nonsense"), "all");
	assertEquals(read(""), "all");
});

Deno.test("roster: the address writes ?view= and ?q=, drops the flash and the legacy key, keeps the rest", () => {
	assertEquals(rosterSearch("", "all", ""), "");
	assertEquals(rosterSearch("", "archived", ""), "?view=archived");
	assertEquals(rosterSearch("?view=owned", "all", ""), "");
	assertEquals(rosterSearch("", "owned", "  north loop "), "?view=owned&q=north+loop");
	// The one-shot notice and the pre-R1 ?tab= never survive a write.
	assertEquals(rosterSearch("?notice=unavailable", "all", ""), "");
	assertEquals(rosterSearch("?tab=archived&notice=unavailable", "archived", ""), "?view=archived");
	// Anything else on the address is someone else's, and stays.
	assertEquals(rosterSearch("?ref=mail&q=old", "member", ""), "?ref=mail&view=member");
	// Idempotent: writing what is there changes nothing, so the effect never loops.
	const once = rosterSearch("?x=1", "owned", "atlas");
	assertEquals(rosterSearch(once, "owned", "atlas"), once);
});

Deno.test("roster: a partition's address on either kind", () => {
	assertEquals(rosterHref("team", "archived"), "/teams?view=archived");
	assertEquals(rosterHref("business"), "/businesses");
});
// #endregion

// #region Lifecycle
Deno.test("roster: a lifecycle Tag only for an entity that is not active", () => {
	assertEquals(lifecycleTag("active"), null);
	assertEquals(lifecycleTag("draft"), { label: "Draft", severity: "warning" });
	assertEquals(lifecycleTag("archived"), { label: "Archived", severity: "secondary" });
	// The console's header strip names every state, from the same vocabulary.
	for (const status of ["draft", "active", "archived"] as const) {
		assertEquals(lane.statusTag(status), statusTag(status));
	}
	assertEquals(statusTag("active"), { label: "Active", severity: "success" });
});
// #endregion

// #region Canvas states
Deno.test("roster: nothing loaded is the error state, whatever else is true", () => {
	assertEquals(rosterCanvasState(canvas({ loaded: false })), "error");
	assertEquals(rosterCanvasState(canvas({ loaded: false, entityCount: 0, rowCount: 0 })), "error");
	assertEquals(isFirstRun({ loaded: false, entityCount: 0, invitationCount: 0 }), false);
});

Deno.test("roster: first run is a successful read with no entity at all and nothing to answer", () => {
	const empty = canvas({ entityCount: 0, rowCount: 0 });
	assertEquals(rosterCanvasState(empty), "first-run");
	// An archived entity, or one invitation, is not a first run: the reader has history here.
	assertEquals(rosterCanvasState({ ...empty, entityCount: 1 }), "empty");
	assertEquals(rosterCanvasState({ ...empty, invitationCount: 1 }), "empty");
	// The strip on Invitations is the list.
	assertEquals(
		rosterCanvasState({ ...empty, invitationCount: 1, stripIsTheList: true }),
		"invitations",
	);
});

Deno.test("roster: a partition that leaves nothing is empty, rows are populated", () => {
	assertEquals(rosterCanvasState(canvas({ rowCount: 0 })), "empty");
	assertEquals(rosterCanvasState(canvas()), "populated");
});

Deno.test("roster: the search and the TabMenu are drawn only when there is something to filter", () => {
	const shown = (["error", "first-run", "invitations", "empty", "populated"] as const)
		.filter(rosterToolsShown);
	assertEquals(shown, ["invitations", "empty", "populated"]);
});
// #endregion

// #region Controls — one filled control on the page
Deno.test("roster: each state's canvas controls, at their tiers", () => {
	const controls = (
		state: RosterCanvasState,
		extra: { canCreate?: boolean; filtered?: boolean; readError?: boolean } = {},
	) =>
		rosterCanvasControls({
			kind: "team",
			state,
			canCreate: extra.canCreate ?? true,
			filtered: extra.filtered ?? false,
			readError: extra.readError ?? false,
		}).map((c) => [c.key, c.label, c.tier]);
	assertEquals(controls("first-run"), [["create", "Create a team", 2]]);
	assertEquals(controls("first-run", { canCreate: false }), []);
	assertEquals(controls("populated"), []);
	assertEquals(controls("empty", { filtered: true }), [["clear", "Clear filters", 5]]);
	assertEquals(controls("empty", { filtered: false }), []);
	assertEquals(controls("error", { readError: true }), [["retry", "Try again", 4]]);
	// A refresh that failed over a loaded roster keeps the roster and offers the retry beside it.
	assertEquals(controls("populated", { readError: true }), [["retry", "Try again", 4]]);
	assertEquals(
		rosterCanvasControls({
			kind: "business",
			state: "first-run",
			canCreate: true,
			filtered: false,
			readError: false,
		})[0].label,
		"Create a business",
	);
});

Deno.test("roster: one filled control per decision region in every state, beside the lane and without it — one on the page until an invitation waits — and one create in first run", () => {
	type Scene = {
		state: RosterCanvasState;
		/** What the lane's SSR roster would hold; `null` when the read failed and the lane got none. */
		lane: { entities: number; invitations: number } | null;
		filtered: boolean;
		readError: boolean;
		/** Rows the invitation strip draws — its own decision region (#253, TEAMS_AUDIT D25). */
		invites: number;
	};
	const scenes: Scene[] = [
		{
			state: "first-run",
			lane: { entities: 0, invitations: 0 },
			filtered: false,
			readError: false,
			invites: 0,
		},
		{
			state: "populated",
			lane: { entities: 3, invitations: 0 },
			filtered: false,
			readError: false,
			invites: 0,
		},
		{
			state: "populated",
			lane: { entities: 3, invitations: 0 },
			filtered: false,
			readError: true,
			invites: 0,
		},
		{
			state: "empty",
			lane: { entities: 3, invitations: 0 },
			filtered: true,
			readError: false,
			invites: 0,
		},
		{ state: "error", lane: null, filtered: false, readError: true, invites: 0 },
		// An invitation and no entity: the strip IS the list.
		{
			state: "invitations",
			lane: { entities: 0, invitations: 2 },
			filtered: false,
			readError: false,
			invites: 2,
		},
		// An invitation over a roster: the strip sits above the list.
		{
			state: "populated",
			lane: { entities: 3, invitations: 1 },
			filtered: false,
			readError: false,
			invites: 1,
		},
	];
	const REASON = "Your plan includes 1 team — archive one or upgrade to create another.";
	for (const kind of KINDS) {
		for (const canCreate of [true, false]) {
			// Below --bp-md the frame hides the lane, and the rig takes over its create or its reason; the
			// collapsed rail keeps the create and leaves the reason to the rig (Decision #245 (k)).
			for (const place of ["expanded", "rail", "off-canvas"] as const) {
				for (const scene of scenes) {
					// A failed read leaves the chrome without the plan's answer, so the lane and the rig offer
					// the create (the server re-checks it on submit) — the slots' own fallback.
					const chromeCanCreate = scene.lane ? canCreate : true;
					const canvasFills = filledCount(
						rosterCanvasControls({
							kind,
							state: scene.state,
							canCreate,
							filtered: scene.filtered,
							readError: scene.readError,
						}),
					);
					// The lane reads the same first-run rule over its own roster (none when the read failed).
					const firstRun = scene.lane
						? isFirstRun({
							loaded: true,
							entityCount: scene.lane.entities,
							invitationCount: scene.lane.invitations,
						})
						: false;
					const laneFooter = lane.laneZones({
						view: "roster",
						kind,
						liveCount: scene.lane?.entities ?? 0,
						invitationCount: scene.lane?.invitations ?? 0,
						canCreate: chromeCanCreate,
						createBlockedReason: chromeCanCreate ? null : REASON,
						firstRun,
					}).footer;
					// What the reader sees of the lane: the rail draws its create but no reason
					// (`WorkspaceRail`), and nothing is left once the frame hides it.
					const laneCreate = place === "off-canvas" ? null : laneFooter.create;
					const laneNote = place === "expanded" ? laneFooter.note : null;
					const laneFills = laneCreate ? 1 : 0; // LaneCreateButton is tier 2 — filled
					// The footer band's rig reads the same first-run rule (the slot's SSR read, then the
					// canvas's published reading).
					const rig = rigModel({
						kind,
						handle: null,
						module: null,
						view: null,
						canCreate: chromeCanCreate,
						createBlockedReason: chromeCanCreate ? null : REASON,
						firstRun,
						lane: place,
						canInvite: false,
						canManageMoney: false,
						canManageSettings: false,
						canEditProfile: false,
						dirty: false,
						saveState: "idle",
					});
					const rigFills = rigFilledCount(rig);
					const stripFills = filledAcceptCount(
						planInviteActions(
							Array.from({ length: scene.invites }, (_, i) => ({ id: `inv-${i}` })),
						),
					);
					const total = canvasFills + stripFills + laneFills + rigFills;
					const where =
						`${kind} ${scene.state} canCreate=${canCreate} readError=${scene.readError} invites=${scene.invites} lane=${place}`;
					// Each decision region holds at most one fill (§B.8.1): the canvas with its strip, and the
					// chrome — the lane's footer and the footer band's rig.
					assert(canvasFills + stripFills <= 1, `the canvas holds two fills: ${where}`);
					assert(laneFills + rigFills <= 1, `the chrome holds two fills: ${where}`);
					if (scene.invites === 0) {
						// A plan that admits no entity draws no create anywhere; otherwise exactly one fills.
						assertEquals(total, chromeCanCreate ? 1 : 0, where);
					} else {
						// An invitation waiting: the strip's tier-3 Accept AND the lane's tier-2 create — one per
						// region, two on the page. Measured on noor's page; left to the owner, Decision #245 (j).
						assertEquals(stripFills, 1, where);
						assertEquals(total, 1 + (chromeCanCreate ? 1 : 0), where);
					}
					// Outside first run the chrome's fill is the lane's (or its rail's) beside it and the rig's
					// without it, never both, and never neither while the plan admits one.
					if (scene.state !== "first-run") {
						const bare = place === "off-canvas";
						assertEquals(laneFills, !bare && chromeCanCreate ? 1 : 0, where);
						assertEquals(rigFills, bare && chromeCanCreate ? 1 : 0, where);
					}
					// A plan that refuses the create says why exactly once on screen: the lane's line beside
					// the expanded lane, the rig's same line beside the rail or without the lane — the
					// canvas's empty state in first run.
					const notes = [laneNote, rig.note].filter((n) => n !== null);
					if (!chromeCanCreate && scene.state !== "first-run") {
						assertEquals(notes, [REASON], where);
					} else {
						assertEquals(notes, [], where);
					}
					// In first run the one fill is the canvas's, never the lane's — and it is the page's ONLY
					// create at any tier: the rig's New is withheld too, in either layout.
					if (scene.state === "first-run") {
						assertEquals(laneFills, 0, where);
						const creates = rosterCanvasControls({
							kind,
							state: scene.state,
							canCreate,
							filtered: scene.filtered,
							readError: scene.readError,
						}).filter((c) => c.key === "create").length +
							(laneCreate ? 1 : 0) +
							rig.actions.filter((a) => a.key === "create").length;
						assertEquals(creates, canCreate ? 1 : 0, where);
					}
				}
			}
		}
	}
});
// #endregion

// #region Copy
Deno.test("roster: first run sells in one sentence from PRODUCT_SPEC, per kind", () => {
	const team = rosterFirstRunCopy("team");
	assertEquals(team.title, "Start a team");
	assertEquals(team.action, "Create a team");
	assert(team.description.includes("without setting up a legal entity or a joint bank account"));
	assertEquals(team.description.split(/[.!?](\s|$)/).filter((s) => s.trim()).length, 1);
	const business = rosterFirstRunCopy("business");
	// The business keeps its own wording — it hires, where a team delivers (BU1 builds on it).
	assertEquals(business.title, "Hire as a company");
	assertEquals(business.action, "Create a business");
	assert(business.description.includes("employer of record"));
	// The plan's reason follows the sentence when the create is withheld; a blank one adds nothing.
	const reason = "Your plan includes 1 team — archive one or upgrade to create another.";
	assertEquals(rosterFirstRunCopy("team", reason).description, `${team.description} ${reason}`);
	assertEquals(rosterFirstRunCopy("team", "  ").description, team.description);
});

Deno.test("roster: a business's first run lists three plain points; a team's lists none (BU1)", () => {
	assertEquals(rosterFirstRunCopy("team").points, undefined);
	const points = rosterFirstRunCopy("business").points ?? [];
	assertEquals(points.length, 3);
	for (const point of points) {
		// One sentence each — body text, never a fragment or a paragraph.
		assertEquals(point.split(/[.!?](\s|$)/).filter((s) => s.trim()).length, 1, point);
		assert(point.endsWith("."), `a point is not a sentence: ${point}`);
		// Plain words: no platform jargon in a pitch to somebody who has never made one.
		assert(!/escrow/i.test(point), `a point says "escrow": ${point}`);
	}
	// No point claims what a free business lacks. Caps and the approval threshold are Business Pro
	// (#230 (e)): a point that names them names the plan. Hiring is a permission the Member preset
	// does not hold and a free business caps its managers, so no point gives it to "everyone".
	for (const point of points) {
		if (/limit|cap\b|approv|how much/i.test(point)) {
			assert(
				point.includes("Business Pro"),
				`a point promises Pro governance to a free business: ${point}`,
			);
		}
		assert(
			!/whole staff|everyone|every member|all your/i.test(point),
			`a point promises every member a right the plan or the role withholds: ${point}`,
		);
	}
	assert(points[2].includes("Business Pro"), points[2]);
	// A withheld create keeps the points and still appends the plan's reason to the sentence.
	const reason = "Your plan includes no business — upgrade to create one.";
	const blocked = rosterFirstRunCopy("business", reason);
	assertEquals(blocked.points, points);
	assertEquals(blocked.description, `${rosterFirstRunCopy("business").description} ${reason}`);
	// The points are body text, so the first run still draws exactly one filled control.
	const controls = rosterCanvasControls({
		kind: "business",
		state: "first-run",
		canCreate: true,
		filtered: false,
		readError: false,
	});
	assertEquals(controls.map((c) => [c.label, c.tier]), [["Create a business", 2]]);
	assertEquals(filledCount(controls), 1);
});

Deno.test("roster: an empty partition explains itself, offers Clear only when filtered, never a create", () => {
	const copy = (tab: RosterTab, search = "", archivedCount = 0, kind: WorkspaceKind = "team") =>
		rosterEmptyCopy(kind, { tab, search, archivedCount, stripShown: true });
	assertEquals(copy("all", "zz").title, "Nothing matches that");
	assertEquals(copy("all", "zz").clear, true);
	assertEquals(copy("owned").clear, true);
	assertEquals(copy("archived").title, "Nothing archived");
	assertEquals(copy("all", "", 2), {
		title: "No active teams",
		description: "Your archived teams are under Archived.",
		clear: false,
	});
	assertEquals(copy("all").clear, false);
	assertEquals(
		copy("member", "", 0, "business").title,
		"You're not a member of anyone else's business",
	);
	for (const tab of TABS) {
		assert(!/\bcreate\b/i.test(copy(tab).title), `${tab} sells a create`);
	}
});

Deno.test("roster: an empty All points up at the strip only while the strip is there", () => {
	// No entity, an invitation waiting (so not first run), nothing archived.
	const all = (stripShown: boolean, kind: WorkspaceKind = "team") =>
		rosterEmptyCopy(kind, { tab: "all", search: "", archivedCount: 0, stripShown });
	assertEquals(all(true), {
		title: "You're not in a team yet",
		description: "Answer an invitation above to join one.",
		clear: false,
	});
	// Dismissed off the Invitations tab: nothing is above, so it names where the invitations are.
	assertEquals(all(false), {
		title: "You're not in a team yet",
		description: "Your invitations are under Invitations.",
		clear: false,
	});
	assert(!/\babove\b/.test(all(false, "business").description));
	// Archived entities keep their own pointer, whether or not the strip is up.
	assertEquals(
		rosterEmptyCopy("team", { tab: "all", search: "", archivedCount: 1, stripShown: false })
			.description,
		"Your archived teams are under Archived.",
	);
});
// #endregion

// #region The head and the count line
Deno.test("roster: the head says the count, the invitations waiting and who is being acted as", () => {
	const head = (
		state: RosterCanvasState,
		extra: Partial<Parameters<typeof rosterHeadMeta>[1]> = {},
	) =>
		rosterHeadMeta("team", {
			state,
			liveCount: 3,
			invitationCount: 0,
			actingName: null,
			...extra,
		});
	assertEquals(head("populated"), [{ text: "3 teams", tabular: true }]);
	assertEquals(head("populated", { liveCount: 1, invitationCount: 2, actingName: "Atlas" }), [
		{ text: "1 team", tabular: true },
		{ text: "2 invitations waiting", tabular: true },
		"Acting as Atlas",
	]);
	assertEquals(head("populated", { invitationCount: 1 })[1], {
		text: "1 invitation waiting",
		tabular: true,
	});
	// First run and a failed read say nothing in the head: the body says it.
	assertEquals(head("first-run"), []);
	assertEquals(head("error"), []);
	assertEquals(countLabel("business", 2), "2 businesses");
});

Deno.test("roster: the live count speaks only over a narrowed, populated roster", () => {
	const line = (state: RosterCanvasState, tab: RosterTab, search: string, rowCount: number) =>
		rosterCountLine("team", { state, tab, search, rowCount });
	assertEquals(line("populated", "all", "", 3), "");
	assertEquals(line("populated", "owned", "", 1), "1 team");
	assertEquals(line("populated", "all", "nor", 2), "2 teams matching");
	assertEquals(line("empty", "owned", "", 0), "");
	assertEquals(line("invitations", "invitations", "", 0), "");
});
// #endregion

// #region The card
Deno.test("roster: a card's facts are ONE meta line — role · members · live projects — counts tabular", () => {
	assertEquals(cardMeta(summary()), [
		"Owner",
		{ text: "4 members", tabular: true },
		{ text: "2 live projects", tabular: true },
	]);
	assertEquals(
		cardMeta(summary({ role: "lead", memberCount: 1, activeProjects: 1, isActing: true })),
		[
			"Lead",
			{ text: "1 member", tabular: true },
			{ text: "1 live project", tabular: true },
			"Acting",
		],
	);
	assertEquals(cardMeta(summary({ activeProjects: 0 }))[2], {
		text: "0 live projects",
		tabular: true,
	});
});

Deno.test("roster: the card's figure is the kind's money stat, verbatim", () => {
	assertEquals(cardFigure(summary()), {
		label: "Earned (30d)",
		value: "US$28,500.00",
		delta: null,
	});
	assertEquals(cardFigure(summary({ stats: [] })), null);
});

Deno.test("roster: the card's faces are the server's sample, its +N the rest of the membership", () => {
	const face = (name: string, avatar = "") => ({ handle: name.toLowerCase(), name, avatar });
	assertEquals(cardPeople(summary({ faces: [] })), null);
	assertEquals(
		cardPeople(summary({
			memberCount: 3,
			faces: [face("Ada", "https://cdn.test/ada.webp"), face("Ben"), face("Cy")],
		})),
		{
			people: [
				{ name: "Ada", avatar: "https://cdn.test/ada.webp" },
				{ name: "Ben", avatar: null },
				{ name: "Cy", avatar: null },
			],
			total: 3,
			label: "3 members: Ada, Ben, Cy",
		},
	);
	const sample = cardPeople(summary({
		memberCount: 12,
		faces: ["Ada", "Ben", "Cy", "Dee", "Eve"].map((n) => face(n)),
	}));
	assertEquals(sample?.total, 12);
	assertEquals(sample?.people.length, 5);
	assertEquals(sample?.label, "5 of 12 members: Ada, Ben, Cy, Dee, Eve");
	// A stale count never draws fewer than the faces in hand.
	assertEquals(
		cardPeople(summary({ memberCount: 0, faces: [face("Ada")] }))?.label,
		"1 member: Ada",
	);
});

Deno.test("roster: the setup meter shows a whole percentage and leaves at 100%", () => {
	assertEquals(setupPercent(0.6), 60);
	assertEquals(setupPercent(1.4), 100);
	assertEquals(setupPercent(-1), 0);
	assertEquals(setupUnfinished(0.995), false);
	assertEquals(setupUnfinished(0.6), true);
});

Deno.test("roster: a grid track is the zoom's width while two fit, and the whole row once they do not", () => {
	assertEquals(
		rosterTrackWidth(278.4),
		"clamp(278px, calc((556px + var(--space-4) - 100%) * 100000), 100%)",
	);
	assertEquals(
		rosterTrackWidth(-4),
		"clamp(0px, calc((0px + var(--space-4) - 100%) * 100000), 100%)",
	);
});
// #endregion

// #region The table
Deno.test("roster: the table is Name · Your role · Members · Live projects · Status · Updated", () => {
	assertEquals(ROSTER_COLUMNS.map((c) => c.header), [
		"Name",
		"Your role",
		"Members",
		"Live projects",
		"Status",
		"Updated",
	]);
	// Counts right-aligned (tabular in the DataTable's number cells); everything else starts.
	assertEquals(
		ROSTER_COLUMNS.filter((c) => c.align === "end").map((c) => c.id),
		["members", "projects"],
	);
});

Deno.test("roster: a narrowing table hides Updated first, the counts last, Name and Status never", () => {
	// The DataTable hides the LOWEST priority first; an unset priority never hides.
	const hideOrder = ROSTER_COLUMNS.filter((c) => c.priority !== undefined)
		.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
		.map((c) => c.id);
	assertEquals(hideOrder, ["updated", "role", "projects", "members"]);
	const never = ROSTER_COLUMNS.filter((c) => c.priority === undefined).map((c) => c.id);
	// The lifecycle Tag stays on screen at every width.
	assertEquals(never, ["name", "status"]);
});

Deno.test("roster: status sorts in lifecycle order, not the alphabet", () => {
	const order = (["archived", "active", "draft"] as const).slice()
		.sort((a, b) => statusSortValue(a) - statusSortValue(b));
	assertEquals(order, ["draft", "active", "archived"]);
});

Deno.test("roster: a business's table adds Spent (30d) before Status; a team's is unchanged (BU1)", () => {
	assertEquals(rosterColumns("team"), ROSTER_COLUMNS);
	assertEquals(rosterColumns("business"), BUSINESS_ROSTER_COLUMNS);
	assertEquals(BUSINESS_ROSTER_COLUMNS.map((c) => c.header), [
		"Name",
		"Your role",
		"Members",
		"Live projects",
		"Spent (30d)",
		"Status",
		"Updated",
	]);
	// Money sits right-aligned with the counts, in tabular figures.
	assertEquals(
		BUSINESS_ROSTER_COLUMNS.filter((c) => c.align === "end").map((c) => c.id),
		["members", "projects", "spent"],
	);
	assert(!ROSTER_COLUMNS.some((c) => c.id === "spent"), "a team's table has no Spent column");
});

Deno.test("roster: a narrowing business table keeps Spent longest, Name and Status never hide", () => {
	const hideOrder = BUSINESS_ROSTER_COLUMNS.filter((c) => c.priority !== undefined)
		.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
		.map((c) => c.id);
	assertEquals(hideOrder, ["updated", "role", "projects", "members", "spent"]);
	assertEquals(
		BUSINESS_ROSTER_COLUMNS.filter((c) => c.priority === undefined).map((c) => c.id),
		["name", "status"],
	);
});

Deno.test("roster: Spent (30d) is the server's figures in its order, or nothing when nothing moved", () => {
	const usd = { minor: 1_250_000, currency: "USD", display: "US$12,500.00", origin: null };
	const gbp = { minor: 40_000, currency: "GBP", display: "£400.00", origin: null };
	assertEquals(rosterSpent(summary({ money30d: [] })), null);
	assertEquals(rosterSpent(summary({ money30d: [usd] })), [usd]);
	// Several currencies stay several figures, in the server's (largest-first) order — never summed.
	assertEquals(rosterSpent(summary({ money30d: [usd, gbp] })), [usd, gbp]);
});

Deno.test("roster: Spent sorts by amount within a currency, claims no rank across currencies, and an empty cell sorts last", () => {
	const jpy = { minor: 90_000, currency: "JPY", display: "¥90,000", origin: null };
	const usd = { minor: 100_000, currency: "USD", display: "US$1,000.00", origin: null };
	const usd99 = { minor: 99_999, currency: "USD", display: "US$999.99", origin: null };
	const usdBig = { minor: 250_000, currency: "USD", display: "US$2,500.00", origin: null };
	// The key is the cell's lead figure, its currency first: no rate, so no cross-currency magnitude.
	assertEquals(spentSortValue(summary({ money30d: [jpy] })), "JPY 90000");
	assertEquals(spentSortValue(summary({ money30d: [usd, jpy] })), "USD 100000");
	// Nothing to show — nothing moved, or the figure was withheld — is no key at all.
	assertEquals(spentSortValue(summary({ money30d: [] })), null);
	// Sorted the way DataTable sorts it (its own comparator, numeric-aware, empties last both ways).
	const column = {
		id: "spent",
		header: "Spent (30d)",
		type: "custom" as const,
		render: () => null,
		sortValue: spentSortValue,
	};
	const rows = [
		summary({ id: "none" }),
		summary({ id: "jpy", money30d: [jpy] }),
		summary({ id: "usd", money30d: [usd] }),
		summary({ id: "usd99", money30d: [usd99] }),
		summary({ id: "usdBig", money30d: [usdBig] }),
	];
	const order = (dir: "asc" | "desc") =>
		sortRowsBy(rows, [{ key: "spent", dir }], [column]).map((row) => row.id);
	// Within USD by amount (US$999.99 below US$1,000.00 — numeric, not textual); the ¥90,000 row is
	// grouped by its currency, never ranked above US$1,000.00 for being the bigger number.
	assertEquals(order("desc"), ["usdBig", "usd", "usd99", "jpy", "none"]);
	assertEquals(order("asc"), ["jpy", "usd99", "usd", "usdBig", "none"]);
});
// #endregion
