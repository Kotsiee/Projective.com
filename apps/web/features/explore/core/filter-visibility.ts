import { signal } from "@preact/signals";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";

/**
 * filter-visibility — the collapsed/expanded state of the Search filter sidebar for a GUEST.
 *
 * The state is expressed on `:root[data-explore-filters]`, the same way the guest aside's rail
 * width (`data-guest-nav`) and the authed rail (`data-sidebar`) are: `_app.tsx` pre-paints it from
 * {@link LocalKeys.EXPLORE_FILTERS_HIDDEN} before first paint, so a reader who hid the filters does
 * not watch them appear and slide away on every navigation, and `guest-shell.css` collapses the
 * `.ui-guest-aside` off that one attribute. This module is the ONE writer: the toggle in the results
 * bar (a `SearchDashboard` control) and the lane itself both read the shared signal, and either may
 * flip it.
 *
 * Guest-only by construction: the authenticated middle-nav lane is owned by the shell's splitter
 * (`MiddleNavSplitter`), whose collapsed state is a rail, not an absence, and whose width is an
 * inline custom property this attribute cannot reach. The authed shell keeps its own lane controls.
 */

/** The root attribute the stylesheet reads. */
export const EXPLORE_FILTERS_ATTR = "exploreFilters";

/** Live hidden/shown state — `true` when the filter sidebar is hidden. */
export const filtersHidden = signal<boolean>(false);

/** Reconcile the signal with the pre-painted attribute + the cached preference (call once on mount). */
export function syncFiltersHidden(): void {
	if (typeof document === "undefined") return;
	const stored = readStored("local", LocalKeys.EXPLORE_FILTERS_HIDDEN);
	const hidden = stored === "1";
	filtersHidden.value = hidden;
	document.documentElement.dataset[EXPLORE_FILTERS_ATTR] = hidden ? "hidden" : "shown";
}

/** Hide or show the filter sidebar, persisting the choice for the next visit. */
export function setFiltersHidden(hidden: boolean): void {
	filtersHidden.value = hidden;
	if (typeof document === "undefined") return;
	document.documentElement.dataset[EXPLORE_FILTERS_ATTR] = hidden ? "hidden" : "shown";
	writeStored("local", LocalKeys.EXPLORE_FILTERS_HIDDEN, hidden ? "1" : "0");
}
