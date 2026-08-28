import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { ExploreItem } from "@projective/types/explore";
import { readViewHistory } from "@features/explore/core/view-history.ts";
import { itemHref } from "@features/explore/core/routing.ts";
// The footer is a server component, so its stylesheet only reaches the client through an island in the
// page's bundle. `NewsletterForm` is the primary carrier and always renders; this island imports the
// sheet too so the block is not left depending on a sibling it does not control.
import "../styles/footer.css";

/**
 * RecentlyViewed — the footer's "pick up where you left off" rail.
 *
 * ## Why this is an island, and why it renders nothing on the server
 *
 * There is no server-side view history in this product: the store is `localStorage`
 * (`@features/explore/core/view-history.ts`, which says so at length), and `/explore` is a public
 * surface where the reader may not be signed in at all. So the server cannot know whether this reader
 * has a history, and a "Recently viewed" heading rendered into the first byte would be asserting one.
 * This component therefore returns `null` — not a heading, not a skeleton, not an empty-state — until
 * it has hydrated, read the store, AND resolved at least one entry. A block that is absent is honest;
 * a block that is present and empty is a small lie about the reader.
 *
 * That also means the block appears after hydration on a page that did not have it, which is a layout
 * shift. It is deliberately confined to the foot of the document, below the utility bar's own hairline
 * and past everything the reader came for, so nothing they are looking at moves under them.
 *
 * ## References, not snapshots
 *
 * The store keeps `{ id, type, at }` and nothing else, so each entry is resolved through the thin
 * `/api/explore/item` route rather than replayed from a cached title. That costs one request per row
 * and buys the guarantee that a renamed or withdrawn item is never advertised here with stale copy.
 */

// #region Config
/**
 * How many rows the rail shows — and, because there is no backfill, exactly how many requests it
 * makes. Four is the whole request budget for an ornament at the foot of the page; resolving eight
 * references to guarantee a fourth surviving row would double the cost of every public page load to
 * defend against a case (a withdrawn item) that is already handled correctly by simply showing three.
 */
const RECENT_SHOWN = 4;
// #endregion

// #region Types
/** One resolved row — the minimum the rail renders, and nothing it does not print. */
interface RecentEntry {
	id: string;
	title: string;
	href: string;
}
// #endregion

/**
 * The rail. Dumb by construction: it reads a device-local list, resolves each reference through an
 * existing thin route, and renders anchors. No DB, no logic, no error surface — a reference that fails
 * to resolve is dropped, because a footer is the wrong place to tell somebody a fetch failed for a
 * convenience they never asked for.
 */
export default function RecentlyViewed(): JSX.Element | null {
	const entries = useSignal<RecentEntry[]>([]);

	// `localStorage` and `fetch` are both client-only, so the read has to happen after mount — the one
	// case root CLAUDE.md §3 exempts from the signal-first rule. The empty dependency list is load
	// bearing: the history does not change while the reader is on this page (a navigation re-mounts the
	// island), so re-running would only re-issue the same four requests.
	useEffect(() => {
		const refs = readViewHistory().slice(0, RECENT_SHOWN);
		if (refs.length === 0) return;

		let live = true;
		(async () => {
			const resolved = await Promise.all(refs.map(async (ref): Promise<RecentEntry | null> => {
				try {
					const res = await fetch(
						`/api/explore/item?id=${encodeURIComponent(ref.id)}`,
						{ headers: { accept: "application/json" } },
					);
					const body = await res.json().catch(() => null);
					// The thin route answers `{ ok, data: { item } }` — the payload is a named envelope,
					// not the item itself, which is worth stating because `data` reading like the item is
					// exactly the assumption that produces four silently empty rows rather than an error.
					const item: ExploreItem | undefined = body?.ok ? body.data?.item : undefined;
					if (!item) return null;
					// `itemHref` owns the click matrix (a profile resolves to `/@handle`, everything else
					// to `/view/{id}?type=…`), so the rail links exactly where the card that recorded the
					// visit would have — one builder, no second opinion about where an item lives.
					return { id: ref.id, title: item.title, href: itemHref(item) };
				} catch {
					return null;
				}
			}));
			if (!live) return;
			entries.value = resolved.filter((e): e is RecentEntry => e !== null);
		})();

		return () => {
			live = false;
		};
	}, []);

	if (entries.value.length === 0) return null;

	return (
		<div class="lp-footer__recent">
			<span class="lp-footer__block-title" id="lp-footer-recent">Recently viewed</span>
			<ul class="lp-footer__links" aria-labelledby="lp-footer-recent">
				{entries.value.map((e) => (
					<li key={e.id}>
						<a class="lp-footer__link" href={e.href}>{e.title}</a>
					</li>
				))}
			</ul>
		</div>
	);
}
