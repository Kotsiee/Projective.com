import {
	SAVED_TAB_TYPES,
	type SavedCollection,
	type SavedEntityType,
	type SavedItem,
	savedKey,
	type SavedPage,
	type SavedState,
	type SavedTab,
} from "@projective/types/org";
import type { DevSaved } from "@web/utils/dev-seam.ts";

/**
 * saved-sim — the Dev Context Switcher's saved set (`saved` axis, Decision #174). When the axis is not
 * `auto`, {@link SavedService} answers from here in the API's own shapes, and its writes change this
 * set — never the server. Development only: the seam reads `null` in production.
 */

type SimMode = Exclude<DevSaved, "auto">;

const PAGE = 30;
const DAY = 86_400_000;

let state: { mode: SimMode; items: SavedItem[]; collections: SavedCollection[] } | null = null;

const SHORTLIST = "00000000-0000-4000-8000-0000000c0001";
const INSPIRATION = "00000000-0000-4000-8000-0000000c0002";

function item(
	n: number,
	type: SavedEntityType,
	ref: string,
	title: string,
	meta: string,
	href: string,
	extra: Partial<SavedItem> = {},
): SavedItem {
	return {
		type,
		ref,
		title,
		meta,
		thumbnail: null,
		href,
		savedAt: new Date(Date.now() - n * DAY / 3).toISOString(),
		collectionId: null,
		following: false,
		...extra,
	};
}

/** Saved things of every kind, two collections and three follows. */
function many(): SavedItem[] {
	const id = (n: number) => `00000000-0000-4000-8000-${String(700000000000 + n)}`;
	return [
		item(1, "service", "svc-sim-brand", "Brand identity sprint", "Service · Atelier Nova", "/explore?category=services", { collectionId: SHORTLIST }),
		item(2, "service", "svc-sim-mvp", "Realtime MVP build", "Service · Maris Delacroix", "/explore?category=services"),
		item(3, "product", "prd-sim-kit", "Aurora UI kit", "Product · Atelier Nova", "/explore?category=products", { collectionId: INSPIRATION }),
		item(4, "article", "art-sim-team", "How to hire a whole team", "Article · Studio Fern", "/explore?category=articles"),
		item(5, "profile", "marisdelacroix", "Maris Delacroix", "Freelancer", "/@marisdelacroix", { collectionId: SHORTLIST }),
		item(6, "profile", "ateliernova", "Atelier Nova", "Team", "/@ateliernova"),
		item(7, "project", "prj-sim-portfolio", "Haddad Studio portfolio site", "Project", "/projects", { savedAt: null }),
		item(8, "project_channel", id(8), "Discussion", "Channel · Haddad Studio portfolio site", "/projects"),
		item(9, "conversation", id(9), "Maris Delacroix", "Conversation · Yesterday", "/messages", { savedAt: null }),
		item(10, "message", id(10), "On it — first layout pass Thursday.", "Message · Juno Park · Haddad Studio", "/messages"),
		item(11, "file", id(11), "Moodboard v2.png", "File · PNG", "/files", { savedAt: null }),
		item(12, "file", id(12), "Brief.pdf", "File · PDF", "/files", { savedAt: null }),
		item(13, "profile", "juno", "Juno Park", "Freelancer · Following", "/@juno", { following: true }),
		item(14, "profile", "studiofern", "Studio Fern", "Team · Following", "/@studiofern", { following: true }),
		item(15, "profile", "heliafinance", "Helia Finance", "Business · Following", "/@heliafinance", { following: true }),
	];
}

function current(mode: SimMode) {
	if (!state || state.mode !== mode) {
		state = mode === "many"
			? {
				mode,
				items: many(),
				collections: [{ id: SHORTLIST, name: "Shortlist" }, { id: INSPIRATION, name: "Inspiration" }],
			}
			: { mode, items: [], collections: [] };
	}
	return state;
}

/** One page, ordered as the server orders it: saved first, follows last, newest save first. */
export function simList(
	mode: SimMode,
	params: { tab: SavedTab; collection?: string; cursor?: string | null },
): SavedPage {
	const s = current(mode);
	const types = params.tab === "all" ? null : new Set(SAVED_TAB_TYPES[params.tab]);
	const rows = s.items
		.filter((i) => !types || types.has(i.type))
		.filter((i) =>
			params.collection === undefined ||
			(!i.following && (params.collection === "unfiled" ? i.collectionId === null : i.collectionId === params.collection))
		)
		.sort((a, b) => Number(a.following) - Number(b.following) || (b.savedAt ?? "").localeCompare(a.savedAt ?? ""));
	const offset = Number(params.cursor ?? 0);
	return {
		items: rows.slice(offset, offset + PAGE),
		nextCursor: offset + PAGE < rows.length ? String(offset + PAGE) : null,
		collections: s.collections,
	};
}

/** Save, re-file or un-save in the simulated set. */
export function simToggle(
	mode: SimMode,
	input: { type: SavedEntityType; ref: string; saved: boolean; collectionId?: string | null },
): { ok: true; data: SavedState; message: string } {
	const s = current(mode);
	const at = s.items.findIndex((i) => !i.following && i.type === input.type && i.ref === input.ref);
	if (!input.saved) {
		if (at >= 0) s.items.splice(at, 1);
		return { ok: true, data: { saved: false, collectionId: null }, message: "Removed from saved." };
	}
	const existing = at >= 0 ? s.items[at] : item(0, input.type, input.ref, input.ref, input.type, "/saved");
	if (input.collectionId !== undefined) existing.collectionId = input.collectionId;
	if (at < 0) s.items.unshift(existing);
	return { ok: true, data: { saved: true, collectionId: existing.collectionId }, message: "Saved." };
}

/** Which keys the simulated set holds. */
export function simState(mode: SimMode, keys: readonly string[]): Set<string> {
	const held = new Set(current(mode).items.filter((i) => !i.following).map((i) => savedKey(i.type, i.ref)));
	return new Set(keys.filter((k) => held.has(k)));
}

/** The simulated collections. */
export function simCollections(mode: SimMode): SavedCollection[] {
	return current(mode).collections;
}

/** Create a simulated collection. */
export function simCollection(name: string): { ok: true; data: SavedCollection; message: string } {
	const collection = { id: crypto.randomUUID(), name };
	state?.collections.push(collection);
	return { ok: true, data: collection, message: "Collection created." };
}

/** Delete a simulated collection; its items become unfiled. */
export function simDeleteCollection(id: string): { ok: true; data: { id: string }; message: string } {
	if (state) {
		state.collections = state.collections.filter((c) => c.id !== id);
		for (const i of state.items) if (i.collectionId === id) i.collectionId = null;
	}
	return { ok: true, data: { id }, message: "Collection deleted. Its items are still saved." };
}
