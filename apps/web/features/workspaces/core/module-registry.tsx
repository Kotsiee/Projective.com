import type { VNode } from "preact";
import type { WorkspaceCapability, WorkspaceKind } from "@projective/types/workspace";
import {
	AnalyticsGlyph,
	BillingGlyph,
	CalendarGlyph,
	CatalogueGlyph,
	FinanceGlyph,
	InvitationsGlyph,
	MembersGlyph,
	MessagesGlyph,
	OverviewGlyph,
	PayoutsGlyph,
	ProfileGlyph,
	ProjectsGlyph,
	RoleGlyph,
	SettingsGlyph,
	SpendGlyph,
	StandingGlyph,
	TalentGlyph,
	VerificationGlyph,
} from "./workspace-glyphs.tsx";

/**
 * module-registry — **the extensibility core of the workspace surface.**
 *
 * ONE array ({@link MODULES}) is the single source five separate mechanisms derive from:
 *
 *   1. **The entity lane's grouped nav** — the sections and their ordered items.
 *   2. **The `[module]` route validator** — an unknown segment is not a module, so it 404s; a known one
 *      the viewer may not open redirects rather than refusing.
 *   3. **The permission gate** — what a given member is allowed to see at all.
 *   4. **The collapsed 48px icon rail** — the same items, same order, glyph-only.
 *   5. **The header band tabs** — the module's identity in the chrome.
 *
 * Adding a module is therefore **one array entry plus one component file**. Nothing else needs editing:
 * no nav list to keep in sync, no route table, no rail duplicate, no second permission switch. Five
 * hand-maintained copies of one list is how a nav starts disagreeing with its own routes, and this file
 * exists specifically so that cannot happen here.
 *
 * ### Why `permission` is a FUNCTION of kind
 * The two entity kinds are one architecture parameterised by {@link WorkspaceKind}, and the capability
 * that guards a module is not always the same on both sides. A team's Finance module is an earnings
 * ledger, so it is gated on `manage_finances`; a business's Finance module is the pooled wallet its own
 * members fund, so it is gated on `contribute_funds` — a contributor has an obvious right to see the
 * pool they are paying into, while having no business rewriting policy. Encoding that as
 * `permission: (kind) => …` keeps the difference a **capability table** rather than a forked module list
 * or an `if (kind === …)` buried in a nav component.
 *
 * ### Why `permission` must be able to return `null`
 * `null` means *every active member may view this*. It is not a convenience — it is what guarantees the
 * invariant **"never 404 a user out of their own workspace."** A member with no granted capabilities at
 * all still belongs to the entity and must land somewhere real: Overview, Members, Calendar, Messages,
 * Projects and Standing are all permissionless, so {@link firstModuleFor} can always resolve a landing
 * module. If every module required a capability, the least-privileged member — exactly the person most
 * likely to be confused — would be bounced out of a workspace they are legitimately in.
 *
 * ### Purity
 * This module is deliberately dependency-light: types, glyph VNodes, nothing else. No signals, no
 * `@server/services`, no DOM. That is what lets BOTH a server-side slot resolver (`*-slot.tsx`, running
 * during SSR) and a client island import the same registry and reach the same conclusions — which is the
 * only reason the first painted byte can already show the correct nav for the correct viewer.
 */

// #region Vocabulary
/**
 * Every module key. This union IS the `[module]` route's accepted vocabulary — a segment outside it is
 * not a module and never reaches a component.
 */
export type ModuleKey =
	| "overview"
	| "projects"
	| "catalogue"
	| "calendar"
	| "messages"
	| "members"
	| "roles"
	| "invitations"
	| "finance"
	| "payouts"
	| "spend"
	| "billing"
	| "talent"
	| "analytics"
	| "standing"
	| "profile"
	| "verification"
	| "settings";

/**
 * The lane's section headings, in render order. A group is a reading aid, not a permission boundary —
 * it disappears entirely when the viewer may see none of its modules, so an empty heading never
 * advertises something withheld.
 */
export type ModuleGroup = "Workspace" | "People" | "Money" | "Growth" | "Admin";

/** The lane's groups in display order. */
export const MODULE_GROUPS: readonly ModuleGroup[] = [
	"Workspace",
	"People",
	"Money",
	"Growth",
	"Admin",
];

/** One module: everything the lane, the rail, the header and the route validator need to know. */
export interface WorkspaceModule {
	/** Stable key — also the URL segment (`/teams/:id/members`). */
	key: ModuleKey;
	/** Sentence-case label for the lane, the rail's tooltip, and the header band. */
	label: string;
	/** Which lane section it sits in. */
	group: ModuleGroup;
	/** The 1em `currentColor` glyph. Clone it (`cloneGlyph`) when rendering in two places at once. */
	glyph: VNode;
	/** Which entity kinds render it at all. */
	kinds: readonly WorkspaceKind[];
	/**
	 * The capability required to view it, resolved per kind, or `null` when every active member may.
	 * See the file header for why `null` is load-bearing rather than lazy.
	 */
	permission: (kind: WorkspaceKind) => WorkspaceCapability | null;
	/** One line for the rail tooltip's second row and the module's own header — what it is FOR. */
	blurb: string;
}
// #endregion

