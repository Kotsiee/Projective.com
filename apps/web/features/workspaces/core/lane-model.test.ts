import { assert, assertEquals } from "@std/assert";
import {
	type IncomingInvite,
	type WorkspaceCapability,
	workspaceHref,
	type WorkspaceKind,
	type WorkspaceStatus,
	type WorkspaceSummary,
} from "@projective/types/workspace";
import { importWithoutGlyphs, type RegistryApi } from "./registry-import.testing.ts";

/**
 * The workspace lane's four zones (Teams work order L1; the console zones of Decision #306), pinned at
 * the pure model the expanded lane and the collapsed rail both render. The model reaches the registry,
 * whose glyphs import CSS, so it loads through {@link importWithoutGlyphs}; its surface is restated
 * below because the real types cannot be named here.
 */

// #region Surface under test
type Meta = string | { text: string; tabular?: boolean };
type Module = { key: string };
type Create =
	| { action: "create"; label: string }
	| { action: "invite"; label: string };
type Invite = Extract<Create, { action: "invite" }>;

interface HubRow {
	key: string;
	label: string;
	href: string;
	active: boolean;
	modules: Module[];
	blurb: string;
}

interface SwitchCopy {
	action: string;
	label: string;
	ariaLabel: string;
	busyLabel: string;
}

interface CatalogueZone {
	row: HubRow;
	team: string;
	listing: string | null;
	current: boolean;
	createLabel: string;
	createInPlace: boolean;
	createHref: string;
	canCreate: boolean;
}

interface LaneListing {
	id: string;
	title: string;
	kind: "service" | "product";
	status: "draft" | "published" | "paused" | "archived";
	cover: string | null;
	needsAttention: boolean;
}

interface LaneListings {
	items: LaneListing[];
	total: number;
}

interface Zones {
	header:
		| { mode: "roster"; title: string; meta: Meta[] }
		| {
			mode: "console";
			back: { href: string; label: string };
			status: { label: string; severity: string };
			menuLabel: string;
		};
	views:
		| { mode: "roster" }
		| {
			mode: "console";
			sections: { id: string; label: string; rows: HubRow[] }[];
			catalogue: CatalogueZone | null;
			channels: {
				label: string;
				base: string;
				active: string | null;
				createLabel: string;
				canCreate: boolean;
			} | null;
			activeHub: string | null;
		};
	context: {
		search: { label: string; placeholder: string };
		partition: {
			control: string;
			label: string;
			options: { value: string; label: string }[];
		} | null;
		invitations: { label: string; waiting: number } | null;
	};
	footer: {
		create: Create | null;
		note: string | null;
		actAs?: SwitchCopy;
		invite?: Invite | null;
		settings?: HubRow | null;
	};
}

interface SearchGroup {
	id: string;
	label: string;
	hits: { key: string; label: string; meta: string | null; href: string }[];
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
	channel?: string | null;
	listing?: string | null;
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
	hubSignal(
		modules: readonly Module[],
		signals: Record<string, { dot?: boolean; count?: number }>,
	): { dot?: boolean; count?: number } | undefined;
	channelUnreadLabel(unread: number): string | null;
	verificationWords(kind: WorkspaceKind, state: string): string;
	contextSwitchCopy(kind: WorkspaceKind, name: string, acting: boolean): SwitchCopy;
	consoleSearch(query: string, sources: {
		rows: readonly { key: string; label: string; href: string; blurb: string }[];
		channels: readonly { slug: string; topic: string | null }[];
		channelBase: string | null;
		projects: readonly { id: string; title: string; href: string; counterparty: string }[];
		people: readonly { id: string; name: string; handle: string }[];
		membersHref: string | null;
	}): SearchGroup[] | null;
	SEARCH_GROUP_LIMIT: number;
	laneListingsOf(page: { items: readonly Record<string, unknown>[]; total: number }): LaneListings;
	laneListingRows(listings: LaneListings, zone: CatalogueZone): {
		rows: (LaneListing & { href: string; active: boolean; state: string | null })[];
		more: { label: string; href: string } | null;
	};
	LANE_LISTING_LIMIT: number;
	LANE_LISTING_PARAMS: { type?: string; status?: string[]; sort?: string; limit?: number };
}

