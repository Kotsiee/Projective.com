import { asAuthenticatedContext } from "@projective/types/auth";
import { discussionOf, type ProjectLanding } from "@projective/types/projects";
import { readActor, type SessionContext } from "@web/utils/api-session.ts";
import { readCookies } from "@web/utils/auth-cookies.ts";
import { IS_DEV } from "@web/utils/dev.ts";
import type { State } from "@web/utils/state.ts";
import { resolveProjectDetail } from "./detail-ssr.ts";
import {
	isLandingSimActive,
	LANDING_SIM_COOKIE,
	NO_LANDING_SIM,
	parseLandingSim,
} from "./landing-sim.ts";
import { projectsNoticeHref } from "./project-notice.ts";

/**
 * The engagement's access, resolved once per request, and the addresses the dispatch sends people to
 * (Decision #144).
 *
 * `routes/(dashboard)/projects/[projectSlug]/_middleware.ts` calls {@link resolveProjectAccess} first
 * and the answer is memoised on `ctx.state.projectAccess`; the page handler and both band resolvers
 * then read that ONE value. Three independent reads would agree on the live data — but a development
 * simulation applied in one place and not another would draw an owner's header over a prospect's
 * redirect, which is exactly the kind of disagreement this module exists to make impossible.
 */

/** The resolved access for one engagement — the shape stored on `ctx.state.projectAccess`. */
export type ResolvedProjectAccess = NonNullable<State["projectAccess"]>;

// #region Addresses
/** `/projects/{slug}` or one of its views. The slug is opaque (Decision #88), so it is only encoded. */
export function projectHref(slug: string, seg = ""): string {
	const base = `/projects/${encodeURIComponent(slug)}`;
	return seg ? `${base}/${seg}` : base;
}

/** The owner's configuration, `/projects/{slug}/details`. */
export function projectDetailsHref(slug: string): string {
	return projectHref(slug, "details");
}

/** The engagement's public listing — where a prospect evaluates it and applies. */
export function projectListingHref(slug: string): string {
	return `/view/${encodeURIComponent(slug)}?type=projects`;
}

/**
 * The address a non-Overview landing sends the viewer to, or `null` for the Overview itself.
 *
 * `missing` reuses the list's existing "Project does not exist" flash: a prospect asking for a draft
 * gets the same answer as a wrong address, because confirming a private draft exists is a disclosure.
 */
export function landingHref(landing: ProjectLanding, slug: string): string | null {
	switch (landing.kind) {
		case "overview":
			return null;
		case "details":
			return projectDetailsHref(slug);
		case "listing":
			return projectListingHref(slug);
		case "missing":
			return projectsNoticeHref("project-not-found");
	}
}

/**
 * A `303 See Other` to `location`.
 *
 * Always 303 for these redirects, never 308: every one of them depends on who is asking or what state
 * the engagement is in, and a 308 is cached as permanent — a browser that cached "this draft goes to
 * its details" would keep going there long after the draft was published.
 */
export function seeOther(location: string): Response {
	return new Response(null, { status: 303, headers: { location } });
}
// #endregion

// #region Resolution
/**
 * Resolve — or read back — how the acting viewer stands toward `slug`, or `null` when the engagement
 * does not resolve for them at all (the existing miss paths handle that case unchanged).
 *
 * In development only, the Dev Context Switcher's `pj.dev.landing` cookie may replace the access, the
 * status or both. Outside development the cookie is never read, so a stray cookie on a deployed
 * instance changes nothing.
 */
export async function resolveProjectAccess(
	ctx: SessionContext,
	slug: string,
): Promise<ResolvedProjectAccess | null> {
	const memo = ctx.state.projectAccess;
	if (memo && memo.slug === slug) return memo;

	const { detail } = await resolveProjectDetail(
		slug,
		asAuthenticatedContext(ctx.state.userContext),
		readActor(ctx),
	);
	if (!detail) return null;

	const sim = IS_DEV ? parseLandingSim(readCookies(ctx.req)[LANDING_SIM_COOKIE]) : NO_LANDING_SIM;
	const resolved: ResolvedProjectAccess = {
		slug,
		title: detail.title,
		access: sim.access ?? detail.viewerAccess,
		status: sim.status ?? detail.status,
		discussion: discussionOf(detail) !== null,
		simulated: isLandingSimActive(sim),
	};
	ctx.state.projectAccess = resolved;
	return resolved;
}

/**
 * The memoised access for `slug`, if this request resolved one. For the band resolvers, which run in
 * the layout after the middleware and must not resolve a second, possibly different, answer.
 */
export function storedProjectAccess(
	state: State | undefined,
	slug: string,
): ResolvedProjectAccess | null {
	const memo = state?.projectAccess;
	return memo && memo.slug === slug ? memo : null;
}
// #endregion
