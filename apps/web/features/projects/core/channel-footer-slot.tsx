import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import ChatComposer from "../islands/ChatComposer.island.tsx";
import { activeTabOf, resolveChannelMeta } from "./channel-view.ts";
import { resolveProjectDetail } from "./detail-ssr.ts";

/**
 * channel-footer-slot — the SSR-idiomatic resolver for the middle-nav frame's configurable FOOTER band
 * (the sibling of {@link channelHeaderFor} for the bottom strip). Rather than a page rendering the
 * composer inside its scrolling body, the `(dashboard)` layout calls {@link channelFooterFor} with the
 * request URL + acting context and threads the result into `UserShell`'s `middleNavFooter` →
 * `MiddleNav`'s `footer` band, where it is `position: sticky; inset-block-end: 0` under the native
 * window scroll (Decision #31). So the composer locks to the viewport bottom and the message stream
 * scrolls in the window beneath it, with nothing overlaying the feed inside the scroll flow.
 *
 * Server-only (it reaches `@server/services` via {@link resolveProjectDetail}); never imported by an
 * island.
 */

/**
 * Resolve the pane footer for a request: the {@link ChatComposer} ONLY on a channel's Chat tab
 * (`/projects/[projectId]/[channelId]` and its explicit `/chat` sub-path), else `null` so the band
 * collapses. The channel must resolve to a real channel in the project (so a project-view path like
 * `/projects/{slug}/board` yields no composer), and the composer is Chat-only — the Files/Members/…
 * tabs have nothing to compose.
 */
export function channelFooterFor(url: URL, context: UserContext): ComponentChildren {
	const segs = url.pathname.split("/").filter(Boolean); // ["projects", projectId, channelId, ...tab]
	if (segs[0] !== "projects" || segs.length < 3 || segs[1] === "create") return null;

	const [, projectId, channelId] = segs;
	const { detail } = resolveProjectDetail(projectId, context);
	if (!detail) return null;

	const meta = resolveChannelMeta(detail, channelId);
	if (!meta) return null;

	const base = `/projects/${projectId}/${channelId}`;
	if (activeTabOf(url.pathname, base) !== "chat") return null;

	return <ChatComposer projectId={projectId} channelId={channelId} />;
}
