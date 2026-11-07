/// <reference lib="dom" />
/**
 * thumb-cache — finished thumbnails, kept in memory for this page and in `CacheStorage` for the next
 * visit, so a folder only ever pays for drawing a file once.
 *
 * A thumbnail of a private file is a copy of private content sitting on the device, so it does not
 * outlive the session: {@link purgeThumbs} runs at sign-out. It is keyed by the file's id and content
 * and only looked up for a row the server just returned to this viewer, so it can never show someone
 * a file they cannot read, which is the reason `sw.js` gives for keeping `/api/` out of its own cache.
 *
 * No dependencies, because the shell imports this for the sign-out path.
 */

// #region Contract
/** What a thumbnail turned out to be. */
export type ThumbResult =
	| { type: "image"; url: string }
	| { type: "lines"; lines: readonly string[] }
	/** Nothing drawable; the card keeps its tile, and this session does not try again. */
	| { type: "none" };

/** What a renderer hands back, before it is cached. */
export type ThumbOutput = { blob: Blob } | { lines: readonly string[] };
// #endregion

const CACHE_NAME = "pj-thumbs-v1";
const MEMORY_ENTRIES = 320;
const STORED_ENTRIES = 1_500;
const TRIM_EVERY_WRITES = 50;

const memory = new Map<string, ThumbResult>();
let writes = 0;

function remember(key: string, result: ThumbResult): ThumbResult {
	memory.delete(key);
	memory.set(key, result);
	while (memory.size > MEMORY_ENTRIES) {
		const oldest = memory.keys().next().value as string;
		const gone = memory.get(oldest);
		// The `<img>` on screen has its pixels; a remount reads the entry back from storage.
		if (gone?.type === "image") URL.revokeObjectURL(gone.url);
		memory.delete(oldest);
	}
	return result;
}

/** The address a thumbnail is filed under. Never fetched: it only names a `CacheStorage` entry. */
function entryUrl(key: string): string {
	return `/__thumbs/${encodeURIComponent(key)}`;
}

function openCache(): Promise<Cache> | null {
	// Absent outside a secure context, and that only costs the second visit its head start.
	return typeof caches === "undefined"
		? null
		: caches.open(CACHE_NAME).catch(() => null) as Promise<Cache>;
}

async function hydrate(response: Response): Promise<ThumbResult> {
	if (response.headers.get("content-type")?.startsWith("application/json")) {
		return { type: "lines", lines: await response.json() };
	}
	return { type: "image", url: URL.createObjectURL(await response.blob()) };
}

/** The thumbnail if this page already holds it. Synchronous, so a remounted card paints it at once. */
export function peekThumb(key: string): ThumbResult | null {
	return memory.get(key) ?? null;
}

/** The thumbnail from this page or an earlier visit. */
export async function readThumb(key: string): Promise<ThumbResult | null> {
	const known = peekThumb(key);
	if (known) return known;
	try {
		const hit = await (await openCache())?.match(entryUrl(key));
		return hit ? remember(key, await hydrate(hit)) : null;
	} catch {
		return null;
	}
}

async function trim(cache: Cache): Promise<void> {
	const entries = await cache.keys();
	const excess = entries.length - STORED_ENTRIES;
	if (excess > 0) await Promise.all(entries.slice(0, excess).map((entry) => cache.delete(entry)));
}

async function store(key: string, response: Response): Promise<void> {
	try {
		const cache = await openCache();
		if (!cache) return;
		await cache.put(entryUrl(key), response);
		writes += 1;
		if (writes % TRIM_EVERY_WRITES === 0) await trim(cache);
	} catch {
		// Storage full or refused: the thumbnail still shows, and is drawn again next visit.
	}
}

/** File a renderer's output and answer the result a card can show. */
export function saveThumb(key: string, output: ThumbOutput): ThumbResult {
	if ("lines" in output) {
		const headers = { "content-type": "application/json" };
		void store(key, new Response(JSON.stringify(output.lines), { headers }));
		return remember(key, { type: "lines", lines: output.lines });
	}
	const headers = { "content-type": output.blob.type };
	void store(key, new Response(output.blob, { headers }));
	return remember(key, { type: "image", url: URL.createObjectURL(output.blob) });
}

/** Note that a file has nothing to draw, for this page only: the failure may be a passing one. */
export function markThumbEmpty(key: string): ThumbResult {
	return remember(key, { type: "none" });
}

/** Drop every thumbnail. Runs at sign-out; never rejects, because a sign-out must not stall on it. */
export async function purgeThumbs(): Promise<void> {
	for (const result of memory.values()) {
		if (result.type === "image") URL.revokeObjectURL(result.url);
	}
	memory.clear();
	if (typeof caches !== "undefined") await caches.delete(CACHE_NAME).catch(() => false);
}
