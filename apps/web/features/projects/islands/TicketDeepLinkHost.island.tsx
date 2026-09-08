import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Toast, useToast } from "@projective/ui/feedback";
import type { BoardCard, BoardPage } from "../types/projects-types.ts";
import { BoardService } from "../core/BoardService.ts";
import { ticketStack } from "../core/ticket-view.ts";
import {
	isTicketSlug,
	onTicketSurfaceChange,
	openTicketOnSurface,
	readTicketParam,
	ticketDeepLinkAllowed,
	withTicketParam,
} from "../core/ticket-link.ts";
import type { TicketStandaloneProps } from "../components/ticket/TicketStandalone.tsx";

/**
 * TicketDeepLinkHost — the ONE owner of the `?tkv=<ticket-slug>` ⇄ ticket-modal relationship,
 * mounted once per shell (the dashboard layout, and both public layouts) so it is on every page the
 * link may open on.
 *
 * It does two jobs, in both directions:
 *
 * **URL → modal.** On load, and on every `popstate`, it reads the parameter. On an excluded route,
 * for a guest, or for a value that is not a ticket address, it strips the parameter and opens
 * nothing. Otherwise it offers the slug to a registered {@link TicketSurface} first — a board or
 * timeline that already holds the ticket opens it on its own chain, so an edit lands on the board
 * beside it — and only when no surface claims it does it fetch the ticket (with its board) through
 * `/api/projects/ticket` and render the modal itself, from a lazily-loaded chunk. The fetch is what
 * makes the access decision: the server answers a ticket the viewer may not open with the same 404
 * it answers a ticket that does not exist, and the host strips the parameter and says so once.
 *
 * **Modal → URL.** Whenever the chain's top frame is a ticket WITH an address, the parameter is
 * written; when the chain empties, or the top frame is a draft with no address yet, it is stripped.
 * A review frame is left alone: the board rewrites the URL to the submission's own address while a
 * review is open, and restores the ticket parameter itself on the way back.
 *
 * ## History: push on open, replace thereafter, never `history.back()`
 *
 * Opening a ticket from a URL without one PUSHES an entry, so the browser's Back closes the modal
 * and Forward reopens it — the `popstate` listener resolves whatever the restored URL says.
 * Switching tickets while one is open, and stripping on a close the viewer performed, REPLACE the
 * current entry instead. The host never calls `history.back()` to close: after an in-page close
 * one history entry remains whose URL equals the page's, so the first Back press is a visible
 * no-op, and that is the cost accepted here.
 *
 * Decision #65 recorded `history.back()` from a pushed entry RELOADING the document, and built the
 * modal chain on `replaceState` alone to avoid it. That reload has a cause, found here by reading
 * the runtime rather than measuring around it — see {@link TicketHistoryState} — and every entry
 * this host writes is stamped so it cannot happen. Verified: Back closes the modal in place, Forward
 * reopens it, the document survives both.
 *
 * ## Why registration is a notification and not a lookup
 *
 * Islands hydrate in an order this host must not assume. A deep link read before the board has
 * registered would otherwise fall straight through to a fetch and a detached modal on the very page
 * that holds the ticket; instead the host waits a short grace for a surface to claim the slug, and a
 * registration arriving during it hands the ticket to the board.
 */
export interface TicketDeepLinkHostProps {
	/** Whether the viewer is signed in — a guest never opens a ticket, only loses the parameter. */
	authed: boolean;
}

/** How long a pending deep link waits for a page surface to claim it before the host fetches. */
const SURFACE_GRACE_MS = 150;

interface Standalone {
	page: BoardPage;
	card: BoardCard;
	uid: number;
	Component: (props: TicketStandaloneProps) => JSX.Element;
}

/**
 * The history entry marker: `pjTkv` names the slug the entry was pushed for.
 *
 * `fClientNav` is FRESH's flag, and it is the whole reason Back used to reload the document. The
 * Fresh client runtime stamps every entry it sees with `fClientNav: true` and, on `popstate`, treats
 * any entry carrying it as a partial navigation — which on this app, where partials were removed
 * (Decision #52), ends in `location.reload()`. Spreading the page's state into a pushed entry
 * inherited the flag, so traversing back to the page reloaded it. Every entry this host writes
 * carries `fClientNav: false`, and the page's OWN entry is re-stamped `false` the moment a ticket
 * is pushed on top of it, so the pair traverse as plain same-document `popstate`s.
 */
interface TicketHistoryState {
	pjTkv?: string;
	fClientNav?: boolean;
}

function historyState(): TicketHistoryState {
	const state = history.state;
	return state && typeof state === "object" ? (state as TicketHistoryState) : {};
}

