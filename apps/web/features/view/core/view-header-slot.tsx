import type { ComponentChildren } from "preact";
import ProjectStickyHeader from "../islands/ProjectStickyHeader.island.tsx";
import { resolveViewPage } from "./view-ssr.ts";
import type { HrefContext } from "@features/explore/core/routing.ts";

/**
 * viewHeaderFor — the SSR-idiomatic resolver that decides whether the Entity View page mounts a
 * migrated sticky header in the middle-nav frame's header band (`ui-middle-nav__header`). It mirrors the
 * shell's other URL-keyed slot resolvers (`viewLaneFor` / `channelHeaderFor`): a pure function of the
 * URL (+ auth), evaluated by the `(public)` and `[handle]` layouts, so the correct header paints on the
 * first byte with no client-context flash.
 *
 * ONLY the custom **Projects** template mirrors the profile page's scroll-migrated header (its body
 * `ProjectViewHeader` sets the shared signal that reveals this band). Articles and the generic
 * service/product view carry no such header, so this returns `null` for every other route/type.
 */
export function viewHeaderFor(url: URL, authed: boolean): ComponentChildren | null {
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
	if (!view || !view.project) return null;

	return <ProjectStickyHeader item={view.item} authed={authed} ctx={ctx} />;
}
