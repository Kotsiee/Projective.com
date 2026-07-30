/**
 * nav-fixtures — local, swappable stand-ins for the data-backed portions of the navigation shell
 * (thin-frontend pattern, root CLAUDE.md §10 / Decisions #10–#13). These are dumb fixtures the shell
 * islands read directly; a later pass swaps each `getX()` for a `fetch("/api/…")` call returning the
 * same shape, with zero component churn. No Supabase / DB access here (islands stay dumb).
 */

// #region Types
/** A recently-active workspace surfaced under the sidebar's Projects disclosure (YouTube-style). */
export interface RecentWorkspace {
	/** Stable id (route slug). */
	id: string;
	/** Display name. */
	label: string;
	/** Which entity kind this is — drives the leading glyph/tint. */
	kind: "project" | "team" | "business";
	/** Destination route. */
	href: string;
	/** Owner display name (avatar alt / initials fallback). */
	owner: string;
	/** Owner profile picture — the nested link shows this circular avatar instead of a generic icon. */
	ownerAvatar: string;
	/** Whether this workspace has an unseen update (drives a pulsing dot, never a count). */
	hasUpdate?: boolean;
}

/**
 * A products-&-services offering surfaced under the sidebar's "Products & Services" disclosure
 * (freelancers/teams only). Kept distinct from {@link RecentWorkspace} — an offering shows its own
 * cover thumbnail, not an owner avatar.
 */
export interface OfferingSublink {
	/** Stable id (route slug). */
	id: string;
	/** Display name. */
	label: string;
	/** Whether this is a sellable service or a digital product — drives the leading glyph. */
	kind: "service" | "product";
	/** Destination route. */
	href: string;
}

/**
 * Account-level navigation capabilities — the chrome-only flags that gate the role/context-sensitive
 * sidebar destinations (Analytics · Teams · Businesses · Products & Services). Unlike the JWT-derived
 * {@link UserContext} (which describes the *active* context), these describe the *account's* standing
 * memberships and enabled surfaces, which the context alone can't express. A later pass swaps
 * {@link getAccountCapabilities} for `/api/account/capabilities` with zero component churn. Chrome only
 * — every destination re-checks capability server-side + under RLS on navigation.
 */
export interface AccountCapabilities {
	/** The user is a member of at least one team (surfaces Analytics even for a plain client). */
	belongsToTeam: boolean;
	/** The user is a member of at least one business. */
	belongsToBusiness: boolean;
	/** The user has switched their account into a business (seller-side) account. */
	businessAccountEnabled: boolean;
}

/** A team/business the user belongs to — a switch target in the account popover's context switcher. */
export interface MembershipEntry {
	/** Stable id (also the workspace route slug). */
	id: string;
	/** Display name. */
	name: string;
	/** `@handle` (context-switch persistence + profile link). */
	handle: string;
	/** Entity avatar (Unsplash crop). */
	avatar: string;
	/** Short qualifier shown under the name (e.g. role or member count). */
	detail: string;
}

/** A row in the header Notifications drawer. */
export interface NotificationItem {
	/** Stable id. */
	id: string;
	/** Short headline. */
	title: string;
	/** Supporting line. */
	body: string;
	/** Relative time label (pre-formatted — no client clock). */
	time: string;
	/** Unseen — drives the pulsing tray dot + a per-row accent. */
	unread?: boolean;
	/** Actor avatar (Unsplash face) shown as the leading circle. */
	avatar?: string;
	/** Actor display name (avatar alt / initials fallback). */
	actor?: string;
}

/** A line item in the header Basket drawer. */
export interface BasketLine {
	/** Stable id. */
	id: string;
	/** Product/service title. */
	title: string;
	/** Seller display name. */
	seller: string;
	/** Pre-formatted price (display-only fixture; real money math is server-side). */
	price: string;
	/** Thumbnail image. */
	image: string;
}
// #endregion

// #region Fixtures
/** Unsplash portrait crops (open registry, per DESIGN_SYSTEM.md §C.4) used as owner avatars. */
const FACE = (id: string) =>
	`https://images.unsplash.com/${id}?auto=format&fit=facearea&facepad=3&w=96&h=96&q=80`;

