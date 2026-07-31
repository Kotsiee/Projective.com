import { signal } from "@preact/signals";
import type {
	CatalogueKind,
	CatalogueSort,
	CatalogueSortDir,
	ListingStatus,
	ServiceType,
} from "../types/catalogue-types.ts";

/**
 * catalogue-state — every cross-island signal on the Catalogue surface. The surface renders four
 * hydration roots per route (the lane, the middle-nav HEADER band, the middle-nav FOOTER band, and the
 * body), so the region contract can only hold if those roots coordinate through module-level signals —
 * the same footer↔body pattern as `board-state` / `view-state`.
 *
 * Three bridges live here:
 *  1. **Create** — the lane's `＋ New`, the footer rig's mobile create, and the console's empty-state CTA
 *     all open the SAME modal (mounted once in the lane), seeding its kind + delivery model.
 *  2. **Console** — the header band owns the one search field and the analytics period; the footer band
 *     owns sort; the body owns the data and publishes back what it found (count · busy · error) so the
 *     header can report it. There is exactly ONE query signal, so the lane narrow and the console fetch
 *     can never disagree.
 *  3. **Editor** — the manage page's identity + save state are published by the body for the header
 *     band, and the footer band publishes lifecycle intents the body performs (it owns the draft).
 */

// #region Create modal
/** Whether the Create-Listing modal is open. */
export const createModalOpen = signal<boolean>(false);
/** The kind the modal opens seeded to (Product / Service). */
export const createSeedKind = signal<CatalogueKind>("service");
/** The delivery model the modal opens seeded to (services only). */
export const createSeedModel = signal<ServiceType>("One-Off");

/** Open the Create-Listing modal, optionally seeding the kind + delivery model. */
export function openCreate(kind?: CatalogueKind, model?: ServiceType): void {
	if (kind) createSeedKind.value = kind;
	if (model) createSeedModel.value = model;
	createModalOpen.value = true;
}
// #endregion

// #region Console — header band → body/lane
/**
 * THE search term for the whole console. The header band writes it; the body debounces a refetch and
 * the lane narrows its status sections against the same string. Previously there were two independent
 * search fields — one in the lane, one in the body toolbar — with different scopes and no shared state,
 * so a term that emptied the console left the lane showing every listing. One signal, one truth.
 */
export const consoleQuery = signal<string>("");

/** The analytics window the KPI strip reports over (header band → the `AnalyticsStrip` in the body). */
export type AnalyticsPeriod = "7d" | "30d" | "90d";
export const analyticsPeriod = signal<AnalyticsPeriod>("30d");
// #endregion

// #region Console — footer band → body
/** The active sort key (footer `SortControl` → body refetch). */
export const consoleSort = signal<CatalogueSort>("recent");
/** The active sort direction. */
export const consoleSortDir = signal<CatalogueSortDir>("desc");
// #endregion

// #region Console — body → header band
/** How many listings the current query actually returned (the header band reports it). */
export const consoleTotal = signal<number>(0);
/** Whether a console fetch is in flight — drives the header's activity mark and the body skeleton. */
export const consoleBusy = signal<boolean>(false);
/**
 * The last console fetch failure, or null. A non-null value means the rendered list is STALE: it does
 * not answer the query in the search box. Nothing may render an "empty" state while this is set —
 * an outage and a zero-result search must never look the same.
 */
export const consoleError = signal<string | null>(null);
// #endregion

// #region Manage page — body → header band
/** The edited listing's live title (the header band shows it; the body owns the draft). */
export const editorTitle = signal<string>("");
/** The edited listing's current lifecycle status. */
export const editorStatus = signal<ListingStatus>("draft");
/** The autosave state — a persistent indicator in the header band, never in the scroll flow. */
export const editorSaveState = signal<"saved" | "saving" | "unsaved">("saved");
/** Whether the listing currently satisfies the publish gate, and what is missing if not. */
export const editorReady = signal<boolean>(false);
export const editorMissing = signal<readonly string[]>([]);
// #endregion

// #region Manage page — footer band → body
/**
 * A lifecycle transition requested from the footer band. The body flushes its pending autosave, calls
 * the thin service and resets this to null — the footer never touches the network, because only the
 * body holds the unsaved draft that Publish must be judged against.
 */
export const editorStatusRequest = signal<ListingStatus | null>(null);

/** Request a lifecycle transition from the footer band. */
export function requestStatus(next: ListingStatus): void {
	editorStatusRequest.value = next;
}
// #endregion
