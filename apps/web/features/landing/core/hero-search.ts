/**
 * hero-search — the viewer facts and the calls to action `/features`' final call to action offers
 * each viewer (`flows/LANDING.md` §4.1 table). The landing's own search that once lived here is
 * gone: the page mounts the shared `SearchBar` (Decision #358). Pure, so the server route and the
 * server components share it.
 */
import { explorePath } from "@features/marketing/core/megamenu-data.ts";

// #region Calls to action
/** The few viewer facts the calls to action depend on (from `ctx.state`, never the whole context). */
export interface HeroViewer {
	authenticated: boolean;
	/** Can already offer work (`UserContext.isFreelancer`). */
	isFreelancer: boolean;
	/** 13–17: may explore, not sell (`isRestrictedRequest`: `UserContext.restricted`, or the dev age override). */
	restricted: boolean;
}

/** A guest. */
export const GUEST_VIEWER: HeroViewer = {
	authenticated: false,
	isFreelancer: false,
	restricted: false,
};

/**
 * The viewer facts of a request: a guest unless signed in with resolved facts. The route reads
 * `restricted` through `isRestrictedRequest`, so the Dev Context Switcher's age override applies.
 */
export function heroViewerOf(
	authenticated: boolean,
	facts?: { isFreelancer: boolean; restricted: boolean } | null,
): HeroViewer {
	if (!authenticated || !facts) return GUEST_VIEWER;
	return {
		authenticated: true,
		isFreelancer: facts.isFreelancer === true,
		restricted: facts.restricted === true,
	};
}

/** One call to action: its label and where it goes. */
export interface HeroCta {
	label: string;
	href: string;
}

/**
 * The hero's two calls to action (`flows/LANDING.md` §4.1 table): "Hire a team" →
 * `explorePath('teams')` for everyone; "Offer your skills" → `/join?intent=freelancer` for a guest
 * (`/become-partner` is auth-guarded), `/become-partner` for a signed-in client, "Find work" →
 * `explorePath('projects')` for a freelancer, and nothing for a 13–17 account.
 */
export function heroCtas(viewer: HeroViewer): { hire: HeroCta; offer: HeroCta | null } {
	const hire = { label: "Hire a team", href: explorePath("teams") };
	if (viewer.restricted) return { hire, offer: null };
	if (!viewer.authenticated) {
		return { hire, offer: { label: "Offer your skills", href: "/join?intent=freelancer" } };
	}
	if (viewer.isFreelancer) {
		return { hire, offer: { label: "Find work", href: explorePath("projects") } };
	}
	return { hire, offer: { label: "Offer your skills", href: "/become-partner" } };
}
// #endregion
