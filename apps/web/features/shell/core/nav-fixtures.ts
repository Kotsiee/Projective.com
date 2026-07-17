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

/** A compact quick-link surfaced under the sidebar's Dashboard disclosure. */
export interface DashboardSublink {
	label: string;
	href: string;
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
		href: "/business/monarch-labs",
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
];

const DASHBOARD_SUBLINKS: readonly DashboardSublink[] = [
	{ label: "Overview", href: "/dashboard" },
	{ label: "Earnings", href: "/dashboard/earnings" },
	{ label: "Activity", href: "/dashboard/activity" },
	{ label: "Reviews", href: "/dashboard/reviews" },
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

/** Compact Dashboard quick-links. Swap for `/api/dashboard/sublinks`. */
export function getDashboardSublinks(): readonly DashboardSublink[] {
	return DASHBOARD_SUBLINKS;
}

/** Header notifications. Swap for `/api/notifications`. */
export function getNotifications(): readonly NotificationItem[] {
	return NOTIFICATIONS;
}

/** Header basket lines. Swap for `/api/basket`. */
export function getBasketItems(): readonly BasketLine[] {
	return BASKET_LINES;
}
