import { type Signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { ExploreService } from "../core/ExploreService.ts";
import { opensInDrawer, readItemParam, withItemParam } from "../core/detail-nav.ts";
import type { ExploreItem } from "../types/explore-types.ts";

/** The drawer's state and the three ways the reader moves it. */
export interface DetailRoute {
	/** The item on show — kept through the exit transition, so the panel never empties mid-slide. */
	item: Signal<ExploreItem | null>;
	/** Whether the drawer is open. */
	visible: Signal<boolean>;
	/**
	 * Show an item. From a closed drawer this pushes a NEW history entry, so Back closes it; stepping
	 * while open replaces that entry, so Back still closes rather than walking back through results.
	 */
	open(item: ExploreItem): void;
	/** Close from inside the page (×, Escape, the scrim): the parameter is stripped in place. */
	close(): void;
}

export interface DetailRouteOptions {
	/** The item the server resolved from `?item=` — open in the first byte when present. */
	initial: ExploreItem | null;
	/** An item already on the page, by id — a popstate needs no fetch for one of these. */
	resolve: (id: string) => ExploreItem | undefined;
	/** Called each time the reader brings an item into view (open or step). */
	onView: (item: ExploreItem) => void;
}

/**
 * The history entry marker. `fClientNav` is Fresh's flag: the client runtime treats an entry carrying
 * `true` as a partial navigation and reloads on traversal (partials are off, Decision #52), so every
 * entry written here — and the page's own entry, before anything is pushed on top — carries `false`.
 * The same contract `TicketDeepLinkHost` documents for `?tkv=`.
 */
interface DetailHistoryState {
	pjItem?: string;
	fClientNav?: boolean;
}

function historyState(): DetailHistoryState {
	const state = history.state;
	return state && typeof state === "object" ? (state as DetailHistoryState) : {};
}

function currentHref(): string {
	return location.pathname + location.search + location.hash;
}

/** Put `id` in the address bar — pushing when the page had none, replacing while one is open. */
function writeItem(id: string): void {
	const shown = readItemParam(location.search);
	if (shown === id) return;
	const current = historyState();
	const next = withItemParam(currentHref(), id);
	if (shown !== null) {
		history.replaceState({ ...current, fClientNav: false, pjItem: id }, "", next);
		return;
	}
	history.replaceState({ ...current, fClientNav: false }, "", currentHref());
	history.pushState({ ...current, fClientNav: false, pjItem: id }, "", next);
}

/** Remove the parameter, keeping every other one. Always a replace — never `history.back()`. */
function stripItem(): void {
	if (readItemParam(location.search) === null) return;
	const { pjItem: _dropped, ...rest } = historyState();
	history.replaceState({ ...rest, fClientNav: false }, "", withItemParam(currentHref(), null));
}

/**
 * useDetailRoute — the ONE owner of the `?item=<id>` ⇄ Search Results drawer relationship.
 *
 * **Drawer → URL.** Opening from a card pushes an entry; stepping replaces it; closing from inside
 * the page strips the parameter in place. After an in-page close one entry remains whose URL equals
 * the page's, so the first Back press is a visible no-op — the cost `TicketDeepLinkHost` accepted for
 * never calling `history.back()`, which reloaded the document (Decision #65).
 *
 * **URL → drawer.** On mount and on every `popstate` the parameter is read: none closes the drawer
 * (Back), an id on the page reopens it (Forward), any other id is fetched through `/api/explore/item`
 * and stripped with nothing opened when it does not resolve or is not a drawer item.
 */
export function useDetailRoute({ initial, resolve, onView }: DetailRouteOptions): DetailRoute {
	const item = useSignal<ExploreItem | null>(initial);
	const visible = useSignal(initial !== null);
	/** The id a fetch is resolving, so a stale answer cannot open an item nobody asked for. */
	const pendingRef = useRef<string | null>(null);
	const resolveRef = useRef(resolve);
	resolveRef.current = resolve;

	function present(next: ExploreItem): void {
		pendingRef.current = null;
		item.value = next;
		visible.value = true;
	}

	async function fetchAndShow(id: string): Promise<void> {
		pendingRef.current = id;
		const res = await ExploreService.item(id);
		if (pendingRef.current !== id || readItemParam(location.search) !== id) return;
		pendingRef.current = null;
		if (res.ok && res.data && opensInDrawer(res.data.item)) present(res.data.item);
		else stripItem();
	}

	function syncFromUrl(): void {
		const id = readItemParam(location.search);
		if (id === null) {
			pendingRef.current = null;
			visible.value = false;
			return;
		}
		if (visible.peek() && item.peek()?.id === id) return;
		const local = resolveRef.current(id);
		if (local && opensInDrawer(local)) present(local);
		else void fetchAndShow(id);
	}

	useEffect(() => {
		syncFromUrl();
		addEventListener("popstate", syncFromUrl);
		return () => removeEventListener("popstate", syncFromUrl);
	}, []);

	return {
		item,
		visible,
		open(next) {
			present(next);
			writeItem(next.id);
			onView(next);
		},
		close() {
			pendingRef.current = null;
			visible.value = false;
			stripItem();
		},
	};
}
