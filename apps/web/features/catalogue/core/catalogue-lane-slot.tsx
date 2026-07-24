import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import CatalogueLane from "../islands/CatalogueLane.island.tsx";
import { resolveCataloguePage } from "./catalogue-ssr.ts";
import { toTypeFilter } from "./catalogue-model.ts";

/**
 * catalogue-lane-slot — the SSR-idiomatic resolver for the middle-nav lane on any `/catalogue*` route
 * (mirrors `laneFor`'s projects/messages branches). It resolves the acting seller's full catalogue (all
 * statuses, scoped to the active `?type=` segment) so the {@link CatalogueLane} paints its status
 * sections + `＋ New` split-button in the first byte; the island then refines client-side. The active
 * listing id is derived from the path so the manage page highlights its row. Returns `null` off
 * `/catalogue`. Server-only (reaches `@server/services`); never imported by an island.
 */
export function catalogueLaneFor(url: URL, context: UserContext): ComponentChildren {
	if (!url.pathname.startsWith("/catalogue")) return null;

	const type = toTypeFilter(url.searchParams.get("type"));
	// The lane lists all statuses (it groups them into sections) — only the type segment scopes it.
	const { page, seller } = resolveCataloguePage(context, { type });
	return <CatalogueLane initial={page} type={type} seller={seller} path={url.pathname} />;
}