const RECENT_WORKSPACES: readonly RecentWorkspace[] = [
	{
		id: "aurora-rebrand",
		label: "Aurora Rebrand",
		kind: "project",
		href: "/projects/aurora-rebrand",
		owner: "Mara Ellison",
		ownerAvatar: FACE("photo-1494790108377-be9c29b29330"),
		hasUpdate: true,
	},
	{
		id: "northwind",
		label: "Northwind Studio",
		kind: "team",
		href: "/teams/northwind",
		owner: "Daniel Okafor",
		ownerAvatar: FACE("photo-1500648767791-00dcc994a43e"),
	},
	{
		id: "monarch-labs",
		label: "Monarch Labs",
		kind: "business",
		href: "/businesses/monarch-labs",
		owner: "Priya Nair",
		ownerAvatar: FACE("photo-1438761681033-6461ffad8d80"),
		hasUpdate: true,
	},
	{
		id: "helio-app",
		label: "Helio App",
		kind: "project",
		href: "/projects/helio-app",
		owner: "Theo Marsh",
		ownerAvatar: FACE("photo-1507003211169-0a1dd7228f2d"),
	},
	{
		id: "atlas-collective",
		label: "Atlas Collective",
		kind: "team",
		href: "/teams/atlas-collective",
		owner: "Lena Fischer",
		ownerAvatar: FACE("photo-1544005313-94ddf0286df2"),
	},
	{
		id: "verdant-studio",
		label: "Verdant Studio",
		kind: "business",
		href: "/businesses/verdant-studio",
		owner: "Ada Whitfield",
		ownerAvatar: FACE("photo-1487412720507-e7ab37603c6f"),
	},
];

/** Products & services the acting seller offers — the "Products & Services" disclosure list. */
const OFFERINGS: readonly OfferingSublink[] = [
	{
		id: "brand-identity-sprint",
		label: "Brand identity sprint",
		kind: "service",
		href: "/services/brand-identity-sprint",
	},
	{
		id: "landing-in-a-week",
		label: "Landing page in a week",
		kind: "service",
		href: "/services/landing-in-a-week",
	},
	{
		id: "aurora-ui-kit",
		label: "Aurora UI Kit — Pro",
		kind: "product",
		href: "/products/aurora-ui-kit",
	},
	{
		id: "icon-line-set",
		label: "640-icon line set",
		kind: "product",
		href: "/products/icon-line-set",
	},
];

/** The account's standing capabilities — chrome-only fixture. Swap for `/api/account/capabilities`. */
const ACCOUNT_CAPABILITIES: AccountCapabilities = {
	belongsToTeam: true,
	belongsToBusiness: true,
	businessAccountEnabled: true,
};

/** Teams the user belongs to — context-switcher targets. Swap for `/api/context/memberships?kind=team`. */
const TEAM_MEMBERSHIPS: readonly MembershipEntry[] = [
	{
		id: "northwind",
		name: "Northwind Studio",
		handle: "northwind",
		avatar: FACE("photo-1500648767791-00dcc994a43e"),
		detail: "Admin · 6 members",
	},
	{
		id: "atlas-collective",
		name: "Atlas Collective",
		handle: "atlascollective",
		avatar: FACE("photo-1544005313-94ddf0286df2"),
		detail: "Member · 12 members",
	},
];

/** Businesses the user belongs to — context-switcher targets. Swap for `/api/context/memberships?kind=business`. */
const BUSINESS_MEMBERSHIPS: readonly MembershipEntry[] = [
	{
		id: "monarch-labs",
		name: "Monarch Labs",
		handle: "monarchlabs",
		avatar: FACE("photo-1438761681033-6461ffad8d80"),
		detail: "Owner",
	},
	{
		id: "verdant-studio",
		name: "Verdant Studio",
		handle: "verdantstudio",
		avatar: FACE("photo-1487412720507-e7ab37603c6f"),
		detail: "Admin",
	},
];

