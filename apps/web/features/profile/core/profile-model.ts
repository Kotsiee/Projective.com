import type { UserContext } from "@projective/types/auth";
import {
	LEGACY_TAB_TARGET,
	LegacyProfileTab,
	normalizeHandle,
	type ProfileKind,
	ProfileTab,
	type ProfileView,
	type ReviewEntry,
} from "@projective/types/profile";
import { FAST_REPLY_MINUTES } from "@features/explore/core/card-signals.ts";
import { type PriceAmount, serviceStartingPrice } from "@features/explore/core/pricing.ts";
import type { ServiceItem } from "../types/profile-types.ts";

/**
 * profile-model — the pure, JSX-free brains of the `/[handle]` profile: the four-section tab matrix,
 * labels + route segments, active-tab / legacy-redirect / own-profile resolution, the CTA rule, the
 * review-stance filter, and the at-a-glance derivations (reply speed, estimated spend). Imported
 * freely by islands, components, and routes (no DOM, no server deps).
 */

// #region Tab labels + segments
/** Human label per section (the tab-bar text + the sub-route title). */
export const TAB_LABEL: Record<ProfileTab, string> = {
	work: "Work",
	experience: "Experience",
	reviews: "Reviews",
	posts: "Posts",
};

/** Route segment per section. `work` is the index (`/[handle]`); the rest are `/[handle]/<segment>`. */
export function tabSegment(tab: ProfileTab): string {
	return tab === "work" ? "" : tab;
}
// #endregion

// #region Entity tab matrix
/**
 * The sections shown for a profile kind (root CLAUDE.md §8 Decision #96). Work · Reviews · Posts are
 * universal; **Experience is an individual's section** — a career history, degrees and personal
 * certifications belong to a person, and a team / business / organisation has no such ledger, so
 * rendering the tab for them would be an empty section with a name on it.
 */
export function tabsFor(kind: ProfileKind): ProfileTab[] {
	switch (kind) {
		case "freelancer":
		case "client":
			return ["work", "experience", "reviews", "posts"];
		case "team":
		case "business":
		case "organisation":
			return ["work", "reviews", "posts"];
	}
}

/** The section the bare `/[handle]` index renders — Work, for every kind. */
export function defaultTabFor(_kind: ProfileKind): ProfileTab {
	return "work";
}
// #endregion

// #region Active tab + paths
/** DOM id of the tab-sections region — the hero's rating figure scroll-links here. */
export const TABS_ANCHOR = "profile-sections";

/** DOM id of the standalone Services row above the sections — the hero's Hire control lands here. */
export const SERVICES_ANCHOR = "profile-services";

/**
 * Parse the active section from a pathname. `null` when there is no sub-segment (the `/@handle`
 * index, which the caller resolves to {@link defaultTabFor}) or the segment is not a section.
 */
export function activeTabOf(pathname: string): ProfileTab | null {
	const segs = pathname.split("/").filter(Boolean); // [handle, segment?, …]
	const segment = segs[1];
	if (!segment) return null;
	const parsed = ProfileTab.safeParse(segment);
	return parsed.success ? parsed.data : null;
}

/**
 * Where a RETIRED tab segment now lives, or `null` when the segment was never a profile tab. The
 * `[tab]` route answers a legacy segment with a 308 to this target — a bookmark to
 * `/@handle/portfolio` lands on Work rather than "Section not found". `work` itself is also
 * canonicalised to the bare index so one section has one address.
 */
export function legacyTabTarget(segment: string): ProfileTab | null {
	if (segment === "work") return "work";
	const parsed = LegacyProfileTab.safeParse(segment);
	return parsed.success ? LEGACY_TAB_TARGET[parsed.data] : null;
}

/** Build the deep-link for a section. `handle` carries the leading `@` (canonical, Decision #3). */
export function tabHref(handle: string, tab: ProfileTab): string {
	const seg = tabSegment(tab);
	return seg ? `/${handle}/${seg}` : `/${handle}`;
}

/**
 * Deep-link to the Reviews section that also SCROLLS the tab region into view — the hero's rating
 * figure targets it, so a full navigation lands on the reviews rather than at the top of the hero.
 */
export function reviewsHref(handle: string): string {
	return `${tabHref(handle, "reviews")}#${TABS_ANCHOR}`;
}
// #endregion

// #region Ownership + CTA
/**
 * Whether the acting user owns this profile — unlocks the owner chrome (inline story editing, the
 * image pickers, the Settings CTA). Matches on the hydrated `userId` OR the acting `@handle` (skeleton
 * tokens may carry only one). Guests never match.
 */
export function isOwnProfile(
	profile: ProfileView,
	context: UserContext | undefined | null,
): boolean {
	if (!context || context.role === "guest") return false;
	if (context.userId && context.userId === profile.userId) return true;
	if (context.handle && normalizeHandle(context.handle) === normalizeHandle(profile.handle)) {
		return true;
	}
	return false;
}

