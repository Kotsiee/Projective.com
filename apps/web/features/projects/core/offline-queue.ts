import { CacheKeys } from "@web/utils/storage-keys.ts";
import type { ProjectSetup, UpdateProject } from "../types/projects-types.ts";

/**
 * offline-queue — the writes this device owes the server, held across a reload until it can send
 * them.
 *
 * ## Why this is a queue of ONE payload per project, not a log of every edit
 *
 * The setup surface's save is a WHOLE-FORM `PATCH`: `toPayload(draft)` serialises the entire
 * configuration as it stands, so a later payload is a strict superset of the state any earlier one
 * described. Replaying a log of them in order would therefore be worse than useless — it would spend
 * a round trip per intermediate state, and each one would briefly put a configuration on the server
 * that the owner has already moved past. Worst of all, an edit that was made and then UNDONE would
 * be resurrected on the way through and then re-undone, so anyone watching the project during a
 * flush would see terms that were never agreed.
 *
 * So the store keeps the LATEST payload per project and supersedes in place. Across several projects
 * edited offline it is a real queue with a real ordering; within one project it is a single cell,
 * which is the exact shape a full-document write deserves.
 *
 * A partial-patch endpoint would need the opposite design, and this module would be the wrong tool
 * for it. That is stated here rather than discovered later.
 *
 * ## Failure is never fatal
 *
 * Every operation resolves rather than throwing: IndexedDB is absent in a worker without it, blocked
 * in some private-browsing modes, and can fail a transaction on a full disk. A surface whose SAVE
 * path could be taken down by its own durability layer is worse than one with no durability layer,
 * so a store that will not open degrades to in-memory queueing for the life of the tab — the write
 * still flushes on reconnect, it just does not survive a reload.
 */

// #region Shapes
/** One project's outstanding write. */
export interface QueuedWrite {
	/** `projects.projects.id` — the canonical identity, so a rename cannot orphan the entry. */
	projectId: string;
	/**
	 * The address the flush sends to.
	 *
	 * Stored ALONGSIDE the id rather than derived from it, because the write path addresses an
	 * engagement by slug and this record may be flushed by a page that never loaded that project and
	 * has no way to resolve one from the other.
	 */
	slug: string;
	/** The payload, exactly as the save path built it. */
	payload: UpdateProject;
	/**
	 * The whole working copy the payload was built from.
	 *
	 * Stored ALONGSIDE the payload, and this is what makes the feature offline-FIRST rather than
	 * merely offline-tolerant. Without it, reopening the project before the queue has flushed would
	 * seed the form from the server — which by definition does not have these edits — and the owner
	 * would be looking at a stale configuration with no sign that anything was missing. Worse, their
	 * next keystroke would build a payload from that stale copy and supersede the queued entry,
	 * silently discarding everything they wrote during the outage.
	 *
	 * The payload is not enough on its own to reconstruct it: {@link UpdateProject} is the WIRE shape
	 * and drops every server-derived field (the ladder, the completeness, the live visibility), so
	 * rebuilding a draft from one would invent the parts it cannot know.
	 */
	draft: ProjectSetup;
	/** When it was queued — shown to the owner, and the flush order across projects. */
	queuedAt: number;
	/** The project's title at the moment it was queued, so a flush report can name it. */
	title: string;
}
// #endregion

// #region The store
const DB_VERSION = 1;

/**
 * The open database, or `null` once opening has been proven impossible.
 *
 * Cached as the PROMISE rather than the result so two concurrent callers share one `open` request:
 * a second `indexedDB.open` against a database whose upgrade is still running blocks until the first
 * settles, which would serialise every early caller behind it for no reason.
 */
let dbPromise: Promise<IDBDatabase | null> | null = null;

/** In-memory fallback used whenever the durable store is unavailable. Keyed by project id. */
const memory = new Map<string, QueuedWrite>();

/** Whether IndexedDB is reachable at all from here. */
function hasIdb(): boolean {
	try {
		return typeof indexedDB !== "undefined" && indexedDB !== null;
	} catch {
		return false;
	}
}

