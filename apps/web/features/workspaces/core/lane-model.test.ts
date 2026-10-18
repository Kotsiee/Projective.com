import { assert, assertEquals } from "@std/assert";
import type {
	IncomingInvite,
	WorkspaceCapability,
	WorkspaceKind,
	WorkspaceStatus,
	WorkspaceSummary,
} from "@projective/types/workspace";
import { importWithoutGlyphs, type RegistryApi } from "./registry-import.testing.ts";
import { MEMBERS_READINGS } from "./sub-views.ts";

/**
 * The workspace lane's four zones (Teams work order L1), pinned at the pure model the expanded lane
 * and the collapsed rail both render. The model reaches the registry, whose glyphs import CSS, so it
 * loads through {@link importWithoutGlyphs}; its surface is restated below because the real types
 * cannot be named here.
 */

// #region Surface under test
type Meta = string | { text: string; tabular?: boolean };
type Module = { key: string };
type Create =
	| { action: "create"; label: string }
	| { action: "invite"; label: string; inPlace: boolean; href: string };

interface Zones {
	header:
		| { mode: "roster"; title: string; meta: Meta[] }
		| {
			mode: "console";
			back: { href: string; label: string };
			status: { label: string; severity: string };
			switchControl: { action: string; label: string; ariaLabel: string; busyLabel: string };
		};
	views:
		| { mode: "roster" }
		| {
			mode: "console";
			primary: Module[];
			more: Module[];
			active: string | null;
			activeInMore: boolean;
		};
	context: {
		control: string;
		label: string;
		options: { value: string; label: string }[];
		search: boolean;
	} | null;
	footer: { create: Create | null; note: string | null };
}

type RosterInput = {
	view: "roster";
	kind: WorkspaceKind;
	liveCount: number;
	invitationCount: number;
	canCreate: boolean;
	createBlockedReason?: string | null;
	firstRun?: boolean;
};

type ConsoleInput = {
	view: "console";
	kind: WorkspaceKind;
	name: string;
	handle: string;
	status: WorkspaceStatus;
	acting: boolean;
	capabilities: readonly WorkspaceCapability[];
	module: string | null;
	subView: string | null;
};

interface LaneModelApi {
	laneZones(input: RosterInput | ConsoleInput): Zones;
	laneZoneOrder(zones: Zones): string[];
	lanePartition(tab: string): string;
	laneRosterList(
		items: readonly WorkspaceSummary[],
		invitations: readonly IncomingInvite[],
		tab: string,
		search?: string,
	):
		| { mode: "entities"; rows: WorkspaceSummary[] }
		| { mode: "invitations"; rows: IncomingInvite[] };
	laneRailEntities(items: readonly WorkspaceSummary[]): WorkspaceSummary[];
	laneEntityMeta(entity: WorkspaceSummary): Meta[];
	laneInviteMeta(invite: IncomingInvite): Meta[];
	rosterFiltered(tab: string, search: string): boolean;
	laneSignals(detail: {
		invites: readonly unknown[];
		spend: { approvals: { pending: readonly unknown[] } } | null;
		verification: string;
	}): Record<string, { dot?: boolean; count?: number }>;
	signalLabel(signal: { dot?: boolean; count?: number } | undefined): string | null;
	groupHasSignal(
		modules: readonly Module[],
		signals: Record<string, { dot?: boolean; count?: number }>,
	): boolean;
	verificationWords(kind: WorkspaceKind, state: string): string;
	contextSwitchCopy(
		kind: WorkspaceKind,
		name: string,
		acting: boolean,
	): { action: string; label: string; ariaLabel: string; busyLabel: string };
	laneMorePartition(kind: WorkspaceKind, viewer: string): string;
	parseMoreOpen(raw: string | null, partition: string): boolean | null;
	withMoreOpen(raw: string | null, partition: string, open: boolean): string;
	initialMoreOpen(stored: boolean | null, activeInMore: boolean): boolean;
}

