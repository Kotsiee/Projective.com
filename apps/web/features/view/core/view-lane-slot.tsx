import type { ComponentChildren } from "preact";
import ViewActionLane from "../islands/ViewActionLane.island.tsx";
import ProjectViewLane from "../islands/ProjectViewLane.island.tsx";
import ArticleTocLane from "../islands/ArticleTocLane.island.tsx";
import { resolveViewPage } from "./view-ssr.ts";
import type { HrefContext } from "@features/explore/core/routing.ts";

/**
 * viewLaneFor — the SSR-idiomatic route resolver that decides whether the Entity View action panel
 * mounts in the navigation sidebar for a given URL. It mirrors the shell's other URL-keyed slot
 * resolvers (`laneFor` / `exploreFilterLaneFor`): a pure function of the URL (+ auth), evaluated by the
 * `(public)` and `[handle]` layouts, so the correct lane paints on the first byte with no
 * client-context flash.
 *
 * Matches BOTH the public `/view/[id]` and the profile-scoped `/[handle]/view/[id]` (never the
 * `/view/[id]/schedule` calendar leaf, which fills the region itself). Returns `null` — the shell
 * renders no aside/lane — on every other route, or when the item id resolves to nothing.
 *
 * The lane is DISPATCHED by the resolved item's type: a project gets the {@link ProjectViewLane}
 * (finance/metric summary + stage quick-jumps), an article the {@link ArticleTocLane} (interactive Table
 * of Contents), and everything else the transactional {@link ViewActionLane}. All three reuse the same
 * `pf-lane` skeleton, so they drop into the guest aside / authed lane identically.
 */
export function viewLaneFor(url: URL, authed: boolean): ComponentChildren | null {
	const segments = url.pathname.split("/").filter(Boolean);

	let id: string | undefined;
	let ctx: HrefContext | undefined;
	// Public: exactly `/view/{id}`.
	if (segments.length === 2 && segments[0] === "view") {
		id = decodeURIComponent(segments[1]);
		ctx = { scope: "explore" };
	} // Profile-scoped: exactly `/{handle}/view/{id}`.
	else if (segments.length === 3 && segments[1] === "view") {
		id = decodeURIComponent(segments[2]);
		ctx = { scope: "profile", handle: segments[0] };
	}
	if (!id || !ctx) return null;

	const { view } = resolveViewPage(id);
	if (!view) return null;

	if (view.project) {
		return <ProjectViewLane item={view.item} project={view.project} authed={authed} ctx={ctx} />;
	}
	if (view.article) {
		return (
			<ArticleTocLane
				toc={view.article.toc}
				readLabel={`${view.article.readMinutes} min read`}
			/>
		);
	}

	return (
		<ViewActionLane
			item={view.item}
			pricing={view.pricing}
			trust={view.trust}
			authed={authed}
			ctx={ctx}
			// A stage-showcase service (Pipeline / One-Off) gets the Projects-style stage-jump nav.
			stages={view.service?.showcaseStages ? view.service.stages : undefined}
		/>
	);
}
