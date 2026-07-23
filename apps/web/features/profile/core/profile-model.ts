import type { UserContext } from "@projective/types/auth";
import {
	normalizeHandle,
	type ProfileKind,
	ProfileTab,
	type ProfileView,
} from "@projective/types/profile";

/**
 * profile-model — the pure, JSX-free brains of the `/[handle]` profile shell: the entity-driven tab
 * matrix, tab labels + route segments, active-tab + own-profile resolution, and the primary-CTA rule.
 * Imported freely by islands, components, and routes (no DOM, no server deps).
 */

// #region Tab labels + segments
/** Human label per tab (the tab-bar text + the sub-route title). */
export const TAB_LABEL: Record<ProfileTab, string> = {
	about: "Overview",
	services: "Services",
	products: "Products",
	projects: "Projects",
	portfolio: "Portfolio",
	education: "Education",
	experience: "Experience",
	teams: "Teams",
	businesses: "Businesses",
	articles: "Articles",
	reviews: "Reviews",
	members: "Members",
	departments: "Departments",
};

/** Route segment per tab. `about` is the index (`/[handle]`); the rest are `/[handle]/<segment>`. */
export function tabSegment(tab: ProfileTab): string {
	return tab === "about" ? "" : tab;
}
// #endregion

// #region Entity tab matrix
/**
 * The tabs shown for a profile kind (root CLAUDE.md — the entity tab matrix). The **Overview is a
 * PERMANENT section** at the top of the body, NOT a tab, so `about` no longer appears here; the tab bar
 * below the Overview holds only the content tabs.
 *  - Client: Projects · Articles · Businesses · Reviews.
 *  - Freelancer: the full craft set.
 *  - Business: Projects · Articles · Businesses · Reviews · Members.
 *  - Team: Business ∪ Freelancer, minus Education + Experience.
 *  - Organisation (buyer-only, department-structured): Projects · Departments · Members · Articles ·
 *    Businesses · Reviews — no seller tabs (Services/Products/Portfolio), but a Departments tab and a
 *    department-grouped Members view (root CLAUDE.md — Part 2).
 */
export function tabsFor(kind: ProfileKind): ProfileTab[] {
	switch (kind) {
		case "client":
			return ["projects", "articles", "businesses", "reviews"];
		case "freelancer":
			return [
				"services",
				"products",
				"projects",
				"portfolio",
				"education",
				"experience",
				"teams",
				"businesses",
				"articles",
				"reviews",
			];
		case "business":
			return ["projects", "articles", "businesses", "reviews", "members"];
		case "team":
			return [
				"services",
				"products",
				"projects",
				"portfolio",
				"teams",
				"businesses",
				"articles",
				"reviews",
				"members",
			];
		case "organisation":
			return ["projects", "departments", "members", "articles", "businesses", "reviews"];
	}
}

/**
 * The tab opened by default below the permanent Overview (root CLAUDE.md — Part 1.1: default to
 * **Services**). Sellers (freelancer/team) lead with Services; buyer entities (client/business) have no
 * Services tab, so they fall back to the first tab in their matrix (Projects).
 */
export function defaultTabFor(kind: ProfileKind): ProfileTab {
	return tabsFor(kind)[0];
}

/**
 * The management tabs the side-nav reveals in Edit mode (root CLAUDE.md — Part 3.2), intersected with
 * the profile's own matrix so a client never gets a Portfolio management link. The explicit Profile /
 * Availability / Settings quick-links are added by the lane separately.
 */
const MANAGEMENT_ORDER: ProfileTab[] = [
	"services",
	"products",
	"projects",
	"portfolio",
	"departments",
	"education",
	"experience",
	"teams",
	"businesses",
	"articles",
];

export function managementTabsFor(kind: ProfileKind): ProfileTab[] {
	const allowed = new Set(tabsFor(kind));
	return MANAGEMENT_ORDER.filter((t) => allowed.has(t));
}
// #endregion

// #region Tab-bar arrangement (Reviews pinned last)
/**
 * Reviews is always pinned to the far right of the tab bar (root CLAUDE.md — Part 3.3 / Decision #40):
 * it never collapses into the `More ▾` overflow. The rest are "content" tabs the width-aware
 * {@link ../islands/ProfileTabs.island.tsx} fits inline or moves into the dropdown, measured live —
 * there is no longer a static inline threshold. `trailing` holds Reviews when the kind has it.
 */
export interface TabArrangement {
	/** Content tabs (everything except Reviews), in matrix order — the island measures + splits these. */
	content: ProfileTab[];
	/** The pinned trailing slot — Reviews, when the kind has it. */
	trailing: ProfileTab[];
}

export function arrangeTabs(kind: ProfileKind): TabArrangement {
	const all = tabsFor(kind);
	const trailing: ProfileTab[] = all.includes("reviews") ? ["reviews"] : [];
	const content = all.filter((t) => t !== "reviews");
	return { content, trailing };
}
// #endregion

// #region Active tab + paths
/** DOM id of the tab-sections region — the Reviews block scroll-links here (Part 1.2). */
export const TABS_ANCHOR = "profile-sections";

/**
 * Parse the active tab from a pathname. `null` when there is no sub-segment (the `/@handle` index — the
 * caller resolves the kind's {@link defaultTabFor}) or the segment isn't a content tab. `about` is no
 * longer a tab (the Overview is permanent), so `/@handle` resolves to the default (Services), not About.
 */
export function activeTabOf(pathname: string): ProfileTab | null {
	const segs = pathname.split("/").filter(Boolean); // [handle, segment?, …]
	const segment = segs[1];
	if (!segment) return null;
	const parsed = ProfileTab.safeParse(segment);
	if (!parsed.success || parsed.data === "about") return null;
	return parsed.data;
}

/** Build the deep-link for a tab. `handle` carries the leading `@` (canonical, Decision #3). */
export function tabHref(handle: string, tab: ProfileTab): string {
	const seg = tabSegment(tab);
	return seg ? `/${handle}/${seg}` : `/${handle}`;
}

/**
 * Deep-link to the Reviews tab that also SCROLLS the tab region into view (Part 1.2 — the Overview's
 * review summary focuses the Reviews tab). The `#` anchor targets the {@link TABS_ANCHOR} region, so a
 * full navigation lands scrolled onto the tabs rather than at the top of the permanent Overview.
 */
export function reviewsHref(handle: string): string {
	return `${tabHref(handle, "reviews")}#${TABS_ANCHOR}`;
}

/** The Availability sub-route (an action-lane destination, not a tab). */
export function availabilityHref(handle: string): string {
	return `/${handle}/availability`;
}
// #endregion

// #region Ownership + CTA
/**
 * Whether the acting user owns this profile — unlocks the owner chrome (Edit Profile, inline editing,
 * always-visible Settings). Matches on the hydrated `userId` OR the acting `@handle` (skeleton tokens
 * may carry only one). Guests never match.
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

/** The primary + secondary calls-to-action for a profile kind. */
export interface ProfileCta {
	/** Primary CTA label — Hire a seller, Message a buyer. */
	primary: "Hire" | "Message";
	/** Whether to also surface a secondary Message action. */
	showMessage: boolean;
}

export function ctaFor(kind: ProfileKind): ProfileCta {
	const seller = kind === "freelancer" || kind === "team";
	return seller
		? { primary: "Hire", showMessage: true }
		: { primary: "Message", showMessage: false };
}
// #endregion
