import type { ComponentChildren } from "preact";
import { resolveArchetype } from "./entity-archetype.ts";
import ProjectViewLane from "../islands/ProjectViewLane.island.tsx";
import ArticleTocLane from "../islands/ArticleTocLane.island.tsx";
import { EntityNavRail } from "../components/EntityNavRail.tsx";
import { resolveViewPage } from "./view-ssr.ts";
import type { HrefContext } from "@features/explore/core/routing.ts";
import type { UserContext } from "@projective/types/auth";
import { LocalKeys } from "@web/utils/storage-keys.ts";

/**
 * viewLaneFor — the SSR-idiomatic route resolver that decides whether an Entity View route mounts a
 * lane in the shell's navigation slot. It mirrors the shell's other URL-keyed slot resolvers
 * (`laneFor` / `exploreFilterLaneFor`): a pure function of the URL (+ auth), evaluated by the
 * `(public)` and `[handle]` layouts, so the correct lane paints on the first byte with no
 * client-context flash.
 *
 * Matches BOTH the public `/view/[id]` and the profile-scoped `/[handle]/view/[id]` (never the
 * `/view/[id]/schedule` calendar leaf, which fills the region itself).
 *
 * The lane is DISPATCHED by the resolved item's type: a **project** gets the {@link ProjectViewLane}
 * (finance/metric summary + stage quick-jumps) and an **article** the {@link ArticleTocLane}
 * (interactive Table of Contents — an article has no transaction).
 *
 * **A COMMERCE archetype's TRANSACTION is never in this slot.** The conversion rail renders IN PAGE, as
 * the END column of the `.evp-frame` grid (`EntityLane`), so one presentation serves both shells: an
 * authenticated buyer and a guest see the same floating panel on the same side, instead of a
 * drag-resizable middle-nav lane for one of them and a floating glass aside for the other.
 *
 * What the slot DOES get, and only on the authenticated shell, is {@link EntityNavRail} — a collapsed
 * rail carrying the back link and nothing else. The guest shell gets `null` there, because its lane
 * host is the floating `GuestAside` and the back link is already in the page's own `.evp-navstrip`;
 * returning a rail for both would put two identical controls on one screen for one of them. So the
 * duty transfers by shell rather than duplicating (§D.7.4 applied to navigation).
 *
 * A caller that wants to know the difference between "the view owns this route" and "this is not a
 * view route" asks {@link viewOwnsLaneSlot} — a `null` here no longer means the former.
 */
export function viewLaneFor(
	url: URL,
	authed: boolean,
	_context?: UserContext,
): ComponentChildren | null {
	const target = entityViewTarget(url);
	if (!target) return null;

	const { view } = resolveViewPage(target.id);
	if (!view) return null;

	if (view.project) {
		return (
			<ProjectViewLane
				item={view.item}
				project={view.project}
				authed={authed}
				ctx={target.ctx}
			/>
		);
	}
	if (view.article) {
		return (
			<ArticleTocLane
				toc={view.article.toc}
				readLabel={`${view.article.readMinutes} min read`}
			/>
		);
	}

	/*
	 * Every remaining format is a commerce archetype. Its conversion rail is the page's own end column,
	 * so this slot holds navigation only — and only where the shell actually has a lane to hold it.
	 */
	return authed ? <EntityNavRail ctx={target.ctx} /> : null;
}

/**
 * Whether the Entity View feature owns the lane decision for this URL.
 *
 * True for a `/view/[id]` (or `/[handle]/view/[id]`) that RESOLVES to a real listing — including a
 * commerce archetype, where {@link viewLaneFor} returns only a nav rail on the authenticated shell and
 * `null` on the guest one. The `[handle]` layout needs the distinction: without it, a commerce view
 * would fall through to the profile action lane, and the reader would get a panel about the seller
 * pinned beside a page about one of their listings — with the listing's own conversion rail on the
 * other side.
 *
 * False for an id that resolves to nothing, so the not-found branch still inherits whatever lane the
 * surrounding layout would otherwise show.
 */
export function viewOwnsLaneSlot(url: URL): boolean {
	const target = entityViewTarget(url);
	if (!target) return false;
	return !!resolveViewPage(target.id).view;
}

/**
 * Whether the resolved listing on this URL is a COMMERCE archetype — the one that renders its rail in
 * page. Projects and articles keep their bespoke shell lanes and their own templates.
 */
export function isCommerceViewRoute(url: URL): boolean {
	const target = entityViewTarget(url);
	if (!target) return false;
	const { view } = resolveViewPage(target.id);
	if (!view) return false;
	const archetype = resolveArchetype(view);
	return archetype !== "project" && archetype !== "article";
}

/** The collapsed rail width the splitter treats as its floor (`useSplitter`'s own `min` default). */
const RAIL_W = 56;

/**
 * The lane splitter's per-route options.
 *
 * Two shapes, because the two `/view` lanes are two different things:
 *
 * - a **project**'s finance rail and an **article**'s table of contents are real navigation, and open
 *   wider than a channel list needs;
 * - a **commerce** archetype's lane is {@link EntityNavRail} — one back button — so it is pinned SHUT.
 *   `min === max === initial` is what forces it: `useSplitter` clamps every width it computes, so the
 *   drag can produce no other number, and `entity-view.css` withholds the handle so no one is offered
 *   a gesture with no outcome. Pinning it in CSS instead is not available (see below), and it also has
 *   to survive the stored-width restore, which is what the dedicated key below is for.
 *
 * **Why a prop and not CSS.** `MiddleNavSplitter` writes `--shell-lane-w` as an inline style custom
 * property on the very element `splitter.css` reads it from, and it is in the SSR HTML too — so an
 * ancestor or `:root` override of that property is inert, while still corrupting the frame's
 * `--shell-frame-inset-inline` and leaving the lane edge and the seam tens of pixels apart.
 * Overriding `inline-size` instead would make the drag handle lie.
 *
 * **Why its own storage key.** `MIDDLE_LANE_WIDTH` is shared by every laned surface, and
 * `useSplitter` restores a stored width in preference to `initial` — so without a distinct key a
 * viewer who had ever dragged the lane on `/projects` would land here with that width instead, which
 * for the commerce rail means a 280px column holding one button.
 */
export function viewLaneOptionsFor(
	url: URL,
): { initial: number; min?: number; max?: number; storageKey: string } | undefined {
	if (!viewOwnsLaneSlot(url)) return undefined;
	if (isCommerceViewRoute(url)) {
		return {
			initial: RAIL_W,
			min: RAIL_W,
			max: RAIL_W,
			storageKey: LocalKeys.VIEW_NAV_RAIL_WIDTH,
		};
	}
	return { initial: 328, storageKey: LocalKeys.VIEW_LANE_WIDTH };
}

/** Whether a URL is one of the two entity-view shapes this feature owns. */
export function isEntityViewRoute(url: URL): boolean {
	return !!entityViewTarget(url);
}

/**
 * The item id + render context a `/view` URL addresses, or `null` when the URL is not one.
 *
 * One parser, used by every resolver in this feature, so the lane, the header band and the page
 * cannot disagree about which id a URL names — which is exactly how a header would come to describe
 * one listing while the rail beside it sold another.
 */
export function entityViewTarget(url: URL): { id: string; ctx: HrefContext } | null {
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