const lane = await importWithoutGlyphs<LaneModelApi>("./lane-model.ts");
const { mayViewModule, primaryModules, secondaryModules } = await importWithoutGlyphs<RegistryApi>(
	"./module-registry.tsx",
);
// #endregion

// #region Fixtures
/** Every capability — the owner's effective set. */
const OWNER: readonly WorkspaceCapability[] = [
	"invite_members",
	"remove_members",
	"manage_roles",
	"edit_profile",
	"manage_settings",
	"bind_seat",
	"manage_projects",
	"publish_listings",
	"purchase",
	"hire",
	"contribute_funds",
	"spend_funds",
	"withdraw_funds",
	"manage_finances",
	"approve_spend",
	"manage_billing",
	"view_analytics",
	"view_audit",
	"archive_entity",
];
/** A plain member: no capability at all. */
const MEMBER: readonly WorkspaceCapability[] = [];
/** Everything but the invite right. */
const NO_INVITE = OWNER.filter((c) => c !== "invite_members");

const keys = (modules: Module[]): string[] => modules.map((m) => m.key);

function roster(overrides: Partial<RosterInput> = {}): RosterInput {
	return {
		view: "roster",
		kind: "team",
		liveCount: 3,
		invitationCount: 1,
		canCreate: true,
		...overrides,
	};
}

function inConsole(overrides: Partial<ConsoleInput> = {}): ConsoleInput {
	return {
		view: "console",
		kind: "team",
		name: "North Loop",
		handle: "north-loop",
		status: "active",
		acting: false,
		capabilities: OWNER,
		module: "overview",
		subView: null,
		...overrides,
	};
}

function summary(overrides: Partial<WorkspaceSummary>): WorkspaceSummary {
	return {
		id: "w-1",
		kind: "team",
		name: "North Loop",
		handle: "north-loop",
		avatar: "",
		status: "active",
		verification: "verified",
		role: "member",
		isOwner: false,
		memberCount: 4,
		activeProjects: 0,
		faces: [],
		stats: [],
		updatedAt: null,
		hasUpdate: false,
		isActing: false,
		tagline: "",
		setupProgress: 1,
		...overrides,
	};
}

function invite(overrides: Partial<IncomingInvite>): IncomingInvite {
	return {
		id: "i-1",
		workspaceId: "w-9",
		workspaceName: "Harbour Studio",
		workspaceHandle: "harbour",
		workspaceAvatar: "",
		kind: "team",
		fromName: "Ada",
		fromHandle: "ada",
		roleLabel: "Member",
		sentAt: "2d ago",
		note: null,
		expiresAt: null,
		...overrides,
	};
}

/** Every composition the lane can take, across both kinds — for the invariants that hold for all. */
function everyComposition(): Zones[] {
	const out: Zones[] = [];
	for (const kind of ["team", "business"] as const) {
		for (const canCreate of [true, false]) {
			for (const firstRun of [true, false]) {
				out.push(lane.laneZones(roster({ kind, canCreate, firstRun })));
			}
		}
		for (const capabilities of [OWNER, NO_INVITE, MEMBER]) {
			for (const module of ["overview", "members", "invitations", "projects", "settings", null]) {
				for (const subView of [null, "people", "pending", "chart"]) {
					for (const acting of [true, false]) {
						out.push(
							lane.laneZones(inConsole({ kind, capabilities, module, subView, acting })),
						);
					}
				}
			}
		}
	}
	return out;
}
// #endregion

// #region Zone composition per (kind, view, caps)
Deno.test("lane: the team roster is title + count, the entity list, partition + search, New team", () => {
	const zones = lane.laneZones(roster());
	assertEquals(zones.header, {
		mode: "roster",
		title: "Teams",
		meta: [{ text: "3 teams", tabular: true }, { text: "1 invitation", tabular: true }],
	});
	assertEquals(zones.views, { mode: "roster" });
	assertEquals(zones.context?.control, "roster");
	assertEquals(zones.context?.options.map((o) => o.value), [
		"all",
		"owned",
		"member",
		"invitations",
	]);
	assertEquals(zones.context?.search, true);
	assertEquals(zones.footer.create, { action: "create", label: "New team" });
	assertEquals(lane.laneZoneOrder(zones), ["header", "views", "context", "footer"]);
});

