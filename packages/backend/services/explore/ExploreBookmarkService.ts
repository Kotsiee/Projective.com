import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getUserClient, isExploreBackendLive } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { loadCatalog } from "./live-catalog.ts";
import { bookmarkTarget, itemIdsByTarget, targetKey } from "./bookmark-target.ts";
import type { SavedItems } from "@projective/types/explore";

const UNAVAILABLE = "Saving is unavailable right now. Try again shortly.";

/** Stub-mode saves (`EXPLORE_BACKEND_LIVE` off), per user, for the life of the process. */
const stubSaves = new Map<string, Set<string>>();

/**
 * ExploreBookmarkService — the FAT service behind a discovery card's Star.
 *
 * Saves are written to `org.user_bookmarks` under the caller's own session, so RLS ("Users manage own
 * bookmarks") is the only authority on whose row it is. Reads map each row back to the discovery id
 * the catalogue currently publishes it under; a save whose listing is no longer public is omitted.
 *
 * **Stub mode.** With `EXPLORE_BACKEND_LIVE` off, saves live in process memory per user, so the Star
 * behaves on a fixtures server without touching the database.
 */
export const ExploreBookmarkService = {
	/** The caller's saved items, as discovery ids. */
	async list(actor: ReadActor): Promise<ServiceResult<SavedItems>> {
		if (!actor.userId) return fail(401, { message: "Sign in to see what you've saved." });
		if (!isExploreBackendLive()) {
			return ok({ itemIds: [...(stubSaves.get(actor.userId) ?? [])] });
		}
		if (!canReadLive(actor)) return fail(401, { message: "Sign in to see what you've saved." });
		try {
			const { data, error } = await getUserClient(actor.accessToken)
				.schema("org")
				.from("user_bookmarks")
				.select("entity_type, entity_id")
				.eq("user_id", actor.userId);
			if (error) {
				console.error("[explore] org.user_bookmarks read failed", error);
				return fail(503, { message: UNAVAILABLE });
			}
			const itemIdByTarget = itemIdsByTarget(await loadCatalog());
			const itemIds: string[] = [];
			for (const row of data ?? []) {
				const itemId = itemIdByTarget.get(targetKey(row.entity_type, row.entity_id));
				if (itemId) itemIds.push(itemId);
			}
			return ok({ itemIds });
		} catch (error) {
			console.error("[explore] saved items unavailable", error);
			return fail(503, { message: UNAVAILABLE });
		}
	},

	/**
	 * Save or unsave one item as the caller. Idempotent both ways: a repeat save adds no second row
	 * (the table is unique on user, type and id) and unsaving something not saved is a no-op.
	 */
	async set(
		itemId: string,
		saved: boolean,
		actor: ReadActor,
	): Promise<ServiceResult<{ itemId: string; saved: boolean }>> {
		if (!actor.userId) return fail(401, { message: "Sign in to save." });
		if (!isExploreBackendLive()) {
			const set = stubSaves.get(actor.userId) ?? new Set<string>();
			if (saved) set.add(itemId);
			else set.delete(itemId);
			stubSaves.set(actor.userId, set);
			return ok({ itemId, saved });
		}
		if (!canReadLive(actor)) return fail(401, { message: "Sign in to save." });
		try {
			const target = bookmarkTarget(await loadCatalog(), itemId);
			if (!target) return fail(422, { message: "That can't be saved." });
			const table = getUserClient(actor.accessToken).schema("org").from("user_bookmarks");
			const write = saved
				? await table.upsert(
					{ user_id: actor.userId, entity_type: target.kind, entity_id: target.id },
					{ onConflict: "user_id,entity_type,entity_id", ignoreDuplicates: true },
				)
				: await table.delete()
					.eq("user_id", actor.userId)
					.eq("entity_type", target.kind)
					.eq("entity_id", target.id);
			if (write.error) {
				console.error("[explore] org.user_bookmarks write failed", write.error);
				return fail(503, { message: UNAVAILABLE });
			}
			return ok({ itemId, saved });
		} catch (error) {
			console.error("[explore] save unavailable", error);
			return fail(503, { message: UNAVAILABLE });
		}
	},
};