/**
 * The hero's action rig for a VISITOR.
 *
 * A SELLER (freelancer · team) leads with **Hire** — the prominent primary — and folds Message and
 * Follow into compact icon-only secondaries beside it. Hire is honest about what it can name: it
 * lands on the seller's Services row when there is a listing to buy (`target: "services"`), and
 * opens the conversation when there is none (`target: "message"`) — the only way to hire somebody
 * with nothing listed is to ask. A BUYER entity (client · business · organisation) cannot be hired,
 * so Message stays its primary with Follow as a text secondary, exactly as before.
 */
export interface ProfileCta {
	/** Which rig the hero draws. */
	layout: "hire" | "message";
	/** The primary control's label. */
	primary: "Hire" | "Message";
	/** Where a `Hire` primary lands; `null` for the message rig. */
	target: "services" | "message" | null;
}

/** Whether the kind is a seller — the only kind that can be hired. */
export function isSellerKind(kind: ProfileKind): boolean {
	return kind === "freelancer" || kind === "team";
}

export function ctaFor(kind: ProfileKind, hasServices: boolean): ProfileCta {
	if (isSellerKind(kind)) {
		return { layout: "hire", primary: "Hire", target: hasServices ? "services" : "message" };
	}
	return { layout: "message", primary: "Message", target: null };
}
// #endregion

// #region Reviews — stance filter
/**
 * The Reviews segmented filter: every review, or only those received in ONE of the profile's two
 * stances. `ReviewEntry.role` records the AUTHOR's side — a review whose author was the client is a
 * review of this profile AS A FREELANCER, and vice versa — so the filter is the author's role
 * inverted. Written once here rather than in the island, because inverting it in two places is how
 * "As freelancer" comes to show a freelancer's reviews of their client.
 */
export type ReviewStance = "all" | "freelancer" | "client";

/** The stance THIS profile held in the engagement a review is about. */
export function reviewStanceOf(review: Pick<ReviewEntry, "role">): "freelancer" | "client" {
	return review.role === "client" ? "freelancer" : "client";
}

/** The reviews matching a stance (`all` returns the input untouched). */
export function reviewsForStance<T extends Pick<ReviewEntry, "role">>(
	reviews: readonly T[],
	stance: ReviewStance,
): T[] {
	if (stance === "all") return [...reviews];
	return reviews.filter((review) => reviewStanceOf(review) === stance);
}

/** How many reviews each stance holds, for the segment labels. */
export function reviewStanceCounts(
	reviews: readonly Pick<ReviewEntry, "role">[],
): Record<ReviewStance, number> {
	let freelancer = 0;
	let client = 0;
	for (const review of reviews) {
		if (reviewStanceOf(review) === "freelancer") freelancer++;
		else client++;
	}
	return { all: reviews.length, freelancer, client };
}

/** Parse a `?as=` query value into a stance; anything else is `all`. */
export function parseReviewStance(value: string | null | undefined): ReviewStance {
	return value === "freelancer" || value === "client" ? value : "all";
}
// #endregion

// #region At a glance — reply speed + estimated spend
/**
 * `~45 min` · `~2 hrs` · `~1 day` — the compact figure beside "Avg. response". Rounded to the unit a
 * reader plans around; never more precise than the measurement deserves.
 */
export function responseLabel(minutes: number): string {
	if (minutes < 60) return `~${Math.max(1, Math.round(minutes))} min`;
	if (minutes < 24 * 60) {
		const hours = Math.round(minutes / 60);
		return `~${hours} ${hours === 1 ? "hr" : "hrs"}`;
	}
	const days = Math.round(minutes / (24 * 60));
	return `~${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * "Fast responder" is the discovery card's "Fast replies" gate applied to the profile: the SAME
 * `FAST_REPLY_MINUTES` threshold, so the mark here and the chip on the card that linked here agree.
 * An unmeasured profile (`null`) never earns it.
 */
export function isFastResponder(minutes: number | null | undefined): boolean {
	return typeof minutes === "number" && minutes <= FAST_REPLY_MINUTES;
}

/** The "Est. project spend" floor — the cheapest starting rate across the seller's listings. */
export interface EstimatedSpend {
	amount: PriceAmount;
	/** The per-unit noun of the listing that set the floor (`ticket` · `session` · `project`). */
	unit: string | null;
}

/**
 * The lowest starting rate across a seller's active listings, resolved through the SAME
 * `serviceStartingPrice` the service cards print — so the figure in the context bar is one a reader
 * can find on a card directly beneath it. Compared within the first listing's currency (a mixed-
 * currency catalogue is compared in whichever currency leads), and `null` when no listing carries a
 * structured price — a "Contact us" catalogue gets no invented floor.
 */
export function estimatedSpendFor(services: readonly ServiceItem[]): EstimatedSpend | null {
	let best: EstimatedSpend | null = null;
	for (const service of services) {
		const price = serviceStartingPrice(service);
		if (!price.amount) continue;
		if (best && price.amount.currency !== best.amount.currency) continue;
		if (!best || price.amount.minor < best.amount.minor) {
			best = { amount: price.amount, unit: price.unit ?? null };
		}
	}
	return best;
}
// #endregion