Deno.test("lane: the business roster speaks its own nouns", () => {
	const zones = lane.laneZones(roster({ kind: "business", liveCount: 1, invitationCount: 0 }));
	assertEquals(zones.header.mode === "roster" && zones.header.title, "Businesses");
	assertEquals(zones.header.mode === "roster" && zones.header.meta, [
		{ text: "1 business", tabular: true },
	]);
	assertEquals(zones.footer.create, { action: "create", label: "New business" });
});

Deno.test("lane: a roster the viewer may not add to has no create action at all", () => {
	assertEquals(lane.laneZones(roster({ canCreate: false })).footer.create, null);
});

Deno.test("lane (R1): in the roster's first run the footer holds no create and no note", () => {
	// The canvas's empty state carries the one structural create — and the plan's reason when there
	// is none — so the rig holds neither, for either kind and whatever the plan says.
	for (const kind of ["team", "business"] as const) {
		for (const canCreate of [true, false]) {
			const zones = lane.laneZones(
				roster({
					kind,
					canCreate,
					firstRun: true,
					liveCount: 0,
					invitationCount: 0,
					createBlockedReason: "Your plan includes 0 teams.",
				}),
			);
			assertEquals(zones.footer, { create: null, note: null });
			// The rest of the lane is the roster's as ever: title, partition, search.
			assertEquals(zones.context?.control, "roster");
			assertEquals(lane.laneZoneOrder(zones), ["header", "views", "context", "footer"]);
		}
	}
	// Outside first run the create is back, exactly as before.
	assertEquals(
		lane.laneZones(roster({ firstRun: false })).footer.create,
		{ action: "create", label: "New team" },
	);
});

Deno.test("lane: a withheld create leaves the plan's reason in its place, and only then", () => {
	const reason = "Your plan includes 1 business — archive one or upgrade to create another.";
	assertEquals(
		lane.laneZones(roster({ kind: "business", canCreate: false, createBlockedReason: reason }))
			.footer,
		{ create: null, note: reason },
	);
	// A projection with no reason still says why, in the kind's words.
	for (const createBlockedReason of [null, undefined, "  "]) {
		assertEquals(
			lane.laneZones(roster({ canCreate: false, createBlockedReason })).footer.note,
			"Your plan does not include another team.",
		);
	}
	// A create that renders carries no note, whatever reason the projection holds.
	assertEquals(
		lane.laneZones(roster({ canCreate: true, createBlockedReason: reason })).footer.note,
		null,
	);
	// Inside a console the footer never explains a missing invite: the capability gate is not a plan.
	for (const capabilities of [OWNER, NO_INVITE, MEMBER]) {
		assertEquals(lane.laneZones(inConsole({ capabilities })).footer.note, null);
	}
});

Deno.test("lane: a team console leads with (C)'s primaries and puts every other module in More", () => {
	const zones = lane.laneZones(inConsole());
	assert(zones.views.mode === "console");
	assertEquals(keys(zones.views.primary), keys(primaryModules("team", OWNER)));
	assertEquals(keys(zones.views.primary), [
		"overview",
		"members",
		"projects",
		"payouts",
		"roles",
		"settings",
	]);
	assertEquals(keys(zones.views.more), keys(secondaryModules("team", OWNER)));
	assertEquals(zones.views.active, "overview");
	assertEquals(zones.views.activeInMore, false);
});

Deno.test("lane: a business console leads with Decision #232's primaries", () => {
	const zones = lane.laneZones(inConsole({ kind: "business" }));
	assert(zones.views.mode === "console");
	assertEquals(keys(zones.views.primary), [
		"overview",
		"members",
		"projects",
		"spend",
		"billing",
		"settings",
	]);
	assert(keys(zones.views.more).includes("finance"));
});

