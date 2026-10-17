import { assert, assertEquals } from "@std/assert";
import type {
	IncomingInvite,
	WorkspaceCapability,
	WorkspaceKind,
	WorkspaceStatus,
	WorkspaceSummary,
} from "@projective/types/workspace";
import { importWithoutGlyphs, type RegistryApi } from "./registry-import.testing.ts";

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
	context: { control: string; label: string; options: { value: string }[]; search: boolean } | null;
	footer: { create: Create | null };
}

type RosterInput = {
	view: "roster";
	kind: WorkspaceKind;
	liveCount: number;
	invitationCount: number;
	canCreate: boolean;
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
	laneFilledControls(zones: Zones): number;
	laneRosterList(
		items: readonly WorkspaceSummary[],
		invitations: readonly IncomingInvite[],
		tab: string,
		search?: string,
	):
		| { mode: "entities"; rows: WorkspaceSummary[] }
		| { mode: "invitations"; rows: IncomingInvite[] };
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
	laneMoreStorageKey(kind: WorkspaceKind, viewer: string): string;
	parseMoreOpen(raw: string | null): boolean | null;
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
		faces: [],
		stats: [],
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
		...overrides,
	};
}

/** Every composition the lane can take, across both kinds — for the invariants that hold for all. */
function everyComposition(): Zones[] {
	const out: Zones[] = [];
	for (const kind of ["team", "business"] as const) {
		for (const canCreate of [true, false]) {
			out.push(lane.laneZones(roster({ kind, canCreate })));
		}
		for (const capabilities of [OWNER, NO_INVITE, MEMBER]) {
			for (const module of ["overview", "members", "invitations", "projects", "settings", null]) {
				for (const subView of [null, "all", "pending"]) {
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

Deno.test("lane: Members offers People · Org chart, and only on its roster sub-view", () => {
	const members = lane.laneZones(inConsole({ module: "members", subView: "all" }));
	assertEquals(members.context?.control, "members");
	assertEquals(members.context?.options.map((o) => o.value), ["people", "chart"]);
	assertEquals(members.context?.search, false);
	assertEquals(lane.laneZones(inConsole({ module: "members", subView: "pending" })).context, null);
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
				assertEquals(lane.laneFilledControls(zones), 0);
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
	const business = lane.laneZones(inConsole({ kind: "business", handle: "acme", module: null }));
	assert(business.footer.create?.action === "invite");
	assertEquals(business.footer.create.href, "/businesses/acme/members?invite=1");
});

Deno.test("lane: never more than one filled control, in any composition", () => {
	for (const zones of everyComposition()) {
		assert(lane.laneFilledControls(zones) <= 1);
		assertEquals(lane.laneFilledControls(zones), zones.footer.create ? 1 : 0);
	}
});

Deno.test("lane: Tab order is Z1 → Z2 → Z3 → Z4 in every composition", () => {
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
	const key = lane.laneMoreStorageKey("team", "ada");
	assert(key.startsWith("pj.local."), key);
	assert(key.endsWith(".team.ada"), key);
	assert(lane.laneMoreStorageKey("business", "ada") !== key);
	assert(lane.laneMoreStorageKey("team", "bo") !== key);

	assertEquals(lane.parseMoreOpen("1"), true);
	assertEquals(lane.parseMoreOpen("0"), false);
	assertEquals(lane.parseMoreOpen(null), null);
	assertEquals(lane.parseMoreOpen("yes"), null);

	assertEquals(lane.initialMoreOpen(null, false), false);
	assertEquals(lane.initialMoreOpen(false, false), false);
	assertEquals(lane.initialMoreOpen(true, false), true);
	assertEquals(lane.initialMoreOpen(false, true), true);
});
// #endregion

// #region No raw buttons
Deno.test("lane: no raw <button> in the lane island, the rail or the acting switch", () => {
	for (
		const file of [
			"../islands/WorkspaceLane.island.tsx",
			"../components/WorkspaceRail.tsx",
			"../components/ContextSwitchControl.tsx",
		]
	) {
		const source = Deno.readTextFileSync(new URL(file, import.meta.url));
		assert(!/<button\b/.test(source), `${file} renders a raw <button>`);
	}
});
// #endregion
