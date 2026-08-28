import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import HomeRail from "./HomeRail.island.tsx";
import { EntityCard } from "../components/cards/EntityCard.tsx";
import { ExploreService } from "../core/ExploreService.ts";
import { readViewHistory } from "../core/view-history.ts";
import type { ExploreItem } from "../types/explore-types.ts";
import "../styles/explore.css";
import "../styles/explore-home.css";

/**
 * ContinueRail — "Continue where you left off": the items THIS DEVICE has opened, most recent first.
 *
 * ## It renders nothing until it has something true to say
 *
 * The history lives in `localStorage`, which the server cannot read, so this section cannot be part of
 * the first byte. That is not a limitation to work around — it is the honest shape of the feature.
 * There is no server-side view history anywhere in this product: no view/impression analytics event,
 * no `discovery.recent_views` table, and `ExploreBackendService.home()` takes no viewer argument. So
 * the section returns `null` until it has hydrated, read a non-empty list, and resolved it. A
 * "Continue where you left off" heading standing over an empty row would be claiming a history the
 * reader does not have, and a skeleton would claim one is loading when there may be none.
 *
 * The consequence, stated rather than hidden: this is per-device recency. A phone and a laptop
 * disagree, and a private window has none. It is never presented as "recommended for you".
 *
 * ## Why the rail chrome is {@link HomeRail} and not a copy of it
 *
 * It began as a hand-rolled copy — the same header, the same `useCarousel` — and that copy was
 * BROKEN in a way the original is not: `useCarousel`'s effect is mount-only, and this component
 * returns `null` until its fetch resolves, so on the single run the effect ever had, the track did
 * not exist. Measured against a sibling rail as a control: the progress fill stayed at 0 however far
 * the reader scrolled, Prev was disabled forever, Next never disabled, and drag-to-scroll was dead.
 * The overflow probe that drives `data-scrollable` was missing too, so the empty progress track
 * rendered on a rail with nothing to scroll.
 *
 * Delegating to `HomeRail` fixes all of that by construction rather than by re-deriving it: the rail
 * MOUNTS only once there are items, so every one of its effects binds against a real track. Rendering
 * one island component inside another is a plain component render — there is no second hydration root
 * — and it leaves exactly one implementation of the rail's chrome to keep correct.
 *
 * ## Why the cards are rendered client-side here and server-side everywhere else
 *
 * Every other rail on this page receives server-rendered children. This one cannot — its contents are
 * only knowable after hydration — so it resolves the stored references through the batch item route
 * and renders {@link EntityCard} itself. References, never snapshots: the store keeps `{id, type}` and
 * this asks the corpus for the rest, so a price that changed since the reader last looked is the
 * current price, and an item that no longer exists simply drops out of the row instead of rendering
 * from a stale cache.
 */
export default function ContinueRail({ authed = false }: { authed?: boolean }): JSX.Element | null {
	const items = useSignal<ExploreItem[]>([]);

	useEffect(() => {
		const refs = readViewHistory();
		if (refs.length === 0) return;
		let live = true;
		ExploreService.items(refs.map((r) => r.id)).then((res) => {
			// A failed resolve leaves the section absent rather than rendering an error. This is a
			// convenience row on a discovery page; a reader who cannot see it has lost nothing they
			// came for, and a red message where their recent work should be is worse than silence.
			if (live && res.ok && res.data) items.value = res.data;
		});
		return () => {
			live = false;
		};
	}, []);

	if (items.value.length === 0) return null;

	return (
		<HomeRail
			id="continue"
			lead="Continue"
			tail="where you left off"
			modifier="ex-continue"
			label="your recent items"
		>
			{items.value.map((it) => (
				<div class="ex-rail__cell" role="listitem" key={it.id}>
					{
						/*
						 * `authed` is threaded through. Without it every card in THIS rail defaulted to the
						 * signed-out treatment while every other rail on the page showed the real one — a
						 * signed-in reader got a Star that said "Sign in to save this" and navigated them to
						 * the login page, which is both a false statement about their state and a dead end.
						 */
					}
					<EntityCard item={it} authed={authed} />
				</div>
			))}
		</HomeRail>
	);
}
