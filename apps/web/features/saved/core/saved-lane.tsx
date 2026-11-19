import type { ComponentChildren } from "preact";
import SavedLane from "../islands/SavedLane.island.tsx";
import { parseCollection, parseTab } from "./saved-model.ts";

/**
 * The middle-nav lane on `/saved`: the category filters and the viewer's lists ({@link SavedLane}),
 * seeded from the request's own `?tab=&collection=`. Pure and synchronous: the lists arrive with the
 * page's first read. `null` on every other path.
 */
export function savedLaneFor(url: URL): ComponentChildren {
	if (url.pathname !== "/saved" && url.pathname !== "/saved/") return null;
	const q = url.searchParams;
	return (
		<SavedLane
			filter={{ tab: parseTab(q.get("tab")), collection: parseCollection(q.get("collection")) }}
		/>
	);
}
