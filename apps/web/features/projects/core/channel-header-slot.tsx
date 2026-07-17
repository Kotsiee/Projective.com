import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import ChannelHeader from "../islands/ChannelHeader.island.tsx";
import { activeTabOf, resolveChannelMeta } from "./channel-view.ts";
import { resolveProjectDetail } from "./detail-ssr.ts";

/**
 * channel-header-slot — the SSR-idiomatic resolver for the middle-nav content pane's configurable
 * header slot. It is the server equivalent of a page "registering" a header with the shell: rather
 * than a client React context (which cannot paint the slot on the first SSR byte and does not persist
 * across Fresh's per-navigation renders), the `(dashboard)` layout calls {@link channelHeaderFor} with
 * the request URL and the acting context, and threads the result into `UserShell`'s `middleNavHeader`
 * → `PageCanvas`'s `header` slot. So the correct header (or none) ships in the first byte with no
 * client-context flash, exactly as the lane itself is resolved by `laneFor`.
 *
 * Server-only (it reaches `@server/services` via {@link resolveProjectDetail}); never imported by an
 * island.
 */

/**
 * Resolve the pane header for a request: the contextual {@link ChannelHeader} on a specific project
 * channel route (`/projects/[projectId]/[channelId]` and its tab sub-paths), else `null` so the slot
 * collapses and the page body fills the top of the pane (no empty bar).
 *
 * A channel route is recognised by looking the second path segment up in the resolved project's channel
 * set — so a project-view path that shares the URL space (e.g. `/projects/{slug}/board`) is NOT a
 * channel and correctly yields no header.
 */
export function channelHeaderFor(url: URL, context: UserContext): ComponentChildren {
	const segs = url.pathname.split("/").filter(Boolean); // ["projects", projectId, channelId, ...tab]
	if (segs[0] !== "projects" || segs.length < 3 || segs[1] === "create") return null;

	const [, projectId, channelId] = segs;
	const { detail } = resolveProjectDetail(projectId, context);
	if (!detail) return null;

	const meta = resolveChannelMeta(detail, channelId);
	if (!meta) return null;

	const base = `/projects/${projectId}/${channelId}`;
	return (
		<ChannelHeader
			base={base}
			meta={meta}
			activeTab={activeTabOf(url.pathname, base)}
			starred={detail.starred}
		/>
	);
}
