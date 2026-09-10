import type { UserContext } from "@projective/types/auth";
import {
	LEGACY_TAB_TARGET,
	LegacyProfileTab,
	normalizeHandle,
	type ProfileKind,
	ProfileTab,
	type ProfileView,
} from "@projective/types/profile";

/**
 * profile-model — the pure, JSX-free brains of the `/[handle]` profile: the four-section tab matrix,
 * labels + route segments, active-tab / legacy-redirect / own-profile resolution, and the CTA rule.
 * Imported freely by islands, components, and routes (no DOM, no server deps).
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
 * The hero's two-control rig for a VISITOR. `Message` is the primary on every kind — it is the one
 * conversion every profile offers (a seller is hired through the Work section's listings, not from a
 * "Hire" control that has no listing to name); `Follow` is the secondary.
 */
export interface ProfileCta {
	primary: "Message";
	secondary: "Follow";
}

export function ctaFor(_kind: ProfileKind): ProfileCta {
	return { primary: "Message", secondary: "Follow" };
}
// #endregion
