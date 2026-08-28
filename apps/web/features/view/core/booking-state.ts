import { computed, signal } from "@preact/signals";
import type { ContactOffer, ServiceBookingOffer } from "@projective/types/services";

/**
 * booking-state — the cross-island bridge for the listing page's conversion flows.
 *
 * The transaction is carried by two mutually exclusive regions — the middle-nav conversion lane above
 * `--bp-md`, and the in-body buy bar below it (§D.7.4). They hide each other by `display`, not by
 * unmounting, so they are two live hydration roots that cannot pass props. Every piece of state a
 * booking flow needs therefore lives here, exactly like `buy-now-state.ts` beside it and the board's
 * footer ⇄ body bridge before that.
 *
 * A full navigation reloads the page and resets these, which is the intended transient scope: a
 * half-written brief is not something to resurrect three pages later.
 */

// #region Which panel is open
/**
 * The booking panel currently open, or `null`.
 *
 * ONE signal rather than four booleans, and that is not tidiness. Four booleans have sixteen states,
 * fifteen of which are wrong, and the one that bites is two panels open at once — two focus traps,
 * two `Escape` owners, and a backdrop belonging to whichever mounted last.
 */
export type BookingPanel = "scheduler" | "scope" | "quote" | "call" | null;

/** The open panel. */
export const openPanel = signal<BookingPanel>(null);

/** Whether any booking panel is open — the `aria-expanded` every trigger reads. */
export const anyPanelOpen = computed(() => openPanel.value !== null);

/** Open a panel, replacing whatever was open. */
export function openBookingPanel(panel: Exclude<BookingPanel, null>): void {
	openPanel.value = panel;
}

/** Close whatever is open. Safe to call when nothing is. */
export function closeBookingPanel(): void {
	openPanel.value = null;
}
// #endregion

// #region The offer
/**
 * The live offer, seeded from SSR and replaced whenever the server re-resolves it.
 *
 * It is a signal rather than a prop because a WRITE can move it: instantiating a pipeline flips the
 * primary from "Add to projects" to "Open project", and both regions must flip together. Passing the
 * SSR value down as a prop would leave whichever region did not perform the write showing the old
 * verb until the next navigation.
 */
export const currentOffer = signal<ServiceBookingOffer | null>(null);

/** The Contact menu for the current listing, or `null` before the offer resolves. */
export const contactOffer = computed<ContactOffer | null>(() => currentOffer.value?.contact ?? null);

/**
 * Seed the offer from SSR, once.
 *
 * Guarded on the subject rather than on emptiness: a second region mounting must not overwrite an
 * offer the first has already updated through a write, but a NEW listing (a client-side navigation
 * between two `/view/*` pages) must replace it. `null`-checking alone would get the first case right
 * and the second silently wrong.
 */
export function seedOffer(offer: ServiceBookingOffer): void {
	const current = currentOffer.value;
	if (current && current.subjectId === offer.subjectId) return;
	currentOffer.value = offer;
}

/** Replace the offer after a write. */
export function applyOffer(offer: ServiceBookingOffer): void {
	currentOffer.value = offer;
}
// #endregion

// #region Status line
/**
 * The last thing that happened, for the shared `role="status"` line.
 *
 * Server-authored copy, always: the fat service writes the sentence and the surface prints it, so a
 * refusal explains itself in the same words wherever it is read. A client that composed its own would
 * need the rules to compose it from, which is the boundary this whole layer exists to hold.
 */
export const bookingStatus = signal("");

/** Announce an outcome. */
export function announce(message: string): void {
	bookingStatus.value = message;
}
// #endregion

// #region Host election
/**
 * Where the shared modal layer is mounted.
 *
 * Both transactional regions are always mounted (they hide each other by `display`, not by
 * unmounting) and every panel renders through `BodyPortal`, which escapes a hidden ancestor entirely
 * — so two mounted hosts would composite two identical modals, two focus traps and two submissions of
 * one booking. Exactly one host renders, chosen by a FIXED priority rather than by mount order, so the
 * winner cannot change between renders.
 *
 * Lifted verbatim from `buy-now-state.ts`, which solved the same problem for the same reason.
 */
export type BookingHost = "lane" | "body";

/** Lower wins. Fixed, so the elected host never depends on which island hydrated first. */
const HOST_RANK: Record<BookingHost, number> = { lane: 0, body: 1 };

const mountedHosts = signal<readonly BookingHost[]>([]);

/** The host currently responsible for rendering the panels, or `null` while none is mounted. */
export const bookingHost = computed<BookingHost | null>(() => {
	let winner: BookingHost | null = null;
	for (const host of mountedHosts.value) {
		if (winner === null || HOST_RANK[host] < HOST_RANK[winner]) winner = host;
	}
	return winner;
});

/** Register a mounted host. Returns the de-registration callback an effect cleanup runs. */
export function registerBookingHost(host: BookingHost): () => void {
	mountedHosts.value = [...mountedHosts.value, host];
	return () => {
		const next = [...mountedHosts.value];
		const at = next.indexOf(host);
		if (at >= 0) next.splice(at, 1);
		mountedHosts.value = next;
	};
}
// #endregion