Deno.test("lane: More lists only the secondaries the viewer may open", () => {
	for (const kind of ["team", "business"] as const) {
		for (const capabilities of [OWNER, NO_INVITE, MEMBER]) {
			const zones = lane.laneZones(inConsole({ kind, capabilities }));
			assert(zones.views.mode === "console");
			const primary = keys(zones.views.primary);
			for (const key of keys(zones.views.more)) {
				assert(mayViewModule(key, kind, capabilities), `${kind}: ${key} is not permitted`);
				assert(!primary.includes(key), `${kind}: ${key} is also primary`);
			}
			assertEquals(keys(zones.views.more), keys(secondaryModules(kind, capabilities)));
		}
	}
	const plain = lane.laneZones(inConsole({ capabilities: MEMBER }));
	assert(plain.views.mode === "console");
	for (const withheld of ["catalogue", "invitations", "finance", "analytics", "profile"]) {
		assert(!keys(plain.views.more).includes(withheld), `a plain member sees ${withheld}`);
	}
	assertEquals(keys(plain.views.primary), ["overview", "members", "projects"]);
});

Deno.test("lane: a module in More is reported so the section opens onto it", () => {
	const zones = lane.laneZones(inConsole({ module: "calendar" }));
	assert(zones.views.mode === "console");
	assertEquals(zones.views.activeInMore, true);
});

Deno.test("lane: the console header carries Back, the lifecycle Tag and the acting switch", () => {
	const draft = lane.laneZones(inConsole({ status: "draft" }));
	assert(draft.header.mode === "console");
	assertEquals(draft.header.back, { href: "/teams", label: "All teams" });
	assertEquals(draft.header.status, { label: "Draft", severity: "warning" });
	assertEquals(draft.header.switchControl.label, "Act as team");

	const acting = lane.laneZones(inConsole({ acting: true, kind: "business" }));
	assert(acting.header.mode === "console");
	assertEquals(acting.header.back, { href: "/businesses", label: "All businesses" });
	assertEquals(acting.header.status, { label: "Active", severity: "success" });
	assertEquals(acting.header.switchControl.action, "exit");
	assertEquals(acting.header.switchControl.label, "Stop acting");
});

Deno.test("lane: Members offers People · Org chart, and only on a people reading", () => {
	for (const subView of [null, "people", "chart"]) {
		const members = lane.laneZones(inConsole({ module: "members", subView }));
		assertEquals(members.context?.control, "members");
		assertEquals(members.context?.options, [
			{ value: "people", label: "People" },
			{ value: "chart", label: "Org chart" },
		]);
		assertEquals(members.context?.search, false);
	}
	assertEquals(lane.laneZones(inConsole({ module: "members", subView: "pending" })).context, null);
});

Deno.test("lane: the Members control's values ARE the module's sub-views (one state)", () => {
	const members = lane.laneZones(inConsole({ module: "members", subView: "people" }));
	assertEquals(
		members.context?.options.map((o) => o.value),
		MEMBERS_READINGS.map((v) => v.value),
	);
});

Deno.test("lane: a view with nothing to partition draws no context band", () => {
	for (const module of ["overview", "projects", "invitations", "payouts", "settings", null]) {
		const zones = lane.laneZones(inConsole({ module }));
		assertEquals(zones.context, null, `${module} drew a context band`);
		assertEquals(lane.laneZoneOrder(zones), ["header", "views", "footer"]);
	}
});
// #endregion

// #region The one create action
Deno.test("lane: no create button inside a console without invite_members", () => {
	for (const kind of ["team", "business"] as const) {
		for (const capabilities of [NO_INVITE, MEMBER]) {
			for (const module of ["overview", "members", "invitations", "projects"]) {
				const zones = lane.laneZones(inConsole({ kind, capabilities, module }));
				assertEquals(zones.footer.create, null, `${kind} ${module} offered a create`);
			}
		}
	}
});