// #region The registry
/** Both kinds — the common spine of the surface. */
const BOTH: readonly WorkspaceKind[] = ["team", "business"];
/** Seller side only. */
const TEAM: readonly WorkspaceKind[] = ["team"];
/** Buyer side only. */
const BUSINESS: readonly WorkspaceKind[] = ["business"];

/** Every member may view — the permissionless landing set. */
const OPEN = (): null => null;

/**
 * The registry. Order within a group is display order; groups follow {@link MODULE_GROUPS}.
 *
 * To add a module: append an entry here and create its component. To retire one: remove the entry (the
 * route stops resolving, the lane and rail stop offering it, the gate stops considering it) — there is
 * no second place to remember.
 */
export const MODULES: readonly WorkspaceModule[] = [
	// --- Workspace ---------------------------------------------------------------------------------
	{
		key: "overview",
		label: "Overview",
		group: "Workspace",
		glyph: OverviewGlyph,
		kinds: BOTH,
		// The guaranteed landing module. This one is permissionless by contract, not by judgement.
		permission: OPEN,
		blurb: "What is happening across the whole entity right now.",
	},
	{
		key: "projects",
		label: "Projects",
		group: "Workspace",
		glyph: ProjectsGlyph,
		kinds: BOTH,
		// Members see the work the entity is doing; only `manage_projects` may change it, which is
		// enforced inside the module, not by hiding the module.
		permission: OPEN,
		blurb: "Engagements the entity is delivering or has commissioned.",
	},
	{
		key: "catalogue",
		label: "Catalogue",
		group: "Workspace",
		glyph: CatalogueGlyph,
		kinds: TEAM,
		permission: () => "publish_listings",
		blurb: "The services and products the team offers as one seller.",
	},
	{
		key: "calendar",
		label: "Calendar",
		group: "Workspace",
		glyph: CalendarGlyph,
		kinds: BOTH,
		permission: OPEN,
		blurb: "The shared schedule — sessions, milestones and deadlines.",
	},
	{
		key: "messages",
		label: "Messages",
		group: "Workspace",
		glyph: MessagesGlyph,
		kinds: BOTH,
		permission: OPEN,
		blurb: "Conversations addressed to the entity rather than to a person.",
	},

	// --- People -----------------------------------------------------------------------------------
	{
		key: "members",
		label: "Members",
		group: "People",
		glyph: MembersGlyph,
		kinds: BOTH,
		// Knowing who else is in the entity is basic membership information; acting on them is not.
		permission: OPEN,
		blurb: "Who belongs, what they may do, and how loaded they are.",
	},
	{
		key: "roles",
		label: "Roles",
		group: "People",
		glyph: RoleGlyph,
		kinds: BOTH,
		permission: () => "manage_roles",
		blurb: "Preset and custom roles, and the capability matrix behind them.",
	},
	{
		key: "invitations",
		label: "Invitations",
		group: "People",
		glyph: InvitationsGlyph,
		kinds: BOTH,
		permission: () => "invite_members",
		blurb: "Invitations sent, join requests received, and share links.",
	},

	// --- Money ------------------------------------------------------------------------------------
	{
		key: "finance",
		label: "Finance",
		group: "Money",
		glyph: FinanceGlyph,
		kinds: BOTH,
		/**
		 * The clearest example of why this is a function of kind. A team's Finance is an earnings summary
		 * — reading it means reading the team's income, so it takes `manage_finances`. A business's
		 * Finance is the pooled wallet its members personally fund, so anyone who may contribute may see
		 * the pool; rewriting its policy is separately gated on the Spend module.
		 */
		permission: (kind) => kind === "team" ? "manage_finances" : "contribute_funds",
		blurb: "The entity's money at a glance, with a hand-off to the wallet.",
	},
	{
		key: "payouts",
		label: "Payouts",
		group: "Money",
		glyph: PayoutsGlyph,
		kinds: TEAM,
		permission: () => "manage_finances",
		blurb: "How a released payout splits across the people who did the work.",
	},
	{
		key: "spend",
		label: "Spend",
		group: "Money",
		glyph: SpendGlyph,
		kinds: BUSINESS,
		// A spender needs their own envelope and the request queue; the approval ladder itself is
		// edited only by `manage_finances`, enforced inside the module.
		permission: () => "spend_funds",
		blurb: "Limits, approval thresholds and the attributable pool ledger.",
	},
	{
		key: "billing",
		label: "Billing",
		group: "Money",
		glyph: BillingGlyph,
		kinds: BUSINESS,
		permission: () => "manage_finances",
		blurb: "Plan, invoices and what the platform charged, itemised.",
	},

	// --- Growth -----------------------------------------------------------------------------------
	{
		key: "talent",
		label: "Talent",
		group: "Growth",
		glyph: TalentGlyph,
		kinds: BUSINESS,
		permission: () => "hire",
		blurb: "The bench — freelancers and teams this business works with.",
	},
	{
		key: "analytics",
		label: "Analytics",
		group: "Growth",
		glyph: AnalyticsGlyph,
		kinds: BOTH,
		permission: () => "view_analytics",
		blurb: "How the entity is performing over time.",
	},
	{
		key: "standing",
		label: "Standing",
		group: "Growth",
		glyph: StandingGlyph,
		kinds: BOTH,
		// Standing is earned and publicly legible — withholding it from a member would hide the very
		// thing their own work moves.
		permission: OPEN,
		blurb: "The earned rung, its inputs, and what the next one changes.",
	},

	// --- Admin ------------------------------------------------------------------------------------
	{
		key: "profile",
		label: "Profile",
		group: "Admin",
		glyph: ProfileGlyph,
		kinds: BOTH,
		permission: () => "edit_profile",
		blurb: "The public page — edited here, presented at the entity's handle.",
	},
	{
		key: "verification",
		label: "Verification",
		group: "Admin",
		glyph: VerificationGlyph,
		kinds: BOTH,
		permission: () => "manage_settings",
		blurb: "Identity checks that unlock payouts and pooled spending.",
	},
	{
		key: "settings",
		label: "Settings",
		group: "Admin",
		glyph: SettingsGlyph,
		kinds: BOTH,
		permission: () => "manage_settings",
		blurb: "Handle, defaults, ownership transfer and archiving.",
	},
];
// #endregion

