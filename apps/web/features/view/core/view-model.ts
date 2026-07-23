import type { ExploreItem } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";
import type { ProfileGlyph } from "@features/profile/components/profile-glyphs.tsx";

/**
 * View feature — pure, client-safe display helpers for the Entity View page. Label maps, badge-tag
 * derivation, and deep-link builders shared by the server components and the sidebar/gallery islands.
 * No JSX and no side effects (SSR == island).
 */

// #region Labels
/** Human label for an entity format — the hero eyebrow + badge. */
export const ENTITY_LABEL: Record<ExploreItem["type"], string> = {
	users: "Individual",
	freelancers: "Freelancer",
	teams: "Team",
	businesses: "Business",
	services: "Service",
	projects: "Project",
	products: "Product",
	articles: "Article",
};
// #endregion

// #region Entity grouping (recommendation rails)
/** Plural section heading for each entity format — the label above a grouped recommendation block. */
export const ENTITY_GROUP_LABEL: Record<ExploreItem["type"], string> = {
	services: "Services",
	products: "Products",
	projects: "Active Projects",
	articles: "Articles",
	freelancers: "Freelancers",
	teams: "Teams",
	businesses: "Businesses",
	users: "People",
};

/** The order grouped blocks are presented in (transactional formats first, then people/orgs). */
export const ENTITY_GROUP_ORDER: ExploreItem["type"][] = [
	"services",
	"products",
	"projects",
	"articles",
	"freelancers",
	"teams",
	"businesses",
	"users",
];

/** One dedicated, single-type block within a recommendation section. */
export interface EntityGroup {
	type: ExploreItem["type"];
	label: string;
	items: ExploreItem[];
}

/**
 * Bucket a mixed recommendation list into dedicated single-type groups, in {@link ENTITY_GROUP_ORDER}.
 * Empty types are dropped, so a section only renders the blocks it actually has items for.
 */
export function groupItemsByType(items: ExploreItem[]): EntityGroup[] {
	const buckets = new Map<ExploreItem["type"], ExploreItem[]>();
	for (const item of items) {
		const bucket = buckets.get(item.type);
		if (bucket) bucket.push(item);
		else buckets.set(item.type, [item]);
	}
	return ENTITY_GROUP_ORDER
		.filter((type) => buckets.has(type))
		.map((type) => ({ type, label: ENTITY_GROUP_LABEL[type], items: buckets.get(type)! }));
}
// #endregion

// #region Badge tags
/** A badge chip in the hero details column. `tone` picks the visual treatment. */
export interface BadgeTag {
	label: string;
	tone: "category" | "mode" | "promoted";
}

/** Derive the hero badge row: category, engagement/delivery mode, and a Promoted pill when sponsored. */
export function badgeTagsFor(item: ExploreItem): BadgeTag[] {
	const tags: BadgeTag[] = [];
	switch (item.type) {
		case "services":
			tags.push({ label: item.category, tone: "category" });
			tags.push({ label: item.serviceType, tone: "mode" });
			break;
		case "products":
			tags.push({ label: item.category, tone: "category" });
			tags.push({ label: "Digital product", tone: "mode" });
			break;
		case "projects":
			tags.push({ label: item.stage, tone: "category" });
			tags.push({
				label: item.classification === "pipeline" ? "Pipeline" : "One-Off",
				tone: "mode",
			});
			break;
		default:
			if ("craft" in item && item.craft) tags.push({ label: item.craft, tone: "category" });
			break;
	}
	if (item.sponsored) tags.push({ label: "Promoted", tone: "promoted" });
	return tags;
}
// #endregion

// #region Deep links
/** The "back to Explore / profile" href for the standalone page, honouring the render context. */
export function backHrefFor(ctx: HrefContext): string {
	return ctx.scope === "profile" ? `/${ctx.handle}` : "/explore";
}

/** Back link label. */
export function backLabelFor(ctx: HrefContext): string {
	return ctx.scope === "profile" ? "Back to profile" : "Back to Explore";
}

/** The session-schedule leaf for session-format services (`/view/[id]/schedule`). */
export function scheduleHrefFor(item: ExploreItem, ctx: HrefContext): string {
	const base = ctx.scope === "profile" ? `/${ctx.handle}/view/${item.id}` : `/view/${item.id}`;
	return `${base}/schedule`;
}

/** The direct-message deep link for the "Message" CTA (canonical DM namespace). */
export function messageHrefFor(item: ExploreItem): string {
	return `/messages/dm-${item.owner.handle.replace(/^@/, "")}`;
}

/** The sign-in bounce that returns to the current item after auth. */
export function signInHref(item: ExploreItem, ctx: HrefContext): string {
	const target = ctx.scope === "profile"
		? `/${ctx.handle}/view/${item.id}?type=${item.type}`
		: `/view/${item.id}?type=${item.type}`;
	return `/login?redirectTo=${encodeURIComponent(target)}`;
}
// #endregion

// #region Lane header contextual menu
/**
 * The entity noun used in the side-nav kebab's `Report …` action (and share copy). Session-format
 * services report as a "Session"; everything else maps to its natural noun, falling back to the neutral
 * "Listing".
 */
export function entityNounFor(item: ExploreItem): string {
	switch (item.type) {
		case "services":
			return item.serviceType === "Session" || item.serviceType === "Group Session"
				? "Session"
				: "Service";
		case "products":
			return "Product";
		case "projects":
			return "Project";
		case "articles":
			return "Article";
		case "teams":
			return "Team";
		case "businesses":
			return "Business";
		case "users":
		case "freelancers":
			return "Profile";
		default:
			return "Listing";
	}
}

/** One entry in the side-nav header's contextual kebab menu. `key` drives the island's handler. */
export interface LaneMenuAction {
	key: "copy-link" | "socials" | "embed" | "collection" | "report";
	label: string;
	glyph: ProfileGlyph;
	/** Moderation/destructive intent — tinted via `[data-danger]`. */
	danger?: boolean;
}

/**
 * The contextual action list for the Entity View side-nav kebab, tailored to the entity type: the
 * shared share/save affordances, an embed-snippet action for embeddable listings (service · product ·
 * project · article), and the type-specific `Report {noun}` moderation action pinned last.
 */
export function laneMenuActionsFor(item: ExploreItem): LaneMenuAction[] {
	const embeddable = item.type === "services" || item.type === "products" ||
		item.type === "projects" || item.type === "articles";
	const actions: LaneMenuAction[] = [
		{ key: "copy-link", label: "Copy link", glyph: "link" },
		{ key: "socials", label: "Share to socials", glyph: "share" },
	];
	if (embeddable) actions.push({ key: "embed", label: "Embed code", glyph: "embed" });
	actions.push({ key: "collection", label: "Save to collection", glyph: "bookmark" });
	actions.push({
		key: "report",
		label: `Report ${entityNounFor(item)}`,
		glyph: "flag",
		danger: true,
	});
	return actions;
}
// #endregion
