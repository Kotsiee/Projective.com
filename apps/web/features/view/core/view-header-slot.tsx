import type { ComponentChildren } from "preact";
import ProjectStickyHeader from "../islands/ProjectStickyHeader.island.tsx";
import EntityStickyHeader from "../islands/EntityStickyHeader.island.tsx";
import { resolveViewPage } from "./view-ssr.ts";
import { resolveArchetype } from "./entity-archetype.ts";
import type { HrefContext } from "@features/explore/core/routing.ts";
import type { UserContext } from "@projective/types/auth";

/**
 * viewHeaderFor — the SSR-idiomatic resolver that decides whether the Entity View page mounts a
 * migrated sticky header in the middle-nav frame's header band (`ui-middle-nav__header`). It mirrors the
 * shell's other URL-keyed slot resolvers (`viewLaneFor` / `channelHeaderFor`): a pure function of the
 * URL (+ auth), evaluated by the `(public)` and `[handle]` layouts, so the correct header paints on the
 * first byte with no client-context flash.
 *
 * It DISPATCHES exactly like `viewLaneFor`, so the band, the lane and the body are all hydrated from
 * one answer: a **project** gets the profile-mirroring `ProjectStickyHeader`; an **article** gets
 * nothing (it has no transaction and already owns the TOC lane); every **commerce archetype** gets
 * `EntityStickyHeader` (§D.7.6).
 *
 * The band deliberately carries no purchase control and no contact trigger. `.guest-shell__subheader`
 * is `display: none` at ≤767px while `.ui-middle-nav__header` still renders there, so anything placed
 * here exists for a signed-in phone user and not a guest one, beside `EntityBuyBar`, which already owns
 * both flows below `--bp-md` — the duty-transfer conflict §D.7.4 forbids. It is identity and one jump
 * to the reviews, which is why it needs no resolved offer.
 */
export function viewHeaderFor(
	url: URL,
	authed: boolean,
	_context?: UserContext,
): ComponentChildren | null {
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

	if (view.project) return <ProjectStickyHeader item={view.item} authed={authed} ctx={ctx} />;
	// An article has no transaction and its lane is the table of contents — nothing to condense into.
	if (view.article) return null;

	return (
		<EntityStickyHeader
			item={view.item}
			archetype={resolveArchetype(view)}
			authed={authed}
			ctx={ctx}
		/>
	);
}
