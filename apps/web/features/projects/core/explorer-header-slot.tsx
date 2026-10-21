import type { ComponentChildren } from "preact";
import type { ReadActor } from "@server/services/read-actor.ts";
import ExplorerHeaderBand from "../islands/ExplorerHeaderBand.island.tsx";
import { resolveFileExplorer } from "./files-ssr.ts";
import { resolveSubmissionPageOnce } from "./submissions-ssr.ts";
import { nodeAt } from "./submission-model.ts";

/**
 * explorer-header-slot — the middle-nav HEADER band on a project's own Files and Submissions routes
 * (Decision #317). They are project views, not channels, so `channelHeaderFor` yields nothing there and
 * the band would otherwise not render; instead it carries the node in view's title and the explorer's
 * toolbar (search · type · sort), which the body therefore does not draw. A channel's Files or
 * Submissions keeps its channel header, and its body keeps the toolbar above the grid.
 *
 * The title comes from the SAME request-memoized read the route renders from, so the band never names
 * a node the body is not showing. Composed after `channelHeaderFor` / `projectHeaderFor` in the
 * `(dashboard)` layout. Server-only; never imported by an island.
 */

/** The decoded segments after the first `skip` of a pathname. */
export function pathSegmentsAfter(url: URL, skip: number): string[] {
	return url.pathname.split("/").filter(Boolean).slice(skip).map((segment) => {
		try {
			return decodeURIComponent(segment);
		} catch {
			return segment;
		}
	});
}

export async function explorerHeaderFor(url: URL, actor: ReadActor): Promise<ComponentChildren> {
	const segs = url.pathname.split("/").filter(Boolean); // ["projects", projectId, view, ...path]
	if (segs[0] !== "projects" || segs.length < 3 || segs[1] === "create") return null;
	const projectId = segs[1];

	if (segs.length === 3 && segs[2] === "files") {
		const boot = await resolveFileExplorer(url, projectId, actor);
		if (!boot.page) return null;
		return <ExplorerHeaderBand title={boot.title} noun="files" />;
	}

	if (segs[2] === "submissions") {
		const path = pathSegmentsAfter(url, 3);
		const { page } = await resolveSubmissionPageOnce(url, projectId, actor, null, path);
		if (!page) return null;
		const title = nodeAt(page.tree, page.path)?.label ?? "All stages";
		return <ExplorerHeaderBand title={title} noun="submissions" />;
	}

	return null;
}
