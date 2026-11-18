import { HttpError } from "fresh";
import { asAuthenticatedContext } from "@projective/types/auth";
import { isSlug } from "@projective/types/slugs";
import { readActor, type SessionContext } from "@web/utils/api-session.ts";
import { resolveChannelMeta } from "./channel-view.ts";
import { resolveProjectDetail } from "./detail-ssr.ts";
import { projectHref, seeOther } from "./project-access.ts";
import { withNoticeParam } from "./project-notice.ts";

/**
 * The `[channelId]` routes' answer to a room address that names no room (Decision #144).
 *
 * `/projects/[slug]/[channelId]` is a catch-all: any segment no static route claims lands here. Before
 * this guard, `/projects/[slug]/settings` — or any typo — rendered an EMPTY ROOM: "No messages yet …
 * Send the first message", with a working composer posting into a conversation that does not exist,
 * under a tab titled just "Projective". A control that renders must do something (root CLAUDE.md §3
 * gate 11), and a composer whose every send fails is the opposite of that.
 *
 * Now an unresolvable ref is a 303 to the engagement's Overview carrying the `room-not-found` flash.
 * "Unresolvable" is the same rule the header band uses to title the room (`resolveChannelMeta` —
 * General, the discussion, a stage, a team room, a DM), so the guard can never refuse a room the
 * header would have drawn. A project that resolves to nothing is left to the route's own miss path.
 *
 * A `cht-` ref is a conversation seen through the project (Decision #339 ruling N1): it resolves only
 * when it is one of the project's Private Messages — a thread the viewer is in that holds a message
 * stamped with this project, which `comms.tg_bind_dm_project` allows only while every participant is
 * a party to it. Any other thread address is a real 404 (the root error page), never the flash, so
 * the project's address cannot be used to learn which conversations exist.
 *
 * Kept out of `discussion-guard.ts` because `channel-view.ts` reaches `import.meta.env` through the dev
 * seam, and that module's unit tests run under `deno test`.
 */
export async function unknownRoomRedirect(
	ctx: SessionContext & { url: URL },
): Promise<Response | null> {
	if (ctx.req.method !== "GET" && ctx.req.method !== "HEAD") return null;

	const decoded = decodeSegments(ctx.url.pathname.split("/").filter(Boolean));
	if (!decoded || decoded[0] !== "projects" || decoded.length < 3) return null;
	const [, slug, ref] = decoded;

	const { detail } = await resolveProjectDetail(
		slug,
		asAuthenticatedContext(ctx.state.userContext),
		readActor(ctx),
	);
	if (!detail || resolveChannelMeta(detail, ref)) return null;
	if (isSlug(ref, "thread")) throw new HttpError(404);

	return seeOther(withNoticeParam(projectHref(slug), "room-not-found"));
}

/** Decode every segment, or `null` when one is a malformed escape (the route's own miss handles it). */
function decodeSegments(segs: string[]): string[] | null {
	try {
		return segs.map((s) => decodeURIComponent(s));
	} catch {
		return null;
	}
}
