import {
	SAVED_TAB_TYPES,
	type SavedCollection,
	type SavedEntityType,
	type SavedListParams,
	type SavedPage,
	type SavedState,
	type SavedToggle,
} from "@projective/types/org";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isSupabaseConfigured, useMocks } from "../../core/supabase.ts";
import { invalidatePrefix, messagingReadCache, projectsReadCache, tenantPrefix } from "../../core/cache.ts";
import { canReadLive, type ReadActor, tenantOf } from "../read-actor.ts";
import { MessagingBackendService } from "../messaging/MessagingBackendService.ts";
import { FilesBackendService } from "../files/FilesBackendService.ts";
import {
	displaySaved,
	insertCollection,
	isCollectable,
	LOOKUP_TYPES,
	lookupSaved,
	readCollections,
	readSavedRows,
	removeCollection,
	sortSaved,
	writeSaved,
} from "./live-saved.ts";

/**
 * SavedBackendService — the one saved / favourites system (Decision #174): every star, save and
 * favourite control writes through {@link toggle}, and `/saved` reads {@link list}.
 *
 * A save is kept in the store its kind already had, one store per kind — `org.user_bookmarks` for
 * listings, profiles and project channels (fileable into collections), the project star
 * (`projects.user_preferences`), the conversation star (`comms.set_dm_starred`, via
 * {@link MessagingBackendService.setStarred}), message favourites (`comms.message_favorites`) and the
 * file owner's star (via {@link FilesBackendService.star}). Follows stay `ProfileBackendService`'s; the
 * People tab lists them read-only as "People you follow".
 *
 * Live only, like the profile and files services: there are no fixtures to save into, so a database
 * that is not configured (or `dev:mock`) answers 503 and the client rolls its optimistic change back.
 * The Dev Context Switcher's `saved` axis substitutes the client side instead (`saved-sim`).
 *
 * Thin routes under `apps/web/routes/api/saved/*` parse and delegate here; islands never reach it.
 */

// #region Shared

const SIGNED_OUT = "Sign in to save things.";
const OFFLINE = "Saving needs the live backend.";
const UNREACHABLE = "Your saved items couldn't be reached. Try again in a moment.";

type LiveActor = ReadActor & { accessToken: string };

/** 401 without a session, 503 without a database, 503 on an unexpected failure. */
async function live<T>(
	label: string,
	actor: ReadActor,
	run: (a: LiveActor) => Promise<ServiceResult<T>>,
): Promise<ServiceResult<T>> {
	if (!canReadLive(actor)) return fail(401, { message: SIGNED_OUT });
	if (useMocks() || !isSupabaseConfigured()) return fail(503, { message: OFFLINE });
	try {
		return await run(actor);
	} catch (error) {
		console.error(`[saved:${label}]`, error instanceof Error ? error.message : error);
		return fail(503, { message: UNREACHABLE });
	}
}

/** A save changes what the project feed, the channel tree and the inbox read; drop their cached copies. */
function invalidateReads(actor: ReadActor): void {
	const tenant = tenantPrefix(tenantOf(actor));
	invalidatePrefix(projectsReadCache, tenant);
	invalidatePrefix(messagingReadCache, tenant);
}

const SAVED_MESSAGE: Partial<Record<SavedEntityType, [string, string]>> = {
	project: ["Project starred.", "Star removed."],
	conversation: ["Conversation starred.", "Star removed."],
	message: ["Message saved.", "Message removed from saved."],
	file: ["File starred.", "Star removed."],
	project_channel: ["Channel starred.", "Star removed."],
};

// #endregion

export class SavedBackendService {
	// #region Writes

	/** Save or un-save one thing (the desired state — idempotent), dispatched to its kind's store. */
	static toggle(input: SavedToggle, actor: ReadActor): Promise<ServiceResult<SavedState>> {
		return live("toggle", actor, async (a) => {
			if (input.collectionId !== undefined && !isCollectable(input.type)) {
				return fail(422, {
					message: "Only listings, people and channels can go in a collection.",
					errors: { collectionId: "not_collectable" },
				});
			}
			let result: ServiceResult<SavedState>;
			if (input.type === "conversation") {
				const res = await MessagingBackendService.setStarred(input.ref, input.saved, a);
				result = res.ok ? ok({ saved: input.saved, collectionId: null }) : fail(res.status, { message: res.message });
			} else if (input.type === "file") {
				const res = await FilesBackendService.star(input.ref, input.saved, a);
				result = res.ok ? ok({ saved: input.saved, collectionId: null }) : fail(res.status, { message: res.message });
			} else {
				result = await writeSaved(a, input);
			}
			if (!result.ok) return result;
			invalidateReads(a);
			const [on, off] = SAVED_MESSAGE[input.type] ?? ["Saved.", "Removed from saved."];
			return ok(result.data!, { message: input.saved ? on : off });
		});
	}

	// #endregion

	// #region Reads

	/**
	 * One page of the caller's saved things for a tab (all kinds for `all`), newest save first, follows
	 * last, plus their collections. `collection` narrows to the bookmark kinds in one collection.
	 */
	static list(params: SavedListParams, actor: ReadActor): Promise<ServiceResult<SavedPage>> {
		return live("list", actor, async (a) => {
			const types = params.tab === "all" ? Object.values(SAVED_TAB_TYPES).flat() : SAVED_TAB_TYPES[params.tab];
			const [rows, collections] = await Promise.all([
				readSavedRows(a, types, params.collection),
				readCollections(a),
			]);
			const offset = Number(params.cursor ?? 0);
			const sorted = sortSaved(rows);
			const items = await displaySaved(a, sorted.slice(offset, offset + params.limit));
			const next = offset + params.limit;
			return ok({ items, nextCursor: next < sorted.length ? String(next) : null, collections });
		});
	}

	/** Which of these `type:ref` keys the caller has saved — the cards and lanes' first paint. */
	static state(keys: readonly string[], actor: ReadActor): Promise<ServiceResult<{ saved: string[] }>> {
		return live("state", actor, async (a) => {
			const refs = new Map<SavedEntityType, string[]>();
			for (const key of keys) {
				const at = key.indexOf(":");
				const type = key.slice(0, at) as SavedEntityType;
				if (!LOOKUP_TYPES.includes(type)) {
					return fail(422, { message: `"${type}" saves are read with their own item.`, errors: { keys: "type" } });
				}
				refs.set(type, [...(refs.get(type) ?? []), key.slice(at + 1)]);
			}
			return ok({ saved: await lookupSaved(a, refs) });
		});
	}

	// #endregion

	// #region Collections

	/** The caller's collections. */
	static collections(actor: ReadActor): Promise<ServiceResult<{ collections: SavedCollection[] }>> {
		return live("collections", actor, async (a) => ok({ collections: await readCollections(a) }));
	}

	/** Create a collection. */
	static createCollection(name: string, actor: ReadActor): Promise<ServiceResult<SavedCollection>> {
		return live("collection-create", actor, (a) => insertCollection(a, name));
	}

	/** Delete a collection; what was in it stays saved, unfiled. */
	static deleteCollection(id: string, actor: ReadActor): Promise<ServiceResult<{ id: string }>> {
		return live("collection-delete", actor, (a) => removeCollection(a, id));
	}

	// #endregion
}
