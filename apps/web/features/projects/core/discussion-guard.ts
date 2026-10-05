import { asAuthenticatedContext } from "@projective/types/auth";
import { addressesDiscussion, DISCUSSION_REF, isDiscussionRef } from "@projective/types/projects";
import { readActor, type SessionContext } from "@web/utils/api-session.ts";
import { resolveProjectDetail } from "./detail-ssr.ts";

/**
 * discussion-guard — sends a request for the discussion room's OLD address to its canonical one.
 *
 * Every engagement's primary conversation lives at `/projects/{slug}/discussion` (`DISCUSSION_REF`).
 * Before that address existed the same room was reached by its own key: a Task's by its stage's
 * `stg-…` slug (Decision #121's Discussion link minted exactly that), a staged engagement's by the
 * project-wide room's id. Those links survive in bookmarks, notifications, file provenance and the
 * member dashboard, so they must keep landing — and they must land on the address the lane points at,
 * or the reader arrives in the right room with no lane entry lit and a second URL for one place.
 *
 * `{@link addressesDiscussion}` is the test, over the same `discussionOf` rule the lane and the server
 * resolve the word by, so only the room the word stands for is moved. A Task's seeded general room
 * and a staged engagement's stages keep their own addresses: they are other rooms.
 *
 * `303`, not a permanent redirect: which room the word stands for follows the engagement's type, and a
 * Task converted into a pipeline in settings makes its stage an ordinary stage again — a cached `308`
 * would keep sending its old address somewhere it no longer belongs. The trailing tab path and the
 * query are carried over, so `/{stg}/submissions/…` lands on `/discussion/submissions/…`; a `#m-`
 * fragment is carried by the browser itself.
 *
 * Server-only (it reaches `@server/services` through {@link resolveProjectDetail}); returned from a
 * middleware, never from a page component, where a `Response` is dead code (Decision #61). The detail
 * read is the one the layout's slots make for the same request, and is served from the read cache.
 */
export async function legacyDiscussionRedirect(
	ctx: SessionContext & { url: URL },
): Promise<Response | null> {
	if (ctx.req.method !== "GET" && ctx.req.method !== "HEAD") return null;

	// ["projects", projectSlug, channelId, ...rest] — read off the URL rather than `ctx.params`, which a
	// folder middleware is not guaranteed to have populated.
	const segs = ctx.url.pathname.split("/").filter(Boolean);
	if (segs[0] !== "projects" || segs.length < 3) return null;
	const decoded = decodeSegments(segs);
	if (!decoded) return null;
	const [, slug, ref, ...rest] = decoded;
	if (isDiscussionRef(ref)) return null;

	const { detail } = await resolveProjectDetail(
		slug,
		asAuthenticatedContext(ctx.state.userContext),
		readActor(ctx),
	);
	if (!detail || !addressesDiscussion(detail, ref)) return null;

	const tail = rest.map(encodeURIComponent).join("/");
	const location = `/projects/${encodeURIComponent(slug)}/${DISCUSSION_REF}` +
		(tail ? `/${tail}` : "") + ctx.url.search;
	return new Response(null, { status: 303, headers: { location } });
}

/**
 * Every path segment percent-decoded, or `null` when one carries a malformed escape.
 *
 * A request for `/projects/x/%E0%A4%A` names no room this guard could move, so it falls through to the
 * route's own miss rather than throwing a `URIError` out of the middleware as a 500.
 */
function decodeSegments(segs: string[]): string[] | null {
	try {
		return segs.map((s) => decodeURIComponent(s));
	} catch {
		return null;
	}
}
