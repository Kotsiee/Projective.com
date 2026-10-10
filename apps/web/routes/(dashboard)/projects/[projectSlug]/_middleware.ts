import { define } from "@web/utils/state.ts";
import { workspaceExitFor } from "@projective/types/projects";
import {
	landingHref,
	resolveProjectAccess,
	seeOther,
} from "@web/features/projects/core/project-access.ts";

/**
 * Every `/projects/[slug]/*` path is the engagement's WORKSPACE, and a prospect does not belong in
 * it (Decision #144).
 *
 * A stranger who can see a public engagement used to be handed the member workspace — "Your work",
 * "Your earnings", a board of drop targets they could not use — because nothing on these routes asked
 * whether they were on the engagement at all. This asks once, for every path below the slug: a
 * prospect is sent to the public listing (or, for a draft, told it does not exist), and everybody else
 * passes through with the answer memoised on `ctx.state.projectAccess` for the page and both bands.
 *
 * Reads only (`GET`/`HEAD`): a write is the API's to authorise, and redirecting a form post would
 * silently drop its body. `/preview` keeps its own two-sided guard — review authority only, everyone
 * else sent to the root — so it is passed through untouched rather than asked twice.
 * A project that resolves to nothing is left to each route's existing miss path.
 */
export default define.middleware(async (ctx) => {
	if (ctx.req.method !== "GET" && ctx.req.method !== "HEAD") return ctx.next();

	const segs = ctx.url.pathname.split("/").filter(Boolean); // ["projects", slug, ...rest]
	const slug = segs[1];
	if (segs[0] !== "projects" || !slug || segs[2] === "preview") return ctx.next();

	const resolved = await resolveProjectAccess(ctx, slug);
	if (!resolved) return ctx.next();

	const exit = workspaceExitFor(resolved.access, resolved.status);
	const location = exit ? landingHref({ kind: exit }, slug) : null;
	if (location) return seeOther(location);

	// Every workspace page used to title its tab just "Projective". A route that knows more (the
	// Overview, Details, a stage's configuration) overrides this in its own handler, which runs after.
	const view = VIEW_TITLE[segs[2] ?? ""];
	ctx.state.title = view
		? `${view} · ${resolved.title} · Projective`
		: `${resolved.title} · Projective`;
	return ctx.next();
});

/** The workspace views named in a tab title, by their path segment. A room keeps the project's name. */
const VIEW_TITLE: Readonly<Record<string, string>> = {
	board: "Board",
	timeline: "Timeline",
	calendar: "Calendar",
	files: "Files",
	submissions: "Submissions",
	members: "Members",
	discussion: "Discussion",
};
