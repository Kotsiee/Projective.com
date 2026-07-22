import type { ExploreItem } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";

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
			tags.push({ label: "Escrow project", tone: "mode" });
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