// #region Lookups
/** Fast key → module index, built once. */
const BY_KEY: Record<string, WorkspaceModule> = Object.fromEntries(
	MODULES.map((m) => [m.key, m]),
);

/** The module for a key, or `undefined` when the key is not in the registry. */
export function moduleFor(key: string): WorkspaceModule | undefined {
	return BY_KEY[key];
}

/**
 * Whether a raw URL segment names a registered module. The `[module]` route's first gate: a segment
 * that fails this is a genuine 404, distinct from a real module the viewer may not open (which
 * redirects instead — see {@link firstModuleFor}).
 */
export function isModuleKey(key: string): key is ModuleKey {
	return key in BY_KEY;
}

/** Every module a kind renders, regardless of the viewer's capabilities. */
export function modulesForKind(kind: WorkspaceKind): WorkspaceModule[] {
	return MODULES.filter((m) => m.kinds.includes(kind));
}

/**
 * The modules a specific viewer may see: registered for this kind, and either permissionless or covered
 * by the viewer's server-resolved effective capabilities.
 *
 * `capabilities` must be the **server-resolved** effective set (`WorkspaceDetail.viewerCapabilities`),
 * never a client recomputation of `role ∪ granted − revoked` — the whole point of the fat service
 * returning it is that the nav, the gate and the guard agree on one answer.
 */
export function modulesForViewer(
	kind: WorkspaceKind,
	capabilities: readonly WorkspaceCapability[],
): WorkspaceModule[] {
	const held = new Set(capabilities);
	return modulesForKind(kind).filter((m) => {
		const needed = m.permission(kind);
		return needed === null || held.has(needed);
	});
}

/** Whether a viewer may open a specific module. The route gate and the lane use the same predicate. */
export function mayViewModule(
	key: string,
	kind: WorkspaceKind,
	capabilities: readonly WorkspaceCapability[],
): boolean {
	const module = moduleFor(key);
	if (!module || !module.kinds.includes(kind)) return false;
	const needed = module.permission(kind);
	return needed === null || capabilities.includes(needed);
}

/**
 * The module a viewer should land on — the one Overview's permissionless contract guarantees exists.
 *
 * Falls back to `overview` if a future edit ever leaves the viewer's visible set empty, so this function
 * is total: it can never hand a route resolver `undefined` and turn a legitimate member's own workspace
 * into a dead end.
 */
export function firstModuleFor(
	kind: WorkspaceKind,
	capabilities: readonly WorkspaceCapability[],
): ModuleKey {
	return modulesForViewer(kind, capabilities)[0]?.key ?? "overview";
}

/** A lane section: a heading and the modules under it, already viewer-filtered. */
export interface ModuleSection {
	group: ModuleGroup;
	modules: WorkspaceModule[];
}

/**
 * The lane's grouped nav for a viewer. Empty groups are dropped rather than rendered as bare headings —
 * a heading over nothing tells the reader something is being kept from them, which is both noise and a
 * small information leak.
 */
export function moduleSectionsForViewer(
	kind: WorkspaceKind,
	capabilities: readonly WorkspaceCapability[],
): ModuleSection[] {
	const visible = modulesForViewer(kind, capabilities);
	return MODULE_GROUPS
		.map((group) => ({ group, modules: visible.filter((m) => m.group === group) }))
		.filter((section) => section.modules.length > 0);
}
// #endregion