/** Open (and if necessary create) the store. Resolves `null` when durable storage is unavailable. */
function openDb(): Promise<IDBDatabase | null> {
	if (dbPromise) return dbPromise;
	if (!hasIdb()) {
		dbPromise = Promise.resolve(null);
		return dbPromise;
	}

	dbPromise = new Promise<IDBDatabase | null>((resolve) => {
		let settled = false;
		const finish = (db: IDBDatabase | null) => {
			if (settled) return;
			settled = true;
			resolve(db);
		};

		try {
			const request = indexedDB.open(CacheKeys.OFFLINE_DB, DB_VERSION);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(CacheKeys.OFFLINE_WRITES)) {
					db.createObjectStore(CacheKeys.OFFLINE_WRITES, { keyPath: "projectId" });
				}
			};
			request.onsuccess = () => finish(request.result);
			request.onerror = () => finish(null);
			// A `versionchange` from another tab that has upgraded past us. Holding the connection open
			// would block that tab indefinitely; the next call re-opens.
			request.onblocked = () => finish(null);
		} catch {
			finish(null);
		}
	});

	return dbPromise;
}

/**
 * Run one transaction against the writes store, resolving `fallback` on any failure.
 *
 * The `oncomplete`/`onerror` pair is on the TRANSACTION rather than the request: a request can
 * succeed and its transaction still abort (a quota failure during commit), and resolving on the
 * request alone would report a write as durable when nothing was written.
 */
function withStore<T>(
	mode: IDBTransactionMode,
	run: (store: IDBObjectStore) => IDBRequest,
	read: (request: IDBRequest) => T,
	fallback: T,
): Promise<T> {
	return openDb().then((db) => {
		if (!db) return fallback;
		return new Promise<T>((resolve) => {
			try {
				const tx = db.transaction(CacheKeys.OFFLINE_WRITES, mode);
				const request = run(tx.objectStore(CacheKeys.OFFLINE_WRITES));
				let value = fallback;
				request.onsuccess = () => {
					value = read(request);
				};
				tx.oncomplete = () => resolve(value);
				tx.onerror = () => resolve(fallback);
				tx.onabort = () => resolve(fallback);
			} catch {
				resolve(fallback);
			}
		});
	});
}
// #endregion

// #region Operations
/**
 * Hold a write until there is somewhere to send it, superseding whatever this project already owed.
 *
 * `put` rather than `add` is the whole semantics: the newer payload describes the same document at a
 * later moment, so replacing is correct and appending would be the log this module's docblock
 * explains is wrong.
 */
export async function enqueueWrite(entry: QueuedWrite): Promise<void> {
	memory.set(entry.projectId, entry);
	await withStore("readwrite", (store) => store.put(entry), () => undefined, undefined);
}

/** Drop a project's outstanding write — it has landed, or the owner has discarded it. */
export async function dequeueWrite(projectId: string): Promise<void> {
	memory.delete(projectId);
	await withStore("readwrite", (store) => store.delete(projectId), () => undefined, undefined);
}

/** This project's outstanding write, or `null`. */
export async function peekWrite(projectId: string): Promise<QueuedWrite | null> {
	const durable = await withStore<QueuedWrite | null>(
		"readonly",
		(store) => store.get(projectId),
		(request) => (request.result as QueuedWrite | undefined) ?? null,
		null,
	);
	// The in-memory copy wins: it is the one written when the durable store refused, and when both
	// exist they are the same record.
	return memory.get(projectId) ?? durable;
}

/**
 * Every outstanding write, oldest first.
 *
 * Ordered by `queuedAt` rather than by key, so a flush sends the edits in the order the owner made
 * them across projects. The durable rows are merged UNDER the in-memory ones so a record that failed
 * to persist is not shadowed by the older copy that did.
 */
export async function listWrites(): Promise<QueuedWrite[]> {
	const durable = await withStore<QueuedWrite[]>(
		"readonly",
		(store) => store.getAll(),
		(request) => (request.result as QueuedWrite[] | undefined) ?? [],
		[],
	);
	const merged = new Map<string, QueuedWrite>();
	for (const entry of durable) merged.set(entry.projectId, entry);
	for (const [id, entry] of memory) merged.set(id, entry);
	return [...merged.values()].sort((a, b) => a.queuedAt - b.queuedAt);
}
// #endregion
