import type { ComponentChildren } from "preact";
import { resolveArchetype } from "./entity-archetype.ts";
import ArticleTocLane from "../islands/ArticleTocLane.island.tsx";
import { resolveViewPage } from "./view-ssr.ts";
import type { HrefContext } from "@features/explore/core/routing.ts";
import type { UserContext } from "@projective/types/auth";
import { LocalKeys } from "@web/utils/storage-keys.ts";

/**
 * viewLaneFor — the SSR-idiomatic resolver that decides what the Entity View page contributes to the
 * shell's middle-nav lane slot. It mirrors the shell's other URL-keyed slot resolvers (`laneFor` /
 * `channelHeaderFor` / `viewHeaderFor`): a pure function of the URL (+ auth), evaluated by the
 * `(public)` and `[handle]` layouts, so the correct lane paints on the first byte with no
 * client-context flash. It dispatches on the RESOLVED item type, never on `?type=` (§D.7.5).
 *
 * **Only an article still uses the shell slot** — its lane is a table of contents, which is genuine
 * navigation of the page beside it, and it opens wider than a channel list needs.
 *
 * **Every other archetype — the five commerce bodies AND a project — renders its lane IN THE PAGE.**
 * The conversion rail is the `.evp-frame`'s END column (`EntityLane` for a listing, `ProjectLane`
 * for a brief), so an authenticated buyer and a guest see the same floating panel on the same side,
 * instead of a drag-resizable middle-nav lane for one of them and a floating glass aside for the
 * other. The slot therefore gets `null` for them in BOTH shells, so no `.ui-middle-nav__lane` is
 * constructed at all and the frame's `auto minmax(0, 1fr)` grid resolves column 1 to 0px — the
 * checkout focus mode's mechanism (Decision #70), and the reason this is a `null` rather than a
 * `display: none`: an un-rendered lane costs no track, no seam term and no splitter, where a hidden
 * one keeps all three. The back link lives in the page's own `.evp-navstrip` instead.
 *
 * A caller that wants to know the difference between "the view owns this route" and "this is not a
 * view route" asks {@link viewOwnsLaneSlot} — a `null` here does not mean the latter.
 */

/** Parse a view URL into its item id and href context, or `null` when it is not a view route. */
function targetOf(url: URL): { id: string; ctx: HrefContext } | null {
	const segments = url.pathname.split("/").filter(Boolean);
	// Public: exactly `/view/{id}`.
	if (segments.length === 2 && segments[0] === "view") {
		return { id: decodeURIComponent(segments[1]), ctx: { scope: "explore" } };
	}
	// Profile-scoped: exactly `/{handle}/view/{id}`.
	if (segments.length === 3 && segments[1] === "view") {
		return {
			id: decodeURIComponent(segments[2]),
			ctx: { scope: "profile", handle: segments[0] },
		};
	}
	return null;
}

export function viewLaneFor(
	url: URL,
	_authed: boolean,
	_context?: UserContext,
): ComponentChildren | null {
	const target = targetOf(url);
	if (!target) return null;

	const { view } = resolveViewPage(target.id);
	if (!view) return null;

	// An article's lane is its table of contents — real navigation, and it stays a shell lane.
	if (resolveArchetype(view) === "article" && view.article) {
		return (
			<ArticleTocLane
				toc={view.article.toc}
				readLabel={`${view.article.readMinutes} min read`}
			/>
		);
	}

	// Every other archetype's conversion rail is a page column; the shell has nothing to hold.
	return null;
}

/**
 * Whether the Entity View feature owns the lane decision for this URL.
 *
 * True for a `/view/[id]` (or `/[handle]/view/[id]`) that RESOLVES to a real listing — including one
 * where {@link viewLaneFor} returns `null` because the lane is a page column. The `[handle]` layout
 * needs the distinction: without it, a listing view would fall through to the profile action lane,
 * and the reader would get a panel about the seller pinned beside a page about one of their listings
 * — with the listing's own conversion rail on the other side.
 */
export function viewOwnsLaneSlot(url: URL): boolean {
	const target = targetOf(url);
	if (!target) return false;
	return !!resolveViewPage(target.id).view;
}

/**
 * The lane splitter's per-route options — for the ONE `/view` route that still has a shell lane.
 *
 * An article's table of contents is real navigation and opens wider than a channel list needs.
 * Everything else gets `undefined`, because it renders no shell lane: there is no splitter to
 * configure.
 *
 * **Why a prop and not CSS.** `MiddleNavSplitter` writes `--shell-lane-w` as an inline style custom
 * property on the very element `splitter.css` reads it from, and it is in the SSR HTML too — so an
 * ancestor override is inert while still corrupting `--shell-frame-inset-inline`; and overriding
 * `inline-size` instead would make the drag handle lie about the width it controls.
 *
 * **Why its own storage key.** `MIDDLE_LANE_WIDTH` is shared by every laned surface, and
 * `useSplitter` restores a stored width in preference to `initial` — so without a distinct key a
 * viewer who had ever dragged the lane on `/projects` would land here with that width instead.
 */
export function viewLaneOptionsFor(
	url: URL,
): { initial: number; min?: number; max?: number; storageKey: string } | undefined {
	const target = targetOf(url);
	if (!target) return undefined;
	const { view } = resolveViewPage(target.id);
	if (!view || resolveArchetype(view) !== "article") return undefined;
	return { initial: 328, storageKey: LocalKeys.VIEW_LANE_WIDTH };
}