const lane = await importWithoutGlyphs<LaneModelApi>("./lane-model.ts");
const { mayViewModule, hubsForViewer, modulesForViewer } = await importWithoutGlyphs<RegistryApi>(
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

const keys = (modules: readonly { key: string }[]): string[] => modules.map((m) => m.key);

/** A console's views, narrowed. */
function consoleViews(zones: Zones): Extract<Zones["views"], { mode: "console" }> {
	assert(zones.views.mode === "console");
	return zones.views;
}

/** Every hub row a console lane draws, in lane order — Catalogue's title included — then Settings. */
function allRows(zones: Zones): HubRow[] {
	const views = consoleViews(zones);
	const rows = views.sections.flatMap((s) => s.rows);
	if (views.catalogue) rows.push(views.catalogue.row);
	return zones.footer.settings ? [...rows, zones.footer.settings] : rows;
}

/** A team console's Catalogue zone, asserted present. */
function catalogueOf(zones: Zones): CatalogueZone {
	const zone = consoleViews(zones).catalogue;
	assert(zone, "the team console has no Catalogue section");
	return zone;
}

function listing(overrides: Partial<LaneListing> = {}): LaneListing {
	return {
		id: "svc-brand-sprint",
		title: "Brand sprint",
		kind: "service",
		status: "published",
		cover: null,
		needsAttention: false,
		...overrides,
	};
}

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
		money30d: [],
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
				for (const acting of [true, false]) {
					out.push(lane.laneZones(inConsole({ kind, capabilities, module, acting })));
				}
			}
		}
	}
	return out;
}
// #endregion

