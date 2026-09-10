import type { ExploreItem } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";
import {
	type CardSignal,
	FAST_REPLY_MINUTES,
	ratingSignals,
} from "@features/explore/core/card-signals.ts";

/**
 * View feature — pure, client-safe display helpers for the Entity View page. Label maps, the
 * recommendation-rail grouping, seller-signal derivation and deep-link builders shared by the server
 * components and the lane islands. No JSX and no side effects (SSR == island).
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

// #region Deep links
/** The "back to Explore / profile" href for the standalone page, honouring the render context. */
export function backHrefFor(ctx: HrefContext): string {
	return ctx.scope === "profile" ? `/${ctx.handle}` : "/explore";
}

/** Back link label. */
export function backLabelFor(ctx: HrefContext): string {
	return ctx.scope === "profile" ? "Back to profile" : "Back to Explore";
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

// #region Seller signals
/**
 * The earned trust markers the seller carries on THIS listing — "Top rated", "Fast replies".
 *
 * One rule, two renderers. The hero's seller line prints them as explanatory text links and the
 * conversion lane's identity band prints them as `.ex-status` chips, and both call this — because a
 * badge that appears in the lane and not eighteen inches to its left, on the same screen, is a data
 * question the reader cannot answer.
 *
 * The rating gate is the Explore card family's `ratingSignals`, imported rather than restated, so
 * "Top rated" means the same thing on the card that linked here as it does on the page it linked to.
 * The reply gate reuses that family's `FAST_REPLY_MINUTES` threshold.
 *
 * `responseMinutes` is a PARAMETER rather than read off the item, because a listing (a service, a
 * product) carries no reply history — only a profile-shaped item does. The server resolves the
 * seller's on the view payload, formatted from the same number the trust row prints, so the badge and
 * that row cannot state different response times.
 *
 * A missing datum yields NO badge. It never falls back to a neighbouring signal: "fast replies"
 * inferred from spare capacity is a promise about a different thing.
 */
export function sellerBadges(item: ExploreItem, responseMinutes?: number): CardSignal[] {
	const out: CardSignal[] = [...ratingSignals(item.rating)];
	const minutes = responseMinutes ??
		("responseMinutes" in item ? item.responseMinutes : undefined);
	if (typeof minutes === "number" && minutes <= FAST_REPLY_MINUTES) {
		out.push({ id: "fast-replies", label: "Fast replies" });
	}
	return out;
}
// #endregion
