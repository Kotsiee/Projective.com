import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import type { ReadActor } from "@server/services/read-actor.ts";
import CatalogueLane from "../islands/CatalogueLane.island.tsx";
import { laneParamsOf, resolveCataloguePage } from "./catalogue-ssr.ts";
import { toTypeFilter } from "./catalogue-model.ts";

/**
 * catalogue-lane-slot — the SSR-idiomatic resolver for the middle-nav lane on any `/catalogue*` route
 * (mirrors `laneFor`'s projects/messages branches). It resolves the acting seller's full catalogue (all
 * statuses, scoped to the active `?type=` segment) so the {@link CatalogueLane} paints its status
 * sections + `＋ New` split-button in the first byte; the island then refines client-side. The active
 * listing id is derived from the path so the manage page highlights its row. Returns `null` off
 * `/catalogue`. Server-only (reaches `@server/services`); never imported by an island.
 *
 * A lane whose read FAILED still renders: it is the seller's way to every other listing and to `＋ New`,
 * and the body beside it already says the catalogue could not be reached — so the lane is simply empty
 * rather than a second copy of that message.
 */
export async function catalogueLaneFor(
	url: URL,
	context: UserContext,
	actor: ReadActor,
): Promise<ComponentChildren> {
	if (!url.pathname.startsWith("/catalogue")) return null;

	const type = toTypeFilter(url.searchParams.get("type"));
	const { page, seller } = await resolveCataloguePage(context, url, actor, laneParamsOf(url));
	return <CatalogueLane initial={page} type={type} seller={seller} path={url.pathname} />;
}