Deno.test("lane: Invite member opens in place on Members and lands there from anywhere else", () => {
	for (const module of ["members", "invitations"]) {
		assertEquals(lane.laneZones(inConsole({ module })).footer.create, {
			action: "invite",
			label: "Invite member",
			inPlace: true,
			href: "/teams/north-loop/members?invite=1",
		});
	}
	assertEquals(lane.laneZones(inConsole({ module: "payouts" })).footer.create, {
		action: "invite",
		label: "Invite member",
		inPlace: false,
		href: "/teams/north-loop/members?invite=1",
	});
	// A team's Projects mounts the modal too (its allowance band's Invite member), so the lane's
	// Invite member opens it there instead of leaving the page; a business's Projects mounts none.
	assertEquals(lane.laneZones(inConsole({ module: "projects" })).footer.create, {
		action: "invite",
		label: "Invite member",
		inPlace: true,
		href: "/teams/north-loop/members?invite=1",
	});
	const businessProjects = lane.laneZones(
		inConsole({ kind: "business", handle: "acme", module: "projects" }),
	);
	assert(businessProjects.footer.create?.action === "invite");
	assertEquals(businessProjects.footer.create.inPlace, false);
	const business = lane.laneZones(inConsole({ kind: "business", handle: "acme", module: null }));
	assert(business.footer.create?.action === "invite");
	assertEquals(business.footer.create.href, "/businesses/acme/members?invite=1");
});

// Model-only: the zone ORDER the island renders. That the rendered lane follows it — each zone's
// controls inside its own zone, the zones emitted in this order — is the source scan further down.
Deno.test("lane (model): the zone order is Z1 → Z2 → Z3 → Z4 in every composition", () => {
	const rank = { header: 1, views: 2, context: 3, footer: 4 } as Record<string, number>;
	for (const zones of everyComposition()) {
		const order = lane.laneZoneOrder(zones);
		assertEquals(order[0], "header");
		assertEquals(order.at(-1), "footer");
		assertEquals(order.includes("context"), zones.context !== null);
		assertEquals(order.map((z) => rank[z]), order.map((z) => rank[z]).toSorted((a, b) => a - b));
	}
});
// #endregion

// #region The shared roster partition
Deno.test("lane: the canvas-only Archived partition reads as All in the lane", () => {
	assertEquals(lane.lanePartition("archived"), "all");
	for (const tab of ["all", "owned", "member", "invitations"]) {
		assertEquals(lane.lanePartition(tab), tab);
	}
	// Every partition the lane can read is one of its control's segments, so a segment is always selected.
	const segments = lane.laneZones(roster()).context?.options.map((o) => o.value) ?? [];
	for (const tab of ["all", "owned", "member", "invitations", "archived"]) {
		assert(segments.includes(lane.lanePartition(tab)), `${tab} has no lane segment`);
	}
	assertEquals(lane.rosterFiltered(lane.lanePartition("archived"), ""), false);
});
// #endregion

// #region Roster rows
Deno.test("lane: roster rows list owned entities first, keep server order, and hide archived", () => {
	const items = [
		summary({ id: "a", name: "Alpha", handle: "alpha", isOwner: false }),
		summary({ id: "b", name: "Bravo", handle: "bravo", isOwner: true, role: "owner" }),
		summary({ id: "c", name: "Charlie", handle: "charlie", isOwner: false }),
		summary({ id: "d", name: "Delta", handle: "delta", isOwner: true, role: "owner" }),
		summary({ id: "e", name: "Echo", handle: "echo", isOwner: true, status: "archived" }),
	];
	const all = lane.laneRosterList(items, [], "all");
	assert(all.mode === "entities");
	assertEquals(all.rows.map((r) => r.id), ["b", "d", "a", "c"]);

	const owned = lane.laneRosterList(items, [], "owned");
	assert(owned.mode === "entities");
	assertEquals(owned.rows.map((r) => r.id), ["b", "d"]);

	const searched = lane.laneRosterList(items, [], "all", "char");
	assert(searched.mode === "entities");
	assertEquals(searched.rows.map((r) => r.id), ["c"]);

	// The collapsed rail folds the same list: the expanded "All" order, archived left out.
	assertEquals(lane.laneRailEntities(items).map((r) => r.id), all.rows.map((r) => r.id));
});