// #region Zone composition per (kind, view, caps)
Deno.test("lane: the team roster is title + count, then search · Invitations · partition, the list, New team", () => {
	const zones = lane.laneZones(roster());
	assertEquals(zones.header, {
		mode: "roster",
		title: "Teams",
		meta: [{ text: "3 teams", tabular: true }, { text: "1 invitation", tabular: true }],
	});
	assertEquals(zones.views, { mode: "roster" });
	// The search opens the context zone, which sits directly under the head (Decision #307).
	assertEquals(zones.context.search, { label: "Search teams", placeholder: "Find a team…" });
	assertEquals(zones.context.partition?.control, "roster");
	assertEquals(zones.context.partition?.options.map((o) => o.value), ["all", "owned", "member"]);
	// Invitations are their own toggle beside the search, set apart from the partition's segments.
	assertEquals(zones.context.invitations, { label: "Invitations", waiting: 1 });
	assertEquals(zones.footer.create, { action: "create", label: "New team" });
	assertEquals(lane.laneZoneOrder(zones), ["header", "context", "views", "footer"]);
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
			// The rest of the lane is the roster's as ever: title, search, partition.
			assertEquals(zones.context.partition?.control, "roster");
			assertEquals(zones.context.invitations?.waiting, 0);
			assertEquals(lane.laneZoneOrder(zones), ["header", "context", "views", "footer"]);
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

Deno.test("lane (#306, #307, #316): a team console is Core operations · Governance · Catalogue · Channels, Settings in the footer", () => {
	const zones = lane.laneZones(inConsole());
	const views = consoleViews(zones);
	assertEquals(views.sections.map((s) => [s.id, s.label]), [
		["operations", "Core operations"],
		["governance", "Governance"],
	]);
	assertEquals(views.sections[0].rows.map((r) => [r.key, r.label]), [
		["overview", "Overview"],
		["projects", "Projects"],
		["calendar", "Calendar"],
		["files", "Files"],
	]);
	const catalogue = catalogueOf(zones);
	assertEquals([catalogue.row.key, catalogue.row.label, catalogue.row.href], [
		"catalogue",
		"Catalogue",
		"/teams/north-loop/catalogue",
	]);
	assertEquals(views.sections[1].rows.map((r) => [r.key, r.label]), [
		["roster", "Members"],
		["vault", "Wallet"],
		["insights", "Analytics"],
	]);
	assertEquals(views.channels, {
		label: "Channels",
		base: "/teams/north-loop/channels",
		active: null,
		createLabel: "New channel",
		canCreate: true,
	});
	assertEquals(zones.footer.settings?.label, "Team settings");
	assertEquals(zones.footer.settings?.href, "/teams/north-loop/settings");
	assertEquals(views.activeHub, "overview");
});

Deno.test("lane (#306): a business console speaks its own hubs", () => {
	const views = consoleViews(lane.laneZones(inConsole({ kind: "business", handle: "acme" })));
	assertEquals(views.sections[0].rows.map((r) => r.key), [
		"overview",
		"projects",
		"calendar",
		"files",
		"talent",
	]);
	const vault = views.sections[1].rows.find((r) => r.key === "vault");
	assertEquals(vault?.label, "Wallet");
	assertEquals(keys(vault?.modules ?? []), ["finance", "spend", "billing"]);
});

Deno.test("lane (#306): every module the viewer may open is reachable from exactly one row", () => {
	for (const kind of ["team", "business"] as const) {
		for (const capabilities of [OWNER, NO_INVITE, MEMBER]) {
			const zones = lane.laneZones(inConsole({ kind, capabilities }));
			const listed = allRows(zones).flatMap((r) => keys(r.modules));
			const channels = consoleViews(zones).channels ? ["channels"] : [];
			assertEquals(
				[...listed, ...channels].toSorted(),
				keys(modulesForViewer(kind, capabilities)).toSorted(),
				`${kind}: a visible module has no row, or a row lists a withheld one`,
			);
			for (const key of listed) assert(mayViewModule(key, kind, capabilities));
			assertEquals(new Set(listed).size, listed.length, `${kind}: a module sits in two hubs`);
			// A row links to its first module the viewer may open.
			for (const row of allRows(zones)) {
				assertEquals(row.href, workspaceHref(kind, "north-loop", row.modules[0].key));
			}
		}
	}
	// A plain member's governance is the roster (Members) and Standing — no money, no Roles.
	const plain = lane.laneZones(inConsole({ capabilities: MEMBER }));
	const governance = consoleViews(plain).sections.find((s) => s.id === "governance");
	assertEquals(governance?.rows.map((r) => [r.key, keys(r.modules)]), [
		["roster", ["members"]],
		["insights", ["standing"]],
	]);
	assertEquals(plain.footer.settings, null);
	assertEquals(hubsForViewer("team", MEMBER).some((h) => h.hub.key === "vault"), false);
});

Deno.test("lane (#306): the row of the module being rendered is the active one", () => {
	for (
		const [module, hub] of [
			["roles", "roster"],
			["invitations", "roster"],
			["payouts", "vault"],
			["standing", "insights"],
			["verification", "settings"],
		] as const
	) {
		const zones = lane.laneZones(inConsole({ module }));
		assertEquals(consoleViews(zones).activeHub, hub);
		assertEquals(allRows(zones).filter((r) => r.active).map((r) => r.key), [hub]);
	}
	const channel = lane.laneZones(inConsole({ module: "channels", channel: "general" }));
	assertEquals(consoleViews(channel).activeHub, null);
	assertEquals(consoleViews(channel).channels?.active, "general");
	assertEquals(allRows(channel).filter((r) => r.active), []);

	for (const slug of [null, "svc-brand-sprint"]) {
		const zones = lane.laneZones(inConsole({ module: "catalogue", listing: slug }));
		assertEquals(consoleViews(zones).activeHub, "catalogue");
		assertEquals(allRows(zones).filter((r) => r.active).map((r) => r.key), ["catalogue"]);
	}
});

Deno.test("lane (#306): an archived entity offers no New channel", () => {
	const views = consoleViews(lane.laneZones(inConsole({ status: "archived" })));
	assertEquals(views.channels?.canCreate, false);
});

Deno.test("lane (#316): only a team member holding the catalogue gate gets the Catalogue section", () => {
	assertEquals(
		consoleViews(lane.laneZones(inConsole({ kind: "business", handle: "acme" }))).catalogue,
		null,
	);
	assertEquals(consoleViews(lane.laneZones(inConsole({ capabilities: MEMBER }))).catalogue, null);
	assertEquals(
		consoleViews(lane.laneZones(inConsole({ capabilities: ["publish_listings"] }))).catalogue?.team,
		"north-loop",
	);
	for (const capabilities of [OWNER, NO_INVITE, MEMBER, ["publish_listings"] as const]) {
		const zones = lane.laneZones(inConsole({ capabilities }));
		assertEquals(
			consoleViews(zones).catalogue !== null,
			mayViewModule("catalogue", "team", capabilities),
			"the section and the module gate disagree",
		);
	}
});

Deno.test("lane (#316): on the console the title is the current page and + opens the modal in place", () => {
	const zone = catalogueOf(lane.laneZones(inConsole({ module: "catalogue", listing: null })));
	assertEquals(zone.current, true);
	assertEquals(zone.listing, null);
	assertEquals(zone.createInPlace, true);
	assertEquals(zone.createLabel, "New listing");
	assertEquals(zone.canCreate, true);
});

Deno.test("lane (#316): off the console + links to the console with the create modal open", () => {
	for (
		const input of [
			inConsole(),
			inConsole({ module: "members" }),
			inConsole({ module: "catalogue", listing: "svc-brand-sprint" }),
		]
	) {
		const zone = catalogueOf(lane.laneZones(input));
		assertEquals(zone.current, false);
		assertEquals(zone.createInPlace, false);
		assertEquals(zone.createHref, "/teams/north-loop/catalogue?create=1");
	}
	const onListing = catalogueOf(
		lane.laneZones(inConsole({ module: "catalogue", listing: "svc-brand-sprint" })),
	);
	assertEquals(onListing.listing, "svc-brand-sprint");
	assertEquals(
		catalogueOf(lane.laneZones(inConsole({ module: "overview", listing: "svc-brand-sprint" })))
			.listing,
		null,
		"a listing slug off the catalogue marks nothing",
	);
});

Deno.test("lane (#316): an archived team offers no New listing", () => {
	assertEquals(catalogueOf(lane.laneZones(inConsole({ status: "archived" }))).canCreate, false);
});

Deno.test("lane (#316): the section reads the console's resting statuses, newest first, one lane's worth", () => {
	assertEquals(lane.LANE_LISTING_PARAMS, {
		type: "all",
		status: ["draft", "published", "paused"],
		sort: "recent",
		limit: lane.LANE_LISTING_LIMIT,
	});
});

Deno.test("lane (#316): a catalogue page projects to the lane's first page and the console's total", () => {
	const items = Array.from({ length: lane.LANE_LISTING_LIMIT + 5 }, (_, i) => ({
		...listing({ id: `svc-item-${i}`, title: `Item ${i}` }),
		price: { kind: "fixed" },
		updatedLabel: "Edited today",
	}));
	const listings = lane.laneListingsOf({ items, total: 41 });
	assertEquals(listings.total, 41);
	assertEquals(listings.items.length, lane.LANE_LISTING_LIMIT);
	assertEquals(listings.items[0], listing({ id: "svc-item-0", title: "Item 0" }));
});

Deno.test("lane (#316): listing rows link into the team's item workspace, the rendered one marked", () => {
	const zone = catalogueOf(
		lane.laneZones(inConsole({ module: "catalogue", listing: "prd-type-kit" })),
	);
	const { rows, more } = lane.laneListingRows({
		items: [
			listing(),
			listing({ id: "prd-type-kit", title: "Type kit", kind: "product", status: "draft" }),
			listing({ id: "svc-retainer", title: "Retainer", status: "paused", needsAttention: true }),
		],
		total: 3,
	}, zone);
	assertEquals(rows.map((r) => [r.href, r.active, r.state]), [
		["/teams/north-loop/catalogue/svc-brand-sprint", false, null],
		["/teams/north-loop/catalogue/prd-type-kit", true, "Draft"],
		["/teams/north-loop/catalogue/svc-retainer", false, "Paused"],
	]);
	assertEquals(rows[2].needsAttention, true);
	assertEquals(more, null);
});

Deno.test("lane (#316): a catalogue larger than the lane hands the rest to the console", () => {
	const zone = catalogueOf(lane.laneZones(inConsole()));
	const { rows, more } = lane.laneListingRows({ items: [listing()], total: 34 }, zone);
	assertEquals(rows.length, 1);
	assertEquals(more, { label: "View all 34 listings", href: "/teams/north-loop/catalogue" });
	assertEquals(lane.laneListingRows({ items: [], total: 0 }, zone), { rows: [], more: null });
});

Deno.test("lane: the console header carries Back, the lifecycle Tag and the kebab; the search opens Z2", () => {
	const draft = lane.laneZones(inConsole({ status: "draft" }));
	assert(draft.header.mode === "console");
	assertEquals(draft.header.back, { href: "/teams", label: "Back to all teams" });
	assertEquals(draft.header.status, { label: "Draft", severity: "warning" });
	assertEquals(draft.header.menuLabel, "Team actions");
	assertEquals(draft.context.search, {
		label: "Search North Loop",
		placeholder: "Find views, channels, people…",
	});
	assertEquals(draft.context.invitations, null);

	const acting = lane.laneZones(inConsole({ acting: true, kind: "business" }));
	assert(acting.header.mode === "console");
	assertEquals(acting.header.back, { href: "/businesses", label: "Back to all businesses" });
	assertEquals(acting.header.status, { label: "Active", severity: "success" });
	assertEquals(acting.header.menuLabel, "Business actions");
});

Deno.test("lane (#306): the console footer is the acting pill, Invite member and Settings", () => {
	const off = lane.laneZones(inConsole({ status: "draft" }));
	assertEquals(off.footer.actAs?.label, "Act as team");
	const acting = lane.laneZones(inConsole({ acting: true, kind: "business" }));
	assertEquals(acting.footer.actAs?.action, "exit");
	assertEquals(acting.footer.actAs?.label, "Stop acting");
	// A console never draws the roster's create or its plan note.
	for (const capabilities of [OWNER, NO_INVITE, MEMBER]) {
		const zones = lane.laneZones(inConsole({ capabilities }));
		assertEquals(zones.footer.create, null);
		assertEquals(zones.footer.note, null);
	}
});

Deno.test("lane (#319): a console keeps the search and draws no segmented control", () => {
	// Members' People · Org chart moved to the footer rig, beside the zoom it shares a reading with.
	for (
		const module of ["overview", "members", "projects", "invitations", "payouts", "settings", null]
	) {
		const zones = lane.laneZones(inConsole({ module }));
		assertEquals(zones.context.partition, null, `${module} drew a segmented control`);
		assertEquals(zones.context.search.label, "Search North Loop");
		assertEquals(lane.laneZoneOrder(zones), ["header", "context", "views", "footer"]);
	}
});
// #endregion

// #region The footer's Invite member
Deno.test("lane: no Invite member inside a console without invite_members", () => {
	for (const kind of ["team", "business"] as const) {
		for (const capabilities of [NO_INVITE, MEMBER]) {
			for (const module of ["overview", "members", "invitations", "projects"]) {
				const zones = lane.laneZones(inConsole({ kind, capabilities, module }));
				assertEquals(zones.footer.invite, null, `${kind} ${module} offered an invite`);
			}
		}
	}
});

Deno.test("lane: Invite member is the same in-place action on every module (Decision #318)", () => {
	for (const kind of ["team", "business"] as const) {
		for (const module of ["members", "invitations", "payouts", "projects", "settings", null]) {
			assertEquals(
				lane.laneZones(inConsole({ kind, handle: "acme", module })).footer.invite,
				{ action: "invite", label: "Invite member" },
				`${kind} ${module}`,
			);
		}
	}
});

// Model-only: the zone ORDER the island renders. That the rendered lane follows it — each zone's
// controls inside its own zone, the zones emitted in this order — is the source scan further down.
Deno.test("lane (model): the zone order is Z1 → Z2 → Z3 → Z4 in every composition", () => {
	const rank = { header: 1, context: 2, views: 3, footer: 4 } as Record<string, number>;
	for (const zones of everyComposition()) {
		const order = lane.laneZoneOrder(zones);
		assertEquals(order[0], "header");
		assertEquals(order.at(-1), "footer");
		// The context zone always exists: it carries the search (Decision #307).
		assertEquals(order[1], "context");
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
	// Every partition the lane can read is one of its segments or its Invitations toggle, so a control
	// always shows the partition.
	const context = lane.laneZones(roster()).context;
	const segments = context.partition?.options.map((o) => o.value) ?? [];
	assert(context.invitations !== null);
	for (const tab of ["all", "owned", "member", "invitations", "archived"]) {
		const read = lane.lanePartition(tab);
		assert(segments.includes(read) || read === "invitations", `${tab} has no lane control`);
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

Deno.test("lane (#306): a hub's mark folds its modules' — counts summed, else a dot", () => {
	const signals = { invitations: { count: 2 }, spend: { count: 1 }, verification: { dot: true } };
	assertEquals(lane.hubSignal([{ key: "members" }, { key: "invitations" }], signals), { count: 2 });
	assertEquals(
		lane.hubSignal([{ key: "finance" }, { key: "spend" }, { key: "billing" }], signals),
		{ count: 1 },
	);
	assertEquals(lane.hubSignal([{ key: "settings" }, { key: "verification" }], signals), {
		dot: true,
	});
	assertEquals(lane.hubSignal([{ key: "calendar" }], signals), undefined);
	assertEquals(lane.channelUnreadLabel(0), null);
	assertEquals(lane.channelUnreadLabel(3), "3 unread");
});

Deno.test("lane (#306): the console search groups views, channels, projects and people", () => {
	const sources = {
		rows: [
			{
				key: "roster",
				label: "Members",
				href: "/teams/n/members",
				blurb: "Members, roles",
			},
			{ key: "files", label: "Files", href: "/teams/n/files", blurb: "The shared drive" },
		],
		channels: [
			{ slug: "general", topic: null },
			{ slug: "delivery-sync", topic: "Design to build handoffs" },
		],
		channelBase: "/teams/n/channels",
		projects: [{
			id: "prj-1",
			title: "Brand refresh",
			href: "/projects/prj-1",
			counterparty: "Acme",
		}],
		people: [{ id: "m-1", name: "Ravi Shah", handle: "ravi" }],
		membersHref: "/teams/n/members",
	};
	assertEquals(lane.consoleSearch("   ", sources), null);
	assertEquals(lane.consoleSearch("", sources), null);

	const members = lane.consoleSearch("MEMB", sources);
	assertEquals(members?.map((g) => g.id), ["views"]);
	assertEquals(members?.[0].hits[0].href, "/teams/n/members");

	const handoff = lane.consoleSearch("handoff", sources);
	assertEquals(handoff?.[0].hits, [{
		key: "channel:delivery-sync",
		label: "# delivery-sync",
		meta: "Design to build handoffs",
		href: "/teams/n/channels/delivery-sync",
	}]);

	assertEquals(lane.consoleSearch("acme", sources)?.[0].hits[0].href, "/projects/prj-1");
	assertEquals(
		lane.consoleSearch("ravi", sources)?.[0].hits[0].href,
		"/teams/n/members?member=ravi",
	);
	assertEquals(lane.consoleSearch("zzz", sources), []);

	// Each group stops at the limit.
	const many = {
		...sources,
		people: Array.from(
			{ length: 9 },
			(_, i) => ({ id: `m${i}`, name: `Ana ${i}`, handle: `a${i}` }),
		),
	};
	assertEquals(lane.consoleSearch("ana", many)?.[0].hits.length, lane.SEARCH_GROUP_LIMIT);
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
		"context",
		"views",
		"footer",
		"header",
		"context",
		"views",
		"footer",
	]);

	// Where each zone-bearing tag may open — in its zone's case and nowhere else in the island.
	const home: Record<string, string[]> = {
		LaneHead: ["header"],
		LaneBackLink: ["header"],
		EntityMenu: ["header"],
		LaneSearch: ["context"],
		LaneBar: ["context"],
		LaneList: ["views"],
		LaneSections: ["views"],
		// The views' New channel and the roster context's Invitations toggle.
		LaneIconButton: ["views", "context"],
		HubList: ["views"],
		ChannelList: ["views"],
		CatalogueList: ["views"],
		CatalogueAddButton: ["views"],
		LaneSearchResults: ["views"],
		ChannelCreateDialog: ["views"],
		ContextZone: ["context"],
		LaneTabs: ["context"],
		LaneFooterRig: ["footer"],
		ConsoleFooterRig: ["footer"],
	};
	for (const [tag, zones] of Object.entries(home)) {
		for (const c of cases) {
			if (!zones.includes(c.id)) {
				assertEquals(opens(c.body, tag), 0, `<${tag}> opens in the ${c.id} zone`);
			}
		}
	}
	// The search is the first thing each context zone draws.
	for (const c of cases.filter((c) => c.id === "context")) {
		const first = c.body.match(/<(Lane\w+|Button)\b/g)?.filter((t) =>
			t !== "<LaneBar"
		);
		assertEquals(
			first?.[0],
			"<LaneSearch",
			"the context zone opens on something other than the search",
		);
	}
	// Inside a console Channels is the LAST section, after Core operations and Governance.
	const consoleViews = cases.filter((c) => c.id === "views")[1].body;
	assert(
		consoleViews.indexOf("<ChannelList") > consoleViews.indexOf("views.sections.map("),
		"Channels is not the console lane's last section",
	);
	const catalogueAt = consoleViews.indexOf("<CatalogueList");
	assert(
		catalogueAt > consoleViews.indexOf("views.sections.map(") &&
			catalogueAt < consoleViews.indexOf("<ChannelList"),
		"Catalogue is not between the hub sections and Channels",
	);
	// Outside the cases only the zone components' own definitions may draw (the sections' builder, the
	// footer rigs' collapse toggle, acting pill and utilities): no zone control rides in the wrapper.
	for (
		const tag of ["LaneHead", "LaneList", "LaneTabs", "LaneSearch", "EntityMenu", "HubList"]
	) {
		assertEquals(opens(rest, tag), 0, `<${tag}> opens outside its zone`);
	}
	// The acting switch is the console footer's — a pill, folded to its icon in a compact lane — and
	// nowhere else in the lane.
	assertEquals(opens(text, "ContextSwitchControl"), 1);
	assert(/\(\["pill", "icon"\] as const\)\.map\(\(variant\)/.test(text));
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

Deno.test("lane: no raw storage access, and no control assigns location", () => {
	const text = source(LANE);
	assert(!/globalThis\.(localStorage|sessionStorage)/.test(text), "raw storage access");
	for (const file of [LANE, RAIL]) {
		assert(
			!/location\.(assign|replace|href\s*=)/.test(source(file)),
			`${file} navigates by script`,
		);
	}
});
// #endregion
