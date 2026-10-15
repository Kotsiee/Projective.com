import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import type { ReadActor } from "@server/services/read-actor.ts";
import CatalogueLane from "../islands/CatalogueLane.island.tsx";
import { consoleParamsOf, outlineParamsOf, resolveCataloguePage } from "./catalogue-ssr.ts";
import { parseConsoleUrl } from "../types/catalogue-types.ts";

/**
 * catalogue-lane-slot — the middle-nav lane on any `/catalogue*` route, in the mode the path asks
 * for (plan §6.3): the console's facets on `/catalogue`, read through the same memoised query as the
 * page so the facet counts describe the first byte; the outline on `/catalogue/[id]`, with
 * every listing the seller has. Returns `null` off `/catalogue`. Server-only.
 *
 * A lane whose read failed still renders — it is the way to the other listings and to New listing,
 * and the canvas beside it already says the catalogue could not be reached.
 */
export async function catalogueLaneFor(
	url: URL,
	context: UserContext,
	actor: ReadActor,
): Promise<ComponentChildren> {
	const segs = url.pathname.split("/").filter(Boolean);
	if (segs[0] !== "catalogue") return null;

	if (segs.length >= 2) {
		const { page } = await resolveCataloguePage(context, url, actor, outlineParamsOf());
		return <CatalogueLane mode="outline" activeId={segs[1]} listings={page.items} />;
	}

	const { page } = await resolveCataloguePage(context, url, actor, consoleParamsOf(url));
	return (
		<CatalogueLane
			mode="console"
			url={parseConsoleUrl(url)}
			statusCounts={page.statusCounts}
			facetCounts={page.facetCounts}
			recent={page.items.slice(0, 8)}
		/>
	);
}
