import { isSlug } from "@projective/types/slugs";

/**
 * ticket-link — the pure half of the `?tkv=` ticket deep link: the parameter's name, how it is read
 * from and written into a URL, which routes it may open a modal on, and the registry through which
 * a page that already holds the ticket (a board, a timeline) volunteers to open it itself.
 *
 * No DOM and no signals here: every rule is a function of strings, so it is unit-testable and the
 * global host island (`TicketDeepLinkHost`) is left with only the browser plumbing.
 *
 * ## The parameter is the ticket's SLUG, never its id
 *
 * `?tkv=tkt-…` carries `projects.tickets.slug` (Decision #88's minted, immutable address). A uuid
 * would survive too, but it says nothing about what it addresses and cannot be refused by shape —
 * and the shape is the FIRST gate here: a value that is not a well-formed ticket slug is stripped
 * before it costs a request.
 */

// #region The parameter
/** The query-string key. Short on purpose: it is typed by hand and pasted into chat. */
export const TICKET_PARAM = "tkv";

/**
 * The raw `tkv` value in a query string, or `null` when the key is absent.
 *
 * Deliberately returns a MALFORMED value rather than dropping it: the host has to strip a bad
 * parameter from the address bar, which it cannot do if it never learns one was there. Whether the
 * value could address a ticket is {@link isTicketSlug}'s question.
 */
export function readTicketParam(search: string): string | null {
	const value = new URLSearchParams(search).get(TICKET_PARAM);
	return value === null || value.length === 0 ? null : value;
}

/** Whether a `tkv` value has the shape of a ticket address (`tkt-` + 10 symbols). */
export function isTicketSlug(value: string): boolean {
	return isSlug(value, "ticket");
}

/**
 * `href` (a `pathname + search [+ hash]` string) with the `tkv` parameter set to `slug`, or removed
 * when `slug` is `null`. Every OTHER parameter is preserved verbatim, in its original order, which is
 * what lets the deep link coexist with a filter, a tab or a `?review=1` hand-off on the same page.
 *
 * Idempotent: writing the slug already present returns an equal string, so a URL sync that runs on
 * every render can compare before it touches history.
 */
export function withTicketParam(href: string, slug: string | null): string {
	const hashAt = href.indexOf("#");
	const hash = hashAt >= 0 ? href.slice(hashAt) : "";
	const beforeHash = hashAt >= 0 ? href.slice(0, hashAt) : href;
	const queryAt = beforeHash.indexOf("?");
	const pathname = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
	const params = new URLSearchParams(queryAt >= 0 ? beforeHash.slice(queryAt + 1) : "");
	if (slug === null) params.delete(TICKET_PARAM);
	else params.set(TICKET_PARAM, slug);
	const search = params.toString();
	return `${pathname}${search ? `?${search}` : ""}${hash}`;
}
// #endregion

// #region Where the link may open
/**
 * Routes on which a `?tkv=` parameter is NOT honoured: the modal never opens and the parameter is
 * stripped.
 *
 * Marketing and help pages, because a ticket modal over a landing page is a product surface leaking
 * into a public one; the auth screens, which own a full-window shell with nothing behind it to put
 * a modal on; the anonymous share landing; and the two COMMITTING checkout steps, where a modal
 * appearing over a payment form is a distraction at exactly the wrong moment (the basket step before
 * them and the confirmation after are ordinary pages and are not excluded).
 *
 * A prefix entry (`"/help"`) covers the path and everything beneath it; an exact entry covers only
 * itself. The checkout pair is exact by specification.
 */
const EXCLUDED_EXACT: ReadonlySet<string> = new Set([
	"/",
	"/about",
	"/checkout/details",
	"/checkout/payment",
]);
const EXCLUDED_PREFIXES: readonly string[] = [
	"/help",
	"/share",
	"/login",
	"/join",
	"/forgot-password",
	"/verify",
];

/** Whether a `?tkv=` parameter on `pathname` may open the ticket modal. */
export function ticketDeepLinkAllowed(pathname: string): boolean {
	const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
	if (EXCLUDED_EXACT.has(path)) return false;
	return !EXCLUDED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
// #endregion

// #region Surfaces that can open a ticket themselves
/**
 * A page region that already holds a ticket's board — the Kanban board, the timeline — and can open
 * the modal on its own chain, with its own cards, so an edit made through the deep link lands on the
 * board beside it rather than in a detached copy.
 */
export interface TicketSurface {
	/**
	 * Open the ticket with this slug, if this surface holds it. Returns `false` when it does not, in
	 * which case the host resolves the ticket itself.
	 */
	openBySlug(slug: string): boolean;
}

const surfaces = new Set<TicketSurface>();
const listeners = new Set<() => void>();

/**
 * Register a surface for the life of a page region. Returns the unregister function, for an effect
 * cleanup. Registration NOTIFIES the host, because a deep link resolved before the board hydrated
 * must still be handed to the board once it has — hydration order is not something either side
 * should have to guess.
 */
export function registerTicketSurface(surface: TicketSurface): () => void {
	surfaces.add(surface);
	for (const notify of listeners) notify();
	return () => {
		surfaces.delete(surface);
	};
}

/** Subscribe to surface registrations. Returns the unsubscribe function. */
export function onTicketSurfaceChange(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Offer a slug to every registered surface; `true` the moment one opens it. */
export function openTicketOnSurface(slug: string): boolean {
	for (const surface of surfaces) {
		if (surface.openBySlug(slug)) return true;
	}
	return false;
}

/** Tests only — forget every surface and listener. */
export function resetTicketSurfaces(): void {
	surfaces.clear();
	listeners.clear();
}
// #endregion