const NOTIFICATIONS: readonly NotificationItem[] = [
	{
		id: "n1",
		title: "Mara approved a milestone",
		body: "Aurora Rebrand · Stage 2 payment released from escrow.",
		time: "12m",
		unread: true,
		actor: "Mara Ellison",
		avatar: FACE("photo-1494790108377-be9c29b29330"),
	},
	{
		id: "n2",
		title: "New message from Daniel",
		body: "“Can we hop on a quick call about the handoff?”",
		time: "1h",
		unread: true,
		actor: "Daniel Okafor",
		avatar: FACE("photo-1500648767791-00dcc994a43e"),
	},
	{
		id: "n3",
		title: "Priya left a 5-star review",
		body: "Monarch Labs · “Exceptional, delivered ahead of schedule.”",
		time: "3h",
		actor: "Priya Nair",
		avatar: FACE("photo-1438761681033-6461ffad8d80"),
	},
	{
		id: "n4",
		title: "Weekly summary ready",
		body: "3 projects advanced · 2 invoices settled.",
		time: "1d",
		actor: "Projective",
	},
	// Finance events surfaced (read-only) into the existing notification tray — escrow / payout /
	// funding / invoice / cap / approval (Wallet & Finance, root CLAUDE.md §8 Decision #55).
	{
		id: "n5",
		title: "Escrow funded",
		body: "Helia wallet redesign · Stage 2 escrow is now funded.",
		time: "20m",
		unread: true,
		actor: "Projective",
	},
	{
		id: "n6",
		title: "Payout cleared",
		body: "£945.71 landed in your bank account.",
		time: "5h",
		actor: "Projective",
	},
	{
		id: "n7",
		title: "Deposit failed",
		body: "Recurring top-up declined — update your funding card.",
		time: "1d",
		unread: true,
		actor: "Projective",
	},
	{
		id: "n8",
		title: "Spend approval requested",
		body: "Tomas requested £3,400 to fund a stage on Monarch Labs.",
		time: "1d",
		actor: "Tomas P.",
		avatar: FACE("photo-1500648767791-00dcc994a43e"),
	},
];

/** Unsplash product crops used as basket thumbnails. */
const SHOT = (id: string) =>
	`https://images.unsplash.com/${id}?auto=format&fit=crop&w=96&h=96&q=80`;

const BASKET_LINES: readonly BasketLine[] = [
	{
		id: "b1",
		title: "Aurora UI Kit — Pro",
		seller: "Monarch Labs",
		price: "$68",
		image: SHOT("photo-1618788372246-79faff0c3742"),
	},
	{
		id: "b2",
		title: "Brand identity sprint",
		seller: "Northwind Studio",
		price: "$1,200",
		image: SHOT("photo-1626785774573-4b799315345d"),
	},
	{
		id: "b3",
		title: "640-icon line set",
		seller: "Theo Marsh",
		price: "$24",
		image: SHOT("photo-1611162617213-7d7a39e9b1d7"),
	},
];
// #endregion

/** Most-recently-active workspaces for the Projects disclosure. Swap for `/api/workspaces/recent`. */
export function getRecentWorkspaces(): readonly RecentWorkspace[] {
	return RECENT_WORKSPACES;
}

/** Recent workspaces filtered to a single entity kind — powers the kind-strict sidebar disclosures. */
export function getWorkspacesByKind(kind: RecentWorkspace["kind"]): readonly RecentWorkspace[] {
	return RECENT_WORKSPACES.filter((w) => w.kind === kind);
}

/** Products & services the seller offers, for the "Products & Services" disclosure. Swap for `/api/offerings/recent`. */
export function getOfferings(): readonly OfferingSublink[] {
	return OFFERINGS;
}

/** The account's standing navigation capabilities. Swap for `/api/account/capabilities`. */
export function getAccountCapabilities(): AccountCapabilities {
	return ACCOUNT_CAPABILITIES;
}

/** Teams the user can switch into. Swap for `/api/context/memberships?kind=team`. */
export function getTeamMemberships(): readonly MembershipEntry[] {
	return TEAM_MEMBERSHIPS;
}

/** Businesses the user can switch into. Swap for `/api/context/memberships?kind=business`. */
export function getBusinessMemberships(): readonly MembershipEntry[] {
	return BUSINESS_MEMBERSHIPS;
}

/** Header notifications. Swap for `/api/notifications`. */
export function getNotifications(): readonly NotificationItem[] {
	return NOTIFICATIONS;
}

/** Header basket lines. Swap for `/api/basket`. */
export function getBasketItems(): readonly BasketLine[] {
	return BASKET_LINES;
}
