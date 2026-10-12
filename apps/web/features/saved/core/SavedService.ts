import {
	type SavedCollection,
	SavedCollectionSchema,
	type SavedEntityType,
	type SavedPage,
	SavedPageSchema,
	type SavedState,
	SavedStateSchema,
	type SavedTab,
} from "@projective/types/org";
import { apiFetch } from "@web/utils/api-client.ts";
import { readDevSeam } from "@web/utils/dev-seam.ts";
import {
	simCollection,
	simCollections,
	simDeleteCollection,
	simList,
	simState,
	simToggle,
} from "./saved-sim.ts";

/**
 * SavedService — the THIN client for `/api/saved/*` (served by `SavedBackendService`, Decision #174).
 * Every star, save and favourite control and the `/saved` page call this, never Supabase. While the
 * Dev Context Switcher's `saved` axis is set, every call is answered by `saved-sim` instead.
 */

/** An outcome: the data and the server's sentence, or the sentence to show and roll back on. */
export type SavedResult<T> = { ok: true; data: T; message: string } | {
	ok: false;
	message: string;
};

const FAILED = "That didn't save. Try again.";
const READ_FAILED = "We couldn't load your saved items. Try again in a moment.";

/** The simulated mode, or `null` for the real saved set. */
function sim() {
	const mode = readDevSeam()?.saved;
	return mode && mode !== "auto" ? mode : null;
}

async function call<T>(
	path: string,
	init: RequestInit,
	parse: (body: unknown) => T | null,
	fallback = FAILED,
): Promise<SavedResult<T>> {
	try {
		const res = await apiFetch(path, {
			...init,
			headers: { accept: "application/json", ...init.headers },
		});
		const body = await res.json().catch(() => null);
		if (!res.ok) return { ok: false, message: body?.message ?? fallback };
		const data = parse(body);
		return data === null
			? { ok: false, message: fallback }
			: { ok: true, data, message: body?.message ?? "" };
	} catch {
		return { ok: false, message: fallback };
	}
}

const json = (method: string, body: unknown): RequestInit => ({
	method,
	headers: { "content-type": "application/json" },
	body: JSON.stringify(body),
});

export const SavedService = {
	/** Save or un-save one thing; `collectionId` files a bookmark (null = unfiled). */
	toggle(input: {
		type: SavedEntityType;
		ref: string;
		saved: boolean;
		collectionId?: string | null;
	}): Promise<SavedResult<SavedState>> {
		const mode = sim();
		if (mode) return Promise.resolve(simToggle(mode, input));
		const parse = (b: unknown) => {
			const p = SavedStateSchema.safeParse(b);
			return p.success ? p.data : null;
		};
		if (!input.saved) {
			const q = new URLSearchParams({ type: input.type, ref: input.ref });
			return call(`/api/saved?${q}`, { method: "DELETE" }, parse);
		}
		const { saved: _saved, ...body } = input;
		return call("/api/saved", json("POST", body), parse);
	},

	/** One page of a tab (optionally one collection); `cursor` is the previous page's `nextCursor`. */
	list(
		params: { tab: SavedTab; collection?: string; cursor?: string | null },
	): Promise<SavedResult<SavedPage>> {
		const mode = sim();
		if (mode) return Promise.resolve({ ok: true, data: simList(mode, params), message: "" });
		const q = new URLSearchParams({ tab: params.tab });
		if (params.collection) q.set("collection", params.collection);
		if (params.cursor) q.set("cursor", params.cursor);
		return call(`/api/saved?${q}`, { method: "GET" }, (b) => {
			const p = SavedPageSchema.safeParse(b);
			return p.success ? p.data : null;
		}, READ_FAILED);
	},

	/** Which of these `type:ref` keys are saved; `null` when the lookup failed. */
	async state(keys: readonly string[]): Promise<Set<string> | null> {
		const mode = sim();
		if (mode) return simState(mode, keys);
		const res = await call(
			`/api/saved/state?keys=${encodeURIComponent(keys.join(","))}`,
			{ method: "GET" },
			(b) =>
				Array.isArray((b as { saved?: unknown })?.saved) ? (b as { saved: string[] }).saved : null,
		);
		return res.ok ? new Set(res.data) : null;
	},

	/** The caller's collections. */
	collections(): Promise<SavedResult<SavedCollection[]>> {
		const mode = sim();
		if (mode) return Promise.resolve({ ok: true, data: simCollections(mode), message: "" });
		return call("/api/saved/collections", { method: "GET" }, (b) => {
			const p = SavedCollectionSchema.array().safeParse(
				(b as { collections?: unknown })?.collections,
			);
			return p.success ? p.data : null;
		}, READ_FAILED);
	},

	/** Create a collection. */
	createCollection(name: string): Promise<SavedResult<SavedCollection>> {
		const mode = sim();
		if (mode) return Promise.resolve(simCollection(name));
		return call("/api/saved/collections", json("POST", { name }), (b) => {
			const p = SavedCollectionSchema.safeParse(b);
			return p.success ? p.data : null;
		});
	},

	/** Delete a collection; its items stay saved, unfiled. */
	deleteCollection(id: string): Promise<SavedResult<{ id: string }>> {
		const mode = sim();
		if (mode) return Promise.resolve(simDeleteCollection(id));
		return call(
			`/api/saved/collections/${encodeURIComponent(id)}`,
			{ method: "DELETE" },
			() => ({ id }),
		);
	},
};
