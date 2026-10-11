import { COLLECTABLE_TYPES, SAVED_TAB_TYPES, type SavedItem, SavedTab } from "@projective/types/org";
import { relativeAge } from "@features/explore/core/card-signals.ts";

/**
 * saved-model — the pure half of `/saved` (Decision #174): the tab vocabulary, the deep link
 * (`?tab=&collection=`), the meta line and the empty-state sentences. Testable without a DOM.
 */

/** The tabs, in display order. */
export const SAVED_TABS: readonly SavedTab[] = SavedTab.options;

/** A tab's label. */
export const TAB_LABEL: Readonly<Record<SavedTab, string>> = {
	all: "All",
	listings: "Services & products",
	people: "People",
	projects: "Projects",
	messages: "Messages",
	files: "Files",
};

/** The tab a raw `?tab=` names, or All. */
export function parseTab(raw: string | null | undefined): SavedTab {
	return SAVED_TABS.includes(raw as SavedTab) ? raw as SavedTab : "all";
}

/** The collection a raw `?collection=` names (`unfiled` or an id), or none. */
export function parseCollection(raw: string | null | undefined): string | undefined {
	if (raw === "unfiled") return raw;
	return raw && /^[0-9a-f-]{36}$/i.test(raw) ? raw : undefined;
}

/** Whether a tab lists any kind that can be filed into a collection. */
export function tabHasCollections(tab: SavedTab): boolean {
	return tab === "all" || SAVED_TAB_TYPES[tab].some((t) => COLLECTABLE_TYPES.includes(t));
}

/** The page's address for a tab and collection; defaults are omitted, so `/saved` is All. */
export function savedHref(tab: SavedTab, collection?: string): string {
	const q = new URLSearchParams();
	if (tab !== "all") q.set("tab", tab);
	if (collection) q.set("collection", collection);
	const s = q.toString();
	return s ? `/saved?${s}` : "/saved";
}

/** A row's one meta line: the kind and owner or place, then when it was saved. */
export function metaLine(item: SavedItem, now: number): string {
	if (!item.savedAt) return item.meta;
	const age = relativeAge(item.savedAt, now);
	return `${item.meta} · ${item.following ? "followed" : "saved"} ${age ? `${age} ago` : "just now"}`;
}

/** The empty state's sentence for a tab, narrowed to a collection or not. */
export function emptyCopy(tab: SavedTab, collection: string | undefined): { title: string; description: string } {
	if (collection) {
		return {
			title: collection === "unfiled" ? "Nothing outside a collection" : "This collection is empty",
			description: "Add a saved listing, person or channel to it with Add to collection.",
		};
	}
	const copy: Record<SavedTab, { title: string; description: string }> = {
		all: { title: "Nothing saved yet", description: "Star a service, a person, a project, a message or a file and it lands here." },
		listings: { title: "No saved services or products", description: "Save a listing from Explore or its page to come back to it." },
		people: { title: "No saved people", description: "Save or follow someone from their profile or an Explore card." },
		projects: { title: "No starred projects", description: "Star a project from your Projects list or its page." },
		messages: { title: "No saved messages", description: "Star a conversation or a channel, or favourite a message." },
		files: { title: "No starred files", description: "Star one of your files from its preview." },
	};
	return copy[tab];
}
