import type { ComponentChildren } from "preact";
import ViewActionLane from "../islands/ViewActionLane.island.tsx";
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

	return (
		<ViewActionLane
			item={view.item}
			pricing={view.pricing}
			trust={view.trust}
			authed={authed}
			ctx={ctx}
		/>
	);
}