Deno.test("lane: the Invitations partition lists invitations, searchable by name or handle", () => {
	const invites = [
		invite({ id: "1" }),
		invite({ id: "2", workspaceName: "Kiln", workspaceHandle: "kiln" }),
	];
	const list = lane.laneRosterList([summary({})], invites, "invitations");
	assertEquals(list.mode, "invitations");
	assertEquals(list.rows.length, 2);
	const found = lane.laneRosterList([], invites, "invitations", "KILN");
	assertEquals(found.rows.map((r) => r.id), ["2"]);
});

Deno.test("lane: a row's facts are one meta line — role · members · status — never chips", () => {
	assertEquals(lane.laneEntityMeta(summary({ role: "owner", memberCount: 4, status: "active" })), [
		"Owner",
		{ text: "4 members", tabular: true },
		"Active",
	]);
	assertEquals(lane.laneEntityMeta(summary({ memberCount: 1, status: "draft" })), [
		"Member",
		{ text: "1 member", tabular: true },
		"Draft",
	]);
	assertEquals(lane.laneInviteMeta(invite({ roleLabel: "Lead", sentAt: "3h ago" })), [
		"Invited as Lead",
		"3h ago",
	]);
});

Deno.test("lane: the reset shows only while a partition or a search is engaged", () => {
	assertEquals(lane.rosterFiltered("all", ""), false);
	assertEquals(lane.rosterFiltered("all", "   "), false);
	assertEquals(lane.rosterFiltered("owned", ""), true);
	assertEquals(lane.rosterFiltered("all", "nor"), true);
});
// #endregion

// #region Signals, switch copy and the More memory
Deno.test("lane: module signals are a count for a queue and a dot for attention", () => {
	const signals = lane.laneSignals({
		invites: [{}, {}],
		spend: { approvals: { pending: [{}] } },
		verification: "pending",
	});
	assertEquals(signals, {
		invitations: { count: 2 },
		spend: { count: 1 },
		verification: { dot: true },
	});
	assertEquals(lane.signalLabel(signals.invitations), "2 waiting");
	assertEquals(lane.signalLabel(signals.verification), "needs attention");
	assertEquals(lane.signalLabel(undefined), null);
	assertEquals(lane.groupHasSignal([{ key: "calendar" }, { key: "verification" }], signals), true);
	assertEquals(lane.groupHasSignal([{ key: "calendar" }], signals), false);
	assertEquals(
		lane.laneSignals({ invites: [], spend: null, verification: "verified" }),
		{},
	);
});

Deno.test("lane: verification is spelled out in words per kind", () => {
	assertEquals(lane.verificationWords("team", "unverified"), "KYC needed");
	assertEquals(lane.verificationWords("business", "pending"), "KYB in review");
	assertEquals(lane.verificationWords("team", "verified"), "KYC verified");
});

Deno.test("lane: the acting switch keeps its visible label at the start of its accessible name", () => {
	for (const acting of [true, false]) {
		const copy = lane.contextSwitchCopy("team", "North Loop", acting);
		assert(
			copy.ariaLabel.startsWith(copy.label),
			`${copy.ariaLabel} does not start with ${copy.label}`,
		);
		assert(copy.ariaLabel.includes("North Loop"));
	}
	assertEquals(
		lane.contextSwitchCopy("team", "North Loop", false).busyLabel,
		"Switching to North Loop…",
	);
	assertEquals(lane.contextSwitchCopy("business", "Acme", false).label, "Act as business");
});