export default function TicketDeepLinkHost(props: TicketDeepLinkHostProps): JSX.Element | null {
	const { authed } = props;
	const standalone = useSignal<Standalone | null>(null);
	/** Mounted only once the host has something to say, and never beside another stack. */
	const toastMounted = useSignal(false);
	const toast = useToast();
	/** The slug currently being resolved, so a stale fetch cannot open a ticket nobody asked for. */
	const pendingRef = useRef<string | null>(null);
	const graceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	/** Whether the address bar has been read once — until then the URL is the input, not the output. */
	const readyRef = useRef(false);

	function say(message: string): void {
		if (typeof document !== "undefined" && !document.querySelector(".ui-toast")) {
			toastMounted.value = true;
		}
		toast.show({ severity: "warning", summary: message, life: 5000 });
	}

	// #region URL writes
	function currentHref(): string {
		return location.pathname + location.search + location.hash;
	}

	/** Write `slug` into the address bar — pushing when the page had none, replacing otherwise. */
	function writeParam(slug: string): void {
		if (readTicketParam(location.search) === slug) return;
		const next = withTicketParam(currentHref(), slug);
		const current = historyState();
		const state: TicketHistoryState = { ...current, fClientNav: false, pjTkv: slug };
		if (current.pjTkv) {
			history.replaceState(state, "", next);
			return;
		}
		// Pin the page's own entry first — see {@link TicketHistoryState} for why Fresh's flag has to
		// come off it before anything is pushed on top.
		history.replaceState({ ...current, fClientNav: false }, "", currentHref());
		history.pushState(state, "", next);
	}

	/** Remove the parameter, keeping every other one. Always a replace. */
	function stripParam(): void {
		if (readTicketParam(location.search) === null) return;
		const { pjTkv: _dropped, ...rest } = historyState();
		history.replaceState(
			{ ...rest, fClientNav: false },
			"",
			withTicketParam(currentHref(), null),
		);
	}
	// #endregion

	// #region URL → modal
	function cancelPending(): void {
		pendingRef.current = null;
		if (graceRef.current !== null) {
			clearTimeout(graceRef.current);
			graceRef.current = null;
		}
	}

	async function fetchAndOpen(slug: string): Promise<void> {
		const res = await BoardService.ticket(slug);
		// The viewer may have navigated or closed the modal while the request was in flight; a
		// modal opening then would be one nobody asked for.
		if (pendingRef.current !== slug) return;
		pendingRef.current = null;
		if (!res.ok || !res.data) {
			stripParam();
			say(res.message ?? "That ticket could not be opened.");
			return;
		}
		// The renderer and its stylesheets arrive with the first ticket ever opened on this page,
		// not with every page the host is mounted on.
		const mod = await import("../components/ticket/TicketStandalone.tsx");
		if (readTicketParam(location.search) !== slug) return;
		const { page, card } = res.data;
		const frame = ticketStack.open("ticket", card.id, {
			ticketId: card.id,
			slug,
			standalone: true,
		});
		standalone.value = { page, card, uid: frame.uid, Component: mod.TicketStandalone };
	}

	/** Resolve a slug the URL is asking for: a page surface first, the fetch after a grace. */
	function resolve(slug: string): void {
		if (pendingRef.current === slug) return;
		cancelPending();
		if (openTicketOnSurface(slug)) return;
		pendingRef.current = slug;
		graceRef.current = setTimeout(() => {
			graceRef.current = null;
			if (pendingRef.current !== slug) return;
			if (openTicketOnSurface(slug)) {
				pendingRef.current = null;
				return;
			}
			void fetchAndOpen(slug);
		}, SURFACE_GRACE_MS);
	}

	/** Make the modal agree with the address bar. */
	function syncFromUrl(): void {
		const raw = readTicketParam(location.search);
		const top = ticketStack.top.peek();

		if (raw === null) {
			cancelPending();
			// A ticket frame with no parameter behind it is one Back has just closed. A review frame
			// owns its own address and is left to the board.
			if (top && top.kind === "ticket") {
				ticketStack.close();
				standalone.value = null;
			}
			return;
		}

		if (!ticketDeepLinkAllowed(location.pathname) || !authed) {
			cancelPending();
			stripParam();
			return;
		}
		if (!isTicketSlug(raw)) {
			cancelPending();
			stripParam();
			say("That ticket link is not valid.");
			return;
		}
		if (top && top.kind === "ticket" && top.input?.slug === raw) return;
		resolve(raw);
	}

	useEffect(() => {
		// Armed BEFORE the first sync, so a ticket a page surface opens synchronously inside it is
		// written back to the address bar by the effect below rather than missed.
		readyRef.current = true;
		syncFromUrl();
		const onPop = () => syncFromUrl();
		addEventListener("popstate", onPop);
		// A surface registering while a slug is pending takes it over from the fetch.
		const stop = onTicketSurfaceChange(() => {
			const slug = pendingRef.current;
			if (slug && openTicketOnSurface(slug)) cancelPending();
		});
		return () => {
			removeEventListener("popstate", onPop);
			stop();
			cancelPending();
		};
		// The host is mounted once per document; `authed` is a server fact for that document.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	// #endregion

	// #region Modal → URL
	useSignalEffect(() => {
		// Read the signal FIRST, unconditionally: a signal effect subscribes to what it reads, and an
		// early return above this line would leave it subscribed to nothing and never run again.
		const top = ticketStack.top.value;
		if (typeof location === "undefined") return;
		// A signal effect runs synchronously on the first render, BEFORE the mount effect has read
		// the address bar. Acting then — an empty chain, so "strip" — deleted the very parameter the
		// host was about to resolve (measured: `/messages?tkv=…` loaded as `/messages` with nothing
		// open). The URL is the input until `syncFromUrl` has run, and stays the input while a slug
		// is being resolved.
		if (!readyRef.current) return;
		if (!top) {
			standalone.value = null;
			if (!pendingRef.current) stripParam();
			return;
		}
		if (top.kind !== "ticket") return;
		const slug = top.input?.slug;
		if (slug) writeParam(slug);
		else stripParam();
	});
	// #endregion

	const frame = ticketStack.top.value;
	const shown = standalone.value;
	const rendersStandalone = !!frame && frame.kind === "ticket" && !!frame.input?.standalone &&
		!!shown && shown.uid === frame.uid;

	return (
		<>
			{rendersStandalone && shown
				? (
					<shown.Component
						uid={shown.uid}
						page={shown.page}
						card={shown.card}
						onClose={() => {
							standalone.value = null;
							ticketStack.close();
						}}
						onSaved={(page, card) => {
							standalone.value = { ...shown, page, card };
						}}
						onRefused={say}
					/>
				)
				: null}
			{toastMounted.value ? <Toast position="bottom-center" /> : null}
		</>
	);
}