Deno.test("lane: More is collapsed by default, remembered per viewer and kind, open onto the active module", () => {
	const ada = lane.laneMorePartition("team", "ada");
	assert(lane.laneMorePartition("business", "ada") !== ada);
	assert(lane.laneMorePartition("team", "bo") !== ada);

	// One stored map, one entry per partition; writing one keeps the others.
	const opened = lane.withMoreOpen(null, ada, true);
	assertEquals(lane.parseMoreOpen(opened, ada), true);
	assertEquals(lane.parseMoreOpen(opened, lane.laneMorePartition("team", "bo")), null);
	const both = lane.withMoreOpen(opened, lane.laneMorePartition("business", "ada"), false);
	assertEquals(lane.parseMoreOpen(both, ada), true);
	assertEquals(lane.parseMoreOpen(both, lane.laneMorePartition("business", "ada")), false);

	// Anything unset or unreadable is unknown, never an error.
	assertEquals(lane.parseMoreOpen(null, ada), null);
	assertEquals(lane.parseMoreOpen("not json", ada), null);
	assertEquals(lane.parseMoreOpen("[true]", ada), null);
	assertEquals(lane.parseMoreOpen(JSON.stringify({ [ada]: "1" }), ada), null);
	assertEquals(lane.parseMoreOpen(lane.withMoreOpen("not json", ada, false), ada), false);

	assertEquals(lane.initialMoreOpen(null, false), false);
	assertEquals(lane.initialMoreOpen(false, false), false);
	assertEquals(lane.initialMoreOpen(true, false), true);
	assertEquals(lane.initialMoreOpen(false, true), true);
});
// #endregion

// #region Rendered lane — source scans
/*
 * The island cannot be rendered under `deno test` (every `@projective/ui` component imports CSS), so
 * these read the lane's source. They pin what the model cannot: which controls the lane actually
 * draws, and where it draws them.
 */
const LANE = "../islands/WorkspaceLane.island.tsx";
const RAIL = "../components/WorkspaceRail.tsx";
const SWITCH = "../components/ContextSwitchControl.tsx";

/**
 * A file's code: CRLF folded, so the scans read the same text on every checkout, and comments removed,
 * so a tag named in prose (`<Button severity="neutral">` in a JSDoc) is never read as one drawn.
 */
function source(file: string): string {
	return Deno.readTextFileSync(new URL(file, import.meta.url))
		.replaceAll("\r\n", "\n")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|\s)\/\/.*$/gm, "$1");
}

/** How many times a JSX tag opens in a piece of source. */
function opens(text: string, tag: string): number {
	return text.match(new RegExp(`<${tag}\\b`, "g"))?.length ?? 0;
}

/**
 * Each zone switch's case bodies, by zone id, in source order — and the source with them cut out. A case
 * body runs to the next case or to the end of its switch (`\t\t}\n\t};`).
 */
function zoneCases(text: string): { cases: { id: string; body: string }[]; rest: string } {
	const cases: { id: string; body: string }[] = [];
	let rest = "";
	let at = 0;
	const re = /case "(header|views|context|footer)":/g;
	for (let m = re.exec(text); m; m = re.exec(text)) {
		const from = m.index + m[0].length;
		const next = text.slice(from).search(/case "(header|views|context|footer)":|\n\t\t\}\n\t\};/);
		const to = next < 0 ? text.length : from + next;
		rest += text.slice(at, m.index);
		cases.push({ id: m[1], body: text.slice(from, to) });
		at = to;
		re.lastIndex = to;
	}
	return { cases, rest: rest + text.slice(at) };
}

Deno.test("lane: no raw <button> in the lane island, the rail or the acting switch", () => {
	for (const file of [LANE, RAIL, SWITCH]) {
		assert(!/<button\b/.test(source(file)), `${file} renders a raw <button>`);
	}
});

Deno.test("lane: the one LaneCreateButton is the only filled control the lane and the rail draw", () => {
	for (const file of [LANE, RAIL, SWITCH]) {
		const text = source(file);
		// `Button` defaults to `variant="filled"`: every one here must say outlined (tier 4) or text
		// (tier 5), and none may take the structural or amber fill.
		for (const [element] of text.matchAll(/<Button\b[\s\S]*?\/>/g)) {
			assert(!/<Button\b[\s\S]*<Button\b/.test(element), `${file}: unparsable <Button>`);
			assert(
				/\bvariant="(outlined|text)"/.test(element),
				`${file} draws a filled <Button>: ${element}`,
			);
			assert(!/\bstructural\b|severity="accent"/.test(element), `${file}: ${element}`);
		}
	}
	// One create per presentation — the expanded footer and its folded rail glyph.
	assertEquals(opens(source(LANE), "LaneCreateButton"), 1);
	assertEquals(opens(source(RAIL), "LaneCreateButton"), 1);
	assertEquals(opens(source(SWITCH), "LaneCreateButton"), 0);
});

Deno.test("lane: each zone's controls render inside their own zone, emitted in laneZoneOrder", () => {
	const text = source(LANE);
	const { cases, rest } = zoneCases(text);
	assertEquals(cases.map((c) => c.id), [
		"header",
		"views",
		"context",
		"footer",
		"header",
		"views",
		"context",
		"footer",
	]);

	// Where each zone-bearing tag may open — in its zone's case and nowhere else in the island.
	const home: Record<string, string> = {
		LaneHead: "header",
		ContextSwitchControl: "header",
		LaneIconButton: "header",
		LaneList: "views",
		LaneSection: "views",
		NavItem: "views",
		ContextZone: "context",
		SelectButton: "context",
		LaneSearch: "context",
		Button: "context",
		LaneFooterRig: "footer",
	};
	for (const [tag, zone] of Object.entries(home)) {
		for (const c of cases) {
			if (c.id !== zone) assertEquals(opens(c.body, tag), 0, `<${tag}> opens in the ${c.id} zone`);
		}
	}
	// Outside the cases only the zone components' own definitions may draw (ModuleList's NavItem rows,
	// the footer rig's collapse toggle and create): no zone control rides in the wrapper.
	for (
		const tag of ["LaneHead", "ContextSwitchControl", "LaneList", "SelectButton", "LaneSearch"]
	) {
		assertEquals(opens(rest, tag), 0, `<${tag}> opens outside its zone`);
	}
	for (const zone of ["header", "views", "footer"]) {
		assert(cases.filter((c) => c.id === zone).every((c) => c.body.trim().length > 0));
	}

	// Both lanes render exactly the model's order as their children, and nothing reorders it: no
	// positive tabindex, no CSS `order` or reversed flow.
	assertEquals(
		text.match(/<div class="wsp-lane">\{laneZoneOrder\(zones\)\.map\(zone\)\}<\/div>/g)?.length,
		2,
	);
	for (const file of [LANE, RAIL, SWITCH]) {
		assert(!/tab[iI]ndex=\{?"?[1-9]/.test(source(file)), `${file} sets a positive tabindex`);
	}
	const css = source("../styles/workspace-chrome.css");
	assert(!/(?<![-\w])order\s*:|-reverse\b/.test(css), "workspace-chrome.css reorders a flow");
});

Deno.test("lane: More's memory goes through the SSR-safe accessors, and no control assigns location", () => {
	const text = source(LANE);
	assert(!/globalThis\.(localStorage|sessionStorage)/.test(text), "raw storage access");
	assert(/readStored\("local", LocalKeys\.WORKSPACE_LANE_MORE\)/.test(text));
	assert(/writeStored\(\s*"local",\s*LocalKeys\.WORKSPACE_LANE_MORE/.test(text));
	for (const file of [LANE, RAIL]) {
		assert(
			!/location\.(assign|replace|href\s*=)/.test(source(file)),
			`${file} navigates by script`,
		);
	}
});
// #endregion
